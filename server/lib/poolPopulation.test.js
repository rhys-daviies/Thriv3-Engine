import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * L7ZC — what PROGRAMME_POOL_BENCHMARK says its pool was.
 *
 * `comparison.poolSize` used to be `buildPoolBenchmarks().programmes`: every
 * programme with ANY row in the historical window, counted before
 * `freshmanProfile` decided whether a freshman ladder could be read. The
 * quantiles behind the band came from a strictly smaller set — the programmes
 * that produced a ladder. On the live corpus the claim reported 1,202 for a
 * pool of 1,045 in women's soccer and 920 for 770 in men's, on all 3,355
 * canonical claims, while its own basis string already said "programmes with a
 * readable freshman ladder".
 *
 * These tests fix the meaning rather than the number. Every assertion below is
 * about a fixture whose readable and unreadable programmes are constructed
 * deliberately, so nothing here depends on the live population — the live
 * counts are data and move with every import.
 *
 * WHAT IS NOT TESTED HERE, because L7ZC did not touch it: the cohort, the
 * season window, the quantile function, the bands, division and association
 * pooling, self-inclusion. `poolBenchmarkSemantics.test.js` owns those.
 */

const COLS = ['college_name', 'sport', 'division', 'season', 'player_name',
  'class_year_label', 'position', 'minutes_played', 'games_played', 'games_started',
  'estimated_graduation_year', 'eligibility_end_year', 'conference'];

let tmp; let db; let philosophyQueries; let philosophy; let philosophyEvidence;
let SEASONS; let SQUAD_SEASON;

/**
 * One programme's historical rows.
 *
 * `freshmanMinutes` is what the rank-1 median is computed from. `measured`
 * decides READABILITY: `freshmanProfile` keeps a season only when at least
 * MIN_MEASURED_SHARE of its intake carries a minutes figure, so a programme
 * whose freshmen are mostly unrecorded has rows but no ladder. That is the
 * distinction this file exists to pin, so it is a parameter rather than a
 * fixed shape.
 *
 *   freshmen  how many first-years per season
 *   measured  how many of them carry a minutes figure (rest are NULL)
 */
