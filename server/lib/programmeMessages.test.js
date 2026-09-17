import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import db from '../db/client.js';
import {
  createProgrammeMessage, editProgrammeMessage, reviewProgrammeMessage,
  programmeMessage, messageForStep, messagesForAttempt, MESSAGE_STATE,
} from './programmeMessages.js';
import { composeProgrammeMessage } from './programmeMessage.js';
import { materialiseNextContactAttempt } from './pursuitPolicy.js';
import { attemptForCoach } from './contactAttempts.js';
import { createOutreach } from './outreach.js';
import { recordDraft, confirmSend } from './outreachSend.js';
import { ACCEPTED_SOURCE } from '../../shared/outreachMessageState.js';
import { OUTREACH_POLICY_VERSION } from '../../shared/evidence/outreachPolicy.js';
import { EVIDENCE_SEQUENCE_POLICY_VERSION } from '../../shared/evidence/sequenceStrategy.js';
import { bodyHash } from '../../shared/evidence/sendSnapshot.js';

/**
 * F10b-2 — THE MESSAGE, MADE DURABLE.
 *
 * ---------------------------------------------------------------------------
 * A ROW IS CONTENT, NOT DELIVERY.
 *
 * GENERATED is not DRAFTED, QUEUED, SCHEDULED or SENT, and `reviewed` is not
 * send-approved. `outreach_send` remains the only thing that says a message
 * happened. Most of this file exists to keep those two sentences true against
 * the tables rather than against a comment.
 * ---------------------------------------------------------------------------
 *
 * THE TWO CLAIMS WORTH THE MOST HERE. The recipient is resolved by the SERVER
 * from the coach the attempt names, so no caller can file a message against an
 * address of their choosing; and a replay carrying DIFFERENT generated content
 * for a step already written is refused rather than silently overwriting the
 * record of what was composed first.
 */

const ATHLETE = 'a-f10b2';
const OPERATOR = 'op-f10b2';
const COLLEGE = 'Duke';
const SPORT = 'mens-soccer';
let seq = 0;

function insertAthlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug,
      nationality, recruiting_class_year, gpa)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'DEFENSE', 'mens-soccer', ?, 'New Zealand', 2027, 3.8)
  `).run(id, randomUUID().slice(0, 10));
}

function operator(id = OPERATOR) {
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, active, created_at)
    VALUES (?, ?, 'scrypt$fake', 1, 'x')
  `).run(id, `${id}@thriv3.test`);
  return id;
}

function makeCollege({ name = COLLEGE } = {}) {
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference)
    VALUES (?, 'x', 'x', ?, ?, 'NCAA D1', 'ACC')
  `).run(randomUUID(), name, SPORT);
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

function makeCoach({ name = 'Danny Frid', school = COLLEGE, email, title = 'Head Coach' } = {}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, 'x', ?, ?, ?, 'NCAA D1', ?, ?)
  `).run(id, name, email ?? `c${++seq}@duke.edu`, school, SPORT, title);
  return id;
}

function giveCompatriotHistory(college = COLLEGE) {
  for (const [name, season] of [['Hayden Aish', '2024'], ['Jack Kelly', '2023']]) {
    db.prepare(`
      INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division,
        season, player_name, position, nationality, country, class_year_label, minutes_played,
        games_played)
      VALUES (?, 'x', 'x', ?, ?, 'NCAA D1', ?, ?, 'DEFENSE', 'International', 'New Zealand',
        'Junior', 900, 18)
    `).run(randomUUID(), college, SPORT, season, name);
  }
}

/** A real accepted campaign message, through the real write path. */
function sendUnder(pc, coachId) {
  const o = createOutreach({ athleteId: ATHLETE, coachId, programmeCampaignId: pc });
  recordDraft({
    outreachId: o.id, athleteId: ATHLETE, coachId, collegeName: COLLEGE, sport: SPORT,
    programmeCampaignId: pc, evidence: null, body: `b${++seq}`, subject: 's',
  });
  confirmSend(o.id, undefined, { source: ACCEPTED_SOURCE.OPERATOR_ASSERTED });
  return o;
}

const messages = () => db.prepare('SELECT * FROM programme_messages').all();
const rows = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;

