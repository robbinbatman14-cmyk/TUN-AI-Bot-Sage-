// ============================================================
// /review command (Section 74 - AI Review System, Section 43 -
// Knowledge Diagnostics, Section 100 - Security Auditing)
// ============================================================
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const permissionEngine = require('../permissions/permissionEngine');
const logger = require('../logging/logger');
const securityMonitor = require('../security/securityMonitor');

function requireAdmin(interaction) {
  return permissionEngine.requireAdmin(interaction);
}

const category = 'Review, Diagnostics & Security';

const data = new SlashCommandBuilder()
  .setName('review')
  .setDescription('Review logged UNAI responses and security events')
  .addSubcommand(sc => sc.setName('recent').setDescription('Show recent logged responses'))
  .addSubcommand(sc => sc.setName('inspect').setDescription('Show full detail of one logged response, including what it consulted')
    .addIntegerOption(o => o.setName('log_id').setDescription('Log ID from /review recent').setRequired(true)))
  .addSubcommand(sc => sc.setName('rate').setDescription('Rate a logged response')
    .addIntegerOption(o => o.setName('log_id').setDescription('Log ID from /review recent').setRequired(true))
    .addStringOption(o => o.setName('rating').setDescription('Rating').setRequired(true)
      .addChoices({ name: '✅ Correct', value: 'correct' }, { name: '⚠ Partially Correct', value: 'partial' }, { name: '❌ Incorrect', value: 'incorrect' }))
    .addStringOption(o => o.setName('note').setDescription('Optional note').setRequired(false)))
  .addSubcommand(sc => sc.setName('security').setDescription('Show recent security events (injection attempts, denied permissions, spam)'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

async function execute(interaction) {
  if (!requireAdmin(interaction)) return;
  const sub = interaction.options.getSubcommand();

  if (sub === 'recent') {
    const logs = logger.recentLogs(10);
    if (logs.length === 0) return interaction.reply({ content: '*No logs yet.*', ephemeral: true });
    const text = logs.map(l =>
      `**#${l.id}** <@${l.user_id}> — conf: ${l.confidence ?? 'n/a'}%${l.escalated ? ' 🚩' : ''}\nQ: ${l.message?.slice(0, 100)}\nA: ${(l.response || '*(silent)*').slice(0, 150)}`
    ).join('\n\n');
    return interaction.reply({ content: text.slice(0, 1900), ephemeral: true });
  }

  if (sub === 'inspect') {
    const id = interaction.options.getInteger('log_id');
    const log = logger.getLogById(id);
    if (!log) return interaction.reply({ content: `No log with ID ${id}.`, ephemeral: true });

    let documents = [];
    try { documents = JSON.parse(log.documents_used || '[]'); } catch { /* ignore */ }

    const text = [
      `**Log #${log.id}** — ${log.timestamp}`,
      `**User:** <@${log.user_id}>  **Channel:** <#${log.channel_id}>`,
      `**Confidence:** ${log.confidence ?? 'n/a'}%  **Escalated:** ${log.escalated ? 'yes' : 'no'}  **Response time:** ${log.response_time_ms ?? 'n/a'}ms`,
      `**Documents consulted:** ${documents.length ? documents.join(', ') : '*none*'}`,
      `\n**Question:**\n${log.message}`,
      `\n**Response:**\n${log.response || '*(stayed silent)*'}`
    ].join('\n');
    return interaction.reply({ content: text.slice(0, 1900), ephemeral: true });
  }

  if (sub === 'rate') {
    logger.addReview(
      interaction.options.getInteger('log_id'),
      interaction.options.getString('rating'),
      interaction.user.id,
      interaction.options.getString('note')
    );
    return interaction.reply({ content: `Review recorded for log #${interaction.options.getInteger('log_id')}.`, ephemeral: true });
  }

  if (sub === 'security') {
    const events = securityMonitor.recentSecurityEvents(15);
    if (events.length === 0) return interaction.reply({ content: '*No security events logged.*', ephemeral: true });
    const text = events.map(e =>
      `**#${e.id}** \`${e.type}\` — ${e.timestamp}\n<@${e.user_id}> in <#${e.channel_id}>: ${(e.detail || '').slice(0, 150)}`
    ).join('\n\n');
    return interaction.reply({ content: text.slice(0, 1900), ephemeral: true });
  }
}

module.exports = { data, execute, category };
