import type { Article, ArticleImage, PlaceInfo, PlacesData, ResearchNotes, RunOptions } from './types.js';
import { placeMapsUrl } from './types.js';
import { featuredPlaces, placeInfoBlock, stripInjectedLines } from './roundup.js';
import { wordCount } from './util.js';

/**
 * Bài giới thiệu thương hiệu từ một link Google Maps: dữ liệu địa điểm, ảnh và đánh giá của khách,
 * cộng thông tin do người đặt bài cung cấp. Dùng lại cấu trúc PlacesData với đúng một quán.
 */

export interface MapsRef {
  placeId: string;
  dataId: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

/** Đọc link Google Maps đầy đủ: place_id, data_id (dạng 0x...:0x...), tên trong đường dẫn, tọa độ. */
export function parseMapsUrl(url: string): MapsRef {
  const u = url.trim();
  let decoded = u;
  try {
    decoded = decodeURIComponent(u);
  } catch {
    /* giữ nguyên */
  }
  const placeId = /(?:query_place_id|place_id)=([A-Za-z0-9_-]+)/.exec(u)?.[1] ?? '';
  const dataId = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i.exec(u)?.[1] ?? '';
  const nameRaw = /\/maps\/place\/([^/@?]+)/.exec(decoded)?.[1] ?? '';
  const name = nameRaw.replace(/\+/g, ' ').trim();
  const at = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(u) ?? /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(u);
  const q = !name ? /[?&]query=([^&]+)/.exec(decoded)?.[1]?.replace(/\+/g, ' ') ?? '' : '';
  return { placeId, dataId, name: name || q, lat: at ? Number(at[1]) : null, lng: at ? Number(at[2]) : null };
}

export function brandPlace(data: PlacesData): PlaceInfo | null {
  return featuredPlaces(data)[0] ?? data.candidates[0] ?? null;
}

/** Ghi chú tư liệu cho bài giới thiệu: thông tin người đặt bài, dữ liệu Maps, ý khen chê từ đánh giá. */
export function buildBrandNotes(data: PlacesData, keyword: string, options: RunOptions): ResearchNotes {
  const p = brandPlace(data)!;
  const name = options.brandName.trim() || p.name;
  const info = options.brandInfo.trim();
  const topics: ResearchNotes['topics'] = [];
  if (info) topics.push({ tag: 'thông tin từ thương hiệu', description: `Thông tin do người đặt bài cung cấp về ${name} (đáng tin nhất, được kể ở ngôi đã chọn)`, sourceRefs: [0], facts: info.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), inTopSites: true });
  const mapsFacts = [`Tên trên Google Maps: ${p.name}`, `Địa chỉ: ${p.address}`, `${p.rating.toFixed(1)}/5 sao từ ${p.reviews} đánh giá trên Google Maps`];
  if (p.type) mapsFacts.push(`Loại hình: ${p.type}`);
  if (p.price) mapsFacts.push(`Mức giá: ${p.price}`);
  if (p.openingHours) mapsFacts.push(`Giờ mở cửa: ${p.openingHours}`);
  if (p.phone) mapsFacts.push(`Điện thoại: ${p.phone}`);
  if (p.website) mapsFacts.push(`Website: ${p.website}`);
  if (p.description) mapsFacts.push(`Mô tả trên Maps: ${p.description}`);
  topics.push({ tag: 'dữ liệu google maps', description: 'Địa chỉ, giờ, sao, liên hệ (tool sẽ chèn khối liên hệ, bài chỉ nhắc tự nhiên trong câu)', sourceRefs: [1], facts: mapsFacts, inTopSites: true });
  const s = p.summary;
  if (s) {
    const facts = [...(s.oneLine ? [`Tóm tắt đánh giá: ${s.oneLine}`] : []), ...s.signature.map((x) => `Món hoặc điểm đặc trưng được nhắc nhiều: ${x}`), ...s.praised.map((x) => `Khách khen: ${x}`), ...s.bestFor.map((x) => `Hợp với: ${x}`), `Số đánh giá đã đọc: ${s.sampleCount}`];
    if (options.brandIncludeCons) facts.push(...s.complained.map((x) => `Khách góp ý: ${x}`));
    topics.push({ tag: 'khách nói gì', description: 'Ý rút từ đánh giá công khai của khách, diễn đạt lại', sourceRefs: [2], facts, inTopSites: true });
  }
  const notes: ResearchNotes = {
    keyword,
    searchIntent: 'informational',
    intentExplanation: `Bài giới thiệu ${name} để đăng trên website hoặc trang tin: người đọc muốn biết thương hiệu là gì, có gì nổi bật, khách nói gì, ở đâu, liên hệ thế nào.`,
    summary: `${name}: ${p.type || 'địa điểm'} tại ${p.address}, ${p.rating.toFixed(1)} sao từ ${p.reviews} đánh giá${s?.oneLine ? `. ${s.oneLine}` : ''}`,
    perSource: [],
    keyFacts: [...mapsFacts.slice(0, 3), ...(s?.praised.slice(0, 3).map((x) => `Khách khen: ${x}`) ?? [])],
    numbersAndNames: [`${name}: ${p.rating.toFixed(1)} sao, ${p.reviews} đánh giá${p.price ? `, mức giá ${p.price}` : ''}`],
    disagreements: [],
    commonSubtopics: ['Giới thiệu', 'Điểm khách khen', 'Sản phẩm hoặc dịch vụ nổi bật', 'Không gian và vị trí', 'Thông tin liên hệ'],
    gaps: [],
    peopleAlsoAsk: [`${name} ở đâu?`, `${name} mở cửa giờ nào?`, `${name} có gì đáng thử?`],
    secondaryKeywords: [name, `${name} ${p.address.split(',').slice(-3, -1).join(' ').trim()}`.trim(), `đánh giá ${name}`, `${p.type || 'quán'} ${name}`].filter(Boolean),
    topics,
    topSites: [],
    comparisons: [],
    similarItems: [],
    brand: { name, info, includeCons: options.brandIncludeCons, mapsUrl: options.mapsUrl, photos: p.photoFiles?.length ?? 0 },
    totalWords: 0,
  };
  notes.totalWords = [...notes.keyFacts, ...topics.flatMap((t) => t.facts), notes.summary].reduce((n, t) => n + wordCount(t), 0);
  return notes;
}

