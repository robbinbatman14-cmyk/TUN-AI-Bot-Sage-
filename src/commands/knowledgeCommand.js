// ============================================================
// /knowledge command group (Sections 38, 71: document workflow)
// ============================================================
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const permissionEngine = require('../permissions/permissionEngine');
const documentManager = require('../knowledge/documentManager');
const textExtractor = require('../knowledge/textExtractor');
const imageAnalyzer = require('../knowledge/imageAnalyzer');
const configManager = require('../config/configManager');

const MUTATING_SUBCOMMANDS = ['upload', 'approve', 'reject', 'archive', 'delete', 'reindex', 'update'];

function requireAdmin(interaction) {
  return permissionEngine.requireAdmin(interaction);
}

const category = 'Knowledge Base';

const data = new SlashCommandBuilder()
  .setName('knowledge')
  .setDescription('Manage the UNAI knowledge base')
  .addSubcommand(sc => sc.setName('upload')
    .setDescription('Upload a document (.txt, .md, .pdf, or .docx) to the pending queue')
    .addAttachmentOption(o => o.setName('file').setDescription('Text, Markdown, PDF, or Word file').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Document title').setRequired(true))
    .addStringOption(o => o.setName('category').setDescription('Category, e.g. constitution, military, economy').setRequired(true))
    .addStringOption(o => o.setName('visibility').setDescription('Who can see this').setRequired(false)
      .addChoices(
        { name: 'Public', value: 'public' }, { name: 'Members Only (default)', value: 'members_only' },
        { name: 'Government', value: 'government' }, { name: 'Ministry', value: 'ministry' }, { name: 'Owner', value: 'owner' }
      )))
  .addSubcommand(sc => sc.setName('approve').setDescription('Approve a pending document, indexing it for search')
    .addIntegerOption(o => o.setName('id').setDescription('Document ID').setRequired(true)))
  .addSubcommand(sc => sc.setName('reject').setDescription('Reject a pending document')
    .addIntegerOption(o => o.setName('id').setDescription('Document ID').setRequired(true)))
  .addSubcommand(sc => sc.setName('archive').setDescription('Archive an approved document (removes it from search)')
    .addIntegerOption(o => o.setName('id').setDescription('Document ID').setRequired(true)))
  .addSubcommand(sc => sc.setName('delete').setDescription('Permanently delete a document')
    .addIntegerOption(o => o.setName('id').setDescription('Document ID').setRequired(true)))
  .addSubcommand(sc => sc.setName('reindex').setDescription('Re-index an approved document (after editing)')
    .addIntegerOption(o => o.setName('id').setDescription('Document ID').setRequired(true)))
  .addSubcommand(sc => sc.setName('update')
    .setDescription('Replace a document\'s content with a new file, keeping version history (Section 37)')
    .addIntegerOption(o => o.setName('id').setDescription('Document ID').setRequired(true))
    .addAttachmentOption(o => o.setName('file').setDescription('Replacement file (.txt, .md, .pdf, or .docx)').setRequired(true)))
  .addSubcommand(sc => sc.setName('versions').setDescription('Show version history for a document')
    .addIntegerOption(o => o.setName('id').setDescription('Document ID').setRequired(true)))
  .addSubcommand(sc => sc.setName('list').setDescription('List documents')
    .addStringOption(o => o.setName('status').setDescription('Filter by status').setRequired(false)
      .addChoices(
        { name: 'Pending', value: 'pending' }, { name: 'Approved', value: 'approved' },
        { name: 'Rejected', value: 'rejected' }, { name: 'Archived', value: 'archived' }
      )))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

async function execute(interaction) {
  if (!requireAdmin(interaction)) return;
  const sub = interaction.options.getSubcommand();

  if (MUTATING_SUBCOMMANDS.includes(sub) && configManager.getBool('lockdown_enabled')) {
    return interaction.reply({
      content: '🔒 UNAI is in emergency lockdown (`/ai lockdown`) — knowledge base changes are paused until it\'s lifted.',
      ephemeral: true
    });
  }

  if (sub === 'upload') {
    await interaction.deferReply({ ephemeral: true });
    const attachment = interaction.options.getAttachment('file');
    const title = interaction.options.getString('title');
    const category = interaction.options.getString('category').toLowerCase();
    const visibility = interaction.options.getString('visibility') || 'members_only';

    if (!textExtractor.isSupported(attachment.name)) {
      return interaction.editReply(`Unsupported file type. Supported: ${textExtractor.SUPPORTED_EXTENSIONS.join(', ')}`);
    }

    let text, images;
    try {
      ({ text, images } = await textExtractor.extractContent(attachment));
    } catch (err) {
      return interaction.editReply(`Couldn't read that file: ${err.message}`);
    }

    let content = text;
    if (images.length > 0) {
      await interaction.editReply(`Extracting text done. Analyzing ${images.length} embedded image(s) — this can take a moment...`);
      const imageBlocks = await imageAnalyzer.describeImages(images);
      content = imageAnalyzer.appendImageDescriptions(text, imageBlocks);
    }

    const id = documentManager.addDocument({
      title, category, visibility, content, filename: attachment.name, uploadedBy: interaction.user.id
    });
    const imageNote = images.length > 0 ? `, ${images.length} image(s) analyzed` : '';
    return interaction.editReply(`Document uploaded as **pending** (ID ${id}, ${content.length.toLocaleString()} characters extracted${imageNote}). Run \`/knowledge approve id:${id}\` to index it.`);
  }

  if (sub === 'approve') {
    await interaction.deferReply({ ephemeral: true });
    const id = interaction.options.getInteger('id');
    try {
      const chunkCount = await documentManager.approveDocument(id);
      return interaction.editReply(`Document ${id} approved and indexed (${chunkCount} chunks).`);
    } catch (err) {
      return interaction.editReply(`Failed to approve document: ${err.message}`);
    }
  }

  if (sub === 'reject') {
    documentManager.rejectDocument(interaction.options.getInteger('id'));
    return interaction.reply({ content: `Document ${interaction.options.getInteger('id')} rejected.`, ephemeral: true });
  }

  if (sub === 'archive') {
    documentManager.archiveDocument(interaction.options.getInteger('id'));
    return interaction.reply({ content: `Document ${interaction.options.getInteger('id')} archived and removed from search.`, ephemeral: true });
  }

  if (sub === 'delete') {
    documentManager.deleteDocument(interaction.options.getInteger('id'));
    return interaction.reply({ content: `Document ${interaction.options.getInteger('id')} permanently deleted.`, ephemeral: true });
  }

  if (sub === 'reindex') {
    await interaction.deferReply({ ephemeral: true });
    const id = interaction.options.getInteger('id');
    try {
      const chunkCount = await documentManager.reindexDocument(id);
      return interaction.editReply(`Document ${id} re-indexed (${chunkCount} chunks).`);
    } catch (err) {
      return interaction.editReply(`Failed to re-index document ${id}: ${err.message}`);
    }
  }

  if (sub === 'update') {
    await interaction.deferReply({ ephemeral: true });
    const id = interaction.options.getInteger('id');
    const attachment = interaction.options.getAttachment('file');

    if (!textExtractor.isSupported(attachment.name)) {
      return interaction.editReply(`Unsupported file type. Supported: ${textExtractor.SUPPORTED_EXTENSIONS.join(', ')}`);
    }
    let text, images;
    try {
      ({ text, images } = await textExtractor.extractContent(attachment));
    } catch (err) {
      return interaction.editReply(`Couldn't read that file: ${err.message}`);
    }

    let content = text;
    if (images.length > 0) {
      await interaction.editReply(`Extracting text done. Analyzing ${images.length} embedded image(s) — this can take a moment...`);
      const imageBlocks = await imageAnalyzer.describeImages(images);
      content = imageAnalyzer.appendImageDescriptions(text, imageBlocks);
    }

    try {
      const result = await documentManager.updateDocumentContent(id, content);
      return interaction.editReply(
        `Document ${id} updated to version **${result.newVersion}** (previous version **${result.previousVersion}** preserved in history — see \`/knowledge versions id:${id}\`).` +
        (result.reindexed ? ` Re-indexed (${result.chunkCount} chunks).` : ' Not currently approved, so it was not re-indexed — approve it to make it searchable.')
      );
    } catch (err) {
      return interaction.editReply(`Failed to update document: ${err.message}`);
    }
  }

  if (sub === 'versions') {
    const id = interaction.options.getInteger('id');
    const doc = documentManager.getDocument(id);
    if (!doc) return interaction.reply({ content: `No document with ID ${id}.`, ephemeral: true });
    const history = documentManager.getVersionHistory(id);
    const lines = [`**${doc.title}** — current version **${doc.version}**`];
    if (history.length === 0) {
      lines.push('*No prior versions — this document has never been updated.*');
    } else {
      for (const v of history) lines.push(`— version ${v.version} (archived ${v.archived_at})`);
    }
    return interaction.reply({ content: lines.join('\n'), ephemeral: true });
  }

  if (sub === 'list') {
    const status = interaction.options.getString('status');
    const docs = documentManager.listDocuments(status);
    if (docs.length === 0) return interaction.reply({ content: '*No documents found.*', ephemeral: true });
    const text = docs.slice(0, 25).map(d => `**#${d.id}** ${d.title} — ${d.category} — ${d.visibility} — *${d.status}*`).join('\n');
    return interaction.reply({ content: text, ephemeral: true });
  }
}

module.exports = { data, execute, category };
