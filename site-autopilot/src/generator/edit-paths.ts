import { PageContentSchema, SitePlanSchema, type PageContent, type SitePlan } from '../core/types.js';
import { AppError } from '../core/errors.js';

/**
 * Chỉnh sửa trực quan: mỗi phần tử sửa được trong HTML mang data-edit="<đường dẫn>" (chữ thuần)
 * hoặc data-edit-md="<đường dẫn>" (markdown). Đường dẫn trỏ vào nội dung trang, hoặc "plan." trỏ vào kế hoạch site.
 * Chỉ các đường dẫn khớp danh sách dưới đây mới được ghi, để không ai sửa được trường lạ qua API.
 */
const PAGE_PATHS: RegExp[] = [
  /^title$/,
  /^metaDescription$/,
  /^h1$/,
  /^intro$/,
  /^excerpt$/,
  /^sections\.\d+\.heading$/,
  /^sections\.\d+\.body$/,
  /^faq\.\d+\.question$/,
  /^faq\.\d+\.answer$/,
  /^keyTakeaways\.\d+$/,
  /^services\.\d+\.name$/,
  /^services\.\d+\.summary$/,
  /^services\.\d+\.body$/,
];

const PLAN_PATHS: RegExp[] = [
  /^tagline$/,
  /^ctaPrimary$/,
  /^ctaSecondary$/,
  /^differentiators\.\d+$/,
  /^services\.\d+\.name$/,
  /^services\.\d+\.summary$/,
  /^faq\.\d+\.question$/,
  /^faq\.\d+\.answer$/,
  /^authorName$/,
  /^authorTitle$/,
  /^authorBio$/,
];

/** Các trường không được để trống (tiêu đề, câu hỏi...), tránh lưu thành trang lỗi. */
const REQUIRED = /^(title|metaDescription|h1|sections.d+.heading|faq.d+.question|services.d+.name|tagline|ctaPrimary)$/;

export function isPagePath(p: string): boolean {
  return PAGE_PATHS.some((re) => re.test(p));
}
export function isPlanPath(p: string): boolean {
  return PLAN_PATHS.some((re) => re.test(p));
}

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function setPath(obj: unknown, path: string, value: string): boolean {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i] as string;
    if (cur === null || typeof cur !== 'object') return false;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (cur === null || typeof cur !== 'object') return false;
  const last = parts[parts.length - 1] as string;
  if (Array.isArray(cur) && Number(last) >= cur.length) return false;
  if (!Array.isArray(cur) && !(last in (cur as Record<string, unknown>)) && !['excerpt', 'keyTakeaways'].includes(last)) return false;
  (cur as Record<string, unknown>)[last] = value;
  return true;
}

/** Toàn bộ giá trị gốc của các trường sửa được, để script trong trang biết markdown gốc. */
export function collectEditableFields(content: PageContent, plan: SitePlan | null): { page: Record<string, string>; plan: Record<string, string> } {
  const page: Record<string, string> = { title: content.title, metaDescription: content.metaDescription, h1: content.h1, intro: content.intro, excerpt: content.excerpt ?? '' };
  content.sections.forEach((s, i) => {
    page[`sections.${i}.heading`] = s.heading;
    page[`sections.${i}.body`] = s.body;
  });
  content.faq.forEach((f, i) => {
    page[`faq.${i}.question`] = f.question;
    page[`faq.${i}.answer`] = f.answer;
  });
  (content.keyTakeaways ?? []).forEach((k, i) => (page[`keyTakeaways.${i}`] = k));
  (content.services ?? []).forEach((s, i) => {
    page[`services.${i}.name`] = s.name;
    page[`services.${i}.summary`] = s.summary;
    page[`services.${i}.body`] = s.body;
  });
  const planFields: Record<string, string> = {};
  if (plan) {
    planFields.tagline = plan.tagline;
    planFields.ctaPrimary = plan.ctaPrimary;
    planFields.ctaSecondary = plan.ctaSecondary;
    planFields.authorName = plan.authorName;
    planFields.authorTitle = plan.authorTitle;
    planFields.authorBio = plan.authorBio;
    plan.differentiators.forEach((d, i) => (planFields[`differentiators.${i}`] = d));
    plan.services.forEach((s, i) => {
      planFields[`services.${i}.name`] = s.name;
      planFields[`services.${i}.summary`] = s.summary;
    });
    plan.faq.forEach((f, i) => {
      planFields[`faq.${i}.question`] = f.question;
      planFields[`faq.${i}.answer`] = f.answer;
    });
  }
  return { page, plan: planFields };
}

export interface EditResult {
  content: PageContent;
  plan: SitePlan | null;
  applied: number;
  rejected: string[];
}

/** Áp dụng các thay đổi {đường dẫn: giá trị} vào nội dung trang và kế hoạch, kiểm tra lại bằng schema. */
export function applyEdits(content: PageContent, plan: SitePlan | null, pageFields: Record<string, string>, planFields: Record<string, string>): EditResult {
  const nextContent = structuredClone(content);
  const nextPlan = plan ? structuredClone(plan) : null;
  let applied = 0;
  const rejected: string[] = [];
  for (const [path, value] of Object.entries(pageFields)) {
    if (typeof value !== 'string' || !isPagePath(path)) {
      rejected.push(path);
      continue;
    }
    if (REQUIRED.test(path) && !value.trim()) throw new AppError(`Trường "${path}" không được để trống`);
    if (getPath(nextContent, path) === value) continue;
    if (setPath(nextContent, path, value)) applied++;
    else rejected.push(path);
  }
  for (const [path, value] of Object.entries(planFields)) {
    if (!nextPlan || typeof value !== 'string' || !isPlanPath(path)) {
      rejected.push(`plan.${path}`);
      continue;
    }
    if (REQUIRED.test(path) && !value.trim()) throw new AppError(`Trường "${path}" không được để trống`);
    if (getPath(nextPlan, path) === value) continue;
    if (setPath(nextPlan, path, value)) applied++;
    else rejected.push(`plan.${path}`);
  }
  const parsedContent = PageContentSchema.safeParse(nextContent);
  if (!parsedContent.success) throw new AppError(`Nội dung sau khi sửa không hợp lệ: ${parsedContent.error.issues[0]?.message ?? ''}`);
  const parsedPlan = nextPlan ? SitePlanSchema.safeParse(nextPlan) : null;
  if (parsedPlan && !parsedPlan.success) throw new AppError(`Kế hoạch sau khi sửa không hợp lệ: ${parsedPlan.error.issues[0]?.message ?? ''}`);
  return { content: parsedContent.data, plan: parsedPlan ? parsedPlan.data : null, applied, rejected };
}
