import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { SecretStore, loadMasterKey, type SecretName } from '../core/secrets.js';
import { ConfigError } from '../core/errors.js';
import type { IntegrationStatus, Services } from './types.js';
import { ClaudeSearchProvider, GoogleCseProvider, SerpApiProvider } from './search.js';
import { HtmlPageFetcher } from './fetcher.js';
import { SerpApiMapsProvider } from './maps.js';
import { AnthropicContentLlm } from './anthropic.js';
import { DeepSeekContentLlm, OpenRouterContentLlm } from './openrouter.js';
import type { LlmProvider } from '../core/types.js';
import { ManualDetector, NoopDetector, OriginalityDetector } from './originality.js';
import type { GeneralSettings } from '../core/types.js';

/** Chế độ lấy điểm AI thực tế sau khi giải "auto" theo việc có key hay không. */
export function resolveDetectorMode(s: GeneralSettings, hasKey: boolean): 'api' | 'manual' | 'off' {
  if (s.skipAiDetection || s.detectorMode === 'off') return 'off';
  if (s.detectorMode === 'api') return 'api';
  if (s.detectorMode === 'manual') return 'manual';
  return hasKey ? 'api' : 'manual';
}
import { MockDetector, MockFetcher, MockLlm, MockMapsProvider, MockSearchProvider } from './mock.js';

