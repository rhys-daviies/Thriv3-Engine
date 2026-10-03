/**
 * =============================================================================
 * THE CORPUS-DIGEST CACHE — A9.4.
 *
 * A cache in front of an identity is only worth having if it is impossible for
 * it to answer "unchanged" about a corpus that changed. That is the ONE
 * failure these tests exist for: a stale false-negative would report a moved
 * corpus as current, and a consultant would keep acting on rankings the
 * evidence no longer supports — silently, and indefinitely.
 *
 * So every assertion below is paired. A write that MUST invalidate is checked
 * alongside a write that must NOT change the answer, because a cache that
 * never caches passes every invalidation test ever written.
 * =============================================================================
 */
import {
  describe, it, expect, beforeAll, afterAll, beforeEach,
} from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import db from '../../db/client.js';
import { migrate } from '../../db/migrate.js';
import { Player } from '../../db/entities/player.js';
import { seedPool, SEASON } from './seedTestPool.js';
import { computeMatchmakingV2, clearContextCache } from './matchmakingService.js';
import { persistRun, currentRun, runStaleness, STALE_REASON } from './matchmakingRuns.js';
import {
  corpusDigests, cachedCorpusDigests, clearCorpusDigestCache, corpusDigestCacheStats,
} from './corpusIdentity.js';
import { UNIVERSE } from './validationUniverse.js';
import { corpusChangeToken } from '../../db/corpusIdentity.js';

const created = [];
let player;
let runRow;

function athlete(extra = {}) {
  const row = Player.create({
    full_name: `A9.4 ${created.length}`,
    sport: 'mens-soccer',
    position: 'Midfielder',
    football_ability: 6,
    recruiting_class_year: 2028,
    state: 'CA',
    origin: 'USA',
    contribution_state: 'STATED',
    max_annual_contribution_usd: 25000,
    ...extra,
  });
  created.push(row.id);
  return Player.get(row.id);
}

beforeAll(() => {
  seedPool('mens-soccer');
  seedPool('womens-soccer');
  clearContextCache();
  player = athlete();
  persistRun(db, player, computeMatchmakingV2(db, player));
  runRow = currentRun(db, player.id);
});

afterAll(() => { for (const id of created) db.prepare('DELETE FROM players WHERE id = ?').run(id); });

beforeEach(() => { clearCorpusDigestCache(); });

const recomputes = () => corpusDigestCacheStats().recomputations;
const supported = (d) => d[UNIVERSE.SUPPORTED].digest;
const corpusChanged = () => runStaleness(db, player, runRow).reasons.includes(STALE_REASON.CORPUS_CHANGED);

/* ------------------------------------------------------------------ */
/* It is the same identity                                            */
/* ------------------------------------------------------------------ */

describe('C1. the cache returns the identity, not an approximation of it', () => {
  it('agrees with uncached corpusDigests, field for field, on both universes', () => {
    const direct = corpusDigests(db);
    const cached = cachedCorpusDigests(db);
    expect(cached).toEqual(direct);
    /** Including the counts, which are part of the provenance, not decoration. */
    expect(cached[UNIVERSE.SUPPORTED].colleges).toBe(direct[UNIVERSE.SUPPORTED].colleges);
    expect(cached[UNIVERSE.UNSUPPORTED].digest).toBe(direct[UNIVERSE.UNSUPPORTED].digest);
  });

  it('keeps corpus identity GLOBAL over both sports, exactly as the accepted contract has it', () => {
    /**
     * Not sport-specific, and deliberately not changed here. `corpusDigests`
     * iterates both sports into one digest per universe, so a men's-soccer run
     * is stale when women's roster data moves. A9.4 is a cache; narrowing the
     * identity to one sport would change which runs go stale, which is a
     * semantics change wearing a performance change's clothes.
     */
    const before = supported(cachedCorpusDigests(db));
    db.prepare(`UPDATE roster_players SET minutes_played = minutes_played + 1
                 WHERE sport = 'womens-soccer' AND season = ? AND id = 'r-womens-soccer-0-0'`).run(SEASON);
    clearCorpusDigestCache();
    expect(supported(cachedCorpusDigests(db))).not.toBe(before);
    db.prepare(`UPDATE roster_players SET minutes_played = minutes_played - 1
                 WHERE id = 'r-womens-soccer-0-0'`).run();
  });
});

/* ------------------------------------------------------------------ */
/* D1-D8: the invalidation matrix                                     */
/* ------------------------------------------------------------------ */

