import type { ImageRow, Page, Site } from '../db/index.js';
import type { EntityData, SitePlan, ThemeConfig } from '../core/types.js';
import type { BrandAssets } from './logo.js';

export const UI_STRINGS = {
  vi: {
    home: 'Trang chủ',
    about: 'Giới thiệu',
    services: 'Dịch vụ',
    topics: 'Chủ đề',
    blog: 'Blog',
    contact: 'Liên hệ',
    privacy: 'Chính sách bảo mật',
    readMore: 'Đọc tiếp',
    relatedPosts: 'Bài viết liên quan',
    latestPosts: 'Bài viết mới',
    allPosts: 'Xem tất cả bài viết',
    faq: 'Câu hỏi thường gặp',
    ourServices: 'Dịch vụ của chúng tôi',
    mainTopics: 'Chủ đề chính',
    whyUs: 'Vì sao chọn chúng tôi',
    process: 'Cách chúng tôi làm việc',
    contactUs: 'Liên hệ ngay',
    phone: 'Điện thoại',
    email: 'Email',
    address: 'Địa chỉ',
    hours: 'Giờ làm việc',
    writtenBy: 'Viết bởi',
    published: 'Đăng ngày',
    updated: 'Cập nhật',
    minRead: 'phút đọc',
    copyright: 'Bản quyền',
    photos: 'Ảnh minh họa từ',
    menu: 'Menu',
    notFound: 'Không tìm thấy trang',
    notFoundText: 'Trang bạn tìm không tồn tại hoặc đã được chuyển. Hãy quay về trang chủ.',
    backHome: 'Về trang chủ',
    learnMore: 'Tìm hiểu thêm',
    followUs: 'Kết nối với chúng tôi',
    quickLinks: 'Liên kết nhanh',
    inThisPage: 'Trong trang này',
    keyTakeaways: 'Tóm tắt nhanh',
  },
  en: {
    home: 'Home',
    about: 'About',
    services: 'Services',
    topics: 'Topics',
    blog: 'Blog',
    contact: 'Contact',
    privacy: 'Privacy policy',
    readMore: 'Read more',
    relatedPosts: 'Related articles',
    latestPosts: 'Latest articles',
    allPosts: 'View all articles',
    faq: 'Frequently asked questions',
    ourServices: 'Our services',
    mainTopics: 'Main topics',
    whyUs: 'Why choose us',
    process: 'How we work',
    contactUs: 'Contact us',
    phone: 'Phone',
    email: 'Email',
    address: 'Address',
    hours: 'Opening hours',
    writtenBy: 'Written by',
    published: 'Published',
    updated: 'Updated',
    minRead: 'min read',
    copyright: 'Copyright',
    photos: 'Photos from',
    menu: 'Menu',
    notFound: 'Page not found',
    notFoundText: 'The page you are looking for does not exist or has moved.',
    backHome: 'Back to home',
    learnMore: 'Learn more',
    followUs: 'Follow us',
    quickLinks: 'Quick links',
    inThisPage: 'On this page',
    keyTakeaways: 'Key takeaways',
  },
} as const;

export type UiStrings = Record<keyof (typeof UI_STRINGS)['vi'], string>;
export type RouteMap = Record<keyof (typeof ROUTES)['vi'], string>;

export const ROUTES = {
  vi: { about: 'gioi-thieu', services: 'dich-vu', blog: 'blog', contact: 'lien-he', privacy: 'chinh-sach-bao-mat' },
  en: { about: 'about', services: 'services', blog: 'blog', contact: 'contact', privacy: 'privacy-policy' },
} as const;

export interface NavItem {
  label: string;
  href: string;
  key: string;
}

export interface RenderContext {
  site: Site;
  siteUrl: string;
  theme: ThemeConfig;
  brand: BrandAssets;
  plan: SitePlan;
  entity: EntityData;
  pages: Page[];
  images: Map<string, ImageRow>;
  nav: NavItem[];
  t: UiStrings;
  language: 'vi' | 'en';
  routes: RouteMap;
  year: number;
  buildDate: string;
  /** true khi dựng trang cho Chỉnh sửa trực quan: thêm data-edit vào phần tử sửa được */
  edit?: boolean;
}

/** Thuộc tính đánh dấu chữ thuần sửa được (chỉ ở chế độ chỉnh sửa). */
export function ed(ctx: RenderContext, path: string): Record<string, string> {
  return ctx.edit ? { 'data-edit': path } : {};
}

/** Thuộc tính đánh dấu khối markdown sửa được. */
export function edMd(ctx: RenderContext, path: string): Record<string, string> {
  return ctx.edit ? { 'data-edit-md': path } : {};
}

export function pageUrl(ctx: RenderContext, slug: string): string {
  return slug ? `${ctx.siteUrl}/${slug}/` : `${ctx.siteUrl}/`;
}

export function pageHref(slug: string): string {
  return slug ? `/${slug}/` : '/';
}

export function findImage(ctx: RenderContext, key: string): ImageRow | undefined {
  return ctx.images.get(key);
}

export function buildNav(ctx: Omit<RenderContext, 'nav'>): NavItem[] {
  const { t, routes, pages } = ctx;
  const has = (slug: string) => pages.some((p) => p.slug === slug);
  const items: NavItem[] = [{ label: t.home, href: '/', key: 'home' }];
  if (has(routes.about)) items.push({ label: t.about, href: pageHref(routes.about), key: 'about' });
  if (has(routes.services)) items.push({ label: t.services, href: pageHref(routes.services), key: 'services' });
  if (has(routes.blog)) items.push({ label: t.blog, href: pageHref(routes.blog), key: 'blog' });
  if (has(routes.contact)) items.push({ label: t.contact, href: pageHref(routes.contact), key: 'contact' });
  return items;
}
