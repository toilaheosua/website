import type { Article, ArticleImage, PlaceInfo, PlaceRole, PlacesData, ResearchNotes, RunOptions } from './types.js';
import { placeMapsUrl } from './types.js';
import type { PlaceClassification, PlaceForRole, RawPlace } from '../services/types.js';
import { normText, slugify, wordCount } from './util.js';

/**
 * Tổng hợp quán theo khu vực: lọc, gộp chi nhánh, xếp hạng theo trung bình Bayes,
 * dựng ghi chú cho bước bố cục, và ép mỗi mục quán có địa chỉ cùng link Google Maps.
 */

/** "hủ tiếu phan rang" → món "hủ tiếu", khu vực "Phan Rang" (dự phòng khi người dùng gõ một dòng). */
export function splitKeyword(keyword: string): { dish: string; area: string } {
  const words = keyword.trim().split(/\s+/);
  if (words.length < 3) return { dish: keyword.trim(), area: '' };
  const areaLen = words.length >= 4 ? 2 : 1;
  const area = words.slice(-areaLen).join(' ');
  const dish = words.slice(0, -areaLen).join(' ');
  return { dish, area: titleCaseWords(area) };
}

/** "phan rang-tháp chàm" → "Phan Rang-Tháp Chàm": viết hoa chữ đầu mỗi từ của tên riêng. */
export function titleCaseWords(s: string): string {
  return s.replace(/(^|[\s\-/])(\p{L})/gu, (m) => m.toLocaleUpperCase('vi'));
}

const AREA_STOP = new Set(['thành', 'phố', 'tp', 'tp.', 'thị', 'xã', 'quận', 'huyện', 'tỉnh', 'phường', 'khu', 'vực', 'city', 'province']);

/** Địa chỉ có nhắc tới khu vực không (so từng từ có nghĩa của tên khu vực, không dấu, không phân biệt hoa thường). */
export function addressInArea(address: string, area: string): boolean {
  const a = normText(address);
  const tokens = normText(area)
    .split(/\s+/)
    .filter((t) => t && !AREA_STOP.has(t));
  if (!tokens.length) return true;
  const joined = tokens.join(' ');
  if (a.includes(joined)) return true;
  // "Phan Rang-Tháp Chàm" trong địa chỉ vẫn khớp "Phan Rang"
  return tokens.every((t) => a.includes(t));
}

