import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import type { ContentGenerator, InternalLink } from './types.js';
import type { EntityData, PageContent, SiteBrief, SitePlan } from '../core/types.js';
import { LlmEntitySuggestSchema, LlmPageSchema, LlmPlanSchema, LlmReviewSchema, LlmTopicsSchema, type LlmEntitySuggest, type LlmPage, type LlmPlan, type LlmReview } from '../generator/llm-schemas.js';
import { interviewBlock, type InterviewData } from '../core/interview.js';
import { CONTENT_STYLES, contentStyleGuide, ENGAGEMENT_RULES, PAGE_STRUCTURES, resolveContentStyle, type ContentStyleId } from '../generator/content-styles.js';
import { AppError, TransientError } from '../core/errors.js';
import { createLogger } from '../core/logger.js';
import { slugify } from '../core/util.js';

const log = createLogger('claude');

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  editorModel?: string;
  /** Model dùng khi yêu cầu bị từ chối vì chính sách (stop_reason = refusal). */
  fallbackModel?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

/* ------------------------------------------------------------------ */
/*  Prompt                                                              */
/* ------------------------------------------------------------------ */

function languageName(lang: string): string {
  return lang === 'en' ? 'English' : 'tiếng Việt';
}

function samplesBlock(brief: SiteBrief): string {
  const t = brief.styleSamples.trim();
  if (!t) return '';
  return `VĂN PHONG MẪU ĐÃ ĐƯỢC CHỦ THƯƠNG HIỆU DUYỆT (học giọng, cách xưng hô, mức chuyên môn và độ cụ thể từ đây; không sao chép nguyên văn, không lặp lại ý):
"""
${t.slice(0, 4000)}
"""
`;
}

function systemPrompt(brief: SiteBrief, style: ContentStyleId, kind?: PageContent['kind']): string {
  const lang = languageName(brief.language);
  return `Bạn là chiến lược gia nội dung kiêm copywriter cấp cao, chuyên viết website cho doanh nghiệp nhỏ và blog chuyên ngành. Toàn bộ nội dung viết bằng ${lang}, đúng chính tả, đủ dấu, giọng tự nhiên như người trong nghề viết cho khách hàng thật.

${contentStyleGuide(style)}

${samplesBlock(brief)}
${ENGAGEMENT_RULES}
${kind ? '\n' + PAGE_STRUCTURES[kind] + '\n' : ''}

Nguyên tắc chất lượng (bắt buộc, vì nội dung sẽ được Google đánh giá theo tiêu chí hữu ích và E-E-A-T):
1. Cụ thể, có giá trị thực: mỗi đoạn phải đưa ra thông tin người đọc dùng được (quy trình, tiêu chí lựa chọn, lỗi thường gặp, ví dụ tình huống, chi phí tham khảo nếu hợp lý). Không viết đoạn chỉ để lấp chỗ.
2. Cấm câu sáo rỗng và khuôn mẫu AI: không dùng "trong thời đại 4.0", "không thể phủ nhận rằng", "hãy cùng tìm hiểu", "tóm lại", "như đã đề cập ở trên", "chúng tôi tự hào", "hàng đầu", "uy tín số 1", dấu gạch ngang dài, và không mở đầu mọi đoạn bằng cùng một cấu trúc.
3. Không bịa sự kiện: không tự nghĩ ra giải thưởng, chứng chỉ, số năm kinh nghiệm, số lượng khách hàng, giá, khoảng giá, thói quen khách hàng hay tên đối tác nếu brief không cung cấp. Không có nguồn thì không khẳng định: không biết giá thì giải thích yếu tố ảnh hưởng đến giá; không có trải nghiệm thật thì không viết như đã trực tiếp trải nghiệm.
4. Từ khóa dùng tự nhiên, xuất hiện ở tiêu đề, H1, đoạn mở đầu và vài chỗ hợp lý. Tuyệt đối không nhồi nhét.
5. Mỗi trang, mỗi bài phải có góc nhìn riêng, không lặp lại đoạn văn giữa các trang.
6. Markdown trong trường body: đoạn văn, danh sách "- ", danh sách đánh số "1. ", in đậm **, bảng markdown, callout dạng "> **Mẹo:** ...", liên kết [chữ](đường dẫn). Không dùng thẻ HTML, không dùng tiêu đề # bên trong body vì heading đã có trường riêng.
7. imageQuery: 2 đến 4 từ tiếng Anh mô tả ảnh minh họa tìm trên kho ảnh stock (ví dụ "electrician repairing panel"). Không dùng tên thương hiệu.
8. Trả về đúng cấu trúc JSON được yêu cầu, mọi trường đều có giá trị; trường không dùng để chuỗi rỗng hoặc mảng rỗng.`;
}

