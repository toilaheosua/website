import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { loadConfig, resetConfigCache } from '../src/config.js';
import { Db } from '../src/db/index.js';
import { createServices, ensureDefaultServer } from '../src/services/index.js';
import { STEPS } from '../src/core/steps.js';
import { Worker } from '../src/core/worker.js';
import { EntitySchema, PageContentSchema, SiteBriefSchema, SitePlanSchema } from '../src/core/types.js';
import { MockCloudflare } from '../src/services/mock.js';
import { createApp } from '../src/web/server.js';
import { BLOCK_DEFS, defaultHomeLayout, layoutLibraryIds, normalizeLayout } from '../src/generator/layout.js';
import { applyThemeTweaks, makeTheme } from '../src/generator/themes.js';
import { saveLibraryImage } from '../src/generator/library.js';
import { siteDirs } from '../src/generator/builder.js';

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-design-'));
  resetConfigCache();
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const plan = SitePlanSchema.parse({ tagline: 'T', brandVoice: 'v', audienceInsight: 'a', heroImageQuery: 'x', aboutImageQuery: 'y', services: [{ name: 'A', summary: 's', imageQuery: 'q' }], posts: [], faq: [{ question: 'Q', answer: 'A' }], ctaPrimary: 'Gọi', ctaSecondary: 'Xem', differentiators: ['d1'], authorName: 'n', authorTitle: 't', authorBio: 'b' });
const content = PageContentSchema.parse({ kind: 'home', title: 'Tiêu đề trang chủ đủ dài để hợp lệ', metaDescription: 'Mô tả đủ dài cho trang chủ thử nghiệm bố cục khối kéo thả của hệ thống, có hơn sáu mươi ký tự.', h1: 'H1', intro: 'Mở đầu', sections: [{ heading: 'Giới thiệu ngắn', body: 'a' }, { heading: 'Vì sao chọn', body: 'b' }, { heading: 'Quy trình làm việc', body: '- b1\n- b2\n- b3' }, { heading: 'Thêm', body: 'c' }], faq: [] });

