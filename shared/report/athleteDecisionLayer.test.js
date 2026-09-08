/**
 * The athlete decision layer, held to docs/athlete-decision-layer.md.
 *
 * Two things are tested here that nothing else tests. The RANKING must be a
 * function of the facts alone and explainable from the recorded reasons. And
 * the layer must never describe somebody else's route as if it were the
 * reader's: a first-year pathway handed to an athlete whose entry type is not
 * a first-time entrant is the failure this file exists to prevent.
 */
import { describe, it, expect } from 'vitest';
import {
  athleteDecisionFindings, athleteDecisionCandidates, athleteInputStrip,
  entryTypeIsFirstTime, ATHLETE_CATEGORIES, MAX_FINDINGS, FILL_TO, SCOPE_STATEMENT,
} from './athleteDecisionLayer.js';
import { decisionFindings } from './decisionLayer.js';

const cand = (m, id) => athleteDecisionCandidates(m).find((x) => x.category === id);
const has = (m, id) => athleteDecisionFindings(m).findings.some((x) => x.category === id);

/** An athlete at a well-covered programme, so a test can take one thing away. */
const full = (over = {}) => ({
  college: { division: 'NCAA D1', sport: 'mens-soccer' },
  athlete: { name: 'Test Athlete', position: 'Defender', origin: 'international', classYear: 2027 },
  seasons: [{ season: 2022 }, { season: 2023 }, { season: 2024 }, { season: 2025 }],
  squad: { rostered: 30 },
  dials: { n: 10, freshman: 15.9, newcomer: 25, returning: 59.1 },
  coachAttribution: null,
  competitive: {
    available: true,
    seasons: [], summary: {},
    structuralFacts: [],
    coverage: { readableSeasons: 4, expectedSeasons: 4, membershipKnown: 4, divisionKnown: 4, benchmarkAvailable: 4 },
  },
  pressure: {
    athletePosition: {
      historical: {
        suppressed: false, cyclesWithReadableRosterPresence: 3, totalIncomingPerCycle: [4, 8, 7],
        medianTotalIncoming: 7, firstYears: 10, experiencedArrivals: 9,
        pool: { programmes: 208, middleHalf: { low: 3, high: 4 } },
      },
    },
  },
  positionUtilisation: {
    athletePosition: {
      supported: true, available: true, readableSeasons: 4, seasons: [1, 2, 3, 4],
      medianPlayersWith600Plus: 4.5, medianPlayersWithMinutes: 9.5,
      pool: { playersWith600Plus: { programmes: 202, middleHalf: { low: 4, high: 5 } } },
    },
  },
  lifecycle: {
    development: {
      minutesCoverage: { readable: true, measured: 108, playerSeasons: 108 },
      everStarter: { reached: 8, denominator: 57, share: 8 / 57 },
      byYear: [{ share: 0.07 }, { share: 0.11 }, { share: 0.19 }],
    },
    athletePosition: { group: 'programme', atPositionObserved: 4, atPositionDepartures: 33, positionRows: [], rows: [] },
  },
  summary: {
    athlete: {
      position: 'DEFENSE', positionLabel: 'Defender', entrySeason: 2027,
      currentPositionPlayers: new Array(17).fill({}),
      currentPlayersEligibleAtEntry: new Array(17).fill({}),
      currentPlayersBeyondEntry: new Array(13).fill({}),
      currentPlayersInFinalSeasonAtEntry: new Array(4).fill({}),
      currentProjectedMinutesOfPlayersBeyondEntry: {
        currentProjectedMinutes: 760, players: 13, playersWithProjection: 3, playersWithoutProjection: 10,
      },
      positionVacancyHistory: {
        transitions: 3, startersDeparted: 6, openings: 3, freshmanTookIt: 0, newcomerTookIt: 3,
      },
      positionOpeningOutcomes: {
        openings: 3, transitions: 3, dials: { n: 3, freshman: 4.4, newcomer: 27, returning: 68.7 },
        evidence: { level: 'strong', sufficient: true },
      },
      positionFreshmanHistory: {
        measured: 18, starters: 1, cohortLadder: [{}, {}, {}],
        evidence: { level: 'strong', sufficient: true, sample: { seasons: 4 } },
      },
      experiencedArrivalsAtPosition: { measured: 9, starters: 3 },
      originContext: {
        requestedOrigin: 'international', cohortRelaxed: null, cohortRefused: null,
        describesRequestedCohort: true,
        programme: {
          sameOrigin: { players: 18, starters: 3, share: 3 / 18 },
          otherOrigin: { players: 39, starters: 1, share: 1 / 39 },
          withRecordedOrigin: 57,
        },
        evidence: { level: 'strong', sufficient: true },
      },
    },
  },
  ...over,
});

