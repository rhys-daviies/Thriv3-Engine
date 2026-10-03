/**
 * =============================================================================
 * THE CORPUS REVISION DETECTOR — A9.7B §E, §F, §J, §K, §O.
 *
 * A9.7 measured a cache gate that invalidated on every write in the database:
 * `runs/current` went from 9.6 ms to 895 ms after one tracking pixel, and the
 * authoritative digest came back IDENTICAL every time.
 *
 * This suite asserts the replacement in both directions, and the directions
 * are NOT equally important. A false positive costs one recomputation. A false
 * negative serves a corpus identity that has already moved - a run reported
 * fresh when the roster underneath it changed - and nothing downstream could
 * detect it. Every test here that asserts invalidation is load-bearing; the
 * ones that assert the absence of it are the performance fix.
 * =============================================================================
 */
import {
  describe, it, expect, beforeAll, afterAll, beforeEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import db from '../../db/client.js';
import { migrate } from '../../db/migrate.js';
import {
  corpusRevisionToken, corpusChangeToken, CORPUS_TABLES, resetCorpusRevisionProbe,
} from '../../db/corpusIdentity.js';
import {
  cachedCorpusDigests, corpusDigests, clearCorpusDigestCache, corpusDigestCacheStats,
} from './corpusIdentity.js';
import { poolContextFor, clearContextCache, contextCacheState } from './matchmakingService.js';
import { seedPool } from './seedTestPool.js';

const SCHEMA = fs.readFileSync(path.resolve(process.cwd(), 'server/db/schema.sql'), 'utf-8');
const temps = [];

function fileDatabase() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'a97b-')), 'corpus.sqlite');
  temps.push(file);
  const d = new Database(file);
  d.pragma('journal_mode = WAL');
  d.exec(SCHEMA);
  migrate(d);
  return { file, d };
}

function memoryDatabase() {
  const d = new Database(':memory:');
  d.exec(SCHEMA);
  migrate(d);
  return d;
}

const now = () => new Date().toISOString();
const revisionOf = (database) => database
  .prepare('SELECT revision FROM corpus_revision WHERE id = 1').pluck().get();

/** A college row with every NOT NULL column satisfied. */
function addCollege(database, name, extra = {}) {
  insertRow(database, 'colleges', {
    id: extra.id ?? randomUUID(),
    created_date: now(),
    updated_date: now(),
    name,
    sport: extra.sport ?? 'mens-soccer',
    division: extra.division ?? 'NCAA D1',
    active: 1,
  });
}

/**
 * Insert a row with every NOT NULL column satisfied, derived from the schema
 * rather than listed by hand.
 *
 * Written after three separate fixtures failed one NOT NULL at a time -
 * `created_date`, then `division`, then `prior_season`. These tables carry
 * fourteen required columns between them and none of them is what any test
 * here is about.
 */
function insertRow(database, table, overrides = {}) {
  const info = database.prepare(`PRAGMA table_info(${table})`).all();
  const cols = [];
  const values = [];
  for (const c of info) {
    if (c.name in overrides) { cols.push(c.name); values.push(overrides[c.name]); continue; }
    if (c.pk && /INTEGER/i.test(c.type)) continue;      // rowid alias
    if (!c.notnull || c.dflt_value !== null) continue;  // nullable or defaulted
    cols.push(c.name);
    values.push(/INT|REAL|NUM/i.test(c.type) ? 0 : `a97b-${c.name}`);
  }
  database.prepare(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
  ).run(...values);
}

beforeAll(() => {
  seedPool('mens-soccer', { count: 40 });
  seedPool('womens-soccer', { count: 20 });
});

afterAll(() => {
  for (const f of temps) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(f + suffix, { force: true }); } catch { /* already gone */ }
    }
  }
});

beforeEach(() => {
  clearCorpusDigestCache();
  clearContextCache();
  resetCorpusRevisionProbe();
});

/* ------------------------------------------------------------------ */
/* B. The dependency set, re-derived and pinned                        */
/* ------------------------------------------------------------------ */

