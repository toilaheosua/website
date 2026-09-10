import { describe, expect, it } from 'vitest';
import { resolveContentStyle, CONTENT_STYLES, ENGAGEMENT_RULES } from '../src/generator/content-styles.js';
import { sanitizeInternalLinks } from '../src/generator/markdown.js';

const base = { description: '', siteType: 'business' as const, services: [] as string[] };

describe('chọn kiểu viết', () => {
  it('auto: ẩm thực → kể chuyện, thi công → thực chiến, còn lại → chuyên gia', () => {
    expect(resolveContentStyle({ ...base, contentStyle: 'auto', industry: 'Quán hủ tiếu gia truyền' })).toBe('story');
    expect(resolveContentStyle({ ...base, contentStyle: 'auto', industry: 'Spa và làm đẹp' })).toBe('story');
    expect(resolveContentStyle({ ...base, contentStyle: 'auto', industry: 'Sửa chữa điện lạnh' })).toBe('playbook');
    expect(resolveContentStyle({ ...base, contentStyle: 'auto', industry: 'Thi công nội thất' })).toBe('playbook');
    expect(resolveContentStyle({ ...base, contentStyle: 'auto', industry: 'Luật sư tư vấn doanh nghiệp' })).toBe('expert');
  });

  it('lựa chọn rõ ràng trong brief hoặc mặc định hệ thống được ưu tiên', () => {
    expect(resolveContentStyle({ ...base, contentStyle: 'expert', industry: 'Quán phở' })).toBe('expert');
    expect(resolveContentStyle({ ...base, contentStyle: 'auto', industry: 'Quán phở' }, 'playbook')).toBe('playbook');
    expect(resolveContentStyle({ ...base, contentStyle: 'story', industry: 'Kế toán' }, 'expert')).toBe('story');
  });

  it('mỗi kiểu viết có persona, cấu trúc và điều cấm; quy tắc giữ chân đủ 3 mục', () => {
    for (const s of Object.values(CONTENT_STYLES)) {
      expect(s.guide).toContain('Persona');
      expect(s.guide).toContain('Cấu trúc');
      expect(s.guide).toContain('Cấm');
    }
    expect(ENGAGEMENT_RULES).toMatch(/1\. Móc câu/);
    expect(ENGAGEMENT_RULES).toMatch(/2\. Nội dung có thịt/);
    expect(ENGAGEMENT_RULES).toMatch(/3\. Nhịp đọc/);
  });
});

describe('liên kết nội bộ', () => {
  const valid = ['/', '/dich-vu/', '/blog/bai-1/'];
  it('giữ liên kết hợp lệ kể cả có anchor, bỏ liên kết nội bộ sai, giữ liên kết ngoài', () => {
    const md = 'Xem [dịch vụ](/dich-vu/#sua-may-lanh), [bài 1](/blog/bai-1), [trang lạ](/khong-co/), [Google](https://google.com) và [gọi](tel:0909).';
    expect(sanitizeInternalLinks(md, valid)).toBe('Xem [dịch vụ](/dich-vu/#sua-may-lanh), [bài 1](/blog/bai-1/), trang lạ, [Google](https://google.com) và [gọi](tel:0909).');
  });
  it('liên kết tương đối không có dấu / bị bỏ, anchor cùng trang giữ nguyên', () => {
    expect(sanitizeInternalLinks('[a](dich-vu) [b](#faq)', valid)).toBe('a [b](#faq)');
  });
});