/** Nothing readable at the position. */
const sparse = () => {
  const m = full();
  m.pressure.athletePosition.historical.suppressed = true;
  m.positionUtilisation.athletePosition.available = false;
  m.summary.athlete.positionOpeningOutcomes = { openings: 0, transitions: 0, dials: { n: 0 }, evidence: { sufficient: false } };
  m.summary.athlete.positionVacancyHistory = { transitions: 0, openings: 0, startersDeparted: 0, freshmanTookIt: 0, newcomerTookIt: 0 };
  m.summary.athlete.positionFreshmanHistory = { measured: 0, starters: 0, evidence: { sufficient: false } };
  m.summary.athlete.originContext.cohortRefused = 'nobody on file';
  // The squad-wide development still reads — a thin POSITION at a programme
  // whose whole-squad record is fine is the realistic sparse case, and it is
  // the one that shows class D filling a short page.
  return m;
};

describe('the candidate set', () => {
  it('considers every declared category and no others', () => {
    for (const m of [full(), sparse()]) {
      expect(athleteDecisionCandidates(m).map((x) => x.category))
        .toEqual(ATHLETE_CATEGORIES.map((c) => c.id));
    }
  });

  it('returns nothing at all without an athlete', () => {
    const { athlete, summary, ...rest } = full();
    expect(athleteDecisionCandidates({ ...rest, summary: {} })).toEqual([]);
  });

  it('records a reason for every candidate it refuses', () => {
    for (const c of athleteDecisionCandidates(sparse())) {
      if (!c.eligible) expect(c.reason, c.category).toBeTruthy();
    }
  });
});

describe('eligibility and evidence', () => {
  it('drops a candidate whose evidence is insufficient, whatever its pattern', () => {
    const m = full();
    m.summary.athlete.positionOpeningOutcomes.evidence = { level: 'strong', sufficient: false };
    expect(cand(m, 'position-opening-history').reason).toBe('evidence-insufficient');
    expect(cand(m, 'position-arrival-reliance').reason).toBe('evidence-insufficient');
  });

  it('caps a material finding at the class its evidence allows', () => {
    const m = full();
    m.summary.athlete.positionOpeningOutcomes.evidence = { level: 'limited', sufficient: true };
    const c = cand(m, 'position-opening-history');
    expect(c.materiality).toBe('B');
    expect(c.priority).toBe('C');
  });

  it('never invents a confidence number', () => {
    for (const c of athleteDecisionCandidates(full())) {
      expect(typeof c.evidence).toBe('string');
      expect(c).not.toHaveProperty('score');
      expect(c).not.toHaveProperty('fit');
    }
  });
});

