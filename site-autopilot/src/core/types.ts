import { z } from 'zod';

/* ------------------------------------------------------------------ */
/*  Brief: thông tin bạn nhập khi tạo site                              */
/* ------------------------------------------------------------------ */

export const SiteTypeSchema = z.enum(['business', 'blog']);
export type SiteType = z.infer<typeof SiteTypeSchema>;

export const SiteBriefSchema = z.object({
  brandName: z.string().min(1),
  siteType: SiteTypeSchema.default('business'),
  language: z.enum(['vi', 'en']).default('vi'),
  industry: z.string().min(1),
  description: z.string().default(''),
  services: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  targetAudience: z.string().default(''),
  location: z.string().default(''),
  usp: z.string().default(''),
  tone: z.string().default(''),
  postsCount: z.number().int().min(0).max(20).default(5),
  themeId: z.string().default('auto'),
  /** Kiểu viết nội dung: auto = chọn theo ngành */
  contentStyle: z.enum(['auto', 'story', 'expert', 'playbook']).default('auto'),
  /** false = không dùng ảnh stock Pexels, chỉ dùng kho ảnh thật của site */
  useStockImages: z.boolean().default(true),
  targetCountries: z.array(z.string()).default([]),
  /** Ghi chú thêm cho AI, ví dụ: tránh nhắc đối thủ, nhấn mạnh bảo hành */
  notes: z.string().default(''),
});
export type SiteBrief = z.infer<typeof SiteBriefSchema>;

/* ------------------------------------------------------------------ */
/*  Entity SEO                                                          */
/* ------------------------------------------------------------------ */

export const AddressSchema = z.object({
  streetAddress: z.string().default(''),
  addressLocality: z.string().default(''),
  addressRegion: z.string().default(''),
  postalCode: z.string().default(''),
  addressCountry: z.string().default('VN'),
});

export const SameAsSchema = z.object({
  facebook: z.string().default(''),
  youtube: z.string().default(''),
  tiktok: z.string().default(''),
  instagram: z.string().default(''),
  linkedin: z.string().default(''),
  x: z.string().default(''),
  pinterest: z.string().default(''),
  zalo: z.string().default(''),
  googleMaps: z.string().default(''),
  wikipedia: z.string().default(''),
  other: z.array(z.string()).default([]),
});

export const AuthorSchema = z.object({
  name: z.string().default(''),
  jobTitle: z.string().default(''),
  bio: z.string().default(''),
  sameAs: z.array(z.string()).default([]),
});

export const EntitySchema = z.object({
  type: z.enum(['Organization', 'LocalBusiness', 'ProfessionalService', 'Store', 'Restaurant', 'MedicalBusiness', 'HomeAndConstructionBusiness', 'Person']).default('Organization'),
  name: z.string().default(''),
  alternateName: z.array(z.string()).default([]),
  legalName: z.string().default(''),
  description: z.string().default(''),
  foundingDate: z.string().default(''),
  founder: z.string().default(''),
  founderSameAs: z.array(z.string()).default([]),
  taxId: z.string().default(''),
  telephone: z.string().default(''),
  email: z.string().default(''),
  address: AddressSchema.prefault({}),
  geo: z.object({ lat: z.string().default(''), lng: z.string().default('') }).prefault({}),
  openingHours: z.array(z.string()).default([]),
  priceRange: z.string().default(''),
  areaServed: z.array(z.string()).default([]),
  sameAs: SameAsSchema.prefault({}),
  author: AuthorSchema.prefault({}),
  ga4Id: z.string().default(''),
  gtmId: z.string().default(''),
  googleSiteVerification: z.string().default(''),
  bingSiteVerification: z.string().default(''),
  mapEmbedUrl: z.string().default(''),
});
export type EntityData = z.infer<typeof EntitySchema>;

export function defaultEntity(partial: Partial<EntityData> = {}): EntityData {
  return EntitySchema.parse(partial);
}

/* ------------------------------------------------------------------ */
/*  Theme                                                               */
/* ------------------------------------------------------------------ */

export interface ThemeConfig {
  id: string;
  name: string;
  palette: { primary: string; primaryDark: string; accent: string; bg: string; surface: string; text: string; muted: string };
  fonts: { heading: string; body: string; googleFamilies: string[] };
  headerStyle: 'left' | 'center' | 'split';
  heroStyle: 'image-bg' | 'split' | 'minimal';
  cardStyle: 'flat' | 'shadow' | 'outline';
  radius: string;
  sectionOrder: string[];
}

/* ------------------------------------------------------------------ */
/*  Kế hoạch site do AI lập (gen_plan)                                   */
/* ------------------------------------------------------------------ */

export const ServicePlanSchema = z.object({
  name: z.string(),
  slug: z.string().optional(),
  summary: z.string(),
  imageQuery: z.string(),
});

export const PostPlanSchema = z.object({
  title: z.string(),
  slug: z.string().optional(),
  targetKeyword: z.string(),
  angle: z.string(),
  imageQuery: z.string(),
});

