import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/client.js';
import { campaignExecutionPlan } from './campaignExecution.js';
import { materialiseNextContactAttempt } from './pursuitPolicy.js';
import { generateProgrammeMessage } from './programmeMessageGeneration.js';
import {
  programmeMessage, programmeMessageWithContext, editProgrammeMessage, reviewProgrammeMessage,
  messagesForAttempt, MESSAGE_STATE,
} from './programmeMessages.js';
import { composeProgrammeMessage } from './programmeMessage.js';
import { createOutreach, revokeOutreach } from './outreach.js';
import { recordDraft, confirmSend } from './outreachSend.js';
import { findOrCreateCoach } from './coaches.js';
import { suppress } from './suppressions.js';
import { closeCampaign, setProgrammeCampaignState } from './campaigns.js';
import { ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';

/**
 * F10c — THE PROGRAMME MESSAGE SYSTEM, VALIDATED AS ONE THING.
 *
 * ===========================================================================
 * FIVE AUTHORITIES, AND THE WHOLE SLICE IS ABOUT NOT BLURRING THEM.
 *
 *   programme_contact_attempt   WHO this campaign currently intends to contact
 *   composeProgrammeMessage     WHAT Thriv3 deterministically proposes saying
 *   generateProgrammeMessage    WHETHER a prepared intent may write it now
 *   programme_message           the durable content and its provenance
 *   reviewProgrammeMessage      that a person read these exact words
 *
 * And a sixth that does not exist yet: execution — sender, mailbox, schedule,
 * transport. NONE of the five above means queued, scheduled, send-approved,
 * sending, sent or delivered, and every assertion in this file that looks
 * pedantic is there because the alternative would let a later slice read one
 * of them as another.
 * ===========================================================================
 *
 * THE THREE PROPERTIES THIS FILE EXISTS TO HOLD.
 *
 *   1. WHAT IS WRITTEN IS FROZEN. The generated text, the recipient, the
 *      evidence and the provenance are a record of a moment. Nothing recomputes
 *      them, and the world changing underneath does not rewrite history.
 *   2. WHAT MAY HAPPEN IS LIVE. Every stance, suppression, revocation,
 *      lifecycle rule, timing and budget answer is re-derived on every read,
 *      and a message existing changes none of them.
 *   3. THE TWO ARE ALLOWED TO DISAGREE, and must be able to. A reviewed message
 *      under a do-not-contact programme is exactly that, and neither fact
 *      cancels the other.
 */

const ATHLETE = 'a-f10c';
const OPERATOR = 'op-f10c';
const OTHER_OPERATOR = 'op-f10c-2';
const TODAY = '2026-09-07';
const COLLEGE = 'Duke';
let seq = 0;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
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

function campaign({ id = `camp-${++seq}`, state = 'active' } = {}) {
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, '2020-01-01', 'x', 'x', 'x', 1)
  `).run(id, ATHLETE, state);
  return id;
}

function programme(campaignId, { id = `pc-${++seq}`, college = COLLEGE, rank = ++seq, staff = 2 } = {}) {
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', ?, 82, 'A', 'AUTO', 'queued', 'x', 'x')
  `).run(id, campaignId, college, rank);
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

