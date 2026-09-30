import { z } from 'zod';

/* ------------------------------------------------------------------ */
/*  Kiểu viết và tùy chọn một lần chạy                                   */
/* ------------------------------------------------------------------ */

export const ContentStyleIdSchema = z.enum(['story', 'expert', 'playbook']);
export type ContentStyleId = z.infer<typeof ContentStyleIdSchema>;
export const ContentStyleChoiceSchema = z.enum(['auto', 'story', 'expert', 'playbook']);
export type ContentStyleChoice = z.infer<typeof ContentStyleChoiceSchema>;

/** Ngôi kể của bài viết */
export const VoiceSchema = z.enum(['toi', 'minh', 'chung_toi', 'trung_tinh']);
export type Voice = z.infer<typeof VoiceSchema>;
export const VOICE_LABEL: Record<Voice, string> = {
  toi: 'Xưng "tôi", người có trải nghiệm thật',
  minh: 'Xưng "mình", gần gũi',
  chung_toi: 'Xưng "chúng tôi", giọng thương hiệu',
  trung_tinh: 'Trung tính, không xưng',
};

/** Từ vựng vùng miền */
export const DialectSchema = z.enum(['nam_nhe', 'bac_nhe', 'nam', 'bac']);
export type Dialect = z.infer<typeof DialectSchema>;
export const DIALECT_LABEL: Record<Dialect, string> = {
  nam_nhe: 'Trung tính, nghiêng miền Nam',
  bac_nhe: 'Trung tính, nghiêng miền Bắc',
  nam: 'Miền Nam rõ',
  bac: 'Miền Bắc rõ',
};

/** Nhà cung cấp model viết bài */
export const LlmProviderSchema = z.enum(['anthropic', 'openrouter', 'deepseek']);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;
export const LLM_PROVIDER_LABEL: Record<LlmProvider, string> = {
  anthropic: 'Claude (Anthropic API)',
  openrouter: 'OpenRouter (nhiều model: GPT, Gemini, DeepSeek, Qwen...)',
  deepseek: 'DeepSeek (platform.deepseek.com: deepseek-chat, deepseek-reasoner)',
};
/** Tên ngắn để hiện trong giao diện và log */
export const LLM_PROVIDER_SHORT: Record<LlmProvider, string> = { anthropic: 'Claude', openrouter: 'OpenRouter', deepseek: 'DeepSeek' };

/** Kiểu bài: web = bài blog từ bài web top Google; roundup = tổng hợp quán theo khu vực từ Google Maps */
export const RunKindSchema = z.enum(['web', 'roundup', 'brand']);
export type RunKind = z.infer<typeof RunKindSchema>;
export const RUN_KIND_LABEL: Record<RunKind, string> = { web: 'Bài blog từ bài web', roundup: 'Tổng hợp quán theo khu vực', brand: 'Giới thiệu thương hiệu từ Google Maps' };

export const RunOptionsSchema = z.object({
  kind: RunKindSchema.default('web'),
  /** Tổng hợp quán: món hoặc loại quán, và khu vực */
  dish: z.string().default(''),
  area: z.string().default(''),
  /** Số quán đưa vào bài */
  placesCount: z.number().int().min(3).max(20).default(8),
  /** Dừng sau khi xếp hạng để bạn chọn quán và ghi chú trước khi viết */
  reviewPlaces: z.boolean().default(false),
  /** Ghi chú của bạn về từng quán, mỗi dòng "Tên quán: ghi chú" */
  placeNotes: z.string().default(''),
  /** Giới thiệu thương hiệu: link Google Maps của địa điểm */
  mapsUrl: z.string().default(''),
  /** Tên thương hiệu muốn dùng trong bài (trống = lấy tên trên Maps) */
  brandName: z.string().default(''),
  /** Thông tin cơ bản do bạn cung cấp: mô tả, năm thành lập, sản phẩm dịch vụ, điểm mạnh, câu chuyện */
  brandInfo: z.string().default(''),
  /** Có nhắc điểm khách chê trong bài giới thiệu không */
  brandIncludeCons: z.boolean().default(false),
  /** default = theo Cài đặt */
  provider: z.enum(['default', 'anthropic', 'openrouter', 'deepseek']).default('default'),
  style: ContentStyleChoiceSchema.default('auto'),
  /** Dừng sau bước bố cục để người dùng duyệt rồi mới viết */
  reviewOutline: z.boolean().default(false),
  voice: VoiceSchema.default('toi'),
  dialect: DialectSchema.default('nam_nhe'),
  /** Người đọc mục tiêu, trống = người đọc phổ thông */
  audience: z.string().default(''),
  /** Yêu cầu thêm của người dùng cho bài này */
  notes: z.string().default(''),
  /** Từ khóa phụ người dùng cấp (trống = tool tự rút) */
  secondaryKeywords: z.array(z.string()).default([]),
  minWords: z.number().int().default(1000),
  maxWords: z.number().int().default(1500),
  /** Viết 100% dạng so sánh: mỗi mục H2 đối chiếu từ hai đối tượng trở lên, có bảng so sánh */
  comparison: z.boolean().default(true),
});
export type RunOptions = z.infer<typeof RunOptionsSchema>;

