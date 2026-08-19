import db from '../db/client.js';
import { ENGAGEMENT_RETENTION_GRACE_DAYS } from './config.js';
import { daysAgoIso, utcNow } from './time.js';

/**
 * Deactivation cascade, brief §7.
 *
 * Withdrawing an athlete from representation must immediately stop every link
 * already in a coach's inbox from resolving. Revocation is instant; the data
 * itself survives a grace period so that reactivating within a season does not
 * lose history.
 */
export function deactivateAthlete(athleteId, at = utcNow()) {
  return db.transaction(() => {
    db.prepare('UPDATE players SET archived_at = ?, updated_date = ? WHERE id = ? AND archived_at IS NULL')
      .run(at, at, athleteId);
    const { changes } = db
      .prepare('UPDATE outreach SET revoked_at = ? WHERE athlete_id = ? AND revoked_at IS NULL')
      .run(at, athleteId);
    return { athleteId, archivedAt: at, revokedOutreach: changes };
  })();
}

/** Reinstates the athlete and un-revokes the tokens revoked by deactivation. */
export function reactivateAthlete(athleteId, at = utcNow()) {
  return db.transaction(() => {
    db.prepare('UPDATE players SET archived_at = NULL, updated_date = ? WHERE id = ?').run(at, athleteId);
    const { changes } = db
      .prepare('UPDATE outreach SET revoked_at = NULL WHERE athlete_id = ? AND revoked_at IS NOT NULL')
      .run(athleteId);
    return { athleteId, restoredOutreach: changes };
  })();
}

/**
 * Purges tracking data for athletes deactivated longer than the grace period.
 * Outreach rows and their tokens are kept — they stay revoked, so a link that
 * has already been sent never starts resolving again.
 */
export function purgeExpiredEngagementData({ now = Date.now() } = {}) {
  const cutoff = daysAgoIso(ENGAGEMENT_RETENTION_GRACE_DAYS, now);
  const expired = db
    .prepare('SELECT id FROM players WHERE archived_at IS NOT NULL AND archived_at < ?')
    .all(cutoff)
    .map((r) => r.id);
  if (expired.length === 0) return { athletes: 0, events: 0, rollups: 0 };

  const placeholders = expired.map(() => '?').join(',');
  const scope = `SELECT id FROM outreach WHERE athlete_id IN (${placeholders})`;

  return db.transaction(() => {
    const events = db.prepare(`DELETE FROM tracking_events WHERE outreach_id IN (${scope})`).run(...expired);
    const rollups = db.prepare(`DELETE FROM engagement_rollup WHERE outreach_id IN (${scope})`).run(...expired);
    return { athletes: expired.length, events: events.changes, rollups: rollups.changes };
  })();
}
