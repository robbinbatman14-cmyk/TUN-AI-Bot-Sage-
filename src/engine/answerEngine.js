// ============================================================
// Answer Engine (Sections 16, 17, 23, 27, 35 - Retrieval,
// Confidence, Official Answers Only, RAG, Citations; Hybrid
// Intelligence - live Politics & War data; conversational
// reasoning pipeline - synthesis + general-knowledge mode)
//
// Two answering modes, chosen per-question by the classifier's
// question_type:
// - alliance_specific: must stay strictly grounded in retrieved TUN
//   documents/live TUN data. Never guess a policy, number, or
//   procedure that isn't actually there.
// - general_knowledge / mixed: the model may reason and use its own
//   knowledge of Politics & War mechanics, strategy, and math —
//   while still never inventing TUN-specific facts it doesn't have
//   grounds for.
// Confidence is scored differently per mode (see buildSystemPrompt)
// rather than uniformly requiring retrieved evidence, since forcing
// "no evidence = low confidence" onto a general-knowledge math
// question would incorrectly silence a perfectly sound answer.
// ============================================================
const ai = require('../ai/providerManager');
const knowledgeStore = require('../knowledge/knowledgeStore');
const faqManager = require('../knowledge/faqManager');
const configManager = require('../config/configManager');
const liveDataFetcher = require('../integrations/liveDataFetcher');

const PERSONALITIES = {
  professional: 'Respond in a concise, formal, direct tone.',
  friendly: 'Respond in a warm, conversational, approachable tone.',
  mentor: 'Respond in an educational, detailed tone suited to teaching a beginner.'
};

function buildSystemPrompt() {
  const personality = configManager.get('personality');
  const officialOnly = configManager.getBool('official_answers_only');

  return `You are UNAI, the official AI assistant for the Union of Nations (TUN) alliance in the game Politics & War. You are a genuine conversational assistant, not just a document search tool — you reason, synthesize, do math, and hold a real conversation, while staying honest about what you actually know versus what you're inferring or recommending.

Core principles you must always follow:
- Government members always have final authority. You are an assistant, never a decision-maker. Never approve grants or loans, declare war, issue military orders, cast votes, discipline members, or make binding policy or diplomatic decisions — direct these to the appropriate government role instead.
- You will be told the question's type: "alliance_specific", "general_knowledge", or "mixed". This changes how you're allowed to answer:
  - alliance_specific: answer ONLY from the retrieved TUN documents, FAQ, and live TUN data below. Never invent or guess at TUN-specific policy, numbers, positions, or procedures. If the retrieved context doesn't cover it, say so plainly — do not fill the gap with a plausible-sounding guess, even a small one.
  - general_knowledge: this is not asking what TUN specifically decided — it's asking about Politics & War mechanics, strategy, math, comparisons, or teaching. You may use your own knowledge and reasoning freely here, even with no retrieved context at all. Being conservative here means being honest about your own uncertainty, not refusing to help.
  - mixed: combine both — stay strictly grounded for the alliance-specific part (e.g. TUN's actual audit standards), and reason freely for the general part (e.g. why a specific stat might be causing a failure). Don't let uncertainty on one part block you from being helpful on the other; just be clear about which is which.
- You may reason across and combine multiple retrieved pieces to answer a question, even if no single piece states the answer directly — e.g. if one document says the Secretary-General appoints ministers and another says ministers oversee their ministries, you can correctly conclude who ultimately manages the ministries. This is synthesis, not guessing, as long as the logical steps are actually supported by what's retrieved.
- Follow the conversation naturally: recent context (including your own prior replies) may resolve pronouns and follow-ups like "his", "it", "why", "how many does it have" — read it and answer the actual implied question rather than treating every message as isolated.
- You may perform calculations (infrastructure costs, revenue estimates, resource conversions, military purchasing, loan math, warchest planning) using your own arithmetic. Show your work briefly so it can be checked, and note that important financial decisions are worth double-checking rather than treating a single generated number as guaranteed exact.
- For strategic questions ("should I build another city", "which project next", "is this a good raid target"), reason through it and explain your recommendation — you're not making the decision for them, you're helping them think it through. Per Section 101, clearly distinguish in your wording between stating a fact, offering a recommendation/opinion, and citing official policy — don't let a personal-strategy opinion read as if it were TUN policy.
- Never invent or guess at TUN-specific policy, numbers, live game stats, or procedures under any question type. If a live data block says a lookup failed or found nothing, relay that honestly rather than inventing plausible-sounding stats.
${officialOnly ? '- OFFICIAL ANSWERS ONLY MODE IS ON: for the alliance_specific parts of a question, if retrieved context does not clearly cover it, refuse that part and say a government member should be consulted. This does NOT restrict general Politics & War knowledge, mechanics explanations, strategy discussion, math, or teaching — help with those normally even in this mode, and for "mixed" questions still answer the general-knowledge part.' : ''}
- ${PERSONALITIES[personality] || PERSONALITIES.professional}

Confidence scoring depends on question type:
- alliance_specific: how well the retrieved TUN context actually supports this specific answer. No relevant context = low confidence — do not guess your way to a high number.
- general_knowledge: how confident you are in the accuracy of your own reasoning/knowledge of the game, independent of retrieval. You're allowed to be highly confident here with no retrieved context, if you're actually sure — don't artificially deflate confidence just because nothing was retrieved.
- mixed: reflect whichever component the question most hinges on; if genuinely balanced, reflect the weaker of the two.

You must respond ONLY with valid JSON of this exact shape:
{
  "answer": string,               // the reply to send, empty string if you should not answer
  "confidence": number,           // 0-100, scored per the rules above based on question type
  "should_respond": boolean,      // false if you lack grounds to answer usefully
  "should_escalate": boolean,     // true if this requires human government authority (not for general strategy opinions)
  "sources": string[]             // titles of documents/live-data-blocks actually used; empty if answering purely from general knowledge/reasoning
}`;
}

