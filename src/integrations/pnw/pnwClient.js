// ============================================================
// Politics & War API Client (Section: Live P&W API Integration)
// Thin wrapper around the public P&W v3 GraphQL API. Deliberately
// does NOT swallow GraphQL errors — it surfaces them verbatim,
// because a wrong field name in a query produces a self-describing
// error from P&W's schema ("Cannot query field X on type Y") that's
// far more useful for fixing a query than a generic failure.
//
// If a query in pnwQueries.js ever errors with a schema complaint,
// the current field/query shape can be checked against the live
// GraphQL playground at https://api.politicsandwar.com/graphql
// (append your key: ?api_key=YOUR_KEY) — P&W's schema has changed
// over the game's history, so this is the authoritative source of
// truth, not any single piece of documentation.
// ============================================================
const ENDPOINT = 'https://api.politicsandwar.com/graphql';

async function query(gqlQuery, variables = {}) {
  const apiKey = process.env.PNW_API_KEY;
  if (!apiKey) {
    throw new Error('PNW_API_KEY is not set in .env. Get one from your Politics & War account settings (My Account → API Key) and add it there.');
  }

  const res = await fetch(`${ENDPOINT}?api_key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gqlQuery, variables })
  });

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Politics & War API returned a non-JSON response (HTTP ${res.status}). The API may be down.`);
  }

  if (json.errors && json.errors.length) {
    throw new Error(`Politics & War API error: ${json.errors.map(e => e.message).join('; ')}`);
  }
  if (!res.ok) {
    throw new Error(`Politics & War API request failed (HTTP ${res.status}).`);
  }
  return json.data;
}

module.exports = { query };
