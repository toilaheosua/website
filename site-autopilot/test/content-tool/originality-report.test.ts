import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { fillToAiScore, parseOriginalityDocumentXml, parseOriginalityDocx } from '../../src/content-tool/generator/originality-report.js';

const run = (text: string, fill: string) => `<w:r><w:rPr><w:shd w:fill="${fill}" w:color="auto"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (...runs: string[]) => `<w:p><w:pPr/>${runs.join('')}</w:p>`;
const xml = (body: string) => `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

const red = 'Câu này đọc rất giống văn máy vì nhịp đều và không có người viết trong đó. Câu tiếp theo cũng vậy, cùng độ dài, cùng cấu trúc, cùng kiểu kết luận.';
const green = 'Khoan, chỗ này tôi từng nhầm. Hồi mới nấu tôi luộc gan chung nồi xương, nước đục ngay, mà mãi sau mới biết vì sao.';

describe('đọc file docx xuất từ Originality.ai', () => {
  it('đổi màu nền thành xác suất AI: đỏ cao, vàng lưng chừng, xanh thấp, xám bỏ qua', () => {
    expect(fillToAiScore('f8dbda')!).toBeGreaterThan(0.9);
    expect(fillToAiScore('fff3da')!).toBeGreaterThan(0.55);
    expect(fillToAiScore('fff3da')!).toBeLessThan(0.75);
    expect(fillToAiScore('e2efde')!).toBeLessThan(0.2);
    expect(fillToAiScore('ffffff')).toBeNull();
    expect(fillToAiScore('dde3ff')).toBeNull();
  });

  it('gom câu vùng đỏ và ước tính điểm theo số từ', () => {
    const doc = xml(para(run('# Tiêu đề bài', 'f8dbda')) + para(run(red, 'f8dbda')) + para(run(green, 'e2efde')) + para(run('Đoạn vàng lưng chừng có vài từ thôi.', 'fff3da')));
    const r = parseOriginalityDocumentXml(doc);
    expect(r.runs.filter((x) => x.fill).length).toBe(4);
    expect(r.flagged.length).toBeGreaterThanOrEqual(3);
    expect(r.flagged.some((s) => s.startsWith('Câu này đọc rất giống'))).toBe(true);
    expect(r.flagged.some((s) => s.startsWith('Khoan'))).toBe(false);
    expect(r.estimatedAi).toBeGreaterThan(0.5);
    expect(r.estimatedAi).toBeLessThan(0.95);
    expect(r.text).toContain('Khoan, chỗ này');
    expect(r.flaggedWords).toBeGreaterThan(0);
  });

  it('đọc được file zip .docx thật sự và từ chối file không có màu', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', xml(para(run(red, 'f8dbda')) + para(run(green, 'e2efde'))));
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const r = await parseOriginalityDocx(buf);
    expect(r.totalWords).toBeGreaterThan(30);
    const plain = new JSZip();
    plain.file('word/document.xml', xml(para('<w:r><w:t>không màu</w:t></w:r>')));
    await expect(parseOriginalityDocx(await plain.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(/không có màu/);
  });
});
