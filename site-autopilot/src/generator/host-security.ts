import { z } from 'zod';
import { shq } from '../services/ssh.js';

/**
 * Bảo mật hosting (áp cho toàn bộ VPS chứa các website, không phải từng zone Cloudflare):
 * sinh cấu hình Nginx (mức http và mức server) + fail2ban từ các công tắc trên dashboard,
 * rồi đưa lên VPS bằng SSH và nạp lại Nginx. Mọi tệp đều nằm dưới dấu hiệu AUTOPILOT để gỡ được.
 */

export const HostSecuritySchema = z.object({
  /** 1. Chặn tệp, URL và đuôi nhạy cảm */
  blockSensitive: z.boolean().default(true),
  sensitiveExtensions: z.array(z.string()).default(['env', 'git', 'svn', 'htaccess', 'htpasswd', 'ini', 'log', 'sh', 'sql', 'bak', 'old', 'swp', 'conf', 'yml', 'yaml', 'pem', 'key']),
  blockedPaths: z.array(z.string()).default(['/wp-admin', '/wp-login.php', '/xmlrpc.php', '/wp-includes', '/phpmyadmin', '/pma', '/administrator', '/vendor/', '/.git', '/cgi-bin', '/server-status']),
  /** 2. Chống dò mật khẩu SSH bằng fail2ban */
  bruteForce: z.boolean().default(true),
  bruteForceMaxRetry: z.number().int().min(2).max(50).default(5),
  bruteForceBanMinutes: z.number().int().min(1).max(10_080).default(60),
  /** 3. Whitelist Googlebot, còn lại giới hạn tốc độ */
  rateLimit: z.boolean().default(true),
  rateLimitPerSecond: z.number().int().min(1).max(200).default(10),
  rateLimitBurst: z.number().int().min(1).max(1000).default(30),
  /** 4. Chặn IP truy cập 404 quá nhiều */
  block404: z.boolean().default(true),
  block404PerMinute: z.number().int().min(5).max(600).default(30),
  /** 5. Chỉ nhận kết nối từ Cloudflare (chặn truy cập thẳng vào IP máy chủ) */
  cloudflareOnly: z.boolean().default(false),
  /** 6. Header bảo mật trình duyệt */
  securityHeaders: z.boolean().default(true),
  /** 7. Ẩn phiên bản Nginx, chặn HTTP method lạ và công cụ dò quét */
  hardenServer: z.boolean().default(true),
  /** Lần áp dụng gần nhất */
  appliedAt: z.string().default(''),
  appliedNote: z.string().default(''),
});
export type HostSecurity = z.infer<typeof HostSecuritySchema>;

export interface IpRanges {
  cloudflare: string[];
  googlebot: string[];
}

/** Dải IP dự phòng khi không tải được danh sách mới (Cloudflare công bố ổn định nhiều năm; Googlebot lấy từ googlebot.json). */
export const FALLBACK_RANGES: IpRanges = {
  cloudflare: [
    '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
    '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
  ],
  googlebot: ['66.249.64.0/19', '64.233.160.0/19', '72.14.192.0/18', '74.125.0.0/16', '209.85.128.0/17', '216.239.32.0/19', '2001:4860:4801::/48'],
};

export const NGINX_HTTP_FILE = '/www/server/nginx/conf/autopilot-security-http.conf';
export const NGINX_SERVER_FILE = '/www/server/nginx/conf/autopilot-security-server.conf';
export const NGINX_MAIN_CONF = '/www/server/nginx/conf/nginx.conf';
export const VHOST_DIR = '/www/server/panel/vhost/nginx';
export const FAIL2BAN_FILE = '/etc/fail2ban/jail.d/autopilot.local';
const MARK = '# AUTOPILOT-SECURITY';
const SERVER_INCLUDE = `include ${NGINX_SERVER_FILE}; ${MARK}`;
const HTTP_INCLUDE = `include ${NGINX_HTTP_FILE}; ${MARK}`;

