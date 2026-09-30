import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { strictJsonSchema } from '../../src/content-tool/services/openrouter.js';
import { extractJsonText } from '../../src/content-tool/services/llm-base.js';
import { LlmArticleSchema } from '../../src/content-tool/generator/llm-schemas.js';

describe('OpenRouter: schema và trích JSON', () => {
  it('schema strict: mọi object có additionalProperties=false và required đủ trường', () => {
    const js = strictJsonSchema(z.toJSONSchema(LlmArticleSchema, { reused: 'ref' })) as { additionalProperties: boolean; required: string[]; properties: Record<string, { type?: string; items?: { additionalProperties?: boolean; required?: string[] } }> };
    expect(js.additionalProperties).toBe(false);
    expect(js.required).toContain('sections');
    expect(js.required.length).toBe(Object.keys(js.properties).length);
    const sections = js.properties.sections!;
    expect(sections.type).toBe('array');
    expect(sections.items!.additionalProperties).toBe(false);
    expect(sections.items!.required).toEqual(['heading', 'level', 'body']);
  });

  it('trích JSON từ văn bản có rào code hoặc lời dẫn', () => {
    expect(extractJsonText('Đây là kết quả:\n```json\n{"a":1}\n```\nXong.')).toBe('{"a":1}');
    expect(extractJsonText('Kết quả {"a":{"b":[1,2]}} hết')).toBe('{"a":{"b":[1,2]}}');
    expect(JSON.parse(extractJsonText('{"english":"beef noodle soup"}'))).toEqual({ english: 'beef noodle soup' });
  });
});