/** Roster history the engine can actually licence: a compatriot on file. */
function evidenceFor(college = COLLEGE) {
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

/** A real accepted campaign message through the real write path. */
function sendUnder(pc, coachId, { college = COLLEGE, at = '2026-09-01T09:00:00.000Z' } = {}) {
  const o = createOutreach({ athleteId: ATHLETE, coachId, programmeCampaignId: pc });
  recordDraft({
    outreachId: o.id, athleteId: ATHLETE, coachId, collegeName: college, sport: 'mens-soccer',
    programmeCampaignId: pc, evidence: null, body: `b${++seq}`, subject: 's',
  });
  confirmSend(o.id, at, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
  return o;
}

/** Prepared and written, the state most of this file starts from. */
function written({ college = COLLEGE } = {}) {
  const c = campaign();
  const { id: pc, coaches } = programme(c, { college });
  evidenceFor(college);
  materialiseNextContactAttempt({ programmeCampaignId: pc });
  const { message, created } = generateProgrammeMessage({
    programmeCampaignId: pc, coachId: coaches[0].id,
  });
  return { c, pc, coaches, head: coaches[0], message, created };
}

const plan = (c, opts = {}) => campaignExecutionPlan(c, { onDate: TODAY, ...opts });
const entry = (c, pc) => plan(c).programmes.find((p) => p.programmeCampaignId === pc);
const rows = (t) => db.prepare(`SELECT * FROM ${t}`).all();
const count = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;

/**
 * EVERY TABLE F10 COULD PLAUSIBLY TOUCH. Snapshotted whole rather than counted,
 * because a count is unchanged by a row being rewritten in place.
 */
const TABLES = [
  'programme_messages', 'programme_contact_attempts', 'outreach', 'outreach_send',
  'outreach_send_event', 'outreach_evidence', 'outbound_send_attempt', 'campaigns',
  'programme_campaigns', 'athlete_programmes', 'suppressions',
  'campaign_first_touch_approvals', 'connected_mailboxes', 'coaches', 'players', 'colleges',
  'roster_players', 'engagement_rollup', 'tracking_events', 'operator_users',
];
const snapshot = () => Object.fromEntries(TABLES.map((t) => [t, rows(t)]));
const expectUnchanged = (before, { except = [] } = {}) => {
  const after = snapshot();
  for (const t of TABLES) {
    if (except.includes(t)) continue;
    expect(after[t], t).toEqual(before[t]);
  }
};

/**
 * THE `programme_messages` DDL, WITH ITS PROSE REMOVED.
 *
 * The schema explains this table at length — what `reviewed` is not, which
 * states belong to `outreach_send` instead — and a guard that tripped on its
 * own explanation is not a guard. The same lesson four earlier slices learned
 * the same way.
 */
function messageTableDdl() {
  const sql = fs.readFileSync(path.resolve(process.cwd(), 'server/db/schema.sql'), 'utf8');
  const start = sql.indexOf('CREATE TABLE IF NOT EXISTS programme_messages');
  const body = sql.slice(start, sql.indexOf('\n);', start) + 3);
  return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');
}

const codeOf = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

beforeEach(() => {
  db.exec(`DELETE FROM programme_messages; DELETE FROM campaign_first_touch_approvals;
           DELETE FROM programme_contact_attempts; DELETE FROM outbound_send_attempt;
           DELETE FROM engagement_rollup; DELETE FROM tracking_events;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes; DELETE FROM suppressions;
           DELETE FROM connected_mailboxes; DELETE FROM roster_players; DELETE FROM colleges;
           DELETE FROM coaches; DELETE FROM players; DELETE FROM operator_users;`);
  athlete();
  operator(OPERATOR);
  operator(OTHER_OPERATOR);
  seq = 0;
});

/* ========================================================================== */
/* §2 — the state model                                                        */
/* ========================================================================== */

describe('§2 the F10 state model, pinned', () => {
  it('NO ATTEMPT → no generation, and no implicit preparation', () => {
    const c = campaign();
    const { id: pc, coaches } = programme(c);
    const before = snapshot();

    expect(() => generateProgrammeMessage({ programmeCampaignId: pc, coachId: coaches[0].id }))
      .toThrow(expect.objectContaining({ code: 'CONTACT_ATTEMPT_REQUIRED' }));

    /*
      THE REFUSAL MUST BE TOTAL. A gate that quietly prepared what was missing
      would make "generate" the thing that decides WHO the campaign writes to —
      a decision F9 owns and an operator makes on purpose.
    */
    expectUnchanged(before);
    expect(entry(c, pc).currentMessage).toEqual({ id: null, state: null, generatedAt: null });
  });

  it('PLANNED ATTEMPT → generation succeeds where live safety permits', () => {
    const { pc, message, created } = written();
    expect(created).toBe(true);
    expect(message.state).toBe(MESSAGE_STATE.GENERATED);
    expect(message.step).toBe(1);
    expect(count('programme_messages')).toBe(1);
    expect(rows('programme_contact_attempts')[0].programme_campaign_id).toBe(pc);
  });

  it('PLANNED ATTEMPT → and refuses where it does not', () => {
    const c = campaign();
    const { id: pc, coaches } = programme(c);
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    stance('do_not_contact');
    const before = snapshot();

    expect(() => generateProgrammeMessage({ programmeCampaignId: pc, coachId: coaches[0].id }))
      .toThrow(expect.objectContaining({ code: 'RELATIONSHIP_DO_NOT_CONTACT' }));
    expectUnchanged(before);
  });

  it('GENERATED → the original is frozen and the current copy is editable', () => {
    const { message } = written();
    const original = {
      generated_subject: message.generated_subject,
      generated_body: message.generated_body,
      generated_body_hash: message.generated_body_hash,
      evidence_snapshot: JSON.stringify(message.evidence_snapshot),
      policy_version: message.policy_version,
      sequence_policy_version: message.sequence_policy_version,
      recipient_email: message.recipient_email,
      step: message.step,
      generated_at: message.generated_at,
    };

    editProgrammeMessage(message.id, { subject: 'Mine', body: 'Also mine.' });
    const after = programmeMessage(message.id);

    for (const [k, v] of Object.entries(original)) {
      const actual = k === 'evidence_snapshot' ? JSON.stringify(after[k]) : after[k];
      expect(actual, k).toEqual(v);
    }
    expect(after.subject).toBe('Mine');
    expect(after.body).toBe('Also mine.');
    expect(after.body_hash).not.toBe(after.generated_body_hash);
  });

  it('REVIEWED → the current content and the attribution are both frozen', () => {
    const { message } = written();
    const reviewed = reviewProgrammeMessage(message.id, { operatorId: OPERATOR });

    expect(() => editProgrammeMessage(message.id, { subject: 'Too late' }))
      .toThrow(expect.objectContaining({ code: 'MESSAGE_NOT_EDITABLE' }));

    /*
      AND A SECOND REVIEW DOES NOT RESTAMP. An approval that silently moved to
      whoever pressed it last would make the attribution worthless: the row must
      name the person who actually read the words.
    */
    const replay = reviewProgrammeMessage(message.id, { operatorId: OTHER_OPERATOR });
    expect(replay.reviewed_by_operator_id).toBe(OPERATOR);
    expect(replay.reviewed_at).toBe(reviewed.reviewed_at);
    expect(replay.subject).toBe(reviewed.subject);
    expect(replay.body).toBe(reviewed.body);
  });

  /**
   * THE SENTENCE THIS WHOLE FILE IS FOR. Four states of an F10 message, and
   * none of them is a sixth authority's word.
   */
  it('NONE of the states means queued, scheduled, send-approved, sending or sent', () => {
    const { c, pc, message } = written();

    for (const stage of ['generated', 'reviewed']) {
      if (stage === 'reviewed') reviewProgrammeMessage(message.id, { operatorId: OPERATOR });

      // No send record of any kind exists, at any stage.
      expect(count('outreach'), stage).toBe(0);
      expect(count('outreach_send'), stage).toBe(0);
      expect(count('outbound_send_attempt'), stage).toBe(0);
      expect(count('connected_mailboxes'), stage).toBe(0);

      // And the row itself carries no delivery column to misread.
      const cols = Object.keys(programmeMessage(message.id));
      for (const forbidden of ['queued_at', 'scheduled_at', 'sent_at', 'delivered_at',
        'send_state', 'sender_email', 'mailbox_id', 'approved_at', 'approved_by',
        'outreach_id', 'outreach_send_id']) {
        expect(cols, `${stage}:${forbidden}`).not.toContain(forbidden);
      }
      // The only two states this table has.
      expect(Object.values(MESSAGE_STATE)).toEqual(['generated', 'reviewed']);
      expect(entry(c, pc).currentMessage.state, stage).toBe(stage);
    }
  });

  it('and the schema itself offers no third state', () => {
    const ddl = messageTableDdl();
    expect(ddl).toMatch(/state\s+TEXT[^,]*\n?\s*CHECK\s*\(state IN \('generated', 'reviewed'\)\)/);
    expect(ddl).not.toMatch(/queued|scheduled|sent|delivered|approved|sender|mailbox/i);
  });
});

/* ========================================================================== */
/* §8 — live safety after generation                                           */
/* ========================================================================== */

describe('§8 the world changes; what was written does not', () => {
  /**
   * EIGHT WAYS THE WORLD CAN MOVE UNDER A WRITTEN MESSAGE.
   *
   * For each: the row is byte-identical afterwards, the historical read still
   * works, a NEW generation refuses with the right code, and the plan reports
   * the live refusal independently of the message that already exists.
   */
  const CHANGES = [
    {
      name: 'manual outreach only',
      apply: () => stance('manual_only'),
      refusal: 'RELATIONSHIP_MANUAL_ONLY',
    },
    {
      name: 'do not contact',
      apply: () => stance('do_not_contact'),
      refusal: 'RELATIONSHIP_DO_NOT_CONTACT',
    },
    {
      /*
        AND HERE THE TRUTHFUL CODE IS NOT THE ONE YOU EXPECT, which is why it is
        pinned. Suppressing the head coach's address does not make the PROGRAMME
        unreachable — B6 drops that coach from the pursuit and the campaign
        moves to the assistant. So the honest refusal is that this campaign is
        no longer approaching the coach that was asked about, and the operator's
        sentence says exactly that. The one-coach case, where the programme
        really does become unreachable, is asserted separately below.
      */
      name: 'a global suppression',
      apply: ({ head }) => suppress({ email: head.email, reason: 'unsubscribed' }),
      refusal: 'COACH_NO_LONGER_CURRENT',
      /*
        AND THE PROGRAMME IS STILL REACHABLE, which is the point: suppressing
        one address moved the pursuit on, it did not block the school. A test
        that asserted "blocked" here would be asserting something untrue in
        order to look thorough.
      */
      stillExecutable: true,
    },
    {
      /*
        REVOKED WITHOUT A SEND. Revoking the relationship is its own act — it
        withdraws a tracking link and the permission that went with it — and
        pairing it with an accepted send here would test the step advancing
        rather than the revocation.
      */
      name: 'the outreach relationship revoked',
      apply: ({ pc, head }) => revokeOutreach(
        createOutreach({ athleteId: ATHLETE, coachId: head.id, programmeCampaignId: pc }).id,
      ),
      refusal: 'OUTREACH_REVOKED',
      writesOutreach: true,
    },
    {
      name: 'the programme stopped',
      apply: ({ pc }) => setProgrammeCampaignState(pc, 'stopped', { reason: 'operator' }),
      refusal: 'PROGRAMME_STOPPED',
    },
    {
      name: 'the programme completed',
      apply: ({ pc }) => {
        // queued → active → completed. The state machine has no shortcut, and
        // a test that invented one would not be testing the real path.
        setProgrammeCampaignState(pc, 'active', { reason: 'started' });
        setProgrammeCampaignState(pc, 'completed', { reason: 'done' });
      },
      refusal: 'PROGRAMME_COMPLETED',
    },
    {
      name: 'the campaign closed',
      apply: ({ c }) => closeCampaign(c, { reason: 'completed' }),
      refusal: 'CAMPAIGN_NOT_ACTIVE',
    },
  ];

  for (const change of CHANGES) {
    it(`survives ${change.name}`, () => {
      const ctx = written();
      const stored = programmeMessage(ctx.message.id);

      change.apply(ctx);

      // 1. THE ROW IS UNTOUCHED.
      expect(programmeMessage(ctx.message.id)).toEqual(stored);

      // 2. AND STILL READABLE. History does not disappear when policy changes.
      const read = programmeMessageWithContext(ctx.message.id);
      expect(read.message.body).toBe(stored.body);
      expect(read.message.recipient_email).toBe(stored.recipient_email);

      // 3. A NEW ONE IS REFUSED, with the code that names the actual reason.
      let thrown = null;
      try {
        generateProgrammeMessage({ programmeCampaignId: ctx.pc, coachId: ctx.head.id });
      } catch (err) { thrown = err; }
      expect(thrown, change.name).toBeTruthy();
      expect(thrown.code, change.name).toBe(change.refusal);

      /*
        4. AND THE MESSAGE EXISTING CHANGED NO LIVE ANSWER.

        Where the change blocks the programme, the plan says blocked — a written
        message does not soften it. Where it merely moves the pursuit to another
        person, the plan says so, and the message that was written to the FIRST
        coach is no longer the current one: `currentMessage` is scoped to the
        coach the campaign now names, so it correctly returns to null.
      */
      const e = entry(ctx.c, ctx.pc);
      if (e && change.stillExecutable) {
        expect(e.executableNow, change.name).toBe(true);
        expect(e.currentCoach.id, change.name).not.toBe(ctx.head.id);
        expect(e.currentMessage.id, change.name).toBeNull();
      } else if (e) {
        expect(e.executableNow, change.name).toBe(false);
        expect(e.currentMessage.id, change.name).toBeTruthy();
      }
      // NOTHING WAS EVER SENT, in any of these worlds. A revoked relationship
      // mints an `outreach` row and still no send.
      expect(count('outreach_send'), change.name).toBe(0);
      expect(count('outbound_send_attempt'), change.name).toBe(0);
    });
  }

  /**
   * THE OTHER HALF OF THE SUPPRESSION CASE. With nobody else to move to, the
   * programme really does become unreachable — and the message still stands.
   */
  it('reports an unreachable programme where a suppression leaves nobody', () => {
    const c = campaign();
    const { id: pc, coaches } = programme(c, { staff: 1 });
    evidenceFor();
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const { message } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: coaches[0].id });
    const stored = programmeMessage(message.id);

    suppress({ email: coaches[0].email, reason: 'unsubscribed' });

    expect(programmeMessage(message.id)).toEqual(stored);
    expect(() => generateProgrammeMessage({ programmeCampaignId: pc, coachId: coaches[0].id }))
      .toThrow(expect.objectContaining({ code: 'NO_ELIGIBLE_COACH' }));

    const e = entry(c, pc);
    expect(e.executableNow).toBe(false);
    expect(e.policyReason).toBe('NO_ELIGIBLE_COACHES');
    expect(count('outreach_send')).toBe(0);
  });

  /**
   * THE DELIBERATE ASYMMETRY, and it must survive F11. Content review is not
   * execution approval, so it is not gated on whether the campaign may write.
   */
  it('still EDITS and REVIEWS a message whose programme has become unreachable', () => {
    const { c, pc, message } = written();
    stance('do_not_contact');

    const edited = editProgrammeMessage(message.id, { subject: 'Reviewed anyway' });
    expect(edited.subject).toBe('Reviewed anyway');
    const reviewed = reviewProgrammeMessage(message.id, { operatorId: OPERATOR });
    expect(reviewed.state).toBe('reviewed');
    expect(reviewed.reviewed_by_operator_id).toBe(OPERATOR);

    // And the campaign is exactly as blocked as it was a moment ago.
    const e = entry(c, pc);
    expect(e.executableNow).toBe(false);
    expect(e.blockers.map((b) => b.code)).toContain('RELATIONSHIP_DO_NOT_CONTACT');
    expect(count('outreach_send')).toBe(0);
  });

  /**
   * A FIRST-TOUCH REVIEW THAT BECOMES REQUIRED AFTER THE FACT. The message
   * stands; a new one waits for a person.
   */
  it('refuses a NEW message once a first touch needs reviewing, and keeps the old one', () => {
    const { c, pc, head, message } = written();
    const stored = programmeMessage(message.id);

    // A confirmed send from OUTSIDE this campaign is what raises the hold.
    const o = createOutreach({ athleteId: ATHLETE, coachId: head.id });
    recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: head.id, collegeName: COLLEGE,
      sport: 'mens-soccer', evidence: null, body: 'manual', subject: 's',
    });
    confirmSend(o.id, '2026-09-02T09:00:00.000Z', { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });

    expect(programmeMessage(message.id)).toEqual(stored);
    expect(entry(c, pc).firstTouchReview.required).toBe(true);
    expect(() => generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id }))
      .toThrow(expect.objectContaining({ code: 'CAMPAIGN_FIRST_TOUCH_REVIEW_REQUIRED' }));
  });
});

