import React from 'react';
import { cn } from '@/lib/utils';

/**
 * THE ONE TAB STRIP ON ANALYSIS & MATCHING — A10 §M.
 *
 * ===========================================================================
 * THREE VIEWS OF ONE RUN. NOT THREE RANKINGS.
 *
 * Top 100 and Full universe are two slices of the same persisted array;
 * Specific Schools is the consultant's own list read against that same array.
 * Switching between them sorts nothing, filters nothing on the server and
 * recomputes nothing — every number on all three came out of the run that was
 * already loaded when the page rendered.
 * ===========================================================================
 *
 * ONE STRIP, ABOVE THE CONTENT. `MatchmakingResults` used to own a two-tab
 * strip of its own, which put the scope control inside the thing whose scope
 * it set and left no place for a third view that is not a slice of the same
 * array. It still has that strip when mounted alone; here the page owns it.
 */
export const TAB = Object.freeze({
  TOP_100: 'TOP_100',
  FULL_UNIVERSE: 'FULL_UNIVERSE',
  SPECIFIC_SCHOOLS: 'SPECIFIC_SCHOOLS',
});

export const TAB_LABEL = Object.freeze({
  [TAB.TOP_100]: 'Top 100',
  [TAB.FULL_UNIVERSE]: 'Full Universe',
  [TAB.SPECIFIC_SCHOOLS]: 'Specific Schools',
});

export const TAB_ORDER = Object.freeze([
  TAB.TOP_100, TAB.FULL_UNIVERSE, TAB.SPECIFIC_SCHOOLS,
]);

export default function MatchmakingTabs({ value, onChange, counts = null }) {
  return (
    <div
      role="tablist"
      aria-label="Matchmaking views"
      className="inline-flex rounded-lg border border-border p-0.5"
      data-testid="matchmaking-tabs"
    >
      {TAB_ORDER.map((key) => {
        const selected = value === key;
        /**
         * A COUNT ONLY WHERE ONE IS KNOWN AND MEANS SOMETHING. Specific
         * Schools is the consultant's list and its size is a fact about this
         * athlete; the other two are slices of a universe whose numbers are
         * already printed beside the list itself.
         */
        const count = counts?.[key];
        return (
          <button
            key={key}
            type="button"
            role="tab"
            id={`matchmaking-tab-${key}`}
            aria-selected={selected}
            aria-controls={`matchmaking-panel-${key}`}
            /*
              THE COUNT NEEDS A SEPARATOR THAT IS NOT WHITESPACE IN THE DOM.
              Without this the accessible name is "Specific Schools99", because
              the label and the count are adjacent inline elements. Sighted
              readers get the gap from the margin; a screen reader does not.
            */
            aria-label={Number.isFinite(count) ? `${TAB_LABEL[key]}, ${count}` : undefined}
            onClick={() => onChange(key)}
            className={cn(
              'px-3 h-8 rounded-md text-xs font-medium transition-colors',
              selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {TAB_LABEL[key]}
            {Number.isFinite(count) && (
              <span className="ml-1.5 opacity-70 tabular-nums">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
