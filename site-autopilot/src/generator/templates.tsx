import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import type { Page } from '../db/index.js';
import type { PageContent, Section } from '../core/types.js';
import { mdToHtml, mdToText, readingMinutes, wordCount } from './markdown.js';
import { googleFontsUrl } from './themes.js';
import { articleSchema, breadcrumbSchema, buildGraph, faqSchema, organizationSchema, personSchema, servicesSchema, sameAsList, webPageSchema, websiteSchema, type SchemaContext } from './schema.js';
import { ed, edMd, findImage, pageHref, pageUrl, type RenderContext } from './render-context.js';
import { slugify } from '../core/util.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatDate(iso: string | null | undefined, lang: 'vi' | 'en'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function schemaCtx(ctx: RenderContext): SchemaContext {
  return {
    siteUrl: ctx.siteUrl,
    brandName: ctx.site.brief.brandName,
    entity: ctx.entity,
    plan: ctx.plan,
    logoUrl: `${ctx.siteUrl}/${ctx.brand.logo}`,
    ogImageUrl: `${ctx.siteUrl}/${ctx.brand.ogImage}`,
    language: ctx.language,
  };
}

function Img(props: { ctx: RenderContext; imageKey: string; class?: string; eager?: boolean; altOverride?: string }) {
  const img = findImage(props.ctx, props.imageKey);
  if (!img) {
    if (props.ctx.edit) return <div class="edit-img-placeholder" data-edit-img={props.imageKey}>Nhấp để chọn ảnh</div>;
    return null;
  }
  return (
    <img
      src={`/${img.file}`}
      alt={props.altOverride || img.alt}
      width={img.width ?? undefined}
      height={img.height ?? undefined}
      class={props.class}
      loading={props.eager ? undefined : 'lazy'}
      decoding="async"
      fetchpriority={props.eager ? 'high' : undefined}
      data-edit-img={props.ctx.edit ? props.imageKey : undefined}
    />
  );
}

function Prose(props: { md: string }) {
  return <div class="prose">{raw(mdToHtml(props.md))}</div>;
}

function Faq(props: { ctx: RenderContext; items: { question: string; answer: string }[]; heading?: string; basePath?: string }) {
  if (!props.items.length) return null;
  const base = props.basePath ?? 'faq';
  return (
    <section class="section faq" id="faq">
      <div class="container">
        <div class="section-head">
          <h2>{props.heading ?? props.ctx.t.faq}</h2>
        </div>
        {props.items.map((f, i) => (
          <details open={props.ctx.edit ? true : undefined}>
            <summary {...ed(props.ctx, `${base}.${i}.question`)}>{f.question}</summary>
            <div class="prose" {...edMd(props.ctx, `${base}.${i}.answer`)}>{raw(mdToHtml(f.answer))}</div>
          </details>
        ))}
      </div>
    </section>
  );
}

function CtaBand(props: { ctx: RenderContext; heading?: string; text?: string }) {
  const { ctx } = props;
  const contactHref = pageHref(ctx.routes.contact);
  return (
    <section class="cta-band">
      <div class="container">
        <h2 {...ed(ctx, 'plan.ctaPrimary')}>{props.heading ?? ctx.plan.ctaPrimary}</h2>
        <p {...ed(ctx, 'plan.tagline')}>{props.text ?? ctx.plan.tagline}</p>
        <a class="btn" href={ctx.entity.telephone ? `tel:${ctx.entity.telephone.replace(/\s+/g, '')}` : contactHref}>
          {ctx.entity.telephone ? `${ctx.t.contactUs}: ${ctx.entity.telephone}` : ctx.t.contactUs}
        </a>
      </div>
    </section>
  );
}

function PostCard(props: { ctx: RenderContext; page: Page }) {
  const { ctx, page } = props;
  const c = page.content;
  const imgKey = `post.${page.slug.replace(/^blog\//, '')}.hero`;
  return (
    <article class="card">
      <a href={pageHref(page.slug)} aria-label={c.h1}>
        <Img ctx={ctx} imageKey={imgKey} />
      </a>
      <div class="body">
        <div class="meta">
          {formatDate(page.published_at, ctx.language)} · {readingMinutes(c.sections.map((s) => s.body).join(' '))} {ctx.t.minRead}
        </div>
        <h3>
          <a href={pageHref(page.slug)}>{c.h1}</a>
        </h3>
        <p>{c.excerpt ?? mdToText(c.intro).slice(0, 160)}</p>
        <a class="more" href={pageHref(page.slug)}>
          {ctx.t.readMore} →
        </a>
      </div>
    </article>
  );
}

