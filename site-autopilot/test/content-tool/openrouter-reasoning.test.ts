import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEEPSEEK, DeepSeekContentLlm, OpenRouterContentLlm, looksLikeSchemaEcho, readSse, schemaExample } from '../../src/content-tool/services/openrouter.js';

/** Dựng phản hồi SSE giả như OpenRouter trả về. */
function sse(chunks: object[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const delta = (d: Record<string, unknown>, finish: string | null = null, usage?: Record<string, unknown>) => ({ choices: [{ delta: d, finish_reason: finish }], ...(usage ? { usage } : {}) });

describe('OpenRouter với model suy luận', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('readSse gom cả phần suy nghĩ và số token suy nghĩ', async () => {
    const r = await readSse(sse([delta({ reasoning: 'Tôi nghĩ ' }), delta({ reasoning: 'đã...' }), delta({ content: '{"english":' }), delta({ content: '"beef noodle"}' }, 'stop', { prompt_tokens: 10, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 480 } })]));
    expect(r.text).toBe('{"english":"beef noodle"}');
    expect(r.reasoning).toBe('Tôi nghĩ đã...');
    expect(r.finishReason).toBe('stop');
    expect(r.usage.reasoning).toBe(480);
  });

  it('bị cắt vì suy nghĩ hết trần: gọi lại với mức suy nghĩ thấp và trần cao hơn, rồi thành công', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (bodies.length === 1) return sse([delta({ reasoning: 'suy nghĩ rất dài...' }, 'length', { prompt_tokens: 100, completion_tokens: 4000, completion_tokens_details: { reasoning_tokens: 4000 } })]);
      return sse([delta({ content: '{"english":"pho"}' }, 'stop', { prompt_tokens: 100, completion_tokens: 20 })]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const llm = new OpenRouterContentLlm({ apiKey: 'k', writerModel: 'deepseek/deepseek-v4-flash', researchModel: 'deepseek/deepseek-v4-flash', reasoning: 'medium' });
    const out = await llm.translateKeyword('phở');
    expect(out).toBe('pho');
    expect(bodies.length).toBe(2);
    expect((bodies[0]!.reasoning as { effort: string }).effort).toBe('medium'); // mặc định của tùy chọn
    expect(bodies[1]!.reasoning).toEqual({ enabled: false }); // lượt cứu tắt suy nghĩ
    expect(bodies[1]!.max_tokens).toBe(6000); // 4000 × 1.5
    const msgs = bodies[1]!.messages as { content: string }[];
    expect(String(msgs[msgs.length - 1]!.content)).toContain('trả lời ngay bằng JSON');
    expect(llm.usage().calls).toBe(2);
  });

  it('nội dung rỗng nhưng JSON nằm trong phần suy nghĩ thì vẫn dùng được', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse([delta({ reasoning: 'Kết quả: {"english":"bun bo"}' }, 'stop', { prompt_tokens: 5, completion_tokens: 30 })])),
    );
    const llm = new OpenRouterContentLlm({ apiKey: 'k', writerModel: 'x/y', researchModel: 'x/y' });
    expect(await llm.translateKeyword('bún bò')).toBe('bun bo');
  });

  it('cắt hai lần liên tiếp thì báo lỗi rõ là model suy luận', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse([delta({ reasoning: 'x' }, 'length', { prompt_tokens: 5, completion_tokens: 4000, completion_tokens_details: { reasoning_tokens: 4000 } })])),
    );
    const llm = new OpenRouterContentLlm({ apiKey: 'k', writerModel: 'deepseek/deepseek-v4-flash', researchModel: 'deepseek/deepseek-v4-flash' });
    await expect(llm.translateKeyword('phở')).rejects.toThrow(/model suy luận/);
  });

  it('rơi kết nối giữa luồng thì tự gọi lại, lỗi 402 giữa luồng thì dừng ngay', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        if (calls === 1) return sse([delta({ content: '{"eng' }), { error: { code: 502, message: 'Network connection lost.' } }]);
        return sse([delta({ content: '{"english":"pho"}' }, 'stop', { prompt_tokens: 1, completion_tokens: 5 })]);
      }),
    );
    const llm = new OpenRouterContentLlm({ apiKey: 'k', writerModel: 'x/y', researchModel: 'x/y' });
    expect(await llm.translateKeyword('phở')).toBe('pho');
    expect(calls).toBe(2);
    vi.stubGlobal('fetch', vi.fn(async () => sse([{ error: { code: 402, message: 'Insufficient credits' } }])));
    await expect(new OpenRouterContentLlm({ apiKey: 'k', writerModel: 'x/y', researchModel: 'x/y' }).translateKeyword('a')).rejects.toThrow(/Insufficient credits/);
  });

  it('mức suy nghĩ mặc định lấy từ tùy chọn khi lượt gọi không chỉ định', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return sse([delta({ content: '{"english":"ok"}' }, 'stop', { prompt_tokens: 1, completion_tokens: 1 })]);
      }),
    );
    const llm = new OpenRouterContentLlm({ apiKey: 'k', writerModel: 'x/y', researchModel: 'x/y', reasoning: 'high', temperature: 1.3 });
    await llm.translateKeyword('a');
    // translateKeyword không đặt reasoning → dùng mặc định "high" của tùy chọn; nhiệt độ chỉ áp cho viết/biên tập/sửa
    expect((bodies[0]!.reasoning as { effort: string }).effort).toBe('high');
    expect(bodies[0]!.temperature).toBeUndefined();
  });
});

