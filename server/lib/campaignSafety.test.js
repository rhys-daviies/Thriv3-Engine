import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import db from '../db/client.js';
import {
  CONTACT_REFUSAL, campaignContactDecision, assertCampaignContactAllowed,
  authorisedProgrammeCampaignId, REFUSAL_KIND, refusalKindOf,
} from './campaignAttribution.js';
import { createOutreach, revokeOutreach, markOutreachSent } from './outreach.js';
import { recordDraft, sendsForOutreach } from './outreachSend.js';
import { findOrCreateCoach } from './coaches.js';
import { suppress } from './suppressions.js';
import { recentSendCount, isSendCapped } from './sendCap.js';
import { utcToday } from './time.js';

/**
 * B3 — may this campaign contact this coach right now?
 *
 * It decides nothing about WHO or WHEN. Something else chose the programme and
 * the coach; this answers whether state we already know permits it, and says
 * which state refused when it does not.
 *
 * THE GATE IS AT THE WRITE, NOT AT A LIST BUILDER. `createOutreach` and
 * `recordDraft` are the only two functions that write a campaign-attributed
 * row, so a future execution engine cannot produce campaign outreach without
 * passing through it. The tests below drive those two directly for exactly
 * that reason.
 */

const ATHLETE = 'a-safety';
const OTHER_ATHLETE = 'a-safety-other';
const TODAY = '2026-09-15';
let seq = 0;

function insertAthlete(id, name) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer', ?)
  `).run(id, name, randomUUID().slice(0, 10));
}

function makeCampaign({
  athleteId = ATHLETE, state = 'active', startsOn = '2026-09-01',
  outreachEndsOn = null, endsOn = null,
} = {}) {
  // One active campaign per athlete — A1's partial unique index. A new one
  // closes the one before it, which is how campaigns actually succeed one
  // another.
  db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = '2026-09-01T00:00:00.000Z',
      close_reason = 'completed' WHERE athlete_id = ? AND state = 'active'`).run(athleteId);
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, outreach_ends_on, ends_on,
      created_at, updated_at, snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, ?, ?, ?, '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 1)
  `).run(id, athleteId, state, startsOn, outreachEndsOn, endsOn);
  return id;
}

function makeProgramme(campaignId, {
  college = 'Duke', sport = 'mens-soccer', state = 'queued', stateReason = null,
} = {}) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, state, state_reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 82, 'A', ?, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
  `).run(id, campaignId, college, sport, ++seq, state, stateReason);
  return id;
}

const makeCoach = ({ school = 'Duke', sport = 'mens-soccer', email } = {}) => findOrCreateCoach({
  full_name: 'A Coach', email: email ?? `c${++seq}@duke.edu`, school, sport, division: 'NCAA D1',
});

/** The whole world for one decision: an active campaign, a queued Duke, a coach. */
function scene(overrides = {}) {
  const campaign = makeCampaign(overrides.campaign);
  const pc = makeProgramme(campaign, overrides.programme);
  const coach = makeCoach(overrides.coach);
  return { campaign, pc, coach };
}

const decide = ({ pc, coach, outreachId = null, onDate = TODAY }) =>
  campaignContactDecision({
    programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id, outreachId, onDate,
  });

beforeEach(() => {
  db.exec(`DELETE FROM outreach_send_event; DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns; DELETE FROM coaches;
           DELETE FROM players; DELETE FROM suppressions;`);
  insertAthlete(ATHLETE, 'Safety Athlete');
  insertAthlete(OTHER_ATHLETE, 'Other Athlete');
});

// ---------------------------------------------------------------------------

describe('campaign state', () => {
  it('allows an active campaign', () => {
    const { pc, coach } = scene();
    expect(decide({ pc, coach })).toMatchObject({ allowed: true, reason: null });
  });

  it('refuses a draft campaign — review comes before sending', () => {
    const { pc, coach } = scene({ campaign: { state: 'draft' } });
    expect(decide({ pc, coach }).reason).toBe(CONTACT_REFUSAL.CAMPAIGN_NOT_ACTIVE);
  });

  it('refuses a closed campaign', () => {
    const { pc, coach } = scene({ campaign: { state: 'closed' } });
    expect(decide({ pc, coach }).reason).toBe(CONTACT_REFUSAL.CAMPAIGN_NOT_ACTIVE);
  });
});

