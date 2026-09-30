import { describe, expect, it } from 'vitest';
import { checkDuplication, checkLibraryDuplication, dupToFeedback, tokenize } from '../../src/content-tool/generator/dedup.js';

const source = 'Hủ tiếu Nam Vang là món ăn có nguồn gốc từ Campuchia được người Hoa mang sang Việt Nam và biến tấu theo khẩu vị miền Nam. Nước dùng nấu từ xương ống hầm nhiều giờ cho vị ngọt tự nhiên.';

describe('so trùng lặp shingle', () => {
  it('tokenize bỏ dấu câu và chuẩn hóa chữ thường', () => {
    expect(tokenize('Hủ tiếu, Nam Vang!')).toEqual(['hủ', 'tiếu', 'nam', 'vang']);
  });

  it('phát hiện chuỗi sao chép nguyên văn', () => {
    const parts = [{ where: 'intro', text: `Tôi ăn thử ở ba nơi. ${source} Sau đó tôi về nhà nấu lại.` }];
    const r = checkDuplication(parts, [{ index: 1, url: 'https://a.vn/x', text: source }], { shingleSize: 8, ratioMax: 0.1 });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.longestRun).toBeGreaterThanOrEqual(20);
    expect(r.matches[0]!.sourceIndex).toBe(1);
    expect(r.matches[0]!.where).toBe('intro');
    expect(r.pass).toBe(false);
    expect(dupToFeedback(r, 8)[0]).toMatch(/BẮT BUỘC/);
  });

  it('bài diễn đạt lại thì đạt', () => {
    const parts = [{ where: 'intro', text: 'Món này người Hoa đem từ Campuchia về miền Nam rồi đổi cho hợp khẩu vị. Nước lèo ngọt vì xương ống hầm lâu, không phải vì bột nêm.' }];
    const r = checkDuplication(parts, [{ index: 1, url: 'https://a.vn/x', text: source }], { shingleSize: 8, ratioMax: 0.1 });
    expect(r.matches).toEqual([]);
    expect(r.ratio).toBe(0);
    expect(r.pass).toBe(true);
  });

  it('so với bài đã viết trong thư viện', () => {
    const parts = [{ where: 'sections.0', text: `Đoạn mở đầu riêng. ${source}` }];
    const lib = checkLibraryDuplication(parts, [{ runId: 7, keyword: 'hủ tiếu', text: source }, { runId: 8, keyword: 'phở', text: 'Phở bò Nam Định nấu bằng nước mắm cốt và gừng nướng.' }], 8);
    expect(lib.length).toBe(1);
    expect(lib[0]!.runId).toBe(7);
  });
});
