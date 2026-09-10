import type { Child } from 'hono/jsx';
import { raw } from 'hono/html';
import { DASHBOARD_CSS } from './ui.css.js';

export interface Flash {
  type: 'ok' | 'err' | 'warn' | 'info';
  text: string;
}

export function Page(props: { title: string; active?: string; mock?: boolean; flash?: Flash | null; children?: Child; refresh?: number }) {
  return (
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{props.title} · Site Autopilot</title>
        <style>{raw(DASHBOARD_CSS)}</style>
        {props.refresh ? <meta http-equiv="refresh" content={String(props.refresh)} /> : null}
      </head>
      <body>
        <header class="topbar">
          <a class="logo" href="/">
            ⚙ Site Autopilot
          </a>
          <nav>
            <a href="/" class={props.active === 'sites' ? 'active' : ''}>
              Website
            </a>
            <a href="/sites/new" class={props.active === 'new' ? 'active' : ''}>
              + Tạo site
            </a>
            <a href="/jobs" class={props.active === 'jobs' ? 'active' : ''}>
              Tác vụ
            </a>
            <a href="/logs" class={props.active === 'logs' ? 'active' : ''}>
              Log
            </a>
            <a href="/settings" class={props.active === 'settings' ? 'active' : ''}>
              Cài đặt
            </a>
          </nav>
          {props.mock ? <span class="mock">MOCK</span> : null}
          <form method="post" action="/logout" class="inline">
            <button class="btn secondary sm" type="submit">
              Đăng xuất
            </button>
          </form>
        </header>
        <main class="wrap">
          {props.flash ? <div class={`alert ${props.flash.type}`}>{props.flash.text}</div> : null}
          {props.children}
        </main>
      </body>
    </html>
  );
}

export function LoginPage(props: { error?: string; next?: string }) {
  return (
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Đăng nhập · Site Autopilot</title>
        <style>{raw(DASHBOARD_CSS)}</style>
      </head>
      <body>
        <div class="login card">
          <h1>Site Autopilot</h1>
          {props.error ? <div class="alert err">{props.error}</div> : null}
          <form method="post" action="/login">
            <input type="hidden" name="next" value={props.next ?? '/'} />
            <label>Tài khoản</label>
            <input type="text" name="user" autocomplete="username" required />
            <label>Mật khẩu</label>
            <input type="password" name="password" autocomplete="current-password" required />
            <p style="margin-top:16px">
              <button class="btn" type="submit">
                Đăng nhập
              </button>
            </p>
          </form>
        </div>
      </body>
    </html>
  );
}

export function SetupPage(props: { error?: string; user?: string }) {
  return (
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Thiết lập lần đầu · Site Autopilot</title>
        <style>{raw(DASHBOARD_CSS)}</style>
      </head>
      <body>
        <div class="login card" style="max-width:440px">
          <h1>Thiết lập lần đầu</h1>
          <p class="muted small">Chưa có tài khoản quản trị. Đặt tài khoản và mật khẩu để đăng nhập dashboard. Mật khẩu chỉ lưu dưới dạng băm, không thể xem lại, nhưng đổi được trong Cài đặt.</p>
          {props.error ? <div class="alert err">{props.error}</div> : null}
          <form method="post" action="/setup">
            <label>Tài khoản</label>
            <input type="text" name="user" value={props.user ?? 'admin'} autocomplete="username" required />
            <label>Mật khẩu (ít nhất 8 ký tự)</label>
            <input type="password" name="password" autocomplete="new-password" required minlength={8} />
            <label>Nhập lại mật khẩu</label>
            <input type="password" name="confirm" autocomplete="new-password" required minlength={8} />
            <p style="margin-top:16px">
              <button class="btn" type="submit">
                Lưu và đăng nhập
              </button>
            </p>
          </form>
        </div>
      </body>
    </html>
  );
}

export function Badge(props: { status: string; label?: string }) {
  return <span class={`badge ${props.status}`}>{props.label ?? STATUS_LABEL[props.status] ?? props.status}</span>;
}

export const STATUS_LABEL: Record<string, string> = {
  creating: 'Đang khởi tạo',
  waiting_ns: 'Chờ đổi NS',
  building: 'Đang dựng',
  live: 'Live',
  error: 'Lỗi',
  paused: 'Tạm dừng',
  pending: 'Chờ',
  running: 'Đang chạy',
  waiting: 'Đang chờ',
  done: 'Xong',
  failed: 'Lỗi',
  skipped: 'Bỏ qua',
  queued: 'Trong hàng đợi',
  ok: 'OK',
};
