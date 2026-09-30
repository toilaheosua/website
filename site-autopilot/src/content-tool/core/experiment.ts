import type { AppConfig } from '../config.js';
import type { Db, Run } from '../db/index.js';
import type { LlmSpec, Services } from '../services/types.js';
import type { Article, Experiment, ExperimentVariant, LlmProvider, Outline, ResearchNotes, UsageTotals } from './types.js';
import { emptyUsage } from './types.js';
import { AppError } from './errors.js';
import { errorMessage, nowIso, randomHex } from './util.js';
import { finalizeArticleFor, quickChecks } from './pipeline.js';
import { articleToPlainText } from '../generator/markdown.js';
import { createLogger } from './logger.js';

const log = createLogger('experiment');

/**
 * Thử nghiệm model: cùng một ghi chú và bố cục, viết bằng nhiều model (tùy chọn viết lại bằng model thứ hai),
 * chấm điểm AI từng bản (tự động qua API hoặc bạn nhập), để chọn model cho điểm thấp nhất làm mặc định.
 */

export interface ParsedVariant {
  write: { provider: LlmProvider; model: string; temperature: number | null };
  rewrite: { provider: LlmProvider; model: string } | null;
}

function parseModelRef(raw: string): { provider: LlmProvider; model: string } | null {
  const t = raw.trim();
  if (!t) return null;
  const m = /^(anthropic|claude|openrouter|or|deepseek|ds)\s*:\s*(.+)$/i.exec(t);
  if (m) {
    const p: LlmProvider = /^(anthropic|claude)$/i.test(m[1]!) ? 'anthropic' : /^(deepseek|ds)$/i.test(m[1]!) ? 'deepseek' : 'openrouter';
    return { provider: p, model: m[2]!.trim() };
  }
  // Không ghi nhà cung cấp: "claude..." là Anthropic; "deepseek-chat", "deepseek-reasoner" (không có dấu /) là DeepSeek trực tiếp;
  // còn lại là OpenRouter (dạng hãng/model, kể cả "deepseek/deepseek-v4...")
  return { provider: /^claude/i.test(t) ? 'anthropic' : /^deepseek-[a-z]/i.test(t) && !t.includes('/') ? 'deepseek' : 'openrouter', model: t };
}

/**
 * Mỗi dòng một biến thể:
 *   anthropic:claude-opus-5
 *   openrouter:deepseek/deepseek-v4-flash-0731 @t=1.2
 *   deepseek:deepseek-chat @t=1.5                          (API trực tiếp của platform.deepseek.com)
 *   qwen/qwen3.6-235b >> anthropic:claude-sonnet-5      (viết bằng model đầu, model sau viết lại)
 */
export function parseVariantLines(text: string): ParsedVariant[] {
  const out: ParsedVariant[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [left, right] = line.split(/\s*>>\s*/);
    let temperature: number | null = null;
    const head = (left ?? '').replace(/@\s*t\s*=\s*([0-9.]+)/i, (_m, v: string) => {
      const n = Number.parseFloat(v);
      if (Number.isFinite(n)) temperature = Math.min(2, Math.max(0, n));
      return '';
    });
    const write = parseModelRef(head);
    if (!write) continue;
    const rewrite = right ? parseModelRef(right) : null;
    out.push({ write: { ...write, temperature }, rewrite });
  }
  return out;
}

export function variantLabel(v: Pick<ExperimentVariant, 'write' | 'rewrite'>): string {
  const w = `${v.write.model}${v.write.temperature !== null ? ` @t=${v.write.temperature}` : ''}`;
  return v.rewrite ? `${w} → viết lại: ${v.rewrite.model}` : w;
}

function toVariant(p: ParsedVariant): ExperimentVariant {
  const base: ExperimentVariant = {
    id: randomHex(4),
    label: '',
    write: p.write,
    rewrite: p.rewrite,
    status: 'pending',
    error: null,
    article: null,
    text: '',
    words: 0,
    qualityMajor: 0,
    qualityMinor: 0,
    dupRatio: 0,
    usd: 0,
    calls: 0,
    aiScore: null,
    flagged: [],
    scoreSource: null,
    scoredAt: null,
    startedAt: null,
    finishedAt: null,
  };
  base.label = variantLabel(base);
  return base;
}

