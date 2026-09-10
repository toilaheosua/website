import http from 'node:http';
import https from 'node:https';

export const MARKER = 'name="generator" content="site-autopilot"';
/** User agent giống trình duyệt để Cloudflare không coi là bot; vẫn có thể bị Bot Fight Mode chặn. */
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 site-autopilot-check';

export interface ProbeResult {
  status: number | null;
  ok: boolean;
  hasMarker: boolean;
  ms: number;
  error?: string;
  server?: string;
}

function request(opts: { protocol: 'http' | 'https'; host: string; port?: number; path: string; hostHeader: string; timeoutMs?: number }): Promise<ProbeResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const mod = opts.protocol === 'https' ? https : http;
    const req = mod.request(
      {
        host: opts.host,
        port: opts.port ?? (opts.protocol === 'https' ? 443 : 80),
        path: opts.path,
        method: 'GET',
        headers: { Host: opts.hostHeader, 'User-Agent': BROWSER_UA, Accept: 'text/html,*/*' },
        servername: opts.protocol === 'https' ? opts.hostHeader : undefined,
        timeout: opts.timeoutMs ?? 20_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          resolve({ status, ok: status >= 200 && status < 300, hasMarker: body.includes(MARKER), ms: Date.now() - started, server: String(res.headers.server ?? '') });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ status: null, ok: false, hasMarker: false, ms: Date.now() - started, error: err.message }));
    req.end();
  });
}

/** Gọi thẳng vào máy chủ gốc bằng HTTP với Host header, bỏ qua Cloudflare (SSL Flexible nên origin chạy HTTP). */
export function probeOrigin(domain: string, serverIp: string): Promise<ProbeResult> {
  return request({ protocol: 'http', host: serverIp, path: '/', hostHeader: domain });
}

/** Gọi qua Cloudflare bằng HTTPS như người dùng thật. */
export function probeEdge(domain: string): Promise<ProbeResult> {
  return request({ protocol: 'https', host: domain, path: '/', hostHeader: domain });
}
