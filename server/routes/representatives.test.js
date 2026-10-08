/**
 * REPRESENTATIVE-FIRST CONTACT — Phase 2 (docs/IMMEDIATE_CHANGES_ROADMAP.md).
 *
 *   - Several representatives, each with name, email and phone; never deleted.
 *   - Each athlete names one; a retired one cannot be newly assigned.
 *   - Every athlete read carries the representative's public fields.
 *   - The server-composed email is signed by that representative; with none
 *     assigned it is the email it always was.
 *   - Over HTTP: create, list, update, refuse delete; nothing is sent.
 */
import {
  describe, it, expect, beforeAll, afterAll, beforeEach,
} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.THRIV3_SCRYPT_COST = '14';
process.env.THRIV3_SESSION_SECRET = `p2rep-${'k'.repeat(40)}`;
process.env.THRIV3_APP_ORIGIN = 'http://localhost:5183';
process.env.THRIV3_REPORT_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-p2rep-'));

const ORIGIN = 'http://localhost:5183';
const EMAIL = 'p2rep-operator@example.com';
const PASSWORD = 'a-perfectly-fine-passphrase';

const { default: app } = await import('../index.js');
const { default: db } = await import('../db/client.js');
const { createOperator, resetLoginLimits } = await import('../lib/operatorAuth.js');
const { Representative, withRepresentative } = await import('../db/entities/representative.js');
const { Player } = await import('../db/entities/player.js');
const { composeMessage } = await import('../lib/programmeMessage.js');

let server; let base; let cookie;

