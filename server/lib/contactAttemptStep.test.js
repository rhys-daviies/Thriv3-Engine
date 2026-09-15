import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import {
  programmePursuitPlan, materialiseNextContactAttempt, PURSUIT_ACTION,
} from './pursuitPolicy.js';
import { campaignExecutionPlan, BLOCKER_SOURCE, BLOCKER_CODE } from './campaignExecution.js';
import {
  attemptsForProgrammeCampaign, attemptForCoach, createContactAttempt,
  reconcileContactAttemptStep, advanceAttemptForConfirmedSend, transitionContactAttempt,
} from './contactAttempts.js';
import { createOutreach } from './outreach.js';
import { recordDraft, acceptSend, transitionSend, openSendFor } from './outreachSend.js';
import { MESSAGE_STATE, ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';

/**
 * F9b-1 — THE STORED STEP IS A REFLECTION OF THE DERIVED ONE.
 *
 * Two records describe where a campaign's pursuit of a coach has got to, and
 * only one of them can be wrong:
 *
 *   derivedStep  B6 counts accepted campaign-local messages. It cannot be
 *                wrong, because it counts things that exist.
 *   storedStep   `programme_contact_attempts.step`. Something has to write it.
 *
 * When they disagree B7 raises CONTACT_ATTEMPT_STEP_DRIFT and the programme
 * stops being executable — correctly, because two records disagreeing is
 * exactly the thing nobody should guess about.
 *
 * ---------------------------------------------------------------------------
 * WHAT F9a FOUND. Nothing advanced the stored step, and creation hardcoded 1.
 * So preparing an attempt was enough to break the programme's own follow-up:
 * prepare at step 1, confirm one campaign send, and the derived step became 2
 * against a stored 1 — a DATA_INTEGRITY blocker on a programme that had none
 * before anybody touched it, and one that pressing Prepare again did not heal.
 *
 * The fix is the invariant, not a repair button. The step is written where the
 * derived one moves — the single transition that makes a message ACCEPTED — so
 * the two cannot come apart by a campaign doing its ordinary work.
 * ---------------------------------------------------------------------------
 *
 * FORWARD ONLY, IN BOTH WRITERS. A stored step AHEAD of the derived one is an
 * attempt claiming a message that is not on file; repairing that would erase
 * the only evidence of whatever produced it.
 */

const ATHLETE = 'a-step';
const OTHER_ATHLETE = 'a-step-other';
const TODAY = '2026-09-20';
let seq = 0;

function insertAthlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer')
  `).run(id, id);
}

function coach({ email, school = 'Duke', title = 'Head Coach' } = {}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, '2026-09-01T00:00:00.000Z', ?, ?, ?, 'NCAA D1', 'mens-soccer', ?)
  `).run(id, `Coach ${++seq}`, email ?? `c${seq}@${school.toLowerCase()}.edu`, school, title);
  return id;
}

function makeCampaign({ athleteId = ATHLETE, state = 'active' } = {}) {
  db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = '2026-09-01T00:00:00.000Z',
      close_reason = 'completed' WHERE athlete_id = ? AND state = 'active'`).run(athleteId);
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, '2026-09-01', '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 1)
  `).run(id, athleteId, state);
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

/**
 * A real accepted message, through the real write path — `createOutreach`,
 * `recordDraft`, then the acceptance transition. Never a raw INSERT: the whole
 * point of this suite is that the seam fires where acceptance actually happens.
 */
function sendUnder(pcId, coachId, {
  athleteId = ATHLETE, programmeCampaignId = pcId, at = `${TODAY}T09:00:00.000Z`, accept = true,
} = {}) {
  const o = createOutreach({ athleteId, coachId, programmeCampaignId });
  recordDraft({
    outreachId: o.id, athleteId, coachId,
    collegeName: 'Duke', sport: 'mens-soccer', programmeCampaignId,
    evidence: null, body: `b${++seq}`, subject: 's',
  });
  const open = openSendFor(o.id);
  if (accept) acceptSend(open.id, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED, at });
  return { outreachId: o.id, sendId: open.id };
}

const stepOf = (pc, coachId) => attemptForCoach(pc, coachId)?.step ?? null;
const entryFor = (campaignId, onDate = TODAY) => campaignExecutionPlan(campaignId, { onDate }).programmes[0];
const driftOn = (entry) => entry.blockers.some(
  (b) => b.source === BLOCKER_SOURCE.DATA_INTEGRITY
    && b.code === BLOCKER_CODE.CONTACT_ATTEMPT_STEP_DRIFT,
);

