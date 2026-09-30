import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type { Article, PlacesData, RunOptions } from '../core/types.js';
import { articleToDocx, articleToHtmlDocument, articleToMarkdown, articleToPlainText, articleToSiteAutopilotJson } from './markdown.js';
import { placesForExport, placesJsonLd } from '../core/roundup.js';
import { brandForExport, brandJsonLd } from '../core/brand.js';

/**
 * Ảnh trong bài được tham chiếu bằng đường dẫn tương đối "photos/ten-anh.jpg" so với thư mục xuất.
 * Khi xuất để đăng web, đường dẫn đó được đổi thành URL tuyệt đối (Cài đặt → URL gốc ảnh),
 * hoặc nhúng thẳng vào HTML, hoặc đóng gói cùng ảnh trong file ZIP.
 */

export const PHOTO_MD_RE = /!\[([^\]]*)\]\((photos\/[^)\s]+)\)/g;

export function photoMime(rel: string): string {
  const ext = rel.split('.').pop()?.toLowerCase();
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
}

/** Đổi mọi tham chiếu ảnh "photos/..." trong bài theo hàm map (thân mục và danh sách ảnh). */
export function rewritePhotoRefs(a: Article, map: (rel: string) => string): Article {
  const fix = (md: string) => md.replace(PHOTO_MD_RE, (_m, alt: string, rel: string) => `![${alt}](${map(rel)})`);
  return {
    ...a,
    intro: fix(a.intro),
    sections: a.sections.map((s) => ({ ...s, body: fix(s.body) })),
    faq: a.faq.map((f) => ({ ...f, answer: fix(f.answer) })),
    nextSteps: fix(a.nextSteps),
    images: a.images.map((im) => (im.src?.startsWith('photos/') ? { ...im, src: map(im.src) } : im)),
  };
}

/** URL tuyệt đối cho ảnh: "https://site.vn/uploads/2026/09" + tên file. */
export function photoUrl(baseUrl: string, rel: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/${path.posix.basename(rel)}`;
}

export function withPhotoBase(a: Article, baseUrl: string): Article {
  return baseUrl.trim() ? rewritePhotoRefs(a, (rel) => photoUrl(baseUrl, rel)) : a;
}

/** Đọc ảnh trong thư mục xuất thành data URI để file HTML tự chứa ảnh. */
export function photoDataUri(dir: string, rel: string): string | null {
  const full = path.join(dir, rel);
  if (!fs.existsSync(full)) return null;
  return `data:${photoMime(rel)};base64,${fs.readFileSync(full).toString('base64')}`;
}

export function withEmbeddedPhotos(a: Article, dir: string): Article {
  return rewritePhotoRefs(a, (rel) => photoDataUri(dir, rel) ?? rel);
}

/** Các ảnh bài đang dùng và có file thật trong thư mục xuất. */
export function listArticlePhotos(a: Article, dir: string): { rel: string; data: Buffer }[] {
  const rels = new Set<string>();
  for (const text of [a.intro, ...a.sections.map((s) => s.body), ...a.faq.map((f) => f.answer), a.nextSteps]) {
    for (const m of text.matchAll(PHOTO_MD_RE)) rels.add(m[2]!);
  }
  for (const im of a.images) if (im.src?.startsWith('photos/')) rels.add(im.src);
  const out: { rel: string; data: Buffer }[] = [];
  for (const rel of rels) {
    const full = path.join(dir, rel);
    if (fs.existsSync(full)) out.push({ rel, data: fs.readFileSync(full) });
  }
  return out;
}

export interface ExportBundle {
  md: string;
  html: string;
  json: Record<string, unknown>;
  txt: string;
  docx: Buffer;
  photos: { rel: string; data: Buffer }[];
  /** Ảnh đang trỏ tới URL tuyệt đối (đã đặt URL gốc ảnh) hay đường dẫn tương đối */
  photoMode: 'url' | 'relative';
}

/**
 * Dựng đủ các định dạng xuất từ một bài:
 *  - có URL gốc ảnh: Markdown, HTML, JSON trỏ thẳng tới ảnh trên web của bạn (bạn tải thư mục photos lên đó trước)
 *  - không có: Markdown và JSON giữ đường dẫn tương đối (đi cùng thư mục photos trong ZIP), HTML nhúng ảnh sẵn
 *  - DOCX luôn nhúng ảnh
 */
export async function buildExportBundle(a: Article, opts: { keyword: string; dir: string; baseUrl: string; places: PlacesData | null; sourceUrls: string[]; brand?: RunOptions | null }): Promise<ExportBundle> {
  const photos = listArticlePhotos(a, opts.dir);
  const useUrl = Boolean(opts.baseUrl.trim());
  const forText = useUrl ? withPhotoBase(a, opts.baseUrl) : a;
  const forHtml = useUrl ? forText : withEmbeddedPhotos(a, opts.dir);
  const brandOpts = opts.brand ?? null;
  const placesOut = opts.places && !brandOpts ? placesForExport(opts.places).map((p) => ({ ...p, photoUrl: useUrl && typeof p.photo === 'string' ? photoUrl(opts.baseUrl, p.photo) : null })) : undefined;
  const brandOut = opts.places && brandOpts ? brandForExport(opts.places, brandOpts) : null;
  if (brandOut && useUrl) brandOut.photoUrls = (brandOut.photos as string[]).map((f) => photoUrl(opts.baseUrl, f));
  const json = articleToSiteAutopilotJson(forText, { keyword: opts.keyword, sourceUrls: opts.sourceUrls, ...(placesOut ? { places: placesOut } : {}), ...(brandOut ? { brand: brandOut } : {}) });
  const jsonLd = opts.places ? (brandOpts ? brandJsonLd(forText, opts.places, brandOpts) : placesJsonLd(forText, opts.places)) : undefined;
  return {
    md: articleToMarkdown(forText, { frontMatter: true }),
    html: articleToHtmlDocument(forHtml, jsonLd ? { jsonLd } : {}),
    json,
    txt: articleToPlainText(a),
    docx: await articleToDocx(a, { photoDir: opts.dir }),
    photos,
    photoMode: useUrl ? 'url' : 'relative',
  };
}

/** Gói ZIP: các file bài + thư mục photos, để tải một lần và đăng lên web. */
export async function bundleToZip(b: ExportBundle, base: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(`${base}.md`, b.md);
  zip.file(`${base}.html`, b.html);
  zip.file(`${base}.json`, JSON.stringify(b.json, null, 2));
  zip.file(`${base}.txt`, b.txt);
  zip.file(`${base}.docx`, b.docx);
  for (const p of b.photos) zip.file(p.rel, p.data);
  zip.file('DOC-TRUOC.txt', ['Trong gói này:', `- ${base}.md, .html, .json, .txt, .docx: bài viết ở các định dạng`, '- photos/: ảnh quán đã tải từ Google Maps (ảnh do Google và người dùng đăng, bạn tự chịu trách nhiệm bản quyền khi đăng lại)', '', b.photoMode === 'url' ? 'Ảnh trong bài đã trỏ tới URL gốc ảnh trong Cài đặt: tải thư mục photos lên đúng chỗ đó trước khi đăng bài.' : 'Ảnh trong bài dùng đường dẫn tương đối "photos/ten-anh.jpg". Cách nhanh nhất: đặt "URL gốc ảnh" trong Cài đặt (thư mục bạn sẽ tải ảnh lên, ví dụ https://site.vn/wp-content/uploads/2026/09), xuất lại, rồi tải ảnh lên đó. File .html đã nhúng sẵn ảnh, mở được ngay.'].join('\n'));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
