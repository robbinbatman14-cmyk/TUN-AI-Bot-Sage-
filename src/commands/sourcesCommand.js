// ============================================================
// /sources command (Section 29 - Dynamic Knowledge Sources,
// Section 39 - Automatic Knowledge Updates)
// ============================================================
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const permissionEngine = require('../permissions/permissionEngine');
const configManager = require('../config/configManager');
const sourceManager = require('../knowledge/sourceManager');
const { SHEET_PURPOSES } = require('../knowledge/sheetPurposes');

const category = 'Knowledge Sources';
const MUTATING = ['add-google-doc', 'add-google-sheet', 'sync', 'enable', 'disable', 'remove', 'set-purpose'];

const PRIORITY_CHOICES = [
  { name: '1 — Doctrine / Constitution / Official Policy (highest authority)', value: 1 },
  { name: '2 — Internal Guides & Handbooks (default)', value: 2 },
  { name: '3 — Official Politics & War Documentation', value: 3 },
  { name: '4 — Community / External Guides (lowest authority)', value: 4 }
];

const VISIBILITY_CHOICES = [
  { name: 'Public', value: 'public' }, { name: 'Members Only (default)', value: 'members_only' },
  { name: 'Government', value: 'government' }, { name: 'Ministry', value: 'ministry' }, { name: 'Owner', value: 'owner' }
];

