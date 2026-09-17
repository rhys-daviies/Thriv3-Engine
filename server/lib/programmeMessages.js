import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { bodyHash } from '../../shared/evidence/sendSnapshot.js';
import { utcNow } from './time.js';

/**
 * THE MESSAGE A CAMPAIGN INTENDS TO SEND, MADE DURABLE — F10b-2.
 *
 * F10b-1 composes; this freezes. The two are separate authorities on purpose:
 * a writer that also composed could not be handed a value to persist, and a
 * value that only existed inside a writer could never be reviewed before it was
 * stored. So this module receives an already-generated composition and writes
 * it down.
 *
 * ---------------------------------------------------------------------------
 * IT DOES NOT COMPOSE, AND IT DOES NOT SEND.
 *
 * Nothing here calls `evidenceFor`, `composeProgrammeMessage`, a transport, a
 * mailbox or a model. It does not move campaign state, attempt state, outreach,
 * outreach_send, budget or suppressions. One table changes.
 * ---------------------------------------------------------------------------
 *
 * WHAT IT DOES DECIDE, because nobody else can: that the composition it was
 * handed was actually made for the attempt it is being filed under, and that
 * the recipient is the one the SERVER resolved rather than one a caller named.
 */

/**
 * Two states, and the transition between them is one-way.
 *
 *   generated  the server composed it; nobody has looked
 *   reviewed   a named operator approved this exact subject and body
 *
 * REVIEWED IS NOT SEND-APPROVED, and the distinction is the reason this module
 * exists rather than a flag on the attempt. It is not a queue, not a schedule,
 * not a mailbox decision and not permission to write to anybody — every stance,
 * suppression, revocation, lifecycle rule, budget and timing check is evaluated
 * afterwards exactly as before. It says that a person read these words and was
 * content with them.
 */
export const MESSAGE_STATE = Object.freeze({
  GENERATED: 'generated',
  REVIEWED: 'reviewed',
});

/**
 * REVIEW IS TERMINAL FOR CONTENT. There is no way back to `generated`, because
 * the only reason to want one is to edit approved words — and an approval that
 * can be reopened silently is not an approval. Regeneration is a separate
 * design nobody has made.
 */
const LEGAL_TRANSITIONS = Object.freeze({
  generated: Object.freeze(['reviewed']),
  reviewed: Object.freeze([]),
});

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const BY_ID = db.prepare('SELECT * FROM programme_messages WHERE id = ?');
const BY_ATTEMPT_STEP = db.prepare(
  'SELECT * FROM programme_messages WHERE programme_contact_attempt_id = ? AND step = ?',
);
const FOR_ATTEMPT = db.prepare(
  'SELECT * FROM programme_messages WHERE programme_contact_attempt_id = ? ORDER BY step',
);

/** The attempt, with the coach it is pursuing and the campaign it belongs to. */
const ATTEMPT = db.prepare(`
  SELECT a.id, a.programme_campaign_id, a.coach_id, a.state AS attempt_state,
         c.email AS coach_email, c.full_name AS coach_name
  FROM programme_contact_attempts a
  JOIN coaches c ON c.id = a.coach_id
  WHERE a.id = ?
`);

/** Rows leave this module with their snapshot parsed, never as stored JSON. */
const parse = (row) => (row ? {
  ...row,
  evidence_snapshot: (() => {
    try { return JSON.parse(row.evidence_snapshot); } catch { return null; }
  })(),
} : null);

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export function programmeMessage(id) {
  return parse(BY_ID.get(id)) ?? null;
}

/** The message for this step of this pursuit, or null. At most one. */
export function messageForStep(programmeContactAttemptId, step) {
  return parse(BY_ATTEMPT_STEP.get(programmeContactAttemptId, step)) ?? null;
}

/** Every message written for one pursuit, in step order. At most two today. */
export function messagesForAttempt(programmeContactAttemptId) {
  return FOR_ATTEMPT.all(programmeContactAttemptId).map(parse);
}

