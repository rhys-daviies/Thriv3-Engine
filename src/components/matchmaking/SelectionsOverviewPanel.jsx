import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { observations as api } from '@/api/client';
import { selectionRowView } from '@/lib/outreachOutcomeView';

/**
 * EVERY PROGRAMME THIS ATHLETE HAS BEEN SELECTED FOR — A9.7 §K.
 *
 * ===========================================================================
 * AN OPERATIONAL SURFACE, NOT AN ANALYTICS ONE.
 *
 * One row per selection: what the run said WHEN IT WAS CHOSEN, what has been
 * sent, whether a reply was recorded, and the latest REVIEWED reading. No
 * rates, no funnel, no aggregates — §K says so and the reason is that three
 * days of data would mostly be a way of over-reading it.
 * ===========================================================================
 *
 * Every number here is frozen. The rank is the selection's rank, not today's,
 * because a consultant deciding whether to chase a reply must be looking at
 * the number that caused the email.
 */
export default function SelectionsOverviewPanel({ player, universeSize = null }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!player?.id) return undefined;
    let live = true;
    api.selectionsOverview(player.id)
      .then((d) => { if (live) setRows(d.selections ?? []); })
      .catch((e) => { if (live) setError(e?.message ?? 'Could not load the selections.'); });
    return () => { live = false; };
  }, [player?.id]);

  if (error) {
    return <p className="text-xs text-destructive" role="alert">{error}</p>;
  }
  if (!rows) {
    return <p className="text-xs text-muted-foreground">Loading selections…</p>;
  }
  if (!rows.length) {
    return (
      <Card className="p-4" data-testid="selections-empty">
        <p className="text-sm">No programme has been selected for outreach yet.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Choosing a programme from the ranked list or from Specific Search records
          which run informed it. Nothing is sent by selecting.
        </p>
      </Card>
    );
  }

  const views = rows.map((r) => selectionRowView(r, { universeSize }));

  return (
    <Card className="p-4 space-y-3" data-testid="selections-overview">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">Selected for outreach</p>
        <span className="text-xs text-muted-foreground">{views.length}</span>
      </div>

      <ul className="space-y-2">
        {views.map((v) => (
          <li
            key={v.id}
            className="border-t border-border pt-2 text-xs space-y-1"
            data-testid="selection-row"
          >
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <span className="text-sm font-medium">{v.collegeName}</span>
              <Badge variant="outline" data-testid="selection-rank">{v.rankLabel}</Badge>
            </div>

            <div className="flex items-center gap-2 flex-wrap text-muted-foreground">
              <span data-testid="selection-progress">{v.progress}</span>
              <span aria-hidden="true">·</span>
              <span>{v.sourceLabel}</span>
              {v.messages > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    {v.messages} {v.messages === 1 ? 'message' : 'messages'}
                    {v.coaches > 1 ? ` to ${v.coaches} coaches` : ''}
                  </span>
                </>
              )}
              {v.runWasStale && (
                <>
                  <span aria-hidden="true">·</span>
                  <span data-testid="selection-stale">chosen from an out-of-date run</span>
                </>
              )}
            </div>

            {/*
              The three axes, each shown ONLY when something has been reviewed.
              An absent axis renders nothing at all rather than an empty label:
              on a list of fifty rows, "No reply yet" fifty times would read as
              a finding about fifty programmes.
            */}
            {(v.programmeInterest || v.recruitingNeed || v.athleteOutcome) && (
              <div className="flex gap-2 flex-wrap" data-testid="selection-latest">
                {v.programmeInterest && <Badge variant="secondary">{v.programmeInterest}</Badge>}
                {v.recruitingNeed && <Badge variant="outline">{v.recruitingNeed}</Badge>}
                {v.athleteOutcome && <Badge variant="outline">{v.athleteOutcome}</Badge>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
