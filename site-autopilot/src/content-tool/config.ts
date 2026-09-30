import path from 'node:path';
import { z } from 'zod';

/**
 * Cấu hình toàn hệ thống, đọc từ biến môi trường (.env).
 * Khóa API có thể để trống ở đây và nhập trên dashboard (Cài đặt → Khóa API); khóa trên dashboard được ưu tiên.
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
  PORT: intish(3100),
  HOST: z.string().optional().default('127.0.0.1'),
  BASE_URL: z.string().optional().default(''),
  DATA_DIR: z.string().optional().default('./data'),
  SESSION_SECRET: z.string().optional().default(''),
  ADMIN_USER: z.string().optional().default('admin'),
  ADMIN_PASSWORD: z.string().optional().default(''),

  MOCK_MODE: boolish,
  WORKER_CONCURRENCY: intish(2),

  ANTHROPIC_API_KEY: z.string().optional().default(''),
  /** Model viết bố cục, viết bài, biên tập, sửa lỗi */
  ANTHROPIC_MODEL: z.string().optional().default('claude-opus-5'),
  /** Model đọc nguồn và rút ghi chú (rẻ hơn). Trống = dùng ANTHROPIC_MODEL */
  ANTHROPIC_RESEARCH_MODEL: z.string().optional().default('claude-sonnet-5'),

  OPENROUTER_API_KEY: z.string().optional().default(''),
  DEEPSEEK_API_KEY: z.string().optional().default(''),

  SEARCH_PROVIDER: z.string().optional().default(''),
  SERPAPI_KEY: z.string().optional().default(''),
  GOOGLE_CSE_KEY: z.string().optional().default(''),
  GOOGLE_CSE_CX: z.string().optional().default(''),
  ORIGINALITY_API_KEY: z.string().optional().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

export interface AppConfig extends Env {
  dataDir: string;
  exportsDir: string;
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
    exportsDir: path.join(dataDir, 'exports'),
    dbPath: path.join(dataDir, 'viet-content.sqlite'),
    isMock: parsed.MOCK_MODE,
  };
  return cached;
}

/** Dùng trong test để nạp lại cấu hình với env khác. */
export function resetConfigCache(): void {
  cached = undefined;
}