/** Every table a message write must not touch. */
const WATCHED = Object.freeze([
  'programme_contact_attempts', 'outreach', 'outreach_send', 'outreach_evidence',
  'outbound_send_attempt', 'campaigns', 'programme_campaigns', 'athlete_programmes',
  'suppressions', 'connected_mailboxes', 'coaches', 'players', 'colleges',
  'campaign_first_touch_approvals',
]);

function snapshot() {
  const out = {};
  for (const t of WATCHED) out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return JSON.parse(JSON.stringify(out));
}

beforeEach(() => {
  db.exec(`DELETE FROM programme_messages; DELETE FROM campaign_first_touch_approvals;
           DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes; DELETE FROM coaches; DELETE FROM colleges;
           DELETE FROM roster_players; DELETE FROM operator_users; DELETE FROM players;`);
  insertAthlete(ATHLETE);
  operator();
  makeCollege();
  seq = 0;
});

/**
 * A prepared pursuit, composed and ready to file: the real F9 materialiser and
 * the real F10b-1 composer, so what is persisted is what the system produces.
 */
function prepared({ history = true } = {}) {
  const c = makeCampaign();
  const pc = makeProgramme(c);
  const coach = makeCoach();
  if (history) giveCompatriotHistory();
  const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
  const attempt = attemptForCoach(pc, coach);
  const composition = composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });
  return { c, pc, coach, attempt, composition, out };
}

/* ========================================================================== */
/* A–G — creation                                                              */
/* ========================================================================== */

describe('creating a message', () => {
  it('A. writes one step-1 message for a prepared pursuit', () => {
    const { attempt, composition } = prepared();

    const { created, message } = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });

    expect(created).toBe(true);
    expect(messages()).toHaveLength(1);
    expect(message).toMatchObject({
      programme_contact_attempt_id: attempt.id,
      step: 1,
      state: MESSAGE_STATE.GENERATED,
      reviewed_by_operator_id: null,
      reviewed_at: null,
    });
    expect(message.generated_at).toEqual(expect.any(String));
  });

  it('B. freezes the server’s coach and the server’s address', () => {
    const { attempt, coach, composition } = prepared();
    const coachEmail = db.prepare('SELECT email FROM coaches WHERE id = ?').get(coach).email;

    const { message } = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });

    expect(message.coach_id).toBe(coach);
    expect(message.recipient_email).toBe(coachEmail);
    // The composition never carried an address, so none could have been taken
    // from it — the whole point of resolving it here.
    expect(JSON.stringify(composition)).not.toContain(coachEmail);
  });

  it('B. a later change to the coach row does not move the frozen address', () => {
    const { attempt, coach, composition } = prepared();
    const { message } = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });
    const frozen = message.recipient_email;

    db.prepare('UPDATE coaches SET email = ? WHERE id = ?').run('corrected@duke.edu', coach);

    expect(programmeMessage(message.id).recipient_email).toBe(frozen);
    expect(frozen).not.toBe('corrected@duke.edu');
  });

  it('C. refuses a composition made for a different pursuit', () => {
    const first = prepared();
    // A second campaign and coach entirely.
    const otherPc = makeProgramme(makeCampaign());
    const otherCoach = makeCoach({ email: 'other@duke.edu' });
    materialiseNextContactAttempt({ programmeCampaignId: otherPc });
    const otherComposition = composeProgrammeMessage({
      programmeCampaignId: otherPc, coachId: otherCoach,
    });

    expect(() => createProgrammeMessage({
      programmeContactAttemptId: first.attempt.id, composition: otherComposition,
    })).toThrow(/composed for a different coach or programme campaign/);
    expect(messages()).toHaveLength(0);
  });

  it('C. refuses a composition that names no pairing at all', () => {
    const { attempt, composition } = prepared();
    expect(() => createProgrammeMessage({
      programmeContactAttemptId: attempt.id,
      composition: { ...composition, composedFor: null },
    })).toThrow(/does not say which pairing/);
    expect(messages()).toHaveLength(0);
  });

  it('C. refuses an unknown attempt', () => {
    const { composition } = prepared();
    expect(() => createProgrammeMessage({
      programmeContactAttemptId: 'nope', composition,
    })).toThrow(/No contact attempt/);
  });

  it('D. persists the evidence snapshot exactly as composed', () => {
    const { attempt, composition } = prepared();
    const { message } = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });

    expect(message.evidence_snapshot).toEqual(composition.evidence);
    // And it really carries the sentences, verbatim, with their provenance.
    expect(message.evidence_snapshot.rendered.length).toBeGreaterThan(0);
    for (const r of message.evidence_snapshot.rendered) {
      expect(Object.keys(r).sort()).toEqual(['kind', 'order', 'role', 'slot', 'text']);
      expect(message.generated_body).toContain(r.text);
    }
    expect(message.body_source).toBe(composition.bodySource);
    expect(message.structure).toBe(composition.structure);
  });

  it('E. generated and reviewable content are equal at creation', () => {
    const { attempt, composition } = prepared();
    const { message } = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });

    expect(message.subject).toBe(message.generated_subject);
    expect(message.body).toBe(message.generated_body);
    expect(message.body_hash).toBe(message.generated_body_hash);
    expect(message.generated_body_hash).toBe(composition.bodyHash);
  });

  it('F. persists both policy versions', () => {
    const { attempt, composition } = prepared();
    const { message } = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });

    expect(message.policy_version).toBe(OUTREACH_POLICY_VERSION);
    expect(message.sequence_policy_version).toBe(EVIDENCE_SEQUENCE_POLICY_VERSION);
  });

  /**
   * G. ESP1 IS PRESENT AT STEP 1. A campaign message carries the sequence
   * policy at every step — step 1 is a decision ESP1 made, not one it skipped.
   * A null there would mean the composition was unattributed, never that it was
   * an initial campaign message; `step` is what says which message this is.
   */
  it('G. records ESP1 on a step-1 campaign message, and the step says it is the first', () => {
    const { attempt, composition } = prepared();
    const { message } = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });

    expect(message.step).toBe(1);
    expect(message.sequence_policy_version).toBe(EVIDENCE_SEQUENCE_POLICY_VERSION);
    expect(message.evidence_snapshot.sequence.step).toBe(1);
  });
});