describe('dates', () => {
  const on = (date, opts) => decide({ ...scene(opts), onDate: date });

  it('refuses before the campaign starts', () => {
    expect(on('2026-08-31').reason).toBe(CONTACT_REFUSAL.CAMPAIGN_NOT_STARTED);
  });

  it('allows exactly on the start date, and after it', () => {
    expect(on('2026-09-01').allowed).toBe(true);
    expect(on('2026-09-15').allowed).toBe(true);
  });

  it('allows exactly on the last outreach day, and refuses the day after', () => {
    const opts = { campaign: { outreachEndsOn: '2026-09-30' } };
    expect(on('2026-09-30', opts).allowed).toBe(true);
    expect(on('2026-10-01', opts).reason).toBe(CONTACT_REFUSAL.CAMPAIGN_OUTREACH_WINDOW_CLOSED);
  });

  it('treats a null outreach end as open-ended', () => {
    expect(on('2030-01-01', { campaign: { outreachEndsOn: null } }).allowed).toBe(true);
  });

  /**
   * `ends_on` is the wider window in which a REPLY may still arrive; outreach
   * stops earlier. Reading `ends_on` here would keep sending into the window
   * the service reserves for answers.
   */
  it('does not let ends_on block outreach that outreach_ends_on permits', () => {
    const opts = { campaign: { outreachEndsOn: '2026-09-30', endsOn: '2026-10-14' } };
    expect(on('2026-09-20', opts).allowed).toBe(true);
    // And an ends_on already in the past does not stop outreach on its own.
    expect(on('2026-09-20', { campaign: { endsOn: '2026-09-05' } }).allowed).toBe(true);
  });

  it('falls back to a UTC date only when none is given, and says so in one place', () => {
    const { pc, coach } = scene({ campaign: { startsOn: '2020-01-01' } });
    // No onDate: the documented fallback, which today permits this campaign.
    expect(campaignContactDecision({
      programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id,
    }).allowed).toBe(true);
    expect(utcToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(utcToday(Date.UTC(2026, 8, 15))).toBe('2026-09-15');
  });
});

describe('programme state', () => {
  const forState = (state, extra) => {
    const { pc, coach } = scene({ programme: { state, ...extra } });
    return decide({ pc, coach });
  };

  it('allows queued and active', () => {
    expect(forState('queued').allowed).toBe(true);
    expect(forState('active').allowed).toBe(true);
  });

  it('refuses a stopped programme, and says why it stopped', () => {
    const { pc, coach } = scene({ programme: { state: 'stopped', stateReason: 'not_recruiting' } });
    const decision = decide({ pc, coach });
    expect(decision.reason).toBe(CONTACT_REFUSAL.PROGRAMME_STOPPED);
    let thrown;
    try {
      assertCampaignContactAllowed({
        programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id, onDate: TODAY,
      });
    } catch (err) { thrown = err; }
    expect(thrown.message).toMatch(/not_recruiting/);
    expect(thrown.message).toMatch(/every coach/);
  });

  it('refuses a completed programme', () => {
    expect(forState('completed').reason).toBe(CONTACT_REFUSAL.PROGRAMME_COMPLETED);
  });

  /**
   * Product rule 3: a programme is the decision unit above a coach. Stopping
   * Duke stops every coach at Duke, not the one who answered.
   */
  it('covers every coach at a stopped programme', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { state: 'stopped', stateReason: 'not_recruiting' });
    for (const email of ['head@duke.edu', 'asst@duke.edu', 'gk@duke.edu']) {
      const coach = makeCoach({ email });
      expect(decide({ pc, coach }).reason).toBe(CONTACT_REFUSAL.PROGRAMME_STOPPED);
    }
  });
});

describe('identity, through A6’s rule rather than a second copy', () => {
  it('refuses another athlete’s campaign', () => {
    const pc = makeProgramme(makeCampaign({ athleteId: OTHER_ATHLETE }));
    const coach = makeCoach();
    expect(() => decide({ pc, coach }))
      .toThrow(expect.objectContaining({ code: 'CAMPAIGN_ATHLETE_MISMATCH' }));
  });

  it('refuses a different programme and a different sport', () => {
    const pc = makeProgramme(makeCampaign(), { college: 'Duke' });
    expect(() => decide({ pc, coach: makeCoach({ school: 'Clemson' }) }))
      .toThrow(expect.objectContaining({ code: 'CAMPAIGN_PROGRAMME_MISMATCH' }));
    expect(() => decide({ pc, coach: makeCoach({ school: 'Duke', sport: 'womens-soccer' }) }))
      .toThrow(expect.objectContaining({ code: 'CAMPAIGN_PROGRAMME_MISMATCH' }));
  });

  it('refuses a programme campaign that does not exist', () => {
    expect(() => decide({ pc: 'nope', coach: makeCoach() }))
      .toThrow(expect.objectContaining({ code: 'PROGRAMME_CAMPAIGN_NOT_FOUND' }));
  });
});

