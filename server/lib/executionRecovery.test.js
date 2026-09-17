import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import db from '../db/client.js';
import { createOutreach } from './outreach.js';
import { findOrCreateCoach } from './coaches.js';
import {
  recordDraft, claimSendForExecution, transitionSend, sendById, sendEvents,
} from './outreachSend.js';
import {
  recoverPriorRunSendingClaims, RECOVERY_SOURCE, RECOVERY_REASON,
} from './executionRecovery.js';
import { RUN_ID } from './executionRun.js';
import { claimProgrammeMessageForExecution } from './executionClaim.js';
import { materialiseNextContactAttempt } from './pursuitPolicy.js';
import { generateProgrammeMessage } from './programmeMessageGeneration.js';
import { reviewProgrammeMessage } from './programmeMessages.js';
import {
  MESSAGE_STATE, SEND_EVENT_TYPE, ACCEPTED_SOURCE, canTransition,
  blocksRelationship,
} from '../../shared/outreachMessageState.js';

/**
 * D4.6 — WHAT A DEAD PROCESS LEFT BEHIND, AND THE ONE TRUTHFUL THING TO SAY
 * ABOUT IT.
 *
 * A claim is taken, the process dies, and the row stays SENDING for ever. These
 * tests are about the single question that follows: did the message reach the
 * coach? The answer this build can defend is "we do not know", and almost
 * everything below is a proof that recovery says exactly that and nothing
 * stronger — it does not resend, does not refund, does not advance a campaign,
 * and does not decide on the message's behalf that it failed.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE SENDS ANYTHING, and there is no transport to mock because there
 * is no transport. Recovery reads two columns and writes two rows.
 * ---------------------------------------------------------------------------
 */

const ATHLETE = 'a-d46';
const OPERATOR = 'op-d46';
const NOW = '2026-09-18T12:00:00.000Z';
const DEAD_RUN = 'run-that-died-0001';
let seq = 0;

/* -------------------------------------------------------------------------- */
/* Fixtures — the real writers, so every row is one production could produce    */
/* -------------------------------------------------------------------------- */

function athlete(id = ATHLETE) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug,
      nationality, recruiting_class_year, gpa)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'DEFENSE', 'mens-soccer', ?, 'New Zealand', 2027, 3.8)
  `).run(id, randomUUID().slice(0, 10));
}

function operator(id = OPERATOR) {
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, active, created_at)
    VALUES (?, ?, 'scrypt$fake', 1, 'x')
  `).run(id, `${id}@thriv3.test`);
}

/** A fresh coach every time: one relationship may hold only one open message. */
function coach() {
  return findOrCreateCoach({
    full_name: `Coach ${++seq}`,
    email: `c${seq}@duke.edu`,
    school: 'Duke',
    sport: 'mens-soccer',
    division: 'NCAA D1',
    position_title: 'Head Coach',
  });
}

/** A DRAFT on its own relationship. */
function draft({ athleteId = ATHLETE } = {}) {
  const c = coach();
  const o = createOutreach({ athleteId, coachId: c.id });
  const { id } = recordDraft({
    outreachId: o.id,
    athleteId,
    coachId: c.id,
    collegeName: 'Duke',
    sport: 'mens-soccer',
    evidence: null,
    body: 'Body.',
    subject: 'Subject',
    at: NOW,
  });
  return { sendId: id, outreachId: o.id, coachId: c.id };
}

/** A message parked in one state, by the paths that legally reach it. */
function sendIn(state, { runId = DEAD_RUN } = {}) {
  const made = draft();
  const { sendId } = made;
  switch (state) {
    case MESSAGE_STATE.DRAFT:
      break;
    case MESSAGE_STATE.QUEUED:
      transitionSend(sendId, MESSAGE_STATE.QUEUED, { at: NOW });
      break;
    case MESSAGE_STATE.SENDING:
      claimSendForExecution(sendId, { runId, at: NOW });
      break;
    case MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT:
      claimSendForExecution(sendId, { runId, at: NOW });
      transitionSend(sendId, MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT, { at: NOW });
      break;
    case MESSAGE_STATE.ACCEPTED:
      transitionSend(sendId, MESSAGE_STATE.ACCEPTED, {
        acceptedSource: ACCEPTED_SOURCE.OPERATOR_ASSERTED, at: NOW,
      });
      break;
    case MESSAGE_STATE.FAILED:
      // DRAFT has no edge to FAILED; a transport that ran and was refused does.
      claimSendForExecution(sendId, { runId, at: NOW });
      transitionSend(sendId, MESSAGE_STATE.FAILED, { at: NOW });
      break;
    case MESSAGE_STATE.CANCELLED:
      transitionSend(sendId, MESSAGE_STATE.CANCELLED, { at: NOW });
      break;
    default:
      throw new Error(`no fixture for ${state}`);
  }
  expect(sendById(sendId).state).toBe(state);
  return made;
}