/* ========================================================================== */
/* H–J — cardinality and replay                                                */
/* ========================================================================== */

describe('one message per step of one pursuit', () => {
  it('H. an identical replay returns the same row, unrestamped', () => {
    const { pc, coach, attempt, composition } = prepared();
    const first = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });

    // Composed again from scratch — deterministic, so identical.
    const again = composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });
    const replay = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition: again, at: '2099-01-01T00:00:00.000Z',
    });

    expect(replay.created).toBe(false);
    expect(replay.message.id).toBe(first.message.id);
    expect(replay.message.generated_at).toBe(first.message.generated_at);
    expect(replay.message).toEqual(first.message);
    expect(messages()).toHaveLength(1);
  });

  /**
   * I. FAIL CLOSED. The stored row is durable evidence of what was composed
   * first. Overwriting it would erase that; returning it while reporting
   * success would claim a generation that never happened.
   */
  it('I. a replay carrying different content is refused, and writes nothing', () => {
    const { attempt, composition } = prepared();
    const first = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });

    const different = { ...composition, body: `${composition.body}\n\nAnd one more thing.` };
    different.bodyHash = bodyHash(different.body);

    expect(() => createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition: different,
    })).toThrow(/already been generated/);

    expect(messages()).toHaveLength(1);
    expect(programmeMessage(first.message.id)).toEqual(first.message);
  });

  it('I. a changed subject is refused too', () => {
    const { attempt, composition } = prepared();
    createProgrammeMessage({ programmeContactAttemptId: attempt.id, composition });

    expect(() => createProgrammeMessage({
      programmeContactAttemptId: attempt.id,
      composition: { ...composition, subject: 'Something else entirely' },
    })).toThrow(/already been generated/);
  });

  /**
   * J. THE REASON UNIQUENESS IS (attempt, step) AND NOT (attempt).
   *
   * One pursuit legitimately outlives one message: the attempt is unique on
   * (programme campaign, coach) and its stored step advances as messages are
   * confirmed, so the same pursuit produces a step 1 message and later a step 2
   * one. Keying on the attempt alone would make the follow-up impossible.
   */
  it('J. the same attempt writes a step-2 message after a confirmed send', () => {
    const { pc, coach, attempt, composition } = prepared();
    createProgrammeMessage({ programmeContactAttemptId: attempt.id, composition });

    sendUnder(pc, coach);

    const followUp = composeProgrammeMessage({ programmeCampaignId: pc, coachId: coach });
    expect(followUp.step).toBe(2);
    const { created, message } = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition: followUp,
    });

    expect(created).toBe(true);
    expect(message.step).toBe(2);
    expect(messagesForAttempt(attempt.id).map((m) => m.step)).toEqual([1, 2]);
    // And the step-1 message is untouched by the second one existing.
    expect(messageForStep(attempt.id, 1).body).toBe(composition.body);
  });

  it('the database refuses a duplicate step even if the writer is bypassed', () => {
    const { attempt, composition } = prepared();
    const { message } = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });

    expect(() => db.prepare(`
      INSERT INTO programme_messages (id, programme_contact_attempt_id, step, coach_id,
        recipient_email, generated_subject, generated_body, subject, body, generated_body_hash,
        body_hash, evidence_snapshot, policy_version, state, generated_at, updated_at)
      VALUES (?, ?, 1, ?, 'x@y.z', 's', 'b', 's', 'b', 'h', 'h', '{}', 'P6', 'generated', 'x', 'x')
    `).run(randomUUID(), attempt.id, message.coach_id)).toThrow(/UNIQUE/);
  });
});

