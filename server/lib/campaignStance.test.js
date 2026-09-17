import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import {
  CONTACT_REFUSAL, campaignContactDecision, assertCampaignContactAllowed,
  authorisedProgrammeCampaignId, REFUSAL_KIND, refusalKindOf,
} from './campaignAttribution.js';
import { campaignStanceDecision } from './manualOutreachSafety.js';
import { programmePursuitPlan, materialiseNextContactAttempt } from './pursuitPolicy.js';
import { attemptsForProgrammeCampaign } from './contactAttempts.js';
import { createOutreach } from './outreach.js';
import { recordDraft } from './outreachSend.js';
import { findOrCreateCoach } from './coaches.js';
import { suppress } from './suppressions.js';

/**
 * F6a/F6b — THE ATHLETE'S STANCE, READ BY THE CAMPAIGN MACHINERY.
 *
 * `contact_stance` has held three values since F1 and the campaign side read
 * none of them. `do_not_contact` was enforced inside the send route only, so a
 * dry run called a do-not-contact programme executable and a direct
 * `recordDraft` wrote through it; `manual_only` was enforced nowhere at all.
 *
 * ---------------------------------------------------------------------------
 * THE TWO STANCES ARE NOT THE SAME RULE, AND THEIR REACH DIFFERS.
 *
 *   do_not_contact   A SAFETY RULE ABOUT AN INBOX. Conservative reach, as F1
 *                    established: if the recipient's address is on record at
 *                    any programme this athlete marked do-not-contact, the
 *                    outreach is refused — whatever the run claims to be.
 *
 *   manual_only      A WORKFLOW RULE ABOUT A PROGRAMME. Enforced against the
 *                    VERIFIED programme campaign alone. It says how this
 *                    programme is worked, not that the person may not be
 *                    written to, so it must never reach across a shared
 *                    address and block a different school's campaign.
 *
 * The tests that matter most here are the adversarial ones for that asymmetry,
 * and the ones proving the manual paths are untouched — a workflow rule that
 * blocked the workflow it exists to protect would be worse than no rule.
 * ---------------------------------------------------------------------------
 */

const ATHLETE = 'a-stance';
const TODAY = '2026-09-15';
let seq = 0;

function insertAthlete(id, name) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer', ?)
  `).run(id, name, randomUUID().slice(0, 10));
}

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

function makeProgramme(campaignId, { college = 'Duke', sport = 'mens-soccer', tier = 'A' } = {}) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 82, ?, 'queued', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
  `).run(id, campaignId, college, sport, ++seq, tier);
  return id;
}

const makeCoach = ({ school = 'Duke', sport = 'mens-soccer', email, title = 'Head Coach' } = {}) =>
  findOrCreateCoach({
    full_name: 'A Coach', email: email ?? `c${++seq}@duke.edu`, school, sport,
    division: 'NCAA D1', position_title: title,
  });

/**
 * A relationship row, written directly. The point of several tests below is
 * that policy NEVER creates one of these, so they are created explicitly where
 * a test wants one and nowhere else.
 */
function relationship({
  college = 'Duke', sport = 'mens-soccer', stance = 'default',
  flagged = 0, requestState = 'none', visibility = 'default',
} = {}) {
  db.prepare(`
    INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state,
      flagged, visibility, contact_stance, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
  `).run(randomUUID(), ATHLETE, college, sport, requestState, flagged, visibility, stance);
}

/** An active campaign, a queued Duke and a head coach there. */
function scene({ campaign: campaignOpts, programme, coach } = {}) {
  const campaign = makeCampaign(campaignOpts);
  const pc = makeProgramme(campaign, programme);
  return { campaign, pc, coach: makeCoach(coach) };
}

const decide = ({ pc, coach, outreachId = null, onDate = TODAY }) => campaignContactDecision({
  programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id, outreachId, onDate,
});

const relationshipCount = () =>
  db.prepare('SELECT COUNT(*) n FROM athlete_programmes').get().n;

beforeEach(() => {
  db.exec(`DELETE FROM programme_contact_attempts; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes; DELETE FROM coaches;
           DELETE FROM players; DELETE FROM suppressions;`);
  insertAthlete(ATHLETE, 'Stance Athlete');
});

/* -------------------------------------------------------------------------- */
/* manual_only                                                                 */
/* -------------------------------------------------------------------------- */

