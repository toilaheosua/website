import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import type { ContentGenerator, InternalLink } from './types.js';
import type { EntityData, PageContent, SiteBrief, SitePlan } from '../core/types.js';
import { LlmPageSchema, LlmPlanSchema, LlmTopicsSchema, type LlmPage, type LlmPlan } from '../generator/llm-schemas.js';
import { CONTENT_STYLES, contentStyleGuide, ENGAGEMENT_RULES, resolveContentStyle, type ContentStyleId } from '../generator/content-styles.js';
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

function systemPrompt(brief: SiteBrief, style: ContentStyleId): string {
  const lang = languageName(brief.language);
  return `Bạn là chiến lược gia nội dung kiêm copywriter cấp cao, chuyên viết website cho doanh nghiệp nhỏ và blog chuyên ngành. Toàn bộ nội dung viết bằng ${lang}, đúng chính tả, đủ dấu, giọng tự nhiên như người trong nghề viết cho khách hàng thật.

${contentStyleGuide(style)}

${ENGAGEMENT_RULES}

Nguyên tắc chất lượng (bắt buộc, vì nội dung sẽ được Google đánh giá theo tiêu chí hữu ích và E-E-A-T):
1. Cụ thể, có giá trị thực: mỗi đoạn phải đưa ra thông tin người đọc dùng được (quy trình, tiêu chí lựa chọn, lỗi thường gặp, ví dụ tình huống, chi phí tham khảo nếu hợp lý). Không viết đoạn chỉ để lấp chỗ.
2. Cấm câu sáo rỗng và khuôn mẫu AI: không dùng "trong thời đại 4.0", "không thể phủ nhận rằng", "hãy cùng tìm hiểu", "tóm lại", "như đã đề cập ở trên", "chúng tôi tự hào", "hàng đầu", "uy tín số 1", dấu gạch ngang dài, và không mở đầu mọi đoạn bằng cùng một cấu trúc.
3. Không bịa sự kiện: không tự nghĩ ra giải thưởng, chứng chỉ, số năm kinh nghiệm, số lượng khách hàng, giá cụ thể hay tên đối tác nếu brief không cung cấp. Nếu cần con số, dùng cách nói khoảng hoặc điều kiện ("thường dao động", "tùy quy mô").
4. Từ khóa dùng tự nhiên, xuất hiện ở tiêu đề, H1, đoạn mở đầu và vài chỗ hợp lý. Tuyệt đối không nhồi nhét.
5. Mỗi trang, mỗi bài phải có góc nhìn riêng, không lặp lại đoạn văn giữa các trang.
6. Markdown trong trường body: đoạn văn, danh sách "- ", danh sách đánh số "1. ", in đậm **, bảng markdown, callout dạng "> **Mẹo:** ...", liên kết [chữ](đường dẫn). Không dùng thẻ HTML, không dùng tiêu đề # bên trong body vì heading đã có trường riêng.
7. imageQuery: 2 đến 4 từ tiếng Anh mô tả ảnh minh họa tìm trên kho ảnh stock (ví dụ "electrician repairing panel"). Không dùng tên thương hiệu.
8. Trả về đúng cấu trúc JSON được yêu cầu, mọi trường đều có giá trị; trường không dùng để chuỗi rỗng hoặc mảng rỗng.`;
}

function briefBlock(brief: SiteBrief, entity: EntityData, domain: string): string {
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
  return lines.join('\n');
}

function linksBlock(links: InternalLink[] | undefined): string {
  if (!links?.length) return '';
  return `Đường dẫn nội bộ được phép dùng trong liên kết (chỉ dùng đúng các đường dẫn này):\n${links.map((l) => `- ${l.path} : ${l.label}`).join('\n')}`;
}

const PAGE_GUIDES: Record<PageContent['kind'], string> = {
  home: `Trang chủ. Mục tiêu: trong 5 giây người đọc hiểu doanh nghiệp làm gì, cho ai, vì sao nên chọn. Cấu trúc: h1 chứa từ khóa chính và khu vực; intro 2 đến 3 câu theo đúng kỹ thuật móc câu; 4 đến 6 section: giới thiệu ngắn theo kiểu viết đã chọn, các dịch vụ chính (tóm tắt, chi tiết để trang dịch vụ), lý do lựa chọn (dựa trên điểm khác biệt trong brief, không bịa), quy trình làm việc hoặc trải nghiệm khách, khu vực phục vụ, kêu gọi liên hệ. faq: 4 đến 6 câu hỏi khách thật sự hay hỏi. services và keyTakeaways để rỗng.`,
  about: `Trang Giới thiệu. Kể câu chuyện doanh nghiệp một cách đáng tin theo kiểu viết đã chọn: xuất phát điểm, cách làm việc, giá trị theo đuổi, đội ngũ (chỉ nêu người có trong brief), cam kết. 3 đến 5 section. Có một section về tác giả/người phụ trách nội dung nếu brief có tên. faq, services, keyTakeaways để rỗng.`,
  services: `Trang Dịch vụ tổng hợp. intro nêu phạm vi dịch vụ theo kỹ thuật móc câu. Trường services: mỗi dịch vụ trong kế hoạch một mục với body 150 đến 300 từ: phù hợp với ai, gồm những gì, quy trình, điều cần lưu ý, kết quả mong đợi, có callout hoặc checklist khi hợp lý. sections: 1 đến 2 section chung (cách báo giá, cam kết). faq: 3 đến 5 câu. keyTakeaways để rỗng.`,
  blog: `Trang danh sách Blog. Chỉ cần title, metaDescription, h1, intro 2 đến 3 câu mô tả blog viết về gì và cho ai. sections, faq, services, keyTakeaways để rỗng.`,
  post: `Bài viết blog 1200 đến 1800 từ, thật sự hữu ích, đúng góc nhìn (angle) được giao, tối ưu tự nhiên cho từ khóa mục tiêu, viết theo kiểu viết đã chọn. keyTakeaways: 3 đến 5 ý "Tóm tắt nhanh". intro theo kỹ thuật móc câu. 5 đến 8 section với heading có thông tin; có ít nhất một bảng hoặc checklist, một ví dụ tình huống, một đến hai callout, hai đến ba liên kết nội bộ đặt giữa bài. Section cuối là "Bước tiếp theo" nói rõ việc nên làm ngay và cách liên hệ. excerpt 1 đến 2 câu có lợi ích cụ thể. faq 2 đến 4 câu liên quan trực tiếp. services để rỗng.`,
  contact: `Trang Liên hệ. intro thân thiện nêu cách liên hệ nhanh nhất và thời gian phản hồi hợp lý (không cam kết số cụ thể nếu brief không có). 2 đến 3 section: thông tin liên hệ (dùng đúng dữ liệu trong brief, không bịa), khu vực phục vụ, điều nên chuẩn bị trước khi liên hệ (checklist). faq, services, keyTakeaways để rỗng.`,
  privacy: `Trang Chính sách bảo mật cho website giới thiệu doanh nghiệp: thu thập thông tin gì (form liên hệ, cookie phân tích), dùng để làm gì, lưu trữ và chia sẻ với ai (chỉ đơn vị phân tích như Google Analytics nếu có), quyền của người dùng, cách liên hệ về quyền riêng tư, ngày cập nhật ghi "Cập nhật lần cuối: theo ngày xuất bản". 5 đến 7 section ngắn, giọng rõ ràng, không cần kỹ thuật móc câu. faq, services, keyTakeaways để rỗng.`,
};