const recover = (over = {}) => recoverPriorRunSendingClaims({ at: NOW, ...over });
const stateOf = (id) => sendById(id).state;
const rows = (t) => db.prepare(`SELECT * FROM ${t}`).all();
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

beforeEach(() => {
  for (const t of [
    'outreach_send_event', 'outbound_send_attempt', 'programme_messages',
    'programme_contact_attempts', 'outreach_send', 'outreach', 'coaches',
    'programme_campaigns', 'campaigns', 'connected_mailbox_credentials',
    'connected_mailboxes', 'athlete_programmes', 'roster_players', 'colleges',
    'players', 'operator_users',
  ]) db.prepare(`DELETE FROM ${t}`).run();
  athlete();
  operator();
  seq = 0;
});

/* ========================================================================== */
/* What is swept, and what is left exactly alone                               */
/* ========================================================================== */

describe('the sweep', () => {
  it('turns a claim held by a dead run into an unknown result', () => {
    const { sendId } = sendIn(MESSAGE_STATE.SENDING);

    const out = recover();

    expect(out).toEqual({ recovered: 1, sendIds: [sendId] });
    expect(stateOf(sendId)).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
  });

  /**
   * THE ONE THAT WOULD BE A CATASTROPHE TO GET WRONG. A message this process is
   * actually sending right now is SENDING with THIS run's id on it. Declaring it
   * unknown would contradict a transport still working on it, and would do so at
   * boot, when nobody is looking.
   */
  it('leaves a claim held by this run completely alone', () => {
    const { sendId } = sendIn(MESSAGE_STATE.SENDING, { runId: RUN_ID });

    expect(recover({ currentRunId: RUN_ID })).toEqual({ recovered: 0, sendIds: [] });
    expect(stateOf(sendId)).toBe(MESSAGE_STATE.SENDING);
    expect(sendById(sendId).claim_run_id).toBe(RUN_ID);
    expect(count('outreach_send_event')).toBe(0);
  });

  it('defaults to this process, so an unargued sweep spares this run', () => {
    const mine = sendIn(MESSAGE_STATE.SENDING, { runId: RUN_ID });
    const theirs = sendIn(MESSAGE_STATE.SENDING, { runId: DEAD_RUN });

    expect(recoverPriorRunSendingClaims().sendIds).toEqual([theirs.sendId]);
    expect(stateOf(mine.sendId)).toBe(MESSAGE_STATE.SENDING);
  });

  /** Every state a transport is NOT working on. None is the sweep's business. */
  for (const state of [
    MESSAGE_STATE.DRAFT, MESSAGE_STATE.QUEUED, MESSAGE_STATE.ACCEPTED,
    MESSAGE_STATE.FAILED, MESSAGE_STATE.CANCELLED,
    MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT,
  ]) {
    it(`does not touch a message in ${state}`, () => {
      const { sendId } = sendIn(state);
      const before = JSON.stringify(sendById(sendId));
      const eventsBefore = sendEvents(sendId).length;

      expect(recover()).toEqual({ recovered: 0, sendIds: [] });

      expect(JSON.stringify(sendById(sendId))).toBe(before);
      expect(sendEvents(sendId).length).toBe(eventsBefore);
    });
  }

  it('recovers every dead claim and only the dead ones', () => {
    const a = sendIn(MESSAGE_STATE.SENDING, { runId: 'run-a' });
    const b = sendIn(MESSAGE_STATE.SENDING, { runId: 'run-b' });
    const live = sendIn(MESSAGE_STATE.SENDING, { runId: RUN_ID });
    const untouched = sendIn(MESSAGE_STATE.DRAFT);

    const out = recover({ currentRunId: RUN_ID });

    expect(out.recovered).toBe(2);
    expect(out.sendIds.sort()).toEqual([a.sendId, b.sendId].sort());
    expect(stateOf(a.sendId)).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    expect(stateOf(b.sendId)).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
    expect(stateOf(live.sendId)).toBe(MESSAGE_STATE.SENDING);
    expect(stateOf(untouched.sendId)).toBe(MESSAGE_STATE.DRAFT);
  });

  it('refuses to run without knowing which run it is', () => {
    const { sendId } = sendIn(MESSAGE_STATE.SENDING);
    for (const currentRunId of [null, '', '   ', 7]) {
      expect(() => recover({ currentRunId })).toThrow();
    }
    expect(stateOf(sendId)).toBe(MESSAGE_STATE.SENDING);
  });
});

