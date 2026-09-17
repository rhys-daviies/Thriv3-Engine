import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { campaignsRouter } from '../routes/campaigns.js';
import {
  programmePursuitPlan, materialiseNextContactAttempt, PURSUIT_ACTION,
} from './pursuitPolicy.js';
import { campaignExecutionPlan } from './campaignExecution.js';
import { attemptsForProgrammeCampaign } from './contactAttempts.js';
import { APPROVAL_STATUS } from './firstTouchApprovals.js';
import { suppress } from './suppressions.js';
import { MESSAGE_STATE } from '../../shared/outreachMessageState.js';

/**
 * F6d — RECORDING THAT A PERSON HAS LOOKED.
 *
 * The hold is only half a feature without a way to say yes, and a yes that
 * lives in a response object is one refresh away from never having happened.
 * This is the durable half.
 *
 * ---------------------------------------------------------------------------
 * AN APPROVAL DESCRIBES THE HISTORY IT WAS SHOWN.
 *
 * "Two messages, the last on 20 August, and I am content for the campaign to
 * write again." If a third is recorded afterwards, that sentence is no longer
 * true of what is on file — so the snapshot is compared rather than trusted,
 * the approval goes stale on its own, and a person looks again. Nothing
 * refreshes quietly.
 *
 * AND IT CLEARS ONE HOLD. Not do-not-contact, not manual-only, not
 * suppression, not revocation, not a stopped programme and not a closed
 * campaign. Half the tests below are that sentence, because an approval that
 * quietly widened into permission is the way this feature would do harm.
 * ---------------------------------------------------------------------------
 */

const ATHLETE = 'a-approve';
const OPERATOR = 'op-approve';
const OTHER_OPERATOR = 'op-approve-other';
let seq = 0;
let baseUrl;
let actingOperator;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  /**
   * `requireOperator` guards every /api route in the real server, so a handler
   * never runs without a session. This stands in for it, and `actingOperator`
   * is what lets a test prove the recorded approver is the SESSION'S operator
   * rather than anything a request said.
   */
  app.use((req, _res, next) => { req.operator = { id: actingOperator, email: 'op@thriv3.test' }; next(); });
  app.use('/api', campaignsRouter);
  await new Promise((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.unref();
  });
});

afterAll(() => {});

const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

function insertAthlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer')
  `).run(id, id);
}

function operator(id) {
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, active, created_at)
    VALUES (?, ?, 'scrypt$fake', 1, '2026-09-01T00:00:00.000Z')
  `).run(id, `${id}@thriv3.test`);
}

function coach({ name = 'A Coach', email, school = 'Duke', title = 'Head Coach' } = {}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, '2026-09-01T00:00:00.000Z', ?, ?, ?, 'NCAA D1', 'mens-soccer', ?)
  `).run(id, name, email ?? `c${++seq}@duke.edu`, school, title);
  return id;
}

function outreach({ coachId, drafted = null, sent = null, revoked = null }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, drafted_at, sent_at, revoked_at)
    VALUES (?, ?, ?, ?, '2026-09-01T00:00:00.000Z', ?, ?, ?)
  `).run(id, ATHLETE, coachId, randomUUID(), drafted, sent, revoked);
  return id;
}

function message({
  outreachId, coachId, state = MESSAGE_STATE.ACCEPTED, sentAt = null, origin = 'manual',
}) {
  db.prepare(`
    INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, sent_at, athlete_id, coach_id,
      college_name, sport, origin, policy_version, state, created_at)
    VALUES (?, ?, ?, '2026-09-01T10:00:00.000Z', ?, ?, ?, 'Duke', 'mens-soccer', ?,
      'LEGACY_UNKNOWN', ?, '2026-09-01T00:00:00.000Z')
  `).run(randomUUID(), outreachId, ++seq, sentAt, ATHLETE, coachId, origin, state);
}

function makeCampaign({ state = 'active' } = {}) {
  db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = '2026-09-01T00:00:00.000Z',
      close_reason = 'completed' WHERE athlete_id = ? AND state = 'active'`).run(ATHLETE);
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, '2026-09-01', '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 1)
  `).run(id, ATHLETE, state);
  return id;
}

function makeProgramme(campaignId, { college = 'Duke', tier = 'A' } = {}) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, state, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', ?, 82, ?, 'queued', '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z')
  `).run(id, campaignId, college, ++seq, tier);
  return id;
}

function relationship({ stance = 'default' } = {}) {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state,
      flagged, visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, 'Duke', 'mens-soccer', 'none', 0, 'default', ?,
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
  `).run(randomUUID(), ATHLETE, stance);
}

