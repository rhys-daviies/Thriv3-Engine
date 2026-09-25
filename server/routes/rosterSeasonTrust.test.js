import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import db from '../db/client.js';
import { rosterSeasonTrustRouter, operatorFromRequest } from './rosterSeasonTrust.js';
import {
  recordDisposition, attributionOf, exclusionBlockedReason,
  LEGACY_UNATTRIBUTED, ATTRIBUTED, NOT_REVIEWED,
} from '../lib/seasonTrustReview.js';
import { DIAGNOSIS, DISPOSITION } from '../../shared/roster/seasonTrust.js';
import { SEASONS } from '../../shared/philosophy.js';

/**
 * L7ZK — the door, and the fact that it is locked.
 *
 * L7ZI separated a machine diagnosis from an operator decision and L7ZJ held
 * that separation by restraint: the recorder simply did not contain the word
 * EXCLUDE_FROM_EVIDENCE. From L7ZK the rule is stronger — every NEW human
 * disposition carries an authenticated operator identity — and this application
 * has no authentication at all.
 *
 * So the write path is built and disabled, and these prove the shape of the
 * refusal rather than the shape of a feature:
 *
 *   no identity              -> 503, naming the prerequisite
 *   a caller-supplied one    -> 400, naming the field
 *   EXCLUDE even with one    -> refused for a SECOND, independent reason
 *   a stale decision         -> 409 rather than a silent overwrite
 *
 * The two RETAIN rows L7ZJ wrote carry a null reviewer. They are grandfathered
 * and readable, and they are reported as LEGACY_UNATTRIBUTED rather than as
 * attributed to nobody — a fact about the record, not a gap in it.
 */

/**
 * Call a route handler without standing up a server, as
 * `rosterGaps.test.js` does. It also lets a test inject `req.operator`, which
 * is the one thing a real request cannot currently carry — and the whole
 * subject of this file.
 */
function call(method, url, { body = undefined, operator = undefined } = {}) {
  const [pathname, query] = url.split('?');
  return new Promise((resolve) => {
    const req = {
      method, url, path: pathname, body,
      query: Object.fromEntries(new URLSearchParams(query ?? '')),
      params: {},
      ...(operator ? { operator } : {}),
    };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(v) { resolve({ status: this.statusCode, body: v }); return this; },
    };
    const layers = rosterSeasonTrustRouter.stack.filter((l) => l.route
      && l.route.path === pathname && l.route.methods[method.toLowerCase()]);
    if (!layers.length) return resolve({ status: 404, body: { error: 'no route' } });
    return layers[0].route.stack[0].handle(req, res, () => {});
  });
}
const get = (url) => call('GET', url);
const post = (url, body, operator) => call('POST', url, { body, operator });

const COLS = ['college_name', 'sport', 'division', 'season', 'player_name', 'class_year_label',
  'position', 'minutes_played', 'games_played', 'games_started',
  'estimated_graduation_year', 'eligibility_end_year', 'conference'];

const INSERT_TRUST = `INSERT INTO roster_season_trust
  (season, college_name, sport, diagnosis, diagnosis_evidence, diagnosed_at,
   disposition, disposition_evidence, reviewed_at, reviewed_by_operator_id, next_action)
  VALUES (@season, @college_name, @sport, @diagnosis, @diagnosis_evidence, @diagnosed_at,
          @disposition, @disposition_evidence, @reviewed_at, @reviewed_by_operator_id, @next_action)`;

const SEASON = SEASONS.map(String)[3];   // 2025

