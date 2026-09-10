import type { IndexNowClient } from './types.js';
import { httpRequest } from '../core/http.js';

/**
 * IndexNow: gửi danh sách URL cho Bing, Yandex, Naver, Seznam, Yep cùng lúc.
 * File khóa phải nằm tại https://host/<key>.txt và chứa đúng khóa.
 */
export class IndexNowHttpClient implements IndexNowClient {
  async submit(host: string, key: string, urls: string[]): Promise<{ status: number }> {
    if (urls.length === 0) return { status: 200 };
    const res = await httpRequest('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList: urls.slice(0, 10_000) }),
    });
    return { status: res.status };
  }
}

export const INDEXNOW_STATUS_TEXT: Record<number, string> = {
  200: 'Đã nhận',
  202: 'Đã nhận, đang xác thực khóa',
  400: 'Sai định dạng',
  403: 'Khóa không hợp lệ hoặc chưa truy cập được file khóa',
  422: 'URL không thuộc host hoặc khóa không khớp',
  429: 'Gửi quá nhiều',
};
