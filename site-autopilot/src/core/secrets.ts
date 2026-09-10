import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/index.js';
import { createLogger } from './logger.js';
import { nowIso } from './util.js';

const log = createLogger('secrets');

/** Các khóa bí mật có thể nhập trên dashboard. Giá trị được mã hóa AES-256-GCM trước khi lưu DB. */
export const SECRET_NAMES = ['cloudflare_token', 'anthropic_key', 'pexels_key', 'google_sa_json', 'google_maps_key', 'telegram_token'] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

export const SECRET_LABELS: Record<SecretName, string> = {
  cloudflare_token: 'Cloudflare API Token',
  anthropic_key: 'Anthropic API key',
  pexels_key: 'Pexels API key',
  google_sa_json: 'Google service account JSON',
  google_maps_key: 'Google Maps Platform API key',
  telegram_token: 'Telegram bot token',
};

/**
 * Khóa chủ để mã hóa: lấy từ SESSION_SECRET trong .env; nếu trống thì sinh một lần và lưu ở data/.secret-key (chmod 600).
 * Đổi SESSION_SECRET sau khi đã nhập khóa sẽ làm các khóa cũ không giải mã được, khi đó chỉ cần nhập lại trên dashboard.
 */
export function loadMasterKey(sessionSecret: string, dataDir: string): Buffer {
  let material = sessionSecret.trim();
  if (!material) {
    const file = path.join(dataDir, '.secret-key');
    if (fs.existsSync(file)) {
      material = fs.readFileSync(file, 'utf8').trim();
    } else {
      material = crypto.randomBytes(32).toString('hex');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, material, { mode: 0o600 });
    }
  }
  return crypto.createHash('sha256').update(material).digest();
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) throw new Error('Định dạng khóa mã hóa không hợp lệ');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

interface StoredSecret {
  enc: string;
  hint: string;
  updatedAt: string;
}

export interface SecretInfo {
  set: boolean;
  hint: string;
  updatedAt: string | null;
  /** Có bản ghi nhưng không giải mã được (đổi SESSION_SECRET) */
  broken: boolean;
}

export function secretHint(value: string): string {
  const v = value.trim();
  if (v.length <= 6) return '••••';
  return `…${v.slice(-4)}`;
}

/** Kho khóa bí mật: ghi vào bảng settings với tiền tố secret:, chỉ trả về giá trị cho mã nguồn, không bao giờ hiển thị lại. */
export class SecretStore {
  private cache = new Map<SecretName, { raw: string | null; value: string }>();

  constructor(private readonly db: Db, private readonly key: Buffer) {}

  private read(name: SecretName): StoredSecret | null {
    return this.db.getSetting<StoredSecret | null>(`secret:${name}`, null);
  }

  get(name: SecretName): string {
    const row = this.read(name);
    if (!row) {
      this.cache.delete(name);
      return '';
    }
    const cached = this.cache.get(name);
    if (cached && cached.raw === row.enc) return cached.value;
    try {
      const value = decryptSecret(row.enc, this.key);
      this.cache.set(name, { raw: row.enc, value });
      return value;
    } catch (err) {
      log.warn(`Không giải mã được ${name}: ${(err as Error).message}. Hãy nhập lại trên dashboard.`);
      this.cache.set(name, { raw: row.enc, value: '' });
      return '';
    }
  }

  set(name: SecretName, value: string): void {
    const v = value.trim();
    if (!v) {
      this.delete(name);
      return;
    }
    const stored: StoredSecret = { enc: encryptSecret(v, this.key), hint: secretHint(v), updatedAt: nowIso() };
    this.db.setSetting(`secret:${name}`, stored);
    this.cache.delete(name);
  }

  delete(name: SecretName): void {
    this.db.setSetting(`secret:${name}`, null);
    this.cache.delete(name);
  }

  has(name: SecretName): boolean {
    return this.get(name) !== '';
  }

  info(name: SecretName): SecretInfo {
    const row = this.read(name);
    if (!row) return { set: false, hint: '', updatedAt: null, broken: false };
    const value = this.get(name);
    return { set: value !== '', hint: row.hint, updatedAt: row.updatedAt, broken: value === '' };
  }
}
