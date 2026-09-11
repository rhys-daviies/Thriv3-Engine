import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { createOutreach } from './outreach.js';
import { recordDraft } from './outreachSend.js';
import { approveFirstTouch } from './firstTouchApprovals.js';
import { priorContactForCoaches, priorContactOf } from './contactIntelligence.js';
import { programmePursuitPlan, PURSUIT_ACTION } from './pursuitPolicy.js';
import { FIRST_TOUCH_REVIEW_REQUIRED } from './campaignFirstTouchGate.js';
import { suppress } from './suppressions.js';
import { MESSAGE_STATE } from '../../shared/outreachMessageState.js';

/**
 * F7 — THE SEND ROUTE OBEYS THE REVIEW TOO.
 *
 * F6d held the automated path: the plan withholds a campaign's first approach
 * to somebody already written to, and the materialiser refuses to record the
 * intent. The other way a campaign-attributed row gets written was not held —
 * an operator posting to the send route with a programme campaign id reaches
 * `createOutreach` and `recordDraft` directly, and those checked stance,
 * suppression, revocation and the campaign lifecycle but not the review.
 *
 * ---------------------------------------------------------------------------
 * A PERSON PRESSING SEND IS NOT THE APPROVAL.
 *
 * Treating the click as the review would make the approval table decorative:
 * the hold would be clearable by doing the exact thing it exists to prevent,
 * and nothing afterwards could tell whether anybody had looked. So operator
 * presence proves nothing, the composer having shown the history proves
 * nothing, and `origin: 'manual'` proves nothing — origin is provenance, and
 * VERIFIED CAMPAIGN ATTRIBUTION is what brings a send under campaign policy.
 *
 * And the rule stops exactly there. A send with no campaign is the manual
 * workflow this product is for, and writing by hand to somebody you have
 * written to before is the normal case rather than a thing to stop.
 * ---------------------------------------------------------------------------
 */

const ATHLETE = 'a-gate';
const OTHER_ATHLETE = 'a-gate-other';
const OPERATOR = 'op-gate';
let seq = 0;

function insertAthlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer')
  `).run(id, id);
}

function insertOperator(id) {
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

function outreach({ coachId, athleteId = ATHLETE, sent = null, drafted = null }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, drafted_at, sent_at)
    VALUES (?, ?, ?, ?, '2026-09-01T00:00:00.000Z', ?, ?)
  `).run(id, athleteId, coachId, randomUUID(), drafted, sent);
  return id;
}

