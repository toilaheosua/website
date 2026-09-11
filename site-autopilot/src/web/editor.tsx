import path from 'node:path';
import type { Hono } from 'hono';
import type { AppConfig } from '../config.js';
import type { Db, Site } from '../db/index.js';
import { createRenderContext } from '../generator/builder.js';
import { renderPage } from '../generator/templates.js';
import { siteCss, SITE_JS } from '../generator/site-css.js';
import { mdToHtml } from '../generator/markdown.js';
import { applyEdits, collectEditableFields } from '../generator/edit-paths.js';
import { saveLibraryImage } from '../generator/library.js';
import { siteDirs } from '../generator/builder.js';
import { errorMessage } from '../core/util.js';
import { Badge } from './layout.js';

/* ------------------------------------------------------------------ */
/*  Trang dashboard: chọn trang + iframe                                 */
/* ------------------------------------------------------------------ */

export function EditorPage(props: { site: Site; pages: { id: number; title: string; slug: string; kind: string }[]; current: number }) {
  const { site } = props;
  return (
    <>
      <div class="actions" style="justify-content:space-between;margin-bottom:10px">
        <div>
          <h1 style="margin:0">
            Chỉnh sửa trực quan: {site.domain} <Badge status={site.status} />
          </h1>
          <div class="muted small">Nhấp vào tiêu đề, đoạn văn, câu hỏi hay ảnh ngay trên trang để sửa. Xong bấm "Lưu và dựng lại" trên thanh công cụ trong trang.</div>
        </div>
        <div class="actions">
          <select id="editor-page" style="width:auto" onchange={`location.href='/sites/${site.id}/editor?page='+this.value`}>
            {props.pages.map((p) => (
              <option value={String(p.id)} selected={p.id === props.current}>
                {p.kind === 'post' ? 'Bài: ' : ''}
                {p.title}
              </option>
            ))}
          </select>
          <a class="btn secondary sm" href={`/sites/${site.id}/library`}>
            Kho ảnh
          </a>
          <a class="btn secondary sm" href={`/sites/${site.id}`}>
            ← Site
          </a>
        </div>
      </div>
      <iframe src={`/sites/${site.id}/editor/page/${props.current}`} style="width:100%;height:calc(100vh - 150px);border:1px solid var(--line);border-radius:10px;background:#fff" title="Chỉnh sửa trực quan"></iframe>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Script và CSS nhúng vào trang đang sửa                              */
/* ------------------------------------------------------------------ */

const EDITOR_CSS = `
[data-edit],[data-edit-md]{outline:1px dashed rgba(37,99,235,.45);outline-offset:3px;cursor:text;transition:outline-color .1s}
[data-edit]:hover,[data-edit-md]:hover{outline:2px solid #2563eb}
[data-edit][contenteditable=true],[data-edit][contenteditable=plaintext-only]{outline:2px solid #16a34a;background:rgba(22,163,74,.06)}
[data-edit-img]{cursor:pointer;outline:2px dashed rgba(249,115,22,.7);outline-offset:-2px}
[data-edit-img]:hover{outline:3px solid #f97316}
.edit-img-placeholder{display:flex;align-items:center;justify-content:center;min-height:160px;background:repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 10px,#e5e7eb 10px,#e5e7eb 20px);color:#6b7280;font:600 14px system-ui;border-radius:8px}
.sa-changed{box-shadow:0 0 0 3px rgba(22,163,74,.35)}
body{padding-top:52px!important}
.site-header{top:52px!important}
#sa-toolbar{position:fixed;top:0;left:0;right:0;height:52px;background:#111827;color:#fff;display:flex;align-items:center;gap:10px;padding:0 14px;z-index:99999;font:14px system-ui,-apple-system,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25)}
#sa-toolbar .t{font-weight:700}
#sa-toolbar .st{opacity:.85;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#sa-toolbar button{border:0;border-radius:8px;padding:8px 14px;font:600 13px system-ui;cursor:pointer;background:#374151;color:#fff}
#sa-toolbar button.p{background:#2563eb}
#sa-toolbar button:disabled{opacity:.5;cursor:default}
#sa-panel{position:fixed;top:52px;right:0;bottom:0;width:min(440px,100%);background:#fff;color:#111827;border-left:1px solid #e5e7eb;box-shadow:-4px 0 20px rgba(0,0,0,.12);z-index:99998;display:none;flex-direction:column;font:14px system-ui,-apple-system,sans-serif}
#sa-panel.open{display:flex}
#sa-panel .hd{padding:12px 16px;border-bottom:1px solid #e5e7eb;font-weight:700;display:flex;justify-content:space-between;align-items:center}
#sa-panel .bd{padding:14px 16px;overflow:auto;flex:1}
#sa-panel textarea{width:100%;min-height:260px;font:13px ui-monospace,Consolas,monospace;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}
#sa-panel input[type=text]{width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;font:14px system-ui}
#sa-panel label{display:block;font-weight:600;margin:10px 0 4px}
#sa-panel .help{color:#6b7280;font-size:12px;margin-top:4px}
#sa-panel .ft{padding:12px 16px;border-top:1px solid #e5e7eb;display:flex;gap:8px;flex-wrap:wrap}
#sa-panel button{border:1px solid #d1d5db;border-radius:8px;padding:8px 14px;font:600 13px system-ui;cursor:pointer;background:#fff;color:#111827}
#sa-panel button.p{background:#2563eb;color:#fff;border-color:#2563eb}
#sa-panel button.d{color:#dc2626}
#sa-lib{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
#sa-lib img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;cursor:pointer;border:2px solid transparent}
#sa-lib img:hover{border-color:#2563eb}
`;

const EDITOR_JS = String.raw`
(function(){
  var D = JSON.parse(document.getElementById('sa-edit-data').textContent);
  var changes = { page: {}, plan: {}, images: {} };
  var dirty = false;
  var api = D.api;

  function el(tag, attrs, html){ var e=document.createElement(tag); for(var k in (attrs||{})) e.setAttribute(k, attrs[k]); if(html!=null) e.innerHTML=html; return e; }
  function setStatus(t){ document.getElementById('sa-status').textContent = t; }
  function markDirty(){ dirty = true; document.getElementById('sa-save').disabled = false; setStatus('Có thay đổi chưa lưu'); }
  function record(path, value){ if(path.indexOf('plan.')===0) changes.plan[path.slice(5)] = value; else changes.page[path] = value; markDirty(); }
  function current(path){ if(path.indexOf('plan.')===0){ var k=path.slice(5); return (k in changes.plan)? changes.plan[k] : (D.fields.plan[k]||''); } return (path in changes.page)? changes.page[path] : (D.fields.page[path]||''); }

  // Thanh công cụ
  var tb = el('div',{id:'sa-toolbar'});
  tb.appendChild(el('span',{class:'t'},'Chỉnh sửa trực quan'));
  tb.appendChild(el('span',{class:'st',id:'sa-status'},'Nhấp vào chữ hoặc ảnh để sửa'));
  var bSeo = el('button',{},'Tiêu đề & mô tả SEO'); tb.appendChild(bSeo);
  var bSave = el('button',{class:'p',id:'sa-save',disabled:''},'Lưu và dựng lại'); tb.appendChild(bSave);
  document.body.appendChild(tb);

  // Bảng bên phải
  var panel = el('div',{id:'sa-panel'});
  panel.innerHTML = '<div class="hd"><span id="sa-panel-title"></span><button id="sa-panel-close">Đóng</button></div><div class="bd" id="sa-panel-body"></div><div class="ft" id="sa-panel-foot"></div>';
  document.body.appendChild(panel);
  function openPanel(title, bodyNode, buttons){ document.getElementById('sa-panel-title').textContent=title; var b=document.getElementById('sa-panel-body'); b.innerHTML=''; b.appendChild(bodyNode); var f=document.getElementById('sa-panel-foot'); f.innerHTML=''; (buttons||[]).forEach(function(x){ f.appendChild(x); }); panel.classList.add('open'); }
  function closePanel(){ panel.classList.remove('open'); }
  document.getElementById('sa-panel-close').onclick = closePanel;

  // Chữ thuần: sửa tại chỗ
  document.querySelectorAll('[data-edit]').forEach(function(node){
    node.addEventListener('click', function(e){
      if(node.getAttribute('contenteditable')) return;
      e.preventDefault(); e.stopPropagation();
      try { node.contentEditable = 'plaintext-only'; } catch(err) { node.contentEditable = 'true'; }
      node.focus();
      var before = node.textContent;
      // Chọn sẵn toàn bộ chữ: gõ là thay, nhấp lần nữa để đặt con trỏ
      try { var rg = document.createRange(); rg.selectNodeContents(node); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rg); } catch(err) {}
      setStatus('Đang sửa: gõ chữ mới, Enter để xong, Esc để hủy');
      function done(){ node.contentEditable = 'false'; node.removeAttribute('contenteditable'); var v = node.textContent.replace(/\s+/g,' ').trim(); if(v !== before.trim()){ record(node.getAttribute('data-edit'), v); node.classList.add('sa-changed'); } node.removeEventListener('blur', done); }
      node.addEventListener('blur', done);
      node.addEventListener('keydown', function(k){ if(k.key==='Enter'){ k.preventDefault(); node.blur(); } if(k.key==='Escape'){ node.textContent = before; node.blur(); } });
    });
  });

  // Markdown: sửa trong bảng bên phải
  document.querySelectorAll('[data-edit-md]').forEach(function(node){
    node.addEventListener('click', function(e){
      if(e.target.closest('a')) { e.preventDefault(); }
      e.stopPropagation();
      var p = node.getAttribute('data-edit-md');
      var wrap = el('div');
      wrap.appendChild(el('div',{class:'help'},'Markdown: đoạn văn cách nhau dòng trống, "- " cho danh sách, **in đậm**, "> **Mẹo:** ..." cho khung lưu ý, [chữ](/duong-dan/) cho liên kết.'));
      var ta = el('textarea'); ta.value = current(p); wrap.appendChild(ta);
      var bApply = el('button',{class:'p'},'Áp dụng');
      bApply.onclick = function(){
        var md = ta.value;
        fetch(api + '/render-md', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({md: md})}).then(function(r){return r.json();}).then(function(j){
          node.innerHTML = j.html; record(p, md); node.classList.add('sa-changed'); closePanel();
        });
      };
      openPanel('Sửa đoạn nội dung', wrap, [bApply, el('button',{onclick:''},'Hủy')]);
      document.getElementById('sa-panel-foot').lastChild.onclick = closePanel;
    });
  });

  // Ảnh: chọn từ kho, tải mới, bỏ ảnh
  function applyImage(node, key, url){
    if(node.tagName === 'IMG'){ node.src = url; node.removeAttribute('width'); node.removeAttribute('height'); }
    else { var img = el('img',{src:url, alt:'', 'data-edit-img':key, loading:'lazy'}); img.style.maxWidth='100%'; node.replaceWith(img); bindImage(img); node = img; }
    node.classList.add('sa-changed');
  }
  function bindImage(node){
    node.addEventListener('click', function(e){
      e.preventDefault(); e.stopPropagation();
      var key = node.getAttribute('data-edit-img');
      var wrap = el('div');
      wrap.appendChild(el('div',{class:'help'},'Chọn một ảnh trong kho, hoặc tải ảnh mới từ máy.'));
      var grid = el('div',{id:'sa-lib'});
      D.library.forEach(function(it){ var im = el('img',{src:it.url, alt:it.alt, title:it.alt}); im.onclick = function(){ changes.images[key] = {libraryId: it.id}; applyImage(node, key, it.url); markDirty(); closePanel(); }; grid.appendChild(im); });
      if(!D.library.length) grid.appendChild(el('div',{class:'help'},'Kho ảnh trống.'));
      wrap.appendChild(grid);
      wrap.appendChild(el('label',{},'Tải ảnh mới'));
      var file = el('input',{type:'file',accept:'image/*'}); wrap.appendChild(file);
      file.onchange = function(){
        if(!file.files[0]) return;
        setStatus('Đang tải ảnh...');
        var fd = new FormData(); fd.append('photo', file.files[0]); fd.append('key', key);
        fetch(api + '/upload', {method:'POST', body: fd}).then(function(r){return r.json();}).then(function(j){
          if(!j.ok){ setStatus('Lỗi: ' + j.message); return; }
          D.library.unshift(j.image); changes.images[key] = {libraryId: j.image.id}; applyImage(node, key, j.image.url); markDirty(); closePanel();
        });
      };
      var bNone = el('button',{class:'d'},'Bỏ ảnh ở vị trí này');
      bNone.onclick = function(){ changes.images[key] = {none:true}; var ph = el('div',{class:'edit-img-placeholder sa-changed','data-edit-img':key},'Đã bỏ ảnh, nhấp để chọn lại'); node.replaceWith(ph); bindImage(ph); markDirty(); closePanel(); };
      openPanel('Chọn ảnh', wrap, [bNone]);
    });
  }
  document.querySelectorAll('[data-edit-img]').forEach(bindImage);

  // SEO
  bSeo.onclick = function(){
    var wrap = el('div');
    wrap.appendChild(el('label',{},'Thẻ title (50 đến 65 ký tự)'));
    var t = el('input',{type:'text'}); t.value = current('title'); wrap.appendChild(t);
    wrap.appendChild(el('label',{},'Meta description (140 đến 158 ký tự)'));
    var m = el('input',{type:'text'}); m.value = current('metaDescription'); wrap.appendChild(m);
    var b = el('button',{class:'p'},'Áp dụng');
    b.onclick = function(){ record('title', t.value.trim()); record('metaDescription', m.value.trim()); document.title = t.value.trim(); closePanel(); };
    openPanel('Tiêu đề và mô tả SEO', wrap, [b]);
  };

  // Lưu
  bSave.onclick = function(){
    bSave.disabled = true; setStatus('Đang lưu...');
    fetch(api + '/save', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(changes)}).then(function(r){return r.json();}).then(function(j){
      if(!j.ok){ setStatus('Lỗi: ' + j.message); bSave.disabled = false; return; }
      dirty = false; changes = {page:{}, plan:{}, images:{}}; setStatus(j.message);
      document.querySelectorAll('.sa-changed').forEach(function(n){ n.classList.remove('sa-changed'); });
    }).catch(function(err){ setStatus('Lỗi mạng: ' + err); bSave.disabled = false; });
  };

  // Liên kết nội bộ: chuyển sang sửa trang đó thay vì rời khỏi trình sửa
  document.addEventListener('click', function(e){
    var a = e.target.closest('a'); if(!a || a.closest('#sa-toolbar,#sa-panel')) return;
    if(a.hasAttribute('data-edit') || a.closest('[data-edit-md]')) return;
    e.preventDefault();
    var href = a.getAttribute('href') || '';
    var m = href.match(/\/sites\/\d+\/preview\/(.*)$/); var slug = m ? m[1].replace(/\/$/,'') : null;
    if(slug === null && href.indexOf('/')===0) slug = href.replace(/^\//,'').replace(/\/$/,'');
    if(slug !== null){ var pg = D.pages.find(function(p){ return p.slug === slug; }); if(pg){ if(dirty && !confirm('Có thay đổi chưa lưu, vẫn chuyển trang?')) return; window.top.location.href = '/sites/' + D.siteId + '/editor?page=' + pg.id; } }
  }, true);

  window.addEventListener('beforeunload', function(e){ if(dirty){ e.preventDefault(); e.returnValue=''; } });
})();
`;

/* ------------------------------------------------------------------ */
/*  Route                                                               */
/* ------------------------------------------------------------------ */

export interface EditorDeps {
  db: Db;
  config: AppConfig;
  siteOr404: (c: { req: { param: (k: string) => string | undefined } }) => Site | undefined;
  render: (c: never, title: string, active: string, body: unknown) => Response | Promise<Response>;
  enqueueRebuild: (siteId: number) => void;
}

export function mountEditor(app: Hono, deps: EditorDeps): void {
  const { db, config } = deps;

  app.get('/sites/:id/editor', (c) => {
    const site = deps.siteOr404(c);
    if (!site) return c.notFound();
    const pages = db.listPages(site.id).filter((p) => p.status === 'published');
    if (!site.plan || pages.length === 0) return c.text('Site chưa có nội dung để sửa. Chờ bước "Viết nội dung" hoàn tất.', 400);
    const wanted = Number.parseInt(c.req.query('page') ?? '', 10);
    const current = pages.find((p) => p.id === wanted) ?? pages.find((p) => p.kind === 'home') ?? (pages[0] as (typeof pages)[number]);
    return deps.render(c as never, `Sửa ${site.domain}`, 'sites', EditorPage({ site, pages: pages.map((p) => ({ id: p.id, title: p.title, slug: p.slug, kind: p.kind })), current: current.id }));
  });

  app.get('/sites/:id/editor/style.css', (c) => {
    const site = deps.siteOr404(c);
    if (!site || !site.theme) return c.notFound();
    return c.body(siteCss(site.theme), 200, { 'Content-Type': 'text/css' });
  });
  app.get('/sites/:id/editor/site.js', (c) => c.body(SITE_JS, 200, { 'Content-Type': 'text/javascript' }));

  /** Trang đang sửa: HTML thật của site + data-edit + script sửa. */
  app.get('/sites/:id/editor/page/:pageId', async (c) => {
    const site = deps.siteOr404(c);
    const page = db.getPage(Number.parseInt(c.req.param('pageId'), 10));
    if (!site || !page || page.site_id !== site.id) return c.notFound();
    let html: string;
    try {
      const { ctx } = await createRenderContext({ db, site, sitesDir: config.sitesDir, uploadsDir: config.uploadsDir, edit: true });
      html = renderPage(ctx, page);
    } catch (err) {
      return c.text(`Không dựng được trang: ${errorMessage(err)}`, 500);
    }
    const prefix = `/sites/${site.id}`;
    // Đường dẫn tuyệt đối trong HTML → route của dashboard (ảnh từ cache, CSS/JS từ bộ sinh, còn lại từ bản dựng xem trước)
    const map = (p: string): string => {
      if (p.startsWith('assets/img/')) return `${prefix}/images/file/${p.slice('assets/img/'.length)}`;
      if (p.startsWith('assets/css/style.css')) return `${prefix}/editor/style.css`;
      if (p.startsWith('assets/js/site.js')) return `${prefix}/editor/site.js`;
      return `${prefix}/preview/${p}`;
    };
    html = html.replace(/(href|src|content)="\/(?!\/)([^"]*)"/g, (_m, attr: string, p: string) => `${attr}="${map(p)}"`).replace(/url\(\/(?!\/)([^)]*)\)/g, (_m, p: string) => `url(${map(p)})`);
    const fields = collectEditableFields(page.content, site.plan);
    const library = db.listLibrary(site.id).map((l) => ({ id: l.id, url: `${prefix}/images/file/${path.basename(l.file)}`, alt: l.alt }));
    const pages = db.listPages(site.id).filter((p) => p.status === 'published').map((p) => ({ id: p.id, slug: p.slug, title: p.title }));
    const data = { siteId: site.id, pageId: page.id, api: `${prefix}/editor/page/${page.id}`, fields, library, pages };
    const inject = `<script id="sa-edit-data" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script><style>${EDITOR_CSS}</style><script>${EDITOR_JS}</script>`;
    html = html.includes('</body>') ? html.replace('</body>', `${inject}</body>`) : html + inject;
    return c.body(html, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  });

  app.post('/sites/:id/editor/page/:pageId/render-md', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { md?: string };
    return c.json({ html: mdToHtml(String(body.md ?? '')) });
  });

  app.post('/sites/:id/editor/page/:pageId/upload', async (c) => {
    const site = deps.siteOr404(c);
    if (!site) return c.json({ ok: false, message: 'Không tìm thấy site' }, 404);
    const body = await c.req.parseBody();
    const photo = body.photo;
    if (!(photo instanceof File) || photo.size === 0) return c.json({ ok: false, message: 'Chưa chọn ảnh' }, 400);
    if (photo.size > 15 * 1024 * 1024) return c.json({ ok: false, message: 'Ảnh quá 15 MB' }, 400);
    try {
      const dirs = siteDirs(config.sitesDir, site.domain);
      const lib = await saveLibraryImage({ db, siteId: site.id, cacheDir: dirs.images, buffer: Buffer.from(await photo.arrayBuffer()), alt: `${site.brief.brandName} ${path.parse(photo.name).name}`, tags: ['chinh-sua'], source: 'upload', nameHint: path.parse(photo.name).name });
      return c.json({ ok: true, image: { id: lib.id, url: `/sites/${site.id}/images/file/${path.basename(lib.file)}`, alt: lib.alt } });
    } catch (err) {
      return c.json({ ok: false, message: errorMessage(err) }, 500);
    }
  });

  app.post('/sites/:id/editor/page/:pageId/save', async (c) => {
    const site = deps.siteOr404(c);
    const page = db.getPage(Number.parseInt(c.req.param('pageId'), 10));
    if (!site || !page || page.site_id !== site.id) return c.json({ ok: false, message: 'Không tìm thấy trang' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { page?: Record<string, string>; plan?: Record<string, string>; images?: Record<string, { libraryId?: number; none?: boolean }> };
    try {
      const result = applyEdits(page.content, site.plan, body.page ?? {}, body.plan ?? {});
      if (result.applied > 0) {
        db.upsertPage({ site_id: site.id, kind: page.kind, slug: page.slug, title: result.content.title, content: result.content, sort_order: page.sort_order });
        if (result.plan) db.updateSite(site.id, { plan: result.plan });
      }
      let imagesChanged = 0;
      for (const [key, choice] of Object.entries(body.images ?? {})) {
        if (!/^[a-z0-9./_-]+$/i.test(key)) continue;
        if (choice?.none) {
          db.upsertImage({ site_id: site.id, key, provider: 'none', provider_id: null, query: null, file: '', width: null, height: null, alt: '', credit: '', credit_url: '' });
          imagesChanged++;
        } else if (choice?.libraryId) {
          const lib = db.getLibraryImage(Number(choice.libraryId));
          if (!lib || lib.site_id !== site.id) continue;
          db.upsertImage({ site_id: site.id, key, provider: 'manual', provider_id: String(lib.id), query: null, file: lib.file, width: lib.width, height: lib.height, alt: lib.alt, credit: lib.credit, credit_url: '' });
          imagesChanged++;
        }
      }
      const total = result.applied + imagesChanged;
      if (total > 0) {
        db.addLog({ site_id: site.id, step: 'editor', level: 'info', message: `Chỉnh sửa trực quan trang "${page.title}": ${result.applied} chỗ chữ, ${imagesChanged} ảnh` });
        deps.enqueueRebuild(site.id);
      }
      const msg = total > 0 ? `Đã lưu ${result.applied} thay đổi chữ và ${imagesChanged} ảnh, đang dựng lại và đưa lên host.` : 'Không có thay đổi nào.';
      return c.json({ ok: true, message: result.rejected.length ? `${msg} Bỏ qua: ${result.rejected.join(', ')}` : msg });
    } catch (err) {
      return c.json({ ok: false, message: errorMessage(err) }, 400);
    }
  });
}
