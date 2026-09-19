import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  OPEN_IN_EMAIL, COPY_EMAIL, HANDOFF_OPENED, HANDOFF_RETRY, HANDOFF_READY,
  HANDOFF_COPY_ONLY, HANDOFF_NOT_SENT_YET, HANDOFF_CLIPBOARD_FAILED,
  HANDOFF_PLAIN_ONLY, HANDOFF_SECTION,
} from '@/lib/outreachLabels';
import { openInEmail, copyEmail, HANDOFF_RESULT } from '@/lib/emailHandoff';

/**
 * GETTING A PREPARED EMAIL INTO THE OPERATOR'S OWN MAIL APP — R2B, SHARED R2C.1.
 *
 * ===========================================================================
 * ONE HANDOFF IMPLEMENTATION, AND THIS IS ITS ONLY USER INTERFACE.
 *
 * Two composers reach the same endpoint and both now get handoffs back from
 * it: `EmailComposer` (Specific Search and the Top 100 match cards) and
 * `BulkEmailComposer`. R2B built this inside the first of them, which was
 * correct for one caller and became duplication the moment there were two.
 *
 * It lives here so that the clipboard ladder, the mailto navigation, the
 * fallback wording and the "nothing has been sent" line exist ONCE. The
 * behaviour itself is not here either — it is in src/lib/emailHandoff.js, and
 * this file only renders what that returns.
 * ===========================================================================
 */

/**
 * WHICH COACHES ACTUALLY HAVE AN EMAIL WAITING, IN THE ORDER THEY WERE DONE.
 *
 * ---------------------------------------------------------------------------
 * KEYED ON THE PRESENCE OF `handoff`, NEVER ON A LIST OF STATUSES.
 *
 * The server attaches one on exactly one branch — a coach whose draft was
 * composed AND persisted AND checked against its own digest — and omits it on
 * every other outcome: suppressed, rate-capped, revoked, budget-refused,
 * campaign-refused, an unusable address, or an error. It is also null on
 * macOS, where the AppleScript path already opened a compose window and a
 * second copy on the clipboard would be two competing versions of one email.
 *
 * So this cannot fall behind a guard added later: a new refusal returns no
 * handoff, no row appears, and this line is not touched.
 * ---------------------------------------------------------------------------
 *
 * Takes the `results` map both composers already keep — EmailComposer keys it
 * by email, BulkEmailComposer by college name — because what matters is the
 * VALUES, and both hold the same per-coach result object the route returned.
 */
export function handoffsFrom(results) {
  return Object.values(results ?? {})
    .filter((r) => r && r.handoff)
    .map((r) => ({ email: r.email, name: r.name, handoff: r.handoff }));
}

/**
 * ONE PREPARED EMAIL, AND THE TWO WAYS TO GET IT INTO A MAIL APP — R2B.
 *
 * ===========================================================================
 * ONE ROW, ONE COACH, ONE CLICK. NOTHING OPENS BY ITSELF.
 *
 * A programme with three coaches produces three rows and needs three clicks,
 * deliberately. Each coach's body carries THAT COACH'S tracking token, so
 * they are three different emails and not one email sent three times —
 * opening them in a loop would also be three `mailto` navigations from one
 * gesture, which is what popup blockers exist to stop, and would leave the
 * operator with three compose windows and no idea which clipboard contents
 * belong to which.
 * ===========================================================================
 *
 * THE BODY IS THE SERVER'S. `handoff.body`, `handoff.bodyHtml` and
 * `handoff.mailtoUrl` were read back out of the persisted `outreach_send` row
 * — see server/lib/emailHandoff.js. This component displays them and passes
 * them along; it never builds one.
 */
function HandoffRow({ handoff, name }) {
  const [state, setState] = useState(null);   // { status, opened } | null
  const [busy, setBusy] = useState(false);

  const run = async (action) => {
    if (busy) return;
    setBusy(true);
    try {
      setState(await action(handoff));
    } finally {
      setBusy(false);
    }
  };

  const failed = state && state.status === HANDOFF_RESULT.MANUAL;
  const plain = state && state.status === HANDOFF_RESULT.PLAIN;

  return (
    <div className="rounded-md border border-border/60 p-2.5 space-y-1.5" data-testid="handoff-row">
      <p className="text-sm">
        {name}{' '}
        <span className="text-muted-foreground">({handoff.to})</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {/*
          Disabled while its own handoff runs, and only its own: a second
          click mid-navigation is a second compose window for one coach.
        */}
        <Button size="sm" disabled={busy} onClick={() => run(openInEmail)}>
          {state?.opened ? HANDOFF_RETRY : OPEN_IN_EMAIL}
        </Button>
        {/*
          INDEPENDENT OF mailto, WHICH IS THE POINT OF HAVING IT. An operator
          whose machine has no handler registered, or who works in webmail,
          gets a working path that never touches a URL scheme. Always visible
          rather than revealed on failure — a fallback nobody can find until
          something breaks is not a fallback.
        */}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(copyEmail)}>
          {COPY_EMAIL}
        </Button>
        {state?.opened && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> {HANDOFF_OPENED}
          </span>
        )}
      </div>

      {state && !failed && (
        <p className="text-xs text-muted-foreground" role="status">
          {state.opened ? HANDOFF_READY : HANDOFF_COPY_ONLY(handoff.to)}
        </p>
      )}
      {plain && <p className="text-xs text-amber-400" role="status">{HANDOFF_PLAIN_ONLY}</p>}

      {/*
        THE AUTHORITATIVE BODY, ON SCREEN, WHEN THE CLIPBOARD WOULD NOT TAKE
        IT. Read-only and selectable rather than an editable field: this is
        the text the DRAFT row holds, and an operator editing it here would be
        editing a copy that no longer matches the record. Editing belongs in
        the composer above, before the draft is prepared.
      */}
      {failed && (
        <div className="space-y-1">
          <p className="text-xs text-destructive" role="alert">{HANDOFF_CLIPBOARD_FAILED}</p>
          <Textarea
            readOnly
            rows={8}
            value={handoff.body}
            data-testid="handoff-manual-body"
            className="text-xs font-mono"
            onFocus={(e) => e.target.select()}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The prepared emails, and the one sentence that keeps the record honest.
 *
 * Renders nothing at all when there is no handoff, which is the macOS case
 * and also the case where every coach was refused — an empty "Ready to send"
 * heading would be worse than silence.
 */
export default function HandoffSection({ handoffs = [] }) {
  if (!handoffs.length) return null;
  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-muted/40 p-2.5"
      data-testid="handoff-section">
      <p className="text-xs font-medium">{HANDOFF_SECTION(handoffs.length)}</p>
      {handoffs.map((h) => (
        <HandoffRow key={h.handoff.sendId ?? h.email} handoff={h.handoff} name={h.name} />
      ))}
      {/*
        THE SENTENCE THAT KEEPS THE CONFIRMATION HONEST. A compose window
        opening is the most convincing false signal in this workflow — see the
        label's own note.
      */}
      <p className="text-xs text-muted-foreground">{HANDOFF_NOT_SENT_YET}</p>
    </div>
  );
}
