/**
 * Position intake. Several of these exist to hold a line rather than to check
 * arithmetic: a returning player is not an arrival, an unreadable cycle is not
 * a cycle of zero, 2026 is never inside a historical figure, and the whole
 * model must be unchanged by the two readability rules — that independence is
 * the reason this analysis was chosen.
 */
import { describe, it, expect } from 'vitest';
import {
  positionPressure, arrivalsAt, cycleReadability, rosterPresence,
  HISTORICAL_CYCLES, CURRENT_CYCLE, ALL_CYCLES, ARRIVAL,
  MIN_ROSTER_FOR_CYCLE, MIN_CYCLES_TO_QUOTE, MIN_INCOMING_FOR_MIX, ROSTER_JUMP,
  NO_POSITION_DATA, MIN_POSITION_SHARE,
} from './pressure.js';
import { readableRows } from './readable.js';
import { withReadablePerformance } from '../performanceSource.js';

// Names are letters only, and carry no digits: the identity key strips
// punctuation and numbers, so "Arrived 2023 A" and "Arrived 2024 A" are the
// same person to buildLifecycles.
const NAMES = 'abcdefghijklmnopqrstuvwxyz'.split('');
const nameFor = (i) => `Player ${NAMES[i % 26]}${NAMES[Math.floor(i / 26) % 26]}`;
const seasonLetter = (season) => NAMES[Number(season) % 26];

const row = (o = {}) => ({
  sport: 'mens-soccer', college_name: 'Alpha', division: 'NCAA D1', season: '2025',
  player_name: 'Someone', class_year_label: 'Fr.', position: 'DEFENSE',
  minutes_played: 900, games_played: 18, games_started: 12,
  hometown: 'Phoenix, AZ', ...o,
});
/** A full roster of `n` returning juniors, so a cycle is readable. */
const filler = (season, n = MIN_ROSTER_FOR_CYCLE) => Array.from({ length: n }, (_, i) => row({
  season, player_name: `Filler ${nameFor(i)}`, class_year_label: 'Jr.', position: 'MIDFIELD',
}));
/** Every season on file with a readable roster, plus whatever else is passed. */
const withRosters = (extra = [], seasons = ['2022', ...ALL_CYCLES]) =>
  [...seasons.flatMap((s) => filler(s)), ...extra];

const of = (rows, position = 'DEFENSE') =>
  positionPressure(rows).positions.find((p) => p.position === position);

describe('the cycles a position intake can be counted over', () => {
  it('names the arrival season, and never 2022', () => {
    expect(HISTORICAL_CYCLES).toEqual(['2023', '2024', '2025']);
    expect(CURRENT_CYCLE).toBe('2026');
    expect(ALL_CYCLES).not.toContain('2022');
  });

  it('needs a roster on both sides of a cycle', () => {
    const cycles = cycleReadability(withRosters([], ['2022', '2023', '2025', '2026']));
    const by = new Map(cycles.map((c) => [c.season, c]));
    expect(by.get('2023').readable).toBe(true);
    expect(by.get('2024').readable).toBe(false);
    expect(by.get('2024').reason).toMatch(/no roster on file for this season/);
    // 2025 has no 2024 roster before it, so its arrivals cannot be identified.
    expect(by.get('2025').readable).toBe(false);
    expect(by.get('2025').reason).toMatch(/season before/);
  });

  // A five-name page would otherwise report either an intake of nobody or an
  // intake of everybody, and both are inventions.
  it('refuses a cycle whose roster is a fragment rather than a squad', () => {
    const rows = [...filler('2022'), ...filler('2023', 4), ...filler('2024'), ...filler('2025'), ...filler('2026')];
    const by = new Map(cycleReadability(rows).map((c) => [c.season, c]));
    expect(by.get('2023').readable).toBe(false);
    expect(by.get('2023').reason).toMatch(/too few players/);
    expect(by.get('2024').readable).toBe(false);
    expect(by.get('2024').reason).toMatch(/season before/);
    expect(by.get('2025').readable).toBe(true);
    expect(rosterPresence(rows).get('2023')).toMatchObject({ players: 4, readable: false });
  });

  it('reports an unreadable cycle as null counts, never as zero', () => {
    const pos = of(withRosters([], ['2022', '2023', '2025', '2026']));
    const c2024 = pos.cycles.find((c) => c.season === '2024');
    expect(c2024.totalIncoming).toBeNull();
    expect(c2024.firstYears).toBeNull();
    expect(pos.historical.unreadableSeasons).toContain('2024');
    expect(pos.historical.totalIncomingPerCycle).not.toContain(null);
  });
});

