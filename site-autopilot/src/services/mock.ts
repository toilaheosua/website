import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { AapanelClient, CfDnsRecord, CfRule, CfZone, CloudflareClient, ContentGenerator, GoogleClient, ImageProvider, IndexNowClient, PanelSite, ServerConn, SshClient, StockPhoto } from './types.js';
import { listLocalFiles, planUpload } from './deploy-diff.js';
import type { EntityData, PageContent, SiteBrief, SitePlan } from '../core/types.js';
import { randomHex, slugify } from '../core/util.js';

/**
 * Bộ dịch vụ giả lập: chạy toàn bộ pipeline không cần mạng, không tốn tiền.
 * Dùng để kiểm thử dashboard và luồng xử lý (MOCK_MODE=1).
 */

export class MockCloudflare implements CloudflareClient {
  zones = new Map<string, CfZone & { polls: number; dns: CfDnsRecord[]; settings: Record<string, unknown>; rules: Record<string, CfRule[]>; botFight: boolean }>();
  /** Số lần poll trước khi zone active (mô phỏng chờ đổi NS). */
  activateAfterPolls = 2;

  async verifyToken() {
    return { ok: true, message: 'Mock Cloudflare' };
  }
  async findZone(name: string) {
    for (const z of this.zones.values()) if (z.name === name) return z;
    return null;
  }
  async createZone(name: string): Promise<CfZone> {
    const z = { id: 'zone_' + randomHex(8), name, status: 'pending', name_servers: ['ada.ns.cloudflare.com', 'rob.ns.cloudflare.com'], polls: 0, dns: [], settings: {}, rules: {}, botFight: false };
    this.zones.set(z.id, z);
    return z;
  }
  async getZone(zoneId: string): Promise<CfZone> {
    const z = this.zones.get(zoneId);
    if (!z) throw new Error('mock: zone không tồn tại');
    z.polls++;
    if (z.polls >= this.activateAfterPolls) z.status = 'active';
    return z;
  }
  async triggerActivationCheck() {}
  async deleteZone(zoneId: string) {
    this.zones.delete(zoneId);
  }
  async listDnsRecords(zoneId: string) {
    return this.zones.get(zoneId)?.dns ?? [];
  }
  async upsertDnsRecord(zoneId: string, rec: { type: 'A' | 'CNAME' | 'TXT'; name: string; content: string; proxied: boolean }): Promise<CfDnsRecord> {
    const z = this.zones.get(zoneId);
    if (!z) throw new Error('mock: zone không tồn tại');
    const name = rec.name === '@' ? z.name : rec.name.endsWith(z.name) ? rec.name : `${rec.name}.${z.name}`;
    const existing = z.dns.find((d) => d.name === name && d.type === rec.type);
    if (existing) {
      Object.assign(existing, { content: rec.content, proxied: rec.proxied });
      return existing;
    }
    const r: CfDnsRecord = { id: 'rec_' + randomHex(6), type: rec.type, name, content: rec.content, proxied: rec.proxied };
    z.dns.push(r);
    return r;
  }
  async deleteDnsRecord(zoneId: string, recordId: string) {
    const z = this.zones.get(zoneId);
    if (z) z.dns = z.dns.filter((d) => d.id !== recordId);
  }
  async setZoneSetting(zoneId: string, setting: string, value: unknown) {
    const z = this.zones.get(zoneId);
    if (z) z.settings[setting] = value;
  }
  async getZoneSetting(zoneId: string, setting: string) {
    return this.zones.get(zoneId)?.settings[setting] ?? null;
  }
  async setBotFightMode(zoneId: string, enabled: boolean) {
    const z = this.zones.get(zoneId);
    if (z) z.botFight = enabled;
  }
  async purgeCache() {}
  async getPhaseRules(zoneId: string, phase: string) {
    const z = this.zones.get(zoneId);
    return { rulesetId: z?.rules[phase] ? 'rs_' + phase : null, rules: z?.rules[phase] ?? [] };
  }
  async replacePhaseRules(zoneId: string, phase: string, rules: CfRule[]) {
    const z = this.zones.get(zoneId);
    if (!z) throw new Error('mock: zone không tồn tại');
    z.rules[phase] = rules.map((r, i) => ({ ...r, id: `rule_${phase}_${i}` }));
    return { rulesetId: 'rs_' + phase, rules: z.rules[phase] as CfRule[] };
  }
}

