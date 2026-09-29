import type { Hono } from 'hono';
import type { AppConfig } from '../config.js';
import type { Db, ServerRow } from '../db/index.js';
import { HostSecuritySchema, buildFail2banConf, buildNginxHttpConf, buildNginxServerConf, FALLBACK_RANGES, summarize, type HostSecurity } from '../generator/host-security.js';
import { formatDateVi } from '../core/util.js';
import { str, type FormBody } from './forms.js';
import { parseList } from '../core/util.js';

/* ------------------------------------------------------------------ */
/*  Trang Bảo mật hosting                                               */
/* ------------------------------------------------------------------ */

export function SecurityPage(props: { settings: HostSecurity; servers: ServerRow[]; lastJob?: { status: string; error: string | null; finished_at: string | null } | null }) {
  const s = props.settings;
  const Toggle = (p: { name: keyof HostSecurity; label: string; help: string; children?: unknown }) => (
    <fieldset>
      <legend>
        <label style="display:flex;gap:8px;align-items:center;font-weight:700">
          <input type="checkbox" name={String(p.name)} value="1" checked={Boolean(s[p.name])} /> {p.label}
        </label>
      </legend>
      <div class="help" style="margin-bottom:8px">{p.help}</div>
      {p.children}
    </fieldset>
  );
  const on = summarize(s);
  return (
    <div class="card">
      <h1>Bảo mật hosting</h1>
      <p class="muted">
        Áp dụng cho toàn bộ VPS chứa các website (Nginx của aaPanel và fail2ban), bổ sung cho WAF Cloudflare của từng site. Bật tắt từng mục rồi bấm "Lưu và áp dụng lên hosting": hệ thống sinh cấu hình, kiểm tra <span class="mono">nginx -t</span>, nạp lại Nginx; lỗi thì tự khôi phục bản trước.
      </p>
      {s.appliedAt ? (
        <div class={`alert ${props.lastJob?.status === 'failed' ? 'err' : 'ok'}`}>
          Lần áp dụng gần nhất: {formatDateVi(s.appliedAt)}. {s.appliedNote}
          {props.lastJob?.status === 'failed' ? ` Lỗi: ${props.lastJob.error ?? ''}` : ''}
        </div>
      ) : (
        <div class="alert info">Chưa áp dụng lên hosting lần nào. Lưu xong bấm "Lưu và áp dụng lên hosting".</div>
      )}
      <form method="post" action="/security">
        <Toggle name="blockSensitive" label="1. Chặn tệp, URL và đuôi nhạy cảm" help="Trả 404 cho các tệp cấu hình, sao lưu, mã nguồn và đường dẫn quản trị mà website tĩnh không dùng; kẻ dò quét không biết tệp có tồn tại hay không.">
          <div class="row">
            <div>
              <label>Đuôi tệp bị chặn (cách nhau dấu phẩy)</label>
              <input type="text" name="sensitiveExtensions" value={s.sensitiveExtensions.join(', ')} />
            </div>
            <div>
              <label>Đường dẫn bị chặn (mỗi dòng một mục, khớp phần đầu)</label>
              <textarea name="blockedPaths" style="min-height:90px">
                {s.blockedPaths.join('\n')}
              </textarea>
            </div>
          </div>
        </Toggle>
        <Toggle name="bruteForce" label="2. Chống dò mật khẩu SSH (fail2ban)" help="Cài fail2ban trên VPS: IP đăng nhập SSH sai quá số lần sẽ bị khóa toàn bộ cổng trong thời gian đặt. Đăng nhập aaPanel đã có giới hạn riêng trong Cài đặt bảo mật của panel.">
          <div class="row">
            <div>
              <label>Số lần sai tối đa</label>
              <input type="number" name="bruteForceMaxRetry" min="2" max="50" value={String(s.bruteForceMaxRetry)} />
            </div>
            <div>
              <label>Khóa trong (phút)</label>
              <input type="number" name="bruteForceBanMinutes" min="1" max="10080" value={String(s.bruteForceBanMinutes)} />
            </div>
          </div>
        </Toggle>
        <Toggle name="rateLimit" label="3. Chỉ miễn Googlebot, còn lại giới hạn tốc độ" help="Nginx đếm theo IP khách thật (lấy từ Cloudflare). Googlebot theo danh sách IP chính thức của Google không bị giới hạn; IP khác vượt ngưỡng nhận mã 429. Đây là lớp thứ hai sau rate limit của Cloudflare.">
          <div class="row">
            <div>
              <label>Request mỗi giây cho một IP</label>
              <input type="number" name="rateLimitPerSecond" min="1" max="200" value={String(s.rateLimitPerSecond)} />
            </div>
            <div>
              <label>Cho phép vượt tức thời (burst)</label>
              <input type="number" name="rateLimitBurst" min="1" max="1000" value={String(s.rateLimitBurst)} />
            </div>
          </div>
        </Toggle>
        <Toggle name="block404" label="4. Chặn IP truy cập link 404 quá nhiều" help="Kẻ dò quét gọi hàng loạt đường dẫn không tồn tại. Quá ngưỡng, các yêu cầu 404 tiếp theo của IP đó nhận 429 thay vì được phục vụ; khách bình thường gõ sai vài link không ảnh hưởng.">
          <label>Số lượt 404 mỗi phút cho một IP</label>
          <input type="number" name="block404PerMinute" min="5" max="600" value={String(s.block404PerMinute)} style="max-width:200px" />
        </Toggle>
        <Toggle name="cloudflareOnly" label="5. Chỉ nhận kết nối từ Cloudflare (đề xuất thêm)" help="Chặn truy cập thẳng vào IP máy chủ, buộc mọi lượt truy cập đi qua WAF Cloudflare; máy chủ và các tác vụ kiểm tra nội bộ vẫn được phép. Chỉ bật khi mọi domain trên VPS đều đã qua Cloudflare (đám mây cam)." />
        <Toggle name="securityHeaders" label="6. Header bảo mật trình duyệt (đề xuất thêm)" help="Thêm X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy và HSTS vào mọi phản hồi: chống nhúng trang vào iframe lừa đảo, chống đoán kiểu tệp, ép HTTPS. Cải thiện điểm bảo mật khi Google và các công cụ đánh giá." />
        <Toggle name="hardenServer" label="7. Ẩn phiên bản Nginx, chặn method lạ và bot dò quét (đề xuất thêm)" help="Không lộ số phiên bản Nginx trong header; chỉ cho GET, HEAD, POST, OPTIONS; chặn user-agent của công cụ dò quét lỗ hổng như sqlmap, nikto, nmap, wpscan." />
        <div class="actions" style="margin-top:12px">
          <button class="btn secondary" type="submit" name="action" value="save">
            Lưu
          </button>
          <button class="btn" type="submit" name="action" value="apply" disabled={props.servers.length === 0}>
            Lưu và áp dụng lên hosting
          </button>
          {props.servers.length === 0 ? <span class="muted small">Chưa có server nào trong Cài đặt.</span> : <span class="muted small">Áp dụng lên {props.servers.map((x) => x.name || x.ip).join(', ')}</span>}
        </div>
      </form>
      <h2 style="margin-top:20px">Đang bật</h2>
      {on.length ? (
        <ul class="small" style="margin:0;padding-left:18px">
          {on.map((x) => (
            <li>{x}</li>
          ))}
        </ul>
      ) : (
        <p class="muted small">Tất cả đang tắt. Áp dụng sẽ gỡ cấu hình bảo mật khỏi hosting.</p>
      )}
      <details style="margin-top:16px">
        <summary>Xem cấu hình Nginx và fail2ban sẽ ghi lên VPS</summary>
        <p class="muted small">Dải IP Cloudflare và Googlebot được tải mới khi áp dụng; bản xem trước dùng danh sách dự phòng.</p>
        <pre class="small" style="white-space:pre-wrap;background:var(--bg);padding:10px;border-radius:8px">
          {buildNginxHttpConf(s, FALLBACK_RANGES, props.servers[0]?.ip ?? '')}
          {'\n'}
          {buildNginxServerConf(s)}
          {'\n'}
          {s.bruteForce ? buildFail2banConf(s) : ''}
        </pre>
      </details>
    </div>
  );
}

