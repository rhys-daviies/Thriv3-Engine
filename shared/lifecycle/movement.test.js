/**
 * Tracks C to G — continuity, matching, destination comparison and outcome.
 *
 * Several of these tests exist to hold a line rather than to check arithmetic:
 * nationality must never influence a match, a senior's exit must never be
 * called early, an ambiguous candidate must never surface as a destination,
 * and no field anywhere may be a transfer rate.
 */
import { describe, it, expect } from 'vitest';
import {
  continuityObservations, continuitySummary, buildRosterIndex,
  CONTINUITY, EXIT_KIND,
} from './continuity.js';
import {
  movementObservations, compareProgrammes, attachRoleAndOutcome,
  programmeMovementSummary, identitySignals, MATCH_STATUS, isObserved,
  SIMILARITY, SIMILAR_MINUTES, deriveBands,
} from './movement.js';

const row = (o = {}) => ({
  id: o.id ?? `r${Math.random()}`,
  college_name: o.college_name ?? 'Alpha',
  sport: 'mens-soccer',
  division: o.division ?? 'NCAA D1',
  season: String(o.season ?? '2024'),
  player_name: o.player_name ?? 'Alex Morgan',
  class_year_label: 'class_year_label' in o ? o.class_year_label : 'So.',
  position: 'position' in o ? o.position : 'Defender',
  minutes_played: 'minutes_played' in o ? o.minutes_played : 800,
  games_played: 15, games_started: 12,
  nationality: 'nationality' in o ? o.nationality : 'USA',
  hometown: 'hometown' in o ? o.hometown : 'Phoenix, AZ',
  estimated_graduation_year: 'estimated_graduation_year' in o ? o.estimated_graduation_year : 2026,
  eligibility_end_year: 2026,
  prior_programme: o.prior_programme ?? null,
});

/** Both programmes need a roster in both seasons or the transition is unreadable. */
const filler = (programme, season, n = 2) => Array.from({ length: n }, (_, i) => row({
  college_name: programme, season, player_name: `Filler ${programme} ${i}`,
}));

describe('roster continuity', () => {
  it('records a return', () => {
    const rows = [
      row({ season: 2024, player_name: 'A One' }),
      row({ season: 2025, player_name: 'A One', class_year_label: 'Jr.' }),
      ...filler('Alpha', '2024'), ...filler('Alpha', '2025'),
    ];
    const obs = continuityObservations(rows).filter((o) => o.name === 'A One');
    expect(obs[0].status).toBe(CONTINUITY.RETURNED);
  });

  it('records an absence as NOT_OBSERVED and never as a transfer', () => {
    const rows = [
      row({ season: 2024, player_name: 'B Two' }),
      ...filler('Alpha', '2024'), ...filler('Alpha', '2025'),
    ];
    const obs = continuityObservations(rows).filter((o) => o.name === 'B Two');
    expect(obs[0].status).toBe(CONTINUITY.NOT_OBSERVED);
    expect(JSON.stringify(obs[0])).not.toMatch(/transfer/i);
  });

  it('calls the transition unreadable where the next roster does not exist', () => {
    const rows = [row({ season: 2024, player_name: 'C Three' }), ...filler('Alpha', '2024')];
    const obs = continuityObservations(rows).filter((o) => o.name === 'C Three');
    expect(obs[0].status).toBe(CONTINUITY.UNREADABLE);
    const summary = continuitySummary(obs);
    expect(summary.returnable).toBe(0);
    expect(summary.unreadable).toBe(1);
    expect(summary.retention).toBeNull();
  });

  // The correction the audit forced: eligibility_end_year implies a senior has
  // another season, and reading it that way calls every graduation early.
  it('treats a departing senior as an expected exit, not an early one', () => {
    const rows = [
      row({ season: 2024, player_name: 'D Four', class_year_label: 'Sr.', eligibility_end_year: 2025 }),
      ...filler('Alpha', '2024'), ...filler('Alpha', '2025'),
    ];
    const [o] = continuityObservations(rows).filter((x) => x.name === 'D Four');
    expect(o.exitKind).toBe(EXIT_KIND.EXPECTED_EXIT);
  });

  it('treats a departing graduate student as an expected exit', () => {
    const rows = [
      row({ season: 2024, player_name: 'E Five', class_year_label: 'Gr.' }),
      ...filler('Alpha', '2024'), ...filler('Alpha', '2025'),
    ];
    const [o] = continuityObservations(rows).filter((x) => x.name === 'E Five');
    expect(o.exitKind).toBe(EXIT_KIND.EXPECTED_EXIT);
  });

  it('treats a departing first-year, sophomore or junior as an early exit', () => {
    for (const label of ['Fr.', 'So.', 'Jr.']) {
      const rows = [
        row({ season: 2024, player_name: 'F Six', class_year_label: label }),
        ...filler('Alpha', '2024'), ...filler('Alpha', '2025'),
      ];
      const [o] = continuityObservations(rows).filter((x) => x.name === 'F Six');
      expect(o.exitKind).toBe(EXIT_KIND.EARLY_EXIT);
    }
  });

  it('will not claim an exit kind for an unreadable class label', () => {
    const rows = [
      row({ season: 2024, player_name: 'G Seven', class_year_label: 'class of 2027' }),
      ...filler('Alpha', '2024'), ...filler('Alpha', '2025'),
    ];
    const [o] = continuityObservations(rows).filter((x) => x.name === 'G Seven');
    expect(o.exitKind).toBe(EXIT_KIND.UNKNOWN_EXIT);
  });

  it('suppresses a slice share below the minimum and keeps the counts', () => {
    const rows = [
      row({ season: 2024, player_name: 'H A', minutes_played: 900 }),
      ...filler('Alpha', '2024'), ...filler('Alpha', '2025'),
    ];
    const s = continuitySummary(continuityObservations(rows), { minSlice: 8 });
    expect(s.starterRetention.retention).toBeNull();
    expect(s.starterRetention.suppressed).toBe(true);
    expect(s.starterRetention.returnable).toBeGreaterThan(0);
  });
});

