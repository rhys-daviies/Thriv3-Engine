/**
 * Financial Viability.
 *
 * THE QUESTION: given what we know today, how plausible is it that this
 * athlete can make this programme financially workable?
 *
 * Not "how cheap is this school" - that ignores the family. Not "how much
 * will this coach give" - we cannot know that. Not "how wealthy is this
 * family" - that is a fact about them, not about a programme.
 *
 *   1.0  the applicable cost is already inside what the family said they can
 *        pay. Nothing further has to be found.
 *   0.5  the family must find, on top of everything they stated, a further
 *        half of that amount again. Said $20k, the school costs $30k.
 *   0.0  approached as the amount still to be found grows without bound
 *        relative to the family's means. Never reached, because a school
 *        beyond a family's budget is exactly the school a scholarship exists
 *        to reach, and this layer must demote it rather than delete it.
 *
 * -- WHY NO ATHLETIC AWARD IS SUBTRACTED, AT ALL -------------------------
 *
 * A6.2 said not to scale an award by athletic delta. This goes further: no
 * athletic-aid dollars enter this score under ANY policy state, and the reason
 * is arithmetic rather than caution.
 *
 * The equivalency fractions are published as shares of a full COST OF
 * ATTENDANCE. We do not hold cost of attendance - it is in the Scorecard
 * extract and was never imported. What we hold is NET PRICE, which is already
 * after grant aid and runs roughly a third to a half of COA. Multiplying a
 * COA-denominated fraction by a net price is a category error: V1 does exactly
 * this, and at a private D1 with COA near $60k and net price near $25k it
 * awards 0.33 x $25k where the rule describes 0.33 x $60k. The number is not
 * conservative or aggressive; it is denominated in the wrong units.
 *
 * So this layer answers "viability BEFORE any athletic award", and carries the
 * rule's PERMITTED MAXIMUM as context - a capability, never an expectation and
 * never a dollar figure. One consequence is worth stating plainly: known-zero
 * aid (D3), conference-forbidden aid (Ivy) and unknown aid (USCAA) all
 * subtract the same nothing. They remain three different objects in the basis,
 * and because no branch changes the number, no arithmetic can ever collapse
 * them into each other.
 *
 * -- WHY NON-ATHLETIC AID IS NOT SUBTRACTED EITHER -----------------------
 *
 * Net price is defined as cost after grant and scholarship aid. Subtracting an
 * estimated grant from it would deduct the same money twice. Under the only
 * cost basis we have there is no non-athletic-aid term, and a strong GPA
 * cannot manufacture one.
 *
 * -- WHY BOTH SIDES ARE INTERVALS ----------------------------------------
 *
 * A budget band is an interval and collapsing "$20k-$25k" to $22.5k invents a
 * precision the family never gave. Residency is an interval too when we do not
 * hold the athlete's state: at a public they would pay either the published
 * net price or that plus the non-resident premium, and we know which two
 * numbers without knowing which one applies. Both are carried through, and the
 * funding gap comes out as a range rather than a manufactured point.
 */
import { GRADE, REASON, scoreable, unscoreable } from '../types.js';
import { AID_POLICY_STATUS, aidAssumption } from '../aidPolicy.js';
import {
  CONTROL, ATHLETIC_AID_RULES, NO_ATHLETIC_AID_CONFERENCES,
  familyContribution, CONTRIBUTION_SOURCE, CONTRIBUTION_ANCHOR, HALF_VIABILITY_RELATIVE_GAP,
} from '../financialRules.js';

/** What the applicable cost was built from. Recorded on every result. */
export const COST_BASIS = Object.freeze({
  /** Published net price, after grant aid. A private charges one price to everyone. */
  NET_PRICE_PRIVATE: 'NET_PRICE_PRIVATE',
  /** Public, athlete is a resident of the school's state. */
  NET_PRICE_PUBLIC_IN_STATE: 'NET_PRICE_PUBLIC_IN_STATE',
  /** Public, athlete is not a resident. Net price plus the published tuition premium. */
  NET_PRICE_PUBLIC_OUT_OF_STATE: 'NET_PRICE_PUBLIC_OUT_OF_STATE',
  /** Public, we do not hold the athlete's state. Both of the above, as a range. */
  NET_PRICE_PUBLIC_RESIDENCY_UNKNOWN: 'NET_PRICE_PUBLIC_RESIDENCY_UNKNOWN',
  /** Public, but the tuition pair gives no usable premium. Net price as published. */
  NET_PRICE_PUBLIC_NO_PREMIUM: 'NET_PRICE_PUBLIC_NO_PREMIUM',
});

