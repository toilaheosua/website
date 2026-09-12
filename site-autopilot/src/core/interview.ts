import type { EntityData } from './types.js';

/**
 * Bộ Câu Hỏi: 30 câu phỏng vấn chủ doanh nghiệp, phủ đủ khía cạnh để khai báo Entity SEO
 * và viết nội dung dựa trên dữ liệu thật thay vì suy đoán. Câu trả lời lưu ở sites.interview,
 * được đưa vào mọi prompt (lập kế hoạch, viết, biên tập, duyệt) như "dữ kiện được phép dùng".
 */

export interface InterviewQuestion {
  id: string;
  group: string;
  text: string;
  hint: string;
}

export interface InterviewData {
  answers: Record<string, string>;
  updated_at: string;
}

export const INTERVIEW_GROUPS = ['Tổng quan', 'Sản phẩm và dịch vụ', 'Giá và chính sách', 'Khách hàng', 'Quy trình phục vụ', 'Con người', 'Bằng chứng và câu chuyện', 'Địa điểm và kênh liên hệ'] as const;

export const INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  { id: 'q1', group: 'Tổng quan', text: 'Tên đầy đủ (tên pháp lý trên giấy phép) và các tên gọi khác mà khách hay dùng?', hint: 'Ví dụ: HỘ KINH DOANH HỦ TIẾU NAM VANG ÔNG GIÁO; khách gọi "Hủ tiếu Ông Giáo", "quán Ông Giáo"' },
  { id: 'q2', group: 'Tổng quan', text: 'Bắt đầu hoạt động năm nào, ai sáng lập, vì sao bắt đầu?', hint: 'Chỉ ghi điều có thật. Không nhớ chính xác thì ghi khoảng thời gian.' },
  { id: 'q3', group: 'Tổng quan', text: 'Mô tả doanh nghiệp trong 2 đến 3 câu: làm gì, cho ai, ở đâu?', hint: 'Câu này dùng cho mô tả ngắn trong schema và footer.' },
  { id: 'q4', group: 'Tổng quan', text: 'Điều gì khiến khách chọn bạn thay vì nơi khác? Nêu cụ thể, có thể kiểm chứng.', hint: 'Ví dụ: hầm xương 8 tiếng, nấu tại chỗ, không dùng bột ngọt, giao trong 30 phút nội thành.' },
  { id: 'q5', group: 'Sản phẩm và dịch vụ', text: 'Liệt kê sản phẩm hoặc dịch vụ chính. Cái nào bán chạy nhất?', hint: 'Mỗi dòng một sản phẩm/dịch vụ, ghi kèm "bán chạy" nếu có.' },
  { id: 'q6', group: 'Sản phẩm và dịch vụ', text: 'Với từng sản phẩm/dịch vụ chính: gồm những gì và không gồm gì?', hint: 'Ví dụ: Tô đặc biệt gồm tôm, thịt bằm, trứng cút, gan; không gồm lòng.' },
  { id: 'q7', group: 'Sản phẩm và dịch vụ', text: 'Nguyên liệu, vật tư hoặc công nghệ chính dùng là gì, nguồn gốc ở đâu?', hint: 'Ví dụ: sợi hủ tiếu lấy từ lò X ở Sa Đéc mỗi sáng; tôm mua tại chợ Y.' },
  { id: 'q8', group: 'Sản phẩm và dịch vụ', text: 'Cách làm hoặc quy trình tạo ra sản phẩm/dịch vụ có gì đặc biệt?', hint: 'Các bước, thời gian, bí quyết có thể công bố.' },
  { id: 'q9', group: 'Sản phẩm và dịch vụ', text: 'Điều gì bạn KHÔNG làm hoặc từ chối? Khi nào khách không nên mua ở bạn?', hint: 'Nội dung thật thà kiểu này làm bài viết đáng tin hơn.' },
  { id: 'q10', group: 'Giá và chính sách', text: 'Giá hoặc khoảng giá từng sản phẩm/dịch vụ? Có được công bố trên website không?', hint: 'Ghi rõ "không công bố" nếu không muốn AI nhắc đến giá.' },
  { id: 'q11', group: 'Giá và chính sách', text: 'Yếu tố nào làm giá thay đổi?', hint: 'Ví dụ: size, thêm topping, giao xa, số lượng, thời điểm.' },
  { id: 'q12', group: 'Giá và chính sách', text: 'Chính sách bảo hành, đổi trả, hoàn tiền (nếu có)?', hint: 'Không có thì ghi "không áp dụng".' },
  { id: 'q13', group: 'Giá và chính sách', text: 'Cách thanh toán, đặt trước, đặt cọc?', hint: 'Tiền mặt, chuyển khoản, ví điện tử; đặt bàn hay đặt hàng trước cần gì.' },
  { id: 'q14', group: 'Khách hàng', text: 'Khách hàng điển hình của bạn là ai?', hint: 'Độ tuổi, nghề, hoàn cảnh, họ đến vào lúc nào, vì lý do gì.' },
  { id: 'q15', group: 'Khách hàng', text: 'Ba câu khách hay hỏi nhất trước khi mua và bạn trả lời thế nào?', hint: 'Dùng cho FAQ thật trên website.' },
  { id: 'q16', group: 'Khách hàng', text: 'Khách thường hiểu lầm điều gì về sản phẩm/dịch vụ hoặc ngành của bạn?', hint: 'Ví dụ: tưởng hủ tiếu Nam Vang và hủ tiếu Mỹ Tho giống nhau.' },
  { id: 'q17', group: 'Khách hàng', text: 'Khách thường khen gì và chê gì? Bạn đã thay đổi gì từ lời chê?', hint: 'Lấy từ đánh giá Google, Facebook, lời nói trực tiếp.' },
  { id: 'q18', group: 'Quy trình phục vụ', text: 'Từ lúc khách liên hệ đến lúc nhận sản phẩm/dịch vụ diễn ra thế nào, mất bao lâu?', hint: 'Các bước, ai phụ trách, thời gian mỗi bước.' },
  { id: 'q19', group: 'Quy trình phục vụ', text: 'Giờ mở cửa từng ngày, ngày nghỉ, thời gian phản hồi tin nhắn/cuộc gọi?', hint: 'Ví dụ: Thứ 2 đến Chủ nhật 5h30 đến 12h; nghỉ mùng 1 đến mùng 3 Tết.' },
  { id: 'q20', group: 'Quy trình phục vụ', text: 'Khu vực phục vụ hoặc giao hàng, phí giao, thời gian giao?', hint: 'Ví dụ: giao miễn phí trong 3 km, ngoài ra 15.000đ, chỉ giao buổi sáng.' },
  { id: 'q21', group: 'Con người', text: 'Ai trực tiếp làm ra sản phẩm/dịch vụ? Kinh nghiệm bao nhiêu năm, chứng chỉ gì (chỉ ghi có thật)?', hint: 'Ví dụ: cô Tư đứng bếp 20 năm, học nghề từ mẹ ở Sài Gòn.' },
  { id: 'q22', group: 'Con người', text: 'Ai là người đại diện phát ngôn hoặc phụ trách nội dung website? Tên, chức danh, vài dòng giới thiệu.', hint: 'Dùng cho phần tác giả bài viết (E-E-A-T). Có thể để trống nếu chưa muốn công khai.' },
  { id: 'q23', group: 'Con người', text: 'Đội ngũ có bao nhiêu người, mỗi người phụ trách gì?', hint: 'Không cần tên đầy đủ nếu không muốn công khai.' },
  { id: 'q24', group: 'Bằng chứng và câu chuyện', text: 'Kể một tình huống thực tế đã giải quyết cho khách: bối cảnh, cách làm, kết quả.', hint: 'Dùng làm ví dụ thật trong bài viết thay vì tình huống giả định.' },
  { id: 'q25', group: 'Bằng chứng và câu chuyện', text: 'Giải thưởng, chứng nhận, báo chí nhắc đến, đối tác (chỉ ghi có thật, kèm link nếu có)?', hint: 'Không có thì ghi "không có". AI sẽ không được bịa thêm.' },
  { id: 'q26', group: 'Bằng chứng và câu chuyện', text: 'Con số có thể công bố: số năm hoạt động, số khách mỗi ngày, số sản phẩm đã bán, số chi nhánh?', hint: 'Chỉ ghi số bạn chắc chắn và cho phép hiển thị.' },
  { id: 'q27', group: 'Bằng chứng và câu chuyện', text: 'Câu chuyện hoặc chi tiết đặc biệt về không gian, truyền thống, kỷ niệm đáng nhớ?', hint: 'Ví dụ: cái nồi nước lèo dùng từ 1998, bảng hiệu do ông ngoại viết tay.' },
  { id: 'q28', group: 'Địa điểm và kênh liên hệ', text: 'Địa chỉ đầy đủ, chỉ dẫn đường đi, chỗ để xe, điểm mốc gần đó?', hint: 'Ví dụ: 89 Văn Cao, Phan Rang; đối diện trường X; có chỗ để xe máy trước quán.' },
  { id: 'q29', group: 'Địa điểm và kênh liên hệ', text: 'Số điện thoại, Zalo, email và ai là người nhận liên hệ?', hint: 'Ghi đúng số sẽ hiển thị công khai trên website.' },
  { id: 'q30', group: 'Địa điểm và kênh liên hệ', text: 'Các kênh online: Facebook, Google Maps, Zalo OA, TikTok, Instagram, YouTube, sàn TMĐT (dán link). Kênh nào hoạt động nhiều nhất?', hint: 'Dùng cho sameAs trong schema, giúp Google nối các hồ sơ về cùng một thực thể.' },
];

