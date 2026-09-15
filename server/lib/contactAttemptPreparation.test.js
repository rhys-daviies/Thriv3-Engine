import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import db from '../db/client.js';
import {
  programmePursuitPlan, materialiseNextContactAttempt, contactAttemptPreparation,
  PREPARATION_REFUSAL, PURSUIT_ACTION,
} from './pursuitPolicy.js';
import { campaignExecutionPlan } from './campaignExecution.js';
import { attemptsForProgrammeCampaign, attemptForCoach } from './contactAttempts.js';
import { CONTACT_REFUSAL } from './campaignAttribution.js';
import { approveFirstTouch } from './firstTouchApprovals.js';
import { createOutreach } from './outreach.js';
import { recordDraft, acceptSend, openSendFor } from './outreachSend.js';
import { suppress } from './suppressions.js';
import { recordOutboundAttempt } from './outboundBudget.js';
import { ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';

/**
 * F9b-2 — ONE PREPARATION DECISION, SHARED.
 *
 * Preparing a contact attempt and executing one are different questions, and
 * the build had an answer to only the second. So a screen wanting to know
 * whether the button would work had `executableNow` to guess with, and
 * `executableNow` is wrong in both directions:
 *
 *   preparable, not executable   a draft campaign. Preparing is HOW a campaign
 *                                is reviewed before it is activated.
 *   executable, not preparable   a programme already prepared. There is nothing
 *                                new to prepare.
 *
 * ---------------------------------------------------------------------------
 * WHAT PREPARATION IGNORES, AND WHY THAT IS NOT AN OVERSIGHT.
 *
 * Campaign start date, outreach window, follow-up due date, mailbox limit,
 * athlete budget, sending identity. Every one of them answers "may this be sent
 * now", and none of them is a reason not to record what a campaign INTENDS.
 *
 * WHAT IT REFUSES: everything that makes the intent itself wrong. A first touch
 * nobody has reviewed, a stance, a suppression, a revocation, a stopped or
 * completed programme, a closed campaign, nobody to write to, nothing to say.
 * ---------------------------------------------------------------------------
 *
 * The point of the shared decision is that the dry run, the materialiser and
 * the endpoint cannot disagree — so the last two tests here compare them
 * directly rather than trusting that they were written alike.
 */

const ATHLETE = 'a-prep';
const TODAY = '2026-09-20';
let seq = 0;

function insertAthlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer')
  `).run(id, id);
}

function operator(id = `op-${++seq}`) {
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, created_at)
    VALUES (?, ?, 'x', '2026-09-01T00:00:00.000Z')
  `).run(id, `${id}@thriv3.test`);
  return id;
}

function coach({ email, school = 'Duke', title = 'Head Coach' } = {}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, '2026-09-01T00:00:00.000Z', ?, ?, ?, 'NCAA D1', 'mens-soccer', ?)
  `).run(id, `Coach ${++seq}`, email ?? `c${seq}@duke.edu`, school, title);
  return id;
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

function makeProgramme(campaignId, { college = 'Duke', tier = 'A', state = 'queued' } = {}) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, state, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', ?, 82, ?, ?, '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z')
  `).run(id, campaignId, college, ++seq, tier, state);
  return id;
}

