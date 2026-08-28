import { describe, it, expect } from 'vitest';
import {
  nameKey, vacancyObservations, dials, positionHistory,
  programmePhilosophy, playerFit, MIN_POSITION_MINUTES,
  freshmanPoints, newcomerPoints, arrivalWindow, secondYearProgression,
  intakeBySeason, positionSeasonGrid, eligibilityCliff, namedArrivals, depthChartAt,
} from './philosophy.js';

/**
 * A roster row. Defaults to a measured, unremarkable outfield player, so each
 * test only states the thing it is about.
 */
const p = (over) => ({
  college_name: 'Test College', sport: 'mens-soccer',
  season: '2022', player_name: 'A Player', position: 'DEFENSE',
  class_year_label: 'So.', minutes_played: 500, games_played: 15, ...over,
});

/** Enough minutes at a position that the floor is not what the test is about. */
const loose = { minPositionMinutes: 100 };

describe('nameKey', () => {
  // Every one of these differences would otherwise read as a player leaving
  // and a different player arriving — a departure and a signing invented out
  // of a typographic difference between two seasons' pages.
  it('sees through accents, case and punctuation', () => {
    expect(nameKey('Sadé Boswell')).toBe(nameKey('Sade Boswell'));
    expect(nameKey("Aidan O'Sullivan")).toBe(nameKey('Aidan OSullivan'));
    expect(nameKey('  Luke   Fuller ')).toBe('luke fuller');
  });

  it('does not merge two different people', () => {
    expect(nameKey('John Smith')).not.toBe(nameKey('Peter Smith'));
  });
});

