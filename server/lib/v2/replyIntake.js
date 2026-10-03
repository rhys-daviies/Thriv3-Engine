import { appendSendEvent, sendEvents } from '../outreachSend.js';
import { SEND_EVENT_TYPE } from '../../../shared/outreachMessageState.js';
import { sendProvenance } from './outreachProvenance.js';
import { recordObservation } from './recruitingObservations.js';
import {
  OBSERVATION_CATEGORY, CLASSIFIER_METHOD, OBSERVATION_SOURCE, categoryOf,
} from '../../../shared/recruitingObservations.js';

/**
 * =============================================================================
 * A REPLY, AND WHAT IT MEANT — A9.7 §H, §I, §J.
 *
 * ===========================================================================
 * NOTHING IN THIS REPOSITORY INGESTS REPLIES, AND THIS DOES NOT PRETEND TO.
 *
 * There is no IMAP reader, no Gmail watch, no inbound webhook and no provider
 * callback. `contactIntelligence.js` states the position plainly and it is
 * still true: REPLY is "OPERATOR-ASSERTED ONLY ... Nothing ingests replies and
 * nothing classifies them."
 *
 * So A9.7 implements the bounded linkage that genuinely exists — an operator
 * recording that a reply arrived, and separately recording what it meant — and
 * classifies automated ingestion as a NON-BLOCKER for rollout, because Stage 1
 * and Stage 2 are consultant-operated and a consultant reads their own inbox.
 * It is a blocker for Stage 4. See the A9.7 report.
 * ===========================================================================
 *
 * -- TWO ACTS, AND THEY ARE NOT THE SAME ONE -------------------------------
 *
 * `recordReply` says A REPLY ARRIVED. It writes an `outreach_send_event`,
 * which is where this schema has always kept things learned about one message,
 * and it classifies NOTHING. `classifyReply` says WHAT IT MEANT, and writes a
 * `recruiting_observations` row.
 *
 * Keeping them apart is the whole of §Z. A reply arriving is a communication
 * fact with no opinion in it; "the coach is not interested" is a judgement a
 * person made. Collapsing them would mean every reply silently acquired a
 * sentiment nobody assigned, and the first question anybody asked of the data
 * would be answered from it.
 */

/** Where an operator-asserted observation comes from. */
const OPERATOR_SOURCE = 'OPERATOR';

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Record that a reply arrived to one message.
 *
 * NO CLASSIFICATION, NO SENTIMENT, NO BODY. The reply's text stays in the
 * operator's mailbox; §V forbids copying it here and nothing needs it. What is
 * recorded is that this message was answered, and when.
 */
export function recordReply(db, { sendId, observedAt = null, note = null } = {}) {
  const send = db.prepare('SELECT id FROM outreach_send WHERE id = ?').get(sendId);
  if (!send) throw fail('SEND_NOT_FOUND', `No outreach_send ${sendId}.`);

  const event = appendSendEvent({
    sendId,
    type: SEND_EVENT_TYPE.REPLY,
    source: OPERATOR_SOURCE,
    observedAt,
    /**
     * A SHORT OPERATOR NOTE ONLY, AND NEVER THE MESSAGE. `payload` is JSON on
     * an append-only table; putting a coach's words in it would copy private
     * correspondence into an analytics row for no gain, which §V forbids by
     * name. Null unless an operator typed something.
     */
    payload: note ? { note } : null,
  });

  return { event, replied: true };
}

/**
 * Record what a reply MEANT.
 *
 * ---------------------------------------------------------------------------
 * THE SUBJECT IS READ FROM THE MESSAGE, NEVER FROM THE CALLER.
 *
 * A classification names a kind; the athlete, the programme and the selection
 * come from the `outreach_send` row it is about. A caller cannot file "Duke
 * says the spot is gone" against a Clemson pursuit, because it never supplies
 * the programme — the same reasoning `programmeMessages` uses to resolve a
 * recipient from the attempt rather than from the composition.
 * ---------------------------------------------------------------------------
 *
 * MANUAL BY DEFAULT — §J. A classifier may record `AI_ASSISTED` with a version
 * and a confidence, and such a row arrives UNREVIEWED and is excluded from the
 * reviewed projection until a person confirms it. Nothing in this build
 * produces one.
 */
