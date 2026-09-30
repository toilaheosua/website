import type { AiDetector, ContentLlm, FetchedPage, LlmRunContext, MapsProvider, PageFetcher, PlaceClassification, PlaceForClassify, PlaceForRole, RawPlace, SearchProvider, SourceForLlm } from './types.js';
import type { AiDetectReport, AiReview, Article, Outline, PlaceReview, PlaceReviewSummary, PlaceRole, ResearchNotes, SerpData, UsageTotals } from '../core/types.js';
import { emptyUsage } from '../core/types.js';
import { normText, nowIso, sha256, slugify, sleep, wordCount } from '../core/util.js';
import { resolveContentStyle } from '../generator/content-styles.js';
import { addressInArea, normalizeGroupKey } from '../core/roundup.js';
import { articleWordCount } from '../generator/quality.js';

/**
 * Bản mô phỏng của mọi dịch vụ ngoài: chạy được toàn bộ pipeline trong vài giây, không tốn tiền, không gọi ra ngoài.
 * Văn bản sinh ra cố ý đa dạng nhịp câu để qua được cổng chất lượng.
 */

const MOCK_DELAY = Number(process.env.MOCK_DELAY_MS ?? 120);

const SENTENCE_TEMPLATES: ((kw: string, n: number) => string)[] = [
  (kw) => `Tôi từng nghĩ ${kw} ở đâu cũng na ná nhau, cho tới khi thử vài chỗ khác nhau trong cùng một tuần và nhận ra mỗi nơi giữ một cách làm riêng.`,
  () => 'Khoan, chỗ này dễ nhầm.',
  (kw, n) => `Điểm đầu tiên tôi để ý là cách người ta xử lý phần nền của ${kw}: có nơi làm rất kỹ, có nơi chỉ qua loa, và cái đó lộ ra ngay ở lần nếm thứ ${n + 1}.`,
  () => 'Tùy nơi thôi.',
  (kw) => `Nếu bạn mới tìm hiểu ${kw}, đừng vội tin lời quảng cáo, hãy nhìn vào cách làm.`,
  () => 'Nói thật là tôi không khuyên cách làm vội, bởi phần nền chưa kịp ngấm thì mọi thứ phía sau đều nhạt.',
  (kw, n) => `Có ${n + 2} chi tiết nhỏ quyết định ${kw} có đáng tiền hay không, và không chi tiết nào nằm ở phần trang trí.`,
  () => 'Màu phải trong, mùi phải sạch, và nhiệt độ lúc mang ra phải còn nóng.',
  (kw) => `Người làm lâu năm hay bảo rằng ${kw} ngon hay không nằm ở kiên nhẫn chứ không ở bí quyết nào cả.`,
  () => 'Cái này còn tranh cãi.',
  (kw) => `Tôi thích kiểu ${kw} làm chậm vì vị ngọt tự nhiên rõ hơn, dù phải chờ lâu hơn một chút.`,
  () => 'Chờ thêm mười phút thì đáng.',
  (kw, n) => `Giá thì dao động, chỗ tôi hay ghé bán tầm ${30 + n * 5} đến ${45 + n * 5} nghìn một phần, còn ở khu trung tâm thường nhích lên thêm.`,
  () => 'Đừng chỉ nhìn giá.',
  (kw) => `Một sai lầm quen thuộc khi chọn ${kw} là chỉ nhìn phần bày lên trên mà bỏ qua phần nền phía dưới, vốn mới là chỗ tốn công nhất.`,
  () => 'Để ý một chút: nơi làm kỹ thường không cần trang trí nhiều.',
  (kw) => `Bạn thử hình dung một buổi sáng đứng chờ ${kw} ở một góc chợ, mùi hành phi lan ra, tiếng muỗng chạm tô, sẽ hiểu vì sao người ta quay lại.`,
  () => 'Tôi không chắc mọi người đồng ý điểm này.',
  (kw) => `Về nguyên liệu, ${kw} chuẩn cần vài thứ cơ bản mà chỗ nào cũng có, khác nhau ở tỷ lệ và thời gian.`,
  () => 'Thời gian mới là thứ đắt.',
];

const OPENERS = ['Nói thật là', 'Có một chỗ dễ nhầm.', 'Tôi để ý', 'Khoan.', 'Cái hay ở đây là', 'Bạn thử hình dung', 'Nhiều người bỏ qua chuyện này.', 'Chuyện giá cả thì tùy.', 'Kinh nghiệm của tôi:', 'Ở đây có một mẹo.'];

/** Câu mẫu riêng cho trang nguồn mô phỏng, khác hẳn câu của bài để bước so trùng không báo nhầm. */
const SOURCE_TEMPLATES: ((kw: string, n: number) => string)[] = [
  (kw) => `${kw} được nhiều tài liệu ghi nhận là món có gốc gác từ cộng đồng người Hoa ở Phnom Penh, sau đó theo chân người di cư xuống miền Tây rồi lên Sài Gòn.`,
  (kw, n) => `Theo khảo sát của trang này, một phần ${kw} tại khu trung tâm có giá từ ${35 + n * 5} đến ${55 + n * 5} nghìn đồng, còn ở các quận vùng ven rẻ hơn khoảng một phần ba.`,
  (kw) => `Thành phần thường thấy của ${kw} gồm sợi hủ tiếu dai, thịt bằm, tim, gan, tôm, trứng cút và hành phi, ăn kèm giá sống, cần tây và tỏi ngâm.`,
  () => 'Nước lèo được ninh từ xương ống và khô mực trong nhiều giờ, hớt bọt liên tục để giữ độ trong.',
  (kw) => `Người viết khuyên nên thử ${kw} khô trước vì phần nước chấm và nước lèo tách riêng cho thấy rõ tay nghề của quán.`,
  (kw) => `Một điểm khác biệt của ${kw} so với hủ tiếu Mỹ Tho nằm ở sợi: bản Nam Vang dùng sợi nhỏ, mềm hơn, còn Mỹ Tho dùng sợi to, dai và trong.`,
  (kw, n) => `Trang này liệt kê ${5 + n} địa chỉ quen ở quận 5, quận 11 và Bình Thạnh, phần lớn mở từ sáng sớm đến trưa.`,
  () => 'Tác giả lưu ý rằng tỏi ngâm giấm và ớt sa tế là hai thứ quyết định phần lớn hương vị, không phải chỉ nước lèo.',
  (kw) => `Bài viết kết luận rằng ${kw} ngon phải có vị ngọt hậu từ xương chứ không phải từ đường hay bột ngọt, và sợi phải được trụng vừa tới.`,
  () => 'Thời gian chuẩn bị một nồi nước lèo chuẩn theo trang này là từ bốn đến sáu giờ, tính cả lúc sơ chế xương.',
];

