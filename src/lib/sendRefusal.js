/**
 * WHY A RECIPIENT WAS NOT PREPARED — Phase 5, PR A (#3).
 *
 * The send endpoint skips a recipient for several reasons (opted out, not
 * eligible, recently contacted, the mailbox's daily limit, a withdrawn link,
 * a link the collector could not activate). Only some of those results carry
 * a human `message`, and the composers drew a badge only for those - so an
 * opted-out or ineligible coach was a row with no tick and no cross, and the
 * operator could not tell it had been skipped.
 *
 * One table, read by both composers, so every refusal the server can return
 * has a word on the row and a sentence behind it. Plain .js so it is covered
 * by the test config. An unknown status still reads as "not prepared" with
 * whatever the server said - never as nothing.
 */

/** Coach-floor codes from server/lib/coachEligibility.js, in operator words. */
export function ineligibleReasonText(code) {
  const c = String(code ?? '');
  if (c.startsWith('COACH_ACTIVATION_HELD')) return 'This coach is paused by an activation hold.';
  if (c.startsWith('EMAIL_NOT_VERIFIED')) return "This coach's email address has not been verified.";
  if (c === 'NO_USABLE_EMAIL') return 'This contact has no usable email address.';
  if (c === 'COACH_PROVEN_STALE') return 'This coach is no longer listed at the programme.';
  if (c === 'UNKNOWN_ADDRESS') return 'This address is not a coach Thriv3 holds for the programme.';
  if (c === 'ADDRESS_AT_OTHER_PROGRAMME') return 'This address belongs to a coach at a different programme.';
  if (c === 'PROGRAMME_INACTIVE') return 'This programme is inactive, so it does not take new outreach.';
  if (c === 'PROGRAMME_INBOX_ADDRESS_NOT_TYPED') return 'This is a programme inbox; it can only be written to as the programme contact.';
  if (c === 'COACH_EMAIL_POSITIVELY_ABSENT') return 'The programme no longer publishes this email address.';
  if (c.startsWith('COACH_')) return 'This coach is not yet confirmed as working at the programme.';
  return 'This recipient is not eligible for outreach.';
}

/**
 * `{ word, detail, tone }` for a refused result, or null for a result that was
 * prepared or sent (or has not happened). `tone` is 'warn' or 'error'.
 */
export function refusalFor(result) {
  if (!result?.status) return null;
  const { status } = result;
  if (status === 'sent' || status === 'drafted') return null;
  switch (status) {
    case 'suppressed':
      return { word: 'opted out', tone: 'warn', detail: 'This address has opted out of Thriv3 email. Nothing was prepared.' };
    case 'not-eligible':
      return { word: 'not eligible', tone: 'warn', detail: `${ineligibleReasonText(result.reason)} Nothing was prepared.` };
    case 'rate-capped':
      return {
        word: 'recently contacted',
        tone: 'warn',
        detail: `This address was written to ${result.recentSends ?? 'several'} time(s) recently, which is the limit. Nothing was sent.`,
      };
    case 'budget-refused':
      return { word: 'daily limit reached', tone: 'warn', detail: result.error || "The sending mailbox has reached today's limit. Nothing was sent." };
    case 'revoked':
      return { word: 'link withdrawn', tone: 'warn', detail: result.message || 'Outreach to this recipient was revoked. Nothing was prepared.' };
    case 'link-not-activated':
      return { word: 'link not live', tone: 'warn', detail: result.message || 'The profile link could not be activated, so nothing was prepared.' };
    case 'error':
      return { word: 'failed', tone: 'error', detail: result.error || result.message || 'This recipient could not be prepared.' };
    default:
      return { word: 'not prepared', tone: 'warn', detail: result.message || result.reason || result.error || `Not prepared (${status}).` };
  }
}