/** Khóa gộp chi nhánh dự phòng khi model không cho: tên bỏ số chi nhánh, "cơ sở", "chi nhánh", "CN". */
export function normalizeGroupKey(name: string): string {
  return normText(name)
    .replace(/\b(chi nhánh|cơ sở|cn|branch)\b.*$/i, '')
    .replace(/\s+\d+$/, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DAY_ORDER: { keys: string[]; label: string }[] = [
  { keys: ['thứ hai', 'thu hai', 'monday', 'mon', 't2'], label: 'Thứ hai' },
  { keys: ['thứ ba', 'thu ba', 'tuesday', 'tue', 't3'], label: 'Thứ ba' },
  { keys: ['thứ tư', 'thu tu', 'wednesday', 'wed', 't4'], label: 'Thứ tư' },
  { keys: ['thứ năm', 'thu nam', 'thursday', 'thu', 't5'], label: 'Thứ năm' },
  { keys: ['thứ sáu', 'thu sau', 'friday', 'fri', 't6'], label: 'Thứ sáu' },
  { keys: ['thứ bảy', 'thu bay', 'saturday', 'sat', 't7'], label: 'Thứ bảy' },
  { keys: ['chủ nhật', 'chu nhat', 'sunday', 'sun', 'cn'], label: 'Chủ nhật' },
];

function normalizeHoursValue(v: string): string {
  const t = v.trim();
  if (!t) return '';
  if (/^closed$/i.test(t)) return 'Đóng cửa';
  if (/open 24 hours|24 giờ|24h/i.test(t)) return 'Mở 24 giờ';
  return t.replace(/\s*[–—-]\s*/g, ' đến ').replace(/\s*,\s*/g, ' và ');
}

/**
 * Gọn giờ mở theo ngày của Google Maps: nhóm các ngày liên tiếp cùng giờ.
 * Cả tuần cùng giờ thành "Hằng ngày ..."; khác nhau thành "Thứ hai đến Thứ sáu ...; Thứ bảy ...; Chủ nhật đóng cửa".
 */
export function formatOperatingHours(oh: Record<string, string>): string {
  const byDay = DAY_ORDER.map((d) => {
    const key = Object.keys(oh).find((k) => d.keys.includes(k.trim().toLowerCase()));
    return { label: d.label, value: key ? normalizeHoursValue(oh[key] ?? '') : '' };
  }).filter((d) => d.value);
  if (!byDay.length) return '';
  const closedWord = (v: string) => (v === 'Đóng cửa' ? 'đóng cửa' : v);
  if (byDay.length === 7 && byDay.every((d) => d.value === byDay[0]!.value)) return `Hằng ngày ${closedWord(byDay[0]!.value)}`;
  const groups: { labels: string[]; value: string }[] = [];
  for (const d of byDay) {
    const last = groups[groups.length - 1];
    if (last && last.value === d.value) last.labels.push(d.label);
    else groups.push({ labels: [d.label], value: d.value });
  }
  return groups
    .map((g) => {
      const days = g.labels.length >= 3 ? `${g.labels[0]} đến ${g.labels[g.labels.length - 1]}` : g.labels.join(', ');
      return `${days} ${closedWord(g.value)}`;
    })
    .join('; ');
}

/**
 * Giá trên Google Maps thường là bậc giá, không phải khoảng giá thật: "₫1–100.000" nghĩa là "bình dân",
 * "$$" là "tầm trung". Đổi bậc thành chữ; khoảng giá cụ thể (ví dụ 20.000–50.000) thì giữ.
 */
export function normalizePrice(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  const symbols = /^\$+$/.exec(t) ?? /^₫+$/.exec(t);
  if (symbols) {
    const n = t.length;
    return n <= 1 ? 'bình dân' : n === 2 ? 'tầm trung' : n === 3 ? 'khá cao' : 'cao cấp';
  }
  const nums = [...t.matchAll(/\d[\d.,]*/g)].map((m) => Number.parseInt(m[0]!.replace(/[.,]/g, ''), 10)).filter((n) => Number.isFinite(n));
  const fmt = (n: number) => n.toLocaleString('vi-VN');
  if (nums.length >= 2) {
    const [lo, hi] = [Math.min(nums[0]!, nums[1]!), Math.max(nums[0]!, nums[1]!)];
    // Cận dưới 1 đồng là bậc giá của Google, không phải giá thật
    if (lo <= 1) {
      if (hi <= 100_000) return `bình dân (dưới ${fmt(hi)} đ một người)`;
      if (hi <= 200_000) return `tầm trung (dưới ${fmt(hi)} đ một người)`;
      if (hi <= 500_000) return `khá cao (dưới ${fmt(hi)} đ một người)`;
      return `cao cấp (dưới ${fmt(hi)} đ một người)`;
    }
    if (lo >= 100_000 && hi <= 200_000 && lo % 100_000 === 0 && hi % 100_000 === 0) return `tầm trung (${fmt(lo)} đến ${fmt(hi)} đ một người)`;
    if (lo >= 200_000 && hi <= 500_000 && lo % 100_000 === 0 && hi % 100_000 === 0) return `khá cao (${fmt(lo)} đến ${fmt(hi)} đ một người)`;
    return `${fmt(lo)} đến ${fmt(hi)} đ`;
  }
  if (nums.length === 1) {
    const n = nums[0]!;
    if (/\+|trên|hơn|above|over/i.test(t)) return n >= 500_000 ? `cao cấp (trên ${fmt(n)} đ một người)` : `trên ${fmt(n)} đ`;
    return `khoảng ${fmt(n)} đ`;
  }
  return t.replace(/\s*[–—]\s*/g, ' đến ');
}

/** "+84 847 939 688" thành "0847 939 688" để người đọc trong nước bấm gọi được. */
export function formatPhone(phone: string): string {
  return phone.trim().replace(/^\+84[\s.-]?/, '0').replace(/\s{2,}/g, ' ');
}

/** Phân loại bằng quy tắc khi model lỗi: tên hoặc loại hình chứa món, địa chỉ chứa khu vực, khóa gộp từ tên. */
export function heuristicClassify(raw: RawPlace[], dish: string, area: string): PlaceClassification[] {
  const d = normText(dish);
  const tokens = d.split(' ').filter((t) => t.length > 1);
  return raw.map((p, i) => {
    const hay = normText(`${p.title} ${p.type} ${p.types.join(' ')} ${p.description}`);
    const matchesDish = hay.includes(d) || (tokens.length > 1 && tokens.every((t) => hay.includes(t))) || /quán ăn|nhà hàng|ăn uống|restaurant|food/i.test(hay);
    return { index: i + 1, matchesDish, inArea: addressInArea(p.address, area), groupKey: normalizeGroupKey(p.title) };
  });
}

export interface BuildPlacesInput {
  raw: RawPlace[];
  classes: PlaceClassification[];
  dish: string;
  area: string;
  minReviews: number;
  bayesM: number;
  featuredCount: number;
  userNotes: string;
  /** Tâm khu vực và bán kính km: quán trong bán kính được coi là thuộc khu vực dù địa chỉ không ghi tên (địa chỉ mới sau sáp nhập chỉ ghi phường và tỉnh) */
  center?: { lat: number; lng: number } | null;
  radiusKm?: number;
  /** Sàn sao; quán thấp hơn bị loại, đồng thời là mốc trừ trong công thức điểm (mặc định 3,5) */
  minRating?: number;
}

/** Khoảng cách đường chim bay (km) giữa hai tọa độ. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(s));
}

/** Từ dữ liệu Maps và phân loại của model: gộp chi nhánh, loại quán không đủ điều kiện, xếp hạng, chọn quán vào bài. */
export function buildPlaces(input: BuildPlacesInput): { candidates: PlaceInfo[]; meanRating: number } {
  const byIndex = new Map(input.classes.map((c) => [Math.round(c.index), c]));
  const closedRe = /permanently closed|đóng cửa vĩnh viễn|ngừng hoạt động|temporarily closed|tạm đóng/i;
  const radius = input.radiusKm ?? 0;
  const list: PlaceInfo[] = input.raw.map((r, i) => {
    const c = byIndex.get(i + 1);
    // Thuộc khu vực khi địa chỉ ghi tên khu vực, hoặc nằm trong bán kính quanh tâm, hoặc model khẳng định mà địa chỉ không phủ nhận
    const byAddress = addressInArea(r.address, input.area);
    const km = input.center && r.lat && r.lng ? distanceKm(input.center, r) : null;
    const byGeo = km !== null && radius > 0 && km <= radius;
    const inArea = byAddress || byGeo || (c?.inArea === true && km === null);
    return {
      placeId: r.placeId,
      dataId: r.dataId,
      name: r.title,
      address: r.address,
      rating: r.rating,
      reviews: r.reviews,
      // Bậc giá của Google ("₫1–100.000", "$$") thành chữ "bình dân", "tầm trung"...; khoảng giá thật thì giữ số
      price: normalizePrice(r.price),
      type: r.type,
      hours: r.hours.replace(/\s*[–—]\s*/g, ' đến ').trim(),
      openingHours: formatOperatingHours(r.operatingHours ?? {}),
      phone: formatPhone(r.phone ?? ''),
      openState: r.openState,
      closed: closedRe.test(`${r.openState} ${r.hours}`),
      lat: r.lat,
      lng: r.lng,
      website: r.website,
      description: r.description,
      thumbnail: r.thumbnail,
      mapsPosition: r.position,
      branches: [r.address],
      inArea,
      matchesDish: c ? c.matchesDish : true,
      score: 0,
      rank: 0,
      featured: false,
      excludedReason: null,
      userNote: '',
      photoFile: null,
      reviewsFetched: [],
      summary: null,
    };
  });

  // Gộp chi nhánh cùng thương hiệu: giữ quán nhiều đánh giá nhất làm chính, cộng số đánh giá, sao tính theo trọng số
  const groups = new Map<string, PlaceInfo[]>();
  list.forEach((p, i) => {
    const c = byIndex.get(i + 1);
    const key = (c?.groupKey ?? '').trim().toLowerCase() || normalizeGroupKey(p.name);
    if (!key || p.closed || !p.inArea || !p.matchesDish) return;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  });
  const merged = new Set<PlaceInfo>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => b.reviews - a.reviews);
    const main = members[0]!;
    const totalReviews = members.reduce((n, m) => n + m.reviews, 0);
    main.rating = totalReviews ? Math.round((members.reduce((n, m) => n + m.rating * m.reviews, 0) / totalReviews) * 10) / 10 : main.rating;
    main.reviews = totalReviews;
    main.branches = members.map((m) => m.address);
    for (const m of members.slice(1)) {
      m.excludedReason = `Gộp vào "${main.name}" (cùng thương hiệu)`;
      merged.add(m);
    }
  }

  for (const p of list) {
    if (merged.has(p)) continue;
    if (p.closed) p.excludedReason = 'Đã đóng cửa';
    else if (!p.inArea) {
      const km = input.center && p.lat && p.lng ? distanceKm(input.center, p) : null;
      p.excludedReason = `Địa chỉ không thuộc ${input.area}${km !== null ? ` (cách tâm ${km.toFixed(0)} km, bán kính ${radius} km)` : ''}`;
    }
    else if (!p.matchesDish) p.excludedReason = `Không phải quán ${input.dish}`;
    else if (p.reviews < input.minReviews) p.excludedReason = `Chỉ ${p.reviews} đánh giá, dưới mức ${input.minReviews}`;
    else if (!p.rating) p.excludedReason = 'Chưa có sao';
    else if (input.minRating && p.rating < input.minRating) p.excludedReason = `${p.rating.toFixed(1)} sao, dưới sàn ${input.minRating}`;
  }
  const eligible = list.filter((p) => !p.excludedReason);
  const meanRating = eligible.length ? eligible.reduce((n, p) => n + p.rating, 0) / eligible.length : 4.3;
  const m = input.bayesM;
  const floor = input.minRating || 3.5;
  for (const p of eligible) {
    const v = p.reviews;
    // Điểm = (sao Bayes trừ sàn) × độ tin cậy theo bậc mười của số lượt (10 lượt = 1, 100 = 2, 1.000 = 3).
    // Bayes kéo quán ít đánh giá về mức trung bình; nhân với độ tin cậy nên cùng 1.000 lượt, quán 4,6 sao
    // được gần gấp đôi quán 4,1 sao: giữ được sao cao qua hàng nghìn lượt là quán ổn định lâu năm.
    const bayes = (v / (v + m)) * p.rating + (m / (v + m)) * meanRating;
    p.score = Math.round(Math.max(bayes - floor, 0.05) * Math.log10(1 + v) * 1000) / 1000;
  }
  eligible.sort((a, b) => b.score - a.score || b.reviews - a.reviews || b.rating - a.rating);
  eligible.forEach((p, i) => {
    p.rank = i + 1;
    p.featured = i < input.featuredCount;
  });
  const candidates = [...eligible, ...list.filter((p) => p.excludedReason).sort((a, b) => b.reviews - a.reviews)];
  applyPlaceNotes(candidates, input.userNotes);
  return { candidates, meanRating: Math.round(meanRating * 100) / 100 };
}

