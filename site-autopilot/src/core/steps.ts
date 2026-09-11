import fs from 'node:fs';
import path from 'node:path';
import type { StepContext, StepDef, StepResult } from './pipeline.js';
import type { Page } from '../db/index.js';
import type { PageContent, SitePlan } from './types.js';
import { AppError, ConfigError, TransientError } from './errors.js';
import { errorMessage, nowIso, randomHex, slugify } from './util.js';
import { makeTheme } from '../generator/themes.js';
import { buildCustomRules, buildRateLimitRule, mergeRules, RULE_TAG } from '../generator/waf.js';
import { collectImageSlots, fetchImagesForSlots } from '../generator/images.js';
import { buildSite, siteDirs } from '../generator/builder.js';
import { ROUTES, UI_STRINGS } from '../generator/render-context.js';
import { CONTENT_STYLES, resolveContentStyle } from '../generator/content-styles.js';
import { sanitizeInternalLinks } from '../generator/markdown.js';
import { autoFixPage, checkQuality, isPass, issuesToFeedback, type ContentReview, type QualityIssue } from '../generator/quality.js';
import { probeEdge, probeOrigin } from '../monitor/probe.js';
import { assignLibraryToSlots } from '../generator/library.js';
import type { InternalLink } from '../services/types.js';
import { VerificationPendingError } from '../services/google.js';
import { INDEXNOW_STATUS_TEXT } from '../services/indexnow.js';

const MIN = 60_000;

function requireServer(ctx: StepContext) {
  const server = ctx.server;
  if (!server) throw new ConfigError('Site chưa gắn server. Vào Cài đặt để thêm server aaPanel rồi gán cho site.');
  return server;
}

function requireZone(ctx: StepContext): string {
  const id = ctx.site.cf_zone_id;
  if (!id) throw new AppError('Site chưa có zone Cloudflare (cf_zone chưa chạy)');
  return id;
}

/* ------------------------------------------------------------------ */
/*  Nhánh Cloudflare                                                    */
/* ------------------------------------------------------------------ */

const cfZone: StepDef = {
  id: 'cf_zone',
  label: 'Tạo zone Cloudflare',
  description: 'Thêm domain vào tài khoản Cloudflare và lấy cặp nameserver',
  branch: 'cloudflare',
  deps: [],
  maxAttempts: 3,
  async run(ctx) {
    const { cloudflare } = ctx.services;
    const domain = ctx.site.domain;
    let zone = ctx.site.cf_zone_id ? await cloudflare.getZone(ctx.site.cf_zone_id).catch(() => null) : null;
    if (!zone) zone = await cloudflare.findZone(domain);
    if (!zone) {
      zone = await cloudflare.createZone(domain);
      ctx.log('info', `Đã tạo zone ${zone.id}`);
    } else {
      ctx.log('info', `Zone đã tồn tại (${zone.status}), dùng lại`);
    }
    ctx.updateSite({ cf_zone_id: zone.id, cf_name_servers: zone.name_servers ?? [], cf_zone_status: zone.status });
    return { status: 'done', message: `Nameserver: ${(zone.name_servers ?? []).join(', ')}`, output: { zoneId: zone.id, nameServers: zone.name_servers } };
  },
};

const lastActivationTrigger = new Map<string, number>();

const cfWaitActive: StepDef = {
  id: 'cf_wait_active',
  label: 'Chờ đổi nameserver',
  description: 'Dò cho đến khi zone active sau khi bạn đổi nameserver tại Namecheap',
  branch: 'cloudflare',
  deps: ['cf_zone'],
  maxAttempts: 5,
  async run(ctx) {
    const zoneId = requireZone(ctx);
    const zone = await ctx.services.cloudflare.getZone(zoneId);
    ctx.updateSite({ cf_zone_status: zone.status, cf_name_servers: zone.name_servers ?? ctx.site.cf_name_servers });
    if (zone.status === 'active') return { status: 'done', message: 'Zone đã active' };
    if (zone.status === 'moved') throw new AppError('Zone ở trạng thái "moved": nameserver của domain đã trỏ đi nơi khác. Đổi lại nameserver về Cloudflare rồi chạy lại bước này.');
    const last = lastActivationTrigger.get(zoneId) ?? 0;
    if (Date.now() - last > 61 * MIN) {
      lastActivationTrigger.set(zoneId, Date.now());
      await ctx.services.cloudflare.triggerActivationCheck(zoneId);
    }
    const ns = (zone.name_servers ?? []).join(' và ');
    const pollMin = Math.max(ctx.config.isMock ? 0 : 1, ctx.config.NS_POLL_INTERVAL_MIN);
    return { status: 'waiting', retryInMs: pollMin * MIN, message: `Zone đang "${zone.status}". Hãy đổi nameserver tại Namecheap thành ${ns}.` };
  },
};

