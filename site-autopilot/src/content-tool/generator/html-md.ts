/**
 * Model đôi khi lỡ viết thân bài bằng HTML (bảng <table>, đoạn <p>, danh sách <ul>) dù đã được dặn dùng markdown.
 * Trước đây tool xóa thẳng thẻ HTML nên bảng và các đoạn dính thành một khối chữ. Ở đây chuyển HTML đơn giản
 * thành markdown tương ứng: bảng, danh sách, heading, trích dẫn, đoạn, in đậm, in nghiêng, liên kết, ảnh.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

const HAS_HTML = /<\/?(table|tr|td|th|p|br|ul|ol|li|h[1-6]|div|section|article|blockquote|strong|b|em|i|a|img|code|span)\b[^>]*>/i;

/** Có thẻ HTML đáng chuyển không (không tính dấu "<" trong văn bản thường như "giá < 100k"). */
export function hasHtml(s: string): boolean {
  return HAS_HTML.test(s);
}

/** Thẻ trong dòng: in đậm, in nghiêng, liên kết, ảnh, xuống dòng. */
function inline(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = /\bsrc\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
      const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
      return src ? `![${alt}](${src})` : '';
    })
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const t = text.replace(/<[^>]+>/g, '').trim();
      return t ? `[${t}](${href})` : '';
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => (inner.trim() ? `**${inner.trim()}**` : ''))
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => (inner.trim() ? `*${inner.trim()}*` : ''))
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<\/?(span|font|u|small|sup|sub|mark)\b[^>]*>/gi, '');
}

/** Văn bản thuần của một khối: chuyển thẻ trong dòng, bỏ thẻ còn lại, giải mã ký tự. */
function blockText(html: string): string {
  return decodeEntities(inline(html).replace(/<\/?[a-z][^>]*>/gi, '')).trim();
}

function cellText(html: string): string {
  return blockText(html).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

function tableToMd(inner: string): string {
  const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((m) => [...(m[1] ?? '').matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi)].map((c) => cellText(c[2] ?? '')))
    .filter((r) => r.length);
  if (!rows.length) return '\n\n';
  const cols = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array.from({ length: cols - r.length }, () => '')];
  const line = (r: string[]) => `| ${pad(r).join(' | ')} |`;
  const [head, ...body] = rows;
  return ['', '', line(head!), `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`, ...body.map(line), '', ''].join('\n');
}

function listToMd(inner: string, ordered: boolean): string {
  const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => blockText(m[1] ?? '').replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  if (!items.length) return '\n\n';
  return ['', '', ...items.map((t, i) => (ordered ? `${i + 1}. ${t}` : `- ${t}`)), '', ''].join('\n');
}

/** Chuyển HTML đơn giản trong một trường markdown thành markdown; chuỗi không có thẻ thì trả về nguyên. */
export function htmlToMarkdown(s: string): string {
  if (!hasHtml(s)) return s;
  let t = s.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner: string) => tableToMd(inner));
  t = t.replace(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, tag: string, inner: string) => listToMd(inner, tag.toLowerCase() === 'ol'));
  t = t.replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_m, inner: string) => `\n\n**${blockText(inner).replace(/\s*\n\s*/g, ' ')}**\n\n`);
  t = t.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => `\n\n${blockText(inner).split(/\n+/).map((l) => `> ${l.trim()}`).join('\n')}\n\n`);
  t = t.replace(/<(p|div|section|article)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner: string) => `\n\n${inline(inner).trim()}\n\n`);
  // Thẻ khối lẻ (không đóng hoặc lồng sai) thành ngắt đoạn, rồi các thẻ trong dòng còn lại
  t = t.replace(/<\/?(p|div|section|article|tbody|thead|tfoot|tr|td|th|li|ul|ol|table|blockquote|h[1-6])\b[^>]*>/gi, '\n\n');
  t = inline(t);
  t = t.replace(/<\/?[a-z][^>]*>/gi, '');
  t = decodeEntities(t);
  return t
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Bảng markdown phải cách văn bản trước và sau một dòng trống, nếu không trình dựng coi cả khối là một đoạn văn
 * (chữ dính liền, mất cột). Chèn dòng trống ở ranh giới bảng và văn bản.
 */
export function separateTables(md: string): string {
  return md.replace(/([^\n|])\n(\|)/g, '$1\n\n$2').replace(/(\|)\n([^|\n])/g, '$1\n\n$2');
}
