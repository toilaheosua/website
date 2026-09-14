import { PageContentSchema, type PageContent } from './types.js';
import { slugify } from './util.js';

/**
 * Soạn bài viết thủ công: người dùng viết markdown trong một ô, hệ thống tách thành intro + sections
 * (mỗi "## Tiêu đề" là một mục), FAQ theo khối "câu hỏi / trả lời", Tóm tắt nhanh mỗi dòng một ý.
 */

export interface ManualPostInput {
  title: string;
  slug: string;
  h1: string;
  metaDescription: string;
  targetKeyword: string;
  excerpt: string;
  keyTakeaways: string;
  body: string;
  faq: string;
  heroImageAlt: string;
}

/** Tách markdown thành intro và các mục theo heading "## ". */
export function markdownToSections(md: string): { intro: string; sections: { heading: string; body: string }[] } {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let intro: string[] = [];
  const sections: { heading: string; body: string[] }[] = [];
  let current: { heading: string; body: string[] } | null = null;
  for (const line of lines) {
    const m = line.match(/^#{1,3}\s+(.+?)\s*#*\s*$/);
    if (m) {
      current = { heading: (m[1] as string).trim(), body: [] };
      sections.push(current);
      continue;
    }
    if (current) current.body.push(line);
    else intro.push(line);
  }
  return { intro: intro.join('\n').trim(), sections: sections.map((s) => ({ heading: s.heading, body: s.body.join('\n').trim() })).filter((s) => s.heading) };
}

export function sectionsToMarkdown(content: Pick<PageContent, 'intro' | 'sections'>): string {
  const parts = [content.intro.trim()];
  for (const s of content.sections) parts.push(`## ${s.heading}\n\n${s.body.trim()}`);
  return parts.filter(Boolean).join('\n\n');
}

/** FAQ: mỗi khối cách nhau một dòng trống; dòng đầu là câu hỏi, các dòng sau là trả lời. */
export function parseFaq(text: string): { question: string; answer: string }[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [q, ...rest] = block.split('\n');
      return { question: (q ?? '').replace(/^(Q|Hỏi|Câu hỏi)\s*[:.]\s*/i, '').trim(), answer: rest.join('\n').replace(/^(A|Đáp|Trả lời)\s*[:.]\s*/i, '').trim() };
    })
    .filter((f) => f.question && f.answer);
}

export function faqToText(faq: { question: string; answer: string }[]): string {
  return faq.map((f) => `${f.question}\n${f.answer}`).join('\n\n');
}

export function parseLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
}

/** Đường dẫn bài viết: blog/<slug>, tự sinh từ tiêu đề nếu để trống. */
export function postSlug(blogPrefix: string, slugInput: string, title: string): string {
  const raw = slugInput.trim().replace(/^\/+|\/+$/g, '').replace(new RegExp(`^${blogPrefix}/`), '');
  const s = slugify(raw || title);
  return `${blogPrefix}/${s}`;
}

/** Dựng PageContent bài viết từ form; giữ lại các trường không có trên form từ bản cũ. */
export function buildManualPost(input: ManualPostInput, existing?: PageContent): PageContent {
  const { intro, sections } = markdownToSections(input.body);
  const takeaways = parseLines(input.keyTakeaways);
  return PageContentSchema.parse({
    ...(existing ?? {}),
    kind: 'post',
    title: input.title.trim(),
    metaDescription: input.metaDescription.trim(),
    h1: input.h1.trim() || input.title.trim(),
    intro,
    sections,
    faq: parseFaq(input.faq),
    keyTakeaways: takeaways.length ? takeaways : undefined,
    excerpt: input.excerpt.trim() || undefined,
    targetKeyword: input.targetKeyword.trim() || undefined,
    heroImageAlt: input.heroImageAlt.trim() || existing?.heroImageAlt,
    heroImageQuery: existing?.heroImageQuery,
    publishedAt: existing?.publishedAt ?? new Date().toISOString().slice(0, 10),
    services: undefined,
  });
}

export function postToForm(content: PageContent, slug: string): ManualPostInput {
  return {
    title: content.title,
    slug: slug.replace(/^[^/]+\//, ''),
    h1: content.h1,
    metaDescription: content.metaDescription,
    targetKeyword: content.targetKeyword ?? '',
    excerpt: content.excerpt ?? '',
    keyTakeaways: (content.keyTakeaways ?? []).join('\n'),
    body: sectionsToMarkdown(content),
    faq: faqToText(content.faq),
    heroImageAlt: content.heroImageAlt ?? '',
  };
}

/** Các đường dẫn ảnh trong markdown: ![alt](đường dẫn). */
export function findImageRefs(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.push(m[1] as string);
  return [...new Set(out)];
}

/**
 * Ảnh hợp lệ: URL http(s), hoặc /assets/img/<tệp> có trong kho ảnh của site.
 * Trả về danh sách đường dẫn không dùng được để báo cho người dùng trước khi đăng.
 */
export function invalidImageRefs(md: string, availableFiles: Iterable<string>): string[] {
  const files = new Set([...availableFiles].map((f) => f.split('/').pop() ?? f));
  return findImageRefs(md).filter((p) => {
    if (/^https?:\/\//i.test(p)) return false;
    const m = p.match(/^\/assets\/img\/([^/?#]+)$/);
    return !(m && files.has(m[1] as string));
  });
}
