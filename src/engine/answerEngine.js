// ============================================================
// Answer Engine (Sections 16, 17, 23, 27, 35 - Retrieval,
// Confidence, Official Answers Only, RAG, Citations)
// Retrieves knowledge, then asks the model to answer STRICTLY
// from what was retrieved and to self-report confidence grounded
// in whether the retrieved material actually covers the question.
// ============================================================
const ai = require('../ai/providerManager');
const knowledgeStore = require('../knowledge/knowledgeStore');
const faqManager = require('../knowledge/faqManager');
const configManager = require('../config/configManager');

const PERSONALITIES = {
  professional: 'Respond in a concise, formal, direct tone.',
  friendly: 'Respond in a warm, conversational, approachable tone.',
  mentor: 'Respond in an educational, detailed tone suited to teaching a beginner.'
};

function buildSystemPrompt() {
  const personality = configManager.get('personality');
  const officialOnly = configManager.getBool('official_answers_only');

  return `You are UNAI, the official AI assistant for the Union of Nations (TUN) alliance in the game Politics & War.

Core principles you must always follow:
- Government members always have final authority. You are an assistant, never a decision-maker.
- Never approve grants or loans, declare war, issue military orders, cast votes, discipline members, or make binding policy or diplomatic decisions. Direct these to the appropriate government role instead.
- Prefer retrieved official TUN documentation over your general knowledge of Politics & War. If retrieved context and general knowledge conflict, trust the retrieved context.
- Never invent or guess at TUN-specific policy, numbers, or procedures. If the retrieved context doesn't cover the question, say so plainly instead of filling the gap with a plausible-sounding guess.
${officialOnly ? '- OFFICIAL ANSWERS ONLY MODE IS ON: if the retrieved context does not clearly cover this alliance-specific question, you must refuse to answer it and state that a government member should be consulted instead.' : ''}
- ${PERSONALITIES[personality] || PERSONALITIES.professional}

You must respond ONLY with valid JSON of this exact shape:
{
  "answer": string,               // the reply to send, empty string if you should not answer
  "confidence": number,           // 0-100, how well the retrieved context supports this specific answer
  "should_respond": boolean,      // false if you lack grounds to answer usefully
  "should_escalate": boolean,     // true if this requires human government authority
  "sources": string[]             // titles of documents actually used, empty if none
}`;
}

/**
 * Full pipeline: FAQ check -> semantic search -> grounded generation.
 * @param {string} question
 * @param {string} level - requester's permission level
 * @param {string} contextText - short recent conversation context
 */
async function answer(question, level, contextText = '') {
  const faqHits = faqManager.findRelevant(question, 3);
  const chunks = await knowledgeStore.search(question, { level, topK: 5 });

  const contextBlocks = [
    ...faqHits.map(f => `[FAQ: ${f.question}]\n${f.answer}`),
    ...chunks.map(c => `[Document: ${c.title} (${c.category}, v${c.version})]\n${c.content}`)
  ];

  const retrievedContext = contextBlocks.length > 0
    ? contextBlocks.join('\n\n---\n\n')
    : '(No relevant official documentation was found for this question.)';

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    {
      role: 'user',
      content: `Recent conversation context (may be empty):\n${contextText}\n\nRetrieved knowledge:\n${retrievedContext}\n\nMember question:\n${question}`
    }
  ];

  const raw = await ai.chat(messages, { json: true, purpose: 'answer' });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Section 3.3: Silence is Better Than Being Wrong.
    parsed = { answer: '', confidence: 0, should_respond: false, should_escalate: false, sources: [] };
  }

  const documentTitles = chunks.map(c => c.title);
  return {
    ...parsed,
    documentsConsulted: documentTitles,
    faqConsulted: faqHits.map(f => f.question)
  };
}

module.exports = { answer, buildSystemPrompt };
