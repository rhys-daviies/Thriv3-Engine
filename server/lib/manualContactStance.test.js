import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import db from '../db/client.js';
import {
  establishManualOnly, establishManualOnlyForConfirmedSend,
  manualRelationshipForConfirmedSend, STANCE_OUTCOME,
} from './manualContactStance.js';
import {
  upsertAthleteProgramme, updateAthleteProgramme, findRelationship,
} from './athleteProgrammes.js';
import { createOutreach } from './outreach.js';
import { recordDraft } from './outreachSend.js';
import { confirmSent } from './confirmSends.js';
import { findOrCreateCoach } from './coaches.js';
import { manualContactDecision, campaignStanceDecision, CONTACT_REFUSAL } from './manualOutreachSafety.js';
import { visibleTop100 } from '../../shared/matching/visibleTop100.js';
import { OUTREACH_ORIGIN } from '../../shared/outreachOrigin.js';

/**
 * F5b — A HUMAN WROTE TO THIS SCHOOL, SO THE CAMPAIGN STOPS WRITING TO IT.
 *
 * ===========================================================================
 * THE TWO PROPERTIES THIS SLICE EXISTS FOR, AND THEY PULL IN OPPOSITE
 * DIRECTIONS.
 *
 *   CONFIRMED MANUAL CONTACT MUST ESTABLISH THE POLICY. Before this, an
 *   operator could write to a coach at Duke by hand and the campaign would
 *   cold-introduce the same athlete to the office next door a week later.
 *
 *   ALMOST NOTHING ELSE MAY. Not a draft, not a campaign send, not a flag,
 *   not a suppression, not an unflag, not a note. `athlete_programmes` keeps
 *   three states in three columns precisely so one action cannot mean three
 *   things, and the great majority of what follows is about the second
 *   property rather than the first.
 * ===========================================================================
 *
 * The other invariant carried forward from D-series work: NOTHING HERE REACHES
 * `suppressions`. That table is keyed on email with no athlete column, so a
 * row in it silences an address for every athlete in the system. Its contents
 * are asserted unchanged across every write below.
 */

const ATHLETE = 'a-f5b';
const OTHER_ATHLETE = 'a-f5b-other';
const DUKE = 'Duke';
const UNC = 'North Carolina';
const SPORT = 'mens-soccer';
let seq = 0;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function college(name, { sport = SPORT, active = 1 } = {}) {
  const id = `col-f5b-${++seq}`;
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, active)
    VALUES (?, 'x', 'x', ?, ?, 'NCAA D1', 'ACC', ?)
  `).run(id, name, sport, active);
  return id;
}

function athlete(id = ATHLETE, sport = SPORT) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, 'x', 'x', ?, 'MIDFIELD', ?)
  `).run(id, `Athlete ${id}`, sport);
}

const coachAt = (school, { email, sport = SPORT } = {}) => findOrCreateCoach({
  full_name: `Coach ${++seq}`,
  email: email ?? `c-f5b-${seq}@example.edu`,
  school,
  sport,
  division: 'NCAA D1',
  position_title: 'Head Coach',
});

/** A message on the wire, at whatever origin the caller names. */
function message({
  athleteId = ATHLETE, school = DUKE, origin = OUTREACH_ORIGIN.MANUAL, coach = null,
} = {}) {
  const c = coach ?? coachAt(school);
  const outreach = createOutreach({ athleteId, coachId: c.id });
  const draft = recordDraft({
    outreachId: outreach.id, athleteId, coachId: c.id, collegeName: school,
    evidence: null, body: 'hello', subject: 'hi', origin,
  });
  db.prepare('UPDATE outreach SET drafted_at = ? WHERE id = ?').run('2026-09-18T09:00:00.000Z', outreach.id);
  return { outreach, coach: c, sendId: draft.id };
}

const stanceOf = (athleteId = ATHLETE, name = DUKE, sport = SPORT) =>
  findRelationship(athleteId, name, sport)?.contact_stance ?? null;