function message({
  outreachId, coachId, state = MESSAGE_STATE.ACCEPTED, sentAt = null, origin = 'manual',
  programmeCampaignId = null, athleteId = ATHLETE,
}) {
  db.prepare(`
    INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, sent_at, athlete_id, coach_id,
      college_name, sport, programme_campaign_id, origin, policy_version, state, created_at)
    VALUES (?, ?, ?, '2026-09-01T10:00:00.000Z', ?, ?, ?, 'Duke', 'mens-soccer', ?, ?,
      'LEGACY_UNKNOWN', ?, '2026-09-01T00:00:00.000Z')
  `).run(randomUUID(), outreachId, ++seq, sentAt, athleteId, coachId, programmeCampaignId,
    origin, state);
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

function makeProgramme(campaignId, { college = 'Duke' } = {}) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, state, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', ?, 82, 'A', 'queued', '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z')
  `).run(id, campaignId, college, ++seq);
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

/** One accepted manual send to this coach, before the campaign existed. */
function manualHistory(coachId, at = '2026-08-20T11:00:00.000Z') {
  const o = outreach({ coachId, sent: at });
  message({ outreachId: o, coachId, sentAt: at });
  return o;
}

/** Approve through the domain layer, over the history actually on file. */
function approve(pc, coachId) {
  const facts = priorContactForCoaches({ athleteId: ATHLETE, coachIds: [coachId] });
  return approveFirstTouch({
    programmeCampaignId: pc,
    coachId,
    operatorId: OPERATOR,
    priorContact: priorContactOf(facts, coachId),
  });
}

const rows = (table) => db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;

const draftThrough = (pc, coachId, outreachId) => recordDraft({
  outreachId, athleteId: ATHLETE, coachId, collegeName: 'Duke', sport: 'mens-soccer',
  programmeCampaignId: pc, evidence: null, body: 'b', subject: 's',
});

/** A campaign, a Duke and a head coach with one prior manual send. */
function held() {
  const campaign = makeCampaign();
  const pc = makeProgramme(campaign);
  const head = coach({ email: 'h@duke.edu' });
  manualHistory(head);
  return { campaign, pc, head };
}

const caught = (fn) => {
  try { fn(); return null; } catch (err) { return err; }
};

beforeEach(() => {
  seq = 0;
  db.exec(`DELETE FROM campaign_first_touch_approvals; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach_evidence; DELETE FROM engagement_rollup;
           DELETE FROM tracking_events; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes; DELETE FROM players; DELETE FROM coaches;
           DELETE FROM operator_users; DELETE FROM suppressions;`);
  insertAthlete(ATHLETE);
  insertAthlete(OTHER_ATHLETE);
  insertOperator(OPERATOR);
});

/* -------------------------------------------------------------------------- */
/* The hold now reaches the send path                                           */
/* -------------------------------------------------------------------------- */

describe('a campaign-attributed write obeys the review', () => {
  it('allows a first touch to somebody nobody has written to', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const head = coach({ email: 'h@duke.edu' });

    const o = createOutreach({ athleteId: ATHLETE, coachId: head, programmeCampaignId: pc });
    expect(o.id).toBeTruthy();
    expect(() => draftThrough(pc, head, o.id)).not.toThrow();
    expect(rows('outreach_send')).toBe(1);
  });

  it('refuses a campaign first touch after a manual send', () => {
    const { pc, head } = held();
    const err = caught(() => createOutreach({
      athleteId: ATHLETE, coachId: head, programmeCampaignId: pc,
    }));

    expect(err.code).toBe(FIRST_TOUCH_REVIEW_REQUIRED);
    expect(err.message).toMatch(/already had confirmed outreach/i);
    // Nothing written, and nothing handed to a transport: the refusal happens
    // before the relationship row, so there is no draft to send later either.
    expect(rows('outreach')).toBe(1);   // the historical one only
    expect(rows('outreach_send')).toBe(1);
  });

  it('refuses after a previous campaign’s send', () => {
    const first = makeCampaign();
    const pcOne = makeProgramme(first);
    const head = coach({ email: 'h@duke.edu' });
    const o = outreach({ coachId: head, sent: '2026-08-20T11:00:00.000Z' });
    message({
      outreachId: o, coachId: head, sentAt: '2026-08-20T11:00:00.000Z',
      origin: 'campaign', programmeCampaignId: pcOne,
    });

    const second = makeCampaign();
    const pcTwo = makeProgramme(second);
    expect(caught(() => draftThrough(pcTwo, head, o)).code).toBe(FIRST_TOUCH_REVIEW_REQUIRED);
  });

  it('refuses on a legacy relationship whose count is zero', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const head = coach({ email: 'h@duke.edu' });
    const o = outreach({ coachId: head, sent: '2025-04-02T11:00:00.000Z' });

    // The case a `count > 0` rule would wave through.
    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.current.priorContact.confirmedSendCount).toBe(0);
    expect(caught(() => draftThrough(pc, head, o)).code).toBe(FIRST_TOUCH_REVIEW_REQUIRED);
    expect(rows('outreach_send')).toBe(0);
  });

  it('refuses while an earlier approval has gone stale', () => {
    const { pc, head } = held();
    approve(pc, head);
    const o = db.prepare('SELECT id FROM outreach WHERE coach_id = ?').get(head);
    message({ outreachId: o.id, coachId: head, sentAt: '2026-09-10T11:00:00.000Z' });

    const err = caught(() => draftThrough(pc, head, o.id));
    expect(err.code).toBe(FIRST_TOUCH_REVIEW_REQUIRED);
    expect(err.approvalStatus).toBe('stale');
    // And says which of the two it is, because the operator's next action
    // differs: review again, rather than review for the first time.
    expect(err.message).toMatch(/no longer matches what is on file/i);
  });

  it('proceeds once a current approval is on record', () => {
    const { pc, head } = held();
    approve(pc, head);

    const o = createOutreach({ athleteId: ATHLETE, coachId: head, programmeCampaignId: pc });
    expect(() => draftThrough(pc, head, o.id)).not.toThrow();
    const row = db.prepare("SELECT origin, programme_campaign_id FROM outreach_send WHERE state = 'DRAFT'").get();
    expect(row).toMatchObject({ origin: 'campaign', programme_campaign_id: pc });
  });

  it('does not hold a genuine follow-up', () => {
    const { pc, head } = held();
    const o = db.prepare('SELECT id FROM outreach WHERE coach_id = ?').get(head);
    message({
      outreachId: o.id, coachId: head, sentAt: '2026-09-05T11:00:00.000Z',
      origin: 'campaign', programmeCampaignId: pc,
    });
    expect(programmePursuitPlan({ programmeCampaignId: pc }).nextAction)
      .toBe(PURSUIT_ACTION.FOLLOW_UP);

    // Prior contact is true and always will be from here. Holding a follow-up
    // would stop every second message on evidence of its own first.
    expect(() => draftThrough(pc, head, o.id)).not.toThrow();
  });

  it('does not hold a coach the campaign is not currently approaching', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const head = coach({ name: 'Aa Head', email: 'h@duke.edu' });
    const assistant = coach({ name: 'Bb Assistant', email: 'a@duke.edu', title: 'Assistant Coach' });
    manualHistory(assistant);

    // The plan is approaching the head coach, who has heard nothing. The
    // assistant's history is not this first touch.
    expect(programmePursuitPlan({ programmeCampaignId: pc }).current.coachId).toBe(head);
    expect(() => createOutreach({
      athleteId: ATHLETE, coachId: head, programmeCampaignId: pc,
    })).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* The manual paths are untouched                                               */
/* -------------------------------------------------------------------------- */

describe('a send with no campaign is not campaign work', () => {
  it('writes to a coach with prior contact exactly as before', () => {
    const head = coach({ email: 'h@duke.edu' });
    manualHistory(head);

    // Relationship Outreach, Email Coaches and the drafting CLI all pass null.
    // Writing by hand to somebody you have written to before is the workflow
    // the product is for.
    const o = createOutreach({ athleteId: ATHLETE, coachId: head });
    expect(() => recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: head, collegeName: 'Duke',
      sport: 'mens-soccer', programmeCampaignId: null, origin: 'manual',
      evidence: null, body: 'b', subject: 's',
    })).not.toThrow();
    expect(rows('outreach_send')).toBe(2);
  });

  it('is unaffected even where a campaign is holding the same coach', () => {
    const { pc, head } = held();
    const o = db.prepare('SELECT id FROM outreach WHERE coach_id = ?').get(head);

    // The campaign path is held for this exact coach...
    expect(caught(() => draftThrough(pc, head, o.id)).code).toBe(FIRST_TOUCH_REVIEW_REQUIRED);

    // ...and the manual path to the same coach is not. One hold, about one
    // kind of work, and a person may still write to them by hand.
    expect(() => recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: head, collegeName: 'Duke',
      sport: 'mens-soccer', programmeCampaignId: null, origin: 'manual',
      evidence: null, body: 'b', subject: 's',
    })).not.toThrow();
    expect(rows('outreach_send')).toBe(2);
  });

  it('cannot be brought under the rule by an origin string', () => {
    const head = coach({ email: 'h@duke.edu' });
    manualHistory(head);
    const o = createOutreach({ athleteId: ATHLETE, coachId: head });

    /**
     * ORIGIN IS PROVENANCE. `campaign` on a send with no verified attribution
     * records nothing about policy — and is overwritten anyway, because
     * `recordDraft` derives origin from the attribution it verified.
     */
    expect(() => recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: head, collegeName: 'Duke',
      sport: 'mens-soccer', programmeCampaignId: null, origin: 'campaign',
      evidence: null, body: 'b', subject: 's',
    })).not.toThrow();
    expect(db.prepare("SELECT origin FROM outreach_send WHERE state = 'DRAFT'").get().origin)
      .toBe('campaign');
  });
});

/* -------------------------------------------------------------------------- */
/* Only a verified campaign invokes the rule, and only an approval clears it    */
/* -------------------------------------------------------------------------- */

describe('the rule answers to verified attribution and to nothing else', () => {
  it('refuses an invented campaign id before the review is ever consulted', () => {
    const head = coach({ email: 'h@duke.edu' });
    manualHistory(head);

    // Refused by A6's identity rule, not by this one — a caller must not be
    // able to invoke campaign policy by naming a campaign that does not exist.
    const err = caught(() => createOutreach({
      athleteId: ATHLETE, coachId: head, programmeCampaignId: 'pc-invented',
    }));
    expect(err.code).toBe('PROGRAMME_CAMPAIGN_NOT_FOUND');
    expect(err.code).not.toBe(FIRST_TOUCH_REVIEW_REQUIRED);
  });

  it('refuses another athlete’s campaign id', () => {
    const other = makeCampaign({ athleteId: OTHER_ATHLETE });
    const pc = makeProgramme(other);
    const head = coach({ email: 'h@duke.edu' });
    manualHistory(head);

    expect(caught(() => createOutreach({
      athleteId: ATHLETE, coachId: head, programmeCampaignId: pc,
    })).code).toBe('CAMPAIGN_ATHLETE_MISMATCH');
  });

  it('refuses a campaign for a different programme than the coach’s', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { college: 'Elon' });
    const head = coach({ school: 'Duke', email: 'h@duke.edu' });
    manualHistory(head);

    expect(caught(() => createOutreach({
      athleteId: ATHLETE, coachId: head, programmeCampaignId: pc,
    })).code).toBe('CAMPAIGN_PROGRAMME_MISMATCH');
  });

  it('is cleared by the approval row and by nothing a caller can say', () => {
    const { pc, head } = held();
    const o = db.prepare('SELECT id FROM outreach WHERE coach_id = ?').get(head);

    // No approval: refused however the call is dressed up. Origin is the only
    // thing a caller could vary here, and it decides nothing.
    for (const origin of ['manual', 'campaign', null]) {
      const err = caught(() => recordDraft({
        outreachId: o.id, athleteId: ATHLETE, coachId: head, collegeName: 'Duke',
        sport: 'mens-soccer', programmeCampaignId: pc, origin,
        evidence: null, body: 'b', subject: 's',
      }));
      expect(err?.code, String(origin)).toBe(FIRST_TOUCH_REVIEW_REQUIRED);
    }
    expect(rows('campaign_first_touch_approvals')).toBe(0);
    expect(rows('outreach_send')).toBe(1);   // the historical send, and nothing new

    // The row is the only thing that clears it.
    approve(pc, head);
    expect(() => draftThrough(pc, head, o.id)).not.toThrow();
  });

  it('leaves approvals, history and relationships untouched when it refuses', () => {
    const { pc, head } = held();
    relationship({ stance: 'default' });
    const snapshot = () => ({
      approvals: db.prepare('SELECT * FROM campaign_first_touch_approvals').all(),
      outreach: db.prepare('SELECT * FROM outreach').all(),
      sends: db.prepare('SELECT * FROM outreach_send').all(),
      relationships: db.prepare('SELECT * FROM athlete_programmes').all(),
    });
    const before = snapshot();
    caught(() => createOutreach({ athleteId: ATHLETE, coachId: head, programmeCampaignId: pc }));
    expect(snapshot()).toEqual(before);
  });
});

/* -------------------------------------------------------------------------- */
/* Approval clears one hold, and no other                                       */
/* -------------------------------------------------------------------------- */

describe('an approved first touch still passes every other gate', () => {
  it('is still refused by manual_only', () => {
    const { pc, head } = held();
    approve(pc, head);
    relationship({ stance: 'manual_only' });

    expect(caught(() => createOutreach({
      athleteId: ATHLETE, coachId: head, programmeCampaignId: pc,
    })).code).toBe('RELATIONSHIP_MANUAL_ONLY');
  });

  it('is still refused by do_not_contact', () => {
    const { pc, head } = held();
    approve(pc, head);
    relationship({ stance: 'do_not_contact' });

    expect(caught(() => createOutreach({
      athleteId: ATHLETE, coachId: head, programmeCampaignId: pc,
    })).code).toBe('RELATIONSHIP_DO_NOT_CONTACT');
  });

  it('is still refused by global suppression', () => {
    const { pc, head } = held();
    approve(pc, head);
    suppress({ email: 'h@duke.edu' });

    expect(caught(() => createOutreach({
      athleteId: ATHLETE, coachId: head, programmeCampaignId: pc,
    })).code).toBe('SUPPRESSED');
  });

  it('is still refused by a stopped programme', () => {
    const { pc, head } = held();
    approve(pc, head);
    db.prepare("UPDATE programme_campaigns SET state = 'stopped', state_reason = 'operator' WHERE id = ?")
      .run(pc);

    expect(caught(() => createOutreach({
      athleteId: ATHLETE, coachId: head, programmeCampaignId: pc,
    })).code).toBe('PROGRAMME_STOPPED');
  });

  it('is still refused by a revoked outreach record', () => {
    const { pc, head } = held();
    approve(pc, head);
    db.prepare("UPDATE outreach SET revoked_at = '2026-09-12T00:00:00.000Z' WHERE coach_id = ?")
      .run(head);
    const o = db.prepare('SELECT id FROM outreach WHERE coach_id = ?').get(head);

    expect(caught(() => draftThrough(pc, head, o.id)).code).toBe('OUTREACH_REVOKED');
  });

  it('is still refused by a closed campaign', () => {
    const { campaign, pc, head } = held();
    approve(pc, head);
    db.prepare("UPDATE campaigns SET state = 'closed', closed_at = '2026-09-20T00:00:00.000Z', close_reason = 'completed' WHERE id = ?")
      .run(campaign);

    expect(caught(() => createOutreach({
      athleteId: ATHLETE, coachId: head, programmeCampaignId: pc,
    })).code).toBe('CAMPAIGN_NOT_ACTIVE');
  });
});
