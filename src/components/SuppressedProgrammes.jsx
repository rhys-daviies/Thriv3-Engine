import React, { useState } from 'react';
import { Eye, Loader2, Handshake } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RELATIONSHIP_OUTREACH } from '@/lib/outreachLabels';
import ProgrammeContactSummary from '@/components/ProgrammeContactSummary';

/**
 * THE WAY BACK.
 *
 * Removing a school from an athlete's actionable Top 100 takes it off the
 * page — which is the point, and which also means the card carrying "Keep in
 * Top 100" goes with it. Without this the decision is one-way: an operator who
 * removed Stanford by mistake, or whose reason has since expired, would have
 * nowhere to click.
 *
 * COLLAPSED BY DEFAULT, and deliberately not part of the ranked list. These
 * programmes are not ranked 101st or unranked or anything else — they are
 * exactly where the model put them, and the operator has said they are not in
 * play for now. The count is visible so nobody forgets they exist; the list is
 * one click away so it does not compete with the hundred that are.
 */
export default function SuppressedProgrammes({
  suppressed, pending, onRestore,
  /**
   * RESTORING AND WRITING ARE INDEPENDENT ACTS, offered side by side and tied
   * to nothing. Removing a school from the Top 100 was a ranking decision;
   * whether anyone may write to it is `contact_stance`, which this panel does
   * not read and does not need to — the dialog resolves it server-side.
   *
   * The rows here are the athlete's own relationship rows, already in memory
   * with their ids on them, so nothing is fetched or created to offer this.
   */
  onManualOutreach = null,
  /** The athlete's whole history, fetched once by the workspace. */
  contactByProgramme = new Map(),
}) {
  const [open, setOpen] = useState(false);
  if (!suppressed.length) return null;

  return (
    <Card className="p-3">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-sm">
          Removed from this athlete&rsquo;s Top 100
          <span className="ml-1.5 text-muted-foreground">({suppressed.length})</span>
        </span>
        <span className="text-xs text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <ul className="divide-y divide-border mt-2" data-testid="suppressed-list">
          {suppressed.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{p.college_name}</span>
                  {p.flagged && <Badge variant="amber">Existing relationship</Badge>}
                  {p.request_state === 'requested' && <Badge variant="purple">Specific Request</Badge>}
                </div>
                {p.flag_reason && <p className="text-xs text-muted-foreground">{p.flag_reason}</p>}
                <ProgrammeContactSummary summary={contactByProgramme.get(p.college_name)} className="mt-1" />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {onManualOutreach && (
                  <Button size="sm" variant="ghost" onClick={() => onManualOutreach(p)}>
                    <Handshake className="h-3.5 w-3.5 mr-1" /> {RELATIONSHIP_OUTREACH}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending === (p.college_id || p.id)}
                  onClick={() => onRestore(p, 'default')}
                >
                  {pending === (p.college_id || p.id)
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <><Eye className="h-3.5 w-3.5 mr-1" /> Keep in Top 100</>}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
