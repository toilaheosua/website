import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { FetchedPage, PageFetcher } from './types.js';
import { TransientError } from '../core/errors.js';
import { wordCount } from '../core/util.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** Các domain không có nội dung văn bản dùng được (video, mạng xã hội, sàn), luôn bỏ qua khi thu thập. */
export const ALWAYS_SKIP_DOMAINS = [
  // Video, mạng xã hội
  'youtube.com', 'youtu.be', 'facebook.com', 'fb.com', 'fb.watch', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com', 'pinterest.com', 'linkedin.com', 'threads.net', 'threads.com', 'zalo.me', 'reddit.com', 'quora.com', 'vimeo.com', 'dailymotion.com', 'lotus.vn', 'gapo.vn', 'tumblr.com', 't.me', 'telegram.me', 'discord.com', 'twitch.tv',
  // Sàn, app giao đồ ăn, cửa hàng ứng dụng (trang liệt kê, không phải bài viết)
  'shopee.vn', 'shopeefood.vn', 'lazada.vn', 'tiki.vn', 'sendo.vn', 'food.grab.com', 'grab.com', 'baemin.vn', 'be.com.vn', 'google.com', 'maps.google.com', 'apps.apple.com', 'play.google.com',
];

const VI_CHARS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi;

export function guessLanguage(text: string): string {
  const sample = text.slice(0, 5000);
  const letters = (sample.match(/\p{L}/gu) ?? []).length;
  if (letters < 50) return 'other';
  const vi = (sample.match(VI_CHARS) ?? []).length;
  if (vi / letters > 0.06) return 'vi';
  const en = (sample.match(/\b(the|and|of|to|with|for|you|that|this|are)\b/gi) ?? []).length;
  if (en > 8) return 'en';
  return 'other';
}

function decodeBody(buf: ArrayBuffer, contentType: string): string {
  const m = /charset=([\w-]+)/i.exec(contentType);
  let charset = (m?.[1] ?? 'utf-8').toLowerCase();
  if (charset === 'utf8') charset = 'utf-8';
  try {
    let html = new TextDecoder(charset, { fatal: false }).decode(buf);
    if (charset === 'utf-8') {
      const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(html.slice(0, 4000));
      const c = meta?.[1]?.toLowerCase();
      if (c && c !== 'utf-8' && c !== 'utf8') {
        try {
          html = new TextDecoder(c).decode(buf);
        } catch {
          /* giữ utf-8 */
        }
      }
    }
    return html;
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

export function cleanText(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^(share|chia sẻ|đăng nhập|đăng ký|menu|trang chủ)$/i.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function cutAtSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastStop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('.\n'), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  return (lastStop > maxChars * 0.6 ? slice.slice(0, lastStop + 1) : slice).trim();
}

/* ------------------------------------------------------------------ */
/*  Nội dung nhúng trong script (Next.js, Nuxt, JSON-LD)                 */
/* ------------------------------------------------------------------ */

function decodeJsonString(escaped: string): string | null {
  try {
    return JSON.parse(`"${escaped}"`) as string;
  } catch {
    return null;
  }
}

function htmlScore(s: string): number {
  return (s.match(/<p[\s>]/gi) ?? []).length * 2 + (s.match(/<h[23][\s>]/gi) ?? []).length + (s.match(/<li[\s>]/gi) ?? []).length * 0.5;
}

/** Duyệt mọi chuỗi trong một cây JSON, gom chuỗi dài. */
function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 12) return;
  if (typeof value === 'string') {
    if (value.length >= 400) out.push(value);
    return;
  }
  if (Array.isArray(value)) for (const v of value) collectStrings(v, out, depth + 1);
  else if (value && typeof value === 'object') for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, out, depth + 1);
}

export interface EmbeddedContent {
  /** HTML của bài (đưa qua Readability) */
  html?: string;
  /** Văn bản thuần (từ JSON-LD articleBody) */
  text?: string;
  source: 'rsc' | 'next_data' | 'nuxt' | 'ld_json' | 'script_json';
}

/**
 * Nhiều site (bachhoaxanh, thegioididong và các site Next.js, Nuxt) trả HTML rỗng, bài nằm trong chuỗi JSON của script
 * để trình duyệt tự dựng. Hàm này tìm khối HTML bài viết lớn nhất trong các script đó.
 */
