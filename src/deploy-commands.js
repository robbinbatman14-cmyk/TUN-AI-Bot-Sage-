// ============================================================
// Run this once (and again any time you change a command's
// options) to register slash commands with Discord:
//   npm run deploy-commands
// ============================================================
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const aiCommand = require('./commands/aiCommand');
const knowledgeCommand = require('./commands/knowledgeCommand');
const faqCommand = require('./commands/faqCommand');
const reviewCommand = require('./commands/reviewCommand');
const profileCommand = require('./commands/profileCommand');
const backupCommand = require('./commands/backupCommand');
const sourcesCommand = require('./commands/sourcesCommand');
const pnwCommand = require('./commands/pnwCommand');
const helpCommand = require('./commands/helpCommand');

const commands = [aiCommand, knowledgeCommand, faqCommand, reviewCommand, profileCommand, backupCommand, sourcesCommand, pnwCommand, helpCommand].map(c => c.data.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (guildId) {
      console.log(`Registering ${commands.length} commands to guild ${guildId} (instant update)...`);
      await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
        { body: commands }
      );
    } else {
      console.log(`Registering ${commands.length} commands globally (can take up to 1 hour to appear)...`);
      await rest.put(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
        { body: commands }
      );
    }
    console.log('Done.');
  } catch (err) {
    console.error(err);
  }
})();
