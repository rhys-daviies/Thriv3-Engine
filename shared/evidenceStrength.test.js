import { describe, it, expect } from 'vitest';
import {
  freshmanOpportunityEvidence, vacancyEvidence, positionEvidence, cohortEvidence,
  coachContinuity, COACH_RELEVANCE, LEVELS,
  SEASONS_FOR_STRONG, FRESHMEN_FOR_STRONG,
  VACANCY_OBSERVATIONS_FOR_STRONG, VACANCY_OBSERVATIONS_MINIMUM,
  POSITION_TRANSITIONS_CEILING, OPENINGS_FOR_PATTERN, POSITION_TRANSITIONS_MINIMUM,
} from './evidenceStrength.js';
import { MIN_COHORT_PLAYERS, MIN_COHORT_SEASONS } from './freshmanMinutes.js';

const codes = (e) => e.reasons.map((r) => r.code);

/** A coaching record that gets out of the way, so a test is about its own subject. */
const cleanCoach = {
  verdict: { verdict: 'steady' },
  tenure: { current: { coach: 'A Coach', since: 2022 }, unknownSeasons: [], vacantSeasons: [], knownThrough: 2026 },
};

describe('the shape every family returns', () => {
  const all = [
    freshmanOpportunityEvidence({ seasonsObserved: 4, measuredFreshmen: 20, ...cleanCoach }),
    vacancyEvidence({ observations: 10, totalObservations: 10, seasons: 3, ...cleanCoach }),
    positionEvidence({ transitions: 3, openings: 3, seasons: 3 }),
    cohortEvidence({ players: 12, seasons: 3 }),
  ];

  it('always names one of the three levels', () => {
    for (const e of all) expect(LEVELS).toContain(e.level);
  });

  it('never returns a numeric score', () => {
    for (const e of all) {
      expect(e).not.toHaveProperty('score');
      expect(typeof e.level).toBe('string');
    }
  });

  it('carries a sample block and a boolean sufficiency', () => {
    for (const e of all) {
      expect(e.sample).toBeTruthy();
      expect(typeof e.sufficient).toBe('boolean');
    }
  });

  // Wording belongs to whatever is rendering. A reason is a slug plus its
  // numbers, so the PDF and the tab can say different things about the same
  // finding without the analytics layer choosing between them.
  it('states reasons as codes rather than sentences', () => {
    const thin = cohortEvidence({ players: 2, seasons: 1, relaxed: 'whole intake' });
    expect(thin.reasons.length).toBeGreaterThan(0);
    for (const r of thin.reasons) {
      expect(typeof r.code).toBe('string');
      expect(r.code).toMatch(/^[a-z-]+$/);
      expect(r).not.toHaveProperty('message');
    }
  });
});

describe('freshman opportunity', () => {
  it('is strong on a full window with a full intake and a settled coach', () => {
    const e = freshmanOpportunityEvidence({
      seasonsObserved: 4, measuredFreshmen: 20, unreadableSeasons: [], ...cleanCoach,
    });
    expect(e.level).toBe('strong');
    expect(e.sufficient).toBe(true);
    expect(e.sample).toEqual({ seasons: 4, players: 20, observations: null });
  });

  it('is held back by whichever of seasons and players is thinner', () => {
    const fewSeasons = freshmanOpportunityEvidence({
      seasonsObserved: 2, measuredFreshmen: 40, ...cleanCoach,
    });
    const fewPlayers = freshmanOpportunityEvidence({
      seasonsObserved: 4, measuredFreshmen: MIN_COHORT_PLAYERS, ...cleanCoach,
    });
    expect(fewSeasons.level).toBe('moderate');
    expect(fewPlayers.level).toBe('moderate');
    expect(codes(fewSeasons)).toContain('few-measurable-seasons');
    expect(codes(fewPlayers)).toContain('few-measured-freshmen');
  });

  // A season dropped for unpublished minutes is a hole in the evidence even
  // though every figure downstream correctly excludes it.
  it('demotes for a season whose minutes were never published', () => {
    const e = freshmanOpportunityEvidence({
      seasonsObserved: SEASONS_FOR_STRONG, measuredFreshmen: FRESHMEN_FOR_STRONG,
      unreadableSeasons: ['2023'], ...cleanCoach,
    });
    expect(e.level).toBe('moderate');
    expect(codes(e)).toContain('seasons-without-published-minutes');
  });

  // The record can be complete and still be somebody else's.
  it('falls to limited when every season belongs to the previous staff', () => {
    const e = freshmanOpportunityEvidence({
      seasonsObserved: 4,
      measuredFreshmen: 30,
      verdict: { verdict: 'new-coach-no-record' },
      tenure: { current: { coach: 'New Coach', since: 2026 }, unknownSeasons: [], vacantSeasons: [] },
    });
    expect(e.level).toBe('limited');
    expect(e.coachContinuity.relevance).toBe('describes-previous');
    expect(codes(e)).toContain('record-describes-previous-coach');
    // Still sufficient: there is plenty of record, it just describes someone
    // else, and that is a different thing to tell a reader than "too little".
    expect(e.sufficient).toBe(true);
  });

  it('is insufficient below two seasons or below the cohort minimum', () => {
    expect(freshmanOpportunityEvidence({ seasonsObserved: 1, measuredFreshmen: 30, ...cleanCoach }).sufficient)
      .toBe(false);
    expect(freshmanOpportunityEvidence({
      seasonsObserved: 4, measuredFreshmen: MIN_COHORT_PLAYERS - 1, ...cleanCoach,
    }).sufficient).toBe(false);
  });

  it('treats an empty call as limited and insufficient rather than throwing', () => {
    const e = freshmanOpportunityEvidence();
    expect(e.level).toBe('limited');
    expect(e.sufficient).toBe(false);
    expect(e.coachContinuity.relevance).toBe('unknown');
  });
});

