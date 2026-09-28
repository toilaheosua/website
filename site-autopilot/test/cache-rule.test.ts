import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigCache } from '../src/config.js';
import { Db } from '../src/db/index.js';
import { createServices, ensureDefaultServer } from '../src/services/index.js';
import { STEPS } from '../src/core/steps.js';
import { Worker } from '../src/core/worker.js';
import { EntitySchema, SiteBriefSchema, WafSettingsSchema } from '../src/core/types.js';
import { MockCloudflare } from '../src/services/mock.js';
import { createApp } from '../src/web/server.js';
import { buildCacheRule, RULE_TAG, urlsForChangedFiles } from '../src/generator/waf.js';

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-cache-'));
  resetConfigCache();
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('Cache Everything', () => {
  it('rule cache theo cấu hình: cache HTML, edge 1 tháng, browser 1 giờ, apex và www', () => {
    const settings = WafSettingsSchema.parse({});
    expect(settings.cache).toEqual({ enabled: true, browserTtl: 3600, edgeTtl: 2_592_000 });
    const r = buildCacheRule(settings, 'hutieuonggiao.com');
    expect(r.action).toBe('set_cache_settings');
    expect(r.expression).toBe('(http.host eq "hutieuonggiao.com") or (http.host eq "www.hutieuonggiao.com")');
    expect(r.description.startsWith(RULE_TAG)).toBe(true);
    expect(r.action_parameters).toEqual({ cache: true, edge_ttl: { mode: 'override_origin', default: 2_592_000 }, browser_ttl: { mode: 'override_origin', default: 3600 } });
  });

  it('URL cần xóa cache từ tệp thay đổi', () => {
    const urls = urlsForChangedFiles('a.com', ['index.html', 'blog/bai-moi/index.html', 'sitemap.xml', 'assets/css/style.css']);
    expect(urls).toEqual(['https://a.com/', 'https://www.a.com/', 'https://a.com/blog/bai-moi/', 'https://www.a.com/blog/bai-moi/', 'https://a.com/sitemap.xml', 'https://www.a.com/sitemap.xml', 'https://a.com/assets/css/style.css', 'https://www.a.com/assets/css/style.css']);
  });

  it('pipeline cài rule cache; sửa một trang thì chỉ xóa cache URL liên quan', async () => {
    const config = loadConfig({ MOCK_MODE: '1', DATA_DIR: tmp, WORKER_CONCURRENCY: '6', ADMIN_PASSWORD: 'x', NS_POLL_INTERVAL_MIN: '0', REBUILD_DEBOUNCE_SEC: '0' });
    const db = new Db(':memory:');
    const services = createServices(config, db);
    const cf = services.cloudflare as MockCloudflare;
    cf.activateAfterPolls = 1;
    ensureDefaultServer(config, db);
    const brief = SiteBriefSchema.parse({ brandName: 'Hủ Tiếu Ông Giáo', industry: 'Quán ăn', location: 'Phan Rang', services: ['Hủ tiếu'], keywords: ['hủ tiếu'], postsCount: 1, targetCountries: ['VN'] });
    const id = db.createSite({ domain: 'cache.test', server_id: db.listServers()[0]!.id, brief, entity: EntitySchema.parse({ type: 'Restaurant', name: 'Hủ Tiếu Ông Giáo' }) });
    db.ensureSteps(id, STEPS.map((s) => s.id));
    const worker = new Worker({ db, config, services, steps: STEPS });
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await worker.tick();
      await worker.drain(30_000);
      const st = db.getSite(id)!.status;
      if (st === 'live' || st === 'error') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const site = db.getSite(id)!;
    expect(site.status).toBe('live');
    const zone = cf.zones.get(site.cf_zone_id!)!;
    const cacheRules = zone.rules['http_request_cache_settings'] ?? [];
    expect(cacheRules).toHaveLength(1);
    expect(cacheRules[0]!.action).toBe('set_cache_settings');
    expect(site.cf_ruleset_ids.cache).toBe('rs_http_request_cache_settings');
    const step = db.listSteps(id).find((s) => s.step === 'cf_settings')!;
    expect(step.message).toContain('Cache Everything');

    // Lần deploy đầu: tải toàn bộ nên xóa cache toàn zone; sau đó chỉ URL đổi
    cf.purged = [];
    cf.purgedAll = 0;
    const app = createApp({ db, config, services, worker, steps: STEPS });
    const login = await app.request('/login', { method: 'POST', body: new URLSearchParams({ user: 'admin', password: 'x', next: '/' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    const about = db.listPages(id).find((p) => p.kind === 'about')!;
    const res = await app.request(`/sites/${id}/pages/${about.id}/meta`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ title: 'Giới thiệu mới về quán hủ tiếu Ông Giáo', metaDescription: about.content.metaDescription, h1: 'Giới thiệu mới', targetKeyword: '', heroImageAlt: '' }) });
    expect(res.status).toBe(302);
    await worker.tick();
    await worker.drain(30_000);
    expect(cf.purgedAll).toBe(0);
    expect(cf.purged).toContain('https://cache.test/gioi-thieu/');
    expect(cf.purged).toContain('https://www.cache.test/gioi-thieu/');
    // sitemap không đổi (cùng ngày cập nhật) nên không bị xóa cache: chỉ đúng tệp đổi
    expect(cf.purged).toHaveLength(2);
    expect(cf.purged).not.toContain('https://cache.test/lien-he/');
    const log = db.listLogs({ siteId: id, limit: 30 }).find((l) => /xóa bộ đệm Cloudflare cho/i.test(l.message));
    expect(log).toBeDefined();

    // Tắt cache trong cài đặt rồi đồng bộ: rule hệ thống bị gỡ
    const off = await app.request('/settings/waf', { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ skipVerifiedBots: '1', geoBlockEnabled: '1', allowedCountries: 'VN', blockQueryStrings: '1', allowedQueryTerms: 'post', blockedPaths: '/xmlrpc.php', requestsPerPeriod: '100', cacheEnabled: '0', cacheBrowserTtl: '3600', cacheEdgeTtl: '2592000' }) });
    expect(off.status).toBe(302);
    expect(db.getWafSettings().cache.enabled).toBe(false);
    db.enqueueJob('sync_waf', id, null, { maxAttempts: 1 });
    await worker.tick();
    await worker.drain(30_000);
    expect(cf.zones.get(site.cf_zone_id!)!.rules['http_request_cache_settings']).toHaveLength(0);
  }, 120000);
});
