// ============================================================
// AI Response Decision Engine (Phase 2 of the spec)
// Implements the pipeline from Section 11:
// ignore checks -> trigger mode -> channel filter -> question
// detection -> topic classification -> retrieval -> confidence
// -> human-override check -> cooldown -> respond.
// Failure at any stage means SILENCE, per Section 3.3.
//
// Extended with: a zero-cost greeting fast-path, a short "active
// conversation" window so a member doesn't need to re-tag every
// message, and multi-question splitting for numbered/bulleted lists.
// ============================================================
const configManager = require('../config/configManager');
const permissionEngine = require('../permissions/permissionEngine');
const cooldown = require('./cooldown');
const classifier = require('./classifier');
const answerEngine = require('./answerEngine');
const logger = require('../logging/logger');
const security = require('../security/securityMonitor');
const greetingDetector = require('./greetingDetector');
const activeConversation = require('./activeConversation');
const questionSplitter = require('./questionSplitter');

// Short-lived per-channel memory (Section 20). Expires after 10 minutes.
// Includes UNAI's own replies, not just human messages — this is what
// lets a follow-up like "what are HIS responsibilities?" resolve "his"
// against something UNAI itself said two turns ago, not just against
// another member's message.
const CONTEXT_TTL_MS = 10 * 60 * 1000;
const channelContext = new Map(); // channelId -> [{author, content, ts}]

function pushContext(channelId, author, content) {
  const now = Date.now();
  const list = (channelContext.get(channelId) || []).filter(m => now - m.ts < CONTEXT_TTL_MS);
  list.push({ author, content, ts: now });
  channelContext.set(channelId, list.slice(-12)); // keep last 12 turns (was 8 — bot replies now also take slots)
}

function getContextText(channelId) {
  const now = Date.now();
  const list = (channelContext.get(channelId) || []).filter(m => now - m.ts < CONTEXT_TTL_MS);
  return list.map(m => `${m.author}: ${m.content}`).join('\n');
}

/**
 * Turns a raw answerEngine result into final display text, applying the
 * confidence-threshold deferral / citation / disclaimer logic. Shared by
 * both the single-question flow and each item in a multi-question batch,
 * so that logic only lives in one place.
 * @returns {{rendered: boolean, text: string|null, escalate: boolean}}
 *   rendered=false means the model declined outright (Section 3.3) — the
 *   single-question flow turns this into silence; the multi-question flow
 *   shows a brief "couldn't answer this one" line instead, since silently
 *   dropping one item from a numbered batch would be confusing.
 */
function formatAnswerResult(classification, result, threshold) {
  const questionType = classification.question_type || 'alliance_specific';

  if (!result.should_respond || !result.answer) {
    return { rendered: false, text: null, escalate: false };
  }

  if (result.confidence < threshold) {
    // Below threshold: defer rather than guess (Section 17). What "defer"
    // means depends on question type — an alliance-specific gap genuinely
    // needs a government member; a general-knowledge gap is just the model
    // being unsure about game trivia, which pinging government won't fix.
    const isGeneralKnowledge = questionType === 'general_knowledge';
    const text = isGeneralKnowledge
      ? `I'm not fully confident about this one (${result.confidence}%) — worth double-checking against the P&W wiki or another player rather than taking my word for it.`
      : `I'm not confident enough in an answer to this (${result.confidence}%, below the ${threshold}% threshold). A government member should weigh in — I've flagged this for them.`;
    return { rendered: true, text, escalate: !isGeneralKnowledge };
  }

  const citationsMode = configManager.get('citations_mode');
  let text = result.answer;
  if (citationsMode === 'always' && result.sources?.length) {
    text += `\n\n*Source: ${result.sources.join('; ')}*`;
  }
  // Only nudge toward a government member for alliance-specific/mixed
  // answers below full confidence — for a pure general-knowledge or math
  // answer, "a government member can clarify" doesn't mean anything.
  if (result.confidence < 95 && questionType !== 'general_knowledge') {
    text += `\n\n*(A government member can clarify further if needed.)*`;
  }
  return { rendered: true, text, escalate: !!result.should_escalate };
}

/**
 * Answers 2-10 independently-detected questions from one message, each
 * with its own classification, retrieval, and reasoning — not one muddled
 * answer to the whole message. Every item gets logged individually (same
 * as a normal single question) so /review and /ai analytics see them the
 * same way as any other answered question.
 */
