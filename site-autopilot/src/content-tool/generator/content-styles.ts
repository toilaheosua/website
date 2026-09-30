import type { ContentStyleChoice, ContentStyleId, Dialect, Voice } from '../core/types.js';

/**
 * Ba kiểu viết, kế thừa từ site-autopilot và điều chỉnh cho bài blog viết từ tư liệu thu thập.
 * "auto" = chọn theo ý định tìm kiếm và chủ đề của từ khóa.
 */
export interface ContentStyle {
  id: ContentStyleId;
  name: string;
  description: string;
  bestFor: string;
  guide: string;
}

export const CONTENT_STYLES: Record<ContentStyleId, ContentStyle> = {
  story: {
    id: 'story',
    name: 'Kể chuyện',
    description: 'Cây viết ẩm thực, đời sống địa phương: chi tiết giác quan, quan sát thật, thông tin thực dụng ở cuối.',
    bestFor: 'Món ăn, quán, cà phê, du lịch, làm đẹp, thời trang, sản phẩm thủ công, văn hóa',
    guide: `KIỂU VIẾT: KỂ CHUYỆN
Persona: cây viết ẩm thực và đời sống địa phương, đi thực tế nhiều năm, đang kể cho một người bạn nghe về chủ đề này. Giọng ấm, gần, có chính kiến, không khoa trương.
Cách làm:
- Mở bài bằng một khung cảnh hoặc cảm giác cụ thể gắn với chủ đề, hai đến ba câu, rồi mới nói bài này nói về gì. Không mở bằng định nghĩa.
- Kể nguồn gốc, con người, cách làm dựa trên dữ kiện trong ghi chú. Dữ kiện nào ghi chú không có thì nói về cách nhận biết, tiêu chuẩn, thói quen chung, không bịa tên người, năm tháng, địa chỉ.
- Mô tả bằng giác quan (mùi, vị, màu, âm thanh, độ giòn, nhiệt độ) ít nhất năm lần trong bài, mỗi lần một chi tiết khác nhau.
- Xen quan sát và nhận xét cá nhân có lý do ("tôi thích kiểu... vì..."), có cả điều không thích hoặc lưu ý.
- Thông tin thực dụng đặt ở phần cuối: giá tham khảo dạng khoảng nếu ghi chú có, cách chọn, cách phân biệt, nên thử gì trước.
- Kết bằng một đến hai câu chân thành, không hô khẩu hiệu, không tóm tắt lại bài.`,
  },
  expert: {
    id: 'expert',
    name: 'Chuyên gia giải đáp',
    description: 'Người trong nghề trả lời đúng câu khách hay hỏi, kết luận trước rồi giải thích, có "lời khuyên của người trong nghề".',
    bestFor: 'Dịch vụ, kỹ thuật, sức khỏe, pháp lý, tài chính, giáo dục, tư vấn, câu hỏi "là gì", "có nên", "tại sao"',
    guide: `KIỂU VIẾT: CHUYÊN GIA GIẢI ĐÁP
Persona: người làm trong lĩnh vực này hơn mười năm, gặp đủ tình huống, đang trả lời một người vừa hỏi. Thẳng, chắc, thân thiện, nói cả điều người đọc không muốn nghe.
Cách làm:
- Mỗi H2 xoay quanh một câu hỏi thật, heading viết dạng câu hỏi hoặc mệnh đề có kết luận.
- Ngay dưới heading là câu trả lời ngắn hai đến ba câu, rồi mới đến vì sao, khi nào đúng, khi nào sai, dấu hiệu nhận biết, chi phí thường ở khoảng nào nếu ghi chú có.
- Luôn nêu điều kiện và ngoại lệ: "nếu... thì...", "trừ trường hợp...".
- Có một mục "Lời khuyên của người trong nghề" hai đến ba ý chỉ người làm lâu năm mới để ý.
- FAQ là câu người ta hỏi thật trước khi quyết định, trả lời thẳng, không vòng vo.`,
  },
  playbook: {
    id: 'playbook',
    name: 'Hướng dẫn thực chiến',
    description: 'Cẩm nang từng bước, có checklist, bảng so sánh, sai lầm thường gặp, ví dụ tình huống.',
    bestFor: 'Cách làm, công thức, lắp đặt, mua sắm, so sánh phương án, quy trình, phần mềm, thiết bị',
    guide: `KIỂU VIẾT: HƯỚNG DẪN THỰC CHIẾN
Persona: người hướng dẫn thực hành, đã tự làm và đã hướng dẫn nhiều người khác. Rõ, thực dụng, không màu mè, biết chỗ nào người mới hay hỏng.
Cách làm:
- Mở bài nêu đúng tình huống người đọc đang gặp và kết quả sẽ đạt được sau khi làm theo, ba câu.
- Thân bài là các bước đánh số; mỗi bước có việc cần làm, cách kiểm tra đã đúng chưa, lỗi hay gặp ở bước đó.
- Có một bảng so sánh (markdown, 2 đến 4 cột) khi có từ hai phương án hoặc lựa chọn.
- Có một checklist "Kiểm tra trước khi bắt đầu" hoặc "Kiểm tra trước khi quyết định" năm đến tám mục.
- Có một ví dụ tình huống ngắn ghi rõ là giả định.
- Có mục "Sai lầm thường gặp" ba đến năm ý kèm cách tránh.
- Kết bằng "Việc cần làm ngay" ba gạch đầu dòng cụ thể.`,
  },
};

