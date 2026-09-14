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
import { EntitySchema, SiteBriefSchema } from '../src/core/types.js';
import { MockCloudflare } from '../src/services/mock.js';
import { createApp } from '../src/web/server.js';
import { readZip, writeZip } from '../src/core/zip.js';
import { parseImportedPost, rewriteImageRefs, unpackUpload } from '../src/core/import-post.js';

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-import-'));
  resetConfigCache();
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const MD = `---
title: "6 quán hủ tiếu Phan Rang ngon: giá, giờ mở, quán nào hợp bạn"
description: "Tổng hợp 6 quán hủ tiếu Phan Rang đáng ăn: điểm số, giá, giờ mở, món nên gọi và quán hợp từng tình huống. Bạn chọn được quán ưng ý."
keyword: "hủ tiếu phan rang"
slug: 6-quan-hu-tieu-phan-rang
---

# 6 quán hủ tiếu Phan Rang ngon, kèm giá và giờ mở cửa

Mỗi lần nghĩ tới hủ tiếu Phan Rang, tôi lại nhớ tô nước dùng thanh, sợi nhỏ mềm, thơm mùi xương hầm. Tôi đọc hàng trăm đánh giá rồi rút lại sáu quán rõ ràng nhất.

> **Tóm tắt nhanh**
> - Ông Giáo dẫn đầu với 4.8 sao.
> - Sa Đéc giá mềm nhất.

## 1. Hủ Tiếu Nam Vang Ông Giáo: quán đạt 4.8 sao hiếm hoi

![Hủ Tiếu Nam Vang Ông Giáo ở phan rang](photos/1-hu-tieu-nam-vang-ong-giao.jpg)

**Địa chỉ:** 89 Văn Cao, Phan Rang. Nước dùng được khen đậm đà, ngọt thanh từ xương. Sợi hủ tiếu mềm nhưng không nát, nhiều người gọi thêm quẩy và trứng.

## 2. Quán Sa Đéc: giá mềm nhất

![Quán Sa Đéc](photos/2-sa-dec.jpg)

Giá từ 20.000 đồng, mở từ bảy giờ sáng tới mười giờ tối, nhiều người khen sạch sẽ và đồ bày cẩn thận.

## Câu hỏi thường gặp

**Quán nào được đánh giá cao nhất?**

Ông Giáo đang dẫn đầu với 4.8 sao từ 33 đánh giá.

**Quán nào mở muộn nhất?**

TƯ BI mở tới 22:00.

## Trước khi bạn đi thử

Nếu ăn sáng, ưu tiên Ông Giáo vì mở từ 5 giờ. Trước khi ra đường, mở Google Maps kiểm tra giờ mở.
`;

async function jpg(color: string) {
  return sharp({ create: { width: 200, height: 150, channels: 3, background: color } }).jpeg().toBuffer();
}

describe('đọc zip', () => {
  it('ghi và đọc lại ZIP stored và deflate, bỏ thư mục', async () => {
    const entries = [
      { name: 'bai.md', data: Buffer.from('# Xin chào\n\nNội dung', 'utf8') },
      { name: 'photos/a.jpg', data: await jpg('#ff0000') },
    ];
    for (const deflate of [false, true]) {
      const zip = writeZip(entries, { deflate });
      const out = readZip(zip);
      expect(out.map((e) => e.name)).toEqual(['bai.md', 'photos/a.jpg']);
      expect(out[0]!.data.toString('utf8')).toBe('# Xin chào\n\nNội dung');
      expect(out[1]!.data.equals(entries[1]!.data)).toBe(true);
    }
    expect(() => readZip(Buffer.from('không phải zip'))).toThrow(/ZIP/);
  });
});

