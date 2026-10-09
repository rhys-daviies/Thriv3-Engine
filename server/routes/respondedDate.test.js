/**
 * "MARK RESPONDED" IS DATED BY THE REPLY, NOT THE CLICK — Phase 5 (#9).
 *
 * The operator may give the day the reply arrived. It is refused if it is in
 * the future or before the message was prepared; omitted, it is now. Clearing
 * is the existing route; the screen now asks before it does.
 */
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

process.env.THRIV3_SCRYPT_COST = '14';
process.env.THRIV3_SESSION_SECRET = `p5c-${'k'.repeat(40)}`;
process.env.THRIV3_APP_ORIGIN = 'http://localhost:5186';
process.env.THRIV3_REPORT_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-p5c-'));

const ORIGIN = 'http://localhost:5186';
const { default: app } = await import('../index.js');
const db = (await import('../db/client.js')).default;
const { createOperator, resetLoginLimits } = await import('../lib/operatorAuth.js');
const { findOrCreateCoach } = await import('../lib/coaches.js');
const { createOutreach } = await import('../lib/outreach.js');
const { respondedAtFrom, RespondedDateError } = await import('../lib/engagementRollup.js');

let server; let base; let cookie;
const api = (url, body) => fetch(`${base}${url}`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, cookie }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

function outreachDraftedOn(day) {
  const athleteId = randomUUID();
  db.prepare("INSERT INTO players (id, created_date, updated_date, full_name, position, public_slug) VALUES (?, 'x', 'x', 'A', 'W', ?)")
    .run(athleteId, randomUUID().slice(0, 10));
  const coach = findOrCreateCoach({ full_name: 'C', email: `${randomUUID()}@example.edu`, school: 'S', sport: 'mens-soccer' });
  const o = createOutreach({ athleteId, coachId: coach.id });
  db.prepare('UPDATE outreach SET drafted_at = ? WHERE id = ?').run(`${day}T09:30:00.000Z`, o.id);
  return o.id;
}
const respondedAt = (id) => db.prepare('SELECT responded_at FROM engagement_rollup WHERE outreach_id = ?').get(id)?.responded_at ?? null;

beforeAll(async () => {
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  resetLoginLimits();
  await createOperator({ email: 'p5c@example.test', password: 'a-perfectly-fine-passphrase' });
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email: 'p5c@example.test', password: 'a-perfectly-fine-passphrase' }),
  });
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
});
afterAll(() => new Promise((r) => server.close(r)));

describe('respondedAtFrom', () => {
  const now = new Date('2026-10-09T15:00:00.000Z');
  it('a calendar day is stored at 12:00 UTC, so no time zone moves it to another day', () => {
    expect(respondedAtFrom('2026-10-05', { draftedAt: '2026-10-01T08:00:00.000Z', now })).toBe('2026-10-05T12:00:00.000Z');
  });
  it('omitted means now, as before', () => {
    expect(respondedAtFrom(null, { now })).toBe(now.toISOString());
  });
  it('refuses the future, a day before the message was prepared, and nonsense', () => {
    expect(() => respondedAtFrom('2026-10-10', { now })).toThrow(RespondedDateError);
    expect(() => respondedAtFrom('2026-09-30', { draftedAt: '2026-10-01T08:00:00.000Z', now })).toThrow(/cannot predate/);
    expect(() => respondedAtFrom('yesterday-ish', { now })).toThrow(/not a date/);
  });
  it('the day the message was prepared is allowed (a same-day reply)', () => {
    expect(respondedAtFrom('2026-10-01', { draftedAt: '2026-10-01T18:00:00.000Z', now })).toBe('2026-10-01T12:00:00.000Z');
  });
});

describe('POST /api/engagement/outreach/:id/responded', () => {
  it('records the day the operator gives', async () => {
    const id = outreachDraftedOn('2026-09-01');
    const r = await api(`/api/engagement/outreach/${id}/responded`, { responded: true, respondedAt: '2026-09-03' });
    expect(r.status).toBe(200);
    expect(respondedAt(id)).toBe('2026-09-03T12:00:00.000Z');
  });

  it('refuses a future day or one before the message, with a reason, and records nothing', async () => {
    const id = outreachDraftedOn('2026-09-01');
    const future = await api(`/api/engagement/outreach/${id}/responded`, { responded: true, respondedAt: '2999-01-01' });
    expect(future).toMatchObject({ status: 400, body: { code: 'RESPONDED_AT_IN_FUTURE' } });
    const early = await api(`/api/engagement/outreach/${id}/responded`, { responded: true, respondedAt: '2026-08-01' });
    expect(early).toMatchObject({ status: 400, body: { code: 'RESPONDED_AT_BEFORE_OUTREACH' } });
    expect(respondedAt(id)).toBeNull();
  });

  it('without a date it is now, exactly as before; clearing still clears', async () => {
    const id = outreachDraftedOn('2026-09-01');
    const before = Date.now();
    await api(`/api/engagement/outreach/${id}/responded`, { responded: true });
    expect(Date.parse(respondedAt(id))).toBeGreaterThanOrEqual(before - 1000);
    await api(`/api/engagement/outreach/${id}/responded`, { responded: false });
    expect(respondedAt(id)).toBeNull();
  });

  it('an unknown outreach is a 404', async () => {
    expect((await api('/api/engagement/outreach/nope/responded', { responded: true, respondedAt: '2026-09-03' })).status).toBe(404);
  });
});
