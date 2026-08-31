/**
 * The report-facing half of position intake: the pool comparison, and the
 * label this model refuses to produce.
 */
import { describe, it, expect } from 'vitest';
import { buildPressureSummary, positionIntakeFor, BANDING_REFUSED, MIN_POOL_PROGRAMMES } from './pressure.js';
import { positionPressure, ALL_CYCLES, MIN_ROSTER_FOR_CYCLE } from '../lifecycle/pressure.js';
import { buildLifecyclePool } from '../lifecycle/pool.js';

const NAMES = 'abcdefghijklmnopqrstuvwxyz'.split('');
const nameFor = (i) => `${NAMES[i % 26]}${NAMES[Math.floor(i / 26) % 26]}`;
const seasonLetter = (season) => NAMES[Number(season) % 26];

const row = (o = {}) => ({
  sport: 'mens-soccer', college_name: 'Alpha', division: 'NCAA D1', season: '2025',
  player_name: 'Someone', class_year_label: 'Fr.', position: 'DEFENSE',
  minutes_played: 900, games_played: 18, games_started: 12, hometown: 'Phoenix, AZ', ...o,
});
const filler = (programme, season, n = MIN_ROSTER_FOR_CYCLE) => Array.from({ length: n }, (_, i) => row({
  college_name: programme, season, player_name: `Filler ${programme} ${nameFor(i)}`,
  class_year_label: 'Jr.', position: 'MIDFIELD',
}));
/** A programme adding `per` defenders in every historical cycle. */
const programme = (name, per, division = 'NCAA D1') => [
  ...['2022', ...ALL_CYCLES].flatMap((s) => filler(name, s).map((r) => ({ ...r, division }))),
  ...['2023', '2024', '2025'].flatMap((s) => Array.from({ length: per }, (_, i) => row({
    college_name: name, division, season: s,
    player_name: `New ${name} ${seasonLetter(s)} ${nameFor(i)}`,
    class_year_label: i % 3 === 0 ? 'Jr.' : 'Fr.',
  }))),
];

describe('the pool comparison', () => {
  /** 40 programmes adding 1..8 defenders a cycle, so the pool has a shape. */
  const many = () => {
    const rows = [];
    for (let i = 0; i < 40; i += 1) rows.push(...programme(`Prog ${nameFor(i)}`, (i % 8) + 1));
    return rows;
  };
  const colleges = () => Array.from({ length: 40 }, (_, i) => ({
    name: `Prog ${nameFor(i)}`, sport: 'mens-soccer', division: 'NCAA D1',
  }));

  it('quantiles programme medians, not individual cycles', () => {
    const pool = buildLifecyclePool(many(), colleges(), { sport: 'mens-soccer' });
    const cell = pool.positionIntake['NCAA D1'].DEFENSE;
    expect(cell.programmes).toBe(40);
    expect(cell.totalIncoming.median).toBeGreaterThan(1);
    expect(cell.totalIncoming.p10).toBeLessThan(cell.totalIncoming.p90);
  });

  it('reads a programme against its own division when the division is deep enough', () => {
    const rows = many();
    const pool = buildLifecyclePool(rows, colleges(), { sport: 'mens-soccer' });
    const s = buildPressureSummary({
      rows: rows.filter((r) => r.college_name === 'Prog aa'),
      pool, division: 'NCAA D1',
    });
    const def = s.positions.find((p) => p.position === 'DEFENSE');
    expect(def.historical.poolScope).toBe('NCAA D1');
    expect(def.historical.pool.programmes).toBe(40);
    expect(def.historical.pool.middleHalf).toEqual({
      low: def.historical.pool.p25, high: def.historical.pool.p75,
    });
  });

  it('falls back to every division when a programme’s own is too thin', () => {
    const rows = [...many(), ...programme('Lonely', 3, 'NCAA D3')];
    const cols = [...colleges(), { name: 'Lonely', sport: 'mens-soccer', division: 'NCAA D3' }];
    const pool = buildLifecyclePool(rows, cols, { sport: 'mens-soccer' });
    expect(pool.positionIntake['NCAA D3'].DEFENSE.programmes).toBeLessThan(MIN_POOL_PROGRAMMES);
    const s = buildPressureSummary({
      rows: rows.filter((r) => r.college_name === 'Lonely'), pool, division: 'NCAA D3',
    });
    const def = s.positions.find((p) => p.position === 'DEFENSE');
    expect(def.historical.poolScope).toBe('all divisions in this sport');
    expect(def.historical.pool.programmes).toBe(41);
  });

  it('carries no pool at all rather than an invented one', () => {
    const rows = programme('Alone', 3);
    const s = buildPressureSummary({ rows, pool: null, division: 'NCAA D1' });
    const def = s.positions.find((p) => p.position === 'DEFENSE');
    expect(def.historical.pool).toBeNull();
    expect(def.historical.poolScope).toBeNull();
    expect(def.historical.medianTotalIncoming).toBe(3);
  });
});

