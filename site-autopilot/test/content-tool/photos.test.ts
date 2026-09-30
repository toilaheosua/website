import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Article } from '../../src/content-tool/core/types.js';
import { buildExportBundle, bundleToZip, listArticlePhotos, photoUrl, rewritePhotoRefs, withEmbeddedPhotos, withPhotoBase } from '../../src/content-tool/generator/photos.js';
import { articleToDocx } from '../../src/content-tool/generator/markdown.js';

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let dir: string;

const article = (): Article => ({
  title: 'Sáu quán hủ tiếu Phan Rang',
  metaDescription: 'm',
  h1: 'Sáu quán hủ tiếu Phan Rang đáng ghé',
  excerpt: '',
  quickSummary: ['a'],
  intro: 'Mở bài.',
  sections: [
    { heading: '1. Ông Giáo', level: 2, body: '![Ông Giáo ở Phan Rang](photos/1-ong-giao.png)\n\n**Địa chỉ:** 89 Văn Cao\n\nĐoạn văn.' },
    { heading: '2. Mai Thi', level: 2, body: '![Mai Thi](photos/2-mai-thi.png)\n\nĐoạn khác.' },
    { heading: '3. Không ảnh', level: 2, body: '![thiếu file](photos/3-thieu.png)\n\nĐoạn nữa.' },
  ],
  faq: [],
  nextSteps: '',
  images: [{ position: 'mục 1', query: '', alt: 'Ông Giáo', src: 'photos/1-ong-giao.png' }],
  targetKeyword: 'hủ tiếu Phan Rang',
  secondaryKeywords: [],
  style: 'story',
});

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-photos-'));
  fs.mkdirSync(path.join(dir, 'photos'));
  fs.writeFileSync(path.join(dir, 'photos', '1-ong-giao.png'), PNG_1X1);
  fs.writeFileSync(path.join(dir, 'photos', '2-mai-thi.png'), PNG_1X1);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('ảnh trong file xuất', () => {
  it('đổi đường dẫn ảnh sang URL gốc, giữ tên file', () => {
    expect(photoUrl('https://site.vn/uploads/2026/09/', 'photos/1-ong-giao.png')).toBe('https://site.vn/uploads/2026/09/1-ong-giao.png');
    const a = withPhotoBase(article(), 'https://site.vn/up');
    expect(a.sections[0]!.body).toContain('![Ông Giáo ở Phan Rang](https://site.vn/up/1-ong-giao.png)');
    expect(a.images[0]!.src).toBe('https://site.vn/up/1-ong-giao.png');
    expect(withPhotoBase(article(), '').sections[0]!.body).toContain('(photos/1-ong-giao.png)');
    expect(rewritePhotoRefs(article(), () => 'X').sections[1]!.body).toContain('](X)');
  });

  it('liệt kê ảnh có file thật, nhúng data URI vào HTML', () => {
    const list = listArticlePhotos(article(), dir);
    expect(list.map((p) => p.rel).sort()).toEqual(['photos/1-ong-giao.png', 'photos/2-mai-thi.png']);
    const emb = withEmbeddedPhotos(article(), dir);
    expect(emb.sections[0]!.body).toContain('](data:image/png;base64,');
    expect(emb.sections[2]!.body).toContain('(photos/3-thieu.png)');
  });

  it('DOCX nhúng ảnh khi có thư mục ảnh', async () => {
    const plain = await articleToDocx(article());
    const withImg = await articleToDocx(article(), { photoDir: dir });
    const zip = await JSZip.loadAsync(withImg);
    const media = Object.keys(zip.files).filter((f) => f.startsWith('word/media/'));
    expect(media.length).toBe(2);
    expect(withImg.length).toBeGreaterThan(plain.length);
  });

  it('gói ZIP có đủ file bài và thư mục photos; JSON có photoUrl khi đặt URL gốc', async () => {
    const b = await buildExportBundle(article(), { keyword: 'hủ tiếu Phan Rang', dir, baseUrl: '', places: null, sourceUrls: [] });
    expect(b.photoMode).toBe('relative');
    expect(b.html).toContain('data:image/png;base64,');
    expect(b.md).toContain('(photos/1-ong-giao.png)');
    const zipBuf = await bundleToZip(b, 'hu-tieu');
    const zip = await JSZip.loadAsync(zipBuf);
    const names = Object.keys(zip.files);
    expect(names).toEqual(expect.arrayContaining(['hu-tieu.md', 'hu-tieu.html', 'hu-tieu.json', 'hu-tieu.docx', 'hu-tieu.txt', 'photos/1-ong-giao.png', 'photos/2-mai-thi.png', 'DOC-TRUOC.txt']));
    const withUrl = await buildExportBundle(article(), { keyword: 'x', dir, baseUrl: 'https://site.vn/up', places: null, sourceUrls: [] });
    expect(withUrl.photoMode).toBe('url');
    expect(withUrl.md).toContain('https://site.vn/up/1-ong-giao.png');
    expect(withUrl.html).toContain('src="https://site.vn/up/1-ong-giao.png"');
    expect(JSON.stringify(withUrl.json)).toContain('https://site.vn/up/1-ong-giao.png');
  });
});