const api = (method, url, body) => fetch(`${base}${url}`, {
  method,
  headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const athlete = (extra = {}) => Player.create({
  full_name: 'Jordan Smith', position: 'CB', sport: 'mens-soccer', recruiting_class_year: 2028, ...extra,
});

beforeAll(async () => {
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

beforeEach(async () => {
  db.exec('DELETE FROM operator_sessions; DELETE FROM operator_users; UPDATE players SET representative_id = NULL; DELETE FROM representatives;');
  resetLoginLimits();
  await createOperator({ email: EMAIL, password: PASSWORD });
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
});

describe('the representative record', () => {
  it('supports several consultants, each with their own contact details', () => {
    const a = Representative.create({ full_name: 'Alex Morgan', email: 'Alex@Example.test ', phone: '+1 415 555 0134' });
    const b = Representative.create({ full_name: 'Sam Lee', email: 'sam@example.test', phone: '+64 21 555 0100', title: 'Consultant' });
    expect(Representative.list().map((r) => r.full_name).sort()).toEqual(['Alex Morgan', 'Sam Lee']);
    expect(a.email).toBe('alex@example.test');
    expect(a.active).toBe(1);
    expect(b.title).toBe('Consultant');
  });

  it('refuses a duplicate email, a missing name or an unusable phone', () => {
    Representative.create({ full_name: 'Alex Morgan', email: 'alex@example.test' });
    expect(() => Representative.create({ full_name: 'Other', email: 'ALEX@example.test' })).toThrow(/already exists/);
    expect(() => Representative.create({ email: 'x@example.test' })).toThrow(/needs a name/);
    expect(() => Representative.create({ full_name: 'X', email: 'x@example.test', phone: 'ring me' })).toThrow(/not a phone/);
  });

  it('is never deleted, only deactivated', () => {
    const r = Representative.create({ full_name: 'Alex Morgan', email: 'alex@example.test' });
    expect(() => Representative.delete(r.id)).toThrow(/deactivated, not deleted/);
    expect(Representative.update(r.id, { active: false }).active).toBe(0);
  });
});

describe('assigning a representative to an athlete', () => {
  it('attaches the representative\'s public fields to every athlete read', () => {
    const r = Representative.create({ full_name: 'Alex Morgan', email: 'alex@example.test', phone: '+1 415 555 0134' });
    const p = athlete({ representative_id: r.id });
    expect(Player.get(p.id).representative).toMatchObject({ id: r.id, full_name: 'Alex Morgan', email: 'alex@example.test' });
    expect(Player.list().find((x) => x.id === p.id).representative.full_name).toBe('Alex Morgan');
    expect(Player.listActive().find((x) => x.id === p.id).representative.full_name).toBe('Alex Morgan');
    expect(Object.keys(Player.get(p.id).representative)).not.toContain('created_by_id');
  });

  it('an athlete with none reads representative: null', () => {
    expect(Player.get(athlete().id).representative).toBeNull();
  });

  it('refuses an unknown representative, and a retired one as a new assignment', () => {
    const r = Representative.create({ full_name: 'Alex Morgan', email: 'alex@example.test' });
    const p = athlete({ representative_id: r.id });
    expect(() => athlete({ representative_id: 'nobody' })).toThrow(/not a representative on file/);
    Representative.update(r.id, { active: false });
    // Keeping them is allowed; newly assigning them is not.
    expect(() => Player.update(p.id, { representative_id: r.id, evaluation: 'x' })).not.toThrow();
    expect(() => athlete({ representative_id: r.id })).toThrow(/no longer active/);
  });

  it('an echoed `representative` object on a write is ignored, and "" clears the assignment', () => {
    const r = Representative.create({ full_name: 'Alex Morgan', email: 'alex@example.test' });
    const p = athlete({ representative_id: r.id });
    const echoed = Player.update(p.id, { ...Player.get(p.id), representative: { full_name: 'Hacked' } });
    expect(echoed.representative.full_name).toBe('Alex Morgan');
    expect(Player.update(p.id, { representative_id: '' }).representative).toBeNull();
  });
});

describe('server-composed emails', () => {
  const college = { name: 'Example College', division: 'NCAA D1' };

  it('are signed by the athlete\'s representative and give their number', () => {
    const r = Representative.create({ full_name: 'Alex Morgan', email: 'alex@example.test', phone: '+1 415 555 0134', organisation: 'Striv3 Elite Sports Management' });
    const p = athlete({ representative_id: r.id });
    const { body } = composeMessage({ athlete: withRepresentative(db.prepare('SELECT * FROM players WHERE id = ?').get(p.id)), college, coachName: 'Pat Lee' });
    expect(body).toMatch(/Best regards,\nAlex Morgan\nStriv3 Elite Sports Management$/);
    expect(body).toContain('tel:+14155550134');
    expect(body).not.toContain('Rhys Davies');
  });

  it('with no representative assigned, end exactly as they always have', () => {
    const p = athlete();
    const { body } = composeMessage({ athlete: withRepresentative(db.prepare('SELECT * FROM players WHERE id = ?').get(p.id)), college, coachName: 'Pat Lee' });
    expect(body).toMatch(/Best regards,\nRhys Davies\nStriv3 Elite Sports Management$/);
  });
});

describe('over HTTP', () => {
  it('creates, lists and updates representatives, and refuses deletion with 409', async () => {
    const created = await api('POST', '/api/entities/representatives', { full_name: 'Alex Morgan', email: 'alex@example.test', phone: '+1 415 555 0134' });
    expect(created.status).toBe(200);
    const r = await created.json();
    const list = await (await api('GET', '/api/entities/representatives')).json();
    expect(list.map((x) => x.id)).toContain(r.id);
    const bad = await api('POST', '/api/entities/representatives', { full_name: 'No Email' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/needs an email/);
    const del = await api('DELETE', `/api/entities/representatives/${r.id}`);
    expect(del.status).toBe(409);
    expect(Representative.get(r.id)).toBeTruthy();
    const off = await api('PUT', `/api/entities/representatives/${r.id}`, { active: false });
    expect((await off.json()).active).toBe(0);
  });

  it('assigns a representative to an athlete and returns it on the athlete read', async () => {
    const r = Representative.create({ full_name: 'Alex Morgan', email: 'alex@example.test' });
    const p = athlete();
    const put = await api('PUT', `/api/entities/players/${p.id}`, { representative_id: r.id });
    expect(put.status).toBe(200);
    const read = await (await api('GET', `/api/entities/players/${p.id}`)).json();
    expect(read.representative).toMatchObject({ full_name: 'Alex Morgan', email: 'alex@example.test' });
    const refused = await api('PUT', `/api/entities/players/${p.id}`, { representative_id: 'nobody' });
    expect(refused.status).toBe(400);
  });

  it('requires a signed-in operator', async () => {
    const res = await fetch(`${base}/api/entities/representatives`, { headers: { origin: ORIGIN } });
    expect(res.status).toBe(401);
  });
});