function briefBlock(brief: SiteBrief, entity: EntityData, domain: string, interview?: InterviewData | null): string {
  const lines = [
    `Domain: ${domain}`,
    `Thương hiệu: ${brief.brandName}`,
    `Loại website: ${brief.siteType === 'blog' ? 'blog chuyên đề (site vệ tinh, thiên về bài viết hữu ích)' : 'website doanh nghiệp (giới thiệu dịch vụ, tạo niềm tin, kêu gọi liên hệ)'}`,
    `Ngành / lĩnh vực: ${brief.industry}`,
    brief.description ? `Mô tả doanh nghiệp: ${brief.description}` : '',
    brief.services.length ? `Dịch vụ / sản phẩm chính: ${brief.services.join('; ')}` : '',
    brief.keywords.length ? `Từ khóa mục tiêu: ${brief.keywords.join(', ')}` : '',
    brief.targetAudience ? `Khách hàng mục tiêu: ${brief.targetAudience}` : '',
    brief.location ? `Khu vực hoạt động: ${brief.location}` : '',
    brief.usp ? `Điểm khác biệt: ${brief.usp}` : '',
    brief.tone ? `Giọng văn mong muốn: ${brief.tone}` : '',
    brief.notes ? `Ghi chú thêm: ${brief.notes}` : '',
    entity.telephone ? `Điện thoại: ${entity.telephone}` : '',
    entity.email ? `Email: ${entity.email}` : '',
    entity.address.streetAddress || entity.address.addressLocality
      ? `Địa chỉ: ${[entity.address.streetAddress, entity.address.addressLocality, entity.address.addressRegion].filter(Boolean).join(', ')}`
      : '',
    entity.openingHours.length ? `Giờ mở cửa: ${entity.openingHours.join('; ')}` : '',
    entity.priceRange ? `Khoảng giá: ${entity.priceRange}` : '',
    entity.foundingDate ? `Năm thành lập: ${entity.foundingDate}` : '',
    entity.founder ? `Người sáng lập: ${entity.founder}` : '',
    entity.author.name ? `Tác giả nội dung: ${entity.author.name}${entity.author.jobTitle ? ', ' + entity.author.jobTitle : ''}` : '',
  ].filter(Boolean);
  const facts = interviewBlock(interview);
  return lines.join('\n') + (facts ? `\n\n${facts}` : '');
}

function linksBlock(links: InternalLink[] | undefined): string {
  if (!links?.length) return '';
  return `Đường dẫn nội bộ được phép dùng trong liên kết (chỉ dùng đúng các đường dẫn này):\n${links.map((l) => `- ${l.path} : ${l.label}`).join('\n')}`;
}

