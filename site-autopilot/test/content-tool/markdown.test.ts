import { describe, expect, it } from 'vitest';
import type { Article } from '../../src/content-tool/core/types.js';
import { articlePlainParts, articleToDocx, articleToHtml, articleToMarkdown, articleToPlainText, articleToSiteAutopilotJson, stripMarkdown } from '../../src/content-tool/generator/markdown.js';

const a: Article = {
  title: 'Title SEO',
  metaDescription: 'Meta mô tả',
  h1: 'Tiêu đề chính',
  excerpt: 'Trích',
  quickSummary: ['Ý một', 'Ý hai'],
  intro: 'Mở bài có **đậm**.',
  sections: [
    { heading: 'Mục A', level: 2, body: 'Nội dung A.\n\n| Cột 1 | Cột 2 |\n|---|---|\n| a | b |' },
    { heading: 'Mục A.1', level: 3, body: '- điểm 1\n- điểm 2' },
    { heading: 'Mục B', level: 2, body: '> **Mẹo:** nhớ nếm trước.' },
  ],
  faq: [{ question: 'Hỏi?', answer: 'Đáp.' }],
  nextSteps: 'Làm ngay.',
  images: [{ position: 'sau mục A', query: 'noodle soup', alt: 'Tô hủ tiếu' }],
  targetKeyword: 'từ khóa',
  secondaryKeywords: ['phụ 1'],
  style: 'playbook',
};

describe('xuất bài', () => {
  it('markdown có đủ heading, tóm tắt, FAQ và kết', () => {
    const md = articleToMarkdown(a, { frontMatter: true });
    expect(md).toContain('---\ntitle: "Title SEO"');
    expect(md).toContain('# Tiêu đề chính');
    expect(md).toContain('## Mục A');
    expect(md).toContain('### Mục A.1');
    expect(md).toContain('> **Tóm tắt nhanh**');
    expect(md).toContain('## Câu hỏi thường gặp');
    expect(md).toContain('## Việc cần làm ngay');
  });

  it('html render heading và bảng', () => {
    const html = articleToHtml(a, { withH1: true });
    expect(html).toContain('<h1>');
    expect(html).toContain('<h2>Mục A</h2>');
    expect(html).toContain('<table>');
  });

  it('văn bản thuần bỏ ký hiệu markdown và bảng', () => {
    const txt = articleToPlainText(a);
    expect(txt).not.toContain('**');
    expect(txt).not.toContain('|');
    expect(txt).toContain('Mở bài có đậm.');
    expect(stripMarkdown('- điểm 1\n> **Mẹo:** x')).toBe('điểm 1\nMẹo: x');
    expect(articlePlainParts(a).map((p) => p.where)).toContain('sections.1');
  });

  it('JSON site-autopilot gộp H3 vào H2 trước và có kind post', () => {
    const j = articleToSiteAutopilotJson(a, { keyword: 'từ khóa', sourceUrls: ['https://a.vn'] }) as { kind: string; sections: { heading: string; body: string }[]; keyTakeaways: string[]; heroImageQuery: string };
    expect(j.kind).toBe('post');
    expect(j.sections.length).toBe(2);
    expect(j.sections[0]!.body).toContain('**Mục A.1**');
    expect(j.keyTakeaways).toEqual(['Ý một', 'Ý hai']);
    expect(j.heroImageQuery).toBe('noodle soup');
  });

  it('docx là file zip hợp lệ', async () => {
    const buf = await articleToDocx(a);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});