export function extractEmbeddedContent(html: string): EmbeddedContent | null {
  const candidates: { html: string; score: number; source: EmbeddedContent['source'] }[] = [];
  const consider = (s: string, source: EmbeddedContent['source']) => {
    let cur = s;
    // Chuỗi bị mã hóa hai lớp (\"<p>) thì giải thêm một lớp
    if (!/<p[\s>]/i.test(cur) && /\\"<|\\u003c/i.test(cur)) cur = decodeJsonString(cur.replace(/^"|"$/g, '')) ?? cur;
    const score = htmlScore(cur);
    if (score >= 6) candidates.push({ html: cur, score, source });
  };

  // 1. Next.js App Router: self.__next_f.push([1,"..."])
  const rsc = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = rsc.exec(html))) {
    const decoded = decodeJsonString(m[1] ?? '');
    if (decoded) consider(decoded, 'rsc');
  }

  // 2. Next.js Pages Router: <script id="__NEXT_DATA__">{...}</script>; Nuxt: window.__NUXT__=..., <script id="__NUXT_DATA__">
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const ldTexts: string[] = [];
  while ((m = scriptRe.exec(html))) {
    const attrs = m[1] ?? '';
    const body = (m[2] ?? '').trim();
    if (!body || body.length < 400) continue;
    if (/application\/ld\+json/i.test(attrs)) {
      try {
        const json = JSON.parse(body) as unknown;
        const stack = [json];
        while (stack.length) {
          const v = stack.pop();
          if (Array.isArray(v)) stack.push(...v);
          else if (v && typeof v === 'object') {
            const o = v as Record<string, unknown>;
            if (typeof o.articleBody === 'string' && o.articleBody.length > 400) ldTexts.push(o.articleBody);
            stack.push(...Object.values(o));
          }
        }
      } catch {
        /* JSON-LD hỏng */
      }
      continue;
    }
    if (/__NEXT_DATA__|__NUXT_DATA__/i.test(attrs) || /^\s*[{[]/.test(body)) {
      try {
        const strings: string[] = [];
        collectStrings(JSON.parse(body), strings);
        for (const s of strings) consider(s, /__NUXT/i.test(attrs) ? 'nuxt' : 'next_data');
        continue;
      } catch {
        /* không phải JSON thuần */
      }
    }
    // 3. Script bất kỳ: chuỗi JSON dài có chứa HTML (window.__NUXT__=..., dữ liệu render tùy biến)
    const strRe = /"((?:[^"\\]|\\.){400,})"/g;
    let sm: RegExpExecArray | null;
    let guard = 0;
    while ((sm = strRe.exec(body)) && guard++ < 200) {
      const raw = sm[1] ?? '';
      if (!/<\/p>|\\u003c\/p|\\\/p>/i.test(raw)) continue;
      const decoded = decodeJsonString(raw);
      if (decoded) consider(decoded, /__NUXT__/i.test(body) ? 'nuxt' : 'script_json');
    }
  }

  if (candidates.length) {
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0]!;
    // Bài bị tách thành nhiều khối cùng nguồn: ghép các khối lớn theo thứ tự xuất hiện
    const same = candidates.filter((c) => c.source === best.source && c.score >= best.score * 0.3);
    const joined = same.length > 1 ? same.map((c) => c.html).join('\n') : best.html;
    return { html: joined, source: best.source };
  }
  if (ldTexts.length) return { text: ldTexts.sort((a, b) => b.length - a.length)[0]!, source: 'ld_json' };
  return null;
}

/** Chuyển một mảnh HTML bài viết thành văn bản thuần bằng Readability, dự phòng bằng cách bỏ thẻ. */
export function embeddedHtmlToText(fragment: string, url: string): string {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => undefined);
  const dom = new JSDOM(`<!doctype html><html><head><title>bài</title></head><body><article>${fragment}</article></body></html>`, { url, virtualConsole: vc });
  try {
    const doc = dom.window.document;
    let text = '';
    try {
      text = new Readability(doc.cloneNode(true) as Document).parse()?.textContent ?? '';
    } catch {
      /* dùng dự phòng */
    }
    if (wordCount(text) < 150) {
      doc.querySelectorAll('script, style, noscript, iframe, svg').forEach((el) => el.remove());
      text = doc.body?.textContent ?? '';
    }
    return cleanText(text);
  } finally {
    dom.window.close();
  }
}

function fallbackText(doc: Document): string {
  for (const sel of ['script', 'style', 'noscript', 'nav', 'footer', 'header', 'aside', 'form', 'iframe', 'svg', '[role=navigation]', '.menu', '.sidebar', '.comments', '#comments']) {
    doc.querySelectorAll(sel).forEach((el) => el.remove());
  }
  const main = doc.querySelector('article') ?? doc.querySelector('main') ?? doc.body;
  return main?.textContent ?? '';
}

/** Tải trang web thật và trích phần nội dung chính bằng Readability, có dự phòng khi Readability không nhận ra bài. */
export class HtmlPageFetcher implements PageFetcher {
  async fetch(url: string, opts: { maxChars?: number; timeoutMs?: number } = {}): Promise<FetchedPage> {
    const maxChars = opts.maxChars ?? 24_000;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7' },
        redirect: 'follow',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
    } catch (err) {
      throw new TransientError(`Không tải được trang: ${(err as Error).message}`);
    }
    const contentType = res.headers.get('content-type') ?? '';
    const base: FetchedPage = { url, finalUrl: res.url || url, httpStatus: res.status, title: '', text: '', wordCount: 0, language: 'other' };
    if (!res.ok) return base;
    if (!/text\/html|application\/xhtml/i.test(contentType)) return base;
    const html = decodeBody(await res.arrayBuffer(), contentType);
    const vc = new VirtualConsole();
    vc.on('jsdomError', () => undefined);
    const dom = new JSDOM(html, { url: base.finalUrl, virtualConsole: vc });
    try {
      const doc = dom.window.document;
      let title = doc.title ?? '';
      let text = '';
      try {
        const article = new Readability(doc.cloneNode(true) as Document).parse();
        if (article) {
          text = article.textContent ?? '';
          title = article.title || title;
        }
      } catch {
        /* Readability lỗi với vài trang, dùng dự phòng */
      }
      if (wordCount(text) < 150) text = fallbackText(doc);
      if (wordCount(text) < 150) {
        // Trang dựng bằng JavaScript: bài nằm trong script (Next.js, Nuxt, JSON-LD)
        const embedded = extractEmbeddedContent(html);
        if (embedded) {
          const t = embedded.html ? embeddedHtmlToText(embedded.html, base.finalUrl) : cleanText(embedded.text ?? '');
          if (wordCount(t) >= 150) text = t;
        }
      }
      text = cutAtSentence(cleanText(text), maxChars);
      return { ...base, title: title.trim().slice(0, 300), text, wordCount: wordCount(text), language: guessLanguage(text) };
    } finally {
      dom.window.close();
    }
  }
}
