import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import type { Db, Run, SourceRow } from '../db/index.js';
import type { ContentLlm, Services, SourceForLlm } from '../services/types.js';
import type { AiDetectReport, AiReview, Article, CheckRound, GeneralSettings, ManualScore, Outline, PendingScore, ResearchNotes, SerpData, SerpResult } from '../core/types.js';
import { applyPatches, locateTargets, reviewIssueKey, verifyReviewIssues } from './patch.js';
import { AppError, ConfigError, TransientError } from './errors.js';
import { domainBlocked, domainOf, errorMessage, normText, nowIso, slugify, wordCount } from './util.js';
import { ALWAYS_SKIP_DOMAINS } from '../services/fetcher.js';
import { articleParts, articleWordCount, autoFixArticle, checkQuality, isPass, issuesToFeedback, type QualityLimits } from '../generator/quality.js';
import { checkDuplication, checkLibraryDuplication, dupToFeedback } from '../generator/dedup.js';
import { articlePlainParts, articleToDocx, articleToHtmlDocument, articleToMarkdown, articleToPlainText, articleToSiteAutopilotJson } from '../generator/markdown.js';
import type { ArtifactKind } from '../db/index.js';
import type { PlacesData, RunKind, RunOptions } from '../core/types.js';
import { enforcePlaceSections, featuredPlaces, placesForExport, placesJsonLd, stripInjectedLines } from './roundup.js';
import { stepPlaces, stepReviewsAndPhotos, stepRoundupNotes } from './pipeline-roundup.js';
import { stepBrandMedia, stepBrandNotes, stepBrandPlace } from './pipeline-brand.js';
import { enforceBrandSections } from './brand.js';
import { buildExportBundle, bundleToZip } from '../generator/photos.js';

/* ------------------------------------------------------------------ */
/*  Định nghĩa bước                                                     */
/* ------------------------------------------------------------------ */

export type StepId = 'search' | 'fetch' | 'extract' | 'outline' | 'write' | 'edit' | 'verify' | 'export';
export const STEP_ORDER: readonly StepId[] = ['search', 'fetch', 'extract', 'outline', 'write', 'edit', 'verify', 'export'];

export const STEP_META: Record<StepId, { name: string; desc: string }> = {
  search: { name: 'Tìm Google', desc: 'Lấy top 10 kết quả, câu hỏi "Mọi người cũng hỏi", tìm kiếm liên quan' },
  fetch: { name: 'Tải nguồn', desc: 'Tải và trích nội dung chính của các trang, bỏ trang chặn, quá ngắn, sai ngôn ngữ' },
  extract: { name: 'Rút ghi chú', desc: 'Claude đọc nguồn, rút 800 đến 1500 từ dữ kiện có ghi nguồn' },
  outline: { name: 'Lập bố cục', desc: 'Chọn kiểu viết, title, H1, meta, các mục H2/H3, FAQ, từ khóa phụ' },
  write: { name: 'Viết bài', desc: 'Viết trọn bài 1000 đến 1500 từ theo bố cục và ghi chú' },
  edit: { name: 'Biên tập', desc: 'Lượt biên tập theo checklist chống dấu vết văn máy và phản hồi cổng chất lượng' },
  verify: { name: 'Kiểm tra và sửa', desc: 'Cổng chất lượng, so trùng với nguồn, điểm AI (API hoặc bạn nhập từ web Originality.ai), AI duyệt; tự sửa tối đa N vòng' },
  export: { name: 'Xuất file', desc: 'Markdown, HTML, JSON cho site-autopilot, DOCX, văn bản thuần' },
};

/** Tên và mô tả bước cho bài tổng hợp quán: ba bước đầu khác, các bước sau dùng chung. */
export const STEP_META_ROUNDUP: Record<StepId, { name: string; desc: string }> = {
  ...STEP_META,
  search: { name: 'Tìm quán trên Maps', desc: 'Google Maps: gom quán trong khu vực, lọc đúng món, gộp chi nhánh, xếp hạng theo sao và số đánh giá' },
  fetch: { name: 'Đánh giá và ảnh', desc: 'Lấy đánh giá của các quán được chọn, rút ý khen chê, tải ảnh đại diện' },
  extract: { name: 'Tổng hợp', desc: 'Dựng ghi chú tư liệu từ dữ liệu quán: địa chỉ, sao, giá, giờ, ý khen chê' },
  write: { name: 'Viết bài', desc: 'Bảng so sánh, mỗi quán một mục kèm địa chỉ và link Google Maps, quán nào hợp ai, cách xếp hạng' },
};

export const STEP_META_BRAND: Record<StepId, { name: string; desc: string }> = {
  ...STEP_META,
  search: { name: 'Tìm địa điểm', desc: 'Đọc link Google Maps, lấy tên, địa chỉ, sao, số đánh giá, giờ mở, điện thoại, website' },
  fetch: { name: 'Đánh giá và ảnh', desc: 'Lấy đánh giá của khách, rút ý khen chê, tải bộ ảnh từ Google Maps' },
  extract: { name: 'Tổng hợp', desc: 'Ghép thông tin bạn cung cấp với dữ liệu Maps và ý từ đánh giá' },
  write: { name: 'Viết bài', desc: 'Bài giới thiệu: câu chuyện, điểm khách khen, sản phẩm nổi bật, không gian, bộ ảnh, liên hệ' },
};

export function stepMetaFor(kind: RunKind | undefined): Record<StepId, { name: string; desc: string }> {
  return kind === 'roundup' ? STEP_META_ROUNDUP : kind === 'brand' ? STEP_META_BRAND : STEP_META;
}

export function isStepId(s: string): s is StepId {
  return (STEP_ORDER as readonly string[]).includes(s);
}

export function stepsFrom(step: StepId): StepId[] {
  return STEP_ORDER.slice(STEP_ORDER.indexOf(step));
}

/* ------------------------------------------------------------------ */
/*  Ngữ cảnh chạy bước                                                  */
/* ------------------------------------------------------------------ */

