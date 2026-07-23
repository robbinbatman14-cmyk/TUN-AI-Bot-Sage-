// ============================================================
// Live Data Fetcher (Hybrid Intelligence)
// Turns P&W API results into a plain-text context block formatted
// exactly like a retrieved knowledge chunk, so answerEngine.js can
// feed it straight into the same grounded-generation pipeline used
// for documents/FAQ — live data becomes just another source the
// model can cite, with no separate answer path to maintain.
// ============================================================
const pnwQueries = require('./pnw/pnwQueries');
const nationLink = require('../verification/nationLink');

function fmtNation(n) {
  if (!n) return null;
  const vmode = n.vacation_mode_turns > 0 ? `Yes (${n.vacation_mode_turns} turns left)` : 'No';
  const beige = n.beige_turns > 0 ? `Yes (${n.beige_turns} turns left)` : 'No';
  return [
    `[Live Politics & War Data — Nation]`,
    `Nation: ${n.nation_name}  Leader: ${n.leader_name}  (ID: ${n.id})`,
    `Alliance: ${n.alliance ? `${n.alliance.name} (${n.alliance.acronym})` : 'None'}${n.alliance_position ? ` — position: ${n.alliance_position}` : ''}`,
    `Cities: ${n.num_cities}  Score: ${n.score}`,
    `Military: ${n.soldiers ?? 0} soldiers, ${n.tanks ?? 0} tanks, ${n.aircraft ?? 0} aircraft, ${n.ships ?? 0} ships, ${n.missiles ?? 0} missiles, ${n.nukes ?? 0} nukes`,
    `Last Active: ${n.last_active}`,
    `Vacation Mode: ${vmode}  Beige: ${beige}`
  ].join('\n');
}

function fmtAlliance(a, members) {
  if (!a) return null;
  const lines = [
    `[Live Politics & War Data — Alliance]`,
    `Alliance: ${a.name} (${a.acronym})  Rank: #${a.rank ?? 'n/a'}  (ID: ${a.id})`,
    `Score: ${a.score}`
  ];
  if (members) {
    lines.push(`Members: ${members.length}`);
    if (members.length) {
      const avg = members.reduce((s, m) => s + (m.score || 0), 0) / members.length;
      lines.push(`Average Score: ${avg.toFixed(2)}`);
      const leaders = members.filter(m => ['LEADER', 'HEIR'].includes((m.alliance_position || '').toUpperCase()));
      if (leaders.length) lines.push(`Leadership: ${leaders.map(l => `${l.leader_name} (${l.alliance_position})`).join(', ')}`);
    }
  }
  return lines.join('\n');
}

function fmtTopAlliances(alliances) {
  if (!alliances || !alliances.length) return null;
  const lines = [`[Live Politics & War Data — Top Alliances]`];
  alliances.forEach((a, i) => lines.push(`${i + 1}. ${a.name} (${a.acronym}) — score ${a.score}`));
  return lines.join('\n');
}

async function fetchNationSummary(entityName) {
  const nation = await pnwQueries.getNationByName(entityName);
  return nation ? fmtNation(nation) : `[Live Politics & War Data]\nNo nation found matching "${entityName}".`;
}

async function fetchAllianceSummary(entityName) {
  const alliance = await pnwQueries.getAllianceByName(entityName);
  if (!alliance) return `[Live Politics & War Data]\nNo alliance found matching "${entityName}".`;
  const members = await pnwQueries.getAllianceMembers(alliance.id, 100).catch(() => null);
  return fmtAlliance(alliance, members);
}

async function fetchTopAlliancesSummary() {
  const alliances = await pnwQueries.getTopAlliances(10);
  return fmtTopAlliances(alliances) || '[Live Politics & War Data]\nCould not retrieve alliance rankings.';
}

async function fetchDiscordUserSummary(discordUserId) {
  const link = nationLink.getByDiscordId(discordUserId);
  if (!link) {
    return `[Live Politics & War Data]\nNo nation is linked to that Discord user yet. They can link their own with \`/pnw verify link nation_id:<their nation ID>\`, or an admin can use \`/pnw verify link-for\`.`;
  }
  const nation = await pnwQueries.getNationById(link.nation_id);
  if (!nation) {
    return `[Live Politics & War Data]\nThat Discord user is linked to nation ID ${link.nation_id}, but it could not be retrieved from the Politics & War API right now.`;
  }
  return `[Live Politics & War Data — Discord Lookup]\n${fmtNation(nation).replace('[Live Politics & War Data — Nation]\n', '')}`;
}

/**
 * Decides what, if any, live data a message needs and fetches it.
 * Discord @mention "who is @X" questions are detected deterministically
 * here (not by the LLM classifier) since extracting a numeric Discord ID
 * reliably from free text is exactly the kind of thing regex does better
 * than an LLM guess.
 */
async function fetchRelevantLiveData(classification, messageContent) {
  const mentionMatch = messageContent.match(/<@!?(\d+)>/);
  if (mentionMatch && /who\s*('?s|\s+is)\b/i.test(messageContent)) {
    try {
      return await fetchDiscordUserSummary(mentionMatch[1]);
    } catch (err) {
      return `[Live Politics & War Data — Error]\n${err.message}`;
    }
  }

  if (!classification?.live_data?.needed) return null;
  const { type, entity_name } = classification.live_data;

  try {
    switch (type) {
      case 'nation':
        return entity_name ? await fetchNationSummary(entity_name) : null;
      case 'alliance':
        return entity_name ? await fetchAllianceSummary(entity_name) : null;
      case 'top_alliances':
        return await fetchTopAlliancesSummary();
      default:
        return null;
    }
  } catch (err) {
    console.error('[UNAI] Live P&W data fetch failed:', err.message);
    return `[Live Politics & War Data — Error]\nCouldn't retrieve live data: ${err.message}`;
  }
}

module.exports = {
  fetchRelevantLiveData, fetchNationSummary, fetchAllianceSummary,
  fetchTopAlliancesSummary, fetchDiscordUserSummary
};
