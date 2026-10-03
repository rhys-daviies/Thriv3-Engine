import crypto from 'node:crypto';
import { serviceError } from './matchmakingService.js';
import {
  OBSERVATION_CATEGORY, OBSERVATION_KIND, CATEGORY_OF_KIND, OBSERVATION_SOURCE,
  CLASSIFIER_METHOD, REVIEW_STATE, CORRECTION,
  isObservationKind, isObservationSource, isClassifierMethod, isReviewState, isCorrection,
  categoryOf, validateAttributes,
} from '../../../shared/recruitingObservations.js';

export {
  OBSERVATION_CATEGORY, OBSERVATION_KIND, OBSERVATION_SOURCE,
  CLASSIFIER_METHOD, REVIEW_STATE, CORRECTION, categoryOf,
};

/**
 * =============================================================================
 * RECORDING WHAT HAPPENED — A9.6.
 *
 * The write and read boundary for `recruiting_observations`. Everything here
 * is OBSERVATION. Nothing in this module is read by the matchmaking engine,
 * nothing it writes reaches a weight, a gate or a rank, and the `AA` suite
 * recomputes V2 over a database full of these rows to prove it.
 * =============================================================================
 */

const safeParse = (s) => {
  if (s === null || s === undefined) return null;
  try { return JSON.parse(s); } catch { return null; }
};

const hydrate = (row) => (row ? {
  ...row,
  attributes: safeParse(row.attributes),
  category: categoryOf(row.kind),
} : null);

/**
 * A MACHINE CLASSIFICATION IS UNREVIEWED; A PERSON'S IS THE REVIEW.
 *
 * An operator recording "the coach said the spot is gone" has already made the
 * judgement a review would make, and asking them to confirm their own entry
 * would be ceremony. A rule or a model has not, and its row says so until
 * somebody looks.
 */
const defaultReviewState = (method) => (
  method === CLASSIFIER_METHOD.MANUAL ? REVIEW_STATE.CONFIRMED : REVIEW_STATE.UNREVIEWED
);

/**
 * Record one observation.
 *
 * IDEMPOTENT ON A PROVIDER'S OWN EVENT IDENTITY, and only there — §O. A
 * provider redelivering a webhook must not produce a second reply; a coach who
 * says "still interested" in March and again in June said it twice and both
 * are real. So the dedupe key is the provider's, never a hash of the content.
 */
