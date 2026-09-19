/**
 * Pursuit Priority: how strongly should Thriv3 pursue this programme for this
 * athlete?
 *
 * An OPERATIONAL PRIORITY - the strength of the case for spending outreach
 * effort here, given what is known today. It is not a probability of anything:
 * not of a reply, an offer, admission or a commitment, and not a judgement of
 * the school. Two programmes with the same priority are equally worth the next
 * email, and that is the whole claim.
 *
 *   1.0  the athlete is clearly recruitable, the family can plainly afford it,
 *        and the opportunity is among the best available to them.
 *   0.5  a solid case. Worth pursuing, with one of the three unremarkable.
 *   0.0  approached as the case disappears - almost always because the
 *        programme would not recruit the athlete. Never reached, because a
 *        programme that survives to be scored is never worth exactly nothing.
 *
 * -- THE STRUCTURE, CHOSEN BY MEASUREMENT ---------------------------------
 *
 *   base = wR.R + wF.F + wO.O
 *   P    = base x gR(R) x gF(F)
 *
 * Five architectures were run against the live layer outputs. Plain addition
 * scores a programme the athlete cannot reach at 0.456 when the other two are
 * perfect, which is the pathology the whole model exists to remove. A
 * geometric mean fixes that and makes opportunity a fatal gate, deleting any
 * programme with a weak athlete-side case. min(R, base) collapses onto
 * recruitability - it correlated at 1.00 and left finance at 0.16, so the
 * other layers stopped existing. Anchoring on R alone left a severe financial
 * mismatch at 0.585, which is not "strongly demoted".
 *
 * Gated addition with TAIL gates was the only one to pass every failure test
 * while using the range: near-zero recruitability scores 0.025, a poor
 * financial case 0.247, a poor opportunity 0.645, and an excellent case 0.875.
 */
import { GRADE, REASON, scoreable, unscoreable, isScoreable } from '../types.js';
import { PURSUIT_WEIGHTS, PURSUIT_GATES, tailGate } from '../pursuitRules.js';

/**
 * @param {object} p
 * @param {object} p.recruitability  layer result
 * @param {object} p.financial       layer result
 * @param {object} p.opportunity     layer result
 */
export function pursuitPriority({
  recruitability, financial, opportunity,
  weights = PURSUIT_WEIGHTS, gates = PURSUIT_GATES,
}) {
  const missing = [];
  if (!isScoreable(recruitability)) missing.push('recruitability');
  if (!isScoreable(financial)) missing.push('financial');
  if (!isScoreable(opportunity)) missing.push('opportunity');

  if (missing.length) {
    /**
     * ALL THREE ARE REQUIRED. A priority computed from two of them is a
     * different quantity wearing the same name, and it would sort against
     * programmes where all three were known - which is exactly how a
     * programme we know least about ends up above one we measured.
     */
    return unscoreable({
      reason: REASON.BELOW_COVERAGE_FLOOR,
      missing,
      available: ['recruitability', 'financial', 'opportunity'].filter((k) => !missing.includes(k)),
      coverage: (3 - missing.length) / 3,
      detail: {
        layerReasons: {
          recruitability: isScoreable(recruitability) ? null : recruitability.reason,
          financial: isScoreable(financial) ? null : financial.reason,
          opportunity: isScoreable(opportunity) ? null : opportunity.reason,
        },
      },
    });
  }

  const R = recruitability.value;
  const F = financial.value;
  const O = opportunity.value;

  const base = (weights.recruitability * R) + (weights.financial * F) + (weights.opportunity * O);
  const gR = tailGate(R, gates.recruitability);
  const gF = tailGate(F, gates.financial);
  const value = base * gR * gF;

  return scoreable({
    value,
    grade: [recruitability, financial, opportunity].every((l) => l.grade === GRADE.MEASURED)
      ? GRADE.MEASURED : GRADE.PARTIAL,
    coverage: 1,
    basis: {
      recruitability: R,
      financial: F,
      opportunity: O,
      weights: { ...weights },
      base,
      recruitabilityGate: gR,
      financialGate: gF,
      // What each gate actually cost, in priority points. The number an
      // operator asking "why is this one low" needs first.
      recruitabilityGateLoss: base - (base * gR),
      financialGateLoss: (base * gR) - value,
      recruitabilityGateFired: gR < 1,
      financialGateFired: gF < 1,
      layerCoverage: {
        recruitability: recruitability.coverage,
        financial: financial.coverage,
        opportunity: opportunity.coverage,
      },
      layerGrades: {
        recruitability: recruitability.grade,
        financial: financial.grade,
        opportunity: opportunity.grade,
      },
    },
  });
}
