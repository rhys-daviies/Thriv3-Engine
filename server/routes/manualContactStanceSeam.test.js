import {
  describe, it, expect, beforeAll, beforeEach, vi,
} from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Same interception as the sibling send tests: what is under test is the
 * orchestration, not whether a compose window opens on whoever runs the suite.
 * `sent` follows `message.send`, which is exactly what the real bridge reports.
 */
const composed = [];
let outlookOk = true;
vi.mock('../lib/outlook.js', () => ({
  isOutlookAvailable: () => true,
  composeInOutlook: vi.fn(async (message) => {
    composed.push(message);
    if (!outlookOk) throw new Error('Outlook refused the message');
    return { ok: true, sent: message.send };
  }),
}));

const db = (await import('../db/client.js')).default;
const { manualOutreachRouter } = await import('./manualOutreach.js');
const { programmeCoachesRouter } = await import('./programmeCoaches.js');
const { upsertAthleteProgramme, updateAthleteProgramme, findRelationship } = await import('../lib/athleteProgrammes.js');

/**
 * F5b — THE DIRECT MANUAL SEND SEAM.
 *
 * ===========================================================================
 * THE DISTINCTION THIS WHOLE FILE IS ABOUT: A DRAFT IS NOT CONTACT.
 *
 * `send: false` opens an Outlook window and nothing more. Whether the operator
 * then presses Send is precisely what this process cannot observe, so a
 * contact policy installed on a draft would silence the automated campaign for
 * a school nobody had actually written to — and it would do so invisibly,
 * because the draft looks identical either way.
 *
 * `send: true` means the bridge issued Outlook's own Send and did not throw.
 * That is a confirmation this process watched, and it is the only thing on
 * this route that establishes anything.
 * ===========================================================================
 *
 * The other half is where the seam LIVES. It is in this route and deliberately
 * not inside `sendOutreach`, which is shared by the Top 100 composer, the bulk
 * composer, the drafting CLI and the campaign path — a policy write down there
 * would let a campaign send establish manual-contact policy.
 */

const ATHLETE = 'a-f5b-seam';
const SPORT = 'mens-soccer';
let baseUrl;
let relationshipId;
let coachId;
let seq = 0;

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

const post = async (body) => {
  const res = await fetch(`${baseUrl}/api/players/${ATHLETE}/programmes/${relationshipId}/outreach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const compose = (over = {}) => post({
  coachIds: [coachId], subject: 'Subject', body: 'Body {{player_profile_url}}',
  greetingName: 'A Coach', ...over,
});

const stance = () => findRelationship(ATHLETE, 'Duke', SPORT)?.contact_stance ?? null;
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

beforeEach(() => {
  db.exec(`DELETE FROM outbound_send_attempt; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach_evidence; DELETE FROM outreach;
           DELETE FROM athlete_programmes; DELETE FROM suppressions;
           DELETE FROM coaches; DELETE FROM colleges; DELETE FROM players;`);
  composed.length = 0;
  outlookOk = true;
  seq = 0;

  /**
   * A COMPLETE ATHLETE, because an incomplete one is refused before the seam
   * is reached — `sendOutreach` will not put a dead profile link in front of a
   * coach, and a fixture missing a video would test that rule instead of this
   * one.
   */
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug,
      recruiting_class_year, email, video_id)
    VALUES (?, 'x', 'x', 'Seam Athlete', 'MIDFIELD', ?, ?, 2027, 'athlete@example.com', 'aqz-KE-bpKQ')
  `).run(ATHLETE, SPORT, randomUUID().slice(0, 10));

  const collegeId = `col-seam-${++seq}`;
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, active)
    VALUES (?, 'x', 'x', 'Duke', ?, 'NCAA D1', 'ACC', 1)
  `).run(collegeId, SPORT);

  coachId = `coach-seam-${++seq}`;
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, 'x', 'A Coach', 'a@duke.test', 'Duke', 'NCAA D1', ?, 'Head Coach')
  `).run(coachId, SPORT);

  relationshipId = upsertAthleteProgramme(ATHLETE, { college_id: collegeId }).programme.id;
});

/* ========================================================================== */

