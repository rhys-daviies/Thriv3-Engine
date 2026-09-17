/**
 * Reading and writing operator reviews of roster gaps.
 *
 * The vocabulary and every rule about what may be stored live in
 * `shared/roster/gapReview.js`; this is the table in front of it. It imports
 * nothing from Evidence, matching or outreach, and nothing in those imports it
 * — see the coupling test.
 */
import db from '../db/client.js';
import { validateReview, retryEligible, reviewStatus } from '../../shared/roster/gapReview.js';

const ROW = `SELECT season, school, sport, disposition, next_action AS nextAction,
                    retry_after AS retryAfter, evidence, reviewed_at AS reviewedAt,
                    reviewed_by_operator_id AS reviewedByOperatorId,
                    previous_disposition AS previousDisposition,
                    previous_reviewed_at AS previousReviewedAt
             FROM roster_gap_reviews`;

export const gapKey = (school, sport) => `${school}||${sport}`;

/** Every review for one season, keyed `School||Sport`. */
export function reviewsForSeason(season) {
  const out = new Map();
  for (const r of db.prepare(`${ROW} WHERE season = ?`).all(Number(season))) {
    out.set(gapKey(r.school, r.sport), r);
  }
  return out;
}

/** One review, or null. Null IS the answer: it means nobody has looked. */
export function reviewFor(season, school, sport) {
  return db.prepare(`${ROW} WHERE season = ? AND school = ? AND sport = ?`)
    .get(Number(season), school, sport) ?? null;
}

/**
 * Record a decision, carrying the previous one forward as the audit trail.
 *
 * Refuses rather than coerces. A review that cannot be stored is a review
 * somebody needs to look at again, and silently normalising it would put a
 * conclusion in the table that nobody reached.
 */
export function recordReview({
  season, school, sport, disposition, nextAction, retryAfter = null,
  evidence, operatorId = null, now = new Date(),
}) {
  const check = validateReview({ disposition, nextAction, retryAfter, evidence });
  if (!check.ok) return { ok: false, reason: check.reason, review: null };
  const prev = reviewFor(season, school, sport);
  db.prepare(`
    INSERT INTO roster_gap_reviews
      (season, school, sport, disposition, next_action, retry_after, evidence,
       reviewed_at, reviewed_by_operator_id, previous_disposition, previous_reviewed_at)
    VALUES (@season, @school, @sport, @disposition, @nextAction, @retryAfter, @evidence,
            @reviewedAt, @operatorId, @previousDisposition, @previousReviewedAt)
    ON CONFLICT(season, school, sport) DO UPDATE SET
      disposition = excluded.disposition,
      next_action = excluded.next_action,
      retry_after = excluded.retry_after,
      evidence = excluded.evidence,
      reviewed_at = excluded.reviewed_at,
      reviewed_by_operator_id = excluded.reviewed_by_operator_id,
      previous_disposition = excluded.previous_disposition,
      previous_reviewed_at = excluded.previous_reviewed_at
  `).run({
    season: Number(season),
    school,
    sport,
    disposition,
    nextAction,
    retryAfter: retryAfter ?? null,
    evidence: String(evidence).trim(),
    reviewedAt: now.toISOString(),
    operatorId,
    previousDisposition: prev?.disposition ?? null,
    previousReviewedAt: prev?.reviewedAt ?? null,
  });
  return { ok: true, reason: null, review: reviewFor(season, school, sport) };
}

/**
 * Withdraw a review, keeping what it said.
 *
 * A programme that is acquired has not had its review DISPROVED — Northwood's
 * `SOURCE_NOT_AVAILABLE` was accurate when it was written, and L7I changed the
 * generator rather than the fact. So clearing a review is a deliberate operator
 * act, never a side effect of an acquisition succeeding, and the conclusion
 * that was withdrawn stays readable in `previous_disposition`.
 */
export function withdrawReview({ season, school, sport, evidence, operatorId = null, now = new Date() }) {
  const prev = reviewFor(season, school, sport);
  if (!prev) return { ok: false, reason: 'nothing to withdraw', review: null };
  if (!String(evidence ?? '').trim()) return { ok: false, reason: 'withdrawing a review must record why', review: null };
  db.prepare('DELETE FROM roster_gap_reviews WHERE season = ? AND school = ? AND sport = ?')
    .run(Number(season), school, sport);
  return { ok: true, reason: null, withdrew: prev };
}

export { retryEligible, reviewStatus };