/* ========================================================================== */
/* A SENDING row with no owner at all — D4.6 / §B18                            */
/* ========================================================================== */

describe('a claim with no run id on it', () => {
  /**
   * IT CANNOT COME FROM THE CLAIM PATH, AND THE TEST SAYS SO RATHER THAN
   * ASSUMING IT. `claimSendForExecution` refuses an empty run id and writes the
   * state and the owner in one UPDATE, so nothing it produces is ownerless.
   */
  it('is not something the execution claim can produce', () => {
    const { sendId } = draft();
    expect(() => claimSendForExecution(sendId, { runId: '' })).toThrow();
    expect(() => claimSendForExecution(sendId, {})).toThrow();
    expect(stateOf(sendId)).toBe(MESSAGE_STATE.DRAFT);

    claimSendForExecution(sendId, { runId: DEAD_RUN, at: NOW });
    expect(sendById(sendId).claim_run_id).toBe(DEAD_RUN);

    expect(db.prepare(
      "SELECT COUNT(*) AS n FROM outreach_send WHERE state = 'SENDING' AND claim_run_id IS NULL",
    ).get().n).toBe(0);
  });

  /**
   * BUT THE GRAPH STILL ALLOWS THE ROW, so it is handled rather than asserted
   * away. DRAFT → SENDING is a legal edge and `transitionSend` writes `state`
   * alone; nothing calls it that way today, and "nothing calls it today" is not
   * a property a recovery sweep may rely on.
   */
  it('is still reachable through the state machine', () => {
    const { sendId } = draft();
    expect(canTransition(MESSAGE_STATE.DRAFT, MESSAGE_STATE.SENDING)).toBe(true);

    transitionSend(sendId, MESSAGE_STATE.SENDING, { at: NOW });

    expect(stateOf(sendId)).toBe(MESSAGE_STATE.SENDING);
    expect(sendById(sendId).claim_run_id).toBe(null);
  });

  /**
   * AND IT IS SWEPT, because ownership has to be proven. A row with no run id
   * offers no evidence that this process claimed it, and adopting it would be
   * the restart silently taking over an in-flight message — the exact mistake
   * run ids exist to prevent.
   */
  it('is recovered, and recorded as having had no owner', () => {
    const { sendId } = draft();
    transitionSend(sendId, MESSAGE_STATE.SENDING, { at: NOW });

    expect(recover().sendIds).toEqual([sendId]);
    expect(stateOf(sendId)).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);

    const [event] = sendEvents(sendId);
    expect(event.payload.priorClaimRunId).toBe(null);
    expect(event.payload.claimedAt).toBe(null);
    expect(event.payload.reason).toBe(RECOVERY_REASON);
  });

  it('never becomes sendable by being ownerless', () => {
    const { sendId } = draft();
    transitionSend(sendId, MESSAGE_STATE.SENDING, { at: NOW });

    // Not claimable before the sweep — SENDING is not a claimable state...
    expect(claimSendForExecution(sendId, { runId: RUN_ID, at: NOW }).claimed).toBe(false);
    recover();
    // ...and not after it either.
    expect(claimSendForExecution(sendId, { runId: RUN_ID, at: NOW }).claimed).toBe(false);
    expect(stateOf(sendId)).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
  });
});

/* ========================================================================== */
/* What the event says                                                         */
/* ========================================================================== */

