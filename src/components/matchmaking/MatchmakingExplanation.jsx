import React from 'react';
import { explanationView, LAYER_KEYS } from '@/lib/matchmakingV2View';
import { layerLabel } from '@/lib/matchmakingV2View';

/**
 * WHY THIS SCHOOL RANKS HERE — A11 §7, §8.
 *
 * ===========================================================================
 * THE ENGINE'S OWN EXPLANATION OF THE RUN THAT IS ON SCREEN.
 *
 * Every sentence here was produced by `explainProgramme` at the moment the run
 * was computed, from the basis objects the scorers recorded, and stored with
 * the run. This component chooses an order and renders. It writes no prose, it
 * reads no score, and it cannot say anything the evidence did not support —
 * because it is not composing sentences, it is printing them.
 *
 * -- WHY IT IS NOT GENERATED AT RENDER TIME ---------------------------------
 *
 * Two reasons, and the second is the serious one:
 *
 *   1. No model call belongs on a card expansion. It would be slow, and it
 *      would be different every time it ran.
 *   2. An explanation computed TODAY explains today's corpus. The rank beside
 *      it came from the corpus of the run. The two are allowed to disagree,
 *      and the screen would show both without saying so.
 *
 * -- A RUN WITH NO EXPLANATION SAYS SO --------------------------------------
 *
 * Runs persisted before A11 carry none, and there is no way to reconstruct one
 * — the basis objects were never stored. That is stated plainly rather than
 * papered over with something derived from the score, which is exactly the
 * reverse-engineering this phase was told not to do.
 * ===========================================================================
 */

/**
 * TWO DIFFERENT ABSENCES, AND THEY ARE NOT THE SAME SENTENCE — A11.1 §2, §4.
 *
 * A run from before A11 recorded no explanation for ANY programme, and
 * refreshing produces one. A programme outside the Top 100 has a perfectly
 * current run that deliberately stores no prose for it, and refreshing
 * changes nothing. Telling an operator to refresh in the second case would
 * send them to do something that cannot work.
 */
export const NO_EXPLANATION_LEGACY_RUN = 'Detailed explanation not available for this run. Refreshing the matches will produce one.';

export const NO_EXPLANATION_OUTSIDE_TOP_100 = 'Detailed explanation is available for Top 100 recommendations.';

/** The rank bound explanations are stored for. Matches the server's TOP_N. */
export const EXPLAINED_TOP_N = 100;

function Reasons({ rows, testid }) {
  if (!rows?.length) return null;
  return (
    <ul className="space-y-1" data-testid={testid}>
      {rows.map((r) => (
        <li key={`${r.code}-${r.sub ?? 0}`} className="text-xs text-muted-foreground" data-reason={r.code}>
          {r.sentence}
        </li>
      ))}
    </ul>
  );
}

export default function MatchmakingExplanation({ explanation, programme = null }) {
  if (!explanation) {
    /**
     * A ranked programme outside the bound, or a non-ranked one, is not a
     * missing explanation — it is one this product does not store. Said
     * differently from a legacy run, because the operator's next action
     * differs: one is "refresh", the other is "there is nothing to fetch".
     */
    const outsideBound = programme
      && (!programme.ranked || !Number.isFinite(programme.rank) || programme.rank > EXPLAINED_TOP_N);

    return (
      <div className="rounded-lg border border-border p-3" data-testid="explanation-absent">
        <p className="text-xs text-muted-foreground" data-absent={outsideBound ? 'OUTSIDE_TOP_100' : 'LEGACY_RUN'}>
          {outsideBound ? NO_EXPLANATION_OUTSIDE_TOP_100 : NO_EXPLANATION_LEGACY_RUN}
        </p>
      </div>
    );
  }

  const overall = explanationView(explanation);

  return (
    <div className="space-y-3" data-testid="explanation">
      {/*
        §7. THE SHORT ANSWER FIRST. The engine orders its reasons by polarity
        and band, so the strongest supported statements come first; this takes
        the leading few rather than printing fourteen lines at a consultant
        mid-conversation.
      */}
      <div className="rounded-lg border border-border p-3 space-y-1.5" data-testid="explanation-overall">
        <p className="text-xs font-medium">Why this school ranks here</p>
        <Reasons rows={overall.slice(0, 3)} testid="explanation-overall-reasons" />
        {overall.length === 0 && (
          <p className="text-xs text-muted-foreground">
            The evidence held for this programme does not support a summary beyond the
            layer readings below.
          </p>
        )}
      </div>

      {/*
        §8. THEN EACH LAYER, ANSWERING "why did this one read as it did".
        A layer with no reasons prints its heading and says so — an empty
        section is more honest than a borrowed sentence from another layer.
      */}
      <div className="space-y-2" data-testid="explanation-layers">
        {LAYER_KEYS.map((key) => {
          const rows = explanationView(explanation, { layer: key });
          return (
            <div key={key} data-testid={`explanation-layer-${key}`}>
              <p className="text-xs font-medium">{layerLabel(key)}</p>
              {rows.length
                ? <Reasons rows={rows} testid={`explanation-reasons-${key}`} />
                : (
                  <p className="text-xs text-muted-foreground">
                    Thriv3 holds no recorded evidence that would explain this reading further.
                  </p>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
