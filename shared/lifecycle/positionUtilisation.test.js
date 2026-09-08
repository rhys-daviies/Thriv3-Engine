/**
 * Minute distribution within one position.
 *
 * Several of these hold a line rather than check arithmetic: a goalkeeper is
 * excluded by method and not by coverage, a position is read from the season
 * the player was listed in, no minute reaches two positions, and a squad whose
 * positions are mostly unnamed refuses rather than dividing by an incomplete
 * denominator.
 */
import { describe, it, expect } from 'vitest';
import {
  positionSeasonUtilisation, programmePositionUtilisation, allPositionUtilisation,
  playersForShare, SUPPORTED_POSITIONS, POSITION_SEASON_UNREADABLE, POSITION_NOT_SUPPORTED,
  CUMULATIVE_TARGET, MAX_UNKNOWN_MINUTE_SHARE, MIN_PLAYERS_USED,
} from './positionUtilisation.js';
import { readableRows } from './readable.js';
import { MEASURED_SEASONS, MIN_SQUAD_FOR_SHARE } from './utilisation.js';
import { STARTER_MINUTES } from './lifecycle.js';

const NAMES = 'abcdefghijklmnopqrstuvwxyz'.split('');
const nameFor = (i) => `${NAMES[i % 26]}${NAMES[Math.floor(i / 26) % 26]}`;
const seasonLetter = (s) => NAMES[Number(s) % 26];

const row = (o = {}) => ({
  sport: 'mens-soccer', college_name: 'Alpha', division: 'NCAA D1', season: '2025',
  player_name: 'Someone', class_year_label: 'Jr.', position: 'DEFENSE',
  minutes_played: 0, games_played: 18, games_started: 0, ...o,
});
/** `minutes.length` players at `position`, in `season`, with those minutes. */
const at = (position, minutes, season = '2025', tag = '') => minutes.map((m, i) => row({
  season, position, minutes_played: m, games_played: m > 0 ? 18 : 0,
  player_name: `P ${tag}${seasonLetter(season)} ${position[0]} ${nameFor(i)}`,
}));
/** Enough of a squad elsewhere that the season is a readable roster. */
const squad = (season = '2025', n = 14) => at('FORWARD', Array(n).fill(700), season, 'sq');

describe('the goalkeeper exclusion', () => {
  // Not a threshold. The median programme uses two goalkeepers and one of them
  // reaches a starter's season, so there is no distribution to describe.
  it('is a method, not a coverage refusal', () => {
    const rows = [...squad(), ...at('GOALKEEPER', [1600, 200, 100])];
    const p = programmePositionUtilisation(rows, { position: 'GOALKEEPER' });
    expect(p.supported).toBe(false);
    expect(p.available).toBe(false);
    expect(p.reason).toBe(POSITION_NOT_SUPPORTED);
    expect(p.reason).toMatch(/not reported for goalkeepers/);
    expect(p.reason).not.toMatch(/too few|insufficient|thin/i);
    expect(p.seasons).toEqual([]);
    expect(p.medianPlayersWith600Plus).toBeNull();
  });

  it('holds even where a programme happens to use six goalkeepers', () => {
    const rows = ['2024', '2025'].flatMap((s) => [...squad(s),
      ...at('GOALKEEPER', [900, 800, 700, 650, 620, 610], s)]);
    expect(programmePositionUtilisation(rows, { position: 'GOALKEEPER' }).supported).toBe(false);
  });

  it('supports exactly the three outfield positions', () => {
    expect(SUPPORTED_POSITIONS).toEqual(['DEFENSE', 'MIDFIELD', 'FORWARD']);
    expect(allPositionUtilisation([]).map((p) => p.position)).toEqual([...SUPPORTED_POSITIONS]);
    for (const label of ['GK', 'Goalie', 'Keeper', 'GOALKEEPER']) {
      expect(programmePositionUtilisation([], { position: label }).supported, label).toBe(false);
    }
  });
});