/** "Tên quán: ghi chú" mỗi dòng; tên khớp gần đúng (không dấu, chứa nhau). */
export function parsePlaceNotes(text: string): { name: string; note: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(':');
      return i > 0 ? { name: l.slice(0, i).trim(), note: l.slice(i + 1).trim() } : { name: '', note: l };
    })
    .filter((x) => x.name && x.note);
}

export function applyPlaceNotes(candidates: PlaceInfo[], text: string): void {
  for (const n of parsePlaceNotes(text)) {
    const key = normText(n.name);
    const hit = candidates.find((p) => normText(p.name).includes(key) || key.includes(normText(p.name)));
    if (hit) hit.userNote = n.note;
  }
}

export function featuredPlaces(data: PlacesData): PlaceInfo[] {
  return data.candidates.filter((p) => p.featured && !p.excludedReason).sort((a, b) => a.rank - b.rank);
}

function ratingLine(p: PlaceInfo): string {
  const bits = [`${p.rating.toFixed(1)}/5 sao từ ${p.reviews} đánh giá trên Google Maps`];
  if (p.price) bits.push(`mức giá: ${p.price}`);
  if (p.openingHours) bits.push(`giờ mở cửa: ${p.openingHours}`);
  return bits.join(', ');
}

/** Ghi chú tư liệu cho bước bố cục và viết: mỗi quán là một nhãn, kèm cách xếp hạng và bảng so sánh. */
export function buildRoundupNotes(data: PlacesData, keyword: string, options: RunOptions): ResearchNotes {
  const featured = featuredPlaces(data);
  const topics = featured.map((p) => {
    const facts = [`Địa chỉ: ${p.address}${p.branches.length > 1 ? ` (còn ${p.branches.length - 1} chi nhánh khác: ${p.branches.slice(1).join('; ')})` : ''}`, ratingLine(p)];
    if (p.type) facts.push(`Loại hình trên Maps: ${p.type}`);
    if (p.phone) facts.push(`Điện thoại: ${p.phone}`);
    if (p.website) facts.push(`Website: ${p.website}`);
    if (p.description) facts.push(`Mô tả trên Maps: ${p.description}`);
    if (p.summary) {
      if (p.summary.oneLine) facts.push(`Tóm tắt đánh giá: ${p.summary.oneLine}`);
      for (const x of p.summary.signature) facts.push(`Món hoặc điểm đặc trưng được nhắc nhiều: ${x}`);
      for (const x of p.summary.praised) facts.push(`Khách khen: ${x}`);
      for (const x of p.summary.complained) facts.push(`Khách chê: ${x}`);
      for (const x of p.summary.bestFor) facts.push(`Hợp với: ${x}`);
      facts.push(`Số đánh giá đã đọc để rút ý: ${p.summary.sampleCount}`);
    }
    if (p.userNote) facts.push(`GHI CHÚ CỦA NGƯỜI ĐẶT BÀI (trải nghiệm thật, được kể ở ngôi thứ nhất): ${p.userNote}`);
    if (p.role) {
      facts.push(`VAI TRONG BÀI (duy nhất, mục của quán phải xây quanh vai này): ${p.role.label}${p.role.reason ? `. Căn cứ: ${p.role.reason}` : ''}`);
      if (p.role.bestFor) facts.push(`HỢP NHẤT KHI: ${p.role.bestFor}`);
    }
    return { tag: 'quán', description: `${p.name} (hạng ${p.rank})${p.role ? `: ${p.role.label}` : ''}`, sourceRefs: [p.rank], facts, inTopSites: p.rank <= 3 };
  });
  const eligible = data.candidates.filter((p) => !p.excludedReason);
  topics.push({
    tag: 'cách xếp hạng',
    description: 'Cách tool chọn và xếp hạng quán',
    sourceRefs: [],
    facts: [
      `Tìm "${data.query}" trên Google Maps, gom ${data.candidates.length} quán, giữ ${eligible.length} quán đúng món, đúng khu vực, còn mở cửa và có từ ${data.minReviews} đánh giá trở lên.`,
      `Xếp hạng theo hai thứ cùng lúc: số sao và số lượt đánh giá. Quán càng nhiều lượt thì phần sao vượt mức chung càng được tính nặng: quán giữ được 4,5 sao sau hàng nghìn lượt đứng trên quán 4,1 sao cùng số lượt, và trên quán 5 sao mới có vài lượt, vì giữ sao cao qua nhiều năm đông khách mới chứng tỏ quán ổn định${data.minRating ? `; quán dưới ${data.minRating} sao bị loại` : ''}. Không dùng thuật ngữ thống kê khi viết mục này.`,
      `Chọn ${featured.length} quán điểm cao nhất vào bài. Người viết tổng hợp từ đánh giá công khai, chỉ kể trải nghiệm cá nhân ở quán có ghi chú của người đặt bài.`,
    ],
    inTopSites: false,
  });
  const names = featured.map((p) => p.name);
  const notes: ResearchNotes = {
    keyword,
    searchIntent: 'local',
    intentExplanation: `Người tìm "${keyword}" muốn biết nên ăn ${data.dish} ở quán nào tại ${data.area}, kèm địa chỉ và lý do chọn.`,
    summary: `${featured.length} quán ${data.dish} ở ${data.area} được chọn từ ${data.candidates.length} quán trên Google Maps theo sao và số đánh giá; mỗi quán có địa chỉ, sao, số đánh giá, giá, giờ mở, ý khen chê rút từ đánh giá.`,
    perSource: [],
    keyFacts: [
      `${featured.length} quán được đưa vào bài, xếp theo điểm kết hợp sao và số đánh giá.`,
      ...featured.map((p) => `Hạng ${p.rank}: ${p.name}, ${ratingLine(p)}, ${p.address}`),
    ],
    numbersAndNames: featured.map((p) => `${p.name}: ${p.rating.toFixed(1)} sao, ${p.reviews} đánh giá${p.price ? `, giá ${p.price}` : ''}`),
    disagreements: [],
    commonSubtopics: ['Địa chỉ và link Google Maps', 'Sao và số đánh giá', 'Mức giá', 'Giờ mở cửa', 'Món nên gọi', 'Quán nào hợp ai'],
    gaps: [],
    // Chỉ gợi câu hỏi mà dữ liệu trả lời được: giá chỉ khi có quán ghi mức giá
    peopleAlsoAsk: [`${data.dish} ${data.area} quán nào ngon?`, ...(featured.some((p) => p.price) ? [`${data.dish} ${data.area} giá bao nhiêu?`] : []), ...(featured.some((p) => p.openingHours) ? [`Quán ${data.dish} ở ${data.area} mở cửa giờ nào?`] : []), `Nên chọn quán ${data.dish} nào ở ${data.area} cho lần đầu?`],
    secondaryKeywords: [`quán ${data.dish} ${data.area}`, `${data.dish} ${data.area} ngon`, `địa chỉ ${data.dish} ${data.area}`, `${data.dish} ${data.area} giá`, `ăn ${data.dish} ở ${data.area}`],
    topics,
    topSites: [],
    comparisons: [{ topic: `So sánh nhanh ${featured.length} quán`, items: names, criteria: ['sao', 'số đánh giá', ...(featured.some((p) => p.price) ? ['giá'] : []), ...(featured.some((p) => p.openingHours) ? ['giờ mở'] : []), 'đặc trưng', 'hợp với'], sourceRefs: [] }],
    similarItems: [],
    roundup: { dish: data.dish, area: data.area, featured: featured.map((p) => ({ rank: p.rank, name: p.name, address: p.address, rating: p.rating, reviews: p.reviews, price: p.price, hours: p.openingHours, phone: p.phone, website: p.website, userNote: p.userNote, role: p.role?.label ?? '', bestFor: p.role?.bestFor ?? '' })) },
    totalWords: 0,
  };
  notes.totalWords = [...notes.keyFacts, ...notes.numbersAndNames, ...topics.flatMap((t) => t.facts), notes.summary].reduce((n, t) => n + wordCount(t), 0);
  void options;
  return notes;
}

