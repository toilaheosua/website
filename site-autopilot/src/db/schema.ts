/** Lược đồ SQLite. Mỗi lần khởi động chạy lại toàn bộ, các câu lệnh đều idempotent. */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ip TEXT NOT NULL,
  panel_url TEXT NOT NULL DEFAULT '',
  panel_api_key TEXT NOT NULL DEFAULT '',
  ssh_host TEXT NOT NULL DEFAULT '',
  ssh_port INTEGER NOT NULL DEFAULT 22,
  ssh_user TEXT NOT NULL DEFAULT 'root',
  ssh_key_path TEXT NOT NULL DEFAULT '',
  ssh_password TEXT NOT NULL DEFAULT '',
  web_root TEXT NOT NULL DEFAULT '/www/wwwroot',
  php_version TEXT NOT NULL DEFAULT '00',
  from_env INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,
  server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'creating',
  brief TEXT NOT NULL,
  entity TEXT NOT NULL,
  plan TEXT,
  theme TEXT,
  logo_file TEXT,
  cf_zone_id TEXT,
  cf_name_servers TEXT,
  cf_zone_status TEXT,
  cf_ruleset_ids TEXT,
  panel_site_id INTEGER,
  site_path TEXT,
  google_verification_token TEXT,
  google_verified INTEGER NOT NULL DEFAULT 0,
  indexnow_key TEXT,
  last_built_at TEXT,
  last_deployed_at TEXT,
  live_at TEXT,
  health TEXT,
  error_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS site_steps (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  message TEXT,
  error TEXT,
  output TEXT,
  PRIMARY KEY (site_id, step)
);

CREATE TABLE IF NOT EXISTS site_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  sort_order INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (site_id, slug)
);

CREATE TABLE IF NOT EXISTS site_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_id TEXT,
  query TEXT,
  file TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  alt TEXT NOT NULL DEFAULT '',
  credit TEXT NOT NULL DEFAULT '',
  credit_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (site_id, key)
);

CREATE TABLE IF NOT EXISTS site_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  alt TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'upload',
  source_ref TEXT,
  credit TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (site_id, file)
);

CREATE TABLE IF NOT EXISTS used_stock_images (
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  site_id INTEGER,
  PRIMARY KEY (provider, provider_id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  run_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error TEXT,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_run ON jobs(status, run_at);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER,
  step TEXT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_site ON logs(site_id, id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);
`;