/* ========================================================================== */
/* §9 — evidence immutability                                                  */
/* ========================================================================== */

describe('§9 evidence is a record of a moment, not a live query', () => {
  it('does not recompute a written message when its sources change', () => {
    const { pc, head, message } = written();
    const stored = programmeMessage(message.id);
    expect(stored.evidence_snapshot.rendered.length).toBeGreaterThan(0);

    // Every source the engine read, removed.
    db.prepare('DELETE FROM roster_players').run();
    db.prepare('DELETE FROM colleges').run();
    db.prepare("UPDATE players SET nationality = 'Ireland', gpa = 2.0 WHERE id = ?").run(ATHLETE);

    const after = programmeMessage(message.id);
    expect(after).toEqual(stored);
    expect(after.evidence_snapshot).toEqual(stored.evidence_snapshot);
    expect(after.generated_body).toBe(stored.generated_body);
    expect(after.policy_version).toBe(stored.policy_version);
    expect(after.sequence_policy_version).toBe(stored.sequence_policy_version);

    /*
      AND REPLAY RETURNS THE ROW RATHER THAN RECOMPOSING. The gate finds the
      existing message before it composes anything, which is what makes a lost
      response safe to retry — and what stops a retry silently rewriting history
      in the world's newer terms.
    */
    const again = generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id });
    expect(again.created).toBe(false);
    expect(again.message).toEqual(stored);
    expect(count('programme_messages')).toBe(1);
  });

  /**
   * AND THE OTHER HALF, which matters just as much: a genuinely NEW message
   * may — and must — use what is true now. Freezing history is not freezing the
   * engine.
   */
  it('lets a genuinely later step-2 message use newer evidence', () => {
    const { pc, head, message: first } = written();
    const firstSnapshot = programmeMessage(first.id).evidence_snapshot;
    expect(firstSnapshot.rendered.length).toBeGreaterThan(0);

    sendUnder(pc, head.id);
    db.prepare('DELETE FROM roster_players').run();

    const { message: second } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id });
    expect(second.step).toBe(2);
    // The world changed, and the NEW message reflects the change.
    expect(second.evidence_snapshot.rendered).toEqual([]);
    // The old one did not.
    expect(programmeMessage(first.id).evidence_snapshot).toEqual(firstSnapshot);
  });
});

