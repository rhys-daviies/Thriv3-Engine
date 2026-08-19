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