describe('movement matching', () => {
  const pair = (extra = {}) => [
    row({ season: 2024, player_name: 'M One', college_name: 'Alpha', class_year_label: 'So.' }),
    row({
      season: 2025, player_name: 'M One', college_name: 'Beta', class_year_label: 'Jr.', ...extra,
    }),
    ...filler('Alpha', '2024'), ...filler('Alpha', '2025'),
    ...filler('Beta', '2024'), ...filler('Beta', '2025'),
  ];

  it('MATCH_A when the hometown agrees, even across a spelling variant', () => {
    const [m] = movementObservations(pair({ hometown: 'Phoenix, Ariz.' }))
      .filter((x) => x.name === 'M One');
    expect(m.status).toBe(MATCH_STATUS.MATCH_A);
    expect(m.destinationProgramme).toBe('Beta');
    expect(m.signals.hometown).toBe(true);
    expect(isObserved(m)).toBe(true);
  });

  it('MATCH_B when the hometown does not agree but three other signals do', () => {
    const [m] = movementObservations(pair({ hometown: 'Denver, CO' }))
      .filter((x) => x.name === 'M One');
    // position + classProgression + graduationYear
    expect(m.status).toBe(MATCH_STATUS.MATCH_B);
    expect(m.signals.hometown).toBe(false);
    expect(m.signalCount).toBe(3);
  });

  // The 21 departures the class-year unification promoted, in one case. A
  // roster that spells first year "Fy." carried no readable class at all
  // until Phase 6A, so class progression could never fire and a departure
  // with position and graduation year agreeing sat one signal short. All 21
  // were AMBIGUOUS -> MATCH_B; none was MATCH_A, and none went from having no
  // destination to having one.
  it('reads class progression across a label the lifecycle parser used to miss', () => {
    const fy = [
      row({ season: 2024, player_name: 'M Two', college_name: 'Alpha', class_year_label: 'Fy.' }),
      row({
        season: 2025, player_name: 'M Two', college_name: 'Beta', class_year_label: 'So.',
        hometown: 'Denver, CO',
      }),
      ...filler('Alpha', '2024'), ...filler('Alpha', '2025'),
      ...filler('Beta', '2024'), ...filler('Beta', '2025'),
    ];
    const [m] = movementObservations(fy).filter((x) => x.name === 'M Two');
    expect(m.signals.classProgression).toBe(true);
    expect(m.signals.hometown).toBe(false);
    expect(m.signalCount).toBe(3);
    expect(m.status).toBe(MATCH_STATUS.MATCH_B);
  });

  // What the promotion may NOT do. A common name is still a common name, and
  // a third readable signal does not buy past the guard.
  it('still refuses a common name however well the class progresses', () => {
    const common = [
      row({ season: 2024, player_name: 'M Three', college_name: 'Alpha', class_year_label: 'Fy.' }),
      row({ season: 2025, player_name: 'M Three', college_name: 'Beta', class_year_label: 'So.', hometown: 'Denver, CO' }),
      row({ season: 2024, player_name: 'M Three', college_name: 'Gamma', class_year_label: 'Fy.' }),
      row({ season: 2025, player_name: 'M Three', college_name: 'Delta', class_year_label: 'So.' }),
      ...filler('Alpha', '2024'), ...filler('Alpha', '2025'),
      ...filler('Beta', '2024'), ...filler('Beta', '2025'),
      ...filler('Gamma', '2024'), ...filler('Gamma', '2025'),
      ...filler('Delta', '2024'), ...filler('Delta', '2025'),
    ];
    for (const m of movementObservations(common).filter((x) => x.name === 'M Three')) {
      expect(m.commonName).toBe(true);
      expect(isObserved(m)).toBe(false);
    }
  });

  it('AMBIGUOUS when fewer than three signals agree and no hometown', () => {
    const [m] = movementObservations(pair({
      hometown: 'Denver, CO', position: 'Forward', estimated_graduation_year: 2030,
    })).filter((x) => x.name === 'M One');
    expect(m.status).toBe(MATCH_STATUS.AMBIGUOUS);
    expect(m.destinationProgramme).toBeNull();
    expect(isObserved(m)).toBe(false);
  });

  it('AMBIGUOUS when the name appears at two programmes', () => {
    const rows = [
      ...pair({ hometown: 'Phoenix, AZ' }),
      row({ season: 2025, player_name: 'M One', college_name: 'Gamma', hometown: 'Phoenix, AZ' }),
      ...filler('Gamma', '2024'), ...filler('Gamma', '2025'),
    ];
    const [m] = movementObservations(rows).filter((x) => x.name === 'M One');
    expect(m.status).toBe(MATCH_STATUS.AMBIGUOUS);
    expect(m.destinationProgramme).toBeNull();
    expect(m.ambiguousCandidates.sort()).toEqual(['Beta', 'Gamma']);
  });

  it('UNRESOLVED when the name appears nowhere else', () => {
    const rows = [
      row({ season: 2024, player_name: 'N Two', college_name: 'Alpha' }),
      ...filler('Alpha', '2024'), ...filler('Alpha', '2025'),
    ];
    const [m] = movementObservations(rows).filter((x) => x.name === 'N Two');
    expect(m.status).toBe(MATCH_STATUS.UNRESOLVED);
    expect(m.destinationProgramme).toBeNull();
  });

  // The single most important guard in this file.
  it('never lets nationality influence a match', () => {
    const agree = movementObservations(pair({ hometown: 'Denver, CO', nationality: 'USA' }))
      .filter((x) => x.name === 'M One')[0];
    const differ = movementObservations(pair({ hometown: 'Denver, CO', nationality: 'Spain' }))
      .filter((x) => x.name === 'M One')[0];
    expect(agree.status).toBe(differ.status);
    expect(agree.signalCount).toBe(differ.signalCount);
    expect(Object.keys(agree.signals)).not.toContain('nationality');
  });

  it('refuses a common name even where everything else agrees', () => {
    // The same key at three programmes across the dataset.
    const rows = [
      ...pair({ hometown: 'Phoenix, AZ' }),
      row({ season: 2022, player_name: 'M One', college_name: 'Delta' }),
      ...filler('Delta', '2022'),
    ];
    const [m] = movementObservations(rows).filter((x) => x.name === 'M One' && x.sourceSeason === '2024');
    expect(m.commonName).toBe(true);
    expect(m.status).toBe(MATCH_STATUS.AMBIGUOUS);
  });

  it('excludes a departure whose source programme has no next-season roster', () => {
    const rows = [
      row({ season: 2024, player_name: 'P Three', college_name: 'Alpha' }),
      row({ season: 2025, player_name: 'P Three', college_name: 'Beta' }),
      ...filler('Beta', '2024'), ...filler('Beta', '2025'),
    ];
    const found = movementObservations(rows).filter((x) => x.name === 'P Three');
    expect(found).toHaveLength(0);
  });

  it('keeps the candidate list even on a confident match', () => {
    const [m] = movementObservations(pair({ hometown: 'Phoenix, Ariz.' }))
      .filter((x) => x.name === 'M One');
    expect(m.ambiguousCandidates).toEqual(['Beta']);
  });

  it('exposes prior_programme as a signal without depending on it', () => {
    const s = identitySignals(
      { college_name: 'Alpha', position: 'Defender', class_year_label: 'So.', hometown: null, estimated_graduation_year: null },
      { prior_programme: 'Alpha', position: 'Defender', class_year_label: 'Jr.', hometown: null, estimated_graduation_year: null },
    );
    expect(s.priorProgramme).toBe(true);
    expect(s.hometown).toBe(false);
  });
});

