// ============================================================
// FAQ Manager (Section 41)
// Simple keyword-matched FAQ, consulted before the full RAG
// pipeline runs since it's cheaper and often the exact answer.
// ============================================================
const db = require('../config/db');

function addFaq({ question, answer, category, keywords, priority = 0, approvedBy }) {
  return db.prepare(`
    INSERT INTO faq (question, answer, category, keywords, priority, approved_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(question, answer, category, keywords, priority, approvedBy).lastInsertRowid;
}

function listFaq() {
  return db.prepare('SELECT * FROM faq ORDER BY priority DESC, id DESC').all();
}

function deleteFaq(id) {
  db.prepare('DELETE FROM faq WHERE id = ?').run(id);
}

/** Very lightweight relevance match: shared keyword/word overlap. */
function findRelevant(query, limit = 3) {
  const all = listFaq();
  const queryWords = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));

  const scored = all.map(f => {
    const bag = `${f.question} ${f.keywords || ''}`.toLowerCase();
    const words = new Set(bag.split(/\W+/).filter(Boolean));
    let overlap = 0;
    for (const w of queryWords) if (words.has(w)) overlap++;
    return { ...f, overlap };
  }).filter(f => f.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || b.priority - a.priority);

  return scored.slice(0, limit);
}

module.exports = { addFaq, listFaq, deleteFaq, findRelevant };
