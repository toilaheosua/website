import fs from 'node:fs';
import type { AppConfig } from '../config.js';
import type { Db, JobRow } from '../db/index.js';
import type { Services } from '../services/types.js';
import type { StepDef } from './pipeline.js';
import { makeStepContext } from './context.js';
import { AppError } from './errors.js';
import { errorMessage, safeJsonParse, slugify } from './util.js';
import { applyRateLimit, applyWafRules, generateAndSavePage, refreshSiteImages, requiredPages, reviewContent, runBuild, runDeploy, submitIndexNow, type RequiredPage } from './steps.js';
import { isPass, type ContentReview } from '../generator/quality.js';
import { answeredCount, mergeEntitySuggestion } from './interview.js';
import { siteDirs } from '../generator/builder.js';
import { saveLibraryImage } from '../generator/library.js';
import { checkSiteHealth } from '../monitor/health.js';
import { replaceTextInSite } from './rename.js';
import { ROUTES } from '../generator/render-context.js';

export interface JobEnv {
  db: Db;
  config: AppConfig;
  services: Services;
  steps: StepDef[];
  job: JobRow;
}

type Handler = (env: JobEnv, payload: Record<string, unknown>) => Promise<unknown>;

function siteCtx(env: JobEnv, scope: string) {
  const siteId = env.job.site_id;
  if (!siteId) throw new AppError('Job thiếu site_id');
  const site = env.db.getSite(siteId);
  if (!site) throw new AppError(`Site #${siteId} không tồn tại`);
  return makeStepContext(env.db, env.config, env.services, site, scope);
}

async function refreshImages(ctx: ReturnType<typeof makeStepContext>) {
  if (!ctx.site.plan) return;
  const res = await refreshSiteImages(ctx);
  if (res.failed.length) ctx.log('warn', `Ảnh lỗi: ${res.failed.join('; ')}`);
}