const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * Which athletic-aid rule applies, as an A7.1 aid assumption.
 *
 * Conference first: the Ivy League forbids athletic aid inside an association
 * that permits it, so testing the division first would report an equivalency
 * allowance that does not exist there.
 */
export function athleticAidRule({ division, sport, conference }) {
  if (conference && NO_ATHLETIC_AID_CONFERENCES.includes(conference)) {
    return aidAssumption({ status: AID_POLICY_STATUS.CONFERENCE_RULE, rule: conference });
  }
  const rule = ATHLETIC_AID_RULES[division]?.[sport];
  if (rule === undefined) {
    return aidAssumption({ status: AID_POLICY_STATUS.UNKNOWN });
  }
  if (rule.maxFraction === 0) {
    return aidAssumption({ status: AID_POLICY_STATUS.DIVISION_RULE, rule: division });
  }
  // An equivalency allowance exists. `meanFraction` is required by the
  // contract and is set to zero here ON PURPOSE: this layer subtracts no
  // athletic dollars, so the only honest expectation to record is none. The
  // permitted maximum travels separately, as `aidHeadroomFraction`.
  return aidAssumption({ status: AID_POLICY_STATUS.EQUIVALENCY, rule: division, meanFraction: 0 });
}

/**
 * The applicable annual cost, as an interval, with the basis that produced it.
 *
 * Returns an unscoreable result when there is no net price. There is no
 * affordable-looking default: a school we cannot price is not a cheap school.
 */
export function applicableCost({ netPrice, control, tuitionIn, tuitionOut, athleteState, schoolState, isInternational }) {
  const price = num(netPrice);
  if (price === null) {
    return unscoreable({ reason: REASON.NO_COST_BASIS, missing: ['netPrice'], available: [] });
  }
  // A negative net price is real Scorecard data - aid exceeding cost, which
  // happens at nine junior colleges. Held at zero, because "the college pays
  // the family" is not more workable than "the family pays nothing".
  const floored = Math.max(0, price);
  const base = { netPrice: price, costFloored: floored !== price };

  if (num(control) !== CONTROL.PUBLIC) {
    // A private charges the same whoever you are. No residency discount is
    // available to invent, in the athlete's home state or anywhere else.
    return { lo: floored, hi: floored, basis: COST_BASIS.NET_PRICE_PRIVATE, grade: GRADE.MEASURED, detail: { ...base, residency: 'not applicable at a private institution' } };
  }

  const prem = num(tuitionOut) === null || num(tuitionIn) === null ? null : num(tuitionOut) - num(tuitionIn);
  if (prem === null || prem <= 0) {
    // 44 publics publish no usable premium. Nothing to add, and nothing about
    // that is uncertain - it is a measured absence of a premium.
    return { lo: floored, hi: floored, basis: COST_BASIS.NET_PRICE_PUBLIC_NO_PREMIUM, grade: GRADE.MEASURED, detail: { ...base, outOfStatePremium: 0 } };
  }

  const withPremium = floored + prem;
  const d = { ...base, outOfStatePremium: Math.round(prem) };

  if (isInternational) {
    // An international athlete is a non-resident everywhere. Stated as a rule
    // rather than arrived at by athleteState happening to be null, because
    // those are different facts and only one of them is reliable.
    return { lo: withPremium, hi: withPremium, basis: COST_BASIS.NET_PRICE_PUBLIC_OUT_OF_STATE, grade: GRADE.MEASURED, detail: { ...d, residency: 'non-resident: international' } };
  }
  if (!athleteState || !schoolState) {
    // We know both prices and not which applies. That is an interval, not a
    // coin toss and not a missing value.
    return { lo: floored, hi: withPremium, basis: COST_BASIS.NET_PRICE_PUBLIC_RESIDENCY_UNKNOWN, grade: GRADE.PARTIAL, detail: { ...d, residency: 'unknown: no athlete state on file' } };
  }
  const inState = String(athleteState).toUpperCase() === String(schoolState).toUpperCase();
  return inState
    ? { lo: floored, hi: floored, basis: COST_BASIS.NET_PRICE_PUBLIC_IN_STATE, grade: GRADE.MEASURED, detail: { ...base, residency: 'in-state', outOfStatePremium: 0 } }
    : { lo: withPremium, hi: withPremium, basis: COST_BASIS.NET_PRICE_PUBLIC_OUT_OF_STATE, grade: GRADE.MEASURED, detail: { ...d, residency: 'out-of-state' } };
}

/**
 * The funding gap, as a range, by interval subtraction.
 *
 * Clamped at zero at both ends. A cost inside the budget leaves money over,
 * and having more left over is not more workable than having exactly enough -
 * both are simply workable. Clamping is what makes viability saturate at 1
 * rather than rewarding cheapness without limit, and it is what makes a
 * measured gap of zero a finding rather than an edge case.
 */
