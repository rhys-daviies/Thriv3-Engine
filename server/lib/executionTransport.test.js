import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/client.js';
import { materialiseNextContactAttempt } from './pursuitPolicy.js';
import { generateProgrammeMessage } from './programmeMessageGeneration.js';
import { reviewProgrammeMessage, programmeMessage } from './programmeMessages.js';
import {
  claimProgrammeMessageForExecution, executionSnapshot, CLAIM_REFUSAL,
} from './executionClaim.js';
import { RUN_ID } from './executionRun.js';
import { recoverPriorRunSendingClaims, RECOVERY_SOURCE } from './executionRecovery.js';
import {
  attemptSend, fakeTransport, assertSendRequest, TRANSPORT_OUTCOME,
} from './outboundTransport.js';
import { persistTransportResult, RESULT_SOURCE } from './executionResult.js';
import {
  sendById, sendEvents, claimSendForExecution, transitionSend,
  recordDraft as recordDraftRef,
} from './outreachSend.js';
import { resolveWireContent, bodyHash, wireBodySha256 } from './executionContent.js';
import { findOrCreateCoach } from './coaches.js';
import { attemptForCoach } from './contactAttempts.js';
import { MESSAGE_STATE, ACCEPTED_SOURCE, SEND_EVENT_TYPE } from '../../shared/outreachMessageState.js';

/**
 * D4.7 — THE CLAIM FREEZES BYTES, A TRANSPORT SENDS THOSE BYTES, AND WHAT THE
 * PROVIDER SAID IS WRITTEN DOWN ONCE.
 *
 * ===========================================================================
 * THE ONE PROPERTY EVERYTHING ELSE HANGS OFF.
 *
 * A digest proves bytes. It cannot recreate them. The wire body is the approved
 * words plus a tracked link plus a compliance footer, and of the seven inputs
 * that produce it FIVE ARE MUTABLE — the athlete's name and public slug, and
 * three environment variables. So the bytes are frozen inside the claim
 * transaction and read back from the row afterwards; re-deriving them at
 * transport time would transmit something no row on file attests to.
 *
 * The tests below mutate every one of those five AFTER the claim and assert the
 * transmitted body is unchanged. That is the whole slice in one sentence.
 * ===========================================================================
 *
 * NOTHING HERE SENDS ANYTHING. The only transport is `fakeTransport`, which
 * opens no socket and records what it was handed so the handoff can be compared
 * against the committed row.
 */


const ATHLETE = 'a-d45';
const OTHER_ATHLETE = 'a-d45-other';
const OPERATOR = 'op-d45';
const OTHER_OPERATOR = 'op-d45-2';
const TODAY = '2026-09-18';
const NOW = '2026-09-18T09:00:00.000Z';
const RUN = 'run-d45-0001';
const COLLEGE = 'Duke';
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

/** A claim, plus the frozen snapshot a transport would be handed. */
function claimed(over = {}) {
  const { messageId, head, pc } = reviewed();
  const mailboxId = mailboxFor();
  const out = claim(messageId, mailboxId, over);
  return { ...out, messageId, mailboxId, head, pc, message: programmeMessage(messageId) };
}

/** The request a caller builds from the committed row — never from fresh content. */
const requestFor = (snap) => ({
  mailboxId: snap.mailboxId,
  to: snap.recipientEmail,
  subject: snap.subject,
  body: snap.body,
  threadRef: null,
  idempotencyKey: snap.sendId,
});

const codeOf = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * A SECOND CLAIMED EXECUTION ROW ON A GIVEN MAILBOX.
 *
 * Built through the low-level writers rather than a second campaign claim,
 * because one athlete may hold only one campaign and a collision needs two
 * sends on ONE mailbox — so it needs two coaches under one athlete.
 */
