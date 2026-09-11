import React, { useState } from 'react';
import { Flag, Loader2, EyeOff, Eye, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * WHAT THRIV3 ALREADY KNOWS ABOUT THIS ATHLETE AND THIS SCHOOL.
 *
 * Two controls, and keeping them two is the entire point of this component.
 *
 *   FLAG        a fact about the world. We know the coach; the athlete is
 *               already talking to them; we presented this athlete last year.
 *   TOP 100     whether the school stays in the athlete's actionable list.
 *
 * FLAGGING DOES NOT HIDE ANYTHING, and unflagging does not bring anything
 * back. A coach the athlete already knows is frequently the MOST actionable
 * school on the list, and a flag that quietly removed it would be the opposite
 * of what the operator asked for. So the Keep/Remove control is separate, it
 * is a separate write, and neither one moves the other.
 *
 * Contact stance is a THIRD decision and is deliberately not here — removing a
 * school from a ranked list is not the same as saying nobody may write to it.
 */

/**
 * Offered, not enforced. `flag_reason` is free text in the schema on purpose —
 * the real reasons are things like "trains with the assistant's club side" and
 * a fixed vocabulary would be a migration every time an operator met a new
 * situation. These are the common ones, one click away.
 */
const SUGGESTED_REASONS = [
  'Athlete already in contact',
  'Thriv3 personal contact',
  'Previous outreach',
  'Coach has already seen the athlete',
];

export default function ProgrammeRelationship({
  collegeName, collegeId, relationship = null, busy = false, error = null,
  promotedFrom = null,
  onFlag, onUnflag, onSetVisibility, onSaveNote,
  /**
   * A CALLBACK, NOT A DIALOG. This component is rendered once per card, and
   * importing the composer here would mount one dialog per programme on the
   * page. The workspace owns the single instance; this only says which
   * relationship an operator asked about.
   */
  onManualOutreach = null,
}) {
  const flagged = Boolean(relationship?.flagged);
  const suppressed = relationship?.visibility === 'suppressed';
  const requested = relationship?.request_state === 'requested';

  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState(relationship?.note ?? '');
  const [noteOpen, setNoteOpen] = useState(false);

  function submitFlag(value) {
    const text = (value ?? reason).trim();
    if (!text) return;
    onFlag({ id: collegeId, name: collegeName }, text);
    setEditing(false);
    setReason('');
  }

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-2" data-testid="programme-relationship">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/*
            WHERE THE MODEL PUT IT, not a new score. A promoted programme is
            shown high on the page because something above it was removed; it
            is still the hundred-and-first thing the engine ranked, and saying
            so is the difference between a replacement and a promotion nobody
            can account for.
          */}
          {promotedFrom != null && (
            <Badge variant="blue">Original rank #{promotedFrom}</Badge>
          )}
          {flagged && <Badge variant="amber">Existing relationship</Badge>}
          {requested && <Badge variant="purple">Specific Request</Badge>}
          {suppressed && <Badge variant="muted">Not in Top 100</Badge>}
          {flagged && relationship?.flag_reason && (
            <span className="text-xs text-muted-foreground">{relationship.flag_reason}</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {flagged ? (
            <Button size="sm" variant="ghost" disabled={busy}
              onClick={() => onUnflag(relationship)}>
              <Flag className="h-3.5 w-3.5 mr-1" /> Unflag
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={busy}
              onClick={() => setEditing((v) => !v)}>
              <Flag className="h-3.5 w-3.5 mr-1" /> Flag relationship
            </Button>
          )}

          {/*
            THE SAME CONDITION AS THE VISIBILITY CONTROL BELOW, and for a
            related reason: this action is the RELATIONSHIP-SCOPED workflow, so
            it needs a relationship. A recommended school nobody has said
            anything about has no row to scope it to, and the card's own
            "Email Coaches" button is the path for that — opening this one
            would have to invent a relationship as a side effect of a click.

            OFFERED EVEN WHEN THE STANCE IS do_not_contact. The dialog resolves
            the stance server-side and explains the refusal; hiding the button
            would make this screen the place the rule lives, and it is not —
            `sendOutreach` refuses whatever any screen does.
          */}
          {relationship?.id && onManualOutreach && (
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => onManualOutreach(relationship)}>
              <Mail className="h-3.5 w-3.5 mr-1" /> Manual Outreach
            </Button>
          )}

          {/*
            ONLY OFFERED ONCE THERE IS A RELATIONSHIP TO DECIDE ABOUT. Removing
            a school the operator has said nothing about is a decision without a
            reason attached, and the reason is the thing anyone reading this
            later needs.
          */}
          {(flagged || suppressed || requested) && (
            suppressed ? (
              <Button size="sm" variant="outline" disabled={busy}
                onClick={() => onSetVisibility(relationship, 'default')}>
                <Eye className="h-3.5 w-3.5 mr-1" /> Keep in Top 100
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={busy}
                onClick={() => onSetVisibility(relationship, 'suppressed')}>
                <EyeOff className="h-3.5 w-3.5 mr-1" /> Remove from Top 100
              </Button>
            )
          )}
        </div>
      </div>

      {editing && (
        <div className="space-y-2">
          <Input
            autoFocus
            value={reason}
            placeholder="What is the relationship?"
            aria-label={`Relationship with ${collegeName}`}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitFlag(); }}
          />
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                className="px-2 py-0.5 rounded-full text-xs bg-muted hover:bg-muted/70"
                onClick={() => submitFlag(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !reason.trim()} onClick={() => submitFlag()}>Flag</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setReason(''); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {(flagged || requested || suppressed) && (
        <div>
          {noteOpen ? (
            <div className="space-y-2">
              <Input
                autoFocus
                value={note}
                placeholder="Operator note"
                aria-label={`Note on ${collegeName}`}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" disabled={busy}
                  onClick={() => { onSaveNote(relationship, note); setNoteOpen(false); }}>
                  Save note
                </Button>
                <Button size="sm" variant="ghost"
                  onClick={() => { setNote(relationship?.note ?? ''); setNoteOpen(false); }}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={cn('text-xs underline text-muted-foreground')}
              onClick={() => setNoteOpen(true)}
            >
              {relationship?.note ? relationship.note : 'Add a note'}
            </button>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive" role="alert">{error.message}</p>}
    </div>
  );
}
