export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  options TEXT NOT NULL,
  current_step TEXT,
  error TEXT,
  rounds INTEGER NOT NULL DEFAULT 0,
  usage TEXT,
  final_score TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

CREATE TABLE IF NOT EXISTS run_steps (
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  message TEXT,
  error TEXT,
  PRIMARY KEY (run_id, step)
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'vi',
  status TEXT NOT NULL DEFAULT 'pending',
  http_status INTEGER,
  text TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  fetched_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sources_run ON sources(run_id);

CREATE TABLE IF NOT EXISTS artifacts (
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, kind, version)
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER,
  step TEXT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_run ON logs(run_id, id);
`;
