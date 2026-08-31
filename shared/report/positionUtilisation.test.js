/**
 * The report-facing half: pool scope, the position pool that never falls back
 * to another position, and the label this model refuses.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPositionUtilisationSummary, positionUtilisationFor, BANDING_REFUSED,
} from './positionUtilisation.js';
import { MIN_POOL_PROGRAMMES } from './squad.js';
import { buildLifecyclePool } from '../lifecycle/pool.js';
import { readableRows } from '../lifecycle/readable.js';
import { POSITION_NOT_SUPPORTED, SUPPORTED_POSITIONS } from '../lifecycle/positionUtilisation.js';
import { MEASURED_SEASONS } from '../lifecycle/utilisation.js';

const NAMES = 'abcdefghijklmnopqrstuvwxyz'.split('');
const nameFor = (i) => `${NAMES[i % 26]}${NAMES[Math.floor(i / 26) % 26]}`;
const seasonLetter = (s) => NAMES[Number(s) % 26];

const row = (o = {}) => ({
  sport: 'mens-soccer', college_name: 'Alpha', division: 'NCAA D1', season: '2025',
  player_name: 'Someone', class_year_label: 'Jr.', position: 'DEFENSE',
  minutes_played: 700, games_played: 18, games_started: 10, hometown: 'Phoenix, AZ', ...o,
});
/**
 * A programme where `starters` defenders clear 600 minutes each season, on a
 * readable squad, across all four measured seasons.
 */
const programme = (name, starters, division = 'NCAA D1') => MEASURED_SEASONS.flatMap((season) => [
  ...Array.from({ length: starters }, (_, i) => row({
    college_name: name, division, season, position: 'DEFENSE', minutes_played: 900 - i,
    player_name: `D ${name} ${seasonLetter(season)} ${nameFor(i)}`,
  })),
  ...Array.from({ length: 3 }, (_, i) => row({
    college_name: name, division, season, position: 'DEFENSE', minutes_played: 100,
    player_name: `DR ${name} ${seasonLetter(season)} ${nameFor(i)}`,
  })),
  ...Array.from({ length: 8 }, (_, i) => row({
    college_name: name, division, season, position: 'MIDFIELD', minutes_played: 800,
    player_name: `M ${name} ${seasonLetter(season)} ${nameFor(i)}`,
  })),
  ...Array.from({ length: 6 }, (_, i) => row({
    college_name: name, division, season, position: 'FORWARD', minutes_played: 500,
    player_name: `F ${name} ${seasonLetter(season)} ${nameFor(i)}`,
  })),
]);

describe('the pool comparison', () => {
  /** 40 programmes, 2 to 9 defenders over 600, so the pool has a shape. */
  const many = () => {
    const rows = [];
    for (let i = 0; i < 40; i += 1) rows.push(...programme(`Prog ${nameFor(i)}`, 2 + (i % 8)));
    return rows;
  };
  const colleges = () => Array.from({ length: 40 }, (_, i) => ({
    name: `Prog ${nameFor(i)}`, sport: 'mens-soccer', division: 'NCAA D1',
  }));

  it('builds one cell per division and position, and none for goalkeepers', () => {
    const pool = buildLifecyclePool(readableRows(many()), colleges(), { sport: 'mens-soccer' });
    const cell = pool.positionUtilisation['NCAA D1'];
    expect(Object.keys(cell).sort()).toEqual([...SUPPORTED_POSITIONS].sort());
    expect(cell.GOALKEEPER).toBeUndefined();
    expect(cell.DEFENSE.programmes).toBe(40);
    expect(cell.DEFENSE.playersWith600Plus.p10).toBeLessThan(cell.DEFENSE.playersWith600Plus.p90);
  });

  it('quantiles programme medians rather than individual seasons', () => {
    const pool = buildLifecyclePool(readableRows(many()), colleges(), { sport: 'mens-soccer' });
    // Every programme is identical across its four seasons, so the pool's
    // spread can only come from the programmes.
    expect(pool.positionUtilisation.ALL.DEFENSE.programmes).toBe(40);
  });

  it('reads a programme against its own division when the division is deep enough', () => {
    const rows = readableRows(many());
    const pool = buildLifecyclePool(rows, colleges(), { sport: 'mens-soccer' });
    const p = positionUtilisationFor(rows.filter((r) => r.college_name === 'Prog aa'),
      { position: 'DEFENSE', pool, division: 'NCAA D1' });
    expect(p.poolScope).toBe('NCAA D1');
    expect(p.pool.playersWith600Plus.middleHalf).toEqual({
      low: p.pool.playersWith600Plus.p25, high: p.pool.playersWith600Plus.p75,
    });
  });

  it('falls back to every division when a programme’s own is too thin', () => {
    const rows = readableRows([...many(), ...programme('Lonely', 5, 'NCAA D3')]);
    const cols = [...colleges(), { name: 'Lonely', sport: 'mens-soccer', division: 'NCAA D3' }];
    const pool = buildLifecyclePool(rows, cols, { sport: 'mens-soccer' });
    expect(pool.positionUtilisation['NCAA D3'].DEFENSE.programmes).toBeLessThan(MIN_POOL_PROGRAMMES);
    const p = positionUtilisationFor(rows.filter((r) => r.college_name === 'Lonely'),
      { position: 'DEFENSE', pool, division: 'NCAA D3' });
    expect(p.poolScope).toBe('all divisions in this sport');
    expect(p.pool.playersWith600Plus.programmes).toBe(41);
  });

  // Position differences are large and the interquartile width is about one
  // and a half players, so borrowing one position's pool for another would be
  // a two-player error on a one-and-a-half-player scale.
  it('never borrows another position’s pool', () => {
    const rows = readableRows(many());
    const pool = buildLifecyclePool(rows, colleges(), { sport: 'mens-soccer' });
    const stripped = { ...pool, positionUtilisation: {
      ALL: { MIDFIELD: pool.positionUtilisation.ALL.MIDFIELD },
      'NCAA D1': { MIDFIELD: pool.positionUtilisation['NCAA D1'].MIDFIELD },
    } };
    const p = positionUtilisationFor(rows.filter((r) => r.college_name === 'Prog aa'),
      { position: 'DEFENSE', pool: stripped, division: 'NCAA D1' });
    expect(p.pool).toBeNull();
    expect(p.poolScope).toBeNull();
    expect(p.medianPlayersWith600Plus).not.toBeNull();
  });

  it('carries no pool rather than an invented one', () => {
    const p = positionUtilisationFor(readableRows(programme('Alone', 5)),
      { position: 'DEFENSE', pool: null, division: 'NCAA D1' });
    expect(p.pool).toBeNull();
    expect(p.medianPlayersWith600Plus).toBe(5);
  });
});