function sourceParagraph(kw: string, seed: number, count: number): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) parts.push(SOURCE_TEMPLATES[(seed * 3 + i * 7) % SOURCE_TEMPLATES.length]!(kw, (seed + i) % 5));
  return parts.join(' ');
}

/** Đoạn văn mô phỏng: số câu và bước chọn câu lệch theo seed để hai đoạn có seed khác nhau (dưới 60) không bao giờ trùng nguyên văn. */
function paragraph(kw: string, seed: number, count: number): string {
  const n = count + (seed % 3);
  const step = 3 + (seed % 4);
  const start = seed * 7 + count * 5;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = SENTENCE_TEMPLATES[(start + i * step) % SENTENCE_TEMPLATES.length]!;
    parts.push(t(kw, (seed + i) % 5));
  }
  // Trộn thêm hàng chục vào chỉ số để các mục quán (seed cách nhau 5) không mở đầu cùng một câu
  const opener = OPENERS[(seed + Math.floor(seed / 10)) % OPENERS.length]!;
  return `${opener} ${parts.join(' ')}`;
}

/** Mỗi mục quán trong bài tổng hợp mô phỏng một đoạn văn riêng: câu mở khác nhau, không dùng chung cụm năm chữ, để qua kiểm tra "mục quán không trùng khuôn". */
const PLACE_PARAGRAPHS: ((name: string, kw: string) => string[])[] = [
  (n, kw) => [`${n} đông nhất danh sách, hơn nghìn lượt đánh giá mà sao vẫn giữ cao. Điều đó với tôi đáng tin hơn mọi lời khen lẻ tẻ. Người quen ở đây bảo sáng nào cũng kín bàn, và số lượt trên Google Maps xác nhận chuyện đó.`, `Món hay được gọi là tô nước, xương hầm lâu, vị ngọt tự nhiên chứ không gắt. Ai mới ăn ${kw} lần đầu nên bắt đầu từ đây.`, `Chỗ bị chê đi chê lại là chờ lâu giờ cao điểm. Tôi sẽ đi trước bảy giờ hoặc sau chín giờ.`],
  (n, kw) => [`Sao cao nhất bảng thuộc về ${n}, dù số lượt ít hơn quán đầu. Khách khen sợi trụng tới, không bở, nước chấm pha khéo. Với tôi đó là dấu hiệu bếp làm đều tay.`, `Tô khô ở đây có tỏi ngâm giấm tự làm, được nhắc trong nhiều đánh giá. Ăn ${kw} kiểu khô mà tỏi không giòn thì hỏng, ở đây thì ổn.`, `Điểm trừ là chỗ ngồi chật, đi nhóm bốn người trở lên hơi khó xếp bàn.`],
  (n, kw) => [`Nếu cần ăn sáng trước sáu giờ, ${n} mở sớm hơn phần còn lại. Đánh giá gần đây nhắc chuyện mở cửa từ tờ mờ sáng và bán tới trưa là nghỉ.`, `Phần ăn được khen đầy đặn so với giá, trứng cút và thịt bằm cho nhiều. Tô ${kw} đặc biệt no tới trưa, theo lời một khách đi công tác.`, `Nước lèo hôm đông khách có lúc hơi mặn, vài người ghi nhận. Gọi thêm chén nước dùng riêng là cách tôi hay làm.`],
  (n, kw) => [`${n} là nơi tôi chỉ cho gia đình có trẻ nhỏ. Bàn rộng, có bánh mì chấm nước lèo cho bé, trà đá miễn phí, nhiều đánh giá nhắc đúng mấy điều này.`, `Chủ quán nhớ mặt khách quen và hay hỏi thăm, chi tiết nhỏ nhưng làm người ta quay lại. Với ${kw}, cảm giác được đón tiếp đôi khi quan trọng ngang hương vị.`, `Chỗ để xe hẹp, cuối tuần phải gửi bên ngoài, tính thêm vài phút.`],
  (n, kw) => [`Giá ở ${n} mềm nhất trong tám quán, tô thường ba mươi lăm, tô đặc biệt bốn mươi lăm nghìn, số do khách kể lại. Rau sống tươi, có giá trụng sẵn.`, `Vị nước lèo thiên ngọt, hợp người miền Tây, người thích mặn có thể thấy lạ. Đây là bản ${kw} gần kiểu Sa Đéc nhất mà tôi thấy trong danh sách.`, `Không gian đơn giản, quạt trần, nóng vào trưa hè.`],
  (n, kw) => [`${n} bán từ chiều tới khuya, gần một giờ sáng mới đóng, là chỗ duy nhất trong bảng cho người ăn muộn. Đánh giá phần lớn của khách đi làm ca hoặc đi chơi về trễ.`, `Tô khô trộn tương đen là món được nhắc nhiều, phục vụ nhanh dù đông. Ăn ${kw} lúc mười một giờ đêm mà vẫn nóng hổi là điểm cộng lớn.`, `Đèn đường khu này tối, đi xe máy nên cẩn thận đoạn quẹo vào.`],
  (n, kw) => [`Ít lượt hơn các quán trên nhưng ${n} có tỉ lệ khen về độ sạch cao nhất: bàn lau kỹ, chén đũa khô, bếp nhìn thấy được. Người kỹ tính sẽ thích.`, `Nước lèo trong, hành phi thơm, thịt thái mỏng. Đây là tô ${kw} thanh nhất trong danh sách, hợp người ăn nhẹ buổi sáng.`, `Phần ăn hơi ít với người ăn khỏe, gọi thêm quẩy là vừa.`],
  (n, kw) => [`${n} đứng cuối bảng nhưng tôi vẫn giữ lại vì một lý do: nó ở ngay trung tâm, đi bộ từ chợ qua được, và ổn định qua nhiều năm đánh giá.`, `Không có món nào nổi bật hẳn, mọi thứ đều ở mức khá. Khi quán đầu bảng hết chỗ, đây là phương án dự phòng cho bữa ${kw} không cần suy nghĩ nhiều.`, `Giờ mở cửa thất thường theo vài đánh giá, nên gọi trước khi đi xa tới.`],
];

function placeBody(heading: string, kw: string, i: number): string {
  const name = heading.replace(/^\d+\.\s*/, '').split(':')[0]!.trim();
  return PLACE_PARAGRAPHS[i % PLACE_PARAGRAPHS.length]!(name, kw).join('\n\n');
}