const CONTACT_RE = /liên hệ|địa chỉ|tìm đường|cách đến/i;
const GALLERY_RE = /hình ảnh|ảnh thực tế|không gian/i;

/**
 * Sau mỗi lượt model: mục liên hệ luôn có khối địa chỉ, giờ, điện thoại, website, link Maps chèn từ dữ liệu thật;
 * bộ ảnh Google Maps nằm trong mục "Hình ảnh" (chèn trước mục liên hệ nếu model chưa có).
 */
export function enforceBrandSections(article: Article, data: PlacesData, options: RunOptions): Article {
  const p = brandPlace(data);
  if (!p) return article;
  const name = options.brandName.trim() || p.name;
  const sections = article.sections.map((s) => ({ ...s, body: stripInjectedLines(s.body) }));
  const images: ArticleImage[] = article.images.filter((im) => !im.src);
  const files = p.photoFiles?.length ? p.photoFiles : p.photoFile ? [p.photoFile] : [];
  // Mục liên hệ
  let contactIdx = sections.findIndex((s) => s.level === 2 && CONTACT_RE.test(s.heading));
  if (contactIdx < 0) {
    sections.push({ heading: `Thông tin liên hệ ${name}`, level: 2, body: `Bạn có thể đến trực tiếp hoặc gọi trước để hỏi giờ phục vụ trong ngày.` });
    contactIdx = sections.length - 1;
  }
  sections[contactIdx]!.body = `${placeInfoBlock({ ...p, name })}\n\n${sections[contactIdx]!.body}`.trim();
  // Bộ ảnh
  if (files.length) {
    const gallery = files.map((f, i) => `![${name}, ảnh ${i + 1}](${f})`).join('\n\n');
    let galleryIdx = sections.findIndex((s, i) => i !== contactIdx && s.level === 2 && GALLERY_RE.test(s.heading));
    if (galleryIdx < 0) {
      sections.splice(contactIdx, 0, { heading: `Hình ảnh ${name}`, level: 2, body: `Ảnh do quán và khách đăng trên Google Maps.` });
      galleryIdx = contactIdx;
    }
    sections[galleryIdx]!.body = `${sections[galleryIdx]!.body.trim()}\n\n${gallery}`.trim();
    files.forEach((f, i) => images.push({ position: `mục "${sections[galleryIdx]!.heading}"`, query: '', alt: `${name}, ảnh ${i + 1}`, src: f }));
  }
  return { ...article, sections, images };
}

export function brandForExport(data: PlacesData, options: RunOptions): Record<string, unknown> | null {
  const p = brandPlace(data);
  if (!p) return null;
  return {
    name: options.brandName.trim() || p.name,
    mapsName: p.name,
    address: p.address,
    rating: p.rating,
    reviews: p.reviews,
    price: p.price,
    hours: p.openingHours,
    phone: p.phone,
    website: p.website,
    type: p.type,
    lat: p.lat,
    lng: p.lng,
    mapsUrl: placeMapsUrl(p),
    photos: p.photoFiles ?? (p.photoFile ? [p.photoFile] : []),
    praised: p.summary?.praised ?? [],
    complained: p.summary?.complained ?? [],
    signature: p.summary?.signature ?? [],
    info: options.brandInfo,
  };
}

/** JSON-LD LocalBusiness (Restaurant nếu là quán ăn) cho trang giới thiệu. */
export function brandJsonLd(article: Article, data: PlacesData, options: RunOptions): Record<string, unknown> {
  const p = brandPlace(data)!;
  const name = options.brandName.trim() || p.name;
  const isFood = /quán|nhà hàng|ăn|cafe|cà phê|coffee|restaurant|food|bar|bakery|tiệm/i.test(`${p.type} ${p.name}`);
  return {
    '@context': 'https://schema.org',
    '@type': isFood ? 'Restaurant' : 'LocalBusiness',
    name,
    description: article.metaDescription,
    address: { '@type': 'PostalAddress', streetAddress: p.address, addressCountry: 'VN' },
    ...(p.lat && p.lng ? { geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng } } : {}),
    ...(p.rating && p.reviews ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating, reviewCount: p.reviews, bestRating: 5 } } : {}),
    ...(p.phone ? { telephone: p.phone } : {}),
    ...(p.website ? { url: p.website } : {}),
    ...(p.price ? { priceRange: p.price } : {}),
    ...(p.openingHours ? { openingHours: p.openingHours } : {}),
    ...(p.photoFiles?.length ? { image: p.photoFiles } : p.photoFile ? { image: p.photoFile } : {}),
    hasMap: placeMapsUrl(p),
  };
}
