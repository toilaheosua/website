import { describe, expect, it } from 'vitest';
import { outlineSectionsToText, parseAiScoreInput, parseOutlineSections, parseRunOptions } from '../../src/content-tool/web/forms.js';
import { GeneralSettingsSchema, type OutlineSection } from '../../src/content-tool/core/types.js';

describe('form bố cục', () => {
  const sections: OutlineSection[] = [
    { heading: 'Vì sao khác nhau', level: 2, goal: 'Giải thích', points: ['Điểm 1', 'Điểm 2'], sourceRefs: [1, 2], format: 'table', tag: 'cách chế biến', comparisonItems: ['bản khô', 'bản nước'], comparisonCriteria: ['nước lèo', 'sợi'] },
    { heading: 'Ba chi tiết nhỏ', level: 3, goal: 'Đi sâu', points: ['Chi tiết'], sourceRefs: [3], format: 'checklist', tag: '', comparisonItems: [], comparisonCriteria: [] },
  ];

  it('giữ nhãn và đối tượng so sánh khi chuyển qua văn bản rồi đọc lại', () => {
    const text = outlineSectionsToText(sections);
    expect(text).toContain('Nhãn: cách chế biến');
    expect(text).toContain('So sánh: bản khô | bản nước');
    expect(text).toContain('Tiêu chí: nước lèo | sợi');
    const back = parseOutlineSections(text, sections);
    expect(back[0]).toMatchObject({ tag: 'cách chế biến', comparisonItems: ['bản khô', 'bản nước'], comparisonCriteria: ['nước lèo', 'sợi'], format: 'table' });
    expect(back[1]).toMatchObject({ tag: '', comparisonItems: [], comparisonCriteria: [] });
    // Người dùng gõ "vs" thay vì "|" vẫn hiểu; bỏ dòng Nhãn thì giữ nhãn cũ
    const edited = parseOutlineSections('## Vì sao khác nhau\nMục tiêu: x\nSo sánh: quán A vs quán B vs quán C\n- a', sections);
    expect(edited[0]!.comparisonItems).toEqual(['quán A', 'quán B', 'quán C']);
    expect(edited[0]!.tag).toBe('cách chế biến');
  });

  it('chuyển sang văn bản và đọc lại giữ nguyên nội dung và sourceRefs', () => {
    const text = outlineSectionsToText(sections);
    expect(text).toContain('## Vì sao khác nhau');
    expect(text).toContain('### Ba chi tiết nhỏ');
    const back = parseOutlineSections(text, sections);
    expect(back.length).toBe(2);
    expect(back[0]).toMatchObject({ heading: 'Vì sao khác nhau', level: 2, goal: 'Giải thích', points: ['Điểm 1', 'Điểm 2'], sourceRefs: [1, 2], format: 'table' });
    expect(back[1]).toMatchObject({ level: 3, format: 'checklist', sourceRefs: [3] });
  });

  it('người dùng thêm mục mới thì sourceRefs rỗng', () => {
    const back = parseOutlineSections('## Mục mới hoàn toàn\nMục tiêu: thử\n- a', sections);
    expect(back[0]!.sourceRefs).toEqual([1, 2]); // cùng vị trí 0 nên thừa kế
    const back2 = parseOutlineSections('## A\n## B\n## C mới', sections);
    expect(back2[2]!.sourceRefs).toEqual([]);
  });
});

describe('đọc điểm Originality.ai nhập tay', () => {
  it('hiểu số, phần trăm, dấu phẩy và đoạn kết quả dán vào', () => {
    expect(parseAiScoreInput('12')).toBeCloseTo(0.12);
    expect(parseAiScoreInput('12%')).toBeCloseTo(0.12);
    expect(parseAiScoreInput('12,5 %')).toBeCloseTo(0.125);
    expect(parseAiScoreInput('AI 23% Original 77%')).toBeCloseTo(0.23);
    expect(parseAiScoreInput('Original 91% AI 9%')).toBeCloseTo(0.09);
    expect(parseAiScoreInput('100% Original')).toBeCloseTo(0);
    expect(parseAiScoreInput('Original: 100%')).toBeCloseTo(0);
    expect(parseAiScoreInput('không có số')).toBeNull();
    expect(parseAiScoreInput('250')).toBeNull();
  });
});

describe('form tạo bài', () => {
  it('lấy mặc định từ cài đặt và ép biên độ dài', () => {
    const s = GeneralSettingsSchema.parse({ articleMinWords: 1000, articleMaxWords: 1500 });
    const o = parseRunOptions({ keyword: 'x', reviewOutline: 'on', secondaryKeywords: 'a, b', minWords: '100', maxWords: '50' }, s);
    expect(o.reviewOutline).toBe(true);
    expect(o.comparison).toBe(false);
    expect(parseRunOptions({ keyword: 'x', comparison: 'on' }, s).comparison).toBe(true);
    expect(o.secondaryKeywords).toEqual(['a', 'b']);
    expect(o.minWords).toBe(300);
    expect(o.maxWords).toBeGreaterThan(o.minWords);
    expect(o.style).toBe('auto');
  });
});