describe('one position in one season', () => {
  const nine = [...at('DEFENSE', [1500, 1400, 1300, 900, 700, 400, 200, 100, 50]), ...squad()];

  it('counts the two production measures and the context measure', () => {
    const s = positionSeasonUtilisation(nine, { season: '2025', position: 'DEFENSE' });
    expect(s.readable).toBe(true);
    expect(s.playersAtPosition).toBe(9);
    expect(s.playersWithMinutes).toBe(9);
    expect(s.playersWith600Plus).toBe(5);
    expect(s.totalPositionMinutes).toBe(6550);
    // 1500+1400+1300+900 = 5100 of 6550 = 77.9%; three alone is 64.1%.
    expect(s.playersFor75).toBe(4);
    expect(s.top3MinuteShare).toBeCloseTo(4200 / 6550, 10);
  });

  it('counts a 600-minute season at exactly 600', () => {
    const s = positionSeasonUtilisation([...at('DEFENSE', [601, 600, 599, 300, 100]), ...squad()],
      { season: '2025', position: 'DEFENSE' });
    expect(s.playersWith600Plus).toBe(2);
    expect(STARTER_MINUTES).toBe(600);
  });

  // The cumulative comparison is >=, so a position where four players hold
  // exactly three-quarters answers four rather than five.
  it('answers the exact 75% boundary with the smaller count', () => {
    expect(playersForShare([300, 300, 300, 300, 400], 1600)).toBe(4);   // 1200/1600 = .75
    expect(playersForShare([300, 300, 300, 299, 401], 1600)).toBe(5);   // 1199/1600 < .75
    expect(CUMULATIVE_TARGET).toBe(0.75);
    const s = positionSeasonUtilisation([...at('DEFENSE', [300, 300, 300, 300, 400]), ...squad()],
      { season: '2025', position: 'DEFENSE' });
    expect(s.playersFor75).toBe(4);
  });

  it('takes one player where one player holds most of the minutes', () => {
    const s = positionSeasonUtilisation([...at('DEFENSE', [1600, 100, 90, 80, 70]), ...squad()],
      { season: '2025', position: 'DEFENSE' });
    expect(s.playersFor75).toBe(1);
    expect(s.playersWith600Plus).toBe(1);
  });

  it('needs five players who actually played, and says so at four', () => {
    const four = positionSeasonUtilisation([...at('DEFENSE', [900, 800, 700, 600, 0]), ...squad()],
      { season: '2025', position: 'DEFENSE' });
    expect(four.readable).toBe(false);
    expect(four.reason).toBe(POSITION_SEASON_UNREADABLE.TOO_FEW_PLAYERS_USED_AT_POSITION);
    expect(four.playersWithMinutes).toBe(4);
    expect(four.playersWith600Plus).toBeNull();
    expect(MIN_PLAYERS_USED).toBe(5);
  });

  it('accepts exactly five', () => {
    const five = positionSeasonUtilisation([...at('DEFENSE', [900, 800, 700, 600, 1]), ...squad()],
      { season: '2025', position: 'DEFENSE' });
    expect(five.readable).toBe(true);
    expect(five.playersWithMinutes).toBe(5);
    expect(five.playersWith600Plus).toBe(4);
  });

  // Forwards are the thinnest position and the threshold is not lowered for
  // them: 41% of forward cells fall short of four readable seasons because of
  // this, and that is the honest number.
  it('does not lower the threshold for forwards', () => {
    const rows = [...at('FORWARD', [1400, 900, 700, 600], '2025', 'f'),
      ...at('DEFENSE', Array(14).fill(700), '2025', 'd')];
    expect(positionSeasonUtilisation(rows, { season: '2025', position: 'FORWARD' }).reason)
      .toBe(POSITION_SEASON_UNREADABLE.TOO_FEW_PLAYERS_USED_AT_POSITION);
  });

  it('refuses a roster fragment before it looks at the position', () => {
    const s = positionSeasonUtilisation(at('DEFENSE', Array(MIN_SQUAD_FOR_SHARE - 1).fill(900)),
      { season: '2025', position: 'DEFENSE' });
    expect(s.reason).toBe(POSITION_SEASON_UNREADABLE.ROSTER_TOO_SMALL);
  });

  it('refuses a season with no roster', () => {
    expect(positionSeasonUtilisation([], { season: '2024', position: 'DEFENSE' }).reason)
      .toBe(POSITION_SEASON_UNREADABLE.NO_ROSTER);
  });

  // Phase 6A, reused rather than redefined.
  it('refuses a season whose stats page was never read', () => {
    const fabricated = readableRows([...at('DEFENSE', Array(9).fill(0)), ...squad()]
      .map((r) => ({ ...r, minutes_played: 0, games_played: 0 })));
    expect(positionSeasonUtilisation(fabricated, { season: '2025', position: 'DEFENSE' }).reason)
      .toBe(POSITION_SEASON_UNREADABLE.MINUTES_UNREADABLE);
  });
});