describe('the recovery event', () => {
  it('records exactly one observation, attributed to the sweep', () => {
    const { sendId } = sendIn(MESSAGE_STATE.SENDING);
    recover();

    const events = sendEvents(sendId);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe(SEND_EVENT_TYPE.TRANSPORT_UNKNOWN);
    expect(events[0].source).toBe(RECOVERY_SOURCE);
    expect(events[0].observed_at).toBe(NOW);
  });

  it('carries the run that abandoned it and the instant it was claimed', () => {
    const { sendId } = sendIn(MESSAGE_STATE.SENDING);
    const claimedAt = sendById(sendId).claimed_at;

    recover({ currentRunId: RUN_ID });

    const [{ payload }] = sendEvents(sendId);
    expect(payload.reason).toBe(RECOVERY_REASON);
    expect(payload.priorClaimRunId).toBe(DEAD_RUN);
    expect(payload.claimedAt).toBe(claimedAt);
    expect(payload.recoveredByRunId).toBe(RUN_ID);
  });

  /**
   * IT SAYS WHAT WAS OBSERVED, NOT WHAT A PROVIDER DID. Nothing in it may read
   * as an acceptance or a rejection: the whole point of the state it accompanies
   * is that neither is known.
   */
  it('claims no provider outcome of any kind', () => {
    const { sendId } = sendIn(MESSAGE_STATE.SENDING);
    recover();

    const [event] = sendEvents(sendId);
    expect(event.type).not.toBe(SEND_EVENT_TYPE.ACCEPTED);
    expect(event.type).not.toBe(SEND_EVENT_TYPE.TRANSPORT_REJECTED);
    expect(JSON.stringify(event.payload)).not.toMatch(/accept|reject|deliver|fail/i);

    const row = sendById(sendId);
    expect(row.accepted_source).toBe(null);
    expect(row.sent_at).toBe(null);
  });

  /** A boot log is not a place for a message body, a subject or an address. */
  it('carries nothing that belongs to the message itself', () => {
    const { sendId } = sendIn(MESSAGE_STATE.SENDING);
    const out = recover();

    const serialised = JSON.stringify([out, sendEvents(sendId)[0].payload]);
    for (const secret of ['Body.', 'Subject', 'duke.edu', 'ciphertext', 'token']) {
      expect(serialised).not.toContain(secret);
    }
  });
});

/* ========================================================================== */
/* What recovery must NOT do                                                   */
/* ========================================================================== */

describe('what a recovered message is not', () => {
  it('cannot be claimed again by anybody', () => {
    const { sendId } = sendIn(MESSAGE_STATE.SENDING);
    recover();

    expect(claimSendForExecution(sendId, { runId: RUN_ID, at: NOW }).claimed).toBe(false);
    expect(claimSendForExecution(sendId, { runId: DEAD_RUN, at: NOW }).claimed).toBe(false);
    expect(stateOf(sendId)).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
  });

  it('cannot be put back in a queue or handed to a transport', () => {
    const { sendId } = sendIn(MESSAGE_STATE.SENDING);
    recover();

    for (const next of [MESSAGE_STATE.QUEUED, MESSAGE_STATE.SENDING]) {
      expect(canTransition(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT, next)).toBe(false);
      let code = null;
      try { transitionSend(sendId, next, { at: NOW }); } catch (err) { code = err.code; }
      expect(code).toBe('ILLEGAL_MESSAGE_TRANSITION');
    }
    expect(stateOf(sendId)).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
  });

  /**
   * IT STILL BLOCKS THE RELATIONSHIP. A message that may already be in a coach's
   * inbox must not have a second one opened beside it, and since D4.4 that is a
   * database guarantee rather than a convention.
   */
  it('still stops another message being opened on the relationship', () => {
    const { sendId, outreachId, coachId } = sendIn(MESSAGE_STATE.SENDING);
    recover();

    expect(blocksRelationship(stateOf(sendId))).toBe(true);
    expect(() => recordDraft({
      outreachId, athleteId: ATHLETE, coachId, collegeName: 'Duke', sport: 'mens-soccer',
      evidence: null, body: 'Second body.', subject: 'Second', at: NOW,
    })).toThrow(/UNIQUE|constraint/i);
  });
});

/* ========================================================================== */
/* Idempotency                                                                 */
/* ========================================================================== */

describe('booting twice', () => {
  it('does nothing the second time, without a marker of its own', () => {
    const { sendId } = sendIn(MESSAGE_STATE.SENDING);

    expect(recover().recovered).toBe(1);
    const afterFirst = JSON.stringify(sendById(sendId));

    expect(recover().recovered).toBe(0);
    expect(recover({ at: '2026-09-19T00:00:00.000Z' }).recovered).toBe(0);

    expect(JSON.stringify(sendById(sendId))).toBe(afterFirst);
    expect(sendEvents(sendId).length).toBe(1);
  });
});

