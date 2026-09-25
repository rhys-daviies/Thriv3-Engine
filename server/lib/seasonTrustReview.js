import db from '../db/client.js';
import { DISPOSITION_KEYS, EXCLUDING_DISPOSITION, validateTrustRecord } from '../../shared/roster/seasonTrust.js';
import { materialisationState, FRESH } from './recruitingMaterialisation.js';

/**
 * L7ZK — the only place a human disposition may be written.
 *
 * L7ZI separated a machine diagnosis from an operator decision, and L7ZJ wrote
 * fifteen records with that separation held by restraint: the recorder simply
 * did not contain the word `EXCLUDE_FROM_EVIDENCE`. Restraint is not an
 * architecture. This makes it one.
 *
 * ---------------------------------------------------------------------------
 * AN IDENTITY IS REQUIRED, AND IT CANNOT COME FROM THE CALLER.
 *
 * `recordDisposition` refuses without a non-empty `operatorId`, and the caller
 * of record — the route — reads that from the request's authenticated context
 * rather than from its body. A machine job has no such context and therefore
 * cannot produce a disposition at all, which is the difference between an
 * architecture and a comment asking people not to.
 *
 * The two RETAIN rows L7ZJ wrote carry a NULL reviewer. They are grandfathered,
 * they are readable, and they are LEGACY_UNATTRIBUTED rather than attributed to
 * nobody — see `attributionOf`. Nothing here rewrites them, and nothing here
 * can create another like them.
 *
 * ---------------------------------------------------------------------------
 * `reviewed_at` IS SERVER-OWNED for the same reason the identity is. A decision
 * timestamped by whoever submitted it is a decision whose audit trail is
 * whatever they wanted it to be.
 */

/** A legacy row predating the attribution rule, readable but not attributed. */
export const LEGACY_UNATTRIBUTED = 'LEGACY_UNATTRIBUTED';
export const ATTRIBUTED = 'ATTRIBUTED';
export const NOT_REVIEWED = 'NOT_REVIEWED';

/**
 * Why `EXCLUDE_FROM_EVIDENCE` cannot be written for this sport, or null if it
 * can.
 *
 * `recruiting_arrivals` is MATERIALISED from `roster_players`, and an exclusion
 * is honoured immediately by every roster read but not by the derived arrivals
 * — so the moment one is written the two would disagree. L7ZK could only refuse
 * outright; L7ZL gave the materialisation a fingerprint, so the refusal can now
 * ask whether THIS sport's derived data is verifiable instead of assuming it
 * never is.
 *
 * The reason travels with the refusal rather than living in a document.
 */
export function exclusionBlockedReason(sport) {
  /*
   * L7ZL BUILT THE MECHANISM, so this is no longer a blanket refusal. It now
   * asks the one question that matters: can this sport's derived data be
   * verified against the roster the exclusion is about to change?
   *
   * FRESH              -> null. Excluding stales the materialisation, the read
   *                       guard refuses it, and a rebuild restores service. The
   *                       invariant is closed.
   * STALE              -> already diverged; rebuild before deciding, so the
   *                       exclusion is measured against a known state.
   * LEGACY_UNVERIFIED  -> the build predates the mechanism and nothing can say
   *                       what it was derived from. An exclusion here would be
   *                       taken on data nobody can vouch for.
   */
  if (!sport) return 'a sport is required to check materialisation freshness';
  const state = materialisationState(sport);
  if (state.state === FRESH) return null;
  return `EXCLUDE_FROM_EVIDENCE is not available for ${sport}: its recruiting_arrivals `
    + `materialisation is ${state.state}. An exclusion is honoured immediately by roster reads `
    + 'but not by derived recruiting patterns, so the two would disagree. Rebuild with '
    + '`npm run build:recruiting` and decide against a verified materialisation.';
}

/** How a stored record's reviewer should be described, without pretending. */
export function attributionOf(row) {
  if (!row?.disposition) return NOT_REVIEWED;
  return row.reviewed_by_operator_id ? ATTRIBUTED : LEGACY_UNATTRIBUTED;
}

