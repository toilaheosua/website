import type { Article, IssueSeverity, QualityIssue } from '../core/types.js';
import { normText, wordCount } from '../core/util.js';
import { headingMatches, stripInjectedLines } from '../core/roundup.js';

/**
 * Cổng kiểm duyệt chất lượng bằng code: cấu trúc, độ dài, câu sáo rỗng, dấu vết văn máy, nhồi từ khóa.
 * Lỗi "major" thì bài phải sửa; "minor" được đưa vào phản hồi cho lượt sửa nhưng không chặn.
 */

export const BANNED_PHRASES = [
  'trong thời đại 4.0',
  'không thể phủ nhận',
  'hãy cùng tìm hiểu',
  'hãy cùng khám phá',
  'như đã đề cập',
  'như chúng ta đã biết',
  'trong bài viết này',
  'qua bài viết này',
  'hy vọng bài viết',
  'nói tóm lại',
  'tóm lại,',
  'nhìn chung,',
  'không thể không nhắc đến',
  'một trong những',
  'đóng vai trò quan trọng',
  'không thể thiếu',
  'với sự phát triển của',
  'trên thị trường hiện nay',
  'điều quan trọng là',
  'cần lưu ý rằng',
  'tinh hoa ẩm thực',
  'hàng đầu việt nam',
  'uy tín số 1',
  'chúng tôi tự hào',
  'in conclusion',
  'it is important to note',
];
const EMPTY_CLAIMS = [/\buy tín\b.{0,20}\bchuyên nghiệp\b/i, /\bgiá (rẻ|tốt) nhất\b/i, /\btốt nhất (thị trường|khu vực|việt nam)\b/i, /\bsố 1\b/i, /\bhàng đầu\b/i, /\bđẳng cấp\b/i];
const GENERIC_HEADINGS = ['tổng quan', 'giới thiệu', 'kết luận', 'lời kết', 'tóm lại', 'tổng kết', 'overview', 'introduction', 'conclusion', 'mở đầu', 'nội dung', 'chi tiết'];
const AI_OPENERS = ['đầu tiên', 'thứ hai', 'thứ ba', 'cuối cùng', 'ngoài ra', 'bên cạnh đó', 'hơn nữa', 'tuy nhiên', 'do đó', 'vì vậy', 'tóm lại', 'nhìn chung', 'thêm vào đó', 'mặt khác'];

export interface ArticlePart {
  where: string;
  text: string;
}

/** Các phần văn bản của bài, dùng chung cho kiểm tra chất lượng và so trùng. */
export function articleParts(a: Article): ArticlePart[] {
  const parts: ArticlePart[] = [{ where: 'intro', text: a.intro }];
  a.sections.forEach((s, i) => parts.push({ where: `sections.${i}`, text: s.body }));
  a.faq.forEach((f, i) => parts.push({ where: `faq.${i}`, text: f.answer }));
  if (a.nextSteps.trim()) parts.push({ where: 'nextSteps', text: a.nextSteps });
  return parts;
}

export function paragraphsOf(md: string): string[] {
  return md
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('|') && !p.startsWith('- ') && !/^\d+\. /.test(p) && !p.startsWith('>'));
}