export interface StepContext {
  run: Run;
  db: Db;
  config: AppConfig;
  services: Services;
  llm: ContentLlm;
  settings: GeneralSettings;
  log: (message: string, level?: 'info' | 'warn' | 'error') => void;
  /** Bước có gọi dịch vụ ngoài ngoài Claude thì báo để cộng vào thống kê */
  count: (what: 'searchCalls' | 'detectorCredits', n: number) => void;
  /** Bật khi người dùng hủy bài: bước đang chạy nên dừng sớm nhất có thể */
  signal: AbortSignal;
}

export function throwIfCancelled(ctx: StepContext): void {
  if (ctx.signal.aborted) throw new AppError('Bài đã bị hủy', 'cancelled');
}

export type WaitingFor = 'places' | 'outline' | 'ai_score';

export interface StepResult {
  message: string;
  /** Bước dừng chờ người dùng: duyệt bố cục hoặc nhập điểm AI */
  waiting?: WaitingFor;
  /** Bài không qua kiểm tra sau hết số vòng sửa */
  needsReview?: boolean;
}

export function requireArtifact<T>(ctx: StepContext, kind: ArtifactKind, label: string): T {
  const a = ctx.db.getArtifact<T>(ctx.run.id, kind);
  if (!a) throw new AppError(`Thiếu ${label}. Hãy chạy lại từ bước trước.`);
  return a.content;
}

export interface CurrentArticle {
  article: Article;
  kind: 'fixed' | 'edited' | 'draft';
  version: number;
  /** Khóa nhận dạng bản bài, dùng để gắn điểm chấm tay đúng bản */
  key: string;
}

export function latestArticle(db: Db, runId: number): CurrentArticle | null {
  for (const kind of ['fixed', 'edited', 'draft'] as const) {
    const a = db.getArtifact<Article>(runId, kind);
    if (a) return { article: a.content, kind, version: a.version, key: `${kind}:${a.version}` };
  }
  return null;
}

/** Điểm chấm tay đã nhập cho một bản bài, nếu có. */
export function manualScoreFor(db: Db, runId: number, articleKey: string): ManualScore | null {
  const all = db.listArtifacts<ManualScore>(runId, 'ai_score');
  for (let i = all.length - 1; i >= 0; i--) if (all[i]!.content.articleKey === articleKey) return all[i]!.content;
  return null;
}

/* ------------------------------------------------------------------ */
/*  Các bước                                                            */
/* ------------------------------------------------------------------ */

/** Vị trí lưu cho kết quả Google bị bỏ qua: xếp sau bài web (1..N) và nguồn tiếng Anh (100+). */
export const SKIPPED_POSITION_BASE = 200;

/**
 * Tìm Google và chỉ giữ bài web: bỏ mạng xã hội, video, sàn, domain chặn; lật thêm trang cho tới khi đủ
 * resultsCount bài web. Top 1..N là thứ hạng giữa các bài web, đúng với cách người đọc so bài với bài.
 */
async function stepSearch(ctx: StepContext): Promise<StepResult> {
  const { run, db, settings } = ctx;
  const provider = ctx.services.search();
  const skipReason = (link: string): string | null => {
    const d = domainOf(link);
    if (domainBlocked(d, settings.blockedDomains)) return 'Domain nằm trong danh sách chặn';
    if (domainBlocked(d, ALWAYS_SKIP_DOMAINS)) return 'Mạng xã hội, video hoặc sàn, không phải bài viết';
    return null;
  };
  const kept: SerpResult[] = [];
  const skipped: NonNullable<SerpData['skipped']> = [];
  const seen = new Set<string>();
  let first: SerpData | null = null;
  let pages = 0;
  for (let page = 0; page < settings.searchMaxPages && kept.length < settings.resultsCount; page++) {
    throwIfCancelled(ctx);
    const r = await provider.search(run.keyword, { language: 'vi', count: settings.resultsCount, page });
    ctx.count('searchCalls', 1);
    pages++;
    first ??= r;
    if (!r.organic.length) break;
    for (const it of r.organic) {
      const key = it.link.replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const googlePosition = page * 10 + it.position;
      const reason = skipReason(it.link);
      if (reason) skipped.push({ googlePosition, link: it.link, title: it.title, reason });
      else if (kept.length < settings.resultsCount) kept.push({ ...it, position: kept.length + 1 });
    }
  }
  if (!first || !kept.length) throw new AppError('Google không trả về bài web nào dùng được cho từ khóa này (chỉ có mạng xã hội, video hoặc domain bị chặn). Thử từ khóa khác, tăng số trang tìm trong Cài đặt, hoặc đổi nhà cung cấp tìm kiếm.');
  const serp: SerpData = { ...first, organic: kept, skipped, pagesFetched: pages };
  db.saveArtifact(run.id, 'serp', serp);
  db.replaceSources(run.id, [
    ...kept.map((r) => ({ position: r.position, url: r.link, domain: domainOf(r.link), title: r.title, snippet: r.snippet, language: 'vi' })),
    ...skipped.map((s) => ({ position: SKIPPED_POSITION_BASE + s.googlePosition, url: s.link, domain: domainOf(s.link), title: s.title, snippet: '', language: 'vi' })),
  ]);
  for (const s of db.listSources(run.id)) {
    if (s.position < SKIPPED_POSITION_BASE) continue;
    const sk = skipped.find((x) => x.link === s.url);
    db.updateSource(s.id, { status: 'blocked', error: `${sk?.reason ?? 'Bỏ qua'} (Google #${s.position - SKIPPED_POSITION_BASE})` });
  }
  const social = skipped.filter((s) => s.reason.startsWith('Mạng xã hội')).length;
  const msg = `${kept.length} bài web (lật ${pages} trang Google, bỏ ${skipped.length} kết quả: ${social} mạng xã hội/video/sàn, ${skipped.length - social} domain chặn), ${serp.peopleAlsoAsk.length} câu hỏi "Mọi người cũng hỏi"`;
  ctx.log(`Tìm "${run.keyword}" qua ${provider.id}: ${msg}`);
  if (kept.length < settings.resultsCount) ctx.log(`Chỉ gom được ${kept.length}/${settings.resultsCount} bài web sau ${pages} trang; tăng "Số trang Google tối đa" trong Cài đặt nếu muốn nhiều hơn`, 'warn');
  return { message: msg };
}