export const CONTENT_STYLE_CHOICES: { id: ContentStyleChoice; name: string; description: string }[] = [
  { id: 'auto', name: 'Tự chọn theo chủ đề', description: 'Ẩm thực, du lịch, làm đẹp → Kể chuyện; cách làm, so sánh → Thực chiến; câu hỏi, dịch vụ → Chuyên gia.' },
  ...Object.values(CONTENT_STYLES).map((s) => ({ id: s.id, name: s.name, description: s.description })),
];

const STORY_HINTS = ['quán', 'nhà hàng', 'ẩm thực', 'món', 'phở', 'bún', 'hủ tiếu', 'cơm', 'bánh', 'cà phê', 'cafe', 'trà', 'chè', 'bia', 'rượu', 'đặc sản', 'spa', 'làm đẹp', 'nail', 'tóc', 'thời trang', 'thủ công', 'homestay', 'khách sạn', 'du lịch', 'tour', 'điểm đến', 'lễ hội', 'chợ', 'hoa', 'bakery', 'văn hóa', 'làng nghề'];
const PLAYBOOK_HINTS = ['cách', 'hướng dẫn', 'công thức', 'nấu', 'làm', 'tự làm', 'lắp', 'cài', 'setup', 'thi công', 'sửa', 'chọn', 'mua', 'so sánh', 'hay', 'vs', 'nên chọn', 'loại nào', 'kinh nghiệm', 'checklist', 'quy trình', 'thủ tục', 'đăng ký', 'phần mềm', 'thiết bị', 'máy'];

function norm(s: string): string {
  return s.normalize('NFC').toLowerCase();
}

/** Chọn kiểu viết khi người dùng để "auto": theo từ khóa và ý định tìm kiếm. */
export function resolveContentStyle(keyword: string, choice: ContentStyleChoice, searchIntent?: string): ContentStyleId {
  if (choice !== 'auto') return choice;
  const text = norm(keyword);
  if (searchIntent === 'howto' || searchIntent === 'comparison') return 'playbook';
  if (STORY_HINTS.some((h) => text.includes(norm(h)))) return 'story';
  if (PLAYBOOK_HINTS.some((h) => new RegExp(`(^|\\s)${norm(h)}(\\s|$)`).test(text))) return 'playbook';
  return 'expert';
}

export function contentStyleGuide(id: ContentStyleId): string {
  return CONTENT_STYLES[id].guide;
}

/** Hướng dẫn ngôi kể và từ vựng vùng miền cho prompt. */
export function voiceGuide(voice: Voice, dialect: Dialect): string {
  const v: Record<Voice, string> = {
    toi: 'Ngôi kể: xưng "tôi", gọi người đọc là "bạn". Viết như người có kinh nghiệm thực tế với chủ đề, chia sẻ quan sát, thói quen, mẹo của chính mình bằng giọng tự nhiên. Được nói "tôi thường", "tôi để ý", "theo kinh nghiệm của tôi". Không kể một sự kiện cụ thể có thể kiểm chứng (ngày, tên người, địa chỉ, con số) nếu ghi chú không có.',
    minh: 'Ngôi kể: xưng "mình", gọi người đọc là "bạn". Giọng gần gũi, như chia sẻ trên blog cá nhân, có quan sát và mẹo của chính mình. Không kể sự kiện cụ thể có thể kiểm chứng nếu ghi chú không có.',
    chung_toi: 'Ngôi kể: xưng "chúng tôi", gọi người đọc là "bạn" hoặc "anh chị". Giọng thương hiệu có kinh nghiệm, không quảng cáo.',
    trung_tinh: 'Ngôi kể: trung tính, không xưng "tôi" hay "chúng tôi", vẫn gọi người đọc là "bạn" và vẫn đưa nhận xét, đánh giá có lý do.',
  };
  const d: Record<Dialect, string> = {
    nam_nhe: 'Từ vựng: tiếng Việt phổ thông, nghiêng miền Nam một chút (muỗng, ly, chén, tô, dĩa, bắp, thơm, xe hơi; "dữ", "ngon lành", "chút" khi hợp). Không quá đậm chất địa phương để người đọc cả nước đều thấy tự nhiên.',
    bac_nhe: 'Từ vựng: tiếng Việt phổ thông, nghiêng miền Bắc một chút (thìa, cốc, bát, đĩa, ngô, dứa, ô tô). Không quá đậm chất địa phương.',
    nam: 'Từ vựng: miền Nam rõ, dùng tự nhiên các từ muỗng, ly, chén, tô, dĩa, bắp, thơm, mắc/rẻ, "dữ lắm", "hết sảy" khi hợp ngữ cảnh.',
    bac: 'Từ vựng: miền Bắc rõ, dùng tự nhiên thìa, cốc, bát, đĩa, ngô, dứa, ô tô, "chuẩn", "ổn" khi hợp ngữ cảnh.',
  };
  return `${v[voice]}\n${d[dialect]}`;
}
