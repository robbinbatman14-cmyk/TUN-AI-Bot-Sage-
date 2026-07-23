// ============================================================
// /pnw command (Live Politics & War API Integration + Discord
// User Lookup + Caching)
// Lookups (nation/alliance) are open to any member — it's public
// game data. Verification linking-for-others, unlinking others,
// listing all links, and cache management are admin-gated.
// ============================================================
const { SlashCommandBuilder } = require('discord.js');
const permissionEngine = require('../permissions/permissionEngine');
const pnwQueries = require('../integrations/pnw/pnwQueries');
const pnwCache = require('../integrations/pnw/pnwCache');
const liveDataFetcher = require('../integrations/liveDataFetcher');
const nationLink = require('../verification/nationLink');

const category = 'Live Politics & War Data';

const data = new SlashCommandBuilder()
  .setName('pnw')
  .setDescription('Live Politics & War data: nation/alliance lookups, Discord verification, cache control')
  .addSubcommandGroup(g => g.setName('nation').setDescription('Nation lookups')
    .addSubcommand(sc => sc.setName('lookup').setDescription('Look up a nation by name, leader name, or ID')
      .addStringOption(o => o.setName('query').setDescription('Nation name, leader name, or nation ID').setRequired(true))))
  .addSubcommandGroup(g => g.setName('alliance').setDescription('Alliance lookups')
    .addSubcommand(sc => sc.setName('lookup').setDescription('Look up an alliance by name or acronym')
      .addStringOption(o => o.setName('query').setDescription('Alliance name or acronym').setRequired(true)))
    .addSubcommand(sc => sc.setName('top').setDescription('Show top alliances by score')
      .addIntegerOption(o => o.setName('limit').setDescription('How many to show (default 10)').setRequired(false))))
  .addSubcommandGroup(g => g.setName('verify').setDescription('Link Discord users to their P&W nation')
    .addSubcommand(sc => sc.setName('link').setDescription('Link YOUR Discord account to your nation (verified via your nation\'s Discord Username field)')
      .addIntegerOption(o => o.setName('nation_id').setDescription('Your nation ID').setRequired(true)))
    .addSubcommand(sc => sc.setName('link-for').setDescription('[Admin] Link another member\'s Discord account to a nation, no verification check')
      .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(true))
      .addIntegerOption(o => o.setName('nation_id').setDescription('Nation ID').setRequired(true)))
    .addSubcommand(sc => sc.setName('whois').setDescription('Look up the link between a Discord user and a nation')
      .addUserOption(o => o.setName('user').setDescription('Discord user').setRequired(false)))
    .addSubcommand(sc => sc.setName('unlink').setDescription('Unlink a Discord account (yourself, or [Admin] someone else)')
      .addUserOption(o => o.setName('user').setDescription('Discord user (admin only, for unlinking someone else)').setRequired(false)))
    .addSubcommand(sc => sc.setName('list').setDescription('[Admin] List all linked accounts')))
  .addSubcommandGroup(g => g.setName('cache').setDescription('Manage the live-data cache')
    .addSubcommand(sc => sc.setName('clear').setDescription('[Admin] Clear the P&W API cache to force fresh data'))
    .addSubcommand(sc => sc.setName('status').setDescription('[Admin] Show cache size')));