/** Tách câu để đo nhịp; bỏ dòng bảng và danh sách. */
export function sentencesOf(md: string): string[] {
  return md
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('|') && !/^\s*(- |\d+\. |> )/.test(l))
    .join(' ')
    .replace(/\*\*/g, '')
    .split(/(?<=[.!?…])\s+(?=[\p{Lu}"“(])/u)
    .map((s) => s.trim())
    .filter((s) => wordCount(s) >= 2);
}

export function articleWordCount(a: Article): number {
  return articleParts(a).reduce((n, p) => n + wordCount(p.text), 0) + wordCount(a.h1) + a.quickSummary.reduce((n, s) => n + wordCount(s), 0);
}

/** Sửa tự động lỗi hình thức không cần AI: gạch ngang dài, thẻ HTML, heading # trong body, khoảng trắng thừa. */
export function autoFixArticle(a: Article): Article {
  const fixMd = (md: string) =>
    md
      .replace(/\s*[—–]\s*/g, ', ')
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .replace(/^#{1,6}\s+(.+)$/gm, '**$1**')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  const fixText = (t: string) => t.replace(/\s*[—–]\s*/g, ', ').replace(/<\/?[a-z][^>]*>/gi, '').replace(/\s+/g, ' ').trim();
  return {
    ...a,
    title: capFirst(fixText(a.title)),
    metaDescription: capFirst(fixText(a.metaDescription)),
    h1: capFirst(fixText(a.h1)),
    excerpt: capFirst(fixText(a.excerpt)),
    quickSummary: a.quickSummary.map(fixText).filter(Boolean).map(capFirst),
    intro: fixMd(a.intro),
    sections: a.sections.map((s) => ({ ...s, heading: capFirst(fixText(s.heading)), body: fixMd(s.body) })),
    faq: a.faq.map((f) => ({ question: capFirst(fixText(f.question)), answer: fixMd(f.answer) })),
    nextSteps: fixMd(a.nextSteps),
  };
}

export interface QualityLimits {
  minWords: number;
  maxWords: number;
  /** Số H2 tối đa trước khi báo "nên gộp" (bài tổng hợp quán có nhiều mục hơn bài thường) */
  maxH2?: number;
  /** Mẫu câu bị cấm thêm cho kiểu bài này, lỗi bắt buộc (ví dụ câu than thiếu tư liệu trong bài tổng hợp quán) */
  bannedPatterns?: { re: RegExp; label: string }[];
  /** Bài tổng hợp quán: các mục quán (heading chứa tên trong names) phải khác nhau về câu mở đầu và cụm khen */
  distinctSections?: { names: string[]; dish: string };
}

/** Các đoạn văn xuôi của một mục, bỏ dòng tool chèn, ảnh và bảng. */
function proseParagraphs(md: string): string[] {
  return stripInjectedLines(md)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('![') && !p.startsWith('|') && !/^[-*]\s/.test(p));
}

/**
 * Các mục quán phải khác nhau: không hai mục mở đầu cùng bốn chữ, không một cụm năm chữ xuất hiện ở ba mục trở lên
 * (hoặc hai mục dùng chung từ ba cụm). Cụm chứa tên món được bỏ qua vì tên món lặp là tự nhiên.
 */
export function checkSectionRepeats(a: Article, idx: number[], dish = ''): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const openings = new Map<string, number[]>();
  const shingles = new Map<number, Set<string>>();
  const dishKey = normText(dish);
  for (const i of idx) {
    const paras = proseParagraphs(a.sections[i]!.body);
    if (!paras.length) continue;
    const words = normText(paras[0]!).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
    const key = words.slice(0, 4).join(' ');
    if (words.length >= 4) openings.set(key, [...(openings.get(key) ?? []), i]);
    const set = new Set<string>();
    const all = normText(paras.join(' ')).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
    for (let k = 0; k + 5 <= all.length; k++) {
      const sh = all.slice(k, k + 5).join(' ');
      if (!dishKey || !sh.includes(dishKey)) set.add(sh);
    }
    shingles.set(i, set);
  }
  for (const [key, list] of openings) {
    if (list.length < 2) continue;
    issues.push({ code: 'section_same_opening', severity: 'major', where: `sections.${list[1]}`, message: `Mục "${a.sections[list[0]!]!.heading}" và "${a.sections[list[1]!]!.heading}" mở đầu cùng một kiểu câu ("${key}..."). Viết lại câu đầu của mục sau, đi thẳng vào vai riêng của quán đó.` });
  }
  const count = new Map<string, number[]>();
  for (const [i, set] of shingles) for (const sh of set) count.set(sh, [...(count.get(sh) ?? []), i]);
  const shared = [...count.entries()].filter(([, list]) => list.length >= 3);
  const pairs = new Map<string, string[]>();
  for (const [sh, list] of count) if (list.length === 2) pairs.set(`${list[0]}-${list[1]}`, [...(pairs.get(`${list[0]}-${list[1]}`) ?? []), sh]);
  const heavyPair = [...pairs.entries()].find(([, list]) => list.length >= 3);
  if (shared.length || heavyPair) {
    const sample = (shared.length ? shared : [[heavyPair![1][0]!, heavyPair![0].split('-').map(Number)] as [string, number[]]]).slice(0, 3);
    const where = `sections.${sample[0]![1][sample[0]![1].length - 1]}`;
    issues.push({ code: 'section_repeated_phrase', severity: 'major', where, message: `Cụm chữ lặp ở nhiều mục quán: ${sample.map(([sh, list]) => `"${sh}" (${list.map((i) => `"${a.sections[i]!.heading}"`).join(', ')})`).join('; ')}${heavyPair && !shared.length ? ` và ${heavyPair[1].length - 1} cụm khác giữa hai mục này` : ''}. Mỗi quán chọn chi tiết khen riêng có trong ghi chú của chính quán đó, không dùng lại cách nói của quán khác.` });
  }
  return issues;
}

/** Viết hoa chữ cái đầu của một chuỗi (title, heading, câu tóm tắt). */
export function capFirst(s: string): string {
  // Chỉ viết hoa khi ký tự đầu là chữ; "6 quán ngon" giữ nguyên
  const t = s.trimStart();
  if (!t || !/^\p{L}/u.test(t)) return t;
  return t[0]!.toLocaleUpperCase('vi') + t.slice(1);
}

export function checkQuality(a: Article, limits: QualityLimits): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const add = (code: string, severity: IssueSeverity, where: string, message: string) => issues.push({ code, severity, where, message });

  // Thẻ SEO
  const tl = a.title.trim().length;
  if (tl < 20) add('title_short', 'major', 'title', `Title quá ngắn (${tl} ký tự), cần 50 đến 65`);
  else if (tl < 40) add('title_shortish', 'minor', 'title', `Title ${tl} ký tự, nên 50 đến 65`);
  else if (tl > 80) add('title_long', 'minor', 'title', `Title dài ${tl} ký tự, Google thường cắt sau 65`);
  const ml = a.metaDescription.trim().length;
  if (ml < 60) add('meta_short', 'major', 'metaDescription', `Meta description quá ngắn (${ml} ký tự), cần 140 đến 158`);
  else if (ml < 120) add('meta_shortish', 'minor', 'metaDescription', `Meta description ${ml} ký tự, nên 140 đến 158`);
  else if (ml > 175) add('meta_long', 'minor', 'metaDescription', `Meta description dài ${ml} ký tự, nên dưới 160`);
  if (!a.h1.trim()) add('h1_empty', 'major', 'h1', 'Thiếu H1');
  if (wordCount(a.intro) < 30) add('intro_thin', 'major', 'intro', `Đoạn mở đầu chỉ ${wordCount(a.intro)} từ`);
  if (a.quickSummary.length < 3) add('summary_few', 'minor', 'quickSummary', `"Tóm tắt nhanh" chỉ có ${a.quickSummary.length} ý, cần 3 đến 5`);
  if (a.quickSummary.length > 6) add('summary_many', 'minor', 'quickSummary', `"Tóm tắt nhanh" có ${a.quickSummary.length} ý, nên tối đa 5`);

  // Độ dài
  const total = articleWordCount(a);
  if (total < limits.minWords * 0.9) add('too_short', 'major', 'article', `Bài chỉ ${total} từ, cần ít nhất ${limits.minWords}`);
  else if (total < limits.minWords) add('slightly_short', 'minor', 'article', `Bài ${total} từ, hơi thiếu so với ${limits.minWords}`);
  if (total > limits.maxWords * 1.2) add('too_long', 'major', 'article', `Bài ${total} từ, vượt xa mức ${limits.maxWords}`);
  else if (total > limits.maxWords) add('slightly_long', 'minor', 'article', `Bài ${total} từ, hơi dài so với ${limits.maxWords}`);

  // Cấu trúc
  const h2 = a.sections.filter((s) => s.level === 2);
  if (h2.length < 3) add('few_sections', 'major', 'sections', `Chỉ có ${h2.length} mục H2, cần 4 đến 7`);
  else if (h2.length > (limits.maxH2 ?? 8)) add('many_sections', 'minor', 'sections', `${h2.length} mục H2, nên gộp còn 4 đến 7`);
  if (a.sections[0]?.level === 3) add('h3_first', 'minor', 'sections.0', 'Mục đầu tiên là H3, cần một H2 đứng trước');
  a.sections.forEach((s, i) => {
    const wc = wordCount(s.body);
    if (!s.heading.trim()) add('heading_empty', 'major', `sections.${i}`, 'Mục không có tiêu đề');
    if (wc < (s.level === 3 ? 20 : 30)) add('section_thin', 'major', `sections.${i}`, `Mục "${s.heading}" chỉ ${wc} từ`);
    if (GENERIC_HEADINGS.includes(normText(s.heading))) add('heading_generic', 'minor', `sections.${i}`, `Heading chung chung "${s.heading}", cần nói rõ thông tin hoặc kết quả`);
  });
  if (a.faq.length < 2) add('faq_few', 'minor', 'faq', `FAQ chỉ có ${a.faq.length} câu, cần 3 đến 5`);
  a.faq.forEach((f, i) => {
    if (!f.question.trim() || wordCount(f.answer) < 15) add('faq_thin', 'major', `faq.${i}`, 'Câu hỏi trống hoặc trả lời quá ngắn');
  });
  if (wordCount(a.nextSteps) < 20) add('next_steps_thin', 'minor', 'nextSteps', 'Phần kết ("Bước tiếp theo") quá ngắn');

  // Trùng lặp nội bộ
  const headings = a.sections.map((s) => normText(s.heading));
  headings.forEach((h, i) => {
    if (h && headings.indexOf(h) !== i) add('heading_dup', 'major', `sections.${i}`, `Heading "${a.sections[i]?.heading}" bị lặp`);
  });
  const questions = a.faq.map((f) => normText(f.question));
  questions.forEach((q, i) => {
    if (q && questions.indexOf(q) !== i) add('faq_dup', 'major', `faq.${i}`, 'Câu hỏi FAQ bị lặp');
  });
  const parts = articleParts(a);
  const seen = new Map<string, string>();
  for (const p of parts) {
    for (const para of paragraphsOf(p.text)) {
      const key = normText(para);
      if (key.length < 60) continue;
      const first = seen.get(key);
      if (first && first !== p.where) add('paragraph_dup', 'major', p.where, `Đoạn văn lặp lại nguyên văn đoạn ở ${first}: "${para.slice(0, 60)}..."`);
      else seen.set(key, p.where);
    }
  }

  // Câu sáo rỗng, khẳng định rỗng, định dạng
  const fullText = [a.title, a.h1, a.metaDescription, ...a.quickSummary, ...parts.map((p) => p.text)].join('\n');
  const lower = normText(fullText);
  const banned = BANNED_PHRASES.filter((p) => lower.includes(p));
  if (banned.length) add('banned_phrase', banned.length >= 3 ? 'major' : 'minor', 'article', `Cụm sáo rỗng cần bỏ: ${banned.join(', ')}`);
  for (const b of limits.bannedPatterns ?? []) {
    const hits = [...new Set((fullText.match(new RegExp(b.re.source, b.re.flags.includes('g') ? b.re.flags : `${b.re.flags}g`)) ?? []).map((m) => m.trim()))];
    if (hits.length) add('banned_pattern', 'major', 'article', `${b.label}: ${hits.slice(0, 5).map((h) => `"${h}"`).join(', ')}${hits.length > 5 ? ` và ${hits.length - 5} chỗ khác` : ''}. Xóa hẳn các câu này, không thay bằng cách nói khác cùng ý.`);
  }
  if (limits.distinctSections) {
    const ds = limits.distinctSections;
    const idx = a.sections.map((s, i) => (s.level === 2 && ds.names.some((n) => headingMatches(s.heading, n, ds.dish)) ? i : -1)).filter((i) => i >= 0);
    for (const iss of checkSectionRepeats(a, idx, ds.dish)) issues.push(iss);
  }
  const claims = EMPTY_CLAIMS.map((re) => fullText.match(re)?.[0]).filter((m): m is string => Boolean(m));
  if (claims.length) add('empty_claim', claims.length >= 3 ? 'major' : 'minor', 'article', `Khẳng định quảng cáo không có bằng chứng: ${[...new Set(claims)].join(', ')}`);
  if (/<\/?[a-z][^>]*>/i.test(fullText)) add('html_in_md', 'minor', 'article', 'Có thẻ HTML trong nội dung');
  if (/^#{1,6}\s/m.test(parts.map((p) => p.text).join('\n'))) add('md_heading_in_body', 'minor', 'article', 'Có heading # trong body, heading phải nằm ở trường riêng');
  if (/[—–]/.test(fullText)) add('em_dash', 'minor', 'article', 'Có dấu gạch ngang dài, dấu vết văn máy');
  if (/;/.test(parts.map((p) => p.text).join('\n'))) add('semicolon', 'minor', 'article', 'Có dấu chấm phẩy, nên tách câu');

  // Dấu vết văn máy: mở đoạn giống nhau, liên từ sáo, nhịp câu đều
  const allParas = parts.flatMap((p) => paragraphsOf(p.text));
  if (allParas.length >= 6) {
    const starts = new Map<string, number>();
    let aiOpeners = 0;
    for (const p of allParas) {
      const n = normText(p);
      const k = n.split(' ').slice(0, 2).join(' ');
      starts.set(k, (starts.get(k) ?? 0) + 1);
      if (AI_OPENERS.some((o) => n.startsWith(o))) aiOpeners++;
    }
    const [topStart, topCount] = [...starts.entries()].sort((x, y) => y[1] - x[1])[0] ?? ['', 0];
    if (topCount >= Math.max(4, Math.ceil(allParas.length * 0.3))) add('same_openers', 'minor', 'article', `${topCount} đoạn cùng mở bằng "${topStart}"`);
    if (aiOpeners >= Math.max(3, Math.ceil(allParas.length * 0.25))) add('ai_transitions', 'minor', 'article', `${aiOpeners} đoạn mở bằng liên từ sáo (Ngoài ra, Bên cạnh đó, Tuy nhiên, Đầu tiên...)`);
  }
  const sentences = parts.flatMap((p) => sentencesOf(p.text));
  if (sentences.length >= 15) {
    const lens = sentences.map((s) => wordCount(s));
    const mean = lens.reduce((x, y) => x + y, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((x, y) => x + (y - mean) ** 2, 0) / lens.length);
    const cv = mean ? sd / mean : 0;
    const shorts = lens.filter((l) => l <= 7).length;
    const longs = lens.filter((l) => l >= 25).length;
    if (cv < 0.42) add('low_burstiness', 'minor', 'article', `Nhịp câu quá đều (độ lệch ${cv.toFixed(2)}): cần xen câu rất ngắn với câu dài`);
    if (shorts < Math.max(3, Math.floor(sentences.length * 0.1))) add('few_short_sentences', 'minor', 'article', `Chỉ ${shorts} câu ngắn dưới 8 từ trong ${sentences.length} câu`);
    if (longs === 0) add('no_long_sentences', 'minor', 'article', 'Không có câu dài trên 25 từ, văn dễ bị coi là đều đặn');
  }
  const bodyLines = parts.flatMap((p) => p.text.split('\n').filter((l) => l.trim()));
  const listLines = bodyLines.filter((l) => /^\s*(- |\d+\. )/.test(l)).length;
  if (bodyLines.length >= 10 && listLines / bodyLines.length > 0.55 && a.style !== 'playbook') add('list_heavy', 'minor', 'article', `${listLines}/${bodyLines.length} dòng là gạch đầu dòng, phần văn xuôi quá ít`);

  // Từ khóa
  const kw = normText(a.targetKeyword);
  if (kw.length > 3) {
    const count = lower.split(kw).length - 1;
    const limit = Math.max(8, Math.floor(total / 100));
    if (count > limit) add('keyword_stuffing', 'minor', 'article', `Từ khóa "${a.targetKeyword}" xuất hiện ${count} lần trong ${total} từ, nên giảm`);
    if (count === 0) add('keyword_missing', 'major', 'article', `Từ khóa "${a.targetKeyword}" không xuất hiện trong bài`);
    else {
      if (!normText(a.title).includes(kw)) add('keyword_not_in_title', 'minor', 'title', 'Title chưa chứa từ khóa chính');
      if (!normText(a.intro).includes(kw)) add('keyword_not_in_intro', 'minor', 'intro', 'Đoạn mở đầu chưa chứa từ khóa chính');
    }
  }
  return issues;
}

export function isPass(issues: QualityIssue[]): boolean {
  return !issues.some((i) => i.severity === 'major');
}

/** Gộp lỗi thành danh sách chỉ dẫn cho lượt sửa. */
export function issuesToFeedback(issues: QualityIssue[]): string[] {
  return issues.map((i) => `[${i.severity === 'major' ? 'BẮT BUỘC' : 'nên'}] ${i.where}: ${i.message}`);
}