const cfDns: StepDef = {
  id: 'cf_dns',
  label: 'Cấu hình DNS',
  description: 'Bản ghi A trỏ về IP host và CNAME www, bật proxy',
  branch: 'cloudflare',
  deps: ['cf_wait_active'],
  maxAttempts: 3,
  async run(ctx) {
    const zoneId = requireZone(ctx);
    const server = requireServer(ctx);
    const { cloudflare } = ctx.services;
    const a = await cloudflare.upsertDnsRecord(zoneId, { type: 'A', name: '@', content: server.ip, proxied: true });
    const www = await cloudflare.upsertDnsRecord(zoneId, { type: 'CNAME', name: 'www', content: ctx.site.domain, proxied: true });
    return { status: 'done', message: `A ${a.name} -> ${server.ip} (proxy), CNAME ${www.name} -> ${ctx.site.domain}`, output: { a: a.id, www: www.id } };
  },
};

const cfSettings: StepDef = {
  id: 'cf_settings',
  label: 'SSL Flexible và tối ưu',
  description: 'SSL Flexible, Always Use HTTPS, HTTP/3, Brotli, TLS 1.2+, Bot Fight Mode',
  branch: 'cloudflare',
  deps: ['cf_wait_active'],
  maxAttempts: 3,
  async run(ctx) {
    const zoneId = requireZone(ctx);
    const { cloudflare } = ctx.services;
    const settings: [string, unknown][] = [
      ['ssl', 'flexible'],
      ['always_use_https', 'on'],
      ['automatic_https_rewrites', 'on'],
      ['http3', 'on'],
      ['brotli', 'on'],
      ['min_tls_version', '1.2'],
    ];
    const applied: string[] = [];
    const warnings: string[] = [];
    for (const [key, value] of settings) {
      try {
        await cloudflare.setZoneSetting(zoneId, key, value);
        applied.push(`${key}=${String(value)}`);
      } catch (err) {
        if (key === 'ssl' || key === 'always_use_https') throw err;
        warnings.push(`${key}: ${errorMessage(err)}`);
      }
    }
    try {
      await cloudflare.setBotFightMode(zoneId, true);
      applied.push('bot_fight_mode=on');
    } catch (err) {
      warnings.push(`Bot Fight Mode: ${errorMessage(err)} (token cần quyền Zone - Bot Management - Edit)`);
      ctx.log('warn', `Không bật được Bot Fight Mode: ${errorMessage(err)}`);
    }
    const msg = `Đã đặt ${applied.join(', ')}${warnings.length ? `. Cảnh báo: ${warnings.join('; ')}` : ''}`;
    return { status: 'done', message: msg, output: { applied, warnings } };
  },
};

export async function applyWafRules(ctx: StepContext): Promise<string> {
  const zoneId = requireZone(ctx);
  const { cloudflare } = ctx.services;
  const settings = ctx.services.wafSettings();
  // IP của server được miễn rule chặn quốc tế để verify_live và health check từ chính VPS không bị chặn
  const exemptIps = ctx.server?.ip ? [ctx.server.ip] : [];
  const ours = buildCustomRules({ settings, allowedCountries: ctx.site.brief.targetCountries, exemptIps });
  const existing = await cloudflare.getPhaseRules(zoneId, 'http_request_firewall_custom');
  const { rules, dropped } = mergeRules(existing.rules, ours, 5);
  const res = await cloudflare.replacePhaseRules(zoneId, 'http_request_firewall_custom', rules);
  ctx.updateSite({ cf_ruleset_ids: { ...ctx.site.cf_ruleset_ids, custom: res.rulesetId } });
  if (dropped.length) ctx.log('warn', `Gói Free tối đa 5 rule, đã bỏ rule tự thêm: ${dropped.join(' | ')}`);
  return `${ours.length} rule hệ thống${rules.length - ours.length ? ` + ${rules.length - ours.length} rule sẵn có` : ''}`;
}

const cfWaf: StepDef = {
  id: 'cf_waf',
  label: 'Cài 3 rule WAF',
  description: 'Skip bot đã xác minh, chặn truy cập quốc tế, chặn URL có query lạ và xmlrpc',
  branch: 'cloudflare',
  deps: ['cf_settings'],
  maxAttempts: 3,
  async run(ctx) {
    const msg = await applyWafRules(ctx);
    return { status: 'done', message: msg };
  },
};

