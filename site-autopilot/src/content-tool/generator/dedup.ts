import type { DupMatch, DupReport } from '../core/types.js';
import { normText } from '../core/util.js';
import type { ArticlePart } from './quality.js';

/**
 * So trùng lặp bằng shingle (chuỗi k từ liên tiếp).
 * Bài chỉ đạt khi tỷ lệ từ nằm trong chuỗi trùng thấp hơn ngưỡng và không có chuỗi trùng dài.
 */

export function tokenize(text: string): string[] {
  return normText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export interface DupSource {
  index: number;
  url: string;
  text: string;
}

function shingleMap(sources: DupSource[], k: number): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of sources) {
    const toks = tokenize(s.text);
    for (let i = 0; i + k <= toks.length; i++) {
      const key = toks.slice(i, i + k).join(' ');
      if (!map.has(key)) map.set(key, s.index);
    }
  }
  return map;
}

interface PartScan {
  where: string;
  tokens: string[];
  matched: number[]; // -1 = không trùng, ngược lại là index nguồn
}

function scanParts(parts: ArticlePart[], map: Map<string, number>, k: number): PartScan[] {
  return parts.map((p) => {
    const tokens = tokenize(p.text);
    const matched = new Array<number>(tokens.length).fill(-1);
    for (let i = 0; i + k <= tokens.length; i++) {
      const src = map.get(tokens.slice(i, i + k).join(' '));
      if (src === undefined) continue;
      for (let j = i; j < i + k; j++) if (matched[j] === -1) matched[j] = src;
    }
    return { where: p.where, tokens, matched };
  });
}

function runsOf(scan: PartScan, urls: Map<number, string>): DupMatch[] {
  const out: DupMatch[] = [];
  let start = -1;
  let cur = -1;
  const flush = (end: number) => {
    if (start >= 0 && cur >= 0) {
      const words = end - start;
      out.push({ text: scan.tokens.slice(start, end).join(' '), words, sourceIndex: cur, sourceUrl: urls.get(cur) ?? '', where: scan.where });
    }
  };
  for (let i = 0; i < scan.matched.length; i++) {
    const m = scan.matched[i] ?? -1;
    if (m !== cur) {
      flush(i);
      start = m >= 0 ? i : -1;
      cur = m;
    }
  }
  flush(scan.matched.length);
  return out;
}

export interface DedupOptions {
  shingleSize: number;
  ratioMax: number;
  /** Chuỗi trùng dài từ mức này trở lên là sao chép rõ, bài không đạt dù tỷ lệ thấp */
  longRun?: number;
}

/** So bài với các nguồn đã thu thập. */
export function checkDuplication(parts: ArticlePart[], sources: DupSource[], opts: DedupOptions): DupReport {
  const k = opts.shingleSize;
  const longRun = opts.longRun ?? k + 4;
  const urls = new Map(sources.map((s) => [s.index, s.url]));
  const scans = scanParts(parts, shingleMap(sources, k), k);
  const matches = scans.flatMap((s) => runsOf(s, urls)).sort((a, b) => b.words - a.words);
  const totalWords = scans.reduce((n, s) => n + s.tokens.length, 0);
  const matchedWords = scans.reduce((n, s) => n + s.matched.filter((m) => m >= 0).length, 0);
  const ratio = totalWords ? matchedWords / totalWords : 0;
  const longest = matches[0]?.words ?? 0;
  return {
    ratio,
    totalWords,
    matchedWords,
    longestRun: longest,
    matches: matches.slice(0, 40),
    libraryMatches: [],
    pass: ratio <= opts.ratioMax && longest < longRun,
  };
}

/** So bài với các bài đã viết trước đó, báo những bài giống đáng kể. */
export function checkLibraryDuplication(parts: ArticlePart[], library: { runId: number; keyword: string; text: string }[], k: number): DupReport['libraryMatches'] {
  const out: DupReport['libraryMatches'] = [];
  for (const item of library) {
    const scans = scanParts(parts, shingleMap([{ index: item.runId, url: '', text: item.text }], k), k);
    const total = scans.reduce((n, s) => n + s.tokens.length, 0);
    const matched = scans.reduce((n, s) => n + s.matched.filter((m) => m >= 0).length, 0);
    const longest = Math.max(0, ...scans.flatMap((s) => runsOf(s, new Map()).map((r) => r.words)));
    const ratio = total ? matched / total : 0;
    if (ratio >= 0.03 || longest >= k) out.push({ runId: item.runId, keyword: item.keyword, ratio, longestRun: longest });
  }
  return out.sort((a, b) => b.ratio - a.ratio).slice(0, 10);
}

/** Chỉ dẫn sửa cho các chuỗi trùng, đưa vào phản hồi của vòng sửa. */
export function dupToFeedback(report: DupReport, k: number): string[] {
  const fb: string[] = [];
  const severe = report.matches.filter((m) => m.words >= k);
  for (const m of severe.slice(0, 12)) {
    fb.push(`[BẮT BUỘC] ${m.where}: chuỗi ${m.words} từ trùng với nguồn ${m.sourceIndex} (${m.sourceUrl}): "${m.text.slice(0, 120)}". Diễn đạt lại hoàn toàn bằng cấu trúc câu khác.`);
  }
  if (report.ratio > 0) fb.push(`[thông tin] Tỷ lệ trùng với nguồn hiện ${(report.ratio * 100).toFixed(1)}%, chuỗi dài nhất ${report.longestRun} từ.`);
  for (const l of report.libraryMatches.slice(0, 3)) fb.push(`[nên] Bài giống bài đã viết "${l.keyword}" (#${l.runId}) ${(l.ratio * 100).toFixed(1)}%, chuỗi dài nhất ${l.longestRun} từ: đổi cách diễn đạt các đoạn trùng.`);
  return fb;
}
