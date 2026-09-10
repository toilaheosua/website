import path from 'node:path';
import type { AppConfig, Integrations, IntegrationSettings } from '../config.js';
import { resolveIntegrations } from '../config.js';
import type { Db } from '../db/index.js';
import type { AapanelClient, GoogleClient, Notifier, PlacesClient, ServerConn, Services, SshClient } from './types.js';
import { GooglePlacesClient, MockPlacesClient } from './google-places.js';
import { CloudflareApi } from './cloudflare.js';
import { AapanelApi } from './aapanel.js';
import { connectSsh } from './ssh.js';
import { AnthropicContentGenerator } from './anthropic.js';
import { PexelsProvider } from './pexels.js';
import { GoogleSearchClient } from './google.js';
import { IndexNowHttpClient } from './indexnow.js';
import { NoopNotifier, TelegramNotifier } from './telegram.js';
import { MockAapanel, MockCloudflare, MockContentGenerator, MockGoogle, MockImageProvider, MockIndexNow, mockSshFactory } from './mock.js';
import { ConfigError } from '../core/errors.js';
import { createLogger } from '../core/logger.js';
import { loadMasterKey, SecretStore } from '../core/secrets.js';

const log = createLogger('services');

export const INTEGRATION_SETTINGS_KEY = 'integrations';

export function getIntegrationSettings(db: Db): IntegrationSettings {
  const raw = db.getSetting<Partial<IntegrationSettings>>(INTEGRATION_SETTINGS_KEY, {});
  return {
    cloudflareAccountId: raw.cloudflareAccountId ?? '',
    anthropicModel: raw.anthropicModel ?? '',
    anthropicEditorModel: raw.anthropicEditorModel ?? '',
    googleOwnerEmail: raw.googleOwnerEmail ?? '',
    telegramChatId: raw.telegramChatId ?? '',
  };
}

export function setIntegrationSettings(db: Db, patch: Partial<IntegrationSettings>): void {
  db.setSetting(INTEGRATION_SETTINGS_KEY, { ...getIntegrationSettings(db), ...patch });
}

/**
 * Proxy tạo lại đối tượng dịch vụ khi khóa thay đổi (nhập trên dashboard), và ném ConfigError
 * rõ ràng khi chưa cấu hình thay vì lỗi mơ hồ giữa pipeline.
 */
function dynamic<T extends object>(name: string, current: () => { key: string; make: () => T }): T {
  let cacheKey: string | undefined;
  let inst: T | undefined;
  let err: Error | undefined;
  return new Proxy({} as T, {
    get(_t, prop) {
      const { key, make } = current();
      if (key !== cacheKey) {
        cacheKey = key;
        try {
          inst = make();
          err = undefined;
        } catch (e) {
          inst = undefined;
          err = e as Error;
        }
      }
      if (!inst) {
        return () => {
          throw new ConfigError(`${name}: ${err?.message ?? 'chưa cấu hình'}. Vào Cài đặt → Khóa API để nhập.`);
        };
      }
      const v = (inst as Record<string | symbol, unknown>)[prop];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(inst) : v;
    },
  });
}

