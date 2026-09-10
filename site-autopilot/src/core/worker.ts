import type { AppConfig } from '../config.js';
import type { Db, Site } from '../db/index.js';
import type { Services } from '../services/types.js';
import { createLogger } from './logger.js';
import { deriveSiteStatus, runnableSteps, type StepDef } from './pipeline.js';
import { errorMessage, isoAfter, nowIso } from './util.js';
import { isRetryable } from './errors.js';
import { runJob } from './jobs.js';
import { makeStepContext } from './context.js';

const log = createLogger('worker');

export interface WorkerOptions {
  db: Db;
  config: AppConfig;
  services: Services;
  steps: StepDef[];
  tickMs?: number;
}

/**
 * Worker chạy trong cùng tiến trình với dashboard.
 * Mỗi tick: chạy các bước pipeline đủ điều kiện + job trong hàng đợi, giới hạn đồng thời.
 */
export class Worker {
  private readonly db: Db;
  private readonly config: AppConfig;
  private readonly services: Services;
  private readonly steps: StepDef[];
  private readonly tickMs: number;
  private running = new Set<string>();
  private stopped = false;
  private timer: NodeJS.Timeout | undefined;
  private lastHealthSweep = 0;
  private lastPrune = 0;

  constructor(opts: WorkerOptions) {
    this.db = opts.db;
    this.config = opts.config;
    this.services = opts.services;
    this.steps = opts.steps;
    this.tickMs = opts.tickMs ?? 3000;
  }

