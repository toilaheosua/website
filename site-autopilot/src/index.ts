import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { Db } from './db/index.js';
import { createServices, ensureDefaultServer } from './services/index.js';
import { STEPS } from './core/steps.js';
import { Worker } from './core/worker.js';
import { createApp } from './web/server.js';
import { createLogger } from './core/logger.js';

const log = createLogger('main');

export function boot() {
  const config = loadConfig();
  fs.mkdirSync(config.sitesDir, { recursive: true });
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const db = new Db(config.dbPath);
  const services = createServices(config, db);
  ensureDefaultServer(config, db);
  const worker = new Worker({ db, config, services, steps: STEPS });
  const app = createApp({ db, config, services, worker, steps: STEPS });
  return { config, db, services, worker, app };
}

const { config, db, worker, app } = boot();

if (!config.SESSION_SECRET) log.warn('SESSION_SECRET trống: phiên đăng nhập vẫn hoạt động (lưu trong DB) nhưng nên đặt để tăng an toàn.');
if (!config.ADMIN_PASSWORD) log.info('ADMIN_PASSWORD trống: nếu chưa đặt mật khẩu trên dashboard, lần mở đầu tiên sẽ hiện trang thiết lập tài khoản.');

worker.start();
const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) => {
  log.info(`Dashboard chạy tại http://${info.address}:${info.port}`, { mock: config.isMock, dataDir: config.dataDir });
});

const shutdown = () => {
  log.info('Đang tắt...');
  worker.stop();
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
