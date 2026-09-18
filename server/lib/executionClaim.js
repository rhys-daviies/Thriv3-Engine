import db from '../db/client.js';
import { utcNow, utcToday } from './time.js';
import { programmeMessageWithContext, MESSAGE_STATE as CONTENT_STATE } from './programmeMessages.js';
import { programmePursuitPlan, PURSUIT_ACTION } from './pursuitPolicy.js';
import { followUpTiming } from './followUpTiming.js';
import { campaignContactDecision } from './campaignAttribution.js';
import { createOutreach } from './outreach.js';
import { linkContactAttemptToOutreach } from './contactAttempts.js';
import {
  recordDraft, claimSendForExecution, sendById, unresolvedSendFor,
} from './outreachSend.js';
import {
  recordOutboundAttempt, normaliseSendingIdentity, TRANSPORT, OUTBOUND_ATTEMPT_DISPOSITION,
} from './outboundBudget.js';
import { isSendCapped } from './sendCap.js';
import { providerImplemented } from './providerCapability.js';
import { mailbox, hasStoredCredential, MAILBOX_STATUS } from './connectedMailboxes.js';
import { RUN_ID } from './executionRun.js';
/**
 * F11c's pure content helper — D4.7. Deliberately NOT `executionDecision` or
 * `executionResolution`: those are read-only advisory layers for a screen, and
 * an authority chain that ran `decision → claim` would make the send path
 * depend on a preview of a world that may already have moved. This module
 * keeps asking the underlying policies directly, exactly as D4.5 does.
 */
import { resolveWireContent } from './executionContent.js';
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
  /**
   * THIS BUILD HAS NO ADAPTER FOR THAT MAILBOX'S PROVIDER — D5.2.
   *
   * The authoritative version of a refusal `executionReadiness` has reported
   * advisorily since D4.9 and the claim could not make: until D5.2 nothing
   * here asked what provider a mailbox was, so a MICROSOFT mailbox could be
   * claimed, frozen and paid for, and only then found unsendable.
   */
  MAILBOX_PROVIDER_UNSUPPORTED: 'MAILBOX_PROVIDER_UNSUPPORTED',

  /** Somebody else holds it, or it has already been executed. */
  SEND_CLAIM_LOST: 'SEND_CLAIM_LOST',

  /**
   * THIS EXACT COMPOSITION HAS ALREADY BEEN EXECUTED — D4.8.
   *
   * `idx_outreach_send_programme_message` is UNIQUE on `programme_message_id`,
   * so a second claim of one message has always been impossible. What it was
   * not was EXPLAINED: the refusal arrived as SQLITE_CONSTRAINT_UNIQUE, from
   * inside a transaction, after the budget had been consulted — a database
   * error used as control flow.
   *
   * It covers every prior outcome. A message that reached ACCEPTED must not be
   * sent twice; one that reached FAILED or UNKNOWN_PROVIDER_RESULT must not be
   * retried by re-executing the same row, because a retry is a fresh decision
   * about fresh content and not a repeat of this one. The index remains the
   * final word under a race; this is the answer when there is no race.
   */
  MESSAGE_ALREADY_EXECUTED: 'MESSAGE_ALREADY_EXECUTED',

  /**
   * AN EARLIER MESSAGE TO THIS COACH IS UNRESOLVED — D4.8. Same fact
   * `RELATIONSHIP_HAS_UNRESOLVED_SEND` names at generation, asked again here
   * because the world moves between the two.
   */
  RELATIONSHIP_HAS_UNRESOLVED_SEND: 'RELATIONSHIP_HAS_UNRESOLVED_SEND',

  /**
   * THE FOLLOW-UP IS NOT DUE YET — D4.8, and the most important refusal added
   * in this slice.
   *
   * The four-day delay existed as policy and was checked only by a read-only
   * planning screen, so the write path would happily transmit a follow-up the
   * same day the first message was accepted. A coach receiving two emails in
   * one afternoon is the one failure in this system with a victim outside it.
   *
   * The rule is not restated here: `followUpTiming` is imported from the module
   * that owns FOLLOW_UP_DELAY_DAYS, so the screen and the send path cannot
   * drift apart.
   */
  FOLLOW_UP_NOT_DUE: 'FOLLOW_UP_NOT_DUE',
});

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const COACH = db.prepare('SELECT id, full_name, email, school, sport FROM coaches WHERE id = ?');
const OUTREACH_BY_ID = db.prepare('SELECT id, revoked_at FROM outreach WHERE id = ?');
/**
 * The two athlete facts the wire content needs — D4.7. Read here rather than
 * through the `Player` entity so this stays one prepared statement inside the
 * transaction, and narrowed to two columns so nothing else about an athlete can
 * drift into an email.
 */