describe('DeepSeek qua API trực tiếp (platform.deepseek.com)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gọi api.deepseek.com với json_object, kèm cấu trúc trong prompt, không gửi mức suy nghĩ, trần 8K cho deepseek-chat', async () => {
    const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown>, headers: init?.headers as Record<string, string> });
        return sse([delta({ reasoning_content: 'nghĩ chút...' }), delta({ content: '{"english":"pho"}' }, 'stop', { prompt_tokens: 1000, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 20 } })]);
      }),
    );
    const llm = new DeepSeekContentLlm({ apiKey: 'k', writerModel: 'deepseek-chat', researchModel: 'deepseek-chat', temperature: 1.5 });
    expect(llm.provider).toBe('deepseek');
    expect(await llm.translateKeyword('phở')).toBe('pho');
    const c = calls[0]!;
    expect(c.url).toBe('https://api.deepseek.com/chat/completions');
    expect(c.headers.Authorization).toBe('Bearer k');
    expect(c.headers['X-OpenRouter-Title']).toBeUndefined();
    expect(c.body.response_format).toEqual({ type: 'json_object' });
    expect(c.body.stream_options).toEqual({ include_usage: true });
    expect(c.body.reasoning).toBeUndefined();
    expect(c.body.provider).toBeUndefined();
    expect(Number(c.body.max_tokens)).toBeLessThanOrEqual(8192);
    const msgs = c.body.messages as { content: string }[];
    expect(msgs[msgs.length - 1]!.content).toContain('TRẢ VỀ DUY NHẤT một JSON');
    // API không trả chi phí: ước tính theo bảng giá (1000 vào × 0,28 + 500 ra × 0,42 trên mỗi triệu token)
    expect(llm.usage().usd).toBeCloseTo((1000 * 0.28 + 500 * 0.42) / 1e6, 8);
  });

  it('deepseek-reasoner được trần 64K; lỗi 401 báo sai key DeepSeek', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return sse([delta({ content: '{"english":"ok"}' }, 'stop', { prompt_tokens: 1, completion_tokens: 1 })]);
      }),
    );
    await new DeepSeekContentLlm({ apiKey: 'k', writerModel: 'deepseek-reasoner', researchModel: 'deepseek-reasoner' }).translateKeyword('a');
    expect(Number(bodies[0]!.max_tokens)).toBe(4000); // lượt dịch chỉ xin 4000, dưới trần nên giữ nguyên
    expect(DEEPSEEK.maxOutput('deepseek-chat')).toBe(8192);
    expect(DEEPSEEK.maxOutput('deepseek-reasoner')).toBe(65536);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"Authentication Fails"}}', { status: 401 })));
    await expect(new DeepSeekContentLlm({ apiKey: 'bad', writerModel: 'deepseek-chat', researchModel: 'deepseek-chat' }).translateKeyword('a')).rejects.toThrow(/DeepSeek từ chối API key/);
    expect(() => new DeepSeekContentLlm({ apiKey: '', writerModel: 'deepseek-chat', researchModel: 'deepseek-chat' })).toThrow(/DeepSeek API key/);
  });
});

