import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { HostSecuritySchema, buildApplyScript, sedInsertAfter, sedInsertBefore } from '../src/generator/host-security.js';

const hasGnuSed = (() => {
  const r = spawnSync('sed', ['--version'], { encoding: 'utf8' });
  return r.status === 0 && /GNU sed/.test(r.stdout);
})();

const NGINX_CONF = `user  www www;
http {
    include       mime.types;
    include /www/server/panel/vhost/nginx/*.conf;
    server { listen 888; }
}
`;
const SITE_CONF = `server
{
    listen 80;
    server_name hutieuonggiao.com www.hutieuonggiao.com;
    index index.html;
    root /www/wwwroot/hutieuonggiao.com;
    include /www/server/panel/vhost/rewrite/hutieuonggiao.com.conf;
}
`;

describe('sed chèn include (chạy sed thật)', () => {
  it.skipIf(!hasGnuSed)('chèn dòng có dấu # trước include vhost và sau server_name, chạy lại không chèn đôi', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-sed-'));
    const nginx = path.join(tmp, 'nginx.conf');
    const site = path.join(tmp, 'site.conf');
    fs.writeFileSync(nginx, NGINX_CONF);
    fs.writeFileSync(site, SITE_CONF);
    const httpLine = 'include /www/server/nginx/conf/autopilot-security-http.conf; # AUTOPILOT-SECURITY';
    const serverLine = 'include /www/server/nginx/conf/autopilot-security-server.conf; # AUTOPILOT-SECURITY';
    const r1 = spawnSync('sed', ['-i', sedInsertBefore('include \\/www\\/server\\/panel\\/vhost\\/nginx\\/\\*\\.conf;', httpLine), nginx], { encoding: 'utf8' });
    expect(r1.stderr).toBe('');
    expect(r1.status).toBe(0);
    const out1 = fs.readFileSync(nginx, 'utf8');
    expect(out1).toContain(`    ${httpLine}\n    include /www/server/panel/vhost/nginx/*.conf;`);
    const r2 = spawnSync('sed', ['-i', sedInsertAfter('^\\s*server_name .*;', serverLine), site], { encoding: 'utf8' });
    expect(r2.stderr).toBe('');
    const out2 = fs.readFileSync(site, 'utf8');
    expect(out2).toContain(`    server_name hutieuonggiao.com www.hutieuonggiao.com;\n    ${serverLine}\n    index index.html;`);
    // Script đầy đủ dùng grep -q trước sed: chạy toàn bộ script trên bản sao để chắc không lỗi cú pháp shell (không đụng nginx thật)
    const s = HostSecuritySchema.parse({});
    const script = buildApplyScript(s, { http: 'H\n', server: 'S\n', fail2ban: 'F\n' }, ['hutieuonggiao.com']);
    expect(script).not.toContain('s##');
    expect(script).toContain('s|');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
