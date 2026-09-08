/**
 * The report-facing half: pool scope, the band this model refuses, and the
 * one figure it marks as unreliable rather than hiding.
 */
import { describe, it, expect } from 'vitest';
import { buildSquadSummary, utilisationFor, experienceFor, BANDING_REFUSED, MIN_POOL_PROGRAMMES } from './squad.js';
import { buildLifecyclePool } from '../lifecycle/pool.js';
import { readableRows } from '../lifecycle/readable.js';

const NAMES = 'abcdefghijklmnopqrstuvwxyz'.split('');
const nameFor = (i) => `${NAMES[i % 26]}${NAMES[Math.floor(i / 26) % 26]}`;
const seasonLetter = (s) => NAMES[Number(s) % 26];
const CLASSES = ['Fr.', 'So.', 'Jr.', 'Sr.'];

const row = (o = {}) => ({
  sport: 'mens-soccer', college_name: 'Alpha', division: 'NCAA D1', season: '2025',
  player_name: 'Someone', class_year_label: 'Jr.', position: 'DEFENSE',
  minutes_played: 600, games_played: 18, games_started: 10, hometown: 'Phoenix, AZ', ...o,
});
/**
 * A programme whose top `playing` players share the minutes evenly, on a
 * roster of `size`, in all four measured seasons.
 */
const programme = (name, { playing = 14, size = 26, division = 'NCAA D1' } = {}) =>
  ['2022', '2023', '2024', '2025'].flatMap((season) => Array.from({ length: size }, (_, i) => row({
    college_name: name, division, season,
    class_year_label: CLASSES[i % 4],
    player_name: `P ${name} ${seasonLetter(season)} ${nameFor(i)}`,
    minutes_played: i < playing ? Math.round((18 * 90 * 11) / playing) : 0,
    games_played: i < playing ? 18 : 0,
  })));

describe('the pool comparison', () => {
  /** 40 programmes, playing squads from 11 to 22, so the pool has a shape. */
  const many = () => {
    const rows = [];
    for (let i = 0; i < 40; i += 1) rows.push(...programme(`Prog ${nameFor(i)}`, { playing: 11 + (i % 12) }));
    return rows;
  };
  const colleges = () => Array.from({ length: 40 }, (_, i) => ({
    name: `Prog ${nameFor(i)}`, sport: 'mens-soccer', division: 'NCAA D1',
  }));

  it('quantiles programme medians rather than individual seasons', () => {
    const pool = buildLifecyclePool(readableRows(many()), colleges(), { sport: 'mens-soccer' });
    const cell = pool.utilisation['NCAA D1'];
    expect(cell.programmes).toBe(40);
    expect(cell.top11MinuteShare.p10).toBeLessThan(cell.top11MinuteShare.p90);
    expect(cell.top18MinuteShare.median).toBeGreaterThan(cell.top11MinuteShare.median);
  });

  it('reads a programme against its own division when the division is deep enough', () => {
    const rows = readableRows(many());
    const pool = buildLifecyclePool(rows, colleges(), { sport: 'mens-soccer' });
    const u = utilisationFor(rows.filter((r) => r.college_name === 'Prog aa'),
      { pool, division: 'NCAA D1' });
    expect(u.poolScope).toBe('NCAA D1');
    expect(u.pool.top11MinuteShare.middleHalf).toEqual({
      low: u.pool.top11MinuteShare.p25, high: u.pool.top11MinuteShare.p75,
    });
  });

  it('falls back to every division when a programme’s own is too thin', () => {
    const rows = readableRows([...many(), ...programme('Lonely', { playing: 13, division: 'NCAA D3' })]);
    const cols = [...colleges(), { name: 'Lonely', sport: 'mens-soccer', division: 'NCAA D3' }];
    const pool = buildLifecyclePool(rows, cols, { sport: 'mens-soccer' });
    expect(pool.utilisation['NCAA D3'].programmes).toBeLessThan(MIN_POOL_PROGRAMMES);
    const u = utilisationFor(rows.filter((r) => r.college_name === 'Lonely'),
      { pool, division: 'NCAA D3' });
    expect(u.poolScope).toBe('all divisions in this sport');
    expect(u.pool.top11MinuteShare.programmes).toBe(41);
  });

  it('carries no pool rather than an invented one', () => {
    const u = utilisationFor(readableRows(programme('Alone')), { pool: null, division: 'NCAA D1' });
    expect(u.pool).toBeNull();
    expect(u.poolScope).toBeNull();
    expect(u.medianTop11Share).toBeGreaterThan(0);
  });

  it('compares each year of study against the same scope', () => {
    const rows = readableRows(many());
    const pool = buildLifecyclePool(rows, colleges(), { sport: 'mens-soccer' });
    const e = experienceFor(rows.filter((r) => r.college_name === 'Prog aa'),
      { pool, division: 'NCAA D1' });
    expect(e.poolScope).toBe('NCAA D1');
    const y1 = e.groups.find((g) => g.group === 'YEAR_1');
    expect(y1.poolMinuteShare.programmes).toBe(40);
    expect(y1.poolRosterShare.programmes).toBe(40);
  });
});