describe('vacancyObservations', () => {
  // The distinction that took a bug to find: `returned` answers "did last
  // season's player come back", `wasHere` answers "was this season's player
  // here before". Using one set for both reports every squad as 100%
  // returning, because every player in next season's list is trivially in a
  // set built from next season's list.
  it('separates who came back from who is new', () => {
    const rows = [
      p({ season: '2022', player_name: 'Stays', minutes_played: 900 }),
      p({ season: '2022', player_name: 'Leaves', minutes_played: 800 }),
      p({ season: '2023', player_name: 'Stays', minutes_played: 900 }),
      p({ season: '2023', player_name: 'Newbie', class_year_label: 'Fr.', minutes_played: 700 }),
      p({ season: '2023', player_name: 'Transfer In', class_year_label: 'Jr.', minutes_played: 400 }),
    ];
    const [o] = vacancyObservations(rows, loose);
    expect(o.departed).toBe(1);
    expect(o.departedStarters).toBe(1);
    expect(o.departedStarterNames).toEqual([{ name: 'Leaves', minutes: 800 }]);
    // 900 returning, 700 freshman, 400 newcomer, out of 2000.
    expect(Math.round(o.returningShare * 100)).toBe(45);
    expect(Math.round(o.freshShare * 100)).toBe(35);
    expect(Math.round(o.newcomerShare * 100)).toBe(20);
  });

  // A transfer, a JUCO arrival and an older first-year recruit are one
  // category here, because the roster cannot tell them apart and for a
  // recruit they mean the same thing: somebody brought in ready to play.
  it('counts a new non-freshman as a newcomer, not a freshman', () => {
    const rows = [
      p({ season: '2022', player_name: 'Gone', minutes_played: 1000 }),
      p({ season: '2023', player_name: 'Portal', class_year_label: 'Sr.', minutes_played: 1000 }),
    ];
    const [o] = vacancyObservations(rows, loose);
    expect(o.freshShare).toBe(0);
    expect(o.newcomerShare).toBe(1);
    expect(o.newcomerStarters).toBe(1);
  });

  // A position group that barely played is a couple of legible rows, not a
  // description of the programme.
  it('skips a position that did not carry a real season', () => {
    const rows = [
      p({ season: '2022', minutes_played: 200 }),
      p({ season: '2023', minutes_played: 200 }),
    ];
    expect(vacancyObservations(rows)).toEqual([]);
    expect(MIN_POSITION_MINUTES).toBeGreaterThan(200);
  });

  // Bates, Hamilton and Elmira print a graduation year — or nothing — where
  // the class belongs. Read as zero freshmen, they became six of the ten
  // coaches least likely to play one anywhere in the pool.
  it('flags a squad whose class labels cannot be read', () => {
    const unreadable = [
      p({ season: '2022', player_name: 'X', minutes_played: 900 }),
      p({ season: '2023', player_name: 'Y', class_year_label: '2027', minutes_played: 900 }),
    ];
    expect(vacancyObservations(unreadable, loose)[0].freshmenReadable).toBe(false);

    const readable = [
      ...unreadable,
      p({ season: '2023', player_name: 'Z', class_year_label: 'Fr.', minutes_played: 100 }),
    ];
    expect(vacancyObservations(readable, loose)[0].freshmenReadable).toBe(true);
  });

  // A player labelled a first-year who was already here did not arrive. 322
  // rows across the pool are labelled Fr. in two consecutive seasons, and
  // counting them as returning AND incoming put one programme's three shares
  // 14 points over 100.
  it('partitions the minutes exactly three ways', () => {
    const rows = [
      p({ season: '2022', player_name: 'Mislabelled', class_year_label: 'Fr.', minutes_played: 900 }),
      p({ season: '2022', player_name: 'Gone', minutes_played: 900 }),
      p({ season: '2023', player_name: 'Mislabelled', class_year_label: 'Fr.', minutes_played: 900 }),
      p({ season: '2023', player_name: 'Actual Freshman', class_year_label: 'Fr.', minutes_played: 600 }),
      p({ season: '2023', player_name: 'Portal', class_year_label: 'Jr.', minutes_played: 300 }),
    ];
    const [o] = vacancyObservations(rows, loose);
    expect(o.returningShare + o.freshShare + o.newcomerShare).toBeCloseTo(1, 10);
    // The one who was already here counts as returning, not as an arrival.
    expect(Math.round(o.returningShare * 100)).toBe(50);
    expect(Math.round(o.freshShare * 100)).toBe(33);
  });

  it('does not read an unrecorded minutes cell as a benching', () => {
    const rows = [
      p({ season: '2022', player_name: 'Known', minutes_played: 900 }),
      // 0 minutes across 12 games is a gap in the data, not a player who sat.
      p({ season: '2022', player_name: 'Unrecorded', minutes_played: 0, games_played: 12 }),
      p({ season: '2023', player_name: 'Known', minutes_played: 900 }),
    ];
    const [o] = vacancyObservations(rows, loose);
    expect(o.prevLoad).toBe(900);
    expect(o.departed).toBe(0);
  });
});

describe('dials', () => {
  // Dropping the unreadable ones, rather than averaging a zero into them,
  // is the whole reason `freshmenReadable` is carried on the observation.
  it('leaves an unreadable observation out of the average', () => {
    const obs = [
      { freshmenReadable: true, freshShare: 0.4, newcomerShare: 0.1, returningShare: 0.5 },
      { freshmenReadable: false, freshShare: 0, newcomerShare: 0, returningShare: 1 },
    ];
    expect(dials(obs)).toEqual({ n: 1, freshman: 40, newcomer: 10, returning: 50 });
  });

  it('reports nothing rather than zero when nothing is readable', () => {
    expect(dials([{ freshmenReadable: false, freshShare: 0 }]))
      .toEqual({ n: 0, freshman: null, newcomer: null, returning: null });
  });
});

