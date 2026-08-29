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
    SELECT o.id, o.athlete_id, o.drafted_at, o.created_at,
           p.full_name AS athlete_name,
           c.full_name AS coach_name, c.email, c.school,
           e.structure, e.selected_kinds, e.evidence_count
    FROM outreach o
    JOIN players p ON p.id = o.athlete_id
    JOIN coaches c ON c.id = o.coach_id
    LEFT JOIN outreach_evidence e ON e.outreach_id = o.id
    WHERE o.sent_at IS NULL
      AND o.drafted_at IS NOT NULL
      AND o.revoked_at IS NULL
      AND (@athleteId IS NULL OR o.athlete_id = @athleteId)
    ORDER BY o.drafted_at
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

  const eligible = new Set(pendingDrafts().map((r) => r.id));
  const confirmable = wanted.filter((id) => eligible.has(id));
  const skipped = wanted.filter((id) => !eligible.has(id));

  // One transaction: a half-confirmed batch is a denominator nobody can
  // reason about afterwards.
  db.transaction(() => {
    for (const id of confirmable) markOutreachSent(id, at);
  })();

  return { confirmed: confirmable.length, skipped, at };
}

/** Counts for a status line, so "nothing pending" is distinguishable from an error. */
export function draftSummary({ athleteId = null } = {}) {
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN o.sent_at IS NOT NULL THEN 1 ELSE 0 END), 0)                        AS confirmed_sent,
      COALESCE(SUM(CASE WHEN o.sent_at IS NULL AND o.drafted_at IS NOT NULL
                         AND o.revoked_at IS NULL THEN 1 ELSE 0 END), 0)                         AS pending,
      COALESCE(SUM(CASE WHEN o.drafted_at IS NULL AND o.sent_at IS NULL THEN 1 ELSE 0 END), 0)   AS never_drafted,
      COALESCE(SUM(CASE WHEN o.revoked_at IS NOT NULL THEN 1 ELSE 0 END), 0)                     AS revoked
    FROM outreach o
    WHERE (@athleteId IS NULL OR o.athlete_id = @athleteId)
  `).get({ athleteId });
}