export function emptyInterview(): InterviewData {
  return { answers: {}, updated_at: '' };
}

export function answeredCount(data: InterviewData | null | undefined): number {
  if (!data) return 0;
  return INTERVIEW_QUESTIONS.filter((q) => (data.answers[q.id] ?? '').trim()).length;
}

/** Khối dữ kiện đưa vào prompt: chỉ các câu đã trả lời, giữ nguyên lời chủ doanh nghiệp. */
export function interviewBlock(data: InterviewData | null | undefined, maxChars = 12_000): string {
  if (!data) return '';
  const lines: string[] = [];
  for (const q of INTERVIEW_QUESTIONS) {
    const a = (data.answers[q.id] ?? '').trim();
    if (!a) continue;
    lines.push(`- [${q.group}] ${q.text}\n  Trả lời: ${a.replace(/\s*\n\s*/g, ' / ')}`);
  }
  if (!lines.length) return '';
  const text = lines.join('\n');
  return `DỮ KIỆN DO CHỦ DOANH NGHIỆP CUNG CẤP (nguồn đáng tin nhất, được phép dùng và nên ưu tiên; điều gì không có ở đây và không có trong brief thì không được khẳng định):\n${text.length > maxChars ? text.slice(0, maxChars) + '\n...(cắt bớt)' : text}`;
}