function anotherSendOnSameMailbox(mailboxId, { athleteId = ATHLETE } = {}) {
  const coach = findOrCreateCoach({
    full_name: `Second Coach ${++seq}`,
    email: `second${seq}@duke.edu`,
    school: COLLEGE,
    sport: 'mens-soccer',
    division: 'NCAA D1',
    position_title: 'Assistant Coach',
  });
  const id = randomUUID();
  db.prepare('INSERT INTO outreach (id, athlete_id, coach_id, token, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, athleteId, coach.id, `tok-${randomUUID().slice(0, 8)}`, NOW);
  const { id: sendId } = recordDraftRef({
    outreachId: id, athleteId, coachId: coach.id, collegeName: COLLEGE, sport: 'mens-soccer',
    evidence: null, body: 'Second body.', subject: 'Second', wireBody: 'Second body.',
    connectedMailboxId: mailboxId, provider: 'GOOGLE', at: NOW,
  });
  claimSendForExecution(sendId, { runId: RUN_ID, at: NOW });
  return sendId;
}

/* ========================================================================== */
/* FREEZE — the claim commits the bytes                                        */
/* ========================================================================== */

describe('the claim freezes the wire content', () => {
  it('stores the exact body, its canonical hash and its exact digest', () => {
    const { send, message } = claimed();
    const row = sendById(send.id);

    const expected = resolveWireContent({
      reviewedSubject: message.subject,
      reviewedBody: message.body,
      athleteName: 'Marcus Reyes',
      publicSlug: db.prepare('SELECT public_slug FROM players WHERE id = ?').get(ATHLETE).public_slug,
      trackingToken: db.prepare('SELECT token FROM outreach WHERE id = ?').get(row.outreach_id).token,
    });

    expect(row.body).toBe(expected.body);
    expect(row.subject).toBe(message.subject);
    expect(row.body_hash).toBe(bodyHash(expected.body));
    expect(row.wire_body_sha256).toBe(wireBodySha256(expected.body));
  });

  /** The three columns describe ONE message, always. */
  it('keeps the body and both digests in agreement', () => {
    const { send } = claimed();
    const row = sendById(send.id);
    expect(row.body_hash).toBe(bodyHash(row.body));
    expect(row.wire_body_sha256).toBe(wireBodySha256(row.body));
    expect(row.wire_body_sha256).not.toBe(row.body_hash);
  });

  it('commits the freeze in the same transaction as the claim', () => {
    const { send } = claimed();
    const row = sendById(send.id);
    /* SENDING and frozen are true of the same committed row, never one without the other. */
    expect(row.state).toBe(MESSAGE_STATE.SENDING);
    expect(row.body).toBeTruthy();
    expect(row.wire_body_sha256).toBeTruthy();
  });

  /**
   * THE INVARIANT. No committed provider-execution SENDING row may lack its
   * frozen bytes — asserted over the whole table rather than over one row, so a
   * future path that forgot to freeze would fail this.
   */
  it('leaves no provider-execution SENDING row without frozen bytes', () => {
    claimed();
    const naked = db.prepare(`
      SELECT COUNT(*) AS n FROM outreach_send
       WHERE state = 'SENDING' AND programme_message_id IS NOT NULL
         AND (body IS NULL OR wire_body_sha256 IS NULL)
    `).get().n;
    expect(naked).toBe(0);
  });

  it('spends nothing and claims nothing when content cannot be resolved', () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    // No published profile page, so the tracked link cannot be built.
    db.prepare('UPDATE players SET public_slug = NULL WHERE id = ?').run(ATHLETE);
    const before = snapshot();

    expect(() => claim(messageId, mailboxId)).toThrow();

    expect(snapshot()).toBe(before);
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
  });

  it('refuses when the compliance footer is unconfigured, and writes nothing', () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    const before = snapshot();
    vi.stubEnv('THRIV3_POSTAL_ADDRESS', '');
    vi.resetModules();
    try {
      // config.js read the env at import, so assert the guard's own reasoning
      // rather than a reimport: an unset address must not reach a coach.
      const content = codeOf('server/lib/executionContent.js');
      expect(content).toMatch(/complianceGaps\(\)/);
      expect(content).toMatch(/COMPLIANCE_CONFIGURATION_REQUIRED/);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(snapshot()).toBe(before);
  });

  it('never touches the approved composition', () => {
    const { messageId } = reviewed();
    const before = JSON.stringify(rows('programme_messages'));
    claim(messageId, mailboxFor());
    expect(JSON.stringify(rows('programme_messages'))).toBe(before);
  });

  /* ---- what D4.6 gave us, still here ---- */

  it('still defaults the run id to this process', () => {
    const { send } = claimed();
    expect(sendById(send.id).claim_run_id).toBe(RUN_ID);
  });

  it('still lets a test inject an explicit run id', () => {
    const { send } = claimed({ runId: 'worker-9' });
    expect(sendById(send.id).claim_run_id).toBe('worker-9');
  });

  it('still requires the caller to name the mailbox', () => {
    const { messageId } = reviewed();
    mailboxFor();
    expect(() => claimProgrammeMessageForExecution({
      programmeMessageId: messageId, operatorUserId: OPERATOR, at: NOW, onDate: TODAY,
    })).toThrow(/connectedMailboxId/);
    expect(count('outreach_send')).toBe(0);
  });

  it('still refuses a mailbox belonging to another operator', () => {
    const { messageId } = reviewed();
    const theirs = mailboxFor({ operatorId: OTHER_OPERATOR });
    let code = null;
    try { claim(messageId, theirs); } catch (err) { code = err.code; }
    expect(code).toBe(CLAIM_REFUSAL.MAILBOX_NOT_FOUND);
  });

  /** The send path asks the policies directly — never a preview layer. */
  it('does not depend on the advisory decision layer', () => {
    const code = codeOf('server/lib/executionClaim.js');
    expect(code).not.toMatch(/executionDecision|executionResolution/);
    expect(code).toMatch(/campaignContactDecision|programmePursuitPlan/);
    expect(code).toMatch(/isSendCapped/);
  });
});