describe('the label this model will not produce', () => {
  // Measured, not asserted by taste: in 42% of men's division-position cells
  // the pool's p25 equals its median or its median equals its p75, a third of
  // programmes sit exactly on p25, and 54% would change band on a difference
  // of one player.
  it('refuses a categorical classification and says why', () => {
    const s = buildPressureSummary({ rows: programme('Alone', 3), division: 'NCAA D1' });
    expect(s.banding).toEqual(BANDING_REFUSED);
    expect(s.banding.available).toBe(false);
    expect(s.banding.reason).toMatch(/one player/);
    for (const pos of s.positions) expect(pos.banding.available).toBe(false);
  });

  it('exposes no field a renderer could mistake for a verdict', () => {
    const s = buildPressureSummary({ rows: programme('Alone', 3), division: 'NCAA D1' });
    const json = JSON.stringify(s).toLowerCase();
    for (const word of ['risk', 'safe', 'unsafe', 'aggressive', 'recruits over',
      'above-benchmark', 'below-benchmark', 'likely', 'will recruit']) {
      expect(json, word).not.toContain(word);
    }
  });
});

describe('the summary a report would read', () => {
  it('reports every position and the athlete’s own', () => {
    const s = buildPressureSummary({
      rows: programme('Alone', 3), division: 'NCAA D1',
      athlete: { position: 'Defender' },
    });
    expect(s.positions.map((p) => p.position))
      .toEqual(['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD']);
    expect(s.athletePosition.position).toBe('DEFENSE');
    expect(s.athletePosition.noun).toBe('defender');
    expect(s.athletePosition.plural).toBe('defenders');
    expect(s.athletePosition.historical.totalIncomingPerCycle).toEqual([3, 3, 3]);
  });

  // The same normalisation the rest of Programme Intelligence uses: the roster
  // stores DEFENSE and the intake form stores "Defender", and comparing them
  // raw matches nobody — which reads as a position the programme never signs.
  it('normalises whatever spelling of a position it is handed', () => {
    const rows = programme('Alone', 3);
    for (const asked of ['Defender', 'DEFENSE', 'defence', 'CB', 'RB', 'D/M']) {
      const s = buildPressureSummary({ rows, athlete: { position: asked } });
      expect(s.athletePosition.position, asked).toBe('DEFENSE');
      expect(s.athletePosition.historical.totalIncomingPerCycle, asked).toEqual([3, 3, 3]);
    }
    expect(positionIntakeFor(positionPressure(rows), { position: 'Keeper' }).position)
      .toBe('GOALKEEPER');
    // An unreadable position is not silently turned into a real one.
    expect(positionIntakeFor(positionPressure(rows), { position: 'Sweeper-Keeper' }))
      .toBeNull();
  });

  it('has no athlete position when no athlete was asked about', () => {
    expect(buildPressureSummary({ rows: programme('Alone', 3) }).athletePosition).toBeNull();
  });

  it('states the cycles once, with the reason each failed', () => {
    const s = buildPressureSummary({ rows: programme('Alone', 3) });
    expect(s.cycles.map((c) => c.season)).toEqual([...ALL_CYCLES]);
    expect(s.cycles.every((c) => c.readable)).toBe(true);
    expect(s.available).toBe(true);
  });

  it('refuses the whole analysis when the rosters cannot support one cycle', () => {
    const s = buildPressureSummary({ rows: filler('Thin', '2025', 30) });
    expect(s.available).toBe(false);
    expect(s.reason).toMatch(/recruiting cycles have a roster on file/);
    // And still reports the positions, so a page can say what was attempted.
    expect(s.positions).toHaveLength(4);
    expect(s.positions[0].historical.suppressed).toBe(true);
  });

  // Only 2022 is missing, so 2023 has nothing before it and the other two
  // cycles stand. Two is the floor, and it is met.
  it('accepts a programme with two of three cycles readable', () => {
    const rows = programme('Alone', 3).filter((r) => r.season !== '2022');
    const s = buildPressureSummary({ rows });
    expect(s.available).toBe(true);
    const def = s.positions.find((p) => p.position === 'DEFENSE');
    expect(def.historical.cyclesWithReadableRosterPresence).toBe(2);
    expect(def.historical.unreadableSeasons).toEqual(['2023']);
    expect(def.historical.medianTotalIncoming).toBe(3);
  });

  // Losing a season in the middle costs TWO cycles, because the season after
  // it has nothing to be compared against. Below the floor, and said so.
  it('refuses when a missing middle season leaves one cycle', () => {
    const rows = programme('Alone', 3).filter((r) => r.season !== '2024');
    const s = buildPressureSummary({ rows });
    expect(s.available).toBe(false);
    const def = s.positions.find((p) => p.position === 'DEFENSE');
    expect(def.historical.cyclesWithReadableRosterPresence).toBe(1);
    expect(def.historical.unreadableSeasons).toEqual(['2024', '2025']);
    expect(def.historical.medianTotalIncoming).toBeNull();
  });
});
