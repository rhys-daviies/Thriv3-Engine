import React, { useState } from 'react';
import { Disclosure } from '@/components/ui/Disclosure';
import {
  explanationView, summaryView, LAYER_KEYS, layerLabel,
} from '@/lib/matchmakingV2View';

/**
 * WHY THIS SCHOOL RANKS HERE — A11 §7, §8; recomposed for A11.2 §1D/§1E/§6.
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
 * -- TWO LEVELS OF THE SAME ANSWER, AND ONLY ONE IS OPEN — A11.2 §6 ---------
 *
 * A11 printed the summary and all three layer sections expanded, and the real
 * production card showed the same findings twice, at length, before a reader
 * reached anything else. The information was right and the shape was wrong.
 *
 * So the concise answer stays — three leading reasons plus any financial
 * caveat, in the plain register, which is the ten-second read — and the full
 * three-layer evidence moves behind one disclosure, closed by default.
 * NOTHING IS DELETED: the detailed section renders the engine's exact
 * sentences, figures and all, one click away and with no second request.
 *
 * The summary is deliberately the PLAIN wording and the detail is deliberately
 * the ENGINE's. That is the whole distinction: a consultant reading to a
 * family wants "minutes are concentrated among fewer players than at a
 * typical programme", and a consultant checking the reading wants "0.5276
 * against a median of 0.5635". Both are the same finding. See `plainReasons`.
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

/** A11.2 §1E. The one control, in both of its states. */
export const SHOW_DETAIL = 'View detailed reasoning';
export const HIDE_DETAIL = 'Hide detailed reasoning';

function Reasons({ rows, testid, field = 'sentence' }) {
  if (!rows?.length) return null;
  return (
    <ul className="space-y-1" data-testid={testid}>
      {rows.map((r) => (
        <li key={`${r.code}-${r.sub ?? 0}`} className="text-xs text-muted-foreground" data-reason={r.code}>
          {r[field]}
        </li>
      ))}
    </ul>
  );
}

export default function MatchmakingExplanation({ explanation, programme = null }) {
  const [detail, setDetail] = useState(false);

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

  const summary = summaryView(explanation);

  return (
    <div className="space-y-3" data-testid="explanation">
      {/*
        §1D. THE SHORT ANSWER, AND IT STAYS SHORT. `summaryView` takes the
        leading three by polarity and band, then hoists any financial caveat
        that ranking would have buried — a D3 scholarship limitation is not a
        footnote to a family planning four years of fees.
      */}
      <div className="rounded-lg border border-border p-3 space-y-1.5" data-testid="explanation-overall">
        <p className="text-xs font-medium">Why this school ranks here</p>
        <Reasons rows={summary} testid="explanation-overall-reasons" field="text" />
        {summary.length === 0 && (
          <p className="text-xs text-muted-foreground">
            The evidence held for this programme does not support a summary beyond the
            layer readings below.
          </p>
        )}
      </div>

      {/*
        §1E, §5. ONE DISCLOSURE, CLOSED BY DEFAULT.

        `Disclosure` rather than a bare button because it already carries
        `aria-expanded` and `aria-controls` and is a real `type="button"`, so
        the control is reachable and announced without this file re-deriving
        any of it. The explanation is already in memory — opening this makes
        no request.
      */}
      <Disclosure
        open={detail}
        onOpenChange={setDetail}
        className="rounded-lg border border-border p-3"
        bodyClassName="space-y-2"
        header={(
          <p className="text-xs font-medium" data-testid="detailed-reasoning-toggle">
            {detail ? HIDE_DETAIL : SHOW_DETAIL}
          </p>
        )}
      >
        {/*
          §8. EACH LAYER ANSWERS "why did this one read as it did", in the
          engine's own words — figures included, because this is the level at
          which somebody is checking the reading rather than relaying it. A
          layer with no reasons prints its heading and says so; an empty
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
      </Disclosure>
    </div>
  );
}
