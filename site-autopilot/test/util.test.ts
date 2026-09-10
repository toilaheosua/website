import { describe, expect, it } from 'vitest';
import { isValidDomain, md5, normalizeDomain, parseList, slugify } from '../src/core/util.js';
import { isCloudflareIp } from '../src/monitor/health.js';
import { pngToIco } from '../src/generator/logo.js';

describe('util', () => {
  it('slugify tiếng Việt', () => {
    expect(slugify('Dịch vụ Điện lạnh Đà Nẵng')).toBe('dich-vu-dien-lanh-da-nang');
    expect(slugify('  Nhiều   khoảng trắng!!  ')).toBe('nhieu-khoang-trang');
    expect(slugify('')).toBe('trang');
  });

  it('normalizeDomain và isValidDomain', () => {
    expect(normalizeDomain('https://WWW.Vidu.COM/abc')).toBe('vidu.com');
    expect(isValidDomain('vidu.com')).toBe(true);
    expect(isValidDomain('sub.vidu.com.vn')).toBe(true);
    expect(isValidDomain('vidu')).toBe(false);
    expect(isValidDomain('-bad.com')).toBe(false);
  });

  it('parseList tách theo dòng, phẩy, chấm phẩy', () => {
    expect(parseList('a, b\nc;d')).toEqual(['a', 'b', 'c', 'd']);
    expect(parseList('')).toEqual([]);
  });

  it('md5 dùng cho chữ ký aaPanel: md5(request_time + md5(key))', () => {
    const key = 'abc';
    const t = '1700000000';
    expect(md5(key)).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5(t + md5(key))).toHaveLength(32);
  });

  it('nhận diện IP Cloudflare', () => {
    expect(isCloudflareIp('104.16.1.1')).toBe(true);
    expect(isCloudflareIp('172.67.1.1')).toBe(true);
    expect(isCloudflareIp('8.8.8.8')).toBe(false);
  });

  it('pngToIco tạo header ICO hợp lệ', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const ico = pngToIco(png, 32);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(1);
    expect(ico.readUInt8(6)).toBe(32);
    expect(ico.readUInt32LE(14)).toBe(png.length);
    expect(ico.readUInt32LE(18)).toBe(22);
    expect(ico.subarray(22).equals(png)).toBe(true);
  });
});
