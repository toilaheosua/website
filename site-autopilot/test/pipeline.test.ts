import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigCache } from '../src/config.js';
import { Db } from '../src/db/index.js';
import { createServices, ensureDefaultServer } from '../src/services/index.js';
import { STEPS } from '../src/core/steps.js';
import { Worker } from '../src/core/worker.js';
import { deriveSiteStatus, dependentsOf, progressOf, runnableSteps } from '../src/core/pipeline.js';
import { EntitySchema, SiteBriefSchema } from '../src/core/types.js';
import { MockCloudflare } from '../src/services/mock.js';
import { createApp } from '../src/web/server.js';

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-test-'));
  resetConfigCache();
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('DAG', () => {
  it('dependentsOf trả về bước và mọi bước phụ thuộc theo thứ tự', () => {
    expect(dependentsOf(STEPS, 'build')).toEqual(['build', 'deploy', 'verify_live', 'gsc_verify', 'gsc_sitemap', 'indexnow', 'live']);
    expect(dependentsOf(STEPS, 'cf_settings')).toEqual(['cf_settings', 'cf_waf', 'cf_ratelimit', 'verify_live', 'gsc_verify', 'gsc_sitemap', 'indexnow', 'live']);
  });

  it('runnableSteps chỉ trả về bước không có phụ thuộc lúc đầu', () => {
    const rows = STEPS.map((s) => ({ site_id: 1, step: s.id, status: 'pending' as const, attempts: 0, next_run_at: null, started_at: null, finished_at: null, message: null, error: null, output: null }));
    const ids = runnableSteps(STEPS, rows, new Date().toISOString()).map((s) => s.id);
    expect(ids).toEqual(['cf_zone', 'host_site', 'gen_plan']);
  });

  it('deriveSiteStatus', () => {
    const rows = STEPS.map((s) => ({ site_id: 1, step: s.id, status: 'done' as const, attempts: 1, next_run_at: null, started_at: null, finished_at: null, message: null, error: null, output: null }));
    expect(deriveSiteStatus(STEPS, rows, 'building')).toBe('live');
    const wait = rows.map((r) => (r.step === 'cf_wait_active' ? { ...r, status: 'waiting' as const } : r));
    expect(deriveSiteStatus(STEPS, wait, 'building')).toBe('waiting_ns');
    const failed = rows.map((r) => (r.step === 'cf_dns' ? { ...r, status: 'failed' as const, attempts: 3 } : r));
    expect(deriveSiteStatus(STEPS, failed, 'building')).toBe('error');
  });
});