async function fetchPending(ctx: StepContext, rows: SourceRow[], seenTexts: Set<string>): Promise<void> {
  const fetcher = ctx.services.fetcher();
  const pending = rows.filter((r) => r.status === 'pending');
  const concurrency = 4;
  for (let i = 0; i < pending.length; i += concurrency) {
    throwIfCancelled(ctx);
    await Promise.all(
      pending.slice(i, i + concurrency).map(async (s) => {
        try {
          const page = await fetcher.fetch(s.url);
          if (page.httpStatus >= 400) return ctx.db.updateSource(s.id, { status: 'failed', http_status: page.httpStatus, error: `HTTP ${page.httpStatus}`, fetched_at: nowIso() });
          if (!page.text) return ctx.db.updateSource(s.id, { status: 'failed', http_status: page.httpStatus, error: 'Không trích được nội dung văn bản', fetched_at: nowIso() });
          if (page.wordCount < 150) return ctx.db.updateSource(s.id, { status: 'short', http_status: page.httpStatus, word_count: page.wordCount, error: `Chỉ ${page.wordCount} từ`, fetched_at: nowIso() });
          if (page.language !== 'vi' && page.language !== 'en') return ctx.db.updateSource(s.id, { status: 'skipped', http_status: page.httpStatus, word_count: page.wordCount, error: 'Ngôn ngữ không phải tiếng Việt hoặc tiếng Anh', fetched_at: nowIso() });
          const fingerprint = normText(page.text).slice(0, 400);
          if (seenTexts.has(fingerprint)) return ctx.db.updateSource(s.id, { status: 'duplicate', http_status: page.httpStatus, word_count: page.wordCount, error: 'Nội dung trùng với nguồn khác', fetched_at: nowIso() });
          seenTexts.add(fingerprint);
          ctx.db.updateSource(s.id, { status: 'ok', http_status: page.httpStatus, text: page.text, word_count: page.wordCount, title: s.title || page.title, language: page.language, error: null, fetched_at: nowIso() });
        } catch (err) {
          ctx.db.updateSource(s.id, { status: 'failed', error: errorMessage(err), fetched_at: nowIso() });
        }
      }),
    );
  }
}

async function stepFetch(ctx: StepContext): Promise<StepResult> {
  const { run, db, settings } = ctx;
  const seen = new Set<string>();
  await fetchPending(ctx, db.listSources(run.id), seen);
  let ok = db.okSources(run.id);
  let english = 0;
  if (ok.length < settings.minSources && settings.englishFallback) {
    ctx.log(`Chỉ có ${ok.length} nguồn tiếng Việt dùng được, tìm thêm nguồn tiếng Anh`, 'warn');
    try {
      const en = await ctx.llm.translateKeyword(run.keyword);
      const serpEn = await ctx.services.search().search(en, { language: 'en', count: settings.resultsCount });
      ctx.count('searchCalls', 1);
      const existing = new Set(db.listSources(run.id).map((s) => s.url));
      const add = serpEn.organic
        .filter((r) => !existing.has(r.link) && !domainBlocked(domainOf(r.link), settings.blockedDomains) && !domainBlocked(domainOf(r.link), ALWAYS_SKIP_DOMAINS))
        .slice(0, settings.maxSources)
        .map((r) => ({ position: 100 + r.position, url: r.link, domain: domainOf(r.link), title: r.title, snippet: r.snippet, language: 'en' }));
      db.addSources(run.id, add);
      await fetchPending(ctx, db.listSources(run.id), seen);
      ok = db.okSources(run.id);
      english = ok.filter((s) => s.language === 'en').length;
      ctx.log(`Từ khóa tiếng Anh "${en}": thêm ${add.length} trang, lấy được ${english} nguồn`);
    } catch (err) {
      ctx.log(`Không tìm thêm được nguồn tiếng Anh: ${errorMessage(err)}`, 'warn');
    }
  }
  if (!ok.length) throw new AppError('Không tải được nguồn nào có nội dung dùng được. Kiểm tra kết nối mạng, danh sách domain chặn, hoặc thử từ khóa khác.');
  const keep = [...ok].sort((a, b) => (a.language === b.language ? a.position - b.position : a.language === 'vi' ? -1 : 1)).slice(0, settings.maxSources);
  const keepIds = new Set(keep.map((s) => s.id));
  for (const s of ok) if (!keepIds.has(s.id)) db.updateSource(s.id, { status: 'skipped', error: `Vượt số nguồn tối đa (${settings.maxSources})` });
  const all = db.listSources(run.id);
  const by = (st: string) => all.filter((s) => s.status === st).length;
  const words = keep.reduce((n, s) => n + s.word_count, 0);
  const msg = `Dùng ${keep.length} nguồn (${keep.filter((s) => s.language === 'vi').length} tiếng Việt, ${english} tiếng Anh), tổng ${words} từ; ${by('failed')} lỗi tải, ${by('short')} quá ngắn, ${by('blocked')} bị chặn, ${by('skipped')} bỏ qua`;
  ctx.log(msg);
  if (keep.length < settings.minSources) ctx.log(`Chỉ có ${keep.length} nguồn, ít hơn mức mong muốn ${settings.minSources}; vẫn tiếp tục`, 'warn');
  return { message: msg };
}

