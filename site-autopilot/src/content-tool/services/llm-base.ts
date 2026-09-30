import type { z } from 'zod';
import type { ContentLlm, LlmRunContext, PlaceClassification, PlaceForClassify, PlaceForRole, SourceForLlm } from './types.js';
import type { AiReview, Article, ArticlePatch, LlmProvider, Outline, PatchTarget, PlaceReview, PlaceReviewSummary, PlaceRole, ResearchNotes, SerpData, UsageTotals } from '../core/types.js';
import { emptyUsage } from '../core/types.js';
import { LlmArticleSchema, LlmNotesSchema, LlmOutlineSchema, LlmPatchSchema, LlmPlaceClassifySchema, LlmPlaceRolesSchema, LlmReviewSchema, LlmReviewSummarySchema, LlmTranslateSchema, type LlmArticle, type LlmNotes, type LlmOutline } from '../generator/llm-schemas.js';
import { MAPS_RULES, RESEARCH_RULES, REVIEWER_RULES, WRITER_RULES, assignRolesPrompt, classifyPlacesPrompt, editPrompt, extractNotesPrompt, fixPrompt, outlinePrompt, patchPrompt, reviewPrompt, runContextBlock, summarizeReviewsPrompt, translatePrompt, writePrompt } from '../generator/prompts.js';
import { wordCount } from '../core/util.js';
import { capFirst } from '../generator/quality.js';
import { AppError } from '../core/errors.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('llm');

/**
 * Phần dùng chung cho mọi nhà cung cấp model: dựng prompt từng bước, chuyển đổi kết quả, thống kê chi phí.
 * Lớp con chỉ cần cài `structured()` (gọi model, trả JSON đúng schema) và `verify()`.
 */

export interface StructuredRequest {
  model: string;
  /** Các khối system theo thứ tự: quy tắc chung (ổn định) rồi bối cảnh bài */
  system: string[];
  user: string;
  maxTokens: number;
  label: string;
  /** Mức suy nghĩ cho lượt này (lượt phân loại nhỏ nên để "low" để model suy luận không đốt hết trần token) */
  reasoning?: 'low' | 'medium' | 'high';
  /** Nhiệt độ sinh cho lượt này */
  temperature?: number;
}

export interface LlmModels {
  writerModel: string;
  researchModel: string;
  /** Nhiệt độ cho các lượt viết, biên tập, sửa (nhà cung cấp nào không hỗ trợ thì bỏ qua) */
  temperature?: number;
}

function levelNum(l: 'h2' | 'h3'): 2 | 3 {
  return l === 'h3' ? 3 : 2;
}

export function notesWordCount(n: LlmNotes): number {
  const all = [...n.keyFacts, ...n.numbersAndNames, ...n.disagreements, ...n.perSource.flatMap((s) => s.facts), n.summary];
  return all.reduce((acc, t) => acc + wordCount(t), 0);
}

export function outlineFromLlm(out: LlmOutline, forced: Outline['style'] | null): Outline {
  return {
    ...out,
    title: capFirst(out.title.trim()),
    h1: capFirst(out.h1.trim()),
    metaDescription: capFirst(out.metaDescription.trim()),
    style: forced ?? out.style,
    sections: out.sections.map((s) => ({ ...s, level: levelNum(s.level), sourceRefs: s.sourceRefs.map((n) => Math.round(n)), tag: s.tag.trim(), comparisonItems: s.comparisonItems.map((x) => x.trim()).filter(Boolean), comparisonCriteria: s.comparisonCriteria.map((x) => x.trim()).filter(Boolean) })),
    targetWords: Math.round(out.targetWords),
  };
}

export function articleFromLlm(out: LlmArticle, keyword: string, outline: Outline): Article {
  return {
    title: out.title,
    metaDescription: out.metaDescription,
    h1: out.h1,
    excerpt: out.excerpt,
    quickSummary: out.quickSummary,
    intro: out.intro,
    sections: out.sections.map((s) => ({ heading: s.heading, level: levelNum(s.level), body: s.body })),
    faq: out.faq,
    nextSteps: out.nextSteps,
    images: out.images.length ? out.images : outline.imageIdeas,
    targetKeyword: keyword,
    secondaryKeywords: out.secondaryKeywordsUsed.length ? out.secondaryKeywordsUsed : outline.secondaryKeywords,
    style: outline.style,
  };
}

