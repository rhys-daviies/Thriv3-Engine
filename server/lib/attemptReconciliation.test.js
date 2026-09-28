import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/client.js';
import { materialiseNextContactAttempt, programmePursuitPlan, PURSUIT_ACTION, PURSUIT_REASON,
  MESSAGES_PER_COACH, TIER_COACH_DEPTH, FOLLOW_UP_DELAY_DAYS } from './pursuitPolicy.js';
import { followUpTiming } from './followUpTiming.js';
import { generateProgrammeMessage, GENERATION_REFUSAL } from './programmeMessageGeneration.js';
import { reviewProgrammeMessage, programmeMessage } from './programmeMessages.js';
import { claimProgrammeMessageForExecution, executionSnapshot, CLAIM_REFUSAL } from './executionClaim.js';
import {
  attemptForCoach, reconcileProgrammeContactAttempt, transitionContactAttempt, ATTEMPT_STATE,
} from './contactAttempts.js';
import { attemptSend, fakeTransport, TRANSPORT_OUTCOME } from './outboundTransport.js';
import { persistTransportResult } from './executionResult.js';
import { recoverPriorRunSendingClaims } from './executionRecovery.js';
import { RUN_ID } from './executionRun.js';
import { sendById, claimSendForExecution, unresolvedSendFor } from './outreachSend.js';
import { findOrCreateCoach } from './coaches.js';
import { MESSAGE_STATE } from '../../shared/outreachMessageState.js';

/**
 * D4.8 — THE CAMPAIGN'S OWN BOOKKEEPING, MADE TRUE AFTER THE FACT.
 *
 * ===========================================================================
 * THREE THINGS, AND THEY ALL COME FROM THE SAME PLACE.
 *
 * D4.7 commits a provider acceptance in its own transaction and does the
 * campaign bookkeeping afterwards, so that a broken campaign table can never
 * unwind the record of a real email. The cost of that decision is that the
 * bookkeeping CAN be missed — so it has to be derivable rather than counted.
 *
 * Everything here derives from durable ACCEPTED `outreach_send` rows:
 *
 *   step    accepted + 1, the NEXT step eligible
 *   state   one accepted message is the whole difference between planned
 *           and active
 *   timing  the four-day follow-up clock starts at that message's sent_at,
 *           and at nothing else
 *
 * FAILED and UNKNOWN_PROVIDER_RESULT feed none of the three. A refused send is
 * not a message, and a send nobody can account for is certainly not one.
 * ===========================================================================
 *
 * NOTHING HERE SENDS ANYTHING. The only transport is the fake.
 */


const ATHLETE = 'a-d45';
const OTHER_ATHLETE = 'a-d45-other';
const OPERATOR = 'op-d45';
const OTHER_OPERATOR = 'op-d45-2';
const TODAY = '2026-09-18';
const NOW = '2026-09-18T09:00:00.000Z';
const RUN = 'run-d45-0001';
const COLLEGE = 'Duke';
const LATER = '2026-09-22T09:00:00.000Z';
const LATER_DAY = '2026-09-22';
let seq = 0;

/* -------------------------------------------------------------------------- */
/* Fixtures — the real chain, through the real writers                         */
/* -------------------------------------------------------------------------- */

function athlete(id = ATHLETE) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug,
      nationality, recruiting_class_year, gpa)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'DEFENSE', 'mens-soccer', ?, 'New Zealand', 2027, 3.8)
  `).run(id, randomUUID().slice(0, 10));
}

function operator(id) {
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, active, created_at)
    VALUES (?, ?, 'scrypt$fake', 1, 'x')
  `).run(id, `${id}@thriv3.test`);
}

