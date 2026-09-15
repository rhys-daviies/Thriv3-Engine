import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import db from '../db/client.js';
import { composeMessage, composeProgrammeMessage } from './programmeMessage.js';
import { evidenceFor } from './evidenceQueries.js';
import { createOutreach } from './outreach.js';
import { recordDraft, confirmSend } from './outreachSend.js';
import { ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';
import { OUTREACH_POLICY_VERSION } from '../../shared/evidence/outreachPolicy.js';
import { EVIDENCE_SEQUENCE_POLICY_VERSION } from '../../shared/evidence/sequenceStrategy.js';
import {
  emailBodyFor, fillTemplate, DEFAULT_EMAIL_SUBJECT, BODY_SOURCE,
} from '../../src/lib/emailTemplate.js';

/**
 * F10b-1 — COMPOSING ON THE SERVER, FROM IDENTIFIERS ALONE.
 *
 * ---------------------------------------------------------------------------
 * THE CLAIM UNDER TEST IS A PARITY CLAIM.
 *
 * The prose a coach reads has always been composed in a browser and POSTed to
 * the send route. Moving that into Node is only safe if it produces the SAME
 * email — so the parity block below composes each case twice, once through the
 * canonical path the browser and the drafting CLI use and once through this
 * seam, and compares the text rather than trusting that both call the same
 * function.
 * ---------------------------------------------------------------------------
 *
 * AND TWO NEGATIVE CLAIMS, which are why server-side composition is worth
 * having at all: the caller supplies three identifiers and cannot inject a
 * sentence, a recipient or a step; and composing writes nothing, sends
 * nothing and asks no model.
 */

const ATHLETE = 'a-f10b1';
const COLLEGE = 'Duke';
const SPORT = 'mens-soccer';
let seq = 0;

function insertAthlete(id, over = {}) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug,
      nationality, recruiting_class_year, gpa, email_subject, email_template)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'DEFENSE', 'mens-soccer', ?, 'New Zealand', 2027, 3.8,
      ?, ?)
  `).run(id, randomUUID().slice(0, 10), over.email_subject ?? null, over.email_template ?? null);
}

function makeCampaign() {
  db.prepare(`UPDATE campaigns SET state='closed', closed_at='x', close_reason='completed'
    WHERE athlete_id = ? AND state='active'`).run(ATHLETE);
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', 'active', '2020-01-01', 'x', 'x', 'x', 1)
  `).run(id, ATHLETE);
  return id;
}

function makeProgramme(campaignId, { college = COLLEGE } = {}) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 82, 'A', 'AUTO', 'queued', 'x', 'x')
  `).run(id, campaignId, college, SPORT, ++seq);
  return id;
}

function makeCoach({ name = 'Danny Frid', school = COLLEGE, email } = {}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, 'x', ?, ?, ?, 'NCAA D1', ?, 'Head Coach')
  `).run(id, name, email ?? `c${++seq}@duke.edu`, school, SPORT);
  return id;
}

