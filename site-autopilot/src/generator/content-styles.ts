import type { PageContent, SiteBrief } from '../core/types.js';

type PageKind = PageContent['kind'];

/**
 * Ba kiểu viết nội dung. Người dùng chọn trong brief ("auto" = hệ thống chọn theo ngành).
 * Mỗi kiểu có persona, cấu trúc và quy tắc riêng, được nhúng vào system prompt của Claude.
 */
export type ContentStyleId = 'story' | 'expert' | 'playbook';
export type ContentStyleChoice = ContentStyleId | 'auto';

export interface ContentStyle {
  id: ContentStyleId;
  name: string;
  /** Mô tả ngắn cho dashboard */
  description: string;
  /** Ngành phù hợp, hiển thị trong dashboard */
  bestFor: string;
  /** Hướng dẫn chi tiết cho Claude */
  guide: string;
}

export const CONTENT_STYLES: Record<ContentStyleId, ContentStyle> = {
  story: {
    id: 'story',
    name: 'Kể chuyện thương hiệu',
    description: 'Giọng cây viết địa phương, giàu chi tiết giác quan và câu chuyện thật, đọc như bài giới thiệu quán trên tạp chí.',
    bestFor: 'Quán ăn, cà phê, ẩm thực, spa, làm đẹp, thời trang, sản phẩm thủ công, du lịch',
    guide: `KIỂU VIẾT: KỂ CHUYỆN THƯƠNG HIỆU
Persona: một cây viết ẩm thực và đời sống địa phương có 10 năm đi thực tế, viết bài giới thiệu quán, thương hiệu như kể cho bạn thân nghe. Giọng ấm, gần gũi, tự tin nhưng không khoa trương.
Cấu trúc:
- Mở bài bằng một khung cảnh hoặc cảm giác cụ thể (mùi nước lèo sôi lúc 5 giờ sáng, tiếng dao chạm thớt, ánh đèn góc quán), hai đến ba câu, rồi mới nói đây là ai, ở đâu. Với kiểu này, cách mở bằng khung cảnh thay cho quy tắc "mở bằng tình huống của bạn".
- Kể nguồn gốc và con người: ai làm, bắt đầu thế nào, giữ cái gì qua năm tháng. Chỉ dùng chi tiết có trong brief; nếu brief không có, kể về cách làm và tiêu chuẩn thay vì bịa nhân vật, năm tháng.
- Cái riêng: nguyên liệu, công đoạn, bí quyết, cách phục vụ khác người ta ở chỗ nào. Mô tả bằng giác quan (mùi, vị, màu, độ giòn, âm thanh) ít nhất ba lần mỗi trang.
- Trải nghiệm của khách: chỉ kể khi brief hoặc ghi chú có mô tả khách thật; nếu không có, mô tả cách quán phục vụ (bưng ra thế nào, thêm gì miễn phí, gói mang đi ra sao) thay vì tạo ra thói quen khách hàng không có nguồn.
- Thông tin thực dụng đặt gọn ở cuối: giờ mở cửa, giá tham khảo dạng khoảng, chỗ để xe, cách đi, gọi trước thế nào, đúng theo brief.
- Kết bằng lời mời chân thành một đến hai câu, không hô khẩu hiệu.
Cấm: liệt kê ưu điểm kiểu quảng cáo, "hàng đầu", "số 1", "tinh hoa ẩm thực", mở bài bằng định nghĩa món ăn.`,
  },
  expert: {
    id: 'expert',
    name: 'Chuyên gia giải đáp',
    description: 'Người trong nghề trả lời đúng câu hỏi khách hay hỏi, câu trả lời ngắn đứng đầu rồi mới giải thích, hợp cho tìm kiếm Google.',
    bestFor: 'Dịch vụ kỹ thuật, sửa chữa, y tế, pháp lý, tài chính, giáo dục, tư vấn, blog vệ tinh',
    guide: `KIỂU VIẾT: CHUYÊN GIA GIẢI ĐÁP
Persona: người làm nghề hơn 10 năm, đã gặp đủ loại tình huống, đang tư vấn trực tiếp cho một khách vừa gọi điện. Giọng thẳng thắn, chắc chắn, thân thiện, nói điều khách cần nghe kể cả điều khách không thích.
Cấu trúc:
- Mỗi trang và mỗi H2 xoay quanh một câu hỏi thật khách hay hỏi (viết heading dạng câu hỏi hoặc mệnh đề có kết luận, ví dụ "Máy lạnh chảy nước: 4 nguyên nhân và cái nào tự xử lý được").
- Ngay dưới heading là câu trả lời ngắn hai đến ba câu (kết luận trước), rồi mới đến "vì sao", "khi nào đúng, khi nào sai", "dấu hiệu nhận biết", "chi phí thường ở khoảng nào", "nên tự làm hay gọi thợ".
- Luôn nêu điều kiện và ngoại lệ: "nếu... thì...", "trừ trường hợp...".
- Mỗi trang có một mục "Lời khuyên của người trong nghề" với hai đến ba ý chỉ người làm lâu năm mới biết.
- FAQ là những câu khách hỏi thật trước khi quyết định (giá, thời gian, bảo hành, rủi ro), trả lời thẳng.
Cấm: vòng vo trước khi trả lời, dùng thuật ngữ mà không giải thích, hứa hẹn kết quả tuyệt đối.`,
  },
  playbook: {
    id: 'playbook',
    name: 'Hướng dẫn thực chiến',
    description: 'Cẩm nang từng bước có checklist, bảng so sánh, lỗi thường gặp và ví dụ tình huống, để người đọc tự làm hoặc tự kiểm tra.',
    bestFor: 'Thi công, lắp đặt, vận chuyển, bất động sản, phần mềm, thiết bị, hướng dẫn mua sắm, blog hướng dẫn',
    guide: `KIỂU VIẾT: HƯỚNG DẪN THỰC CHIẾN
Persona: kỹ thuật viên trưởng viết cẩm nang cho khách tự hiểu, tự chuẩn bị và tự kiểm tra kết quả. Giọng rõ ràng, thực dụng, không màu mè.
Cấu trúc:
- Mở bài nêu đúng tình huống người đọc đang gặp và kết quả họ sẽ đạt được sau khi đọc, ba câu.
- Thân bài là các bước đánh số; mỗi bước có việc cần làm, cách kiểm tra đã làm đúng chưa, lỗi hay gặp ở bước đó.
- Có ít nhất một bảng so sánh phương án (markdown table, 2 đến 4 cột: phương án, phù hợp với ai, chi phí tham khảo dạng khoảng, lưu ý) khi có từ hai lựa chọn trở lên.
- Có một checklist gạch đầu dòng "Kiểm tra trước khi quyết định" từ năm đến tám mục.
- Có một ví dụ tình huống ngắn viết rõ là giả định: "Giả sử bạn có căn hộ 70 m²..." rồi áp dụng các bước vào tình huống đó.
- Mục "Sai lầm thường gặp" ba đến năm ý, mỗi ý kèm cách tránh.
- Kết bằng "Việc cần làm ngay" ba gạch đầu dòng, cụ thể, làm được trong hôm nay.
Cấm: bước chung chung kiểu "liên hệ đơn vị uy tín", số liệu chính xác không có trong brief (dùng khoảng), đoạn văn dài không có yếu tố hành động.`,
  },
};