function campaign({ id = `camp-${++seq}`, state = 'active', startsOn = '2020-01-01', outreachEndsOn = null } = {}) {
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, outreach_ends_on, created_at,
      updated_at, snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, ?, ?, 'x', 'x', 'x', 1)
  `).run(id, ATHLETE, state, startsOn, outreachEndsOn);
  return id;
}

function programme(campaignId, { id = `pc-${++seq}`, college = COLLEGE, staff = 2 } = {}) {
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', ?, 82, 'A', 'AUTO', 'queued', 'x', 'x')
  `).run(id, campaignId, college, ++seq);
  const coaches = [];
  for (let i = 0; i < staff; i += 1) {
    coaches.push(findOrCreateCoach({
      full_name: `${String.fromCharCode(65 + i)} Coach`,
      email: `c${++seq}@${college.toLowerCase().replace(/\W/g, '')}.edu`,
      school: college, sport: 'mens-soccer', division: 'NCAA D1',
      position_title: i === 0 ? 'Head Coach' : 'Assistant Coach',
    }));
  }
  return { id, coaches };
}

/** Roster history the engine can licence, so the composition is a real one. */
function rosterFor(college = COLLEGE) {
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference)
    VALUES (?, 'x', 'x', ?, 'mens-soccer', 'NCAA D1', 'ACC')
  `).run(randomUUID(), college);
  for (const [name, season] of [['Hayden Aish', '2024'], ['Jack Kelly', '2023']]) {
    db.prepare(`
      INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division,
        season, player_name, position, nationality, country, class_year_label, minutes_played,
        games_played)
      VALUES (?, 'x', 'x', ?, 'mens-soccer', 'NCAA D1', ?, ?, 'DEFENSE', 'International',
        'New Zealand', 'Junior', 900, 18)
    `).run(randomUUID(), college, season, name);
  }
}

function stance(value, { college = COLLEGE } = {}) {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state, flagged,
      visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', 'none', 0, 'default', ?, 'x', 'x')
  `).run(randomUUID(), ATHLETE, college, value);
}

/** A connected mailbox with a credential, which is what the claim requires. */
function mailboxFor({ athleteId = ATHLETE, operatorId = OPERATOR, status = 'CONNECTED', credential = true } = {}) {
  const id = `mb-${randomUUID()}`;
  db.prepare(`
    INSERT INTO connected_mailboxes (id, operator_user_id, athlete_id, provider,
      provider_account_id, email_address, status, connected_at, created_at, updated_at)
    VALUES (?, ?, ?, 'GOOGLE', ?, ?, ?, 'x', 'x', 'x')
  `).run(id, operatorId, athleteId, randomUUID(), `  Athlete${++seq}@Example.COM  `, status);
  if (credential) {
    db.prepare(`
      INSERT INTO connected_mailbox_credentials (mailbox_id, ciphertext, iv, auth_tag, key_version,
        rotated_at, created_at, updated_at)
      VALUES (?, 'ct', 'iv', 'tag', 'v1', 'x', 'x', 'x')
    `).run(id);
  }
  return id;
}

/** Prepared, composed and APPROVED — the state a claim starts from. */
function reviewed({ college = COLLEGE, campaignOpts = {} } = {}) {
  const c = campaign(campaignOpts);
  const { id: pc, coaches } = programme(c, { college });
  rosterFor(college);
  materialiseNextContactAttempt({ programmeCampaignId: pc });
  const { message } = generateProgrammeMessage({
    programmeCampaignId: pc, coachId: coaches[0].id,
  });
  reviewProgrammeMessage(message.id, { operatorId: OPERATOR });
  return { c, pc, coaches, head: coaches[0], messageId: message.id };
}


const rows = (t) => db.prepare(`SELECT * FROM ${t}`).all();
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

/** Everything the claim could touch, so a refusal can be shown to touch none of it. */
const TABLES = [
  'outreach', 'outreach_send', 'outreach_send_event', 'outbound_send_attempt',
  'programme_messages', 'programme_contact_attempts', 'programme_campaigns', 'campaigns',
  'connected_mailboxes', 'coaches',
];
const snapshot = () => JSON.stringify(Object.fromEntries(TABLES.map((t) => [t, rows(t)])));