function sectionBody(kw: string, seed: number): string {
  return [paragraph(kw, seed, 3), paragraph(kw, seed + 3, 3), paragraph(kw, seed + 6, 3)].join('\n\n');
}

/**
 * Bỏ nguyên đoạn cuối của mục dài nhất cho tới khi bài nằm dưới trần độ dài.
 * Bỏ cả đoạn (không cắt câu) để không vô tình tạo ra hai đoạn giống nhau.
 */
function fitLength(a: Article, min: number, max: number): Article {
  const ceiling = Math.max(min + 50, max - 120);
  let guard = 0;
  while (articleWordCount(a) > ceiling && guard++ < 100) {
    let idx = -1;
    let best = 0;
    const isProse = (b: string) => !b.trim().startsWith('|') && !b.trim().startsWith('![') && !b.trim().startsWith('**Địa chỉ');
    a.sections.forEach((s, i) => {
      const prose = s.body.split('\n\n').filter(isProse);
      const w = prose.reduce((n, b) => n + wordCount(b), 0);
      if (prose.length > 1 && w > best) {
        best = w;
        idx = i;
      }
    });
    if (idx < 0) break;
    const blocks = a.sections[idx]!.body.split('\n\n');
    for (let j = blocks.length - 1; j >= 0; j--) {
      if (isProse(blocks[j]!)) {
        blocks.splice(j, 1);
        break;
      }
    }
    a.sections[idx]!.body = blocks.join('\n\n');
  }
  return a;
}

const CELLS = ['làm kỹ, chậm', 'nhanh, hay đục', 'tùy nơi', 'chưa rõ', 'nhỉnh hơn một chút', 'rẻ hơn, phần nhỏ', 'sáng sớm tới trưa', 'trong và ngọt hậu', 'sợi nhỏ, mềm', 'sợi to, dai'];

/** Bảng so sánh mô phỏng cho mục có comparisonItems: cột đầu là tiêu chí, các cột sau là đối tượng. */
function comparisonTable(s: Outline['sections'][number], seed: number): string {
  const head = `| Tiêu chí | ${s.comparisonItems.join(' | ')} |`;
  const sep = `|${'---|'.repeat(s.comparisonItems.length + 1)}`;
  const rows = s.comparisonCriteria.map((c, r) => `| ${c} | ${s.comparisonItems.map((_, k) => CELLS[(seed + r * 3 + k * 5) % CELLS.length]).join(' | ')} |`);
  const [a, b] = s.comparisonItems;
  return `Tôi đặt ${a} cạnh ${b} cho dễ nhìn, vì ${s.comparisonCriteria[0] ?? 'chỗ khác nhau'} là điểm hai bên lệch nhau rõ nhất.\n\n${[head, sep, ...rows].join('\n')}`;
}

/** Bố cục mô phỏng: mỗi mục có nhãn; chế độ so sánh thì mọi H2 có đối tượng so sánh và dạng bảng. */
function mockSections(kw: string, comparison: boolean): Outline['sections'] {
  const base: Outline['sections'] = [
    { heading: `Vì sao ${kw} mỗi nơi mỗi khác`, level: 2, goal: 'Giải thích khác biệt', points: ['Cách làm phần nền', 'Thời gian chuẩn bị'], sourceRefs: [1, 2], format: 'text', tag: 'cách chế biến', comparisonItems: ['bản khô', 'bản nước'], comparisonCriteria: ['nước lèo', 'sợi', 'giá'] },
    { heading: 'Dấu hiệu nhận biết chỗ làm kỹ', level: 2, goal: 'Hướng dẫn nhận biết', points: ['Màu trong', 'Mùi sạch', 'Nhiệt độ'], sourceRefs: [2, 3], format: 'text', tag: 'quán ngon', comparisonItems: ['quán trung tâm', 'quán vùng ven'], comparisonCriteria: ['giá', 'giờ mở', 'phần ăn'] },
    { heading: 'Ba chi tiết nhỏ hay bị bỏ qua', level: 3, goal: 'Đi sâu', points: ['Chi tiết 1', 'Chi tiết 2'], sourceRefs: [3], format: 'text', tag: 'quán ngon', comparisonItems: [], comparisonCriteria: [] },
    { heading: 'Giá hợp lý ở từng khu vực', level: 2, goal: 'Định hướng giá', points: ['Khoảng giá', 'Khu trung tâm'], sourceRefs: [4, 5], format: 'text', tag: 'giá', comparisonItems: ['khu trung tâm', 'vùng ven'], comparisonCriteria: ['giá một phần', 'phần ăn'] },
    { heading: 'Sai lầm quen thuộc khi mới thử', level: 2, goal: 'Tránh lỗi', points: ['Nhìn phần trên', 'Ăn vội'], sourceRefs: [6], format: 'text', tag: 'sai lầm thường gặp', comparisonItems: ['cách chọn đúng', 'sai lầm hay gặp'], comparisonCriteria: ['nhìn gì trước', 'thời gian', 'giá'] },
    { heading: `${kw} so với hủ tiếu Mỹ Tho`, level: 2, goal: 'So sánh món tương tự', points: ['Sợi', 'Nước lèo'], sourceRefs: [6], format: 'text', tag: 'so sánh với món tương tự', comparisonItems: [kw, 'hủ tiếu Mỹ Tho'], comparisonCriteria: ['sợi', 'nước lèo', 'cách ăn'] },
  ];
  if (!comparison) return base.map((s) => ({ ...s, comparisonItems: [], comparisonCriteria: [] }));
  return base.map((s) => (s.level === 2 && s.comparisonItems.length ? { ...s, format: 'table' } : s));
}

/* ------------------------------------------------------------------ */

