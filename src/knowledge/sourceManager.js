// ============================================================
// Knowledge Source Manager (Section 29 - Dynamic Knowledge
// Sources, Section 39 - Automatic Knowledge Updates)
// A "source" is an external origin (currently: a Google Doc) that
// stays linked to a document row. Syncing re-fetches the source,
// and if content changed, feeds it through documentManager's
// existing versioning system (Section 37) — so every auto-sync
// is just another version, with full history, using the same
// machinery a manual /knowledge update would use.
// Designed to extend to other source types later (website,
// GitHub, Google Sheets) without changing this file's shape —
// each new type just needs its own fetch module like
// googleDocsSource.js and a branch in syncSource().
// ============================================================
const crypto = require('crypto');
const db = require('../config/db');
const documentManager = require('./documentManager');
const googleDocsSource = require('./googleDocsSource');

function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function addGoogleDocSource({ url, title, category, visibility, addedBy }) {
  const docId = googleDocsSource.extractGoogleDocId(url);
  const content = await googleDocsSource.fetchGoogleDocText(docId);

  const documentId = documentManager.addDocument({
    title, category, visibility, content, filename: `google-doc-${docId}.txt`, uploadedBy: addedBy
  });

  const result = db.prepare(`
    INSERT INTO knowledge_sources (type, source_url, external_id, document_id, content_hash, sync_enabled, added_by)
    VALUES ('google_doc', ?, ?, ?, ?, 1, ?)
  `).run(url, docId, documentId, hash(content), addedBy);

  return { sourceId: result.lastInsertRowid, documentId };
}

function listSources() {
  return db.prepare(`
    SELECT ks.id, ks.type, ks.source_url, ks.sync_enabled, ks.last_synced_at, ks.last_sync_status,
           d.id as document_id, d.title, d.status, d.version
    FROM knowledge_sources ks JOIN documents d ON d.id = ks.document_id
    ORDER BY ks.id DESC
  `).all();
}

function getSource(id) {
  return db.prepare('SELECT * FROM knowledge_sources WHERE id = ?').get(id);
}

function setSourceEnabled(id, enabled) {
  db.prepare('UPDATE knowledge_sources SET sync_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

function removeSource(id) {
  db.prepare('DELETE FROM knowledge_sources WHERE id = ?').run(id); // the document itself is untouched
}

/**
 * Re-fetches one source and, if content actually changed, pushes it
 * through documentManager.updateDocumentContent — which archives the
 * old version and only re-indexes if the document is currently approved.
 */
async function syncSource(id) {
  const source = getSource(id);
  if (!source) throw new Error(`No knowledge source with ID ${id}.`);

  const doc = documentManager.getDocument(source.document_id);
  if (!doc) throw new Error('The document this source was linked to no longer exists.');

  let content;
  if (source.type === 'google_doc') {
    content = await googleDocsSource.fetchGoogleDocText(source.external_id);
  } else {
    throw new Error(`Unknown source type "${source.type}".`);
  }

  const newHash = hash(content);
  if (newHash === source.content_hash) {
    db.prepare("UPDATE knowledge_sources SET last_synced_at = CURRENT_TIMESTAMP, last_sync_status = 'unchanged' WHERE id = ?").run(id);
    return { synced: false, reason: 'unchanged' };
  }

  const updateResult = await documentManager.updateDocumentContent(source.document_id, content);
  db.prepare("UPDATE knowledge_sources SET content_hash = ?, last_synced_at = CURRENT_TIMESTAMP, last_sync_status = 'updated' WHERE id = ?")
    .run(newHash, id);

  return { synced: true, ...updateResult };
}

/** Runs on a timer (see index.js) — syncs every source with sync_enabled=1. */
async function syncAllDueSources() {
  const sources = db.prepare('SELECT id FROM knowledge_sources WHERE sync_enabled = 1').all();
  const results = [];
  for (const { id } of sources) {
    try {
      results.push({ id, ...(await syncSource(id)) });
    } catch (err) {
      db.prepare('UPDATE knowledge_sources SET last_sync_status = ? WHERE id = ?').run(`error: ${err.message}`.slice(0, 200), id);
      results.push({ id, synced: false, error: err.message });
    }
  }
  return results;
}

module.exports = {
  addGoogleDocSource, listSources, getSource,
  setSourceEnabled, removeSource, syncSource, syncAllDueSources
};
