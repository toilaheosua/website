import type { AppConfig } from '../config.js';
import type { Db, ServerRow, Site, StepRow } from '../db/index.js';
import type { Services } from '../services/types.js';
import type { LogLevel } from './logger.js';
import type { SiteStatus } from './types.js';

export type StepId =
  | 'cf_zone'
  | 'cf_wait_active'
  | 'cf_dns'
  | 'cf_settings'
  | 'cf_waf'
  | 'cf_ratelimit'
  | 'host_site'
  | 'gen_plan'
  | 'gen_content'
  | 'gen_images'
  | 'build'
  | 'deploy'
  | 'verify_live'
  | 'gsc_verify'
  | 'gsc_sitemap'
  | 'indexnow'
  | 'live';

export type StepBranch = 'cloudflare' | 'build' | 'final';

export type StepResult =
  | { status: 'done'; message?: string; output?: unknown }
  | { status: 'waiting'; retryInMs: number; message: string }
  | { status: 'skipped'; message: string };

export interface StepContext {
  db: Db;
  config: AppConfig;
  services: Services;
  site: Site;
  server: ServerRow | undefined;
  /** Ghi log vào bảng logs + console, gắn với site và bước hiện tại. */
  log: (level: LogLevel, message: string, data?: unknown) => void;
  /** Cập nhật site trong DB và trong ctx.site. */
  updateSite: (patch: Partial<Omit<Site, 'id' | 'created_at'>>) => void;
  refreshSite: () => Site;
}

export interface StepDef {
  id: StepId;
  label: string;
  description: string;
  branch: StepBranch;
  deps: StepId[];
  maxAttempts: number;
  /** Bước có thể chạy lại bất kỳ lúc nào (idempotent). */
  run: (ctx: StepContext) => Promise<StepResult>;
}

export const STEP_ORDER: StepId[] = [
  'cf_zone',
  'cf_wait_active',
  'cf_dns',
  'cf_settings',
  'cf_waf',
  'cf_ratelimit',
  'host_site',
  'gen_plan',
  'gen_content',
  'gen_images',
  'build',
  'deploy',
  'verify_live',
  'gsc_verify',
  'gsc_sitemap',
  'indexnow',
  'live',
];

/** Trả về tập bước phụ thuộc (đệ quy) vào `step`, kể cả chính nó. */
export function dependentsOf(defs: readonly StepDef[], step: StepId): StepId[] {
  const out = new Set<StepId>([step]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of defs) {
      if (out.has(d.id)) continue;
      if (d.deps.some((dep) => out.has(dep))) {
        out.add(d.id);
        changed = true;
      }
    }
  }
  return STEP_ORDER.filter((s) => out.has(s));
}

export function isTerminalOk(status: StepRow['status']): boolean {
  return status === 'done' || status === 'skipped';
}

/** Suy ra trạng thái site từ trạng thái các bước. */
export function deriveSiteStatus(defs: readonly StepDef[], steps: StepRow[], current: SiteStatus): SiteStatus {
  if (current === 'paused') return 'paused';
  const byId = new Map(steps.map((s) => [s.step, s]));
  const all = defs.map((d) => byId.get(d.id));
  if (all.length > 0 && all.every((s) => s && isTerminalOk(s.status))) return 'live';
  for (const d of defs) {
    const s = byId.get(d.id);
    if (s && s.status === 'failed' && s.attempts >= d.maxAttempts) return 'error';
  }
  const wait = byId.get('cf_wait_active');
  if (wait && wait.status === 'waiting') return 'waiting_ns';
  return 'building';
}

export function runnableSteps(defs: readonly StepDef[], steps: StepRow[], nowIso: string): StepDef[] {
  const byId = new Map(steps.map((s) => [s.step, s]));
  const out: StepDef[] = [];
  for (const d of defs) {
    const s = byId.get(d.id);
    if (!s) continue;
    const depsOk = d.deps.every((dep) => {
      const ds = byId.get(dep);
      return ds && isTerminalOk(ds.status);
    });
    if (!depsOk) continue;
    if (s.status === 'pending') out.push(d);
    else if (s.status === 'waiting' && (!s.next_run_at || s.next_run_at <= nowIso)) out.push(d);
    else if (s.status === 'failed' && s.attempts < d.maxAttempts && (!s.next_run_at || s.next_run_at <= nowIso)) out.push(d);
  }
  return out;
}

export function progressOf(defs: readonly StepDef[], steps: StepRow[]): { done: number; total: number; percent: number } {
  const byId = new Map(steps.map((s) => [s.step, s]));
  let done = 0;
  for (const d of defs) {
    const s = byId.get(d.id);
    if (s && isTerminalOk(s.status)) done++;
  }
  const total = defs.length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}
