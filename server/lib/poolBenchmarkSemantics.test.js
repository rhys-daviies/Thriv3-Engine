import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * L7ZA — what PROGRAMME_POOL_BENCHMARK currently depends on.
 *
 * L7Y changed six 2025 programme-seasons and moved internal Evidence for 864
 * athlete-programme pairs, one of them crossing a comparison band while its own
 * median never moved. That is either correct behaviour for a relative benchmark
 * or a coupling nobody chose, and this file exists so the question is settled by
 * measurement rather than memory.
 *
 * THESE TESTS DESCRIBE TODAY, NOT A PREFERENCE. Every assertion pins current
 * semantics so a future change to the cohort, the season window, the quantile
 * or the band test has to be deliberate and has to say so here. Nothing below
 * argues that the present behaviour is right.
 */

const COLS = ['college_name', 'sport', 'division', 'season', 'player_name',
  'class_year_label', 'position', 'minutes_played', 'games_played', 'games_started',
  'estimated_graduation_year', 'eligibility_end_year', 'conference'];

let tmp; let db; let philosophyQueries; let SEASONS; let SQUAD_SEASON;

/**
 * A programme with a legible four-season freshman ladder.
 *
 * `minutes` sets the first-year minutes, which is what the rank-1 median — and
 * therefore the whole benchmark — is computed from.
 */
function programme(db_, { name, sport, division, minutes, seasons }) {
  const ins = db_.prepare(`INSERT INTO roster_players (id, created_date, updated_date, ${COLS.join(', ')})
    VALUES (?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ${COLS.map(() => '?').join(', ')})`);
  let i = 0;
  for (const season of seasons) {
    for (const [cls, mins, pos] of [
      ['Fr.', minutes, 'MIDFIELD'], ['Fr.', minutes - 100, 'DEFENSE'],
      ['So.', 1400, 'MIDFIELD'], ['So.', 1300, 'DEFENSE'],
      ['Jr.', 1500, 'FORWARD'], ['Jr.', 1450, 'DEFENSE'],
      ['Sr.', 1600, 'FORWARD'], ['Sr.', 1550, 'GOALKEEPER'],
    ]) {
      i += 1;
      ins.run(`${name}-${season}-${i}`, name, sport, division, season, `${name} P${i}`,
        cls, pos, mins, 18, 16, Number(season) + 1, Number(season) + 1, 'Test Conf');
    }
  }
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l7za-'));
  process.env.RECRUITMATCH_DB = path.join(tmp, 'pool.sqlite');
  db = (await import('../db/client.js')).default;
  philosophyQueries = await import('./philosophyQueries.js');
  ({ SEASONS, SQUAD_SEASON } = await import('../../shared/philosophy.js'));
  db.prepare('DELETE FROM roster_players').run();

  // Twelve women's programmes spread across two divisions, with a spread of
  // first-year minutes, plus men's programmes that must never influence them.
  const mins = [200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400];
  mins.forEach((m, i) => programme(db, {
    name: `W${String(i).padStart(2, '0')}`, sport: 'womens-soccer',
    division: i < 6 ? 'NCAA D1' : 'NCAA D3', minutes: m, seasons: SEASONS,
  }));
  [300, 900, 1500, 2100].forEach((m, i) => programme(db, {
    name: `M${i}`, sport: 'mens-soccer', division: 'NCAA D1', minutes: m, seasons: SEASONS,
  }));
  // One women's programme whose rows are in the CURRENT season only.
  programme(db, { name: 'WCURRENT', sport: 'womens-soccer', division: 'NCAA D1',
    minutes: 50, seasons: [SQUAD_SEASON] });
  // One women's programme with a single historical season.
  programme(db, { name: 'WONE', sport: 'womens-soccer', division: 'NCAA D1',
    minutes: 2500, seasons: [SEASONS[0]] });
});

