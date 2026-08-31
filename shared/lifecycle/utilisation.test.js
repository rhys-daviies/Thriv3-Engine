/**
 * Minute concentration. Several of these hold a line rather than check
 * arithmetic: 2026 is never in a historical figure, a fabricated season is
 * refused, a genuine zero inside a read season is not, and a long roster
 * cannot move a concentration share.
 */
import { describe, it, expect } from 'vitest';
import {
  seasonUtilisation, programmeUtilisation, MEASURED_SEASONS, TOP_N,
  MIN_SQUAD_FOR_SHARE, MIN_SEASONS_TO_QUOTE, ROTATION_MINUTES, SEASON_UNREADABLE,
} from './utilisation.js';
import { readableRows } from './readable.js';

const NAMES = 'abcdefghijklmnopqrstuvwxyz'.split('');
const nameFor = (i) => `${NAMES[i % 26]}${NAMES[Math.floor(i / 26) % 26]}`;

const row = (o = {}) => ({
  sport: 'mens-soccer', college_name: 'Alpha', division: 'NCAA D1', season: '2025',
  player_name: 'Someone', class_year_label: 'Jr.', position: 'DEFENSE',
  minutes_played: 0, games_played: 18, games_started: 0, ...o,
});
/** A squad where the minutes are whatever the list says, in order. */
const squad = (minutes, season = '2025', extra = {}) => minutes.map((m, i) => row({
  season, player_name: `Player ${nameFor(i)}`,
  minutes_played: m, games_played: m > 0 ? 18 : 0, ...extra,
}));
/** Twenty players: eleven on 1,000 and nine on nothing. */
const narrow = (season = '2025') => squad([...Array(11).fill(1000), ...Array(9).fill(0)], season);
/** Twenty-two players on equal minutes. */
const broad = (season = '2025') => squad(Array(22).fill(500), season);

describe('one season', () => {
  it('divides the top n by the season’s own published minutes', () => {
    const s = seasonUtilisation(narrow(), { season: '2025' });
    expect(s.readable).toBe(true);
    expect(s.totalMeasuredTeamMinutes).toBe(11000);
    expect(s.top11MinuteShare).toBe(1);
    expect(s.top1MinuteShare).toBeCloseTo(1 / 11, 10);
    expect(s.top5MinuteShare).toBeCloseTo(5 / 11, 10);
  });

  it('reads a broad distribution as broad', () => {
    const s = seasonUtilisation(broad(), { season: '2025' });
    expect(s.top11MinuteShare).toBeCloseTo(0.5, 10);
    expect(s.top14MinuteShare).toBeCloseTo(14 / 22, 10);
    expect(s.top18MinuteShare).toBeCloseTo(18 / 22, 10);
  });

  it('sorts by minutes rather than by roster order', () => {
    const jumbled = squad([100, 1500, 300, 1200, 50, 900, 700, 20, 1100, 400, 800, 600, 10, 5]);
    const s = seasonUtilisation(jumbled, { season: '2025' });
    const total = 100 + 1500 + 300 + 1200 + 50 + 900 + 700 + 20 + 1100 + 400 + 800 + 600 + 10 + 5;
    const top5 = 1500 + 1200 + 1100 + 900 + 800;
    expect(s.top5MinuteShare).toBeCloseTo(top5 / total, 10);
  });

  // Ties need no special case and must not get one: the share is taken over a
  // sorted list of minutes, so which of two players on 900 is "eleventh"
  // changes nothing.
  it('handles tied minutes without caring which player is which', () => {
    const tied = squad(Array(14).fill(700));
    const s = seasonUtilisation(tied, { season: '2025' });
    expect(s.top11MinuteShare).toBeCloseTo(11 / 14, 10);
    const reordered = seasonUtilisation([...tied].reverse(), { season: '2025' });
    expect(reordered.top11MinuteShare).toBe(s.top11MinuteShare);
  });

  it('gives a share of one where the squad is shorter than n', () => {
    const s = seasonUtilisation(squad(Array(13).fill(600)), { season: '2025' });
    expect(s.top14MinuteShare).toBe(1);
    expect(s.top18MinuteShare).toBe(1);
  });

  // A zero is in the denominator's population and takes none of it.
  it('counts a zero-minute player on the roster and gives them no share', () => {
    const s = seasonUtilisation(narrow(), { season: '2025' });
    expect(s.rosterPlayers).toBe(20);
    expect(s.measuredPlayers).toBe(20);
    expect(s.playersWithAnyMinutes).toBe(11);
    expect(s.playersWith200PlusMinutes).toBe(11);
    expect(s.playersWith600PlusMinutes).toBe(11);
  });

  it('counts the rotation at 200 and a starter’s season at 600', () => {
    const s = seasonUtilisation(squad([700, 650, 600, 599, 300, 200, 199, 1, 0, 0, 0, 0]), { season: '2025' });
    expect(ROTATION_MINUTES).toBe(200);
    expect(s.playersWithAnyMinutes).toBe(8);
    expect(s.playersWith200PlusMinutes).toBe(6);
    expect(s.playersWith600PlusMinutes).toBe(3);
  });

  it('refuses a roster too short for a share to mean anything', () => {
    const s = seasonUtilisation(squad(Array(MIN_SQUAD_FOR_SHARE - 1).fill(900)), { season: '2025' });
    expect(s.readable).toBe(false);
    expect(s.reason).toBe(SEASON_UNREADABLE.TOO_FEW_PLAYERS);
    expect(s.top11MinuteShare).toBeNull();
    expect(s.rosterPlayers).toBe(MIN_SQUAD_FOR_SHARE - 1);
  });

  it('refuses a season with no roster at all', () => {
    expect(seasonUtilisation([], { season: '2024' }))
      .toMatchObject({ readable: false, reason: SEASON_UNREADABLE.NO_ROSTER, rosterPlayers: 0 });
  });

  // Phase 6A: a stats page that was never read leaves a roster of assumed
  // zeros, and both rules run before this model sees the rows.
  it('refuses a season whose stats page was never read', () => {
    const fabricated = readableRows(squad(Array(30).fill(0)).map((r) => ({ ...r, games_played: 0 })));
    const s = seasonUtilisation(fabricated, { season: '2025' });
    expect(s.readable).toBe(false);
    expect(s.reason).toBe(SEASON_UNREADABLE.MINUTES_UNREADABLE);
    expect(s.rosterPlayers).toBe(30);
  });

  it('accepts a read season that happens to contain assumed zeros', () => {
    const mixed = readableRows([
      ...squad(Array(14).fill(800)),
      ...squad(Array(8).fill(0)).map((r) => ({ ...r, player_name: `Reserve ${r.player_name}`, games_played: 0 })),
    ]);
    const s = seasonUtilisation(mixed, { season: '2025' });
    expect(s.readable).toBe(true);
    expect(s.measuredPlayers).toBe(22);
    expect(s.playersWithAnyMinutes).toBe(14);
  });

  it('carries the team-minute ratio as provenance rather than as a gate', () => {
    const eleven = squad(Array(11).fill(18 * 90));
    const s = seasonUtilisation([...eleven, ...squad(Array(9).fill(0))], { season: '2025' });
    expect(s.teamMinuteRatio).toBeCloseTo(1, 5);
    expect(s.teamMinutesPlausible).toBe(true);
    const thin = seasonUtilisation(squad(Array(20).fill(100)), { season: '2025' });
    expect(thin.readable).toBe(true);              // reported, not suppressed
    expect(thin.teamMinutesPlausible).toBe(false);
  });
});

