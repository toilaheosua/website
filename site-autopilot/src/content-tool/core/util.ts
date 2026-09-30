import crypto from 'node:crypto';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function nowIso(): string {
  return new Date().toISOString();
}

/** Chuyển tiếng Việt có dấu thành slug ASCII: "Hủ tiếu Nam Vang" -> "hu-tieu-nam-vang". */
export function slugify(input: string, maxLen = 80): string {
  const s = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, maxLen).replace(/-+$/g, '') || 'bai-viet';
}

export function randomHex(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function safeJsonParse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : JSON.stringify(err);
}

/** Thử lại với backoff mũ. `shouldRetry` cho phép bỏ qua lỗi không nên thử lại. */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { attempts?: number; baseMs?: number; maxMs?: number; shouldRetry?: (err: unknown) => boolean } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 800;
  const maxMs = opts.maxMs ?? 15_000;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      if (i === attempts || (opts.shouldRetry && !opts.shouldRetry(err))) break;
      const wait = Math.min(maxMs, baseMs * 2 ** (i - 1)) + Math.random() * 250;
      await sleep(wait);
    }
  }
  throw lastErr;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)).trimEnd() + '…';
}

export function formatDateVi(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
}

export function uniq<T>(arr: readonly T[]): T[] {
  return [...new Set(arr)];
}

/** Tách danh sách nhập tay: mỗi dòng, dấu phẩy hoặc chấm phẩy là một mục. */
export function parseList(text: string | undefined | null): string[] {
  if (!text) return [];
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Lấy tên miền gốc (bỏ www.) từ URL; chuỗi rỗng nếu URL hỏng. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Domain có nằm trong danh sách chặn không (khớp cả subdomain). */
export function domainBlocked(domain: string, blocked: readonly string[]): boolean {
  const d = domain.toLowerCase();
  return blocked.some((b) => {
    const x = b.trim().toLowerCase().replace(/^www\./, '');
    return x && (d === x || d.endsWith('.' + x));
  });
}

/** Chuẩn hóa văn bản tiếng Việt để so khớp: NFC, chữ thường, gộp khoảng trắng. */
export function normText(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Đếm từ: token có chữ hoặc số, bỏ ký tự markdown. Tiếng Việt tính mỗi âm tiết là một từ như các tool SEO. */
export function wordCount(text: string): number {
  return text
    .replace(/[|#*>_`\-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Ước tính chi phí USD từ số token theo bảng giá công khai (USD mỗi 1 triệu token). */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export function estimateUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICES[model] ?? { input: 5, output: 25 };
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
