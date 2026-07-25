// ============================================================
// Active Conversation Tracker
// After a member tags the bot and gets a response, they can keep
// talking without re-tagging for a short window (an extension of
// Section 20's conversation context). Scoped per (channel, user) —
// deliberately NOT per-channel — so this never pulls unrelated
// members into the pipeline just because someone else recently
// talked to the bot nearby. That would defeat the whole point of
// silence-by-default.
// The window refreshes every time the bot responds to that member
// (not just on the initial tag), so an ongoing back-and-forth
// doesn't expire mid-conversation.
// ============================================================
const { createTTLCache } = require('../utils/ttlCache');
const configManager = require('../config/configManager');

const cache = createTTLCache();

function key(channelId, userId) {
  return `${channelId}:${userId}`;
}

function markActive(channelId, userId) {
  const minutes = configManager.getNumber('active_conversation_minutes') || 7;
  cache.set(key(channelId, userId), true, minutes * 60);
}

function isActive(channelId, userId) {
  return cache.get(key(channelId, userId)) === true;
}

module.exports = { markActive, isActive };
