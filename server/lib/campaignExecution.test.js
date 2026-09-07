import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import db from '../db/client.js';
import {
  campaignExecutionPlan, BLOCKER_SOURCE, BLOCKER_CODE, ACTION_CLASS,
} from './campaignExecution.js';
import { PURSUIT_ACTION, PURSUIT_REASON, FOLLOW_UP_DELAY_DAYS, materialiseNextContactAttempt } from './pursuitPolicy.js';
import { createOutreach, revokeOutreach } from './outreach.js';
import { recordDraft, confirmSend, acceptSend } from './outreachSend.js';
import { findOrCreateCoach } from './coaches.js';
import { suppress } from './suppressions.js';
import { markResponded } from './engagementRollup.js';
import { advanceContactAttemptStep, attemptsForProgrammeCampaign } from './contactAttempts.js';
import { recordOutboundAttempt, athleteUsage, mailboxUsage } from './outboundBudget.js';
import { stopProgrammeCampaign, closeCampaign } from './campaigns.js';
import { ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';
import { OUTLOOK_FROM_ADDRESS } from './config.js';

/**
 * B7 — the campaign-wide dry run.
 *
 * Three properties carry the slice:
 *
 *   1. BREADTH BEFORE DEPTH. Rank says which programme fits best, not which
 *      action is most urgent, and a campaign that confused the two would spend
 *      an athlete's whole day on its top two schools.
 *   2. LOOKING CHANGES NOTHING. Not a row, not a token, not a ledger entry.
 *   3. BLOCKED IS NOT ACTION REQUIRED. "Wait until Monday" and "somebody has
 *      to decide something" must not arrive as the same colour.
 */

const ATHLETE = 'a-exec';
const MAILBOX = OUTLOOK_FROM_ADDRESS.trim().toLowerCase();
const TODAY = '2026-09-07';
let seq = 0;

function insertAthlete(id, name) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer', ?)
  `).run(id, name, randomUUID().slice(0, 10));
}

function makeCampaign({ state = 'active', startsOn = '2020-01-01' } = {}) {
  db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = '2026-09-01T00:00:00.000Z',
      close_reason = 'completed' WHERE athlete_id = ? AND state = 'active'`).run(ATHLETE);
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, ?, '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 0)
  `).run(id, ATHLETE, state, startsOn);
  return id;
}

/** A programme with `staff` coaches: a head first, then assistants. */
function makeProgramme(campaignId, { college, rank, tier = 'A', state = 'queued', staff = 3 } = {}) {
  const id = `pc-${college}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', ?, 82, ?, 'AUTO', ?, '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z')
  `).run(id, campaignId, college, rank, tier, state);
  const coaches = [];
  for (let i = 0; i < staff; i += 1) {
    coaches.push(findOrCreateCoach({
      full_name: `${String.fromCharCode(65 + i)} Coach`,
      email: `c${i}@${college.toLowerCase()}.edu`,
      school: college, sport: 'mens-soccer', division: 'NCAA D1',
      position_title: i === 0 ? 'Head Coach' : 'Assistant Coach',
    }));
  }
  return { id, coaches };
}

/** A real accepted message under this campaign, through the real write path. */
function sendUnder(pcId, coachRow, { at = `${TODAY}T09:00:00.000Z` } = {}) {
  const o = createOutreach({ athleteId: ATHLETE, coachId: coachRow.id, programmeCampaignId: pcId });
  recordDraft({
    outreachId: o.id, athleteId: ATHLETE, coachId: coachRow.id,
    collegeName: db.prepare('SELECT college_name c FROM programme_campaigns WHERE id = ?').get(pcId).c,
    sport: 'mens-soccer', programmeCampaignId: pcId, evidence: null,
    body: `b${++seq}`, subject: 's',
  });
  confirmSend(o.id, at, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
  return o;
}

const plan = (campaignId, opts = {}) => campaignExecutionPlan(campaignId, { onDate: TODAY, ...opts });

/** A module's source with its comments removed, so a guard reads the code. */
function codeOf(relative) {
  return fs.readFileSync(new URL(relative, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

beforeEach(() => {
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM engagement_rollup; DELETE FROM tracking_events;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM coaches; DELETE FROM players; DELETE FROM suppressions;`);
  insertAthlete(ATHLETE, 'Exec Athlete');
  seq = 0;
});