/* ========================================================================== */
/* K–L — editing                                                               */
/* ========================================================================== */

describe('editing the words a person has not yet approved', () => {
  it('K. leaves the generated content untouched', () => {
    const { attempt, composition } = prepared();
    const { message } = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });

    const edited = editProgrammeMessage(message.id, { body: 'Rewritten entirely.' });

    expect(edited.changed).toBe(true);
    expect(edited.generated_body).toBe(message.generated_body);
    expect(edited.generated_subject).toBe(message.generated_subject);
    expect(edited.generated_body_hash).toBe(message.generated_body_hash);
    expect(edited.body).toBe('Rewritten entirely.');
    expect(edited.body_hash).toBe(bodyHash('Rewritten entirely.'));
    expect(edited.body_hash).not.toBe(edited.generated_body_hash);
  });

  it('L. changes subject and body, and nothing else', () => {
    const { attempt, composition } = prepared();
    const { message } = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });

    const edited = editProgrammeMessage(message.id, { subject: 'New', body: 'Also new.' });

    const untouched = [
      'id', 'programme_contact_attempt_id', 'step', 'coach_id', 'recipient_email',
      'generated_subject', 'generated_body', 'generated_body_hash', 'body_source', 'structure',
      'policy_version', 'sequence_policy_version', 'state', 'generated_at',
      'reviewed_by_operator_id', 'reviewed_at',
    ];
    for (const f of untouched) expect(edited[f], f).toEqual(message[f]);
    // The evidence is not re-derived: an operator rewording a sentence does not
    // change what the engine licensed.
    expect(edited.evidence_snapshot).toEqual(message.evidence_snapshot);
  });

  it('an edit that changes nothing writes nothing', () => {
    const { attempt, composition } = prepared();
    const { message } = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });

    const same = editProgrammeMessage(message.id, {
      subject: message.subject, body: message.body, at: '2099-01-01T00:00:00.000Z',
    });
    expect(same.changed).toBe(false);
    expect(programmeMessage(message.id).updated_at).toBe(message.updated_at);
  });

  it('refuses an empty subject or body', () => {
    const { attempt, composition } = prepared();
    const { message } = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });
    expect(() => editProgrammeMessage(message.id, { subject: '  ' })).toThrow(/needs a subject/);
    expect(() => editProgrammeMessage(message.id, { body: '' })).toThrow(/needs a body/);
  });
});

/* ========================================================================== */
/* M–Q — review                                                                */
/* ========================================================================== */