export class MockAapanel implements AapanelClient {
  sites: PanelSite[] = [];
  async ping() {
    return { ok: true, message: 'Mock aaPanel' };
  }
  async findSite(domain: string) {
    return this.sites.find((s) => s.name === domain) ?? null;
  }
  async addSite(input: { domain: string; path: string; remark: string }) {
    const s: PanelSite = { id: this.sites.length + 1, name: input.domain, path: input.path, status: '1', ps: input.remark };
    this.sites.push(s);
    return s;
  }
  async deleteSite(site: PanelSite) {
    this.sites = this.sites.filter((s) => s.id !== site.id);
  }
  async phpVersions() {
    return [
      { version: '00', name: 'Static' },
      { version: '82', name: 'PHP-82' },
    ];
  }
}

/** Deploy giả lập: sao chép thư mục output vào data/mock-deploy/<remoteDir>. */
export function mockSshFactory(mockRoot: string) {
  return async (_server: ServerConn): Promise<SshClient> => ({
    async exec(command: string) {
      return { code: 0, stdout: `mock: ${command.slice(0, 60)}`, stderr: '' };
    },
    async uploadDirectory(localDir: string, remoteDir: string) {
      const dest = path.join(mockRoot, remoteDir.replace(/^\/+/, ''));
      const remote = new Map(fs.existsSync(dest) ? listLocalFiles(dest).map((f) => [f.rel, f.md5]) : []);
      const plan = planUpload(listLocalFiles(localDir), remote);
      for (const rel of plan.remove) fs.rmSync(path.join(dest, rel), { force: true });
      let bytes = 0;
      for (const f of plan.upload) {
        fs.mkdirSync(path.dirname(path.join(dest, f.rel)), { recursive: true });
        fs.copyFileSync(f.abs, path.join(dest, f.rel));
        bytes += f.size;
      }
      return { files: plan.upload.length, bytes, unchanged: plan.unchanged, removed: plan.remove.length };
    },
    async close() {},
  });
}

const LOREM_VI = [
  'Khách hàng thường bắt đầu bằng một câu hỏi rất cụ thể: nên chọn phương án nào cho đúng nhu cầu và ngân sách. Câu trả lời phụ thuộc vào ba yếu tố: quy mô, thời gian sử dụng và mức độ ưu tiên giữa chi phí ban đầu với chi phí vận hành.',
  'Trước khi quyết định, hãy liệt kê những gì bạn đang có, những gì bắt buộc phải thay và những gì có thể tận dụng lại. Cách này giúp bạn tránh chi tiền cho hạng mục chưa thật sự cần.',
  'Trong thực tế, phần lớn sự cố đến từ khâu chuẩn bị chứ không phải khâu thi công. Một buổi khảo sát kỹ có thể tiết kiệm nhiều ngày sửa chữa về sau.',
  'Nếu bạn còn phân vân, hãy hỏi đơn vị cung cấp về quy trình bàn giao, thời gian bảo hành và cách xử lý khi phát sinh. Câu trả lời rõ ràng là dấu hiệu tốt.',
];

function fakeBody(seed: string, n = 3): string {
  const out: string[] = [];
  const offset = [...seed].reduce((h, ch) => h + ch.charCodeAt(0), 0);
  for (let i = 0; i < n; i++) out.push(`${LOREM_VI[(offset + i) % LOREM_VI.length]} (${seed}, đoạn ${i + 1})`);
  out.push(`- Điểm cần nhớ thứ nhất về ${seed}\n- Điểm cần nhớ thứ hai\n- Điểm cần nhớ thứ ba`);
  if (seed.endsWith('-1')) out.push('> **Mẹo:** Hỏi rõ thời gian bảo hành trước khi ký, xem thêm [dịch vụ của chúng tôi](/dich-vu/) hoặc [liên hệ](/lien-he/).');
  if (seed.endsWith('-2')) out.push('| Phương án | Phù hợp với | Chi phí tham khảo |\n|---|---|---|\n| Sửa tại chỗ | Lỗi nhỏ | Thấp |\n| Thay mới | Thiết bị cũ | Cao hơn |');
  return out.join('\n\n');
}