describe('one programme', () => {
  const four = [...narrow('2022'), ...broad('2023'), ...narrow('2024'), ...broad('2025')];

  it('keeps every season and summarises the readable ones', () => {
    const u = programmeUtilisation(four);
    expect(u.seasons.map((s) => s.season)).toEqual([...MEASURED_SEASONS]);
    expect(u.seasonsObserved).toBe(4);
    expect(u.medianTop11Share).toBeCloseTo(0.75, 10);
    expect(u.rangeTop11Share).toEqual({ low: 0.5, high: 1 });
    expect(u.medianTop18Share).toBeCloseTo((1 + 18 / 22) / 2, 10);
  });

  // 2026 carries no minutes anywhere by design, and is excluded by season
  // rather than by coverage.
  it('never reads 2026', () => {
    const withForward = [...four, ...squad(Array(30).fill(null), '2026')
      .map((r) => ({ ...r, games_played: null }))];
    const u = programmeUtilisation(withForward);
    expect(MEASURED_SEASONS).not.toContain('2026');
    expect(u.seasons.map((s) => s.season)).not.toContain('2026');
    expect(u.seasonsObserved).toBe(4);
    expect(programmeUtilisation(four).medianTop11Share).toBe(u.medianTop11Share);
  });

  it('suppresses the medians below two readable seasons and keeps the seasons', () => {
    const u = programmeUtilisation(narrow('2025'));
    expect(u.seasonsObserved).toBe(1);
    expect(u.suppressed).toBe(true);
    expect(u.medianTop11Share).toBeNull();
    expect(u.seasons.find((s) => s.season === '2025').top11MinuteShare).toBe(1);
    expect(u.suppressedReason).toMatch(/carry enough published minutes/);
    expect(MIN_SEASONS_TO_QUOTE).toBe(2);
  });

  /**
   * The one client-facing gate above season level that nothing held.
   *
   * A season whose published minutes do not reconcile with the matches it
   * contained is READABLE — its relative distribution is sound and gating on
   * the ratio would delete it, which Phase 6A explicitly decided against — so
   * the programme keeps it, summarises it, and names it. 68 men's and 95
   * women's programme-seasons reach this branch, and the squad page prints a
   * sentence from it.
   *
   * `narrow()` above cannot be used here: eleven players on a thousand minutes
   * is two thirds of what eighteen matches contain, so every one of its
   * seasons is implausible. These fixtures reconcile on purpose.
   */
  const reconciling = (season) => squad(
    [...Array(11).fill(18 * 90), ...Array(9).fill(0)], season,
  ).map((r) => ({ ...r, games_played: r.minutes_played > 0 ? 18 : 0 }));

  it('keeps a season whose minutes do not reconcile, and names it', () => {
    // A third of the minutes eighteen matches contain: readable by coverage,
    // and nowhere near 990 x matches.
    const thin = squad([...Array(11).fill(600), ...Array(9).fill(0)], '2023')
      .map((r) => ({ ...r, games_played: r.minutes_played > 0 ? 18 : 0 }));
    const u = programmeUtilisation([
      ...reconciling('2022'), ...thin, ...reconciling('2024'), ...reconciling('2025'),
    ]);
    expect(u.seasons.find((x) => x.season === '2023').readable).toBe(true);
    expect(u.seasons.find((x) => x.season === '2023').teamMinutesPlausible).toBe(false);
    expect(u.implausibleSeasons.map((x) => x.season)).toEqual(['2023']);
    expect(u.implausibleSeasons[0].ratio).toBeLessThan(0.85);
    // Named, not dropped: it is still one of the four seasons behind the median.
    expect(u.seasonsObserved).toBe(4);
    expect(u.suppressed).toBe(false);
    expect(u.medianTop11Share).not.toBeNull();
  });

  it('names no season where every season reconciles', () => {
    const u = programmeUtilisation(['2022', '2023', '2024', '2025'].flatMap(reconciling));
    expect(u.seasons.every((x) => x.teamMinutesPlausible === true)).toBe(true);
    expect(u.implausibleSeasons).toEqual([]);
  });

  it('names an unreadable season and why', () => {
    const u = programmeUtilisation([...narrow('2024'), ...narrow('2025'),
      ...squad(Array(6).fill(900), '2023')]);
    expect(u.unreadableSeasons).toEqual([
      { season: '2023', reason: SEASON_UNREADABLE.TOO_FEW_PLAYERS },
    ]);
    expect(u.readableSeasons).toEqual(['2024', '2025']);
  });

  // Lake Erie, in miniature: 62 named players and 28 with minutes. The roster
  // is inflated and the minutes are real, so concentration must be untouched
  // while the appearance share is not.
  it('is unmoved by a roster full of players who never appeared', () => {
    const playing = Array(28).fill(0).map((_, i) => 1600 - i * 40);
    const lean = squad(playing, '2025');
    const inflated = [...lean, ...squad(Array(34).fill(0), '2025')
      .map((r, i) => ({ ...r, player_name: `Reserve ${nameFor(i)}`, games_played: 0 }))];
    const a = seasonUtilisation(lean, { season: '2025' });
    const b = seasonUtilisation(inflated, { season: '2025' });
    expect(b.top11MinuteShare).toBe(a.top11MinuteShare);
    expect(b.top18MinuteShare).toBe(a.top18MinuteShare);
    expect(b.playersWith600PlusMinutes).toBe(a.playersWith600PlusMinutes);
    // …while the share of the roster that appeared halves on the same squad.
    expect(b.playersWithAnyMinutes / b.rosterPlayers)
      .toBeLessThan(a.playersWithAnyMinutes / a.rosterPlayers / 1.5);
  });

  it('offers every top-n the model documents', () => {
    const s = seasonUtilisation(broad(), { season: '2025' });
    for (const n of TOP_N) expect(s[`top${n}MinuteShare`], String(n)).toBeGreaterThan(0);
  });
});

describe('one readable season', () => {
  // NAIA: the acquisition reaches only 2025 there, so 111 men's and 120
  // women's programmes have exactly one season carrying minutes. A median of
  // one season is not a median, and refusing it entirely throws away the only
  // measured season those programmes have.
  it('is offered as an observation and never as a history', () => {
    const u = programmeUtilisation(narrow('2025'));
    expect(u.suppressed).toBe(true);
    expect(u.medianTop11Share).toBeNull();
    expect(u.singleSeasonObservation).toMatchObject({ season: '2025', top11MinuteShare: 1 });
    expect(u.singleSeasonObservation.basis).toMatch(/not a programme history/);
  });

  it('is absent once there is a history to quote', () => {
    expect(programmeUtilisation([...narrow('2024'), ...broad('2025')]).singleSeasonObservation)
      .toBeNull();
  });
});
