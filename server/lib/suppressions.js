/**
 * The opt-out list, and the one check that must never be skippable.
 *
 * Keyed on the email address alone. A coach who unsubscribes is opting out of
 * Thriv3, not out of one athlete's campaign — keying this on (athlete, coach)
 * would let the next athlete mail them again the following week, which is
 * both the thing recipients hate most and a straightforward CAN-SPAM
 * violation.
 *
 * Nothing here deletes. Un-suppressing is a deliberate act with its own
 * function so it cannot happen as a side effect of a re-import or a cleanup.
 */
import db from '../db/client.js';
import { utcNow } from './time.js';

const REASONS = new Set(['unsubscribed', 'bounced', 'complained', 'manual']);

const norm = (email) => (email || '').trim().toLowerCase();

/** True if this address must not be mailed. */
export function isSuppressed(email) {
  const address = norm(email);
  if (!address) return false;
  return Boolean(db.prepare('SELECT 1 FROM suppressions WHERE email = ?').get(address));
}

/** Every suppressed address in one set, for filtering a list before a send. */
export function suppressedSet() {
  return new Set(db.prepare('SELECT email FROM suppressions').all().map((r) => r.email));
}

/**
 * Records an opt-out. Idempotent, and the first record wins: a later
 * "manual" entry must not overwrite the timestamp of the original request,
 * which is the one that matters if anybody ever asks when it was honoured.
 */
export function suppress({ email, reason = 'unsubscribed', source = 'manual', outreachToken = null, note = null }) {
  const address = norm(email);
  if (!address) throw new Error('Cannot suppress a blank address');
  if (!REASONS.has(reason)) throw new Error(`Unknown suppression reason "${reason}"`);

  const existing = db.prepare('SELECT * FROM suppressions WHERE email = ?').get(address);
  if (existing) return { ...existing, alreadySuppressed: true };

  const row = {
    email: address,
    created_at: utcNow(),
    reason,
    source,
    outreach_token: outreachToken,
    note,
  };
  db.prepare(`
    INSERT INTO suppressions (email, created_at, reason, source, outreach_token, note)
    VALUES (@email, @created_at, @reason, @source, @outreach_token, @note)
  `).run(row);
  return { ...row, alreadySuppressed: false };
}

/**
 * Removes a suppression. Separate, explicit, and never called by an import or
 * a cleanup — only by a human who has a reason.
 */
export function unsuppress(email) {
  return db.prepare('DELETE FROM suppressions WHERE email = ?').run(norm(email)).changes > 0;
}

export function listSuppressions() {
  return db.prepare('SELECT * FROM suppressions ORDER BY created_at DESC').all();
}