describe('bố cục trang chủ', () => {
  it('bố cục mặc định tái hiện thứ tự theo theme: hero, intro, services, why, process, posts, faq, cta', () => {
    const theme = { sectionOrder: ['intro', 'services', 'why', 'process', 'posts', 'faq', 'cta'] };
    const blocks = defaultHomeLayout(theme, content, plan, 'business', true);
    expect(blocks.map((b) => b.type)).toEqual(['hero', 'content', 'services', 'content', 'content', 'posts', 'content', 'faq', 'cta']);
    expect(blocks[1]!.props).toMatchObject({ section: 0, layout: 'prose' });
    expect(blocks[3]!.props).toMatchObject({ section: 1, layout: 'why' });
    expect(blocks[4]!.props).toMatchObject({ section: 2, layout: 'process' });
    expect(blocks[6]!.props).toMatchObject({ section: 3, layout: 'prose', alt: true });
    const noPosts = defaultHomeLayout(theme, content, plan, 'business', false);
    expect(noPosts.some((b) => b.type === 'posts')).toBe(false);
  });

  it('normalizeLayout: ép kiểu trường, bỏ khối single trùng, luôn có hero', () => {
    const l = normalizeLayout({
      home: [
        { id: 'a', type: 'text', props: { heading: 'H', body: 'B', align: 'sai', alt: '1' } },
        { id: 'b', type: 'faq', props: {} },
        { id: 'c', type: 'faq', props: {} },
        { id: 'g', type: 'gallery', props: { images: ['3', 4, 'x'], columns: '4' } },
        { id: 'i', type: 'image_text', props: { image: '7', side: 'left' } },
      ],
    });
    expect(l.home[0]!.type).toBe('hero');
    expect(l.home.filter((b) => b.type === 'faq')).toHaveLength(1);
    const text = l.home.find((b) => b.type === 'text')!;
    expect(text.props).toMatchObject({ heading: 'H', body: 'B', align: 'left', alt: true });
    const gal = l.home.find((b) => b.type === 'gallery')!;
    expect(gal.props.images).toEqual([3, 4]);
    expect(gal.props.columns).toBe('4');
    expect(layoutLibraryIds(l).sort()).toEqual([3, 4, 7]);
    expect(() => normalizeLayout({ home: [{ id: 'x', type: 'bomb', props: {} }] })).toThrow();
    for (const t of Object.keys(BLOCK_DEFS)) expect(BLOCK_DEFS[t as keyof typeof BLOCK_DEFS].fields.length).toBeGreaterThan(0);
  });

  it('applyThemeTweaks chỉ nhận màu hex hợp lệ và lựa chọn có trong danh sách', () => {
    const theme = makeTheme('corporate', 'business');
    const t = applyThemeTweaks(theme, { palette: { primary: '#123456', accent: 'red' }, fontPair: 1, radius: '999px', headerStyle: 'center', heroStyle: 'minimal', cardStyle: 'nope' as never });
    expect(t.palette.primary).toBe('#123456');
    expect(t.palette.accent).toBe(theme.palette.accent);
    expect(t.radius).toBe('999px');
    expect(t.headerStyle).toBe('center');
    expect(t.heroStyle).toBe('minimal');
    expect(t.cardStyle).toBe(theme.cardStyle);
    expect(t.fonts.heading).not.toBe('');
  });

  it('dashboard: trang thiết kế, xem trước với bố cục đang chỉnh, lưu và dựng lại có khối mới', async () => {
    const config = loadConfig({ MOCK_MODE: '1', DATA_DIR: tmp, WORKER_CONCURRENCY: '6', ADMIN_PASSWORD: 'x', NS_POLL_INTERVAL_MIN: '0', REBUILD_DEBOUNCE_SEC: '0' });
    const db = new Db(':memory:');
    const services = createServices(config, db);
    (services.cloudflare as MockCloudflare).activateAfterPolls = 1;
    ensureDefaultServer(config, db);
    const brief = SiteBriefSchema.parse({ brandName: 'Hủ Tiếu Ông Giáo', industry: 'Quán ăn', location: 'Phan Rang', services: ['Hủ tiếu'], keywords: ['hủ tiếu'], postsCount: 1, targetCountries: ['VN'] });
    const id = db.createSite({ domain: 'design.test', server_id: db.listServers()[0]!.id, brief, entity: EntitySchema.parse({ type: 'Restaurant', name: 'Hủ Tiếu Ông Giáo', telephone: '0944 706 360', address: { streetAddress: '89 Văn Cao', addressLocality: 'Phan Rang' } }) });
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
    expect(db.getSite(id)?.status).toBe('live');
    const outDir = path.join(config.sitesDir, 'design.test', 'out');
    const before = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    expect(before).toContain('data-block="hero"');
    expect(before).toContain('data-block="services"');

    const app = createApp({ db, config, services, worker, steps: STEPS });
    const login = await app.request('/login', { method: 'POST', body: new URLSearchParams({ user: 'admin', password: 'x', next: '/' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    const page = await app.request(`/sites/${id}/design`, { headers: { cookie } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('id="design-data"');
    expect(html).toContain('Thiết kế trang chủ');
    expect(html).toContain('"defaultLayout"');

    const lib = await saveLibraryImage({ db, siteId: id, cacheDir: siteDirs(config.sitesDir, 'design.test').images, buffer: await sharp({ create: { width: 320, height: 240, channels: 3, background: '#0a0' } }).png().toBuffer(), alt: 'Không gian quán', source: 'upload', nameHint: 'khong-gian' });
    const layout = [
      { id: 'hero', type: 'hero', props: { style: 'minimal', secondaryButton: false } },
      { id: 'g1', type: 'gallery', props: { heading: 'Không gian quán', images: [lib.id], columns: '2' } },
      { id: 't1', type: 'text', props: { heading: 'Lời chào', body: 'Chào bạn **thân mến**.', align: 'center', alt: true } },
      { id: 'c1', type: 'contact', props: { heading: 'Ghé quán', showMap: true, alt: true } },
      { id: 'svc', type: 'services', hidden: true, props: { heading: '' } },
      { id: 'cta1', type: 'cta', props: { heading: 'Đặt bàn', text: '' } },
    ];
    const theme = { palette: { primary: '#112233' }, fontPair: 2, radius: '0px', headerStyle: 'center', heroStyle: 'minimal', cardStyle: 'outline' };
    const preview = await app.request(`/sites/${id}/design/preview`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ layout, theme }) });
    expect(preview.status).toBe(200);
    const pv = await preview.text();
    expect(pv).toContain('data-block="gallery"');
    expect(pv).toContain('Không gian quán');
    expect(pv).toContain('<strong>thân mến</strong>');
    expect(pv).toContain('data-block="contact"');
    expect(pv).toContain('89 Văn Cao');
    expect(pv).not.toContain('data-block="services"');
    expect(pv).toContain('--primary:#112233');
    expect(pv).toContain(`/sites/${id}/images/file/${path.basename(lib.file)}`);
    expect(pv).toContain('class="hero minimal"');
    // Chưa lưu: site trong DB chưa đổi
    expect(db.getSite(id)!.layout).toBeNull();

    const save = await app.request(`/sites/${id}/design`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ layout, theme }) });
    expect(save.status).toBe(200);
    expect(((await save.json()) as { ok: boolean }).ok).toBe(true);
    const site = db.getSite(id)!;
    expect(site.layout?.home.map((b) => b.type)).toEqual(['hero', 'gallery', 'text', 'contact', 'services', 'cta']);
    expect(site.theme?.palette.primary).toBe('#112233');
    expect(site.theme?.radius).toBe('0px');
    await worker.tick();
    await worker.drain(30_000);
    const after = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    expect(after).toContain('data-block="gallery"');
    expect(after).toContain('Lời chào');
    expect(after).not.toContain('data-block="services"');
    expect(fs.existsSync(path.join(outDir, 'assets', 'img', path.basename(lib.file)))).toBe(true);
    expect(fs.readFileSync(path.join(outDir, 'assets', 'css', 'style.css'), 'utf8')).toContain('--primary:#112233');

    const bad = await app.request(`/sites/${id}/design`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ layout: [{ id: 'x', type: 'bomb', props: {} }] }) });
    expect(bad.status).toBe(400);
  }, 120000);
});
