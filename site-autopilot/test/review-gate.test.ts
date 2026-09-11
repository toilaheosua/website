import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigCache } from '../src/config.js';
import { Db } from '../src/db/index.js';
import { createServices, ensureDefaultServer } from '../src/services/index.js';
import { STEPS } from '../src/core/steps.js';
import { Worker } from '../src/core/worker.js';
import { EntitySchema, SiteBriefSchema } from '../src/core/types.js';
import { MockCloudflare } from '../src/services/mock.js';
import { createApp } from '../src/web/server.js';

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-gate-'));
  resetConfigCache();
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function runToEnd(worker: Worker, db: Db, id: number) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await worker.tick();
    await worker.drain(30_000);
    const st = db.getSite(id)!.status;
    if (st === 'live' || st === 'error') break;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('cổng kiểm duyệt chất lượng (mock)', () => {
  it('bài không đạt bị giữ lại, site vẫn live không có bài đó; duyệt tay thì bài được dựng', async () => {
    const config = loadConfig({ MOCK_MODE: '1', DATA_DIR: tmp, WORKER_CONCURRENCY: '6', ADMIN_PASSWORD: 'x', NS_POLL_INTERVAL_MIN: '0' });
    const db = new Db(':memory:');
    const services = createServices(config, db);
    (services.cloudflare as MockCloudflare).activateAfterPolls = 1;
    // Bài blog đầu tiên bị đánh dấu để AI mock từ chối
    const origGenerate = services.content.generatePage.bind(services.content);
    services.content.generatePage = async (input) => {
      const page = await origGenerate(input);
      if (input.kind === 'post' && input.post?.slug?.startsWith('1-')) page.intro = `MOCK_BAD ${page.intro}`;
      return page;
    };
    ensureDefaultServer(config, db);
    const server = db.listServers()[0]!;
    const brief = SiteBriefSchema.parse({ brandName: 'Tiệm Bánh Hoa', industry: 'Tiệm bánh', location: 'Phan Rang', services: ['Bánh kem'], keywords: ['bánh kem phan rang'], postsCount: 2, targetCountries: ['VN'] });
    const id = db.createSite({ domain: 'banhhoa.com', server_id: server.id, brief, entity: EntitySchema.parse({ type: 'LocalBusiness', name: 'Tiệm Bánh Hoa' }) });
    db.ensureSteps(id, STEPS.map((s) => s.id));
    const worker = new Worker({ db, config, services, steps: STEPS });
    await runToEnd(worker, db, id);

    expect(db.getSite(id)?.status).toBe('live');
    const held = db.listPagesNeedingReview(id);
    expect(held).toHaveLength(1);
    expect(held[0]!.kind).toBe('post');
    expect(held[0]!.review?.pass).toBe(false);
    expect(held[0]!.review?.issues.some((i) => i.severity === 'major')).toBe(true);
    // Các trang đạt có biên bản kiểm duyệt
    const home = db.listPages(id).find((p) => p.kind === 'home')!;
    expect(home.status).toBe('published');
    expect(home.review?.pass).toBe(true);
    expect(home.review?.approvedBy).toBe('auto');
    // Bản dựng không chứa bài bị giữ, sitemap cũng không
    const outDir = path.join(config.sitesDir, 'banhhoa.com', 'out');
    expect(fs.existsSync(path.join(outDir, ...held[0]!.slug.split('/'), 'index.html'))).toBe(false);
    expect(fs.readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8')).not.toContain(`/${held[0]!.slug}/`);
    const genStep = db.listSteps(id).find((s) => s.step === 'gen_content')!;
    expect(genStep.message).toMatch(/1 trang chưa đạt kiểm duyệt/);

    // Dashboard: danh sách trang hiện "Chưa đạt", duyệt tay → published + dựng lại
    const app = createApp({ db, config, services, worker, steps: STEPS });
    const login = await app.request('/login', { method: 'POST', body: new URLSearchParams({ user: 'admin', password: 'x', next: '/' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    const list = await (await app.request(`/sites/${id}/pages`, { headers: { cookie } })).text();
    expect(list).toContain('Chưa đạt (1 lỗi)');
    expect(list).toContain('Duyệt và đăng');
    const detail = await (await app.request(`/sites/${id}/pages/${held[0]!.id}`, { headers: { cookie } })).text();
    expect(detail).toContain('Lỗi cần sửa trước khi đăng');
    expect(detail).toContain('MOCK_BAD');

    const approve = await app.request(`/sites/${id}/pages/${held[0]!.id}/approve`, { method: 'POST', headers: { cookie } });
    expect(approve.status).toBe(302);
    const approved = db.getPage(held[0]!.id)!;
    expect(approved.status).toBe('published');
    expect(approved.review?.approvedBy).toBe('user');
    expect(db.listJobs().some((j) => j.type === 'rebuild_deploy' && j.site_id === id && j.status === 'queued')).toBe(true);
    await worker.tick();
    await worker.drain(30_000);
    expect(fs.existsSync(path.join(outDir, ...approved.slug.split('/'), 'index.html'))).toBe(true);
  }, 120000);

  it('trang chủ không đạt thì bước dựng báo lỗi rõ ràng', async () => {
    const config = loadConfig({ MOCK_MODE: '1', DATA_DIR: tmp, WORKER_CONCURRENCY: '6', ADMIN_PASSWORD: 'x', NS_POLL_INTERVAL_MIN: '0' });
    const db = new Db(':memory:');
    const services = createServices(config, db);
    (services.cloudflare as MockCloudflare).activateAfterPolls = 1;
    const origGenerate = services.content.generatePage.bind(services.content);
    services.content.generatePage = async (input) => {
      const page = await origGenerate(input);
      if (input.kind === 'home') page.intro = `MOCK_BAD ${page.intro}`;
      return page;
    };
    ensureDefaultServer(config, db);
    const server = db.listServers()[0]!;
    const brief = SiteBriefSchema.parse({ brandName: 'Tiệm Bánh Hoa', industry: 'Tiệm bánh', location: 'Phan Rang', services: ['Bánh kem'], keywords: ['bánh kem'], postsCount: 0, targetCountries: ['VN'] });
    const id = db.createSite({ domain: 'banhhoa2.com', server_id: server.id, brief, entity: EntitySchema.parse({ type: 'LocalBusiness', name: 'Tiệm Bánh Hoa' }) });
    db.ensureSteps(id, STEPS.map((s) => s.id));
    const worker = new Worker({ db, config, services, steps: STEPS });
    await runToEnd(worker, db, id);
    expect(db.getSite(id)?.status).toBe('error');
    const build = db.listSteps(id).find((s) => s.step === 'build')!;
    expect(build.status).toBe('failed');
    expect(build.error).toMatch(/Trang chủ chưa đạt kiểm duyệt/);
  }, 120000);
});