describe('A9.7B §B. the corpus depends on exactly three tables', () => {
  it('B1. CORPUS_TABLES matches what buildPoolContext and corpusDigests read', () => {
    expect([...CORPUS_TABLES].sort())
      .toEqual(['colleges', 'recruiting_arrivals', 'roster_players']);

    /**
     * Matched against CODE, not prose. The first version of this scanned the
     * whole file and picked up the word "the" out of a sentence beginning
     * "FROM the ..." - the same trap `campaigns.test.js` documents.
     */
    const poolSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'server/lib/v2/poolContext.js'), 'utf-8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const read = new Set(
      [...poolSrc.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()),
    );
    expect([...read].sort()).toEqual([...CORPUS_TABLES].sort());
  });

  it('B2. a trigger exists for every table and every operation', () => {
    const triggers = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_corpus_rev_%'",
    ).all().map((r) => r.name);
    expect(triggers).toHaveLength(CORPUS_TABLES.length * 3);
    for (const op of ['insert', 'update', 'delete']) {
      expect(triggers.filter((n) => n.endsWith(op))).toHaveLength(CORPUS_TABLES.length);
    }
  });

  it('B3. the revision table holds exactly one row, by constraint', () => {
    const d = memoryDatabase();
    expect(d.prepare('SELECT COUNT(*) n FROM corpus_revision').pluck().get()).toBe(1);
    expect(() => d.prepare('INSERT INTO corpus_revision (id, revision) VALUES (2, 0)').run())
      .toThrow(/CHECK constraint/i);
    d.close();
  });
});

/* ------------------------------------------------------------------ */
/* J. The invalidation matrix                                          */
/* ------------------------------------------------------------------ */

describe('A9.7B §J. irrelevant writes do not move the detector', () => {
  const IRRELEVANT = [
    ['tracking_events', (d, p) => d.prepare(
      "INSERT INTO tracking_events (token, session_id, event_type, created_at) VALUES ('t','s','probe',?)",
    ).run(now())],
    ['recruiting_observations', (d, p) => d.prepare(`INSERT INTO recruiting_observations
      (id, athlete_id, college_name, sport, kind, source, classifier_method, review_state, observed_at, recorded_at)
      VALUES (?, ?, 'X', 'mens-soccer', 'POSITIVE_REPLY', 'COACH_REPLY', 'MANUAL', 'CONFIRMED', ?, ?)`)
      .run(randomUUID(), p, now(), now())],
    ['matchmaking_runs', (d, p) => insertRow(d, 'matchmaking_runs', {
      id: randomUUID(), player_id: p, sport: 'mens-soccer', computed_at: now(), created_at: now(),
    })],
    ['coaches', (d) => insertRow(d, 'coaches', {
      id: randomUUID(), created_at: now(), full_name: 'A97B Coach', school: 'Somewhere', sport: 'mens-soccer',
    })],
    ['players', (d) => insertRow(d, 'players', {
      id: randomUUID(), full_name: 'A97B Athlete', position: 'Midfielder',
      created_date: now(), updated_date: now(),
    })],
    ['campaigns', (d, p) => insertRow(d, 'campaigns', {
      id: randomUUID(), athlete_id: p, sport: 'mens-soccer', state: 'draft',
      starts_on: '2026-01-01', created_at: now(), updated_at: now(),
      snapshot_taken_at: now(), programme_count: 0,
    })],
  ];

  for (const [table, write] of IRRELEVANT) {
    it(`J-irrelevant. a write to ${table} leaves the token unchanged`, () => {
      const d = memoryDatabase();
      addCollege(d, 'Anchor College');
      const player = randomUUID();
      insertRow(d, 'players', {
        id: player, full_name: 'Anchor', position: 'Midfielder',
        created_date: now(), updated_date: now(),
      });

      const before = corpusRevisionToken(d);
      const broadBefore = corpusChangeToken(d);
      write(d, player);
      expect({ table, token: corpusRevisionToken(d) }).toEqual({ table, token: before });
      /** The premise: the OLD detector would have fired for every one of these. */
      expect({ table, broad: corpusChangeToken(d) }).not.toEqual({ table, broad: broadBefore });
      d.close();
    });
  }

  it('J1. a hundred irrelevant writes still cost zero recomputations', () => {
    const d = memoryDatabase();
    addCollege(d, 'Anchor College');
    const start = corpusDigestCacheStats();
    cachedCorpusDigests(d);
    for (let i = 0; i < 100; i += 1) {
      d.prepare("INSERT INTO tracking_events (token, session_id, event_type, created_at) VALUES ('t','s','p',?)")
        .run(now());
      cachedCorpusDigests(d);
    }
    const stats = corpusDigestCacheStats();
    expect(stats.recomputations - start.recomputations).toBe(1);
    expect(stats.hits - start.hits).toBe(100);
    d.close();
  });
});

