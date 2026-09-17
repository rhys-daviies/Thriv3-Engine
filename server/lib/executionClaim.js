import db from '../db/client.js';
import { utcNow, utcToday } from './time.js';
import { programmeMessageWithContext, MESSAGE_STATE as CONTENT_STATE } from './programmeMessages.js';
import { programmePursuitPlan } from './pursuitPolicy.js';
import { campaignContactDecision } from './campaignAttribution.js';
import { createOutreach } from './outreach.js';
import { linkContactAttemptToOutreach } from './contactAttempts.js';
import { recordDraft, claimSendForExecution, sendById } from './outreachSend.js';
import { recordOutboundAttempt, normaliseSendingIdentity, TRANSPORT } from './outboundBudget.js';
import { isSendCapped } from './sendCap.js';
import { mailbox, hasStoredCredential, MAILBOX_STATUS } from './connectedMailboxes.js';
import { OUTREACH_ORIGIN } from '../../shared/outreachOrigin.js';

/**
 * TAKE ONE REVIEWED MESSAGE FOR EXECUTION — D4.5. TXN 1, and nothing after it.
 *
 * Everything that must be true before a provider is called, re-established at
 * the last possible instant and committed with the claim in one transaction:
 * the execution record exists, its attribution is written, the message is
 * claimed, and the outbound action is paid for — or none of it happened.
 *
 * ---------------------------------------------------------------------------
 * IT DOES NOT SEND, AND THERE IS NOTHING AFTER IT THAT DOES.
 *
 * No transport, no provider, no credential, no token, no network. The message
 * it returns is in SENDING and stays there: this is a library operation with
 * no HTTP route, no scheduler and no screen behind it, so nothing in
 * production can strand a real message in that state. D4.6 owns recovery,
 * D4.7 the transport, D4.9 the route.
 * ---------------------------------------------------------------------------
 *
 * GENERATION AND REVIEW ARE NOT SEND AUTHORITY, which is the reason almost all
 * of this looks like a repeat. A message was composed when the campaign was
 * open and approved when the coach's address was what it is on the row; by the
 * time somebody presses send, a stance may have changed, a suppression may
 * have landed, the campaign may have closed, the mailbox may have been revoked
 * and the day's capacity may be gone. Every one of those is asked again here,
 * from the authority that owns it, inside the transaction that writes.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT REUSES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 *   REUSED   `programmePursuitPlan` — B6's step, B3's safety and F7's review in
 *            one read, so this module owns no copy of any of them.
 *            `createOutreach` (B3 + F7 again, at the write), `isSendCapped`,
 *            `linkContactAttemptToOutreach`, `recordDraft`,
 *            `claimSendForExecution`, `recordOutboundAttempt`, `mailbox`.
 *
 *   NOT REUSED, ON PURPOSE:
 *     `contactAttemptPreparation` / `materialiseNextContactAttempt` — they
 *        answer whether an INTENT may be recorded, and deliberately ignore
 *        timing and capacity. Sending is the question they are not asking.
 *     `generateProgrammeMessage` / `composeProgrammeMessage` — composition. The
 *        words are already approved; re-composing here would replace what a
 *        person read with a fresh opinion about data that has since moved.
 *     `mailboxCredential` — it decrypts. See the note on identity below.
 *     `campaignExecutionPlan` — a hundred-programme read-only orchestration.
 * ---------------------------------------------------------------------------
 */

/** Why an execution claim was refused, where no existing authority owns the code. */
export const CLAIM_REFUSAL = Object.freeze({
  PROGRAMME_MESSAGE_NOT_FOUND: 'PROGRAMME_MESSAGE_NOT_FOUND',
  /** Composed but nobody approved the words. Review is not send approval — it is its floor. */
  MESSAGE_NOT_REVIEWED: 'MESSAGE_NOT_REVIEWED',
  /** The campaign has moved past this coach, or past this step. */
  MESSAGE_NOT_CURRENT: 'MESSAGE_NOT_CURRENT',
  /** Quoted from B7 rather than respelled. */
  CONTACT_ATTEMPT_STEP_DRIFT: 'CONTACT_ATTEMPT_STEP_DRIFT',
  /** The coach's address is not the one the approved message was addressed to. */
  RECIPIENT_EMAIL_CHANGED: 'RECIPIENT_EMAIL_CHANGED',
  /** Nothing to send: policy has no cold action for this programme right now. */
  NO_ACTION_TO_EXECUTE: 'NO_ACTION_TO_EXECUTE',
  /** The per-inbox cap, which protects the RECIPIENT rather than the sender. */
  SEND_CAP_REACHED: 'SEND_CAP_REACHED',

  MAILBOX_NOT_FOUND: 'MAILBOX_NOT_FOUND',
  MAILBOX_NOT_CONNECTED: 'MAILBOX_NOT_CONNECTED',
  MAILBOX_ATHLETE_MISMATCH: 'MAILBOX_ATHLETE_MISMATCH',
  MAILBOX_CREDENTIAL_MISSING: 'MAILBOX_CREDENTIAL_MISSING',

  /** Somebody else holds it, or it has already been executed. */
  SEND_CLAIM_LOST: 'SEND_CLAIM_LOST',
});

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const COACH = db.prepare('SELECT id, full_name, email, school, sport FROM coaches WHERE id = ?');
const OUTREACH_BY_ID = db.prepare('SELECT id, revoked_at FROM outreach WHERE id = ?');
/** The lifetime relationship, if there already is one. B3 needs it to see a revocation. */
const OUTREACH_FOR = db.prepare('SELECT id FROM outreach WHERE athlete_id = ? AND coach_id = ?');

