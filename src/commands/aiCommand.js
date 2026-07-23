// ============================================================
// /ai command group - core configuration (Phase 5 of the spec)
// ============================================================
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const configManager = require('../config/configManager');
const permissionEngine = require('../permissions/permissionEngine');
const logger = require('../logging/logger');
const usageTracker = require('../logging/usageTracker');
const ai = require('../ai/providerManager');

function requireAdmin(interaction) {
  return permissionEngine.requireAdmin(interaction);
}

const category = 'Configuration & Administration';

const data = new SlashCommandBuilder()
  .setName('ai')
  .setDescription('Configure the Union of Nations AI Assistant')
  .addSubcommand(sc => sc.setName('enable').setDescription('Turn UNAI on'))
  .addSubcommand(sc => sc.setName('disable').setDescription('Turn UNAI off (emergency shutdown)'))
  .addSubcommand(sc => sc.setName('status').setDescription('Show current UNAI configuration'))
  .addSubcommand(sc => sc.setName('mode')
    .setDescription('Set the response trigger mode')
    .addStringOption(o => o.setName('value').setDescription('Trigger mode').setRequired(true)
      .addChoices({ name: 'Tagged Only', value: 'tagged' }, { name: 'Smart Detection', value: 'smart' }, { name: 'Hybrid (recommended)', value: 'hybrid' })))
  .addSubcommand(sc => sc.setName('confidence')
    .setDescription('Set the minimum confidence % required to auto-respond')
    .addIntegerOption(o => o.setName('value').setDescription('0-100').setRequired(true).setMinValue(0).setMaxValue(100)))
  .addSubcommand(sc => sc.setName('personality')
    .setDescription('Set the AI response personality')
    .addStringOption(o => o.setName('value').setDescription('Personality').setRequired(true)
      .addChoices({ name: 'Professional', value: 'professional' }, { name: 'Friendly', value: 'friendly' }, { name: 'Mentor', value: 'mentor' })))
  .addSubcommand(sc => sc.setName('official-only')
    .setDescription('Toggle Official Answers Only mode')
    .addBooleanOption(o => o.setName('value').setDescription('Enabled?').setRequired(true)))
  .addSubcommand(sc => sc.setName('provider')
    .setDescription('Switch the AI provider')
    .addStringOption(o => o.setName('value').setDescription('Provider').setRequired(true)
      .addChoices({ name: 'Google Gemini (default)', value: 'gemini' }, { name: 'OpenAI', value: 'openai' }, { name: 'Anthropic', value: 'anthropic' })))
  .addSubcommand(sc => sc.setName('escalation-channel')
    .setDescription('Set the channel where low-confidence questions get flagged')
    .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
  .addSubcommandGroup(g => g.setName('channels').setDescription('Manage monitored channels')
    .addSubcommand(sc => sc.setName('add').setDescription('Allow UNAI to respond in a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(sc => sc.setName('remove').setDescription('Stop UNAI from responding in a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(sc => sc.setName('list').setDescription('List monitored channels')))
  .addSubcommandGroup(g => g.setName('topics').setDescription('Manage approved discussion topics')
    .addSubcommand(sc => sc.setName('enable').setDescription('Enable a topic')
      .addStringOption(o => o.setName('name').setDescription('Topic name').setRequired(true)))
    .addSubcommand(sc => sc.setName('disable').setDescription('Disable a topic')
      .addStringOption(o => o.setName('name').setDescription('Topic name').setRequired(true)))
    .addSubcommand(sc => sc.setName('list').setDescription('List all topics and their status')))
  .addSubcommandGroup(g => g.setName('permissions').setDescription('Map Discord roles to UNAI permission levels')
    .addSubcommand(sc => sc.setName('set').setDescription('Map a role to a permission level')
      .addRoleOption(o => o.setName('role').setDescription('Discord role').setRequired(true))
      .addStringOption(o => o.setName('level').setDescription('Permission level').setRequired(true)
        .addChoices(
          { name: 'Member', value: 'member' }, { name: 'Ministry', value: 'ministry' },
          { name: 'Government', value: 'government' }, { name: 'High Government', value: 'high_government' },
          { name: 'Secretary General', value: 'secgen' }, { name: 'Owner', value: 'owner' }
        )))
    .addSubcommand(sc => sc.setName('remove').setDescription('Unmap a role')
      .addRoleOption(o => o.setName('role').setDescription('Discord role').setRequired(true)))
    .addSubcommand(sc => sc.setName('list').setDescription('List role-to-permission mappings')))
  .addSubcommand(sc => sc.setName('analytics').setDescription('Show operational statistics'))
  .addSubcommand(sc => sc.setName('diagnose').setDescription('Show system diagnostics'))
  .addSubcommand(sc => sc.setName('costs').setDescription('Show estimated API usage and cost over a recent period')
    .addIntegerOption(o => o.setName('hours').setDescription('Look-back window in hours (default 24)').setRequired(false)))
  .addSubcommand(sc => sc.setName('lockdown')
    .setDescription('Emergency lockdown: stop all automatic responses immediately, more visible than /ai disable')
    .addBooleanOption(o => o.setName('value').setDescription('Enable lockdown?').setRequired(true)))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

async function execute(interaction) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (!requireAdmin(interaction)) return;

  if (group === 'channels') {
    if (sub === 'add') {
      const channel = interaction.options.getChannel('channel');
      configManager.addChannel(channel.id, interaction.guildId);
      return interaction.reply({ content: `UNAI will now monitor ${channel}.`, ephemeral: true });
    }
    if (sub === 'remove') {
      const channel = interaction.options.getChannel('channel');
      configManager.removeChannel(channel.id);
      return interaction.reply({ content: `UNAI will no longer monitor ${channel}.`, ephemeral: true });
    }
    if (sub === 'list') {
      const ids = configManager.listChannels();
      const text = ids.length ? ids.map(id => `<#${id}>`).join(', ') : '*No channels configured yet.*';
      return interaction.reply({ content: `**Monitored channels:** ${text}`, ephemeral: true });
    }
  }

  if (group === 'topics') {
    if (sub === 'enable' || sub === 'disable') {
      const name = interaction.options.getString('name').toLowerCase().replace(/\s+/g, '_');
      configManager.setTopicEnabled(name, sub === 'enable');
      return interaction.reply({ content: `Topic \`${name}\` ${sub === 'enable' ? 'enabled' : 'disabled'}.`, ephemeral: true });
    }
    if (sub === 'list') {
      const topics = configManager.listTopics();
      const text = topics.map(t => `${t.enabled ? '✅' : '❌'} ${t.name}`).join('\n') || '*None configured.*';
      return interaction.reply({ content: `**Topics:**\n${text}`, ephemeral: true });
    }
  }

  if (group === 'permissions') {
    if (sub === 'set') {
      const role = interaction.options.getRole('role');
      const level = interaction.options.getString('level');
      permissionEngine.setRoleLevel(role.id, level);
      return interaction.reply({ content: `${role} mapped to permission level **${level}**.`, ephemeral: true });
    }
    if (sub === 'remove') {
      const role = interaction.options.getRole('role');
      permissionEngine.removeRoleLevel(role.id);
      return interaction.reply({ content: `${role} unmapped.`, ephemeral: true });
    }
    if (sub === 'list') {
      const rows = permissionEngine.listRoleLevels();
      const text = rows.map(r => `<@&${r.role_id}> → **${r.level}**`).join('\n') || '*No roles mapped. Discord Administrators are treated as Owner by default.*';
      return interaction.reply({ content: `**Permission mappings:**\n${text}`, ephemeral: true });
    }
  }

  switch (sub) {
    case 'enable':
      configManager.set('ai_enabled', 'true');
      return interaction.reply('✅ UNAI is now **enabled**.');
    case 'disable':
      configManager.set('ai_enabled', 'false');
      return interaction.reply('🛑 UNAI is now **disabled**. Automatic responses have stopped.');
    case 'status': {
      const c = [
        `**Enabled:** ${configManager.getBool('ai_enabled')}`,
        `**Lockdown:** ${configManager.getBool('lockdown_enabled') ? '🔒 ACTIVE' : 'inactive'}`,
        `**Mode:** ${configManager.get('trigger_mode')}`,
        `**Confidence threshold:** ${configManager.get('confidence_threshold')}%`,
        `**Personality:** ${configManager.get('personality')}`,
        `**Official Answers Only:** ${configManager.getBool('official_answers_only')}`,
        `**AI Provider:** ${ai.currentProviderName()}`,
        `**Monitored channels:** ${configManager.listChannels().length}`
      ].join('\n');
      return interaction.reply({ content: c, ephemeral: true });
    }
    case 'mode':
      configManager.set('trigger_mode', interaction.options.getString('value'));
      return interaction.reply(`Trigger mode set to **${interaction.options.getString('value')}**.`);
    case 'confidence':
      configManager.set('confidence_threshold', interaction.options.getInteger('value'));
      return interaction.reply(`Minimum confidence set to **${interaction.options.getInteger('value')}%**.`);
    case 'personality':
      configManager.set('personality', interaction.options.getString('value'));
      return interaction.reply(`Personality set to **${interaction.options.getString('value')}**.`);
    case 'official-only':
      configManager.set('official_answers_only', interaction.options.getBoolean('value'));
      return interaction.reply(`Official Answers Only mode: **${interaction.options.getBoolean('value')}**.`);
    case 'provider':
      configManager.set('ai_provider', interaction.options.getString('value'));
      return interaction.reply(`AI provider switched to **${interaction.options.getString('value')}**.`);
    case 'escalation-channel':
      configManager.set('escalation_channel_id', interaction.options.getChannel('channel').id);
      return interaction.reply(`Escalation channel set to ${interaction.options.getChannel('channel')}.`);
    case 'analytics': {
      const stats = logger.analytics();
      const lines = [
        `**Total responses logged:** ${stats.totalResponses} (${stats.answered} answered, ${stats.silent} stayed silent)`,
        `**Escalations:** ${stats.escalations}`,
        `**Average confidence:** ${stats.avgConfidence ?? 'n/a'}%`,
        `**Average response time:** ${stats.avgResponseTimeMs ?? 'n/a'} ms`
      ];
      if (stats.topTopics.length) {
        lines.push(`**Most common topics:** ${stats.topTopics.map(t => `${t.topic} (${t.c})`).join(', ')}`);
      }
      if (stats.topDocuments.length) {
        lines.push(`**Most referenced documents:** ${stats.topDocuments.map(d => `${d.title} (${d.count})`).join(', ')}`);
      }
      return interaction.reply({ content: lines.join('\n'), ephemeral: true });
    }
    case 'diagnose': {
      const text = [
        `**AI Provider:** ${ai.currentProviderName()}`,
        `**Node version:** ${process.version}`,
        `**Uptime:** ${Math.floor(process.uptime())}s`,
        `**Memory (RSS):** ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`
      ].join('\n');
      return interaction.reply({ content: text, ephemeral: true });
    }
    case 'costs': {
      const hours = interaction.options.getInteger('hours') || 24;
      const usage = usageTracker.usageSummary({ sinceHours: hours });
      const lines = [`**API usage over the last ${hours}h:**`, `**Total calls:** ${usage.totalCalls}`];
      for (const [provider, data] of Object.entries(usage.byProvider)) {
        lines.push(`— ${provider}: ${data.calls} calls, ${data.promptTokens.toLocaleString()} prompt + ${data.outputTokens.toLocaleString()} output tokens`);
      }
      lines.push(`**Estimated cost:** ~$${usage.estimatedCostUSD.toFixed(4)} USD`);
      lines.push(`*Estimate only, based on rough published rates — free-tier Gemini use is actually $0 unless billing is enabled. Check your provider's dashboard for exact billing.*`);
      return interaction.reply({ content: lines.join('\n'), ephemeral: true });
    }
    case 'lockdown': {
      const enable = interaction.options.getBoolean('value');
      configManager.set('lockdown_enabled', enable);
      if (enable) {
        return interaction.reply('🔒 **Emergency lockdown ACTIVE.** All automatic responses have stopped immediately. Knowledge base changes are still possible for admins, but the AI will not respond to anyone until lockdown is disabled with `/ai lockdown value:false`.');
      }
      return interaction.reply('🔓 Lockdown lifted. UNAI will resume responding according to its normal configuration (still subject to `/ai enable`/`/ai disable`).');
    }
  }
}

module.exports = { data, execute, category };
