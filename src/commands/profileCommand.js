// ============================================================
// /profile command (Section 79 - Configuration Profiles)
// ============================================================
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const permissionEngine = require('../permissions/permissionEngine');
const profileManager = require('../config/profileManager');

const category = 'Configuration Profiles';

const data = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('Save and load named UNAI configuration snapshots (e.g. war-mode, peace-mode)')
  .addSubcommand(sc => sc.setName('save').setDescription('Save the current configuration under a name')
    .addStringOption(o => o.setName('name').setDescription('Profile name').setRequired(true)))
  .addSubcommand(sc => sc.setName('load').setDescription('Apply a saved configuration profile')
    .addStringOption(o => o.setName('name').setDescription('Profile name').setRequired(true)))
  .addSubcommand(sc => sc.setName('list').setDescription('List saved profiles'))
  .addSubcommand(sc => sc.setName('delete').setDescription('Delete a saved profile')
    .addStringOption(o => o.setName('name').setDescription('Profile name').setRequired(true)))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

async function execute(interaction) {
  if (!permissionEngine.requireAdmin(interaction)) return;
  const sub = interaction.options.getSubcommand();
  const name = interaction.options.getString('name');

  if (sub === 'save') {
    profileManager.saveProfile(name, interaction.user.id);
    return interaction.reply({ content: `Profile **${name}** saved (covers: ${profileManager.PROFILE_KEYS.join(', ')}).`, ephemeral: true });
  }

  if (sub === 'load') {
    const snapshot = profileManager.loadProfile(name);
    if (!snapshot) return interaction.reply({ content: `No profile named **${name}**. Use \`/profile list\` to see saved profiles.`, ephemeral: true });
    return interaction.reply(`Configuration profile **${name}** applied.`);
  }

  if (sub === 'list') {
    const profiles = profileManager.listProfiles();
    if (profiles.length === 0) return interaction.reply({ content: '*No profiles saved yet.*', ephemeral: true });
    const text = profiles.map(p => `**${p.name}** — saved ${p.created_at}`).join('\n');
    return interaction.reply({ content: text, ephemeral: true });
  }

  if (sub === 'delete') {
    profileManager.deleteProfile(name);
    return interaction.reply({ content: `Profile **${name}** deleted.`, ephemeral: true });
  }
}

module.exports = { data, execute, category };
