import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import {
  programmePursuitPlan, materialiseNextContactAttempt,
  PURSUIT_ACTION, FIRST_TOUCH_REVIEW,
} from './pursuitPolicy.js';
import { campaignExecutionPlan, BLOCKER_SOURCE, BLOCKER_CODE } from './campaignExecution.js';
import { attemptsForProgrammeCampaign } from './contactAttempts.js';
import { suppress } from './suppressions.js';
import { MESSAGE_STATE } from '../../shared/outreachMessageState.js';

/**
 * F6d — A FIRST TOUCH TO SOMEBODY WHO IS NOT A FIRST TOUCH.
 *
 * A campaign counts its own messages, so a coach this athlete wrote to by hand
 * last month starts at step one and the campaign's opening line introduces an
 * athlete the coach has already met. F6c made that visible; this stops it
 * happening without anybody seeing it.
 *
 * ---------------------------------------------------------------------------
 * IT IS A HOLD, NOT A REFUSAL, and the difference matters in both directions.
 *
 * Nothing is forbidden. The stance rules refuse — `do_not_contact` says nobody
 * may write, `manual_only` says the campaign may not — and those are decisions
 * somebody already took. This says a decision has NOT been taken: a person
 * should look at the history and will very often send the message anyway.
 *
 * So it must not be collapsed into the prohibitions, it must not touch the
 * campaign-local sequence, and it must not erase or rewrite what is on file.
 * ---------------------------------------------------------------------------
 *
 * GATED ON INITIAL_OUTREACH. After this campaign's own step 1 the fact is
 * expected to be true — the campaign put it there — so a follow-up is never
 * held on evidence of the message it is following up.
 */

const ATHLETE = 'a-touch';
const OTHER_ATHLETE = 'a-touch-other';
let seq = 0;

function insertAthlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer')
  `).run(id, id);
}

function coach({
  name = 'A Coach', email, school = 'Duke', sport = 'mens-soccer', title = 'Head Coach',
} = {}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, '2026-09-01T00:00:00.000Z', ?, ?, ?, 'NCAA D1', ?, ?)
  `).run(id, name, email ?? `c${++seq}@duke.edu`, school, sport, title);
  return id;
}

function outreach({ athleteId = ATHLETE, coachId, drafted = null, sent = null, revoked = null }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, drafted_at, sent_at, revoked_at)
    VALUES (?, ?, ?, ?, '2026-09-01T00:00:00.000Z', ?, ?, ?)
  `).run(id, athleteId, coachId, randomUUID(), drafted, sent, revoked);
  return id;
}

function message({
  outreachId, coachId, state = MESSAGE_STATE.ACCEPTED, sentAt = null, origin = null,
  athleteId = ATHLETE, programmeCampaignId = null,
}) {
  db.prepare(`
    INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, sent_at, athlete_id, coach_id,
      college_name, sport, programme_campaign_id, origin, policy_version, state, created_at)
    VALUES (?, ?, ?, '2026-09-01T10:00:00.000Z', ?, ?, ?, 'Duke', 'mens-soccer', ?, ?,
      'LEGACY_UNKNOWN', ?, '2026-09-01T00:00:00.000Z')
  `).run(randomUUID(), outreachId, ++seq, sentAt, athleteId, coachId, programmeCampaignId,
    origin, state);
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

function relationship({ stance = 'default', flagged = 0, requestState = 'none' } = {}) {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state,
      flagged, visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, 'Duke', 'mens-soccer', ?, ?, 'default', ?,
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
  `).run(randomUUID(), ATHLETE, requestState, flagged, stance);
}

/** An accepted message, sent by hand, before any of this campaign existed. */
function manualHistory(coachId, at = '2026-08-20T11:00:00.000Z') {
  const o = outreach({ coachId, sent: at });
  message({ outreachId: o, coachId, sentAt: at, origin: 'manual' });
  return o;
}

/** An accepted message attributed to a campaign. */
function sendUnder(programmeCampaignId, coachId, at = '2026-09-05T11:00:00.000Z') {
  const existing = db.prepare('SELECT id FROM outreach WHERE athlete_id = ? AND coach_id = ?')
    .get(ATHLETE, coachId);
  const id = existing?.id ?? outreach({ coachId, sent: at });
  message({ outreachId: id, coachId, sentAt: at, origin: 'campaign', programmeCampaignId });
  return id;
}