export class MockContentGenerator implements ContentGenerator {
  private stats = { inputTokens: 0, outputTokens: 0, calls: 0 };
  async generatePlan(input: { brief: SiteBrief; entity: EntityData; domain: string; contentStyle?: 'story' | 'expert' | 'playbook' }): Promise<SitePlan> {
    const { brief } = input;
    this.stats.calls++;
    const services = (brief.services.length ? brief.services : [`${brief.industry} trọn gói`, `Tư vấn ${brief.industry}`, `Bảo trì ${brief.industry}`, `Khảo sát và báo giá`]).map((name) => ({
      name,
      slug: slugify(name),
      summary: `${name} cho khách hàng tại ${brief.location || 'khu vực của bạn'}, làm đúng nhu cầu và minh bạch chi phí.`,
      imageQuery: 'professional service work',
    }));
    const posts = Array.from({ length: brief.postsCount }, (_, i) => {
      const title = `${i + 1}. Kinh nghiệm chọn ${brief.industry.toLowerCase()} phù hợp cho ${['gia đình', 'văn phòng', 'cửa hàng', 'nhà xưởng', 'chung cư', 'nhà phố'][i % 6]}`;
      return { title, slug: slugify(title), targetKeyword: `${brief.industry.toLowerCase()} ${['gia đình', 'văn phòng', 'cửa hàng', 'nhà xưởng', 'chung cư', 'nhà phố'][i % 6]}`, angle: 'Hướng dẫn thực tế theo từng bước', imageQuery: 'home interior work' };
    });
    return {
      contentStyle: input.contentStyle ?? 'expert',
      tagline: `${brief.brandName}: ${brief.industry} đúng nhu cầu, rõ chi phí`,
      brandVoice: 'Thẳng thắn, thực tế, giải thích dễ hiểu như người trong nghề nói với bạn bè.',
      audienceInsight: `Khách hàng lo chọn sai đơn vị, phát sinh chi phí và mất thời gian. Họ muốn được tư vấn rõ ràng trước khi quyết định.`,
      heroImageQuery: 'modern office team',
      aboutImageQuery: 'team meeting handshake',
      services,
      posts,
      faq: [
        { question: 'Thời gian thực hiện thường mất bao lâu?', answer: 'Tùy quy mô, thông thường từ vài ngày đến hai tuần. Chúng tôi báo lịch cụ thể sau khi khảo sát.' },
        { question: 'Có khảo sát trước khi báo giá không?', answer: 'Có. Khảo sát giúp báo giá sát thực tế và tránh phát sinh.' },
        { question: 'Chính sách bảo hành thế nào?', answer: 'Mọi hạng mục đều có thời hạn bảo hành rõ ràng trong hợp đồng.' },
        { question: 'Có hỗ trợ ngoài giờ không?', answer: 'Có hỗ trợ theo lịch hẹn trước, kể cả cuối tuần.' },
      ],
      ctaPrimary: 'Nhận tư vấn miễn phí',
      ctaSecondary: 'Xem dịch vụ',
      differentiators: ['Báo giá minh bạch theo hạng mục', 'Phản hồi trong ngày làm việc', 'Bảo hành rõ ràng bằng văn bản'],
      authorName: input.entity.author.name || `Đội ngũ ${brief.brandName}`,
      authorTitle: input.entity.author.jobTitle || 'Biên tập nội dung',
      authorBio: `Nhiều năm làm việc trực tiếp trong lĩnh vực ${brief.industry.toLowerCase()}, chia sẻ kinh nghiệm thực tế cho khách hàng.`,
    };
  }

  async generatePage(input: { brief: SiteBrief; plan: SitePlan; kind: PageContent['kind']; post?: SitePlan['posts'][number] }): Promise<PageContent> {
    const { brief, plan, kind, post } = input;
    this.stats.calls++;
    const titles: Record<PageContent['kind'], string> = {
      home: `${brief.industry} tại ${brief.location || 'Việt Nam'} | ${brief.brandName}`,
      about: `Giới thiệu ${brief.brandName}`,
      services: `Dịch vụ ${brief.industry.toLowerCase()} | ${brief.brandName}`,
      blog: `Blog kinh nghiệm ${brief.industry.toLowerCase()} | ${brief.brandName}`,
      post: post?.title ?? 'Bài viết',
      contact: `Liên hệ ${brief.brandName}`,
      privacy: `Chính sách bảo mật | ${brief.brandName}`,
    };
    const h1s: Record<PageContent['kind'], string> = {
      home: `${brief.industry} ${brief.location ? 'tại ' + brief.location : ''} đúng nhu cầu, rõ chi phí`.trim(),
      about: `Câu chuyện của ${brief.brandName}`,
      services: `Dịch vụ của ${brief.brandName}`,
      blog: `Kinh nghiệm và hướng dẫn về ${brief.industry.toLowerCase()}`,
      post: post?.title ?? 'Bài viết',
      contact: `Liên hệ với ${brief.brandName}`,
      privacy: 'Chính sách bảo mật',
    };
    const sectionsCount = kind === 'post' ? 5 : kind === 'blog' ? 0 : 3;
    const sections = Array.from({ length: sectionsCount }, (_, i) => ({
      heading: `${['Điều cần biết trước', 'Cách lựa chọn phù hợp', 'Quy trình làm việc', 'Sai lầm thường gặp', 'Tóm tắt hành động'][i] ?? 'Nội dung'} về ${brief.industry.toLowerCase()}`,
      body: fakeBody(`${kind}-${i}`),
      imageQuery: i === 1 ? 'work process' : undefined,
    }));
    return {
      kind,
      title: titles[kind],
      metaDescription: `${brief.brandName} cung cấp ${brief.industry.toLowerCase()} ${brief.location ? 'tại ' + brief.location : ''}. Tư vấn rõ ràng, chi phí minh bạch, bảo hành bằng văn bản. Liên hệ để được hỗ trợ.`,
      h1: h1s[kind],
      intro: `${brief.brandName} làm ${brief.industry.toLowerCase()} cho ${brief.targetAudience || 'khách hàng cá nhân và doanh nghiệp'}. Trang này giúp bạn hiểu nhanh chúng tôi làm gì và làm như thế nào.`,
      sections,
      faq: kind === 'home' || kind === 'post' ? plan.faq.slice(0, 3) : [],
      heroImageQuery: post?.imageQuery,
      heroImageAlt: `${brief.brandName} ${brief.industry.toLowerCase()}`,
      keyTakeaways: kind === 'post' ? ['Khảo sát kỹ trước khi báo giá giúp tránh phát sinh', 'Hỏi rõ bảo hành và thời gian thực hiện', 'So sánh ít nhất hai phương án trước khi quyết định'] : undefined,
      excerpt: kind === 'post' ? 'Hướng dẫn thực tế giúp bạn chọn đúng ngay từ đầu.' : undefined,
      targetKeyword: post?.targetKeyword ?? brief.keywords[0] ?? brief.industry,
      services: kind === 'services' ? plan.services.map((s) => ({ name: s.name, slug: s.slug ?? slugify(s.name), summary: s.summary, body: fakeBody(s.name, 2), imageQuery: s.imageQuery })) : undefined,
    };
  }