/* ========================================================================== */
/* §10 — recipient immutability                                                */
/* ========================================================================== */

describe('§10 the recipient was frozen when the words were written', () => {
  it('keeps the address the message was addressed to, whatever the coach row says now', () => {
    const { pc, head, message } = written();
    expect(message.recipient_email).toBe(head.email);

    db.prepare('UPDATE coaches SET email = ? WHERE id = ?').run('moved@elsewhere.edu', head.id);

    expect(programmeMessage(message.id).recipient_email).toBe(head.email);
    expect(programmeMessageWithContext(message.id).message.recipient_email).toBe(head.email);

    // Replay does not update it either: the row is returned, not rebuilt.
    const again = generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id });
    expect(again.created).toBe(false);
    expect(again.message.recipient_email).toBe(head.email);

    /*
      WHETHER A LATER SEND SHOULD USE THE FROZEN ADDRESS OR THE CURRENT ONE IS
      NOT THIS LAYER'S QUESTION, and F10 deliberately does not answer it. What
      this table records is what was written and who it was written to. F11
      owns recipient freshness at execution — see the F10c report.
    */
  });
});

/* ========================================================================== */
/* §11 — generated original vs edited copy                                     */
/* ========================================================================== */

describe('§11 what Thriv3 wrote and what a person sent are two facts', () => {
  it('keeps both, and lets only one of them move', () => {
    const { message } = written();
    const g = programmeMessage(message.id);

    const edited = editProgrammeMessage(message.id, {
      subject: 'An operator’s subject', body: 'An operator’s body.',
    });

    expect(edited.generated_subject).toBe(g.generated_subject);
    expect(edited.generated_body).toBe(g.generated_body);
    expect(edited.generated_body_hash).toBe(g.generated_body_hash);
    expect(edited.evidence_snapshot).toEqual(g.evidence_snapshot);
    expect(edited.subject).toBe('An operator’s subject');
    expect(edited.body).toBe('An operator’s body.');
    expect(edited.body_hash).not.toBe(edited.generated_body_hash);

    const reviewed = reviewProgrammeMessage(message.id, { operatorId: OPERATOR });
    expect(reviewed.generated_body).toBe(g.generated_body);
    expect(reviewed.body).toBe('An operator’s body.');
    expect(() => editProgrammeMessage(message.id, { body: 'again' }))
      .toThrow(expect.objectContaining({ code: 'MESSAGE_NOT_EDITABLE' }));
  });

  it('offers no way to regenerate, unreview or reopen a MESSAGE', () => {
    for (const rel of ['server/lib/programmeMessages.js', 'server/lib/programmeMessageGeneration.js',
      'server/routes/campaigns.js', 'src/api/client.js',
      'src/components/CampaignMessageDetail.jsx', 'src/components/CampaignProgrammeCard.jsx',
      'src/pages/player/CampaignTab.jsx']) {
      const code = codeOf(rel);
      /*
        NAMED AGAINST MESSAGES, not against the word. `src/api/client.js` has
        carried `players.regenerate` — which rebuilds a public profile page —
        since long before F10, and a guard that tripped on it would be about
        spelling rather than about this table.
      */
      expect(code, rel).not.toMatch(/unreview|reopenMessage|recomposeMessage|rewriteMessage/i);
      expect(code, rel).not.toMatch(/regenerateMessage|regenerateProgramme|message.*\/regenerate/i);
    }
    // And the transition table itself has no way back.
    const code = codeOf('server/lib/programmeMessages.js');
    expect(code).toMatch(/reviewed:\s*Object\.freeze\(\[\]\)/);
  });
});

