import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import db from '../db/client.js';
import {
  PURSUIT_POLICY_VERSION, TIER_COACH_DEPTH, MESSAGES_PER_COACH, FOLLOW_UP_DELAY_DAYS,
  PURSUIT_ACTION, PURSUIT_REASON, INELIGIBLE_REASON,
  programmePursuitPlan, materialiseNextContactAttempt,
} from './pursuitPolicy.js';
import { createOutreach, resolveToken } from './outreach.js';
import { recordDraft, confirmSend, sendsForOutreach } from './outreachSend.js';
import { findOrCreateCoach } from './coaches.js';
import { suppress, isSuppressed } from './suppressions.js';
import { attemptsForProgrammeCampaign, contactAttempt, transitionContactAttempt } from './contactAttempts.js';
import { markResponded } from './engagementRollup.js';
import { recentSendCount } from './sendCap.js';
import { athleteUsage, mailboxUsage, recordOutboundAttempt } from './outboundBudget.js';
import { setProgrammeTier, stopProgrammeCampaign } from './campaigns.js';
import { MESSAGE_STATE, ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';

/**
 * B6 — what a campaign INTENDS to do at a programme.
 *
 * The three properties the whole slice rests on:
 *
 *   1. ASKING CHANGES NOTHING. B7 runs this across a Top 100; a planner that
 *      wrote as it looked would create three hundred attempts and three
 *      hundred permanent tokens for a campaign nobody approved.
 *   2. ONE COACH AT A TIME. The shape makes simultaneous staff blasting
 *      unrepresentable rather than merely discouraged.
 *   3. POLICY IS NOT PERMISSION. A draft campaign has a plan and cannot
 *      execute it, and the two facts arrive separately.
 */

const ATHLETE = 'a-pursuit';
const OTHER_ATHLETE = 'a-pursuit-other';
const COLLEGE = 'Duke';
const SPORT = 'mens-soccer';
const MAILBOX = 'sender@striv3.com';
let seq = 0;

function insertAthlete(id, name, position = 'MIDFIELD') {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, ?, 'mens-soccer', ?)
  `).run(id, name, position, randomUUID().slice(0, 10));
}

function makeCampaign({ athleteId = ATHLETE, state = 'active', startsOn = '2020-01-01' } = {}) {
  db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = '2026-09-01T00:00:00.000Z',
      close_reason = 'completed' WHERE athlete_id = ? AND state = 'active'`).run(athleteId);
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, ?, '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 1)
  `).run(id, athleteId, state, startsOn);
  return id;
}

function makeProgramme(campaignId, { tier = 'A', rank = null, state = 'queued', college = COLLEGE } = {}) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 82, ?, 'AUTO', ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
  `).run(id, campaignId, college, SPORT, rank ?? ++seq, tier, state);
  return id;
}

/**
 * A coach row exactly as stored, bypassing findOrCreateCoach.
 *
 * Needed for the two shapes it legitimately refuses to create — an 'N/A'
 * address, and two spellings of one address — both of which exist in imported
 * data and both of which the planner has to handle.
 */
function rawCoach(title, { email, name, school = COLLEGE, status = 'verified' } = {}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport,
      position_title, email_status)
    VALUES (?, '2026-09-01T00:00:00.000Z', ?, ?, ?, 'NCAA D1', ?, ?, ?)
  `).run(id, name ?? `Coach ${++seq}`, email, school, SPORT, title, status);
  return { id, email, full_name: name };
}

const coach = (title, { email, name, school = COLLEGE, status = 'verified' } = {}) => {
  const row = findOrCreateCoach({
    full_name: name ?? `Coach ${title} ${++seq}`,
    email: email ?? `c${++seq}@duke.edu`,
    school, sport: SPORT, division: 'NCAA D1', position_title: title,
  });
  db.prepare('UPDATE coaches SET email_status = ? WHERE id = ?').run(status, row.id);
  return { ...row, email_status: status };
};

/**
 * A real accepted message, through the real write path.
 *
 * Not a hand-written row: the planner reads accepted messages, so the fixture
 * has to produce one the way the product does — createOutreach, recordDraft,
 * confirmSend — or the test would be proving the planner agrees with a fiction.
 */
function sendUnder(pcId, athleteId, coachRow) {
  const o = createOutreach({ athleteId, coachId: coachRow.id, programmeCampaignId: pcId });
  recordDraft({
    outreachId: o.id, athleteId, coachId: coachRow.id, collegeName: COLLEGE, sport: SPORT,
    programmeCampaignId: pcId, evidence: null, body: `body ${++seq}`, subject: 's',
  });
  confirmSend(o.id, undefined, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
  return o;
}

/** A Tier A programme with a head coach and two assistants. */
function scene({ tier = 'A', campaignState = 'active', programmeState = 'queued' } = {}) {
  const campaign = makeCampaign({ state: campaignState });
  const pc = makeProgramme(campaign, { tier, state: programmeState });
  const head = coach('Head Coach', { email: 'head@duke.edu', name: 'Aa Head' });
  const assoc = coach('Associate Head Coach', { email: 'assoc@duke.edu', name: 'Bb Assoc' });
  const asst = coach('Assistant Coach', { email: 'asst@duke.edu', name: 'Cc Asst' });
  return { campaign, pc, head, assoc, asst };
}

beforeEach(() => {
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM engagement_rollup; DELETE FROM tracking_events;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM coaches; DELETE FROM players; DELETE FROM suppressions;`);
  insertAthlete(ATHLETE, 'Pursuit Athlete');
  insertAthlete(OTHER_ATHLETE, 'Other Athlete');
});

