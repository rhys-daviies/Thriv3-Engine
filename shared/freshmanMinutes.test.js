import { describe, it, expect } from 'vitest';
import {
  bandFor, isTrueFreshman, isRedshirtFreshman, minutesAreMissing,
  freshmanSeason, freshmanShare, ladderByRank, freshmanProfile, MINUTE_BANDS,
  classifyProgramme, weightedMedian, weightsFromVerdict, STEP_POINTS, SPREAD_POINTS,
} from './freshmanMinutes.js';
import { tenureFor } from './coachTenure.js';

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

// Shares are the real four-season figures for each programme, and the coach
// sequences are what the scrape actually returned for them.
const prof = (pcts) => ({
  seasons: pcts.map((v, i) => ({
    season: String(2022 + i), shareOfSquadMinutes: v / 100, ladder: [], bands: {},
  })),
});
const ten = (...names) => tenureFor(names.map((coach_name, i) => ({ season: 2022 + i, coach_name })));
const GILLIS = ten('Duncan Gillis', 'Duncan Gillis', 'Duncan Gillis', 'Duncan Gillis');

describe('weightedMedian', () => {
  it('matches the plain median when every weight is equal', () => {
    expect(weightedMedian([100, 200, 300], [1, 1, 1])).toBe(200);
  });

  // Weighting rather than filtering: a programme whose coach changed last year
  // would otherwise be left with one season and a confidence it has not earned.
  it('pulls toward the heavier seasons without discarding the lighter ones', () => {
    expect(weightedMedian([100, 900, 950], [0.35, 1, 1])).toBe(900);
    expect(weightedMedian([100, 200, 900], [1, 0.35, 0.35])).toBe(100);
  });

  it('falls back to the plain median when no weight survives', () => {
    expect(weightedMedian([10, 20, 30], [0, 0, 0])).toBe(20);
  });
});

describe('classifyProgramme', () => {
  it('calls one coach and a flat pattern steady', () => {
    // Caltech men's: 30, 22, 17, 18 under Duncan Gillis for four years.
    const v = classifyProgramme(prof([30, 22, 17, 18]), GILLIS);
    expect(v.verdict).toBe('steady');
    expect(v.weightFrom).toBeNull();
  });

  // Bentley women's: Lukis then Dacey, and the share went 4, 2, 26, 32.
  it('finds a regime change and dates the weighting to the new coach', () => {
    const v = classifyProgramme(prof([4, 2, 26, 32]),
      ten('Lauren Lukis', 'Sarah Dacey', 'Sarah Dacey', 'Sarah Dacey'));
    expect(v.verdict).toBe('regime-change');
    expect(v.weightFrom).toBe(2023);
    expect(v.step).toBeGreaterThan(STEP_POINTS);
  });

  // The case that exposed the gap: Hofstra ran 2, 0, 8, 18 under Richard
  // Nuttall for all four years. Its spread is 7.0 — under the volatility
  // threshold — so checking spread alone files it as steady, which is the
  // opposite of what a recruit needs.
  it('catches a coach who changed their own policy', () => {
    const v = classifyProgramme(prof([2, 0, 8, 18]),
      ten('Richard Nuttall', 'Richard Nuttall', 'Richard Nuttall', 'Richard Nuttall'));
    expect(v.verdict).toBe('policy-shift-same-coach');
    expect(v.spread).toBeLessThan(SPREAD_POINTS);
    expect(v.weightFrom).toBe(2024);
  });

  it('calls one coach with a swinging pattern erratic', () => {
    const v = classifyProgramme(prof([46, 21, 45, 22]), GILLIS);
    expect(v.verdict).toBe('erratic-same-coach');
    expect(v.spread).toBeGreaterThanOrEqual(SPREAD_POINTS);
    // Nothing to weight toward — the swing is the finding.
    expect(v.weightFrom).toBeNull();
  });

  it('keeps every season when the pattern survived the change', () => {
    const v = classifyProgramme(prof([25, 24, 26, 25]),
      ten('Old Coach', 'New Coach', 'New Coach', 'New Coach'));
    expect(v.verdict).toBe('continuity-through-change');
    expect(v.weightFrom).toBeNull();
  });

  // South Carolina State printed TBA for two seasons while running the
  // highest freshman share in the pool. Read as one continuous coach that
  // becomes a policy shift; it is really a programme being held together.
  it('reports a vacancy rather than crediting it to the coach who followed', () => {
    const v = classifyProgramme(prof([69, 41, 19, 2]),
      ten('TBA', 'TBA', 'Andrew Richardson', ''));
    expect(v.verdict).toBe('vacancy-in-window');
    expect(v.vacantSeasons).toEqual([2022, 2023]);
    expect(v.weightFrom).toBe(2024);
  });

  it('says so when there is no coach on file at all', () => {
    expect(classifyProgramme(prof([10, 12, 11, 13]), null).verdict).toBe('coach-unknown');
  });

  it('will not describe a pattern from one season', () => {
    expect(classifyProgramme(prof([10]), GILLIS).verdict).toBe('too-few-seasons');
  });

  it('is null for a programme with nothing on file', () => {
    expect(classifyProgramme(null, GILLIS)).toBeNull();
  });
});

describe('weightsFromVerdict', () => {
  const seasons = [{ season: '2022' }, { season: '2023' }, { season: '2024' }, { season: '2025' }];

  it('weights from the season the verdict names', () => {
    const v = classifyProgramme(prof([4, 2, 26, 32]),
      ten('Lauren Lukis', 'Sarah Dacey', 'Sarah Dacey', 'Sarah Dacey'));
    expect(weightsFromVerdict(v, seasons)).toEqual({ 2022: 0.35, 2023: 1, 2024: 1, 2025: 1 });
  });

  it('is null where every season counts equally', () => {
    expect(weightsFromVerdict(classifyProgramme(prof([30, 22, 17, 18]), GILLIS), seasons)).toBeNull();
  });
});

describe('ladderByRank weighting', () => {
  const seasons = [
    { season: '2022', ladder: [{ rank: 1, minutes: 100 }] },
    { season: '2023', ladder: [{ rank: 1, minutes: 900 }] },
    { season: '2024', ladder: [{ rank: 1, minutes: 950 }] },
  ];

  it('reports the plain median when unweighted', () => {
    const r = ladderByRank(seasons)[0];
    expect(r.median).toBe(900);
    expect(r.weighted).toBe(false);
  });

  // The projection has to describe the programme a recruit would join, not
  // the one the previous coach ran.
  it('moves the median toward the seasons that still describe the programme', () => {
    const r = ladderByRank(seasons, { weights: { 2022: 0.35, 2023: 1, 2024: 1 } })[0];
    expect(r.median).toBe(900);
    expect(r.weighted).toBe(true);
    // The full range is still reported, so the disagreement stays visible.
    expect(r.low).toBe(100);
    expect(r.high).toBe(950);
  });
});