async function processMultipleQuestions(message, questions, level, contextText) {
  const threshold = configManager.getNumber('confidence_threshold');
  const parts = [];
  let anyEscalate = false;

  for (const q of questions) {
    const startTime = Date.now();
    let classification = null, result = null, text;

    try {
      classification = await classifier.classify(q, contextText);
      if (!classification.is_question) {
        text = "This doesn't look like something I can help with.";
      } else {
        result = await answerEngine.answer(q, level, contextText, classification);
        const formatted = formatAnswerResult(classification, result, threshold);
        text = formatted.rendered ? formatted.text : "I don't have enough grounded information to answer this one confidently.";
        if (formatted.escalate) anyEscalate = true;
      }
    } catch (err) {
      console.error('[UNAI] Error answering a sub-question:', err.message);
      text = `Ran into an error answering this one: ${err.message}`;
    }

    logger.logInteraction({
      userId: message.author.id,
      channelId: message.channel.id,
      message: q,
      response: text,
      confidence: result?.confidence ?? null,
      documentsUsed: result?.documentsConsulted || [],
      escalated: false,
      responseTimeMs: Date.now() - startTime,
      topic: classification?.topic
    });

    parts.push({ question: q, text });
  }

  const combinedText = parts.map((p, i) => `**${i + 1}. ${p.question}**\n${p.text}`).join('\n\n');
  pushContext(message.channel.id, 'UNAI', combinedText);
  return { action: 'respond', payload: { text: combinedText, escalate: anyEscalate, multi: true } };
}

/**
 * Decide whether and how to respond to a Discord message.
 * @returns {Promise<{action: 'respond'|'silent', reason?: string, payload?: object}>}
 */