describe('what this model refuses to say', () => {
  const rows = () => readableRows(programme('Alone'));

  // The quartiles separate cleanly here, unlike Phase 7's, and one player
  // moving 100 minutes shifts only 2-6% of programmes. What breaks a band is
  // the season: the pool's middle half is 5.5 points wide and a programme's
  // own season-to-season range has a median of 8.8.
  it('refuses a categorical classification and says why', () => {
    const s = buildSquadSummary({ rows: rows(), division: 'NCAA D1' });
    expect(s.banding).toEqual(BANDING_REFUSED);
    expect(s.banding.available).toBe(false);
    expect(s.banding.reason).toMatch(/between its own seasons/);
    expect(s.utilisation.banding.available).toBe(false);
    expect(s.experience.banding.available).toBe(false);
  });

  it('exposes no field a renderer could mistake for a verdict', () => {
    const json = JSON.stringify(buildSquadSummary({ rows: rows(), division: 'NCAA D1' })).toLowerCase();
    for (const word of ['risk', 'safe', 'unsafe', 'aggressive', 'quality', 'better',
      'above-benchmark', 'below-benchmark', 'likely', 'will play', 'good', 'poor']) {
      expect(json, word).not.toContain(word);
    }
  });

  // Lake Erie's lesson, carried in the model: the figure is available and
  // marked, so nothing has to recompute it and nothing can print it innocently.
  it('marks the share of the roster that appeared as unreliable', () => {
    const s = buildSquadSummary({ rows: rows(), division: 'NCAA D1' });
    expect(s.utilisation.rosterAppearanceShare.unreliable).toBe(true);
    expect(s.utilisation.rosterAppearanceShare.reason).toMatch(/roster page/);
    expect(s.utilisation.rosterAppearanceShare.seasons).toHaveLength(4);
  });
});

describe('the summary a report would read', () => {
  it('names where a year of study holds more minutes than roster', () => {
    const rows = readableRows(['2024', '2025'].flatMap((season) => [
      ...Array.from({ length: 12 }, (_, i) => row({
        season, class_year_label: 'Fr.', minutes_played: 100, games_played: 6,
        player_name: `Y1 ${seasonLetter(season)} ${nameFor(i)}`,
      })),
      ...Array.from({ length: 8 }, (_, i) => row({
        season, class_year_label: 'Sr.', minutes_played: 1400, games_played: 18,
        player_name: `Y4 ${seasonLetter(season)} ${nameFor(i)}`,
      })),
    ]));
    const s = buildSquadSummary({ rows });
    const by = new Map(s.loadVersusRoster.map((g) => [g.group, g]));
    expect(by.get('YEAR_1').rosterShare).toBeCloseTo(0.6, 10);
    expect(by.get('YEAR_1').difference).toBeLessThan(-0.4);
    expect(by.get('YEAR_4').difference).toBeGreaterThan(0.4);
  });

  it('has no load-versus-roster table where the minutes are unreadable', () => {
    const fabricated = readableRows(['2024', '2025'].flatMap((season) =>
      Array.from({ length: 24 }, (_, i) => row({
        season, class_year_label: CLASSES[i % 4], minutes_played: 0, games_played: 0,
        player_name: `X ${seasonLetter(season)} ${nameFor(i)}`,
      }))));
    const s = buildSquadSummary({ rows: fabricated });
    expect(s.utilisation.available).toBe(false);
    expect(s.experience.compositionAvailable).toBe(true);
    expect(s.experience.loadAvailable).toBe(false);
    expect(s.loadVersusRoster).toBeNull();
  });
});