export function parseHostSecurity(body: FormBody, current: HostSecurity): HostSecurity {
  const num = (k: string, fallback: number) => Number.parseInt(str(body, k), 10) || fallback;
  return HostSecuritySchema.parse({
    ...current,
    blockSensitive: str(body, 'blockSensitive') === '1',
    sensitiveExtensions: parseList(str(body, 'sensitiveExtensions')),
    blockedPaths: parseList(str(body, 'blockedPaths')),
    bruteForce: str(body, 'bruteForce') === '1',
    bruteForceMaxRetry: num('bruteForceMaxRetry', current.bruteForceMaxRetry),
    bruteForceBanMinutes: num('bruteForceBanMinutes', current.bruteForceBanMinutes),
    rateLimit: str(body, 'rateLimit') === '1',
    rateLimitPerSecond: num('rateLimitPerSecond', current.rateLimitPerSecond),
    rateLimitBurst: num('rateLimitBurst', current.rateLimitBurst),
    block404: str(body, 'block404') === '1',
    block404PerMinute: num('block404PerMinute', current.block404PerMinute),
    cloudflareOnly: str(body, 'cloudflareOnly') === '1',
    securityHeaders: str(body, 'securityHeaders') === '1',
    hardenServer: str(body, 'hardenServer') === '1',
  });
}

export interface SecurityDeps {
  db: Db;
  config: AppConfig;
  render: (c: never, title: string, active: string, body: unknown) => Response | Promise<Response>;
  flash: (c: never, f: { type: 'ok' | 'err' | 'info'; text: string }) => void;
}

export function mountSecurity(app: Hono, deps: SecurityDeps): void {
  const { db } = deps;
  app.get('/security', (c) => {
    const lastJob = db.listJobs(20).find((j) => j.type === 'apply_host_security') ?? null;
    return deps.render(c as never, 'Bảo mật hosting', 'security', SecurityPage({ settings: db.getHostSecurity(), servers: db.listServers(), lastJob: lastJob ? { status: lastJob.status, error: lastJob.error, finished_at: lastJob.finished_at } : null }));
  });
  app.post('/security', async (c) => {
    const body = (await c.req.parseBody()) as FormBody;
    const settings = parseHostSecurity(body, db.getHostSecurity());
    db.setHostSecurity(settings);
    db.addLog({ level: 'info', step: 'security', message: `Cập nhật cài đặt bảo mật hosting: ${summarize(settings).join('; ') || 'tất cả tắt'}` });
    if (str(body, 'action') === 'apply') {
      if (!db.listServers().length) {
        deps.flash(c as never, { type: 'err', text: 'Chưa có server nào để áp dụng.' });
        return c.redirect('/security');
      }
      db.enqueueJob('apply_host_security', null, null, { dedupe: true, maxAttempts: 1 });
      deps.flash(c as never, { type: 'info', text: 'Đã lưu. Đang áp dụng lên hosting (khoảng một phút; lần đầu có cài fail2ban lâu hơn). Tải lại trang để xem kết quả.' });
    } else {
      deps.flash(c as never, { type: 'ok', text: 'Đã lưu cài đặt. Bấm "Lưu và áp dụng lên hosting" để có hiệu lực trên VPS.' });
    }
    return c.redirect('/security');
  });
}
