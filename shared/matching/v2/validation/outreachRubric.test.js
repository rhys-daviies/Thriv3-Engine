/**
 * A7.13 — the questionnaire and the pre-registered metric definitions.
 *
 * The metrics are the part that has to be right BEFORE any answer exists,
 * because afterwards we will know which of them flatter the model.
 */
import { describe, it, expect } from 'vitest';
import {
  FIRST_100, ATHLETE_QUESTIONS, OUTREACH_CLASSIFICATION,
  PREREGISTERED_METRICS, METRIC_IDS, RANK_DISTANCE_BAND, rankDistanceBand,
  RELATIVE_BAND, relativeBand, outreachReviewRow, outreachRowError,
  isPursueSet, classificationOrdinal,
} from './outreachRubric.js';
import { CLASSIFICATION } from './rubric.js';

describe('the per-programme questions', () => {
  it('keeps the A7.7 classification taxonomy unchanged, so the two are comparable', () => {
    expect(OUTREACH_CLASSIFICATION).toBe(CLASSIFICATION);
    expect(Object.keys(OUTREACH_CLASSIFICATION)).toEqual([
      'PURSUE_STRONGLY', 'PURSUE', 'BORDERLINE', 'LOW_PRIORITY',
      'WOULD_NOT_PURSUE', 'INSUFFICIENT_INFORMATION',
    ]);
  });

  it('adds exactly one list question, answered three ways', () => {
    expect(FIRST_100.answers).toEqual(['YES', 'NO', 'UNSURE']);
    expect(FIRST_100.question).toMatch(/first 100 programmes contacted/);
  });

  it('never asks the reviewer for a rank', () => {
    expect(FIRST_100.question).not.toMatch(/rank|position|number/i);
  });
});

describe('the athlete-level questions', () => {
  it('asks three, the last of them free text', () => {
    expect(ATHLETE_QUESTIONS).toHaveLength(3);
    expect(ATHLETE_QUESTIONS[0].answers).toEqual(['TOO HIGH', 'ABOUT RIGHT', 'TOO LOW']);
    expect(ATHLETE_QUESTIONS[1].answers).toEqual(['YES', 'NO', 'UNSURE']);
    expect(ATHLETE_QUESTIONS[2].freeText).toBe(true);
    expect(ATHLETE_QUESTIONS[2].answers).toBeNull();
  });
});

describe('rank distance', () => {
  it('is null inside the hundred, because there is no error to measure', () => {
    for (const r of [1, 50, 100]) expect(rankDistanceBand(r), String(r)).toBeNull();
  });

  it('bands everything outside it', () => {
    expect(rankDistanceBand(101)).toBe('JUST_OUTSIDE');
    expect(rankDistanceBand(150)).toBe('JUST_OUTSIDE');
    expect(rankDistanceBand(151)).toBe('NEAR');
    expect(rankDistanceBand(250)).toBe('NEAR');
    expect(rankDistanceBand(251)).toBe('FAR');
    expect(rankDistanceBand(500)).toBe('FAR');
    expect(rankDistanceBand(501)).toBe('VERY_FAR');
    expect(rankDistanceBand(858)).toBe('VERY_FAR');
  });

  it('covers every rank above 100 with exactly one band', () => {
    for (let r = 101; r <= 900; r += 7) {
      const hits = RANK_DISTANCE_BAND.filter((b) => r >= b.from && r <= b.to);
      expect(hits, String(r)).toHaveLength(1);
    }
  });

  it('is null for a programme with no rank at all', () => {
    expect(rankDistanceBand(null)).toBeNull();
    expect(rankDistanceBand(undefined)).toBeNull();
  });
});

