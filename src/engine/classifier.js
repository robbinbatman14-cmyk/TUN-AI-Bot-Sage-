// ============================================================
// Classifier (Sections 14, 15, 17 - Question Detection, Topic
// Classification, Confidence Evaluation; conversational reasoning
// pipeline - question_type routing; structured-source routing;
// structured-operation routing)
// One cheap, structured-JSON call decides whether a message is
// (a) actually a question, (b) about an approved topic, (c) whether
// it needs live P&W data, (d) whether it's an alliance-specific
// claim that must stay strictly grounded vs. a general Politics &
// War / reasoning / math question where the model's own knowledge
// is fair game, (e) whether it should route to a purpose-tagged
// structured source (a Google Sheet like a Member Roster) instead of
// a normal semantic document search, and (f) whether it's asking for
// a spreadsheet OPERATION (sort/rank/filter/count/average) on that
// source rather than just a listing — "top 10 by score" needs real
// computation across every row, not the model eyeballing a text dump.
// It also resolves pronouns/follow-ups against the short conversation
// context it's given (which now includes UNAI's own prior replies,
// not just human messages).
// The real confidence score is re-evaluated after retrieval in
// answerEngine.js, since confidence should reflect whether we
// actually FOUND relevant information (for alliance-specific claims)
// or how sound the reasoning is (for general-knowledge ones) — not
// just whether the topic sounds answerable.
// ============================================================
const ai = require('../ai/providerManager');
const configManager = require('../config/configManager');
const sourceManager = require('../knowledge/sourceManager');

