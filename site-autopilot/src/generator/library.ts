import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Db, LibraryRow } from '../db/index.js';
import type { ImageSlot } from './images.js';
import { randomHex, slugify } from '../core/util.js';

/**
 * Kho ảnh thật của site: ảnh bạn tải lên hoặc nhập từ Google Maps, lưu trong data/sites/<domain>/images
 * với tiền tố lib-, chuyển sang WebP tối đa 1600px. Ảnh trong kho được ưu tiên hơn ảnh stock ở mọi vị trí.
 */
export async function saveLibraryImage(input: { db: Db; siteId: number; cacheDir: string; buffer: Buffer; alt: string; tags?: string[]; source?: string; sourceRef?: string | null; credit?: string; nameHint?: string }): Promise<LibraryRow> {
  fs.mkdirSync(input.cacheDir, { recursive: true });
  const out = await sharp(input.buffer).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  const meta = await sharp(out).metadata();
  const fileName = `lib-${slugify(input.nameHint || input.alt || 'anh').slice(0, 40)}-${randomHex(4)}.webp`;
  fs.writeFileSync(path.join(input.cacheDir, fileName), out);
  const id = input.db.addLibraryImage({
    site_id: input.siteId,
    file: `assets/img/${fileName}`,
    width: meta.width ?? null,
    height: meta.height ?? null,
    alt: input.alt,
    tags: (input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
    source: input.source ?? 'upload',
    source_ref: input.sourceRef ?? null,
    credit: input.credit ?? '',
  });
  return input.db.getLibraryImage(id) as LibraryRow;
}

export function deleteLibraryFile(cacheDir: string, row: LibraryRow): void {
  const p = path.join(cacheDir, path.basename(row.file));
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/** Từ khóa gợi ý của một slot để so với tag ảnh. */
function slotTerms(slot: ImageSlot): string[] {
  const terms: string[] = [];
  if (slot.key === 'home.hero') terms.push('hero', 'mat-tien', 'storefront', 'quan', 'trang-chu');
  if (slot.key === 'about.hero') terms.push('gioi-thieu', 'about', 'doi-ngu', 'team', 'bep', 'kitchen');
  if (slot.key === 'contact.hero') terms.push('lien-he', 'contact', 'mat-tien', 'storefront');
  if (slot.key.startsWith('service.')) terms.push(slot.key.slice('service.'.length), 'dich-vu', 'mon', 'dish', 'food');
  if (slot.key.startsWith('post.')) terms.push('bai-viet', 'blog', 'mon', 'dish', 'food');
  if (slot.key.includes('.section.')) terms.push('section', 'mon', 'dish', 'food', 'khong-gian', 'interior');
  for (const w of slugify(slot.query).split('-')) if (w.length > 2) terms.push(w);
  for (const w of slugify(slot.alt).split('-')) if (w.length > 2) terms.push(w);
  return terms;
}

/**
 * Gán ảnh trong kho cho các slot: ưu tiên ảnh có tag trùng, sau đó ảnh ít dùng nhất để phân bổ đều.
 * Trả về số slot đã gán. Slot đã có ảnh (từ kho hoặc stock còn tồn tại) được giữ nguyên trừ khi force.
 */
export function assignLibraryToSlots(db: Db, siteId: number, slots: ImageSlot[], cacheDir: string, opts: { force?: boolean } = {}): number {
  const library = db.listLibrary(siteId).filter((l) => fs.existsSync(path.join(cacheDir, path.basename(l.file))));
  if (library.length === 0) return 0;
  const usage = new Map<number, number>(library.map((l) => [l.id, 0]));
  let assigned = 0;
  // Hero trước để ảnh mặt tiền/đẹp nhất vào trang chủ
  const ordered = [...slots].sort((a, b) => (a.kind === 'hero' ? -1 : 0) - (b.kind === 'hero' ? -1 : 0));
  for (const slot of ordered) {
    const existing = db.getImage(siteId, slot.key);
    // Ảnh chọn tay hoặc cố ý để trống: không bao giờ tự đổi
    if (existing && (existing.provider === 'manual' || existing.provider === 'none')) {
      const lib = library.find((l) => l.file === existing.file);
      if (lib) usage.set(lib.id, (usage.get(lib.id) ?? 0) + 1);
      continue;
    }
    if (existing && !opts.force && existing.provider === 'library' && fs.existsSync(path.join(cacheDir, path.basename(existing.file)))) {
      const lib = library.find((l) => l.file === existing.file);
      if (lib) usage.set(lib.id, (usage.get(lib.id) ?? 0) + 1);
      continue;
    }
    const terms = slotTerms(slot);
    let best: LibraryRow | undefined;
    let bestScore = -1;
    for (const lib of library) {
      const tagScore = lib.tags.reduce((s, t) => s + (terms.includes(slugify(t)) ? 2 : 0), 0);
      const altScore = slugify(lib.alt).split('-').filter((w) => w.length > 2 && terms.includes(w)).length;
      const score = tagScore + altScore - (usage.get(lib.id) ?? 0) * 3;
      if (score > bestScore) {
        bestScore = score;
        best = lib;
      }
    }
    if (!best) continue;
    usage.set(best.id, (usage.get(best.id) ?? 0) + 1);
    db.upsertImage({
      site_id: siteId,
      key: slot.key,
      provider: 'library',
      provider_id: String(best.id),
      query: slot.query,
      file: best.file,
      width: best.width,
      height: best.height,
      alt: best.alt || slot.alt,
      credit: best.credit,
      credit_url: '',
    });
    assigned++;
  }
  return assigned;
}
