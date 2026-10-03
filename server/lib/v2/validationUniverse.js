/**
 * WHICH PROGRAMMES V2 IS ENTITLED TO RANK, AND WHICH IT IS NOT.
 *
 * A8.0. This is a VALIDATION-TIME classification. Nothing in the scoring path
 * imports it, and nothing here may ever be used to filter a pool - if the
 * engine one day needs to refuse an association it must do so through its own
 * evidence, exactly as it does today. This file exists so that a test can
 * ASSERT what the engine currently does by accident, and notice the day it
 * stops.
 *
 * -- WHY THIS IS NOT A LIST ------------------------------------------------
 *
 * The obvious implementation is `const SUPPORTED = ['NCAA D1', ...]`. That is
 * a second copy of a fact `shared/eligibility.js` already owns, and the two
 * would disagree the first time an association was researched: somebody would
 * add the rule and not the list, or the list and not the rule. So support is
 * DERIVED - a division is supported exactly when a rule is on file for it.
 * Adding a researched association to ELIGIBILITY_RULES moves it into the
 * supported universe with no edit here, which is the only way the two can be
 * kept honest.
 *
 * -- WHAT "SUPPORTED" DOES AND DOES NOT MEAN --------------------------------
 *
 * It means: Thriv3 holds the eligibility rule needed to read a roster row's
 * remaining seasons, so the evidence a ranking rests on can be assembled.
 *
 * It does NOT mean the programme has evidence. A supported programme with no
 * roster on file is still LIMITED_DATA, and that is a different and healthy
 * state. Nor does it mean an unsupported programme is bad, small or not worth
 * attending - 410 NJCAA soccer programmes are a real and important part of US
 * college soccer, and their absence from the ranking is an admission about
 * Thriv3's evidence, not a judgement about them.
 */
import { eligibilityRuleFor, ELIGIBILITY_MODEL } from '../../../shared/eligibility.js';

export const UNIVERSE = Object.freeze({
  /** An eligibility rule is on file for this division. V2 may rank it. */
  SUPPORTED: 'SUPPORTED',
  /** No rule on file. V2 holds no basis for a ranking and must not invent one. */
  UNSUPPORTED: 'UNSUPPORTED',
});

/**
 * Which universe a division belongs to in a season.
 *
 * The season matters because support has a date: a division whose only rule
 * begins in 2026 is unsupported for 2025, and reading it as supported would
 * apply a rule to seasons it was never in force for.
 */
export function universeOf({ division, season }) {
  const rule = eligibilityRuleFor({ division, season });
  return rule.model === ELIGIBILITY_MODEL.UNKNOWN ? UNIVERSE.UNSUPPORTED : UNIVERSE.SUPPORTED;
}

/** Split a college list into the two universes, counted by division. */
export function partitionUniverse(colleges, { season }) {
  const out = {
    supported: [], unsupported: [], byDivision: new Map(),
  };
  for (const c of colleges) {
    const universe = universeOf({ division: c.division, season });
    out[universe === UNIVERSE.SUPPORTED ? 'supported' : 'unsupported'].push(c);
    const e = out.byDivision.get(c.division) ?? { division: c.division, universe, n: 0 };
    e.n += 1;
    out.byDivision.set(c.division, e);
  }
  return out;
}
