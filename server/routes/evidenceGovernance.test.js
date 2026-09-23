/**
 * L8C — THE GOVERNANCE MECHANISM, END TO END.
 *
 * L7ZK wrote the rule: a human disposition that changes what Evidence believes
 * carries an authenticated operator. L7ZI built the record, L7ZL built the
 * materialisation guard, and the route shipped with its write path shut
 * because the application had no sign-in. Phase 13K arrived with main and L8B
 * put them in one tree. This proves the whole chain actually joins up:
 *
 *   sign in -> attachOperator -> requireSameOrigin -> requireOperator
 *     -> POST /api/roster-season-trust/disposition
 *     -> operatorFromRequest (req.operator.id, never the body)
 *     -> seasonTrustReview.recordDisposition (the ONE writer)
 *     -> roster_season_trust
 *     -> trustedRosterPredicate removes the season from Evidence reads
 *     -> effectiveInputDigest moves -> arrivals STALE -> reads REFUSE
 *     -> controlled rebuild -> FRESH -> servable again
 *
 * THROWAWAY DATA ONLY. Synthetic programmes, an ephemeral operator, an
 * in-memory database. No canonical disposition is written anywhere here, and
 * none of the 13 unreviewed historical seasons is touched.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.THRIV3_SCRYPT_COST = '14';
process.env.THRIV3_SESSION_SECRET = `l8c-${'k'.repeat(40)}`;
process.env.THRIV3_APP_ORIGIN = 'http://localhost:5183';
process.env.THRIV3_REPORT_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-l8c-'));

const ORIGIN = 'http://localhost:5183';
const EMAIL = 'l8c-operator@example.com';
const PASSWORD = 'a-perfectly-fine-passphrase';

const { default: app } = await import('../index.js');
const { default: db } = await import('../db/client.js');
const { createOperator, resetLoginLimits, createSession, SESSION_COOKIE } =
  await import('../lib/operatorAuth.js');
const { recordBuild, materialisationState, effectiveInputDigest, FRESH, STALE } =
  await import('../lib/recruitingMaterialisation.js');
const { trustedRosterPredicate } = await import('../../shared/roster/seasonTrust.js');
const { datasetManifest, short } = await import('../lib/evidenceBaseline.js');

let server; let base; let cookie; let operatorId;

const SPORT = 'mens-soccer';
const SEASON = '2024';
const KEEP = 'L8C Kept College';
const DROP = 'L8C Dropped College';
const TRUSTED = trustedRosterPredicate('roster_players');

/** Two synthetic programmes, one of which we will later exclude. */
function seedCorpus() {
  db.exec("DELETE FROM roster_players WHERE college_name LIKE 'L8C %'");
  db.exec("DELETE FROM roster_season_trust WHERE college_name LIKE 'L8C %'");
  db.exec("DELETE FROM colleges WHERE name LIKE 'L8C %'");
  const NOW = '2026-09-23T00:00:00.000Z';
  const college = db.prepare(`INSERT INTO colleges
      (id, created_date, updated_date, name, sport, division, active)
    VALUES (?, @now, @now, ?, ?, ?, 1)`.replace(/@now/g, `'${NOW}'`));
  const player = db.prepare(`INSERT INTO roster_players
      (created_date, updated_date, college_name, sport, division, season, player_name,
       class_year_label, position, minutes_played)
    VALUES ('${NOW}', '${NOW}', ?, ?, 'NCAA D3', ?, ?, 'Freshman', 'Forward', 900)`);
  for (const [i, name] of [KEEP, DROP].entries()) {
    college.run(`l8c-${i}`, name, SPORT, 'NCAA D3');
    for (const n of ['Alpha', 'Bravo', 'Charlie']) player.run(name, SPORT, SEASON, `${name} ${n}`);
  }
  /* A MACHINE DIAGNOSIS, and nothing else. The human half stays null. */
  db.prepare(`INSERT INTO roster_season_trust
      (season, college_name, sport, diagnosis, diagnosis_evidence, diagnosed_at)
    VALUES (?, ?, ?, 'SEASON_IDENTITY_UNPROVEN', '{"l8c":true}', '2026-09-23T00:00:00.000Z')`)
    .run(SEASON, DROP, SPORT);
  /* Stamp a build so the materialisation is FRESH and an exclusion is allowed. */
  recordBuild({ sport: SPORT, digest: effectiveInputDigest(SPORT) });
}

