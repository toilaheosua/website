import type { Article, GeneralSettings, Outline, PatchTarget, ResearchNotes, RunOptions, SerpData } from '../core/types.js';
import type { PlaceForRole, SourceForLlm } from '../services/types.js';
import { contentStyleGuide, voiceGuide } from './content-styles.js';
import { roundupTitle } from '../core/roundup.js';
import { wordCount } from '../core/util.js';

/**
 * Toàn bộ prompt cho Claude. Khối "quy tắc chung" cố định để được cache;
 * khối "bối cảnh bài" thay đổi theo từng lần chạy nhưng dùng lại cho nhiều lượt gọi trong cùng một bài.
 */

export const WRITER_RULES = `Bạn là cây viết nội dung tiếng Việt kỳ cựu, viết cho blog và website ở Việt Nam. Toàn bộ nội dung bằng tiếng Việt chuẩn chính tả, đủ dấu, đọc tự nhiên như người Việt viết cho người Việt.

NGUYÊN TẮC CỐT LÕI
1. Chỉ dùng dữ kiện có trong GHI CHÚ TƯ LIỆU. Không bịa số liệu, tên riêng, địa chỉ, giá, năm tháng, trích dẫn, giải thưởng. Chỗ ghi chú không có thì nói theo cách nhận biết, tiêu chí lựa chọn, kinh nghiệm chung, hoặc nói thẳng "tùy nơi", "chưa có số liệu rõ".
2. Không sao chép câu chữ của nguồn. Diễn đạt lại hoàn toàn bằng cách nói của mình; không để chuỗi sáu từ liên tiếp nào giống nguồn, trừ tên riêng và thuật ngữ bắt buộc.
3. Viết cho người thật đọc: mỗi đoạn phải có thông tin dùng được hoặc một quan sát đáng nhớ. Không đoạn lấp chỗ, không nhắc lại ý đã nói, không tóm tắt lại bài ở cuối.

GIỌNG NGƯỜI THẬT ĐANG NÓI CHUYỆN (bắt buộc; đây là tiêu chí biên tập quan trọng nhất của tòa soạn)
- Viết như đang kể cho một người quen nghe, không phải như viết báo cáo. Người viết có mặt trong bài: thói quen của mình, lần làm hỏng, chỗ mình từng nhầm, lý do mình thích hay không thích. Mỗi mục H2 có ít nhất một chi tiết đời thường như vậy.
- Câu nói tự nhiên có trợ từ và từ đệm của khẩu ngữ khi hợp: "thì", "mà", "chứ", "đấy", "thôi", "kiểu", "nói chung", "thật ra", "cái này", "chỗ đó". Có câu cụt, có câu bỏ lửng bằng ba chấm, có câu hỏi tu từ rồi tự trả lời.
- Nhịp câu lệch nhau rõ: xen câu 3 đến 6 từ với câu 25 đến 40 từ có mệnh đề chen ngang. Không để ba câu liên tiếp có độ dài và cấu trúc giống nhau. Đoạn văn dài ngắn khác nhau, có đoạn chỉ một câu.
- Không hoàn hảo một cách có chủ ý: được lặp lại một từ để nhấn, được đổi ý giữa chừng ("à mà khoan"), được dùng từ địa phương, được nói "tôi không chắc", "tùy quán", "chưa thử nên không dám nói".
- Chi tiết cụ thể thay cho tính từ chung: thay "rất ngon", "chất lượng", "tuyệt vời" bằng chi tiết quan sát được (màu, mùi, độ, thời gian, cách làm, con số có trong ghi chú).
- Chuyển ý theo cách người nói chuyện ("nói thật là", "cái hay ở đây", "khoan, có một chỗ dễ nhầm", "để ý một chút"), không dùng liên từ sáo mở đầu đoạn: Bên cạnh đó, Ngoài ra, Hơn nữa, Do đó, Vì vậy, Tóm lại, Nhìn chung, Đầu tiên, Thứ hai, Cuối cùng.
- Không mở các đoạn liên tiếp bằng cùng một kiểu; không kết mỗi mục bằng câu tổng kết; không liệt kê ba tính từ liền nhau; không dùng "không chỉ... mà còn" quá một lần; không dùng dấu gạch ngang dài; không dùng dấu chấm phẩy; không dùng dấu hai chấm để mở danh sách trong văn xuôi quá hai lần; không cấu trúc câu đối xứng kiểu "A thì X, B thì Y" quá hai lần.
- Hạn chế gạch đầu dòng và in đậm: phần lớn bài là văn xuôi; chỉ dùng danh sách khi nội dung thật sự là các bước hoặc checklist, tối đa hai danh sách một bài. Bảng chỉ khi so sánh từ hai phương án.
- Heading có thông tin hoặc kết quả, viết đa dạng (câu hỏi, mệnh đề, cụm từ ngắn), không heading chung chung "Giới thiệu", "Tổng quan", "Kết luận", không heading nào cùng cấu trúc ngữ pháp với heading ngay trước nó.
- Tuyệt đối tránh các cụm: "trong thời đại 4.0", "không thể phủ nhận", "hãy cùng tìm hiểu", "hãy cùng khám phá", "như đã đề cập", "trong bài viết này", "qua bài viết", "hy vọng bài viết", "tóm lại", "nhìn chung", "một trong những", "đóng vai trò quan trọng", "không thể thiếu", "với sự phát triển của", "trên thị trường hiện nay", "điều quan trọng là", "cần lưu ý rằng", "tinh hoa ẩm thực", "hàng đầu", "số 1", "uy tín", "đẳng cấp".

ĐỘ DÀI (bắt buộc, vượt là bài bị trả lại)
- Tổng số từ của bài không được vượt số từ tối đa ghi trong bối cảnh. Mỗi mục có ngân sách từ riêng, viết đúng ngân sách đó. Thà thiếu một ý còn hơn vượt trần.

SEO TỰ NHIÊN
- Từ khóa chính có trong title, H1, hai câu đầu của mở bài, một heading và phần kết; tổng số lần xuất hiện không quá 1 lần mỗi 120 từ. Từ khóa phụ rải tự nhiên, không nhồi.
- Title 50 đến 65 ký tự, có từ khóa, có lợi ích hoặc con số nếu hợp. Meta description 140 đến 158 ký tự, có lợi ích cụ thể và lời mời nhẹ.

ĐỊNH DẠNG
- Markdown đơn giản trong body: đoạn văn, **in đậm** một cụm mỗi hai đến ba đoạn, danh sách "- " hoặc "1. " khi cần, bảng markdown khi so sánh, callout "> **Mẹo:**" hoặc "> **Lưu ý:**" tối đa hai lần một bài. Không thẻ HTML, không heading # trong body vì heading nằm ở trường riêng.
- Trả về đúng cấu trúc JSON được yêu cầu, mọi trường có giá trị; trường không dùng để chuỗi rỗng hoặc mảng rỗng.`;

export const RESEARCH_RULES = `Bạn là biên tập viên nghiên cứu tư liệu cho một cây viết tiếng Việt. Nhiệm vụ: đọc các trang web thu thập được về một từ khóa và rút ra ghi chú dữ kiện để người viết dùng, KHÔNG viết bài.

QUY TẮC
1. Ghi chú bằng tiếng Việt, mỗi dữ kiện một câu ngắn, độc lập, có đủ ngữ cảnh để hiểu mà không cần đọc nguồn.
2. Không chép câu của nguồn. Diễn đạt lại bằng lời của bạn; số liệu, tên riêng, thuật ngữ giữ đúng như nguồn.
3. Ghi rõ dữ kiện thuộc nguồn nào (sourceIndex). Dữ kiện xuất hiện ở nhiều nguồn thì đưa vào keyFacts.
4. Không thêm kiến thức ngoài nguồn. Không đánh giá hay khen chê. Nguồn mâu thuẫn nhau thì ghi vào disagreements.
5. Nguồn tiếng Anh thì ghi chú vẫn bằng tiếng Việt, kèm thuật ngữ gốc trong ngoặc khi cần.
6. Trả về đúng cấu trúc JSON được yêu cầu, mọi trường có giá trị.

PHÂN LOẠI THEO NHÃN (bắt buộc)
7. Gắn cho mỗi dữ kiện một nhãn chủ đề con, ví dụ: "cách chế biến", "nguồn gốc tên gọi", "quán ngon", "nguyên liệu", "giá", "biến thể theo vùng", "so sánh với món tương tự", "sai lầm thường gặp", "cách chọn", "lịch sử". Nhãn 2 đến 5 từ, viết thường, thống nhất trong toàn bộ ghi chú: một khái niệm chỉ có một nhãn, không tạo hai nhãn gần nghĩa. Gom dữ kiện theo nhãn vào topics (mỗi nhãn 3 đến 15 dữ kiện, ghi sourceRefs); mỗi nguồn ghi các nhãn nó có vào tags.
8. Các nguồn được đánh dấu TOP GOOGLE là trang Google xếp cao nhất cho từ khóa, tức dạng nội dung Google đang ưu tiên. Với mỗi trang này lập hồ sơ topSites: structure là các phần của trang theo đúng thứ tự xuất hiện (tên phần ngắn, 4 đến 12 phần), tags là các nhãn trang có, contentType nói rõ dạng nội dung nổi bật (bảng so sánh, danh sách quán kèm địa chỉ và giờ mở, công thức từng bước, kể chuyện nguồn gốc, hỏi đáp...). Nhãn nào có mặt ở trang TOP GOOGLE thì đặt inTopSites = true.
9. Ghi vào comparisons mọi so sánh nguồn nêu hoặc dựng được từ dữ kiện: giữa cách chế biến, giữa biến thể, giữa quán, giữa mức giá, giữa cách chọn đúng và sai lầm; mỗi so sánh có items (2 đến 5 đối tượng) và criteria (3 đến 6 tiêu chí có dữ kiện). Ghi vào similarItems các món, sản phẩm, phương án tương tự mà nguồn nhắc tới, kèm các điểm khác biệt nguồn nêu; không tự thêm điểm khác biệt ngoài nguồn.`;