async function stepExtract(ctx: StepContext): Promise<StepResult> {
  const { run, db, settings } = ctx;
  const serp = requireArtifact<SerpData>(ctx, 'serp', 'kết quả tìm kiếm');
  const ok = db.okSources(run.id).slice(0, settings.maxSources);
  if (!ok.length) throw new AppError('Không có nguồn nào để rút ghi chú. Chạy lại từ bước "Tải nguồn".');
  const budget = 110_000;
  const per = Math.floor(budget / ok.length);
  // Các trang tiếng Việt xếp cao nhất trên Google được đánh dấu để bước bố cục tái sử dụng dạng nội dung của chúng
  const topIds = new Set(
    ok
      .filter((s) => s.language === 'vi' && s.position <= 10)
      .sort((a, b) => a.position - b.position)
      .slice(0, settings.topSitesPriority)
      .map((s) => s.id),
  );
  let rank = 0;
  const sources: SourceForLlm[] = ok.map((s) => ({ index: s.position, url: s.url, title: s.title, language: s.language, text: (s.text ?? '').slice(0, per), ...(topIds.has(s.id) ? { topRank: ++rank } : {}) }));
  const notes = await ctx.llm.extractNotes({ keyword: run.keyword, options: run.options, settings, sources, serp });
  db.saveArtifact(run.id, 'notes', notes);
  const topTags = notes.topics.filter((t) => t.inTopSites).length;
  const msg = `Ghi chú ${notes.totalWords} từ từ ${sources.length} nguồn; ý định tìm kiếm: ${notes.searchIntent}; ${notes.keyFacts.length} dữ kiện chính; ${notes.topics.length} nhãn (${topTags} có ở top ${topIds.size} Google); ${notes.comparisons.length} so sánh, ${notes.similarItems.length} món tương tự; ${notes.secondaryKeywords.length} từ khóa phụ`;
  ctx.log(msg);
  return { message: msg };
}

async function stepOutline(ctx: StepContext): Promise<StepResult> {
  const { run, db, settings } = ctx;
  const notes = requireArtifact<ResearchNotes>(ctx, 'notes', 'ghi chú tư liệu');
  // Bài tổng hợp quán và bài thương hiệu không có kết quả tìm Google: dùng câu hỏi và từ khóa phụ trong ghi chú
  const serp: SerpData =
    run.options.kind !== 'web'
      ? { provider: 'mock', keyword: run.keyword, language: 'vi', organic: [], peopleAlsoAsk: notes.peopleAlsoAsk, relatedSearches: notes.secondaryKeywords, fetchedAt: nowIso() }
      : requireArtifact<SerpData>(ctx, 'serp', 'kết quả tìm kiếm');
  const outline = await ctx.llm.buildOutline({ keyword: run.keyword, options: effectiveOptions(db, run), settings, notes, serp });
  db.saveArtifact(run.id, 'outline', outline);
  const h2 = outline.sections.filter((s) => s.level === 2).length;
  const compared = outline.sections.filter((s) => s.comparisonItems.length >= 2).length;
  const msg = `Kiểu viết ${outline.style}; ${h2} mục H2, ${outline.sections.length - h2} mục H3, ${outline.faq.length} FAQ; mục tiêu ${outline.targetWords} từ${run.options.kind === 'web' && run.options.comparison ? `; chế độ so sánh: ${compared}/${outline.sections.length} mục có bảng so sánh` : ''}`;
  if (run.options.kind === 'web' && run.options.comparison && compared < h2) ctx.log(`Chế độ so sánh nhưng chỉ ${compared}/${h2} mục H2 có đối tượng so sánh; bạn có thể sửa bố cục hoặc chạy lại bước này`, 'warn');
  ctx.log(msg);
  if (run.options.reviewOutline) return { message: `${msg}. Đang chờ bạn duyệt bố cục.`, waiting: 'outline' };
  return { message: msg };
}

/** Các artifact của bước kiểm tra trở đi, xóa khi viết lại bài. */
export const VERIFY_ARTIFACTS = ['check', 'pending_score', 'ai_score', 'exports'] as const;

/** Sửa hình thức tự động; bài tổng hợp quán thì ép thêm địa chỉ, link Google Maps và ảnh vào từng mục quán. */
export function finalizeArticle(ctx: StepContext, article: Article): Article {
  return finalizeArticleFor(ctx.db, ctx.run, article);
}

export function finalizeArticleFor(db: Db, run: Run, article: Article): Article {
  const fixed = autoFixArticle(article);
  if (run.options.kind === 'web') return fixed;
  const places = db.getArtifact<PlacesData>(run.id, 'places');
  if (!places) return fixed;
  return run.options.kind === 'brand' ? enforceBrandSections(fixed, places.content, run.options) : enforcePlaceSections(fixed, places.content);
}

/** Câu than thiếu tư liệu: thừa với người đọc và là dấu hiệu bài mỏng với Google, cấm hẳn trong bài tổng hợp quán. */
export const ROUNDUP_BANNED: { re: RegExp; label: string }[] = [
  { re: /[^.!?\n]*(tư liệu|dữ liệu|số liệu|thông tin|ghi chú)[^.!?\n]{0,40}(chưa có|không có|chưa ghi|chưa được ghi nhận|chưa xuất hiện|chưa nêu|chưa mô tả)[^.!?\n]*/giu, label: 'Câu than thiếu tư liệu' },
  { re: /[^.!?\n]*(chưa có|không có)[^.!?\n]{0,25}(trong tư liệu|dữ liệu|số liệu rõ|thông tin về)[^.!?\n]*/giu, label: 'Câu than thiếu tư liệu' },
  { re: /[^.!?\n]*(chưa thể|không thể)\s+(xác định|kết luận|so sánh|so theo|dùng|khẳng định|giải thích)[^.!?\n]*/giu, label: 'Câu nói không kết luận được' },
  { re: /[^.!?\n]*giữ nguyên giới hạn[^.!?\n]*/giu, label: 'Câu than thiếu tư liệu' },
  { re: /\bchưa rõ\b/giu, label: 'Ô hoặc câu "chưa rõ" (bỏ cột hoặc ý đó)' },
  { re: /\bchưa xác định\b/giu, label: '"chưa xác định" (bỏ hàng hoặc ý đó)' },
  { re: /\b(Bayes|hằng số m\b|trung bình có trọng số|log10|logarit|trọng số thống kê)/giu, label: 'Thuật ngữ thống kê người đọc đại chúng không hiểu' },
];