/**
 * ONE MESSAGE, WITH THE CHAIN THAT OWNS IT — F10b-4.
 *
 * A message id on its own is not authority to read one. The row is reachable
 * only through an attempt, which is reachable only through a programme campaign
 * and a campaign, and a read that took the id as sufficient would return
 * content without ever proving the thing it belongs to exists or is coherent.
 * So the chain is resolved in the query rather than assumed, and a message whose
 * chain does not resolve is `null` — which a caller reports as not found.
 *
 * READING IS NOT ACTIONABILITY. The campaign's STATE is returned and not
 * judged: a message written under a campaign that has since closed, or to a
 * programme now set to do-not-contact, is still exactly what was written, and
 * hiding it would destroy the record this table exists to keep. Whether
 * anything further may happen is a live question asked elsewhere.
 */
const WITH_CONTEXT = db.prepare(`
  SELECT m.*,
         a.programme_campaign_id, a.coach_id AS attempt_coach_id, a.state AS attempt_state,
         a.step AS attempt_step,
         pc.campaign_id, pc.college_name, pc.sport, pc.state AS programme_state,
         c.athlete_id, c.state AS campaign_state
  FROM programme_messages m
  JOIN programme_contact_attempts a ON a.id = m.programme_contact_attempt_id
  JOIN programme_campaigns pc ON pc.id = a.programme_campaign_id
  JOIN campaigns c ON c.id = pc.campaign_id
  WHERE m.id = ?
`);

