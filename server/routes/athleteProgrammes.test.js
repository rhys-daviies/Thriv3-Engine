import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import db from '../db/client.js';
import { athleteProgrammesRouter } from './athleteProgrammes.js';
import { getAthleteProgramme, listAthleteProgrammes } from '../lib/athleteProgrammes.js';

/**
 * The API doorway.
 *
 * Route tests over real HTTP, because the properties under test are boundary
 * properties: what a request is ALLOWED to say, what a refusal looks like from
 * outside, and what leaves the building. A library can be correct while a
 * route hands a client a way around it — and the way around this one would be
 * writing a school name the registry has never heard of.
 */

const ATHLETE = 'a-api-rel';
const OTHER = 'a-api-rel-other';
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', athleteProgrammesRouter);
  await new Promise((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.unref();
  });
});

let seq = 0;
function college({ name, sport = 'mens-soccer', active = 1 }) {
  const id = `col-api-${++seq}`;
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, city, state, active)
    VALUES (?, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', ?, ?, 'NCAA D1', 'ACC', 'Durham', 'NC', ?)
  `).run(id, name, sport, active);
  return id;
}

function insertAthlete(id, sport = 'mens-soccer') {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', ?, 'MIDFIELD', ?)
  `).run(id, `Athlete ${id}`, sport);
}

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
const patch = (url, body) => api('PATCH', url, body);

let duke;
beforeEach(() => {
  db.exec('DELETE FROM athlete_programmes; DELETE FROM suppressions; DELETE FROM colleges; DELETE FROM players;');
  insertAthlete(ATHLETE);
  insertAthlete(OTHER);
  duke = college({ name: 'Duke' });
});

// ---------------------------------------------------------------------------

describe('GET /api/colleges/search', () => {
  it('finds canonical programmes, case-insensitively and by partial name', async () => {
    college({ name: 'North Carolina' });
    const { status, body } = await get('/api/colleges/search?sport=mens-soccer&q=CAROL');
    expect(status).toBe(200);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      name: 'North Carolina', sport: 'mens-soccer', division: 'NCAA D1', matched_on: 'name',
    });
  });

  it('returns compact picker fields and nothing else', async () => {
    const { body } = await get('/api/colleges/search?sport=mens-soccer&q=duke');
    expect(Object.keys(body.results[0]).sort())
      .toEqual(['city', 'conference', 'division', 'id', 'matched_on', 'name', 'sport', 'state']);
  });

  it('excludes inactive programmes', async () => {
    college({ name: 'Duke Kunshan', active: 0 });
    const { body } = await get('/api/colleges/search?sport=mens-soccer&q=duke');
    expect(body.results.map((r) => r.name)).toEqual(['Duke']);
  });

  it('refuses a search with no sport', async () => {
    const { status, body } = await get('/api/colleges/search?q=duke');
    expect(status).toBe(400);
    expect(body.code).toBe('SPORT_REQUIRED');
  });

  it('refuses a query too short to mean anything', async () => {
    const { status, body } = await get('/api/colleges/search?sport=mens-soccer&q=d');
    expect(status).toBe(400);
    expect(body.code).toBe('SEARCH_QUERY_TOO_SHORT');
  });

  it('refuses a limit that is not a whole number', async () => {
    const { status, body } = await get('/api/colleges/search?sport=mens-soccer&q=duke&limit=all');
    expect(status).toBe(400);
    expect(body.error).toMatch(/whole number/);
  });

  it('returns an empty list for a school the registry does not hold', async () => {
    const { status, body } = await get('/api/colleges/search?sport=mens-soccer&q=Hogwarts');
    expect(status).toBe(200);
    // No nearest match, no manufactured row.
    expect(body.results).toEqual([]);
  });
});

