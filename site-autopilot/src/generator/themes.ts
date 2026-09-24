import type { ThemeConfig } from '../core/types.js';
import { pick, shuffle } from '../core/util.js';

/**
 * 5 theme gốc. Mỗi site được chọn ngẫu nhiên một theme rồi biến tấu (màu, font, bo góc, thứ tự section)
 * để các site không giống nhau về dấu vết.
 * Mọi font đều hỗ trợ tiếng Việt trên Google Fonts.
 */
export const FONT_PAIRS: { heading: string; body: string; families: string[] }[] = [
  { heading: "'Be Vietnam Pro', sans-serif", body: "'Inter', sans-serif", families: ['Be+Vietnam+Pro:wght@500;700;800', 'Inter:wght@400;500;600'] },
  { heading: "'Lora', serif", body: "'Nunito', sans-serif", families: ['Lora:wght@600;700', 'Nunito:wght@400;600;700'] },
  { heading: "'Montserrat', sans-serif", body: "'Roboto', sans-serif", families: ['Montserrat:wght@600;700;800', 'Roboto:wght@400;500'] },
  { heading: "'Playfair Display', serif", body: "'Source Sans 3', sans-serif", families: ['Playfair+Display:wght@600;700', 'Source+Sans+3:wght@400;600'] },
  { heading: "'Lexend', sans-serif", body: "'Open Sans', sans-serif", families: ['Lexend:wght@500;600;700', 'Open+Sans:wght@400;600'] },
  { heading: "'Merriweather', serif", body: "'Quicksand', sans-serif", families: ['Merriweather:wght@700;900', 'Quicksand:wght@400;500;600'] },
  { heading: "'Oswald', sans-serif", body: "'Raleway', sans-serif", families: ['Oswald:wght@500;600;700', 'Raleway:wght@400;500;600'] },
  { heading: "'Josefin Sans', sans-serif", body: "'Nunito', sans-serif", families: ['Josefin+Sans:wght@600;700', 'Nunito:wght@400;600'] },
];

export const PALETTES: ThemeConfig['palette'][] = [
  { primary: '#1e4fa3', primaryDark: '#163b7a', accent: '#f59e0b', bg: '#ffffff', surface: '#f3f6fb', text: '#1f2937', muted: '#6b7280' },
  { primary: '#b45309', primaryDark: '#92400e', accent: '#15803d', bg: '#fffdf8', surface: '#fbf3e6', text: '#292524', muted: '#78716c' },
  { primary: '#0f172a', primaryDark: '#020617', accent: '#06b6d4', bg: '#ffffff', surface: '#f1f5f9', text: '#0f172a', muted: '#64748b' },
  { primary: '#7c2d12', primaryDark: '#5b1f0c', accent: '#0ea5e9', bg: '#fffcfb', surface: '#fdf2ee', text: '#1c1917', muted: '#78716c' },
  { primary: '#166534', primaryDark: '#14532d', accent: '#f97316', bg: '#ffffff', surface: '#f0fdf4', text: '#14532d', muted: '#4b5563' },
  { primary: '#4338ca', primaryDark: '#312e81', accent: '#f43f5e', bg: '#ffffff', surface: '#eef2ff', text: '#1e1b4b', muted: '#6b7280' },
  { primary: '#0e7490', primaryDark: '#155e75', accent: '#f59e0b', bg: '#fbfeff', surface: '#ecfeff', text: '#164e63', muted: '#5b6b73' },
  { primary: '#9f1239', primaryDark: '#881337', accent: '#0d9488', bg: '#fffcfd', surface: '#fff1f2', text: '#1f2937', muted: '#6b7280' },
  { primary: '#374151', primaryDark: '#1f2937', accent: '#d97706', bg: '#ffffff', surface: '#f9fafb', text: '#111827', muted: '#6b7280' },
  { primary: '#5b21b6', primaryDark: '#4c1d95', accent: '#22c55e', bg: '#ffffff', surface: '#f5f3ff', text: '#2e1065', muted: '#6b7280' },
];

export const BASE_THEMES: Omit<ThemeConfig, 'palette' | 'fonts' | 'radius' | 'sectionOrder'>[] = [
  { id: 'corporate', name: 'Doanh nghiệp', headerStyle: 'left', heroStyle: 'split', cardStyle: 'shadow' },
  { id: 'local', name: 'Địa phương ấm áp', headerStyle: 'center', heroStyle: 'image-bg', cardStyle: 'flat' },
  { id: 'modern', name: 'Hiện đại', headerStyle: 'split', heroStyle: 'minimal', cardStyle: 'outline' },
  { id: 'editorial', name: 'Tạp chí', headerStyle: 'center', heroStyle: 'minimal', cardStyle: 'flat' },
  { id: 'fresh', name: 'Tươi mới', headerStyle: 'left', heroStyle: 'image-bg', cardStyle: 'shadow' },
];

