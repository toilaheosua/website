import type { MapsProvider, RawPlace } from './types.js';
import type { PlaceReview } from '../core/types.js';
import { AppError, ConfigError } from '../core/errors.js';
import { getJson } from './search.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('maps');

/**
 * Google Maps qua SerpAPI: engine google_maps (danh sách quán, 20 quán một trang, phân trang bằng start)
 * và engine google_maps_reviews (đánh giá của một quán theo data_id). Không cào trang Google Maps trực tiếp.
 */
export class SerpApiMapsProvider implements MapsProvider {
  readonly id = 'serpapi' as const;

  constructor(
    private readonly apiKey: string,
    private readonly opts: { googleDomain: string; country: string; language: string },
  ) {
    if (!apiKey) throw new ConfigError('Tổng hợp quán cần SerpAPI key (engine Google Maps). Vào Cài đặt → Khóa API để nhập.');
  }

  private base(extra: Record<string, string>): URLSearchParams {
    return new URLSearchParams({ api_key: this.apiKey, hl: this.opts.language || 'vi', gl: this.opts.country || 'vn', google_domain: this.opts.googleDomain || 'google.com.vn', ...extra });
  }

  async geocode(area: string): Promise<{ lat: number; lng: number } | null> {
    const params = this.base({ engine: 'google_maps', type: 'search', q: area });
    const json = await getJson(`https://serpapi.com/search.json?${params.toString()}`, 'SerpAPI Google Maps');
    if (typeof json.error === 'string' && json.error) throw new AppError(`SerpAPI Google Maps: ${json.error}`);
    const single = json.place_results as { gps_coordinates?: { latitude?: number; longitude?: number } } | undefined;
    const g = single?.gps_coordinates ?? (json.local_results as { gps_coordinates?: { latitude?: number; longitude?: number } }[] | undefined)?.[0]?.gps_coordinates;
    if (g && typeof g.latitude === 'number' && typeof g.longitude === 'number') {
      log.info(`Tâm khu vực "${area}": ${g.latitude}, ${g.longitude}`);
      return { lat: g.latitude, lng: g.longitude };
    }
    log.warn(`Không tìm được tọa độ cho "${area}", tìm quán không kèm tọa độ`);
    return null;
  }

