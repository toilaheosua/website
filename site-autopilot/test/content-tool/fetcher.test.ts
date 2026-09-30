import { describe, expect, it } from 'vitest';
import { embeddedHtmlToText, extractEmbeddedContent, guessLanguage } from '../../src/content-tool/services/fetcher.js';
import { wordCount } from '../../src/content-tool/core/util.js';

const paragraphs = Array.from({ length: 8 }, (_, i) => `<p>Đoạn ${i + 1}: nước lèo hủ tiếu Nam Vang ninh từ xương ống, tôm khô rang và mực khô nướng, hớt bọt liên tục cho trong, nêm nhạt rồi chỉnh lại khi gần ăn để vị ngọt hậu rõ hơn.</p>`);
const articleHtml = `<h2 class="ce-element">Cách nấu hủ tiếu Nam Vang</h2>${paragraphs.join('')}<h3>Nguyên liệu</h3><ul><li>500g hủ tiếu dai</li><li>300g xương ống</li></ul>`;

describe('bóc nội dung nhúng trong script', () => {
  it('Next.js App Router: bài nằm trong self.__next_f.push', () => {
    const pushed = JSON.stringify(`1c:[["$","div",null,{"dangerouslySetInnerHTML":{"__html":${JSON.stringify(articleHtml)}}}]]`);
    const html = `<!DOCTYPE html><html><head><title>x</title></head><body><div id="__next"></div><script>self.__next_f.push([1,${pushed}])</script></body></html>`;
    const found = extractEmbeddedContent(html);
    expect(found?.source).toBe('rsc');
    const text = embeddedHtmlToText(found!.html!, 'https://example.vn/a');
    expect(wordCount(text)).toBeGreaterThan(150);
    expect(text).toContain('mực khô nướng');
    expect(text).not.toContain('<p>');
  });

  it('Next.js Pages Router: bài nằm trong __NEXT_DATA__', () => {
    const data = { props: { pageProps: { article: { title: 'x', content: articleHtml } } } };
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
    const found = extractEmbeddedContent(html);
    expect(found?.source).toBe('next_data');
    expect(found!.html).toContain('<p>Đoạn 1');
  });

  it('JSON-LD articleBody khi không có HTML nào', () => {
    const body = paragraphs.map((p) => p.replace(/<[^>]+>/g, '')).join(' ');
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'Article', articleBody: body })}</script></head><body></body></html>`;
    const found = extractEmbeddedContent(html);
    expect(found?.source).toBe('ld_json');
    expect(wordCount(found!.text!)).toBeGreaterThan(150);
  });

  it('trang bình thường không có gì để bóc thì trả null', () => {
    expect(extractEmbeddedContent('<html><body><p>ngắn</p><script>var a = 1;</script></body></html>')).toBeNull();
  });

  it('đoán ngôn ngữ', () => {
    expect(guessLanguage(paragraphs.join(' ').replace(/<[^>]+>/g, ''))).toBe('vi');
    expect(guessLanguage('The quick brown fox jumps over the lazy dog and the cat sits with the bird for the whole day, and that is that.'.repeat(3))).toBe('en');
  });
});
