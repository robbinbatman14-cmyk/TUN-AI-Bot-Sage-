// ============================================================
// Knowledge Source Manager (Section 29 - Dynamic Knowledge
// Sources, Section 39 - Automatic Knowledge Updates)
// A "source" is an external origin (Google Doc or Google Sheet)
// that stays linked to a document row. Syncing re-fetches the
// source, and if content changed, feeds it through documentManager's
// existing versioning system (Section 37) — so every auto-sync
// is just another version, with full history, using the same
// machinery a manual /knowledge update would use.
//
// Change detection compares a hash of the SOURCE's raw bytes
// (computed in googleDocsSource.js / googleSheetsSource.js), never
// a hash of the final AI-processed text — see the comment in
// googleDocsSource.js for why that distinction matters once image
// descriptions (which aren't perfectly deterministic) are part of
// the pipeline.
//
// Adding a new source type means: a fetch module like
// googleDocsSource.js/googleSheetsSource.js that returns
// {rawHash, ...}, a branch in fetchRaw()/buildContent() below, and
// an add*Source() convenience function. Nothing else changes —
// listSources/syncSource/syncAllDueSources are already type-agnostic.
// ============================================================
const db = require('../config/db');
const documentManager = require('./documentManager');
const googleDocsSource = require('./googleDocsSource');
const googleSheetsSource = require('./googleSheetsSource');
const imageAnalyzer = require('./imageAnalyzer');

/** Fetches JUST the raw source + hash for a source — cheap, no AI calls yet. */
async function fetchRaw(source) {
  if (source.type === 'google_doc') return googleDocsSource.fetchGoogleDoc(source.external_id);
  if (source.type === 'google_sheet') return googleSheetsSource.fetchGoogleSheet(source.external_id);
  throw new Error(`Unknown source type "${source.type}".`);
}

/** Turns a fetchRaw() result into the final indexable text for its type. */
async function buildContent(source, raw) {
  if (source.type === 'google_doc') {
    const imageBlocks = raw.images.length > 0 ? await imageAnalyzer.describeImages(raw.images) : [];
    return imageAnalyzer.appendImageDescriptions(raw.text, imageBlocks);
  }
  if (source.type === 'google_sheet') {
    return raw.content; // already fully built (row-chunked) by googleSheetsSource.js
  }
  throw new Error(`Unknown source type "${source.type}".`);
}

async function addGoogleDocSource({ url, title, category, visibility, priority = 2, addedBy }) {
  const docId = googleDocsSource.extractGoogleDocId(url);
  const raw = await fetchRaw({ type: 'google_doc', external_id: docId });
  const content = await buildContent({ type: 'google_doc' }, raw);

  const documentId = documentManager.addDocument({
    title, category, visibility, priority, content, filename: `google-doc-${docId}.docx`, uploadedBy: addedBy
  });

  const result = db.prepare(`
    INSERT INTO knowledge_sources (type, source_url, external_id, document_id, content_hash, sync_enabled, added_by)
    VALUES ('google_doc', ?, ?, ?, ?, 1, ?)
  `).run(url, docId, documentId, raw.rawHash, addedBy);

  return { sourceId: result.lastInsertRowid, documentId };
}

async function addGoogleSheetSource({ url, title, category, visibility, priority = 2, addedBy }) {
  const sheetId = googleSheetsSource.extractGoogleSheetId(url);
  const raw = await fetchRaw({ type: 'google_sheet', external_id: sheetId });
  const content = await buildContent({ type: 'google_sheet' }, raw);

  const documentId = documentManager.addDocument({
    title, category, visibility, priority, content, filename: `google-sheet-${sheetId}.xlsx`, uploadedBy: addedBy
  });

  const result = db.prepare(`
    INSERT INTO knowledge_sources (type, source_url, external_id, document_id, content_hash, sync_enabled, added_by)
    VALUES ('google_sheet', ?, ?, ?, ?, 1, ?)
  `).run(url, sheetId, documentId, raw.rawHash, addedBy);

  return { sourceId: result.lastInsertRowid, documentId, sheetNames: raw.sheetNames, rowCount: raw.rowCount };
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
 * hash), rebuilds its content (re-analyzing images for Docs; re-parsing
 * rows for Sheets) and pushes it through documentManager.updateDocumentContent
 * — which archives the old version and only re-indexes if the document is
 * currently approved. If the raw source is unchanged, no further
 * processing happens beyond the initial download, so an unmodified source
 * costs zero additional vision/embedding requests on repeat syncs.
 */
async function syncSource(id) {
  const source = getSource(id);
  if (!source) throw new Error(`No knowledge source with ID ${id}.`);

  const doc = documentManager.getDocument(source.document_id);
  if (!doc) throw new Error('The document this source was linked to no longer exists.');

  const raw = await fetchRaw(source);

  if (raw.rawHash === source.content_hash) {
    db.prepare("UPDATE knowledge_sources SET last_synced_at = CURRENT_TIMESTAMP, last_sync_status = 'unchanged' WHERE id = ?").run(id);
    return { synced: false, reason: 'unchanged' };
  }

  const content = await buildContent(source, raw);
  const updateResult = await documentManager.updateDocumentContent(source.document_id, content);
  db.prepare("UPDATE knowledge_sources SET content_hash = ?, last_synced_at = CURRENT_TIMESTAMP, last_sync_status = 'updated' WHERE id = ?")
    .run(raw.rawHash, id);

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
  addGoogleDocSource, addGoogleSheetSource, listSources, getSource,
  setSourceEnabled, removeSource, syncSource, syncAllDueSources
};