  async searchPlaces(query: string, o: { page: number; center: { lat: number; lng: number } | null; language: string }): Promise<RawPlace[]> {
    const params = this.base({ engine: 'google_maps', type: 'search', q: query, start: String(o.page * 20) });
    if (o.center) params.set('ll', `@${o.center.lat},${o.center.lng},13z`);
    const json = await getJson(`https://serpapi.com/search.json?${params.toString()}`, 'SerpAPI Google Maps');
    if (typeof json.error === 'string' && json.error) {
      // "Google hasn't returned any results" là hết trang, không phải lỗi
      if (/hasn't returned any results|no results/i.test(json.error)) return [];
      throw new AppError(`SerpAPI Google Maps: ${json.error}`);
    }
    const raw = (json.local_results as Record<string, unknown>[] | undefined) ?? [];
    const places = raw.map((r, i) => toRawPlace(r, o.page * 20 + i + 1));
    log.info(`Google Maps "${query}" trang ${o.page + 1}: ${places.length} quán`);
    return places;
  }

  async reviews(dataId: string, o: { language: string; count: number; placeId?: string }): Promise<PlaceReview[]> {
    // Thử theo data_id trước; không có kết quả thì thử theo place_id (SerpAPI nhận cả hai)
    const first = await this.reviewsBy({ data_id: dataId }, o);
    if (first.length || !o.placeId) return first;
    log.warn(`Đánh giá theo data_id ${dataId} trống, thử theo place_id ${o.placeId}`);
    return this.reviewsBy({ place_id: o.placeId }, o);
  }

  /**
   * SerpAPI trả đúng 8 đánh giá một trang và KHÔNG nhận tham số num ở trang đầu (HTTP 400);
   * cần nhiều hơn thì lật trang bằng next_page_token, mỗi trang một lượt tìm.
   */
  private async reviewsBy(id: Record<string, string>, o: { language: string; count: number }): Promise<PlaceReview[]> {
    const out: PlaceReview[] = [];
    let nextToken: string | null = null;
    const maxPages = Math.max(1, Math.min(3, Math.ceil(o.count / 8)));
    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ api_key: this.apiKey, engine: 'google_maps_reviews', ...id, hl: o.language || 'vi', sort_by: 'qualityScore' });
      if (nextToken) params.set('next_page_token', nextToken);
      const json = await getJson(`https://serpapi.com/search.json?${params.toString()}`, 'SerpAPI Google Maps Reviews');
      if (typeof json.error === 'string' && json.error) {
        if (/hasn't returned any results|no results/i.test(json.error)) break;
        throw new AppError(`SerpAPI Google Maps Reviews: ${json.error}`);
      }
      const raw = (json.reviews as Record<string, unknown>[] | undefined) ?? [];
      for (const r of raw) {
        const extracted = r.extracted_snippet as { original?: string; translated?: string } | undefined;
        const text = String(extracted?.original ?? extracted?.translated ?? r.snippet ?? '').trim();
        if (text) out.push({ rating: Number(r.rating ?? 0), date: String(r.iso_date ?? r.date ?? ''), text });
      }
      log.info(`Đánh giá ${JSON.stringify(id)} trang ${page + 1}: ${raw.length} trả về, ${out.length} có nội dung`);
      const pagination = json.serpapi_pagination as { next_page_token?: string } | undefined;
      nextToken = pagination?.next_page_token ?? null;
      if (!raw.length || !nextToken || out.length >= o.count) break;
    }
    return out;
  }

  async resolveUrl(url: string): Promise<string> {
    let cur = url.trim();
    for (let hop = 0; hop < 4; hop++) {
      if (!/goo\.gl\//i.test(cur) && !/^https?:\/\/g\.co\//i.test(cur)) return cur;
      try {
        const res = await fetch(cur, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'Mozilla/5.0 viet-content/1.0' } });
        const loc = res.headers.get('location');
        if (!loc) return cur;
        cur = new URL(loc, cur).toString();
      } catch (err) {
        log.warn(`Không mở được link rút gọn ${cur}: ${(err as Error).message}`);
        return cur;
      }
    }
    return cur;
  }

  async lookupPlace(ref: { placeId?: string; dataId?: string; name?: string; lat?: number | null; lng?: number | null }, o: { language: string }): Promise<RawPlace | null> {
    if (ref.placeId) {
      const params = this.base({ engine: 'google_maps', place_id: ref.placeId });
      const json = await getJson(`https://serpapi.com/search.json?${params.toString()}`, 'SerpAPI Google Maps');
      const pr = json.place_results as Record<string, unknown> | undefined;
      if (pr?.title) return toRawPlace(pr, 1);
      log.warn(`place_id ${ref.placeId} không trả về địa điểm${typeof json.error === 'string' ? `: ${json.error}` : ''}, thử theo tên`);
    }
    if (ref.dataId) {
      const params = this.base({ engine: 'google_maps', data: `!4m5!3m4!1s${ref.dataId}!8m2!3d${ref.lat ?? 0}!4d${ref.lng ?? 0}` });
      const json = await getJson(`https://serpapi.com/search.json?${params.toString()}`, 'SerpAPI Google Maps');
      const pr = json.place_results as Record<string, unknown> | undefined;
      if (pr?.title) return toRawPlace(pr, 1);
      log.warn(`data_id ${ref.dataId} không trả về địa điểm, thử theo tên`);
    }
    if (ref.name) {
      const list = await this.searchPlaces(ref.name, { page: 0, center: ref.lat && ref.lng ? { lat: ref.lat, lng: ref.lng } : null, language: o.language });
      const want = ref.name.toLowerCase();
      return list.find((p) => p.title.toLowerCase().includes(want) || want.includes(p.title.toLowerCase())) ?? list[0] ?? null;
    }
    return null;
  }

  async photos(dataId: string, o: { count: number; language: string }): Promise<string[]> {
    if (!dataId || o.count <= 0) return [];
    const params = new URLSearchParams({ api_key: this.apiKey, engine: 'google_maps_photos', data_id: dataId, hl: o.language || 'vi' });
    const json = await getJson(`https://serpapi.com/search.json?${params.toString()}`, 'SerpAPI Google Maps Photos');
    if (typeof json.error === 'string' && json.error) {
      if (/hasn't returned any results|no results/i.test(json.error)) return [];
      throw new AppError(`SerpAPI Google Maps Photos: ${json.error}`);
    }
    const raw = (json.photos as { image?: string; thumbnail?: string }[] | undefined) ?? [];
    const urls = raw.map((p) => p.image || p.thumbnail || '').filter(Boolean);
    log.info(`Ảnh ${dataId}: ${urls.length} trả về, lấy ${Math.min(o.count, urls.length)}`);
    return urls.slice(0, o.count);
  }

  async downloadPhoto(url: string): Promise<{ data: Buffer; contentType: string } | null> {
    if (!url) return null;
    // Ảnh Google trả về ở cỡ nhỏ (=w80-h106); xin bản lớn hơn trước, không được thì lấy bản gốc
    // Cỡ 800x600 đủ nét cho blog mà không lấn văn bản
    const larger = /=w\d+-h\d+/.test(url) ? url.replace(/=w\d+-h\d+[^&]*/, '=w800-h600-k-no') : url;
    for (const u of larger === url ? [url] : [larger, url]) {
      try {
        const res = await fetch(u, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) viet-content/1.0' } });
        if (!res.ok) continue;
        const type = res.headers.get('content-type') ?? 'image/jpeg';
        if (!type.startsWith('image/')) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 1000) continue;
        return { data: buf, contentType: type };
      } catch (err) {
        log.warn(`Không tải được ảnh ${u.slice(0, 80)}: ${(err as Error).message}`);
      }
    }
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}

function toRawPlace(r: Record<string, unknown>, position: number): RawPlace {
  const gps = r.gps_coordinates as { latitude?: number; longitude?: number } | undefined;
  const types = Array.isArray(r.types) ? (r.types as unknown[]).map(str).filter(Boolean) : [];
  return {
    position,
    title: str(r.title),
    placeId: str(r.place_id),
    dataId: str(r.data_id),
    rating: Number(r.rating ?? 0) || 0,
    reviews: Number(r.reviews ?? 0) || 0,
    price: str(r.price),
    type: str(r.type) || types[0] || '',
    types,
    address: str(r.address),
    openState: str(r.open_state),
    hours: str(r.hours),
    operatingHours: Object.fromEntries(Object.entries((r.operating_hours as Record<string, unknown> | undefined) ?? {}).map(([k, v]) => [k, str(v)])),
    phone: str(r.phone),
    website: str(r.website),
    description: str(r.description),
    thumbnail: str(r.serpapi_thumbnail) || str(r.thumbnail),
    lat: Number(gps?.latitude ?? 0) || 0,
    lng: Number(gps?.longitude ?? 0) || 0,
  };
}
