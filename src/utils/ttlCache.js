// ============================================================
// Generic in-memory TTL cache factory. Originally lived only in
// pnwCache.js; factored out here so query-embedding caching (see
// knowledgeStore.js) can reuse the same get/set/clear logic instead
// of duplicating it.
// ============================================================
function createTTLCache() {
  const store = new Map();

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

  return { get, set, clear, size };
}

module.exports = { createTTLCache };
