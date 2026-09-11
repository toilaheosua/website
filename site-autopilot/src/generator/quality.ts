import type { PageContent } from '../core/types.js';

/**
 * Cổng kiểm duyệt chất lượng nội dung, phần kiểm tra bằng code.
 * Chạy sau biên tập, trước khi trang được xuất bản. Lỗi "major" thì trang bị giữ lại chờ duyệt.
 * Phần AI đánh giá (rõ ràng, trùng ý, trả lời đúng nhu cầu) nằm ở ContentGenerator.reviewPage.
 */

export type IssueSeverity = 'major' | 'minor';

export interface QualityIssue {
  code: string;
  severity: IssueSeverity;
  /** Vị trí: title, intro, sections.2, faq.1, services.0 ... */
  where: string;
  message: string;
}

export interface ContentReview {
  pass: boolean;
  issues: QualityIssue[];
  /** Nhận xét ngắn của AI (nếu có) */
  summary?: string;
  /** Ai duyệt: 'auto' (đạt kiểm duyệt), 'user' (người dùng bấm Duyệt và đăng) */
  approvedBy?: 'auto' | 'user';
  checkedAt: string;
}

/** Số từ tối thiểu theo loại trang: đủ để trả lời nhu cầu, không ép độ dài. */
const MIN_WORDS: Record<PageContent['kind'], number> = { home: 250, about: 200, services: 200, blog: 15, post: 500, contact: 60, privacy: 120 };
const MIN_SECTIONS: Record<PageContent['kind'], number> = { home: 3, about: 2, services: 0, blog: 0, post: 3, contact: 1, privacy: 3 };

const BANNED_PHRASES = ['trong thời đại 4.0', 'không thể phủ nhận rằng', 'hãy cùng tìm hiểu', 'như đã đề cập ở trên', 'như chúng ta đã biết', 'chúng tôi tự hào', 'uy tín số 1', 'hàng đầu việt nam', 'tinh hoa ẩm thực', 'in today', 'in conclusion', 'it is important to note'];
const EMPTY_CLAIMS = [/\buy tín\b.{0,20}\bchuyên nghiệp\b/i, /\bchuyên nghiệp\b.{0,20}\buy tín\b/i, /\bgiá (rẻ|tốt) nhất\b/i, /\btốt nhất (thị trường|khu vực|việt nam)\b/i, /\bsố 1\b/i, /\bhàng đầu\b/i, /\bđẳng cấp\b/i];
const GENERIC_HEADINGS = ['tổng quan', 'giới thiệu', 'kết luận', 'lời kết', 'tóm lại', 'overview', 'introduction', 'conclusion'];

