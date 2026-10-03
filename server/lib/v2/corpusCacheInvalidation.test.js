/**
 * =============================================================================
 * THE CORPUS DIGEST CACHE AND UNRELATED WRITES — A9.7's finding, A9.7B's fix.
 *
 * A9.7 wrote this as a CHARACTERISATION TEST: it pinned a defect so the repair
 * would be visible when it landed. A9.7B landed it, and `P3` - which asserted
 * that one unrelated write forced a full recomputation - now asserts the
 * opposite. It is the only test in this repository that was deliberately
 * written to be inverted later.
 *
 * The measurements below are kept VERBATIM. They are what was true at
 * `04efbb4`, they are why the detector was replaced, and rewriting them to
 * match today's numbers would erase the evidence for a decision rather than
 * record it.
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
 * It was a performance characteristic and not a correctness one: staleness was
 * computed correctly every time, which `P4` still asserts. A9.7 recorded it as
 * a known limitation rather than repairing it, because changing the cache key
 * is freeze-adjacent work; A9.7B is the bounded phase that did it.
 * ---------------------------------------------------------------------------
 */
import { describe, it, expect, beforeAll } from 'vitest';
import db from '../../db/client.js';
import { corpusChangeToken, corpusRevisionToken } from '../../db/corpusIdentity.js';
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
  it('P1. the PRECISE token does not move on a write to an unrelated table', () => {
    const before = corpusRevisionToken(db);
    write();
    expect(corpusRevisionToken(db)).toBe(before);
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
   * THE FIX — A9.7B. This test previously asserted TWO recomputations: one for
   * the first read, one forced by a write to a table the corpus does not read.
   * The detector is now `corpusRevisionToken`, which is maintained by triggers
   * on `colleges`, `roster_players` and `recruiting_arrivals` alone, so the
   * tracking write no longer invalidates anything.
   *
   * Measured end to end on the 313 MB corpus: 895.2 ms -> 9.2 ms.
   */
  it('P3. ONE unrelated write no longer forces a recomputation', () => {
    clearCorpusDigestCache();
    const start = corpusDigestCacheStats();
    cachedCorpusDigests(db);          // the only recomputation
    write();
    cachedCorpusDigests(db);          // hit: the corpus did not move
    cachedCorpusDigests(db);          // hit
    const stats = corpusDigestCacheStats();
    expect(stats.recomputations - start.recomputations).toBe(1);
    expect(stats.hits - start.hits).toBe(2);
  });

  /**
   * AND THE DEFECT'S MECHANISM IS STILL TRUE OF THE OLD TOKEN, which is why
   * the token had to be replaced rather than the cache re-tuned. Kept so that
   * reverting the detector cannot quietly pass this suite.
   */
  it('P3b. the OLD broad token still moves on an unrelated write', () => {
    const before = corpusChangeToken(db);
    write();
    expect(corpusChangeToken(db)).not.toBe(before);
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