describe('manual_only stops the campaign and nothing else', () => {
  it('is refused in the pursuit dry run, not only at the send', () => {
    const { pc } = scene();
    relationship({ stance: 'manual_only' });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    // The plan still EXISTS and still names who would be written to — B6 says
    // what policy would do, and this is B3 saying it may not.
    expect(plan.current).not.toBeNull();
    expect(plan.safety.allowed).toBe(false);
    expect(plan.safety.reason).toBe(CONTACT_REFUSAL.RELATIONSHIP_MANUAL_ONLY);
    expect(plan.executableNow).toBe(false);
  });

  it('is refused at the campaign-attributed write boundary', () => {
    const { pc, coach } = scene();
    relationship({ stance: 'manual_only' });

    expect(() => createOutreach({
      athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc,
    })).toThrow(/manual contact only/i);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(0);
  });

  it('is refused for a campaign-attributed draft on an existing relationship', () => {
    const { pc, coach } = scene();
    // The relationship is opened BEFORE the stance is set, which is the real
    // sequence: an operator campaigns a programme, then decides to work it by
    // hand from then on.
    const outreach = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    relationship({ stance: 'manual_only' });

    expect(() => recordDraft({
      outreachId: outreach.id, athleteId: ATHLETE, coachId: coach.id,
      collegeName: 'Duke', sport: 'mens-soccer', programmeCampaignId: pc,
      evidence: null, body: 'b', subject: 's',
    })).toThrow(/manual contact only/i);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n).toBe(0);
  });

  it('leaves the manual route open — a person may still write to it', () => {
    const { coach } = scene();
    relationship({ stance: 'manual_only' });

    // No programme campaign: the manual paths pass null and are not gated at
    // all. This is the whole point of the stance.
    const outreach = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    expect(outreach.id).toBeTruthy();
    expect(() => recordDraft({
      outreachId: outreach.id, athleteId: ATHLETE, coachId: coach.id,
      collegeName: 'Duke', sport: 'mens-soccer', programmeCampaignId: null,
      evidence: null, body: 'b', subject: 's',
    })).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n).toBe(1);
  });

  it('records a manual draft as manual, with no campaign attribution', () => {
    const { coach } = scene();
    relationship({ stance: 'manual_only' });
    const outreach = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    recordDraft({
      outreachId: outreach.id, athleteId: ATHLETE, coachId: coach.id,
      collegeName: 'Duke', sport: 'mens-soccer', origin: 'manual',
      evidence: null, body: 'b', subject: 's',
    });
    const row = db.prepare('SELECT origin, programme_campaign_id FROM outreach_send').get();
    expect(row).toMatchObject({ origin: 'manual', programme_campaign_id: null });
  });

  it('cannot be bypassed by claiming a manual origin on a campaign send', () => {
    const { pc, coach } = scene();
    relationship({ stance: 'manual_only' });
    const outreach = createOutreach({ athleteId: ATHLETE, coachId: coach.id });

    /**
     * THE ADVERSARIAL CASE. Enforcement keys on the VERIFIED attribution, never
     * on the origin string — so a caller carrying a real programme campaign id
     * and the word "manual" is refused, and could not have recorded `manual`
     * anyway: `recordDraft` overwrites origin with `campaign` whenever the
     * attribution it verifies says so.
     */
    expect(() => recordDraft({
      outreachId: outreach.id, athleteId: ATHLETE, coachId: coach.id,
      collegeName: 'Duke', sport: 'mens-soccer',
      programmeCampaignId: pc, origin: 'manual',
      evidence: null, body: 'b', subject: 's',
    })).toThrow(/manual contact only/i);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n).toBe(0);
  });

  it('says which button to press, rather than only refusing', () => {
    const { pc, coach } = scene();
    relationship({ stance: 'manual_only' });
    let thrown;
    try {
      assertCampaignContactAllowed({
        programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id, onDate: TODAY,
      });
    } catch (err) { thrown = err; }
    expect(thrown.code).toBe('RELATIONSHIP_MANUAL_ONLY');
    expect(thrown.message).toMatch(/Relationship Outreach|Email Coaches/);
  });
});

/* -------------------------------------------------------------------------- */
/* do_not_contact                                                              */
/* -------------------------------------------------------------------------- */

