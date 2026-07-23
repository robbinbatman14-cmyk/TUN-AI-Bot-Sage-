// ============================================================
// Logger (Section 73, 92 - Secure Logging, Section 75 - Analytics)
// Never logs API keys, tokens, or credentials - only what's
// needed for troubleshooting and the /ai review workflow.
// ============================================================
const db = require('../config/db');

function logInteraction({ userId, channelId, message, response, confidence, documentsUsed, escalated, responseTimeMs, topic }) {
  const result = db.prepare(`
    INSERT INTO logs (user_id, channel_id, message, response, confidence, documents_used, escalated, response_time_ms, topic)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, channelId, message, response, confidence, JSON.stringify(documentsUsed || []), escalated ? 1 : 0, responseTimeMs, topic || null);
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
  const answered = db.prepare("SELECT COUNT(*) as c FROM logs WHERE response IS NOT NULL").get().c;
  const silent = total - answered;
  const escalated = db.prepare('SELECT COUNT(*) as c FROM logs WHERE escalated = 1').get().c;
  const avgConfidence = db.prepare('SELECT AVG(confidence) as a FROM logs WHERE confidence IS NOT NULL').get().a;
  const avgResponseTime = db.prepare('SELECT AVG(response_time_ms) as a FROM logs WHERE response_time_ms IS NOT NULL').get().a;

  const topTopics = db.prepare(`
    SELECT topic, COUNT(*) as c FROM logs WHERE topic IS NOT NULL AND topic != ''
    GROUP BY topic ORDER BY c DESC LIMIT 5
  `).all();

  // documents_used is stored as a JSON array per row; tally frequency in JS
  // since SQLite has no native JSON-array-explode in older builds.
  const docCounts = {};
  for (const row of db.prepare("SELECT documents_used FROM logs WHERE documents_used != '[]'").all()) {
    try {
      for (const title of JSON.parse(row.documents_used)) {
        docCounts[title] = (docCounts[title] || 0) + 1;
      }
    } catch { /* ignore malformed rows */ }
  }
  const topDocuments = Object.entries(docCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([title, count]) => ({ title, count }));

  return {
    totalResponses: total,
    answered,
    silent,
    escalations: escalated,
    avgConfidence: avgConfidence ? Math.round(avgConfidence) : null,
    avgResponseTimeMs: avgResponseTime ? Math.round(avgResponseTime) : null,
    topTopics,
    topDocuments
  };
}

module.exports = { logInteraction, getLogById, recentLogs, addReview, analytics };
