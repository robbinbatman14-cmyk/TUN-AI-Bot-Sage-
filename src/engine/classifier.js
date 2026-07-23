// ============================================================
// Classifier (Sections 14, 15, 17 - Question Detection, Topic
// Classification, Confidence Evaluation)
// One cheap, structured-JSON call decides whether a message is
// (a) actually a question, (b) about an approved topic, and a
// preliminary sense of how confidently it could be answered.
// The real confidence score is re-evaluated after retrieval in
// answerEngine.js, since confidence should reflect whether we
// actually FOUND relevant information, not just whether the
// topic sounds answerable.
// ============================================================
const ai = require('../ai/providerManager');
const configManager = require('../config/configManager');

async function classify(messageText, contextText = '') {
  const topics = configManager.enabledTopicNames().join(', ');

  const system = `You are a strict message classifier for a Politics & War alliance Discord assistant.
Decide if the message is genuinely asking for information (not just containing a "?"), and if so, whether it falls under one of these approved topics: ${topics}.
Ignore small talk, greetings, jokes, off-topic chat, real-world politics, and anything unrelated to the alliance or the game Politics & War.
Respond ONLY with JSON in this exact shape:
{"is_question": boolean, "on_topic": boolean, "topic": string, "reasoning": string}`;

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: `Recent context (may be empty):\n${contextText}\n\nMessage to classify:\n${messageText}` }
  ];

  const raw = await ai.chat(messages, { json: true });
  try {
    return JSON.parse(raw);
  } catch {
    // Fail safe: if the classifier output isn't parseable, treat as not-a-question
    // rather than guessing (Section 3.3 - Silence is Better Than Being Wrong).
    return { is_question: false, on_topic: false, topic: '', reasoning: 'classifier parse failure' };
  }
}

module.exports = { classify };
