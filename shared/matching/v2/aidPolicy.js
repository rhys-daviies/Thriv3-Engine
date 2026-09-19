/**
 * The athletic-aid vocabulary, and the one invariant it exists to protect.
 *
 * NO SCORING HERE. Financial Viability is not implemented at A7.1. What is
 * implemented is the distinction that the financial layer must not be able to
 * lose, written down before the code that could lose it is written.
 *
 * THE DEFECT THIS PREVENTS. We have already shipped it once. V1 read the
 * athletic-aid fraction with `?? 0`, so a division with no rule on file - USCAA
 * - came back as zero aid, and the explanation told the family that the
 * programme offers no athletic scholarships. That is not a cautious estimate.
 * It is a false statement about a real institution, produced by a missing row.
 *
 * The two are different claims and must stay different objects:
 *
 *   UNKNOWN      we hold no rule. A conservative COST BOUND may assume nothing
 *                is awarded, because assuming nothing can only make the school
 *                look more expensive. The EXPLANATION may not say there is
 *                nothing, because we do not know that.
 *   DIVISION_RULE / CONFERENCE_RULE with max 0
 *                a rule we hold says no athletic aid exists. That can be said
 *                out loud, and named.
 *
 * `assumedFraction: 0` therefore appears under both, and `known` is what tells
 * them apart. Anything rendering a sentence reads `known`, never the fraction.
 */

export const AID_POLICY_STATUS = Object.freeze({
  /** A per-sport equivalency allowance applies. */
  EQUIVALENCY: 'EQUIVALENCY',
  /** The association's own rule forbids athletic aid (e.g. NCAA D3). */
  DIVISION_RULE: 'DIVISION_RULE',
  /** The conference forbids it within an association that otherwise allows it (e.g. the Ivy League). */
  CONFERENCE_RULE: 'CONFERENCE_RULE',
  /** No rule is on file. NOT a rule that says zero. */
  UNKNOWN: 'UNKNOWN',
});

const STATUSES = new Set(Object.values(AID_POLICY_STATUS));

/**
 * Build the aid assumption a cost calculation is allowed to use.
 *
 * @param {object} p
 * @param {string} p.status          one of AID_POLICY_STATUS
 * @param {string|null} p.rule       the named division or conference, when there is one
 * @param {number|null} p.meanFraction  expected share of cost met, for EQUIVALENCY
 * @returns {{status, rule, assumedFraction, known, mayClaimNoAthleticAid}}
 */
export function aidAssumption({ status, rule = null, meanFraction = null }) {
  if (!STATUSES.has(status)) {
    throw new Error(`aidAssumption: unknown status ${JSON.stringify(status)}`);
  }

  if (status === AID_POLICY_STATUS.UNKNOWN) {
    if (rule !== null) {
      throw new Error('aidAssumption: an UNKNOWN policy cannot name a rule - naming one is claiming to hold it');
    }
    return Object.freeze({
      status,
      rule: null,
      // Conservative bound only. This is an input to arithmetic, not a finding.
      assumedFraction: 0,
      known: false,
      mayClaimNoAthleticAid: false,
    });
  }

  if (status === AID_POLICY_STATUS.EQUIVALENCY) {
    if (typeof meanFraction !== 'number' || !Number.isFinite(meanFraction) || meanFraction < 0 || meanFraction > 1) {
      throw new Error(`aidAssumption: EQUIVALENCY needs a meanFraction within [0,1], got ${JSON.stringify(meanFraction)}`);
    }
    return Object.freeze({ status, rule, assumedFraction: meanFraction, known: true, mayClaimNoAthleticAid: false });
  }

  // DIVISION_RULE / CONFERENCE_RULE: a rule we hold, and it says none.
  if (!rule) {
    throw new Error(`aidAssumption: ${status} must name the rule it is asserting - an unnamed rule is an UNKNOWN`);
  }
  return Object.freeze({ status, rule, assumedFraction: 0, known: true, mayClaimNoAthleticAid: true });
}

/**
 * The guard for anything that is about to say "no athletic scholarships".
 *
 * Call it at the point of rendering, not at the point of calculating, because
 * the calculation is allowed to assume zero and the sentence is not.
 */
export function assertMayClaimNoAthleticAid(assumption) {
  if (!assumption || assumption.mayClaimNoAthleticAid !== true) {
    throw new Error(
      'Refusing to state that no athletic aid is available: the policy is '
      + `${assumption?.status ?? 'absent'}. Assuming zero for a cost bound is not the same as knowing zero.`,
    );
  }
  return assumption.rule;
}