// ---------------------------------------------------------------------------

describe('revocation', () => {
  it('allows a relationship that does not exist yet', () => {
    const { pc, coach } = scene();
    expect(decide({ pc, coach, outreachId: null }).allowed).toBe(true);
  });

  it('allows an existing relationship that was never revoked', () => {
    const { pc, coach } = scene();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc, onDate: TODAY });
    expect(decide({ pc, coach, outreachId: o.id }).allowed).toBe(true);
  });

  /**
   * B1 found revocation killed the public token and stopped nothing else, so a
   * withdrawn relationship could be drafted through again — and the coach would
   * receive a message whose tracking link deliberately does not resolve.
   */
  it('refuses a revoked relationship', () => {
    const { pc, coach } = scene();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc, onDate: TODAY });
    revokeOutreach(o.id);
    expect(decide({ pc, coach, outreachId: o.id }).reason).toBe(CONTACT_REFUSAL.OUTREACH_REVOKED);
  });

  it('cannot be bypassed by asking for the relationship again', () => {
    const { pc, coach } = scene();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc, onDate: TODAY });
    revokeOutreach(o.id);

    // createOutreach is idempotent per (athlete, coach) — there is no second
    // row to be had, and the gate sees the revoked one it would have returned.
    expect(() => createOutreach({
      athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc, onDate: TODAY,
    })).toThrow(expect.objectContaining({ code: 'OUTREACH_REVOKED' }));

    // And it is not silently cleared.
    expect(db.prepare('SELECT revoked_at FROM outreach WHERE id = ?').get(o.id).revoked_at)
      .toBeTruthy();
    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(1);
  });

  it('refuses drafting through a revoked relationship', () => {
    const { pc, coach } = scene();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc, onDate: TODAY });
    revokeOutreach(o.id);
    expect(() => recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc,
      onDate: TODAY, evidence: null, body: 'b', subject: 's',
    })).toThrow(expect.objectContaining({ code: 'OUTREACH_REVOKED' }));
    expect(sendsForOutreach(o.id)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('suppression and the per-inbox cap keep their own scopes', () => {
  it('explains a suppressed address without moving the existing check', () => {
    const { pc, coach } = scene({ coach: { email: 'optout@duke.edu' } });
    suppress({ email: 'optout@duke.edu' });
    expect(decide({ pc, coach }).reason).toBe(CONTACT_REFUSAL.SUPPRESSED);
    // sendOutreach still runs isSuppressed itself; this is defence in depth
    // plus the ability to say WHY, which a screen needs.
    const src = fs.readFileSync(new URL('../routes/sendOutreach.js', import.meta.url), 'utf8');
    expect(src).toContain('isSuppressed(coach.email)');
  });

  it('keeps suppression address-global rather than campaign-scoped', () => {
    const { coach } = scene({ coach: { email: 'optout@duke.edu' } });
    suppress({ email: 'optout@duke.edu' });
    // A different athlete, a different campaign, same address: still refused.
    const otherPc = makeProgramme(makeCampaign({ athleteId: OTHER_ATHLETE }));
    expect(campaignContactDecision({
      programmeCampaignId: otherPc, athleteId: OTHER_ATHLETE, coachId: coach.id, onDate: TODAY,
    }).reason).toBe(CONTACT_REFUSAL.SUPPRESSED);
  });

  /**
   * The cap is a SEND-time protection of a recipient inbox and B3 does not
   * touch it. It is not the daily action budget, which is B5.
   */
  it('leaves the per-inbox cap where it was, counting athletes and send-only', () => {
    const { pc, coach } = scene({ coach: { email: 'popular@duke.edu' } });
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc, onDate: TODAY });

    // Drafting consumes nothing.
    recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc,
      onDate: TODAY, evidence: null, body: 'b', subject: 's',
    });
    expect(recentSendCount('popular@duke.edu')).toBe(0);
    expect(isSendCapped('popular@duke.edu')).toBe(false);

    markOutreachSent(o.id);
    expect(recentSendCount('popular@duke.edu')).toBe(1);
    // The gate does not read the cap: they answer different questions.
    expect(decide({ pc, coach, outreachId: o.id }).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('the gate is at the write', () => {
  it('refuses createOutreach for a stopped programme, writing nothing', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { state: 'stopped', stateReason: 'not_recruiting' });
    const coach = makeCoach();

    expect(() => createOutreach({
      athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc, onDate: TODAY,
    })).toThrow(expect.objectContaining({ code: 'PROGRAMME_STOPPED' }));

    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n).toBe(0);
  });

  /**
   * DRAFTING IS GATED TOO, deliberately. A stopped programme that went on
   * accumulating drafts would leave a pile of sendable messages behind the
   * stop, and somebody would eventually send them.
   */
  it('refuses recordDraft for a stopped programme, leaving no message row', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc, onDate: TODAY });

    db.prepare("UPDATE programme_campaigns SET state = 'stopped', state_reason = 'not_recruiting' WHERE id = ?")
      .run(pc);

    expect(() => recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc,
      onDate: TODAY, evidence: null, body: 'b', subject: 's',
    })).toThrow(expect.objectContaining({ code: 'PROGRAMME_STOPPED' }));

    expect(sendsForOutreach(o.id)).toHaveLength(0);
  });

  it('refuses every gated condition at both writes', () => {
    for (const [label, opts, code] of [
      ['draft campaign', { campaign: { state: 'draft' } }, 'CAMPAIGN_NOT_ACTIVE'],
      ['closed campaign', { campaign: { state: 'closed' } }, 'CAMPAIGN_NOT_ACTIVE'],
      ['not started', { campaign: { startsOn: '2027-01-01' } }, 'CAMPAIGN_NOT_STARTED'],
      ['window closed', { campaign: { outreachEndsOn: '2026-09-01' } }, 'CAMPAIGN_OUTREACH_WINDOW_CLOSED'],
      ['completed programme', { programme: { state: 'completed' } }, 'PROGRAMME_COMPLETED'],
    ]) {
      db.exec('DELETE FROM outreach_send; DELETE FROM outreach; DELETE FROM programme_campaigns; DELETE FROM campaigns;');
      const { pc, coach } = scene(opts);
      expect(() => createOutreach({
        athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc, onDate: TODAY,
      }), label).toThrow(expect.objectContaining({ code }));
      expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n, label).toBe(0);
    }
  });

  it('leaves campaign and programme state untouched when it refuses', () => {
    const campaign = makeCampaign({ state: 'draft' });
    const pc = makeProgramme(campaign);
    const coach = makeCoach();
    const before = {
      campaign: db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign),
      programme: db.prepare('SELECT * FROM programme_campaigns WHERE id = ?').get(pc),
    };
    expect(() => createOutreach({
      athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc, onDate: TODAY,
    })).toThrow();
    expect(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaign)).toEqual(before.campaign);
    expect(db.prepare('SELECT * FROM programme_campaigns WHERE id = ?').get(pc)).toEqual(before.programme);
  });

  /**
   * The point of putting the gate here rather than in a list builder: an
   * execution engine that never touches the HTTP endpoint still cannot write a
   * campaign-attributed row without passing it.
   */
  it('is reached from the two functions that write campaign attribution', async () => {
    const outreachSrc = fs.readFileSync(new URL('./outreach.js', import.meta.url), 'utf8');
    const sendSrc = fs.readFileSync(new URL('./outreachSend.js', import.meta.url), 'utf8');
    expect(outreachSrc).toContain('authorisedProgrammeCampaignId');
    expect(sendSrc).toContain('authorisedProgrammeCampaignId');
    // And nothing writes programme_campaign_id around it.
    expect(outreachSrc).not.toMatch(/UPDATE\s+outreach\s+SET[^;]*programme_campaign_id/i);
  });
});

