import { describe, expect, it } from 'vitest';
import type { AiReview, Article, DupReport } from '../../src/content-tool/core/types.js';
import { applyPatches, findQuote, locateTargets, reviewIssueKey, verifyReviewIssues } from '../../src/content-tool/core/patch.js';

const para = (seed: number) => `Đoạn ${seed} nói về nước lèo trong và ngọt hậu, sợi trụng vừa tới, người bán làm lâu năm nên tay nghề chắc. Tôi để ý phần nền quyết định gần hết mọi thứ ở lần ${seed}.`;
function article(): Article {
  return {
    title: 'Hủ tiếu Nam Vang: chọn quán làm kỹ',
    metaDescription: 'Kinh nghiệm chọn hủ tiếu Nam Vang làm kỹ, dấu hiệu nhận biết, mức giá hợp lý và những sai lầm quen thuộc khi mới thử món này.',
    h1: 'Hủ tiếu Nam Vang nhìn từ góc người đi ăn',
    excerpt: 'Cách nhận biết hủ tiếu Nam Vang làm kỹ.',
    quickSummary: [],
    intro: `Mở bài về hủ tiếu Nam Vang. ${para(1)}`,
    sections: [
      { heading: 'So sánh nhanh', level: 2, body: `${para(2)}\n\n| Quán | Sao |\n| --- | --- |\n| A | 4.5 |` },
      { heading: '1. Quán A: đông khách', level: 2, body: `**Địa chỉ:** 1 Thống Nhất\n\n${para(3)} ${para(4)} ${para(5)}` },
      { heading: '2. Quán B: mở khuya', level: 2, body: `**Địa chỉ:** 2 Thống Nhất\n\n${para(6)}` },
      { heading: 'Cách tôi xếp hạng', level: 2, body: 'Xếp theo sao và số lượt đánh giá. Không thể phủ nhận đây là cách đơn giản.' },
    ],
    faq: [{ question: 'Giá bao nhiêu?', answer: 'Khoảng 40 đến 60 nghìn đồng một tô, tùy quán và phần thêm.' }],
    nextSteps: 'Ghé thử một quán trong tuần này.',
    images: [],
    targetKeyword: 'hủ tiếu Nam Vang',
    secondaryKeywords: [],
    style: 'story',
  };
}
const dupEmpty: DupReport = { ratio: 0, totalWords: 0, matchedWords: 0, longestRun: 0, matches: [], libraryMatches: [], pass: true };

describe('AI duyệt có bằng chứng', () => {
  it('lỗi có trích dẫn không tìm thấy trong bài thì bỏ; trích dẫn đúng thì giữ và sửa vị trí; lỗi "Thiếu" không cần trích', () => {
    const a = article();
    const review: AiReview = {
      pass: false,
      summary: 's',
      issues: [
        { severity: 'major', where: 'sections.9', problem: 'Dữ kiện giá không có trong ghi chú.', fix: 'Bỏ.', quote: 'Khoảng 40 đến 60 nghìn đồng một tô, tùy quán và phần thêm.' },
        { severity: 'major', where: 'sections.1', problem: 'Bịa trải nghiệm.', fix: 'Bỏ.', quote: 'Tôi đã ăn ở đây ba lần và chủ quán kể chuyện đời.' },
        { severity: 'major', where: 'sections', problem: 'Thiếu mục cho quán C trong danh sách.', fix: 'Thêm mục.', quote: '' },
        { severity: 'major', where: 'intro', problem: 'Văn đều đều.', fix: 'Viết lại.', quote: '' },
        { severity: 'minor', where: 'intro', problem: 'Góp ý nhỏ.', fix: 'Tùy.', quote: '' },
      ],
    };
    const { review: v, dropped } = verifyReviewIssues(review, a);
    expect(dropped).toBe(2);
    expect(v.issues.map((i) => i.where)).toEqual(['faq.0', 'sections', 'intro']);
    expect(v.issues[0]!.problem).toContain('giá');
    expect(v.issues[2]!.severity).toBe('minor');
    // Khớp 8 từ đầu khi model cắt bớt đuôi câu
    expect(findQuote(a, 'Khoảng 40 đến 60 nghìn đồng một tô, tùy quán')).toBe('faq.0');
    expect(findQuote(a, 'ngắn')).toBeNull();
    // Khóa ổn định qua các vòng
    expect(reviewIssueKey(review.issues[0]!)).toBe(reviewIssueKey({ ...review.issues[0]!, where: 'faq.0', problem: 'khác' }));
    expect(reviewIssueKey(review.issues[2]!)).toContain('w:sections|');
  });
});