export function articleToLlm(a: Article): LlmArticle {
  return {
    title: a.title,
    metaDescription: a.metaDescription,
    h1: a.h1,
    excerpt: a.excerpt,
    quickSummary: a.quickSummary,
    intro: a.intro,
    sections: a.sections.map((s) => ({ heading: s.heading, level: s.level === 3 ? 'h3' : 'h2', body: s.body })),
    faq: a.faq,
    nextSteps: a.nextSteps,
    images: a.images,
    secondaryKeywordsUsed: a.secondaryKeywords,
  };
}

/** Lấy JSON từ văn bản model trả về khi không ép được schema: bỏ rào code, cắt từ dấu { đầu tới } cuối. */
export function extractJsonText(text: string): string {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence?.[1]) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  return start >= 0 && end > start ? t.slice(start, end + 1) : t;
}

export abstract class BaseContentLlm implements ContentLlm {
  abstract readonly provider: LlmProvider;
  protected readonly totals: UsageTotals = emptyUsage();

  protected constructor(protected readonly models: LlmModels) {}

  usage(): UsageTotals {
    return this.totals;
  }

  protected record(model: string, inputTokens: number, outputTokens: number, usd: number): void {
    this.totals.calls += 1;
    this.totals.inputTokens += inputTokens;
    this.totals.outputTokens += outputTokens;
    this.totals.usd += usd;
    const m = (this.totals.byModel[model] ??= { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 });
    m.calls += 1;
    m.inputTokens += inputTokens;
    m.outputTokens += outputTokens;
    m.usd += usd;
  }

  /** Gọi model với yêu cầu trả JSON đúng schema; lớp con cài đặt. */
  protected abstract structured<T>(schema: z.ZodType<T>, req: StructuredRequest): Promise<T>;

  abstract verify(): Promise<{ ok: boolean; message: string }>;

  async extractNotes(input: LlmRunContext & { sources: SourceForLlm[]; serp: SerpData }): Promise<ResearchNotes> {
    const { settings } = input;
    let out = await this.structured(LlmNotesSchema, { model: this.models.researchModel, system: [RESEARCH_RULES], user: extractNotesPrompt(input), maxTokens: 40000, label: 'Rút ghi chú' });
    let total = notesWordCount(out);
    if (total < settings.notesMinWords * 0.8 || total > settings.notesMaxWords * 1.35) {
      const ask =
        total < settings.notesMinWords * 0.8
          ? `Bản ghi chú lần trước chỉ ${total} từ, cần ${settings.notesMinWords} đến ${settings.notesMaxWords} từ. Hãy rút thêm dữ kiện cụ thể từ các nguồn (cách làm, phân loại, số liệu, mẹo, sai lầm, so sánh), không lặp lại dữ kiện đã có, không thêm kiến thức ngoài nguồn.`
          : `Bản ghi chú lần trước ${total} từ, vượt mức ${settings.notesMaxWords}. Hãy cô đặc: gộp dữ kiện trùng, bỏ ý chung chung, giữ toàn bộ số liệu và tên riêng.`;
      out = await this.structured(LlmNotesSchema, { model: this.models.researchModel, system: [RESEARCH_RULES], user: `${extractNotesPrompt(input)}\n\n${ask}\n\nBẢN GHI CHÚ LẦN TRƯỚC:\n${JSON.stringify(out)}`, maxTokens: 40000, label: 'Rút ghi chú (điều chỉnh độ dài)' });
      total = notesWordCount(out);
    }
    const urlByIndex = new Map(input.sources.map((s) => [s.index, s.url]));
    const topSet = new Set(input.sources.filter((s) => s.topRank).map((s) => s.index));
    const topSites = out.topSites
      .map((t) => ({ ...t, sourceIndex: Math.round(t.sourceIndex), position: Math.round(t.position) || Math.round(t.sourceIndex), url: urlByIndex.get(Math.round(t.sourceIndex)) ?? '' }))
      .filter((t) => urlByIndex.has(t.sourceIndex))
      .sort((a, b) => a.position - b.position);
    const topTags = new Set(topSites.filter((t) => topSet.size === 0 || topSet.has(t.sourceIndex)).flatMap((t) => t.tags.map((x) => x.trim().toLowerCase())));
    return {
      keyword: input.keyword,
      ...out,
      perSource: out.perSource.map((s) => ({ ...s, sourceIndex: Math.round(s.sourceIndex), url: urlByIndex.get(Math.round(s.sourceIndex)) ?? '' })),
      topics: out.topics.map((t) => ({ ...t, tag: t.tag.trim(), sourceRefs: t.sourceRefs.map((n) => Math.round(n)), inTopSites: t.inTopSites || topTags.has(t.tag.trim().toLowerCase()) })),
      topSites,
      comparisons: out.comparisons.map((c) => ({ ...c, sourceRefs: c.sourceRefs.map((n) => Math.round(n)) })),
      similarItems: out.similarItems.map((c) => ({ ...c, sourceRefs: c.sourceRefs.map((n) => Math.round(n)) })),
      peopleAlsoAsk: input.serp.peopleAlsoAsk,
      totalWords: total,
    };
  }

