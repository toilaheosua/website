import type { PageContent, SiteBrief, SitePlan, EntityData, WafSettings } from '../core/types.js';
import type { SecretKeyName } from '../config.js';

/* ------------------------------------------------------------------ */
/*  Cloudflare                                                          */
/* ------------------------------------------------------------------ */

export interface CfZone {
  id: string;
  name: string;
  status: string;
  name_servers: string[];
  original_name_servers?: string[];
}

export interface CfDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
}

export interface CfRule {
  id?: string;
  action: string;
  expression: string;
  description: string;
  enabled: boolean;
  action_parameters?: Record<string, unknown>;
  ratelimit?: Record<string, unknown>;
}

export interface CloudflareClient {
  verifyToken(): Promise<{ ok: boolean; message: string }>;
  findZone(name: string): Promise<CfZone | null>;
  createZone(name: string): Promise<CfZone>;
  getZone(zoneId: string): Promise<CfZone>;
  triggerActivationCheck(zoneId: string): Promise<void>;
  deleteZone(zoneId: string): Promise<void>;
  listDnsRecords(zoneId: string): Promise<CfDnsRecord[]>;
  upsertDnsRecord(zoneId: string, rec: { type: 'A' | 'CNAME' | 'TXT'; name: string; content: string; proxied: boolean; ttl?: number }): Promise<CfDnsRecord>;
  deleteDnsRecord(zoneId: string, recordId: string): Promise<void>;
  setZoneSetting(zoneId: string, setting: string, value: unknown): Promise<void>;
  getZoneSetting(zoneId: string, setting: string): Promise<unknown>;
  setBotFightMode(zoneId: string, enabled: boolean): Promise<void>;
  /** Thay toàn bộ rule của phase (entrypoint ruleset). Trả về id ruleset. */
  replacePhaseRules(zoneId: string, phase: 'http_request_firewall_custom' | 'http_ratelimit', rules: CfRule[]): Promise<{ rulesetId: string; rules: CfRule[] }>;
  getPhaseRules(zoneId: string, phase: 'http_request_firewall_custom' | 'http_ratelimit'): Promise<{ rulesetId: string | null; rules: CfRule[] }>;
  /** Xóa toàn bộ bộ đệm Cloudflare của zone, gọi sau mỗi lần deploy. */
  purgeCache(zoneId: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  aaPanel + SSH                                                       */
/* ------------------------------------------------------------------ */

export interface PanelSite {
  id: number;
  name: string;
  path: string;
  status: string;
  ps: string;
}

export interface AapanelClient {
  ping(): Promise<{ ok: boolean; message: string }>;
  findSite(domain: string): Promise<PanelSite | null>;
  addSite(input: { domain: string; extraDomains: string[]; path: string; phpVersion: string; remark: string }): Promise<PanelSite>;
  deleteSite(site: PanelSite): Promise<void>;
  phpVersions(): Promise<{ version: string; name: string }[]>;
}

export interface SshClient {
  exec(command: string, opts?: { timeoutMs?: number }): Promise<{ code: number; stdout: string; stderr: string }>;
  /** Tải một thư mục cục bộ lên thư mục từ xa (ghi đè). */
  uploadDirectory(localDir: string, remoteDir: string, opts?: { owner?: string }): Promise<{ files: number; bytes: number }>;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Sinh nội dung (Claude)                                              */
/* ------------------------------------------------------------------ */

export interface InternalLink {
  /** Đường dẫn tuyệt đối trong site, ví dụ /dich-vu/#sua-may-lanh */
  path: string;
  label: string;
}

export interface ContentGenerator {
  generatePlan(input: { brief: SiteBrief; entity: EntityData; domain: string; contentStyle?: 'story' | 'expert' | 'playbook' }): Promise<SitePlan>;
  generatePage(input: { brief: SiteBrief; entity: EntityData; plan: SitePlan; domain: string; kind: PageContent['kind']; post?: SitePlan['posts'][number]; existingTitles?: string[]; internalLinks?: InternalLink[] }): Promise<PageContent>;
  /** Lượt biên tập: trả về bản đã sửa. feedback = lỗi do cổng kiểm duyệt chỉ ra, bắt buộc sửa. */
  editPage(input: { brief: SiteBrief; entity?: EntityData; domain?: string; plan: SitePlan; page: PageContent; internalLinks?: InternalLink[]; feedback?: string[] }): Promise<PageContent>;
  /** AI duyệt chất lượng: rõ ràng, trùng ý, trả lời đúng nhu cầu, có dữ kiện ngoài brief không. */
  reviewPage(input: { brief: SiteBrief; entity: EntityData; plan: SitePlan; page: PageContent }): Promise<{ pass: boolean; summary: string; issues: { severity: 'major' | 'minor'; where: string; problem: string; fix: string }[] }>;
  suggestPostTopics(input: { brief: SiteBrief; plan: SitePlan; existingTitles: string[]; count: number }): Promise<SitePlan['posts']>;
  usage(): { inputTokens: number; outputTokens: number; calls: number };
  /** Kiểm tra key và model, không tốn token. */
  verify(): Promise<{ ok: boolean; message: string }>;
}

/* ------------------------------------------------------------------ */
/*  Ảnh                                                                 */
/* ------------------------------------------------------------------ */

export interface StockPhoto {
  provider: string;
  id: string;
  width: number;
  height: number;
  downloadUrl: string;
  pageUrl: string;
  photographer: string;
  photographerUrl: string;
  alt: string;
}

export interface ImageProvider {
  search(query: string, opts: { perPage?: number; orientation?: 'landscape' | 'portrait' | 'square'; locale?: string }): Promise<StockPhoto[]>;
  download(photo: StockPhoto): Promise<Buffer>;
}

/* ------------------------------------------------------------------ */
/*  Google Search Console + IndexNow                                    */
/* ------------------------------------------------------------------ */

export interface GoogleClient {
  getMetaToken(siteUrl: string): Promise<string>;
  verifySite(siteUrl: string, owners?: string[]): Promise<{ id: string }>;
  addOwner(resourceId: string, email: string): Promise<void>;
  addSearchConsoleProperty(siteUrl: string): Promise<void>;
  submitSitemap(siteUrl: string, sitemapUrl: string): Promise<void>;
}

export interface IndexNowClient {
  submit(host: string, key: string, urls: string[]): Promise<{ status: number }>;
}

export interface PlacePhoto {
  /** places/xxx/photos/yyy */
  name: string;
  widthPx: number;
  heightPx: number;
  /** Tên người đăng: bằng tên doanh nghiệp nghĩa là ảnh của chủ */
  authorName: string;
  authorUri: string;
}

export interface PlacesClient {
  /** Chuỗi đầu vào: Place ID, link Google Maps hoặc share.google, hoặc tên + địa chỉ */
  resolvePlace(input: string): Promise<{ id: string; displayName: string; address: string }>;
  listPhotos(placeId: string): Promise<PlacePhoto[]>;
  downloadPhoto(name: string, maxWidthPx?: number): Promise<Buffer>;
}

export interface Notifier {
  send(message: string): Promise<void>;
}

/* ------------------------------------------------------------------ */

export interface Services {
  cloudflare: CloudflareClient;
  panelFor: (server: ServerConn) => AapanelClient;
  sshFor: (server: ServerConn) => Promise<SshClient>;
  content: ContentGenerator;
  images: ImageProvider;
  /** null khi chưa cấu hình Google; đọc lại mỗi lần truy cập nên đổi khóa trên dashboard có hiệu lực ngay */
  readonly google: GoogleClient | null;
  indexnow: IndexNowClient;
  readonly notifier: Notifier;
  /** Google Places: nhập ảnh do chính doanh nghiệp đăng trên Google Maps; null khi chưa có Maps API key */
  readonly places: PlacesClient | null;
  wafSettings: () => WafSettings;
  /** Kho khóa bí mật nhập trên dashboard */
  secrets: SecretStoreLike;
  /** Khóa và cấu hình dịch vụ hiện hành (dashboard ưu tiên hơn .env) */
  integrations: () => IntegrationsLike;
}

export interface SecretStoreLike {
  get(name: SecretKeyName): string;
  set(name: SecretKeyName, value: string): void;
  delete(name: SecretKeyName): void;
  info(name: SecretKeyName): { set: boolean; hint: string; updatedAt: string | null; broken: boolean };
}

export interface IntegrationsLike {
  cloudflare: { token: string; accountId: string; source: 'dashboard' | 'env' | 'none' };
  anthropic: { apiKey: string; model: string; editorModel: string; source: 'dashboard' | 'env' | 'none' };
  pexels: { apiKey: string; source: 'dashboard' | 'env' | 'none' };
  google: { serviceAccountJson: string; ownerEmail: string; source: 'dashboard' | 'env' | 'none' };
  googleMaps: { apiKey: string; source: 'dashboard' | 'env' | 'none' };
  telegram: { botToken: string; chatId: string; source: 'dashboard' | 'env' | 'none' };
}

export interface ServerConn {
  id: number;
  name: string;
  ip: string;
  panel_url: string;
  panel_api_key: string;
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
  ssh_key_path: string;
  ssh_password: string;
  web_root: string;
  php_version: string;
}
