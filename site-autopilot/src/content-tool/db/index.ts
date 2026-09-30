import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.js';
import { nowIso, safeJsonParse, slugify } from '../core/util.js';
import { GeneralSettingsSchema, RunOptionsSchema, type GeneralSettings, type RunOptions, type RunStatus, type SourceStatus, type StepStatus, type UsageTotals } from '../core/types.js';

/* ------------------------------------------------------------------ */
/*  Kiểu dòng dữ liệu                                                   */
/* ------------------------------------------------------------------ */

export interface FinalScore {
  aiScore: number | null;
  dupRatio: number | null;
  words: number;
  pass: boolean;
  rounds: number;
}

export interface RunRow {
  id: number;
  keyword: string;
  slug: string;
  status: RunStatus;
  options: string;
  current_step: string | null;
  error: string | null;
  rounds: number;
  usage: string | null;
  final_score: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface Run extends Omit<RunRow, 'options' | 'usage' | 'final_score'> {
  options: RunOptions;
  usage: UsageTotals | null;
  finalScore: FinalScore | null;
}

export interface StepRow {
  run_id: number;
  step: string;
  status: StepStatus;
  attempts: number;
  started_at: string | null;
  finished_at: string | null;
  message: string | null;
  error: string | null;
}

export interface SourceRow {
  id: number;
  run_id: number;
  position: number;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  language: string;
  status: SourceStatus;
  http_status: number | null;
  text: string | null;
  word_count: number;
  error: string | null;
  fetched_at: string | null;
}

export interface ArtifactRow {
  run_id: number;
  kind: string;
  version: number;
  content: string;
  created_at: string;
}

export interface LogRow {
  id: number;
  run_id: number | null;
  step: string | null;
  level: string;
  message: string;
  created_at: string;
}

export type ArtifactKind = 'serp' | 'places' | 'notes' | 'outline' | 'draft' | 'edited' | 'fixed' | 'check' | 'exports' | 'pending_score' | 'ai_score' | 'experiment';

/* ------------------------------------------------------------------ */
/*  Lớp truy cập SQLite                                                  */
/* ------------------------------------------------------------------ */

export class Db {
  readonly sql: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.sql = new DatabaseSync(dbPath);
    this.sql.exec(SCHEMA_SQL);
  }

  close(): void {
    this.sql.close();
  }

  /* ---------------- settings ---------------- */

  getSetting<T>(key: string, fallback: T): T {
    const row = this.sql.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return fallback;
    return safeJsonParse<T>(row.value, fallback);
  }

  setSetting(key: string, value: unknown): void {
    if (value === null || value === undefined) {
      this.sql.prepare('DELETE FROM settings WHERE key = ?').run(key);
      return;
    }
    this.sql.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }

  getGeneralSettings(): GeneralSettings {
    const raw = this.getSetting<unknown>('general', {});
    // Mặc định "đánh giá mỗi quán" nâng từ 8 lên 16 (25/09/2026): giá trị 8 đã lưu là mặc định cũ, không phải lựa chọn riêng
    if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).roundupReviewsPerPlace === 8) (raw as Record<string, unknown>).roundupReviewsPerPlace = 16;
    const parsed = GeneralSettingsSchema.safeParse(raw);
    return parsed.success ? parsed.data : GeneralSettingsSchema.parse({});
  }

  setGeneralSettings(s: GeneralSettings): void {
    this.setSetting('general', GeneralSettingsSchema.parse(s));
  }

  /* ---------------- sessions ---------------- */

  createSession(token: string, ttlMs: number): void {
    this.sql.prepare('INSERT INTO sessions(token, expires_at) VALUES(?, ?)').run(token, new Date(Date.now() + ttlMs).toISOString());
  }

  hasValidSession(token: string): boolean {
    const row = this.sql.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token) as { expires_at: string } | undefined;
    if (!row) return false;
    if (row.expires_at < nowIso()) {
      this.deleteSession(token);
      return false;
    }
    return true;
  }

  deleteSession(token: string): void {
    this.sql.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  purgeSessions(): void {
    this.sql.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
  }

  /* ---------------- runs ---------------- */

  private toRun(row: RunRow): Run {
    const opts = RunOptionsSchema.safeParse(safeJsonParse<unknown>(row.options, {}));
    return {
      ...row,
      options: opts.success ? opts.data : RunOptionsSchema.parse({}),
      usage: safeJsonParse<UsageTotals | null>(row.usage, null),
      finalScore: safeJsonParse<FinalScore | null>(row.final_score, null),
    };
  }

  createRun(keyword: string, options: RunOptions): Run {
    const now = nowIso();
    const kw = keyword.trim();
    const info = this.sql
      .prepare('INSERT INTO runs(keyword, slug, status, options, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(kw, slugify(kw), 'queued', JSON.stringify(RunOptionsSchema.parse(options)), now, now);
    return this.getRun(Number(info.lastInsertRowid))!;
  }

  getRun(id: number): Run | undefined {
    const row = this.sql.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
    return row ? this.toRun(row) : undefined;
  }

  listRuns(limit = 200): Run[] {
    const rows = this.sql.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?').all(limit) as unknown as RunRow[];
    return rows.map((r) => this.toRun(r));
  }

  listRunsByStatus(status: RunStatus, limit = 20): Run[] {
    const rows = this.sql.prepare('SELECT * FROM runs WHERE status = ? ORDER BY id ASC LIMIT ?').all(status, limit) as unknown as RunRow[];
    return rows.map((r) => this.toRun(r));
  }

  countRuns(): { total: number; done: number; needsReview: number; running: number } {
    const rows = this.sql.prepare('SELECT status, COUNT(*) AS n FROM runs GROUP BY status').all() as unknown as { status: RunStatus; n: number }[];
    const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Partial<Record<RunStatus, number>>;
    const total = rows.reduce((s, r) => s + Number(r.n), 0);
    return { total, done: by.done ?? 0, needsReview: by.needs_review ?? 0, running: (by.running ?? 0) + (by.queued ?? 0) };
  }

  updateRun(id: number, patch: Partial<{ status: RunStatus; current_step: string | null; error: string | null; rounds: number; usage: UsageTotals | null; finalScore: FinalScore | null; finished_at: string | null; options: RunOptions; keyword: string }>): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.keyword !== undefined) (sets.push('keyword = ?, slug = ?'), vals.push(patch.keyword, slugify(patch.keyword)));
    if (patch.status !== undefined) (sets.push('status = ?'), vals.push(patch.status));
    if (patch.current_step !== undefined) (sets.push('current_step = ?'), vals.push(patch.current_step));
    if (patch.error !== undefined) (sets.push('error = ?'), vals.push(patch.error));
    if (patch.rounds !== undefined) (sets.push('rounds = ?'), vals.push(patch.rounds));
    if (patch.usage !== undefined) (sets.push('usage = ?'), vals.push(patch.usage ? JSON.stringify(patch.usage) : null));
    if (patch.finalScore !== undefined) (sets.push('final_score = ?'), vals.push(patch.finalScore ? JSON.stringify(patch.finalScore) : null));
    if (patch.finished_at !== undefined) (sets.push('finished_at = ?'), vals.push(patch.finished_at));
    if (patch.options !== undefined) (sets.push('options = ?'), vals.push(JSON.stringify(RunOptionsSchema.parse(patch.options))));
    sets.push('updated_at = ?');
    vals.push(nowIso());
    vals.push(id);
    this.sql.prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...(vals as (string | number | null)[]));
  }

  /** Nhận bài để chạy: chỉ một worker (hoặc một tiến trình) đổi được queued → running. */
  claimRun(id: number): boolean {
    const info = this.sql.prepare("UPDATE runs SET status = 'running', error = NULL, updated_at = ? WHERE id = ? AND status = 'queued'").run(nowIso(), id);
    return Number(info.changes) === 1;
  }

  deleteRun(id: number): void {
    this.sql.prepare('DELETE FROM logs WHERE run_id = ?').run(id);
    this.sql.prepare('DELETE FROM runs WHERE id = ?').run(id);
  }

  /* ---------------- steps ---------------- */

  initSteps(runId: number, steps: readonly string[]): void {
    const ins = this.sql.prepare('INSERT OR IGNORE INTO run_steps(run_id, step, status) VALUES(?, ?, ?)');
    for (const s of steps) ins.run(runId, s, 'pending');
  }

  getSteps(runId: number): StepRow[] {
    return this.sql.prepare('SELECT * FROM run_steps WHERE run_id = ?').all(runId) as unknown as StepRow[];
  }

  getStep(runId: number, step: string): StepRow | undefined {
    return this.sql.prepare('SELECT * FROM run_steps WHERE run_id = ? AND step = ?').get(runId, step) as StepRow | undefined;
  }

  setStep(runId: number, step: string, patch: Partial<Omit<StepRow, 'run_id' | 'step'>>): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${k} = ?`);
      vals.push(v ?? null);
    }
    if (!sets.length) return;
    vals.push(runId, step);
    this.sql.prepare(`UPDATE run_steps SET ${sets.join(', ')} WHERE run_id = ? AND step = ?`).run(...(vals as (string | number | null)[]));
  }

  /** Đưa các bước về trạng thái chờ để chạy lại. */
  resetSteps(runId: number, steps: readonly string[]): void {
    const upd = this.sql.prepare("UPDATE run_steps SET status = 'pending', attempts = 0, started_at = NULL, finished_at = NULL, message = NULL, error = NULL WHERE run_id = ? AND step = ?");
    for (const s of steps) upd.run(runId, s);
  }

  /* ---------------- sources ---------------- */

  replaceSources(runId: number, sources: { position: number; url: string; domain: string; title: string; snippet: string; language: string }[]): void {
    this.sql.prepare('DELETE FROM sources WHERE run_id = ?').run(runId);
    const ins = this.sql.prepare('INSERT INTO sources(run_id, position, url, domain, title, snippet, language, status) VALUES(?, ?, ?, ?, ?, ?, ?, ?)');
    for (const s of sources) ins.run(runId, s.position, s.url, s.domain, s.title, s.snippet, s.language, 'pending');
  }

  addSources(runId: number, sources: { position: number; url: string; domain: string; title: string; snippet: string; language: string }[]): void {
    const ins = this.sql.prepare('INSERT INTO sources(run_id, position, url, domain, title, snippet, language, status) VALUES(?, ?, ?, ?, ?, ?, ?, ?)');
    for (const s of sources) ins.run(runId, s.position, s.url, s.domain, s.title, s.snippet, s.language, 'pending');
  }

  listSources(runId: number, withText = false): SourceRow[] {
    const cols = withText ? '*' : 'id, run_id, position, url, domain, title, snippet, language, status, http_status, word_count, error, fetched_at, NULL AS text';
    return this.sql.prepare(`SELECT ${cols} FROM sources WHERE run_id = ? ORDER BY position ASC, id ASC`).all(runId) as unknown as SourceRow[];
  }

  /** Nguồn đã lấy được nội dung, dùng cho bước rút ghi chú và kiểm tra trùng lặp. */
  okSources(runId: number): SourceRow[] {
    return this.sql.prepare("SELECT * FROM sources WHERE run_id = ? AND status = 'ok' ORDER BY position ASC, id ASC").all(runId) as unknown as SourceRow[];
  }

  updateSource(id: number, patch: Partial<Omit<SourceRow, 'id' | 'run_id'>>): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${k} = ?`);
      vals.push(v ?? null);
    }
    if (!sets.length) return;
    vals.push(id);
    this.sql.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).run(...(vals as (string | number | null)[]));
  }

  /* ---------------- artifacts ---------------- */

  saveArtifact(runId: number, kind: ArtifactKind, content: unknown): number {
    const row = this.sql.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM artifacts WHERE run_id = ? AND kind = ?').get(runId, kind) as { v: number };
    const version = Number(row.v) + 1;
    this.sql.prepare('INSERT INTO artifacts(run_id, kind, version, content, created_at) VALUES(?, ?, ?, ?, ?)').run(runId, kind, version, JSON.stringify(content), nowIso());
    return version;
  }

  getArtifact<T>(runId: number, kind: ArtifactKind, version?: number): { version: number; content: T; createdAt: string } | null {
    const row = (
      version
        ? this.sql.prepare('SELECT * FROM artifacts WHERE run_id = ? AND kind = ? AND version = ?').get(runId, kind, version)
        : this.sql.prepare('SELECT * FROM artifacts WHERE run_id = ? AND kind = ? ORDER BY version DESC LIMIT 1').get(runId, kind)
    ) as ArtifactRow | undefined;
    if (!row) return null;
    return { version: row.version, content: JSON.parse(row.content) as T, createdAt: row.created_at };
  }

  listArtifacts<T>(runId: number, kind: ArtifactKind): { version: number; content: T; createdAt: string }[] {
    const rows = this.sql.prepare('SELECT * FROM artifacts WHERE run_id = ? AND kind = ? ORDER BY version ASC').all(runId, kind) as unknown as ArtifactRow[];
    return rows.map((r) => ({ version: r.version, content: JSON.parse(r.content) as T, createdAt: r.created_at }));
  }

  deleteArtifacts(runId: number, kinds: readonly ArtifactKind[]): void {
    const del = this.sql.prepare('DELETE FROM artifacts WHERE run_id = ? AND kind = ?');
    for (const k of kinds) del.run(runId, k);
  }

  /** Bài đã hoàn tất của các lần chạy khác, để so trùng chủ đề và câu chữ giữa các bài. */
  libraryArticles(excludeRunId: number, limit = 300): { runId: number; keyword: string; content: unknown }[] {
    const rows = this.sql
      .prepare(
        `SELECT a.run_id AS run_id, r.keyword AS keyword, a.content AS content
         FROM artifacts a JOIN runs r ON r.id = a.run_id
         WHERE a.kind IN ('fixed', 'edited') AND a.run_id != ?
           AND a.version = (SELECT MAX(version) FROM artifacts b WHERE b.run_id = a.run_id AND b.kind = a.kind)
           AND a.kind = (SELECT CASE WHEN EXISTS(SELECT 1 FROM artifacts c WHERE c.run_id = a.run_id AND c.kind = 'fixed') THEN 'fixed' ELSE 'edited' END)
         ORDER BY a.run_id DESC LIMIT ?`,
      )
      .all(excludeRunId, limit) as unknown as { run_id: number; keyword: string; content: string }[];
    return rows.map((r) => ({ runId: r.run_id, keyword: r.keyword, content: JSON.parse(r.content) as unknown }));
  }

  /* ---------------- logs ---------------- */

  addLog(entry: { run_id?: number | null; step?: string | null; level: string; message: string }): void {
    this.sql.prepare('INSERT INTO logs(run_id, step, level, message, created_at) VALUES(?, ?, ?, ?, ?)').run(entry.run_id ?? null, entry.step ?? null, entry.level, entry.message.slice(0, 4000), nowIso());
  }

  listLogs(runId: number | null, limit = 300): LogRow[] {
    if (runId === null) return this.sql.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(limit) as unknown as LogRow[];
    return this.sql.prepare('SELECT * FROM logs WHERE run_id = ? ORDER BY id DESC LIMIT ?').all(runId, limit) as unknown as LogRow[];
  }
}
