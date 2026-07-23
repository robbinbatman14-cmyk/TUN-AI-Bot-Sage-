// ============================================================
// Logger (Section 73, 92 - Secure Logging)
// Never logs API keys, tokens, or credentials - only what's
// needed for troubleshooting and the /ai review workflow.
// ============================================================
const db = require('../config/db');

function logInteraction({ userId, channelId, message, response, confidence, documentsUsed, escalated, responseTimeMs }) {
  const result = db.prepare(`
    INSERT INTO logs (user_id, channel_id, message, response, confidence, documents_used, escalated, response_time_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, channelId, message, response, confidence, JSON.stringify(documentsUsed || []), escalated ? 1 : 0, responseTimeMs);
  return result.lastInsertRowid;
}

function getLogById(id) {
  return db.prepare('SELECT * FROM logs WHERE id = ?').get(id);
}

function recentLogs(limit = 20) {
  return db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(limit);
}

function addReview(logId, rating, reviewer, note) {
  db.prepare('INSERT INTO reviews (log_id, rating, reviewer, note) VALUES (?, ?, ?, ?)').run(logId, rating, reviewer, note || null);
}

function analytics() {
  const total = db.prepare('SELECT COUNT(*) as c FROM logs').get().c;
  const escalated = db.prepare('SELECT COUNT(*) as c FROM logs WHERE escalated = 1').get().c;
  const avgConfidence = db.prepare('SELECT AVG(confidence) as a FROM logs WHERE confidence IS NOT NULL').get().a;
  const avgResponseTime = db.prepare('SELECT AVG(response_time_ms) as a FROM logs WHERE response_time_ms IS NOT NULL').get().a;
  return {
    totalResponses: total,
    escalations: escalated,
    avgConfidence: avgConfidence ? Math.round(avgConfidence) : null,
    avgResponseTimeMs: avgResponseTime ? Math.round(avgResponseTime) : null
  };
}

module.exports = { logInteraction, getLogById, recentLogs, addReview, analytics };