const selectOne = db.prepare(
  'SELECT * FROM roster_season_trust WHERE season = ? AND college_name = ? AND sport = ?');

export function trustRecordFor({ season, college_name: college, sport }) {
  return selectOne.get(String(season), college, sport) ?? null;
}

const UPDATE = `UPDATE roster_season_trust
  SET disposition = @disposition,
      disposition_evidence = @disposition_evidence,
      reviewed_at = @reviewed_at,
      reviewed_by_operator_id = @reviewed_by_operator_id,
      next_action = @next_action,
      previous_disposition = @previous_disposition,
      previous_reviewed_at = @previous_reviewed_at
  WHERE season = @season AND college_name = @college_name AND sport = @sport`;

/**
 * Record one operator decision against an existing trust record.
 *
 * Returns `{ ok, reason, record }`. It refuses rather than throws, following
 * `rosterGapReview.recordReview`, so the route can map a domain refusal to a
 * status code without catching.
 *
 * `expectedDisposition` is optimistic concurrency, in the shape the data
 * already supports rather than a new version column: the caller states what it
 * believed the current disposition to be, and a decision taken against a stale
 * reading is refused instead of silently overwriting a colleague's. `undefined`
 * means the caller did not read first, which is itself refused — an operator
 * decision made without looking is the case this is for.
 */
export function recordDisposition({
  season, college_name: college, sport,
  disposition, evidence, nextAction = null,
  operatorId, expectedDisposition,
  now = new Date(),
} = {}) {
  const bad = (reason) => ({ ok: false, reason, record: null });

  /*
   * IDENTITY FIRST, before anything else is considered. A refusal that
   * validated the payload first would tell an unauthenticated caller which
   * fields it got right, and the answer to "may you decide this" does not
   * depend on how well the request was formed.
   */
  if (typeof operatorId !== 'string' || !operatorId.trim()) {
    return bad('a disposition requires an authenticated operator; none was supplied by the server '
      + 'context. Reviewer identity is never read from the request body.');
  }
  if (!DISPOSITION_KEYS.includes(disposition)) {
    return bad(`disposition must be one of ${DISPOSITION_KEYS.join(', ')}`);
  }
  if (disposition === EXCLUDING_DISPOSITION) {
    const blocked = exclusionBlockedReason(sport);
    if (blocked) return bad(blocked);
  }
  if (!String(evidence ?? '').trim()) {
    return bad('a disposition needs evidence: one sentence saying what was decided and why');
  }

  const existing = trustRecordFor({ season, college_name: college, sport });
  /*
   * It acts on a record, it does not create one. A diagnosis is a measurement
   * and this endpoint has not measured anything; letting it insert would make
   * the operator surface a second, unmeasured source of findings.
   */
  if (!existing) {
    return bad(`no trust record for ${college} / ${sport} / ${season}`);
  }
  if (expectedDisposition === undefined) {
    return bad('expectedDisposition is required: state the disposition you are deciding against, '
      + 'so a decision taken on a stale reading is refused rather than applied');
  }
  const current = existing.disposition ?? null;
  if ((expectedDisposition ?? null) !== current) {
    return bad(`this record has moved since it was read: expected `
      + `${expectedDisposition ?? 'no disposition'}, found ${current ?? 'no disposition'}`);
  }

  const at = now.toISOString();
  const row = {
    season: String(season), college_name: college, sport,
    disposition,
    disposition_evidence: String(evidence).trim(),
    reviewed_at: at,
    reviewed_by_operator_id: operatorId.trim(),
    next_action: nextAction ? String(nextAction).trim() : null,
    // Bounded history, exactly as `roster_gap_reviews` keeps it: the previous
    // conclusion and when it was reached, and nothing older.
    previous_disposition: current,
    previous_reviewed_at: existing.reviewed_at ?? null,
  };

  /* The L7ZI contract still applies, unweakened, on the merged record. */
  const v = validateTrustRecord({ ...existing, ...row });
  if (!v.ok) return bad(v.reason);

  db.prepare(UPDATE).run(row);
  return { ok: true, reason: null, record: trustRecordFor({ season, college_name: college, sport }) };
}