/* ------------------------------------------------------------------ */
/*  Cài đặt chung (bảng settings)                                        */
/* ------------------------------------------------------------------ */

export const SearchProviderSchema = z.enum(['serpapi', 'google_cse', 'claude']);
export type SearchProviderId = z.infer<typeof SearchProviderSchema>;
export const SEARCH_PROVIDER_LABEL: Record<SearchProviderId, string> = {
  serpapi: 'SerpAPI (top 10 Google thật, có "Mọi người cũng hỏi")',
  google_cse: 'Google Custom Search JSON API (top 10, không có "Mọi người cũng hỏi")',
  claude: 'Claude web search (dự phòng, không cần key riêng)',
};

export const GeneralSettingsSchema = z.object({
  searchProvider: SearchProviderSchema.default('serpapi'),
  googleDomain: z.string().default('google.com.vn'),
  country: z.string().default('vn'),
  language: z.string().default('vi'),
  /** Số bài web cần lấy từ Google (không tính mạng xã hội, video, sàn, domain bị chặn) */
  resultsCount: z.number().int().min(3).max(20).default(10),
  /** Số trang kết quả Google tối đa được lật để gom đủ resultsCount bài web (mỗi trang một lượt tìm) */
  searchMaxPages: z.number().int().min(1).max(5).default(3),
  /** Số nguồn tối thiểu và tối đa dùng để rút ghi chú */
  minSources: z.number().int().min(1).max(20).default(5),
  maxSources: z.number().int().min(1).max(20).default(8),
  /** Khi nguồn tiếng Việt quá ít thì tìm thêm nguồn tiếng Anh */
  englishFallback: z.boolean().default(true),
  blockedDomains: z.array(z.string()).default([]),
  /** Tổng số từ ghi chú rút từ nguồn */
  notesMinWords: z.number().int().default(800),
  notesMaxWords: z.number().int().default(1500),
  /** Độ dài bài viết cuối */
  articleMinWords: z.number().int().default(1000),
  articleMaxWords: z.number().int().default(1500),
  defaultStyle: ContentStyleChoiceSchema.default('auto'),
  defaultVoice: VoiceSchema.default('toi'),
  defaultDialect: DialectSchema.default('nam_nhe'),
  /** 2 đến 4 đoạn văn do chính bạn viết, để Claude học giọng thật; càng giống giọng bạn, điểm AI càng thấp */
  styleSamples: z.string().default(''),
  /** Mặc định cho bài mới: viết 100% dạng so sánh (bảng so sánh ở mọi mục) */
  comparisonMode: z.boolean().default(true),
  /** Số trang top đầu Google được ưu tiên: nhãn nội dung của các trang này bắt buộc có trong bố cục, thứ tự mục bám theo chúng */
  topSitesPriority: z.number().int().min(0).max(5).default(3),
  /** Tổng hợp quán: số đánh giá tối thiểu để một quán được xét */
  roundupMinReviews: z.number().int().min(0).max(500).default(5),
  /** Bán kính (km) quanh tâm khu vực: quán trong bán kính này được coi là thuộc khu vực dù địa chỉ không ghi tên khu vực; 0 = chỉ xét theo địa chỉ */
  roundupRadiusKm: z.number().min(0).max(100).default(15),
  /** Hằng số m của trung bình Bayes: số đánh giá "ảo" kéo về mức trung bình, càng lớn càng ưu tiên quán nhiều đánh giá */
  roundupBayesM: z.number().int().min(1).max(500).default(30),
  /** Sàn sao: quán dưới mức này bị loại dù rất nhiều đánh giá; cũng là mốc trừ trong điểm xếp hạng = (sao Bayes − sàn) × log10(1 + số đánh giá) */
  roundupMinRating: z.number().min(0).max(5).default(3.5),
  /** Số quán ứng viên cần gom từ Google Maps (mỗi trang 20 quán, một lượt tìm) */
  roundupCandidates: z.number().int().min(20).max(60).default(40),
  /** Số quán mặc định đưa vào bài */
  roundupPlaces: z.number().int().min(3).max(20).default(8),
  roundupMinWords: z.number().int().default(1200),
  roundupMaxWords: z.number().int().default(1800),
  /** Tải ảnh đại diện của quán từ Google Maps về thư mục xuất */
  roundupPhotos: z.boolean().default(true),
  /** Số đánh giá lấy cho mỗi quán được chọn: 8 mỗi lượt SerpAPI (8 = 1 lượt, 16 = 2 lượt, 24 = 3 lượt) */
  roundupReviewsPerPlace: z.number().int().min(8).max(24).default(16),
  /** Giới thiệu thương hiệu: số ảnh tải từ Google Maps, số đánh giá đọc, độ dài bài */
  brandPhotos: z.number().int().min(0).max(12).default(6),
  brandReviews: z.number().int().min(8).max(24).default(16),
  brandMinWords: z.number().int().default(800),
  brandMaxWords: z.number().int().default(1300),
  /** URL thư mục bạn sẽ tải ảnh lên (ví dụ https://site.vn/wp-content/uploads/2026/09); có thì file xuất trỏ thẳng ảnh tới đó */
  photoBaseUrl: z.string().default(''),
  /** Điểm AI tối đa (0..1) của Originality.ai để coi là đạt */
  aiScoreMax: z.number().min(0).max(1).default(0.2),
  /** Tỷ lệ trùng tối đa (0..1) so với nguồn đã thu thập */
  dupRatioMax: z.number().min(0).max(1).default(0.1),
  /** Độ dài chuỗi từ liên tiếp không được trùng nguyên văn */
  shingleSize: z.number().int().min(4).max(20).default(8),
  /** Số vòng tự sửa tối đa khi chưa đạt */
  maxFixRounds: z.number().int().min(0).max(6).default(3),
  /** Cách lấy điểm AI: auto = API nếu có key, không thì chấm tay; api; manual = bạn dán bài lên web Originality.ai và nhập điểm; off = không quét */
  detectorMode: z.enum(['auto', 'api', 'manual', 'off']).default('auto'),
  /** Số lần chấm tay tối đa cho một bài (mỗi lần tốn credit trên web Originality.ai) */
  maxManualScans: z.number().int().min(1).max(6).default(2),
  /** Model AI detect của Originality.ai: multilang cho tiếng Việt */
  originalityModel: z.string().default('multilang'),
  /** Có quét trùng lặp toàn web bằng Originality.ai không (tốn credit) */
  webPlagiarismCheck: z.boolean().default(false),
  /** Bỏ qua quét AI (khi chưa có key), chỉ chạy kiểm tra nội bộ */
  skipAiDetection: z.boolean().default(false),
  writerModel: z.string().default('claude-opus-5'),
  researchModel: z.string().default('claude-sonnet-5'),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
  /** Nhà cung cấp mặc định cho bài mới; từng bài chọn lại được lúc tạo */
  llmProvider: LlmProviderSchema.default('anthropic'),
  /** Model trên OpenRouter, dạng "hang/ten-model", xem https://openrouter.ai/models */
  openrouterWriterModel: z.string().default('openai/gpt-5.6-terra'),
  openrouterResearchModel: z.string().default('google/gemini-3.8-flash'),
  /** Nhiệt độ sinh cho model OpenRouter (Claude bỏ qua vì đang bật suy nghĩ thích ứng); cao hơn = văn ít "an toàn" hơn */
  openrouterTemperature: z.number().min(0).max(2).default(1),
  /** Mức suy nghĩ cho model suy luận trên OpenRouter (DeepSeek, Gemini thinking...): thấp để phần suy nghĩ không chiếm hết trần token */
  openrouterReasoning: z.enum(['off', 'low', 'medium', 'high']).default('low'),
  /** Model trên DeepSeek (platform.deepseek.com): deepseek-chat (không suy luận, trần 8K token ra) hoặc deepseek-reasoner (suy luận, trần 64K) */
  deepseekWriterModel: z.string().default('deepseek-chat'),
  deepseekResearchModel: z.string().default('deepseek-chat'),
  /** Nhiệt độ sinh cho DeepSeek; tài liệu DeepSeek khuyên 1,3 cho hội thoại, 1,5 cho viết sáng tạo; deepseek-reasoner bỏ qua */
  deepseekTemperature: z.number().min(0).max(2).default(1.3),
  /** OpenRouter hoặc DeepSeek lỗi tạm thời 3 lần liên tiếp (rơi kết nối, quá tải) thì chạy tiếp bằng Claude nếu có key */
  llmFallback: z.boolean().default(true),
});
export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;

