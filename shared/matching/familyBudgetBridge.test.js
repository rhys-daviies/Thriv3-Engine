/**
 * A7.9.5 — the V1 compatibility bridge, and the proof it changed nothing.
 *
 * The central claim is an IDENTITY, not an approximation: V1 reads a budget
 * ceiling and nothing else, so a band and an exact contribution at that
 * band's ceiling are the same input and must produce the same output, all the
 * way down to the final score. If any of these ever stops being exact, the
 * bridge has started changing V1 rather than feeding it.
 */
import { describe, it, expect } from 'vitest';
import {
  BUDGET_CEILINGS, LEGACY_BUDGET_CEILINGS, UNDECLARED_BUDGET, NO_NEED_BUDGET,
  budgetCeiling, familyBudgetCeiling, CONTRIBUTION_STATES, NEUTRAL_PRIOR,
} from './constants.js';
import { scholarshipNeed, resolveCouplings } from './couplings.js';
import { affordability } from './criteria.js';
import { scoreMatch } from './score.js';
import { rankMatches } from './pool.js';

const { STATED, NOT_A_CONSTRAINT, NEEDS_CONFIRMATION } = CONTRIBUTION_STATES;
const stated = (usd) => ({ contributionState: STATED, maxAnnualContributionUsd: usd });

/** A dear out-of-state public and a cheap private, priced from real rows. */
const DEAR = {
  netPrice: 32875, control: 1, tuitionIn: 20644, tuitionOut: 41790,
  athleteState: 'CA', schoolState: 'PA', division: 'NCAA D1',
  sport: 'mens-soccer', conference: 'Big Ten Conference', athleteLevel: 90, programLevel: 83,
};
const CHEAP = { ...DEAR, netPrice: 6128, control: 2, schoolState: 'NJ', tuitionIn: null, tuitionOut: null };

const athlete = (over = {}) => ({
  sport: 'mens-soccer', level: 90, position: 'MIDFIELD', classYear: 2028,
  gpa: 3.4, sat: 1200, act: null, state: 'CA', origin: 'USA', country: null,
  criterionRanking: null, weightOverrides: null, budgetRange: null, ...over,
});
const college = {
  soccerScore: 83, academicRating: 7.2, satAvg: 1280, admitRate: 0.42,
  division: 'NCAA D1', conference: 'Big Ten Conference', netPrice: 32875, control: 1,
  tuitionIn: 20644, tuitionOut: 41790, state: 'PA', distanceMiles: 2400,
  origin: 'USA', athleteCountry: null, internationalRows: 4, sameCountryRows: 0,
  qualityPercentile: 0.81, recentWinPct: 0.6, priorWinPct: 0.5,
  graduatingStarters: 2, graduatingSquad: 3, rosterRows: 28, rowsMissingGradYear: 0,
};

/** Everything V1 derives from the athlete's money, in one object. */
function v1Financials(over) {
  const a = athlete(over);
  const coupled = resolveCouplings(a, { academicWeight: 0.15 });
  return {
    ceiling: familyBudgetCeiling(a),
    need: scholarshipNeed(a),
    couplings: { weights: coupled.weights, shapes: coupled.shapes, fired: [...coupled.fired] },
    affordability: affordability({ ...DEAR, ...over }),
    score: scoreMatch({ athlete: a, college, shapes: coupled.shapes }),
  };
}

describe('every bounded legacy band equals an exact contribution at its ceiling', () => {
  const bounded = Object.entries({ ...BUDGET_CEILINGS, ...LEGACY_BUDGET_CEILINGS })
    .filter(([, c]) => Number.isFinite(c));

  it('covers all nine current bands and all three bounded legacy ones', () => {
    expect(bounded.length).toBe(12);
  });

  it.each(bounded)('%s (ceiling %d)', (band, ceiling) => {
    const viaBand = v1Financials({ budgetRange: band });
    const viaExact = v1Financials(stated(ceiling));

    expect(viaExact.ceiling, 'family ceiling').toBe(viaBand.ceiling);
    expect(viaExact.need, 'scholarship need').toBe(viaBand.need);
    expect(viaExact.couplings, 'resolved couplings').toEqual(viaBand.couplings);
    expect(viaExact.affordability, 'affordability, whole result').toEqual(viaBand.affordability);
    expect(viaExact.score.breakdown, 'every criterion part').toEqual(viaBand.score.breakdown);
    expect(viaExact.score.score, 'final V1 score').toBe(viaBand.score.score);
  });

  it('holds at the cheap school too, where the gap is zero either way', () => {
    for (const [band, ceiling] of bounded) {
      expect(affordability({ ...CHEAP, contributionState: STATED, maxAnnualContributionUsd: ceiling }))
        .toEqual(affordability({ ...CHEAP, budgetRange: band }));
    }
  });
});

