import type { ImageProvider, StockPhoto } from './types.js';
import { httpJson, downloadBuffer } from '../core/http.js';
import { AppError, TransientError } from '../core/errors.js';

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  alt: string;
  src: { original: string; large2x: string; large: string; medium: string; landscape: string };
}

/**
 * Pexels API: header Authorization = API key, 200 request/giờ và 20.000/tháng mặc định.
 * Ảnh được tải về máy và chuyển sang WebP, không hotlink.
 */
export class PexelsProvider implements ImageProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, opts: { perPage?: number; orientation?: 'landscape' | 'portrait' | 'square'; locale?: string } = {}): Promise<StockPhoto[]> {
    if (!this.apiKey) throw new AppError('Thiếu PEXELS_API_KEY');
    const params = new URLSearchParams({
      query,
      per_page: String(opts.perPage ?? 15),
      orientation: opts.orientation ?? 'landscape',
      size: 'medium',
    });
    if (opts.locale) params.set('locale', opts.locale);
    const { status, data } = await httpJson<{ photos?: PexelsPhoto[]; error?: string }>(`https://api.pexels.com/v1/search?${params}`, {
      headers: { Authorization: this.apiKey },
    });
    if (status === 401 || status === 403) throw new AppError('Pexels từ chối API key (401/403). Kiểm tra PEXELS_API_KEY.');
    if (status === 429) throw new TransientError('Pexels giới hạn tần suất (429), sẽ thử lại sau');
    if (status !== 200) throw new TransientError(`Pexels trả về HTTP ${status}`);
    return (data.photos ?? []).map((p) => ({
      provider: 'pexels',
      id: String(p.id),
      width: p.width,
      height: p.height,
      downloadUrl: p.src.large2x || p.src.large || p.src.original,
      pageUrl: p.url,
      photographer: p.photographer,
      photographerUrl: p.photographer_url,
      alt: p.alt ?? '',
    }));
  }

  async download(photo: StockPhoto): Promise<Buffer> {
    return downloadBuffer(photo.downloadUrl);
  }
}
