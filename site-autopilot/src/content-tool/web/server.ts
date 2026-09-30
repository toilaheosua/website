import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import type { Services } from '../services/types.js';
import type { Worker } from '../core/worker.js';
import fs from 'node:fs';
import path from 'node:path';
import type { Article, CheckRound, Experiment, ManualScore, Outline, PendingScore, PlacesData, ResearchNotes, SerpData } from '../core/types.js';
import { VERIFY_ARTIFACTS, isStepId, latestArticle, manualScoreFor, quickChecks } from '../core/pipeline.js';
import { ExperimentRunner, parseVariantLines } from '../core/experiment.js';
import { placesForExport, placesJsonLd } from '../core/roundup.js';
import { errorMessage, nowIso, slugify } from '../core/util.js';
import { SECRET_NAMES, type SecretInfo, type SecretName } from '../core/secrets.js';
import { buildExportBundle, bundleToZip } from '../generator/photos.js';
import { parseOriginalityDocx } from '../generator/originality-report.js';
import { raw } from 'hono/html';
import { DASHBOARD_CSS } from './ui.css.js';
import type { Flash } from './layout.js';
import { HomePage, LogsPage, RunDetail, SettingsPage, type RunTab } from './views.js';
import { lines, parseAiScoreInput, parseArticleForm, parseGeneralSettings, parseOutlineForm, parsePlacesForm, parseRunOptions, str, type FormBody } from './forms.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('web');

export interface WebDeps {
  db: Db;
  config: AppConfig;
  services: Services;
  worker: Worker;
  /** Thử nghiệm model; tạo mới nếu không truyền */
  experiments?: ExperimentRunner;
  /** Khung trang của dashboard bot (thanh điều hướng, đăng nhập dùng chung). */
  shell: (c: Context, title: string, body: unknown, opts: { refresh?: number; pollUrl?: string; pollKey?: string; flash?: Flash | null }) => Response | Promise<Response>;
}

/** CSS riêng của mô-đun (bỏ :root để giữ bảng màu của bot). */
export const TOOL_CSS = DASHBOARD_CSS.replace(/:root\{[^}]*\}\n?/, '');

const FLASH_COOKIE = 'vc_flash';
const TABS: RunTab[] = ['overview', 'sources', 'places', 'notes', 'outline', 'article', 'checks', 'experiment', 'log'];

