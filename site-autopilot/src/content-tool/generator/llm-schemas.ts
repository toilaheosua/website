import { z } from 'zod';

/**
 * Lược đồ dành riêng cho structured outputs của Claude.
 * Ràng buộc: mọi trường đều bắt buộc, không dùng min/max/default/optional,
 * để đúng giới hạn của tính năng JSON schema phía API.
 */

export const LlmNotesSchema = z.object({
  searchIntent: z.enum(['informational', 'comparison', 'howto', 'transactional', 'local', 'mixed']),
  intentExplanation: z.string(),
  summary: z.string(),
  perSource: z.array(
    z.object({
      sourceIndex: z.number(),
      angle: z.string(),
      facts: z.array(z.string()),
      tags: z.array(z.string()),
    }),
  ),
  keyFacts: z.array(z.string()),
  numbersAndNames: z.array(z.string()),
  disagreements: z.array(z.string()),
  commonSubtopics: z.array(z.string()),
  gaps: z.array(z.string()),
  secondaryKeywords: z.array(z.string()),
  topics: z.array(
    z.object({
      tag: z.string(),
      description: z.string(),
      sourceRefs: z.array(z.number()),
      facts: z.array(z.string()),
      inTopSites: z.boolean(),
    }),
  ),
  topSites: z.array(
    z.object({
      sourceIndex: z.number(),
      position: z.number(),
      structure: z.array(z.string()),
      tags: z.array(z.string()),
      contentType: z.string(),
    }),
  ),
  comparisons: z.array(z.object({ topic: z.string(), items: z.array(z.string()), criteria: z.array(z.string()), sourceRefs: z.array(z.number()) })),
  similarItems: z.array(z.object({ name: z.string(), differences: z.array(z.string()), sourceRefs: z.array(z.number()) })),
});
export type LlmNotes = z.infer<typeof LlmNotesSchema>;

export const LlmOutlineSchema = z.object({
  title: z.string(),
  h1: z.string(),
  metaDescription: z.string(),
  style: z.enum(['story', 'expert', 'playbook']),
  styleReason: z.string(),
  searchIntent: z.string(),
  hookIdea: z.string(),
  quickSummary: z.array(z.string()),
  sections: z.array(
    z.object({
      heading: z.string(),
      level: z.enum(['h2', 'h3']),
      goal: z.string(),
      points: z.array(z.string()),
      sourceRefs: z.array(z.number()),
      format: z.enum(['text', 'steps', 'table', 'checklist', 'mixed']),
      tag: z.string(),
      comparisonItems: z.array(z.string()),
      comparisonCriteria: z.array(z.string()),
    }),
  ),
  faq: z.array(z.string()),
  nextSteps: z.string(),
  secondaryKeywords: z.array(z.string()),
  tableCandidates: z.array(z.string()),
  imageIdeas: z.array(z.object({ position: z.string(), query: z.string(), alt: z.string() })),
  targetWords: z.number(),
});
export type LlmOutline = z.infer<typeof LlmOutlineSchema>;

export const LlmArticleSchema = z.object({
  title: z.string(),
  metaDescription: z.string(),
  h1: z.string(),
  excerpt: z.string(),
  quickSummary: z.array(z.string()),
  intro: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      level: z.enum(['h2', 'h3']),
      body: z.string(),
    }),
  ),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })),
  nextSteps: z.string(),
  images: z.array(z.object({ position: z.string(), query: z.string(), alt: z.string() })),
  secondaryKeywordsUsed: z.array(z.string()),
});
export type LlmArticle = z.infer<typeof LlmArticleSchema>;

export const LlmReviewSchema = z.object({
  pass: z.boolean(),
  summary: z.string(),
  issues: z.array(
    z.object({
      severity: z.enum(['major', 'minor']),
      where: z.string(),
      problem: z.string(),
      fix: z.string(),
      quote: z.string().default(''),
    }),
  ),
});
export type LlmReview = z.infer<typeof LlmReviewSchema>;

/** Vòng sửa có mục tiêu: chỉ các phần được yêu cầu */
export const LlmPatchSchema = z.object({
  patches: z.array(
    z.object({
      where: z.string(),
      heading: z.string().default(''),
      text: z.string(),
    }),
  ),
});
export type LlmPatch = z.infer<typeof LlmPatchSchema>;

export const LlmTranslateSchema = z.object({
  english: z.string(),
});

/** Tổng hợp quán: phân loại ứng viên từ Google Maps */
export const LlmPlaceClassifySchema = z.object({
  places: z.array(
    z.object({
      index: z.number(),
      matchesDish: z.boolean(),
      inArea: z.boolean(),
      groupKey: z.string(),
    }),
  ),
});

/** Tổng hợp quán: rút ý từ đánh giá */
export const LlmReviewSummarySchema = z.object({
  places: z.array(
    z.object({
      index: z.number(),
      praised: z.array(z.string()),
      complained: z.array(z.string()),
      signature: z.array(z.string()),
      bestFor: z.array(z.string()),
      oneLine: z.string(),
    }),
  ),
});

/** Vai riêng của từng quán trong bài tổng hợp. */
export const LlmPlaceRolesSchema = z.object({
  places: z.array(
    z.object({
      index: z.number(),
      role: z.string(),
      reason: z.string(),
      bestFor: z.string(),
    }),
  ),
});

/** Kết quả tìm kiếm khi dùng Claude web search làm nguồn dự phòng. */
export const LlmSerpSchema = z.object({
  results: z.array(z.object({ title: z.string(), url: z.string(), snippet: z.string() })),
  peopleAlsoAsk: z.array(z.string()),
  relatedSearches: z.array(z.string()),
});
