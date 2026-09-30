import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigCache } from '../../src/content-tool/config.js';
import { Db } from '../../src/content-tool/db/index.js';
import { createServices } from '../../src/content-tool/services/index.js';
import { Worker } from '../../src/content-tool/core/worker.js';
import { RunOptionsSchema, type Article, type CheckRound, type ManualScore, type Outline, type PendingScore, type PlacesData, type ResearchNotes, type SerpData } from '../../src/content-tool/core/types.js';
import { latestArticle } from '../../src/content-tool/core/pipeline.js';
import { createApp } from '../../src/content-tool/web/server.js';

let tmp: string;
let db: Db;
let worker: Worker;
let services: ReturnType<typeof createServices>;
let config: ReturnType<typeof loadConfig>;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viet-content-test-'));
  process.env.MOCK_MODE = '1';
  process.env.MOCK_DELAY_MS = '1';
  process.env.DATA_DIR = tmp;
  process.env.SESSION_SECRET = 'test-secret';
  process.env.ADMIN_PASSWORD = 'matkhau123';
  resetConfigCache();
  config = loadConfig();
  db = new Db(config.dbPath);
  services = createServices(config, db);
  worker = new Worker({ db, config, services });
});

afterAll(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('pipeline mock đầu-cuối', () => {
  it('chạy hết 8 bước, bài đạt, có file xuất', async () => {
    const run = db.createRun('Hủ tiếu Nam Vang', RunOptionsSchema.parse({ minWords: 900, maxWords: 1600 }));
    worker.enqueue(run.id);
    const done = await worker.runToCompletion(run.id, 60_000);
    expect(done.status).toBe('done');
    const steps = db.getSteps(run.id);
    expect(steps.every((s) => s.status === 'done')).toBe(true);
    expect(db.okSources(run.id).length).toBeGreaterThanOrEqual(5);
    // Tìm Google: bỏ mạng xã hội, lật trang cho đủ 10 bài web, top 1..10 đánh số lại giữa các bài web
    const serp = db.getArtifact<SerpData>(run.id, 'serp')!.content;
    expect(serp.organic.length).toBe(10);
    expect(serp.organic.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(serp.organic.some((r) => /tiktok|facebook/.test(r.link))).toBe(false);
    expect(serp.pagesFetched).toBe(2);
    expect(serp.skipped!.length).toBe(2);
    const blocked = db.listSources(run.id).filter((s) => s.status === 'blocked');
    expect(blocked.length).toBe(2);
    expect(blocked.every((s) => s.position >= 200 && /Google #\d/.test(s.error ?? ''))).toBe(true);
    expect(db.getStep(run.id, 'search')?.message).toContain('mạng xã hội');
    const notes = db.getArtifact<ResearchNotes>(run.id, 'notes')!.content;
    expect(notes.topics.length).toBeGreaterThan(2);
    expect(notes.topSites.length).toBe(3);
    expect(notes.topics.some((t) => t.inTopSites)).toBe(true);
    expect(notes.perSource.every((s) => s.tags.length > 0)).toBe(true);
    expect(db.getStep(run.id, 'extract')?.message).toContain('nhãn');
    const outline = db.getArtifact<Outline>(run.id, 'outline')!.content;
    expect(outline.sections.length).toBeGreaterThan(3);
    expect(outline.sections.every((s) => s.tag)).toBe(true);
    // Chế độ so sánh bật mặc định: mọi H2 có đối tượng so sánh, dạng bảng, và bài có bảng markdown
    const h2 = outline.sections.filter((s) => s.level === 2);
    expect(h2.every((s) => s.comparisonItems.length >= 2 && s.format === 'table')).toBe(true);
    expect(db.getStep(run.id, 'outline')?.message).toContain('bảng so sánh');
    const article = latestArticle(db, run.id);
    expect(article?.kind).toBe('edited');
    expect(article!.article.sections.filter((s) => /^\| Tiêu chí \|/m.test(s.body)).length).toBe(h2.length);
    const checks = db.listArtifacts<CheckRound>(run.id, 'check');
    expect(checks.length).toBe(1);
    expect(checks[0]!.content.pass).toBe(true);
    expect(done.finalScore?.pass).toBe(true);
    expect(done.finalScore?.words).toBeGreaterThan(900);
    expect(done.usage?.calls).toBeGreaterThan(3);
    const ex = db.getArtifact<{ dir: string; files: Record<string, string> }>(run.id, 'exports')!.content;
    for (const f of Object.values(ex.files)) expect(fs.existsSync(path.join(ex.dir, f))).toBe(true);
    const json = JSON.parse(fs.readFileSync(path.join(ex.dir, ex.files.json!), 'utf8')) as { kind: string; sources: string[] };
    expect(json.kind).toBe('post');
    expect(json.sources.length).toBeGreaterThan(0);
  });

  it('tắt chế độ so sánh thì bố cục không có đối tượng so sánh và bài không có bảng', async () => {
    const run = db.createRun('Bò kho', RunOptionsSchema.parse({ comparison: false, minWords: 900, maxWords: 1600 }));
    worker.enqueue(run.id);
    const done = await worker.runToCompletion(run.id, 60_000);
    expect(done.status).toBe('done');
    const outline = db.getArtifact<Outline>(run.id, 'outline')!.content;
    expect(outline.sections.every((s) => s.comparisonItems.length === 0 && s.format !== 'table')).toBe(true);
    expect(latestArticle(db, run.id)!.article.sections.some((s) => s.body.includes('| Tiêu chí |'))).toBe(false);
  });

  it('dừng chờ duyệt bố cục rồi chạy tiếp khi duyệt', async () => {
    const run = db.createRun('Bánh canh ghẹ', RunOptionsSchema.parse({ reviewOutline: true, minWords: 900, maxWords: 1600 }));
    worker.enqueue(run.id);
    const waiting = await worker.runToCompletion(run.id, 60_000);
    expect(waiting.status).toBe('waiting_outline');
    expect(db.getStep(run.id, 'outline')?.status).toBe('waiting');
    expect(latestArticle(db, run.id)).toBeNull();
    worker.approveOutline(run.id);
    const done = await worker.runToCompletion(run.id, 60_000);
    expect(done.status).toBe('done');
    expect(latestArticle(db, run.id)).not.toBeNull();
  });

  it('bài bị chấm AI cao thì vào vòng sửa và đạt sau khi sửa', async () => {
    const run = db.createRun('Cơm tấm [fail]', RunOptionsSchema.parse({ minWords: 900, maxWords: 1600 }));
    worker.enqueue(run.id);
    const done = await worker.runToCompletion(run.id, 60_000);
    expect(done.status).toBe('done');
    const checks = db.listArtifacts<CheckRound>(run.id, 'check');
    expect(checks.length).toBe(2);
    expect(checks[0]!.content.pass).toBe(false);
    expect(checks[0]!.content.ai.blocks.some((b) => b.aiScore > 0.5)).toBe(true);
    expect(checks[1]!.content.pass).toBe(true);
    expect(latestArticle(db, run.id)?.kind).toBe('fixed');
    expect(done.rounds).toBe(2);
  });

  it('chạy lại từ bước viết giữ nguyên ghi chú và bố cục', async () => {
    const run = db.listRuns().find((r) => r.keyword === 'Hủ tiếu Nam Vang')!;
    const notesV = db.getArtifact(run.id, 'notes')!.version;
    worker.retryFrom(run.id, 'write');
    const done = await worker.runToCompletion(run.id, 60_000);
    expect(done.status).toBe('done');
    expect(db.getArtifact(run.id, 'notes')!.version).toBe(notesV);
    expect(db.getArtifact<Article>(run.id, 'draft')!.version).toBe(2);
  });

  it('so trùng với bài trong thư viện được báo khi hai bài giống nhau', async () => {
    const run = db.createRun('Hủ tiếu Nam Vang', RunOptionsSchema.parse({ minWords: 900, maxWords: 1600 }));
    worker.enqueue(run.id);
    const done = await worker.runToCompletion(run.id, 60_000);
    const checks = db.listArtifacts<CheckRound>(run.id, 'check');
    const last = checks[checks.length - 1]!.content;
    // Mock sinh cùng văn bản cho cùng từ khóa nên bài mới giống bài cũ
    expect(last.dup.libraryMatches.length).toBeGreaterThan(0);
    expect(['done', 'needs_review']).toContain(done.status);
  });
});

describe('bài tổng hợp quán theo khu vực (Google Maps mô phỏng)', () => {
  it('lọc, gộp, xếp hạng, lấy đánh giá, tải ảnh, mỗi quán một mục có địa chỉ và link Google Maps, xuất JSON và JSON-LD', async () => {
    const run = db.createRun('hủ tiếu Phan Rang', RunOptionsSchema.parse({ kind: 'roundup', dish: 'hủ tiếu', area: 'Phan Rang', placesCount: 8, placeNotes: 'Cô Ba: tôi ăn ở đây mỗi sáng thứ bảy', minWords: 1000, maxWords: 1800 }));
    worker.enqueue(run.id);
    const done = await worker.runToCompletion(run.id, 60_000);
    expect(done.status).toBe('done');
    const data = db.getArtifact<PlacesData>(run.id, 'places')!.content;
    expect(data.pagesFetched).toBe(2);
    expect(data.candidates.length).toBe(35);
    const featured = data.candidates.filter((p) => p.featured && !p.excludedReason).sort((a, b) => a.rank - b.rank);
    expect(featured.length).toBe(8);
    expect(featured.every((p) => p.rank >= 1 && p.rank <= 8 && p.reviews >= 5)).toBe(true);
    // Ngưỡng 5: quán 8 hoặc 9 đánh giá trong mock giờ đủ điều kiện (trước đây bị loại ở ngưỡng 15)
    expect(data.candidates.filter((p) => !p.excludedReason && p.reviews < 15).length).toBeGreaterThan(0);
    expect(data.candidates.some((p) => /Phở/.test(p.name) && /Không phải quán/.test(p.excludedReason ?? ''))).toBe(true);
    expect(data.candidates.some((p) => /Nha Trang/.test(p.address) && /không thuộc/.test(p.excludedReason ?? ''))).toBe(true);
    expect(data.candidates.some((p) => p.excludedReason === 'Đã đóng cửa')).toBe(true);
    // Địa chỉ mới chỉ ghi phường và tỉnh nhưng nằm trong bán kính quanh tâm nên vẫn thuộc khu vực
    const baoAn = data.candidates.find((p) => /Bảo An/.test(p.address))!;
    expect(baoAn.excludedReason).toBeNull();
    expect(baoAn.rank).toBeGreaterThan(0);
    expect(data.candidates.find((p) => /Nha Trang/.test(p.address))!.excludedReason).toMatch(/cách tâm \d+ km/);
    expect(data.candidates.some((p) => /Chi nhánh 2/.test(p.name) && /Gộp vào/.test(p.excludedReason ?? ''))).toBe(true);
    const coBa = data.candidates.find((p) => p.name === 'Hủ Tiếu Cô Ba')!;
    expect(coBa.branches.length).toBe(2);
    expect(coBa.userNote).toContain('mỗi sáng thứ bảy');
    expect(featured.every((p) => p.summary !== null && p.reviewsFetched.length === 16)).toBe(true);
    // Mỗi quán một vai riêng, không trùng nhau; mock cố ý trả vai trùng cho quán cuối nên quán đó lấy vai từ quy tắc
    expect(featured.every((p) => p.role && p.role.label.length > 0)).toBe(true);
    expect(new Set(featured.map((p) => p.role!.label.toLowerCase())).size).toBe(featured.length);
    expect(db.getStep(run.id, 'fetch')?.message).toContain('gán vai riêng cho 8 quán');
    expect(featured.filter((p) => p.photoFile).length).toBeGreaterThan(3);
    expect(db.getStep(run.id, 'search')?.message).toContain('chọn 8 quán');
    const notes = db.getArtifact<ResearchNotes>(run.id, 'notes')!.content;
    expect(notes.roundup?.featured.length).toBe(8);
    expect(notes.roundup?.featured.every((p) => p.role)).toBe(true);
    expect(notes.topics.filter((t) => t.tag === 'quán').every((t) => t.facts.some((f) => f.startsWith('VAI TRONG BÀI')))).toBe(true);
    const article = latestArticle(db, run.id)!.article;
    for (const p of featured) {
      const sec = article.sections.find((s) => s.level === 2 && s.heading.includes(p.name));
      expect(sec, p.name).toBeDefined();
      expect(sec!.body).toContain(`**Địa chỉ:** ${p.address}`);
      expect(sec!.body).toContain(`query_place_id=${encodeURIComponent(p.placeId)}`);
      if (p.photoFile) expect(sec!.body).toContain(`](${p.photoFile})`);
    }
    // Bảng so sánh do tool dựng từ dữ liệu Maps thay cho bảng model viết: đủ 8 quán, có dòng phân cách
    expect(article.sections[0]!.body).toMatch(/^\| Quán \| Sao \| Lượt đánh giá \|/m);
    expect(article.sections[0]!.body).not.toContain('| Tiêu chí |');
    expect(article.sections[0]!.body.split('\n').filter((l) => l.startsWith('| **')).length).toBe(8);
    const fitSec = article.sections.find((s) => /hợp ai/i.test(s.heading))!;
    expect(fitSec.body).toContain('| Bạn cần gì | Quán nên chọn | Vì sao |');
    const ex = db.getArtifact<{ dir: string; files: Record<string, string> }>(run.id, 'exports')!.content;
    const json = JSON.parse(fs.readFileSync(path.join(ex.dir, ex.files.json!), 'utf8')) as { places: { name: string; mapsUrl: string }[]; sources: string[] };
    expect(json.places.length).toBe(8);
    expect(json.places[0]!.mapsUrl).toContain('google.com/maps');
    const html = fs.readFileSync(path.join(ex.dir, ex.files.html!), 'utf8');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('"@type":"ItemList"');
    expect(fs.existsSync(path.join(ex.dir, featured.find((p) => p.photoFile)!.photoFile!))).toBe(true);
    // 1 lượt tọa độ + 2 trang quán + 16 đánh giá mỗi quán = 2 lượt × 8 quán
    expect(done.usage!.searchCalls).toBe(1 + 2 + 16);
  });

  it('dừng chờ duyệt danh sách quán, bỏ bớt một quán rồi duyệt', async () => {
    const run = db.createRun('bánh canh Phan Rang', RunOptionsSchema.parse({ kind: 'roundup', dish: 'bánh canh', area: 'Phan Rang', placesCount: 6, reviewPlaces: true, minWords: 1000, maxWords: 1800 }));
    worker.enqueue(run.id);
    let r = await worker.runToCompletion(run.id, 60_000);
    expect(r.status).toBe('waiting_places');
    expect(db.getStep(run.id, 'search')?.status).toBe('waiting');
    const cur = db.getArtifact<PlacesData>(run.id, 'places')!.content;
    const first = cur.candidates.find((p) => p.rank === 1)!;
    first.featured = false;
    db.saveArtifact(run.id, 'places', cur);
    worker.approvePlaces(run.id);
    r = await worker.runToCompletion(run.id, 60_000);
    expect(r.status).toBe('done');
    const article = latestArticle(db, run.id)!.article;
    expect(article.sections.some((s) => s.heading.includes(first.name))).toBe(false);
    expect(article.sections.filter((s) => /\*\*Địa chỉ:\*\*/.test(s.body)).length).toBe(5);
  });
});

describe('hủy và xóa khi đang chạy', () => {
  it('hủy bài đang chạy trả chỗ ngay cho worker và bài sau vẫn chạy được', async () => {
    const run = db.createRun('Bún riêu cua', RunOptionsSchema.parse({ minWords: 900, maxWords: 1600 }));
    const started = worker.process(run.id);
    await new Promise((r) => setTimeout(r, 150));
    expect(worker.activeIds()).toContain(run.id);
    worker.cancel(run.id);
    await started;
    expect(worker.activeIds()).not.toContain(run.id);
    expect(db.getRun(run.id)?.status).toBe('cancelled');
    const next = db.createRun('Bún mắm', RunOptionsSchema.parse({ minWords: 900, maxWords: 1600 }));
    worker.enqueue(next.id);
    const done = await worker.runToCompletion(next.id, 60_000);
    expect(done.status).toBe('done');
  });

  it('xóa bài đang chạy không để lại lỗi và không giữ chỗ', async () => {
    const run = db.createRun('Bánh xèo miền Tây', RunOptionsSchema.parse({ minWords: 900, maxWords: 1600 }));
    const started = worker.process(run.id);
    await new Promise((r) => setTimeout(r, 150));
    worker.delete(run.id);
    await started;
    expect(db.getRun(run.id)).toBeUndefined();
    expect(worker.activeIds()).not.toContain(run.id);
  });

  it('không nhận trùng một bài: claimRun chỉ thành công một lần', () => {
    const run = db.createRun('Cháo lòng', RunOptionsSchema.parse({}));
    expect(db.claimRun(run.id)).toBe(true);
    expect(db.claimRun(run.id)).toBe(false);
    db.deleteRun(run.id);
  });
});

describe('chế độ chấm tay Originality.ai', () => {
  it('dừng chờ điểm, sửa theo câu bị đánh dấu khi điểm cao, đạt khi điểm thấp', async () => {
    const saved = db.getGeneralSettings();
    db.setGeneralSettings({ ...saved, detectorMode: 'manual', maxManualScans: 2 });
    try {
      const run = db.createRun('Bánh mì thịt nướng', RunOptionsSchema.parse({ minWords: 900, maxWords: 1600 }));
      worker.enqueue(run.id);
      let r = await worker.runToCompletion(run.id, 60_000);
      expect(r.status).toBe('waiting_ai_score');
      expect(db.getStep(run.id, 'verify')?.status).toBe('waiting');
      const pending = db.getArtifact<PendingScore>(run.id, 'pending_score')!.content;
      const cur = latestArticle(db, run.id)!;
      expect(pending.articleKey).toBe(cur.key);
      expect(pending.qualityPass).toBe(true);
      expect(pending.text.length).toBeGreaterThan(500);
      // Lần 1: điểm cao kèm một câu bị đánh dấu → tool sửa rồi dừng chờ điểm lần 2
      const sentence = pending.text.split(/(?<=[.!?])\s+/)[3]!;
      const s1: ManualScore = { articleKey: cur.key, aiScore: 0.62, flagged: [sentence], raw: '62%', enteredAt: new Date().toISOString() };
      db.saveArtifact(run.id, 'ai_score', s1);
      worker.resumeVerify(run.id);
      r = await worker.runToCompletion(run.id, 60_000);
      expect(r.status).toBe('waiting_ai_score');
      const checks = db.listArtifacts<CheckRound>(run.id, 'check');
      expect(checks.length).toBe(1);
      expect(checks[0]!.content.ai.provider).toBe('manual');
      expect(checks[0]!.content.ai.aiScore).toBeCloseTo(0.62);
      expect(checks[0]!.content.pass).toBe(false);
      expect(checks[0]!.content.feedback.some((f) => f.includes('62.0%'))).toBe(true);
      const cur2 = latestArticle(db, run.id)!;
      expect(cur2.kind).toBe('fixed');
      expect(db.getArtifact<PendingScore>(run.id, 'pending_score')!.content.articleKey).toBe(cur2.key);
      // Lần 2: điểm thấp → đạt, xuất file
      const s2: ManualScore = { articleKey: cur2.key, aiScore: 0.08, flagged: [], raw: '8', enteredAt: new Date().toISOString() };
      db.saveArtifact(run.id, 'ai_score', s2);
      worker.resumeVerify(run.id);
      r = await worker.runToCompletion(run.id, 60_000);
      expect(r.status).toBe('done');
      expect(r.finalScore?.aiScore).toBeCloseTo(0.08);
      expect(r.finalScore?.pass).toBe(true);
      expect(db.listArtifacts(run.id, 'check').length).toBe(2);
      expect(db.getArtifact(run.id, 'pending_score')).toBeNull();
      expect(db.getArtifact(run.id, 'exports')).not.toBeNull();
    } finally {
      db.setGeneralSettings(saved);
    }
  });

  it('hết số lần chấm tay thì dừng ở "Chưa đạt" thay vì sửa vô ích', async () => {
    const saved = db.getGeneralSettings();
    db.setGeneralSettings({ ...saved, detectorMode: 'manual', maxManualScans: 1 });
    try {
      const run = db.createRun('Chè khúc bạch', RunOptionsSchema.parse({ minWords: 900, maxWords: 1600 }));
      worker.enqueue(run.id);
      let r = await worker.runToCompletion(run.id, 60_000);
      expect(r.status).toBe('waiting_ai_score');
      const cur = latestArticle(db, run.id)!;
      db.saveArtifact(run.id, 'ai_score', { articleKey: cur.key, aiScore: 0.5, flagged: [], raw: '50', enteredAt: new Date().toISOString() } as ManualScore);
      worker.resumeVerify(run.id);
      r = await worker.runToCompletion(run.id, 60_000);
      expect(r.status).toBe('needs_review');
      expect(db.getStep(run.id, 'verify')?.message).toContain('hết');
      expect(db.getArtifact(run.id, 'exports')).not.toBeNull();
    } finally {
      db.setGeneralSettings(saved);
    }
  });
});

describe('web', () => {
  it('đăng nhập bằng mật khẩu .env, trang chủ và chi tiết trả về HTML', async () => {
    // Đăng nhập do dashboard bot đảm nhiệm; mô-đun được gắn sau requireAuth nên ở đây gọi thẳng với khung trang giả
    const shell = (c: any, title: string, body: unknown) => c.html(`<html><title>${title}</title><body>${String(body)}</body></html>`);
    const app = createApp({ db, config, services, worker, shell });
    const cookie = '';
    const home = await app.request('/content', { headers: { cookie } });
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain('Viết bài mới');
    expect(html).toContain('Hủ tiếu Nam Vang');
    const run = db.listRuns()[0]!;
    for (const tab of ['overview', 'sources', 'notes', 'outline', 'article', 'checks', 'log']) {
      const res = await app.request(`/runs/${run.id}?tab=${tab}`, { headers: { cookie } });
      expect(res.status).toBe(200);
    }
    expect(html).toContain('Tổng hợp quán theo khu vực');
    const roundup = db.listRuns().find((r) => r.options.kind === 'roundup' && r.status === 'done')!;
    const placesTab = await app.request(`/runs/${roundup.id}?tab=places`, { headers: { cookie } });
    expect(placesTab.status).toBe(200);
    expect(await placesTab.text()).toContain('Mở Google Maps');
    const photo = db.getArtifact<PlacesData>(roundup.id, 'places')!.content.candidates.find((p) => p.photoFile)!.photoFile!;
    const img = await app.request(`/runs/${roundup.id}/${photo}`, { headers: { cookie } });
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toContain('image/');
    const md = await app.request(`/runs/${run.id}/export/md`, { headers: { cookie } });
    expect(md.status).toBe(200);
    expect(await md.text()).toContain('# ');
    const settings = await app.request('/content/settings', { headers: { cookie } });
    expect(settings.status).toBe(200);
    // Nhập điểm cho một bài đã xong: được ghi nhận và chuyển hướng về trang bài
    const doneRun = db.listRuns().find((r) => r.status === 'done')!;
    const before = db.listArtifacts(doneRun.id, 'ai_score').length;
    const post = await app.request(`/runs/${doneRun.id}/score`, { method: 'POST', body: new URLSearchParams({ score: 'AI 9% Original 91%', flagged: '' }), headers: { cookie, origin: 'http://localhost', host: 'localhost' } });
    expect(post.status).toBe(302);
    expect(db.listArtifacts(doneRun.id, 'ai_score').length).toBe(before + 1);
    await worker.runToCompletion(doneRun.id, 60_000);
  });
});
