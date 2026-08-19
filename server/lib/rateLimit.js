/**
 * Fixed-window rate limiter, in memory.
 *
 * The collector is public and unauthenticated, so it needs a ceiling per IP
 * and per token. In-process state is the right scope here: the Express server
 * is a single process, and when the collector moves to a Worker this is
 * replaced by Cloudflare's own rate limiting rather than ported.
 */
export function createRateLimiter({ limit, windowMs, maxKeys = 10_000 }) {
  const buckets = new Map();

  function sweep(now) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return {
    /** Returns true when the request is allowed, false when it is over limit. */
    check(key, now = Date.now()) {
      if (key === null || key === undefined) return true;

      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        // Bound memory before admitting a new key, so a flood of unique keys
        // cannot grow the map without limit.
        if (buckets.size >= maxKeys) sweep(now);
        if (buckets.size >= maxKeys) return false;
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }

      bucket.count++;
      return bucket.count <= limit;
    },

    reset() {
      buckets.clear();
    },

    get size() {
      return buckets.size;
    },
  };
}
