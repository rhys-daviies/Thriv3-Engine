/**
 * Turning drafts into confirmed sends.
 *
 * The gap this closes: Outlook is driven by AppleScript that opens a draft
 * window, and nothing observes whether the operator then presses Send. There
 * is no callback, no sent-items poll, and no honest way to infer it — so
 * rather than guess, the send is confirmed by the person who sent it.
 *
 * Everything downstream keys on `outreach.sent_at IS NOT NULL`: evidence
 * performance, reply-rate denominators, the per-inbox send cap. A draft
 * therefore costs nothing and counts as nothing until it is confirmed, which
 * is the property the measured experiment needs. Its token still works and its
 * evidence row is still written, so a coach who somehow receives an
 * unconfirmed draft is still tracked — the confirmation governs the DENOMINATOR,
 * not the instrumentation.
 *
 * Batches rather than individual rows, because that is how the work actually
 * happens: a `npm run draft -- --apply` run produces twenty drafts in a minute,
 * the operator works through them in Outlook, and then confirms what went. A
 * per-message confirmation would be twenty decisions to record one.
 */

import db from '../db/client.js';
import { utcNow } from './time.js';
import { markOutreachSent } from './outreach.js';
import { acceptSend } from './outreachSend.js';
import { recordManualOutboundAttempt } from './outboundBudget.js';
import { MESSAGE_STATE, OPEN_STATES, ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';

const OPEN_LIST = OPEN_STATES.map((s) => `'${s}'`).join(', ');

/**
 * How long a gap splits one drafting run from the next.
 *
 * A CLI run drafts sequentially with a second or two between messages, so
 * anything inside half an hour is one sitting. Wrong in only one direction
 * that matters: too SMALL a gap splits one run into two batches, which the
 * operator sees and can confirm separately. Too large would merge Tuesday's
 * run into Wednesday's and confirm mail that was never sent.
 */
export const BATCH_GAP_MINUTES = 30;

const MINUTE = 60_000;

/**
 * Drafts that have not been confirmed as sent.
 *
 * Revoked outreach is excluded: a revoked token is a message we have withdrawn
 * and must not later be confirmed as delivered.
 */
export function pendingDrafts({ athleteId = null } = {}) {
  return db.prepare(`
    SELECT o.id, o.athlete_id, o.created_at,
           s.id           AS send_id,
           s.sequence     AS sequence,
           s.state        AS state,
           -- The MESSAGE's draft time where there is a message, so a batch is
           -- grouped by when its messages were written rather than by whenever
           -- the relationship was last touched.
           COALESCE(s.drafted_at, o.drafted_at) AS drafted_at,
           p.full_name AS athlete_name,
           c.full_name AS coach_name, c.email, c.school,
           e.structure, e.selected_kinds, e.evidence_count
    FROM outreach o
    JOIN players p ON p.id = o.athlete_id
    JOIN coaches c ON c.id = o.coach_id
    LEFT JOIN outreach_evidence e ON e.outreach_id = o.id
    LEFT JOIN outreach_send s
           ON s.outreach_id = o.id AND s.state IN (${OPEN_LIST})
    WHERE o.revoked_at IS NULL
      AND (@athleteId IS NULL OR o.athlete_id = @athleteId)
      AND (
        -- A message is open. THE FIX: read per MESSAGE, so a follow-up appears
        -- even though the relationship was confirmed months ago.
        s.id IS NOT NULL
        OR (
          -- A relationship drafted before messages were recorded at all.
          -- recordDraft only runs when evidence could be derived, so 55 rows
          -- on file were drafted with no message record and would otherwise
          -- become unconfirmable the moment this stopped reading outreach.
          o.drafted_at IS NOT NULL
          AND o.sent_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM outreach_send x WHERE x.outreach_id = o.id)
        )
      )
    ORDER BY COALESCE(s.drafted_at, o.drafted_at)
  `).all({ athleteId });
}

/**
 * Pending drafts grouped into the sittings that produced them.
 *
 * Newest batch LAST in the returned array, so `batches[batches.length - 1]` is
 * the run just finished — the one an operator almost always means.
 */
export function pendingBatches({ athleteId = null, gapMinutes = BATCH_GAP_MINUTES } = {}) {
  const rows = pendingDrafts({ athleteId });
  const batches = [];
  let current = null;
  let previous = null;

  for (const row of rows) {
    const at = Date.parse(row.drafted_at);
    if (!current || !Number.isFinite(at) || !Number.isFinite(previous)
      || at - previous > gapMinutes * MINUTE) {
      current = { from: row.drafted_at, to: row.drafted_at, rows: [] };
      batches.push(current);
    }
    current.rows.push(row);
    current.to = row.drafted_at;
    previous = at;
  }

  return batches.map((b, i) => ({
    index: i + 1,
    from: b.from,
    to: b.to,
    count: b.rows.length,
    athletes: [...new Set(b.rows.map((r) => r.athlete_name))],
    colleges: [...new Set(b.rows.map((r) => r.school))],
    rows: b.rows,
  }));
}

/**
 * Confirms a set of outreach ids as genuinely sent.
 *
 * Takes IDS, not a filter. The caller has already shown the operator exactly
 * which messages it is about to confirm, and re-running the filter here would
 * mean confirming a set nobody looked at — a draft created between the listing
 * and the confirmation would be swept in silently.
 *
 * Re-confirming is harmless: `markOutreachSent` keeps the first timestamp, so
 * a send cannot be moved forward out of an engagement window.
 */
export function confirmSent(ids = [], { at = utcNow() } = {}) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return { confirmed: 0, skipped: [], at };

  const pending = pendingDrafts();
  const eligible = new Set(pending.map((r) => r.id));
  const confirmable = wanted.filter((id) => eligible.has(id));
  const skipped = wanted.filter((id) => !eligible.has(id));

  // One transaction: a half-confirmed batch is a denominator nobody can
  // reason about afterwards.
  // The open message for each relationship being confirmed, resolved BEFORE
  // the transaction so the ids are the ones the caller was shown.
  const openBy = new Map(pending.filter((r) => r.send_id).map((r) => [r.id, r.send_id]));

  db.transaction(() => {
    for (const id of confirmable) {
      /**
       * `outreach.sent_at` is FIRST-WINS and stays that way. It dates the first
       * message ever confirmed on this relationship, and B2 does not move it:
       * `sendCap` and the evidence denominators read it, and a follow-up
       * advancing it would silently re-date somebody's engagement window.
       *
       * It is no longer what decides whether anything is pending — that is now
       * the message's own state.
       */
      markOutreachSent(id, at);
      /**
       * The message itself. Accepted BY ID, so confirming this relationship's
       * open message cannot reach another, and so a sequence 2 or 3 is
       * confirmable at all — which it was not before B2.
       *
       * Absent for a relationship drafted before messages were recorded. Left
       * absent rather than invented: there is no snapshot for that message and
       * fabricating one would stand a made-up record beside real ones.
       */
      const sendId = openBy.get(id);
      if (sendId) acceptSend(sendId, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED, at });

      /**
       * THE MAILBOX PAID FOR THIS ONE TOO.
       *
       * Every manual message leaves through the same shared Outlook account as
       * every automated one, so a mailbox budget that counted only automated
       * traffic would understate the thing it exists to protect — and would do
       * so by exactly the volume the pilot is actually sending today.
       *
       * RECORDED, NEVER ENFORCED, and it could not be otherwise: by the time
       * an operator is confirming a batch, the coach already has the email.
       * Refusing here would decline to write down mail that had already gone.
       * See recordManualOutboundAttempt, which is the only non-enforcing entry
       * to the ledger and says why at length.
       *
       * Dated by the confirmation, because that is the only instant this
       * process observed. Marked OUTLOOK_MANUAL so an analysis that needs
       * exact timing can tell these apart from the ones it can trust.
       *
       * Best-effort, like logEvidence: an operator recording what they already
       * sent must not be blocked by an accounting write, and the confirmation
       * is the more important of the two facts.
       */
      try {
        recordManualOutboundAttempt({ outreachId: id, at });
      } catch (err) {
        console.warn(`  outbound attempt not recorded for ${id}: ${err.message}`);
      }
    }
  })();

  return { confirmed: confirmable.length, skipped, at };
}

