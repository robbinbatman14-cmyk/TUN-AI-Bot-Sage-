// ============================================================
// /backup command (Section 78 - Backup & Restore)
// ============================================================
const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const permissionEngine = require('../permissions/permissionEngine');
const backupManager = require('../config/backupManager');

const category = 'Backup & Restore';

const data = new SlashCommandBuilder()
  .setName('backup')
  .setDescription('Export or restore UNAI configuration and knowledge')
  .addSubcommand(sc => sc.setName('export').setDescription('Download a full backup as a JSON file'))
  .addSubcommand(sc => sc.setName('import').setDescription('Restore from a previously exported backup file')
    .addAttachmentOption(o => o.setName('file').setDescription('A UNAI backup .json file').setRequired(true)))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

async function execute(interaction) {
  if (!permissionEngine.requireAdmin(interaction)) return;
  const sub = interaction.options.getSubcommand();

  if (sub === 'export') {
    await interaction.deferReply({ ephemeral: true });
    const backup = backupManager.exportBackup();
    const json = JSON.stringify(backup, null, 2);
    const buffer = Buffer.from(json, 'utf-8');
    const attachment = new AttachmentBuilder(buffer, { name: `unai-backup-${Date.now()}.json` });
    return interaction.editReply({
      content: `Backup exported: ${backup.documents.length} document(s), ${backup.faq.length} FAQ entr${backup.faq.length === 1 ? 'y' : 'ies'}, full configuration. Store this somewhere safe — it contains your full knowledge base content.`,
      files: [attachment]
    });
  }

  if (sub === 'import') {
    await interaction.deferReply({ ephemeral: true });
    const attachment = interaction.options.getAttachment('file');
    if (!attachment.name.endsWith('.json')) {
      return interaction.editReply('Please attach a `.json` backup file exported with `/backup export`.');
    }

    let backup;
    try {
      const res = await fetch(attachment.url);
      backup = JSON.parse(await res.text());
    } catch (err) {
      return interaction.editReply(`Couldn't read that file: ${err.message}`);
    }

    try {
      const result = await backupManager.importBackup(backup);
      return interaction.editReply(
        `Restore complete: ${result.documentsRestored} document(s) restored, ${result.reindexed} re-indexed and searchable` +
        (result.reindexFailures ? `, ${result.reindexFailures} failed to re-index (check \`/knowledge list\` and re-run \`/knowledge reindex\` on those).` : '.')
      );
    } catch (err) {
      return interaction.editReply(`Import failed: ${err.message}`);
    }
  }
}

module.exports = { data, execute, category };
