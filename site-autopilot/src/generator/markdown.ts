import { marked } from 'marked';
import { escapeHtml } from '../core/util.js';

marked.setOptions({ gfm: true, breaks: false });

/** Markdown đơn giản -> HTML. Loại bỏ thẻ HTML thô để nội dung do AI sinh không chèn mã. */
export function mdToHtml(md: string): string {
  const cleaned = (md ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/^#{1,6}\s+/gm, '**')
    .replace(/—/g, ',');
  const html = marked.parse(cleaned, { async: false }) as string;
  return html.trim();
}

/** Markdown -> văn bản thuần, dùng cho meta description và schema. */
export function mdToText(md: string): string {
  return (md ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^-\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Giữ liên kết nội bộ chỉ khi đường dẫn có thật; liên kết nội bộ sai thành chữ thường, liên kết ngoài giữ nguyên.
 * validPaths: ['/', '/gioi-thieu/', '/dich-vu/', '/blog/abc/', ...]; chấp nhận thêm #anchor phía sau.
 */
export function sanitizeInternalLinks(md: string, validPaths: string[]): string {
  const valid = new Set(validPaths.map((p) => normalizePath(p)));
  return (md ?? '').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text: string, href: string) => {
    if (/^(https?:)?\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('tel:')) return whole;
    if (!href.startsWith('/') && !href.startsWith('#')) return text;
    if (href.startsWith('#')) return whole;
    const [pathPart] = href.split('#');
    const p = normalizePath(pathPart ?? '/');
    return valid.has(p) ? `[${text}](${p}${href.includes('#') ? '#' + href.split('#')[1] : ''})` : text;
  });
}

function normalizePath(p: string): string {
  let out = p.trim();
  if (!out.startsWith('/')) out = '/' + out;
  if (!out.endsWith('/')) out += '/';
  return out.replace(/\/index\.html\/$/, '/');
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function readingMinutes(md: string): number {
  return Math.max(1, Math.round(wordCount(mdToText(md)) / 200));
}

export { escapeHtml };