// ---------------------------------------------------------------------------

describe('legacy and manual outreach are untouched', () => {
  it('gates nothing when there is no campaign', () => {
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    expect(o.programme_campaign_id).toBeNull();
    expect(() => recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: coach.id,
      evidence: null, body: 'b', subject: 's',
    })).not.toThrow();
    expect(sendsForOutreach(o.id)).toHaveLength(1);
  });

  it('does not gate a manual message even to a revoked relationship', () => {
    // Deliberate: B3 changes campaign behaviour only. Revocation blocking a
    // manual re-draft is a wider decision than this slice, and quietly
    // changing the manual path would be a surprise.
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    revokeOutreach(o.id);
    expect(() => recordDraft({
      outreachId: o.id, athleteId: ATHLETE, coachId: coach.id,
      evidence: null, body: 'b', subject: 's',
    })).not.toThrow();
  });

  it('passes a null campaign straight through with no lookup at all', () => {
    expect(authorisedProgrammeCampaignId({ programmeCampaignId: null, athleteId: 'x', coachId: 'y' }))
      .toBeNull();
    expect(authorisedProgrammeCampaignId({ athleteId: 'x', coachId: 'y' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('refusals are machine-readable', () => {
  it('names every reason as a code, never only a sentence', () => {
    expect(Object.values(CONTACT_REFUSAL).sort()).toEqual([
      'CAMPAIGN_NOT_ACTIVE', 'CAMPAIGN_NOT_STARTED', 'CAMPAIGN_OUTREACH_WINDOW_CLOSED',
      'OUTREACH_REVOKED', 'PROGRAMME_COMPLETED', 'PROGRAMME_STOPPED',
      'RELATIONSHIP_DO_NOT_CONTACT', 'RELATIONSHIP_MANUAL_ONLY', 'SUPPRESSED',
    ]);
  });

  it('keeps the two stances apart, so a screen can tell them apart', () => {
    // One is a refusal and the other is a redirection. A single code would
    // send an operator to change a safety setting when all they had to do was
    // press Relationship Outreach.
    expect(CONTACT_REFUSAL.RELATIONSHIP_MANUAL_ONLY)
      .not.toBe(CONTACT_REFUSAL.RELATIONSHIP_DO_NOT_CONTACT);
  });

  it('classes dates as timing and everything else as a decision', () => {
    // The class exists so a caller can tell "not yet" from "not ever" without
    // matching on codes of its own. F6b's materialiser is the first consumer.
    for (const timing of ['CAMPAIGN_NOT_ACTIVE', 'CAMPAIGN_NOT_STARTED',
      'CAMPAIGN_OUTREACH_WINDOW_CLOSED']) {
      expect(refusalKindOf(timing), timing).toBe(REFUSAL_KIND.TIMING);
    }
    for (const decided of ['PROGRAMME_STOPPED', 'PROGRAMME_COMPLETED', 'OUTREACH_REVOKED',
      'SUPPRESSED', 'RELATIONSHIP_DO_NOT_CONTACT', 'RELATIONSHIP_MANUAL_ONLY']) {
      expect(refusalKindOf(decided), decided).toBe(REFUSAL_KIND.PROHIBITION);
    }
    // An unknown code is a decision, not a delay: the conservative reading is
    // the right one where the answer decides whether intent may be recorded.
    expect(refusalKindOf('SOMETHING_NEW')).toBe(REFUSAL_KIND.PROHIBITION);
    expect(refusalKindOf(null)).toBeNull();
  });

  it('carries the code on the thrown error, so nothing parses prose', () => {
    const { pc, coach } = scene({ campaign: { state: 'draft' } });
    let thrown;
    try {
      assertCampaignContactAllowed({
        programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id, onDate: TODAY,
      });
    } catch (err) { thrown = err; }
    expect(thrown.code).toBe('CAMPAIGN_NOT_ACTIVE');
    expect(thrown.message).toMatch(/Activate it first/);
  });

  it('returns the programme campaign alongside a refusal, so a screen can explain it', () => {
    const { pc, coach } = scene({ programme: { state: 'stopped', stateReason: 'no_contact' } });
    const decision = decide({ pc, coach });
    expect(decision.allowed).toBe(false);
    expect(decision.programmeCampaign).toMatchObject({
      id: pc, college_name: 'Duke', sport: 'mens-soccer', state: 'stopped', state_reason: 'no_contact',
    });
  });

  it('refuses one condition at a time, in a deterministic order', () => {
    // A draft campaign whose programme is also stopped reports the campaign:
    // the wider fact first, so an operator fixes the right thing.
    const campaign = makeCampaign({ state: 'draft' });
    const pc = makeProgramme(campaign, { state: 'stopped', stateReason: 'operator' });
    const coach = makeCoach();
    expect(decide({ pc, coach }).reason).toBe(CONTACT_REFUSAL.CAMPAIGN_NOT_ACTIVE);
  });
});