function makeCollege({ name = COLLEGE, division = 'NCAA D1' } = {}) {
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference)
    VALUES (?, 'x', 'x', ?, ?, ?, 'ACC')
  `).run(randomUUID(), name, SPORT, division);
}

/**
 * ROSTER HISTORY THE ENGINE CAN ACTUALLY SAY SOMETHING ABOUT.
 *
 * A compatriot on file is the cleanest licensed hook: HISTORICAL_SAME_COUNTRY
 * is a record of who a programme recruited, which is the one thing
 * `outreachEvidence` lets a stranger state without qualification.
 */
function giveCompatriotHistory(college = COLLEGE) {
  for (const [name, season] of [['Hayden Aish', 2024], ['Jack Kelly', 2023]]) {
    db.prepare(`
      INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division,
        season, player_name, position, nationality, country, class_year_label, minutes_played,
        games_played)
      VALUES (?, 'x', 'x', ?, ?, 'NCAA D1', ?, ?, 'DEFENSE', 'International', 'New Zealand',
        'Junior', 900, 18)
    `).run(randomUUID(), college, SPORT, String(season), name);
  }
}

/** A real accepted campaign message, through the real write path. */
function sendUnder(pc, coachId, kinds = ['HISTORICAL_SAME_COUNTRY']) {
  const o = createOutreach({ athleteId: ATHLETE, coachId, programmeCampaignId: pc });
  recordDraft({
    outreachId: o.id,
    athleteId: ATHLETE,
    coachId,
    collegeName: COLLEGE,
    sport: SPORT,
    programmeCampaignId: pc,
    evidence: {
      composition: {
        sentences: kinds.map((kind, i) => ({ order: i, slot: 'RELEVANCE', kind, text: `t${kind}` })),
        placement: [],
      },
    },
    body: `b${++seq}`,
    subject: 's',
  });
  confirmSend(o.id, undefined, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
  return o;
}

const athleteRow = () => db.prepare('SELECT * FROM players WHERE id = ?').get(ATHLETE);
const collegeRow = () => db.prepare('SELECT name, division FROM colleges WHERE name = ? AND sport = ?')
  .get(COLLEGE, SPORT) ?? { name: COLLEGE, division: null };
const coachRow = (id) => db.prepare('SELECT * FROM coaches WHERE id = ?').get(id);
const rows = (table) => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;

/**
 * THE CANONICAL COMPOSITION, spelled out rather than imported.
 *
 * This is `draftOutreach.draftOne` and `EmailComposer`'s two lines, written
 * here so parity is compared against the EXISTING path's own arithmetic. If
 * the seam were tested against itself the test would pass whatever it did.
 */
function canonical(athlete, college, coachName, evidence) {
  const composed = emailBodyFor(athlete, college, coachName, { evidence });
  return {
    subject: fillTemplate(athlete.email_subject || DEFAULT_EMAIL_SUBJECT, composed.context),
    body: composed.body,
    bodySource: composed.source,
    structure: composed.structure,
  };
}

/** Every table composition must not touch. */
const WATCHED = Object.freeze([
  'programme_contact_attempts', 'outreach', 'outreach_send', 'outreach_evidence',
  'outbound_send_attempt', 'campaigns', 'programme_campaigns', 'athlete_programmes',
  'suppressions', 'connected_mailboxes', 'players', 'coaches', 'colleges', 'roster_players',
]);

function snapshot() {
  const out = {};
  for (const t of WATCHED) out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return JSON.parse(JSON.stringify(out));
}

beforeEach(() => {
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes; DELETE FROM coaches; DELETE FROM colleges;
           DELETE FROM roster_players; DELETE FROM players;`);
  insertAthlete(ATHLETE);
  makeCollege();
  seq = 0;
});

/** The ordinary scene: an active campaign, one programme, one head coach. */
function scene({ history = true } = {}) {
  const c = makeCampaign();
  const pc = makeProgramme(c);
  const coach = makeCoach();
  if (history) giveCompatriotHistory();
  return { c, pc, coach };
}

/* ========================================================================== */
/* Parity                                                                      */
/* ========================================================================== */

