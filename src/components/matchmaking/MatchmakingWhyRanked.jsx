import React from 'react';
import { Card } from '@/components/ui/card';
import { STATUS, STATUS_PRESENTATION, layerLabel } from '@/lib/matchmakingV2View';

/**
 * WHY SCHOOLS ARE RANKED THIS WAY — A10 §L.
 *
 * ===========================================================================
 * AN ORIENTATION, NOT A SPECIFICATION.
 *
 * This sits between the athlete's preferences and the list those preferences
 * produced, and it exists because a consultant looking at 1,205 programmes in
 * rank order needs to know what the order MEANS before they start reading it.
 *
 * WHAT IT DELIBERATELY DOES NOT SAY:
 *
 *   - no weights. 0.5/0.2/0.3 are the engine's and are frozen; printing them
 *     invites "can we raise financial for this family", which is a change to a
 *     frozen scoring file and needs one of the three justification classes in
 *     docs/validation/V2-FREEZE.md, not a slider on a page.
 *   - no formula, no layer arithmetic, no coverage thresholds.
 *   - nothing that turns an absence of evidence into a verdict on a school.
 *
 * THE LAYER NAMES ARE IMPORTED, NOT RETYPED. `layerLabel` is the frozen
 * vocabulary the cards, the standing panel and the explain pipeline all print,
 * reached through `matchmakingV2View` — the one doorway from `src/` that the
 * V2 import boundary allows. A second spelling of "Coach recruitability" on
 * this page is how a product ends up with two names for one thing.
 * ===========================================================================
 */

/** The three layers, in the order the cards already print them. */
const LAYERS = Object.freeze([
  {
    key: 'recruitability',
    what: 'whether this programme looks like one that would recruit this athlete — the level it plays at, who it has taken before, and where it takes them from.',
  },
  {
    key: 'financial',
    what: 'whether the family could meet the cost, read against what they have said they can contribute.',
  },
  {
    key: 'opportunity',
    what: 'what the athlete would be walking into — the squad, the position, and the minutes actually available.',
  },
]);

export default function MatchmakingWhyRanked() {
  return (
    <Card className="p-5 space-y-3" data-testid="why-ranked">
      <div className="space-y-1">
        <h3 className="font-heading text-sm font-semibold">Why schools are ranked this way</h3>
        <p className="text-xs text-muted-foreground">
          Every programme in this athlete&rsquo;s universe is assessed on the same three
          questions, then placed in order of {layerLabel('pursuit').toLowerCase()} — how
          worth pursuing it is for this athlete specifically, not how good a
          programme it is in general.
        </p>
      </div>

      <ul className="space-y-2">
        {LAYERS.map(({ key, what }) => (
          <li key={key} className="text-xs" data-testid={`why-layer-${key}`}>
            <span className="font-medium">{layerLabel(key)}</span>
            <span className="text-muted-foreground"> — {what}</span>
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">
        The athlete&rsquo;s own stated preferences — contribution, major, competitive
        level, playing opportunity, academic strength and where they want to study —
        shape these readings. Divisions, conferences, school type and an academic
        minimum are checked on each card rather than ranked. They are all shown above,
        and editing them is what changes the ranking.
      </p>

      {/*
        THE TWO NON-RANKED STATES, IN THE WORDS THE ENGINE USES FOR THEM.

        Restated here rather than left to be discovered on an individual card,
        because this is the section where a consultant forms their mental model
        of the list. If they learn "unranked" here as "worse", every amber badge
        they meet later confirms it. `note` is the clause that prevents that and
        it is imported from the same frozen presentation the cards render.
      */}
      <div className="rounded-lg border border-border p-3 space-y-2" data-testid="why-unranked">
        <p className="text-xs font-medium">Programmes without a rank</p>
        {[STATUS.SUPPORTED_LIMITED_DATA, STATUS.UNSUPPORTED_ASSOCIATION].map((status) => {
          const state = STATUS_PRESENTATION[status];
          return (
            <div key={status} className="text-xs" data-testid={`why-status-${status}`}>
              <span className="font-medium">{state.label}</span>
              <span className="text-muted-foreground"> — {state.summary} {state.note}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
