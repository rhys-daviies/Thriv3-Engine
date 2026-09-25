/**
 * Whether a programme is fielded in a given season.
 *
 * ---------------------------------------------------------------------------
 * WHY `colleges.active` IS NOT ENOUGH, AND WHY IT IS ALSO NOT WRONG.
 *
 * L7O expected to find `colleges.active` unusable because it looked
 * institution-level. It is not: `colleges` is keyed `(name, sport)` — one row
 * per programme — and Montana State Billings has carried `mens-soccer active=0`
 * beside `womens-soccer active=1` under one unitid for some time. Switching a
 * men's programme off has never been able to touch the women's one.
 *
 * What a boolean cannot do is tell the truth about time. Wisconsin-Oshkosh's own
 * navigation reads "Soccer (Coming in 2027)": the programme is not fielded in
 * 2026 and is fielded from 2027, and `active = 0` would record that as gone
 * forever. Anna Maria closed after the 2025-26 academic year and genuinely
 * played through Fall 2025 — a boolean cannot hold "not any more" without also
 * erasing "used to".
 *
 * So `colleges.active` keeps its meaning — this programme is not a recruiting
 * destination at all — and this file answers the narrower, temporal question.
 * Both must agree before a programme is offered for a season.
 *
 * ---------------------------------------------------------------------------
 * SPARSE BY DESIGN. ABSENCE MEANS ACTIVE.
 *
 * There is no ACTIVE row and there will not be one: writing 1,754 of them to say
 * "as before" would make the table's size meaningless and every future read a
 * join that can silently lose programmes. A row exists only where a person has
 * decided something that departs from "active", and everything without one keeps
 * exactly the behaviour it had.
 *
 * UNKNOWN likewise gets no row. Bryn Athyn's status is genuinely undecided, and
 * a record saying "undecided" would be indistinguishable in effect from no
 * record while implying a decision had been made. Absence of proof is not proof,
 * so an undecided programme stays counted.
 *
 * ---------------------------------------------------------------------------
 * SEASONS, NOT DATES.
 *
 * A season is the year its autumn begins — `span(2026)` is `2026-27`, and a
 * roster fetched in Fall 2025 is `season = '2025'`. That is the unit the whole
 * pipeline already speaks, and it avoids arguing about the day a season starts.
 *
 * Anna Maria is the case that makes this matter. The college "ceased academic
 * operations at the end of the Spring 2026 semester" — the end of the 2025-26
 * academic year, which is season 2025. Soccer is played in the autumn, so its
 * final competitive season was Fall 2025, and `active_to_season` is 2025 rather
 * than 2026. The institution existed during part of calendar 2026 and its soccer
 * programme did not play a 2026 season; both statements are true and the model
 * has to keep them apart.
 */

/**
 * The season the product is currently recruiting for.
 *
 * One constant, because "is this programme active" is meaningless without one
 * and every consumer was previously asking a question with no clock in it.
 * Matches `CANDIDATE_SEASON` and `QUEUE_SEASON`; when the roadmap moves to 2027
 * this is the line that moves.
 */
export const TARGET_SEASON = 2026;

/** What a person decided about a programme's seasons. Sparse: no ACTIVE value. */
export const PROGRAMME_STATUS = Object.freeze({
  /** Not fielded. Bounded by `activeToSeason` where it once was. */
  NOT_ACTIVE: 'NOT_ACTIVE',
  /** Not fielded yet; `activeFromSeason` is when it starts. */
  FUTURE: 'FUTURE',
});

/** Why, because four causes of "not active" are four different follow-ups. */
export const STATUS_REASON = Object.freeze({
  /** The institution stopped operating. */
  INSTITUTION_CLOSED: 'INSTITUTION_CLOSED',
  /** The institution operates and does not field this programme. */
  NOT_SPONSORED: 'NOT_SPONSORED',
  /** The institution merged or renamed and this programme did not carry over. */
  IDENTITY_TRANSITION: 'IDENTITY_TRANSITION',
  /** Announced, with a start season. */
  LAUNCHING: 'LAUNCHING',
});

