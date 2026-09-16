import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/client.js';
import {
  generateProgrammeMessage, GENERATION_REFUSAL,
} from './programmeMessageGeneration.js';
import { programmeMessage, MESSAGE_STATE } from './programmeMessages.js';
import { composeProgrammeMessage } from './programmeMessage.js';
import { materialiseNextContactAttempt, PREPARATION_REFUSAL } from './pursuitPolicy.js';
import { attemptForCoach, transitionContactAttempt } from './contactAttempts.js';
import { approveFirstTouch } from './firstTouchApprovals.js';
import { programmePursuitPlan } from './pursuitPolicy.js';
import { createOutreach } from './outreach.js';
import { recordDraft, confirmSend, openSendFor } from './outreachSend.js';
import { recordOutboundAttempt } from './outboundBudget.js';
import { suppress } from './suppressions.js';
import { ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';

/**
 * F10b-3 — WHETHER NEW CONTENT MAY BE WRITTEN AT ALL.
 *
 * ---------------------------------------------------------------------------
 * THE INVARIANT MOST OF THIS FILE DEFENDS.
 *
 * A stored message is HISTORY. Whether one may be MADE is LIVE. So a campaign
 * that later closes, a relationship that becomes do-not-contact, an approval
 * that goes stale — each refuses the next generation and none of them touches
 * what is already written. "A message exists" and "this campaign is actionable"
 * are different facts, and the AA–AD block asserts they can diverge.
 * ---------------------------------------------------------------------------
 *
 * AND THE ONE THAT MAKES THE GATE POSSIBLE. `contactAttemptPreparation` checks
 * ALREADY_PREPARED LAST, so that answer means every policy check above it
 * passed. Generation asks for exactly that reason rather than for `allowed` —
 * gating on `preparableNow` would be wrong in the most misleading way, because
 * preparing succeeds and therefore makes preparation false from then on.
 */

const ATHLETE = 'a-f10b3';
const OPERATOR = 'op-f10b3';
const COLLEGE = 'Duke';
const SPORT = 'mens-soccer';
let seq = 0;

function insertAthlete(id) {
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
  return id;
}

function makeCollege({ name = COLLEGE } = {}) {
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference)
    VALUES (?, 'x', 'x', ?, ?, 'NCAA D1', 'ACC')
  `).run(randomUUID(), name, SPORT);
}

function makeCampaign({ state = 'active' } = {}) {
  db.prepare(`UPDATE campaigns SET state='closed', closed_at='x', close_reason='completed'
    WHERE athlete_id = ? AND state='active'`).run(ATHLETE);
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, '2020-01-01', 'x', 'x', 'x', 1)
  `).run(id, ATHLETE, state);
  return id;
}

function makeProgramme(campaignId, { college = COLLEGE, state = 'queued', tier = 'A' } = {}) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 82, ?, 'AUTO', ?, 'x', 'x')
  `).run(id, campaignId, college, SPORT, ++seq, tier, state);
  return id;
}

function makeCoach({ name = 'Danny Frid', school = COLLEGE, email, title = 'Head Coach' } = {}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, 'x', ?, ?, ?, 'NCAA D1', ?, ?)
  `).run(id, name, email ?? `c${++seq}@duke.edu`, school, SPORT, title);
  return id;
}

function giveCompatriotHistory(college = COLLEGE) {
  for (const [name, season] of [['Hayden Aish', '2024'], ['Jack Kelly', '2023']]) {
    db.prepare(`
      INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division,
        season, player_name, position, nationality, country, class_year_label, minutes_played,
        games_played)
      VALUES (?, 'x', 'x', ?, ?, 'NCAA D1', ?, ?, 'DEFENSE', 'International', 'New Zealand',
        'Junior', 900, 18)
    `).run(randomUUID(), college, SPORT, season, name);
  }
}