const handlers: Record<string, Handler> = {
  /** Đồng bộ Entity / dựng lại + đưa lên host. */
  async rebuild_deploy(env) {
    const ctx = siteCtx(env, 'rebuild_deploy');
    if (!ctx.site.site_path) throw new AppError('Site chưa được thêm vào aaPanel, chưa thể deploy');
    const b = await runBuild(ctx);
    const d = await runDeploy(ctx);
    ctx.log('info', `Dựng lại và đưa lên host: ${b.files} tệp dựng, ${d.files} tệp tải lên, ${d.unchanged} giữ nguyên${d.removed ? `, ${d.removed} xóa` : ''}`);
    return { built: b.files, uploaded: d.files, unchanged: d.unchanged, removed: d.removed };
  },

  /**
   * Kiểm duyệt lại nội dung đã có (không viết lại): chạy kiểm tra tự động + AI duyệt, lưu kết quả.
   * Trang đã đăng vẫn giữ nguyên trên website; chỉ gắn nhãn để người dùng quyết định sửa hay sinh lại.
   * payload: { pageId? } (không có = tất cả trang).
   */
  async review_pages(env, payload) {
    const ctx = siteCtx(env, 'review_pages');
    const pageId = payload.pageId ? Number(payload.pageId) : null;
    const pages = ctx.db.listPages(ctx.site.id).filter((p) => (pageId ? p.id === pageId : true));
    if (!pages.length) throw new AppError('Không có trang để kiểm duyệt');
    let passed = 0;
    let failed = 0;
    for (const page of pages) {
      const r = await reviewContent(ctx, page.content);
      const pass = isPass(r.issues);
      const record: ContentReview = { pass, issues: r.issues, summary: r.summary, approvedBy: pass ? 'auto' : undefined, checkedAt: new Date().toISOString() };
      ctx.db.setPageStatus(page.id, page.status === 'needs_review' ? 'needs_review' : 'published', record);
      pass ? passed++ : failed++;
      ctx.log(pass ? 'info' : 'warn', `Kiểm duyệt "${page.title}": ${pass ? 'đạt' : `chưa đạt, ${r.issues.filter((i) => i.severity === 'major').length} lỗi bắt buộc`}${r.issues.length ? ` (${r.issues.length} ghi chú)` : ''}`);
    }
    ctx.log('info', `Kiểm duyệt lại ${pages.length} trang: ${passed} đạt, ${failed} chưa đạt`);
    return { pages: pages.length, passed, failed };
  },

  /**
   * Rút thông tin từ Bộ Câu Hỏi vào Entity SEO bằng AI: chỉ điền trường đang trống
   * (payload.overwrite = true thì ghi đè), rồi dựng lại để JSON-LD cập nhật.
   */
  async apply_interview(env, payload) {
    const ctx = siteCtx(env, 'apply_interview');
    const interview = ctx.site.interview;
    if (!interview || answeredCount(interview) === 0) throw new AppError('Bộ Câu Hỏi chưa có câu trả lời nào');
    const suggestion = await ctx.services.content.extractEntityFromInterview({ brief: ctx.site.brief, entity: ctx.site.entity, interview });
    const { entity, changed } = mergeEntitySuggestion(ctx.site.entity, suggestion, Boolean(payload.overwrite));
    if (!changed.length) {
      ctx.log('info', 'Bộ Câu Hỏi: không có trường Entity nào cần cập nhật (các trường có thông tin đều đã điền)');
      return { changed: [] };
    }
    ctx.updateSite({ entity });
    ctx.log('info', `Bộ Câu Hỏi → Entity: cập nhật ${changed.length} trường: ${changed.join(', ')}`);
    if (ctx.site.plan && ctx.site.site_path) {
      await runBuild(ctx);
      await runDeploy(ctx);
    }
    return { changed };
  },

  async health_check(env) {
    const ctx = siteCtx(env, 'health_check');
    const prev = ctx.site.health;
    const report = await checkSiteHealth({
      domain: ctx.site.domain,
      serverIp: ctx.server?.ip ?? null,
      zoneId: ctx.site.cf_zone_id,
      cloudflare: env.config.isMock ? null : env.services.cloudflare,
      expectedSslMode: 'flexible',
      skipNetwork: env.config.isMock,
    });
    ctx.updateSite({ health: report });
    if (!report.ok && (!prev || prev.ok)) {
      ctx.log('warn', `Health check lỗi: ${report.message}`);
      await env.services.notifier.send(`⚠️ ${ctx.site.domain}: ${report.message}`);
    } else if (report.ok && prev && !prev.ok) {
      await env.services.notifier.send(`✅ ${ctx.site.domain} đã ổn định trở lại`);
    }
    return report;
  },

  /** Sinh thêm bài blog mới (count bài hoặc theo chủ đề cho trước) rồi dựng lại, deploy, IndexNow. */
  async generate_post(env, payload) {
    const ctx = siteCtx(env, 'generate_post');
    const plan = ctx.site.plan;
    if (!plan) throw new AppError('Site chưa có kế hoạch nội dung');
    const count = Math.max(1, Math.min(5, Number(payload.count ?? 1)));
    const topic = typeof payload.topic === 'string' && payload.topic.trim() ? payload.topic.trim() : '';
    const existing = ctx.db.listPages(ctx.site.id);
    const existingTitles = existing.map((p) => p.title);
    const r = ROUTES[ctx.site.brief.language];
    let topics = topic
      ? [{ title: topic, slug: slugify(topic), targetKeyword: topic, angle: String(payload.angle ?? 'Góc nhìn thực tế, hướng dẫn cụ thể'), imageQuery: String(payload.imageQuery ?? plan.heroImageQuery) }]
      : await ctx.services.content.suggestPostTopics({ brief: ctx.site.brief, plan, existingTitles, count });
    topics = topics.slice(0, count);
    const created: string[] = [];
    let order = 10 + existing.filter((p) => p.kind === 'post').length;
    for (const t of topics) {
      const slug = `${r.blog}/${t.slug ?? slugify(t.title)}`;
      if (existing.some((p) => p.slug === slug)) continue;
      const req: RequiredPage = { kind: 'post', slug, sortOrder: order++, post: t };
      const page = await generateAndSavePage(ctx, req, existingTitles);
      existingTitles.push(page.title);
      if (page.status === 'published') created.push(`https://${ctx.site.domain}/${slug}/`);
      else ctx.log('warn', `Bài "${page.title}" chưa đạt kiểm duyệt, giữ lại chờ duyệt`);
    }
    ctx.updateSite({ plan: { ...plan, posts: [...plan.posts, ...topics.filter((t) => !plan.posts.some((p) => p.slug === t.slug))] } });
    await refreshImages(ctx);
    await runBuild(ctx);
    if (ctx.site.site_path) await runDeploy(ctx);
    if (created.length && ctx.site.status === 'live') {
      try {
        ctx.log('info', await submitIndexNow(ctx, created));
      } catch (err) {
        ctx.log('warn', `IndexNow lỗi: ${errorMessage(err)}`);
      }
    }
    ctx.log('info', `Đã thêm ${created.length} bài: ${created.join(', ')}`);
    return { created };
  },

  /** Sinh lại một trang (giữ slug), rồi dựng lại và deploy. */
  async regenerate_page(env, payload) {
    const ctx = siteCtx(env, 'regenerate_page');
    const plan = ctx.site.plan;
    if (!plan) throw new AppError('Site chưa có kế hoạch nội dung');
    const pageId = Number(payload.pageId);
    const page = ctx.db.getPage(pageId);
    if (!page || page.site_id !== ctx.site.id) throw new AppError('Trang không tồn tại');
    const req = requiredPages(ctx.site.brief, plan).find((p) => p.slug === page.slug) ?? {
      kind: page.kind as RequiredPage['kind'],
      slug: page.slug,
      sortOrder: page.sort_order,
      post: page.kind === 'post' ? { title: page.title, slug: page.slug.replace(/^blog\//, ''), targetKeyword: page.content.targetKeyword ?? '', angle: 'Góc nhìn mới, cụ thể hơn', imageQuery: page.content.heroImageQuery ?? plan.heroImageQuery } : undefined,
    };
    const titles = ctx.db.listPages(ctx.site.id).filter((p) => p.id !== pageId).map((p) => p.title);
    await generateAndSavePage(ctx, req, titles);
    await refreshImages(ctx);
    await runBuild(ctx);
    if (ctx.site.site_path) await runDeploy(ctx);
    return { slug: page.slug };
  },

  /** Thay chữ trong toàn bộ nội dung đã sinh rồi dựng lại, deploy. payload: { pairs: [[from,to],...] } */
  async replace_text(env, payload) {
    const ctx = siteCtx(env, 'replace_text');
    const pairs = (Array.isArray(payload.pairs) ? payload.pairs : []) as [string, string][];
    const r = replaceTextInSite(env.db, ctx.site.id, pairs);
    ctx.log('info', `Thay chữ: ${r.replacements} chỗ trong ${r.pages} trang (${pairs.map(([a, b]) => `"${a}" → "${b}"`).join(', ')})`);
    if (r.replacements > 0 && ctx.site.plan) {
      ctx.refreshSite();
      await runBuild(ctx);
      if (ctx.site.site_path) await runDeploy(ctx);
    }
    return r;
  },

  /** Nhập ảnh từ Google Maps của chính doanh nghiệp. payload: { query, includeUserPhotos } */
  async import_google_photos(env, payload) {
    const ctx = siteCtx(env, 'import_google_photos');
    const places = env.services.places;
    if (!places) throw new AppError('Chưa có Google Maps Platform API key. Nhập trong Cài đặt → Khóa API.');
    const place = await places.resolvePlace(String(payload.query ?? ''));
    const photos = await places.listPhotos(place.id);
    const brand = ctx.site.brief.brandName;
    const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
    const isOwner = (author: string) => author && (norm(author) === norm(place.displayName) || norm(author) === norm(brand));
    const includeUser = Boolean(payload.includeUserPhotos);
    const dirs = siteDirs(env.config.sitesDir, ctx.site.domain);
    let added = 0;
    let skippedUser = 0;
    let existing = 0;
    for (const [i, p] of photos.entries()) {
      const owner = isOwner(p.authorName);
      if (!owner && !includeUser) {
        skippedUser++;
        continue;
      }
      if (env.db.hasLibrarySource(ctx.site.id, p.name)) {
        existing++;
        continue;
      }
      const buffer = await places.downloadPhoto(p.name, 1600);
      await saveLibraryImage({ db: env.db, siteId: ctx.site.id, cacheDir: dirs.images, buffer, alt: `${brand} ${i + 1}`, tags: owner ? ['google', 'chu-quan'] : ['google', 'khach'], source: 'google', sourceRef: p.name, credit: owner ? '' : p.authorName, nameHint: `google-${i + 1}` });
      added++;
    }
    ctx.log('info', `Google Maps "${place.displayName}": ${photos.length} ảnh, thêm ${added}, đã có ${existing}, bỏ qua ${skippedUser} ảnh của khách`);
    return { place: place.displayName, total: photos.length, added, existing, skippedUser };
  },

  /** Gán lại toàn bộ ảnh (kho ảnh thật trước) rồi dựng lại và deploy. */
  async reassign_images(env) {
    const ctx = siteCtx(env, 'reassign_images');
    if (!ctx.site.plan) throw new AppError('Site chưa có kế hoạch nội dung');
    const res = await refreshSiteImages(ctx, { force: true });
    ctx.log('info', `Gán lại ảnh: ${res.fromLibrary} từ kho thật, ${res.fetched} stock mới, ${res.skipped} để trống`);
    await runBuild(ctx);
    if (ctx.site.site_path) await runDeploy(ctx);
    return res;
  },

  async sync_waf(env) {
    const ctx = siteCtx(env, 'sync_waf');
    if (!ctx.site.cf_zone_id) throw new AppError('Site chưa có zone Cloudflare');
    const a = await applyWafRules(ctx);
    const b = await applyRateLimit(ctx);
    ctx.log('info', `Đồng bộ WAF: ${a}; ${b}`);
    return { waf: a, ratelimit: b };
  },

  async sync_all_waf(env) {
    let n = 0;
    for (const s of env.db.listSites()) {
      if (s.cf_zone_id && s.cf_zone_status === 'active') {
        env.db.enqueueJob('sync_waf', s.id, null, { dedupe: true });
        n++;
      }
    }
    return { queued: n };
  },

  async delete_site(env, payload) {
    const ctx = siteCtx(env, 'delete_site');
    const site = ctx.site;
    const errors: string[] = [];
    if (payload.deleteZone && site.cf_zone_id) {
      try {
        await env.services.cloudflare.deleteZone(site.cf_zone_id);
        ctx.log('info', 'Đã xóa zone Cloudflare');
      } catch (err) {
        errors.push(`Cloudflare: ${errorMessage(err)}`);
      }
    }
    if (payload.deletePanelSite && site.panel_site_id && ctx.server) {
      try {
        const panel = env.services.panelFor(ctx.server);
        const ps = await panel.findSite(site.domain);
        if (ps) await panel.deleteSite(ps);
        ctx.log('info', 'Đã xóa site trong aaPanel');
      } catch (err) {
        errors.push(`aaPanel: ${errorMessage(err)}`);
      }
    }
    if (errors.length && !payload.force) throw new AppError(`Chưa xóa được hoàn toàn: ${errors.join('; ')}. Chọn "xóa bất chấp" để xóa khỏi dashboard.`);
    const dirs = siteDirs(env.config.sitesDir, site.domain);
    fs.rmSync(dirs.root, { recursive: true, force: true });
    env.db.deleteSite(site.id);
    return { errors };
  },
};

export async function runJob(env: JobEnv): Promise<unknown> {
  const handler = handlers[env.job.type];
  if (!handler) throw new AppError(`Không có job kiểu ${env.job.type}`);
  const payload = safeJsonParse<Record<string, unknown>>(env.job.payload, {});
  return handler(env, payload);
}

export const JOB_LABELS: Record<string, string> = {
  rebuild_deploy: 'Dựng lại và đưa lên host',
  review_pages: 'Kiểm duyệt lại nội dung',
  apply_interview: 'Cập nhật Entity từ Bộ Câu Hỏi',
  health_check: 'Kiểm tra sức khỏe',
  generate_post: 'Viết bài blog mới',
  regenerate_page: 'Sinh lại trang',
  sync_waf: 'Đồng bộ WAF',
  replace_text: 'Thay chữ toàn site',
  import_google_photos: 'Nhập ảnh từ Google Maps',
  reassign_images: 'Gán lại ảnh và dựng lại',
  sync_all_waf: 'Đồng bộ WAF tất cả site',
  delete_site: 'Xóa site',
};