export function wordCount(text: string): number {
  return text
    .replace(/[|#*>_`\-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function allBodies(page: PageContent): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [{ where: 'intro', text: page.intro }];
  page.sections.forEach((s, i) => out.push({ where: `sections.${i}`, text: s.body }));
  (page.services ?? []).forEach((s, i) => out.push({ where: `services.${i}`, text: s.body }));
  page.faq.forEach((f, i) => out.push({ where: `faq.${i}`, text: f.answer }));
  return out;
}

function paragraphs(md: string): string[] {
  return md
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('|') && !p.startsWith('- ') && !/^\d+\. /.test(p) && !p.startsWith('>'));
}

function norm(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Sửa tự động các lỗi hình thức không cần AI: gạch ngang dài, thẻ HTML, heading # trong body. */
export function autoFixPage(page: PageContent): PageContent {
  const fixMd = (md: string) =>
    md
      .replace(/\s*[—–]\s*/g, ', ')
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .replace(/^#{1,6}\s+(.+)$/gm, '**$1**');
  const fixText = (t: string) => t.replace(/\s*[—–]\s*/g, ', ').replace(/<\/?[a-z][^>]*>/gi, '').trim();
  return {
    ...page,
    title: fixText(page.title),
    metaDescription: fixText(page.metaDescription),
    h1: fixText(page.h1),
    intro: fixMd(page.intro),
    excerpt: page.excerpt ? fixText(page.excerpt) : page.excerpt,
    keyTakeaways: page.keyTakeaways?.map(fixText),
    sections: page.sections.map((s) => ({ ...s, heading: fixText(s.heading), body: fixMd(s.body) })),
    faq: page.faq.map((f) => ({ question: fixText(f.question), answer: fixMd(f.answer) })),
    services: page.services?.map((s) => ({ ...s, name: fixText(s.name), summary: fixText(s.summary), body: fixMd(s.body) })),
  };
}

/** Kiểm tra bằng code. Trả về danh sách lỗi; trang đạt khi không có lỗi major. */
export function checkQuality(page: PageContent): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const add = (code: string, severity: IssueSeverity, where: string, message: string) => issues.push({ code, severity, where, message });
  const kind = page.kind;

  // Thẻ SEO
  const tl = page.title.trim().length;
  if (tl < 20) add('title_short', 'major', 'title', `Title quá ngắn (${tl} ký tự)`);
  else if (tl > 80) add('title_long', 'minor', 'title', `Title dài ${tl} ký tự, Google thường cắt sau 65`);
  const ml = page.metaDescription.trim().length;
  if (ml < 60) add('meta_short', 'major', 'metaDescription', `Meta description quá ngắn (${ml} ký tự)`);
  else if (ml > 200) add('meta_long', 'minor', 'metaDescription', `Meta description dài ${ml} ký tự, nên dưới 160`);
  if (!page.h1.trim()) add('h1_empty', 'major', 'h1', 'Thiếu H1');
  if (!page.intro.trim() && kind !== 'privacy') add('intro_empty', 'major', 'intro', 'Thiếu đoạn mở đầu');

  // Độ dài và cấu trúc
  const bodies = allBodies(page);
  const total = bodies.reduce((n, b) => n + wordCount(b.text), 0) + wordCount(page.h1);
  if (total < MIN_WORDS[kind]) add('too_short', 'major', 'page', `Nội dung chỉ ${total} từ, chưa đủ để trả lời nhu cầu của trang ${kind} (tối thiểu ${MIN_WORDS[kind]})`);
  if (page.sections.length < MIN_SECTIONS[kind]) add('few_sections', 'major', 'sections', `Chỉ có ${page.sections.length} mục, trang ${kind} cần ít nhất ${MIN_SECTIONS[kind]}`);
  if (kind === 'services' && !(page.services?.length)) add('no_services', 'major', 'services', 'Trang dịch vụ không có mục dịch vụ nào');
  page.sections.forEach((s, i) => {
    if (!s.heading.trim()) add('heading_empty', 'major', `sections.${i}`, 'Mục không có tiêu đề');
    if (wordCount(s.body) < 25) add('section_thin', kind === 'contact' || kind === 'privacy' ? 'minor' : 'major', `sections.${i}`, `Mục "${s.heading}" chỉ ${wordCount(s.body)} từ`);
    if (GENERIC_HEADINGS.includes(norm(s.heading))) add('heading_generic', 'minor', `sections.${i}`, `Heading chung chung "${s.heading}", nên nói rõ thông tin hoặc kết quả`);
  });
  page.faq.forEach((f, i) => {
    if (!f.question.trim() || !f.answer.trim()) add('faq_empty', 'major', `faq.${i}`, 'Câu hỏi hoặc câu trả lời trống');
  });

  // Trùng lặp
  const headings = page.sections.map((s) => norm(s.heading));
  headings.forEach((h, i) => {
    if (h && headings.indexOf(h) !== i) add('heading_dup', 'major', `sections.${i}`, `Heading "${page.sections[i]?.heading}" bị lặp`);
  });
  const questions = page.faq.map((f) => norm(f.question));
  questions.forEach((q, i) => {
    if (q && questions.indexOf(q) !== i) add('faq_dup', 'major', `faq.${i}`, 'Câu hỏi FAQ bị lặp');
  });
  const seen = new Map<string, string>();
  for (const b of bodies) {
    for (const p of paragraphs(b.text)) {
      const key = norm(p);
      if (key.length < 60) continue;
      const first = seen.get(key);
      if (first && first !== b.where) add('paragraph_dup', 'major', b.where, `Đoạn văn lặp lại nguyên văn đoạn ở ${first}: "${p.slice(0, 60)}..."`);
      else seen.set(key, b.where);
    }
  }

  // Câu sáo rỗng, quảng cáo rỗng, khuôn mẫu
  const fullText = [page.title, page.h1, page.metaDescription, ...bodies.map((b) => b.text)].join('\n');
  const lower = norm(fullText);
  const banned = BANNED_PHRASES.filter((p) => lower.includes(p));
  if (banned.length) add('banned_phrase', banned.length >= 3 ? 'major' : 'minor', 'page', `Câu sáo rỗng cần bỏ: ${banned.join(', ')}`);
  const claims = EMPTY_CLAIMS.map((re) => fullText.match(re)?.[0]).filter((m): m is string => Boolean(m));
  if (claims.length) add('empty_claim', claims.length >= 3 ? 'major' : 'minor', 'page', `Khẳng định quảng cáo không có bằng chứng: ${[...new Set(claims)].join(', ')}`);
  if (/<\/?[a-z][^>]*>/i.test(fullText)) add('html_in_md', 'minor', 'page', 'Có thẻ HTML trong nội dung markdown');
  if (/^#{1,6}\s/m.test(bodies.map((b) => b.text).join('\n'))) add('md_heading_in_body', 'minor', 'page', 'Có heading # trong body, heading phải nằm ở trường riêng');

  // Mở đầu đoạn lặp cấu trúc
  const allParas = bodies.flatMap((b) => paragraphs(b.text));
  if (allParas.length >= 6) {
    const starts = new Map<string, number>();
    for (const p of allParas) {
      const k = norm(p).split(' ').slice(0, 2).join(' ');
      starts.set(k, (starts.get(k) ?? 0) + 1);
    }
    const [topStart, topCount] = [...starts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    if (topCount >= Math.max(4, Math.ceil(allParas.length * 0.4))) add('same_openers', 'minor', 'page', `${topCount} đoạn cùng mở bằng "${topStart}"`);
  }

  // Nhồi từ khóa
  if (page.targetKeyword && page.targetKeyword.trim().length > 3) {
    const kw = norm(page.targetKeyword);
    const count = lower.split(kw).length - 1;
    const limit = Math.max(8, Math.floor(total / 60));
    if (count > limit) add('keyword_stuffing', 'minor', 'page', `Từ khóa "${page.targetKeyword}" xuất hiện ${count} lần trong ${total} từ, nên giảm`);
  }

  // Liên kết nội bộ cho bài blog
  if (kind === 'post') {
    const links = (fullText.match(/\]\(\/[^)]*\)/g) ?? []).length;
    if (links === 0) add('no_internal_links', 'minor', 'page', 'Bài chưa có liên kết nội bộ nào');
    if (!page.keyTakeaways?.length) add('no_takeaways', 'minor', 'keyTakeaways', 'Bài chưa có "Tóm tắt nhanh"');
  }
  return issues;
}

export function isPass(issues: QualityIssue[]): boolean {
  return !issues.some((i) => i.severity === 'major');
}

/** Gộp lỗi thành danh sách chỉ dẫn cho lượt biên tập sửa lại. */
export function issuesToFeedback(issues: QualityIssue[]): string[] {
  return issues.map((i) => `[${i.severity === 'major' ? 'BẮT BUỘC' : 'nên'}] ${i.where}: ${i.message}`);
}
