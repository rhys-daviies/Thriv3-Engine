/**
 * §4 eligibility measurements. The claim under test: every answer comes from
 * the existing rules, unchanged. Proved by parity (each coach's measured
 * outcome equals the rule function called directly) and by the copy staying
 * byte-for-byte unchanged in content.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import db from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { corroborateFixtureCoaches } from '../testCanonicalCoaches.js';
import { coachRowIneligibility, coachIneligibility } from './coachEligibility.js';
import { activationHolds } from './canonicalCoachEligibility.js';
import { programmeCoaches } from '../routes/programmeCoaches.js';
import { measureCoachEligibility } from './coachEligibilityMeasurement.js';
import { evaluateGate, PILOT_CELLS } from './eligibilityGate.js';
import { fingerprint, compareFingerprints } from './dbFingerprint.js';

const SCOPE = 'NAIA';
const T = '2026-09-01T00:00:00.000Z';
const HELD_ID = [...(activationHolds()?.keys() ?? [])][0];

/** Three pilot programmes and one outside the pilot, with coaches in every state the rules distinguish. */
function seed(handle) {
  const college = handle.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`);
  const entity = handle.prepare(`INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at)
    VALUES (?, ?, ?, 'SINGLE', 'test', ?)`);
  const domain = handle.prepare(`INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at)
    VALUES (?, ?, 'VERIFIED', 'ATHLETICS_SITE', '[]', ?, 'TEST', 'CERTAIN', ?)`);
  const programmes = [
    ['col-a', 'Alpha Measure U', 'mens-soccer', 'NCAA D1', 971001, 'alpha.example'],
    ['col-b', 'Beta Measure U', 'womens-soccer', 'NCAA D1', 971002, 'beta.example'],
    ['col-g', 'Gamma Measure U', 'mens-soccer', 'NCAA D2', 971003, 'gamma.example'],
    ['col-n', 'Nu Measure U', 'mens-soccer', 'NAIA', 971004, 'nu.example'],
  ];
  for (const [id, name, sport, division, unitid, host] of programmes) {
    entity.run(`AE-${id}`, name, unitid, T);
    college.run(id, T, T, name, sport, division, unitid, `AE-${id}`);
    domain.run(host, unitid, `[${unitid}]`, T);
  }
  const coach = handle.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, currentness_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Head Coach', ?, ?)`);
  const rows = [
    ['m-ok', 'Okay Coach', 'ok@alpha.example', 'Alpha Measure U', 'NCAA D1', 'mens-soccer', 'verified', 'CURRENT', true],
    ['m-uncorr', 'Uncorroborated Coach', 'unc@alpha.example', 'Alpha Measure U', 'NCAA D1', 'mens-soccer', 'verified', 'CURRENT', false],
    ['m-generic', 'Generic Inbox', 'soccer@alpha.example', 'Alpha Measure U', 'NCAA D1', 'mens-soccer', 'generic', 'CURRENT', true],
    ['m-stale', 'Departed Coach', 'gone@beta.example', 'Beta Measure U', 'NCAA D1', 'womens-soccer', 'verified', 'PROVEN_STALE', true],
    ['m-optout', 'Opted Out Coach', 'optout@gamma.example', 'Gamma Measure U', 'NCAA D2', 'mens-soccer', 'verified', 'CURRENT', true],
    ['m-nu', 'Nu Coach', 'coach@nu.example', 'Nu Measure U', 'NAIA', 'mens-soccer', 'verified', 'CURRENT', true],
  ];
  if (HELD_ID) rows.push([HELD_ID, 'Held Coach', 'held@beta.example', 'Beta Measure U', 'NCAA D1', 'womens-soccer', 'verified', 'CURRENT', true]);
  for (const [id, name, email, school, division, sport, status, current] of rows) coach.run(id, T, name, email, school, division, sport, status, current);
  corroborateFixtureCoaches(handle, { ids: rows.filter((r) => r[8]).map((r) => r[0]) });
  handle.prepare("INSERT INTO suppressions (email, reason, source, created_at) VALUES ('optout@gamma.example', 'unsubscribed', 'manual', ?)").run(T);
}

let result;
beforeAll(() => {
  seed(db);
  result = measureCoachEligibility({ scope: SCOPE });
});

