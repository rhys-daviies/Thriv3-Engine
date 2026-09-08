import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import ProgrammeDecision from '@/components/ProgrammeDecision';
import { useOperatorEvidence, operatorEvidenceForCollege } from '@/lib/useOperatorEvidence';
import { usePlayerWorkspace } from './PlayerWorkspace';

/**
 * Why Thriv3 believes each matched programme is worth this athlete's attention.
 *
 * A SIBLING of the Evidence tab, not a replacement. That one shows what the
 * composer would put in a coach's inbox — rendered prose, chosen angles, the
 * sentence that gets sent. This one answers a question asked before any email
 * exists: is this programme worth pursuing, and on what. The two read the same
 * generators through different endpoints, and neither is derived from the
 * other.
 *
 * The page reads top to bottom as conclusion, then reasons, then evidence: a
 * summary line, the ranked reasons, and beneath them the five detailed
 * sections — roster, pathway, development, fit and context — each with a
 * one-click provenance drawer on every claim.
 */

/** The route caps a batch at 40; the tab pages through the list in those. */
const PAGE = 20;

export default function DecisionTab() {
  const { player, recommendations } = usePlayerWorkspace();

  /**
   * A match card can send an operator straight to one programme.
   *
   * PRESELECTION ONLY, and the URL is not written back on every keystroke.
   * The param seeds the filter this page already has, rather than becoming a
   * second source of truth for it — two-way synchronisation would mean every
   * character typed pushed a history entry, and the back button would then
   * walk backwards through a search box. What is gained by writing it back is
   * a shareable link to a filter; what is lost is the back button, and the
   * link that matters is the one the card already produces.
   *
   * The name arrives exactly as the matching engine holds it — `Mount St.
   * Mary's`, `Davis & Elkins`, `Ozarks (AR)` — because the card encodes it and
   * the router decodes it, and nothing in between splits or trims. It then
   * goes into the SAME substring filter an operator would have typed by hand,
   * so an unknown name is a search that finds nothing, not a crash.
   */
  const { id: routeId } = useParams();
  const [searchParams] = useSearchParams();

  /**
   * The param belongs to the athlete named in the same URL, and only to them.
   *
   * `/player/A/decision?college=Duke` is a statement about A. If the loaded
   * athlete is not A — a switch that has not finished, or a workspace showing
   * someone else — the college in that URL is the previous athlete's and must
   * not filter this one's list, where it would read as an analysis that
   * matched a single programme. Scoped by comparing the two rather than
   * remembered in a ref, because the URL already carries the pairing.
   */
  const belongsToThisAthlete = !player?.id || !routeId || player.id === routeId;
  const preselected = belongsToThisAthlete ? (searchParams.get('college') ?? '') : '';

  const [query, setQuery] = useState(preselected);
  const [shown, setShown] = useState(PAGE);

  /**
   * Re-seed when the link changes, or when the athlete does.
   *
   * Keyed on both, so arriving from another card's link replaces the filter
   * and switching athlete clears a college that was not theirs. It does not
   * run on typing, so a manual edit survives until one of those two things
   * happens.
   */
  useEffect(() => { setQuery(preselected); }, [player?.id, preselected]);

  // Null until an analysis has run; an empty array is a run that matched
  // nothing. Those are different things to tell an operator.
  const list = recommendations ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = q ? list.filter((r) => r.name.toLowerCase().includes(q)) : list;
    return matching.slice(0, shown);
  }, [list, query, shown]);

  const names = useMemo(() => filtered.map((r) => r.name), [filtered]);
  const { data, loading, failed } = useOperatorEvidence(player?.id, names);

  if (!recommendations) {
    return (
      <p className="text-sm text-muted-foreground">
        Run the analysis on the Matching tab first — this view assesses the programmes it found.
      </p>
    );
  }

  if (!list.length) {
    return (
      <p className="text-sm text-muted-foreground">
        The analysis ran but matched no programmes. Widen the division or conference
        filters on the Matching tab.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">Decision Evidence</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Why each programme is worth this athlete’s attention, strongest reason first. This is
          the assessment; the <span className="text-foreground">Evidence</span> tab shows what an
          email would actually say.
        </p>
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by programme name"
        className="max-w-sm"
      />

      {query && filtered.length === 0 && (
        // A filter that matches nothing used to render the header and then
        // stop, which reads as a page that failed rather than a search that
        // found nothing.
        <p className="text-sm text-muted-foreground">
          No programme in this analysis matches “{query}”.
        </p>
      )}

      <div className="space-y-4">
        {filtered.map((r) => (
          <section key={r.name} className="rounded-lg border border-border p-4">
            <div className="flex items-baseline justify-between gap-2 pb-3">
              <h3 className="font-heading text-sm font-semibold">{r.name}</h3>
              <span className="text-xs text-muted-foreground">
                {r.division}
                {r.conference ? ` · ${r.conference}` : ''}
              </span>
            </div>
            <ProgrammeDecision
              model={operatorEvidenceForCollege(data, r.name)}
              loading={loading}
              failed={failed}
            />
          </section>
        ))}
      </div>

      {!query && shown < list.length && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="text-xs underline underline-offset-2 text-muted-foreground"
        >
          Show {Math.min(PAGE, list.length - shown)} more of {list.length}
        </button>
      )}
    </div>
  );
}
