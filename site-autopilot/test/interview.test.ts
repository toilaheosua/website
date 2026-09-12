import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigCache } from '../src/config.js';
import { Db } from '../src/db/index.js';
import { createServices, ensureDefaultServer } from '../src/services/index.js';
import { STEPS } from '../src/core/steps.js';
import { Worker } from '../src/core/worker.js';
import { EntitySchema, SiteBriefSchema } from '../src/core/types.js';
import { createApp } from '../src/web/server.js';
import { INTERVIEW_GROUPS, INTERVIEW_QUESTIONS, answeredCount, interviewBlock, mergeEntitySuggestion } from '../src/core/interview.js';

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-interview-'));
  resetConfigCache();
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('Bộ Câu Hỏi', () => {
  it('có đúng 30 câu, id duy nhất, mỗi nhóm có câu hỏi', () => {
    expect(INTERVIEW_QUESTIONS).toHaveLength(30);
    expect(new Set(INTERVIEW_QUESTIONS.map((q) => q.id)).size).toBe(30);
    for (const g of INTERVIEW_GROUPS) expect(INTERVIEW_QUESTIONS.some((q) => q.group === g)).toBe(true);
  });

  it('interviewBlock chỉ gồm câu đã trả lời và đếm đúng', () => {
    const data = { answers: { q3: 'Quán hủ tiếu Nam Vang ở Phan Rang.', q29: '0944 706 360' }, updated_at: '' };
    expect(answeredCount(data)).toBe(2);
    const block = interviewBlock(data);
    expect(block).toContain('DỮ KIỆN DO CHỦ DOANH NGHIỆP');
    expect(block).toContain('Quán hủ tiếu Nam Vang');
    expect(block).not.toContain('Tên đầy đủ');
    expect(interviewBlock({ answers: {}, updated_at: '' })).toBe('');
  });

  it('mergeEntitySuggestion chỉ điền ô trống, ghi đè khi được phép', () => {
    const entity = EntitySchema.parse({ name: 'Ông Giáo', telephone: '0123', address: { streetAddress: '' } });
    const s = { legalName: 'HKD ÔNG GIÁO', alternateName: ['Hủ tiếu Ông Giáo'], description: 'Mô tả', foundingDate: '1998', founder: '', telephone: '0944706360', email: '', streetAddress: '89 Văn Cao', addressLocality: 'Phan Rang', addressRegion: '', openingHours: ['Mo-Su 05:30-12:00'], priceRange: '', areaServed: [], facebook: '', zalo: '', youtube: '', tiktok: '', instagram: '', googleMaps: '', authorName: '', authorJobTitle: '', authorBio: '' };
    const r = mergeEntitySuggestion(entity, s);
    expect(r.entity.telephone).toBe('0123');
    expect(r.entity.legalName).toBe('HKD ÔNG GIÁO');
    expect(r.entity.address.streetAddress).toBe('89 Văn Cao');
    expect(r.entity.openingHours).toEqual(['Mo-Su 05:30-12:00']);
    expect(r.changed).not.toContain('Điện thoại');
    const o = mergeEntitySuggestion(entity, s, true);
    expect(o.entity.telephone).toBe('0944706360');
    expect(o.changed).toContain('Điện thoại');
  });

  it('lưu câu trả lời qua dashboard, đưa vào Entity bằng job và vào prompt', async () => {
    const config = loadConfig({ MOCK_MODE: '1', DATA_DIR: tmp, WORKER_CONCURRENCY: '6', ADMIN_PASSWORD: 'x', NS_POLL_INTERVAL_MIN: '0', REBUILD_DEBOUNCE_SEC: '0' });
    const db = new Db(':memory:');
    const services = createServices(config, db);
    ensureDefaultServer(config, db);
    const brief = SiteBriefSchema.parse({ brandName: 'Hủ Tiếu Ông Giáo', industry: 'Quán ăn', location: 'Phan Rang', services: ['Hủ tiếu'], keywords: ['hủ tiếu'], postsCount: 0, targetCountries: ['VN'] });
    const id = db.createSite({ domain: 'onggiao.test', server_id: db.listServers()[0]!.id, brief, entity: EntitySchema.parse({ type: 'Restaurant', name: 'Hủ Tiếu Ông Giáo' }) });
    db.ensureSteps(id, STEPS.map((s) => s.id));
    const worker = new Worker({ db, config, services, steps: STEPS });
    const app = createApp({ db, config, services, worker, steps: STEPS });
    const login = await app.request('/login', { method: 'POST', body: new URLSearchParams({ user: 'admin', password: 'x', next: '/' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';

    const page = await (await app.request(`/sites/${id}/interview`, { headers: { cookie } })).text();
    expect(page).toContain('Bộ Câu Hỏi (0/30)');
    expect(page).toContain('name="a_q30"');
    const entityPage = await (await app.request(`/sites/${id}/entity`, { headers: { cookie } })).text();
    expect(entityPage).toContain(`/sites/${id}/interview`);

    const form = new URLSearchParams({ action: 'apply', a_q1: 'HỘ KINH DOANH HỦ TIẾU NAM VANG ÔNG GIÁO', a_q3: 'Quán hủ tiếu Nam Vang nấu tại chỗ ở Phan Rang, bán buổi sáng.', a_q28: '89 Văn Cao, Phan Rang; đối diện trường tiểu học', a_q29: 'Gọi 0944 706 360, Zalo cùng số, email onggiao@gmail.com' });
    const save = await app.request(`/sites/${id}/interview`, { method: 'POST', body: form, headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(save.status).toBe(302);
    const site = db.getSite(id)!;
    expect(answeredCount(site.interview)).toBe(4);
    expect(site.interview?.answers.q29).toContain('0944');
    expect(db.listJobs().some((j) => j.type === 'apply_interview' && j.status === 'queued')).toBe(true);

    await worker.tick();
    await worker.drain(30_000);
    const after = db.getSite(id)!;
    expect(after.entity.legalName).toBe('HỘ KINH DOANH HỦ TIẾU NAM VANG ÔNG GIÁO');
    expect(after.entity.telephone).toBe('0944 706 360');
    expect(after.entity.email).toBe('onggiao@gmail.com');
    expect(after.entity.address.streetAddress).toBe('89 Văn Cao, Phan Rang');
    expect(after.entity.description).toContain('nấu tại chỗ');
    expect(after.entity.name).toBe('Hủ Tiếu Ông Giáo');
    const tabs = await (await app.request(`/sites/${id}/interview`, { headers: { cookie } })).text();
    expect(tabs).toContain('Bộ Câu Hỏi (4/30)');
    expect(tabs).toContain('đối diện trường tiểu học');
  }, 60000);
});
