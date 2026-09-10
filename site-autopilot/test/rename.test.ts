import { describe, expect, it } from 'vitest';
import { Db } from '../src/db/index.js';
import { brandReplacementPairs, replaceTextInSite } from '../src/core/rename.js';
import { EntitySchema, SiteBriefSchema, type PageContent } from '../src/core/types.js';

describe('đổi tên thương hiệu trong nội dung đã sinh', () => {
  it('sinh cặp thay thế: tên đầy đủ và đuôi 2 từ', () => {
    expect(brandReplacementPairs('Hủ Tiếu Nam Vang Ông Giao', 'Hủ Tiếu Nam Vang Ông Giáo')).toEqual([
      ['Hủ Tiếu Nam Vang Ông Giao', 'Hủ Tiếu Nam Vang Ông Giáo'],
      ['Ông Giao', 'Ông Giáo'],
    ]);
    expect(brandReplacementPairs('Điện lạnh Minh', 'Điện lạnh Minh')).toEqual([]);
    expect(brandReplacementPairs('A B', 'C D')).toEqual([['A B', 'C D']]);
  });

  it('thay trong title, sections, faq, services, plan và đếm đúng', () => {
    const db = new Db(':memory:');
    const brief = SiteBriefSchema.parse({ brandName: 'Hủ Tiếu Nam Vang Ông Giao', industry: 'Ẩm thực' });
    const id = db.createSite({ domain: 'x.com', server_id: null, brief, entity: EntitySchema.parse({}) });
    const content: PageContent = {
      kind: 'post',
      title: 'Hủ tiếu ngon | Ông Giao',
      metaDescription: 'Quán Hủ Tiếu Nam Vang Ông Giao ở Phan Rang',
      h1: 'Ông Giao kể chuyện',
      intro: 'Không đổi',
      sections: [{ heading: 'Về Ông Giao', body: 'Ông Giao nấu từ 1998. Ông Giao mở 5 giờ.' }],
      faq: [{ question: 'Ông Giao ở đâu?', answer: 'Phan Rang' }],
    };
    db.upsertPage({ site_id: id, kind: 'post', slug: 'blog/a', title: content.title, content });
    db.updateSite(id, { plan: { tagline: 'Ông Giao nấu ngon', brandVoice: '', audienceInsight: '', heroImageQuery: '', aboutImageQuery: '', services: [], posts: [], faq: [], ctaPrimary: '', ctaSecondary: '', differentiators: [], authorName: 'Ông Giao', authorTitle: '', authorBio: '' } });

    const r = replaceTextInSite(db, id, brandReplacementPairs('Hủ Tiếu Nam Vang Ông Giao', 'Hủ Tiếu Nam Vang Ông Giáo'));
    expect(r.pages).toBe(1);
    expect(r.replacements).toBe(9);
    const page = db.getPageBySlug(id, 'blog/a')!;
    expect(page.title).toBe('Hủ tiếu ngon | Ông Giáo');
    expect(page.content.metaDescription).toBe('Quán Hủ Tiếu Nam Vang Ông Giáo ở Phan Rang');
    expect(page.content.sections[0]?.body).toBe('Ông Giáo nấu từ 1998. Ông Giáo mở 5 giờ.');
    expect(page.content.faq[0]?.question).toBe('Ông Giáo ở đâu?');
    expect(page.content.intro).toBe('Không đổi');
    expect(db.getSite(id)?.plan?.tagline).toBe('Ông Giáo nấu ngon');
    db.close();
  });
});