describe('the ranking', () => {
  it('is a function of the facts alone', () => {
    const m = full();
    expect(athleteDecisionFindings(m).findings.map((f) => f.category))
      .toEqual(athleteDecisionFindings(m).findings.map((f) => f.category));
  });

  it('sorts by class, then evidence, then declaration order', () => {
    const classes = athleteDecisionFindings(full()).findings.map((f) => f.priority);
    expect([...classes].sort()).toEqual(classes);
  });

  it('never prints the class it ranked on', () => {
    for (const f of athleteDecisionFindings(full()).findings) {
      expect(f.text).not.toMatch(/priority|class [ABCD]\b/i);
      expect(f.text).not.toMatch(/\brank(ed|ing)?\b/i);
    }
  });

  it('leads with the position group where it outnumbers a typical starter count', () => {
    const { findings } = athleteDecisionFindings(full());
    expect(findings[0].category).toBe('position-depth-at-entry');
    expect(findings[0].priority).toBe('A');
    // 13 eligible beyond entry against 4.5 reaching a starter's season.
    expect(findings[0].text).toMatch(/13 of them eligible beyond 2027/);
    expect(findings[0].text).toMatch(/4\.5 defenders reach a 600-minute season/);
  });

  it('drops the position group to context where it does not', () => {
    const m = full();
    m.summary.athlete.currentPlayersBeyondEntry = new Array(2).fill({});
    expect(cand(m, 'position-depth-at-entry').priority).toBe('C');
  });
});

describe('position arrival reliance', () => {
  it('surfaces where the position differs from the programme', () => {
    // The California shape: half the opened minutes at one position went to
    // experienced arrivals, against a quarter across the programme.
    const m = full();
    m.summary.athlete.positionOpeningOutcomes.dials = { n: 3, freshman: 18, newcomer: 51, returning: 31 };
    const c = cand(m, 'position-arrival-reliance');
    expect(c.priority).toBe('B');
    expect(c.reason).toBe('position-mix-departs-from-programme');
    expect(c.metric).toBe('51%');
    expect(c.text).toMatch(/51% of the minutes that came free at defender/);
    expect(c.text).toMatch(/against 25% across the programme as a whole/);
    expect(has(m, 'position-arrival-reliance')).toBe(true);
  });

  it('stays context where the position matches the programme', () => {
    // 27% at the position against 25% across it: a 2-point gap is not a finding.
    expect(cand(full(), 'position-arrival-reliance').priority).toBe('C');
  });
});

describe('the transfer guard', () => {
  it('assumes a first-time entrant where no entry type is recorded', () => {
    expect(entryTypeIsFirstTime({ classYear: 2027 })).toBe(true);
    expect(entryTypeIsFirstTime(undefined)).toBe(true);
  });

  /**
   * THE REGRESSION THIS FILE EXISTS FOR. The athlete input carries no entry
   * type, so every athlete is assumed to be a first-time entrant. A future
   * fixture that says otherwise must not silently inherit first-year framing:
   * the first-year categories refuse rather than describe somebody else's
   * route as if it were theirs.
   */
  it('refuses the first-year pathway for an athlete who is not a first-time entrant', () => {
    const m = full();
    m.athlete.entryType = 'transfer';
    expect(entryTypeIsFirstTime(m.athlete)).toBe(false);
    const c = cand(m, 'position-first-year-record');
    expect(c.eligible).toBe(false);
    expect(c.reason).toBe('entry-type-not-established');
    for (const f of athleteDecisionFindings(m).findings) {
      expect(f.text).not.toMatch(/first-year defenders with minutes on file reached/);
    }
  });

  it('keeps it for an athlete explicitly recorded as a first-time entrant', () => {
    const m = full();
    m.athlete.entryType = 'first-year';
    expect(cand(m, 'position-first-year-record').eligible).toBe(true);
  });
});

describe('origin', () => {
  it('is a finding only where the cohort describes this athlete', () => {
    expect(cand(full(), 'origin-cohort').eligible).toBe(true);
    const relaxed = full();
    relaxed.summary.athlete.originContext.describesRequestedCohort = false;
    expect(cand(relaxed, 'origin-cohort').reason).toBe('cohort-does-not-describe-this-athlete');
    const refused = full();
    refused.summary.athlete.originContext.cohortRefused = 'nobody on file';
    expect(cand(refused, 'origin-cohort').reason).toMatch(/^cohort-refused:/);
  });

  it('never names an individual nationality', () => {
    const f = cand(full(), 'origin-cohort');
    expect(f.text).toMatch(/from outside the United States/);
    expect(f.evidenceNote).toMatch(/within or outside the United States/);
  });
});

