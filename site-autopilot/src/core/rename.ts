import type { Db } from '../db/index.js';
import type { PageContent, SitePlan } from './types.js';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Các cặp thay thế khi đổi tên thương hiệu: tên đầy đủ, và phần đuôi 2 từ nếu chỉ đuôi khác (ví dụ "Ông Giao" → "Ông Giáo"). */
export function brandReplacementPairs(oldName: string, newName: string): [string, string][] {
  const a = oldName.trim();
  const b = newName.trim();
  if (!a || !b || a === b) return [];
  const pairs: [string, string][] = [[a, b]];
  const aw = a.split(/\s+/);
  const bw = b.split(/\s+/);
  if (aw.length >= 3 && bw.length >= 2) {
    const tailA = aw.slice(-2).join(' ');
    const tailB = bw.slice(-2).join(' ');
    if (tailA !== tailB && !a.endsWith(tailB)) pairs.push([tailA, tailB]);
  }
  return pairs;
}

function replaceDeep<T>(value: T, pairs: [string, string][], counter: { n: number }): T {
  if (typeof value === 'string') {
    let out: string = value;
    for (const [from, to] of pairs) {
      const re = new RegExp(escapeRegex(from), 'g');
      out = out.replace(re, () => {
        counter.n++;
        return to;
      });
    }
    return out as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => replaceDeep(v, pairs, counter)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = replaceDeep(v, pairs, counter);
    return out as T;
  }
  return value;
}

/** Thay chữ trong toàn bộ nội dung đã sinh của site (các trang, kế hoạch). Trả về số trang sửa và số lần thay. */
export function replaceTextInSite(db: Db, siteId: number, pairs: [string, string][]): { pages: number; replacements: number } {
  const valid = pairs.filter(([from, to]) => from && from !== to);
  if (!valid.length) return { pages: 0, replacements: 0 };
  let pages = 0;
  let replacements = 0;
  for (const page of db.listPages(siteId)) {
    const counter = { n: 0 };
    const content = replaceDeep<PageContent>(page.content, valid, counter);
    if (counter.n > 0) {
      db.upsertPage({ site_id: siteId, kind: page.kind, slug: page.slug, title: content.title, content, sort_order: page.sort_order });
      pages++;
      replacements += counter.n;
    }
  }
  const site = db.getSite(siteId);
  if (site?.plan) {
    const counter = { n: 0 };
    const plan = replaceDeep<SitePlan>(site.plan, valid, counter);
    if (counter.n > 0) {
      db.updateSite(siteId, { plan });
      replacements += counter.n;
    }
  }
  return { pages, replacements };
}
