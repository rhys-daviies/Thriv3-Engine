import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import {
  priorContactForCoaches, priorContactOf, NO_PRIOR_CONTACT,
  contactIntelligenceForProgramme,
} from './contactIntelligence.js';
import { programmePursuitPlan, PURSUIT_ACTION } from './pursuitPolicy.js';
import { MESSAGE_STATE } from '../../shared/outreachMessageState.js';

/**
 * F6c — HAS THIS ATHLETE EVER REACHED THIS COACH?
 *
 * ONE FACT, AND IT DECIDES NOTHING. No caller is blocked by it, no cadence
 * reads it and no action changes because of it. What a campaign should DO about
 * a coach who has already heard from this athlete is F6d's question, and the
 * tests at the foot of this file exist to prove that decision has not been
 * taken early.
 *
 * ---------------------------------------------------------------------------
 * THE TWO COUNTS ARE NOT THE SAME COUNT, AND BOTH ARE RIGHT.
 *
 *   messagesSent   CAMPAIGN-LOCAL. Where this campaign is up to with this
 *                  person. Drives step, exhaustion and the next action, and is
 *                  scoped to `programme_campaign_id` so a new campaign starts
 *                  at one against a coach an old campaign finished with.
 *
 *   priorContact   LIFETIME. Whether this athlete has ever had a confirmed send
 *                  to this coach, by hand or by campaign, this campaign or a
 *                  previous one.
 *
 * A coach written to by hand last month, on this campaign's first message, has
 * `messagesSent: 0` and `hasConfirmedSend: true`. That is not a contradiction —
 * it is the whole reason the fact was worth adding.
 * ---------------------------------------------------------------------------
 */

const ATHLETE = 'a-prior';
const OTHER_ATHLETE = 'a-prior-other';
let seq = 0;

function insertAthlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer')
  `).run(id, id);
}

function coach({ name = 'A Coach', email, school = 'Duke', sport = 'mens-soccer', title = 'Head Coach' } = {}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, '2026-09-01T00:00:00.000Z', ?, ?, ?, 'NCAA D1', ?, ?)
  `).run(id, name, email ?? `c${++seq}@duke.edu`, school, sport, title);
  return id;
}