export const COMPARISON_RULES = `CHẾ ĐỘ SO SÁNH 100% (người đặt bài yêu cầu; ghi đè các quy tắc hạn chế bảng và danh sách ở trên)
- Mọi mục H2 là một so sánh giữa từ hai đối tượng trở lên: cách chế biến này với cách khác, biến thể vùng này với vùng khác, quán này với quán kia, món này với món tương tự, mức giá này với mức giá kia, cách chọn đúng với sai lầm hay gặp. Không mục nào chỉ mô tả một đối tượng.
- Mỗi mục có một bảng markdown: cột đầu là tiêu chí, các cột sau là đối tượng so sánh; 3 đến 6 hàng; ô ghi ngắn (2 đến 12 từ) và chỉ ghi điều ghi chú có, không có thì ghi "tùy nơi" hoặc "chưa rõ". Bảng dùng ở mọi mục, không giới hạn số bảng.
- Văn xuôi quanh bảng không lặp lại nội dung ô bảng: trước bảng một đến hai câu nói mình đang so sánh gì và vì sao người đọc cần; sau bảng một đến ba đoạn nói điểm khác biệt quyết định, chỗ dễ nhầm và chính kiến của người viết chọn gì trong hoàn cảnh nào. Văn xuôi vẫn theo giọng người thật đang nói chuyện.
- So sánh với món hoặc phương án tương tự: dùng điểm khác biệt trong ghi chú; nếu ghi chú không có thì chỉ nói đặc điểm phổ thông ai cũng biết (loại sợi, kiểu nước dùng, cách ăn, nguyên liệu chính), không số liệu, không giá, không tên quán, không năm tháng.`;

export const MAPS_RULES = `Bạn là biên tập viên dữ liệu địa điểm cho một cây viết ẩm thực tiếng Việt. Bạn đọc dữ liệu Google Maps và đánh giá công khai, trả về JSON đúng cấu trúc, không viết bài. Không bịa thông tin ngoài dữ liệu được đưa. Không chép nguyên văn câu của người đánh giá: diễn đạt lại thành ý ngắn, trung tính.`;

export const ROUNDUP_RULES = `KIỂU BÀI: TỔNG HỢP QUÁN THEO KHU VỰC (bắt buộc, ghi đè các quy tắc về bảng và về "chi tiết đời thường" ở trên)
- Dữ liệu duy nhất là GHI CHÚ TƯ LIỆU dựng từ Google Maps: mỗi quán có địa chỉ, sao, số đánh giá, giá, giờ mở, ý khen chê rút từ đánh giá công khai. Không bịa món, giá, giờ, không gian, tên chủ quán, năm mở.
- Người viết là người tổng hợp và đối chiếu đánh giá, chưa chắc đã đến quán. TUYỆT ĐỐI không kể "tôi đã ăn ở đây", "lần tôi ghé", "chủ quán nói với tôi" cho quán không có GHI CHÚ CỦA NGƯỜI ĐẶT BÀI. Được nói theo góc người đọc và đối chiếu: "tôi đọc hơn hai trăm đánh giá của quán này", "điều nhiều người khen nhất là", "chỗ bị chê đi chê lại là", "tôi để ý", "nếu là tôi thì chọn quán này khi". Quán có ghi chú của người đặt bài thì kể đúng ghi chú đó ở ngôi thứ nhất, không thêm thắt.
- Mỗi quán được chọn có đúng một mục H2 riêng, heading chứa đúng tên quán như trong ghi chú (được thêm số thứ hạng và một cụm ngắn nói điểm nổi bật). KHÔNG tự viết dòng địa chỉ, giờ mở cửa, điện thoại, website, sao, link Google Maps vào đầu mục: tool sẽ chèn chính xác từ dữ liệu (địa chỉ kèm link bản đồ, giờ mở cửa theo ngày, liên hệ, sao và số đánh giá). Trong văn xuôi vẫn được nhắc giờ mở hay sao khi có ý nghĩa với người đọc. Nội dung mục nói quán này khác các quán kia ở đâu, món hay điểm được nhắc nhiều, ai hợp, chỗ nào bị chê, nhắc sao và số đánh giá một cách tự nhiên trong câu.
- Có một mục "so sánh nhanh" đặt trước các mục quán và một mục "quán nào hợp ai" đặt sau các mục quán, nhưng KHÔNG VIẾT BẢNG ở hai mục này: tool tự chèn bảng dựng từ dữ liệu Google Maps (sao, số đánh giá, giá, giờ mở, điểm nổi bật; tình huống, quán nên chọn, lý do). Ở mục so sánh nhanh chỉ viết một đến hai câu dẫn nói bảng gom gì và cách đọc, rồi một đến hai đoạn nhận xét điểm khác biệt quyết định giữa các quán (không lặp lại số trong bảng); ở mục hợp ai viết hai đến bốn câu nói cách chọn theo tình huống. Mục "cách tôi xếp hạng" luôn là mục cuối cùng, 2 đến 3 câu bằng lời thường: xếp theo sao và số lượt đánh giá, quán ít lượt không lên đầu, quán lâu năm đông khách được ưu tiên, dữ liệu từ Google Maps, nên kiểm tra giờ mở trước khi đi. Không dùng thuật ngữ thống kê (Bayes, hằng số, trọng số, log) ở bất kỳ đâu trong bài.
- Giọng vẫn là người thật nói chuyện: câu dài ngắn lệch nhau, chính kiến có lý do, thừa nhận giới hạn ("tôi chưa ăn thử", "sao có thể đổi theo thời gian").
- MỞ BÀI ĐI THẲNG VÀO VIỆC, không dựng khung cảnh, không kể chuyện dẫn dắt, không câu hỏi tu từ: 2 đến 3 câu, câu đầu có từ khóa và nói ngay bài gồm bao nhiêu quán, chọn theo tiêu chí gì (sao, số đánh giá thật trên Google Maps), câu sau nói người đọc dùng bài thế nào (chọn theo nhu cầu, xem bảng so sánh). Cả bài viết thẳng, tập trung vào quán và dữ kiện; mỗi đoạn có thông tin dùng được, không lan man.
- TUYỆT ĐỐI KHÔNG nói về việc thiếu dữ liệu. Cấm mọi câu kiểu "tư liệu chưa có", "chưa có trong tư liệu", "chưa có dữ liệu giá", "chưa thể xác định", "chưa thể kết luận", "chưa được ghi nhận", "giữ nguyên giới hạn", ô bảng "chưa rõ", "chưa xác định". Khía cạnh nào không có dữ liệu thì đơn giản là không viết về nó: không có giá thì không có cột giá, không có ý khen chê thì viết về giờ mở, vị trí, loại hình, số đánh giá và hạng; không đặt FAQ về điều không trả lời được. Bảng chỉ có các cột mà ít nhất một quán có dữ liệu; ô trống của quán thì để trống, không điền chữ. Câu than thiếu dữ liệu làm bài thừa chữ và bị Google coi là bài mỏng.
- MỖI QUÁN MỘT VAI RIÊNG: ghi chú của mỗi quán có dòng "VAI TRONG BÀI" (rút từ dữ liệu, không quán nào trùng) và dòng "HỢP NHẤT KHI". Heading và cả mục của quán phải xây quanh vai đó: câu đầu mục nói ngay vai và dữ kiện làm căn cứ (số lượt, sao, giờ, giá, món được nhắc), phần còn lại nói vì sao vai đó hợp với ai và chỗ nào cần cân nhắc. Hai mục quán KHÔNG được mở đầu cùng một kiểu câu, KHÔNG dùng lại cùng cụm khen ("nước lèo đậm đà", "phục vụ nhanh", "giá hợp lý"...) ở nhiều quán: mỗi quán chọn chi tiết khen riêng có trong ghi chú của chính quán đó. Mục "quán nào hợp ai" là danh sách quyết định: mỗi tình huống chỉ một quán, lấy từ dòng "HỢP NHẤT KHI", mỗi quán xuất hiện đúng một lần, lý do nêu dữ kiện.`;

export const BRAND_RULES = `KIỂU BÀI: GIỚI THIỆU THƯƠNG HIỆU, DOANH NGHIỆP (bắt buộc, ghi đè các quy tắc về bảng và "chi tiết đời thường" ở trên)
- Dữ liệu: (1) THÔNG TIN TỪ THƯƠNG HIỆU do người đặt bài cung cấp, đáng tin nhất, được kể theo ngôi đã chọn; (2) dữ liệu Google Maps: tên, địa chỉ, giờ, sao, số đánh giá, điện thoại, website; (3) ý rút từ đánh giá công khai của khách. Không bịa lịch sử, năm thành lập, giải thưởng, giá, món, số liệu ngoài ba nguồn này.
- Mục đích: bài giới thiệu để đăng trên website của thương hiệu hoặc trang tin địa phương. Giọng tự tin, ấm, không hô khẩu hiệu; mọi lời khen phải gắn với chi tiết cụ thể (từ đánh giá khách hoặc thông tin thương hiệu), có kèm sao và số đánh giá khi nói về uy tín.
- Mở bài 2 đến 3 câu đi thẳng: thương hiệu là gì, ở đâu, điều khách khen nhất. Không dựng khung cảnh, không câu hỏi tu từ.
- Cấu trúc cố định (tool sẽ ép): H2 giới thiệu (câu chuyện, điều làm nên thương hiệu, từ thông tin thương hiệu), H2 khách nói gì (từ đánh giá, nêu sao và số lượt), H2 sản phẩm hoặc dịch vụ nổi bật, H2 không gian và vị trí (cách đến, quanh đó có gì nếu ghi chú có), H2 hình ảnh (tool chèn ảnh, model viết một câu dẫn), H2 thông tin liên hệ (tool chèn khối địa chỉ, giờ, điện thoại, website, link Maps; model viết một đến hai câu mời). Nếu người đặt bài cho phép thì thêm H2 "điều nên biết trước khi đến" nêu góp ý của khách một cách thiện chí.
- KHÔNG tự viết dòng địa chỉ, giờ, điện thoại, website, link Google Maps, dòng ảnh: tool chèn chính xác. Không câu than thiếu dữ liệu: không có thông tin phần nào thì viết ngắn phần đó hoặc bỏ.
- Không dùng thuật ngữ thống kê. Không kể trải nghiệm cá nhân bịa; xưng "chúng tôi" thì chỉ nói điều có trong thông tin thương hiệu.`;