const planFor = (pc) => programmePursuitPlan({ programmeCampaignId: pc });
const review = (pc) => planFor(pc).firstTouchReview;
const attempts = (pc) => attemptsForProgrammeCampaign(pc);
const attemptRows = () => db.prepare('SELECT COUNT(*) c FROM programme_contact_attempts').get().c;

/** One campaign, one Duke, one head coach — the shape most tests need. */
function scene({ campaign: campaignOpts } = {}) {
  const campaign = makeCampaign(campaignOpts);
  const pc = makeProgramme(campaign);
  return { campaign, pc, head: coach({ email: 'h@duke.edu' }) };
}

beforeEach(() => {
  seq = 0;
  db.exec(`DELETE FROM programme_contact_attempts; DELETE FROM outreach_evidence;
           DELETE FROM engagement_rollup; DELETE FROM tracking_events;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes; DELETE FROM players; DELETE FROM coaches;
           DELETE FROM suppressions;`);
  insertAthlete(ATHLETE);
  insertAthlete(OTHER_ATHLETE);
});

/* -------------------------------------------------------------------------- */
/* When a person has to look                                                   */
/* -------------------------------------------------------------------------- */

describe('a first approach to somebody already written to', () => {
  it('needs no review where nobody has written to them', () => {
    const { pc } = scene();
    expect(planFor(pc).nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
    expect(review(pc)).toEqual({ required: false, reason: null });
  });

  it('is held after a manual send', () => {
    const { pc, head } = scene();
    manualHistory(head);

    expect(review(pc)).toEqual({
      required: true, reason: FIRST_TOUCH_REVIEW.PRIOR_CONFIRMED_CONTACT,
    });
  });

  it('is held after a previous campaign', () => {
    const first = makeCampaign();
    const pcOne = makeProgramme(first);
    const head = coach({ email: 'h@duke.edu' });
    sendUnder(pcOne, head);

    const second = makeCampaign();
    const pcTwo = makeProgramme(second);
    // A new campaign legitimately re-approaches a coach an old one spoke to —
    // that is a shipped decision and unchanged. It is the SILENCE that is
    // being fixed, not the re-approach.
    expect(review(pcTwo).required).toBe(true);
  });

  it('is held on a send whose origin nobody recorded', () => {
    const { pc, head } = scene();
    const o = outreach({ coachId: head, sent: '2026-08-20T11:00:00.000Z' });
    message({ outreachId: o, coachId: head, sentAt: '2026-08-20T11:00:00.000Z', origin: null });

    // Unknown origin is still a confirmed send. Requiring a known origin would
    // wave through every row written before the column existed.
    expect(review(pc).required).toBe(true);
  });

  it('is held on a legacy relationship whose count is zero', () => {
    const { pc, head } = scene();
    outreach({ coachId: head, sent: '2025-04-02T11:00:00.000Z' });

    /**
     * THE CASE THE RULE IS MOST EASILY GOT WRONG ON. `confirmedSendCount` is 0
     * because the per-message table did not exist yet, and a rule written as
     * `count > 0` would wave through precisely the coaches with the longest
     * history. The condition reads `hasConfirmedSend`.
     */
    const plan = planFor(pc);
    expect(plan.current.priorContact.confirmedSendCount).toBe(0);
    expect(plan.current.priorContact.hasConfirmedSend).toBe(true);
    expect(plan.firstTouchReview.required).toBe(true);
  });

  it('is not held by a draft nobody sent', () => {
    const { pc, head } = scene();
    const o = outreach({ coachId: head, drafted: '2026-08-20T10:00:00.000Z' });
    message({ outreachId: o, coachId: head, state: MESSAGE_STATE.DRAFT });
    expect(review(pc).required).toBe(false);
  });

  it('is not held by a failed send', () => {
    const { pc, head } = scene();
    const o = outreach({ coachId: head, drafted: '2026-08-20T10:00:00.000Z' });
    message({ outreachId: o, coachId: head, state: MESSAGE_STATE.FAILED });
    expect(review(pc).required).toBe(false);
  });

  it('is not held by another athlete writing to the same coach', () => {
    const { pc, head } = scene();
    const o = outreach({ athleteId: OTHER_ATHLETE, coachId: head, sent: '2026-08-20T11:00:00.000Z' });
    message({
      outreachId: o, coachId: head, athleteId: OTHER_ATHLETE,
      sentAt: '2026-08-20T11:00:00.000Z', origin: 'manual',
    });
    // The message would introduce THIS athlete, whom this coach has not met.
    expect(review(pc).required).toBe(false);
  });

  it('is not held by history with a different coach at the same school', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    coach({ name: 'Aa Head', email: 'h@duke.edu' });
    const assistant = coach({ name: 'Bb Assistant', email: 'a@duke.edu', title: 'Assistant Coach' });
    manualHistory(assistant);

    // The plan's current coach is the head coach, who has heard nothing.
    const plan = planFor(pc);
    expect(plan.current.role).toBe('head');
    expect(plan.firstTouchReview.required).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Follow-ups are not first touches                                            */
/* -------------------------------------------------------------------------- */

describe('a genuine follow-up is never held', () => {
  it('proceeds after this campaign has already written to them', () => {
    const { pc, head } = scene();
    sendUnder(pc, head);

    /**
     * THE GATE, DOING ITS JOB. Prior contact is true — this campaign created
     * it — and holding on that would stop every second message in the product
     * on evidence of its own first one.
     */
    const plan = planFor(pc);
    expect(plan.nextAction).toBe(PURSUIT_ACTION.FOLLOW_UP);
    expect(plan.current.priorContact.hasConfirmedSend).toBe(true);
    expect(plan.firstTouchReview.required).toBe(false);
  });

  it('proceeds on a follow-up even where manual history came first', () => {
    const { pc, head } = scene();
    manualHistory(head);
    sendUnder(pc, head);

    // Step 2 of this campaign. A person has already seen this conversation by
    // definition — the campaign's own step 1 went out.
    const plan = planFor(pc);
    expect(plan.step).toBe(2);
    expect(plan.firstTouchReview.required).toBe(false);
  });

  it('materialises a follow-up exactly as before', () => {
    const { pc, head } = scene();
    sendUnder(pc, head);
    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(out.created).toBe(true);
    expect(out.attempt.coach_id).toBe(head.id ?? head);
    expect(attempts(pc)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The campaign's own counter is untouched                                     */
/* -------------------------------------------------------------------------- */

describe('the campaign-local sequence is not rewritten', () => {
  it('still calls it step 1, because for this campaign it is', () => {
    const { pc, head } = scene();
    manualHistory(head);

    const plan = planFor(pc);
    /**
     * THE SHAPE THE BRIEF SPELLED OUT. Prior contact does not advance the
     * counter, does not exhaust the coach and does not change the action —
     * the campaign really has written nothing. Only the review is added.
     */
    expect(plan.current.messagesSent).toBe(0);
    expect(plan.step).toBe(1);
    expect(plan.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
    expect(plan.current.exhausted).toBe(false);
    expect(plan.reason).toBe('FIRST_CONTACT');
    expect(plan.firstTouchReview.required).toBe(true);
  });

  it('leaves an old campaign unable to advance the new one', () => {
    const first = makeCampaign();
    const pcOne = makeProgramme(first);
    const head = coach({ email: 'h@duke.edu' });
    sendUnder(pcOne, head);
    sendUnder(pcOne, head, '2026-09-09T11:00:00.000Z');
    // Two messages is this coach's whole allowance, so the old campaign has
    // nobody left to write to and names no current coach at all.
    expect(planFor(pcOne).coaches[0].exhausted).toBe(true);
    expect(planFor(pcOne).current).toBeNull();

    const second = makeCampaign();
    const pcTwo = makeProgramme(second);
    const plan = planFor(pcTwo);

    // Two messages on file, and this campaign has sent none of them.
    expect(plan.current.messagesSent).toBe(0);
    expect(plan.current.exhausted).toBe(false);
    expect(plan.current.priorContact.confirmedSendCount).toBe(2);
    expect(plan.firstTouchReview.required).toBe(true);
  });

  it('writes nothing at all, as planning never does', () => {
    const { pc, head } = scene();
    manualHistory(head);
    const census = () => ['outreach', 'outreach_send', 'programme_contact_attempts',
      'athlete_programmes', 'coaches', 'programme_campaigns']
      .map((t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);
    const before = census();
    planFor(pc);
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(census()).toEqual(before);
  });
});

/* -------------------------------------------------------------------------- */
/* The dry run                                                                 */
/* -------------------------------------------------------------------------- */

describe('the campaign dry run holds it out of the actionable list', () => {
  it('marks the programme for review and refuses to call it executable', () => {
    const { campaign, pc, head } = scene();
    manualHistory(head);

    const entry = campaignExecutionPlan(campaign, { onDate: '2026-09-15' }).programmes[0];
    expect(entry.programmeCampaignId).toBe(pc);
    expect(entry.operatorReviewRequired).toBe(true);
    expect(entry.executableNow).toBe(false);
    expect(entry.blockers).toContainEqual({
      source: BLOCKER_SOURCE.OPERATOR, code: BLOCKER_CODE.PRIOR_CONFIRMED_CONTACT,
    });
  });

  it('keeps it out of priorityActions entirely', () => {
    const { campaign, head } = scene();
    manualHistory(head);

    // Through the filter that already existed. A held programme is not an
    // action waiting to be taken; it is a question waiting to be answered.
    const out = campaignExecutionPlan(campaign, { onDate: '2026-09-15' });
    expect(out.priorityActions).toEqual([]);
    expect(out.summary.operatorReviewRequiredCount).toBe(1);
    expect(out.summary.executableNowCount).toBe(0);
  });

  it('shows the operator what the history actually is', () => {
    const { campaign, head } = scene();
    const o = outreach({ coachId: head, sent: '2026-08-20T11:00:00.000Z' });
    message({ outreachId: o, coachId: head, sentAt: '2026-08-20T11:00:00.000Z', origin: 'manual' });
    message({ outreachId: o, coachId: head, sentAt: '2026-08-22T11:00:00.000Z', origin: null });

    const { currentCoach } = campaignExecutionPlan(campaign, { onDate: '2026-09-15' }).programmes[0];
    expect(currentCoach.priorContact).toMatchObject({
      hasConfirmedSend: true,
      confirmedSendCount: 2,
      firstConfirmedSendAt: '2026-08-20T11:00:00.000Z',
      lastConfirmedSendAt: '2026-08-22T11:00:00.000Z',
      origins: ['manual', null],
    });
  });

  it('claims nothing about what the coach did with any of it', () => {
    const { campaign, head } = scene();
    manualHistory(head);
    const serialised = JSON.stringify(campaignExecutionPlan(campaign, { onDate: '2026-09-15' }));

    // Confirmed sends, and not one word more: this build knows of no delivery,
    // no open, no read and no reply that it did not have a person record.
    for (const claim of [/opened/i, /\bread\b/i, /delivered/i, /replied/i, /bounced/i, /viewed/i]) {
      expect(serialised).not.toMatch(claim);
    }
  });

  it('leaves a campaign with no prior contact exactly as it was', () => {
    const { campaign } = scene();
    const out = campaignExecutionPlan(campaign, { onDate: '2026-09-15' });
    expect(out.programmes[0].operatorReviewRequired).toBe(false);
    expect(out.programmes[0].executableNow).toBe(true);
    expect(out.priorityActions).toHaveLength(1);
    expect(out.programmes[0].firstTouchReview).toEqual({ required: false, reason: null });
  });
});

/* -------------------------------------------------------------------------- */
/* Materialisation                                                             */
/* -------------------------------------------------------------------------- */

describe('the hold reaches the write, not only the screen', () => {
  it('creates no attempt while the review is unresolved', () => {
    const { pc, head } = scene();
    manualHistory(head);

    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(out.created).toBe(false);
    expect(out.attempt).toBeNull();
    expect(attempts(pc)).toEqual([]);
    expect(attemptRows()).toBe(0);
    // Not silent, and not confusable with a prohibition.
    expect(out.review).toEqual({
      required: true, reason: FIRST_TOUCH_REVIEW.PRIOR_CONFIRMED_CONTACT,
    });
    expect(out.prohibition).toBeUndefined();
  });

  it('stays a no-op however many times it is called', () => {
    const { pc, head } = scene();
    manualHistory(head);
    for (let i = 0; i < 3; i += 1) {
      expect(materialiseNextContactAttempt({ programmeCampaignId: pc }).created).toBe(false);
    }
    expect(attemptRows()).toBe(0);
  });

  it('still materialises where there is no prior contact', () => {
    const { pc } = scene();
    expect(materialiseNextContactAttempt({ programmeCampaignId: pc }).created).toBe(true);
    expect(attempts(pc)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The other rules keep their own identities                                   */
/* -------------------------------------------------------------------------- */

describe('a hold is not a prohibition, and does not become one', () => {
  it('reports manual_only as manual_only, not as a review', () => {
    const { pc, head } = scene();
    manualHistory(head);
    relationship({ stance: 'manual_only' });

    // Both are true of this programme. They are answered by different parts of
    // the system and must not be collapsed: one says a person should look, the
    // other says the campaign may not write whatever the person concludes.
    const plan = planFor(pc);
    expect(plan.safety.reason).toBe('RELATIONSHIP_MANUAL_ONLY');
    expect(plan.firstTouchReview.required).toBe(true);
    expect(plan.firstTouchReview.reason).not.toBe('RELATIONSHIP_MANUAL_ONLY');
  });

  it('reports do_not_contact as do_not_contact', () => {
    const { pc, head } = scene();
    manualHistory(head);
    relationship({ stance: 'do_not_contact' });
    expect(planFor(pc).safety.reason).toBe('RELATIONSHIP_DO_NOT_CONTACT');
    expect(materialiseNextContactAttempt({ programmeCampaignId: pc }).created).toBe(false);
    expect(attemptRows()).toBe(0);
  });

  it('leaves stopped, suppressed and revoked meaning what they meant', () => {
    const { campaign, pc, head } = scene();
    db.prepare("UPDATE programme_campaigns SET state = 'stopped', state_reason = 'operator' WHERE id = ?")
      .run(pc);
    expect(planFor(pc).safety.reason).toBe('PROGRAMME_STOPPED');

    const other = makeProgramme(campaign, { college: 'Elon' });
    coach({ school: 'Elon', email: 'opted@elon.edu' });
    suppress({ email: 'opted@elon.edu' });

    /**
     * A SUPPRESSED ADDRESS IS REMOVED EARLIER THAN ANY OF THIS, by the
     * candidate filter, so the programme has nobody to pursue rather than
     * somebody it may not write to. Unchanged by F6d, and asserted here so a
     * later change to the hold cannot quietly reroute it.
     */
    const plan = planFor(other);
    expect(plan.current).toBeNull();
    expect(plan.reason).toBe('NO_ELIGIBLE_COACHES');
    expect(plan.ineligible.map((c) => c.reason)).toEqual(['SUPPRESSED']);
    expect(plan.firstTouchReview.required).toBe(false);
    expect(head).toBeTruthy();
  });

  it('is not caused by a flag or a request on its own', () => {
    const { pc } = scene();
    relationship({ flagged: 1, requestState: 'requested' });
    // Neither is a contact decision, and neither is history.
    expect(review(pc).required).toBe(false);
    expect(materialiseNextContactAttempt({ programmeCampaignId: pc }).created).toBe(true);
  });

  it('changes no relationship row and no history', () => {
    const { pc, head } = scene();
    manualHistory(head);
    relationship({ stance: 'default' });
    const snapshot = () => ({
      relationships: db.prepare('SELECT * FROM athlete_programmes').all(),
      sends: db.prepare('SELECT * FROM outreach_send').all(),
      outreach: db.prepare('SELECT * FROM outreach').all(),
    });
    const before = snapshot();
    planFor(pc);
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(snapshot()).toEqual(before);
  });
});