async function classify(messageText, contextText = '') {
  const topics = configManager.enabledTopicNames().join(', ');

  const structuredSources = sourceManager.listSheetPurposes();
  const structuredSourceBlock = structuredSources.length
    ? `Available structured data sources (purpose-tagged Google Sheets):\n${structuredSources.map(s => `- "${s.purpose}": ${s.title} [columns: ${s.columns.join(', ')}]`).join('\n')}\n\n` +
      `If the question is best answered by looking up records from one of these, set structured_source to that exact purpose key (e.g. "member_roster"). Only set it when a listed source's purpose clearly matches; otherwise use null. When a structured source is matched, it's authoritative for that intent — do NOT also request live_data for the same thing.\n\n` +
      `Separately, decide if the request is a SPREADSHEET OPERATION rather than a plain listing — sorting, ranking/top-N, filtering, counting-with-a-condition, or averaging/summing a column. Examples: "rank nations by population", "top 10 by score", "which nation has the highest revenue", "count members with revenue above $50 million", "what is the average infrastructure". If so, fill in structured_operation using the EXACT column name from the source's [columns: ...] list above (map the natural-language term to the closest real column — e.g. "population" might map to a "Cities" or "Score" column depending on what actually exists; if nothing reasonably matches, leave structured_operation.needed false and let it fall back to a normal listing). A plain "list all members" or "show the roster" is NOT an operation — leave structured_operation.needed false for those, only structured_source matters.`
    : 'No structured data sources (purpose-tagged Google Sheets) are currently configured — always use null for structured_source and false for structured_operation.needed.';

  const system = `You are a strict message classifier for a Politics & War alliance Discord assistant.

Decide if the message is genuinely asking for information or help (not just containing a "?"), and if so, whether it falls under one of these approved topics: ${topics}. General Politics & War game mechanics, strategy discussion, calculations (infrastructure costs, revenue, loans, warchest planning), comparisons, and teaching newer players all count as on-topic under "politics_and_war" — they don't need to match a specific document to be on-topic.
Ignore small talk, greetings, jokes, off-topic chat, real-world politics, and anything unrelated to the alliance or the game Politics & War.

If recent conversation context is provided (including UNAI's own prior replies), use it to resolve pronouns and follow-ups — e.g. "what are HIS responsibilities?" after a question about a specific minister means "his" = that minister; "why was IT increased?" after a tax-rate question means "it" = the tax rate. Rewrite the effective question in your reasoning if needed, but classify based on what's actually being asked once resolved.

Classify question_type as one of:
- "alliance_specific": asks about TUN's own policies, positions, procedures, decisions, or specific numbers — must be answered from actual retrieved TUN documentation or live TUN data, never guessed.
- "general_knowledge": PURELY mechanical/factual Politics & War questions with no possible policy angle — how a game mechanic works, a formula, a definition, teaching a rule. Use this ONLY when you're confident no alliance could plausibly have a stance on it.
- "mixed": any question seeking advice, a recommendation, or "should I..." — building strategy, whether to do something, which option is better, why something happened to the member's own nation. Default to "mixed" whenever there's ANY chance the alliance has its own doctrine, policy, or stance on the topic (e.g. "should I farm", "is this a good strategy", "should I build another city", "why did my audit fail") — even if you personally could answer it from general game knowledge alone. This matters: "mixed" searches the knowledge base for TUN's own position before answering: a general Politics & War strategy that TUN doctrine actually discourages must not be given as unqualified advice. When genuinely unsure between "general_knowledge" and "mixed", choose "mixed".

Also decide whether answering requires CURRENT, real-time Politics & War game data — e.g. a specific nation's current stats, a specific alliance's current ranking/members, or top alliance rankings right now. Do NOT set this for questions answerable from stored documentation or general game knowledge alone.
If live data is needed, extract the exact nation or alliance name/leader name mentioned (entity_name) — the literal text as written, not a guess at spelling. If context resolves a pronoun to a previously-mentioned entity, use that resolved name.

${structuredSourceBlock}

Respond ONLY with JSON in this exact shape:
{"is_question": boolean, "on_topic": boolean, "topic": string, "question_type": "alliance_specific"|"general_knowledge"|"mixed", "live_data": {"needed": boolean, "type": "nation"|"alliance"|"top_alliances"|null, "entity_name": string|null}, "structured_source": string|null, "structured_operation": {"needed": boolean, "type": "sort"|"top_n"|"bottom_n"|"count"|"filter"|"average"|"sum"|null, "column": string|null, "direction": "asc"|"desc"|null, "limit": number|null, "filter_column": string|null, "filter_operator": ">"|"<"|">="|"<="|"=="|"contains"|null, "filter_value": string|null}, "reasoning": string}`;

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: `Recent context (may be empty, may include UNAI's own prior replies):\n${contextText}\n\nMessage to classify:\n${messageText}` }
  ];

  const raw = await ai.chat(messages, { json: true, purpose: 'classify' });
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.live_data) parsed.live_data = { needed: false, type: null, entity_name: null };
    if (!parsed.question_type) parsed.question_type = 'alliance_specific'; // safest default if the model omits it
    if (parsed.structured_source === undefined) parsed.structured_source = null;
    if (!parsed.structured_operation) parsed.structured_operation = { needed: false };
    // If a structured source (listing or operation) was matched, live_data
    // for the same turn is redundant by design — enforce it here too
    // rather than only hoping the model complies.
    if (parsed.structured_source) parsed.live_data = { needed: false, type: null, entity_name: null };
    // An operation implies a source — if the model set one without the
    // other, infer structured_source is needed too (fail toward still
    // routing correctly rather than dropping the operation).
    if (parsed.structured_operation.needed && !parsed.structured_source && structuredSources.length === 1) {
      parsed.structured_source = structuredSources[0].purpose;
    }
    return parsed;
  } catch {
    // Fail safe: if the classifier output isn't parseable, treat as not-a-question
    // rather than guessing (Section 3.3 - Silence is Better Than Being Wrong).
    return {
      is_question: false, on_topic: false, topic: '', question_type: 'alliance_specific',
      live_data: { needed: false, type: null, entity_name: null }, structured_source: null,
      structured_operation: { needed: false }, reasoning: 'classifier parse failure'
    };
  }
}

module.exports = { classify };