/* ------------------------------------------------------------------ */
/*  Dữ liệu từng bước                                                    */
/* ------------------------------------------------------------------ */

export interface SerpResult {
  position: number;
  title: string;
  link: string;
  snippet: string;
}

export interface SerpData {
  provider: SearchProviderId | 'mock';
  keyword: string;
  language: string;
  /** Bài web dùng được, đã đánh số lại 1..N sau khi bỏ mạng xã hội, video, sàn */
  organic: SerpResult[];
  peopleAlsoAsk: string[];
  relatedSearches: string[];
  fetchedAt: string;
  /** Kết quả Google bị bỏ qua (mạng xã hội, video, sàn, domain chặn) kèm vị trí gốc trên Google */
  skipped?: { googlePosition: number; link: string; title: string; reason: string }[];
  /** Số trang Google đã lật để gom đủ bài web */
  pagesFetched?: number;
}

export type SourceStatus = 'pending' | 'ok' | 'failed' | 'blocked' | 'short' | 'skipped' | 'duplicate';

export interface SourceInfo {
  id: number;
  position: number;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  language: string;
  status: SourceStatus;
  httpStatus: number | null;
  wordCount: number;
  error: string | null;
}

/** Ghi chú rút từ nguồn (bước tổng hợp) */
export interface SourceNotes {
  sourceIndex: number;
  url: string;
  facts: string[];
  angle: string;
  /** Nhãn nội dung trang này có (cách chế biến, nguồn gốc tên gọi, quán ngon...) */
  tags: string[];
}