export class MockSearchProvider implements SearchProvider {
  readonly id = 'mock' as const;
  async search(keyword: string, o: { language: 'vi' | 'en'; count: number; page?: number }): Promise<SerpData> {
    await sleep(MOCK_DELAY);
    const slug = slugify(keyword);
    const page = o.page ?? 0;
    // Trang đầu có hai kết quả mạng xã hội xen giữa (giống Google thật) để thử việc bỏ qua và lật trang; trang 2 là 10 bài web nữa; sau đó hết
    const organic =
      page > 1
        ? []
        : Array.from({ length: 10 }, (_, i) => {
            const n = page * 10 + i + 1;
            if (page === 0 && i === 2) return { position: i + 1, title: `${keyword} video review`, link: `https://www.tiktok.com/@mock/video/${n}`, snippet: 'Video ngắn' };
            if (page === 0 && i === 6) return { position: i + 1, title: `Hỏi chỗ ăn ${keyword}`, link: `https://www.facebook.com/groups/mock/posts/${n}`, snippet: 'Bài đăng nhóm' };
            return {
              position: i + 1,
              title: `${keyword}: ${['nguồn gốc và cách phân biệt', 'công thức chuẩn', 'ăn ở đâu ngon', 'giá tham khảo', 'kinh nghiệm chọn', 'sai lầm thường gặp', 'lịch sử', 'biến thể theo vùng', 'hỏi đáp', 'so sánh'][i % 10]}`,
              link: `https://mock-${n}.example.vn/${slug}-${n}`,
              snippet: `Bài viết mô phỏng số ${n} về ${keyword} với các dữ kiện dùng để thử pipeline.`,
            };
          });
    return {
      provider: 'mock',
      keyword,
      language: o.language,
      organic,
      peopleAlsoAsk: [`${keyword} có nguồn gốc từ đâu?`, `${keyword} gồm những gì?`, `${keyword} khác món tương tự ở điểm nào?`, `Giá ${keyword} khoảng bao nhiêu?`],
      relatedSearches: [`${keyword} ngon`, `cách làm ${keyword}`, `${keyword} gần đây`, `${keyword} bao nhiêu tiền`],
      fetchedAt: nowIso(),
    };
  }
  async verify() {
    return { ok: true, message: 'Mock search' };
  }
}

export class MockFetcher implements PageFetcher {
  async fetch(url: string): Promise<FetchedPage> {
    await sleep(MOCK_DELAY);
    const m = /\/([a-z0-9-]+)-(\d+)$/.exec(url);
    const kw = (m?.[1] ?? 'chu-de').replace(/-/g, ' ');
    const n = Number(m?.[2] ?? 1);
    if (n === 9) return { url, finalUrl: url, httpStatus: 403, title: '', text: '', wordCount: 0, language: 'other' };
    const paras = Array.from({ length: 5 }, (_, i) => sourceParagraph(kw, n * 11 + i * 2, 5));
    const text = `${kw} là chủ đề của trang mô phỏng ${n}. ${paras.join('\n\n')}\n\nSố liệu mô phỏng: khoảng ${20 + n} nghìn đến ${40 + n} nghìn đồng một phần, thời gian chuẩn bị ${2 + (n % 3)} giờ.`;
    return { url, finalUrl: url, httpStatus: 200, title: `Trang mô phỏng ${n} về ${kw}`, text, wordCount: wordCount(text), language: 'vi' };
  }
}

export class MockLlm implements ContentLlm {
  readonly provider = 'mock' as const;
  private totals: UsageTotals = emptyUsage();

  /** modelLabel: tên model giả dùng trong thống kê chi phí (thử nghiệm model cho nhiều bản khác nhau). */
  constructor(private readonly modelLabel = 'mock') {}

  private bump(model: string, input: number, output: number) {
    if (this.modelLabel !== 'mock') model = `${this.modelLabel}`;
    this.totals.calls++;
    this.totals.inputTokens += input;
    this.totals.outputTokens += output;
    const m = (this.totals.byModel[model] ??= { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 });
    m.calls++;
    m.inputTokens += input;
    m.outputTokens += output;
  }

  usage() {
    return this.totals;
  }

  async extractNotes(input: LlmRunContext & { sources: SourceForLlm[]; serp: SerpData }): Promise<ResearchNotes> {
    await sleep(MOCK_DELAY * 3);
    this.bump('mock-research', 30000, 3000);
    const TAGS = ['nguồn gốc tên gọi', 'cách chế biến', 'quán ngon', 'giá', 'sai lầm thường gặp'];
    const perSource = input.sources.map((s, si) => ({
      sourceIndex: s.index,
      url: s.url,
      angle: `Góc nhìn của nguồn ${s.index}`,
      facts: s.text
        .split(/(?<=[.!?])\s+/)
        .filter((x) => wordCount(x) > 8)
        .slice(0, 8)
        .map((x, i) => `Dữ kiện ${s.index}.${i + 1}: ${x.replace(/^(Nói thật là|Khoan\.|Tôi để ý)\s*/, '')}`),
      tags: [TAGS[si % TAGS.length] as string, TAGS[(si + 1) % TAGS.length] as string],
    }));
    const keyFacts = perSource.flatMap((s) => s.facts.slice(0, 2));
    const tops = input.sources.filter((s) => s.topRank);
    const topTags = new Set(perSource.filter((s) => tops.some((t) => t.index === s.sourceIndex)).flatMap((s) => s.tags));
    const topics = TAGS.map((tag) => {
      const owners = perSource.filter((s) => s.tags.includes(tag));
      return { tag, description: `Dữ kiện về ${tag} của ${input.keyword}.`, sourceRefs: owners.map((s) => s.sourceIndex), facts: owners.flatMap((s) => s.facts.slice(2, 4)), inTopSites: topTags.has(tag) };
    }).filter((t) => t.facts.length);
    const topSites = tops.map((s) => ({
      sourceIndex: s.index,
      position: s.index,
      url: s.url,
      structure: ['Mở bài', 'Nguồn gốc', 'Thành phần', 'Cách nấu', 'Quán gợi ý', 'Giá'],
      tags: perSource.find((p) => p.sourceIndex === s.index)?.tags ?? [],
      contentType: s.topRank === 1 ? 'danh sách quán kèm địa chỉ' : 'công thức từng bước',
    }));
    const notes: ResearchNotes = {
      keyword: input.keyword,
      searchIntent: 'informational',
      intentExplanation: 'Người tìm muốn hiểu chủ đề trước khi thử hoặc mua.',
      summary: `Các nguồn cùng nói về ${input.keyword}, khác nhau ở góc nhìn và mức chi tiết.`,
      perSource,
      keyFacts,
      numbersAndNames: input.sources.map((s) => `Nguồn ${s.index} nêu giá khoảng ${20 + s.index} đến ${40 + s.index} nghìn đồng một phần.`),
      disagreements: ['Nguồn 1 và nguồn 3 nói khác nhau về thời gian chuẩn bị.'],
      commonSubtopics: ['Nguồn gốc', 'Thành phần', 'Cách chọn', 'Giá tham khảo', 'Sai lầm thường gặp'],
      gaps: ['Chưa nguồn nào nói rõ cách phân biệt hàng làm kỹ và hàng làm vội.'],
      peopleAlsoAsk: input.serp.peopleAlsoAsk,
      secondaryKeywords: [`${input.keyword} ngon`, `cách chọn ${input.keyword}`, `giá ${input.keyword}`, `${input.keyword} chuẩn vị`, `kinh nghiệm ${input.keyword}`],
      topics,
      topSites,
      comparisons: [
        { topic: 'Bản khô và bản nước', items: ['bản khô', 'bản nước'], criteria: ['nước lèo', 'sợi', 'giá'], sourceRefs: [1, 2] },
        { topic: 'Quán trung tâm và quán vùng ven', items: ['quán trung tâm', 'quán vùng ven'], criteria: ['giá', 'giờ mở', 'phần ăn'], sourceRefs: [2, 3] },
      ],
      similarItems: [{ name: 'hủ tiếu Mỹ Tho', differences: ['sợi to, dai và trong hơn'], sourceRefs: [6] }],
      totalWords: 0,
    };
    notes.totalWords = [...notes.keyFacts, ...notes.numbersAndNames, ...notes.perSource.flatMap((s) => s.facts)].reduce((n, t) => n + wordCount(t), 0);
    return notes;
  }

