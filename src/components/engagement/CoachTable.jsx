import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { presentRecipientRow } from '@shared/recipientPresentation.js';

// Gold is reserved for Priority and Responded, and for the return-visit
// indicator. Everything else stays charcoal.
const TIER_STYLE = {
  responded: 'border-primary text-primary bg-primary/10',
  priority: 'border-primary text-primary bg-primary/10',
  hot: 'border-border text-foreground',
  warm: 'border-border text-muted-foreground',
  cold: 'border-border text-muted-foreground',
};

function relativeDate(iso) {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * PHASE 5 (#9): RECORDING A REPLY IS DATED, AND CLEARING ONE IS CONFIRMED.
 *
 * "Mark responded" asks which day the reply arrived (default today), because a
 * reply recorded days late used to be dated by the click. "Responded" used to
 * clear the record on a single click, losing the date with no way back; now it
 * asks first. The server still validates the date.
 */
function RespondedControl({ c, busy, onToggleResponded }) {
  const [mode, setMode] = useState(null); // null | 'mark' | 'clear'
  const [date, setDate] = useState(today);
  const stop = (e) => e.stopPropagation();
  if (mode === 'mark') {
    return (
      <span className="inline-flex items-center gap-1.5" onClick={stop} data-testid="responded-date-form">
        <input
          type="date"
          className="h-8 rounded border border-border bg-background px-1.5 text-xs"
          value={date}
          max={today()}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Day the reply arrived"
          data-testid="responded-date"
        />
        <Button size="sm" disabled={busy || !date} onClick={() => { onToggleResponded(c, { responded: true, respondedAt: date }); setMode(null); }} data-testid="responded-save">Save</Button>
        <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
      </span>
    );
  }
  if (mode === 'clear') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs" onClick={stop} data-testid="responded-clear-confirm">
        Clear the reply recorded {new Date(c.responded_at).toLocaleDateString()}?
        <Button size="sm" variant="outline" disabled={busy} onClick={() => { onToggleResponded(c, { responded: false }); setMode(null); }} data-testid="responded-clear">Clear</Button>
        <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Keep</Button>
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant={c.responded_at ? 'default' : 'outline'}
      disabled={busy}
      title={c.responded_at ? `Reply recorded ${new Date(c.responded_at).toLocaleDateString()}` : undefined}
      onClick={(e) => { stop(e); setMode(c.responded_at ? 'clear' : 'mark'); }}
      data-testid="responded-button"
    >
      {c.responded_at ? 'Responded' : 'Mark responded'}
    </Button>
  );
}

export default function CoachTable({ coaches, onSelect, onToggleResponded, busyId }) {
  if (!coaches || coaches.length === 0) {
    return (
      <Card className="p-5">
        <h3 className="font-heading text-sm font-semibold mb-1">Coaches</h3>
        <p className="py-8 text-center text-sm text-muted-foreground">
          No outreach has been created for this athlete yet.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h3 className="font-heading text-sm font-semibold mb-4">Coaches</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">Coach</th>
              <th className="pb-2 pr-3 font-medium">School</th>
              <th className="pb-2 pr-3 font-medium">Div</th>
              <th className="pb-2 pr-3 font-medium">Status</th>
              <th className="pb-2 pr-3 font-medium text-right">Score</th>
              <th className="pb-2 pr-3 font-medium">Tier</th>
              <th className="pb-2 pr-3 font-medium text-right">Views</th>
              <th className="pb-2 pr-3 font-medium text-right">Best cov.</th>
              <th className="pb-2 pr-3 font-medium text-right">Rewinds</th>
              <th className="pb-2 pr-3 font-medium">Last seen</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {coaches.map((c) => {
              const returned = c.qualified_visits >= 2;
              return (
                <tr
                  key={c.outreach_id}
                  onClick={() => onSelect(c)}
                  className="border-t border-border/60 cursor-pointer hover:bg-muted/30"
                >
                  <td className="py-2.5 pr-3 font-medium whitespace-nowrap">
                    {presentRecipientRow(c).primary || '—'}
                    {/* Phase 5 (#2): an opted-out address is never written to again, by any athlete. */}
                    {c.opted_out ? (
                      <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] text-amber-500" data-testid="opted-out-badge">
                        opted out
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3 text-muted-foreground whitespace-nowrap">{c.school || '—'}</td>
                  <td className="py-2.5 pr-3 text-muted-foreground whitespace-nowrap text-xs">
                    {(c.division || '').replace('NCAA Division ', 'D') || '—'}
                  </td>
                  {/*
                    Phase 5 (#4): sent only when confirmed. A prepared draft may never
                    have left the operator's mail app, and the row says so.
                  */}
                  <td className="py-2.5 pr-3 whitespace-nowrap text-xs" data-testid="outreach-status">
                    {c.sent_at
                      ? <span>Sent {relativeDate(c.sent_at)}</span>
                      : (
                        <span className="text-amber-500" title="Prepared in Thriv3 but not confirmed as sent. Confirm it once it has actually gone.">
                          Prepared{c.drafted_at ? ` ${relativeDate(c.drafted_at)}` : ''}, not confirmed
                        </span>
                      )}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-heading font-semibold tabular-nums">{c.engagement_score}</td>
                  <td className="py-2.5 pr-3">
                    <span className={cn('inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider', TIER_STYLE[c.tier])}>
                      {c.tier}
                    </span>
                  </td>
                  <td className={cn('py-2.5 pr-3 text-right tabular-nums', returned && 'text-primary font-semibold')}>
                    {c.qualified_visits}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{c.best_coverage_pct}%</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{c.total_rewinds}</td>
                  <td className="py-2.5 pr-3 text-muted-foreground whitespace-nowrap text-xs">{relativeDate(c.last_qualified_at)}</td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    <RespondedControl c={c} busy={busyId === c.outreach_id} onToggleResponded={onToggleResponded} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Views counts qualified visits only — sessions where a human demonstrably watched or interacted.
      </p>
    </Card>
  );
}
