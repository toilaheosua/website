import type { AppConfig } from '../config.js';
import type { Db, Run } from '../db/index.js';
import type { Services } from '../services/types.js';
import type { RunStatus, UsageTotals } from './types.js';
import { emptyUsage } from './types.js';
import { STEP_ORDER, VERIFY_ARTIFACTS, runnerFor, stepsFrom, type StepContext, type StepId, type WaitingFor } from './pipeline.js';
import { AppError, TransientError } from './errors.js';
import { errorMessage, nowIso, sleep } from './util.js';
import { createLogger } from './logger.js';

const log = createLogger('worker');

const WAITING_STATUS: Record<WaitingFor, RunStatus> = { places: 'waiting_places', outline: 'waiting_outline', ai_score: 'waiting_ai_score' };
const WAITING_BY_STEP: Partial<Record<StepId, RunStatus>> = { search: 'waiting_places', outline: 'waiting_outline', verify: 'waiting_ai_score' };
const WAITING_LOG: Record<WaitingFor, string> = { places: 'Dừng chờ bạn duyệt danh sách quán', outline: 'Dừng chờ duyệt bố cục', ai_score: 'Dừng chờ bạn nhập điểm Originality.ai' };

function mergeUsage(base: UsageTotals, delta: UsageTotals, extra: { searchCalls: number; detectorCredits: number }): UsageTotals {
  const out: UsageTotals = {
    calls: base.calls + delta.calls,
    inputTokens: base.inputTokens + delta.inputTokens,
    outputTokens: base.outputTokens + delta.outputTokens,
    usd: base.usd + delta.usd,
    byModel: { ...base.byModel },
    searchCalls: base.searchCalls + extra.searchCalls,
    detectorCredits: base.detectorCredits + extra.detectorCredits,
  };
  for (const [m, v] of Object.entries(delta.byModel)) {
    const cur = out.byModel[m] ?? { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
    out.byModel[m] = { calls: cur.calls + v.calls, inputTokens: cur.inputTokens + v.inputTokens, outputTokens: cur.outputTokens + v.outputTokens, usd: cur.usd + v.usd };
  }
  return out;
}

function isCancelled(err: unknown): boolean {
  return err instanceof AppError && err.code === 'cancelled';
}

/**
 * Worker trong cùng tiến trình: nhặt lần chạy ở trạng thái "queued", chạy lần lượt các bước,
 * lưu trạng thái từng bước vào DB để dashboard theo dõi và chạy lại được.
 * Mỗi bài đang chạy có một AbortController: Hủy hoặc Xóa sẽ ngắt ngay lượt gọi model đang dở để trả chỗ cho bài khác.
 */
export class Worker {
  private timer: NodeJS.Timeout | null = null;
  private active = new Map<number, AbortController>();
  private stopped = false;

  constructor(private readonly deps: { db: Db; config: AppConfig; services: Services; onRunFinished?: (run: Run) => void | Promise<void> }) {}

  /** Báo cho bên tích hợp (dashboard bot) khi bài kết thúc; chờ xong để bài được nhập trước khi worker trả chỗ. */
  private async notifyFinished(runId: number): Promise<void> {
    const run = this.deps.db.getRun(runId);
    if (!run || !this.deps.onRunFinished) return;
    try {
      await this.deps.onRunFinished(run);
    } catch (err) {
      log.error(`#${runId} onRunFinished lỗi: ${errorMessage(err)}`);
    }
  }

  get activeCount(): number {
    return this.active.size;
  }

  /** Các bài đang chiếm chỗ trong worker */
  activeIds(): number[] {
    return [...this.active.keys()];
  }

  get concurrency(): number {
    return Math.max(1, this.deps.config.WORKER_CONCURRENCY);
  }

  start(): void {
    this.stopped = false;
    // Lần chạy đang "running" khi tiến trình tắt đột ngột: đưa về queued để chạy tiếp
    for (const r of this.deps.db.listRunsByStatus('running', 50)) this.deps.db.updateRun(r.id, { status: 'queued' });
    this.timer = setInterval(() => void this.tick(), 1500);
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const c of this.active.values()) c.abort();
  }

  /** Đưa một lần chạy vào hàng đợi (tạo mới, duyệt bố cục xong, hoặc chạy lại). */
  enqueue(runId: number): void {
    const run = this.deps.db.getRun(runId);
    if (!run) return;
    this.deps.db.initSteps(runId, STEP_ORDER);
    this.deps.db.updateRun(runId, { status: 'queued', error: null, finished_at: null });
    void this.tick();
  }

  /** Người dùng duyệt danh sách quán (bài tổng hợp): đánh dấu bước tìm quán xong và chạy tiếp. */
  approvePlaces(runId: number): void {
    this.deps.db.setStep(runId, 'search', { status: 'done', finished_at: nowIso(), message: 'Danh sách quán đã được duyệt' });
    this.enqueue(runId);
  }

  /** Người dùng duyệt bố cục: đánh dấu bước outline xong và chạy tiếp. */
  approveOutline(runId: number): void {
    this.deps.db.setStep(runId, 'outline', { status: 'done', finished_at: nowIso(), message: 'Bố cục đã được duyệt' });
    this.enqueue(runId);
  }

  /** Người dùng nhập điểm chấm tay: chạy tiếp bước kiểm tra với điểm vừa nhập. */
  resumeVerify(runId: number): void {
    this.deps.db.setStep(runId, 'verify', { status: 'pending', finished_at: null, error: null });
    this.deps.db.resetSteps(runId, ['export']);
    this.enqueue(runId);
  }

  /** Chạy lại từ một bước: các bước từ đó trở đi về trạng thái chờ. */
  retryFrom(runId: number, step: StepId): void {
    const run = this.deps.db.getRun(runId);
    if (!run) return;
    this.deps.db.initSteps(runId, STEP_ORDER);
    this.deps.db.resetSteps(runId, stepsFrom(step));
    if (stepsFrom(step).includes('verify')) this.deps.db.deleteArtifacts(runId, [...VERIFY_ARTIFACTS]);
    else if (step === 'export') this.deps.db.deleteArtifacts(runId, ['exports']);
    this.deps.db.updateRun(runId, { status: 'queued', error: null, finished_at: null, finalScore: null });
    this.deps.db.addLog({ run_id: runId, step, level: 'info', message: `Chạy lại từ bước "${step}"` });
    void this.tick();
  }

  /** Hủy: đổi trạng thái và ngắt ngay lượt gọi model đang dở (nếu có). */
  cancel(runId: number): void {
    const run = this.deps.db.getRun(runId);
    if (!run) return;
    this.deps.db.updateRun(runId, { status: 'cancelled', finished_at: nowIso() });
    this.deps.db.addLog({ run_id: runId, level: 'warn', message: 'Người dùng hủy' });
    this.active.get(runId)?.abort();
  }

  /** Xóa: hủy trước nếu đang chạy, rồi xóa dữ liệu. */
  delete(runId: number): void {
    this.active.get(runId)?.abort();
    this.deps.db.deleteRun(runId);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    const free = Math.max(0, this.concurrency - this.active.size);
    if (!free) return;
    const queued = this.deps.db.listRunsByStatus('queued', free).filter((r) => !this.active.has(r.id));
    for (const r of queued) void this.process(r.id);
  }

  async process(runId: number): Promise<void> {
    if (this.active.has(runId)) return;
    const { db, config, services } = this.deps;
    // Khóa trong DB: một bài chỉ được một worker (một tiến trình) nhận
    if (!db.claimRun(runId)) return;
    const controller = new AbortController();
    this.active.set(runId, controller);
    try {
      let run = db.getRun(runId);
      if (!run) return;
      db.initSteps(runId, STEP_ORDER);
      let llm = services.llm(run.options.provider === 'default' ? undefined : run.options.provider, controller.signal);
      db.addLog({ run_id: runId, level: 'info', message: `Nhà cung cấp model: ${llm.provider}` });
      const baseUsage = run.usage ?? emptyUsage();
      const extra = { searchCalls: 0, detectorCredits: 0 };
      // Có thể đổi sang Claude giữa chừng khi OpenRouter rơi kết nối liên tiếp: cộng chi phí của mọi model đã dùng
      const llms = [llm];
      const saveUsage = () => {
        if (!db.getRun(runId)) return;
        let u = baseUsage;
        for (const l of llms) u = mergeUsage(u, l.usage(), { searchCalls: 0, detectorCredits: 0 });
        db.updateRun(runId, { usage: { ...u, searchCalls: u.searchCalls + extra.searchCalls, detectorCredits: u.detectorCredits + extra.detectorCredits } });
      };
      let usedFallback = false;
      let needsReview = false;

      for (const step of STEP_ORDER) {
        run = db.getRun(runId);
        if (!run) {
          log.warn(`#${runId} đã bị xóa khi đang chạy, dừng`);
          return;
        }
        if (run.status === 'cancelled' || controller.signal.aborted) return;
        const row = db.getStep(runId, step);
        if (row?.status === 'done') continue;
        if (row?.status === 'waiting') {
          db.updateRun(runId, { status: WAITING_BY_STEP[step] ?? 'waiting_outline', current_step: step });
          return;
        }
        const settings = db.getGeneralSettings();
        const ctx: StepContext = {
          run,
          db,
          config,
          services,
          llm,
          settings,
          signal: controller.signal,
          log: (message, level = 'info') => {
            db.addLog({ run_id: runId, step, level, message });
            log[level](`#${runId} ${step}: ${message}`);
          },
          count: (what, n) => {
            extra[what] += n;
          },
        };
        db.updateRun(runId, { current_step: step });
        const attempts = 3;
        let done = false;
        for (let attempt = 1; attempt <= attempts && !done; attempt++) {
          db.setStep(runId, step, { status: 'running', attempts: attempt, started_at: nowIso(), error: null });
          try {
            const result = await runnerFor(run.options.kind, step)(ctx);
            saveUsage();
            if (result.needsReview) needsReview = true;
            if (result.waiting) {
              db.setStep(runId, step, { status: 'waiting', message: result.message, finished_at: null });
              db.updateRun(runId, { status: WAITING_STATUS[result.waiting], current_step: step });
              db.addLog({ run_id: runId, step, level: 'info', message: WAITING_LOG[result.waiting] });
              return;
            }
            db.setStep(runId, step, { status: 'done', message: result.message, finished_at: nowIso() });
            done = true;
          } catch (err) {
            saveUsage();
            if (isCancelled(err) || controller.signal.aborted) {
              if (db.getRun(runId)) {
                db.setStep(runId, step, { status: 'pending', message: 'Đã hủy khi đang chạy', finished_at: null });
                db.addLog({ run_id: runId, step, level: 'warn', message: 'Đã ngắt lượt gọi đang dở vì bài bị hủy' });
              }
              return;
            }
            const msg = errorMessage(err);
            const transient = err instanceof TransientError;
            db.addLog({ run_id: runId, step, level: 'error', message: `${transient ? 'Lỗi tạm thời' : 'Lỗi'} (lần ${attempt}): ${msg}` });
            log.error(`#${runId} ${step} lỗi lần ${attempt}: ${msg}`);
            if (transient && attempt < attempts) {
              await sleep(3000 * attempt);
              continue;
            }
            // OpenRouter hoặc DeepSeek hỏng tạm thời liên tiếp (rơi kết nối, quá tải): chạy lại bước này bằng Claude nếu có key
            if (transient && !usedFallback && (llm.provider === 'openrouter' || llm.provider === 'deepseek') && settings.llmFallback && services.integrations().anthropic.configured) {
              const from = llm.provider === 'deepseek' ? 'DeepSeek' : 'OpenRouter';
              usedFallback = true;
              llm = services.llm('anthropic', controller.signal);
              llms.push(llm);
              ctx.llm = llm;
              db.addLog({ run_id: runId, step, level: 'warn', message: `${from} lỗi tạm thời ${attempts} lần liên tiếp, chuyển bước này và các bước sau sang Claude (${db.getGeneralSettings().writerModel})` });
              attempt = 0;
              continue;
            }
            db.setStep(runId, step, { status: 'failed', error: msg, finished_at: nowIso() });
            db.updateRun(runId, { status: 'failed', error: `${step}: ${msg}`, finished_at: nowIso() });
            await this.notifyFinished(runId);
            return;
          }
        }
      }
      db.updateRun(runId, { status: needsReview ? 'needs_review' : 'done', current_step: null, finished_at: nowIso() });
      db.addLog({ run_id: runId, level: 'info', message: needsReview ? 'Hoàn tất nhưng bài chưa đạt kiểm tra, cần bạn xem lại' : 'Hoàn tất, bài đạt kiểm tra' });
      await this.notifyFinished(runId);
    } catch (err) {
      const msg = errorMessage(err);
      log.error(`#${runId} lỗi ngoài bước: ${msg}`);
      if (db.getRun(runId)) {
        db.updateRun(runId, { status: 'failed', error: msg, finished_at: nowIso() });
        await this.notifyFinished(runId);
      }
    } finally {
      this.active.delete(runId);
      void this.tick();
    }
  }

  /** Chạy một lần chạy tới cùng, dùng cho CLI và test (không cần timer). */
  async runToCompletion(runId: number, timeoutMs = 10 * 60_000): Promise<Run> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const run = this.deps.db.getRun(runId);
      if (!run) throw new Error(`Không có lần chạy #${runId}`);
      if (['done', 'needs_review', 'failed', 'cancelled', 'waiting_places', 'waiting_outline', 'waiting_ai_score'].includes(run.status)) return run;
      if (run.status === 'queued' && !this.active.has(runId)) await this.process(runId);
      else await sleep(200);
    }
    throw new Error(`Lần chạy #${runId} quá thời gian`);
  }
}
