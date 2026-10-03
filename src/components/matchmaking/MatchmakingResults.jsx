import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import MatchmakingResultCard from './MatchmakingResultCard';
import { SCOPE, SCOPE_LABEL, scopeProgrammes } from '@/lib/matchmakingV2View';

/** The V1 Matching tab's page size. Same product, same rhythm. */
const PAGE_SIZE = 20;
/** Page numbers shown either side of the current one. */
const WINDOW = 2;

/**
 * Page numbers around the current page, with the ends always reachable.
 *
 * ===========================================================================
 * V1'S PAGER CANNOT ADDRESS THIS LIST, AND IS LEFT ALONE.
 *
 * MatchingTab renders `Math.min(totalPages, 5)` buttons — pages 1..5 and
 * nothing else. V1 shows 100 recommendations at 20 a page, so five buttons is
 * exactly five pages and the ceiling never shows. The V2 full universe is
 * 1,205 programmes, 61 pages, and the same pager would leave pages 6 to 61
 * unreachable: a consultant could not open the 300th programme at all.
 *
 * So this is a second pager, not an edit to that one. V1 is untouched during
 * rollout by design, and a shared component would have had to change its
 * behaviour for both.
 * ===========================================================================
 */
export function pageWindow(current, total) {
  if (total <= 1) return [1];
  const pages = new Set([1, total]);
  for (let p = current - WINDOW; p <= current + WINDOW; p += 1) {
    if (p >= 1 && p <= total) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  /** `null` is a gap, rendered as an ellipsis rather than as a button. */
  const out = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push(null);
    out.push(sorted[i]);
  }
  return out;
}

/**
 * THE RANKED LIST, AND THE WAY PAST IT — §F, §G, §Q.
 *
 * ===========================================================================
 * ONE ORDERING. TWO WINDOWS ONTO IT. NO SECOND MODEL.
 *
 * The persisted run arrives in the engine's order: ranked ascending, then
 * everything unranked. Top 100 is the PREFIX of that order — `rank <= 100` —
 * and Full universe is all of it. Nothing here sorts, scores, filters by
 * quality or invents a list; switching scope changes how much of one array is
 * on screen.
 *
 * -- WHY ONLY A PAGE IS MOUNTED --------------------------------------------
 *
 * The whole run stays in state and twenty cards are rendered. A measured run
 * is 1,205 programmes at ~700KB; mounting all of them is 1,205 Disclosures
 * and ~3,600 meters, and the measurement for that is in the A9.3 report.
 * Paging is also the idiom this tab already has, so it costs an operator
 * nothing to learn.
 * ===========================================================================
 */
export default function MatchmakingResults({
  run,
  /**
   * CONTROLLED SCOPE — A10 §M. When the page owns the tab control, the scope
   * comes down as a prop and this component renders no tablist of its own:
   * the required information architecture has ONE tab strip, above the
   * content, with Specific Schools as its third tab.
   *
   * Left uncontrolled the component is exactly what it was — its own two-tab
   * strip over the same two scopes — which is what the A9.3 suites mount.
   */
  scope: controlledScope = null,
}) {
  const [ownScope, setOwnScope] = useState(SCOPE.TOP_100);
  const controlled = controlledScope !== null;
  const scope = controlled ? controlledScope : ownScope;
  const setScope = setOwnScope;
  const [page, setPage] = useState(1);

  const programmes = useMemo(
    () => scopeProgrammes(run.programmes, scope),
    [run.programmes, scope],
  );

  const totalPages = Math.max(1, Math.ceil(programmes.length / PAGE_SIZE));
  /**
   * Clamped rather than reset in an effect: switching from page 40 of the full
   * universe to a five-page Top 100 would otherwise render an empty list for
   * one frame before an effect corrected it.
   */
  const current = Math.min(page, totalPages);
  const items = programmes.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const changeScope = (next) => { setScope(next); setPage(1); };

  /**
   * A SCOPE CHANGED FROM ABOVE ALSO RETURNS TO PAGE 1.
   *
   * Adjusted during render rather than in an effect, for the same reason the
   * clamp above is not an effect: an effect would paint one frame of page 40
   * before correcting it. This is the React-documented form of deriving state
   * from a prop change, and it runs before anything is committed.
   */
  const [lastScope, setLastScope] = useState(scope);
  if (lastScope !== scope) {
    setLastScope(scope);
    setPage(1);
  }

  const counts = run.counts;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {/*
          NOT RENDERED AT ALL WHEN CONTROLLED, rather than hidden with a class:
          a hidden tablist is still in the accessibility tree, so a screen
          reader would meet two tab strips for one set of views.
        */}
        {!controlled && (
          <div role="tablist" aria-label="Result scope" className="inline-flex rounded-lg border border-border p-0.5">
            {[SCOPE.TOP_100, SCOPE.FULL_UNIVERSE].map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={scope === key}
                onClick={() => changeScope(key)}
                className={cn(
                  'px-3 h-8 rounded-md text-xs font-medium transition-colors',
                  scope === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {SCOPE_LABEL[key]}
              </button>
            ))}
          </div>
        )}

        {/*
          WHAT THE RUN CONTAINS, said once at the top rather than discovered by
          scrolling. The three numbers are the server's own counts, written
          inside the same transaction as the rows — this does not recount the
          array, which could disagree with the record it is displaying.
        */}
        {counts && (
          <p className="text-xs text-muted-foreground" data-testid="universe-counts">
            {counts.ranked} ranked · {counts.limitedData} without enough evidence
            {' '}· {counts.unsupported} association not modelled
          </p>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No programmes in this view.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((p) => (
            <MatchmakingResultCard key={`${p.programmeId ?? p.name}-${p.name}`} programme={p} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-1.5 pt-2 flex-wrap" aria-label="Result pages">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage(current - 1)}
            disabled={current === 1}
          >
            Previous
          </Button>
          {pageWindow(current, totalPages).map((n, i) => (n === null ? (
            // eslint-disable-next-line react/no-array-index-key
            <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
          ) : (
            <Button
              key={n}
              size="sm"
              variant={n === current ? 'default' : 'outline'}
              aria-current={n === current ? 'page' : undefined}
              onClick={() => setPage(n)}
            >
              {n}
            </Button>
          )))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage(current + 1)}
            disabled={current === totalPages}
          >
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}