describe('relative strength bands', () => {
  it('places a delta in exactly one band', () => {
    for (const d of [-40, -15.1, -15, -3.1, -3, -0.1, 0, 2.9, 3, 9.9, 10, 30]) {
      const hits = RELATIVE_BAND.filter((b) => b.test(d));
      expect(hits, String(d)).toHaveLength(1);
    }
  });

  it('agrees with the labels', () => {
    expect(relativeBand(12)).toBe('SUBSTANTIALLY_ABOVE');
    expect(relativeBand(5)).toBe('MODERATELY_ABOVE');
    expect(relativeBand(0)).toBe('NEAR_LEVEL');
    expect(relativeBand(-8)).toBe('MODERATELY_BELOW');
    expect(relativeBand(-37.5)).toBe('SUBSTANTIALLY_BELOW');
  });

  it('is null when there is no strength to compare', () => {
    expect(relativeBand(null)).toBeNull();
  });
});

describe('the review row', () => {
  it('starts with every answer null', () => {
    const r = outreachReviewRow(1, { id: 'x', facts: { name: 'X' } });
    expect(r.classification).toBeNull();
    expect(r.first100).toBeNull();
    expect(r.reviewedAt).toBeNull();
    expect(r.programmeName).toBe('X');
  });

  it('accepts an unanswered row and a fully answered one', () => {
    expect(outreachRowError(outreachReviewRow(1, { id: 'x', facts: null }))).toBeNull();
    expect(outreachRowError({ classification: 'PURSUE', first100: 'YES' })).toBeNull();
  });

  it('refuses a classification or an answer it does not recognise', () => {
    expect(outreachRowError({ classification: 'MAYBE', first100: null })).toMatch(/classification/);
    expect(outreachRowError({ classification: null, first100: 'PROBABLY' })).toMatch(/first-100/);
  });
});

describe('the pre-registered metrics', () => {
  it('have unique ids', () => {
    expect(new Set(METRIC_IDS).size).toBe(METRIC_IDS.length);
  });

  it('name one primary metric, and it is the elite comparison A7.12 left open', () => {
    const primary = PREREGISTERED_METRICS.filter((m) => m.primary === true);
    expect(primary.map((m) => m.id)).toEqual(['eliteRelativeDistribution']);
  });

  it('explicitly demote Kendall tau', () => {
    const tau = PREREGISTERED_METRICS.find((m) => m.id === 'kendallTauB');
    expect(tau.primary).toBe(false);
    expect(tau.statement).toMatch(/SECONDARY/);
  });

  it('cover every group the brief asks for', () => {
    const groups = new Set(PREREGISTERED_METRICS.map((m) => m.group));
    for (const g of ['containment', 'shape', 'elite', 'agreement', 'limitedData', 'tradeoff', 'ordering']) {
      expect(groups, g).toContain(g);
    }
  });

  it('state the rank-distance banding rather than counting every miss alike', () => {
    const m = PREREGISTERED_METRICS.find((x) => x.id === 'first100YesRankDistance');
    expect(m.statement).toMatch(/101-150/);
    expect(m.statement).toMatch(/501\+/);
  });

  it('record what A7.7 scored on the limited-data question, so V3 has a baseline', () => {
    const m = PREREGISTERED_METRICS.find((x) => x.id === 'limitedDataReadAsAbsence');
    expect(m.statement).toMatch(/0%/);
  });

  it('mark the trade-off metric descriptive, not interpretive', () => {
    const m = PREREGISTERED_METRICS.find((x) => x.id === 'recruitabilityVsLevel');
    expect(m.statement).toMatch(/DESCRIPTIVE ONLY/);
  });
});

describe('helpers', () => {
  it('knows which classifications mean "on my list"', () => {
    expect(isPursueSet('PURSUE_STRONGLY')).toBe(true);
    expect(isPursueSet('PURSUE')).toBe(true);
    expect(isPursueSet('BORDERLINE')).toBe(false);
    expect(isPursueSet('INSUFFICIENT_INFORMATION')).toBe(false);
  });

  it('gives INSUFFICIENT_INFORMATION no ordinal, so it cannot enter a correlation', () => {
    expect(classificationOrdinal('INSUFFICIENT_INFORMATION')).toBeNull();
    expect(classificationOrdinal('PURSUE_STRONGLY')).toBe(5);
    expect(classificationOrdinal('WOULD_NOT_PURSUE')).toBe(1);
  });
});
