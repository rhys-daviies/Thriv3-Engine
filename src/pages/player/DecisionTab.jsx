import React, { useMemo, useState } from 'react';
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
 * This is the first slice. The ranked reasons are here; the sections beneath
 * them — roster, pathway, development, fit, context — are the next step, and
 * the placeholder at the bottom holds their place without inventing content
 * for them.
 */

/** The route caps a batch at 40; the tab pages through the list in those. */
const PAGE = 20;

export default function DecisionTab() {
  const { player, recommendations } = usePlayerWorkspace();
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);

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

            {/*
              Where the roster, pathway, development, fit and context sections
              will go. Left as spacing rather than filled with placeholder
              cards: a mock section is indistinguishable from a real one that
              found nothing, and an operator would learn to ignore both.
            */}
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
