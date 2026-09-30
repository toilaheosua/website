import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigCache } from '../src/config.js';
import { Db } from '../src/db/index.js';
import { createServices, ensureDefaultServer } from '../src/services/index.js';
import { STEPS, requiredPages } from '../src/core/steps.js';
import { Worker } from '../src/core/worker.js';
import { EntitySchema, SiteBriefSchema, SitePlanSchema } from '../src/core/types.js';
import { MockCloudflare } from '../src/services/mock.js';
import { createApp } from '../src/web/server.js';
import { ContentToolBridge } from '../src/content/bridge.js';

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-bridge-'));
  process.env.MOCK_DELAY_MS = '1';
  resetConfigCache();
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('Tool Viết Content gộp trong bot', () => {
  it('site mới chỉ có trang chủ, blog, liên hệ, chính sách và các bài', () => {
    const plan = SitePlanSchema.parse({ tagline: 'T', brandVoice: 'v', audienceInsight: 'a', heroImageQuery: 'x', aboutImageQuery: 'y', services: [{ name: 'A', summary: 's', imageQuery: 'q' }], posts: [{ title: 'Bài 1', slug: 'bai-1', targetKeyword: 'k', angle: 'g', imageQuery: 'i' }], faq: [], ctaPrimary: 'Gọi', ctaSecondary: 'Xem', differentiators: [], authorName: 'n', authorTitle: 't', authorBio: 'b' });
    const kinds = requiredPages({ siteType: 'business', language: 'vi' }, plan).map((p) => p.kind);
    expect(kinds).toEqual(['home', 'blog', 'post', 'contact', 'privacy']);
  });

  it('pipeline: bài blog do tool viết, bot chờ rồi nhập vào site với ảnh, liên kết nội bộ và đoạn nhắc thương hiệu', async () => {
    const config = loadConfig({ MOCK_MODE: '1', DATA_DIR: tmp, WORKER_CONCURRENCY: '6', ADMIN_PASSWORD: 'x', NS_POLL_INTERVAL_MIN: '0', REBUILD_DEBOUNCE_SEC: '0', SESSION_SECRET: 'bridge-test' });
    const db = new Db(':memory:');
    const services = createServices(config, db);
    (services.cloudflare as MockCloudflare).activateAfterPolls = 1;
    ensureDefaultServer(config, db);
    const bridge = new ContentToolBridge({ db, config, services }, { dbPath: ':memory:' });
    services.contentTool = bridge;
    expect(bridge.db.getGeneralSettings().llmProvider).toBe('openrouter');
    expect(bridge.db.getGeneralSettings().skipAiDetection).toBe(true);
    // Khóa dùng chung: nhập ở bot, tool đọc được
    services.secrets.set('serpapi_key', 'serp-test-123456');
    expect(bridge.services.secrets.get('serpapi_key')).toBe('serp-test-123456');

    const brief = SiteBriefSchema.parse({ brandName: 'Hủ Tiếu Ông Giáo', industry: 'Quán ăn', location: 'Phan Rang', services: ['Hủ tiếu Nam Vang'], keywords: ['hủ tiếu phan rang'], postsCount: 1, targetCountries: ['VN'], postEngine: 'tool' });
    const id = db.createSite({ domain: 'bridge.test', server_id: db.listServers()[0]!.id, brief, entity: EntitySchema.parse({ type: 'Restaurant', name: 'Hủ Tiếu Ông Giáo', telephone: '0944 706 360', address: { streetAddress: '89 Văn Cao', addressLocality: 'Phan Rang' } }) });
    db.ensureSteps(id, STEPS.map((s) => s.id));
    const worker = new Worker({ db, config, services, steps: STEPS });
    const deadline = Date.now() + 120_000;
    let sawWaiting = false;
    while (Date.now() < deadline) {
      await worker.tick();
      await worker.drain(30_000);
      const gen = db.listSteps(id).find((s) => s.step === 'gen_content');
      if (gen?.status === 'waiting') {
        sawWaiting = true;
        expect(gen.message).toMatch(/Tool Viết Content đang viết 1 bài/);
        await bridge.drain();
      }
      const st = db.getSite(id)!.status;
      if (st === 'live' || st === 'error') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(sawWaiting).toBe(true);
    expect(db.listSteps(id).filter((s) => s.status === 'failed')).toEqual([]);
    expect(db.getSite(id)?.status).toBe('live');
    const pages = db.listPages(id);
    expect(pages.some((p) => p.kind === 'about')).toBe(false);
    expect(pages.some((p) => p.kind === 'services')).toBe(false);
    const post = pages.find((p) => p.kind === 'post')!;
    expect(post).toBeDefined();
    expect(post.status).toBe('published');
    expect(post.review?.summary).toMatch(/Tool Viết Content #\d+/);
    const rows = db.listToolRuns(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('imported');
    expect(rows[0]!.imported_page_id).toBe(post.id);
    // Đoạn nhắc thương hiệu với liên kết nội bộ hợp lệ
    const body = post.content.sections.map((s) => s.body).join('\n');
    expect(body).toContain('[Hủ Tiếu Ông Giáo](/)');
    expect(body).toContain('[cách liên hệ](/lien-he/)');
    expect(body).toContain('89 Văn Cao');
    // Trang chủ không còn nút dẫn tới trang dịch vụ, thẻ dịch vụ neo ngay trên trang chủ
    const outDir = path.join(config.sitesDir, 'bridge.test', 'out');
    const home = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    expect(home).not.toContain('href="/dich-vu/');
    expect(home).toContain('id="hu-tieu-nam-vang"');
    expect(fs.existsSync(path.join(outDir, post.slug, 'index.html'))).toBe(true);

    // Viết thêm bài qua dashboard: engine tool → tạo run, xong tự nhập và xếp dựng lại
    const app = createApp({ db, config, services, worker, steps: STEPS });
    const login = await app.request('/login', { method: 'POST', body: new URLSearchParams({ user: 'admin', password: 'x', next: '/' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    const nav = await (await app.request('/', { headers: { cookie } })).text();
    expect(nav).toContain('href="/content"');
    const toolHome = await app.request('/content', { headers: { cookie } });
    expect(toolHome.status).toBe(200);
    expect(await toolHome.text()).toContain('Viết bài mới');
    const anon = await app.request('/content');
    expect(anon.status).toBe(302);

    const more = await app.request(`/sites/${id}/jobs/generate_post`, { method: 'POST', body: new URLSearchParams({ engine: 'tool', kind: 'web', topic: 'Hủ tiếu khô hay nước', count: '1' }), headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(more.status).toBe(302);
    await worker.tick();
    await worker.drain(30_000);
    expect(db.listToolRuns(id)).toHaveLength(2);
    // Worker của tool tự chạy ngay khi có bài; chờ tới khi bài được nhập (tối đa 60 giây)
    const until = Date.now() + 60_000;
    while (Date.now() < until && db.listToolRuns(id).find((r) => r.title === 'Hủ tiếu khô hay nước')?.status === 'running') {
      await bridge.drain();
      await new Promise((r) => setTimeout(r, 100));
    }
    const row2 = db.listToolRuns(id).find((r) => r.title === 'Hủ tiếu khô hay nước')!;
    expect(row2.status).toBe('imported');
    expect(db.getPage(row2.imported_page_id!)?.kind).toBe('post');
    expect(db.listJobs().some((j) => j.type === 'rebuild_deploy' && j.status === 'queued')).toBe(true);
    const detail = await (await app.request(`/sites/${id}`, { headers: { cookie } })).text();
    expect(detail).toContain('Bài đang viết bằng Tool Viết Content');
    expect(detail).toContain('Đã nhập');

    // Bộ viết nhanh vẫn dùng được khi chọn engine fast
    const fast = await app.request(`/sites/${id}/jobs/generate_post`, { method: 'POST', body: new URLSearchParams({ engine: 'fast', kind: 'web', topic: 'Cách nấu nước lèo trong', count: '1' }), headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(fast.status).toBe(302);
    await worker.tick();
    await worker.drain(30_000);
    expect(db.listPages(id).some((p) => p.slug === 'blog/cach-nau-nuoc-leo-trong')).toBe(true);
    expect(db.listToolRuns(id)).toHaveLength(2);
    bridge.stop();
  }, 180_000);
});