/* ========================================================================== */
/* §14 / §15 — what the email actually claims                                  */
/* ========================================================================== */

describe('§14 a message with nothing to say says nothing', () => {
  it('falls back to the generic template and reports an empty snapshot', () => {
    // No college row, no roster history, no compatriot — nothing licensed.
    const c = campaign();
    const { id: pc, coaches } = programme(c, { college: 'Nowhere State' });
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const { message } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: coaches[0].id });

    expect(message.evidence_snapshot.rendered).toEqual([]);
    expect(message.evidence_snapshot.renderedCount ?? 0).toBe(0);
    expect(message.evidence_snapshot.hasPersonalisation).toBe(false);
    expect(message.generated_body).toBeTruthy();
    /*
      AND NOTHING WAS INVENTED ABOUT THE PROGRAMME.

      The athlete's OWN facts stay — "a defender from New Zealand" is the
      athlete describing themselves and is true of every message. What must be
      absent is any CLAIM ABOUT THE COLLEGE, because there is no licensed
      evidence to make one from, and a composer that improvised here would put
      an unfounded assertion in front of a stranger.
    */
    for (const claim of [/come through the programme/i, /graduat/i, /last season/i,
      /your roster/i, /you recruited/i, /conference/i, /finished/i]) {
      expect(message.generated_body, String(claim)).not.toMatch(claim);
    }
    // The composer's own answer, not an inference from the prose.
    expect(message.body_source).toBeTruthy();
  });
});

