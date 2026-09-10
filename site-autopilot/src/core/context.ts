import type { AppConfig } from '../config.js';
import type { Db, Site } from '../db/index.js';
import type { Services } from '../services/types.js';
import { createLogger, type LogLevel } from './logger.js';
import type { StepContext } from './pipeline.js';

const log = createLogger('site');

/** Ngữ cảnh chung cho bước pipeline và job: log gắn site, cập nhật site tiện lợi. */
export function makeStepContext(db: Db, config: AppConfig, services: Services, site: Site, scope: string): StepContext {
  let current = site;
  const ctxLog = (level: LogLevel, message: string, data?: unknown) => {
    log[level](`[${current.domain}] ${scope}: ${message}`, data);
    db.addLog({ site_id: current.id, step: scope, level, message, data });
  };
  return {
    db,
    config,
    services,
    get site() {
      return current;
    },
    get server() {
      return current.server_id ? db.getServer(current.server_id) : undefined;
    },
    log: ctxLog,
    updateSite: (patch) => {
      db.updateSite(current.id, patch);
      current = db.getSite(current.id) ?? current;
    },
    refreshSite: () => {
      current = db.getSite(current.id) ?? current;
      return current;
    },
  };
}
