// ============================================================
// Document Manager (Section 38: Approval Workflow, Section 32: Metadata)
// Uploaded docs sit as "pending" until an admin approves them —
// only approved documents are ever searched or shown to the AI.
// ============================================================
const db = require('../config/db');
const knowledgeStore = require('./knowledgeStore');

function addDocument({ title, category, visibility = 'members_only', content, filename, uploadedBy }) {
  const result = db.prepare(`
    INSERT INTO documents (title, category, visibility, status, content, filename, uploaded_by)
    VALUES (?, ?, ?, 'pending', ?, ?, ?)
  `).run(title, category, visibility, content, filename || null, uploadedBy);
  return result.lastInsertRowid;
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
    return db.prepare('SELECT id, title, category, visibility, status, version, created_at FROM documents WHERE status = ? ORDER BY id DESC').all(status);
  }
  return db.prepare('SELECT id, title, category, visibility, status, version, created_at FROM documents ORDER BY id DESC').all();
}

function getDocument(id) {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
}

async function reindexDocument(id) {
  return knowledgeStore.indexDocument(id);
}

module.exports = {
  addDocument, approveDocument, rejectDocument, archiveDocument,
  deleteDocument, listDocuments, getDocument, reindexDocument
};
