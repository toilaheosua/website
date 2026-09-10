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
