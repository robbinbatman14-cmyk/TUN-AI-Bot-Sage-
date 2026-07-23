// ============================================================
// P&W API Cache (spec: "frequently requested information should
// be cached and refreshed periodically, with administrators
// having the ability to manually refresh the cache")
// In-memory only — resets on restart, which is fine since it's a
// freshness cache, not durable state. Admin refresh is
// /pnw cache clear.
// ============================================================
const store = new Map(); // key -> { value, expiresAt }

function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function set(key, value, ttlSeconds) {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/** Clears all entries, or only those whose key starts with `prefix`. Returns count cleared. */
function clear(prefix) {
  let count = 0;
  for (const key of store.keys()) {
    if (!prefix || key.startsWith(prefix)) {
      store.delete(key);
      count++;
    }
  }
  return count;
}

function size() {
  return store.size;
}

module.exports = { get, set, clear, size };
