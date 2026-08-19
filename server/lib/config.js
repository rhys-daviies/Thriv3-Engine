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
