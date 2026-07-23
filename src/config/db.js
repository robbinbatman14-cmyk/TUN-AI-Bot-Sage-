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
`);

module.exports = db;
