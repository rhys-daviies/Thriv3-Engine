/**
 * Coverage: how much of a layer we were able to measure, kept separate from
 * what we measured.
 *
 * THE TWO RULES THAT CARRY THE DESIGN.
 *
 * 1. VALUE AND COVERAGE ARE NEVER COMBINED. No uncertainty penalty, no
 *    shrinkage toward a prior, no confidence multiplier. A value of 0 at full
 *    coverage is a FINDING - this programme has no room at the position.
 *    Absence of a value is not a worse finding; it is a different kind of
 *    statement, and multiplying the two together turns "we do not know" into
 *    "this is worse", which is a claim we cannot support.
 *
 * 2. A REQUIRED COMPONENT MISSING MAKES THE LAYER UNSCOREABLE regardless of
 *    coverage. Weights answer "how much does this matter"; `required` answers
 *    "can this layer mean anything without it", and those are different
 *    questions. Financial viability at 0.9 coverage with no cost basis is not
 *    90% of an answer.
 *
 * NOT_APPLICABLE leaves the denominator instead of reducing coverage. A
 * domestic athlete has no international propensity to measure, and must not be
 * pushed toward LIMITED_DATA for it.
 *
 * Layer floors live with the layers, not here. This module takes `floor` as an
 * argument and has no opinion about its value.
 */
import { GRADE, REASON, scoreable, unscoreable, isScoreable, isNotApplicable, assertResult } from './types.js';

/**
 * @typedef {object} Component
 * @property {string} key          stable identifier, reported in missing/available
 * @property {number} weight       relative importance among APPLICABLE components
 * @property {boolean} [required]  the layer is meaningless without it
 * @property {object} result       a scoreable or unscoreable result
 */

/**
 * Combine components into a layer result.
 *
 * @param {Component[]} components
 * @param {{floor: number, basis?: object}} options - `floor` is required on
 *   purpose: every caller must state the coverage it considers enough, and a
 *   default here would be a product decision hidden in a utility.
 */
export function combine(components, { floor, basis = {} } = {}) {
  if (typeof floor !== 'number' || !Number.isFinite(floor) || floor < 0 || floor > 1) {
    throw new Error(`coverage.combine: floor must be stated as a number within [0,1], got ${JSON.stringify(floor)}`);
  }
  if (!Array.isArray(components) || components.length === 0) {
    throw new Error('coverage.combine: needs at least one component');
  }

  const seen = new Set();
  for (const c of components) {
    if (!c || typeof c.key !== 'string' || !c.key) throw new Error('coverage.combine: every component needs a key');
    if (seen.has(c.key)) throw new Error(`coverage.combine: duplicate component key ${c.key}`);
    seen.add(c.key);
    if (typeof c.weight !== 'number' || !Number.isFinite(c.weight) || c.weight < 0) {
      throw new Error(`coverage.combine: ${c.key} needs a finite non-negative weight`);
    }
    assertResult(c.result, `component ${c.key}`);
    if (c.required && isNotApplicable(c.result)) {
      // A contradiction worth failing loudly on rather than resolving: either
      // the component is required or it can be absent, not both.
      throw new Error(`coverage.combine: ${c.key} is required but reported NOT_APPLICABLE`);
    }
  }

  const applicable = components.filter((c) => !isNotApplicable(c.result));
  const notApplicable = components.filter((c) => isNotApplicable(c.result)).map((c) => c.key);

  if (applicable.length === 0) {
    // Nothing here applied to this athlete or this programme. That is not
    // missing data, and the caller must not treat it as a gap - so the layer
    // inherits NOT_APPLICABLE rather than an "unknown" reason.
    return unscoreable({ reason: REASON.NOT_APPLICABLE, missing: [], available: [], coverage: 0, detail: { notApplicable } });
  }

  const scored = applicable.filter((c) => isScoreable(c.result));
  const missing = applicable.filter((c) => !isScoreable(c.result));

  const missingRequired = missing.find((c) => c.required);
  if (missingRequired) {
    const applicableWeight = applicable.reduce((s, c) => s + c.weight, 0);
    const coverage = applicableWeight === 0 ? 0 : scored.reduce((s, c) => s + c.weight, 0) / applicableWeight;
    return unscoreable({
      // The required component's OWN reason, not a generic one. "No cost basis"
      // is actionable; "below coverage floor" would hide which input to go find.
      reason: missingRequired.result.reason,
      missing: missing.map((c) => c.key),
      available: scored.map((c) => c.key),
      coverage,
      detail: { requiredMissing: missingRequired.key, notApplicable },
    });
  }

  const applicableWeight = applicable.reduce((s, c) => s + c.weight, 0);
  if (applicableWeight === 0) {
    throw new Error('coverage.combine: applicable components carry zero total weight, so coverage is undefined');
  }
  const scoredWeight = scored.reduce((s, c) => s + c.weight, 0);
  const coverage = scoredWeight / applicableWeight;

  if (coverage < floor) {
    return unscoreable({
      reason: REASON.BELOW_COVERAGE_FLOOR,
      missing: missing.map((c) => c.key),
      available: scored.map((c) => c.key),
      coverage,
      detail: { floor, notApplicable },
    });
  }

  // Renormalised over what was actually scored. The alternative - dividing by
  // the applicable weight - would treat an unmeasured component as a zero, and
  // that is the neutral-prior defect wearing the opposite sign.
  const value = scored.reduce((s, c) => s + c.weight * c.result.value, 0) / scoredWeight;

  return scoreable({
    value,
    grade: scored.every((c) => c.result.grade === GRADE.MEASURED) ? GRADE.MEASURED : GRADE.PARTIAL,
    coverage,
    basis: {
      ...basis,
      components: Object.fromEntries(scored.map((c) => [c.key, {
        value: c.result.value,
        grade: c.result.grade,
        weight: c.weight,
        // The share this component actually took, after renormalisation - the
        // number an explanation needs and the raw weight is not.
        share: c.weight / scoredWeight,
      }])),
      missing: missing.map((c) => ({ key: c.key, reason: c.result.reason })),
      notApplicable,
    },
  });
}

/** Convenience for building the component list without repeating the shape. */
export function component(key, weight, result, { required = false } = {}) {
  return { key, weight, result, required };
}