export const CONTENT_STYLE_CHOICES: { id: ContentStyleChoice; name: string; description: string }[] = [
  { id: 'auto', name: 'Tự chọn theo ngành', description: 'Ẩm thực, làm đẹp → Kể chuyện; thi công, lắp đặt → Thực chiến; còn lại → Chuyên gia giải đáp.' },
  ...Object.values(CONTENT_STYLES).map((s) => ({ id: s.id, name: s.name, description: s.description })),
];

/** Ba kỹ thuật giữ chân người đọc, áp dụng cho mọi kiểu viết. Cấu trúc từng loại trang nằm ở PAGE_STRUCTURES. */
export const ENGAGEMENT_RULES = `BA KỸ THUẬT GIỮ CHÂN NGƯỜI ĐỌC:
1. Móc câu và kết luận trước: hai câu đầu của trang phải nói đúng tình huống hoặc lợi ích cụ thể của người đọc (kiểu Kể chuyện thì mở bằng khung cảnh cụ thể), không mở bằng định nghĩa, không "trong thời đại", không "như chúng ta đã biết". Câu thứ ba nói rõ trang này giúp gì. Bài blog có keyTakeaways: ba đến năm gạch đầu dòng "Tóm tắt nhanh", mỗi ý là một kết luận dùng được ngay.
2. Nội dung có thịt: mỗi đoạn phải có thông tin dùng được, lấy từ dữ liệu thật trong brief (địa chỉ, khu vực, giờ, dịch vụ, điểm khác biệt). Chỉ dùng bảng markdown khi thật sự có từ hai phương án cần so sánh, checklist khi có từ ba việc cần làm, callout "> **Mẹo:** ..." hoặc "> **Lưu ý:** ..." khi có chỗ người đọc dễ mắc lỗi; không thêm các khối này chỉ để cho có. Liên kết nội bộ: hai đến ba liên kết theo ngữ cảnh bằng markdown [chữ](đường dẫn), chỉ dùng đường dẫn trong danh sách được cấp, đặt giữa bài.
3. Nhịp đọc: đoạn hai đến bốn câu; xen câu ngắn; in đậm một cụm quan trọng mỗi hai đến ba đoạn; heading phải chứa thông tin hoặc kết quả cụ thể, không heading chung chung như "Tổng quan", "Giới thiệu"; độ dài vừa đủ để giải quyết nhu cầu tìm kiếm, không kéo dài cho đủ chỉ tiêu.`;

