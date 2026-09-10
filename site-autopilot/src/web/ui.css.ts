/** CSS của dashboard quản trị (không phải website đầu ra). */
export const DASHBOARD_CSS = `
:root{--bg:#f5f7fb;--card:#fff;--text:#111827;--muted:#6b7280;--line:#e5e7eb;--primary:#2563eb;--primary-dark:#1d4ed8;--ok:#16a34a;--warn:#d97706;--err:#dc2626;--info:#0891b2;--radius:10px}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,"Segoe UI",system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);font-size:15px;line-height:1.5}
a{color:var(--primary);text-decoration:none}a:hover{text-decoration:underline}
h1{font-size:1.5rem;margin:0 0 16px}h2{font-size:1.15rem;margin:0 0 12px}h3{font-size:1rem;margin:0 0 8px}
.topbar{background:#111827;color:#fff;padding:6px 16px;display:flex;align-items:center;gap:16px;min-height:56px;position:sticky;top:0;z-index:20;flex-wrap:wrap}
.topbar .logo{font-weight:700;letter-spacing:.02em;color:#fff;white-space:nowrap}
.topbar nav{display:flex;gap:2px;flex:1;flex-wrap:wrap}
.topbar nav a{color:#d1d5db;padding:6px 10px;border-radius:8px;white-space:nowrap}
.topbar form{margin-left:auto}
.topbar nav a:hover,.topbar nav a.active{background:#1f2937;color:#fff;text-decoration:none}
.topbar .mock{background:#f59e0b;color:#111;font-size:.75rem;padding:3px 8px;border-radius:999px;font-weight:600}
.wrap{max-width:1180px;margin:0 auto;padding:24px}
.grid{display:grid;gap:16px}
.grid.cols-2{grid-template-columns:1fr 1fr}
.grid.cols-3{grid-template-columns:repeat(3,1fr)}
.grid.cols-4{grid-template-columns:repeat(4,1fr)}
@media(max-width:900px){.grid.cols-2,.grid.cols-3,.grid.cols-4{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px}
.card.tight{padding:12px 14px}
.stat{display:flex;flex-direction:column;gap:2px}
.stat .n{font-size:1.7rem;font-weight:700}
.stat .l{color:var(--muted);font-size:.85rem}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.78rem;font-weight:600;white-space:nowrap}
.badge.live{background:#dcfce7;color:#166534}
.badge.building,.badge.creating{background:#dbeafe;color:#1e40af}
.badge.waiting_ns,.badge.waiting{background:#fef3c7;color:#92400e}
.badge.error,.badge.failed{background:#fee2e2;color:#991b1b}
.badge.paused,.badge.pending,.badge.skipped{background:#f3f4f6;color:#374151}
.badge.done,.badge.ok{background:#dcfce7;color:#166534}
.badge.running,.badge.queued{background:#e0f2fe;color:#075985}
.progress{height:8px;background:#e5e7eb;border-radius:999px;overflow:hidden;min-width:120px}
.progress i{display:block;height:100%;background:var(--primary)}
.btn{display:inline-block;padding:8px 14px;border-radius:8px;border:1px solid var(--primary);background:var(--primary);color:#fff;font-weight:600;cursor:pointer;font-size:.9rem;line-height:1.2}
.btn:hover{background:var(--primary-dark);text-decoration:none}
.btn.secondary{background:#fff;color:var(--text);border-color:var(--line)}
.btn.secondary:hover{background:#f3f4f6}
.btn.danger{background:#fff;color:var(--err);border-color:#fecaca}
.btn.danger:hover{background:#fef2f2}
.btn.sm{padding:5px 10px;font-size:.8rem}
.btn[disabled]{opacity:.5;cursor:not-allowed}
form.inline{display:inline}
label{display:block;font-weight:600;font-size:.85rem;margin:12px 0 4px}
label small,.help{font-weight:400;color:var(--muted);font-size:.8rem}
input[type=text],input[type=password],input[type=number],input[type=email],input[type=url],select,textarea{width:100%;padding:9px 11px;border:1px solid #d1d5db;border-radius:8px;font:inherit;background:#fff}
textarea{min-height:90px;resize:vertical}
input:focus,select:focus,textarea:focus{outline:2px solid #bfdbfe;border-color:var(--primary)}
fieldset{border:1px solid var(--line);border-radius:var(--radius);padding:8px 18px 18px;margin:0 0 16px;background:#fff}
legend{font-weight:700;padding:0 6px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
@media(max-width:700px){.row{grid-template-columns:1fr}}
.alert{padding:12px 14px;border-radius:8px;margin-bottom:16px;border:1px solid}
.alert.ok{background:#f0fdf4;border-color:#bbf7d0;color:#166534}
.alert.err{background:#fef2f2;border-color:#fecaca;color:#991b1b}
.alert.warn{background:#fffbeb;border-color:#fde68a;color:#92400e}
.alert.info{background:#eff6ff;border-color:#bfdbfe;color:#1e40af}
.steps{display:grid;gap:8px}
.step{display:grid;grid-template-columns:130px 1fr auto;gap:12px;align-items:start;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:#fff}
.step .name{font-weight:600}
.step .desc{color:var(--muted);font-size:.82rem}
.step .msg{font-size:.85rem;margin-top:4px;white-space:pre-wrap;word-break:break-word}
.step .msg.err{color:var(--err)}
.step.branch-cloudflare{border-left:4px solid #f97316}
.step.branch-build{border-left:4px solid #2563eb}
.step.branch-final{border-left:4px solid #16a34a}
.branch-title{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:14px 0 6px}
.log{font-family:ui-monospace,Consolas,monospace;font-size:.78rem;background:#0b1220;color:#d1d5db;padding:12px;border-radius:8px;max-height:420px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.log .error{color:#fca5a5}.log .warn{color:#fcd34d}.log .info{color:#93c5fd}
.muted{color:var(--muted)}
.small{font-size:.85rem}
.mono{font-family:ui-monospace,Consolas,monospace;font-size:.85rem}
.ns-box{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 14px}
.ns-box code{display:block;font-size:1.05rem;font-weight:700;margin:4px 0}
.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.login{max-width:380px;margin:80px auto}
.kv{display:grid;grid-template-columns:180px 1fr;gap:6px 12px;font-size:.9rem}
.kv dt{color:var(--muted)}.kv dd{margin:0}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:16px}
.tabs a{padding:8px 14px;border-radius:8px 8px 0 0;color:var(--muted);font-weight:600}
.tabs a.active{background:#fff;border:1px solid var(--line);border-bottom-color:#fff;color:var(--text);margin-bottom:-1px}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;background:#f3f4f6;font-size:.78rem;margin-right:4px}
.pill.on{background:#dcfce7;color:#166534}.pill.off{background:#fee2e2;color:#991b1b}
details.panel{border:1px solid var(--line);border-radius:8px;padding:10px 14px;background:#fff;margin-bottom:8px}
details.panel summary{cursor:pointer;font-weight:600}
.prose-preview{max-height:320px;overflow:auto;font-size:.9rem;border:1px solid var(--line);border-radius:8px;padding:10px 14px;background:#fafafa}
`;
