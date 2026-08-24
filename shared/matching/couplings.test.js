import { describe, it, expect } from 'vitest';
import { scholarshipNeed, resolveCouplings, weightsFromRanking, COUPLINGS, BASE_PEAK_OFFSET, MAX_NEED_PEAK_OFFSET } from './couplings.js';
import { resolveWeights, DEFAULT_WEIGHTS, CRITERION_KEYS } from './weights.js';
import { rankMatches, buildRosterIndex } from './pool.js';
import { affordability, residency, athleticFit } from './criteria.js';

describe('scholarshipNeed', () => {
  it('reads need off the budget band, high to low', () => {
    expect(scholarshipNeed('Need Full Scholarship')).toBe(1);
    expect(scholarshipNeed('Under $15k/yr')).toBeGreaterThan(scholarshipNeed('$15k-$30k/yr'));
    expect(scholarshipNeed('$50k+/yr')).toBe(0);
  });

  it('is null when no budget was stated, so nothing couples off a guess', () => {
    expect(scholarshipNeed(undefined)).toBeNull();
    expect(scholarshipNeed('something else')).toBeNull();
  });
});

describe('resolveCouplings', () => {
  it('fires nothing when the athlete has stated no budget', () => {
    const r = resolveCouplings({ academicImportance: 5 });
    expect(r.fired).toEqual([]);
    for (const k of CRITERION_KEYS) expect(r.weights[k]).toBe(1);
    expect(r.shapes.athletic.peakOffset).toBeUndefined();
  });

  it('fires nothing for an athlete with no money pressure', () => {
    expect(resolveCouplings({ budgetRange: '$50k+/yr' }).fired).toEqual([]);
  });

  it('weights location and affordability up as need rises', () => {
    const mild = resolveCouplings({ budgetRange: '$15k-$30k/yr' });
    const acute = resolveCouplings({ budgetRange: 'Need Full Scholarship' });
    expect(acute.weights.geography).toBeGreaterThan(mild.weights.geography);
    expect(acute.weights.affordability).toBeGreaterThan(mild.weights.affordability);
    expect(mild.weights.geography).toBeGreaterThan(1);
  });

  it('shifts the athletic peak upward with need, so the athlete is the standout', () => {
    expect(resolveCouplings({ budgetRange: 'Need Full Scholarship' }).shapes.athletic.peakOffset).toBe(MAX_NEED_PEAK_OFFSET);
    expect(resolveCouplings({ budgetRange: '$50k+/yr' }).shapes.athletic.peakOffset).toBeUndefined();
  });

  it('discounts academic reaches harder when academics are a stated priority', () => {
    expect(resolveCouplings({ academicImportance: 9 }).shapes.academic.admissibilityFloor).toBe(0.25);
    expect(resolveCouplings({ academicImportance: 4 }).shapes.academic.admissibilityFloor).toBeUndefined();
  });

  it('explains every coupling it fires', () => {
    const r = resolveCouplings({ budgetRange: 'Need Full Scholarship', academicImportance: 9 });
    expect(r.notes.length).toBe(r.fired.length);
    for (const note of r.notes) expect(note.length).toBeGreaterThan(20);
  });

  it('declares the evidence behind each rule, so an assumption is visible as one', () => {
    for (const rule of COUPLINGS) {
      expect(rule.why.length).toBeGreaterThan(40);
      expect(rule.evidence).toMatch(/^(measured|assumed)/);
    }
    // The big-fish rule rests on recruiting knowledge, not on our data.
    const bigFish = COUPLINGS.find((c) => c.name === 'need-shifts-athletic-peak-upward');
    expect(bigFish.evidence).toMatch(/^assumed/);
  });
});