function relationship({ stance = 'default', college = 'Duke' } = {}) {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state,
      flagged, visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', 'none', 0, 'default', ?,
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
  `).run(randomUUID(), ATHLETE, college, stance);
}

/** A real accepted message under a campaign, through the real write path. */
function sendUnder(pcId, coachId, { programmeCampaignId = pcId, at = '2026-09-10T09:00:00.000Z' } = {}) {
  const o = createOutreach({ athleteId: ATHLETE, coachId, programmeCampaignId });
  recordDraft({
    outreachId: o.id, athleteId: ATHLETE, coachId, collegeName: 'Duke', sport: 'mens-soccer',
    programmeCampaignId, evidence: null, body: `b${++seq}`, subject: 's',
  });
  acceptSend(openSendFor(o.id).id, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED, at });
  return o.id;
}

/** Contact by hand, before any of this campaign existed — the F6d trigger. */
function manualHistory(coachId, at = '2026-08-20T11:00:00.000Z') {
  const o = createOutreach({ athleteId: ATHLETE, coachId });
  recordDraft({
    outreachId: o.id, athleteId: ATHLETE, coachId, collegeName: 'Duke', sport: 'mens-soccer',
    evidence: null, body: `m${++seq}`, subject: 's',
  });
  acceptSend(openSendFor(o.id).id, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED, at });
  return o.id;
}

const decisionFor = (pc) => contactAttemptPreparation(programmePursuitPlan({ programmeCampaignId: pc }));
const preparable = (pc) => decisionFor(pc).allowed;
const entryFor = (campaignId, opts = {}) => campaignExecutionPlan(campaignId, { onDate: TODAY, ...opts }).programmes[0];

beforeEach(() => {
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM engagement_rollup; DELETE FROM tracking_events;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM campaign_first_touch_approvals;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM coaches; DELETE FROM athlete_programmes;
           DELETE FROM operator_users; DELETE FROM players; DELETE FROM suppressions;`);
  insertAthlete(ATHLETE);
  seq = 0;
});

/* -------------------------------------------------------------------------- */
/* Allowed                                                                     */
/* -------------------------------------------------------------------------- */