describe('positionHistory', () => {
  const obs = [
    { pos: 'DEFENSE', to: '2023', freshmenReadable: true, departedStarters: 2, freshStarters: 1,
      newcomerStarters: 0, bestFresh: 1013, departedStarterNames: [{ name: 'Luke Fuller', minutes: 1252 }],
      freshShare: 0.3, newcomerShare: 0, returningShare: 0.7 },
    { pos: 'DEFENSE', to: '2024', freshmenReadable: true, departedStarters: 0, freshStarters: 0,
      newcomerStarters: 1, bestFresh: 0, departedStarterNames: [],
      freshShare: 0.1, newcomerShare: 0.2, returningShare: 0.7 },
    { pos: 'FORWARD', to: '2023', freshmenReadable: true, departedStarters: 5, freshStarters: 5,
      newcomerStarters: 0, bestFresh: 900, departedStarterNames: [],
      freshShare: 0.9, newcomerShare: 0, returningShare: 0.1 },
  ];

  it('counts openings and who took them, at that position only', () => {
    const h = positionHistory(obs, 'DEFENSE');
    expect(h.transitions).toBe(2);
    expect(h.startersDeparted).toBe(2);
    expect(h.openings).toBe(1);          // only 2023 had a starter leave
    expect(h.freshmanTookIt).toBe(1);
    expect(h.newcomerTookIt).toBe(0);    // 2024's newcomer starter was not an opening
  });

  // The roster stores DEFENSE and the intake form stores "Defender".
  it('accepts either spelling of the position', () => {
    expect(positionHistory(obs, 'Defender').transitions).toBe(2);
    expect(positionHistory(obs, 'CB').position).toBe('DEFENSE');
  });

  it('names who left, so the report can say it', () => {
    expect(positionHistory(obs, 'DEFENSE').seasons[0].departedNames)
      .toEqual([{ name: 'Luke Fuller', minutes: 1252 }]);
  });
});

describe('programmePhilosophy', () => {
  // A squad has to be a squad: freshmanShare refuses fewer than ten players,
  // so a three-player fixture reads as too-few-seasons and tests nothing.
  const season = (yr) => ([
    p({ season: yr, player_name: `Snr ${yr}`, class_year_label: 'Sr.', minutes_played: 1400, games_played: 18 }),
    p({ season: yr, player_name: `Fr ${yr}`, class_year_label: 'Fr.', minutes_played: 800, games_played: 16 }),
    p({ season: yr, player_name: `Mid ${yr}`, position: 'MIDFIELD', class_year_label: 'Jr.', minutes_played: 1200, games_played: 17 }),
    ...Array.from({ length: 9 }, (_, i) => p({
      season: yr, player_name: `Sub ${i} ${yr}`, class_year_label: 'So.',
      minutes_played: 300, games_played: 10,
    })),
  ]);
  const rows = ['2022', '2023', '2024', '2025'].flatMap((y) => season(y));
  const coachRows = [2022, 2023, 2024, 2025, 2026]
    .map((s) => ({ season: s, coach_name: 'One Coach', reason: '' }));

  it('reads the ladder, the coach and the fill mix together', () => {
    const ph = programmePhilosophy({ rows, coachRows });
    expect(ph.seasonsObserved).toBe(4);
    expect(ph.ladder[0].median).toBe(800);
    expect(ph.coach.coach).toBe('One Coach');
    expect(ph.verdict.verdict).toBe('steady');
    expect(ph.describes).toEqual(['2022', '2023', '2024', '2025']);
  });

  // The point of carrying 2026 at all: a record that belongs to somebody who
  // has left has to say so.
  it('says whether the coach who ran these seasons is still there', () => {
    expect(programmePhilosophy({ rows, coachRows }).coachStillInPost).toBe(true);

    const left = [...coachRows.slice(0, 4), { season: 2026, coach_name: 'Someone Else', reason: '' }];
    const ph = programmePhilosophy({ rows, coachRows: left });
    expect(ph.coachStillInPost).toBe(true);       // the CURRENT coach is in post
    expect(ph.coachForRecruitSeason).toBe('Someone Else');
    expect(ph.verdict.verdict).toBe('new-coach-no-record');
  });

  // Three answers, and the third is the point: an unread season may not be
  // filled in from the ones around it.
  it('will not guess at a season it could not read', () => {
    const unread = [...coachRows.slice(0, 4),
      { season: 2026, coach_name: '', reason: 'no-usable-page' }];
    expect(programmePhilosophy({ rows, coachRows: unread }).coachStillInPost).toBeNull();
  });

  // Bradley has a freshman ladder and no vacancy data at all. A report that
  // needed all three sections would render nothing for it.
  it('degrades one section at a time', () => {
    // A squad big enough to read a ladder from, but no position group that
    // ever carried a season's minutes — so there is nothing to say about who
    // fills a vacancy.
    const thin = ['2022', '2023', '2024', '2025'].flatMap((yr) => ([
      p({ season: yr, player_name: `Fr ${yr}`, class_year_label: 'Fr.', minutes_played: 90, games_played: 6 }),
      ...Array.from({ length: 11 }, (_, i) => p({
        season: yr, player_name: `Sub ${i} ${yr}`, class_year_label: 'So.',
        minutes_played: 40, games_played: 4,
      })),
    ]));
    const ph = programmePhilosophy({ rows: thin, coachRows: [] });
    expect(ph.freshman).not.toBeNull();
    expect(ph.ladder.length).toBeGreaterThan(0);
    expect(ph.dials.n).toBe(0);
    expect(ph.dials.freshman).toBeNull();     // null, never a confident zero
  });

  // Handed two programmes at once it would build one fictional squad, and
  // each roster's names would read as departures from the other.
  it('refuses rows from more than one programme', () => {
    const mixed = [
      p({ college_name: 'One', minutes_played: 900 }),
      p({ college_name: 'Two', minutes_played: 900 }),
    ];
    expect(() => vacancyObservations(mixed, loose)).toThrow(/one programme/);
  });

  it('returns something renderable for a programme with no rows at all', () => {
    const ph = programmePhilosophy({ rows: [], coachRows: [] });
    expect(ph.freshman).toBeNull();
    expect(ph.verdict).toBeNull();
    expect(ph.ladder).toEqual([]);
    expect(ph.describes).toEqual([]);
  });
});

