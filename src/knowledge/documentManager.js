// ============================================================
// Document Manager (Section 38: Approval Workflow, Section 32: Metadata)
// Uploaded docs sit as "pending" until an admin approves them —
// only approved documents are ever searched or shown to the AI.
// ============================================================
const db = require('../config/db');
const knowledgeStore = require('./knowledgeStore');

const PRIORITY_LABELS = {
  1: 'Doctrine/Constitution/Official Policy',
  2: 'Internal Guides & Handbooks',
  3: 'Official Politics & War Documentation',
  4: 'Community/External Guides'
};

function addDocument({ title, category, visibility = 'members_only', priority = 2, content, filename, uploadedBy }) {
  const result = db.prepare(`
    INSERT INTO documents (title, category, visibility, priority, status, content, filename, uploaded_by)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(title, category, visibility, clampPriority(priority), content, filename || null, uploadedBy);
  return result.lastInsertRowid;
}

function clampPriority(priority) {
  const n = Number(priority);
  if (!Number.isInteger(n) || n < 1 || n > 4) return 2; // fall back to the safe middle default
  return n;
}

function setPriority(id, priority) {
  db.prepare('UPDATE documents SET priority = ? WHERE id = ?').run(clampPriority(priority), id);
}

async function approveDocument(id) {
  db.prepare("UPDATE documents SET status = 'approved' WHERE id = ?").run(id);
  const chunkCount = await knowledgeStore.indexDocument(id);
  return chunkCount;
}

function rejectDocument(id) {
  db.prepare("UPDATE documents SET status = 'rejected' WHERE id = ?").run(id);
}

function archiveDocument(id) {
  db.prepare("UPDATE documents SET status = 'archived' WHERE id = ?").run(id);
  db.prepare('DELETE FROM chunks WHERE document_id = ?').run(id);
}

function deleteDocument(id) {
  db.prepare('DELETE FROM documents WHERE id = ?').run(id); // chunks cascade
}

function listDocuments(status = null) {
  if (status) {
    return db.prepare('SELECT id, title, category, visibility, priority, status, version, created_at FROM documents WHERE status = ? ORDER BY priority ASC, id DESC').all(status);
  }
  return db.prepare('SELECT id, title, category, visibility, priority, status, version, created_at FROM documents ORDER BY priority ASC, id DESC').all();
}

function getDocument(id) {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
}

async function reindexDocument(id) {
  return knowledgeStore.indexDocument(id);
}

/**
 * Replaces a document's content with new text, archiving the previous
 * content into document_versions and bumping the minor version number
 * (Section 37 - Knowledge Versioning). If the document is currently
 * approved, it's automatically re-indexed so search reflects the update
 * immediately; if it's pending/rejected/archived, content is updated but
 * left as-is until separately approved.
 */
async function updateDocumentContent(id, newContent) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  if (!doc) throw new Error(`No document with ID ${id}.`);

  db.prepare('INSERT INTO document_versions (document_id, version, content) VALUES (?, ?, ?)')
    .run(id, doc.version, doc.content);

  const [major, minor] = (doc.version || '1.0').split('.').map(n => parseInt(n, 10) || 0);
  const newVersion = `${major}.${minor + 1}`;

  db.prepare('UPDATE documents SET content = ?, version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(newContent, newVersion, id);

  let chunkCount = 0;
  const reindexed = doc.status === 'approved';
  if (reindexed) {
    chunkCount = await knowledgeStore.indexDocument(id);
  }

  return { previousVersion: doc.version, newVersion, reindexed, chunkCount };
}

function getVersionHistory(id) {
  return db.prepare('SELECT version, archived_at FROM document_versions WHERE document_id = ? ORDER BY id DESC').all(id);
}

module.exports = {
  addDocument, approveDocument, rejectDocument, archiveDocument,
  deleteDocument, listDocuments, getDocument, reindexDocument,
  updateDocumentContent, getVersionHistory, setPriority, PRIORITY_LABELS
};