describe('C2. invalidation', () => {
  it('D1. no writes: computed once, then never again', () => {
    const first = cachedCorpusDigests(db);
    expect(recomputes()).toBe(1);
    for (let i = 0; i < 10; i += 1) expect(cachedCorpusDigests(db)).toEqual(first);
    expect(recomputes()).toBe(1);
    expect(corpusDigestCacheStats().hits).toBe(10);
  });

  it('D2. an UNRELATED write re-verifies and finds the corpus unchanged', () => {
    /**
     * THE 7B CASE, which is the whole reason the token is not the identity.
     * `coaches` is written continuously by Phase 7B and V2 reads none of it.
     * The token moves, the digest is recomputed, and the answer must be that
     * nothing V2 can see has changed.
     */
    const before = supported(cachedCorpusDigests(db));
    expect(corpusChanged()).toBe(false);
    const was = recomputes();

    db.prepare(`INSERT INTO coaches (id, created_at, full_name, school, division, sport)
                VALUES ('a94-coach-1', ?, 'A Coach', 'Seed M0', 'NCAA D1', 'mens-soccer')`)
      .run(new Date().toISOString());

    expect(recomputes()).toBe(was);          // not yet — nobody has asked
    expect(supported(cachedCorpusDigests(db))).toBe(before);
    expect(recomputes()).toBe(was + 1);      // the token moved, so it re-verified
    expect(corpusChanged()).toBe(false);     // and nothing V2 reads had moved

    db.prepare("DELETE FROM coaches WHERE id = 'a94-coach-1'").run();
  });

  it('D3. a supported ROSTER write invalidates and marks the run stale', () => {
    expect(corpusChanged()).toBe(false);
    const before = supported(cachedCorpusDigests(db));

    db.prepare(`UPDATE roster_players SET minutes_played = minutes_played + 7
                 WHERE id = 'r-mens-soccer-0-0'`).run();

    expect(supported(cachedCorpusDigests(db))).not.toBe(before);
    expect(corpusChanged()).toBe(true);

    db.prepare(`UPDATE roster_players SET minutes_played = minutes_played - 7
                 WHERE id = 'r-mens-soccer-0-0'`).run();
    clearCorpusDigestCache();
    expect(supported(cachedCorpusDigests(db))).toBe(before);
    expect(corpusChanged()).toBe(false);
  });

  it('D4. a supported COLLEGE write invalidates and marks the run stale', () => {
    expect(corpusChanged()).toBe(false);
    const before = supported(cachedCorpusDigests(db));

    db.prepare("UPDATE colleges SET net_price = net_price + 500 WHERE id = 'c-mens-soccer-0'").run();

    expect(supported(cachedCorpusDigests(db))).not.toBe(before);
    expect(corpusChanged()).toBe(true);

    db.prepare("UPDATE colleges SET net_price = net_price - 500 WHERE id = 'c-mens-soccer-0'").run();
    clearCorpusDigestCache();
    expect(corpusChanged()).toBe(false);
  });

  it('D5. a recruiting_arrivals write invalidates and marks the run stale', () => {
    expect(corpusChanged()).toBe(false);
    const before = supported(cachedCorpusDigests(db));

    db.prepare(`INSERT INTO recruiting_arrivals
      (programme, sport, arrival_season, prior_season, source_transition, roster_row_id,
       player_name, name_key, arrival_confidence, identity_method, canonical_position,
       is_international, entry_type, prior_confidence, coach_attribution, built_at)
      VALUES ('Seed M0','mens-soccer','2025','2024','a94','r-mens-soccer-0-11',
              'A94 Arrival','a94 arrival','DIRECT','EXACT','MIDFIELD',0,'FRESHMAN','DIRECT','UNKNOWN',?)`)
      .run(new Date().toISOString());

    expect(supported(cachedCorpusDigests(db))).not.toBe(before);
    expect(corpusChanged()).toBe(true);

    db.prepare("DELETE FROM recruiting_arrivals WHERE player_name = 'A94 Arrival'").run();
    clearCorpusDigestCache();
    expect(corpusChanged()).toBe(false);
  });

  it('D6. an OPPOSITE-SPORT relevant write still invalidates, because identity is global', () => {
    expect(corpusChanged()).toBe(false);
    db.prepare("UPDATE colleges SET net_price = net_price + 500 WHERE id = 'c-womens-soccer-0'").run();
    expect(corpusChanged()).toBe(true);

    db.prepare("UPDATE colleges SET net_price = net_price - 500 WHERE id = 'c-womens-soccer-0'").run();
    clearCorpusDigestCache();
    expect(corpusChanged()).toBe(false);
  });

  it('D7. repeated current-run staleness checks cost ONE computation', () => {
    expect(recomputes()).toBe(0);
    for (let i = 0; i < 25; i += 1) runStaleness(db, player, runRow);
    expect(recomputes()).toBe(1);
    expect(corpusDigestCacheStats().hits).toBe(24);
  });

  it('D8. clearing the cache forces a recomputation and returns the same answer', () => {
    const before = supported(cachedCorpusDigests(db));
    expect(recomputes()).toBe(1);
    clearCorpusDigestCache();
    expect(recomputes()).toBe(0);
    expect(supported(cachedCorpusDigests(db))).toBe(before);
    expect(recomputes()).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* The connection key                                                 */
/* ------------------------------------------------------------------ */

describe('C3. one process, two databases', () => {
  it('D9. two connections with the SAME token are not served each other\u2019s digest', () => {
    /**
     * THE COLLISION IS REAL, AND THE FIRST VERSION OF THIS TEST MISSED IT.
     *
     * It originally compared the shared test database against a fresh one.
     * That passes whether or not the cache is keyed on the connection, because
     * the shared database has thousands of writes behind it and its token
     * could never match a new one — so the test proved nothing about the key.
     *
     * `total_changes()` RESETS when a connection opens, and `data_version` on a
     * fresh in-memory database is 1. Two freshly-migrated databases therefore
     * both report EXACTLY `1:0`, measured. Give them one write each and they
     * both report `1:1` while holding completely different corpora.
     *
     * That is the stale false-negative this key exists to make impossible: a
     * cache keyed on the season alone hands the second database the first
     * one's identity and calls it a hit.
     */
    const schema = fs.readFileSync(path.resolve(process.cwd(), 'server/db/schema.sql'), 'utf-8');
    const make = (name) => {
      const d = new Database(':memory:');
      d.exec(schema);
      migrate(d);
      const now = new Date().toISOString();
      d.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active)
                 VALUES ('only-one', ?, ?, ?, 'mens-soccer', 'NCAA D1', 1)`).run(now, now, name);
      return d;
    };
    const alpha = make('Alpha College');
    const beta = make('Beta College');

    /** The premise, asserted rather than assumed. */
    expect(corpusChangeToken(alpha)).toBe(corpusChangeToken(beta));

    const a = supported(cachedCorpusDigests(alpha));
    const b = supported(cachedCorpusDigests(beta));

    expect(a).not.toBe(b);
    /** And each remains itself on a second call, rather than one overwriting the other. */
    expect(supported(cachedCorpusDigests(alpha))).toBe(a);
    expect(supported(cachedCorpusDigests(beta))).toBe(b);

    alpha.close();
    beta.close();
  });
});

/* ------------------------------------------------------------------ */
/* The guard can fail                                                 */
/* ------------------------------------------------------------------ */

describe('C4. the invalidation guard is capable of failing', () => {
  it('D10. a cache that ignored the token WOULD be caught by these tests', () => {
    /**
     * Proven here rather than asserted in a commit message. This reproduces
     * the exact defect — answer from the first call forever — and shows the
     * check that catches it, so the suite above cannot quietly become a test
     * of nothing if the real implementation regresses.
     */
    let frozen = null;
    const neverInvalidates = () => {
      if (frozen === null) frozen = corpusDigests(db);
      return frozen;
    };

    const before = supported(neverInvalidates());
    db.prepare("UPDATE colleges SET net_price = net_price + 500 WHERE id = 'c-mens-soccer-1'").run();

    /** The broken cache says nothing moved... */
    expect(supported(neverInvalidates())).toBe(before);
    /** ...while the truth, and the real cache, both say it did. */
    expect(supported(corpusDigests(db))).not.toBe(before);
    expect(supported(cachedCorpusDigests(db))).not.toBe(before);

    db.prepare("UPDATE colleges SET net_price = net_price - 500 WHERE id = 'c-mens-soccer-1'").run();
  });

  it('D11. the token moves for every write type these tests rely on', () => {
    const moves = (label, write, undo) => {
      const before = corpusChangeToken(db);
      write();
      expect(corpusChangeToken(db), label).not.toBe(before);
      undo();
    };
    moves('colleges',
      () => db.prepare("UPDATE colleges SET net_price = net_price + 1 WHERE id = 'c-mens-soccer-2'").run(),
      () => db.prepare("UPDATE colleges SET net_price = net_price - 1 WHERE id = 'c-mens-soccer-2'").run());
    moves('roster_players',
      () => db.prepare("UPDATE roster_players SET minutes_played = minutes_played + 1 WHERE id = 'r-mens-soccer-2-0'").run(),
      () => db.prepare("UPDATE roster_players SET minutes_played = minutes_played - 1 WHERE id = 'r-mens-soccer-2-0'").run());
    moves('coaches (unrelated)',
      () => db.prepare(`INSERT INTO coaches (id, created_at, full_name, school, division, sport)
                        VALUES ('a94-coach-2', ?, 'B Coach', 'Seed M1', 'NCAA D1', 'mens-soccer')`)
        .run(new Date().toISOString()),
      () => db.prepare("DELETE FROM coaches WHERE id = 'a94-coach-2'").run());
  });
});