describe('preparation is allowed', () => {
  it('1. for an initial approach with no attempt yet', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    coach({});

    expect(decisionFor(pc)).toEqual({ allowed: true, reason: null, attempt: null });
    expect(entryFor(c).preparableNow).toBe(true);
  });

  /**
   * PREPARING IS HOW A DRAFT CAMPAIGN IS REVIEWED — F6b, preserved. A draft
   * refuses a SEND, and that refusal is TIMING: a draft becomes active by being
   * activated, and deciding who would be approached is the point of one.
   */
  it('3. for a DRAFT campaign, which cannot execute', () => {
    const c = makeCampaign({ state: 'draft' });
    const pc = makeProgramme(c);
    coach({});

    expect(preparable(pc)).toBe(true);
    const entry = entryFor(c);
    expect(entry.preparableNow).toBe(true);
    // And the two fields disagree, which is the whole reason for the new one.
    expect(entry.executableNow).toBe(false);
    expect(entry.safety.reason).toBe(CONTACT_REFUSAL.CAMPAIGN_NOT_ACTIVE);
  });

  it('5. for a follow-up that is not due yet', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    sendUnder(pc, head, { at: '2026-09-19T09:00:00.000Z' });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.nextAction).toBe(PURSUIT_ACTION.FOLLOW_UP);

    // Four policy days after the 19th, so not due on the 20th.
    const entry = entryFor(c);
    expect(entry.policyEligibleOn).toBe('2026-09-23');
    expect(entry.executableNow).toBe(false);
    expect(entry.preparableNow).toBe(true);
  });

  /**
   * 6. MAILBOX_LIMIT_REQUIRED — the state F8 found on the real screen when
   * THRIV3_MAILBOX_DAILY_OUTBOUND is unset, which turned every Ready programme
   * into one needing a decision.
   *
   * The limit is a module constant read at load, so it cannot be varied per
   * call through the execution plan. The decision is PURE and takes a plan, so
   * the honest test is to hand it a real plan carrying that exact budget refusal
   * and prove it is ignored — which is the contract, not a simulation of it.
   */
  it('6. when no mailbox daily limit is configured', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    coach({});

    const plan = programmePursuitPlan({ programmeCampaignId: pc, sendingIdentity: 'a@thriv3.test' });
    const unconfigured = {
      ...plan,
      budget: {
        evaluated: true, allowed: false, reason: 'MAILBOX_LIMIT_REQUIRED',
        athleteUsed: 0, athleteLimit: 10, mailboxUsed: 0, mailboxLimit: null,
      },
      executableNow: false,
    };

    expect(contactAttemptPreparation(unconfigured)).toEqual({
      allowed: true, reason: null, attempt: null,
    });
  });

  it('7. when the athlete has spent the whole day\'s sending budget', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});

    // Real consumption, through B5's own writer, until the athlete's daily
    // ceiling is gone.
    const elsewhere = coach({ school: 'Clemson', email: 'spend@clemson.edu' });
    for (let i = 0; i < 10; i += 1) {
      const o = createOutreach({ athleteId: ATHLETE, coachId: elsewhere });
      db.prepare('UPDATE outreach SET id = ? WHERE id = ?').run(`${o.id}`, o.id);
      recordOutboundAttempt({
        outreachId: o.id, athleteId: ATHLETE, sendingIdentity: 'a@thriv3.test', mailboxLimit: 500,
      });
      db.prepare('DELETE FROM outreach WHERE id = ?').run(o.id);
    }

    const entry = entryFor(c, { sendingIdentity: 'a@thriv3.test' });
    expect(entry.budget.allowed).toBe(false);
    expect(entry.budget.reason).toBe('ATHLETE_DAILY_BUDGET_EXHAUSTED');
    expect(entry.executableNow).toBe(false);
    // An exhausted budget is a fact about today. It says nothing about intent.
    expect(entry.preparableNow).toBe(true);
    expect(materialiseNextContactAttempt({ programmeCampaignId: pc }).created).toBe(true);
    expect(attemptForCoach(pc, head)).not.toBeNull();
  });

  it('when no sending identity is supplied at all', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    coach({});

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.budget.evaluated).toBe(false);
    expect(plan.executableNow).toBe(false);
    expect(contactAttemptPreparation(plan).allowed).toBe(true);
  });

  it('once a stale first-touch review has been approved', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    manualHistory(head);
    expect(decisionFor(pc).reason).toBe(PREPARATION_REFUSAL.FIRST_TOUCH_REVIEW_REQUIRED);

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    approveFirstTouch({
      programmeCampaignId: pc, coachId: head, operatorId: operator(),
      priorContact: plan.current.priorContact,
    });

    expect(preparable(pc)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Refused                                                                     */
/* -------------------------------------------------------------------------- */

describe('preparation is refused', () => {
  it('2. when an attempt is already prepared for the current coach', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    const decision = decisionFor(pc);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe(PREPARATION_REFUSAL.ALREADY_PREPARED);
    // It carries the row, because the endpoint answers 200 with it.
    expect(decision.attempt.id).toBe(attemptForCoach(pc, head).id);

    const entry = entryFor(c);
    expect(entry.preparableNow).toBe(false);
    expect(entry.currentAttempt).toMatchObject({
      id: decision.attempt.id, state: 'planned', storedStep: 1,
    });
    expect(entry.currentAttempt.createdAt).toEqual(expect.any(String));
    // Still executable: there is nothing NEW to prepare, and nothing wrong.
    expect(entry.executableNow).toBe(true);
  });

  it('4. for a CLOSED campaign', () => {
    const c = makeCampaign({ state: 'closed' });
    const pc = makeProgramme(c);
    coach({});

    expect(decisionFor(pc)).toMatchObject({
      allowed: false, reason: CONTACT_REFUSAL.CAMPAIGN_NOT_ACTIVE,
    });
    expect(entryFor(c).preparableNow).toBe(false);
  });

  it('8. for a manual-only relationship', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    coach({});
    relationship({ stance: 'manual_only' });

    expect(decisionFor(pc).reason).toBe(CONTACT_REFUSAL.RELATIONSHIP_MANUAL_ONLY);
    expect(entryFor(c).preparableNow).toBe(false);
  });

  it('9. for a do-not-contact relationship', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    coach({});
    relationship({ stance: 'do_not_contact' });

    expect(decisionFor(pc).reason).toBe(CONTACT_REFUSAL.RELATIONSHIP_DO_NOT_CONTACT);
    expect(entryFor(c).preparableNow).toBe(false);
  });

  /**
   * GLOBAL SUPPRESSION ARRIVES AS AN ABSENCE, not as a prohibition — the plan
   * drops a suppressed address from the candidates, so what reaches the decision
   * is a programme with nobody to write to. F9a found this and it is why
   * NO_ELIGIBLE_COACH exists: without it the refusal had no code at all.
   */
  it('10. when every address is suppressed, as NO_ELIGIBLE_COACH', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    coach({ email: 'only@duke.edu' });
    suppress({ email: 'only@duke.edu' });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.current).toBeNull();
    expect(plan.ineligible.map((c2) => c2.reason)).toContain('SUPPRESSED');

    expect(decisionFor(pc).reason).toBe(PREPARATION_REFUSAL.NO_ELIGIBLE_COACH);
    expect(entryFor(c).preparableNow).toBe(false);
  });

  it('10. when the programme has no staff on file at all', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);

    expect(decisionFor(pc).reason).toBe(PREPARATION_REFUSAL.NO_ELIGIBLE_COACH);
  });

  it('11. for a revoked relationship', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    const o = createOutreach({ athleteId: ATHLETE, coachId: head });
    db.prepare('UPDATE outreach SET revoked_at = ? WHERE id = ?')
      .run('2026-09-05T00:00:00.000Z', o.id);

    expect(decisionFor(pc).reason).toBe(CONTACT_REFUSAL.OUTREACH_REVOKED);
    expect(entryFor(c).preparableNow).toBe(false);
  });

  it('12. for a stopped programme', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c, { state: 'stopped' });
    coach({});

    expect(decisionFor(pc).reason).toBe(CONTACT_REFUSAL.PROGRAMME_STOPPED);
    expect(entryFor(c).preparableNow).toBe(false);
  });

  it('13. for a completed programme', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c, { state: 'completed' });
    coach({});

    expect(decisionFor(pc).reason).toBe(CONTACT_REFUSAL.PROGRAMME_COMPLETED);
    expect(entryFor(c).preparableNow).toBe(false);
  });

  it('14. when a first touch has never been reviewed', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    manualHistory(head);

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.firstTouchReview).toMatchObject({
      required: true, approval: { status: 'none' },
    });
    expect(decisionFor(pc).reason).toBe(PREPARATION_REFUSAL.FIRST_TOUCH_REVIEW_REQUIRED);
    expect(entryFor(c).preparableNow).toBe(false);
  });

  it('15. when a first-touch approval has gone stale', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    manualHistory(head);

    approveFirstTouch({
      programmeCampaignId: pc, coachId: head, operatorId: operator(),
      priorContact: programmePursuitPlan({ programmeCampaignId: pc }).current.priorContact,
    });
    expect(preparable(pc)).toBe(true);

    // Something else was sent by hand since the review was given, so what the
    // operator agreed to is no longer what is on file.
    manualHistory(head, '2026-09-15T11:00:00.000Z');

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.firstTouchReview.approval.status).toBe('stale');
    expect(decisionFor(pc).reason).toBe(PREPARATION_REFUSAL.FIRST_TOUCH_REVIEW_REQUIRED);
    expect(entryFor(c).preparableNow).toBe(false);
  });

  it('16. when a reply is waiting for a person, as NO_ACTION_TO_PREPARE', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    const o = sendUnder(pc, head);
    db.prepare(`INSERT INTO engagement_rollup (outreach_id, responded_at, updated_at)
      VALUES (?, '2026-09-12T10:00:00.000Z', '2026-09-12T10:00:00.000Z')`).run(o);

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.nextAction).toBe(PURSUIT_ACTION.AWAITING_OPERATOR);
    expect(decisionFor(pc).reason).toBe(PREPARATION_REFUSAL.NO_ACTION_TO_PREPARE);
    expect(entryFor(c).preparableNow).toBe(false);
  });

  it('16. when the programme\'s cold outreach is finished', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c, { tier: 'C' });
    const head = coach({});
    sendUnder(pc, head, { at: '2026-09-05T09:00:00.000Z' });
    sendUnder(pc, head, { at: '2026-09-12T09:00:00.000Z' });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.nextAction).toBe(PURSUIT_ACTION.NO_FURTHER_COLD_OUTREACH);
    expect(decisionFor(pc).reason).toBe(PREPARATION_REFUSAL.NO_ACTION_TO_PREPARE);
  });
});

