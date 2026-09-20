import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * L7ZB — the dataset line must be able to explain a behavioural movement.
 *
 * L7ZA changed 1,762 historical rows' `minutes_played` and nothing else, and
 * watched PROGRAMME_POOL_BENCHMARK move while both roster manifest components
 * reported UNCHANGED. `roster_players` projects membership
 * — (college_name, sport, season, player_name) — and `roster_freshness` watches
 * the current season's timestamps; a historical measurement is in neither.
 *
 * The contract these tests pin has two halves, and the second matters as much
 * as the first: the measurement component must move for everything an Evidence
 * generator can read, and must NOT move for anything it cannot. A manifest that
 * flapped on provenance writes would be ignored within a month, which is the
 * failure mode K3A's note describes for the two surfaces that hashed a
 * timestamp.
 */

const COLS = ['college_name', 'sport', 'division', 'season', 'player_name',
  'class_year_label', 'position', 'minutes_played', 'games_played', 'games_started',
  'estimated_graduation_year', 'eligibility_end_year', 'conference', 'nationality',
  'hometown', 'country', 'source_roster_url', 'source_stats_url', 'data_confidence',
  'notes', 'source_page_season', 'source_fetched_at', 'source_parser'];

let tmp; let db; let M;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l7zb-'));
  process.env.RECRUITMATCH_DB = path.join(tmp, 'manifest.sqlite');
  db = (await import('../db/client.js')).default;
  M = await import('./evidenceBaseline.js');
});
afterAll(() => { delete process.env.RECRUITMATCH_DB; fs.rmSync(tmp, { recursive: true, force: true }); });

const insert = (over = {}) => {
  const row = {
    college_name: 'School A', sport: 'womens-soccer', division: 'NCAA D1', season: '2024',
    player_name: 'Ada Lovelace', class_year_label: 'Fr.', position: 'MIDFIELD',
    minutes_played: 900, games_played: 18, games_started: 16,
    estimated_graduation_year: 2027, eligibility_end_year: 2027, conference: 'Test Conf',
    nationality: 'United States', hometown: 'Somewhere, ST', country: 'United States',
    source_roster_url: 'https://a.test/roster/2024', source_stats_url: '',
    data_confidence: 'high', notes: '', source_page_season: '2024',
    source_fetched_at: '2026-01-01T00:00:00Z', source_parser: 'table', ...over,
  };
  db.prepare(`INSERT INTO roster_players (id, created_date, updated_date, ${COLS.join(', ')})
    VALUES (@id, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ${COLS.map((c) => `@${c}`).join(', ')})`)
    .run({ id: over.id ?? `id-${row.player_name}-${row.season}-${row.college_name}`, ...row });
};

beforeEach(() => {
  db.prepare('DELETE FROM roster_players').run();
  insert();
  insert({ id: 'b', player_name: 'Grace Hopper', minutes_played: 400, position: 'DEFENSE' });
  insert({ id: 'c', college_name: 'School B', player_name: 'Radia Perlman', minutes_played: 1200 });
});

const measure = () => M.rosterMeasurementFingerprint().digest;
const identity = () => {
  const d = M.datasetManifest();
  return d.tables.find((t) => t.table === 'roster_players').digest;
};
const freshness = () => M.rosterFreshnessFingerprint().digest;

/** Change one column on one row and report what each component did. */
function mutate(sql, params = []) {
  const before = { measure: measure(), identity: identity(), freshness: freshness() };
  db.prepare(sql).run(...params);
  const after = { measure: measure(), identity: identity(), freshness: freshness() };
  return {
    measurementMoved: before.measure !== after.measure,
    identityMoved: before.identity !== after.identity,
    freshnessMoved: before.freshness !== after.freshness,
  };
}

/* -------------------------------------------------------------------------- */

describe('L7ZB — the version', () => {
  it('is V6, and V4 is nameable as the legacy pin', () => {
    // L7ZB introduced roster_measurements at V4; L7ZI added roster_season_trust
    // at V5; L7ZQ added coach_seasons and recruiting_arrivals at V6. This
    // file's subject is the measurement component, present at all of them --
    // what moves here is only the number the definition carries.
    expect(M.MANIFEST_VERSION).toBe('V6');
    expect(M.LEGACY_MANIFEST_VERSION).toBe('V4');
  });

  it('carries roster_measurements beside roster_players, not instead of it', () => {
    /*
     * Split rather than replace. "The squad changed" and "the same squad,
     * measured differently" are different events with different causes, and a
     * single digest covering both would answer neither.
     */
    const names = M.datasetManifest().tables.map((t) => t.table);
    expect(names).toContain('roster_players');
    expect(names).toContain('roster_measurements');
    expect(names).toContain('roster_freshness');
  });
});

