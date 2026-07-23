// ============================================================
// Config Profiles (Section 79)
// Snapshots the AI-behavior config keys (not channels/topics/
// permissions, which are structural rather than "posture") so
// an admin can flip between e.g. "war-mode" and "peace-mode"
// instantly.
// ============================================================
const db = require('../config/db');
const configManager = require('./configManager');

const PROFILE_KEYS = [
  'trigger_mode', 'confidence_threshold', 'personality',
  'official_answers_only', 'citations_mode', 'escalation_channel_id',
  'cooldown_per_user_seconds', 'cooldown_per_channel_per_minute'
];

function saveProfile(name, savedBy) {
  const snapshot = {};
  for (const key of PROFILE_KEYS) snapshot[key] = configManager.get(key);
  db.prepare(`
    INSERT INTO config_profiles (name, data, saved_by) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET data = excluded.data, saved_by = excluded.saved_by, created_at = CURRENT_TIMESTAMP
  `).run(name, JSON.stringify(snapshot), savedBy);
}

function loadProfile(name) {
  const row = db.prepare('SELECT data FROM config_profiles WHERE name = ?').get(name);
  if (!row) return null;
  const snapshot = JSON.parse(row.data);
  for (const [key, value] of Object.entries(snapshot)) configManager.set(key, value);
  return snapshot;
}

function listProfiles() {
  return db.prepare('SELECT name, saved_by, created_at FROM config_profiles ORDER BY name').all();
}

function deleteProfile(name) {
  db.prepare('DELETE FROM config_profiles WHERE name = ?').run(name);
}

module.exports = { saveProfile, loadProfile, listProfiles, deleteProfile, PROFILE_KEYS };