describe('a person approving these exact words', () => {
  function generated() {
    const { attempt, composition } = prepared();
    return createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    }).message;
  }

  it('M. refuses a review nobody can be named for', () => {
    const message = generated();
    for (const operatorId of [undefined, null, '', '   ']) {
      expect(() => reviewProgrammeMessage(message.id, { operatorId })).toThrow(/needs the operator/);
    }
    expect(programmeMessage(message.id).state).toBe(MESSAGE_STATE.GENERATED);
  });

  it('N. records the exact reviewer and time', () => {
    const message = generated();
    const at = '2026-09-16T10:30:00.000Z';

    const reviewed = reviewProgrammeMessage(message.id, { operatorId: OPERATOR, at });

    expect(reviewed.changed).toBe(true);
    expect(reviewed.state).toBe(MESSAGE_STATE.REVIEWED);
    expect(reviewed.reviewed_by_operator_id).toBe(OPERATOR);
    expect(reviewed.reviewed_at).toBe(at);
  });

  it('N. the reviewer must be a real operator', () => {
    const message = generated();
    expect(() => reviewProgrammeMessage(message.id, { operatorId: 'ghost' }))
      .toThrow(/FOREIGN KEY/);
    expect(programmeMessage(message.id).state).toBe(MESSAGE_STATE.GENERATED);
  });

  it('O. a replay does not restamp the time or reattribute the decision', () => {
    const message = generated();
    const first = reviewProgrammeMessage(message.id, {
      operatorId: OPERATOR, at: '2026-09-16T10:30:00.000Z',
    });

    const second = operator('op-second');
    const replay = reviewProgrammeMessage(message.id, {
      operatorId: second, at: '2099-01-01T00:00:00.000Z',
    });

    expect(replay.changed).toBe(false);
    expect(replay.reviewed_by_operator_id).toBe(OPERATOR);
    expect(replay.reviewed_at).toBe(first.reviewed_at);
  });

  it('P. approved words cannot be edited', () => {
    const message = generated();
    reviewProgrammeMessage(message.id, { operatorId: OPERATOR });

    expect(() => editProgrammeMessage(message.id, { body: 'Changed my mind.' }))
      .toThrow(/Approved words are not edited/);
    expect(programmeMessage(message.id).body).toBe(message.body);
  });

  it('Q. there is no way back from reviewed, and no other state exists', () => {
    const message = generated();
    reviewProgrammeMessage(message.id, { operatorId: OPERATOR });

    // The column itself refuses anything outside the two states.
    for (const bad of ['superseded', 'queued', 'scheduled', 'sent', 'failed', 'draft']) {
      expect(() => db.prepare('UPDATE programme_messages SET state = ? WHERE id = ?')
        .run(bad, message.id), bad).toThrow(/CHECK constraint/);
    }
    expect(Object.values(MESSAGE_STATE)).toEqual(['generated', 'reviewed']);
  });

  /**
   * REVIEWED IS NOT SEND-APPROVED. It moves no campaign, no attempt, no
   * outreach and no budget, and it creates nothing that could be mistaken for
   * a queue. Asserted against the tables rather than against the sentence.
   */
  it('reviewing approves words and nothing else', () => {
    const { attempt, composition } = prepared();
    const { message } = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });
    const before = snapshot();

    reviewProgrammeMessage(message.id, { operatorId: OPERATOR });

    expect(snapshot()).toEqual(before);
    expect(rows('outreach')).toBe(0);
    expect(rows('outreach_send')).toBe(0);
    expect(rows('outbound_send_attempt')).toBe(0);
  });
});

/* ========================================================================== */
/* R–T — cascade and schema                                                    */
/* ========================================================================== */

