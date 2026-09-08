/**
 * Fixed-window rate limiter, in memory.
 *
 * The collector is public and unauthenticated, so it needs a ceiling per IP
 * and per token. Shared by the Express collector and the Worker, so it depends
 * on nothing beyond standard JavaScript.
 *
 * Caveat in the Worker: state is per isolate, and Cloudflare runs many, so this
 * bounds a single attacker's throughput rather than enforcing a global ceiling.
 * A Durable Object or Cloudflare's own rate limiting is the stronger control if
 * abuse ever becomes real; this is the cheap first line.
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

    /**
     * Forget one key's budget.
     *
     * Added in 13K for sign-in: a SUCCESSFUL login clears the account's
     * counter, so somebody who types their password correctly is never locked
     * out by having signed in a few times, while an attacker guessing wrongly
     * stays bounded. Found in live testing, where five sign-ins in a quarter
     * of an hour — a restart, a second tab, a rotated secret — was enough to
     * refuse the real operator.
     */
    clear(key) {
      return buckets.delete(key);
    },

    reset() {
      buckets.clear();
    },

    get size() {
      return buckets.size;
    },
  };
}