/** Giới hạn cho cổng chất lượng: bài tổng hợp quán có nhiều H2 hơn bài thường; bài quán và bài thương hiệu cấm câu than thiếu tư liệu. */
/**
 * Bài tổng hợp quán: trần số từ nới theo số quán được chọn. Mỗi quán cần chỗ cho dòng địa chỉ, giờ mở, đánh giá
 * (tool chèn), một hàng bảng so sánh và vài câu nhận xét, khoảng 190 từ; phần chung (mở bài, bảng, hợp ai,
 * cách xếp hạng, FAQ) khoảng 500 từ. 12 quán ép vào 1.800 từ thì bài luôn "quá dài" hoặc mục quán "quá mỏng",
 * vòng sửa nào cũng báo lỗi mà không sửa được.
 */
export function roundupWordLimits(options: Pick<RunOptions, 'minWords' | 'maxWords'>, featured: number): { minWords: number; maxWords: number } {
  const need = 500 + 190 * Math.max(featured, 1);
  return { minWords: options.minWords, maxWords: Math.max(options.maxWords, need) };
}

/** Tùy chọn thật sự dùng cho model và cổng kiểm tra: bài tổng hợp quán lấy trần từ theo số quán đã chọn. */
export function effectiveOptions(db: Db, run: Run): RunOptions {
  if (run.options.kind !== 'roundup') return run.options;
  const places = db.getArtifact<PlacesData>(run.id, 'places')?.content;
  const n = places ? featuredPlaces(places).length : run.options.placesCount;
  return { ...run.options, ...roundupWordLimits(run.options, n) };
}

export function qualityLimits(db: Db, run: Run): QualityLimits {
  const k = run.options.kind;
  const options = effectiveOptions(db, run);
  if (k === 'roundup') {
    // Các mục quán phải khác nhau về câu mở đầu và cụm khen: tên quán lấy từ danh sách đã chọn
    const places = db.getArtifact<PlacesData>(run.id, 'places')?.content ?? null;
    const distinct = places ? { names: featuredPlaces(places).map((p) => p.name), dish: places.dish } : undefined;
    return { minWords: options.minWords, maxWords: options.maxWords, maxH2: run.options.placesCount + 6, bannedPatterns: ROUNDUP_BANNED, ...(distinct ? { distinctSections: distinct } : {}) };
  }
  return { minWords: options.minWords, maxWords: options.maxWords, ...(k === 'brand' ? { bannedPatterns: ROUNDUP_BANNED } : {}) };
}

/** Các phần văn bản để so trùng: bỏ dòng địa chỉ, link, ảnh do tool chèn. */
function dedupParts(article: Article) {
  return articleParts(article).map((p) => ({ ...p, text: stripInjectedLines(p.text) }));
}

async function stepWrite(ctx: StepContext): Promise<StepResult> {
  const { run, db, settings } = ctx;
  const notes = requireArtifact<ResearchNotes>(ctx, 'notes', 'ghi chú tư liệu');
  const outline = requireArtifact<Outline>(ctx, 'outline', 'bố cục');
  const article = finalizeArticle(ctx, await ctx.llm.writeArticle({ keyword: run.keyword, options: effectiveOptions(db, run), settings, notes, outline }));
  db.deleteArtifacts(run.id, ['edited', 'fixed', ...VERIFY_ARTIFACTS]);
  db.saveArtifact(run.id, 'draft', article);
  const msg = `Bản nháp ${articleWordCount(article)} từ, ${article.sections.length} mục, ${article.faq.length} FAQ`;
  ctx.log(msg);
  return { message: msg };
}

async function stepEdit(ctx: StepContext): Promise<StepResult> {
  const { run, db, settings } = ctx;
  const notes = requireArtifact<ResearchNotes>(ctx, 'notes', 'ghi chú tư liệu');
  const outline = requireArtifact<Outline>(ctx, 'outline', 'bố cục');
  const draft = db.getArtifact<Article>(run.id, 'draft');
  if (!draft) throw new AppError('Chưa có bản nháp. Chạy lại từ bước "Viết bài".');
  const issues = checkQuality(draft.content, qualityLimits(db, run));
  const feedback = issuesToFeedback(issues);
  const edited = finalizeArticle(ctx, await ctx.llm.editArticle({ keyword: run.keyword, options: effectiveOptions(db, run), settings, notes, outline, article: draft.content, feedback }));
  db.deleteArtifacts(run.id, ['fixed', ...VERIFY_ARTIFACTS]);
  db.saveArtifact(run.id, 'edited', edited);
  const msg = `Đã biên tập: ${articleWordCount(edited)} từ; bản nháp có ${issues.filter((i) => i.severity === 'major').length} lỗi bắt buộc, ${issues.filter((i) => i.severity === 'minor').length} lỗi nên sửa`;
  ctx.log(msg);
  return { message: msg };
}

/** Gắn câu bị công cụ dò AI đánh dấu vào đúng phần của bài để chỉ dẫn sửa. */
function locateBlocks(report: AiDetectReport, article: Article): AiDetectReport {
  const parts = articlePlainParts(article).map((p) => ({ where: p.where, norm: normText(p.text) }));
  return {
    ...report,
    blocks: report.blocks.map((b) => {
      const key = normText(b.text).slice(0, 80);
      const hit = key.length > 10 ? parts.find((p) => p.norm.includes(key)) : undefined;
      return { ...b, where: hit?.where ?? '' };
    }),
  };
}

/** Báo cáo AI từ điểm người dùng nhập trên web Originality.ai. */
export function reportFromManualScore(score: ManualScore, aiScoreMax: number, article: Article): AiDetectReport {
  return locateBlocks(
    {
      provider: 'manual',
      aiScore: score.aiScore,
      originalScore: 1 - score.aiScore,
      blocks: score.flagged.map((t) => ({ text: t, aiScore: 0.9, where: '' })),
      creditsUsed: null,
      creditsRemaining: null,
      scanId: null,
      publicLink: null,
      pass: score.aiScore <= aiScoreMax,
      skipped: false,
      error: null,
      plagiarism: null,
    },
    article,
  );
}

function placeholderReport(error: string): AiDetectReport {
  return { provider: 'manual', aiScore: 0, originalScore: 1, blocks: [], creditsUsed: null, creditsRemaining: null, scanId: null, publicLink: null, pass: false, skipped: true, error, plagiarism: null };
}