describe('playerFit', () => {
  // A programme whose freshmen who play are the international ones. Read
  // whole it looks open; read for a domestic recruit it is not.
  const rows = ['2022', '2023', '2024', '2025'].flatMap((y) => [
    p({ season: y, player_name: `Intl A ${y}`, class_year_label: 'Fr.', nationality: 'International', country: 'Sweden', minutes_played: 1500, games_played: 18 }),
    p({ season: y, player_name: `Intl B ${y}`, class_year_label: 'Fr.', nationality: 'International', country: 'Spain', minutes_played: 900, games_played: 16 }),
    p({ season: y, player_name: `US A ${y}`, class_year_label: 'Fr.', nationality: 'USA', minutes_played: 60, games_played: 5 }),
    p({ season: y, player_name: `US B ${y}`, class_year_label: 'Fr.', nationality: 'USA', minutes_played: 20, games_played: 3 }),
    p({ season: y, player_name: `Snr ${y}`, class_year_label: 'Sr.', minutes_played: 1500, games_played: 18 }),
  ]);
  const philosophy = programmePhilosophy({ rows, coachRows: [] });

  it('gives the athlete the ladder they are actually on', () => {
    const whole = philosophy.ladder[0].median;
    const forUs = playerFit(philosophy, { position: 'Defender', nationality: 'USA' }, rows);
    expect(whole).toBe(1500);
    expect(forUs.ladder[0].median).toBe(60);
    expect(forUs.cohort.origin).toBe('domestic');
    // The whole-intake figure travels with it, because the gap is the finding.
    expect(forUs.wholeIntakeLadder[0].median).toBe(1500);
  });

  it('states which cohort it ended up reading', () => {
    const forNz = playerFit(philosophy, { position: 'Defender', nationality: 'New Zealand' }, rows);
    expect(forNz.cohort.origin).toBe('international');
    expect(forNz.ladder[0].median).toBe(1500);
  });

  it('cuts the position history to the athlete position', () => {
    const fit = playerFit(philosophy, { position: 'Defender', nationality: 'USA' }, rows);
    expect(fit.position.position).toBe('DEFENSE');
  });

  it('narrows nothing rather than wrongly for an unrecognised position', () => {
    const fit = playerFit(philosophy, { position: 'Sweeper', nationality: null }, rows);
    expect(fit.asked).toEqual({ position: null, origin: null });
    expect(fit.position.transitions).toBe(0);
  });
});

