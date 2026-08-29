import React, { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import EvidencePanel from '@/components/EvidencePanel';
import { useEvidence, evidenceForCollege } from '@/lib/useEvidence';
import { usePlayerWorkspace } from './PlayerWorkspace';
import { majorLabelFor } from '@shared/academicMajors.js';

/**
 * Everything Thriv3 can say about this athlete at each matched programme.
 *
 * A debugging and understanding view rather than a working surface: the
 * composer is where an angle gets chosen, and this is where you find out why
 * the composer offered what it did — including for programmes you are not
 * writing to yet.
 *
 * Reads the same `/api/players/:id/evidence` route the composer does and
 * renders the same panel, deliberately. A second view with its own idea of
 * what the evidence is would eventually disagree with the one that sends the
 * email, and the disagreement would surface as a coach receiving something the
 * screen never showed.
 *
 * Nothing here is a public surface. It carries exactly what the composer
 * already receives — rendered prose plus provenance — and none of the raw
 * matching internals: no scores, no weights, no net price.
 */

/** The route caps a batch at 40; the tab pages through the list in those. */
const PAGE = 20;

export default function EvidenceTab() {
  // The shared workspace helper, as every other tab uses. This file reached
  // for `useOutletContext()` directly and destructured a non-existent
  // `analysis` key: the workspace puts `recommendations` at the TOP LEVEL of
  // the outlet context, so `analysis?.recommendations ?? []` was always empty
  // and the tab reported "run the analysis first" however many times it had
  // been run. Going through the helper is what makes that mistake harder to
  // repeat.
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
  const { evidence, loading, failed } = useEvidence(player?.id, names);

  if (!recommendations) {
    return (
      <p className="text-sm text-muted-foreground">
        Run the analysis on the Matching tab first — this view describes the programmes it found.
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
        <h2 className="font-heading text-lg font-semibold">Evidence</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          What we can genuinely say about each programme, where it came from, and which
          of it the composer would use. FACT is checkable against the programme’s own
          pages; SIGNAL is an interpretation and is always written hedged.
        </p>
      </div>

      {/* Named once here rather than on every programme card: the reason
          ACADEMIC_FIT never appears is something about the athlete, not
          anything about the schools.

          Checked through `majorLabelFor` rather than for mere presence. A
          value that does not resolve to a known major leaves the angle just as
          inactive as a blank field, and testing only for presence meant an
          athlete whose major read "Undeclared" got no warning at all — the
          operator would reasonably assume the angle was on. */}
      {!majorLabelFor(player?.intended_major) && (
        <p className="rounded-md border border-dashed p-2.5 text-xs text-muted-foreground">
          {player?.intended_major
            ? <>“{player.intended_major}” doesn’t match a major we can check against, so the
                academic angle cannot fire at any programme. Try the subject itself — “business”,
                “exercise science”, “computer science”.</>
            : <>No intended major on file, so the academic angle cannot fire at any programme.</>}
          {' '}Edit under <span className="text-foreground">Edit Profile → Public profile → Academics</span>.
        </p>
      )}

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by programme name"
        className="max-w-sm"
      />

      <div className="space-y-3">
        {filtered.map((r) => (
          <div key={r.name} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{r.name}</span>
              <span className="text-xs text-muted-foreground">
                {r.division}
                {r.conference ? ` · ${r.conference}` : ''}
              </span>
            </div>
            <EvidencePanel
              evidence={evidenceForCollege(evidence, r.name)}
              loading={loading}
              failed={failed}
            />
          </div>
        ))}
      </div>

      {!query && shown < list.length && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="text-xs underline underline-offset-2 text-muted-foreground"
        >
          Show {Math.min(PAGE, list.length - shown)} more
          of {list.length}
        </button>
      )}
    </div>
  );
}
