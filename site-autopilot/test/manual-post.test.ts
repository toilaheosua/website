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
import { buildManualPost, markdownToSections, parseFaq, postSlug, postToForm, sectionsToMarkdown } from '../src/core/manual-post.js';

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-manual-'));
  resetConfigCache();
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const BODY = `Bạn muốn tô hủ tiếu sáng mà nước lèo trong. Bài này chỉ cách nhận biết.

## Nước lèo trong hay đục
Nước lèo hầm xương hớt bọt kỹ thì trong, ngọt hậu. Đục thường do hầm lửa lớn.

- Nhìn màu
- Nếm hậu vị

## Sợi hủ tiếu
Sợi dai, không bở, trụng vừa tới.
`;

describe('soạn bài thủ công', () => {
  it('tách markdown thành intro và mục theo ##, ghép lại được', () => {
    const r = markdownToSections(BODY);
    expect(r.intro).toBe('Bạn muốn tô hủ tiếu sáng mà nước lèo trong. Bài này chỉ cách nhận biết.');
    expect(r.sections.map((s) => s.heading)).toEqual(['Nước lèo trong hay đục', 'Sợi hủ tiếu']);
    expect(r.sections[0]!.body).toContain('- Nếm hậu vị');
    const back = sectionsToMarkdown({ intro: r.intro, sections: r.sections });
    expect(markdownToSections(back)).toEqual(r);
  });

  it('parseFaq và postSlug', () => {
    expect(parseFaq('Khô hay nước?\nTùy khẩu vị.\n\nQ: Có giao không?\nA: Có, 3 km.')).toEqual([
      { question: 'Khô hay nước?', answer: 'Tùy khẩu vị.' },
      { question: 'Có giao không?', answer: 'Có, 3 km.' },
    ]);
    expect(postSlug('blog', '', 'Chọn quán hủ tiếu ngon ở Phan Rang')).toBe('blog/chon-quan-hu-tieu-ngon-o-phan-rang');
    expect(postSlug('blog', '/blog/bai-cua-toi/', 'x')).toBe('blog/bai-cua-toi');
  });

  it('buildManualPost giữ trường cũ, postToForm điền lại đúng', () => {
    const content = buildManualPost({ title: 'Chọn quán hủ tiếu ngon ở Phan Rang: 5 dấu hiệu', slug: '', h1: '', metaDescription: 'Năm dấu hiệu nhận biết tô hủ tiếu nấu đúng kiểu Nam Vang, đọc để chọn đúng quán ngay lần đầu.', targetKeyword: 'hủ tiếu phan rang', excerpt: 'Năm dấu hiệu.', keyTakeaways: '- Nước lèo trong\n- Sợi dai', body: BODY, faq: 'Khô hay nước?\nTùy khẩu vị.', heroImageAlt: '' });
    expect(content.kind).toBe('post');
    expect(content.h1).toBe(content.title);
    expect(content.keyTakeaways).toEqual(['Nước lèo trong', 'Sợi dai']);
    expect(content.faq).toHaveLength(1);
    const form = postToForm(content, 'blog/chon-quan');
    expect(form.slug).toBe('chon-quan');
    expect(form.body).toContain('## Sợi hủ tiếu');
    expect(form.keyTakeaways).toBe('Nước lèo trong\nSợi dai');
  });

  it('dashboard: tạo bài, sửa SEO + đổi đường dẫn, soạn thảo, xóa bài; site dựng đúng', async () => {
    const config = loadConfig({ MOCK_MODE: '1', DATA_DIR: tmp, WORKER_CONCURRENCY: '6', ADMIN_PASSWORD: 'x', NS_POLL_INTERVAL_MIN: '0', REBUILD_DEBOUNCE_SEC: '0' });
    const db = new Db(':memory:');
    const services = createServices(config, db);
    (services.cloudflare as MockCloudflare).activateAfterPolls = 1;
    ensureDefaultServer(config, db);
    const brief = SiteBriefSchema.parse({ brandName: 'Hủ Tiếu Ông Giáo', industry: 'Quán ăn', location: 'Phan Rang', services: ['Hủ tiếu'], keywords: ['hủ tiếu'], postsCount: 1, targetCountries: ['VN'] });
    const id = db.createSite({ domain: 'manual.test', server_id: db.listServers()[0]!.id, brief, entity: EntitySchema.parse({ type: 'Restaurant', name: 'Hủ Tiếu Ông Giáo' }) });
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
    const app = createApp({ db, config, services, worker, steps: STEPS });
    const login = await app.request('/login', { method: 'POST', body: new URLSearchParams({ user: 'admin', password: 'x', next: '/' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    const post = (url: string, data: Record<string, string>) => app.request(url, { method: 'POST', body: new URLSearchParams(data), headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' } });
    const outDir = path.join(config.sitesDir, 'manual.test', 'out');

    // tạo bài
    expect((await app.request(`/sites/${id}/posts/new`, { headers: { cookie } })).status).toBe(200);
    const bad = await post(`/sites/${id}/posts/new`, { title: 'Ngắn', metaDescription: 'x', body: 'y' });
    expect(bad.status).toBe(200);
    expect(await bad.text()).toContain('Tiêu đề quá ngắn');
    const created = await post(`/sites/${id}/posts/new`, { title: 'Chọn quán hủ tiếu ngon ở Phan Rang: 5 dấu hiệu', slug: '', h1: '', metaDescription: 'Năm dấu hiệu nhận biết tô hủ tiếu nấu đúng kiểu Nam Vang, đọc để chọn đúng quán ngay lần đầu.', targetKeyword: 'hủ tiếu phan rang', excerpt: 'Năm dấu hiệu.', keyTakeaways: 'Nước lèo trong\nSợi dai', body: BODY, faq: 'Khô hay nước?\nTùy khẩu vị.', heroImageAlt: '' });
    expect(created.status).toBe(302);
    const page = db.listPages(id).find((p) => p.slug === 'blog/chon-quan-hu-tieu-ngon-o-phan-rang-5-dau-hieu')!;
    expect(page).toBeDefined();
    expect(page.status).toBe('published');
    expect(page.review?.approvedBy).toBe('user');
    expect(db.getSite(id)!.plan!.posts.some((p) => p.slug === 'chon-quan-hu-tieu-ngon-o-phan-rang-5-dau-hieu')).toBe(true);
    await worker.tick();
    await worker.drain(30_000);
    expect(fs.existsSync(path.join(outDir, 'blog', 'chon-quan-hu-tieu-ngon-o-phan-rang-5-dau-hieu', 'index.html'))).toBe(true);
    expect(fs.readFileSync(path.join(outDir, 'blog', 'index.html'), 'utf8')).toContain('Năm dấu hiệu.');

    // sửa SEO + đổi đường dẫn
    db.upsertImage({ site_id: id, key: `post.chon-quan-hu-tieu-ngon-o-phan-rang-5-dau-hieu.hero`, provider: 'none', provider_id: null, query: null, file: '', width: null, height: null, alt: '', credit: '', credit_url: '' });
    const meta = await post(`/sites/${id}/pages/${page.id}/meta`, { title: 'Chọn quán hủ tiếu ngon ở Phan Rang: 5 dấu hiệu thật', slug: 'chon-quan-hu-tieu', metaDescription: page.content.metaDescription, h1: 'Chọn quán hủ tiếu', targetKeyword: 'quán hủ tiếu phan rang', heroImageAlt: 'Tô hủ tiếu', excerpt: 'Mới.' });
    expect(meta.status).toBe(302);
    const renamed = db.getPage(page.id)!;
    expect(renamed.slug).toBe('blog/chon-quan-hu-tieu');
    expect(renamed.content.h1).toBe('Chọn quán hủ tiếu');
    expect(renamed.content.targetKeyword).toBe('quán hủ tiếu phan rang');
    expect(db.listImages(id).some((i) => i.key === 'post.chon-quan-hu-tieu.hero')).toBe(true);
    expect(db.getSite(id)!.plan!.posts.some((p) => p.slug === 'chon-quan-hu-tieu')).toBe(true);
    const dup = await post(`/sites/${id}/pages/${page.id}/meta`, { title: renamed.content.title, slug: db.listPages(id).find((p) => p.kind === 'post' && p.id !== page.id)!.slug, metaDescription: renamed.content.metaDescription, h1: 'x' });
    expect(dup.status).toBe(302);
    expect(db.getPage(page.id)!.slug).toBe('blog/chon-quan-hu-tieu');

    // soạn thảo lại nội dung
    const editPage = await (await app.request(`/sites/${id}/pages/${page.id}/edit`, { headers: { cookie } })).text();
    expect(editPage).toContain('## Sợi hủ tiếu');
    const edited = await post(`/sites/${id}/pages/${page.id}/edit`, { title: renamed.content.title, slug: 'chon-quan-hu-tieu', h1: '', metaDescription: renamed.content.metaDescription, targetKeyword: '', excerpt: '', keyTakeaways: '', body: BODY + '\n## Mục mới thêm\n\nNội dung mục mới đủ dài để hợp lệ và có ý nghĩa.', faq: '', heroImageAlt: '' });
    expect(edited.status).toBe(302);
    expect(db.getPage(page.id)!.content.sections.map((s) => s.heading)).toContain('Mục mới thêm');

    // xóa bài
    const home = db.listPages(id).find((p) => p.kind === 'home')!;
    const noDel = await post(`/sites/${id}/pages/${home.id}/delete`, {});
    expect(noDel.status).toBe(302);
    expect(db.getPage(home.id)).toBeDefined();
    const del = await post(`/sites/${id}/pages/${page.id}/delete`, {});
    expect(del.status).toBe(302);
    expect(db.getPage(page.id)).toBeUndefined();
    expect(db.listImages(id).some((i) => i.key.startsWith('post.chon-quan-hu-tieu.'))).toBe(false);
    expect(db.getSite(id)!.plan!.posts.some((p) => p.slug === 'chon-quan-hu-tieu')).toBe(false);
    await worker.tick();
    await worker.drain(30_000);
    expect(fs.existsSync(path.join(outDir, 'blog', 'chon-quan-hu-tieu', 'index.html'))).toBe(false);
    expect(fs.existsSync(path.join(outDir, 'blog', 'chon-quan-hu-tieu-ngon-o-phan-rang-5-dau-hieu', 'index.html'))).toBe(false);
  }, 120000);
});
