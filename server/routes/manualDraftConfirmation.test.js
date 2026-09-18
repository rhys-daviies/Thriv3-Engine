import {
  describe, it, expect, beforeAll, beforeEach, vi,
} from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Intercepted, as every sibling send test does: what is under test is the
 * orchestration, not whether a compose window opens on whoever runs the suite.
 * The call log is also the proof that a refused request never reached Outlook.
 */
const composed = [];
vi.mock('../lib/outlook.js', () => ({
  isOutlookAvailable: () => true,
  composeInOutlook: vi.fn(async (message) => {
    composed.push(message);
    return { ok: true, sent: message.send };
  }),
}));

const db = (await import('../db/client.js')).default;
const { manualOutreachRouter } = await import('./manualOutreach.js');
const { programmeCoachesRouter } = await import('./programmeCoaches.js');
const { upsertAthleteProgramme, updateAthleteProgramme, findRelationship } = await import('../lib/athleteProgrammes.js');
const { sendsForOutreach, sendById, transitionSend } = await import('../lib/outreachSend.js');
const { createOutreach, revokeOutreach } = await import('../lib/outreach.js');
const { recordDraft } = await import('../lib/outreachSend.js');
const { findOrCreateCoach } = await import('../lib/coaches.js');
const { MESSAGE_STATE, ACCEPTED_SOURCE } = await import('../../shared/outreachMessageState.js');
const { OUTREACH_ORIGIN } = await import('../../shared/outreachOrigin.js');
const { PER_COACH_MAX_SENDS } = await import('../lib/config.js');

/**
 * F7b — THRIV3 DRAFTS, A PERSON SENDS, A PERSON SAYS SO.
 *
 * ===========================================================================
 * TWO PROPERTIES, AND THEY ARE OPPOSITE HALVES OF ONE RULE.
 *
 *   THRIV3 NEVER SENDS. `send: true` is refused outright rather than coerced,
 *   before a relationship exists, before capacity is reserved and before
 *   Outlook is touched. A caller who asked for a send and got a 200 would
 *   reasonably believe a coach had the email.
 *
 *   ONLY A PERSON CAN SAY IT WENT. AppleScript returns no message id and no
 *   handle, so there is nothing to poll and nothing to match on. A confirmation
 *   is an assertion, recorded as OPERATOR_ASSERTED, and it is the only thing
 *   that establishes manual_only and makes the campaign back off.
 * ===========================================================================
 *
 * The third property, quieter and just as load-bearing: a DRAFT still changes
 * no policy. Most of what follows is about what does NOT happen.
 */

const ATHLETE = 'a-f7b';
const OTHER_ATHLETE = 'a-f7b-other';
const SPORT = 'mens-soccer';
const DUKE = 'Duke';
const UNC = 'North Carolina';

let baseUrl;
let seq = 0;
let dukeRelationship;
let uncRelationship;
let headCoachId;
let asstCoachId;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', programmeCoachesRouter);
  app.use('/api', manualOutreachRouter);
  await new Promise((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.unref();
  });
});

const api = async (method, path, body) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const compose = (over = {}, relationship = dukeRelationship) => api(
  'POST', `/api/players/${ATHLETE}/programmes/${relationship}/outreach`,
  {
    coachIds: [headCoachId], subject: 'Subject', body: 'Body {{player_profile_url}}',
    greetingName: 'A Coach', ...over,
  },
);

const confirm = (sendId, relationship = dukeRelationship, athlete = ATHLETE) => api(
  'POST', `/api/players/${athlete}/programmes/${relationship}/outreach/${sendId}/confirm-sent`,
);
const discard = (sendId, relationship = dukeRelationship) => api(
  'POST', `/api/players/${ATHLETE}/programmes/${relationship}/outreach/${sendId}/discard`,
);
const pending = (athlete = ATHLETE) => api('GET', `/api/players/${athlete}/pending-manual-drafts`);

const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
const stance = (name = DUKE) => findRelationship(ATHLETE, name, SPORT)?.contact_stance ?? null;
const snapshotOf = (t) => JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all());

