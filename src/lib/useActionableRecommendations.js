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
export function useActionableRecommendations({ playerId, recommendations, reserve }) {
  const programmes = useAthleteProgrammes(playerId);
  const relationships = programmes.programmes;

  const derived = useMemo(
    () => visibleTop100({ recommendations, reserve, relationships }),
    [recommendations, reserve, relationships],
  );

  return {
    ...programmes,
    /** The full result — counts, promotions, exhaustion — for anything that needs it. */
    derived,
    actionableRecommendations: recommendations ? derived.programmes : null,
  };
}
