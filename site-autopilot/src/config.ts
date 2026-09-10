import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Cấu hình toàn hệ thống, đọc từ biến môi trường (.env).
 * Mọi giá trị bí mật chỉ nằm ở đây, không lưu vào DB.
 */
const boolish = z
  .string()
  .optional()
  .transform((v) => ['1', 'true', 'yes', 'on'].includes((v ?? '').toLowerCase()));

const intish = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      const n = Number.parseInt(v ?? '', 10);
      return Number.isFinite(n) ? n : def;
    });

const EnvSchema = z.object({
  NODE_ENV: z.string().optional().default('development'),
  PORT: intish(3000),
  HOST: z.string().optional().default('127.0.0.1'),
  BASE_URL: z.string().optional().default(''),
  DATA_DIR: z.string().optional().default('./data'),
  SESSION_SECRET: z.string().optional().default(''),
  ADMIN_USER: z.string().optional().default('admin'),
  ADMIN_PASSWORD: z.string().optional().default(''),

  MOCK_MODE: boolish,
  WORKER_CONCURRENCY: intish(3),
  HEALTH_CHECK_INTERVAL_MIN: intish(15),
  NS_POLL_INTERVAL_MIN: intish(5),

  CLOUDFLARE_API_TOKEN: z.string().optional().default(''),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional().default(''),

  AAPANEL_URL: z.string().optional().default(''),
  AAPANEL_API_KEY: z.string().optional().default(''),
  AAPANEL_SERVER_IP: z.string().optional().default(''),
  AAPANEL_PHP_VERSION: z.string().optional().default('00'),
  WEB_ROOT: z.string().optional().default('/www/wwwroot'),

  SSH_HOST: z.string().optional().default(''),
  SSH_PORT: intish(22),
  SSH_USER: z.string().optional().default('root'),
  SSH_KEY_PATH: z.string().optional().default(''),
  SSH_PASSWORD: z.string().optional().default(''),

  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().optional().default('claude-opus-5'),
  ANTHROPIC_EDITOR_MODEL: z.string().optional().default(''),

  PEXELS_API_KEY: z.string().optional().default(''),

  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional().default(''),
  GOOGLE_OWNER_EMAIL: z.string().optional().default(''),

  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_CHAT_ID: z.string().optional().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

export interface AppConfig extends Env {
  dataDir: string;
  sitesDir: string;
  uploadsDir: string;
  dbPath: string;
  isMock: boolean;
}

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.parse(env);
  const dataDir = path.resolve(parsed.DATA_DIR);
  cached = {
    ...parsed,
    dataDir,
    sitesDir: path.join(dataDir, 'sites'),
    uploadsDir: path.join(dataDir, 'uploads'),
    dbPath: path.join(dataDir, 'autopilot.sqlite'),
    isMock: parsed.MOCK_MODE,
  };
  return cached;
}

/** Dùng trong test để nạp lại cấu hình với env khác. */
export function resetConfigCache(): void {
  cached = undefined;
}

/* ------------------------------------------------------------------ */
/*  Khóa dịch vụ: nhập trên dashboard (ưu tiên) hoặc từ .env              */
/* ------------------------------------------------------------------ */

export type IntegrationSource = 'dashboard' | 'env' | 'none';

export interface IntegrationSettings {
  cloudflareAccountId: string;
  anthropicModel: string;
  anthropicEditorModel: string;
  googleOwnerEmail: string;
  telegramChatId: string;
}

export interface Integrations {
  cloudflare: { token: string; accountId: string; source: IntegrationSource };
  anthropic: { apiKey: string; model: string; editorModel: string; source: IntegrationSource };
  pexels: { apiKey: string; source: IntegrationSource };
  /** Nội dung file JSON service account (không phải đường dẫn) */
  google: { serviceAccountJson: string; ownerEmail: string; source: IntegrationSource };
  googleMaps: { apiKey: string; source: IntegrationSource };
  telegram: { botToken: string; chatId: string; source: IntegrationSource };
}

export type SecretKeyName = 'cloudflare_token' | 'anthropic_key' | 'pexels_key' | 'google_sa_json' | 'google_maps_key' | 'telegram_token';

export interface SecretReader {
  get(name: SecretKeyName): string;
}

function pickSource(dashboardValue: string, envValue: string): { value: string; source: IntegrationSource } {
  if (dashboardValue) return { value: dashboardValue, source: 'dashboard' };
  if (envValue) return { value: envValue, source: 'env' };
  return { value: '', source: 'none' };
}

/** Gộp khóa từ dashboard (đã giải mã) với .env. Giá trị nhập trên dashboard luôn thắng. */
export function resolveIntegrations(cfg: AppConfig, secrets: SecretReader, settings: Partial<IntegrationSettings>): Integrations {
  const cf = pickSource(secrets.get('cloudflare_token'), cfg.CLOUDFLARE_API_TOKEN);
  const an = pickSource(secrets.get('anthropic_key'), cfg.ANTHROPIC_API_KEY);
  const px = pickSource(secrets.get('pexels_key'), cfg.PEXELS_API_KEY);
  let envGoogleJson = '';
  if (cfg.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      envGoogleJson = readFileSyncSafe(cfg.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch {
      envGoogleJson = '';
    }
  }
  const gg = pickSource(secrets.get('google_sa_json'), envGoogleJson);
  const tg = pickSource(secrets.get('telegram_token'), cfg.TELEGRAM_BOT_TOKEN);
  const gm = pickSource(secrets.get('google_maps_key'), '');
  return {
    cloudflare: { token: cf.value, accountId: settings.cloudflareAccountId || cfg.CLOUDFLARE_ACCOUNT_ID, source: cf.source },
    anthropic: {
      apiKey: an.value,
      model: settings.anthropicModel || cfg.ANTHROPIC_MODEL,
      editorModel: settings.anthropicEditorModel || cfg.ANTHROPIC_EDITOR_MODEL,
      source: an.source,
    },
    pexels: { apiKey: px.value, source: px.source },
    google: { serviceAccountJson: gg.value, ownerEmail: settings.googleOwnerEmail || cfg.GOOGLE_OWNER_EMAIL, source: gg.source },
    googleMaps: { apiKey: gm.value, source: gm.source },
    telegram: { botToken: tg.value, chatId: settings.telegramChatId || cfg.TELEGRAM_CHAT_ID, source: tg.source },
  };
}

function readFileSyncSafe(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

export interface IntegrationStatus {
  mock: boolean;
  cloudflare: boolean;
  aapanel: boolean;
  ssh: boolean;
  anthropic: boolean;
  pexels: boolean;
  google: boolean;
  telegram: boolean;
}

/**
 * Liệt kê những dịch vụ đã có key. Dashboard dùng để hiển thị trạng thái cấu hình,
 * tuyệt đối không hiển thị giá trị key.
 */
export function integrationStatus(cfg: AppConfig, integ: Integrations, hasServer: boolean): IntegrationStatus {
  return {
    mock: cfg.isMock,
    cloudflare: Boolean(integ.cloudflare.token && integ.cloudflare.accountId),
    aapanel: hasServer,
    ssh: hasServer,
    anthropic: Boolean(integ.anthropic.apiKey),
    pexels: Boolean(integ.pexels.apiKey),
    google: Boolean(integ.google.serviceAccountJson),
    telegram: Boolean(integ.telegram.botToken && integ.telegram.chatId),
  };
}
