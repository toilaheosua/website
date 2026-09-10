import dns from 'node:dns/promises';
import type { HealthReport } from '../core/types.js';
import type { CloudflareClient } from '../services/types.js';
import { errorMessage } from '../core/util.js';
import { probeEdge, probeOrigin } from './probe.js';

/**
 * Kiểm tra sức khỏe một site: DNS đang qua Cloudflare, origin phục vụ đúng bản dựng, HTTPS qua Cloudflare,
 * zone active, SSL mode đúng, số rule WAF còn nguyên. Cloudflare 403 với client tự động không tính là lỗi nếu origin OK.
 */
export async function checkSiteHealth(input: { domain: string; serverIp?: string | null; zoneId: string | null; cloudflare: CloudflareClient | null; expectedSslMode?: string; skipNetwork?: boolean }): Promise<HealthReport> {
  const report: HealthReport = {
    checkedAt: new Date().toISOString(),
    ok: false,
    dnsProxied: null,
    httpStatus: null,
    httpsOk: false,
    responseMs: null,
    zoneStatus: null,
    sslMode: null,
    wafRules: null,
    message: '',
  };
  const problems: string[] = [];
  const notes: string[] = [];

  if (input.skipNetwork) {
    report.ok = true;
    report.message = 'Mock: bỏ qua kiểm tra mạng';
    return report;
  }

  try {
    const addrs = await dns.resolve4(input.domain);
    report.dnsProxied = addrs.some((a) => isCloudflareIp(a));
    if (!report.dnsProxied) problems.push(`DNS trỏ về ${addrs.join(', ')} chứ không qua Cloudflare`);
  } catch (err) {
    problems.push(`Không phân giải được DNS: ${errorMessage(err)}`);
  }

  let originOk = false;
  if (input.serverIp) {
    const origin = await probeOrigin(input.domain, input.serverIp);
    originOk = origin.ok && origin.hasMarker;
    if (!originOk) problems.push(origin.status === null ? `Origin không trả lời (${origin.error ?? ''})` : `Origin trả về ${origin.status}${origin.ok ? ' nhưng không phải bản dựng của hệ thống' : ''}`);
  }

  const edge = await probeEdge(input.domain);
  report.httpStatus = edge.status;
  report.responseMs = edge.ms;
  if (edge.ok && edge.hasMarker) report.httpsOk = true;
  else if (edge.status === 403 && originOk) {
    report.httpsOk = true;
    notes.push('Cloudflare 403 với client tự động (Bot Fight Mode), origin OK');
  } else if (edge.status === null) problems.push(`Không truy cập được HTTPS: ${edge.error ?? ''}`);
  else if (!edge.ok) problems.push(`HTTPS trả về ${edge.status}`);
  else problems.push('Trang chủ qua HTTPS không chứa bản dựng của hệ thống');

  if (input.cloudflare && input.zoneId) {
    try {
      const zone = await input.cloudflare.getZone(input.zoneId);
      report.zoneStatus = zone.status;
      if (zone.status !== 'active') problems.push(`Zone Cloudflare đang ${zone.status}`);
      const ssl = await input.cloudflare.getZoneSetting(input.zoneId, 'ssl');
      report.sslMode = String(ssl);
      if (input.expectedSslMode && ssl !== input.expectedSslMode) problems.push(`SSL mode là ${String(ssl)} thay vì ${input.expectedSslMode}`);
      const rules = await input.cloudflare.getPhaseRules(input.zoneId, 'http_request_firewall_custom');
      report.wafRules = rules.rules.length;
      if (rules.rules.length === 0) problems.push('Không còn rule WAF nào');
    } catch (err) {
      problems.push(`Không đọc được Cloudflare: ${errorMessage(err)}`);
    }
  }

  report.ok = problems.length === 0;
  report.message = report.ok ? (notes.length ? `OK (${notes.join('; ')})` : 'OK') : [...problems, ...notes].join('; ');
  return report;
}

/** Dải IPv4 công bố của Cloudflare (https://www.cloudflare.com/ips-v4). */
const CF_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

export function isCloudflareIp(ip: string): boolean {
  const n = ipToInt(ip);
  return CF_RANGES.some((cidr) => {
    const [base, bits] = cidr.split('/') as [string, string];
    const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return (n & mask) === (ipToInt(base) & mask);
  });
}
