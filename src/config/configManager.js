// ============================================================
// Config Manager
// Every setting an admin can change with a slash command lives
// here, backed by the "config" table. Defaults are applied the
// first time the bot runs. Nothing here requires a restart to
// take effect (Section 113: changes should not require
// recompilation or, where possible, a restart).
// ============================================================
const db = require('./db');

const DEFAULTS = {
  ai_enabled: 'true',
  trigger_mode: 'hybrid', // tagged | smart | hybrid
  confidence_threshold: '90',
  personality: 'professional', // professional | friendly | mentor
  official_answers_only: 'false',
  citations_mode: 'always', // always | on_request | hidden
  cooldown_per_user_seconds: '20',
  cooldown_per_channel_per_minute: '6',
  ai_provider: process.env.AI_PROVIDER || 'gemini',
  escalation_channel_id: ''
};

const getStmt = db.prepare('SELECT value FROM config WHERE key = ?');
const setStmt = db.prepare(
  'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

function ensureDefaults() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const row = getStmt.get(key);
    if (!row) setStmt.run(key, value);
  }
}
ensureDefaults();

function get(key) {
  const row = getStmt.get(key);
  return row ? row.value : DEFAULTS[key];
}

function getBool(key) {
  return get(key) === 'true';
}

function getNumber(key) {
  return Number(get(key));
}

function set(key, value) {
  setStmt.run(key, String(value));
}

// --- Channels (allowlist) ---
function addChannel(channelId, guildId) {
  db.prepare('INSERT OR IGNORE INTO channels (channel_id, guild_id) VALUES (?, ?)').run(channelId, guildId);
}
function removeChannel(channelId) {
  db.prepare('DELETE FROM channels WHERE channel_id = ?').run(channelId);
}
function listChannels() {
  return db.prepare('SELECT channel_id FROM channels').all().map(r => r.channel_id);
}
function isChannelAllowed(channelId) {
  return !!db.prepare('SELECT 1 FROM channels WHERE channel_id = ?').get(channelId);
}

// --- Topics ---
const DEFAULT_TOPICS = [
  'politics_and_war', 'military', 'economy', 'wars', 'trading', 'cities',
  'infrastructure', 'projects', 'mmr', 'score', 'constitution', 'government',
  'policies', 'banking', 'recruitment', 'academy', 'elections', 'legislation'
];
function ensureTopics() {
  const insert = db.prepare('INSERT OR IGNORE INTO topics (name, enabled) VALUES (?, 1)');
  for (const t of DEFAULT_TOPICS) insert.run(t);
}
ensureTopics();

function setTopicEnabled(name, enabled) {
  db.prepare('INSERT INTO topics (name, enabled) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled')
    .run(name, enabled ? 1 : 0);
}
function listTopics() {
  return db.prepare('SELECT name, enabled FROM topics').all();
}
function enabledTopicNames() {
  return db.prepare('SELECT name FROM topics WHERE enabled = 1').all().map(r => r.name);
}

module.exports = {
  get, getBool, getNumber, set,
  addChannel, removeChannel, listChannels, isChannelAllowed,
  setTopicEnabled, listTopics, enabledTopicNames
};
