// ============================================================
// Security Monitor (Sections 88-89 - Prompt Injection/Jailbreak
// Resistance, Section 94 - Abuse Detection, Section 100 - Security
// Auditing)
// A fast, deterministic pre-filter that runs BEFORE any AI call.
// The system prompt in answerEngine.js also instructs the model to
// resist override attempts, but that only helps once the model is
// already involved — this catches the obvious cases for free and
// logs them for admin review via /review security.
// ============================================================
const db = require('../config/db');

const INJECTION_PATTERNS = [
  /ignore (all|any|your|the) (previous|prior|above|earlier) instructions?/i,
  /disregard (all|any|your|the) (previous|prior|above|earlier)/i,
  /you are now/i,
  /pretend (that )?you('re| are)/i,
  /act as (if you|though you)/i,
  /reveal your (system prompt|hidden prompt|instructions)/i,
  /print your (configuration|config|system prompt)/i,
  /what (is|are) your (system prompt|instructions)/i,
  /forget (that )?you('re| are) (an? )?(ai|assistant)/i,
  /new instructions?:/i,
  /override your (rules|restrictions|guidelines)/i
];

function looksLikeInjectionAttempt(text) {
  return INJECTION_PATTERNS.some(p => p.test(text));
}

function logSecurityEvent(type, { userId, channelId, detail }) {
  db.prepare('INSERT INTO security_events (type, user_id, channel_id, detail) VALUES (?, ?, ?, ?)')
    .run(type, userId || null, channelId || null, detail || null);
}

function recentSecurityEvents(limit = 20) {
  return db.prepare('SELECT * FROM security_events ORDER BY id DESC LIMIT ?').all(limit);
}

// --- Abuse detection: same user asking near-identical questions rapidly (Section 94) ---
const recentMessagesByUser = new Map(); // userId -> [{text, ts}]
const REPEAT_WINDOW_MS = 60 * 1000;
const REPEAT_THRESHOLD = 3;

function normalize(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isAbusiveRepeat(userId, text) {
  const now = Date.now();
  const norm = normalize(text);
  const history = (recentMessagesByUser.get(userId) || []).filter(m => now - m.ts < REPEAT_WINDOW_MS);
  history.push({ text: norm, ts: now });
  recentMessagesByUser.set(userId, history);

  const matches = history.filter(m => m.text === norm).length;
  return matches >= REPEAT_THRESHOLD;
}

module.exports = { looksLikeInjectionAttempt, logSecurityEvent, recentSecurityEvents, isAbusiveRepeat };
