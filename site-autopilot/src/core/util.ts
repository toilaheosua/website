import crypto from 'node:crypto';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoAfter(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

/** Chuyển tiếng Việt có dấu thành slug ASCII: "Dịch vụ Điện lạnh" -> "dich-vu-dien-lanh". */
export function slugify(input: string, maxLen = 80): string {
  const s = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, maxLen).replace(/-+$/g, '') || 'trang';
}

/** Chuẩn hóa domain: bỏ protocol, www, khoảng trắng, dấu "/" cuối. */
export function normalizeDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  d = d.replace(/^www\./, '');
  return d;
}

export function isValidDomain(d: string): boolean {
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d);
}

export function randomHex(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function md5(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex');
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function pick<T>(arr: readonly T[], seed?: number): T {
  if (arr.length === 0) throw new Error('pick: empty array');
  const idx = seed === undefined ? Math.floor(Math.random() * arr.length) : Math.abs(seed) % arr.length;
  return arr[idx] as T;
}

export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

export function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

export function parseList(text: string | undefined | null): string[] {
  if (!text) return [];
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isPrivateOrLocalIp(ip: string): boolean {
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost$|::1$)/.test(ip);
}