/** Gợi ý Entity do AI rút ra từ câu trả lời; mọi trường là chuỗi hoặc mảng, rỗng = không có. */
export interface EntitySuggestion {
  legalName: string;
  alternateName: string[];
  description: string;
  foundingDate: string;
  founder: string;
  telephone: string;
  email: string;
  streetAddress: string;
  addressLocality: string;
  addressRegion: string;
  openingHours: string[];
  priceRange: string;
  areaServed: string[];
  facebook: string;
  zalo: string;
  youtube: string;
  tiktok: string;
  instagram: string;
  googleMaps: string;
  authorName: string;
  authorJobTitle: string;
  authorBio: string;
}

/**
 * Gộp gợi ý vào Entity: chỉ điền trường đang trống (overwrite = true thì ghi đè trường có gợi ý).
 * Trả về danh sách trường đã thay đổi để hiện cho người dùng.
 */
export function mergeEntitySuggestion(entity: EntityData, s: EntitySuggestion, overwrite = false): { entity: EntityData; changed: string[] } {
  const out: EntityData = structuredClone(entity);
  const changed: string[] = [];
  const setStr = (label: string, get: () => string, set: (v: string) => void, v: string) => {
    const val = (v ?? '').trim();
    if (!val) return;
    if (get().trim() && !overwrite) return;
    if (get().trim() === val) return;
    set(val);
    changed.push(label);
  };
  const setArr = (label: string, get: () => string[], set: (v: string[]) => void, v: string[]) => {
    const val = (v ?? []).map((x) => x.trim()).filter(Boolean);
    if (!val.length) return;
    if (get().length && !overwrite) return;
    set([...new Set(val)]);
    changed.push(label);
  };
  setStr('Tên pháp lý', () => out.legalName, (v) => (out.legalName = v), s.legalName);
  setArr('Tên khác', () => out.alternateName, (v) => (out.alternateName = v), s.alternateName);
  setStr('Mô tả ngắn', () => out.description, (v) => (out.description = v), s.description);
  setStr('Năm thành lập', () => out.foundingDate, (v) => (out.foundingDate = v), s.foundingDate);
  setStr('Người sáng lập', () => out.founder, (v) => (out.founder = v), s.founder);
  setStr('Điện thoại', () => out.telephone, (v) => (out.telephone = v), s.telephone);
  setStr('Email', () => out.email, (v) => (out.email = v), s.email);
  setStr('Địa chỉ', () => out.address.streetAddress, (v) => (out.address.streetAddress = v), s.streetAddress);
  setStr('Quận/Thành phố', () => out.address.addressLocality, (v) => (out.address.addressLocality = v), s.addressLocality);
  setStr('Tỉnh', () => out.address.addressRegion, (v) => (out.address.addressRegion = v), s.addressRegion);
  setArr('Giờ mở cửa', () => out.openingHours, (v) => (out.openingHours = v), s.openingHours);
  setStr('Khoảng giá', () => out.priceRange, (v) => (out.priceRange = v), s.priceRange);
  setArr('Khu vực phục vụ', () => out.areaServed, (v) => (out.areaServed = v), s.areaServed);
  setStr('Facebook', () => out.sameAs.facebook, (v) => (out.sameAs.facebook = v), s.facebook);
  setStr('Zalo', () => out.sameAs.zalo, (v) => (out.sameAs.zalo = v), s.zalo);
  setStr('YouTube', () => out.sameAs.youtube, (v) => (out.sameAs.youtube = v), s.youtube);
  setStr('TikTok', () => out.sameAs.tiktok, (v) => (out.sameAs.tiktok = v), s.tiktok);
  setStr('Instagram', () => out.sameAs.instagram, (v) => (out.sameAs.instagram = v), s.instagram);
  setStr('Google Maps', () => out.sameAs.googleMaps, (v) => (out.sameAs.googleMaps = v), s.googleMaps);
  setStr('Tác giả: tên', () => out.author.name, (v) => (out.author.name = v), s.authorName);
  setStr('Tác giả: chức danh', () => out.author.jobTitle, (v) => (out.author.jobTitle = v), s.authorJobTitle);
  setStr('Tác giả: giới thiệu', () => out.author.bio, (v) => (out.author.bio = v), s.authorBio);
  return { entity: out, changed };
}
