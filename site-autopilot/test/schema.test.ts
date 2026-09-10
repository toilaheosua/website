import { describe, expect, it } from 'vitest';
import { EntitySchema, type SitePlan } from '../src/core/types.js';
import { buildGraph, organizationSchema, personSchema, validateEntity, websiteSchema, type SchemaContext } from '../src/generator/schema.js';

const plan: SitePlan = {
  tagline: 'Sửa điện lạnh tận nơi',
  brandVoice: '',
  audienceInsight: '',
  heroImageQuery: 'x',
  aboutImageQuery: 'y',
  services: [{ name: 'Sửa máy lạnh', summary: 'a', imageQuery: 'b' }],
  posts: [],
  faq: [],
  ctaPrimary: 'Gọi ngay',
  ctaSecondary: 'Xem thêm',
  differentiators: [],
  authorName: 'Nguyễn A',
  authorTitle: 'Kỹ thuật viên',
  authorBio: 'bio',
};

function ctx(entity = EntitySchema.parse({})): SchemaContext {
  return { siteUrl: 'https://vidu.com', brandName: 'Điện lạnh Minh', entity, plan, logoUrl: 'https://vidu.com/logo.png', ogImageUrl: 'https://vidu.com/og.png', language: 'vi' };
}

describe('JSON-LD', () => {
  it('Organization tối thiểu không chứa trường rỗng', () => {
    const org = organizationSchema(ctx());
    expect(org['@type']).toBe('Organization');
    expect(org.name).toBe('Điện lạnh Minh');
    expect(org).not.toHaveProperty('telephone');
    expect(org).not.toHaveProperty('address');
    expect(org).not.toHaveProperty('sameAs');
  });

  it('LocalBusiness có địa chỉ, geo, giờ mở cửa, sameAs', () => {
    const entity = EntitySchema.parse({
      type: 'LocalBusiness',
      name: 'Điện lạnh Minh',
      telephone: '0909 000 000',
      address: { streetAddress: '12 Nguyễn Văn Linh', addressLocality: 'Quận 7', addressRegion: 'TP.HCM' },
      geo: { lat: '10.73', lng: '106.72' },
      openingHours: ['Mo-Su 08:00-20:00'],
      sameAs: { facebook: 'https://facebook.com/dienlanhminh', zalo: 'zalo.me/abc' },
    });
    const org = organizationSchema(ctx(entity)) as Record<string, unknown>;
    expect(org['@type']).toBe('LocalBusiness');
    expect((org.address as Record<string, unknown>).addressLocality).toBe('Quận 7');
    expect(org.geo).toEqual({ '@type': 'GeoCoordinates', latitude: 10.73, longitude: 106.72 });
    expect(org.openingHours).toEqual(['Mo-Su 08:00-20:00']);
    expect(org.sameAs).toEqual(['https://facebook.com/dienlanhminh']);
    expect((org.contactPoint as Record<string, unknown>).telephone).toBe('0909 000 000');
  });

  it('graph hợp lệ và thoát ký tự <', () => {
    const c = ctx();
    const json = buildGraph([organizationSchema(c), websiteSchema(c), personSchema(c), null]);
    const parsed = JSON.parse(json) as { '@context': string; '@graph': unknown[] };
    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@graph']).toHaveLength(3);
    expect(buildGraph([{ '@type': 'Thing', name: '<script>' }])).not.toContain('<');
  });

  it('validateEntity cảnh báo thiếu dữ liệu quan trọng', () => {
    const w = validateEntity(EntitySchema.parse({ type: 'LocalBusiness', sameAs: { facebook: 'facebook.com/x' } }), 'Brand');
    expect(w.some((x) => x.includes('địa chỉ'))).toBe(true);
    expect(w.some((x) => x.includes('https://'))).toBe(true);
    expect(w.some((x) => x.includes('sameAs'))).toBe(true);
  });
});
