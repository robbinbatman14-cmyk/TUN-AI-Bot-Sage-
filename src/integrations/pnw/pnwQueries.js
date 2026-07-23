// ============================================================
// P&W Queries
// Each function is cached (see pnwCache.js) with a TTL suited to
// how fast that data actually changes. Nation/alliance lookups try
// the most likely field first (name), then fall back to a second
// likely field (leader name / acronym) since a member typing
// "tell me about Odyssey" might mean either the nation or its
// leader's name.
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

async function getNationByName(name) {
  const cacheKey = `nation:name:${name.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  let data = await client.query(
    `query($name: [String]) { nations(nation_name: $name, first: 1) { data { ${NATION_FIELDS} } } }`,
    { name: [name] }
  );
  let nation = data.nations?.data?.[0];

  if (!nation) {
    data = await client.query(
      `query($name: [String]) { nations(leader_name: $name, first: 1) { data { ${NATION_FIELDS} } } }`,
      { name: [name] }
    );
    nation = data.nations?.data?.[0];
  }

  cache.set(cacheKey, nation || null, 600);
  return nation || null;
}

async function getAllianceByName(name) {
  const cacheKey = `alliance:name:${name.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  let data = await client.query(
    `query($name: [String]) { alliances(name: $name, first: 1) { data { ${ALLIANCE_FIELDS} } } }`,
    { name: [name] }
  );
  let alliance = data.alliances?.data?.[0];

  if (!alliance) {
    data = await client.query(
      `query($acr: [String]) { alliances(acronym: $acr, first: 1) { data { ${ALLIANCE_FIELDS} } } }`,
      { acr: [name] }
    );
    alliance = data.alliances?.data?.[0];
  }

  cache.set(cacheKey, alliance || null, 600);
  return alliance || null;
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

  let alliances;
  try {
    const data = await client.query(
      `query($first: Int) { alliances(first: $first, orderBy: [{column: SCORE, order: DESC}]) { data { ${ALLIANCE_FIELDS} } } }`,
      { first: limit }
    );
    alliances = data.alliances?.data || [];
  } catch {
    // orderBy syntax has shifted across P&W API revisions before — if it
    // errors, fall back to an unsorted larger batch and sort client-side
    // rather than failing the whole lookup over a sort clause.
    const data = await client.query(
      `query($first: Int) { alliances(first: $first) { data { ${ALLIANCE_FIELDS} } } }`,
      { first: Math.max(limit, 50) }
    );
    alliances = (data.alliances?.data || []).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit);
  }

  cache.set(cacheKey, alliances, 900); // 15 min — rankings don't shift fast
  return alliances;
}

module.exports = { getNationById, getNationByName, getAllianceByName, getAllianceMembers, getTopAlliances };
