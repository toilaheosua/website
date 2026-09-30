import { describe, expect, it } from 'vitest';
import type { Article } from '../../src/content-tool/core/types.js';
import { articleWordCount, autoFixArticle, capFirst, checkQuality, isPass, sentencesOf } from '../../src/content-tool/generator/quality.js';
import { ROUNDUP_BANNED } from '../../src/content-tool/core/pipeline.js';
import { wordCount } from '../../src/content-tool/core/util.js';

/** Hai đoạn khoảng 75 từ, mỗi seed cho văn bản khác nhau, nhịp câu lệch (3 từ xen 30 từ). */
function longBody(seed: number): string {
  const a = `Khoan, chỗ này dễ nhầm ở lần ${seed}.`;
  const b = `Tôi để ý cách người ta xử lý phần nền quyết định gần hết mọi thứ phía sau, và điều đó lộ ra ngay ở lần nếm thứ ${seed} tại một quán nhỏ trong hẻm.`;
  const c = 'Tùy nơi thôi, nhưng với hủ tiếu Nam Vang thì phần nước phải trong và ngọt hậu, còn sợi trụng vừa tới.';
  const d = `Nói thật là tôi không khuyên cách làm vội số ${seed}, bởi phần nước chưa kịp ngấm thì mọi thứ phía sau đều nhạt và người ăn nhận ra ngay.`;
  const e = 'Màu phải trong.';
  const f = `Người làm lâu năm hay bảo ngon hay không nằm ở kiên nhẫn, chứ không ở bí quyết nào cả, và sau ${seed + 3} lần thử tôi tin điều đó.`;
  return `${a} ${b} ${c}\n\n${d} ${e} ${f} Cái này còn tranh cãi.`;
}

function sample(overrides: Partial<Article> = {}): Article {
  return {
    title: 'Hủ tiếu Nam Vang: cách nhận biết chỗ làm kỹ và giá hợp lý',
    metaDescription: 'Kinh nghiệm chọn hủ tiếu Nam Vang làm kỹ, dấu hiệu nhận biết, mức giá hợp lý và những sai lầm quen thuộc khi mới thử món này ở Sài Gòn.',
    h1: 'Hủ tiếu Nam Vang nhìn từ góc người đi ăn nhiều năm',
    excerpt: 'Cách nhận biết hủ tiếu Nam Vang làm kỹ.',
    quickSummary: ['Phần nước quyết định.', 'Nơi làm kỹ ít trang trí.', 'Giá tùy khu.'],
    intro: `Sáu giờ sáng, góc chợ còn ướt, mùi hành phi đã bay ra tới đầu hẻm. Tôi đứng chờ hủ tiếu Nam Vang và nghĩ về việc vì sao có nơi người ta xếp hàng. ${longBody(1)}`,
    sections: Array.from({ length: 6 }, (_, i) => ({ heading: `Mục số ${i + 1} về cách chọn`, level: (i === 2 ? 3 : 2) as 2 | 3, body: longBody(i + 2) })),
    faq: [
      { question: 'Hủ tiếu Nam Vang có nguồn gốc từ đâu?', answer: longBody(20) },
      { question: 'Giá khoảng bao nhiêu?', answer: longBody(21) },
      { question: 'Khác hủ tiếu Mỹ Tho thế nào?', answer: longBody(22) },
    ],
    nextSteps: 'Tuần này thử một chỗ bạn chưa từng ghé, gọi bản cơ bản nhất và để ý phần nước trước khi nhìn phần trang trí, rồi tự quyết định.',
    images: [],
    targetKeyword: 'hủ tiếu Nam Vang',
    secondaryKeywords: [],
    style: 'story',
    ...overrides,
  };
}