const INFO_LINE_RE = /^\s*(\*\*)?(Địa chỉ|Đánh giá|Google Maps|Giờ mở cửa|Liên hệ|Điện thoại|Website)(\*\*)?\s*:/i;
const MAPS_LINK_RE = /\[[^\]]*\]\((?:https?:\/\/)?(?:www\.)?(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)[^)]*\)/gi;

function isInjectedLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('![') || INFO_LINE_RE.test(t);
}

/**
 * Bỏ những gì tool chèn hoặc model tự bịa: dòng ảnh, dòng địa chỉ và đánh giá, link Google Maps trong câu.
 * Dùng trước khi chèn lại từ dữ liệu thật, và khi đo trùng lặp, quét AI.
 */
export function stripInjectedLines(md: string): string {
  return md
    .split('\n')
    .filter((l) => !isInjectedLine(l))
    .map((l) => l.replace(MAPS_LINK_RE, '').replace(/\*\*\s*\*\*/g, '').replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const GENERIC_NAME_WORDS = new Set(['quán', 'tiệm', 'nhà', 'hàng', 'ăn', 'uống', 'hủ', 'tiếu', 'tíu', 'mì', 'bún', 'phở', 'cơm', 'bánh', 'canh', 'cháo', 'lẩu', 'nướng', 'chay', 'restaurant', 'cafe', 'coffee', 'và', 'the']);
const STRUCTURAL_HEADING_RE = /so sánh|hợp ai|hợp với|xếp hạng|câu hỏi|tóm tắt|trước khi|cách (tôi|mình|chúng tôi) chọn/i;

/** Phần đặc trưng của tên quán, bỏ từ chung và tên món: "Quán Hủ Tiếu Sa Đéc" → "sa đéc", "Hủ Tiếu Nam Vang Ông Giáo" → "nam vang ông giáo". */
export function distinctiveName(name: string, dish = ''): string {
  const dishWords = new Set(normText(dish).split(' ').filter(Boolean));
  const words = normText(name)
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !GENERIC_NAME_WORDS.has(w) && !dishWords.has(w));
  return words.join(' ').trim();
}

/**
 * Heading có phải của quán này không: khớp đủ tên, hoặc khớp phần đặc trưng của tên (bỏ "quán", tên món);
 * không bao giờ nhận các mục cấu trúc (so sánh, hợp ai, xếp hạng). Khớp lỏng kiểu "quán hủ tiếu" từng gán nhầm
 * quán vào mục "So sánh nhanh 6 quán hủ tiếu", nên phần đặc trưng phải dài từ 3 ký tự.
 */
export function headingMatches(heading: string, name: string, dish = ''): boolean {
  if (STRUCTURAL_HEADING_RE.test(heading)) return false;
  const h = normText(heading).replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ');
  const n = normText(name).replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (n && h.includes(n)) return true;
  const d = distinctiveName(name, dish);
  if (d.length >= 3 && h.includes(d)) return true;
  // Model hay rút gọn tên trong heading ("1. Ông Giáo, mở từ 5 giờ"): thử hai từ đặc trưng cuối hoặc đầu
  const w = d.split(' ');
  if (w.length < 3) return false;
  const tail = w.slice(-2).join(' ');
  const head = w.slice(0, 2).join(' ');
  return (tail.length >= 5 && h.includes(tail)) || (head.length >= 5 && h.includes(head));
}

export function placeInfoBlock(p: PlaceInfo): string {
  const branches = p.branches.length > 1 ? ` (còn ${p.branches.length - 1} chi nhánh: ${p.branches.slice(1).join('; ')})` : '';
  const lines = [`**Địa chỉ:** ${p.address}${branches} · **[📍 Mở Google Maps](${placeMapsUrl(p)})**`];
  if (p.openingHours) lines.push(`**Giờ mở cửa:** ${p.openingHours}`);
  const contact: string[] = [];
  if (p.phone) contact.push(p.phone);
  if (p.website) contact.push(`[Website](${p.website})`);
  if (contact.length) lines.push(`**Liên hệ:** ${contact.join(' · ')}`);
  const extra = [`**Đánh giá:** ${p.rating.toFixed(1)}/5 (${p.reviews} lượt)`];
  if (p.price) extra.push(`giá ${p.price}`);
  lines.push(extra.join(' · '));
  return lines.join('  \n');
}

function fallbackBody(p: PlaceInfo, dish: string): string {
  const s = p.summary;
  const parts = [`${p.name} là quán ${dish} có ${p.reviews} đánh giá trên Google Maps với mức ${p.rating.toFixed(1)} sao.`];
  if (s?.signature.length) parts.push(`Nhiều người nhắc tới ${s.signature.join(', ')}.`);
  if (s?.praised.length) parts.push(`Điểm hay được khen là ${s.praised.join(', ')}.`);
  if (s?.complained.length) parts.push(`Điểm bị chê là ${s.complained.join(', ')}.`);
  if (s?.bestFor.length) parts.push(`Hợp với ${s.bestFor.join(', ')}.`);
  if (p.userNote) parts.push(p.userNote);
  return parts.join(' ');
}

/**
 * Sau mỗi lượt model viết hoặc sửa: mỗi quán được chọn có đúng một mục H2, đầu mục là ảnh (nếu có), địa chỉ kèm link
 * Google Maps và dòng sao, giá, giờ. Model có tự thêm địa chỉ hay link thì bỏ đi để không sai lệch.
 */
export function enforcePlaceSections(article: Article, data: PlacesData): Article {
  const featured = featuredPlaces(data);
  const sections = article.sections.map((s) => ({ ...s }));
  const images: ArticleImage[] = article.images.filter((im) => !im.src);
  let lastPlaceIdx = -1;
  const taken = new Set<number>();
  for (const p of featured) {
    let idx = sections.findIndex((s, i) => s.level === 2 && !taken.has(i) && headingMatches(s.heading, p.name, data.dish));
    if (idx < 0) {
      const insertAt = lastPlaceIdx >= 0 ? lastPlaceIdx + 1 : Math.min(1, sections.length);
      sections.splice(insertAt, 0, { heading: `${p.rank}. ${p.name}`, level: 2, body: fallbackBody(p, data.dish) });
      idx = insertAt;
    }
    const body = stripInjectedLines(sections[idx]!.body);
    const photo = p.photoFile ? `![${p.name} ở ${data.area}](${p.photoFile})\n\n` : '';
    sections[idx]!.body = `${photo}${placeInfoBlock(p)}\n\n${body}`.trim();
    if (p.photoFile) images.push({ position: `mục "${sections[idx]!.heading}"`, query: '', alt: `${p.name} ở ${data.area}`, src: p.photoFile });
    taken.add(idx);
    lastPlaceIdx = idx;
  }
  const title = roundupTitle(featured.length, data.dish, data.area);
  return moveRankingSectionLast({ ...article, title, h1: title, sections, images });
}

const RANKING_HEADING_RE = /xếp hạng|cách (tôi|mình|chúng tôi) (chọn|xếp|lọc)|tiêu chí (chọn|xếp)/i;

/** Tiêu đề chuẩn của bài tổng hợp: "Top 6 Quán Hủ Tiếu Phan Rang Được Đánh Giá Cao". */
export function roundupTitle(count: number, dish: string, area: string): string {
  return titleCaseWords(`Top ${count} quán ${dish} ${area} được đánh giá cao`);
}

/** Mục "cách xếp hạng" luôn nằm cuối các mục, sau các quán và mục "hợp ai"; đầu bài chỉ nói về quán. */
export function moveRankingSectionLast(article: Article): Article {
  const ranking = article.sections.filter((s) => s.level === 2 && RANKING_HEADING_RE.test(s.heading));
  if (!ranking.length) return article;
  const rest = article.sections.filter((s) => !ranking.includes(s));
  return { ...article, sections: [...rest, ...ranking] };
}

/** Danh sách quán có cấu trúc cho file JSON của site-autopilot. */
export function placesForExport(data: PlacesData): Record<string, unknown>[] {
  return featuredPlaces(data).map((p) => ({
    rank: p.rank,
    name: p.name,
    address: p.address,
    branches: p.branches,
    rating: p.rating,
    reviews: p.reviews,
    price: p.price,
    hours: p.openingHours,
    phone: p.phone,
    type: p.type,
    lat: p.lat,
    lng: p.lng,
    mapsUrl: placeMapsUrl(p),
    website: p.website,
    photo: p.photoFile,
    praised: p.summary?.praised ?? [],
    complained: p.summary?.complained ?? [],
    signature: p.summary?.signature ?? [],
    bestFor: p.summary?.bestFor ?? [],
    userNote: p.userNote,
  }));
}

/** JSON-LD ItemList các quán, chèn vào file HTML để Google hiểu bài là danh sách địa điểm. */
export function placesJsonLd(article: Article, data: PlacesData): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: article.h1 || article.title,
    description: article.metaDescription,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    numberOfItems: featuredPlaces(data).length,
    itemListElement: featuredPlaces(data).map((p) => ({
      '@type': 'ListItem',
      position: p.rank,
      item: {
        '@type': 'Restaurant',
        name: p.name,
        address: { '@type': 'PostalAddress', streetAddress: p.address, addressCountry: 'VN' },
        ...(p.lat && p.lng ? { geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng } } : {}),
        ...(p.rating && p.reviews ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating, reviewCount: p.reviews, bestRating: 5 } } : {}),
        ...(p.price ? { priceRange: p.price } : {}),
        ...(p.photoFile ? { image: p.photoFile } : {}),
        ...(p.website ? { url: p.website } : {}),
        ...(p.phone ? { telephone: p.phone } : {}),
        ...(p.openingHours ? { openingHours: p.openingHours } : {}),
        hasMap: placeMapsUrl(p),
        servesCuisine: data.dish,
      },
    })),
  };
}