describe('a manual draft', () => {
  it('leaves the stance at default', async () => {
    const { status, body } = await compose({ send: false });

    expect(status).toBe(200);
    expect(body.results[0].status).toBe('drafted');
    expect(stance()).toBe('default');
  });

  it('is the default when `send` is not mentioned at all', async () => {
    await compose();
    expect(composed[0].send).toBe(false);
    expect(stance()).toBe('default');
  });

  it('still records the history a draft has always recorded', async () => {
    await compose({ send: false });

    expect(count('outreach')).toBe(1);
    expect(count('outreach_send')).toBe(1);
    const row = db.prepare('SELECT state, origin FROM outreach_send').get();
    expect(row).toEqual({ state: 'DRAFT', origin: 'manual' });
    expect(db.prepare('SELECT drafted_at, sent_at FROM outreach').get().sent_at).toBeNull();
  });

  it('reports no stance outcome, because it decided nothing', async () => {
    const { body } = await compose({ send: false });
    expect(body.contactStance).toBeNull();
  });
});

describe('a confirmed manual send', () => {
  it('establishes manual_only', async () => {
    const { body } = await compose({ send: true });

    expect(body.results[0].status).toBe('sent');
    expect(stance()).toBe('manual_only');
  });

  it('reports the outcome, so the screen can update without a refetch', async () => {
    const { body } = await compose({ send: true });
    expect(body.contactStance).toMatchObject({ outcome: 'ESTABLISHED', changed: true, stance: 'manual_only' });
  });

  it('changes the stance and nothing else on the relationship', async () => {
    updateAthleteProgramme(ATHLETE, relationshipId, {
      flagged: true, flag_reason: 'Her father is an alum', visibility: 'suppressed', note: 'Call in July.',
    });
    const before = findRelationship(ATHLETE, 'Duke', SPORT);

    await compose({ send: true });

    const after = findRelationship(ATHLETE, 'Duke', SPORT);
    expect(after.contact_stance).toBe('manual_only');
    expect(after.flagged).toBe(true);
    expect(after.flag_reason).toBe(before.flag_reason);
    expect(after.flagged_at).toBe(before.flagged_at);
    expect(after.visibility).toBe('suppressed');
    expect(after.note).toBe(before.note);
    expect(after.request_state).toBe(before.request_state);
  });

  it('is idempotent across a second send to the same school', async () => {
    await compose({ send: true });
    const after = findRelationship(ATHLETE, 'Duke', SPORT);

    await compose({ send: true });

    expect(findRelationship(ATHLETE, 'Duke', SPORT).updated_at).toBe(after.updated_at);
    expect(stance()).toBe('manual_only');
  });

  it('never downgrades do_not_contact — and never gets the chance', async () => {
    updateAthleteProgramme(ATHLETE, relationshipId, { contact_stance: 'do_not_contact' });

    const { status, body } = await compose({ send: true });

    // Refused long before the seam: the route, and `sendOutreach` beneath it.
    expect(status).toBe(422);
    expect(body.code).toBe('RELATIONSHIP_DO_NOT_CONTACT');
    expect(stance()).toBe('do_not_contact');
    expect(count('outreach_send')).toBe(0);
  });

  it('writes no suppression row', async () => {
    await compose({ send: true });
    expect(count('suppressions')).toBe(0);
  });
});

describe('a send that did not happen', () => {
  /**
   * The bridge threw, so the coach has nothing. `sendOutreach` records the
   * failure per coach as `status: 'error'` and the run returns 200 carrying
   * it — which is why the seam reads the RESULTS rather than the HTTP status.
   */
  it('establishes nothing when Outlook refused the message', async () => {
    outlookOk = false;

    const { body } = await compose({ send: true });

    expect(body.results[0].status).toBe('error');
    expect(stance()).toBe('default');
    expect(body.contactStance).toBeNull();
  });

  it('establishes nothing when the recipient is globally suppressed', async () => {
    db.prepare(`INSERT INTO suppressions (email, created_at, reason, source)
                VALUES ('a@duke.test', 'x', 'unsubscribed', 'manual')`).run();

    const { body } = await compose({ send: true });

    expect(body.results[0].status).toBe('suppressed');
    expect(stance()).toBe('default');
  });

  it('establishes nothing when no coach was named', async () => {
    const { status } = await post({ subject: 'x', body: 'y', coachIds: [], send: true });
    expect(status).toBe(400);
    expect(stance()).toBe('default');
  });
});

describe('the seam does not live in shared infrastructure', () => {
  /**
   * `sendOutreach` is the single function every path to a coach's inbox passes
   * through — manual route, Top 100 composer, bulk composer, drafting CLI and
   * the campaign. A policy write inside it would mean a CAMPAIGN send
   * establishing manual-contact policy, which is the one coupling the two
   * workstreams are kept apart to prevent.
   */
  it('is absent from sendOutreach', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('./sendOutreach.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toContain('manualContactStance');
    expect(src).not.toContain('establishManualOnly');
    expect(src).not.toContain('athlete_programmes');
  });
});