export async function applyRateLimit(ctx: StepContext): Promise<string> {
  const zoneId = requireZone(ctx);
  const { cloudflare } = ctx.services;
  const rule = buildRateLimitRule(ctx.services.wafSettings());
  const existing = await cloudflare.getPhaseRules(zoneId, 'http_ratelimit');
  const foreign = existing.rules.filter((r) => !(r.description ?? '').startsWith(RULE_TAG));
  if (foreign.length) ctx.log('warn', `Gói Free chỉ có 1 rule rate limit, thay thế rule sẵn có: ${foreign.map((r) => r.description).join(' | ')}`);
  const res = await cloudflare.replacePhaseRules(zoneId, 'http_ratelimit', [rule]);
  ctx.updateSite({ cf_ruleset_ids: { ...ctx.site.cf_ruleset_ids, ratelimit: res.rulesetId } });
  return rule.description.replace(`${RULE_TAG} `, '');
}

const cfRateLimit: StepDef = {
  id: 'cf_ratelimit',
  label: 'Cài rule rate limit',
  description: 'Giới hạn số request mỗi IP trong 10 giây',
  branch: 'cloudflare',
  deps: ['cf_waf'],
  maxAttempts: 3,
  async run(ctx) {
    const msg = await applyRateLimit(ctx);
    return { status: 'done', message: msg };
  },
};

/* ------------------------------------------------------------------ */
/*  Nhánh dựng site                                                     */
/* ------------------------------------------------------------------ */

const hostSite: StepDef = {
  id: 'host_site',
  label: 'Thêm site vào aaPanel',
  description: 'Tạo website tĩnh trong aaPanel với thư mục gốc riêng',
  branch: 'build',
  deps: [],
  maxAttempts: 3,
  async run(ctx) {
    const server = requireServer(ctx);
    const panel = ctx.services.panelFor(server);
    const domain = ctx.site.domain;
    const sitePath = `${server.web_root.replace(/\/+$/, '')}/${domain}`;
    let site = await panel.findSite(domain);
    if (site) {
      ctx.log('info', `Site đã có trong aaPanel (id ${site.id}), dùng lại`);
    } else {
      site = await panel.addSite({ domain, extraDomains: [`www.${domain}`], path: sitePath, phpVersion: server.php_version || '00', remark: ctx.site.brief.brandName });
    }
    ctx.updateSite({ panel_site_id: site.id, site_path: site.path || sitePath });
    return { status: 'done', message: `aaPanel site #${site.id}, thư mục ${site.path || sitePath}`, output: { panelSiteId: site.id, path: site.path || sitePath } };
  },
};

const genPlan: StepDef = {
  id: 'gen_plan',
  label: 'Lập kế hoạch nội dung',
  description: 'AI lập kế hoạch: tagline, giọng văn, dịch vụ, chủ đề bài viết, FAQ; chọn theme',
  branch: 'build',
  deps: [],
  maxAttempts: 3,
  async run(ctx) {
    const patch: Parameters<StepContext['updateSite']>[0] = {};
    if (!ctx.site.theme) patch.theme = makeTheme(ctx.site.brief.themeId as 'auto', ctx.site.brief.siteType);
    if (!ctx.site.indexnow_key) patch.indexnow_key = randomHex(16);
    if (ctx.services.google && !ctx.site.google_verification_token) {
      try {
        patch.google_verification_token = await ctx.services.google.getMetaToken(`https://${ctx.site.domain}/`);
        ctx.log('info', 'Đã lấy token xác minh Google Search Console');
      } catch (err) {
        ctx.log('warn', `Không lấy được token Google: ${errorMessage(err)}`);
      }
    }
    if (Object.keys(patch).length) ctx.updateSite(patch);
    if (ctx.site.plan) return { status: 'done', message: 'Đã có kế hoạch, giữ nguyên' };
    const contentStyle = resolveContentStyle(ctx.site.brief, ctx.db.getGeneralSettings().defaultContentStyle);
    const generated = await ctx.services.content.generatePlan({ brief: ctx.site.brief, entity: ctx.site.entity, domain: ctx.site.domain, contentStyle });
    const plan = { ...generated, contentStyle };
    ctx.updateSite({ plan });
    return { status: 'done', message: `Kiểu viết ${CONTENT_STYLES[contentStyle].name}; ${plan.services.length} dịch vụ/chủ đề, ${plan.posts.length} bài viết, theme ${ctx.site.theme?.name ?? ''}`, output: { tagline: plan.tagline, contentStyle } };
  },
};

export interface RequiredPage {
  kind: PageContent['kind'];
  slug: string;
  sortOrder: number;
  post?: SitePlan['posts'][number];
}