const ALLOWED_REASONS = Object.freeze({
  [PROGRAMME_STATUS.NOT_ACTIVE]: [
    STATUS_REASON.INSTITUTION_CLOSED,
    STATUS_REASON.NOT_SPONSORED,
    STATUS_REASON.IDENTITY_TRANSITION,
  ],
  [PROGRAMME_STATUS.FUTURE]: [STATUS_REASON.LAUNCHING],
});

/**
 * A season year, or null when there is not one.
 *
 * `Number(null)` is 0 and 0 is finite, so a plain `Number.isFinite` check reads
 * a missing bound as the year zero — a FUTURE with no start season then looks
 * like one that started long ago. Null and absent are checked before coercion.
 */
function seasonOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Is this programme fielded in this season?
 *
 * `status` is the row, or null when nobody has decided anything.
 *
 *   no row                      → true. The default is unchanged behaviour.
 *   NOT_ACTIVE, activeTo = T    → true for season <= T, false after.
 *   NOT_ACTIVE, activeTo = null → false in every season. Never fielded, which
 *                                 is the truthful reading for a programme the
 *                                 institution has never sponsored.
 *   FUTURE, activeFrom = F      → false before F, true from F onward.
 *
 * History is answered by the same function, so asking about 2024 gives 2024's
 * answer and not today's: Anna Maria was fielded in 2024 and is not in 2026.
 */
export function activeForSeason(status, season) {
  if (!status) return true;
  const s = seasonOrNull(season);
  if (s == null) return true;
  if (status.status === PROGRAMME_STATUS.FUTURE) {
    const from = seasonOrNull(status.activeFromSeason);
    if (from == null) return true;             // unbounded future is not a bound
    return s >= from;
  }
  if (status.status === PROGRAMME_STATUS.NOT_ACTIVE) {
    const to = seasonOrNull(status.activeToSeason);
    if (to == null) return false;              // never fielded
    return s <= to;
  }
  return true;
}

/** A status a caller may store, or an explicit reason it cannot be stored. */
export function validateStatus({
  status, reason, activeFromSeason = null, activeToSeason = null, evidence = null, sourceUrl = null,
} = {}) {
  if (!PROGRAMME_STATUS[status]) {
    return { ok: false, reason: `unknown status ${JSON.stringify(status ?? null)}` };
  }
  if (!STATUS_REASON[reason]) {
    return { ok: false, reason: `unknown reason ${JSON.stringify(reason ?? null)}` };
  }
  if (!ALLOWED_REASONS[status].includes(reason)) {
    return {
      ok: false,
      reason: `${status} may not carry ${reason} — allowed: ${ALLOWED_REASONS[status].join(', ')}`,
    };
  }
  if (status === PROGRAMME_STATUS.FUTURE && seasonOrNull(activeFromSeason) == null) {
    return { ok: false, reason: 'FUTURE needs a start season, or it is a permanent exclusion in disguise' };
  }
  if (status === PROGRAMME_STATUS.NOT_ACTIVE && activeFromSeason != null) {
    return { ok: false, reason: 'NOT_ACTIVE is bounded by activeToSeason, not activeFromSeason' };
  }
  if (activeToSeason != null && seasonOrNull(activeToSeason) == null) {
    return { ok: false, reason: 'activeToSeason must be a season year' };
  }
  /*
   * A programme leaves the active universe only on first-party evidence, and the
   * sentence that justified it travels with the row. A status without one is a
   * decision nobody can audit.
   */
  if (!String(evidence ?? '').trim()) {
    return { ok: false, reason: 'a status must record the evidence behind it' };
  }
  if (!String(sourceUrl ?? '').trim()) {
    return { ok: false, reason: 'a status must cite a first-party source' };
  }
  return { ok: true, reason: null };
}

export const STATUSES = Object.freeze(Object.keys(PROGRAMME_STATUS));
export const REASONS = Object.freeze(Object.keys(STATUS_REASON));
export const allowedReasonsFor = (s) => Object.freeze([...(ALLOWED_REASONS[s] ?? [])]);