/**
 * Kiểm tra và tự sửa. Chạy lại được sau khi dừng chờ điểm chấm tay: các vòng đã kiểm lưu trong artifact "check",
 * vòng đang dở lưu trong "pending_score", điểm người dùng nhập lưu trong "ai_score" gắn với đúng bản bài.
 */
async function stepVerify(ctx: StepContext): Promise<StepResult> {
  const { run, db, settings } = ctx;
  const notes = requireArtifact<ResearchNotes>(ctx, 'notes', 'ghi chú tư liệu');
  const outline = requireArtifact<Outline>(ctx, 'outline', 'bố cục');
  let current = latestArticle(db, run.id);
  if (!current) throw new AppError('Chưa có bài để kiểm tra. Chạy lại từ bước "Viết bài".');
  let article = current.article;
  let articleKey = current.key;
  const sources = db.okSources(run.id).map((s) => ({ index: s.position, url: s.url, text: s.text ?? '' }));
  const library = db.libraryArticles(run.id).map((l) => ({ runId: l.runId, keyword: l.keyword, text: articleToPlainText(l.content as Article) }));
  const detector = ctx.services.detector();
  const manual = detector.id === 'manual';
  const limits = qualityLimits(db, run);
  const k = settings.shingleSize;
  const scansUsed = () => db.listArtifacts<ManualScore>(run.id, 'ai_score').length;
  let lastRound: CheckRound | null = null;
  let round = db.listArtifacts<CheckRound>(run.id, 'check').length;
  const options = effectiveOptions(db, run);
  // Số lỗi chặn của một vòng: lỗi bắt buộc của cổng chất lượng, lỗi lớn AI duyệt, trùng nguồn, điểm AI
  const blockers = (r: CheckRound) => r.quality.filter((i) => i.severity === 'major').length + (r.review?.issues.filter((i) => i.severity === 'major').length ?? 0) + (r.dup.pass ? 0 : 1) + (!r.ai.pass && !r.ai.skipped ? 1 : 0);
  // Bản ít lỗi nhất qua các vòng: vòng sửa có thể làm bài tệ hơn (model viết lại quá tay), khi đó giữ bản này
  let best: { article: Article; key: string; round: CheckRound } | null = null;
  // Lỗi lớn AI duyệt của vòng trước: lỗi chỉ chặn khi lặp lại ở hai vòng liên tiếp (vòng đầu chặn ngay)
  let prevReviewKeys: Set<string> | null = null;
  let prevBlockers: number | null = null;

  while (true) {
    throwIfCancelled(ctx);
    round++;
    // Vòng đang dở (đã kiểm nội bộ, chỉ thiếu điểm) thì dùng lại, không tốn thêm lượt AI duyệt
    const pendingA = db.getArtifact<PendingScore>(run.id, 'pending_score');
    const pending = pendingA && pendingA.content.articleKey === articleKey ? pendingA.content : null;
    const quality = pending ? pending.quality : checkQuality(article, limits);
    const qualityPass = isPass(quality);
    const dup = pending ? pending.dup : checkDuplication(dedupParts(article), sources, { shingleSize: k, ratioMax: settings.dupRatioMax });
    if (!pending) dup.libraryMatches = checkLibraryDuplication(dedupParts(article), library, k);
    // AI duyệt: chỉ lỗi bắt buộc có trích dẫn kiểm chứng được; lỗi mới xuất hiện sau một vòng sửa phải lặp lại
    // ở vòng kế mới chặn (bộ duyệt của model rẻ hay nhảy số, cùng bài mà 0 rồi 6 lỗi)
    let review: AiReview;
    let droppedReview = 0;
    if (pending) review = pending.review!;
    else {
      const raw = await ctx.llm.reviewArticle({ keyword: run.keyword, options, settings, notes, outline, article });
      const verified = verifyReviewIssues(raw, article);
      droppedReview = verified.dropped;
      const majors = verified.review.issues.filter((i) => i.severity === 'major');
      const confirmedKeys = new Set(prevReviewKeys === null ? majors.map(reviewIssueKey) : majors.map(reviewIssueKey).filter((k) => prevReviewKeys!.has(k)));
      review = { ...verified.review, issues: verified.review.issues.map((i) => ({ ...i, confirmed: i.severity === 'major' && confirmedKeys.has(reviewIssueKey(i)) })) };
      review.pass = !review.issues.some((i) => i.confirmed);
      prevReviewKeys = new Set(majors.map(reviewIssueKey));
    }
    const reviewMajor = review.issues.filter((i) => i.confirmed);
    const reviewUnconfirmed = review.issues.filter((i) => i.severity === 'major' && !i.confirmed).length;
    const reviewPass = reviewMajor.length === 0;
    const internalPass = qualityPass && dup.pass && reviewPass;

    let ai: AiDetectReport;
    if (!manual) {
      try {
        ai = locateBlocks(await detector.scan(articleToPlainText(article), { title: run.keyword, model: settings.originalityModel, plagiarism: settings.webPlagiarismCheck, aiScoreMax: settings.aiScoreMax, plagiarismMax: settings.dupRatioMax }), article);
      } catch (err) {
        if (err instanceof TransientError || err instanceof ConfigError) throw err;
        ai = { provider: detector.id === 'mock' ? 'mock' : 'originality', aiScore: 1, originalScore: 0, blocks: [], creditsUsed: null, creditsRemaining: null, scanId: null, publicLink: null, pass: false, skipped: false, error: errorMessage(err), plagiarism: null };
      }
      if (ai.creditsUsed) ctx.count('detectorCredits', ai.creditsUsed);
    } else {
      const score = manualScoreFor(db, run.id, articleKey);
      if (score) {
        ai = reportFromManualScore(score, settings.aiScoreMax, article);
      } else if (!internalPass) {
        ai = placeholderReport('Chưa chấm trên Originality.ai vì bài còn lỗi nội bộ cần sửa trước, để không tốn credit.');
      } else if (scansUsed() >= settings.maxManualScans) {
        ai = placeholderReport(`Đã dùng hết ${settings.maxManualScans} lần chấm tay cho bài này. Bạn có thể nhập thêm điểm ở tab Tổng quan nếu muốn quét thêm.`);
      } else {
        const text = articleToPlainText(article);
        const state: PendingScore = { articleKey, round, text, words: wordCount(text), quality, qualityPass, dup, review, createdAt: nowIso() };
        db.deleteArtifacts(run.id, ['pending_score']);
        db.saveArtifact(run.id, 'pending_score', state);
        const msg = `Vòng ${round}: kiểm tra nội bộ đạt. Chờ bạn dán bài lên Originality.ai và nhập điểm (lần chấm ${scansUsed() + 1}/${settings.maxManualScans}).`;
        ctx.log(msg);
        return { message: msg, waiting: 'ai_score' };
      }
    }

    const pass = internalPass && ai.pass;
    const feedback = [
      ...issuesToFeedback(quality),
      ...dupToFeedback(dup, k),
      ...review.issues.map((i) => `[${i.confirmed ? 'BẮT BUỘC' : 'nên'}] ${i.where}: ${i.problem}${i.quote ? ` (câu: "${i.quote.slice(0, 120)}")` : ''} → ${i.fix}`),
    ];
    if (!ai.pass && !ai.skipped) {
      feedback.unshift(
        ai.error
          ? `[BẮT BUỘC] Công cụ dò AI lỗi: ${ai.error}`
          : `[BẮT BUỘC] Biên tập chấm bài còn đọc giống văn máy ở mức ${(ai.aiScore * 100).toFixed(1)}%, mức chấp nhận là ${(settings.aiScoreMax * 100).toFixed(0)}%. Viết lại các câu bị đánh dấu và cả đoạn chứa chúng bằng giọng kể chuyện thân mật, lệch nhịp, có chi tiết đời thường và chính kiến của người viết.`,
      );
      if (ai.plagiarism && !ai.plagiarism.pass) feedback.unshift(`[BẮT BUỘC] Originality.ai phát hiện trùng toàn web ${(ai.plagiarism.score * 100).toFixed(0)}% (${ai.plagiarism.sources.slice(0, 3).map((s) => s.url).join(', ')}). Diễn đạt lại các đoạn trùng.`);
    }
    lastRound = { round, checkedAt: nowIso(), quality, qualityPass, dup, ai, review, pass, feedback };
    db.saveArtifact(run.id, 'check', lastRound);
    if (!best || blockers(lastRound) < blockers(best.round)) best = { article, key: articleKey, round: lastRound };
    if (pending) db.deleteArtifacts(run.id, ['pending_score']);
    db.updateRun(run.id, { rounds: round });
    const aiText = ai.skipped ? (manual ? 'chưa chấm' : 'bỏ qua') : `${(ai.aiScore * 100).toFixed(1)}% ${ai.pass ? 'đạt' : 'chưa đạt'}`;
    ctx.log(
      `Vòng ${round}: chất lượng ${qualityPass ? 'đạt' : `${quality.filter((i) => i.severity === 'major').length} lỗi bắt buộc`}; trùng nguồn ${(dup.ratio * 100).toFixed(1)}% (dài nhất ${dup.longestRun} từ) ${dup.pass ? 'đạt' : 'chưa đạt'}; AI ${aiText}; AI duyệt ${reviewPass ? 'đạt' : `${reviewMajor.length} lỗi lớn`}${reviewUnconfirmed ? ` (+${reviewUnconfirmed} lỗi mới, chờ vòng sau xác nhận)` : ''}${droppedReview ? `, bỏ ${droppedReview} lỗi không trích được câu trong bài` : ''}`,
      pass ? 'info' : 'warn',
    );
    if (pass) break;
    // Hết lượt chấm tay mà nội bộ đã đạt: sửa thêm cũng không đo được, dừng để người dùng quyết định
    if (manual && ai.skipped && internalPass) break;
    if (round > settings.maxFixRounds) break;
    // Vòng sửa không giảm được số lỗi chặn: sửa tiếp chỉ tốn thời gian và sinh lỗi mới, dừng để người dùng xem
    if (prevBlockers !== null && blockers(lastRound) >= prevBlockers) {
      ctx.log(`Vòng ${round} không giảm lỗi chặn (${blockers(lastRound)} so với ${prevBlockers} ở vòng trước): dừng sửa, giữ bản ít lỗi nhất để bạn xem lại.`, 'warn');
      break;
    }
    prevBlockers = blockers(lastRound);
    const located = locateTargets(article, { quality, dup, review, blocks: ai.blocks, minWords: limits.minWords, maxWords: limits.maxWords, shingleSize: k });
    if (located.targets.length && !located.unlocated.length) {
      // Sửa đúng chỗ: chỉ các phần bị lỗi đi qua model, phần còn lại giữ nguyên từng chữ
      const patches = await ctx.llm.patchArticle({ keyword: run.keyword, options, settings, notes, outline, article, targets: located.targets, round });
      article = finalizeArticle(ctx, applyPatches(article, patches, located.targets));
      ctx.log(`Vòng ${round}: sửa đúng ${located.targets.length} chỗ (${located.targets.map((t) => t.where).join(', ')}), phần còn lại giữ nguyên.`);
    } else {
      if (located.unlocated.length) ctx.log(`Vòng ${round}: ${located.unlocated.length} lỗi không khoanh được vị trí (${located.unlocated.map((u) => u.slice(0, 80)).join(' | ')}), sửa cả bài.`, 'warn');
      const flagged = ai.blocks
        .filter((b) => b.aiScore >= 0.5)
        .sort((a, b) => b.aiScore - a.aiScore)
        .slice(0, 25)
        .map((b) => b.text);
      article = finalizeArticle(ctx, await ctx.llm.fixArticle({ keyword: run.keyword, options, settings, notes, outline, article, feedback, flaggedTexts: flagged, round }));
    }
    const v = db.saveArtifact(run.id, 'fixed', article);
    articleKey = `fixed:${v}`;
    current = { article, kind: 'fixed', version: v, key: articleKey };
  }

  let final = lastRound!;
  if (!final.pass && best && best.key !== articleKey && blockers(best.round) < blockers(final)) {
    // Các vòng sửa sau làm bài nhiều lỗi hơn: lấy lại bản của vòng ít lỗi nhất làm bản cuối
    const v = db.saveArtifact(run.id, 'fixed', best.article);
    article = best.article;
    ctx.log(`Vòng ${final.round} có ${blockers(final)} lỗi chặn, nhiều hơn vòng ${best.round.round} (${blockers(best.round)}): giữ lại bản của vòng ${best.round.round} làm bản cuối (fixed v${v}).`, 'warn');
    final = best.round;
  }
  db.updateRun(run.id, {
    finalScore: { aiScore: final.ai.skipped ? null : final.ai.aiScore, dupRatio: final.dup.ratio, words: articleWordCount(article), pass: final.pass, rounds: round },
  });
  const msg = final.pass
    ? `Đạt sau ${round} vòng: AI ${final.ai.skipped ? 'không quét' : `${(final.ai.aiScore * 100).toFixed(1)}%${final.ai.provider === 'manual' ? ' (bạn nhập)' : ''}`}, trùng ${(final.dup.ratio * 100).toFixed(1)}%, ${articleWordCount(article)} từ`
    : `Chưa đạt sau ${round} vòng kiểm tra (${settings.maxFixRounds} vòng sửa): ${final.feedback.filter((f) => f.startsWith('[BẮT BUỘC]')).length} lỗi bắt buộc còn lại${final.round !== round ? ` (bản cuối là bản vòng ${final.round}, ít lỗi nhất)` : ''}${final.ai.skipped && final.ai.error ? `. ${final.ai.error}` : ''}. Xem tab Kiểm tra.`;
  return { message: msg, needsReview: !final.pass };
}