export function requiredPages(brief: { siteType: 'business' | 'blog'; language: 'vi' | 'en' }, plan: SitePlan): RequiredPage[] {
  const r = ROUTES[brief.language];
  const list: RequiredPage[] = [
    { kind: 'home', slug: '', sortOrder: 0 },
    { kind: 'about', slug: r.about, sortOrder: 1 },
  ];
  if (brief.siteType === 'business') list.push({ kind: 'services', slug: r.services, sortOrder: 2 });
  list.push({ kind: 'blog', slug: r.blog, sortOrder: 3 });
  plan.posts.forEach((post, i) => list.push({ kind: 'post', slug: `${r.blog}/${post.slug ?? slugify(post.title)}`, sortOrder: 10 + i, post }));
  list.push({ kind: 'contact', slug: r.contact, sortOrder: 20 });
  list.push({ kind: 'privacy', slug: r.privacy, sortOrder: 30 });
  return list;
}

/** Danh sách liên kết nội bộ hợp lệ của site: trang cố định, từng dịch vụ (#slug) và các bài đã có. */
export function internalLinksFor(ctx: StepContext, plan: SitePlan, currentSlug: string): InternalLink[] {
  const t = UI_STRINGS[ctx.site.brief.language];
  const r = ROUTES[ctx.site.brief.language];
  const links: InternalLink[] = [];
  const pages = requiredPages(ctx.site.brief, plan);
  const labels: Record<string, string> = { home: t.home, about: t.about, services: t.services, blog: t.blog, contact: t.contact, privacy: t.privacy };
  for (const p of pages) {
    if (p.slug === currentSlug) continue;
    if (p.kind === 'post') continue;
    links.push({ path: p.slug ? `/${p.slug}/` : '/', label: labels[p.kind] ?? p.kind });
    if (p.kind === 'services') for (const s of plan.services) links.push({ path: `/${r.services}/#${s.slug ?? slugify(s.name)}`, label: `${t.services}: ${s.name}` });
  }
  for (const p of ctx.db.listPages(ctx.site.id)) {
    if (p.kind === 'post' && p.slug !== currentSlug) links.push({ path: `/${p.slug}/`, label: `Bài: ${p.title}` });
  }
  return links.slice(0, 40);
}

function cleanLinks(page: PageContent, validPaths: string[]): PageContent {
  const fix = (md: string) => sanitizeInternalLinks(md, validPaths);
  return {
    ...page,
    intro: fix(page.intro),
    sections: page.sections.map((s) => ({ ...s, body: fix(s.body) })),
    faq: page.faq.map((f) => ({ ...f, answer: fix(f.answer) })),
    services: page.services?.map((s) => ({ ...s, body: fix(s.body), summary: fix(s.summary) })),
  };
}

/** Trang nào bỏ qua lượt biên tập và AI duyệt (ngắn, ít rủi ro). */
const LIGHT_KINDS = new Set<PageContent['kind']>(['privacy', 'blog']);

/** Cổng kiểm duyệt: kiểm tra bằng code, rồi AI duyệt (trừ trang nhẹ). Trả về danh sách lỗi gộp. */
async function reviewContent(ctx: StepContext, page: PageContent): Promise<{ issues: QualityIssue[]; summary?: string }> {
  const site = ctx.site;
  const issues = checkQuality(page);
  if (LIGHT_KINDS.has(page.kind) || !site.plan) return { issues };
  try {
    const ai = await ctx.services.content.reviewPage({ brief: site.brief, entity: site.entity, plan: site.plan, page });
    for (const i of ai.issues) issues.push({ code: 'ai_review', severity: i.severity, where: i.where, message: `${i.problem} → ${i.fix}` });
    if (!ai.pass && !ai.issues.some((i) => i.severity === 'major')) issues.push({ code: 'ai_review', severity: 'major', where: 'page', message: ai.summary });
    return { issues, summary: ai.summary };
  } catch (err) {
    // AI duyệt lỗi (mạng, giới hạn) thì không chặn: phần kiểm tra bằng code vẫn có hiệu lực
    ctx.log('warn', `AI duyệt trang lỗi, chỉ dùng kiểm tra tự động: ${errorMessage(err)}`);
    return { issues };
  }
}

/**
 * Sinh → biên tập → kiểm duyệt một trang rồi lưu DB. Dùng cho pipeline và job sinh lại.
 * Không đạt kiểm duyệt: biên tập lại một lần với danh sách lỗi; vẫn không đạt thì lưu trạng thái needs_review,
 * trang không được dựng và không vào sitemap cho đến khi người dùng duyệt hoặc sinh lại.
 */
