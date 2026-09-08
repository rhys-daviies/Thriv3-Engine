/**
 * How old the roster behind a claim is, and what that permits us to say.
 *
 * Evidence is recomputed at send time, so a stale browser tab cannot put old
 * claims in an email. What can still go stale is the database: rosters are
 * scraped season by season, and a present-tense sentence written from a scrape
 * six months old describes a squad that has since been through a transfer
 * window. That is the one integrity gap logging cannot close after the fact —
 * the coach has already read it.
 *
 * Reuses `roster_players.updated_date`, which every row carries and which the
 * import stamps. No new column: the scrape date is already recorded, it was
 * simply never read.
 *
 * THE THRESHOLDS come from how the pipeline actually behaves, not from round
 * numbers. A roster is a season-scoped artifact re-read once or twice a year,
 * and what invalidates a present-tense claim is a transfer window: the NCAA
 * winter window opens in December and the spring one in April, so a squad read
 * more than about four months ago has plausibly turned over in a way our copy
 * would not know about. Inside ~60 days nothing has had time to move.
 */

import { TEMPORALITY } from './kinds.js';

export const FRESHNESS = Object.freeze({
  /** Read recently enough that the squad cannot have changed much. */
  CURRENT: 'CURRENT',
  /** Same season, but old enough to hedge. Confidence drops one step. */
  ACCEPTABLE: 'ACCEPTABLE',
  /** Spans a transfer window, or the pinned season is behind. Suppressed. */
  STALE: 'STALE',
  /** No scrape date. Reported, and treated as acceptable rather than fresh. */
  UNKNOWN: 'UNKNOWN',
});

/** Nothing has had time to move. */
export const FRESH_DAYS = 60;
/** Beyond this a transfer window has plausibly intervened. */
export const ACCEPTABLE_DAYS = 120;

const DAY = 24 * 60 * 60 * 1000;

/**
 * Age in whole days, or null when there is no usable date.
 *
 * A future timestamp reads as zero rather than negative: clock skew between an
 * import host and this one should not make a roster look fresher than new.
 */
export function ageInDays(updatedAt, now = Date.now()) {
  if (!updatedAt) return null;
  const then = Date.parse(updatedAt);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now - then) / DAY));
}

/**
 * How much a current-roster claim can be trusted.
 *
 * `seasonBehind` is the other half of staleness and the one a date cannot
 * show: a roster read yesterday is useless for a present-tense claim if the
 * season it describes has already finished. Either failing makes it stale.
 */
export function rosterFreshness({ updatedAt, now = Date.now(), seasonBehind = false } = {}) {
  const age = ageInDays(updatedAt, now);
  if (seasonBehind) return { state: FRESHNESS.STALE, ageDays: age, reason: 'the roster season on file is not the season being recruited into' };
  if (age === null) return { state: FRESHNESS.UNKNOWN, ageDays: null, reason: 'no scrape date on these roster rows' };
  if (age <= FRESH_DAYS) return { state: FRESHNESS.CURRENT, ageDays: age, reason: null };
  if (age <= ACCEPTABLE_DAYS) {
    return { state: FRESHNESS.ACCEPTABLE, ageDays: age, reason: `last read ${age} days ago` };
  }
  return { state: FRESHNESS.STALE, ageDays: age, reason: `last read ${age} days ago, which spans a transfer window` };
}

const DOWNGRADE = { HIGH: 'MEDIUM', MEDIUM: 'LOW', LOW: 'LOW' };

/**
 * The freshness policy, applied to one piece of evidence.
 *
 * Returns the confidence it may carry, or null to suppress it entirely.
 *
 *   HISTORICAL and STATIC are exempt. "Your rosters have included three
 *   players from Australia since 2023" is not made wrong by the file being
 *   six months old — the sentence names the window it describes. Ageing that
 *   out would suppress the strongest evidence we have for exactly the reason
 *   it is strong.
 *
 *   CURRENT is suppressed when stale rather than hedged. This is the
 *   conservative call the brief asked for: "you currently have two New
 *   Zealanders on the roster" is either true or it is a false statement about
 *   a coach's own squad, and there is no wording that makes a possibly-departed
 *   player safe to name.
 *
 *   PROJECTED is downgraded rather than suppressed. It is already hedged and
 *   already about a season nobody has played, so a stale source moves it from
 *   a soft claim to one too soft to use — which the confidence floors then
 *   enforce, rather than a second suppression rule doing it here.
 */
export function applyFreshness(spec, confidence, freshness) {
  const t = spec.temporality;
  if (t === TEMPORALITY.HISTORICAL || t === TEMPORALITY.STATIC) return confidence;

  switch (freshness.state) {
    case FRESHNESS.CURRENT:
      return confidence;
    case FRESHNESS.ACCEPTABLE:
    case FRESHNESS.UNKNOWN:
      // Unknown is treated as ageing, not as fine. The reassuring reading of
      // missing provenance is what puts unverified claims in front of people.
      return DOWNGRADE[confidence] ?? confidence;
    case FRESHNESS.STALE:
      return t === TEMPORALITY.CURRENT ? null : DOWNGRADE[confidence] ?? confidence;
    default:
      return confidence;
  }
}

/** Whether this evidence's truth depends on the roster still being current. */
export function isFreshnessSensitive(spec) {
  return spec.temporality === TEMPORALITY.CURRENT
    || spec.temporality === TEMPORALITY.PROJECTED;
}
