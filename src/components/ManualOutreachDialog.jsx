import React, { useEffect, useState } from 'react';
import { Loader2, Ban } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import EmailComposer from '@/components/EmailComposer';
import { manualOutreach } from '@/api/client';
import {
  RELATIONSHIP_OUTREACH, RELATIONSHIP_DIALOG_HINT, MANUAL_ONLY_HINT,
  DO_NOT_CONTACT_TITLE, DO_NOT_CONTACT_BODY, ORIGIN_LABEL, ORIGIN_UNRECORDED,
} from '@/lib/outreachLabels';

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
/**
 * ONE LINE OF FACTS PER COACH, and every clause is something the tables
 * actually hold.
 *
 * A CONFIRMED SEND AND A DRAFT ARE SAID DIFFERENTLY, because they are
 * different events and only one of them reached a coach. The date shown for a
 * send is the LAST confirmed one where there is one — `outreach.sent_at` is
 * first-wins and naming it "last sent" was how a coach written to three times
 * showed the oldest of the three.
 */
function activity(r) {
  const parts = [];

  if (r.has_confirmed_send) {
    const at = r.last_confirmed_send_at ?? r.first_confirmed_send_at;
    parts.push(at ? `last sent ${when(at)}` : 'sent');
    if (r.accepted_count > 1) parts.push(`${r.accepted_count} sent`);
  } else if (r.last_drafted_at) {
    // Said plainly. A body exists in Outlook; nobody has confirmed it left.
    parts.push(`drafted ${when(r.last_drafted_at)}, never confirmed sent`);
  } else {
    parts.push('no message yet');
  }

  /**
   * No draft count. `idx_outreach_send_one_open` is UNIQUE on outreach_id for
   * the open states, so a relationship holds at most one draft at a time and
   * "2 drafts" is not a thing that can be true.
   */

  /**
   * Origin, where it is known, and honestly where it is not. A coach reached
   * by a campaign must not read as one written to by hand.
   */
  const origins = [...new Set(r.origins ?? [])];
  const known = origins.filter(Boolean).map((o) => ORIGIN_LABEL[o] ?? o);
  if (known.length) parts.push(known.join(' and '));
  if (origins.includes(null) && r.record_count > 0) parts.push(ORIGIN_UNRECORDED);

  // The public link no longer resolves, so nothing further can go through it.
  if (r.revoked_at) parts.push('link revoked');

  return ` · ${parts.join(' · ')}`;
}

function PriorContact({ rows }) {
  if (!rows?.length) {
    return (
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Previous outreach
        </p>
        <p className="text-xs text-muted-foreground">None to this programme.</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Previous outreach
      </p>
      <ul className="space-y-0.5 mt-0.5">
        {rows.map((r) => (
          <li key={r.coach_id} className="text-xs">
            <span className="font-medium">{r.coach_name}</span>
            {r.position_title ? <span className="text-muted-foreground"> — {r.position_title}</span> : null}
            <span className="text-muted-foreground">{activity(r)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Why this programme is being written to by hand. */
function RelationshipContext({ relationship, priorContact }) {
  /**
   * EACH FACT KEPT AS ITS OWN FACT. A school can be requested AND flagged AND
   * removed from the Top 100, and blending those into one status would lose
   * the reason the operator opened this dialog. Nothing renders when there is
   * nothing to say — a row of "not requested, not flagged" would be noise on
   * every programme that has only a note.
   */
  const badges = [
    relationship.request_state === 'requested' && ['purple', 'Specific Request'],
    relationship.request_state === 'withdrawn' && ['muted', 'Request withdrawn'],
    relationship.flagged && ['amber', 'Existing relationship'],
    relationship.visibility === 'suppressed' && ['muted', 'Not in Top 100'],
    relationship.contact_stance === 'manual_only' && ['blue', 'Manual only'],
  ].filter(Boolean);

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Why this programme is handled here
      </p>

      {badges.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {badges.map(([variant, label]) => (
            <Badge key={label} variant={variant}>{label}</Badge>
          ))}
        </div>
      )}

      {relationship.flag_reason && (
        <p className="text-xs text-muted-foreground">{relationship.flag_reason}</p>
      )}
      {relationship.note && (
        <p className="text-xs"><span className="text-muted-foreground">Note: </span>{relationship.note}</p>
      )}
      {relationship.contact_stance === 'manual_only' && (
        <p className="text-xs text-muted-foreground">{MANUAL_ONLY_HINT}</p>
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
          <DialogHeader><DialogTitle>{RELATIONSHIP_OUTREACH}</DialogTitle></DialogHeader>
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
          <DialogHeader>
            <DialogTitle>{RELATIONSHIP_OUTREACH} &mdash; {relationship.college_name}</DialogTitle>
          </DialogHeader>
          <div className="py-8 text-center space-y-2 max-w-md mx-auto">
            <Ban className="h-8 w-8 mx-auto text-destructive" />
            <p className="text-sm text-destructive" role="alert">{DO_NOT_CONTACT_TITLE}</p>
            {/*
              WHAT WILL NOT LIFT IT. Visibility and the flag are the two
              neighbouring controls an operator would reach for next, and
              neither touches this — saying so is the difference between a
              refusal somebody works around and one they understand. The
              composer is not rendered AND the server refuses independently;
              this screen is not what makes it true.
            */}
            <p className="text-xs text-muted-foreground">{DO_NOT_CONTACT_BODY}</p>
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
      subtitle={RELATIONSHIP_DIALOG_HINT}
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