/** Counts for a status line, so "nothing pending" is distinguishable from an error. */
export function draftSummary({ athleteId = null } = {}) {
  /**
   * COUNTS MESSAGES WHERE THERE ARE MESSAGES, relationships where there are
   * none.
   *
   * It used to count relationships throughout, which meant a confirmed
   * relationship could never show a pending follow-up and a second confirmed
   * message never raised `confirmed_sent` above one. Both are per-message
   * facts and are read as such now.
   *
   * `never_drafted` and `revoked` stay relationship-level on purpose: a
   * relationship whose compose threw has no message to count, and a revoked
   * one is withdrawn as a whole.
   */
  const messages = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN s.state = '${MESSAGE_STATE.ACCEPTED}' THEN 1 ELSE 0 END), 0) AS confirmed_sent
    FROM outreach_send s
    JOIN outreach o ON o.id = s.outreach_id
    WHERE (@athleteId IS NULL OR o.athlete_id = @athleteId)
  `).get({ athleteId });

  const relationships = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN o.drafted_at IS NULL AND o.sent_at IS NULL THEN 1 ELSE 0 END), 0) AS never_drafted,
      COALESCE(SUM(CASE WHEN o.revoked_at IS NOT NULL THEN 1 ELSE 0 END), 0)                   AS revoked,
      -- Confirmed before messages were recorded: counted here so the total
      -- does not drop for the 41 rows that predate all of this.
      COALESCE(SUM(CASE WHEN o.sent_at IS NOT NULL AND o.revoked_at IS NULL
                    AND NOT EXISTS (SELECT 1 FROM outreach_send x WHERE x.outreach_id = o.id)
                   THEN 1 ELSE 0 END), 0)                                                      AS legacy_sent
    FROM outreach o
    WHERE (@athleteId IS NULL OR o.athlete_id = @athleteId)
  `).get({ athleteId });

  return {
    confirmed_sent: messages.confirmed_sent + relationships.legacy_sent,
    pending: pendingDrafts({ athleteId }).length,
    never_drafted: relationships.never_drafted,
    revoked: relationships.revoked,
  };
}