function cleanList(items: string[]): string[] {
  return [...new Set(items.map((s) => s.trim()).filter(Boolean))];
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Cấu hình mức http: IP thật sau Cloudflare, whitelist Googlebot, vùng giới hạn tốc độ, nhận diện nguồn Cloudflare. */
export function buildNginxHttpConf(s: HostSecurity, ranges: IpRanges, serverIp: string): string {
  const lines: string[] = [`${MARK} (tự sinh từ dashboard, đừng sửa tay)`, '# Lấy IP khách thật khi đi qua Cloudflare'];
  for (const r of ranges.cloudflare) lines.push(`set_real_ip_from ${r};`);
  lines.push('real_ip_header CF-Connecting-IP;', 'real_ip_recursive on;', '');
  if (s.rateLimit || s.block404) {
    lines.push('# Googlebot không bị giới hạn; IP khác đếm theo IP thật');
    lines.push('geo $ap_googlebot {', '  default 0;');
    for (const r of ranges.googlebot) lines.push(`  ${r} 1;`);
    lines.push('}', 'map $ap_googlebot $ap_limit_key { 0 $binary_remote_addr; 1 ""; }');
    if (s.rateLimit) lines.push(`limit_req_zone $ap_limit_key zone=ap_req:10m rate=${s.rateLimitPerSecond}r/s;`);
    if (s.block404) lines.push(`limit_req_zone $ap_limit_key zone=ap_404:10m rate=${s.block404PerMinute}r/m;`);
    lines.push('limit_req_status 429;', '');
  }
  if (s.cloudflareOnly) {
    lines.push('# Kết nối có đến từ Cloudflare (hoặc chính máy chủ) không, xét theo IP kết nối gốc');
    lines.push('geo $realip_remote_addr $ap_from_cf {', '  default 0;', '  127.0.0.1 1;', '  ::1 1;');
    if (serverIp) lines.push(`  ${serverIp} 1;`);
    for (const r of ranges.cloudflare) lines.push(`  ${r} 1;`);
    lines.push('}', '');
  }
  if (s.hardenServer) {
    lines.push('# Chặn công cụ dò quét theo user-agent');
    lines.push('map $http_user_agent $ap_bad_ua {', '  default 0;', '  "~*(sqlmap|nikto|nmap|masscan|zgrab|acunetix|nessus|wpscan|dirbuster|gobuster|ffuf|hydra|python-requests/|libwww-perl|curl/7\\.[0-4])" 1;', '}', 'server_tokens off;', '');
  }
  return lines.join('\n') + '\n';
}

/** Cấu hình mức server (được include vào từng site): chặn tệp nhạy cảm, giới hạn tốc độ, 404, header, method. */
export function buildNginxServerConf(s: HostSecurity): string {
  const lines: string[] = [`${MARK} (tự sinh từ dashboard, đừng sửa tay)`];
  if (s.cloudflareOnly) lines.push('if ($ap_from_cf = 0) { return 403; }');
  if (s.hardenServer) {
    lines.push('if ($ap_bad_ua) { return 403; }');
    lines.push('if ($request_method !~ ^(GET|HEAD|POST|OPTIONS)$) { return 405; }');
  }
  if (s.rateLimit) lines.push(`limit_req zone=ap_req burst=${s.rateLimitBurst} nodelay;`);
  if (s.securityHeaders) {
    lines.push(
      'add_header X-Content-Type-Options "nosniff" always;',
      'add_header X-Frame-Options "SAMEORIGIN" always;',
      'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
      'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;',
      'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
    );
  }
  if (s.blockSensitive) {
    const exts = cleanList(s.sensitiveExtensions).map((e) => e.replace(/^\./, ''));
    if (exts.length) lines.push(`location ~* \\.(${exts.map(escapeRe).join('|')})$ { deny all; return 404; }`);
    lines.push('location ~ /\\.(?!well-known/) { deny all; return 404; }');
    const paths = cleanList(s.blockedPaths);
    if (paths.length) lines.push(`location ~* ^(${paths.map(escapeRe).join('|')}) { deny all; return 404; }`);
  }
  if (s.block404) {
    lines.push('error_page 404 = @ap_notfound;');
    lines.push('location @ap_notfound { limit_req zone=ap_404 burst=10 nodelay; internal; try_files /404.html =404; }');
  }
  return lines.join('\n') + '\n';
}

/** fail2ban: chống dò mật khẩu SSH. */
export function buildFail2banConf(s: HostSecurity): string {
  return `${MARK}
[DEFAULT]
bantime = ${s.bruteForceBanMinutes}m
findtime = 10m
maxretry = ${s.bruteForceMaxRetry}
banaction = %(banaction_allports)s

[sshd]
enabled = true
mode = aggressive
`;
}

/**
 * Script chạy trên VPS: ghi cấu hình, thêm include vào nginx.conf và từng site, kiểm tra nginx -t rồi nạp lại;
 * lỗi thì khôi phục bản trước. In "AP_OK" khi xong.
 */
export function buildApplyScript(s: HostSecurity, files: { http: string; server: string; fail2ban: string }, domains: string[]): string {
  const heredoc = (path: string, content: string) => `cat > ${shq(path)} <<'AP_EOF'\n${content}AP_EOF\n`;
  const siteConfs = domains.map((d) => `${VHOST_DIR}/${d}.conf`);
  const anyNginx = s.blockSensitive || s.rateLimit || s.block404 || s.cloudflareOnly || s.securityHeaders || s.hardenServer;
  const lines: string[] = ['set -e', 'export DEBIAN_FRONTEND=noninteractive', `BK=/root/.autopilot-security-backup; mkdir -p "$BK"`, `cp -f ${NGINX_MAIN_CONF} "$BK/nginx.conf" 2>/dev/null || true`];
  for (const c of siteConfs) lines.push(`[ -f ${shq(c)} ] && cp -f ${shq(c)} "$BK/$(basename ${shq(c)})" || true`);
  lines.push(heredoc(NGINX_HTTP_FILE, files.http), heredoc(NGINX_SERVER_FILE, files.server));
  // include mức http: đặt trước dòng include vhost (giữ tương thích aaPanel), chỉ thêm một lần
  lines.push(`grep -q ${shq(MARK)} ${NGINX_MAIN_CONF} || sed -i ${shq(`0,/include \\/www\\/server\\/panel\\/vhost\\/nginx\\/\\*\\.conf;/s##${HTTP_INCLUDE}\\n    include /www/server/panel/vhost/nginx/*.conf;#`)} ${NGINX_MAIN_CONF}`);
  lines.push(`grep -q ${shq(MARK)} ${NGINX_MAIN_CONF} || { echo "AP_ERR: không tìm thấy dòng include vhost trong nginx.conf"; exit 2; }`);
  // include mức server vào từng site: sau dòng server_name đầu tiên
  for (const c of siteConfs) {
    lines.push(`if [ -f ${shq(c)} ] && ! grep -q ${shq(MARK)} ${shq(c)}; then sed -i ${shq(`0,/^\\s*server_name .*;/s##&\\n    ${SERVER_INCLUDE}#`)} ${shq(c)}; fi`);
  }
  if (!anyNginx) {
    // mọi công tắc Nginx đều tắt: gỡ include khỏi các site để cấu hình sạch
    for (const c of siteConfs) lines.push(`[ -f ${shq(c)} ] && sed -i ${shq(`/${MARK}/d`)} ${shq(c)} || true`);
  }
  lines.push(`if ! /www/server/nginx/sbin/nginx -t 2>"$BK/nginx-test.log"; then cp -f "$BK/nginx.conf" ${NGINX_MAIN_CONF}; for f in "$BK"/*.conf; do b=$(basename "$f"); [ "$b" = nginx.conf ] || cp -f "$f" ${VHOST_DIR}/"$b"; done; echo "AP_ERR: nginx -t lỗi, đã khôi phục:"; cat "$BK/nginx-test.log"; exit 3; fi`);
  lines.push(`/www/server/nginx/sbin/nginx -s reload || systemctl reload nginx || true`);
  if (s.bruteForce) {
    lines.push(`command -v fail2ban-client >/dev/null 2>&1 || (apt-get install -y -q fail2ban >/dev/null 2>&1 || yum install -y -q fail2ban >/dev/null 2>&1) || echo "AP_WARN: không cài được fail2ban"`);
    lines.push(`mkdir -p /etc/fail2ban/jail.d`, heredoc(FAIL2BAN_FILE, files.fail2ban));
    lines.push(`systemctl enable fail2ban >/dev/null 2>&1 || true; systemctl restart fail2ban || echo "AP_WARN: fail2ban không khởi động"`);
  } else {
    lines.push(`if [ -f ${FAIL2BAN_FILE} ]; then rm -f ${FAIL2BAN_FILE}; systemctl restart fail2ban 2>/dev/null || true; fi`);
  }
  lines.push('echo AP_OK');
  return lines.join('\n') + '\n';
}

/** Tóm tắt các công tắc đang bật, hiện trên dashboard và log. */
export function summarize(s: HostSecurity): string[] {
  const out: string[] = [];
  if (s.blockSensitive) out.push(`chặn ${cleanList(s.sensitiveExtensions).length} đuôi tệp và ${cleanList(s.blockedPaths).length} đường dẫn nhạy cảm`);
  if (s.bruteForce) out.push(`fail2ban SSH: sai ${s.bruteForceMaxRetry} lần khóa ${s.bruteForceBanMinutes} phút`);
  if (s.rateLimit) out.push(`giới hạn ${s.rateLimitPerSecond} request/giây (burst ${s.rateLimitBurst}), Googlebot miễn`);
  if (s.block404) out.push(`quá ${s.block404PerMinute} lượt 404/phút thì trả 429`);
  if (s.cloudflareOnly) out.push('chỉ nhận kết nối từ Cloudflare');
  if (s.securityHeaders) out.push('header bảo mật trình duyệt');
  if (s.hardenServer) out.push('ẩn phiên bản Nginx, chặn method lạ và bot dò quét');
  return out;
}
