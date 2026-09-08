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

/**
 * THE OUTBOUND ACTION BUDGET. How much sending capacity may be spent in a day,
 * measured along two axes that fail differently.
 *
 * These do not replace PER_COACH_MAX_SENDS above and are not a variant of it.
 * That cap protects the RECIPIENT — one coach's inbox, over thirty days.
 * These protect the SENDER: the mailbox's reputation, and the rate at which a
 * single athlete consumes the service.
 */

/**
 * How many outbound attempts one athlete may consume in a day.
 *
 * A CEILING, NOT A TARGET. Ten is the approved product rule and it is a
 * maximum: the tenth attempt of the day is allowed and the eleventh is not.
 * Nothing tries to reach it, and a campaign that sends four on a Tuesday is
 * behaving normally.
 *
 * It exists for pacing and fairness rather than deliverability. Two athletes
 * on one mailbox are governed by the mailbox limit below, which is the axis
 * that protects reputation.
 */
export const ATHLETE_DAILY_OUTBOUND_LIMIT = Number(process.env.THRIV3_ATHLETE_DAILY_OUTBOUND ?? 10);

/**
 * How many outbound attempts one sending mailbox may make in a day.
 *
 * DELIBERATELY WITHOUT A DEFAULT, and that is the whole point of it.
 *
 * We know a sending mailbox needs a ceiling. We do not know what it should be:
 * a safe number depends on the domain's age, its warm-up history, its SPF and
 * DKIM alignment and its current reputation, and none of that has been
 * measured here. Picking 50 or 100 would put a number nobody has evidence for
 * into the one place that reads like it was chosen on evidence.
 *
 * So unset means UNCONFIGURED, never infinite. Automated execution refuses
 * outright with MAILBOX_LIMIT_REQUIRED rather than proceeding without a
 * ceiling — a missing limit is the most dangerous state a sender can be in,
 * and it must not be the quietest.
 *
 * It does NOT block today's manual Outlook workflow, which reaches no
 * enforcing path at all: the browser composer and the drafting CLI both pass
 * `send: false` and the operator presses Send in Outlook themselves. That
 * traffic is RECORDED against the mailbox when it is confirmed and is never
 * refused. See server/lib/outboundBudget.js.
 */
export const MAILBOX_DAILY_OUTBOUND_LIMIT = (() => {
  const raw = process.env.THRIV3_MAILBOX_DAILY_OUTBOUND;
  if (raw === undefined || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
})();
