import type { EntityData, PageContent, SitePlan } from '../core/types.js';
import { mdToText } from './markdown.js';

export interface SchemaContext {
  siteUrl: string; // https://example.com
  brandName: string;
  entity: EntityData;
  plan: SitePlan | null;
  logoUrl: string;
  ogImageUrl: string;
  language: 'vi' | 'en';
}

function clean<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const inner = clean(v as Record<string, unknown>);
      if (Object.keys(inner).length === 0) continue;
      out[k] = inner;
      continue;
    }
    out[k] = v;
  }
  return out as T;
}

export function sameAsList(entity: EntityData): string[] {
  const s = entity.sameAs;
  return [s.facebook, s.youtube, s.tiktok, s.instagram, s.linkedin, s.x, s.pinterest, s.zalo, s.googleMaps, s.wikipedia, ...s.other].map((v) => v.trim()).filter((v) => /^https?:\/\//.test(v));
}

export function organizationSchema(ctx: SchemaContext): Record<string, unknown> {
  const e = ctx.entity;
  const isLocal = e.type !== 'Organization' && e.type !== 'Person';
  const address = clean({
    '@type': 'PostalAddress',
    streetAddress: e.address.streetAddress,
    addressLocality: e.address.addressLocality,
    addressRegion: e.address.addressRegion,
    postalCode: e.address.postalCode,
    addressCountry: e.address.addressCountry,
  });
  const base = clean({
    '@type': e.type === 'Person' ? 'Person' : e.type,
    '@id': `${ctx.siteUrl}/#organization`,
    name: e.name || ctx.brandName,
    alternateName: e.alternateName.filter(Boolean),
    legalName: e.legalName,
    url: `${ctx.siteUrl}/`,
    logo: clean({ '@type': 'ImageObject', '@id': `${ctx.siteUrl}/#logo`, url: ctx.logoUrl, contentUrl: ctx.logoUrl, caption: e.name || ctx.brandName }),
    image: ctx.ogImageUrl,
    description: e.description || ctx.plan?.tagline,
    foundingDate: e.foundingDate,
    founder: e.founder ? clean({ '@type': 'Person', name: e.founder, sameAs: e.founderSameAs.filter(Boolean) }) : undefined,
    taxID: e.taxId,
    telephone: e.telephone,
    email: e.email,
    address: Object.keys(address).length > 2 ? address : undefined,
    sameAs: sameAsList(e),
    areaServed: e.areaServed.filter(Boolean),
    contactPoint: e.telephone
      ? clean({ '@type': 'ContactPoint', telephone: e.telephone, contactType: 'customer service', email: e.email, availableLanguage: ctx.language === 'vi' ? ['Vietnamese'] : ['English'] })
      : undefined,
  });
  if (isLocal) {
    const geo = e.geo.lat && e.geo.lng ? { '@type': 'GeoCoordinates', latitude: Number(e.geo.lat), longitude: Number(e.geo.lng) } : undefined;
    return clean({ ...base, geo, priceRange: e.priceRange, openingHours: e.openingHours.filter(Boolean), hasMap: e.sameAs.googleMaps || undefined });
  }
  return base;
}

export function websiteSchema(ctx: SchemaContext): Record<string, unknown> {
  return clean({
    '@type': 'WebSite',
    '@id': `${ctx.siteUrl}/#website`,
    url: `${ctx.siteUrl}/`,
    name: ctx.entity.name || ctx.brandName,
    description: ctx.plan?.tagline,
    publisher: { '@id': `${ctx.siteUrl}/#organization` },
    inLanguage: ctx.language === 'vi' ? 'vi-VN' : 'en',
  });
}

export function personSchema(ctx: SchemaContext): Record<string, unknown> | null {
  const a = ctx.entity.author;
  const name = a.name || ctx.plan?.authorName;
  if (!name) return null;
  return clean({
    '@type': 'Person',
    '@id': `${ctx.siteUrl}/#author`,
    name,
    jobTitle: a.jobTitle || ctx.plan?.authorTitle,
    description: a.bio || ctx.plan?.authorBio,
    url: `${ctx.siteUrl}/gioi-thieu/`,
    sameAs: a.sameAs.filter(Boolean),
    worksFor: { '@id': `${ctx.siteUrl}/#organization` },
  });
}

export function breadcrumbSchema(ctx: SchemaContext, items: { name: string; url: string }[]): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}