describe('the unknown-position gate', () => {
  // The denominator must be the position's minutes out of a squad whose
  // positions are known. Discarding unnamed minutes and dividing anyway would
  // report a complete split of an incomplete squad.
  it('refuses when too much of the squad’s playing time has no position', () => {
    const rows = [...at('DEFENSE', [900, 800, 700, 600, 500]),
      ...at('Sweeper-Keeper-ish', Array(9).fill(900), '2025', 'u')];
    const s = positionSeasonUtilisation(rows, { season: '2025', position: 'DEFENSE' });
    expect(s.unknownPositionMinuteShare).toBeGreaterThan(MAX_UNKNOWN_MINUTE_SHARE);
    expect(s.readable).toBe(false);
    expect(s.reason).toBe(POSITION_SEASON_UNREADABLE.POSITION_DENOMINATOR_INCOMPLETE);
  });

  it('accepts a squad with a little unnamed playing time', () => {
    const rows = [...at('DEFENSE', [900, 800, 700, 600, 500]), ...squad('2025', 12),
      row({ position: 'Nonsense', minutes_played: 200, player_name: 'One Odd' })];
    const s = positionSeasonUtilisation(rows, { season: '2025', position: 'DEFENSE' });
    expect(s.unknownPositionMinuteShare).toBeLessThan(MAX_UNKNOWN_MINUTE_SHARE);
    expect(s.readable).toBe(true);
  });

  it('reports the unknown share even on a refusal', () => {
    const rows = [...at('DEFENSE', [900, 800, 700, 600, 500]),
      ...at('Unknown', Array(9).fill(900), '2025', 'u')];
    expect(positionSeasonUtilisation(rows, { season: '2025', position: 'DEFENSE' })
      .unknownPositionMinuteShare).toBeGreaterThan(0);
  });
});

describe('the position a player is read at', () => {
  const switcher = [
    row({ season: '2024', player_name: 'Moved Along', position: 'DEFENSE', minutes_played: 1500 }),
    row({ season: '2025', player_name: 'Moved Along', position: 'MIDFIELD', minutes_played: 1500 }),
    ...at('DEFENSE', [900, 800, 700, 600, 500], '2024', 'd'),
    ...at('DEFENSE', [900, 800, 700, 600, 500], '2025', 'd'),
    ...at('MIDFIELD', [900, 800, 700, 600, 500], '2024', 'm'),
    ...at('MIDFIELD', [900, 800, 700, 600, 500], '2025', 'm'),
    // Twelve is the roster floor, so the seasons need padding to be read at all.
    ...at('FORWARD', [800, 700], '2024', 'f'),
    ...at('FORWARD', [800, 700], '2025', 'f'),
  ];

  it('uses the season’s own position, not an arrival or career position', () => {
    const d24 = positionSeasonUtilisation(switcher, { season: '2024', position: 'DEFENSE' });
    const d25 = positionSeasonUtilisation(switcher, { season: '2025', position: 'DEFENSE' });
    const m25 = positionSeasonUtilisation(switcher, { season: '2025', position: 'MIDFIELD' });
    expect(d24.playersWithMinutes).toBe(6);
    expect(d25.playersWithMinutes).toBe(5);
    expect(m25.playersWithMinutes).toBe(6);
    // 2024 defence carries Moved Along's 1,500 on top of the five regulars;
    // 2025 defence does not, and 2025 midfield does.
    expect(d24.totalPositionMinutes).toBe(5000);
    expect(d25.totalPositionMinutes).toBe(3500);
    expect(m25.totalPositionMinutes).toBe(5000);
  });

  it('never counts one player’s minutes at two positions in a season', () => {
    for (const season of ['2024', '2025']) {
      const rows = switcher.filter((r) => r.season === season);
      const byPosition = ['DEFENSE', 'MIDFIELD', 'FORWARD']
        .map((p) => positionSeasonUtilisation(switcher, { season, position: p }).totalPositionMinutes ?? 0)
        .reduce((a, b) => a + b, 0);
      const squadTotal = rows.reduce((a, r) => a + Number(r.minutes_played), 0);
      // FORWARD is below the five-player floor here, so its minutes are not in
      // the sum; what must hold is that no minute is counted twice.
      const forwardMinutes = rows.filter((r) => r.position === 'FORWARD')
        .reduce((a, r) => a + Number(r.minutes_played), 0);
      expect(byPosition, season).toBe(squadTotal - forwardMinutes);
    }
  });

  it('normalises whatever spelling the roster uses', () => {
    const rows = [...at('CB', [900, 800], '2025', 'a'), ...at('Defender', [700, 600], '2025', 'b'),
      ...at('D/M', [500], '2025', 'c'), ...squad('2025', 12)];
    const s = positionSeasonUtilisation(rows, { season: '2025', position: 'DEFENSE' });
    expect(s.playersWithMinutes).toBe(5);
  });
});