// ---------------------------------------------------------------------------

describe('the campaign-wide plan', () => {
  it('covers every programme, in snapshot rank order', () => {
    const campaign = makeCampaign();
    makeProgramme(campaign, { college: 'Charlie', rank: 3, tier: 'A' });
    makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    makeProgramme(campaign, { college: 'Bravo', rank: 2, tier: 'A' });

    const out = plan(campaign);
    expect(out.programmes.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(out.programmes.map((p) => p.collegeName)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(out.summary.programmeCount).toBe(3);
    expect(out.campaign).toMatchObject({ id: campaign, athleteId: ATHLETE, state: 'active', onDate: TODAY });
  });

  it('carries B6 policy, B3 safety and B5 budget through without editing them', () => {
    const campaign = makeCampaign();
    const { id: pc } = makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });

    const entry = plan(campaign).programmes[0];
    expect(entry).toMatchObject({
      programmeCampaignId: pc, collegeName: 'Alpha', sport: 'mens-soccer',
      rank: 1, tier: 'A', tierSource: 'AUTO', programmeState: 'queued',
      policyVersion: 'PP1', coachDepth: 3,
      derivedStep: 1, nextAction: PURSUIT_ACTION.INITIAL_OUTREACH,
      policyReason: PURSUIT_REASON.FIRST_CONTACT, exhausted: false,
      executableNow: true, operatorReviewRequired: false,
    });
    expect(entry.currentCoach).toMatchObject({ role: 'head', emailStatus: 'unknown', order: 1 });
    expect(entry.safety).toMatchObject({ evaluated: true, allowed: true, reason: null });
    expect(entry.budget).toMatchObject({ evaluated: true, allowed: true });
    expect(entry.blockers).toEqual([]);
    // Compact, not the whole staff list.
    expect(entry.candidates).toEqual({ eligible: 3, beyondDepth: 0, ineligible: 0 });
  });

  it('re-derives none of B6, B5 or B3', () => {
    // Read the CODE, not the prose. This module explains at length what B3 and
    // B5 decide, and a guard that trips on its own explanation is not a guard
    // — the same lesson three earlier slices learned the same way.
    const code = codeOf('./campaignExecution.js');
    // It orchestrates. It reads no table of its own...
    expect(code).not.toMatch(/db\.prepare|from '\.\.\/db\//);
    // ...owns no eligibility, suppression or depth rule...
    expect(code).not.toMatch(/classifyRole|isSuppressed|CONTACT_LADDER|suppressions/);
    expect(code).not.toMatch(/TIER_COACH_DEPTH|MESSAGES_PER_COACH|FOLLOW_UP_DELAY_DAYS\s*=/);
    /**
     * ...and never decides a safety refusal for itself.
     *
     * It PROJECTS `outreach_ends_on` into the response, because a screen
     * showing the plan has to show the window it is bounded by. What it must
     * never do is COMPARE it — that comparison is B3's, and a second copy
     * would be the first thing to drift. Every safety code it emits is quoted
     * from the plan B6 handed it.
     */
    expect(code).not.toMatch(/outreach_ends_on\s*(<|>|<=|>=|===|!==)/);
    expect(code).not.toMatch(/(<|>|<=|>=|===|!==)\s*[a-zA-Z.]*outreach_ends_on/);
    expect(code).not.toMatch(/CONTACT_REFUSAL|campaignContactDecision|revoked_at/);
    expect(code).toMatch(/code:\s*plan\.safety\.reason/);
  });

  it('gives the same answer every time', () => {
    const campaign = makeCampaign();
    makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    makeProgramme(campaign, { college: 'Bravo', rank: 2, tier: 'B' });
    const first = plan(campaign);
    for (let i = 0; i < 3; i += 1) expect(plan(campaign)).toEqual(first);
  });

  it('404s in the data layer for a campaign that does not exist', () => {
    expect(() => plan('no-such-campaign')).toThrow(/No campaign/);
    try { plan('no-such-campaign'); } catch (err) { expect(err.code).toBe('CAMPAIGN_NOT_FOUND'); }
  });
});

// ---------------------------------------------------------------------------

describe('breadth before depth', () => {
  /**
   * Four programmes. Alpha (rank 1) has already had its head coach written to
   * twice, so its next action is a SECOND COACH. Bravo, Charlie and Delta have
   * never been written to at all.
   */
  function mixedCampaign() {
    const campaign = makeCampaign();
    const alpha = makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    const bravo = makeProgramme(campaign, { college: 'Bravo', rank: 25, tier: 'B' });
    const charlie = makeProgramme(campaign, { college: 'Charlie', rank: 2, tier: 'A' });
    const delta = makeProgramme(campaign, { college: 'Delta', rank: 60, tier: 'C' });
    sendUnder(alpha.id, alpha.coaches[0]);
    sendUnder(alpha.id, alpha.coaches[0]);
    return { campaign, alpha, bravo, charlie, delta };
  }

  it('considers a rank 25 first approach before rank 1\'s second coach', () => {
    const { campaign } = mixedCampaign();
    const order = plan(campaign).priorityActions;

    // THE POINT OF THIS LAYER. Rank says which programme fits best; it does
    // not say which action buys the most. A programme that has never heard of
    // the athlete goes first.
    expect(order.map((a) => a.collegeName)).toEqual(['Charlie', 'Bravo', 'Delta', 'Alpha']);
    expect(order[0].actionClass).toBe(ACTION_CLASS.FIRST_CONTACT);
    expect(order.at(-1)).toMatchObject({ collegeName: 'Alpha', rank: 1, actionClass: ACTION_CLASS.NEXT_COACH });
  });

  it('puts a due follow-up ahead of a second coach and behind a fresh programme', () => {
    const campaign = makeCampaign();
    const alpha = makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    const bravo = makeProgramme(campaign, { college: 'Bravo', rank: 2, tier: 'A' });
    const charlie = makeProgramme(campaign, { college: 'Charlie', rank: 3, tier: 'A' });

    // Alpha: two messages to coach 1 -> next is coach 2.
    sendUnder(alpha.id, alpha.coaches[0]);
    sendUnder(alpha.id, alpha.coaches[0]);
    // Bravo: one message, long enough ago that the follow-up is due.
    sendUnder(bravo.id, bravo.coaches[0], { at: '2026-08-01T09:00:00.000Z' });
    // Charlie: untouched.

    const order = plan(campaign).priorityActions;
    expect(order.map((a) => [a.collegeName, a.actionClass])).toEqual([
      ['Charlie', ACTION_CLASS.FIRST_CONTACT],
      ['Bravo', ACTION_CLASS.FOLLOW_UP],
      ['Alpha', ACTION_CLASS.NEXT_COACH],
    ]);
  });

  it('lets tier order programmes of the same action class, and rank break that tie', () => {
    const campaign = makeCampaign();
    makeProgramme(campaign, { college: 'Cee', rank: 55, tier: 'C' });
    makeProgramme(campaign, { college: 'Bee', rank: 30, tier: 'B' });
    makeProgramme(campaign, { college: 'Aytwo', rank: 9, tier: 'A' });
    makeProgramme(campaign, { college: 'Ayone', rank: 4, tier: 'A' });

    expect(plan(campaign).priorityActions.map((a) => a.collegeName))
      .toEqual(['Ayone', 'Aytwo', 'Bee', 'Cee']);
  });

  it('gives every programme its second coach before any gets a third', () => {
    const campaign = makeCampaign();
    const alpha = makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    const bravo = makeProgramme(campaign, { college: 'Bravo', rank: 2, tier: 'A' });
    // Alpha is two coaches deep, Bravo one.
    for (const c of [alpha.coaches[0], alpha.coaches[1]]) {
      sendUnder(alpha.id, c); sendUnder(alpha.id, c);
    }
    sendUnder(bravo.id, bravo.coaches[0]);
    sendUnder(bravo.id, bravo.coaches[0]);

    const order = plan(campaign).priorityActions;
    // Bravo's SECOND coach outranks Alpha's THIRD, despite Alpha ranking above
    // it — otherwise the top programme walks its whole staff first.
    expect(order.map((a) => [a.collegeName, a.coach.order])).toEqual([
      ['Bravo', 2], ['Alpha', 3],
    ]);
  });

  it('lets no programme occupy more than one slot, whatever its tier', () => {
    // Structural rather than a quota: B6 returns ONE next action per
    // programme, so a Tier A's six permitted actions are six separate plans.
    const campaign = makeCampaign();
    makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A', staff: 3 });
    makeProgramme(campaign, { college: 'Bravo', rank: 2, tier: 'A', staff: 3 });

    const order = plan(campaign).priorityActions;
    expect(order).toHaveLength(2);
    expect(new Set(order.map((a) => a.programmeCampaignId)).size).toBe(2);
  });

  it('cannot reach a full tie, because rank is unique within a campaign', () => {
    const campaign = makeCampaign();
    makeProgramme(campaign, { college: 'Zulu', rank: 7, tier: 'A' });
    // A1 made rank unique per campaign, so two programmes can never tie on
    // class, coach order, tier AND rank. The id tie-break in the comparator is
    // therefore defensive: it keeps the ordering total if that ever changes,
    // and it is unreachable today. Asserted rather than assumed, because a
    // comparator that returns 0 has no defined order in a JS sort.
    expect(() => makeProgramme(campaign, { college: 'Alpha', rank: 7, tier: 'A' }))
      .toThrow(/UNIQUE constraint failed: programme_campaigns.campaign_id, programme_campaigns.rank/);
  });

  it('produces the same ordering on every call', () => {
    const campaign = makeCampaign();
    for (const [college, rank, tier] of [['Zulu', 9, 'A'], ['Alpha', 4, 'A'], ['Mike', 30, 'B']]) {
      makeProgramme(campaign, { college, rank, tier });
    }
    const once = plan(campaign).priorityActions.map((a) => a.programmeCampaignId);
    for (let i = 0; i < 5; i += 1) {
      expect(plan(campaign).priorityActions.map((a) => a.programmeCampaignId)).toEqual(once);
    }
  });
});

// ---------------------------------------------------------------------------

describe('the budget simulation', () => {
  function bigCampaign(n) {
    const campaign = makeCampaign();
    for (let i = 1; i <= n; i += 1) {
      makeProgramme(campaign, { college: `P${String(i).padStart(2, '0')}`, rank: i, tier: 'A', staff: 1 });
    }
    return campaign;
  }

  it('marks exactly as many actions as the athlete has left', () => {
    const campaign = bigCampaign(14);
    const out = plan(campaign);

    expect(out.priorityActions).toHaveLength(14);
    expect(out.summary.budget.athleteRemaining).toBe(10);
    const within = out.priorityActions.filter((a) => a.withinBudgetToday);
    expect(within).toHaveLength(10);
    expect(within.map((a) => a.priority)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const beyond = out.priorityActions.filter((a) => !a.withinBudgetToday);
    expect(beyond).toHaveLength(4);
    for (const a of beyond) {
      expect(a.budgetSimulationReason).toBe(BLOCKER_CODE.ATHLETE_DAILY_BUDGET_WOULD_BE_EXCEEDED);
      expect(a.blockers).toContainEqual({
        source: BLOCKER_SOURCE.BUDGET, code: BLOCKER_CODE.ATHLETE_DAILY_BUDGET_WOULD_BE_EXCEEDED,
      });
    }
    expect(out.summary.withinBudgetTodayCount).toBe(10);
  });

  it('counts down from what has already been spent today', () => {
    const campaign = bigCampaign(14);
    // Three real actions already spent through B5's consuming path.
    const p1 = db.prepare("SELECT id FROM programme_campaigns WHERE college_name = 'P01'").get().id;
    const coach = db.prepare("SELECT id FROM coaches WHERE school = 'P01'").get();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: p1 });
    for (let i = 0; i < 3; i += 1) {
      recordOutboundAttempt({ outreachId: o.id, sendingIdentity: MAILBOX, mailboxLimit: 500 });
    }

    const out = plan(campaign);
    expect(out.summary.budget.athleteUsed).toBe(3);
    expect(out.summary.budget.athleteRemaining).toBe(7);
    expect(out.priorityActions.filter((a) => a.withinBudgetToday)).toHaveLength(7);
    expect(out.summary.simulation).toMatchObject({
      athleteRemainingAtStart: 7, athleteRemainingAfterPlan: 0,
    });
  });

  it('makes the lower of the two ceilings the effective one', () => {
    const campaign = bigCampaign(14);
    // The mailbox is nearly spent by another athlete entirely.
    const other = 'a-exec-other';
    insertAthlete(other, 'Other');
    const otherCoach = db.prepare("SELECT id FROM coaches WHERE school = 'P14'").get();
    const o = createOutreach({ athleteId: other, coachId: otherCoach.id });
    for (let i = 0; i < 498; i += 1) {
      recordOutboundAttempt({ outreachId: o.id, sendingIdentity: MAILBOX, athleteLimit: 1000 });
    }

    const out = plan(campaign);
    expect(out.summary.budget).toMatchObject({ athleteRemaining: 10, mailboxRemaining: 2 });
    const within = out.priorityActions.filter((a) => a.withinBudgetToday);
    expect(within).toHaveLength(2);
    expect(out.priorityActions[2].budgetSimulationReason)
      .toBe(BLOCKER_CODE.MAILBOX_DAILY_BUDGET_WOULD_BE_EXCEEDED);
    // Two different ceilings, two different reasons — never one blurred one.
    expect(out.priorityActions[2].blockers).toContainEqual({
      source: BLOCKER_SOURCE.BUDGET, code: BLOCKER_CODE.MAILBOX_DAILY_BUDGET_WOULD_BE_EXCEEDED,
    });
  });

  it('writes no ledger row, however much it simulates', () => {
    const campaign = bigCampaign(14);
    plan(campaign); plan(campaign); plan(campaign);
    expect(db.prepare('SELECT COUNT(*) n FROM outbound_send_attempt').get().n).toBe(0);
    expect(athleteUsage(ATHLETE)).toBe(0);
    expect(mailboxUsage(MAILBOX)).toBe(0);
  });

  it('evaluates a first-contact programme that has no relationship at all', () => {
    // The gap B6 flagged: B5's consuming form derives the athlete from an
    // outreach row, and there is none. The read-only form answers anyway, and
    // creates nothing to do it.
    const campaign = bigCampaign(2);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(0);

    const out = plan(campaign);
    for (const p of out.programmes) {
      expect(p.budget).toMatchObject({ evaluated: true, allowed: true, reason: null });
    }
    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(0);
  });

  it('leaves the consuming path\'s security exactly as it was', () => {
    const campaign = bigCampaign(1);
    const other = 'a-exec-other';
    insertAthlete(other, 'Other');
    const coach = db.prepare("SELECT id FROM coaches WHERE school = 'P01'").get();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });

    // Reading may be told an athlete. SPENDING may not.
    expect(() => recordOutboundAttempt({
      outreachId: o.id, athleteId: other, sendingIdentity: MAILBOX, mailboxLimit: 500,
    })).toThrow(/belongs to a different athlete/);
    expect(athleteUsage(other)).toBe(0);

    const src = fs.readFileSync(new URL('./outboundBudget.js', import.meta.url), 'utf8');
    const consume = src.slice(src.indexOf('const consume = db.transaction'),
      src.indexOf('export function recordManualOutboundAttempt'));
    expect(consume).not.toMatch(/outboundBudgetDecisionForAthlete/);
    expect(consume).toMatch(/resolveAthlete|outboundBudgetDecision\(/);
  });
});