function athlete(id, name = 'Seam Athlete') {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug,
      recruiting_class_year, email, video_id)
    VALUES (?, 'x', 'x', ?, 'MIDFIELD', ?, ?, 2027, 'athlete@example.com', 'aqz-KE-bpKQ')
  `).run(id, name, SPORT, randomUUID().slice(0, 10));
}

function college(name) {
  const id = `col-f7b-${++seq}`;
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, active)
    VALUES (?, 'x', 'x', ?, ?, 'NCAA D1', 'ACC', 1)
  `).run(id, name, SPORT);
  return id;
}

const coachAt = (school, { name = 'A Coach', email } = {}) => findOrCreateCoach({
  full_name: name,
  email: email ?? `c-f7b-${++seq}@${school.toLowerCase().replace(/\W/g, '')}.edu`,
  school,
  sport: SPORT,
  division: 'NCAA D1',
  position_title: name.includes('Assistant') ? 'Assistant Coach' : 'Head Coach',
});

/** Somebody else's confirmed sends to one inbox, for the cap. */
function otherAthletesHaveWrittenTo(email, howMany) {
  for (let i = 0; i < howMany; i += 1) {
    const other = `a-f7b-cap-${++seq}`;
    athlete(other, `Other ${i}`);
    const c = findOrCreateCoach({
      full_name: 'Shared Inbox', email, school: `Elsewhere ${i}`, sport: SPORT,
      division: 'NCAA D1', position_title: 'Head Coach',
    });
    db.prepare(`
      INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, sent_at)
      VALUES (?, ?, ?, ?, 'x', ?)
    `).run(randomUUID(), other, c.id, randomUUID(), new Date().toISOString());
  }
}

/** A campaign-origin draft, written directly so no campaign machinery is touched. */
function campaignDraft() {
  const coach = coachAt(DUKE, { name: 'Campaign Coach' });
  const outreach = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
  const draft = recordDraft({
    outreachId: outreach.id, athleteId: ATHLETE, coachId: coach.id, collegeName: DUKE,
    sport: SPORT, evidence: null, body: 'hello', subject: 'hi',
    origin: OUTREACH_ORIGIN.CAMPAIGN,
  });
  return { outreach, draft };
}

