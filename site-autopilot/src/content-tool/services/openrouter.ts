import { z } from 'zod';
import { BaseContentLlm, extractJsonText, type StructuredRequest } from './llm-base.js';
import { AppError, ConfigError, TransientError } from '../core/errors.js';
import { retry } from '../core/util.js';
import { createLogger } from '../core/logger.js';
import type { LlmProvider } from '../core/types.js';

const log = createLogger('openrouter');

/** Một API kiểu OpenAI chat/completions: OpenRouter hoặc DeepSeek (platform.deepseek.com). */
export interface Vendor {
  id: LlmProvider;
  name: string;
  base: string;
  /** Cách ép JSON: json_schema strict (OpenRouter) hoặc json_object (DeepSeek: chỉ ép "là JSON", cấu trúc gửi kèm trong prompt) */
  json: 'json_schema' | 'json_object';
  /** Có gửi reasoning.effort không (OpenRouter); DeepSeek chọn suy luận bằng tên model deepseek-reasoner */
  reasoningParam: boolean;
  /** Cần stream_options.include_usage mới có usage ở chunk cuối */
  streamUsage: boolean;
  /** Trần token ra của từng model (DeepSeek: deepseek-chat 8K, deepseek-reasoner 64K); null = không giới hạn thêm */
  maxOutput: (model: string) => number | null;
  /** Giá USD mỗi triệu token để ước tính khi API không trả chi phí; null = API trả sẵn */
  price: (model: string) => { input: number; output: number } | null;
}

export const OPENROUTER: Vendor = { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', json: 'json_schema', reasoningParam: true, streamUsage: false, maxOutput: () => null, price: () => null };
/** DeepSeek: giá ước tính theo bảng giá V3.2 công bố (0,28 USD vào, 0,42 USD ra mỗi triệu token, chưa tính giảm giá cache); đối chiếu với platform.deepseek.com/usage */
export const DEEPSEEK: Vendor = { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com', json: 'json_object', reasoningParam: false, streamUsage: true, maxOutput: (m) => (/reasoner/i.test(m) ? 65536 : 8192), price: () => ({ input: 0.28, output: 0.42 }) };

export interface OpenRouterOptions {
  apiKey: string;
  /** Nhà cung cấp API; mặc định OpenRouter */
  vendor?: Vendor;
  writerModel: string;
  researchModel: string;
  /** Tên ứng dụng gửi kèm header X-OpenRouter-Title (tùy chọn) */
  appTitle?: string;
  /** Nhiệt độ sinh cho lượt viết, biên tập, sửa */
  temperature?: number;
  /** Mức suy nghĩ mặc định cho model suy luận (thấp = ít đốt token vào phần suy nghĩ; off = tắt hẳn với model cho phép tắt) */
  reasoning?: 'off' | 'low' | 'medium' | 'high';
  /** Ngắt mọi lượt gọi đang dở khi người dùng hủy bài */
  signal?: AbortSignal;
}

/** Đưa JSON schema về dạng "strict" mà OpenAI/OpenRouter yêu cầu: mọi object có additionalProperties=false và required đủ các trường. */
export function strictJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictJsonSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const s = { ...(schema as Record<string, unknown>) };
  delete s.$schema;
  if (s.type === 'object' && s.properties && typeof s.properties === 'object') {
    const props = Object.fromEntries(Object.entries(s.properties as Record<string, unknown>).map(([k, v]) => [k, strictJsonSchema(v)]));
    s.properties = props;
    s.required = Object.keys(props);
    s.additionalProperties = false;
  }
  for (const key of ['items', 'anyOf', 'oneOf', 'allOf'] as const) if (s[key]) s[key] = strictJsonSchema(s[key]);
  if (s.$defs && typeof s.$defs === 'object') s.$defs = Object.fromEntries(Object.entries(s.$defs as Record<string, unknown>).map(([k, v]) => [k, strictJsonSchema(v)]));
  return s;
}

/**
 * Dựng một JSON MẪU từ JSON schema để đưa vào prompt khi không ép được cấu trúc bằng API (DeepSeek json_object, model không nhận json_schema).
 * Gửi thẳng JSON schema (type, properties...) khiến model chép lại schema thay vì điền dữ liệu; mẫu có giá trị giữ chỗ thì model điền đúng.
 */
export function schemaExample(schema: unknown, defs: Record<string, unknown> = {}): unknown {
  if (!schema || typeof schema !== 'object') return null;
  const s = schema as Record<string, unknown>;
  const allDefs = { ...defs, ...((s.$defs as Record<string, unknown> | undefined) ?? {}) };
  if (typeof s.$ref === 'string') {
    const name = s.$ref.replace(/^#\/\$defs\//, '');
    return name in allDefs ? schemaExample(allDefs[name], allDefs) : null;
  }
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const opts = s[key];
    if (Array.isArray(opts) && opts.length) return schemaExample(opts.find((o) => (o as Record<string, unknown>).type !== 'null') ?? opts[0], allDefs);
  }
  const type = Array.isArray(s.type) ? (s.type as string[]).find((t) => t !== 'null') : s.type;
  if (type === 'object' || (s.properties && typeof s.properties === 'object')) {
    return Object.fromEntries(Object.entries((s.properties as Record<string, unknown>) ?? {}).map(([k, v]) => [k, schemaExample(v, allDefs)]));
  }
  if (type === 'array') return [schemaExample(s.items ?? {}, allDefs)];
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'boolean') return true;
  if (type === 'string') return 'chuỗi';
  return null;
}

