import path from 'node:path';
import { AppError } from './errors.js';
import { readZip, type ZipEntry } from './zip.js';
import { faqToText, findImageRefs, markdownToSections, type ManualPostInput } from './manual-post.js';

/**
 * Nhập bài viết từ file: ZIP (bài + thư mục ảnh), hoặc .md / .json / .txt đơn lẻ.
 * Nhận diện tiêu đề, meta, từ khóa, đường dẫn, tóm tắt nhanh, các mục, FAQ và ảnh trong bài.
 * Kết quả là dữ liệu điền sẵn vào form soạn bài để người dùng xem lại rồi đăng.
 */

export interface ImportedImage {
  /** đường dẫn như xuất hiện trong bài, ví dụ photos/1-ong-giao.jpg */
  ref: string;
  fileName: string;
  data: Buffer;
  alt: string;
}

export interface ImportResult {
  values: ManualPostInput;
  images: ImportedImage[];
  /** Ghi chú nhận diện để hiện cho người dùng */
  notes: string[];
  /** Ảnh được nhắc trong bài nhưng không có trong gói */
  missingImages: string[];
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;

function parseFrontMatter(md: string): { meta: Record<string, string>; body: string } {
  const m = md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: md.replace(/^﻿/, '') };
  const meta: Record<string, string> = {};
  for (const line of (m[1] as string).split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    meta[(kv[1] as string).toLowerCase()] = (kv[2] as string).trim().replace(/^["'](.*)["']$/, '$1');
  }
  return { meta, body: md.slice(m[0].length) };
}

/** Khối "> **Tóm tắt nhanh**" + "> - ý" → danh sách ý; trả về body đã bỏ khối đó. */
function extractTakeaways(md: string): { takeaways: string[]; body: string } {
  const re = /(?:^|\n)>\s*\*\*(?:Tóm tắt nhanh|Key takeaways|Tóm tắt)[^\n]*\n((?:>[^\n]*\n?)+)/i;
  const m = md.match(re);
  if (!m) return { takeaways: [], body: md };
  const items = (m[1] as string)
    .split('\n')
    .map((l) => l.replace(/^>\s*/, '').replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
  return { takeaways: items, body: md.replace(m[0], '\n') };
}

/** Mục "Câu hỏi thường gặp": câu hỏi in đậm (hoặc ### / Q:), trả lời là các đoạn tiếp theo. */
function parseFaqSection(body: string): { question: string; answer: string }[] {
  const out: { question: string; answer: string }[] = [];
  let cur: { question: string; answer: string[] } | null = null;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const q = line.match(/^(?:\*\*(.+?)\*\*|#{3,4}\s+(.+)|(?:Q|Hỏi|Câu hỏi)\s*[:.]\s*(.+))$/);
    if (q) {
      if (cur) out.push({ question: cur.question, answer: cur.answer.join('\n').trim() });
      cur = { question: (q[1] ?? q[2] ?? q[3] ?? '').trim(), answer: [] };
      continue;
    }
    if (cur) cur.answer.push(line.replace(/^(?:A|Đáp|Trả lời)\s*[:.]\s*/i, ''));
  }
  if (cur) out.push({ question: cur.question, answer: cur.answer.join('\n').trim() });
  return out.filter((f) => f.question && f.answer);
}

function fromMarkdown(md: string, jsonHint?: Record<string, unknown>): { values: ManualPostInput; notes: string[] } {
  const notes: string[] = [];
  const { meta, body: afterMeta } = parseFrontMatter(md);
  let body = afterMeta.replace(/\r\n?/g, '\n');
  // H1 đầu bài
  let h1 = '';
  const h1m = body.match(/^\s*#\s+(.+?)\s*$/m);
  if (h1m) {
    h1 = (h1m[1] as string).trim();
    body = body.replace(h1m[0], '');
  }
  const tk = extractTakeaways(body);
  body = tk.body;
  const parsed = markdownToSections(body);
  // Tách mục FAQ
  let faq: { question: string; answer: string }[] = [];
  const sections = parsed.sections.filter((s) => {
    if (/câu hỏi thường gặp|faq|hỏi đáp/i.test(s.heading)) {
      const f = parseFaqSection(s.body);
      if (f.length) {
        faq = f;
        return false;
      }
    }
    return true;
  });
  const j = jsonHint ?? {};
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const title = meta.title || str(j.title) || h1;
  const values: ManualPostInput = {
    title,
    slug: meta.slug || str(j.slug) || '',
    h1: h1 || str(j.h1) || title,
    metaDescription: meta.description || meta.metadescription || str(j.metaDescription) || parsed.intro.replace(/\s+/g, ' ').slice(0, 155),
    targetKeyword: meta.keyword || meta.targetkeyword || str(j.targetKeyword) || '',
    excerpt: meta.excerpt || str(j.excerpt) || '',
    keyTakeaways: (tk.takeaways.length ? tk.takeaways : Array.isArray(j.keyTakeaways) ? (j.keyTakeaways as unknown[]).map(String) : []).join('\n'),
    body: [parsed.intro, ...sections.map((s) => `## ${s.heading}\n\n${s.body}`)].filter(Boolean).join('\n\n'),
    faq: faqToText(faq.length ? faq : Array.isArray(j.faq) ? (j.faq as { question: string; answer: string }[]).filter((f) => f?.question && f?.answer) : []),
    heroImageAlt: str(j.heroImageAlt),
  };
  notes.push(`Nhận diện từ markdown: ${sections.length} mục, ${faq.length} câu hỏi, ${tk.takeaways.length} ý tóm tắt${meta.title ? ', có front matter' : ''}`);
  return { values, notes };
}

function fromJson(j: Record<string, unknown>): { values: ManualPostInput; notes: string[] } {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const sections = Array.isArray(j.sections) ? (j.sections as { heading?: string; body?: string }[]).filter((s) => s?.heading) : [];
  const parts = [str(j.intro), ...sections.map((s) => `## ${str(s.heading)}\n\n${str(s.body)}`)];
  if (str(j.nextSteps)) parts.push(`## Bước tiếp theo\n\n${str(j.nextSteps)}`);
  const faq = Array.isArray(j.faq) ? (j.faq as { question: string; answer: string }[]).filter((f) => f?.question && f?.answer) : [];
  const values: ManualPostInput = {
    title: str(j.title),
    slug: str(j.slug),
    h1: str(j.h1) || str(j.title),
    metaDescription: str(j.metaDescription) || str(j.description),
    targetKeyword: str(j.targetKeyword) || str(j.keyword),
    excerpt: str(j.excerpt),
    keyTakeaways: (Array.isArray(j.keyTakeaways) ? (j.keyTakeaways as unknown[]).map(String) : []).join('\n'),
    body: parts.filter(Boolean).join('\n\n'),
    faq: faqToText(faq),
    heroImageAlt: str(j.heroImageAlt),
  };
  return { values, notes: [`Nhận diện từ JSON: ${sections.length} mục, ${faq.length} câu hỏi`] };
}

/** Bóc gói: ZIP → các tệp; tệp đơn → một tệp. */
export function unpackUpload(fileName: string, data: Buffer): ZipEntry[] {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.zip' || (data.length > 4 && data.readUInt32LE(0) === 0x04034b50)) return readZip(data);
  if (['.md', '.markdown', '.txt', '.json', '.html', '.htm'].includes(ext)) return [{ name: path.basename(fileName), data }];
  throw new AppError(`Không nhận dạng được loại file ${ext || '(không có đuôi)'}. Dùng .zip (bài + ảnh), .md, .json hoặc .txt.`);
}

/** Từ các tệp trong gói, chọn bài (ưu tiên .md, rồi .json, rồi .txt) và gom ảnh được nhắc trong bài. */
export function parseImportedPost(entries: ZipEntry[]): ImportResult {
  const byExt = (ext: string) => entries.filter((e) => e.name.toLowerCase().endsWith(ext) && !/(^|\/)\./.test(e.name) && !/^__MACOSX\//.test(e.name));
  const md = byExt('.md')[0] ?? byExt('.markdown')[0];
  const json = byExt('.json')[0];
  const txt = byExt('.txt').find((e) => !/doc-truoc|readme/i.test(e.name));
  let jsonObj: Record<string, unknown> | undefined;
  if (json) {
    try {
      const parsed = JSON.parse(json.data.toString('utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) jsonObj = parsed as Record<string, unknown>;
    } catch {
      /* JSON hỏng thì bỏ qua */
    }
  }
  let result: { values: ManualPostInput; notes: string[] };
  if (md) result = fromMarkdown(md.data.toString('utf8'), jsonObj);
  else if (jsonObj && typeof jsonObj.title === 'string') result = fromJson(jsonObj);
  else if (txt) result = fromMarkdown(txt.data.toString('utf8'), jsonObj);
  else throw new AppError('Không tìm thấy bài viết trong file (cần .md, .json hoặc .txt)');
  if (!result.values.title) throw new AppError('Không nhận diện được tiêu đề bài viết');

  // Ảnh: khớp đường dẫn trong bài với tệp trong gói (so theo tên tệp, bỏ qua thư mục)
  const imageFiles = entries.filter((e) => IMAGE_EXT.test(e.name) && !/^__MACOSX\//.test(e.name));
  const byBase = new Map(imageFiles.map((e) => [path.posix.basename(e.name).toLowerCase(), e]));
  const images: ImportedImage[] = [];
  const missing: string[] = [];
  const altOf = new Map<string, string>();
  for (const m of result.values.body.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) altOf.set(m[2] as string, (m[1] as string).trim());
  for (const ref of findImageRefs(result.values.body)) {
    if (/^https?:\/\//i.test(ref) || ref.startsWith('/assets/img/')) continue;
    const decoded = decodeURIComponent(ref);
    const file = byBase.get(path.posix.basename(decoded).toLowerCase());
    if (!file) {
      missing.push(ref);
      continue;
    }
    images.push({ ref, fileName: path.posix.basename(file.name), data: file.data, alt: altOf.get(ref) || path.posix.basename(decoded).replace(IMAGE_EXT, '').replace(/[-_]+/g, ' ') });
  }
  const notes = [...result.notes, `Ảnh: ${images.length} ảnh trong gói được dùng${missing.length ? `, ${missing.length} ảnh không có trong gói` : ''}`];
  return { values: result.values, images, notes, missingImages: missing };
}

/** Thay đường dẫn ảnh trong bài bằng đường dẫn kho; ảnh thiếu thì bỏ dòng ảnh. */
export function rewriteImageRefs(body: string, mapping: Map<string, string>, remove: string[] = []): string {
  let out = body;
  for (const [from, to] of mapping) out = out.split(`(${from})`).join(`(${to})`).split(`(${from} `).join(`(${to} `);
  for (const ref of remove) out = out.replace(new RegExp(`!\\[[^\\]]*\\]\\(${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s+"[^"]*")?\\)\\n?`, 'g'), '');
  return out;
}