// ---------------------------------------------------------------------------

describe('tier decides pursuit depth', () => {
  it.each([['A', 3], ['B', 2], ['C', 1]])('tier %s pursues up to %i coaches', (tier, depth) => {
    const { pc } = scene({ tier });
    const plan = programmePursuitPlan({ programmeCampaignId: pc });

    expect(TIER_COACH_DEPTH[tier]).toBe(depth);
    expect(plan.coachDepth).toBe(depth);
    expect(plan.coaches).toHaveLength(depth);
    // Everyone past the depth is named, with the reason, rather than vanishing.
    expect(plan.beyondDepth).toHaveLength(3 - depth);
    for (const c of plan.beyondDepth) expect(c.reason).toBe(PURSUIT_REASON.TIER_DEPTH_REACHED);
  });

  it('follows the operator\'s tier, not the rank the model gave', () => {
    // Rank 45 is a Tier B band. An operator promoted it to A, and that
    // decision is the whole reason the column is mutable.
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { tier: 'B', rank: 45 });
    coach('Head Coach', { email: 'h@duke.edu', name: 'Aa' });
    coach('Assistant Coach', { email: 'a1@duke.edu', name: 'Bb' });
    coach('Assistant Coach', { email: 'a2@duke.edu', name: 'Cc' });

    expect(programmePursuitPlan({ programmeCampaignId: pc }).coachDepth).toBe(2);

    setProgrammeTier(pc, 'A');
    const promoted = programmePursuitPlan({ programmeCampaignId: pc });
    expect(promoted.programmeCampaign.rank).toBe(45);      // rank is immutable
    expect(promoted.programmeCampaign.tier).toBe('A');
    expect(promoted.coachDepth).toBe(3);
  });

  it('never recomputes the tier from the rank', () => {
    const src = fs.readFileSync(new URL('./pursuitPolicy.js', import.meta.url), 'utf8');
    // tierForRank would silently discard an operator's promotion.
    expect(src).not.toMatch(/tierForRank|TIER_BANDS/);
  });
});

// ---------------------------------------------------------------------------

