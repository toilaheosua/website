import path from 'node:path';
import type { Hono } from 'hono';
import type { AppConfig } from '../config.js';
import type { Db, Site } from '../db/index.js';
import { createRenderContext } from '../generator/builder.js';
import { renderPage } from '../generator/templates.js';
import { siteCss } from '../generator/site-css.js';
import { BLOCK_DEFS, BLOCK_TYPES, defaultHomeLayout, normalizeLayout, type SiteLayout } from '../generator/layout.js';
import { FONT_PAIRS, PALETTES, RADIUS_CHOICES, applyThemeTweaks, fontPairIndex, type ThemeTweaks } from '../generator/themes.js';
import { errorMessage } from '../core/util.js';
import { Badge } from './layout.js';
import { rewriteHtmlForDashboard } from './editor.js';

/* ------------------------------------------------------------------ */
/*  Trang thiết kế: danh sách khối kéo thả + tùy chỉnh giao diện + xem trước */
/* ------------------------------------------------------------------ */

export function DesignPage(props: { site: Site; data: unknown }) {
  const { site } = props;
  return (
    <>
      <div class="actions" style="justify-content:space-between;margin-bottom:10px">
        <div>
          <h1 style="margin:0">
            Thiết kế trang chủ: {site.domain} <Badge status={site.status} />
          </h1>
          <div class="muted small">Kéo thả để đổi thứ tự khối, bấm vào khối để chỉnh, thêm hoặc xóa khối, đổi màu và font. Xem trước cập nhật ngay; bấm "Lưu và dựng lại" để đưa lên website.</div>
        </div>
        <div class="actions">
          <a class="btn secondary sm" href={`/sites/${site.id}/editor`}>
            Sửa chữ và ảnh
          </a>
          <a class="btn secondary sm" href={`/sites/${site.id}/library`}>
            Kho ảnh
          </a>
          <a class="btn secondary sm" href={`/sites/${site.id}`}>
            ← Site
          </a>
        </div>
      </div>
      <script id="design-data" type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify(props.data).replace(/</g, '\\u003c') }}></script>
      <style dangerouslySetInnerHTML={{ __html: DESIGN_CSS }}></style>
      <div id="design-app">
        <div id="design-side">
          <div class="dz-toolbar">
            <button class="btn sm" id="dz-save" type="button" disabled>
              Lưu và dựng lại
            </button>
            <span class="small muted" id="dz-status">Chưa có thay đổi</span>
          </div>
          <details open>
            <summary>Các khối trên trang chủ</summary>
            <div id="dz-blocks"></div>
            <div class="dz-add">
              <select id="dz-add-type"></select>
              <button class="btn secondary sm" type="button" id="dz-add">
                + Thêm khối
              </button>
            </div>
            <div class="help">Kéo thả khối để đổi thứ tự. Khối "Mục nội dung AI viết" lấy chữ từ nội dung trang chủ, sửa chữ ở "Sửa chữ và ảnh".</div>
          </details>
          <details>
            <summary>Màu sắc, font và kiểu hiển thị</summary>
            <div id="dz-theme"></div>
          </details>
          <details>
            <summary>Đặt lại</summary>
            <div class="help">Bỏ bố cục tùy chỉnh, quay về bố cục mặc định theo theme của site.</div>
            <button class="btn secondary sm" type="button" id="dz-reset">
              Về bố cục mặc định
            </button>
          </details>
        </div>
        <div id="design-preview">
          <div class="dz-preview-bar">
            <span>Xem trước</span>
            <span class="muted small" id="dz-preview-status"></span>
            <span style="margin-left:auto">
              <button type="button" class="btn secondary sm" data-w="100%">
                Máy tính
              </button>
              <button type="button" class="btn secondary sm" data-w="390px">
                Điện thoại
              </button>
            </span>
          </div>
          <iframe id="dz-frame" title="Xem trước trang chủ"></iframe>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: DESIGN_JS }}></script>
    </>
  );
}

