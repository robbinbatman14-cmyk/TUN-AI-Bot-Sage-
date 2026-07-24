// ============================================================
// Backup & Restore (Section 78)
// Exports everything an admin would need to rebuild UNAI's setup
// on a new server or recover from a bad change: config, channels,
// topics, role permissions, FAQ, and full document content.
// Embeddings are NOT exported (they're cheap to regenerate and
// would bloat the file) — import re-indexes approved documents
// automatically.
// ============================================================
const db = require('../config/db');
const documentManager = require('../knowledge/documentManager');

const BACKUP_VERSION = 1;

function exportBackup() {
  return {
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    config: db.prepare('SELECT key, value FROM config').all(),
    channels: db.prepare('SELECT channel_id, guild_id FROM channels').all(),
    topics: db.prepare('SELECT name, enabled FROM topics').all(),
    rolePermissions: db.prepare('SELECT role_id, level FROM role_permissions').all(),
    faq: db.prepare('SELECT question, answer, category, keywords, priority FROM faq').all(),
    documents: db.prepare('SELECT title, category, visibility, status, version, content FROM documents').all()
  };
}

/**
 * Restores config/channels/topics/permissions/FAQ/documents from a backup
 * object. Approved documents are re-indexed (costs embedding API calls).
 * @returns {Promise<{documentsRestored: number, reindexed: number, reindexFailures: number, reindexErrors: Array<{title: string, error: string}>}>}
 */
async function importBackup(backup) {
  if (!backup || typeof backup !== 'object' || !Array.isArray(backup.config)) {
    throw new Error('This does not look like a valid UNAI backup file.');
  }

  const setConfig = db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const row of backup.config || []) setConfig.run(row.key, row.value);

  const addChannel = db.prepare('INSERT OR IGNORE INTO channels (channel_id, guild_id) VALUES (?, ?)');
  for (const row of backup.channels || []) addChannel.run(row.channel_id, row.guild_id);

  const setTopic = db.prepare('INSERT INTO topics (name, enabled) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled');
  for (const row of backup.topics || []) setTopic.run(row.name, row.enabled);

  const setRole = db.prepare('INSERT INTO role_permissions (role_id, level) VALUES (?, ?) ON CONFLICT(role_id) DO UPDATE SET level = excluded.level');
  for (const row of backup.rolePermissions || []) setRole.run(row.role_id, row.level);

  const addFaq = db.prepare('INSERT INTO faq (question, answer, category, keywords, priority) VALUES (?, ?, ?, ?, ?)');
  for (const row of backup.faq || []) addFaq.run(row.question, row.answer, row.category, row.keywords, row.priority || 0);

  let documentsRestored = 0, reindexed = 0, reindexFailures = 0;
  const reindexErrors = [];
  for (const doc of backup.documents || []) {
    const id = documentManager.addDocument({
      title: doc.title, category: doc.category, visibility: doc.visibility,
      content: doc.content, filename: null, uploadedBy: 'backup-import'
    });
    documentsRestored++;
    if (doc.status === 'approved') {
      try {
        await documentManager.approveDocument(id); // also indexes it
        reindexed++;
      } catch (err) {
        reindexFailures++;
        console.error(`[UNAI] Backup restore: failed to re-index "${doc.title}" (new id ${id}):`, err.message);
        reindexErrors.push({ title: doc.title, error: err.message });
      }
    }
  }

  return { documentsRestored, reindexed, reindexFailures, reindexErrors };
}

module.exports = { exportBackup, importBackup };