async function stepExport(ctx: StepContext): Promise<StepResult> {
  const { run, db, config } = ctx;
  const current = latestArticle(db, run.id);
  if (!current) throw new AppError('Chưa có bài để xuất.');
  const dir = path.join(config.exportsDir, String(run.id));
  fs.mkdirSync(dir, { recursive: true });
  const base = slugify(run.keyword);
  const a = current.article;
  const places = run.options.kind !== 'web' ? db.getArtifact<PlacesData>(run.id, 'places')?.content ?? null : null;
  const sourceUrls = places ? placesForExport(places).map((p) => String(p.mapsUrl)) : db.okSources(run.id).map((s) => s.url);
  const files: Record<string, string> = {
    md: `${base}.md`,
    html: `${base}.html`,
    json: `${base}.json`,
    docx: `${base}.docx`,
    txt: `${base}.txt`,
    zip: `${base}.zip`,
  };
  // Ảnh: trỏ tới URL gốc ảnh nếu đã đặt; không thì HTML và DOCX nhúng ảnh, ZIP kèm thư mục photos
  const bundle = await buildExportBundle(a, { keyword: run.keyword, dir, baseUrl: ctx.settings.photoBaseUrl, places, sourceUrls, brand: run.options.kind === 'brand' ? run.options : null });
  fs.writeFileSync(path.join(dir, files.md!), bundle.md, 'utf8');
  fs.writeFileSync(path.join(dir, files.html!), bundle.html, 'utf8');
  fs.writeFileSync(path.join(dir, files.json!), JSON.stringify(bundle.json, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, files.docx!), bundle.docx);
  fs.writeFileSync(path.join(dir, files.txt!), bundle.txt, 'utf8');
  fs.writeFileSync(path.join(dir, files.zip!), await bundleToZip(bundle, base));
  db.saveArtifact(run.id, 'exports', { dir, files, articleKind: current.kind, articleVersion: current.version, createdAt: nowIso() });
  const msg = `Đã xuất ${Object.keys(files).length} file vào ${dir}${bundle.photos.length ? ` (${bundle.photos.length} ảnh: ${bundle.photoMode === 'url' ? `trỏ tới ${ctx.settings.photoBaseUrl}` : 'kèm trong ZIP, nhúng trong HTML và DOCX'})` : ''}`;
  ctx.log(msg);
  return { message: msg };
}

