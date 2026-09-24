import { z } from 'zod';
import type { PageContent, SitePlan, ThemeConfig } from '../core/types.js';

/**
 * Bố cục trang chủ theo khối (block). Người dùng kéo thả, thêm, xóa, ẩn khối trong trang "Thiết kế trang chủ".
 * Site chưa tùy chỉnh thì dùng bố cục mặc định suy ra từ theme và nội dung (giống cách dựng cũ).
 */

export const BLOCK_TYPES = ['hero', 'content', 'services', 'posts', 'faq', 'cta', 'text', 'image_text', 'gallery', 'contact'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const HomeBlockSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(BLOCK_TYPES),
  hidden: z.boolean().optional(),
  props: z.record(z.string(), z.unknown()).default({}),
});
export type HomeBlock = z.infer<typeof HomeBlockSchema>;

export const SiteLayoutSchema = z.object({
  home: z.array(HomeBlockSchema).max(40),
  updated_at: z.string().optional(),
});
export type SiteLayout = z.infer<typeof SiteLayoutSchema>;

/** Mô tả từng loại khối: nhãn, mô tả, các trường cấu hình (dùng chung cho form thiết kế và kiểm tra khi lưu). */
export interface BlockField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'checkbox' | 'section' | 'image' | 'images';
  options?: { value: string; label: string }[];
  help?: string;
  default?: unknown;
}
export interface BlockDef {
  type: BlockType;
  label: string;
  description: string;
  /** Chỉ được có một khối loại này */
  single?: boolean;
  fields: BlockField[];
}

export const BLOCK_DEFS: Record<BlockType, BlockDef> = {
  hero: {
    type: 'hero',
    label: 'Đầu trang (hero)',
    description: 'Tiêu đề lớn, đoạn mở đầu, nút kêu gọi và ảnh đầu trang.',
    single: true,
    fields: [
      { key: 'style', label: 'Kiểu hiển thị', type: 'select', options: [{ value: 'theme', label: 'Theo theme' }, { value: 'image-bg', label: 'Ảnh nền toàn khung' }, { value: 'split', label: 'Chữ trái, ảnh phải' }, { value: 'minimal', label: 'Tối giản, không ảnh' }], default: 'theme' },
      { key: 'secondaryButton', label: 'Hiện nút thứ hai', type: 'checkbox', default: true },
    ],
  },
  content: {
    type: 'content',
    label: 'Mục nội dung AI viết',
    description: 'Một mục trong nội dung trang chủ do AI viết (sửa chữ bằng Chỉnh sửa trực quan).',
    fields: [
      { key: 'section', label: 'Mục', type: 'section', default: 0 },
      { key: 'layout', label: 'Cách trình bày', type: 'select', options: [{ value: 'prose', label: 'Đoạn văn (kèm ảnh nếu có)' }, { value: 'why', label: 'Điểm khác biệt (danh sách thẻ)' }, { value: 'process', label: 'Các bước (đánh số)' }], default: 'prose' },
      { key: 'alt', label: 'Nền xám nhạt', type: 'checkbox', default: false },
    ],
  },
  services: {
    type: 'services',
    label: 'Dịch vụ / chuyên mục',
    description: 'Thẻ các dịch vụ trong kế hoạch nội dung, liên kết tới trang Dịch vụ.',
    single: true,
    fields: [{ key: 'heading', label: 'Tiêu đề mục', type: 'text', help: 'Để trống = "Dịch vụ của chúng tôi"' }],
  },
  posts: {
    type: 'posts',
    label: 'Bài viết mới',
    description: 'Các bài blog mới nhất dạng thẻ.',
    single: true,
    fields: [
      { key: 'heading', label: 'Tiêu đề mục', type: 'text' },
      { key: 'count', label: 'Số bài', type: 'number', default: 3 },
    ],
  },
  faq: {
    type: 'faq',
    label: 'Câu hỏi thường gặp',
    description: 'FAQ của trang chủ (có schema FAQPage cho Google).',
    single: true,
    fields: [{ key: 'heading', label: 'Tiêu đề mục', type: 'text' }],
  },
  cta: {
    type: 'cta',
    label: 'Dải kêu gọi hành động',
    description: 'Dải màu với tiêu đề, khẩu hiệu và nút gọi điện / liên hệ.',
    fields: [
      { key: 'heading', label: 'Tiêu đề', type: 'text', help: 'Để trống = lời kêu gọi trong kế hoạch' },
      { key: 'text', label: 'Câu phụ', type: 'text', help: 'Để trống = khẩu hiệu' },
    ],
  },
  text: {
    type: 'text',
    label: 'Khối chữ tự do',
    description: 'Tiêu đề và đoạn văn bạn tự viết (markdown).',
    fields: [
      { key: 'heading', label: 'Tiêu đề', type: 'text' },
      { key: 'body', label: 'Nội dung (markdown)', type: 'textarea' },
      { key: 'align', label: 'Căn', type: 'select', options: [{ value: 'left', label: 'Trái' }, { value: 'center', label: 'Giữa' }], default: 'left' },
      { key: 'alt', label: 'Nền xám nhạt', type: 'checkbox', default: false },
    ],
  },
  image_text: {
    type: 'image_text',
    label: 'Ảnh + chữ',
    description: 'Một ảnh trong kho cạnh một đoạn chữ.',
    fields: [
      { key: 'heading', label: 'Tiêu đề', type: 'text' },
      { key: 'body', label: 'Nội dung (markdown)', type: 'textarea' },
      { key: 'image', label: 'Ảnh', type: 'image' },
      { key: 'side', label: 'Ảnh nằm bên', type: 'select', options: [{ value: 'right', label: 'Phải' }, { value: 'left', label: 'Trái' }], default: 'right' },
      { key: 'alt', label: 'Nền xám nhạt', type: 'checkbox', default: false },
    ],
  },
  gallery: {
    type: 'gallery',
    label: 'Bộ sưu tập ảnh',
    description: 'Lưới ảnh chọn từ kho ảnh thật.',
    fields: [
      { key: 'heading', label: 'Tiêu đề', type: 'text' },
      { key: 'images', label: 'Ảnh', type: 'images' },
      { key: 'columns', label: 'Số cột', type: 'select', options: [{ value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }], default: '3' },
    ],
  },
  contact: {
    type: 'contact',
    label: 'Thông tin liên hệ',
    description: 'Địa chỉ, điện thoại, giờ mở cửa và bản đồ từ Entity SEO.',
    single: true,
    fields: [
      { key: 'heading', label: 'Tiêu đề', type: 'text' },
      { key: 'showMap', label: 'Hiện bản đồ (cần mã nhúng Google Maps trong Entity)', type: 'checkbox', default: true },
      { key: 'alt', label: 'Nền xám nhạt', type: 'checkbox', default: true },
    ],
  },
};

