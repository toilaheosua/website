import Anthropic from '@anthropic-ai/sdk';
import type { SearchProvider } from './types.js';
import type { SerpData, SerpResult } from '../core/types.js';
import { AppError, ConfigError, TransientError } from '../core/errors.js';
import { nowIso } from '../core/util.js';
import { LlmSerpSchema } from '../generator/llm-schemas.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('search');

export async function getJson(url: string, label: string, timeoutMs = 30_000): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  } catch (err) {
    throw new TransientError(`${label}: không kết nối được (${(err as Error).message})`);
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* không phải JSON */
  }
  if (!res.ok) {
    const detail = typeof json.error === 'string' ? json.error : JSON.stringify(json.error ?? text.slice(0, 200));
    if (res.status === 401 || res.status === 403) throw new ConfigError(`${label}: key bị từ chối (HTTP ${res.status}). ${detail}`);
    if (res.status === 429 || res.status >= 500) throw new TransientError(`${label}: HTTP ${res.status}. ${detail}`);
    throw new AppError(`${label}: HTTP ${res.status}. ${detail}`);
  }
  return json;
}

function cleanResults(items: SerpResult[]): SerpResult[] {
  const seen = new Set<string>();
  const out: SerpResult[] = [];
  for (const r of items) {
    if (!r.link || !/^https?:\/\//i.test(r.link)) continue;
    const key = r.link.replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, position: out.length + 1 });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  SerpAPI                                                              */
/* ------------------------------------------------------------------ */

export class SerpApiProvider implements SearchProvider {
  readonly id = 'serpapi' as const;

  constructor(
    private readonly apiKey: string,
    private readonly opts: { googleDomain: string; country: string; language: string },
  ) {
    if (!apiKey) throw new ConfigError('Chưa có SerpAPI key. Vào Cài đặt → Khóa API để nhập, hoặc đổi nhà cung cấp tìm kiếm.');
  }

  async search(keyword: string, o: { language: 'vi' | 'en'; count: number; page?: number }): Promise<SerpData> {
    const page = o.page ?? 0;
    // Google chỉ trả 10 kết quả một trang; trang sau lấy bằng start
    const params = new URLSearchParams({ engine: 'google', q: keyword, api_key: this.apiKey, num: '10', start: String(page * 10) });
    if (o.language === 'vi') {
      params.set('google_domain', this.opts.googleDomain || 'google.com.vn');
      params.set('gl', this.opts.country || 'vn');
      params.set('hl', this.opts.language || 'vi');
    } else {
      params.set('google_domain', 'google.com');
      params.set('gl', 'us');
      params.set('hl', 'en');
    }
    const json = await getJson(`https://serpapi.com/search.json?${params.toString()}`, 'SerpAPI');
    if (typeof json.error === 'string' && json.error) throw new AppError(`SerpAPI: ${json.error}`);
    const organicRaw = (json.organic_results as { position?: number; title?: string; link?: string; snippet?: string }[] | undefined) ?? [];
    const organic = cleanResults(organicRaw.map((r, i) => ({ position: i + 1, title: r.title ?? '', link: r.link ?? '', snippet: r.snippet ?? '' })));
    const paa = ((json.related_questions as { question?: string }[] | undefined) ?? []).map((q) => q.question ?? '').filter(Boolean);
    const related = ((json.related_searches as { query?: string }[] | undefined) ?? []).map((q) => q.query ?? '').filter(Boolean);
    log.info(`SerpAPI "${keyword}" (${o.language}) trang ${page + 1}: ${organic.length} kết quả, ${paa.length} câu hỏi liên quan`);
    return { provider: 'serpapi', keyword, language: o.language, organic, peopleAlsoAsk: paa, relatedSearches: related, fetchedAt: nowIso() };
  }

  /** Đọc thông tin tài khoản, không tốn lượt tìm. */
  async verify(): Promise<{ ok: boolean; message: string }> {
    try {
      const json = await getJson(`https://serpapi.com/account.json?api_key=${encodeURIComponent(this.apiKey)}`, 'SerpAPI', 15_000);
      const left = json.total_searches_left ?? json.plan_searches_left;
      return { ok: true, message: `SerpAPI OK. Gói: ${String(json.plan_name ?? '?')}, còn ${String(left ?? '?')} lượt tìm.` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Google Custom Search JSON API                                        */
/* ------------------------------------------------------------------ */

export class GoogleCseProvider implements SearchProvider {
  readonly id = 'google_cse' as const;

  constructor(
    private readonly apiKey: string,
    private readonly cx: string,
    private readonly opts: { country: string; language: string },
  ) {
    if (!apiKey || !cx) throw new ConfigError('Chưa có Google Custom Search API key hoặc Search Engine ID (cx). Vào Cài đặt → Khóa API để nhập.');
  }

  private async page(keyword: string, language: 'vi' | 'en', start: number, num: number): Promise<SerpResult[]> {
    const params = new URLSearchParams({ key: this.apiKey, cx: this.cx, q: keyword, num: String(num), start: String(start) });
    if (language === 'vi') {
      params.set('gl', this.opts.country || 'vn');
      params.set('hl', this.opts.language || 'vi');
      params.set('lr', `lang_${this.opts.language || 'vi'}`);
    } else {
      params.set('gl', 'us');
      params.set('hl', 'en');
      params.set('lr', 'lang_en');
    }
    const json = await getJson(`https://customsearch.googleapis.com/customsearch/v1?${params.toString()}`, 'Google Custom Search');
    const items = (json.items as { title?: string; link?: string; snippet?: string }[] | undefined) ?? [];
    return items.map((r, i) => ({ position: start + i, title: r.title ?? '', link: r.link ?? '', snippet: r.snippet ?? '' }));
  }

  async search(keyword: string, o: { language: 'vi' | 'en'; count: number; page?: number }): Promise<SerpData> {
    const page = o.page ?? 0;
    const organic = cleanResults(await this.page(keyword, o.language, 1 + page * 10, 10));
    log.info(`Google CSE "${keyword}" (${o.language}) trang ${page + 1}: ${organic.length} kết quả`);
    return { provider: 'google_cse', keyword, language: o.language, organic, peopleAlsoAsk: [], relatedSearches: [], fetchedAt: nowIso() };
  }

  /** Tốn một lượt tìm trong hạn mức miễn phí 100 lượt mỗi ngày. */
  async verify(): Promise<{ ok: boolean; message: string }> {
    try {
      const r = await this.page('kiểm tra kết nối', 'vi', 1, 1);
      return { ok: true, message: `Google Custom Search OK (${r.length} kết quả thử).` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Claude web search (dự phòng, không cần key tìm kiếm riêng)           */
/* ------------------------------------------------------------------ */

export class ClaudeSearchProvider implements SearchProvider {
  readonly id = 'claude' as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    if (!apiKey) throw new ConfigError('Chưa có Anthropic API key để dùng Claude web search.');
    this.client = new Anthropic({ apiKey });
  }

  async search(keyword: string, o: { language: 'vi' | 'en'; count: number; page?: number }): Promise<SerpData> {
    // Claude web search không phân trang: trả tất cả ở trang đầu, trang sau rỗng
    if (o.page) return { provider: 'claude', keyword, language: o.language, organic: [], peopleAlsoAsk: [], relatedSearches: [], fetchedAt: nowIso() };
    const lang = o.language === 'vi' ? 'tiếng Việt' : 'English';
    const prompt = `Hãy dùng công cụ web_search để tìm từ khóa "${keyword}" và trả về ${o.count} trang web ${lang} có nội dung thật sự về chủ đề này (bài viết, hướng dẫn, trang thông tin), giống nhất với các kết quả tự nhiên đầu tiên của Google ${o.language === 'vi' ? 'Việt Nam' : ''}. Bỏ qua video, mạng xã hội, trang mua sắm.
Trả về DUY NHẤT một JSON hợp lệ, không giải thích, theo mẫu:
{"results":[{"title":"...","url":"https://...","snippet":"mô tả ngắn"}],"peopleAlsoAsk":["các câu hỏi người dùng hay hỏi về chủ đề (3 đến 6 câu, ${lang})"],"relatedSearches":["từ khóa liên quan (3 đến 8)"]}`;
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
    let message: Anthropic.Message | undefined;
    for (let i = 0; i < 4; i++) {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: 6000,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4, user_location: { type: 'approximate', country: o.language === 'vi' ? 'VN' : 'US', timezone: 'Asia/Ho_Chi_Minh' } }],
        messages,
      });
      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      break;
    }
    if (!message) throw new AppError('Claude web search không trả về kết quả');
    if (message.stop_reason === 'refusal') throw new AppError('Claude từ chối yêu cầu tìm kiếm này');
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    let organic: SerpResult[] = [];
    let paa: string[] = [];
    let related: string[] = [];
    if (start >= 0 && end > start) {
      const parsed = LlmSerpSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
      if (parsed.success) {
        organic = parsed.data.results.map((r, i) => ({ position: i + 1, title: r.title, link: r.url, snippet: r.snippet }));
        paa = parsed.data.peopleAlsoAsk;
        related = parsed.data.relatedSearches;
      }
    }
    if (!organic.length) {
      // Dự phòng: lấy URL ngay từ kết quả công cụ tìm kiếm
      for (const block of message.content) {
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const r of block.content) {
            if (r.type === 'web_search_result') organic.push({ position: organic.length + 1, title: r.title, link: r.url, snippet: '' });
          }
        }
      }
    }
    organic = cleanResults(organic).slice(0, o.count);
    log.info(`Claude web search "${keyword}": ${organic.length} kết quả`);
    return { provider: 'claude', keyword, language: o.language, organic, peopleAlsoAsk: paa, relatedSearches: related, fetchedAt: nowIso() };
  }

  async verify(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.client.models.retrieve(this.model);
      return { ok: true, message: `Claude web search sẵn sàng với model ${this.model}.` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}