describe('destination comparison', () => {
  const college = (o) => ({
    name: o.name ?? 'X', division: o.division ?? 'NCAA D1',
    soccer_score: 'soccer_score' in o ? o.soccer_score : 70,
    academic_rating: 'academic_rating' in o ? o.academic_rating : 5,
    national_ranking: 'national_ranking' in o ? o.national_ranking : 100,
  });

  it('reports the four dimensions separately and never combines them', () => {
    const c = compareProgrammes(
      college({ division: 'NCAA D2', soccer_score: 50, academic_rating: 4, national_ranking: 200 }),
      college({ division: 'NCAA D1', soccer_score: 80, academic_rating: 3, national_ranking: 50 }),
    );
    expect(c.division.movement).toBe('DIVISION_UP');
    expect(c.soccerScore.delta).toBe(30);
    expect(c.soccerScore.band).toBe('STRONGER_FOOTBALL_RATING');
    expect(c.academicRating.delta).toBe(-1);
    expect(c.academicRating.band).toBe('SIMILAR_ACADEMIC_RATING');
    expect(c.nationalRanking.delta).toBe(150);
    expect(Object.keys(c)).toEqual(['division', 'soccerScore', 'academicRating', 'nationalRanking']);
    // No combined verdict anywhere.
    expect(JSON.stringify(c)).not.toMatch(/overallMovement|combinedMovement|transferScore|movementScore/i);
  });

  it('returns null rather than "similar" where a rating is missing', () => {
    const c = compareProgrammes(
      college({ soccer_score: null }), college({ soccer_score: 80 }),
    );
    expect(c.soccerScore.delta).toBeNull();
    expect(c.soccerScore.band).toBeNull();
  });

  it('flags a national ranking as incomparable across divisions', () => {
    const c = compareProgrammes(
      college({ division: 'NCAA D2' }), college({ division: 'NCAA D1' }),
    );
    expect(c.nationalRanking.comparable).toBe(false);
  });

  it('bands on the documented tolerances', () => {
    const same = compareProgrammes(
      college({ soccer_score: 70 }), college({ soccer_score: 70 + SIMILARITY.soccerScore }),
    );
    expect(same.soccerScore.band).toBe('SIMILAR_FOOTBALL_RATING');
    const over = compareProgrammes(
      college({ soccer_score: 70 }), college({ soccer_score: 70 + SIMILARITY.soccerScore + 0.1 }),
    );
    expect(over.soccerScore.band).toBe('STRONGER_FOOTBALL_RATING');
  });

  it('derives the bands the pool implies, for checking the constants', () => {
    const movements = [
      { comparison: { soccerScore: { delta: -20 } } },
      { comparison: { soccerScore: { delta: 0 } } },
      { comparison: { soccerScore: { delta: 20 } } },
    ];
    expect(deriveBands(movements).soccerScore.median).toBe(0);
  });
});

