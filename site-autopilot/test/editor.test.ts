import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigCache } from '../src/config.js';
import { Db } from '../src/db/index.js';
import { createServices, ensureDefaultServer } from '../src/services/index.js';
import { STEPS } from '../src/core/steps.js';
import { Worker } from '../src/core/worker.js';
import { EntitySchema, SiteBriefSchema, PageContentSchema, SitePlanSchema } from '../src/core/types.js';
import { MockCloudflare } from '../src/services/mock.js';
import { createApp } from '../src/web/server.js';
import { applyEdits, collectEditableFields } from '../src/generator/edit-paths.js';

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-editor-'));
  resetConfigCache();
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const content = PageContentSchema.parse({
  kind: 'home',
  slug: '',
  title: 'Tiêu đề trang chủ đủ dài để hợp lệ theo schema',
  metaDescription: 'Mô tả meta đủ dài để hợp lệ theo schema của trang, có nói về dịch vụ và địa điểm cụ thể để đạt độ dài tối thiểu.',
  h1: 'Tiêu đề chính',
  intro: 'Đoạn mở đầu.',
  sections: [{ heading: 'Mục 1', body: 'Nội dung 1' }],
  faq: [{ question: 'Hỏi?', answer: 'Đáp.' }],
});
const plan = SitePlanSchema.parse({
  tagline: 'Khẩu hiệu',
  brandVoice: 'thân thiện',
  audienceInsight: 'gia đình',
  heroImageQuery: 'restaurant',
  aboutImageQuery: 'kitchen',
  authorName: 'Bà Tư',
  authorTitle: 'Chủ quán',
  authorBio: 'Nấu ăn 20 năm.',
  ctaPrimary: 'Gọi ngay',
  ctaSecondary: 'Xem thêm',
  differentiators: ['Nhanh'],
  services: [{ slug: 'a', name: 'Dịch vụ A', summary: 'Tóm tắt A', imageQuery: 'food' }],
  faq: [{ question: 'Q', answer: 'A' }],
  posts: [],
});

describe('applyEdits', () => {
  it('chỉ ghi các đường dẫn trong danh sách trắng, bỏ qua đường dẫn lạ', () => {
    const fields = collectEditableFields(content, plan);
    expect(fields.page['h1']).toBe('Tiêu đề chính');
    expect(fields.page['sections.0.body']).toBe('Nội dung 1');
    expect(fields.plan['ctaPrimary']).toBe('Gọi ngay');
    const r = applyEdits(content, plan, { h1: 'Mới', 'sections.0.body': 'Thân mới', 'sections.9.body': 'x', __proto__x: 'y' }, { ctaPrimary: 'Đặt bàn', 'posts.0.slug': 'hack' });
    expect(r.content.h1).toBe('Mới');
    expect(r.content.sections[0]?.body).toBe('Thân mới');
    expect(r.plan?.ctaPrimary).toBe('Đặt bàn');
    expect(r.applied).toBe(3);
    expect(r.rejected.length).toBeGreaterThanOrEqual(2);
    expect(r.plan?.posts).toEqual([]);
  });
  it('từ chối giá trị làm nội dung không hợp lệ', () => {
    expect(() => applyEdits(content, plan, { title: '' }, {})).toThrow();
  });
});

describe('trang chỉnh sửa trực quan (mock)', () => {
  it('render trang với data-edit và lưu thay đổi rồi xếp hàng dựng lại', async () => {
    const config = loadConfig({ MOCK_MODE: '1', DATA_DIR: tmp, WORKER_CONCURRENCY: '6', ADMIN_PASSWORD: 'x', NS_POLL_INTERVAL_MIN: '0' });
    const db = new Db(':memory:');
    const services = createServices(config, db);
    (services.cloudflare as MockCloudflare).activateAfterPolls = 1;
    ensureDefaultServer(config, db);
    const server = db.listServers()[0]!;
    const brief = SiteBriefSchema.parse({ brandName: 'Quán Cơm Bà Tư', industry: 'Quán ăn', location: 'Phan Rang', services: ['Cơm tấm'], keywords: ['cơm tấm phan rang'], postsCount: 1, targetCountries: ['VN'] });
    const entity = EntitySchema.parse({ type: 'LocalBusiness', name: 'Quán Cơm Bà Tư' });
    const id = db.createSite({ domain: 'combatu.com', server_id: server.id, brief, entity });
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
    expect(db.listSteps(id).filter((s) => s.status === 'failed').map((f) => `${f.step}: ${f.error}`)).toEqual([]);
    expect(db.getSite(id)?.status).toBe('live');

    const app = createApp({ db, config, services, worker, steps: STEPS });
    const login = await app.request('/login', { method: 'POST', body: new URLSearchParams({ user: 'admin', password: 'x', next: '/' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    const home = db.listPages(id).find((p) => p.kind === 'home')!;

    const shell = await app.request(`/sites/${id}/editor`, { headers: { cookie } });
    expect(shell.status).toBe(200);
    const shellHtml = await shell.text();
    expect(shellHtml).toContain(`/sites/${id}/editor/page/${home.id}`);
    expect(shellHtml).toContain(`location.href='/sites/${id}/editor?page='`);
    expect(shellHtml).not.toContain('{site.id}');

    const page = await app.request(`/sites/${id}/editor/page/${home.id}`, { headers: { cookie } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('data-edit="h1"');
    expect(html).toContain('data-edit-md="intro"');
    expect(html).toContain('data-edit-img="home.hero"');
    expect(html).toContain('id="sa-edit-data"');
    expect(html).toContain(`/sites/${id}/editor/style.css`);
    expect(html).not.toMatch(/href="\/assets\//);

    const lib = db.listLibrary(id)[0];
    const save = await app.request(`/sites/${id}/editor/page/${home.id}/save`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: { h1: 'Cơm tấm ngon nhất Phan Rang' }, plan: { ctaPrimary: 'Đặt bàn ngay' }, images: lib ? { 'home.hero': { libraryId: lib.id } } : { 'home.hero': { none: true } } }),
    });
    expect(save.status).toBe(200);
    const body = (await save.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(db.getPage(home.id)?.content.h1).toBe('Cơm tấm ngon nhất Phan Rang');
    expect(db.getSite(id)?.plan?.ctaPrimary).toBe('Đặt bàn ngay');
    const hero = db.listImages(id).find((i) => i.key === 'home.hero');
    expect(hero?.provider).toBe(lib ? 'manual' : 'none');
    expect(db.listJobs().some((j) => j.type === 'rebuild_deploy' && j.site_id === id && j.status === 'queued')).toBe(true);

    const bad = await app.request(`/sites/${id}/editor/page/${home.id}/save`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ page: { title: '' } }) });
    expect(bad.status).toBe(400);

    // dựng lại thật: HTML đã đổi và không còn data-edit
    await worker.tick();
    await worker.drain(30_000);
    const out = fs.readFileSync(path.join(config.sitesDir, 'combatu.com', 'out', 'index.html'), 'utf8');
    expect(out).toContain('Cơm tấm ngon nhất Phan Rang');
    expect(out).not.toContain('data-edit');
  }, 120000);
});
