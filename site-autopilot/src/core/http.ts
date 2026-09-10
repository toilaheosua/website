import { TransientError, AppError } from './errors.js';

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | FormData | URLSearchParams | Uint8Array;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
}

/** fetch có timeout, trả về text; phân loại lỗi mạng và 5xx thành TransientError. */
export async function httpRequest(url: string, opts: HttpOptions = {}): Promise<HttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body as RequestInit['body'],
      signal: controller.signal,
      redirect: 'manual',
    });
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) {
      throw new TransientError(`HTTP ${res.status} từ ${new URL(url).host}: ${text.slice(0, 300)}`, { details: { status: res.status } });
    }
    return { status: res.status, ok: res.ok, headers: res.headers, text };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/abort/i.test(msg)) throw new TransientError(`Hết thời gian chờ khi gọi ${new URL(url).host}`);
    throw new TransientError(`Lỗi mạng khi gọi ${new URL(url).host}: ${msg}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

export async function httpJson<T>(url: string, opts: HttpOptions = {}): Promise<{ status: number; data: T; headers: Headers }> {
  const res = await httpRequest(url, opts);
  let data: T;
  try {
    data = res.text ? (JSON.parse(res.text) as T) : ({} as T);
  } catch {
    throw new AppError(`Phản hồi không phải JSON từ ${new URL(url).host} (HTTP ${res.status}): ${res.text.slice(0, 200)}`);
  }
  return { status: res.status, data, headers: res.headers };
}

export async function downloadBuffer(url: string, timeoutMs = 60_000): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new TransientError(`Tải tệp thất bại (HTTP ${res.status}) từ ${new URL(url).host}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}