export async function generateAndSavePage(ctx: StepContext, req: RequiredPage, existingTitles: string[]): Promise<Page> {
  const site = ctx.site;
  if (!site.plan) throw new AppError('Chưa có kế hoạch nội dung');
  const internalLinks = internalLinksFor(ctx, site.plan, req.slug);
  const validPaths = internalLinks.map((l) => l.path.split('#')[0] as string);
  const label = req.slug || 'home';
  const finish = (p: PageContent) => autoFixPage(cleanLinks(p, validPaths));
  const edit = (p: PageContent, feedback?: string[]) => ctx.services.content.editPage({ brief: site.brief, entity: site.entity, domain: site.domain, plan: site.plan as SitePlan, page: p, internalLinks, feedback });

  const draft = await ctx.services.content.generatePage({ brief: site.brief, entity: site.entity, plan: site.plan, domain: site.domain, kind: req.kind, post: req.post, existingTitles, internalLinks });
  let page = finish(draft);
  let editFailed = false;
  if (!LIGHT_KINDS.has(req.kind)) {
    try {
      page = finish(await edit(page));
    } catch (err) {
      editFailed = true;
      ctx.log('warn', `Lượt biên tập trang ${label} lỗi: ${errorMessage(err)}`);
    }
  }

  let review = await reviewContent(ctx, page);
  if (!isPass(review.issues) || editFailed) {
    const majors = review.issues.filter((i) => i.severity === 'major').length;
    ctx.log('info', `Trang ${label} chưa đạt kiểm duyệt (${majors} lỗi bắt buộc), biên tập lại theo danh sách lỗi`, { issues: review.issues });
    try {
      const fixed = finish(await edit(page, issuesToFeedback(review.issues)));
      const second = await reviewContent(ctx, fixed);
      // Giữ bản tốt hơn: bản sửa lại nếu đạt hoặc ít lỗi bắt buộc hơn
      const before = review.issues.filter((i) => i.severity === 'major').length;
      const after = second.issues.filter((i) => i.severity === 'major').length;
      if (after <= before) {
        page = fixed;
        review = second;
      }
      editFailed = false;
    } catch (err) {
      ctx.log('warn', `Biên tập lại trang ${label} lỗi: ${errorMessage(err)}`);
    }
  }

  const pass = isPass(review.issues) && !editFailed;
  const record: ContentReview = { pass, issues: review.issues, summary: review.summary, approvedBy: pass ? 'auto' : undefined, checkedAt: nowIso() };
  const status = pass ? 'published' : 'needs_review';
  if (!pass) ctx.log('warn', `Trang ${label} không đạt kiểm duyệt, giữ lại chờ duyệt: ${review.issues.filter((i) => i.severity === 'major').map((i) => i.message).slice(0, 3).join('; ')}`);
  const id = ctx.db.upsertPage({ site_id: site.id, kind: req.kind, slug: req.slug, title: page.title, content: page, sort_order: req.sortOrder, published_at: nowIso(), status, review: record });
  const saved = ctx.db.getPage(id);
  if (!saved) throw new AppError('Không lưu được trang');
  return saved;
}

const genContent: StepDef = {
  id: 'gen_content',
  label: 'Viết nội dung các trang',
  description: 'AI viết và biên tập từng trang, bài blog',
  branch: 'build',
  deps: ['gen_plan'],
  maxAttempts: 4,
  async run(ctx) {
    const plan = ctx.site.plan;
    if (!plan) throw new AppError('Chưa có kế hoạch nội dung');
    const required = requiredPages(ctx.site.brief, plan);
    const existing = new Map(ctx.db.listPages(ctx.site.id).map((p) => [p.slug, p]));
    const todo = required.filter((r) => !existing.has(r.slug));
    if (todo.length === 0) return { status: 'done', message: `Đủ ${required.length} trang, không sinh thêm` };
    let done = 0;
    let held = 0;
    const titles = [...existing.values()].map((p) => p.title);
    for (const req of todo) {
      ctx.log('info', `Đang viết ${req.kind}${req.slug ? ' /' + req.slug : ''} (${done + 1}/${todo.length})`);
      const page = await generateAndSavePage(ctx, req, titles);
      titles.push(page.title);
      done++;
      if (page.status === 'needs_review') held++;
    }
    const usage = ctx.services.content.usage();
    const heldNote = held ? `; ${held} trang chưa đạt kiểm duyệt, vào Nội dung để duyệt hoặc sinh lại` : '';
    return { status: 'done', message: `Đã viết ${done} trang mới (tổng ${required.length})${heldNote}; token vào ${usage.inputTokens}, ra ${usage.outputTokens}`, output: { ...usage, held } };
  },
};

