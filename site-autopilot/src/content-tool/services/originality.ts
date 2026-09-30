import type { AiDetector } from './types.js';
import type { AiDetectReport } from '../core/types.js';
import { AppError, ConfigError, TransientError } from '../core/errors.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('originality');

const BASE_V3 = 'https://api.originality.ai/api/v3';
const BASE_V1 = 'https://api.originality.ai/api/v1';

interface V3Block {
  text: string;
  result: { fake: number; real: number; status: string };
}

interface V3Response {
  results?: {
    properties?: { id?: string; publicLink?: string; title?: string };
    credits?: { used?: number; remaining?: number };
    ai?: { aiModel?: string; confidence?: { AI?: number; Original?: number }; blocks?: V3Block[] };
    plagiarism?: { score?: number; results?: { phrase: string; results: { link: string; title: string; scores: { score: number; sentence: string }[] }[] }[] };
  };
  error?: string;
  message?: string;
}

/**
 * Originality.ai API v3. Model "multilang" hỗ trợ tiếng Việt.
 * Điểm AI trả về 0..1 (confidence.AI); từng câu nằm trong blocks với result.fake.
 */
export class OriginalityDetector implements AiDetector {
  readonly id = 'originality' as const;

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new ConfigError('Chưa có Originality.ai API key. Vào Cài đặt → Khóa API để nhập, hoặc bật "Bỏ qua quét AI".');
  }

  async scan(text: string, opts: { title: string; model: string; plagiarism: boolean; aiScoreMax: number; plagiarismMax?: number }): Promise<AiDetectReport> {
    const body = {
      title: (opts.title || 'viet-content').slice(0, 200),
      content: text,
      aiModelVersion: opts.model || 'multilang',
      check_ai: true,
      check_plagiarism: opts.plagiarism,
      check_facts: false,
      check_readability: false,
      check_grammar: false,
      check_contentQuality: false,
      check_ai_allowance: false,
      storeScan: true,
    };
    let res: Response;
    try {
      res = await fetch(`${BASE_V3}/scan`, {
        method: 'POST',
        headers: { 'X-OAI-API-KEY': this.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.plagiarism ? 150_000 : 90_000),
      });
    } catch (err) {
      throw new TransientError(`Originality.ai: không kết nối được (${(err as Error).message})`);
    }
    const raw = await res.text();
    let json: V3Response = {};
    try {
      json = JSON.parse(raw) as V3Response;
    } catch {
      /* không phải JSON */
    }
    if (!res.ok) {
      const detail = json.error ?? json.message ?? raw.slice(0, 300);
      if (res.status === 401 || res.status === 403) throw new ConfigError(`Originality.ai từ chối API key (HTTP ${res.status}): ${detail}`);
      if (res.status === 429 || res.status >= 500) throw new TransientError(`Originality.ai HTTP ${res.status}: ${detail}`);
      throw new AppError(`Originality.ai HTTP ${res.status}: ${detail}`);
    }
    const r = json.results;
    if (!r?.ai?.confidence) throw new AppError(`Originality.ai trả về dữ liệu không có điểm AI: ${raw.slice(0, 300)}`);
    const aiScore = Number(r.ai.confidence.AI ?? 0);
    const originalScore = Number(r.ai.confidence.Original ?? 1 - aiScore);
    const blocks = (r.ai.blocks ?? [])
      .filter((b) => b.result?.status === 'success' && b.text?.trim())
      .map((b) => ({ text: b.text.trim(), aiScore: Number(b.result.fake ?? 0), where: '' }));
    let plagiarism: AiDetectReport['plagiarism'] = null;
    if (opts.plagiarism && r.plagiarism) {
      const score = Number(r.plagiarism.score ?? 0) / 100;
      const byLink = new Map<string, number>();
      for (const p of r.plagiarism.results ?? []) {
        for (const m of p.results ?? []) {
          const best = Math.max(0, ...(m.scores ?? []).map((s) => Number(s.score ?? 0)));
          byLink.set(m.link, Math.max(byLink.get(m.link) ?? 0, best));
        }
      }
      const sources = [...byLink.entries()].map(([url, s]) => ({ url, percent: Math.round(s * 100) })).sort((a, b) => b.percent - a.percent);
      plagiarism = { score, sources, pass: score <= (opts.plagiarismMax ?? 0.1) };
    }
    const pass = aiScore <= opts.aiScoreMax && (plagiarism ? plagiarism.pass : true);
    log.info(`Originality.ai (${r.ai.aiModel ?? opts.model}): AI ${(aiScore * 100).toFixed(1)}%, ${blocks.length} câu, credits ${r.credits?.used ?? '?'}`);
    return {
      provider: 'originality',
      aiScore,
      originalScore,
      blocks,
      creditsUsed: r.credits?.used ?? null,
      creditsRemaining: r.credits?.remaining ?? null,
      scanId: r.properties?.id ?? null,
      publicLink: r.properties?.publicLink ?? null,
      pass,
      skipped: false,
      error: null,
      plagiarism,
    };
  }

  /** Đọc số credit còn lại (endpoint v1), không tốn credit. */
  async verify(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch(`${BASE_V1}/account/credits/balance`, { headers: { 'X-OAI-API-KEY': this.apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
      const raw = await res.text();
      if (!res.ok) return { ok: false, message: `Originality.ai HTTP ${res.status}: ${raw.slice(0, 200)}` };
      let credits: unknown = raw;
      try {
        const j = JSON.parse(raw) as Record<string, unknown>;
        credits = j.credits ?? j.balance ?? j.data ?? j;
      } catch {
        /* giữ raw */
      }
      return { ok: true, message: `Originality.ai OK. Credit: ${typeof credits === 'object' ? JSON.stringify(credits) : String(credits)}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
}

/**
 * Chấm tay: không gọi API. Bước kiểm tra sẽ dừng, người dùng dán bài lên web Originality.ai
 * (gói trả trước, không cần Enterprise) và nhập điểm vào dashboard.
 */
export class ManualDetector implements AiDetector {
  readonly id = 'manual' as const;

  async scan(): Promise<AiDetectReport> {
    throw new AppError('Chế độ chấm tay không quét tự động');
  }

  async verify(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Chế độ chấm tay: tool sẽ dừng ở bước kiểm tra, bạn dán bài lên web Originality.ai (model Multi Language) rồi nhập điểm. Không cần API key.' };
  }
}

/** Không quét AI (người dùng tắt): coi như đạt, ghi rõ là bỏ qua. */
export class NoopDetector implements AiDetector {
  readonly id = 'none' as const;
  constructor(private readonly reason: string) {}

  async scan(): Promise<AiDetectReport> {
    return { provider: 'none', aiScore: 0, originalScore: 1, blocks: [], creditsUsed: null, creditsRemaining: null, scanId: null, publicLink: null, pass: true, skipped: true, error: this.reason, plagiarism: null };
  }

  async verify(): Promise<{ ok: boolean; message: string }> {
    return { ok: false, message: this.reason };
  }
}
