// ============================================================
// Knowledge Store (Sections 26-44, 111)
// A lightweight, dependency-free vector store built on SQLite:
// documents are split into chunks, each chunk gets an embedding,
// and search does cosine similarity in JS. This is plenty fast
// for an alliance-sized knowledge base (hundreds of documents)
// without needing a hosted vector database service.
// ============================================================
const db = require('../config/db');
const ai = require('../ai/providerManager');
const { createTTLCache } = require('../utils/ttlCache');

const CHUNK_SIZE = 900;      // ~characters per chunk
const CHUNK_OVERLAP = 150;

// Repeated/duplicate questions are common in an alliance Discord (many
// members asking "how do I get a grant" independently) — caching the
// query embedding for an hour avoids spending a fresh embedding request
// on text that was already embedded recently.
const queryEmbeddingCache = createTTLCache();

function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

/**
 * Index (or re-index) a single document: deletes old chunks, splits
 * content, embeds ALL chunks in one batched request (see
 * providerManager.embedBatch) rather than one request per chunk, then
 * stores the vectors. This is the main lever for embedding-quota usage
 * on the indexing side — a 20-chunk document costs 1 request, not 20.
 */
async function indexDocument(documentId) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
  if (!doc) throw new Error('Document not found');

  db.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId);

  const pieces = chunkText(doc.content);
  if (pieces.length === 0) return 0;

  const embeddings = await ai.embedBatch(pieces);

  const insert = db.prepare(
    'INSERT INTO chunks (document_id, chunk_index, content, embedding) VALUES (?, ?, ?, ?)'
  );
  for (let i = 0; i < pieces.length; i++) {
    insert.run(documentId, i, pieces[i], JSON.stringify(embeddings[i]));
  }
  db.prepare('UPDATE documents SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(documentId);
  return pieces.length;
}

/**
 * Semantic search across APPROVED documents the given permission
 * level is allowed to see. Returns top-K chunks with document
 * metadata, ranked by similarity.
 */
async function search(query, { level, topK = 5 } = {}) {
  const permissions = require('../permissions/permissionEngine');

  const cacheKey = query.trim().toLowerCase();
  let queryEmbedding = queryEmbeddingCache.get(cacheKey);
  if (queryEmbedding === undefined) {
    queryEmbedding = await ai.embed(query);
    queryEmbeddingCache.set(cacheKey, queryEmbedding, 3600); // 1 hour
  }

  const rows = db.prepare(`
    SELECT chunks.id as chunk_id, chunks.content, chunks.embedding,
           documents.id as document_id, documents.title, documents.category,
           documents.visibility, documents.version
    FROM chunks
    JOIN documents ON documents.id = chunks.document_id
    WHERE documents.status = 'approved'
  `).all();

  const scored = rows
    .filter(r => permissions.canAccessVisibility(level, r.visibility))
    .map(r => ({
      ...r,
      score: cosineSimilarity(queryEmbedding, JSON.parse(r.embedding))
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map(({ embedding, ...rest }) => rest); // don't leak raw vectors upward
}

module.exports = { indexDocument, search, chunkText, queryEmbeddingCache };