describe('the existing rules, unchanged: parity coach by coach', () => {
  it('every coach\'s measured outcome equals the rule functions called directly', () => {
    const coaches = db.prepare('SELECT id, full_name, email, school, sport, division, email_status, currentness_status FROM coaches').all();
    expect(coaches.length).toBeGreaterThanOrEqual(6);
    const byId = new Map(result.e6.map((c) => [c.coachId, c]));
    for (const c of coaches) {
      const m = byId.get(c.id);
      expect(m.rowEligible, c.id).toBe(coachRowIneligibility(c) === null);
      expect(m.eligible, c.id).toBe(coachIneligibility(c, { handle: db }) === null);
    }
  });

  it('the offer coverage equals what the manual composer offers', () => {
    const offered = (name, sport) => programmeCoaches({ collegeName: name, sport }).length > 0;
    expect(result.e4['NCAA D1|mens-soccer'].withOfferedCoach).toBe(offered('Alpha Measure U', 'mens-soccer') ? 1 : 0);
    expect(result.e4['NCAA D2|mens-soccer'].withOfferedCoach).toBe(offered('Gamma Measure U', 'mens-soccer') ? 1 : 0);
  });

  it('it reads the rule modules, it does not restate them', () => {
    const src = fs.readFileSync(new URL('./coachEligibilityMeasurement.js', import.meta.url), 'utf8');
    for (const fn of ['coachRowIneligibility', 'coachIneligibility', 'canonicalDecisions', 'programmeCoaches', 'isSuppressed']) {
      expect(src).toMatch(new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from`));
      expect(src).not.toMatch(new RegExp(`function ${fn}\\b`));
    }
    // no eligibility decision is written in SQL here: the only coach query is the plain read of the rows
    expect(src).not.toMatch(/email_status\s*=|currentness_status\s*=|outreach_eligibility\s*=\s*'/);
  });
});

describe('E1–E5 on the fixture', () => {
  it('E2/E3: the row check and the canonical check, with their own reason codes', () => {
    expect(result.e2['NCAA D1|mens-soccer']).toMatchObject({ ELIGIBLE: 2, EMAIL_NOT_VERIFIED: 1 });
    expect(result.e2['NCAA D1|womens-soccer']).toMatchObject({ COACH_PROVEN_STALE: 1 });
    expect(result.e3['NCAA D1|mens-soccer'].ELIGIBLE).toBe(1);
  });

  it('E4: coverage per sport x division, from each programme\'s own cell', () => {
    expect(result.e4['NCAA D1|mens-soccer']).toMatchObject({ programmes: 1, withEligibleCoach: 1, coverage: 1 });
    expect(result.e4['NCAA D1|womens-soccer']).toMatchObject({ programmes: 1, withEligibleCoach: 0, coverage: 0 });
    // the opted-out coach is eligible under the floor, but not offered
    expect(result.e4['NCAA D2|mens-soccer']).toMatchObject({ withEligibleCoach: 1, withOfferedCoach: 0 });
  });

  it('E5: every lost coach carries the engine\'s own reason; a held one names its hold', () => {
    const lost = new Map(result.e5.coaches.map((l) => [l.coachId, l]));
    expect(lost.has('m-uncorr')).toBe(true);
    expect(lost.get('m-uncorr').reason).toMatch(/^COACH_/);
    expect(lost.get('m-uncorr').explained).toBe(true);
    expect(lost.get('m-uncorr').detail.ineligibleReason).toBeTruthy();
    expect(result.e5.unexplained).toBe(0);
    if (HELD_ID) {
      expect(lost.get(HELD_ID)).toMatchObject({ explained: true, reason: expect.stringMatching(/^COACH_ACTIVATION_HELD:/) });
      expect(lost.get(HELD_ID).detail.hold).toBeTruthy();
    }
    expect(lost.has('m-ok')).toBe(false);
    expect(lost.has('m-generic')).toBe(false);   // never row-eligible, so not a loss
    expect(JSON.stringify(result.e5)).not.toMatch(/@(alpha|beta|gamma)\.example/);   // no addresses
  });

  it('E8: an opt-out stored in the rules\' form is honoured at both checks: zero violations', () => {
    expect(result.e8).toMatchObject({ suppressions: 1, nonNormalisedRows: 0, violations: 0 });
  });
});

describe('E8 detects an opt-out the rules could miss', () => {
  it('a suppression stored in a different case is reported as a violation at both checks', () => {
    db.prepare("INSERT INTO suppressions (email, reason, source, created_at) VALUES (' OK@Alpha.Example', 'manual', 'edge', ?)").run(T);
    try {
      const r = measureCoachEligibility({ scope: SCOPE });
      expect(r.e8.nonNormalisedRows).toBe(1);
      expect(r.e8.details).toEqual(expect.arrayContaining([
        { coachId: 'm-ok', check: 'SEND_TIME_NOT_SUPPRESSED' },
        { coachId: 'm-ok', check: 'OFFERED_DESPITE_OPT_OUT' },
      ]));
    } finally {
      db.prepare("DELETE FROM suppressions WHERE email = ' OK@Alpha.Example'").run();
    }
  });
});

describe('the §4 gate', () => {
  const res = (cov, { violations = 0, unexplained = 0, scope = SCOPE } = {}) => ({
    scope,
    e4: Object.fromEntries(PILOT_CELLS.map((c) => [c, { coverage: cov[c] ?? 0.8 }])),
    e5: { lost: 3, unexplained },
    e8: { violations },
  });
  const dev = res({});

  it('passes at or above 90% of development in every pilot cell', () => {
    expect(evaluateGate(res(Object.fromEntries(PILOT_CELLS.map((c) => [c, 0.72]))), dev).pass).toBe(true);   // exactly 0.9
  });

  it('each cell is judged on its own: one weak cell fails the gate however strong the rest', () => {
    const prod = res({ ...Object.fromEntries(PILOT_CELLS.map((c) => [c, 0.8])), 'NCAA D3|womens-soccer': 0.7 });
    const g = evaluateGate(prod, dev);
    expect(g.pass).toBe(false);
    expect(g.coverage.cells.filter((c) => !c.pass).map((c) => c.cell)).toEqual(['NCAA D3|womens-soccer']);
  });

  it('one opt-out violation fails it, whatever the coverage', () => {
    expect(evaluateGate(res({}, { violations: 1 }), dev)).toMatchObject({ pass: false, optOut: { pass: false } });
  });

  it('one unexplained lost coach fails it', () => {
    expect(evaluateGate(res({}, { unexplained: 1 }), dev)).toMatchObject({ pass: false, losses: { pass: false } });
  });

  it('results measured under different scopes are not comparable', () => {
    expect(evaluateGate(res({}, { scope: 'ALL' }), dev).pass).toBe(false);
  });

  it('a cell development itself does not cover cannot be passed (fail closed)', () => {
    const d0 = res({ 'NCAA D2|mens-soccer': 0 });
    expect(evaluateGate(res({}), d0).coverage.cells.find((c) => c.cell === 'NCAA D2|mens-soccer').pass).toBeNull();
    expect(evaluateGate(res({}), d0).pass).toBe(false);
  });
});

describe('the command line: on a migrated copy only, and the copy is unchanged', () => {
  let dir;
  const cli = (args, env = {}) => {
    const r = spawnSync(process.execPath, ['server/scripts/measureCoachEligibility.js', ...args],
      { encoding: 'utf8', env: { ...process.env, RECRUITMATCH_DB: '', ...env } });
    return { code: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
  };
  beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-elig-'));
      const f = new Database(path.join(dir, 'migrated.sqlite'));
      f.exec(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
      migrate(f);
      seed(f);
      f.close();
      const u = new Database(path.join(dir, 'unmigrated.sqlite'));
      u.exec('CREATE TABLE coaches (id TEXT); CREATE TABLE outreach (id TEXT, coach_id TEXT);');
      u.close();
  });
  afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it('measures, writes the result, and proves the copy\'s content did not move', () => {
    const copy = path.join(dir, 'migrated.sqlite');
    const before = fingerprint(copy);
    const r = cli([copy, '--scope', SCOPE, '--out', path.join(dir, 'r.json')]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/Copy unchanged/);
    expect(compareFingerprints(before, fingerprint(copy)).same).toBe(true);
    const out = JSON.parse(fs.readFileSync(path.join(dir, 'r.json'), 'utf8'));
    expect(out.readOnlyProof.unchanged).toEqual(['after opening', 'after measuring']);
    expect(out.readOnlyProof.connection).toMatch(/SQLITE_OPEN_READONLY/);
    expect(out.readOnlyProof.fileSha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(copy)).digest('hex'));
    expect(out.scope).toBe(SCOPE);
    expect(out.totals.eligible).toBe(result.totals.eligible);   // same answer as in-process
  });

  it('refuses a copy that is not on main\'s schema, before opening it through the app', () => {
    const copy = path.join(dir, 'unmigrated.sqlite');
    const before = fs.readFileSync(copy);
    const r = cli([copy, '--scope', SCOPE]);
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/not on main's schema/);
    expect(fs.readFileSync(copy).equals(before)).toBe(true);
  });

  it('refuses the database the app is configured to use, and refuses to guess a scope', () => {
    const copy = path.join(dir, 'migrated.sqlite');
    expect(cli([copy, '--scope', SCOPE], { RECRUITMATCH_DB: copy })).toMatchObject({ code: 3 });
    expect(cli([copy])).toMatchObject({ code: 2 });
  });

  it('--gate compares two result files without opening any database', () => {
    const f = path.join(dir, 'r.json');
    const r = cli(['--gate', f, f]);
    expect([0, 1]).toContain(r.code);
    expect(JSON.parse(r.stdout)).toHaveProperty('coverage.cells');
  });
});
