// ============================================================
// Database layer
// Everything UNAI remembers (config, documents, chunks, FAQ,
// logs, reviews, cooldown state) lives in one SQLite file.
// SQLite is used instead of a hosted database because it needs
// zero setup and, mounted on a Railway volume, persists fine
// for a single-alliance bot.
// ============================================================
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || './data/unai.db';
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS channels (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocked_channels (
  id TEXT PRIMARY KEY, -- a channel ID or a category ID, per "type"
  type TEXT NOT NULL,  -- 'channel' | 'category'
  guild_id TEXT NOT NULL,
  added_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS topics (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT PRIMARY KEY,
  level TEXT NOT NULL -- owner | secgen | high_government | ministry | member
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'members_only', -- public | members_only | government | ministry | owner
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | archived
  priority INTEGER NOT NULL DEFAULT 2, -- 1=Doctrine/Constitution/policy, 2=Internal guides, 3=Official P&W docs, 4=Community/external
  version TEXT DEFAULT '1.0',
  filename TEXT,
  content TEXT,
  uploaded_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT NOT NULL, -- JSON array, stored as text
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS faq (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT,
  keywords TEXT,
  priority INTEGER DEFAULT 0,
  approved_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  user_id TEXT,
  channel_id TEXT,
  message TEXT,
  response TEXT,
  confidence REAL,
  documents_used TEXT,
  escalated INTEGER DEFAULT 0,
  response_time_ms INTEGER
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id INTEGER NOT NULL,
  rating TEXT NOT NULL, -- correct | partial | incorrect
  reviewer TEXT,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(log_id) REFERENCES logs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  type TEXT NOT NULL, -- prompt_injection | repeated_question | permission_denied
  user_id TEXT,
  channel_id TEXT,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS config_profiles (
  name TEXT PRIMARY KEY,
  data TEXT NOT NULL, -- JSON snapshot of config keys
  saved_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL, -- classify | answer | embed
  prompt_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS document_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  version TEXT NOT NULL,
  content TEXT NOT NULL,
  replaced_by TEXT,
  archived_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL, -- google_doc, google_sheet
  source_url TEXT NOT NULL,
  external_id TEXT, -- e.g. the Google Doc/Sheet ID extracted from the URL
  document_id INTEGER NOT NULL,
  content_hash TEXT,
  sheet_purpose TEXT, -- google_sheet only: member_roster | academy_records | audit_records | grant_database | tax_table | war_assignments | other | NULL
  sync_enabled INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  last_sync_status TEXT,
  added_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nation_links (
  discord_id TEXT PRIMARY KEY,
  nation_id INTEGER NOT NULL UNIQUE,
  nation_name TEXT,
  leader_name TEXT,
  linked_by TEXT,
  method TEXT, -- self_verified | admin_override
  linked_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sheet_data (
  document_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL, -- JSON: [{name, headers: [...], rows: [[...], ...]}, ...] — one entry per tab
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);
`);

// --- Lightweight migrations for columns added after initial release ---
// better-sqlite3/SQLite has no "ADD COLUMN IF NOT EXISTS", so each of
// these is attempted and a "duplicate column" failure is treated as
// "already migrated" rather than an error. This keeps existing databases
// (with existing knowledge bases) upgradable in place, without a wipe.
function addColumnIfMissing(table, columnDef) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
}
addColumnIfMissing('logs', 'topic TEXT');
// 1 = Doctrine/Constitution/official policy & resolutions (highest authority)
// 2 = Internal guides and handbooks
// 3 = Official Politics & War documentation
// 4 = Community guides and other external sources (lowest stored-document authority)
// (Priority 5, "general AI knowledge", is never a stored document — it's
// the model's own training knowledge, implicitly the lowest authority.)
addColumnIfMissing('documents', 'priority INTEGER NOT NULL DEFAULT 2');
addColumnIfMissing('knowledge_sources', 'sheet_purpose TEXT');

module.exports = db;