describe('who counts as incoming', () => {
  it('counts a first appearance and classifies it from the class label', () => {
    const pos = of(withRosters([
      row({ season: '2024', player_name: 'New Fresher', class_year_label: 'Fr.' }),
      row({ season: '2024', player_name: 'New Transfer', class_year_label: 'Jr.' }),
    ]));
    const c = pos.cycles.find((x) => x.season === '2024');
    expect(c.firstYears).toBe(1);
    expect(c.experiencedArrivals).toBe(1);
    expect(c.totalIncoming).toBe(2);
    expect(c.names.map((n) => n.arrival).sort())
      .toEqual([ARRIVAL.EXPERIENCED, ARRIVAL.FIRST_YEAR]);
  });

  // The single most important negative: somebody already here did not arrive.
  it('does not count a player who was on the previous roster', () => {
    const pos = of(withRosters([
      row({ season: '2023', player_name: 'Stayer', class_year_label: 'Fr.' }),
      row({ season: '2024', player_name: 'Stayer', class_year_label: 'So.' }),
      row({ season: '2025', player_name: 'Stayer', class_year_label: 'Jr.' }),
    ]));
    expect(pos.cycles.find((c) => c.season === '2023').totalIncoming).toBe(1);
    expect(pos.cycles.find((c) => c.season === '2024').totalIncoming).toBe(0);
    expect(pos.cycles.find((c) => c.season === '2025').totalIncoming).toBe(0);
  });

  // 789 men's players have a gap season. Reading "absent last season" as an
  // arrival would call every one of them a new signing.
  it('does not count a player returning after a gap season as new', () => {
    const pos = of(withRosters([
      row({ season: '2023', player_name: 'Gap Year', class_year_label: 'Fr.' }),
      row({ season: '2025', player_name: 'Gap Year', class_year_label: 'Jr.' }),
    ]));
    expect(pos.cycles.find((c) => c.season === '2023').totalIncoming).toBe(1);
    expect(pos.cycles.find((c) => c.season === '2025').totalIncoming).toBe(0);
  });

  // Five men's programme-seasons carry the same player twice. Identity is the
  // unit, so those are one arrival without any special case.
  it('counts a player listed twice in one season once', () => {
    const pos = of(withRosters([
      row({ season: '2024', player_name: 'Twice Listed', class_year_label: 'Fr.' }),
      row({ season: '2024', player_name: 'Twice  Listed', class_year_label: 'Fr.' }),
    ]));
    expect(pos.cycles.find((c) => c.season === '2024').totalIncoming).toBe(1);
  });

  it('keeps an unreadable class label out of both halves and counts it', () => {
    const pos = of(withRosters([
      row({ season: '2024', player_name: 'No Class', class_year_label: 'Real Colorado' }),
    ]));
    const c = pos.cycles.find((x) => x.season === '2024');
    expect(c.totalIncoming).toBe(1);
    expect(c.firstYears).toBe(0);
    expect(c.experiencedArrivals).toBe(0);
    expect(c.unclassified).toBe(1);
  });

  // Phase 6A: the lifecycle layer used to be blind to "Fy.", so a programme
  // spelling it that way had no first-year arrivals at all.
  it('reads every class spelling the roster uses', () => {
    const pos = of(withRosters([
      row({ season: '2024', player_name: 'Ay Fy', class_year_label: 'Fy.' }),
      row({ season: '2024', player_name: 'Bee First', class_year_label: '1st' }),
      row({ season: '2024', player_name: 'Cee Second', class_year_label: 'Second Year' }),
    ]));
    const c = pos.cycles.find((x) => x.season === '2024');
    expect(c.firstYears).toBe(2);
    expect(c.experiencedArrivals).toBe(1);
  });

  it('files an arrival under the position the roster gave them on arrival', () => {
    const rows = withRosters([
      row({ season: '2024', player_name: 'Moved Up', class_year_label: 'Fr.', position: 'DEFENSE' }),
      row({ season: '2025', player_name: 'Moved Up', class_year_label: 'So.', position: 'FORWARD' }),
      row({ season: '2026', player_name: 'Moved Up', class_year_label: 'Jr.', position: 'FORWARD' }),
    ]);
    expect(of(rows, 'DEFENSE').cycles.find((c) => c.season === '2024').totalIncoming).toBe(1);
    expect(of(rows, 'FORWARD').cycles.find((c) => c.season === '2024').totalIncoming).toBe(0);
    expect(arrivalsAt(rows).find((a) => a.name === 'Moved Up').positionChanged).toBe(true);
  });

  it('counts an arrival whose position cannot be read rather than dropping it', () => {
    const p = positionPressure(withRosters([
      row({ season: '2024', player_name: 'Odd Position', position: 'Sweeper-Keeper-ish' }),
    ]));
    expect(p.unknownPosition.cycles.find((c) => c.season === '2024').totalIncoming).toBe(1);
    for (const pos of p.positions) {
      expect(pos.cycles.find((c) => c.season === '2024').totalIncoming).toBe(0);
    }
  });
});

