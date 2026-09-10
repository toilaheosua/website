import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { ThemeConfig } from '../core/types.js';
import { escapeHtml } from '../core/util.js';

export interface BrandAssets {
  /** Đường dẫn tương đối trong thư mục output */
  logo: string;
  logoWidth: number;
  logoHeight: number;
  favicon32: string;
  appleTouch: string;
  icon192: string;
  icon512: string;
  ogImage: string;
  faviconIco: string;
  /** Mã phiên bản (hash logo) gắn vào ?v= để trình duyệt và Cloudflare không dùng bản cũ */
  version: string;
}

function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'A';
  if (words.length === 1) return (words[0] as string).slice(0, 2).toUpperCase();
  return ((words[0] as string).charAt(0) + (words[1] as string).charAt(0)).toUpperCase();
}

/** SVG logo chữ: ô vuông bo góc màu chủ đạo chứa chữ cái đầu + tên thương hiệu. */
export function textLogoSvg(brandName: string, theme: ThemeConfig, opts: { withText?: boolean; size?: number } = {}): string {
  const size = opts.size ?? 96;
  const withText = opts.withText ?? true;
  const ini = escapeHtml(initials(brandName));
  const name = escapeHtml(brandName);
  const fontSize = ini.length > 1 ? size * 0.42 : size * 0.52;
  const textWidth = Math.round(brandName.length * size * 0.32) + size * 0.3;
  const width = withText ? size + textWidth : size;
  const badge = `<rect x="0" y="0" width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="${theme.palette.primary}"/>
  <text x="${size / 2}" y="${size / 2}" dy="0.36em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff">${ini}</text>`;
  const label = withText
    ? `<text x="${size + size * 0.22}" y="${size / 2}" dy="0.36em" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${Math.round(size * 0.38)}" fill="${theme.palette.text}">${name}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${size}" viewBox="0 0 ${width} ${size}">${badge}${label}</svg>`;
}

export function ogImageSvg(brandName: string, tagline: string, theme: ThemeConfig): string {
  const name = escapeHtml(brandName);
  const tag = escapeHtml(tagline.length > 90 ? tagline.slice(0, 87) + '...' : tagline);
  const nameSize = brandName.length > 24 ? 56 : brandName.length > 16 ? 68 : 84;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.palette.primary}"/><stop offset="1" stop-color="${theme.palette.primaryDark}"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <circle cx="1040" cy="120" r="220" fill="${theme.palette.accent}" opacity="0.18"/>
  <circle cx="140" cy="560" r="160" fill="#ffffff" opacity="0.08"/>
  <text x="80" y="300" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${nameSize}" fill="#ffffff">${name}</text>
  <text x="80" y="380" font-family="Arial, Helvetica, sans-serif" font-size="34" fill="#ffffff" opacity="0.92">${tag}</text>
  <rect x="80" y="430" width="140" height="8" rx="4" fill="${theme.palette.accent}"/>
</svg>`;
}

/** Đóng gói PNG thành file .ico (định dạng ICO chứa PNG, được mọi trình duyệt hiện đại hỗ trợ). */
export function pngToIco(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

/**
 * Tạo bộ nhận diện: logo (tải lên hoặc tự tạo), favicon các cỡ, ảnh Open Graph.
 * Ghi vào outDir/assets/brand/. Trả về đường dẫn tương đối.
 */
export async function buildBrandAssets(input: { brandName: string; tagline: string; theme: ThemeConfig; uploadedLogoPath?: string | null; outDir: string }): Promise<BrandAssets> {
  const brandDir = path.join(input.outDir, 'assets', 'brand');
  fs.mkdirSync(brandDir, { recursive: true });

  let logoSource: Buffer;
  let logoIsUpload = false;
  if (input.uploadedLogoPath && fs.existsSync(input.uploadedLogoPath)) {
    logoSource = fs.readFileSync(input.uploadedLogoPath);
    logoIsUpload = true;
  } else {
    logoSource = Buffer.from(textLogoSvg(input.brandName, input.theme, { withText: true, size: 96 }));
  }

  // Logo hiển thị trên header: cao tối đa 160px (hiển thị 80px @2x), giữ tỷ lệ, nền trong suốt
  const logoPng = await sharp(logoSource, { density: 300 }).resize({ height: 160, withoutEnlargement: false, fit: 'inside' }).png().toBuffer();
  const logoMeta = await sharp(logoPng).metadata();
  fs.writeFileSync(path.join(brandDir, 'logo.png'), logoPng);

  // Icon vuông: dùng logo tải lên (contain trên nền màu chủ đạo nếu không vuông) hoặc badge chữ
  const iconSource = logoIsUpload ? logoSource : Buffer.from(textLogoSvg(input.brandName, input.theme, { withText: false, size: 512 }));
  const makeIcon = async (size: number) =>
    sharp(iconSource, { density: 300 })
      .resize({ width: size, height: size, fit: logoIsUpload ? 'contain' : 'cover', background: logoIsUpload ? { r: 255, g: 255, b: 255, alpha: 0 } : input.theme.palette.primary })
      .png()
      .toBuffer();
  const [ico32, apple, i192, i512] = await Promise.all([makeIcon(32), makeIcon(180), makeIcon(192), makeIcon(512)]);
  fs.writeFileSync(path.join(brandDir, 'favicon-32.png'), ico32);
  fs.writeFileSync(path.join(brandDir, 'apple-touch-icon.png'), apple);
  fs.writeFileSync(path.join(brandDir, 'icon-192.png'), i192);
  fs.writeFileSync(path.join(brandDir, 'icon-512.png'), i512);
  fs.writeFileSync(path.join(input.outDir, 'favicon.ico'), pngToIco(ico32, 32));

  const og = await sharp(Buffer.from(ogImageSvg(input.brandName, input.tagline, input.theme))).png().toBuffer();
  fs.writeFileSync(path.join(brandDir, 'og-default.png'), og);

  return {
    logo: 'assets/brand/logo.png',
    logoWidth: logoMeta.width ?? 160,
    logoHeight: logoMeta.height ?? 160,
    favicon32: 'assets/brand/favicon-32.png',
    appleTouch: 'assets/brand/apple-touch-icon.png',
    icon192: 'assets/brand/icon-192.png',
    icon512: 'assets/brand/icon-512.png',
    ogImage: 'assets/brand/og-default.png',
    faviconIco: 'favicon.ico',
    version: crypto.createHash('md5').update(logoPng).update(input.tagline).digest('hex').slice(0, 8),
  };
}
