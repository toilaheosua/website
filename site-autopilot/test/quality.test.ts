import { describe, expect, it } from 'vitest';
import { PageContentSchema } from '../src/core/types.js';
import { autoFixPage, checkQuality, isPass, issuesToFeedback, wordCount } from '../src/generator/quality.js';
import { PAGE_STRUCTURES } from '../src/generator/content-styles.js';

const para = (n: number) => `Đoạn văn số ${n} nói về cách chọn dịch vụ đúng nhu cầu: hỏi rõ phạm vi công việc, thời gian bàn giao, điều kiện bảo hành và cách xử lý khi phát sinh, rồi so sánh ít nhất hai phương án trước khi quyết định.`;
const body = (seed: number) => [para(seed), para(seed + 100), para(seed + 200), para(seed + 300)].join('\n\n');

function goodPost() {
  return PageContentSchema.parse({
    kind: 'post',
    title: 'Chọn quán hủ tiếu Nam Vang ngon ở Phan Rang: 5 dấu hiệu',
    metaDescription: 'Năm dấu hiệu nhận biết tô hủ tiếu Nam Vang nấu đúng kiểu: nước lèo, sợi, topping, giờ nấu và cách phục vụ. Đọc để chọn đúng quán ngay lần đầu.',
    h1: 'Chọn quán hủ tiếu Nam Vang ở Phan Rang thế nào cho đúng',
    intro: 'Bạn muốn một tô hủ tiếu sáng mà nước lèo trong và ngọt xương thật. Bài này chỉ ra năm dấu hiệu để nhận biết trong 30 giây đầu. Xem thêm [dịch vụ](/dich-vu/).',
    sections: [
      { heading: 'Nước lèo trong hay đục nói lên điều gì', body: body(1) },
      { heading: 'Sợi hủ tiếu dai đúng kiểu Nam Vang', body: body(2) },
      { heading: 'Topping đầy đủ gồm những gì', body: body(3) },
      { heading: 'Bước tiếp theo', body: body(4) },
    ],
    faq: [{ question: 'Hủ tiếu khô hay nước ngon hơn?', answer: 'Tùy khẩu vị: khô đậm vị nước sốt, nước thanh và nóng lâu.' }],
    keyTakeaways: ['Nước lèo trong là dấu hiệu hầm xương đúng', 'Sợi phải dai, không bở'],
    targetKeyword: 'hủ tiếu nam vang phan rang',
  });
}

describe('checkQuality', () => {
  it('bài tốt đạt kiểm duyệt', () => {
    const issues = checkQuality(goodPost());
    expect(issues.filter((i) => i.severity === 'major')).toEqual([]);
    expect(isPass(issues)).toBe(true);
  });

  it('bắt lỗi: quá ngắn, heading lặp, đoạn lặp, câu sáo rỗng, title ngắn', () => {
    const p = goodPost();
    p.title = 'Ngắn';
    p.sections = [
      { heading: 'Tổng quan', body: para(1) + '\n\nTrong thời đại 4.0, không thể phủ nhận rằng chúng tôi tự hào là đơn vị hàng đầu, uy tín và chuyên nghiệp nhất.' },
      { heading: 'Tổng quan', body: para(1) },
    ];
    const issues = checkQuality(p);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('title_short');
    expect(codes).toContain('too_short');
    expect(codes).toContain('few_sections');
    expect(codes).toContain('heading_dup');
    expect(codes).toContain('heading_generic');
    expect(codes).toContain('paragraph_dup');
    expect(codes).toContain('banned_phrase');
    expect(codes).toContain('empty_claim');
    expect(isPass(issues)).toBe(false);
    const fb = issuesToFeedback(issues);
    expect(fb.some((l) => l.startsWith('[BẮT BUỘC]'))).toBe(true);
  });

  it('bắt nhồi từ khóa', () => {
    const p = goodPost();
    p.sections[0]!.body = Array.from({ length: 30 }, () => 'hủ tiếu nam vang phan rang ngon').join('. ') + '\n\n' + body(9);
    expect(checkQuality(p).map((i) => i.code)).toContain('keyword_stuffing');
  });

  it('trang nhẹ có ngưỡng thấp hơn', () => {
    const blog = PageContentSchema.parse({ kind: 'blog', title: 'Blog hủ tiếu Nam Vang: cách nấu, chọn quán | Ông Giáo', metaDescription: 'Bài viết về hủ tiếu Nam Vang: cách nấu, cách chọn quán, mẹo ăn ngon và câu chuyện bếp núc tại Phan Rang, viết bởi người trong nghề.', h1: 'Blog hủ tiếu Nam Vang', intro: 'Kinh nghiệm chọn quán, cách nấu và mẹo ăn ngon, viết cho người mê hủ tiếu ở Phan Rang.', sections: [], faq: [] });
    expect(isPass(checkQuality(blog))).toBe(true);
  });
});

describe('autoFixPage', () => {
  it('bỏ gạch ngang dài, thẻ HTML và heading # trong body', () => {
    const p = goodPost();
    p.h1 = 'Chọn quán — đúng cách';
    p.sections[0]!.body = '# Tiêu đề lạc\n\nĐoạn <b>đậm</b> có dấu — dài.';
    const out = autoFixPage(p);
    expect(out.h1).toBe('Chọn quán, đúng cách');
    expect(out.sections[0]!.body).toBe('**Tiêu đề lạc**\n\nĐoạn đậm có dấu, dài.');
  });
});

describe('cấu trúc theo loại trang', () => {
  it('mỗi loại trang có cấu trúc riêng, trang giới thiệu không bắt checklist', () => {
    expect(Object.keys(PAGE_STRUCTURES).sort()).toEqual(['about', 'blog', 'contact', 'home', 'post', 'privacy', 'services']);
    expect(PAGE_STRUCTURES.about).toMatch(/Không checklist/);
    expect(PAGE_STRUCTURES.post).toMatch(/so sánh/);
    expect(PAGE_STRUCTURES.privacy).toMatch(/không có form/);
  });
  it('wordCount bỏ ký hiệu markdown', () => {
    expect(wordCount('**in đậm** - một | hai')).toBe(4);
  });
});