describe('the historical summary and 2026', () => {
  const busy = withRosters([
    ...[['2023', 2], ['2024', 4], ['2025', 3]].flatMap(([season, n]) =>
      Array.from({ length: n }, (_, i) => row({
        season, player_name: `Arrived ${seasonLetter(season)} ${nameFor(i)}`,
        class_year_label: i === 0 ? 'Jr.' : 'Fr.',
      }))),
    // The current known intake: two experienced defenders on the 2026 page.
    row({ season: '2026', player_name: 'Current One', class_year_label: 'Jr.' }),
    row({ season: '2026', player_name: 'Current Two', class_year_label: 'Sr.' }),
  ]);

  it('keeps every cycle and summarises over the historical ones only', () => {
    const h = of(busy).historical;
    expect(h.totalIncomingPerCycle).toEqual([2, 4, 3]);
    expect(h.firstYearsPerCycle).toEqual([1, 3, 2]);
    expect(h.experiencedArrivalsPerCycle).toEqual([1, 1, 1]);
    expect(h.medianTotalIncoming).toBe(3);
    expect(h.range).toEqual({ low: 2, high: 4 });
    expect(h.cyclesWithReadableRosterPresence).toBe(3);
    expect(h.seasons).toEqual(['2023', '2024', '2025']);
    expect(h.cyclesWithAtLeastTwo).toBe(3);
    expect(h.cyclesWithAtLeastThree).toBe(2);
    expect(h.cyclesWithAnExperiencedArrival).toBe(3);
  });

  it('holds 2026 apart from every historical figure', () => {
    const pos = of(busy);
    expect(pos.current.season).toBe('2026');
    expect(pos.current.firstYears).toBe(0);
    expect(pos.current.experiencedArrivals).toBe(2);
    expect(pos.current.totalIncoming).toBe(2);
    // Nothing about 2026 leaks into the history.
    expect(pos.historical.seasons).not.toContain('2026');
    expect(pos.historical.totalIncoming).toBe(9);
    expect(pos.historical.totalIncomingPerCycle).toHaveLength(3);
  });

  it('says the 2026 roster is missing rather than reporting no arrivals', () => {
    const pos = of(withRosters([], ['2022', '2023', '2024', '2025']));
    expect(pos.current.readable).toBe(false);
    expect(pos.current.totalIncoming).toBeNull();
    expect(pos.current.reason).toMatch(/no roster on file/);
  });

  it('suppresses every rate below two readable cycles, and keeps the counts', () => {
    const pos = of(withRosters([
      row({ season: '2023', player_name: 'Only One', class_year_label: 'Fr.' }),
    ], ['2022', '2023']));
    expect(pos.historical.cyclesWithReadableRosterPresence).toBe(1);
    expect(pos.historical.suppressed).toBe(true);
    expect(pos.historical.medianTotalIncoming).toBeNull();
    expect(pos.historical.cyclesWithAtLeastOne).toBeNull();
    expect(pos.historical.totalIncoming).toBe(1);
    expect(MIN_CYCLES_TO_QUOTE).toBe(2);
  });

  it('suppresses the mix below enough classified arrivals and keeps the counts', () => {
    const thin = of(withRosters([
      row({ season: '2023', player_name: 'One Only', class_year_label: 'Fr.' }),
      row({ season: '2024', player_name: 'Two Only', class_year_label: 'Jr.' }),
    ]));
    expect(thin.historical.mix.suppressed).toBe(true);
    expect(thin.historical.mix.experiencedShare).toBeNull();
    expect(thin.historical.mix.classified).toBe(2);

    const enough = of(busy).historical.mix;
    expect(enough.classified).toBeGreaterThanOrEqual(MIN_INCOMING_FOR_MIX);
    expect(enough.suppressed).toBe(false);
    expect(enough.firstYearShare + enough.experiencedShare).toBeCloseTo(1, 10);
  });

  // The mix divides by the CLASSIFIED arrivals, so an unreadable label
  // understates neither half.
  it('divides the mix by the arrivals it could classify', () => {
    const pos = of(withRosters([
      ...Array.from({ length: 6 }, (_, i) => row({
        season: '2023', player_name: `Known ${nameFor(i)}`, class_year_label: i < 3 ? 'Fr.' : 'Jr.',
      })),
      row({ season: '2024', player_name: 'Unknown Class', class_year_label: 'FC Dallas' }),
    ]));
    expect(pos.historical.totalIncoming).toBe(7);
    expect(pos.historical.mix.classified).toBe(6);
    expect(pos.historical.mix.experiencedShare).toBeCloseTo(0.5, 10);
  });
});

