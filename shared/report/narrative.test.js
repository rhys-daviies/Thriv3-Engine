/**
 * The interpretation layer, held to what it may and may not say.
 *
 * These sentences are the only place the report speaks in its own voice, so
 * the vocabulary is the thing worth testing. Every one of them must be a
 * restatement of a figure the model already holds — never a prediction, never
 * a judgement, never a label on a move.
 */
import { describe, it, expect } from 'vitest';
import {
  programmeHeadlines, athleteHeadlines, developmentNarrative, continuityNarrative,
  destinationNarrative, againstPool,
} from './narrative.js';

/**
 * The words a client-facing reading may not contain.
 *
 * "will" and "should" are ordinary English and are banned anyway: a report
 * that describes seasons already played has no business using either, and a
 * sentence that reaches for one is a sentence that has started predicting.
 */
const BANNED = [
  /\bgood fit\b/i, /\bbad fit\b/i, /\bsafe\b/i, /\brisky\b/i,
  /\bstrong culture\b/i, /\bpoor culture\b/i, /\bculture\b/i,
  /\blikely\b/i, /\bwill\b/i, /\bshould\b/i,
  /\bsuccessful transfer\b/i, /\bfailed transfer\b/i,
  /\bsuccessful\b/i, /\bfailed\b/i, /\btransfer/i,
  /\bsatisfaction\b/i, /\bhappy\b/i, /\bunhappy\b/i,
];

const model = (over = {}) => ({
  college: { division: 'NCAA D1' },
  sections: [],
  summary: {
    programme: {
      freshmanOpportunity: { classification: 'above-benchmark', ladderTop: { median: 900 } },
      experiencedArrivalReliance: { classification: 'typical', measurable: true, shareOfMeasuredLoad: 0.2 },
    },
    athlete: {
      entrySeason: '2027',
      currentPositionPlayers: [{}, {}, {}],
      currentPlayersEligibleAtEntry: [{}, {}],
      positionVacancyHistory: { transitions: 4, openings: 3 },
      positionFreshmanHistory: { measured: 6, players: [{ minutes: 900 }, { minutes: 100 }] },
    },
  },
  lifecycle: {
    development: {
      minutesCoverage: { readable: true, measured: 70, playerSeasons: 70 },
      everStarter: { reached: 10, denominator: 42, share: 10 / 42, band: 'below-benchmark' },
      byYear: [
        { share: 0.05 }, { share: 0.24 }, { share: 0.29 }, { share: 0.25 },
      ],
      timeToStarter: { suppressed: false, denominator: 21, year1: 1, year2: 4, year3: 1 },
    },
    continuity: { returned: 59, returnable: 119, retention: 0.5, band: 'typical' },
    departures: {
      gate: { allowed: true },
      departures: { total: 60, expectedExits: 19, earlyDepartures: 41, unknownClass: 0 },
      tracing: { observed: 19, ambiguous: 11, unresolved: 30, coverage: 19 / 60 },
      earlyTracing: { departures: 41, observed: 19, ambiguous: 10, unresolved: 12 },
      dimensions: {
        football: { STRONGER_FOOTBALL_RATING: 0, SIMILAR_FOOTBALL_RATING: 1, LOWER_FOOTBALL_RATING: 18, notComparable: 0, n: 19 },
        academic: { HIGHER_ACADEMIC_RATING: 11, SIMILAR_ACADEMIC_RATING: 8, LOWER_ACADEMIC_RATING: 0, notComparable: 0, n: 19 },
        division: { DIVISION_UP: 0, DIVISION_SAME: 19, DIVISION_DOWN: 0, notComparable: 0, n: 19 },
      },
    },
    athletePosition: { atPositionObserved: 1, atPositionDepartures: 10 },
  },
  ...over,
});

const everything = (m) => [
  ...programmeHeadlines(m).map((x) => x.text),
  ...athleteHeadlines(m).map((x) => x.text),
  ...developmentNarrative(m), ...continuityNarrative(m), ...destinationNarrative(m),
];

describe('the vocabulary', () => {
  it('says nothing this analysis is not entitled to say', () => {
    for (const sentence of everything(model())) {
      for (const banned of BANNED) {
        expect(sentence, `"${sentence}" matched ${banned}`).not.toMatch(banned);
      }
    }
  });

  it('says nothing forbidden on a programme it cannot measure', () => {
    const thin = model();
    thin.lifecycle.development.minutesCoverage = { readable: false, measured: 3, playerSeasons: 61 };
    thin.lifecycle.continuity = { returned: 4, returnable: 6, retention: null, band: 'unclear' };
    thin.lifecycle.departures.gate = { allowed: false };
    thin.summary.programme.freshmanOpportunity = { classification: 'unclear', ladderTop: { median: 0 } };
    thin.summary.programme.experiencedArrivalReliance = { measurable: false };
    for (const sentence of everything(thin)) {
      for (const banned of BANNED) expect(sentence).not.toMatch(banned);
    }
  });
});

describe('what it refuses', () => {
  it('never quotes a ladder top the classification could not place', () => {
    const thin = model();
    thin.summary.programme.freshmanOpportunity = { classification: 'unclear', ladderTop: { median: 0 } };
    const line = programmeHeadlines(thin).find((x) => x.label === 'First-years');
    expect(line.text).not.toMatch(/0 minutes/);
    expect(line.text).toMatch(/not enough published first-year minutes/);
  });

  it('states the coverage limit rather than a pattern where nothing is traced', () => {
    const none = model();
    none.lifecycle.departures.gate = { allowed: false };
    expect(destinationNarrative(none)).toEqual([]);
    const line = programmeHeadlines(none).find((x) => x.label === 'Where players go');
    expect(line.text).toMatch(/Too few departures at this level can be traced/);
  });

  it('says a development figure cannot be quoted rather than quoting a zero', () => {
    const thin = model();
    thin.lifecycle.development.minutesCoverage = { readable: false, measured: 3, playerSeasons: 61 };
    const [only] = developmentNarrative(thin);
    expect(developmentNarrative(thin)).toHaveLength(1);
    expect(only).toMatch(/only 3 of 61 first-year seasons/);
    expect(only).toMatch(/no share is quoted/);
  });

  it('has no phrase for a band it cannot place', () => {
    expect(againstPool('unclear')).toBeNull();
    expect(againstPool('unavailable')).toBeNull();
    expect(againstPool('typical')).toBe('inside the middle half of comparable programmes');
  });
});

describe('what it says', () => {
  it('carries the denominator of every share it quotes', () => {
    const m = model();
    const dev = developmentNarrative(m);
    expect(dev[0]).toContain('10 of the 42');
    expect(continuityNarrative(m)[0]).toContain('59 of the 119');
    expect(destinationNarrative(m)[0]).toMatch(/three separate readings of the same moves, not one/);
  });

  it('points each headline at the section holding its evidence', () => {
    const sections = programmeHeadlines(model()).map((x) => x.section).filter(Boolean);
    expect(sections).toEqual(['freshman-ladder', 'experienced-arrival-intake',
      'player-development', 'roster-continuity', 'observed-destinations']);
  });

  it('answers all six client questions between the two bands', () => {
    const labels = [...programmeHeadlines(model()), ...athleteHeadlines(model())]
      .map((x) => x.label);
    for (const l of ['First-years', 'Experienced arrivals', 'Development', 'Roster stability',
      'Where players go', 'Who is there now', 'Traced at this position']) {
      expect(labels).toContain(l);
    }
  });
});
