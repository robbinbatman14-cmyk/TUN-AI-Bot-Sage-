// ============================================================
// P&W API Cache (spec: "frequently requested information should
// be cached and refreshed periodically, with administrators
// having the ability to manually refresh the cache")
// In-memory only — resets on restart, which is fine since it's a
// freshness cache, not durable state. Admin refresh is
// /pnw cache clear.
// ============================================================
const { createTTLCache } = require('../../utils/ttlCache');

module.exports = createTTLCache();