const genImages: StepDef = {
  id: 'gen_images',
  label: 'Tải ảnh minh họa',
  description: 'Tìm ảnh phù hợp từng trang trên Pexels, chuyển WebP',
  branch: 'build',
  deps: ['gen_content'],
  maxAttempts: 3,
  async run(ctx) {
    const plan = ctx.site.plan;
    if (!plan) throw new AppError('Chưa có kế hoạch nội dung');
    const res = await refreshSiteImages(ctx);
    if (res.fetched + res.reused + res.fromLibrary === 0 && res.slots > 0 && ctx.site.brief.useStockImages) throw new TransientError(`Không tải được ảnh nào: ${res.failed.slice(0, 3).join('; ')}`);
    const msg = `${res.fromLibrary} từ kho ảnh thật, ${res.fetched} ảnh stock mới, ${res.reused} có sẵn${res.skipped ? `, ${res.skipped} vị trí để trống (không dùng stock)` : ''}${res.failed.length ? `, ${res.failed.length} lỗi` : ''}`;
    return { status: 'done', message: msg, output: res };
  },
};

/** Gán ảnh cho mọi vị trí: kho ảnh thật trước, ảnh stock sau (nếu site cho phép). */
export async function refreshSiteImages(ctx: StepContext, opts: { force?: boolean } = {}): Promise<{ slots: number; fromLibrary: number; fetched: number; reused: number; skipped: number; failed: string[] }> {
  const plan = ctx.site.plan;
  if (!plan) throw new AppError('Chưa có kế hoạch nội dung');
  const pages = ctx.db.listPages(ctx.site.id);
  const slots = collectImageSlots(pages, plan, ctx.site.brief.brandName);
  const dirs = siteDirs(ctx.config.sitesDir, ctx.site.domain);
  if (opts.force) ctx.db.deleteAutoImagesOfSite(ctx.site.id);
  const fromLibrary = assignLibraryToSlots(ctx.db, ctx.site.id, slots, dirs.images, { force: opts.force });
  const res = await fetchImagesForSlots({ db: ctx.db, siteId: ctx.site.id, slots, provider: ctx.services.images, cacheDir: dirs.images, language: ctx.site.brief.language, useStock: ctx.site.brief.useStockImages, log: (m, d) => ctx.log('info', m, d) });
  return { slots: slots.length, fromLibrary, ...res };
}

export async function runBuild(ctx: StepContext): Promise<{ files: number; urls: string[]; warnings: string[] }> {
  const res = await buildSite({ db: ctx.db, site: ctx.site, sitesDir: ctx.config.sitesDir, uploadsDir: ctx.config.uploadsDir, log: (m, d) => ctx.log('info', m, d) });
  ctx.updateSite({ last_built_at: nowIso() });
  for (const w of res.warnings) ctx.log('warn', w);
  return res;
}

const build: StepDef = {
  id: 'build',
  label: 'Dựng website tĩnh',
  description: 'Xuất HTML, CSS, ảnh, sitemap, robots, JSON-LD',
  branch: 'build',
  deps: ['gen_images'],
  maxAttempts: 3,
  async run(ctx) {
    const held = ctx.db.listPagesNeedingReview(ctx.site.id);
    if (held.some((p) => p.kind === 'home')) throw new AppError('Trang chủ chưa đạt kiểm duyệt chất lượng. Vào Nội dung, xem lỗi rồi bấm "Duyệt và đăng" hoặc "Sinh lại", sau đó chạy lại bước này.');
    const res = await runBuild(ctx);
    const heldNote = held.length ? `; ${held.length} trang chờ duyệt không được dựng` : '';
    return { status: 'done', message: `${res.files} tệp, ${res.urls.length} URL${heldNote}`, output: { files: res.files, urls: res.urls.length, held: held.length } };
  },
};

export async function runDeploy(ctx: StepContext): Promise<{ files: number; bytes: number; unchanged: number; removed: number }> {
  const server = requireServer(ctx);
  const remoteDir = ctx.site.site_path;
  if (!remoteDir) throw new AppError('Chưa biết thư mục site trên host (host_site chưa chạy)');
  const dirs = siteDirs(ctx.config.sitesDir, ctx.site.domain);
  if (!fs.existsSync(path.join(dirs.out, 'index.html'))) throw new AppError('Chưa có bản dựng (build chưa chạy)');
  const ssh = await ctx.services.sshFor(server);
  let res: { files: number; bytes: number; unchanged: number; removed: number };
  try {
    res = await ssh.uploadDirectory(dirs.out, remoteDir, { owner: 'www:www' });
    ctx.updateSite({ last_deployed_at: nowIso() });
  } finally {
    await ssh.close();
  }
  if (res.files === 0 && res.removed === 0) {
    ctx.log('info', `Host đã có đúng bản dựng này (${res.unchanged} tệp), không cần tải lên`);
    return res;
  }
  // Xóa bộ đệm Cloudflare để logo, CSS, ảnh mới hiện ngay thay vì bản cũ
  if (ctx.site.cf_zone_id && ctx.site.cf_zone_status === 'active') {
    try {
      await ctx.services.cloudflare.purgeCache(ctx.site.cf_zone_id);
      ctx.log('info', 'Đã xóa bộ đệm Cloudflare');
    } catch (err) {
      ctx.log('warn', `Không xóa được bộ đệm Cloudflare: ${errorMessage(err)}`);
    }
  }
  return res;
}

