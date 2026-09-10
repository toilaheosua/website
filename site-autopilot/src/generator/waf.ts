import type { WafSettings } from '../core/types.js';
import type { CfRule } from '../services/types.js';

export const RULE_TAG = '[autopilot]';

function q(s: string): string {
  return `"${s.replace(/["\\]/g, '')}"`;
}

function isIpOrCidr(s: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(s) || /^[0-9a-f:]+(\/\d{1,3})?$/i.test(s);
}

export interface WafInput {
  settings: WafSettings;
  /** Ghi đè theo site (quốc gia mục tiêu trong brief) */
  allowedCountries?: string[];
  /** IP không bị rule chặn quốc tế, ví dụ IP của chính server để health check và verify_live chạy được */
  exemptIps?: string[];
}

/** Các phase và sản phẩm mà rule 1 bỏ qua cho bot đã xác minh (Googlebot, Bingbot, ...). */
export const SKIP_BOT_ACTION_PARAMETERS = {
  ruleset: 'current',
  phases: ['http_ratelimit', 'http_request_firewall_managed', 'http_request_sbfm'],
  products: ['zoneLockdown', 'uaBlock', 'bic', 'hot', 'securityLevel', 'rateLimit', 'waf'],
} as const;

/**
 * 3 rule WAF mặc định cho gói Free (tối đa 5 custom rule):
 * 1. Skip Bot: bot đã xác minh bỏ qua mọi rule còn lại, rate limit, WAF managed và Super Bot Fight Mode.
 * 2. Chặn quốc tế: chặn mọi truy cập ngoài quốc gia mục tiêu (mặc định VN), trừ IP server.
 * 3. Chặn /? phiên bản 7: chặn URL có query string trừ vài tham số hợp lệ, cùng xmlrpc.php và wp-cron.php.
 */
export function buildCustomRules(input: WafInput): CfRule[] {
  const { settings } = input;
  const rules: CfRule[] = [];

  if (settings.skipVerifiedBots) {
    rules.push({
      action: 'skip',
      description: `${RULE_TAG} 1. Skip Bot`,
      enabled: true,
      expression: '(cf.client.bot)',
      action_parameters: { ruleset: SKIP_BOT_ACTION_PARAMETERS.ruleset, phases: [...SKIP_BOT_ACTION_PARAMETERS.phases], products: [...SKIP_BOT_ACTION_PARAMETERS.products] },
    });
  }

  const countries = (input.allowedCountries?.length ? input.allowedCountries : settings.allowedCountries).map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  if (settings.geoBlockEnabled && countries.length) {
    const geo = countries.length === 1 ? `(ip.src.country ne ${q(countries[0] as string)})` : `(not ip.src.country in {${countries.map(q).join(' ')}})`;
    const exempt = (input.exemptIps ?? []).map((s) => s.trim()).filter(isIpOrCidr);
    rules.push({
      action: 'block',
      description: `${RULE_TAG} 2. Chặn quốc tế (ngoài ${countries.join(', ')})`,
      enabled: true,
      expression: exempt.length ? `${geo} and (not ip.src in {${exempt.join(' ')}})` : geo,
    });
  }

  const parts: string[] = [];
  if (settings.blockQueryStrings) {
    const terms = settings.allowedQueryTerms.map((t) => t.trim()).filter(Boolean);
    parts.push(`(http.request.uri contains "/?"${terms.map((t) => ` and not http.request.uri.query contains ${q(t)}`).join('')})`);
  }
  for (const p of settings.blockedPaths.map((s) => s.trim()).filter(Boolean)) parts.push(`(http.request.uri.path contains ${q(p)})`);
  if (parts.length) {
    rules.push({
      action: 'block',
      description: `${RULE_TAG} 3. Chặn /? phiên bản 7`,
      enabled: true,
      expression: parts.join(' or '),
    });
  }
  return rules;
}

/**
 * 1 rule rate limit gói Free: đếm theo IP (cf.colo.id bắt buộc kèm theo), chu kỳ 10 giây, chặn 10 giây.
 * Bot đã xác minh đã được rule 1 cho bỏ qua phase http_ratelimit.
 */
export function buildRateLimitRule(settings: WafSettings): CfRule {
  const rl = settings.rateLimit;
  return {
    action: 'block',
    description: `${RULE_TAG} a. rate ${rl.requestsPerPeriod}`,
    enabled: true,
    expression: '(starts_with(http.request.uri.path, "/"))',
    ratelimit: {
      characteristics: ['ip.src', 'cf.colo.id'],
      period: rl.period,
      requests_per_period: rl.requestsPerPeriod,
      mitigation_timeout: rl.mitigationTimeout,
    },
  };
}

/** Gộp rule của hệ thống với rule người dùng tự thêm trên Cloudflare (không mang tag). Rule hệ thống đứng trước. */
export function mergeRules(existing: CfRule[], ours: CfRule[], maxRules: number): { rules: CfRule[]; dropped: string[] } {
  const foreign = existing.filter((r) => !(r.description ?? '').startsWith(RULE_TAG));
  const dropped: string[] = [];
  const room = Math.max(0, maxRules - ours.length);
  const kept = foreign.slice(0, room);
  for (const f of foreign.slice(room)) dropped.push(f.description ?? f.expression);
  return { rules: [...ours, ...kept], dropped };
}