/* ========================================================================== */
/* Everything beside the message — the ledger, the attempt, the campaign        */
/* ========================================================================== */

describe('recovery through the real execution claim', () => {
  const TODAY = '2026-09-18';
  const COLLEGE = 'Duke';

  function campaign(id = `camp-${++seq}`) {
    db.prepare(`
      INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, outreach_ends_on, created_at,
        updated_at, snapshot_taken_at, programme_count)
      VALUES (?, ?, 'mens-soccer', 'active', '2020-01-01', NULL, 'x', 'x', 'x', 1)
    `).run(id, ATHLETE);
    return id;
  }

  function programme(campaignId) {
    const id = `pc-${++seq}`;
    db.prepare(`
      INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
        tier, tier_source, state, created_at, updated_at)
      VALUES (?, ?, ?, 'mens-soccer', ?, 82, 'A', 'AUTO', 'queued', 'x', 'x')
    `).run(id, campaignId, COLLEGE, ++seq);
    const coaches = [coach(), coach()];
    return { id, coaches };
  }

  function rosterFor() {
    db.prepare(`
      INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference)
      VALUES (?, 'x', 'x', ?, 'mens-soccer', 'NCAA D1', 'ACC')
    `).run(randomUUID(), COLLEGE);
    for (const [name, season] of [['Hayden Aish', '2024'], ['Jack Kelly', '2023']]) {
      db.prepare(`
        INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division,
          season, player_name, position, nationality, country, class_year_label, minutes_played,
          games_played)
        VALUES (?, 'x', 'x', ?, 'mens-soccer', 'NCAA D1', ?, ?, 'DEFENSE', 'International',
          'New Zealand', 'Junior', 900, 18)
      `).run(randomUUID(), COLLEGE, season, name);
    }
  }

  function mailboxFor() {
    const id = `mb-${randomUUID()}`;
    db.prepare(`
      INSERT INTO connected_mailboxes (id, operator_user_id, athlete_id, provider,
        provider_account_id, email_address, status, connected_at, created_at, updated_at)
      VALUES (?, ?, ?, 'GOOGLE', ?, ?, 'CONNECTED', 'x', 'x', 'x')
    `).run(id, OPERATOR, ATHLETE, randomUUID(), `athlete${++seq}@example.com`);
    db.prepare(`
      INSERT INTO connected_mailbox_credentials (mailbox_id, ciphertext, iv, auth_tag, key_version,
        rotated_at, created_at, updated_at)
      VALUES (?, 'ct', 'iv', 'tag', 'v1', 'x', 'x', 'x')
    `).run(id);
    return id;
  }

  /** A real claim, left SENDING by a run that is not this one. */
  function abandonedClaim() {
    const c = campaign();
    const { id: pc, coaches } = programme(c);
    rosterFor();
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const { message } = generateProgrammeMessage({
      programmeCampaignId: pc, coachId: coaches[0].id,
    });
    reviewProgrammeMessage(message.id, { operatorId: OPERATOR });
    return claimProgrammeMessageForExecution({
      programmeMessageId: message.id,
      operatorUserId: OPERATOR,
      connectedMailboxId: mailboxFor(),
      runId: DEAD_RUN,
      at: NOW,
      onDate: TODAY,
    });
  }

  /**
   * THE LEDGER IS NEVER REFUNDED. Capacity was spent on a transmission that may
   * genuinely have happened; handing it back would give a mailbox a second
   * day's worth of allowance for a message that may already be in an inbox.
   */
  it('leaves the outbound budget exactly as the claim left it', () => {
    const claimed = abandonedClaim();
    const before = JSON.stringify(rows('outbound_send_attempt'));
    expect(count('outbound_send_attempt')).toBe(1);

    expect(recover({ currentRunId: RUN_ID }).sendIds).toEqual([claimed.send.id]);

    expect(JSON.stringify(rows('outbound_send_attempt'))).toBe(before);
    expect(count('outbound_send_attempt')).toBe(1);
  });

  /** UNKNOWN is not confirmation, and only an ACCEPTED message moves a step. */
  it('leaves the programme contact attempt exactly where it was', () => {
    abandonedClaim();
    const before = JSON.stringify(rows('programme_contact_attempts'));

    recover({ currentRunId: RUN_ID });

    expect(JSON.stringify(rows('programme_contact_attempts'))).toBe(before);
  });

  it('leaves the reviewed message and the relationship untouched', () => {
    abandonedClaim();
    const messages = JSON.stringify(rows('programme_messages'));
    const outreach = JSON.stringify(rows('outreach'));

    recover({ currentRunId: RUN_ID });

    expect(JSON.stringify(rows('programme_messages'))).toBe(messages);
    expect(JSON.stringify(rows('outreach'))).toBe(outreach);
  });

  /**
   * EVERYTHING EXCEPT THE TWO ROWS IT IS ALLOWED TO WRITE. The state of one
   * message moves and one event is appended; every other table in the execution
   * path is byte-identical.
   */
  it('writes nothing outside the message and its event', () => {
    abandonedClaim();
    const TABLES = [
      'outbound_send_attempt', 'programme_messages', 'programme_contact_attempts',
      'programme_campaigns', 'campaigns', 'connected_mailboxes',
      'connected_mailbox_credentials', 'coaches', 'outreach', 'players',
    ];
    const before = Object.fromEntries(TABLES.map((t) => [t, JSON.stringify(rows(t))]));

    recover({ currentRunId: RUN_ID });

    for (const t of TABLES) expect(JSON.stringify(rows(t))).toBe(before[t]);
  });

  /** The campaign closing afterwards cannot make an ambiguous send unambiguous. */
  it('recovers a message whose campaign has since been closed', () => {
    const claimed = abandonedClaim();
    db.prepare("UPDATE campaigns SET state = 'closed'").run();
    db.prepare("UPDATE programme_campaigns SET state = 'stopped'").run();

    expect(recover({ currentRunId: RUN_ID }).sendIds).toEqual([claimed.send.id]);
    expect(stateOf(claimed.send.id)).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
  });

  /** And neither can the mailbox being revoked, or the credential being gone. */
  it('recovers a message whose mailbox has since been revoked', () => {
    const claimed = abandonedClaim();
    db.prepare('DELETE FROM connected_mailbox_credentials').run();
    db.prepare("UPDATE connected_mailboxes SET status = 'REVOKED'").run();

    expect(recover({ currentRunId: RUN_ID }).sendIds).toEqual([claimed.send.id]);
    expect(stateOf(claimed.send.id)).toBe(MESSAGE_STATE.UNKNOWN_PROVIDER_RESULT);
  });
});

