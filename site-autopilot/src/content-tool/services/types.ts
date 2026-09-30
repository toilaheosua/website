import type { SecretStore } from '../core/secrets.js';
import type { AiDetectReport, AiReview, Article, GeneralSettings, LlmProvider, Outline, PlaceReview, PlaceReviewSummary, PlaceRole, ResearchNotes, RunOptions, SearchProviderId, SerpData, UsageTotals } from '../core/types.js';

/* ------------------------------------------------------------------ */
/*  Google Maps: danh sách quán, đánh giá, ảnh                            */
/* ------------------------------------------------------------------ */

export interface RawPlace {
  position: number;
  title: string;
  placeId: string;
  dataId: string;
  rating: number;
  reviews: number;
  price: string;
  type: string;
  types: string[];
  address: string;
  openState: string;
  hours: string;
  /** Giờ mở theo ngày, khóa là tên ngày Google trả về ("thứ hai"...), giá trị như "05:00–12:00" */
  operatingHours: Record<string, string>;
  phone: string;
  website: string;
  description: string;
  thumbnail: string;
  lat: number;
  lng: number;
}

export interface MapsProvider {
  readonly id: 'serpapi' | 'mock';
  /** Tọa độ tâm khu vực, để Google Maps trả kết quả đúng vùng */
  geocode(area: string): Promise<{ lat: number; lng: number } | null>;
  /** Một trang 20 quán; page từ 0 */
  searchPlaces(query: string, o: { page: number; center: { lat: number; lng: number } | null; language: string }): Promise<RawPlace[]>;
  /** Đánh giá của một quán, tối đa 20 */
  reviews(dataId: string, o: { language: string; count: number; placeId?: string }): Promise<PlaceReview[]>;
  /** Tải ảnh; null khi không tải được */
  downloadPhoto(url: string): Promise<{ data: Buffer; contentType: string } | null>;
  /** Link rút gọn maps.app.goo.gl thành link đầy đủ (không phải link rút gọn thì trả nguyên) */
  resolveUrl(url: string): Promise<string>;
  /** Tìm đúng một địa điểm theo place_id, data_id, hoặc tên kèm tọa độ */
  lookupPlace(ref: { placeId?: string; dataId?: string; name?: string; lat?: number | null; lng?: number | null }, o: { language: string }): Promise<RawPlace | null>;
  /** URL ảnh của địa điểm (engine google_maps_photos), tối đa count */
  photos(dataId: string, o: { count: number; language: string }): Promise<string[]>;
}

export interface PlaceForClassify {
  index: number;
  name: string;
  type: string;
  types: string[];
  address: string;
  description: string;
}
/** Dữ kiện của một quán được chọn, để model gán vai riêng trong bài. */
export interface PlaceForRole {
  index: number;
  name: string;
  rating: number;
  reviews: number;
  price: string;
  openingHours: string;
  type: string;
  summary: PlaceReviewSummary | null;
  userNote: string;
}

export interface PlaceClassification {
  index: number;
  matchesDish: boolean;
  inArea: boolean;
  /** Khóa gộp chi nhánh cùng thương hiệu (tên chuẩn hóa), rỗng nếu độc lập */
  groupKey: string;
}

/* ------------------------------------------------------------------ */
/*  Tìm kiếm Google                                                     */
/* ------------------------------------------------------------------ */

export interface SearchProvider {
  readonly id: SearchProviderId | 'mock';
  /** page: trang kết quả Google (0 = trang đầu, mỗi trang 10 kết quả); trang sau chỉ có organic, không có "Mọi người cũng hỏi". */
  search(keyword: string, opts: { language: 'vi' | 'en'; count: number; page?: number }): Promise<SerpData>;
  /** Kiểm tra key, tốn một lượt tìm rất nhỏ hoặc không tốn. */
  verify(): Promise<{ ok: boolean; message: string }>;
}

/* ------------------------------------------------------------------ */
/*  Tải và trích nội dung trang                                          */
/* ------------------------------------------------------------------ */

export interface FetchedPage {
  url: string;
  finalUrl: string;
  httpStatus: number;
  title: string;
  /** Nội dung chính dạng văn bản thuần, đã bỏ menu, quảng cáo */
  text: string;
  wordCount: number;
  /** Đoán ngôn ngữ theo tỷ lệ ký tự có dấu: vi | en | other */
  language: string;
}

export interface PageFetcher {
  fetch(url: string, opts?: { maxChars?: number; timeoutMs?: number }): Promise<FetchedPage>;
}

/* ------------------------------------------------------------------ */
/*  Claude: rút ghi chú, bố cục, viết, biên tập, sửa, duyệt               */
/* ------------------------------------------------------------------ */

export interface SourceForLlm {
  index: number;
  url: string;
  title: string;
  language: string;
  text: string;
  /** 1..N khi trang thuộc nhóm top đầu Google được ưu tiên; không có = nguồn thường */
  topRank?: number;
}

