import { describe, expect, it } from 'vitest';
import { autoFixPage } from '../src/generator/quality.js';
import { mdToHtml } from '../src/generator/markdown.js';
import { PageContentSchema } from '../src/core/types.js';

describe('bài nhập vào site: bảng markdown được dọn như trong tool', () => {
  it('hàng cách dòng trống, gạch ngang trong ô, bảng một dòng đều dựng ra <table>', () => {
    const body = ['Xem bảng.', '', '| Quán | Giá |', '', '|---|---|', '', '| Ốc Cô Ba | 100–300 đ |', '', '| Ốc Thảo | – |', '', 'Sau bảng – ghi chú.'].join('\n');
    const page = autoFixPage(PageContentSchema.parse({ kind: 'post', title: 'T', metaDescription: 'M', h1: 'H', intro: 'i', sections: [{ heading: 'So sánh', body }], faq: [] }));
    const md = page.sections[0]!.body;
    expect(md).toBe(['Xem bảng.', '', '| Quán | Giá |', '|---|---|', '| Ốc Cô Ba | 100-300 đ |', '| Ốc Thảo | |', '', 'Sau bảng, ghi chú.'].join('\n'));
    const html = mdToHtml(md);
    expect(html).toContain('<table>');
    expect(html).toContain('<td>100-300 đ</td>');
    const inline = autoFixPage(PageContentSchema.parse({ kind: 'post', title: 'T', metaDescription: 'M', h1: 'H', intro: 'i', sections: [{ heading: 'S', body: 'Câu dẫn. | Quán | Sao | | A | 4.7 | | B | 4.5 |' }], faq: [] }));
    expect(mdToHtml(inline.sections[0]!.body)).toContain('<th>Quán</th>');
  });
});