/* ========================================================================== */
/* No transport, statically                                                    */
/* ========================================================================== */

describe('the recovery module itself', () => {
  const source = fs.readFileSync(new URL('./executionRecovery.js', import.meta.url), 'utf8');

  it('imports nothing that could send, decrypt or call a provider', () => {
    const imports = source.match(/^import .+$/gm) ?? [];
    for (const line of imports) {
      expect(line).not.toMatch(/outlook|gmail|graph|provider|transport|oauth|google|fetch|axios/i);
      expect(line).not.toMatch(/mailboxCredential|connectedMailboxes|credential/i);
    }
    expect(source).not.toMatch(/mailboxCredential|composeInOutlook|accessToken|refresh_token/);
  });

  it('is synchronous, so nothing can await inside the write lock', () => {
    expect(source).not.toMatch(/\bawait\b/);
    expect(source).not.toMatch(/\basync\b/);
  });

  /** It asks no permission question — those decide whether a message MAY be sent. */
  it('consults no campaign, stance, cap, budget or mailbox authority', () => {
    for (const forbidden of [
      'campaignContactDecision', 'programmePursuitPlan', 'isSendCapped',
      'outboundBudget', 'recordOutboundAttempt', 'assertFirstTouchReviewed',
      'isSuppressed', 'followUpTiming', 'mailbox(',
    ]) expect(source).not.toContain(forbidden);
  });

  /**
   * Narrowed to the CODE forms on purpose — the header discusses acceptance at
   * length, and a test that forbade the word would forbid explaining the
   * decision. What must not exist is a way to reach the state or write one.
   */
  it('cannot reach ACCEPTED, and never writes a state itself', () => {
    expect(source).not.toMatch(/MESSAGE_STATE\.ACCEPTED/);
    expect(source).not.toMatch(/SEND_EVENT_TYPE\.ACCEPTED/);
    expect(source).not.toMatch(/ACCEPTED_SOURCE/);
    expect(source).not.toMatch(/acceptSend|confirmSend/);
    expect(source).not.toMatch(/UPDATE\s+outreach_send/i);
  });
});
