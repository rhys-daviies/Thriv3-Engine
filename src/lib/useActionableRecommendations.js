import { useMemo } from 'react';
import { visibleTop100 } from '@shared/matching/visibleTop100.js';
import { useAthleteProgrammes } from '@/lib/useAthleteProgrammes';

/**
 * ONE DERIVATION, ONE FETCH, FOR EVERY SURFACE THAT CLAIMS TO SHOW AN
 * ATHLETE'S CURRENT RECOMMENDATIONS.
 *
 * Four tabs read the match list — Matching, Decision, Evidence and Philosophy
 * — and each of them was reading the RAW analysis. A school the operator had
 * taken out of the athlete's Top 100 therefore vanished from one screen and
 * carried on appearing on three others, which is worse than not having the
 * feature: the operator would believe the decision had been made.
 *
 * So the derivation happens HERE, once, and the workspace hands the result to
 * every tab. Not four calls to `visibleTop100` in four components — four
 * implementations is what that becomes after the second change to one of them.
 *
 * ---------------------------------------------------------------------------
 * NULL IS NOT AN EMPTY LIST, AND THE DISTINCTION IS LOAD-BEARING.
 *
 * Every one of these tabs tells "no analysis has been run" apart from "the
 * analysis ran and matched nothing", and says something different for each.
 * `visibleTop100` answers `[]` for a null input, so passing its output through
 * unconditionally would turn every un-analysed athlete into one whose filters
 * matched no programmes. `actionableRecommendations` is therefore null exactly
 * when `recommendations` is null.
 * ---------------------------------------------------------------------------
 *
 * WHAT IS DELIBERATELY NOT DERIVED. The raw arrays stay on the context beside
 * this and stay authoritative: the analysis is the model's answer, this is
 * what an operator has decided to act on today, and the relationship surfaces
 * — Specific Schools, the restore panel — want the raw truth because they are
 * not claiming anything is actionable.
 */
/**
 * FIVE STATES, AND THEY ARE NOT INTERCHANGEABLE.
 *
 *   'unanalysed'  no analysis has been run for this athlete
 *   'loading'     the analysis is here; the operator's visibility decisions
 *                 are not yet
 *   'failed'      those decisions could not be read
 *   'empty'       everything is known, and nothing is actionable
 *   'ready'       everything is known, and there is a list
 *
 * The first four were two before this: `null` meant both "never analysed" and
 * "we do not know yet", and an unknown answer was rendered as the RAW list.
 * That is the whole bug — for one paint a school the operator had removed was
 * on screen, in the request the tab made about it, and clickable.
 */
export const ACTIONABLE = Object.freeze({
  UNANALYSED: 'unanalysed',
  LOADING: 'loading',
  FAILED: 'failed',
  EMPTY: 'empty',
  READY: 'ready',
});

export function useActionableRecommendations({ playerId, recommendations, reserve }) {
  const programmes = useAthleteProgrammes(playerId);
  const relationships = programmes.programmes;

  const derived = useMemo(
    () => visibleTop100({ recommendations, reserve, relationships }),
    [recommendations, reserve, relationships],
  );

  /**
   * ORDER MATTERS. "Never analysed" is checked first because an athlete with no
   * analysis has nothing to wait for, and `settled` is legitimately false
   * before their player row has even loaded.
   */
  let status;
  if (!recommendations) status = ACTIONABLE.UNANALYSED;
  else if (programmes.failed) status = ACTIONABLE.FAILED;
  else if (!programmes.settled) status = ACTIONABLE.LOADING;
  else if (derived.programmes.length === 0) status = ACTIONABLE.EMPTY;
  else status = ACTIONABLE.READY;

  /**
   * THE LIST EXISTS ONLY WHEN IT IS TRUE.
   *
   * Null while loading and null on failure, and NEVER the raw analysis as a
   * fallback. A list assembled without the operator's decisions is not a
   * cautious approximation of the right one — it is the one specific list this
   * feature exists to stop being shown, and showing it while a spinner is
   * elsewhere on the page would be worse than showing nothing.
   *
   * `[]` is reserved for EMPTY: known, and genuinely nothing.
   */
  const ready = status === ACTIONABLE.READY || status === ACTIONABLE.EMPTY;

  return {
    ...programmes,
    /** The full result — counts, promotions, exhaustion — for anything that needs it. */
    derived,
    actionableStatus: status,
    actionableRecommendations: ready ? derived.programmes : null,
  };
}