describe('the server composes the same email the browser would', () => {
  /** Composes both ways for one pairing and returns them side by side. */
  function bothWays(pc, coachId) {
    const athlete = athleteRow();
    const evidence = evidenceFor(athlete, COLLEGE, {
      sport: SPORT, programmeCampaignId: pc, coachId,
    });
    return {
      expected: canonical(athlete, collegeRow(), coachRow(coachId).full_name, evidence),
      actual: composeProgrammeMessage({ programmeCampaignId: pc, coachId }),
    };
  }

  it('A. an evidence-rich initial message', () => {
    const { pc, coach } = scene();
    const { expected, actual } = bothWays(pc, coach);

    expect(actual.body).toBe(expected.body);
    expect(actual.subject).toBe(expected.subject);
    expect(actual.bodySource).toBe(expected.bodySource);
    expect(actual.structure).toBe(expected.structure);
    // And it really did have something to say.
    expect(actual.evidence.renderedCount).toBeGreaterThan(0);
    expect(actual.evidence.hasPersonalisation).toBe(true);
  });

  it('B. a generic message, with no evidence at all', () => {
    const { pc, coach } = scene({ history: false });
    const { expected, actual } = bothWays(pc, coach);

    expect(actual.body).toBe(expected.body);
    expect(actual.subject).toBe(expected.subject);
    expect(actual.evidence.rendered).toEqual([]);
    expect(actual.evidence.hasPersonalisation).toBe(false);
    // A generic email is a real email — it is composed, not refused.
    expect(actual.body).toContain('Marcus Reyes');
  });

  it('C. an athlete with a saved template composes through the template path', () => {
    db.prepare('UPDATE players SET email_template = ? WHERE id = ?')
      .run('Hi {{coach_name}},\n\nAbout {{player_name}}.\n\n{{player_profile_url}}', ATHLETE);
    const { pc, coach } = scene();
    const { expected, actual } = bothWays(pc, coach);

    expect(actual.bodySource).toBe(BODY_SOURCE.TEMPLATE);
    expect(expected.bodySource).toBe(BODY_SOURCE.TEMPLATE);
    expect(actual.body).toBe(expected.body);
    expect(actual.body).toContain('About Marcus Reyes.');
  });

  it('D. an athlete with a saved subject', () => {
    db.prepare('UPDATE players SET email_subject = ? WHERE id = ?')
      .run('{{player_name}} — {{player_position}} — {{player_class_year}}', ATHLETE);
    const { pc, coach } = scene();
    const { expected, actual } = bothWays(pc, coach);

    expect(actual.subject).toBe(expected.subject);
    expect(actual.subject).toBe('Marcus Reyes — Defender — 2027');
  });

  it('E. the coach name is normalised by the composer, not by this seam', () => {
    const c = makeCampaign();
    const pc = makeProgramme(c);
    giveCompatriotHistory();
    // "Coach Danny Frid" greets Danny; "Simmons, Ali" is flipped; an initial
    // is refused and falls back to the full name. All `coachFirstName`'s rules.
    for (const [full, greeting] of [
      ['Coach Danny Frid', 'Danny'],
      ['Simmons, Ali', 'Ali'],
      // An initial is not a first name, and "Hi J," is worse than the full
      // name — `coachFirstName` refuses and the composer falls back.
      ['J. Smith', 'J. Smith'],
    ]) {
      const coach = makeCoach({ name: full, email: `${randomUUID().slice(0, 8)}@duke.edu` });
      const { expected, actual } = bothWays(pc, coach);
      expect(actual.body, full).toBe(expected.body);
      expect(actual.body, full).toContain(`Hi ${greeting},`);
    }
  });

  it('F. a step-2 follow-up', () => {
    const { pc, coach } = scene();
    sendUnder(pc, coach);

    const { expected, actual } = bothWays(pc, coach);
    expect(actual.step).toBe(2);
    expect(actual.body).toBe(expected.body);
    expect(actual.subject).toBe(expected.subject);
    expect(actual.structure).toBe(expected.structure);
    expect(actual.sequencePolicyVersion).toBe(EVIDENCE_SEQUENCE_POLICY_VERSION);
  });

  it('G. evidence the licence or the cap withheld is recorded, not sent', () => {
    const { pc, coach } = scene();
    const actual = composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });

    // Whatever was held is named and is not in the body.
    for (const kind of actual.evidence.held) {
      expect(actual.evidence.rendered.map((r) => r.kind)).not.toContain(kind);
    }
    // And every rendered sentence really is in the body it reports.
    for (const r of actual.evidence.rendered) {
      expect(actual.body, r.kind).toContain(r.text);
    }
  });
});

/* ========================================================================== */
/* Input authority                                                             */
/* ========================================================================== */

describe('what the caller may say, and it is three identifiers', () => {
  it('derives the athlete, the college and the recipient from the campaign', () => {
    const { pc, coach } = scene();
    const out = composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });

    expect(out.body).toContain('Marcus Reyes');
    expect(out.body).toContain('Hi Danny,');
    // The signature of the function is the contract: two identifiers.
    expect(Object.keys(out)).not.toContain('recipientEmail');
    // And the value says which pairing it is for, so a writer can verify it.
    expect(out.composedFor).toEqual({ programmeCampaignId: pc, coachId: coach });
  });

  it('refuses a coach who is not at the campaign’s programme', () => {
    const { pc } = scene();
    const elsewhere = makeCoach({ school: 'Clemson', email: 'x@clemson.edu' });
    expect(() => composeProgrammeMessage({ programmeCampaignId: pc, coachId: elsewhere }))
      .toThrow(/composed for the programme it is addressed to/);
  });

  it('refuses an unknown programme campaign or coach', () => {
    const { pc, coach } = scene();
    expect(() => composeProgrammeMessage({ programmeCampaignId: 'nope', coachId: coach }))
      .toThrow(/No programme campaign/);
    expect(() => composeProgrammeMessage({ programmeCampaignId: pc, coachId: 'nope' }))
      .toThrow(/No coach/);
  });

  /**
   * THE STEP IS NOT THE CALLER'S TO CLAIM. There is no parameter for it, and
   * the value comes back derived from what this campaign has actually sent.
   */
  it('derives the step from campaign history, and takes none from the caller', () => {
    const { pc, coach } = scene();
    expect(composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach }).step).toBe(1);

    sendUnder(pc, coach);
    expect(composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach }).step).toBe(2);
  });

  it('starts a new campaign at step 1, however long the lifetime history is', () => {
    const { pc, coach } = scene();
    sendUnder(pc, coach);
    sendUnder(pc, coach);

    // A second campaign reaches the same coach. Lifetime says three; the
    // conversation this coach is in with THIS campaign says one.
    const second = makeProgramme(makeCampaign());
    expect(composeProgrammeMessage({ programmeCampaignId: second, coachId: coach }).step).toBe(1);
  });

  it('refuses a third message rather than composing a generic one', () => {
    const { pc, coach } = scene();
    sendUnder(pc, coach);
    sendUnder(pc, coach);

    let caught;
    try { composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach }); } catch (e) { caught = e; }
    expect(caught?.code).toBe('UNSUPPORTED_SEQUENCE_STEP');
  });
});

