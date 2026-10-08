import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { randomUUID, createHash } from 'node:crypto';
import db from '../db/client.js';
import { corroborateFixtureCoaches } from '../testCanonicalCoaches.js';

/**
 * PHASE 8A FLOOR, AT THE MOMENT OF SENDING — what the operator's request gets back.
 *
 * ===========================================================================
 * THE FLOOR IS CHECKED TWICE ON THE WAY TO A SEND (VERIFIED address AND not PROVEN_STALE):
 *
 *   1. the claim recomputes the pursuit plan, which applies the floor to the programme's staff.
 *      An ineligible coach is simply not the plan's current action, so an ordinary request is
 *      refused with NO_ACTION_TO_EXECUTE (422) before anything else — covered in the first block.
 *   2. only then does executionClaim re-check THIS coach's own row and refuse with
 *      COACH_NOT_OUTREACH_ELIGIBLE. It is defense in depth: ordinary state never reaches it,
 *      because (1) reads the same rows through the same function and runs first.
 *
 * (2) threw a code the route's status table did not know, so if it ever fired the request
 * would have come back as a generic 500 ("Unexpected error.") with the reason only in the
 * server log. The second block reaches it deliberately and pins the corrected behaviour: 422,
 * the structured code, and — the part that matters more — that a refusal leaves nothing behind.
 *
 * HOW (2) IS REACHED. coachIneligibility is wrapped so the PLAN'S staff rows (SELECT * FROM
 * coaches: they carry position_title) pass and the claim's own narrow row (id, name, email,
 * school, sport, email_status, currentness_status) is judged by the real function. That is
 * exactly the one situation the two checks can disagree: the plan still names the coach.
 *
 * THRIV3_ALLOW_LEGACY_COACHES=1 IS AN EXPLICIT COMPATIBILITY / DIAGNOSTIC OVERRIDE, NOT A NORMAL PRODUCTION
 * SETTING. The floor is default ON and stays so; the override exists for suites that model pre-8A
 * outreach and for a deliberate, recorded operator decision. The last block pins that it is the only
 * way past the floor and that falsy or unrecognised values are not one.
 *
 * THE FLOOR IS ON IN THIS FILE. Unlike executionApi.test.js it does NOT opt into
 * THRIV3_ALLOW_LEGACY_COACHES at module level; the one test that wants the
 * override sets it explicitly and removes it again.
 *
 * NOTHING HERE SENDS AN EMAIL. The transport is the fake one, mocked at its own
 * module exactly as executionApi.test.js does.
 * ===========================================================================
 */
delete process.env.THRIV3_ALLOW_LEGACY_COACHES;

const { transportBehaviour } = vi.hoisted(() => ({
  transportBehaviour: { current: null, calls: [] },
}));

vi.mock('../lib/productionTransport.js', async () => {
  const { fakeTransport } = await import('../lib/outboundTransport.js');
  return {
    productionTransport() {
      if (!transportBehaviour.current) return null;
      const inner = fakeTransport(transportBehaviour.current);
      return {
        ...inner,
        async send(request) {
          transportBehaviour.calls.push({ ...request });
          return inner.send(request);
        },
      };
    },
  };
});

const { planBlind } = vi.hoisted(() => ({ planBlind: { on: false } }));
vi.mock('../lib/coachEligibility.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    // every outreach path now reads the floor through outreachIneligibility (coach floor + canonical decision)
    outreachIneligibility(row, opts) {
      // plan rows are `SELECT * FROM coaches` and carry position_title; the claim's row does not
      if (planBlind.on && row && 'position_title' in row) return null;
      return real.outreachIneligibility(row, opts);
    },
  };
});

const { campaignsRouter } = await import('./campaigns.js');
const { CLAIM_REFUSAL } = await import('../lib/executionClaim.js');
const { materialiseNextContactAttempt } = await import('../lib/pursuitPolicy.js');
const { attemptForCoach } = await import('../lib/contactAttempts.js');
const { reviewProgrammeMessage, programmeMessage } = await import('../lib/programmeMessages.js');
const { generateProgrammeMessage } = await import('../lib/programmeMessageGeneration.js');
const { TRANSPORT_OUTCOME } = await import('../lib/outboundTransport.js');
const { createConnectedMailbox, storeMailboxCredential } = await import('../lib/connectedMailboxes.js');

