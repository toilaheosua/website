import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.js';
import { nowIso, safeJsonParse } from '../core/util.js';
import type { ContentReview } from '../generator/quality.js';
import type { InterviewData } from '../core/interview.js';
import {
  EntitySchema,
  GeneralSettingsSchema,
  SiteBriefSchema,
  WafSettingsSchema,
  type EntityData,
  type GeneralSettings,
  type HealthReport,
  type PageContent,
  type SiteBrief,
  type SitePlan,
  type SiteStatus,
  type StepStatus,
  type ThemeConfig,
  type WafSettings,
} from '../core/types.js';

/* ------------------------------------------------------------------ */
/*  Kiểu dòng dữ liệu                                                   */
/* ------------------------------------------------------------------ */

export interface ServerRow {
  id: number;
  name: string;
  ip: string;
  panel_url: string;
  panel_api_key: string;
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
  ssh_key_path: string;
  ssh_password: string;
  web_root: string;
  php_version: string;
  from_env: number;
  created_at: string;
}

export interface SiteRow {
  id: number;
  domain: string;
  server_id: number | null;
  status: SiteStatus;
  brief: string;
  entity: string;
  plan: string | null;
  theme: string | null;
  logo_file: string | null;
  cf_zone_id: string | null;
  cf_name_servers: string | null;
  cf_zone_status: string | null;
  cf_ruleset_ids: string | null;
  panel_site_id: number | null;
  site_path: string | null;
  google_verification_token: string | null;
  google_verified: number;
  indexnow_key: string | null;
  last_built_at: string | null;
  last_deployed_at: string | null;
  live_at: string | null;
  health: string | null;
  interview: string | null;
  error_summary: string | null;
  created_at: string;
  updated_at: string;
}

/** Site đã giải mã JSON, dùng khắp nơi trong ứng dụng. */
export interface Site extends Omit<SiteRow, 'brief' | 'entity' | 'plan' | 'theme' | 'cf_name_servers' | 'cf_ruleset_ids' | 'health' | 'interview'> {
  brief: SiteBrief;
  entity: EntityData;
  plan: SitePlan | null;
  theme: ThemeConfig | null;
  cf_name_servers: string[];
  cf_ruleset_ids: { custom?: string; ratelimit?: string };
  health: HealthReport | null;
  /** Bộ Câu Hỏi: câu trả lời của chủ doanh nghiệp */
  interview: InterviewData | null;
}

export interface StepRow {
  site_id: number;
  step: string;
  status: StepStatus;
  attempts: number;
  next_run_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  message: string | null;
  error: string | null;
  output: string | null;
}

export interface PageRow {
  id: number;
  site_id: number;
  kind: string;
  slug: string;
  title: string;
  content: string;
  /** published: đã đăng; needs_review: chưa đạt kiểm duyệt, giữ lại chờ người dùng duyệt hoặc sinh lại */
  status: string;
  review: string | null;
  sort_order: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Page extends Omit<PageRow, 'content' | 'review'> {
  content: PageContent;
  review: ContentReview | null;
}

export interface ImageRow {
  id: number;
  site_id: number;
  key: string;
  provider: string;
  provider_id: string | null;
  query: string | null;
  file: string;
  width: number | null;
  height: number | null;
  alt: string;
  credit: string;
  credit_url: string;
  created_at: string;
}

export interface LibraryRow {
  id: number;
  site_id: number;
  /** Đường dẫn tương đối trong bản dựng: assets/img/lib-xxx.webp */
  file: string;
  width: number | null;
  height: number | null;
  alt: string;
  tags: string[];
  source: 'upload' | 'google' | string;
  source_ref: string | null;
  credit: string;
  created_at: string;
}

export interface JobRow {
  id: number;
  type: string;
  site_id: number | null;
  payload: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  run_at: string;
  attempts: number;
  max_attempts: number;
  error: string | null;
  result: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface LogRow {
  id: number;
  site_id: number | null;
  step: string | null;
  level: string;
  message: string;
  data: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Kết nối                                                             */
/* ------------------------------------------------------------------ */

export class Db {
  readonly raw: DatabaseSync;

  constructor(filePath: string) {
    if (filePath !== ':memory:') fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.raw = new DatabaseSync(filePath);
    this.raw.exec(SCHEMA_SQL);
    this.migrate();
  }

  /** Thêm cột mới cho DB đã tạo từ bản cũ (CREATE TABLE IF NOT EXISTS không thêm cột). */
  private migrate(): void {
    const cols = (this.raw.prepare('PRAGMA table_info(site_pages)').all() as unknown as { name: string }[]).map((c) => c.name);
    if (!cols.includes('review')) this.raw.exec('ALTER TABLE site_pages ADD COLUMN review TEXT');
    const siteCols = (this.raw.prepare('PRAGMA table_info(sites)').all() as unknown as { name: string }[]).map((c) => c.name);
    if (!siteCols.includes('interview')) this.raw.exec('ALTER TABLE sites ADD COLUMN interview TEXT');
  }

  close(): void {
    this.raw.close();
  }

  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }

  /* ---------------- settings ---------------- */

  getSetting<T>(key: string, fallback: T): T {
    const row = this.raw.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? safeJsonParse<T>(row.value, fallback) : fallback;
  }

  setSetting(key: string, value: unknown): void {
    this.raw
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), nowIso());
  }

