import sharp from 'sharp';
import type { PlacePhoto, PlacesClient } from './types.js';
import { httpJson, httpRequest, downloadBuffer } from '../core/http.js';
import { AppError, TransientError } from '../core/errors.js';

const API = 'https://places.googleapis.com/v1';

/**
 * Google Places API (New). Cần API key Google Maps Platform đã bật "Places API (New)" và có tài khoản thanh toán
 * (miễn phí trong hạn mức hàng tháng). Chỉ nên dùng để lấy ảnh của chính doanh nghiệp bạn quản lý.
 */
export class GooglePlacesClient implements PlacesClient {
  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new AppError('Thiếu Google Maps Platform API key');
  }

  private headers(fieldMask: string): Record<string, string> {
    return { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': fieldMask };
  }

  async resolvePlace(input: string): Promise<{ id: string; displayName: string; address: string }> {
    let text = input.trim();
    if (!text) throw new AppError('Nhập Place ID, link Google Maps hoặc tên quán kèm địa chỉ');

    // Link rút gọn share.google / maps.app.goo.gl: theo chuyển hướng để lấy URL đầy đủ
    if (/^https?:\/\/(share\.google|maps\.app\.goo\.gl|goo\.gl)\//i.test(text)) text = await followRedirects(text);

    const placeIdInUrl = text.match(/(?:place_id|query_place_id)[=:]([A-Za-z0-9_-]{10,})/);
    if (placeIdInUrl) return this.details(placeIdInUrl[1] as string);
    if (/^ChIJ[A-Za-z0-9_-]{10,}$/.test(text) || /^[A-Za-z0-9_-]{20,}$/.test(text) && !text.includes('/')) return this.details(text);

    // URL maps đầy đủ: /maps/place/<tên>/@lat,lng,...
    let query = text;
    let bias: { lat: number; lng: number } | undefined;
    const m = text.match(/\/maps\/place\/([^/]+)\/(?:@(-?\d+\.\d+),(-?\d+\.\d+))?/);
    if (m) {
      query = decodeURIComponent((m[1] as string).replace(/\+/g, ' '));
      if (m[2] && m[3]) bias = { lat: Number(m[2]), lng: Number(m[3]) };
    } else if (/^https?:\/\//i.test(text)) {
      const q = text.match(/[?&]q=([^&]+)/) ?? text.match(/[?&]query=([^&]+)/);
      if (q) query = decodeURIComponent((q[1] as string).replace(/\+/g, ' '));
      else throw new AppError('Không đọc được tên quán từ link. Hãy dán Place ID hoặc nhập "tên quán, địa chỉ".');
    }

    const body: Record<string, unknown> = { textQuery: query, pageSize: 3 };
    if (bias) body.locationBias = { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 500 } };
    const { status, data } = await httpJson<{ places?: { id: string; displayName?: { text: string }; formattedAddress?: string }[]; error?: { message?: string } }>(`${API}/places:searchText`, {
      method: 'POST',
      headers: this.headers('places.id,places.displayName,places.formattedAddress'),
      body: JSON.stringify(body),
    });
    if (status !== 200) throw new AppError(`Google Places tìm kiếm lỗi (HTTP ${status}): ${data.error?.message ?? ''}`);
    const first = data.places?.[0];
    if (!first) throw new AppError(`Không tìm thấy địa điểm cho "${query}"`);
    return { id: first.id, displayName: first.displayName?.text ?? '', address: first.formattedAddress ?? '' };
  }

  private async details(id: string): Promise<{ id: string; displayName: string; address: string }> {
    const { status, data } = await httpJson<{ id?: string; displayName?: { text: string }; formattedAddress?: string; error?: { message?: string } }>(`${API}/places/${encodeURIComponent(id)}`, {
      headers: this.headers('id,displayName,formattedAddress'),
    });
    if (status !== 200 || !data.id) throw new AppError(`Google Places không trả về địa điểm ${id} (HTTP ${status}): ${data.error?.message ?? ''}`);
    return { id: data.id, displayName: data.displayName?.text ?? '', address: data.formattedAddress ?? '' };
  }

  async listPhotos(placeId: string): Promise<PlacePhoto[]> {
    const { status, data } = await httpJson<{ photos?: { name: string; widthPx: number; heightPx: number; authorAttributions?: { displayName?: string; uri?: string }[] }[]; error?: { message?: string } }>(
      `${API}/places/${encodeURIComponent(placeId)}`,
      { headers: this.headers('id,photos') },
    );
    if (status !== 200) throw new AppError(`Google Places lấy ảnh lỗi (HTTP ${status}): ${data.error?.message ?? ''}`);
    return (data.photos ?? []).map((p) => ({
      name: p.name,
      widthPx: p.widthPx,
      heightPx: p.heightPx,
      authorName: p.authorAttributions?.[0]?.displayName ?? '',
      authorUri: p.authorAttributions?.[0]?.uri ?? '',
    }));
  }

  async downloadPhoto(name: string, maxWidthPx = 1600): Promise<Buffer> {
    // Endpoint media chuyển hướng tới ảnh thật; skipHttpRedirect=true để lấy URL rồi tải
    const { status, data } = await httpJson<{ photoUri?: string; error?: { message?: string } }>(`${API}/${name}/media?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true&key=${encodeURIComponent(this.apiKey)}`);
    if (status !== 200 || !data.photoUri) throw new TransientError(`Không lấy được ảnh ${name} (HTTP ${status}): ${data.error?.message ?? ''}`);
    return downloadBuffer(data.photoUri);
  }
}

async function followRedirects(url: string, max = 5): Promise<string> {
  let current = url;
  for (let i = 0; i < max; i++) {
    const res = await httpRequest(current, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' }, timeoutMs: 15_000 });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    // Trang trung gian của share.google có thể chứa link maps trong HTML
    const inHtml = res.text.match(/https:\/\/www\.google\.com\/maps\/place\/[^"'\s<]+/);
    if (inHtml) return decodeURIComponent(inHtml[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&'));
    return current;
  }
  return current;
}

/** Giả lập cho MOCK_MODE: 4 ảnh gradient có chữ, 3 ảnh "của chủ", 1 ảnh "của khách". */
export class MockPlacesClient implements PlacesClient {
  async resolvePlace(input: string) {
    return { id: 'mock-place', displayName: input.replace(/^https?:\/\/\S+$/, 'Quán mô phỏng'), address: '89 Văn Cao, Phan Rang' };
  }
  async listPhotos(): Promise<PlacePhoto[]> {
    return [1, 2, 3, 4].map((i) => ({ name: `places/mock/photos/${i}`, widthPx: 1600, heightPx: 1200, authorName: i === 4 ? 'Khách Nam' : 'Quán mô phỏng', authorUri: '' }));
  }
  async downloadPhoto(name: string): Promise<Buffer> {
    const hue = (name.length * 37) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="hsl(${hue},55%,45%)"/><text x="80" y="620" font-family="Arial" font-size="72" fill="#fff">${name}</text></svg>`;
    return sharp(Buffer.from(svg)).jpeg().toBuffer();
  }
}