describe('independence from the minutes column', () => {
  /**
   * The reason this analysis was chosen over the position-cut development
   * model: it asks nothing of the performance column, so it survives a
   * programme whose stats page was never read.
   */
  const fabricated = withRosters([
    row({ season: '2024', player_name: 'Arrived Anyway', class_year_label: 'Fr.' }),
    row({ season: '2025', player_name: 'And Another', class_year_label: 'Jr.' }),
  ]).map((r) => (r.season === '2025' ? { ...r, minutes_played: 0, games_played: 0, games_started: 0 } : r));

  it('is unchanged by the source readability rule', () => {
    expect(withReadablePerformance(fabricated).filter((r) => r.season === '2025')
      .every((r) => r.minutes_played === null)).toBe(true);
    expect(of(withReadablePerformance(fabricated)).historical)
      .toEqual(of(fabricated).historical);
  });

  it('is unchanged by readableRows, which applies both rules', () => {
    expect(of(readableRows(fabricated)).historical).toEqual(of(fabricated).historical);
    expect(of(readableRows(fabricated)).current).toEqual(of(fabricated).current);
  });

  it('still counts arrivals where no minute was ever published', () => {
    const noMinutes = withRosters([
      row({ season: '2024', player_name: 'Never Measured', class_year_label: 'Fr.' }),
    ]).map((r) => ({ ...r, minutes_played: null, games_played: null, games_started: null }));
    expect(of(readableRows(noMinutes)).cycles.find((c) => c.season === '2024').totalIncoming).toBe(1);
  });
});

describe('a roster that changes size rather than a programme that recruits', () => {
  // The mirror of Lake Erie. There, an inflated roster sat beside real minutes
  // and had to be left alone; here a roster that DOUBLES between two seasons
  // makes an intake count that is about the page. Emory & Henry men's went
  // from 31 named players to 76 in 2025, and that cycle reads as 28 incoming
  // midfielders.
  const jumped = [
    ...filler('2022'), ...filler('2023'),
    ...filler('2024', 30),
    ...filler('2025', 30),
    ...filler('2026', 30),
    ...Array.from({ length: 12 }, (_, i) => row({
      season: '2024', player_name: `Sudden ${nameFor(i)}`, class_year_label: 'Fr.',
    })),
  ];

  it('flags the cycle and keeps its count', () => {
    const pos = of(jumped);
    const c = pos.cycles.find((x) => x.season === '2024');
    expect(c.readable).toBe(true);
    expect(c.rosterJumped).toBe(true);
    expect(c.rosterGrowth).toBeGreaterThanOrEqual(ROSTER_JUMP);
    expect(c.totalIncoming).toBe(12);
    expect(pos.historical.rosterJumpedSeasons).toEqual(['2024']);
  });

  it('leaves a stable roster unflagged', () => {
    const pos = of(withRosters([
      row({ season: '2024', player_name: 'Just One', class_year_label: 'Fr.' }),
    ]));
    expect(pos.cycles.every((c) => c.rosterJumped === false)).toBe(true);
    expect(pos.historical.rosterJumpedSeasons).toEqual([]);
  });

  // Three cycles and one outlier: the median is the two that agree.
  it('does not let one jumped cycle move the median', () => {
    expect(of(jumped).historical.medianTotalIncoming).toBe(0);
    expect(of(jumped).historical.range).toEqual({ low: 0, high: 12 });
  });

  it('flags a collapse as well as a jump', () => {
    const collapsed = [...filler('2022'), ...filler('2023', 40), ...filler('2024', 12),
      ...filler('2025'), ...filler('2026')];
    const by = new Map(cycleReadability(collapsed).map((c) => [c.season, c]));
    expect(by.get('2024').rosterJumped).toBe(true);
    expect(by.get('2024').rosterGrowth).toBeLessThanOrEqual(1 / ROSTER_JUMP);
  });
});