  getWafSettings(): WafSettings {
    return WafSettingsSchema.parse(this.getSetting('waf', {}));
  }

  setWafSettings(v: WafSettings): void {
    this.setSetting('waf', WafSettingsSchema.parse(v));
  }

  getGeneralSettings(): GeneralSettings {
    return GeneralSettingsSchema.parse(this.getSetting('general', {}));
  }

  setGeneralSettings(v: GeneralSettings): void {
    this.setSetting('general', GeneralSettingsSchema.parse(v));
  }

  /* ---------------- servers ---------------- */

  listServers(): ServerRow[] {
    return this.raw.prepare('SELECT * FROM servers ORDER BY id').all() as unknown as ServerRow[];
  }

  getServer(id: number): ServerRow | undefined {
    return this.raw.prepare('SELECT * FROM servers WHERE id = ?').get(id) as unknown as ServerRow | undefined;
  }

  upsertServer(s: Omit<ServerRow, 'id' | 'created_at'> & { id?: number }): number {
    if (s.id) {
      this.raw
        .prepare(
          `UPDATE servers SET name=?, ip=?, panel_url=?, panel_api_key=?, ssh_host=?, ssh_port=?, ssh_user=?, ssh_key_path=?, ssh_password=?, web_root=?, php_version=?, from_env=? WHERE id=?`,
        )
        .run(s.name, s.ip, s.panel_url, s.panel_api_key, s.ssh_host, s.ssh_port, s.ssh_user, s.ssh_key_path, s.ssh_password, s.web_root, s.php_version, s.from_env, s.id);
      return s.id;
    }
    const r = this.raw
      .prepare(
        `INSERT INTO servers (name, ip, panel_url, panel_api_key, ssh_host, ssh_port, ssh_user, ssh_key_path, ssh_password, web_root, php_version, from_env)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(s.name, s.ip, s.panel_url, s.panel_api_key, s.ssh_host, s.ssh_port, s.ssh_user, s.ssh_key_path, s.ssh_password, s.web_root, s.php_version, s.from_env);
    return Number(r.lastInsertRowid);
  }

  deleteServer(id: number): void {
    this.raw.prepare('DELETE FROM servers WHERE id = ?').run(id);
  }

  /* ---------------- sites ---------------- */

  private hydrateSite(row: SiteRow | undefined): Site | undefined {
    if (!row) return undefined;
    return {
      ...row,
      brief: SiteBriefSchema.parse(safeJsonParse(row.brief, {})),
      entity: EntitySchema.parse(safeJsonParse(row.entity, {})),
      plan: safeJsonParse<SitePlan | null>(row.plan, null),
      theme: safeJsonParse<ThemeConfig | null>(row.theme, null),
      cf_name_servers: safeJsonParse<string[]>(row.cf_name_servers, []),
      cf_ruleset_ids: safeJsonParse<{ custom?: string; ratelimit?: string }>(row.cf_ruleset_ids, {}),
      health: safeJsonParse<HealthReport | null>(row.health, null),
      interview: safeJsonParse<InterviewData | null>(row.interview, null),
    };
  }

  listSites(): Site[] {
    const rows = this.raw.prepare('SELECT * FROM sites ORDER BY id DESC').all() as unknown as SiteRow[];
    return rows.map((r) => this.hydrateSite(r) as Site);
  }

  listSitesByStatus(statuses: SiteStatus[]): Site[] {
    if (statuses.length === 0) return [];
    const marks = statuses.map(() => '?').join(',');
    const rows = this.raw.prepare(`SELECT * FROM sites WHERE status IN (${marks}) ORDER BY id`).all(...statuses) as unknown as SiteRow[];
    return rows.map((r) => this.hydrateSite(r) as Site);
  }

  getSite(id: number): Site | undefined {
    return this.hydrateSite(this.raw.prepare('SELECT * FROM sites WHERE id = ?').get(id) as unknown as SiteRow | undefined);
  }

  getSiteByDomain(domain: string): Site | undefined {
    return this.hydrateSite(this.raw.prepare('SELECT * FROM sites WHERE domain = ?').get(domain) as unknown as SiteRow | undefined);
  }

  createSite(input: { domain: string; server_id: number | null; brief: SiteBrief; entity: EntityData; logo_file?: string | null }): number {
    const r = this.raw
      .prepare(`INSERT INTO sites (domain, server_id, status, brief, entity, logo_file) VALUES (?,?,?,?,?,?)`)
      .run(input.domain, input.server_id, 'creating', JSON.stringify(input.brief), JSON.stringify(input.entity), input.logo_file ?? null);
    return Number(r.lastInsertRowid);
  }

  /** Cập nhật một phần site. Các trường JSON được tự động stringify. */
  updateSite(id: number, patch: Partial<Omit<Site, 'id' | 'created_at'>>): void {
    const cols: string[] = [];
    const vals: unknown[] = [];
    const jsonFields = new Set(['brief', 'entity', 'plan', 'theme', 'cf_name_servers', 'cf_ruleset_ids', 'health', 'interview']);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      cols.push(`${k} = ?`);
      vals.push(jsonFields.has(k) ? (v === null ? null : JSON.stringify(v)) : v);
    }
    if (cols.length === 0) return;
    cols.push('updated_at = ?');
    vals.push(nowIso());
    vals.push(id);
    this.raw.prepare(`UPDATE sites SET ${cols.join(', ')} WHERE id = ?`).run(...(vals as (string | number | null)[]));
  }

  deleteSite(id: number): void {
    this.raw.prepare('DELETE FROM sites WHERE id = ?').run(id);
  }

  /* ---------------- steps ---------------- */

  listSteps(siteId: number): StepRow[] {
    return this.raw.prepare('SELECT * FROM site_steps WHERE site_id = ?').all(siteId) as unknown as StepRow[];
  }

  getStep(siteId: number, step: string): StepRow | undefined {
    return this.raw.prepare('SELECT * FROM site_steps WHERE site_id = ? AND step = ?').get(siteId, step) as unknown as StepRow | undefined;
  }

  ensureSteps(siteId: number, steps: string[]): void {
    const stmt = this.raw.prepare('INSERT OR IGNORE INTO site_steps (site_id, step, status) VALUES (?, ?, ?)');
    for (const s of steps) stmt.run(siteId, s, 'pending');
  }

  updateStep(siteId: number, step: string, patch: Partial<Omit<StepRow, 'site_id' | 'step'>>): void {
    const cols: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      cols.push(`${k} = ?`);
      vals.push(v);
    }
    if (cols.length === 0) return;
    vals.push(siteId, step);
    this.raw.prepare(`UPDATE site_steps SET ${cols.join(', ')} WHERE site_id = ? AND step = ?`).run(...(vals as (string | number | null)[]));
  }

  resetStep(siteId: number, step: string): void {
    this.updateStep(siteId, step, { status: 'pending', attempts: 0, next_run_at: null, error: null, message: null, finished_at: null });
  }

  /** Đặt lại bước này và mọi bước phụ thuộc vào nó (đệ quy) để chạy lại từ đây. */
  resetStepsFrom(siteId: number, steps: string[]): void {
    const stmt = this.raw.prepare(
      `UPDATE site_steps SET status='pending', attempts=0, next_run_at=NULL, error=NULL, message=NULL, finished_at=NULL WHERE site_id = ? AND step = ?`,
    );
    for (const s of steps) stmt.run(siteId, s);
  }

  /* ---------------- pages ---------------- */

  private hydratePage(row: PageRow): Page {
    return { ...row, content: safeJsonParse(row.content, {} as PageContent), review: row.review ? safeJsonParse(row.review, null as ContentReview | null) : null };
  }

  /** Trang chưa đạt kiểm duyệt của site. */
  listPagesNeedingReview(siteId: number): Page[] {
    return this.listPages(siteId).filter((p) => p.status === 'needs_review');
  }

  setPageStatus(id: number, status: 'published' | 'needs_review', review?: ContentReview | null): void {
    if (review === undefined) this.raw.prepare('UPDATE site_pages SET status=?, updated_at=? WHERE id=?').run(status, nowIso(), id);
    else this.raw.prepare('UPDATE site_pages SET status=?, review=?, updated_at=? WHERE id=?').run(status, review ? JSON.stringify(review) : null, nowIso(), id);
  }

  listPages(siteId: number): Page[] {
    const rows = this.raw.prepare('SELECT * FROM site_pages WHERE site_id = ? ORDER BY sort_order, id').all(siteId) as unknown as PageRow[];
    return rows.map((r) => this.hydratePage(r));
  }

  getPage(id: number): Page | undefined {
    const row = this.raw.prepare('SELECT * FROM site_pages WHERE id = ?').get(id) as unknown as PageRow | undefined;
    return row ? this.hydratePage(row) : undefined;
  }

  getPageBySlug(siteId: number, slug: string): Page | undefined {
    const row = this.raw.prepare('SELECT * FROM site_pages WHERE site_id = ? AND slug = ?').get(siteId, slug) as unknown as PageRow | undefined;
    return row ? this.hydratePage(row) : undefined;
  }

  upsertPage(p: { site_id: number; kind: string; slug: string; title: string; content: PageContent; sort_order?: number; published_at?: string | null; status?: 'published' | 'needs_review'; review?: ContentReview | null }): number {
    const existing = this.getPageBySlug(p.site_id, p.slug);
    const now = nowIso();
    const review = p.review === undefined ? undefined : p.review ? JSON.stringify(p.review) : null;
    if (existing) {
      this.raw
        .prepare(`UPDATE site_pages SET kind=?, title=?, content=?, sort_order=?, published_at=COALESCE(?, published_at), status=COALESCE(?, status), review=CASE WHEN ? THEN ? ELSE review END, updated_at=? WHERE id=?`)
        .run(p.kind, p.title, JSON.stringify(p.content), p.sort_order ?? existing.sort_order, p.published_at ?? null, p.status ?? null, review === undefined ? 0 : 1, review ?? null, now, existing.id);
      return existing.id;
    }
    const r = this.raw
      .prepare(`INSERT INTO site_pages (site_id, kind, slug, title, content, sort_order, published_at, status, review) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(p.site_id, p.kind, p.slug, p.title, JSON.stringify(p.content), p.sort_order ?? 0, p.published_at ?? now, p.status ?? 'published', review ?? null);
    return Number(r.lastInsertRowid);
  }

  deletePage(id: number): void {
    this.raw.prepare('DELETE FROM site_pages WHERE id = ?').run(id);
  }

  deletePagesOfSite(siteId: number): void {
    this.raw.prepare('DELETE FROM site_pages WHERE site_id = ?').run(siteId);
  }

  /* ---------------- images ---------------- */

  listImages(siteId: number): ImageRow[] {
    return this.raw.prepare('SELECT * FROM site_images WHERE site_id = ? ORDER BY id').all(siteId) as unknown as ImageRow[];
  }

  getImage(siteId: number, key: string): ImageRow | undefined {
    return this.raw.prepare('SELECT * FROM site_images WHERE site_id = ? AND key = ?').get(siteId, key) as unknown as ImageRow | undefined;
  }

  upsertImage(img: Omit<ImageRow, 'id' | 'created_at'>): void {
    this.raw
      .prepare(
        `INSERT INTO site_images (site_id, key, provider, provider_id, query, file, width, height, alt, credit, credit_url)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(site_id, key) DO UPDATE SET provider=excluded.provider, provider_id=excluded.provider_id, query=excluded.query,
           file=excluded.file, width=excluded.width, height=excluded.height, alt=excluded.alt, credit=excluded.credit, credit_url=excluded.credit_url`,
      )
      .run(img.site_id, img.key, img.provider, img.provider_id, img.query, img.file, img.width, img.height, img.alt, img.credit, img.credit_url);
    if (img.provider_id) {
      this.raw.prepare('INSERT OR IGNORE INTO used_stock_images (provider, provider_id, site_id) VALUES (?,?,?)').run(img.provider, img.provider_id, img.site_id);
    }
  }

  deleteImagesOfSite(siteId: number): void {
    this.raw.prepare('DELETE FROM site_images WHERE site_id = ?').run(siteId);
  }

  /** Xóa ảnh do hệ thống tự gán, giữ lại ảnh người dùng chọn tay (manual) và vị trí cố ý để trống (none). */
  deleteAutoImagesOfSite(siteId: number): void {
    this.raw.prepare(`DELETE FROM site_images WHERE site_id = ? AND provider NOT IN ('manual', 'none')`).run(siteId);
  }

  deleteImage(siteId: number, key: string): void {
    this.raw.prepare('DELETE FROM site_images WHERE site_id = ? AND key = ?').run(siteId, key);
  }

  /* ---------------- kho ảnh thật ---------------- */

  listLibrary(siteId: number): LibraryRow[] {
    const rows = this.raw.prepare('SELECT * FROM site_library WHERE site_id = ? ORDER BY id').all(siteId) as unknown as (Omit<LibraryRow, 'tags'> & { tags: string })[];
    return rows.map((r) => ({ ...r, tags: safeJsonParse<string[]>(r.tags, []) }));
  }

  getLibraryImage(id: number): LibraryRow | undefined {
    const r = this.raw.prepare('SELECT * FROM site_library WHERE id = ?').get(id) as unknown as (Omit<LibraryRow, 'tags'> & { tags: string }) | undefined;
    return r ? { ...r, tags: safeJsonParse<string[]>(r.tags, []) } : undefined;
  }

  addLibraryImage(img: Omit<LibraryRow, 'id' | 'created_at'>): number {
    const r = this.raw
      .prepare(`INSERT INTO site_library (site_id, file, width, height, alt, tags, source, source_ref, credit) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(site_id, file) DO UPDATE SET alt=excluded.alt, tags=excluded.tags`)
      .run(img.site_id, img.file, img.width, img.height, img.alt, JSON.stringify(img.tags), img.source, img.source_ref, img.credit);
    return Number(r.lastInsertRowid);
  }

  hasLibrarySource(siteId: number, sourceRef: string): boolean {
    return Boolean(this.raw.prepare('SELECT 1 FROM site_library WHERE site_id = ? AND source_ref = ?').get(siteId, sourceRef));
  }

  updateLibraryImage(id: number, patch: { alt?: string; tags?: string[] }): void {
    const cur = this.getLibraryImage(id);
    if (!cur) return;
    this.raw.prepare('UPDATE site_library SET alt = ?, tags = ? WHERE id = ?').run(patch.alt ?? cur.alt, JSON.stringify(patch.tags ?? cur.tags), id);
  }

  deleteLibraryImage(id: number): void {
    this.raw.prepare('DELETE FROM site_library WHERE id = ?').run(id);
  }

  isStockImageUsed(provider: string, providerId: string): boolean {
    return Boolean(this.raw.prepare('SELECT 1 FROM used_stock_images WHERE provider = ? AND provider_id = ?').get(provider, providerId));
  }

  /* ---------------- jobs ---------------- */

  /**
   * dedupe: đã có job cùng loại đang xếp hàng (chưa chạy) thì dùng lại job đó.
   * Job đang chạy không tính, vì nó có thể đã đọc dữ liệu trước thay đổi mới.
   */
  enqueueJob(type: string, siteId: number | null, payload: unknown = null, opts: { runAt?: string; maxAttempts?: number; dedupe?: boolean } = {}): number {
    if (opts.dedupe) {
      const existing = this.raw
        .prepare(`SELECT id FROM jobs WHERE type = ? AND site_id IS ? AND status = 'queued'`)
        .get(type, siteId) as { id: number } | undefined;
      if (existing) return existing.id;
    }
    const r = this.raw
      .prepare(`INSERT INTO jobs (type, site_id, payload, run_at, max_attempts) VALUES (?,?,?,?,?)`)
      .run(type, siteId, payload === null ? null : JSON.stringify(payload), opts.runAt ?? nowIso(), opts.maxAttempts ?? 3);
    return Number(r.lastInsertRowid);
  }

  /** Xếp job dựng lại và đưa lên host, gộp các lần gọi liên tiếp trong khoảng chờ. */
  scheduleRebuild(siteId: number, debounceSec: number): number {
    const runAt = new Date(Date.now() + Math.max(0, debounceSec) * 1000).toISOString();
    return this.enqueueJob('rebuild_deploy', siteId, null, { dedupe: true, runAt });
  }

  /** Lấy và khóa job kế tiếp (đánh dấu running trong cùng transaction). */
  claimNextJob(): JobRow | undefined {
    return this.transaction(() => {
      const row = this.raw
        .prepare(`SELECT * FROM jobs WHERE status = 'queued' AND run_at <= ? ORDER BY run_at, id LIMIT 1`)
        .get(nowIso()) as unknown as JobRow | undefined;
      if (!row) return undefined;
      this.raw.prepare(`UPDATE jobs SET status='running', started_at=?, attempts = attempts + 1 WHERE id = ?`).run(nowIso(), row.id);
      return { ...row, status: 'running', attempts: row.attempts + 1 };
    });
  }

  finishJob(id: number, ok: boolean, info: { error?: string; result?: unknown; retryAt?: string } = {}): void {
    if (ok) {
      this.raw.prepare(`UPDATE jobs SET status='done', finished_at=?, result=?, error=NULL WHERE id=?`).run(nowIso(), info.result === undefined ? null : JSON.stringify(info.result), id);
      return;
    }
    const job = this.raw.prepare('SELECT attempts, max_attempts FROM jobs WHERE id = ?').get(id) as { attempts: number; max_attempts: number } | undefined;
    if (job && job.attempts < job.max_attempts && info.retryAt) {
      this.raw.prepare(`UPDATE jobs SET status='queued', run_at=?, error=? WHERE id=?`).run(info.retryAt, info.error ?? null, id);
    } else {
      this.raw.prepare(`UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?`).run(nowIso(), info.error ?? null, id);
    }
  }

  listJobs(limit = 50, siteId?: number): JobRow[] {
    if (siteId !== undefined) {
      return this.raw.prepare('SELECT * FROM jobs WHERE site_id = ? ORDER BY id DESC LIMIT ?').all(siteId, limit) as unknown as JobRow[];
    }
    return this.raw.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?').all(limit) as unknown as JobRow[];
  }

  /** Job bị kẹt ở trạng thái running khi tiến trình tắt đột ngột: trả lại hàng đợi lúc khởi động. */
  requeueStaleRunningJobs(): number {
    const r = this.raw.prepare(`UPDATE jobs SET status='queued' WHERE status='running'`).run();
    return Number(r.changes);
  }

  requeueStaleRunningSteps(): number {
    const r = this.raw.prepare(`UPDATE site_steps SET status='pending' WHERE status='running'`).run();
    return Number(r.changes);
  }

  /* ---------------- logs ---------------- */

  addLog(entry: { site_id?: number | null; step?: string | null; level: string; message: string; data?: unknown }): void {
    this.raw
      .prepare('INSERT INTO logs (site_id, step, level, message, data) VALUES (?,?,?,?,?)')
      .run(entry.site_id ?? null, entry.step ?? null, entry.level, entry.message, entry.data === undefined ? null : JSON.stringify(entry.data));
  }

  listLogs(opts: { siteId?: number; limit?: number; level?: string } = {}): LogRow[] {
    const limit = opts.limit ?? 200;
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.siteId !== undefined) {
      where.push('site_id = ?');
      params.push(opts.siteId);
    }
    if (opts.level) {
      where.push('level = ?');
      params.push(opts.level);
    }
    const sql = `SELECT * FROM logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
    params.push(limit);
    return this.raw.prepare(sql).all(...params) as unknown as LogRow[];
  }

  pruneLogs(keep = 20_000): void {
    this.raw.prepare(`DELETE FROM logs WHERE id < (SELECT COALESCE(MAX(id),0) - ? FROM logs)`).run(keep);
  }

  /* ---------------- sessions ---------------- */

  createSession(token: string, ttlMs: number): void {
    this.raw.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(token, new Date(Date.now() + ttlMs).toISOString());
  }

  hasValidSession(token: string): boolean {
    const row = this.raw.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token) as { expires_at: string } | undefined;
    if (!row) return false;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      this.raw.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return false;
    }
    return true;
  }

  deleteSession(token: string): void {
    this.raw.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  /* ---------------- thống kê ---------------- */

  countSitesByStatus(): Record<string, number> {
    const rows = this.raw.prepare('SELECT status, COUNT(*) AS n FROM sites GROUP BY status').all() as unknown as { status: string; n: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  }
}