async function execute(interaction) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group === 'nation' && sub === 'lookup') {
    await interaction.deferReply();
    const query = interaction.options.getString('query');
    try {
      const nation = /^\d+$/.test(query.trim())
        ? await pnwQueries.getNationById(query.trim())
        : await pnwQueries.getNationByName(query);
      if (!nation) return interaction.editReply(`No nation found matching "${query}".`);
      const text = (await liveDataFetcher.fetchNationSummary(nation.nation_name)) || `No nation found matching "${query}".`;
      return interaction.editReply(text.replace('[Live Politics & War Data — Nation]\n', ''));
    } catch (err) {
      return interaction.editReply(`Lookup failed: ${err.message}`);
    }
  }

  if (group === 'alliance' && sub === 'lookup') {
    await interaction.deferReply();
    const query = interaction.options.getString('query');
    try {
      const text = await liveDataFetcher.fetchAllianceSummary(query);
      return interaction.editReply(text.replace('[Live Politics & War Data — Alliance]\n', ''));
    } catch (err) {
      return interaction.editReply(`Lookup failed: ${err.message}`);
    }
  }

  if (group === 'alliance' && sub === 'top') {
    await interaction.deferReply();
    const limit = interaction.options.getInteger('limit') || 10;
    try {
      const text = await liveDataFetcher.fetchTopAlliancesSummary();
      return interaction.editReply((text || 'Could not retrieve rankings.').replace('[Live Politics & War Data — Top Alliances]\n', ''));
    } catch (err) {
      return interaction.editReply(`Lookup failed: ${err.message}`);
    }
  }

  if (group === 'verify') {
    if (sub === 'link') {
      await interaction.deferReply({ ephemeral: true });
      const nationId = interaction.options.getInteger('nation_id');
      try {
        const nation = await pnwQueries.getNationById(nationId);
        if (!nation) return interaction.editReply(`No nation found with ID ${nationId}.`);

        const inGameDiscord = (nation.discord || '').toLowerCase().trim();
        const requester = interaction.user;
        const candidates = [requester.username, requester.tag].filter(Boolean).map(s => s.toLowerCase());

        if (!inGameDiscord || !candidates.includes(inGameDiscord)) {
          return interaction.editReply(
            `Couldn't verify — the Discord Username field on nation "${nation.nation_name}" ` +
            (inGameDiscord ? `is set to "${nation.discord}", which doesn't match your Discord username.` : 'is not set.') +
            ` Set it on your nation's edit page in-game to match your Discord username exactly, then try again — or ask an admin to use \`/pnw verify link-for\`.`
          );
        }

        nationLink.linkNation({
          discordId: requester.id, nationId: nation.id, nationName: nation.nation_name,
          leaderName: nation.leader_name, linkedBy: requester.id, method: 'self_verified'
        });
        return interaction.editReply(`Linked! Your Discord account is now connected to **${nation.nation_name}** (${nation.leader_name}).`);
      } catch (err) {
        return interaction.editReply(`Verification failed: ${err.message}`);
      }
    }

    if (sub === 'link-for') {
      if (!permissionEngine.requireAdmin(interaction)) return;
      await interaction.deferReply({ ephemeral: true });
      const user = interaction.options.getUser('user');
      const nationId = interaction.options.getInteger('nation_id');
      try {
        const nation = await pnwQueries.getNationById(nationId);
        if (!nation) return interaction.editReply(`No nation found with ID ${nationId}.`);
        nationLink.linkNation({
          discordId: user.id, nationId: nation.id, nationName: nation.nation_name,
          leaderName: nation.leader_name, linkedBy: interaction.user.id, method: 'admin_override'
        });
        return interaction.editReply(`Linked ${user} to **${nation.nation_name}** (${nation.leader_name}).`);
      } catch (err) {
        return interaction.editReply(`Failed to link: ${err.message}`);
      }
    }

    if (sub === 'whois') {
      const user = interaction.options.getUser('user') || interaction.user;
      const link = nationLink.getByDiscordId(user.id);
      if (!link) return interaction.reply({ content: `${user} isn't linked to a nation yet.`, ephemeral: true });
      return interaction.reply({ content: `${user} → **${link.nation_name}** (${link.leader_name}), nation ID ${link.nation_id} — linked via ${link.method === 'self_verified' ? 'self-verification' : 'admin override'}.`, ephemeral: true });
    }

    if (sub === 'unlink') {
      const targetUser = interaction.options.getUser('user');
      if (targetUser && targetUser.id !== interaction.user.id) {
        if (!permissionEngine.requireAdmin(interaction)) return;
        nationLink.unlink(targetUser.id);
        return interaction.reply({ content: `Unlinked ${targetUser}.`, ephemeral: true });
      }
      nationLink.unlink(interaction.user.id);
      return interaction.reply({ content: 'Your Discord account has been unlinked.', ephemeral: true });
    }

    if (sub === 'list') {
      if (!permissionEngine.requireAdmin(interaction)) return;
      const links = nationLink.listAll();
      if (links.length === 0) return interaction.reply({ content: '*No linked accounts yet.*', ephemeral: true });
      const text = links.slice(0, 40).map(l => `<@${l.discord_id}> → ${l.nation_name} (${l.leader_name}) [${l.method}]`).join('\n');
      return interaction.reply({ content: text.slice(0, 1900), ephemeral: true });
    }
  }

  if (group === 'cache') {
    if (!permissionEngine.requireAdmin(interaction)) return;
    if (sub === 'clear') {
      const count = pnwCache.clear();
      return interaction.reply({ content: `Cleared ${count} cached entr${count === 1 ? 'y' : 'ies'}. Next lookups will fetch fresh data.`, ephemeral: true });
    }
    if (sub === 'status') {
      return interaction.reply({ content: `${pnwCache.size()} entries currently cached.`, ephemeral: true });
    }
  }
}

module.exports = { data, execute, category };