beforeEach(() => {
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM engagement_rollup; DELETE FROM tracking_events;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM campaign_first_touch_approvals;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM coaches; DELETE FROM athlete_programmes;
           DELETE FROM players; DELETE FROM suppressions;`);
  insertAthlete(ATHLETE);
  insertAthlete(OTHER_ATHLETE);
  seq = 0;
});

/* -------------------------------------------------------------------------- */
/* A + B — creation records where the campaign actually is                     */
/* -------------------------------------------------------------------------- */

describe('preparing an attempt records the derived step', () => {
  it('A. an initial approach is prepared at step 1, and nothing drifts', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
    expect(plan.step).toBe(1);

    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(out.created).toBe(true);
    expect(out.attempt.step).toBe(1);
    expect(stepOf(pc, head)).toBe(1);

    const entry = entryFor(c);
    expect(entry.stepConsistent).toBe(true);
    expect(driftOn(entry)).toBe(false);
    expect(entry.currentAttempt).toMatchObject({ state: 'planned', storedStep: 1 });
  });

  /**
   * THE DIRECT F9a REGRESSION.
   *
   * One campaign message has been accepted, so the derived step is 2 and the
   * next action is the follow-up. Before F9b-1 this created a step-1 attempt
   * and raised CONTACT_ATTEMPT_STEP_DRIFT on the first press of the button.
   */
  it('B. a follow-up is prepared at step 2, with no CONTACT_ATTEMPT_STEP_DRIFT', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    sendUnder(pc, head, { at: '2026-09-10T09:00:00.000Z' });

    // Nothing has ever been prepared for this coach: the send path created no
    // attempt, which is exactly the state every message in this build is in.
    expect(attemptsForProgrammeCampaign(pc)).toHaveLength(0);

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.nextAction).toBe(PURSUIT_ACTION.FOLLOW_UP);
    expect(plan.step).toBe(2);

    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(out.created).toBe(true);
    expect(out.attempt.step).toBe(2);

    const entry = entryFor(c);
    expect(entry.derivedStep).toBe(2);
    expect(entry.currentAttempt.storedStep).toBe(2);
    expect(entry.stepConsistent).toBe(true);
    expect(driftOn(entry)).toBe(false);
  });

  it('a step of 2 is still a `planned` attempt — a step is not a send', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    sendUnder(pc, head, { at: '2026-09-10T09:00:00.000Z' });

    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(out.attempt.step).toBe(2);
    // Advancing a step says where the pursuit is, never that this row sent
    // anything. `outreach_send` is the only thing that says a message happened.
    expect(out.attempt.state).toBe('planned');
  });

  it('refuses a step that is not a whole number from 1 upwards', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    for (const bad of [0, -1, 1.5, null, '2']) {
      expect(() => createContactAttempt({
        programmeCampaignId: pc, coachId: head, step: bad,
      })).toThrow(/whole number/);
    }
    expect(attemptsForProgrammeCampaign(pc)).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* C + D + E — the confirmed-send seam                                         */
/* -------------------------------------------------------------------------- */

describe('a confirmed campaign send advances the attempt with it', () => {
  it('C. prepare, send, and the follow-up is not blocked by drift', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});

    materialiseNextContactAttempt({ programmeCampaignId: pc });
    let entry = entryFor(c, '2026-09-10');
    expect(entry.executableNow).toBe(true);
    expect(entry.stepConsistent).toBe(true);

    sendUnder(pc, head, { at: '2026-09-10T09:00:00.000Z' });

    // The derived step moved, and the stored one moved with it — at the
    // acceptance, without anybody pressing anything.
    expect(stepOf(pc, head)).toBe(2);

    entry = entryFor(c, TODAY);
    expect(entry.nextAction).toBe(PURSUIT_ACTION.FOLLOW_UP);
    expect(entry.derivedStep).toBe(2);
    expect(entry.currentAttempt.storedStep).toBe(2);
    expect(entry.stepConsistent).toBe(true);
    expect(driftOn(entry)).toBe(false);
    // The whole point: the follow-up is available, not blocked by an integrity
    // error the act of preparing created.
    expect(entry.executableNow).toBe(true);
  });

  it('advances again on the second confirmed message of the sequence', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    sendUnder(pc, head, { at: '2026-09-10T09:00:00.000Z' });
    expect(stepOf(pc, head)).toBe(2);
    sendUnder(pc, head, { at: '2026-09-16T09:00:00.000Z' });
    expect(stepOf(pc, head)).toBe(3);
  });

  it('D. re-confirming the same message does not double-advance', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    const { sendId } = sendUnder(pc, head, { at: '2026-09-10T09:00:00.000Z' });
    expect(stepOf(pc, head)).toBe(2);
    const after = attemptForCoach(pc, head);

    // The same authoritative confirmation, processed twice.
    const replay = acceptSend(sendId, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
    expect(replay.changed).toBe(false);
    expect(stepOf(pc, head)).toBe(2);
    // Not restamped either: a replay must not move a timestamp that dates a
    // real transition.
    expect(attemptForCoach(pc, head).updated_at).toBe(after.updated_at);

    acceptSend(sendId, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
    expect(stepOf(pc, head)).toBe(2);
  });

  it('E. a draft that is never confirmed advances nothing', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    sendUnder(pc, head, { accept: false });
    expect(stepOf(pc, head)).toBe(1);
    expect(entryFor(c).stepConsistent).toBe(true);
  });

  it('E. a cancelled message advances nothing', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    const { sendId } = sendUnder(pc, head, { accept: false });
    transitionSend(sendId, MESSAGE_STATE.CANCELLED);
    expect(stepOf(pc, head)).toBe(1);
  });

  it('E. a failed message advances nothing, and its retry advances once', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    const { sendId } = sendUnder(pc, head, { accept: false });
    transitionSend(sendId, MESSAGE_STATE.QUEUED);
    transitionSend(sendId, MESSAGE_STATE.FAILED);
    expect(stepOf(pc, head)).toBe(1);

    transitionSend(sendId, MESSAGE_STATE.QUEUED);
    transitionSend(sendId, MESSAGE_STATE.SENDING);
    transitionSend(sendId, MESSAGE_STATE.ACCEPTED, {
      acceptedSource: ACCEPTED_SOURCE.OPERATOR_ASSERTED,
    });
    expect(stepOf(pc, head)).toBe(2);
  });

  it('F. manual outreach to the same coach advances nothing', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    // No campaign attribution at all — a person writing by hand.
    sendUnder(pc, head, { programmeCampaignId: null, at: '2026-09-10T09:00:00.000Z' });

    expect(stepOf(pc, head)).toBe(1);
    // And the campaign-local derivation agrees: a manual message is not one of
    // this campaign's two.
    expect(programmePursuitPlan({ programmeCampaignId: pc }).step).toBe(1);
    expect(entryFor(c).stepConsistent).toBe(true);
  });

  it('F. a manual send to a coach at another programme advances nothing', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    const elsewhere = coach({ school: 'Clemson', email: 'other@clemson.edu' });
    const o = createOutreach({ athleteId: ATHLETE, coachId: elsewhere });
    recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: elsewhere,
      collegeName: 'Clemson', sport: 'mens-soccer', evidence: null, body: 'b', subject: 's',
    });
    acceptSend(openSendFor(o.id).id, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });

    expect(stepOf(pc, head)).toBe(1);
  });

  it('G. a send attributed to a DIFFERENT programme campaign advances nothing here', () => {
    const first = makeCampaign();
    const pcOne = makeProgramme(first);
    const head = coach({});
    materialiseNextContactAttempt({ programmeCampaignId: pcOne });
    expect(stepOf(pcOne, head)).toBe(1);

    // A second campaign for the same athlete, pursuing the same coach. Its
    // messages are its own; the first campaign's attempt must not move.
    const second = makeCampaign();
    const pcTwo = makeProgramme(second);
    materialiseNextContactAttempt({ programmeCampaignId: pcTwo });

    sendUnder(pcTwo, head, { at: '2026-09-10T09:00:00.000Z' });

    expect(stepOf(pcTwo, head)).toBe(2);
    expect(stepOf(pcOne, head)).toBe(1);
  });

  it('G. an attempt existing for another coach at the programme is untouched', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    const assistant = coach({ title: 'Assistant Coach' });

    materialiseNextContactAttempt({ programmeCampaignId: pc });
    // Plan the assistant too, by stopping the head coach's pursuit and asking
    // again — the only route to a second attempt on one programme.
    transitionContactAttempt(attemptForCoach(pc, head).id, 'stopped', { reason: 'probe' });
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(stepOf(pc, assistant)).toBe(1);

    sendUnder(pc, assistant, { at: '2026-09-10T09:00:00.000Z' });

    expect(stepOf(pc, assistant)).toBe(2);
    expect(stepOf(pc, head)).toBe(1);
  });

  it('a confirmed send for a coach with no attempt is not an error', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});

    expect(() => sendUnder(pc, head, { at: '2026-09-10T09:00:00.000Z' })).not.toThrow();
    expect(attemptsForProgrammeCampaign(pc)).toHaveLength(0);
    expect(db.prepare("SELECT COUNT(*) n FROM outreach_send WHERE state = 'ACCEPTED'").get().n).toBe(1);
  });

  it('a STOPPED attempt is not resumed by a confirmed send', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const id = attemptForCoach(pc, head).id;
    transitionContactAttempt(id, 'stopped', { reason: 'operator stopped this pursuit' });

    const out = advanceAttemptForConfirmedSend({ programmeCampaignId: pc, coachId: head });
    expect(out).toMatchObject({ changed: false, reason: 'STOPPED' });
    expect(stepOf(pc, head)).toBe(1);
    expect(attemptForCoach(pc, head).state).toBe('stopped');
  });

  it('reports, rather than throws, when there is nothing to advance', () => {
    expect(advanceAttemptForConfirmedSend({ programmeCampaignId: null, coachId: 'x' }))
      .toMatchObject({ changed: false, reason: 'NO_ATTEMPT' });
    expect(advanceAttemptForConfirmedSend({ programmeCampaignId: 'nope', coachId: 'x' }))
      .toMatchObject({ changed: false, reason: 'NO_ATTEMPT' });
  });
});

/* -------------------------------------------------------------------------- */
/* H + I + J — re-prepare reconciliation                                       */
/* -------------------------------------------------------------------------- */

describe('re-preparing reconciles forward and never backwards', () => {
  it('H. a stale-behind attempt is caught up to the derived step, in place', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const before = attemptForCoach(pc, head);

    /**
     * Put the row into the state F9b-1 exists to repair: a confirmed campaign
     * message with a stored step left behind. Written directly, because the
     * seam now makes this unreachable through the ordinary path — which is the
     * whole point, and is what the C case proves.
     */
    db.prepare('UPDATE programme_contact_attempts SET step = 1 WHERE id = ?').run(before.id);
    sendUnder(pc, head, { at: '2026-09-10T09:00:00.000Z' });
    db.prepare('UPDATE programme_contact_attempts SET step = 1 WHERE id = ?').run(before.id);

    expect(programmePursuitPlan({ programmeCampaignId: pc }).step).toBe(2);
    expect(driftOn(entryFor(c))).toBe(true);

    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });

    expect(out.created).toBe(false);
    expect(out.attempt.id).toBe(before.id);
    expect(out.attempt.step).toBe(2);
    expect(attemptsForProgrammeCampaign(pc)).toHaveLength(1);
    expect(driftOn(entryFor(c))).toBe(false);
  });

  it('I. a stored step AHEAD of the derived one is never downgraded', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const id = attemptForCoach(pc, head).id;

    // One accepted message: derived step 2. Stored step forced to 3.
    sendUnder(pc, head, { at: '2026-09-10T09:00:00.000Z' });
    db.prepare('UPDATE programme_contact_attempts SET step = 3 WHERE id = ?').run(id);
    const before = attemptForCoach(pc, head);
    expect(programmePursuitPlan({ programmeCampaignId: pc }).step).toBe(2);

    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });

    expect(out.created).toBe(false);
    expect(out.attempt.step).toBe(3);
    expect(attemptForCoach(pc, head).updated_at).toBe(before.updated_at);

    // And the disagreement stays VISIBLE rather than being quietly resolved.
    const entry = entryFor(c);
    expect(entry.derivedStep).toBe(2);
    expect(entry.currentAttempt.storedStep).toBe(3);
    expect(entry.stepConsistent).toBe(false);
    expect(driftOn(entry)).toBe(true);
    expect(entry.executableNow).toBe(false);
  });

  it('I. the direct reconciler refuses to go backwards, without throwing', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const id = attemptForCoach(pc, head).id;
    db.prepare('UPDATE programme_contact_attempts SET step = 4 WHERE id = ?').run(id);

    const out = reconcileContactAttemptStep(id, 2);
    expect(out.changed).toBe(false);
    expect(out.step).toBe(4);
  });

  it('J. preparing twice with an unchanged plan writes nothing the second time', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});

    const first = materialiseNextContactAttempt({ programmeCampaignId: pc });
    const row = attemptForCoach(pc, head);

    const second = materialiseNextContactAttempt({ programmeCampaignId: pc });

    expect(second.created).toBe(false);
    expect(second.attempt.id).toBe(first.attempt.id);
    expect(attemptsForProgrammeCampaign(pc)).toHaveLength(1);
    // Unchanged, because nothing legitimate happened between the two calls.
    expect(attemptForCoach(pc, head)).toEqual(row);
  });

  it('J. a forward reconciliation is the one case that may restamp', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const id = attemptForCoach(pc, head).id;

    const out = reconcileContactAttemptStep(id, 3, { at: '2026-09-25T00:00:00.000Z' });
    expect(out.changed).toBe(true);
    expect(out.step).toBe(3);
    expect(out.updated_at).toBe('2026-09-25T00:00:00.000Z');

    // Equal is not a change, and must not restamp.
    const again = reconcileContactAttemptStep(id, 3, { at: '2026-09-26T00:00:00.000Z' });
    expect(again.changed).toBe(false);
    expect(attemptForCoach(pc, head).updated_at).toBe('2026-09-25T00:00:00.000Z');
  });

  it('reconciling does not change the attempt state', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    const head = coach({});
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const id = attemptForCoach(pc, head).id;

    reconcileContactAttemptStep(id, 3);
    expect(attemptForCoach(pc, head).state).toBe('planned');
  });
});