function programme(db_, {
  name, sport, division = 'NCAA D1', freshmanMinutes, seasons,
  freshmen = 8, measured = 8,
}) {
  const ins = db_.prepare(`INSERT INTO roster_players (id, created_date, updated_date, ${COLS.join(', ')})
    VALUES (?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ${COLS.map(() => '?').join(', ')})`);
  let i = 0;
  const POS = ['MIDFIELD', 'DEFENSE', 'FORWARD', 'GOALKEEPER'];
  for (const season of seasons) {
    for (let f = 0; f < freshmen; f += 1) {
      i += 1;
      // Minutes descend so rank 1 is the figure the test names, and NULL for
      // the unmeasured tail. A NULL minutes column is exactly how an
      // unreadable roster reaches the database.
      const mins = f < measured ? Math.max(1, freshmanMinutes - f * 10) : null;
      ins.run(`${name}-${season}-f${i}`, name, sport, division, season, `${name} F${i}`,
        'Fr.', POS[f % 4], mins, mins === null ? null : 18, mins === null ? null : 16,
        Number(season) + 4, Number(season) + 4, 'Test Conf');
    }
    // Upperclassmen, always measured. They are the squad the freshman share is
    // taken against and they are never part of the ladder.
    for (const [cls, mins] of [['So.', 1400], ['Jr.', 1500], ['Sr.', 1600], ['Sr.', 1550]]) {
      i += 1;
      ins.run(`${name}-${season}-u${i}`, name, sport, division, season, `${name} U${i}`,
        cls, POS[i % 4], mins, 18, 16, Number(season) + 1, Number(season) + 1, 'Test Conf');
    }
  }
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l7zc-'));
  process.env.RECRUITMATCH_DB = path.join(tmp, 'pool.sqlite');
  db = (await import('../db/client.js')).default;
  philosophyQueries = await import('./philosophyQueries.js');
  philosophy = await import('../../shared/philosophy.js');
  philosophyEvidence = await import('../../shared/evidence/philosophyEvidence.js');
  ({ SEASONS, SQUAD_SEASON } = philosophy);
  db.prepare('DELETE FROM roster_players').run();

  /*
   * WOMEN'S: five programmes with historical rows, three of them readable.
   *
   * The two unreadable ones fail for different reasons, and Phase 9 of the
   * brief asks for both to be distinguishable:
   *
   *   WREAD1/2/3   full intake, all measured        -> in the pool
   *   WUNREAD      full intake, 2 of 8 measured     -> rows, no readable ladder
   *   WNOMINUTES   full intake, none measured       -> rows, no minutes at all
   *
   * A sixth programme has no first-year rows at all and so contributes no
   * intake to read; it is counted separately below because it is not even a
   * candidate for the ladder.
   */
  programme(db, { name: 'WREAD1', sport: 'womens-soccer', freshmanMinutes: 600, seasons: SEASONS });
  programme(db, { name: 'WREAD2', sport: 'womens-soccer', freshmanMinutes: 1200, seasons: SEASONS });
  programme(db, { name: 'WREAD3', sport: 'womens-soccer', freshmanMinutes: 1800, seasons: SEASONS });
  programme(db, {
    name: 'WUNREAD', sport: 'womens-soccer', freshmanMinutes: 2400, seasons: SEASONS,
    freshmen: 8, measured: 2,
  });
  programme(db, {
    name: 'WNOMINUTES', sport: 'womens-soccer', freshmanMinutes: 2400, seasons: SEASONS,
    freshmen: 8, measured: 0,
  });

  /*
   * MEN'S: a different exclusion proportion on purpose — four programmes with
   * rows, two readable — so a claim cannot pass by reporting the other sport's
   * number or a shared constant.
   */
  programme(db, { name: 'MREAD1', sport: 'mens-soccer', freshmanMinutes: 500, seasons: SEASONS });
  programme(db, { name: 'MREAD2', sport: 'mens-soccer', freshmanMinutes: 1500, seasons: SEASONS });
  programme(db, {
    name: 'MUNREAD1', sport: 'mens-soccer', freshmanMinutes: 900, seasons: SEASONS,
    freshmen: 8, measured: 1,
  });
  programme(db, {
    name: 'MUNREAD2', sport: 'mens-soccer', freshmanMinutes: 2900, seasons: SEASONS,
    freshmen: 8, measured: 0,
  });
});

