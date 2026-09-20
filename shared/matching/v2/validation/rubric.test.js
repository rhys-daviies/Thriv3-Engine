import { describe, it, expect } from 'vitest';
import {
  CLASSIFICATION, CLASSIFICATION_ORDER, PURSUE_SET, classificationRank, isPursue,
  REASON_TAG, TAG_IMPLICATES, EXPLANATION_REVIEW, DISAGREEMENT, DISAGREEMENT_MEANING,
  VALIDATION_QUESTIONS, ADOPTION_BLOCKERS, TOLERABLE_DISAGREEMENT, assertReview,
} from './rubric.js';

describe('the classification scale', () => {
  it('gives INSUFFICIENT_INFORMATION no ordinal at all', () => {
    // The same rule the model itself follows: an absent judgement is not a
    // mild one, and averaging it into the middle would manufacture agreement.
    expect(CLASSIFICATION_ORDER.INSUFFICIENT_INFORMATION).toBeUndefined();
    expect(classificationRank(CLASSIFICATION.INSUFFICIENT_INFORMATION)).toBeNull();
  });

  it('orders the five judgements strictly', () => {
    const ranks = ['WOULD_NOT_PURSUE', 'LOW_PRIORITY', 'BORDERLINE', 'PURSUE', 'PURSUE_STRONGLY']
      .map(classificationRank);
    expect(ranks).toEqual([1, 2, 3, 4, 5]);
  });

  it('counts only the two outreach labels as pursue', () => {
    expect(PURSUE_SET).toEqual(['PURSUE_STRONGLY', 'PURSUE']);
    expect(isPursue('BORDERLINE')).toBe(false);
    expect(isPursue('PURSUE')).toBe(true);
  });
});

describe('the reason tags', () => {
  it('names every tag a layer or explicitly none', () => {
    for (const key of Object.keys(REASON_TAG)) expect(key in TAG_IMPLICATES).toBe(true);
    expect(TAG_IMPLICATES.OTHER).toBeNull();
  });

  it('covers every tag the task asked for', () => {
    const tags = Object.values(REASON_TAG);
    for (const wanted of [
      'athlete below level', 'athlete comfortably at level',
      'programme may be too weak for athlete goals',
      'strong roster opportunity', 'weak roster opportunity',
      'financial concern', 'good financial fit', 'playing opportunity',
      'level preference', 'major/academic fit',
      'international recruiting concern', 'insufficient roster data', 'other',
    ]) expect(tags).toContain(wanted);
  });
});

describe('the adoption blockers', () => {
  it('are all countable conditions rather than a pass percentage', () => {
    for (const b of ADOPTION_BLOCKERS) {
      expect(b.id).toMatch(/^[A-Z0-9_]+$/);
      expect(['BLOCKER', 'WATCH']).toContain(b.severity);
      expect(b.measure.length).toBeGreaterThan(10);
      expect(b.rationale.length).toBeGreaterThan(10);
    }
  });

  it('marks every trigger as proposed, because none of them is agreed yet', () => {
    for (const b of ADOPTION_BLOCKERS) expect(b.trigger).toMatch(/PROPOSED/);
  });

  it('separates what blocks adoption from what merely gets watched', () => {
    expect(ADOPTION_BLOCKERS.some((b) => b.severity === 'BLOCKER')).toBe(true);
    expect(ADOPTION_BLOCKERS.some((b) => b.severity === 'WATCH')).toBe(true);
    expect(TOLERABLE_DISAGREEMENT.length).toBeGreaterThan(3);
  });

  it('covers each pathology the task named', () => {
    const ids = ADOPTION_BLOCKERS.map((b) => b.id);
    for (const id of [
      'UNRECRUITABLE_IN_TOP_25', 'DEVELOPMENTAL_ELITE_REACH', 'BUDGET_IGNORED',
      'AMBITION_INERT', 'MISSING_STRONG_TARGETS', 'EXPLANATION_MISREPRESENTS',
      'LIMITED_DATA_READ_AS_POOR', 'DIVISION_OR_POSITION_PATHOLOGY',
    ]) expect(ids).toContain(id);
  });
});

describe('the disagreement taxonomy', () => {
  it('explains what each category means, so triage is not guesswork', () => {
    for (const k of Object.keys(DISAGREEMENT)) expect(DISAGREEMENT_MEANING[k]).toBeTruthy();
  });

  it('says out loud that human judgement is recorded and not fitted to', () => {
    expect(DISAGREEMENT_MEANING.HUMAN_JUDGEMENT).toMatch(/do not fit to it/i);
  });
});

describe('the thirteen questions', () => {
  it('are all present and each says where to look', () => {
    expect(VALIDATION_QUESTIONS).toHaveLength(13);
    for (const q of VALIDATION_QUESTIONS) expect(q.evidence.length).toBeGreaterThan(5);
  });

  it('keeps convincing-but-wrong as its own question', () => {
    expect(VALIDATION_QUESTIONS[12].question).toMatch(/convincing but wrong/i);
  });
});

describe('assertReview', () => {
  const good = {
    programmeId: 'x', classification: 'PURSUE',
    reasonTags: ['FINANCIAL_CONCERN'],
    explanationReview: { helpful: 'YES', accurate: 'PARTLY', tooMuchDetail: 'NO' },
    disagreement: 'ACCEPTABLE_DIFFERENCE',
  };

  it('accepts a well-formed row', () => expect(assertReview(good)).toBe(true));

  it('refuses a classification that is not on the scale', () => {
    expect(() => assertReview({ ...good, classification: 'MAYBE' })).toThrow(/unknown classification/);
  });

  it('refuses an invented reason tag rather than dropping it silently', () => {
    expect(() => assertReview({ ...good, reasonTags: ['VIBES'] })).toThrow(/unknown reason tag/);
  });

  it('refuses an explanation verdict outside the allowed words', () => {
    expect(() => assertReview({ ...good, explanationReview: { accurate: 'SORT OF' } })).toThrow(/YES\/PARTLY\/NO/);
  });

  it('refuses a disagreement category that is not in the taxonomy', () => {
    expect(() => assertReview({ ...good, disagreement: 'WHATEVER' })).toThrow(/unknown disagreement/);
  });

  it('allows the explanation review to be entirely unfilled', () => {
    expect(assertReview({ programmeId: 'x', classification: 'BORDERLINE' })).toBe(true);
  });

  it('states the allowed words for every explanation field', () => {
    expect(EXPLANATION_REVIEW.helpful).toEqual(['YES', 'PARTLY', 'NO']);
    expect(EXPLANATION_REVIEW.tooMuchDetail).toEqual(['YES', 'NO']);
  });
});