beforeEach(() => {
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM athlete_programmes; DELETE FROM suppressions;
           DELETE FROM coaches; DELETE FROM colleges; DELETE FROM players;`);
  composed.length = 0;
  seq = 0;

  athlete(ATHLETE);
  athlete(OTHER_ATHLETE, 'Other Athlete');
  const dukeId = college(DUKE);
  const uncId = college(UNC);
  headCoachId = coachAt(DUKE, { name: 'Head Person' }).id;
  asstCoachId = coachAt(DUKE, { name: 'Assistant Person' }).id;
  coachAt(UNC, { name: 'Tar Coach' });

  dukeRelationship = upsertAthleteProgramme(ATHLETE, { college_id: dukeId }).programme.id;
  uncRelationship = upsertAthleteProgramme(ATHLETE, { college_id: uncId }).programme.id;
});

/* ========================================================================== */
/* A. Thriv3 never sends                                                       */
/* ========================================================================== */

describe('the route refuses to send', () => {
  it('names the refusal rather than quietly drafting instead', async () => {
    const { status, body } = await compose({ send: true });

    expect(status).toBe(422);
    expect(body.code).toBe('MANUAL_OUTREACH_DRAFT_ONLY');
    expect(body.error).toMatch(/does not send individual outreach for you/i);
  });

  /**
   * COERCION WOULD BE WORSE THAN REFUSAL. A caller who asked for a send and
   * received a 200 describing a draft would reasonably believe the coach has
   * the email.
   */
  it('writes nothing at all', async () => {
    await compose({ send: true });

    expect(count('outreach')).toBe(0);
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
    expect(count('outreach_evidence')).toBe(0);
    expect(stance()).toBe('default');
  });

  it('never reaches Outlook', async () => {
    await compose({ send: true });
    expect(composed).toHaveLength(0);
  });

  it('refuses before anything else can object, so the reason is never masked', async () => {
    // Suppressed recipient AND send:true. The draft-only rule answers first,
    // because it is a fact about the request rather than about the world.
    db.prepare(`INSERT INTO suppressions (email, created_at, reason, source)
                VALUES (?, 'x', 'unsubscribed', 'manual')`)
      .run(db.prepare('SELECT email FROM coaches WHERE id = ?').get(headCoachId).email);

    const { body } = await compose({ send: true });
    expect(body.code).toBe('MANUAL_OUTREACH_DRAFT_ONLY');
  });
});

/* ========================================================================== */
/* B. A draft is still a draft                                                 */
/* ========================================================================== */

describe('creating a draft', () => {
  it('works, and hands Outlook a draft rather than a send', async () => {
    const { status, body } = await compose();

    expect(status).toBe(200);
    expect(body.results[0].status).toBe('drafted');
    expect(composed).toHaveLength(1);
    expect(composed[0].send).toBe(false);
  });

  it('records the message as a manual draft and nothing more', async () => {
    await compose();

    const row = db.prepare('SELECT * FROM outreach_send').get();
    expect(row.state).toBe(MESSAGE_STATE.DRAFT);
    expect(row.origin).toBe(OUTREACH_ORIGIN.MANUAL);
    expect(row.sent_at).toBeNull();
    expect(row.accepted_source).toBeNull();
    expect(db.prepare('SELECT sent_at FROM outreach').get().sent_at).toBeNull();
  });

  it('changes no contact policy — a draft is not contact', async () => {
    await compose();
    expect(stance()).toBe('default');
  });
});

/* ========================================================================== */
/* B2. The cap, moved to draft time                                            */
/* ========================================================================== */

describe('the recipient cap, at the last moment Thriv3 controls anything', () => {
  const headEmail = () => db.prepare('SELECT email FROM coaches WHERE id = ?').get(headCoachId).email;

  it('refuses a draft to an inbox that has had enough, before Outlook', async () => {
    otherAthletesHaveWrittenTo(headEmail(), PER_COACH_MAX_SENDS);

    const { status, body } = await compose();

    expect(status).toBe(422);
    expect(body.code).toBe('RECIPIENT_SEND_CAP_REACHED');
    expect(body.capped[0].recentSends).toBe(PER_COACH_MAX_SENDS);
    expect(composed).toHaveLength(0);
    expect(count('outreach_send')).toBe(0);
  });

  it('drafts to the coaches who are under it and names the one who is not', async () => {
    otherAthletesHaveWrittenTo(headEmail(), PER_COACH_MAX_SENDS);

    const { status, body } = await compose({ coachIds: [headCoachId, asstCoachId] });

    expect(status).toBe(200);
    expect(body.capped).toHaveLength(1);
    expect(body.results).toHaveLength(1);
    expect(composed).toHaveLength(1);
    expect(composed[0].to).not.toBe(headEmail());
  });

  it('lets a draft through below the cap', async () => {
    otherAthletesHaveWrittenTo(headEmail(), PER_COACH_MAX_SENDS - 1);
    const { status } = await compose();
    expect(status).toBe(200);
  });
});

/* ========================================================================== */
/* C. The confirmation                                                         */
/* ========================================================================== */

async function draftOne(relationship = dukeRelationship, coachIds = [headCoachId]) {
  await compose({ coachIds }, relationship);
  return db.prepare('SELECT * FROM outreach_send ORDER BY drafted_at DESC, id DESC').get();
}

describe('a person says they sent it', () => {
  it('accepts that exact message, as an assertion', async () => {
    const draft = await draftOne();

    const { status, body } = await confirm(draft.id);

    expect(status).toBe(200);
    expect(body.send.state).toBe(MESSAGE_STATE.ACCEPTED);
    expect(body.send.accepted_source).toBe(ACCEPTED_SOURCE.OPERATOR_ASSERTED);
  });

  /**
   * NEVER "verified", "detected" or "delivered". Thriv3 has no evidence of a
   * send — AppleScript hands back no message id — and the weakest of the four
   * accepted-sources is the honest one.
   */
  it('claims no observation anywhere in its answer', async () => {
    const draft = await draftOne();
    const { body } = await confirm(draft.id);

    expect(JSON.stringify(body)).not.toMatch(/verified|detected|delivered/i);
    expect(body.send.accepted_source).not.toBe(ACCEPTED_SOURCE.PROVIDER_ACCEPTED);
    expect(body.send.accepted_source).not.toBe(ACCEPTED_SOURCE.OUTLOOK_COMMAND_ASSERTED);
  });

  it('dates the relationship first-wins', async () => {
    const draft = await draftOne();
    await confirm(draft.id);

    const sentAt = db.prepare('SELECT sent_at FROM outreach WHERE id = ?').get(draft.outreach_id).sent_at;
    expect(sentAt).toBeTruthy();
  });

  it('establishes manual_only, so the campaign backs off', async () => {
    const draft = await draftOne();
    expect(stance()).toBe('default');

    const { body } = await confirm(draft.id);

    expect(stance()).toBe('manual_only');
    expect(body.contactStance.outcome).toBe('ESTABLISHED');
  });

  it('keeps the manual origin', async () => {
    const draft = await draftOne();
    await confirm(draft.id);
    expect(sendById(draft.id).origin).toBe(OUTREACH_ORIGIN.MANUAL);
  });

  it('records the mailbox attempt', async () => {
    const draft = await draftOne();
    const before = count('outbound_send_attempt');
    await confirm(draft.id);
    expect(count('outbound_send_attempt')).toBeGreaterThan(before);
  });

  it('never downgrades do_not_contact', async () => {
    const draft = await draftOne();
    updateAthleteProgramme(ATHLETE, dukeRelationship, { contact_stance: 'do_not_contact' });

    await confirm(draft.id);

    expect(stance()).toBe('do_not_contact');
  });

  it('is refused on replay, and changes nothing the second time', async () => {
    const draft = await draftOne();
    await confirm(draft.id);
    const after = JSON.stringify(sendById(draft.id));

    const second = await confirm(draft.id);

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('NOT_AWAITING_CONFIRMATION');
    expect(JSON.stringify(sendById(draft.id))).toBe(after);
  });
});

describe('a valid id is not an entitlement', () => {
  it('refuses a message belonging to another programme', async () => {
    const duke = await draftOne();

    const { status, body } = await confirm(duke.id, uncRelationship);

    expect(status).toBe(404);
    expect(body.code).toBe('SEND_NOT_FOR_RELATIONSHIP');
    expect(sendById(duke.id).state).toBe(MESSAGE_STATE.DRAFT);
  });

  it('refuses a message belonging to another athlete', async () => {
    const duke = await draftOne();
    const theirs = upsertAthleteProgramme(OTHER_ATHLETE, {
      college_id: db.prepare('SELECT id FROM colleges WHERE name = ?').get(DUKE).id,
    }).programme.id;

    const { status } = await confirm(duke.id, theirs, OTHER_ATHLETE);

    expect(status).toBe(404);
    expect(sendById(duke.id).state).toBe(MESSAGE_STATE.DRAFT);
  });

  it('refuses a message that does not exist', async () => {
    const { status, body } = await confirm(randomUUID());
    expect(status).toBe(404);
    expect(body.code).toBe('SEND_NOT_FOUND');
  });

  /**
   * THE CAMPAIGN OWNS ITS OWN ACCEPTANCE. An operator screen that could mark a
   * campaign message sent would put OPERATOR_ASSERTED on a message a provider
   * is going to answer for, and would let one workstream write another's truth.
   */
  it('refuses a campaign-origin message outright', async () => {
    const { draft } = campaignDraft();

    const { status, body } = await confirm(draft.id);

    expect(status).toBe(422);
    expect(body.code).toBe('NOT_A_MANUAL_MESSAGE');
    expect(sendById(draft.id).state).toBe(MESSAGE_STATE.DRAFT);
    expect(stance()).toBe('default');
  });

  it('refuses a revoked relationship', async () => {
    const draft = await draftOne();
    revokeOutreach(draft.outreach_id);

    const { status, body } = await confirm(draft.id);

    expect(status).toBe(422);
    expect(body.code).toBe('OUTREACH_REVOKED');
    expect(sendById(draft.id).state).toBe(MESSAGE_STATE.DRAFT);
  });

  /**
   * THE REASON THIS TAKES A SEND ID RATHER THAN A RELATIONSHIP ID. `recordDraft`
   * replaces an open draft in place, so re-composing to the same coach reuses
   * the row — but an operator holding a stale id from a previous render must
   * not be able to confirm something other than what they were shown.
   */
  it('cannot be aimed at a message in a state a person may not resolve', async () => {
    const draft = await draftOne();
    transitionSend(draft.id, MESSAGE_STATE.SENDING);

    const { status, body } = await confirm(draft.id);

    expect(status).toBe(409);
    expect(body.code).toBe('NOT_AWAITING_CONFIRMATION');
  });
});

/* ========================================================================== */
/* D. Discard                                                                  */
/* ========================================================================== */

describe('a draft that was never sent', () => {
  it('becomes CANCELLED, which is the state the machine already had for it', async () => {
    const draft = await draftOne();

    const { status, body } = await discard(draft.id);

    expect(status).toBe(200);
    expect(body.send.state).toBe(MESSAGE_STATE.CANCELLED);
  });

  it('marks nothing sent and establishes no policy', async () => {
    const draft = await draftOne();
    await discard(draft.id);

    expect(sendById(draft.id).sent_at).toBeNull();
    expect(sendById(draft.id).accepted_source).toBeNull();
    expect(db.prepare('SELECT sent_at FROM outreach WHERE id = ?').get(draft.outreach_id).sent_at)
      .toBeNull();
    expect(stance()).toBe('default');
  });

  /** What Thriv3 composed stays answerable for ever. Only the pending claim goes. */
  it('keeps the historical row, its subject and its evidence', async () => {
    const draft = await draftOne();
    const before = { subject: draft.subject, hash: draft.body_hash, coach: draft.coach_id };

    await discard(draft.id);

    const after = sendById(draft.id);
    expect(after.subject).toBe(before.subject);
    expect(after.body_hash).toBe(before.hash);
    expect(after.coach_id).toBe(before.coach);
    expect(count('outreach')).toBe(1);
    expect(count('outreach_send')).toBe(1);
  });

  it('touches no other draft', async () => {
    const duke = await draftOne();
    const unc = await draftOne(uncRelationship,
      [db.prepare('SELECT id FROM coaches WHERE school = ?').get(UNC).id]);

    await discard(duke.id);

    expect(sendById(unc.id).state).toBe(MESSAGE_STATE.DRAFT);
  });

  it('frees the relationship to hold a new draft', async () => {
    const first = await draftOne();
    await discard(first.id);

    const { status } = await compose();

    expect(status).toBe(200);
    expect(sendsForOutreach(first.outreach_id)).toHaveLength(2);
  });

  it('refuses a campaign message, like the confirmation does', async () => {
    const { draft } = campaignDraft();
    const { status, body } = await discard(draft.id);
    expect(status).toBe(422);
    expect(body.code).toBe('NOT_A_MANUAL_MESSAGE');
  });
});

/* ========================================================================== */
/* E. What is waiting                                                          */
/* ========================================================================== */

describe('the pending list', () => {
  it('is one athlete-level read carrying what a row needs', async () => {
    const draft = await draftOne();

    const { status, body } = await pending();

    expect(status).toBe(200);
    expect(body.drafts).toHaveLength(1);
    expect(body.drafts[0]).toMatchObject({
      send_id: draft.id,
      college_name: DUKE,
      sport: SPORT,
      coach_name: 'Head Person',
      position_title: 'Head Coach',
      state: MESSAGE_STATE.DRAFT,
      origin: OUTREACH_ORIGIN.MANUAL,
    });
    expect(body.drafts[0].drafted_at).toBeTruthy();
  });

  it('covers every programme in one call, so a list does not ask per card', async () => {
    await draftOne();
    await draftOne(uncRelationship,
      [db.prepare('SELECT id FROM coaches WHERE school = ?').get(UNC).id]);

    const { body } = await pending();

    expect(body.drafts.map((d) => d.college_name).sort()).toEqual([DUKE, UNC]);
  });

  it('drops a message once it is confirmed', async () => {
    const draft = await draftOne();
    await confirm(draft.id);
    expect((await pending()).body.drafts).toHaveLength(0);
  });

  it('drops a message once it is discarded', async () => {
    const draft = await draftOne();
    await discard(draft.id);
    expect((await pending()).body.drafts).toHaveLength(0);
  });

  it('never lists a campaign draft, because no operator confirms one by hand', async () => {
    campaignDraft();
    expect((await pending()).body.drafts).toHaveLength(0);
  });

  it('never lists a revoked relationship', async () => {
    const draft = await draftOne();
    revokeOutreach(draft.outreach_id);
    expect((await pending()).body.drafts).toHaveLength(0);
  });

  it('is scoped to the athlete asked about', async () => {
    await draftOne();
    expect((await pending(OTHER_ATHLETE)).body.drafts).toHaveLength(0);
  });
});

/* ========================================================================== */
/* F. What this slice must not have moved                                      */
/* ========================================================================== */

describe('the shared send path is untouched', () => {
  const source = (rel) => {
    const fs = require('node:fs');
    return fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  };

  /**
   * `sendOutreach` is the one function every path to a coach's inbox passes
   * through — this route, the Top 100 composer, the bulk composer and the
   * drafting CLI. Its ability to send is what those other callers rely on, and
   * F7b gives it up for ONE surface rather than removing it.
   */
  it('still accepts send: true, for the callers that still send', () => {
    const src = source('./sendOutreach.js');
    expect(src).toContain('send');
    expect(src).toMatch(/composeInOutlook\(/);
    // The cap check that belongs to the sending callers stays where it was.
    expect(src).toMatch(/send && isSendCapped/);
  });

  it('is not where the manual confirmation lives', () => {
    const src = source('./sendOutreach.js');
    expect(src).not.toContain('confirmManualDraftSent');
    expect(src).not.toContain('manualDraftConfirmation');
    expect(src).not.toContain('establishManualOnly');
  });

  it('keeps the confirmation out of campaign and intelligence modules', () => {
    const src = source('../lib/manualDraftConfirmation.js');
    for (const forbidden of [
      'campaignAttribution', 'campaignExecution', 'pursuitPolicy', 'executionClaim',
      'executeProgrammeMessage', 'executionRetry', 'executionResult', 'googleTransport',
      'contactIntelligence', 'programmeContactHistory', 'programme_messages',
    ]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });

  it('adds no new relationship writer', () => {
    const src = source('../lib/manualDraftConfirmation.js');
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(src).toContain('establishManualOnlyForConfirmedSend');
  });
});

/* ========================================================================== */
/* G. The whole journey                                                        */
/* ========================================================================== */

describe('draft, send by hand, confirm', () => {
  it('leaves exactly the history F6 renders', async () => {
    const draft = await draftOne();

    // Before: drafted, nothing sent, campaign still free.
    expect(sendById(draft.id).state).toBe(MESSAGE_STATE.DRAFT);
    expect(stance()).toBe('default');
    expect((await pending()).body.drafts).toHaveLength(1);

    // The operator sends in Outlook, returns, and says so.
    await confirm(draft.id);

    const after = sendById(draft.id);
    expect(after.state).toBe(MESSAGE_STATE.ACCEPTED);
    expect(after.accepted_source).toBe(ACCEPTED_SOURCE.OPERATOR_ASSERTED);
    expect(after.origin).toBe(OUTREACH_ORIGIN.MANUAL);
    expect(db.prepare('SELECT sent_at FROM outreach WHERE id = ?').get(draft.outreach_id).sent_at)
      .toBeTruthy();
    expect(stance()).toBe('manual_only');
    expect((await pending()).body.drafts).toHaveLength(0);
  });

  it('and a discarded one leaves history without contact', async () => {
    const draft = await draftOne();
    const relationships = snapshotOf('athlete_programmes');

    await discard(draft.id);

    expect(sendById(draft.id).state).toBe(MESSAGE_STATE.CANCELLED);
    expect(snapshotOf('athlete_programmes')).toBe(relationships);
  });
});
