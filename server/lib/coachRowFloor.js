/**
 * The ROW half of the runtime coach floor (Phase 8A), with no database import, so the correction
 * engine can evaluate send-time sendability inside its own transaction without booting a client.
 * coachEligibility.js re-exports everything here unchanged; behaviour is identical.
 */
export const INELIGIBLE = Object.freeze({
  NO_USABLE_EMAIL: 'NO_USABLE_EMAIL',
  COACH_PROVEN_STALE: 'COACH_PROVEN_STALE',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  UNKNOWN_ADDRESS: 'UNKNOWN_ADDRESS',
  ADDRESS_AT_OTHER_PROGRAMME: 'ADDRESS_AT_OTHER_PROGRAMME',
  PROGRAMME_INACTIVE: 'PROGRAMME_INACTIVE',
});

export const usable = (e) => !!e && String(e).includes('@') && String(e).trim() !== '' && String(e).trim().toUpperCase() !== 'N/A';

/** Why a coach row fails the ROW checks (address, currentness, verification), or null. Pure. */
export function coachRowIneligibility(row) {
  if (!row || !usable(row.email)) return INELIGIBLE.NO_USABLE_EMAIL;
  if (row.currentness_status === 'PROVEN_STALE') return INELIGIBLE.COACH_PROVEN_STALE;
  if (row.email_status !== 'verified') return `${INELIGIBLE.EMAIL_NOT_VERIFIED}:${row.email_status || 'unknown'}`;
  return null;
}
