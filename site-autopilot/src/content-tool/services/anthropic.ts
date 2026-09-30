import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { BaseContentLlm, type StructuredRequest } from './llm-base.js';
import { AppError, ConfigError, TransientError } from '../core/errors.js';
import { estimateUsd, retry } from '../core/util.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('claude');

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicOptions {
  apiKey: string;
  /** Model cho bố cục, viết, biên tập, sửa, duyệt */
  writerModel: string;
  /** Model đọc nguồn và rút ghi chú */
  researchModel: string;
  effort: Effort;
  /** Bật tham số fallbacks phía server: khi Claude từ chối vì chính sách, API tự chạy lại trên model dự phòng. */
  fallbacks?: boolean;
  /** Ngắt mọi lượt gọi đang dở khi người dùng hủy bài */
  signal?: AbortSignal;
}

type StreamParams = Parameters<Anthropic['messages']['stream']>[0];
type AnyMessage = Anthropic.Message | Anthropic.Beta.BetaMessage;

function mapError(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) return new ConfigError('Anthropic API key không hợp lệ hoặc hết hạn. Kiểm tra lại trong Cài đặt → Khóa API.');
  if (err instanceof Anthropic.PermissionDeniedError) return new ConfigError(`Claude từ chối quyền truy cập: ${err.message}`);
  if (err instanceof Anthropic.NotFoundError) return new ConfigError(`Không tìm thấy model Claude: ${err.message}`);
  if (err instanceof Anthropic.RateLimitError) return new TransientError(`Claude bị giới hạn tốc độ: ${err.message}`);
  if (err instanceof Anthropic.InternalServerError) return new TransientError(`Claude lỗi máy chủ: ${err.message}`);
  if (err instanceof Anthropic.APIConnectionError) return new TransientError(`Không kết nối được Claude: ${err.message}`);
  if (err instanceof Anthropic.APIError) return new AppError(`Claude API lỗi ${err.status ?? ''}: ${err.message}`);
  return err instanceof Error ? err : new Error(String(err));
}

export { articleFromLlm, articleToLlm, notesWordCount, outlineFromLlm } from './llm-base.js';

export class AnthropicContentLlm extends BaseContentLlm {
  readonly provider = 'anthropic' as const;
  private readonly client: Anthropic;
  private fallbacks: boolean;

