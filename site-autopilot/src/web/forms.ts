import { EntitySchema, SiteBriefSchema, WafSettingsSchema, GeneralSettingsSchema, type EntityData, type SiteBrief, type WafSettings, type GeneralSettings } from '../core/types.js';
import { isValidDomain, normalizeDomain, parseList } from '../core/util.js';

export type FormBody = Record<string, string | File | (string | File)[]>;

export function str(body: FormBody, key: string): string {
  const v = body[key];
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : '';
  return typeof v === 'string' ? v.trim() : '';
}

export function file(body: FormBody, key: string): File | null {
  const v = body[key];
  if (v instanceof File && v.size > 0) return v;
  return null;
}

export function parseNewSite(body: FormBody, defaults: GeneralSettings): { domain: string; brief: SiteBrief; entity: EntityData; serverId: number | null; errors: string[] } {
  const errors: string[] = [];
  const domain = normalizeDomain(str(body, 'domain'));
  if (!isValidDomain(domain)) errors.push('Domain không hợp lệ');
  const briefRaw = {
    brandName: str(body, 'brandName'),
    siteType: str(body, 'siteType') || 'business',
    language: str(body, 'language') || defaults.defaultLanguage,
    industry: str(body, 'industry'),
    description: str(body, 'description'),
    services: parseList(str(body, 'services')),
    keywords: parseList(str(body, 'keywords')),
    targetAudience: str(body, 'targetAudience'),
    location: str(body, 'location'),
    usp: str(body, 'usp'),
    tone: str(body, 'tone'),
    postsCount: Number.parseInt(str(body, 'postsCount') || String(defaults.defaultPostsCount), 10),
    themeId: str(body, 'themeId') || 'auto',
    contentStyle: str(body, 'contentStyle') || 'auto',
    useStockImages: str(body, 'useStockImages') === '1',
    targetCountries: parseList(str(body, 'targetCountries')).map((c) => c.toUpperCase()),
    notes: str(body, 'notes'),
  };
  const brief = SiteBriefSchema.safeParse(briefRaw);
  if (!brief.success) errors.push(...brief.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  const entity = EntitySchema.parse({
    type: str(body, 'entityType') || 'LocalBusiness',
    name: briefRaw.brandName,
    telephone: str(body, 'telephone'),
    email: str(body, 'email'),
    address: { streetAddress: str(body, 'streetAddress'), addressLocality: str(body, 'addressLocality'), addressCountry: 'VN' },
    sameAs: { facebook: str(body, 'facebook'), youtube: str(body, 'youtube') },
    author: { name: str(body, 'authorName'), jobTitle: str(body, 'authorTitle') },
    areaServed: briefRaw.location ? [briefRaw.location] : [],
    description: briefRaw.description.slice(0, 300),
  });
  const serverId = Number.parseInt(str(body, 'server_id'), 10);
  return { domain, brief: brief.success ? brief.data : (briefRaw as unknown as SiteBrief), entity, serverId: Number.isFinite(serverId) ? serverId : null, errors };
}

export function parseBriefEdit(body: FormBody, current: SiteBrief): SiteBrief {
  return SiteBriefSchema.parse({
    ...current,
    brandName: str(body, 'brandName') || current.brandName,
    industry: str(body, 'industry') || current.industry,
    location: str(body, 'location'),
    description: str(body, 'description'),
    services: parseList(str(body, 'services')),
    keywords: parseList(str(body, 'keywords')),
    targetAudience: str(body, 'targetAudience'),
    usp: str(body, 'usp'),
    tone: str(body, 'tone'),
    themeId: str(body, 'themeId') || 'auto',
    contentStyle: str(body, 'contentStyle') || current.contentStyle,
    useStockImages: str(body, 'useStockImages') === '1',
    targetCountries: parseList(str(body, 'targetCountries')).map((c) => c.toUpperCase()),
    notes: str(body, 'notes'),
  });
}

export function parseEntity(body: FormBody, current: EntityData): EntityData {
  return EntitySchema.parse({
    type: str(body, 'type') || current.type,
    name: str(body, 'name'),
    alternateName: parseList(str(body, 'alternateName')),
    legalName: str(body, 'legalName'),
    description: str(body, 'description'),
    foundingDate: str(body, 'foundingDate'),
    founder: str(body, 'founder'),
    founderSameAs: parseList(str(body, 'founderSameAs')),
    taxId: str(body, 'taxId'),
    telephone: str(body, 'telephone'),
    email: str(body, 'email'),
    address: {
      streetAddress: str(body, 'streetAddress'),
      addressLocality: str(body, 'addressLocality'),
      addressRegion: str(body, 'addressRegion'),
      postalCode: str(body, 'postalCode'),
      addressCountry: str(body, 'addressCountry') || 'VN',
    },
    geo: { lat: str(body, 'lat'), lng: str(body, 'lng') },
    openingHours: parseList(str(body, 'openingHours')),
    priceRange: str(body, 'priceRange'),
    areaServed: parseList(str(body, 'areaServed')),
    sameAs: {
      facebook: str(body, 'facebook'),
      youtube: str(body, 'youtube'),
      tiktok: str(body, 'tiktok'),
      instagram: str(body, 'instagram'),
      linkedin: str(body, 'linkedin'),
      x: str(body, 'x'),
      pinterest: str(body, 'pinterest'),
      zalo: str(body, 'zalo'),
      googleMaps: str(body, 'googleMaps'),
      wikipedia: str(body, 'wikipedia'),
      other: parseList(str(body, 'otherSameAs')),
    },
    author: { name: str(body, 'authorName'), jobTitle: str(body, 'authorJobTitle'), bio: str(body, 'authorBio'), sameAs: parseList(str(body, 'authorSameAs')) },
    ga4Id: str(body, 'ga4Id'),
    gtmId: str(body, 'gtmId'),
    googleSiteVerification: str(body, 'googleSiteVerification'),
    bingSiteVerification: str(body, 'bingSiteVerification'),
    mapEmbedUrl: str(body, 'mapEmbedUrl'),
  });
}

export function parseWaf(body: FormBody, current: WafSettings): WafSettings {
  return WafSettingsSchema.parse({
    skipVerifiedBots: str(body, 'skipVerifiedBots') === '1',
    geoBlockEnabled: str(body, 'geoBlockEnabled') === '1',
    allowedCountries: parseList(str(body, 'allowedCountries')).map((c) => c.toUpperCase()),
    blockQueryStrings: str(body, 'blockQueryStrings') === '1',
    allowedQueryTerms: parseList(str(body, 'allowedQueryTerms')),
    blockedPaths: parseList(str(body, 'blockedPaths')),
    rateLimit: {
      requestsPerPeriod: Number.parseInt(str(body, 'requestsPerPeriod'), 10) || current.rateLimit.requestsPerPeriod,
      period: 10,
      mitigationTimeout: 10,
    },
  });
}

export function parseGeneral(body: FormBody, current: GeneralSettings): GeneralSettings {
  return GeneralSettingsSchema.parse({
    defaultLanguage: str(body, 'defaultLanguage') || current.defaultLanguage,
    defaultPostsCount: Number.parseInt(str(body, 'defaultPostsCount'), 10),
    defaultContentStyle: str(body, 'defaultContentStyle') || current.defaultContentStyle,
    defaultTargetCountries: parseList(str(body, 'defaultTargetCountries')).map((c) => c.toUpperCase()),
    autoSyncEntity: str(body, 'autoSyncEntity') === '1',
    autoSubmitSitemap: str(body, 'autoSubmitSitemap') === '1',
  });
}
