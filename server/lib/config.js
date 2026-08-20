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