/** One confirmed manual send, before the campaign existed. */
function manualHistory(coachId, at = '2026-08-20T11:00:00.000Z') {
  const o = outreach({ coachId, sent: at });
  message({ outreachId: o, coachId, sentAt: at });
  return o;
}

const planFor = (pc) => programmePursuitPlan({ programmeCampaignId: pc });
const review = (pc) => planFor(pc).firstTouchReview;
const approvalRows = () =>
  db.prepare('SELECT * FROM campaign_first_touch_approvals').all();
const attemptRows = () =>
  db.prepare('SELECT COUNT(*) c FROM programme_contact_attempts').get().c;

const approve = (pc, coachId) =>
  api('POST', `/api/programme-campaigns/${pc}/coaches/${coachId}/first-touch-approval`);

/** A campaign, a Duke, a head coach and one prior manual send to them. */
function held() {
  const campaign = makeCampaign();
  const pc = makeProgramme(campaign);
  const head = coach({ email: 'h@duke.edu' });
  manualHistory(head);
  return { campaign, pc, head };
}

beforeEach(() => {
  seq = 0;
  db.exec(`DELETE FROM campaign_first_touch_approvals; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach_evidence; DELETE FROM engagement_rollup;
           DELETE FROM tracking_events; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes; DELETE FROM players; DELETE FROM coaches;
           DELETE FROM operator_sessions; DELETE FROM operator_users;
           DELETE FROM suppressions;`);
  insertAthlete(ATHLETE);
  operator(OPERATOR);
  operator(OTHER_OPERATOR);
  actingOperator = OPERATOR;
});

/* -------------------------------------------------------------------------- */
/* Approving                                                                   */
/* -------------------------------------------------------------------------- */

