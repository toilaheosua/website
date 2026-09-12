import { z } from 'zod';

/**
 * Lược đồ dành riêng cho structured outputs của Claude.
 * Ràng buộc: mọi trường đều bắt buộc, không dùng min/max/default/optional,
 * để đúng giới hạn của tính năng JSON schema phía API.
 */

export const LlmServiceSchema = z.object({
  name: z.string(),
  summary: z.string(),
  imageQuery: z.string(),
});

export const LlmPostPlanSchema = z.object({
  title: z.string(),
  targetKeyword: z.string(),
  angle: z.string(),
  imageQuery: z.string(),
});

export const LlmFaqSchema = z.object({
  question: z.string(),
  answer: z.string(),
});

export const LlmPlanSchema = z.object({
  tagline: z.string(),
  brandVoice: z.string(),
  audienceInsight: z.string(),
  heroImageQuery: z.string(),
  aboutImageQuery: z.string(),
  services: z.array(LlmServiceSchema),
  posts: z.array(LlmPostPlanSchema),
  faq: z.array(LlmFaqSchema),
  ctaPrimary: z.string(),
  ctaSecondary: z.string(),
  differentiators: z.array(z.string()),
  authorName: z.string(),
  authorTitle: z.string(),
  authorBio: z.string(),
});
export type LlmPlan = z.infer<typeof LlmPlanSchema>;

export const LlmSectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
  imageQuery: z.string(),
});

export const LlmServiceDetailSchema = z.object({
  name: z.string(),
  summary: z.string(),
  body: z.string(),
  imageQuery: z.string(),
});

export const LlmPageSchema = z.object({
  title: z.string(),
  metaDescription: z.string(),
  h1: z.string(),
  intro: z.string(),
  excerpt: z.string(),
  targetKeyword: z.string(),
  heroImageAlt: z.string(),
  keyTakeaways: z.array(z.string()),
  sections: z.array(LlmSectionSchema),
  faq: z.array(LlmFaqSchema),
  services: z.array(LlmServiceDetailSchema),
});
export type LlmPage = z.infer<typeof LlmPageSchema>;

export const LlmTopicsSchema = z.object({
  posts: z.array(LlmPostPlanSchema),
});

/** Kết quả AI duyệt chất lượng một trang. */
export const LlmReviewSchema = z.object({
  pass: z.boolean(),
  summary: z.string(),
  issues: z.array(
    z.object({
      severity: z.enum(['major', 'minor']),
      where: z.string(),
      problem: z.string(),
      fix: z.string(),
    }),
  ),
});
export type LlmReview = z.infer<typeof LlmReviewSchema>;

/** Gợi ý Entity rút từ Bộ Câu Hỏi: chuỗi rỗng hoặc mảng rỗng = không có thông tin. */
export const LlmEntitySuggestSchema = z.object({
  legalName: z.string(),
  alternateName: z.array(z.string()),
  description: z.string(),
  foundingDate: z.string(),
  founder: z.string(),
  telephone: z.string(),
  email: z.string(),
  streetAddress: z.string(),
  addressLocality: z.string(),
  addressRegion: z.string(),
  openingHours: z.array(z.string()),
  priceRange: z.string(),
  areaServed: z.array(z.string()),
  facebook: z.string(),
  zalo: z.string(),
  youtube: z.string(),
  tiktok: z.string(),
  instagram: z.string(),
  googleMaps: z.string(),
  authorName: z.string(),
  authorJobTitle: z.string(),
  authorBio: z.string(),
});
export type LlmEntitySuggest = z.infer<typeof LlmEntitySuggestSchema>;
