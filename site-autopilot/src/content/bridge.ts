import fs from 'node:fs';
import path from 'node:path';
import type { Context, Hono } from 'hono';
import type { AppConfig } from '../config.js';
import type { Db, Site, ToolRunRow } from '../db/index.js';
import type { Services } from '../services/types.js';
import { makeStepContext } from '../core/context.js';
import { internalLinksFor } from '../core/steps.js';
import { buildManualPost } from '../core/manual-post.js';
import { parseImportedPost, rewriteImageRefs } from '../core/import-post.js';
import { answeredCount, interviewBlock } from '../core/interview.js';
import { saveLibraryImage } from '../generator/library.js';
import { siteDirs } from '../generator/builder.js';
import { sanitizeInternalLinks } from '../generator/markdown.js';
import { autoFixPage, checkQuality, isPass, type ContentReview } from '../generator/quality.js';
import { ROUTES } from '../generator/render-context.js';
import { errorMessage, slugify } from '../core/util.js';
import { createLogger } from '../core/logger.js';
// Mô-đun Tool Viết Content (gộp từ dự án viet-content)
import type { AppConfig as ToolConfig } from '../content-tool/config.js';
import { Db as ToolDb, type Run } from '../content-tool/db/index.js';
import { createServices as createToolServices } from '../content-tool/services/index.js';
import { SecretStore as ToolSecretStore, loadMasterKey as loadToolMasterKey } from '../content-tool/core/secrets.js';
import { Worker as ToolWorker } from '../content-tool/core/worker.js';
import { createApp as createToolApp } from '../content-tool/web/server.js';
import { GeneralSettingsSchema as ToolSettingsSchema, RunOptionsSchema, type PlacesData, type RunOptions } from '../content-tool/core/types.js';
import { buildRunBundle, latestArticle } from '../content-tool/core/pipeline.js';
import type { ManualPostInput } from '../core/manual-post.js';
import type { Flash } from '../web/layout.js';

const log = createLogger('content-tool');

export type ToolRunKind = 'web' | 'roundup' | 'brand';

export interface CreateRunInput {
  kind: ToolRunKind;
  /** Từ khóa (kiểu web) hoặc tiêu đề gợi ý */
  keyword: string;
  title?: string;
  angle?: string;
  /** Tổng hợp quán */
  dish?: string;
  area?: string;
  /** Giới thiệu thương hiệu */
  mapsUrl?: string;
  /** Đường dẫn bài mong muốn (blog/...), trống = tự đặt theo tiêu đề */
  slug?: string;
}

/**
 * Cầu nối giữa dashboard bot và Tool Viết Content: một tiến trình, một DB khóa dùng chung,
 * bài viết xong tự nhập vào site như bài thủ công (ảnh vào kho, liên kết nội bộ, cổng chất lượng bằng code).
 */
export class ContentToolBridge {
  readonly config: ToolConfig;
  readonly db: ToolDb;
  readonly services: ReturnType<typeof createToolServices>;
  readonly worker: ToolWorker;
  private app: Hono | null = null;