export const REVIEWER_RULES = `Bạn là biên tập viên kiểm chứng dữ kiện của một tạp chí tiếng Việt. Việc của bạn là đối chiếu từng dữ kiện trong bài với GHI CHÚ TƯ LIỆU và bố cục, không chấm phong cách. Mỗi lỗi phải chỉ đúng vị trí, trích nguyên văn câu lỗi và nói cách sửa. Không có lỗi thì nói không có; không bịa lỗi cho đủ. Trả về đúng cấu trúc JSON được yêu cầu.`;

/* ------------------------------------------------------------------ */
/*  Khối bối cảnh của một bài                                            */
/* ------------------------------------------------------------------ */

export function formatNotes(notes: ResearchNotes): string {
  const lines: string[] = [];
  lines.push(`Ý định tìm kiếm: ${notes.searchIntent}. ${notes.intentExplanation}`);
  lines.push(`Tóm tắt tư liệu: ${notes.summary}`);
  if (notes.keyFacts.length) lines.push('', 'DỮ KIỆN CHÍNH (nhiều nguồn cùng nói):', ...notes.keyFacts.map((f) => `- ${f}`));
  const topics = notes.topics ?? [];
  if (topics.length) {
    lines.push('', 'PHÂN LOẠI THEO NHÃN (bố cục dựng từ đây; nhãn có [TOP] là có ở trang top đầu Google, được ưu tiên):');
    for (const t of topics) {
      lines.push(`- [${t.tag}]${t.inTopSites ? ' [TOP]' : ''} ${t.description}${t.sourceRefs.length ? ` (nguồn ${t.sourceRefs.join(', ')})` : ''}`, ...t.facts.map((f) => `    + ${f}`));
    }
  }
  const topSites = notes.topSites ?? [];
  if (topSites.length) {
    lines.push('', 'TRANG TOP ĐẦU GOOGLE (dạng nội dung Google đang ưu tiên cho từ khóa này; bố cục bám theo nhãn, thứ tự và dạng nội dung của các trang này):');
    for (const s of topSites) lines.push(`- Top ${s.position} (nguồn ${s.sourceIndex}): ${s.contentType}. Cấu trúc: ${s.structure.join(' | ')}. Nhãn: ${s.tags.join(', ')}`);
  }
  const comparisons = notes.comparisons ?? [];
  if (comparisons.length) {
    lines.push('', 'SO SÁNH DỰNG ĐƯỢC TỪ NGUỒN:');
    for (const c of comparisons) lines.push(`- ${c.topic}: ${c.items.join(' vs ')}; tiêu chí: ${c.criteria.join(', ')}${c.sourceRefs.length ? ` (nguồn ${c.sourceRefs.join(', ')})` : ''}`);
  }
  const similar = notes.similarItems ?? [];
  if (similar.length) {
    lines.push('', 'MÓN HOẶC PHƯƠNG ÁN TƯƠNG TỰ ĐƯỢC NGUỒN NHẮC (để so sánh; chỉ dùng điểm khác biệt ghi ở đây):');
    for (const s of similar) lines.push(`- ${s.name}: ${s.differences.join('; ')}${s.sourceRefs.length ? ` (nguồn ${s.sourceRefs.join(', ')})` : ''}`);
  }
  if (notes.numbersAndNames.length) lines.push('', 'SỐ LIỆU VÀ TÊN RIÊNG (giữ đúng, không bịa thêm):', ...notes.numbersAndNames.map((f) => `- ${f}`));
  if (notes.disagreements.length) lines.push('', 'NGUỒN MÂU THUẪN (nói "tùy" hoặc nêu cả hai, không chọn bừa):', ...notes.disagreements.map((f) => `- ${f}`));
  for (const s of notes.perSource) {
    lines.push('', `NGUỒN ${s.sourceIndex} (${s.url}) - góc nhìn: ${s.angle}${s.tags?.length ? ` - nhãn: ${s.tags.join(', ')}` : ''}`, ...s.facts.map((f) => `- ${f}`));
  }
  if (notes.commonSubtopics.length) lines.push('', 'CÁC MỤC HẦU HẾT NGUỒN ĐỀU CÓ:', ...notes.commonSubtopics.map((f) => `- ${f}`));
  if (notes.gaps.length) lines.push('', 'ĐIỀU NGUỒN CHƯA NÓI RÕ MÀ NGƯỜI ĐỌC CẦN (chỉ được nói theo kinh nghiệm chung, không bịa số liệu):', ...notes.gaps.map((f) => `- ${f}`));
  if (notes.peopleAlsoAsk.length) lines.push('', 'CÂU HỎI NGƯỜI DÙNG HAY HỎI TRÊN GOOGLE:', ...notes.peopleAlsoAsk.map((f) => `- ${f}`));
  if (notes.secondaryKeywords.length) lines.push('', `TỪ KHÓA PHỤ: ${notes.secondaryKeywords.join(', ')}`);
  return lines.join('\n');
}

export function formatOutline(o: Outline): string {
  const lines: string[] = [];
  lines.push(`Title: ${o.title}`, `H1: ${o.h1}`, `Meta: ${o.metaDescription}`, `Kiểu viết: ${o.style} (${o.styleReason})`, `Ý định tìm kiếm: ${o.searchIntent}`, `Ý mở bài (móc câu): ${o.hookIdea}`, `Độ dài mục tiêu: ${o.targetWords} từ`);
  lines.push('', 'TÓM TẮT NHANH:', ...o.quickSummary.map((s) => `- ${s}`));
  lines.push('', 'CÁC MỤC:');
  o.sections.forEach((s, i) => {
    lines.push(`${i + 1}. [H${s.level}] ${s.heading}`, `   Mục tiêu: ${s.goal}`, `   Dạng: ${s.format}${s.tag ? `; nhãn: ${s.tag}` : ''}${s.sourceRefs.length ? `; dữ kiện từ nguồn ${s.sourceRefs.join(', ')}` : ''}`);
    if (s.comparisonItems?.length) lines.push(`   So sánh: ${s.comparisonItems.join(' vs ')}${s.comparisonCriteria?.length ? ` theo tiêu chí: ${s.comparisonCriteria.join(', ')}` : ''}`);
    lines.push(...s.points.map((p) => `   - ${p}`));
  });
  if (o.faq.length) lines.push('', 'FAQ:', ...o.faq.map((q) => `- ${q}`));
  lines.push('', `KẾT ("${o.nextSteps ? 'Bước tiếp theo' : ''}"): ${o.nextSteps}`);
  if (o.secondaryKeywords.length) lines.push(`Từ khóa phụ: ${o.secondaryKeywords.join(', ')}`);
  if (o.imageIdeas.length) lines.push('', 'ẢNH GỢI Ý:', ...o.imageIdeas.map((im) => `- ${im.position}: ${im.query} (alt: ${im.alt})`));
  return lines.join('\n');
}

/** Chia ngân sách số từ cho từng phần theo mục tiêu, để bài không vượt trần. */
export function wordBudget(outline: Outline, options: RunOptions): { total: number; intro: number; sections: number[]; faqEach: number; nextSteps: number } {
  const total = Math.min(outline.targetWords || options.maxWords, options.maxWords);
  const intro = 80;
  const nextSteps = 60;
  const faqEach = 55;
  const fixed = intro + nextSteps + faqEach * outline.faq.length + outline.quickSummary.length * 12;
  const remaining = Math.max(300, total - fixed);
  const weights = outline.sections.map((s) => (s.level === 3 ? 0.55 : 1));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return { total, intro, sections: weights.map((w) => Math.round((remaining * w) / sum)), faqEach, nextSteps };
}

