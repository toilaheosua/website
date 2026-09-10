import { describe, expect, it } from 'vitest';
import { WafSettingsSchema } from '../src/core/types.js';
import { buildCustomRules, buildRateLimitRule, mergeRules, RULE_TAG } from '../src/generator/waf.js';

describe('WAF rules', () => {
  const settings = WafSettingsSchema.parse({});

  it('tạo đúng 3 rule theo cấu hình đã chốt', () => {
    const rules = buildCustomRules({ settings });
    expect(rules).toHaveLength(3);

    expect(rules[0]).toEqual({
      action: 'skip',
      description: `${RULE_TAG} 1. Skip Bot`,
      enabled: true,
      expression: '(cf.client.bot)',
      action_parameters: {
        ruleset: 'current',
        phases: ['http_ratelimit', 'http_request_firewall_managed', 'http_request_sbfm'],
        products: ['zoneLockdown', 'uaBlock', 'bic', 'hot', 'securityLevel', 'rateLimit', 'waf'],
      },
    });

    expect(rules[1]?.action).toBe('block');
    expect(rules[1]?.expression).toBe('(ip.src.country ne "VN")');

    expect(rules[2]?.action).toBe('block');
    expect(rules[2]?.expression).toBe(
      '(http.request.uri contains "/?" and not http.request.uri.query contains "post" and not http.request.uri.query contains "utm" and not http.request.uri.query contains "hl=vi-VN" and not http.request.uri.query contains "ver=" and not http.request.uri.query contains "customize") or (http.request.uri.path contains "/xmlrpc.php") or (http.request.uri.path contains "/wp-cron.php")',
    );
    for (const r of rules) expect(r.description.startsWith(RULE_TAG)).toBe(true);
  });

  it('miễn IP server khỏi rule chặn quốc tế, nhiều quốc gia dùng dạng in', () => {
    const one = buildCustomRules({ settings, exemptIps: ['169.58.153.3', 'không-phải-ip'] });
    expect(one[1]?.expression).toBe('(ip.src.country ne "VN") and (not ip.src in {169.58.153.3})');
    const many = buildCustomRules({ settings, allowedCountries: ['vn', 'sg'] });
    expect(many[1]?.expression).toBe('(not ip.src.country in {"VN" "SG"})');
  });

  it('tắt từng rule qua cài đặt', () => {
    expect(buildCustomRules({ settings: { ...settings, skipVerifiedBots: false } })).toHaveLength(2);
    expect(buildCustomRules({ settings: { ...settings, geoBlockEnabled: false } })).toHaveLength(2);
    const noQuery = buildCustomRules({ settings: { ...settings, blockQueryStrings: false } });
    expect(noQuery[2]?.expression).toBe('(http.request.uri.path contains "/xmlrpc.php") or (http.request.uri.path contains "/wp-cron.php")');
    expect(buildCustomRules({ settings: { ...settings, blockQueryStrings: false, blockedPaths: [] } })).toHaveLength(2);
  });

  it('rate limit 100 request / 10 giây, chặn 10 giây, đếm theo IP', () => {
    const r = buildRateLimitRule(settings);
    expect(r.description).toBe(`${RULE_TAG} a. rate 100`);
    expect(r.expression).toBe('(starts_with(http.request.uri.path, "/"))');
    expect(r.action).toBe('block');
    expect(r.ratelimit).toEqual({ characteristics: ['ip.src', 'cf.colo.id'], period: 10, requests_per_period: 100, mitigation_timeout: 10 });
  });

  it('giữ rule người dùng tự thêm trong giới hạn 5', () => {
    const ours = buildCustomRules({ settings });
    const existing = [
      { action: 'block', expression: 'a', description: 'Rule riêng 1', enabled: true },
      { action: 'block', expression: 'b', description: `${RULE_TAG} cũ`, enabled: true },
      { action: 'block', expression: 'c', description: 'Rule riêng 2', enabled: true },
      { action: 'block', expression: 'd', description: 'Rule riêng 3', enabled: true },
    ];
    const { rules, dropped } = mergeRules(existing, ours, 5);
    expect(rules).toHaveLength(5);
    expect(rules.slice(0, 3)).toEqual(ours);
    expect(rules[3]?.description).toBe('Rule riêng 1');
    expect(dropped).toEqual(['Rule riêng 3']);
  });
});
