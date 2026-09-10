import http from 'node:http';
import https from 'node:https';
import type { AapanelClient, PanelSite } from './types.js';
import { AppError, ConfigError, TransientError } from '../core/errors.js';
import { createLogger } from '../core/logger.js';
import { md5 } from '../core/util.js';

const log = createLogger('aapanel');

/**
 * aaPanel API v1: POST form-urlencoded tới http(s)://IP:PORT/<module>?action=<Action>
 * với request_time (giây) và request_token = md5(request_time + md5(api_key)).
 * Panel thường dùng chứng chỉ tự ký nên bỏ kiểm tra TLS riêng cho host này.
 * Yêu cầu: bật API trong Settings > API và thêm IP máy chạy dashboard vào IP whitelist.
 */
export class AapanelApi implements AapanelClient {
  private readonly base: URL;

  constructor(panelUrl: string, private readonly apiKey: string) {
    if (!panelUrl) throw new ConfigError('Thiếu AAPANEL_URL');
    if (!apiKey) throw new ConfigError('Thiếu AAPANEL_API_KEY');
    this.base = new URL(panelUrl.replace(/\/+$/, ''));
  }

  private signed(): Record<string, string> {
    const requestTime = String(Math.floor(Date.now() / 1000));
    return { request_time: requestTime, request_token: md5(requestTime + md5(this.apiKey)) };
  }

  private post<T>(pathWithAction: string, fields: Record<string, string> = {}): Promise<T> {
    const body = new URLSearchParams({ ...this.signed(), ...fields }).toString();
    const isHttps = this.base.protocol === 'https:';
    const opts: https.RequestOptions = {
      method: 'POST',
      hostname: this.base.hostname,
      port: this.base.port || (isHttps ? 443 : 80),
      path: pathWithAction,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'site-autopilot/1.0' },
      rejectUnauthorized: false,
      timeout: 60_000,
    };
    return new Promise<T>((resolve, reject) => {
      const req = (isHttps ? https : http).request(opts, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 500) return reject(new TransientError(`aaPanel HTTP ${res.statusCode}`));
          const trimmed = text.trim();
          if (trimmed.startsWith('<') || trimmed.includes('<html')) {
            return reject(new AppError('aaPanel trả về trang HTML thay vì JSON: API chưa được bật, hoặc URL/cổng sai, hoặc thiếu request_token. Vào Settings > API để bật và thêm IP whitelist.'));
          }
          try {
            let parsed = JSON.parse(trimmed) as unknown;
            // API v2 bọc kết quả trong {status, timestamp, message}
            if (parsed && typeof parsed === 'object' && 'timestamp' in parsed && 'message' in parsed) {
              const env = parsed as unknown as { status: number; message: unknown };
              if (env.status !== 0 && typeof env.message === 'object' && env.message && 'result' in env.message) {
                return reject(new AppError(`aaPanel: ${(env.message as { result: string }).result}`));
              }
              parsed = env.message;
            }
            resolve(parsed as T);
          } catch {
            reject(new AppError(`aaPanel trả về dữ liệu không đọc được: ${trimmed.slice(0, 200)}`));
          }
        });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (err) => reject(new TransientError(`Không kết nối được aaPanel tại ${this.base.host}: ${err.message}`, { cause: err })));
      req.write(body);
      req.end();
    });
  }

  private static assertOk(res: unknown, context: string): void {
    if (res && typeof res === 'object' && 'status' in res && (res as { status: unknown }).status === false) {
      const msg = (res as { msg?: string }).msg ?? 'không rõ lỗi';
      if (/IP validation|IP verification/i.test(msg)) throw new AppError(`aaPanel từ chối IP của máy chạy dashboard: ${msg}. Thêm IP này vào whitelist trong Settings > API.`);
      if (/Secret key|verification failures/i.test(msg)) throw new AppError(`aaPanel từ chối API key: ${msg}`);
      throw new AppError(`aaPanel ${context}: ${msg}`);
    }
  }

  async ping(): Promise<{ ok: boolean; message: string }> {
    try {
      const versions = await this.phpVersions();
      return { ok: true, message: `Kết nối aaPanel OK, PHP: ${versions.map((v) => v.name).join(', ')}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  async phpVersions(): Promise<{ version: string; name: string }[]> {
    const res = await this.post<unknown>('/site?action=GetPHPVersion');
    AapanelApi.assertOk(res, 'GetPHPVersion');
    return Array.isArray(res) ? (res as { version: string; name: string }[]) : [];
  }

  async findSite(domain: string): Promise<PanelSite | null> {
    const res = await this.post<{ data?: { id: number; name: string; path: string; status: string; ps: string }[] }>('/data?action=getData', {
      table: 'sites',
      limit: '50',
      p: '1',
      search: domain,
      order: 'id desc',
      type: '-1',
    });
    AapanelApi.assertOk(res, 'getData');
    const rows = res.data ?? [];
    const hit = rows.find((r) => r.name === domain) ?? rows.find((r) => r.name === `www.${domain}`);
    return hit ? { id: Number(hit.id), name: hit.name, path: hit.path, status: String(hit.status), ps: hit.ps ?? '' } : null;
  }

  async addSite(input: { domain: string; extraDomains: string[]; path: string; phpVersion: string; remark: string }): Promise<PanelSite> {
    const webname = JSON.stringify({ domain: input.domain, domainlist: input.extraDomains, count: input.extraDomains.length });
    const res = await this.post<{ siteStatus?: boolean; siteId?: number; status?: boolean; msg?: string }>('/site?action=AddSite', {
      webname,
      path: input.path,
      type_id: '0',
      type: 'PHP',
      version: input.phpVersion || '00',
      port: '80',
      ps: input.remark,
      ftp: 'false',
      sql: 'false',
      codeing: 'utf8',
      set_ssl: '0',
      force_ssl: '0',
    });
    AapanelApi.assertOk(res, 'AddSite');
    if (!res.siteStatus) throw new AppError(`aaPanel AddSite không thành công: ${JSON.stringify(res).slice(0, 300)}`);
    log.info('Đã thêm site vào aaPanel', { domain: input.domain, id: res.siteId });
    const found = await this.findSite(input.domain);
    return found ?? { id: Number(res.siteId ?? 0), name: input.domain, path: input.path, status: '1', ps: input.remark };
  }

  async deleteSite(site: PanelSite): Promise<void> {
    const res = await this.post<{ status?: boolean; msg?: string }>('/site?action=DeleteSite', { id: String(site.id), webname: site.name, path: '1' });
    AapanelApi.assertOk(res, 'DeleteSite');
  }
}