export const SitePlanSchema = z.object({
  /** Kiểu viết đã chốt cho site, để bài viết sau này cùng giọng */
  contentStyle: z.enum(['story', 'expert', 'playbook']).optional(),
  tagline: z.string(),
  brandVoice: z.string(),
  audienceInsight: z.string(),
  heroImageQuery: z.string(),
  aboutImageQuery: z.string(),
  services: z.array(ServicePlanSchema).min(1),
  posts: z.array(PostPlanSchema),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })),
  ctaPrimary: z.string(),
  ctaSecondary: z.string(),
  differentiators: z.array(z.string()),
  authorName: z.string(),
  authorTitle: z.string(),
  authorBio: z.string(),
});
export type SitePlan = z.infer<typeof SitePlanSchema>;
export type ServicePlan = z.infer<typeof ServicePlanSchema>;
export type PostPlan = z.infer<typeof PostPlanSchema>;

/* ------------------------------------------------------------------ */
/*  Nội dung từng trang (gen_content)                                    */
/* ------------------------------------------------------------------ */

export const SectionSchema = z.object({
  heading: z.string().default(''),
  /** Markdown đơn giản: đoạn văn, danh sách, in đậm, liên kết. */
  body: z.string().default(''),
  imageQuery: z.string().optional(),
});
export type Section = z.infer<typeof SectionSchema>;

export const PageKindSchema = z.enum(['home', 'about', 'services', 'blog', 'post', 'contact', 'privacy']);
export type PageKind = z.infer<typeof PageKindSchema>;

export const PageContentSchema = z.object({
  kind: PageKindSchema,
  title: z.string(),
  metaDescription: z.string(),
  h1: z.string(),
  intro: z.string().default(''),
  sections: z.array(SectionSchema).default([]),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
  heroImageQuery: z.string().optional(),
  heroImageAlt: z.string().optional(),
  /** "Tóm tắt nhanh" đầu bài blog, 3 đến 5 ý */
  keyTakeaways: z.array(z.string()).optional(),
  /** Dành cho bài blog */
  excerpt: z.string().optional(),
  targetKeyword: z.string().optional(),
  readingMinutes: z.number().optional(),
  publishedAt: z.string().optional(),
  /** Dành cho trang dịch vụ: mỗi dịch vụ một mục */
  services: z
    .array(z.object({ name: z.string(), slug: z.string(), summary: z.string(), body: z.string(), imageQuery: z.string() }))
    .optional(),
});
export type PageContent = z.infer<typeof PageContentSchema>;

/* ------------------------------------------------------------------ */
/*  Cài đặt toàn cục (bảng settings)                                     */
/* ------------------------------------------------------------------ */

export const WafSettingsSchema = z.object({
  /** Rule 1: bot đã xác minh bỏ qua mọi rule, rate limit, WAF managed, Super Bot Fight Mode */
  skipVerifiedBots: z.boolean().default(true),
  /** Rule 2: chặn mọi truy cập ngoài các quốc gia này */
  geoBlockEnabled: z.boolean().default(true),
  allowedCountries: z.array(z.string()).default(['VN']),
  /** Rule 3: chặn URL có "/?" trừ khi query chứa một trong các từ cho phép, cùng các đường dẫn bị chặn */
  blockQueryStrings: z.boolean().default(true),
  allowedQueryTerms: z.array(z.string()).default(['post', 'utm', 'hl=vi-VN', 'ver=', 'customize']),
  blockedPaths: z.array(z.string()).default(['/xmlrpc.php', '/wp-cron.php']),
  rateLimit: z
    .object({
      requestsPerPeriod: z.number().int().min(1).default(100),
      period: z.number().int().default(10),
      mitigationTimeout: z.number().int().default(10),
    })
    .prefault({}),
});
export type WafSettings = z.infer<typeof WafSettingsSchema>;

export const GeneralSettingsSchema = z.object({
  defaultLanguage: z.enum(['vi', 'en']).default('vi'),
  defaultPostsCount: z.number().int().min(0).max(20).default(5),
  defaultContentStyle: z.enum(['auto', 'story', 'expert', 'playbook']).default('auto'),
  defaultTargetCountries: z.array(z.string()).default(['VN']),
  autoSyncEntity: z.boolean().default(true),
  autoSubmitSitemap: z.boolean().default(true),
});
export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;

/* ------------------------------------------------------------------ */
/*  Trạng thái                                                          */
/* ------------------------------------------------------------------ */

export type SiteStatus = 'creating' | 'waiting_ns' | 'building' | 'live' | 'error' | 'paused';
export type StepStatus = 'pending' | 'running' | 'waiting' | 'done' | 'failed' | 'skipped';

export interface HealthReport {
  checkedAt: string;
  ok: boolean;
  dnsProxied: boolean | null;
  httpStatus: number | null;
  httpsOk: boolean;
  responseMs: number | null;
  zoneStatus: string | null;
  sslMode: string | null;
  wafRules: number | null;
  message: string;
}