  constructor(
    private readonly bot: { db: Db; config: AppConfig; services: Services },
    opts: { dbPath?: string } = {},
  ) {
    const c = bot.config;
    this.config = {
      NODE_ENV: c.NODE_ENV,
      PORT: c.PORT,
      HOST: c.HOST,
      BASE_URL: '',
      DATA_DIR: c.DATA_DIR,
      SESSION_SECRET: c.SESSION_SECRET,
      ADMIN_USER: c.ADMIN_USER,
      ADMIN_PASSWORD: c.ADMIN_PASSWORD,
      MOCK_MODE: c.MOCK_MODE,
      WORKER_CONCURRENCY: 1,
      ANTHROPIC_API_KEY: c.ANTHROPIC_API_KEY,
      ANTHROPIC_MODEL: c.ANTHROPIC_MODEL,
      ANTHROPIC_RESEARCH_MODEL: 'claude-sonnet-5',
      OPENROUTER_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      SEARCH_PROVIDER: 'serpapi',
      SERPAPI_KEY: '',
      GOOGLE_CSE_KEY: '',
      GOOGLE_CSE_CX: '',
      ORIGINALITY_API_KEY: '',
      dataDir: c.dataDir,
      exportsDir: path.join(c.dataDir, 'content-exports'),
      dbPath: opts.dbPath ?? path.join(c.dataDir, 'viet-content.sqlite'),
      isMock: c.isMock,
    };
    fs.mkdirSync(this.config.exportsDir, { recursive: true });
    this.db = new ToolDb(this.config.dbPath);
    // Cài đặt lần đầu theo quyết định: OpenRouter mặc định, không chấm Originality trong luồng tự động
    if (this.db.getSetting<unknown>('general', null) === null) {
      this.db.setGeneralSettings(ToolSettingsSchema.parse({ llmProvider: 'openrouter', skipAiDetection: true, writerModel: c.ANTHROPIC_MODEL, researchModel: 'claude-sonnet-5' }));
    }
    // Khóa dùng chung: kho khóa của tool đọc thẳng bảng settings của bot (cùng cách mã hóa, cùng khóa chủ)
    const shared = new ToolSecretStore(bot.db, loadToolMasterKey(c.SESSION_SECRET, c.dataDir));
    this.services = createToolServices(this.config, this.db, shared);
    this.worker = new ToolWorker({ db: this.db, config: this.config, services: this.services, onRunFinished: (run) => this.handleFinished(run) });
  }

  /** Ứng dụng web của tool, gắn vào dashboard bot sau bước đăng nhập. */
  mount(shell: (c: Context, title: string, body: unknown, opts: { refresh?: number; pollUrl?: string; pollKey?: string; flash?: Flash | null }) => Response | Promise<Response>): Hono {
    this.app = createToolApp({
      db: this.db,
      config: this.config,
      services: this.services,
      worker: this.worker,
      shell,
      publish: {
        sites: () => this.bot.db.listSites().map((s) => ({ id: s.id, domain: s.domain })),
        target: (runId) => {
          const row = this.bot.db.getToolRun(runId);
          const site = row ? this.bot.db.getSite(row.site_id) : undefined;
          if (!row || !site) return null;
          // Bài đã bị xóa trên site thì coi như chưa đăng để cho đăng lại
          const pageId = row.status === 'imported' && row.imported_page_id && this.bot.db.getPage(row.imported_page_id) ? row.imported_page_id : null;
          return { siteId: site.id, domain: site.domain, pageId };
        },
      },
    });
    return this.app;
  }

  start(): void {
    this.worker.start();
  }
  stop(): void {
    this.worker.stop();
    this.db.close();
  }

  /** Chạy hết các bài đang xếp hàng (dùng cho test và mock, không cần timer). */
  async drain(timeoutMs = 60_000): Promise<void> {
    for (const r of this.db.listRunsByStatus('queued', 50)) await this.worker.runToCompletion(r.id, timeoutMs);
  }

  /* ------------------------------------------------------------------ */
  /*  Tạo bài cho site                                                    */
  /* ------------------------------------------------------------------ */

  /** Dữ kiện thật của site đưa vào tool: brief, Entity, Bộ Câu Hỏi. */
  factsFor(site: Site): string {
    const b = site.brief;
    const e = site.entity;
    const lines = [
      `Thương hiệu: ${b.brandName}; ngành: ${b.industry}${b.location ? '; khu vực: ' + b.location : ''}`,
      b.description ? `Mô tả: ${b.description}` : '',
      b.services.length ? `Dịch vụ/sản phẩm: ${b.services.join('; ')}` : '',
      b.usp ? `Điểm khác biệt: ${b.usp}` : '',
      e.telephone ? `Điện thoại: ${e.telephone}` : '',
      [e.address.streetAddress, e.address.addressLocality].filter(Boolean).length ? `Địa chỉ: ${[e.address.streetAddress, e.address.addressLocality, e.address.addressRegion].filter(Boolean).join(', ')}` : '',
      e.openingHours.length ? `Giờ mở cửa: ${e.openingHours.join('; ')}` : '',
      b.notes ? `Ghi chú: ${b.notes}` : '',
    ].filter(Boolean);
    const interview = answeredCount(site.interview) ? interviewBlock(site.interview, 6000) : '';
    return `${lines.join('\n')}${interview ? '\n\n' + interview : ''}`;
  }