  async buildOutline(input: LlmRunContext & { notes: ResearchNotes; serp: SerpData }): Promise<Outline> {
    await sleep(MOCK_DELAY * 3);
    this.bump('mock-writer', 12000, 2000);
    const kw = input.keyword;
    const style = resolveContentStyle(kw, input.options.style, input.notes.searchIntent);
    const target = Math.round((input.options.minWords + input.options.maxWords) / 2);
    if (input.options.kind === 'roundup' && input.notes.roundup) return mockRoundupOutline(kw, input.notes, target);
    return {
      title: `${kw}: cách nhận biết chỗ làm kỹ và mức giá hợp lý`.slice(0, 65),
      h1: `${kw} nhìn từ góc người đi ăn nhiều năm`,
      metaDescription: `Kinh nghiệm chọn ${kw} làm kỹ, dấu hiệu nhận biết, mức giá hợp lý và những sai lầm quen thuộc, kèm câu trả lời cho các thắc mắc hay gặp nhất.`,
      style,
      styleReason: 'Chủ đề thiên về trải nghiệm và nhận biết.',
      searchIntent: input.notes.searchIntent,
      hookIdea: 'Mở bằng khung cảnh một buổi sáng chờ món ở góc chợ.',
      quickSummary: [`Phần nền quyết định ${kw} có đáng tiền hay không.`, 'Nơi làm kỹ thường không cần trang trí nhiều.', 'Giá dao động theo khu vực, đừng chỉ nhìn giá.'],
      sections: mockSections(kw, input.options.comparison),
      faq: input.serp.peopleAlsoAsk.slice(0, 3),
      nextSteps: 'Gợi ý việc nên làm ngay trong tuần này.',
      secondaryKeywords: input.notes.secondaryKeywords,
      tableCandidates: [],
      imageIdeas: [{ position: 'sau mục 1', query: 'vietnamese street food bowl', alt: `Một phần ${kw} vừa mang ra còn nóng` }],
      targetWords: target,
    };
  }

  private makeArticle(input: LlmRunContext & { outline: Outline }, seedBase: number, marker = ''): Article {
    const kw = input.keyword;
    const o = input.outline;
    // Bài tổng hợp quán: tool sẽ chèn thêm dòng địa chỉ và đánh giá vào mỗi mục quán, chừa chỗ trước
    const reserve = o.sections.filter((s) => s.tag === 'quán').length * 35;
    return fitLength(this.rawArticle(kw, o, seedBase, marker), input.options.minWords, input.options.maxWords - reserve);
  }

  private rawArticle(kw: string, o: Outline, seedBase: number, marker: string): Article {
    return {
      title: o.title,
      metaDescription: o.metaDescription,
      h1: o.h1,
      excerpt: `Cách nhận biết ${kw} làm kỹ và mức giá nên trả, từ người đi ăn nhiều năm.`,
      quickSummary: o.quickSummary,
      intro: o.sections.some((s) => s.tag === 'quán')
        ? `${o.sections.filter((s) => s.tag === 'quán').length} quán ${kw} dưới đây được chọn từ đánh giá thật trên Google Maps theo sao và số lượt đánh giá. Bạn xem bảng so sánh trước, rồi đọc mục quán hợp với nhu cầu của mình, mỗi mục có địa chỉ và link bản đồ.${marker ? ` ${marker}` : ''}`
        : `Sáu giờ sáng, góc chợ còn ướt, mùi hành phi đã bay ra tới đầu hẻm. Tôi đứng chờ ${kw} và nghĩ về việc vì sao có nơi người ta xếp hàng, có nơi vắng tanh dù cùng một món. ${kw} không khó tìm, nhưng tìm được chỗ làm kỹ thì cần vài dấu hiệu, và đó là điều tôi muốn kể ở đây.${marker ? ` ${marker}` : ''}`,
      sections: o.sections.map((s, i) => ({ heading: s.heading, level: s.level, body: s.tag === 'quán' ? placeBody(s.heading, kw, i) : s.format === 'table' && s.comparisonItems.length >= 2 ? `${comparisonTable(s, seedBase + i)}\n\n${sectionBody(kw, seedBase + i * 5)}` : sectionBody(kw, seedBase + i * 5) })),
      // Seed FAQ là 62, 65, 68: không đồng dư 60 với seed của bất kỳ mục nào (mục dùng 1 + 5i + {0, 3, 6}, tối đa 11 mục)
      faq: o.faq.map((q, i) => ({ question: q, answer: paragraph(kw, seedBase + 61 + i * 3, 3) })),
      nextSteps: `Tuần này, thử một chỗ ${kw} bạn chưa từng ghé, gọi bản cơ bản nhất, và để ý phần nền trước khi nhìn phần trang trí. Nếu thấy màu trong, mùi sạch, bạn đã tìm được nơi đáng quay lại.`,
      images: o.imageIdeas,
      targetKeyword: kw,
      secondaryKeywords: o.secondaryKeywords,
      style: o.style,
    };
  }

  async writeArticle(input: LlmRunContext & { notes: ResearchNotes; outline: Outline }): Promise<Article> {
    await sleep(MOCK_DELAY * 4);
    this.bump('mock-writer', 15000, 6000);
    const marker = /\[fail\]/i.test(input.keyword) ? 'MOCK_AI_HIGH câu này cố ý giống văn máy để thử vòng sửa.' : '';
    return this.makeArticle(input, 1, marker);
  }

  async editArticle(input: LlmRunContext & { notes: ResearchNotes; outline: Outline; article: Article; feedback: string[] }): Promise<Article> {
    await sleep(MOCK_DELAY * 3);
    this.bump('mock-writer', 16000, 6000);
    return input.article;
  }

