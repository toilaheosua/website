import crypto from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Db } from '../db/index.js';
import type { AppConfig } from '../config.js';
import { nowIso, randomHex } from '../core/util.js';

const COOKIE = 'sa_session';
const TTL_MS = 30 * 24 * 3600_000;
const ADMIN_KEY = 'admin';

interface AdminCredential {
  user: string;
  salt: string;
  hash: string;
  updatedAt: string;
}

function hashPassword(password: string, saltHex: string): Buffer {
  return crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
}

export function getAdminCredential(db: Db): AdminCredential | null {
  const cred = db.getSetting<AdminCredential | null>(ADMIN_KEY, null);
  return cred && cred.hash && cred.salt ? cred : null;
}

/** Đặt (hoặc đổi) tài khoản quản trị: chỉ lưu hash scrypt, không lưu mật khẩu. */
export function setAdminPassword(db: Db, user: string, password: string): void {
  const salt = crypto.randomBytes(16).toString('hex');
  const cred: AdminCredential = { user: user.trim() || 'admin', salt, hash: hashPassword(password, salt).toString('hex'), updatedAt: nowIso() };
  db.setSetting(ADMIN_KEY, cred);
}

/** Mật khẩu đặt trên dashboard được ưu tiên; nếu chưa có thì dùng ADMIN_PASSWORD trong .env. */
export function passwordSource(db: Db, config: AppConfig): 'dashboard' | 'env' | 'none' {
  if (getAdminCredential(db)) return 'dashboard';
  if (config.ADMIN_PASSWORD) return 'env';
  return 'none';
}

export function hasAdminCredential(db: Db, config: AppConfig): boolean {
  return passwordSource(db, config) !== 'none';
}

export function adminUserName(db: Db, config: AppConfig): string {
  return getAdminCredential(db)?.user ?? config.ADMIN_USER;
}

export function checkPassword(db: Db, config: AppConfig, user: string, password: string): boolean {
  const cred = getAdminCredential(db);
  if (cred) {
    if (user.trim() !== cred.user) return false;
    const given = hashPassword(password, cred.salt);
    const stored = Buffer.from(cred.hash, 'hex');
    return given.length === stored.length && crypto.timingSafeEqual(given, stored);
  }
  if (!config.ADMIN_PASSWORD) return false;
  const a = Buffer.from(`${user}\n${password}`);
  const b = Buffer.from(`${config.ADMIN_USER}\n${config.ADMIN_PASSWORD}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < 8) return 'Mật khẩu cần ít nhất 8 ký tự';
  if (password !== confirm) return 'Hai lần nhập mật khẩu không khớp';
  return null;
}

export function login(c: Context, db: Db, config: AppConfig): void {
  const token = randomHex(32);
  db.createSession(token, TTL_MS);
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: TTL_MS / 1000, secure: config.BASE_URL.startsWith('https://') });
}

export function logout(c: Context, db: Db): void {
  const token = getCookie(c, COOKIE);
  if (token) db.deleteSession(token);
  deleteCookie(c, COOKIE, { path: '/' });
}

export function isAuthenticated(c: Context, db: Db): boolean {
  const token = getCookie(c, COOKIE);
  return Boolean(token && db.hasValidSession(token));
}

/**
 * Chặn mọi route trừ /login, /setup và tài nguyên tĩnh khi chưa đăng nhập.
 * Chưa có mật khẩu quản trị nào (lần chạy đầu) thì đưa về trang /setup để đặt ngay trên web.
 */
export function requireAuth(db: Db, config: AppConfig): MiddlewareHandler {
  return async (c, next) => {
    const p = c.req.path;
    if (p === '/setup' || p.startsWith('/static/') || p === '/healthz') return next();
    if (!hasAdminCredential(db, config)) {
      if (c.req.method === 'GET') return c.redirect('/setup');
      return c.text('Chưa đặt mật khẩu quản trị', 403);
    }
    if (p === '/login') return next();
    if (!isAuthenticated(c, db)) {
      if (c.req.method === 'GET') return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
      return c.text('Chưa đăng nhập', 401);
    }
    return next();
  };
}

/** Chống CSRF đơn giản: form POST phải cùng origin (header Origin hoặc Referer). */
export function sameOriginGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === 'POST') {
      const origin = c.req.header('origin') ?? c.req.header('referer') ?? '';
      const host = c.req.header('host') ?? '';
      if (origin && host && !origin.includes(host)) return c.text('Yêu cầu không hợp lệ (origin)', 403);
    }
    return next();
  };
}
