import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigCache } from '../src/config.js';
import { Db } from '../src/db/index.js';
import { createServices, ensureDefaultServer } from '../src/services/index.js';
import { STEPS } from '../src/core/steps.js';
import { Worker } from '../src/core/worker.js';
import { createApp } from '../src/web/server.js';
import { FALLBACK_RANGES, HostSecuritySchema, buildApplyScript, buildFail2banConf, buildNginxHttpConf, buildNginxServerConf, summarize } from '../src/generator/host-security.js';

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-security-'));
  resetConfigCache();
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('bảo mật hosting: sinh cấu hình', () => {
  it('mặc định bật 6/7 mục; cấu hình Nginx có đủ phần theo công tắc', () => {
    const s = HostSecuritySchema.parse({});
    expect(s.cloudflareOnly).toBe(false);
    const http = buildNginxHttpConf(s, FALLBACK_RANGES, '169.58.153.3');
    expect(http).toContain('real_ip_header CF-Connecting-IP;');
    expect(http).toContain('set_real_ip_from 173.245.48.0/20;');
    expect(http).toContain('geo $ap_googlebot');
    expect(http).toContain('66.249.64.0/19 1;');
    expect(http).toContain('limit_req_zone $ap_limit_key zone=ap_req:10m rate=10r/s;');
    expect(http).toContain('zone=ap_404:10m rate=30r/m;');
    expect(http).toContain('server_tokens off;');
    expect(http).not.toContain('$ap_from_cf');
    const server = buildNginxServerConf(s);
    expect(server).toContain('location ~* \\.(env|git|svn|htaccess|htpasswd|ini|log|sh|sql|bak|old|swp|conf|yml|yaml|pem|key)$ { deny all; return 404; }');
    expect(server).toContain(String.raw`^(\/wp-admin|\/wp-login\.php|`);
    expect(server).toContain('limit_req zone=ap_req burst=30 nodelay;');
    expect(server).toContain('error_page 404 = @ap_notfound;');
    expect(server).toContain('add_header Strict-Transport-Security');
    expect(server).toContain('if ($request_method !~ ^(GET|HEAD|POST|OPTIONS)$) { return 405; }');
    expect(server).not.toContain('$ap_from_cf');
    expect(buildFail2banConf(s)).toContain('maxretry = 5');
    expect(buildFail2banConf(s)).toContain('bantime = 60m');
    expect(summarize(s)).toHaveLength(6);
  });

  it('tắt hết thì Nginx gần như rỗng; bật chỉ-Cloudflare thì có geo theo IP kết nối gốc', () => {
    const off = HostSecuritySchema.parse({ blockSensitive: false, bruteForce: false, rateLimit: false, block404: false, securityHeaders: false, hardenServer: false });
    const server = buildNginxServerConf(off);
    expect(server.split('\n').filter(Boolean)).toHaveLength(1);
    expect(buildNginxHttpConf(off, FALLBACK_RANGES, '')).not.toContain('limit_req_zone');
    const cf = HostSecuritySchema.parse({ cloudflareOnly: true });
    expect(buildNginxHttpConf(cf, FALLBACK_RANGES, '1.2.3.4')).toContain('geo $realip_remote_addr $ap_from_cf');
    expect(buildNginxHttpConf(cf, FALLBACK_RANGES, '1.2.3.4')).toContain('  1.2.3.4 1;');
    expect(buildNginxServerConf(cf)).toContain('if ($ap_from_cf = 0) { return 403; }');
  });

  it('script áp dụng: ghi tệp, chèn include, nginx -t có khôi phục, fail2ban theo công tắc', () => {
    const s = HostSecuritySchema.parse({});
    const script = buildApplyScript(s, { http: 'H\n', server: 'S\n', fail2ban: 'F\n' }, ['a.com', 'b.com']);
    expect(script).toContain("cat > '/www/server/nginx/conf/autopilot-security-http.conf' <<'AP_EOF'\nH\nAP_EOF");
    expect(script).toContain('/www/server/panel/vhost/nginx/a.com.conf');
    expect(script).toContain('/www/server/panel/vhost/nginx/b.com.conf');
    expect(script).toContain('nginx -t');
    expect(script).toContain('AP_ERR: nginx -t lỗi, đã khôi phục');
    expect(script).toContain('apt-get install -y -q fail2ban');
    expect(script).toContain('/etc/fail2ban/jail.d/autopilot.local');
    expect(script.trim().endsWith('echo AP_OK')).toBe(true);
    const noF2b = buildApplyScript(HostSecuritySchema.parse({ bruteForce: false }), { http: '', server: '', fail2ban: '' }, []);
    expect(noF2b).not.toContain('apt-get install');
    expect(noF2b).toContain('rm -f /etc/fail2ban/jail.d/autopilot.local');
  });
});

describe('trang Bảo mật và job áp dụng (mock)', () => {
  it('lưu công tắc qua form, áp dụng chạy job trên server mock, ghi thời điểm áp dụng', async () => {
    const config = loadConfig({ MOCK_MODE: '1', DATA_DIR: tmp, WORKER_CONCURRENCY: '2', ADMIN_PASSWORD: 'x', NS_POLL_INTERVAL_MIN: '0', REBUILD_DEBOUNCE_SEC: '0' });
    const db = new Db(':memory:');
    const services = createServices(config, db);
    ensureDefaultServer(config, db);
    const worker = new Worker({ db, config, services, steps: STEPS });
    const app = createApp({ db, config, services, worker, steps: STEPS });
    const login = await app.request('/login', { method: 'POST', body: new URLSearchParams({ user: 'admin', password: 'x', next: '/' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';

    const page = await (await app.request('/security', { headers: { cookie } })).text();
    expect(page).toContain('Bảo mật hosting');
    expect(page).toContain('name="cloudflareOnly"');
    expect(page).toContain('Chưa áp dụng lên hosting');
    expect(page).toContain('href="/security"');

    const save = await app.request('/security', { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ action: 'apply', blockSensitive: '1', sensitiveExtensions: 'env, sql', blockedPaths: '/wp-admin\n/xmlrpc.php', bruteForce: '1', bruteForceMaxRetry: '3', bruteForceBanMinutes: '120', rateLimit: '0', rateLimitPerSecond: '10', rateLimitBurst: '30', block404: '1', block404PerMinute: '20', cloudflareOnly: '1', securityHeaders: '1', hardenServer: '0' }) });
    expect(save.status).toBe(302);
    const s = db.getHostSecurity();
    expect(s.sensitiveExtensions).toEqual(['env', 'sql']);
    expect(s.blockedPaths).toEqual(['/wp-admin', '/xmlrpc.php']);
    expect(s.bruteForceMaxRetry).toBe(3);
    expect(s.rateLimit).toBe(false);
    expect(s.cloudflareOnly).toBe(true);
    expect(s.hardenServer).toBe(false);
    expect(db.listJobs().some((j) => j.type === 'apply_host_security' && j.status === 'queued')).toBe(true);

    await worker.tick();
    await worker.drain(30_000);
    const job = db.listJobs().find((j) => j.type === 'apply_host_security')!;
    expect(job.status).toBe('done');
    const after = db.getHostSecurity();
    expect(after.appliedAt).not.toBe('');
    expect(after.appliedNote).toContain('xong');
    const page2 = await (await app.request('/security', { headers: { cookie } })).text();
    expect(page2).toContain('Lần áp dụng gần nhất');
    expect(db.listLogs({ limit: 20 }).some((l) => /Áp dụng bảo mật hosting lên/.test(l.message))).toBe(true);
  }, 60000);
});
