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
 * F5b's DIRECT-SEND SEAM, AND WHAT F7b DID TO IT.
 *
 * ===========================================================================
 * THE SEAM IS GONE BECAUSE THE SEND IS GONE.
 *
 * F5b established manual_only on this route when a send was confirmed inline,
 * which could only happen through `send: true`. F7b made Specific Search
 * DRAFT-ONLY: Thriv3 opens a draft in Outlook, a PERSON reviews and edits and
 * presses Send, and the person then tells Thriv3 it went. So there is no
 * inline confirmation left to hang a stance on, and the branch was removed
 * rather than left as a dead conditional claiming to set contact policy.
 *
 * What these tests now hold is the half that survived and the half that
 * replaced it:
 *
 *   A DRAFT IS STILL NOT CONTACT. It records history, it changes no stance,
 *   and that was true before F7b and is true after it.
 *
 *   `send: true` IS REFUSED RATHER THAN COERCED, and refused before anything
 *   is written. See server/routes/manualDraftConfirmation.test.js for the
 *   per-message confirmation that now establishes manual_only.
 * ===========================================================================
 *
 * The last block is unchanged and is the one that matters most: `sendOutreach`
 * is shared by the manual route, the Top 100 composer, the bulk composer, the
 * drafting CLI and the campaign, and no contact policy may be written there.
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

  /**
   * AND IT REPORTS NO STANCE, BECAUSE IT DECIDED NOTHING. F5b answered with a
   * `contactStance` field here; F7b removed it along with the seam, so the
   * absence is the assertion.
   */
  it('reports no stance outcome, because it decided nothing', async () => {
    const { body } = await compose({ send: false });
    expect(body.contactStance).toBeUndefined();
    expect(stance()).toBe('default');
  });
});

describe('an attempt to make Thriv3 send', () => {
  it('is refused by name, not quietly turned into a draft', async () => {
    const { status, body } = await compose({ send: true });

    expect(status).toBe(422);
    expect(body.code).toBe('MANUAL_OUTREACH_DRAFT_ONLY');
  });

  /**
   * REFUSED BEFORE EVERYTHING. No relationship, no capacity reserved, no
   * Outlook window, no message row — and no contact stance, which is the
   * assertion this file was originally written to make in the opposite
   * direction.
   */
  it('writes nothing and establishes no stance', async () => {
    await compose({ send: true });

    expect(count('outreach')).toBe(0);
    expect(count('outreach_send')).toBe(0);
    expect(count('outbound_send_attempt')).toBe(0);
    expect(stance()).toBe('default');
    expect(composed).toHaveLength(0);
  });

  it('is refused even where the relationship is perfectly contactable', async () => {
    // Nothing about the world stops this send; the workflow does.
    const { status } = await compose({ send: true });
    expect(status).toBe(422);
  });

  it('leaves do_not_contact answering first, because it is about the world', async () => {
    updateAthleteProgramme(ATHLETE, relationshipId, { contact_stance: 'do_not_contact' });

    const { status, body } = await compose({ send: false });

    expect(status).toBe(422);
    expect(body.code).toBe('RELATIONSHIP_DO_NOT_CONTACT');
    expect(stance()).toBe('do_not_contact');
    expect(count('outreach_send')).toBe(0);
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
