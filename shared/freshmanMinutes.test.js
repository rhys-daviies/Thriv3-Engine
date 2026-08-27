import { describe, it, expect } from 'vitest';
import {
  bandFor, isTrueFreshman, isRedshirtFreshman, minutesAreMissing,
  freshmanSeason, freshmanShare, ladderByRank, freshmanProfile, MINUTE_BANDS,
} from './freshmanMinutes.js';

const p = (over) => ({
  season: '2025', class_year_label: 'Fr.', player_name: 'A', position: 'DEFENSE',
  minutes_played: 0, games_played: 0, games_started: 0, ...over,
});

describe('bandFor', () => {
  it('splits at the same 600 the rest of the product calls a starter', () => {
    expect(bandFor(600)).toBe('impact');
    expect(bandFor(599)).toBe('rotation');
    expect(bandFor(200)).toBe('rotation');
    expect(bandFor(199)).toBe('fringe');
    expect(bandFor(1)).toBe('fringe');
    expect(bandFor(0)).toBe('none');
  });

  it('treats a missing or junk value as no minutes', () => {
    expect(bandFor(null)).toBe('none');
    expect(bandFor(undefined)).toBe('none');
  });

  it('gives every band a label, so nothing renders as a bare key', () => {
    for (const b of MINUTE_BANDS) expect(b.label).toBeTruthy();
  });
});

describe('freshman identification', () => {
  // "Will I play in year one" is a question about players in their first year
  // on campus. A redshirt freshman is in their second.
  it('reads every spelling of a true freshman', () => {
    for (const label of ['Fr.', 'Fy.', 'Freshman', '1st']) {
      expect(isTrueFreshman(p({ class_year_label: label })), label).toBe(true);
    }
  });

  it('does not count a redshirt freshman as a true one', () => {
    expect(isTrueFreshman(p({ class_year_label: 'R-Fr.' }))).toBe(false);
    expect(isRedshirtFreshman(p({ class_year_label: 'R-Fr.' }))).toBe(true);
    expect(isRedshirtFreshman(p({ class_year_label: 'Fr.' }))).toBe(false);
  });

  it('counts no other class as a freshman', () => {
    for (const label of ['So.', 'Jr.', 'Sr.', 'Gr.', null]) {
      expect(isTrueFreshman(p({ class_year_label: label })), String(label)).toBe(false);
    }
  });
});

describe('minutesAreMissing', () => {
  // minutes_played cannot tell "did not play" from "not recorded" — the
  // importer coerces a blank to 0 — but games_played has no such fallback.
  it('separates a benched player from an unrecorded one', () => {
    expect(minutesAreMissing(p({ minutes_played: 0, games_played: 0 }))).toBe(false);
    expect(minutesAreMissing(p({ minutes_played: 0, games_played: null }))).toBe(true);
    expect(minutesAreMissing(p({ minutes_played: 0, games_played: 6 }))).toBe(true);
    expect(minutesAreMissing(p({ minutes_played: 900, games_played: null }))).toBe(false);
  });
});