async function process(message, { wasMentioned, guildMember }) {
  const startTime = Date.now();

  // Stage: hard channel/category block. Deliberately the FIRST check,
  // before anything else runs — unlike the channel allowlist further
  // down, this is never bypassed by an @mention or an active
  // conversation. It exists specifically so alliance-internal info can
  // never surface in a public-facing channel/category even if a member
  // tags the bot there by mistake. Context isn't even recorded for a
  // blocked channel, since it could never be used for anything.
  if (configManager.isChannelBlocked(message.channel.id, message.channel.parentId)) {
    return { action: 'silent', reason: 'channel_blocked' };
  }

  // Stage: always record context, even for messages we won't answer,
  // so later questions have something to refer back to.
  pushContext(message.channel.id, message.author.username, message.content);

  // Stage: AI enabled?
  if (!configManager.getBool('ai_enabled')) {
    return { action: 'silent', reason: 'ai_disabled' };
  }

  // Stage: emergency lockdown (Section 99) — a stricter, more visible
  // shutdown than ai_enabled=false, intended for active-incident use;
  // see /ai lockdown.
  if (configManager.getBool('lockdown_enabled')) {
    return { action: 'silent', reason: 'lockdown_active' };
  }

  // A member who tagged the bot recently (or just did) is treated as
  // "effectively mentioned" for gating purposes — this is what lets a
  // follow-up work without re-tagging. Deliberately per (channel, user),
  // never per-channel, so this can't pull an unrelated member into the
  // pipeline just because someone else nearby was talking to the bot.
  const effectivelyMentioned = wasMentioned || activeConversation.isActive(message.channel.id, message.author.id);

  // Stage: security guard (Sections 88-89, 94) — cheap, deterministic,
  // runs before any AI call so an injection attempt never even reaches
  // the model, and a spam burst never costs API quota.
  if (security.looksLikeInjectionAttempt(message.content)) {
    security.logSecurityEvent('prompt_injection', {
      userId: message.author.id,
      channelId: message.channel.id,
      detail: message.content.slice(0, 300)
    });
    if (!effectivelyMentioned) return { action: 'silent', reason: 'security_injection_attempt' };
    return {
      action: 'respond',
      payload: { text: "I can't override my configuration or instructions this way. Happy to help with a real Politics & War or Union of Nations question." }
    };
  }
  if (security.isAbusiveRepeat(message.author.id, message.content)) {
    security.logSecurityEvent('repeated_question', {
      userId: message.author.id,
      channelId: message.channel.id,
      detail: message.content.slice(0, 300)
    });
    return { action: 'silent', reason: 'security_repeated_question' };
  }

  // Stage: trigger mode
  const mode = configManager.get('trigger_mode');
  if (mode === 'tagged' && !effectivelyMentioned) {
    return { action: 'silent', reason: 'not_mentioned_tagged_mode' };
  }

  // Stage: channel allowed? Direct mentions (and active-conversation
  // follow-ups) bypass the channel allowlist so a member can always ask
  // directly, anywhere, and continue that same conversation anywhere.
  const channelAllowed = configManager.isChannelAllowed(message.channel.id);
  if (!effectivelyMentioned && !channelAllowed) {
    return { action: 'silent', reason: 'channel_not_allowed' };
  }

  // Stage: cooldown (moved ahead of classification so a cooldown-blocked
  // message never spends an API call getting classified first)
  const cooldownCheck = cooldown.canRespond(message.author.id, message.channel.id);
  if (!cooldownCheck.allowed && !effectivelyMentioned) {
    return { action: 'silent', reason: cooldownCheck.reason };
  }

  // Stage: greeting fast-path. Only for an ACTUAL fresh @mention (not
  // merely an active-conversation carry-over) — "@SAGE hello" gets a
  // free, instant, zero-API-cost reply. This also starts (or refreshes)
  // the active-conversation window, which is what lets the very next
  // message in the example work without re-tagging.
  if (wasMentioned && greetingDetector.isPureGreeting(message.content)) {
    const text = greetingDetector.greetingResponse(configManager.get('personality'));
    cooldown.recordResponse(message.author.id, message.channel.id);
    activeConversation.markActive(message.channel.id, message.author.id);
    pushContext(message.channel.id, 'UNAI', text);
    return { action: 'respond', payload: { text, escalate: false } };
  }

  const contextText = getContextText(message.channel.id);
  const level = permissionEngine.getMemberLevel(guildMember);

  // Stage: multi-question detection. Only engages when the bot was
  // actually addressed (mentioned or mid active-conversation) — an
  // unaddressed multi-line message in a passively-monitored channel still
  // goes through the normal single-classification on/off-topic gate below,
  // rather than risking the bot bulk-answering an unrelated numbered list.
  if (effectivelyMentioned) {
    const detected = questionSplitter.detectQuestions(message.content);
    if (detected.length > questionSplitter.MAX_QUESTIONS) {
      cooldown.recordResponse(message.author.id, message.channel.id);
      return {
        action: 'respond',
        payload: { text: `That's ${detected.length} questions at once — I can handle up to ${questionSplitter.MAX_QUESTIONS} in one message. Could you split it into a couple of smaller batches?` }
      };
    }
    if (detected.length >= questionSplitter.MIN_QUESTIONS) {
      cooldown.recordResponse(message.author.id, message.channel.id);
      const multiResult = await processMultipleQuestions(message, detected, level, contextText);
      activeConversation.markActive(message.channel.id, message.author.id);
      return multiResult;
    }
  }

  // Stage: question detection + topic classification (skipped only
  // when directly mentioned AND trigger mode is tagged-only, since
  // a direct mention is unambiguous intent to engage).
  let classification = { is_question: true, on_topic: true, topic: 'direct_mention', question_type: 'mixed', live_data: { needed: false, type: null, entity_name: null } };
  if (!(wasMentioned && mode === 'tagged')) {
    classification = await classifier.classify(message.content, contextText);
  }

  if (!classification.is_question) {
    return { action: 'silent', reason: 'not_a_question' };
  }
  if (!classification.on_topic && !wasMentioned) {
    return { action: 'silent', reason: 'off_topic' };
  }

  // Stage: retrieval + grounded generation + confidence
  const result = await answerEngine.answer(message.content, level, contextText, classification);
  const threshold = configManager.getNumber('confidence_threshold');
  const formatted = formatAnswerResult(classification, result, threshold);

  if (!formatted.rendered) {
    logger.logInteraction({
      userId: message.author.id,
      channelId: message.channel.id,
      message: message.content,
      response: null,
      confidence: result.confidence,
      documentsUsed: result.documentsConsulted,
      escalated: false,
      responseTimeMs: Date.now() - startTime,
      topic: classification.topic
    });
    return { action: 'silent', reason: 'model_declined' };
  }

  logger.logInteraction({
    userId: message.author.id,
    channelId: message.channel.id,
    message: message.content,
    response: formatted.text,
    confidence: result.confidence,
    documentsUsed: result.documentsConsulted,
    escalated: formatted.escalate,
    responseTimeMs: Date.now() - startTime,
    topic: classification.topic
  });
  cooldown.recordResponse(message.author.id, message.channel.id);
  pushContext(message.channel.id, 'UNAI', formatted.text);
  activeConversation.markActive(message.channel.id, message.author.id);

  return {
    action: 'respond',
    payload: { text: formatted.text, escalate: formatted.escalate, sources: result.sources }
  };
}

module.exports = { process, pushContext, getContextText };
