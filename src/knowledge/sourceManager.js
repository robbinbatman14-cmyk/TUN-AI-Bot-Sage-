// ============================================================
// Knowledge Source Manager (Section 29 - Dynamic Knowledge
// Sources, Section 39 - Automatic Knowledge Updates)
// A "source" is an external origin (currently: a Google Doc) that
// stays linked to a document row. Syncing re-fetches the source,
// and if content changed, feeds it through documentManager's
// existing versioning system (Section 37) — so every auto-sync
// is just another version, with full history, using the same
// machinery a manual /knowledge update would use.
//
// Change detection compares a hash of the SOURCE's raw bytes
// (computed in googleDocsSource.js), never a hash of the final
// AI-processed text — see the comment there for why that distinction
// matters once image descriptions (which aren't perfectly
// deterministic) are part of the pipeline.
//
// Designed to extend to other source types later (website,
// GitHub, Google Sheets) without changing this file's shape —
// each new type just needs its own fetch module like
// googleDocsSource.js and a branch in syncSource().
// ============================================================
const db = require('../config/db');
const documentManager = require('./documentManager');
const googleDocsSource = require('./googleDocsSource');
const imageAnalyzer = require('./imageAnalyzer');

/** Fetches a source and builds its final indexable text (including analyzed images). */
async function fetchAndBuildContent(source) {
  if (source.type !== 'google_doc') {
    throw new Error(`Unknown source type "${source.type}".`);
  }
  const { rawHash, text, images } = await googleDocsSource.fetchGoogleDoc(source.external_id);
  const imageBlocks = images.length > 0 ? await imageAnalyzer.describeImages(images) : [];
  const content = imageAnalyzer.appendImageDescriptions(text, imageBlocks);
  return { rawHash, content, imageCount: images.length };
}

async function addGoogleDocSource({ url, title, category, visibility, addedBy }) {
  const docId = googleDocsSource.extractGoogleDocId(url);
  const { rawHash, content } = await fetchAndBuildContent({ type: 'google_doc', external_id: docId });

  const documentId = documentManager.addDocument({
    title, category, visibility, content, filename: `google-doc-${docId}.docx`, uploadedBy: addedBy
  });

  const result = db.prepare(`
    INSERT INTO knowledge_sources (type, source_url, external_id, document_id, content_hash, sync_enabled, added_by)
    VALUES ('google_doc', ?, ?, ?, ?, 1, ?)
  `).run(url, docId, documentId, rawHash, addedBy);

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
 * Re-fetches one source and, if the SOURCE ITSELF changed (by raw-byte
 * hash), rebuilds its content (including re-analyzing images) and pushes
 * it through documentManager.updateDocumentContent — which archives the
 * old version and only re-indexes if the document is currently approved.
 * If the raw source is unchanged, nothing is re-fetched-and-processed
 * beyond the initial download, so an unmodified Google Doc costs zero
 * additional vision/embedding requests on repeat syncs.
 */
async function syncSource(id) {
  const source = getSource(id);
  if (!source) throw new Error(`No knowledge source with ID ${id}.`);

  const doc = documentManager.getDocument(source.document_id);
  if (!doc) throw new Error('The document this source was linked to no longer exists.');

  // Fetch (cheap: text + raw images, no AI calls yet) to get the raw hash
  // before deciding whether the more expensive image-analysis step is
  // even needed.
  const { rawHash, text, images } = await googleDocsSource.fetchGoogleDoc(source.external_id);

  if (rawHash === source.content_hash) {
    db.prepare("UPDATE knowledge_sources SET last_synced_at = CURRENT_TIMESTAMP, last_sync_status = 'unchanged' WHERE id = ?").run(id);
    return { synced: false, reason: 'unchanged' };
  }

  const imageBlocks = images.length > 0 ? await imageAnalyzer.describeImages(images) : [];
  const content = imageAnalyzer.appendImageDescriptions(text, imageBlocks);

  const updateResult = await documentManager.updateDocumentContent(source.document_id, content);
  db.prepare("UPDATE knowledge_sources SET content_hash = ?, last_synced_at = CURRENT_TIMESTAMP, last_sync_status = 'updated' WHERE id = ?")
    .run(rawHash, id);

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