describe('prior role and post-movement outcome', () => {
  const move = (srcMin, dstMin) => ({
    sourceSeason: '2024', destinationSeason: '2025',
    sourceRow: { minutes_played: srcMin, games_played: 10, games_started: 8 },
    destinationRow: dstMin === undefined ? null
      : { minutes_played: dstMin, games_played: 12, games_started: 9 },
  });

  it('carries the final source role and the first destination season', () => {
    const m = attachRoleAndOutcome(move(1200, 400));
    expect(m.priorRole.roleBand).toBe('600+');
    expect(m.outcome.roleBand).toBe('200-599');
    expect(m.outcome.delta).toBe(-800);
    expect(m.outcome.change).toBe('PLAYED_LESS');
    expect(m.outcome.reachedStarter).toBe(false);
  });

  it('calls a small change similar rather than more or less', () => {
    const m = attachRoleAndOutcome(move(800, 800 + SIMILAR_MINUTES - 1));
    expect(m.outcome.change).toBe('SIMILAR_MINUTES');
  });

  it('leaves the outcome null where the destination season has no minutes', () => {
    const m = attachRoleAndOutcome(move(800, null));
    expect(m.outcome.minutes).toBeNull();
    expect(m.outcome.measured).toBe(false);
    expect(m.outcome.change).toBeNull();
    expect(m.outcome.reachedStarter).toBeNull();
  });

  it('leaves the outcome null where the source season has no minutes', () => {
    const m = attachRoleAndOutcome(move(null, 900));
    expect(m.priorRole.measured).toBe(false);
    expect(m.outcome.delta).toBeNull();
    expect(m.outcome.change).toBeNull();
    // The destination minutes are still reported; only the comparison is not.
    expect(m.outcome.minutes).toBe(900);
  });

  it('has no success or failure vocabulary anywhere', () => {
    const m = attachRoleAndOutcome(move(1200, 1800));
    expect(JSON.stringify(m)).not.toMatch(/success|fail|good|bad|better off|worse off/i);
  });

  it('carries a second destination season where one exists', () => {
    const m = attachRoleAndOutcome(move(800, 900), {
      nextSeasonRow: { season: '2026', minutes_played: null },
    });
    expect(m.outcome.secondSeason.season).toBe('2026');
    expect(m.outcome.secondSeason.measured).toBe(false);
  });
});