describe('an operator records that they have looked', () => {
  it('holds the first touch until somebody does', () => {
    const { pc } = held();
    expect(review(pc)).toMatchObject({
      required: true,
      reason: 'PRIOR_CONFIRMED_CONTACT',
      approval: { status: APPROVAL_STATUS.NONE },
    });
  });

  it('stores the session operator and the history they were shown', async () => {
    const { pc, head } = held();
    const res = await approve(pc, head);

    expect(res.status).toBe(200);
    const [row] = approvalRows();
    expect(row).toMatchObject({
      programme_campaign_id: pc,
      coach_id: head,
      approved_by_operator_id: OPERATOR,
      reviewed_confirmed_send_count: 1,
      reviewed_last_confirmed_send_at: '2026-08-20T11:00:00.000Z',
    });
    expect(row.approved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('clears the hold, and says so from the machinery that imposed it', async () => {
    const { pc, head } = held();
    const res = await approve(pc, head);

    expect(res.body.firstTouchReview).toMatchObject({
      required: false,
      reason: null,
      approval: { status: APPROVAL_STATUS.CURRENT, approvedByOperatorId: OPERATOR },
    });
    expect(review(pc).required).toBe(false);
  });

  it('does not touch the campaign-local sequence by clearing it', async () => {
    const { pc, head } = held();
    await approve(pc, head);

    /**
     * IT IS STILL THIS CAMPAIGN'S FIRST MESSAGE, because it is. Approval says
     * a person has seen the history, not that the history belongs to this
     * campaign — moving the counter would make the campaign's own progression
     * unreadable and would silently skip its opening message.
     */
    const plan = planFor(pc);
    expect(plan.current.messagesSent).toBe(0);
    expect(plan.step).toBe(1);
    expect(plan.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
    expect(plan.current.priorContact.hasConfirmedSend).toBe(true);
  });

  it('lets the attempt be materialised once the review is in', async () => {
    const { pc, head } = held();
    expect(materialiseNextContactAttempt({ programmeCampaignId: pc }).created).toBe(false);

    await approve(pc, head);
    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(out.created).toBe(true);
    expect(out.attempt.coach_id).toBe(head);
    expect(out.attempt.step).toBe(1);
  });

  it('returns the programme to the actionable list', async () => {
    const { campaign, pc, head } = held();
    expect(campaignExecutionPlan(campaign, { onDate: '2026-09-15' }).priorityActions).toEqual([]);

    await approve(pc, head);
    const out = campaignExecutionPlan(campaign, { onDate: '2026-09-15' });
    expect(out.programmes[0].operatorReviewRequired).toBe(false);
    expect(out.programmes[0].executableNow).toBe(true);
    expect(out.priorityActions).toHaveLength(1);
    expect(out.programmes[0].firstTouchReview.approval).toMatchObject({
      status: APPROVAL_STATUS.CURRENT, approvedByOperatorId: OPERATOR,
    });
    expect(pc).toBeTruthy();
  });

  it('approves a legacy relationship whose count is zero', async () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const head = coach({ email: 'h@duke.edu' });
    outreach({ coachId: head, sent: '2025-04-02T11:00:00.000Z' });

    // Confirmed through `outreach.sent_at` alone, with no per-message rows to
    // count. An approval over zero is as real as any other, and the column is
    // NOT NULL precisely so this is recorded rather than skipped.
    expect(review(pc).required).toBe(true);
    const res = await approve(pc, head);
    expect(res.status).toBe(200);
    expect(approvalRows()[0]).toMatchObject({
      reviewed_confirmed_send_count: 0,
      reviewed_last_confirmed_send_at: '2025-04-02T11:00:00.000Z',
    });
    expect(review(pc).required).toBe(false);
  });

  it('is a no-op when the same approval is already current', async () => {
    const { pc, head } = held();
    await approve(pc, head);
    const first = approvalRows()[0];

    actingOperator = OTHER_OPERATOR;
    const again = await approve(pc, head);

    /**
     * NOT AN ERROR, AND NOT A REWRITE. What the caller asked for is already
     * true, so the existing decision comes back unchanged — a second click
     * must not quietly reattribute somebody else's review to whoever happened
     * to press the button.
     */
    expect(again.status).toBe(200);
    expect(approvalRows()).toHaveLength(1);
    expect(approvalRows()[0]).toEqual(first);
    expect(again.body.approval.approvedByOperatorId).toBe(OPERATOR);
  });

  it('records the later operator when a stale review is approved again', async () => {
    const { pc, head } = held();
    await approve(pc, head);
    const first = approvalRows()[0];
    const o = db.prepare('SELECT id FROM outreach WHERE coach_id = ?').get(head);
    message({ outreachId: o.id, coachId: head, sentAt: '2026-09-10T11:00:00.000Z' });

    actingOperator = OTHER_OPERATOR;
    await approve(pc, head);

    // One row, replaced rather than appended: this slice records the decision
    // in force, and an audit trail of superseded reviews is its own question.
    const rows = approvalRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].approved_by_operator_id).toBe(OTHER_OPERATOR);
  });

  it('is never created by looking at the plan', () => {
    const { campaign, pc } = held();
    planFor(pc);
    campaignExecutionPlan(campaign, { onDate: '2026-09-15' });
    campaignExecutionPlan(campaign, { onDate: '2026-09-15' });
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    // Reading is not deciding. A dry run an operator opens twice must not
    // approve anything on their behalf.
    expect(approvalRows()).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* What the server refuses to be told                                          */
/* -------------------------------------------------------------------------- */

describe('everything recorded is the server’s own', () => {
  it('ignores an operator id in the body', async () => {
    const { pc, head } = held();
    await api('POST', `/api/programme-campaigns/${pc}/coaches/${head}/first-touch-approval`, {
      approved_by_operator_id: OTHER_OPERATOR,
      approvedByOperatorId: OTHER_OPERATOR,
    });
    // The session decides who approved. A body naming somebody else is not an
    // error to argue with; it is simply not read.
    expect(approvalRows()[0].approved_by_operator_id).toBe(OPERATOR);
  });

  it('ignores a history snapshot in the body', async () => {
    const { pc, head } = held();
    await api('POST', `/api/programme-campaigns/${pc}/coaches/${head}/first-touch-approval`, {
      reviewed_confirmed_send_count: 99,
      reviewed_last_confirmed_send_at: '2099-01-01T00:00:00.000Z',
      priorContact: { hasConfirmedSend: false },
    });

    /**
     * THE SNAPSHOT IS WHAT MAKES AN APPROVAL EXPIRE. A caller that could write
     * it could write a count no future history will ever match — an approval
     * that never goes stale — or one that matches nothing, which is the same
     * thing the other way round.
     */
    expect(approvalRows()[0]).toMatchObject({
      reviewed_confirmed_send_count: 1,
      reviewed_last_confirmed_send_at: '2026-08-20T11:00:00.000Z',
    });
  });

  it('refuses a coach this campaign is not pursuing', async () => {
    const { pc } = held();
    const stranger = coach({ school: 'Elon', email: 'e@elon.edu' });

    const res = await approve(pc, stranger);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/not one this campaign would pursue/i);
    expect(approvalRows()).toEqual([]);
  });

  it('refuses a coach id that is not a coach at all', async () => {
    const { pc } = held();
    const res = await approve(pc, 'not-a-coach');
    expect(res.status).toBe(422);
    expect(approvalRows()).toEqual([]);
  });

  it('refuses where there is no prior contact to review', async () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const head = coach({ email: 'h@duke.edu' });

    // An approval row waiting for a hold that has not happened would carry a
    // snapshot of a history that did not exist when it was written.
    const res = await approve(pc, head);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no confirmed prior contact/i);
    expect(approvalRows()).toEqual([]);
  });

  it('refuses where the only history is a draft or a failure', async () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const head = coach({ email: 'h@duke.edu' });
    const o = outreach({ coachId: head, drafted: '2026-08-20T10:00:00.000Z' });
    message({ outreachId: o, coachId: head, state: MESSAGE_STATE.DRAFT });
    message({ outreachId: o, coachId: head, state: MESSAGE_STATE.FAILED });

    expect((await approve(pc, head)).status).toBe(422);
    expect(approvalRows()).toEqual([]);
  });

  it('refuses a programme campaign that does not exist', async () => {
    const res = await approve('pc-nope', 'coach-nope');
    expect(res.status).toBe(404);
    expect(approvalRows()).toEqual([]);
  });

  it('refuses to approve a follow-up, which needs no review', async () => {
    const { pc, head } = held();
    // The campaign's own step 1 has gone out, so the next message is a
    // follow-up and was never held.
    const o = db.prepare('SELECT id FROM outreach WHERE coach_id = ?').get(head);
    db.prepare(`
      INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, sent_at, athlete_id,
        coach_id, college_name, sport, programme_campaign_id, origin, policy_version, state, created_at)
      VALUES (?, ?, ?, '2026-09-05T10:00:00.000Z', '2026-09-05T11:00:00.000Z', ?, ?, 'Duke',
        'mens-soccer', ?, 'campaign', 'LEGACY_UNKNOWN', ?, '2026-09-01T00:00:00.000Z')
    `).run(randomUUID(), o.id, ++seq, ATHLETE, head, pc, MESSAGE_STATE.ACCEPTED);

    expect(planFor(pc).nextAction).toBe(PURSUIT_ACTION.FOLLOW_UP);
    const res = await approve(pc, head);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/not making a first approach/i);
    expect(approvalRows()).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Going stale                                                                 */
/* -------------------------------------------------------------------------- */

describe('an approval expires when the history moves', () => {
  it('goes stale when another confirmed send is recorded', async () => {
    const { pc, head } = held();
    await approve(pc, head);
    expect(review(pc).approval.status).toBe(APPROVAL_STATUS.CURRENT);

    const o = db.prepare('SELECT id FROM outreach WHERE coach_id = ?').get(head);
    message({ outreachId: o.id, coachId: head, sentAt: '2026-09-10T11:00:00.000Z' });

    /**
     * THE SENTENCE THE OPERATOR AGREED TO IS NO LONGER TRUE OF WHAT IS ON
     * FILE. They reviewed one message; there are two. Unreviewed is the honest
     * state, not approved-enough.
     */
    expect(review(pc)).toMatchObject({
      required: true,
      reason: 'PRIOR_CONFIRMED_CONTACT',
      approval: { status: APPROVAL_STATUS.STALE, approvedByOperatorId: OPERATOR },
    });
  });

  it('notices a second send on the same timestamp', async () => {
    const { pc, head } = held();
    await approve(pc, head);
    const o = db.prepare('SELECT id FROM outreach WHERE coach_id = ?').get(head);
    // The count moves and the timestamp does not, which is why both are
    // compared rather than either alone.
    message({ outreachId: o.id, coachId: head, sentAt: '2026-08-20T11:00:00.000Z' });
    expect(review(pc).approval.status).toBe(APPROVAL_STATUS.STALE);
  });

  it('holds the dry run again while stale', async () => {
    const { campaign, pc, head } = held();
    await approve(pc, head);
    const o = db.prepare('SELECT id FROM outreach WHERE coach_id = ?').get(head);
    message({ outreachId: o.id, coachId: head, sentAt: '2026-09-10T11:00:00.000Z' });

    const out = campaignExecutionPlan(campaign, { onDate: '2026-09-15' });
    expect(out.programmes[0].operatorReviewRequired).toBe(true);
    expect(out.programmes[0].executableNow).toBe(false);
    expect(out.priorityActions).toEqual([]);
    // A screen can tell "nobody has looked" from "what they looked at changed".
    expect(out.programmes[0].firstTouchReview.approval.status).toBe(APPROVAL_STATUS.STALE);
  });

  it('writes no attempt while stale', async () => {
    const { pc, head } = held();
    await approve(pc, head);
    const o = db.prepare('SELECT id FROM outreach WHERE coach_id = ?').get(head);
    message({ outreachId: o.id, coachId: head, sentAt: '2026-09-10T11:00:00.000Z' });

    expect(materialiseNextContactAttempt({ programmeCampaignId: pc }).created).toBe(false);
    expect(attemptRows()).toBe(0);
  });

  it('clears again when a person re-approves the new history', async () => {
    const { pc, head } = held();
    await approve(pc, head);
    const o = db.prepare('SELECT id FROM outreach WHERE coach_id = ?').get(head);
    message({ outreachId: o.id, coachId: head, sentAt: '2026-09-10T11:00:00.000Z' });

    const res = await approve(pc, head);
    expect(res.status).toBe(200);
    expect(approvalRows()).toHaveLength(1);
    expect(approvalRows()[0]).toMatchObject({
      reviewed_confirmed_send_count: 2,
      reviewed_last_confirmed_send_at: '2026-09-10T11:00:00.000Z',
    });
    expect(review(pc).approval.status).toBe(APPROVAL_STATUS.CURRENT);
    expect(review(pc).required).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* An approval is not permission                                               */
/* -------------------------------------------------------------------------- */

describe('approval clears one hold and widens nothing', () => {
  const materialised = (pc) => materialiseNextContactAttempt({ programmeCampaignId: pc });

  it('does not override manual_only', async () => {
    const { pc, head } = held();
    await approve(pc, head);
    relationship({ stance: 'manual_only' });

    const plan = planFor(pc);
    expect(plan.firstTouchReview.required).toBe(false);
    // The stance is a decision somebody took; this review was a decision
    // somebody had not yet taken. Clearing one says nothing about the other.
    expect(plan.safety.reason).toBe('RELATIONSHIP_MANUAL_ONLY');
    expect(plan.executableNow).toBe(false);
    expect(materialised(pc).created).toBe(false);
    expect(attemptRows()).toBe(0);
  });

  it('does not override do_not_contact', async () => {
    const { pc, head } = held();
    await approve(pc, head);
    relationship({ stance: 'do_not_contact' });

    expect(planFor(pc).safety.reason).toBe('RELATIONSHIP_DO_NOT_CONTACT');
    expect(materialised(pc).created).toBe(false);
    expect(attemptRows()).toBe(0);
  });

  it('does not override a stopped programme', async () => {
    const { pc, head } = held();
    await approve(pc, head);
    db.prepare("UPDATE programme_campaigns SET state = 'stopped', state_reason = 'operator' WHERE id = ?")
      .run(pc);

    expect(planFor(pc).safety.reason).toBe('PROGRAMME_STOPPED');
    expect(materialised(pc).created).toBe(false);
    expect(attemptRows()).toBe(0);
  });

  it('does not override a closed campaign', async () => {
    const { campaign, pc, head } = held();
    await approve(pc, head);
    db.prepare("UPDATE campaigns SET state = 'closed', closed_at = '2026-09-20T00:00:00.000Z', close_reason = 'completed' WHERE id = ?")
      .run(campaign);

    expect(planFor(pc).safety.reason).toBe('CAMPAIGN_NOT_ACTIVE');
    expect(materialised(pc).created).toBe(false);
    expect(attemptRows()).toBe(0);
  });

  it('does not override a revoked outreach record', async () => {
    const { pc, head } = held();
    await approve(pc, head);
    db.prepare("UPDATE outreach SET revoked_at = '2026-09-12T00:00:00.000Z' WHERE coach_id = ?")
      .run(head);

    expect(planFor(pc).safety.reason).toBe('OUTREACH_REVOKED');
    expect(materialised(pc).created).toBe(false);
    expect(attemptRows()).toBe(0);
  });

  it('does not override a suppressed address', async () => {
    const { pc, head } = held();
    await approve(pc, head);
    suppress({ email: 'h@duke.edu' });

    // Removed by the candidate filter before any of this, so the programme has
    // nobody to pursue rather than somebody it may not write to.
    const plan = planFor(pc);
    expect(plan.current).toBeNull();
    expect(plan.ineligible.map((c) => c.reason)).toEqual(['SUPPRESSED']);
    expect(materialised(pc).created).toBe(false);
    expect(attemptRows()).toBe(0);
  });

  it('changes no relationship row and no outreach history', async () => {
    const { pc, head } = held();
    relationship({ stance: 'default' });
    const snapshot = () => ({
      relationships: db.prepare('SELECT * FROM athlete_programmes').all(),
      outreach: db.prepare('SELECT * FROM outreach').all(),
      sends: db.prepare('SELECT * FROM outreach_send').all(),
    });
    const before = snapshot();
    await approve(pc, head);
    expect(snapshot()).toEqual(before);
  });
});

/* -------------------------------------------------------------------------- */
/* Scope: one coach, one campaign                                              */
/* -------------------------------------------------------------------------- */

describe('an approval covers exactly one coach in one campaign', () => {
  it('does not carry into the next campaign', async () => {
    const { pc, head } = held();
    await approve(pc, head);
    expect(review(pc).required).toBe(false);

    const second = makeCampaign();
    const pcTwo = makeProgramme(second);
    /**
     * A NEW CAMPAIGN ASKS ITS OWN QUESTION. The approval was for that
     * campaign's first approach; this is a different campaign making its own,
     * possibly months later, and the operator who set it up may be somebody
     * else entirely.
     */
    expect(review(pcTwo).required).toBe(true);
    expect(review(pcTwo).approval.status).toBe(APPROVAL_STATUS.NONE);
  });

  it('does not cover another coach at the same programme', async () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { tier: 'A' });
    const head = coach({ name: 'Aa Head', email: 'h@duke.edu' });
    const assistant = coach({ name: 'Bb Assistant', email: 'a@duke.edu', title: 'Assistant Coach' });
    manualHistory(head);
    manualHistory(assistant);

    await approve(pc, head);
    // The head coach is approved and is the current coach, so the plan moves.
    expect(review(pc).required).toBe(false);
    // But nothing was recorded about the assistant.
    expect(approvalRows()).toHaveLength(1);
    expect(approvalRows()[0].coach_id).toBe(head);
    expect(assistant).toBeTruthy();
  });

  it('leaves a coach with no history actionable while another is held', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { college: 'Duke' });
    const other = makeProgramme(campaign, { college: 'Elon' });
    const dukeHead = coach({ email: 'h@duke.edu' });
    coach({ school: 'Elon', email: 'h@elon.edu' });
    manualHistory(dukeHead);

    /**
     * THE HOLD IS ABOUT A PERSON, NOT A CAMPAIGN. Elon has never been written
     * to and is executable while Duke waits for somebody to look.
     */
    const out = campaignExecutionPlan(campaign, { onDate: '2026-09-15' });
    const byCollege = new Map(out.programmes.map((p) => [p.collegeName, p]));
    expect(byCollege.get('Duke').operatorReviewRequired).toBe(true);
    expect(byCollege.get('Elon').operatorReviewRequired).toBe(false);
    expect(byCollege.get('Elon').executableNow).toBe(true);
    expect(out.priorityActions.map((a) => a.collegeName)).toEqual(['Elon']);
    expect(pc && other).toBeTruthy();
  });

  it('dies with the programme campaign it belonged to', async () => {
    const { campaign, pc, head } = held();
    await approve(pc, head);
    expect(approvalRows()).toHaveLength(1);

    db.prepare('DELETE FROM programme_campaigns WHERE id = ?').run(pc);
    // ON DELETE CASCADE, like the contact attempts beside it: a review of a
    // pursuit that no longer exists is not a decision anybody can act on.
    expect(approvalRows()).toEqual([]);
    expect(campaign).toBeTruthy();
  });

  it('refuses to lose its coach out from under it', async () => {
    const { pc, head } = held();
    await approve(pc, head);
    // No ON DELETE clause on coach_id, so the delete is refused rather than
    // leaving an approval nobody can interpret.
    expect(() => db.prepare('DELETE FROM coaches WHERE id = ?').run(head)).toThrow();
    expect(approvalRows()).toHaveLength(1);
  });
});
