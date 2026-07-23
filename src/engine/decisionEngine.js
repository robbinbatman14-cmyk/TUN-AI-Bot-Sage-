// ============================================================
// AI Response Decision Engine (Phase 2 of the spec)
// Implements the pipeline from Section 11:
// ignore checks -> trigger mode -> channel filter -> question
// detection -> topic classification -> retrieval -> confidence
// -> human-override check -> cooldown -> respond.
// Failure at any stage means SILENCE, per Section 3.3.
// ============================================================
const configManager = require('../config/configManager');
const permissionEngine = require('../permissions/permissionEngine');
const cooldown = require('./cooldown');
const classifier = require('./classifier');
const answerEngine = require('./answerEngine');
const logger = require('../logging/logger');
const security = require('../security/securityMonitor');

// Short-lived per-channel memory (Section 20). Expires after 10 minutes.
const CONTEXT_TTL_MS = 10 * 60 * 1000;
const channelContext = new Map(); // channelId -> [{author, content, ts}]

function pushContext(channelId, author, content) {
  const now = Date.now();
  const list = (channelContext.get(channelId) || []).filter(m => now - m.ts < CONTEXT_TTL_MS);
  list.push({ author, content, ts: now });
  channelContext.set(channelId, list.slice(-8)); // keep last 8 messages
}

function getContextText(channelId) {
  const now = Date.now();
  const list = (channelContext.get(channelId) || []).filter(m => now - m.ts < CONTEXT_TTL_MS);
  return list.map(m => `${m.author}: ${m.content}`).join('\n');
}

/**
 * Decide whether and how to respond to a Discord message.
 * @returns {Promise<{action: 'respond'|'silent', reason?: string, payload?: object}>}
 */
async function process(message, { wasMentioned, guildMember }) {
  const startTime = Date.now();

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

  // Stage: security guard (Sections 88-89, 94) — cheap, deterministic,
  // runs before any AI call so an injection attempt never even reaches
  // the model, and a spam burst never costs API quota.
  if (security.looksLikeInjectionAttempt(message.content)) {
    security.logSecurityEvent('prompt_injection', {
      userId: message.author.id,
      channelId: message.channel.id,
      detail: message.content.slice(0, 300)
    });
    if (!wasMentioned) return { action: 'silent', reason: 'security_injection_attempt' };
    // If directly mentioned, respond with a flat, neutral deflection rather
    // than silently ignoring a government member who might legitimately be
    // testing the bot — but never engage the model with it.
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
  if (mode === 'tagged' && !wasMentioned) {
    return { action: 'silent', reason: 'not_mentioned_tagged_mode' };
  }
  if (mode === 'hybrid' && !wasMentioned) {
    // still eligible, smart detection below will decide
  }
  if (mode === 'smart' && wasMentioned) {
    // smart mode still runs full detection even when mentioned;
    // this keeps behavior predictable and spec-consistent.
  }

  // Stage: channel allowed? Direct mentions bypass the channel
  // allowlist so a member can always ask directly, anywhere.
  const channelAllowed = configManager.isChannelAllowed(message.channel.id);
  if (!wasMentioned && !channelAllowed) {
    return { action: 'silent', reason: 'channel_not_allowed' };
  }

  const contextText = getContextText(message.channel.id);

  // Stage: question detection + topic classification (skipped only
  // when directly mentioned AND trigger mode is tagged-only, since
  // a direct mention is unambiguous intent to engage).
  let classification = { is_question: true, on_topic: true, topic: 'direct_mention' };
  if (!(wasMentioned && mode === 'tagged')) {
    classification = await classifier.classify(message.content, contextText);
  }

  if (!classification.is_question) {
    return { action: 'silent', reason: 'not_a_question' };
  }
  if (!classification.on_topic && !wasMentioned) {
    return { action: 'silent', reason: 'off_topic' };
  }

  // Stage: cooldown
  const cooldownCheck = cooldown.canRespond(message.author.id, message.channel.id);
  if (!cooldownCheck.allowed && !wasMentioned) {
    return { action: 'silent', reason: cooldownCheck.reason };
  }

  // Stage: permission level (used for both retrieval scoping and to
  // gate escalation targets later)
  const level = permissionEngine.getMemberLevel(guildMember);

  // Stage: retrieval + grounded generation + confidence
  const result = await answerEngine.answer(message.content, level, contextText);

  const threshold = configManager.getNumber('confidence_threshold');

  if (!result.should_respond || !result.answer) {
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

  if (result.confidence < threshold) {
    // Below threshold: defer to government rather than guess (Section 17).
    const payload = {
      text: `I'm not confident enough in an answer to this (${result.confidence}%, below the ${threshold}% threshold). A government member should weigh in — I've flagged this for them.`,
      escalate: true
    };
    logger.logInteraction({
      userId: message.author.id,
      channelId: message.channel.id,
      message: message.content,
      response: payload.text,
      confidence: result.confidence,
      documentsUsed: result.documentsConsulted,
      escalated: true,
      responseTimeMs: Date.now() - startTime,
      topic: classification.topic
    });
    cooldown.recordResponse(message.author.id, message.channel.id);
    return { action: 'respond', payload };
  }

  // Confident enough to answer normally.
  const citationsMode = configManager.get('citations_mode');
  let text = result.answer;
  if (citationsMode === 'always' && result.sources?.length) {
    text += `\n\n*Source: ${result.sources.join('; ')}*`;
  }
  if (result.confidence < 95) {
    text += `\n\n*(A government member can clarify further if needed.)*`;
  }

  logger.logInteraction({
    userId: message.author.id,
    channelId: message.channel.id,
    message: message.content,
    response: text,
    confidence: result.confidence,
    documentsUsed: result.documentsConsulted,
    escalated: !!result.should_escalate,
    responseTimeMs: Date.now() - startTime,
    topic: classification.topic
  });
  cooldown.recordResponse(message.author.id, message.channel.id);

  return {
    action: 'respond',
    payload: { text, escalate: !!result.should_escalate, sources: result.sources }
  };
}

module.exports = { process, pushContext, getContextText };