describe('the points a chart draws', () => {
  // Names must differ ALPHABETICALLY between seasons: nameKey strips digits,
  // so "Fresh 2022" and "Fresh 2023" are one person to the season join.
  const NAMES = { 2022: ['Alan Ash', 'Vic Vale'], 2023: ['Ben Blue', 'Wes Ward'],
    2024: ['Cal Cole', 'Xan Xu'], 2025: ['Dan Dole', 'Yan York'] };
  const squad = (season, over = []) => ([
    p({ season, player_name: NAMES[season][0], class_year_label: 'Fr.', minutes_played: 900, games_played: 17, games_started: 15 }),
    p({ season, player_name: NAMES[season][1], class_year_label: 'Sr.', minutes_played: 1400, games_played: 18 }),
    ...over,
  ]);

  it('carries origin and band onto every point', () => {
    const pts = freshmanPoints(squad('2022'), { seasons: ['2022'] });
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ band: 'impact', position: 'DEFENSE', gamesStarted: 15 });
  });

  // vacancyObservations excludes the 322 rows labelled Fr. in two consecutive
  // seasons. A scatter that kept them would not add up to the dials printed on
  // the facing page.
  it('agrees with the fill mix about who is a freshman', () => {
    const rows = [
      ...squad('2022', [p({ season: '2022', player_name: 'Repeat', class_year_label: 'Fr.', minutes_played: 500, games_played: 12 })]),
      ...squad('2023', [p({ season: '2023', player_name: 'Repeat', class_year_label: 'Fr.', minutes_played: 500, games_played: 12 })]),
    ];
    const names = freshmanPoints(rows, { seasons: ['2022', '2023'] })
      .filter((x) => x.season === '2023').map((x) => x.name);
    expect(names).toContain('Ben Blue');
    expect(names).not.toContain('Repeat');   // already here, so not an arrival
  });

  // A quarter of men's programmes genuinely sign nobody. An empty array cannot
  // be allowed to mean both that and "we have no previous season to compare".
  it('says which seasons an arrival could even be detected in', () => {
    const rows = [...squad('2022'), ...squad('2023')];
    expect(arrivalWindow(rows, { seasons: ['2022', '2023'] }))
      .toEqual({ measurable: ['2023'], unmeasurable: ['2022'] });
  });

  it('separates a transfer from a first-year', () => {
    const rows = [
      ...squad('2022'),
      ...squad('2023', [p({ season: '2023', player_name: 'Portal', class_year_label: 'Jr.', minutes_played: 800, games_played: 15 })]),
    ];
    const nc = newcomerPoints(rows, { seasons: ['2022', '2023'] });
    expect(nc.map((x) => x.name).sort()).toEqual(['Portal', 'Wes Ward']);
  });

  // The slope chart exists to show the ones who left. Collapsing "gone" into
  // "unrecorded" erases exactly the finding.
  it('tells apart a freshman who left, one who stayed, and one whose minutes were not recorded', () => {
    const rows = [
      p({ season: '2022', player_name: 'Stayed', class_year_label: 'Fr.', minutes_played: 300, games_played: 10 }),
      p({ season: '2022', player_name: 'Left', class_year_label: 'Fr.', minutes_played: 400, games_played: 11 }),
      p({ season: '2022', player_name: 'Blank', class_year_label: 'Fr.', minutes_played: 500, games_played: 12 }),
      p({ season: '2023', player_name: 'Stayed', class_year_label: 'So.', minutes_played: 900, games_played: 17 }),
      p({ season: '2023', player_name: 'Blank', class_year_label: 'So.', minutes_played: 0, games_played: null }),
    ];
    const byName = Object.fromEntries(
      secondYearProgression(rows, { seasons: ['2022'] }).map((x) => [x.name, x]));
    expect(byName.Stayed).toMatchObject({ year2State: 'measured', year2: 900 });
    expect(byName.Left).toMatchObject({ year2State: 'gone', year2: null });
    expect(byName.Blank).toMatchObject({ year2State: 'unrecorded', year2: null });
  });

  // A missing column reads as a season that did not happen.
  it('keeps a season whose minutes were never recorded, with a null load', () => {
    const rows = [
      ...squad('2022'),
      ...Array.from({ length: 6 }, (_, i) => p({
        season: '2023', player_name: `Ghost ${i}`, minutes_played: 0, games_played: null,
      })),
    ];
    const seasons = intakeBySeason(rows, { seasons: ['2022', '2023'] });
    expect(seasons.map((s) => s.season)).toEqual(['2022', '2023']);
    expect(seasons[1]).toMatchObject({ readable: false, load: null, freshmanShare: null });
  });

  it('gives a position cell null rather than zero when its rows are unreadable', () => {
    const rows = [
      p({ season: '2022', player_name: 'One', minutes_played: 900, games_played: 17 }),
      ...Array.from({ length: 5 }, (_, i) => p({
        season: '2022', player_name: `Blank ${i}`, minutes_played: 0, games_played: null,
      })),
    ];
    const grid = positionSeasonGrid(rows, { seasons: ['2022'] });
    const def = grid.find((g) => g.position === 'DEFENSE').cells[0];
    expect(def).toMatchObject({ players: 6, measured: 1, load: null, share: null });
  });
});

