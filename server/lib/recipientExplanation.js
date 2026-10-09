/**
 * WHY NOBODY CAN BE WRITTEN TO AT THIS PROGRAMME — Phase 5, PR A (#10).
 *
 * The manual composer used to say "No coaches with a verified email on file
 * for this program" whenever it had no recipient. That is the explanation for
 * one cause out of several, and for the others it is wrong: a verified coach
 * may be paused by an activation hold, a coach may have opted out (which also
 * stops the programme inbox being used in their place), or the only inbox may
 * be stale or opted out. An operator told the wrong reason looks for the wrong
 * fix.
 *
 * This module DECIDES NOTHING. It reads the same answers the send path reads -
 * `manualRecipientChoice` (the hierarchy), `outreachIneligibility` (the coach
 * floor), `isSuppressed` - and puts them into words. If it disagreed with the
 * hierarchy it would be describing a decision nobody made, so it never runs
 * its own rules: the summary comes from the hierarchy's `blockedBy`, and the
 * details are counts over the same rows.
 */
import db from '../db/client.js';
import { manualRecipientChoice, RECIPIENT_SELECTION, INBOX_NOT_SELECTED, heldNamedCoach } from './recipientSelection.js';
import { outreachIneligibility } from './coachEligibility.js';
import { isSuppressed } from './suppressions.js';

export const NO_RECIPIENT_REASON = Object.freeze({
  NAMED_COACH_HELD: 'NAMED_COACH_HELD',
  COACH_OPTED_OUT: 'COACH_OPTED_OUT',
  NOTHING_ELIGIBLE: 'NOTHING_ELIGIBLE',
  NOTHING_ON_FILE: 'NOTHING_ON_FILE',
});

/** A coach-floor refusal code, in words an operator can act on. */
export function coachReasonText(code) {
  const c = String(code ?? '');
  if (c.startsWith('COACH_ACTIVATION_HELD')) return 'paused by an activation hold';
  if (c.startsWith('EMAIL_NOT_VERIFIED')) return 'email address not verified';
  if (c === 'NO_USABLE_EMAIL') return 'no usable email address';
  if (c === 'COACH_PROVEN_STALE') return 'no longer listed at the programme';
  if (c === 'COACH_EMAIL_POSITIVELY_ABSENT') return 'email address no longer published by the programme';
  if (c === 'COACH_CANONICAL_PROGRAMME_MISMATCH') return 'filed under a different programme';
  if (c === 'COACH_NO_CANONICAL_DECISION' || c === 'COACH_NOT_CANONICALLY_ELIGIBLE') return 'not yet confirmed as working at the programme';
  return 'not eligible for outreach';
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Null when the manual hierarchy can write to someone. Otherwise
 * `{ reason, summary, details[] }`, where `summary` is one sentence naming the
 * deciding cause and `details` count every recorded contact by why it was not
 * offered.
 */
export function explainNoManualRecipient({ collegeName, sport }, { handle = db, env = process.env, now = new Date() } = {}) {
  const choice = manualRecipientChoice({ collegeName, sport }, { handle, env, now });
  if (choice.kind !== RECIPIENT_SELECTION.NO_RECIPIENT) return null;

  const staff = handle.prepare('SELECT * FROM coaches WHERE school = ? AND sport = ? ORDER BY id').all(collegeName, sport)
    .filter((c) => String(c.full_name ?? '').trim() !== '');
  const optedOut = staff.filter((c) => c.email && isSuppressed(c.email));
  const held = staff.filter((c) => !optedOut.includes(c) && heldNamedCoach(c, { handle }));
  const ineligible = new Map();
  for (const c of staff) {
    if (optedOut.includes(c) || held.includes(c)) continue;
    const code = outreachIneligibility(c, { handle, env });
    if (code === null) continue;
    const text = coachReasonText(code);
    ineligible.set(text, (ineligible.get(text) ?? 0) + 1);
  }
  const inboxes = choice.inbox ?? { eligible: [], refused: [] };
  const inboxOptedOut = inboxes.refused.filter((r) => r.reason === INBOX_NOT_SELECTED.SUPPRESSED).length;
  const inboxIneligible = inboxes.refused.filter((r) => r.reason === INBOX_NOT_SELECTED.INELIGIBLE).length;

  const details = [];
  if (optedOut.length) details.push(`${plural(optedOut.length, 'coach has', 'coaches have')} opted out of Thriv3 email`);
  if (held.length) details.push(`${plural(held.length, 'coach is', 'coaches are')} paused by an activation hold`);
  for (const [text, n] of ineligible) details.push(`${plural(n, 'coach', 'coaches')}: ${text}`);
  if (inboxOptedOut) details.push(`${plural(inboxOptedOut, 'programme inbox has', 'programme inboxes have')} opted out`);
  if (inboxIneligible) details.push(`${plural(inboxIneligible, 'programme inbox is', 'programme inboxes are')} on file but not current or not confirmed as the programme's own`);

  const blockedBy = inboxes.blockedBy ?? null;
  if (blockedBy === INBOX_NOT_SELECTED.NAMED_COACH_HELD) {
    return {
      reason: NO_RECIPIENT_REASON.NAMED_COACH_HELD,
      summary: 'A coach at this programme is paused by an activation hold, so no other contact is offered in their place until the hold is resolved.',
      details,
    };
  }
  if (blockedBy === INBOX_NOT_SELECTED.COACH_OPTED_OUT_AT_PROGRAMME) {
    return {
      reason: NO_RECIPIENT_REASON.COACH_OPTED_OUT,
      summary: "A coach at this programme has opted out of Thriv3 email, so the programme's inbox is not used in their place.",
      details,
    };
  }
  if (!staff.length && !inboxes.eligible.length && !inboxes.refused.length) {
    return {
      reason: NO_RECIPIENT_REASON.NOTHING_ON_FILE,
      summary: 'Thriv3 holds no coach or programme inbox for this programme.',
      details,
    };
  }
  return {
    reason: NO_RECIPIENT_REASON.NOTHING_ELIGIBLE,
    summary: 'Contacts are on file for this programme, but none can be written to right now.',
    details,
  };
}