describe('POST /api/players/:playerId/programmes', () => {
  it('creates a relationship from a selected college id', async () => {
    const { status, body } = await post(`/api/players/${ATHLETE}/programmes`, { college_id: duke });
    expect(status).toBe(201);
    expect(body.programme).toMatchObject({
      athlete_id: ATHLETE, college_name: 'Duke', sport: 'mens-soccer', college_id: duke,
      request_state: 'none', flagged: false, visibility: 'default', contact_stance: 'default',
    });
  });

  it('creates and updates in one shape, and says which it did', async () => {
    const first = await post(`/api/players/${ATHLETE}/programmes`, { college_id: duke });
    expect(first.status).toBe(201);

    // Two features write here and neither can know whether the other got there
    // first, so the second call lands on the same row rather than conflicting.
    const second = await post(`/api/players/${ATHLETE}/programmes`, {
      college_id: duke, flagged: true, flag_reason: 'club connection',
    });
    expect(second.status).toBe(200);
    expect(second.body.programme.id).toBe(first.body.programme.id);
    expect(listAthleteProgrammes(ATHLETE)).toHaveLength(1);
  });

  it('REFUSES a college_name, rather than ignoring it', async () => {
    // The heart of the identity guarantee. A client that believes it just set
    // the school name and got a 200 has been told something false.
    const { status, body } = await post(`/api/players/${ATHLETE}/programmes`, {
      college_id: duke, college_name: 'Duke Universty',
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/college_name read from the registry row/);
    expect(listAthleteProgrammes(ATHLETE)).toEqual([]);
  });

  it('refuses every other immutable field by name', async () => {
    for (const field of ['id', 'athlete_id', 'sport', 'created_at', 'updated_at',
      'requested_at', 'flagged_at', 'note_updated_at']) {
      const { status, body } = await post(`/api/players/${ATHLETE}/programmes`,
        { college_id: duke, [field]: 'x' });
      expect(status, field).toBe(400);
      expect(body.error, field).toContain(field);
    }
  });

  it('refuses an unknown field and lists what is allowed', async () => {
    const { status, body } = await post(`/api/players/${ATHLETE}/programmes`,
      { college_id: duke, tier: 'A' });
    expect(status).toBe(400);
    expect(body.error).toMatch(/Unknown field\(s\).*tier/);
    expect(body.error).toMatch(/Allowed: college_id/);
  });

  it('refuses a body that is not an object', async () => {
    const { status } = await post(`/api/players/${ATHLETE}/programmes`, ['col-1']);
    expect(status).toBe(400);
  });

  it('404s an unknown athlete', async () => {
    const { status, body } = await post('/api/players/nobody/programmes', { college_id: duke });
    expect(status).toBe(404);
    expect(body.code).toBe('ATHLETE_NOT_FOUND');
  });

  it('404s a college id the registry does not hold', async () => {
    const { status, body } = await post(`/api/players/${ATHLETE}/programmes`, { college_id: 'Hogwarts' });
    expect(status).toBe(404);
    expect(body.code).toBe('COLLEGE_NOT_FOUND');
  });

  it('422s a college from another sport', async () => {
    const womens = college({ name: 'Duke', sport: 'womens-soccer' });
    const { status, body } = await post(`/api/players/${ATHLETE}/programmes`, { college_id: womens });
    expect(status).toBe(422);
    expect(body.code).toBe('COLLEGE_SPORT_MISMATCH');
  });

  it('422s an inactive programme', async () => {
    const closed = college({ name: 'Closed', active: 0 });
    const { status, body } = await post(`/api/players/${ATHLETE}/programmes`, { college_id: closed });
    expect(status).toBe(422);
    expect(body.code).toBe('COLLEGE_INACTIVE');
  });

  it('422s a state outside its bounded set', async () => {
    const { status, body } = await post(`/api/players/${ATHLETE}/programmes`,
      { college_id: duke, visibility: 'hidden' });
    expect(status).toBe(422);
    expect(body.code).toBe('INVALID_VISIBILITY');
  });

  it('422s a flag with no reason and a request with no asker', async () => {
    const flag = await post(`/api/players/${ATHLETE}/programmes`, { college_id: duke, flagged: true });
    expect(flag.status).toBe(422);
    expect(flag.body.code).toBe('FLAG_REASON_REQUIRED');

    const req = await post(`/api/players/${ATHLETE}/programmes`, { college_id: duke, request_state: 'requested' });
    expect(req.status).toBe(422);
    expect(req.body.code).toBe('REQUESTED_BY_REQUIRED');
  });
});

describe('PATCH /api/players/:playerId/programmes/:id', () => {
  let id;
  beforeEach(async () => {
    const { body } = await post(`/api/players/${ATHLETE}/programmes`, { college_id: duke });
    id = body.programme.id;
  });

  it('changes allowed state', async () => {
    const { status, body } = await patch(`/api/players/${ATHLETE}/programmes/${id}`, {
      flagged: true, flag_reason: 'sister plays there', contact_stance: 'manual_only', note: 'Call, do not email',
    });
    expect(status).toBe(200);
    expect(body.programme).toMatchObject({
      flagged: true, flag_reason: 'sister plays there',
      contact_stance: 'manual_only', note: 'Call, do not email',
      visibility: 'default', // untouched: three states, three decisions
    });
  });

  it('refuses to move a relationship to a different programme', async () => {
    const unc = college({ name: 'North Carolina' });
    const { status, body } = await patch(`/api/players/${ATHLETE}/programmes/${id}`, { college_id: unc });
    expect(status).toBe(400);
    expect(body.error).toMatch(/college_id the programme a relationship is with is fixed/);
    expect(getAthleteProgramme(ATHLETE, id).college_name).toBe('Duke');
  });

  it('refuses an unknown field', async () => {
    const { status, body } = await patch(`/api/players/${ATHLETE}/programmes/${id}`, { rank: 1 });
    expect(status).toBe(400);
    expect(body.error).toMatch(/Unknown field\(s\).*rank/);
  });

  it('404s another athlete’s relationship', async () => {
    const { status, body } = await patch(`/api/players/${OTHER}/programmes/${id}`, { note: 'x' });
    expect(status).toBe(404);
    expect(body.code).toBe('RELATIONSHIP_NOT_FOUND');
  });
});

describe('GET /api/players/:playerId/programmes', () => {
  it('lists this athlete’s relationships only', async () => {
    const unc = college({ name: 'North Carolina' });
    await post(`/api/players/${ATHLETE}/programmes`, { college_id: duke });
    await post(`/api/players/${ATHLETE}/programmes`, { college_id: unc });
    await post(`/api/players/${OTHER}/programmes`, { college_id: duke });

    const { status, body } = await get(`/api/players/${ATHLETE}/programmes`);
    expect(status).toBe(200);
    expect(body.programmes.map((p) => p.college_name)).toEqual(['Duke', 'North Carolina']);

    const other = await get(`/api/players/${OTHER}/programmes`);
    expect(other.body.programmes).toHaveLength(1);
  });

  it('404s an unknown athlete rather than returning an empty list', async () => {
    const { status, body } = await get('/api/players/nobody/programmes');
    expect(status).toBe(404);
    expect(body.code).toBe('ATHLETE_NOT_FOUND');
  });

  it('reads one relationship by its id, and 404s an unknown one', async () => {
    const { body } = await post(`/api/players/${ATHLETE}/programmes`, { college_id: duke });
    const one = await get(`/api/players/${ATHLETE}/programmes/${body.programme.id}`);
    expect(one.status).toBe(200);
    expect(one.body.programme.college_name).toBe('Duke');

    const missing = await get(`/api/players/${ATHLETE}/programmes/nope`);
    expect(missing.status).toBe(404);
  });
});

describe('no route here creates a global suppression', () => {
  it('leaves the suppressions table empty across the whole API surface', async () => {
    const { body } = await post(`/api/players/${ATHLETE}/programmes`, {
      college_id: duke, flagged: true, flag_reason: 'already in touch',
    });
    await patch(`/api/players/${ATHLETE}/programmes/${body.programme.id}`, { contact_stance: 'do_not_contact' });
    await patch(`/api/players/${ATHLETE}/programmes/${body.programme.id}`, { visibility: 'suppressed' });

    expect(db.prepare('SELECT COUNT(*) c FROM suppressions').get().c).toBe(0);
  });
});