// ---------------------------------------------------------------------------

describe('follow-up timing', () => {
  function afterOneMessage(sentAt) {
    const campaign = makeCampaign();
    const p = makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    sendUnder(p.id, p.coaches[0], { at: sentAt });
    return { campaign, p };
  }

  it('does not make a follow-up executable the moment the first message goes', () => {
    const { campaign } = afterOneMessage(`${TODAY}T09:00:00.000Z`);
    const entry = plan(campaign).programmes[0];

    expect(entry.nextAction).toBe(PURSUIT_ACTION.FOLLOW_UP);
    expect(entry.executableNow).toBe(false);
    expect(entry.blockers).toContainEqual({
      source: BLOCKER_SOURCE.TIMING, code: BLOCKER_CODE.FOLLOW_UP_NOT_YET_DUE,
    });
    // Not a person's problem — it is simply not Thursday yet.
    expect(entry.operatorReviewRequired).toBe(false);
    expect(entry.policyEligibleOn).toBe('2026-09-11');
  });

  it('is explicit about the boundary day', () => {
    const { campaign } = afterOneMessage('2026-09-03T09:00:00.000Z');
    // Four policy days after the 3rd is the 7th, and the 7th IS the day it
    // becomes eligible — not the day before it does.
    expect(FOLLOW_UP_DELAY_DAYS).toBe(4);
    expect(plan(campaign, { onDate: '2026-09-06' }).programmes[0].executableNow).toBe(false);
    expect(plan(campaign, { onDate: '2026-09-07' }).programmes[0]).toMatchObject({
      executableNow: true, policyEligibleOn: '2026-09-07', blockers: [],
    });
    expect(plan(campaign, { onDate: '2026-09-08' }).programmes[0].executableNow).toBe(true);
  });

  it('counts calendar days, and fabricates no clock time or timezone', () => {
    const { campaign } = afterOneMessage('2026-09-03T23:59:59.000Z');
    const entry = plan(campaign).programmes[0];
    // A DATE, derived from the accepted message's own date. Nothing here
    // resolves an instant, and next_action_at stays unwritten.
    expect(entry.policyEligibleOn).toBe('2026-09-07');
    expect(entry.nextActionAt).toBeNull();
    expect(db.prepare('SELECT next_action_at FROM programme_contact_attempts').all()).toEqual([]);

    expect(codeOf('./campaignExecution.js')).not.toMatch(/timeZone|getDay\(\)|holiday|business.?day/i);
  });

  it('treats an accepted message with no timestamp as a person\'s problem', () => {
    const campaign = makeCampaign();
    const p = makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    const o = sendUnder(p.id, p.coaches[0]);
    // Not producible through acceptSend; if one is ever met, "we do not know
    // when the clock started" must not read as "due now".
    db.prepare('UPDATE outreach_send SET sent_at = NULL WHERE outreach_id = ?').run(o.id);

    const entry = plan(campaign).programmes[0];
    expect(entry.executableNow).toBe(false);
    expect(entry.operatorReviewRequired).toBe(true);
    expect(entry.blockers).toContainEqual({
      source: BLOCKER_SOURCE.TIMING, code: BLOCKER_CODE.UNRESOLVED_FOLLOW_UP_TIMING,
    });
    expect(entry.policyEligibleOn).toBeNull();
  });

  it('leaves an initial approach immediately actionable', () => {
    const campaign = makeCampaign();
    makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    expect(plan(campaign).programmes[0]).toMatchObject({
      nextAction: PURSUIT_ACTION.INITIAL_OUTREACH, executableNow: true, policyEligibleOn: null,
    });
  });
});