const rosterVisibleToEvidence = (name) => db.prepare(
  `SELECT COUNT(*) n FROM roster_players
    WHERE college_name = ? AND sport = ? AND season = ? AND ${TRUSTED}`,
).get(name, SPORT, SEASON).n;

const post = (body, opts = {}) => fetch(`${base}/api/roster-season-trust/disposition`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(opts.origin === null ? {} : { origin: opts.origin ?? ORIGIN }),
    ...(opts.cookie === null ? {} : { cookie: opts.cookie ?? cookie }),
  },
  body: JSON.stringify(body),
});

const dispose = (extra, opts) => post({
  season: SEASON, college_name: DROP, sport: SPORT, ...extra,
}, opts);

const rowFor = (name) => db.prepare(
  'SELECT * FROM roster_season_trust WHERE season = ? AND college_name = ? AND sport = ?',
).get(SEASON, name, SPORT);

beforeAll(async () => {
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

beforeEach(async () => {
  db.exec('DELETE FROM operator_sessions; DELETE FROM operator_users;');
  resetLoginLimits();
  operatorId = (await createOperator({ email: EMAIL, password: PASSWORD })).id;
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  seedCorpus();
});

/* ------------------------------------------------------------------------ */

describe('L8C/1 — identity comes from the session, never the request', () => {
  it('populates req.operator for an authenticated request', async () => {
    const me = await (await fetch(`${base}/api/auth/me`, { headers: { origin: ORIGIN, cookie } })).json();
    expect(me.operator.email).toBe(EMAIL);
  });

  it.each([
    'reviewed_by_operator_id', 'reviewed_at', 'diagnosis', 'diagnosis_evidence',
    'diagnosed_at', 'previous_disposition', 'previous_reviewed_at',
  ])('refuses the server-owned field %s rather than ignoring it', async (field) => {
    const res = await dispose({
      disposition: 'RETAIN', disposition_evidence: 'probe',
      expected_disposition: null, [field]: 'attacker',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/set by the server/);
    expect(rowFor(DROP).disposition).toBeNull();
  });

  it.each(['reviewer', 'operator_id', 'operator_email', 'reviewed_by'])(
    'refuses the unknown identity-shaped field %s', async (field) => {
      const res = await dispose({
        disposition: 'RETAIN', disposition_evidence: 'probe',
        expected_disposition: null, [field]: 'attacker@example.com',
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/unknown field/);
      expect(rowFor(DROP).disposition).toBeNull();
    },
  );
});

describe('L8C/2 — the authenticated write contract', () => {
  it('records RETAIN with the server\'s identity and the server clock', async () => {
    const before = Date.now();
    const res = await dispose({
      disposition: 'RETAIN',
      disposition_evidence: 'L8C throwaway probe — not a product decision',
      next_action: 'RE_ACQUIRE',
      expected_disposition: null,
    });
    expect(res.status).toBe(200);
    const row = rowFor(DROP);
    expect(row.college_name).toBe(DROP);
    expect(row.season).toBe(SEASON);
    expect(row.sport).toBe(SPORT);
    expect(row.disposition).toBe('RETAIN');
    expect(row.disposition_evidence).toMatch(/throwaway probe/);
    expect(row.reviewed_by_operator_id).toBe(operatorId);
    expect(Date.parse(row.reviewed_at)).toBeGreaterThanOrEqual(before - 1000);
    expect(row.next_action).toBe('RE_ACQUIRE');
    /* The machine half is untouched by a human decision. */
    expect(row.diagnosis).toBe('SEASON_IDENTITY_UNPROVEN');
  });

  it('refuses an unauthenticated write', async () => {
    const res = await dispose({
      disposition: 'RETAIN', disposition_evidence: 'x', expected_disposition: null,
    }, { cookie: null });
    expect([401, 503]).toContain(res.status);
    expect(rowFor(DROP).disposition).toBeNull();
  });

  it('refuses an invalid session', async () => {
    const res = await dispose({
      disposition: 'RETAIN', disposition_evidence: 'x', expected_disposition: null,
    }, { cookie: `${SESSION_COOKIE}=${'z'.repeat(43)}` });
    expect([401, 503]).toContain(res.status);
    expect(rowFor(DROP).disposition).toBeNull();
  });

  it('refuses an expired session', async () => {
    /* Issued in the past, so the row itself is past its deadline. */
    const stale = createSession(operatorId, { now: Date.now() - 400 * 86_400_000 });
    const res = await dispose({
      disposition: 'RETAIN', disposition_evidence: 'x', expected_disposition: null,
    }, { cookie: `${SESSION_COOKIE}=${stale}` });
    expect([401, 503]).toContain(res.status);
    expect(rowFor(DROP).disposition).toBeNull();
  });

  it('refuses a cross-origin write even with a valid session', async () => {
    const res = await dispose({
      disposition: 'RETAIN', disposition_evidence: 'x', expected_disposition: null,
    }, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(rowFor(DROP).disposition).toBeNull();
  });

  it('refuses a decision taken against a stale reading', async () => {
    const first = await dispose({
      disposition: 'RETAIN', disposition_evidence: 'first', expected_disposition: null,
    });
    expect(first.status).toBe(200);
    const second = await dispose({
      disposition: 'RETAIN', disposition_evidence: 'second', expected_disposition: null,
    });
    expect(second.status).toBe(409);
    expect((await second.json()).error).toMatch(/has moved since it was read/);
    expect(rowFor(DROP).disposition_evidence).toBe('first');
  });

  it('refuses a disposition outside the vocabulary', async () => {
    const res = await dispose({
      disposition: 'PROBABLY_FINE', disposition_evidence: 'x', expected_disposition: null,
    });
    expect(res.status).toBe(400);
    expect(rowFor(DROP).disposition).toBeNull();
  });

  it('refuses a disposition with no evidence', async () => {
    const res = await dispose({
      disposition: 'RETAIN', disposition_evidence: '   ', expected_disposition: null,
    });
    expect(res.status).toBe(400);
    expect(rowFor(DROP).disposition).toBeNull();
  });
});

describe('L8C/3 — only a human EXCLUDE removes Evidence', () => {
  it('a machine diagnosis alone does not exclude', () => {
    expect(rowFor(DROP).diagnosis).toBe('SEASON_IDENTITY_UNPROVEN');
    expect(rowFor(DROP).disposition).toBeNull();
    expect(rosterVisibleToEvidence(DROP)).toBe(3);
    expect(materialisationState(SPORT).state).toBe(FRESH);
  });

  it('RETAIN does not exclude', async () => {
    const res = await dispose({
      disposition: 'RETAIN', disposition_evidence: 'keep it', expected_disposition: null,
    });
    expect(res.status).toBe(200);
    expect(rosterVisibleToEvidence(DROP)).toBe(3);
    expect(materialisationState(SPORT).state).toBe(FRESH);
  });

  it('EXCLUDE_FROM_EVIDENCE removes it, stales the materialisation, and refuses to serve', async () => {
    const digestBefore = effectiveInputDigest(SPORT);
    const manifestBefore = short(datasetManifest().digest);

    const res = await dispose({
      disposition: 'EXCLUDE_FROM_EVIDENCE',
      disposition_evidence: 'L8C throwaway exclusion — synthetic programme',
      expected_disposition: null,
    });
    expect(res.status).toBe(200);

    // 1. the record carries the authenticated reviewer
    const row = rowFor(DROP);
    expect(row.disposition).toBe('EXCLUDE_FROM_EVIDENCE');
    expect(row.reviewed_by_operator_id).toBe(operatorId);
    expect(row.reviewed_at).toBeTruthy();

    // 2. Evidence reads no longer see it; the untouched programme is unaffected
    expect(rosterVisibleToEvidence(DROP)).toBe(0);
    expect(rosterVisibleToEvidence(KEEP)).toBe(3);

    // 3. the effective recruiting input changed
    expect(effectiveInputDigest(SPORT)).not.toBe(digestBefore);

    // 4. arrivals are STALE
    expect(materialisationState(SPORT).state).toBe(STALE);

    // 5. a stale materialisation cannot be served silently
    const patterns = await import('../lib/recruitingPatterns.js');
    expect(() => patterns.loadProgrammePatterns(SPORT, KEEP)).toThrow(/stale|STALE/i);

    // 6. and product identity moved, because the data behind it did
    expect(short(datasetManifest().digest)).not.toBe(manifestBefore);
  });
});

describe('L8C/4 — controlled rebuild, and the way back', () => {
  it('a rebuild restores FRESH, keeps the exclusion, and makes Evidence servable', async () => {
    await dispose({
      disposition: 'EXCLUDE_FROM_EVIDENCE',
      disposition_evidence: 'L8C throwaway exclusion',
      expected_disposition: null,
    });
    const before = materialisationState(SPORT);
    expect(before.state).toBe(STALE);

    /* The approved rebuild: stamp the digest the exclusion produced. */
    recordBuild({ sport: SPORT, digest: effectiveInputDigest(SPORT) });

    const after = materialisationState(SPORT);
    expect(after.state).toBe(FRESH);
    expect(after.generation).toBe(before.generation + 1);
    expect(after.expected).toBe(after.actual);

    /* The exclusion survives the rebuild — it is not what a rebuild undoes. */
    expect(rosterVisibleToEvidence(DROP)).toBe(0);
    expect(rosterVisibleToEvidence(KEEP)).toBe(3);

    const patterns = await import('../lib/recruitingPatterns.js');
    expect(() => patterns.loadProgrammePatterns(SPORT, KEEP)).not.toThrow();
  });

  it('RETAIN is the documented way back, and it stales again until rebuilt', async () => {
    await dispose({
      disposition: 'EXCLUDE_FROM_EVIDENCE',
      disposition_evidence: 'L8C throwaway exclusion',
      expected_disposition: null,
    });
    recordBuild({ sport: SPORT, digest: effectiveInputDigest(SPORT) });
    expect(rosterVisibleToEvidence(DROP)).toBe(0);

    /*
     * No new vocabulary is invented for this. RETAIN against the recorded
     * EXCLUDE is the existing contract, and optimistic concurrency means the
     * caller must state what it is deciding against.
     */
    const res = await dispose({
      disposition: 'RETAIN',
      disposition_evidence: 'L8C throwaway repair',
      expected_disposition: 'EXCLUDE_FROM_EVIDENCE',
    });
    expect(res.status).toBe(200);

    const row = rowFor(DROP);
    expect(row.disposition).toBe('RETAIN');
    expect(row.previous_disposition).toBe('EXCLUDE_FROM_EVIDENCE');
    expect(row.reviewed_by_operator_id).toBe(operatorId);

    // Evidence sees it again, and the input moved back, so a rebuild is owed.
    expect(rosterVisibleToEvidence(DROP)).toBe(3);
    expect(materialisationState(SPORT).state).toBe(STALE);
    recordBuild({ sport: SPORT, digest: effectiveInputDigest(SPORT) });
    expect(materialisationState(SPORT).state).toBe(FRESH);
  });
});

describe('L8C/5 — what the record can later establish', () => {
  it('answers what, which disposition, who, when, why and what next', async () => {
    await dispose({
      disposition: 'RETAIN',
      disposition_evidence: 'the 2024 page was verified against the archived roster',
      next_action: 'RE_ACQUIRE',
      expected_disposition: null,
    });
    const row = rowFor(DROP);
    expect({
      what: `${row.college_name} / ${row.sport} / ${row.season}`,
      disposition: row.disposition,
      who: row.reviewed_by_operator_id,
      why: row.disposition_evidence,
      next: row.next_action,
    }).toEqual({
      what: `${DROP} / ${SPORT} / ${SEASON}`,
      disposition: 'RETAIN',
      who: operatorId,
      why: 'the 2024 page was verified against the archived roster',
      next: 'RE_ACQUIRE',
    });
    expect(Date.parse(row.reviewed_at)).toBeGreaterThan(0);
    /* And the operator id resolves to a real account, not a free-text name. */
    expect(db.prepare('SELECT email FROM operator_users WHERE id = ?').get(row.reviewed_by_operator_id).email)
      .toBe(EMAIL);
  });

  it('keeps the three layers distinct: attempt, diagnosis, disposition', async () => {
    const unreviewed = rowFor(DROP);
    expect(unreviewed.diagnosis).toBeTruthy();
    expect(unreviewed.disposition).toBeNull();
    expect(unreviewed.reviewed_by_operator_id).toBeNull();

    await dispose({
      disposition: 'RETAIN', disposition_evidence: 'x', expected_disposition: null,
    });
    const reviewed = rowFor(DROP);
    /* The human decision did not rewrite the machine's finding. */
    expect(reviewed.diagnosis).toBe(unreviewed.diagnosis);
    expect(reviewed.diagnosis_evidence).toBe(unreviewed.diagnosis_evidence);
    expect(reviewed.diagnosed_at).toBe(unreviewed.diagnosed_at);
  });
});

describe('L8C/6 — the read model keeps unreviewed, retained and excluded apart', () => {
  const wireFor = async (name) => {
    const res = await fetch(`${base}/api/roster-season-trust`, { headers: { origin: ORIGIN, cookie } });
    const body = await res.json();
    return body.records.find((r) => r.identity.college_name === name);
  };

  it('reports three different states, and never conflates them', async () => {
    /*
     * The distinction the 13 depend on. "Nobody has decided" is not "somebody
     * decided to keep it", and neither is "it is out of Evidence" -- and the
     * queue has to be able to say which, or a review UI would present a
     * pending season as a settled one.
     */
    const pending = await wireFor(DROP);
    expect(pending.operator.disposition).toBeNull();
    expect(pending.operator.attribution).toBe('NOT_REVIEWED');
    expect(pending.effect.review_state).toBe('PENDING_REVIEW');
    expect(pending.effect.excluded_from_evidence).toBe(false);
    /* The machine half is populated and says nothing about the human half. */
    expect(pending.machine.diagnosis).toBe('SEASON_IDENTITY_UNPROVEN');

    await dispose({
      disposition: 'RETAIN', disposition_evidence: 'keep', expected_disposition: null,
    });
    const retained = await wireFor(DROP);
    expect(retained.operator.disposition).toBe('RETAIN');
    expect(retained.operator.attribution).toBe('ATTRIBUTED');
    expect(retained.effect.review_state).toBe('DISPOSITIONED');
    expect(retained.effect.excluded_from_evidence).toBe(false);

    await dispose({
      disposition: 'EXCLUDE_FROM_EVIDENCE',
      disposition_evidence: 'L8C throwaway exclusion',
      expected_disposition: 'RETAIN',
    });
    const excluded = await wireFor(DROP);
    expect(excluded.operator.disposition).toBe('EXCLUDE_FROM_EVIDENCE');
    expect(excluded.effect.review_state).toBe('DISPOSITIONED');
    expect(excluded.effect.excluded_from_evidence).toBe(true);

    /* All three are distinguishable from one another on the wire. */
    expect(new Set([
      pending.effect.review_state + pending.effect.excluded_from_evidence,
      retained.effect.review_state + retained.effect.excluded_from_evidence,
      excluded.effect.review_state + excluded.effect.excluded_from_evidence,
    ]).size).toBe(3);
  });
});