describe('programme movement summary', () => {
  const movements = [
    { status: MATCH_STATUS.MATCH_A, sourceRow: { minutes_played: 900 } },
    { status: MATCH_STATUS.MATCH_B, sourceRow: { minutes_played: 100 } },
    { status: MATCH_STATUS.AMBIGUOUS, sourceRow: { minutes_played: 0 } },
    { status: MATCH_STATUS.UNRESOLVED, sourceRow: { minutes_played: null } },
    { status: MATCH_STATUS.UNRESOLVED, sourceRow: { minutes_played: 700 } },
  ];

  it('reports coverage and never a transfer rate', () => {
    const s = programmeMovementSummary(movements, { exits: { expected: 2, early: 3, unknownClass: 0 } });
    expect(s.departuresObserved).toBe(5);
    expect(s.destinations.observed).toBe(2);
    expect(s.destinations.ambiguous).toBe(1);
    expect(s.destinations.unresolved).toBe(2);
    expect(s.destinations.destinationMatchCoverage).toBeCloseTo(0.4);
    expect(s).not.toHaveProperty('transferRate');
    expect(JSON.stringify(s)).not.toMatch(/transferRate/);
  });

  it('keeps expected and early exits apart', () => {
    const s = programmeMovementSummary(movements, { exits: { expected: 2, early: 3, unknownClass: 0 } });
    expect(s.expectedExits).toBe(2);
    expect(s.earlyDepartures).toBe(3);
  });

  it('breaks coverage down by the role the player had, suppressing thin slices', () => {
    const s = programmeMovementSummary(movements, null);
    expect(s.byPriorRole['600+'].departures).toBe(2);
    expect(s.byPriorRole['600+'].observedDestinations).toBe(1);
    expect(s.byPriorRole['600+'].suppressed).toBe(true);
  });

  it('does not count an unmeasured source season into any role band', () => {
    const s = programmeMovementSummary(movements, null);
    const total = Object.values(s.byPriorRole).reduce((n, b) => n + b.departures, 0);
    expect(total).toBe(4);            // the null-minutes departure is in none
  });
});