let seq = 0;
export function newBlockId(type: string): string {
  seq = (seq + 1) % 1000;
  return `${type}-${Date.now().toString(36)}${seq.toString(36)}`;
}

/**
 * Bố cục mặc định: tái hiện đúng cách dựng cũ theo theme.sectionOrder,
 * để site chưa tùy chỉnh trông y như trước và người dùng bắt đầu từ bố cục hiện có.
 */
export function defaultHomeLayout(theme: Pick<ThemeConfig, 'sectionOrder'>, content: PageContent, plan: SitePlan, siteType: 'business' | 'blog', hasPosts: boolean): HomeBlock[] {
  const blocks: HomeBlock[] = [{ id: 'hero', type: 'hero', props: { style: 'theme', secondaryButton: true } }];
  const queue = content.sections.map((s, i) => ({ s, i }));
  let n = 0;
  const push = (type: BlockType, props: Record<string, unknown>) => blocks.push({ id: `${type}-${++n}`, type, props });
  for (const key of theme.sectionOrder) {
    switch (key) {
      case 'intro': {
        const it = queue.shift();
        if (it) push('content', { section: it.i, layout: 'prose', alt: false });
        break;
      }
      case 'services':
        push('services', { heading: '' });
        break;
      case 'topics':
        if (siteType === 'blog') push('services', { heading: '' });
        break;
      case 'why': {
        const it = queue.shift();
        if (it || plan.differentiators.length) push('content', { section: it ? it.i : -1, layout: 'why', alt: false });
        break;
      }
      case 'process': {
        const idx = queue.findIndex((q) => /quy trình|process|các bước|steps/i.test(q.s.heading));
        const it = idx >= 0 ? queue.splice(idx, 1)[0] : queue.shift();
        if (it) push('content', { section: it.i, layout: 'process', alt: true });
        break;
      }
      case 'posts':
        if (hasPosts) push('posts', { heading: '', count: 3 });
        break;
      case 'faq':
        while (queue.length) {
          const it = queue.shift();
          if (it) push('content', { section: it.i, layout: 'prose', alt: true });
        }
        push('faq', { heading: '' });
        break;
      case 'cta':
        push('cta', { heading: '', text: '' });
        break;
      default:
        break;
    }
  }
  return blocks;
}

/** Kiểm tra và làm sạch bố cục người dùng gửi lên: đúng loại, id duy nhất, khối single không trùng. */
export function normalizeLayout(input: unknown): SiteLayout {
  const parsed = SiteLayoutSchema.parse(input);
  const seen = new Set<string>();
  const singles = new Set<string>();
  const home: HomeBlock[] = [];
  for (const b of parsed.home) {
    const def = BLOCK_DEFS[b.type];
    if (seen.has(b.id) || (def.single && singles.has(b.type))) continue;
    seen.add(b.id);
    if (def.single) singles.add(b.type);
    const props: Record<string, unknown> = {};
    for (const f of def.fields) {
      const v = b.props[f.key];
      switch (f.type) {
        case 'checkbox':
          props[f.key] = v === undefined ? Boolean(f.default) : v === true || v === 'true' || v === '1';
          break;
        case 'number':
        case 'section':
        case 'image':
          props[f.key] = v === '' || v === undefined || v === null ? (f.default ?? null) : Number(v);
          break;
        case 'images':
          props[f.key] = Array.isArray(v) ? v.map(Number).filter((x) => Number.isFinite(x)) : [];
          break;
        case 'select':
          props[f.key] = f.options?.some((o) => o.value === String(v)) ? String(v) : (f.default ?? f.options?.[0]?.value ?? '');
          break;
        default:
          props[f.key] = typeof v === 'string' ? v.slice(0, 20_000) : (f.default ?? '');
      }
    }
    home.push({ id: b.id, type: b.type, hidden: Boolean(b.hidden), props });
  }
  if (!home.some((b) => b.type === 'hero')) home.unshift({ id: 'hero', type: 'hero', props: { style: 'theme', secondaryButton: true } });
  return { home, updated_at: new Date().toISOString() };
}

/** Các ảnh kho được dùng trong bố cục (gallery, ảnh + chữ) để sao chép vào bản dựng. */
export function layoutLibraryIds(layout: SiteLayout | null | undefined): number[] {
  const ids = new Set<number>();
  for (const b of layout?.home ?? []) {
    if (b.hidden) continue;
    if (b.type === 'gallery') for (const id of (b.props.images as number[] | undefined) ?? []) ids.add(Number(id));
    if (b.type === 'image_text' && b.props.image) ids.add(Number(b.props.image));
  }
  return [...ids].filter((n) => Number.isFinite(n) && n > 0);
}