const PAGE_GUIDES: Record<PageContent['kind'], string> = {
  home: `Trang chủ. Mục tiêu: trong 5 giây người đọc hiểu doanh nghiệp làm gì, cho ai, vì sao nên chọn. Cấu trúc: h1 chứa từ khóa chính và khu vực; intro 2 đến 3 câu theo đúng kỹ thuật móc câu; 4 đến 6 section: giới thiệu ngắn theo kiểu viết đã chọn, các dịch vụ chính (tóm tắt, chi tiết để trang dịch vụ), lý do lựa chọn (dựa trên điểm khác biệt trong brief, không bịa), quy trình làm việc hoặc trải nghiệm khách, khu vực phục vụ, kêu gọi liên hệ. faq: 4 đến 6 câu hỏi khách thật sự hay hỏi. services và keyTakeaways để rỗng.`,
  about: `Trang Giới thiệu. Con người và cách làm việc có thật theo kiểu viết đã chọn: xuất phát điểm, cách làm việc, tiêu chuẩn giữ, đội ngũ (chỉ nêu người có trong brief), cam kết. 3 đến 4 section, không checklist, không bảng, không "Bước tiếp theo". Có một section về tác giả/người phụ trách nội dung nếu brief có tên. faq, services, keyTakeaways để rỗng.`,
  services: `Trang Dịch vụ tổng hợp. intro nêu phạm vi dịch vụ và cho ai. Trường services: mỗi dịch vụ trong kế hoạch một mục, body 120 đến 300 từ theo đúng cấu trúc trang dịch vụ (vấn đề → phạm vi → cách làm → quy trình → điều kiện báo giá → liên hệ). sections: 1 đến 2 section chung (cách báo giá, cam kết). faq: 3 đến 5 câu. keyTakeaways để rỗng.`,
  blog: `Trang danh sách Blog. Chỉ cần title, metaDescription, h1, intro 2 đến 3 câu mô tả blog viết về gì và cho ai. sections, faq, services, keyTakeaways để rỗng.`,
  post: `Bài viết blog thật sự hữu ích, đúng góc nhìn (angle) được giao, tối ưu tự nhiên cho từ khóa mục tiêu, viết theo kiểu viết đã chọn và đúng cấu trúc theo ý định tìm kiếm (giải đáp, so sánh hay hướng dẫn). keyTakeaways: 3 đến 5 ý "Tóm tắt nhanh". 4 đến 7 section với heading có thông tin; bảng, checklist, ví dụ tình huống, callout chỉ dùng khi nội dung thật sự cần; hai đến ba liên kết nội bộ đặt giữa bài. Section cuối là "Bước tiếp theo" ngắn. excerpt 1 đến 2 câu có lợi ích cụ thể. faq 2 đến 4 câu liên quan trực tiếp. services để rỗng.`,
  contact: `Trang Liên hệ. intro thân thiện nêu cách liên hệ nhanh nhất và thời gian phản hồi hợp lý (không cam kết số cụ thể nếu brief không có). 2 đến 3 section ngắn: thông tin liên hệ (dùng đúng dữ liệu trong brief, không bịa), khu vực phục vụ, điều nên chuẩn bị trước khi liên hệ. faq, services, keyTakeaways để rỗng.`,
  privacy: `Trang Chính sách bảo mật cho website tĩnh giới thiệu doanh nghiệp. Website này không có form thu thập dữ liệu, không tài khoản, không thanh toán; người đọc liên hệ qua điện thoại, Zalo, email hoặc mạng xã hội bên ngoài. Mô tả: website thu thập gì (chỉ dữ liệu kỹ thuật của máy chủ và, nếu được cho biết có Google Analytics, dữ liệu thống kê ẩn danh), dùng để làm gì, không bán hay chia sẻ, liên kết ngoài do bên thứ ba quản lý, quyền của người dùng, cách liên hệ về quyền riêng tư, "Cập nhật lần cuối: theo ngày xuất bản". 4 đến 6 section ngắn, giọng rõ ràng, không móc câu, không callout. faq, services, keyTakeaways để rỗng.`,
};