describe('who may be pursued', () => {
  it('omits roles a cold campaign does not approach', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { tier: 'A' });
    coach('Head Coach', { email: 'h@duke.edu', name: 'Aa' });
    const vol = coach('Volunteer Assistant Coach', { email: 'v@duke.edu', name: 'Vv' });
    const ga = coach('Graduate Assistant Coach', { email: 'g@duke.edu', name: 'Gg' });
    const ops = coach('Director of Soccer Operations', { email: 'o@duke.edu', name: 'Oo' });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.coaches.map((c) => c.email)).toEqual(['h@duke.edu']);
    const refused = new Map(plan.ineligible.map((c) => [c.coachId, c.reason]));
    for (const c of [vol, ga, ops]) {
      expect(refused.get(c.id)).toBe(INELIGIBLE_REASON.ROLE_NOT_PURSUED);
    }
  });

  it('omits a coach with no usable address', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { tier: 'A' });
    coach('Head Coach', { email: 'h@duke.edu', name: 'Aa' });
    const na = rawCoach('Assistant Coach', { email: 'N/A', name: 'Nn' });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.coaches.map((c) => c.email)).toEqual(['h@duke.edu']);
    expect(plan.ineligible.find((c) => c.coachId === na.id).reason)
      .toBe(INELIGIBLE_REASON.NO_USABLE_EMAIL);
  });

  it('keeps the highest-priority row when several point at one address', () => {
    // soccer@duke.edu as a team inbox AND beside a named coach is ONE
    // recipient. Two approaches would send one programme the campaign twice,
    // from one athlete, which no cap keyed on distinct athletes would notice.
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { tier: 'A' });
    // Deliberately inserted so the LOWER-priority row could win on row order,
    // which is exactly the bug: deduplicating before sorting kept whichever
    // the query returned first and could discard the head coach in favour of
    // the anonymous inbox that shares their address.
    const team = rawCoach('Team Email', { email: 'soccer@duke.edu', name: 'Aa Inbox' });
    const head = rawCoach('Head Coach', { email: 'SOCCER@Duke.edu ', name: 'Zz Head' });

    for (let i = 0; i < 5; i += 1) {
      const plan = programmePursuitPlan({ programmeCampaignId: pc });
      expect(plan.coaches).toHaveLength(1);
      expect(plan.coaches[0].coachId).toBe(head.id);
      expect(plan.ineligible.find((c) => c.coachId === team.id).reason)
        .toBe(INELIGIBLE_REASON.DUPLICATE_ADDRESS);
    }
  });

  it('omits a suppressed address and says so', () => {
    const { pc, head } = scene();
    suppress({ email: head.email, reason: 'unsubscribed' });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.coaches.map((c) => c.email)).toEqual(['assoc@duke.edu', 'asst@duke.edu']);
    expect(plan.ineligible.find((c) => c.coachId === head.id).reason)
      .toBe(INELIGIBLE_REASON.SUPPRESSED);
    // The plan moves on rather than stalling on somebody who can never be
    // written to — and the campaign gate still says the same thing separately.
    expect(plan.current.email).toBe('assoc@duke.edu');
    expect(isSuppressed(head.email)).toBe(true);
  });

  it('uses a shared inbox only when there is nobody else', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { tier: 'A' });
    const team = coach('Team Email', { email: 'soccer@duke.edu', name: 'Team' });

    const alone = programmePursuitPlan({ programmeCampaignId: pc });
    expect(alone.coaches.map((c) => c.coachId)).toEqual([team.id]);
    expect(alone.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);

    // The moment a person is on file, the inbox drops out — it is not a
    // person, and must never be one of several approaches to one programme.
    coach('Head Coach', { email: 'h@duke.edu', name: 'Aa' });
    const withHead = programmePursuitPlan({ programmeCampaignId: pc });
    expect(withHead.coaches.map((c) => c.email)).toEqual(['h@duke.edu']);
    expect(withHead.ineligible.find((c) => c.coachId === team.id).reason)
      .toBe(INELIGIBLE_REASON.TEAM_INBOX_NOT_NEEDED);
  });

  it('is deterministic where a programme has no head coach', () => {
    // 94 programmes on file have no head coach among their eligible staff.
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { tier: 'A' });
    coach('Assistant Coach', { email: 'a2@duke.edu', name: 'Zz Later' });
    coach('Associate Head Coach', { email: 'ah@duke.edu', name: 'Yy Assoc' });
    coach('Assistant Coach', { email: 'a1@duke.edu', name: 'Xx Earlier' });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.coaches.map((c) => c.email)).toEqual(['ah@duke.edu', 'a1@duke.edu', 'a2@duke.edu']);
    expect(plan.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
  });

  it('carries the address provenance without treating inferred as confirmed', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { tier: 'A' });
    coach('Head Coach', { email: 'h@duke.edu', name: 'Aa', status: 'inferred' });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    // Pursued — the drafting CLI has always included inferred addresses and
    // --skip-inferred is opt-in — but the plan says which is which.
    expect(plan.coaches[0]).toMatchObject({ emailStatus: 'inferred' });
    const src = fs.readFileSync(new URL('./pursuitPolicy.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/emailStatus\s*===\s*'verified'|identity[_ ]confirmed/i);
  });
});

// ---------------------------------------------------------------------------

