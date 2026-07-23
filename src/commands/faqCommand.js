// ============================================================
// /faq command group (Section 41)
// ============================================================
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const permissionEngine = require('../permissions/permissionEngine');
const faqManager = require('../knowledge/faqManager');

function requireAdmin(interaction) {
  return permissionEngine.requireAdmin(interaction);
}

const category = 'FAQ';

const data = new SlashCommandBuilder()
  .setName('faq')
  .setDescription('Manage UNAI frequently asked questions')
  .addSubcommand(sc => sc.setName('add').setDescription('Add an FAQ entry')
    .addStringOption(o => o.setName('question').setDescription('Question').setRequired(true))
    .addStringOption(o => o.setName('answer').setDescription('Answer').setRequired(true))
    .addStringOption(o => o.setName('category').setDescription('Category').setRequired(false))
    .addStringOption(o => o.setName('keywords').setDescription('Comma-separated keywords').setRequired(false)))
  .addSubcommand(sc => sc.setName('list').setDescription('List FAQ entries'))
  .addSubcommand(sc => sc.setName('delete').setDescription('Delete an FAQ entry')
    .addIntegerOption(o => o.setName('id').setDescription('FAQ ID').setRequired(true)))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

async function execute(interaction) {
  if (!requireAdmin(interaction)) return;
  const sub = interaction.options.getSubcommand();

  if (sub === 'add') {
    const id = faqManager.addFaq({
      question: interaction.options.getString('question'),
      answer: interaction.options.getString('answer'),
      category: interaction.options.getString('category') || 'general',
      keywords: interaction.options.getString('keywords') || '',
      approvedBy: interaction.user.id
    });
    return interaction.reply({ content: `FAQ entry added (ID ${id}).`, ephemeral: true });
  }

  if (sub === 'list') {
    const items = faqManager.listFaq();
    if (items.length === 0) return interaction.reply({ content: '*No FAQ entries yet.*', ephemeral: true });
    const text = items.slice(0, 25).map(f => `**#${f.id}** ${f.question}`).join('\n');
    return interaction.reply({ content: text, ephemeral: true });
  }

  if (sub === 'delete') {
    faqManager.deleteFaq(interaction.options.getInteger('id'));
    return interaction.reply({ content: `FAQ entry ${interaction.options.getInteger('id')} deleted.`, ephemeral: true });
  }
}

module.exports = { data, execute, category };
