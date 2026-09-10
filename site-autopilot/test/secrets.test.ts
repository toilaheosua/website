import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../src/db/index.js';
import { decryptSecret, encryptSecret, loadMasterKey, secretHint, SecretStore } from '../src/core/secrets.js';
import { loadConfig, resetConfigCache, resolveIntegrations } from '../src/config.js';
import { createServices, getIntegrationSettings, setIntegrationSettings } from '../src/services/index.js';

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-secrets-'));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('mã hóa khóa', () => {
  it('mã hóa và giải mã đúng, mỗi lần mã hóa cho chuỗi khác nhau', () => {
    const key = loadMasterKey('chuoi-bi-mat', tmp);
    const a = encryptSecret('sk-ant-123456', key);
    const b = encryptSecret('sk-ant-123456', key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe('sk-ant-123456');
    expect(() => decryptSecret(a, loadMasterKey('khoa-khac', tmp))).toThrow();
  });

  it('sinh khóa chủ vào data/.secret-key khi SESSION_SECRET trống và dùng lại lần sau', () => {
    const k1 = loadMasterKey('', tmp);
    const k2 = loadMasterKey('', tmp);
    expect(k1.equals(k2)).toBe(true);
    expect(fs.existsSync(path.join(tmp, '.secret-key'))).toBe(true);
  });

  it('gợi ý chỉ lộ 4 ký tự cuối', () => {
    expect(secretHint('abcdefghij')).toBe('…ghij');
    expect(secretHint('abc')).toBe('••••');
  });
});

describe('SecretStore và ưu tiên dashboard hơn .env', () => {
  it('lưu, đọc, xóa, báo trạng thái mà không lộ giá trị', () => {
    const db = new Db(':memory:');
    const store = new SecretStore(db, loadMasterKey('x', tmp));
    expect(store.get('pexels_key')).toBe('');
    expect(store.info('pexels_key')).toEqual({ set: false, hint: '', updatedAt: null, broken: false });
    store.set('pexels_key', '  PEXELS-KEY-9999 ');
    expect(store.get('pexels_key')).toBe('PEXELS-KEY-9999');
    const info = store.info('pexels_key');
    expect(info.set).toBe(true);
    expect(info.hint).toBe('…9999');
    // Bản ghi trong DB không chứa giá trị gốc
    const raw = JSON.stringify(db.getSetting('secret:pexels_key', null));
    expect(raw).not.toContain('PEXELS-KEY-9999');
    store.set('pexels_key', '');
    expect(store.info('pexels_key').set).toBe(false);
    db.close();
  });

  it('báo broken khi khóa chủ đổi', () => {
    const db = new Db(':memory:');
    new SecretStore(db, loadMasterKey('a', tmp)).set('anthropic_key', 'sk-ant-abcdef');
    const other = new SecretStore(db, loadMasterKey('b', tmp));
    expect(other.get('anthropic_key')).toBe('');
    expect(other.info('anthropic_key').broken).toBe(true);
    db.close();
  });

  it('resolveIntegrations: dashboard thắng .env, thiếu cả hai thì none', () => {
    resetConfigCache();
    const cfg = loadConfig({ DATA_DIR: tmp, CLOUDFLARE_API_TOKEN: 'env-token', CLOUDFLARE_ACCOUNT_ID: 'env-acc', ANTHROPIC_API_KEY: '', PEXELS_API_KEY: 'env-pexels' });
    const db = new Db(':memory:');
    const store = new SecretStore(db, loadMasterKey('x', tmp));
    store.set('cloudflare_token', 'dash-token');
    setIntegrationSettings(db, { cloudflareAccountId: 'dash-acc' });
    const integ = resolveIntegrations(cfg, store, getIntegrationSettings(db));
    expect(integ.cloudflare).toEqual({ token: 'dash-token', accountId: 'dash-acc', source: 'dashboard' });
    expect(integ.pexels).toEqual({ apiKey: 'env-pexels', source: 'env' });
    expect(integ.anthropic.source).toBe('none');
    expect(integ.anthropic.model).toBe('claude-opus-5');
    db.close();
    resetConfigCache();
  });

  it('dịch vụ đọc khóa mới ngay sau khi nhập, không cần khởi động lại', async () => {
    resetConfigCache();
    const cfg = loadConfig({ DATA_DIR: tmp, MOCK_MODE: '0', SESSION_SECRET: 'x' });
    const db = new Db(':memory:');
    const services = createServices(cfg, db);
    expect(() => services.content.usage()).toThrow(/Claude/);
    expect(() => services.images.search('a', {})).toThrow(/Pexels/);
    expect(services.google).toBeNull();
    services.secrets.set('anthropic_key', 'sk-ant-test-1234');
    // Có key rồi: đối tượng thật được tạo, gọi hàm không cần mạng chạy bình thường
    expect(services.content.usage()).toEqual({ inputTokens: 0, outputTokens: 0, calls: 0 });
    services.secrets.set('google_sa_json', JSON.stringify({ client_email: 'sa@test.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END PRIVATE KEY-----\n' }));
    expect(services.google).not.toBeNull();
    services.secrets.delete('google_sa_json');
    expect(services.google).toBeNull();
    db.close();
    resetConfigCache();
  });
});
