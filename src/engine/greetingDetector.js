// ============================================================
// Greeting Detector
// Fast, deterministic (zero-API-cost) detection of a pure greeting
// directed at the bot via @mention — "hello", "hi", "good morning",
// etc. with nothing else attached. Deliberately narrow: any message
// that pairs a greeting with actual substance ("hey, what's our tax
// rate?") is NOT treated as a pure greeting and flows through the
// normal pipeline instead, since that's a real question that deserves
// a real answer, not a canned one.
// ============================================================
const GREETING_PATTERNS = [
  /^h(?:ello+|i+|ey+|owdy)$/,
  /^h(?:ello|i|ey|owdy)\s+(?:there|sage)$/,
  /^good\s?(?:morning|afternoon|evening|day)$/,
  /^(?:yo|sup|greetings|hiya|hola|heya)$/,
  /^what'?s\s?up$/
];

function stripMentions(content) {
  return content.replace(/<@!?\d+>/g, ' ').trim();
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[!.,?~]+$/g, '') // trailing punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/** True only for a short, pure greeting with no other substance attached. */
function isPureGreeting(rawContent) {
  const stripped = stripMentions(rawContent);
  if (!stripped || stripped.length > 30) return false; // real questions run longer than a greeting
  const normalized = normalize(stripped);
  return GREETING_PATTERNS.some(p => p.test(normalized));
}

const GREETING_RESPONSES = {
  professional: 'Hello. How can I help you?',
  friendly: 'Hey there! 👋 How can I help you today?',
  mentor: "Hello! I'm happy to help — what would you like to know?"
};

function greetingResponse(personality) {
  return GREETING_RESPONSES[personality] || GREETING_RESPONSES.professional;
}

module.exports = { isPureGreeting, greetingResponse };