describe('nhận diện bài từ gói', () => {
  it('markdown có front matter, tóm tắt nhanh, FAQ và ảnh', async () => {
    const zip = writeZip([
      { name: 'hu-tieu.md', data: Buffer.from(MD, 'utf8') },
      { name: 'hu-tieu.json', data: Buffer.from(JSON.stringify({ title: 'x', excerpt: 'Tóm tắt từ JSON.', heroImageAlt: 'Tô hủ tiếu' }), 'utf8') },
      { name: 'photos/1-hu-tieu-nam-vang-ong-giao.jpg', data: await jpg('#00ff00') },
      { name: 'DOC-TRUOC.txt', data: Buffer.from('hướng dẫn', 'utf8') },
    ]);
    const r = parseImportedPost(unpackUpload('hu-tieu.zip', zip));
    expect(r.values.title).toBe('6 quán hủ tiếu Phan Rang ngon: giá, giờ mở, quán nào hợp bạn');
    expect(r.values.h1).toBe('6 quán hủ tiếu Phan Rang ngon, kèm giá và giờ mở cửa');
    expect(r.values.slug).toBe('6-quan-hu-tieu-phan-rang');
    expect(r.values.targetKeyword).toBe('hủ tiếu phan rang');
    expect(r.values.metaDescription).toMatch(/^Tổng hợp 6 quán/);
    expect(r.values.excerpt).toBe('Tóm tắt từ JSON.');
    expect(r.values.heroImageAlt).toBe('Tô hủ tiếu');
    expect(r.values.keyTakeaways).toBe('Ông Giáo dẫn đầu với 4.8 sao.\nSa Đéc giá mềm nhất.');
    expect(r.values.faq).toBe('Quán nào được đánh giá cao nhất?\nÔng Giáo đang dẫn đầu với 4.8 sao từ 33 đánh giá.\n\nQuán nào mở muộn nhất?\nTƯ BI mở tới 22:00.');
    expect(r.values.body).not.toContain('Câu hỏi thường gặp');
    expect(r.values.body).not.toContain('Tóm tắt nhanh');
    expect(r.values.body).toContain('## Trước khi bạn đi thử');
    expect(r.values.body).toMatch(/^Mỗi lần nghĩ tới/);
    expect(r.images.map((i) => i.fileName)).toEqual(['1-hu-tieu-nam-vang-ong-giao.jpg']);
    expect(r.images[0]!.alt).toBe('Hủ Tiếu Nam Vang Ông Giáo ở phan rang');
    expect(r.missingImages).toEqual(['photos/2-sa-dec.jpg']);
    const body = rewriteImageRefs(r.values.body, new Map([['photos/1-hu-tieu-nam-vang-ong-giao.jpg', '/assets/img/lib-1.webp']]), r.missingImages);
    expect(body).toContain('](/assets/img/lib-1.webp)');
    expect(body).not.toContain('photos/');
  });

  it('chỉ JSON: mục, nextSteps, FAQ', () => {
    const j = { kind: 'post', title: 'Bài từ JSON có tiêu đề đủ dài', metaDescription: 'Mô tả meta đủ dài cho bài viết thử nghiệm nhập từ JSON, có đủ năm mươi ký tự.', h1: 'H1 riêng', intro: 'Mở đầu.', sections: [{ heading: 'Mục 1', body: 'Thân 1' }], faq: [{ question: 'Q?', answer: 'A.' }], keyTakeaways: ['ý 1'], nextSteps: 'Làm ngay.', targetKeyword: 'kw' };
    const r = parseImportedPost(unpackUpload('bai.json', Buffer.from(JSON.stringify(j), 'utf8')));
    expect(r.values.h1).toBe('H1 riêng');
    expect(r.values.body).toBe('Mở đầu.\n\n## Mục 1\n\nThân 1\n\n## Bước tiếp theo\n\nLàm ngay.');
    expect(r.values.faq).toBe('Q?\nA.');
    expect(r.values.keyTakeaways).toBe('ý 1');
    expect(r.values.targetKeyword).toBe('kw');
  });

  it('dashboard: tải zip lên → form điền sẵn, ảnh vào kho → đăng → bản dựng có ảnh và hero', async () => {
    const config = loadConfig({ MOCK_MODE: '1', DATA_DIR: tmp, WORKER_CONCURRENCY: '6', ADMIN_PASSWORD: 'x', NS_POLL_INTERVAL_MIN: '0', REBUILD_DEBOUNCE_SEC: '0' });
    const db = new Db(':memory:');
    const services = createServices(config, db);
    (services.cloudflare as MockCloudflare).activateAfterPolls = 1;
    ensureDefaultServer(config, db);
    const brief = SiteBriefSchema.parse({ brandName: 'Hủ Tiếu Ông Giáo', industry: 'Quán ăn', location: 'Phan Rang', services: ['Hủ tiếu'], keywords: ['hủ tiếu'], postsCount: 0, targetCountries: ['VN'] });
    const id = db.createSite({ domain: 'import.test', server_id: db.listServers()[0]!.id, brief, entity: EntitySchema.parse({ type: 'Restaurant', name: 'Hủ Tiếu Ông Giáo' }) });
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

    const zip = writeZip(
      [
        { name: 'hu-tieu.md', data: Buffer.from(MD, 'utf8') },
        { name: 'photos/1-hu-tieu-nam-vang-ong-giao.jpg', data: await jpg('#00ff00') },
        { name: 'photos/2-sa-dec.jpg', data: await jpg('#0000ff') },
      ],
      { deflate: true },
    );
    const fd = new FormData();
    fd.append('file', new File([zip], 'hu-tieu.zip', { type: 'application/zip' }));
    fd.append('firstAsHero', '1');
    const res = await app.request(`/sites/${id}/posts/import`, { method: 'POST', body: fd, headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Đã nhận diện bài từ file');
    expect(html).toContain('Đã đưa 2 ảnh vào Kho ảnh thật');
    expect(html).toContain('name="heroLibraryId"');
    const lib = db.listLibrary(id);
    expect(lib).toHaveLength(2);
    expect(lib.some((l) => l.alt === 'Hủ Tiếu Nam Vang Ông Giáo ở phan rang')).toBe(true);
    const bodyField = html.match(/<textarea id="post-body"[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? '';
    expect(bodyField).toContain('/assets/img/lib-');
    expect(bodyField).not.toContain('photos/');
    const heroId = Number(html.match(/name="heroLibraryId" value="(\d+)"/)?.[1]);
    expect(heroId).toBeGreaterThan(0);

    // Đăng bài từ form đã điền (giải mã HTML entity của textarea)
    const decode = (t: string) => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const field = (name: string) => decode(html.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1] ?? '');
    const area = (name: string) => decode(html.match(new RegExp(`<textarea[^>]*name="${name}"[^>]*>([\\s\\S]*?)</textarea>`))?.[1] ?? '').trim();
    const form: Record<string, string> = { heroLibraryId: String(heroId), title: field('title'), slug: field('slug'), h1: field('h1'), targetKeyword: field('targetKeyword'), metaDescription: area('metaDescription'), excerpt: field('excerpt'), heroImageAlt: field('heroImageAlt'), keyTakeaways: area('keyTakeaways'), body: decode(bodyField).trim(), faq: area('faq') };
    const created = await app.request(`/sites/${id}/posts/new`, { method: 'POST', body: new URLSearchParams(form), headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(created.status).toBe(302);
    const page = db.listPages(id).find((p) => p.slug === 'blog/6-quan-hu-tieu-phan-rang')!;
    expect(page).toBeDefined();
    expect(page.content.faq).toHaveLength(2);
    expect(page.content.keyTakeaways).toHaveLength(2);
    expect(page.content.sections.map((s) => s.heading)).toEqual(['1. Hủ Tiếu Nam Vang Ông Giáo: quán đạt 4.8 sao hiếm hoi', '2. Quán Sa Đéc: giá mềm nhất', 'Trước khi bạn đi thử']);
    const hero = db.listImages(id).find((i) => i.key === 'post.6-quan-hu-tieu-phan-rang.hero');
    expect(hero?.provider).toBe('manual');
    await worker.tick();
    await worker.drain(30_000);
    const outDir = path.join(config.sitesDir, 'import.test', 'out');
    const postHtml = fs.readFileSync(path.join(outDir, 'blog', '6-quan-hu-tieu-phan-rang', 'index.html'), 'utf8');
    const libNames = lib.map((l) => path.basename(l.file));
    for (const n of libNames) {
      expect(postHtml).toContain(`/assets/img/${n}`);
      expect(fs.existsSync(path.join(outDir, 'assets', 'img', n))).toBe(true);
    }
  }, 120000);
});