export function createServices(config: AppConfig, db: Db, sharedSecrets?: SecretStore): Services {
  // Kho khóa dùng chung với dashboard bot khi được truyền vào (khóa nhập một nơi, dùng cả hai bên)
  const secrets = sharedSecrets ?? new SecretStore(db, loadMasterKey(config.SESSION_SECRET, config.dataDir));
  const pick = (name: SecretName, env: string) => secrets.get(name) || env.trim();
  const source = (name: SecretName, env: string): 'dashboard' | 'env' | 'none' => (secrets.has(name) ? 'dashboard' : env.trim() ? 'env' : 'none');
  const settings = () => db.getGeneralSettings();

  if (config.isMock) {
    const llm = new MockLlm();
    return {
      isMock: true,
      secrets,
      search: () => new MockSearchProvider(),
      maps: () => new MockMapsProvider(),
      fetcher: () => new MockFetcher(),
      llm: () => llm,
      llmWith: (spec) => new MockLlm(spec.writerModel),
      detector: () => {
        const mode = resolveDetectorMode(settings(), true);
        if (mode === 'manual') return new ManualDetector();
        if (mode === 'off') return new NoopDetector('Đã tắt quét AI trong Cài đặt.');
        return new MockDetector();
      },
      integrations: (): IntegrationStatus => {
        const s = settings();
        const mode = resolveDetectorMode(s, true);
        return {
          llmProvider: s.llmProvider,
          anthropic: { configured: true, source: 'env', writerModel: 'mock', researchModel: 'mock' },
          openrouter: { configured: true, source: 'env', writerModel: 'mock', researchModel: 'mock' },
          deepseek: { configured: true, source: 'env', writerModel: 'mock', researchModel: 'mock' },
          search: { provider: s.searchProvider, configured: true, source: 'env' },
          originality: { configured: true, source: 'env', model: s.originalityModel, skipped: mode === 'off', mode },
        };
      },
    };
  }

  const anthropicKey = () => pick('anthropic_key', config.ANTHROPIC_API_KEY);

  return {
    isMock: false,
    secrets,
    search() {
      const s = settings();
      switch (s.searchProvider) {
        case 'serpapi':
          return new SerpApiProvider(pick('serpapi_key', config.SERPAPI_KEY), { googleDomain: s.googleDomain, country: s.country, language: s.language });
        case 'google_cse':
          return new GoogleCseProvider(pick('google_cse_key', config.GOOGLE_CSE_KEY), pick('google_cse_cx', config.GOOGLE_CSE_CX), { country: s.country, language: s.language });
        case 'claude':
          return new ClaudeSearchProvider(anthropicKey(), s.researchModel || config.ANTHROPIC_RESEARCH_MODEL || s.writerModel);
        default:
          throw new ConfigError(`Nhà cung cấp tìm kiếm không hợp lệ: ${String(s.searchProvider)}`);
      }
    },
    maps() {
      const s = settings();
      return new SerpApiMapsProvider(pick('serpapi_key', config.SERPAPI_KEY), { googleDomain: s.googleDomain, country: s.country, language: s.language });
    },
    fetcher: () => new HtmlPageFetcher(),
    llm(provider?: LlmProvider, signal?: AbortSignal) {
      const s = settings();
      const p = provider ?? s.llmProvider;
      if (p === 'deepseek') {
        return new DeepSeekContentLlm({ apiKey: pick('deepseek_key', config.DEEPSEEK_API_KEY), writerModel: s.deepseekWriterModel, researchModel: s.deepseekResearchModel || s.deepseekWriterModel, temperature: s.deepseekTemperature, signal });
      }
      if (p === 'openrouter') {
        return new OpenRouterContentLlm({ apiKey: pick('openrouter_key', config.OPENROUTER_API_KEY), writerModel: s.openrouterWriterModel, researchModel: s.openrouterResearchModel || s.openrouterWriterModel, temperature: s.openrouterTemperature, reasoning: s.openrouterReasoning, signal });
      }
      const writerModel = s.writerModel || config.ANTHROPIC_MODEL;
      return new AnthropicContentLlm({ apiKey: anthropicKey(), writerModel, researchModel: s.researchModel || config.ANTHROPIC_RESEARCH_MODEL || writerModel, effort: s.effort, signal });
    },
    llmWith(spec, signal) {
      const s = settings();
      if (spec.provider === 'deepseek') {
        return new DeepSeekContentLlm({ apiKey: pick('deepseek_key', config.DEEPSEEK_API_KEY), writerModel: spec.writerModel, researchModel: spec.researchModel || s.deepseekResearchModel || spec.writerModel, temperature: spec.temperature ?? s.deepseekTemperature, signal });
      }
      if (spec.provider === 'openrouter') {
        return new OpenRouterContentLlm({ apiKey: pick('openrouter_key', config.OPENROUTER_API_KEY), writerModel: spec.writerModel, researchModel: spec.researchModel || s.openrouterResearchModel || spec.writerModel, temperature: spec.temperature ?? s.openrouterTemperature, reasoning: s.openrouterReasoning, signal });
      }
      return new AnthropicContentLlm({ apiKey: anthropicKey(), writerModel: spec.writerModel, researchModel: spec.researchModel || s.researchModel || config.ANTHROPIC_RESEARCH_MODEL || spec.writerModel, effort: s.effort, signal });
    },
    detector() {
      const s = settings();
      const key = pick('originality_key', config.ORIGINALITY_API_KEY);
      const mode = resolveDetectorMode(s, Boolean(key));
      if (mode === 'off') return new NoopDetector('Đã tắt quét AI trong Cài đặt: chỉ chạy kiểm tra nội bộ và so trùng lặp.');
      if (mode === 'manual') return new ManualDetector();
      if (!key) throw new ConfigError('Chọn chế độ "Originality.ai API" nhưng chưa có API key. Nhập key trong Cài đặt hoặc chuyển sang chế độ chấm tay.');
      return new OriginalityDetector(key);
    },
    integrations(): IntegrationStatus {
      const s = settings();
      const originalityKey = pick('originality_key', config.ORIGINALITY_API_KEY);
      const mode = resolveDetectorMode(s, Boolean(originalityKey));
      const searchConfigured = s.searchProvider === 'serpapi' ? Boolean(pick('serpapi_key', config.SERPAPI_KEY)) : s.searchProvider === 'google_cse' ? Boolean(pick('google_cse_key', config.GOOGLE_CSE_KEY) && pick('google_cse_cx', config.GOOGLE_CSE_CX)) : Boolean(anthropicKey());
      const searchSource = s.searchProvider === 'serpapi' ? source('serpapi_key', config.SERPAPI_KEY) : s.searchProvider === 'google_cse' ? source('google_cse_key', config.GOOGLE_CSE_KEY) : source('anthropic_key', config.ANTHROPIC_API_KEY);
      return {
        llmProvider: s.llmProvider,
        anthropic: { configured: Boolean(anthropicKey()), source: source('anthropic_key', config.ANTHROPIC_API_KEY), writerModel: s.writerModel || config.ANTHROPIC_MODEL, researchModel: s.researchModel || config.ANTHROPIC_RESEARCH_MODEL },
        openrouter: { configured: Boolean(pick('openrouter_key', config.OPENROUTER_API_KEY)), source: source('openrouter_key', config.OPENROUTER_API_KEY), writerModel: s.openrouterWriterModel, researchModel: s.openrouterResearchModel },
        deepseek: { configured: Boolean(pick('deepseek_key', config.DEEPSEEK_API_KEY)), source: source('deepseek_key', config.DEEPSEEK_API_KEY), writerModel: s.deepseekWriterModel, researchModel: s.deepseekResearchModel },
        search: { provider: s.searchProvider, configured: searchConfigured, source: searchSource },
        originality: { configured: Boolean(originalityKey), source: source('originality_key', config.ORIGINALITY_API_KEY), model: s.originalityModel, skipped: mode === 'off', mode },
      };
    },
  };
}