describe('the message belongs to the attempt', () => {
  it('R. dies with the attempt it is the content of', () => {
    const { attempt, composition } = prepared();
    createProgrammeMessage({ programmeContactAttemptId: attempt.id, composition });
    expect(messages()).toHaveLength(1);

    db.prepare('DELETE FROM programme_contact_attempts WHERE id = ?').run(attempt.id);

    expect(messages()).toHaveLength(0);
  });

  it('R. and with the campaign, through the attempt', () => {
    const { c, attempt, composition } = prepared();
    createProgrammeMessage({ programmeContactAttemptId: attempt.id, composition });

    db.prepare('DELETE FROM programme_campaigns WHERE campaign_id = ?').run(c);

    expect(messages()).toHaveLength(0);
    expect(rows('programme_contact_attempts')).toBe(0);
  });

  it('R. refuses to let a coach be deleted out from under a written message', () => {
    const { coach, attempt, composition } = prepared();
    createProgrammeMessage({ programmeContactAttemptId: attempt.id, composition });

    expect(() => db.prepare('DELETE FROM coaches WHERE id = ?').run(coach))
      .toThrow(/FOREIGN KEY/);
  });

  /**
   * S + T. THE TABLE ARRIVES ON BOTH A FRESH DATABASE AND AN EXISTING ONE.
   *
   * `schema.sql` is executed in full on every boot and uses
   * CREATE TABLE IF NOT EXISTS, so a new table needs no migration — but that
   * is a claim about a mechanism, and this runs it: a database is built at an
   * OLD schema with no `programme_messages`, then the current schema is
   * applied over it exactly as `db/client.js` does.
   */
  it('S+T. is created on a fresh database and added to an existing one', () => {
    const schema = fs.readFileSync(
      path.resolve(process.cwd(), 'server/db/schema.sql'), 'utf-8',
    );
    const tmp = path.join(
      process.env.THRIV3_BUILD_DIR ?? '/tmp', `f10b2-${randomUUID().slice(0, 8)}.sqlite`,
    );
    fs.mkdirSync(path.dirname(tmp), { recursive: true });

    // --- an EXISTING database, at a schema that predates this table ---
    const old = schema.slice(0, schema.indexOf('CREATE TABLE IF NOT EXISTS programme_messages'));
    const existing = new Database(tmp);
    existing.pragma('foreign_keys = ON');
    existing.exec(old);
    existing.prepare(`
      INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
      VALUES ('keep', 'x', 'x', 'Kept Athlete', 'DEFENSE', 'mens-soccer')
    `).run();
    expect(existing.prepare(
      "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='programme_messages'",
    ).get().n).toBe(0);

    // --- the current schema, applied the way the client applies it ---
    existing.exec(schema);
    expect(existing.prepare(
      "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='programme_messages'",
    ).get().n).toBe(1);
    // Nothing that was there before was disturbed.
    expect(existing.prepare('SELECT full_name FROM players WHERE id = ?').get('keep').full_name)
      .toBe('Kept Athlete');
    // And running it again is safe, which is what every boot does.
    existing.exec(schema);
    expect(existing.prepare('SELECT COUNT(*) n FROM programme_messages').get().n).toBe(0);
    existing.close();

    // --- a FRESH database ---
    fs.rmSync(tmp, { force: true });
    const fresh = new Database(tmp);
    fresh.pragma('foreign_keys = ON');
    fresh.exec(schema);
    const cols = fresh.prepare('PRAGMA table_info(programme_messages)').all().map((c) => c.name);
    expect(cols).toContain('recipient_email');
    expect(cols).toContain('generated_body_hash');
    expect(cols).toContain('evidence_snapshot');
    fresh.close();
    fs.rmSync(tmp, { force: true });
  });
});

/* ========================================================================== */
/* U–W — the negative properties                                               */
/* ========================================================================== */

describe('writing a message touches one table, sends nothing and asks no model', () => {
  it('U. create, edit and review change only programme_messages', () => {
    const { attempt, composition } = prepared();
    const before = snapshot();

    const { message } = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });
    editProgrammeMessage(message.id, { body: 'Edited.' });
    reviewProgrammeMessage(message.id, { operatorId: OPERATOR });

    expect(snapshot()).toEqual(before);
    expect(messages()).toHaveLength(1);
  });

  it('U. the attempt it belongs to is not moved by any of them', () => {
    const { attempt, composition } = prepared();
    const attemptBefore = db.prepare('SELECT * FROM programme_contact_attempts WHERE id = ?')
      .get(attempt.id);

    const { message } = createProgrammeMessage({
      programmeContactAttemptId: attempt.id, composition,
    });
    editProgrammeMessage(message.id, { body: 'Edited.' });
    reviewProgrammeMessage(message.id, { operatorId: OPERATOR });

    expect(db.prepare('SELECT * FROM programme_contact_attempts WHERE id = ?').get(attempt.id))
      .toEqual(attemptBefore);
  });

  const codeOf = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('V. imports no transport, no mailbox and no execution', () => {
    const code = codeOf('./programmeMessages.js');
    for (const forbidden of [
      'outlook', 'applescript', 'nodemailer', 'googleapis', 'graph.microsoft', 'oauth',
      'connectedMailboxes', 'mailboxCrypto', 'outboundBudget', 'sendOutreach',
      'composeInOutlook', 'recordDraft', 'confirmSend', 'acceptSend', 'transitionSend',
      'createOutreach', 'recordOutboundAttempt', 'logEvidence',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('W. imports no model, and composes nothing itself', () => {
    const code = codeOf('./programmeMessages.js');
    for (const forbidden of [
      'anthropic', '@anthropic-ai', 'openai',
      'evidenceFor', 'selectEvidence', 'composeProgrammeMessage', 'composeMessage',
      'emailBodyFor', 'fillTemplate', 'outreachEvidenceFor', 'generateEvidence',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('writes to no table but its own', () => {
    const code = codeOf('./programmeMessages.js');
    const writes = [...code.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_]+)/gi)]
      .map((m) => m[1]);
    expect(new Set(writes)).toEqual(new Set(['programme_messages']));
  });
});