const ATHLETE = 'a-coachrefusal';
const OPERATOR = 'op-coachrefusal';
const COLLEGE = 'Duke';
const SPORT = 'mens-soccer';
let baseUrl;
let seq = 0;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.operator = { id: OPERATOR, email: `${OPERATOR}@t.test` }; next(); });
  app.use('/api', campaignsRouter);
  await new Promise((resolve) => {
    const server = app.listen(0, () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
    server.unref();
  });
});

const send = async (id, body) => {
  const res = await fetch(`${baseUrl}/api/programme-messages/${id}/send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
};

function seedWorld() {
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug,
      nationality, recruiting_class_year, gpa) VALUES (?, 'x', 'x', 'Marcus Reyes', 'DEFENSE', 'mens-soccer', ?, 'New Zealand', 2027, 3.8)`)
    .run(ATHLETE, randomUUID().slice(0, 10));
  db.prepare(`INSERT INTO operator_users (id, email, password_hash, active, created_at) VALUES (?, ?, 'scrypt$fake', 1, 'x')`)
    .run(OPERATOR, `${OPERATOR}@thriv3.test`);
  db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference) VALUES (?, 'x', 'x', ?, ?, 'NCAA D1', 'ACC')`)
    .run(randomUUID(), COLLEGE, SPORT);
  for (const [name, season] of [['Hayden Aish', '2024'], ['Jack Kelly', '2023']]) {
    db.prepare(`INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division,
        season, player_name, position, nationality, country, class_year_label, minutes_played, games_played)
      VALUES (?, 'x', 'x', ?, ?, 'NCAA D1', ?, ?, 'DEFENSE', 'International', 'New Zealand', 'Junior', 900, 18)`)
      .run(randomUUID(), COLLEGE, SPORT, season, name);
  }
}

function mailbox() {
  const box = createConnectedMailbox({
    operatorUserId: OPERATOR, athleteId: ATHLETE, provider: 'GOOGLE',
    providerAccountId: randomUUID(), emailAddress: `mb${++seq}@example.com`,
  });
  storeMailboxCredential(box.id, { refreshToken: `rt-${seq}`, operatorUserId: OPERATOR });
  return box.id;
}

/** A reviewed message for a coach who MEETS the floor when it is approved — the state a send starts from. */
function approvedForVerifiedCoach({ coachId: fixedId = null } = {}) {
  const c = `camp-${++seq}`;
  db.prepare(`INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at, snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', 'active', '2020-01-01', 'x', 'x', 'x', 1)`).run(c, ATHLETE);
  const pc = `pc-${++seq}`;
  db.prepare(`INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score, tier, tier_source, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 82, 'A', 'AUTO', 'queued', 'x', 'x')`).run(pc, c, COLLEGE, SPORT, ++seq);
  const coachId = fixedId || randomUUID();
  db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status)
    VALUES (?, 'x', ?, ?, ?, 'NCAA D1', ?, 'Head Coach', 'verified')`).run(coachId, `Coach ${++seq}`, `k${seq}@duke.edu`, COLLEGE, SPORT);
  corroborateFixtureCoaches(db, { ids: [coachId] });
  materialiseNextContactAttempt({ programmeCampaignId: pc });
  const { message } = generateProgrammeMessage({ programmeCampaignId: pc, coachId });
  reviewProgrammeMessage(message.id, { operatorId: OPERATOR });
  const row = programmeMessage(message.id);
  return { pc, coachId, messageId: row.id, bodyHash: row.body_hash };
}

const setCoach = (id, { email_status, currentness_status }) =>
  db.prepare('UPDATE coaches SET email_status = ?, currentness_status = ? WHERE id = ?').run(email_status, currentness_status ?? null, id);
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

/** Everything a send would create or change, in one comparable value. */
function durable({ pc, coachId, messageId }) {
  return {
    outreach_send: count('outreach_send'), outbound_send_attempt: count('outbound_send_attempt'), outreach_send_event: count('outreach_send_event'),
    attempt: attemptForCoach(pc, coachId), message: programmeMessage(messageId),
  };
}

beforeEach(() => {
  planBlind.on = false;
  delete process.env.THRIV3_ALLOW_LEGACY_COACHES;
  transportBehaviour.current = { outcome: TRANSPORT_OUTCOME.ACCEPTED };
  transportBehaviour.calls = [];
  db.exec(`DELETE FROM programme_messages; DELETE FROM campaign_first_touch_approvals;
           DELETE FROM outbound_send_attempt; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach_send_event; DELETE FROM outreach_send;
           DELETE FROM engagement_rollup; DELETE FROM tracking_events;
           DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes;
           DELETE FROM connected_mailbox_credentials; DELETE FROM connected_mailboxes;
           DELETE FROM coach_email_absence_observations; DELETE FROM coach_seasons;
           DELETE FROM coaches; DELETE FROM colleges; DELETE FROM roster_players;
           DELETE FROM suppressions; DELETE FROM operator_users; DELETE FROM players;`);
  seq = 0;
  seedWorld();
});
afterEach(() => { delete process.env.THRIV3_ALLOW_LEGACY_COACHES; });

describe('ordinary flow: the plan refuses an ineligible coach first (already 422, unchanged)', () => {
  it('a coach who stops being eligible after approval is refused 422 NO_ACTION_TO_EXECUTE and nothing is created', async () => {
    const m = approvedForVerifiedCoach();
    const before = durable(m);
    setCoach(m.coachId, { email_status: 'inferred' });

    const res = await send(m.messageId, { bodyHash: m.bodyHash, connectedMailboxId: mailbox() });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NO_ACTION_TO_EXECUTE');
    expect(durable(m)).toEqual(before);
    expect(transportBehaviour.calls).toHaveLength(0);
  });
});

describe('claim-time floor, reached when the plan still names the coach', () => {
  beforeEach(() => { planBlind.on = true; });

  it('is refused with 422 and the structured code, not a generic 500', async () => {
    const m = approvedForVerifiedCoach();
    setCoach(m.coachId, { email_status: 'inferred' });

    const res = await send(m.messageId, { bodyHash: m.bodyHash, connectedMailboxId: mailbox() });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe(CLAIM_REFUSAL.COACH_NOT_OUTREACH_ELIGIBLE);
    expect(res.body.code).toBe('COACH_NOT_OUTREACH_ELIGIBLE');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error).not.toBe('Unexpected error.');
  });

  it('creates no claim, send, event or attempt change, and never reaches the transport', async () => {
    const m = approvedForVerifiedCoach();
    const before = durable(m);
    setCoach(m.coachId, { email_status: 'inferred' });

    const res = await send(m.messageId, { bodyHash: m.bodyHash, connectedMailboxId: mailbox() });

    expect(res.status).toBe(422);
    expect(durable(m)).toEqual(before);
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
    expect(count('outreach_send_event')).toBe(0);
    expect(transportBehaviour.calls).toHaveLength(0);
  });

  it('is also refused when the coach is PROVEN_STALE, even with a verified address', async () => {
    const m = approvedForVerifiedCoach();
    setCoach(m.coachId, { email_status: 'verified', currentness_status: 'PROVEN_STALE' });

    const res = await send(m.messageId, { bodyHash: m.bodyHash, connectedMailboxId: mailbox() });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('COACH_NOT_OUTREACH_ELIGIBLE');
    expect(count('outreach_send')).toBe(0);
  });

  it('uses no sending capacity: after the coach is eligible again the same message sends exactly once', async () => {
    const m = approvedForVerifiedCoach();
    const mb = mailbox();
    setCoach(m.coachId, { email_status: 'generic' });
    expect((await send(m.messageId, { bodyHash: m.bodyHash, connectedMailboxId: mb })).status).toBe(422);
    expect((await send(m.messageId, { bodyHash: m.bodyHash, connectedMailboxId: mb })).status).toBe(422);
    expect(count('outreach_send')).toBe(0);

    setCoach(m.coachId, { email_status: 'verified' });
    const ok = await send(m.messageId, { bodyHash: m.bodyHash, connectedMailboxId: mb });

    expect(ok.status).toBe(200);
    expect(ok.body.state).toBe('ACCEPTED');
    expect(count('outreach_send')).toBe(1);          // the two refusals took nothing
    expect(count('outbound_send_attempt')).toBe(1);
    expect(transportBehaviour.calls).toHaveLength(1);
  });

  it('keeps the floor exactly as written: only a VERIFIED address passes (nothing broadened)', async () => {
    const m = approvedForVerifiedCoach();           // one unsent message, re-judged under each status
    const mb = mailbox();
    for (const status of ['inferred', 'generic', 'unknown', null]) {
      setCoach(m.coachId, { email_status: status });
      const res = await send(m.messageId, { bodyHash: m.bodyHash, connectedMailboxId: mb });
      expect(res.status, `email_status=${status}`).toBe(422);
      expect(res.body.code).toBe('COACH_NOT_OUTREACH_ELIGIBLE');
    }
    expect(count('outreach_send')).toBe(0);
  });
});

describe('an eligible coach is unaffected', () => {
  it('a verified, current coach sends and is recorded exactly as before', async () => {
    const m = approvedForVerifiedCoach();

    const res = await send(m.messageId, { bodyHash: m.bodyHash, connectedMailboxId: mailbox() });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('ACCEPTED');
    expect(count('outreach_send')).toBe(1);
    expect(transportBehaviour.calls).toHaveLength(1);
    expect(attemptForCoach(m.pc, m.coachId)).toMatchObject({ state: 'active', step: 2 });
  });
});

describe('THRIV3_ALLOW_LEGACY_COACHES never reaches send time', () => {
  beforeEach(() => { planBlind.on = true; });   // isolate the claim-time check, as in the block above

  /**
   * THE INVARIANT: no operator flag may bypass eligibility at the moment of sending. The legacy
   * opt-in once let an unverified coach be claimed and sent (pre-8A); it now widens only what is
   * offered, and the claim applies the full floor whatever it is set to.
   */
  it('=1 does NOT let an unverified coach be claimed or sent', async () => {
    const m = approvedForVerifiedCoach();
    const before = durable(m);
    setCoach(m.coachId, { email_status: 'inferred' });
    process.env.THRIV3_ALLOW_LEGACY_COACHES = '1';

    const res = await send(m.messageId, { bodyHash: m.bodyHash, connectedMailboxId: mailbox() });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('COACH_NOT_OUTREACH_ELIGIBLE');
    expect(durable(m)).toEqual(before);
    expect(count('outreach_send')).toBe(0);
    expect(transportBehaviour.calls).toHaveLength(0);
  });

  it('=1 does NOT let a canonically ineligible (uncorroborated) coach with a verified address be sent', async () => {
    const m = approvedForVerifiedCoach();
    db.prepare('DELETE FROM coach_seasons WHERE lower(coach_name) = lower((SELECT full_name FROM coaches WHERE id = ?))').run(m.coachId);
    process.env.THRIV3_ALLOW_LEGACY_COACHES = '1';

    const res = await send(m.messageId, { bodyHash: m.bodyHash, connectedMailboxId: mailbox() });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('COACH_NOT_CANONICALLY_ELIGIBLE');
    expect(count('outreach_send')).toBe(0);
    expect(transportBehaviour.calls).toHaveLength(0);
  });

  it('every value of the flag gives the same refusal', async () => {
    const m = approvedForVerifiedCoach();
    const mb = mailbox();
    setCoach(m.coachId, { email_status: 'inferred' });
    for (const value of [undefined, '0', 'no', 'off', '', '1', 'true', 'yes', 'on']) {
      if (value === undefined) delete process.env.THRIV3_ALLOW_LEGACY_COACHES; else process.env.THRIV3_ALLOW_LEGACY_COACHES = value;

      const res = await send(m.messageId, { bodyHash: m.bodyHash, connectedMailboxId: mb });

      expect(res.status, `THRIV3_ALLOW_LEGACY_COACHES=${JSON.stringify(value)}`).toBe(422);
      expect(res.body.code).toBe('COACH_NOT_OUTREACH_ELIGIBLE');
    }
    expect(count('outreach_send')).toBe(0);
  });
});

/**
 * PHASE 1G-D CLOSE-OUT — the canonical decision and the activation holds at send time. A message
 * approved while its coach was eligible is refused if, by the time it is sent, the coach's recorded
 * address has been found POSITIVELY ABSENT from their official page (the Brosnihan case) or the coach
 * is under an activation hold — by the plan, and, where the plan still names the coach, by the claim.
 */
describe('send-time canonical decision: eligible when approved, not when sent', () => {
  const UNITID = 990001;
  function recordAbsence(coachId) {
    db.prepare('UPDATE colleges SET unitid = ? WHERE name = ? AND sport = ?').run(UNITID, COLLEGE, SPORT);
    const c = db.prepare('SELECT * FROM coaches WHERE id = ?').get(coachId);
    const src = 'https://goduke.example/sports/mens-soccer/coaches';
    const sha = createHash('sha256').update(`page-${coachId}`).digest('hex');
    db.prepare(`INSERT INTO coach_email_absence_observations (observation_id, coach_id, email, observed_at, page_season, source_url, source_host, page_unitid, page_sport,
        parser_version, evidence_sha256, parse_status, staff_records, emails_published, coach_name_found, coach_email_found, other_email_for_coach, fixture_hash, action_id, recorded_at)
      VALUES (?, ?, ?, '2026-10-01T12:00:00.000Z', 2026, ?, 'goduke.example', ?, ?, 'sidearm-staff-2', ?, 'COMPLETE', 4, 3, 1, 0, NULL, 'test-fixture', 'test-action', 'x')`)
      .run(createHash('sha256').update(`${coachId}|${src}`).digest('hex'), coachId, c.email.toLowerCase(), src, UNITID, SPORT, sha);
  }

  it('the plan refuses once the address is found positively absent; nothing is created, nothing sent', async () => {
    const m = approvedForVerifiedCoach();
    const before = durable(m);
    recordAbsence(m.coachId);
    const res = await send(m.messageId, { bodyHash: m.bodyHash, connectedMailboxId: mailbox() });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NO_ACTION_TO_EXECUTE');
    expect(durable(m)).toEqual(before);
    expect(transportBehaviour.calls).toHaveLength(0);
  });

  it('where the plan still names the coach, the CLAIM refuses with the reason, before any capacity is spent', async () => {
    const m = approvedForVerifiedCoach();
    const before = durable(m);
    recordAbsence(m.coachId);
    planBlind.on = true;
    const res = await send(m.messageId, { bodyHash: m.bodyHash, connectedMailboxId: mailbox() });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(CLAIM_REFUSAL.COACH_NOT_OUTREACH_ELIGIBLE);
    expect(res.body.error).toContain('COACH_EMAIL_POSITIVELY_ABSENT');
    expect(durable(m)).toEqual(before);
    expect(count('outreach_send')).toBe(0);
    expect(transportBehaviour.calls).toHaveLength(0);
  });

  it('a message prepared for a coach now under an activation hold is refused at claim time, even under the legacy opt-in', async () => {
    const held = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../data/seeds/coach_activation_holds.json'), 'utf8'))
      .holds.find((h) => h.hold === 'PENDING_SEND_TIME_VERIFICATION').coach_id;
    planBlind.on = true;                                  // the message was prepared before the hold existed
    const m = approvedForVerifiedCoach({ coachId: held });
    const before = durable(m);
    process.env.THRIV3_ALLOW_LEGACY_COACHES = '1';
    const res = await send(m.messageId, { bodyHash: m.bodyHash, connectedMailboxId: mailbox() });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(CLAIM_REFUSAL.COACH_NOT_OUTREACH_ELIGIBLE);
    expect(res.body.error).toContain('COACH_ACTIVATION_HELD');
    expect(durable(m)).toEqual(before);
    expect(transportBehaviour.calls).toHaveLength(0);
  });
});