export function photoFileName(p: PlaceInfo, contentType: string): string {
  const ext = /png/i.test(contentType) ? 'png' : /webp/i.test(contentType) ? 'webp' : 'jpg';
  return `photos/${p.rank}-${slugify(p.name, 50)}.${ext}`;
}

/* ------------------------------------------------------------------ */
/*  Vai riêng của từng quán trong bài                                    */
/* ------------------------------------------------------------------ */

export function placeForRole(p: PlaceInfo): PlaceForRole {
  return { index: p.rank, name: p.name, rating: p.rating, reviews: p.reviews, price: p.price, openingHours: p.openingHours, type: p.type, summary: p.summary, userNote: p.userNote };
}

/** Phút mở và đóng đầu tiên tìm được trong chuỗi giờ; đóng qua nửa đêm thì cộng 24 giờ. */
function hoursRange(s: string): { open: number; close: number } | null {
  const m = [...s.matchAll(/(\d{1,2}):(\d{2})/g)].map((x) => Number(x[1]) * 60 + Number(x[2]));
  if (m.length < 2) return null;
  const open = m[0]!;
  let close = m[m.length - 1]!;
  if (close <= open) close += 24 * 60;
  return { open, close };
}
const hhmm = (min: number) => `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fmtNum = (n: number) => n.toLocaleString('vi-VN');

/** Số đầu tiên trong chuỗi giá (nghìn đồng) để so quán nào mềm hơn; "bình dân" xem như 50. */
function priceLevel(price: string): number | null {
  if (!price) return null;
  if (/bình dân/i.test(price)) return 50;
  if (/tầm trung/i.test(price)) return 150;
  if (/khá cao/i.test(price)) return 300;
  if (/cao cấp/i.test(price)) return 600;
  const m = price.replace(/\./g, '').match(/\d+/);
  return m ? Number(m[0]) / 1000 : null;
}

type RoleCandidate = { rank: number; role: PlaceRole };

/** Ứng viên vai theo ưu tiên: đông khách nhất, sao cao nhất, giá mềm nhất, mở sớm nhất, mở khuya nhất; chỉ khi quán đó thật sự nổi trội. */
function roleCandidates(featured: PlaceInfo[]): RoleCandidate[] {
  const out: RoleCandidate[] = [];
  const n = featured.length;
  if (n < 2) return out;
  const byReviews = [...featured].sort((a, b) => b.reviews - a.reviews);
  if (byReviews[0]!.reviews > byReviews[1]!.reviews) out.push({ rank: byReviews[0]!.rank, role: { label: `lâu năm, đông khách nhất với ${fmtNum(byReviews[0]!.reviews)} lượt đánh giá`, reason: `${byReviews[0]!.name} có ${fmtNum(byReviews[0]!.reviews)} lượt đánh giá, nhiều nhất trong ${n} quán, và vẫn giữ ${byReviews[0]!.rating.toFixed(1)} sao.`, bestFor: 'muốn quán đã được nhiều người kiểm chứng' } });
  const byRating = [...featured].sort((a, b) => b.rating - a.rating || b.reviews - a.reviews);
  if (byRating[0]!.rating > byRating[1]!.rating) out.push({ rank: byRating[0]!.rank, role: { label: `sao cao nhất, ${byRating[0]!.rating.toFixed(1)} sao`, reason: `${byRating[0]!.name} đạt ${byRating[0]!.rating.toFixed(1)} sao sau ${fmtNum(byRating[0]!.reviews)} lượt, cao nhất danh sách.`, bestFor: 'muốn tô ngon nhất dù phải chờ' } });
  const priced = featured.map((p) => ({ p, lv: priceLevel(p.price) })).filter((x): x is { p: PlaceInfo; lv: number } => x.lv !== null).sort((a, b) => a.lv - b.lv);
  if (priced.length >= 2 && priced[0]!.lv < priced[1]!.lv) out.push({ rank: priced[0]!.p.rank, role: { label: 'giá mềm nhất trong danh sách', reason: `${priced[0]!.p.name} ghi mức giá ${priced[0]!.p.price}, thấp nhất trong các quán có ghi giá.`, bestFor: 'ngân sách thấp' } });
  const hours = featured.map((p) => ({ p, h: hoursRange(p.openingHours) })).filter((x): x is { p: PlaceInfo; h: { open: number; close: number } } => x.h !== null);
  const early = [...hours].sort((a, b) => a.h.open - b.h.open);
  if (early.length >= 2 && early[0]!.h.open < early[1]!.h.open) out.push({ rank: early[0]!.p.rank, role: { label: `mở sớm nhất, từ ${hhmm(early[0]!.h.open)}`, reason: `${early[0]!.p.name} mở từ ${hhmm(early[0]!.h.open)}, sớm nhất trong các quán có ghi giờ.`, bestFor: `ăn sáng sớm trước ${hhmm(early[0]!.h.open + 60)}` } });
  const late = [...hours].sort((a, b) => b.h.close - a.h.close);
  if (late.length >= 2 && late[0]!.h.close > late[1]!.h.close && late[0]!.h.close >= 21 * 60) out.push({ rank: late[0]!.p.rank, role: { label: `mở khuya nhất, tới ${hhmm(late[0]!.h.close)}`, reason: `${late[0]!.p.name} mở tới ${hhmm(late[0]!.h.close)}, muộn nhất trong các quán có ghi giờ.`, bestFor: 'ăn khuya' } });
  return out;
}

const roleKey = (s: string) => normText(s).replace(/[^\p{L}\p{N} ]/gu, '').trim();

/** Vai riêng cho từng quán bằng quy tắc: ưu tiên điểm nổi trội có số liệu, rồi món đặc trưng, ý khen, cuối cùng là vị trí hạng. Không hai quán trùng vai hay trùng tình huống. */
export function heuristicRoles(featured: PlaceInfo[]): Map<number, PlaceRole> {
  const out = new Map<number, PlaceRole>();
  const usedLabel = new Set<string>();
  const usedBest = new Set<string>();
  const take = (rank: number, role: PlaceRole) => {
    if (out.has(rank) || usedLabel.has(roleKey(role.label))) return false;
    let bestFor = role.bestFor;
    if (usedBest.has(roleKey(bestFor))) bestFor = `${bestFor} ở khu ${featured.find((p) => p.rank === rank)?.address.split(',').slice(-2, -1)[0]?.trim() ?? `hạng ${rank}`}`;
    out.set(rank, { ...role, bestFor });
    usedLabel.add(roleKey(role.label));
    usedBest.add(roleKey(bestFor));
    return true;
  };
  for (const c of roleCandidates(featured)) take(c.rank, c.role);
  for (const p of featured) {
    if (out.has(p.rank)) continue;
    const s = p.summary;
    const sig = s?.signature.find((x) => !usedLabel.has(roleKey(`nổi bật với ${x}`)));
    if (sig && take(p.rank, { label: `nổi bật với ${sig}`, reason: `${sig} là điều được nhắc nhiều nhất trong đánh giá của ${p.name}.`, bestFor: s?.bestFor[0] || `muốn thử ${sig}` })) continue;
    const praise = s?.praised.find((x) => !usedLabel.has(roleKey(`được khen ${x}`)));
    if (praise && take(p.rank, { label: `được khen ${praise}`, reason: `Nhiều đánh giá của ${p.name} nhắc ${praise}.`, bestFor: s?.bestFor[0] || `muốn ${praise}` })) continue;
    take(p.rank, { label: `lựa chọn ổn định ở hạng ${p.rank}, ${p.rating.toFixed(1)} sao sau ${fmtNum(p.reviews)} lượt`, reason: `${p.name} giữ ${p.rating.toFixed(1)} sao qua ${fmtNum(p.reviews)} lượt đánh giá.`, bestFor: `quán đầu bảng quá đông, cần chỗ thay thế gần ${p.address.split(',')[0]?.trim() || 'đó'}` });
  }
  return out;
}

/**
 * Gắn vai model trả về vào từng quán; quán thiếu vai hoặc trùng vai (label hay bestFor) với quán khác thì lấy vai từ quy tắc.
 * Trả về số quán phải dùng quy tắc.
 */
export function applyPlaceRoles(featured: PlaceInfo[], fromLlm: { index: number; role: PlaceRole }[]): number {
  const rules = heuristicRoles(featured);
  const seenLabel = new Set<string>();
  const seenBest = new Set<string>();
  let fromRules = 0;
  for (const p of featured) {
    const got = fromLlm.find((r) => r.index === p.rank)?.role;
    const ok = got && got.label.trim() && wordCount(got.label) <= 14 && !seenLabel.has(roleKey(got.label)) && (!got.bestFor.trim() || !seenBest.has(roleKey(got.bestFor)));
    let role = ok ? { label: got.label.trim().replace(/[.。]$/, ''), reason: got.reason.trim(), bestFor: got.bestFor.trim() } : null;
    if (!role) {
      role = rules.get(p.rank) ?? { label: `hạng ${p.rank} trong danh sách`, reason: '', bestFor: '' };
      if (seenLabel.has(roleKey(role.label))) role = { ...role, label: `${role.label} (${distinctiveName(p.name) || p.name})` };
      fromRules++;
    }
    p.role = role;
    seenLabel.add(roleKey(role.label));
    if (role.bestFor) seenBest.add(roleKey(role.bestFor));
  }
  return fromRules;
}
