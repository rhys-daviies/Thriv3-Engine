/**
 * Tracking data is retained for as long as the player profile is active.
 * After deactivation it survives this many days before being purged, so that
 * reactivating an athlete within a season does not lose their history.
 */
export const ENGAGEMENT_RETENTION_GRACE_DAYS = 90;

/** Opaque bearer credential in the ?ref= link. Never encodes identity. */
export const OUTREACH_TOKEN_LENGTH = 32;

/** Public profile filename. Random, never derived from the athlete's name. */
export const PUBLIC_SLUG_LENGTH = 10;

/**
 * Two qualified sessions closer together than this are one visit. A coach who
 * reloads the page, or opens it again after a meeting, has not returned —
 * returning is what the score weights most heavily, so the gate matters.
 * Brief §9 rule 4: collapse at the rollup layer, never at write time.
 */
export const SESSION_COLLAPSE_MINUTES = 30;

/** Quiet period before a write-triggered rollup rebuild runs. */
export const ROLLUP_DEBOUNCE_MS = 5_000;

/**
 * Where generated profile pages are reachable from. The default is fine for
 * local testing but is useless in a real email — a coach cannot open
 * localhost. Set THRIV3_PUBLIC_BASE_URL before any real outreach.
 */
export const PUBLIC_BASE_URL = process.env.THRIV3_PUBLIC_BASE_URL || 'http://localhost:8787';

export function isPubliclyReachable(baseUrl = PUBLIC_BASE_URL) {
  return !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(baseUrl);
}

/**
 * The address outreach should be sent from. Classic Outlook honours this;
 * New Outlook ignores it and silently uses the default account, so the sender
 * is always read back and reported rather than assumed.
 */
export const OUTLOOK_FROM_ADDRESS = process.env.THRIV3_FROM_ADDRESS || 'rhys@striv3.com';

/** Where the edge collector lives. Empty means everything stays local. */
export const EDGE_BASE_URL = (process.env.THRIV3_EDGE_URL || '').replace(/\/$/, '');

/** Shared secret for the authed sync endpoints on the edge collector. */
export const SYNC_SECRET = process.env.THRIV3_SYNC_SECRET || '';

/**
 * Who is sending, and from where. CAN-SPAM §7704(a)(5) requires both in every
 * commercial message, and recruiting outreach to a coach's work address is
 * commercial mail whether it goes through an ESP or through Outlook.
 *
 * Deliberately without a default. A placeholder postal address is worse than
 * none: it satisfies a code path while failing the law, and nothing downstream
 * can tell the difference. `sendOutreach` refuses to send while these are
 * unset, and the trial preflight says so before you get that far.
 */
export const SENDER_IDENTITY = process.env.THRIV3_SENDER_IDENTITY || '';
export const SENDER_POSTAL_ADDRESS = process.env.THRIV3_POSTAL_ADDRESS || '';

/** Where an unsubscribe link and the privacy notice are served from. */
export const UNSUBSCRIBE_BASE_URL = (process.env.THRIV3_UNSUBSCRIBE_BASE_URL || PUBLIC_BASE_URL).replace(/\/$/, '');

/**
 * Everything a compliant footer needs, or a list of what is missing.
 *
 * Returned together rather than checked at three call sites, so a message
 * cannot be assembled with two of the three present.
 */
export function complianceGaps() {
  const gaps = [];
  if (!SENDER_IDENTITY.trim()) gaps.push('THRIV3_SENDER_IDENTITY (who the mail is from)');
  if (!SENDER_POSTAL_ADDRESS.trim()) gaps.push('THRIV3_POSTAL_ADDRESS (a valid physical postal address)');
  // No unsubscribe-URL check any more: the opt-out is a reply, so the
  // mechanism is the From address, and OUTLOOK_FROM_ADDRESS has a hard-coded
  // fallback and can never be empty. Asserting it would be a guard that
  // cannot fail, which reads as safety without being any. What the reply
  // opt-out actually needs is a person actioning it — see the trial
  // preflight, which says so out loud, and `npm run suppress`.
  //
  // The `/u/<token>` endpoint stays live regardless: emails already sent
  // carry those links, and an opt-out that stops working is worse than one
  // never offered.
  return gaps;
}

/**
 * How many messages one inbox may receive from Thriv3, and over what window.
 *
 * Three in thirty days is one full A/B/C sequence. A second athlete wanting
 * the same coach inside that window waits rather than doubling up: the coach
 * experiences volume per inbox, not per athlete, and so does the spam filter.
 *
 * Set PER_COACH_MAX_SENDS to 0 to disable the cap, which should only ever be
 * a deliberate act during testing.
 */
export const PER_COACH_WINDOW_DAYS = Number(process.env.THRIV3_COACH_WINDOW_DAYS || 30);
export const PER_COACH_MAX_SENDS = Number(process.env.THRIV3_COACH_MAX_SENDS ?? 3);

/**
 * How often the edge sync runs by itself. Unset or 0 means never, and the
 * server says so at boot rather than leaving it to be assumed.
 *
 * Fifteen minutes is a reasonable pilot cadence: engagement data is read in
 * sessions rather than watched live, and a coach's visit being visible within
 * a quarter of an hour is well inside how fast anybody acts on it.
 */
export const SYNC_INTERVAL_MINUTES = Number(process.env.THRIV3_SYNC_INTERVAL_MINUTES || 0);