describe('do_not_contact is refused by the campaign, and earlier than it was', () => {
  it('refuses in planning rather than waiting for the send route', () => {
    const { pc } = scene();
    relationship({ stance: 'do_not_contact' });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.safety.reason).toBe(CONTACT_REFUSAL.RELATIONSHIP_DO_NOT_CONTACT);
    expect(plan.executableNow).toBe(false);
  });

  it('cannot be bypassed by a direct campaign-attributed write', () => {
    const { pc, coach } = scene();
    relationship({ stance: 'do_not_contact' });

    // Neither of the two functions that write a campaign-attributed row.
    expect(() => createOutreach({
      athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc,
    })).toThrow(/do-not-contact/i);

    const outreach = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    expect(() => recordDraft({
      outreachId: outreach.id, athleteId: ATHLETE, coachId: coach.id,
      collegeName: 'Duke', sport: 'mens-soccer', programmeCampaignId: pc,
      evidence: null, body: 'b', subject: 's',
    })).toThrow(/do-not-contact/i);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n).toBe(0);
  });

  it('is reported as a different refusal from manual_only', () => {
    const { pc, coach } = scene();
    relationship({ stance: 'do_not_contact' });
    expect(decide({ pc, coach }).reason).toBe('RELATIONSHIP_DO_NOT_CONTACT');
    expect(decide({ pc, coach }).reason).not.toBe('RELATIONSHIP_MANUAL_ONLY');
  });
});

/* -------------------------------------------------------------------------- */
/* The asymmetry — one address, two programmes                                 */
/* -------------------------------------------------------------------------- */

describe('a shared address reaches one stance and not the other', () => {
  const SHARED = 'soccer@shared.edu';

  /** The same inbox on record at two schools, which 168 programmes have. */
  function sharedAcross() {
    makeCoach({ school: 'School A', email: SHARED });
    return makeCoach({ school: 'School B', email: SHARED });
  }

  it('does NOT let manual_only at School A block a campaign to School B', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { college: 'School B' });
    const coach = sharedAcross();
    relationship({ college: 'School A', stance: 'manual_only' });

    /**
     * THE DECISION THIS WHOLE FILE TURNS ON. Nobody said School B may not be
     * campaigned. Reading manual_only across a shared address would turn a
     * working preference about one programme into a silent block on another,
     * with a refusal naming a school the operator was not writing to.
     */
    expect(decide({ pc, coach }).allowed).toBe(true);
    expect(() => createOutreach({
      athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc,
    })).not.toThrow();
  });

  it('DOES let do_not_contact at School A block a campaign to School B', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { college: 'School B' });
    const coach = sharedAcross();
    relationship({ college: 'School A', stance: 'do_not_contact' });

    // F1's conservative reading, unchanged: that instruction was about the
    // inbox, and the inbox is the same one.
    const decision = decide({ pc, coach });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('RELATIONSHIP_DO_NOT_CONTACT');
    // And it names the school that refused, which is not the one being written to.
    expect(decision.stanceProgramme).toBe('School A');
  });

  it('names the other school in the refusal message, not the campaign target', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { college: 'School B' });
    const coach = sharedAcross();
    relationship({ college: 'School A', stance: 'do_not_contact' });
    let thrown;
    try {
      assertCampaignContactAllowed({
        programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id, onDate: TODAY,
      });
    } catch (err) { thrown = err; }
    expect(thrown.message).toMatch(/School A/);
    expect(thrown.message).toMatch(/on record at/);
  });

  it('still refuses manual_only at the verified programme itself', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { college: 'School B' });
    const coach = sharedAcross();
    // Narrow reach is not no reach: the stance on the campaign's OWN programme
    // is exactly what it is for.
    relationship({ college: 'School B', stance: 'manual_only' });
    expect(decide({ pc, coach }).reason).toBe('RELATIONSHIP_MANUAL_ONLY');
  });

  it('does not weaken do-not-contact for a null-sport coach row', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { college: 'School B' });
    makeCoach({ school: 'School A', sport: null, email: SHARED });
    const coach = makeCoach({ school: 'School B', email: SHARED });
    relationship({ college: 'School A', stance: 'do_not_contact' });

    // A null-sport row is ambiguous about which programme it belongs to, and
    // for a rule whose job is to stop a message the ambiguous reading is the
    // stopping one.
    expect(decide({ pc, coach }).reason).toBe('RELATIONSHIP_DO_NOT_CONTACT');
  });

  it('reports the stance decision the same way when asked directly', () => {
    makeCoach({ school: 'School A', email: SHARED });
    relationship({ college: 'School A', stance: 'manual_only' });
    relationship({ college: 'School C', stance: 'do_not_contact' });
    makeCoach({ school: 'School C', email: SHARED });

    expect(campaignStanceDecision({
      athleteId: ATHLETE, collegeName: 'School B', sport: 'mens-soccer', coachEmail: SHARED,
    })).toMatchObject({ allowed: false, reason: 'RELATIONSHIP_DO_NOT_CONTACT', programme: 'School C' });

    expect(campaignStanceDecision({
      athleteId: ATHLETE, collegeName: 'School A', sport: 'mens-soccer', coachEmail: null,
    })).toMatchObject({ allowed: false, reason: 'RELATIONSHIP_MANUAL_ONLY', programme: 'School A' });
  });
});