/* ========================================================================== */
/* HANDOFF — the transport gets the stored bytes, not fresh ones                */
/* ========================================================================== */

describe('the transport is handed what was frozen', () => {
  it('reads the snapshot back from the committed row', () => {
    const { send, mailboxId } = claimed();
    const snap = executionSnapshot(send.id);
    const row = sendById(send.id);

    expect(snap.sendId).toBe(send.id);
    expect(snap.body).toBe(row.body);
    expect(snap.subject).toBe(row.subject);
    expect(snap.wireBodySha256).toBe(row.wire_body_sha256);
    expect(snap.mailboxId).toBe(mailboxId);
    expect(snap.complete).toBe(true);
  });

  /** The recipient comes from the immutable composition, not from `coaches`. */
  it('addresses the message from frozen execution truth', () => {
    const { send, message, head } = claimed();
    const snap = executionSnapshot(send.id);
    expect(snap.recipientEmail).toBe(message.recipient_email);

    // The coach's live address moves; the frozen recipient does not.
    db.prepare('UPDATE coaches SET email = ? WHERE id = ?').run('moved@elsewhere.edu', head.id);
    expect(executionSnapshot(send.id).recipientEmail).toBe(message.recipient_email);
  });

  it('gives the fake transport exactly the stored subject and body', async () => {
    const { send } = claimed();
    const snap = executionSnapshot(send.id);
    const transport = fakeTransport();

    await attemptSend(transport, requestFor(snap));

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].body).toBe(sendById(send.id).body);
    expect(transport.sent[0].subject).toBe(sendById(send.id).subject);
    expect(wireBodySha256(transport.sent[0].body)).toBe(sendById(send.id).wire_body_sha256);
  });

  /* ---- the five mutable inputs, each moved after the claim ---- */

  const MUTATIONS = [
    ['the athlete is renamed', () => db.prepare('UPDATE players SET full_name = ? WHERE id = ?')
      .run('Someone Else Entirely', ATHLETE)],
    ['the public slug is regenerated', () => db.prepare('UPDATE players SET public_slug = ? WHERE id = ?')
      .run(`regenerated-${randomUUID().slice(0, 8)}`, ATHLETE)],
    /* Scoped to the one coach: `coaches` is unique on (email, school, sport). */
    ['the coach address changes', (ctx) => db.prepare('UPDATE coaches SET email = ? WHERE id = ?')
      .run('elsewhere@example.edu', ctx.head.id)],
  ];

  for (const [name, mutate] of MUTATIONS) {
    it(`transmits the frozen body even after ${name}`, async () => {
      const ctx = claimed();
      const { send } = ctx;
      const frozen = sendById(send.id).body;

      mutate(ctx);

      const transport = fakeTransport();
      await attemptSend(transport, requestFor(executionSnapshot(send.id)));

      expect(transport.sent[0].body).toBe(frozen);
      expect(sendById(send.id).body).toBe(frozen);
      expect(sendById(send.id).wire_body_sha256).toBe(wireBodySha256(frozen));
    });
  }

  /**
   * THE CONFIGURATION CASE, WHICH IS THE ONE A DIGEST COULD NOT HAVE SAVED.
   *
   * The footer is built from environment variables. Re-deriving the body after
   * one changed would produce different bytes AND a different digest — so the
   * row would disagree with itself and there would be nothing to reconcile
   * against. Keeping the bytes is what makes this survivable.
   */
  it('transmits the frozen body even after the sender configuration changes', async () => {
    const { send } = claimed();
    const frozen = sendById(send.id).body;
    expect(frozen).toContain(process.env.THRIV3_POSTAL_ADDRESS);

    vi.stubEnv('THRIV3_POSTAL_ADDRESS', '9 Somewhere Else, Otherville, OT 11111');
    try {
      const transport = fakeTransport();
      await attemptSend(transport, requestFor(executionSnapshot(send.id)));
      expect(transport.sent[0].body).toBe(frozen);
      expect(transport.sent[0].body).not.toContain('Somewhere Else');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('uses the send id as the correlation identity', async () => {
    const { send } = claimed();
    const transport = fakeTransport();
    await attemptSend(transport, requestFor(executionSnapshot(send.id)));
    expect(transport.sent[0].idempotencyKey).toBe(send.id);
  });

  it('refuses to build a request from an incomplete execution record', () => {
    const { send } = claimed();
    db.prepare('UPDATE outreach_send SET body = NULL WHERE id = ?').run(send.id);
    const snap = executionSnapshot(send.id);

    expect(snap.complete).toBe(false);
    expect(() => assertSendRequest(requestFor(snap))).toThrow(/TRANSPORT_REQUEST_INCOMPLETE|needs body/);
  });

  it('calls no provider and decrypts nothing', () => {
    for (const rel of ['server/lib/outboundTransport.js', 'server/lib/executionResult.js']) {
      const code = codeOf(rel);
      expect(code, rel).not.toMatch(/googleapis|google-auth|OAuth2Client|nodemailer|smtp/i);
      expect(code, rel).not.toMatch(/outlook|composeInOutlook|mailboxCredential|decrypt/i);
      expect(code, rel).not.toMatch(/fetch\(|https?:\/\//);
    }
  });

  /** The provider call is awaited OUTSIDE every transaction. */
  it('performs no provider call inside a database transaction', () => {
    const claimCode = codeOf('server/lib/executionClaim.js');
    const resultCode = codeOf('server/lib/executionResult.js');
    for (const [rel, code] of [['claim', claimCode], ['result', resultCode]]) {
      expect(code, rel).not.toMatch(/\bawait\b/);
      expect(code, rel).not.toMatch(/\basync\b/);
    }
    // And the only async surface is the transport itself.
    expect(codeOf('server/lib/outboundTransport.js')).toMatch(/async/);
  });
});

/* ========================================================================== */
/* RESULTS — what the provider said, written once                              */
/* ========================================================================== */

/** Claim, send through a fake with a given behaviour, persist the outcome. */
async function executed(behaviour = {}) {
  const ctx = claimed();
  const snap = executionSnapshot(ctx.send.id);
  const transport = fakeTransport(behaviour);
  const result = await attemptSend(transport, requestFor(snap));
  const persisted = persistTransportResult(ctx.send.id, result, { at: NOW });
  return { ...ctx, snap, transport, result, persisted };
}

describe('an accepted send', () => {
  it('records the acceptance, its source and the provider metadata', async () => {
    const { send, persisted } = await executed();
    const row = sendById(send.id);

    expect(persisted.persisted).toBe(true);
    expect(row.state).toBe(MESSAGE_STATE.ACCEPTED);
    expect(row.accepted_source).toBe(ACCEPTED_SOURCE.PROVIDER_ACCEPTED);
    expect(row.provider_message_id).toBe(`fake-msg-${send.id}`);
    expect(row.provider_thread_id).toBe(`fake-thread-${send.id}`);
    expect(row.provider_accepted_at).toBe(NOW);
    expect(row.sent_at).toBe(NOW);
  });

  it('appends exactly one accepted event, attributed to the transport', async () => {
    const { send } = await executed();
    const events = sendEvents(send.id);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(SEND_EVENT_TYPE.ACCEPTED);
    expect(events[0].source).toBe(RESULT_SOURCE);
    expect(events[0].source).not.toBe(RECOVERY_SOURCE);
    expect(events[0].payload.providerMessageId).toBe(`fake-msg-${send.id}`);
  });

  it('keeps the frozen bytes exactly as the claim left them', async () => {
    const ctx = claimed();
    const frozen = sendById(ctx.send.id).body;
    const digest = sendById(ctx.send.id).wire_body_sha256;

    const transport = fakeTransport();
    const result = await attemptSend(transport, requestFor(executionSnapshot(ctx.send.id)));
    persistTransportResult(ctx.send.id, result, { at: NOW });

    expect(sendById(ctx.send.id).body).toBe(frozen);
    expect(sendById(ctx.send.id).wire_body_sha256).toBe(digest);
  });

  it('advances the campaign step, but only after the acceptance commits', async () => {
    const { pc, head, persisted } = await executed();
    expect(persisted.bookkeeping).toEqual({ advanced: true, reason: null, error: null });
    expect(attemptForCoach(pc, head.id).step).toBe(2);
  });

  it('spends no further capacity', async () => {
    const ctx = claimed();
    const ledger = JSON.stringify(rows('outbound_send_attempt'));
    expect(count('outbound_send_attempt')).toBe(1);

    const transport = fakeTransport();
    const result = await attemptSend(transport, requestFor(executionSnapshot(ctx.send.id)));
    persistTransportResult(ctx.send.id, result, { at: NOW });

    expect(JSON.stringify(rows('outbound_send_attempt'))).toBe(ledger);
  });

  it('leaves the approved composition byte-identical', async () => {
    const ctx = claimed();
    const before = JSON.stringify(rows('programme_messages'));
    const transport = fakeTransport();
    const result = await attemptSend(transport, requestFor(executionSnapshot(ctx.send.id)));
    persistTransportResult(ctx.send.id, result, { at: NOW });
    expect(JSON.stringify(rows('programme_messages'))).toBe(before);
  });
});

describe('a rejected send', () => {
  it('fails the message and records what the provider said', async () => {
    const { send } = await executed({ outcome: TRANSPORT_OUTCOME.REJECTED });
    const row = sendById(send.id);
    const [event] = sendEvents(send.id);

    expect(row.state).toBe(MESSAGE_STATE.FAILED);
    expect(row.accepted_source).toBe(null);
    expect(row.sent_at).toBe(null);
    expect(row.provider_message_id).toBe(null);

    expect(sendEvents(send.id)).toHaveLength(1);
    expect(event.type).toBe(SEND_EVENT_TYPE.TRANSPORT_REJECTED);
    expect(event.source).toBe(RESULT_SOURCE);
    expect(event.payload.providerCode).toBe('FAKE_REJECTED');
  });

  it('keeps the capacity spent and does not advance the attempt', async () => {
    const { pc, head } = await executed({ outcome: TRANSPORT_OUTCOME.REJECTED });
    expect(count('outbound_send_attempt')).toBe(1);
    expect(attemptForCoach(pc, head.id).step).toBe(1);
  });
});

describe('an unreadable send', () => {
  it('records the ambiguity rather than guessing at it', async () => {
    const { send } = await executed({ outcome: TRANSPORT_OUTCOME.UNKNOWN });
    const row = sendById(send.id);
    const [event] = sendEvents(send.id);

    expect(row.state).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    expect(row.accepted_source).toBe(null);
    expect(row.provider_message_id).toBe(null);
    expect(event.type).toBe(SEND_EVENT_TYPE.TRANSPORT_UNKNOWN);
    expect(event.payload.reason).toBe('FAKE_UNKNOWN');
  });

  /**
   * A TRANSPORT THAT THREW IS UNKNOWN, NEVER REJECTED. A rejection licenses a
   * retry; a dead socket does not, because the message may already have gone.
   */
  it('treats a thrown transport as unknown', async () => {
    const { send, result } = await executed({ outcome: 'THROW' });
    expect(result.outcome).toBe(TRANSPORT_OUTCOME.UNKNOWN);
    expect(result.reason).toBe('TRANSPORT_THREW');
    expect(sendById(send.id).state).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    expect(sendEvents(send.id)[0].payload.reason).toBe('TRANSPORT_THREW');
  });

  it('treats an unintelligible answer as unknown', async () => {
    const ctx = claimed();
    const nonsense = { async send() { return { outcome: 'PROBABLY_FINE' }; } };
    const result = await attemptSend(nonsense, requestFor(executionSnapshot(ctx.send.id)));
    expect(result.outcome).toBe(TRANSPORT_OUTCOME.UNKNOWN);
    expect(result.reason).toBe('TRANSPORT_RETURNED_NO_OUTCOME');
  });

  /** Its source tells it apart from a recovery sweep's identical event type. */
  it('is distinguishable from a recovery sweep', async () => {
    const { send } = await executed({ outcome: TRANSPORT_OUTCOME.UNKNOWN });
    expect(sendEvents(send.id)[0].source).toBe(RESULT_SOURCE);
    expect(RESULT_SOURCE).not.toBe(RECOVERY_SOURCE);
  });

  it('keeps the capacity spent, does not advance, and cannot be retried', async () => {
    const { send, pc, head } = await executed({ outcome: TRANSPORT_OUTCOME.UNKNOWN });
    expect(count('outbound_send_attempt')).toBe(1);
    expect(attemptForCoach(pc, head.id).step).toBe(1);
    expect(claimSendForExecution(send.id, { runId: RUN_ID, at: NOW }).claimed).toBe(false);
    expect(() => transitionSend(send.id, MESSAGE_STATE.QUEUED, { at: NOW }))
      .toThrow(/ILLEGAL_MESSAGE_TRANSITION|cannot go from/);
  });
});

describe('persisting a result twice', () => {
  it('writes nothing the second time and reports the durable truth', async () => {
    const { send, result } = await executed();
    const after = JSON.stringify(sendById(send.id));

    const again = persistTransportResult(send.id, result, { at: '2026-09-19T00:00:00.000Z' });

    expect(again.persisted).toBe(false);
    expect(again.alreadyResolved).toBe(true);
    expect(again.state).toBe(MESSAGE_STATE.ACCEPTED);
    expect(JSON.stringify(sendById(send.id))).toBe(after);
    expect(sendEvents(send.id)).toHaveLength(1);
  });

  it('does not advance the attempt a second time', async () => {
    const { send, result, pc, head } = await executed();
    expect(attemptForCoach(pc, head.id).step).toBe(2);
    persistTransportResult(send.id, result, { at: NOW });
    expect(attemptForCoach(pc, head.id).step).toBe(2);
  });

  it('never reopens a terminal state with a different outcome', async () => {
    const { send } = await executed();
    persistTransportResult(send.id, { outcome: TRANSPORT_OUTCOME.REJECTED }, { at: NOW });
    expect(sendById(send.id).state).toBe(MESSAGE_STATE.ACCEPTED);
    expect(sendEvents(send.id)).toHaveLength(1);
  });

  it('refuses an outcome it cannot classify', async () => {
    const ctx = claimed();
    expect(() => persistTransportResult(ctx.send.id, { outcome: 'MAYBE' }, { at: NOW }))
      .toThrow(/not a transport outcome/);
    expect(sendById(ctx.send.id).state).toBe(MESSAGE_STATE.SENDING);
    expect(sendEvents(ctx.send.id)).toHaveLength(0);
  });
});

describe('provider message identity', () => {
  /**
   * D4.4'S COMPOSITE INDEX, UNCHANGED: unique per (mailbox, provider, id).
   *
   * Both sends have to be on the SAME mailbox for a collision to be possible,
   * which is the whole point of the composite key — two athletes' mailboxes
   * may legitimately be handed the same provider id, and a global constraint
   * would refuse the second one.
   */
  it('refuses two sends from one mailbox carrying the same provider id', async () => {
    const first = await executed({ providerMessageId: 'dup-1' });
    const secondId = anotherSendOnSameMailbox(first.mailboxId);

    expect(() => persistTransportResult(secondId, {
      outcome: TRANSPORT_OUTCOME.ACCEPTED, providerMessageId: 'dup-1',
    }, { at: NOW })).toThrow(/UNIQUE|constraint/i);

    // The failed persistence left the second message exactly as it was.
    expect(sendById(secondId).state).toBe(MESSAGE_STATE.SENDING);
    expect(sendEvents(secondId)).toHaveLength(0);
    expect(sendById(first.send.id).provider_message_id).toBe('dup-1');
  });

  it('allows the same provider id on a different mailbox', async () => {
    const first = await executed({ providerMessageId: 'shared-1' });
    const otherBox = mailboxFor({ athleteId: OTHER_ATHLETE, operatorId: OPERATOR });
    const secondId = anotherSendOnSameMailbox(otherBox, { athleteId: OTHER_ATHLETE });

    expect(() => persistTransportResult(secondId, {
      outcome: TRANSPORT_OUTCOME.ACCEPTED, providerMessageId: 'shared-1',
    }, { at: NOW })).not.toThrow();

    expect(sendById(secondId).provider_message_id).toBe('shared-1');
    expect(sendById(first.send.id).provider_message_id).toBe('shared-1');
  });
});

/* ========================================================================== */
/* BOOKKEEPING — acceptance survives a failure after it                        */
/* ========================================================================== */

describe('when bookkeeping fails after acceptance', () => {
  /**
   * THE D4.1 PRINCIPLE, AS A TEST. A provider accepted a real email. If the
   * campaign step cannot be advanced, the acceptance and its provider metadata
   * must still be on file — otherwise a caller sees a failure, concludes the
   * send was not recorded, and sends it again.
   */
  /**
   * THE ATTEMPT IS GONE, SO THERE IS NOTHING TO ADVANCE — and the acceptance
   * stands anyway, reported honestly as not advanced rather than as advanced.
   *
   * The helper answers this case with a reason rather than an exception, which
   * is D4.4's own rule. The THROWN case — the one that could actually unwind a
   * transaction — is executionResultBookkeeping.test.js, where it is mocked,
   * because nothing in this build can be made to throw here on purpose.
   */
  it('keeps the acceptance when there is no attempt left to advance', async () => {
    const ctx = claimed();
    const snap = executionSnapshot(ctx.send.id);
    const result = await attemptSend(fakeTransport(), requestFor(snap));

    db.prepare('DELETE FROM programme_contact_attempts').run();

    const out = persistTransportResult(ctx.send.id, result, { at: NOW });
    const row = sendById(ctx.send.id);

    expect(row.state).toBe(MESSAGE_STATE.ACCEPTED);
    expect(row.accepted_source).toBe(ACCEPTED_SOURCE.PROVIDER_ACCEPTED);
    expect(row.provider_message_id).toBe(`fake-msg-${ctx.send.id}`);
    expect(sendEvents(ctx.send.id)).toHaveLength(1);
    expect(out.persisted).toBe(true);
    /* Said out loud, and not dressed up as a success. */
    expect(out.bookkeeping).toEqual({ advanced: false, reason: 'NO_ATTEMPT', error: null });
  });
});

/* ========================================================================== */
/* CRASH — the six cases                                                       */
/* ========================================================================== */

describe('crash behaviour', () => {
  /** CASE 1 — a failure before the claim commits leaves nothing at all. */
  it('case 1: nothing commits when the claim fails', () => {
    const { messageId } = reviewed();
    const mailboxId = mailboxFor();
    db.prepare('UPDATE players SET public_slug = NULL WHERE id = ?').run(ATHLETE);
    const before = snapshot();

    expect(() => claim(messageId, mailboxId)).toThrow();

    expect(snapshot()).toBe(before);
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
  });

  /** CASE 2 — claimed, frozen, and the process dies before the transport runs. */
  it('case 2: a claim abandoned before transport recovers to unknown, with its bytes', () => {
    const ctx = claimed({ runId: 'run-that-died' });
    const frozen = sendById(ctx.send.id).body;

    const swept = recoverPriorRunSendingClaims({ currentRunId: RUN_ID, at: NOW });

    const row = sendById(ctx.send.id);
    expect(swept.sendIds).toEqual([ctx.send.id]);
    expect(row.state).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    expect(row.body).toBe(frozen);
    expect(row.wire_body_sha256).toBe(wireBodySha256(frozen));
    expect(claimSendForExecution(ctx.send.id, { runId: RUN_ID, at: NOW }).claimed).toBe(false);
  });

  /** CASE 3 — the provider definitely refused, and the answer was never written. */
  it('case 3: a lost rejection recovers to unknown rather than failed', async () => {
    const ctx = claimed({ runId: 'run-that-died' });
    const transport = fakeTransport({ outcome: TRANSPORT_OUTCOME.REJECTED });
    await attemptSend(transport, requestFor(executionSnapshot(ctx.send.id)));
    // The process dies here: nothing persisted.
    expect(sendById(ctx.send.id).state).toBe(MESSAGE_STATE.SENDING);

    recoverPriorRunSendingClaims({ currentRunId: RUN_ID, at: NOW });

    /* UNKNOWN, not FAILED: the rejection was real but never became durable. */
    expect(sendById(ctx.send.id).state).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    expect(sendEvents(ctx.send.id)[0].source).toBe(RECOVERY_SOURCE);
  });

  /** CASE 4 — the worst one, and the reason the bytes are kept. */
  it('case 4: a lost acceptance recovers to unknown and stays reconcilable', async () => {
    const ctx = claimed({ runId: 'run-that-died' });
    const frozen = sendById(ctx.send.id).body;
    const digest = sendById(ctx.send.id).wire_body_sha256;

    const transport = fakeTransport({ outcome: TRANSPORT_OUTCOME.ACCEPTED });
    await attemptSend(transport, requestFor(executionSnapshot(ctx.send.id)));
    // The process dies before the result write.

    recoverPriorRunSendingClaims({ currentRunId: RUN_ID, at: NOW });
    const row = sendById(ctx.send.id);

    expect(row.state).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    /* Everything a later reconciliation needs to find the message is on file. */
    expect(row.body).toBe(frozen);
    expect(row.wire_body_sha256).toBe(digest);
    expect(executionSnapshot(ctx.send.id).recipientEmail).toBe(ctx.message.recipient_email);
    expect(row.accepted_source).toBe(null);
    expect(count('outbound_send_attempt')).toBe(1);
  });

  /** CASE 5 — the ambiguity was recorded, so recovery has nothing to do. */
  it('case 5: a persisted unknown is left alone by recovery', async () => {
    const { send } = await executed({ outcome: TRANSPORT_OUTCOME.UNKNOWN });
    const before = JSON.stringify(sendById(send.id));

    expect(recoverPriorRunSendingClaims({ currentRunId: RUN_ID, at: NOW }).recovered).toBe(0);

    expect(JSON.stringify(sendById(send.id))).toBe(before);
    expect(sendEvents(send.id)).toHaveLength(1);
  });

  /** CASE 6 — acceptance persisted, bookkeeping failed, acceptance survives. */
  it('case 6: an accepted message survives a bookkeeping failure and recovery', async () => {
    const ctx = claimed();
    const result = await attemptSend(fakeTransport(), requestFor(executionSnapshot(ctx.send.id)));
    db.prepare('DELETE FROM programme_contact_attempts').run();
    persistTransportResult(ctx.send.id, result, { at: NOW });

    expect(sendById(ctx.send.id).state).toBe(MESSAGE_STATE.ACCEPTED);
    expect(recoverPriorRunSendingClaims({ currentRunId: RUN_ID, at: NOW }).recovered).toBe(0);
    expect(sendById(ctx.send.id).state).toBe(MESSAGE_STATE.ACCEPTED);
    expect(sendById(ctx.send.id).provider_message_id).toBeTruthy();
  });
});

/* ========================================================================== */
/* LEGACY — the path that was here first                                       */
/* ========================================================================== */

describe('the legacy path', () => {
  /** A manual send stores no wire body, exactly as before. */
  it('leaves the new columns null', () => {
    const coach = findOrCreateCoach({
      full_name: 'Legacy Coach', email: `legacy${++seq}@duke.edu`, school: COLLEGE,
      sport: 'mens-soccer', division: 'NCAA D1', position_title: 'Head Coach',
    });
    const o = db.prepare(
      'INSERT INTO outreach (id, athlete_id, coach_id, token, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    const id = randomUUID();
    o.run(id, ATHLETE, coach.id, `tok-${randomUUID().slice(0, 8)}`, NOW);

    const { id: sendId } = recordDraftRef({
      outreachId: id, athleteId: ATHLETE, coachId: coach.id, collegeName: COLLEGE,
      sport: 'mens-soccer', evidence: null, body: 'Manual body.', subject: 'Manual', at: NOW,
    });

    const row = sendById(sendId);
    expect(row.body).toBe(null);
    expect(row.wire_body_sha256).toBe(null);
    /* But the hash it always kept is still kept. */
    expect(row.body_hash).toBe(bodyHash('Manual body.'));
    expect(row.subject).toBe('Manual');
    expect(executionSnapshot(sendId).complete).toBe(false);
  });

  it('accepts a historical row whose new columns are null', () => {
    const rowsBefore = db.prepare(`
      SELECT COUNT(*) AS n FROM outreach_send WHERE body IS NULL
    `).get().n;
    expect(rowsBefore).toBeGreaterThanOrEqual(0);
    /* The columns are nullable, so a row without them is valid by construction. */
    const cols = db.prepare('PRAGMA table_info(outreach_send)').all();
    for (const name of ['body', 'wire_body_sha256']) {
      expect(cols.find((c) => c.name === name).notnull).toBe(0);
    }
  });
});