// ---------------------------------------------------------------------------

describe('step reconciliation', () => {
  it('is consistent when the stored step matches the derived one', () => {
    const campaign = makeCampaign();
    const p = makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    materialiseNextContactAttempt({ programmeCampaignId: p.id });

    const entry = plan(campaign).programmes[0];
    expect(entry.currentAttempt).toMatchObject({ state: 'planned', storedStep: 1 });
    expect(entry.derivedStep).toBe(1);
    expect(entry.stepConsistent).toBe(true);
    expect(entry.executableNow).toBe(true);
  });

  it('is vacuously consistent where no attempt has claimed a step', () => {
    const campaign = makeCampaign();
    makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    const entry = plan(campaign).programmes[0];
    expect(entry.currentAttempt).toEqual({ id: null, state: null, storedStep: null });
    expect(entry.stepConsistent).toBe(true);
  });

  it('surfaces drift as a data-integrity blocker and corrects nothing', () => {
    const campaign = makeCampaign();
    const p = makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    const { attempt } = materialiseNextContactAttempt({ programmeCampaignId: p.id });
    // The stored counter says step 2; no message exists, so the derived step
    // is 1. Two records disagreeing is nobody's guess to settle in a read.
    advanceContactAttemptStep(attempt.id);

    const entry = plan(campaign).programmes[0];
    expect(entry.derivedStep).toBe(1);
    expect(entry.currentAttempt.storedStep).toBe(2);
    expect(entry.stepConsistent).toBe(false);
    expect(entry.operatorReviewRequired).toBe(true);
    expect(entry.executableNow).toBe(false);
    expect(entry.blockers).toContainEqual({
      source: BLOCKER_SOURCE.DATA_INTEGRITY, code: BLOCKER_CODE.CONTACT_ATTEMPT_STEP_DRIFT,
    });
    expect(plan(campaign).summary.stepDriftCount).toBe(1);

    // Read, not repair.
    expect(attemptsForProgrammeCampaign(p.id)[0].step).toBe(2);
  });

  it('keeps a drifting programme out of the priority list', () => {
    const campaign = makeCampaign();
    const a = makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    makeProgramme(campaign, { college: 'Bravo', rank: 2, tier: 'A' });
    const { attempt } = materialiseNextContactAttempt({ programmeCampaignId: a.id });
    advanceContactAttemptStep(attempt.id);

    expect(plan(campaign).priorityActions.map((x) => x.collegeName)).toEqual(['Bravo']);
  });
});