describe('vacancy / replacement behaviour', () => {
  it('is strong at two-thirds of the twelve observations a programme can have', () => {
    const e = vacancyEvidence({
      observations: VACANCY_OBSERVATIONS_FOR_STRONG, totalObservations: VACANCY_OBSERVATIONS_FOR_STRONG,
      seasons: 3, ...cleanCoach,
    });
    expect(e.level).toBe('strong');
  });

  // The gap between readable and total observations is a coverage loss, and
  // it is exactly the gap the MIN_POSITION_MINUTES guard opens.
  it('names observations dropped as unreadable and demotes for them', () => {
    const e = vacancyEvidence({ observations: 8, totalObservations: 12, seasons: 3, ...cleanCoach });
    expect(codes(e)).toContain('observations-not-readable');
    expect(e.reasons.find((r) => r.code === 'observations-not-readable')).toMatchObject({ dropped: 4, of: 12 });
    expect(e.level).toBe('moderate');
  });

  it('is insufficient below two observations', () => {
    expect(vacancyEvidence({ observations: VACANCY_OBSERVATIONS_MINIMUM - 1, seasons: 1 }).sufficient).toBe(false);
    expect(vacancyEvidence({ observations: VACANCY_OBSERVATIONS_MINIMUM, seasons: 1 }).sufficient).toBe(true);
  });

  it('counts observations, not players, in its sample', () => {
    const e = vacancyEvidence({ observations: 6, seasons: 2, ...cleanCoach });
    expect(e.sample.observations).toBe(6);
    expect(e.sample.players).toBeNull();
  });
});

describe('position-specific behaviour', () => {
  it('is strong only with every transition on file and a real pattern of openings', () => {
    const e = positionEvidence({
      transitions: POSITION_TRANSITIONS_CEILING, openings: OPENINGS_FOR_PATTERN, seasons: 3,
    });
    expect(e.level).toBe('strong');
    expect(e.patternReadable).toBe(true);
  });

  // Three transitions and no departure is a complete answer to one question
  // and no answer at all to another. Only the second is a weakness, so the
  // level holds and the caller is told which question it can ask.
  it('does not demote a position where no starter ever left', () => {
    const e = positionEvidence({ transitions: 3, openings: 0, seasons: 3 });
    expect(e.level).toBe('strong');
    expect(e.openingsReadable).toBe(false);
    expect(e.patternReadable).toBe(false);
    expect(codes(e)).toContain('no-starter-departed');
  });

  it('demotes where a place opened too few times to be a pattern', () => {
    const e = positionEvidence({ transitions: 3, openings: 2, seasons: 3 });
    expect(e.level).toBe('moderate');
    expect(e.patternReadable).toBe(false);
    expect(codes(e)).toContain('too-few-openings-for-a-pattern');
  });

  it('is insufficient below two transitions', () => {
    expect(positionEvidence({ transitions: 1, openings: 1 }).sufficient).toBe(false);
    expect(positionEvidence({ transitions: POSITION_TRANSITIONS_MINIMUM, openings: 1 }).sufficient).toBe(true);
  });

  it('demotes for a thin set of players at the position when one is given', () => {
    const withPlayers = positionEvidence({
      transitions: 3, openings: 3, seasons: 3, players: MIN_COHORT_PLAYERS - 1,
    });
    expect(withPlayers.level).toBe('moderate');
    expect(codes(withPlayers)).toContain('few-players-at-position');
  });

  it('ignores the player count entirely when it is not supplied', () => {
    const e = positionEvidence({ transitions: 3, openings: 3, seasons: 3 });
    expect(codes(e)).not.toContain('few-players-at-position');
    expect(e.sample.players).toBeNull();
  });
});

