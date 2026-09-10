import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigCache } from '../src/config.js';
import { Db } from '../src/db/index.js';
import { createServices } from '../src/services/index.js';
import { STEPS } from '../src/core/steps.js';
import { Worker } from '../src/core/worker.js';
import { createApp } from '../src/web/server.js';
import { checkPassword, passwordSource, setAdminPassword } from '../src/web/auth.js';

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-auth-'));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const form = (data: Record<string, string>) => ({ method: 'POST', body: new URLSearchParams(data), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

function makeApp(env: Record<string, string>) {
  resetConfigCache();
  const config = loadConfig({ MOCK_MODE: '1', DATA_DIR: tmp, ...env });
  const db = new Db(':memory:');
  const services = createServices(config, db);
  const worker = new Worker({ db, config, services, steps: STEPS });
  const app = createApp({ db, config, services, worker, steps: STEPS });
  return { app, db, config };
}

describe('thiết lập lần đầu và đăng nhập', () => {
  it('chưa có mật khẩu: mọi trang chuyển về /setup, đặt xong thì đăng nhập được', async () => {
    const { app, db, config } = makeApp({ ADMIN_PASSWORD: '' });
    expect(passwordSource(db, config)).toBe('none');
    const home = await app.request('/');
    expect(home.status).toBe(302);
    expect(home.headers.get('location')).toBe('/setup');
    const setupPage = await app.request('/setup');
    expect(setupPage.status).toBe(200);
    expect(await setupPage.text()).toContain('Thiết lập lần đầu');

    const bad = await app.request('/setup', form({ user: 'admin', password: 'ngan', confirm: 'ngan' }));
    expect(bad.status).toBe(400);
    const mismatch = await app.request('/setup', form({ user: 'admin', password: 'matkhau-dai', confirm: 'khac-nhau' }));
    expect(mismatch.status).toBe(400);

    const ok = await app.request('/setup', form({ user: 'quantri', password: 'matkhau-dai-123', confirm: 'matkhau-dai-123' }));
    expect(ok.status).toBe(302);
    expect(ok.headers.get('location')).toBe('/settings');
    const cookie = ok.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(cookie).toMatch(/^sa_session=/);
    expect(passwordSource(db, config)).toBe('dashboard');

    // /setup khóa lại sau khi đã có tài khoản
    expect((await app.request('/setup')).headers.get('location')).toBe('/login');
    // Đăng nhập bằng mật khẩu mới, sai thì 401
    expect((await app.request('/login', form({ user: 'quantri', password: 'sai', next: '/' }))).status).toBe(401);
    expect((await app.request('/login', form({ user: 'quantri', password: 'matkhau-dai-123', next: '/' }))).status).toBe(302);
    // Trang đã đăng nhập hoạt động
    const settings = await app.request('/settings', { headers: { cookie } });
    expect(settings.status).toBe(200);
    expect(await settings.text()).toContain('Tài khoản dashboard');
    // DB không chứa mật khẩu gốc
    expect(JSON.stringify(db.getSetting('admin', null))).not.toContain('matkhau-dai-123');
    db.close();
  });

  it('mật khẩu trên dashboard ưu tiên hơn .env, đổi mật khẩu cần mật khẩu hiện tại', async () => {
    const { app, db, config } = makeApp({ ADMIN_PASSWORD: 'env-pass-123', ADMIN_USER: 'admin' });
    expect(passwordSource(db, config)).toBe('env');
    expect(checkPassword(db, config, 'admin', 'env-pass-123')).toBe(true);
    const login = await app.request('/login', form({ user: 'admin', password: 'env-pass-123', next: '/' }));
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';

    const wrong = await app.request('/settings/password', { ...form({ current: 'sai', user: 'admin', password: 'moi-moi-moi', confirm: 'moi-moi-moi' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie } });
    expect(wrong.status).toBe(302);
    expect(passwordSource(db, config)).toBe('env');

    const changed = await app.request('/settings/password', { ...form({ current: 'env-pass-123', user: 'admin', password: 'moi-moi-moi', confirm: 'moi-moi-moi' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie } });
    expect(changed.status).toBe(302);
    expect(passwordSource(db, config)).toBe('dashboard');
    expect(checkPassword(db, config, 'admin', 'env-pass-123')).toBe(false);
    expect(checkPassword(db, config, 'admin', 'moi-moi-moi')).toBe(true);

    setAdminPassword(db, 'khac', 'mat-khau-khac-1');
    expect(checkPassword(db, config, 'admin', 'mat-khau-khac-1')).toBe(false);
    expect(checkPassword(db, config, 'khac', 'mat-khau-khac-1')).toBe(true);
    db.close();
  });
});