/** Model chép lại schema thay vì điền dữ liệu: JSON trả về có "type" và "properties" ở cấp ngoài (schema của tool không bao giờ có trường này). */
export function looksLikeSchemaEcho(text: string): boolean {
  return /^\s*\{\s*"type"\s*:\s*"object"\s*,\s*"properties"/.test(text) || /"\$schema"|"additionalProperties"/.test(text.slice(0, 400));
}

interface StreamResult {
  text: string;
  /** Phần suy nghĩ của model suy luận (nếu nhà cung cấp trả về) */
  reasoning: string;
  finishReason: string | null;
  usage: { prompt: number; completion: number; cost: number | null; reasoning: number };
}

/** Gọi lại một lượt với mức suy nghĩ và trần token khác (cứu model suy luận bị cắt). */
export interface CallOverride {
  reasoning?: 'off' | 'low' | 'medium' | 'high';
  maxTokens?: number;
  /** Nhắc model trả lời ngay trong nội dung, không dài dòng trong phần suy nghĩ */
  nudge?: boolean;
  /** Lời nhắc thêm sau khi lượt trước trả sai (ví dụ chép lại mẫu cấu trúc) */
  warn?: string;
}

/** Đọc luồng SSE của OpenRouter: gom nội dung và phần suy nghĩ, bắt lỗi giữa luồng, lấy usage ở chunk cuối. */
export async function readSse(res: Response, vendorName = 'OpenRouter'): Promise<StreamResult> {
  const reader = res.body?.getReader();
  if (!reader) throw new TransientError(`${vendorName} không trả về luồng dữ liệu`);
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let text = '';
  let reasoning = '';
  let finishReason: string | null = null;
  const usage = { prompt: 0, completion: 0, cost: null as number | null, reasoning: 0 };
  const handleLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let chunk: {
      error?: { code?: string | number; message?: string };
      choices?: { delta?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; completion_tokens_details?: { reasoning_tokens?: number } };
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    if (chunk.error) {
      // Lỗi giữa luồng thường là nhà cung cấp phía sau rơi kết nối hoặc quá tải ("Network connection lost", 502, 503, 529):
      // coi là tạm thời để gọi lại; chỉ lỗi 400/401/402/403/404 mới là lỗi cố định
      const code = Number(chunk.error.code);
      const msg = chunk.error.message ?? JSON.stringify(chunk.error);
      if ([400, 401, 402, 403, 404].includes(code)) throw new AppError(`${vendorName} báo lỗi giữa luồng: ${msg}`);
      throw new TransientError(`${vendorName} rơi kết nối giữa luồng (${msg}); tool sẽ gọi lại`);
    }
    const choice = chunk.choices?.[0];
    if (choice?.delta?.content) text += choice.delta.content;
    const r = choice?.delta?.reasoning ?? choice?.delta?.reasoning_content;
    if (r) reasoning += r;
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk.usage) {
      usage.prompt = chunk.usage.prompt_tokens ?? usage.prompt;
      usage.completion = chunk.usage.completion_tokens ?? usage.completion;
      if (typeof chunk.usage.cost === 'number') usage.cost = chunk.usage.cost;
      if (typeof chunk.usage.completion_tokens_details?.reasoning_tokens === 'number') usage.reasoning = chunk.usage.completion_tokens_details.reasoning_tokens;
    }
  };
  while (true) {
    let step: ReadableStreamReadResult<Uint8Array>;
    try {
      step = await reader.read();
    } catch (err) {
      throw new TransientError(`Luồng ${vendorName} bị ngắt: ${(err as Error).message}`);
    }
    const { done, value } = step;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      handleLine(line);
    }
  }
  if (buffer.trim()) handleLine(buffer.trim());
  // Nhà cung cấp phía sau hỏng giữa chừng: finish_reason "error" (có thể kèm nội dung dở dang) hoặc luồng đóng mà không có finish_reason
  // và không có nội dung. Cả hai đều là lỗi tạm thời: gọi lại, không đem nội dung dở đi phân tích JSON.
  if (finishReason === 'error') throw new TransientError(`${vendorName}: nhà cung cấp model báo lỗi giữa luồng (finish_reason=error) sau ${text.length} ký tự; tool sẽ gọi lại`);
  if (!finishReason && !text.trim()) throw new TransientError(`${vendorName}: luồng đóng mà không có kết quả (không có finish_reason, ${reasoning.length} ký tự suy nghĩ); tool sẽ gọi lại`);
  return { text, reasoning, finishReason, usage };
}

