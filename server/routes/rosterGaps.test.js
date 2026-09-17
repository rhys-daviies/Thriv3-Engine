import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7L — the review API, against a scratch database.
 *
 * The line being held is L7K's: a machine observation and a human conclusion
 * are different claims, and the last place they could be conflated is the wire.
 * So these assert the response keeps them in named groups, that the endpoint
 * refuses a pairing the vocabulary forbids, and that saving a review cannot
 * reach acquisition state, the registry or any product surface.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIVE_DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');

/**
 * The router, driven against a small purpose-built database.
 *
 * NOT A COPY OF THE LIVE ONE, and that was learned the hard way. Three existing
 * suites take an online `.backup()` of the 209MB working database to check
 * their migrations; a fourth doing the same made all of them fail with
 * "database is locked", because an online backup reads page by page and
 * restarts when something else disturbs the source. Four concurrent copies of
 * the same file is one too many.
 *
 * It is also unnecessary. What the ROUTE has to get right is validation, the
 * allow-list, history, retry semantics and what it must not touch — none of
 * which needs 1,761 real programmes. The assertions that ARE about the real
 * registry (that the queue reconciles to 1,744 + 7 + 10, that it is NCAA only,
 * that it is deterministic) live in `rosterGapQueue.test.js`, which reads the
 * live database without copying it. Each assertion sits where its evidence is.
 *
 * The fixture is three programmes: one that holds a roster, one gap on a
 * trusted athletics host, and one gap with no host at all — which is the
 * `NO_TRUSTED_HOST` case the vocabulary must never offer as a conclusion.
 */
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'l7l-'));
const DB = path.join(SCRATCH, 'fixture.sqlite');
afterAll(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

beforeAll(() => {
  /*
   * Booted through the real client, which applies schema.sql AND the additive
   * migrations. `colleges.unitid` is added by `migrate.js` and is not in
   * schema.sql, so a fixture built from the schema alone is missing the column
   * the whole queue keys on — the same trap `operator_users` set in L7K.
   */
  execFileSync('node', ['--input-type=module', '-e', `
    process.env.RECRUITMATCH_DB = ${JSON.stringify(DB)};
    const { default: db } = await import('${ROOT}/server/db/client.js');
    const NOW = '2026-01-01T00:00:00.000Z';
    const college = db.prepare(\`INSERT INTO colleges
        (id, created_date, updated_date, name, sport, division, conference, unitid, active)
        VALUES (?, '\${NOW}', '\${NOW}', ?, 'mens-soccer', 'NCAA D3', 'TEST', ?, 1)\`);
    college.run('c1', 'Rostered School', 1001);
    college.run('c2', 'Gap With Host', 1002);
    college.run('c3', 'Gap No Host', 1003);
    db.prepare(\`INSERT INTO roster_players
        (id, created_date, updated_date, college_name, sport, division, season, player_name, source_roster_url)
        VALUES ('p1', '2026-01-01', '2026-01-01', 'Rostered School', 'mens-soccer', 'NCAA D3', '2026',
                'A Player', 'https://rostered.test/sports/mens-soccer/roster/2026')\`).run();
    // athletics_domains is created by the domain-discovery import, not by
    // schema.sql, so the fixture declares it — the columns the planner reads.
    db.exec(\`CREATE TABLE IF NOT EXISTS athletics_domains (
      domain TEXT PRIMARY KEY, unitid INTEGER, status TEXT NOT NULL, role TEXT,
      claimed_keys TEXT NOT NULL, claimed_unitids TEXT NOT NULL, wrong_mappings TEXT,
      evidence_kind TEXT, evidence_text TEXT, identity_method TEXT, identity_strength TEXT,
      platform TEXT, http_status INTEGER, final_url TEXT, verification_method TEXT NOT NULL,
      confidence TEXT NOT NULL, notes TEXT, checked_at TEXT NOT NULL)\`);
    db.prepare(\`INSERT INTO athletics_domains
        (domain, unitid, status, role, claimed_keys, claimed_unitids, evidence_text,
         identity_strength, platform, verification_method, confidence, checked_at)
        VALUES ('gapwithhost.test', 1002, 'VERIFIED', 'ATHLETICS_SITE', '["Gap With Host"]', '[1002]',
                'Gap With Host Athletics', 'WHOLE_NAME', 'SIDEARM', 'PAGE_SELF_IDENTIFICATION',
                'CERTAIN', '\${NOW}')\`).run();
  `], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: DB }, encoding: 'utf8' });
}, 30_000);