const HOME_SECTIONS_BUSINESS = ['intro', 'services', 'why', 'process', 'posts', 'faq', 'cta'];
const HOME_SECTIONS_BLOG = ['intro', 'posts', 'topics', 'why', 'faq', 'cta'];

export function themeIds(): { id: string; name: string }[] {
  return BASE_THEMES.map((t) => ({ id: t.id, name: t.name }));
}

/** Tạo theme cụ thể cho một site: chọn theme gốc + biến tấu ngẫu nhiên. */
export function makeTheme(themeId: string | 'auto', siteType: 'business' | 'blog'): ThemeConfig {
  const base = themeId === 'auto' ? pick(BASE_THEMES) : (BASE_THEMES.find((t) => t.id === themeId) ?? pick(BASE_THEMES));
  const fonts = pick(FONT_PAIRS);
  const palette = pick(PALETTES);
  const radius = pick(['4px', '8px', '12px', '16px', '999px']);
  // Giữ intro đầu và cta cuối, xáo các section giữa để bố cục khác nhau giữa các site
  const middle = (siteType === 'blog' ? HOME_SECTIONS_BLOG : HOME_SECTIONS_BUSINESS).slice(1, -1);
  const sectionOrder = ['intro', ...shuffle(middle), 'cta'];
  return {
    ...base,
    palette,
    fonts: { heading: fonts.heading, body: fonts.body, googleFamilies: fonts.families },
    radius,
    sectionOrder,
  };
}

export function themeCssVars(t: ThemeConfig): string {
  return `--primary:${t.palette.primary};--primary-dark:${t.palette.primaryDark};--accent:${t.palette.accent};--bg:${t.palette.bg};--surface:${t.palette.surface};--text:${t.palette.text};--muted:${t.palette.muted};--radius:${t.radius};--font-heading:${t.fonts.heading};--font-body:${t.fonts.body};`;
}

export function googleFontsUrl(t: ThemeConfig): string {
  return `https://fonts.googleapis.com/css2?${t.fonts.googleFamilies.map((f) => `family=${f}`).join('&')}&display=swap`;
}

export const RADIUS_CHOICES = ['0px', '4px', '8px', '12px', '16px', '999px'];

/** Dữ liệu tùy chỉnh giao diện từ trang Thiết kế; trường nào bỏ trống thì giữ nguyên. */
export interface ThemeTweaks {
  palette?: Partial<ThemeConfig['palette']>;
  fontPair?: number;
  radius?: string;
  headerStyle?: ThemeConfig['headerStyle'];
  heroStyle?: ThemeConfig['heroStyle'];
  cardStyle?: ThemeConfig['cardStyle'];
}

const HEX = /^#[0-9a-f]{6}$/i;

export function applyThemeTweaks(theme: ThemeConfig, t: ThemeTweaks): ThemeConfig {
  const out: ThemeConfig = structuredClone(theme);
  for (const [k, v] of Object.entries(t.palette ?? {})) if (typeof v === 'string' && HEX.test(v)) (out.palette as Record<string, string>)[k] = v.toLowerCase();
  if (t.fontPair !== undefined && FONT_PAIRS[t.fontPair]) {
    const fp = FONT_PAIRS[t.fontPair]!;
    out.fonts = { heading: fp.heading, body: fp.body, googleFamilies: fp.families };
  }
  if (t.radius && RADIUS_CHOICES.includes(t.radius)) out.radius = t.radius;
  if (t.headerStyle && ['left', 'center', 'split'].includes(t.headerStyle)) out.headerStyle = t.headerStyle;
  if (t.heroStyle && ['image-bg', 'split', 'minimal'].includes(t.heroStyle)) out.heroStyle = t.heroStyle;
  if (t.cardStyle && ['shadow', 'flat', 'outline'].includes(t.cardStyle)) out.cardStyle = t.cardStyle;
  return out;
}

/** Chỉ số cặp font đang dùng trong theme (để chọn sẵn trên form). */
export function fontPairIndex(theme: ThemeConfig): number {
  return Math.max(0, FONT_PAIRS.findIndex((p) => p.heading === theme.fonts.heading && p.body === theme.fonts.body));
}