export function runContextBlock(input: { keyword: string; options: RunOptions; settings: GeneralSettings; notes?: ResearchNotes; outline?: Outline; styleId?: Outline['style'] }): string {
  const { keyword, options, settings } = input;
  const style = input.outline?.style ?? input.styleId;
  const lines: string[] = [];
  lines.push(`TỪ KHÓA CHÍNH: ${keyword}`);
  lines.push(`Độ dài bài: ${options.minWords} đến ${options.maxWords} từ. Số từ tối đa tuyệt đối: ${options.maxWords}.`);
  lines.push(`Người đọc: ${options.audience.trim() || 'người đọc phổ thông ở Việt Nam đang tìm hiểu về chủ đề này'}.`);
  if (options.secondaryKeywords.length) lines.push(`Từ khóa phụ người dùng yêu cầu: ${options.secondaryKeywords.join(', ')}.`);
  if (options.notes.trim()) lines.push(`Yêu cầu riêng của người đặt bài: ${options.notes.trim()}`);
  lines.push('', voiceGuide(options.voice, options.dialect));
  if (settings.styleSamples.trim()) {
    lines.push('', 'VĂN PHONG MẪU DO CHÍNH NGƯỜI ĐẶT BÀI VIẾT (học cách xưng hô, nhịp câu, từ quen dùng, mức suồng sã, cách chuyển ý; không sao chép nguyên văn, không lặp lại ý):', '"""', settings.styleSamples.trim().slice(0, 8000), '"""');
  }
  // Bài tổng hợp quán không dùng ba kiểu viết (Kể chuyện mở bằng khung cảnh...): chỉ theo quy tắc riêng, viết thẳng
  if (style && options.kind === 'web') lines.push('', contentStyleGuide(style));
  if (options.kind === 'roundup') lines.push('', ROUNDUP_RULES);
  else if (options.kind === 'brand') lines.push('', BRAND_RULES);
  else if (options.comparison) lines.push('', COMPARISON_RULES);
  if (input.notes) lines.push('', '===== GHI CHÚ TƯ LIỆU (nguồn dữ kiện duy nhất được phép dùng) =====', formatNotes(input.notes));
  if (input.outline) {
    const b = wordBudget(input.outline, options);
    lines.push('', '===== BỐ CỤC ĐÃ DUYỆT =====', formatOutline(input.outline));
    lines.push('', `NGÂN SÁCH SỐ TỪ (tổng không quá ${b.total}): mở bài ${b.intro}; ${input.outline.sections.map((s, i) => `mục ${i + 1} "${s.heading}" ${b.sections[i]} từ`).join('; ')}; mỗi câu FAQ ${b.faqEach}; kết ${b.nextSteps}.`);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Prompt từng bước                                                     */
/* ------------------------------------------------------------------ */

export function extractNotesPrompt(input: { keyword: string; sources: SourceForLlm[]; serp: SerpData; settings: GeneralSettings }): string {
  const { keyword, sources, serp, settings } = input;
  const lines: string[] = [];
  lines.push(`Từ khóa: "${keyword}"`);
  const tops = sources.filter((s) => s.topRank);
  if (tops.length) lines.push(`Các nguồn ${tops.map((s) => `${s.index} (Top ${s.topRank} Google)`).join(', ')} là trang xếp cao nhất cho từ khóa này: lập hồ sơ topSites cho từng trang và đánh dấu inTopSites cho các nhãn chúng có.`);
  if (serp.peopleAlsoAsk.length) lines.push(`Câu hỏi "Mọi người cũng hỏi" trên Google: ${serp.peopleAlsoAsk.join(' | ')}`);
  if (serp.relatedSearches.length) lines.push(`Tìm kiếm liên quan: ${serp.relatedSearches.join(' | ')}`);
  lines.push('', `Yêu cầu: rút ghi chú từ ${sources.length} nguồn dưới đây. Tổng số từ của toàn bộ ghi chú (perSource + keyFacts + numbersAndNames + disagreements) trong khoảng ${settings.notesMinWords} đến ${settings.notesMaxWords} từ. Mỗi nguồn 6 đến 15 dữ kiện, ưu tiên dữ kiện cụ thể (cách làm, nguyên liệu, con số, tên gọi, phân loại, mẹo, sai lầm, giá dạng khoảng), bỏ quảng cáo và câu chung chung. keyFacts 10 đến 20 dữ kiện; secondaryKeywords 5 đến 10 từ khóa phụ người Việt hay tìm liên quan trực tiếp; commonSubtopics là các mục hầu hết nguồn đều có; gaps là điều người đọc cần mà nguồn chưa nói rõ.`);
  lines.push('', 'Xác định searchIntent: informational (tìm hiểu), comparison (so sánh, chọn), howto (cách làm), transactional (mua, đặt), local (tìm địa điểm), mixed.');
  lines.push('', 'Phân loại: topics gom toàn bộ dữ kiện theo nhãn (mỗi nhãn ghi description một câu, sourceRefs, inTopSites); topSites cho từng nguồn TOP GOOGLE (structure theo thứ tự, tags, contentType); comparisons là các so sánh dựng được (items, criteria); similarItems là món hoặc phương án tương tự nguồn nhắc kèm điểm khác biệt.');
  for (const s of sources) {
    lines.push('', `########## NGUỒN ${s.index}${s.topRank ? ` | TOP GOOGLE ${s.topRank}` : ''} | ${s.language} | ${s.title} | ${s.url}`, s.text);
  }
  return lines.join('\n');
}

/** Bố cục cho bài tổng hợp quán: cấu trúc cố định, model chỉ điền title, meta, hook, tóm tắt, heading và ý từng mục. */
function roundupOutlinePrompt(input: { keyword: string; options: RunOptions; notes: ResearchNotes; forcedStyle: Outline['style'] | null }): string {
  const { keyword, options, notes } = input;
  const r = notes.roundup!;
  const target = Math.round((options.minWords + options.maxWords) / 2);
  const names = r.featured.map((p) => p.name);
  const lines: string[] = [];
  lines.push(`Lập bố cục cho bài "tổng hợp ${r.featured.length} quán ${r.dish} ở ${r.area}" (từ khóa "${keyword}"), độ dài ${options.minWords} đến ${options.maxWords} từ (mục tiêu ${target}), dựa hoàn toàn trên GHI CHÚ TƯ LIỆU.`);
  lines.push(`Kiểu viết: ${input.forcedStyle ?? 'story'} (bài địa điểm ẩm thực). Ghi styleReason một câu.`);
  lines.push('', 'CẤU TRÚC BẮT BUỘC, ĐÚNG THỨ TỰ:');
  const criteria = (notes.comparisons?.[0]?.criteria ?? ['sao', 'số đánh giá', 'điểm nổi bật']).map((c) => `"${c}"`).join(', ');
  lines.push(`1. H2 bảng so sánh nhanh: heading kiểu "So sánh nhanh ${r.featured.length} quán", format=table, tag="so sánh", comparisonItems = tên đủ ${r.featured.length} quán, comparisonCriteria = [${criteria}] (chỉ các tiêu chí có dữ liệu; không thêm "giá" nếu không quán nào có mức giá), points là câu dẫn và nhận xét quanh bảng, vì bảng do tool chèn từ dữ liệu Maps, model không viết bảng.`);
  lines.push(`2. Mỗi quán một H2 theo đúng thứ hạng, heading = "<hạng>. <tên quán>: <vai riêng>": ${r.featured.map((p) => `"${p.rank}. ${p.name}${p.role ? `: ${p.role}` : ''}"`).join(', ')}. Heading phải chứa đúng tên quán; cụm sau dấu hai chấm là VAI TRONG BÀI của quán (có thể rút gọn, không đổi ý). format=text, tag="quán", comparisonItems rỗng, sourceRefs=[thứ hạng], points 3 đến 5 ý lấy từ ghi chú của quán đó, ý đầu luôn là vai riêng kèm dữ kiện làm căn cứ, các ý sau: điểm được khen riêng của quán này, chỗ bị chê, ai hợp, ghi chú của người đặt bài nếu có. goal nói mục này giúp người đọc quyết định gì.`);
  const situations = r.featured.filter((p) => p.bestFor).map((p) => `"${p.bestFor}"`);
  lines.push(`3. H2 "quán nào hợp ai" (đặt heading tự nhiên hơn), format=table, tag="hợp ai", comparisonItems = ${situations.length >= 3 ? `đúng các tình huống sau, mỗi tình huống ứng với một quán, mỗi quán một lần: [${situations.join(', ')}]` : '4 đến 6 tình huống (ăn sáng nhanh, đi gia đình, ăn khuya, ngân sách thấp, khách du lịch lần đầu), mỗi tình huống một quán khác nhau'}, comparisonCriteria = ["quán nên chọn", "lý do"]; bảng do tool chèn, points chỉ là vài câu nói cách chọn theo tình huống.`);
  lines.push('4. H2 "cách tôi xếp hạng" ĐẶT CUỐI CÙNG, sau mọi mục khác (heading tự nhiên), format=text, tag="cách xếp hạng", 2 đến 3 câu ngắn bằng lời thường: xếp theo sao và số lượt đánh giá, quán ít lượt không lên đầu, quán lâu năm đông khách được ưu tiên. KHÔNG dùng thuật ngữ thống kê (Bayes, hằng số m, trung bình có trọng số, log), người đọc đại chúng không hiểu.');
  lines.push(`Tổng ${r.featured.length + 3} mục H2, không H3, không thêm mục khác. Tên quán trong comparisonItems và heading phải khớp từng chữ với: ${names.join(' | ')}.`);
  lines.push('', 'CÁC TRƯỜNG KHÁC:');
  lines.push(`- hookIdea: KHÔNG dựng khung cảnh hay kể chuyện. Ghi một câu mô tả mở bài đi thẳng: "${r.featured.length} quán ${r.dish} ở ${r.area} chọn từ đánh giá thật trên Google Maps theo sao và số đánh giá; bài giúp chọn quán theo nhu cầu". Mở bài 2 đến 3 câu, câu đầu có từ khóa.`);
  lines.push('- quickSummary: 3 đến 5 kết luận dùng được ngay (quán điểm cao nhất, quán nhiều đánh giá nhất, quán mở sớm hoặc khuya nếu ghi chú có). Không có ý nào nói về việc thiếu dữ liệu.');
  lines.push(`- faq: 3 câu người đọc thật sự hỏi trước khi đi và ghi chú TRẢ LỜI ĐƯỢC (quán nào điểm cao nhất, quán nào nhiều đánh giá, mở cửa giờ nào, nên chọn quán nào cho lần đầu); không hỏi về giá, chỗ đậu xe hay điều gì ghi chú không có. Gợi ý: ${notes.peopleAlsoAsk.join(' | ')}.`);
  lines.push('- nextSteps: một đến hai câu gợi ý việc làm ngay (chọn một quán theo tình huống, kiểm tra giờ mở trên Google Maps trước khi đi).');
  lines.push(`- secondaryKeywords: 5 đến 8 từ khóa phụ, gồm: ${notes.secondaryKeywords.join(', ')}${options.secondaryKeywords.length ? `, bắt buộc có: ${options.secondaryKeywords.join(', ')}` : ''}.`);
  lines.push('- tableCandidates: ["so sánh nhanh các quán", "quán nào hợp ai"]. imageIdeas: 1 đến 2 ảnh minh họa chung (query tiếng Anh, alt tiếng Việt); ảnh từng quán tool tự thêm.');
  lines.push(`- title và h1 đúng mẫu cố định: "${roundupTitle(r.featured.length, r.dish, r.area)}" (tool sẽ ép lại nếu khác). metaDescription 140 đến 158 ký tự nêu số quán, tiêu chí chọn và lợi ích. targetWords = ${target}.`);
  return lines.join('\n');
}

/** Bố cục bài giới thiệu thương hiệu: cấu trúc cố định, model điền title, meta, ý từng mục. */
function brandOutlinePrompt(input: { keyword: string; options: RunOptions; notes: ResearchNotes }): string {
  const { options, notes } = input;
  const b = notes.brand!;
  const target = Math.round((options.minWords + options.maxWords) / 2);
  const lines: string[] = [];
  lines.push(`Lập bố cục cho bài giới thiệu "${b.name}", độ dài ${options.minWords} đến ${options.maxWords} từ (mục tiêu ${target}), dựa hoàn toàn trên GHI CHÚ TƯ LIỆU. Kiểu viết: expert. styleReason một câu.`);
  lines.push('', 'CẤU TRÚC BẮT BUỘC, ĐÚNG THỨ TỰ, mỗi mục là H2, format=text, comparisonItems rỗng:');
  lines.push(`1. tag="giới thiệu": ${b.name} là ai, câu chuyện, điều làm nên thương hiệu (từ nhãn "thông tin từ thương hiệu"${b.info ? '' : '; chưa có thông tin thì dựa vào loại hình và mô tả trên Maps, viết ngắn'}).`);
  lines.push('2. tag="khách nói gì": điều khách khen nhất từ đánh giá, nêu sao và số lượt; points là các ý khen cụ thể.');
  lines.push('3. tag="sản phẩm": món, sản phẩm hoặc dịch vụ nổi bật (từ thông tin thương hiệu và món được nhắc nhiều trong đánh giá).');
  lines.push('4. tag="không gian": không gian, vị trí, cách đến, hợp với ai (từ đánh giá và địa chỉ).');
  if (b.includeCons) lines.push('5. tag="điều nên biết": góp ý của khách nêu thiện chí, kèm cách thương hiệu có thể đáp lại nếu thông tin thương hiệu có.');
  lines.push(`${b.includeCons ? 6 : 5}. tag="hình ảnh": heading "Hình ảnh ${b.name}", points một câu dẫn; ảnh tool tự chèn.`);
  lines.push(`${b.includeCons ? 7 : 6}. tag="liên hệ": heading "Thông tin liên hệ ${b.name}", points một đến hai câu mời ghé, đặt bàn hoặc gọi trước; khối địa chỉ, giờ, điện thoại tool tự chèn.`);
  lines.push('', 'CÁC TRƯỜNG KHÁC:');
  lines.push(`- title: "${b.name}: <điểm nổi bật ngắn>" tổng 45 đến 65 ký tự; h1 giống title hoặc tự nhiên hơn; metaDescription 140 đến 158 ký tự nêu loại hình, địa điểm, điều khách khen, lời mời.`);
  lines.push('- hookIdea: một câu mô tả mở bài đi thẳng (thương hiệu là gì, ở đâu, điều khách khen nhất). quickSummary 3 ý dùng được ngay (điểm khen, giờ mở, nên thử gì).');
  lines.push(`- faq: 3 câu trả lời được từ ghi chú (ở đâu, mở cửa giờ nào, nên thử gì): ${notes.peopleAlsoAsk.join(' | ')}.`);
  lines.push(`- nextSteps: một đến hai câu mời hành động (ghé, gọi, xem Maps). secondaryKeywords 4 đến 6, gồm: ${notes.secondaryKeywords.join(', ')}. tableCandidates rỗng. imageIdeas rỗng (ảnh từ Google Maps). targetWords = ${target}.`);
  return lines.join('\n');
}

export function outlinePrompt(input: { keyword: string; options: RunOptions; notes: ResearchNotes; serp: SerpData; settings: GeneralSettings; forcedStyle: Outline['style'] | null }): string {
  const { keyword, options, notes, serp, forcedStyle } = input;
  if (options.kind === 'roundup' && notes.roundup) return roundupOutlinePrompt({ keyword, options, notes, forcedStyle });
  if (options.kind === 'brand' && notes.brand) return brandOutlinePrompt({ keyword, options, notes });
  const target = Math.round((options.minWords + options.maxWords) / 2);
  const lines: string[] = [];
  lines.push(`Lập bố cục cho một bài blog về từ khóa "${keyword}", độ dài ${options.minWords} đến ${options.maxWords} từ (mục tiêu ${target}), dựa hoàn toàn trên GHI CHÚ TƯ LIỆU.`);
  lines.push(
    forcedStyle
      ? `Kiểu viết bắt buộc: ${forcedStyle}. Ghi styleReason ngắn.`
      : 'Chọn kiểu viết hợp nhất với ý định tìm kiếm và chủ đề: story (ẩm thực, du lịch, làm đẹp, văn hóa, trải nghiệm), playbook (cách làm, công thức, so sánh, chọn mua, quy trình), expert (câu hỏi, dịch vụ, sức khỏe, pháp lý, tài chính, tư vấn). Ghi styleReason một câu.',
  );
  const maxH2 = Math.max(4, Math.min(7, Math.round(target / 230)));
  const faqCount = target < 1100 ? '3' : '3 đến 4';
  lines.push('', 'YÊU CẦU BỐ CỤC:');
  lines.push(`- Đúng ${Math.max(4, maxH2 - 1)} đến ${maxH2} mục H2 theo đúng thứ tự người đọc cần (bài ${target} từ không chứa nổi nhiều hơn); thêm tối đa 2 H3 dưới một H2 khi mục đó có nhiều nhánh. Heading có thông tin hoặc kết quả, viết đa dạng, không "Giới thiệu", "Tổng quan", "Kết luận".`);
  lines.push('- Mỗi mục có goal (người đọc nhận được gì), 3 đến 6 points là dữ kiện hoặc ý cụ thể lấy từ ghi chú, sourceRefs là số thứ tự nguồn có dữ kiện đó, format (text, steps, table, checklist, mixed). Chỉ dùng table khi có từ hai phương án để so sánh, steps khi là quy trình, checklist khi có từ ba việc cần kiểm tra.');
  lines.push('- BỐ CỤC DỰNG TỪ NHÃN: mỗi mục ghi tag đúng chữ một nhãn trong PHÂN LOẠI THEO NHÃN của ghi chú. Nhãn có [TOP] bắt buộc có mục H2 riêng (quá ít dữ kiện thì làm H3 dưới mục gần nghĩa), xếp trước và theo thứ tự xuất hiện trong cấu trúc của trang Top 1, rồi Top 2, Top 3; dạng nội dung nổi bật của trang top (contentType: danh sách quán, công thức từng bước, bảng...) được tái sử dụng ở mục cùng nhãn. Nhãn không có [TOP] chỉ thêm khi còn chỗ và có đủ dữ kiện.');
  lines.push('- Bố cục phải bao phủ các mục hầu hết nguồn đều có (commonSubtopics) và trả lời được câu hỏi người dùng hay hỏi; thêm ít nhất một góc mà các nguồn chưa làm rõ (gaps) để bài có giá trị riêng.');
  if (options.comparison) {
    const similar = (notes.similarItems ?? []).map((s) => s.name);
    lines.push(`- CHẾ ĐỘ SO SÁNH 100%: mọi mục H2 phải có comparisonItems (2 đến 5 đối tượng) và comparisonCriteria (3 đến 6 tiêu chí có dữ kiện), lấy từ SO SÁNH DỰNG ĐƯỢC TỪ NGUỒN và MÓN TƯƠNG TỰ; format = table ở mọi mục H2, H3 có thể mixed. Heading nói rõ đang so sánh gì. Bắt buộc có một mục so sánh "${keyword}" với món hoặc phương án tương tự${similar.length ? ` (${similar.join(', ')})` : ' (ghi chú chưa nêu: tự chọn một đến hai món cùng loại phổ biến và chỉ so đặc điểm phổ thông)'}; nhãn "quán ngon" hoặc tương đương thì là bảng so sánh các quán theo tiêu chí; nhãn "cách chế biến" thì so sánh các cách làm hoặc biến thể. Không mục nào chỉ mô tả một đối tượng.`);
  } else {
    lines.push('- comparisonItems và comparisonCriteria để mảng rỗng, trừ mục thật sự so sánh từ hai phương án.');
  }
  lines.push('- hookIdea: ý mở bài theo kiểu viết đã chọn (khung cảnh cụ thể với story, tình huống người đọc với playbook, câu trả lời thẳng với expert).');
  lines.push('- quickSummary: 3 đến 5 kết luận dùng được ngay, mỗi ý một câu.');
  lines.push(`- faq: ${faqCount} câu hỏi người đọc thật sự hỏi trước khi quyết định, ưu tiên từ danh sách "Mọi người cũng hỏi": ${serp.peopleAlsoAsk.length ? serp.peopleAlsoAsk.join(' | ') : '(không có, tự đề xuất từ ghi chú)'}.`);
  lines.push('- nextSteps: một đến hai câu mô tả phần kết nên nói gì (việc nên làm ngay, không tóm tắt bài).');
  lines.push(`- secondaryKeywords: 5 đến 10 từ khóa phụ, kết hợp gợi ý trong ghi chú (${notes.secondaryKeywords.join(', ') || 'không có'}) và tìm kiếm liên quan (${serp.relatedSearches.join(', ') || 'không có'})${options.secondaryKeywords.length ? `, bắt buộc có: ${options.secondaryKeywords.join(', ')}` : ''}.`);
  lines.push('- tableCandidates: các so sánh có thể làm bảng (mảng rỗng nếu không có). imageIdeas: 2 đến 4 ảnh minh họa với position (sau mục nào), query tiếng Anh 2 đến 4 từ để tìm ảnh stock, alt tiếng Việt mô tả đúng.');
  lines.push(`- title 50 đến 65 ký tự chứa từ khóa; h1 có thể khác title, tự nhiên hơn; metaDescription 140 đến 158 ký tự. targetWords = ${target}.`);
  return lines.join('\n');
}

export function writePrompt(input: { keyword: string; options: RunOptions; outline: Outline }): string {
  const { keyword, options, outline } = input;
  const lines: string[] = [];
  const b = wordBudget(outline, options);
  lines.push(`Viết trọn bài về "${keyword}" theo BỐ CỤC ĐÃ DUYỆT, GHI CHÚ TƯ LIỆU và NGÂN SÁCH SỐ TỪ trong bối cảnh. Tổng số từ tối đa ${b.total}, tuyệt đối không vượt ${options.maxWords}; tính cả mở bài, các mục, FAQ và phần kết. Viết đúng ngân sách từng mục, thừa ý thì bỏ ý, không kéo dài.`);
  lines.push('', 'CÁCH VIẾT TỪNG PHẦN:');
  if (options.kind === 'roundup') lines.push(`- intro: 2 đến 3 câu, tối đa ${Math.min(b.intro, 60)} từ, đi thẳng vào việc: câu đầu có từ khóa và nói bài gồm bao nhiêu quán, chọn theo sao và số đánh giá thật trên Google Maps; câu sau nói cách dùng bài (xem bảng so sánh, chọn theo nhu cầu). Không khung cảnh, không kể chuyện, không câu hỏi tu từ, không "trong bài viết này".`);
  else lines.push(`- intro: khoảng ${b.intro} từ, mở đúng theo hookIdea bằng một khung cảnh hoặc tình huống rất cụ thể của chính người viết, hai câu đầu có từ khóa chính, câu cuối nói bài này giúp gì mà không dùng "trong bài viết này".`);
  lines.push('- quickSummary: giữ 3 đến 5 ý của bố cục, viết lại thành câu kết luận ngắn, mỗi ý dưới 20 từ.');
  lines.push('- sections: đúng thứ tự, đúng heading và level của bố cục (có thể chỉnh chữ heading cho hay hơn nhưng giữ ý). Mỗi mục đúng ngân sách từ của nó. Dùng đúng dữ kiện trong points và ghi chú; mỗi mục có ít nhất một chi tiết đời thường của người viết (thói quen, lần làm hỏng, chỗ từng nhầm) và một câu bày tỏ chính kiến có lý do. format=table thì có bảng markdown; steps thì đánh số; checklist thì gạch đầu dòng; text thì văn xuôi thuần, không gạch đầu dòng.');
  if (options.kind === 'brand') {
    lines.push('- Bài giới thiệu thương hiệu: mục "hình ảnh" chỉ một câu dẫn (ảnh tool chèn); mục "liên hệ" chỉ một đến hai câu mời (khối địa chỉ, giờ, điện thoại tool chèn); các mục còn lại 2 đến 3 đoạn văn xuôi, lời khen luôn kèm chi tiết cụ thể từ đánh giá hoặc thông tin thương hiệu; không câu than thiếu dữ liệu.');
  } else if (options.kind === 'roundup') {
    lines.push('- Bài tổng hợp quán: mục bảng so sánh gồm một câu dẫn rồi bảng markdown, mỗi hàng một quán theo thứ hạng, cột đúng comparisonCriteria, ô ngắn lấy từ ghi chú; quán không có dữ liệu ở cột nào thì để ô trống, không viết "chưa rõ". Không câu nào nói về việc thiếu dữ liệu ở bất kỳ đâu trong bài. Mục từng quán: KHÔNG viết địa chỉ, sao, giờ, link ở đầu mục (tool chèn); viết 2 đến 3 đoạn văn xuôi nói quán này khác quán khác ở đâu, điều được khen và bị chê, món nên gọi, ai hợp; nhắc sao và số đánh giá trong câu một cách tự nhiên; không kể trải nghiệm cá nhân ở quán không có ghi chú của người đặt bài. Mỗi mục quán mở đầu bằng vai riêng của quán (dòng VAI TRONG BÀI) kèm dữ kiện làm căn cứ; hai mục không mở đầu cùng kiểu câu, không lặp cùng cụm khen. Mục "quán nào hợp ai": bảng theo comparisonItems và comparisonCriteria, mỗi tình huống một quán, mỗi quán một lần. Mục "cách xếp hạng": văn xuôi ngắn, thành thật.');
  } else if (options.comparison) lines.push('- Chế độ so sánh: mục có comparisonItems thì viết đúng CHẾ ĐỘ SO SÁNH trong bối cảnh: một đến hai câu dẫn, bảng markdown với các hàng là comparisonCriteria và các cột là comparisonItems, rồi đoạn văn chốt điểm khác biệt và chính kiến. Số từ trong bảng tính vào ngân sách của mục.');
  lines.push(`- faq: trả lời từng câu khoảng ${b.faqEach} từ, thẳng vào việc, câu đầu là câu trả lời, giọng nói chuyện.`);
  lines.push(`- nextSteps: khoảng ${b.nextSteps} từ theo mô tả trong bố cục, kết bằng lời mời hoặc việc làm ngay, không tóm tắt bài, không "hy vọng bài viết".`);
  lines.push('- excerpt: một đến hai câu giới thiệu bài cho trang danh sách, có lợi ích cụ thể.');
  lines.push('- images: chép imageIdeas từ bố cục, chỉnh alt cho khớp nội dung đã viết. secondaryKeywordsUsed: từ khóa phụ đã thật sự dùng.');
  lines.push('', 'Kiểm tra lại trước khi trả về: tổng số từ dưới trần; nhịp câu lệch nhau, có câu rất ngắn và câu dài có mệnh đề chen ngang; có trợ từ khẩu ngữ; không liên từ sáo mở đầu đoạn; không cụm bị cấm; không dữ kiện ngoài ghi chú; không chuỗi câu chữ giống nguồn; từ khóa chính không quá 1 lần mỗi 120 từ.');
  return lines.join('\n');
}

export const EDITOR_CHECKLIST = `Bạn là biên tập viên kỳ cựu của tòa soạn. Hãy biên tập lại bài JSON dưới đây, giữ cấu trúc, heading, ý chính và toàn bộ dữ kiện, trả về JSON cùng cấu trúc với toàn bộ bài đã sửa.

DANH SÁCH KIỂM TRA (làm hết, không bỏ mục nào):
1. Hai câu đầu intro phải là móc câu đúng kiểu viết, có từ khóa chính. Đang mở bằng định nghĩa hoặc câu chung chung thì viết lại.
2. Phá văn máy móc, đều đều: đoạn nào có ba câu liên tiếp cùng độ dài thì cắt một câu thành câu 3 đến 6 từ và nối hai câu khác thành một câu dài có mệnh đề chen ngang; đoạn nào mở bằng liên từ sáo (Ngoài ra, Bên cạnh đó, Tuy nhiên, Do đó, Đầu tiên, Cuối cùng...) thì bỏ liên từ hoặc thay bằng cách nói tự nhiên; câu kết mỗi mục kiểu tổng kết thì xóa; cụm ba tính từ liền nhau thì giữ một và thay bằng chi tiết cụ thể; câu đối xứng kiểu "A thì X, B thì Y" chỉ giữ tối đa hai câu cả bài.
3. Xóa mọi cụm bị cấm và khẳng định quảng cáo rỗng. Thay tính từ chung ("ngon", "tuyệt vời", "chất lượng") bằng chi tiết quan sát được có trong ghi chú.
4. Đưa người viết vào bài: mỗi mục H2 có ít nhất một chi tiết đời thường của chính người viết (thói quen, lần làm hỏng, chỗ từng nhầm, câu hỏi tự đặt rồi tự trả lời); thêm chính kiến có lý do ở ít nhất ba chỗ ("tôi thích... vì", "chỗ này tôi không khuyên vì..."), thêm ít nhất hai chỗ thừa nhận giới hạn ("tùy nơi", "chưa có số liệu rõ", "cái này còn tranh cãi"); rải trợ từ khẩu ngữ ("thì", "mà", "chứ", "thôi", "kiểu", "thật ra") ở những câu đọc còn cứng. Có văn phong mẫu của người đặt bài thì bám sát cách xưng hô, nhịp và từ quen dùng của họ.
4a. Bớt gạch đầu dòng và in đậm: danh sách chỉ giữ khi thật sự là các bước hoặc checklist, tối đa hai danh sách; các danh sách khác chuyển thành văn xuôi.
5. Xóa mọi dữ kiện không có trong GHI CHÚ TƯ LIỆU (số liệu, tên, giá, năm, địa chỉ). Thay bằng cách nói về tiêu chí hoặc kinh nghiệm chung.
6. Câu chữ nào đọc giống văn nguồn (câu định nghĩa quen thuộc, câu liệt kê nguyên liệu theo đúng trật tự nguồn) thì đảo cấu trúc, đổi từ, viết lại bằng giọng cá nhân.
7. Từ khóa chính: có trong title, H1, hai câu đầu intro, một heading, phần kết; tổng không quá 1 lần mỗi 120 từ; giảm nếu vượt. Từ khóa phụ rải tự nhiên.
8. Title 50 đến 65 ký tự; metaDescription 140 đến 158 ký tự, có lợi ích và lời mời nhẹ. Độ dài toàn bài đúng khoảng yêu cầu: thiếu thì thêm chi tiết dùng được từ ghi chú; vượt số từ tối đa thì BẮT BUỘC cắt xuống dưới trần bằng cách bỏ ý phụ, gộp FAQ trùng, rút ngắn mục dài nhất, không được để nguyên.
9. Chính tả, dấu câu, xưng hô nhất quán theo ngôi kể đã chọn. Không gạch ngang dài, không chấm phẩy, không thẻ HTML, không heading # trong body.
10. Bảng, checklist, callout chỉ giữ khi thật sự cần; bỏ khối nào chỉ để cho có.`;

export function editPrompt(input: { article: Article; feedback: string[]; options: RunOptions }): string {
  const lines: string[] = [EDITOR_CHECKLIST];
  if (input.options.kind === 'brand') lines.push('', 'BÀI GIỚI THIỆU THƯƠNG HIỆU: mở bài đi thẳng 2 đến 3 câu; giữ nguyên các dòng "**Địa chỉ:**", "**Giờ mở cửa:**", "**Liên hệ:**", "**Đánh giá:**" và dòng ảnh "![" nguyên văn; xóa câu than thiếu dữ liệu; lời khen không có chi tiết cụ thể thì thay bằng chi tiết từ ghi chú hoặc bỏ; mục 4 về "chi tiết đời thường" không áp dụng.');
  if (input.options.kind === 'roundup') lines.push('', 'BÀI TỔNG HỢP QUÁN: mục 1 của danh sách kiểm tra đổi thành: mở bài phải đi thẳng vào việc trong 2 đến 3 câu (số quán, tiêu chí chọn, cách dùng bài), câu đầu có từ khóa; đang mở bằng khung cảnh, kể chuyện hay câu hỏi tu từ thì viết lại cho thẳng. Giữ nguyên heading chứa tên quán và số thứ hạng; giữ các dòng bắt đầu bằng "**Địa chỉ:**", "**Giờ mở cửa:**", "**Liên hệ:**", "**Đánh giá:**" và dòng ảnh "![" nguyên văn; giữ bảng so sánh và bảng "hợp ai"; xóa mọi câu kể trải nghiệm cá nhân ở quán không có ghi chú của người đặt bài (mục 4 về "chi tiết đời thường" không áp dụng cho kiểu bài này, thay bằng chính kiến khi đối chiếu đánh giá). XÓA HẲN mọi câu nói về việc thiếu dữ liệu ("tư liệu chưa có", "chưa thể xác định", "chưa có dữ liệu giá"...), xóa cột bảng mà mọi ô đều "chưa rõ", xóa FAQ hỏi về điều không có dữ liệu; không thay bằng câu cùng ý.');
  else if (input.options.comparison) lines.push('', 'CHẾ ĐỘ SO SÁNH đang bật: mục 4a và mục 10 không áp dụng cho bảng so sánh. Giữ mọi bảng, chỉ sửa câu chữ trong ô và văn xuôi quanh bảng; mục nào mất bảng hoặc thành mô tả một đối tượng thì dựng lại bảng theo bố cục.');
  if (input.feedback.length) lines.push('', 'LỖI DO CỔNG KIỂM DUYỆT CHỈ RA (bắt buộc sửa hết các mục BẮT BUỘC, nên sửa các mục còn lại):', ...input.feedback.map((f) => `- ${f}`));
  lines.push('', `Độ dài yêu cầu: ${input.options.minWords} đến ${input.options.maxWords} từ. Bài hiện có khoảng ${articleWords(input.article)} từ.`);
  lines.push('', 'BÀI CẦN BIÊN TẬP (JSON):', JSON.stringify(input.article, null, 1));
  return lines.join('\n');
}

export function fixPrompt(input: { article: Article; feedback: string[]; flaggedTexts: string[]; round: number; options: RunOptions }): string {
  const lines: string[] = [];
  lines.push(`VÒNG SỬA ${input.round}. Bài dưới đây chưa đạt kiểm tra. Hãy sửa đúng những chỗ được chỉ ra, giữ nguyên các phần còn lại (chép lại nguyên văn), giữ toàn bộ dữ kiện, và trả về JSON toàn bài cùng cấu trúc.`);
  if (input.flaggedTexts.length) {
    lines.push('', 'CÁC CÂU BIÊN TẬP CHÊ LÀ ĐỌC GIỐNG VĂN MÁY, đều đều, thiếu người viết (viết lại từng câu hoàn toàn khác: đổi cấu trúc, đổi độ dài, kể bằng giọng nói chuyện có trợ từ, thêm chi tiết đời thường hoặc nhận xét cá nhân có lý do, có thể tách một câu thành hai hoặc gộp với câu kề bên; không được giữ nguyên trật tự từ):');
    for (const t of input.flaggedTexts) lines.push(`- "${t}"`);
    lines.push('Cũng viết lại cả đoạn chứa các câu trên chứ không chỉ một câu: nếu các câu kề bên cùng nhịp, cùng cấu trúc thì đổi luôn để cả đoạn đọc như một người đang kể.');
  } else if (input.feedback.some((f) => f.includes('văn máy'))) {
    lines.push('', 'Bài bị chê đọc còn giống văn máy nhưng không chỉ rõ câu nào: hãy viết lại toàn bộ mở bài và ít nhất hai mục dài nhất bằng giọng kể chuyện thân mật hơn hẳn (trợ từ khẩu ngữ, câu cụt, câu hỏi tự trả lời, chi tiết đời thường của người viết, một chỗ đổi ý giữa chừng), giữ nguyên dữ kiện và heading.');
  }
  if (input.feedback.length) lines.push('', 'LỖI CẦN SỬA:', ...input.feedback.map((f) => `- ${f}`));
  lines.push('', `NGUYÊN TẮC KHI SỬA: không thêm dữ kiện ngoài ghi chú; không dùng cụm bị cấm; không liên từ sáo mở đầu đoạn; xen câu 3 đến 6 từ với câu dài; giữ ngôi kể và kiểu viết; heading giữ nguyên trừ khi bị báo lỗi; tổng số từ không vượt trần${input.options.kind === 'roundup' ? '; giữ nguyên heading chứa tên quán, các dòng "**Địa chỉ:**", "**Đánh giá:**", dòng ảnh và các bảng; không kể trải nghiệm cá nhân ở quán không có ghi chú của người đặt bài' : input.options.comparison ? '; giữ nguyên các bảng so sánh, chỉ sửa văn xuôi quanh bảng và câu chữ trong ô' : ''}.`);
  lines.push('', `Độ dài yêu cầu: ${input.options.minWords} đến ${input.options.maxWords} từ. Bài hiện có khoảng ${articleWords(input.article)} từ.`);
  lines.push('', 'BÀI HIỆN TẠI (JSON):', JSON.stringify(input.article, null, 1));
  return lines.join('\n');
}

export function reviewPrompt(input: { article: Article; options: RunOptions }): string {
  const lines: string[] = [];
  lines.push('Kiểm chứng bài dưới đây. Chỉ báo các lỗi KIỂM CHỨNG ĐƯỢC sau, mỗi lỗi ghi where (intro, sections.2, faq.1, title...), problem, fix và quote:');
  lines.push('1. Dữ kiện không có trong GHI CHÚ TƯ LIỆU: số liệu, tên riêng, giá, năm, địa chỉ, giờ mở, trích dẫn, giải thưởng → major.');
  lines.push('2. Số liệu trong văn xuôi khác ghi chú (sao, số lượt đánh giá, giá, giờ) → major.');
  lines.push('3. Cả một đoạn giống văn nguồn hoặc văn mẫu quen thuộc (định nghĩa sách giáo khoa, liệt kê theo trật tự quen) → major.');
  lines.push('4. Thiếu mục quan trọng của bố cục, hoặc bài trả lời sai ý định tìm kiếm của từ khóa → major; problem bắt đầu bằng chữ "Thiếu" hoặc "Sai ý định".');
  if (input.options.kind === 'brand') lines.push('5. Bài giới thiệu thương hiệu: dữ kiện về thương hiệu không có trong ghi chú (năm, giải thưởng, giá, món) hoặc câu than thiếu dữ liệu → major.');
  if (input.options.kind === 'roundup') lines.push('5. Bài tổng hợp quán: mục quán nào kể trải nghiệm cá nhân (đã ăn, đã ghé, chủ quán nói) mà ghi chú không có GHI CHÚ CỦA NGƯỜI ĐẶT BÀI cho quán đó → major; thiếu mục cho một quán trong danh sách hoặc thiếu bảng so sánh → major (problem bắt đầu bằng "Thiếu").');
  else if (input.options.comparison) lines.push('5. Chế độ so sánh 100%: mục H2 nào không đối chiếu từ hai đối tượng trở lên hoặc không có bảng so sánh → major (problem bắt đầu bằng "Thiếu").');
  lines.push('KHÔNG BÁO các điểm về phong cách: văn máy, đều đều, sáo, câu cụt, độ dài, nhịp câu, FAQ có thể hay hơn, mục hơi khô, title hay meta. Những điểm đó do công cụ khác kiểm; đưa vào issues sẽ bị bỏ.');
  lines.push('QUOTE BẮT BUỘC: quote là một câu chép nguyên văn từ bài (không sửa chữ, không rút gọn, không dịch), câu chứa dữ kiện sai hoặc câu kể trải nghiệm bịa. Lỗi không có quote đúng nguyên văn sẽ bị mã loại bỏ. Chỉ lỗi loại "Thiếu" hoặc "Sai ý định" được để quote rỗng.');
  lines.push('Chỉ liệt kê lỗi major; issues để mảng rỗng nếu không có. pass = true khi issues rỗng. summary: hai đến ba câu nói bài dựa đúng ghi chú tới đâu.');
  lines.push('', `Ngôi kể yêu cầu: ${input.options.voice}; từ vựng: ${input.options.dialect}.`);
  lines.push('', 'BÀI CẦN KIỂM CHỨNG (JSON):', JSON.stringify(input.article, null, 1));
  return lines.join('\n');
}

/** Vòng sửa có mục tiêu: chỉ các phần bị lỗi, phần còn lại giữ nguyên bằng mã. */
export function patchPrompt(input: { article: Article; targets: PatchTarget[]; hints?: string[]; round: number; options: RunOptions }): string {
  const a = input.article;
  const lines: string[] = [];
  lines.push(`VÒNG SỬA ${input.round}, SỬA ĐÚNG CHỖ. Chỉ viết lại ${input.targets.length} phần liệt kê dưới đây theo lỗi đã nêu. Phần còn lại của bài được giữ nguyên bằng mã, bạn không cần và không được trả lại.`);
  lines.push('', `Bài: title "${a.title}", H1 "${a.h1}", từ khóa "${a.targetKeyword}". Các mục của bài để giữ mạch: ${a.sections.map((s, i) => `sections.${i} "${s.heading}"`).join('; ')}.`);
  lines.push('', 'NGUYÊN TẮC: giữ toàn bộ dữ kiện đúng, không thêm dữ kiện ngoài ghi chú; markdown đơn giản, tuyệt đối không thẻ HTML; giữ nguyên các dòng bắt đầu bằng "**Địa chỉ:**", "**Giờ mở cửa:**", "**Liên hệ:**", "**Đánh giá:**", dòng ảnh "![" và các bảng "|" (chỉ sửa chữ trong ô nếu được yêu cầu); không dùng cụm bị cấm, không liên từ sáo mở đầu đoạn; xen câu ngắn với câu dài; giữ ngôi kể và kiểu viết; tôn trọng số từ yêu cầu của từng phần; heading chỉ đổi khi lỗi nói về heading, còn lại để heading rỗng.');
  if (input.options.kind === 'roundup') lines.push('Bài tổng hợp quán: không kể trải nghiệm cá nhân ở quán không có ghi chú của người đặt bài; không nói về việc thiếu dữ liệu.');
  if (input.hints?.length) lines.push('', 'GỢI Ý CHUNG (không bắt buộc, áp dụng trong các phần đang sửa nếu hợp):', ...input.hints.map((h) => `- ${h}`));
  for (const t of input.targets) {
    lines.push('', `=== ${t.where}${t.heading ? ` (heading: "${t.heading}")` : ''} ===`);
    lines.push('LỖI CẦN SỬA:', ...t.feedback.map((f) => `- ${f}`));
    lines.push(`VĂN BẢN HIỆN TẠI (${wordCount(t.current)} từ):`, t.current || '(trống)');
  }
  lines.push('', `TRẢ VỀ JSON: {"patches":[{"where":"...","heading":"","text":"..."}]} với đúng ${input.targets.length} phần tử, where chép đúng như trên; text là toàn văn phần đó sau khi sửa (với faq.N là câu trả lời, với title/metaDescription/h1/excerpt là một dòng).`);
  return lines.join('\n');
}
export function classifyPlacesPrompt(input: { dish: string; area: string; places: { index: number; name: string; type: string; types: string[]; address: string; description: string }[] }): string {
  const lines: string[] = [];
  lines.push(`Món hoặc loại quán cần tìm: "${input.dish}". Khu vực: "${input.area}".`);
  lines.push('Với mỗi quán dưới đây, trả về: index (giữ nguyên), matchesDish (quán có bán món hoặc thuộc loại quán này không: dựa vào tên, loại hình, mô tả; quán ăn tổng hợp có tên nhắc món thì true; quán rõ ràng bán món khác thì false), inArea (địa chỉ có thuộc khu vực này không, kể cả cách viết khác như "Phan Rang-Tháp Chàm" cho "Phan Rang"; địa chỉ thiếu thì true), groupKey (các chi nhánh cùng một thương hiệu, cùng tên gốc, khác số hoặc địa chỉ thì cùng một groupKey là tên gốc viết thường; quán độc lập thì để chuỗi rỗng).');
  lines.push('', 'DANH SÁCH QUÁN:');
  for (const p of input.places) lines.push(`${p.index}. ${p.name} | loại: ${p.type}${p.types.length ? ` (${p.types.join(', ')})` : ''} | địa chỉ: ${p.address || '(không có)'}${p.description ? ` | mô tả: ${p.description.slice(0, 200)}` : ''}`);
  return lines.join('\n');
}

export function assignRolesPrompt(input: { dish: string; area: string; places: PlaceForRole[] }): string {
  const lines: string[] = [];
  lines.push(`${input.places.length} quán ${input.dish} ở ${input.area} dưới đây sẽ vào một bài tổng hợp, mỗi quán một mục. Gán cho MỖI quán một VAI RIÊNG để mục của quán đó khác hẳn các quán khác.`);
  lines.push('Với mỗi quán trả về: index (giữ nguyên), role (cụm dưới 10 từ, viết thường, rút từ đúng dữ liệu của quán và so với các quán còn lại, có số liệu khi được: "lâu năm, đông khách nhất với 2.208 lượt", "giá mềm nhất", "mở sớm nhất, từ 5 giờ", "mở khuya duy nhất", "tô khô được nhắc nhiều nhất", "hợp đi nhóm đông"), reason (một câu nêu dữ kiện làm căn cứ, dưới 30 từ), bestFor (một tình huống cụ thể mà quán này là lựa chọn số một, dưới 10 từ: "ăn sáng trước 6 giờ", "ngân sách dưới 40.000 đ", "đi 5 người cuối tuần").');
  lines.push('RÀNG BUỘC: không hai quán trùng role hay trùng bestFor; không bịa dữ kiện ngoài phần dưới; quán không có gì nổi trội thì lấy vai từ điểm được khen riêng hoặc vị trí (đường, phường) của nó. Không dùng thuật ngữ thống kê.');
  lines.push('', 'DỮ LIỆU TỪNG QUÁN:');
  for (const p of input.places) {
    const bits = [`${p.rating.toFixed(1)} sao`, `${p.reviews} lượt đánh giá`];
    if (p.price) bits.push(`giá ${p.price}`);
    if (p.openingHours) bits.push(`giờ mở ${p.openingHours}`);
    if (p.type) bits.push(`loại hình ${p.type}`);
    lines.push(`${p.index}. ${p.name} | ${bits.join(' | ')}`);
    if (p.summary) {
      if (p.summary.signature.length) lines.push(`   đặc trưng: ${p.summary.signature.join('; ')}`);
      if (p.summary.praised.length) lines.push(`   khen: ${p.summary.praised.join('; ')}`);
      if (p.summary.complained.length) lines.push(`   chê: ${p.summary.complained.join('; ')}`);
      if (p.summary.bestFor.length) lines.push(`   hợp: ${p.summary.bestFor.join('; ')}`);
    }
    if (p.userNote) lines.push(`   ghi chú người đặt bài: ${p.userNote}`);
  }
  return lines.join('\n');
}

export function summarizeReviewsPrompt(input: { dish: string; area: string; places: { index: number; name: string; reviews: { rating: number; date: string; text: string }[] }[] }): string {
  const lines: string[] = [];
  lines.push(`Các quán ${input.dish} ở ${input.area} dưới đây kèm đánh giá công khai trên Google Maps. Với mỗi quán trả về: index (giữ nguyên), praised (2 đến 5 ý được khen, mỗi ý dưới 15 từ, cụ thể: món, nước dùng, phần ăn, giá, phục vụ, chỗ ngồi), complained (0 đến 3 ý bị chê, thành thật, để mảng rỗng nếu không có), signature (1 đến 3 món hoặc điểm đặc trưng được nhắc nhiều), bestFor (1 đến 3 tình huống hợp: ăn sáng, gia đình, ăn khuya, ngân sách thấp...), oneLine (một câu tóm tắt trung tính dưới 30 từ). Chỉ dùng điều đánh giá nói; đánh giá quá ít hoặc quá ngắn thì ghi ít ý. Không chép nguyên văn, không nêu tên người đánh giá.`);
  for (const p of input.places) {
    lines.push('', `########## QUÁN ${p.index}: ${p.name} (${p.reviews.length} đánh giá)`);
    for (const r of p.reviews) lines.push(`- [${r.rating}/5${r.date ? `, ${r.date.slice(0, 10)}` : ''}] ${r.text.replace(/\s+/g, ' ').slice(0, 600)}`);
  }
  return lines.join('\n');
}

export function translatePrompt(keyword: string): string {
  return `Dịch từ khóa tìm kiếm tiếng Việt sau sang cụm từ khóa tiếng Anh mà người dùng Google quốc tế hay gõ, giữ tên riêng, không giải thích: "${keyword}"`;
}

function articleWords(a: Article): number {
  return [a.intro, ...a.sections.map((s) => s.body), ...a.faq.map((f) => f.answer), a.nextSteps].reduce((n, t) => n + wordCount(t), 0);
}