describe('the squad a recruit would join', () => {
  const squadRow = (over) => ({
    college_name: 'Test College', sport: 'mens-soccer', season: '2026',
    player_name: 'A', position: 'DEFENSE', class_year_label: 'Sr.',
    eligibility_end_year: 2027, projected_minutes: 900, prior_programme: 'Test College', ...over,
  });

  it('adds up the minutes due to leave, by the year they end', () => {
    const cliff = eligibilityCliff([
      squadRow({ player_name: 'A', eligibility_end_year: 2026, projected_minutes: 1000 }),
      squadRow({ player_name: 'B', eligibility_end_year: 2026, projected_minutes: 500 }),
      squadRow({ player_name: 'C', eligibility_end_year: 2028, projected_minutes: 700 }),
    ]);
    expect(cliff.map((y) => [y.year, y.total])).toEqual([[2026, 1500], [2028, 700]]);
  });

  // A quarter of programmes have no 2026 roster at all, so this is the common
  // path, not the edge.
  it('returns nothing rather than zeros when there is no squad on file', () => {
    expect(eligibilityCliff([])).toBeNull();
    expect(depthChartAt([], 'Defender')).toBeNull();
    expect(namedArrivals([], { school: 'Test College' })).toEqual([]);
  });

  // Most prior_programme values are the programme's own name — those are
  // returners, and counting them as arrivals would treat the whole squad as
  // transfers.
  it('counts only players who came from somewhere else', () => {
    const arrivals = namedArrivals([
      squadRow({ player_name: 'Returner', prior_programme: 'Test College' }),
      squadRow({ player_name: 'Signing', prior_programme: 'Another School', projected_minutes: null }),
    ], { school: 'Test College' });
    expect(arrivals.map((a) => a.name)).toEqual(['Signing']);
    expect(arrivals[0].from).toBe('Another School');
  });

  it('orders the depth chart by who is expected to play most', () => {
    const depth = depthChartAt([
      squadRow({ player_name: 'Backup', projected_minutes: 100 }),
      squadRow({ player_name: 'Starter', projected_minutes: 1400, eligibility_end_year: 2026 }),
      squadRow({ player_name: 'Keeper', position: 'GOALKEEPER', projected_minutes: 1800 }),
    ], 'Defender');
    expect(depth.map((d) => d.name)).toEqual(['Starter', 'Backup']);
    expect(depth[0].eligibleTo).toBe(2026);
  });
});