/** Một nhãn nội dung: dữ kiện đã phân loại theo chủ đề con */
export interface NoteTopic {
  /** Nhãn ngắn, thống nhất trong cả ghi chú, ví dụ "cách chế biến" */
  tag: string;
  description: string;
  sourceRefs: number[];
  facts: string[];
  /** Nhãn này có mặt ở các trang top đầu Google */
  inTopSites: boolean;
}

/** Cách các trang top đầu Google trình bày chủ đề: để bố cục tái sử dụng dạng nội dung được Google ưu tiên */
export interface TopSiteProfile {
  sourceIndex: number;
  position: number;
  url: string;
  /** Các phần của trang theo đúng thứ tự xuất hiện */
  structure: string[];
  tags: string[];
  /** Dạng nội dung nổi bật của trang: bảng, danh sách quán, công thức từng bước, so sánh... */
  contentType: string;
}

/** Một so sánh có thể dựng từ ghi chú */
export interface NoteComparison {
  topic: string;
  items: string[];
  criteria: string[];
  sourceRefs: number[];
}

/** Món, sản phẩm, phương án tương tự được nguồn nhắc tới, kèm điểm khác biệt */
export interface SimilarItem {
  name: string;
  differences: string[];
  sourceRefs: number[];
}

export interface ResearchNotes {
  keyword: string;
  searchIntent: 'informational' | 'comparison' | 'howto' | 'transactional' | 'local' | 'mixed';
  intentExplanation: string;
  summary: string;
  perSource: SourceNotes[];
  keyFacts: string[];
  numbersAndNames: string[];
  disagreements: string[];
  commonSubtopics: string[];
  gaps: string[];
  peopleAlsoAsk: string[];
  secondaryKeywords: string[];
  /** Dữ kiện đã phân loại theo nhãn; bố cục dựng từ đây */
  topics: NoteTopic[];
  /** Hồ sơ các trang top đầu Google */
  topSites: TopSiteProfile[];
  /** Các so sánh dựng được từ ghi chú */
  comparisons: NoteComparison[];
  /** Món hoặc phương án tương tự để so sánh */
  similarItems: SimilarItem[];
  /** Chỉ có ở bài giới thiệu thương hiệu */
  brand?: { name: string; info: string; includeCons: boolean; mapsUrl: string; photos: number };
  /** Chỉ có ở bài tổng hợp quán: các quán được chọn theo thứ hạng */
  roundup?: { dish: string; area: string; featured: { rank: number; name: string; address: string; rating: number; reviews: number; price: string; hours: string; phone: string; website: string; userNote: string; role: string; bestFor: string }[] };
  totalWords: number;
}

