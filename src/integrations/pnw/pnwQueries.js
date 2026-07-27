// ============================================================
// P&W Queries
// Each function is cached (see pnwCache.js) with a TTL suited to
// how fast that data actually changes. Nation lookups try the most
// likely field first (name), then fall back to leader name, since
// a member typing "tell me about Odyssey" might mean either the
// nation or its leader's name — both are confirmed-valid filter
// arguments on the `nations` query. Alliance acronym/partial-name
// matching is done client-side against a cached index (see
// getAllianceIndex) rather than a server-side filter, since
// `acronym` is confirmed NOT to be a valid filter argument on the
// `alliances` query (a real "Unknown argument" error from the live
// API caught this) — a lesson in not trusting guessed field names
// past what's actually been verified against the live schema.
// ============================================================
const client = require('./pnwClient');
const cache = require('./pnwCache');

const NATION_FIELDS = `
  id
  nation_name
  leader_name
  score
  num_cities
  color
  alliance_id
  alliance { id name acronym }
  alliance_position
  last_active
  soldiers
  tanks
  aircraft
  ships
  missiles
  nukes
  vacation_mode_turns
  beige_turns
  discord
  discord_id
`;

const ALLIANCE_FIELDS = `
  id
  name
  acronym
  score
  color
  rank
`;

async function getNationById(id) {
  const cacheKey = `nation:id:${id}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const data = await client.query(
    `query($id: [Int]) { nations(id: $id, first: 1) { data { ${NATION_FIELDS} } } }`,
    { id: [Number(id)] }
  );
  const nation = data.nations?.data?.[0] || null;
  cache.set(cacheKey, nation, 600); // 10 min
  return nation;
}

function titleCase(str) {
  return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

async function getNationByName(name) {
  const cacheKey = `nation:name:${name.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  // P&W's nation_name/leader_name filters appear to match on exact string,
  // so "odyssey" won't find "Odyssey" on its own. Rather than require
  // members to remember exact capitalization, try a small set of likely
  // variants — as typed, Title Case, all-lowercase, ALL-CAPS — stopping at
  // the first hit. This isn't a true case-insensitive search (P&W doesn't
  // expose one, and there's no feasible client-side index across the
  // game's entire nation count the way there is for the much smaller
  // alliance list), but it covers the realistic range of how someone
  // might type a name from memory.
  const variants = [...new Set([name, titleCase(name), name.toLowerCase(), name.toUpperCase()])];

  let nation = null;
  for (const variant of variants) {
    const data = await client.query(
      `query($name: [String]) { nations(nation_name: $name, first: 1) { data { ${NATION_FIELDS} } } }`,
      { name: [variant] }
    );
    nation = data.nations?.data?.[0];
    if (nation) break;
  }

  if (!nation) {
    for (const variant of variants) {
      const data = await client.query(
        `query($name: [String]) { nations(leader_name: $name, first: 1) { data { ${NATION_FIELDS} } } }`,
        { name: [variant] }
      );
      nation = data.nations?.data?.[0];
      if (nation) break;
    }
  }

  cache.set(cacheKey, nation || null, 600);
  return nation || null;
}

/** Pulls a nation ID out of a pasted P&W profile link, e.g. politicsandwar.com/nation/id=12345. */
function extractNationIdFromUrl(input) {
  const match = (input || '').match(/nation\/id=(\d+)/i);
  return match ? match[1] : null;
}

/**
 * Resolves ANY of the three ways someone might identify a nation — a raw
 * numeric ID, a pasted profile link, or a nation/leader name (case handled
 * by getNationByName's variant retries above) — into a single nation
 * lookup. This is the one function commands should call rather than each
 * reimplementing "is this an ID, a link, or a name?" themselves.
 * @param {string} input
 */
async function resolveNation(input) {
  const trimmed = (input || '').trim();
  if (/^\d+$/.test(trimmed)) return getNationById(trimmed);

  const urlId = extractNationIdFromUrl(trimmed);
  if (urlId) return getNationById(urlId);

  return getNationByName(trimmed);
}

/**
 * A cached snapshot of alliances used for anything the `alliances` query
 * doesn't accept a direct server-side filter for. We learned the hard way
 * that `acronym` is NOT a valid filter argument on this query (confirmed
 * by a real "Unknown argument \"acronym\"" error from the live API) —
 * rather than guess at another argument name and risk the same failure,
 * acronym/partial-name matching and score sorting are done client-side
 * against this snapshot instead.
 */
async function getAllianceIndex() {
  const cacheKey = 'alliance:index';
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const data = await client.query(
    `query($first: Int) { alliances(first: $first) { data { ${ALLIANCE_FIELDS} } } }`,
    { first: 500 }
  );
  const alliances = data.alliances?.data || [];
  cache.set(cacheKey, alliances, 3600); // 1 hour — acronym/name mappings rarely change
  return alliances;
}

async function getAllianceByName(name) {
  const cacheKey = `alliance:name:${name.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Fast path: `name` is a confirmed-valid filter argument.
  let alliance = null;
  try {
    const data = await client.query(
      `query($name: [String]) { alliances(name: $name, first: 1) { data { ${ALLIANCE_FIELDS} } } }`,
      { name: [name] }
    );
    alliance = data.alliances?.data?.[0] || null;
  } catch (err) {
    console.error('[UNAI] Alliance name-filter query failed, falling back to index search:', err.message);
  }

  // Fall back to acronym / partial-name matching against the cached index.
  if (!alliance) {
    const index = await getAllianceIndex();
    const lower = name.toLowerCase();
    alliance =
      index.find(a => (a.acronym || '').toLowerCase() === lower) ||
      index.find(a => (a.name || '').toLowerCase() === lower) ||
      index.find(a => (a.name || '').toLowerCase().includes(lower)) ||
      null;
  }

  cache.set(cacheKey, alliance, 600);
  return alliance;
}

async function getAllianceMembers(allianceId, limit = 100) {
  const cacheKey = `alliance:members:${allianceId}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const data = await client.query(
    `query($id: [Int], $first: Int) { nations(alliance_id: $id, first: $first) { data { id nation_name leader_name score alliance_position last_active } } }`,
    { id: [Number(allianceId)], first: limit }
  );
  const members = data.nations?.data || [];
  cache.set(cacheKey, members, 300); // 5 min — membership/activity changes faster
  return members;
}

async function getTopAlliances(limit = 10) {
  const cacheKey = `alliances:top:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Previously tried a server-side `orderBy` argument with a try/catch
  // fallback — given acronym turned out to be an unverified guess that
  // failed, orderBy's exact shape is equally unverified, so this sorts
  // the same cached index client-side instead of risking a second
  // silent-fallback path.
  const index = await getAllianceIndex();
  const sorted = [...index].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit);
  cache.set(cacheKey, sorted, 900); // 15 min — rankings don't shift fast
  return sorted;
}

module.exports = {
  getNationById, getNationByName, resolveNation, extractNationIdFromUrl,
  getAllianceByName, getAllianceMembers, getTopAlliances, getAllianceIndex
};
