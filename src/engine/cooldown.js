// ============================================================
// Cooldown System (Section 19, 93)
// Purely in-memory — resets on restart, which is fine since
// cooldowns are a short-term anti-spam measure, not durable state.
// ============================================================
const configManager = require('../config/configManager');

const lastReplyByUser = new Map();       // userId -> timestamp
const channelReplyTimestamps = new Map(); // channelId -> [timestamps]

function canRespond(userId, channelId) {
  const now = Date.now();

  const perUserSeconds = configManager.getNumber('cooldown_per_user_seconds');
  const lastUser = lastReplyByUser.get(userId) || 0;
  if (now - lastUser < perUserSeconds * 1000) {
    return { allowed: false, reason: 'user_cooldown' };
  }

  const perChannelPerMinute = configManager.getNumber('cooldown_per_channel_per_minute');
  const timestamps = (channelReplyTimestamps.get(channelId) || []).filter(t => now - t < 60000);
  if (timestamps.length >= perChannelPerMinute) {
    return { allowed: false, reason: 'channel_cooldown' };
  }

  return { allowed: true };
}

function recordResponse(userId, channelId) {
  const now = Date.now();
  lastReplyByUser.set(userId, now);
  const timestamps = (channelReplyTimestamps.get(channelId) || []).filter(t => now - t < 60000);
  timestamps.push(now);
  channelReplyTimestamps.set(channelId, timestamps);
}

module.exports = { canRespond, recordResponse };