export interface OutlineSection {
  heading: string;
  level: 2 | 3;
  goal: string;
  points: string[];
  sourceRefs: number[];
  format: 'text' | 'steps' | 'table' | 'checklist' | 'mixed';
  /** Nhãn nội dung mục này viết (lấy từ phân loại trong ghi chú) */
  tag: string;
  /** Chế độ so sánh: các đối tượng được đối chiếu trong mục (rỗng = mục không so sánh) */
  comparisonItems: string[];
  /** Tiêu chí so sánh, thành các hàng của bảng */
  comparisonCriteria: string[];
}

export interface Outline {
  title: string;
  h1: string;
  metaDescription: string;
  style: ContentStyleId;
  styleReason: string;
  searchIntent: string;
  hookIdea: string;
  quickSummary: string[];
  sections: OutlineSection[];
  faq: string[];
  nextSteps: string;
  secondaryKeywords: string[];
  tableCandidates: string[];
  imageIdeas: { position: string; query: string; alt: string }[];
  targetWords: number;
}

export interface ArticleSection {
  heading: string;
  level: 2 | 3;
  body: string;
}

export interface ArticleImage {
  position: string;
  query: string;
  alt: string;
  /** Đường dẫn ảnh đã tải (tương đối trong thư mục xuất), nếu có */
  src?: string;
}

export interface Article {
  title: string;
  metaDescription: string;
  h1: string;
  excerpt: string;
  quickSummary: string[];
  intro: string;
  sections: ArticleSection[];
  faq: { question: string; answer: string }[];
  nextSteps: string;
  images: ArticleImage[];
  targetKeyword: string;
  secondaryKeywords: string[];
  style: ContentStyleId;
}

/* ------------------------------------------------------------------ */
/*  Tổng hợp quán theo khu vực (Google Maps)                             */
/* ------------------------------------------------------------------ */

export interface PlaceReview {
  rating: number;
  date: string;
  text: string;
}

export interface PlaceReviewSummary {
  praised: string[];
  complained: string[];
  /** Món hoặc điểm đặc trưng được nhắc nhiều */
  signature: string[];
  /** Hợp với ai, dịp nào */
  bestFor: string[];
  oneLine: string;
  sampleCount: number;
}

