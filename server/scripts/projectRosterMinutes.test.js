import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { projectMinutes } from './projectRosterMinutes.js';

/**
 * THE FAILURE THIS FILE EXISTS FOR, AND WHY IT WAS INVISIBLE.
 *
 * `projectMinutes` used to wipe `projected_minutes`, `projected_minutes_season`
 * and `prior_programme`, then rebuild them in two further write units. A
 * process that died in between left the 2026 season with every projection
 * NULL — and nothing anywhere went red. `isStarter` reads a missing projection
 * as "not a starter", so every departure quietly dropped from a starter at
 * weight 1 to a squad player at 0.4, at all 1,166 programmes at once, and the
 * ranking still looked entirely reasonable.
 *
 * It happened three times during the A5.x work. Twice nobody noticed until a
 * baseline probe refused to write.
 *
 * So the test is not "does the rebuild produce projections" — that was always
 * true on a happy path. It is "can an interrupted rebuild commit the cleared
 * state", and the answer has to be no.
 *
 * The interruption is injected by handing `projectMinutes` a database wrapper
 * whose rebuild statement throws, rather than by killing a subprocess: a test
 * that races a SIGKILL would be the flakiest file in the suite, and the thing
 * under test is the transaction boundary rather than the signal.
 */

/** Two seasons: one played with minutes, one in progress with none. */
function seed() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE roster_players (
      id TEXT PRIMARY KEY, college_name TEXT, sport TEXT, season TEXT,
      player_name TEXT, minutes_played INTEGER,
      projected_minutes INTEGER, projected_minutes_season TEXT,
      prior_programme TEXT, estimated_graduation_year INTEGER
    );
  `);
  const add = db.prepare(`INSERT INTO roster_players
    (id, college_name, sport, season, player_name, minutes_played, projected_minutes, projected_minutes_season, prior_programme, estimated_graduation_year)
    VALUES (@id, @college, 'mens-soccer', @season, @name, @minutes, @proj, @projSeason, @prior, 2028)`);
  // Played season — the source the projection is carried forward from.
  add.run({ id: 'p1', college: 'A', season: '2025', name: 'Kept Player', minutes: 1500, proj: null, projSeason: null, prior: null });
  add.run({ id: 'p2', college: 'A', season: '2025', name: 'Moved Player', minutes: 900, proj: null, projSeason: null, prior: null });
  // Season in progress — no minutes, and carrying a PREVIOUS successful run's
  // output, which is exactly what an interrupted rerun would destroy.
  add.run({ id: 'c1', college: 'A', season: '2026', name: 'Kept Player', minutes: null, proj: 1500, projSeason: '2025', prior: 'A' });
  add.run({ id: 'c2', college: 'B', season: '2026', name: 'Moved Player', minutes: null, proj: 900, projSeason: '2025', prior: 'A' });
  return db;
}

const stateOf = (db) => db.prepare(
  `SELECT COUNT(projected_minutes) proj, COUNT(prior_programme) prior FROM roster_players WHERE season = '2026'`,
).get();

/**
 * A database that behaves normally until the rebuild statement is prepared,
 * and then throws when it is run. `projectMinutes` only reaches for `prepare`
 * and `transaction`, so forwarding those two is the whole wrapper.
 */
function failingAfterClear(db) {
  return {
    prepare(sql) {
      if (sql.includes('SET projected_minutes = (')) {
        return { run() { throw new Error('killed mid-rebuild'); } };
      }
      return db.prepare(sql);
    },
    transaction(fn) { return db.transaction(fn); },
  };
}

describe('projectMinutes', () => {
  it('carries the prior season forward on a clean run', () => {
    const db = seed();
    const { changes, source } = projectMinutes(db, { season: '2026' });
    expect(source).toBe('2025');
    // One projection, not two: Moved Player changed programmes, and a
    // transfer's minutes are deliberately never carried across. Both players
    // are still LOCATED on the 2025 roster, so both get a prior programme.
    expect(changes).toBe(1);
    expect(stateOf(db)).toEqual({ proj: 1, prior: 2 });
    db.close();
  });

  it('does not carry a transfer\'s minutes across programmes', () => {
    const db = seed();
    projectMinutes(db, { season: '2026' });
    // Moved Player was at A in 2025 and is at B in 2026. Their prior programme
    // is recorded, their minutes are not carried forward.
    const moved = db.prepare("SELECT * FROM roster_players WHERE id = 'c2'").get();
    expect(moved.prior_programme).toBe('A');
    expect(moved.projected_minutes).toBeNull();
    db.close();
  });

  /** The regression. */
  it('cannot commit the cleared state when the rebuild is interrupted', () => {
    const db = seed();
    expect(stateOf(db)).toEqual({ proj: 2, prior: 2 });

    expect(() => projectMinutes(failingAfterClear(db), { season: '2026' }))
      .toThrow(/killed mid-rebuild/);

    // The clear ran inside the same transaction as the rebuild, so it rolled
    // back with it. Before the fix this read { proj: 0, prior: 0 } and every
    // departure in the product silently became a squad player.
    expect(stateOf(db)).toEqual({ proj: 2, prior: 2 });
    db.close();
  });

  it('leaves other seasons untouched whether it succeeds or fails', () => {
    const db = seed();
    const before = db.prepare("SELECT COUNT(*) n, SUM(minutes_played) m FROM roster_players WHERE season = '2025'").get();
    projectMinutes(db, { season: '2026' });
    try { projectMinutes(failingAfterClear(db), { season: '2026' }); } catch { /* expected */ }
    expect(db.prepare("SELECT COUNT(*) n, SUM(minutes_played) m FROM roster_players WHERE season = '2025'").get()).toEqual(before);
    db.close();
  });

  it('refuses a season that is not on file rather than clearing anything', () => {
    const db = seed();
    expect(() => projectMinutes(db, { season: '2099' })).toThrow(/not in roster_players/);
    expect(stateOf(db)).toEqual({ proj: 2, prior: 2 });
    db.close();
  });
});