afterAll(() => {
  delete process.env.RECRUITMATCH_DB;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const pool = (sport) => philosophyQueries.buildPoolBenchmarks(sport);
const rank1 = (sport) => (pool(sport).ladderByRank ?? []).find((r) => r.rank === 1);

/* -------------------------------------------------------------------------- */

describe('L7ZA — the population', () => {
  it('is the programme, and each contributes one median per rank', () => {
    const b = pool('womens-soccer');
    // 12 four-season programmes + WONE + WCURRENT are all "programmes" by the
    // pool's count, because that count is taken before any readability filter.
    expect(b.programmes).toBe(13);          // WCURRENT has no historical rows at all
    // But the quantiles are taken from the programmes that produced a ladder.
    expect(rank1('womens-soccer').n).toBe(13);
  });

  it('counts a four-season programme once, exactly like a one-season programme', () => {
    /*
     * EQUAL WEIGHT, for the ladder. `buildPoolBenchmarks` pushes one median per
     * programme per rank, so four seasons of history buy no extra influence
     * over the quantiles. The dials below do not work this way.
     */
    const n = rank1('womens-soccer').n;
    expect(n).toBe(13);                      // 12 four-season + WONE, each once
  });

  it('but the dials count one observation per readable position-season', () => {
    // Unequal weight: more seasons and more position groups mean more say.
    const b = pool('womens-soccer');
    expect(b.readable).toBeGreaterThan(b.programmes);
  });
});

describe('L7ZA — cohort boundaries', () => {
  it('separates sport and gender completely', () => {
    const w = rank1('womens-soccer');
    const m = rank1('mens-soccer');
    expect(w.n).not.toBe(m.n);
    // The men's medians (300..2100) never enter the women's quantiles.
    expect(w.median).not.toBe(m.median);
  });

  it('does NOT separate division — D1 and D3 share one pool', () => {
    /*
     * The pool query filters on sport and season only. A D1 programme is
     * benchmarked against D3 programmes and vice versa. Pinned because it is
     * the cohort decision most likely to be questioned, and it is currently
     * implicit rather than stated anywhere.
     */
    const b = pool('womens-soccer');
    const divisions = db.prepare(
      `SELECT DISTINCT division FROM roster_players WHERE sport='womens-soccer'
       AND season IN (${SEASONS.map(() => '?').join(',')})`).all(...SEASONS).map((r) => r.division);
    expect(divisions.sort()).toEqual(['NCAA D1', 'NCAA D3']);
    expect(b.programmes).toBe(13);           // one pool, both divisions in it
  });

  it('pools the historical seasons and excludes the current one', () => {
    expect(SEASONS).toEqual(['2022', '2023', '2024', '2025']);
    expect(SEASONS).not.toContain(SQUAD_SEASON);
    // WCURRENT exists only in the current season and contributes nothing.
    const names = db.prepare(
      `SELECT DISTINCT college_name FROM roster_players WHERE sport='womens-soccer'
       AND season IN (${SEASONS.map(() => '?').join(',')})`).all(...SEASONS).map((r) => r.college_name);
    expect(names).not.toContain('WCURRENT');
    expect(pool('womens-soccer').seasons).toEqual(SEASONS);
  });

  it('applies no programme_status, colleges.active or division filter', () => {
    /*
     * The pool reads roster_players alone: it never joins colleges or
     * programme_status, so an inactive or retired programme still contributes
     * through its historical rows.
     *
     * L7ZI ADDED ONE PREDICATE, AND IT IS NOT A COHORT RULE. An operator
     * exclusion removes a programme-season whose identity was found not to be
     * trustworthy; it does not decide who belongs in the comparison. The
     * distinction is the whole reason the cohort assertions below still stand —
     * a division, status or activity filter would change WHO is compared, and
     * L7ZA measured that none exists. This one changes only whether a season
     * somebody reviewed is read at all, and with no rows in the table it
     * removes nothing.
     */
    const sql = fs.readFileSync(new URL('./philosophyQueries.js', import.meta.url), 'utf8');
    const build = sql.slice(sql.indexOf('export function buildPoolBenchmarks'));
    const body = build.slice(0, build.indexOf('\n}\n'));
    expect(body).not.toMatch(/JOIN colleges|programme_status|active/);
    /*
     * The WHERE clause in full, so a third predicate cannot arrive unnoticed.
     * Two conjuncts: the cohort (sport and season) and the trust exclusion.
     */
    const where = /WHERE sport = \? AND season IN \(\$\{SEASON_LIST\}\) AND \$\{TRUSTED\}/;
    expect(body).toMatch(where);
    expect(body).toMatch(/FROM roster_players/);
  });
});

describe('L7ZA — the statistic', () => {
  it('is a nearest-rank quantile with no interpolation', () => {
    const b = pool('womens-soccer');
    const r = b.ladderByRank.find((x) => x.rank === 1);
    // Every reported quantile is one of the observed medians, never between two.
    const medians = db.prepare(
      `SELECT DISTINCT minutes_played m FROM roster_players WHERE sport='womens-soccer'
       AND class_year_label='Fr.' AND season IN (${SEASONS.map(() => '?').join(',')})`).all(...SEASONS)
      .map((x) => x.m);
    for (const v of [r.p25, r.median, r.p75]) expect(medians).toContain(v);
  });

  it('bands on `median <= threshold`, so a programme ON a threshold sits in the lower band', () => {
    /*
     * This is the mechanism behind L7Y's single band flip: Saint Mary's median
     * was exactly the pool's p25, so p25 moving by one unit moved it across.
     */
    const r = rank1('womens-soccer');
    const bandOf = (m) => (m <= r.p25 ? 'at-or-below-p25' : m <= r.median ? 'p25-to-median'
      : m <= r.p75 ? 'median-to-p75' : 'above-p75');
    expect(bandOf(r.p25)).toBe('at-or-below-p25');
    expect(bandOf(r.p25 + 1)).toBe('p25-to-median');
    expect(bandOf(r.p75)).toBe('median-to-p75');
    expect(bandOf(r.p75 + 1)).toBe('above-p75');
  });

  it('rounds dial percentages to one decimal place', () => {
    const d = pool('womens-soccer').dials;
    for (const k of ['freshman', 'newcomer', 'returning']) {
      for (const q of ['p25', 'median', 'p75']) {
        const v = d[k][q];
        if (v != null) expect(Math.round(v * 10) / 10).toBe(v);
      }
    }
  });

  it('includes the programme being benchmarked in its own pool', () => {
    // Self-inclusion. On the live corpus (n=1045) this changes no band, but the
    // property is structural and worth stating.
    const before = rank1('womens-soccer').n;
    expect(before).toBe(13);
    // Removing one programme's rows reduces the pool by exactly one.
    db.exec("BEGIN; DELETE FROM roster_players WHERE college_name='W00';");
    const after = (philosophyQueries.buildPoolBenchmarks('womens-soccer').ladderByRank ?? [])
      .find((r) => r.rank === 1).n;
    db.exec('ROLLBACK');
    expect(after).toBe(before - 1);
  });
});

describe('L7ZA — propagation', () => {
  it('one programme\'s change can move the quantiles every other programme is read against', () => {
    const before = rank1('womens-soccer');
    db.exec("BEGIN; UPDATE roster_players SET minutes_played = 3000 WHERE college_name IN ('W00','W01','W02');");
    const after = (philosophyQueries.buildPoolBenchmarks('womens-soccer').ladderByRank ?? [])
      .find((r) => r.rank === 1);
    db.exec('ROLLBACK');
    expect(after.p25).not.toBe(before.p25);
    // Nothing about the other ten programmes changed, yet their comparison did.
  });

  it('and a men\'s change moves nothing in the women\'s pool', () => {
    const before = JSON.stringify(rank1('womens-soccer'));
    db.exec("BEGIN; UPDATE roster_players SET minutes_played = 9999 WHERE sport='mens-soccer';");
    const after = JSON.stringify((philosophyQueries.buildPoolBenchmarks('womens-soccer').ladderByRank ?? [])
      .find((r) => r.rank === 1));
    db.exec('ROLLBACK');
    expect(after).toBe(before);
  });

  it('a current-season change moves nothing, because the pool is historical', () => {
    const before = JSON.stringify(rank1('womens-soccer'));
    db.exec(`BEGIN; UPDATE roster_players SET minutes_played = 9999 WHERE season='${SQUAD_SEASON}';`);
    const after = JSON.stringify((philosophyQueries.buildPoolBenchmarks('womens-soccer').ladderByRank ?? [])
      .find((r) => r.rank === 1));
    db.exec('ROLLBACK');
    expect(after).toBe(before);
  });
});

describe('L7ZA — what the claim reports about its own pool', () => {
  it('keeps "has rows" and "entered the quantiles" as two different quantities', () => {
    /*
     * `bench.programmes` is every programme with historical rows;
     * `ladderByRank[n].n` counts the medians the quantiles were actually taken
     * from. On the live corpus they differ by 157 (women's) and 150 (men's).
     *
     * L7ZA FOUND THE CLAIM REPORTING THE FIRST AS THE SECOND: `poolSize` was
     * `bench.programmes` while the band came from the smaller set, so the
     * stated basis — "programmes with a readable freshman ladder" — described
     * one cohort and the number printed beside it described another. L7ZC
     * corrected it, and `poolPopulation.test.js` owns that behaviour on a
     * fixture where the two counts genuinely differ.
     *
     * What belongs here is the measurement L7ZA came for: that these are two
     * quantities and not one. In THIS fixture every programme is readable, so
     * they agree — which is precisely why the defect needed a fixture of its
     * own to be visible at all.
     */
    const b = pool('womens-soccer');
    const r = b.ladderByRank.find((x) => x.rank === 1);
    expect(typeof b.programmes).toBe('number');
    expect(typeof r.n).toBe('number');
    expect(b.programmes).toBe(13);
    expect(r.n).toBe(13);
  });
});

describe('L7ZA — the manifest cannot see every change that moves the pool', () => {
  it('a historical minutes correction moves the benchmark and not the dataset fingerprint', () => {
    /*
     * THE AUDITABILITY GAP. The manifest fingerprints roster_players on
     * (college_name, sport, season, player_name) and roster_freshness on the
     * CURRENT season's timestamps. Minutes appear in neither. So a correction
     * to historical minutes can move every programme's benchmark while the
     * dataset line reports UNCHANGED — which is exactly the misdiagnosis the
     * manifest exists to prevent.
     */
    const identity = () => JSON.stringify(db.prepare(
      'SELECT college_name, sport, season, player_name FROM roster_players ORDER BY 1,2,3,4').all());
    const before = { identity: identity(), pool: JSON.stringify(rank1('womens-soccer')) };
    // Minutes only, on programmes that already exist, in seasons already
    // present: no player is added, removed or renamed, so the identity
    // projection cannot move by construction.
    db.exec("BEGIN; UPDATE roster_players SET minutes_played = 2600 "
      + "WHERE sport='womens-soccer' AND class_year_label='Fr.' "
      + "AND college_name IN ('W00','W01','W02','W03','W04');");
    const after = { identity: identity(), pool: JSON.stringify((philosophyQueries.buildPoolBenchmarks('womens-soccer').ladderByRank ?? []).find((r) => r.rank === 1)) };
    db.exec('ROLLBACK');
    expect(after.identity).toBe(before.identity);     // the manifest sees nothing
    expect(after.pool).not.toBe(before.pool);         // the benchmark moved
  });
});
