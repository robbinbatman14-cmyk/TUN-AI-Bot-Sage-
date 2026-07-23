// ============================================================
// /help command
// Builds its entire command list dynamically from whatever is
// registered in client.commands — it never needs manual updates
// when a command is added, renamed, or gets new subcommands, and
// it structurally cannot exceed Discord's embed limits no matter
// how large the command set grows, because output always runs
// through the paginator in textPaginator.js and Discord's real
// hard caps (4096 chars/embed description, 6000 chars/embed
// total) are respected with margin.
// ============================================================
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ComponentType
} = require('discord.js');
const { paginateLines } = require('../help/textPaginator');

const category = 'General';

const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('List all UNAI commands, grouped by category');

// Preferred display order. Any category not listed here (e.g. one added
// by a future command file) is appended automatically, alphabetically —
// nothing needs to be edited here for new commands to show up correctly.
const CATEGORY_ORDER = [
  'General',
  'Configuration & Administration',
  'Knowledge Base',
  'Knowledge Sources',
  'FAQ',
  'Configuration Profiles',
  'Backup & Restore',
  'Review, Diagnostics & Security'
];

const SUBCOMMAND = 1;
const SUBCOMMAND_GROUP = 2;

function formatOptionSignature(opt) {
  const plainOptions = (opt.options || []).filter(o => o.type !== SUBCOMMAND && o.type !== SUBCOMMAND_GROUP);
  if (plainOptions.length === 0) return '';
  return ' ' + plainOptions.map(o => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ');
}

/** Turns one command's SlashCommandBuilder JSON into one-or-more display lines. */
function formatCommandLines(json) {
  const top = json.options || [];
  const hasSubcommands = top.some(o => o.type === SUBCOMMAND || o.type === SUBCOMMAND_GROUP);

  if (!hasSubcommands) {
    return [`\`/${json.name}${formatOptionSignature(json)}\` — ${json.description}`];
  }

  const lines = [];
  for (const opt of top) {
    if (opt.type === SUBCOMMAND) {
      lines.push(`\`/${json.name} ${opt.name}${formatOptionSignature(opt)}\` — ${opt.description}`);
    } else if (opt.type === SUBCOMMAND_GROUP) {
      for (const sub of opt.options || []) {
        lines.push(`\`/${json.name} ${opt.name} ${sub.name}${formatOptionSignature(sub)}\` — ${sub.description}`);
      }
    }
  }
  return lines;
}

/** Builds the full flat line list for every registered command, grouped by category. */
function buildLines(commandCollection) {
  const byCategory = new Map();
  for (const cmd of commandCollection.values()) {
    const cat = cmd.category || 'General';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(cmd);
  }

  const orderedCategories = [
    ...CATEGORY_ORDER.filter(c => byCategory.has(c)),
    ...[...byCategory.keys()].filter(c => !CATEGORY_ORDER.includes(c)).sort()
  ];

  const lines = [];
  for (const cat of orderedCategories) {
    lines.push(`__**${cat}**__`);
    const cmds = byCategory.get(cat).sort((a, b) => a.data.name.localeCompare(b.data.name));
    for (const cmd of cmds) lines.push(...formatCommandLines(cmd.data.toJSON()));
    lines.push('');
  }
  return lines;
}

async function execute(interaction) {
  const lines = buildLines(interaction.client.commands);
  // 3500 leaves comfortable margin under the 4096-char embed description
  // cap and the 6000-char total-embed cap once title/footer are added —
  // this is what makes growth safe regardless of how many commands exist.
  const pages = paginateLines(lines, 3500);

  let pageIndex = 0;

  const buildEmbed = () => new EmbedBuilder()
    .setTitle('UNAI Commands')
    .setDescription(pages[pageIndex] || '*No commands registered.*')
    .setFooter({ text: `Page ${pageIndex + 1} of ${pages.length}` })
    .setColor(0x2b6cb0);

  const buildRow = () => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('unai_help_prev').setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(pageIndex === 0),
    new ButtonBuilder().setCustomId('unai_help_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(pageIndex === pages.length - 1)
  );

  const components = pages.length > 1 ? [buildRow()] : [];
  const reply = await interaction.reply({ embeds: [buildEmbed()], components, ephemeral: true, fetchReply: true });

  if (pages.length <= 1) return;

  const collector = reply.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 5 * 60 * 1000
  });

  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: "This isn't your help menu — run `/help` yourself.", ephemeral: true });
    }
    if (i.customId === 'unai_help_prev') pageIndex = Math.max(0, pageIndex - 1);
    if (i.customId === 'unai_help_next') pageIndex = Math.min(pages.length - 1, pageIndex + 1);
    await i.update({ embeds: [buildEmbed()], components: [buildRow()] });
  });

  collector.on('end', () => {
    interaction.editReply({ components: [] }).catch(() => {});
  });
}

module.exports = { data, execute, category };