/** Cấu trúc theo mục đích của từng loại trang. Trang nào không có yêu cầu thì không bắt thêm khối. */
export const PAGE_STRUCTURES: Record<PageKind, string> = {
  home: `CẤU TRÚC TRANG CHỦ: trong 5 giây người đọc hiểu làm gì, cho ai, ở đâu → dịch vụ chính (tóm tắt, chi tiết để trang dịch vụ) → bằng chứng và điểm khác biệt chỉ lấy từ brief → quy trình làm việc hoặc trải nghiệm khách → khu vực phục vụ → cách liên hệ. Section cuối "Bước tiếp theo" nói rõ nên làm gì ngay.`,
  about: `CẤU TRÚC TRANG GIỚI THIỆU: con người và cách làm việc có thật: xuất phát điểm, ai làm, giữ tiêu chuẩn gì, cách làm việc với khách, cam kết. Chỉ nêu người, năm tháng, thành tích có trong brief; không có thì kể về cách làm và tiêu chuẩn. Không checklist, không bảng, không "Bước tiếp theo", không móc câu kiểu quảng cáo; kết bằng một đến hai câu mời chân thành.`,
  services: `CẤU TRÚC TRANG DỊCH VỤ: mỗi dịch vụ đi theo thứ tự: vấn đề khách đang gặp → phạm vi công việc gồm gì, không gồm gì → bằng chứng hoặc cách làm khác biệt (chỉ từ brief) → quy trình từ lúc liên hệ đến bàn giao → điều kiện ảnh hưởng báo giá (không bịa giá, giải thích yếu tố làm giá thay đổi) → cách liên hệ. Section chung: cách báo giá, cam kết.`,
  blog: `Trang danh sách bài viết: chỉ cần title, meta, h1 và intro nói blog viết về gì, cho ai.`,
  post: `CẤU TRÚC BÀI VIẾT, chọn theo ý định tìm kiếm của từ khóa và góc nhìn được giao:
- Bài giải đáp (từ khóa dạng câu hỏi, "là gì", "có nên", "tại sao"): trả lời trực tiếp ngay đầu bài → giải thích vì sao → trường hợp ngoại lệ → bước xử lý cụ thể.
- Bài so sánh ("hay", "vs", "nên chọn", "loại nào"): tiêu chí lựa chọn → ưu và nhược từng phương án (bảng nếu từ hai phương án) → ai phù hợp với phương án nào → kết luận có điều kiện.
- Bài hướng dẫn ("cách", "hướng dẫn", "làm sao"): tình huống người đọc → các bước đánh số, mỗi bước có cách kiểm tra đã đúng chưa → lỗi hay gặp → việc cần làm ngay.
Section cuối là "Bước tiếp theo" ngắn gọn, nói việc nên làm và cách liên hệ. Độ dài đủ giải quyết trọn nhu cầu, thường 700 đến 1500 từ, không kéo dài.`,
  contact: `CẤU TRÚC TRANG LIÊN HỆ: cách liên hệ nhanh nhất và thời gian phản hồi hợp lý (không cam kết số nếu brief không có) → thông tin liên hệ đúng brief → khu vực phục vụ → điều nên chuẩn bị trước khi liên hệ. Ngắn gọn, không kể chuyện dài.`,
  privacy: `CẤU TRÚC CHÍNH SÁCH BẢO MẬT cho website tĩnh giới thiệu doanh nghiệp: chỉ mô tả đúng những gì website này làm. Website không có form gửi dữ liệu, không tài khoản, không thanh toán; chỉ có thể có mã phân tích Google Analytics nếu được cho biết. Không đoán thêm công cụ theo dõi hay cách thu thập nào khác. Giọng rõ ràng, không móc câu, không callout.`,
};