afterAll(() => {
  delete process.env.RECRUITMATCH_DB;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const pool = (sport) => philosophyQueries.buildPoolBenchmarks(sport);
const rank1 = (sport) => (pool(sport).ladderByRank ?? []).find((r) => r.rank === 1);
const rowsFor = (name, sport) => db.prepare(
  'SELECT * FROM roster_players WHERE college_name = ? AND sport = ?',
).all(name, sport).map((r) => ({ ...r, season: String(r.season) }));

/** The claim the product would build for `name`, through the real generator. */
function claimFor(name, sport) {
  const ph = philosophy.programmePhilosophy({ rows: rowsFor(name, sport), coachRows: [] });
  return philosophyEvidence.programmePoolBenchmark(
    { full_name: 'Fixture Athlete', sport },
    { philosophy: ph, benchmarks: pool(sport) },
  );
}

/* -------------------------------------------------------------------------- */

describe('L7ZC — the fixture separates having rows from being readable', () => {
  it('five women\'s programmes have historical rows; three enter the quantiles', () => {
    const b = pool('womens-soccer');
    expect(b.programmes).toBe(5);        // every programme with ANY row
    expect(rank1('womens-soccer').n).toBe(3);  // the medians the quantiles used
  });

  it('the three readable medians are the ones the quantiles are taken from', () => {
    /*
     * Named explicitly so a change to the quantile function or the cohort
     * fails HERE rather than shifting quietly underneath the poolSize
     * assertions below. 600, 1200 and 1800 are the readable programmes'
     * rank-1 minutes; 2400 belongs to the two unreadable ones and must not
     * appear in any of the three thresholds.
     */
    const r = rank1('womens-soccer');
    expect([r.p25, r.median, r.p75]).toEqual([600, 1200, 1800]);
  });
});

describe('L7ZC — comparison.poolSize is the population the claim was ranked within', () => {
  it('reports 3, not 5', () => {
    const c = claimFor('WREAD2', 'womens-soccer');
    expect(c).not.toBeNull();
    expect(c.comparison.poolSize).toBe(3);
    expect(c.comparison.poolSize).not.toBe(5);
  });

  it('equals data.pool.n, which is the array the quantiles came from', () => {
    for (const name of ['WREAD1', 'WREAD2', 'WREAD3']) {
      const c = claimFor(name, 'womens-soccer');
      expect(c.comparison.poolSize).toBe(c.data.pool.n);
    }
  });

  it('keeps the broader count, under a name that says what it counts', () => {
    // The any-rows figure is still available. It was not deleted, it was moved
    // out of a field whose contract is the comparison population.
    const c = claimFor('WREAD2', 'womens-soccer');
    expect(c.data.poolProgrammes).toBe(5);
    expect(c.comparison.poolSize).toBe(3);
  });

  it('and the basis string it sits beside now describes the same set', () => {
    const c = claimFor('WREAD2', 'womens-soccer');
    expect(c.comparison.basis).toContain('readable freshman ladder');
    expect(c.comparison.poolSize).toBe(rank1('womens-soccer').n);
  });
});

describe('L7ZC — the statistic is untouched by the metadata correction', () => {
  it('nothing but poolSize differs from the same claim built the old way', () => {
    /*
     * THE IMMUNITY PROOF, at fixture scale and by construction rather than by
     * inspection: take the claim, substitute the pre-L7ZC value back into
     * `poolSize` alone, and walk both objects for every differing JSON path.
     * If the correction had reached the measurement, the band or a threshold,
     * this walk would name it.
     */
    const c = claimFor('WREAD2', 'womens-soccer');
    const old = JSON.parse(JSON.stringify(c));
    old.comparison.poolSize = pool('womens-soccer').programmes;   // 5, the old source
    expect(old.comparison.poolSize).toBe(5);

    const differing = [];
    const walk = (x, y, p) => {
      if (JSON.stringify(x) === JSON.stringify(y)) return;
      if (x && y && typeof x === 'object' && typeof y === 'object'
          && Array.isArray(x) === Array.isArray(y)) {
        for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
          walk(x[k], y[k], `${p}.${Array.isArray(x) ? '[]' : k}`);
        }
        return;
      }
      differing.push(p);
    };
    walk(JSON.parse(JSON.stringify(c)), old, '$');
    expect(differing).toEqual(['$.comparison.poolSize']);
  });

  it('the band and the quartiles are what the pool independently says', () => {
    const c = claimFor('WREAD1', 'womens-soccer');
    const r = rank1('womens-soccer');
    expect(c.data.pool).toEqual({ rank: 1, n: r.n, p25: r.p25, median: r.median, p75: r.p75 });
    // WREAD1's own median is 600, which IS p25, and the band test is `<=`.
    expect(c.data.programmeMedian).toBe(600);
    expect(c.comparison.band).toBe('at-or-below-p25');
  });

  it('the top programme in the pool still reads at the top band it did', () => {
    // WREAD3's median IS p75, and `bandOf` tests `<=`, so the top of a
    // three-programme pool lands in median-to-p75 rather than above it. Pinned
    // as the band the corrected claim carries, unchanged by L7ZC.
    const c = claimFor('WREAD3', 'womens-soccer');
    expect(c.data.programmeMedian).toBe(1800);
    expect(c.comparison.band).toBe('median-to-p75');
  });
});

describe('L7ZC — each pool reports its own population', () => {
  it('men\'s and women\'s claims carry different, correct sizes', () => {
    const w = claimFor('WREAD2', 'womens-soccer');
    const m = claimFor('MREAD2', 'mens-soccer');
    expect(w.comparison.poolSize).toBe(3);
    expect(m.comparison.poolSize).toBe(2);
    expect(w.comparison.poolSize).not.toBe(m.comparison.poolSize);
  });

  it('and the exclusion proportion differs between them, as the fixture intends', () => {
    // Women's: 3 of 5 readable. Men's: 2 of 4. Neither ratio is shared, so a
    // claim reporting the wrong sport's number cannot pass.
    expect([pool('womens-soccer').programmes, rank1('womens-soccer').n]).toEqual([5, 3]);
    expect([pool('mens-soccer').programmes, rank1('mens-soccer').n]).toEqual([4, 2]);
  });

  it('the men\'s claim never reports the women\'s population', () => {
    const m = claimFor('MREAD1', 'mens-soccer');
    expect(m.comparison.poolSize).not.toBe(3);
    expect(m.comparison.poolSize).not.toBe(5);
    expect(m.comparison.poolSize).toBe(rank1('mens-soccer').n);
  });
});

describe('L7ZC — programmes that never entered the quantiles do not inflate poolSize', () => {
  it('a programme with rows but an unread ladder is counted in neither', () => {
    /*
     * WUNREAD has a full eight-player intake in all four seasons and a minutes
     * figure for two of them, which is below MIN_MEASURED_SHARE. Its rank-1
     * minutes are 2400 — higher than every readable programme — so if it were
     * entering the pool it would move p75 and be impossible to miss.
     */
    expect(rank1('womens-soccer').p75).toBe(1800);
    expect(claimFor('WUNREAD', 'womens-soccer')).toBeNull();
    expect(claimFor('WREAD2', 'womens-soccer').comparison.poolSize).toBe(3);
  });

  it('a programme with no minutes at all is counted in neither', () => {
    expect(claimFor('WNOMINUTES', 'womens-soccer')).toBeNull();
    // Still one of the five `programmes`, which is the point: presence in the
    // dataset is not membership in the comparison.
    expect(pool('womens-soccer').programmes).toBe(5);
  });

  it('a programme with no first-year observation is counted in neither', () => {
    /*
     * No 'Fr.' rows at all, so there is no intake to read rather than an
     * intake that cannot be read. A different cause from the two above and the
     * same requirement: it may not appear in a size the claim reports.
     */
    programme(db, {
      name: 'WNOFRESH', sport: 'womens-soccer', freshmanMinutes: 2400,
      seasons: SEASONS, freshmen: 0, measured: 0,
    });
    const b = pool('womens-soccer');
    expect(b.programmes).toBe(6);                       // it has rows
    expect(rank1('womens-soccer').n).toBe(3);           // and no ladder
    expect(claimFor('WREAD2', 'womens-soccer').comparison.poolSize).toBe(3);
    expect(claimFor('WNOFRESH', 'womens-soccer')).toBeNull();
    db.prepare('DELETE FROM roster_players WHERE college_name = ?').run('WNOFRESH');
  });

  it('a programme whose only rows are in the squad season is counted in neither', () => {
    // The season window is L7ZA's, unchanged here. Included so the poolSize
    // contract is stated against every way a programme can be outside the
    // comparison, not only unreadability.
    programme(db, {
      name: 'WCURRENT', sport: 'womens-soccer', freshmanMinutes: 2400,
      seasons: [SQUAD_SEASON],
    });
    expect(pool('womens-soccer').programmes).toBe(5);   // not even in the any-rows count
    expect(rank1('womens-soccer').n).toBe(3);
    expect(claimFor('WREAD2', 'womens-soccer').comparison.poolSize).toBe(3);
    db.prepare('DELETE FROM roster_players WHERE college_name = ?').run('WCURRENT');
  });

  it('their readability rules are exercised, not relaxed', () => {
    /*
     * The three exclusions above are the product's own rules doing their job.
     * L7ZC changed no threshold, so this pins the mechanism rather than the
     * outcome: making WUNREAD's intake majority-measured must put it in the
     * pool, which is the proof the exclusion was about the data and not about
     * the programme.
     */
    const before = rank1('womens-soccer').n;
    db.exec('BEGIN');
    db.prepare(
      `UPDATE roster_players SET minutes_played = 2400, games_played = 18, games_started = 16
       WHERE college_name = 'WUNREAD' AND class_year_label = 'Fr.' AND minutes_played IS NULL`,
    ).run();
    const after = rank1('womens-soccer');
    const claim = claimFor('WREAD2', 'womens-soccer');
    db.exec('ROLLBACK');
    expect(after.n).toBe(before + 1);
    expect(claim.comparison.poolSize).toBe(before + 1);
    expect(rank1('womens-soccer').n).toBe(before);
  });
});