beforeEach(() => {
  /**
   * ORDER MATTERS, and D4.5 is the reason. A claim LINKS the contact attempt to
   * the lifetime relationship, so `programme_contact_attempts.outreach_id` is
   * no longer always null — and deleting `outreach` first now fails the foreign
   * key rather than passing by luck.
   */
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach_evidence;
           DELETE FROM programme_messages; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM campaign_first_touch_approvals; DELETE FROM athlete_programmes;
           DELETE FROM connected_mailbox_credentials; DELETE FROM connected_mailboxes;
           DELETE FROM operator_sessions; DELETE FROM operator_users;
           DELETE FROM roster_players; DELETE FROM colleges; DELETE FROM coaches;
           DELETE FROM suppressions; DELETE FROM players;`);
  athlete();
  athlete(OTHER_ATHLETE);
  operator(OPERATOR);
  operator(OTHER_OPERATOR);
  seq = 0;
});

const claim = (messageId, mailboxId, over = {}) => claimProgrammeMessageForExecution({
  programmeMessageId: messageId,
  operatorUserId: OPERATOR,
  connectedMailboxId: mailboxId,
  at: NOW,
  onDate: TODAY,
  ...over,
});

/** Claim, run the fake, persist. One whole execution, with a chosen outcome. */
async function execute(messageId, mailboxId, { outcome = TRANSPORT_OUTCOME.ACCEPTED, at = NOW, onDate = TODAY } = {}) {
  const cl = claim(messageId, mailboxId, { at, onDate });
  const snap = executionSnapshot(cl.send.id);
  const result = await attemptSend(fakeTransport({ outcome }), {
    mailboxId, to: snap.recipientEmail, subject: snap.subject, body: snap.body,
    threadRef: null, idempotencyKey: cl.send.id,
  });
  const persisted = persistTransportResult(cl.send.id, result, { at });
  return { sendId: cl.send.id, persisted };
}

const attemptOf = (pc, coachId) => attemptForCoach(pc, coachId);
const planOn = (pc, onDate) => programmePursuitPlan({ programmeCampaignId: pc, onDate });
const codeOf = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const refusal = (fn) => { try { fn(); return null; } catch (err) { return err.code; } };

/* ========================================================================== */
/* RECONCILIATION                                                              */
/* ========================================================================== */

describe('reconciliation derives the attempt from accepted sends', () => {
  it('leaves an attempt with nothing accepted at planned, step 1', () => {
    const { pc, head } = reviewed();
    const out = reconcileProgrammeContactAttempt(attemptOf(pc, head.id).id);

    expect(out).toMatchObject({ reconciled: true, acceptedCount: 0, derivedStep: 1, drift: false });
    expect(attemptOf(pc, head.id)).toMatchObject({ state: ATTEMPT_STATE.PLANNED, step: 1 });
  });

  it('makes the first accepted message activate the pursuit at step 2', async () => {
    const { pc, head, messageId } = reviewed();
    await execute(messageId, mailboxFor());

    expect(attemptOf(pc, head.id)).toMatchObject({ state: ATTEMPT_STATE.ACTIVE, step: 2 });
  });

  it('carries a second accepted message to step 3, still active', async () => {
    const { pc, head, messageId } = reviewed();
    await execute(messageId, mailboxFor());
    const { message: m2 } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id });
    reviewProgrammeMessage(m2.id, { operatorId: OPERATOR });
    await execute(m2.id, mailboxFor(), { at: LATER, onDate: LATER_DAY });

    expect(attemptOf(pc, head.id)).toMatchObject({ state: ATTEMPT_STATE.ACTIVE, step: 3 });
  });

  it('is idempotent — running it five more times changes nothing', async () => {
    const { pc, head, messageId } = reviewed();
    await execute(messageId, mailboxFor());
    const after = JSON.stringify(attemptOf(pc, head.id));

    for (let i = 0; i < 5; i += 1) reconcileProgrammeContactAttempt(attemptOf(pc, head.id).id);

    expect(JSON.stringify(attemptOf(pc, head.id))).toBe(after);
  });

  /**
   * THE CASE D4.7 CREATED ON PURPOSE. The acceptance committed, the bookkeeping
   * did not. Nothing is lost, because the answer was never in the counter.
   */
  it('repairs bookkeeping that was missed entirely', async () => {
    const { pc, head, messageId } = reviewed();
    await execute(messageId, mailboxFor());

    // Wind the attempt back to what a missed TXN 2b would have left behind.
    db.prepare("UPDATE programme_contact_attempts SET step = 1, state = 'planned'").run();
    expect(attemptOf(pc, head.id)).toMatchObject({ state: 'planned', step: 1 });

    const out = reconcileProgrammeContactAttempt(attemptOf(pc, head.id).id);

    expect(out).toMatchObject({ reconciled: true, acceptedCount: 1, derivedStep: 2 });
    expect(attemptOf(pc, head.id)).toMatchObject({ state: ATTEMPT_STATE.ACTIVE, step: 2 });
  });

  /** A step ahead of the evidence is not corrected — it is the only record of itself. */
  it('never decrements a stored step, and reports the drift', () => {
    const { pc, head } = reviewed();
    db.prepare('UPDATE programme_contact_attempts SET step = 7').run();

    const out = reconcileProgrammeContactAttempt(attemptOf(pc, head.id).id);

    expect(out.derivedStep).toBe(1);
    expect(out.step).toBe(7);
    expect(out.drift).toBe(true);
    expect(attemptOf(pc, head.id).step).toBe(7);
  });

  it('leaves a stopped pursuit stopped, and still reports what it would be', async () => {
    const { pc, head, messageId } = reviewed();
    await execute(messageId, mailboxFor());
    transitionContactAttempt(attemptOf(pc, head.id).id, ATTEMPT_STATE.STOPPED, { reason: 'operator' });

    const out = reconcileProgrammeContactAttempt(attemptOf(pc, head.id).id);

    expect(out).toMatchObject({ reconciled: false, reason: 'STOPPED', acceptedCount: 1, derivedStep: 2 });
    expect(attemptOf(pc, head.id).state).toBe(ATTEMPT_STATE.STOPPED);
  });

  it('answers NO_ATTEMPT rather than throwing for an id it does not know', () => {
    expect(reconcileProgrammeContactAttempt(randomUUID()))
      .toMatchObject({ reconciled: false, reason: 'NO_ATTEMPT' });
  });

  /** Execution truth is what it derives FROM, never something it may edit. */
  it('never rewrites a provider execution state', async () => {
    const { pc, head, messageId } = reviewed();
    const { sendId } = await execute(messageId, mailboxFor());
    const before = JSON.stringify(sendById(sendId));

    reconcileProgrammeContactAttempt(attemptOf(pc, head.id).id);

    expect(JSON.stringify(sendById(sendId))).toBe(before);
    const code = codeOf('server/lib/contactAttempts.js');
    expect(code).not.toMatch(/UPDATE\s+outreach_send/i);
    expect(code).not.toMatch(/transitionSend|persistTransportResult/);
  });

  /** Only ACCEPTED counts — proven against every other state in one table. */
  for (const [label, outcome] of [
    ['rejected', TRANSPORT_OUTCOME.REJECTED], ['unresolved', TRANSPORT_OUTCOME.UNKNOWN],
  ]) {
    it(`does not count a ${label} send as a message`, async () => {
      const { pc, head, messageId } = reviewed();
      await execute(messageId, mailboxFor(), { outcome });

      const out = reconcileProgrammeContactAttempt(attemptOf(pc, head.id).id);
      expect(out.acceptedCount).toBe(0);
      expect(out.derivedStep).toBe(1);
      expect(attemptOf(pc, head.id)).toMatchObject({ state: ATTEMPT_STATE.PLANNED, step: 1 });
    });
  }
});

/* ========================================================================== */
/* THE FOUR-DAY FOLLOW-UP — enforced on the WRITE path                         */
/* ========================================================================== */

describe('a follow-up waits its four days', () => {
  /** Accept message 1, compose and approve message 2. The clock starts at NOW. */
  async function readyForFollowUp() {
    const ctx = reviewed();
    const mailboxId = mailboxFor();
    await execute(ctx.messageId, mailboxId);
    const { message: m2 } = generateProgrammeMessage({
      programmeCampaignId: ctx.pc, coachId: ctx.head.id,
    });
    reviewProgrammeMessage(m2.id, { operatorId: OPERATOR });
    return { ...ctx, mailboxId, followUpId: m2.id };
  }

  /** TODAY is 2026-09-18, so the fourth day is 2026-09-22 — inclusive. */
  const BEFORE = ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'];
  const ON_OR_AFTER = ['2026-09-22', '2026-09-23'];

  for (const d of BEFORE) {
    it(`refuses a follow-up on ${d}, before the fourth day`, async () => {
      const { followUpId, mailboxId } = await readyForFollowUp();
      const code = refusal(() => claim(followUpId, mailboxId, { at: `${d}T09:00:00.000Z`, onDate: d }));
      expect(code).toBe(CLAIM_REFUSAL.FOLLOW_UP_NOT_DUE);
    });
  }

  for (const d of ON_OR_AFTER) {
    it(`allows a follow-up on ${d}`, async () => {
      const { followUpId, mailboxId } = await readyForFollowUp();
      expect(refusal(() => claim(followUpId, mailboxId, { at: `${d}T09:00:00.000Z`, onDate: d }))).toBe(null);
    });
  }

  /** An initial message has no preceding acceptance and therefore no clock. */
  it('does not delay a first message', () => {
    const { messageId } = reviewed();
    expect(refusal(() => claim(messageId, mailboxFor()))).toBe(null);
  });

  it('spends no capacity and claims nothing when it refuses', async () => {
    const { followUpId, mailboxId } = await readyForFollowUp();
    const sendsBefore = count('outreach_send');
    const ledgerBefore = count('outbound_send_attempt');

    expect(refusal(() => claim(followUpId, mailboxId, { at: NOW, onDate: TODAY })))
      .toBe(CLAIM_REFUSAL.FOLLOW_UP_NOT_DUE);

    expect(count('outreach_send')).toBe(sendsBefore);
    expect(count('outbound_send_attempt')).toBe(ledgerBefore);
    expect(db.prepare("SELECT COUNT(*) n FROM outreach_send WHERE state='SENDING'").get().n).toBe(0);
  });

  /** The rule has one implementation, and the claim imports it. */
  it('uses the shared timing authority rather than its own constant', () => {
    const code = codeOf('server/lib/executionClaim.js');
    expect(code).toMatch(/followUpTiming/);
    expect(code).not.toMatch(/FOLLOW_UP_DELAY_DAYS|86_?400_?000|\b4\s*\*\s*24/);
    // And the planning screen reads the same function from the same module.
    expect(codeOf('server/lib/campaignExecution.js')).toMatch(/from '\.\/followUpTiming\.js'/);
  });

  /** Calendar days, inclusive of the fourth — preserved exactly, not reinterpreted. */
  it('keeps the existing calendar-day semantics', () => {
    const coach = { lastAcceptedAt: '2026-09-18T23:59:59.000Z' };
    expect(followUpTiming(coach, '2026-09-21').due).toBe(false);
    expect(followUpTiming(coach, '2026-09-22').due).toBe(true);
    expect(followUpTiming(coach, '2026-09-22').policyEligibleOn).toBe('2026-09-22');
    expect(FOLLOW_UP_DELAY_DAYS).toBe(4);
    // No anchor is not "due now".
    expect(followUpTiming({ lastAcceptedAt: null }, '2030-01-01'))
      .toEqual({ policyEligibleOn: null, due: false, unresolved: true });
  });

  /** Only an ACCEPTED send is an anchor. */
  for (const [label, outcome] of [
    ['a rejected', TRANSPORT_OUTCOME.REJECTED], ['an unresolved', TRANSPORT_OUTCOME.UNKNOWN],
  ]) {
    it(`is not started by ${label} send`, async () => {
      const { pc, head, messageId } = reviewed();
      await execute(messageId, mailboxFor(), { outcome });
      const plan = planOn(pc, TODAY);
      const coach = (plan.current ?? {});
      expect(coach.lastAcceptedAt ?? null).toBe(null);
      expect(followUpTiming(coach, '2030-01-01').unresolved).toBe(true);
    });
  }
});

/* ========================================================================== */
/* UNKNOWN — the truth arrives earlier now                                     */
/* ========================================================================== */

describe('an unresolved send stops the programme', () => {
  async function unresolvedWorld() {
    const ctx = reviewed();
    const mailboxId = mailboxFor();
    await execute(ctx.messageId, mailboxId, { outcome: TRANSPORT_OUTCOME.UNKNOWN });
    return { ...ctx, mailboxId };
  }

  it('reports it as awaiting an operator, not as a first contact', async () => {
    const { pc, head } = await unresolvedWorld();
    const plan = planOn(pc, TODAY);

    expect(plan.nextAction).toBe(PURSUIT_ACTION.AWAITING_OPERATOR);
    expect(plan.reason).toBe(PURSUIT_REASON.UNRESOLVED_SEND);
    expect(plan.step).toBe(null);
    /* The coach who needs reconciling, not the next one down the list. */
    expect(plan.current.coachId).toBe(head.id);
    expect(plan.current.unresolvedSends).toBe(1);
  });

  it('refuses to generate another message for that coach', async () => {
    const { pc, head } = await unresolvedWorld();
    const code = refusal(() => generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id }));
    expect(code).toBe(GENERATION_REFUSAL.RELATIONSHIP_HAS_UNRESOLVED_SEND);
  });

  it('does not move to another coach to escape the ambiguity', async () => {
    const { pc, coaches } = await unresolvedWorld();
    const plan = planOn(pc, TODAY);
    expect(plan.current.coachId).not.toBe(coaches[1].id);

    const before = count('programme_contact_attempts');
    try { materialiseNextContactAttempt({ programmeCampaignId: pc }); } catch { /* refusal is fine */ }
    expect(count('programme_contact_attempts')).toBe(before);
  });

  it('cannot be re-claimed, and never through a raw database error', async () => {
    const { messageId, mailboxId } = await unresolvedWorld();
    const code = refusal(() => claim(messageId, mailboxId, { at: LATER, onDate: LATER_DAY }));
    expect(code).toBe(CLAIM_REFUSAL.MESSAGE_ALREADY_EXECUTED);
    expect(code).not.toMatch(/SQLITE/);
  });

  /**
   * A MESSAGE COMPOSED BEFORE THE AMBIGUITY APPEARED, claimed after it did —
   * which is the only way this gate is reachable, since generation now refuses.
   *
   * It must name the ambiguity. The unresolved relationship makes the plan
   * return a null step, so an earlier ordering of the checks refused this with
   * CONTACT_ATTEMPT_STEP_DRIFT — true about the counters, and silent about the
   * message that may be in a coach's inbox.
   */
  it('blocks a message composed before the ambiguity, naming the ambiguity', async () => {
    const ctx = reviewed();
    const mailboxId = mailboxFor();
    // Message 2 is composed and approved while the world is still clean.
    await execute(ctx.messageId, mailboxId);
    const { message: m2 } = generateProgrammeMessage({
      programmeCampaignId: ctx.pc, coachId: ctx.head.id,
    });
    reviewProgrammeMessage(m2.id, { operatorId: OPERATOR });

    // Then the first message's outcome turns out to be unknowable.
    db.prepare("UPDATE outreach_send SET state = 'UNKNOWN_PROVIDER_RESULT', sent_at = NULL").run();

    const code = refusal(() => claim(m2.id, mailboxId, { at: LATER, onDate: LATER_DAY }));

    expect(code).toBe(CLAIM_REFUSAL.RELATIONSHIP_HAS_UNRESOLVED_SEND);
    expect(code).not.toBe(CLAIM_REFUSAL.CONTACT_ATTEMPT_STEP_DRIFT);
    expect(count('outbound_send_attempt')).toBe(1);
  });

  it('spends no further capacity and opens no new send row', async () => {
    const { pc, head } = await unresolvedWorld();
    expect(count('outbound_send_attempt')).toBe(1);
    expect(count('outreach_send')).toBe(1);
    expect(attemptOf(pc, head.id)).toMatchObject({ state: ATTEMPT_STATE.PLANNED, step: 1 });
  });

  /** A recovery-produced UNKNOWN behaves identically — same state, same authority. */
  it('behaves the same when recovery produced the UNKNOWN', async () => {
    const ctx = reviewed();
    const mailboxId = mailboxFor();
    claim(ctx.messageId, mailboxId, { runId: 'run-that-died' });
    recoverPriorRunSendingClaims({ currentRunId: RUN_ID, at: NOW });

    const plan = planOn(ctx.pc, TODAY);
    expect(plan.reason).toBe(PURSUIT_REASON.UNRESOLVED_SEND);
    expect(refusal(() => generateProgrammeMessage({ programmeCampaignId: ctx.pc, coachId: ctx.head.id })))
      .toBe(GENERATION_REFUSAL.RELATIONSHIP_HAS_UNRESOLVED_SEND);
    expect(claimSendForExecution(sendById(unresolvedSendFor(
      db.prepare('SELECT outreach_id FROM outreach_send LIMIT 1').get().outreach_id,
    ).id).id, { runId: RUN_ID, at: NOW }).claimed).toBe(false);
  });
});

/* ========================================================================== */
/* FAILED — visible, spent, and not quietly retried                            */
/* ========================================================================== */

describe('a refused send', () => {
  async function failedWorld() {
    const ctx = reviewed();
    const mailboxId = mailboxFor();
    await execute(ctx.messageId, mailboxId, { outcome: TRANSPORT_OUTCOME.REJECTED });
    return { ...ctx, mailboxId };
  }

  it('cannot be executed again as the same message', async () => {
    const { messageId, mailboxId } = await failedWorld();
    const code = refusal(() => claim(messageId, mailboxId, { at: LATER, onDate: LATER_DAY }));

    expect(code).toBe(CLAIM_REFUSAL.MESSAGE_ALREADY_EXECUTED);
    expect(code).not.toMatch(/SQLITE/);
    expect(count('outreach_send')).toBe(1);
    expect(count('outbound_send_attempt')).toBe(1);
  });

  it('advances no step and activates no pursuit', async () => {
    const { pc, head } = await failedWorld();
    expect(attemptOf(pc, head.id)).toMatchObject({ state: ATTEMPT_STATE.PLANNED, step: 1 });
  });

  it('starts no follow-up clock', async () => {
    const { pc } = await failedWorld();
    const coach = planOn(pc, TODAY).current;
    expect(coach.lastAcceptedAt).toBe(null);
    expect(coach.messagesSent).toBe(0);
  });

  /**
   * G3 — THE OPERATOR MUST NOT BE TOLD NOTHING HAPPENED.
   *
   * Additive fields on the plan's per-coach record, which is an open object.
   * `messagesSent` is untouched, so step arithmetic, coach depth and exhaustion
   * are all exactly as they were: this only stops the screen claiming a first
   * contact is pending when a send was attempted and refused.
   */
  it('is visible in the plan as an execution that happened and failed', async () => {
    const { pc } = await failedWorld();
    const coach = planOn(pc, TODAY).current;

    expect(coach.failedSends).toBe(1);
    expect(coach.unresolvedSends).toBe(0);
    expect(coach.lastFailedAt).toBeTruthy();
    /* And it is still not a message. */
    expect(coach.messagesSent).toBe(0);
    expect(coach.exhausted).toBe(false);
  });

  it('is distinguishable from a coach nobody has tried', async () => {
    const { pc, coaches } = await failedWorld();
    const plan = planOn(pc, TODAY);
    const tried = plan.coaches.find((c) => c.coachId === coaches[0].id);
    const untried = plan.coaches.find((c) => c.coachId === coaches[1].id);

    expect(tried.failedSends).toBe(1);
    expect(untried.failedSends).toBe(0);
    expect(tried.messagesSent).toBe(untried.messagesSent);
  });

  it('does not move the campaign to another coach by itself', async () => {
    const { pc, head } = await failedWorld();
    expect(planOn(pc, TODAY).current.coachId).toBe(head.id);
  });

  /** No automatic retry exists anywhere — a retry is a fresh decision. */
  it('is retried by nothing automatic', () => {
    for (const rel of [
      'server/lib/executionResult.js', 'server/lib/executionClaim.js',
      'server/lib/contactAttempts.js', 'server/lib/pursuitPolicy.js',
    ]) {
      const code = codeOf(rel);
      expect(code, rel).not.toMatch(/retry|backoff|requeue|resend/i);
    }
  });
});

/* ========================================================================== */
/* GENERATION — the gate widened with ACTIVE, and only with ACTIVE             */
/* ========================================================================== */

describe('which pursuits produce content', () => {
  it('generates the first message from a planned attempt', () => {
    const { pc, head, messageId } = reviewed();
    expect(attemptOf(pc, head.id).state).toBe(ATTEMPT_STATE.PLANNED);
    expect(programmeMessage(messageId).step).toBe(1);
  });

  it('generates the follow-up from an active attempt', async () => {
    const { pc, head, messageId } = reviewed();
    await execute(messageId, mailboxFor());
    expect(attemptOf(pc, head.id).state).toBe(ATTEMPT_STATE.ACTIVE);

    const { message: m2 } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id });
    expect(m2.step).toBe(2);
  });

  it('refuses a stopped pursuit', () => {
    const { pc, head } = reviewed();
    transitionContactAttempt(attemptOf(pc, head.id).id, ATTEMPT_STATE.STOPPED, { reason: 'operator' });
    expect(refusal(() => generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id })))
      .toBe(GENERATION_REFUSAL.CONTACT_ATTEMPT_NOT_PLANNED);
  });

  /** The schema's CHECK lists two more states. Neither is permission. */
  it('admits exactly planned and active, never waiting or completed', () => {
    const { pc, head } = reviewed();
    for (const state of ['waiting', 'completed']) {
      db.prepare('UPDATE programme_contact_attempts SET state = ? WHERE id = ?')
        .run(state, attemptOf(pc, head.id).id);
      expect(refusal(() => generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id })))
        .toBe(GENERATION_REFUSAL.CONTACT_ATTEMPT_NOT_PLANNED);
    }
  });
});

/* ========================================================================== */
/* DEPTH — untouched by any of this                                            */
/* ========================================================================== */

describe('pursuit depth is unchanged', () => {
  it('keeps three coaches for A, two for B, one for C, and two messages each', () => {
    expect(TIER_COACH_DEPTH).toEqual({ A: 3, B: 2, C: 1 });
    expect(MESSAGES_PER_COACH).toBe(2);
  });

  it('exhausts a coach after two accepted messages, not after three', async () => {
    const { pc, head, messageId } = reviewed();
    await execute(messageId, mailboxFor());
    const { message: m2 } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id });
    reviewProgrammeMessage(m2.id, { operatorId: OPERATOR });
    await execute(m2.id, mailboxFor(), { at: LATER, onDate: LATER_DAY });

    const plan = planOn(pc, LATER_DAY);
    const first = plan.coaches.find((c) => c.coachId === head.id);
    expect(first.messagesSent).toBe(2);
    expect(first.exhausted).toBe(true);
    /* Depth moves to the next PERSON, never to a third message. */
    expect(plan.current.coachId).not.toBe(head.id);
  });

  /** programme_message.step counts a campaign; outreach_send.sequence a lifetime. */
  it('keeps the campaign step distinct from the lifetime sequence', async () => {
    const { pc, head, messageId } = reviewed();
    const { sendId } = await execute(messageId, mailboxFor());
    expect(programmeMessage(messageId).step).toBe(1);
    expect(sendById(sendId).sequence).toBe(1);
    expect(attemptOf(pc, head.id).step).toBe(2);
  });
});

/* ========================================================================== */
/* SAFETY                                                                      */
/* ========================================================================== */

describe('this slice adds no execution capability', () => {
  it('imports no transport, no provider and no credential', () => {
    for (const rel of [
      'server/lib/contactAttempts.js', 'server/lib/followUpTiming.js',
      'server/lib/pursuitPolicy.js', 'server/lib/programmeMessageGeneration.js',
    ]) {
      const code = codeOf(rel);
      expect(code, rel).not.toMatch(/googleapis|google-auth|OAuth2Client|nodemailer|smtp|outlook/i);
      expect(code, rel).not.toMatch(/mailboxCredential|mailboxCrypto|decrypt/);
      expect(code, rel).not.toMatch(/fetch\(|https?:\/\/[a-z]/);
    }
  });

  it('adds no HTTP route', () => {
    const code = codeOf('server/lib/contactAttempts.js');
    expect(code).not.toMatch(/app\.(get|post|put|delete)|router\./);
  });
});