function withApi(body) {
  return JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
      process.env.RECRUITMATCH_DB = ${JSON.stringify(DB)};
      const { default: db } = await import('${ROOT}/server/db/client.js');
      // Every test starts from "nothing reviewed", which is also production.
      db.prepare('DELETE FROM roster_gap_reviews').run();
      const { rosterGapsRouter } = await import('${ROOT}/server/routes/rosterGaps.js');
      /** Call a route without standing up a server. */
      const call = (method, url, payload) => new Promise((resolve) => {
        const [pathname, query] = url.split('?');
        const req = {
          method, url, path: pathname, body: payload,
          query: Object.fromEntries(new URLSearchParams(query ?? '')),
          params: {},
        };
        const res = {
          statusCode: 200,
          status(c) { this.statusCode = c; return this; },
          json(v) { resolve({ status: this.statusCode, body: v }); return this; },
        };
        const layers = rosterGapsRouter.stack.filter((l) => l.route
          && l.route.path === pathname && l.route.methods[method.toLowerCase()]);
        if (!layers.length) return resolve({ status: 404, body: { error: 'no route' } });
        layers[0].route.stack[0].handle(req, res, () => {});
      });
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out ?? null));
    `], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: DB, RB_ROOT: SCRATCH }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

/** The first open gap, whatever it happens to be — never a hardcoded school. */
const FIRST = `const q = (await call('GET', '/roster-gaps')).body; const g = q.rows[0];`;

describe('the queue endpoint', () => {
  let q;
  beforeAll(() => { q = withApi(`${FIRST} return q;`); });

  it('returns every gap in the registry it was given, and only NCAA', () => {
    // The fixture has three programmes: one rostered, two gaps.
    expect(q.rows).toHaveLength(q.summary.legitimateGaps);
    expect(q.summary.legitimateGaps).toBe(2);
    expect(q.rows.map((r) => r.school).sort()).toEqual(['Gap No Host', 'Gap With Host']);
    for (const r of q.rows) expect(r.division).toMatch(/^NCAA /);
  });

  it('reconciles its own arithmetic', () => {
    // The LIVE numbers — 1,744 rostered, 7 duplicates, 10 gaps — are asserted in
    // rosterGapQueue.test.js, which reads the real registry. Here the question
    // is only that the summary adds up over whatever registry it was handed.
    const s = q.summary;
    expect(s.reconciles).toBe(true);
    expect(s.ncaaWithRoster).toBe(1);
    expect(s.ncaaWithRoster + s.registryDuplicates + s.legitimateGaps).toBe(s.ncaaTotal);
  });

  it('keeps the three layers in named groups and offers no flattened status', () => {
    for (const r of q.rows) {
      expect(r.machine).toBeTruthy();
      expect(r.operator).toBeTruthy();
      expect(r).not.toHaveProperty('status');
      expect(r.machine).toHaveProperty('candidateState');
      expect(r.machine).toHaveProperty('lastFailureClass');
      expect(r.operator).toHaveProperty('reviewStatus');
      expect(r.operator).toHaveProperty('disposition');
    }
  });

  it('carries the vocabulary so a form cannot drift from the server', () => {
    expect(q.vocabulary.dispositions.map((d) => d.value).sort()).toEqual([
      'PROGRAMME_STATUS_QUESTION', 'SITE_TEMPORARILY_UNAVAILABLE', 'SOURCE_NOT_AVAILABLE',
    ]);
    const temp = q.vocabulary.dispositions.find((d) => d.value === 'SITE_TEMPORARILY_UNAVAILABLE');
    expect(temp.allowedActions).toEqual(['RETRY_AFTER']);
  });

  it('never offers NO_HOST as something a person may conclude', () => {
    expect(q.vocabulary.dispositions.map((d) => d.value)).not.toContain('NO_HOST');
    expect(q.vocabulary.dispositions.map((d) => d.value)).not.toContain('MANUAL_REVIEW');
    // and the machine fact is still visible where it belongs
    expect(q.rows.some((r) => r.machine.candidateState === 'NO_TRUSTED_HOST')).toBe(true);
  });

  it('starts every gap unreviewed', () => {
    expect(q.summary.reviewed).toBe(0);
    for (const r of q.rows) expect(r.operator.reviewStatus).toBe('UNREVIEWED');
  });
});

describe('saving a review', () => {
  /*
   * ONE subprocess for the whole block. Each scenario clears the review table
   * first, so they are independent without eighteen node starts — the earlier
   * shape spent forty-five seconds rebuilding the same queue over and over.
   */
  let R;
  beforeAll(() => { R = withApi(`
    const reset = () => db.prepare('DELETE FROM roster_gap_reviews').run();
    ${FIRST}
    const one = { season: q.season, school: g.school, sport: g.sport };
    const out = {};

    reset();
    out.saved = await call('POST', '/roster-gaps/review', { ...one,
      disposition: 'SOURCE_NOT_AVAILABLE', nextAction: 'RETRY_ACQUISITION',
      evidence: 'trusted host answers, no roster path found on it' });
    const afterSave = (await call('GET', '/roster-gaps')).body;
    out.afterSave = { reviewed: afterSave.summary.reviewed,
                      row: afterSave.rows.find((r) => r.key === g.key) };

    reset();
    out.badPair = await call('POST', '/roster-gaps/review', { ...one,
      disposition: 'PROGRAMME_STATUS_QUESTION', nextAction: 'RETRY_ACQUISITION',
      evidence: 'navigation says the programme starts next year' });

    out.noDate = await call('POST', '/roster-gaps/review', { ...one,
      disposition: 'SITE_TEMPORARILY_UNAVAILABLE', nextAction: 'RETRY_AFTER',
      evidence: 'host 503s on every route' });

    out.empty = await call('POST', '/roster-gaps/review', { ...one,
      disposition: 'SOURCE_NOT_AVAILABLE', nextAction: 'NONE', evidence: '   ' });
    out.huge = await call('POST', '/roster-gaps/review', { ...one,
      disposition: 'SOURCE_NOT_AVAILABLE', nextAction: 'NONE', evidence: 'x'.repeat(5000) });
    out.unknown = await call('POST', '/roster-gaps/review', { ...one,
      disposition: 'SOURCE_NOT_AVAILABLE', nextAction: 'NONE', evidence: 'looked',
      active: 0, status: 'done' });
    out.notAGap = await call('POST', '/roster-gaps/review', {
      season: 2026, school: 'Northwood', sport: 'womens-soccer',
      disposition: 'SOURCE_NOT_AVAILABLE', nextAction: 'NONE', evidence: 'acquired in L7I' });

    reset();
    await call('POST', '/roster-gaps/review', { ...one,
      disposition: 'SOURCE_NOT_AVAILABLE', nextAction: 'NONE', evidence: 'first look' });
    await call('POST', '/roster-gaps/review', { ...one,
      disposition: 'PROGRAMME_STATUS_QUESTION', nextAction: 'CONFIRM_PROGRAMME_STATUS',
      evidence: 'navigation says coming next year' });
    await call('POST', '/roster-gaps/review', { ...one,
      disposition: 'SOURCE_NOT_AVAILABLE', nextAction: 'RETRY_ACQUISITION', evidence: 'third' });
    out.history = (await call('GET', '/roster-gaps')).body.rows.find((r) => r.key === g.key).operator;

    reset();
    await call('POST', '/roster-gaps/review', { ...one,
      disposition: 'SITE_TEMPORARILY_UNAVAILABLE', nextAction: 'RETRY_AFTER',
      retryAfter: '2099-01-01T00:00:00.000Z', evidence: 'site in maintenance' });
    const held = (await call('GET', '/roster-gaps')).body.rows.find((r) => r.key === g.key);
    await call('POST', '/roster-gaps/review', { ...one,
      disposition: 'SITE_TEMPORARILY_UNAVAILABLE', nextAction: 'RETRY_AFTER',
      retryAfter: '2000-01-01T00:00:00.000Z', evidence: 'outage last seen years ago' });
    const released = (await call('GET', '/roster-gaps')).body.rows.find((r) => r.key === g.key);
    out.temporary = { held: { e: held.retryEligible, r: held.retryReason },
                      released: { e: released.retryEligible, r: released.retryReason } };

    reset();
    const other = q.rows.find((r) => r.key !== g.key);
    await call('POST', '/roster-gaps/review', { ...one,
      disposition: 'SOURCE_NOT_AVAILABLE', nextAction: 'NONE', evidence: 'only this one' });
    const iso = (await call('GET', '/roster-gaps')).body;
    out.isolation = { reviewed: iso.summary.reviewed,
                      other: iso.rows.find((r) => r.key === other.key).operator.reviewStatus };

    reset();
    return out;`); });

  it('persists a valid one and moves the row to reviewed', () => {
    expect(R.saved.status).toBe(200);
    expect(R.saved.body.review.disposition).toBe('SOURCE_NOT_AVAILABLE');
    expect(R.afterSave.reviewed).toBe(1);
    expect(R.afterSave.row.operator.reviewStatus).toBe('REVIEWED');
    expect(R.afterSave.row.operator.evidence).toBe('trusted host answers, no roster path found on it');
    // no identity is invented: this API has no authentication
    expect(R.afterSave.row.operator.reviewedByOperatorId).toBe(null);
  });

  it('refuses a pairing the vocabulary forbids', () => {
    expect(R.badPair.status).toBe(400);
    expect(R.badPair.body.error).toMatch(/may not carry RETRY_ACQUISITION/);
  });

  it('refuses a temporary condition with no date', () => {
    expect(R.noDate.status).toBe(400);
    expect(R.noDate.body.error).toMatch(/needs a date/);
  });

  it('refuses an empty reason and an oversized one', () => {
    expect(R.empty.status).toBe(400);
    expect(R.empty.body.error).toMatch(/record what was seen/);
    expect(R.huge.status).toBe(400);
    expect(R.huge.body.error).toMatch(/400 characters or fewer/);
  });

  it('refuses an unknown field rather than silently dropping it', () => {
    expect(R.unknown.status).toBe(400);
    expect(R.unknown.body.error).toMatch(/unknown field\(s\): active, status/);
  });

  it('refuses a programme that is not an open gap', () => {
    expect(R.notAGap.status).toBe(404);
    expect(R.notAGap.body.error).toMatch(/not an open NCAA roster gap/);
  });

  it('keeps exactly one previous review when one is replaced', () => {
    expect(R.history.disposition).toBe('SOURCE_NOT_AVAILABLE');
    expect(R.history.previousDisposition).toBe('PROGRAMME_STATUS_QUESTION');
    expect(R.history.previousReviewedAt).toMatch(/^\d{4}/);
  });

  it('holds a temporary review until its date, then releases it', () => {
    expect(R.temporary.held.e).toBe(false);
    expect(R.temporary.held.r).toMatch(/held until 2099/);
    expect(R.temporary.released.e).toBe(true);
    expect(R.temporary.released.r).toMatch(/has passed/);
  });

  it('one programme cannot inherit another\'s review', () => {
    expect(R.isolation.reviewed).toBe(1);
    expect(R.isolation.other).toBe('UNREVIEWED');
  });
});

describe('what saving a review cannot do', () => {
  /** Fingerprints of everything a review must not be able to move. */
  const FINGERPRINT = `
    const fp = () => ({
      roster_players: db.prepare('SELECT COUNT(*) n FROM roster_players').get().n,
      athletics_domains: db.prepare('SELECT COUNT(*) n FROM athletics_domains').get().n,
      colleges: db.prepare('SELECT COUNT(*) n FROM colleges').get().n,
      active: db.prepare('SELECT COUNT(*) n FROM colleges WHERE active = 0').get().n,
      collegesDigest: db.prepare("SELECT group_concat(name || ':' || sport || ':' || COALESCE(active,'')) d FROM (SELECT name, sport, active FROM colleges ORDER BY sport, name)").get().d,
    });`;

  it('27/28. cannot touch the registry, roster data or the domain ledger', () => {
    const out = withApi(`
      ${FINGERPRINT}
      ${FIRST}
      const before = fp();
      // the disposition that is ABOUT registry truth is the one to prove on
      const save = await call('POST', '/roster-gaps/review', {
        season: q.season, school: g.school, sport: g.sport,
        disposition: 'PROGRAMME_STATUS_QUESTION', nextAction: 'CONFIRM_PROGRAMME_STATUS',
        evidence: 'the site says the programme begins next season' });
      return { ok: save.status, before, after: fp() };`);
    expect(out.ok).toBe(200);
    expect(out.after).toEqual(out.before);
    // said explicitly: colleges.active is untouched by the question about it
    expect(out.after.active).toBe(out.before.active);
    expect(out.after.collegesDigest).toBe(out.before.collegesDigest);
  });

  it('29/30/31. the route imports nothing from Evidence, matching or outreach', () => {
    const text = fs.readFileSync(path.join(ROOT, 'server/routes/rosterGaps.js'), 'utf8');
    const forbidden = /evidence|matching|outreach|campaign|email|philosophy/i;
    const bad = [...text.matchAll(/^\s*import\s[^;]*?from\s*'([^']+)'/gm)]
      .map((m) => m[1]).filter((p) => forbidden.test(p));
    expect(bad).toEqual([]);
  });

  it('cannot reach pipeline acquisition state', () => {
    // CODE, not prose: the file talks about `_state/state<S>.json` at length
    // and must never touch it, so the assertion is about what it imports and
    // calls rather than what it mentions.
    const text = fs.readFileSync(path.join(ROOT, 'server/routes/rosterGaps.js'), 'utf8');
    const imports = [...text.matchAll(/^\s*import\s[^;]*?from\s*'([^']+)'/gm)].map((m) => m[1]);
    expect(imports.filter((p) => /child_process|node:fs|fs\//.test(p))).toEqual([]);
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/writeFileSync|appendFileSync|execFile|execSync|spawn\(/);
  });
});