describe('the order staff are approached in', () => {
  it('walks the contact ladder', () => {
    const { pc } = scene();
    expect(programmePursuitPlan({ programmeCampaignId: pc }).coaches.map((c) => c.role))
      .toEqual(['head', 'associate-head', 'assistant']);
  });

  it('puts a recruiting coordinator first among assistants, not above the head', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { tier: 'A' });
    coach('Head Coach', { email: 'h@duke.edu', name: 'Zz Head' });
    coach('Assistant Coach', { email: 'a@duke.edu', name: 'Aa Plain' });
    coach('Assistant Coach/Recruiting Coordinator', { email: 'r@duke.edu', name: 'Mm Recruiter' });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    // Head first despite sorting last by name; the coordinator leads the
    // assistants despite sorting after "Aa Plain".
    expect(plan.coaches.map((c) => c.email)).toEqual(['h@duke.edu', 'r@duke.edu', 'a@duke.edu']);
  });

  it('breaks ties totally, so two head coaches always order the same way', () => {
    // 91 programmes list more than one head coach and 847 more than one
    // assistant, so the tie-break is load-bearing rather than decorative.
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { tier: 'A' });
    coach('Head Coach', { email: 'h2@duke.edu', name: 'Bravo' });
    coach('Head Coach', { email: 'h1@duke.edu', name: 'Alpha' });

    const once = programmePursuitPlan({ programmeCampaignId: pc }).coaches.map((c) => c.email);
    expect(once).toEqual(['h1@duke.edu', 'h2@duke.edu']);
    for (let i = 0; i < 5; i += 1) {
      expect(programmePursuitPlan({ programmeCampaignId: pc }).coaches.map((c) => c.email))
        .toEqual(once);
    }
  });

  it('gives the same answer every time for the same inputs', () => {
    const { pc } = scene();
    const first = programmePursuitPlan({ programmeCampaignId: pc });
    for (let i = 0; i < 3; i += 1) {
      expect(programmePursuitPlan({ programmeCampaignId: pc })).toEqual(first);
    }
  });
});

// ---------------------------------------------------------------------------

describe('pursuit is sequential', () => {
  it('names exactly one current coach and one next action', () => {
    const { pc } = scene();
    const plan = programmePursuitPlan({ programmeCampaignId: pc });

    expect(plan.coaches).toHaveLength(3);
    expect(plan.current.email).toBe('head@duke.edu');
    expect(plan.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
    expect(plan.reason).toBe(PURSUIT_REASON.FIRST_CONTACT);
    // The shape cannot express two actionable coaches: there is one `current`
    // and one `nextAction`, not a list of things to do.
    expect(Array.isArray(plan.current)).toBe(false);
    expect(plan.step).toBe(1);
  });

  it('keeps the second coach unreachable until the first is exhausted', () => {
    const { pc, head, assoc } = scene();

    sendUnder(pc, ATHLETE, head);
    const afterOne = programmePursuitPlan({ programmeCampaignId: pc });
    expect(afterOne.current.coachId).toBe(head.id);       // still the head
    expect(afterOne.nextAction).toBe(PURSUIT_ACTION.FOLLOW_UP);
    expect(afterOne.reason).toBe(PURSUIT_REASON.NO_RESPONSE_TO_INITIAL);
    expect(afterOne.step).toBe(2);

    sendUnder(pc, ATHLETE, head);
    const afterTwo = programmePursuitPlan({ programmeCampaignId: pc });
    expect(afterTwo.current.coachId).toBe(assoc.id);      // only now
    expect(afterTwo.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
    expect(afterTwo.reason).toBe(PURSUIT_REASON.PREVIOUS_COACH_EXHAUSTED);
    expect(afterTwo.step).toBe(1);
    expect(afterTwo.coaches.find((c) => c.coachId === head.id).exhausted).toBe(true);
  });

  it('stops at the tier depth, not at the end of the staff list', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { tier: 'C' });   // depth 1
    const head = coach('Head Coach', { email: 'h@duke.edu', name: 'Aa' });
    coach('Assistant Coach', { email: 'a@duke.edu', name: 'Bb' });

    sendUnder(pc, ATHLETE, head);
    sendUnder(pc, ATHLETE, head);

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.nextAction).toBe(PURSUIT_ACTION.NO_FURTHER_COLD_OUTREACH);
    expect(plan.reason).toBe(PURSUIT_REASON.ALL_COACHES_EXHAUSTED);
    expect(plan.exhausted).toBe(true);
    expect(plan.current).toBeNull();
    expect(plan.beyondDepth.map((c) => c.email)).toEqual(['a@duke.edu']);
  });

  it('runs out of cold outreach when every coach in depth is spent', () => {
    const { pc, head, assoc, asst } = scene({ tier: 'A' });
    for (const c of [head, assoc, asst]) { sendUnder(pc, ATHLETE, c); sendUnder(pc, ATHLETE, c); }

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.nextAction).toBe(PURSUIT_ACTION.NO_FURTHER_COLD_OUTREACH);
    expect(plan.reason).toBe(PURSUIT_REASON.ALL_COACHES_EXHAUSTED);
    expect(plan.coaches.every((c) => c.exhausted)).toBe(true);
  });

  it('has no cold action at all when nobody is eligible', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { tier: 'A' });
    coach('Volunteer Assistant Coach', { email: 'v@duke.edu', name: 'Vv' });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.nextAction).toBe(PURSUIT_ACTION.NO_FURTHER_COLD_OUTREACH);
    expect(plan.reason).toBe(PURSUIT_REASON.NO_ELIGIBLE_COACHES);
    expect(plan.coaches).toEqual([]);
  });

  it('skips a coach whose attempt an operator stopped', () => {
    const { pc, head, assoc } = scene();
    const { attempt } = materialiseNextContactAttempt({ programmeCampaignId: pc });
    transitionContactAttempt(attempt.id, 'stopped', { reason: 'wrong person' });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.current.coachId).toBe(assoc.id);
    expect(plan.coaches.find((c) => c.coachId === head.id))
      .toMatchObject({ stopped: true, attemptState: 'stopped' });
  });
});