describe('one programme', () => {
  const four = MEASURED_SEASONS.flatMap((s) => [
    ...at('DEFENSE', [1500, 1200, 900, 700, 400, 200], s, 'd'), ...squad(s, 12),
  ]);

  it('keeps every season and summarises the readable ones', () => {
    const p = programmePositionUtilisation(four, { position: 'DEFENSE' });
    expect(p.available).toBe(true);
    expect(p.readableSeasons).toBe(4);
    expect(p.readableSeasonList).toEqual([...MEASURED_SEASONS]);
    // [1500, 1200, 900, 700, 400, 200] totals 4,900: four players clear 600,
    // and four are needed to pass 75% (3,600 of 4,900 is 73.5%).
    expect(p.medianPlayersWith600Plus).toBe(4);
    expect(p.rangePlayersWith600Plus).toEqual({ low: 4, high: 4 });
    expect(p.medianPlayersFor75).toBe(4);
    expect(p.medianPlayersWithMinutes).toBe(6);
    expect(p.seasons.every((s) => s.readable)).toBe(true);
  });

  it('takes the median across seasons rather than pooling their minutes', () => {
    const varied = [
      ...at('DEFENSE', [1500, 1400, 1300, 900, 700, 400], '2022', 'd'),
      ...at('DEFENSE', [1600, 200, 150, 120, 100, 90], '2023', 'd'),
      ...at('DEFENSE', [900, 800, 750, 700, 650, 600], '2024', 'd'),
      ...MEASURED_SEASONS.flatMap((s) => squad(s, 12)),
    ];
    const p = programmePositionUtilisation(varied, { position: 'DEFENSE' });
    expect(p.seasons.filter((s) => s.readable).map((s) => s.playersWith600Plus)).toEqual([5, 1, 6]);
    expect(p.medianPlayersWith600Plus).toBe(5);
    expect(p.rangePlayersWith600Plus).toEqual({ low: 1, high: 6 });
  });

  it('never reads 2026', () => {
    const forward = at('DEFENSE', Array(9).fill(null), '2026', 'd')
      .map((r) => ({ ...r, minutes_played: null, games_played: null }));
    const p = programmePositionUtilisation([...four, ...forward], { position: 'DEFENSE' });
    expect(MEASURED_SEASONS).not.toContain('2026');
    expect(p.seasons.map((s) => s.season)).not.toContain('2026');
    expect(p.readableSeasons).toBe(4);
  });

  it('suppresses the medians below two readable seasons and keeps the season', () => {
    const one = [...at('DEFENSE', [1500, 1200, 900, 700, 400, 200], '2025', 'd'), ...squad('2025', 12)];
    const p = programmePositionUtilisation(one, { position: 'DEFENSE' });
    expect(p.available).toBe(false);
    expect(p.medianPlayersWith600Plus).toBeNull();
    expect(p.reason).toMatch(/only 1 of 4 seasons/);
    expect(p.singleSeasonObservation).toMatchObject({
      season: '2025', playersWith600Plus: 4, playersFor75: 4, playersWithMinutes: 6,
    });
    expect(p.singleSeasonObservation.basis).toMatch(/not a programme history/);
  });

  it('accepts two readable seasons and drops the single-season observation', () => {
    const two = ['2024', '2025'].flatMap((s) => [
      ...at('DEFENSE', [1500, 1200, 900, 700, 400, 200], s, 'd'), ...squad(s, 12)]);
    const p = programmePositionUtilisation(two, { position: 'DEFENSE' });
    expect(p.available).toBe(true);
    expect(p.readableSeasons).toBe(2);
    expect(p.singleSeasonObservation).toBeNull();
  });

  it('names every refused season with its reason', () => {
    const mixed = [
      ...at('DEFENSE', [1500, 1200, 900, 700, 400, 200], '2024', 'd'), ...squad('2024', 12),
      ...at('DEFENSE', [1500, 1200, 900, 700, 400, 200], '2025', 'd'), ...squad('2025', 12),
      ...at('DEFENSE', [900, 800, 700], '2023', 'd'), ...squad('2023', 12),
    ];
    const p = programmePositionUtilisation(mixed, { position: 'DEFENSE' });
    expect(p.refusedSeasons).toEqual([{
      season: '2023',
      reason: POSITION_SEASON_UNREADABLE.TOO_FEW_PLAYERS_USED_AT_POSITION,
      playersWithMinutes: 3,
    }]);
  });

  it('publishes the thresholds it applied', () => {
    const p = programmePositionUtilisation(four, { position: 'DEFENSE' });
    expect(p.thresholds).toEqual({
      starterMinutes: 600, cumulativeTarget: 0.75, minPlayersUsed: 5,
      minRosterPlayers: 12, maxUnknownMinuteShare: 0.10, minSeasonsToQuote: 2,
    });
  });
});
