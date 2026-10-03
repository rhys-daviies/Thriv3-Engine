/**
 * =============================================================================
 * THE CORPUS DIGEST CACHE IS INVALIDATED BY ANY WRITE — A9.7 §P/§Q finding.
 *
 * This is a CHARACTERISATION TEST, not an approval. It pins a behaviour A9.7
 * measured and is recommending be fixed, so that the fix is visible when it
 * lands and so the behaviour cannot quietly get worse first.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS MEASURED, on a 313 MB consistent copy of the live database:
 *
 *   GET .../matchmaking/runs/current                      9.3 ms
 *   ... after ONE unrelated tracking_events INSERT      929.9 ms
 *   ... after another                                   892.3 ms
 *   ... with no write in between                          9.0 ms
 *
 * THE MECHANISM. `cachedCorpusDigests` keys on `corpusChangeToken(db)`, which
 * is `data_version:total_changes()`. `total_changes()` counts EVERY write on
 * the connection since it opened - so a tracking pixel, an operator note, an
 * observation or a send record all invalidate a cache that exists to avoid
 * re-digesting the corpus, and the next staleness check pays the full
 * recomputation.
 *
 * This is A9.4's design, not something A9.7 introduced. A9.4 measured the
 * repair at 890 ms -> 0.03 ms and that measurement was correct; what it did
 * not exercise was an INTERLEAVED WRITE, which in production is continuous
 * because coaches open profiles and `tracking_events` records it.
 *
 * It is a performance characteristic and not a correctness one: staleness is
 * still computed correctly every time. Recorded as a known limitation with a
 * recommended fix in the A9.7 report rather than repaired here, because
 * changing the corpus digest cache key is freeze-adjacent work and A9.7 is
 * explicitly not the phase for it.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, beforeAll } from 'vitest';
import db from '../../db/client.js';
import { corpusChangeToken } from '../../db/corpusIdentity.js';
import {
  cachedCorpusDigests, clearCorpusDigestCache, corpusDigestCacheStats,
} from './corpusIdentity.js';
import { seedPool } from './seedTestPool.js';

beforeAll(() => {
  seedPool('mens-soccer', { count: 40 });
  seedPool('womens-soccer', { count: 20 });
});

const write = () => db.prepare(
  "INSERT INTO tracking_events (token, session_id, event_type, created_at) VALUES ('t','s','probe',?)",
).run(new Date().toISOString());

describe('A9.7. the corpus digest cache and unrelated writes', () => {
  it('P1. the change token moves on a write to an unrelated table', () => {
    const before = corpusChangeToken(db);
    write();
    expect(corpusChangeToken(db)).not.toBe(before);
  });

  it('P2. a repeated read with no write in between is a cache HIT', () => {
    clearCorpusDigestCache();
    const start = corpusDigestCacheStats();
    cachedCorpusDigests(db);
    cachedCorpusDigests(db);
    cachedCorpusDigests(db);
    const stats = corpusDigestCacheStats();
    expect(stats.recomputations - start.recomputations).toBe(1);
    expect(stats.hits - start.hits).toBe(2);
  });

  /**
   * THE FINDING. One INSERT into `tracking_events` - a table the corpus digest
   * does not read - forces a full recomputation.
   */
  it('P3. ONE unrelated write forces a full recomputation', () => {
    clearCorpusDigestCache();
    const start = corpusDigestCacheStats();
    cachedCorpusDigests(db);          // 1 recomputation
    write();
    cachedCorpusDigests(db);          // 2nd recomputation, caused by the write
    cachedCorpusDigests(db);          // hit
    const stats = corpusDigestCacheStats();
    expect(stats.recomputations - start.recomputations).toBe(2);
    expect(stats.hits - start.hits).toBe(1);
  });

  /**
   * AND THE DIGEST IS UNCHANGED, which is why this is a performance finding
   * rather than a correctness one. The expensive recomputation produces
   * exactly the same answer it already had.
   */
  it('P4. the recomputed digest is identical — only the cost was real', () => {
    clearCorpusDigestCache();
    const before = cachedCorpusDigests(db);
    write();
    const after = cachedCorpusDigests(db);
    expect(after.SUPPORTED.digest).toBe(before.SUPPORTED.digest);
    expect(after.UNSUPPORTED.digest).toBe(before.UNSUPPORTED.digest);
  });
});
