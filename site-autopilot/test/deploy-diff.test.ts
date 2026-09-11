import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listLocalFiles, parseMd5sum, planUpload } from '../src/services/deploy-diff.js';
import { mockSshFactory } from '../src/services/mock.js';
import { Db } from '../src/db/index.js';
import { EntitySchema, SiteBriefSchema } from '../src/core/types.js';

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-deploy-'));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeSite(dir: string, files: Record<string, string>) {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

describe('tải lên tăng dần', () => {
  it('parseMd5sum đọc đúng định dạng của md5sum trên host', () => {
    const m = parseMd5sum('d41d8cd98f00b204e9800998ecf8427e  ./index.html\n0cc175b9c0f1b6a831c399e269772661  ./assets/img/a b.webp\nrác\n');
    expect(m.get('index.html')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(m.get('assets/img/a b.webp')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(m.size).toBe(2);
  });

  it('planUpload chỉ tải tệp mới hoặc đổi, xóa tệp thừa', () => {
    const local = path.join(tmp, 'local');
    writeSite(local, { 'index.html': 'v2', 'assets/css/style.css': 'same', 'blog/moi/index.html': 'new' });
    const files = listLocalFiles(local);
    const remote = new Map<string, string>([
      ['index.html', 'khac'],
      ['assets/css/style.css', files.find((f) => f.rel === 'assets/css/style.css')!.md5],
      ['blog/cu/index.html', 'x'],
    ]);
    const plan = planUpload(files, remote);
    expect(plan.upload.map((f) => f.rel).sort()).toEqual(['blog/moi/index.html', 'index.html']);
    expect(plan.remove).toEqual(['blog/cu/index.html']);
    expect(plan.unchanged).toBe(1);
  });

  it('deploy giả lập: lần đầu tải hết, lần sau chỉ tải tệp đổi, lần ba không tải gì', async () => {
    const local = path.join(tmp, 'out');
    const ssh = await mockSshFactory(path.join(tmp, 'mock-deploy'))({ ip: '1.1.1.1' } as never);
    writeSite(local, { 'index.html': 'a', 'assets/img/1.webp': 'img', 'gioi-thieu/index.html': 'b' });
    const first = await ssh.uploadDirectory(local, '/www/site');
    expect(first).toMatchObject({ files: 3, unchanged: 0, removed: 0 });
    writeSite(local, { 'index.html': 'a-sua', 'assets/img/1.webp': 'img', 'blog/x/index.html': 'c' });
    const second = await ssh.uploadDirectory(local, '/www/site');
    expect(second).toMatchObject({ files: 2, unchanged: 1, removed: 1 });
    expect(fs.existsSync(path.join(tmp, 'mock-deploy', 'www/site/gioi-thieu/index.html'))).toBe(false);
    expect(fs.readFileSync(path.join(tmp, 'mock-deploy', 'www/site/index.html'), 'utf8')).toBe('a-sua');
    const third = await ssh.uploadDirectory(local, '/www/site');
    expect(third).toMatchObject({ files: 0, unchanged: 3, removed: 0 });
  });
});

describe('gộp job dựng lại', () => {
  it('nhiều lần sửa liên tiếp chỉ tạo một job chờ; job đang chạy không chặn job mới', () => {
    const db = new Db(':memory:');
    const sid = db.createSite({ domain: 'gop.com', server_id: null, brief: SiteBriefSchema.parse({ brandName: 'G', industry: 'x' }), entity: EntitySchema.parse({ type: 'LocalBusiness', name: 'G' }) });
    const a = db.scheduleRebuild(sid, 20);
    const b = db.scheduleRebuild(sid, 20);
    expect(b).toBe(a);
    expect(db.listJobs().filter((j) => j.type === 'rebuild_deploy')).toHaveLength(1);
    const job = db.listJobs()[0]!;
    expect(new Date(job.run_at).getTime()).toBeGreaterThan(Date.now() + 10_000);
    // giả lập job đang chạy: sửa tiếp phải tạo job mới để không mất thay đổi
    db.raw.prepare(`UPDATE jobs SET status='running' WHERE id=?`).run(a);
    const c = db.scheduleRebuild(sid, 0);
    expect(c).not.toBe(a);
    expect(db.listJobs().filter((j) => j.type === 'rebuild_deploy')).toHaveLength(2);
  });
});