describe('the state mapping, pinned', () => {
  it.each([
    ['STATED $0', stated(0), 0, 1],
    ['STATED $10,000', stated(10000), 10000, 1 - 10000 / NO_NEED_BUDGET],
    ['STATED $20,000', stated(20000), 20000, 1 - 20000 / NO_NEED_BUDGET],
    ['STATED $30,000', stated(30000), 30000, 1 - 30000 / NO_NEED_BUDGET],
    ['STATED $40,000', stated(40000), 40000, 1 - 40000 / NO_NEED_BUDGET],
    ['STATED $47,500', stated(47500), 47500, 0],
    ['STATED $60,000', stated(60000), 60000, 0],
  ])('%s resolves to its own ceiling and the need that follows', (_l, over, ceiling, need) => {
    expect(familyBudgetCeiling(athlete(over))).toBe(ceiling);
    expect(scholarshipNeed(athlete(over))).toBeCloseTo(need, 12);
  });

  it('STATED $10,000 reproduces the $5k-$10k band exactly', () => {
    expect(v1Financials(stated(10000))).toEqual(v1Financials({ budgetRange: '$5k-$10k/yr' }));
  });

  it('STATED $0 reproduces Need Full Scholarship exactly', () => {
    expect(v1Financials(stated(0))).toEqual(v1Financials({ budgetRange: 'Need Full Scholarship' }));
    expect(scholarshipNeed(athlete(stated(0)))).toBe(1);
  });

  it('NOT_A_CONSTRAINT is V1\'s existing no-ceiling state', () => {
    const r = v1Financials({ contributionState: NOT_A_CONSTRAINT });
    expect(r.ceiling).toBe(Infinity);
    expect(r.need).toBe(0);
    expect(r.affordability.score).toBe(1);
    expect(r.affordability.confidence).not.toBe('assumed');
    expect(r.couplings.fired).toEqual([]);
    // Identical to the open band, which is the same statement to V1.
    expect(r).toEqual(v1Financials({ budgetRange: '$40k+/yr' }));
  });

  it('NEEDS_CONFIRMATION is V1\'s existing unknown, not a zero and not a band', () => {
    const r = v1Financials({ contributionState: NEEDS_CONFIRMATION });
    expect(r.ceiling).toBeUndefined();
    expect(r.need).toBeNull();
    expect(r.affordability.score).toBe(NEUTRAL_PRIOR);
    expect(r.affordability.confidence).toBe('assumed');
    expect(r.couplings.fired).toEqual([]);

    // Scores identically to BOTH of V1's existing unknowns. `numbers` drops
    // the per-criterion `detail`, which is where the one difference lives.
    const numbers = (x) => ({
      total: x.score.score,
      parts: x.score.breakdown.map(({ key, weight, score, contribution, confidence }) => ({ key, weight, score, contribution, confidence })),
    });
    const undeclared = v1Financials({ budgetRange: UNDECLARED_BUDGET });
    const blank = v1Financials({ budgetRange: null });
    expect(numbers(r)).toEqual(numbers(undeclared));
    expect(numbers(r)).toEqual(numbers(blank));
    expect(r.couplings).toEqual(undeclared.couplings);

    /**
     * ...and lands on the right side of a distinction V1 already drew. A
     * deliberate refusal is a decision the family made and the card should
     * not nag about it; an unconfirmed contribution is a gap somebody can go
     * and fill. NEEDS_CONFIRMATION is the second of those, so it reads as a
     * blank rather than as a refusal - the only difference between them, and
     * it is in the wording, not the number.
     */
    expect(r.affordability.detail.reason).toBe('no budget stated');
    expect(undeclared.affordability.detail.reason).toMatch(/deliberately undeclared/);
    expect(blank.affordability.detail.reason).toBe('no budget stated');
  });

  it('an athlete with neither representation is unchanged', () => {
    expect(v1Financials({})).toEqual(v1Financials({ budgetRange: null }));
    expect(familyBudgetCeiling(athlete({}))).toBeUndefined();
  });

  it('the three need couplings still fire on exactly the same threshold', () => {
    // 0.4 need is a ceiling of 27,000. Either side of it, from the new field.
    expect(scholarshipNeed(athlete(stated(27000)))).toBeCloseTo(0.4, 12);
    expect(resolveCouplings(athlete(stated(26000)), { academicWeight: 0.15 }).fired).toEqual([
      'need-favours-staying-in-state', 'need-raises-affordability', 'need-shifts-athletic-peak-upward',
    ]);
    expect(resolveCouplings(athlete(stated(28000)), { academicWeight: 0.15 }).fired).toEqual([]);
  });
});

