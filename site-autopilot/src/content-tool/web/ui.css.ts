/** CSS của dashboard. */
export const DASHBOARD_CSS = `
:root{--bg:#f5f7fb;--card:#fff;--text:#111827;--muted:#6b7280;--line:#e5e7eb;--primary:#0f766e;--primary-dark:#115e59;--ok:#16a34a;--warn:#d97706;--err:#dc2626;--info:#0891b2;--radius:10px}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,"Segoe UI",system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);font-size:15px;line-height:1.5}
a{color:var(--primary);text-decoration:none}a:hover{text-decoration:underline}
h1{font-size:1.5rem;margin:0 0 16px}h2{font-size:1.15rem;margin:0 0 12px}h3{font-size:1rem;margin:0 0 8px}
.topbar{background:#0f172a;color:#fff;padding:6px 16px;display:flex;align-items:center;gap:16px;min-height:56px;position:sticky;top:0;z-index:20;flex-wrap:wrap}
.topbar .logo{font-weight:700;letter-spacing:.02em;color:#fff;white-space:nowrap}
.topbar nav{display:flex;gap:2px;flex:1;flex-wrap:wrap}
.topbar nav a{color:#d1d5db;padding:6px 10px;border-radius:8px;white-space:nowrap}
.topbar form{margin-left:auto}
.topbar nav a:hover,.topbar nav a.active{background:#1e293b;color:#fff;text-decoration:none}
.topbar .mock{background:#f59e0b;color:#111;font-size:.75rem;padding:3px 8px;border-radius:999px;font-weight:600}
.wrap{max-width:1180px;margin:0 auto;padding:24px}
.grid{display:grid;gap:16px}
.grid.cols-2{grid-template-columns:1fr 1fr}
.grid.cols-3{grid-template-columns:repeat(3,1fr)}
.grid.cols-4{grid-template-columns:repeat(4,1fr)}
.grid.cols-5{grid-template-columns:repeat(5,1fr)}
.grid.side{grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)}
@media(max-width:900px){.grid.cols-2,.grid.cols-3,.grid.cols-4,.grid.cols-5,.grid.side{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px;min-width:0}
.card.tight{padding:12px 14px}
.stat{display:flex;flex-direction:column;gap:2px}
.stat .n{font-size:1.5rem;font-weight:700}
.stat .l{color:var(--muted);font-size:.82rem}
.stat.good .n{color:var(--ok)}.stat.bad .n{color:var(--err)}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.78rem;font-weight:600;white-space:nowrap}
.badge.done,.badge.ok,.badge.pass{background:#dcfce7;color:#166534}
.badge.running,.badge.queued{background:#e0f2fe;color:#075985}
.badge.waiting_outline,.badge.waiting_ai_score,.badge.waiting,.badge.needs_review{background:#fef3c7;color:#92400e}
.score-panel{border:2px solid var(--warn);background:#fffbeb}
.score-panel ol{padding-left:20px}
.score-panel textarea{background:#fff}
.badge.failed,.badge.fail,.badge.error{background:#fee2e2;color:#991b1b}
.badge.cancelled,.badge.pending,.badge.skipped,.badge.blocked,.badge.short,.badge.duplicate{background:#f3f4f6;color:#374151}
.badge.major{background:#fee2e2;color:#991b1b}.badge.minor{background:#fef3c7;color:#92400e}
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
textarea.tall{min-height:200px}
textarea.mono{font-family:ui-monospace,Consolas,monospace;font-size:.85rem}
input:focus,select:focus,textarea:focus{outline:2px solid #99f6e4;border-color:var(--primary)}
input[type=checkbox]{width:auto;margin-right:6px}
label.check{display:flex;align-items:center;font-weight:500;margin-top:14px}
fieldset{border:1px solid var(--line);border-radius:var(--radius);padding:8px 18px 18px;margin:0 0 16px;background:#fff}
legend{font-weight:700;padding:0 6px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
.row.three{grid-template-columns:1fr 1fr 1fr}
@media(max-width:700px){.row,.row.three{grid-template-columns:1fr}}
.alert{padding:12px 14px;border-radius:8px;margin-bottom:16px;border:1px solid}
.alert.ok{background:#f0fdf4;border-color:#bbf7d0;color:#166534}
.alert.err{background:#fef2f2;border-color:#fecaca;color:#991b1b}
.alert.warn{background:#fffbeb;border-color:#fde68a;color:#92400e}
.alert.info{background:#eff6ff;border-color:#bfdbfe;color:#1e40af}
.steps{display:grid;gap:8px}
.step{display:grid;grid-template-columns:150px 1fr auto;gap:12px;align-items:start;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:#fff}
.step .name{font-weight:600}
.step .desc{color:var(--muted);font-size:.8rem}
.step .msg{font-size:.85rem;margin-top:4px;white-space:pre-wrap;word-break:break-word}
.step .msg.err{color:var(--err)}
.step.running{border-left:4px solid var(--info)}.step.done{border-left:4px solid var(--ok)}.step.failed{border-left:4px solid var(--err)}.step.waiting{border-left:4px solid var(--warn)}
@media(max-width:700px){.step{grid-template-columns:1fr}}
.log{font-family:ui-monospace,Consolas,monospace;font-size:.78rem;background:#0b1220;color:#d1d5db;padding:12px;border-radius:8px;max-height:480px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.log .error{color:#fca5a5}.log .warn{color:#fcd34d}.log .info{color:#93c5fd}
.muted{color:var(--muted)}
.small{font-size:.85rem}
.mono{font-family:ui-monospace,Consolas,monospace;font-size:.85rem}
.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.login{max-width:380px;margin:80px auto}
.kv{display:grid;grid-template-columns:180px 1fr;gap:6px 12px;font-size:.9rem}
.kv dt{color:var(--muted)}.kv dd{margin:0;min-width:0;word-break:break-word}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:16px;flex-wrap:wrap}
.tabs a{padding:8px 14px;border-radius:8px 8px 0 0;color:var(--muted);font-weight:600}
.tabs a.active{background:#fff;border:1px solid var(--line);border-bottom-color:#fff;color:var(--text);margin-bottom:-1px}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;background:#f3f4f6;font-size:.78rem;margin-right:4px;margin-bottom:4px}
.pill.on{background:#dcfce7;color:#166534}.pill.off{background:#fee2e2;color:#991b1b}
details.panel{border:1px solid var(--line);border-radius:8px;padding:10px 14px;background:#fff;margin-bottom:8px}
details.panel summary{cursor:pointer;font-weight:600}
.prose{font-family:"Segoe UI",Inter,system-ui,-apple-system,"Noto Sans",sans-serif;font-size:17px;line-height:1.75;max-width:760px}
.prose h1{font-family:Inter,"Segoe UI",system-ui,sans-serif;font-size:1.7rem;line-height:1.25}
.prose h2{font-family:Inter,"Segoe UI",system-ui,sans-serif;font-size:1.3rem;margin-top:1.8em}
.prose h3{font-family:Inter,"Segoe UI",system-ui,sans-serif;font-size:1.08rem}
.prose blockquote{border-left:4px solid #cbd5e1;margin:1.2em 0;padding:.4em 1em;background:#f8fafc}
.prose img{max-width:100%;height:auto}
.prose img.place-photo{display:block;width:100%;max-width:420px;max-height:300px;object-fit:cover;border-radius:10px;margin:8px 0 12px}
.prose a.maps-link{display:inline-block;font-weight:700;font-size:1.05em;color:#0b6b3a;background:#e6f6ec;border:1px solid #bfe3cc;border-radius:8px;padding:4px 12px;text-decoration:none;margin:2px 0}
.prose a.maps-link:hover{background:#d3efdd}
.prose table{font-size:.92em;margin:1em 0}.prose th,.prose td{border:1px solid #e2e8f0;padding:6px 10px}.prose th{background:#f1f5f9}
.flag{background:#fee2e2;border-left:3px solid var(--err);padding:6px 10px;border-radius:6px;margin-bottom:6px;font-size:.9rem}
.flag .score{font-weight:700;color:var(--err);margin-right:6px}
.issue{padding:6px 0;border-bottom:1px dashed var(--line);font-size:.9rem}
.issue:last-child{border-bottom:0}
.score{font-size:1.3rem;font-weight:700}
.score.good{color:var(--ok)}.score.bad{color:var(--err)}.score.na{color:var(--muted)}
.hint{font-size:.8rem;color:var(--muted);margin-top:4px}
.section-edit{border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin-bottom:10px;background:#fafafa}
.copybtn{float:right}
`;