/** A relationship. `sent` is the LEGACY first-confirmed-send column. */
function outreach({ athleteId = ATHLETE, coachId, drafted = null, sent = null, revoked = null }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, drafted_at, sent_at, revoked_at)
    VALUES (?, ?, ?, ?, '2026-09-01T00:00:00.000Z', ?, ?, ?)
  `).run(id, athleteId, coachId, randomUUID(), drafted, sent, revoked);
  return id;
}

/** One message row, in whatever state the test needs it. */
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

const factFor = (coachId, athleteId = ATHLETE) =>
  priorContactOf(priorContactForCoaches({ athleteId, coachIds: [coachId] }), coachId);

/* ---- the campaign scaffolding, for the sequencing half ------------------- */

function makeCampaign({ state = 'active', startsOn = '2026-09-01' } = {}) {
  db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = '2026-09-01T00:00:00.000Z',
      close_reason = 'completed' WHERE athlete_id = ? AND state = 'active'`).run(ATHLETE);
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z', 1)
  `).run(id, ATHLETE, state, startsOn);
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

/** An accepted message attributed to one campaign, the way a campaign sends. */
function sendUnder(programmeCampaignId, coachId, at = '2026-09-05T11:00:00.000Z') {
  const existing = db.prepare('SELECT id FROM outreach WHERE athlete_id = ? AND coach_id = ?')
    .get(ATHLETE, coachId);
  const id = existing?.id ?? outreach({ coachId, sent: at });
  message({
    outreachId: id, coachId, sentAt: at, origin: 'campaign', programmeCampaignId,
  });
  return id;
}

const planFor = (pc) => programmePursuitPlan({ programmeCampaignId: pc });

beforeEach(() => {
  seq = 0;
  db.exec(`DELETE FROM programme_contact_attempts; DELETE FROM outreach_evidence;
           DELETE FROM engagement_rollup; DELETE FROM tracking_events;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes; DELETE FROM players; DELETE FROM coaches;`);
  insertAthlete(ATHLETE);
  insertAthlete(OTHER_ATHLETE);
});

/* -------------------------------------------------------------------------- */
/* What counts as a confirmed send                                             */
/* -------------------------------------------------------------------------- */

describe('a confirmed send, and nothing weaker', () => {
  it('reports nothing for a coach nobody has written to', () => {
    const c = coach();
    expect(factFor(c)).toEqual(NO_PRIOR_CONTACT);
    expect(factFor(c).hasConfirmedSend).toBe(false);
    expect(factFor(c).confirmedSendCount).toBe(0);
    expect(factFor(c).firstConfirmedSendAt).toBeNull();
    expect(factFor(c).origins).toEqual([]);
  });

  it('does not count a draft as contact', () => {
    const c = coach();
    const o = outreach({ coachId: c, drafted: '2026-09-02T10:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.DRAFT });

    // A body exists and nobody received it. Counting one would let an unsent
    // draft read as a message the coach has already had.
    expect(factFor(c).hasConfirmedSend).toBe(false);
  });

  it('does not count a failed send', () => {
    const c = coach();
    const o = outreach({ coachId: c, drafted: '2026-09-02T10:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.FAILED });
    expect(factFor(c).hasConfirmedSend).toBe(false);
  });

  it('counts an accepted manual send', () => {
    const c = coach();
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    message({
      outreachId: o, coachId: c, sentAt: '2026-09-02T11:00:00.000Z', origin: 'manual',
    });

    expect(factFor(c)).toMatchObject({
      hasConfirmedSend: true,
      confirmedSendCount: 1,
      firstConfirmedSendAt: '2026-09-02T11:00:00.000Z',
      lastConfirmedSendAt: '2026-09-02T11:00:00.000Z',
      origins: ['manual'],
    });
  });

  it('counts several, with the right ends of the range', () => {
    const c = coach();
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    for (const at of ['2026-09-02T11:00:00.000Z', '2026-09-06T11:00:00.000Z',
      '2026-09-04T11:00:00.000Z']) {
      message({ outreachId: o, coachId: c, sentAt: at, origin: 'manual' });
    }
    expect(factFor(c)).toMatchObject({
      confirmedSendCount: 3,
      firstConfirmedSendAt: '2026-09-02T11:00:00.000Z',
      lastConfirmedSendAt: '2026-09-06T11:00:00.000Z',
    });
  });

  it('is not inflated by a draft written after an accepted send', () => {
    const c = coach();
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, sentAt: '2026-09-02T11:00:00.000Z', origin: 'manual' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.DRAFT });

    expect(factFor(c).confirmedSendCount).toBe(1);
    expect(factFor(c).origins).toEqual(['manual']);
  });
});

/* -------------------------------------------------------------------------- */
/* Origin is reported, never relabelled                                        */
/* -------------------------------------------------------------------------- */

describe('origin is carried through as it is', () => {
  it('keeps a NULL origin as unknown rather than calling it manual', () => {
    const c = coach();
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, sentAt: '2026-09-02T11:00:00.000Z', origin: null });

    // A confirmed send whose origin nobody recorded. Naming it would be the
    // fabrication the column exists to prevent.
    const fact = factFor(c);
    expect(fact.hasConfirmedSend).toBe(true);
    expect(fact.origins).toEqual([null]);
    expect(fact.origins).not.toContain('manual');
  });

  it('reports both kinds when both happened, deterministically', () => {
    const c = coach();
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, sentAt: '2026-09-02T11:00:00.000Z', origin: 'manual' });
    message({ outreachId: o, coachId: c, sentAt: '2026-09-03T11:00:00.000Z', origin: 'campaign' });
    message({ outreachId: o, coachId: c, sentAt: '2026-09-04T11:00:00.000Z', origin: null });

    // Recorded origins in order, then the unrecorded one. The same rows always
    // produce the same array.
    expect(factFor(c).origins).toEqual(['campaign', 'manual', null]);
    expect(factFor(c).confirmedSendCount).toBe(3);
  });

  it('orders origins the same way whatever order the rows went in', () => {
    /**
     * SQLite specifies no order for what `group_concat` concatenates — it is a
     * property of the query plan, not of the data. Two coaches with identical
     * history must still produce identical arrays, so the order is decided
     * after the query rather than taken from it.
     */
    const forwards = coach({ name: 'Forwards', email: 'f@duke.edu' });
    const backwards = coach({ name: 'Backwards', email: 'b@duke.edu' });
    const fo = outreach({ coachId: forwards, sent: '2026-09-02T11:00:00.000Z' });
    const bo = outreach({ coachId: backwards, sent: '2026-09-02T11:00:00.000Z' });

    const origins = ['manual', null, 'campaign'];
    origins.forEach((origin, i) => message({
      outreachId: fo, coachId: forwards, sentAt: `2026-09-0${i + 2}T11:00:00.000Z`, origin,
    }));
    [...origins].reverse().forEach((origin, i) => message({
      outreachId: bo, coachId: backwards, sentAt: `2026-09-0${i + 2}T11:00:00.000Z`, origin,
    }));

    expect(factFor(forwards).origins).toEqual(factFor(backwards).origins);
    // Recorded origins sorted, then the unknown one last and exactly once.
    expect(factFor(forwards).origins).toEqual(['campaign', 'manual', null]);
  });

  it('puts NULL last rather than sorting it among the names', () => {
    const c = coach();
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    // Three unrecorded sends and one named one. NULL is the absence of a value
    // rather than a value, so it has no place among them and appears once.
    for (const at of ['2026-09-02', '2026-09-03', '2026-09-04']) {
      message({ outreachId: o, coachId: c, sentAt: `${at}T11:00:00.000Z`, origin: null });
    }
    message({ outreachId: o, coachId: c, sentAt: '2026-09-05T11:00:00.000Z', origin: 'manual' });

    expect(factFor(c).origins).toEqual(['manual', null]);
    expect(factFor(c).origins.filter((x) => x === null)).toHaveLength(1);
    expect(factFor(c).confirmedSendCount).toBe(4);
  });

  it('sorts the recorded origins without assuming which two exist', () => {
    const c = coach();
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, sentAt: '2026-09-02T11:00:00.000Z', origin: 'manual' });
    message({ outreachId: o, coachId: c, sentAt: '2026-09-03T11:00:00.000Z', origin: 'campaign' });

    // The vocabulary appears nowhere in the query or in the ordering rule — a
    // third origin added later sorts into place without either changing.
    const named = factFor(c).origins.filter((x) => x !== null);
    expect(named).toEqual([...named].sort());
  });

  it('does not repeat an origin that occurs twice', () => {
    const c = coach();
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, sentAt: '2026-09-02T11:00:00.000Z', origin: 'manual' });
    message({ outreachId: o, coachId: c, sentAt: '2026-09-03T11:00:00.000Z', origin: 'manual' });
    expect(factFor(c).origins).toEqual(['manual']);
  });
});

/* -------------------------------------------------------------------------- */
/* Legacy and revoked                                                          */
/* -------------------------------------------------------------------------- */

describe('history older than the record that would describe it', () => {
  it('trusts outreach.sent_at where no message row exists', () => {
    const c = coach();
    outreach({ coachId: c, sent: '2025-04-02T11:00:00.000Z' });

    /**
     * THE LEGACY SHAPE, and the one place `hasConfirmedSend: true` sits beside
     * a count of zero. A message went — `markOutreachSent` wrote the column —
     * and the per-message rows that would say how many did not exist yet.
     * A caller must test `hasConfirmedSend`, never the count.
     */
    const fact = factFor(c);
    expect(fact.hasConfirmedSend).toBe(true);
    expect(fact.confirmedSendCount).toBe(0);
    // THE INVARIANT F6d MUST HONOUR. Counting instead of reading the boolean
    // would treat this coach as one nobody has ever written to.
    expect(fact.confirmedSendCount > 0).toBe(false);
    expect(fact.firstConfirmedSendAt).toBe('2025-04-02T11:00:00.000Z');
    expect(fact.lastConfirmedSendAt).toBe('2025-04-02T11:00:00.000Z');
    expect(fact.origins).toEqual([]);
  });

  it('treats outreach.sent_at as the FIRST send, not the last', () => {
    const c = coach();
    // First-wins by design in markOutreachSent: the column cannot move once set.
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, sentAt: '2026-09-09T11:00:00.000Z', origin: 'campaign' });

    expect(factFor(c).firstConfirmedSendAt).toBe('2026-09-02T11:00:00.000Z');
    expect(factFor(c).lastConfirmedSendAt).toBe('2026-09-09T11:00:00.000Z');
  });

  it('keeps the history of a revoked outreach record', () => {
    const c = coach();
    const o = outreach({
      coachId: c, sent: '2026-09-02T11:00:00.000Z', revoked: '2026-09-08T11:00:00.000Z',
    });
    message({ outreachId: o, coachId: c, sentAt: '2026-09-02T11:00:00.000Z', origin: 'manual' });

    // Revocation withdrew a tracking link. A message that was sent was still
    // sent, and pretending otherwise would let a campaign write a first
    // introduction to somebody who had already had one.
    expect(factFor(c)).toMatchObject({ hasConfirmedSend: true, confirmedSendCount: 1 });
  });

  it('agrees with the F5 read model about the same rows', () => {
    const c = coach({ email: 'agree@duke.edu' });
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, sentAt: '2026-09-02T11:00:00.000Z', origin: 'manual' });

    // One definition of "confirmed", read by three callers. If these ever
    // disagree, a card and a campaign are telling an operator different things
    // about the same coach.
    const programme = contactIntelligenceForProgramme({
      athleteId: ATHLETE, collegeName: 'Duke', sport: 'mens-soccer',
    });
    expect(programme.coaches[0].has_confirmed_send).toBe(factFor(c).hasConfirmedSend);
    expect(programme.coaches[0].confirmed_send_count).toBe(factFor(c).confirmedSendCount);
  });
});

/* -------------------------------------------------------------------------- */
/* Whose history it is                                                         */
/* -------------------------------------------------------------------------- */

describe('the fact belongs to one athlete and one coach row', () => {
  it('does not count another athlete writing to the same coach', () => {
    const c = coach();
    const o = outreach({ athleteId: OTHER_ATHLETE, coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    message({
      outreachId: o, coachId: c, athleteId: OTHER_ATHLETE,
      sentAt: '2026-09-02T11:00:00.000Z', origin: 'manual',
    });

    expect(factFor(c).hasConfirmedSend).toBe(false);
    expect(factFor(c, OTHER_ATHLETE).hasConfirmedSend).toBe(true);
  });

  it('does not count another coach at the same programme', () => {
    const head = coach({ name: 'Head', email: 'h@duke.edu' });
    const assistant = coach({ name: 'Assistant', email: 'a@duke.edu', title: 'Assistant Coach' });
    const o = outreach({ coachId: head, sent: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: head, sentAt: '2026-09-02T11:00:00.000Z', origin: 'manual' });

    expect(factFor(head).hasConfirmedSend).toBe(true);
    expect(factFor(assistant).hasConfirmedSend).toBe(false);
  });

  it('keeps two coach rows sharing an address apart', () => {
    /**
     * `coaches` is unique on (email, school, sport), so a generic inbox is
     * legitimately several rows. Counting by ADDRESS would report a message to
     * one of them as a message to all of them; the key is the canonical row.
     * The cost runs the other way — duplicate rows for one human read as
     * separate people — which F4 documented and which collapsing safely needs a
     * coach identity model this build does not have.
     */
    const mens = coach({ email: 'soccer@shared.edu', school: 'Duke', sport: 'mens-soccer' });
    const womens = coach({ email: 'soccer@shared.edu', school: 'Duke', sport: 'womens-soccer' });
    const o = outreach({ coachId: mens, sent: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: mens, sentAt: '2026-09-02T11:00:00.000Z', origin: 'manual' });

    expect(factFor(mens).hasConfirmedSend).toBe(true);
    expect(factFor(womens).hasConfirmedSend).toBe(false);
  });

  it('answers for several coaches at once, and omits the ones with nothing', () => {
    const written = coach({ email: 'w@duke.edu' });
    const untouched = coach({ email: 'u@duke.edu' });
    const o = outreach({ coachId: written, sent: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: written, sentAt: '2026-09-02T11:00:00.000Z', origin: 'manual' });

    const facts = priorContactForCoaches({ athleteId: ATHLETE, coachIds: [written, untouched] });
    expect(facts.has(written)).toBe(true);
    // A miss is the answer, and `priorContactOf` is what turns it into one.
    expect(facts.has(untouched)).toBe(false);
    expect(priorContactOf(facts, untouched)).toEqual(NO_PRIOR_CONTACT);
  });

  it('is empty rather than throwing when asked about nobody', () => {
    expect(priorContactForCoaches({ athleteId: ATHLETE, coachIds: [] }).size).toBe(0);
    expect(priorContactForCoaches({ athleteId: null, coachIds: ['x'] }).size).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* On the plan, beside a sequence it does not touch                            */
/* -------------------------------------------------------------------------- */

describe('the plan reports the fact without acting on it', () => {
  it('is false for a coach this athlete has never written to', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    coach({ email: 'h@duke.edu' });

    const plan = planFor(pc);
    expect(plan.current.priorContact).toEqual(NO_PRIOR_CONTACT);
    expect(plan.current.messagesSent).toBe(0);
    expect(plan.step).toBe(1);
    expect(plan.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
  });

  it('is TRUE for a manual send, while the campaign still calls it step 1', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const head = coach({ email: 'h@duke.edu' });
    const o = outreach({ coachId: head, sent: '2026-08-20T11:00:00.000Z' });
    message({ outreachId: o, coachId: head, sentAt: '2026-08-20T11:00:00.000Z', origin: 'manual' });

    /**
     * THE CASE F6c EXISTS FOR. The campaign has written to nobody, so its
     * sequence is untouched and its next action is an initial approach — and
     * the fact says this person has already heard from the athlete. F6d
     * decides what to do about that; F6c only stops it being invisible.
     */
    const plan = planFor(pc);
    expect(plan.current.priorContact.hasConfirmedSend).toBe(true);
    expect(plan.current.priorContact.origins).toEqual(['manual']);
    expect(plan.current.messagesSent).toBe(0);
    expect(plan.step).toBe(1);
    expect(plan.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
    expect(plan.current.exhausted).toBe(false);
  });

  it('is TRUE inside this campaign, where the counter also moved', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const head = coach({ email: 'h@duke.edu' });
    sendUnder(pc, head);

    // Both true, meaning different things: one says the campaign is on its
    // second message, the other says the athlete has reached this person.
    const plan = planFor(pc);
    expect(plan.current.messagesSent).toBe(1);
    expect(plan.step).toBe(2);
    expect(plan.nextAction).toBe(PURSUIT_ACTION.FOLLOW_UP);
    expect(plan.current.priorContact.hasConfirmedSend).toBe(true);
    expect(plan.current.priorContact.confirmedSendCount).toBe(1);
  });

  it('is TRUE from an old campaign, and the new one still starts at step 1', () => {
    const first = makeCampaign();
    const pcOne = makeProgramme(first);
    const head = coach({ email: 'h@duke.edu' });
    sendUnder(pcOne, head);

    const second = makeCampaign();
    const pcTwo = makeProgramme(second);
    const plan = planFor(pcTwo);

    /**
     * THE DISTINCTION THE SHIPPED TESTS PROTECT, restated here because F6c is
     * where it could most easily be lost. The campaign-local counter is scoped
     * to `programme_campaign_id`, so last season's campaign advances nothing —
     * and the lifetime fact still says this coach has heard from the athlete.
     */
    expect(plan.current.messagesSent).toBe(0);
    expect(plan.step).toBe(1);
    expect(plan.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
    expect(plan.current.priorContact.hasConfirmedSend).toBe(true);
    expect(plan.current.priorContact.origins).toEqual(['campaign']);
  });

  it('reports the fact for every coach in the plan, not only the current one', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { tier: 'A' });
    const head = coach({ name: 'Aa Head', email: 'h@duke.edu' });
    const assistant = coach({ name: 'Bb Assistant', email: 'a@duke.edu', title: 'Assistant Coach' });
    const o = outreach({ coachId: assistant, sent: '2026-08-20T11:00:00.000Z' });
    message({
      outreachId: o, coachId: assistant, sentAt: '2026-08-20T11:00:00.000Z', origin: 'manual',
    });

    const plan = planFor(pc);
    const byId = new Map(plan.coaches.map((c) => [c.coachId, c]));
    expect(byId.get(head).priorContact.hasConfirmedSend).toBe(false);
    expect(byId.get(assistant).priorContact.hasConfirmedSend).toBe(true);
  });

  it('is unaffected by a relationship row, or by the absence of one', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const head = coach({ email: 'h@duke.edu' });
    const o = outreach({ coachId: head, sent: '2026-08-20T11:00:00.000Z' });
    message({ outreachId: o, coachId: head, sentAt: '2026-08-20T11:00:00.000Z', origin: 'manual' });
    expect(db.prepare('SELECT COUNT(*) n FROM athlete_programmes').get().n).toBe(0);
    const withoutRow = planFor(pc).current.priorContact;

    // History is outreach-based. A stance is a decision about the future and
    // changes nothing about what was sent.
    db.prepare(`
      INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state,
        flagged, visibility, contact_stance, created_at, updated_at)
      VALUES (?, ?, 'Duke', 'mens-soccer', 'none', 0, 'default', 'manual_only',
        '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
    `).run(randomUUID(), ATHLETE);
    expect(planFor(pc).current.priorContact).toEqual(withoutRow);
  });

  it('is JSON-safe and deterministic', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const head = coach({ email: 'h@duke.edu' });
    const o = outreach({ coachId: head, sent: '2026-08-20T11:00:00.000Z' });
    message({ outreachId: o, coachId: head, sentAt: '2026-08-20T11:00:00.000Z', origin: null });

    const once = JSON.parse(JSON.stringify(planFor(pc).current.priorContact));
    expect(once).toEqual(JSON.parse(JSON.stringify(planFor(pc).current.priorContact)));
    // NULL survives the round trip, because a JSON null is still not "manual".
    expect(once.origins).toEqual([null]);
  });
});

/* -------------------------------------------------------------------------- */
/* F6d has not happened yet                                                    */
/* -------------------------------------------------------------------------- */

describe('the fact changes no behaviour', () => {
  it('does not make a prior-contact coach need operator review', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const head = coach({ email: 'h@duke.edu' });
    const o = outreach({ coachId: head, sent: '2026-08-20T11:00:00.000Z' });
    message({ outreachId: o, coachId: head, sentAt: '2026-08-20T11:00:00.000Z', origin: 'manual' });

    // F6d's question. Until it is answered, a coach with prior contact is
    // planned exactly like one without.
    const plan = planFor(pc);
    expect(plan.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
    expect(plan.reason).toBe('FIRST_CONTACT');
    expect(plan.exhausted).toBe(false);
  });

  it('plans identically with and without the history behind it', () => {
    const withoutHistory = (() => {
      const campaign = makeCampaign();
      const pc = makeProgramme(campaign);
      coach({ email: 'h1@duke.edu' });
      return planFor(pc);
    })();

    db.exec('DELETE FROM outreach_send; DELETE FROM outreach; DELETE FROM coaches;');
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const head = coach({ email: 'h1@duke.edu' });
    const o = outreach({ coachId: head, sent: '2026-08-20T11:00:00.000Z' });
    message({ outreachId: o, coachId: head, sentAt: '2026-08-20T11:00:00.000Z', origin: 'manual' });
    const withHistory = planFor(pc);

    // Every field that drives what happens next is identical. Only the fact
    // differs, which is the whole of F6c.
    for (const field of ['nextAction', 'reason', 'step', 'exhausted', 'coachDepth']) {
      expect(withHistory[field], field).toEqual(withoutHistory[field]);
    }
    expect(withHistory.current.messagesSent).toBe(withoutHistory.current.messagesSent);
    expect(withHistory.current.priorContact.hasConfirmedSend).toBe(true);
    expect(withoutHistory.current.priorContact.hasConfirmedSend).toBe(false);
  });

  it('writes nothing, as planning never does', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const head = coach({ email: 'h@duke.edu' });
    const o = outreach({ coachId: head, sent: '2026-08-20T11:00:00.000Z' });
    message({ outreachId: o, coachId: head, sentAt: '2026-08-20T11:00:00.000Z', origin: 'manual' });

    const census = () => ['outreach', 'outreach_send', 'programme_contact_attempts',
      'athlete_programmes', 'coaches'].map((t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);
    const before = census();
    planFor(pc);
    planFor(pc);
    expect(census()).toEqual(before);
  });
});

/* -------------------------------------------------------------------------- */
/* One statement per plan, whatever the depth                                  */
/* -------------------------------------------------------------------------- */

describe('the fact is bounded', () => {
  /**
   * ASKED ONCE FOR THE WHOLE PLAN. The obvious implementation asks per coach,
   * which is three statements at Tier A and three hundred across a campaign
   * dry run — and invisible from anywhere except a profiler. This counts
   * executions of the prior-contact query itself, so a future per-coach call
   * fails here rather than in production.
   *
   * The db client is swapped for a counting proxy over THE SAME connection: a
   * re-imported client would be a different in-memory database, and the count
   * would be taken against no data at all.
   */
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
    return import('./pursuitPolicy.js');
  }

  /** Executions of the prior-contact query, identified by a column only it selects. */
  const priorContactQueries = () => [...executions.entries()]
    .filter(([sql]) => sql.includes('legacy_first_send_at'))
    .reduce((n, [, count]) => n + count, 0);

  afterEach(() => {
    vi.doUnmock('../db/client.js');
    vi.resetModules();
  });

  it('runs one prior-contact query for a plan, at any coach depth', async () => {
    const { programmePursuitPlan: plan } = await instrumented();
    const campaign = makeCampaign();
    const one = makeProgramme(campaign, { college: 'One' });
    const three = makeProgramme(campaign, { college: 'Three' });
    coach({ school: 'One', email: 'a@one.edu' });
    coach({ school: 'Three', name: 'Aa', email: 'a@three.edu' });
    coach({ school: 'Three', name: 'Bb', email: 'b@three.edu', title: 'Associate Head Coach' });
    coach({ school: 'Three', name: 'Cc', email: 'c@three.edu', title: 'Assistant Coach' });

    executions.clear();
    expect(plan({ programmeCampaignId: one }).coaches).toHaveLength(1);
    expect(priorContactQueries()).toBe(1);

    executions.clear();
    expect(plan({ programmeCampaignId: three }).coaches).toHaveLength(3);
    // Three coaches, still one question. Not one per coach.
    expect(priorContactQueries()).toBe(1);
  });

  it('asks nothing at all where the plan has nobody to pursue', async () => {
    const { programmePursuitPlan: plan } = await instrumented();
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { college: 'Empty' });
    coach({ school: 'Empty', email: 'v@empty.edu', title: 'Volunteer Assistant Coach' });

    executions.clear();
    expect(plan({ programmeCampaignId: pc }).coaches).toHaveLength(0);
    expect(priorContactQueries()).toBe(0);
  });
});
