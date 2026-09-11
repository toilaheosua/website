import fs from 'node:fs';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppConfig } from '../config.js';
import { integrationStatus } from '../config.js';
import type { Db } from '../db/index.js';
import type { Services } from '../services/types.js';
import type { Worker } from '../core/worker.js';
import { dependentsOf, type StepDef, type StepId } from '../core/pipeline.js';
import { PageContentSchema } from '../core/types.js';
import { errorMessage, isValidDomain } from '../core/util.js';
import { makeTheme } from '../generator/themes.js';
import { siteDirs } from '../generator/builder.js';
import { validateEntity } from '../generator/schema.js';
import { GoogleSearchClient, parseServiceAccount } from '../services/google.js';
import { connectSsh } from '../services/ssh.js';
import { getIntegrationSettings, setIntegrationSettings } from '../services/index.js';
import { SECRET_LABELS, SECRET_NAMES, type SecretName } from '../core/secrets.js';
import { brandReplacementPairs, replaceTextInSite } from '../core/rename.js';
import type { IntegrationView } from './views.js';
import { adminUserName, checkPassword, hasAdminCredential, isAuthenticated, login, logout, passwordSource, requireAuth, sameOriginGuard, setAdminPassword, validateNewPassword } from './auth.js';
import { LoginPage, Page, SetupPage, type Flash } from './layout.js';
import { EditBriefForm, EntityForm, JobsPage, LibraryPage, LogsPage, NewSiteForm, PageDetail, PagesList, SettingsPage, SiteDetail, SitesIndex } from './views.js';
import { deleteLibraryFile, saveLibraryImage } from '../generator/library.js';
import { parseList } from '../core/util.js';
import { mountEditor } from './editor.js';
import { file, parseBriefEdit, parseEntity, parseGeneral, parseNewSite, parseWaf, str, type FormBody } from './forms.js';

export interface WebDeps {
  db: Db;
  config: AppConfig;
  services: Services;
  worker: Worker;
  steps: StepDef[];
}

const FLASH_COOKIE = 'sa_flash';