// ---------------------------------------------------------------------------

describe('campaign-local step versus lifetime sequence', () => {
  it('starts a new campaign at step 1 against a coach an old campaign exhausted', () => {
    const first = makeCampaign();
    const pcOne = makeProgramme(first, { tier: 'A' });
    const head = coach('Head Coach', { email: 'h@duke.edu', name: 'Aa' });
    sendUnder(pcOne, ATHLETE, head);
    sendUnder(pcOne, ATHLETE, head);
    expect(programmePursuitPlan({ programmeCampaignId: pcOne }).coaches[0].exhausted).toBe(true);

    // A season later. Same athlete, same coach, same relationship, new campaign.
    const second = makeCampaign();
    const pcTwo = makeProgramme(second, { tier: 'A' });

    const plan = programmePursuitPlan({ programmeCampaignId: pcTwo });
    expect(plan.current.coachId).toBe(head.id);
    expect(plan.step).toBe(1);
    expect(plan.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
    expect(plan.coaches[0].messagesSent).toBe(0);

    // The lifetime record still says two messages ever, and disagrees on
    // purpose: sequence is lifetime, step is campaign-local.
    const outreach = db.prepare('SELECT id FROM outreach WHERE athlete_id = ? AND coach_id = ?')
      .get(ATHLETE, head.id);
    expect(sendsForOutreach(outreach.id).map((s) => s.sequence)).toEqual([1, 2]);
  });

  it('does not skip a coach merely because an older campaign wrote to them', () => {
    const first = makeCampaign();
    const pcOne = makeProgramme(first, { tier: 'A' });
    const head = coach('Head Coach', { email: 'h@duke.edu', name: 'Aa' });
    sendUnder(pcOne, ATHLETE, head);

    const second = makeCampaign();
    const pcTwo = makeProgramme(second, { tier: 'A' });
    expect(programmePursuitPlan({ programmeCampaignId: pcTwo }).current.coachId).toBe(head.id);
  });
});

// ---------------------------------------------------------------------------

describe('a recorded response', () => {
  it('hands the programme to an operator rather than writing to anyone else', () => {
    const { pc, head } = scene();
    const outreach = sendUnder(pc, ATHLETE, head);
    markResponded(outreach.id);

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.nextAction).toBe(PURSUIT_ACTION.AWAITING_OPERATOR);
    expect(plan.reason).toBe(PURSUIT_REASON.RESPONSE_OBSERVED);
    // The programme is the decision unit: a reply from one coach stops cold
    // outreach to the whole staff, not just to them.
    expect(plan.current.coachId).toBe(head.id);
    expect(plan.exhausted).toBe(false);
    // And nothing anywhere claims to know what the reply said.
    // Nothing here reads intent out of a reply. Asserted on the vocabulary a
    // classifier would need, not on the word "classify" — this module imports
    // classifyRole, which is about job titles.
    const src = fs.readFileSync(new URL('./pursuitPolicy.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/INTERESTED|NOT_INTERESTED|POSITIVE_REPLY|SENTIMENT|classifyReply/i);
  });

  it('ignores a response that belongs to an earlier campaign', () => {
    const first = makeCampaign({ startsOn: '2020-01-01' });
    const pcOne = makeProgramme(first, { tier: 'A' });
    const head = coach('Head Coach', { email: 'h@duke.edu', name: 'Aa' });
    const outreach = sendUnder(pcOne, ATHLETE, head);
    markResponded(outreach.id, '2021-05-05T00:00:00.000Z');

    // A campaign that starts after that reply may legitimately re-engage.
    const second = makeCampaign({ startsOn: '2026-01-01' });
    const pcTwo = makeProgramme(second, { tier: 'A' });

    const plan = programmePursuitPlan({ programmeCampaignId: pcTwo });
    expect(plan.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
    expect(plan.current.respondedAt).toBeNull();
    expect(plan.current.priorCampaignResponseAt).toBe('2021-05-05T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------

describe('planning writes nothing', () => {
  it('performs no write of any kind', () => {
    const { pc } = scene();
    const tables = ['outreach', 'outreach_send', 'programme_contact_attempts',
      'outbound_send_attempt', 'programme_campaigns', 'campaigns', 'coaches', 'engagement_rollup'];
    const before = Object.fromEntries(tables.map((t) => [t,
      db.prepare(`SELECT * FROM ${t}`).all()]));

    for (let i = 0; i < 3; i += 1) {
      programmePursuitPlan({ programmeCampaignId: pc, sendingIdentity: MAILBOX });
    }

    for (const t of tables) expect(db.prepare(`SELECT * FROM ${t}`).all()).toEqual(before[t]);
  });

  it('mints no tracking token and creates no relationship', () => {
    const { pc } = scene();
    programmePursuitPlan({ programmeCampaignId: pc });
    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(0);

    const src = fs.readFileSync(new URL('./pursuitPolicy.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/createOutreach|generateToken/);
  });

  it('creates no contact attempts, however many times it is asked', () => {
    const { pc } = scene();
    for (let i = 0; i < 10; i += 1) programmePursuitPlan({ programmeCampaignId: pc });
    expect(attemptsForProgrammeCampaign(pc)).toEqual([]);
  });

  it('consumes no budget', () => {
    const { pc } = scene();
    programmePursuitPlan({ programmeCampaignId: pc, sendingIdentity: MAILBOX });
    expect(athleteUsage(ATHLETE)).toBe(0);
    expect(mailboxUsage(MAILBOX)).toBe(0);
    // Read off the IMPORTS: the header says at length that it never consumes,
    // and a guard that trips on its own explanation is not a guard.
    const src = fs.readFileSync(new URL('./pursuitPolicy.js', import.meta.url), 'utf8');
    const imports = src.split('\n').filter((l) => /^\s*(import\b|\s{2}record)/.test(l)).join('\n');
    expect(imports).not.toMatch(/recordOutboundAttempt|recordManualOutboundAttempt/);
  });

  it('plans a draft campaign, which is the point of a draft', () => {
    const { pc } = scene({ campaignState: 'draft' });
    const plan = programmePursuitPlan({ programmeCampaignId: pc });

    expect(plan.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
    expect(plan.current.email).toBe('head@duke.edu');
    expect(plan.safety).toMatchObject({ allowed: false, reason: 'CAMPAIGN_NOT_ACTIVE' });
    expect(plan.executableNow).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('policy and permission arrive separately', () => {
  it('still has a plan for a stopped programme, and cannot execute it', () => {
    const { pc } = scene();
    stopProgrammeCampaign(pc, { reason: 'not_recruiting' });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
    expect(plan.safety).toMatchObject({ allowed: false, reason: 'PROGRAMME_STOPPED' });
    expect(plan.executableNow).toBe(false);
  });

  it('reports a closed outreach window as a safety reason, not a policy one', () => {
    const campaign = makeCampaign();
    db.prepare("UPDATE campaigns SET outreach_ends_on = '2020-06-01' WHERE id = ?").run(campaign);
    const pc = makeProgramme(campaign, { tier: 'A' });
    coach('Head Coach', { email: 'h@duke.edu', name: 'Aa' });

    const plan = programmePursuitPlan({ programmeCampaignId: pc, onDate: '2026-09-07' });
    expect(plan.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
    expect(plan.safety.reason).toBe('CAMPAIGN_OUTREACH_WINDOW_CLOSED');
    expect(plan.executableNow).toBe(false);
  });

  it('says yes when everything agrees', () => {
    const { pc } = scene();
    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.safety).toMatchObject({ evaluated: true, allowed: true, reason: null });
  });

  it('duplicates none of B3', () => {
    const src = fs.readFileSync(new URL('./pursuitPolicy.js', import.meta.url), 'utf8');
    // It asks B3 and reports the answer. It does not re-derive one.
    expect(src).toMatch(/campaignContactDecision/);
    expect(src).not.toMatch(/CONTACT_REFUSAL\.|outreach_ends_on|revoked_at|'stopped'\s*\)\s*return/);
  });
});

// ---------------------------------------------------------------------------

describe('budget is composed, never consumed', () => {
  it('reports B5\'s refusal while the policy recommendation stands', () => {
    const { pc, head } = scene();
    // A relationship exists, so B5 can be asked properly. Spend the day.
    const outreach = sendUnder(pc, ATHLETE, head);
    for (let i = 0; i < 10; i += 1) {
      recordOutboundAttempt({
        outreachId: outreach.id, sendingIdentity: MAILBOX, athleteLimit: 10, mailboxLimit: 100,
      });
    }

    const plan = programmePursuitPlan({ programmeCampaignId: pc, sendingIdentity: MAILBOX });
    expect(plan.nextAction).toBe(PURSUIT_ACTION.FOLLOW_UP);       // policy is unchanged
    expect(plan.budget).toMatchObject({
      evaluated: true, allowed: false, reason: 'ATHLETE_DAILY_BUDGET_EXHAUSTED',
    });
    expect(plan.executableNow).toBe(false);
    expect(athleteUsage(ATHLETE)).toBe(10);                        // and nothing more
  });

  it('says plainly when it could not ask, rather than guessing', () => {
    // A first approach has no relationship, and B5 derives the athlete from
    // one. Reported as undecided rather than re-deriving B5's rule here.
    const { pc } = scene();
    const plan = programmePursuitPlan({ programmeCampaignId: pc, sendingIdentity: MAILBOX });
    expect(plan.budget).toMatchObject({ evaluated: false, reason: 'NO_RELATIONSHIP_YET' });
    expect(plan.budget.athleteUsed).toBe(0);
    expect(plan.budget.athleteLimit).toBe(10);
  });

  it('leaves budget unevaluated when no mailbox was named', () => {
    const { pc } = scene();
    expect(programmePursuitPlan({ programmeCampaignId: pc }).budget)
      .toEqual({ evaluated: false, reason: 'NO_SENDING_IDENTITY_SUPPLIED' });
  });
});

// ---------------------------------------------------------------------------

describe('materialising a plan', () => {
  it('creates exactly one planned attempt, for the coach the plan named', () => {
    const { pc, head } = scene();
    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });

    expect(out.created).toBe(true);
    expect(out.attempt.coach_id).toBe(head.id);
    expect(out.attempt.state).toBe('planned');
    expect(out.attempt.step).toBe(1);
    expect(attemptsForProgrammeCampaign(pc)).toHaveLength(1);
  });

  it('is idempotent and creates no second attempt for the programme', () => {
    const { pc } = scene();
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const again = materialiseNextContactAttempt({ programmeCampaignId: pc });

    expect(again.created).toBe(false);
    expect(attemptsForProgrammeCampaign(pc)).toHaveLength(1);
  });

  it('creates no relationship, no token, no message and no budget spend', () => {
    const { pc } = scene();
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM outbound_send_attempt').get().n).toBe(0);
  });

  it('materialises for a draft campaign, which B4 allows and B3 still gates', () => {
    const { pc } = scene({ campaignState: 'draft' });
    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(out.created).toBe(true);
    expect(out.plan.executableNow).toBe(false);
  });

  it('materialises nothing when the programme has no cold action left', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { tier: 'A' });
    coach('Volunteer Assistant Coach', { email: 'v@duke.edu', name: 'Vv' });

    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(out.created).toBe(false);
    expect(out.attempt).toBeNull();
    expect(attemptsForProgrammeCampaign(pc)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('the policy version', () => {
  it('is reported on every plan', () => {
    const { pc } = scene();
    expect(programmePursuitPlan({ programmeCampaignId: pc }).policyVersion)
      .toBe(PURSUIT_POLICY_VERSION);
    expect(PURSUIT_POLICY_VERSION).toBe('PP1');
  });

  it('states the numbers it is a version OF', () => {
    expect(TIER_COACH_DEPTH).toEqual({ A: 3, B: 2, C: 1 });
    expect(MESSAGES_PER_COACH).toBe(2);
    expect(FOLLOW_UP_DELAY_DAYS).toBe(4);
  });

  it('reports the follow-up delay as policy days, never as a resolved instant', () => {
    const { pc } = scene();
    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.followUpDelayDays).toBe(4);
    expect(plan).not.toHaveProperty('nextActionAt');
    // No clock arithmetic and no timezone anywhere: resolving a policy day
    // into an instant is Phase E's, with a timezone nothing here has.
    const src = fs.readFileSync(new URL('./pursuitPolicy.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/86_?400_?000|setDate\(|timeZone|next_action_at\s*=/);
  });
});

// ---------------------------------------------------------------------------

describe('what B6 leaves exactly as it found it', () => {
  it('moves no programme or campaign state', () => {
    const { pc, campaign } = scene();
    const pcBefore = db.prepare('SELECT * FROM programme_campaigns WHERE id = ?').get(pc);
    const cBefore = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign);

    programmePursuitPlan({ programmeCampaignId: pc });
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    // A planned attempt is not outreach, so `queued` does not become `active`.
    expect(db.prepare('SELECT * FROM programme_campaigns WHERE id = ?').get(pc)).toEqual(pcBefore);
    expect(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign)).toEqual(cBefore);
    expect(pcBefore.state).toBe('queued');
  });

  it('leaves the two unreachable attempt states unreachable', () => {
    const { pc } = scene();
    const { attempt } = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(contactAttempt(attempt.id).state).toBe('planned');

    for (const state of ['waiting', 'completed']) {
      expect(() => transitionContactAttempt(attempt.id, state))
        .toThrow(/needs a scheduler and reply ingestion|needs a sequence policy/);
    }
    const src = fs.readFileSync(new URL('./pursuitPolicy.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/'waiting'|'completed'/);
  });

  it('advances no step and stops no attempt', () => {
    const { pc, head } = scene();
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    const before = attemptsForProgrammeCampaign(pc);

    sendUnder(pc, ATHLETE, head);
    programmePursuitPlan({ programmeCampaignId: pc });

    // The plan's step moved to 2 from the message history; B4's stored counter
    // did not, because advancing it is an execution act and B6 executes nothing.
    expect(programmePursuitPlan({ programmeCampaignId: pc }).step).toBe(2);
    expect(attemptsForProgrammeCampaign(pc)).toEqual(before);
    expect(before[0].step).toBe(1);
  });

  it('leaves message state, attribution, the cap and the token alone', () => {
    const { pc, head } = scene();
    const outreach = sendUnder(pc, ATHLETE, head);
    const sendsBefore = sendsForOutreach(outreach.id);
    const capBefore = recentSendCount(head.email);

    programmePursuitPlan({ programmeCampaignId: pc, sendingIdentity: MAILBOX });
    materialiseNextContactAttempt({ programmeCampaignId: pc });

    expect(sendsForOutreach(outreach.id)).toEqual(sendsBefore);
    expect(sendsBefore[0].state).toBe(MESSAGE_STATE.ACCEPTED);
    expect(sendsBefore[0].programme_campaign_id).toBe(pc);
    expect(recentSendCount(head.email)).toBe(capBefore);
    expect(resolveToken(outreach.token)?.id).toBe(outreach.id);
  });

  it('generates no email copy and touches no evidence', () => {
    const src = fs.readFileSync(new URL('./pursuitPolicy.js', import.meta.url), 'utf8');
    const imports = src.split('\n').filter((l) => /^import\b/.test(l)).join('\n');
    expect(imports).not.toMatch(/evidence|emailTemplate|outreachCopy|sendSnapshot/i);
    /**
     * No message text is assembled here — asserted against the CODE with the
     * comments stripped out.
     *
     * Matching the raw file was wrong three different ways in one session:
     * "nobody" contains "body", "classifyRole" contains "classif", and this
     * module's own explanation of why it writes no greeting contains the word
     * greeting. A guard that trips on the prose describing it is not a guard,
     * it is a second thing to maintain.
     */
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bsubject\b|\bbody\b|greeting|personalise/i);
  });
});