describe('origin / cohort analysis', () => {
  it('reuses the established cohort minimums rather than inventing its own', () => {
    const atFloor = cohortEvidence({ players: MIN_COHORT_PLAYERS, seasons: MIN_COHORT_SEASONS });
    const belowFloor = cohortEvidence({ players: MIN_COHORT_PLAYERS - 1, seasons: MIN_COHORT_SEASONS });
    expect(atFloor.sufficient).toBe(true);
    expect(belowFloor.sufficient).toBe(false);
  });

  it('is strong on a deep cohort read across most of the window', () => {
    const e = cohortEvidence({ players: FRESHMEN_FOR_STRONG, seasons: SEASONS_FOR_STRONG });
    expect(e.level).toBe('strong');
    expect(e.describesRequestedCohort).toBe(true);
  });

  // A relaxed cohort is a real answer about a wider group, not a failure —
  // but the reader has to be told it is a different group from the one asked
  // about, so the level drops and the reason names the substitution.
  it('demotes and flags when the cohort had to be widened', () => {
    const e = cohortEvidence({
      players: 20, seasons: 4, refused: 'DEFENSE / domestic: only 4 in 2 seasons', relaxed: 'domestic',
    });
    expect(e.level).toBe('moderate');
    expect(e.describesRequestedCohort).toBe(false);
    expect(codes(e)).toEqual(expect.arrayContaining(['requested-cohort-refused', 'cohort-relaxed']));
  });

  it('notes a read across the whole intake', () => {
    const e = cohortEvidence({ players: 20, seasons: 4, applied: false });
    expect(codes(e)).toContain('read-across-whole-intake');
    expect(e.describesRequestedCohort).toBe(false);
  });
});

describe('coaching relevance', () => {
  it('maps every verdict classifyProgramme can return', () => {
    const verdicts = [
      'steady', 'structural-through-changes', 'continuity-through-change',
      'policy-shift-same-coach', 'erratic-same-coach', 'regime-change',
      'new-coach-no-record', 'change-too-recent', 'vacancy-in-window',
      'coach-unknown', 'coach-unknown-recent', 'too-few-seasons',
    ];
    for (const v of verdicts) expect(COACH_RELEVANCE[v]).toBeTruthy();
  });

  it('reports an unresolved coaching record as unknown, never as continuity', () => {
    const c = coachContinuity(null, null);
    expect(c.relevance).toBe('unknown');
    expect(c.coach).toBeNull();
    expect(c.unknownSeasons).toEqual([]);
  });

  it('carries the unattributed and vacant seasons through', () => {
    const c = coachContinuity(
      { verdict: 'coach-unknown-recent' },
      { current: { coach: 'A', since: 2022 }, unknownSeasons: [2024, 2025], vacantSeasons: [2023], knownThrough: 2023 },
    );
    expect(c.unknownSeasons).toEqual([2024, 2025]);
    expect(c.vacantSeasons).toEqual([2023]);
    expect(c.knownThrough).toBe(2023);
  });

  it('demotes a full record that carries an unattributed season', () => {
    const e = freshmanOpportunityEvidence({
      seasonsObserved: 4,
      measuredFreshmen: 30,
      verdict: { verdict: 'coach-unknown-recent' },
      tenure: { current: { coach: 'A', since: 2022 }, unknownSeasons: [2025], vacantSeasons: [] },
    });
    expect(e.level).toBe('moderate');
    expect(codes(e)).toEqual(expect.arrayContaining(['coaching-record-incomplete', 'seasons-not-attributed']));
  });
});