export interface LlmSpec {
  provider: LlmProvider;
  writerModel: string;
  /** Không có thì dùng model đọc nguồn trong Cài đặt của nhà cung cấp đó */
  researchModel?: string;
  /** Chỉ OpenRouter dùng; Claude bỏ qua vì đang bật suy nghĩ thích ứng */
  temperature?: number;
}

export interface LlmRunContext {
  keyword: string;
  options: RunOptions;
  settings: GeneralSettings;
}

export interface ContentLlm {
  readonly provider: LlmProvider | 'mock';
  extractNotes(input: LlmRunContext & { sources: SourceForLlm[]; serp: SerpData }): Promise<ResearchNotes>;
  buildOutline(input: LlmRunContext & { notes: ResearchNotes; serp: SerpData }): Promise<Outline>;
  writeArticle(input: LlmRunContext & { notes: ResearchNotes; outline: Outline }): Promise<Article>;
  /** Lượt biên tập: sửa theo checklist chống dấu vết AI và theo phản hồi của cổng kiểm duyệt. */
  editArticle(input: LlmRunContext & { notes: ResearchNotes; outline: Outline; article: Article; feedback: string[] }): Promise<Article>;
  /** Vòng sửa có mục tiêu: chỉ viết lại các đoạn bị đánh dấu, giữ phần còn lại. */
  fixArticle(input: LlmRunContext & { notes: ResearchNotes; outline: Outline; article: Article; feedback: string[]; flaggedTexts: string[]; round: number }): Promise<Article>;
  reviewArticle(input: LlmRunContext & { notes: ResearchNotes; outline: Outline; article: Article }): Promise<AiReview>;
  translateKeyword(keyword: string): Promise<string>;
  /** Tổng hợp quán: lọc quán đúng món, đúng khu vực, gộp chi nhánh. */
  classifyPlaces(input: { dish: string; area: string; places: PlaceForClassify[] }): Promise<PlaceClassification[]>;
  /** Tổng hợp quán: rút ý khen, chê, món đặc trưng từ đánh giá của từng quán (diễn đạt lại, không trích nguyên văn). */
  summarizeReviews(input: { dish: string; area: string; places: { index: number; name: string; reviews: PlaceReview[] }[] }): Promise<{ index: number; summary: PlaceReviewSummary }[]>;
  /** Tổng hợp quán: gán mỗi quán một vai riêng trong bài (không trùng), rút từ dữ liệu; kết quả rỗng thì tool gán bằng quy tắc. */
  assignPlaceRoles(input: { dish: string; area: string; places: PlaceForRole[] }): Promise<{ index: number; role: PlaceRole }[]>;
  usage(): UsageTotals;
  /** Kiểm tra key và model, gần như không tốn token. */
  verify(): Promise<{ ok: boolean; message: string }>;
}

/* ------------------------------------------------------------------ */
/*  Dò nội dung AI                                                       */
/* ------------------------------------------------------------------ */

export interface AiDetector {
  readonly id: 'originality' | 'manual' | 'mock' | 'none';
  scan(text: string, opts: { title: string; model: string; plagiarism: boolean; aiScoreMax: number; plagiarismMax?: number }): Promise<AiDetectReport>;
  verify(): Promise<{ ok: boolean; message: string }>;
}

/* ------------------------------------------------------------------ */
/*  Gộp                                                                  */
/* ------------------------------------------------------------------ */

export interface IntegrationStatus {
  /** Nhà cung cấp model mặc định trong Cài đặt */
  llmProvider: LlmProvider;
  anthropic: { configured: boolean; source: 'dashboard' | 'env' | 'none'; writerModel: string; researchModel: string };
  openrouter: { configured: boolean; source: 'dashboard' | 'env' | 'none'; writerModel: string; researchModel: string };
  deepseek: { configured: boolean; source: 'dashboard' | 'env' | 'none'; writerModel: string; researchModel: string };
  search: { provider: SearchProviderId; configured: boolean; source: 'dashboard' | 'env' | 'none' };
  originality: { configured: boolean; source: 'dashboard' | 'env' | 'none'; model: string; skipped: boolean; mode: 'api' | 'manual' | 'off' };
}

export interface Services {
  readonly isMock: boolean;
  readonly secrets: SecretStore;
  search(): SearchProvider;
  maps(): MapsProvider;
  fetcher(): PageFetcher;
  /** Không truyền provider = dùng nhà cung cấp mặc định trong Cài đặt. signal: ngắt mọi lượt gọi khi người dùng hủy bài. */
  llm(provider?: LlmProvider, signal?: AbortSignal): ContentLlm;
  /** Model chỉ định (thử nghiệm model): key và các cài đặt khác vẫn lấy từ Cài đặt. */
  llmWith(spec: LlmSpec, signal?: AbortSignal): ContentLlm;
  detector(): AiDetector;
  integrations(): IntegrationStatus;
}