export function createApp(deps: WebDeps): Hono {
  const { db, config, services, worker } = deps;
  const experiments = deps.experiments ?? new ExperimentRunner({ db, config, services });
  const app = new Hono();

  const flash = (c: Context, f: Flash) => setCookie(c, FLASH_COOKIE, JSON.stringify(f), { path: '/', maxAge: 60, httpOnly: true, sameSite: 'Lax' });
  const takeFlash = (c: Context): Flash | null => {
    const raw = getCookie(c, FLASH_COOKIE);
    if (!raw) return null;
    deleteCookie(c, FLASH_COOKIE, { path: '/' });
    try {
      return JSON.parse(raw) as Flash;
    } catch {
      return null;
    }
  };
  const render = (c: Context, title: string, _active: string, body: unknown, opts: { refresh?: number; pollUrl?: string; pollKey?: string } = {}) =>
    deps.shell(c, title, [raw(`<style>${TOOL_CSS}</style>`), body], { ...opts, flash: takeFlash(c) });

  const runOr404 = (c: Context) => {
    const id = Number.parseInt(c.req.param('id') ?? '', 10);
    return Number.isFinite(id) ? db.getRun(id) : undefined;
  };

  const secretInfos = (): Record<SecretName, SecretInfo> => Object.fromEntries(SECRET_NAMES.map((n) => [n, services.secrets.info(n)])) as Record<SecretName, SecretInfo>;
  const settingsProps = (tests?: Record<string, { ok: boolean; message: string }>) => ({
    settings: db.getGeneralSettings(),
    config,
    secrets: secretInfos(),
    integ: services.integrations(),
    tests,
  });

  // Đăng nhập, CSRF và /healthz do dashboard bot đảm nhiệm; mô-đun này được gắn sau requireAuth của bot.

  /* ---------------- trang chủ và tạo bài ---------------- */
  app.get('/content', (c) => {
    const runs = db.listRuns(200);
    const busy = runs.some((r) => r.status === 'queued' || r.status === 'running');
    // Chỉ tải lại khi trạng thái bài đổi (hỏi nhẹ mỗi 4 giây), không tải lại theo đồng hồ để không làm mất ô đang gõ
    return render(c, 'Bài viết', 'home', HomePage({ runs, settings: db.getGeneralSettings(), integ: services.integrations(), mock: config.isMock, stats: db.countRuns() }), busy ? { pollUrl: '/content/status.json', pollKey: homeKey() } : {});
  });

  const homeKey = () =>
    db
      .listRuns(60)
      .map((r) => `${r.id}:${r.status}:${r.current_step ?? ''}`)
      .join(',');
  app.get('/content/status.json', (c) => c.json({ key: homeKey() }));

  app.post('/runs', async (c) => {
    const body = (await c.req.parseBody()) as FormBody;
    const settings = db.getGeneralSettings();
    const options = parseRunOptions(body, settings);
    let keyword = str(body, 'keyword').trim().replace(/\s+/g, ' ');
    if (options.kind === 'roundup') {
      if (options.dish.length < 2 || options.area.length < 2) {
        flash(c, { type: 'err', text: 'Bài tổng hợp quán cần cả "Món hoặc loại quán" và "Khu vực".' });
        return c.redirect('/content');
      }
      keyword = `${options.dish} ${options.area}`;
    }
    if (options.kind === 'brand') {
      if (!/^https?:\/\//i.test(options.mapsUrl) || !/google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google/i.test(options.mapsUrl)) {
        flash(c, { type: 'err', text: 'Cần link Google Maps của địa điểm (từ nút Chia sẻ trên Google Maps).' });
        return c.redirect('/content');
      }
      keyword = options.brandName || 'Thương hiệu từ Google Maps';
    }
    if (keyword.length < 2) {
      flash(c, { type: 'err', text: 'Từ khóa quá ngắn' });
      return c.redirect('/content');
    }
    const run = db.createRun(keyword, options);
    db.addLog({ run_id: run.id, level: 'info', message: options.kind === 'roundup' ? `Tạo bài tổng hợp quán "${options.dish}" ở "${options.area}" (${options.placesCount} quán)` : `Tạo bài cho từ khóa "${keyword}"` });
    worker.enqueue(run.id);
    return c.redirect(`/runs/${run.id}`);
  });

  /* ---------------- chi tiết ---------------- */
  app.get('/runs/:id', (c) => {
    const run = runOr404(c);
    if (!run) return c.notFound();
    const tabQ = c.req.query('tab') ?? 'overview';
    const tab = (TABS as string[]).includes(tabQ) ? (tabQ as RunTab) : 'overview';
    const exportsA = db.getArtifact<{ dir: string; files: Record<string, string> }>(run.id, 'exports');
    const props = {
      run,
      steps: db.getSteps(run.id),
      tab,
      settings: db.getGeneralSettings(),
      serp: db.getArtifact<SerpData>(run.id, 'serp')?.content ?? null,
      sources: db.listSources(run.id),
      places: db.getArtifact<PlacesData>(run.id, 'places'),
      notes: db.getArtifact<ResearchNotes>(run.id, 'notes')?.content ?? null,
      outline: db.getArtifact<Outline>(run.id, 'outline'),
      article: latestArticle(db, run.id),
      checks: db.listArtifacts<CheckRound>(run.id, 'check'),
      exportsInfo: exportsA?.content ?? null,
      logs: db.listLogs(run.id, 300),
      pending: db.getArtifact<PendingScore>(run.id, 'pending_score')?.content ?? null,
      scores: db.listArtifacts<ManualScore>(run.id, 'ai_score').map((a) => a.content),
      experiment: db.getArtifact<Experiment>(run.id, 'experiment')?.content ?? null,
      experimentRunning: experiments.isRunning(run.id),
      integ: services.integrations(),
      detectorMode: services.integrations().originality.mode,
      activeRuns: worker.activeIds(),
      concurrency: worker.concurrency,
    };
    const busy = run.status === 'queued' || run.status === 'running' || experiments.isRunning(run.id);
    return render(c, `#${run.id} ${run.keyword}`, 'home', RunDetail(props), busy ? { pollUrl: `/runs/${run.id}/status.json`, pollKey: statusKey(run.id) } : {});
  });

  /** Khóa trạng thái của một bài: đổi khi bước, vòng kiểm tra hoặc tiến độ thử nghiệm model đổi; trang chỉ tải lại khi khóa đổi. */
  const statusKey = (id: number) => {
    const run = db.getRun(id);
    if (!run) return '';
    const steps = db.getSteps(id).map((s) => `${s.step}:${s.status}:${s.attempts}`).join(',');
    const exp = db.getArtifact<Experiment>(id, 'experiment')?.content;
    const expKey = exp ? `${exp.status}:${exp.variants.map((v) => `${v.status}${v.aiScore === null ? '' : '*'}`).join('')}` : '';
    return `${run.status}|${run.current_step ?? ''}|${run.rounds}|${steps}|${expKey}`;
  };
  app.get('/runs/:id/status.json', (c) => {
    const run = runOr404(c);
    if (!run) return c.json({ error: 'not found' }, 404);
    return c.json({ key: statusKey(run.id), status: run.status, currentStep: run.current_step, rounds: run.rounds });
  });
  void manualScoreFor;

  app.post('/runs/:id/approve', (c) => {
    const run = runOr404(c);
    if (!run) return c.notFound();
    if (run.status === 'waiting_places') {
      worker.approvePlaces(run.id);
      flash(c, { type: 'ok', text: 'Đã duyệt danh sách quán, đang lấy đánh giá và viết bài' });
      return c.redirect(`/runs/${run.id}`);
    }
    if (run.status !== 'waiting_outline') {
      flash(c, { type: 'warn', text: 'Lần chạy này không đang chờ duyệt' });
      return c.redirect(`/runs/${run.id}`);
    }
    worker.approveOutline(run.id);
    flash(c, { type: 'ok', text: 'Đã duyệt bố cục, đang viết bài' });
    return c.redirect(`/runs/${run.id}`);
  });

  /** Tab Quán: lưu quán được chọn và ghi chú; duyệt để chạy tiếp; hoặc lấy lại đánh giá và viết lại. */
  app.post('/runs/:id/places', async (c) => {
    const run = runOr404(c);
    if (!run) return c.notFound();
    const cur = db.getArtifact<PlacesData>(run.id, 'places');
    if (!cur) {
      flash(c, { type: 'err', text: 'Chưa có danh sách quán' });
      return c.redirect(`/runs/${run.id}?tab=places`);
    }
    if (run.status === 'queued' || run.status === 'running') {
      flash(c, { type: 'warn', text: 'Đang chạy, chờ xong rồi sửa' });
      return c.redirect(`/runs/${run.id}?tab=places`);
    }
    const body = (await c.req.parseBody()) as FormBody;
    const data = parsePlacesForm(body, cur.content);
    const featured = data.candidates.filter((p) => p.featured && !p.excludedReason).length;
    if (!featured) {
      flash(c, { type: 'err', text: 'Cần chọn ít nhất một quán' });
      return c.redirect(`/runs/${run.id}?tab=places`);
    }
    const v = db.saveArtifact(run.id, 'places', data);
    db.addLog({ run_id: run.id, step: 'search', level: 'info', message: `Người dùng sửa danh sách quán (bản ${v}): ${featured} quán được chọn` });
    const action = str(body, 'action');
    if (action === 'approve' && run.status === 'waiting_places') {
      worker.approvePlaces(run.id);
      flash(c, { type: 'ok', text: `Đã lưu ${featured} quán, đang lấy đánh giá và viết bài` });
      return c.redirect(`/runs/${run.id}`);
    }
    if (action === 'rerun') {
      worker.retryFrom(run.id, 'fetch');
      flash(c, { type: 'ok', text: `Đã lưu ${featured} quán, đang lấy đánh giá và viết lại bài` });
      return c.redirect(`/runs/${run.id}`);
    }
    flash(c, { type: 'ok', text: `Đã lưu danh sách quán bản ${v} (${featured} quán)` });
    return c.redirect(`/runs/${run.id}?tab=places`);
  });

  /** Ảnh quán đã tải về, để xem trước trong dashboard. */
  app.get('/runs/:id/photos/:file', (c) => {
    const run = runOr404(c);
    if (!run) return c.notFound();
    const file = c.req.param('file') ?? '';
    if (!/^[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(file)) return c.notFound();
    const full = path.join(config.exportsDir, String(run.id), 'photos', file);
    if (!fs.existsSync(full)) return c.notFound();
    const ext = file.split('.').pop()!.toLowerCase();
    c.header('content-type', ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
    c.header('cache-control', 'private, max-age=3600');
    return c.body(new Uint8Array(fs.readFileSync(full)));
  });

  /** Người dùng nhập điểm từ web Originality.ai cho bản bài hiện tại, rồi bước kiểm tra chạy tiếp. */
  app.post('/runs/:id/score', async (c) => {
    const run = runOr404(c);
    if (!run) return c.notFound();
    if (run.status !== 'waiting_ai_score' && run.status !== 'needs_review' && run.status !== 'done') {
      flash(c, { type: 'warn', text: 'Lần chạy này không ở trạng thái nhận điểm' });
      return c.redirect(`/runs/${run.id}`);
    }
    const cur = latestArticle(db, run.id);
    if (!cur) {
      flash(c, { type: 'err', text: 'Chưa có bài để chấm' });
      return c.redirect(`/runs/${run.id}`);
    }
    const body = (await c.req.parseBody()) as FormBody;
    const raw = str(body, 'score');
    const typed = raw.trim() ? parseAiScoreInput(raw) : null;
    if (raw.trim() && typed === null) {
      flash(c, { type: 'err', text: `Không đọc được điểm từ "${raw.slice(0, 60)}". Nhập số phần trăm AI, ví dụ 12 hoặc 12%.` });
      return c.redirect(`/runs/${run.id}`);
    }
    let flagged = lines(body, 'flagged').slice(0, 40);
    let report: ManualScore['report'];
    const file = body.report;
    if (file instanceof File && file.size > 0) {
      try {
        const parsed = await parseOriginalityDocx(Buffer.from(await file.arrayBuffer()), 0.5);
        report = { fileName: file.name, runs: parsed.runs.filter((r) => r.fill).length, words: parsed.totalWords, flaggedWords: parsed.flaggedWords, estimatedAi: parsed.estimatedAi, scoreTyped: typed !== null };
        const merged = new Set([...parsed.flagged, ...flagged]);
        flagged = [...merged].slice(0, 60);
      } catch (err) {
        flash(c, { type: 'err', text: `Không đọc được file: ${errorMessage(err)}` });
        return c.redirect(`/runs/${run.id}`);
      }
    }
    const aiScore = typed ?? report?.estimatedAi ?? null;
    if (aiScore === null) {
      flash(c, { type: 'err', text: 'Cần nhập phần trăm AI hoặc chọn file .docx xuất từ Originality.ai.' });
      return c.redirect(`/runs/${run.id}`);
    }
    const score: ManualScore = { articleKey: cur.key, aiScore, flagged, raw: raw.slice(0, 2000), enteredAt: new Date().toISOString(), ...(report ? { report } : {}) };
    db.saveArtifact(run.id, 'ai_score', score);
    const src = report ? `file ${report.fileName} (${report.words} từ, ${report.flaggedWords} từ vùng đỏ, ước tính ${(report.estimatedAi * 100).toFixed(1)}%)${typed !== null ? ' + điểm gõ tay' : ''}` : 'gõ tay';
    db.addLog({ run_id: run.id, step: 'verify', level: 'info', message: `Người dùng nhập điểm Originality.ai ${(aiScore * 100).toFixed(1)}% cho bản ${cur.key} từ ${src}, ${flagged.length} câu bị đánh dấu` });
    worker.resumeVerify(run.id);
    flash(c, { type: 'ok', text: `Đã ghi điểm ${(aiScore * 100).toFixed(1)}% AI cho bản ${cur.key} (${src}), ${flagged.length} câu sẽ được viết lại nếu chưa đạt. Đang kiểm tra tiếp.` });
    return c.redirect(`/runs/${run.id}`);
  });


  /* ---------------- thử nghiệm model ---------------- */
  app.post('/runs/:id/experiment', async (c) => {
    const run = runOr404(c);
    if (!run) return c.notFound();
    const body = (await c.req.parseBody()) as FormBody;
    try {
      const variants = parseVariantLines(str(body, 'models'));
      const exp = experiments.start(run.id, variants, { note: str(body, 'note').slice(0, 500), concurrency: 2 });
      flash(c, { type: 'ok', text: `Đang viết ${exp.variants.length} bản bằng các model đã chọn, mỗi bản vài phút. Trang tự làm mới.` });
    } catch (err) {
      flash(c, { type: 'err', text: errorMessage(err) });
    }
    return c.redirect(`/runs/${run.id}?tab=experiment`);
  });

  app.post('/runs/:id/experiment/cancel', (c) => {
    const run = runOr404(c);
    if (!run) return c.notFound();
    experiments.cancel(run.id);
    flash(c, { type: 'warn', text: 'Đã hủy thử nghiệm, các bản đang viết bị ngắt.' });
    return c.redirect(`/runs/${run.id}?tab=experiment`);
  });

  /** Nhập điểm Originality.ai cho một bản thử (gõ số hoặc file .docx xuất từ web). */
  app.post('/runs/:id/experiment/score', async (c) => {
    const run = runOr404(c);
    if (!run) return c.notFound();
    const expA = db.getArtifact<Experiment>(run.id, 'experiment');
    const body = (await c.req.parseBody()) as FormBody;
    const vid = str(body, 'variant');
    const v = expA?.content.variants.find((x) => x.id === vid);
    if (!expA || !v || v.status !== 'done') {
      flash(c, { type: 'err', text: 'Không có bản thử này hoặc bản chưa viết xong' });
      return c.redirect(`/runs/${run.id}?tab=experiment`);
    }
    const raw = str(body, 'score');
    let score = raw.trim() ? parseAiScoreInput(raw) : null;
    let flagged: string[] = [];
    const file = body.report;
    if (file instanceof File && file.size > 0) {
      try {
        const parsed = await parseOriginalityDocx(Buffer.from(await file.arrayBuffer()), 0.5);
        if (score === null) score = parsed.estimatedAi;
        flagged = parsed.flagged.slice(0, 40);
      } catch (err) {
        flash(c, { type: 'err', text: `Không đọc được file: ${errorMessage(err)}` });
        return c.redirect(`/runs/${run.id}?tab=experiment`);
      }
    }
    if (score === null) {
      flash(c, { type: 'err', text: 'Nhập phần trăm AI (ví dụ 12) hoặc chọn file .docx.' });
      return c.redirect(`/runs/${run.id}?tab=experiment`);
    }
    v.aiScore = score;
    v.flagged = flagged;
    v.scoreSource = 'manual';
    v.scoredAt = new Date().toISOString();
    db.saveArtifact(run.id, 'experiment', expA.content);
    db.addLog({ run_id: run.id, level: 'info', message: `Điểm AI ${(score * 100).toFixed(1)}% cho bản thử "${v.label}"` });
    flash(c, { type: 'ok', text: `Đã ghi ${(score * 100).toFixed(1)}% AI cho "${v.label}"` });
    return c.redirect(`/runs/${run.id}?tab=experiment`);
  });

  /** Dùng bản thử làm bài chính: lưu thành bản sửa rồi chạy kiểm tra và xuất từ đó. */
  app.post('/runs/:id/experiment/adopt', async (c) => {
    const run = runOr404(c);
    if (!run) return c.notFound();
    if (run.status === 'queued' || run.status === 'running' || experiments.isRunning(run.id)) {
      flash(c, { type: 'warn', text: 'Đang chạy, chờ xong rồi chọn bản' });
      return c.redirect(`/runs/${run.id}?tab=experiment`);
    }
    const body = (await c.req.parseBody()) as FormBody;
    const exp = db.getArtifact<Experiment>(run.id, 'experiment')?.content;
    const v = exp?.variants.find((x) => x.id === str(body, 'variant'));
    if (!v?.article) {
      flash(c, { type: 'err', text: 'Bản thử chưa có bài' });
      return c.redirect(`/runs/${run.id}?tab=experiment`);
    }
    db.deleteArtifacts(run.id, [...VERIFY_ARTIFACTS]);
    const ver = db.saveArtifact(run.id, 'fixed', v.article);
    if (v.aiScore !== null && v.scoreSource === 'manual') db.saveArtifact(run.id, 'ai_score', { articleKey: `fixed:${ver}`, aiScore: v.aiScore, flagged: v.flagged, raw: `thử nghiệm ${v.label}`, enteredAt: new Date().toISOString() } satisfies ManualScore);
    db.addLog({ run_id: run.id, level: 'info', message: `Dùng bản thử "${v.label}" làm bài chính (bản sửa ${ver}), chạy lại kiểm tra` });
    // Bài có thể còn dừng ở bước duyệt bố cục hoặc chưa viết: các bước trước kiểm tra coi như xong vì đã có bài
    for (const step of ['outline', 'write', 'edit'] as const) {
      if (db.getStep(run.id, step)?.status !== 'done') db.setStep(run.id, step, { status: 'done', finished_at: nowIso(), message: `Dùng bản thử nghiệm "${v.label}"`, error: null });
    }
    worker.retryFrom(run.id, 'verify');
    flash(c, { type: 'ok', text: `Đã lấy bản "${v.label}" làm bài chính, đang kiểm tra và xuất file` });
    return c.redirect(`/runs/${run.id}`);
  });

  /** Đặt model của bản thử làm mặc định trong Cài đặt. */
  app.post('/runs/:id/experiment/default', async (c) => {
    const run = runOr404(c);
    if (!run) return c.notFound();
    const body = (await c.req.parseBody()) as FormBody;
    const exp = db.getArtifact<Experiment>(run.id, 'experiment')?.content;
    const v = exp?.variants.find((x) => x.id === str(body, 'variant'));
    if (!v) {
      flash(c, { type: 'err', text: 'Không có bản thử này' });
      return c.redirect(`/runs/${run.id}?tab=experiment`);
    }
    const s = db.getGeneralSettings();
    if (v.write.provider === 'anthropic') db.setGeneralSettings({ ...s, llmProvider: 'anthropic', writerModel: v.write.model });
    else if (v.write.provider === 'deepseek') db.setGeneralSettings({ ...s, llmProvider: 'deepseek', deepseekWriterModel: v.write.model, ...(v.write.temperature !== null ? { deepseekTemperature: v.write.temperature } : {}) });
    else db.setGeneralSettings({ ...s, llmProvider: 'openrouter', openrouterWriterModel: v.write.model, ...(v.write.temperature !== null ? { openrouterTemperature: v.write.temperature } : {}) });
    db.addLog({ run_id: run.id, level: 'info', message: `Đặt model mặc định theo bản thử: ${v.write.provider} ${v.write.model}` });
    flash(c, { type: 'ok', text: `Đã đặt ${v.write.model} làm model viết mặc định${v.rewrite ? '. Bước viết lại bằng model thứ hai chưa có trong quy trình chuẩn, chỉ có trong thử nghiệm' : ''}` });
    return c.redirect(`/runs/${run.id}?tab=experiment`);
  });

  app.post('/runs/:id/outline', async (c) => {
    const run = runOr404(c);
    if (!run) return c.notFound();
    const cur = db.getArtifact<Outline>(run.id, 'outline');
    if (!cur) {
      flash(c, { type: 'err', text: 'Chưa có bố cục để sửa' });
      return c.redirect(`/runs/${run.id}?tab=outline`);
    }
    const body = (await c.req.parseBody()) as FormBody;
    const outline = parseOutlineForm(body, cur.content);
    const v = db.saveArtifact(run.id, 'outline', outline);
    db.addLog({ run_id: run.id, step: 'outline', level: 'info', message: `Người dùng sửa bố cục (bản ${v})` });
    const action = str(body, 'action');
    if (action === 'approve' && run.status === 'waiting_outline') {
      worker.approveOutline(run.id);
      flash(c, { type: 'ok', text: `Đã lưu bố cục bản ${v}, duyệt và bắt đầu viết` });
      return c.redirect(`/runs/${run.id}`);
    }
    if (action === 'rewrite') {
      if (run.status === 'queued' || run.status === 'running') {
        flash(c, { type: 'warn', text: 'Đang chạy, đã lưu bố cục nhưng chưa viết lại. Chờ xong rồi bấm "Từ đây" ở bước Viết bài.' });
        return c.redirect(`/runs/${run.id}?tab=outline`);
      }
      worker.retryFrom(run.id, 'write');
      flash(c, { type: 'ok', text: `Đã lưu bố cục bản ${v}, đang viết lại bài` });
      return c.redirect(`/runs/${run.id}`);
    }
    flash(c, { type: 'ok', text: `Đã lưu bố cục bản ${v}` });
    return c.redirect(`/runs/${run.id}?tab=outline`);
  });

  app.post('/runs/:id/article', async (c) => {
    const run = runOr404(c);
    if (!run) return c.notFound();
    const cur = latestArticle(db, run.id);
    if (!cur) {
      flash(c, { type: 'err', text: 'Chưa có bài để sửa' });
      return c.redirect(`/runs/${run.id}?tab=article`);
    }
    if (run.status === 'queued' || run.status === 'running') {
      flash(c, { type: 'warn', text: 'Đang chạy, chờ xong rồi sửa' });
      return c.redirect(`/runs/${run.id}?tab=article`);
    }
    const body = (await c.req.parseBody()) as FormBody;
    const article = parseArticleForm(body, cur.article);
    const v = db.saveArtifact(run.id, 'fixed', article);
    const q = quickChecks(db, run, db.getGeneralSettings(), article);
    const major = q.quality.filter((i) => i.severity === 'major');
    db.updateRun(run.id, { finalScore: { aiScore: run.finalScore?.aiScore ?? null, dupRatio: q.dup.ratio, words: q.words, pass: q.qualityPass && q.dup.pass && (run.finalScore?.pass ?? false), rounds: run.rounds } });
    db.addLog({ run_id: run.id, step: 'verify', level: 'info', message: `Người dùng sửa tay bài (bản sửa ${v}): ${q.words} từ, ${major.length} lỗi bắt buộc, trùng ${(q.dup.ratio * 100).toFixed(1)}%` });
    flash(c, {
      type: major.length || !q.dup.pass ? 'warn' : 'ok',
      text: `Đã lưu bản sửa tay v${v}: ${q.words} từ, ${major.length} lỗi bắt buộc${major.length ? ` (${major.map((m) => m.message).slice(0, 3).join('; ')})` : ''}, trùng nguồn ${(q.dup.ratio * 100).toFixed(1)}%${q.dup.pass ? '' : ' (vượt ngưỡng)'}. Điểm AI chỉ cập nhật khi bấm "Kiểm tra lại bằng AI".`,
    });
    return c.redirect(`/runs/${run.id}?tab=article`);
  });

  app.post('/runs/:id/retry/:step', (c) => {
    const run = runOr404(c);
    if (!run) return c.notFound();
    const step = c.req.param('step') ?? '';
    if (!isStepId(step)) return c.text('Bước không hợp lệ', 400);
    if (run.status === 'queued' || run.status === 'running') {
      flash(c, { type: 'warn', text: 'Đang chạy, không thể chạy lại lúc này' });
      return c.redirect(`/runs/${run.id}`);
    }
    worker.retryFrom(run.id, step);
    flash(c, { type: 'ok', text: `Đang chạy lại từ bước "${step}"` });
    return c.redirect(`/runs/${run.id}`);
  });

  app.post('/runs/:id/cancel', (c) => {
    const run = runOr404(c);
    if (!run) return c.notFound();
    worker.cancel(run.id);
    flash(c, { type: 'warn', text: 'Đã hủy và ngắt lượt gọi đang dở.' });
    return c.redirect(`/runs/${run.id}`);
  });

  app.post('/runs/:id/delete', (c) => {
    const run = runOr404(c);
    if (!run) return c.notFound();
    experiments.cancel(run.id);
    worker.delete(run.id);
    flash(c, { type: 'ok', text: `Đã xóa #${run.id} "${run.keyword}"` });
    return c.redirect('/content');
  });

  app.get('/runs/:id/export/:fmt', async (c) => {
    const run = runOr404(c);
    if (!run) return c.notFound();
    const cur = latestArticle(db, run.id);
    if (!cur) return c.text('Chưa có bài', 404);
    const a: Article = cur.article;
    const base = slugify(run.keyword);
    const fmt = c.req.param('fmt');
    const places = run.options.kind !== 'web' ? db.getArtifact<PlacesData>(run.id, 'places')?.content ?? null : null;
    const dl = (name: string, type: string, body: string | Uint8Array) => {
      c.header('content-type', type);
      c.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      return c.body(typeof body === 'string' ? body : new Uint8Array(body));
    };
    if (!['md', 'html', 'json', 'txt', 'docx', 'zip'].includes(fmt ?? '')) return c.text('Định dạng không hỗ trợ', 400);
    // Ảnh: trỏ tới URL gốc ảnh nếu đã đặt trong Cài đặt; không thì HTML nhúng ảnh, DOCX nhúng ảnh, ZIP kèm thư mục photos
    const bundle = await buildExportBundle(a, { keyword: run.keyword, dir: path.join(config.exportsDir, String(run.id)), baseUrl: db.getGeneralSettings().photoBaseUrl, places, sourceUrls: db.okSources(run.id).map((s) => s.url), brand: run.options.kind === 'brand' ? run.options : null });
    switch (fmt) {
      case 'md':
        return dl(`${base}.md`, 'text/markdown; charset=utf-8', bundle.md);
      case 'html':
        return dl(`${base}.html`, 'text/html; charset=utf-8', bundle.html);
      case 'json':
        return dl(`${base}.json`, 'application/json; charset=utf-8', JSON.stringify(bundle.json, null, 2));
      case 'txt':
        return dl(`${base}.txt`, 'text/plain; charset=utf-8', bundle.txt);
      case 'docx':
        return dl(`${base}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bundle.docx);
      default:
        return dl(`${base}.zip`, 'application/zip', await bundleToZip(bundle, base));
    }
  });

  /* ---------------- cài đặt ---------------- */
  app.get('/content/settings', (c) => render(c, 'Cài đặt viết content', 'settings', SettingsPage(settingsProps())));

  app.post('/content/settings', async (c) => {
    const body = (await c.req.parseBody()) as FormBody;
    try {
      const next = parseGeneralSettings(body, db.getGeneralSettings());
      if (next.minSources > next.maxSources) next.minSources = next.maxSources;
      if (next.articleMinWords >= next.articleMaxWords) next.articleMaxWords = next.articleMinWords + 200;
      if (next.notesMinWords >= next.notesMaxWords) next.notesMaxWords = next.notesMinWords + 200;
      db.setGeneralSettings(next);
      flash(c, { type: 'ok', text: 'Đã lưu cài đặt. Bài đang chạy dùng cài đặt mới từ bước kế tiếp.' });
    } catch (err) {
      flash(c, { type: 'err', text: `Cài đặt không hợp lệ: ${errorMessage(err)}` });
    }
    return c.redirect('/content/settings');
  });

  app.post('/content/settings/test', async (c) => {
    const body = (await c.req.parseBody()) as FormBody;
    const which = str(body, 'which');
    const tests: Record<string, { ok: boolean; message: string }> = {};
    try {
      if (which === 'anthropic') tests.anthropic = await services.llm('anthropic').verify();
      else if (which === 'openrouter') tests.openrouter = await services.llm('openrouter').verify();
      else if (which === 'deepseek') tests.deepseek = await services.llm('deepseek').verify();
      else if (which === 'search') tests.search = await services.search().verify();
      else if (which === 'originality') tests.originality = await services.detector().verify();
      else tests[which] = { ok: false, message: 'Không rõ dịch vụ' };
    } catch (err) {
      tests[which] = { ok: false, message: errorMessage(err) };
    }
    return render(c, 'Cài đặt viết content', 'settings', SettingsPage(settingsProps(tests)));
  });

  app.get('/content/logs', (c) => render(c, 'Log viết content', 'logs', LogsPage({ logs: db.listLogs(null, 500) })));

  app.onError((err, c) => {
    log.error(`Lỗi web ${c.req.method} ${c.req.path}: ${errorMessage(err)}`);
    return c.text(`Lỗi: ${errorMessage(err)}`, 500);
  });

  return app;
}