  start(): void {
    const requeuedJobs = this.db.requeueStaleRunningJobs();
    const requeuedSteps = this.db.requeueStaleRunningSteps();
    if (requeuedJobs || requeuedSteps) log.info('Trả lại hàng đợi các tác vụ dở dang', { requeuedJobs, requeuedSteps });
    this.stopped = false;
    const loop = async () => {
      if (this.stopped) return;
      try {
        await this.tick();
      } catch (err) {
        log.error('Tick lỗi', { err: errorMessage(err) });
      }
      this.timer = setTimeout(loop, this.tickMs);
    };
    void loop();
    log.info('Worker đã khởi động', { concurrency: this.config.WORKER_CONCURRENCY, mock: this.config.isMock });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  get activeCount(): number {
    return this.running.size;
  }

  /** Chờ mọi tác vụ đang chạy kết thúc (dùng trong test). */
  async drain(timeoutMs = 60_000): Promise<void> {
    const start = Date.now();
    while (this.running.size > 0 && Date.now() - start < timeoutMs) await new Promise((r) => setTimeout(r, 50));
  }

  /** Chạy một tick ngay (dùng trong test và CLI). Trả về số tác vụ đã khởi chạy. */
  async tick(): Promise<number> {
    let started = 0;
    const capacity = () => this.config.WORKER_CONCURRENCY - this.running.size;

    // 1. Bước pipeline
    const sites = this.db.listSitesByStatus(['creating', 'waiting_ns', 'building', 'error']);
    for (const site of sites) {
      if (capacity() <= 0) break;
      this.db.ensureSteps(site.id, this.steps.map((s) => s.id));
      const rows = this.db.listSteps(site.id);
      const runnable = runnableSteps(this.steps, rows, nowIso());
      for (const def of runnable) {
        if (capacity() <= 0) break;
        const key = `step:${site.id}:${def.id}`;
        if (this.running.has(key)) continue;
        this.running.add(key);
        started++;
        void this.runStep(site.id, def).finally(() => this.running.delete(key));
      }
    }

    // 2. Job hàng đợi
    while (capacity() > 0) {
      const job = this.db.claimNextJob();
      if (!job) break;
      const key = `job:${job.id}`;
      this.running.add(key);
      started++;
      void runJob({ db: this.db, config: this.config, services: this.services, steps: this.steps, job })
        .then((result) => this.db.finishJob(job.id, true, { result }))
        .catch((err) => {
          const msg = errorMessage(err);
          log.error(`Job ${job.type}#${job.id} lỗi`, { msg });
          this.db.addLog({ site_id: job.site_id, step: job.type, level: 'error', message: `Job ${job.type} lỗi: ${msg}` });
          this.db.finishJob(job.id, false, { error: msg, retryAt: isRetryable(err) ? isoAfter(60_000 * job.attempts) : undefined });
        })
        .finally(() => this.running.delete(key));
    }

    // 3. Lịch định kỳ
    const now = Date.now();
    const healthEvery = Math.max(1, this.config.HEALTH_CHECK_INTERVAL_MIN) * 60_000;
    if (now - this.lastHealthSweep > healthEvery) {
      this.lastHealthSweep = now;
      for (const s of this.db.listSitesByStatus(['live'])) this.db.enqueueJob('health_check', s.id, null, { dedupe: true, maxAttempts: 1 });
    }
    if (now - this.lastPrune > 6 * 3600_000) {
      this.lastPrune = now;
      this.db.pruneLogs();
    }
    return started;
  }

  private async runStep(siteId: number, def: StepDef): Promise<void> {
    const site = this.db.getSite(siteId);
    if (!site || site.status === 'paused') return;
    const prev = this.db.getStep(siteId, def.id);
    const attempts = (prev?.attempts ?? 0) + 1;
    this.db.updateStep(siteId, def.id, { status: 'running', attempts, started_at: nowIso(), error: null, next_run_at: null });
    this.db.updateSite(siteId, { status: deriveSiteStatus(this.steps, this.db.listSteps(siteId), site.status) });
    const ctx = makeStepContext(this.db, this.config, this.services, site, def.id);
    try {
      const result = await def.run(ctx);
      if (result.status === 'done') {
        this.db.updateStep(siteId, def.id, {
          status: 'done',
          finished_at: nowIso(),
          message: result.message ?? null,
          output: result.output === undefined ? null : JSON.stringify(result.output),
          error: null,
        });
        ctx.log('info', result.message ?? 'Hoàn thành');
      } else if (result.status === 'skipped') {
        this.db.updateStep(siteId, def.id, { status: 'skipped', finished_at: nowIso(), message: result.message, error: null });
        ctx.log('info', `Bỏ qua: ${result.message}`);
      } else {
        // waiting: không tính là attempt thất bại
        this.db.updateStep(siteId, def.id, { status: 'waiting', attempts: attempts - 1, next_run_at: isoAfter(result.retryInMs), message: result.message });
        ctx.log('info', `Đang chờ: ${result.message}`);
      }
    } catch (err) {
      const msg = errorMessage(err);
      const retryable = isRetryable(err) && attempts < def.maxAttempts;
      const backoff = Math.min(30 * 60_000, 30_000 * 2 ** (attempts - 1));
      this.db.updateStep(siteId, def.id, {
        status: 'failed',
        finished_at: nowIso(),
        error: msg,
        next_run_at: retryable ? isoAfter(backoff) : null,
        attempts: retryable ? attempts : def.maxAttempts,
      });
      ctx.log('error', `Lỗi: ${msg}${retryable ? ` (sẽ thử lại sau ${Math.round(backoff / 1000)} giây)` : ''}`);
      if (!retryable) {
        this.db.updateSite(siteId, { error_summary: `${def.label}: ${msg}` });
        void this.services.notifier.send(`❌ ${site.domain}: bước "${def.label}" lỗi: ${msg}`).catch(() => undefined);
      }
    } finally {
      const fresh = this.db.getSite(siteId);
      if (fresh) {
        const status = deriveSiteStatus(this.steps, this.db.listSteps(siteId), fresh.status);
        const patch: Partial<Site> = { status };
        if (status === 'live' && !fresh.live_at) {
          patch.live_at = nowIso();
          patch.error_summary = null;
          void this.services.notifier.send(`✅ ${fresh.domain} đã LIVE.`).catch(() => undefined);
        }
        this.db.updateSite(siteId, patch);
      }
    }
  }
}