/** Vai riêng của quán trong bài: mỗi quán một vai, rút từ dữ liệu, không hai quán trùng nhau. */
export interface PlaceRole {
  /** Cụm ngắn dưới 10 từ, có số liệu khi được: "lâu năm, đông khách nhất với 2.208 lượt" */
  label: string;
  /** Một câu nêu dữ kiện làm căn cứ */
  reason: string;
  /** Tình huống cụ thể mà quán này là lựa chọn số một: "ăn sáng trước 6 giờ" */
  bestFor: string;
}

export interface PlaceInfo {
  placeId: string;
  dataId: string;
  name: string;
  address: string;
  rating: number;
  reviews: number;
  price: string;
  type: string;
  hours: string;
  /** Giờ mở theo ngày đã gọn: "Hằng ngày 05:00 đến 12:00" hoặc "Thứ hai đến Thứ sáu ...; Thứ bảy, Chủ nhật ..." */
  openingHours: string;
  phone: string;
  openState: string;
  closed: boolean;
  lat: number;
  lng: number;
  website: string;
  description: string;
  thumbnail: string;
  /** Vị trí gốc trên Google Maps (trang * 20 + thứ tự) */
  mapsPosition: number;
  /** Các chi nhánh đã gộp (địa chỉ), khi cùng một thương hiệu */
  branches: string[];
  inArea: boolean;
  matchesDish: boolean;
  /** Điểm xếp hạng (trung bình Bayes của sao theo số đánh giá) */
  score: number;
  /** Thứ hạng giữa các quán đủ điều kiện; 0 = bị loại */
  rank: number;
  featured: boolean;
  excludedReason: string | null;
  /** Ghi chú của người đặt bài về quán này */
  userNote: string;
  /** Ảnh đã tải về, đường dẫn tương đối trong thư mục xuất */
  photoFile: string | null;
  /** Bài giới thiệu thương hiệu: bộ ảnh tải từ Google Maps */
  photoFiles?: string[];
  reviewsFetched: PlaceReview[];
  summary: PlaceReviewSummary | null;
  /** Vai riêng trong bài (thiếu ở bài cũ) */
  role?: PlaceRole | null;
}

export interface PlacesData {
  dish: string;
  area: string;
  query: string;
  center: { lat: number; lng: number } | null;
  collectedAt: string;
  pagesFetched: number;
  candidates: PlaceInfo[];
  minReviews: number;
  bayesM: number;
  /** Trung bình sao của các quán đủ điều kiện, dùng trong công thức */
  meanRating: number;
  /** Sàn sao đã dùng (thiếu ở bài cũ). Điểm xếp hạng = (sao Bayes − sàn) × log10(1 + số đánh giá) */
  minRating?: number;
}

