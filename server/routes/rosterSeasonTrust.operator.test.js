/**
 * L8B-3 — THE DOOR L7ZK BUILT, AND THE KEY MAIN BROUGHT.
 *
 * `rosterSeasonTrust.js` shipped with its write path built and shut: every new
 * human disposition needs an authenticated operator, and the application had
 * none, so `operatorFromRequest` returned null and the POST answered 503.
 *
 * Main carries Phase 13K. This binds the REAL merged application to a port and
 * proves the two halves meet -- that server-owned identity reaches
 * `recordDisposition`, and that nothing a caller can write reaches it.
 *
 * Throwaway database, throwaway operator. Nothing here touches canonical trust.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.THRIV3_SCRYPT_COST = '14';
process.env.THRIV3_SESSION_SECRET = `l8b3-${'q'.repeat(40)}`;
process.env.THRIV3_APP_ORIGIN = 'http://localhost:5183';
process.env.THRIV3_REPORT_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-l8b3-'));

const ORIGIN = 'http://localhost:5183';
const EMAIL = 'l8b3-operator@example.com';
const PASSWORD = 'a-perfectly-fine-passphrase';

const { default: app } = await import('../index.js');
const { default: db } = await import('../db/client.js');
const { createOperator, resetLoginLimits } = await import('../lib/operatorAuth.js');

let server; let base; let cookie; let operatorId;

/* A STRING. Bound as a number this TEXT column stores "2024.0" and never matches again. */
const SEASON = { season: '2024', college_name: 'L8B3 Fixture College', sport: 'mens-soccer' };

beforeAll(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(async () => {
  db.exec('DELETE FROM operator_sessions; DELETE FROM operator_users; DELETE FROM roster_season_trust;');
  resetLoginLimits();
  const op = await createOperator({ email: EMAIL, password: PASSWORD });
  operatorId = op.id;
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  db.prepare(`INSERT INTO roster_season_trust
      (college_name, sport, season, diagnosis, diagnosis_evidence, diagnosed_at)
    VALUES (?, ?, ?, 'SEASON_IDENTITY_UNPROVEN', '{"probe":true}', '2026-09-23T00:00:00.000Z')`)
    .run(SEASON.college_name, SEASON.sport, SEASON.season);
});

const post = (body, withCookie = true) => fetch(`${base}/api/roster-season-trust/disposition`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: ORIGIN,
    ...(withCookie ? { cookie } : {}),
  },
  body: JSON.stringify(body),
});

describe('L8B-3 operator identity reaches the trust review', () => {
  it('populates req.operator with the signed-in identity', async () => {
    const res = await fetch(`${base}/api/auth/me`, { headers: { origin: ORIGIN, cookie } });
    expect(res.status).toBe(200);
    const me = await res.json();
    /*
     * `/auth/me` exposes the EMAIL and not the id, deliberately: the id is an
     * internal key and the wire has no use for it. So the email is proved here
     * and the id is proved where it actually matters -- by the row
     * `recordDisposition` writes, below, which can only have come from
     * `req.operator.id`.
     */
    expect(me.operator.email).toBe(EMAIL);
  });

  it('still refuses 503 when there is no session', async () => {
    const res = await post({ ...SEASON, disposition: 'RETAIN', disposition_evidence: 'x' }, false);
    expect([401, 503]).toContain(res.status);
  });

  it('refuses a caller-supplied reviewer rather than ignoring it', async () => {
    const res = await post({
      ...SEASON, disposition: 'RETAIN', disposition_evidence: 'probe',
      expected_disposition: null, reviewed_by_operator_id: 'somebody-else',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/set by the server/);
  });

  it('records RETAIN with the SERVER\'s operator id and the server clock', async () => {
    const before = Date.now();
    const res = await post({
      ...SEASON, disposition: 'RETAIN',
      disposition_evidence: 'L8B-3 throwaway probe, not a product decision',
      expected_disposition: null,
    });
    expect(res.status).toBe(200);
    const { record } = await res.json();
    expect(record.operator.disposition).toBe('RETAIN');
    expect(record.operator.reviewed_by_operator_id).toBe(operatorId);
    expect(Date.parse(record.operator.reviewed_at)).toBeGreaterThanOrEqual(before - 1000);
    const row = db.prepare(`SELECT reviewed_by_operator_id FROM roster_season_trust
      WHERE college_name = ? AND sport = ? AND season = ?`)
      .get(SEASON.college_name, SEASON.sport, SEASON.season);
    expect(row.reviewed_by_operator_id).toBe(operatorId);
  });

  it('holds optimistic concurrency against a stale expected_disposition', async () => {
    const first = await post({
      ...SEASON, disposition: 'RETAIN', disposition_evidence: 'first', expected_disposition: null,
    });
    expect(first.status).toBe(200);
    const res = await post({
      ...SEASON, disposition: 'RETAIN', disposition_evidence: 'second', expected_disposition: null,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/has moved since it was read/);
  });

  it('keeps EXCLUDE_FROM_EVIDENCE behind its own independent guard', async () => {
    const res = await post({
      ...SEASON, disposition: 'EXCLUDE_FROM_EVIDENCE', disposition_evidence: 'probe',
      expected_disposition: null,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    console.log('    EXCLUDE refusal:', body.error);
  });
});