export function programmeMessageWithContext(id) {
  const row = WITH_CONTEXT.get(id);
  if (!row) return null;
  return {
    message: parse(row),
    context: {
      programmeCampaignId: row.programme_campaign_id,
      campaignId: row.campaign_id,
      athleteId: row.athlete_id,
      collegeName: row.college_name,
      sport: row.sport,
      campaignState: row.campaign_state,
      programmeState: row.programme_state,
      attemptState: row.attempt_state,
      attemptStep: row.attempt_step,
      /**
       * The attempt's coach, beside the message's own. They agree by
       * construction — the writer refuses a composition made for anybody else —
       * and a caller scoping a read by programme campaign can check both
       * without a second query.
       */
      attemptCoachId: row.attempt_coach_id,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * FREEZE A COMPOSITION AGAINST THE ATTEMPT THAT ASKED FOR IT.
 *
 * ---------------------------------------------------------------------------
 * THE COMPOSITION IS VERIFIED, NOT TRUSTED.
 *
 * A caller hands over an attempt id and a value. Nothing stops those two being
 * about different people — so the value says what it was composed for, and this
 * checks it against what the attempt says, and refuses if they disagree. Filing
 * an email about Duke under a Clemson pursuit would produce a plausible, wrong
 * artefact that nothing afterwards could detect.
 *
 * AND THE RECIPIENT IS RESOLVED HERE, from the `coaches` row the ATTEMPT names.
 * It is never read out of the composition and never accepted from a caller.
 * F10a found that `/api/outreach/send` takes an address from its request and
 * mints a coach row from whatever arrives; no address reaches this table that
 * way. That old route is unchanged and out of scope — this closes the hole for
 * the new architecture rather than patching the old one.
 * ---------------------------------------------------------------------------
 *
 * IDEMPOTENT ON IDENTICAL CONTENT, AND CLOSED ON DIFFERENT CONTENT. A replay of
 * the same generation returns the existing row untouched. A replay carrying
 * DIFFERENT generated content for a step already written is refused:
 * `MESSAGE_ALREADY_GENERATED`. The stored row is durable evidence of what was
 * composed first, and quietly overwriting it — or quietly returning the old one
 * while reporting success — would each destroy the thing it exists to prove.
 * The comparison is the generated subject and the generated body hash, because
 * the body is derived from the evidence and two identical bodies were composed
 * from the same reasoning.
 *
 * WHAT IT ASSUMES OF ITS CALLER — F10b-3's job, named here so the gap stays
 * visible. It does NOT ask whether this message may be written: no stance, no
 * suppression, no revocation, no lifecycle, no first-touch review, no budget
 * and no timing. The caller must already have authorised it, and this must
 * never become the place that checks — a writer that also gates is two
 * authorities in one function, and one of them eventually gets skipped.
 *
 * @param {string} args.programmeContactAttemptId
 * @param {object} args.composition a `composeProgrammeMessage` value.
 * @returns {{created: boolean, message: object}}
 */
export function createProgrammeMessage({
  programmeContactAttemptId, composition, at = utcNow(),
} = {}) {
  const attempt = ATTEMPT.get(programmeContactAttemptId);
  if (!attempt) {
    throw fail('CONTACT_ATTEMPT_NOT_FOUND', `No contact attempt ${programmeContactAttemptId}`);
  }

  const composedFor = composition?.composedFor;
  if (!composedFor) {
    throw fail(
      'COMPOSITION_NOT_ATTRIBUTED',
      'This composition does not say which pairing it was made for, so it cannot be filed '
      + 'against a pursuit. Only a campaign composition may be persisted.',
    );
  }
  if (composedFor.programmeCampaignId !== attempt.programme_campaign_id
    || composedFor.coachId !== attempt.coach_id) {
    throw fail(
      'COMPOSITION_ATTEMPT_MISMATCH',
      'This message was composed for a different coach or programme campaign than the attempt '
      + 'it is being filed under. Nothing was written.',
    );
  }

  const step = composition.step;
  if (!Number.isInteger(step) || step < 1) {
    throw fail(
      'INVALID_MESSAGE_STEP',
      `A message's step is a whole number from 1 upwards; got ${JSON.stringify(step)}. It is `
      + 'derived by the composer from campaign history and is never supplied.',
    );
  }

  /**
   * ALREADY WRITTEN. Identical generation replays; different generation is an
   * integrity refusal. See the note above on why neither may be silent.
   */
  const existing = BY_ATTEMPT_STEP.get(programmeContactAttemptId, step);
  if (existing) {
    const same = existing.generated_subject === composition.subject
      && existing.generated_body_hash === bodyHash(composition.body);
    if (!same) {
      throw fail(
        'MESSAGE_ALREADY_GENERATED',
        `A message has already been generated for step ${step} of this pursuit, and this `
        + 'composition is not the same one. The stored message is the record of what was '
        + 'written first and is not overwritten.',
      );
    }
    return { created: false, message: parse(existing) };
  }

  const row = {
    id: randomUUID(),
    programme_contact_attempt_id: programmeContactAttemptId,
    step,
    coach_id: attempt.coach_id,
    /** The SERVER's address for the coach this pursuit names. Never a caller's. */
    recipient_email: attempt.coach_email,

    generated_subject: composition.subject,
    generated_body: composition.body,
    // Equal at creation. `subject`/`body` are what a person may change.
    subject: composition.subject,
    body: composition.body,
    generated_body_hash: composition.bodyHash,
    body_hash: composition.bodyHash,

    evidence_snapshot: JSON.stringify(composition.evidence ?? {}),
    body_source: composition.bodySource ?? null,
    structure: composition.structure ?? null,
    policy_version: composition.policyVersion,
    sequence_policy_version: composition.sequencePolicyVersion ?? null,

    state: MESSAGE_STATE.GENERATED,
    generated_at: at,
    updated_at: at,
    reviewed_by_operator_id: null,
    reviewed_at: null,
  };

  db.prepare(`
    INSERT INTO programme_messages (
      id, programme_contact_attempt_id, step, coach_id, recipient_email,
      generated_subject, generated_body, subject, body,
      generated_body_hash, body_hash,
      evidence_snapshot, body_source, structure, policy_version, sequence_policy_version,
      state, generated_at, updated_at, reviewed_by_operator_id, reviewed_at
    ) VALUES (
      @id, @programme_contact_attempt_id, @step, @coach_id, @recipient_email,
      @generated_subject, @generated_body, @subject, @body,
      @generated_body_hash, @body_hash,
      @evidence_snapshot, @body_source, @structure, @policy_version, @sequence_policy_version,
      @state, @generated_at, @updated_at, @reviewed_by_operator_id, @reviewed_at
    )
  `).run(row);

  return { created: true, message: parse(BY_ID.get(row.id)) };
}

/* -------------------------------------------------------------------------- */
/* Editing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * CHANGE THE WORDS A PERSON HAS NOT YET APPROVED.
 *
 * TWO FIELDS AND NO OTHERS. Not the coach, the recipient, the step, the
 * evidence, the policy versions, the generation time, the review metadata or
 * the generated text. An edit changes what will be sent; it may not change what
 * was written, who it is for, or why it says what it says — and a writer that
 * could reach any of those would make the provenance decorative.
 *
 * `generated_subject` AND `generated_body` NEVER MOVE. That is the whole point
 * of storing two texts: "did a person change this, and to what" stays a
 * question the row can answer.
 *
 * NO EVIDENCE IS RE-DERIVED. An operator rewording a sentence does not change
 * what the engine licensed, and recomputing here would replace the record of a
 * decision with a fresh opinion about data that has since moved.
 *
 * GENERATED ONLY. Editing approved words would make the approval a statement
 * about text that no longer exists.
 */
export function editProgrammeMessage(id, { subject, body, at = utcNow() } = {}) {
  const row = requireMessage(id);
  if (row.state !== MESSAGE_STATE.GENERATED) {
    throw fail(
      'MESSAGE_NOT_EDITABLE',
      `This message was reviewed on ${row.reviewed_at}. Approved words are not edited — a `
      + 'review is a statement about the exact subject and body somebody read.',
    );
  }

  const nextSubject = subject === undefined ? row.subject : String(subject ?? '');
  const nextBody = body === undefined ? row.body : String(body ?? '');
  if (!nextSubject.trim()) throw fail('EMPTY_SUBJECT', 'A message needs a subject.');
  if (!nextBody.trim()) throw fail('EMPTY_BODY', 'A message needs a body.');

  // Nothing changed is not a write. A no-op edit must not restamp a timestamp
  // that dates a real one — the convention every writer in this build follows.
  if (nextSubject === row.subject && nextBody === row.body) {
    return { ...parse(row), changed: false };
  }

  db.prepare(`
    UPDATE programme_messages SET subject = ?, body = ?, body_hash = ?, updated_at = ?
    WHERE id = ? AND state = '${MESSAGE_STATE.GENERATED}'
  `).run(nextSubject, nextBody, bodyHash(nextBody), at, id);

  return { ...parse(BY_ID.get(id)), changed: true };
}

/* -------------------------------------------------------------------------- */
/* Review                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A PERSON APPROVED THESE EXACT WORDS.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS NOT. Not send-approved, not queued, not scheduled, not a mailbox
 * decision, and not permission to contact anybody. Every stance, suppression,
 * revocation, lifecycle rule, first-touch review, budget and timing check is
 * evaluated afterwards exactly as before. It says one thing: somebody read this
 * subject and this body and was content with them.
 * ---------------------------------------------------------------------------
 *
 * ATTRIBUTABLE, OR IT DOES NOT HAPPEN. An operator id is required at this
 * boundary rather than at the route, because a review nobody can be named for
 * is not a review — the same rule `campaign_first_touch_approvals` enforces,
 * and the reason generation records no operator while this does: the server
 * wrote the words, a person approved them.
 *
 * IDEMPOTENT. Reviewing an already-reviewed message returns it unchanged rather
 * than restamping the time or reattributing the decision, matching every other
 * same-state writer in this build. A second operator pressing it does not take
 * the first one's decision.
 */
export function reviewProgrammeMessage(id, { operatorId, at = utcNow() } = {}) {
  const row = requireMessage(id);

  if (!operatorId || !String(operatorId).trim()) {
    throw fail(
      'REVIEWER_REQUIRED',
      'Recording a review needs the operator who made it. A review nobody can be named for '
      + 'cannot be relied on afterwards.',
    );
  }

  if (row.state === MESSAGE_STATE.REVIEWED) {
    return { ...parse(row), changed: false };
  }
  if (!LEGAL_TRANSITIONS[row.state]?.includes(MESSAGE_STATE.REVIEWED)) {
    throw fail(
      'ILLEGAL_MESSAGE_TRANSITION',
      `A message cannot go from ${row.state} to ${MESSAGE_STATE.REVIEWED}`
      + ` (allowed: ${(LEGAL_TRANSITIONS[row.state] ?? []).join(', ') || 'nothing'})`,
    );
  }

  db.prepare(`
    UPDATE programme_messages
    SET state = ?, reviewed_by_operator_id = ?, reviewed_at = ?, updated_at = ?
    WHERE id = ? AND state = '${MESSAGE_STATE.GENERATED}'
  `).run(MESSAGE_STATE.REVIEWED, operatorId, at, at, id);

  return { ...parse(BY_ID.get(id)), changed: true };
}

function requireMessage(id) {
  const row = BY_ID.get(id);
  if (!row) throw fail('PROGRAMME_MESSAGE_NOT_FOUND', `No programme message ${id}`);
  return row;
}
