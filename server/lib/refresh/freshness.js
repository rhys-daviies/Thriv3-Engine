/**
 * FRESHNESS POLICY — Phase 7E. How old evidence may be before it stops meaning "now".
 *
 * The windows are anchored to the COMPETITIVE CYCLE, not to arbitrary day counts, because
 * that is what the evidence supports:
 *   - Phase 4B/4D measured staff churn peaking May-Aug (hiring cycle) and set evidence expiry
 *     at one competitive season; the authoritative annual pass is pre-season Jul-Sep.
 *   - Fall-soccer rosters are published for the season in Aug-Sep (2026: 1,910/2,104
 *     programmes had a current roster by late September).
 *   - Membership changes take effect on the governing bodies' annual cycle (Shawnee State:
 *     announced Feb 2026, effective 2026-27).
 * A cycle runs 1 July -> 30 June; cycle(date) is the fall season it belongs to.
 *
 *   CURRENT  verified inside the current cycle
 *   AGING    verified in the previous cycle (still usable; re-verify next pass)
 *   STALE    older than the previous cycle (re-verify before relying on it)
 *   UNKNOWN  never verified by an authoritative source (incl. SEED rows)
 *
 * AGING/STALE describe the CHECK, not the fact: a stale check is re-verified, it is never
 * turned into PROVEN_STALE (a coach departure) by age alone (Phase 4D rule).
 */
export const FRESHNESS = Object.freeze({ CURRENT: 'CURRENT', AGING: 'AGING', STALE: 'STALE', UNKNOWN: 'UNKNOWN' });

/** Fall season a timestamp's July-June cycle belongs to. */
export function cycleOf(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

function byCycle(verifiedAt, now) {
  if (!verifiedAt) return FRESHNESS.UNKNOWN;
  const v = cycleOf(verifiedAt); const n = cycleOf(now);
  if (v == null || n == null) return FRESHNESS.UNKNOWN;
  if (v >= n) return FRESHNESS.CURRENT;
  if (v === n - 1) return FRESHNESS.AGING;
  return FRESHNESS.STALE;
}

/** Roster publication window: a prior-season roster is only AGING until 1 Oct of the current season. */
const ROSTER_PUBLICATION_CUTOFF = { month: 9, day: 1 }; // 1 October (0-based month 9)

export const FRESHNESS_POLICY = Object.freeze({
  coach_currentness: 'currentness_checked_at by competitive cycle; CURRENT requires an authoritative current-page observation',
  email_seen: 'email_seen_on_source_at by competitive cycle; only an exact published address counts',
  roster: 'latest official roster season vs the current season; prior season is AGING until 1 Oct (publication window), STALE after',
  programme_membership: 'open membership period verified by a tier A/B source in the cycle; SEED rows are UNKNOWN until verified',
  domain_verification: 'athletics_domains.checked_at by competitive cycle',
});

/**
 * Freshness of one record. Returns { last_observed, last_verified, source, state }.
 *   kind: 'coach' | 'email' | 'roster' | 'membership' | 'domain'
 */
export function freshnessOf(kind, rec = {}, { now = new Date(), season } = {}) {
  const n = now instanceof Date ? now : new Date(now);
  const cur = season ?? cycleOf(n);
  switch (kind) {
    case 'coach': {
      const verified = rec.currentness_status === 'CURRENT' ? rec.currentness_checked_at : null;
      return { last_observed: rec.currentness_checked_at || null, last_verified: verified, source: rec.currentness_source_url || null, state: byCycle(verified, n) };
    }
    case 'email':
      return { last_observed: rec.email_seen_on_source_at || null, last_verified: rec.email_seen_on_source_at || null, source: rec.email_seen_on_source_url || null, state: byCycle(rec.email_seen_on_source_at, n) };
    case 'roster': {
      const s = rec.latest_season == null ? null : Number(rec.latest_season);
      let state = FRESHNESS.UNKNOWN;
      if (s != null) {
        if (s >= cur) state = FRESHNESS.CURRENT;
        else if (s === cur - 1) {
          const cutoff = new Date(Date.UTC(cur, ROSTER_PUBLICATION_CUTOFF.month, ROSTER_PUBLICATION_CUTOFF.day));
          state = n < cutoff ? FRESHNESS.AGING : FRESHNESS.STALE;
        } else state = FRESHNESS.STALE;
      }
      return { last_observed: rec.source_fetched_at || null, last_verified: s, source: rec.source_roster_url || null, state };
    }
    case 'membership': {
      const verified = rec.source_tier === 'A' || rec.source_tier === 'B' ? rec.recorded_at : null;
      return { last_observed: rec.recorded_at || null, last_verified: verified, source: rec.source_url || null, state: byCycle(verified, n) };
    }
    case 'domain':
      return { last_observed: rec.checked_at || null, last_verified: ['VERIFIED', 'VERIFIED_ALIAS'].includes(rec.status) ? rec.checked_at : null, source: rec.final_url || null, state: ['VERIFIED', 'VERIFIED_ALIAS'].includes(rec.status) ? byCycle(rec.checked_at, n) : FRESHNESS.UNKNOWN };
    default:
      throw new Error(`freshnessOf: unknown kind ${kind}`);
  }
}
