import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Db, Page } from '../db/index.js';
import type { ImageProvider, StockPhoto } from '../services/types.js';
import { createLogger } from '../core/logger.js';
import { slugify } from '../core/util.js';
import { errorMessage } from '../core/util.js';

const log = createLogger('images');

export interface ImageSlot {
  key: string;
  query: string;
  alt: string;
  kind: 'hero' | 'inline' | 'card';
}

/** Nhãn dễ hiểu cho một vị trí ảnh, dùng trên dashboard. */
export function slotLabel(key: string, pages: Page[], plan: { services: { name: string; slug?: string }[] }): { page: string; label: string } {
  if (key === 'home.hero') return { page: 'Trang chủ', label: 'Ảnh đầu trang' };
  if (key === 'about.hero') return { page: 'Giới thiệu', label: 'Ảnh chính' };
  if (key === 'contact.hero') return { page: 'Liên hệ', label: 'Ảnh chính' };
  if (key.startsWith('service.')) {
    const slug = key.slice('service.'.length);
    const s = plan.services.find((x) => (x.slug ?? slugify(x.name)) === slug);
    return { page: 'Dịch vụ', label: s?.name ?? slug };
  }
  const post = key.match(/^post\.(.+)\.hero$/);
  if (post) {
    const p = pages.find((x) => x.kind === 'post' && x.slug.replace(/^blog\//, '') === post[1]);
    return { page: `Bài: ${p?.title ?? post[1]}`, label: 'Ảnh đầu bài' };
  }
  const sec = key.match(/^(.*)\.section\.(\d+)$/);
  if (sec) {
    const slug = sec[1] === 'home' ? '' : (sec[1] as string);
    const p = pages.find((x) => x.slug === slug);
    const heading = p?.content.sections[Number(sec[2])]?.heading ?? `mục ${Number(sec[2]) + 1}`;
    return { page: p ? (p.kind === 'post' ? `Bài: ${p.title}` : p.title) : slug, label: `Ảnh trong mục "${heading}"` };
  }
  return { page: 'Khác', label: key };
}

/** Danh sách ảnh cần có cho site, suy ra từ nội dung các trang. */
export function collectImageSlots(pages: Page[], plan: { heroImageQuery: string; aboutImageQuery: string; services: { name: string; slug?: string; imageQuery: string }[] }, brandName: string): ImageSlot[] {
  const slots: ImageSlot[] = [];
  const seen = new Set<string>();
  const add = (s: ImageSlot) => {
    if (seen.has(s.key)) return;
    seen.add(s.key);
    slots.push(s);
  };
  add({ key: 'home.hero', query: plan.heroImageQuery, alt: `${brandName}`, kind: 'hero' });
  add({ key: 'about.hero', query: plan.aboutImageQuery, alt: `Giới thiệu ${brandName}`, kind: 'hero' });
  for (const s of plan.services) add({ key: `service.${s.slug ?? slugify(s.name)}`, query: s.imageQuery, alt: s.name, kind: 'card' });
  for (const p of pages) {
    const c = p.content;
    // Trang chính sách và trang danh sách blog không dùng ảnh minh họa trong section
    if (c.kind === 'privacy' || c.kind === 'blog') continue;
    if (c.kind === 'post') add({ key: `post.${p.slug.replace(/^blog\//, '')}.hero`, query: c.heroImageQuery || c.targetKeyword || c.h1, alt: c.heroImageAlt || c.h1, kind: 'hero' });
    if (c.kind === 'contact') add({ key: 'contact.hero', query: c.heroImageQuery || 'customer service office', alt: c.heroImageAlt || c.h1, kind: 'hero' });
    c.sections.forEach((sec, i) => {
      if (sec.imageQuery && sec.imageQuery.trim()) add({ key: `${p.slug || 'home'}.section.${i}`, query: sec.imageQuery, alt: sec.heading || c.h1, kind: 'inline' });
    });
  }
  return slots;
}

const SIZES: Record<ImageSlot['kind'], { width: number; height?: number }> = {
  hero: { width: 1600 },
  inline: { width: 1200 },
  card: { width: 800, height: 560 },
};

/**
 * Tìm và tải ảnh cho từng slot, chuyển WebP, lưu vào data/sites/<domain>/images.
 * Không dùng lại ảnh đã dùng ở site khác (bảng used_stock_images) để tránh trùng dấu vết.
 */
export async function fetchImagesForSlots(input: {
  db: Db;
  siteId: number;
  slots: ImageSlot[];
  provider: ImageProvider;
  cacheDir: string;
  language: 'vi' | 'en';
  /** false = không tải ảnh stock; slot chưa có ảnh sẽ để trống */
  useStock?: boolean;
  log?: (msg: string, data?: unknown) => void;
}): Promise<{ fetched: number; reused: number; skipped: number; failed: string[] }> {
  const { db, siteId, slots, provider, cacheDir } = input;
  fs.mkdirSync(cacheDir, { recursive: true });
  let fetched = 0;
  let reused = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const slot of slots) {
    const existing = db.getImage(siteId, slot.key);
    if (existing && (existing.provider === 'none' || fs.existsSync(path.join(cacheDir, path.basename(existing.file))))) {
      reused++;
      continue;
    }
    if (input.useStock === false) {
      skipped++;
      continue;
    }
    try {
      const photo = await pickPhoto(db, provider, slot.query);
      if (!photo) {
        failed.push(`${slot.key} (${slot.query})`);
        continue;
      }
      const raw = await provider.download(photo);
      const size = SIZES[slot.kind];
      const fileName = `${slugify(slot.key.replace(/\./g, '-'))}-${photo.id}.webp`;
      const pipeline = sharp(raw).rotate();
      const resized = size.height ? pipeline.resize({ width: size.width, height: size.height, fit: 'cover', withoutEnlargement: true }) : pipeline.resize({ width: size.width, withoutEnlargement: true });
      const out = await resized.webp({ quality: 78 }).toBuffer();
      const meta = await sharp(out).metadata();
      fs.writeFileSync(path.join(cacheDir, fileName), out);
      db.upsertImage({
        site_id: siteId,
        key: slot.key,
        provider: photo.provider,
        provider_id: photo.id,
        query: slot.query,
        file: `assets/img/${fileName}`,
        width: meta.width ?? null,
        height: meta.height ?? null,
        alt: slot.alt,
        credit: photo.photographer,
        credit_url: photo.pageUrl,
      });
      fetched++;
      input.log?.(`Ảnh ${slot.key}: ${photo.provider}#${photo.id} (${slot.query})`);
    } catch (err) {
      log.warn('Không lấy được ảnh', { slot: slot.key, err: errorMessage(err) });
      failed.push(`${slot.key}: ${errorMessage(err)}`);
    }
  }
  return { fetched, reused, skipped, failed };
}

async function pickPhoto(db: Db, provider: ImageProvider, query: string): Promise<StockPhoto | null> {
  const queries = [query, simplifyQuery(query)].filter((q, i, a) => q && a.indexOf(q) === i);
  for (const q of queries) {
    const photos = await provider.search(q, { perPage: 20, orientation: 'landscape', locale: 'en-US' });
    const fresh = photos.filter((p) => !db.isStockImageUsed(p.provider, p.id) && p.width >= 1200);
    const pool = fresh.length ? fresh : photos.filter((p) => p.width >= 1200);
    if (pool.length) return pool[Math.floor(Math.random() * Math.min(pool.length, 8))] ?? null;
  }
  return null;
}

function simplifyQuery(q: string): string {
  const words = q.split(/\s+/).filter(Boolean);
  return words.length > 2 ? words.slice(0, 2).join(' ') : words.join(' ');
}

/** Sao chép ảnh từ cache vào thư mục output của site. */
export function copyImagesToOutput(db: Db, siteId: number, cacheDir: string, outDir: string): number {
  const dest = path.join(outDir, 'assets', 'img');
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const img of db.listImages(siteId)) {
    if (!img.file || img.provider === 'none') continue;
    const src = path.join(cacheDir, path.basename(img.file));
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dest, path.basename(img.file)));
      n++;
    }
  }
  return n;
}