  createRunForSite(site: Site, input: CreateRunInput): { run: Run; row: ToolRunRow } {
    const settings = this.db.getGeneralSettings();
    const blog = ROUTES[site.brief.language].blog;
    const style = site.plan?.contentStyle ?? (site.brief.contentStyle === 'auto' ? 'auto' : site.brief.contentStyle);
    const facts = this.factsFor(site);
    const base: Partial<RunOptions> = {
      kind: input.kind,
      style: style as RunOptions['style'],
      notes: [input.angle ? `Góc nhìn: ${input.angle}` : '', `Bài đăng trên website ${site.domain} của ${site.brief.brandName}. Dữ kiện về doanh nghiệp (chỉ dùng khi hợp ngữ cảnh, không bịa thêm):\n${facts}`].filter(Boolean).join('\n\n'),
      comparison: settings.comparisonMode,
    };
    let keyword = input.keyword.trim();
    if (input.kind === 'roundup') {
      base.dish = (input.dish ?? '').trim();
      base.area = (input.area ?? site.brief.location).trim();
      base.placesCount = settings.roundupPlaces;
      keyword = `${base.dish} ${base.area}`.trim();
    }
    if (input.kind === 'brand') {
      base.mapsUrl = (input.mapsUrl ?? site.entity.sameAs.googleMaps).trim();
      base.brandName = site.brief.brandName;
      base.brandInfo = facts;
      keyword = keyword || site.brief.brandName;
    }
    const options = RunOptionsSchema.parse(base);
    const run = this.db.createRun(keyword || input.title || site.brief.brandName, options);
    const slug = input.slug ?? `${blog}/${slugify(input.title ?? keyword)}`;
    this.db.addLog({ run_id: run.id, level: 'info', message: `Tạo từ dashboard bot cho site ${site.domain} (${slug})` });
    const row = this.bot.db.addToolRun({ run_id: run.id, site_id: site.id, slug, title: input.title ?? keyword, kind: input.kind });
    this.worker.enqueue(run.id);
    return { run, row };
  }

  /* ------------------------------------------------------------------ */
  /*  Nhập bài đã xong vào site                                           */
  /* ------------------------------------------------------------------ */

  private async handleFinished(run: Run): Promise<void> {
    const row = this.bot.db.getToolRun(run.id);
    if (!row || row.status === 'imported') return;
    if (run.status === 'failed' || run.status === 'cancelled') {
      this.bot.db.updateToolRun(run.id, { status: 'failed', error: run.error ?? run.status });
      this.bot.db.addLog({ site_id: row.site_id, step: 'content_tool', level: 'warn', message: `Tool Viết Content không hoàn tất bài "${row.title}": ${run.error ?? run.status}` });
      return;
    }
    if (run.status !== 'done' && run.status !== 'needs_review') return;
    const site = this.bot.db.getSite(row.site_id);
    if (!site) return;
    try {
      const page = await this.importRun(site, run, row.slug);
      this.bot.db.addLog({ site_id: site.id, step: 'content_tool', level: 'info', message: `Nhập bài "${page.title}" từ Tool Viết Content (#${run.id}) vào /${page.slug}/${page.status === 'needs_review' ? ', chờ duyệt vì kiểm tra tự động có lỗi' : ''}` });
      if (site.plan && site.site_path && site.status === 'live') this.bot.db.scheduleRebuild(site.id, this.bot.config.REBUILD_DEBOUNCE_SEC);
    } catch (err) {
      this.bot.db.updateToolRun(run.id, { status: 'failed', error: errorMessage(err) });
      this.bot.db.addLog({ site_id: site.id, step: 'content_tool', level: 'error', message: `Không nhập được bài từ Tool Viết Content #${run.id}: ${errorMessage(err)}` });
    }
  }

