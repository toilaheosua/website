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
/**
 * Model hay viết cả bảng trên một dòng, các hàng nối nhau bằng "| |" và câu dẫn đứng ngay trước ô đầu:
 * "…của từng quán. | Quán | Sao | | Ốc Cô Ba | 4.7 | | …". Trình dựng coi đó là một đoạn văn. Tách lại thành
 * câu dẫn riêng và từng hàng một dòng, thêm dòng phân cách sau hàng tiêu đề nếu thiếu, bù ô cho hàng ngắn.
 */
export function repairInlineTables(md: string): string {
  const out: string[] = [];
  for (const line of md.split('\n')) {
    const boundaries = (line.match(/\|\s*\|/g) ?? []).length;
    if (boundaries < 2 || (line.match(/\|/g) ?? []).length < 6) {
      out.push(line);
      continue;
    }
    const first = line.indexOf('|');
    const lead = line.slice(0, first).trim();
    const rows = line
      .slice(first)
      .split(/\|\s*\|/)
      .map((r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').trim())
      .filter((r) => r.length)
      .map((r) => r.split('|').map((c) => c.trim()));
    if (rows.length < 2) {
      out.push(line);
      continue;
    }
    if (lead) out.push(lead, '');
    const cols = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => [...r, ...Array.from({ length: cols - r.length }, () => '')];
    const fmt = (r: string[]) => `| ${pad(r).join(' | ')} |`;
    const [head, ...body] = rows;
    out.push(fmt(head!));
    if (!body.length || !body[0]!.every((c) => /^:?-{2,}:?$/.test(c))) out.push(`| ${Array.from({ length: cols }, () => '---').join(' | ')} |`);
    for (const r of body) if (!r.every((c) => /^:?-{2,}:?$/.test(c))) out.push(fmt(r));
  }
  return ensureTableSeparators(out.join('\n'));
}

export function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

/**
 * Gạch ngang dài trong văn xuôi thành dấu phẩy (văn tiếng Việt không dùng gạch ngang giữa câu), nhưng trong ô bảng
 * "100–300 đ", "17:00–22:30" là khoảng số: thành "-" ; ô chỉ có một gạch nghĩa là không có dữ liệu: để trống.
 */
export function replaceDashes(md: string): string {
  return md
    .split('\n')
    .map((l) => (isTableRow(l) ? l.replace(/\|\s*[—–-]\s*(?=\|)/g, '| ').replace(/\s*[—–]\s*/g, '-') : l.replace(/\s*[—–]\s*/g, ', ')))
    .join('\n');
}

/**
 * Bảng model hay viết hỏng theo nhiều kiểu: các hàng cách nhau bằng dòng trống (mỗi hàng thành một đoạn),
 * thiếu dòng phân cách, cả bảng trên một dòng. Gom hàng lại, chèn phân cách; gọi sau mọi bước dọn khác.
 */
export function normalizeTables(md: string): string {
  let out = md;
  // Hàng bảng cách nhau bằng dòng trống: kéo sát lại (lặp tới khi không còn)
  let prev = '';
  while (prev !== out) {
    prev = out;
    out = out.replace(/(\|[^\n]*\|)[ \t]*\n(?:[ \t]*\n)+(?=[ \t]*\|)/g, '$1\n');
  }
  return ensureTableSeparators(out);
}

/** Khối bảng (các dòng liền nhau bắt đầu bằng "|") mà dòng hai không phải dòng phân cách thì chèn vào. */
export function ensureTableSeparators(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    out.push(l);
    const isRow = (s: string | undefined) => !!s && /^\s*\|.*\|\s*$/.test(s);
    const prevIsRow = i > 0 && isRow(lines[i - 1]);
    if (isRow(l) && !prevIsRow && isRow(lines[i + 1])) {
      const next = lines[i + 1]!.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      if (!next.every((c) => /^:?-{2,}:?$/.test(c))) {
        const cols = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length;
        out.push(`| ${Array.from({ length: cols }, () => '---').join(' | ')} |`);
      }
    }
  }
  return out.join('\n');
}

export function separateTables(md: string): string {
  return md.replace(/([^\n|])\n(\|)/g, '$1\n\n$2').replace(/(\|)\n([^|\n])/g, '$1\n\n$2');
}