  async buildOutline(input: LlmRunContext & { notes: ResearchNotes; serp: SerpData }): Promise<Outline> {
    const forced = input.options.style === 'auto' ? null : input.options.style;
    const out = await this.structured(LlmOutlineSchema, {
      model: this.models.writerModel,
      system: [WRITER_RULES, runContextBlock({ keyword: input.keyword, options: input.options, settings: input.settings, notes: input.notes, styleId: forced ?? undefined })],
      user: outlinePrompt({ keyword: input.keyword, options: input.options, notes: input.notes, serp: input.serp, settings: input.settings, forcedStyle: forced }),
      maxTokens: 20000,
      label: 'Lập bố cục',
    });
    return outlineFromLlm(out, forced);
  }

  async writeArticle(input: LlmRunContext & { notes: ResearchNotes; outline: Outline }): Promise<Article> {
    const out = await this.structured(LlmArticleSchema, {
      model: this.models.writerModel,
      system: [WRITER_RULES, runContextBlock({ keyword: input.keyword, options: input.options, settings: input.settings, notes: input.notes, outline: input.outline })],
      user: writePrompt({ keyword: input.keyword, options: input.options, outline: input.outline }),
      maxTokens: 40000,
      label: 'Viết bài',
      temperature: this.models.temperature,
    });
    return articleFromLlm(out, input.keyword, input.outline);
  }

  async editArticle(input: LlmRunContext & { notes: ResearchNotes; outline: Outline; article: Article; feedback: string[] }): Promise<Article> {
    const out = await this.structured(LlmArticleSchema, {
      model: this.models.writerModel,
      system: [WRITER_RULES, runContextBlock({ keyword: input.keyword, options: input.options, settings: input.settings, notes: input.notes, outline: input.outline })],
      user: editPrompt({ article: articleToLlm(input.article) as unknown as Article, feedback: input.feedback, options: input.options }),
      maxTokens: 40000,
      label: 'Biên tập',
      temperature: this.models.temperature,
    });
    return articleFromLlm(out, input.keyword, input.outline);
  }

  async fixArticle(input: LlmRunContext & { notes: ResearchNotes; outline: Outline; article: Article; feedback: string[]; flaggedTexts: string[]; round: number }): Promise<Article> {
    const out = await this.structured(LlmArticleSchema, {
      model: this.models.writerModel,
      system: [WRITER_RULES, runContextBlock({ keyword: input.keyword, options: input.options, settings: input.settings, notes: input.notes, outline: input.outline })],
      user: fixPrompt({ article: articleToLlm(input.article) as unknown as Article, feedback: input.feedback, flaggedTexts: input.flaggedTexts, round: input.round, options: input.options }),
      maxTokens: 40000,
      label: `Sửa vòng ${input.round}`,
      temperature: this.models.temperature,
    });
    return articleFromLlm(out, input.keyword, input.outline);
  }

  async patchArticle(input: LlmRunContext & { notes: ResearchNotes; outline: Outline; article: Article; targets: PatchTarget[]; round: number }): Promise<ArticlePatch[]> {
    const out = await this.structured(LlmPatchSchema, {
      model: this.models.writerModel,
      system: [WRITER_RULES, runContextBlock({ keyword: input.keyword, options: input.options, settings: input.settings, notes: input.notes, outline: input.outline })],
      user: patchPrompt({ article: input.article, targets: input.targets, round: input.round, options: input.options }),
      maxTokens: 24000,
      label: `Sửa đúng chỗ vòng ${input.round}`,
      temperature: this.models.temperature,
    });
    return out.patches.map((p) => ({ where: p.where.trim(), heading: p.heading, text: p.text }));
  }

  /** Nhiệt độ 0 để cùng một bài cho cùng một kết quả duyệt, không nhảy số giữa các vòng. */
  async reviewArticle(input: LlmRunContext & { notes: ResearchNotes; outline: Outline; article: Article }): Promise<AiReview> {
    return this.structured(LlmReviewSchema, {
      model: this.models.writerModel,
      system: [REVIEWER_RULES, runContextBlock({ keyword: input.keyword, options: input.options, settings: input.settings, notes: input.notes, outline: input.outline })],
      user: reviewPrompt({ article: articleToLlm(input.article) as unknown as Article, options: input.options }),
      maxTokens: 20000,
      label: 'AI duyệt bài',
      temperature: 0,
    });
  }