/* ========================================================================== */
/* Determinism, movement and identity                                          */
/* ========================================================================== */

describe('the value is content, and only content', () => {
  it('carries no id and no timestamp', () => {
    const { pc, coach } = scene();
    const out = composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });

    const json = JSON.stringify(out);
    // Nothing that would make two identical compositions compare unequal.
    expect(Object.keys(out)).not.toContain('id');
    expect(Object.keys(out)).not.toContain('generatedAt');
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('composing twice with nothing changed returns the same value', () => {
    const { pc, coach } = scene();
    const a = composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });
    const b = composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });

    expect(b).toEqual(a);
    expect(b.bodyHash).toBe(a.bodyHash);
  });

  /**
   * THE PROPERTY F10b-2 WILL DEPEND ON.
   *
   * A value returned before the roster moved must not change afterwards. That
   * is what makes it safe to persist as a snapshot: the row will go on saying
   * what was written even though a second composition would now say something
   * else.
   */
  it('a returned value does not mutate when the evidence underneath it moves', () => {
    const { pc, coach } = scene();
    const before = composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });
    const frozenBody = before.body;
    const frozenRendered = JSON.stringify(before.evidence.rendered);
    const frozenHash = before.bodyHash;

    // The compatriots leave the roster entirely.
    db.prepare('DELETE FROM roster_players').run();

    expect(before.body).toBe(frozenBody);
    expect(JSON.stringify(before.evidence.rendered)).toBe(frozenRendered);
    expect(before.bodyHash).toBe(frozenHash);

    // And a second composition truthfully says something different.
    const after = composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });
    expect(after.evidence.renderedCount).toBe(0);
    expect(after.body).not.toBe(frozenBody);
  });

  it('reports both policy versions', () => {
    const { pc, coach } = scene();
    const initial = composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });
    expect(initial.policyVersion).toBe(OUTREACH_POLICY_VERSION);
    /**
     * A CAMPAIGN MESSAGE CARRIES A SEQUENCE RECORD AT EVERY STEP, including
     * the first — `sequenceFor` runs whenever a campaign and a coach are
     * named, and step 1 is a decision ESP1 made rather than one it skipped.
     * What distinguishes an initial message is the step, not the absence of a
     * policy. An UNATTRIBUTED composition is the one that records none.
     */
    expect(initial.step).toBe(1);
    expect(initial.sequencePolicyVersion).toBe(EVIDENCE_SEQUENCE_POLICY_VERSION);

    sendUnder(pc, coach);
    const followUp = composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });
    expect(followUp.step).toBe(2);
    expect(followUp.sequencePolicyVersion).toBe(EVIDENCE_SEQUENCE_POLICY_VERSION);
  });

  /**
   * The composed body is what was WRITTEN, not what will be received. The
   * tracked link and the compliance footer are added at send, from a token
   * that does not exist yet and configuration this function does not read.
   */
  it('composes the body without the send-time link and footer', () => {
    const { pc, coach } = scene();
    const out = composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });

    expect(out.body).toContain('{{player_profile_url}}');
    expect(out.body).not.toMatch(/unsubscribe/i);
    expect(out.body).not.toContain('http');
  });
});

/* ========================================================================== */
/* The negative properties                                                     */
/* ========================================================================== */

