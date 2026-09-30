import type { Child } from 'hono/jsx';
import { raw } from 'hono/html';
import { DASHBOARD_CSS } from './ui.css.js';
import { RUN_STATUS_LABEL } from '../core/types.js';

export interface Flash {
  type: 'ok' | 'err' | 'warn' | 'info';
  text: string;
}

const APP_NAME = 'Tool Viết Content';

export function Page(props: { title: string; active?: string; mock?: boolean; flash?: Flash | null; children?: Child; refresh?: number; pollUrl?: string; pollKey?: string }) {
  const poll = props.pollUrl
    ? `(function(){var key=${JSON.stringify(props.pollKey ?? '')};function typing(){var a=document.activeElement;return a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.tagName==='SELECT')}function tick(){fetch(${JSON.stringify(props.pollUrl)},{cache:'no-store'}).then(function(r){return r.json()}).then(function(j){if(j.key!==key){if(typing()){setTimeout(tick,4000)}else{location.reload()}}else{setTimeout(tick,4000)}}).catch(function(){setTimeout(tick,8000)})}setTimeout(tick,4000)})();`
    : '';
  return (
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>
          {props.title} · {APP_NAME}
        </title>
        <style>{raw(DASHBOARD_CSS)}</style>
        {props.refresh ? <meta http-equiv="refresh" content={String(props.refresh)} /> : null}
      </head>
      <body>
        <header class="topbar">
          <a class="logo" href="/">
            ✍ {APP_NAME}
          </a>
          <nav>
            <a href="/" class={props.active === 'home' ? 'active' : ''}>
              Bài viết
            </a>
            <a href="/#new" class={props.active === 'new' ? 'active' : ''}>
              + Viết bài mới
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
        {poll ? <script>{raw(poll)}</script> : null}
      </body>
    </html>
  );
}

function Bare(props: { title: string; children?: Child }) {
  return (
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>
          {props.title} · {APP_NAME}
        </title>
        <style>{raw(DASHBOARD_CSS)}</style>
      </head>
      <body>{props.children}</body>
    </html>
  );
}

export function LoginPage(props: { error?: string; next?: string }) {
  return (
    <Bare title="Đăng nhập">
      <div class="login card">
        <h1>{APP_NAME}</h1>
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
    </Bare>
  );
}

export function SetupPage(props: { error?: string; user?: string }) {
  return (
    <Bare title="Thiết lập lần đầu">
      <div class="login card" style="max-width:440px">
        <h1>Thiết lập lần đầu</h1>
        <p class="muted small">Chưa có tài khoản quản trị. Đặt tài khoản và mật khẩu để đăng nhập. Mật khẩu chỉ lưu dưới dạng băm, đổi được trong Cài đặt.</p>
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
    </Bare>
  );
}

export const STATUS_LABEL: Record<string, string> = {
  ...RUN_STATUS_LABEL,
  pending: 'Chờ',
  running: 'Đang chạy',
  waiting: 'Chờ duyệt',
  done: 'Xong',
  failed: 'Lỗi',
  skipped: 'Bỏ qua',
  ok: 'OK',
  blocked: 'Bị chặn',
  short: 'Quá ngắn',
  duplicate: 'Trùng',
  pass: 'Đạt',
  fail: 'Chưa đạt',
};

export function Badge(props: { status: string; label?: string }) {
  return <span class={`badge ${props.status}`}>{props.label ?? STATUS_LABEL[props.status] ?? props.status}</span>;
}