export const STEP_RUNNERS: Record<StepId, (ctx: StepContext) => Promise<StepResult>> = {
  search: stepSearch,
  fetch: stepFetch,
  extract: stepExtract,
  outline: stepOutline,
  write: stepWrite,
  edit: stepEdit,
  verify: stepVerify,
  export: stepExport,
};

/** Bài tổng hợp quán: ba bước đầu lấy dữ liệu từ Google Maps, các bước sau dùng chung. */
export const ROUNDUP_RUNNERS: Record<StepId, (ctx: StepContext) => Promise<StepResult>> = {
  ...STEP_RUNNERS,
  search: stepPlaces,
  fetch: stepReviewsAndPhotos,
  extract: stepRoundupNotes,
};

export const BRAND_RUNNERS: Record<StepId, (ctx: StepContext) => Promise<StepResult>> = {
  ...STEP_RUNNERS,
  search: stepBrandPlace,
  fetch: stepBrandMedia,
  extract: stepBrandNotes,
};

export function runnerFor(kind: RunKind | undefined, step: StepId): (ctx: StepContext) => Promise<StepResult> {
  return (kind === 'roundup' ? ROUNDUP_RUNNERS : kind === 'brand' ? BRAND_RUNNERS : STEP_RUNNERS)[step];
}

/** Kiểm tra nhanh cho bài người dùng vừa sửa tay (không gọi AI sửa). */
export function quickChecks(db: Db, run: Run, settings: GeneralSettings, article: Article) {
  const quality = checkQuality(article, qualityLimits(db, run));
  const sources = db.okSources(run.id).map((s) => ({ index: s.position, url: s.url, text: s.text ?? '' }));
  const dup = checkDuplication(dedupParts(article), sources, { shingleSize: settings.shingleSize, ratioMax: settings.dupRatioMax });
  return { quality, qualityPass: isPass(quality), dup, words: articleWordCount(article), sentences: wordCount(articleToPlainText(article)) };
}
