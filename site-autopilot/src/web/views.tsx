import { raw } from 'hono/html';
import type { Db, JobRow, LibraryRow, LogRow, Page as PageRow, ServerRow, Site, StepRow } from '../db/index.js';
import type { AppConfig, IntegrationStatus } from '../config.js';
import type { StepDef } from '../core/pipeline.js';
import { progressOf } from '../core/pipeline.js';
import type { EntityData, GeneralSettings, WafSettings } from '../core/types.js';
import { formatDateVi, truncate } from '../core/util.js';
import { themeIds } from '../generator/themes.js';
import { CONTENT_STYLE_CHOICES } from '../generator/content-styles.js';
import { mdToHtml } from '../generator/markdown.js';
import { validateEntity } from '../generator/schema.js';
import { JOB_LABELS } from '../core/jobs.js';
import { INTERVIEW_GROUPS, INTERVIEW_QUESTIONS, answeredCount, type InterviewData } from '../core/interview.js';
import type { ManualPostInput } from '../core/manual-post.js';
import { Badge, STATUS_LABEL } from './layout.js';

/* ------------------------------------------------------------------ */
/*  Danh sách site                                                      */
/* ------------------------------------------------------------------ */

export function SitesIndex(props: { sites: Site[]; stepsBySite: Map<number, StepRow[]>; defs: StepDef[]; counts: Record<string, number>; integrations: IntegrationStatus }) {
  const { sites, stepsBySite, defs, counts } = props;
  const missing = Object.entries(props.integrations)
    .filter(([k, v]) => k !== 'mock' && k !== 'telegram' && k !== 'google' && !v)
    .map(([k]) => k);
  return (
    <>
      <div class="grid cols-4" style="margin-bottom:20px">
        <div class="card stat">
          <span class="n">{sites.length}</span>
          <span class="l">Tổng website</span>
        </div>
        <div class="card stat">
          <span class="n">{counts.live ?? 0}</span>
          <span class="l">Đang live</span>
        </div>
        <div class="card stat">
          <span class="n">{(counts.building ?? 0) + (counts.creating ?? 0) + (counts.waiting_ns ?? 0)}</span>
          <span class="l">Đang xử lý</span>
        </div>
        <div class="card stat">
          <span class="n" style={counts.error ? 'color:var(--err)' : ''}>
            {counts.error ?? 0}
          </span>
          <span class="l">Cần xử lý</span>
        </div>
      </div>
      {missing.length && !props.integrations.mock ? (
        <div class="alert warn">
          Chưa cấu hình: {missing.join(', ')}. Xem hướng dẫn trong <a href="/settings">Cài đặt</a>.
        </div>
      ) : null}
      <div class="card">
        <div class="actions" style="justify-content:space-between;margin-bottom:12px">
          <h1 style="margin:0">Website</h1>
          <a class="btn" href="/sites/new">
            + Tạo site mới
          </a>
        </div>
        {sites.length === 0 ? (
          <p class="muted">Chưa có website nào. Bấm "Tạo site mới" để bắt đầu.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Domain</th>
                <th>Thương hiệu</th>
                <th>Trạng thái</th>
                <th>Tiến độ</th>
                <th>Sức khỏe</th>
                <th>Cập nhật</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => {
                const p = progressOf(defs, stepsBySite.get(s.id) ?? []);
                return (
                  <tr>
                    <td>
                      <a href={`/sites/${s.id}`}>
                        <strong>{s.domain}</strong>
                      </a>
                      {s.status === 'live' ? (
                        <div class="small">
                          <a href={`https://${s.domain}/`} target="_blank" rel="noopener">
                            Mở site ↗
                          </a>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {s.brief.brandName}
                      <div class="small muted">{s.brief.siteType === 'blog' ? 'Blog vệ tinh' : 'Doanh nghiệp'}</div>
                    </td>
                    <td>
                      <Badge status={s.status} />
                      {s.error_summary ? <div class="small" style="color:var(--err)">{truncate(s.error_summary, 80)}</div> : null}
                    </td>
                    <td>
                      <div class="progress" title={`${p.done}/${p.total}`}>
                        <i style={`width:${p.percent}%`}></i>
                      </div>
                      <div class="small muted">
                        {p.done}/{p.total} bước
                      </div>
                    </td>
                    <td>{s.health ? <Badge status={s.health.ok ? 'ok' : 'error'} label={s.health.ok ? (s.health.responseMs === null ? 'OK' : `OK ${s.health.responseMs}ms`) : 'Có vấn đề'} /> : <span class="muted small">chưa kiểm tra</span>}</td>
                    <td class="small muted">{formatDateVi(s.updated_at)}</td>
                    <td>
                      <a class="btn secondary sm" href={`/sites/${s.id}`}>
                        Chi tiết
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Form tạo site                                                       */
/* ------------------------------------------------------------------ */

export function NewSiteForm(props: { servers: ServerRow[]; general: GeneralSettings; values?: Record<string, string>; errors?: string[] }) {
  const v = props.values ?? {};
  const val = (k: string, d = '') => v[k] ?? d;
  return (
    <div class="card">
      <h1>Tạo website mới</h1>
      <p class="muted">Điền thông tin cơ bản. Hệ thống sẽ tự tạo zone Cloudflare, thêm site vào aaPanel, viết nội dung, lấy ảnh, dựng và đưa lên host.</p>
      {props.errors?.length ? (
        <div class="alert err">
          <ul style="margin:0;padding-left:18px">
            {props.errors.map((e) => (
              <li>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <form method="post" action="/sites" enctype="multipart/form-data">
        <fieldset>
          <legend>Domain và host</legend>
          <div class="row">
            <div>
              <label>Domain *</label>
              <input type="text" name="domain" placeholder="vidu.com" value={val('domain')} required />
              <div class="help">Domain đã mua ở Namecheap. Không cần www.</div>
            </div>
            <div>
              <label>Server aaPanel *</label>
              <select name="server_id">
                {props.servers.map((s) => (
                  <option value={String(s.id)} selected={val('server_id') === String(s.id)}>
                    {s.name} ({s.ip})
                  </option>
                ))}
              </select>
              {props.servers.length === 0 ? <div class="help" style="color:var(--err)">Chưa có server. Thêm trong Cài đặt trước.</div> : null}
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Thương hiệu và nội dung</legend>
          <div class="row">
            <div>
              <label>Tên thương hiệu *</label>
              <input type="text" name="brandName" value={val('brandName')} required />
            </div>
            <div>
              <label>Loại website</label>
              <select name="siteType">
                <option value="business" selected={val('siteType', 'business') === 'business'}>
                  Website doanh nghiệp
                </option>
                <option value="blog" selected={val('siteType') === 'blog'}>
                  Blog vệ tinh
                </option>
              </select>
            </div>
          </div>
          <div class="row">
            <div>
              <label>Ngành / lĩnh vực *</label>
              <input type="text" name="industry" placeholder="Sửa chữa điện lạnh, Thiết kế nội thất, ..." value={val('industry')} required />
            </div>
            <div>
              <label>Khu vực hoạt động</label>
              <input type="text" name="location" placeholder="Quận 7, TP.HCM" value={val('location')} />
            </div>
          </div>
          <label>Mô tả doanh nghiệp</label>
          <textarea name="description" placeholder="Làm gì, cho ai, từ khi nào, thế mạnh gì. Càng cụ thể nội dung càng thật.">
            {val('description')}
          </textarea>
          <div class="row">
            <div>
              <label>
                Dịch vụ / sản phẩm chính <small>mỗi dòng một mục</small>
              </label>
              <textarea name="services">{val('services')}</textarea>
            </div>
            <div>
              <label>
                Từ khóa mục tiêu <small>mỗi dòng hoặc cách nhau dấu phẩy</small>
              </label>
              <textarea name="keywords">{val('keywords')}</textarea>
            </div>
          </div>
          <div class="row">
            <div>
              <label>Khách hàng mục tiêu</label>
              <input type="text" name="targetAudience" value={val('targetAudience')} />
            </div>
            <div>
              <label>Điểm khác biệt</label>
              <input type="text" name="usp" value={val('usp')} />
            </div>
          </div>
          <div class="row">
            <div>
              <label>Giọng văn mong muốn</label>
              <input type="text" name="tone" placeholder="Thân thiện, chuyên nghiệp..." value={val('tone')} />
            </div>
            <div>
              <label>Số bài blog khi tạo</label>
              <input type="number" name="postsCount" min="0" max="20" value={val('postsCount', String(props.general.defaultPostsCount))} />
            </div>
          </div>
          <div class="row">
            <div>
              <label>Ngôn ngữ</label>
              <select name="language">
                <option value="vi" selected={val('language', props.general.defaultLanguage) === 'vi'}>
                  Tiếng Việt
                </option>
                <option value="en" selected={val('language', props.general.defaultLanguage) === 'en'}>
                  English
                </option>
              </select>
            </div>
            <div>
              <label>Giao diện</label>
              <select name="themeId">
                <option value="auto" selected={val('themeId', 'auto') === 'auto'}>
                  Tự chọn ngẫu nhiên (khuyên dùng)
                </option>
                {themeIds().map((t) => (
                  <option value={t.id} selected={val('themeId') === t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label>
            <input type="checkbox" name="useStockImages" value="1" checked={val('useStockImages', '1') === '1'} /> Dùng ảnh stock Pexels cho vị trí chưa có ảnh thật
          </label>
          <div class="help">Bỏ tick nếu chỉ muốn dùng ảnh thật của bạn: sau khi tạo site, vào mục Kho ảnh để tải lên hoặc nhập từ Google Maps.</div>
          <label>Kiểu viết nội dung</label>
          <select name="contentStyle">
            {CONTENT_STYLE_CHOICES.map((s) => (
              <option value={s.id} selected={val('contentStyle', 'auto') === s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div class="help">
            {CONTENT_STYLE_CHOICES.map((s) => (
              <div>
                <b>{s.name}:</b> {s.description}
              </div>
            ))}
          </div>
          <label>Ghi chú thêm cho AI</label>
          <textarea name="notes" placeholder="Ví dụ: không nhắc đến đối thủ, nhấn mạnh bảo hành 12 tháng, kể về bà chủ quán 30 năm nấu hủ tiếu...">
            {val('notes')}
          </textarea>
          <label>Đoạn văn mẫu đã duyệt (tùy chọn)</label>
          <textarea name="styleSamples" placeholder="Dán 2 đến 3 đoạn văn bạn thấy đúng giọng của thương hiệu (bài Facebook, đoạn giới thiệu cũ...). AI học cách xưng hô, mức chuyên môn và độ cụ thể từ đây, không sao chép nguyên văn.">
            {val('styleSamples')}
          </textarea>
        </fieldset>

        <fieldset>
          <legend>Thông tin liên hệ (Entity cơ bản, sửa đầy đủ sau khi tạo)</legend>
          <div class="row">
            <div>
              <label>Loại thực thể</label>
              <select name="entityType">
                <option value="LocalBusiness" selected={val('entityType', 'LocalBusiness') === 'LocalBusiness'}>
                  LocalBusiness (có địa chỉ)
                </option>
                <option value="Organization" selected={val('entityType') === 'Organization'}>
                  Organization
                </option>
                <option value="ProfessionalService" selected={val('entityType') === 'ProfessionalService'}>
                  ProfessionalService
                </option>
                <option value="Store" selected={val('entityType') === 'Store'}>
                  Store
                </option>
              </select>
            </div>
            <div>
              <label>Logo (PNG/JPG/SVG, không bắt buộc)</label>
              <input type="file" name="logo" accept=".png,.jpg,.jpeg,.svg,.webp" />
              <div class="help">Không có logo thì hệ thống tự tạo logo chữ.</div>
            </div>
          </div>
          <div class="row">
            <div>
              <label>Điện thoại</label>
              <input type="text" name="telephone" value={val('telephone')} />
            </div>
            <div>
              <label>Email</label>
              <input type="email" name="email" value={val('email')} />
            </div>
          </div>
          <div class="row">
            <div>
              <label>Địa chỉ (số nhà, đường)</label>
              <input type="text" name="streetAddress" value={val('streetAddress')} />
            </div>
            <div>
              <label>Quận/Huyện, Tỉnh/Thành</label>
              <input type="text" name="addressLocality" placeholder="Quận 7, TP.HCM" value={val('addressLocality')} />
            </div>
          </div>
          <div class="row">
            <div>
              <label>Facebook</label>
              <input type="url" name="facebook" placeholder="https://facebook.com/..." value={val('facebook')} />
            </div>
            <div>
              <label>YouTube / TikTok / khác</label>
              <input type="url" name="youtube" placeholder="https://..." value={val('youtube')} />
            </div>
          </div>
          <div class="row">
            <div>
              <label>Tên tác giả nội dung</label>
              <input type="text" name="authorName" placeholder="Nguyễn Văn A" value={val('authorName')} />
            </div>
            <div>
              <label>Chức danh tác giả</label>
              <input type="text" name="authorTitle" placeholder="Kỹ thuật viên trưởng" value={val('authorTitle')} />
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Bảo mật Cloudflare cho site này</legend>
          <label>
            Quốc gia được phép truy cập <small>mã 2 chữ, cách nhau dấu phẩy; trống = dùng mặc định trong Cài đặt. Truy cập từ nước khác bị chặn, trừ bot đã xác minh và IP server.</small>
          </label>
          <input type="text" name="targetCountries" placeholder={props.general.defaultTargetCountries.join(', ')} value={val('targetCountries')} />
        </fieldset>

        <div class="actions">
          <button class="btn" type="submit" disabled={props.servers.length === 0}>
            Tạo và chạy tự động
          </button>
          <a class="btn secondary" href="/">
            Hủy
          </a>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Chi tiết site                                                       */
/* ------------------------------------------------------------------ */

export function SiteDetail(props: { site: Site; steps: StepRow[]; defs: StepDef[]; pages: PageRow[]; logs: LogRow[]; jobs: JobRow[]; config: AppConfig; server: ServerRow | undefined }) {
  const { site, steps, defs, pages, logs, jobs } = props;
  const byId = new Map(steps.map((s) => [s.step, s]));
  const p = progressOf(defs, steps);
  const waiting = byId.get('cf_wait_active');
  const showNs = waiting && waiting.status !== 'done' && site.cf_name_servers.length > 0;
  const branches: { key: StepDef['branch']; title: string }[] = [
    { key: 'cloudflare', title: 'Nhánh Cloudflare' },
    { key: 'build', title: 'Nhánh dựng website' },
    { key: 'final', title: 'Hoàn tất' },
  ];
  const cfDash = props.config.CLOUDFLARE_ACCOUNT_ID ? `https://dash.cloudflare.com/${props.config.CLOUDFLARE_ACCOUNT_ID}/${site.domain}` : 'https://dash.cloudflare.com/';
  const entityWarnings = validateEntity(site.entity, site.brief.brandName);
  const heldPages = pages.filter((p) => p.status === 'needs_review');
  return (
    <>
      <div class="actions" style="justify-content:space-between;margin-bottom:14px">
        <div>
          <h1 style="margin:0">
            {site.domain} <Badge status={site.status} />
          </h1>
          <div class="muted small">
            {site.brief.brandName} · {site.brief.industry} · {site.brief.siteType === 'blog' ? 'Blog vệ tinh' : 'Doanh nghiệp'} · theme {site.theme?.name ?? 'chưa chọn'}
          </div>
        </div>
        <div class="actions">
          <a class="btn secondary sm" href={`https://${site.domain}/`} target="_blank" rel="noopener">
            Mở site ↗
          </a>
          <a class="btn secondary sm" href={`/sites/${site.id}/preview/`} target="_blank">
            Xem bản dựng
          </a>
          <a class="btn secondary sm" href={cfDash} target="_blank" rel="noopener">
            Cloudflare ↗
          </a>
          <a class="btn secondary sm" href={`/sites/${site.id}/library`}>
            Kho ảnh thật
          </a>
          <a class="btn sm" href={`/sites/${site.id}/editor`} style="background:#16a34a;border-color:#16a34a">
            Chỉnh sửa trực quan
          </a>
          <a class="btn sm" href={`/sites/${site.id}/entity`}>
            Entity SEO
          </a>
        </div>
      </div>

      {site.error_summary ? <div class="alert err">Lỗi gần nhất: {site.error_summary}</div> : null}
      {showNs ? (
        <div class="ns-box" style="margin-bottom:16px">
          <strong>Việc bạn cần làm: đổi nameserver tại Namecheap</strong>
          <p class="small" style="margin:6px 0">
            Vào Namecheap → Domain List → Manage <b>{site.domain}</b> → mục Nameservers chọn <b>Custom DNS</b> và điền hai dòng sau, bấm dấu ✓ để lưu. Hệ thống tự dò mỗi {props.config.NS_POLL_INTERVAL_MIN} phút, thường active sau 5 phút đến vài giờ.
          </p>
          {site.cf_name_servers.map((ns) => (
            <code>{ns}</code>
          ))}
        </div>
      ) : null}

      <div class="grid cols-3" style="margin-bottom:16px">
        <div class="card tight">
          <div class="kv">
            <dt>Tiến độ</dt>
            <dd>
              {p.done}/{p.total} bước ({p.percent}%)
            </dd>
            <dt>Zone Cloudflare</dt>
            <dd>{site.cf_zone_id ? `${site.cf_zone_status ?? ''} · ${site.cf_zone_id.slice(0, 8)}…` : 'chưa tạo'}</dd>
            <dt>aaPanel</dt>
            <dd>{site.panel_site_id ? `#${site.panel_site_id} · ${site.site_path}` : 'chưa thêm'}</dd>
            <dt>Server</dt>
            <dd>{props.server ? `${props.server.name} (${props.server.ip})` : 'chưa gán'}</dd>
          </div>
        </div>
        <div class="card tight">
          <div class="kv">
            <dt>Dựng lần cuối</dt>
            <dd>{formatDateVi(site.last_built_at) || 'chưa'}</dd>
            <dt>Deploy lần cuối</dt>
            <dd>{formatDateVi(site.last_deployed_at) || 'chưa'}</dd>
            <dt>Live từ</dt>
            <dd>{formatDateVi(site.live_at) || 'chưa'}</dd>
            <dt>Google Search Console</dt>
            <dd>{site.google_verified ? 'đã xác minh' : site.google_verification_token ? 'chờ xác minh' : 'chưa cấu hình'}</dd>
          </div>
        </div>
        <div class="card tight">
          <h3 style="margin-bottom:6px">Sức khỏe</h3>
          {site.health ? (
            <div class="small">
              <Badge status={site.health.ok ? 'ok' : 'error'} label={site.health.ok ? 'OK' : 'Có vấn đề'} /> <span class="muted">{formatDateVi(site.health.checkedAt)}</span>
              <div style="margin-top:6px">{site.health.message}</div>
              <div class="muted">
                HTTP {site.health.httpStatus ?? '-'} · {site.health.responseMs ?? '-'}ms · zone {site.health.zoneStatus ?? '-'} · SSL {site.health.sslMode ?? '-'} · WAF {site.health.wafRules ?? '-'} rule
              </div>
            </div>
          ) : (
            <p class="muted small">Chưa kiểm tra. Health check tự chạy mỗi {props.config.HEALTH_CHECK_INTERVAL_MIN} phút khi site live.</p>
          )}
          <form method="post" action={`/sites/${site.id}/jobs/health_check`} class="inline">
            <button class="btn secondary sm" type="submit">
              Kiểm tra ngay
            </button>
          </form>
        </div>
      </div>

      <div class="grid cols-2">
        <div>
          <div class="card">
            <div class="actions" style="justify-content:space-between">
              <h2 style="margin:0">Các bước</h2>
              <div class="actions">
                {site.status === 'paused' ? (
                  <form method="post" action={`/sites/${site.id}/resume`} class="inline">
                    <button class="btn sm" type="submit">
                      Tiếp tục
                    </button>
                  </form>
                ) : (
                  <form method="post" action={`/sites/${site.id}/pause`} class="inline">
                    <button class="btn secondary sm" type="submit">
                      Tạm dừng
                    </button>
                  </form>
                )}
              </div>
            </div>
            {branches.map((b) => (
              <>
                <div class="branch-title">{b.title}</div>
                <div class="steps">
                  {defs
                    .filter((d) => d.branch === b.key)
                    .map((d) => {
                      const s = byId.get(d.id);
                      const status = s?.status ?? 'pending';
                      return (
                        <div class={`step branch-${d.branch}`}>
                          <div>
                            <Badge status={status} />
                            {s?.attempts ? <div class="small muted">lần {s.attempts}</div> : null}
                          </div>
                          <div>
                            <div class="name">{d.label}</div>
                            <div class="desc">{d.description}</div>
                            {s?.message ? <div class="msg">{s.message}</div> : null}
                            {s?.error ? <div class="msg err">{s.error}</div> : null}
                            {s?.next_run_at && (status === 'waiting' || status === 'failed') ? <div class="small muted">Thử lại lúc {formatDateVi(s.next_run_at)}</div> : null}
                          </div>
                          <div class="actions">
                            {status !== 'running' ? (
                              <form method="post" action={`/sites/${site.id}/steps/${d.id}/retry`} class="inline">
                                <button class="btn secondary sm" type="submit" title="Chạy lại bước này">
                                  Chạy lại
                                </button>
                              </form>
                            ) : null}
                            {status === 'done' || status === 'skipped' ? (
                              <form method="post" action={`/sites/${site.id}/steps/${d.id}/rerun-from`} class="inline">
                                <button class="btn secondary sm" type="submit" title="Chạy lại bước này và mọi bước phía sau">
                                  Từ đây
                                </button>
                              </form>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </>
            ))}
          </div>
        </div>
        <div>
          <div class="card" style="margin-bottom:16px">
            <h2>Thao tác</h2>
            <div class="actions">
              <form method="post" action={`/sites/${site.id}/jobs/rebuild_deploy`} class="inline">
                <button class="btn secondary sm" type="submit" disabled={!site.plan}>
                  Dựng lại + deploy
                </button>
              </form>
              <form method="post" action={`/sites/${site.id}/jobs/sync_waf`} class="inline">
                <button class="btn secondary sm" type="submit" disabled={!site.cf_zone_id}>
                  Đồng bộ WAF
                </button>
              </form>
              <a class="btn secondary sm" href={`/sites/${site.id}/edit`}>
                Sửa brief
              </a>
            </div>
            <form method="post" action={`/sites/${site.id}/jobs/generate_post`} style="margin-top:14px">
              <label>Viết thêm bài blog</label>
              <div class="row">
                <input type="text" name="topic" placeholder="Chủ đề (để trống = AI tự đề xuất)" />
                <div class="actions">
                  <input type="number" name="count" min="1" max="5" value="1" style="width:70px" />
                  <button class="btn sm" type="submit" disabled={!site.plan}>
                    Viết
                  </button>
                </div>
              </div>
            </form>
            <details class="panel" style="margin-top:14px">
              <summary style="color:var(--err)">Xóa site</summary>
              <form method="post" action={`/sites/${site.id}/delete`} style="margin-top:8px">
                <label>
                  <input type="checkbox" name="deleteZone" value="1" /> Xóa zone trên Cloudflare
                </label>
                <label>
                  <input type="checkbox" name="deletePanelSite" value="1" /> Xóa site và thư mục trên aaPanel
                </label>
                <label>
                  <input type="checkbox" name="force" value="1" /> Vẫn xóa khỏi dashboard nếu bước trên lỗi
                </label>
                <button class="btn danger sm" type="submit" onclick="return confirm('Xóa site này?')">
                  Xóa
                </button>
              </form>
            </details>
          </div>

          <div class="card" style="margin-bottom:16px">
            <div class="actions" style="justify-content:space-between">
              <h2 style="margin:0">Trang và bài viết ({pages.length})</h2>
              <a class="small" href={`/sites/${site.id}/pages`}>
                Xem tất cả
              </a>
            </div>
            {pages.length === 0 ? (
              <p class="muted small">Chưa có nội dung.</p>
            ) : (
              <table>
                <tbody>
                  {pages.slice(0, 8).map((pg) => (
                    <tr>
                      <td class="small">
                        <a href={`/sites/${site.id}/pages/${pg.id}`}>{pg.title}</a>
                        <div class="muted mono">/{pg.slug}{pg.slug ? '/' : ''}</div>
                      </td>
                      <td class="small muted">{pg.kind}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {heldPages.length ? (
            <div class="alert warn">
              <b>{heldPages.length} trang chưa đạt kiểm duyệt chất lượng</b>, đang giữ lại, chưa đưa lên website: {heldPages.map((p) => p.title).join(' · ')}.{' '}
              <a href={`/sites/${site.id}/pages`}>Xem lỗi, duyệt hoặc sinh lại →</a>
            </div>
          ) : null}
          {entityWarnings.length ? (
            <div class="card" style="margin-bottom:16px">
              <h3>Entity SEO cần bổ sung</h3>
              <ul class="small" style="margin:0;padding-left:18px">
                {entityWarnings.map((w) => (
                  <li>{w}</li>
                ))}
              </ul>
              <a class="btn sm" href={`/sites/${site.id}/entity`} style="margin-top:8px">
                Điền Entity
              </a>
            </div>
          ) : null}

          <div class="card">
            <h2>Tác vụ gần đây</h2>
            {jobs.length === 0 ? (
              <p class="muted small">Chưa có.</p>
            ) : (
              <table>
                <tbody>
                  {jobs.slice(0, 6).map((j) => (
                    <tr>
                      <td class="small">{JOB_LABELS[j.type] ?? j.type}</td>
                      <td>
                        <Badge status={j.status} />
                      </td>
                      <td class="small muted">{formatDateVi(j.finished_at ?? j.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>Log gần đây</h2>
        <LogView logs={logs} />
      </div>
    </>
  );
}

export function LogView(props: { logs: LogRow[] }) {
  if (props.logs.length === 0) return <p class="muted small">Chưa có log.</p>;
  return (
    <div class="log">
      {props.logs.map((l) => (
        <div class={l.level}>
          {formatDateVi(l.created_at)} [{l.step ?? '-'}] {l.message}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Trang nội dung                                                      */
/* ------------------------------------------------------------------ */

function ReviewBadge(props: { page: PageRow }) {
  const r = props.page.review;
  if (props.page.status === 'needs_review') {
    const majors = r?.issues.filter((i) => i.severity === 'major').length ?? 0;
    return (
      <span class="badge waiting" title={r?.issues.map((i) => i.message).join('\n')}>
        Chưa đạt ({majors} lỗi)
      </span>
    );
  }
  if (!r) return <span class="muted" title="Trang viết trước khi có cổng kiểm duyệt. Bấm Kiểm duyệt lại để chấm.">Chưa kiểm</span>;
  const minors = r.issues.filter((i) => i.severity === 'minor').length;
  if (!r.pass) {
    const majors = r.issues.filter((i) => i.severity === 'major').length;
    return (
      <span class="badge failed" title={r.issues.map((i) => i.message).join('\n')}>
        Đã đăng, có {majors} lỗi
      </span>
    );
  }
  return (
    <span class="badge done" title={r.summary ?? ''}>
      {r.approvedBy === 'user' ? 'Người dùng duyệt' : 'Đạt'}
      {minors ? ` · ${minors} góp ý` : ''}
    </span>
  );
}

export function PagesList(props: { site: Site; pages: PageRow[] }) {
  return (
    <div class="card">
      <h1>
        Nội dung: {props.site.domain}
      </h1>
      <p>
        <a href={`/sites/${props.site.id}`}>← Quay lại site</a>
      </p>
      <div class="help" style="margin-bottom:12px">Mỗi trang đi qua cổng kiểm duyệt (kiểm tra tự động + AI duyệt) trước khi đăng. Trang "Chưa đạt" được giữ lại, không dựng và không vào sitemap; bạn xem lỗi trong chi tiết trang rồi sửa bằng Chỉnh sửa trực quan, bấm "Duyệt và đăng" hoặc "Sinh lại". Trang "Chưa kiểm" là trang viết trước khi có cổng kiểm duyệt: bấm "Kiểm duyệt lại tất cả" để chấm mà không viết lại (mỗi trang một lượt gọi AI ngắn).</div>
      <div class="actions" style="margin-bottom:12px">
        <a class="btn sm" href={`/sites/${props.site.id}/posts/new`}>
          + Viết bài thủ công
        </a>
        <form method="post" action={`/sites/${props.site.id}/pages/review`} class="inline">
          <button class="btn secondary sm" type="submit">
            Kiểm duyệt lại tất cả (không viết lại)
          </button>
        </form>
      </div>
      <form method="post" action={`/sites/${props.site.id}/replace-text`} class="card tight" style="margin-bottom:14px;background:var(--bg)">
        <strong>Thay chữ trong toàn bộ nội dung</strong>
        <div class="help">Dùng khi sửa tên thương hiệu, địa chỉ, số điện thoại viết sai ở mọi trang. Phân biệt hoa thường, thay đúng chuỗi đã nhập, xong tự dựng lại và đưa lên host.</div>
        <div class="row">
          <input type="text" name="from" placeholder="Chữ cần thay, ví dụ: Ông Giao" required />
          <input type="text" name="to" placeholder="Chữ thay thế, ví dụ: Ông Giáo" required />
        </div>
        <button class="btn secondary sm" type="submit" style="margin-top:8px" onclick="return confirm('Thay trong toàn bộ trang và bài viết?')">
          Thay và dựng lại
        </button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Trang</th>
            <th>Loại</th>
            <th>Kiểm duyệt</th>
            <th>Cập nhật</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {props.pages.map((pg) => (
            <tr>
              <td>
                <a href={`/sites/${props.site.id}/pages/${pg.id}`}>{pg.title}</a>
                <div class="muted mono small">/{pg.slug}{pg.slug ? '/' : ''}</div>
              </td>
              <td>{pg.kind}</td>
              <td class="small">
                <ReviewBadge page={pg} />
              </td>
              <td class="small muted">{formatDateVi(pg.updated_at)}</td>
              <td>
                <div class="actions">
                  {pg.status === 'needs_review' ? (
                    <form method="post" action={`/sites/${props.site.id}/pages/${pg.id}/approve`} class="inline">
                      <button class="btn sm" type="submit" style="background:#16a34a;border-color:#16a34a" onclick="return confirm('Đăng trang này dù chưa đạt kiểm duyệt?')">
                        Duyệt và đăng
                      </button>
                    </form>
                  ) : null}
                  <a class="btn secondary sm" href={`/sites/${props.site.id}/editor?page=${pg.id}`}>
                    Sửa
                  </a>
                  <form method="post" action={`/sites/${props.site.id}/pages/${pg.id}/regenerate`} class="inline">
                    <button class="btn secondary sm" type="submit" onclick="return confirm('Sinh lại trang này bằng AI?')">
                      Sinh lại
                    </button>
                  </form>
                  {pg.kind === 'post' ? (
                    <form method="post" action={`/sites/${props.site.id}/pages/${pg.id}/delete`} class="inline">
                      <button class="btn danger sm" type="submit" onclick="return confirm('Xóa bài này khỏi website? Đường dẫn cũ sẽ báo 404.')">
                        Xóa
                      </button>
                    </form>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Soạn bài viết thủ công (tạo mới hoặc sửa): markdown một ô, "## " là mục mới. */
export function PostForm(props: { site: Site; pageId?: number; values: ManualPostInput; errors?: string[]; library: LibraryRow[] }) {
  const { site } = props;
  const v = props.values;
  const action = props.pageId ? `/sites/${site.id}/pages/${props.pageId}/edit` : `/sites/${site.id}/posts/new`;
  return (
    <div class="card">
      <p>
        <a href={props.pageId ? `/sites/${site.id}/pages/${props.pageId}` : `/sites/${site.id}/pages`}>← Quay lại</a>
      </p>
      <h1>{props.pageId ? 'Soạn thảo bài viết' : 'Viết bài thủ công'}: {site.domain}</h1>
      <p class="muted">Bài do bạn tự viết được đăng ngay, không qua AI viết lại. Cổng kiểm duyệt vẫn chấm và ghi góp ý để bạn tham khảo, không giữ bài lại.</p>
      {props.errors?.length ? (
        <div class="alert err">
          <ul style="margin:0;padding-left:18px">
            {props.errors.map((e) => (
              <li>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <form method="post" action={action}>
        <div class="row">
          <div>
            <label>
              Tiêu đề (title) <small>50 đến 65 ký tự</small>
            </label>
            <input type="text" name="title" value={v.title} required />
          </div>
          <div>
            <label>
              Đường dẫn <small>để trống = tự tạo từ tiêu đề; nằm dưới /blog/</small>
            </label>
            <input type="text" name="slug" value={v.slug} class="mono" placeholder="vi-du-ten-bai" />
          </div>
        </div>
        <div class="row">
          <div>
            <label>
              H1 <small>để trống = dùng tiêu đề</small>
            </label>
            <input type="text" name="h1" value={v.h1} />
          </div>
          <div>
            <label>Từ khóa mục tiêu</label>
            <input type="text" name="targetKeyword" value={v.targetKeyword} />
          </div>
        </div>
        <label>
          Meta description <small>140 đến 158 ký tự</small>
        </label>
        <textarea name="metaDescription" style="min-height:60px" required>
          {v.metaDescription}
        </textarea>
        <div class="row">
          <div>
            <label>
              Mô tả ngắn <small>1 đến 2 câu, hiện ở danh sách blog</small>
            </label>
            <input type="text" name="excerpt" value={v.excerpt} />
          </div>
          <div>
            <label>Alt ảnh đầu bài</label>
            <input type="text" name="heroImageAlt" value={v.heroImageAlt} />
          </div>
        </div>
        <label>
          Tóm tắt nhanh <small>mỗi dòng một ý, 3 đến 5 ý, để trống nếu không cần</small>
        </label>
        <textarea name="keyTakeaways" style="min-height:70px">
          {v.keyTakeaways}
        </textarea>
        <label>
          Nội dung bài <small>markdown: đoạn mở đầu trước, mỗi "## Tiêu đề mục" bắt đầu một mục; "- " danh sách, **in đậm**, "&gt; **Mẹo:** ..." khung lưu ý, [chữ](/duong-dan/) liên kết</small>
        </label>
        <textarea id="post-body" name="body" style="min-height:420px;font-family:ui-monospace,Consolas,monospace;font-size:.9rem" required>
          {v.body}
        </textarea>
        <div class="card tight" style="margin:8px 0 12px;background:var(--bg)">
          <strong>Chèn ảnh từ kho</strong>
          <div class="help">
            Nhấp một ảnh để chèn vào vị trí con trỏ trong ô nội dung. Ảnh phải nằm trong <a href={`/sites/${site.id}/library`}>Kho ảnh thật</a> (tải lên ở đó trước). Đường dẫn ảnh dạng khác (ví dụ photos/anh.jpg) sẽ bị chặn vì không tồn tại trên website; ảnh từ trang khác dùng địa chỉ https:// đầy đủ.
          </div>
          {props.library.length ? (
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
              {props.library.map((l) => (
                <img src={`/sites/${site.id}/images/file/${l.file.split('/').pop()}`} alt={l.alt} title={l.alt} style="width:96px;height:72px;object-fit:cover;border-radius:6px;cursor:pointer;border:2px solid transparent" data-md={`![${l.alt.replace(/[\[\]]/g, '')}](/assets/img/${l.file.split('/').pop()})`} onclick="var t=document.getElementById('post-body');var md='\n'+this.getAttribute('data-md')+'\n';var a=t.selectionStart||0,b=t.selectionEnd||0;t.value=t.value.slice(0,a)+md+t.value.slice(b);t.selectionStart=t.selectionEnd=a+md.length;t.focus();" />
              ))}
            </div>
          ) : (
            <div class="muted small" style="margin-top:6px">Kho ảnh trống.</div>
          )}
        </div>
        <label>
          Câu hỏi thường gặp <small>mỗi khối cách nhau một dòng trống: dòng đầu là câu hỏi, các dòng sau là trả lời</small>
        </label>
        <textarea name="faq" style="min-height:110px" placeholder={'Hủ tiếu khô hay nước ngon hơn?\nTùy khẩu vị: khô đậm vị nước sốt, nước thanh và nóng lâu.\n\nQuán có giao hàng không?\nCó, trong bán kính 3 km buổi sáng.'}>
          {v.faq}
        </textarea>
        <div class="actions" style="margin-top:12px">
          <button class="btn" type="submit">
            {props.pageId ? 'Lưu bài và dựng lại' : 'Đăng bài và dựng lại'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function PageDetail(props: { site: Site; page: PageRow }) {
  const c = props.page.content;
  // Ảnh kho trong nội dung hiện đúng trên dashboard (bản dựng dùng /assets/img/, dashboard đọc từ cache)
  const previewHtml = (md: string) => mdToHtml(md).replace(/src="\/assets\/img\//g, `src="/sites/${props.site.id}/images/file/`);
  return (
    <div class="card">
      <p>
        <a href={`/sites/${props.site.id}/pages`}>← Danh sách trang</a>
      </p>
      <h1>{c.h1}</h1>
      <div class="actions" style="margin-bottom:12px">
        <a class="btn sm" href={`/sites/${props.site.id}/editor?page=${props.page.id}`}>
          Sửa trực quan
        </a>
        {props.page.kind === 'post' ? (
          <a class="btn secondary sm" href={`/sites/${props.site.id}/pages/${props.page.id}/edit`}>
            Soạn thảo bài (markdown)
          </a>
        ) : null}
        <a class="btn secondary sm" href={`https://${props.site.domain}/${props.page.slug}${props.page.slug ? '/' : ''}`} target="_blank" rel="noopener">
          Mở trên site ↗
        </a>
        {props.page.kind === 'post' ? (
          <form method="post" action={`/sites/${props.site.id}/pages/${props.page.id}/delete`} class="inline">
            <button class="btn danger sm" type="submit" onclick="return confirm('Xóa bài này khỏi website? Đường dẫn cũ sẽ báo 404.')">
              Xóa bài
            </button>
          </form>
        ) : null}
      </div>
      <form method="post" action={`/sites/${props.site.id}/pages/${props.page.id}/meta`} class="card tight" style="margin-bottom:14px;background:var(--bg)">
        <strong>Thông tin SEO (sửa thủ công)</strong>
        <div class="row">
          <div>
            <label>
              Title <small>{c.title.length} ký tự, nên 50 đến 65</small>
            </label>
            <input type="text" name="title" value={c.title} required />
          </div>
          <div>
            <label>
              Đường dẫn <small>{props.page.kind === 'post' ? 'đổi được, đường dẫn cũ sẽ 404' : 'cố định theo loại trang'}</small>
            </label>
            <input type="text" name="slug" value={props.page.slug} readonly={props.page.kind !== 'post'} class="mono" />
          </div>
        </div>
        <label>
          Meta description <small>{c.metaDescription.length} ký tự, nên 140 đến 158</small>
        </label>
        <textarea name="metaDescription" style="min-height:60px">
          {c.metaDescription}
        </textarea>
        <div class="row">
          <div>
            <label>H1</label>
            <input type="text" name="h1" value={c.h1} required />
          </div>
          <div>
            <label>Từ khóa mục tiêu</label>
            <input type="text" name="targetKeyword" value={c.targetKeyword ?? ''} />
          </div>
        </div>
        <div class="row">
          <div>
            <label>
              Alt ảnh đầu trang <small>mô tả ảnh cho Google</small>
            </label>
            <input type="text" name="heroImageAlt" value={c.heroImageAlt ?? ''} />
          </div>
          {props.page.kind === 'post' ? (
            <div>
              <label>
                Mô tả ngắn <small>hiện ở danh sách blog</small>
              </label>
              <input type="text" name="excerpt" value={c.excerpt ?? ''} />
            </div>
          ) : (
            <div />
          )}
        </div>
        <div class="actions" style="margin-top:8px">
          <button class="btn sm" type="submit">
            Lưu thông tin SEO và dựng lại
          </button>
          <span class="small">
            Kiểm duyệt: <ReviewBadge page={props.page} />
            {props.page.review?.summary ? <span class="muted"> {props.page.review.summary}</span> : null}
          </span>
        </div>
      </form>
      {props.page.review?.issues.length ? (
        <div class={`alert ${props.page.status === 'needs_review' || !props.page.review?.pass ? 'warn' : 'info'}`}>
          <b>{props.page.status === 'needs_review' ? 'Lỗi cần sửa trước khi đăng' : props.page.review?.pass ? 'Góp ý của cổng kiểm duyệt' : 'Trang đang đăng nhưng chưa đạt kiểm duyệt'}</b>
          <ul class="small" style="margin:6px 0 0;padding-left:18px">
            {props.page.review.issues.map((i) => (
              <li>
                <b>{i.severity === 'major' ? 'Bắt buộc' : 'Nên'}</b> · <span class="mono">{i.where}</span>: {i.message}
              </li>
            ))}
          </ul>
          <div class="actions" style="margin-top:10px">
            <a class="btn sm" href={`/sites/${props.site.id}/editor?page=${props.page.id}`}>
              Sửa trực quan
            </a>
            {props.page.status === 'needs_review' ? (
              <form method="post" action={`/sites/${props.site.id}/pages/${props.page.id}/approve`} class="inline">
                <button class="btn sm" type="submit" style="background:#16a34a;border-color:#16a34a" onclick="return confirm('Đăng trang này dù chưa đạt kiểm duyệt?')">
                  Duyệt và đăng
                </button>
              </form>
            ) : null}
            <form method="post" action={`/sites/${props.site.id}/pages/${props.page.id}/regenerate`} class="inline">
              <button class="btn secondary sm" type="submit" onclick="return confirm('Sinh lại trang này bằng AI?')">
                Sinh lại
              </button>
            </form>
          </div>
        </div>
      ) : null}
      <form method="post" action={`/sites/${props.site.id}/pages/${props.page.id}/review`} class="inline" style="margin-bottom:12px">
        <button class="btn secondary sm" type="submit">
          Kiểm duyệt lại trang này (không viết lại)
        </button>
      </form>
      <form method="post" action={`/sites/${props.site.id}/pages/${props.page.id}`}>
        <label>Nội dung (JSON, sửa trực tiếp nếu cần)</label>
        <textarea name="content" style="min-height:360px;font-family:ui-monospace,Consolas,monospace;font-size:.82rem">
          {JSON.stringify(c, null, 2)}
        </textarea>
        <div class="actions" style="margin-top:10px">
          <button class="btn" type="submit">
            Lưu và dựng lại
          </button>
          <span class="muted small">Sau khi lưu, site được dựng lại và đưa lên host.</span>
        </div>
      </form>
      <h2 style="margin-top:20px">Xem trước nội dung</h2>
      <div class="prose-preview">
        {raw(previewHtml(c.intro))}
        {c.sections.map((s) => (
          <>
            <h3>{s.heading}</h3>
            {raw(previewHtml(s.body))}
          </>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Kho ảnh thật                                                        */
/* ------------------------------------------------------------------ */

export function LibraryPage(props: { site: Site; library: LibraryRow[]; usedFiles: Map<string, string[]>; hasPlaces: boolean }) {
  const { site } = props;
  return (
    <>
      <div class="actions" style="justify-content:space-between;margin-bottom:14px">
        <div>
          <h1 style="margin:0">Kho ảnh thật: {site.domain}</h1>
          <div class="muted small">Ảnh trong kho được ưu tiên hơn ảnh stock ở mọi vị trí: trang chủ, giới thiệu, dịch vụ, bài viết. {site.brief.useStockImages ? 'Vị trí chưa có ảnh thật sẽ dùng Pexels.' : 'Site này không dùng ảnh stock, vị trí chưa có ảnh thật sẽ để trống.'}</div>
        </div>
        <a class="btn secondary sm" href={`/sites/${site.id}`}>
          ← Quay lại site
        </a>
      </div>
      <div class="grid cols-2">
        <div class="card">
          <h2>Tải ảnh lên</h2>
          <form method="post" action={`/sites/${site.id}/library/upload`} enctype="multipart/form-data">
            <label>Chọn nhiều ảnh (JPG, PNG, WebP; tối đa 15 MB mỗi ảnh)</label>
            <input type="file" name="photos" accept="image/*" multiple required />
            <label>
              Tag chung cho đợt này <small>cách nhau dấu phẩy, ví dụ: mon, hu-tieu, mat-tien, khong-gian</small>
            </label>
            <input type="text" name="tags" placeholder="mon, hu-tieu" />
            <label>Mô tả alt chung (mỗi ảnh được đánh số theo sau)</label>
            <input type="text" name="alt" placeholder={`${site.brief.brandName}`} />
            <p>
              <button class="btn" type="submit">
                Tải lên
              </button>
            </p>
          </form>
        </div>
        <div class="card">
          <h2>Nhập từ Google Maps</h2>
          {props.hasPlaces ? (
            <form method="post" action={`/sites/${site.id}/library/import`}>
              <label>Link Google Maps, link share.google, Place ID hoặc "tên quán, địa chỉ"</label>
              <input type="text" name="query" placeholder="https://share.google/... hoặc Hủ Tiếu Nam Vang Ông Giáo, 89 Văn Cao, Phan Rang" required />
              <label>
                <input type="checkbox" name="includeUserPhotos" value="1" /> Lấy cả ảnh do khách đăng <small>ảnh của khách thuộc bản quyền của họ, chỉ dùng khi bạn đã xin phép</small>
              </label>
              <div class="help">Mặc định chỉ lấy ảnh do chính doanh nghiệp đăng lên hồ sơ Google (tên người đăng trùng tên quán). Google trả tối đa 10 ảnh mỗi lần.</div>
              <p>
                <button class="btn" type="submit">
                  Nhập ảnh
                </button>
              </p>
            </form>
          ) : (
            <p class="muted small">Chưa có Google Maps Platform API key. Nhập trong Cài đặt → Khóa API và dịch vụ, mục Google Maps.</p>
          )}
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="actions" style="justify-content:space-between">
          <h2 style="margin:0">Ảnh trong kho ({props.library.length})</h2>
          <form method="post" action={`/sites/${site.id}/jobs/reassign_images`} class="inline">
            <button class="btn sm" type="submit" disabled={!site.plan || props.library.length === 0}>
              Áp dụng ảnh vào website và dựng lại
            </button>
          </form>
        </div>
        <p class="muted small">Gợi ý tag để hệ thống chọn đúng chỗ: <span class="mono">mat-tien</span> hoặc <span class="mono">hero</span> cho trang chủ, <span class="mono">khong-gian</span>, <span class="mono">mon</span>, tên dịch vụ dạng slug như <span class="mono">hu-tieu-nam-vang</span>, <span class="mono">doi-ngu</span> cho giới thiệu.</p>
        {props.library.length === 0 ? (
          <p class="muted">Chưa có ảnh nào.</p>
        ) : (
          <div class="grid cols-3">
            {props.library.map((img) => (
              <div class="card tight">
                <img src={`/sites/${site.id}/library/file/${img.file.split('/').pop()}`} alt={img.alt} style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px" loading="lazy" />
                <form method="post" action={`/sites/${site.id}/library/${img.id}`}>
                  <label>Alt</label>
                  <input type="text" name="alt" value={img.alt} />
                  <label>Tag</label>
                  <input type="text" name="tags" value={img.tags.join(', ')} />
                  <div class="small muted" style="margin-top:6px">
                    {img.source === 'google' ? 'Từ Google Maps' : 'Tải lên'} · {img.width}×{img.height}
                    {props.usedFiles.get(img.file)?.length ? ` · đang dùng ở ${props.usedFiles.get(img.file)?.length} vị trí` : ' · chưa dùng'}
                  </div>
                  <div class="actions" style="margin-top:8px">
                    <button class="btn secondary sm" type="submit">
                      Lưu
                    </button>
                    <button class="btn danger sm" type="submit" formaction={`/sites/${site.id}/library/${img.id}/delete`} onclick="return confirm('Xóa ảnh này?')">
                      Xóa
                    </button>
                  </div>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Entity                                                              */
/* ------------------------------------------------------------------ */

function EntityTabs(props: { site: Site; active: 'entity' | 'interview' }) {
  const n = answeredCount(props.site.interview);
  return (
    <div class="tabs">
      <a href={`/sites/${props.site.id}/entity`} class={props.active === 'entity' ? 'active' : ''}>
        Entity SEO
      </a>
      <a href={`/sites/${props.site.id}/interview`} class={props.active === 'interview' ? 'active' : ''}>
        Bộ Câu Hỏi ({n}/{INTERVIEW_QUESTIONS.length})
      </a>
    </div>
  );
}

/** Bộ Câu Hỏi: 30 câu phỏng vấn chủ doanh nghiệp, câu trả lời là dữ kiện thật cho Entity và nội dung. */
export function InterviewPage(props: { site: Site; interview: InterviewData | null }) {
  const { site } = props;
  const answers = props.interview?.answers ?? {};
  const n = answeredCount(props.interview);
  return (
    <div class="card">
      <EntityTabs site={site} active="interview" />
      <h1>Bộ Câu Hỏi: {site.domain}</h1>
      <p class="muted">
        30 câu hỏi phủ đủ khía cạnh của doanh nghiệp. Trả lời bằng lời của bạn, càng cụ thể càng tốt, không cần đủ hết. Câu trả lời được dùng làm dữ kiện thật khi lập kế hoạch, viết, biên tập và kiểm duyệt nội dung (AI không được khẳng định điều gì ngoài dữ kiện này), và có thể đưa vào Entity SEO bằng một nút bấm.
      </p>
      <div class="alert info">
        Đã trả lời <b>{n}/{INTERVIEW_QUESTIONS.length}</b> câu{props.interview?.updated_at ? `, cập nhật ${formatDateVi(props.interview.updated_at)}` : ''}. Nên trả lời tối thiểu các câu 1, 3, 4, 5, 10, 15, 19, 28, 29, 30 để có tác dụng rõ.
      </div>
      <form method="post" action={`/sites/${site.id}/interview`}>
        {INTERVIEW_GROUPS.map((g) => (
          <fieldset>
            <legend>{g}</legend>
            {INTERVIEW_QUESTIONS.filter((q) => q.group === g).map((q) => (
              <div style="margin-bottom:12px">
                <label>
                  {q.id.replace('q', '')}. {q.text}
                </label>
                <textarea name={`a_${q.id}`} placeholder={q.hint} style="min-height:64px">
                  {answers[q.id] ?? ''}
                </textarea>
              </div>
            ))}
          </fieldset>
        ))}
        <div class="actions" style="margin-top:12px;position:sticky;bottom:0;background:#fff;padding:10px 0;border-top:1px solid var(--line)">
          <button class="btn" type="submit" name="action" value="save">
            Lưu câu trả lời
          </button>
          <button class="btn secondary" type="submit" name="action" value="apply">
            Lưu và cập nhật Entity bằng AI (chỉ điền ô trống)
          </button>
          <button class="btn secondary" type="submit" name="action" value="apply_overwrite" onclick="return confirm('Ghi đè các trường Entity đã có bằng thông tin rút từ câu trả lời?')">
            Lưu và ghi đè Entity
          </button>
        </div>
      </form>
    </div>
  );
}

export function EntityForm(props: { site: Site; entity: EntityData; warnings: string[]; autoSync: boolean }) {
  const e = props.entity;
  const { site } = props;
  const T = (name: string, label: string, value: string, help?: string, type = 'text') => (
    <div>
      <label>
        {label} {help ? <small>{help}</small> : null}
      </label>
      <input type={type} name={name} value={value} />
    </div>
  );
  return (
    <div class="card">
      <EntityTabs site={site} active="entity" />
      <h1>Entity SEO: {site.domain}</h1>
      <p class="muted">
        Dữ liệu này sinh ra JSON-LD (Organization/LocalBusiness, WebSite, Person, BreadcrumbList, BlogPosting, FAQPage), thẻ Open Graph, mã theo dõi và thẻ xác minh. Lưu là website được dựng lại và đưa lên host{props.autoSync ? ' ngay lập tức' : ''}.
      </p>
      {props.warnings.length ? (
        <div class="alert warn">
          <ul style="margin:0;padding-left:18px">
            {props.warnings.map((w) => (
              <li>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <form method="post" action={`/sites/${site.id}/entity`}>
        <fieldset>
          <legend>Tổ chức</legend>
          <div class="row">
            <div>
              <label>Loại thực thể</label>
              <select name="type">
                {['LocalBusiness', 'Organization', 'ProfessionalService', 'Store', 'Restaurant', 'MedicalBusiness', 'HomeAndConstructionBusiness', 'Person'].map((t) => (
                  <option value={t} selected={e.type === t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>
                Tên hiển thị <small>trống = {site.brief.brandName}</small>
              </label>
              <input type="text" name="name" value={e.name} />
              <label style="font-weight:400">
                <input type="checkbox" name="syncBrand" value="1" checked /> Đồng bộ "Thương hiệu" trong brief theo tên này (dùng cho tiêu đề, logo chữ, nội dung AI)
              </label>
            </div>
          </div>
          <div class="row">
            {T('legalName', 'Tên pháp lý', e.legalName)}
            {T('alternateName', 'Tên khác', e.alternateName.join(', '), 'cách nhau dấu phẩy')}
          </div>
          <label>Mô tả ngắn (1 đến 2 câu, dùng cho schema và footer)</label>
          <textarea name="description">{e.description}</textarea>
          <div class="row">
            {T('foundingDate', 'Năm/ngày thành lập', e.foundingDate, 'YYYY hoặc YYYY-MM-DD')}
            {T('founder', 'Người sáng lập', e.founder)}
          </div>
          <div class="row">
            {T('founderSameAs', 'Hồ sơ người sáng lập', e.founderSameAs.join(', '), 'URL, cách nhau dấu phẩy')}
            {T('taxId', 'Mã số thuế', e.taxId)}
          </div>
        </fieldset>
        <fieldset>
          <legend>Liên hệ và địa điểm</legend>
          <div class="row">
            {T('telephone', 'Điện thoại', e.telephone)}
            {T('email', 'Email', e.email, undefined, 'email')}
          </div>
          <div class="row">
            {T('streetAddress', 'Số nhà, đường', e.address.streetAddress)}
            {T('addressLocality', 'Quận/Huyện, Thành phố', e.address.addressLocality)}
          </div>
          <div class="row">
            {T('addressRegion', 'Tỉnh/Thành (region)', e.address.addressRegion)}
            {T('postalCode', 'Mã bưu chính', e.address.postalCode)}
          </div>
          <div class="row">
            {T('addressCountry', 'Mã quốc gia', e.address.addressCountry, 'VN')}
            {T('areaServed', 'Khu vực phục vụ', e.areaServed.join(', '), 'cách nhau dấu phẩy')}
          </div>
          <div class="row">
            {T('lat', 'Vĩ độ (lat)', e.geo.lat)}
            {T('lng', 'Kinh độ (lng)', e.geo.lng)}
          </div>
          <div class="row">
            {T('openingHours', 'Giờ mở cửa', e.openingHours.join('; '), 'định dạng schema, ví dụ "Mo-Fr 08:00-17:30; Sa 08:00-12:00"')}
            {T('priceRange', 'Khoảng giá', e.priceRange, 'ví dụ $$ hoặc 200.000đ - 2.000.000đ')}
          </div>
          {T('mapEmbedUrl', 'Google Maps embed URL', e.mapEmbedUrl, 'Chia sẻ → Nhúng bản đồ → lấy src của iframe (https://www.google.com/maps/embed?...)', 'url')}
        </fieldset>
        <fieldset>
          <legend>Mạng xã hội (sameAs)</legend>
          <div class="row">
            {T('facebook', 'Facebook', e.sameAs.facebook, undefined, 'url')}
            {T('youtube', 'YouTube', e.sameAs.youtube, undefined, 'url')}
          </div>
          <div class="row">
            {T('tiktok', 'TikTok', e.sameAs.tiktok, undefined, 'url')}
            {T('instagram', 'Instagram', e.sameAs.instagram, undefined, 'url')}
          </div>
          <div class="row">
            {T('linkedin', 'LinkedIn', e.sameAs.linkedin, undefined, 'url')}
            {T('x', 'X (Twitter)', e.sameAs.x, undefined, 'url')}
          </div>
          <div class="row">
            {T('pinterest', 'Pinterest', e.sameAs.pinterest, undefined, 'url')}
            {T('zalo', 'Zalo', e.sameAs.zalo, undefined, 'url')}
          </div>
          <div class="row">
            {T('googleMaps', 'Google Maps (link chia sẻ)', e.sameAs.googleMaps, undefined, 'url')}
            {T('wikipedia', 'Wikipedia', e.sameAs.wikipedia, undefined, 'url')}
          </div>
          {T('otherSameAs', 'Liên kết khác', e.sameAs.other.join(', '), 'URL, cách nhau dấu phẩy')}
        </fieldset>
        <fieldset>
          <legend>Tác giả nội dung (E-E-A-T)</legend>
          <div class="row">
            {T('authorName', 'Tên', e.author.name)}
            {T('authorJobTitle', 'Chức danh', e.author.jobTitle)}
          </div>
          <label>Tiểu sử ngắn</label>
          <textarea name="authorBio">{e.author.bio}</textarea>
          {T('authorSameAs', 'Hồ sơ tác giả', e.author.sameAs.join(', '), 'URL, cách nhau dấu phẩy')}
        </fieldset>
        <fieldset>
          <legend>Theo dõi và xác minh</legend>
          <div class="row">
            {T('ga4Id', 'Google Analytics 4', e.ga4Id, 'G-XXXXXXX')}
            {T('gtmId', 'Google Tag Manager', e.gtmId, 'GTM-XXXXXXX (nếu có thì GA4 nhúng qua GTM)')}
          </div>
          <div class="row">
            {T('googleSiteVerification', 'Google site verification', e.googleSiteVerification, 'nội dung thẻ meta; trống = tự động nếu đã cấu hình service account')}
            {T('bingSiteVerification', 'Bing msvalidate.01', e.bingSiteVerification)}
          </div>
        </fieldset>
        <div class="actions">
          <button class="btn" type="submit">
            Lưu và đồng bộ lên website
          </button>
          <a class="btn secondary" href={`/sites/${site.id}`}>
            Quay lại
          </a>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sửa brief                                                           */
/* ------------------------------------------------------------------ */

export function EditBriefForm(props: { site: Site; servers: ServerRow[] }) {
  const b = props.site.brief;
  return (
    <div class="card">
      <h1>Sửa brief: {props.site.domain}</h1>
      <p class="muted">Thay đổi brief không tự viết lại nội dung đã có. Dùng "Sinh lại" ở từng trang nếu muốn áp dụng brief mới.</p>
      <form method="post" action={`/sites/${props.site.id}/edit`} enctype="multipart/form-data">
        <div class="row">
          <div>
            <label>Tên thương hiệu</label>
            <input type="text" name="brandName" value={b.brandName} required />
            <div class="help">Đổi tên sẽ thay luôn trong nội dung đã viết, logo chữ và tiêu đề.</div>
          </div>
          <div>
            <label>
              Logo <small>{props.site.logo_file ? 'đang dùng logo bạn tải lên' : 'đang dùng logo chữ tự tạo'}</small>
            </label>
            <input type="file" name="logo" accept=".png,.jpg,.jpeg,.svg,.webp" />
            {props.site.logo_file ? (
              <label style="font-weight:400">
                <input type="checkbox" name="removeLogo" value="1" /> Xóa logo đã tải, quay về logo chữ
              </label>
            ) : null}
            <div class="help">PNG nền trong suốt cho đẹp nhất. Tải logo mới là site tự dựng lại.</div>
          </div>
          <div>
            <label>Server</label>
            <select name="server_id">
              {props.servers.map((s) => (
                <option value={String(s.id)} selected={props.site.server_id === s.id}>
                  {s.name} ({s.ip})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div class="row">
          <div>
            <label>Ngành</label>
            <input type="text" name="industry" value={b.industry} required />
          </div>
          <div>
            <label>Khu vực</label>
            <input type="text" name="location" value={b.location} />
          </div>
        </div>
        <label>Mô tả</label>
        <textarea name="description">{b.description}</textarea>
        <div class="row">
          <div>
            <label>Dịch vụ (mỗi dòng)</label>
            <textarea name="services">{b.services.join('\n')}</textarea>
          </div>
          <div>
            <label>Từ khóa</label>
            <textarea name="keywords">{b.keywords.join('\n')}</textarea>
          </div>
        </div>
        <div class="row">
          <div>
            <label>Khách hàng mục tiêu</label>
            <input type="text" name="targetAudience" value={b.targetAudience} />
          </div>
          <div>
            <label>Điểm khác biệt</label>
            <input type="text" name="usp" value={b.usp} />
          </div>
        </div>
        <div class="row">
          <div>
            <label>Giọng văn</label>
            <input type="text" name="tone" value={b.tone} />
          </div>
          <div>
            <label>Giao diện</label>
            <select name="themeId">
              <option value="auto" selected={b.themeId === 'auto'}>
                Tự chọn
              </option>
              {themeIds().map((t) => (
                <option value={t.id} selected={b.themeId === t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <div class="help">Đổi giao diện: chọn theme rồi bấm "Đổi theme và dựng lại" bên dưới.</div>
          </div>
        </div>
        <label>Quốc gia được phép truy cập (WAF)</label>
        <input type="text" name="targetCountries" value={b.targetCountries.join(', ')} />
        <label>Kiểu viết nội dung</label>
        <select name="contentStyle">
          {CONTENT_STYLE_CHOICES.map((s) => (
            <option value={s.id} selected={b.contentStyle === s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div class="help">Đổi kiểu viết chỉ áp dụng cho bài sinh lại hoặc bài mới; kế hoạch nội dung hiện có giữ kiểu cũ. Muốn đổi toàn bộ, chạy lại từ bước "Lập kế hoạch nội dung".</div>
        <label>
          <input type="checkbox" name="useStockImages" value="1" checked={b.useStockImages} /> Dùng ảnh stock Pexels cho vị trí chưa có ảnh thật
        </label>
        <label>Ghi chú cho AI</label>
        <textarea name="notes">{b.notes}</textarea>
        <label>Đoạn văn mẫu đã duyệt (tùy chọn)</label>
        <textarea name="styleSamples" placeholder="Dán 2 đến 3 đoạn văn đúng giọng thương hiệu. AI học cách xưng hô, mức chuyên môn và độ cụ thể từ đây.">
          {b.styleSamples}
        </textarea>
        <div class="help">Áp dụng cho bài viết mới và trang sinh lại.</div>
        <div class="actions" style="margin-top:12px">
          <button class="btn" type="submit" name="action" value="save">
            Lưu
          </button>
          <button class="btn secondary" type="submit" name="action" value="retheme">
            Đổi theme và dựng lại
          </button>
          <a class="btn secondary" href={`/sites/${props.site.id}`}>
            Quay lại
          </a>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cài đặt                                                             */
/* ------------------------------------------------------------------ */

export interface SecretView {
  info: { set: boolean; hint: string; updatedAt: string | null; broken: boolean };
  source: 'dashboard' | 'env' | 'none';
}

export interface IntegrationView {
  cloudflare: SecretView & { accountId: string };
  anthropic: SecretView & { model: string; editorModel: string };
  pexels: SecretView;
  google: SecretView & { ownerEmail: string; serviceAccountEmail: string };
  googleMaps: SecretView;
  telegram: SecretView & { chatId: string };
}

function SecretStatus(props: { v: SecretView }) {
  const { info, source } = props.v;
  if (info.broken) return <span class="pill off">Không giải mã được, nhập lại</span>;
  if (source === 'dashboard') return <span class="pill on">Đã lưu trên dashboard {info.hint}</span>;
  if (source === 'env') return <span class="pill on">Đang dùng từ file .env</span>;
  return <span class="pill off">Chưa có</span>;
}

function SecretField(props: { name: string; label: string; help?: string; v: SecretView; textarea?: boolean }) {
  return (
    <div>
      <label>
        {props.label} <SecretStatus v={props.v} />
      </label>
      {props.textarea ? (
        <textarea name={props.name} placeholder={props.v.info.set || props.v.source === 'env' ? 'Dán nội dung mới để thay, để trống để giữ nguyên' : 'Dán nội dung JSON'} style="min-height:80px;font-family:ui-monospace,Consolas,monospace;font-size:.8rem"></textarea>
      ) : (
        <input type="password" name={props.name} autocomplete="new-password" placeholder={props.v.info.set || props.v.source === 'env' ? 'Dán khóa mới để thay, để trống để giữ nguyên' : 'Dán khóa'} />
      )}
      <div class="help">
        {props.help ?? ''}
        {props.v.info.set ? (
          <label style="display:inline;font-weight:400;margin-left:8px">
            <input type="checkbox" name={`delete_${props.name}`} value="1" /> Xóa khóa đã lưu
          </label>
        ) : null}
      </div>
    </div>
  );
}

export function IntegrationsForm(props: { integ: IntegrationView }) {
  const i = props.integ;
  return (
    <div class="card" style="margin-bottom:16px">
      <h2>Khóa API và dịch vụ</h2>
      <p class="muted small">Khóa được mã hóa trước khi lưu và không bao giờ hiển thị lại, chỉ thấy trạng thái và 4 ký tự cuối. Để trống ô nào là giữ nguyên khóa hiện có. Khóa nhập ở đây được ưu tiên hơn file .env và có hiệu lực ngay, không cần khởi động lại.</p>
      <form method="post" action="/settings/integrations">
        <fieldset>
          <legend>Cloudflare</legend>
          <div class="row">
            <SecretField name="cloudflare_token" label="API Token" v={i.cloudflare} help="My Profile → API Tokens → Create Token → Custom token. Quyền: Zone Edit, DNS Edit, Zone Settings Edit, Zone WAF Edit, Bot Management Edit, Account Settings Read. Zone Resources: All zones from an account." />
            <div>
              <label>Account ID</label>
              <input type="text" name="cloudflare_account_id" value={i.cloudflare.accountId} placeholder="32 ký tự, ở cột phải trang Overview của domain" />
            </div>
          </div>
        </fieldset>
        <fieldset>
          <legend>Claude (viết nội dung)</legend>
          <div class="row">
            <SecretField name="anthropic_key" label="Anthropic API key" v={i.anthropic} help="platform.claude.com → API Keys." />
            <div>
              <label>Model</label>
              <input type="text" name="anthropic_model" value={i.anthropic.model} placeholder="claude-opus-5" />
              <div class="help">claude-opus-5 chất lượng cao nhất, claude-sonnet-5 rẻ hơn.</div>
            </div>
          </div>
        </fieldset>
        <fieldset>
          <legend>Pexels (ảnh)</legend>
          <SecretField name="pexels_key" label="Pexels API key" v={i.pexels} help="pexels.com/api → Get Started, miễn phí." />
        </fieldset>
        <fieldset>
          <legend>Google Search Console (tùy chọn)</legend>
          <SecretField name="google_sa_json" label="Service account JSON" v={i.google} textarea help="Google Cloud → bật Site Verification API và Search Console API → Service Accounts → Keys → tạo JSON, mở file và dán toàn bộ nội dung." />
          {i.google.serviceAccountEmail ? (
            <p class="small">
              Service account đang dùng: <span class="mono">{i.google.serviceAccountEmail}</span>
            </p>
          ) : null}
          <label>Gmail của bạn để được thêm làm chủ sở hữu property</label>
          <input type="email" name="google_owner_email" value={i.google.ownerEmail} />
        </fieldset>
        <fieldset>
          <legend>Google Maps (nhập ảnh thật của quán, tùy chọn)</legend>
          <SecretField name="google_maps_key" label="Google Maps Platform API key" v={i.googleMaps} help="Google Cloud → APIs & Services → bật 'Places API (New)' → Credentials → API key. Cần gắn tài khoản thanh toán, dùng trong hạn mức miễn phí hàng tháng." />
        </fieldset>
        <fieldset>
          <legend>Telegram cảnh báo (tùy chọn)</legend>
          <div class="row">
            <SecretField name="telegram_token" label="Bot token" v={i.telegram} help="Tạo bot với @BotFather." />
            <div>
              <label>Chat ID</label>
              <input type="text" name="telegram_chat_id" value={i.telegram.chatId} placeholder="Lấy bằng @userinfobot" />
            </div>
          </div>
        </fieldset>
        <div class="actions">
          <button class="btn" type="submit">
            Lưu khóa
          </button>
          <span class="muted small">Sau khi lưu, bấm các nút kiểm tra bên dưới để xác nhận.</span>
        </div>
      </form>
    </div>
  );
}

export function PasswordForm(props: { user: string; source: 'dashboard' | 'env' | 'none' }) {
  return (
    <div class="card" style="margin-bottom:16px">
      <h2>Tài khoản dashboard</h2>
      <p class="muted small">
        Đang đăng nhập bằng tài khoản <b>{props.user}</b>, mật khẩu {props.source === 'dashboard' ? 'đặt trên dashboard' : 'lấy từ file .env'}. Mật khẩu chỉ lưu dạng băm, không xem lại được.
      </p>
      <form method="post" action="/settings/password">
        <div class="row">
          <div>
            <label>Mật khẩu hiện tại</label>
            <input type="password" name="current" autocomplete="current-password" required />
          </div>
          <div>
            <label>Tài khoản mới</label>
            <input type="text" name="user" value={props.user} autocomplete="username" required />
          </div>
        </div>
        <div class="row">
          <div>
            <label>Mật khẩu mới (ít nhất 8 ký tự)</label>
            <input type="password" name="password" autocomplete="new-password" required minlength={8} />
          </div>
          <div>
            <label>Nhập lại mật khẩu mới</label>
            <input type="password" name="confirm" autocomplete="new-password" required minlength={8} />
          </div>
        </div>
        <p>
          <button class="btn secondary" type="submit">
            Đổi mật khẩu
          </button>
        </p>
      </form>
    </div>
  );
}

export function SettingsPage(props: { waf: WafSettings; general: GeneralSettings; servers: ServerRow[]; config: AppConfig; status: IntegrationStatus; integ: IntegrationView; account: { user: string; source: 'dashboard' | 'env' | 'none' }; tests?: Record<string, { ok: boolean; message: string }> }) {
  const st = props.status;
  const pill = (on: boolean, label: string) => <span class={`pill ${on ? 'on' : 'off'}`}>{label}</span>;
  return (
    <>
      <h1>Cài đặt</h1>
      <IntegrationsForm integ={props.integ} />
      <PasswordForm user={props.account.user} source={props.account.source} />
      <div class="grid cols-2">
        <div class="card">
          <h2>Kiểm tra kết nối</h2>
          <p class="small">
            {pill(st.cloudflare, 'Cloudflare')} {pill(st.aapanel, 'aaPanel')} {pill(st.ssh, 'SSH')} {pill(st.anthropic, 'Claude')} {pill(st.pexels, 'Pexels')} {pill(st.google, 'Google SC')} {pill(st.telegram, 'Telegram')} {st.mock ? pill(true, 'MOCK') : null}
          </p>
          <div class="actions">
            <form method="post" action="/settings/test/cloudflare" class="inline">
              <button class="btn secondary sm" type="submit">
                Kiểm tra Cloudflare
              </button>
            </form>
            <form method="post" action="/settings/test/aapanel" class="inline">
              <button class="btn secondary sm" type="submit">
                Kiểm tra aaPanel
              </button>
            </form>
            <form method="post" action="/settings/test/ssh" class="inline">
              <button class="btn secondary sm" type="submit">
                Kiểm tra SSH
              </button>
            </form>
            <form method="post" action="/settings/test/claude" class="inline">
              <button class="btn secondary sm" type="submit">
                Kiểm tra Claude
              </button>
            </form>
            <form method="post" action="/settings/test/pexels" class="inline">
              <button class="btn secondary sm" type="submit">
                Kiểm tra Pexels
              </button>
            </form>
          </div>
          {props.tests
            ? Object.entries(props.tests).map(([k, v]) => (
                <div class={`alert ${v.ok ? 'ok' : 'err'}`} style="margin-top:10px">
                  {k}: {v.message}
                </div>
              ))
            : null}
        </div>
        <div class="card">
          <h2>Mặc định khi tạo site</h2>
          <form method="post" action="/settings/general">
            <div class="row">
              <div>
                <label>Ngôn ngữ</label>
                <select name="defaultLanguage">
                  <option value="vi" selected={props.general.defaultLanguage === 'vi'}>
                    Tiếng Việt
                  </option>
                  <option value="en" selected={props.general.defaultLanguage === 'en'}>
                    English
                  </option>
                </select>
              </div>
              <div>
                <label>Số bài blog</label>
                <input type="number" name="defaultPostsCount" min="0" max="20" value={String(props.general.defaultPostsCount)} />
              </div>
            </div>
            <label>Quốc gia mục tiêu mặc định</label>
            <input type="text" name="defaultTargetCountries" value={props.general.defaultTargetCountries.join(', ')} />
            <label>Kiểu viết nội dung mặc định</label>
            <select name="defaultContentStyle">
              {CONTENT_STYLE_CHOICES.map((s) => (
                <option value={s.id} selected={props.general.defaultContentStyle === s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <label>
              <input type="checkbox" name="autoSyncEntity" value="1" checked={props.general.autoSyncEntity} /> Lưu Entity là dựng lại và deploy ngay
            </label>
            <label>
              <input type="checkbox" name="autoSubmitSitemap" value="1" checked={props.general.autoSubmitSitemap} /> Tự gửi sitemap (Google, IndexNow)
            </label>
            <p>
              <button class="btn" type="submit">
                Lưu
              </button>
            </p>
          </form>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>WAF Cloudflare mặc định</h2>
        <p class="muted small">Áp dụng cho site mới và khi bấm "Đồng bộ WAF". Gói Free: tối đa 5 custom rule, 1 rule rate limit, chu kỳ và thời gian chặn cố định 10 giây. Rule được cài theo đúng thứ tự 1, 2, 3.</p>
        <form method="post" action="/settings/waf">
          <fieldset>
            <legend>Rule 1. Skip Bot</legend>
            <label>
              <input type="checkbox" name="skipVerifiedBots" value="1" checked={props.waf.skipVerifiedBots} /> Bot đã xác minh (Googlebot, Bingbot...) bỏ qua mọi rule còn lại, rate limit, WAF managed và Super Bot Fight Mode
            </label>
            <div class="help mono">(cf.client.bot) → skip</div>
          </fieldset>
          <fieldset>
            <legend>Rule 2. Chặn quốc tế</legend>
            <div class="row">
              <div>
                <label>Quốc gia được phép, mã 2 chữ, cách nhau dấu phẩy</label>
                <input type="text" name="allowedCountries" value={props.waf.allowedCountries.join(', ')} />
              </div>
              <div>
                <label style="margin-top:34px">
                  <input type="checkbox" name="geoBlockEnabled" value="1" checked={props.waf.geoBlockEnabled} /> Bật rule chặn mọi truy cập ngoài các quốc gia trên
                </label>
              </div>
            </div>
            <div class="help mono">(ip.src.country ne "VN") and (not ip.src in {'{'}IP server{'}'}) → block. IP server được miễn để hệ thống tự kiểm tra site.</div>
          </fieldset>
          <fieldset>
            <legend>Rule 3. Chặn /? phiên bản 7</legend>
            <label>
              <input type="checkbox" name="blockQueryStrings" value="1" checked={props.waf.blockQueryStrings} /> Chặn URL chứa "/?" trừ khi query có một trong các từ cho phép
            </label>
            <div class="row">
              <div>
                <label>Từ cho phép trong query, mỗi dòng</label>
                <textarea name="allowedQueryTerms" style="min-height:120px">
                  {props.waf.allowedQueryTerms.join('\n')}
                </textarea>
              </div>
              <div>
                <label>Đường dẫn luôn bị chặn, mỗi dòng</label>
                <textarea name="blockedPaths" style="min-height:120px">
                  {props.waf.blockedPaths.join('\n')}
                </textarea>
              </div>
            </div>
          </fieldset>
          <fieldset>
            <legend>Rate limit</legend>
            <label>Số request / 10 giây mỗi IP, vượt là chặn 10 giây</label>
            <input type="number" name="requestsPerPeriod" min="10" max="1000" value={String(props.waf.rateLimit.requestsPerPeriod)} style="max-width:200px" />
            <div class="help mono">(starts_with(http.request.uri.path, "/")) đếm theo ip.src + cf.colo.id</div>
          </fieldset>
          <div class="actions" style="margin-top:12px">
            <button class="btn" type="submit">
              Lưu
            </button>
            <button class="btn secondary" type="submit" formaction="/settings/waf-sync-all">
              Lưu và đồng bộ tất cả site
            </button>
          </div>
        </form>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>Server aaPanel</h2>
        <table>
          <thead>
            <tr>
              <th>Tên</th>
              <th>IP</th>
              <th>Panel</th>
              <th>SSH</th>
              <th>Thư mục web</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {props.servers.map((s) => (
              <tr>
                <td>
                  {s.name} {s.from_env ? <span class="pill">.env</span> : null}
                </td>
                <td class="mono">{s.ip}</td>
                <td class="mono small">{s.panel_url}</td>
                <td class="mono small">
                  {s.ssh_user}@{s.ssh_host}:{s.ssh_port}
                </td>
                <td class="mono small">{s.web_root}</td>
                <td>
                  <form method="post" action={`/settings/servers/${s.id}/delete`} class="inline">
                    <button class="btn danger sm" type="submit" onclick="return confirm('Xóa server này?')">
                      Xóa
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <details class="panel" style="margin-top:12px">
          <summary>Thêm server</summary>
          <form method="post" action="/settings/servers">
            <div class="row">
              <div>
                <label>Tên</label>
                <input type="text" name="name" required />
              </div>
              <div>
                <label>IP public</label>
                <input type="text" name="ip" required />
              </div>
            </div>
            <div class="row">
              <div>
                <label>URL panel (https://IP:PORT)</label>
                <input type="text" name="panel_url" required />
              </div>
              <div>
                <label>API key aaPanel</label>
                <input type="password" name="panel_api_key" required />
              </div>
            </div>
            <div class="row">
              <div>
                <label>SSH host</label>
                <input type="text" name="ssh_host" />
              </div>
              <div>
                <label>SSH port</label>
                <input type="number" name="ssh_port" value="22" />
              </div>
            </div>
            <div class="row">
              <div>
                <label>SSH user</label>
                <input type="text" name="ssh_user" value="root" />
              </div>
              <div>
                <label>Đường dẫn khóa private trên máy chạy dashboard</label>
                <input type="text" name="ssh_key_path" placeholder="./secrets/id_ed25519" />
              </div>
            </div>
            <div class="row">
              <div>
                <label>Mật khẩu SSH (nếu không dùng khóa)</label>
                <input type="password" name="ssh_password" />
              </div>
              <div>
                <label>Thư mục web gốc</label>
                <input type="text" name="web_root" value="/www/wwwroot" />
              </div>
            </div>
            <p>
              <button class="btn" type="submit">
                Thêm
              </button>
            </p>
          </form>
        </details>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Jobs & logs                                                         */
/* ------------------------------------------------------------------ */

export function JobsPage(props: { jobs: JobRow[]; sites: Map<number, string>; active: number }) {
  return (
    <div class="card">
      <h1>Tác vụ</h1>
      <p class="muted small">Đang chạy: {props.active}. Trang tự làm mới mỗi 10 giây.</p>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Loại</th>
            <th>Site</th>
            <th>Trạng thái</th>
            <th>Lần</th>
            <th>Tạo lúc</th>
            <th>Kết thúc</th>
            <th>Lỗi</th>
          </tr>
        </thead>
        <tbody>
          {props.jobs.map((j) => (
            <tr>
              <td class="muted">{j.id}</td>
              <td>{JOB_LABELS[j.type] ?? j.type}</td>
              <td>{j.site_id ? <a href={`/sites/${j.site_id}`}>{props.sites.get(j.site_id) ?? j.site_id}</a> : '-'}</td>
              <td>
                <Badge status={j.status} />
              </td>
              <td>
                {j.attempts}/{j.max_attempts}
              </td>
              <td class="small muted">{formatDateVi(j.created_at)}</td>
              <td class="small muted">{formatDateVi(j.finished_at)}</td>
              <td class="small" style="color:var(--err)">
                {j.error ? truncate(j.error, 120) : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LogsPage(props: { logs: LogRow[]; sites: Map<number, string>; level: string; siteId?: number }) {
  return (
    <div class="card">
      <h1>Log</h1>
      <form method="get" action="/logs" class="actions" style="margin-bottom:12px">
        <select name="level" style="width:auto">
          <option value="" selected={!props.level}>
            Mọi mức
          </option>
          <option value="error" selected={props.level === 'error'}>
            Chỉ lỗi
          </option>
          <option value="warn" selected={props.level === 'warn'}>
            Cảnh báo
          </option>
        </select>
        <select name="site" style="width:auto">
          <option value="">Mọi site</option>
          {[...props.sites.entries()].map(([id, d]) => (
            <option value={String(id)} selected={props.siteId === id}>
              {d}
            </option>
          ))}
        </select>
        <button class="btn secondary sm" type="submit">
          Lọc
        </button>
      </form>
      <div class="log">
        {props.logs.map((l) => (
          <div class={l.level}>
            {formatDateVi(l.created_at)} {l.site_id ? `[${props.sites.get(l.site_id) ?? l.site_id}]` : ''} [{l.step ?? '-'}] {l.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export { STATUS_LABEL };
export type { Db };