const DESIGN_CSS = `
#design-app{display:grid;grid-template-columns:400px 1fr;gap:14px;align-items:start}
#design-side{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px;position:sticky;top:70px;max-height:calc(100vh - 90px);overflow:auto}
#design-side details{border-top:1px solid var(--line);padding:8px 0}
#design-side details summary{cursor:pointer;font-weight:700;padding:4px 0}
.dz-toolbar{display:flex;align-items:center;gap:10px;padding-bottom:10px}
.dz-block{border:1px solid var(--line);border-radius:8px;margin:8px 0;background:#fff}
.dz-block.hidden{opacity:.55}
.dz-block.drag-over{border-color:var(--primary);box-shadow:0 0 0 2px rgba(37,99,235,.25)}
.dz-block.dragging{opacity:.4}
.dz-head{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:grab}
.dz-head .handle{color:var(--muted);font-size:18px;line-height:1}
.dz-head .title{flex:1;font-weight:600;font-size:.92rem}
.dz-head .sub{color:var(--muted);font-size:.78rem;display:block;font-weight:400}
.dz-head button{border:1px solid var(--line);background:#fff;border-radius:6px;padding:3px 7px;cursor:pointer;font-size:.8rem}
.dz-head button.danger{color:#b91c1c}
.dz-body{display:none;padding:6px 10px 12px;border-top:1px solid var(--line);background:var(--bg)}
.dz-block.open .dz-body{display:block}
.dz-body label{display:block;font-size:.82rem;font-weight:600;margin:8px 0 3px}
.dz-body input[type=text],.dz-body select,.dz-body textarea,.dz-body input[type=number]{width:100%;padding:6px 8px;border:1px solid var(--line);border-radius:6px;font-size:.88rem;box-sizing:border-box}
.dz-body textarea{min-height:110px;font-family:ui-monospace,Consolas,monospace}
.dz-body .help{font-size:.76rem;color:var(--muted);margin-top:2px}
.dz-pick{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.dz-pick img{width:64px;height:48px;object-fit:cover;border-radius:5px;border:2px solid transparent;cursor:pointer}
.dz-pick img.on{border-color:var(--primary)}
.dz-add{display:flex;gap:8px;margin-top:8px}
.dz-add select{flex:1}
#dz-theme label{display:block;font-size:.82rem;font-weight:600;margin:8px 0 3px}
#dz-theme select{width:100%;padding:6px 8px;border:1px solid var(--line);border-radius:6px}
.dz-colors{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px}
.dz-colors label{display:flex;align-items:center;gap:8px;font-weight:500;margin:4px 0}
.dz-colors input[type=color]{width:36px;height:28px;border:1px solid var(--line);border-radius:6px;padding:0;background:#fff}
.dz-palettes{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.dz-palettes button{border:1px solid var(--line);border-radius:6px;padding:3px;background:#fff;cursor:pointer;display:flex;gap:2px}
.dz-palettes i{display:block;width:14px;height:18px;border-radius:3px}
#design-preview{background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.dz-preview-bar{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line);font-weight:600}
#dz-frame{width:100%;height:calc(100vh - 150px);border:0;display:block;margin:0 auto;background:#fff;transition:width .2s}
@media (max-width:1000px){#design-app{grid-template-columns:1fr}#design-side{position:static;max-height:none}}
`;