describe('§15 every claim the panel credits is a claim the email makes', () => {
  it('renders each sentence into the body, and holds back what it held back', () => {
    const { message } = written();
    const snap = message.evidence_snapshot;

    expect(snap.rendered.length).toBeGreaterThan(0);
    for (const r of snap.rendered) {
      expect(r.text, r.kind).toBeTruthy();
      // In the snapshot AND in the body. A record of a claim the email does not
      // make would be an explanation of a different email.
      expect(message.generated_body, r.kind).toContain(r.text);
    }

    /*
      HELD IS THE OPPOSITE OF JUSTIFICATION. These are kinds the body cap
      licensed and deliberately left out — claims this email does NOT make — and
      they carry no sentences at all, only kind names.
     */
    for (const kind of snap.held ?? []) {
      expect(typeof kind).toBe('string');
      expect(snap.rendered.map((r) => r.kind)).not.toContain(kind);
    }
    expect(snap.renderedCount).toBe(snap.rendered.length);
  });
});

/* ========================================================================== */
/* §16 — replay                                                                */
/* ========================================================================== */

describe('§16 a lost response is not a second email', () => {
  it('returns the same row, unrecomposed, however many times it is asked', () => {
    const { pc, head, message } = written();
    const stored = programmeMessage(message.id);

    for (let i = 0; i < 5; i += 1) {
      const again = generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id });
      expect(again.created, `attempt ${i}`).toBe(false);
      expect(again.message, `attempt ${i}`).toEqual(stored);
    }
    expect(count('programme_messages')).toBe(1);
    expect(messagesForAttempt(stored.programme_contact_attempt_id)).toHaveLength(1);
  });

  it('and still returns it after the evidence would compose differently', () => {
    const { pc, head, message } = written();
    const stored = programmeMessage(message.id);

    db.prepare('DELETE FROM roster_players').run();
    // Proof the composer WOULD now say something else, so the replay assertion
    // below is about the gate rather than about nothing having changed.
    const live = composeProgrammeMessage({ programmeCampaignId: pc, coachId: head.id });
    expect(live.bodyHash).not.toBe(stored.generated_body_hash);

    const again = generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id });
    expect(again.created).toBe(false);
    expect(again.message.generated_body_hash).toBe(stored.generated_body_hash);
    expect(again.message.generated_at).toBe(stored.generated_at);
    expect(count('programme_messages')).toBe(1);
  });

  it('replays a REVIEWED message without reopening it', () => {
    const { pc, head, message } = written();
    reviewProgrammeMessage(message.id, { operatorId: OPERATOR });
    const stored = programmeMessage(message.id);

    const again = generateProgrammeMessage({ programmeCampaignId: pc, coachId: head.id });
    expect(again.created).toBe(false);
    expect(again.message.state).toBe('reviewed');
    expect(again.message).toEqual(stored);
  });
});

/* ========================================================================== */
/* §19 — the write footprint                                                   */
/* ========================================================================== */