describe('traced movement', () => {
  it('is refused where the position sample fell back to the programme', () => {
    expect(cand(full(), 'traced-position-movement').reason).toBe('position-sample-below-gate');
  });

  it('is class D at best where it did clear its gate', () => {
    const m = full();
    m.lifecycle.athletePosition = {
      group: 'position', atPositionObserved: 6, atPositionDepartures: 20, positionRows: [], rows: [],
    };
    expect(cand(m, 'traced-position-movement').priority).toBe('D');
  });
});

describe('how many', () => {
  it('never renders more than the ceiling', () => {
    expect(athleteDecisionFindings(full()).findings.length).toBeLessThanOrEqual(MAX_FINDINGS);
  });

  it('pads nothing where the position has nothing readable', () => {
    const { findings } = athleteDecisionFindings(sparse());
    expect(findings.length).toBeLessThan(FILL_TO + 1);
    for (const f of findings) expect(f.eligible).toBe(true);
  });

  it('lets programme development in only while the page is thin', () => {
    expect(has(full(), 'programme-development')).toBe(false);
    expect(has(sparse(), 'programme-development')).toBe(true);
  });
});

describe('the canonical contract', () => {
  it('gives one headline metric and one destination per finding', () => {
    for (const f of athleteDecisionFindings(full()).findings) {
      expect(typeof f.text).toBe('string');
      expect(f.text.length).toBeGreaterThan(20);
      expect(f.section).toBeTruthy();
    }
  });

  it('states each concept once', () => {
    const { findings } = athleteDecisionFindings(full());
    expect(new Set(findings.map((f) => f.category)).size).toBe(findings.length);
  });

  it('points only at sections the report can contain', () => {
    const allowed = new Set(['athlete-current-position', 'athlete-position-openings',
      'athlete-position-record', 'athlete-origin', 'athlete-position-movement',
      'competitive-environment', 'competitive-history', 'player-development']);
    for (const c of ATHLETE_CATEGORIES) expect(allowed.has(c.section), c.id).toBe(true);
  });
});

describe('the input strip and the scope statement', () => {
  it('shows only the inputs that shape a figure', () => {
    const strip = athleteInputStrip(full());
    const labels = strip.map(([l]) => l);
    expect(labels).toEqual(['Position', 'Entry year', 'Origin group', 'Sport']);
    // `level` and the individual nationality are on the model and touch nothing.
    const flat = JSON.stringify(strip);
    expect(flat).not.toMatch(/level/i);
    expect(flat).not.toMatch(/New Zealand|nationality/i);
  });

  it('says what the report does not assess', () => {
    expect(SCOPE_STATEMENT).toMatch(/does not assess academic fit, cost, choice of major/);
    expect(SCOPE_STATEMENT).not.toMatch(/\bfit score\b|\brecommend/i);
  });
});

describe('the programme layer is untouched', () => {
  it('ranks the programme independently of the athlete', () => {
    const m = full();
    const withAthlete = decisionFindings(m).findings.map((f) => f.category);
    const { athlete, ...withoutAthlete } = m;
    const bare = decisionFindings({ ...withoutAthlete, summary: { programme: m.summary.programme } })
      .findings.map((f) => f.category);
    expect(withAthlete).toEqual(bare);
  });

  it('shares no category ids with the athlete layer', () => {
    // Two rankings, never merged: an id in both would make one page's finding
    // silently answer for the other's.
    const athleteIds = new Set(ATHLETE_CATEGORIES.map((c) => c.id));
    for (const id of ['freshman-opportunity', 'experienced-arrivals', 'replacement-behaviour',
      'roster-continuity', 'current-squad', 'competitive-history', 'player-destinations']) {
      expect(athleteIds.has(id), id).toBe(false);
    }
  });
});