  async fixArticle(input: LlmRunContext & { notes: ResearchNotes; outline: Outline; article: Article; feedback: string[]; flaggedTexts: string[]; round: number }): Promise<Article> {
    await sleep(MOCK_DELAY * 3);
    this.bump('mock-writer', 16000, 6000);
    const strip = (t: string) => t.replace(/\s*MOCK_AI_HIGH[^.]*\./g, '');
    return {
      ...input.article,
      intro: strip(input.article.intro),
      sections: input.article.sections.map((s) => ({ ...s, body: strip(s.body) })),
      faq: input.article.faq.map((f) => ({ ...f, answer: strip(f.answer) })),
      nextSteps: strip(input.article.nextSteps),
    };
  }

  async reviewArticle(): Promise<AiReview> {
    await sleep(MOCK_DELAY);
    this.bump('mock-writer', 9000, 500);
    return { pass: true, summary: 'Bài mô phỏng đạt yêu cầu.', issues: [{ severity: 'minor', where: 'sections.1', problem: 'Có thể thêm chi tiết giác quan.', fix: 'Thêm một câu mô tả mùi.' }] };
  }

  async translateKeyword(keyword: string): Promise<string> {
    await sleep(MOCK_DELAY);
    return `${keyword} (english)`;
  }

  async classifyPlaces(input: { dish: string; area: string; places: PlaceForClassify[] }): Promise<PlaceClassification[]> {
    await sleep(MOCK_DELAY);
    this.bump('mock-research', 4000, 800);
    const dish = normText(input.dish);
    return input.places.map((p) => ({ index: p.index, matchesDish: normText(`${p.name} ${p.type}`).includes(dish), inArea: addressInArea(p.address, input.area), groupKey: normalizeGroupKey(p.name) }));
  }

  async assignPlaceRoles(input: { dish: string; area: string; places: PlaceForRole[] }): Promise<{ index: number; role: PlaceRole }[]> {
    await sleep(MOCK_DELAY);
    this.bump('mock-research', 3000, 600);
    const pool = ['đông khách nhất, được kiểm chứng nhiều', 'sao cao nhất danh sách', 'tô khô được nhắc nhiều nhất', 'mở sớm, hợp ăn sáng', 'hợp đi gia đình đông người', 'giá mềm, phần đầy', 'quán nhỏ, chủ nhớ mặt khách', 'chỗ thay thế khi quán đầu bảng đông'];
    const best = ['muốn quán nhiều người đã kiểm chứng', 'muốn tô ngon nhất', 'thích tô khô', 'ăn sáng trước 6 giờ', 'đi 4 đến 6 người', 'ngân sách dưới 40.000 đ', 'muốn ăn yên tĩnh', 'quán đầu bảng hết chỗ'];
    // Cố ý trả trùng vai cho quán cuối để thử phần bù bằng quy tắc
    return input.places.map((p, i) => ({ index: p.index, role: { label: i === input.places.length - 1 && i > 0 ? pool[0]! : pool[i % pool.length]!, reason: `${p.name} có ${p.reviews} lượt, ${p.rating.toFixed(1)} sao.`, bestFor: best[i % best.length]! } }));
  }

  async summarizeReviews(input: { dish: string; area: string; places: { index: number; name: string; reviews: PlaceReview[] }[] }): Promise<{ index: number; summary: PlaceReviewSummary }[]> {
    await sleep(MOCK_DELAY);
    this.bump('mock-research', 9000, 1500);
    return input.places
      .filter((p) => p.reviews.length)
      .map((p) => ({
        index: p.index,
        summary: {
          praised: ['nước lèo ngọt xương, trong và không gắt', `phần ${input.dish} đầy đặn so với giá`],
          complained: p.index % 2 ? ['đông vào giờ cao điểm, chờ hơi lâu'] : [],
          signature: [`${input.dish} khô`, 'tỏi ngâm giấm tự làm'],
          bestFor: p.index % 3 ? ['ăn sáng nhanh', 'đi gia đình'] : ['ăn khuya'],
          oneLine: `Quán được khen nước lèo và phần ăn, ${p.index % 2 ? 'hơi đông giờ cao điểm' : 'phục vụ nhanh'}.`,
          sampleCount: p.reviews.length,
        },
      }));
  }

  async verify() {
    return { ok: true, message: 'Mock Claude' };
  }
}

export class MockDetector implements AiDetector {
  readonly id = 'mock' as const;
  async scan(text: string, opts: { title: string; model: string; plagiarism: boolean; aiScoreMax: number }): Promise<AiDetectReport> {
    await sleep(MOCK_DELAY * 2);
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
    const blocks = sentences.map((s) => ({ text: s, aiScore: /MOCK_AI_HIGH/.test(s) ? 0.93 : 0.03 + (parseInt(sha256(s).slice(0, 2), 16) % 10) / 100, where: '' }));
    const high = blocks.filter((b) => b.aiScore > 0.5).length;
    const aiScore = high ? Math.min(0.95, 0.4 + high * 0.2) : 0.06;
    return {
      provider: 'mock',
      aiScore,
      originalScore: 1 - aiScore,
      blocks,
      creditsUsed: Math.ceil(wordCount(text) / 100),
      creditsRemaining: 9999,
      scanId: `mock-${sha256(text).slice(0, 8)}`,
      publicLink: null,
      pass: aiScore <= opts.aiScoreMax,
      skipped: false,
      error: null,
      plagiarism: opts.plagiarism ? { score: 0.01, sources: [], pass: true } : null,
    };
  }
  async verify() {
    return { ok: true, message: 'Mock Originality.ai' };
  }
}

/* ------------------------------------------------------------------ */
/*  Google Maps mô phỏng                                                 */
/* ------------------------------------------------------------------ */

const PLACE_NAMES = ['Cô Ba', 'Năm Tài', '252', 'Bà Sáu', 'Hồng Phát', 'Anh Tư', 'Phúc Lê', 'Sa Đéc', 'Mỹ Tho', 'Chú Bảy', 'Dì Út', 'Nam Vang 79', 'Thanh Xuân', 'Hai Lúa', 'Ngọc', 'Quang Vinh', 'Kim Chi', 'Lộc Phát', 'Đông Ba', 'Minh Anh', 'Tám Thảo', 'Cây Me', 'Bến Xe', 'Chợ Đêm', 'Ba Cô', 'Út Hiền', 'Sáu Lành', 'Tuyết Mai', 'Bảy Hồng', 'Ông Tư Ghe', 'Hòa Bình', 'Kỳ Lân', 'Song Long', 'Bà Năm Béo', 'Tư Nhỏ'];
const PLACE_REVIEWS = [523, 310, 88, 200, 12, 640, 45, 150, 9, 260, 33, 74, 120, 18, 5, 90, 210, 61, 27, 400, 16, 14, 52, 8, 39];
const PLACE_RATINGS = [4.5, 4.3, 4.7, 4.4, 4.9, 4.2, 4.6, 4.1, 5, 4.4, 4, 4.8, 4.3, 4.6, 4.9, 4.2, 4.5, 3.9, 4.7, 4.4, 4.6, 4.3, 4.1, 4.8, 4.2];
const STREETS = ['Thống Nhất', 'Ngô Gia Tự', 'Lê Lợi', 'Trần Phú', 'Nguyễn Trãi', '21 Tháng 8', 'Quang Trung', 'Hải Thượng Lãn Ông'];
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function cap(s: string): string {
  return s.replace(/(^|\s)(\p{L})/gu, (m) => m.toUpperCase());
}

