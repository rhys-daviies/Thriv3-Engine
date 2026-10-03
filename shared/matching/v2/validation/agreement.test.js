import { describe, it, expect } from 'vitest';
import { rowAgreement, kendallTauB, agreementFor, aggregateAgreement } from './agreement.js';

/** A minimal packet: agreement reads only viewB, the athlete block and the ids. */
const prog = (over = {}) => ({
  id: over.id, name: over.name ?? over.id, division: over.division ?? 'NCAA D3',
  strata: over.strata ?? ['TOP_10'],
  rank: over.rank ?? null,
  v1Rank: over.v1Rank ?? null,
  model: { rankingState: over.state ?? 'RANKED', rank: over.rank ?? null, pursuitPriority: 0.4 },
  explanation: { codes: [{ code: 'ATHLETIC_AT_OR_ABOVE_LEVEL' }] },
});

const pack = (programmes, athlete = {}) => ({
  packId: 'T', athlete: { label: 'test', abilityBand: 'MID', position: 'MIDFIELD', preferenceProfile: 'UNDECLARED', ...athlete },
  viewB: { programmes },
});

const review = (id, classification, over = {}) => ({ programmeId: id, classification, ...over });

describe('rowAgreement', () => {
  it('leaves INSUFFICIENT_INFORMATION out of the denominator entirely', () => {
    expect(rowAgreement({ classification: 'INSUFFICIENT_INFORMATION' }, { rank: 1, rankingState: 'RANKED' }))
      .toEqual({ counted: false });
  });

  it('calls a top-25 programme the operator would not contact a disagreement', () => {
    const a = rowAgreement({ classification: 'WOULD_NOT_PURSUE' }, { rank: 4, rankingState: 'RANKED' });
    expect(a).toMatchObject({ counted: true, disagrees: true, kind: 'RANKED_HIGH_HUMAN_LOW' });
  });

  it('calls a programme outside the hundred the operator would contact an omission', () => {
    const a = rowAgreement({ classification: 'PURSUE' }, { rank: 140, rankingState: 'RANKED' });
    expect(a.kind).toBe('HUMAN_PURSUE_MODEL_OMITTED');
  });

  it('does not count BORDERLINE in the top 25 as disagreement', () => {
    expect(rowAgreement({ classification: 'BORDERLINE' }, { rank: 3, rankingState: 'RANKED' }).disagrees).toBe(false);
  });

  it('only calls a limited-data row a disagreement when the operator would contact it first', () => {
    expect(rowAgreement({ classification: 'PURSUE_STRONGLY' }, { rankingState: 'LIMITED_DATA' }).disagrees).toBe(true);
    // Contacting it anyway is the list working: it flags what we cannot score.
    expect(rowAgreement({ classification: 'PURSUE' }, { rankingState: 'LIMITED_DATA' }).disagrees).toBe(false);
    expect(rowAgreement({ classification: 'WOULD_NOT_PURSUE' }, { rankingState: 'LIMITED_DATA' }).disagrees).toBe(false);
  });
});

describe('Kendall tau-b', () => {
  it('is 1 when the operator and the model agree on every ordered pair', () => {
    const r = kendallTauB([{ human: 5, rank: 1 }, { human: 4, rank: 2 }, { human: 3, rank: 3 }, { human: 2, rank: 4 }]);
    expect(r.tauB).toBe(1);
    expect(r.pairwiseOrderingAgreement).toBe(1);
  });

  it('is negative when the model orders the opposite way', () => {
    const r = kendallTauB([{ human: 1, rank: 1 }, { human: 3, rank: 2 }, { human: 5, rank: 3 }]);
    expect(r.tauB).toBeLessThan(0);
  });

  it('ignores pairs the operator did not order, rather than treating a tie as agreement', () => {
    const r = kendallTauB([{ human: 4, rank: 1 }, { human: 4, rank: 2 }, { human: 4, rank: 3 }, { human: 2, rank: 4 }]);
    expect(r.tiedHuman).toBe(3);
    expect(r.pairwiseOrderingAgreement).toBe(1);
  });

  it('refuses to report on too few programmes', () => {
    expect(kendallTauB([{ human: 5, rank: 1 }])).toBeNull();
  });
});