// ---------------------------------------------------------------------------

describe('blocked versus action required', () => {
  it('plans a draft campaign, blocked and needing nobody', () => {
    const campaign = makeCampaign({ state: 'draft' });
    makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });

    const out = plan(campaign);
    const entry = out.programmes[0];
    expect(entry.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);   // a plan exists
    expect(entry.executableNow).toBe(false);
    expect(entry.blockers).toContainEqual({ source: BLOCKER_SOURCE.SAFETY, code: 'CAMPAIGN_NOT_ACTIVE' });
    // Launching it is the answer, not an operator investigation.
    expect(entry.operatorReviewRequired).toBe(false);
    expect(out.summary.blockedBySafetyCount).toBe(1);
    expect(out.summary.operatorReviewRequiredCount).toBe(0);
  });

  it('keeps a closed campaign inspectable and unexecutable', () => {
    const campaign = makeCampaign();
    makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    closeCampaign(campaign, { reason: 'completed' });

    const out = plan(campaign);
    expect(out.campaign.state).toBe('closed');
    expect(out.programmes[0].nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
    expect(out.programmes[0].executableNow).toBe(false);
    expect(out.programmes[0].blockers)
      .toContainEqual({ source: BLOCKER_SOURCE.SAFETY, code: 'CAMPAIGN_NOT_ACTIVE' });
    expect(out.summary.executableNowCount).toBe(0);
  });

  it('blocks a campaign that has not started, without asking anyone to act', () => {
    const campaign = makeCampaign({ startsOn: '2027-01-01' });
    makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    const entry = plan(campaign).programmes[0];
    expect(entry.blockers).toContainEqual({ source: BLOCKER_SOURCE.SAFETY, code: 'CAMPAIGN_NOT_STARTED' });
    expect(entry.operatorReviewRequired).toBe(false);
  });

  it('blocks a stopped programme as an expected outcome', () => {
    const campaign = makeCampaign();
    const p = makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    stopProgrammeCampaign(p.id, { reason: 'not_recruiting' });

    const entry = plan(campaign).programmes[0];
    expect(entry.programmeState).toBe('stopped');
    expect(entry.executableNow).toBe(false);
    expect(entry.blockers).toContainEqual({ source: BLOCKER_SOURCE.SAFETY, code: 'PROGRAMME_STOPPED' });
    expect(entry.operatorReviewRequired).toBe(false);
  });

  it('asks for a person when a relationship has been revoked', () => {
    const campaign = makeCampaign();
    const p = makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A', staff: 1 });
    const o = createOutreach({ athleteId: ATHLETE, coachId: p.coaches[0].id, programmeCampaignId: p.id });
    revokeOutreach(o.id);

    const entry = plan(campaign).programmes[0];
    expect(entry.blockers).toContainEqual({ source: BLOCKER_SOURCE.SAFETY, code: 'OUTREACH_REVOKED' });
    // Waiting will not un-revoke it.
    expect(entry.operatorReviewRequired).toBe(true);
    expect(plan(campaign).priorityActions).toEqual([]);
  });

  it('asks for a person when every address on a staff is suppressed', () => {
    const campaign = makeCampaign();
    const p = makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A', staff: 2 });
    for (const c of p.coaches) suppress({ email: c.email, reason: 'unsubscribed' });

    const entry = plan(campaign).programmes[0];
    expect(entry.nextAction).toBe(PURSUIT_ACTION.NO_FURTHER_COLD_OUTREACH);
    expect(entry.blockers).toContainEqual({
      source: BLOCKER_SOURCE.POLICY, code: PURSUIT_REASON.NO_ELIGIBLE_COACHES,
    });
    expect(entry.operatorReviewRequired).toBe(true);
    expect(plan(campaign).summary.noEligibleCoachCount).toBe(1);
  });

  it('counts a finished programme as exhausted, not as blocked', () => {
    const campaign = makeCampaign();
    const p = makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'C', staff: 1 });
    sendUnder(p.id, p.coaches[0]); sendUnder(p.id, p.coaches[0]);

    const out = plan(campaign);
    expect(out.programmes[0].exhausted).toBe(true);
    expect(out.summary.exhaustedByPolicyCount).toBe(1);
    // Finished is not the same as prevented, and a screen must not paint them
    // the same colour.
    expect(out.summary.blockedBySafetyCount).toBe(0);
    expect(out.summary.operatorReviewRequiredCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('a recorded response', () => {
  it('takes the programme out of the priority list and asks for a person', () => {
    const campaign = makeCampaign();
    const a = makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    makeProgramme(campaign, { college: 'Bravo', rank: 2, tier: 'A' });
    const o = sendUnder(a.id, a.coaches[0]);
    markResponded(o.id);

    const out = plan(campaign);
    const entry = out.programmes.find((p) => p.collegeName === 'Alpha');
    expect(entry.nextAction).toBe(PURSUIT_ACTION.AWAITING_OPERATOR);
    expect(entry.operatorReviewRequired).toBe(true);
    expect(entry.blockers).toContainEqual({
      source: BLOCKER_SOURCE.OPERATOR, code: BLOCKER_CODE.RESPONSE_OBSERVED,
    });
    expect(out.summary.awaitingOperatorCount).toBe(1);
    // No cold action is proposed anywhere at that programme.
    expect(out.priorityActions.map((x) => x.collegeName)).toEqual(['Bravo']);
  });

  it('does not classify the reply', () => {
    expect(codeOf('./campaignExecution.js'))
      .not.toMatch(/INTERESTED|NOT_INTERESTED|SENTIMENT|POSITIVE_REPLY/i);
  });
});

// ---------------------------------------------------------------------------

describe('what a dry run leaves behind', () => {
  it('is nothing at all', () => {
    const campaign = makeCampaign();
    const a = makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    makeProgramme(campaign, { college: 'Bravo', rank: 2, tier: 'B' });
    sendUnder(a.id, a.coaches[0]);
    materialiseNextContactAttempt({ programmeCampaignId: a.id });

    const tables = ['campaigns', 'programme_campaigns', 'programme_contact_attempts',
      'outreach', 'outreach_send', 'outreach_send_event', 'outbound_send_attempt',
      'coaches', 'players', 'suppressions', 'engagement_rollup', 'outreach_evidence'];
    const before = Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]));

    for (let i = 0; i < 5; i += 1) plan(campaign);

    for (const t of tables) {
      expect(db.prepare(`SELECT * FROM ${t}`).all(), t).toEqual(before[t]);
    }
  });

  it('mints no token, creates no attempt and calls no transport', () => {
    const campaign = makeCampaign();
    makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    plan(campaign);

    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM programme_contact_attempts').get().n).toBe(0);

    // MODULE PATHS, not whole import lines: this file imports
    // OUTLOOK_FROM_ADDRESS from config, and matching the line would read that
    // as a transport.
    const src = fs.readFileSync(new URL('./campaignExecution.js', import.meta.url), 'utf8');
    const modules = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(modules.sort()).toEqual([
      './campaigns.js', './config.js', './pursuitPolicy.js', './time.js',
    ]);
    // Not even the one B6 helper that writes.
    const code = codeOf('./campaignExecution.js');
    expect(code).not.toMatch(/materialiseNextContactAttempt|createContactAttempt|createOutreach/);
    expect(code).not.toMatch(/recordOutboundAttempt|acceptSend|transitionSend/);
  });

  it('moves no campaign or programme state', () => {
    const campaign = makeCampaign();
    const p = makeProgramme(campaign, { college: 'Alpha', rank: 1, tier: 'A' });
    const cBefore = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign);
    const pBefore = db.prepare('SELECT * FROM programme_campaigns WHERE id = ?').get(p.id);

    plan(campaign);

    expect(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign)).toEqual(cBefore);
    expect(db.prepare('SELECT * FROM programme_campaigns WHERE id = ?').get(p.id)).toEqual(pBefore);
    expect(pBefore.state).toBe('queued');
  });
});
