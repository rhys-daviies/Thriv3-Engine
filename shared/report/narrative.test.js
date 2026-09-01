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
  destinationNarrative, againstPool, pathwayNarrative,
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
  ...pathwayNarrative(m),
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
    // Every headline points at a section that exists in the plan. Destinations
    // no longer has its own page — it is a block on the continuity page since
    // 13B — so the "where players go" line points there.
    expect(sections).toEqual(['freshman-opportunity', 'experienced-arrivals',
      'player-development', 'roster-continuity', 'roster-continuity']);
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

describe('the pathway synthesis', () => {
  const withPosition = (over = {}) => {
    const m = model();
    m.summary.athlete = {
      ...m.summary.athlete,
      positionLabel: 'Forward',
      positionFreshmanHistory: { measured: 6, starters: 0, players: [] },
      positionOpeningOutcomes: { openings: 3, freshmanTookIt: 0, newcomerTookIt: 1,
        dials: { n: 3, returning: 69.6, newcomer: 25.9, freshman: 4.5 } },
      currentPositionPlayers: [{ projectedMinutes: 1009 }, { projectedMinutes: 284 }, { projectedMinutes: null }],
      currentPlayersEligibleAtEntry: [{}, {}, {}],
      currentPlayersInFinalSeasonAtEntry: [{}],
      currentProjectedMinutesOfPlayersEligibleAtEntry: { playersWithProjection: 2 },
      ...over,
    };
    return m;
  };

  it('crosses four analyses and stops at five sentences', () => {
    const out = pathwayNarrative(withPosition());
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.length).toBeLessThanOrEqual(5);
    const all = out.join(' ');
    expect(all).toMatch(/6 first-year forwards/);              // position first-year record
    expect(all).toMatch(/Across the whole squad rather than this position alone/); // development
    expect(all).toMatch(/current roster carries/);             // the squad now
    expect(all).toMatch(/When minutes opened at this position/); // replacement behaviour
  });

  it('says which figures are programme-wide rather than this position', () => {
    const all = pathwayNarrative(withPosition()).join(' ');
    // The multi-year model is not cut by position, and the sentence that uses
    // it has to say so or it reads as a figure about forwards.
    expect(all).toMatch(/whole squad rather than this position alone/);
  });

  it('carries the denominator of every figure it states', () => {
    for (const sentence of pathwayNarrative(withPosition())) {
      if (/%/.test(sentence)) expect(sentence).toMatch(/of \d|across \d|\d+ of \d+|position-seasons/);
    }
  });

  it('says nothing forbidden, and never resolves into a verdict', () => {
    for (const sentence of pathwayNarrative(withPosition())) {
      for (const banned of BANNED) expect(sentence, sentence).not.toMatch(banned);
      expect(sentence).not.toMatch(/overall|on balance|in summary|therefore|suggests that/i);
    }
  });

  it('degrades to what a sparse programme can support', () => {
    const m = withPosition({ positionOpeningOutcomes: { openings: 0, dials: { n: 0 } },
      currentPositionPlayers: [] });
    m.lifecycle.development.minutesCoverage = { readable: false, measured: 3, playerSeasons: 61 };
    const out = pathwayNarrative(m);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/6 first-year forwards here have minutes on file/);
  });

  it('is empty without an athlete', () => {
    const m = model();
    m.summary.athlete = null;
    expect(pathwayNarrative(m)).toEqual([]);
  });
});

describe('the pathway synthesis after Phase 9B', () => {
  const base = () => ({
    college: { name: 'Somewhere', division: 'NCAA D1' },
    summary: { athlete: {
      positionLabel: 'Defender', entrySeason: 2027,
      positionFreshmanHistory: { measured: 6, starters: 1 },
      positionOpeningOutcomes: { openings: 2, freshmanTookIt: 1, dials: null },
      currentPositionPlayers: [], currentPlayersEligibleAtEntry: [],
      currentPlayersInFinalSeasonAtEntry: [],
    } },
    lifecycle: null,
    pressure: { athletePosition: { historical: {
      suppressed: false, totalIncomingPerCycle: [4, 3, 5], medianTotalIncoming: 4,
      cyclesWithReadableRosterPresence: 3,
      pool: { median: 4, middleHalf: { low: 3, high: 4 } },
    } } },
    positionUtilisation: { athletePosition: {
      supported: true, available: true, readableSeasons: 4,
      seasons: [{}, {}, {}, {}],
      medianPlayersWith600Plus: 6, medianPlayersWithMinutes: 9,
      pool: { playersWith600Plus: { median: 4.5, middleHalf: { low: 4, high: 5 } } },
    } },
  });

  // The one sentence in the report that puts two independent histories side by
  // side. It may place them together and may not combine them.
  it('places intake beside the minute distribution without combining them', () => {
    const out = pathwayNarrative(base());
    const line = out.find((x) => x.includes('4, 3, 5'));
    expect(line).toBeTruthy();
    expect(line).toMatch(/added 4, 3, 5 defenders across 3 recruiting cycles/);
    expect(line).toMatch(/6 defenders reached a 600-minute season in a typical year out of 9 used/);
    expect(line).toMatch(/more than the comparable middle half of 4 to 5/);
    // No arithmetic between the two, and no verdict about the pair.
    for (const word of ['score', 'per', 'ratio', 'opportunity', 'competition', 'crowded']) {
      expect(line.toLowerCase(), word).not.toContain(word);
    }
  });

  it('discloses the season basis where it is short of the seasons on file', () => {
    const m = base();
    m.positionUtilisation.athletePosition.readableSeasons = 2;
    const line = pathwayNarrative(m).find((x) => x.includes('4, 3, 5'));
    expect(line).toMatch(/In the 2 seasons of 4 with enough position-level minutes to read/);
  });

  it('says the minute distribution is not reported for a goalkeeper', () => {
    const m = base();
    m.summary.athlete.positionLabel = 'Goalkeeper';
    m.positionUtilisation.athletePosition = { supported: false, available: false };
    const line = pathwayNarrative(m).find((x) => x.includes('4, 3, 5'));
    expect(line).toMatch(/not reported for goalkeepers/);
    expect(line).not.toMatch(/insufficient|too few/i);
  });

  it('drops the programme-wide development sentence before a position one', () => {
    const m = base();
    m.lifecycle = { development: {
      minutesCoverage: { readable: true },
      everStarter: { share: 0.3, reached: 12, denominator: 40 },
      byYear: [{ share: 0.1 }, { share: 0.2 }, { share: 0.3 }],
    } };
    m.summary.athlete.currentPositionPlayers = [{ projectedMinutes: 900 }];
    m.summary.athlete.currentPlayersEligibleAtEntry = [{}];
    m.summary.athlete.positionOpeningOutcomes.dials = { n: 3, returning: 70, freshman: 5, newcomer: 25 };
    const out = pathwayNarrative(m);
    expect(out.length).toBeLessThanOrEqual(6);
    const positionLine = out.findIndex((x) => x.includes('4, 3, 5'));
    const programmeLine = out.findIndex((x) => x.includes('whole squad rather than this position'));
    expect(positionLine).toBeGreaterThanOrEqual(0);
    if (programmeLine >= 0) expect(programmeLine).toBeGreaterThan(positionLine);
  });

  it('never says anything predictive or evaluative', () => {
    const joined = pathwayNarrative(base()).join(' ').toLowerCase();
    for (const word of ['will ', 'likely', 'expect', 'should', 'risk', 'safe', 'good fit',
      'strong fit', 'open pathway', 'recruited over']) {
      expect(joined, word).not.toContain(word);
    }
  });
});