describe('residency', () => {
  const publicSchool = { netPrice: 14000, control: 1, tuitionIn: 12740, tuitionOut: 30611, schoolState: 'OH' };

  it('adds the out-of-state premium at a public institution', () => {
    const out = residency({ ...publicSchool, athleteState: 'CA' });
    expect(out.price).toBe(14000 + (30611 - 12740));
    expect(out.detail.residency).toBe('out-of-state');
  });

  it('leaves a resident paying the published net price', () => {
    const inState = residency({ ...publicSchool, athleteState: 'OH' });
    expect(inState.price).toBe(14000);
    expect(inState.detail.inState).toBe(true);
  });

  it('does not move a private institution, which charges one price', () => {
    const priv = residency({ netPrice: 30000, control: 2, tuitionIn: 52000, tuitionOut: 52000, athleteState: 'CA', schoolState: 'OH' });
    expect(priv.price).toBe(30000);
    expect(priv.detail.residency).toBe('private');
  });

  it('returns null price rather than guessing when there is no net price', () => {
    expect(residency({ netPrice: null, control: 1, athleteState: 'OH', schoolState: 'OH' }).price).toBeNull();
  });
});

describe('affordability with residency', () => {
  it('rates the same school worse for an out-of-state athlete', () => {
    const base = { budgetRange: 'Under $15k/yr', netPrice: 14000, control: 1, tuitionIn: 12740, tuitionOut: 30611, schoolState: 'OH', division: 'NCAA D1', sport: 'mens-soccer' };
    const home = affordability({ ...base, athleteState: 'OH' });
    const away = affordability({ ...base, athleteState: 'CA' });
    expect(home.score).toBeGreaterThan(away.score);
    expect(away.detail.outOfStatePremium).toBe(17871);
  });
});

describe('athleticFit under a shifted peak', () => {
  it('prefers a weaker programme once the peak moves up', () => {
    const strong = { athleteLevel: 60, programLevel: 58 };
    const weaker = { athleteLevel: 60, programLevel: 44 };
    // Default peak: being just above the programme is best.
    expect(athleticFit(strong).score).toBeGreaterThan(athleticFit(weaker).score);
    // Shifted for scholarship need: being clearly the standout is best.
    expect(athleticFit({ ...weaker, peakOffset: MAX_NEED_PEAK_OFFSET }).score)
      .toBeGreaterThan(athleticFit({ ...strong, peakOffset: MAX_NEED_PEAK_OFFSET }).score);
  });

  it('moves the reach and safety labels with the peak', () => {
    expect(athleticFit({ athleteLevel: 60, programLevel: 60, peakOffset: BASE_PEAK_OFFSET }).label).toBe('target');
    expect(athleticFit({ athleteLevel: 60, programLevel: 60, peakOffset: MAX_NEED_PEAK_OFFSET }).label).toBe('reach');
  });
});

describe('weightsFromRanking', () => {
  it('makes the top-ranked criterion the heaviest', () => {
    const w = weightsFromRanking(['geography', 'affordability', 'athletic', 'roster', 'academic', 'programQuality'], { ...DEFAULT_WEIGHTS, academic: 10 });
    expect(w.geography).toBeGreaterThan(w.affordability);
    expect(w.affordability).toBeGreaterThan(w.programQuality);
  });

  it('keeps a gentle spread — a ranking says "more", not "only"', () => {
    const w = weightsFromRanking(['geography', 'affordability', 'athletic', 'roster', 'academic', 'programQuality'], { ...DEFAULT_WEIGHTS, academic: 10 });
    expect(w.geography / w.programQuality).toBeLessThan(5);
    expect(w.programQuality).toBeGreaterThan(0);
  });

  it('leaves the defaults alone when nothing was ranked', () => {
    expect(weightsFromRanking(null, DEFAULT_WEIGHTS)).toEqual(DEFAULT_WEIGHTS);
    expect(weightsFromRanking([], DEFAULT_WEIGHTS)).toEqual(DEFAULT_WEIGHTS);
  });

  it('ignores a criterion name it does not recognise', () => {
    const w = weightsFromRanking(['vibes', 'geography'], { ...DEFAULT_WEIGHTS, academic: 10 });
    expect(w.vibes).toBeUndefined();
    expect(Number.isFinite(w.geography)).toBe(true);
  });
});