export function recordObservation(db, {
  athleteId, collegeName, sport, collegeId = null,
  coachId = null, outreachSendId = null, matchmakingSelectionId = null,
  kind, attributes = null, note = null,
  source, classifierMethod = CLASSIFIER_METHOD.MANUAL,
  classifierVersion = null, confidence = null,
  reviewState = null, reviewedByOperatorId = null, reviewedAt = null,
  correctsObservationId = null, correction = null,
  providerEventId = null,
  observedAt = null, now = new Date().toISOString(), id = crypto.randomUUID(),
} = {}) {
  if (!isObservationKind(kind)) {
    throw serviceError('OBSERVATION_KIND_UNKNOWN',
      `Unknown observation kind "${kind}". A new one needs a name in `
      + 'shared/recruitingObservations.js before it can be recorded.');
  }
  if (!isObservationSource(source)) {
    throw serviceError('OBSERVATION_SOURCE_UNKNOWN',
      `Unknown observation source "${source}". An unattributed observation cannot be weighed.`);
  }
  if (!isClassifierMethod(classifierMethod)) {
    throw serviceError('CLASSIFIER_METHOD_UNKNOWN',
      `Unknown classifier method "${classifierMethod}".`);
  }

  const problems = validateAttributes(kind, attributes);
  if (problems.length) {
    throw serviceError('OBSERVATION_ATTRIBUTES_INVALID', problems.join('; '));
  }

  if (!athleteId || !collegeName || !sport) {
    throw serviceError('OBSERVATION_SUBJECT_REQUIRED',
      'An observation needs an athlete and a programme, in the (college_name, sport) '
      + 'spelling every other programme surface uses.');
  }

  const state = reviewState ?? defaultReviewState(classifierMethod);
  if (!isReviewState(state)) throw serviceError('REVIEW_STATE_UNKNOWN', `Unknown review state "${state}".`);

  /* -- the correction pair, both or neither -------------------------------- */
  if ((correctsObservationId === null) !== (correction === null)) {
    throw serviceError('CORRECTION_INCOMPLETE',
      'A correction must say both which observation it corrects and whether it '
      + 'supersedes or retracts it.');
  }
  if (correction !== null) {
    if (!isCorrection(correction)) {
      throw serviceError('CORRECTION_UNKNOWN', `Unknown correction "${correction}".`);
    }
    const target = db.prepare('SELECT * FROM recruiting_observations WHERE id = ?')
      .get(correctsObservationId);
    if (!target) {
      throw serviceError('CORRECTION_TARGET_NOT_FOUND',
        `No observation ${correctsObservationId} to correct.`);
    }
    /**
     * A correction belongs to the same subject. Correcting across athletes or
     * programmes is not a correction; it is a second, unrelated claim wearing
     * the first one's identity.
     */
    if (target.athlete_id !== athleteId
      || target.college_name !== collegeName || target.sport !== sport) {
      throw serviceError('CORRECTION_SUBJECT_MISMATCH',
        'A correction must be about the same athlete and the same programme as '
        + 'the observation it corrects.');
    }
  }

  /* -- anchors are checked, never assumed ---------------------------------- */
  if (outreachSendId) {
    const send = db.prepare('SELECT athlete_id, college_name, sport FROM outreach_send WHERE id = ?')
      .get(outreachSendId);
    if (!send) throw serviceError('SEND_NOT_FOUND', `No outreach_send ${outreachSendId}.`);
    if (send.athlete_id !== athleteId) {
      throw serviceError('OBSERVATION_SEND_MISMATCH',
        'That message belongs to a different athlete.');
    }
    /**
     * Only checked where the message FROZE a programme. 27 of the 41 sends on
     * file never did, and refusing to attach an observation to them would make
     * the historical case unrecordable for a defect those rows already have.
     */
    if (send.college_name && send.sport
      && (send.college_name !== collegeName || send.sport !== sport)) {
      throw serviceError('OBSERVATION_SEND_PROGRAMME_MISMATCH',
        `That message was written for ${send.college_name} (${send.sport}).`);
    }
  }

  if (matchmakingSelectionId) {
    const sel = db.prepare('SELECT player_id, college_name, sport FROM matchmaking_selections WHERE id = ?')
      .get(matchmakingSelectionId);
    if (!sel) throw serviceError('SELECTION_NOT_FOUND', `No matchmaking selection ${matchmakingSelectionId}.`);
    if (sel.player_id !== athleteId) {
      throw serviceError('OBSERVATION_SELECTION_MISMATCH',
        'That selection belongs to a different athlete.');
    }
    if (sel.college_name !== collegeName || sel.sport !== sport) {
      throw serviceError('OBSERVATION_SELECTION_PROGRAMME_MISMATCH',
        `That selection is for ${sel.college_name} (${sel.sport}).`);
    }
  }

  /* -- §O: a provider redelivering is not a second observation ------------- */
  if (providerEventId) {
    const seen = db.prepare('SELECT * FROM recruiting_observations WHERE provider_event_id = ?')
      .get(providerEventId);
    if (seen) return { changed: false, observation: hydrate(seen) };
  }

  const row = {
    id,
    athlete_id: athleteId,
    college_name: collegeName,
    sport,
    college_id: collegeId,
    coach_id: coachId,
    outreach_send_id: outreachSendId,
    matchmaking_selection_id: matchmakingSelectionId,
    kind,
    attributes: attributes ? JSON.stringify(attributes) : null,
    note,
    source,
    classifier_method: classifierMethod,
    classifier_version: classifierVersion,
    confidence,
    review_state: state,
    reviewed_by_operator_id: reviewedByOperatorId,
    reviewed_at: reviewedAt,
    corrects_observation_id: correctsObservationId,
    correction,
    provider_event_id: providerEventId,
    // WHEN IT HAPPENED, defaulting to when we heard — §K. The two differ for
    // anything learned after the fact, and a cycle question keyed on the wrong
    // one is wrong by months.
    observed_at: observedAt ?? now,
    recorded_at: now,
  };

  db.prepare(`
    INSERT INTO recruiting_observations
      (id, athlete_id, college_name, sport, college_id, coach_id, outreach_send_id,
       matchmaking_selection_id, kind, attributes, note, source, classifier_method,
       classifier_version, confidence, review_state, reviewed_by_operator_id, reviewed_at,
       corrects_observation_id, correction, provider_event_id, observed_at, recorded_at)
    VALUES
      (@id, @athlete_id, @college_name, @sport, @college_id, @coach_id, @outreach_send_id,
       @matchmaking_selection_id, @kind, @attributes, @note, @source, @classifier_method,
       @classifier_version, @confidence, @review_state, @reviewed_by_operator_id, @reviewed_at,
       @corrects_observation_id, @correction, @provider_event_id, @observed_at, @recorded_at)
  `).run(row);

  return { changed: true, observation: hydrate(row) };
}

