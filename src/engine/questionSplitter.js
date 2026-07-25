// ============================================================
// Question Splitter
// Deterministic (zero-API-cost) detection of a message that
// contains multiple distinct questions — a numbered or bulleted
// list, or several standalone question-lines — so each can be
// answered independently instead of the whole message being
// treated as one large, muddled query.
//
// Deliberately conservative: only splits when the structure is
// unambiguous (real list markers, or a message that's ENTIRELY
// question-lines). A single sentence with multiple questions
// mashed together ("what's our tax rate and why was it raised?")
// is NOT split — reliably splitting that needs real language
// understanding, which is a larger, costed addition left for later
// if it turns out to matter in practice. Getting this heuristic
// wrong in the other direction (accidentally splitting a normal
// question because it happens to contain a stray "?") would be
// worse than not splitting a genuinely compound one.
// ============================================================
const MIN_QUESTIONS = 2;
const MAX_QUESTIONS = 10;

// "1. ...", "1) ...", "- ...", "* ...", "• ..."
const LIST_ITEM_PATTERN = /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/;

function stripMentions(content) {
  return content.replace(/<@!?\d+>/g, ' ').trim();
}

function splitByListMarkers(content) {
  const lines = stripMentions(content).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = [];
  for (const line of lines) {
    const match = line.match(LIST_ITEM_PATTERN);
    if (match) items.push(match[1].trim());
  }
  return items;
}

/**
 * Fallback for a message with no list markers but multiple lines that are
 * ALL standalone questions (every non-empty line ends in "?"). Requires
 * every line to qualify, not just some, to avoid misfiring on a message
 * that's mostly prose with one incidental question mark on its own line.
 */
function splitByQuestionLines(content) {
  const lines = stripMentions(content).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < MIN_QUESTIONS) return [];
  const allQuestions = lines.every(l => l.endsWith('?') && l.length > 5);
  return allQuestions ? lines : [];
}

/**
 * @param {string} content - raw message content (mentions not stripped; callers pass the full message)
 * @returns {string[]} 0, or 2+ (up to a generous cap for the "too many" check), detected questions
 */
function detectQuestions(content) {
  let items = splitByListMarkers(content);
  if (items.length < MIN_QUESTIONS) {
    items = splitByQuestionLines(content);
  }
  return items;
}

module.exports = { detectQuestions, MIN_QUESTIONS, MAX_QUESTIONS };