  /**
   * Chuyển bài của tool thành bài trên site: JSON xuất + ảnh → cùng đường với "Nhập bài từ file",
   * thêm liên kết nội bộ và đoạn nhắc thương hiệu (site doanh nghiệp), chấm bằng cổng kiểm tra code rồi lưu.
   * draft: lưu làm bài nháp (chưa công khai) để người dùng sửa tiêu đề, đường dẫn rồi tự duyệt.
   */
  async importRun(site: Site, run: Run, slug?: string, opts: { draft?: boolean } = {}): Promise<{ id: number; title: string; slug: string; status: string }> {
    const { values, heroLibraryId } = await this.prepareImport(site, run);
    const blog = ROUTES[site.brief.language].blog;
    const finalSlug = slug ?? `${blog}/${slugify(values.slug || values.title)}`;
    const existing = this.bot.db.getPageBySlug(site.id, finalSlug);
    let content = buildManualPost(values, existing?.content);
    content = this.brandTouch(site, content, finalSlug);
    content = autoFixPage(content);
    const issues = checkQuality(content);
    const pass = isPass(issues);
    const draft = opts.draft === true;
    const status = draft || !pass ? 'needs_review' : 'published';
    const summary = draft
      ? `Bài nháp từ Tool Viết Content #${run.id}${pass ? ', đạt kiểm tra tự động' : ', kiểm tra tự động có lỗi'}. Sửa tiêu đề, đường dẫn, meta rồi bấm Duyệt và đăng.`
      : pass
        ? `Bài từ Tool Viết Content #${run.id}, đạt kiểm tra tự động.`
        : `Bài từ Tool Viết Content #${run.id}, kiểm tra tự động có lỗi.`;
    const review: ContentReview = { pass, issues, summary, approvedBy: pass && !draft ? 'auto' : undefined, checkedAt: new Date().toISOString() };
    const posts = this.bot.db.listPages(site.id).filter((p) => p.kind === 'post').length;
    const id = this.bot.db.upsertPage({ site_id: site.id, kind: 'post', slug: finalSlug, title: content.title, content, sort_order: existing?.sort_order ?? 10 + posts, status, review });
    const short = finalSlug.slice(blog.length + 1);
    if (site.plan) {
      const plan = site.plan;
      const posts2 = plan.posts.some((p) => p.slug === short) ? plan.posts.map((p) => (p.slug === short ? { ...p, title: content.title, targetKeyword: content.targetKeyword ?? p.targetKeyword } : p)) : [...plan.posts, { title: content.title, slug: short, targetKeyword: content.targetKeyword ?? run.keyword, angle: `Tool Viết Content (${run.options.kind})`, imageQuery: '' }];
      this.bot.db.updateSite(site.id, { plan: { ...plan, posts: posts2 } });
    }
    if (heroLibraryId) {
      const lib = this.bot.db.getLibraryImage(heroLibraryId);
      if (lib) this.bot.db.upsertImage({ site_id: site.id, key: `post.${short}.hero`, provider: 'manual', provider_id: String(lib.id), query: null, file: lib.file, width: lib.width, height: lib.height, alt: content.heroImageAlt || lib.alt, credit: lib.credit, credit_url: '' });
    }
    this.bot.db.updateToolRun(run.id, { status: 'imported', imported_page_id: id, error: null });
    return { id, title: content.title, slug: finalSlug, status };
  }