describe('agreementFor', () => {
  const programmes = [
    prog({ id: 'a', rank: 1 }), prog({ id: 'b', rank: 2 }), prog({ id: 'c', rank: 3 }),
    prog({ id: 'd', rank: 20 }), prog({ id: 'e', rank: 24 }),
    prog({ id: 'f', rank: 102, strata: ['JUST_OUTSIDE_TOP'] }),
    prog({ id: 'g', state: 'LIMITED_DATA', division: 'NJCAA', strata: ['LIMITED_DATA'] }),
    prog({ id: 'h', state: 'LIMITED_DATA', division: 'NJCAA', strata: ['LIMITED_DATA'] }),
  ];
  const reviews = [
    review('a', 'PURSUE_STRONGLY', { explanationReview: { helpful: 'YES', accurate: 'YES' } }),
    review('b', 'PURSUE', { explanationReview: { helpful: 'YES', accurate: 'NO', misleadingClaim: 'says a place is opening when the keeper is a junior' } }),
    review('c', 'WOULD_NOT_PURSUE', { reasonTags: ['ATHLETE_BELOW_LEVEL'], disagreement: 'MODEL_BUG' }),
    review('d', 'BORDERLINE'),
    review('e', 'LOW_PRIORITY'),
    review('f', 'PURSUE_STRONGLY'),
    review('g', 'INSUFFICIENT_INFORMATION'),
    review('h', 'WOULD_NOT_PURSUE', { reasonTags: ['INSUFFICIENT_ROSTER_DATA'] }),
  ];
  const r = agreementFor(pack(programmes), reviews);

  it('reports the top of the list on its own', () => {
    expect(r.top10StrongPursue).toEqual({ n: 3, rate: 0.3333 });
    expect(r.top10Pursue.rate).toBeCloseTo(0.6667, 3);
  });

  it('counts the operator dismissing a top-25 programme', () => {
    expect(r.humanLowPriorityInTop25.rate).toBeGreaterThan(0);
    expect(r.humanWouldNotPursueInTop100.rate).toBeGreaterThan(0);
  });

  it('names the omissions rather than only counting them', () => {
    expect(r.top100Omission.programmes.map((p) => p.id)).toContain('f');
  });

  it('separates limited data read as absence from limited data read as poor', () => {
    expect(r.limitedData.n).toBe(2);
    expect(r.limitedData.readAsAbsence).toBe(0.5);
    expect(r.limitedData.readAsPoor).toBe(0.5);
  });

  it('surfaces convincing-but-wrong explanations with the codes that were on screen', () => {
    expect(r.explanationReview.convincingButWrong).toHaveLength(1);
    expect(r.explanationReview.convincingButWrong[0].id).toBe('b');
    expect(r.explanationReview.convincingButWrong[0].codes).toContain('ATHLETIC_AT_OR_ABOVE_LEVEL');
  });

  it('keeps the triage categories the operator assigned', () => {
    expect(r.disagreementCategories.MODEL_BUG).toBe(1);
  });

  it('breaks disagreement down by division and by stratum', () => {
    expect(Object.keys(r.byDivision)).toContain('NCAA D3');
    expect(Object.keys(r.byStratum)).toContain('TOP_10');
  });

  it('produces no single accuracy number', () => {
    expect('accuracy' in r).toBe(false);
    expect('score' in r).toBe(false);
  });

  it('survives a review nobody has filled in', () => {
    const empty = agreementFor(pack(programmes), []);
    expect(empty.reviewed).toBe(0);
    expect(empty.disagreementRate).toBeNull();
    expect(empty.ordering).toBeNull();
  });
});

describe('aggregateAgreement', () => {
  it('breaks results down by the things only several athletes can show', () => {
    const one = { pack: pack([prog({ id: 'a', rank: 1 }), prog({ id: 'b', rank: 2 }), prog({ id: 'c', rank: 3 })], { abilityBand: 'ELITE', position: 'FORWARD', preferenceProfile: 'LEVEL_FIRST' }), reviews: [review('a', 'PURSUE'), review('b', 'PURSUE'), review('c', 'WOULD_NOT_PURSUE')] };
    const two = { pack: pack([prog({ id: 'd', rank: 1 }), prog({ id: 'e', rank: 2 })], { abilityBand: 'DEVELOPMENTAL', position: 'GOALKEEPER', preferenceProfile: 'UNDECLARED' }), reviews: [review('d', 'PURSUE'), review('e', 'PURSUE')] };
    const agg = aggregateAgreement([one, two]);
    expect(Object.keys(agg.byAthleteLevel)).toEqual(['ELITE', 'DEVELOPMENTAL']);
    expect(Object.keys(agg.byPosition)).toEqual(['FORWARD', 'GOALKEEPER']);
    expect(Object.keys(agg.byPreferenceProfile)).toEqual(['LEVEL_FIRST', 'UNDECLARED']);
    expect(agg.byAthleteLevel.ELITE.rate).toBeGreaterThan(0);
    expect(agg.byAthleteLevel.DEVELOPMENTAL.rate).toBe(0);
    expect(agg.byDivision['NCAA D3'].reviewed).toBe(5);
  });
});