/**
 * OpenRouter: một key dùng được nhiều model (GPT, Gemini, DeepSeek, Qwen, Claude...).
 * Gọi /chat/completions dạng stream, ép JSON theo schema qua response_format; model nào không hỗ trợ thì
 * tự chuyển sang yêu cầu "chỉ trả JSON" trong prompt và tự trích JSON từ văn bản.
 */
export class OpenRouterContentLlm extends BaseContentLlm {
  readonly provider: LlmProvider;
  private readonly vendor: Vendor;
  private schemaUnsupported = new Set<string>();

  constructor(private readonly opts: OpenRouterOptions) {
    super({ writerModel: opts.writerModel, researchModel: opts.researchModel, temperature: opts.temperature });
    this.vendor = opts.vendor ?? OPENROUTER;
    this.provider = this.vendor.id;
    if (!opts.apiKey) throw new ConfigError(`Chưa có ${this.vendor.name} API key. Vào Cài đặt → Khóa API để nhập, hoặc chọn nhà cung cấp khác.`);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Authorization: `Bearer ${this.opts.apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream' };
    if (this.vendor.id === 'openrouter') {
      h['HTTP-Referer'] = 'https://github.com/viet-content';
      h['X-OpenRouter-Title'] = this.opts.appTitle ?? 'Tool Viet Content';
    }
    return h;
  }

  private async callOnce(req: StructuredRequest, jsonSchema: unknown, useSchema: boolean, over: CallOverride | null = null): Promise<StreamResult> {
    const v = this.vendor;
    const system = req.system.filter(Boolean).join('\n\n');
    // json_object (DeepSeek) chỉ ép "phải là JSON", không ép cấu trúc: luôn gửi kèm cấu trúc trong prompt
    const describe = !useSchema || v.json === 'json_object';
    let user = describe
      ? `${req.user}\n\nTRẢ VỀ DUY NHẤT một JSON hợp lệ (không giải thích, không rào code) theo đúng tên trường và kiểu dữ liệu của MẪU dưới đây. Mẫu chỉ minh họa kiểu: "chuỗi" là chỗ điền văn bản thật, 0 là chỗ điền số thật, mảng có thể nhiều phần tử. Không chép lại mẫu, không trả về mô tả cấu trúc kiểu "type"/"properties".\nMẪU:\n${JSON.stringify(schemaExample(jsonSchema))}`
      : req.user;
    if (over?.nudge) user += '\n\nQUAN TRỌNG: trả lời ngay bằng JSON trong phần nội dung; không suy nghĩ dài dòng, không lặp lại đề bài.';
    if (over?.warn) user += `\n\n${over.warn}`;
    const wanted = over?.maxTokens ?? req.maxTokens;
    const cap = v.maxOutput(req.model);
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
      stream: true,
      max_tokens: cap ? Math.min(wanted, cap) : wanted,
    };
    // Model suy luận tính cả phần suy nghĩ vào max_tokens: OpenRouter nhận mức suy nghĩ (mặc định thấp theo Cài đặt);
    // DeepSeek không có tham số này, chọn suy luận bằng tên model deepseek-reasoner
    if (v.reasoningParam) {
      const effort = over?.reasoning ?? req.reasoning ?? this.opts.reasoning ?? 'low';
      // DeepSeek dạng lai trên OpenRouter bỏ qua mức suy nghĩ (vẫn đốt 10.000+ token suy nghĩ ở mức thấp), chỉ tắt được:
      // mức "thấp" với model deepseek (không phải r1/reasoner) thì tắt hẳn; model chỉ suy luận bỏ qua enabled=false
      const autoOff = effort === 'low' && /deepseek/i.test(req.model) && !/r1|reasoner|thinking/i.test(req.model);
      body.reasoning = effort === 'off' || autoOff ? { enabled: false } : { effort };
    }
    if (req.temperature !== undefined && Number.isFinite(req.temperature)) body.temperature = req.temperature;
    if (v.streamUsage) body.stream_options = { include_usage: true };
    if (useSchema) {
      if (v.json === 'json_schema') {
        body.response_format = { type: 'json_schema', json_schema: { name: 'viet_content', strict: true, schema: jsonSchema } };
        body.provider = { require_parameters: true };
      } else body.response_format = { type: 'json_object' };
    }
    if (this.opts.signal?.aborted) throw new AppError('Bài đã bị hủy', 'cancelled');
    const timeout = AbortSignal.timeout(20 * 60 * 1000);
    const signal = this.opts.signal ? AbortSignal.any([timeout, this.opts.signal]) : timeout;
    let res: Response;
    try {
      res = await fetch(`${v.base}/chat/completions`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    } catch (err) {
      if (this.opts.signal?.aborted) throw new AppError('Bài đã bị hủy', 'cancelled');
      throw new TransientError(`Không kết nối được ${v.name}: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const raw = await res.text();
      let msg = raw.slice(0, 400);
      try {
        const j = JSON.parse(raw) as { error?: { message?: string; code?: number | string } };
        msg = j.error?.message ?? msg;
      } catch {
        /* giữ raw */
      }
      const modelsUrl = v.id === 'openrouter' ? 'https://openrouter.ai/models' : 'https://api-docs.deepseek.com/quick_start/pricing';
      if (res.status === 401) throw new ConfigError(`${v.name} từ chối API key: ${msg}`);
      if (res.status === 402) throw new ConfigError(`Tài khoản ${v.name} hết credit hoặc số dư: ${msg}`);
      if (res.status === 404) throw new ConfigError(`${v.name} không tìm thấy model "${req.model}": ${msg}. Kiểm tra tên model tại ${modelsUrl}`);
      if (res.status === 429 || res.status >= 500) throw new TransientError(`${v.name} HTTP ${res.status}: ${msg}`);
      if ((res.status === 400 || res.status === 422) && useSchema && /response_format|structured|json_schema|json_object|schema|require_parameters|No endpoints/i.test(msg)) {
        throw new SchemaUnsupportedError(msg);
      }
      throw new AppError(`${v.name} HTTP ${res.status}: ${msg}`);
    }
    return readSse(res, v.name);
  }

  protected async structured<T>(schema: z.ZodType<T>, req: StructuredRequest): Promise<T> {
    const jsonSchema = strictJsonSchema(z.toJSONSchema(schema, { reused: 'ref' }));
    let lastErr: AppError | null = null;
    // Lần "cứu": model suy luận đốt hết trần token vào phần suy nghĩ hoặc trả nội dung rỗng → gọi lại với mức suy nghĩ thấp, trần cao hơn
    let boost: CallOverride | null = null;
    let boosted = false;
    let capNow = req.maxTokens;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const useSchema = !this.schemaUnsupported.has(req.model);
      let result: StreamResult;
      try {
        result = await retry(() => this.callOnce(req, jsonSchema, useSchema, boost), { attempts: 3, baseMs: 3000, maxMs: 30_000, shouldRetry: (e) => e instanceof TransientError });
      } catch (err) {
        if (err instanceof SchemaUnsupportedError) {
          log.warn(`Model ${req.model} không nhận response_format (${err.message}); chuyển sang yêu cầu JSON trong prompt.`);
          this.schemaUnsupported.add(req.model);
          result = await retry(() => this.callOnce(req, jsonSchema, false, boost), { attempts: 3, baseMs: 3000, maxMs: 30_000, shouldRetry: (e) => e instanceof TransientError });
        } else throw err;
      }
      // API không trả chi phí (DeepSeek) thì ước tính theo bảng giá của nhà cung cấp
      const price = result.usage.cost === null ? this.vendor.price(req.model) : null;
      const cost = result.usage.cost ?? (price ? (result.usage.prompt * price.input + result.usage.completion * price.output) / 1e6 : 0);
      this.record(req.model, result.usage.prompt, result.usage.completion, cost);
      const reasoningNote = result.usage.reasoning ? `, trong đó ${result.usage.reasoning} token suy nghĩ` : result.reasoning ? `, có ${Math.round(result.reasoning.length / 4)} token suy nghĩ ước tính` : '';
      log.info(`${req.label}: ${result.usage.completion} token ra${reasoningNote}, dừng vì ${result.finishReason ?? 'không rõ'}, chi phí ${cost.toFixed(4)} USD${price ? ' (ước tính)' : ''}`, { model: req.model });
      if (result.finishReason === 'content_filter') throw new AppError(`Model ${req.model} từ chối yêu cầu "${req.label}" vì bộ lọc nội dung. Thử model khác hoặc chạy lại.`);
      let text = extractJsonText(result.text);
      // Một số model suy luận đặt luôn JSON vào phần suy nghĩ, nội dung để trống: lấy JSON từ đó nếu hợp lệ
      if (!text && result.reasoning) {
        const fromReasoning = extractJsonText(result.reasoning);
        // Chỉ nhận khi là JSON hoàn chỉnh và không phải bản nháp cấu trúc kiểu {"title": "...", ...}
        if (fromReasoning.startsWith('{') && !/"\.\.\."|…/.test(fromReasoning)) {
          try {
            JSON.parse(fromReasoning);
            log.warn(`${req.label}: model ${req.model} để JSON trong phần suy nghĩ, lấy từ đó.`);
            text = fromReasoning;
          } catch {
            /* phần suy nghĩ chỉ có JSON dở, coi như không có nội dung để đi đường cứu */
          }
        }
      }
      const cut = result.finishReason === 'length';
      if (cut || !text) {
        const why = cut ? `bị cắt vì vượt ${Math.min(capNow, this.vendor.maxOutput(req.model) ?? capNow)} token` : 'trả về nội dung rỗng';
        if (!boosted) {
          boosted = true;
          capNow = Math.min(64000, Math.round(capNow * 1.5));
          // Lượt cứu tắt hẳn suy nghĩ (model cho phép tắt thì hết đốt token; model không cho tắt thì OpenRouter bỏ qua)
          boost = { reasoning: 'off', maxTokens: capNow, nudge: true };
          log.warn(`${req.label}: model ${req.model} ${why}${reasoningNote}. Gọi lại với suy nghĩ tắt và trần ${boost.maxTokens} token.`);
          continue;
        }
        throw new AppError(
          `Câu trả lời cho "${req.label}" ${why} trên model ${req.model}${reasoningNote}, kể cả sau khi đã hạ mức suy nghĩ. ${req.model} có vẻ là model suy luận: phần suy nghĩ tính vào trần token và có thể không trả nội dung. Chọn model không suy luận cho bước này (ví dụ deepseek-chat thay vì deepseek-reasoner, hoặc Claude), hoặc giảm độ dài bài.`,
        );
      }
      // Model chép lại mẫu cấu trúc thay vì điền dữ liệu (hay gặp ở DeepSeek với json_object): gọi lại kèm lời nhắc rõ
      if (looksLikeSchemaEcho(text)) {
        lastErr = new AppError(`Model ${req.model} chép lại mẫu cấu trúc thay vì điền dữ liệu cho "${req.label}" (${text.length} ký tự).`);
        log.warn(`${lastErr.message} ${attempt < 3 ? 'Gọi lại kèm lời nhắc.' : ''}`);
        boost = { ...(boost ?? {}), warn: 'LƯU Ý: lần trước bạn trả về bản mô tả cấu trúc (type, properties) thay vì dữ liệu. Hãy trả về DỮ LIỆU THẬT điền theo mẫu: mỗi trường là giá trị cụ thể rút từ nội dung đề bài, không có chữ "type", "properties", "items".' };
        continue;
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        lastErr = new AppError(`Model ${req.model} trả về JSON không hợp lệ cho "${req.label}" (${text.length} ký tự): ${text.slice(0, 160)}…`);
        log.warn(`${lastErr.message}. ${attempt < 3 ? 'Gọi lại một lần.' : ''}`);
        continue;
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        lastErr = new AppError(`Kết quả "${req.label}" từ ${req.model} không đúng cấu trúc: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        log.warn(`${lastErr.message}. ${attempt < 3 ? 'Gọi lại một lần.' : ''}`);
        continue;
      }
      return parsed.data;
    }
    throw lastErr ?? new AppError(`Không lấy được kết quả cho "${req.label}"`);
  }

  /** Kiểm tra key và hai model có tồn tại, không tốn token sinh. */
  async verify(): Promise<{ ok: boolean; message: string }> {
    if (this.vendor.id === 'deepseek') return this.verifyDeepSeek();
    try {
      const keyRes = await fetch(`${OPENROUTER.base}/key`, { headers: { Authorization: `Bearer ${this.opts.apiKey}` }, signal: AbortSignal.timeout(15_000) });
      if (keyRes.status === 401) return { ok: false, message: 'OpenRouter từ chối API key.' };
      let keyInfo = '';
      if (keyRes.ok) {
        const j = (await keyRes.json()) as { data?: { label?: string; usage?: number; limit?: number | null; limit_remaining?: number | null } };
        const d = j.data;
        if (d) keyInfo = ` Key "${d.label ?? ''}": đã dùng ${Number(d.usage ?? 0).toFixed(2)} USD${d.limit != null ? `, hạn mức ${d.limit} USD` : ''}${d.limit_remaining != null ? `, còn ${Number(d.limit_remaining).toFixed(2)} USD` : ''}.`;
      }
      const modelsRes = await fetch(`${OPENROUTER.base}/models`, { headers: { Authorization: `Bearer ${this.opts.apiKey}` }, signal: AbortSignal.timeout(20_000) });
      if (!modelsRes.ok) return { ok: false, message: `OpenRouter HTTP ${modelsRes.status} khi đọc danh sách model.` };
      const models = ((await modelsRes.json()) as { data?: { id: string; supported_parameters?: string[] }[] }).data ?? [];
      const missing = [this.opts.writerModel, this.opts.researchModel].filter((m) => !models.some((x) => x.id === m));
      if (missing.length) return { ok: false, message: `Không tìm thấy model trên OpenRouter: ${missing.join(', ')}. Xem tên đúng tại https://openrouter.ai/models.${keyInfo}` };
      const noSchema = [this.opts.writerModel, this.opts.researchModel].filter((m) => !(models.find((x) => x.id === m)?.supported_parameters ?? []).includes('response_format'));
      return { ok: true, message: `Kết nối OpenRouter OK. Model viết: ${this.opts.writerModel}; model đọc nguồn: ${this.opts.researchModel}.${noSchema.length ? ` Lưu ý: ${noSchema.join(', ')} không hỗ trợ JSON schema, tool sẽ yêu cầu JSON qua prompt.` : ''}${keyInfo}` };
    } catch (err) {
      return { ok: false, message: `Không kiểm tra được OpenRouter: ${(err as Error).message}` };
    }
  }

  /** DeepSeek: danh sách model tại /models, số dư tại /user/balance. */
  private async verifyDeepSeek(): Promise<{ ok: boolean; message: string }> {
    const auth = { Authorization: `Bearer ${this.opts.apiKey}` };
    try {
      const modelsRes = await fetch(`${DEEPSEEK.base}/models`, { headers: auth, signal: AbortSignal.timeout(20_000) });
      if (modelsRes.status === 401) return { ok: false, message: 'DeepSeek từ chối API key. Tạo key tại platform.deepseek.com/api_keys.' };
      if (!modelsRes.ok) return { ok: false, message: `DeepSeek HTTP ${modelsRes.status} khi đọc danh sách model.` };
      const models = ((await modelsRes.json()) as { data?: { id: string }[] }).data ?? [];
      const want = [...new Set([this.opts.writerModel, this.opts.researchModel])];
      const missing = models.length ? want.filter((m) => !models.some((x) => x.id === m)) : [];
      if (missing.length) return { ok: false, message: `DeepSeek không có model: ${missing.join(', ')}. Model hiện có: ${models.map((x) => x.id).join(', ')}.` };
      let balance = '';
      const balRes = await fetch(`${DEEPSEEK.base}/user/balance`, { headers: auth, signal: AbortSignal.timeout(15_000) });
      if (balRes.ok) {
        const j = (await balRes.json()) as { is_available?: boolean; balance_infos?: { currency: string; total_balance: string }[] };
        const b = j.balance_infos?.map((x) => `${x.total_balance} ${x.currency}`).join(', ');
        if (b) balance = ` Số dư: ${b}${j.is_available === false ? ' (không đủ để gọi API, nạp thêm tại platform.deepseek.com)' : ''}.`;
      }
      const reasoner = want.filter((m) => /reasoner/i.test(m));
      return { ok: true, message: `Kết nối DeepSeek OK. Model viết: ${this.opts.writerModel}; model đọc nguồn: ${this.opts.researchModel}.${reasoner.length ? ` ${reasoner.join(', ')} là model suy luận: chậm và tốn token hơn, tool đã chừa trần 64K.` : ''} Chi phí hiển thị là ước tính theo bảng giá công bố.${balance}` };
    } catch (err) {
      return { ok: false, message: `Không kiểm tra được DeepSeek: ${(err as Error).message}` };
    }
  }
}

/** DeepSeek tại platform.deepseek.com: cùng giao thức chat/completions với OpenRouter, khác cách ép JSON và không có tham số mức suy nghĩ. */
export class DeepSeekContentLlm extends OpenRouterContentLlm {
  constructor(opts: Omit<OpenRouterOptions, 'vendor'>) {
    super({ ...opts, vendor: DEEPSEEK });
  }
}

class SchemaUnsupportedError extends AppError {
  constructor(message: string) {
    super(message, 'schema_unsupported');
    this.name = 'SchemaUnsupportedError';
  }
}