describe('composing writes nothing, sends nothing and asks no model', () => {
  it('leaves every watched table byte-identical', () => {
    const { pc, coach } = scene();
    const before = snapshot();

    composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });
    composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });

    expect(snapshot()).toEqual(before);
  });

  it('writes nothing even for a follow-up, where history is read', () => {
    const { pc, coach } = scene();
    sendUnder(pc, coach);
    const before = snapshot();

    composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });

    expect(snapshot()).toEqual(before);
    expect(rows('outreach_send')).toBe(1);
    expect(rows('outbound_send_attempt')).toBe(0);
  });

  /**
   * THE ARCHITECTURE GUARD, in the shape this repo already uses — see the
   * import assertion in `campaignExecution.test.js` and the caller guard in
   * `followUpSequence.test.js`.
   */
  const codeOf = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('imports no transport, no mailbox and no model', () => {
    const code = codeOf('./programmeMessage.js');
    for (const forbidden of [
      'outlook', 'applescript', 'nodemailer', 'googleapis', 'graph.microsoft',
      'anthropic', '@anthropic-ai', 'openai',
      'connectedMailboxes', 'mailboxCrypto', 'outboundBudget',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('calls nothing that writes or sends', () => {
    const code = codeOf('./programmeMessage.js');
    for (const forbidden of [
      'composeInOutlook', 'recordDraft', 'confirmSend', 'acceptSend', 'transitionSend',
      'createOutreach', 'recordOutboundAttempt', 'markOutreachSent', 'logEvidence',
      'sendImmediately', 'sendOutreach',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    // No SQL that changes anything. Four prepared reads and nothing else.
    expect(code).not.toMatch(/INSERT INTO|UPDATE |DELETE FROM/i);
  });

  /**
   * ONE SEQUENCE POLICY, HELD IN `evidenceQueries`. The same guard
   * `followUpSequence.test.js` applies to every other composition client: a
   * browser, a CLI, a route and now this seam cannot disagree about what a
   * follow-up is, because none of them decides.
   */
  it('does not re-implement the sequence policy', () => {
    const code = codeOf('./programmeMessage.js');
    for (const forbidden of ['evidenceStrategyForMessage', 'sequenceStrategy', 'campaignLocalStep']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('does not re-implement evidence selection or copy', () => {
    const code = codeOf('./programmeMessage.js');
    for (const forbidden of [
      'selectEvidence', 'outreachEvidenceFor', 'outreachCopyFor', 'generateEvidence',
      'composeOutreach', 'resolveStructure', 'followUpStructure', 'renderEvidence',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

/* ========================================================================== */
/* The shared primitive                                                        */
/* ========================================================================== */

describe('the primitive is shared, not campaign-only', () => {
  /**
   * The manual path is not migrated in this slice, but it must be able to
   * reuse this WITHOUT a campaign — otherwise F10 has built a second
   * personalisation engine, which is the one outcome the architecture review
   * ruled out.
   */
  it('composes from a resolved pairing with no campaign and no database', () => {
    const athlete = athleteRow();
    giveCompatriotHistory();
    const evidence = evidenceFor(athlete, COLLEGE, { sport: SPORT });

    const out = composeMessage({
      athlete, college: collegeRow(), coachName: 'Danny Frid', evidence,
    });

    expect(out.body).toBe(canonical(athlete, collegeRow(), 'Danny Frid', evidence).body);
    expect(out.step).toBeNull();
    expect(out.sequencePolicyVersion).toBeNull();
    // Nobody named a pairing, so the value does not claim one.
    expect(out.composedFor).toBeNull();
    expect(out.evidence.rendered.length).toBeGreaterThan(0);
  });

  it('composes with no evidence supplied at all', () => {
    const athlete = athleteRow();
    const out = composeMessage({ athlete, college: collegeRow(), coachName: 'Danny Frid' });

    // No evidence means no engine composition, so the DEFAULT template runs —
    // and it greets by `{{coach_name}}`, which is the full name.
    expect(out.body).toContain('Hi Danny Frid,');
    expect(out.evidence.rendered).toEqual([]);
    expect(out.bodySource).toBe(BODY_SOURCE.TEMPLATE);
  });

  it('the resolver is a thin wrapper over the primitive', () => {
    const { pc, coach } = scene();
    const athlete = athleteRow();
    const evidence = evidenceFor(athlete, COLLEGE, {
      sport: SPORT, programmeCampaignId: pc, coachId: coach,
    });

    expect(composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach })).toEqual(
      composeMessage({
        athlete,
        college: collegeRow(),
        coachName: 'Danny Frid',
        evidence,
        step: 1,
        composedFor: { programmeCampaignId: pc, coachId: coach },
      }),
    );
  });
});
