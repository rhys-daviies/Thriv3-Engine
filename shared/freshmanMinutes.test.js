import { describe, it, expect } from 'vitest';
import {
  bandFor, isTrueFreshman, isRedshirtFreshman, minutesAreMissing,
  freshmanSeason, freshmanShare, ladderByRank, freshmanProfile, MINUTE_BANDS,
  classifyProgramme, weightedMedian, weightsFromVerdict, STEP_POINTS, SPREAD_POINTS,
  originOf, cohortFor, MIN_COHORT_PLAYERS,
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
    expect(freshmanShare(rows, { season: '2025', minSquad: 2 })).toBeCloseTo(0.3, 5);
  });

  it('is null rather than zero when the squad has no minutes at all', () => {
    expect(freshmanShare([p({ minutes_played: 0, games_played: null })], { season: '2025', minSquad: 1 })).toBeNull();
  });

  // Marywood's 2023 squad had 39 players and a minutes figure for three. A
  // share computed from those three measures the readable rows, not the squad.
  it('refuses a squad whose minutes are mostly unrecorded', () => {
    const rows = [
      p({ player_name: 'A', minutes_played: 900, games_played: 17 }),
      ...Array.from({ length: 9 }, (_, i) =>
        p({ player_name: `M${i}`, minutes_played: 0, games_played: null })),
    ];
    expect(freshmanShare(rows, { season: '2025' })).toBeNull();
  });

  it('refuses a squad too small to be a squad', () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      p({ player_name: `S${i}`, minutes_played: 500, games_played: 12 }));
    expect(freshmanShare(rows, { season: '2025' })).toBeNull();
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
      ten('TBA', 'TBA', 'Andrew Richardson', 'Andrew Richardson'));
    expect(v.verdict).toBe('vacancy-in-window');
    expect(v.vacantSeasons).toEqual([2022, 2023]);
    expect(v.weightFrom).toBe(2024);
  });

  // The page said TBA; we never read the page. Those are opposite claims and
  // only the first is a finding — so an unresolved season outranks everything
  // else, including a real vacancy earlier in the window.
  it('will not assume the coach stayed through a season it could not read', () => {
    const v = classifyProgramme(prof([69, 41, 19, 2]),
      ten('TBA', 'TBA', 'Andrew Richardson', ''));
    expect(v.verdict).toBe('coach-unknown-recent');
    expect(v.unknownSeasons).toEqual([2025]);
    expect(v.knownThrough).toBe(2024);
    // Nothing is weighted toward a coach we cannot confirm is still there.
    expect(v.weightFrom).toBeNull();
  });

  // Bellarmine women's: four starter-level freshmen every season, and the
  // engine called it "one coach, a consistent pattern" purely because 2024
  // and 2025 came back blank. It was Babba, then McKinney, then Bornhoffer.
  it('does not call a programme steady when a season is unread', () => {
    const v = classifyProgramme(prof([23, 30, 26, 20]),
      ten('Paul Babba', 'Paul Babba', '', ''));
    expect(v.verdict).toBe('coach-unknown-recent');
    expect(v.unknownSeasons).toEqual([2024, 2025]);
  });

  // Bellarmine women's: 23%, 30%, 26%, 20% with four starter-level freshmen
  // every season, under Babba, then McKinney, then Bornhoffer. Compared
  // around the newest change alone it read `change-too-recent` — one season
  // and no guide. Across all three spells it is the strongest reading there
  // is: the programme plays its freshmen whoever is in charge.
  it('finds a pattern that held across more than one coaching change', () => {
    const tenure = tenureFor([
      { season: 2022, coach_name: 'Paul Babba' },
      { season: 2023, coach_name: 'Paul Babba' },
      { season: 2024, coach_name: 'Callie McKinney' },
      { season: 2025, coach_name: 'Steve Bornhoffer' },
      { season: 2026, coach_name: 'Steve Bornhoffer' },
    ]);
    const v = classifyProgramme(prof([23, 30, 26, 20]), tenure);
    expect(v.verdict).toBe('structural-through-changes');
    expect(v.coaches).toEqual(['Paul Babba', 'Callie McKinney', 'Steve Bornhoffer']);
    expect(v.swing).toBeLessThan(STEP_POINTS);
    // Every season counts — that is the whole point of the verdict.
    expect(v.weightFrom).toBeNull();
  });

  // Three coaches and a pattern that moved with them is not structural, and
  // calling it so would be the more expensive error of the two.
  it('does not call it structural when the pattern moved with the coaches', () => {
    const tenure = tenureFor([
      { season: 2022, coach_name: 'A Coach' },
      { season: 2023, coach_name: 'B Coach' },
      { season: 2024, coach_name: 'C Coach' },
      { season: 2025, coach_name: 'C Coach' },
    ]);
    expect(classifyProgramme(prof([4, 20, 40, 44]), tenure).verdict)
      .not.toBe('structural-through-changes');
  });

  // Cal State Dominguez Hills ran 23%, 26%, 4%, 30% under three coaches. The
  // segment means sit 9 points apart only because a 4 and a 30 cancel inside
  // one spell — a pattern that survived a change has to have been a pattern
  // first.
  it('does not call an unstable programme structural because the means cancel', () => {
    const tenure = tenureFor([
      { season: 2022, coach_name: 'Marine Cano' },
      { season: 2023, coach_name: 'Danielle Jones' },
      { season: 2024, coach_name: 'Adriana Valdez Lopez' },
      { season: 2025, coach_name: 'Adriana Valdez Lopez' },
    ]);
    const v = classifyProgramme(prof([23, 26, 4, 30]), tenure);
    expect(v.verdict).not.toBe('structural-through-changes');
    expect(v.spread).toBeGreaterThanOrEqual(SPREAD_POINTS);
  });

  // One change is the existing reading and stays it: two spells are a
  // comparison, three are a property.
  it('keeps a single change as continuity-through-change', () => {
    const v = classifyProgramme(prof([25, 24, 26, 25]),
      ten('Old Coach', 'New Coach', 'New Coach', 'New Coach'));
    expect(v.verdict).toBe('continuity-through-change');
  });

  // North Florida men's took Marlon Montanella for 2026; Marinatos and Davies
  // coached every season on file. There is no projection to make and saying
  // so is the answer.
  it('says a new coach has no record rather than projecting the old one', () => {
    const tenure = tenureFor([
      { season: 2022, coach_name: 'Derek Marinatos' },
      { season: 2023, coach_name: 'Derek Marinatos' },
      { season: 2024, coach_name: 'Jamie Davies' },
      { season: 2025, coach_name: 'Jamie Davies' },
      { season: 2026, coach_name: 'Marlon Montanella' },
    ]);
    const v = classifyProgramme(prof([21, 3, 17, 1]), tenure);
    expect(v.verdict).toBe('new-coach-no-record');
    expect(v.since).toBe(2026);
    expect(v.weightFrom).toBeNull();
    // The seasons it describes are stated, so nobody can read it as a forecast.
    expect(v.describes).toEqual([2022, 2023, 2024, 2025]);
  });

  it('says so when there is no coach on file at all', () => {
    expect(classifyProgramme(prof([10, 12, 11, 13]), null).verdict).toBe('coach-unknown');
  });

  it('will not describe a pattern from one season', () => {
    expect(classifyProgramme(prof([10]), GILLIS).verdict).toBe('too-few-seasons');
  });

  // Marywood had no minutes on file for 2022-2024 at all. Coercing those
  // nulls to 0 produced "0%, 0%, 0%, 74%" and made it one of the largest
  // regime changes in the pool — on the strength of a missing column.
  it('drops an unmeasurable season instead of reading it as nobody playing', () => {
    const withNulls = {
      seasons: [null, null, null, 74].map((v, i) => ({
        season: String(2022 + i),
        shareOfSquadMinutes: v === null ? null : v / 100,
        ladder: [], bands: {},
      })),
    };
    const v = classifyProgramme(withNulls,
      ten('Matt Guinto', 'Matt Guinto', 'Brian Osborne', 'Brian Osborne'));
    expect(v.verdict).toBe('too-few-seasons');
    expect(v.verdict).not.toBe('regime-change');
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

describe('reading the ladder for the recruit in front of you', () => {
  // McKendree men's, compressed: at this programme the freshmen who play are
  // the international ones, and the whole-intake ladder therefore describes a
  // competition a US high-school recruit is not in.
  const MCK = [];
  for (const season of ['2022', '2023', '2024', '2025']) {
    // three internationals who play, three Americans who mostly do not
    MCK.push(p({ season, player_name: `i1-${season}`, nationality: 'International', country: 'Sweden', minutes_played: 1850, games_played: 20 }));
    MCK.push(p({ season, player_name: `i2-${season}`, nationality: 'International', country: 'Denmark', minutes_played: 1092, games_played: 18 }));
    MCK.push(p({ season, player_name: `i3-${season}`, nationality: 'International', country: 'Spain', minutes_played: 950, games_played: 16 }));
    MCK.push(p({ season, player_name: `u1-${season}`, nationality: 'USA', minutes_played: 999, games_played: 14 }));
    MCK.push(p({ season, player_name: `u2-${season}`, nationality: 'USA', minutes_played: 54, games_played: 4 }));
    MCK.push(p({ season, player_name: `u3-${season}`, nationality: 'USA', minutes_played: 17, games_played: 2 }));
  }
  const SEASONS = ['2022', '2023', '2024', '2025'];

  it('reads origin from either column, and refuses to guess without one', () => {
    expect(originOf({ nationality: 'USA' })).toBe('domestic');
    expect(originOf({ nationality: 'International', country: 'Sweden' })).toBe('international');
    expect(originOf({ nationality: 'New Zealand' })).toBe('international');
    // 1,834 roster rows carry neither. Bucketing those as domestic by default
    // is the same error as reading a blank minutes cell as a zero.
    expect(originOf({})).toBeNull();
  });

  it('derives the cohort from the athlete', () => {
    expect(cohortFor({ position: 'Defender', nationality: 'New Zealand' }))
      .toEqual({ position: 'DEFENSE', origin: 'international' });
    // An unrecognised position narrows nothing rather than narrowing wrongly.
    expect(cohortFor({ position: 'Sweeper', nationality: 'USA' }))
      .toEqual({ position: null, origin: 'domestic' });
  });

  it('gives a domestic recruit the ladder they are actually on', () => {
    const whole = freshmanProfile(MCK, { seasons: SEASONS, maxRank: 3 });
    const us = freshmanProfile(MCK, { seasons: SEASONS, origin: 'domestic', maxRank: 3 });
    expect(whole.byRank.map((r) => r.median)).toEqual([1850, 1092, 999]);
    expect(us.byRank.map((r) => r.median)).toEqual([999, 54, 17]);
    expect(us.cohort).toMatchObject({ origin: 'domestic', applied: true, refused: null });
  });

  it('narrows to the athlete when one is given', () => {
    // Ryan Billings is a New Zealander, so the international ladder is his.
    const forRyan = freshmanProfile(MCK, {
      seasons: SEASONS, athlete: { position: 'Defender', nationality: 'New Zealand' }, maxRank: 3,
    });
    // Every row here is a DEFENSE, so position narrows nothing and origin does.
    expect(forRyan.cohort.origin).toBe('international');
    expect(forRyan.byRank[0].median).toBe(1850);
  });

  // A caller who names a cohort gets that cohort, thin or not. Relaxing under
  // an explicit request went off once already: an aggregate that asked 1,922
  // programmes for their goalkeeper ladder got the whole intake back wherever
  // the keepers were too few, and reported 46,826 freshman goalkeepers — more
  // than every outfield position combined.
  it('gives an explicit cohort exactly what was asked for, and flags it thin', () => {
    const thin = MCK.concat([p({ season: '2025', player_name: 'lone-gk', position: 'GOALKEEPER', nationality: 'USA', minutes_played: 1900, games_played: 20 })]);
    const prof = freshmanProfile(thin, { seasons: SEASONS, position: 'GOALKEEPER', maxRank: 3 });
    expect(prof.cohort.position).toBe('GOALKEEPER');
    expect(prof.cohort.thin).toMatch(/1 in 1 season/);
    expect(prof.seasonsObserved).toBe(1);           // the one keeper's season, nobody else's
    expect(prof.byRank[0].median).toBe(1900);
  });

  it('leaves thin null for an explicit cohort with enough in it', () => {
    const prof = freshmanProfile(MCK, { seasons: SEASONS, origin: 'domestic' });
    expect(prof.cohort.thin).toBeNull();
  });

  // The important half of the refusal. A US defender here is 5 players over
  // 2 seasons; falling all the way back to the whole intake would hand him
  // the international numbers, which is the most misleading answer available.
  it('relaxes one dimension rather than falling back to the whole intake', () => {
    const few = MCK.filter((r) => !(r.nationality === 'USA' && ['2022', '2023'].includes(r.season)));
    const prof = freshmanProfile(few, {
      seasons: SEASONS, athlete: { position: 'Goalkeeper', nationality: 'USA' }, maxRank: 3,
    });
    // No US keepers at all, so position is dropped and origin survives.
    expect(prof.cohort).toMatchObject({ position: null, origin: 'domestic' });
    expect(prof.cohort.relaxed).toBe('domestic');
    expect(prof.cohort.refused).toMatch(/GOALKEEPER \/ domestic/);
    expect(prof.byRank[0].median).toBe(999);   // the US ladder, not the whole intake's 1850
  });

  it('does not report a squad share for a narrowed ladder', () => {
    const us = freshmanProfile(MCK, { seasons: SEASONS, origin: 'domestic' });
    for (const s of us.seasons) expect(s.shareOfSquadMinutes).toBeNull();
  });

  // The roster stores DEFENSE and the intake form stores "Defender".
  // Comparing them raw matched nobody, which read as a programme that had
  // never recruited the position.
  it('matches a form spelling of a position to the roster spelling', () => {
    const s = freshmanSeason(MCK, { season: '2025', position: 'Defender' });
    expect(s.intake).toBe(6);
    expect(MIN_COHORT_PLAYERS).toBeGreaterThan(0);
  });
});

describe('a ladder that rises as you go down it', () => {
  // Within one season the ladder falls by construction, so a rise across the
  // medians is the ranks being taken over different sets of seasons — North
  // Florida men's read 209, 346, 529 for a US defender across 4, 2 and 2.
  it('marks everything from the first rise incomparable', () => {
    const seasons = [
      { ladder: [{ rank: 1, minutes: 200 }, { rank: 2, minutes: 100 }] },
      { ladder: [{ rank: 1, minutes: 220 }] },
      { ladder: [{ rank: 1, minutes: 180 }, { rank: 2, minutes: 600 }] },
    ];
    const byRank = ladderByRank(seasons);
    expect(byRank[0].comparable).toBe(true);
    expect(byRank[1].median).toBeGreaterThan(byRank[0].median);
    expect(byRank[1].comparable).toBe(false);
  });

  it('leaves a well-behaved ladder comparable throughout', () => {
    const seasons = [
      { ladder: [{ rank: 1, minutes: 1000 }, { rank: 2, minutes: 400 }, { rank: 3, minutes: 50 }] },
      { ladder: [{ rank: 1, minutes: 900 }, { rank: 2, minutes: 350 }, { rank: 3, minutes: 40 }] },
    ];
    expect(ladderByRank(seasons).every((r) => r.comparable)).toBe(true);
  });
});