function addUsage(base: UsageTotals, delta: UsageTotals, detectorCredits = 0): UsageTotals {
  const out: UsageTotals = { ...base, byModel: { ...base.byModel } };
  out.calls += delta.calls;
  out.inputTokens += delta.inputTokens;
  out.outputTokens += delta.outputTokens;
  out.usd += delta.usd;
  out.detectorCredits += detectorCredits;
  for (const [m, v] of Object.entries(delta.byModel)) {
    const cur = out.byModel[m] ?? { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
    out.byModel[m] = { calls: cur.calls + v.calls, inputTokens: cur.inputTokens + v.inputTokens, outputTokens: cur.outputTokens + v.outputTokens, usd: cur.usd + v.usd };
  }
  return out;
}

/** Bản có điểm AI thấp nhất trong các bản đã chấm; null khi chưa bản nào có điểm. */
export function bestVariant(e: Experiment): ExperimentVariant | null {
  const scored = e.variants.filter((v) => v.status === 'done' && v.aiScore !== null);
  if (!scored.length) return null;
  return scored.sort((a, b) => a.aiScore! - b.aiScore! || a.qualityMajor - b.qualityMajor)[0]!;
}

export class ExperimentRunner {
  private active = new Map<number, { controller: AbortController; promise: Promise<void> }>();

  constructor(private readonly deps: { db: Db; config: AppConfig; services: Services }) {}

  isRunning(runId: number): boolean {
    return this.active.has(runId);
  }

  cancel(runId: number): void {
    this.active.get(runId)?.controller.abort();
  }

  /** Chờ thử nghiệm của một bài chạy xong (test và CLI). */
  async wait(runId: number): Promise<void> {
    await this.active.get(runId)?.promise;
  }

  /** Bắt đầu thử nghiệm; trả về ngay, các bản chạy nền với tối đa `concurrency` bản một lúc. */
  start(runId: number, parsed: ParsedVariant[], opts: { note?: string; concurrency?: number } = {}): Experiment {
    const { db } = this.deps;
    const run = db.getRun(runId);
    if (!run) throw new AppError('Không có bài này');
    if (this.active.has(runId)) throw new AppError('Bài này đang có thử nghiệm chạy dở');
    if (run.status === 'queued' || run.status === 'running') throw new AppError('Bài đang chạy, chờ xong rồi thử model');
    if (!parsed.length) throw new AppError('Chưa có model nào để thử. Mỗi dòng một model, ví dụ "anthropic:claude-opus-5".');
    if (parsed.length > 8) throw new AppError('Tối đa 8 bản một lần để kiểm soát chi phí');
    if (!db.getArtifact<ResearchNotes>(runId, 'notes') || !db.getArtifact<Outline>(runId, 'outline')) throw new AppError('Bài cần có ghi chú và bố cục trước khi thử model. Chạy tới bước "Lập bố cục" đã.');
    const exp: Experiment = { createdAt: nowIso(), finishedAt: null, status: 'running', note: opts.note?.trim() ?? '', variants: parsed.map(toVariant) };
    db.saveArtifact(runId, 'experiment', exp);
    db.addLog({ run_id: runId, level: 'info', message: `Bắt đầu thử ${exp.variants.length} model: ${exp.variants.map((v) => v.label).join(' | ')}` });
    const controller = new AbortController();
    const promise = this.runAll(run, exp, controller, opts.concurrency ?? 2).finally(() => this.active.delete(runId));
    this.active.set(runId, { controller, promise });
    return exp;
  }

  private save(runId: number, exp: Experiment): void {
    if (this.deps.db.getRun(runId)) this.deps.db.saveArtifact(runId, 'experiment', exp);
  }

  private async runAll(run: Run, exp: Experiment, controller: AbortController, concurrency: number): Promise<void> {
    const { db } = this.deps;
    const queue = [...exp.variants];
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
      while (queue.length && !controller.signal.aborted) {
        const v = queue.shift()!;
        await this.runOne(run, exp, v, controller.signal);
        this.save(run.id, exp);
      }
    });
    await Promise.all(workers);
    exp.status = controller.signal.aborted ? 'cancelled' : 'done';
    exp.finishedAt = nowIso();
    for (const v of exp.variants) if (v.status === 'pending' || v.status === 'running') (v.status = 'failed'), (v.error = v.error ?? 'Đã hủy');
    this.save(run.id, exp);
    if (db.getRun(run.id)) {
      const best = bestVariant(exp);
      db.addLog({ run_id: run.id, level: 'info', message: `Thử model ${exp.status === 'done' ? 'xong' : 'đã hủy'}: ${exp.variants.filter((v) => v.status === 'done').length}/${exp.variants.length} bản${best ? `; điểm AI thấp nhất ${(best.aiScore! * 100).toFixed(1)}% ở ${best.label}` : ''}` });
    }
  }

  private async runOne(run: Run, exp: Experiment, v: ExperimentVariant, signal: AbortSignal): Promise<void> {
    const { db, services } = this.deps;
    v.status = 'running';
    v.startedAt = nowIso();
    this.save(run.id, exp);
    let usage = emptyUsage();
    try {
      const settings = db.getGeneralSettings();
      const notes = db.getArtifact<ResearchNotes>(run.id, 'notes')!.content;
      const outline = db.getArtifact<Outline>(run.id, 'outline')!.content;
      const writeSpec: LlmSpec = { provider: v.write.provider, writerModel: v.write.model, temperature: v.write.temperature ?? undefined };
      const writer = services.llmWith(writeSpec, signal);
      let article: Article = await writer.writeArticle({ keyword: run.keyword, options: run.options, settings, notes, outline });
      usage = addUsage(usage, writer.usage());
      if (v.rewrite) {
        const editor = services.llmWith({ provider: v.rewrite.provider, writerModel: v.rewrite.model }, signal);
        article = await editor.editArticle({
          keyword: run.keyword,
          options: run.options,
          settings,
          notes,
          outline,
          article: finalizeArticleFor(db, run, article),
          feedback: ['[BẮT BUỘC] Đây là lượt viết lại bằng model khác: đổi hẳn cách diễn đạt của từng câu (trật tự từ, độ dài, cách mở câu), giữ nguyên dữ kiện, heading, bảng và các dòng tool chèn; văn xuôi phải đọc như một người khác đang kể lại.'],
        });
        usage = addUsage(usage, editor.usage());
      }
      article = finalizeArticleFor(db, run, article);
      const q = quickChecks(db, run, settings, article);
      v.article = article;
      v.text = articleToPlainText(article);
      v.words = q.words;
      v.qualityMajor = q.quality.filter((i) => i.severity === 'major').length;
      v.qualityMinor = q.quality.filter((i) => i.severity === 'minor').length;
      v.dupRatio = q.dup.ratio;
      v.status = 'done';
      // Chấm tự động khi có API dò (hoặc mock); chế độ chấm tay thì chờ bạn nhập
      const detector = services.detector();
      let credits = 0;
      if (detector.id !== 'manual' && detector.id !== 'none') {
        try {
          const r = await detector.scan(v.text, { title: run.keyword, model: settings.originalityModel, plagiarism: false, aiScoreMax: settings.aiScoreMax });
          if (!r.skipped) {
            v.aiScore = r.aiScore;
            v.flagged = r.blocks.filter((b) => b.aiScore >= 0.5).map((b) => b.text).slice(0, 25);
            v.scoreSource = detector.id === 'mock' ? 'mock' : 'api';
            v.scoredAt = nowIso();
            credits = r.creditsUsed ?? 0;
          }
        } catch (err) {
          log.warn(`Chấm tự động bản ${v.label} lỗi: ${errorMessage(err)}`);
        }
      }
      v.usd = usage.usd;
      v.calls = usage.calls;
      const cur = db.getRun(run.id);
      if (cur) db.updateRun(run.id, { usage: addUsage(cur.usage ?? emptyUsage(), usage, credits) });
      db.addLog({ run_id: run.id, level: 'info', message: `Thử model "${v.label}": ${v.words} từ, ${v.qualityMajor} lỗi bắt buộc${v.aiScore !== null ? `, AI ${(v.aiScore * 100).toFixed(1)}%` : ''}, ${usage.usd.toFixed(3)} USD` });
    } catch (err) {
      v.status = 'failed';
      v.error = errorMessage(err);
      v.usd = usage.usd;
      v.calls = usage.calls;
      const cur = db.getRun(run.id);
      if (cur) db.updateRun(run.id, { usage: addUsage(cur.usage ?? emptyUsage(), usage) });
      if (db.getRun(run.id)) db.addLog({ run_id: run.id, level: 'warn', message: `Thử model "${v.label}" lỗi: ${v.error}` });
    } finally {
      v.finishedAt = nowIso();
    }
  }
}