export function fundingGap({ cost, budget }) {
  return {
    lo: Math.max(0, cost.lo - budget[1]),
    hi: Math.max(0, cost.hi - budget[0]),
  };
}

/**
 * Viability from a relative funding gap.
 *
 * `rel` is the shortfall as a multiple of what the family said they can pay:
 * rel = 1 means they must find that amount over again. The curve is
 *
 *     v = 1 / (1 + rel / s)
 *
 * chosen because `s` is then exactly the relative gap at which viability is
 * one half - the parameter means something and can be argued about directly,
 * which an exponential's decay constant cannot. Strictly decreasing, 1 at zero,
 * asymptotic to 0, so a costly school is demoted and never deleted.
 */
export function viabilityFromRelativeGap(rel) {
  return 1 / (1 + (rel / HALF_VIABILITY_RELATIVE_GAP));
}

/**
 * @param {object} p
 * @param {object} p.athlete  { contributionState, maxAnnualContributionUsd, budgetRange, state, origin }
 * @param {object} p.college  { net_price, control, tuition_in_state, tuition_out_state, state, division, conference }
 * @param {string} p.sport
 */
export function financialViability({ athlete, college, sport }) {
  const isInternational = String(athlete?.origin || '').toUpperCase() === 'INTERNATIONAL';
  const aid = athleticAidRule({ division: college.division, sport, conference: college.conference });
  const headroom = aid.status === AID_POLICY_STATUS.UNKNOWN
    ? null
    : (ATHLETIC_AID_RULES[college.division]?.[sport]?.maxFraction ?? 0);

  /**
   * Carried on the unscoreable results too. What we could not price is worth
   * knowing even when we could not score it, and the aid state in particular
   * must never disappear just because the cost did.
   */
  const aidBasis = {
    aidPolicy: aid.status,
    aidPolicyKnown: aid.known,
    aidRule: aid.rule,
    mayClaimNoAthleticAid: aid.mayClaimNoAthleticAid,
    /**
     * The equivalency LIMIT the rules permit, as published - a share of a full
     * cost of attendance, which we do not hold. It is a statement about what
     * is allowed, not about what will be offered, and NOTHING in the value
     * above is computed from it. null means no rule is on file.
     */
    aidHeadroomFraction: headroom,
    athleticAwardAssumed: 0,
    athleticAwardBasis: 'no athletic award is modelled: the published equivalency limits are shares of cost of attendance, which is not held',
  };

  const budget = familyContribution({
    contributionState: athlete?.contributionState ?? null,
    maxAnnualContributionUsd: athlete?.maxAnnualContributionUsd ?? null,
    budgetRange: athlete?.budgetRange ?? null,
  });
  const cost = applicableCost({
    netPrice: college.net_price,
    control: college.control,
    tuitionIn: college.tuition_in_state,
    tuitionOut: college.tuition_out_state,
    athleteState: athlete?.state,
    schoolState: college.state,
    isInternational,
  });

  // Both inputs are REQUIRED. Coverage expresses how many of them we hold, and
  // is reported even on the refusals so that "we hold the cost but not the
  // budget" is distinguishable from holding neither.
  const haveCost = cost.ok !== false;
  const haveBudget = budget !== null;
  const coverage = (haveCost ? 0.5 : 0) + (haveBudget ? 0.5 : 0);

  if (!haveCost) {
    return unscoreable({
      reason: REASON.NO_COST_BASIS,
      missing: haveBudget ? ['costBasis'] : ['costBasis', 'familyContribution'],
      available: haveBudget ? ['familyContribution'] : [],
      coverage,
      detail: aidBasis,
    });
  }
  if (!haveBudget) {
    return unscoreable({
      reason: REASON.NO_FAMILY_CONTRIBUTION,
      missing: ['familyContribution'],
      available: ['costBasis'],
      coverage,
      detail: {
        ...aidBasis,
        contributionSource: CONTRIBUTION_SOURCE.NEEDS_CONFIRMATION,
        contributionState: athlete?.contributionState ?? null,
        budgetRange: athlete?.budgetRange ?? null,
        applicableCostRange: [cost.lo, cost.hi],
        costBasis: cost.basis,
      },
    });
  }

  /**
   * COST STATED NOT TO CONSTRAIN.
   *
   * The gap is zero BY CONSTRUCTION, not by arithmetic against an invented
   * ceiling - there is no number here to subtract with, which is why the
   * resolver hands back a null interval rather than [x, Infinity).
   *
   * Financial reaches 1.0 because affordability is not what limits this
   * athlete's choice. It is not a claim about wealth, about any award, or
   * about the programme being cheap: the applicable cost is measured and
   * travels in the basis below exactly as it does for everyone else.
   */
  const notAConstraint = budget.source === CONTRIBUTION_SOURCE.NOT_A_CONSTRAINT;

  const gap = notAConstraint ? { lo: 0, hi: 0 } : fundingGap({ cost, budget: budget.interval });

  // Denominated in the family's own stated floor, not in the cost. A $10k
  // shortfall is a different problem for a family who said $10k than for one
  // who said $70k, and it is the SAME problem whether the school costs $20k or
  // $80k - they must find $10k either way. Normalising by cost would report
  // the expensive school as the easier one.
  const anchor = Math.max(budget.interval?.[0] ?? 0, CONTRIBUTION_ANCHOR);
  const relLo = gap.lo / anchor;
  const relHi = gap.hi / anchor;

  // Monotone decreasing, so the best case comes from the smaller gap.
  const vHi = viabilityFromRelativeGap(relLo);
  const vLo = viabilityFromRelativeGap(relHi);
  /**
   * HEURISTIC: the midpoint of the interval rather than its worst end. The
   * worst end would score every banded budget as though the family had stated
   * only its floor, which is not what they said. Both ends travel in the basis.
   *
   * EXCEPT on the open-ended legacy top band. "$40k+" states a floor and no
   * ceiling, so its best case is always a gap of zero - not because the family
   * can cover everything, but because the band never said they could not.
   * Averaging that in credits them with a capacity they never claimed, and it
   * showed: across the real pool it held the two top-band fixtures at a median
   * of 1.0 and a floor of 0.75, which is V1's saturated affordability wearing
   * new clothes. With an unstated ceiling the only thing the family actually
   * told us is the floor, so the worst case is the whole of what we know.
   *
   * A7.9.1 then measured what that costs: it makes the band arithmetically
   * identical to a stated maximum of exactly $40,000. That is why
   * CONTRIBUTION_STATE.STATED exists, and why `$40k+/yr` is no longer offered
   * to new athletes. An EXACT maximum needs none of this - [max, max] has one
   * end, so both viabilities agree and the midpoint is that same number.
   */
  const unboundedBudget = !notAConstraint && !Number.isFinite(budget.interval[1]);
  const value = unboundedBudget ? vLo : (vLo + vHi) / 2;

  /**
   * A BAND IS NOT A CONFIRMED MAXIMUM, however cleanly it parses.
   *
   * Every band-sourced result is PARTIAL, including the current vocabulary.
   * "$20k-$25k" is an interval the family chose off a list; Financial needs
   * the one number at its top and was never told it. Only an exact stated
   * maximum, or a stated absence of constraint, is MEASURED evidence about
   * the family - and either still needs a MEASURED cost on the other side.
   */
  const grade = (cost.grade === GRADE.MEASURED
    && budget.source !== CONTRIBUTION_SOURCE.LEGACY_BAND
    && !isInternational)
    ? GRADE.MEASURED
    : GRADE.PARTIAL;

  return scoreable({
    value,
    grade,
    coverage,
    basis: {
      ...aidBasis,
      ...cost.detail,
      costBasis: cost.basis,
      applicableCostRange: [cost.lo, cost.hi],
      /** Which answer this was scored from. The four never collapse. */
      contributionSource: budget.source,
      contributionState: budget.state,
      /** The exact maximum the family stated, or null when they stated none. */
      statedMaximumUsd: budget.statedMaximum,
      costNotAConstraint: notAConstraint,
      budgetRange: athlete.budgetRange ?? null,
      budgetIsLegacyBand: budget.legacy,
      /** null when there is no number - NOT_A_CONSTRAINT states no interval. */
      familyContributionRange: budget.interval,
      fundingGapRange: [gap.lo, gap.hi],
      relativeGapRange: [relLo, relHi],
      contributionAnchor: anchor,
      anchorIsFloor: anchor > (budget.interval?.[0] ?? 0),
      viabilityRange: [vLo, vHi],
      budgetCeilingUnstated: unboundedBudget,
      isInternational,
      /**
       * Net price is measured on domestically aided students, who are the one
       * population an international athlete is not in. The real figure is
       * higher and we hold no defensible amount by which - so the number is
       * left alone and the caveat travels with it.
       */
      internationalCostCaveat: isInternational
        ? 'net price is measured on domestically aided students and understates the cost to an international athlete by an unknown amount'
        : null,
      // Requires family income, which is not collected. Named so that its
      // absence is a recorded decision rather than an oversight.
      incomeBracketedNetPriceUsed: false,
      meritAidAssumed: 0,
      meritAidBasis: 'net price is already after grant aid; subtracting an estimated merit award would deduct the same money twice',
    },
  });
}