const EDITOR_CHECKLIST = `Bạn là biên tập viên kỳ cựu. Hãy sửa lại nội dung JSON sau theo danh sách kiểm tra, giữ nguyên cấu trúc và ý chính, trả về JSON cùng cấu trúc:
1. Hai câu đầu của intro phải là móc câu đúng kiểu viết: nói đúng tình huống hoặc lợi ích cụ thể của người đọc, hoặc mở bằng khung cảnh cụ thể với kiểu Kể chuyện. Nếu đang mở bằng định nghĩa hay câu chung chung, viết lại. Trang Giới thiệu và Chính sách không cần móc câu.
2. Xóa hoặc viết lại mọi câu sáo rỗng, câu không mang thông tin, câu mở đầu kiểu AI, dấu gạch ngang dài.
3. Thêm chi tiết cụ thể ở những đoạn còn chung chung: tiêu chí, bước làm, ví dụ tình huống, lưu ý thực tế. Không thêm số liệu, giải thưởng hay chứng chỉ không có trong brief.
4. Yếu tố giữ chân chỉ khi nội dung thật sự cần: callout "> **Mẹo:**" hoặc "> **Lưu ý:**" ở chỗ người đọc dễ mắc lỗi, bảng khi có từ hai phương án, checklist khi có từ ba việc; bỏ khối nào chỉ để cho có. Bài blog và trang dịch vụ: hai đến ba liên kết nội bộ giữa bài chỉ dùng đường dẫn được cấp, đoạn cuối "Bước tiếp theo" cụ thể. Trang Giới thiệu, Liên hệ, Chính sách: không thêm các khối này.
4b. Xóa mọi dữ kiện không có trong thông tin nền: giá, khoảng giá, số năm, số khách, thói quen khách hàng, giải thưởng, tên đối tác. Thay bằng cách nói về yếu tố ảnh hưởng hoặc cách làm.
5. Kiểm tra từ khóa xuất hiện tự nhiên ở title, h1, intro; giảm nếu lặp quá 5 lần trong 300 từ.
6. Xen kẽ độ dài câu và đoạn; tách đoạn dài hơn 4 câu; đổi các heading chung chung thành heading có thông tin hoặc kết quả.
7. Title 50 đến 65 ký tự có từ khóa; metaDescription 140 đến 158 ký tự, có lợi ích và lời gọi hành động nhẹ.
8. Chính tả, dấu câu, xưng hô nhất quán (doanh nghiệp xưng "chúng tôi", gọi khách là "bạn" hoặc "anh chị" nhất quán trong toàn bài).
9. Giữ đúng giọng của kiểu viết đã chọn. Giữ markdown đơn giản, không thẻ HTML, không heading # trong body.`;

/* ------------------------------------------------------------------ */
/*  Client                                                              */
/* ------------------------------------------------------------------ */

export class AnthropicContentGenerator implements ContentGenerator {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly editorModel: string;
  private readonly fallbackModel: string;
  private readonly effort: AnthropicOptions['effort'];
  private stats = { inputTokens: 0, outputTokens: 0, calls: 0 };