describe('khoanh vùng lỗi để sửa đúng chỗ', () => {
  it('lỗi toàn bài quy về phần cụ thể: quá dài → mục dài nhất, cụm cấm → phần chứa cụm, thiếu từ khóa → mở bài', () => {
    const a = article();
    const { targets, unlocated } = locateTargets(a, {
      quality: [
        { code: 'too_long', severity: 'major', where: 'article', message: 'Bài 400 từ, vượt xa mức 300' },
        { code: 'banned_phrase', severity: 'minor', where: 'article', message: 'Cụm sáo rỗng cần bỏ: "không thể phủ nhận"' },
        { code: 'keyword_missing', severity: 'major', where: 'article', message: 'Từ khóa không xuất hiện' },
        { code: 'heading_dup', severity: 'major', where: 'sections.2', message: 'Heading bị lặp' },
      ],
      dup: { ...dupEmpty, matches: [{ text: 'nước lèo trong và ngọt hậu', words: 6, sourceIndex: 2, sourceUrl: 'https://x', where: 'sections.1' }] },
      review: { pass: false, summary: '', issues: [{ severity: 'major', where: 'faq.0', problem: 'Giá ngoài ghi chú', fix: 'Bỏ', quote: 'Khoảng 40 đến 60 nghìn đồng', confirmed: true }, { severity: 'major', where: 'sections.0', problem: 'Mới, chưa xác nhận', fix: 'x', quote: '', confirmed: false }] },
      blocks: [{ text: 'Đoạn 6 nói về nước lèo trong và ngọt hậu', aiScore: 0.9, where: 'lạ' }],
      minWords: 200,
      maxWords: 300,
      shingleSize: 5,
    });
    expect(unlocated).toEqual([]);
    const by = Object.fromEntries(targets.map((t) => [t.where, t]));
    expect(by['sections.1']).toBeDefined(); // dài nhất, và có chuỗi trùng
    expect(by['sections.1']!.feedback.some((f) => /Rút mục này/.test(f))).toBe(true);
    expect(by['sections.1']!.feedback.some((f) => /trùng với nguồn 2/.test(f))).toBe(true);
    expect(by['sections.3']!.feedback.some((f) => /không thể phủ nhận/.test(f))).toBe(true);
    expect(by['intro']!.feedback.some((f) => /Từ khóa/.test(f))).toBe(true);
    expect(by['sections.2']!.allowHeading).toBe(true);
    expect(by['sections.1']!.allowHeading).toBe(false);
    expect(by['faq.0']!.feedback[0]).toMatch(/^\[BẮT BUỘC\] Giá ngoài ghi chú/);
    expect(by['sections.0']!.feedback.some((f) => f.startsWith('[nên] Mới'))).toBe(true);
    // Câu bị chấm AI có where lạ vẫn tìm được mục chứa câu
    expect(by['sections.2']!.feedback.some((f) => /giống văn máy/.test(f))).toBe(true);
  });

  it('lỗi không quy được vị trí (thiếu mục) trả về unlocated để lùi về sửa cả bài', () => {
    const a = article();
    const { targets, unlocated } = locateTargets(a, { quality: [{ code: 'few_sections', severity: 'major', where: 'sections', message: 'Chỉ có 2 mục H2' }], dup: dupEmpty, review: { pass: false, summary: '', issues: [{ severity: 'major', where: 'sections', problem: 'Thiếu mục quán C', fix: 'Thêm', quote: '', confirmed: true }] }, blocks: [], minWords: 200, maxWords: 3000, shingleSize: 5 });
    expect(targets).toEqual([]);
    expect(unlocated).toHaveLength(2);
  });

  it('áp bản sửa: chỉ phần được yêu cầu đổi, heading chỉ đổi khi được phép, phần khác giữ nguyên từng chữ', () => {
    const a = article();
    const targets = [
      { where: 'sections.1', heading: a.sections[1]!.heading, current: a.sections[1]!.body, feedback: ['x'], allowHeading: false },
      { where: 'sections.2', heading: a.sections[2]!.heading, current: a.sections[2]!.body, feedback: ['x'], allowHeading: true },
      { where: 'faq.0', heading: 'Giá bao nhiêu?', current: a.faq[0]!.answer, feedback: ['x'], allowHeading: false },
      { where: 'title', current: a.title, feedback: ['x'], allowHeading: false },
    ];
    const out = applyPatches(
      a,
      [
        { where: 'sections.1', heading: 'Heading lạ', text: 'Thân mới 1.' },
        { where: 'sections.2', heading: '2. Quán B: mở tới 3 giờ sáng', text: 'Thân mới 2.' },
        { where: 'faq.0', heading: '', text: 'Trả lời mới.' },
        { where: 'title', heading: '', text: 'Title  mới\ncó xuống dòng' },
        { where: 'intro', heading: '', text: 'KHÔNG ĐƯỢC ĐỔI' },
        { where: 'sections.0', heading: '', text: '' },
      ],
      targets,
    );
    expect(out.sections[1]!.body).toBe('Thân mới 1.');
    expect(out.sections[1]!.heading).toBe(a.sections[1]!.heading);
    expect(out.sections[2]!.heading).toBe('2. Quán B: mở tới 3 giờ sáng');
    expect(out.sections[2]!.body).toBe('Thân mới 2.');
    expect(out.faq[0]!.answer).toBe('Trả lời mới.');
    expect(out.faq[0]!.question).toBe('Giá bao nhiêu?');
    expect(out.title).toBe('Title mới có xuống dòng');
    expect(out.intro).toBe(a.intro);
    expect(out.sections[0]!.body).toBe(a.sections[0]!.body);
    expect(out.sections[3]).toEqual(a.sections[3]);
  });
});