describe('L7ZB — the blind spot, before and after', () => {
  it('a historical minutes-only change moves the measurement component', () => {
    /*
     * THE REGRESSION TEST. This is the exact shape of the L7ZA finding: no
     * player added, removed or renamed, so membership cannot move — and under
     * V3 nothing moved at all.
     */
    const r = mutate("UPDATE roster_players SET minutes_played = 1500 WHERE id = 'b'");
    expect(r.measurementMoved).toBe(true);
    expect(r.identityMoved).toBe(false);      // membership is genuinely unchanged
    expect(r.freshnessMoved).toBe(false);     // and it is not the current season
  });

  it('and the V3 projection alone still cannot see it', () => {
    // Proving the gap was real rather than asserting it: the old projection,
    // run directly, is blind to the same change.
    const v3 = () => JSON.stringify(db.prepare(
      'SELECT college_name, sport, season, player_name FROM roster_players ORDER BY 1,2,3,4').all());
    const before = v3();
    db.prepare("UPDATE roster_players SET minutes_played = 1500 WHERE id = 'b'").run();
    expect(v3()).toBe(before);
  });
});

describe('L7ZB — every behavioural field moves it', () => {
  const cases = [
    ['player added', "INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division, season, player_name, position, minutes_played) VALUES ('new','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','School A','womens-soccer','NCAA D1','2024','New Player','FORWARD',300)", true],
    ['player removed', "DELETE FROM roster_players WHERE id = 'b'", true],
    ['player renamed', "UPDATE roster_players SET player_name = 'Renamed' WHERE id = 'b'", true],
    ['position', "UPDATE roster_players SET position = 'FORWARD' WHERE id = 'b'", true],
    ['class year', "UPDATE roster_players SET class_year_label = 'So.' WHERE id = 'b'", true],
    ['minutes', "UPDATE roster_players SET minutes_played = 111 WHERE id = 'b'", true],
    ['games played', "UPDATE roster_players SET games_played = 3 WHERE id = 'b'", true],
    ['games started', "UPDATE roster_players SET games_started = 2 WHERE id = 'b'", true],
    ['season', "UPDATE roster_players SET season = '2023' WHERE id = 'b'", true],
    ['programme', "UPDATE roster_players SET college_name = 'School C' WHERE id = 'b'", true],
    ['sport', "UPDATE roster_players SET sport = 'mens-soccer' WHERE id = 'b'", true],
    ['estimated graduation year', "UPDATE roster_players SET estimated_graduation_year = 2030 WHERE id = 'b'", true],
    ['eligibility end year', "UPDATE roster_players SET eligibility_end_year = 2030 WHERE id = 'b'", true],
    ['projected minutes', "UPDATE roster_players SET projected_minutes = 700 WHERE id = 'b'", true],
    ['nationality', "UPDATE roster_players SET nationality = 'Canada' WHERE id = 'b'", true],
    ['country', "UPDATE roster_players SET country = 'Canada' WHERE id = 'b'", true],
    ['hometown', "UPDATE roster_players SET hometown = 'Elsewhere' WHERE id = 'b'", true],
    ['prior programme', "UPDATE roster_players SET prior_programme = 'School Z' WHERE id = 'b'", true],
    // A URL, but a behavioural one: rosterSourceFor resolves the operator's
    // verification link from it and reports AMBIGUOUS_SOURCE on more than one.
    ['source roster URL', "UPDATE roster_players SET source_roster_url = 'https://a.test/other' WHERE id = 'b'", true],
  ];
  for (const [name, sql, expected] of cases) {
    it(`${name} -> measurement component ${expected ? 'MOVES' : 'unchanged'}`, () => {
      expect(mutate(sql).measurementMoved).toBe(expected);
    });
  }
});