export function createServices(config: AppConfig, db: Db): Services {
  const secrets = new SecretStore(db, loadMasterKey(config.SESSION_SECRET, config.dataDir));
  const integrations = (): Integrations => resolveIntegrations(config, secrets, getIntegrationSettings(db));

  if (config.isMock) {
    log.warn('MOCK_MODE bật: mọi dịch vụ bên ngoài đều là giả lập');
    const mockCf = new MockCloudflare();
    const mockPanel = new MockAapanel();
    return {
      cloudflare: mockCf,
      panelFor: () => mockPanel,
      sshFor: mockSshFactory(path.join(config.dataDir, 'mock-deploy')),
      content: new MockContentGenerator(),
      images: new MockImageProvider(),
      google: new MockGoogle(),
      indexnow: new MockIndexNow(),
      notifier: new NoopNotifier(),
      places: new MockPlacesClient(),
      wafSettings: () => db.getWafSettings(),
      secrets,
      integrations,
    };
  }

  const panelCache = new Map<string, AapanelClient>();
  const panelFor = (server: ServerConn): AapanelClient => {
    const key = `${server.panel_url}|${server.panel_api_key}`;
    let c = panelCache.get(key);
    if (!c) {
      c = new AapanelApi(server.panel_url, server.panel_api_key);
      panelCache.set(key, c);
    }
    return c;
  };
  const sshFor = async (server: ServerConn): Promise<SshClient> => connectSsh(server);

  let googleKey: string | undefined;
  let googleInst: GoogleClient | null = null;
  let notifierKey: string | undefined;
  let notifierInst: Notifier = new NoopNotifier();
  let placesKey: string | undefined;
  let placesInst: PlacesClient | null = null;

  return {
    cloudflare: dynamic('Cloudflare', () => {
      const i = integrations().cloudflare;
      return { key: `${i.token}|${i.accountId}`, make: () => new CloudflareApi(i.token, i.accountId) };
    }),
    panelFor,
    sshFor,
    content: dynamic('Claude', () => {
      const i = integrations().anthropic;
      return {
        key: `${i.apiKey}|${i.model}|${i.editorModel}`,
        make: () => {
          if (!i.apiKey) throw new ConfigError('Thiếu Anthropic API key');
          return new AnthropicContentGenerator({ apiKey: i.apiKey, model: i.model, editorModel: i.editorModel || undefined });
        },
      };
    }),
    images: dynamic('Pexels', () => {
      const i = integrations().pexels;
      return {
        key: i.apiKey,
        make: () => {
          if (!i.apiKey) throw new ConfigError('Thiếu Pexels API key');
          return new PexelsProvider(i.apiKey);
        },
      };
    }),
    get google(): GoogleClient | null {
      const json = integrations().google.serviceAccountJson;
      if (json !== googleKey) {
        googleKey = json;
        googleInst = null;
        if (json) {
          try {
            googleInst = new GoogleSearchClient(json);
          } catch (err) {
            log.warn('Service account Google không hợp lệ, bỏ qua Search Console', { err: (err as Error).message });
          }
        }
      }
      return googleInst;
    },
    indexnow: new IndexNowHttpClient(),
    get places(): PlacesClient | null {
      const key = integrations().googleMaps.apiKey;
      if (key !== placesKey) {
        placesKey = key;
        placesInst = key ? new GooglePlacesClient(key) : null;
      }
      return placesInst;
    },
    get notifier(): Notifier {
      const t = integrations().telegram;
      const key = `${t.botToken}|${t.chatId}`;
      if (key !== notifierKey) {
        notifierKey = key;
        notifierInst = t.botToken && t.chatId ? new TelegramNotifier(t.botToken, t.chatId) : new NoopNotifier();
      }
      return notifierInst;
    },
    wafSettings: () => db.getWafSettings(),
    secrets,
    integrations,
  };
}

/** Tạo server mặc định từ .env nếu bảng servers trống. */
export function ensureDefaultServer(config: AppConfig, db: Db): void {
  if (db.listServers().length > 0) return;
  if (config.isMock) {
    db.upsertServer({ name: 'Server mô phỏng', ip: '203.0.113.10', panel_url: 'https://203.0.113.10:7800', panel_api_key: 'mock', ssh_host: '203.0.113.10', ssh_port: 22, ssh_user: 'root', ssh_key_path: '', ssh_password: 'mock', web_root: '/www/wwwroot', php_version: '00', from_env: 1 });
    return;
  }
  if (!config.AAPANEL_SERVER_IP) return;
  db.upsertServer({
    name: 'Server chính',
    ip: config.AAPANEL_SERVER_IP,
    panel_url: config.AAPANEL_URL,
    panel_api_key: config.AAPANEL_API_KEY,
    ssh_host: config.SSH_HOST || config.AAPANEL_SERVER_IP,
    ssh_port: config.SSH_PORT,
    ssh_user: config.SSH_USER,
    ssh_key_path: config.SSH_KEY_PATH,
    ssh_password: config.SSH_PASSWORD,
    web_root: config.WEB_ROOT,
    php_version: config.AAPANEL_PHP_VERSION,
    from_env: 1,
  });
  log.info('Đã tạo server mặc định từ .env', { ip: config.AAPANEL_SERVER_IP });
}
