// ============================================================
// Backup & Restore (Section 78)
// Exports everything an admin would need to rebuild UNAI's setup
// on a new server or recover from a bad change: config, channels,
// topics, role permissions, FAQ, full document content, verified
// Discord↔nation links, and linked knowledge sources (Google
// Docs/Sheets) with their sync state.
// Embeddings are NOT exported (they're cheap to regenerate and
// would bloat the file) — import re-indexes approved documents
// automatically.
//
// knowledge_sources and sheet_data both reference a document by
// its internal database ID — which is NOT preserved across a
// restore, since restored documents get fresh auto-incremented IDs
// via a normal INSERT. To keep those references correct, documents
// are exported WITH their original id, and import builds an
// old-id -> new-id map while restoring documents, then uses that
// map to correctly re-point sources/sheet data at the newly
// restored documents rather than a stale ID that means nothing
// anymore. A backup made before this existed (backupVersion 1)
// simply has no document ids to map from, so sources/sheet data
// from those backups are silently skipped — not an error, just
// nothing to attach them to. Documents, FAQ, config, and nation
// links (Section: no document dependency) still restore fully from
// an old-format backup either way.
// ============================================================
const db = require('../config/db');
const documentManager = require('../knowledge/documentManager');

const BACKUP_VERSION = 2;

function exportBackup() {
  return {
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    config: db.prepare('SELECT key, value FROM config').all(),
    channels: db.prepare('SELECT channel_id, guild_id FROM channels').all(),
    topics: db.prepare('SELECT name, enabled FROM topics').all(),
    rolePermissions: db.prepare('SELECT role_id, level FROM role_permissions').all(),
    faq: db.prepare('SELECT question, answer, category, keywords, priority FROM faq').all(),
    documents: db.prepare('SELECT id, title, category, visibility, priority, status, version, content FROM documents').all(),
    nationLinks: db.prepare('SELECT discord_id, nation_id, nation_name, leader_name, linked_by, method, linked_at FROM nation_links').all(),
    knowledgeSources: db.prepare(`
      SELECT id, type, source_url, external_id, document_id, content_hash, sheet_purpose, sync_enabled, last_synced_at, last_sync_status, added_by
      FROM knowledge_sources
    `).all(),
    sheetData: db.prepare('SELECT document_id, data FROM sheet_data').all()
  };
}

/**
 * Restores config/channels/topics/permissions/FAQ/documents/nation-links/
 * knowledge-sources/sheet-data from a backup object. Approved documents
 * are re-indexed (costs embedding API calls).
 * @returns {Promise<{
 *   documentsRestored: number, reindexed: number, reindexFailures: number, reindexErrors: Array<{title: string, error: string}>,
 *   nationLinksRestored: number,
 *   sourcesRestored: number, sourcesSkipped: number,
 *   sheetDataRestored: number
 * }>}
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

  // --- Nation links: no document dependency, straightforward restore.
  // Backward compatible by construction — older backups just won't have
  // this key, and `backup.nationLinks || []` iterates zero times.
  const setNationLink = db.prepare(`
    INSERT INTO nation_links (discord_id, nation_id, nation_name, leader_name, linked_by, method, linked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      nation_id = excluded.nation_id, nation_name = excluded.nation_name, leader_name = excluded.leader_name,
      linked_by = excluded.linked_by, method = excluded.method, linked_at = excluded.linked_at
  `);
  let nationLinksRestored = 0;
  for (const link of backup.nationLinks || []) {
    setNationLink.run(link.discord_id, link.nation_id, link.nation_name, link.leader_name, link.linked_by, link.method, link.linked_at);
    nationLinksRestored++;
  }

  // --- Documents: restore first, building an old-id -> new-id map so
  // knowledge_sources/sheet_data below can correctly re-point at whatever
  // ID each document actually got this time.
  let documentsRestored = 0, reindexed = 0, reindexFailures = 0;
  const reindexErrors = [];
  const approvedDocs = (backup.documents || []).filter(d => d.status === 'approved').length;
  let approvedProcessed = 0;
  const oldIdToNewId = new Map();

  for (const doc of backup.documents || []) {
    const id = documentManager.addDocument({
      title: doc.title, category: doc.category, visibility: doc.visibility, priority: doc.priority,
      content: doc.content, filename: null, uploadedBy: 'backup-import'
    });
    if (doc.id !== undefined) oldIdToNewId.set(doc.id, id);
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
      approvedProcessed++;
      // Small pacing gap between documents (not after the last one) — each
      // document can itself take several embedding batches, so back-to-back
      // large documents risk bursting a per-minute quota even with the
      // per-batch pacing already inside embedBatch. Cheap insurance.
      if (approvedProcessed < approvedDocs) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  // --- Knowledge sources (Google Docs/Sheets) — depends on the id map
  // above. Restoring content_hash means the next periodic sync correctly
  // detects "unchanged" if the source hasn't actually been edited since
  // the backup was taken, instead of needlessly reprocessing it once.
  const addSource = db.prepare(`
    INSERT INTO knowledge_sources (type, source_url, external_id, document_id, content_hash, sheet_purpose, sync_enabled, last_synced_at, last_sync_status, added_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let sourcesRestored = 0, sourcesSkipped = 0;
  for (const src of backup.knowledgeSources || []) {
    const newDocId = oldIdToNewId.get(src.document_id);
    if (!newDocId) { sourcesSkipped++; continue; }
    addSource.run(src.type, src.source_url, src.external_id, newDocId, src.content_hash, src.sheet_purpose, src.sync_enabled, src.last_synced_at, src.last_sync_status, src.added_by);
    sourcesRestored++;
  }

  // --- Sheet data (structured rows/columns for spreadsheet operations) —
  // same id-remapping dependency as knowledge sources above.
  const setSheetData = db.prepare(`
    INSERT INTO sheet_data (document_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(document_id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
  `);
  let sheetDataRestored = 0;
  for (const sd of backup.sheetData || []) {
    const newDocId = oldIdToNewId.get(sd.document_id);
    if (!newDocId) continue;
    setSheetData.run(newDocId, sd.data);
    sheetDataRestored++;
  }

  return {
    documentsRestored, reindexed, reindexFailures, reindexErrors,
    nationLinksRestored, sourcesRestored, sourcesSkipped, sheetDataRestored
  };
}

module.exports = { exportBackup, importBackup };
