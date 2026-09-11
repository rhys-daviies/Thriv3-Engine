import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { manualOutreachRouter } from './manualOutreach.js';
import { programmeCoachesRouter } from './programmeCoaches.js';
import { upsertAthleteProgramme } from '../lib/athleteProgrammes.js';

/**
 * THE TRUST BOUNDARY.
 *
 * `/api/outreach/send` spreads `req.body` into its payload, so every field it
 * reads is client-supplied by construction. That is survivable for a subject
 * line and unacceptable for a safety rule, which is why manual outreach has a
 * route of its own: the programme, the contact stance, the campaign and the
 * origin are read from the URL and the database, and there is no field a
 * request can set to move any of them.
 *
 * Most of what follows is therefore a list of things a browser CANNOT do.
 */

const ATHLETE = 'a-manual';
let baseUrl;
let duke;
let relationshipId;

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

const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const get = (url) => api('GET', url);
const post = (url, body) => api('POST', url, body);

let seq = 0;
function college({ name, sport = 'mens-soccer', active = 1 }) {
  const id = `col-m-${++seq}`;
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, active)
    VALUES (?, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', ?, ?, 'NCAA D1', 'ACC', ?)
  `).run(id, name, sport, active);
  return id;
}

function coach({ name, email, school = 'Duke', sport = 'mens-soccer', title = 'Head Coach', status = null }) {
  const id = `coach-${++seq}`;
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status)
    VALUES (?, '2026-09-11T00:00:00.000Z', ?, ?, ?, 'NCAA D1', ?, ?, ?)
  `).run(id, name, email, school, sport, title, status);
  return id;
}

const url = () => `/api/players/${ATHLETE}/programmes/${relationshipId}/outreach`;