  async translateKeyword(keyword: string): Promise<string> {
    const out = await this.structured(LlmTranslateSchema, { model: this.models.researchModel, system: [], user: translatePrompt(keyword), maxTokens: 4000, label: 'Dịch từ khóa' });
    return out.english.trim() || keyword;
  }

  /**
   * Lọc quán theo từng nhóm 20 để câu trả lời ngắn; nhóm nào lỗi (model cắt, JSON hỏng) thì bỏ qua và ghi log,
   * bước gọi sẽ tự phân loại phần thiếu bằng quy tắc. Mức suy nghĩ "low" vì việc này đơn giản.
   */
  async classifyPlaces(input: { dish: string; area: string; places: PlaceForClassify[] }): Promise<PlaceClassification[]> {
    const out: PlaceClassification[] = [];
    for (let i = 0; i < input.places.length; i += 20) {
      const chunk = input.places.slice(i, i + 20);
      try {
        const res = await this.structured(LlmPlaceClassifySchema, { model: this.models.researchModel, system: [MAPS_RULES], user: classifyPlacesPrompt({ ...input, places: chunk }), maxTokens: 12000, label: `Lọc quán ${i + 1} đến ${i + chunk.length}`, reasoning: 'low' });
        for (const p of res.places) out.push({ index: Math.round(p.index), matchesDish: p.matchesDish, inArea: p.inArea, groupKey: p.groupKey.trim() });
      } catch (err) {
        if (err instanceof AppError && err.code === 'cancelled') throw err;
        log.warn(`Lọc quán ${i + 1} đến ${i + chunk.length} lỗi, dùng quy tắc thay: ${(err as Error).message}`);
      }
    }
    return out;
  }

  /** Gán vai riêng cho từng quán trong một lượt; lỗi thì trả rỗng để tool gán bằng quy tắc. */
  async assignPlaceRoles(input: { dish: string; area: string; places: PlaceForRole[] }): Promise<{ index: number; role: PlaceRole }[]> {
    if (!input.places.length) return [];
    try {
      const res = await this.structured(LlmPlaceRolesSchema, { model: this.models.researchModel, system: [MAPS_RULES], user: assignRolesPrompt(input), maxTokens: 6000, label: 'Gán vai cho từng quán', reasoning: 'low' });
      return res.places.map((p) => ({ index: Math.round(p.index), role: { label: p.role.trim(), reason: p.reason.trim(), bestFor: p.bestFor.trim() } }));
    } catch (err) {
      if (err instanceof AppError && err.code === 'cancelled') throw err;
      log.warn(`Gán vai cho quán lỗi, dùng quy tắc thay: ${(err as Error).message}`);
      return [];
    }
  }

  /** Rút ý đánh giá theo nhóm 4 quán; nhóm lỗi thì bỏ qua, quán đó không có phần tóm tắt. */
  async summarizeReviews(input: { dish: string; area: string; places: { index: number; name: string; reviews: PlaceReview[] }[] }): Promise<{ index: number; summary: PlaceReviewSummary }[]> {
    const withReviews = input.places.filter((p) => p.reviews.length);
    const out: { index: number; summary: PlaceReviewSummary }[] = [];
    for (let i = 0; i < withReviews.length; i += 4) {
      const chunk = withReviews.slice(i, i + 4);
      try {
        const res = await this.structured(LlmReviewSummarySchema, { model: this.models.researchModel, system: [MAPS_RULES], user: summarizeReviewsPrompt({ ...input, places: chunk }), maxTokens: 16000, label: `Rút ý đánh giá (${chunk.map((c) => c.name).join(', ')})`, reasoning: 'low' });
        for (const p of res.places) {
          const src = chunk.find((x) => x.index === Math.round(p.index));
          out.push({ index: Math.round(p.index), summary: { praised: p.praised, complained: p.complained, signature: p.signature, bestFor: p.bestFor, oneLine: p.oneLine, sampleCount: src?.reviews.length ?? 0 } });
        }
      } catch (err) {
        if (err instanceof AppError && err.code === 'cancelled') throw err;
        log.warn(`Rút ý đánh giá lỗi cho ${chunk.map((c) => c.name).join(', ')}: ${(err as Error).message}`);
      }
    }
    return out;
  }
}