const STORY_HINTS = ['quán', 'nhà hàng', 'ẩm thực', 'món', 'phở', 'bún', 'hủ tiếu', 'cơm', 'bánh', 'cà phê', 'cafe', 'trà sữa', 'bar', 'bia', 'tiệc', 'spa', 'làm đẹp', 'nail', 'tóc', 'thẩm mỹ', 'thời trang', 'boutique', 'thủ công', 'handmade', 'homestay', 'khách sạn', 'du lịch', 'tour', 'hoa', 'bakery'];
const PLAYBOOK_HINTS = ['thi công', 'xây dựng', 'lắp đặt', 'sửa chữa', 'điện lạnh', 'điện nước', 'nội thất', 'chuyển nhà', 'vận chuyển', 'logistics', 'bất động sản', 'phần mềm', 'thiết bị', 'máy móc', 'cơ khí', 'in ấn', 'quảng cáo', 'seo', 'marketing', 'kế toán', 'hướng dẫn'];

function norm(s: string): string {
  return s.normalize('NFC').toLowerCase();
}

/** Chọn kiểu viết: theo brief nếu người dùng đã chọn, ngược lại đoán theo ngành và mô tả. */
export function resolveContentStyle(brief: Pick<SiteBrief, 'contentStyle' | 'industry' | 'description' | 'siteType' | 'services'>, defaultChoice: ContentStyleChoice = 'auto'): ContentStyleId {
  const choice = brief.contentStyle && brief.contentStyle !== 'auto' ? brief.contentStyle : defaultChoice;
  if (choice !== 'auto') return choice;
  const text = norm([brief.industry, brief.description, ...brief.services].join(' '));
  if (STORY_HINTS.some((h) => text.includes(norm(h)))) return 'story';
  if (PLAYBOOK_HINTS.some((h) => text.includes(norm(h)))) return 'playbook';
  return 'expert';
}

export function contentStyleGuide(id: ContentStyleId): string {
  return CONTENT_STYLES[id].guide;
}