beforeEach(() => {
  db.exec(`DELETE FROM outreach_send; DELETE FROM outreach; DELETE FROM coaches;
           DELETE FROM athlete_programmes; DELETE FROM suppressions;
           DELETE FROM graduating_seniors;
           DELETE FROM colleges; DELETE FROM players;`);
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, recruiting_class_year)
    VALUES (?, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', 'Manual Athlete', 'MIDFIELD',
      'mens-soccer', 2027)
  `).run(ATHLETE);
  duke = college({ name: 'Duke' });
  relationshipId = upsertAthleteProgramme(ATHLETE, {
    college_id: duke, request_state: 'requested', requested_by: 'athlete',
  }).programme.id;
});

// ---------------------------------------------------------------------------

describe('GET the composing context', () => {
  it('returns the relationship, the college, canonical staff and the stance', async () => {
    coach({ name: 'A Coach', email: 'a@duke.test', status: 'verified' });
    const { status, body } = await get(url());

    expect(status).toBe(200);
    expect(body.relationship).toMatchObject({ college_name: 'Duke', request_state: 'requested' });
    expect(body.college).toMatchObject({ id: duke, name: 'Duke', sport: 'mens-soccer' });
    expect(body.coaches).toEqual([
      { coach_id: expect.any(String), name: 'A Coach', email: 'a@duke.test', title: 'Head Coach', email_status: 'verified' },
    ]);
    expect(body.contact).toMatchObject({ allowed: true, stance: 'default' });
  });

  it('reports a do-not-contact relationship rather than hiding it', async () => {
    coach({ name: 'A Coach', email: 'a@duke.test' });
    db.exec("UPDATE athlete_programmes SET contact_stance = 'do_not_contact'");
    const { body } = await get(url());
    // The dialog must be able to explain the refusal, so the context still
    // loads and still lists the staff.
    expect(body.contact).toMatchObject({ allowed: false, stance: 'do_not_contact' });
    expect(body.coaches).toHaveLength(1);
  });

  it('404s a relationship that is not this athlete’s', async () => {
    const { status, body } = await get(`/api/players/nobody/programmes/${relationshipId}/outreach`);
    expect(status).toBe(404);
    expect(body.code).toBe('RELATIONSHIP_NOT_FOUND');
  });
});

describe('prior contact is derived, never stored', () => {
  it('reports what the outreach tables already know', async () => {
    const coachId = coach({ name: 'A Coach', email: 'a@duke.test' });
    db.prepare(`
      INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, drafted_at, sent_at)
      VALUES ('o-1', ?, ?, 'tok-1', '2026-09-01T00:00:00.000Z',
              '2026-09-01T10:00:00.000Z', '2026-09-01T11:00:00.000Z')
    `).run(ATHLETE, coachId);

    const { body } = await get(url());
    expect(body.priorContact).toHaveLength(1);
    expect(body.priorContact[0]).toMatchObject({
      coach_name: 'A Coach', drafted_at: '2026-09-01T10:00:00.000Z', sent_at: '2026-09-01T11:00:00.000Z',
    });

    // And nothing was written onto the relationship to say so.
    const columns = db.prepare('PRAGMA table_info(athlete_programmes)').all().map((c) => c.name);
    for (const f of ['previously_contacted', 'last_contacted', 'last_contacted_at']) {
      expect(columns).not.toContain(f);
    }
  });

  it('is empty for a programme nobody has written to', async () => {
    coach({ name: 'A Coach', email: 'a@duke.test' });
    const { body } = await get(url());
    expect(body.priorContact).toEqual([]);
  });
});

describe('THE TRUST BOUNDARY — what a client cannot do', () => {
  beforeEach(() => {
    coach({ name: 'A Coach', email: 'a@duke.test' });
    db.exec("UPDATE athlete_programmes SET contact_stance = 'do_not_contact'");
  });

  const coachIds = () => db.prepare('SELECT id FROM coaches').all().map((r) => r.id);

  it('cannot send to a do-not-contact relationship', async () => {
    const { status, body } = await post(url(), {
      coachIds: coachIds(), subject: 's', body: 'b', send: false,
    });
    expect(status).toBe(422);
    expect(body.code).toBe('RELATIONSHIP_DO_NOT_CONTACT');
    expect(db.prepare('SELECT COUNT(*) c FROM outreach').get().c).toBe(0);
  });

  for (const [field, value] of [
    ['contact_stance', 'default'],
    ['visibility', 'default'],
    ['flagged', false],
    ['request_state', 'requested'],
    ['origin', 'campaign'],
    ['programmeCampaignId', 'pc-1'],
    ['collegeName', 'Somewhere Else'],
    ['athleteId', 'someone-else'],
    ['coaches', [{ name: 'X', email: 'x@elsewhere.test' }]],
  ]) {
    it(`refuses a request that tries to set ${field}`, async () => {
      const { status, body } = await post(url(), {
        coachIds: coachIds(), subject: 's', body: 'b', [field]: value,
      });
      // Refused by name, not ignored — a client that believed it had changed
      // the rule and got a 200 has been told something false.
      expect(status).toBe(400);
      expect(body.error).toContain(field);
      expect(db.prepare('SELECT COUNT(*) c FROM outreach').get().c).toBe(0);
    });
  }

  it('still refuses when the stance is lifted only in the request body', async () => {
    // The combination somebody would actually try.
    const { status } = await post(url(), {
      coachIds: coachIds(), subject: 's', body: 'b', contact_stance: 'default', origin: 'manual',
    });
    expect(status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) c FROM outreach_send').get().c).toBe(0);
  });
});

describe('recipients come from the registry', () => {
  it('refuses a coach who does not work at this programme', async () => {
    coach({ name: 'A Coach', email: 'a@duke.test' });
    const elsewhere = coach({ name: 'B Coach', email: 'b@unc.test', school: 'North Carolina' });

    const { status, body } = await post(url(), {
      coachIds: [elsewhere], subject: 's', body: 'b',
    });
    expect(status).toBe(422);
    expect(body.code).toBe('COACH_NOT_AT_PROGRAMME');
  });

  it('refuses a request naming no coach at all', async () => {
    coach({ name: 'A Coach', email: 'a@duke.test' });
    const { status, body } = await post(url(), { coachIds: [], subject: 's', body: 'b' });
    expect(status).toBe(400);
    expect(body.code).toBe('NO_COACH_SELECTED');
  });
});

describe('GET /api/colleges/:id/coaches', () => {
  it('returns canonical staff scoped to the college’s own sport', async () => {
    coach({ name: 'Mens Coach', email: 'm@duke.test' });
    coach({ name: 'Womens Coach', email: 'w@duke.test', sport: 'womens-soccer' });

    const { status, body } = await get(`/api/colleges/${duke}/coaches`);
    expect(status).toBe(200);
    expect(body.coaches.map((c) => c.name)).toEqual(['Mens Coach']);
    expect(body.college).toMatchObject({ id: duke, name: 'Duke', sport: 'mens-soccer' });
  });

  it('excludes contacts with no usable address', async () => {
    coach({ name: 'Real', email: 'real@duke.test' });
    coach({ name: 'Placeholder', email: 'N/A' });
    coach({ name: 'Blank', email: '   ' });

    const { body } = await get(`/api/colleges/${duke}/coaches`);
    // "N/A" is a literal value in this data, not a null, and would be offered,
    // selected and then refused at the transport.
    expect(body.coaches.map((c) => c.name)).toEqual(['Real']);
  });

  it('still lists staff for a programme that has since gone inactive', async () => {
    db.prepare('UPDATE colleges SET active = 0 WHERE id = ?').run(duke);
    coach({ name: 'A Coach', email: 'a@duke.test' });
    const { status, body } = await get(`/api/colleges/${duke}/coaches`);
    // A relationship made while it was active is still real, and an operator
    // must be able to see who they already wrote to. Selecting it into a NEW
    // relationship is what `findCanonicalCollege` refuses, elsewhere.
    expect(status).toBe(200);
    expect(body.coaches).toHaveLength(1);
    expect(body.college.active).toBe(0);
  });

  it('404s a college that does not exist', async () => {
    const { status, body } = await get('/api/colleges/nope/coaches');
    expect(status).toBe(404);
    expect(body.code).toBe('COLLEGE_NOT_FOUND');
  });

  it('does not read graduating_seniors.coaching_staff', async () => {
    db.prepare(`
      INSERT INTO graduating_seniors (id, created_date, updated_date, college_name, sport, season, coaching_staff)
      VALUES ('gs-1', '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', 'Duke', 'mens-soccer', 2026,
              '[{"name":"Blob Coach","email":"blob@duke.test","title":"Head Coach"}]')
    `).run();
    const { body } = await get(`/api/colleges/${duke}/coaches`);
    // The blob exists only for programmes that matched, carries no provenance,
    // and is not what a send resolves against.
    expect(body.coaches).toEqual([]);
  });
});