const DESIGN_JS = String.raw`
(function(){
  var D = JSON.parse(document.getElementById('design-data').textContent);
  var layout = D.layout;
  var theme = D.theme;
  var dirty = false;
  var openId = null;
  var api = D.api;
  var $ = function(id){ return document.getElementById(id); };
  function el(tag, attrs, html){ var e=document.createElement(tag); for (var k in (attrs||{})) e.setAttribute(k, attrs[k]); if (html!=null) e.innerHTML=html; return e; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function markDirty(){ dirty = true; $('dz-save').disabled = false; $('dz-status').textContent = 'Có thay đổi chưa lưu'; schedulePreview(); }

  /* ---------- xem trước ---------- */
  var previewTimer = null, previewSeq = 0;
  function schedulePreview(){ clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 350); }
  function renderPreview(){
    var seq = ++previewSeq;
    $('dz-preview-status').textContent = 'Đang dựng...';
    fetch(api + '/preview', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ layout: layout, theme: theme }) })
      .then(function(r){ return r.text().then(function(t){ return { ok: r.ok, text: t }; }); })
      .then(function(res){
        if (seq !== previewSeq) return;
        if (!res.ok) { $('dz-preview-status').textContent = 'Lỗi: ' + res.text.slice(0, 200); return; }
        var f = $('dz-frame'); var y = 0; try { y = f.contentWindow.scrollY; } catch(e) {}
        f.srcdoc = res.text;
        f.onload = function(){ try { f.contentWindow.scrollTo(0, y); } catch(e) {} };
        $('dz-preview-status').textContent = '';
      })
      .catch(function(err){ $('dz-preview-status').textContent = 'Lỗi mạng: ' + err; });
  }

  /* ---------- mô tả khối ---------- */
  function blockSummary(b){
    var p = b.props || {};
    switch (b.type) {
      case 'content': { var s = D.sections[p.section]; if (s) return s; return p.layout === 'why' ? 'Điểm khác biệt (danh sách từ kế hoạch, không kèm mục chữ)' : 'Mục không còn tồn tại (chọn mục khác hoặc xóa khối)'; }
      case 'text': return p.heading || (p.body ? String(p.body).slice(0, 60) : 'Chưa có nội dung');
      case 'image_text': return p.heading || 'Ảnh + chữ';
      case 'gallery': return ((p.images||[]).length) + ' ảnh';
      case 'cta': return p.heading || D.plan.ctaPrimary;
      case 'posts': return (p.heading || 'Bài viết mới') + ' · ' + (p.count || 3) + ' bài';
      case 'hero': return D.h1;
      default: return p.heading || '';
    }
  }

  function fieldInput(b, f){
    var v = (b.props||{})[f.key];
    var wrap = el('div');
    wrap.appendChild(el('label', {}, esc(f.label)));
    var input;
    if (f.type === 'text') { input = el('input', {type:'text', value: v==null?'':v}); }
    else if (f.type === 'number') { input = el('input', {type:'number', value: v==null?(f.default==null?'':f.default):v, min:'1', max:'12'}); }
    else if (f.type === 'textarea') { input = el('textarea'); input.value = v==null?'':v; }
    else if (f.type === 'checkbox') { input = el('input', {type:'checkbox'}); input.checked = v === undefined ? !!f.default : !!v; wrap.innerHTML = ''; var lb = el('label', {style:'display:flex;gap:8px;align-items:center;font-weight:500'}); lb.appendChild(input); lb.appendChild(document.createTextNode(' ' + f.label)); wrap.appendChild(lb); }
    else if (f.type === 'select') { input = el('select'); f.options.forEach(function(o){ var op = el('option', {value:o.value}, esc(o.label)); if (String(v==null?f.default:v) === o.value) op.selected = true; input.appendChild(op); }); }
    else if (f.type === 'section') { input = el('select'); var none = el('option', {value:'-1'}, 'Không dùng mục chữ (chỉ hợp với kiểu Điểm khác biệt)'); if (Number(v) === -1 || v == null) none.selected = true; input.appendChild(none); D.sections.forEach(function(h, i){ var op = el('option', {value:String(i)}, esc((i+1) + '. ' + h)); if (Number(v) === i) op.selected = true; input.appendChild(op); }); }
    else if (f.type === 'image' || f.type === 'images') {
      input = null;
      var pick = el('div', {class:'dz-pick'});
      var multi = f.type === 'images';
      var sel = multi ? (Array.isArray(v) ? v.map(Number) : []) : (v ? [Number(v)] : []);
      if (!D.library.length) pick.appendChild(el('div', {class:'help'}, 'Kho ảnh trống. Tải ảnh ở mục Kho ảnh.'));
      D.library.forEach(function(l){
        var im = el('img', {src:l.url, alt:l.alt, title:l.alt});
        if (sel.indexOf(l.id) >= 0) im.className = 'on';
        im.onclick = function(){
          if (multi) { var i = sel.indexOf(l.id); if (i >= 0) sel.splice(i, 1); else sel.push(l.id); b.props[f.key] = sel.slice(); }
          else { sel = sel[0] === l.id ? [] : [l.id]; b.props[f.key] = sel[0] || null; }
          pick.querySelectorAll('img').forEach(function(x){ x.className = ''; });
          D.library.forEach(function(ll, j){ if (sel.indexOf(ll.id) >= 0) pick.querySelectorAll('img')[j].className = 'on'; });
          markDirty(); refreshTitle(b);
        };
        pick.appendChild(im);
      });
      wrap.appendChild(pick);
    }
    if (input) {
      input.addEventListener('input', function(){
        b.props[f.key] = f.type === 'checkbox' ? input.checked : f.type === 'number' ? Number(input.value) : input.value;
        markDirty(); refreshTitle(b);
      });
      if (f.type !== 'checkbox') wrap.appendChild(input);
    }
    if (f.help) wrap.appendChild(el('div', {class:'help'}, esc(f.help)));
    return wrap;
  }

  function refreshTitle(b){ var n = document.querySelector('[data-id="' + b.id + '"] .sub'); if (n) n.textContent = blockSummary(b); }

  /* ---------- danh sách khối ---------- */
  function renderBlocks(){
    var host = $('dz-blocks'); host.innerHTML = '';
    layout.forEach(function(b, idx){
      var def = D.defs[b.type];
      var row = el('div', {class:'dz-block' + (b.hidden ? ' hidden' : '') + (openId === b.id ? ' open' : ''), draggable:'true', 'data-id': b.id});
      var head = el('div', {class:'dz-head'});
      head.appendChild(el('span', {class:'handle', title:'Kéo để đổi thứ tự'}, '⋮⋮'));
      var t = el('div', {class:'title'}); t.innerHTML = esc(def.label) + '<span class="sub">' + esc(blockSummary(b)) + '</span>'; head.appendChild(t);
      var bUp = el('button', {type:'button', title:'Lên'}, '↑'); bUp.onclick = function(e){ e.stopPropagation(); if (idx > 0) { layout.splice(idx-1, 0, layout.splice(idx, 1)[0]); markDirty(); renderBlocks(); } };
      var bDown = el('button', {type:'button', title:'Xuống'}, '↓'); bDown.onclick = function(e){ e.stopPropagation(); if (idx < layout.length-1) { layout.splice(idx+1, 0, layout.splice(idx, 1)[0]); markDirty(); renderBlocks(); } };
      var bHide = el('button', {type:'button', title: b.hidden ? 'Hiện khối' : 'Ẩn khối'}, b.hidden ? 'Hiện' : 'Ẩn'); bHide.onclick = function(e){ e.stopPropagation(); b.hidden = !b.hidden; markDirty(); renderBlocks(); };
      var bDel = el('button', {type:'button', class:'danger', title:'Xóa khối'}, '✕'); bDel.onclick = function(e){ e.stopPropagation(); if (b.type === 'hero') { alert('Khối đầu trang không xóa được, chỉ đổi kiểu hoặc ẩn nút.'); return; } if (!confirm('Xóa khối "' + def.label + '"?')) return; layout.splice(idx, 1); markDirty(); renderBlocks(); };
      head.appendChild(bUp); head.appendChild(bDown); head.appendChild(bHide); head.appendChild(bDel);
      head.onclick = function(){ openId = openId === b.id ? null : b.id; renderBlocks(); };
      row.appendChild(head);
      var body = el('div', {class:'dz-body'});
      body.appendChild(el('div', {class:'help', style:'margin-bottom:4px'}, esc(def.description)));
      def.fields.forEach(function(f){ body.appendChild(fieldInput(b, f)); });
      body.onclick = function(e){ e.stopPropagation(); };
      row.appendChild(body);
      // kéo thả
      row.addEventListener('dragstart', function(e){ e.dataTransfer.setData('text/plain', b.id); e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
      row.addEventListener('dragend', function(){ row.classList.remove('dragging'); });
      row.addEventListener('dragover', function(e){ e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('drag-over'); });
      row.addEventListener('dragleave', function(){ row.classList.remove('drag-over'); });
      row.addEventListener('drop', function(e){
        e.preventDefault(); row.classList.remove('drag-over');
        var fromId = e.dataTransfer.getData('text/plain'); if (!fromId || fromId === b.id) return;
        var from = layout.findIndex(function(x){ return x.id === fromId; }); var to = layout.findIndex(function(x){ return x.id === b.id; });
        if (from < 0 || to < 0) return;
        var moved = layout.splice(from, 1)[0]; layout.splice(to, 0, moved); markDirty(); renderBlocks();
      });
      host.appendChild(row);
    });
  }

  /* ---------- thêm khối ---------- */
  var addSel = $('dz-add-type');
  D.types.forEach(function(t){ addSel.appendChild(el('option', {value:t}, esc(D.defs[t].label))); });
  $('dz-add').onclick = function(){
    var type = addSel.value; var def = D.defs[type];
    if (def.single && layout.some(function(b){ return b.type === type; })) { alert('Trang chủ đã có khối "' + def.label + '".'); return; }
    var props = {}; def.fields.forEach(function(f){ if (f.default !== undefined) props[f.key] = f.default; if (f.type === 'images') props[f.key] = []; });
    if (type === 'content') { var used = layout.filter(function(b){ return b.type === 'content'; }).map(function(b){ return Number(b.props.section); }); var free = D.sections.findIndex(function(_, i){ return used.indexOf(i) < 0; }); props.section = free >= 0 ? free : 0; }
    var b = { id: type + '-' + Date.now().toString(36), type: type, hidden: false, props: props };
    // chèn trước dải kêu gọi cuối cùng nếu có, để khối mới không rơi xuống dưới CTA
    var ctaIdx = layout.map(function(x){ return x.type; }).lastIndexOf('cta');
    if (ctaIdx > 0 && ctaIdx === layout.length - 1) layout.splice(ctaIdx, 0, b); else layout.push(b);
    openId = b.id; markDirty(); renderBlocks();
    var node = document.querySelector('[data-id="' + b.id + '"]'); if (node) node.scrollIntoView({ block: 'nearest' });
  };

  /* ---------- giao diện: màu, font, kiểu ---------- */
  function renderTheme(){
    var host = $('dz-theme'); host.innerHTML = '';
    host.appendChild(el('label', {}, 'Bảng màu có sẵn'));
    var pals = el('div', {class:'dz-palettes'});
    D.palettes.forEach(function(p){
      var btn = el('button', {type:'button', title:'Áp dụng bảng màu này'});
      ['primary','accent','surface','text'].forEach(function(k){ var i = el('i'); i.style.background = p[k]; btn.appendChild(i); });
      btn.onclick = function(){ theme.palette = Object.assign({}, p); markDirty(); renderTheme(); };
      pals.appendChild(btn);
    });
    host.appendChild(pals);
    host.appendChild(el('label', {}, 'Tùy chỉnh từng màu'));
    var colors = el('div', {class:'dz-colors'});
    [['primary','Màu chính'],['primaryDark','Màu chính đậm'],['accent','Màu nhấn (nút)'],['bg','Nền trang'],['surface','Nền mục xám'],['text','Chữ'],['muted','Chữ phụ']].forEach(function(pair){
      var lb = el('label'); var inp = el('input', {type:'color', value: theme.palette[pair[0]]});
      inp.addEventListener('input', function(){ theme.palette[pair[0]] = inp.value; markDirty(); });
      lb.appendChild(inp); lb.appendChild(document.createTextNode(pair[1])); colors.appendChild(lb);
    });
    host.appendChild(colors);
    host.appendChild(el('label', {}, 'Cặp font (tiêu đề / nội dung)'));
    var fsel = el('select'); D.fonts.forEach(function(fp, i){ var op = el('option', {value:String(i)}, esc(fp.heading.replace(/['"]/g,'').split(',')[0] + ' / ' + fp.body.replace(/['"]/g,'').split(',')[0])); if (i === theme.fontPair) op.selected = true; fsel.appendChild(op); });
    fsel.onchange = function(){ theme.fontPair = Number(fsel.value); markDirty(); }; host.appendChild(fsel);
    function sel(label, key, opts){ host.appendChild(el('label', {}, label)); var s = el('select'); opts.forEach(function(o){ var op = el('option', {value:o[0]}, esc(o[1])); if (theme[key] === o[0]) op.selected = true; s.appendChild(op); }); s.onchange = function(){ theme[key] = s.value; markDirty(); }; host.appendChild(s); }
    sel('Bo góc', 'radius', D.radius.map(function(r){ return [r, r === '999px' ? 'Tròn hoàn toàn' : r === '0px' ? 'Vuông' : r]; }));
    sel('Kiểu header', 'headerStyle', [['left','Logo trái, menu phải'],['center','Căn giữa'],['split','Logo trái, menu phải (rộng)']]);
    sel('Kiểu đầu trang mặc định', 'heroStyle', [['image-bg','Ảnh nền toàn khung'],['split','Chữ trái, ảnh phải'],['minimal','Tối giản']]);
    sel('Kiểu thẻ (dịch vụ, bài viết)', 'cardStyle', [['shadow','Đổ bóng'],['flat','Phẳng'],['outline','Viền mảnh']]);
  }

  /* ---------- lưu, đặt lại, xem trước di động ---------- */
  $('dz-save').onclick = function(){
    $('dz-save').disabled = true; $('dz-status').textContent = 'Đang lưu...';
    fetch(api, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ layout: layout, theme: theme }) })
      .then(function(r){ return r.json(); })
      .then(function(j){ if (!j.ok) { $('dz-status').textContent = 'Lỗi: ' + j.message; $('dz-save').disabled = false; return; } dirty = false; $('dz-status').textContent = j.message; })
      .catch(function(err){ $('dz-status').textContent = 'Lỗi mạng: ' + err; $('dz-save').disabled = false; });
  };
  $('dz-reset').onclick = function(){
    if (!confirm('Bỏ bố cục tùy chỉnh và quay về mặc định? (màu và font giữ nguyên cho đến khi bạn lưu)')) return;
    layout = JSON.parse(JSON.stringify(D.defaultLayout)); openId = null; markDirty(); renderBlocks();
  };
  document.querySelectorAll('.dz-preview-bar [data-w]').forEach(function(b){ b.onclick = function(){ $('dz-frame').style.width = b.getAttribute('data-w'); }; });
  window.addEventListener('beforeunload', function(e){ if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  renderBlocks(); renderTheme(); renderPreview();
})();
`;