export function classifyReply(db, {
  sendId, kind, attributes = null, note = null,
  classifierMethod = CLASSIFIER_METHOD.MANUAL, classifierVersion = null, confidence = null,
  observedAt = null, requireReply = true,
} = {}) {
  const send = db.prepare(`
    SELECT id, athlete_id, coach_id, college_name, sport, matchmaking_selection_id
      FROM outreach_send WHERE id = ?`).get(sendId);
  if (!send) throw fail('SEND_NOT_FOUND', `No outreach_send ${sendId}.`);

  if (!send.college_name || !send.sport) {
    throw fail('SEND_PROGRAMME_UNKNOWN',
      'That message did not record which programme it was for, so a classification '
      + 'cannot be filed against one.');
  }

  const category = categoryOf(kind);
  if (!category) {
    throw fail('OBSERVATION_KIND_UNKNOWN',
      `Unknown observation kind "${kind}". A new one needs a name in `
      + 'shared/recruitingObservations.js before it can be recorded.');
  }

  /**
   * AN ATHLETE OUTCOME IS NOT A READING OF A COACH'S REPLY — §C.
   *
   * "The athlete withdrew" is a fact about the athlete, learned from the
   * athlete or the family. Accepting it here would let a consultant's
   * impression of a coach's email become a record of what the ATHLETE decided,
   * which is precisely the collapse §C exists to prevent. Those are recorded
   * through the observation API against the programme, with an ATHLETE source.
   */
  if (category === OBSERVATION_CATEGORY.ATHLETE_OUTCOME) {
    throw fail('NOT_A_REPLY_CLASSIFICATION',
      `${kind} is an athlete outcome, not a reading of a coach's reply. Record it `
      + 'as an observation with the athlete as its source.');
  }

  /**
   * A CLASSIFICATION OF A REPLY REQUIRES A REPLY — §Z, enforced rather than
   * documented. Without this, "no reply" could be classified NEGATIVE_REPLY by
   * an operator working down a list, and the data would then contain a coach's
   * refusal that no coach ever made.
   *
   * `requireReply: false` exists for the one honest exception: a coach who
   * rings instead of writing. That produces a classification with no REPLY
   * event, which is true, and the caller has to say so explicitly.
   */
  if (requireReply) {
    const replied = sendEvents(sendId).some((e) => e.type === SEND_EVENT_TYPE.REPLY);
    if (!replied) {
      throw fail('NO_REPLY_RECORDED',
        'No reply has been recorded for that message. Silence is not a negative reply — '
        + 'record the reply first, or say explicitly that this came from a call.');
    }
  }

  return recordObservation(db, {
    athleteId: send.athlete_id,
    collegeName: send.college_name,
    sport: send.sport,
    coachId: send.coach_id,
    outreachSendId: send.id,
    /**
     * CARRIED THROUGH FROM THE MESSAGE, so a classification resolves to the
     * run that caused the outreach without a second lookup — and is NULL for a
     * V1/pre-provenance message, which is truthful rather than broken.
     */
    matchmakingSelectionId: send.matchmaking_selection_id ?? null,
    kind,
    attributes,
    note,
    source: requireReply ? OBSERVATION_SOURCE.COACH_REPLY : OBSERVATION_SOURCE.COACH_CALL,
    classifierMethod,
    classifierVersion,
    confidence,
    observedAt,
  });
}

/**
 * REPLY -> SEND -> SELECTION -> PROGRAMME -> RUN, which is what §H asks to be
 * resolvable.
 *
 * Returns the honest shape for a V1 message too: the reply and the programme
 * are known, and `selection` and `run` are null because no matchmaking run
 * caused it.
 */
export function replyChain(db, sendId) {
  const send = db.prepare(`
    SELECT id, athlete_id, coach_id, college_name, sport, sent_at, state
      FROM outreach_send WHERE id = ?`).get(sendId);
  if (!send) throw fail('SEND_NOT_FOUND', `No outreach_send ${sendId}.`);

  const replies = sendEvents(sendId).filter((e) => e.type === SEND_EVENT_TYPE.REPLY);
  const provenance = sendProvenance(db, sendId);

  return {
    sendId,
    athleteId: send.athlete_id,
    coachId: send.coach_id,
    programme: { collegeName: send.college_name, sport: send.sport },
    replies: replies.map((e) => ({ observedAt: e.observed_at, source: e.source })),
    replied: replies.length > 0,
    provenance: provenance.provenance,
    selection: provenance.selection,
    run: provenance.run,
    classifications: db.prepare(`
      SELECT id, kind, attributes, review_state, classifier_method, observed_at
        FROM recruiting_observations
       WHERE outreach_send_id = ?
       ORDER BY observed_at, id`).all(sendId),
  };
}
