// ============================================================
// UNAI Entry Point
// ============================================================
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, Events } = require('discord.js');

require('./config/db'); // ensures schema exists before anything else runs

const decisionEngine = require('./engine/decisionEngine');
const aiCommand = require('./commands/aiCommand');
const knowledgeCommand = require('./commands/knowledgeCommand');
const faqCommand = require('./commands/faqCommand');
const reviewCommand = require('./commands/reviewCommand');
const profileCommand = require('./commands/profileCommand');
const backupCommand = require('./commands/backupCommand');
const helpCommand = require('./commands/helpCommand');

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
for (const cmd of [aiCommand, knowledgeCommand, faqCommand, reviewCommand, profileCommand, backupCommand, helpCommand]) {
  client.commands.set(cmd.data.name, cmd);
}

client.once(Events.ClientReady, c => {
  console.log(`[UNAI] Logged in as ${c.user.tag}`);
  console.log(`[UNAI] Serving ${c.guilds.cache.size} guild(s).`);
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

    await message.reply({ content: result.payload.text.slice(0, 1900) });

    if (result.payload.escalate) {
      const configManager = require('./config/configManager');
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