const deploy: StepDef = {
  id: 'deploy',
  label: 'Đưa website lên host',
  description: 'Tải các tệp thay đổi lên aaPanel qua SSH rồi hoán đổi thư mục',
  branch: 'build',
  deps: ['build', 'host_site'],
  maxAttempts: 4,
  async run(ctx) {
    const res = await runDeploy(ctx);
    return { status: 'done', message: `${res.files} tệp đã lên ${ctx.site.site_path}`, output: res };
  },
};

/* ------------------------------------------------------------------ */
/*  Hoàn tất                                                            */
/* ------------------------------------------------------------------ */

const verifyLive: StepDef = {
  id: 'verify_live',
  label: 'Kiểm tra site chạy qua HTTPS',
  description: 'Truy cập https://domain và xác nhận đúng nội dung đã dựng',
  branch: 'final',
  deps: ['cf_ratelimit', 'deploy'],
  maxAttempts: 3,
  async run(ctx) {
    if (ctx.config.isMock) return { status: 'done', message: 'Mock: bỏ qua kiểm tra mạng' };
    const domain = ctx.site.domain;
    const server = requireServer(ctx);

    // 1. Máy chủ gốc: HTTP + Host header, không qua Cloudflare, xác nhận Nginx đang phục vụ đúng bản dựng
    const origin = await probeOrigin(domain, server.ip);
    if (origin.status === null) return { status: 'waiting', retryInMs: 3 * MIN, message: `Không kết nối được origin ${server.ip}:80 (${origin.error ?? ''}). Kiểm tra Nginx và tường lửa cổng 80. Thử lại sau 3 phút.` };
    if (origin.ok && !origin.hasMarker) throw new AppError(`Origin trả về 200 nhưng không phải bản dựng của hệ thống. Kiểm tra thư mục gốc site trong aaPanel (${ctx.site.site_path ?? ''}) và domain đã gắn đúng site chưa.`);
    if (!origin.ok) return { status: 'waiting', retryInMs: 3 * MIN, message: `Origin trả về HTTP ${origin.status} (Nginx chưa reload hoặc site chưa gắn domain). Thử lại sau 3 phút.` };

    // 2. Qua Cloudflare như người dùng thật
    const edge = await probeEdge(domain);
    if (edge.ok && edge.hasMarker) return { status: 'done', message: `Origin OK ${origin.ms}ms; HTTPS qua Cloudflare 200 ${edge.ms}ms` };
    if (edge.status === 403) {
      ctx.log('warn', 'Cloudflare trả 403 cho yêu cầu tự động của hệ thống (Bot Fight Mode hoặc rule WAF chặn), origin vẫn phục vụ đúng bản dựng');
      return { status: 'done', message: `Origin OK ${origin.ms}ms. Cloudflare chặn client tự động (HTTP 403, thường do Bot Fight Mode), người dùng thật bằng trình duyệt vẫn vào bình thường; hãy mở https://${domain}/ để xác nhận.` };
    }
    if (edge.status === 525 || edge.status === 526) throw new AppError(`Cloudflare báo ${edge.status}: SSL mode chưa phải Flexible. Kiểm tra bước SSL.`);
    if (edge.status === 521 || edge.status === 522 || edge.status === 523) return { status: 'waiting', retryInMs: 3 * MIN, message: `Cloudflare báo ${edge.status}: chưa nối được origin từ Cloudflare (bản ghi A sai IP hoặc tường lửa). Thử lại sau 3 phút.` };
    if (edge.status === null) return { status: 'waiting', retryInMs: 3 * MIN, message: `Chưa truy cập được qua HTTPS (${edge.error ?? ''}), DNS có thể chưa lan truyền. Thử lại sau 3 phút.` };
    if (edge.ok && !edge.hasMarker) return { status: 'waiting', retryInMs: 3 * MIN, message: `HTTPS 200 nhưng nội dung chưa phải bản dựng mới (cache Cloudflare hoặc DNS trỏ nơi khác). Thử lại sau 3 phút.` };
    return { status: 'waiting', retryInMs: 3 * MIN, message: `HTTPS trả về ${edge.status}, thử lại sau 3 phút` };
  },
};