describe('A9.7B §J. relevant writes always move the detector', () => {
  const RELEVANT = [
    ['colleges INSERT', (d) => addCollege(d, `New ${randomUUID()}`)],
    ['colleges UPDATE', (d) => d.prepare("UPDATE colleges SET latitude = 1.5 WHERE name = 'Anchor College'").run()],
    ['colleges DELETE', (d) => d.prepare("DELETE FROM colleges WHERE name = 'Anchor College'").run()],
    ['roster_players INSERT', (d) => insertRow(d, 'roster_players', {
      college_name: 'Anchor College', player_name: `P${randomUUID()}`, position: 'MIDFIELD',
      sport: 'mens-soccer', season: '2026', division: 'NCAA D1',
      created_date: now(), updated_date: now(),
    })],
    ['roster_players UPDATE', (d) => d.prepare("UPDATE roster_players SET position = 'FORWARD'").run()],
    ['roster_players DELETE', (d) => d.prepare('DELETE FROM roster_players').run()],
    ['recruiting_arrivals INSERT', (d) => insertRow(d, 'recruiting_arrivals', {
      programme: 'Anchor College', sport: 'mens-soccer', arrival_season: '2026',
      canonical_position: 'MIDFIELD', is_international: 0,
    })],
    ['recruiting_arrivals UPDATE', (d) => d.prepare("UPDATE recruiting_arrivals SET canonical_position = 'FORWARD'").run()],
    ['recruiting_arrivals DELETE', (d) => d.prepare('DELETE FROM recruiting_arrivals').run()],
  ];

  for (const [label, mutate] of RELEVANT) {
    it(`J-relevant. ${label} moves the token`, () => {
      const d = memoryDatabase();
      addCollege(d, 'Anchor College');
      cloneSeed(d);
      const before = corpusRevisionToken(d);
      mutate(d);
      expect({ label, token: corpusRevisionToken(d) }).not.toEqual({ label, token: before });
      d.close();
    });
  }

  /** Enough real rows that an UPDATE or DELETE has something to act on. */
  function cloneSeed(d) {
    insertRow(d, 'roster_players', {
      college_name: 'Anchor College', player_name: 'Seed Player', position: 'MIDFIELD',
      sport: 'mens-soccer', season: '2026', division: 'NCAA D1',
      created_date: now(), updated_date: now(),
    });
    insertRow(d, 'recruiting_arrivals', {
      programme: 'Anchor College', sport: 'mens-soccer', arrival_season: '2026',
      canonical_position: 'MIDFIELD', is_international: 0,
    });
  }

  it('J2. a no-op DELETE changes nothing and correctly does not invalidate', () => {
    const d = memoryDatabase();
    addCollege(d, 'Anchor College');
    const before = corpusRevisionToken(d);
    const info = d.prepare("DELETE FROM colleges WHERE name = 'No Such College'").run();
    expect(info.changes).toBe(0);
    expect(corpusRevisionToken(d)).toBe(before);
    d.close();
  });

  it('J3. interleaving does not lose a relevant write', () => {
    const d = memoryDatabase();
    addCollege(d, 'Anchor College');
    const t0 = corpusRevisionToken(d);

    d.prepare("INSERT INTO tracking_events (token, session_id, event_type, created_at) VALUES ('t','s','p',?)").run(now());
    expect(corpusRevisionToken(d)).toBe(t0);

    addCollege(d, 'Second College');
    const t1 = corpusRevisionToken(d);
    expect(t1).not.toBe(t0);

    d.prepare("INSERT INTO tracking_events (token, session_id, event_type, created_at) VALUES ('t','s','p',?)").run(now());
    expect(corpusRevisionToken(d)).toBe(t1);
    d.close();
  });
});

/* ------------------------------------------------------------------ */
/* E. Multi-connection and multi-process                               */
/* ------------------------------------------------------------------ */