describe('legacy behaviour is untouched', () => {
  it('reads every band budgetCeiling reads, identically', () => {
    for (const band of [...Object.keys(BUDGET_CEILINGS), ...Object.keys(LEGACY_BUDGET_CEILINGS)]) {
      expect(familyBudgetCeiling({ budgetRange: band }), band).toBe(budgetCeiling(band));
    }
  });

  it('leaves the open $40k+ band open — it is not a stated $40,000', () => {
    expect(familyBudgetCeiling({ budgetRange: '$40k+/yr' })).toBe(Infinity);
    expect(familyBudgetCeiling(stated(40000))).toBe(40000);
    expect(scholarshipNeed(athlete({ budgetRange: '$40k+/yr' }))).toBe(0);
    expect(scholarshipNeed(athlete(stated(40000)))).toBeGreaterThan(0);
  });

  it('prefers the new answer when an athlete carries both', () => {
    expect(familyBudgetCeiling({ budgetRange: '$5k-$10k/yr', ...stated(60000) })).toBe(60000);
  });
});

describe('malformed pairs resolve to unknown, never to a number and never to a band', () => {
  it.each([
    ['STATED with no amount', { contributionState: STATED, maxAnnualContributionUsd: null }],
    ['STATED with a negative amount', { contributionState: STATED, maxAnnualContributionUsd: -5000 }],
    ['STATED with NaN', { contributionState: STATED, maxAnnualContributionUsd: Number.NaN }],
    ['STATED with a string', { contributionState: STATED, maxAnnualContributionUsd: '45000' }],
    ['NOT_A_CONSTRAINT with an amount', { contributionState: NOT_A_CONSTRAINT, maxAnnualContributionUsd: 50000 }],
    ['NEEDS_CONFIRMATION with an amount', { contributionState: NEEDS_CONFIRMATION, maxAnnualContributionUsd: 50000 }],
    ['an unrecognised state', { contributionState: 'WEALTHY', maxAnnualContributionUsd: null }],
    ['an amount with no state', { contributionState: null, maxAnnualContributionUsd: 50000 }],
  ])('%s', (_label, pair) => {
    expect(familyBudgetCeiling(pair)).toBeUndefined();
    expect(scholarshipNeed(pair)).toBeNull();
    expect(affordability({ ...DEAR, budgetRange: null, ...pair }).score).toBe(NEUTRAL_PRIOR);
  });

  it('does NOT fall back to a band sitting beside a corrupt state', () => {
    /**
     * Deliberate. A row claiming STATED with no amount is corrupt, and
     * scoring it from a band that happens to be there too would hide that
     * behind a plausible number. Unknown is both truthful and visible: the
     * card says "no budget stated" instead of showing a figure nobody can
     * account for.
     */
    const corrupt = { budgetRange: '$5k-$10k/yr', contributionState: STATED, maxAnnualContributionUsd: null };
    expect(familyBudgetCeiling(corrupt)).toBeUndefined();
    expect(familyBudgetCeiling({ budgetRange: '$5k-$10k/yr' })).toBe(10000);
  });

  it('never crashes on junk', () => {
    for (const junk of [null, undefined, {}, { contributionState: 42 }, { maxAnnualContributionUsd: {} }]) {
      expect(() => familyBudgetCeiling(junk)).not.toThrow();
      expect(() => scholarshipNeed(junk)).not.toThrow();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Ordering, not just scores                                           */
/* ------------------------------------------------------------------ */

describe('the ranking a band produces and the ranking its ceiling produces', () => {
  /**
   * A synthetic pool spanning the axis affordability actually moves along:
   * cheap and dear, public and private, in-state and out, strong and weak.
   * The full-pool proof over 1,166 real programmes lives in
   * server/scripts/v1BridgeProof.js; this is the version that can run without
   * a database, on every commit.
   */
  const pool = [
    ['Dear OOS public', 32875, 1, 20644, 41790, 'PA', 83, 7.2],
    ['Cheap private', 6128, 2, null, null, 'NJ', 79, 9.5],
    ['Mid private', 30308, 2, null, null, 'SC', 71, 8.1],
    ['In-state public', 14200, 1, 13800, 39000, 'CA', 66, 6.4],
    ['Dear private', 62688, 2, null, null, 'MA', 88, 9.8],
    ['Weak cheap public', 9100, 1, 8800, 21000, 'TX', 41, 4.2],
    ['Weak dear private', 48000, 2, null, null, 'NY', 38, 5.1],
    ['Strong OOS public', 13138, 1, 17736, 60946, 'MI', 91, 7.9],
  ].map(([name, net, control, tin, tout, st, soccer, acad], i) => ({
    id: `c${i}`, name, sport: 'mens-soccer', active: 1,
    net_price: net, control, tuition_in_state: tin, tuition_out_state: tout, state: st,
    soccer_score: soccer, academic_rating: acad, sat_avg: 1200 + (i * 20), admit_rate: 0.5,
    division: 'NCAA D1', conference: 'ACC', latitude: 40 + i, longitude: -80 - i,
    recent_win_pct: 0.55, prior_win_pct: 0.5,
  }));

  const order = (over) => rankMatches({ athlete: athlete(over), colleges: pool, rosterIndex: new Map() })
    .results.map((r) => `${r.name}:${r.match_score}`);

  const bounded = Object.entries({ ...BUDGET_CEILINGS, ...LEGACY_BUDGET_CEILINGS })
    .filter(([, c]) => Number.isFinite(c));

  it.each(bounded)('%s ranks identically to STATED at its ceiling', (band, ceiling) => {
    expect(order(stated(ceiling))).toEqual(order({ budgetRange: band }));
  });

  it('the open band is NOT a stated $40,000 — a different statement, scored differently', () => {
    /**
     * On eight schools the two can land in the same ORDER, so the claim is
     * made where it actually lives: the open band states no ceiling, so need
     * is 0 and affordability saturates; $40,000 is a ceiling, so it does not.
     */
    expect(scholarshipNeed(athlete({ budgetRange: '$40k+/yr' }))).toBe(0);
    expect(scholarshipNeed(athlete(stated(40000)))).toBeGreaterThan(0);
    // A D3 private, where the aid rule is a known zero, so nothing erodes the
    // gap between a $62,688 cost and a $40,000 ceiling.
    const dearest = {
      ...DEAR, netPrice: 62688, control: 2, tuitionIn: null, tuitionOut: null,
      division: 'NCAA D3', conference: 'NESCAC',
    };
    expect(affordability({ ...dearest, budgetRange: '$40k+/yr' }).score).toBe(1);
    expect(affordability({ ...dearest, ...stated(40000) }).score).toBeLessThan(1);
  });

  it('NEEDS_CONFIRMATION ranks exactly like V1\'s existing unknowns', () => {
    expect(order({ contributionState: NEEDS_CONFIRMATION })).toEqual(order({ budgetRange: UNDECLARED_BUDGET }));
    expect(order({ contributionState: NEEDS_CONFIRMATION })).toEqual(order({ budgetRange: null }));
  });

  it('NOT_A_CONSTRAINT ranks exactly like the open band', () => {
    expect(order({ contributionState: NOT_A_CONSTRAINT })).toEqual(order({ budgetRange: '$40k+/yr' }));
  });

  it('a tight exact maximum reorders against an unknown one, which is the point', () => {
    // The regression this bridge closes: without it, STATED $10,000 scored as
    // though nothing had been said. A7.9.4 measured 42 of 100 surviving on the
    // real pool; here it is simply "not the same list".
    expect(order(stated(10000))).not.toEqual(order({ contributionState: NEEDS_CONFIRMATION }));
    expect(order(stated(10000))).toEqual(order({ budgetRange: '$5k-$10k/yr' }));
  });
});