/** One programme with a roster, so `trustQueue` can count its rows. */
function seed({ name, sport, division }) {
  const ins = db.prepare(`INSERT INTO roster_players (id, created_date, updated_date, ${COLS.join(', ')})
    VALUES (?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ${COLS.map(() => '?').join(', ')})`);
  for (let i = 0; i < 8; i += 1) {
    ins.run(`${name}|${sport}|${SEASON}|${i}`, name, sport, division, SEASON,
      `${name} P${i}`, 'Fr.', 'MIDFIELD', 600 - i * 10, 18, 16,
      Number(SEASON) + 4, Number(SEASON) + 4, 'Test Conf');
  }
  db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, active)
    VALUES (?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ?, ?, ?, ?, 1)`)
    .run(`${name}|${sport}`, name, sport, division, 'Test Conf');
}

const trust = (over = {}) => ({
  season: SEASON, college_name: 'Pending College', sport: 'mens-soccer',
  diagnosis: DIAGNOSIS.SEASON_IDENTITY_UNPROVEN, diagnosis_evidence: 'no season evidence survives',
  diagnosed_at: '2026-09-19T00:00:00Z',
  disposition: null, disposition_evidence: null, reviewed_at: null,
  reviewed_by_operator_id: null, next_action: null, ...over,
});

beforeAll(() => {
  db.prepare('DELETE FROM roster_players').run();
  db.prepare('DELETE FROM colleges').run();
  seed({ name: 'Pending College', sport: 'mens-soccer', division: 'NCAA D1' });
  seed({ name: 'Legacy College', sport: 'mens-soccer', division: 'NCAA D2' });
  seed({ name: 'Naia College', sport: 'womens-soccer', division: 'NAIA' });
});

beforeEach(() => {
  db.prepare('DELETE FROM roster_season_trust').run();
  const ins = db.prepare(INSERT_TRUST);
  ins.run(trust());
  /* The grandfathered shape: RETAIN with no reviewer, exactly as L7ZJ wrote. */
  ins.run(trust({
    college_name: 'Legacy College', diagnosis: DIAGNOSIS.PROBABLE_DUPLICATE_CAPTURE,
    diagnosis_evidence: 'identical squad to the prior season; bare route; no provenance',
    disposition: DISPOSITION.RETAIN, disposition_evidence: 'retained pending a better source',
    reviewed_at: '2026-09-19T00:00:00Z',
  }));
  ins.run(trust({ college_name: 'Naia College', sport: 'womens-soccer' }));
});

/* -------------------------------------------------------------------------- */

describe('L7ZK — GET, the half that works', () => {
  it('returns every record with its three layers kept apart', async () => {
    const res = await get('/roster-season-trust');
    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(3);
    const r = res.body.records[0];
    /*
     * Machine and human halves never flatten into one status, the L7K lesson.
     * L8D adds `review_evidence`, and it is a SIXTH sibling rather than a field
     * folded into `machine`: it is neither a measurement nor a judgement, it is
     * the stored provenance a reviewer reads while deciding. Keeping it apart
     * is the same rule as the two halves it sits beside.
     */
    expect(Object.keys(r).sort()).toEqual(
      ['effect', 'identity', 'machine', 'operator', 'programme', 'review_evidence']);
    expect(r.machine).toHaveProperty('diagnosis');
    expect(r.operator).toHaveProperty('disposition');
    expect(r).not.toHaveProperty('status');
  });

  it('carries the facts a decision would need, without recomputing them', async () => {
    const { body } = await get('/roster-season-trust');
    for (const r of body.records) {
      expect(r.machine.diagnosis_evidence).toBeTruthy();
      expect(r.programme.row_count).toBeGreaterThan(0);
      expect(r.programme).toHaveProperty('association');
      expect(r.effect).toHaveProperty('evidence_exposed');
      expect(r.effect).toHaveProperty('excluded_from_evidence');
    }
  });

  it('preserves the L7ZJ order: exposed first, NCAA first, then identity', async () => {
    const { body } = await get('/roster-season-trust');
    const rank = (r) => [Number(!r.effect.evidence_exposed),
      Number(r.programme.association !== 'NCAA')].join('');
    const ranks = body.records.map(rank);
    expect([...ranks].sort()).toEqual(ranks);
  });

  it('says the write path is closed, so nobody learns it only by failing', async () => {
    const { body } = await get('/roster-season-trust');
    expect(body.write.enabled).toBe(false);
    expect(body.write.reason).toMatch(/authenticated operator/i);
    /*
     * L7ZL made this per sport: whether an exclusion is technically safe now
     * depends on whether that sport's derived recruiting data can be verified
     * against the roster, so one generic sentence would no longer be true.
     */
    for (const sport of ['mens-soccer', 'womens-soccer']) {
      expect(body.write.exclude_blocked_by_sport[sport]).toMatch(/recruiting_arrivals/);
    }
  });

  it('reports a grandfathered RETAIN as LEGACY_UNATTRIBUTED, not as nobody', async () => {
    /*
     * The record is not incomplete: it is a decision taken before the
     * attribution rule existed. Rendering the null as an empty reviewer would
     * invite someone to "fix" it by backfilling an identity that was never
     * there.
     */
    const { body } = await get('/roster-season-trust');
    const legacy = body.records.find((r) => r.identity.college_name === 'Legacy College');
    expect(legacy.operator.disposition).toBe('RETAIN');
    expect(legacy.operator.reviewed_by_operator_id).toBeNull();
    expect(legacy.operator.attribution).toBe(LEGACY_UNATTRIBUTED);
    const pending = body.records.find((r) => r.identity.college_name === 'Pending College');
    expect(pending.operator.attribution).toBe(NOT_REVIEWED);
  });

  it('filters without reordering, and refuses a filter it does not know', async () => {
    const all = (await get('/roster-season-trust')).body.records;
    const ncaa = (await get('/roster-season-trust?association=NCAA')).body.records;
    expect(ncaa.map((r) => r.identity.college_name))
      .toEqual(all.filter((r) => r.programme.association === 'NCAA').map((r) => r.identity.college_name));

    const pending = await get('/roster-season-trust?reviewState=PENDING_REVIEW');
    expect(pending.body.records).toHaveLength(2);
    expect(pending.body.summary.pending_review).toBe(2);

    const bad = await get('/roster-season-trust?colour=blue');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/unknown filter/);

    const badValue = await get('/roster-season-trust?diagnosis=LOOKS_ODD');
    expect(badValue.status).toBe(400);
  });
});

describe('L7ZK — POST, the half that is deliberately shut', () => {
  const body = (over = {}) => ({
    college_name: 'Pending College', sport: 'mens-soccer', season: SEASON,
    disposition: DISPOSITION.RETAIN,
    disposition_evidence: 'reviewed and kept on the record',
    expected_disposition: null, ...over,
  });

  it('refuses without an authenticated operator, and names the prerequisite', async () => {
    const res = await post('/roster-season-trust/disposition', body());
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/no authenticated operator identity/i);
    expect(res.body.prerequisite).toMatch(/sign-in/i);
    expect(db.prepare('SELECT disposition FROM roster_season_trust WHERE college_name = ?')
      .get('Pending College').disposition).toBeNull();
  });

  it('refuses an EXCLUDE just the same, and writes nothing', async () => {
    const res = await post('/roster-season-trust/disposition',
      body({ disposition: DISPOSITION.EXCLUDE_FROM_EVIDENCE }));
    expect(res.status).toBe(503);
    expect(db.prepare('SELECT COUNT(*) n FROM roster_season_trust WHERE disposition = ?')
      .get(DISPOSITION.EXCLUDE_FROM_EVIDENCE).n).toBe(0);
  });

  it('REFUSES a caller-supplied reviewer rather than ignoring it', async () => {
    /*
     * The most important refusal in this file. Dropping the field silently
     * would return 200 to a client that believes it attributed the decision to
     * someone else — the governance rule failing invisibly, at the one point it
     * exists for. 400, naming the field.
     */
    const res = await post('/roster-season-trust/disposition',
      body({ reviewed_by_operator_id: 'operator-b' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reviewed_by_operator_id/);
    expect(res.body.error).toMatch(/set by the server/i);
  });

  it('REFUSES a caller-supplied review time', async () => {
    const res = await post('/roster-season-trust/disposition',
      body({ reviewed_at: '2020-01-01T00:00:00Z' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reviewed_at/);
  });

  it('refuses an attempt to set the machine half from the wire', async () => {
    // The route acts on a record; it does not author findings.
    const res = await post('/roster-season-trust/disposition',
      body({ diagnosis: DIAGNOSIS.DEFINITE_MISMATCH }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/diagnosis/);
  });

  it('refuses an unknown field by name', async () => {
    const res = await post('/roster-season-trust/disposition', body({ notes: 'hello' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown field\(s\): notes/);
  });

  it('judges identity before payload, so a refusal teaches nothing', async () => {
    /*
     * A malformed body from an unauthenticated caller must still answer 503.
     * A 400 listing payload problems would help someone form a better request
     * for an action they may not take at all.
     */
    const res = await post('/roster-season-trust/disposition',
      { college_name: 'Pending College', sport: 'mens-soccer', season: SEASON,
        disposition: 'NONSENSE', disposition_evidence: '', expected_disposition: null });
    expect(res.status).toBe(503);
  });

  it('has exactly one address for the identity, and it never reads the body', () => {
    expect(operatorFromRequest({})).toBeNull();
    expect(operatorFromRequest({ body: { reviewed_by_operator_id: 'x' } })).toBeNull();
    expect(operatorFromRequest({ headers: { 'x-operator-id': 'x' } })).toBeNull();
    // The shape a future sign-in would populate, and the only one honoured.
    expect(operatorFromRequest({ operator: { id: 'op-1' } })).toBe('op-1');
  });
});

describe('L7ZK — the store refuses the same things, without a route', () => {
  const call = (over = {}) => recordDisposition({
    season: SEASON, college_name: 'Pending College', sport: 'mens-soccer',
    disposition: DISPOSITION.RETAIN, evidence: 'kept on the record',
    expectedDisposition: null, operatorId: 'op-1', ...over,
  });

  it('refuses with no operator id, whatever else is right', () => {
    for (const operatorId of [null, undefined, '', '   ']) {
      const r = call({ operatorId });
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/requires an authenticated operator/);
    }
  });

  it('accepts an authenticated RETAIN, and owns the identity and the clock', () => {
    const r = call({ now: new Date('2026-09-19T12:00:00Z') });
    expect(r.ok).toBe(true);
    expect(r.record.disposition).toBe(DISPOSITION.RETAIN);
    expect(r.record.reviewed_by_operator_id).toBe('op-1');
    expect(r.record.reviewed_at).toBe('2026-09-19T12:00:00.000Z');
    expect(attributionOf(r.record)).toBe(ATTRIBUTED);
    // The diagnosis is not touched by the decision.
    expect(r.record.diagnosis).toBe(DIAGNOSIS.SEASON_IDENTITY_UNPROVEN);
  });

  it('refuses EXCLUDE for its own reason, even fully authenticated', () => {
    /*
     * TWO INDEPENDENT LOCKS. Authentication is one; the materialised
     * `recruiting_arrivals` is the other, and it would still be shut the day
     * sign-in arrives.
     */
    const r = call({ disposition: DISPOSITION.EXCLUDE_FROM_EVIDENCE });
    expect(r.ok).toBe(false);
    // L7ZL: the reason is now per sport, and names the materialisation state.
    expect(r.reason).toBe(exclusionBlockedReason('mens-soccer'));
    expect(r.reason).toMatch(/recruiting_arrivals/);
  });

  it('requires evidence, and refuses an unknown disposition', () => {
    expect(call({ evidence: '  ' }).reason).toMatch(/needs evidence/);
    expect(call({ disposition: 'PROBABLY_FINE' }).reason).toMatch(/disposition must be one of/);
  });

  it('acts on an existing record and will not author one', () => {
    const r = call({ college_name: 'Nowhere College' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no trust record/);
    expect(db.prepare('SELECT COUNT(*) n FROM roster_season_trust').get().n).toBe(3);
  });

  it('refuses a decision taken on a stale reading', () => {
    /*
     * Two operators reading the same queue must not silently overwrite each
     * other. The caller states what it believed the disposition to be; a
     * mismatch is a conflict, not an update.
     */
    expect(call({ expectedDisposition: null }).ok).toBe(true);      // A decides
    const b = call({ expectedDisposition: null, operatorId: 'op-2' });  // B had read earlier
    expect(b.ok).toBe(false);
    expect(b.reason).toMatch(/has moved since it was read/);
    expect(db.prepare('SELECT reviewed_by_operator_id FROM roster_season_trust WHERE college_name = ?')
      .get('Pending College').reviewed_by_operator_id).toBe('op-1');
  });

  it('refuses a caller that did not read first', () => {
    const r = recordDisposition({
      season: SEASON, college_name: 'Pending College', sport: 'mens-soccer',
      disposition: DISPOSITION.RETAIN, evidence: 'x', operatorId: 'op-1',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/expectedDisposition is required/);
  });

  it('keeps bounded history across a transition', () => {
    call({ evidence: 'first decision', now: new Date('2026-09-19T10:00:00Z') });
    const second = call({
      expectedDisposition: DISPOSITION.RETAIN, evidence: 'reconsidered, still retained',
      operatorId: 'op-2', now: new Date('2026-09-20T10:00:00Z'),
    });
    expect(second.ok).toBe(true);
    expect(second.record.previous_disposition).toBe(DISPOSITION.RETAIN);
    expect(second.record.previous_reviewed_at).toBe('2026-09-19T10:00:00.000Z');
    expect(second.record.reviewed_by_operator_id).toBe('op-2');
  });

  it('does not rewrite a grandfathered record by reading it', async () => {
    const before = db.prepare('SELECT * FROM roster_season_trust WHERE college_name = ?').get('Legacy College');
    await get('/roster-season-trust');
    const after = db.prepare('SELECT * FROM roster_season_trust WHERE college_name = ?').get('Legacy College');
    expect(after).toEqual(before);
    expect(after.reviewed_by_operator_id).toBeNull();
  });
});

describe('L7ZK — machine and human are separated by the architecture', () => {
  it('the recorder imports no disposition vocabulary and writes no such column', async () => {
    /*
     * PHASE 19, enforced rather than documented. L7ZJ held this by restraint —
     * the word simply was not in the file. Now the INSERT names only diagnosis
     * columns, so setting a disposition would require adding one, which is a
     * visible act rather than a typo.
     */
    const fs = await import('node:fs');
    const url = new URL('../scripts/recordSeasonTrust.js', import.meta.url);
    const src = fs.readFileSync(url, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/DISPOSITION\./);
    expect(code).not.toMatch(/EXCLUDE_FROM_EVIDENCE/);
    const insert = /INSERT INTO roster_season_trust[\s\S]*?`;/.exec(code)[0];
    expect(insert).not.toMatch(/disposition/);
    expect(insert).not.toMatch(/reviewed_by_operator_id/);
  });

  it('and it cannot reach the human writer at all', async () => {
    const fs = await import('node:fs');
    const url = new URL('../scripts/recordSeasonTrust.js', import.meta.url);
    const src = fs.readFileSync(url, 'utf8');
    for (const m of src.matchAll(/^\s*import\s[^;]*?from\s*'([^']+)'/gm)) {
      expect(m[1]).not.toMatch(/seasonTrustReview/);
    }
  });
});