/* ------------------------------------------------------------------ */
/*  Route                                                               */
/* ------------------------------------------------------------------ */

export interface DesignDeps {
  db: Db;
  config: AppConfig;
  siteOr404: (c: { req: { param: (k: string) => string | undefined } }) => Site | undefined;
  render: (c: never, title: string, active: string, body: unknown) => Response | Promise<Response>;
  enqueueRebuild: (siteId: number) => void;
}

function themeForm(site: Site) {
  const t = site.theme!;
  return { palette: { ...t.palette }, fontPair: fontPairIndex(t), radius: t.radius, headerStyle: t.headerStyle, heroStyle: t.heroStyle, cardStyle: t.cardStyle };
}

function parseThemeTweaks(raw: unknown): ThemeTweaks {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const palette = (t.palette && typeof t.palette === 'object' ? t.palette : {}) as Record<string, unknown>;
  const pal: Record<string, string> = {};
  for (const [k, v] of Object.entries(palette)) if (typeof v === 'string') pal[k] = v;
  return {
    palette: pal,
    fontPair: typeof t.fontPair === 'number' ? t.fontPair : undefined,
    radius: typeof t.radius === 'string' ? t.radius : undefined,
    headerStyle: typeof t.headerStyle === 'string' ? (t.headerStyle as ThemeTweaks['headerStyle']) : undefined,
    heroStyle: typeof t.heroStyle === 'string' ? (t.heroStyle as ThemeTweaks['heroStyle']) : undefined,
    cardStyle: typeof t.cardStyle === 'string' ? (t.cardStyle as ThemeTweaks['cardStyle']) : undefined,
  };
}