describe('A9.7B §E. the detector crosses connections and processes', () => {
  it('E1. a relevant write on ANOTHER connection is seen by this one', () => {
    const { file, d: writer } = fileDatabase();
    const reader = new Database(file);
    addCollege(writer, 'Anchor College');

    const before = corpusRevisionToken(reader);
    addCollege(writer, 'Written Elsewhere');
    expect(corpusRevisionToken(reader)).not.toBe(before);

    reader.close();
    writer.close();
  });

  it('E2. an IRRELEVANT write on another connection does NOT invalidate', () => {
    const { file, d: writer } = fileDatabase();
    const reader = new Database(file);
    addCollege(writer, 'Anchor College');

    const before = corpusRevisionToken(reader);
    writer.prepare("INSERT INTO tracking_events (token, session_id, event_type, created_at) VALUES ('t','s','p',?)")
      .run(now());

    expect(corpusRevisionToken(reader)).toBe(before);
    /**
     * This is the case `data_version` could not express, and the reason it was
     * not reused: a worker process writing a tracking event would have
     * invalidated the server's cache, relocating the A9.7 defect rather than
     * fixing it.
     */
    reader.close();
    writer.close();
  });

  it('E3. a reopened connection reads the same revision — it is DB state, not connection state', () => {
    const { file, d } = fileDatabase();
    addCollege(d, 'Anchor College');
    const token = corpusRevisionToken(d);
    const revision = revisionOf(d);
    d.close();

    const reopened = new Database(file);
    expect(revisionOf(reopened)).toBe(revision);
    expect(corpusRevisionToken(reopened)).toBe(token);
    /**
     * `total_changes()` RESETS on open, so the old token could not do this -
     * which is exactly the connection-local trap A9.4 recorded.
     */
    reopened.close();
  });

  it('E4. two different databases at the same revision are never confused', () => {
    const alpha = memoryDatabase();
    const beta = memoryDatabase();
    addCollege(alpha, 'Alpha College');
    addCollege(beta, 'Beta College');

    /** The premise, asserted rather than assumed. */
    expect(corpusRevisionToken(alpha)).toBe(corpusRevisionToken(beta));

    const a = cachedCorpusDigests(alpha).SUPPORTED.digest;
    const b = cachedCorpusDigests(beta).SUPPORTED.digest;
    expect(a).not.toBe(b);
    expect(cachedCorpusDigests(alpha).SUPPORTED.digest).toBe(a);
    expect(cachedCorpusDigests(beta).SUPPORTED.digest).toBe(b);

    alpha.close();
    beta.close();
  });
});

/* ------------------------------------------------------------------ */
/* F. Transactions                                                     */
/* ------------------------------------------------------------------ */

describe('A9.7B §F. the revision obeys the transaction that moved it', () => {
  it('F1. a COMMITTED relevant write moves the revision', () => {
    const d = memoryDatabase();
    const before = revisionOf(d);
    d.transaction(() => addCollege(d, 'Committed College'))();
    expect(revisionOf(d)).toBeGreaterThan(before);
    d.close();
  });

  it('F2. a ROLLED-BACK relevant write leaves the revision where it was', () => {
    const d = memoryDatabase();
    addCollege(d, 'Anchor College');
    const before = revisionOf(d);
    const token = corpusRevisionToken(d);

    expect(() => d.transaction(() => {
      addCollege(d, 'Doomed College');
      throw new Error('rollback');
    })()).toThrow(/rollback/);

    expect(revisionOf(d)).toBe(before);
    expect(corpusRevisionToken(d)).toBe(token);
    expect(d.prepare("SELECT COUNT(*) n FROM colleges WHERE name = 'Doomed College'").pluck().get())
      .toBe(0);
    d.close();
  });

  it('F3. a rolled-back IRRELEVANT write also leaves it alone', () => {
    const d = memoryDatabase();
    addCollege(d, 'Anchor College');
    const token = corpusRevisionToken(d);
    expect(() => d.transaction(() => {
      d.prepare("INSERT INTO tracking_events (token, session_id, event_type, created_at) VALUES ('t','s','p',?)").run(now());
      throw new Error('rollback');
    })()).toThrow(/rollback/);
    expect(corpusRevisionToken(d)).toBe(token);
    d.close();
  });
});

/* ------------------------------------------------------------------ */
/* K. Digest correctness — the detector never changes the answer       */
/* ------------------------------------------------------------------ */