describe('§19 F10 writes one table and reads the rest', () => {
  it('generate, edit and review touch programme_messages and nothing else', () => {
    const c = campaign();
    const { id: pc, coaches } = programme(c);
    evidenceFor();
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    // ---- five plan reads write nothing at all ----
    let before = snapshot();
    for (let i = 0; i < 5; i += 1) plan(c);
    expectUnchanged(before);

    // ---- generate ----
    before = snapshot();
    const { message } = generateProgrammeMessage({ programmeCampaignId: pc, coachId: coaches[0].id });
    expectUnchanged(before, { except: ['programme_messages'] });
    expect(count('programme_messages')).toBe(1);

    // ---- read ----
    before = snapshot();
    programmeMessage(message.id);
    programmeMessageWithContext(message.id);
    messagesForAttempt(message.programme_contact_attempt_id);
    expectUnchanged(before);

    // ---- edit ----
    before = snapshot();
    editProgrammeMessage(message.id, { subject: 'Edited' });
    expectUnchanged(before, { except: ['programme_messages'] });

    // ---- read again ----
    before = snapshot();
    programmeMessageWithContext(message.id);
    expectUnchanged(before);

    // ---- review ----
    before = snapshot();
    reviewProgrammeMessage(message.id, { operatorId: OPERATOR });
    expectUnchanged(before, { except: ['programme_messages'] });

    // ---- and the plan reload that follows it ----
    before = snapshot();
    plan(c);
    expectUnchanged(before);

    /*
      THE ONE THAT MATTERS MOST: the ATTEMPT is untouched by all of it. F9 owns
      who the campaign is writing to, and a content layer that moved a step or a
      state would be quietly rewriting that decision.
    */
    expect(rows('programme_contact_attempts')).toHaveLength(1);
    expect(rows('programme_contact_attempts')[0].step).toBe(1);
    expect(rows('programme_contact_attempts')[0].state).toBe('planned');
  });

  it('every refusal writes nothing', () => {
    const c = campaign();
    const { id: pc, coaches } = programme(c);
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    stance('do_not_contact');
    const before = snapshot();

    for (let i = 0; i < 3; i += 1) {
      expect(() => generateProgrammeMessage({ programmeCampaignId: pc, coachId: coaches[0].id }))
        .toThrow();
    }
    expectUnchanged(before);
  });
});

/* ========================================================================== */
/* §20 — cost at campaign scale                                                */
/* ========================================================================== */

describe('§20 a hundred programmes cost one message read', () => {
  let executions;

  async function instrumented() {
    executions = new Map();
    const counting = new Proxy(db, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql) => {
            const stmt = target.prepare(sql);
            return new Proxy(stmt, {
              get(t, key) {
                const value = t[key];
                if (typeof value !== 'function') return value;
                return (...args) => {
                  if (key === 'all' || key === 'get' || key === 'run') {
                    executions.set(sql, (executions.get(sql) ?? 0) + 1);
                  }
                  return value.apply(t, args);
                };
              },
            });
          };
        }
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    vi.resetModules();
    vi.doMock('../db/client.js', () => ({ default: counting }));
    return import('./campaignExecution.js');
  }

  const messageReads = () => [...executions.entries()]
    .filter(([sql]) => /FROM programme_messages/.test(sql))
    .reduce((n, [, c]) => n + c, 0);
  const writes = () => [...executions.entries()]
    .filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql))
    .reduce((n, [, c]) => n + c, 0);
  const total = () => [...executions.values()].reduce((n, c) => n + c, 0);

  it('stays bounded, and reads nothing twice per programme', async () => {
    const c = campaign();
    for (let i = 0; i < 100; i += 1) {
      const p = programme(c, {
        id: `pc-${i}`, college: `P${String(i).padStart(3, '0')}`, rank: i + 1, staff: 1,
      });
      materialiseNextContactAttempt({ programmeCampaignId: p.id });
      if (i % 2 === 0) {
        generateProgrammeMessage({ programmeCampaignId: p.id, coachId: p.coaches[0].id });
      }
    }

    const mod = await instrumented();
    const out = mod.campaignExecutionPlan(c, { onDate: TODAY });

    expect(out.programmes).toHaveLength(100);
    expect(out.programmes.filter((p) => p.currentMessage.id)).toHaveLength(50);
    // ONE statement for a hundred programmes. Not a hundred point lookups.
    expect(messageReads()).toBe(1);
    // And looking at a campaign writes nothing, at any scale.
    expect(writes()).toBe(0);

    /*
      THE TOTAL IS REPORTED, NOT TIGHTENED. It is the pre-F10 plan cost plus
      exactly one, and the rest of it is B6/B3/B5 work this slice must not
      quietly optimise while validating something else.
    */
    // eslint-disable-next-line no-console
    console.log(`[F10c] plan statements for 100 programmes: ${total()} (programme_messages: ${messageReads()})`);
    expect(total()).toBeLessThan(3000);

    vi.doUnmock('../db/client.js');
    vi.resetModules();
  });
});

/* ========================================================================== */
/* §23–§25 — the boundaries                                                    */
/* ========================================================================== */

