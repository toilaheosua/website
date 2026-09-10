import fs from 'node:fs';
import { JWT } from 'google-auth-library';
import type { GoogleClient } from './types.js';
import { AppError, TransientError } from '../core/errors.js';

const SCOPES = ['https://www.googleapis.com/auth/siteverification', 'https://www.googleapis.com/auth/webmasters'];

/** Kiểm tra nội dung JSON service account, ném AppError với thông báo dễ hiểu nếu sai. */
export function parseServiceAccount(json: string): { client_email: string; private_key: string } {
  let creds: { client_email?: string; private_key?: string; type?: string };
  try {
    creds = JSON.parse(json) as typeof creds;
  } catch {
    throw new AppError('Nội dung service account không phải JSON hợp lệ');
  }
  if (!creds.client_email || !creds.private_key) throw new AppError('JSON service account thiếu client_email hoặc private_key');
  return { client_email: creds.client_email, private_key: creds.private_key };
}

/** Google báo 400 khi chưa thấy thẻ meta trên site: cần chờ rồi thử lại. */
export class VerificationPendingError extends TransientError {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationPendingError';
  }
}

/**
 * Xác minh site bằng thẻ META qua Site Verification API, thêm chủ sở hữu là email của bạn,
 * thêm property vào Search Console và gửi sitemap. Dùng service account, không cần OAuth tương tác.
 */
export class GoogleSearchClient implements GoogleClient {
  private readonly jwt: JWT;
  readonly serviceAccountEmail: string;

  /** Nhận nội dung JSON của service account (chuỗi). Dùng fromFile() nếu có đường dẫn. */
  constructor(serviceAccountJson: string) {
    const creds = parseServiceAccount(serviceAccountJson);
    this.serviceAccountEmail = creds.client_email;
    this.jwt = new JWT({ email: creds.client_email, key: creds.private_key, scopes: SCOPES });
  }

  static fromFile(serviceAccountJsonPath: string): GoogleSearchClient {
    let raw: string;
    try {
      raw = fs.readFileSync(serviceAccountJsonPath, 'utf8');
    } catch {
      throw new AppError(`Không đọc được file service account: ${serviceAccountJsonPath}`);
    }
    return new GoogleSearchClient(raw);
  }

  private async call<T>(method: 'GET' | 'POST' | 'PUT', url: string, data?: unknown): Promise<{ status: number; data: T }> {
    try {
      const res = await this.jwt.request<T>({ url, method, data, validateStatus: () => true });
      if (res.status >= 500 || res.status === 429) throw new TransientError(`Google API HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
      return { status: res.status, data: res.data };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new TransientError(`Lỗi gọi Google API: ${(err as Error).message}`, { cause: err });
    }
  }

  async getMetaToken(siteUrl: string): Promise<string> {
    const { status, data } = await this.call<{ token?: string; error?: { message?: string } }>('POST', 'https://www.googleapis.com/siteVerification/v1/token', {
      site: { type: 'SITE', identifier: siteUrl },
      verificationMethod: 'META',
    });
    if (status !== 200 || !data.token) throw new AppError(`Không lấy được token xác minh Google (HTTP ${status}): ${data.error?.message ?? ''}`);
    return data.token;
  }

  async verifySite(siteUrl: string, owners: string[] = []): Promise<{ id: string }> {
    const { status, data } = await this.call<{ id?: string; error?: { message?: string } }>(
      'POST',
      'https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=META',
      { site: { type: 'SITE', identifier: siteUrl }, ...(owners.length ? { owners } : {}) },
    );
    if (status === 400) throw new VerificationPendingError(`Google chưa thấy thẻ xác minh trên ${siteUrl}: ${data.error?.message ?? ''}`);
    if (status !== 200 || !data.id) throw new AppError(`Xác minh Google thất bại (HTTP ${status}): ${data.error?.message ?? ''}`);
    return { id: data.id };
  }

  async addOwner(resourceId: string, email: string): Promise<void> {
    const get = await this.call<{ id: string; site: unknown; owners: string[] }>('GET', `https://www.googleapis.com/siteVerification/v1/webResource/${encodeURIComponent(resourceId)}`);
    if (get.status !== 200) throw new AppError(`Không đọc được web resource (HTTP ${get.status})`);
    const owners = Array.from(new Set([...(get.data.owners ?? []), email]));
    const put = await this.call('PUT', `https://www.googleapis.com/siteVerification/v1/webResource/${encodeURIComponent(resourceId)}`, { ...get.data, owners });
    if (put.status !== 200) throw new AppError(`Không thêm được chủ sở hữu ${email} (HTTP ${put.status})`);
  }

  async addSearchConsoleProperty(siteUrl: string): Promise<void> {
    const { status, data } = await this.call<{ error?: { message?: string } }>('PUT', `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}`);
    if (status !== 200 && status !== 204) throw new AppError(`Không thêm được property Search Console (HTTP ${status}): ${data?.error?.message ?? ''}`);
  }

  async submitSitemap(siteUrl: string, sitemapUrl: string): Promise<void> {
    const { status, data } = await this.call<{ error?: { message?: string } }>(
      'PUT',
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
    );
    if (status !== 200 && status !== 204) throw new AppError(`Gửi sitemap thất bại (HTTP ${status}): ${data?.error?.message ?? ''}`);
  }
}