  async editPage(input: { page: PageContent }): Promise<PageContent> {
    this.stats.calls++;
    return input.page;
  }

  async reviewPage(input: { brief: SiteBrief; entity: EntityData; plan: SitePlan; page: PageContent }): Promise<{ pass: boolean; summary: string; issues: { severity: 'major' | 'minor'; where: string; problem: string; fix: string }[] }> {
    this.stats.calls++;
    const bad = /MOCK_BAD/.test(input.page.intro);
    return bad
      ? { pass: false, summary: 'Bản mock bị đánh dấu không đạt để thử cổng kiểm duyệt.', issues: [{ severity: 'major', where: 'intro', problem: 'Có đánh dấu MOCK_BAD', fix: 'Bỏ đánh dấu' }] }
      : { pass: true, summary: 'Nội dung rõ ràng, đúng nhu cầu, không có dữ kiện ngoài brief.', issues: [] };
  }

  async suggestPostTopics(input: { brief: SiteBrief; existingTitles: string[]; count: number }): Promise<SitePlan['posts']> {
    this.stats.calls++;
    return Array.from({ length: input.count }, (_, i) => {
      const title = `Chủ đề mới ${input.existingTitles.length + i + 1} về ${input.brief.industry.toLowerCase()}`;
      return { title, slug: slugify(title), targetKeyword: title.toLowerCase(), angle: 'Góc nhìn thực tế', imageQuery: 'work desk' };
    });
  }

  usage() {
    return { ...this.stats };
  }

  async verify() {
    return { ok: true, message: 'Mock Claude' };
  }
}

/** Ảnh giả: gradient SVG có chữ, để không gọi Pexels. */
export class MockImageProvider implements ImageProvider {
  private counter = 0;
  async search(query: string): Promise<StockPhoto[]> {
    return Array.from({ length: 5 }, (_, i) => ({
      provider: 'mock',
      id: `${slugify(query)}-${Date.now()}-${i}-${this.counter++}`,
      width: 1600,
      height: 1000,
      downloadUrl: `mock://${encodeURIComponent(query)}/${i}`,
      pageUrl: 'https://www.pexels.com/',
      photographer: 'Mock Photographer',
      photographerUrl: 'https://www.pexels.com/',
      alt: query,
    }));
  }
  async download(photo: StockPhoto): Promise<Buffer> {
    const hue = Math.abs([...photo.id].reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},60%,45%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},60%,35%)"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#g)"/><text x="80" y="520" font-family="Arial" font-size="64" fill="#fff" opacity=".85">${photo.alt.replace(/[<>&]/g, '')}</text></svg>`;
    return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  }
}

export class MockGoogle implements GoogleClient {
  async getMetaToken() {
    return 'mock-google-verification-token';
  }
  async verifySite(siteUrl: string) {
    return { id: encodeURIComponent(siteUrl) };
  }
  async addOwner() {}
  async addSearchConsoleProperty() {}
  async submitSitemap() {}
}

export class MockIndexNow implements IndexNowClient {
  async submit() {
    return { status: 202 };
  }
}
