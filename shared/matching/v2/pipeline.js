/**
 * The V2 pipeline: from an evaluated pool to a ranked list and a limited-data
 * list, with nothing in between.
 *
 * FOUR STATES, and a programme is in exactly one:
 *
 *   SUPPRESSED    an operator removed it. Checked FIRST, because a person's
 *                 decision outranks a rule and must not be reported as one.
 *   INELIGIBLE    a rule excluded it - division, conference, academic floor.
 *   RANKED        all three layers scoreable; carries a pursuit priority.
 *   LIMITED_DATA  eligible, partly evaluated, NO pursuit priority ever.
 *
 * THE TOP 100 IS AN OUTPUT LIMIT. Ranking happens first over everything
 * scoreable, and the limit is applied to the sorted list afterwards. It is not
 * a score threshold and nothing is excluded for failing to reach a number.
 */
import { RANKING_STATE, isScoreable } from './types.js';
import { pursuitPriority } from './layers/pursuit.js';
import { TOP_N } from './pursuitRules.js';

/**
 * How a limited-data programme is ordered against its peers.
 *
 * By HOW MUCH WE KNOW, not by how good it looks. The ordering answers "where
 * is the evidence thinnest" - which is honestly what this list is - rather
 * than "which of these is best", which is the question it cannot answer. A
 * programme with two strong layers and one missing is not thereby better than
 * one with two weak layers and one missing; it is better evidenced, and that
 * is all this says.
 */
function limitedDataOrder(entry) {
  const layers = [entry.recruitability, entry.financial, entry.opportunity];
  const scoreable = layers.filter(isScoreable);
  const coverage = scoreable.reduce((s, l) => s + l.coverage, 0) / layers.length;
  return {
    layersKnown: scoreable.length,
    coverage,
    // Only ever a tie-break between programmes that know the same amount, and
    // never presented as a priority.
    bestEvidencedValue: scoreable.length
      ? scoreable.reduce((best, l) => (l.coverage > best.coverage ? l : best), scoreable[0]).value
      : null,
  };
}

/**
 * @param {Array} evaluated  [{ id, name, division, recruitability, financial, opportunity,
 *                              suppressed?, ineligible?, ineligibleReason? }]
 */
export function rankPool(evaluated, { topN = TOP_N, weights, gates } = {}) {
  const suppressed = [];
  const ineligible = [];
  const ranked = [];
  const limited = [];

  for (const entry of evaluated) {
    if (entry.suppressed) {
      suppressed.push({ ...entry, rankingState: RANKING_STATE.SUPPRESSED, pursuitPriority: null });
      continue;
    }
    if (entry.ineligible) {
      ineligible.push({
        ...entry, rankingState: RANKING_STATE.INELIGIBLE, pursuitPriority: null,
        ineligibleReason: entry.ineligibleReason ?? null,
      });
      continue;
    }
    const priority = pursuitPriority({
      recruitability: entry.recruitability, financial: entry.financial, opportunity: entry.opportunity, weights, gates,
    });
    if (isScoreable(priority)) {
      ranked.push({ ...entry, rankingState: RANKING_STATE.RANKED, pursuitPriority: priority });
    } else {
      limited.push({
        ...entry, rankingState: RANKING_STATE.LIMITED_DATA,
        // NEVER a number. Not a zero, not a partial priority, not a placeholder.
        pursuitPriority: null,
        missingLayers: [...priority.missing],
        layerReasons: priority.detail.layerReasons,
        order: limitedDataOrder(entry),
      });
    }
  }

  /**
   * Deterministic to the last comparison. Priority, then each layer in weight
   * order, then the name - so two programmes can only tie if they are
   * identical in every scored quantity and share a name, which cannot happen.
   */
  ranked.sort((a, b) =>
    b.pursuitPriority.value - a.pursuitPriority.value
    || b.recruitability.value - a.recruitability.value
    || b.financial.value - a.financial.value
    || b.opportunity.value - a.opportunity.value
    || String(a.name).localeCompare(String(b.name)));
  ranked.forEach((r, i) => { r.rank = i + 1; });

  limited.sort((a, b) =>
    b.order.layersKnown - a.order.layersKnown
    || b.order.coverage - a.order.coverage
    || (b.order.bestEvidencedValue ?? -1) - (a.order.bestEvidencedValue ?? -1)
    || String(a.name).localeCompare(String(b.name)));

  return {
    // Sliced AFTER the sort. The limit never decides what gets scored.
    actionable: ranked.slice(0, topN),
    ranked,
    limited,
    ineligible,
    suppressed,
    counts: {
      evaluated: evaluated.length,
      ranked: ranked.length,
      limitedData: limited.length,
      ineligible: ineligible.length,
      suppressed: suppressed.length,
      actionable: Math.min(topN, ranked.length),
    },
  };
}