  /**
   * Bài của tool → dữ liệu cho form Viết bài thủ công của bot: gói bài + ảnh → nhận diện như "Nhập bài từ file",
   * ảnh vào Kho ảnh, đường dẫn ảnh đổi sang /assets/img/. brandInBody: thêm đoạn nhắc thương hiệu vào cuối thân
   * bài để người dùng thấy và sửa được ngay trong form (luồng nhập tự động thêm đoạn này bằng brandTouch).
   */
  async prepareImport(site: Site, run: Run, opts: { brandInBody?: boolean } = {}): Promise<{ values: ManualPostInput; heroLibraryId?: number; saved: number; notes: string[] }> {
    const bundle = await buildRunBundle(this.db, run, { exportsDir: this.config.exportsDir });
    const entries = [{ name: 'bai.json', data: Buffer.from(JSON.stringify(bundle.json), 'utf8') }, ...bundle.photos.map((p) => ({ name: p.rel, data: p.data }))];
    const parsed = parseImportedPost(entries);
    const dirs = siteDirs(this.bot.config.sitesDir, site.domain);
    const mapping = new Map<string, string>();
    let heroLibraryId: number | undefined;
    let saved = 0;
    for (const img of parsed.images) {
      try {
        const lib = await saveLibraryImage({ db: this.bot.db, siteId: site.id, cacheDir: dirs.images, buffer: img.data, alt: img.alt, tags: ['viet-content', run.options.kind === 'web' ? 'bai-viet' : 'google-maps'], source: 'upload', nameHint: path.parse(img.fileName).name });
        mapping.set(img.ref, `/assets/img/${path.basename(lib.file)}`);
        heroLibraryId ??= lib.id;
        saved++;
      } catch (err) {
        log.warn(`Ảnh ${img.fileName} lỗi: ${errorMessage(err)}`);
      }
    }
    let body = rewriteImageRefs(parsed.values.body, mapping, parsed.missingImages);
    const notes = [...parsed.notes, `Đã đưa ${saved} ảnh vào Kho ảnh thật (tag viet-content)${parsed.missingImages.length ? `; bỏ ${parsed.missingImages.length} ảnh không có trong gói` : ''}`];
    if (opts.brandInBody) {
      const para = this.brandParagraph(site);
      if (para) {
        const headings = [...body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1] ?? '');
        const last = headings[headings.length - 1] ?? '';
        body = /bước tiếp theo|trước khi|kết|lời cuối/i.test(last) ? `${body.trim()}\n\n${para}` : `${body.trim()}\n\n## Bước tiếp theo\n\n${para}`;
        notes.push('Đã thêm đoạn nhắc thương hiệu kèm liên kết nội bộ ở cuối bài; sửa hoặc xóa tùy ý');
      }
    }
    return { values: { ...parsed.values, body }, heroLibraryId, saved, notes };
  }

  /** Đoạn nhắc thương hiệu kèm liên kết nội bộ cho site doanh nghiệp; site vệ tinh hoặc tắt "Nhắc thương hiệu" thì không có. */
  brandParagraph(site: Site): string | null {
    if (site.brief.siteType !== 'business' || !site.brief.brandMention) return null;
    const r = ROUTES[site.brief.language];
    const e = site.entity;
    const address = [e.address.streetAddress, e.address.addressLocality].filter(Boolean).join(', ');
    return `Nếu bạn ở ${site.brief.location || 'gần đây'} và muốn thử tận nơi, ghé **[${site.brief.brandName}](/)**${address ? ` tại ${address}` : ''}${e.telephone ? `, gọi ${e.telephone}` : ''} hoặc xem [cách liên hệ](/${r.contact}/) và các [bài viết khác](/${r.blog}/) trên trang này.`;
  }

  /** Site doanh nghiệp: thêm đoạn nhắc thương hiệu kèm liên kết nội bộ hợp lệ; site vệ tinh: chỉ lọc liên kết. */
  private brandTouch(site: Site, content: ReturnType<typeof buildManualPost>, slug: string) {
    const ctx = makeStepContext(this.bot.db, this.bot.config, this.bot.services, site, 'content_tool');
    const links = site.plan ? internalLinksFor(ctx, site.plan, slug) : [];
    const validPaths = links.map((l) => l.path.split('#')[0] as string);
    let sections = content.sections;
    const para = this.brandParagraph(site);
    if (para) {
      const last = sections[sections.length - 1];
      if (last && /bước tiếp theo|trước khi|kết|lời cuối/i.test(last.heading)) sections = [...sections.slice(0, -1), { ...last, body: `${last.body.trim()}\n\n${para}` }];
      else sections = [...sections, { heading: 'Bước tiếp theo', body: para }];
    }
    const fix = (md: string) => sanitizeInternalLinks(md, validPaths);
    return { ...content, intro: fix(content.intro), sections: sections.map((s) => ({ ...s, body: fix(s.body) })), faq: content.faq.map((f) => ({ ...f, answer: fix(f.answer) })) };
  }

  /** Tình trạng bài của một site để hiện trên dashboard. */
  runsForSite(siteId: number): (ToolRunRow & { run?: Run })[] {
    return this.bot.db.listToolRuns(siteId).map((row) => ({ ...row, run: this.db.getRun(row.run_id) }));
  }

  /** Bài đã viết xong trong tool nhưng chưa gắn với site nào (để "Nhập từ bài đã viết"). */
  unassignedFinishedRuns(): Run[] {
    const assigned = new Set(this.bot.db.listToolRuns().map((r) => r.run_id));
    return this.db.listRuns(200).filter((r) => (r.status === 'done' || r.status === 'needs_review') && !assigned.has(r.id));
  }
}