export function faqSchema(faq: { question: string; answer: string }[]): Record<string, unknown> | null {
  if (!faq.length) return null;
  return {
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: mdToText(f.answer) } })),
  };
}

export function webPageSchema(ctx: SchemaContext, page: PageContent, url: string, opts: { heroImage?: string; datePublished?: string; dateModified?: string }): Record<string, unknown> {
  const typeMap: Record<PageContent['kind'], string> = {
    home: 'WebPage',
    about: 'AboutPage',
    services: 'CollectionPage',
    blog: 'CollectionPage',
    post: 'WebPage',
    contact: 'ContactPage',
    privacy: 'WebPage',
  };
  return clean({
    '@type': typeMap[page.kind],
    '@id': `${url}#webpage`,
    url,
    name: page.title,
    description: page.metaDescription,
    isPartOf: { '@id': `${ctx.siteUrl}/#website` },
    about: { '@id': `${ctx.siteUrl}/#organization` },
    primaryImageOfPage: opts.heroImage ? { '@type': 'ImageObject', url: opts.heroImage } : undefined,
    datePublished: opts.datePublished,
    dateModified: opts.dateModified,
    inLanguage: ctx.language === 'vi' ? 'vi-VN' : 'en',
  });
}

export function articleSchema(ctx: SchemaContext, page: PageContent, url: string, opts: { heroImage?: string; datePublished: string; dateModified: string; wordCount: number }): Record<string, unknown> {
  const author = personSchema(ctx);
  return clean({
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    mainEntityOfPage: { '@id': `${url}#webpage` },
    headline: page.h1.slice(0, 110),
    description: page.metaDescription,
    image: opts.heroImage ? [opts.heroImage] : undefined,
    datePublished: opts.datePublished,
    dateModified: opts.dateModified,
    author: author ? { '@id': `${ctx.siteUrl}/#author` } : { '@id': `${ctx.siteUrl}/#organization` },
    publisher: { '@id': `${ctx.siteUrl}/#organization` },
    keywords: page.targetKeyword,
    wordCount: opts.wordCount,
    inLanguage: ctx.language === 'vi' ? 'vi-VN' : 'en',
    isAccessibleForFree: true,
  });
}

export function servicesSchema(ctx: SchemaContext, services: { name: string; summary: string; slug: string }[], pageUrl: string): Record<string, unknown> | null {
  if (!services.length) return null;
  return {
    '@type': 'ItemList',
    itemListElement: services.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: clean({
        '@type': 'Service',
        name: s.name,
        description: mdToText(s.summary),
        url: `${pageUrl}#${s.slug}`,
        provider: { '@id': `${ctx.siteUrl}/#organization` },
        areaServed: ctx.entity.areaServed.filter(Boolean),
      }),
    })),
  };
}

/** Gói toàn bộ thành một @graph duy nhất cho trang. */
export function buildGraph(nodes: (Record<string, unknown> | null | undefined)[]): string {
  const graph = nodes.filter((n): n is Record<string, unknown> => Boolean(n));
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 0).replace(/</g, '\\u003c');
}

/** Kiểm tra tối thiểu để dashboard cảnh báo trước khi đồng bộ. */
export function validateEntity(entity: EntityData, brandName: string): string[] {
  const warn: string[] = [];
  if (!entity.name && !brandName) warn.push('Thiếu tên tổ chức');
  if (!entity.description) warn.push('Nên có mô tả ngắn về doanh nghiệp (description)');
  if (entity.type !== 'Organization' && entity.type !== 'Person') {
    if (!entity.address.streetAddress || !entity.address.addressLocality) warn.push('LocalBusiness nên có địa chỉ đầy đủ');
    if (!entity.telephone) warn.push('LocalBusiness nên có số điện thoại');
  }
  if (sameAsList(entity).length === 0) warn.push('Chưa có liên kết mạng xã hội (sameAs), Google khó xác nhận thực thể');
  for (const [k, v] of Object.entries(entity.sameAs)) {
    if (typeof v === 'string' && v && !/^https?:\/\//.test(v)) warn.push(`Liên kết ${k} phải bắt đầu bằng https://`);
  }
  if (entity.geo.lat && Number.isNaN(Number(entity.geo.lat))) warn.push('Vĩ độ (lat) không phải số');
  if (entity.geo.lng && Number.isNaN(Number(entity.geo.lng))) warn.push('Kinh độ (lng) không phải số');
  return warn;
}
