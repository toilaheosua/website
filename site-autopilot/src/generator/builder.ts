import fs from 'node:fs';
import path from 'node:path';
import type { Db, Page, Site } from '../db/index.js';
import { buildBrandAssets } from './logo.js';
import { copyImagesToOutput } from './images.js';
import { layoutLibraryIds, type SiteLayout } from './layout.js';
import type { ThemeConfig } from '../core/types.js';
import { siteCss, SITE_JS } from './site-css.js';
import { ROUTES, UI_STRINGS, buildNav, type RenderContext } from './render-context.js';
import { renderNotFound, renderPage } from './templates.js';
import { AppError } from '../core/errors.js';
import { nowIso } from '../core/util.js';

export interface BuildResult {
  outDir: string;
  files: number;
  urls: string[];
  warnings: string[];
}

export function siteDirs(sitesDir: string, domain: string) {
  const root = path.join(sitesDir, domain);
  return { root, out: path.join(root, 'out'), images: path.join(root, 'images'), logo: path.join(root, 'logo') };
}

/**
 * Dựng website tĩnh vào data/sites/<domain>/out từ dữ liệu trong DB.
 * Chạy lại bất kỳ lúc nào (đồng bộ Entity, thêm bài, đổi theme).
 */
/**
 * Ngữ cảnh dựng trang cho một site: theme, bộ nhận diện, ảnh, điều hướng.
 * Dùng chung cho dựng toàn bộ site và cho Chỉnh sửa trực quan (edit = true thêm data-edit vào HTML).
 */
export async function createRenderContext(input: { db: Db; site: Site; sitesDir: string; uploadsDir: string; edit?: boolean; themeOverride?: ThemeConfig; layoutOverride?: SiteLayout | null }): Promise<{ ctx: RenderContext; outDir: string; imagesDir: string }> {
  const { db } = input;
  const site: Site = input.themeOverride ? { ...input.site, theme: input.themeOverride } : input.site;
  if (!site.plan) throw new AppError('Site chưa có kế hoạch nội dung (gen_plan chưa chạy)');
  if (!site.theme) throw new AppError('Site chưa có theme');
  const pages = db.listPages(site.id).filter((p) => p.status === 'published');
  const dirs = siteDirs(input.sitesDir, site.domain);
  fs.mkdirSync(dirs.out, { recursive: true });
  const language = site.brief.language;
  const uploadedLogo = site.logo_file ? path.join(input.uploadsDir, site.logo_file) : null;
  const brand = await buildBrandAssets({ brandName: site.brief.brandName, tagline: site.plan.tagline, theme: site.theme, uploadedLogoPath: uploadedLogo, outDir: dirs.out });
  const images = new Map(db.listImages(site.id).filter((i) => i.file && i.provider !== 'none').map((i) => [i.key, i]));
  const base: Omit<RenderContext, 'nav'> = {
    site,
    siteUrl: `https://${site.domain}`,
    theme: site.theme,
    brand,
    plan: site.plan,
    entity: site.entity,
    pages,
    images,
    t: UI_STRINGS[language],
    language,
    routes: ROUTES[language],
    year: new Date().getFullYear(),
    buildDate: nowIso(),
    edit: input.edit,
    library: db.listLibrary(site.id),
    layout: input.layoutOverride !== undefined ? input.layoutOverride : site.layout,
  };
  return { ctx: { ...base, nav: buildNav(base) }, outDir: dirs.out, imagesDir: dirs.images };
}

export async function buildSite(input: { db: Db; site: Site; sitesDir: string; uploadsDir: string; log?: (m: string, d?: unknown) => void }): Promise<BuildResult> {
  const { db, site } = input;
  if (!site.plan) throw new AppError('Site chưa có kế hoạch nội dung (gen_plan chưa chạy)');
  if (!site.theme) throw new AppError('Site chưa có theme');
  const dirs = siteDirs(input.sitesDir, site.domain);
  const outDir = dirs.out;
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'assets', 'css'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'assets', 'js'), { recursive: true });

  const { ctx } = await createRenderContext({ db, site, sitesDir: input.sitesDir, uploadsDir: input.uploadsDir });
  const { pages, images, brand, siteUrl } = ctx;
  if (!pages.some((p) => p.kind === 'home')) throw new AppError('Site chưa có trang chủ (gen_content chưa chạy)');
  const warnings: string[] = [];
  const copied = copyImagesToOutput(db, site.id, dirs.images, outDir, layoutLibraryIds(site.layout));
  if (copied < images.size) warnings.push(`Thiếu ${images.size - copied} ảnh trong cache, trang sẽ bỏ trống vị trí đó`);

  fs.writeFileSync(path.join(outDir, 'assets', 'css', 'style.css'), siteCss(site.theme));
  fs.writeFileSync(path.join(outDir, 'assets', 'js', 'site.js'), SITE_JS);

  const urls: string[] = [];
  const lastmod = new Map<string, string>();
  let files = 0;
  const writePage = (slug: string, html: string) => {
    const dir = slug ? path.join(outDir, ...slug.split('/')) : outDir;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    files++;
  };

  for (const page of pages) {
    writePage(page.slug, renderPage(ctx, page));
    const url = page.slug ? `${siteUrl}/${page.slug}/` : `${siteUrl}/`;
    urls.push(url);
    lastmod.set(url, page.updated_at);
  }
  fs.writeFileSync(path.join(outDir, '404.html'), renderNotFound(ctx));
  files++;

  // sitemap, robots, manifest, IndexNow key
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${u}</loc><lastmod>${(lastmod.get(u) ?? nowIso()).slice(0, 10)}</lastmod></url>`)
    .join('\n')}\n</urlset>\n`;
  fs.writeFileSync(path.join(outDir, 'sitemap.xml'), sitemap);
  fs.writeFileSync(path.join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /assets/brand/\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
  const manifest = {
    name: site.entity.name || site.brief.brandName,
    short_name: site.brief.brandName.slice(0, 12),
    start_url: '/',
    display: 'browser',
    background_color: site.theme.palette.bg,
    theme_color: site.theme.palette.primary,
    icons: [
      { src: `/${brand.icon192}`, sizes: '192x192', type: 'image/png' },
      { src: `/${brand.icon512}`, sizes: '512x512', type: 'image/png' },
    ],
  };
  fs.writeFileSync(path.join(outDir, 'site.webmanifest'), JSON.stringify(manifest));
  if (site.indexnow_key) fs.writeFileSync(path.join(outDir, `${site.indexnow_key}.txt`), site.indexnow_key);
  files += 4;

  input.log?.(`Đã dựng ${pages.length} trang, ${copied} ảnh`, { outDir });
  return { outDir, files, urls, warnings };
}

export function listPagesForSitemap(pages: Page[], siteUrl: string): string[] {
  return pages.map((p) => (p.slug ? `${siteUrl}/${p.slug}/` : `${siteUrl}/`));
}
