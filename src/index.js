// ============================================================
// UNAI Entry Point
// ============================================================
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, Events } = require('discord.js');

require('./config/db'); // ensures schema exists before anything else runs

const configManager = require('./config/configManager');
const decisionEngine = require('./engine/decisionEngine');
const sourceManager = require('./knowledge/sourceManager');
const aiCommand = require('./commands/aiCommand');
const knowledgeCommand = require('./commands/knowledgeCommand');
const faqCommand = require('./commands/faqCommand');
const reviewCommand = require('./commands/reviewCommand');
const profileCommand = require('./commands/profileCommand');
const backupCommand = require('./commands/backupCommand');
const sourcesCommand = require('./commands/sourcesCommand');
const pnwCommand = require('./commands/pnwCommand');
const helpCommand = require('./commands/helpCommand');
const { paginateLines } = require('./help/textPaginator');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

client.commands = new Collection();
for (const cmd of [aiCommand, knowledgeCommand, faqCommand, reviewCommand, profileCommand, backupCommand, sourcesCommand, pnwCommand, helpCommand]) {
  client.commands.set(cmd.data.name, cmd);
}

client.once(Events.ClientReady, c => {
  console.log(`[UNAI] Logged in as ${c.user.tag}`);
  console.log(`[UNAI] Serving ${c.guilds.cache.size} guild(s).`);

  // Periodic knowledge source sync (Section 39 - Automatic Knowledge
  // Updates). Runs once shortly after startup, then on a fixed interval.
  // A lockdown check happens inside each run rather than skipping the
  // scheduler entirely, so sync resumes automatically the moment lockdown
  // is lifted without needing a restart.
  const intervalMinutes = configManager.getNumber('google_doc_sync_interval_minutes') || 60;
  const runSync = async () => {
    if (configManager.getBool('lockdown_enabled')) return;
    try {
      const results = await sourceManager.syncAllDueSources();
      const changed = results.filter(r => r.synced);
      if (changed.length > 0) {
        console.log(`[UNAI] Knowledge source sync: ${changed.length} source(s) updated.`);
      }
    } catch (err) {
      console.error('[UNAI] Knowledge source sync failed:', err.message);
    }
  };
  setTimeout(runSync, 2 * 60 * 1000); // first run 2 minutes after startup
  setInterval(runSync, intervalMinutes * 60 * 1000);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[UNAI] Error running /${interaction.commandName}:`, err);

    // Code 10062 = "Unknown interaction": Discord invalidates the interaction
    // token 3 seconds after it's created if nothing has acknowledged it yet.
    // Trying to reply to it again just throws the same error a second time,
    // so there's nothing more to do here — it's usually a one-off network
    // hiccup, not a bug. If this happens repeatedly, it means something in
    // execute() is doing slow work (a slow database call, a hung network
    // request) before its first interaction.reply()/deferReply() call.
    if (err.code === 10062) return;

    const payload = { content: 'Something went wrong running that command. Check the bot logs.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.on(Events.MessageCreate, async message => {
  try {
    if (message.author.bot || message.webhookId) return; // Section 12
    if (!message.guild) return; // DMs out of scope for v1
    if (!message.content?.trim()) return;

    const wasMentioned = message.mentions.has(client.user.id);

    const result = await decisionEngine.process(message, {
      wasMentioned,
      guildMember: message.member
    });

    if (result.action !== 'respond') return;

    // Discord messages cap at 2000 characters. A normal single answer
    // almost always fits in one message, but a multi-question batch
    // reply can easily run much longer — truncating it would silently
    // cut off later answers in the middle. Split on line boundaries
    // (reusing the same paginator built for /help) and send each page
    // as its own message instead: first as a reply, the rest as
    // follow-up sends in the same channel.
    const pages = paginateLines(result.payload.text.split('\n'), 1900);
    for (let i = 0; i < pages.length; i++) {
      if (i === 0) {
        await message.reply({ content: pages[i] });
      } else {
        await message.channel.send({ content: pages[i] });
      }
    }

    if (result.payload.escalate) {
      const escalationChannelId = configManager.get('escalation_channel_id');
      if (escalationChannelId) {
        const channel = await client.channels.fetch(escalationChannelId).catch(() => null);
        if (channel) {
          await channel.send({
            content: `🚩 **UNAI Escalation** — a question in ${message.channel} may need government attention.\n**User:** ${message.author}\n**Question:** ${message.content.slice(0, 500)}\n**Link:** ${message.url}`
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error('[UNAI] Error handling message:', err);
    // Fail safely and silently to the user (Section 98) — errors go to logs, not chat.
  }
});

client.login(process.env.DISCORD_TOKEN);
