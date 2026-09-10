import { nowIso } from './util.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export type LogSink = (entry: { level: LogLevel; msg: string; data?: unknown; scope?: string; ts: string }) => void;
const sinks: LogSink[] = [];

export function addLogSink(sink: LogSink): void {
  sinks.push(sink);
}

function emit(level: LogLevel, scope: string | undefined, msg: string, data?: unknown): void {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  const ts = nowIso();
  const prefix = `${ts} ${level.toUpperCase().padEnd(5)}${scope ? ` [${scope}]` : ''}`;
  const line = data === undefined ? `${prefix} ${msg}` : `${prefix} ${msg} ${safeStringify(data)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  for (const s of sinks) {
    try {
      s({ level, msg, data, scope, ts });
    } catch {
      /* sink lỗi không được làm hỏng luồng chính */
    }
  }
}

function safeStringify(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 2000 ? s.slice(0, 2000) + '…' : s;
  } catch {
    return String(v);
  }
}

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  child(scope: string): Logger;
}

export function createLogger(scope?: string): Logger {
  return {
    debug: (m, d) => emit('debug', scope, m, d),
    info: (m, d) => emit('info', scope, m, d),
    warn: (m, d) => emit('warn', scope, m, d),
    error: (m, d) => emit('error', scope, m, d),
    child: (s) => createLogger(scope ? `${scope}:${s}` : s),
  };
}

export const log = createLogger();