describe('freshmanSeason', () => {
  const rows = [
    p({ player_name: 'Top', minutes_played: 1400, games_played: 17, games_started: 17 }),
    p({ player_name: 'Rot', minutes_played: 400, games_played: 12 }),
    p({ player_name: 'Fri', minutes_played: 50, games_played: 4 }),
    p({ player_name: 'Zero', minutes_played: 0, games_played: 0 }),
    p({ player_name: 'NoData', minutes_played: 0, games_played: null }),
    p({ player_name: 'Soph', class_year_label: 'So.', minutes_played: 900, games_played: 17 }),
    p({ player_name: 'Red', class_year_label: 'R-Fr.', minutes_played: 300, games_played: 9 }),
    p({ player_name: 'LastYear', season: '2024', minutes_played: 999, games_played: 17 }),
  ];
  const s = freshmanSeason(rows, { season: '2025' });

  it('ranks the cohort by minutes, best first', () => {
    expect(s.ladder.map((x) => x.name)).toEqual(['Top', 'Rot', 'Fri', 'Zero']);
    expect(s.ladder.map((x) => x.rank)).toEqual([1, 2, 3, 4]);
  });

  it('counts the bands', () => {
    expect(s.bands).toEqual({ impact: 1, rotation: 1, fringe: 1, none: 1 });
  });

  it('keeps an unrecorded player out of the ladder but visible in the count', () => {
    expect(s.intake).toBe(5);
    expect(s.measured).toBe(4);
    expect(s.unknown).toBe(1);
    expect(s.ladder.map((x) => x.name)).not.toContain('NoData');
  });

  // Otherwise a programme whose stats page has no minutes column looks like
  // one that never plays a freshman.
  it('does not read an unrecorded player as a benched one', () => {
    expect(s.bands.none).toBe(1);
  });

  it('ignores other classes, other seasons, and redshirts', () => {
    const names = s.ladder.map((x) => x.name);
    expect(names).not.toContain('Soph');
    expect(names).not.toContain('LastYear');
    expect(names).not.toContain('Red');
    expect(s.redshirted).toBe(1);
  });

  it('filters to one position when asked', () => {
    const rows2 = [
      p({ player_name: 'D', position: 'DEFENSE', minutes_played: 500, games_played: 12 }),
      p({ player_name: 'F', position: 'FORWARD', minutes_played: 900, games_played: 17 }),
    ];
    expect(freshmanSeason(rows2, { season: '2025', position: 'DEFENSE' }).ladder.map((x) => x.name))
      .toEqual(['D']);
  });

  it('is empty, not broken, for a season with no freshmen', () => {
    const s0 = freshmanSeason(rows, { season: '2019' });
    expect(s0.intake).toBe(0);
    expect(s0.ladder).toEqual([]);
    expect(s0.totalMinutes).toBe(0);
  });
});

describe('freshmanShare', () => {
  it('is the freshman slice of everything the squad played', () => {
    const rows = [
      p({ player_name: 'F1', minutes_played: 300, games_played: 9 }),
      p({ player_name: 'S1', class_year_label: 'Sr.', minutes_played: 700, games_played: 17 }),
    ];
    expect(freshmanShare(rows, { season: '2025' })).toBeCloseTo(0.3, 5);
  });

  it('is null rather than zero when the squad has no minutes at all', () => {
    expect(freshmanShare([p({ minutes_played: 0, games_played: null })], { season: '2025' })).toBeNull();
  });
});

describe('ladderByRank', () => {
  const seasons = [
    { ladder: [{ rank: 1, minutes: 1000 }, { rank: 2, minutes: 400 }] },
    { ladder: [{ rank: 1, minutes: 1200 }, { rank: 2, minutes: 200 }] },
    { ladder: [{ rank: 1, minutes: 800 }] },
  ];

  // The projection a recruit can act on: not what the average freshman got,
  // but what the position they might occupy got.
  it('reports the median, low and high at each rank', () => {
    const byRank = ladderByRank(seasons);
    expect(byRank[0]).toMatchObject({ rank: 1, median: 1000, low: 800, high: 1200, seasonsWithThisMany: 3 });
    expect(byRank[1]).toMatchObject({ rank: 2, median: 300, low: 200, high: 400, seasonsWithThisMany: 2 });
  });

  it('says how many seasons actually had that many freshmen', () => {
    expect(ladderByRank(seasons)[1].seasonsWithThisMany).toBe(2);
  });

  it('stops at the deepest rank anyone reached', () => {
    expect(ladderByRank(seasons)).toHaveLength(2);
  });

  it('respects maxRank', () => {
    expect(ladderByRank(seasons, { maxRank: 1 })).toHaveLength(1);
  });
});

describe('freshmanProfile', () => {
  const rows = [];
  for (const season of ['2024', '2025']) {
    rows.push(p({ season, player_name: 'A' + season, minutes_played: 1000, games_played: 17 }));
    rows.push(p({ season, player_name: 'B' + season, minutes_played: 100, games_played: 5 }));
  }
  const profile = freshmanProfile(rows, { seasons: ['2022', '2023', '2024', '2025'] });

  it('drops seasons with no intake rather than reporting empty ones', () => {
    expect(profile.seasons.map((s) => s.season)).toEqual(['2024', '2025']);
    expect(profile.seasonsObserved).toBe(2);
  });

  // The reason for using four years rather than one: doing it every season and
  // doing it once are different claims about a programme.
  it("counts how reliably a freshman gets a starter's season", () => {
    expect(profile.seasonsWithAnImpactFreshman).toBe(2);
    expect(profile.medianImpactPerSeason).toBe(1);
  });

  it('returns null when the programme has no freshmen on file at all', () => {
    expect(freshmanProfile([], { seasons: ['2025'] })).toBeNull();
  });
});