const EDITOR_CHECKLIST = `Bạn là biên tập viên kỳ cựu. Hãy sửa lại nội dung JSON sau theo danh sách kiểm tra, giữ nguyên cấu trúc và ý chính, trả về JSON cùng cấu trúc:
1. Hai câu đầu của intro phải là móc câu: nói đúng tình huống hoặc lợi ích cụ thể của người đọc, xưng "bạn". Nếu đang mở bằng định nghĩa hay câu chung chung, viết lại.
2. Xóa hoặc viết lại mọi câu sáo rỗng, câu không mang thông tin, câu mở đầu kiểu AI, dấu gạch ngang dài.
3. Thêm chi tiết cụ thể ở những đoạn còn chung chung: tiêu chí, bước làm, ví dụ tình huống, lưu ý thực tế. Không thêm số liệu, giải thưởng hay chứng chỉ không có trong brief.
4. Đảm bảo có đủ yếu tố giữ chân: ít nhất một callout "> **Mẹo:**" hoặc "> **Lưu ý:**", bảng hoặc checklist khi nội dung có so sánh hay liệt kê việc, hai đến ba liên kết nội bộ đặt giữa bài chỉ dùng đường dẫn được cấp, đoạn cuối "Bước tiếp theo" cụ thể.
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

  async generatePlan(input: { brief: SiteBrief; entity: EntityData; domain: string; contentStyle?: ContentStyleId }): Promise<SitePlan> {
    const { brief, entity, domain } = input;
    const style = input.contentStyle ?? resolveContentStyle(brief);
    const servicesCount = brief.siteType === 'blog' ? '3 chủ đề trụ cột (đóng vai trò "dịch vụ" về mặt cấu trúc, đặt tên như chuyên mục)' : brief.services.length ? `đúng ${brief.services.length} dịch vụ theo brief, giữ đúng tên` : '4 đến 6 dịch vụ hợp lý với ngành';
    const user = `Lập kế hoạch nội dung cho website dưới đây, theo kiểu viết "${CONTENT_STYLES[style].name}". Trả về JSON.

${briefBlock(brief, entity, domain)}

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

  async generatePage(input: { brief: SiteBrief; entity: EntityData; plan: SitePlan; domain: string; kind: PageContent['kind']; post?: SitePlan['posts'][number]; existingTitles?: string[]; internalLinks?: InternalLink[] }): Promise<PageContent> {
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

${briefBlock(brief, entity, domain)}

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
    const out = await this.structured({ model: this.model, system: systemPrompt(brief, style), user, schema: LlmPageSchema, maxTokens: 20_000 });
    return pageFromLlm(kind, out, post);
  }

  async editPage(input: { brief: SiteBrief; plan: SitePlan; page: PageContent; internalLinks?: InternalLink[] }): Promise<PageContent> {
    const { brief, plan, page } = input;
    const style = plan.contentStyle ?? resolveContentStyle(brief);
    const user = `${EDITOR_CHECKLIST}

Thông tin nền:
- Thương hiệu: ${brief.brandName}, ngành: ${brief.industry}${brief.location ? ', khu vực: ' + brief.location : ''}
- Kiểu viết: ${CONTENT_STYLES[style].name}
- Giọng văn thương hiệu: ${plan.brandVoice}
- Loại trang: ${page.kind}${page.targetKeyword ? ', từ khóa mục tiêu: ' + page.targetKeyword : ''}
${linksBlock(input.internalLinks)}

Nội dung cần biên tập (JSON):
${JSON.stringify(toLlmPage(page))}`;
    const out = await this.structured({ model: this.editorModel, system: systemPrompt(brief, style), user, schema: LlmPageSchema, maxTokens: 20_000 });
    const edited = pageFromLlm(page.kind, out);
    return { ...page, ...edited, kind: page.kind, publishedAt: page.publishedAt };
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
