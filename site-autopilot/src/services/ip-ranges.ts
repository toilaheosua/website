import { FALLBACK_RANGES, type IpRanges } from '../generator/host-security.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('ip-ranges');
const CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^[0-9a-f:]+\/\d{1,3}$/i;

async function text(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

/** Tải dải IP Cloudflare và Googlebot mới nhất; lỗi thì dùng danh sách dự phòng và ghi log. */
export async function fetchIpRanges(opts: { mock?: boolean } = {}): Promise<IpRanges & { source: 'live' | 'fallback' }> {
  if (opts.mock) return { ...FALLBACK_RANGES, source: 'fallback' };
  try {
    const [v4, v6, gb] = await Promise.all([text('https://www.cloudflare.com/ips-v4'), text('https://www.cloudflare.com/ips-v6'), text('https://developers.google.com/search/apis/ipranges/googlebot.json')]);
    const cloudflare = [...v4.split(/\s+/), ...v6.split(/\s+/)].map((x) => x.trim()).filter((x) => CIDR.test(x));
    const parsed = JSON.parse(gb) as { prefixes?: { ipv4Prefix?: string; ipv6Prefix?: string }[] };
    const googlebot = (parsed.prefixes ?? []).map((p) => p.ipv4Prefix ?? p.ipv6Prefix ?? '').filter((x) => CIDR.test(x));
    if (cloudflare.length < 10 || googlebot.length < 5) throw new Error('danh sách quá ngắn');
    return { cloudflare, googlebot, source: 'live' };
  } catch (err) {
    log.warn('Không tải được dải IP mới, dùng danh sách dự phòng', { error: (err as Error).message });
    return { ...FALLBACK_RANGES, source: 'fallback' };
  }
}
