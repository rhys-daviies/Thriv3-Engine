/**
 * What to verify with the staff, held to docs/staff-questions.md.
 *
 * Three things are tested here that nothing else tests. Every question must be
 * traceable to a fact the report already states — the contract that separates
 * this page from generic recruiting advice. No question may imply that Thriv3
 * believes the answer is good or bad, which is the language rule the whole
 * surface stands or falls on. And several facts about one conversation must
 * become one question, not three.
 */
import { describe, it, expect } from 'vitest';
import {
  staffQuestions, staffQuestionCandidates, QUESTION_CATEGORIES, SOURCE_TITLES,
  MAX_QUESTIONS, FILL_TO,
} from './staffQuestions.js';
import { athleteDecisionFindings } from './athleteDecisionLayer.js';

const q = (m) => staffQuestions(m).questions;
const cand = (m, id) => staffQuestionCandidates(m).find((x) => x.category === id);
const has = (m, id) => q(m).some((x) => x.category === id);

/**
 * An athlete at a well-covered programme, so a test can take one thing away.
 * The same fixture shape the athlete decision layer's suite uses, because the
 * questions are generated from the findings that layer selects.
 */
const full = (over = {}) => ({
  college: { division: 'NCAA D1', sport: 'mens-soccer' },
  athlete: { name: 'Test Athlete', position: 'Defender', origin: 'international', classYear: 2027 },
  seasons: [{ season: 2022 }, { season: 2023 }, { season: 2024 }, { season: 2025 }],
  squad: { rostered: 30 },
  squadSeason: 2026,
  recruitSeason: 2026,
  dials: { n: 10, freshman: 15.9, newcomer: 25, returning: 59.1 },
  coachAttribution: null,
  competitive: {
    available: true,
    seasons: [], summary: {}, structuralFacts: [],
    coverage: { readableSeasons: 4, expectedSeasons: 4, membershipKnown: 4, divisionKnown: 4, benchmarkAvailable: 4 },
  },
  pressure: {
    athletePosition: {
      historical: {
        suppressed: false, cyclesWithReadableRosterPresence: 3, totalIncomingPerCycle: [4, 8, 7],
        medianTotalIncoming: 7, firstYears: 10, experiencedArrivals: 9,
        pool: { programmes: 208, middleHalf: { low: 3, high: 4 } },
      },
      cycles: [
        { season: '2025', current: false, readable: true, totalIncoming: 7 },
        { season: '2026', current: true, readable: true, totalIncoming: 2 },
      ],
      // The field the position-record section's own gate reads, which is the
      // field a known-arrivals question is generated from.
      current: { season: '2026', readable: true, totalIncoming: 2 },
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
      position: 'DEFENSE', positionLabel: 'Defender', entrySeason: 2027, entrySeasonKnown: false,
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
        evidence: { level: 'strong', sufficient: true, patternReadable: true },
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

/** Nothing at the position, nothing readable, nothing on file. */
const empty = () => full({
  positionUtilisation: { athletePosition: { supported: false, available: false } },
  pressure: { athletePosition: null },
  lifecycle: {
    development: { minutesCoverage: { readable: false }, everStarter: null, byYear: [] },
    athletePosition: null,
  },
  summary: {
    athlete: {
      position: 'DEFENSE', positionLabel: 'Defender', entrySeason: 2027, entrySeasonKnown: true,
      currentPositionPlayers: [],
      currentPlayersEligibleAtEntry: [], currentPlayersBeyondEntry: [],
      currentPlayersInFinalSeasonAtEntry: [], currentProjectedMinutesOfPlayersBeyondEntry: null,
      positionVacancyHistory: { transitions: 0, openings: 0 },
      positionOpeningOutcomes: { openings: 0, evidence: { level: 'limited', sufficient: false } },
      positionFreshmanHistory: { measured: 0, starters: 0, evidence: { level: 'limited', sufficient: false } },
      experiencedArrivalsAtPosition: { measured: 0, starters: 0 },
      originContext: { requestedOrigin: null },
    },
  },
});

describe('a question exists only where the report states the fact that caused it', () => {
  it('gives every question a reason, a source section and a declared category', () => {
    const declared = new Set(QUESTION_CATEGORIES.map((c) => c.id));
    for (const x of q(full())) {
      expect(declared.has(x.category)).toBe(true);
      expect(x.reason).toBeTruthy();
      expect(x.sourceFact).toBeTruthy();
      expect(x.section).toBeTruthy();
    }
  });

  /**
   * The structural half of the contract, and the reason no threshold lives in
   * this module: a class A or B question rests on a finding the decision layer
   * SELECTED, so the materiality test behind it is one the report has already
   * made and printed on a page the question points at.
   */
  it('backs every class A and B question with a fact the report ranked or a record it holds', () => {
    const m = full();
    const selected = new Set(athleteDecisionFindings(m).findings.map((f) => f.category));
    const RANKED = {
      'experienced-arrival-reliance': 'position-arrival-reliance',
      'position-opening-route': 'position-opening-history',
      'first-year-introduction': 'position-first-year-record',
      'competitive-structure': 'competitive-structure',
      'traced-destinations': 'traced-position-movement',
    };
    for (const x of q(m).filter((y) => y.priority === 'A' || y.priority === 'B')) {
      const needs = RANKED[x.category];
      // Either it is gated on a selected finding, or its evidence is a record
      // the report holds outright — a roster and a coaching record are not
      // samples of anything.
      expect(needs ? selected.has(needs) : x.evidence === 'record').toBe(true);
    }
  });

  it('names a section title for every source it points at, and never an id', () => {
    for (const x of q(full())) expect(SOURCE_TITLES[x.section]).toBeTruthy();
    for (const c of QUESTION_CATEGORIES) expect(SOURCE_TITLES[c.section]).toBeTruthy();
  });

  it('is deterministic', () => {
    const m = full();
    expect(JSON.stringify(q(m))).toBe(JSON.stringify(q(m)));
  });
});

describe('no question implies its own answer', () => {
  /**
   * The forecast and judgement vocabulary, matched lowercase.
   *
   * Case matters: a coach called Will Roberts is a name in a reason and not a
   * forecast, and the universe holds one. A forecast reads "will" mid-sentence
   * in lower case, so that is what is forbidden.
   */
  const FORBIDDEN = ['will', 'likely', 'chance', 'expected minutes', 'available minutes',
    'blocked', 'competitor', 'competition', 'better', 'worse', 'good', 'bad', 'risk', 'safe',
    'guarantee', 'scholarship', 'transfer', 'transfers', 'prevent', 'stop you'];

  const models = [full(), empty(),
    full({ summary: { athlete: { ...full().summary.athlete, currentPlayersBeyondEntry: [] } } })];

  it('never uses forecast or judgement language', () => {
    for (const m of models) {
      for (const x of q(m)) {
        const text = `${x.question} ${x.reason}`;
        for (const word of FORBIDDEN) {
          expect(text.includes(word), `${x.category}: ${word}`).toBe(false);
        }
      }
    }
  });

  it('opens with how, what or which, and never with why', () => {
    for (const m of models) {
      for (const x of q(m)) {
        expect(x.question).toMatch(/^(How|What|Which)\b/);
        expect(x.question).not.toMatch(/\bwhy\b/i);
        expect(x.question.endsWith('?')).toBe(true);
      }
    }
  });

  /**
   * A QUESTION OPENS THE UNKNOWN; IT DOES NOT RESTATE THE FINDING — §37.
   *
   * The finding says thirteen of seventeen defenders are eligible beyond 2027.
   * The question asks how the staff expects the group to be structured. So no
   * figure may appear in a question: the only digits allowed are a season,
   * which is what the question is asked ABOUT rather than a measurement of
   * anything.
   */
  it('carries no figure in a question — only the year it asks about', () => {
    for (const m of models) {
      for (const x of q(m)) {
        expect(x.question.replace(/\b(19|20)\d\d\b/g, '')).not.toMatch(/\d/);
      }
    }
  });

  it('says experienced arrivals rather than transfers', () => {
    const x = q(full()).find((y) => y.category === 'experienced-arrival-reliance');
    if (x) {
      expect(x.question).toMatch(/experienced arrivals/);
      expect(`${x.question} ${x.reason}`).not.toMatch(/transfer/i);
    }
  });
});

describe('the ranking and the selection', () => {
  it('orders by class', () => {
    const out = q(full());
    const RANK = { A: 0, B: 1, C: 2, D: 3 };
    for (let i = 1; i < out.length; i += 1) {
      expect(RANK[out[i].priority]).toBeGreaterThanOrEqual(RANK[out[i - 1].priority]);
    }
  });

  it('never exceeds the ceiling', () => {
    expect(q(full()).length).toBeLessThanOrEqual(MAX_QUESTIONS);
  });

  /**
   * DEDUPLICATION IS THE POINT OF THE FAMILIES — §9. Seventeen recorded at the
   * position, thirteen eligible beyond entry, two added for the coming season
   * and a roster horizon short of the entry year are four facts about one
   * conversation. One question, and the second fact folded into its reason.
   */
  it('takes at most one question from each conversation', () => {
    const out = q(full());
    const families = out.map((x) => x.family);
    expect(new Set(families).size).toBe(families.length);
    const group = out.find((x) => x.family === 'position-group');
    expect(group).toBeTruthy();
    expect(group.folded).toBeGreaterThan(0);
    // The folded fact survives in the reason rather than being dropped.
    expect(group.reason).toMatch(/final eligible season/);
  });

  it('keeps evidence follow-ups off a page that already has questions', () => {
    // Class D is admitted only while fewer than FILL_TO have been chosen.
    const out = q(full());
    if (out.length >= FILL_TO) expect(out.some((x) => x.priority === 'D')).toBe(false);
  });

  it('forces no minimum', () => {
    expect(q(empty())).toEqual([]);
    expect(staffQuestions({}).questions).toEqual([]);
  });
});

describe('proportionality', () => {
  /**
   * An unresolved current coach is class C and never higher. 13C settled that
   * an absence must not outrank measured intelligence, and it does not become
   * a bigger question because it appears on a different page.
   */
  it('never lets an unresolved coach outrank the athlete’s own position', () => {
    const m = full({
      coachAttribution: {
        currentCoach: null,
        currentCoachReason: 'no coach name could be read for this season',
        measuredSeasons: [{ season: '2022', coachName: 'A Coach', attribution: 'PREVIOUS_COACH', interim: false, coHead: false }],
      },
    });
    const coach = cand(m, 'coach-attribution');
    if (coach.eligible) {
      expect(coach.priority).not.toBe('A');
      expect(coach.priority).not.toBe('B');
      const out = q(m);
      const at = out.findIndex((x) => x.category === 'coach-attribution');
      const pos = out.findIndex((x) => x.family === 'position-group');
      if (at > -1 && pos > -1) expect(pos).toBeLessThan(at);
    }
  });

  it('asks nothing of a coach who owns the measured record', () => {
    const m = full({
      coachAttribution: {
        currentCoach: { name: 'A Coach', season: 2026, usable: true },
        currentCoachReason: null,
        measuredSeasons: [2022, 2023, 2024, 2025].map((season) => ({
          season: String(season), coachName: 'A Coach', attribution: 'CURRENT_COACH',
          interim: false, coHead: false,
        })),
      },
    });
    expect(cand(m, 'coach-attribution').eligible).toBe(false);
  });

  /**
   * A missing conference or division row is administrative trivia, not a
   * question for a coach. Only a division CHANGE inside the measured window
   * qualifies, and only where the decision layer ranked it.
   */
  it('asks nothing about a gap in a structural field', () => {
    const m = full({
      competitive: {
        available: true, seasons: [], summary: {}, structuralFacts: [],
        coverage: { readableSeasons: 4, expectedSeasons: 4, membershipKnown: 3, divisionKnown: 3, benchmarkAvailable: 3 },
      },
    });
    expect(cand(m, 'competitive-structure').eligible).toBe(false);
  });
});

describe('the position group and its timing', () => {
  it('asks how the group is structured where players are eligible beyond entry', () => {
    const x = q(full()).find((y) => y.family === 'position-group');
    expect(x.category).toBe('position-group-beyond-entry');
    expect(x.question).toMatch(/How does the staff expect the defender group to be structured/);
    expect(x.reason).toMatch(/13 of the 17 defenders currently recorded remain eligible beyond 2027/);
  });

  /**
   * The eligibility question NEVER becomes a minutes question. There is no
   * arithmetic on the projections anywhere in this module and no sentence that
   * turns an ending eligibility into a place for the reader.
   */
  it('asks about succession where the group runs out at entry, and never about minutes', () => {
    const base = full().summary.athlete;
    const m = full({
      summary: { athlete: { ...base, currentPlayersBeyondEntry: [], currentPlayersInFinalSeasonAtEntry: new Array(6).fill({}) } },
    });
    const x = q(m).find((y) => y.family === 'position-group');
    expect(x.category).toBe('position-final-season-at-entry');
    expect(x.question).toMatch(/succession/);
    expect(`${x.question} ${x.reason}`).not.toMatch(/minute/i);
  });

  it('falls back to the roster horizon where the group itself says nothing', () => {
    const base = full().summary.athlete;
    const m = full({
      pressure: { athletePosition: { historical: full().pressure.athletePosition.historical, cycles: [], current: null } },
      summary: { athlete: { ...base, currentPlayersBeyondEntry: [], currentPlayersInFinalSeasonAtEntry: [] } },
    });
    const x = q(m).find((y) => y.family === 'position-group');
    expect(x.category).toBe('roster-coverage');
    expect(x.reason).toMatch(/held through 2026, and you would arrive in 2027/);
  });

  it('says nothing about the group where the entry year is inside the roster horizon', () => {
    const base = full().summary.athlete;
    const m = full({
      pressure: { athletePosition: { historical: full().pressure.athletePosition.historical, cycles: [], current: null } },
      summary: {
        athlete: {
          ...base, entrySeasonKnown: true,
          currentPlayersBeyondEntry: [], currentPlayersInFinalSeasonAtEntry: [],
        },
      },
    });
    expect(q(m).some((y) => y.family === 'position-group')).toBe(false);
  });

  it('never calls a known arrival a competitor or gives them a role', () => {
    const c = cand(full(), 'known-arrivals-at-position');
    expect(c.eligible).toBe(true);
    expect(`${c.question} ${c.reason}`).not.toMatch(/competitor|ahead of|instead of|role/i);
  });
});

describe('the transfer guard', () => {
  /**
   * A first-year question handed to an athlete whose entry type is not a
   * first-time entrant would describe somebody else's route as if it were
   * theirs. 13F put the assumption in one place; this holds the question
   * surface to it.
   */
  it('asks nothing about first-year introduction where the entry type is not first-time', () => {
    const m = full({ athlete: { ...full().athlete, entryType: 'transfer' } });
    expect(cand(m, 'first-year-introduction').refusal).toBe('entry-type-not-established');
    expect(has(m, 'first-year-introduction')).toBe(false);
  });

  it('leaves the experienced-arrival question available to any entry type', () => {
    const m = full({ athlete: { ...full().athlete, entryType: 'transfer' } });
    const a = cand(m, 'experienced-arrival-reliance');
    const b = cand(full(), 'experienced-arrival-reliance');
    expect(a.eligible).toBe(b.eligible);
  });

  it('assumes a first-time entrant where no entry type is on file', () => {
    expect(cand(full(), 'first-year-introduction').refusal).not.toBe('entry-type-not-established');
  });
});

describe('origin', () => {
  it('asks about the broad group, never a nationality', () => {
    const base = full().summary.athlete;
    const m = full({
      summary: {
        athlete: {
          ...base,
          originContext: {
            ...base.originContext,
            programme: { ...base.originContext.programme, sameOrigin: { players: 3, starters: 1, share: null } },
            evidence: { level: 'limited', sufficient: false },
          },
        },
      },
    });
    const x = cand(m, 'origin-cohort');
    expect(x.eligible).toBe(true);
    expect(x.question).toMatch(/outside the United States/);
    expect(x.question).not.toMatch(/nationality|New Zealand|England|Spain/);
  });

  it('asks nothing where the programme has its own record by origin', () => {
    expect(cand(full(), 'origin-cohort').refusal).toBe('programme-has-its-own-origin-record');
  });

  it('asks nothing of a domestic athlete', () => {
    const base = full().summary.athlete;
    const m = full({
      summary: {
        athlete: {
          ...base,
          originContext: {
            ...base.originContext, requestedOrigin: 'domestic',
            evidence: { level: 'limited', sufficient: false },
          },
        },
      },
    });
    expect(cand(m, 'origin-cohort').refusal).toBe('origin-group-not-decision-relevant');
  });
});

describe('a sparse programme', () => {
  it('does not become a list of everything Thriv3 does not know', () => {
    const base = full().summary.athlete;
    const sparse = full({
      positionUtilisation: { athletePosition: { supported: true, available: false, reason: 'thin' } },
      summary: {
        athlete: {
          ...base,
          currentPositionPlayers: new Array(5).fill({}),
          currentPlayersBeyondEntry: new Array(5).fill({}),
          currentPlayersInFinalSeasonAtEntry: [],
          positionVacancyHistory: { transitions: 0, openings: 0 },
          positionOpeningOutcomes: { openings: 0, evidence: { level: 'limited', sufficient: false } },
          positionFreshmanHistory: { measured: 0, starters: 0, evidence: { level: 'limited', sufficient: false } },
        },
      },
    });
    const out = q(sparse);
    expect(out.length).toBeLessThanOrEqual(2);
    // And what it does ask still points at a page that exists.
    for (const x of out) expect(SOURCE_TITLES[x.section]).toBeTruthy();
  });
});