describe('resolveWeights precedence', () => {
  const ranking = ['geography', 'affordability', 'athletic', 'roster', 'academic', 'programQuality'];

  it('lets a ranking beat the defaults', () => {
    const ranked = resolveWeights({ academicImportance: 5, ranking });
    const plain = resolveWeights({ academicImportance: 5 });
    expect(ranked.geography).toBeGreaterThan(plain.geography);
  });

  it('lets an explicit override beat a coupling', () => {
    const coupled = resolveCouplings({ budgetRange: 'Need Full Scholarship' });
    const w = resolveWeights({ academicImportance: 5, couplings: coupled.weights, overrides: { geography: 0 } });
    expect(w.geography).toBe(0);
  });

  it('still sums to 1 with ranking, couplings and overrides all in play', () => {
    const coupled = resolveCouplings({ budgetRange: 'Under $15k/yr' });
    const w = resolveWeights({ academicImportance: 8, ranking, couplings: coupled.weights, overrides: { roster: 3 } });
    expect(CRITERION_KEYS.reduce((s, k) => s + w[k], 0)).toBeCloseTo(1, 10);
  });
});

describe('rankMatches with a high-need athlete', () => {
  const college = (over) => ({
    id: over.name, name: over.name, division: 'NCAA D1', conference: 'X', active: 1,
    soccer_score: 60, academic_rating: 6, sat_avg: 1100, admit_rate: 0.6,
    net_price: 14000, control: 1, tuition_in_state: 12740, tuition_out_state: 30611,
    state: 'OH', latitude: 40.19, longitude: -82.68, recent_win_pct: 0.5, prior_win_pct: 0.5, ...over,
  });
  const athlete = (over) => ({
    sport: 'mens-soccer', level: 60, position: 'MIDFIELD', classYear: 2027,
    academicImportance: 'Not Important', state: 'OH', divisions: [], conferences: [], ...over,
  });

  it('prefers the in-state option when money is tight', () => {
    const colleges = [
      college({ name: 'Home', state: 'OH', latitude: 40.19, longitude: -82.68 }),
      college({ name: 'Away', state: 'CA', latitude: 35.46, longitude: -119.36 }),
    ];
    const { results } = rankMatches({ athlete: athlete({ budgetRange: 'Under $15k/yr' }), colleges, rosterIndex: new Map() });
    expect(results[0].name).toBe('Home');
  });

  it('surfaces junior college for an athlete who needs a full scholarship', () => {
    const colleges = [
      college({ name: 'Expensive D3', division: 'NCAA D3', soccer_score: 45, net_price: 34000, control: 2 }),
      college({ name: 'Juco', division: 'NJCAA', soccer_score: 42, net_price: 8199, tuition_in_state: 4222, tuition_out_state: 9468 }),
    ];
    const { results } = rankMatches({ athlete: athlete({ budgetRange: 'Need Full Scholarship' }), colleges, rosterIndex: new Map() });
    expect(results[0].name).toBe('Juco');
  });

  it('reports the adjustments it made in the athlete\'s own terms', () => {
    const colleges = [college({ name: 'A' })];
    const { adjustments, couplingsFired } = rankMatches({ athlete: athlete({ budgetRange: 'Need Full Scholarship' }), colleges, rosterIndex: new Map() });
    expect(couplingsFired).toContain('need-shifts-athletic-peak-upward');
    expect(adjustments.join(' ')).toMatch(/standout/i);
  });

  it('leaves a well-funded athlete unmodified', () => {
    const colleges = [college({ name: 'A' })];
    const { couplingsFired } = rankMatches({ athlete: athlete({ budgetRange: '$50k+/yr' }), colleges, rosterIndex: new Map() });
    expect(couplingsFired).toEqual([]);
  });
});