function stance(value, { college = COLLEGE } = {}) {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state, flagged,
      visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', 'none', 0, 'default', ?, 'x', 'x')
  `).run(randomUUID(), ATHLETE, college, value);
}

/** A real accepted campaign message, through the real acceptance seam. */
function sendUnder(pc, coachId, { at = '2026-09-01T09:00:00.000Z' } = {}) {
  const o = createOutreach({ athleteId: ATHLETE, coachId, programmeCampaignId: pc });
  recordDraft({
    outreachId: o.id, athleteId: ATHLETE, coachId, collegeName: COLLEGE, sport: SPORT,
    programmeCampaignId: pc, evidence: null, body: `b${++seq}`, subject: 's',
  });
  confirmSend(o.id, at, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
  return o;
}

/** Contact by hand, before the campaign — the first-touch trigger. */
function manualHistory(coachId, at = '2026-08-20T11:00:00.000Z') {
  const o = createOutreach({ athleteId: ATHLETE, coachId });
  recordDraft({
    outreachId: o.id, athleteId: ATHLETE, coachId, collegeName: COLLEGE, sport: SPORT,
    evidence: null, body: `m${++seq}`, subject: 's',
  });
  confirmSend(o.id, at, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
  return o;
}

const messages = () => db.prepare('SELECT * FROM programme_messages').all();
const rows = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
const caught = (fn) => { try { fn(); return null; } catch (e) { return e; } };

/** Every table generation must not touch. */
const WATCHED = Object.freeze([
  'programme_contact_attempts', 'outreach', 'outreach_send', 'outreach_evidence',
  'outbound_send_attempt', 'campaigns', 'programme_campaigns', 'athlete_programmes',
  'suppressions', 'campaign_first_touch_approvals', 'connected_mailboxes',
  'coaches', 'players', 'colleges', 'roster_players',
]);

function snapshot({ withMessages = false } = {}) {
  const out = {};
  for (const t of WATCHED) out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  if (withMessages) out.programme_messages = messages();
  return JSON.parse(JSON.stringify(out));
}

beforeEach(() => {
  db.exec(`DELETE FROM programme_messages; DELETE FROM campaign_first_touch_approvals;
           DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM engagement_rollup; DELETE FROM tracking_events;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes; DELETE FROM coaches; DELETE FROM colleges;
           DELETE FROM roster_players; DELETE FROM suppressions;
           DELETE FROM operator_users; DELETE FROM players;`);
  insertAthlete(ATHLETE);
  operator();
  makeCollege();
  seq = 0;
});

/**
 * A prepared, generatable pursuit: the real F9 materialiser over a real
 * campaign, so the gate is given what the system actually produces.
 */
function prepared({ history = true, campaign = {}, programme = {} } = {}) {
  const c = makeCampaign(campaign);
  const pc = makeProgramme(c, programme);
  const coach = makeCoach();
  if (history) giveCompatriotHistory();
  materialiseNextContactAttempt({ programmeCampaignId: pc });
  return { c, pc, coach, attempt: attemptForCoach(pc, coach) };
}

const generate = (pc, coachId, opts) => generateProgrammeMessage({
  programmeCampaignId: pc, coachId, ...opts,
});

/* ========================================================================== */
/* A–B — the happy paths                                                       */
/* ========================================================================== */

describe('generating from a prepared intent', () => {
  it('A. writes one step-1 message', () => {
    const { pc, coach, attempt } = prepared();

    const { created, message } = generate(pc, coach);

    expect(created).toBe(true);
    expect(messages()).toHaveLength(1);
    expect(message).toMatchObject({
      programme_contact_attempt_id: attempt.id,
      step: 1,
      coach_id: coach,
      state: MESSAGE_STATE.GENERATED,
    });
    expect(message.body).toContain('Marcus Reyes');
  });

  it('B. writes a step-2 message once the campaign has moved on', () => {
    const { pc, coach, attempt } = prepared();
    generate(pc, coach);
    sendUnder(pc, coach);

    // F9b-1 advanced the stored step at the acceptance, so the two agree.
    expect(attemptForCoach(pc, coach).step).toBe(2);
    const { created, message } = generate(pc, coach);

    expect(created).toBe(true);
    expect(message.step).toBe(2);
    expect(message.programme_contact_attempt_id).toBe(attempt.id);
    expect(messages().map((m) => m.step).sort()).toEqual([1, 2]);
  });

  it('V. persists exactly what the composer produced', () => {
    const { pc, coach } = prepared();
    const composition = composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });

    const { message } = generate(pc, coach);

    expect(message.generated_subject).toBe(composition.subject);
    expect(message.generated_body).toBe(composition.body);
    expect(message.generated_body_hash).toBe(composition.bodyHash);
    expect(message.evidence_snapshot).toEqual(composition.evidence);
    expect(message.policy_version).toBe(composition.policyVersion);
    expect(message.sequence_policy_version).toBe(composition.sequencePolicyVersion);
  });

  it('W. freezes the recipient the SERVER resolved', () => {
    const { pc, coach } = prepared();
    const email = db.prepare('SELECT email FROM coaches WHERE id = ?').get(coach).email;

    const { message } = generate(pc, coach);

    expect(message.coach_id).toBe(coach);
    expect(message.recipient_email).toBe(email);
  });
});

/* ========================================================================== */
/* C–G — the intent itself                                                     */
/* ========================================================================== */

describe('the prepared intent must be there, and must be sound', () => {
  it('C. refuses when nothing has been prepared, and prepares nothing', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const coach = makeCoach();
    giveCompatriotHistory();

    const err = caught(() => generate(pc, coach));
    expect(err.code).toBe(GENERATION_REFUSAL.CONTACT_ATTEMPT_REQUIRED);
    // It did not quietly prepare on the caller's behalf.
    expect(rows('programme_contact_attempts')).toBe(0);
    expect(messages()).toHaveLength(0);
  });

  it('D. refuses a stopped pursuit, by name', () => {
    const { pc, coach, attempt } = prepared();
    transitionContactAttempt(attempt.id, 'stopped', { reason: 'operator stopped this' });

    const err = caught(() => generate(pc, coach));
    expect(err.code).toBe(GENERATION_REFUSAL.CONTACT_ATTEMPT_NOT_PLANNED);
    expect(err.message).toMatch(/operator stopped this/);
    expect(messages()).toHaveLength(0);
  });

  it('E. refuses when the campaign now names a different coach', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = makeCoach();
    const assistant = makeCoach({ name: 'Ann Lee', title: 'Assistant Coach' });
    giveCompatriotHistory();
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    // The head coach replies, so policy stops the programme and names them.
    // Simpler and more direct: stop the head coach's pursuit, which moves the
    // plan to the assistant — then ask for the head coach.
    transitionContactAttempt(attemptForCoach(pc, head).id, 'stopped', { reason: 'moved on' });
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(programmePursuitPlan({ programmeCampaignId: pc }).current.coachId).toBe(assistant);

    // Asking for the head coach refuses on the STOPPED state, which is the
    // more specific truth. Asking for a coach with a planned attempt the plan
    // no longer names is what COACH_NO_LONGER_CURRENT is for — below.
    expect(caught(() => generate(pc, head)).code)
      .toBe(GENERATION_REFUSAL.CONTACT_ATTEMPT_NOT_PLANNED);
    expect(messages()).toHaveLength(0);
  });

  it('E. refuses a planned attempt the campaign has moved past', () => {
    const { pc, coach } = prepared();
    // Somebody replied, so the plan names the responder and awaits a person.
    const o = sendUnder(pc, coach);
    db.prepare(`INSERT INTO engagement_rollup (outreach_id, responded_at, updated_at)
      VALUES (?, '2026-09-10T10:00:00.000Z', 'x')`).run(o.id);

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.nextAction).toBe('AWAITING_OPERATOR');

    // The coach IS still current here, so the refusal is the action, not the
    // coach — and either way nothing is written.
    const err = caught(() => generate(pc, coach));
    expect([
      GENERATION_REFUSAL.COACH_NO_LONGER_CURRENT,
      PREPARATION_REFUSAL.NO_ACTION_TO_PREPARE,
      GENERATION_REFUSAL.CONTACT_ATTEMPT_STEP_DRIFT,
    ]).toContain(err.code);
    expect(messages()).toHaveLength(0);
  });

  it('F. refuses an attempt behind the derived step, and reconciles nothing', () => {
    const { pc, coach, attempt } = prepared();
    sendUnder(pc, coach);
    // Force the stale-behind state F9b-1 repairs through PREPARATION.
    db.prepare('UPDATE programme_contact_attempts SET step = 1 WHERE id = ?').run(attempt.id);

    const err = caught(() => generate(pc, coach));
    expect(err.code).toBe(GENERATION_REFUSAL.CONTACT_ATTEMPT_STEP_DRIFT);
    expect(err.message).toMatch(/prepare the attempt again/i);
    // Generation did not quietly advance it — that is preparation's writer.
    expect(attemptForCoach(pc, coach).step).toBe(1);
    expect(messages()).toHaveLength(0);
  });

  it('G. refuses an attempt ahead of the derived step', () => {
    const { pc, coach, attempt } = prepared();
    db.prepare('UPDATE programme_contact_attempts SET step = 3 WHERE id = ?').run(attempt.id);

    expect(caught(() => generate(pc, coach)).code)
      .toBe(GENERATION_REFUSAL.CONTACT_ATTEMPT_STEP_DRIFT);
    expect(attemptForCoach(pc, coach).step).toBe(3);
    expect(messages()).toHaveLength(0);
  });

  it('H. refuses when the programme has no cold outreach left', () => {
    const { pc, coach } = prepared({ programme: { tier: 'C' } });
    sendUnder(pc, coach, { at: '2026-09-01T09:00:00.000Z' });
    sendUnder(pc, coach, { at: '2026-09-08T09:00:00.000Z' });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.nextAction).toBe('NO_FURTHER_COLD_OUTREACH');

    const err = caught(() => generate(pc, coach));
    expect(err).toBeTruthy();
    expect(messages()).toHaveLength(0);
  });
});

/* ========================================================================== */
/* I–O — standing prohibitions, quoted from B3                                 */
/* ========================================================================== */

describe('standing prohibitions refuse new content', () => {
  const MATRIX = [
    ['I. manual_only', 'RELATIONSHIP_MANUAL_ONLY', () => stance('manual_only')],
    ['J. do_not_contact', 'RELATIONSHIP_DO_NOT_CONTACT', () => stance('do_not_contact')],
    ['K. global suppression', PREPARATION_REFUSAL.NO_ELIGIBLE_COACH,
      ({ coach }) => suppress({
        email: db.prepare('SELECT email FROM coaches WHERE id = ?').get(coach).email,
      })],
    ['L. revoked outreach', 'OUTREACH_REVOKED', ({ coach }) => {
      const o = createOutreach({ athleteId: ATHLETE, coachId: coach });
      db.prepare('UPDATE outreach SET revoked_at = ? WHERE id = ?').run('x', o.id);
    }],
    ['M. stopped programme', 'PROGRAMME_STOPPED', ({ pc }) => {
      db.prepare("UPDATE programme_campaigns SET state = 'stopped' WHERE id = ?").run(pc);
    }],
    ['N. completed programme', 'PROGRAMME_COMPLETED', ({ pc }) => {
      db.prepare("UPDATE programme_campaigns SET state = 'completed' WHERE id = ?").run(pc);
    }],
    ['O. closed campaign', 'CAMPAIGN_NOT_ACTIVE', ({ c }) => {
      db.prepare(`UPDATE campaigns SET state='closed', closed_at='x', close_reason='completed'
        WHERE id = ?`).run(c);
    }],
  ];

  for (const [name, code, apply] of MATRIX) {
    it(`${name} refuses, and writes nothing`, () => {
      const scene = prepared();
      apply(scene);
      const before = snapshot({ withMessages: true });

      const err = caught(() => generate(scene.pc, scene.coach));

      expect(err?.code, name).toBe(code);
      expect(messages()).toHaveLength(0);
      expect(snapshot({ withMessages: true })).toEqual(before);
    });
  }
});

/* ========================================================================== */
/* P–R — first-touch review                                                    */
/* ========================================================================== */

describe('a first touch nobody has reviewed', () => {
  /** A pursuit whose coach this athlete has already written to by hand. */
  function held() {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const coach = makeCoach();
    giveCompatriotHistory();
    manualHistory(coach);
    // Approve first so the attempt can be prepared at all — F9d holds that too.
    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    approveFirstTouch({
      programmeCampaignId: pc, coachId: coach, operatorId: OPERATOR,
      priorContact: plan.current.priorContact,
    });
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    return { c, pc, coach };
  }

  it('P. refuses when the approval is removed after preparation', () => {
    const { pc, coach } = held();
    db.prepare('DELETE FROM campaign_first_touch_approvals').run();

    const err = caught(() => generate(pc, coach));
    expect(err.code).toBe(PREPARATION_REFUSAL.FIRST_TOUCH_REVIEW_REQUIRED);
    expect(err.message).toMatch(/approve the first touch/i);
    expect(messages()).toHaveLength(0);
  });

  /**
   * Q. THE SCENARIO THE BRIEF NAMED. Prepared while the review was current;
   * further confirmed contact recorded since; generation must refuse, because
   * the contact context changed AFTER preparation and what a person approved is
   * no longer what is on file.
   */
  it('Q. refuses when the approval went stale after preparation', () => {
    const { pc, coach } = held();
    expect(generate(pc, coach).created).toBe(true);
    db.prepare('DELETE FROM programme_messages').run();

    manualHistory(coach, '2026-09-15T11:00:00.000Z');

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.firstTouchReview.approval.status).toBe('stale');

    const err = caught(() => generate(pc, coach));
    expect(err.code).toBe(PREPARATION_REFUSAL.FIRST_TOUCH_REVIEW_REQUIRED);
    expect(err.message).toMatch(/no longer what is on file/i);
    expect(messages()).toHaveLength(0);
  });

  it('R. a current approval allows generation', () => {
    const { pc, coach } = held();
    const { created, message } = generate(pc, coach);
    expect(created).toBe(true);
    expect(message.step).toBe(1);
  });
});

/* ========================================================================== */
/* S–U — what generation deliberately ignores                                  */
/* ========================================================================== */

describe('timing, budget and mailbox configuration are execution’s, not this', () => {
  it('S. a follow-up that is not due yet still generates', () => {
    const { pc, coach } = prepared();
    // Sent today, so the four policy days have not passed.
    sendUnder(pc, coach, { at: new Date().toISOString() });

    const { created, message } = generate(pc, coach);
    expect(created).toBe(true);
    expect(message.step).toBe(2);
  });

  it('T. an exhausted sending budget still generates', () => {
    const { pc, coach } = prepared();
    const elsewhere = makeCoach({ school: 'Clemson', email: 'spend@clemson.edu' });
    for (let i = 0; i < 10; i += 1) {
      const o = createOutreach({ athleteId: ATHLETE, coachId: elsewhere });
      recordOutboundAttempt({
        outreachId: o.id, athleteId: ATHLETE, sendingIdentity: 'a@thriv3.test', mailboxLimit: 500,
      });
      db.prepare('DELETE FROM outreach WHERE id = ?').run(o.id);
    }

    expect(generate(pc, coach).created).toBe(true);
  });

  /**
   * U. MAILBOX CONFIGURATION IS NOT CONSULTED AT ALL, which is stronger than
   * "does not block": the gate never asks B5 anything, so there is nothing for
   * an unset limit to block. Asserted against the source rather than simulated.
   */
  it('U. never asks about a mailbox, a sending identity or capacity', () => {
    const code = fs.readFileSync(
      path.resolve(process.cwd(), 'server/lib/programmeMessageGeneration.js'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    for (const forbidden of [
      'outboundBudget', 'sendingIdentity', 'mailboxLimit', 'MAILBOX_LIMIT_REQUIRED',
      'connectedMailboxes', 'OUTLOOK_FROM_ADDRESS', 'executableNow', 'policyEligibleOn',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    // And no capacity was consumed by generating.
    const { pc, coach } = prepared();
    generate(pc, coach);
    expect(rows('outbound_send_attempt')).toBe(0);
  });
});

/* ========================================================================== */
/* X–Z — replay                                                                */
/* ========================================================================== */

describe('an idempotent retry is not a regeneration', () => {
  it('X. replay with nothing changed returns the same message and writes nothing', () => {
    const { pc, coach } = prepared();
    const first = generate(pc, coach);
    const before = snapshot({ withMessages: true });

    const replay = generate(pc, coach, { at: '2099-01-01T00:00:00.000Z' });

    expect(replay.created).toBe(false);
    expect(replay.message).toEqual(first.message);
    expect(snapshot({ withMessages: true })).toEqual(before);
  });

  /**
   * Y. THE REASON SAFETY IS CHECKED BEFORE THE LOOKUP AND COMPOSITION AFTER IT.
   *
   * Were the gate to compose first and hand the result to the writer, a
   * harmless retry after a roster changed would come back as
   * MESSAGE_ALREADY_GENERATED — an integrity refusal raised by nothing having
   * gone wrong. The stored snapshot is the record of what was written.
   */
  it('Y. replay after the evidence moved returns the original, unrecomposed', () => {
    const { pc, coach } = prepared();
    const first = generate(pc, coach);
    expect(first.message.evidence_snapshot.rendered.length).toBeGreaterThan(0);

    // The compatriots leave the roster entirely.
    db.prepare('DELETE FROM roster_players').run();
    // A fresh composition would now say something different.
    expect(composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach }).body)
      .not.toBe(first.message.generated_body);

    const replay = generate(pc, coach);

    expect(replay.created).toBe(false);
    expect(replay.message).toEqual(first.message);
    expect(replay.message.evidence_snapshot).toEqual(first.message.evidence_snapshot);
    expect(replay.message.generated_at).toBe(first.message.generated_at);
    expect(replay.message.generated_body_hash).toBe(first.message.generated_body_hash);
  });

  it('Z. replay after the coach’s address changed keeps the frozen recipient', () => {
    const { pc, coach } = prepared();
    const first = generate(pc, coach);

    db.prepare('UPDATE coaches SET email = ? WHERE id = ?').run('corrected@duke.edu', coach);

    const replay = generate(pc, coach);
    expect(replay.created).toBe(false);
    expect(replay.message.recipient_email).toBe(first.message.recipient_email);
    expect(replay.message.recipient_email).not.toBe('corrected@duke.edu');
  });
});

/* ========================================================================== */
/* AA–AD — history is durable, actionability is live                           */
/* ========================================================================== */

describe('a message that exists is not a campaign that is actionable', () => {
  const AFTER = [
    ['AA. do_not_contact', 'RELATIONSHIP_DO_NOT_CONTACT', () => stance('do_not_contact')],
    ['AB. global suppression', PREPARATION_REFUSAL.NO_ELIGIBLE_COACH,
      ({ coach }) => suppress({
        email: db.prepare('SELECT email FROM coaches WHERE id = ?').get(coach).email,
      })],
    ['AC. closed campaign', 'CAMPAIGN_NOT_ACTIVE', ({ c }) => {
      db.prepare(`UPDATE campaigns SET state='closed', closed_at='x', close_reason='completed'
        WHERE id = ?`).run(c);
    }],
  ];

  for (const [name, code, apply] of AFTER) {
    it(`${name} after generation refuses, and the stored message is untouched`, () => {
      const scene = prepared();
      const { message } = generate(scene.pc, scene.coach);

      apply(scene);

      const err = caught(() => generate(scene.pc, scene.coach));
      expect(err?.code, name).toBe(code);
      // The content is exactly as it was written.
      expect(programmeMessage(message.id)).toEqual(message);
      expect(messages()).toHaveLength(1);
    });
  }

  it('AD. a review going stale after generation refuses, and the message stays', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const coach = makeCoach();
    giveCompatriotHistory();
    manualHistory(coach);
    approveFirstTouch({
      programmeCampaignId: pc, coachId: coach, operatorId: OPERATOR,
      priorContact: programmePursuitPlan({ programmeCampaignId: pc }).current.priorContact,
    });
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const { message } = generate(pc, coach);

    manualHistory(coach, '2026-09-15T11:00:00.000Z');

    expect(caught(() => generate(pc, coach)).code)
      .toBe(PREPARATION_REFUSAL.FIRST_TOUCH_REVIEW_REQUIRED);
    expect(programmeMessage(message.id)).toEqual(message);
  });

  /**
   * THE INVARIANT, STATED ONCE AS ITS OWN TEST.
   *
   * Nothing in this module may express a campaign safety change by editing or
   * deleting content. History is what was written; actionability is what may be
   * written next, and they are allowed to disagree.
   */
  it('never edits or deletes a message to express a safety change', () => {
    const scene = prepared();
    const { message } = generate(scene.pc, scene.coach);
    const frozen = { ...message };

    stance('do_not_contact');
    db.prepare("UPDATE programme_campaigns SET state = 'stopped' WHERE id = ?").run(scene.pc);
    db.prepare(`UPDATE campaigns SET state='closed', closed_at='x', close_reason='completed'
      WHERE id = ?`).run(scene.c);

    for (let i = 0; i < 3; i += 1) caught(() => generate(scene.pc, scene.coach));

    expect(messages()).toHaveLength(1);
    expect(programmeMessage(message.id)).toEqual(frozen);
  });
});

/* ========================================================================== */
/* AE–AI — footprint, races and the negative properties                        */
/* ========================================================================== */

describe('generating writes one row, sends nothing and asks no model', () => {
  it('AE. asking repeatedly produces exactly one durable row', () => {
    const { pc, coach, attempt } = prepared();

    for (let i = 0; i < 5; i += 1) generate(pc, coach);

    expect(messages()).toHaveLength(1);
    // And the database would refuse a second even if the gate were bypassed.
    expect(() => db.prepare(`
      INSERT INTO programme_messages (id, programme_contact_attempt_id, step, coach_id,
        recipient_email, generated_subject, generated_body, subject, body, generated_body_hash,
        body_hash, evidence_snapshot, policy_version, state, generated_at, updated_at)
      VALUES (?, ?, 1, ?, 'x@y.z', 's', 'b', 's', 'b', 'h', 'h', '{}', 'P6', 'generated', 'x', 'x')
    `).run(randomUUID(), attempt.id, coach)).toThrow(/UNIQUE/);
  });

  it('AF. a successful generation changes only programme_messages', () => {
    const { pc, coach } = prepared();
    const before = snapshot();

    generate(pc, coach);

    expect(snapshot()).toEqual(before);
    expect(messages()).toHaveLength(1);
  });

  it('AF. the attempt it generated from is not moved', () => {
    const { pc, coach, attempt } = prepared();
    const attemptBefore = db.prepare('SELECT * FROM programme_contact_attempts WHERE id = ?')
      .get(attempt.id);

    generate(pc, coach);

    expect(db.prepare('SELECT * FROM programme_contact_attempts WHERE id = ?').get(attempt.id))
      .toEqual(attemptBefore);
  });

  it('AG. every refusal writes nothing at all', () => {
    const scenarios = [
      () => { const c = makeCampaign(); const pc = makeProgramme(c); makeCoach(); return [pc, makeCoach({ email: 'z@duke.edu' })]; },
      () => { const s = prepared(); stance('do_not_contact'); return [s.pc, s.coach]; },
      () => {
        const s = prepared();
        db.prepare("UPDATE programme_campaigns SET state='stopped' WHERE id = ?").run(s.pc);
        return [s.pc, s.coach];
      },
      () => {
        const s = prepared();
        db.prepare('UPDATE programme_contact_attempts SET step = 4 WHERE id = ?').run(s.attempt.id);
        return [s.pc, s.coach];
      },
    ];

    for (const build of scenarios) {
      db.exec(`DELETE FROM programme_messages; DELETE FROM programme_contact_attempts;
               DELETE FROM outreach_send; DELETE FROM engagement_rollup;
               DELETE FROM tracking_events; DELETE FROM outreach;
               DELETE FROM suppressions;
               DELETE FROM programme_campaigns; DELETE FROM campaigns;
               DELETE FROM athlete_programmes; DELETE FROM coaches; DELETE FROM roster_players;`);
      const [pc, coach] = build();
      const before = snapshot({ withMessages: true });

      expect(caught(() => generate(pc, coach))).toBeTruthy();

      expect(snapshot({ withMessages: true })).toEqual(before);
    }
  });

  const codeOf = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('AH. imports no transport, no mailbox and no execution', () => {
    const code = codeOf('server/lib/programmeMessageGeneration.js');
    for (const forbidden of [
      'outlook', 'applescript', 'nodemailer', 'googleapis', 'graph.microsoft', 'oauth',
      'mailboxCrypto', 'sendOutreach', 'composeInOutlook', 'recordDraft', 'confirmSend',
      'acceptSend', 'transitionSend', 'createOutreach', 'recordOutboundAttempt',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('AI. imports no model, and re-implements no policy', () => {
    const code = codeOf('server/lib/programmeMessageGeneration.js');
    for (const forbidden of ['anthropic', '@anthropic-ai', 'openai']) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    // The safety rules are F9's, asked through its decision — not restated.
    for (const forbidden of [
      'campaignContactDecision', 'standingProhibition', 'isSuppressed', 'approvalStatus',
      'manual_only', 'do_not_contact', 'evidenceFor', 'selectEvidence', 'emailBodyFor',
      'materialiseNextContactAttempt',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    expect(code).toContain('contactAttemptPreparation(plan)');
    // And it writes no SQL of its own: persistence is the writer's.
    expect(code).not.toMatch(/INSERT INTO|UPDATE |DELETE FROM/i);
  });

  /**
   * ONE ORCHESTRATION AUTHORITY.
   *
   * Composition and persistence are separable on purpose, and the risk of that
   * is a future route or worker wiring them together and stepping around every
   * check above. Exactly one production module may reach both.
   */
  it('is the only production module that wires composition to persistence', () => {
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) files.push(full);
      }
    };
    for (const root of ['server', 'src', 'shared', 'worker']) {
      if (fs.existsSync(path.resolve(process.cwd(), root))) walk(path.resolve(process.cwd(), root));
    }

    const wiring = files.filter((f) => {
      const code = fs.readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      return code.includes('composeProgrammeMessage') && code.includes('createProgrammeMessage');
    }).map((f) => path.relative(process.cwd(), f));

    expect(wiring).toEqual(['server/lib/programmeMessageGeneration.js']);
  });
});
