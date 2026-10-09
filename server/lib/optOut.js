/**
 * RECORDING AN OPT-OUT FROM THE APP — Phase 5, PR A (#2).
 *
 * Every manual email ends "If you'd rather not hear from us, just reply and
 * we'll take you off our list." Those replies arrive as prose in whichever
 * mailbox sent the email, and until now the only way to honour one was
 * `npm run suppress` in a terminal. This is that same act from the screen.
 *
 * It is the existing `suppress()` and nothing more: keyed on the address
 * alone (an opt-out is from Thriv3, not from one athlete), idempotent, and the
 * FIRST record wins - recording it twice never moves the date it was honoured.
 * The address is resolved from the outreach relationship on the server; a
 * request never names an address, so the button cannot suppress somebody the
 * relationship is not with. There is no un-suppress here: that stays a
 * deliberate act of its own (`unsuppress`), as the suppression module says.
 *
 * LOCAL TO THIS DATABASE. The row is written here and honoured by every send
 * from here; it is not pushed to the engagement edge service (edge sync only
 * PULLS unsubscribes in) or to any other environment. See docs/hosting.md,
 * "Opt-outs are local to the database". Never describe it as global.
 */
import db from '../db/client.js';
import { recipientForOutreach, RecipientError } from './recipient.js';
import { suppress } from './suppressions.js';

/** The reasons an operator may record. 'bounced' and 'complained' arrive from systems, not people. */
export const OPERATOR_OPT_OUT_REASONS = Object.freeze(['unsubscribed', 'manual']);

export class OptOutError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function recipientOf(outreachId) {
  let found;
  try {
    found = recipientForOutreach(outreachId);
  } catch (err) {
    if (err instanceof RecipientError) throw new OptOutError(409, 'RECIPIENT_UNRESOLVED', 'This outreach has no recipient record to opt out.');
    throw err;
  }
  if (!found) throw new OptOutError(404, 'OUTREACH_NOT_FOUND', 'No such outreach.');
  const email = String(found.recipient?.email ?? '').trim().toLowerCase();
  if (!email) throw new OptOutError(409, 'RECIPIENT_HAS_NO_ADDRESS', 'This recipient has no email address to opt out.');
  return { ...found, email };
}

/** Whether this relationship's recipient has opted out, and when. */
export function optOutStatus(outreachId) {
  const { email } = recipientOf(outreachId);
  const row = db.prepare('SELECT reason, source, created_at FROM suppressions WHERE email = ?').get(email);
  return row ? { optedOut: true, reason: row.reason, source: row.source, recordedAt: row.created_at } : { optedOut: false };
}

/**
 * Record the opt-out for this relationship's recipient.
 *
 * @param {object} opts.reason   one of OPERATOR_OPT_OUT_REASONS (default 'unsubscribed')
 * @param {string} opts.note     what the operator saw, e.g. "replied 9 Oct: please remove me"
 * @param {object} opts.operator the signed-in operator, recorded in the note for audit
 */
export function recordOptOut(outreachId, { reason = 'unsubscribed', note = null, operator = null } = {}) {
  if (!OPERATOR_OPT_OUT_REASONS.includes(reason)) {
    throw new OptOutError(400, 'UNKNOWN_REASON', `Reason must be one of ${OPERATOR_OPT_OUT_REASONS.join(', ')}.`);
  }
  const { email } = recipientOf(outreachId);
  const token = db.prepare('SELECT token FROM outreach WHERE id = ?').get(outreachId)?.token ?? null;
  const text = String(note ?? '').trim().slice(0, 500);
  const by = operator?.email ? `recorded in app by ${operator.email}` : 'recorded in app';
  const result = suppress({
    email, reason, source: 'manual', outreachToken: token, note: text ? `${text} (${by})` : by,
  });
  return {
    optedOut: true,
    alreadyRecorded: result.alreadySuppressed,
    reason: result.reason,
    recordedAt: result.created_at,
  };
}
