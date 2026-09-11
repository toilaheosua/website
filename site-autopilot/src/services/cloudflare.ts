import type { CfDnsRecord, CfRule, CfZone, CloudflareClient } from './types.js';
import { httpJson } from '../core/http.js';
import { AppError, ConfigError, TransientError } from '../core/errors.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('cloudflare');
const API = 'https://api.cloudflare.com/client/v4';

interface CfEnvelope<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  messages?: unknown[];
  result: T;
  result_info?: { page: number; per_page: number; total_count: number };
}

/**
 * Cloudflare API v4 qua fetch. Token cần các quyền:
 * Zone-Zone-Edit, Zone-DNS-Edit, Zone-Zone Settings-Edit, Zone-Zone WAF-Edit, Zone-Bot Management-Edit,
 * Account-Account Settings-Read; phạm vi zone: "All zones from an account".
 */
export class CloudflareApi implements CloudflareClient {
  constructor(private readonly token: string, private readonly accountId: string) {
    if (!token) throw new ConfigError('Thiếu CLOUDFLARE_API_TOKEN');
    if (!accountId) throw new ConfigError('Thiếu CLOUDFLARE_ACCOUNT_ID');
  }

  private async call<T>(method: string, path: string, body?: unknown, opts: { allowErrorCodes?: number[] } = {}): Promise<CfEnvelope<T>> {
    const { status, data } = await httpJson<CfEnvelope<T>>(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!data || typeof data !== 'object') throw new TransientError(`Cloudflare trả về dữ liệu lạ (HTTP ${status})`);
    if (!data.success) {
      const errs = data.errors ?? [];
      if (opts.allowErrorCodes && errs.some((e) => opts.allowErrorCodes?.includes(e.code))) return data;
      const msg = errs.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${status}`;
      if (status === 401 || status === 403 || errs.some((e) => e.code === 10000 || e.code === 9109 || e.code === 9106)) {
        throw new AppError(`Cloudflare từ chối quyền (${msg}). Kiểm tra API Token và các quyền: Zone Edit, DNS Edit, Zone Settings Edit, Zone WAF Edit, Bot Management Edit, Cache Purge.`);
      }
      throw new AppError(`Cloudflare API lỗi ở ${method} ${path}: ${msg}`, { details: errs });
    }
    return data;
  }

  async verifyToken(): Promise<{ ok: boolean; message: string }> {
    try {
      const r = await this.call<{ status: string }>('GET', '/user/tokens/verify');
      if (r.result.status !== 'active') return { ok: false, message: `Token ở trạng thái ${r.result.status}` };
      const zones = await this.call<CfZone[]>('GET', `/zones?account.id=${encodeURIComponent(this.accountId)}&per_page=5`);
      return { ok: true, message: `Token hợp lệ, đọc được ${zones.result_info?.total_count ?? zones.result.length} zone trong tài khoản` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  async findZone(name: string): Promise<CfZone | null> {
    const r = await this.call<CfZone[]>('GET', `/zones?name=${encodeURIComponent(name)}&account.id=${encodeURIComponent(this.accountId)}`);
    return r.result.find((z) => z.name === name) ?? null;
  }

  async createZone(name: string): Promise<CfZone> {
    const r = await this.call<CfZone>('POST', '/zones', { name, account: { id: this.accountId }, type: 'full' });
    log.info('Đã tạo zone', { name, id: r.result.id, ns: r.result.name_servers });
    return r.result;
  }

  async getZone(zoneId: string): Promise<CfZone> {
    const r = await this.call<CfZone>('GET', `/zones/${zoneId}`);
    return r.result;
  }

  async triggerActivationCheck(zoneId: string): Promise<void> {
    // Gói Free chỉ cho phép mỗi giờ một lần; lỗi 1224 ("already triggered") không đáng để dừng pipeline.
    await this.call('PUT', `/zones/${zoneId}/activation_check`, undefined, { allowErrorCodes: [1224, 1225] }).catch((err) => {
      log.warn('activation_check không chạy được', { err: (err as Error).message });
    });
  }

  async deleteZone(zoneId: string): Promise<void> {
    await this.call('DELETE', `/zones/${zoneId}`);
  }

  async listDnsRecords(zoneId: string): Promise<CfDnsRecord[]> {
    const r = await this.call<CfDnsRecord[]>('GET', `/zones/${zoneId}/dns_records?per_page=200`);
    return r.result;
  }

  async upsertDnsRecord(zoneId: string, rec: { type: 'A' | 'CNAME' | 'TXT'; name: string; content: string; proxied: boolean; ttl?: number }): Promise<CfDnsRecord> {
    const zone = await this.getZone(zoneId);
    const fqdn = rec.name === '@' || rec.name === zone.name ? zone.name : rec.name.endsWith(zone.name) ? rec.name : `${rec.name}.${zone.name}`;
    const existing = (await this.listDnsRecords(zoneId)).filter((r) => r.name === fqdn && (r.type === rec.type || (rec.type === 'A' && r.type === 'AAAA') || (rec.type === 'CNAME' && r.type === 'A')));
    const body = { type: rec.type, name: fqdn, content: rec.content, proxied: rec.proxied, ttl: rec.ttl ?? 1 };
    const same = existing.find((r) => r.type === rec.type);
    if (same) {
      if (same.content === rec.content && same.proxied === rec.proxied) return same;
      const r = await this.call<CfDnsRecord>('PATCH', `/zones/${zoneId}/dns_records/${same.id}`, body);
      return r.result;
    }
    // Bản ghi khác loại trùng tên (ví dụ AAAA cũ, hoặc A khi ta muốn CNAME) sẽ gây xung đột: xóa trước
    for (const conflict of existing) await this.deleteDnsRecord(zoneId, conflict.id);
    const r = await this.call<CfDnsRecord>('POST', `/zones/${zoneId}/dns_records`, body);
    return r.result;
  }

  async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
    await this.call('DELETE', `/zones/${zoneId}/dns_records/${recordId}`);
  }

  async setZoneSetting(zoneId: string, setting: string, value: unknown): Promise<void> {
    await this.call('PATCH', `/zones/${zoneId}/settings/${setting}`, { value });
  }

  async getZoneSetting(zoneId: string, setting: string): Promise<unknown> {
    const r = await this.call<{ id: string; value: unknown }>('GET', `/zones/${zoneId}/settings/${setting}`);
    return r.result.value;
  }

  async setBotFightMode(zoneId: string, enabled: boolean): Promise<void> {
    await this.call('PUT', `/zones/${zoneId}/bot_management`, { fight_mode: enabled });
  }

  async purgeCache(zoneId: string): Promise<void> {
    await this.call('POST', `/zones/${zoneId}/purge_cache`, { purge_everything: true });
  }

  async getPhaseRules(zoneId: string, phase: 'http_request_firewall_custom' | 'http_ratelimit'): Promise<{ rulesetId: string | null; rules: CfRule[] }> {
    // Chưa có ruleset cho phase -> lỗi 10002/10003 "could not find ruleset"
    const r = await this.call<{ id: string; rules?: CfRule[] }>('GET', `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`, undefined, { allowErrorCodes: [10002, 10003, 10004] });
    if (!r.success || !r.result) return { rulesetId: null, rules: [] };
    return { rulesetId: r.result.id, rules: r.result.rules ?? [] };
  }

  async replacePhaseRules(zoneId: string, phase: 'http_request_firewall_custom' | 'http_ratelimit', rules: CfRule[]): Promise<{ rulesetId: string; rules: CfRule[] }> {
    const payload = rules.map((r) => {
      const base: Record<string, unknown> = { action: r.action, expression: r.expression, description: r.description, enabled: r.enabled };
      if (r.action_parameters) base.action_parameters = r.action_parameters;
      if (r.ratelimit) base.ratelimit = r.ratelimit;
      return base;
    });
    const r = await this.call<{ id: string; rules: CfRule[] }>('PUT', `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`, { rules: payload });
    return { rulesetId: r.result.id, rules: r.result.rules ?? [] };
  }
}
