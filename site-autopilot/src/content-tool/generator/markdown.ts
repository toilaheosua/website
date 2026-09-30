import { marked } from 'marked';
import fs from 'node:fs';
import path from 'node:path';
import { Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import type { Article, ContentStyleId } from '../core/types.js';
import { articleParts, articleWordCount } from './quality.js';
import { escapeHtml, slugify } from '../core/util.js';

/** Tiêu đề phần kết theo kiểu viết. */
export const NEXT_STEPS_HEADING: Record<ContentStyleId, string> = {
  story: 'Trước khi bạn đi thử',
  expert: 'Lời khuyên cuối trước khi bạn quyết định',
  playbook: 'Việc cần làm ngay',
};

export const FAQ_HEADING = 'Câu hỏi thường gặp';

export function articleToMarkdown(a: Article, opts: { frontMatter?: boolean } = {}): string {
  const lines: string[] = [];
  if (opts.frontMatter) {
    lines.push('---');
    lines.push(`title: "${a.title.replace(/"/g, '\\"')}"`);
    lines.push(`description: "${a.metaDescription.replace(/"/g, '\\"')}"`);
    lines.push(`keyword: "${a.targetKeyword.replace(/"/g, '\\"')}"`);
    lines.push(`slug: ${slugify(a.h1 || a.title)}`);
    lines.push('---', '');
  }
  lines.push(`# ${a.h1}`, '');
  lines.push(a.intro.trim(), '');
  if (a.quickSummary.length) {
    lines.push('> **Tóm tắt nhanh**');
    for (const s of a.quickSummary) lines.push(`> - ${s}`);
    lines.push('');
  }
  for (const s of a.sections) {
    lines.push(`${s.level === 3 ? '###' : '##'} ${s.heading}`, '', s.body.trim(), '');
  }
  if (a.faq.length) {
    lines.push(`## ${FAQ_HEADING}`, '');
    for (const f of a.faq) lines.push(`**${f.question}**`, '', f.answer.trim(), '');
  }
  if (a.nextSteps.trim()) lines.push(`## ${NEXT_STEPS_HEADING[a.style] ?? 'Bước tiếp theo'}`, '', a.nextSteps.trim(), '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false, gfm: true, breaks: false }) as string;
}

/** HTML thân bài (không có H1, dùng khi dán vào CMS đã có tiêu đề riêng). */
export function articleToHtml(a: Article, opts: { withH1?: boolean } = {}): string {
  const md = articleToMarkdown(a);
  const body = opts.withH1 ? md : md.replace(/^# .*\n\n?/, '');
  // Link Google Maps thành nút nổi bật; ảnh quán có lớp riêng để CMS giới hạn cỡ
  return markdownToHtml(body)
    .replace(/<a href="(https:\/\/www\.google\.com\/maps[^"]*)"/g, '<a class="maps-link" target="_blank" rel="noopener" href="$1"')
    .replace(/<img src="photos\//g, '<img class="place-photo" loading="lazy" src="photos/');
}

/** CSS dùng chung cho bản xem trước và file HTML: ảnh vừa phải, nút Google Maps nổi bật. */
export const ARTICLE_CSS = 'img{max-width:100%;height:auto}img.place-photo{display:block;width:100%;max-width:420px;max-height:300px;object-fit:cover;border-radius:10px;margin:8px 0 12px}a.maps-link{display:inline-block;font-weight:700;font-size:1.05em;color:#0b6b3a;background:#e6f6ec;border:1px solid #bfe3cc;border-radius:8px;padding:4px 12px;text-decoration:none;margin:2px 0}a.maps-link:hover{background:#d3efdd}';

/** Trang HTML hoàn chỉnh để xem trước hoặc lưu. */
export function articleToHtmlDocument(a: Article, opts: { jsonLd?: unknown } = {}): string {
  const ld = opts.jsonLd ? `\n<script type="application/ld+json">${JSON.stringify(opts.jsonLd).replace(/</g, '\u003c')}</script>` : '';
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(a.title)}</title>
<meta name="description" content="${escapeHtml(a.metaDescription)}">${ld}
<style>body{max-width:760px;margin:40px auto;padding:0 20px;font-family:"Segoe UI",Inter,system-ui,-apple-system,"Noto Sans",sans-serif;font-size:18px;line-height:1.75;color:#1f2937}h1,h2,h3{font-family:Inter,"Segoe UI",system-ui,sans-serif;line-height:1.25}h1{font-size:2rem}h2{font-size:1.45rem;margin-top:2em}h3{font-size:1.15rem}blockquote{border-left:4px solid #cbd5e1;margin:1.2em 0;padding:.4em 1em;background:#f8fafc}table{border-collapse:collapse;width:100%;font-size:.95em}th,td{border:1px solid #e2e8f0;padding:8px 10px;text-align:left}th{background:#f1f5f9}${ARTICLE_CSS}</style>
</head>
<body>
${articleToHtml(a, { withH1: true })}
</body>
</html>
`;
}

/** Bỏ ký hiệu markdown, giữ câu chữ, để gửi cho công cụ dò AI. Bỏ bảng vì công cụ dò không đọc bảng như văn xuôi. */
export function stripMarkdown(md: string): string {
  return md
    .split('\n')
    .filter((l) => !l.trim().startsWith('|') && !l.trim().startsWith('![') && !/^\s*\*\*(Địa chỉ|Đánh giá|Giờ mở cửa|Liên hệ)\*\*\s*:/i.test(l))
    .map((l) =>
      l
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*(- |\* |\d+\. )/, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
        .replace(/^#{1,6}\s+/, '')
        .trim(),
    )
    .filter(Boolean)
    .join('\n')
    .replace(/\n{2,}/g, '\n\n');
}

/** Văn bản thuần của toàn bài để quét AI: H1, mở bài, các mục, FAQ, kết. */
export function articleToPlainText(a: Article): string {
  const chunks: string[] = [a.h1, stripMarkdown(a.intro)];
  for (const s of a.sections) chunks.push(s.heading, stripMarkdown(s.body));
  for (const f of a.faq) chunks.push(f.question, stripMarkdown(f.answer));
  if (a.nextSteps.trim()) chunks.push(stripMarkdown(a.nextSteps));
  return chunks.filter(Boolean).join('\n\n');
}

/** Văn bản thuần theo từng phần, để gắn câu bị công cụ dò AI đánh dấu vào đúng vị trí trong bài. */
export function articlePlainParts(a: Article): { where: string; text: string }[] {
  return articleParts(a).map((p) => ({ where: p.where, text: stripMarkdown(p.text) }));
}

/**
 * JSON theo cấu trúc trang "post" của site-autopilot để nhập thẳng vào dashboard đó.
 * H3 được gộp vào body của H2 đứng trước dưới dạng dòng in đậm vì site-autopilot chỉ có một cấp heading.
 */
export function articleToSiteAutopilotJson(a: Article, meta: { keyword: string; sourceUrls: string[]; places?: Record<string, unknown>[]; brand?: Record<string, unknown> }): Record<string, unknown> {
  const sections: { heading: string; body: string; imageQuery: string }[] = [];
  for (const s of a.sections) {
    if (s.level === 3 && sections.length) {
      const last = sections[sections.length - 1]!;
      last.body = `${last.body.trim()}\n\n**${s.heading}**\n\n${s.body.trim()}`;
    } else {
      sections.push({ heading: s.heading, body: s.body.trim(), imageQuery: '' });
    }
  }
  const hero = a.images[0];
  return {
    kind: 'post',
    title: a.title,
    metaDescription: a.metaDescription,
    h1: a.h1,
    intro: a.intro,
    sections,
    faq: a.faq,
    heroImageQuery: hero?.query ?? '',
    heroImageAlt: hero?.alt ?? '',
    keyTakeaways: a.quickSummary,
    excerpt: a.excerpt,
    targetKeyword: a.targetKeyword || meta.keyword,
    readingMinutes: Math.max(1, Math.round(articleWordCount(a) / 220)),
    nextSteps: a.nextSteps,
    secondaryKeywords: a.secondaryKeywords,
    images: a.images,
    style: a.style,
    sources: meta.sourceUrls,
    ...(meta.places ? { kindDetail: 'roundup', places: meta.places } : {}),
    ...(meta.brand ? { kindDetail: 'brand', brand: meta.brand } : {}),
  };
}

/* ------------------------------------------------------------------ */
/*  DOCX                                                                 */
/* ------------------------------------------------------------------ */

function inlineRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push(new TextRun(text.slice(last, m.index)));
    runs.push(new TextRun({ text: m[1] ?? '', bold: true }));
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push(new TextRun(text.slice(last)));
  return runs.length ? runs : [new TextRun(text)];
}

/** Ảnh "photos/x.jpg" thành ImageRun nếu có file trong thư mục xuất; không có thì bỏ dòng ảnh. */
function imageParagraph(rel: string, alt: string, photoDir?: string): Paragraph | null {
  if (!photoDir) return null;
  const full = path.join(photoDir, rel);
  if (!fs.existsSync(full)) return null;
  const ext = rel.split('.').pop()?.toLowerCase();
  const type = ext === 'png' ? 'png' : ext === 'gif' ? 'gif' : ext === 'bmp' ? 'bmp' : 'jpg';
  return new Paragraph({
    children: [new ImageRun({ type, data: fs.readFileSync(full), transformation: { width: 480, height: 360 }, altText: { title: alt, description: alt, name: alt } })],
    spacing: { after: 120 },
  });
}

function mdToDocxBlocks(md: string, photoDir?: string): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  const blocks = md.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(block);
    if (img) {
      const p = img[2]!.startsWith('photos/') ? imageParagraph(img[2]!, img[1] ?? '', photoDir) : null;
      if (p) out.push(p);
      continue;
    }
    const lines = block.split('\n');
    if (lines.every((l) => l.trim().startsWith('|'))) {
      const rows = lines.filter((l) => !/^\|?\s*:?-{2,}/.test(l.replace(/\|/g, '').trim()) && !/^\|[\s|:-]+\|$/.test(l.trim()));
      const cells = rows.map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      if (cells.length) {
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: cells.map((r, ri) => new TableRow({ children: r.map((c) => new TableCell({ children: [new Paragraph({ children: ri === 0 ? [new TextRun({ text: c.replace(/\*\*/g, ''), bold: true })] : inlineRuns(c) })] })) })),
          }),
        );
      }
      continue;
    }
    if (lines.every((l) => /^\s*(- |\* )/.test(l))) {
      for (const l of lines) out.push(new Paragraph({ children: inlineRuns(l.replace(/^\s*(- |\* )/, '')), bullet: { level: 0 } }));
      continue;
    }
    if (lines.every((l) => /^\s*\d+\. /.test(l))) {
      for (const l of lines) out.push(new Paragraph({ children: inlineRuns(l.trim()), spacing: { after: 80 } }));
      continue;
    }
    if (lines.every((l) => l.trim().startsWith('>'))) {
      for (const l of lines) out.push(new Paragraph({ children: inlineRuns(l.replace(/^\s*>\s?/, '').replace(/^- /, '• ')), indent: { left: 600 }, spacing: { after: 80 } }));
      continue;
    }
    out.push(new Paragraph({ children: inlineRuns(lines.join(' ')), spacing: { after: 160 } }));
  }
  return out;
}

export async function articleToDocx(a: Article, opts: { photoDir?: string } = {}): Promise<Buffer> {
  const photoDir = opts.photoDir;
  const children: (Paragraph | Table)[] = [];
  children.push(new Paragraph({ text: a.h1, heading: HeadingLevel.HEADING_1 }));
  children.push(new Paragraph({ children: [new TextRun({ text: `Title SEO: ${a.title}`, italics: true, color: '666666' })] }));
  children.push(new Paragraph({ children: [new TextRun({ text: `Meta description: ${a.metaDescription}`, italics: true, color: '666666' })], spacing: { after: 240 } }));
  children.push(...mdToDocxBlocks(a.intro, photoDir));
  if (a.quickSummary.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Tóm tắt nhanh', bold: true })] }));
    for (const s of a.quickSummary) children.push(new Paragraph({ children: inlineRuns(s), bullet: { level: 0 } }));
  }
  for (const s of a.sections) {
    children.push(new Paragraph({ text: s.heading, heading: s.level === 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_2 }));
    children.push(...mdToDocxBlocks(s.body, photoDir));
  }
  if (a.faq.length) {
    children.push(new Paragraph({ text: FAQ_HEADING, heading: HeadingLevel.HEADING_2 }));
    for (const f of a.faq) {
      children.push(new Paragraph({ children: [new TextRun({ text: f.question, bold: true })] }));
      children.push(...mdToDocxBlocks(f.answer, photoDir));
    }
  }
  if (a.nextSteps.trim()) {
    children.push(new Paragraph({ text: NEXT_STEPS_HEADING[a.style] ?? 'Bước tiếp theo', heading: HeadingLevel.HEADING_2 }));
    children.push(...mdToDocxBlocks(a.nextSteps, photoDir));
  }
  const doc = new Document({ creator: 'viet-content', title: a.title, description: a.metaDescription, sections: [{ children }] });
  return Packer.toBuffer(doc);
}