describe('L7ZB — nothing else moves it', () => {
  /*
   * The false-positive half of the contract. Each of these is a real
   * maintenance event the pipeline performs, and none is readable by any
   * Evidence generator: they are absent from ROSTER_COLUMNS, the single
   * projection through which philosophyQueries loads roster rows.
   */
  const cases = [
    ['source_page_season only (L7Z provenance)', "UPDATE roster_players SET source_page_season = '2099' WHERE id = 'b'"],
    ['source_fetched_at only (L7Z provenance)', "UPDATE roster_players SET source_fetched_at = '2099-01-01T00:00:00Z' WHERE id = 'b'"],
    ['source_parser only (L7Z provenance)', "UPDATE roster_players SET source_parser = 'nuxt' WHERE id = 'b'"],
    ['source_stats_url only', "UPDATE roster_players SET source_stats_url = 'https://a.test/stats' WHERE id = 'b'"],
    ['data_confidence only', "UPDATE roster_players SET data_confidence = 'low' WHERE id = 'b'"],
    ['notes only', "UPDATE roster_players SET notes = 'a note' WHERE id = 'b'"],
    ['updated_date only (a re-import re-stamps every row)', "UPDATE roster_players SET updated_date = '2099-01-01T00:00:00Z'"],
    ['created_date only', "UPDATE roster_players SET created_date = '2099-01-01T00:00:00Z' WHERE id = 'b'"],
    ['division only', "UPDATE roster_players SET division = 'NCAA D3' WHERE id = 'b'"],
    ['conference only', "UPDATE roster_players SET conference = 'Other Conf' WHERE id = 'b'"],
  ];
  for (const [name, sql] of cases) {
    it(`${name} -> measurement component unchanged`, () => {
      expect(mutate(sql).measurementMoved).toBe(false);
    });
  }
});

describe('L7ZB — canonicalisation does not invent movement', () => {
  it('a numeric stored as text hashes the same as the number', () => {
    const before = measure();
    db.prepare("UPDATE roster_players SET minutes_played = '400' WHERE id = 'b'").run();
    expect(measure()).toBe(before);
    db.prepare("UPDATE roster_players SET minutes_played = '400.0' WHERE id = 'b'").run();
    expect(measure()).toBe(before);
  });

  it('an empty string and NULL are the same absence', () => {
    db.prepare("UPDATE roster_players SET hometown = NULL WHERE id = 'b'").run();
    const withNull = measure();
    db.prepare("UPDATE roster_players SET hometown = '' WHERE id = 'b'").run();
    expect(measure()).toBe(withNull);
  });

  it('but zero is a value, not an absence', () => {
    db.prepare("UPDATE roster_players SET minutes_played = NULL WHERE id = 'b'").run();
    const absent = measure();
    db.prepare("UPDATE roster_players SET minutes_played = 0 WHERE id = 'b'").run();
    expect(measure()).not.toBe(absent);
  });

  it('is independent of the order the database returns rows in', () => {
    const before = measure();
    // Re-insert the same three rows in a different physical order.
    const rows = db.prepare('SELECT * FROM roster_players').all();
    db.prepare('DELETE FROM roster_players').run();
    const cols = Object.keys(rows[0]);
    const stmt = db.prepare(`INSERT INTO roster_players (${cols.join(', ')})
      VALUES (${cols.map((c) => `@${c}`).join(', ')})`);
    for (const r of rows.reverse()) stmt.run(r);
    expect(measure()).toBe(before);
  });

  it('two identical player names in one programme-season stay distinguishable', () => {
    const before = measure();
    insert({ id: 'dup', player_name: 'Ada Lovelace', minutes_played: 77 });
    expect(measure()).not.toBe(before);
  });
});

describe('L7ZB — the field list matches what Evidence can actually read', () => {
  it('is ROSTER_COLUMNS minus updated_date', () => {
    /*
     * The boundary argument, pinned. philosophyQueries loads roster rows through
     * exactly one projection, so a column absent from it cannot reach any
     * generator. If ROSTER_COLUMNS gains a field, this test fails and the
     * manifest has to be told about it.
     */
    const src = fs.readFileSync(new URL('./philosophyQueries.js', import.meta.url), 'utf8');
    const decl = src.slice(src.indexOf('const ROSTER_COLUMNS'), src.indexOf('`;', src.indexOf('const ROSTER_COLUMNS')));
    const cols = decl.slice(decl.indexOf('`') + 1).split(',').map((s) => s.trim()).filter(Boolean);
    const expected = cols.filter((c) => c !== 'updated_date').sort();
    expect([...M.ROSTER_MEASUREMENT_FIELDS].sort()).toEqual(expected);
  });

  it('excludes updated_date, which roster_freshness already owns', () => {
    expect(M.ROSTER_MEASUREMENT_FIELDS).not.toContain('updated_date');
  });
});