describe('cổng chất lượng', () => {
  it('bài mẫu đủ dài và tự nhiên thì đạt', () => {
    const a = sample();
    const issues = checkQuality(a, { minWords: 600, maxWords: 1500 });
    expect(articleWordCount(a)).toBeGreaterThan(600);
    expect(issues.filter((i) => i.severity === 'major')).toEqual([]);
    expect(isPass(issues)).toBe(true);
  });

  it('phát hiện cụm sáo rỗng, heading chung chung và bài quá ngắn', () => {
    const a = sample({ sections: [{ heading: 'Tổng quan', level: 2, body: 'Trong bài viết này hãy cùng tìm hiểu. Tóm lại, không thể phủ nhận rằng đây là một trong những món ngon.' }], faq: [] });
    const issues = checkQuality(a, { minWords: 1000, maxWords: 1500 });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('banned_phrase');
    expect(codes).toContain('heading_generic');
    expect(codes).toContain('too_short');
    expect(codes).toContain('few_sections');
    expect(isPass(issues)).toBe(false);
  });

  it('báo thiếu từ khóa và nhồi từ khóa', () => {
    const missing = checkQuality(sample({ targetKeyword: 'bánh canh ghẹ' }), { minWords: 600, maxWords: 1500 });
    expect(missing.map((i) => i.code)).toContain('keyword_missing');
    const stuffed = sample();
    stuffed.sections[0]!.body += ' ' + Array.from({ length: 20 }, () => 'hủ tiếu Nam Vang').join(', ') + '.';
    expect(checkQuality(stuffed, { minWords: 600, maxWords: 1500 }).map((i) => i.code)).toContain('keyword_stuffing');
  });

  it('autoFix bỏ gạch ngang dài, thẻ HTML và heading # trong body', () => {
    const fixed = autoFixArticle(sample({ intro: 'Mở bài — có gạch dài <b>và thẻ</b>.\n\n## Heading lạc', title: 'Title – ngắn' }));
    expect(fixed.intro).not.toMatch(/[—–]/);
    expect(fixed.intro).not.toMatch(/<b>/);
    expect(fixed.intro).toContain('**Heading lạc**');
    expect(fixed.title).toBe('Title, ngắn');
  });

  it('đếm từ và tách câu tiếng Việt', () => {
    expect(wordCount('Hủ tiếu Nam Vang **ngon** lắm.')).toBe(6);
    expect(sentencesOf('Câu một dài hơn. Câu hai! Câu ba?').length).toBe(3);
  });
});

describe('viết hoa chữ đầu và câu than thiếu tư liệu', () => {
  it('title, H1, heading, FAQ được viết hoa chữ cái đầu', () => {
    expect(capFirst('hủ tiếu Phan Rang: 6 quán')).toBe('Hủ tiếu Phan Rang: 6 quán');
    expect(capFirst('  đã viết hoa')).toBe('Đã viết hoa');
    expect(capFirst('6 quán ngon')).toBe('6 quán ngon');
    const a = autoFixArticle(sample({ title: 'hủ tiếu phan rang ngon', h1: 'ông giáo mở sớm', faq: [{ question: 'giá bao nhiêu?', answer: longBody(30) }] }));
    expect(a.title).toBe('Hủ tiếu phan rang ngon');
    expect(a.h1).toBe('Ông giáo mở sớm');
    expect(a.faq[0]!.question).toBe('Giá bao nhiêu?');
  });
  it('bài tổng hợp quán: câu than thiếu tư liệu là lỗi bắt buộc, bài thường thì không', () => {
    const body = `${longBody(40)}\n\nTư liệu chưa có mô tả cụ thể về món, giá hay nhận xét lặp lại. Giá của cả sáu địa điểm chưa xuất hiện trong tư liệu, nên chưa thể so theo ngân sách.`;
    const a = sample({ sections: Array.from({ length: 5 }, (_, i) => ({ heading: `Quán số ${i + 1}`, level: 2 as const, body: i === 1 ? body : longBody(i + 50) })) });
    const strict = checkQuality(a, { minWords: 500, maxWords: 3000, bannedPatterns: ROUNDUP_BANNED });
    const hit = strict.find((i) => i.code === 'banned_pattern');
    expect(hit?.severity).toBe('major');
    expect(hit?.message).toContain('Tư liệu chưa có mô tả');
    expect(checkQuality(a, { minWords: 500, maxWords: 3000 }).some((i) => i.code === 'banned_pattern')).toBe(false);
  });
});