/**
 * 35 quán qua hai trang, cố ý có: một quán bán món khác, một quán ngoài khu vực, một quán đã đóng cửa,
 * một thương hiệu hai chi nhánh, nhiều quán dưới ngưỡng đánh giá; để thử lọc, gộp và xếp hạng không tốn credit.
 */
export class MockMapsProvider implements MapsProvider {
  readonly id = 'mock' as const;

  async geocode(): Promise<{ lat: number; lng: number }> {
    await sleep(MOCK_DELAY);
    return { lat: 11.5647, lng: 108.9886 };
  }

  async searchPlaces(query: string, o: { page: number; center: { lat: number; lng: number } | null; language: string }): Promise<RawPlace[]> {
    await sleep(MOCK_DELAY);
    if (o.page > 1) return [];
    const words = query.trim().split(/\s+/);
    const area = cap(words.slice(-2).join(' '));
    const dish = cap(words.slice(0, -2).join(' ') || 'hủ tiếu');
    const count = o.page === 0 ? 20 : 15;
    return Array.from({ length: count }, (_, k) => {
      const i = o.page * 20 + k;
      const base = PLACE_NAMES[i % PLACE_NAMES.length]!;
      let title = `${dish} ${base}`;
      let type = `Quán ${dish.toLowerCase()}`;
      let address = `${10 + i * 7} ${STREETS[i % STREETS.length]}, ${area}, Ninh Thuận`;
      let openState = 'Đang mở cửa';
      const weekdays = ['thứ hai', 'thứ ba', 'thứ tư', 'thứ năm', 'thứ sáu', 'thứ bảy', 'chủ nhật'];
      const operatingHours: Record<string, string> = i % 3 === 0 ? Object.fromEntries(weekdays.map((d, k) => [d, k === 6 ? 'Đóng cửa' : k === 5 ? '06:00–12:00' : '06:00–13:00'])) : i % 3 === 1 ? Object.fromEntries(weekdays.map((d) => [d, '05:00–12:00'])) : {};
      if (i === 3) {
        title = `Phở ${base}`;
        type = 'Quán phở';
      }
      if (i === 5) address = `${20 + i} Trần Phú, Nha Trang, Khánh Hòa`;
      // Địa chỉ mới sau sáp nhập chỉ ghi phường và tỉnh: phải được nhận nhờ nằm trong bán kính quanh tâm
      if (i === 9) address = `${10 + i * 7} 21 Tháng 8, Bảo An, Khánh Hòa, Việt Nam`;
      if (i === 7) openState = 'Đóng cửa vĩnh viễn';
      if (i === 12) title = `${dish} Cô Ba - Chi nhánh 2`;
      return {
        position: i + 1,
        title,
        placeId: `mock-place-${i + 1}`,
        dataId: `0x0:0x${(i + 1).toString(16)}`,
        rating: PLACE_RATINGS[i % PLACE_RATINGS.length]!,
        reviews: PLACE_REVIEWS[i % PLACE_REVIEWS.length]!,
        price: i % 3 === 0 ? '₫20.000–50.000' : '',
        type,
        types: [type],
        address,
        openState,
        hours: i % 4 === 0 ? 'Đã đóng cửa · Mở cửa lúc 6:00' : '',
        operatingHours,
        phone: i % 2 === 0 ? `+84 ${900 + i} 939 ${100 + i}` : '',
        website: i % 5 === 0 ? `https://mock-${i + 1}.example.vn` : '',
        description: i % 5 === 0 ? `Quán ${dish.toLowerCase()} lâu năm, phục vụ khô và nước.` : '',
        thumbnail: i % 3 === 2 ? '' : `https://mock-photo.example/${i + 1}=w80-h106-k-no`,
        lat: i === 5 ? 12.2388 : 11.56 + i * 0.001,
        lng: i === 5 ? 109.1967 : 108.98 + i * 0.001,
      };
    });
  }

  async reviews(dataId: string, o: { language: string; count: number }): Promise<PlaceReview[]> {
    await sleep(MOCK_DELAY);
    const n = Number.parseInt(dataId.split('0x').pop() ?? '1', 16) || 1;
    const texts = [
      'Nước lèo ngọt xương, trong, không gắt. Sợi trụng vừa tới, tô khô có tỏi ngâm rất hợp.',
      'Phần ăn đầy đặn so với giá. Giờ cao điểm hơi đông, chờ khoảng mười phút.',
      'Tôi thích tô khô hơn tô nước, nước chấm pha khéo. Chỗ ngồi hơi chật.',
      'Quán mở sớm, hợp ăn sáng trước khi đi làm. Chủ quán vui vẻ.',
      'Giá ổn, có chỗ để xe. Lần sau sẽ quay lại thử thêm món khác.',
      'Nước lèo hơi ngọt với tôi nhưng người nhà lại thích. Trứng cút và thịt bằm nhiều.',
      'Đi gia đình bốn người ăn thoải mái, gọi thêm quẩy. Vệ sinh ổn.',
      'Chờ hơi lâu buổi sáng cuối tuần, nhưng đáng.',
      'Tô đặc biệt nhiều thịt, ăn no tới trưa. Nước lèo hôm tôi ăn hơi mặn.',
      'Quán sạch, bàn lau kỹ. Chỗ để xe hẹp, cuối tuần phải gửi bên ngoài.',
      'Giá 35.000 một tô thường, 45.000 tô đặc biệt. Rau sống tươi, có giá trụng.',
      'Hủ tiếu khô trộn tương đen là món tôi hay gọi. Phục vụ nhanh dù đông.',
      'Đi công tác ghé ăn hai buổi sáng liền. Nước lèo ngày nào cũng đều.',
      'Chủ quán nhớ mặt khách quen, hỏi thăm. Không gian nhỏ nhưng thoáng.',
      'Ăn lúc 6 giờ sáng còn vắng, ngồi thoải mái. Sau 7 giờ bắt đầu đông.',
      'Có bán thêm bánh mì chấm nước lèo, trẻ con thích. Trà đá miễn phí.',
    ];
    return texts.slice(0, Math.min(o.count, texts.length)).map((t, i) => ({ rating: 4 + ((n + i) % 2), date: `2026-0${1 + (i % 9)}-1${i % 10}`, text: t }));
  }