const sameEmail = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/**
 * THE FROZEN EVIDENCE, PUT BACK INTO THE SHAPE THE SNAPSHOT WRITER READS.
 *
 * `programme_messages.evidence_snapshot` is `buildSendSnapshot`'s output
 * flattened — rendered sentences with their text, the claims the body cap held
 * back, the structure and the policy versions. `recordDraft` takes an
 * `evidenceFor` RESULT and builds a snapshot from it, so handing it the
 * flattened form would produce an empty one and lose the record.
 *
 * THIS RE-PROJECTS; IT DOES NOT RE-DERIVE. Every value comes from the stored
 * row and nothing is queried, so the execution snapshot says exactly what the
 * composition said — which is the whole reason the composition was frozen.
 * A message composed before a roster changed keeps the claims it actually made.
 */
function rehydrateEvidence(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const rendered = Array.isArray(snapshot.rendered) ? snapshot.rendered : [];
  const held = Array.isArray(snapshot.held) ? snapshot.held : [];
  return {
    structure: { key: snapshot.structure ?? null, source: snapshot.structureSource ?? null },
    engineSelected: snapshot.engineSelected ?? [],
    operatorSelected: Boolean(snapshot.operatorSelected),
    ...(snapshot.sequence ? { sequence: snapshot.sequence } : {}),
    composition: {
      sentences: rendered.map((r) => ({
        order: r.order, slot: r.slot, kind: r.kind, text: r.text,
      })),
      placement: [
        ...rendered.map((r) => ({
          order: r.order, kind: r.kind, slot: r.slot, displayed: true,
        })),
        ...held.map((kind, i) => ({
          order: rendered.length + i, kind, slot: null, displayed: false,
        })),
      ],
    },
  };
}

/**
 * @param {string} args.programmeMessageId  the reviewed composition to execute.
 * @param {string} args.operatorUserId      from the session; never a field.
 * @param {string} args.connectedMailboxId  which mailbox is going to send it.
 * @param {string} args.runId               the process holding the claim.
 * @returns {{send, outreach, mailbox, attempt, attemptId, step, ledgerAttemptId}}
 * @throws with `err.code` — CLAIM_REFUSAL, or the owning authority's own code.
 */
export function claimProgrammeMessageForExecution({
  programmeMessageId, operatorUserId, connectedMailboxId,
  runId, at = utcNow(), onDate = utcToday(), window = undefined,
  /**
   * B5'S CEILINGS, INJECTABLE FOR THE SAME REASON `at` AND `onDate` ARE. They
   * default to the configured ones and are passed straight through to the
   * consume, which is the authority: a test that has to send ten real messages
   * to prove an exhausted budget rolls a transaction back is a test nobody
   * runs.
   */
  athleteLimit = undefined, mailboxLimit = undefined,
} = {}) {
  for (const [name, value] of [
    ['programmeMessageId', programmeMessageId],
    ['operatorUserId', operatorUserId],
    ['connectedMailboxId', connectedMailboxId],
    ['runId', runId],
  ]) {
    if (typeof value !== 'string' || !value.trim()) {
      throw fail('EXECUTION_CLAIM_ARGUMENT_REQUIRED', `An execution claim needs ${name}.`);
    }
  }

  /**
   * BEGIN IMMEDIATE, NOT THE DEFAULT DEFERRED TRANSACTION.
   *
   * A deferred transaction starts as a reader and upgrades on its first write,
   * and two of those racing is how SQLITE_BUSY turns up somewhere nobody
   * expected a lock. This takes the write lock at the start, so the reads that
   * decided and the rows that committed cannot be separated by another writer.
   *
   * NOTHING AWAITS INSIDE IT, and nothing may be added that does. Every call
   * below is synchronous better-sqlite3; the day a transport exists it runs
   * AFTER this returns, because holding a write lock across a provider's HTTP
   * call would block every other writer for as long as the network felt like
   * taking. B5's own consume nests inside as a SAVEPOINT, which is why this
   * outer transaction must itself be immediate.
   */
  return CLAIM.immediate({
    programmeMessageId, operatorUserId, connectedMailboxId, runId, at, onDate, window,
    athleteLimit, mailboxLimit,
  });
}