/* -------------------------------------------------------------------------- */
/* What a stance is NOT                                                        */
/* -------------------------------------------------------------------------- */

describe('the other relationship fields still decide nothing about contact', () => {
  it('lets a flagged programme be campaigned', () => {
    const { pc, coach } = scene();
    relationship({ flagged: 1 });
    // A flag usually means we know somebody there, which is a reason to write
    // rather than not to.
    expect(decide({ pc, coach }).allowed).toBe(true);
  });

  it('lets a requested programme be campaigned', () => {
    const { pc, coach } = scene();
    relationship({ requestState: 'requested' });
    expect(decide({ pc, coach }).allowed).toBe(true);
  });

  it('leaves visibility to the actionable Top 100, not to this gate', () => {
    const { pc, coach } = scene();
    relationship({ visibility: 'suppressed' });

    /**
     * A suppressed programme is kept OUT OF THE CAMPAIGN AT FREEZE TIME by
     * `visibleTop100`, which is upstream of everything here. If one is in a
     * campaign anyway — an older campaign, or an operator suppressing it after
     * the freeze — the ranking decision does not retroactively become a
     * contact decision.
     */
    expect(decide({ pc, coach }).allowed).toBe(true);
  });

  it('treats no relationship row at all as normal campaign behaviour', () => {
    const { pc, coach } = scene();
    expect(relationshipCount()).toBe(0);
    expect(decide({ pc, coach }).allowed).toBe(true);
  });

  it('creates no relationship row by asking the question', () => {
    const { pc, coach } = scene();
    decide({ pc, coach });
    programmePursuitPlan({ programmeCampaignId: pc });
    materialiseNextContactAttempt({ programmeCampaignId: pc });
    // The absence of an opinion is not an opinion, and reading for one must
    // never manufacture the row it was looking for.
    expect(relationshipCount()).toBe(0);
  });
});

describe('identity still binds before any stance is read', () => {
  it('refuses a coach at another school, stance or no stance', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { college: 'Duke' });
    const elsewhere = makeCoach({ school: 'Elon', email: 'e@elon.edu' });
    relationship({ college: 'Elon', stance: 'manual_only' });

    // The mismatch is a caller bug and throws before a stance is consulted:
    // a stance answer would imply the pairing was coherent.
    let thrown;
    try { decide({ pc, coach: elsewhere }); } catch (err) { thrown = err; }
    expect(thrown.code).toBe('CAMPAIGN_PROGRAMME_MISMATCH');
  });

  it('refuses a coach in the other sport at the same school', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { college: 'Duke', sport: 'mens-soccer' });
    const womens = makeCoach({ school: 'Duke', sport: 'womens-soccer', email: 'w@duke.edu' });
    let thrown;
    try { decide({ pc, coach: womens }); } catch (err) { thrown = err; }
    expect(thrown.code).toBe('CAMPAIGN_PROGRAMME_MISMATCH');
  });

  it('reads the stance for the verified programme, never a caller-named one', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, { college: 'Duke', sport: 'mens-soccer' });
    const coach = makeCoach({ school: 'Duke', sport: 'mens-soccer' });
    // The women's programme at the same school is manual_only. The men's
    // campaign is not, and the sport half of the key is what keeps them apart.
    relationship({ college: 'Duke', sport: 'womens-soccer', stance: 'manual_only' });
    expect(decide({ pc, coach }).allowed).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* F6b — materialisation                                                       */
/* -------------------------------------------------------------------------- */