export function mountDesign(app: Hono, deps: DesignDeps): void {
  const { db, config } = deps;

  const homeOf = (site: Site) => db.listPages(site.id).find((p) => p.kind === 'home' && (p.status === 'published' || p.status === 'needs_review'));

  app.get('/sites/:id/design', (c) => {
    const site = deps.siteOr404(c);
    if (!site) return c.notFound();
    const home = homeOf(site);
    if (!site.plan || !site.theme || !home) return c.text('Site chưa có trang chủ để thiết kế. Chờ bước "Viết nội dung" hoàn tất.', 400);
    const prefix = `/sites/${site.id}`;
    const hasPosts = db.listPages(site.id).some((p) => p.kind === 'post' && p.status === 'published');
    const defaultLayout = defaultHomeLayout(site.theme, home.content, site.plan, site.brief.siteType, hasPosts);
    const data = {
      api: `${prefix}/design`,
      layout: site.layout?.home?.length ? site.layout.home : defaultLayout,
      defaultLayout,
      theme: themeForm(site),
      defs: BLOCK_DEFS,
      types: BLOCK_TYPES,
      sections: home.content.sections.map((s) => s.heading),
      h1: home.content.h1,
      plan: { ctaPrimary: site.plan.ctaPrimary, tagline: site.plan.tagline },
      library: db.listLibrary(site.id).map((l) => ({ id: l.id, url: `${prefix}/images/file/${path.basename(l.file)}`, alt: l.alt })),
      palettes: PALETTES,
      fonts: FONT_PAIRS.map((f) => ({ heading: f.heading, body: f.body })),
      radius: RADIUS_CHOICES,
    };
    return deps.render(c as never, `Thiết kế ${site.domain}`, 'sites', DesignPage({ site, data }));
  });

  /** Dựng trang chủ với bố cục và giao diện đang chỉnh (chưa lưu) để xem trước. */
  app.post('/sites/:id/design/preview', async (c) => {
    const site = deps.siteOr404(c);
    if (!site || !site.theme) return c.text('Không tìm thấy site', 404);
    const home = homeOf(site);
    if (!home) return c.text('Chưa có trang chủ', 400);
    const body = (await c.req.json().catch(() => ({}))) as { layout?: unknown; theme?: unknown };
    try {
      const layout: SiteLayout = normalizeLayout({ home: Array.isArray(body.layout) ? body.layout : [] });
      const theme = applyThemeTweaks(site.theme, parseThemeTweaks(body.theme));
      const { ctx } = await createRenderContext({ db, site, sitesDir: config.sitesDir, uploadsDir: config.uploadsDir, themeOverride: theme, layoutOverride: layout });
      let html = renderPage(ctx, home);
      html = rewriteHtmlForDashboard(html, site.id);
      // CSS theo theme đang chỉnh, nhúng thẳng để không phụ thuộc route style.css (dùng theme đã lưu)
      html = html.replace(/<link rel="stylesheet" href="[^"]*editor\/style\.css"[^>]*>/, `<style>${siteCss(theme)}</style>`);
      return c.body(html, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    } catch (err) {
      return c.text(`Không dựng được: ${errorMessage(err)}`, 400);
    }
  });

  app.post('/sites/:id/design', async (c) => {
    const site = deps.siteOr404(c);
    if (!site || !site.theme) return c.json({ ok: false, message: 'Không tìm thấy site' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { layout?: unknown; theme?: unknown };
    try {
      const layout = normalizeLayout({ home: Array.isArray(body.layout) ? body.layout : [] });
      const theme = applyThemeTweaks(site.theme, parseThemeTweaks(body.theme));
      db.updateSite(site.id, { layout, theme });
      db.addLog({ site_id: site.id, step: 'design', level: 'info', message: `Thiết kế trang chủ: ${layout.home.length} khối (${layout.home.filter((b) => !b.hidden).length} hiện), theme cập nhật` });
      if (site.plan && site.site_path) deps.enqueueRebuild(site.id);
      return c.json({ ok: true, message: `Đã lưu ${layout.home.length} khối và giao diện, đang dựng lại và đưa lên host.` });
    } catch (err) {
      return c.json({ ok: false, message: errorMessage(err) }, 400);
    }
  });
}