const CLAIM = db.transaction(({
  programmeMessageId, operatorUserId, connectedMailboxId, runId, at, onDate, window,
  athleteLimit, mailboxLimit,
}) => {
  /* ---- 1. the approved words, and what they were approved for ------------ */
  const found = programmeMessageWithContext(programmeMessageId);
  if (!found) {
    throw fail(CLAIM_REFUSAL.PROGRAMME_MESSAGE_NOT_FOUND,
      `No programme message ${programmeMessageId}`);
  }
  const { message, context } = found;

  if (message.state !== CONTENT_STATE.REVIEWED) {
    throw fail(CLAIM_REFUSAL.MESSAGE_NOT_REVIEWED,
      'Nobody has approved these words. A message is executed as a person read it, and this '
      + 'one has only been generated.');
  }

  /* ---- 2. what the campaign would do right now, from the authorities ----- */
  /**
   * ONE READ, THREE AUTHORITIES. `programmePursuitPlan` composes B6's derived
   * step, B3's contact decision — campaign state, start date, outreach window,
   * programme state, contact stance, suppression, revocation — F7's first-touch
   * review, and B5's budget reading for this sending identity. This module
   * re-derives none of it and holds no copy of any rule.
   */
  const sendingIdentity = normaliseSendingIdentity(
    mailbox(connectedMailboxId, { operatorUserId })?.email_address,
  );
  const plan = programmePursuitPlan({
    programmeCampaignId: context.programmeCampaignId,
    onDate,
    sendingIdentity,
    ...(window ? { window } : {}),
  });
  /**
   * `plan.budget` IS A READING, NOT THE GATE. B5's authority is the consume at
   * the end of this transaction, which decides and writes in one statement;
   * asking the reading here as well would be a second answer to a question that
   * can change between the two, and the second one would be the stale one.
   */

  /**
   * ---- B3, ASKED ABOUT THIS COACH, AND ASKED FIRST ----
   *
   * The plan's own `safety` is about the coach the campaign would write to
   * NEXT, which is not necessarily this one — a suppressed coach is SKIPPED by
   * the policy, so the plan quietly names their colleague instead. Reading the
   * plan's answer would then refuse a suppressed head coach with "the campaign
   * has moved on", which is true, useless, and hides the actual reason.
   *
   * So the authority is asked directly about the coach the approved message is
   * addressed to. Same function, same codes — SUPPRESSED, PROGRAMME_STOPPED,
   * CAMPAIGN_NOT_ACTIVE, CAMPAIGN_NOT_STARTED, CAMPAIGN_OUTREACH_WINDOW_CLOSED,
   * RELATIONSHIP_DO_NOT_CONTACT, RELATIONSHIP_MANUAL_ONLY, OUTREACH_REVOKED —
   * quoted, never respelled.
   */
  const existingOutreach = OUTREACH_FOR.get(context.athleteId, message.coach_id);
  const decision = campaignContactDecision({
    programmeCampaignId: context.programmeCampaignId,
    athleteId: context.athleteId,
    coachId: message.coach_id,
    outreachId: existingOutreach?.id ?? null,
    onDate,
  });
  if (!decision.allowed) {
    throw fail(decision.reason,
      `${context.collegeName}: ${decision.reason}. Nothing was claimed.`);
  }

  if (!plan.current) {
    throw fail(CLAIM_REFUSAL.NO_ACTION_TO_EXECUTE,
      `${context.collegeName}: this campaign has no cold action for anybody here right now.`);
  }
  if (plan.current.coachId !== message.coach_id) {
    /**
     * Reached only when B3 PERMITS this coach and the campaign has still moved
     * past them — an earlier coach replied, or the pursuit was restructured.
     */
    throw fail(CLAIM_REFUSAL.MESSAGE_NOT_CURRENT,
      'This campaign is no longer approaching the coach this message was written for. Nothing '
      + 'was claimed, and the message is untouched.');
  }
  /**
   * THE STEP IS CHECKED AGAINST BOTH RECORDS, and they are two different
   * things. `message.step` is what the composition was written as;
   * `plan.step` is what B6 derives from accepted campaign-local messages now.
   * Sending a step-1 message after step 1 has already gone would be sending an
   * introduction to somebody mid-conversation.
   */
  if (message.step !== plan.step || context.attemptStep !== plan.step) {
    throw fail(CLAIM_REFUSAL.CONTACT_ATTEMPT_STEP_DRIFT,
      `This message is step ${message.step}, the prepared attempt is on step `
      + `${context.attemptStep}, and this campaign's message history says step ${plan.step}. `
      + 'Nothing is executed while they disagree.');
  }
  if (plan.firstTouchReview?.required) {
    throw fail(plan.firstTouchReview.reason,
      `${context.collegeName}: the first-touch review this coach needs is not current. `
      + 'Nothing was claimed.');
  }
  /* ---- 3. the recipient is still the recipient --------------------------- */
  const coach = COACH.get(message.coach_id);
  if (!coach) throw fail('COACH_NOT_FOUND', `No coach ${message.coach_id}`);
  if (!sameEmail(coach.email, message.recipient_email)) {
    /**
     * A coach row is mutable and an address corrected between review and send
     * would silently change WHO an operator approved a message for. The id says
     * which person; the frozen address says which inbox was agreed. Neither is
     * trusted alone.
     */
    throw fail(CLAIM_REFUSAL.RECIPIENT_EMAIL_CHANGED,
      'This coach\'s address has changed since the message was approved. Somebody needs to look '
      + 'at it rather than send to an inbox nobody agreed to.');
  }
  if (isSendCapped(coach.email)) {
    /**
     * THE RECIPIENT'S PROTECTION, NOT THE SENDER'S BUDGET, and it is the one
     * check here that is about somebody outside this campaign entirely: how
     * many athletes have written to this inbox lately. Read-only, keyed on the
     * address, and counted from `outreach.sent_at` — so a message merely
     * claimed does not count against it, which is right, because it has
     * reached nobody.
     */
    throw fail(CLAIM_REFUSAL.SEND_CAP_REACHED,
      `${coach.email} has had as many approaches as the per-inbox cap allows in the window.`);
  }

  /* ---- 4. the mailbox, as durable identity and nothing more -------------- */
  /**
   * NO CREDENTIAL IS READ AND NOTHING IS DECRYPTED. `mailboxCredential` is the
   * only function that decrypts a refresh token, and it is not called here or
   * anywhere this reaches: an AES unwrap inside a write transaction would hold
   * the database's write lock across a key derivation for no benefit, and a
   * plaintext token has no business existing until something is about to use
   * it. What is checked is EXISTENCE — `hasStoredCredential` — which is the
   * durable fact that matters: a mailbox with no credential cannot send, and
   * claiming for it would strand the message.
   */
  const box = mailbox(connectedMailboxId, { operatorUserId });
  if (!box) {
    // Deliberately the same answer for "no such mailbox" and "not yours".
    throw fail(CLAIM_REFUSAL.MAILBOX_NOT_FOUND,
      'No connected mailbox of that id belongs to this operator.');
  }
  if (box.status !== MAILBOX_STATUS.CONNECTED) {
    throw fail(CLAIM_REFUSAL.MAILBOX_NOT_CONNECTED,
      `That mailbox is ${box.status}. Only a CONNECTED mailbox may be claimed for a send.`);
  }
  if (box.athlete_id !== context.athleteId) {
    throw fail(CLAIM_REFUSAL.MAILBOX_ATHLETE_MISMATCH,
      'That mailbox belongs to a different athlete. A campaign sends from the athlete\'s own '
      + 'mailbox, never from somebody else\'s.');
  }
  if (!hasStoredCredential(box.id)) {
    throw fail(CLAIM_REFUSAL.MAILBOX_CREDENTIAL_MISSING,
      'That mailbox holds no credential, so nothing could send through it. It needs '
      + 'reconnecting before a message is claimed for it.');
  }
  const identity = normaliseSendingIdentity(box.email_address);

  /* ---- 5. the lifetime relationship, and the attempt that runs through it - */
  /**
   * B3 AND F7 RUN AGAIN INSIDE THIS, which is not redundant with the plan
   * above. The plan reports; `createOutreach` refuses. It is the authoritative
   * gate on every campaign-attributed write and it stands whether or not a
   * caller thought to read a plan first.
   */
  const outreach = createOutreach({
    athleteId: context.athleteId,
    coachId: coach.id,
    programmeCampaignId: context.programmeCampaignId,
    onDate,
  });
  if (OUTREACH_BY_ID.get(outreach.id)?.revoked_at) {
    throw fail('OUTREACH_REVOKED',
      'Outreach to this coach was revoked, so their tracking link no longer resolves. Nothing '
      + 'was claimed.');
  }
  // Idempotent, and refuses a relationship belonging to anybody else.
  linkContactAttemptToOutreach(message.programme_contact_attempt_id, outreach.id, { at });

  /* ---- 6. the execution record, with its attribution --------------------- */
  /**
   * THE EXECUTION SNAPSHOT IS NOT THE COMPOSITION, and D4.5 is honest about
   * which one it is holding.
   *
   * `programme_messages.subject` / `.body` are the APPROVED words. What a coach
   * eventually reads is those words plus two things this layer cannot supply:
   * the tracked profile link substituted for `{{player_profile_url}}`, and the
   * compliance footer. The legacy path applies both immediately before handing
   * a body to Outlook, because both need facts that only exist at that moment.
   *
   * NEITHER HAS HAPPENED HERE, so neither is pretended. `body_hash` is the hash
   * of the approved body, which is exactly what this row can truthfully claim
   * at claim time. The transport slice must re-stamp `subject` and `body_hash`
   * with the wire body before the message is ACCEPTED, or the column stops
   * meaning "proof of what the coach read" — and it may, because the row is
   * still SENDING and only an accepted message is frozen.
   */
  const { id: sendId } = recordDraft({
    outreachId: outreach.id,
    athleteId: context.athleteId,
    coachId: coach.id,
    collegeName: context.collegeName,
    sport: context.sport,
    programmeCampaignId: context.programmeCampaignId,
    onDate,
    // The evidence the composer recorded, re-projected rather than re-derived.
    evidence: rehydrateEvidence(message.evidence_snapshot),
    body: message.body,
    subject: message.subject,
    bodySource: message.body_source,
    templateVariant: message.evidence_snapshot?.templateVariant ?? null,
    // Set by the caller for the legacy path; here the verified campaign makes
    // it CAMPAIGN regardless, which is the authoritative answer.
    origin: OUTREACH_ORIGIN.CAMPAIGN,
    programmeMessageId: message.id,
    connectedMailboxId: box.id,
    sendingIdentity: identity,
    provider: box.provider,
    at,
  });

  /* ---- 7. the claim, BEFORE the budget ----------------------------------- */
  /**
   * THE ORDER IS THE POINT, and it is the opposite of the legacy path's.
   *
   * Two callers may reach this transaction for the same message. Exactly one
   * wins the guarded UPDATE; the loser must have spent NOTHING. Consuming
   * capacity first would charge a real mailbox's daily allowance for a message
   * that was never going to be sent — and the budget is never refunded, by
   * design, so the loss would be permanent.
   */
  const { claimed, send } = claimSendForExecution(sendId, { runId, at });
  if (!claimed) {
    throw fail(CLAIM_REFUSAL.SEND_CLAIM_LOST,
      `This message is already ${send?.state ?? 'claimed'} — somebody else holds it, or it has `
      + 'already been executed. Nothing was claimed and no capacity was spent.');
  }

  /* ---- 8. and only now is it paid for ------------------------------------ */
  /**
   * SPENT ON THE MESSAGE, NOT MERELY ON THE RELATIONSHIP — D4.4 added the
   * pointer and this is the first caller to fill it. Refused capacity throws,
   * which rolls the claim and everything above it back: a message nobody could
   * afford to send must not be left SENDING.
   */
  const { attempt } = recordOutboundAttempt({
    outreachId: outreach.id,
    athleteId: context.athleteId,
    sendingIdentity: identity,
    transport: TRANSPORT.PROVIDER_API,
    outreachSendId: sendId,
    at,
    ...(window ? { window } : {}),
    ...(athleteLimit === undefined ? {} : { athleteLimit }),
    ...(mailboxLimit === undefined ? {} : { mailboxLimit }),
  });

  return {
    send: sendById(sendId),
    outreach,
    attemptId: message.programme_contact_attempt_id,
    programmeMessageId: message.id,
    mailbox: { id: box.id, provider: box.provider, sendingIdentity: identity },
    step: plan.step,
    ledgerAttemptId: attempt.id,
  };
});