describe('A9.7B §K. the cached digest always equals a fresh one', () => {
  it('K1. after every relevant mutation, cached === uncached', () => {
    const d = memoryDatabase();
    addCollege(d, 'Anchor College');
    insertRow(d, 'roster_players', {
      college_name: 'Anchor College', player_name: 'Seed', position: 'MIDFIELD',
      sport: 'mens-soccer', season: '2026', division: 'NCAA D1',
      created_date: now(), updated_date: now(),
    });

    const mutations = [
      () => addCollege(d, `Extra ${randomUUID()}`),
      () => d.prepare("UPDATE colleges SET latitude = 9.9 WHERE name = 'Anchor College'").run(),
      () => d.prepare("UPDATE roster_players SET position = 'FORWARD'").run(),
      () => insertRow(d, 'recruiting_arrivals', {
        programme: 'Anchor College', sport: 'mens-soccer', arrival_season: '2026',
        canonical_position: 'MIDFIELD', is_international: 0,
      }),
      () => d.prepare('DELETE FROM roster_players').run(),
      () => d.prepare("DELETE FROM colleges WHERE name = 'Anchor College'").run(),
    ];

    for (const [i, mutate] of mutations.entries()) {
      mutate();
      const cached = cachedCorpusDigests(d);
      const fresh = corpusDigests(d);
      expect({ i, s: cached.SUPPORTED.digest }).toEqual({ i, s: fresh.SUPPORTED.digest });
      expect({ i, u: cached.UNSUPPORTED.digest }).toEqual({ i, u: fresh.UNSUPPORTED.digest });
    }
    d.close();
  });

  /**
   * §C's third case, which is the one a naive detector gets wrong in the
   * dangerous direction: a relevant write whose CONTENT leaves the digest
   * identical must still recompute, and must still report the same identity.
   */
  it('K2. a relevant write that does not change the content recomputes and agrees', () => {
    const d = memoryDatabase();
    addCollege(d, 'Anchor College');
    const first = cachedCorpusDigests(d).SUPPORTED.digest;
    const start = corpusDigestCacheStats().recomputations;

    // An UPDATE that writes the value already there.
    d.prepare("UPDATE colleges SET name = 'Anchor College' WHERE name = 'Anchor College'").run();

    const second = cachedCorpusDigests(d).SUPPORTED.digest;
    expect(corpusDigestCacheStats().recomputations - start).toBe(1);
    expect(second).toBe(first);
    expect(second).toBe(corpusDigests(d).SUPPORTED.digest);
    d.close();
  });

  it('K3. the detector fails safe when the machinery is missing', () => {
    const d = memoryDatabase();
    addCollege(d, 'Anchor College');
    resetCorpusRevisionProbe();

    for (const name of d.prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_corpus_rev_%'",
    ).all()) d.exec(`DROP TRIGGER ${name.name}`);

    const before = corpusRevisionToken(d);
    expect(before).toMatch(/^fallback:/);

    // And the fallback still detects a write, which is the whole point of it.
    addCollege(d, 'After Fallback');
    expect(corpusRevisionToken(d)).not.toBe(before);
    d.close();
  });

  it('K4. a deleted revision row falls back rather than freezing the token', () => {
    const d = memoryDatabase();
    addCollege(d, 'Anchor College');
    resetCorpusRevisionProbe();
    d.prepare('DELETE FROM corpus_revision WHERE id = 1').run();

    const token = corpusRevisionToken(d);
    expect(token).toMatch(/^fallback:/);
    addCollege(d, 'Another');
    expect(corpusRevisionToken(d)).not.toBe(token);
    d.close();
  });
});

/* ------------------------------------------------------------------ */
/* O. The pool context shares the gate                                 */
/* ------------------------------------------------------------------ */

describe('A9.7B §O. the pool context is not rebuilt by irrelevant writes', () => {
  it('O1. an irrelevant write rebuilds nothing and recomputes no digest', () => {
    clearContextCache();
    clearCorpusDigestCache();
    const first = poolContextFor(db, 'mens-soccer');
    expect(first.built).toBe(true);

    const start = corpusDigestCacheStats().recomputations;
    db.prepare("INSERT INTO tracking_events (token, session_id, event_type, created_at) VALUES ('t','s','p',?)")
      .run(now());

    const second = poolContextFor(db, 'mens-soccer');
    expect(second.built).toBe(false);
    expect(second.digestRecomputed).toBe(false);
    expect(corpusDigestCacheStats().recomputations - start).toBe(0);
    expect(second.corpusDigest).toBe(first.corpusDigest);
  });

  it('O2. a relevant write REBUILDS the context and moves the digest', () => {
    clearContextCache();
    clearCorpusDigestCache();
    const first = poolContextFor(db, 'mens-soccer');
    addCollege(db, `A97B Pool ${randomUUID()}`);

    const second = poolContextFor(db, 'mens-soccer');
    expect(second.built).toBe(true);
    expect(second.corpusDigest).not.toBe(first.corpusDigest);
    expect(second.ctx.colleges.length).toBe(first.ctx.colleges.length + 1);

    // And settles back to the warm path immediately afterwards.
    const third = poolContextFor(db, 'mens-soccer');
    expect(third.built).toBe(false);
    expect(third.corpusDigest).toBe(second.corpusDigest);
  });

  it('O3. one gate, not two — staleness and the context share a recomputation', () => {
    clearContextCache();
    clearCorpusDigestCache();
    poolContextFor(db, 'mens-soccer');
    addCollege(db, `A97B Shared ${randomUUID()}`);

    const start = corpusDigestCacheStats().recomputations;
    poolContextFor(db, 'mens-soccer');   // rebuilds, recomputes once
    cachedCorpusDigests(db);             // the staleness check, same answer
    cachedCorpusDigests(db);
    expect(corpusDigestCacheStats().recomputations - start).toBe(1);
    expect(contextCacheState().find((e) => e.sport === 'mens-soccer').changeToken)
      .toBe(corpusRevisionToken(db));
  });
});