describe('a roster that does not say what position anybody plays', () => {
  // Eastern New Mexico names 33 arrivals and the position of none of them, and
  // the importer records that honestly as the string UNKNOWN. Without a gate
  // the model reports "a median of 0 defenders in three cycles", which is not
  // a thin answer but a false one.
  const noPositions = withRosters([
    ...['2023', '2024', '2025'].flatMap((season) => Array.from({ length: 5 }, (_, i) => row({
      season, player_name: `Nameless ${seasonLetter(season)} ${nameFor(i)}`,
      position: 'UNKNOWN', class_year_label: i === 0 ? 'Jr.' : 'Fr.',
    }))),
  ].map((r) => ({ ...r, position: 'UNKNOWN' })), ['2022', ...ALL_CYCLES])
    .map((r) => ({ ...r, position: 'UNKNOWN' }));

  it('refuses every per-position figure and names the reason', () => {
    const p = positionPressure(noPositions);
    expect(p.positionData).toMatchObject({ withPosition: 0, share: 0, readable: false });
    for (const pos of p.positions) {
      expect(pos.historical.suppressed, pos.position).toBe(true);
      expect(pos.historical.medianTotalIncoming, pos.position).toBeNull();
      expect(pos.historical.suppressedReason, pos.position).toBe(NO_POSITION_DATA);
      expect(pos.historical.mix.suppressed, pos.position).toBe(true);
    }
  });

  it('still counts the arrivals, under a position it will not claim', () => {
    const p = positionPressure(noPositions);
    expect(p.unknownPosition.totalIncoming).toBeGreaterThan(0);
    expect(p.arrivals.filter((a) => a.position === 'UNKNOWN').length)
      .toBe(p.unknownPosition.totalIncoming);
  });

  it('distinguishes no position data from too few cycles', () => {
    const thin = of(withRosters([
      row({ season: '2023', player_name: 'One Arrival', class_year_label: 'Fr.' }),
    ], ['2022', '2023']));
    expect(thin.historical.suppressedReason).toMatch(/recruiting cycles have a roster/);
    expect(thin.historical.suppressedReason).not.toBe(NO_POSITION_DATA);
  });

  // Nothing to split is not the same as unable to split.
  it('has no opinion on position data when nobody arrived', () => {
    const p = positionPressure(withRosters([]));
    expect(p.positionData).toMatchObject({ arrivals: 0, share: null, readable: true });
    expect(p.positions.every((x) => x.historical.suppressedReason == null)).toBe(true);
    expect(p.positions.every((x) => x.historical.medianTotalIncoming === 0)).toBe(true);
  });

  it('applies the same 0.5 share the rest of the codebase uses', () => {
    expect(MIN_POSITION_SHARE).toBe(0.5);
  });

  it('reads a programme that names most positions', () => {
    const mostly = withRosters([
      ...Array.from({ length: 6 }, (_, i) => row({
        season: '2024', player_name: `Known ${nameFor(i)}`, class_year_label: 'Fr.',
      })),
      row({ season: '2024', player_name: 'Nameless One', position: 'UNKNOWN' }),
    ]);
    const p = positionPressure(mostly);
    expect(p.positionData.readable).toBe(true);
    expect(p.positions.find((x) => x.position === 'DEFENSE').historical.suppressed).toBe(false);
  });
});