const data = new SlashCommandBuilder()
  .setName('sources')
  .setDescription('Manage dynamic knowledge sources that sync automatically (Google Docs, Google Sheets)')
  .addSubcommand(sc => sc.setName('add-google-doc')
    .setDescription('Link a Google Doc as a knowledge source (must be shared "Anyone with the link – Viewer")')
    .addStringOption(o => o.setName('link').setDescription('Google Doc URL').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Document title').setRequired(true))
    .addStringOption(o => o.setName('category').setDescription('Category, e.g. constitution, military').setRequired(true))
    .addIntegerOption(o => o.setName('priority').setDescription('Source authority tier (default: 2 — Internal Guides)').setRequired(false)
      .addChoices(...PRIORITY_CHOICES))
    .addStringOption(o => o.setName('visibility').setDescription('Who can see this').setRequired(false)
      .addChoices(...VISIBILITY_CHOICES)))
  .addSubcommand(sc => sc.setName('add-google-sheet')
.setDescription('Link a Google Sheet as a knowledge source.')
  .addStringOption(o => o.setName('link').setDescription('Google Sheet URL').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Sheet title, e.g. "Member Roster"').setRequired(true))
    .addStringOption(o => o.setName('category').setDescription('Category, e.g. roster, academy, audits, tax').setRequired(true))
    .addStringOption(o => o.setName('purpose').setDescription('What this sheet IS, so the bot can auto-route requests to it (e.g. "list all members")').setRequired(false)
      .addChoices(...SHEET_PURPOSES.map(p => ({ name: p.label, value: p.key }))))
    .addIntegerOption(o => o.setName('priority').setDescription('Source authority tier (default: 2 — Internal Guides)').setRequired(false)
      .addChoices(...PRIORITY_CHOICES))
    .addStringOption(o => o.setName('visibility').setDescription('Who can see this').setRequired(false)
      .addChoices(...VISIBILITY_CHOICES)))
  .addSubcommand(sc => sc.setName('set-purpose').setDescription('Set or change a linked Google Sheet\'s purpose tag')
    .addIntegerOption(o => o.setName('id').setDescription('Source ID').setRequired(true))
    .addStringOption(o => o.setName('purpose').setDescription('Purpose').setRequired(true)
      .addChoices(...SHEET_PURPOSES.map(p => ({ name: p.label, value: p.key })))))
  .addSubcommand(sc => sc.setName('list').setDescription('List all knowledge sources'))
  .addSubcommand(sc => sc.setName('sync').setDescription('Manually sync a source right now')
    .addIntegerOption(o => o.setName('id').setDescription('Source ID').setRequired(true)))
  .addSubcommand(sc => sc.setName('enable').setDescription('Enable automatic periodic sync for a source')
    .addIntegerOption(o => o.setName('id').setDescription('Source ID').setRequired(true)))
  .addSubcommand(sc => sc.setName('disable').setDescription('Disable automatic periodic sync for a source')
    .addIntegerOption(o => o.setName('id').setDescription('Source ID').setRequired(true)))
  .addSubcommand(sc => sc.setName('remove').setDescription('Unlink a source (keeps the document — use /knowledge to remove that too)')
    .addIntegerOption(o => o.setName('id').setDescription('Source ID').setRequired(true)))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

async function execute(interaction) {
  if (!permissionEngine.requireAdmin(interaction)) return;
  const sub = interaction.options.getSubcommand();

  if (MUTATING.includes(sub) && configManager.getBool('lockdown_enabled')) {
    return interaction.reply({
      content: '🔒 UNAI is in emergency lockdown (`/ai lockdown`) — knowledge source changes are paused until it\'s lifted.',
      ephemeral: true
    });
  }

  if (sub === 'add-google-doc') {
    await interaction.deferReply({ ephemeral: true });
    const link = interaction.options.getString('link');
    const title = interaction.options.getString('title');
    const docCategory = interaction.options.getString('category').toLowerCase();
    const priority = interaction.options.getInteger('priority') || 2;
    const visibility = interaction.options.getString('visibility') || 'members_only';

    try {
      const result = await sourceManager.addGoogleDocSource({
        url: link, title, category: docCategory, visibility, priority, addedBy: interaction.user.id
      });
      return interaction.editReply(
        `Google Doc linked as source **#${result.sourceId}** → document **#${result.documentId}** (pending). ` +
        `Run \`/knowledge approve id:${result.documentId}\` once to activate it — after that, edits to the Google Doc sync automatically, no re-uploading needed.`
      );
    } catch (err) {
      return interaction.editReply(`Couldn't add that Google Doc: ${err.message}`);
    }
  }

  if (sub === 'add-google-sheet') {
    await interaction.deferReply({ ephemeral: true });
    const link = interaction.options.getString('link');
    const title = interaction.options.getString('title');
    const docCategory = interaction.options.getString('category').toLowerCase();
    const purpose = interaction.options.getString('purpose') || null;
    const priority = interaction.options.getInteger('priority') || 2;
    const visibility = interaction.options.getString('visibility') || 'members_only';

    try {
      const result = await sourceManager.addGoogleSheetSource({
        url: link, title, category: docCategory, visibility, priority, purpose, addedBy: interaction.user.id
      });
      const purposeNote = purpose
        ? ` Tagged as **${SHEET_PURPOSES.find(p => p.key === purpose)?.label || purpose}** — requests like "list all members" will now route here automatically once approved.`
        : ' No purpose tag set — the bot will only use this sheet when a question directly matches its content semantically. Set one with `/sources set-purpose` if you want it auto-routed for broad requests.';
      return interaction.editReply(
        `Google Sheet linked as source **#${result.sourceId}** → document **#${result.documentId}** (pending). ` +
        `Found ${result.sheetNames.length} tab(s) [${result.sheetNames.join(', ')}], ${result.rowCount} data row(s) total.${purposeNote} ` +
        `Run \`/knowledge approve id:${result.documentId}\` once to activate it.`
      );
    } catch (err) {
      return interaction.editReply(`Couldn't add that Google Sheet: ${err.message}`);
    }
  }

  if (sub === 'set-purpose') {
    const id = interaction.options.getInteger('id');
    const purpose = interaction.options.getString('purpose');
    const source = sourceManager.getSource(id);
    if (!source) return interaction.reply({ content: `No source with ID ${id}.`, ephemeral: true });
    if (source.type !== 'google_sheet') return interaction.reply({ content: `Source #${id} isn't a Google Sheet — purpose tags only apply to sheets.`, ephemeral: true });
    sourceManager.setSheetPurpose(id, purpose);
    return interaction.reply({ content: `Source #${id} tagged as **${SHEET_PURPOSES.find(p => p.key === purpose)?.label || purpose}**.`, ephemeral: true });
  }

  if (sub === 'list') {
    const sources = sourceManager.listSources();
    if (sources.length === 0) return interaction.reply({ content: '*No knowledge sources linked yet. Add one with `/sources add-google-doc` or `/sources add-google-sheet`.*', ephemeral: true });
    const text = sources.slice(0, 25).map(s => {
      const source = sourceManager.getSource(s.id);
      const purposeTag = source?.sheet_purpose ? ` [${SHEET_PURPOSES.find(p => p.key === source.sheet_purpose)?.label || source.sheet_purpose}]` : '';
      return `**#${s.id}** [${s.type}]${purposeTag} "${s.title}" → doc #${s.document_id} (${s.status}, v${s.version}) — sync: ${s.sync_enabled ? 'on' : 'off'} — last synced: ${s.last_synced_at || 'never'}${s.last_sync_status ? ` (${s.last_sync_status})` : ''}`;
    }).join('\n');
    return interaction.reply({ content: text.slice(0, 1900), ephemeral: true });
  }

  if (sub === 'sync') {
    await interaction.deferReply({ ephemeral: true });
    const id = interaction.options.getInteger('id');
    try {
      const result = await sourceManager.syncSource(id);
      if (!result.synced) {
        return interaction.editReply('No changes detected — the source is already up to date.');
      }
      return interaction.editReply(
        `Synced — document updated to version **${result.newVersion}**` +
        (result.reindexed ? `, re-indexed (${result.chunkCount} chunks).` : ' (not yet approved, so not re-indexed — approve it to make it searchable).')
      );
    } catch (err) {
      return interaction.editReply(`Sync failed: ${err.message}`);
    }
  }

  if (sub === 'enable' || sub === 'disable') {
    const id = interaction.options.getInteger('id');
    sourceManager.setSourceEnabled(id, sub === 'enable');
    return interaction.reply({ content: `Automatic sync **${sub === 'enable' ? 'enabled' : 'disabled'}** for source #${id}.`, ephemeral: true });
  }

  if (sub === 'remove') {
    const id = interaction.options.getInteger('id');
    sourceManager.removeSource(id);
    return interaction.reply({ content: `Source #${id} unlinked. The document itself is untouched — use \`/knowledge archive\` or \`/knowledge delete\` if you want to remove it too.`, ephemeral: true });
  }
}

module.exports = { data, execute, category };