const gscVerify: StepDef = {
  id: 'gsc_verify',
  label: 'Xác minh Google Search Console',
  description: 'Xác minh quyền sở hữu qua thẻ meta, thêm email của bạn làm chủ sở hữu',
  branch: 'final',
  deps: ['verify_live'],
  maxAttempts: 3,
  async run(ctx) {
    const google = ctx.services.google;
    if (!google) return { status: 'skipped', message: 'Chưa cấu hình Google service account' };
    if (ctx.site.google_verified) return { status: 'done', message: 'Đã xác minh trước đó' };
    if (!ctx.site.google_verification_token) return { status: 'skipped', message: 'Không có token xác minh (lấy token thất bại ở bước kế hoạch)' };
    const siteUrl = `https://${ctx.site.domain}/`;
    const owners = ctx.config.GOOGLE_OWNER_EMAIL ? [ctx.config.GOOGLE_OWNER_EMAIL] : [];
    try {
      await google.verifySite(siteUrl, owners);
      ctx.updateSite({ google_verified: 1 });
      return { status: 'done', message: `Đã xác minh${owners.length ? `, chủ sở hữu: ${owners.join(', ')}` : ''}` };
    } catch (err) {
      if (err instanceof VerificationPendingError) return { status: 'waiting', retryInMs: 10 * MIN, message: `Google chưa thấy thẻ meta, thử lại sau 10 phút` };
      ctx.log('error', `Xác minh Google lỗi, bỏ qua: ${errorMessage(err)}`);
      return { status: 'done', message: `Lỗi, bỏ qua: ${errorMessage(err)}` };
    }
  },
};

const gscSitemap: StepDef = {
  id: 'gsc_sitemap',
  label: 'Gửi sitemap lên Google',
  description: 'Thêm property Search Console và gửi sitemap.xml',
  branch: 'final',
  deps: ['gsc_verify'],
  maxAttempts: 3,
  async run(ctx) {
    const google = ctx.services.google;
    if (!google || !ctx.site.google_verified) return { status: 'skipped', message: 'Chưa xác minh Google' };
    const siteUrl = `https://${ctx.site.domain}/`;
    try {
      await google.addSearchConsoleProperty(siteUrl);
      await google.submitSitemap(siteUrl, `${siteUrl}sitemap.xml`);
      return { status: 'done', message: 'Đã gửi sitemap.xml' };
    } catch (err) {
      ctx.log('error', `Gửi sitemap lỗi, bỏ qua: ${errorMessage(err)}`);
      return { status: 'done', message: `Lỗi, bỏ qua: ${errorMessage(err)}` };
    }
  },
};

export async function submitIndexNow(ctx: StepContext, urls?: string[]): Promise<string> {
  const key = ctx.site.indexnow_key;
  if (!key) return 'Không có khóa IndexNow';
  const list = urls ?? ctx.db.listPages(ctx.site.id).map((p) => (p.slug ? `https://${ctx.site.domain}/${p.slug}/` : `https://${ctx.site.domain}/`));
  const res = await ctx.services.indexnow.submit(ctx.site.domain, key, list);
  return `${list.length} URL, IndexNow trả về ${res.status} (${INDEXNOW_STATUS_TEXT[res.status] ?? 'không rõ'})`;
}

const indexnow: StepDef = {
  id: 'indexnow',
  label: 'Gửi IndexNow',
  description: 'Báo Bing, Yandex và các bộ máy khác về các URL mới',
  branch: 'final',
  deps: ['verify_live'],
  maxAttempts: 3,
  async run(ctx) {
    try {
      const msg = await submitIndexNow(ctx);
      return { status: 'done', message: msg };
    } catch (err) {
      ctx.log('error', `IndexNow lỗi, bỏ qua: ${errorMessage(err)}`);
      return { status: 'done', message: `Lỗi, bỏ qua: ${errorMessage(err)}` };
    }
  },
};

const live: StepDef = {
  id: 'live',
  label: 'Hoàn tất',
  description: 'Site đã hoạt động đầy đủ',
  branch: 'final',
  deps: ['gsc_sitemap', 'indexnow'],
  maxAttempts: 1,
  async run(ctx): Promise<StepResult> {
    ctx.updateSite({ live_at: ctx.site.live_at ?? nowIso(), error_summary: null });
    return { status: 'done', message: `https://${ctx.site.domain}/ đã sẵn sàng` };
  },
};

export const STEPS: StepDef[] = [cfZone, cfWaitActive, cfDns, cfSettings, cfWaf, cfRateLimit, hostSite, genPlan, genContent, genImages, build, deploy, verifyLive, gscVerify, gscSitemap, indexnow, live];

export const STEP_BY_ID = new Map(STEPS.map((s) => [s.id, s]));
