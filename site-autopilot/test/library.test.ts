import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../src/db/index.js';
import { EntitySchema, SiteBriefSchema } from '../src/core/types.js';
import { assignLibraryToSlots, saveLibraryImage } from '../src/generator/library.js';
import type { ImageSlot } from '../src/generator/images.js';

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-lib-'));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#c33' } }).png().toBuffer();

describe('kho ảnh thật', () => {
  it('lưu ảnh thành WebP có tiền tố lib- và gán vào slot theo tag, ưu tiên hero, phân bổ đều', async () => {
    const db = new Db(':memory:');
    const id = db.createSite({ domain: 'lib.com', server_id: null, brief: SiteBriefSchema.parse({ brandName: 'Quán A', industry: 'Ẩm thực' }), entity: EntitySchema.parse({}) });
    const cache = path.join(tmp, 'images');
    const front = await saveLibraryImage({ db, siteId: id, cacheDir: cache, buffer: await png(2000, 1200), alt: 'Mặt tiền quán', tags: ['mat-tien'] });
    const dish = await saveLibraryImage({ db, siteId: id, cacheDir: cache, buffer: await png(800, 600), alt: 'Tô hủ tiếu', tags: ['mon', 'hu-tieu-nam-vang'] });
    expect(front.file).toMatch(/^assets\/img\/lib-mat-tien-quan-[0-9a-f]{8}\.webp$/);
    expect(front.width).toBe(1600);
    expect(dish.width).toBe(800);
    expect(fs.existsSync(path.join(cache, path.basename(front.file)))).toBe(true);

    const slots: ImageSlot[] = [
      { key: 'service.hu-tieu-nam-vang', query: 'noodle soup', alt: 'Hủ tiếu Nam Vang', kind: 'card' },
      { key: 'home.hero', query: 'restaurant', alt: 'Quán A', kind: 'hero' },
      { key: 'post.bai-1.hero', query: 'noodles', alt: 'Bài 1', kind: 'hero' },
    ];
    const n = assignLibraryToSlots(db, id, slots, cache);
    expect(n).toBe(3);
    expect(db.getImage(id, 'home.hero')?.file).toBe(front.file);
    expect(db.getImage(id, 'service.hu-tieu-nam-vang')?.file).toBe(dish.file);
    // slot còn lại lấy ảnh ít dùng nhất (mỗi ảnh đã dùng 1 lần → theo tag "mon/dish" ưu tiên ảnh món)
    expect(db.getImage(id, 'post.bai-1.hero')?.provider).toBe('library');

    // Chạy lại không đổi gán, force thì gán lại
    expect(assignLibraryToSlots(db, id, slots, cache)).toBe(0);
    expect(assignLibraryToSlots(db, id, slots, cache, { force: true })).toBe(3);
    db.close();
  });

  it('kho trống thì không gán gì', () => {
    const db = new Db(':memory:');
    const id = db.createSite({ domain: 'empty.com', server_id: null, brief: SiteBriefSchema.parse({ brandName: 'B', industry: 'X' }), entity: EntitySchema.parse({}) });
    expect(assignLibraryToSlots(db, id, [{ key: 'home.hero', query: 'a', alt: 'a', kind: 'hero' }], path.join(tmp, 'none'))).toBe(0);
    db.close();
  });
});