  constructor(opts: AnthropicOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 3, timeout: 10 * 60_000 });
    this.model = opts.model;
    this.editorModel = opts.editorModel || opts.model;
    this.fallbackModel = opts.fallbackModel || 'claude-sonnet-5';
    this.effort = opts.effort;
  }

  usage() {
    return { ...this.stats };
  }

  async verify(): Promise<{ ok: boolean; message: string }> {
    try {
      const m = await this.client.models.retrieve(this.model);
      return { ok: true, message: `Key hợp lệ, model ${m.id}${this.editorModel !== this.model ? `, biên tập bằng ${this.editorModel}` : ''}` };
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) return { ok: false, message: 'API key không hợp lệ' };
      if (err instanceof Anthropic.NotFoundError) return { ok: false, message: `Không tìm thấy model ${this.model}` };
      return { ok: false, message: (err as Error).message };
    }
  }

  private async structured<S extends z.ZodType>(params: { model: string; system: string; user: string; schema: S; maxTokens?: number }): Promise<z.infer<S>> {
    const run = async (model: string) => {
      const stream = this.client.messages.stream({
        model,
        max_tokens: params.maxTokens ?? 16_000,
        system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: params.user }],
        ...(this.effort ? { output_config: { effort: this.effort, format: zodOutputFormat(params.schema) } } : { output_config: { format: zodOutputFormat(params.schema) } }),
      });
      const msg = await stream.finalMessage();
      this.stats.calls++;
      this.stats.inputTokens += msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
      this.stats.outputTokens += msg.usage.output_tokens;
      return msg;
    };

    let msg = await run(params.model);
    if (msg.stop_reason === 'refusal') {
      log.warn('Yêu cầu bị từ chối theo chính sách, thử lại với model dự phòng', { category: msg.stop_details?.category });
      msg = await run(this.fallbackModel);
      if (msg.stop_reason === 'refusal') throw new AppError(`Claude từ chối tạo nội dung này (${msg.stop_details?.category ?? 'không rõ lý do'}). Hãy sửa lại brief.`);
    }
    if (msg.stop_reason === 'max_tokens') throw new TransientError('Nội dung vượt giới hạn token, sẽ thử lại');

    const parsed = (msg as unknown as { parsed_output?: unknown }).parsed_output;
    if (parsed) return params.schema.parse(parsed);
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
    try {
      return params.schema.parse(JSON.parse(text));
    } catch (err) {
      throw new TransientError(`Không đọc được JSON từ Claude: ${(err as Error).message}`);
    }
  }

  async generatePlan(input: { brief: SiteBrief; entity: EntityData; domain: string; contentStyle?: ContentStyleId; interview?: InterviewData | null }): Promise<SitePlan> {
    const { brief, entity, domain } = input;
    const style = input.contentStyle ?? resolveContentStyle(brief);
    const servicesCount = brief.siteType === 'blog' ? '3 chủ đề trụ cột (đóng vai trò "dịch vụ" về mặt cấu trúc, đặt tên như chuyên mục)' : brief.services.length ? `đúng ${brief.services.length} dịch vụ theo brief, giữ đúng tên` : '4 đến 6 dịch vụ hợp lý với ngành';
    const user = `Lập kế hoạch nội dung cho website dưới đây, theo kiểu viết "${CONTENT_STYLES[style].name}". Trả về JSON.

${briefBlock(brief, entity, domain, input.interview)}

Yêu cầu:
- tagline: 6 đến 12 từ, nói rõ làm gì cho ai, không sáo rỗng.
- brandVoice: 2 đến 3 câu mô tả giọng văn riêng của thương hiệu này theo kiểu viết đã chọn (sẽ dùng để mọi trang nhất quán và khác các website khác cùng ngành).
- audienceInsight: 3 đến 4 câu về nỗi lo, câu hỏi và tiêu chí chọn của khách hàng mục tiêu.
- services: ${servicesCount}; summary 1 đến 2 câu có lợi ích cụ thể.
- posts: ${brief.postsCount} chủ đề bài blog, mỗi bài một từ khóa dài (long-tail) khác nhau, góc nhìn (angle) cụ thể và không trùng nhau, phù hợp giai đoạn tìm hiểu của khách và hợp với kiểu viết. Tiêu đề 50 đến 65 ký tự, có con số hoặc lợi ích cụ thể khi hợp lý.
- faq: 5 đến 6 câu hỏi thực tế khách hay hỏi trước khi mua, trả lời 2 đến 4 câu.
- ctaPrimary / ctaSecondary: lời kêu gọi ngắn gọn (3 đến 6 từ).
- differentiators: 3 đến 5 điểm, chỉ dựa trên brief; nếu brief ít thông tin thì nêu cách làm việc (minh bạch chi phí, phản hồi nhanh, tư vấn đúng nhu cầu) thay vì bịa thành tích.
- authorName/authorTitle/authorBio: dùng tên tác giả hoặc người sáng lập trong brief nếu có; nếu không có, đặt authorName là "Đội ngũ ${brief.brandName}", authorTitle là "Biên tập nội dung", bio 2 câu nêu chuyên môn.`;
    const out = await this.structured({ model: this.model, system: systemPrompt(brief, style), user, schema: LlmPlanSchema });
    return { ...planFromLlm(out), contentStyle: style };
  }

  async generatePage(input: { brief: SiteBrief; entity: EntityData; plan: SitePlan; domain: string; kind: PageContent['kind']; post?: SitePlan['posts'][number]; existingTitles?: string[]; internalLinks?: InternalLink[]; interview?: InterviewData | null }): Promise<PageContent> {
    const { brief, entity, plan, domain, kind, post } = input;
    const style = plan.contentStyle ?? resolveContentStyle(brief);
    const planBlock = [
      `Kiểu viết: ${CONTENT_STYLES[style].name}`,
      `Tagline: ${plan.tagline}`,
      `Giọng văn thương hiệu: ${plan.brandVoice}`,
      `Insight khách hàng: ${plan.audienceInsight}`,
      `Dịch vụ: ${plan.services.map((s) => `${s.name} (${s.summary})`).join(' | ')}`,
      `Điểm khác biệt: ${plan.differentiators.join('; ')}`,
      `CTA: ${plan.ctaPrimary} / ${plan.ctaSecondary}`,
      `Tác giả: ${plan.authorName}, ${plan.authorTitle}`,
      input.existingTitles?.length ? `Các trang/bài đã có (tránh trùng ý): ${input.existingTitles.join(' | ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const postBlock = post ? `\nBài viết cần viết:\n- Tiêu đề gợi ý: ${post.title}\n- Từ khóa mục tiêu: ${post.targetKeyword}\n- Góc nhìn: ${post.angle}\n- imageQuery gợi ý cho ảnh đầu bài: ${post.imageQuery}` : '';
    const user = `Viết nội dung cho một trang của website. Trả về JSON.

${briefBlock(brief, entity, domain, input.interview)}

Kế hoạch nội dung đã chốt:
${planBlock}
${postBlock}

${linksBlock(input.internalLinks)}

Loại trang: ${kind}
Hướng dẫn cho loại trang này: ${PAGE_GUIDES[kind]}

Quy ước trường:
- title: thẻ title 50 đến 65 ký tự, có từ khóa, có thể kèm tên thương hiệu ở cuối.
- metaDescription: 140 đến 158 ký tự, có lợi ích cụ thể.
- h1: khác title, tự nhiên, có thông tin.
- heroImageAlt: mô tả ảnh đầu trang bằng ${languageName(brief.language)}, 6 đến 12 từ, có ngữ cảnh ngành.
- targetKeyword: từ khóa chính của trang này.
- keyTakeaways: chỉ bài blog, 3 đến 5 ý; trang khác để mảng rỗng.
- excerpt: chỉ dùng cho bài blog, còn lại để rỗng.
- Mỗi section: heading, body markdown, imageQuery (chuỗi rỗng nếu section không cần ảnh; chỉ 1 đến 2 section nên có ảnh).`;
    const out = await this.structured({ model: this.model, system: systemPrompt(brief, style, kind), user, schema: LlmPageSchema, maxTokens: 20_000 });
    return pageFromLlm(kind, out, post);
  }

  async editPage(input: { brief: SiteBrief; entity?: EntityData; domain?: string; plan: SitePlan; page: PageContent; internalLinks?: InternalLink[]; feedback?: string[]; interview?: InterviewData | null }): Promise<PageContent> {
    const { brief, plan, page } = input;
    const style = plan.contentStyle ?? resolveContentStyle(brief);
    const background = input.entity ? briefBlock(brief, input.entity, input.domain ?? '', input.interview) : `Thương hiệu: ${brief.brandName}, ngành: ${brief.industry}${brief.location ? ', khu vực: ' + brief.location : ''}`;
    const feedback = input.feedback?.length ? `\nCỔNG KIỂM DUYỆT ĐÃ TỪ CHỐI BẢN NÀY. Bắt buộc sửa hết các lỗi sau (mục BẮT BUỘC), sửa thêm mục "nên" nếu được:\n${input.feedback.map((x) => '- ' + x).join('\n')}\n` : '';
    const user = `${EDITOR_CHECKLIST}
${feedback}
Thông tin nền (đây là toàn bộ dữ kiện được phép dùng; mọi dữ kiện khác trong bài phải bỏ):
${background}
- Kiểu viết: ${CONTENT_STYLES[style].name}
- Giọng văn thương hiệu: ${plan.brandVoice}
- Điểm khác biệt đã chốt: ${plan.differentiators.join('; ')}
- Loại trang: ${page.kind}${page.targetKeyword ? ', từ khóa mục tiêu: ' + page.targetKeyword : ''}
${linksBlock(input.internalLinks)}

Nội dung cần biên tập (JSON):
${JSON.stringify(toLlmPage(page))}`;
    const out = await this.structured({ model: this.editorModel, system: systemPrompt(brief, style, page.kind), user, schema: LlmPageSchema, maxTokens: 20_000 });
    const edited = pageFromLlm(page.kind, out);
    return { ...page, ...edited, kind: page.kind, publishedAt: page.publishedAt };
  }

  async reviewPage(input: { brief: SiteBrief; entity: EntityData; plan: SitePlan; page: PageContent; interview?: InterviewData | null }): Promise<LlmReview> {
    const { brief, entity, plan, page } = input;
    const style = plan.contentStyle ?? resolveContentStyle(brief);
    const system = `Bạn là trưởng ban biên tập khó tính, duyệt nội dung website trước khi xuất bản. Bạn không sửa bài, chỉ chấm đạt hay không đạt và chỉ ra lỗi cụ thể. Trả lời bằng ${languageName(brief.language)}.`;
    const user = `Duyệt trang "${page.kind}" dưới đây. Trả về JSON: pass (true khi không có lỗi major), summary (2 câu), issues (mỗi lỗi: severity major/minor, where là vị trí như intro, sections.2, faq.1, services.0, problem, fix ngắn gọn).

Tiêu chí major (không đạt):
1. Có dữ kiện không có trong thông tin nền: giá hoặc khoảng giá, số năm, số lượng khách, giải thưởng, chứng chỉ, tên người, thói quen khách hàng, cam kết thời gian cụ thể.
2. Không trả lời đúng nhu cầu của loại trang hoặc từ khóa mục tiêu; người đọc đọc xong vẫn không biết làm gì.
3. Nội dung trùng ý giữa các mục, lặp lại một ý nhiều lần bằng lời khác.
4. Văn mẫu AI hoặc quảng cáo rỗng chiếm phần lớn: câu không mang thông tin, khẳng định không có bằng chứng.
5. Sai kiểu viết đã chọn hoặc xưng hô không nhất quán trong bài.
Tiêu chí minor: câu dài khó đọc, heading chung chung, khối callout/bảng/checklist đặt cho có, thiếu liên kết nội bộ, title hay meta chưa nêu lợi ích.
Không bắt lỗi về độ dài nếu bài đã trả lời trọn nhu cầu.

Thông tin nền (toàn bộ dữ kiện được phép):
${briefBlock(brief, entity, '', input.interview)}
- Kiểu viết: ${CONTENT_STYLES[style].name}
- Điểm khác biệt đã chốt: ${plan.differentiators.join('; ')}
${page.targetKeyword ? '- Từ khóa mục tiêu: ' + page.targetKeyword : ''}

Nội dung (JSON):
${JSON.stringify(toLlmPage(page))}`;
    return this.structured({ model: this.editorModel, system, user, schema: LlmReviewSchema, maxTokens: 4000 });
  }

  async extractEntityFromInterview(input: { brief: SiteBrief; entity: EntityData; interview: InterviewData }): Promise<LlmEntitySuggest> {
    const system = 'Bạn là chuyên viên dữ liệu có cấu trúc (schema.org). Bạn rút thông tin thực thể doanh nghiệp từ câu trả lời phỏng vấn, tuyệt đối không suy đoán, không thêm gì không có trong câu trả lời. Trả về JSON đúng cấu trúc.';
    const user = `Từ các câu trả lời dưới đây, rút ra thông tin cho Entity SEO. Quy tắc:
- Trường nào không có thông tin rõ ràng thì để chuỗi rỗng hoặc mảng rỗng.
- legalName: tên pháp lý đầy đủ; alternateName: các tên gọi khác (không lặp tên chính "${input.brief.brandName}").
- description: 1 đến 2 câu, viết lại gọn từ câu trả lời, không thêm tính từ quảng cáo.
- foundingDate: năm hoặc ngày dạng YYYY hoặc YYYY-MM-DD.
- telephone: đúng số như trong câu trả lời; email: đúng địa chỉ.
- streetAddress: số nhà và đường; addressLocality: thành phố/quận; addressRegion: tỉnh.
- openingHours: định dạng schema.org, ví dụ "Mo-Su 05:30-12:00", "Mo-Fr 08:00-17:00"; nghỉ ngày nào thì bỏ ngày đó.
- priceRange: chỉ khi chủ doanh nghiệp cho phép công bố, dạng "40.000đ - 50.000đ"; nếu ghi "không công bố" thì để rỗng.
- areaServed: các khu vực phục vụ/giao hàng.
- facebook, zalo, youtube, tiktok, instagram, googleMaps: URL đầy đủ nếu có.
- authorName/authorJobTitle/authorBio: người đại diện phát ngôn hoặc phụ trách nội dung nếu được nêu.

Thương hiệu: ${input.brief.brandName}; ngành: ${input.brief.industry}

${interviewBlock(input.interview, 20_000)}`;
    return this.structured({ model: this.editorModel, system, user, schema: LlmEntitySuggestSchema, maxTokens: 4000 });
  }

  async suggestPostTopics(input: { brief: SiteBrief; plan: SitePlan; existingTitles: string[]; count: number }): Promise<SitePlan['posts']> {
    const { brief, plan, existingTitles, count } = input;
    const style = plan.contentStyle ?? resolveContentStyle(brief);
    const user = `Đề xuất ${count} chủ đề bài blog mới cho website sau, hợp kiểu viết "${CONTENT_STYLES[style].name}". Trả về JSON.

Thương hiệu: ${brief.brandName}; ngành: ${brief.industry}; khu vực: ${brief.location || 'không giới hạn'}
Từ khóa gốc: ${brief.keywords.join(', ') || 'chưa có'}
Insight khách hàng: ${plan.audienceInsight}
Bài đã có (không trùng chủ đề): ${existingTitles.join(' | ') || 'chưa có'}

Mỗi chủ đề: title 50 đến 65 ký tự có con số hoặc lợi ích cụ thể, targetKeyword là từ khóa dài chưa dùng, angle nêu rõ góc tiếp cận và giá trị cho người đọc, imageQuery 2 đến 4 từ tiếng Anh.`;
    const out = await this.structured({ model: this.model, system: systemPrompt(brief, style), user, schema: LlmTopicsSchema });
    return out.posts.map((p) => ({ ...p, slug: slugify(p.title) }));
  }
}

/* ------------------------------------------------------------------ */
/*  Chuyển đổi                                                          */
/* ------------------------------------------------------------------ */

export function planFromLlm(out: LlmPlan): SitePlan {
  return {
    ...out,
    services: out.services.map((s) => ({ ...s, slug: slugify(s.name) })),
    posts: out.posts.map((p) => ({ ...p, slug: slugify(p.title) })),
  };
}

export function pageFromLlm(kind: PageContent['kind'], out: LlmPage, post?: SitePlan['posts'][number]): PageContent {
  return {
    kind,
    title: out.title,
    metaDescription: out.metaDescription,
    h1: out.h1,
    intro: out.intro,
    sections: out.sections.map((s) => ({ heading: s.heading, body: s.body, imageQuery: s.imageQuery || undefined })),
    faq: out.faq,
    heroImageQuery: post?.imageQuery,
    heroImageAlt: out.heroImageAlt || undefined,
    keyTakeaways: out.keyTakeaways.length ? out.keyTakeaways : undefined,
    excerpt: out.excerpt || undefined,
    targetKeyword: out.targetKeyword || post?.targetKeyword,
    services: kind === 'services' && out.services.length ? out.services.map((s) => ({ ...s, slug: slugify(s.name) })) : undefined,
  };
}

export function toLlmPage(page: PageContent): LlmPage {
  return {
    title: page.title,
    metaDescription: page.metaDescription,
    h1: page.h1,
    intro: page.intro,
    excerpt: page.excerpt ?? '',
    targetKeyword: page.targetKeyword ?? '',
    heroImageAlt: page.heroImageAlt ?? '',
    keyTakeaways: page.keyTakeaways ?? [],
    sections: page.sections.map((s) => ({ heading: s.heading, body: s.body, imageQuery: s.imageQuery ?? '' })),
    faq: page.faq,
    services: (page.services ?? []).map((s) => ({ name: s.name, summary: s.summary, body: s.body, imageQuery: s.imageQuery })),
  };
}