/**
 * Record a human judgement about a machine classification.
 *
 * THE ONLY WRITE THAT TOUCHES AN EXISTING ROW, and the trigger permits exactly
 * the three columns it writes. Rejecting an observation does not delete or
 * rewrite it: the claim stays legible and the projection stops counting it.
 */
export function reviewObservation(db, {
  observationId, state, operatorId = null, now = new Date().toISOString(),
} = {}) {
  if (state !== REVIEW_STATE.CONFIRMED && state !== REVIEW_STATE.REJECTED) {
    throw serviceError('REVIEW_STATE_INVALID',
      'A review confirms or rejects. Returning something to UNREVIEWED would erase '
      + 'the fact that it was looked at.');
  }
  const row = db.prepare('SELECT * FROM recruiting_observations WHERE id = ?').get(observationId);
  if (!row) throw serviceError('OBSERVATION_NOT_FOUND', `No observation ${observationId}.`);

  db.prepare(`
    UPDATE recruiting_observations
       SET review_state = ?, reviewed_by_operator_id = ?, reviewed_at = ?
     WHERE id = ?`).run(state, operatorId, now, observationId);

  return hydrate(db.prepare('SELECT * FROM recruiting_observations WHERE id = ?').get(observationId));
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/** Everything observed about one athlete and one programme, oldest first. */
export function observationsFor(db, { athleteId, collegeName, sport } = {}) {
  return db.prepare(`
    SELECT * FROM recruiting_observations
     WHERE athlete_id = ? AND college_name = ? AND sport = ?
     ORDER BY observed_at, id`).all(athleteId, collegeName, sport).map(hydrate);
}

/** Everything that came of one selection. */
export function observationsForSelection(db, selectionId) {
  return db.prepare(`
    SELECT * FROM recruiting_observations
     WHERE matchmaking_selection_id = ?
     ORDER BY observed_at, id`).all(selectionId).map(hydrate);
}

/**
 * One programme across time, every athlete — the §T coach-intelligence read.
 *
 * ATHLETE-INDEPENDENT BY CONSTRUCTION. It selects only the recruiting-
 * intelligence kinds, so a programme's stated needs can be read without
 * dragging in how any particular athlete fared with it. That separation is the
 * whole point of §C, and a read that mixed them would be the first step to a
 * single "coach interest score".
 */
export function programmeIntelligence(db, { collegeName, sport, since = null } = {}) {
  const kinds = Object.entries(CATEGORY_OF_KIND)
    .filter(([, c]) => c === OBSERVATION_CATEGORY.RECRUITING_INTELLIGENCE)
    .map(([k]) => k);
  const placeholders = kinds.map(() => '?').join(', ');
  const args = [collegeName, sport, ...kinds];
  let sql = `
    SELECT * FROM recruiting_observations
     WHERE college_name = ? AND sport = ?
       AND kind IN (${placeholders})`;
  if (since) { sql += ' AND observed_at >= ?'; args.push(since); }
  sql += ' ORDER BY observed_at, id';
  return db.prepare(sql).all(...args).map(hydrate);
}

/* -------------------------------------------------------------------------- */
/* §Q — the current-state projection                                          */
/* -------------------------------------------------------------------------- */

/**
 * WHAT IS TRUE NOW, DERIVED — never stored.
 *
 * `engagement_rollup` is this codebase's precedent and the schema says why a
 * stored status is wrong: a derived fact written into a column "is only true
 * while something keeps writing [it]: the first missed tick leaves the column
 * asserting a falsehood every screen repeats." So this is computed from the
 * ledger on every call and is rebuildable from nothing but the rows.
 *
 * THREE AXES, NOT ONE NUMBER — §C. Each category projects independently, and
 * there is deliberately no combined score: "the coach is keen" and "the athlete
 * has gone off it" are both true at once, often.
 *
 * WHAT IS EXCLUDED, AND WHY EACH:
 *   REJECTED     a person looked and said it was wrong
 *   RETRACTED    a later row says it should never have been recorded
 *   SUPERSEDED   a later row replaced it — still true of its moment, which is
 *                why `observationsFor` keeps returning it, but not current
 *
 * `unreviewed: false` additionally excludes machine classifications nobody has
 * checked, which is what §I's review state exists for.
 */
export function currentState(db, { athleteId, collegeName, sport, unreviewed = true } = {}) {
  const rows = observationsFor(db, { athleteId, collegeName, sport });

  const corrected = new Map();
  for (const r of rows) {
    if (r.corrects_observation_id && r.correction) {
      corrected.set(r.corrects_observation_id, r.correction);
    }
  }

  const effective = rows.filter((r) => {
    if (r.review_state === REVIEW_STATE.REJECTED) return false;
    if (corrected.has(r.id)) return false;
    if (!unreviewed && r.review_state === REVIEW_STATE.UNREVIEWED) return false;
    return true;
  });

  const latest = (category) => {
    const inCategory = effective.filter((r) => categoryOf(r.kind) === category);
    return inCategory.length ? inCategory[inCategory.length - 1] : null;
  };

  const pick = (o) => (o ? {
    kind: o.kind,
    attributes: o.attributes,
    observedAt: o.observed_at,
    reviewState: o.review_state,
    classifierMethod: o.classifier_method,
    observationId: o.id,
  } : null);

  return {
    athleteId,
    collegeName,
    sport,
    /**
     * NULL MEANS NOBODY HAS OBSERVED ANYTHING — §Z. It is not a negative, not
     * a decline and not "not interested". No reply is silence, and silence has
     * many explanations; the projection says `null` and lets the reader know
     * that is what it means.
     */
    programmeInterest: pick(latest(OBSERVATION_CATEGORY.PROGRAMME_INTEREST)),
    recruitingNeed: pick(latest(OBSERVATION_CATEGORY.RECRUITING_INTELLIGENCE)),
    athleteOutcome: pick(latest(OBSERVATION_CATEGORY.ATHLETE_OUTCOME)),
    observationCount: rows.length,
    effectiveCount: effective.length,
  };
}

/* -------------------------------------------------------------------------- */
/* §R — the funnel, DEFINED AND NOT SCORED                                    */
/* -------------------------------------------------------------------------- */

/**
 * THE STAGES, MEASURED INDEPENDENTLY AND NEVER MULTIPLIED TOGETHER.
 *
 * §R is explicit that this must not become a score and that not every
 * recruitment passes through every stage — a coach who rings the family after
 * one email produces a CALL with no REPLY, and a funnel that required
 * monotonic progress would record that as a failure at stage two.
 *
 * So each stage is an INDEPENDENT BOOLEAN over the evidence held, read from
 * the record that owns it: SELECTED and SENT from the provenance chain,
 * REPLIED from `outreach_send_event`, the rest from this ledger. Nothing is
 * inferred downward from a later stage and nothing is weighted.
 */
export const FUNNEL_STAGE = Object.freeze({
  SELECTED: 'SELECTED',
  SENT: 'SENT',
  REPLIED: 'REPLIED',
  INTERESTED: 'INTERESTED',
  CALL: 'CALL',
  OFFER: 'OFFER',
  COMMITTED: 'COMMITTED',
});

const K = OBSERVATION_KIND;

/** Which observation kinds EVIDENCE each stage. Positive evidence only. */
export const FUNNEL_EVIDENCE = Object.freeze({
  [FUNNEL_STAGE.INTERESTED]: [K.INTERESTED, K.POSITIVE_REPLY, K.REQUESTED_FILM,
    K.REQUESTED_TRANSCRIPT, K.ROSTER_PLACE_OFFERED, K.FINANCIAL_OFFER],
  [FUNNEL_STAGE.CALL]: [K.REQUESTED_CALL],
  [FUNNEL_STAGE.OFFER]: [K.ROSTER_PLACE_OFFERED, K.FINANCIAL_OFFER],
  [FUNNEL_STAGE.COMMITTED]: [K.COMMITTED],
});