  constructor(private readonly opts: AnthropicOptions) {
    super({ writerModel: opts.writerModel, researchModel: opts.researchModel });
    if (!opts.apiKey) throw new ConfigError('Chưa có Anthropic API key. Vào Cài đặt → Khóa API để nhập, hoặc chọn nhà cung cấp OpenRouter.');
    // Bài dài có thể mất vài phút; streaming tránh timeout HTTP, timeout tổng đặt rộng.
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 20 * 60 * 1000 });
    this.fallbacks = opts.fallbacks ?? true;
  }

  private recordUsage(model: string, usage: AnyMessage['usage']): void {
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    const usd = estimateUsd(model, usage.input_tokens, usage.output_tokens) + estimateUsd(model, cacheRead, 0) * 0.1 + estimateUsd(model, cacheWrite, 0) * 1.25;
    this.record(model, usage.input_tokens + cacheRead + cacheWrite, usage.output_tokens, usd);
  }

  private async callOnce(base: StreamParams, useFallbacks: boolean): Promise<AnyMessage> {
    const reqOpts = this.opts.signal ? { signal: this.opts.signal } : {};
    if (useFallbacks) {
      const params = { ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
      const stream = this.client.beta.messages.stream(params as unknown as Parameters<Anthropic['beta']['messages']['stream']>[0], reqOpts);
      return stream.finalMessage();
    }
    const stream = this.client.messages.stream(base, reqOpts);
    return stream.finalMessage();
  }

  private async call(base: StreamParams, label: string): Promise<AnyMessage> {
    return retry(
      async () => {
        if (this.opts.signal?.aborted) throw new AppError('Bài đã bị hủy', 'cancelled');
        try {
          return await this.callOnce(base, this.fallbacks);
        } catch (err) {
          if (this.opts.signal?.aborted) throw new AppError('Bài đã bị hủy', 'cancelled');
          if (this.fallbacks && err instanceof Anthropic.BadRequestError) {
            // Lỗi 400 khi đang bật fallbacks: thử lại một lần không có fallbacks; nếu vẫn lỗi thì báo lỗi thật.
            log.warn(`Yêu cầu bị từ chối khi bật fallbacks (${err.message}). Thử lại không có fallback.`);
            this.fallbacks = false;
            try {
              return await this.callOnce(base, false);
            } catch (err2) {
              throw mapError(err2);
            }
          }
          throw mapError(err);
        }
      },
      { attempts: 3, baseMs: 3000, maxMs: 30_000, shouldRetry: (e) => e instanceof TransientError },
    ).then((message) => {
      this.recordUsage(base.model, message.usage);
      log.info(`${label}: ${message.usage.output_tokens} token ra, dừng vì ${message.stop_reason}`, { model: base.model });
      return message;
    });
  }

  /**
   * Gọi Claude với structured output, trả về object đã kiểm tra bằng zod.
   * Không dùng hàm parse của SDK: khi luồng bị cắt (từ chối giữa chừng, fallback) SDK ném lỗi "Failed to parse structured output"
   * trước khi ta kịp đọc stop_reason. Ở đây chỉ gửi JSON schema, rồi tự đọc khối văn bản cuối cùng và tự phân tích.
   */
  protected async structured<T>(schema: z.ZodType<T>, req: StructuredRequest): Promise<T> {
    const system: Anthropic.TextBlockParam[] = req.system.filter(Boolean).map((text) => ({ type: 'text', text, cache_control: { type: 'ephemeral' } }));
    const { parse: _parse, ...format } = zodOutputFormat(schema) as unknown as { parse?: unknown } & Record<string, unknown>;
    void _parse;
    const base = {
      model: req.model,
      max_tokens: req.maxTokens,
      system,
      messages: [{ role: 'user' as const, content: req.user }],
      output_config: { format, effort: req.reasoning ?? this.opts.effort },
    } as unknown as StreamParams;

    let lastErr: AppError | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const message = await this.call(base, req.label);
      if (message.stop_reason === 'refusal') {
        const details = (message as { stop_details?: { category?: string | null; explanation?: string } }).stop_details;
        throw new AppError(`Claude từ chối yêu cầu "${req.label}"${details?.category ? ` (${details.category})` : ''}${details?.explanation ? `: ${details.explanation}` : ''}. Thử chạy lại bước này; nếu vẫn bị từ chối, đổi yêu cầu riêng của bài.`);
      }
      if (message.stop_reason === 'max_tokens') throw new AppError(`Câu trả lời cho "${req.label}" bị cắt vì vượt ${req.maxTokens} token (gồm cả phần suy nghĩ của model). Giảm độ dài bài, số nguồn, hoặc hạ effort trong Cài đặt.`);
      // Khi có fallback giữa chừng, content gồm khối văn bản dở dang, khối fallback, rồi khối văn bản đầy đủ: lấy khối cuối.
      const texts = message.content.flatMap((b) => (b.type === 'text' && b.text.trim() ? [b.text.trim()] : []));
      const text = texts[texts.length - 1] ?? '';
      if (!text) throw new AppError(`Claude không trả về nội dung cho "${req.label}" (stop_reason: ${message.stop_reason ?? 'không rõ'})`);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        lastErr = new AppError(`Claude trả về JSON không hợp lệ cho "${req.label}" (stop_reason: ${message.stop_reason ?? 'không rõ'}, ${text.length} ký tự): ${text.slice(0, 160)}…`);
        log.warn(`${lastErr.message}. ${attempt < 2 ? 'Gọi lại một lần.' : ''}`);
        continue;
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        lastErr = new AppError(`Kết quả "${req.label}" không đúng cấu trúc: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        log.warn(`${lastErr.message}. ${attempt < 2 ? 'Gọi lại một lần.' : ''}`);
        continue;
      }
      return parsed.data;
    }
    throw lastErr ?? new AppError(`Không lấy được kết quả cho "${req.label}"`);
  }

  async verify(): Promise<{ ok: boolean; message: string }> {
    try {
      const w = await this.client.models.retrieve(this.opts.writerModel);
      const r = this.opts.researchModel === this.opts.writerModel ? w : await this.client.models.retrieve(this.opts.researchModel);
      return { ok: true, message: `Kết nối Claude OK. Model viết: ${w.display_name} (${w.id}); model đọc nguồn: ${r.display_name} (${r.id}).` };
    } catch (err) {
      return { ok: false, message: mapError(err).message };
    }
  }
}
