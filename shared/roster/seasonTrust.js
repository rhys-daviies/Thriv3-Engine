/**
 * L7ZI — whether Evidence should trust a historical programme-season.
 *
 * `roster_players` answers one question: these rows exist. L7ZG found it cannot
 * answer a second one the product now needs — should Evidence believe this
 * season is the season it is stored under? Two programme-seasons are probable
 * duplicate captures with no repair source, thirteen more have no surviving
 * evidence of their season at all, and every one of them must stay in the
 * database for audit, inspection, provenance and future repair.
 *
 * Keep and delete were the only two options. That is why every stage so far has
 * correctly chosen keep, and why nothing has been fixed.
 *
 * ---------------------------------------------------------------------------
 * TWO HALVES, AND THEY MUST NOT BE ONE FIELD.
 *
 * A machine diagnosis is a measurement. An operator disposition is a decision.
 * L7K learned this for roster gaps — raw attempt state, machine diagnosis and
 * operator review are three layers there precisely because collapsing them let
 * a heuristic read as a decision — and the same separation applies here for a
 * sharper reason: an audit heuristic that silently removed a season from
 * Evidence would change product intelligence on a suspicion nobody signed.
 *
 * So `diagnosis` never alters Evidence. Only `disposition` does, and only
 * `EXCLUDE_FROM_EVIDENCE`.
 *
 * ---------------------------------------------------------------------------
 * ABSENCE MEANS NOTHING, DELIBERATELY.
 *
 * A programme-season with no row here behaves exactly as it does today. There
 * is no implicit TRUSTED and no implicit UNPROVEN, because 6,844 programme-
 * seasons would have to be backfilled to make either honest, and a backfill
 * that asserted trust nobody measured would be the same defect this table
 * exists to record.
 */

/**
 * What a measurement concluded. Machine-assigned, never acts on its own.
 *
 * These are the L7ZG audit's own classes, and only the ones it can actually
 * reach on real data. `VERIFIED_DISTINCT` and `HIGH_OVERLAP_BUT_PLAUSIBLE` are
 * absent on purpose: they say a season looks fine, which is what absence
 * already says, and storing 4,980 rows to repeat the default would make this
 * table a copy of the roster.
 */
export const DIAGNOSIS = Object.freeze({
  /** Nothing surviving establishes which season the page was. */
  SEASON_IDENTITY_UNPROVEN: 'SEASON_IDENTITY_UNPROVEN',
  /** The squad resembles a neighbour AND no season evidence survives. */
  PROBABLE_DUPLICATE_CAPTURE: 'PROBABLE_DUPLICATE_CAPTURE',
  /** Surviving evidence names another season and the rows corroborate it. */
  DEFINITE_MISMATCH: 'DEFINITE_MISMATCH',
});

/**
 * What a person decided. The only half that can change Evidence.
 *
 * TWO STATES, and the brief for more was refused deliberately. `RETAIN` and
 * `EXCLUDE_FROM_EVIDENCE` cover every case the roadmap has produced: a
 * diagnosed season kept on the record, a confirmed bad season removed, and a
 * repaired season restored by clearing the exclusion. "Retry discovery" and
 * "repair available" are NEXT ACTIONS rather than trust states — a season is
 * not in a different relationship with Evidence because someone intends to
 * re-fetch it — so they live in `next_action`, free text, exactly as
 * `roster_gap_reviews` keeps them.
 */
export const DISPOSITION = Object.freeze({
  /** Recorded and reviewed, and Evidence continues to read it. */
  RETAIN: 'RETAIN',
  /** Evidence must not read this programme-season. */
  EXCLUDE_FROM_EVIDENCE: 'EXCLUDE_FROM_EVIDENCE',
});

export const DIAGNOSIS_KEYS = Object.freeze(Object.values(DIAGNOSIS));
export const DISPOSITION_KEYS = Object.freeze(Object.values(DISPOSITION));

/** The one disposition that removes a programme-season from Evidence. */
export const EXCLUDING_DISPOSITION = DISPOSITION.EXCLUDE_FROM_EVIDENCE;

/**
 * THE PREDICATE, written once.
 *
 * Every roster read that feeds Evidence appends this. One string rather than a
 * filter per generator: seven kinds each remembering to exclude is seven places
 * for the eighth kind to forget, and the failure would be silent — a claim
 * built from a season the operator excluded, indistinguishable from a correct
 * one.
 *
 * NOT SEASON-RESTRICTED. The mechanism is all-season capable and nothing in the
 * schema says historical; that a current season is never excluded is a
 * disposition policy, not a structural guarantee, and writing the restriction
 * into SQL would mean re-deriving it the first time a current roster is
 * genuinely found to be wrong.
 *
 * `NOT EXISTS` rather than a LEFT JOIN so the shape of the result set cannot
 * change: a roster read must return rows or no rows, never duplicated ones,
 * and a join against a table that later gains a second row per season would do
 * exactly that.
 */
export function trustedRosterPredicate(alias = 'roster_players') {
  return `NOT EXISTS (
    SELECT 1 FROM roster_season_trust t
     WHERE t.college_name = ${alias}.college_name
       AND t.sport        = ${alias}.sport
       AND t.season       = ${alias}.season
       AND t.disposition  = '${EXCLUDING_DISPOSITION}'
  )`;
}

/** Whether a trust row, if any, removes its programme-season from Evidence. */
export function isExcluded(row) {
  return row?.disposition === EXCLUDING_DISPOSITION;
}

/**
 * Check a record before it is written. Returns `{ ok, reason }`.
 *
 * Not a CHECK constraint, for the reason `roster_gap_reviews` gives: the
 * allowed combinations are a contract with an explanation attached, and a
 * constraint can only fail where this can say why.
 */
export function validateTrustRecord(rec) {
  const bad = (reason) => ({ ok: false, reason });
  if (!rec || typeof rec !== 'object') return bad('a trust record must be an object');
  for (const f of ['college_name', 'sport', 'season']) {
    if (!rec[f] || typeof rec[f] !== 'string') return bad(`${f} is required`);
  }
  if (!/^(19|20)\d{2}$/.test(rec.season)) return bad(`season ${JSON.stringify(rec.season)} is not a season`);
  if (rec.diagnosis != null && !DIAGNOSIS_KEYS.includes(rec.diagnosis)) {
    return bad(`diagnosis must be one of ${DIAGNOSIS_KEYS.join(', ')}`);
  }
  if (rec.disposition != null && !DISPOSITION_KEYS.includes(rec.disposition)) {
    return bad(`disposition must be one of ${DISPOSITION_KEYS.join(', ')}`);
  }
  if (rec.diagnosis == null && rec.disposition == null) {
    return bad('a record with neither a diagnosis nor a disposition says nothing');
  }
  /*
   * A DECISION HAS TO SAY WHAT IT SAW. The same rule `roster_gap_reviews`
   * enforces, and for the same reason: an exclusion is the one operation here
   * that changes what the product believes, and one nobody can audit later is
   * worse than no mechanism at all.
   */
  if (rec.disposition != null && !String(rec.disposition_evidence ?? '').trim()) {
    return bad('a disposition needs evidence: one sentence saying what was decided and why');
  }
  if (rec.disposition != null && !String(rec.reviewed_at ?? '').trim()) {
    return bad('a disposition needs reviewed_at');
  }
  return { ok: true, reason: null };
}