export function createApp(deps: WebDeps): Hono {
  const { db, config, services, steps } = deps;
  const app = new Hono();

  const flash = (c: Context, f: Flash) => {
    setCookie(c, FLASH_COOKIE, JSON.stringify(f), { path: '/', maxAge: 60, httpOnly: true, sameSite: 'Lax' });
  };
  const takeFlash = (c: Context): Flash | null => {
    const raw = getCookie(c, FLASH_COOKIE);
    if (!raw) return null;
    deleteCookie(c, FLASH_COOKIE, { path: '/' });
    try {
      return JSON.parse(raw) as Flash;
    } catch {
      return null;
    }
  };
  const render = (c: Context, title: string, active: string, body: unknown, opts: { refresh?: number } = {}) =>
    c.html(String(Page({ title, active, mock: config.isMock, flash: takeFlash(c), children: body as never, refresh: opts.refresh })));

  const siteOr404 = (c: { req: { param: (k: string) => string | undefined } }) => {
    const id = Number.parseInt(c.req.param('id') ?? '', 10);
    return Number.isFinite(id) ? db.getSite(id) : undefined;
  };

  /** Đổi tên thương hiệu: thay luôn trong nội dung đã sinh (tên đầy đủ và đuôi 2 từ). Trả về đoạn thông báo. */
  const renameBrandInContent = (siteId: number, oldName: string, newName: string): string => {
    const pairs = brandReplacementPairs(oldName, newName);
    if (!pairs.length) return '';
    const r = replaceTextInSite(db, siteId, pairs);
    db.addLog({ site_id: siteId, step: 'rename', level: 'info', message: `Đổi tên thương hiệu "${oldName}" → "${newName}": ${r.replacements} chỗ trong ${r.pages} trang` });
    return r.replacements ? ` Đã thay ${r.replacements} chỗ "${oldName}" trong ${r.pages} trang nội dung.` : '';
  };

  const statusNow = () => integrationStatus(config, services.integrations(), db.listServers().length > 0);
  const integrationView = (): IntegrationView => {
    const i = services.integrations();
    const s = services.secrets;
    let serviceAccountEmail = '';
    if (services.google instanceof GoogleSearchClient) serviceAccountEmail = services.google.serviceAccountEmail;
    return {
      cloudflare: { info: s.info('cloudflare_token'), source: i.cloudflare.source, accountId: i.cloudflare.accountId },
      anthropic: { info: s.info('anthropic_key'), source: i.anthropic.source, model: i.anthropic.model, editorModel: i.anthropic.editorModel },
      pexels: { info: s.info('pexels_key'), source: i.pexels.source },
      google: { info: s.info('google_sa_json'), source: i.google.source, ownerEmail: i.google.ownerEmail, serviceAccountEmail },
      googleMaps: { info: s.info('google_maps_key'), source: i.googleMaps.source },
      telegram: { info: s.info('telegram_token'), source: i.telegram.source, chatId: i.telegram.chatId },
    };
  };
  const settingsProps = (tests?: Record<string, { ok: boolean; message: string }>) => ({
    waf: db.getWafSettings(),
    general: db.getGeneralSettings(),
    servers: db.listServers(),
    config,
    status: statusNow(),
    integ: integrationView(),
    account: { user: adminUserName(db, config), source: passwordSource(db, config) },
    tests,
  });

  app.use('*', sameOriginGuard());
  app.get('/healthz', (c) => c.json({ ok: true, active: deps.worker.activeCount, mock: config.isMock }));

  /* ---------------- thiết lập lần đầu và đăng nhập ---------------- */
  app.get('/setup', (c) => {
    if (hasAdminCredential(db, config)) return c.redirect('/login');
    return c.html(String(SetupPage({})));
  });
  app.post('/setup', async (c) => {
    if (hasAdminCredential(db, config)) return c.redirect('/login');
    const body = (await c.req.parseBody()) as FormBody;
    const user = str(body, 'user') || 'admin';
    const err = validateNewPassword(str(body, 'password'), str(body, 'confirm'));
    if (err) return c.html(String(SetupPage({ error: err, user })), 400);
    setAdminPassword(db, user, str(body, 'password'));
    db.addLog({ level: 'info', step: 'setup', message: `Đặt tài khoản quản trị ${user} lần đầu` });
    login(c, db, config);
    flash(c, { type: 'ok', text: 'Đã đặt mật khẩu quản trị. Tiếp theo: vào Cài đặt để nhập khóa dịch vụ.' });
    return c.redirect('/settings');
  });
  app.get('/login', (c) => {
    if (!hasAdminCredential(db, config)) return c.redirect('/setup');
    if (isAuthenticated(c, db)) return c.redirect('/');
    return c.html(String(LoginPage({ next: c.req.query('next') })));
  });
  app.post('/login', async (c) => {
    const body = (await c.req.parseBody()) as FormBody;
    if (!checkPassword(db, config, str(body, 'user'), str(body, 'password'))) {
      return c.html(String(LoginPage({ error: 'Sai tài khoản hoặc mật khẩu' })), 401);
    }
    login(c, db, config);
    const next = str(body, 'next');
    return c.redirect(next.startsWith('/') ? next : '/');
  });
  app.post('/logout', (c) => {
    logout(c, db);
    return c.redirect('/login');
  });
  app.use('*', requireAuth(db, config));

  app.post('/settings/password', async (c) => {
    const body = (await c.req.parseBody()) as FormBody;
    const currentUser = adminUserName(db, config);
    if (!checkPassword(db, config, currentUser, str(body, 'current'))) {
      flash(c, { type: 'err', text: 'Mật khẩu hiện tại không đúng.' });
      return c.redirect('/settings');
    }
    const err = validateNewPassword(str(body, 'password'), str(body, 'confirm'));
    if (err) {
      flash(c, { type: 'err', text: err });
      return c.redirect('/settings');
    }
    setAdminPassword(db, str(body, 'user') || currentUser, str(body, 'password'));
    db.addLog({ level: 'info', step: 'settings', message: 'Đổi mật khẩu quản trị' });
    flash(c, { type: 'ok', text: 'Đã đổi mật khẩu. Mật khẩu này được ưu tiên hơn ADMIN_PASSWORD trong .env.' });
    return c.redirect('/settings');
  });

  /* ---------------- danh sách site ---------------- */
  app.get('/', (c) => {
    const sites = db.listSites();
    const stepsBySite = new Map(sites.map((s) => [s.id, db.listSteps(s.id)]));
    const body = SitesIndex({ sites, stepsBySite, defs: steps, counts: db.countSitesByStatus(), integrations: statusNow() });
    const busy = sites.some((s) => s.status !== 'live' && s.status !== 'paused' && s.status !== 'error');
    return render(c, 'Website', 'sites', body, { refresh: busy ? 15 : undefined });
  });

  /* ---------------- tạo site ---------------- */
  app.get('/sites/new', (c) => render(c, 'Tạo site', 'new', NewSiteForm({ servers: db.listServers(), general: db.getGeneralSettings() })));

  app.post('/sites', async (c) => {
    const body = (await c.req.parseBody()) as FormBody;
    const general = db.getGeneralSettings();
    const parsed = parseNewSite(body, general);
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) if (typeof v === 'string') values[k] = v;
    if (parsed.errors.length === 0 && db.getSiteByDomain(parsed.domain)) parsed.errors.push(`Domain ${parsed.domain} đã có trong hệ thống`);
    if (parsed.serverId === null || !db.getServer(parsed.serverId)) parsed.errors.push('Chưa chọn server hợp lệ');
    if (parsed.errors.length) return render(c, 'Tạo site', 'new', NewSiteForm({ servers: db.listServers(), general, values, errors: parsed.errors }));

    if (!parsed.brief.targetCountries.length) parsed.brief.targetCountries = general.defaultTargetCountries;
    let logoFile: string | null = null;
    const logo = file(body, 'logo');
    if (logo) {
      const ext = path.extname(logo.name).toLowerCase() || '.png';
      if (!['.png', '.jpg', '.jpeg', '.svg', '.webp'].includes(ext)) {
        return render(c, 'Tạo site', 'new', NewSiteForm({ servers: db.listServers(), general, values, errors: ['Logo phải là PNG, JPG, SVG hoặc WebP'] }));
      }
      fs.mkdirSync(config.uploadsDir, { recursive: true });
      logoFile = `${parsed.domain}-logo${ext}`;
      fs.writeFileSync(path.join(config.uploadsDir, logoFile), Buffer.from(await logo.arrayBuffer()));
    }
    const id = db.createSite({ domain: parsed.domain, server_id: parsed.serverId, brief: parsed.brief, entity: parsed.entity, logo_file: logoFile });
    db.ensureSteps(id, steps.map((s) => s.id));
    db.addLog({ site_id: id, level: 'info', message: `Tạo site ${parsed.domain} (${parsed.brief.brandName})` });
    flash(c, { type: 'ok', text: `Đã tạo ${parsed.domain}. Pipeline bắt đầu chạy trong vài giây.` });
    return c.redirect(`/sites/${id}`);
  });

  /* ---------------- chi tiết site ---------------- */
  app.get('/sites/:id', (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    const body = SiteDetail({
      site,
      steps: db.listSteps(site.id),
      defs: steps,
      pages: db.listPages(site.id),
      logs: db.listLogs({ siteId: site.id, limit: 60 }),
      jobs: db.listJobs(10, site.id),
      config,
      server: site.server_id ? db.getServer(site.server_id) : undefined,
    });
    const busy = site.status !== 'live' && site.status !== 'paused' && site.status !== 'error';
    const hasRunningJob = db.listJobs(5, site.id).some((j) => j.status === 'running' || j.status === 'queued');
    return render(c, site.domain, 'sites', body, { refresh: busy || hasRunningJob ? 15 : undefined });
  });

  app.get('/api/sites/:id', (c) => {
    const site = siteOr404(c);
    if (!site) return c.json({ error: 'not found' }, 404);
    return c.json({ id: site.id, domain: site.domain, status: site.status, steps: db.listSteps(site.id), health: site.health });
  });

  app.post('/sites/:id/steps/:step/retry', (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    const step = c.req.param('step') as StepId;
    if (!steps.some((s) => s.id === step)) return c.notFound();
    db.resetStep(site.id, step);
    if (site.status === 'error') db.updateSite(site.id, { status: 'building', error_summary: null });
    flash(c, { type: 'info', text: `Đã đặt lại bước ${step}, worker sẽ chạy lại trong vài giây.` });
    return c.redirect(`/sites/${site.id}`);
  });

  app.post('/sites/:id/steps/:step/rerun-from', (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    const step = c.req.param('step') as StepId;
    if (!steps.some((s) => s.id === step)) return c.notFound();
    const all = dependentsOf(steps, step);
    db.resetStepsFrom(site.id, all);
    db.updateSite(site.id, { status: 'building', error_summary: null });
    flash(c, { type: 'info', text: `Đã đặt lại ${all.length} bước từ ${step}.` });
    return c.redirect(`/sites/${site.id}`);
  });

  app.post('/sites/:id/pause', (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    db.updateSite(site.id, { status: 'paused' });
    return c.redirect(`/sites/${site.id}`);
  });
  app.post('/sites/:id/resume', (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    db.updateSite(site.id, { status: 'building' });
    return c.redirect(`/sites/${site.id}`);
  });

  const JOB_TYPES = new Set(['rebuild_deploy', 'health_check', 'sync_waf', 'generate_post', 'reassign_images']);
  app.post('/sites/:id/jobs/:type', async (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    const type = c.req.param('type');
    if (!JOB_TYPES.has(type)) return c.notFound();
    let payload: Record<string, unknown> | null = null;
    if (type === 'generate_post') {
      const body = (await c.req.parseBody()) as FormBody;
      payload = { topic: str(body, 'topic'), count: Number.parseInt(str(body, 'count') || '1', 10) };
    }
    db.enqueueJob(type, site.id, payload, { dedupe: type !== 'generate_post', maxAttempts: type === 'health_check' ? 1 : 2 });
    flash(c, { type: 'info', text: 'Đã đưa vào hàng đợi. Theo dõi ở mục Tác vụ hoặc log.' });
    return c.redirect(type === 'reassign_images' ? `/sites/${site.id}/library` : `/sites/${site.id}`);
  });

  app.post('/sites/:id/delete', async (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    const body = (await c.req.parseBody()) as FormBody;
    db.updateSite(site.id, { status: 'paused' });
    db.enqueueJob('delete_site', site.id, { deleteZone: str(body, 'deleteZone') === '1', deletePanelSite: str(body, 'deletePanelSite') === '1', force: str(body, 'force') === '1' }, { maxAttempts: 1 });
    flash(c, { type: 'warn', text: `Đang xóa ${site.domain}...` });
    return c.redirect('/');
  });

  /* ---------------- brief ---------------- */
  app.get('/sites/:id/edit', (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    return render(c, `Sửa ${site.domain}`, 'sites', EditBriefForm({ site, servers: db.listServers() }));
  });
  app.post('/sites/:id/edit', async (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    const body = (await c.req.parseBody()) as FormBody;
    const brief = parseBriefEdit(body, site.brief);
    const serverId = Number.parseInt(str(body, 'server_id'), 10);
    const patch: Parameters<Db['updateSite']>[1] = { brief };
    if (Number.isFinite(serverId) && db.getServer(serverId)) patch.server_id = serverId;
    let logoChanged = false;
    const logo = file(body, 'logo');
    if (logo) {
      const ext = path.extname(logo.name).toLowerCase() || '.png';
      if (!['.png', '.jpg', '.jpeg', '.svg', '.webp'].includes(ext)) {
        flash(c, { type: 'err', text: 'Logo phải là PNG, JPG, SVG hoặc WebP' });
        return c.redirect(`/sites/${site.id}/edit`);
      }
      fs.mkdirSync(config.uploadsDir, { recursive: true });
      const logoFile = `${site.domain}-logo${ext}`;
      fs.writeFileSync(path.join(config.uploadsDir, logoFile), Buffer.from(await logo.arrayBuffer()));
      patch.logo_file = logoFile;
      logoChanged = true;
    } else if (str(body, 'removeLogo') === '1' && site.logo_file) {
      patch.logo_file = null;
      logoChanged = true;
    }
    const renamed = brief.brandName !== site.brief.brandName ? renameBrandInContent(site.id, site.brief.brandName, brief.brandName) : '';
    if (renamed && site.entity.name === site.brief.brandName) patch.entity = { ...site.entity, name: brief.brandName };
    if (str(body, 'action') === 'retheme') {
      patch.theme = makeTheme(brief.themeId as 'auto', brief.siteType);
      db.updateSite(site.id, patch);
      if (site.plan) db.enqueueJob('rebuild_deploy', site.id, null, { dedupe: true });
      flash(c, { type: 'ok', text: `Đã đổi theme sang ${patch.theme.name}, đang dựng lại.${renamed}` });
    } else {
      db.updateSite(site.id, patch);
      if ((renamed || logoChanged) && site.plan && site.site_path) db.enqueueJob('rebuild_deploy', site.id, null, { dedupe: true });
      flash(c, { type: 'ok', text: `Đã lưu brief.${renamed}${logoChanged ? ' Logo đã đổi, đang dựng lại.' : ''}` });
    }
    return c.redirect(`/sites/${site.id}`);
  });

  /** Thay chữ trong toàn bộ nội dung đã sinh (ví dụ sửa tên thương hiệu viết sai) rồi dựng lại. */
  app.post('/sites/:id/replace-text', async (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    const body = (await c.req.parseBody()) as FormBody;
    const from = str(body, 'from');
    const to = str(body, 'to');
    if (!from || from === to) {
      flash(c, { type: 'err', text: 'Cần nhập chữ cần thay và chữ thay thế khác nhau.' });
      return c.redirect(`/sites/${site.id}/pages`);
    }
    db.enqueueJob('replace_text', site.id, { pairs: [[from, to]] }, { maxAttempts: 1 });
    flash(c, { type: 'info', text: `Đang thay "${from}" thành "${to}" trong toàn bộ nội dung rồi dựng lại.` });
    return c.redirect(`/sites/${site.id}/pages`);
  });

  /* ---------------- entity ---------------- */
  app.get('/sites/:id/entity', (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    return render(c, `Entity ${site.domain}`, 'sites', EntityForm({ site, entity: site.entity, warnings: validateEntity(site.entity, site.brief.brandName), autoSync: db.getGeneralSettings().autoSyncEntity }));
  });
  app.post('/sites/:id/entity', async (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    const body = (await c.req.parseBody()) as FormBody;
    const entity = parseEntity(body, site.entity);
    const patch: Parameters<Db['updateSite']>[1] = { entity };
    let renamed = '';
    if (str(body, 'syncBrand') === '1' && entity.name && entity.name !== site.brief.brandName) {
      patch.brief = { ...site.brief, brandName: entity.name };
      renamed = renameBrandInContent(site.id, site.brief.brandName, entity.name);
    }
    db.updateSite(site.id, patch);
    db.addLog({ site_id: site.id, step: 'entity', level: 'info', message: 'Cập nhật Entity SEO' });
    const warnings = validateEntity(entity, site.brief.brandName);
    if (db.getGeneralSettings().autoSyncEntity && site.plan && site.site_path) {
      db.enqueueJob('rebuild_deploy', site.id, null, { dedupe: true });
      flash(c, { type: 'ok', text: `Đã lưu Entity, đang dựng lại và đưa lên host.${renamed}${warnings.length ? ` Còn ${warnings.length} gợi ý bổ sung.` : ''}` });
    } else {
      flash(c, { type: 'ok', text: 'Đã lưu Entity. Site sẽ dùng dữ liệu này ở lần dựng tiếp theo.' });
    }
    return c.redirect(`/sites/${site.id}/entity`);
  });

  /* ---------------- pages ---------------- */
  app.get('/sites/:id/pages', (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    return render(c, `Nội dung ${site.domain}`, 'sites', PagesList({ site, pages: db.listPages(site.id) }));
  });
  app.get('/sites/:id/pages/:pageId', (c) => {
    const site = siteOr404(c);
    const page = db.getPage(Number.parseInt(c.req.param('pageId'), 10));
    if (!site || !page || page.site_id !== site.id) return c.notFound();
    return render(c, page.title, 'sites', PageDetail({ site, page }));
  });
  app.post('/sites/:id/pages/:pageId', async (c) => {
    const site = siteOr404(c);
    const page = db.getPage(Number.parseInt(c.req.param('pageId'), 10));
    if (!site || !page || page.site_id !== site.id) return c.notFound();
    const body = (await c.req.parseBody()) as FormBody;
    try {
      const content = PageContentSchema.parse(JSON.parse(str(body, 'content')));
      db.upsertPage({ site_id: site.id, kind: page.kind, slug: page.slug, title: content.title, content, sort_order: page.sort_order });
      if (site.plan && site.site_path) db.enqueueJob('rebuild_deploy', site.id, null, { dedupe: true });
      flash(c, { type: 'ok', text: 'Đã lưu nội dung, đang dựng lại.' });
    } catch (err) {
      flash(c, { type: 'err', text: `JSON không hợp lệ: ${errorMessage(err)}` });
    }
    return c.redirect(`/sites/${site.id}/pages/${page.id}`);
  });
  app.post('/sites/:id/pages/:pageId/regenerate', (c) => {
    const site = siteOr404(c);
    const page = db.getPage(Number.parseInt(c.req.param('pageId'), 10));
    if (!site || !page || page.site_id !== site.id) return c.notFound();
    db.enqueueJob('regenerate_page', site.id, { pageId: page.id }, { maxAttempts: 2 });
    flash(c, { type: 'info', text: `Đang sinh lại "${page.title}".` });
    return c.redirect(`/sites/${site.id}/pages`);
  });

  /* ---------------- kho ảnh thật ---------------- */
  app.get('/sites/:id/library', (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    const usedFiles = new Map<string, string[]>();
    for (const img of db.listImages(site.id)) if (img.provider === 'library') usedFiles.set(img.file, [...(usedFiles.get(img.file) ?? []), img.key]);
    return render(c, `Kho ảnh ${site.domain}`, 'sites', LibraryPage({ site, library: db.listLibrary(site.id), usedFiles, hasPlaces: Boolean(services.places) }));
  });
  app.get('/sites/:id/library/file/:name', (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    const name = path.basename(c.req.param('name'));
    const file = path.join(siteDirs(config.sitesDir, site.domain).images, name);
    if (!name.startsWith('lib-') || !fs.existsSync(file)) return c.notFound();
    return c.body(fs.readFileSync(file), 200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600' });
  });
  app.post('/sites/:id/library/upload', async (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    const body = (await c.req.parseBody({ all: true })) as FormBody;
    const raw = body.photos;
    const files = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File && f.size > 0);
    const tags = parseList(str(body, 'tags'));
    const altBase = str(body, 'alt') || site.brief.brandName;
    const dirs = siteDirs(config.sitesDir, site.domain);
    let n = 0;
    const errors: string[] = [];
    const startIndex = db.listLibrary(site.id).length;
    for (const f of files) {
      if (f.size > 15 * 1024 * 1024) {
        errors.push(`${f.name}: quá 15 MB`);
        continue;
      }
      try {
        await saveLibraryImage({ db, siteId: site.id, cacheDir: dirs.images, buffer: Buffer.from(await f.arrayBuffer()), alt: `${altBase} ${startIndex + n + 1}`, tags, source: 'upload', nameHint: path.parse(f.name).name });
        n++;
      } catch (err) {
        errors.push(`${f.name}: ${errorMessage(err)}`);
      }
    }
    flash(c, { type: errors.length ? 'warn' : 'ok', text: `Đã thêm ${n} ảnh.${errors.length ? ' Lỗi: ' + errors.join('; ') : ''} Bấm "Áp dụng ảnh vào website" để dùng.` });
    return c.redirect(`/sites/${site.id}/library`);
  });
  app.post('/sites/:id/library/import', async (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    const body = (await c.req.parseBody()) as FormBody;
    db.enqueueJob('import_google_photos', site.id, { query: str(body, 'query'), includeUserPhotos: str(body, 'includeUserPhotos') === '1' }, { maxAttempts: 1 });
    flash(c, { type: 'info', text: 'Đang nhập ảnh từ Google Maps, tải lại trang sau vài giây. Xem kết quả ở mục Tác vụ hoặc Log.' });
    return c.redirect(`/sites/${site.id}/library`);
  });
  app.post('/sites/:id/library/:imgId', async (c) => {
    const site = siteOr404(c);
    const img = db.getLibraryImage(Number.parseInt(c.req.param('imgId'), 10));
    if (!site || !img || img.site_id !== site.id) return c.notFound();
    const body = (await c.req.parseBody()) as FormBody;
    db.updateLibraryImage(img.id, { alt: str(body, 'alt'), tags: parseList(str(body, 'tags')).map((t) => t.toLowerCase()) });
    flash(c, { type: 'ok', text: 'Đã lưu.' });
    return c.redirect(`/sites/${site.id}/library`);
  });
  app.post('/sites/:id/library/:imgId/delete', (c) => {
    const site = siteOr404(c);
    const img = db.getLibraryImage(Number.parseInt(c.req.param('imgId'), 10));
    if (!site || !img || img.site_id !== site.id) return c.notFound();
    deleteLibraryFile(siteDirs(config.sitesDir, site.domain).images, img);
    db.deleteLibraryImage(img.id);
    flash(c, { type: 'ok', text: 'Đã xóa ảnh. Bấm "Áp dụng ảnh vào website" để cập nhật bản dựng.' });
    return c.redirect(`/sites/${site.id}/library`);
  });

  /* ---------------- chọn ảnh từng vị trí ---------------- */
  app.get('/sites/:id/images/file/:name', (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    const name = path.basename(c.req.param('name'));
    const file = path.join(siteDirs(config.sitesDir, site.domain).images, name);
    if (!/\.(webp|png|jpe?g)$/i.test(name) || !fs.existsSync(file)) return c.notFound();
    return c.body(fs.readFileSync(file), 200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600' });
  });
  /* ---------------- chỉnh sửa trực quan ---------------- */
  mountEditor(app, { db, config, siteOr404, render: render as never, enqueueRebuild: (siteId) => db.enqueueJob('rebuild_deploy', siteId, null, { dedupe: true }) });

  /* ---------------- xem bản dựng cục bộ ---------------- */
  app.get('/sites/:id/preview/*', (c) => {
    const site = siteOr404(c);
    if (!site) return c.notFound();
    const out = siteDirs(config.sitesDir, site.domain).out;
    const rel = decodeURIComponent(c.req.path.replace(/^\/sites\/\d+\/preview\/?/, ''));
    let filePath = path.normalize(path.join(out, rel));
    if (!filePath.startsWith(path.normalize(out))) return c.notFound();
    if (!fs.existsSync(filePath)) return c.notFound();
    if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
    if (!fs.existsSync(filePath)) return c.notFound();
    const ext = path.extname(filePath).toLowerCase();
    const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
    const prefix = `/sites/${site.id}/preview`;
    if (ext === '.html' || ext === '.css') {
      const text = fs.readFileSync(filePath, 'utf8').replace(/(href|src|content)="\/(?!\/)/g, `$1="${prefix}/`).replace(/url\(\/(?!\/)/g, `url(${prefix}/`);
      return c.body(text, 200, { 'Content-Type': types[ext] ?? 'text/plain' });
    }
    return c.body(fs.readFileSync(filePath), 200, { 'Content-Type': types[ext] ?? 'application/octet-stream' });
  });
  app.get('/sites/:id/preview', (c) => c.redirect(`/sites/${c.req.param('id')}/preview/`));

  /* ---------------- settings ---------------- */
  app.get('/settings', (c) => render(c, 'Cài đặt', 'settings', SettingsPage(settingsProps())));

  /** Nhập khóa API: chỉ ghi mới hoặc xóa, không bao giờ trả lại giá trị. */
  app.post('/settings/integrations', async (c) => {
    const body = (await c.req.parseBody()) as FormBody;
    const updated: string[] = [];
    const errors: string[] = [];
    for (const name of SECRET_NAMES) {
      const value = str(body, name);
      if (str(body, `delete_${name}`) === '1') {
        services.secrets.delete(name);
        updated.push(`xóa ${SECRET_LABELS[name]}`);
        continue;
      }
      if (!value) continue;
      if (name === 'google_sa_json') {
        try {
          parseServiceAccount(value);
        } catch (err) {
          errors.push(`${SECRET_LABELS[name]}: ${errorMessage(err)}`);
          continue;
        }
      }
      services.secrets.set(name as SecretName, value);
      updated.push(SECRET_LABELS[name]);
    }
    setIntegrationSettings(db, {
      cloudflareAccountId: str(body, 'cloudflare_account_id'),
      anthropicModel: str(body, 'anthropic_model'),
      googleOwnerEmail: str(body, 'google_owner_email'),
      telegramChatId: str(body, 'telegram_chat_id'),
    });
    db.addLog({ level: 'info', step: 'settings', message: `Cập nhật khóa dịch vụ: ${updated.join(', ') || 'chỉ các mục không bí mật'}` });
    if (errors.length) flash(c, { type: 'err', text: errors.join('; ') });
    else flash(c, { type: 'ok', text: updated.length ? `Đã lưu: ${updated.join(', ')}. Bấm nút kiểm tra để xác nhận.` : 'Đã lưu cài đặt.' });
    return c.redirect('/settings');
  });
  app.post('/settings/waf', async (c) => {
    const body = (await c.req.parseBody()) as FormBody;
    db.setWafSettings(parseWaf(body, db.getWafSettings()));
    flash(c, { type: 'ok', text: 'Đã lưu cài đặt WAF. Site mới sẽ dùng cài đặt này; site cũ cần "Đồng bộ WAF".' });
    return c.redirect('/settings');
  });
  app.post('/settings/waf-sync-all', async (c) => {
    const body = (await c.req.parseBody()) as FormBody;
    db.setWafSettings(parseWaf(body, db.getWafSettings()));
    db.enqueueJob('sync_all_waf', null, null, { dedupe: true, maxAttempts: 1 });
    flash(c, { type: 'ok', text: 'Đã lưu và đưa vào hàng đợi đồng bộ WAF cho mọi site đang active.' });
    return c.redirect('/settings');
  });
  app.post('/settings/general', async (c) => {
    const body = (await c.req.parseBody()) as FormBody;
    db.setGeneralSettings(parseGeneral(body, db.getGeneralSettings()));
    flash(c, { type: 'ok', text: 'Đã lưu.' });
    return c.redirect('/settings');
  });
  app.post('/settings/servers', async (c) => {
    const body = (await c.req.parseBody()) as FormBody;
    const ip = str(body, 'ip');
    if (!ip) {
      flash(c, { type: 'err', text: 'Thiếu IP' });
      return c.redirect('/settings');
    }
    db.upsertServer({
      name: str(body, 'name') || ip,
      ip,
      panel_url: str(body, 'panel_url'),
      panel_api_key: str(body, 'panel_api_key'),
      ssh_host: str(body, 'ssh_host') || ip,
      ssh_port: Number.parseInt(str(body, 'ssh_port'), 10) || 22,
      ssh_user: str(body, 'ssh_user') || 'root',
      ssh_key_path: str(body, 'ssh_key_path'),
      ssh_password: str(body, 'ssh_password'),
      web_root: str(body, 'web_root') || '/www/wwwroot',
      php_version: '00',
      from_env: 0,
    });
    flash(c, { type: 'ok', text: 'Đã thêm server.' });
    return c.redirect('/settings');
  });
  app.post('/settings/servers/:sid/delete', (c) => {
    db.deleteServer(Number.parseInt(c.req.param('sid'), 10));
    flash(c, { type: 'ok', text: 'Đã xóa server.' });
    return c.redirect('/settings');
  });
  app.post('/settings/test/:what', async (c) => {
    const what = c.req.param('what');
    const tests: Record<string, { ok: boolean; message: string }> = {};
    try {
      if (what === 'cloudflare') tests.Cloudflare = await services.cloudflare.verifyToken();
      else if (what === 'aapanel') {
        const server = db.listServers()[0];
        tests.aaPanel = server ? await services.panelFor(server).ping() : { ok: false, message: 'Chưa có server' };
      } else if (what === 'ssh') {
        const server = db.listServers()[0];
        if (!server) tests.SSH = { ok: false, message: 'Chưa có server' };
        else if (config.isMock) tests.SSH = { ok: true, message: 'Mock SSH' };
        else {
          const ssh = await connectSsh(server);
          const r = await ssh.exec('id && nginx -v 2>&1 && ls -d /www/wwwroot');
          await ssh.close();
          tests.SSH = { ok: r.code === 0, message: (r.stdout + r.stderr).trim().slice(0, 300) };
        }
      } else if (what === 'claude') tests.Claude = await services.content.verify();
      else if (what === 'pexels') {
        const photos = await services.images.search('nature', { perPage: 1 });
        tests.Pexels = { ok: photos.length > 0, message: photos.length ? 'Key hợp lệ, tìm ảnh thành công' : 'Key hợp lệ nhưng không có kết quả' };
      }
    } catch (err) {
      tests[what] = { ok: false, message: errorMessage(err) };
    }
    return render(c, 'Cài đặt', 'settings', SettingsPage(settingsProps(tests)));
  });

  /* ---------------- jobs & logs ---------------- */
  const siteNames = () => new Map(db.listSites().map((s) => [s.id, s.domain]));
  app.get('/jobs', (c) => render(c, 'Tác vụ', 'jobs', JobsPage({ jobs: db.listJobs(100), sites: siteNames(), active: deps.worker.activeCount }), { refresh: 10 }));
  app.get('/logs', (c) => {
    const level = c.req.query('level') ?? '';
    const siteQ = Number.parseInt(c.req.query('site') ?? '', 10);
    const siteId = Number.isFinite(siteQ) ? siteQ : undefined;
    return render(c, 'Log', 'logs', LogsPage({ logs: db.listLogs({ level: level || undefined, siteId, limit: 300 }), sites: siteNames(), level, siteId }));
  });

  app.notFound((c) => c.text('Không tìm thấy', 404));
  app.onError((err, c) => {
    console.error(err);
    return c.text(`Lỗi: ${errorMessage(err)}`, 500);
  });

  // dùng để kiểm tra domain từ form bằng JS nếu cần
  app.get('/api/check-domain', (c) => c.json({ valid: isValidDomain(c.req.query('d') ?? '') }));
  return app;
}
