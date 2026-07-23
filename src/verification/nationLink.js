// ============================================================
// Nation Linking (Discord User Lookup feature)
// Maps a Discord user to their Politics & War nation. Self-serve
// linking (Section: "Discord User Lookup") is verified against the
// nation's own "discord" field — the Discord username a player can
// set on their nation page in-game — so a member can't claim
// someone else's nation. Admins can also link on a member's behalf
// without that check, for cases where the in-game field isn't set.
// ============================================================
const db = require('../config/db');

function linkNation({ discordId, nationId, nationName, leaderName, linkedBy, method }) {
  db.prepare(`
    INSERT INTO nation_links (discord_id, nation_id, nation_name, leader_name, linked_by, method)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      nation_id = excluded.nation_id, nation_name = excluded.nation_name, leader_name = excluded.leader_name,
      linked_by = excluded.linked_by, method = excluded.method, linked_at = CURRENT_TIMESTAMP
  `).run(discordId, nationId, nationName, leaderName, linkedBy, method);
}

function getByDiscordId(discordId) {
  return db.prepare('SELECT * FROM nation_links WHERE discord_id = ?').get(discordId);
}

function getByNationId(nationId) {
  return db.prepare('SELECT * FROM nation_links WHERE nation_id = ?').get(nationId);
}

function unlink(discordId) {
  db.prepare('DELETE FROM nation_links WHERE discord_id = ?').run(discordId);
}

function listAll() {
  return db.prepare('SELECT * FROM nation_links ORDER BY linked_at DESC').all();
}

module.exports = { linkNation, getByDiscordId, getByNationId, unlink, listAll };