const suppressionCount = () => db.prepare('SELECT COUNT(*) AS n FROM suppressions').get().n;
const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

let dukeId;
let uncId;

beforeEach(() => {
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM athlete_programmes; DELETE FROM suppressions;
           DELETE FROM coaches; DELETE FROM colleges; DELETE FROM players;
           DELETE FROM operator_users;`);
  seq = 0;
  athlete(ATHLETE);
  athlete(OTHER_ATHLETE);
  dukeId = college(DUKE);
  uncId = college(UNC);
});

/* ========================================================================== */
/* The domain function                                                         */
/* ========================================================================== */

describe('establishManualOnly', () => {
  it('moves a default relationship to manual_only', () => {
    upsertAthleteProgramme(ATHLETE, { college_id: dukeId });
    const r = establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });

    expect(r.outcome).toBe(STANCE_OUTCOME.ESTABLISHED);
    expect(r.changed).toBe(true);
    expect(r.stance).toBe('manual_only');
    expect(stanceOf()).toBe('manual_only');
  });

  it('creates the relationship when there is none, carrying nothing but the stance', () => {
    const r = establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });

    expect(r.outcome).toBe(STANCE_OUTCOME.ESTABLISHED);
    expect(r.created).toBe(true);
    const row = findRelationship(ATHLETE, DUKE, SPORT);
    expect(row).toMatchObject({
      contact_stance: 'manual_only',
      flagged: false,
      flag_reason: null,
      visibility: 'default',
      request_state: 'none',
      note: null,
      college_id: dukeId,
    });
  });

  it('is idempotent — a second call changes nothing and moves no timestamp', () => {
    establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });
    const before = findRelationship(ATHLETE, DUKE, SPORT);

    const r = establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });

    expect(r.outcome).toBe(STANCE_OUTCOME.ALREADY_MANUAL_ONLY);
    expect(r.changed).toBe(false);
    expect(findRelationship(ATHLETE, DUKE, SPORT)).toEqual(before);
  });

  /**
   * THE ONE THAT MUST NOT REGRESS. `do_not_contact` says nobody writes to this
   * programme for this athlete, by hand or otherwise. `manual_only` is weaker
   * — a person may — so installing it over the top would be a downgrade nobody
   * asked for, arriving as a side effect of a send that should never have been
   * possible in the first place.
   */
  it('never downgrades do_not_contact', () => {
    const p = upsertAthleteProgramme(ATHLETE, { college_id: dukeId }).programme;
    updateAthleteProgramme(ATHLETE, p.id, { contact_stance: 'do_not_contact' });
    const before = findRelationship(ATHLETE, DUKE, SPORT);

    const r = establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });

    expect(r.outcome).toBe(STANCE_OUTCOME.STRONGER_STANCE_KEPT);
    expect(r.changed).toBe(false);
    expect(r.stance).toBe('do_not_contact');
    expect(findRelationship(ATHLETE, DUKE, SPORT)).toEqual(before);
  });

  it('leaves every other column on the row exactly as it found it', () => {
    const p = upsertAthleteProgramme(ATHLETE, {
      college_id: dukeId,
      request_state: 'requested',
      requested_by: 'athlete',
      flagged: true,
      flag_reason: 'Her father is an alum',
      visibility: 'suppressed',
      note: 'Spoke to the assistant in July.',
    }).programme;

    establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });
    const after = findRelationship(ATHLETE, DUKE, SPORT);

    expect(after.contact_stance).toBe('manual_only');
    // Named one at a time so a failure says which column moved.
    expect(after.flagged).toBe(true);
    expect(after.flag_reason).toBe('Her father is an alum');
    expect(after.flagged_at).toBe(p.flagged_at);
    expect(after.visibility).toBe('suppressed');
    expect(after.request_state).toBe('requested');
    expect(after.requested_by).toBe('athlete');
    expect(after.requested_at).toBe(p.requested_at);
    expect(after.note).toBe('Spoke to the assistant in July.');
    expect(after.note_updated_at).toBe(p.note_updated_at);
    expect(after.created_at).toBe(p.created_at);
  });

  it('writes no suppression row, for anybody', () => {
    const before = suppressionCount();
    establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });
    establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });
    expect(suppressionCount()).toBe(before);
    expect(before).toBe(0);
  });

  it('creates no contact history', () => {
    establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });
    expect(count('outreach')).toBe(0);
    expect(count('outreach_send')).toBe(0);
    expect(count('outreach_send_event')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
  });

  it('is scoped to one athlete, one school and one sport', () => {
    college(DUKE, { sport: 'womens-soccer' });
    athlete('a-f5b-w', 'womens-soccer');
    upsertAthleteProgramme(ATHLETE, { college_id: dukeId });
    upsertAthleteProgramme(ATHLETE, { college_id: uncId });
    upsertAthleteProgramme(OTHER_ATHLETE, { college_id: dukeId });

    establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });

    expect(stanceOf(ATHLETE, DUKE)).toBe('manual_only');
    expect(stanceOf(ATHLETE, UNC)).toBe('default');
    expect(stanceOf(OTHER_ATHLETE, DUKE)).toBe('default');
  });

  it('reports rather than throws when it is given nothing to resolve', () => {
    for (const args of [{}, { athleteId: ATHLETE }, { athleteId: ATHLETE, collegeName: DUKE }]) {
      expect(establishManualOnly(args).outcome).toBe(STANCE_OUTCOME.IDENTITY_INCOMPLETE);
    }
    // A school the registry does not hold under this sport.
    expect(establishManualOnly({ athleteId: ATHLETE, collegeName: 'Nowhere State', sport: SPORT })
      .outcome).toBe(STANCE_OUTCOME.PROGRAMME_UNRESOLVABLE);
    expect(count('athlete_programmes')).toBe(0);
  });

  /**
   * A programme retired after somebody wrote to it. `athleteProgrammes`
   * refuses to add an inactive programme to an athlete's list, and that is its
   * rule to make; this reports the refusal rather than overriding it, and
   * emphatically does not raise into a send path that has already finished.
   */
  it('reports, and does not throw, when the registry will not supply an identity', () => {
    college('Retired College', { active: 0 });
    const r = establishManualOnly({
      athleteId: ATHLETE, collegeName: 'Retired College', sport: SPORT,
    });
    expect(r.outcome).toBe(STANCE_OUTCOME.PROGRAMME_UNRESOLVABLE);
    expect(r.changed).toBe(false);
  });
});

/* ========================================================================== */
/* Provenance                                                                  */
/* ========================================================================== */

describe('which confirmed messages establish anything', () => {
  it('resolves a manual message to its athlete, school and sport', () => {
    const { outreach, sendId } = message();
    expect(manualRelationshipForConfirmedSend({ outreachId: outreach.id, outreachSendId: sendId }))
      .toEqual({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });
  });

  /**
   * THE ANTI-COUPLING RULE, AT ITS SOURCE. The campaign engine must never write
   * Specific Search contact policy — a campaign that silently switched itself
   * off for a school would be a bug nobody could see from either side.
   */
  it('refuses a campaign message', () => {
    const { outreach, sendId } = message({ origin: OUTREACH_ORIGIN.CAMPAIGN });
    expect(manualRelationshipForConfirmedSend({ outreachId: outreach.id, outreachSendId: sendId }))
      .toBeNull();
  });

  /**
   * NULL MEANS "NOT RECORDED", which is not the same as either origin. Nothing
   * backfills it, and a policy invented from a provenance nobody observed is a
   * fabrication. The operator can still set the stance by hand, knowing what
   * they are asserting.
   */
  it('refuses a message written before the origin vocabulary existed', () => {
    const { outreach, sendId } = message({ origin: null });
    expect(manualRelationshipForConfirmedSend({ outreachId: outreach.id, outreachSendId: sendId }))
      .toBeNull();
  });

  it('refuses a relationship with no message at all', () => {
    const coach = coachAt(DUKE);
    const outreach = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    expect(manualRelationshipForConfirmedSend({ outreachId: outreach.id })).toBeNull();
  });

  it('establishes in one step for a caller holding only a confirmed message', () => {
    const { outreach, sendId } = message();
    const r = establishManualOnlyForConfirmedSend({ outreachId: outreach.id, outreachSendId: sendId });

    expect(r.outcome).toBe(STANCE_OUTCOME.ESTABLISHED);
    expect(stanceOf()).toBe('manual_only');
  });

  it('and reports IDENTITY_INCOMPLETE for a campaign one, so no caller has to branch', () => {
    const { outreach, sendId } = message({ origin: OUTREACH_ORIGIN.CAMPAIGN });
    const r = establishManualOnlyForConfirmedSend({ outreachId: outreach.id, outreachSendId: sendId });

    expect(r.outcome).toBe(STANCE_OUTCOME.IDENTITY_INCOMPLETE);
    expect(r.changed).toBe(false);
    expect(stanceOf()).toBeNull();
  });

  it('reads the school off the coach, never off a label a caller was holding', () => {
    // The coach is at UNC; the draft was labelled Duke. Where the message
    // actually went is what the policy must be about.
    const coach = coachAt(UNC);
    const { outreach, sendId } = message({ school: DUKE, coach });
    expect(manualRelationshipForConfirmedSend({ outreachId: outreach.id, outreachSendId: sendId }))
      .toEqual({ athleteId: ATHLETE, collegeName: UNC, sport: SPORT });
  });
});

/* ========================================================================== */
/* The batch confirmation seam                                                 */
/* ========================================================================== */

describe('confirming an Outlook draft that was actually sent', () => {
  it('establishes manual_only', () => {
    const { outreach } = message();
    expect(stanceOf()).toBeNull();

    const r = confirmSent([outreach.id]);

    expect(r.confirmed).toBe(1);
    expect(stanceOf()).toBe('manual_only');
  });

  /**
   * A DRAFT IS NOT CONTACT. Writing a body opens an Outlook window and nothing
   * more; whether the operator pressed Send is precisely what this process
   * cannot see, and a policy installed on a draft would silence the campaign
   * for a school nobody had written to.
   */
  it('does not establish anything while the draft is only a draft', () => {
    message();
    expect(stanceOf()).toBeNull();
    expect(count('athlete_programmes')).toBe(0);
  });

  it('still records the history a draft has always recorded', () => {
    const { outreach, sendId } = message();
    expect(count('outreach')).toBe(1);
    expect(count('outreach_send')).toBe(1);
    expect(db.prepare('SELECT state, origin FROM outreach_send WHERE id = ?').get(sendId))
      .toEqual({ state: 'DRAFT', origin: 'manual' });
    expect(db.prepare('SELECT drafted_at FROM outreach WHERE id = ?').get(outreach.id).drafted_at)
      .toBeTruthy();
  });

  it('is idempotent across a re-confirmation', () => {
    const { outreach } = message();
    confirmSent([outreach.id]);
    const after = findRelationship(ATHLETE, DUKE, SPORT);

    confirmSent([outreach.id]);

    expect(findRelationship(ATHLETE, DUKE, SPORT)).toEqual(after);
    expect(count('athlete_programmes')).toBe(1);
  });

  it('establishes one programme policy for two coaches at one school', () => {
    const a = message();
    const b = message();
    confirmSent([a.outreach.id, b.outreach.id]);

    expect(count('athlete_programmes')).toBe(1);
    expect(stanceOf()).toBe('manual_only');
  });

  it('does NOT establish anything for a campaign-origin confirmation', () => {
    const { outreach } = message({ origin: OUTREACH_ORIGIN.CAMPAIGN });
    confirmSent([outreach.id]);

    expect(stanceOf()).toBeNull();
    expect(count('athlete_programmes')).toBe(0);
  });

  it('does not downgrade a do_not_contact relationship', () => {
    const p = upsertAthleteProgramme(ATHLETE, { college_id: dukeId }).programme;
    updateAthleteProgramme(ATHLETE, p.id, { contact_stance: 'do_not_contact' });
    const { outreach } = message();

    confirmSent([outreach.id]);

    expect(stanceOf()).toBe('do_not_contact');
  });

  it('writes no suppression row', () => {
    const { outreach } = message();
    confirmSent([outreach.id]);
    expect(suppressionCount()).toBe(0);
  });
});

/* ========================================================================== */
/* What the campaign then does about it                                        */
/* ========================================================================== */

describe('the campaign, after the policy is established', () => {
  it('refuses the programme with RELATIONSHIP_MANUAL_ONLY', () => {
    const coach = coachAt(DUKE);
    establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });

    const decision = campaignStanceDecision({
      athleteId: ATHLETE, collegeName: DUKE, sport: SPORT, coachEmail: coach.email,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe(CONTACT_REFUSAL.MANUAL_ONLY);
    expect(decision.programme).toBe(DUKE);
  });

  /**
   * THE SHARED-INBOX CASE, WHICH IS THE ONE THAT WOULD HAVE BEEN EASY TO GET
   * WRONG. One address can be on record at two schools. Working Duke by hand
   * is a statement about Duke, and must not quietly cost the athlete a UNC
   * campaign that happens to share a generic soccer mailbox.
   *
   * That reach distinction is `campaignStanceDecision`'s and predates F5b;
   * this asserts F5b's writer respects it rather than reaching wider.
   */
  it('still campaigns a DIFFERENT school that shares the same coach address', () => {
    const shared = 'soccer@shared.test';
    coachAt(DUKE, { email: shared });
    coachAt(UNC, { email: shared });

    establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });

    expect(campaignStanceDecision({
      athleteId: ATHLETE, collegeName: DUKE, sport: SPORT, coachEmail: shared,
    }).allowed).toBe(false);

    const unc = campaignStanceDecision({
      athleteId: ATHLETE, collegeName: UNC, sport: SPORT, coachEmail: shared,
    });
    expect(unc.allowed).toBe(true);
    expect(unc.stance).toBe('default');
  });

  it('is unaffected for a different athlete at the same school', () => {
    const coach = coachAt(DUKE);
    establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });

    expect(campaignStanceDecision({
      athleteId: OTHER_ATHLETE, collegeName: DUKE, sport: SPORT, coachEmail: coach.email,
    }).allowed).toBe(true);
  });
});

/* ========================================================================== */
/* What manual_only must NOT do                                                */
/* ========================================================================== */

describe('manual_only leaves everything else alone', () => {
  const coachEmails = () => [coachAt(DUKE).email];

  it('still allows manual outreach — that is the whole point of the stance', () => {
    const emails = coachEmails();
    establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });

    const decision = manualContactDecision({
      athleteId: ATHLETE, collegeName: DUKE, sport: SPORT, coachEmails: emails,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.stance).toBe('manual_only');
    expect(decision.reason).toBeNull();
  });

  it('and do_not_contact still refuses it, so the two are not the same rule', () => {
    const emails = coachEmails();
    const p = upsertAthleteProgramme(ATHLETE, { college_id: dukeId }).programme;
    updateAthleteProgramme(ATHLETE, p.id, { contact_stance: 'do_not_contact' });

    const decision = manualContactDecision({
      athleteId: ATHLETE, collegeName: DUKE, sport: SPORT, coachEmails: emails,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe(CONTACT_REFUSAL.DO_NOT_CONTACT);
  });

  it('does not remove the programme from the actionable Top 100', () => {
    establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });
    const relationships = [findRelationship(ATHLETE, DUKE, SPORT)];

    const { programmes } = visibleTop100({
      recommendations: [{ name: DUKE }, { name: UNC }], reserve: [], relationships,
    });
    expect(programmes.map((p) => p.name)).toContain(DUKE);
  });

  /**
   * THE THREE COLUMNS, EACH MOVED INDEPENDENTLY, WITH THE STANCE STANDING.
   *
   * Every one of these was vacuously true before F5b, because nothing ever set
   * `manual_only`. They become load-bearing the moment it does: an operator
   * tidying a flag or restoring a school to the Top 100 must not silently hand
   * it back to the campaign.
   */
  it('survives unflagging', () => {
    const p = upsertAthleteProgramme(ATHLETE, {
      college_id: dukeId, flagged: true, flag_reason: 'Already in contact with this school',
    }).programme;
    establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });

    updateAthleteProgramme(ATHLETE, p.id, { flagged: false });

    const after = findRelationship(ATHLETE, DUKE, SPORT);
    expect(after.flagged).toBe(false);
    expect(after.flag_reason).toBeNull();
    expect(after.contact_stance).toBe('manual_only');
  });

  it('survives being suppressed from, and restored to, the Top 100', () => {
    const p = upsertAthleteProgramme(ATHLETE, { college_id: dukeId }).programme;
    establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });

    updateAthleteProgramme(ATHLETE, p.id, { visibility: 'suppressed' });
    expect(stanceOf()).toBe('manual_only');

    updateAthleteProgramme(ATHLETE, p.id, { visibility: 'default' });
    expect(stanceOf()).toBe('manual_only');
  });

  it('survives a note being written and rewritten', () => {
    const p = upsertAthleteProgramme(ATHLETE, { college_id: dukeId }).programme;
    establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });

    updateAthleteProgramme(ATHLETE, p.id, { note: 'Called the assistant.' });
    updateAthleteProgramme(ATHLETE, p.id, { note: null });

    expect(stanceOf()).toBe('manual_only');
  });

  it('survives a specific request being made and withdrawn', () => {
    const p = upsertAthleteProgramme(ATHLETE, { college_id: dukeId }).programme;
    establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });

    updateAthleteProgramme(ATHLETE, p.id, { request_state: 'requested', requested_by: 'family' });
    updateAthleteProgramme(ATHLETE, p.id, { request_state: 'withdrawn' });

    expect(stanceOf()).toBe('manual_only');
  });
});

/* ========================================================================== */
/* Reversal                                                                    */
/* ========================================================================== */

describe('allowing campaign outreach again', () => {
  /**
   * `contact_stance` IS CURRENT POLICY, NOT HISTORY, and this is the test that
   * says so. An operator who decides a school should go back into the campaign
   * changes one column; the messages that were sent stay exactly where they
   * are, because they happened.
   */
  it('returns the stance to default and touches nothing else', () => {
    const { outreach, sendId } = message();
    confirmSent([outreach.id]);
    const p = findRelationship(ATHLETE, DUKE, SPORT);
    expect(p.contact_stance).toBe('manual_only');

    updateAthleteProgramme(ATHLETE, p.id, { contact_stance: 'default' });

    const after = findRelationship(ATHLETE, DUKE, SPORT);
    expect(after.contact_stance).toBe('default');
    expect(after.flagged).toBe(p.flagged);
    expect(after.flag_reason).toBe(p.flag_reason);
    expect(after.visibility).toBe(p.visibility);
    expect(after.request_state).toBe(p.request_state);
    expect(after.note).toBe(p.note);

    // History is untouched, and remains the record it always was.
    expect(count('outreach')).toBe(1);
    expect(count('outreach_send')).toBe(1);
    expect(db.prepare('SELECT state FROM outreach_send WHERE id = ?').get(sendId).state)
      .toBe('ACCEPTED');
    expect(db.prepare('SELECT sent_at FROM outreach WHERE id = ?').get(outreach.id).sent_at)
      .toBeTruthy();
  });

  it('lets the campaign proceed again', () => {
    const coach = coachAt(DUKE);
    establishManualOnly({ athleteId: ATHLETE, collegeName: DUKE, sport: SPORT });
    const p = findRelationship(ATHLETE, DUKE, SPORT);

    updateAthleteProgramme(ATHLETE, p.id, { contact_stance: 'default' });

    expect(campaignStanceDecision({
      athleteId: ATHLETE, collegeName: DUKE, sport: SPORT, coachEmail: coach.email,
    }).allowed).toBe(true);
  });
});

/* ========================================================================== */
/* Boundaries                                                                  */
/* ========================================================================== */

describe('the boundaries this slice must not cross', () => {
  const source = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /**
   * SPECIFIC SEARCH DOES NOT REACH INTO THE CAMPAIGN ENGINE. The integration
   * is one value read in one direction: the campaign asks
   * `campaignStanceDecision` what the stance is. Nothing here asks the
   * campaign anything, and a contact-policy module that imported a planner
   * would be the first step to the two workstreams needing to ship together.
   */
  it('imports no campaign, execution or transport module', () => {
    const code = source('./manualContactStance.js');
    for (const forbidden of [
      'campaignAttribution', 'campaignExecution', 'campaignContactDecision', 'campaigns.js',
      'executionDecision', 'executionClaim', 'executionContent', 'executionResolution',
      'googleTransport', 'transportSnapshot', 'rfc822', 'outboundBudget', 'pursuitPolicy',
      'sendCap', 'suppressions',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  /** And no second intelligence system, which is a separate workstream. */
  it('imports no contact-intelligence module', () => {
    const code = source('./manualContactStance.js');
    expect(code).not.toContain('contactIntelligence');
    expect(code).not.toContain('programmeContactHistory');
  });

  /**
   * ONE RELATIONSHIP WRITER, STILL. `athleteProgrammes.js` owns the invariants
   * — identity from the registry, a reason with a flag, a timestamp written by
   * the transition it describes — and a second module writing the table
   * directly would be a second set of them.
   */
  it('runs no INSERT, UPDATE or DELETE of its own', () => {
    const code = source('./manualContactStance.js');
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(code).toContain('upsertAthleteProgramme');
    expect(code).toContain('updateAthleteProgramme');
  });

  /**
   * `sendOutreach` IS SHARED INFRASTRUCTURE AND STAYS NEUTRAL. It is the one
   * send path for the manual route, the Top 100 composer, the bulk composer,
   * the drafting CLI and the campaign — so a policy write inside it would let
   * a campaign send establish manual contact policy.
   */
  it('is not reached from sendOutreach', () => {
    expect(source('../routes/sendOutreach.js')).not.toContain('manualContactStance');
    expect(source('../routes/sendOutreach.js')).not.toContain('establishManualOnly');
  });

  /**
   * RE-POINTED IN F7b, AND THE SEAM MOVED RATHER THAN DISAPPEARED.
   *
   * F5b's two callers were the batch confirmation and the manual route's
   * `send: true` branch. F7b made Specific Search draft-only, so that branch
   * was removed — Thriv3 no longer sends an individual message and therefore
   * no longer learns of one at the moment of composing. Its replacement is the
   * per-message confirmation, which is the only place in that workflow that
   * learns a message actually went, because the only thing that knows is the
   * person who pressed Send in Outlook.
   *
   * Still exactly two, and still both confirmations of a send that happened.
   */
  it('is reached from exactly the two confirmation seams it should be', () => {
    const callers = ['./confirmSends.js', './manualDraftConfirmation.js']
      .filter((f) => source(f).includes('manualContactStance.js'));
    expect(callers).toHaveLength(2);

    /**
     * AND NO LONGER FROM THE COMPOSE ROUTE. A route that drafts must establish
     * no contact policy: a draft is not contact, and the branch that used to do
     * it here could only ever be reached by an automatic send this workflow no
     * longer performs.
     */
    expect(source('../routes/manualOutreach.js')).not.toContain('manualContactStance.js');
  });
});
