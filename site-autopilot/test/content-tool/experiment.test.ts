import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigCache } from '../../src/content-tool/config.js';
import { Db } from '../../src/content-tool/db/index.js';
import { createServices } from '../../src/content-tool/services/index.js';
import { Worker } from '../../src/content-tool/core/worker.js';
import { ExperimentRunner, bestVariant, parseVariantLines, variantLabel } from '../../src/content-tool/core/experiment.js';
import { RunOptionsSchema, type Experiment } from '../../src/content-tool/core/types.js';
import { latestArticle } from '../../src/content-tool/core/pipeline.js';
import { createApp } from '../../src/content-tool/web/server.js';

let tmp: string;
let db: Db;
let worker: Worker;
let services: ReturnType<typeof createServices>;
let config: ReturnType<typeof loadConfig>;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viet-content-exp-'));
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

describe('thử nghiệm model: đọc danh sách', () => {
  it('hiểu nhà cung cấp, nhiệt độ và model viết lại', () => {
    const v = parseVariantLines('anthropic:claude-opus-5\nopenrouter:deepseek/deepseek-v4-flash-0731 @t=1.2\nqwen/qwen3.6-235b >> claude:claude-sonnet-5\n# dòng ghi chú\n\nclaude-haiku-4-5');
    expect(v.length).toBe(4);
    expect(v[0]).toEqual({ write: { provider: 'anthropic', model: 'claude-opus-5', temperature: null }, rewrite: null });
    expect(v[1]!.write).toEqual({ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash-0731', temperature: 1.2 });
    expect(v[2]!.write.provider).toBe('openrouter');
    expect(v[2]!.rewrite).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(v[3]!.write.provider).toBe('anthropic');
    expect(variantLabel({ write: v[2]!.write, rewrite: v[2]!.rewrite })).toBe('qwen/qwen3.6-235b → viết lại: claude-sonnet-5');
  });
});

describe('thử nghiệm model: chạy trên mock', () => {
  it('viết nhiều bản, chấm tự động, chọn bản tốt nhất làm bài chính rồi kiểm tra và xuất', async () => {
    const run = db.createRun('Bún riêu Đà Lạt', RunOptionsSchema.parse({ reviewOutline: true, minWords: 900, maxWords: 1600 }));
    worker.enqueue(run.id);
    const waiting = await worker.runToCompletion(run.id, 60_000);
    expect(waiting.status).toBe('waiting_outline');
    const runner = new ExperimentRunner({ db, config, services });
    const exp = runner.start(run.id, parseVariantLines('anthropic:claude-mock-a\nopenrouter:mock/model-b @t=1.3 >> anthropic:claude-mock-a\nopenrouter:mock/model-c'), { note: 'lần 1' });
    expect(exp.variants.length).toBe(3);
    expect(runner.isRunning(run.id)).toBe(true);
    expect(() => runner.start(run.id, parseVariantLines('anthropic:x'))).toThrow(/đang có thử nghiệm/);
    await runner.wait(run.id);
    const saved = db.getArtifact<Experiment>(run.id, 'experiment')!.content;
    expect(saved.status).toBe('done');
    expect(saved.variants.every((v) => v.status === 'done' && v.article && v.words > 800 && v.text.length > 500)).toBe(true);
    // Mock detector chấm tự động
    expect(saved.variants.every((v) => v.aiScore !== null && v.scoreSource === 'mock')).toBe(true);
    const best = bestVariant(saved)!;
    expect(best).toBeTruthy();
    expect(db.getRun(run.id)!.usage!.calls).toBeGreaterThanOrEqual(4);
    expect(db.getRun(run.id)!.usage!.byModel['mock/model-b']).toBeTruthy();
    // Dùng bản tốt nhất làm bài chính qua web
    const shell = (c: any, title: string, body: unknown) => c.html(`<html><title>${title}</title><body>${String(body)}</body></html>`);
    const app = createApp({ db, config, services, worker, experiments: runner, shell });
    const cookie = '';
    const tab = await app.request(`/runs/${run.id}?tab=experiment`, { headers: { cookie } });
    expect(tab.status).toBe(200);
    expect(await tab.text()).toContain('mock/model-b');
    const adopt = await app.request(`/runs/${run.id}/experiment/adopt`, { method: 'POST', body: new URLSearchParams({ variant: best.id }), headers: { cookie, origin: 'http://localhost', host: 'localhost' } });
    expect(adopt.status).toBe(302);
    const done = await worker.runToCompletion(run.id, 60_000);
    expect(done.status).toBe('done');
    expect(latestArticle(db, run.id)!.kind).toBe('fixed');
    expect(db.getArtifact(run.id, 'exports')).not.toBeNull();
    // Đặt model mặc định theo bản thử OpenRouter
    const orVariant = saved.variants.find((v) => v.write.provider === 'openrouter' && v.write.temperature === 1.3)!;
    const def = await app.request(`/runs/${run.id}/experiment/default`, { method: 'POST', body: new URLSearchParams({ variant: orVariant.id }), headers: { cookie, origin: 'http://localhost', host: 'localhost' } });
    expect(def.status).toBe(302);
    const s = db.getGeneralSettings();
    expect(s.llmProvider).toBe('openrouter');
    expect(s.openrouterWriterModel).toBe('mock/model-b');
    expect(s.openrouterTemperature).toBe(1.3);
    // Nhập điểm tay cho một bản
    const post = await app.request(`/runs/${run.id}/experiment/score`, { method: 'POST', body: new URLSearchParams({ variant: orVariant.id, score: 'AI 7% Original 93%' }), headers: { cookie, origin: 'http://localhost', host: 'localhost' } });
    expect(post.status).toBe(302);
    const after = db.getArtifact<Experiment>(run.id, 'experiment')!.content.variants.find((v) => v.id === orVariant.id)!;
    expect(after.aiScore).toBeCloseTo(0.07);
    expect(after.scoreSource).toBe('manual');
  });
});

describe('biến thể DeepSeek trực tiếp', () => {
  it('nhận "deepseek:" và tên deepseek-chat, deepseek-reasoner không có dấu /; dạng hãng/model vẫn là OpenRouter', () => {
    const v = parseVariantLines('deepseek:deepseek-chat @t=1.5\nds:deepseek-reasoner\ndeepseek-chat\nopenrouter:deepseek/deepseek-v4-flash\ndeepseek/deepseek-v4-flash');
    expect(v.map((x) => x.write.provider)).toEqual(['deepseek', 'deepseek', 'deepseek', 'openrouter', 'openrouter']);
    expect(v[0]!.write.model).toBe('deepseek-chat');
    expect(v[0]!.write.temperature).toBe(1.5);
    expect(v[1]!.write.model).toBe('deepseek-reasoner');
  });
});