describe('§23 exactly one production path joins composition to persistence', () => {
  it('and it is the generation gate', () => {
    const PRODUCTION = [
      'server/lib/programmeMessage.js', 'server/lib/programmeMessages.js',
      'server/lib/programmeMessageGeneration.js', 'server/lib/campaignExecution.js',
      'server/routes/campaigns.js', 'src/api/client.js',
      'src/components/CampaignMessageDetail.jsx', 'src/components/CampaignProgrammeCard.jsx',
      'src/pages/player/CampaignTab.jsx', 'src/lib/campaignLabels.js',
    ];
    const both = PRODUCTION.filter((rel) => {
      const code = codeOf(rel);
      return /composeProgrammeMessage\s*\(/.test(code) && /createProgrammeMessage\s*\(/.test(code);
    });
    expect(both).toEqual(['server/lib/programmeMessageGeneration.js']);

    // The route reaches content only through the gate.
    const route = codeOf('server/routes/campaigns.js');
    expect(route).toMatch(/generateProgrammeMessage\(/);
    expect(route).not.toMatch(/composeProgrammeMessage|createProgrammeMessage/);
  });

  it('no production UI module imports a server domain module', () => {
    for (const rel of ['src/api/client.js', 'src/lib/campaignLabels.js',
      'src/components/CampaignMessageDetail.jsx', 'src/components/CampaignProgrammeCard.jsx',
      'src/pages/player/CampaignTab.jsx']) {
      const code = codeOf(rel);
      const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${rel} → ${spec}`).not.toMatch(/server\/|\/db\/|better-sqlite3/);
      }
    }
  });
});

describe('§24 there is no F10 execution path', () => {
  const F10_PRODUCTION = [
    'server/lib/programmeMessage.js', 'server/lib/programmeMessages.js',
    'server/lib/programmeMessageGeneration.js',
    'src/components/CampaignMessageDetail.jsx',
  ];

  it('imports no transport, mailbox, scheduler or send writer', () => {
    for (const rel of F10_PRODUCTION) {
      const code = codeOf(rel);
      expect(code, rel).not.toMatch(
        /sendOutreach|acceptSend|confirmSend|recordDraft|recordOutboundAttempt|transitionSend/,
      );
      expect(code, rel).not.toMatch(/outbound_send_attempt|connected_mailboxes/);
      expect(code, rel).not.toMatch(/nodemailer|smtp|googleapis|google-auth|graph\.microsoft/i);
      expect(code, rel).not.toMatch(/setInterval|cron|scheduler|worker_threads/i);
    }
  });

  it('and the message table is joined to no send record', () => {
    const ddl = messageTableDdl();
    /*
      NO FOREIGN KEY TO A SEND, IN EITHER DIRECTION. What Thriv3 wrote and what
      was delivered are two records, and the relationship between them is an F11
      design nobody has made. A column added now would pre-decide it.
    */
    expect(ddl).not.toMatch(/outreach|send|mailbox|transport/i);
    expect(ddl).toMatch(/REFERENCES programme_contact_attempts\(id\) ON DELETE CASCADE/);
  });
});

describe('§25 composition is deterministic, and there is no model in it', () => {
  it('names no provider anywhere in F10 production code', () => {
    for (const rel of ['server/lib/programmeMessage.js', 'server/lib/programmeMessages.js',
      'server/lib/programmeMessageGeneration.js', 'server/routes/campaigns.js',
      'src/components/CampaignMessageDetail.jsx', 'src/lib/campaignLabels.js',
      'src/pages/player/CampaignTab.jsx', 'src/components/CampaignProgrammeCard.jsx']) {
      const code = codeOf(rel);
      expect(code, rel).not.toMatch(/anthropic|openai|\bllm\b|gpt-|\.completions?\b/i);
      expect(code, rel).not.toMatch(/Math\.random|Date\.now\(\)\s*\+\s*Math/);
    }
  });

  it('composes the same bytes twice from the same facts', () => {
    const c = campaign();
    const { id: pc, coaches } = programme(c);
    evidenceFor();
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    const a = composeProgrammeMessage({ programmeCampaignId: pc, coachId: coaches[0].id });
    const b = composeProgrammeMessage({ programmeCampaignId: pc, coachId: coaches[0].id });
    expect(b).toEqual(a);
    expect(b.bodyHash).toBe(a.bodyHash);
  });
});

/* ========================================================================== */
/* §29 — the schema, on a fresh database and on an existing one                */
/* ========================================================================== */

describe('§29 the table arrives additively and leaves cleanly', () => {
  it('is created by the schema every boot runs, with no migration step', () => {
    const sql = fs.readFileSync(path.resolve(process.cwd(), 'server/db/schema.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS programme_messages/);
    // Additive only: nothing in this slice drops, renames or rewrites.
    const migrate = fs.readFileSync(path.resolve(process.cwd(), 'server/db/migrate.js'), 'utf8');
    expect(migrate).not.toMatch(/programme_messages/);
    expect(sql).not.toMatch(/DROP TABLE\s+(IF EXISTS\s+)?programme_messages/);
  });

  it('exists on this database, which was built by exactly that path', () => {
    const t = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'programme_messages'",
    ).get();
    expect(t).toBeTruthy();
    // Running the schema again is a no-op, which is what "every boot" requires.
    const schema = fs.readFileSync(path.resolve(process.cwd(), 'server/db/schema.sql'), 'utf8');
    expect(() => db.exec(schema)).not.toThrow();
  });

  it('deleting an attempt takes its messages with it', () => {
    const { message } = written();
    const attemptId = message.programme_contact_attempt_id;
    db.prepare('DELETE FROM programme_contact_attempts WHERE id = ?').run(attemptId);
    expect(programmeMessage(message.id)).toBeNull();
    expect(count('programme_messages')).toBe(0);
  });

  it('deleting a campaign reaches the messages through the chain', () => {
    const { c, message } = written();
    expect(count('programme_messages')).toBe(1);

    db.prepare('DELETE FROM campaigns WHERE id = ?').run(c);

    expect(count('programme_campaigns')).toBe(0);
    expect(count('programme_contact_attempts')).toBe(0);
    expect(count('programme_messages')).toBe(0);
    expect(programmeMessageWithContext(message.id)).toBeNull();
  });

  /**
   * AND THE COACH IS THE EXCEPTION, deliberately. A message names a person; a
   * delete that silently removed the record of what was written to them would
   * destroy the history this table exists to keep.
   */
  it('refuses to delete a coach a message was written to', () => {
    const { head } = written();
    expect(() => db.prepare('DELETE FROM coaches WHERE id = ?').run(head.id)).toThrow();
    expect(count('programme_messages')).toBe(1);
  });
});