describe('a refused plan materialises nothing', () => {
  const attempts = (pc) => attemptsForProgrammeCampaign(pc);

  it('writes no attempt for a manual_only programme', () => {
    const { pc } = scene();
    relationship({ stance: 'manual_only' });

    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(out.created).toBe(false);
    expect(out.attempt).toBeNull();
    expect(attempts(pc)).toEqual([]);
    // Not silent: the reason travels back with the answer.
    expect(out.plan.safety.reason).toBe('RELATIONSHIP_MANUAL_ONLY');
  });

  it('writes no attempt for a do_not_contact programme', () => {
    const { pc } = scene();
    relationship({ stance: 'do_not_contact' });
    expect(materialiseNextContactAttempt({ programmeCampaignId: pc }).created).toBe(false);
    expect(attempts(pc)).toEqual([]);
  });

  it('writes no attempt for a globally suppressed address', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    makeCoach({ email: 'opted@duke.edu' });
    suppress({ email: 'opted@duke.edu' });

    // The address opted out of Thriv3 across every athlete; an intent to
    // pursue them is an artefact nobody should be able to act on later.
    expect(materialiseNextContactAttempt({ programmeCampaignId: pc }).created).toBe(false);
    expect(attempts(pc)).toEqual([]);
  });

  it('writes no attempt for a stopped programme', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    makeCoach();
    db.prepare("UPDATE programme_campaigns SET state = 'stopped' WHERE id = ?").run(pc);
    expect(materialiseNextContactAttempt({ programmeCampaignId: pc }).created).toBe(false);
    expect(attempts(pc)).toEqual([]);
  });

  it('mutates nothing else on its way to refusing', () => {
    const { pc } = scene();
    relationship({ stance: 'manual_only' });
    const before = ['outreach', 'outreach_send', 'programme_contact_attempts', 'athlete_programmes',
      'programme_campaigns', 'campaigns', 'outbound_send_attempt']
      .map((t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);

    materialiseNextContactAttempt({ programmeCampaignId: pc });

    expect(['outreach', 'outreach_send', 'programme_contact_attempts', 'athlete_programmes',
      'programme_campaigns', 'campaigns', 'outbound_send_attempt']
      .map((t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c)).toEqual(before);
    // And the campaign's own state is untouched — no ranking, tier or state
    // moved because a plan was refused.
    expect(db.prepare('SELECT state, tier, rank FROM programme_campaigns WHERE id = ?').get(pc))
      .toMatchObject({ state: 'queued', tier: 'A' });
  });

  it('still materialises a safe programme exactly as before', () => {
    const { pc, coach } = scene();
    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(out.created).toBe(true);
    expect(out.attempt.coach_id).toBe(coach.id);
    expect(out.attempt.state).toBe('planned');
    expect(out.attempt.step).toBe(1);
    expect(attempts(pc)).toHaveLength(1);
    // An ACTIVE campaign is refused by nothing and reports no prohibition.
    expect(out.plan.safety.allowed).toBe(true);
    expect(out.prohibition).toBeUndefined();
  });

  it('treats a refusal code it has never seen as a prohibition', () => {
    /**
     * THE DEFAULT MATTERS MORE THAN THE LIST. A code added later — an
     * unsubscribe scope, a provider block, a policy this build has not met — is
     * a decision until somebody deliberately classifies it as a date. Failing
     * the other way would let a new refusal silently start recording intents.
     */
    expect(refusalKindOf('SOMETHING_ADDED_LATER')).toBe(REFUSAL_KIND.PROHIBITION);
    expect(refusalKindOf('CONTACT_CHECK_FAILED')).toBe(REFUSAL_KIND.PROHIBITION);
    // Only these three are dates, and each is a fact about WHEN.
    expect(['CAMPAIGN_NOT_ACTIVE', 'CAMPAIGN_NOT_STARTED', 'CAMPAIGN_OUTREACH_WINDOW_CLOSED']
      .map(refusalKindOf)).toEqual([REFUSAL_KIND.TIMING, REFUSAL_KIND.TIMING, REFUSAL_KIND.TIMING]);
  });

  it('writes no attempt once the campaign is closed', () => {
    const { pc } = scene({ campaign: { state: 'closed' } });

    /**
     * A CLOSED CAMPAIGN IS NOT WAITING FOR ANYTHING.
     *
     * It shares a refusal code with a draft — neither may send — but not a
     * kind: a draft becomes active by being activated and a closed campaign
     * becomes nothing. Classed as timing, it was skipped along with the dates,
     * and a finished campaign could still record an intent to pursue somebody.
     */
    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(out.created).toBe(false);
    expect(out.attempt).toBeNull();
    expect(out.prohibition.reason).toBe('CAMPAIGN_NOT_ACTIVE');
    expect(out.prohibition.kind).toBe(REFUSAL_KIND.PROHIBITION);
    expect(attempts(pc)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) c FROM programme_contact_attempts').get().c).toBe(0);
  });

  it('writes no attempt for a closed campaign whose programme is also manual_only', () => {
    const { pc } = scene({ campaign: { state: 'closed' } });
    relationship({ stance: 'manual_only' });

    // Two prohibitions. Which one is reported first does not matter — the
    // attempt is not written either way.
    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(out.created).toBe(false);
    expect(out.prohibition.kind).toBe(REFUSAL_KIND.PROHIBITION);
    expect(attempts(pc)).toEqual([]);
  });

  it('tells a draft campaign apart from a closed one by kind, not by code', () => {
    const draft = scene({ campaign: { state: 'draft' } });
    const closed = scene({ campaign: { state: 'closed' } });

    // The public code is deliberately unchanged — both campaigns are equally
    // unable to send, and a caller matching on CAMPAIGN_NOT_ACTIVE keeps
    // working. The kind is where the difference lives.
    for (const { pc, coach } of [draft, closed]) {
      expect(decide({ pc, coach }).reason).toBe(CONTACT_REFUSAL.CAMPAIGN_NOT_ACTIVE);
    }
    expect(decide(draft).kind).toBe(REFUSAL_KIND.TIMING);
    expect(decide(closed).kind).toBe(REFUSAL_KIND.PROHIBITION);
    // And the state itself is on the decision, for a screen that wants to say
    // which of the two it is.
    expect(decide(closed).programmeCampaign.campaign_state).toBe('closed');
  });

  it('still materialises for a draft campaign, which is how one is prepared', () => {
    const { pc } = scene({ campaign: { state: 'draft' } });
    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });

    // A TIMING refusal, not a decision: the campaign becomes active by being
    // activated, and planning who would be approached is the review that
    // precedes it. Refusing here would make a campaign impossible to prepare.
    expect(out.plan.safety.allowed).toBe(false);
    expect(out.plan.safety.kind).toBe(REFUSAL_KIND.TIMING);
    expect(out.created).toBe(true);
  });

  it('refuses a draft campaign whose programme is ALSO manual_only', () => {
    const { pc } = scene({ campaign: { state: 'draft' } });
    relationship({ stance: 'manual_only' });

    /**
     * TWO REFUSALS AT ONCE, AND THE MASKING THIS CLOSES.
     *
     * The plan reports the WIDER fact, as it always has: the campaign is a
     * draft. Read only that, the materialiser would write the attempt — the
     * draft state is precisely when intents are recorded — and the stance
     * underneath it would never have been consulted.
     *
     * Asking without the dates surfaces the standing prohibition, so the
     * intent is refused and the reason names the stance rather than the draft.
     */
    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(out.plan.safety.reason).toBe('CAMPAIGN_NOT_ACTIVE');
    expect(out.prohibition.reason).toBe('RELATIONSHIP_MANUAL_ONLY');
    expect(out.created).toBe(false);
    expect(attempts(pc)).toEqual([]);
  });

  it('refuses a draft campaign whose programme is ALSO do_not_contact', () => {
    const { pc } = scene({ campaign: { state: 'draft' } });
    relationship({ stance: 'do_not_contact' });
    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(out.created).toBe(false);
    expect(out.prohibition.reason).toBe('RELATIONSHIP_DO_NOT_CONTACT');
    expect(attempts(pc)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The null-campaign path is untouched                                         */
/* -------------------------------------------------------------------------- */

describe('nothing without a verified campaign is gated by any of this', () => {
  it('passes a null campaign straight through, whatever the stance says', () => {
    relationship({ stance: 'do_not_contact' });
    relationship({ college: 'Elsewhere', stance: 'manual_only' });

    // `authorisedProgrammeCampaignId` returns null with no lookup at all, which
    // is what keeps Relationship Outreach, Email Coaches, the manual route and
    // the drafting CLI out of this entirely. Their own do-not-contact
    // protection is `assertContactAllowed` in the send route, unchanged.
    expect(authorisedProgrammeCampaignId({
      programmeCampaignId: null, athleteId: ATHLETE, coachId: 'whoever',
    })).toBeNull();
  });
});
