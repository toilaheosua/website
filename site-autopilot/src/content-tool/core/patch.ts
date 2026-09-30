/**
 * Vòng sửa có mục tiêu: khoanh đúng phần bài bị lỗi (mở bài, một mục, một FAQ, title...), gửi model chỉ các phần đó,
 * rồi ghép bản sửa vào bài bằng mã. Phần còn lại giữ nguyên từng chữ nên vòng sửa không sinh lỗi mới ở chỗ đang tốt
 * và nhanh hơn viết lại cả bài. Kèm bộ kiểm chứng trích dẫn của AI duyệt: lỗi không chỉ ra được câu trong bài thì bỏ.
 */
import type { AiBlockScore, AiReview, Article, ArticlePatch, DupReport, PatchTarget, QualityIssue } from './types.js';
import { normText, wordCount } from './util.js';

const WHERE_RE = /^(title|metaDescription|h1|excerpt|intro|nextSteps|sections\.\d+|faq\.\d+)$/;

/** Văn bản để so khớp: bỏ ảnh, giữ chữ của liên kết, bỏ ký hiệu markdown, thường hóa. */
export function plainish(s: string): string {
  return normText(
    s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`>#|]/g, ' ')
      .replace(/[“”"]/g, '"'),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Các phần có thể sửa riêng, kèm văn bản hiện tại. */
export function patchableParts(a: Article): { where: string; text: string; heading?: string }[] {
  const parts: { where: string; text: string; heading?: string }[] = [
    { where: 'title', text: a.title },
    { where: 'metaDescription', text: a.metaDescription },
    { where: 'h1', text: a.h1 },
    { where: 'excerpt', text: a.excerpt },
    { where: 'intro', text: a.intro },
  ];
  a.sections.forEach((s, i) => parts.push({ where: `sections.${i}`, text: s.body, heading: s.heading }));
  a.faq.forEach((f, i) => parts.push({ where: `faq.${i}`, text: f.answer, heading: f.question }));
  parts.push({ where: 'nextSteps', text: a.nextSteps });
  return parts;
}

export function isPatchable(a: Article, where: string): boolean {
  if (!WHERE_RE.test(where)) return false;
  const m = /^(sections|faq)\.(\d+)$/.exec(where);
  if (!m) return true;
  const n = Number(m[2]);
  return m[1] === 'sections' ? n < a.sections.length : n < a.faq.length;
}

/** Tìm phần chứa đoạn trích (nguyên câu hoặc 8 từ đầu của câu). */
export function findQuote(a: Article, quote: string): string | null {
  const q = plainish(quote);
  if (q.length < 12) return null;
  const head = q.split(' ').slice(0, 8).join(' ');
  const parts = patchableParts(a).map((p) => ({ where: p.where, text: plainish(`${p.heading ?? ''} ${p.text}`) }));
  return parts.find((p) => p.text.includes(q))?.where ?? parts.find((p) => head.split(' ').length >= 5 && p.text.includes(head))?.where ?? null;
}

/**
 * AI duyệt phải trích nguyên văn câu lỗi. Lỗi có trích dẫn không tìm thấy trong bài thì bỏ (model bịa hoặc nhớ nhầm);
 * lỗi không trích dẫn chỉ giữ khi là lỗi "thiếu" (thiếu mục, thiếu quán, thiếu bảng) vì không có câu để trích.
 * Vị trí sai được sửa theo chỗ tìm thấy trích dẫn.
 */
export function verifyReviewIssues(review: AiReview, a: Article): { review: AiReview; dropped: number } {
  let dropped = 0;
  const issues: AiReview['issues'] = [];
  for (const i of review.issues) {
    const quote = (i.quote ?? '').trim();
    if (quote) {
      const at = findQuote(a, quote);
      if (!at) {
        dropped++;
        continue;
      }
      issues.push({ ...i, where: isPatchable(a, i.where) ? i.where : at });
      continue;
    }
    if (i.severity === 'minor' || /\bthiếu\b|không có mục|chưa có mục|missing/i.test(i.problem)) {
      issues.push(i);
      continue;
    }
    dropped++;
  }
  return { review: { ...review, issues }, dropped };
}

/** Khóa nhận diện một lỗi duyệt qua các vòng: theo câu trích, không có thì theo vị trí và vấn đề. */
export function reviewIssueKey(i: AiReview['issues'][number]): string {
  const q = plainish(i.quote ?? '');
  return q.length >= 12 ? `q:${q.slice(0, 80)}` : `w:${i.where}|${plainish(i.problem).slice(0, 60)}`;
}

export interface LocateInput {
  quality: QualityIssue[];
  dup: DupReport;
  /** Lỗi duyệt đã kiểm chứng; chỉ lỗi major có confirmed mới bắt buộc */
  review: AiReview | null;
  /** Các câu bị công cụ dò AI đánh dấu */
  blocks: AiBlockScore[];
  minWords: number;
  maxWords: number;
  shingleSize: number;
}

const quoted = (s: string): string[] => [...s.matchAll(/"([^"]{4,})"/g)].map((m) => m[1]!);

/**
 * Chuyển ba nguồn lỗi thành danh sách phần cần sửa kèm yêu cầu cho từng phần. Lỗi toàn bài được quy về phần cụ thể:
 * quá dài → các mục dài nhất phải rút; quá ngắn → các mục ngắn nhất viết thêm; cụm cấm, khẳng định trống →
 * phần chứa cụm đó; thiếu từ khóa → mở bài. Lỗi không quy được (ví dụ thiếu mục) trả trong unlocated để
 * bước gọi lùi về sửa cả bài.
 */
export function locateTargets(a: Article, input: LocateInput): { targets: PatchTarget[]; unlocated: string[]; hints: string[] } {
  const map = new Map<string, PatchTarget>();
  const unlocatedAll: string[] = [];
  const unlocated = unlocatedAll;
  const parts = patchableParts(a);
  const add = (where: string, fb: string, opts: { allowHeading?: boolean } = {}) => {
    if (!isPatchable(a, where)) {
      unlocated.push(fb);
      return;
    }
    const part = parts.find((p) => p.where === where)!;
    const t = map.get(where) ?? { where, heading: part.heading, current: part.text, feedback: [], allowHeading: false };
    if (!t.feedback.includes(fb)) t.feedback.push(fb);
    if (opts.allowHeading) t.allowHeading = true;
    map.set(where, t);
  };
  const byHits = (hits: string[], fb: string, fallback: string) => {
    let found = false;
    for (const h of hits) {
      const hp = plainish(h);
      if (hp.length < 4) continue;
      for (const p of parts) {
        if (plainish(`${p.heading ?? ''} ${p.text}`).includes(hp)) {
          add(p.where, fb);
          found = true;
        }
      }
    }
    if (!found) add(fallback, fb);
  };
  const h2 = a.sections.map((s, i) => ({ i, words: wordCount(s.body), level: s.level })).filter((s) => s.level === 2);
  const total = wordCount(a.intro) + a.sections.reduce((n, s) => n + wordCount(s.body), 0) + a.faq.reduce((n, f) => n + wordCount(f.answer), 0) + wordCount(a.nextSteps);

  for (const q of input.quality) {
    const tag = q.severity === 'major' ? 'BẮT BUỘC' : 'nên';
    const fb = `[${tag}] ${q.message}`;
    if (isPatchable(a, q.where)) {
      add(q.where, fb, { allowHeading: /heading|tiêu đề mục/i.test(q.code + ' ' + q.message) });
      continue;
    }
    switch (q.code) {
      case 'too_long': {
        const excess = Math.max(total - input.maxWords, 50);
        const longest = [...h2].sort((x, y) => y.words - x.words).slice(0, 3);
        const perSection = Math.ceil((excess * 1.1) / Math.max(longest.length, 1));
        for (const s of longest) add(`sections.${s.i}`, `[${tag}] Bài đang ${total} từ, trần ${input.maxWords}. Rút mục này từ ${s.words} từ còn khoảng ${Math.max(40, s.words - perSection)} từ: bỏ ý trùng, câu đệm, câu tổng kết; giữ dữ kiện, dòng địa chỉ, đánh giá, ảnh và bảng.`);
        break;
      }
      case 'too_short': {
        const need = Math.max(input.minWords - total, 50);
        const shortest = [...h2].sort((x, y) => x.words - y.words).slice(0, 2);
        for (const s of shortest) add(`sections.${s.i}`, `[${tag}] Bài chỉ ${total} từ, cần ${input.minWords}. Viết thêm khoảng ${Math.ceil(need / Math.max(shortest.length, 1))} từ cho mục này bằng dữ kiện có trong ghi chú, không kéo dài bằng câu đệm.`);
        break;
      }
      case 'banned_phrase':
      case 'banned_pattern':
      case 'empty_claim':
      case 'keyword_stuffing':
        byHits(quoted(q.message), fb, 'intro');
        break;
      case 'keyword_missing':
        add('intro', fb);
        break;
      case 'semicolon':
        // Dấu chấm phẩy: sửa ở đúng các phần có dấu đó
        for (const p of parts) if (/;/.test(p.text)) add(p.where, fb);
        break;
      default:
        unlocated.push(fb);
    }
  }
  for (const m of input.dup.matches.filter((x) => x.words >= input.shingleSize).slice(0, 12)) {
    add(m.where, `[BẮT BUỘC] Chuỗi ${m.words} từ trùng với nguồn ${m.sourceIndex} (${m.sourceUrl}): "${m.text.slice(0, 120)}". Diễn đạt lại hoàn toàn bằng cấu trúc câu khác.`);
  }
  for (const i of input.review?.issues ?? []) {
    const blocking = i.severity === 'major' && i.confirmed === true;
    const fb = `[${blocking ? 'BẮT BUỘC' : 'nên'}] ${i.problem}${i.quote ? ` (câu: "${i.quote.slice(0, 160)}")` : ''} → ${i.fix}`;
    const at = isPatchable(a, i.where) ? i.where : i.quote ? findQuote(a, i.quote) : null;
    if (at) add(at, fb);
    else if (blocking) unlocated.push(fb);
  }
  const flagged = input.blocks.filter((b) => b.aiScore >= 0.5).sort((x, y) => y.aiScore - x.aiScore).slice(0, 25);
  const byWhere = new Map<string, string[]>();
  for (const b of flagged) {
    const at = isPatchable(a, b.where) ? b.where : findQuote(a, b.text);
    if (!at) continue;
    byWhere.set(at, [...(byWhere.get(at) ?? []), b.text]);
  }
  for (const [where, texts] of byWhere) {
    add(where, `[BẮT BUỘC] Các câu sau bị chấm là đọc giống văn máy, viết lại từng câu hoàn toàn khác (đổi cấu trúc, độ dài, giọng kể có người viết), và đổi luôn câu kề bên nếu cùng nhịp: ${texts.map((t) => `"${t.slice(0, 160)}"`).join('; ')}`);
  }
  // Lỗi bắt buộc không khoanh được thì bước gọi phải sửa cả bài; lỗi "nên" không khoanh được chỉ là gợi ý chung
  return { targets: [...map.values()], unlocated: unlocatedAll.filter((f) => f.startsWith('[BẮT BUỘC]')), hints: unlocatedAll.filter((f) => !f.startsWith('[BẮT BUỘC]')) };
}

/** Ghép bản sửa vào bài: chỉ nhận đúng các phần đã yêu cầu, heading chỉ đổi khi phần đó được phép. */
export function applyPatches(a: Article, patches: ArticlePatch[], targets: PatchTarget[]): Article {
  const allowed = new Map(targets.map((t) => [t.where, t]));
  const out: Article = { ...a, sections: a.sections.map((s) => ({ ...s })), faq: a.faq.map((f) => ({ ...f })) };
  for (const p of patches) {
    const t = allowed.get(p.where);
    const text = (p.text ?? '').trim();
    if (!t || !text || !isPatchable(a, p.where)) continue;
    const m = /^(sections|faq)\.(\d+)$/.exec(p.where);
    if (m && m[1] === 'sections') {
      const s = out.sections[Number(m[2])]!;
      s.body = text;
      const h = (p.heading ?? '').trim();
      if (t.allowHeading && h) s.heading = h;
      continue;
    }
    if (m && m[1] === 'faq') {
      out.faq[Number(m[2])]!.answer = text;
      continue;
    }
    if (p.where === 'title' || p.where === 'metaDescription' || p.where === 'h1' || p.where === 'excerpt') out[p.where] = text.replace(/\s+/g, ' ');
    else if (p.where === 'intro') out.intro = text;
    else if (p.where === 'nextSteps') out.nextSteps = text;
  }
  return out;
}
