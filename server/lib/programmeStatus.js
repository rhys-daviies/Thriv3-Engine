/**
 * The one owner of "is this programme fielded in this season".
 *
 * Consumers ask this module; they do not query `programme_status` themselves and
 * they do not re-implement the temporal rule. L7J's lesson was that a policy
 * living in two places is a policy that disagrees with itself, and this one has
 * six consumers.
 *
 * `shared/roster/programmeStatus.js` owns the vocabulary and `activeForSeason`;
 * this is the table in front of it plus the one narrow write path.
 */
import db from '../db/client.js';
import {
  activeForSeason, validateStatus, PROGRAMME_STATUS, STATUS_REASON, TARGET_SEASON,
} from '../../shared/roster/programmeStatus.js';

const ROW = `SELECT school, sport, status, reason,
                    active_from_season AS activeFromSeason,
                    active_to_season AS activeToSeason,
                    evidence, source_url AS sourceUrl,
                    recorded_at AS recordedAt,
                    recorded_by_operator_id AS recordedByOperatorId
             FROM programme_status`;

export const programmeKey = (school, sport) => `${school}||${sport}`;

/** Every recorded status, keyed `School||Sport`. Sparse — most programmes absent. */
export function allStatuses() {
  const out = new Map();
  for (const r of db.prepare(ROW).all()) out.set(programmeKey(r.school, r.sport), r);
  return out;
}

/** One status, or null. Null IS the answer: nobody has decided anything. */
export function statusFor(school, sport) {
  return db.prepare(`${ROW} WHERE school = ? AND sport = ?`).get(school, sport) ?? null;
}

/**
 * Is this programme fielded in this season?
 *
 * TWO GATES, AND BOTH MUST AGREE. `colleges.active` says whether the programme
 * is a recruiting destination at all; the status row says whether it is fielded
 * in this particular season. A caller that already holds the college row should
 * pass `collegeActive` so this does not re-read it.
 */
export function programmeActiveForSeason(school, sport, season, { collegeActive = null, statuses = null } = {}) {
  if (collegeActive === 0 || collegeActive === false) return false;
  const status = statuses ? (statuses.get(programmeKey(school, sport)) ?? null) : statusFor(school, sport);
  return activeForSeason(status, season);
}

/** The same question for a row that already carries `active`, for bulk callers. */
export function rowActiveForSeason(row, season, statuses) {
  if (row.active === 0) return false;
  return activeForSeason(statuses.get(programmeKey(row.school ?? row.name, row.sport)) ?? null, season);
}

/**
 * Record a decision. The only write path, and deliberately not generic CRUD.
 *
 * Refuses rather than coerces: a status that cannot be stored is one somebody
 * needs to look at again, and normalising it silently would put a decision in
 * the table that nobody made.
 */
export function recordStatus({
  school, sport, status, reason, activeFromSeason = null, activeToSeason = null,
  evidence, sourceUrl, operatorId = null, now = new Date(),
}) {
  const check = validateStatus({ status, reason, activeFromSeason, activeToSeason, evidence, sourceUrl });
  if (!check.ok) return { ok: false, reason: check.reason, status: null };
  /*
   * A status may only be recorded for a programme the registry actually has.
   * A key outside it is a typo, and a typo here quietly excludes nothing while
   * looking like a decision.
   */
  const known = db.prepare('SELECT active FROM colleges WHERE name = ? AND sport = ?').get(school, sport);
  if (!known) return { ok: false, reason: `${school} / ${sport} is not a registry programme`, status: null };
  db.prepare(`
    INSERT INTO programme_status
      (school, sport, status, reason, active_from_season, active_to_season,
       evidence, source_url, recorded_at, recorded_by_operator_id)
    VALUES (@school, @sport, @status, @reason, @activeFromSeason, @activeToSeason,
            @evidence, @sourceUrl, @recordedAt, @operatorId)
    ON CONFLICT(school, sport) DO UPDATE SET
      status = excluded.status, reason = excluded.reason,
      active_from_season = excluded.active_from_season,
      active_to_season = excluded.active_to_season,
      evidence = excluded.evidence, source_url = excluded.source_url,
      recorded_at = excluded.recorded_at,
      recorded_by_operator_id = excluded.recorded_by_operator_id
  `).run({
    school,
    sport,
    status,
    reason,
    activeFromSeason: activeFromSeason == null ? null : Number(activeFromSeason),
    activeToSeason: activeToSeason == null ? null : Number(activeToSeason),
    evidence: String(evidence).trim(),
    sourceUrl: String(sourceUrl).trim(),
    recordedAt: now.toISOString(),
    operatorId,
  });
  return { ok: true, reason: null, status: statusFor(school, sport) };
}

/**
 * Filter college rows to those fielded in a season.
 *
 * For callers that already hold `SELECT * FROM colleges WHERE active = 1` and
 * need the temporal half of the question too. One query for the whole sparse
 * table, then a lookup per row — the alternative is a per-row query in a loop
 * over 1,200 programmes.
 */
export function activeCollegesForSeason(rows, season = TARGET_SEASON) {
  const statuses = allStatuses();
  return rows.filter((r) => activeForSeason(statuses.get(programmeKey(r.name ?? r.school, r.sport)) ?? null, season));
}

export { activeForSeason, PROGRAMME_STATUS, STATUS_REASON, TARGET_SEASON };
