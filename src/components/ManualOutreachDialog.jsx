import React, { useEffect, useState } from 'react';
import { Loader2, Ban } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import EmailComposer from '@/components/EmailComposer';
import { manualOutreach } from '@/api/client';

/**
 * WRITING TO ONE PROGRAMME, BY HAND, BECAUSE THIS ONE IS DIFFERENT.
 *
 * A WRAPPER, not a second composer. Everything about the message — the
 * evidence engine, the structure choice, the subject, the body, the recipient
 * checkboxes, the draft/send toggle — is EmailComposer's, unchanged. What this
 * adds is the three things that are true of a relationship and not of a match
 * card:
 *
 *   WHERE THE PROGRAMME COMES FROM. A specifically requested school may never
 *   have been ranked, so there is no recommendation carrying its coaching
 *   staff. The staff is fetched from the canonical `coaches` table — the same
 *   rows a send resolves against — rather than from the JSON blob the matching
 *   run copies onto recommendations.
 *
 *   WHY THIS SCHOOL IS SPECIAL. The request, the flag and its reason, the
 *   operator note; and what has already been sent here, derived from the
 *   outreach tables rather than stored on the relationship.
 *
 *   WHETHER WE MAY WRITE AT ALL. `contact_stance`, decided server-side. The
 *   composer is not rendered on a do-not-contact relationship — and that is
 *   the courtesy, not the guarantee: the same refusal stands inside
 *   `sendOutreach`, so a browser that skipped this screen gets it anyway.
 */

function when(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * What has already gone to this programme for this athlete.
 *
 * FACTS, NOT A VERDICT, and deliberately not a blocker. The most ordinary
 * reason to open this dialog is a deliberate second message — the coach
 * replied, the film is new — so a warning that fired every time would be
 * scrolled past by the second week. The hard limit stays where it protects the
 * recipient rather than the operator: `sendCap`, on the address, server-side.
 */
function PriorContact({ rows }) {
  if (!rows?.length) {
    return <p className="text-xs text-muted-foreground">No previous outreach to this programme.</p>;
  }
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.coach_id} className="text-xs text-muted-foreground">
          <span className="text-foreground">{r.coach_name}</span>
          {r.position_title ? ` — ${r.position_title}` : ''}
          {r.sent_at ? ` · last sent ${when(r.sent_at)}` : r.drafted_at ? ` · drafted ${when(r.drafted_at)}, never confirmed sent` : ' · no message yet'}
          {r.message_count > 1 ? ` · ${r.message_count} messages` : ''}
          {r.revoked_at ? ' · revoked' : ''}
        </li>
      ))}
    </ul>
  );
}

/** Why this programme is being written to by hand. */
function RelationshipContext({ relationship, priorContact }) {
  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        {relationship.request_state === 'requested' && <Badge variant="purple">Specific Request</Badge>}
        {relationship.request_state === 'withdrawn' && <Badge variant="muted">Request withdrawn</Badge>}
        {relationship.flagged && <Badge variant="amber">Existing relationship</Badge>}
        {relationship.visibility === 'suppressed' && <Badge variant="muted">Not in Top 100</Badge>}
        {relationship.contact_stance === 'manual_only' && <Badge variant="blue">Manual only</Badge>}
      </div>
      {relationship.flag_reason && (
        <p className="text-xs text-muted-foreground">{relationship.flag_reason}</p>
      )}
      {relationship.note && (
        <p className="text-xs"><span className="text-muted-foreground">Note: </span>{relationship.note}</p>
      )}
      <PriorContact rows={priorContact} />
    </div>
  );
}

export default function ManualOutreachDialog({ player, relationshipId, open, onOpenChange }) {
  const [context, setContext] = useState(null);
  const [failed, setFailed] = useState(null);

  useEffect(() => {
    if (!open || !player?.id || !relationshipId) return undefined;
    let cancelled = false;
    setContext(null);
    setFailed(null);
    manualOutreach.context(player.id, relationshipId)
      .then((body) => { if (!cancelled) setContext(body); })
      .catch((err) => { if (!cancelled) setFailed(err.message); });
    return () => { cancelled = true; };
  }, [open, player?.id, relationshipId]);

  if (!open) return null;

  if (failed || !context) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Manual outreach</DialogTitle></DialogHeader>
          {failed
            ? <p className="text-sm text-destructive py-8 text-center" role="alert">{failed}</p>
            : (
              <p className="text-sm text-muted-foreground flex items-center justify-center gap-2 py-8">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading this programme...
              </p>
            )}
        </DialogContent>
      </Dialog>
    );
  }

  const { relationship, college, coaches, contact: decision, priorContact } = context;

  if (!decision.allowed) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{relationship.college_name}</DialogTitle></DialogHeader>
          <div className="py-8 text-center space-y-2">
            <Ban className="h-8 w-8 mx-auto text-destructive" />
            <p className="text-sm text-destructive" role="alert">
              This programme is set to do-not-contact for {player.full_name || 'this athlete'}.
              Change the contact stance on the relationship before writing to them.
            </p>
            {/*
              Said plainly: the composer is not rendered, AND the server would
              refuse anyway. The screen is not what makes this true.
            */}
            <p className="text-xs text-muted-foreground">
              Nothing can be drafted or sent from here while that stands.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  /**
   * THE SHAPE EmailComposer READS, assembled from the registry.
   *
   * A recommendation carries these fields because `playerAnalysis` copies them
   * off the same `colleges` row. A relationship has the row itself, so the
   * composer needs no adapter beyond naming them — and `coaching_staff` comes
   * from the canonical `coaches` table rather than the matching blob.
   */
  const composerCollege = {
    ...(college || {}),
    name: relationship.college_name,
    division: relationship.division ?? college?.division ?? null,
    conference: relationship.conference ?? college?.conference ?? null,
    coaching_staff: coaches,
  };

  return (
    <EmailComposer
      player={player}
      college={composerCollege}
      open={open}
      onOpenChange={onOpenChange}
      context={<RelationshipContext relationship={relationship} priorContact={priorContact} />}
      /**
       * THE RELATIONSHIP-SCOPED ENDPOINT, not the shared one.
       *
       * Coaches are named by id and resolved server-side against this
       * programme's own staff, so the request cannot introduce a recipient who
       * does not work at the school the relationship is with. The programme,
       * the campaign (null) and the origin are not sent at all — the route
       * reads them, and refuses a body that tries to name them.
       */
      onSend={({ coaches: chosen, ...composed }) => manualOutreach.send(player.id, relationshipId, {
        ...composed,
        coachIds: chosen
          .map((c) => coaches.find((k) => k.email === c.email)?.coach_id)
          .filter(Boolean),
      })}
    />
  );
}