/* -------------------------------------------------------------------------- */
/* One authority                                                               */
/* -------------------------------------------------------------------------- */

describe('the dry run, the materialiser and the decision cannot disagree', () => {
  /**
   * 17. THE POINT OF THE SLICE, ASSERTED DIRECTLY.
   *
   * Across every state that matters: whether the execution plan says a
   * programme is preparable, and whether the materialiser actually writes a row,
   * are the same answer. ALREADY_PREPARED is the one deliberate exception, and
   * it is asserted rather than excused — the decision refuses because there is
   * nothing NEW, while the write returns the existing row.
   */
  it('17. preparableNow predicts whether materialising writes a row', () => {
    const cases = [
      ['initial outreach', () => { coach({}); }, true],
      ['draft campaign', () => { coach({}); }, true, { state: 'draft' }],
      ['closed campaign', () => { coach({}); }, false, { state: 'closed' }],
      ['manual only', () => { coach({}); relationship({ stance: 'manual_only' }); }, false],
      ['do not contact', () => { coach({}); relationship({ stance: 'do_not_contact' }); }, false],
      ['no staff', () => {}, false],
      ['suppressed', () => { coach({ email: 'x@duke.edu' }); suppress({ email: 'x@duke.edu' }); }, false],
      ['unreviewed first touch', () => { manualHistory(coach({})); }, false],
    ];

    for (const [name, setup, expected, campaignOpts = {}] of cases) {
      db.exec(`DELETE FROM programme_contact_attempts; DELETE FROM outreach_send;
               DELETE FROM outreach; DELETE FROM programme_campaigns; DELETE FROM campaigns;
               DELETE FROM coaches; DELETE FROM athlete_programmes; DELETE FROM suppressions;`);
      const c = makeCampaign(campaignOpts);
      const pc = makeProgramme(c);
      setup();

      const predicted = entryFor(c).preparableNow;
      const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
      const wrote = attemptsForProgrammeCampaign(pc).length === 1;

      expect(predicted, name).toBe(expected);
      expect(wrote, name).toBe(expected);
      expect(Boolean(out.attempt), name).toBe(expected);
      expect(out.created, name).toBe(expected);
    }
  });

  it('17. ALREADY_PREPARED is the one refusal the materialiser does not honour', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    coach({});
    const first = materialiseNextContactAttempt({ programmeCampaignId: pc });

    expect(entryFor(c).preparableNow).toBe(false);

    // Refused as a DECISION, honoured as a WRITE: the existing row comes back.
    const second = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(second.preparation.reason).toBe(PREPARATION_REFUSAL.ALREADY_PREPARED);
    expect(second.created).toBe(false);
    expect(second.attempt.id).toBe(first.attempt.id);
    expect(attemptsForProgrammeCampaign(pc)).toHaveLength(1);
  });

  it('the materialiser reports the decision it acted on, either way', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    coach({});
    expect(materialiseNextContactAttempt({ programmeCampaignId: pc }).preparation)
      .toEqual({ allowed: true, reason: null, attempt: null });

    relationship({ stance: 'do_not_contact' });
    const refused = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(refused.preparation.allowed).toBe(false);
  });

  /**
   * 18. NO SECOND COPY OF THE RULES.
   *
   * The repository already guards module boundaries this way — see the import
   * assertion in campaignExecution.test.js. This is the same idea applied to the
   * rules F9b-2 moved: B7 must reach preparation through B6's function and must
   * not have grown its own stance, suppression or lifecycle handling.
   */
  it('18. campaignExecution reimplements no preparation or prohibition rule', () => {
    const code = fs.readFileSync(new URL('./campaignExecution.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(code).toMatch(/contactAttemptPreparation\(plan\)/);
    // Not the rules themselves, in any form.
    expect(code).not.toMatch(/standingProhibition|campaignContactDecision|isSuppressed/);
    expect(code).not.toMatch(/manual_only|do_not_contact|RELATIONSHIP_MANUAL_ONLY/);
    expect(code).not.toMatch(/approvalStatus|APPROVAL_STATUS/);
    // And preparableNow is never derived from executableNow.
    expect(code).not.toMatch(/preparableNow:\s*.*executableNow/);
  });

  it('18. the decision is pure — asking it writes nothing', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    coach({});

    for (let i = 0; i < 3; i += 1) {
      contactAttemptPreparation(programmePursuitPlan({ programmeCampaignId: pc }));
      campaignExecutionPlan(c, { onDate: TODAY });
    }

    expect(attemptsForProgrammeCampaign(pc)).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM outbound_send_attempt').get().n).toBe(0);
  });
});
