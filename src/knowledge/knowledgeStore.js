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

// Recognized by chunkText() below: content that already contains this
// marker (e.g. from googleSheetsSource.js) is split along those exact
// boundaries instead of by character count. Tabular data needs this —
// a 900-character cut has no idea where one row ends and the next
// begins, and could easily slice a roster entry in half. Prose documents
// never contain this marker, so they're unaffected and still use the
// character-based chunker below.
const CHUNK_SEPARATOR = '\n\n===UNAI-CHUNK-BOUNDARY===\n\n';

// Repeated/duplicate questions are common in an alliance Discord (many
// members asking "how do I get a grant" independently) — caching the
// query embedding for an hour avoids spending a fresh embedding request
// on text that was already embedded recently.
const queryEmbeddingCache = createTTLCache();

function chunkText(text) {
  if (text.includes(CHUNK_SEPARATOR)) {
    return text.split(CHUNK_SEPARATOR).map(c => c.trim()).filter(Boolean);
  }
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

// Priority boost applied to cosine similarity for ranking purposes only
// (never mutates the actual similarity score). This is a deliberate
// deviation from strict "sort by priority, then relevance": a pure
// priority-first sort would let a Priority-1 document with near-zero
// topical relevance crowd out a highly relevant Priority-3/4 chunk out
// of the results entirely, which would make retrieval quality worse for
// unrelated questions. A weighted boost instead means that AMONG
// comparably relevant chunks, higher authority wins — which is what
// actually matters for conflict resolution — while a chunk still has to
// clear a relevance bar to be retrieved at all. The real conflict-
// resolution instruction (doctrine overrides general advice when both
// are present) lives in answerEngine.js's system prompt, not here —
// ranking just improves the odds that doctrine actually makes it into
// context in the first place.
const PRIORITY_BOOST = { 1: 0.15, 2: 0.10, 3: 0.05, 4: 0 };

/**
 * Semantic search across APPROVED documents the given permission
 * level is allowed to see. Returns top-K chunks with document
 * metadata, ranked by similarity with a source-authority boost
 * (see PRIORITY_BOOST above).
 */
async function search(query, { level, topK = 6 } = {}) {
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
           documents.visibility, documents.version, documents.priority
    FROM chunks
    JOIN documents ON documents.id = chunks.document_id
    WHERE documents.status = 'approved'
  `).all();

  const scored = rows
    .filter(r => permissions.canAccessVisibility(level, r.visibility))
    .map(r => {
      const score = cosineSimilarity(queryEmbedding, JSON.parse(r.embedding));
      const rank = score + (PRIORITY_BOOST[r.priority] || 0);
      return { ...r, score, rank };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, topK);

  return scored.map(({ embedding, rank, ...rest }) => rest); // don't leak raw vectors/internal rank upward
}

module.exports = { indexDocument, search, chunkText, queryEmbeddingCache, CHUNK_SEPARATOR };