describe('what this model refuses to say', () => {
  const rows = () => readableRows(programme('Alone', 5));

  it('refuses a categorical classification and says why', () => {
    const s = buildPositionUtilisationSummary({ rows: rows(), division: 'NCAA D1' });
    expect(s.banding).toEqual(BANDING_REFUSED);
    expect(s.banding.reason).toMatch(/one and a half players apart/);
    for (const p of s.byPosition) expect(p.banding.available).toBe(false);
  });

  it('exposes no field a renderer could mistake for a verdict or a score', () => {
    const json = JSON.stringify(buildPositionUtilisationSummary({ rows: rows(), athlete: { position: 'Defender' } })).toLowerCase();
    for (const word of ['risk', 'safe', 'score', 'probability', 'opportunityscore',
      'competition', 'above-benchmark', 'below-benchmark', 'broad', 'narrow', 'likely', 'good']) {
      expect(json, word).not.toContain(word);
    }
  });

  it('exposes none of the metrics Phase 8B rejected', () => {
    const json = JSON.stringify(buildPositionUtilisationSummary({ rows: rows() }));
    for (const field of ['playersWith200Plus', 'playersFor90', 'effectivePlayers',
      'top1MinuteShare', 'top2MinuteShare', 'topHalfShare']) {
      expect(json, field).not.toContain(field);
    }
    // …and does expose the one supporting figure, marked as such by its name.
    expect(json).toContain('top3MinuteShare');
  });
});

describe('the summary a report would read', () => {
  const rows = () => readableRows(programme('Alone', 5));

  it('offers the athlete’s position and all three supported positions', () => {
    const s = buildPositionUtilisationSummary({
      rows: rows(), division: 'NCAA D1', athlete: { position: 'Defender' },
    });
    expect(s.byPosition.map((p) => p.position)).toEqual([...SUPPORTED_POSITIONS]);
    expect(s.athletePosition.position).toBe('DEFENSE');
    expect(s.athletePosition.noun).toBe('defender');
    expect(s.athletePosition.plural).toBe('defenders');
    expect(s.athletePosition.medianPlayersWith600Plus).toBe(5);
  });

  it('has no athlete position when no athlete was asked about', () => {
    expect(buildPositionUtilisationSummary({ rows: rows() }).athletePosition).toBeNull();
  });

  // A goalkeeper gets a statement, not an absence.
  it('tells a goalkeeper the analysis is not reported at their position', () => {
    const s = buildPositionUtilisationSummary({
      rows: rows(), division: 'NCAA D1', athlete: { position: 'Goalkeeper' },
    });
    expect(s.athletePosition.position).toBe('GOALKEEPER');
    expect(s.athletePosition.supported).toBe(false);
    expect(s.athletePosition.available).toBe(false);
    expect(s.athletePosition.reason).toBe(POSITION_NOT_SUPPORTED);
    expect(s.athletePosition.seasons).toEqual([]);
    // …and the three supported positions are still there for the programme half.
    expect(s.byPosition.every((p) => p.supported)).toBe(true);
  });

  it('normalises whatever spelling of a position it is handed', () => {
    for (const asked of ['Defender', 'DEFENSE', 'defence', 'CB', 'D/M']) {
      const s = buildPositionUtilisationSummary({ rows: rows(), athlete: { position: asked } });
      expect(s.athletePosition.position, asked).toBe('DEFENSE');
    }
    for (const asked of ['GK', 'Keeper', 'Goalie']) {
      expect(buildPositionUtilisationSummary({ rows: rows(), athlete: { position: asked } })
        .athletePosition.supported, asked).toBe(false);
    }
  });

  it('carries the evidence a future statement would have to be built from', () => {
    const s = buildPositionUtilisationSummary({ rows: rows(), athlete: { position: 'Defender' } });
    const p = s.athletePosition;
    expect(p.readableSeasonList).toEqual([...MEASURED_SEASONS]);
    expect(p.seasons).toHaveLength(4);
    expect(p.seasons[0].playersWithMinutes).toBe(8);
    expect(p.rangePlayersFor75).not.toBeNull();
    expect(p.thresholds.starterMinutes).toBe(600);
    expect(p.thresholds.cumulativeTarget).toBe(0.75);
    expect(s.cumulativeTarget).toBe(0.75);
    expect(s.positionNotSupportedReason).toBe(POSITION_NOT_SUPPORTED);
  });
});
