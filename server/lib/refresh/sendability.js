/**
 * SEND-TIME SENDABILITY — Phase DI-03D. What a correction can change about who may be written to,
 * measured with the SAME rules every send path applies, on the correction's own connection (so,
 * inside the correction transaction, it sees the uncommitted state).
 *
 * A coach is OPEN when it passes everything the send floor checks except the activation hold:
 *   coachRowIneligibility (verified personal address, not PROVEN_STALE)
 *   + canonicalDecisionIneligibility (canonically eligible for THIS address at its FILED programme).
 * That is exactly coachIneligibility minus the hold. Comparing reconciler-eligible ID sets is not
 * enough (DI-03C F1): a coach the reconciler already marks eligible as REASSIGN is refused at send
 * time for a programme mismatch, and becomes sendable when a correction re-files it or moves the
 * host it resolves through — without ever entering the eligible set.
 *
 * A programme inbox is OPEN when programmeContactProblems reports nothing (the 1B floor).
 *
 * Read-only.
 */
import { coachRowIneligibility } from '../coachRowFloor.js';
import { canonicalDecisions, canonicalDecisionIneligibility } from '../canonicalCoachEligibility.js';
import { buildProgrammeContactContext, programmeContactProblems } from '../programmeContactEligibility.js';

/** -> { coaches: Map(id -> reason|null), contacts: Map(contact_id -> problems[]) } over the whole universe. */
export function sendabilitySnapshot(db, { scope = 'NAIA', now = new Date() } = {}) {
  const d = canonicalDecisions(db, { scope, fresh: true });
  const coaches = new Map();
  for (const row of db.prepare('SELECT * FROM coaches').all()) coaches.set(row.id, coachRowIneligibility(row) || canonicalDecisionIneligibility(row, d));
  const contacts = new Map();
  const hasPc = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='programme_contacts'").get();
  if (hasPc) {
    const pcCtx = buildProgrammeContactContext(db);
    for (const row of db.prepare('SELECT * FROM programme_contacts').all()) contacts.set(row.contact_id, programmeContactProblems(row, pcCtx, { now }));
  }
  return { coaches, contacts };
}

const openIds = (m, isOpen) => new Set([...m].filter(([, v]) => isOpen(v)).map(([k]) => k));
const coachOpen = (v) => v === null;
const contactOpen = (v) => Array.isArray(v) && v.length === 0;

/** The coaches / inboxes that are open after and were not before (and the reverse). */
export function sendabilityDelta(before, after) {
  const cb = openIds(before.coaches, coachOpen); const ca = openIds(after.coaches, coachOpen);
  const pb = openIds(before.contacts, contactOpen); const pa = openIds(after.contacts, contactOpen);
  const minus = (a, b) => [...a].filter((x) => !b.has(x)).sort();
  return {
    coaches_open_before: cb.size, coaches_open_after: ca.size,
    newly_sendable_coaches: minus(ca, cb), no_longer_sendable_coaches: minus(cb, ca),
    contacts_open_before: pb.size, contacts_open_after: pa.size,
    newly_sendable_contacts: minus(pa, pb), no_longer_sendable_contacts: minus(pb, pa),
    // why each newly sendable coach was closed before (REASSIGN programme mismatch shows up here)
    newly_sendable_were: Object.fromEntries(minus(ca, cb).map((id) => [id, before.coaches.get(id) ?? 'NOT_PRESENT'])),
  };
}