describe('pipeline end-to-end (mock)', () => {
  it('chạy toàn bộ từ tạo site đến live và dựng ra website hoàn chỉnh', async () => {
    const config = loadConfig({ MOCK_MODE: '1', DATA_DIR: tmp, WORKER_CONCURRENCY: '6', ADMIN_PASSWORD: 'x', NS_POLL_INTERVAL_MIN: '0', REBUILD_DEBOUNCE_SEC: '0' });
    const db = new Db(':memory:');
    const services = createServices(config, db);
    (services.cloudflare as MockCloudflare).activateAfterPolls = 2;
    ensureDefaultServer(config, db);
    const server = db.listServers()[0];
    expect(server).toBeDefined();

    const brief = SiteBriefSchema.parse({ brandName: 'Điện lạnh Minh', industry: 'Sửa chữa điện lạnh', location: 'Quận 7, TP.HCM', services: ['Sửa máy lạnh', 'Vệ sinh máy lạnh'], keywords: ['sửa máy lạnh quận 7'], postsCount: 3, targetCountries: ['VN'] });
    const entity = EntitySchema.parse({ type: 'LocalBusiness', name: 'Điện lạnh Minh', telephone: '0909 123 456', address: { streetAddress: '12 Nguyễn Văn Linh', addressLocality: 'Quận 7' }, sameAs: { facebook: 'https://facebook.com/dienlanhminh' }, author: { name: 'Nguyễn Văn Minh', jobTitle: 'Kỹ thuật viên trưởng' } });
    const id = db.createSite({ domain: 'dienlanhminh.com', server_id: server!.id, brief, entity });
    db.ensureSteps(id, STEPS.map((s) => s.id));

    const worker = new Worker({ db, config, services, steps: STEPS });
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await worker.tick();
      await worker.drain(30_000);
      const s = db.getSite(id)!;
      if (s.status === 'live' || s.status === 'error') break;
      // next_run_at của bước waiting có thể ở tương lai (0 phút => ngay lập tức)
      await new Promise((r) => setTimeout(r, 50));
    }
    const site = db.getSite(id)!;
    const steps = db.listSteps(id);
    const failed = steps.filter((s) => s.status === 'failed');
    expect(failed.map((f) => `${f.step}: ${f.error}`)).toEqual([]);
    expect(site.status).toBe('live');
    expect(progressOf(STEPS, steps).percent).toBe(100);
    expect(site.cf_zone_id).toBeTruthy();
    expect(site.cf_name_servers).toHaveLength(2);
    expect(site.panel_site_id).toBe(1);
    expect(site.plan?.posts).toHaveLength(3);

    const pages = db.listPages(id);
    expect(pages.map((p) => p.kind).sort()).toEqual(['about', 'blog', 'contact', 'home', 'post', 'post', 'post', 'privacy', 'services'].sort());

    // Cloudflare mock nhận đủ cấu hình
    const cf = services.cloudflare as MockCloudflare;
    const zone = [...cf.zones.values()][0]!;
    expect(zone.dns.map((d) => `${d.type} ${d.name} ${d.content} ${d.proxied}`)).toEqual(['A dienlanhminh.com 203.0.113.10 true', 'CNAME www.dienlanhminh.com dienlanhminh.com true']);
    expect(zone.settings.ssl).toBe('flexible');
    expect(zone.settings.always_use_https).toBe('on');
    expect(zone.botFight).toBe(true);
    expect(zone.rules.http_request_firewall_custom).toHaveLength(3);
    expect(zone.rules.http_ratelimit).toHaveLength(1);

    // Bản dựng
    const out = path.join(tmp, 'sites', 'dienlanhminh.com', 'out');
    const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(home).toContain('<!DOCTYPE html>');
    expect(home).toContain('name="generator" content="site-autopilot"');
    expect(home).toContain('application/ld+json');
    expect(home).toContain('"LocalBusiness"');
    expect(home).toContain('0909 123 456');
    expect(home).toContain('rel="canonical" href="https://dienlanhminh.com/"');
    expect(fs.existsSync(path.join(out, 'gioi-thieu', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'dich-vu', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'lien-he', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'chinh-sach-bao-mat', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'favicon.ico'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'assets', 'brand', 'og-default.png'))).toBe(true);
    const sitemap = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
    expect((sitemap.match(/<url>/g) ?? []).length).toBe(pages.length);
    expect(fs.readFileSync(path.join(out, 'robots.txt'), 'utf8')).toContain('Sitemap: https://dienlanhminh.com/sitemap.xml');
    expect(fs.existsSync(path.join(out, `${site.indexnow_key}.txt`))).toBe(true);
    const post = pages.find((p) => p.kind === 'post')!;
    const postHtml = fs.readFileSync(path.join(out, ...post.slug.split('/'), 'index.html'), 'utf8');
    expect(postHtml).toContain('"BlogPosting"');
    expect(postHtml).toContain('"BreadcrumbList"');
    expect(postHtml).toMatch(/src="\/assets\/img\/post-/);
    // Kỹ thuật giữ chân: tóm tắt nhanh, mục lục, callout, bảng, liên kết nội bộ hợp lệ
    expect(postHtml).toContain('class="takeaways"');
    expect(postHtml).toContain('class="toc"');
    expect(postHtml).toContain('<blockquote>');
    expect(postHtml).toContain('<table>');
    expect(postHtml).toContain('href="/dich-vu/"');
    expect(site.plan?.contentStyle).toBe('playbook');
    const imgs = db.listImages(id);
    expect(imgs.length).toBeGreaterThan(5);
    expect(fs.existsSync(path.join(out, imgs[0]!.file))).toBe(true);

    // Deploy giả lập
    const deployed = path.join(tmp, 'mock-deploy', 'www', 'wwwroot', 'dienlanhminh.com', 'index.html');
    expect(fs.existsSync(deployed)).toBe(true);

    // Dashboard trả lời
    const app = createApp({ db, config, services, worker, steps: STEPS });
    const login = await app.request('/login', { method: 'POST', body: new URLSearchParams({ user: 'admin', password: 'x', next: '/' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(login.status).toBe(302);
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    const home2 = await app.request('/', { headers: { cookie } });
    expect(home2.status).toBe(200);
    expect(await home2.text()).toContain('dienlanhminh.com');
    const detail = await app.request(`/sites/${id}`, { headers: { cookie } });
    expect(await detail.text()).toContain('Hoàn tất');
    const preview = await app.request(`/sites/${id}/preview/`, { headers: { cookie } });
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain(`/sites/${id}/preview/assets/css/style.css`);
    const noauth = await app.request('/');
    expect(noauth.status).toBe(302);
    db.close();
  });
});
