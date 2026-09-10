import type { ThemeConfig } from '../core/types.js';
import { themeCssVars } from './themes.js';

/** CSS cho website tĩnh. Biến theo theme được nhúng ở :root. */
export function siteCss(theme: ThemeConfig): string {
  const cardShadow = theme.cardStyle === 'shadow' ? '0 10px 30px rgba(0,0,0,.08)' : 'none';
  const cardBorder = theme.cardStyle === 'outline' ? '1px solid rgba(0,0,0,.1)' : '1px solid transparent';
  const headerJustify = theme.headerStyle === 'center' ? 'center' : 'space-between';
  return `:root{${themeCssVars(theme)}}
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--font-body);color:var(--text);background:var(--bg);line-height:1.65;font-size:17px}
img{max-width:100%;height:auto;display:block}
a{color:var(--primary);text-decoration:none}
a:hover{text-decoration:underline}
h1,h2,h3,h4{font-family:var(--font-heading);line-height:1.25;margin:0 0 .6em;color:var(--text);letter-spacing:-.01em}
h1{font-size:clamp(1.9rem,4vw,2.9rem)}
h2{font-size:clamp(1.45rem,2.6vw,2rem)}
h3{font-size:1.2rem}
p{margin:0 0 1em}
ul,ol{padding-left:1.3em;margin:0 0 1em}
li{margin-bottom:.35em}
.container{width:min(1140px,92%);margin:0 auto}
.skip{position:absolute;left:-999px}
.skip:focus{left:8px;top:8px;background:#fff;padding:8px;z-index:99}
.site-header{background:var(--bg);border-bottom:1px solid rgba(0,0,0,.06);position:sticky;top:0;z-index:50}
.site-header .container{display:flex;align-items:center;justify-content:${headerJustify};gap:24px;min-height:72px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-family:var(--font-heading);font-weight:700;font-size:1.15rem;color:var(--text)}
.brand img{height:44px;width:auto}
.nav{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.nav a{padding:8px 12px;border-radius:var(--radius);color:var(--text);font-weight:500}
.nav a:hover,.nav a[aria-current=page]{background:var(--surface);text-decoration:none;color:var(--primary)}
.nav .btn{margin-left:8px}
.nav-toggle{display:none;background:none;border:1px solid rgba(0,0,0,.15);border-radius:8px;padding:8px 10px;font-size:1rem;cursor:pointer}
.btn{display:inline-block;background:var(--primary);color:#fff;padding:12px 22px;border-radius:var(--radius);font-weight:600;border:2px solid var(--primary);transition:.15s}
.btn:hover{background:var(--primary-dark);border-color:var(--primary-dark);text-decoration:none;color:#fff}
.btn.secondary{background:transparent;color:var(--primary)}
.btn.secondary:hover{background:var(--surface)}
.btn.accent{background:var(--accent);border-color:var(--accent);color:#111}
.hero{position:relative;padding:64px 0;background:var(--surface)}
.hero.image-bg{color:#fff;background:var(--primary-dark);min-height:520px;display:flex;align-items:center}
.hero.image-bg .bg{position:absolute;inset:0;object-fit:cover;width:100%;height:100%;opacity:.42}
.hero.image-bg .container{position:relative}
.hero.image-bg h1,.hero.image-bg p{color:#fff}
.hero.split .container{display:grid;grid-template-columns:1.1fr 1fr;gap:40px;align-items:center}
.hero.split img{border-radius:var(--radius);box-shadow:0 20px 50px rgba(0,0,0,.15)}
.hero.minimal{background:var(--bg);padding:56px 0 24px;border-bottom:1px solid rgba(0,0,0,.06)}
.hero .lead{font-size:1.15rem;max-width:640px;color:inherit;opacity:.9}
.hero .actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}
.hero .actions .secondary{color:inherit;border-color:currentColor}
.section{padding:56px 0}
.section.alt{background:var(--surface)}
.section-head{max-width:720px;margin-bottom:28px}
.section-head p{color:var(--muted)}
.grid{display:grid;gap:22px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.card{background:var(--bg);border-radius:var(--radius);box-shadow:${cardShadow};border:${cardBorder};overflow:hidden;display:flex;flex-direction:column}
.card img{aspect-ratio:10/7;object-fit:cover;width:100%}
.card .body{padding:20px}
.card h3{margin-bottom:.4em}
.card p{color:var(--muted);margin-bottom:.6em}
.card .more{font-weight:600}
.prose{max-width:760px}
.prose p,.prose li{font-size:1.05rem}
.prose img{border-radius:var(--radius);margin:24px 0}
.prose h2{margin-top:1.8em}
.prose blockquote{margin:22px 0;padding:14px 18px;border-left:4px solid var(--accent);background:var(--surface);border-radius:0 var(--radius) var(--radius) 0}
.prose blockquote p{margin:0}
.prose table{width:100%;border-collapse:collapse;margin:20px 0;font-size:.95rem}
.prose th,.prose td{border:1px solid rgba(0,0,0,.1);padding:9px 12px;text-align:left;vertical-align:top}
.prose th{background:var(--surface);font-family:var(--font-heading);font-weight:600}
.prose strong{color:var(--primary-dark)}
.takeaways{background:var(--surface);border:1px solid rgba(0,0,0,.06);border-radius:var(--radius);padding:18px 22px;margin:0 0 24px;max-width:760px}
.takeaways h2{font-size:1.05rem;margin-bottom:.5em}
.takeaways ul{margin:0}
.toc{border:1px dashed rgba(0,0,0,.2);border-radius:var(--radius);padding:14px 20px;margin:0 0 24px;max-width:760px;font-size:.95rem}
.toc strong{display:block;margin-bottom:6px;font-family:var(--font-heading)}
.toc ol{margin:0;padding-left:1.2em}
.toc li{margin-bottom:.25em}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}
.two-col img{border-radius:var(--radius)}
.steps{counter-reset:step;display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.steps .step{background:var(--bg);padding:22px;border-radius:var(--radius);border:1px solid rgba(0,0,0,.08);position:relative}
.steps .step::before{counter-increment:step;content:counter(step);display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:var(--accent);color:#111;font-weight:700;margin-bottom:12px}
.why-list{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.why-list li{list-style:none;background:var(--bg);padding:16px 18px;border-left:4px solid var(--accent);border-radius:6px}
.faq details{border:1px solid rgba(0,0,0,.1);border-radius:var(--radius);padding:14px 18px;margin-bottom:10px;background:var(--bg)}
.faq summary{font-weight:600;cursor:pointer;font-family:var(--font-heading)}
.faq details[open] summary{margin-bottom:8px}
.cta-band{background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:#fff;padding:56px 0;text-align:center}
.cta-band h2{color:#fff}
.cta-band p{opacity:.9;max-width:600px;margin:0 auto 20px}
.cta-band .btn{background:#fff;color:var(--primary);border-color:#fff}
.posts .card .meta{font-size:.85rem;color:var(--muted);margin-bottom:.4em}
.post-meta{display:flex;gap:14px;color:var(--muted);font-size:.92rem;flex-wrap:wrap;margin-bottom:24px}
.author-box{display:flex;gap:16px;align-items:flex-start;background:var(--surface);padding:20px;border-radius:var(--radius);margin-top:40px}
.author-box .avatar{width:56px;height:56px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-family:var(--font-heading);flex:none}
.related{margin-top:48px}
.breadcrumb{font-size:.9rem;color:var(--muted);margin-bottom:14px}
.breadcrumb ol{list-style:none;padding:0;margin:0;display:flex;gap:6px;flex-wrap:wrap}
.breadcrumb li+li::before{content:"/";margin-right:6px;opacity:.6}
.contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px}
.contact-card{background:var(--surface);padding:24px;border-radius:var(--radius)}
.contact-card dl{margin:0}
.contact-card dt{font-weight:600;margin-top:12px}
.contact-card dd{margin:2px 0 0}
.map{border-radius:var(--radius);overflow:hidden;min-height:320px}
.map iframe{width:100%;height:100%;min-height:320px;border:0}
.site-footer{background:#111827;color:#d1d5db;padding:48px 0 24px;margin-top:40px}
.site-footer a{color:#e5e7eb}
.site-footer .cols{display:grid;gap:28px;grid-template-columns:2fr 1fr 1fr}
.site-footer h4{color:#fff;margin-bottom:.6em}
.site-footer ul{list-style:none;padding:0;margin:0}
.site-footer li{margin-bottom:.4em}
.site-footer .bottom{border-top:1px solid rgba(255,255,255,.12);margin-top:28px;padding-top:16px;font-size:.85rem;color:#9ca3af;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
.service-detail{padding:32px 0;border-bottom:1px solid rgba(0,0,0,.08)}
.service-detail .two-col{align-items:start}
.credit{font-size:.8rem;color:var(--muted)}
figure{margin:24px 0}
figcaption{font-size:.85rem;color:var(--muted);margin-top:6px}
@media (max-width:860px){
  .hero.split .container,.two-col,.contact-grid{grid-template-columns:1fr}
  .site-footer .cols{grid-template-columns:1fr}
  .nav{display:none;width:100%;flex-direction:column;align-items:stretch;padding-bottom:12px}
  .nav.open{display:flex}
  .nav-toggle{display:inline-block;margin-left:auto}
  .hero{padding:44px 0}
  .section{padding:40px 0}
}
`;
}

export const SITE_JS = `document.addEventListener('DOMContentLoaded',function(){var t=document.querySelector('.nav-toggle'),n=document.querySelector('.nav');if(t&&n){t.addEventListener('click',function(){var o=n.classList.toggle('open');t.setAttribute('aria-expanded',o?'true':'false')})}});`;