const ATHLETE_FOR_CONTENT = db.prepare(
  'SELECT full_name, public_slug FROM players WHERE id = ?',
);
/** The lifetime relationship, if there already is one. B3 needs it to see a revocation. */
const OUTREACH_FOR = db.prepare('SELECT id FROM outreach WHERE athlete_id = ? AND coach_id = ?');
/** Has this exact composition already been executed, and how did it end? — D4.8. */
const EXECUTION_FOR_MESSAGE = db.prepare(
  'SELECT id, state FROM outreach_send WHERE programme_message_id = ?',
);

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
 * @param {string} [args.runId]             the process holding the claim.
 * @returns {{send, outreach, mailbox, attempt, attemptId, step, ledgerAttemptId}}
 * @throws with `err.code` — CLAIM_REFUSAL, or the owning authority's own code.
 */
export function claimProgrammeMessageForExecution({
  programmeMessageId, operatorUserId, connectedMailboxId,
  /**
   * WHICH PROCESS IS TAKING IT — D4.6, and it now defaults to THIS one.
   *
   * A production caller has exactly one truthful answer and no way to know it
   * better than the process does, so making each one invent a run id was an
   * invitation to invent a WRONG one: a constant, a per-request value, or a
   * string copied from a test. Any of those breaks recovery silently — a
   * constant makes a dead claim look live across a restart, a per-request value
   * makes every live claim look dead — and the failure would only appear the
   * day a process died mid-send.
   *
   * INJECTION IS UNCHANGED AND STILL WINS. An explicit `runId` overrides this,
   * which is what the D4.5 concurrency proof relies on: it runs two node
   * processes with two named runs and asserts exactly one of them holds the
   * row. The default is what production gets, not what tests get.
   *
   * IT IS NOT REACHABLE FROM A REQUEST. There is no HTTP route to this function
   * — D4.9 owns that — and when there is one it will pass no run id at all,
   * because the only correct value is the one this module already imports.
   */
  runId = RUN_ID, at = utcNow(), onDate = utcToday(), window = undefined,
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

/* -------------------------------------------------------------------------- */
/* The safety gates, asked once and reachable from both execution paths        */
/* -------------------------------------------------------------------------- */

/**
 * IS IT STILL SAFE TO SEND THIS MESSAGE, RIGHT NOW?
 *
 * ===========================================================================
 * EXTRACTED IN D5.0 SO THAT A RETRY REUSES THESE RULES RATHER THAN RESTATING
 * THEM — and that is the whole reason it is a function.
 *
 * D5.0 adds a second way to reach a provider: an explicit re-execution of a
 * message whose transport provably never submitted anything. That path has to
 * satisfy every check below, because a refusal that happened this morning says
 * nothing about this afternoon — a coach may have replied, the campaign may
 * have been stopped, the address may have been corrected, the inbox may have
 * hit its cap, the day may have rolled over. Copying these gates into
 * `executionRetry.js` would have put a SECOND policy at the last gate before
 * an email leaves, which is the worst place in this system for two of them.
 *
 * So the gates moved here, unchanged, and both callers run the same code.
 * ===========================================================================
 *
 * IT READS AND REFUSES. It writes nothing, claims nothing, spends nothing, and
 * every rule in it belongs to somebody else — `campaignContactDecision`,
 * `programmePursuitPlan`, `followUpTiming`, `isSendCapped`, `unresolvedSendFor`,
 * `mailbox`, `hasStoredCredential`. It composes them; it does not re-derive a
 * single one.
 *
 * IT DOES NOT ASK WHETHER THE MESSAGE HAS ALREADY BEEN EXECUTED. That gate —
 * MESSAGE_ALREADY_EXECUTED — stays in the ordinary claim, and deliberately: a
 * retry exists precisely BECAUSE an execution row is already there, and it is
 * the one caller for which that fact is the precondition rather than the
 * refusal.
 *
 * CALLED INSIDE THE CALLER'S TRANSACTION, never opening one. Both callers hold
 * an immediate transaction already, which is what makes "these facts were true
 * when the row was written" a guarantee rather than a hope.
 *
 * @returns {{plan, coach, box, identity}} the authorities' own answers, so a
 *   caller need not ask any of them a second time and risk a different reply.
 */
export function assertExecutionSafety({
  message, context, operatorUserId, connectedMailboxId, onDate, window,
}) {
  /**
   * ---- 1b. nothing unresolved is in flight to this coach — D4.8 ----------
   *
   * ASKED BEFORE THE PLAN, AND THE ORDER IS THE POINT. A relationship holding
   * an unresolved message makes `programmePursuitPlan` return AWAITING_OPERATOR
   * with a null step — so the step-agreement check below would fire first and
   * refuse with CONTACT_ATTEMPT_STEP_DRIFT, which is true of the numbers and
   * says nothing about what happened. An operator needs to be told that a
   * message may already be in that coach's inbox, not that two counters
   * disagree.
   *
   * `idx_outreach_send_one_open` has always refused a second open row on the
   * relationship. This says so in words, before a body is frozen and before any
   * capacity is spent, rather than letting a unique-index violation explain it.
   *
   * Read through the EXISTING relationship. A campaign's first message has none
   * yet and so has nothing to be blocked by.
   */
  const existingRelationship = OUTREACH_FOR.get(context.athleteId, message.coach_id);
  if (unresolvedSendFor(existingRelationship?.id ?? null)) {
    throw fail(CLAIM_REFUSAL.RELATIONSHIP_HAS_UNRESOLVED_SEND,
      'An earlier message to this coach is unresolved — we do not know whether the provider '
      + 'accepted it, so it may already be in their inbox. It has to be resolved before another '
      + 'message goes to them. Nothing was claimed and no capacity was spent.');
  }

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
  /* ---- 2b. a follow-up waits its four days — D4.8 ------------------------ */
  /**
   * THE HIGHEST-VALUE REFUSAL IN THIS SLICE, and it refuses BEFORE the claim,
   * BEFORE the budget and BEFORE any provider handoff — so an early follow-up
   * costs nothing and leaves nothing behind.
   *
   * ONLY A FOLLOW-UP WAITS. A first message has no preceding accepted send and
   * therefore no clock; `PURSUIT_ACTION.INITIAL_OUTREACH` passes straight
   * through.
   *
   * THE RULE IS IMPORTED, NOT RESTATED. `followUpTiming` lives beside
   * FOLLOW_UP_DELAY_DAYS in pursuitPolicy and is the same function the planning
   * screen calls, so "what the screen says" and "what the send path does" are
   * one implementation. Calendar days, inclusive of the fourth — unchanged.
   *
   * AN UNRESOLVED ANCHOR IS NOT "DUE NOW". An accepted message with no
   * `sent_at` cannot be produced by `acceptSend`; if one is ever met, this
   * refuses rather than guessing that the wait has elapsed.
   */
  if (plan.nextAction === PURSUIT_ACTION.FOLLOW_UP) {
    const timing = followUpTiming(plan.current, onDate);
    if (!timing.due) {
      throw fail(CLAIM_REFUSAL.FOLLOW_UP_NOT_DUE,
        timing.unresolved
          ? 'The previous message to this coach has no recorded send time, so there is no way '
            + 'to know when a follow-up became due. Somebody needs to look at it. Nothing was '
            + 'claimed and no capacity was spent.'
          : `A follow-up to this coach is not due until ${timing.policyEligibleOn}; today is `
            + `${onDate}. Nothing was claimed and no capacity was spent.`);
    }
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
  /**
   * ---- 4b. AND THIS BUILD HAS AN ADAPTER FOR ITS PROVIDER — D5.2 ----------
   *
   * =========================================================================
   * IT ASKS `implemented`, AND DELIBERATELY NOT `sendEnabled`.
   *
   * The three capability questions are not interchangeable, and only one of
   * them is a fact this transaction can be authoritative about:
   *
   *   implemented   a property of the BUILD. Constant for the life of the
   *                 process, identical in every environment, and therefore the
   *                 one thing a durable row can be judged against. A MICROSOFT
   *                 mailbox is unsendable here for ever.
   *   configured    a property of the DEPLOYMENT.
   *   sendEnabled   a deliberate operational switch.
   *
   * THE LAST TWO ARE ENFORCED WHERE THEY BELONG: the orchestrator refuses on
   * both before this transaction is entered, and `googleTransport` refuses
   * again — twice — immediately around the Gmail request. Re-reading an
   * environment variable in here would buy a window of microseconds while
   * costing something real: every D4.5–D5.1 test that claims through the
   * library, with no Google configuration present, would begin refusing. Those
   * tests prove the execution engine, and an engine that cannot be tested
   * without production Google credentials is a worse engine.
   *
   * SO OMITTING A CAPABILITY ARGUMENT CANNOT MEAN "EVERYTHING IS ENABLED".
   * There is no argument to omit. The answer comes from a build-time allowlist
   * that no environment can widen, which is exactly the property a claim needs
   * and exactly the property an environment read would not have.
   * =========================================================================
   */
  if (!providerImplemented(box.provider)) {
    throw fail(CLAIM_REFUSAL.MAILBOX_PROVIDER_UNSUPPORTED,
      `Nothing in this build can send through a ${box.provider ?? 'mailbox with no'} provider. `
      + 'Nothing was claimed and no capacity was spent.');
  }
  const identity = normaliseSendingIdentity(box.email_address);

  return { plan, coach, box, identity };
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

  /**
   * ---- 1a. this composition has not already been executed — D4.8 ----------
   *
   * Asked FIRST, before policy, before the mailbox, before anything is written.
   * A message with an execution row behind it has had its answer, whatever that
   * answer was, and every later check would be asking questions about a send
   * that already happened.
   */
  const priorExecution = EXECUTION_FOR_MESSAGE.get(message.id);
  if (priorExecution) {
    throw fail(CLAIM_REFUSAL.MESSAGE_ALREADY_EXECUTED,
      `This message has already been executed — it is ${priorExecution.state}. A message is `
      + 'executed once; sending the same approved words again is a new decision about new '
      + 'content, not a repeat of this one. Nothing was claimed.');
  }

  const { plan, coach, box, identity } = assertExecutionSafety({
    message, context, operatorUserId, connectedMailboxId, onDate, window,
  });

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

  /* ---- 6. the wire content, now that a token exists — D4.7 --------------- */
  /**
   * THE APPROVED WORDS BECOME THE WIRE BODY, AND THIS IS THE FIRST MOMENT THEY
   * CAN.
   *
   * `programme_messages.subject` / `.body` are the APPROVED words. What a coach
   * reads is those words plus two things composition cannot supply: the tracked
   * profile link substituted for `{{player_profile_url}}`, and the compliance
   * footer. The link needs `outreach.token`, which the `createOutreach` above
   * has just guaranteed — so freezing content any earlier is impossible, and
   * freezing it any later means a crashed process leaves a SENDING row with no
   * record of what it was about to send.
   *
   * ---------------------------------------------------------------------------
   * D4.5 LEFT A NOTE HERE ASKING A TRANSPORT SLICE TO RE-STAMP THE HASH LATER.
   * THIS IS THAT SLICE, AND IT DOES IT HERE INSTEAD — BEFORE THE CLAIM.
   *
   * Re-stamping after the provider call would mean the bytes that went out were
   * never durable at the one moment they mattered: between the claim and the
   * result write, which is precisely the window a crash falls into. So the
   * transformation happens inside this transaction and commits with it.
   * ---------------------------------------------------------------------------
   *
   * F11c'S PURE HELPER DOES THE WHOLE TRANSFORMATION and this module holds no
   * copy of any of it: explicit `{{player_profile_url}}` substitution and the
   * compliance footer, nothing else. No personalisation of the greeting, no
   * rewriting of the subject, no silent link insertion where an operator
   * removed the placeholder, and no re-composition. `programme_messages` is
   * read and never touched.
   *
   * IT CAN REFUSE, AND A REFUSAL IS A ROLLBACK. Missing tracking token, no
   * published profile page, no public base url, unconfigured compliance footer:
   * every one throws, this transaction unwinds, and nothing is claimed and no
   * capacity is spent. Sending a degraded body would be worse than sending
   * none — the footer is a legal requirement and the link is the only thing
   * that makes a send measurable.
   */
  const athlete = ATHLETE_FOR_CONTENT.get(context.athleteId);
  const content = resolveWireContent({
    reviewedSubject: message.subject,
    reviewedBody: message.body,
    athleteName: athlete?.full_name,
    publicSlug: athlete?.public_slug,
    trackingToken: outreach.token,
  });

  /* ---- 7. the execution record, holding the frozen wire content ---------- */
  /**
   * `subject` and `body_hash` now describe WHAT WILL ACTUALLY BE TRANSMITTED,
   * which is what those columns have always meant everywhere else — the legacy
   * path passes its footed, link-substituted body to this same function. The
   * exact bytes go in `body` beside them and their un-normalised digest in
   * `wire_body_sha256`.
   *
   * After this, a transport ENCODES an email. It does not decide one.
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
    body: content.body,
    subject: content.subject,
    /** The same bytes again, to be KEPT rather than only hashed. */
    wireBody: content.body,
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
    /**
     * RESERVED, NOT YET SPENT — D5.0.
     *
     * The row is written before the provider is reached, exactly as it always
     * has been, and it counts against both ceilings from this instant. What
     * changes is that it now says so: a later settlement records whether the
     * capacity was actually consumed, and the one case that releases it is a
     * transport that PROVES it never submitted anything.
     *
     * A ROW LEFT AT RESERVED KEEPS COUNTING, for ever if need be. That is the
     * fail-closed direction and D5.0 deliberately does not sweep it — see the
     * vocabulary note in outboundBudget.js.
     */
    disposition: OUTBOUND_ATTEMPT_DISPOSITION.RESERVED,
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
    /**
     * WHAT A TRANSPORT NEEDS, READ BACK FROM THE COMMITTED ROW — D4.7.
     *
     * Read back rather than assembled from the variables that wrote it, so a
     * caller is holding what is DURABLE and not what was intended. A transport
     * may equally ask for it later by send id — see `executionSnapshot` — and
     * both return the same rows, because there is one source.
     */
    execution: executionSnapshot(sendId),
  };
});

/* -------------------------------------------------------------------------- */
/* The frozen payload a transport is allowed to send — D4.7                    */
/* -------------------------------------------------------------------------- */

/**
 * THE RECIPIENT COMES FROM IMMUTABLE EXECUTION TRUTH, NOT FROM A SECOND COLUMN
 * AND NOT FROM `coaches.email`.
 *
 * `programme_messages.recipient_email` is NOT NULL, is never updated by any
 * writer in this build, and belongs to a row whose `reviewed` state is terminal
 * — so it cannot move after the claim proved it equal to the coach's live
 * address. `coaches.email` CAN move, which is the entire reason
 * RECIPIENT_EMAIL_CHANGED exists, so reading it here would reintroduce exactly
 * the drift the claim just refused.
 *
 * Joined rather than copied onto `outreach_send`: duplicating an
 * already-frozen fact only creates a second place for it to be wrong.
 *
 * (No backticks in the SQL below: it is a JS template literal.)
 */
const SNAPSHOT_FOR_TRANSPORT = db.prepare(`
  SELECT s.id, s.subject, s.body, s.body_hash, s.wire_body_sha256,
         s.state, s.connected_mailbox_id, s.sending_identity, s.provider,
         s.internet_message_id, s.programme_message_id,
         m.recipient_email AS recipient_email,
         b.provider_account_id AS provider_account_id,
         b.operator_user_id AS operator_user_id
    FROM outreach_send s
    LEFT JOIN programme_messages m ON m.id = s.programme_message_id
    LEFT JOIN connected_mailboxes b ON b.id = s.connected_mailbox_id
   WHERE s.id = ?
`);

/**
 * EVERYTHING FROZEN FOR ONE EXECUTION, AND NOTHING DERIVED NOW.
 *
 * The one durable source a transport reads. It must never re-run
 * `resolveWireContent`: the helper is deterministic in its INPUTS, and five of
 * those inputs are mutable — the athlete's name and slug, and three
 * environment variables. Re-deriving after any of them moved would transmit
 * bytes that no row on file attests to.
 *
 * `complete` is the transport's gate. A row missing the frozen body or its
 * digest is a row nothing may be sent for, whatever else is on it.
 */
export function executionSnapshot(sendId) {
  const row = SNAPSHOT_FOR_TRANSPORT.get(sendId);
  if (!row) return null;
  return {
    sendId: row.id,
    recipientEmail: row.recipient_email ?? null,
    subject: row.subject ?? null,
    body: row.body ?? null,
    bodyHash: row.body_hash ?? null,
    wireBodySha256: row.wire_body_sha256 ?? null,
    state: row.state,
    mailboxId: row.connected_mailbox_id ?? null,
    sendingIdentity: row.sending_identity ?? null,
    provider: row.provider ?? null,
    programmeMessageId: row.programme_message_id ?? null,
    /**
     * THE PROVIDER'S OWN IMMUTABLE ID FOR THE SENDING ACCOUNT — D5.1.
     *
     * Joined from `connected_mailboxes`, not copied onto `outreach_send`:
     * duplicating an already-durable fact only creates a second place for it to
     * be wrong, which is the same argument `recipient_email` is joined for.
     *
     * A provider adapter compares this against the `sub` of whatever account
     * its credential actually authenticates. That comparison is the one that
     * catches the serious case — a token belonging to a DIFFERENT account —
     * where the address comparison only catches drift.
     */
    providerAccountId: row.provider_account_id ?? null,
    /**
     * WHOSE AUTHORITY READS THE CREDENTIAL — D5.1, and derived rather than
     * denormalised.
     *
     * ---------------------------------------------------------------------
     * WHY NO `outreach_send.authorised_by_operator_id` COLUMN WAS ADDED.
     *
     * `mailboxCredential(id, { operatorUserId })` must be scoped to an
     * operator, so a provider adapter needs one. The question was whether the
     * existing chain can supply it durably, and it can, through a single join:
     *
     *   outreach_send.connected_mailbox_id -> connected_mailboxes.operator_user_id
     *
     * Every link is immutable. `connected_mailbox_id` has no ON DELETE clause,
     * so removing the mailbox is refused. `operator_user_id` is NOT NULL, is
     * absent from `UPDATABLE` in connectedMailboxes.js, is written once by
     * `createConnectedMailbox` and is updated by nothing in the codebase — the
     * schema says ownership "is never nulled and never reassigned", and a
     * migration deliberately removed an ON DELETE CASCADE from it so that
     * deleting an operator is refused while a mailbox references them.
     *
     * AND THERE IS NO SECOND AUTHORITY TO DISAGREE WITH. `campaigns` carries no
     * operator column and neither does `players`; `connected_mailboxes` and
     * `mailbox_consent_grants` are the only tables in the schema that hold an
     * `operator_user_id` at all. So there is exactly one answer to "whose
     * mailbox is this", and no reconciliation is required.
     *
     * The claim has already proved this operator held this mailbox — `mailbox()`
     * is scoped by operator and refuses otherwise — so the row cannot point at
     * a mailbox some other operator owned.
     *
     * A copied column would have added a second, staler copy of an immutable
     * fact, for no gain.
     * ---------------------------------------------------------------------
     */
    operatorUserId: row.operator_user_id ?? null,
    /**
     * COMPLETE MEANS TRANSPORTABLE, and D5.1 raises the bar to match what a
     * real provider needs: without the account id there is nothing to verify
     * the credential's identity against, and without the operator there is no
     * authority under which to read it. A partial row must fail here rather
     * than half-way through a send.
     */
    complete: Boolean(
      row.body && row.wire_body_sha256 && row.subject
      && row.recipient_email && row.connected_mailbox_id
      && row.sending_identity && row.provider
      && row.provider_account_id && row.operator_user_id,
    ),
  };
}