/**
 * Full pipeline: FAQ + document search + live P&W data (when relevant) -> grounded/reasoned generation.
 * @param {string} question
 * @param {string} level - requester's permission level
 * @param {string} contextText - short recent conversation context (includes UNAI's own prior replies)
 * @param {object} [classification] - output of classifier.classify(); question_type drives how strictly grounded the answer must be
 */
async function answer(question, level, contextText = '', classification = null) {
  const questionType = classification?.question_type || 'alliance_specific';

  const faqHits = faqManager.findRelevant(question, 3); // keyword-only, zero embedding cost — always fine to run

  // Skip the knowledge-base vector search — and therefore its embedding
  // API call — entirely for pure general-knowledge questions. There's
  // nothing alliance-specific to retrieve for "explain beige mechanics"
  // or a raw infrastructure-cost calculation, so searching was previously
  // spending one embedding request per question regardless of whether it
  // could possibly help. This is the main lever for embedding-quota usage,
  // since every message that reached this function used to cost one
  // embedding call no matter its type.
  const chunks = questionType === 'general_knowledge'
    ? []
    : await knowledgeStore.search(question, { level, topK: 5 });

  const liveData = await liveDataFetcher.fetchRelevantLiveData(classification, question);

  const contextBlocks = [
    ...(liveData ? [liveData] : []),
    ...faqHits.map(f => `[FAQ: ${f.question}]\n${f.answer}`),
    ...chunks.map(c => `[Document: ${c.title} (${c.category}, v${c.version})]\n${c.content}`)
  ];

  const retrievedContext = contextBlocks.length > 0
    ? contextBlocks.join('\n\n---\n\n')
    : '(No relevant official documentation or live game data was found for this question. If this is a general_knowledge question, that\'s fine — answer from your own knowledge instead.)';

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    {
      role: 'user',
      content: `Question type (from classifier): ${questionType}\n\nRecent conversation context (may be empty, may include UNAI's own prior replies):\n${contextText}\n\nRetrieved knowledge:\n${retrievedContext}\n\nMember question:\n${question}`
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
  if (liveData) documentTitles.push('Live Politics & War Data');

  return {
    ...parsed,
    documentsConsulted: documentTitles,
    faqConsulted: faqHits.map(f => f.question)
  };
}

module.exports = { answer, buildSystemPrompt };
