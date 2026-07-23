// ============================================================
// Classifier (Sections 14, 15, 17 - Question Detection, Topic
// Classification, Confidence Evaluation; conversational reasoning
// pipeline - question_type routing)
// One cheap, structured-JSON call decides whether a message is
// (a) actually a question, (b) about an approved topic, (c) whether
// it needs live P&W data, and (d) whether it's an alliance-specific
// claim that must stay strictly grounded vs. a general Politics &
// War / reasoning / math question where the model's own knowledge
// is fair game. It also resolves pronouns/follow-ups against the
// short conversation context it's given (which now includes UNAI's
// own prior replies, not just human messages).
// The real confidence score is re-evaluated after retrieval in
// answerEngine.js, since confidence should reflect whether we
// actually FOUND relevant information (for alliance-specific claims)
// or how sound the reasoning is (for general-knowledge ones) — not
// just whether the topic sounds answerable.
// ============================================================
const ai = require('../ai/providerManager');
const configManager = require('../config/configManager');

async function classify(messageText, contextText = '') {
  const topics = configManager.enabledTopicNames().join(', ');

  const system = `You are a strict message classifier for a Politics & War alliance Discord assistant.

Decide if the message is genuinely asking for information or help (not just containing a "?"), and if so, whether it falls under one of these approved topics: ${topics}. General Politics & War game mechanics, strategy discussion, calculations (infrastructure costs, revenue, loans, warchest planning), comparisons, and teaching newer players all count as on-topic under "politics_and_war" — they don't need to match a specific document to be on-topic.
Ignore small talk, greetings, jokes, off-topic chat, real-world politics, and anything unrelated to the alliance or the game Politics & War.

If recent conversation context is provided (including UNAI's own prior replies), use it to resolve pronouns and follow-ups — e.g. "what are HIS responsibilities?" after a question about a specific minister means "his" = that minister; "why was IT increased?" after a tax-rate question means "it" = the tax rate. Rewrite the effective question in your reasoning if needed, but classify based on what's actually being asked once resolved.

Classify question_type as one of:
- "alliance_specific": asks about TUN's own policies, positions, procedures, decisions, or specific numbers — must be answered from actual retrieved TUN documentation or live TUN data, never guessed.
- "general_knowledge": general Politics & War game mechanics, strategy, math/calculations, comparisons, or teaching — not asking what TUN specifically decided, so the assistant's own knowledge and reasoning are appropriate.
- "mixed": needs both (e.g. "should I build another city" combines general strategy reasoning with the member's own live nation data; "why did my audit fail" combines TUN audit policy with the member's own results).

Also decide whether answering requires CURRENT, real-time Politics & War game data — e.g. a specific nation's current stats, a specific alliance's current ranking/members, or top alliance rankings right now. Do NOT set this for questions answerable from stored documentation or general game knowledge alone.
If live data is needed, extract the exact nation or alliance name/leader name mentioned (entity_name) — the literal text as written, not a guess at spelling. If context resolves a pronoun to a previously-mentioned entity, use that resolved name.

Respond ONLY with JSON in this exact shape:
{"is_question": boolean, "on_topic": boolean, "topic": string, "question_type": "alliance_specific"|"general_knowledge"|"mixed", "live_data": {"needed": boolean, "type": "nation"|"alliance"|"top_alliances"|null, "entity_name": string|null}, "reasoning": string}`;

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: `Recent context (may be empty, may include UNAI's own prior replies):\n${contextText}\n\nMessage to classify:\n${messageText}` }
  ];

  const raw = await ai.chat(messages, { json: true, purpose: 'classify' });
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.live_data) parsed.live_data = { needed: false, type: null, entity_name: null };
    if (!parsed.question_type) parsed.question_type = 'alliance_specific'; // safest default if the model omits it
    return parsed;
  } catch {
    // Fail safe: if the classifier output isn't parseable, treat as not-a-question
    // rather than guessing (Section 3.3 - Silence is Better Than Being Wrong).
    return {
      is_question: false, on_topic: false, topic: '', question_type: 'alliance_specific',
      live_data: { needed: false, type: null, entity_name: null }, reasoning: 'classifier parse failure'
    };
  }
}

module.exports = { classify };
