import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigCache } from '../../src/content-tool/config.js';
import { Db } from '../../src/content-tool/db/index.js';
import { createServices } from '../../src/content-tool/services/index.js';
import { Worker } from '../../src/content-tool/core/worker.js';
import { RunOptionsSchema, type PlacesData } from '../../src/content-tool/core/types.js';
import { buildRunBundle, latestArticle } from '../../src/content-tool/core/pipeline.js';
import { parseMapsUrl } from '../../src/content-tool/core/brand.js';
import { moveRankingSectionLast, roundupTitle } from '../../src/content-tool/core/roundup.js';

let tmp: string;
let db: Db;
let worker: Worker;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viet-content-brand-'));
  process.env.MOCK_MODE = '1';
  process.env.MOCK_DELAY_MS = '1';
  process.env.DATA_DIR = tmp;
  process.env.SESSION_SECRET = 'test-secret';
  process.env.ADMIN_PASSWORD = 'matkhau123';
  resetConfigCache();
  const config = loadConfig();
  db = new Db(config.dbPath);
  worker = new Worker({ db, config, services: createServices(config, db) });
});
afterAll(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('đọc link Google Maps', () => {
  it('lấy place_id, data_id, tên và tọa độ từ các dạng link', () => {
    const a = parseMapsUrl('https://www.google.com/maps/search/?api=1&query=H%E1%BB%A7%20Ti%E1%BA%BFu&query_place_id=ChIJsS-whYvRcDERGFMgoagylbg');
    expect(a.placeId).toBe('ChIJsS-whYvRcDERGFMgoagylbg');
    expect(a.name).toBe('Hủ Tiếu');
    const b = parseMapsUrl('https://www.google.com/maps/place/H%E1%BB%A7+Ti%E1%BA%BFu+Nam+Vang+%C3%94ng+Gi%C3%A1o/@11.5698,108.9964,17z/data=!3m1!4b1!4m6!3m5!1s0x3170d18b85b02fb1:0xb89532a8a1205318!8m2!3d11.5698693!4d108.9964943');
    expect(b.dataId).toBe('0x3170d18b85b02fb1:0xb89532a8a1205318');
    expect(b.name).toBe('Hủ Tiếu Nam Vang Ông Giáo');
    expect(b.lat).toBeCloseTo(11.5698, 3);
    expect(b.lng).toBeCloseTo(108.9964, 3);
    expect(parseMapsUrl('https://maps.app.goo.gl/abc').name).toBe('');
  });
});

describe('bài tổng hợp: tiêu đề và thứ tự mục', () => {
  it('tiêu đề viết hoa từng chữ, mục xếp hạng xuống cuối', () => {
    expect(roundupTitle(6, 'hủ tiếu', 'Phan Rang')).toBe('Top 6 Quán Hủ Tiếu Phan Rang Được Đánh Giá Cao');
    const a = moveRankingSectionLast({ title: '', metaDescription: '', h1: '', excerpt: '', quickSummary: [], intro: '', sections: [{ heading: 'Cách tôi xếp hạng các quán này', level: 2, body: 'x' }, { heading: 'So sánh nhanh', level: 2, body: 'y' }, { heading: '1. Ông Giáo', level: 2, body: 'z' }], faq: [], nextSteps: '', images: [], targetKeyword: '', secondaryKeywords: [], style: 'story' });
    expect(a.sections.map((s) => s.heading)).toEqual(['So sánh nhanh', '1. Ông Giáo', 'Cách tôi xếp hạng các quán này']);
  });
});

describe('bài giới thiệu thương hiệu (mock)', () => {
  it('đọc link rút gọn, lấy địa điểm, đánh giá, bộ ảnh; bài có mục liên hệ và bộ ảnh; xuất JSON-LD LocalBusiness', async () => {
    const run = db.createRun('Thương hiệu từ Google Maps', RunOptionsSchema.parse({ kind: 'brand', mapsUrl: 'https://maps.app.goo.gl/abc123', brandInfo: 'Mở từ 2015\nNước lèo hầm xương 6 tiếng', voice: 'chung_toi', minWords: 700, maxWords: 1400 }));
    worker.enqueue(run.id);
    const done = await worker.runToCompletion(run.id, 60_000);
    expect(done.status).toBe('done');
    expect(done.keyword).toBe('Hủ Tiếu Nam Vang Ông Giáo');
    const data = db.getArtifact<PlacesData>(run.id, 'places')!.content;
    const p = data.candidates[0]!;
    expect(p.featured).toBe(true);
    expect(p.reviewsFetched.length).toBe(16);
    expect(p.summary).not.toBeNull();
    expect(p.photoFiles!.length).toBe(6);
    expect(p.openingHours).toBe('Hằng ngày 05:00 đến 12:00');
    expect(p.price).toBe('bình dân (dưới 100.000 đ một người)');
    const article = latestArticle(db, run.id)!.article;
    const contact = article.sections.find((s) => /liên hệ/i.test(s.heading))!;
    expect(contact.body).toContain('**Địa chỉ:** 89 Văn Cao');
    expect(contact.body).toContain('**Liên hệ:** 0847 939 688 · [Website](http://facebook.com/hutieuonggiao)');
    expect(contact.body).toContain('Mở Google Maps');
    const gallery = article.sections.find((s) => /hình ảnh/i.test(s.heading))!;
    expect((gallery.body.match(/!\[/g) ?? []).length).toBe(6);
    expect(article.sections.indexOf(gallery)).toBeLessThan(article.sections.indexOf(contact));
    expect(article.images.filter((im) => im.src).length).toBe(6);
    const bundle = await buildRunBundle(db, run, { exportsDir: loadConfig().exportsDir });
    const html = bundle.html;
    expect(html).toContain('"@type":"Restaurant"');
    expect(html).toContain('"telephone":"0847 939 688"');
    const json = bundle.json as unknown as { kindDetail: string; brand: { photos: string[]; name: string } };
    expect(json.kindDetail).toBe('brand');
    expect(json.brand.photos.length).toBe(6);
    expect(fs.existsSync(path.join(loadConfig().exportsDir, String(run.id), json.brand.photos[0]!))).toBe(true);
  });
});