function ServiceCards(props: { ctx: RenderContext; heading: string; linkBase: string }) {
  const { ctx } = props;
  return (
    <section class="section alt" id="services">
      <div class="container">
        <div class="section-head">
          <h2>{props.heading}</h2>
        </div>
        <div class="grid">
          {ctx.plan.services.map((s, i) => {
            const slug = s.slug ?? slugify(s.name);
            const href = props.linkBase ? `${props.linkBase}#${slug}` : `#${slug}`;
            return (
              <article class="card" id={props.linkBase ? undefined : slug}>
                <Img ctx={ctx} imageKey={`service.${slug}`} altOverride={s.name} />
                <div class="body">
                  <h3 {...ed(ctx, `plan.services.${i}.name`)}>{props.linkBase && !ctx.edit ? <a href={href}>{s.name}</a> : s.name}</h3>
                  <p {...ed(ctx, `plan.services.${i}.summary`)}>{s.summary}</p>
                  {props.linkBase ? (
                    <a class="more" href={href}>
                      {ctx.t.learnMore} →
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function stepsFromSection(sec: Section): string[] | null {
  const items = sec.body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(-|\d+[.)])\s+/.test(l))
    .map((l) => l.replace(/^(-|\d+[.)])\s+/, ''));
  return items.length >= 3 ? items : null;
}

function Breadcrumb(props: { ctx: RenderContext; items: { name: string; href: string }[] }) {
  return (
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <ol>
        {props.items.map((it, i) => (
          <li>{i === props.items.length - 1 ? <span aria-current="page">{it.name}</span> : <a href={it.href}>{it.name}</a>}</li>
        ))}
      </ol>
    </nav>
  );
}

function AuthorBox(props: { ctx: RenderContext }) {
  const { ctx } = props;
  const name = ctx.entity.author.name || ctx.plan.authorName;
  const title = ctx.entity.author.jobTitle || ctx.plan.authorTitle;
  const bio = ctx.entity.author.bio || ctx.plan.authorBio;
  if (!name) return null;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <aside class="author-box">
      <div class="avatar" aria-hidden="true">
        {initials}
      </div>
      <div>
        <strong>{name}</strong>
        {title ? <div class="credit">{title}</div> : null}
        {bio ? <p style="margin:6px 0 0">{bio}</p> : null}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  Layout                                                              */
/* ------------------------------------------------------------------ */

interface LayoutProps {
  ctx: RenderContext;
  page: PageContent;
  slug: string;
  jsonLd: string;
  ogImage?: string;
  ogType?: 'website' | 'article';
  activeKey?: string;
  children?: Child;
  noindex?: boolean;
}

function Layout(props: LayoutProps) {
  const { ctx, page, slug } = props;
  const url = pageUrl(ctx, slug);
  const e = ctx.entity;
  const brandName = e.name || ctx.site.brief.brandName;
  const verification = googleVerificationContent(ctx);
  const ogImage = props.ogImage ?? `${ctx.siteUrl}/${ctx.brand.ogImage}?v=${ctx.brand.version}`;
  const socials = sameAsList(e);
  const headerClass = `site-header header-${ctx.theme.headerStyle}`;
  return (
    <html lang={ctx.language === 'vi' ? 'vi' : 'en'}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="generator" content="site-autopilot" />
        <title>{page.title}</title>
        <meta name="description" content={page.metaDescription} />
        <link rel="canonical" href={url} />
        {props.noindex ? <meta name="robots" content="noindex, follow" /> : <meta name="robots" content="index, follow, max-image-preview:large" />}
        <meta property="og:type" content={props.ogType ?? 'website'} />
        <meta property="og:title" content={page.title} />
        <meta property="og:description" content={page.metaDescription} />
        <meta property="og:url" content={url} />
        <meta property="og:site_name" content={brandName} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:locale" content={ctx.language === 'vi' ? 'vi_VN' : 'en_US'} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={page.title} />
        <meta name="twitter:description" content={page.metaDescription} />
        <meta name="twitter:image" content={ogImage} />
        {verification ? <meta name="google-site-verification" content={verification} /> : null}
        {e.bingSiteVerification ? <meta name="msvalidate.01" content={e.bingSiteVerification} /> : null}
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" type="image/png" sizes="32x32" href={`/${ctx.brand.favicon32}?v=${ctx.brand.version}`} />
        <link rel="apple-touch-icon" href={`/${ctx.brand.appleTouch}`} />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content={ctx.theme.palette.primary} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link rel="stylesheet" href={googleFontsUrl(ctx.theme)} />
        <link rel="stylesheet" href={`/assets/css/style.css?v=${ctx.brand.version}`} />
        {raw(`<script type="application/ld+json">${props.jsonLd}</script>`)}
        {e.gtmId ? raw(gtmHead(e.gtmId)) : null}
        {e.ga4Id && !e.gtmId ? raw(ga4Head(e.ga4Id)) : null}
      </head>
      <body>
        {e.gtmId ? raw(gtmBody(e.gtmId)) : null}
        <a class="skip" href="#main">
          {ctx.language === 'vi' ? 'Bỏ qua điều hướng' : 'Skip to content'}
        </a>
        <header class={headerClass}>
          <div class="container">
            <a class="brand" href="/" aria-label={brandName}>
              <img src={`/${ctx.brand.logo}?v=${ctx.brand.version}`} alt={brandName} width={Math.round((ctx.brand.logoWidth / ctx.brand.logoHeight) * 44)} height={44} />
              {ctx.site.logo_file ? null : null}
            </a>
            <button class="nav-toggle" aria-expanded="false" aria-controls="nav">
              ☰ {ctx.t.menu}
            </button>
            <nav class="nav" id="nav" aria-label="Main">
              {ctx.nav.map((n) => (
                <a href={n.href} aria-current={n.key === props.activeKey ? 'page' : undefined}>
                  {n.label}
                </a>
              ))}
              {e.telephone ? (
                <a class="btn accent" href={`tel:${e.telephone.replace(/\s+/g, '')}`}>
                  {e.telephone}
                </a>
              ) : null}
            </nav>
          </div>
        </header>
        <main id="main">{props.children}</main>
        <footer class="site-footer">
          <div class="container">
            <div class="cols">
              <div>
                <h4>{brandName}</h4>
                <p>{e.description || ctx.plan.tagline}</p>
                {e.address.streetAddress || e.address.addressLocality ? (
                  <p>
                    {ctx.t.address}: {[e.address.streetAddress, e.address.addressLocality, e.address.addressRegion].filter(Boolean).join(', ')}
                  </p>
                ) : null}
                {e.telephone ? (
                  <p>
                    {ctx.t.phone}: <a href={`tel:${e.telephone.replace(/\s+/g, '')}`}>{e.telephone}</a>
                  </p>
                ) : null}
                {e.email ? (
                  <p>
                    {ctx.t.email}: <a href={`mailto:${e.email}`}>{e.email}</a>
                  </p>
                ) : null}
              </div>
              <div>
                <h4>{ctx.t.quickLinks}</h4>
                <ul>
                  {ctx.nav.map((n) => (
                    <li>
                      <a href={n.href}>{n.label}</a>
                    </li>
                  ))}
                  {ctx.pages.some((p) => p.slug === ctx.routes.privacy) ? (
                    <li>
                      <a href={pageHref(ctx.routes.privacy)}>{ctx.t.privacy}</a>
                    </li>
                  ) : null}
                </ul>
              </div>
              <div>
                {socials.length ? <h4>{ctx.t.followUs}</h4> : null}
                <ul>
                  {socials.map((s) => (
                    <li>
                      <a href={s} rel="noopener me" target="_blank">
                        {socialLabel(s)}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div class="bottom">
              <span>
                © {ctx.year} {brandName}. {ctx.t.copyright}.
              </span>
              <span>
                {ctx.t.photos}{' '}
                <a href="https://www.pexels.com" rel="noopener nofollow" target="_blank">
                  Pexels
                </a>
              </span>
            </div>
          </div>
        </footer>
        <script src="/assets/js/site.js" defer></script>
      </body>
    </html>
  );
}

function socialLabel(url: string): string {
  const host = url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] ?? url;
  const map: Record<string, string> = { 'facebook.com': 'Facebook', 'youtube.com': 'YouTube', 'tiktok.com': 'TikTok', 'instagram.com': 'Instagram', 'linkedin.com': 'LinkedIn', 'x.com': 'X', 'twitter.com': 'X', 'pinterest.com': 'Pinterest', 'zalo.me': 'Zalo', 'maps.google.com': 'Google Maps', 'goo.gl': 'Google Maps', 'maps.app.goo.gl': 'Google Maps', 'wikipedia.org': 'Wikipedia' };
  for (const [k, v] of Object.entries(map)) if (host.endsWith(k)) return v;
  return host;
}

function googleVerificationContent(ctx: RenderContext): string {
  const manual = ctx.entity.googleSiteVerification.trim();
  const auto = (ctx.site.google_verification_token ?? '').trim();
  const token = manual || auto;
  if (!token) return '';
  const m = token.match(/content=["']([^"']+)["']/);
  return m ? (m[1] as string) : token;
}

function ga4Head(id: string): string {
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`;
}
function gtmHead(id: string): string {
  return `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');</script>`;
}
function gtmBody(id: string): string {
  return `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${id}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;
}

/* ------------------------------------------------------------------ */
/*  Pages                                                               */
/* ------------------------------------------------------------------ */

export function renderHome(ctx: RenderContext, page: Page): string {
  const c = page.content;
  const sc = schemaCtx(ctx);
  const posts = ctx.pages.filter((p) => p.kind === 'post').slice(0, 3);
  const isBlog = ctx.site.brief.siteType === 'blog';
  const jsonLd = buildGraph([
    organizationSchema(sc),
    websiteSchema(sc),
    personSchema(sc),
    webPageSchema(sc, c, ctx.siteUrl + '/', { heroImage: heroUrl(ctx, 'home.hero') }),
    faqSchema(c.faq.length ? c.faq : ctx.plan.faq),
  ]);
  const queue = [...c.sections];
  const blocks: Child[] = [];
  for (const key of ctx.theme.sectionOrder) {
    switch (key) {
      case 'intro': {
        const s = queue.shift();
        if (s) blocks.push(proseSection(ctx, s, 'home', 0, false));
        break;
      }
      case 'services':
        blocks.push(<ServiceCards ctx={ctx} heading={ctx.t.ourServices} linkBase={pageHref(ctx.routes.services)} />);
        break;
      case 'topics':
        blocks.push(<ServiceCards ctx={ctx} heading={ctx.t.mainTopics} linkBase="" />);
        break;
      case 'why': {
        const s = queue.shift();
        blocks.push(
          <section class="section" id="why">
            <div class="container">
              <div class="section-head">
                <h2 {...(s ? ed(ctx, `sections.${c.sections.indexOf(s)}.heading`) : {})}>{s?.heading || ctx.t.whyUs}</h2>
                {s ? <div class="prose" {...edMd(ctx, `sections.${c.sections.indexOf(s)}.body`)}>{raw(mdToHtml(s.body))}</div> : null}
              </div>
              {ctx.plan.differentiators.length ? (
                <ul class="why-list">
                  {ctx.plan.differentiators.map((d, i) => (
                    <li {...ed(ctx, `plan.differentiators.${i}`)}>{d}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>,
        );
        break;
      }
      case 'process': {
        const idx = queue.findIndex((s) => /quy trình|process|các bước|steps/i.test(s.heading));
        const s = idx >= 0 ? queue.splice(idx, 1)[0] : queue.shift();
        if (!s) break;
        const steps = stepsFromSection(s);
        blocks.push(
          <section class="section alt" id="process">
            <div class="container">
              <div class="section-head">
                <h2 {...ed(ctx, `sections.${c.sections.indexOf(s)}.heading`)}>{s.heading || ctx.t.process}</h2>
              </div>
              {steps && !ctx.edit ? (
                <div class="steps">
                  {steps.map((st) => (
                    <div class="step">{raw(mdToHtml(st))}</div>
                  ))}
                </div>
              ) : (
                <div class="prose" {...edMd(ctx, `sections.${c.sections.indexOf(s)}.body`)}>{raw(mdToHtml(s.body))}</div>
              )}
            </div>
          </section>,
        );
        break;
      }
      case 'posts':
        if (posts.length) {
          blocks.push(
            <section class="section posts" id="posts">
              <div class="container">
                <div class="section-head">
                  <h2>{ctx.t.latestPosts}</h2>
                </div>
                <div class="grid">
                  {posts.map((p) => (
                    <PostCard ctx={ctx} page={p} />
                  ))}
                </div>
                <p style="margin-top:20px">
                  <a class="btn secondary" href={pageHref(ctx.routes.blog)}>
                    {ctx.t.allPosts}
                  </a>
                </p>
              </div>
            </section>,
          );
        }
        break;
      case 'faq':
        while (queue.length) {
          const s = queue.shift();
          if (s) blocks.push(proseSection(ctx, s, 'home', c.sections.indexOf(s), true));
        }
        blocks.push(<Faq ctx={ctx} items={c.faq.length ? c.faq : ctx.plan.faq} basePath={c.faq.length ? 'faq' : 'plan.faq'} />);
        break;
      case 'cta':
        blocks.push(<CtaBand ctx={ctx} />);
        break;
      default:
        break;
    }
  }
  const heroImg = findImage(ctx, 'home.hero');
  const heroStyle = ctx.theme.heroStyle;
  const hero =
    heroStyle === 'image-bg' && heroImg ? (
      <section class="hero image-bg">
        <img class="bg" src={`/${heroImg.file}`} alt="" width={heroImg.width ?? undefined} height={heroImg.height ?? undefined} fetchpriority="high" data-edit-img={ctx.edit ? 'home.hero' : undefined} />
        <div class="container">
          <h1 {...ed(ctx, 'h1')}>{c.h1}</h1>
          <p class="lead" {...edMd(ctx, 'intro')}>{mdToText(c.intro)}</p>
          <div class="actions">
            <a class="btn accent" href={pageHref(ctx.routes.contact)} {...ed(ctx, 'plan.ctaPrimary')}>
              {ctx.plan.ctaPrimary}
            </a>
            <a class="btn secondary" href={isBlog ? pageHref(ctx.routes.blog) : pageHref(ctx.routes.services)} {...ed(ctx, 'plan.ctaSecondary')}>
              {ctx.plan.ctaSecondary}
            </a>
          </div>
        </div>
      </section>
    ) : heroStyle === 'split' && heroImg ? (
      <section class="hero split">
        <div class="container">
          <div>
            <h1 {...ed(ctx, 'h1')}>{c.h1}</h1>
            <p class="lead" {...edMd(ctx, 'intro')}>{mdToText(c.intro)}</p>
            <div class="actions">
              <a class="btn" href={pageHref(ctx.routes.contact)} {...ed(ctx, 'plan.ctaPrimary')}>
                {ctx.plan.ctaPrimary}
              </a>
              <a class="btn secondary" href={isBlog ? pageHref(ctx.routes.blog) : pageHref(ctx.routes.services)} {...ed(ctx, 'plan.ctaSecondary')}>
                {ctx.plan.ctaSecondary}
              </a>
            </div>
          </div>
          <Img ctx={ctx} imageKey="home.hero" eager altOverride={c.heroImageAlt || ctx.site.brief.brandName} />
        </div>
      </section>
    ) : (
      <section class="hero minimal">
        <div class="container">
          <h1 {...ed(ctx, 'h1')}>{c.h1}</h1>
          <p class="lead" {...edMd(ctx, 'intro')}>{mdToText(c.intro)}</p>
          {ctx.edit && !heroImg ? <Img ctx={ctx} imageKey="home.hero" eager /> : null}
          <div class="actions">
            <a class="btn" href={pageHref(ctx.routes.contact)} {...ed(ctx, 'plan.ctaPrimary')}>
              {ctx.plan.ctaPrimary}
            </a>
          </div>
        </div>
      </section>
    );

  return doc(
    <Layout ctx={ctx} page={c} slug="" jsonLd={jsonLd} activeKey="home">
      {hero}
      {blocks}
    </Layout>,
  );
}

function proseSection(ctx: RenderContext, s: Section, pageSlug: string, index: number, alt: boolean) {
  const imgKey = `${pageSlug || 'home'}.section.${index}`;
  const img = s.imageQuery ? findImage(ctx, imgKey) : undefined;
  return (
    <section class={`section${alt ? ' alt' : ''}`}>
      <div class="container">
        {img || (ctx.edit && s.imageQuery) ? (
          <div class="two-col">
            <div>
              <h2 {...ed(ctx, `sections.${index}.heading`)}>{s.heading}</h2>
              <div class="prose" {...edMd(ctx, `sections.${index}.body`)}>{raw(mdToHtml(s.body))}</div>
            </div>
            <Img ctx={ctx} imageKey={imgKey} />
          </div>
        ) : (
          <div class="prose">
            <h2 {...ed(ctx, `sections.${index}.heading`)}>{s.heading}</h2>
            <div {...edMd(ctx, `sections.${index}.body`)}>{raw(mdToHtml(s.body))}</div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Bài liên quan theo mức trùng từ khóa và tiêu đề, không phải chỉ bài mới nhất. */
function relatedPosts(ctx: RenderContext, page: Page, n: number): Page[] {
  const words = (s: string) => new Set(mdToText(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
  const mine = words(`${page.content.targetKeyword ?? ''} ${page.content.h1}`);
  const scored = ctx.pages
    .filter((p) => p.kind === 'post' && p.id !== page.id)
    .map((p) => {
      let score = 0;
      for (const w of words(`${p.content.targetKeyword ?? ''} ${p.content.h1}`)) if (mine.has(w)) score++;
      return { p, score };
    });
  scored.sort((a, b) => b.score - a.score || (b.p.published_at ?? '').localeCompare(a.p.published_at ?? ''));
  return scored.slice(0, n).map((s) => s.p);
}

function heroUrl(ctx: RenderContext, key: string): string | undefined {
  const img = findImage(ctx, key);
  return img ? `${ctx.siteUrl}/${img.file}` : undefined;
}

export function renderAbout(ctx: RenderContext, page: Page): string {
  const c = page.content;
  const sc = schemaCtx(ctx);
  const url = pageUrl(ctx, page.slug);
  const jsonLd = buildGraph([
    organizationSchema(sc),
    websiteSchema(sc),
    personSchema(sc),
    webPageSchema(sc, c, url, { heroImage: heroUrl(ctx, 'about.hero') }),
    breadcrumbSchema(sc, [
      { name: ctx.t.home, url: ctx.siteUrl + '/' },
      { name: ctx.t.about, url },
    ]),
  ]);
  return doc(
    <Layout ctx={ctx} page={c} slug={page.slug} jsonLd={jsonLd} activeKey="about">
      <section class="hero minimal">
        <div class="container">
          <Breadcrumb
            ctx={ctx}
            items={[
              { name: ctx.t.home, href: '/' },
              { name: ctx.t.about, href: pageHref(page.slug) },
            ]}
          />
          <h1 {...ed(ctx, 'h1')}>{c.h1}</h1>
          <p class="lead" {...edMd(ctx, 'intro')}>{mdToText(c.intro)}</p>
        </div>
      </section>
      <section class="section">
        <div class="container">
          <div class="two-col">
            <Img ctx={ctx} imageKey="about.hero" eager altOverride={c.heroImageAlt || `${ctx.site.brief.brandName}`} />
            <div>
              {c.sections[0] ? (
                <div class="prose">
                  <h2 {...ed(ctx, 'sections.0.heading')}>{c.sections[0].heading}</h2>
                  <div {...edMd(ctx, 'sections.0.body')}>{raw(mdToHtml(c.sections[0].body))}</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      {c.sections.slice(1).map((s, i) => proseSection(ctx, s, page.slug, i + 1, i % 2 === 0))}
      <section class="section">
        <div class="container">
          <AuthorBox ctx={ctx} />
        </div>
      </section>
      <CtaBand ctx={ctx} />
    </Layout>,
  );
}

export function renderServices(ctx: RenderContext, page: Page): string {
  const c = page.content;
  const sc = schemaCtx(ctx);
  const url = pageUrl(ctx, page.slug);
  const services = c.services?.length ? c.services : ctx.plan.services.map((s) => ({ name: s.name, slug: s.slug ?? slugify(s.name), summary: s.summary, body: s.summary, imageQuery: s.imageQuery }));
  const svcBase = c.services?.length ? 'services' : 'plan.services';
  const jsonLd = buildGraph([
    organizationSchema(sc),
    websiteSchema(sc),
    webPageSchema(sc, c, url, {}),
    breadcrumbSchema(sc, [
      { name: ctx.t.home, url: ctx.siteUrl + '/' },
      { name: ctx.t.services, url },
    ]),
    servicesSchema(sc, services, url),
    faqSchema(c.faq),
  ]);
  return doc(
    <Layout ctx={ctx} page={c} slug={page.slug} jsonLd={jsonLd} activeKey="services">
      <section class="hero minimal">
        <div class="container">
          <Breadcrumb
            ctx={ctx}
            items={[
              { name: ctx.t.home, href: '/' },
              { name: ctx.t.services, href: pageHref(page.slug) },
            ]}
          />
          <h1 {...ed(ctx, 'h1')}>{c.h1}</h1>
          <p class="lead" {...edMd(ctx, 'intro')}>{mdToText(c.intro)}</p>
          <p class="credit">
            {ctx.t.inThisPage}:{' '}
            {services.map((s, i) => (
              <>
                {i ? ' · ' : ''}
                <a href={`#${s.slug}`}>{s.name}</a>
              </>
            ))}
          </p>
        </div>
      </section>
      <div class="container">
        {services.map((s, i) => (
          <section class="service-detail" id={s.slug}>
            <div class="two-col">
              {i % 2 === 0 ? <Img ctx={ctx} imageKey={`service.${s.slug}`} altOverride={s.name} /> : null}
              <div>
                <h2 {...ed(ctx, `${svcBase}.${i}.name`)}>{s.name}</h2>
                <p>
                  <strong {...ed(ctx, `${svcBase}.${i}.summary`)}>{s.summary}</strong>
                </p>
                <div class="prose" {...(svcBase === 'services' ? edMd(ctx, `services.${i}.body`) : {})}>{raw(mdToHtml(s.body))}</div>
                <a class="btn" href={pageHref(ctx.routes.contact)}>
                  {ctx.plan.ctaPrimary}
                </a>
              </div>
              {i % 2 === 1 ? <Img ctx={ctx} imageKey={`service.${s.slug}`} altOverride={s.name} /> : null}
            </div>
          </section>
        ))}
      </div>
      {c.sections.map((s, i) => proseSection(ctx, s, page.slug, i, i % 2 === 0))}
      <Faq ctx={ctx} items={c.faq} />
      <CtaBand ctx={ctx} />
    </Layout>,
  );
}

export function renderBlogIndex(ctx: RenderContext, page: Page): string {
  const c = page.content;
  const sc = schemaCtx(ctx);
  const url = pageUrl(ctx, page.slug);
  const posts = ctx.pages.filter((p) => p.kind === 'post');
  const jsonLd = buildGraph([
    organizationSchema(sc),
    websiteSchema(sc),
    webPageSchema(sc, c, url, {}),
    breadcrumbSchema(sc, [
      { name: ctx.t.home, url: ctx.siteUrl + '/' },
      { name: ctx.t.blog, url },
    ]),
  ]);
  return doc(
    <Layout ctx={ctx} page={c} slug={page.slug} jsonLd={jsonLd} activeKey="blog">
      <section class="hero minimal">
        <div class="container">
          <Breadcrumb
            ctx={ctx}
            items={[
              { name: ctx.t.home, href: '/' },
              { name: ctx.t.blog, href: pageHref(page.slug) },
            ]}
          />
          <h1 {...ed(ctx, 'h1')}>{c.h1}</h1>
          <p class="lead" {...edMd(ctx, 'intro')}>{mdToText(c.intro)}</p>
        </div>
      </section>
      <section class="section posts">
        <div class="container">
          <div class="grid">
            {posts.map((p) => (
              <PostCard ctx={ctx} page={p} />
            ))}
          </div>
        </div>
      </section>
      <CtaBand ctx={ctx} />
    </Layout>,
  );
}

export function renderPost(ctx: RenderContext, page: Page): string {
  const c = page.content;
  const sc = schemaCtx(ctx);
  const url = pageUrl(ctx, page.slug);
  const postSlug = page.slug.replace(/^blog\//, '');
  const heroKey = `post.${postSlug}.hero`;
  const hero = heroUrl(ctx, heroKey);
  const bodyText = [c.intro, ...c.sections.map((s) => s.body)].join(' ');
  const words = wordCount(mdToText(bodyText));
  const related = relatedPosts(ctx, page, 3);
  const published = page.published_at ?? page.created_at;
  const jsonLd = buildGraph([
    organizationSchema(sc),
    websiteSchema(sc),
    personSchema(sc),
    webPageSchema(sc, c, url, { heroImage: hero, datePublished: published, dateModified: page.updated_at }),
    articleSchema(sc, c, url, { heroImage: hero, datePublished: published, dateModified: page.updated_at, wordCount: words }),
    breadcrumbSchema(sc, [
      { name: ctx.t.home, url: ctx.siteUrl + '/' },
      { name: ctx.t.blog, url: pageUrl(ctx, ctx.routes.blog) },
      { name: c.h1, url },
    ]),
    faqSchema(c.faq),
  ]);
  return doc(
    <Layout ctx={ctx} page={c} slug={page.slug} jsonLd={jsonLd} activeKey="blog" ogType="article" ogImage={hero}>
      <article>
        <section class="hero minimal">
          <div class="container">
            <Breadcrumb
              ctx={ctx}
              items={[
                { name: ctx.t.home, href: '/' },
                { name: ctx.t.blog, href: pageHref(ctx.routes.blog) },
                { name: c.h1, href: pageHref(page.slug) },
              ]}
            />
            <h1 {...ed(ctx, 'h1')}>{c.h1}</h1>
            <div class="post-meta">
              <span>
                {ctx.t.writtenBy} {ctx.entity.author.name || ctx.plan.authorName}
              </span>
              <span>
                {ctx.t.published} {formatDate(published, ctx.language)}
              </span>
              <span>
                {Math.max(1, Math.round(words / 200))} {ctx.t.minRead}
              </span>
            </div>
          </div>
        </section>
        <div class="container">
          <div class="prose">
            <Img ctx={ctx} imageKey={heroKey} eager altOverride={c.heroImageAlt} />
            <div {...edMd(ctx, 'intro')}>{raw(mdToHtml(c.intro))}</div>
            {c.keyTakeaways?.length ? (
              <aside class="takeaways">
                <h2>{ctx.t.keyTakeaways}</h2>
                <ul>
                  {c.keyTakeaways.map((k, i) => (
                    <li {...ed(ctx, `keyTakeaways.${i}`)}>{k}</li>
                  ))}
                </ul>
              </aside>
            ) : null}
            {c.sections.length >= 3 ? (
              <nav class="toc" aria-label={ctx.t.inThisPage}>
                <strong>{ctx.t.inThisPage}</strong>
                <ol>
                  {c.sections.map((s) => (
                    <li>
                      <a href={`#${slugify(s.heading)}`}>{s.heading}</a>
                    </li>
                  ))}
                </ol>
              </nav>
            ) : null}
            {c.sections.map((s, i) => {
              const imgKey = `${page.slug}.section.${i}`;
              const img = s.imageQuery ? findImage(ctx, imgKey) : undefined;
              return (
                <>
                  <h2 id={slugify(s.heading)} {...ed(ctx, `sections.${i}.heading`)}>{s.heading}</h2>
                  {img || (ctx.edit && s.imageQuery) ? (
                    <figure>
                      <Img ctx={ctx} imageKey={imgKey} altOverride={s.heading} />
                    </figure>
                  ) : null}
                  <div {...edMd(ctx, `sections.${i}.body`)}>{raw(mdToHtml(s.body))}</div>
                </>
              );
            })}
          </div>
          {c.faq.length ? (
            <div class="faq" style="max-width:760px;margin-top:32px">
              <h2>{ctx.t.faq}</h2>
              {c.faq.map((f, i) => (
                <details open={ctx.edit ? true : undefined}>
                  <summary {...ed(ctx, `faq.${i}.question`)}>{f.question}</summary>
                  <div class="prose" {...edMd(ctx, `faq.${i}.answer`)}>{raw(mdToHtml(f.answer))}</div>
                </details>
              ))}
            </div>
          ) : null}
          <div style="max-width:760px">
            <AuthorBox ctx={ctx} />
          </div>
          {related.length ? (
            <section class="related posts">
              <h2>{ctx.t.relatedPosts}</h2>
              <div class="grid">
                {related.map((p) => (
                  <PostCard ctx={ctx} page={p} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </article>
      <CtaBand ctx={ctx} />
    </Layout>,
  );
}

export function renderContact(ctx: RenderContext, page: Page): string {
  const c = page.content;
  const sc = schemaCtx(ctx);
  const url = pageUrl(ctx, page.slug);
  const e = ctx.entity;
  const socials = sameAsList(e);
  const jsonLd = buildGraph([
    organizationSchema(sc),
    websiteSchema(sc),
    webPageSchema(sc, c, url, {}),
    breadcrumbSchema(sc, [
      { name: ctx.t.home, url: ctx.siteUrl + '/' },
      { name: ctx.t.contact, url },
    ]),
  ]);
  const mapSrc = e.mapEmbedUrl && /^https:\/\/(www\.)?google\.com\/maps\/embed/.test(e.mapEmbedUrl) ? e.mapEmbedUrl : '';
  return doc(
    <Layout ctx={ctx} page={c} slug={page.slug} jsonLd={jsonLd} activeKey="contact">
      <section class="hero minimal">
        <div class="container">
          <Breadcrumb
            ctx={ctx}
            items={[
              { name: ctx.t.home, href: '/' },
              { name: ctx.t.contact, href: pageHref(page.slug) },
            ]}
          />
          <h1 {...ed(ctx, 'h1')}>{c.h1}</h1>
          <p class="lead" {...edMd(ctx, 'intro')}>{mdToText(c.intro)}</p>
        </div>
      </section>
      <section class="section">
        <div class="container">
          <div class="contact-grid">
            <div class="contact-card">
              <h2>{e.name || ctx.site.brief.brandName}</h2>
              <dl>
                {e.telephone ? (
                  <>
                    <dt>{ctx.t.phone}</dt>
                    <dd>
                      <a href={`tel:${e.telephone.replace(/\s+/g, '')}`}>{e.telephone}</a>
                    </dd>
                  </>
                ) : null}
                {e.email ? (
                  <>
                    <dt>{ctx.t.email}</dt>
                    <dd>
                      <a href={`mailto:${e.email}`}>{e.email}</a>
                    </dd>
                  </>
                ) : null}
                {e.address.streetAddress || e.address.addressLocality ? (
                  <>
                    <dt>{ctx.t.address}</dt>
                    <dd>{[e.address.streetAddress, e.address.addressLocality, e.address.addressRegion, e.address.postalCode].filter(Boolean).join(', ')}</dd>
                  </>
                ) : null}
                {e.openingHours.length ? (
                  <>
                    <dt>{ctx.t.hours}</dt>
                    <dd>{e.openingHours.join('; ')}</dd>
                  </>
                ) : null}
                {socials.length ? (
                  <>
                    <dt>{ctx.t.followUs}</dt>
                    <dd>
                      {socials.map((s, i) => (
                        <>
                          {i ? ' · ' : ''}
                          <a href={s} rel="noopener me" target="_blank">
                            {socialLabel(s)}
                          </a>
                        </>
                      ))}
                    </dd>
                  </>
                ) : null}
              </dl>
            </div>
            {mapSrc ? (
              <div class="map">
                <iframe src={mapSrc} loading="lazy" referrerpolicy="no-referrer-when-downgrade" title={ctx.t.address}></iframe>
              </div>
            ) : (
              <Img ctx={ctx} imageKey="contact.hero" altOverride={c.heroImageAlt || ctx.t.contact} />
            )}
          </div>
        </div>
      </section>
      {c.sections.map((s, i) => proseSection(ctx, s, page.slug, i, i % 2 === 0))}
    </Layout>,
  );
}

export function renderSimple(ctx: RenderContext, page: Page, activeKey?: string): string {
  const c = page.content;
  const sc = schemaCtx(ctx);
  const url = pageUrl(ctx, page.slug);
  const jsonLd = buildGraph([
    organizationSchema(sc),
    websiteSchema(sc),
    webPageSchema(sc, c, url, { dateModified: page.updated_at }),
    breadcrumbSchema(sc, [
      { name: ctx.t.home, url: ctx.siteUrl + '/' },
      { name: c.h1, url },
    ]),
  ]);
  return doc(
    <Layout ctx={ctx} page={c} slug={page.slug} jsonLd={jsonLd} activeKey={activeKey}>
      <section class="hero minimal">
        <div class="container">
          <h1 {...ed(ctx, 'h1')}>{c.h1}</h1>
          <p class="lead" {...edMd(ctx, 'intro')}>{mdToText(c.intro)}</p>
        </div>
      </section>
      <section class="section">
        <div class="container">
          <div class="prose">
            {c.sections.map((s, i) => (
              <>
                <h2 {...ed(ctx, `sections.${i}.heading`)}>{s.heading}</h2>
                <div {...edMd(ctx, `sections.${i}.body`)}>{raw(mdToHtml(s.body))}</div>
              </>
            ))}
            <p class="credit">
              {ctx.t.updated}: {formatDate(page.updated_at, ctx.language)}
            </p>
          </div>
        </div>
      </section>
    </Layout>,
  );
}

export function renderNotFound(ctx: RenderContext): string {
  const c: PageContent = { kind: 'privacy', title: `404 | ${ctx.site.brief.brandName}`, metaDescription: ctx.t.notFoundText, h1: ctx.t.notFound, intro: '', sections: [], faq: [] };
  const sc = schemaCtx(ctx);
  return doc(
    <Layout ctx={ctx} page={c} slug="404" jsonLd={buildGraph([organizationSchema(sc), websiteSchema(sc)])} noindex>
      <section class="section">
        <div class="container">
          <h1>{ctx.t.notFound}</h1>
          <p>{ctx.t.notFoundText}</p>
          <a class="btn" href="/">
            {ctx.t.backHome}
          </a>
        </div>
      </section>
    </Layout>,
  );
}

function doc(node: unknown): string {
  return '<!DOCTYPE html>\n' + String(node);
}

/** Dựng HTML một trang theo loại, dùng cho builder và chỉnh sửa trực quan. */
export function renderPage(ctx: RenderContext, page: Page): string {
  switch (page.kind) {
    case 'home':
      return renderHome(ctx, page);
    case 'about':
      return renderAbout(ctx, page);
    case 'services':
      return renderServices(ctx, page);
    case 'blog':
      return renderBlogIndex(ctx, page);
    case 'post':
      return renderPost(ctx, page);
    case 'contact':
      return renderContact(ctx, page);
    default:
      return renderSimple(ctx, page);
  }
}