/** Link Google Maps chính thức mở đúng quán */
export function placeMapsUrl(p: Pick<PlaceInfo, 'name' | 'address' | 'placeId'>): string {
  const q = encodeURIComponent(`${p.name} ${p.address}`.trim());
  return p.placeId ? `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=${encodeURIComponent(p.placeId)}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/* ------------------------------------------------------------------ */
/*  Thử nghiệm model: cùng bố cục, nhiều model, so điểm AI               */
/* ------------------------------------------------------------------ */

export interface ExperimentVariant {
  id: string;
  label: string;
  write: { provider: LlmProvider; model: string; temperature: number | null };
  rewrite: { provider: LlmProvider; model: string } | null;
  status: 'pending' | 'running' | 'done' | 'failed';
  error: string | null;
  article: Article | null;
  /** Văn bản thuần để dán lên máy dò */
  text: string;
  words: number;
  qualityMajor: number;
  qualityMinor: number;
  dupRatio: number;
  usd: number;
  calls: number;
  aiScore: number | null;
  flagged: string[];
  scoreSource: 'api' | 'manual' | 'mock' | null;
  scoredAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Experiment {
  createdAt: string;
  finishedAt: string | null;
  status: 'running' | 'done' | 'cancelled';
  note: string;
  variants: ExperimentVariant[];
}

/* ------------------------------------------------------------------ */
/*  Kết quả kiểm tra                                                     */
/* ------------------------------------------------------------------ */

export type IssueSeverity = 'major' | 'minor';

export interface QualityIssue {
  code: string;
  severity: IssueSeverity;
  where: string;
  message: string;
}

export interface DupMatch {
  /** Chuỗi trùng (đã chuẩn hóa) */
  text: string;
  words: number;
  sourceIndex: number;
  sourceUrl: string;
  where: string;
}

export interface DupReport {
  /** Tỷ lệ từ của bài nằm trong chuỗi trùng với nguồn (0..1) */
  ratio: number;
  totalWords: number;
  matchedWords: number;
  longestRun: number;
  matches: DupMatch[];
  /** Trùng với bài đã viết trước đó trong thư viện */
  libraryMatches: { runId: number; keyword: string; ratio: number; longestRun: number }[];
  pass: boolean;
}

export interface AiBlockScore {
  text: string;
  aiScore: number;
  where: string;
}

export const DETECTOR_MODE_LABEL: Record<'auto' | 'api' | 'manual' | 'off', string> = {
  auto: 'Tự chọn: có API key thì quét qua API, không thì chấm tay',
  api: 'Originality.ai API (cần gói Enterprise)',
  manual: 'Chấm tay: tool dừng, bạn dán bài lên web Originality.ai và nhập điểm',
  off: 'Không quét AI, chỉ kiểm tra nội bộ và so trùng',
};

/** Điểm do người dùng nhập từ web Originality.ai cho một bản bài cụ thể */
export interface ManualScore {
  /** Bản bài được chấm: kind:version */
  articleKey: string;
  aiScore: number;
  flagged: string[];
  raw: string;
  enteredAt: string;
  /** Có khi người dùng tải lên file .docx xuất từ Originality.ai */
  report?: { fileName: string; runs: number; words: number; flaggedWords: number; estimatedAi: number; scoreTyped: boolean };
}

/** Trạng thái tạm khi bước kiểm tra dừng chờ điểm chấm tay */
export interface PendingScore {
  articleKey: string;
  round: number;
  text: string;
  words: number;
  quality: QualityIssue[];
  qualityPass: boolean;
  dup: DupReport;
  review: AiReview | null;
  createdAt: string;
}

export interface AiDetectReport {
  provider: 'originality' | 'manual' | 'mock' | 'none';
  aiScore: number;
  originalScore: number;
  blocks: AiBlockScore[];
  creditsUsed: number | null;
  creditsRemaining: number | null;
  scanId: string | null;
  publicLink: string | null;
  pass: boolean;
  skipped: boolean;
  error: string | null;
  plagiarism?: { score: number; sources: { url: string; percent: number }[]; pass: boolean } | null;
}

export interface AiReview {
  pass: boolean;
  summary: string;
  issues: { severity: IssueSeverity; where: string; problem: string; fix: string }[];
}

export interface CheckRound {
  round: number;
  checkedAt: string;
  quality: QualityIssue[];
  qualityPass: boolean;
  dup: DupReport;
  ai: AiDetectReport;
  review: AiReview | null;
  pass: boolean;
  /** Việc cần sửa, gộp từ ba nguồn kiểm tra */
  feedback: string[];
}

/* ------------------------------------------------------------------ */
/*  Trạng thái                                                          */
/* ------------------------------------------------------------------ */

export type RunStatus = 'queued' | 'running' | 'waiting_places' | 'waiting_outline' | 'waiting_ai_score' | 'done' | 'needs_review' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'waiting' | 'done' | 'failed' | 'skipped';

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'Trong hàng đợi',
  running: 'Đang chạy',
  waiting_places: 'Chờ duyệt danh sách quán',
  waiting_outline: 'Chờ duyệt bố cục',
  waiting_ai_score: 'Chờ điểm AI',
  done: 'Đạt',
  needs_review: 'Chưa đạt',
  failed: 'Lỗi',
  cancelled: 'Đã hủy',
};

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number; usd: number }>;
  searchCalls: number;
  detectorCredits: number;
}

export const emptyUsage = (): UsageTotals => ({ calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, byModel: {}, searchCalls: 0, detectorCredits: 0 });