  async downloadPhoto(url: string): Promise<{ data: Buffer; contentType: string } | null> {
    await sleep(MOCK_DELAY);
    return url ? { data: PNG_1X1, contentType: 'image/png' } : null;
  }

  async resolveUrl(url: string): Promise<string> {
    await sleep(MOCK_DELAY);
    return /maps\.app\.goo\.gl/.test(url) ? 'https://www.google.com/maps/place/H%E1%BB%A7+Ti%E1%BA%BFu+Nam+Vang+%C3%94ng+Gi%C3%A1o/@11.5698,108.9964,17z/data=!3m1!4b1!4m6!3m5!1s0x3170d18b85b02fb1:0xb89532a8a1205318!8m2!3d11.5698693!4d108.9964943' : url;
  }

  async lookupPlace(ref: { placeId?: string; dataId?: string; name?: string; lat?: number | null; lng?: number | null }, _o: { language: string }): Promise<RawPlace | null> {
    await sleep(MOCK_DELAY);
    const name = ref.name || 'Hủ Tiếu Nam Vang Ông Giáo';
    if (ref.placeId === 'missing') return null;
    return {
      position: 1,
      title: name,
      placeId: ref.placeId || 'ChIJsS-whYvRcDERGFMgoagylbg',
      dataId: ref.dataId || '0x3170d18b85b02fb1:0xb89532a8a1205318',
      rating: 4.8,
      reviews: 33,
      price: '₫1–100.000',
      type: 'Quán ăn nhỏ',
      types: ['Quán ăn nhỏ'],
      address: '89 Văn Cao, Phan Rang, Khánh Hòa, Việt Nam',
      openState: 'Đang mở cửa',
      hours: '',
      operatingHours: Object.fromEntries(['thứ hai', 'thứ ba', 'thứ tư', 'thứ năm', 'thứ sáu', 'thứ bảy', 'chủ nhật'].map((d) => [d, '05:00–12:00'])),
      phone: '+84 847 939 688',
      website: 'http://facebook.com/hutieuonggiao',
      description: 'Quán hủ tiếu Nam Vang mở từ sáng sớm.',
      thumbnail: 'https://mock-photo.example/brand-1=w80-h106-k-no',
      lat: ref.lat ?? 11.5698693,
      lng: ref.lng ?? 108.9964943,
    };
  }

  async photos(dataId: string, o: { count: number; language: string }): Promise<string[]> {
    await sleep(MOCK_DELAY);
    return dataId ? Array.from({ length: Math.min(o.count, 8) }, (_, i) => `https://mock-photo.example/brand-${i + 1}=w80-h106-k-no`) : [];
  }
}

/** Bố cục mô phỏng cho bài tổng hợp quán: bảng so sánh, mỗi quán một mục, hợp ai, cách xếp hạng. */
function mockRoundupOutline(kw: string, notes: ResearchNotes, target: number): Outline {
  const r = notes.roundup!;
  const names = r.featured.map((p) => p.name);
  const sections: Outline['sections'] = [
    { heading: `So sánh nhanh ${names.length} quán ${r.dish} ở ${r.area}`, level: 2, goal: 'Nhìn một bảng là chọn được', points: ['Sao, số đánh giá, giá, giờ mở của từng quán'], sourceRefs: [], format: 'table', tag: 'so sánh', comparisonItems: names, comparisonCriteria: ['sao', 'số đánh giá', 'giá', 'giờ mở', 'điểm nổi bật'] },
    ...r.featured.map((p) => ({ heading: `${p.rank}. ${p.name}`, level: 2 as const, goal: `Vì sao ${p.name} ở hạng ${p.rank}`, points: ['Điểm được khen', 'Điểm bị chê', 'Ai hợp'], sourceRefs: [p.rank], format: 'text' as const, tag: 'quán', comparisonItems: [], comparisonCriteria: [] })),
    { heading: 'Quán nào hợp ai', level: 2, goal: 'Chọn theo tình huống', points: ['Ăn sáng nhanh', 'Đi gia đình', 'Ăn khuya'], sourceRefs: [], format: 'table', tag: 'hợp ai', comparisonItems: ['ăn sáng nhanh', 'đi gia đình', 'ăn khuya', 'ngân sách thấp'], comparisonCriteria: ['quán nên chọn', 'lý do'] },
    { heading: 'Cách tôi xếp hạng', level: 2, goal: 'Minh bạch cách chọn', points: ['Điểm kết hợp sao và số đánh giá', 'Ngưỡng đánh giá tối thiểu'], sourceRefs: [], format: 'text', tag: 'cách xếp hạng', comparisonItems: [], comparisonCriteria: [] },
  ];
  return {
    title: `${names.length} quán ${kw} ngon theo đánh giá thật`.slice(0, 65),
    h1: `${names.length} quán ${kw} đáng ghé, chọn theo sao và số đánh giá`,
    metaDescription: `Tổng hợp ${names.length} quán ${kw} được chọn từ đánh giá Google Maps: địa chỉ, sao, số đánh giá, giá, giờ mở và quán nào hợp ai, kèm link bản đồ.`,
    style: 'story',
    styleReason: 'Bài địa điểm ẩm thực.',
    searchIntent: 'local',
    hookIdea: `${names.length} quán ${r.dish} ở ${r.area} chọn từ đánh giá thật trên Google Maps theo sao và số đánh giá; bài giúp chọn quán theo nhu cầu.`,
    quickSummary: [`${names[0] ?? 'Quán đầu bảng'} có điểm cao nhất.`, 'Giá dao động theo quán.', 'Kiểm tra giờ mở trước khi đi.'],
    sections,
    faq: notes.peopleAlsoAsk.slice(0, 3),
    nextSteps: 'Chọn một quán theo tình huống và mở Google Maps kiểm tra giờ.',
    secondaryKeywords: notes.secondaryKeywords,
    tableCandidates: ['so sánh nhanh', 'hợp ai'],
    imageIdeas: [{ position: 'sau mở bài', query: 'vietnamese noodle soup street', alt: `Một tô ${r.dish} ở ${r.area}` }],
    targetWords: target,
  };
}