describe('mẫu JSON thay cho schema thô', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('dựng mẫu có giá trị giữ chỗ từ JSON schema, kể cả $ref và enum', () => {
    const ex = schemaExample({
      type: 'object',
      properties: { places: { type: 'array', items: { $ref: '#/$defs/P' } }, level: { enum: ['low', 'high'] }, ok: { type: 'boolean' }, n: { anyOf: [{ type: 'number' }, { type: 'null' }] } },
      $defs: { P: { type: 'object', properties: { index: { type: 'number' }, praised: { type: 'array', items: { type: 'string' } } } } },
    });
    expect(ex).toEqual({ places: [{ index: 0, praised: ['chuỗi'] }], level: 'low', ok: true, n: 0 });
    expect(looksLikeSchemaEcho('{"type":"object","properties":{"places":{"type":"array"}}}')).toBe(true);
    expect(looksLikeSchemaEcho('{"places":[{"index":1}]}')).toBe(false);
  });

  it('DeepSeek chép lại mẫu cấu trúc thì gọi lại kèm lời nhắc, lần sau điền dữ liệu thì nhận', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (bodies.length === 1) return sse([delta({ content: '{"type":"object","properties":{"english":{"type":"string"}},"required":["english"],"additionalProperties":false}' }, 'stop', { prompt_tokens: 1, completion_tokens: 30 })]);
        return sse([delta({ content: '{"english":"crab noodle soup"}' }, 'stop', { prompt_tokens: 1, completion_tokens: 10 })]);
      }),
    );
    const llm = new DeepSeekContentLlm({ apiKey: 'k', writerModel: 'deepseek-chat', researchModel: 'deepseek-chat' });
    expect(await llm.translateKeyword('bún riêu')).toBe('crab noodle soup');
    expect(bodies.length).toBe(2);
    const last = (b: Record<string, unknown>) => (b.messages as { content: string }[]).slice(-1)[0]!.content;
    // Prompt gửi mẫu có giá trị giữ chỗ, không gửi schema thô
    expect(last(bodies[0]!)).toContain('MẪU:\n{"english":"chuỗi"}');
    expect(last(bodies[0]!)).not.toContain('"properties":{');
    expect(last(bodies[1]!)).toContain('lần trước bạn trả về bản mô tả cấu trúc');
  });
});

describe('nhà cung cấp hỏng giữa luồng và model suy luận không giảm được', () => {
  afterEach(() => vi.unstubAllGlobals());
  const okChunk = () => sse([delta({ content: '{"english":"pho"}' }, 'stop', { prompt_tokens: 1, completion_tokens: 5 })]);

  it('finish_reason=error kèm nội dung dở, hoặc luồng đóng không có finish_reason và không có nội dung: gọi lại, không phân tích JSON dở', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        if (calls === 1) return sse([delta({ reasoning: 'nghĩ...' }), delta({ content: '{"english":"ph' }, 'error')]);
        if (calls === 2) return sse([delta({ reasoning: 'chỉ có suy nghĩ, rồi đứt' })]);
        return okChunk();
      }),
    );
    const llm = new OpenRouterContentLlm({ apiKey: 'k', writerModel: 'x/y', researchModel: 'x/y' });
    expect(await llm.translateKeyword('phở')).toBe('pho');
    expect(calls).toBe(3);
  });

  it('JSON nháp trong phần suy nghĩ ({"title": "..."}) không được nhận; lượt cứu tắt suy nghĩ', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (bodies.length === 1) return sse([delta({ reasoning: 'Cấu trúc sẽ là {"english": "..."} rồi tôi điền' }, 'stop', { prompt_tokens: 1, completion_tokens: 300, completion_tokens_details: { reasoning_tokens: 300 } })]);
        return okChunk();
      }),
    );
    const llm = new OpenRouterContentLlm({ apiKey: 'k', writerModel: 'openai/gpt-x', researchModel: 'openai/gpt-x', reasoning: 'medium' });
    expect(await llm.translateKeyword('phở')).toBe('pho');
    expect(bodies.length).toBe(2);
    expect(bodies[0]!.reasoning).toEqual({ effort: 'medium' });
    expect(bodies[1]!.reasoning).toEqual({ enabled: false });
  });

  it('model deepseek trên OpenRouter ở mức thấp thì tắt suy nghĩ; r1 giữ mức; cài đặt "off" tắt cho mọi model', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return okChunk();
      }),
    );
    await new OpenRouterContentLlm({ apiKey: 'k', writerModel: 'deepseek/deepseek-v4-flash-0731', researchModel: 'deepseek/deepseek-v4-flash-0731' }).translateKeyword('a');
    await new OpenRouterContentLlm({ apiKey: 'k', writerModel: 'deepseek/deepseek-r1', researchModel: 'deepseek/deepseek-r1' }).translateKeyword('a');
    await new OpenRouterContentLlm({ apiKey: 'k', writerModel: 'deepseek/deepseek-v4-flash-0731', researchModel: 'deepseek/deepseek-v4-flash-0731', reasoning: 'medium' }).translateKeyword('a');
    await new OpenRouterContentLlm({ apiKey: 'k', writerModel: 'openai/gpt-x', researchModel: 'openai/gpt-x', reasoning: 'off' }).translateKeyword('a');
    expect(bodies.map((b) => b.reasoning)).toEqual([{ enabled: false }, { effort: 'low' }, { effort: 'medium' }, { enabled: false }]);
  });
});
