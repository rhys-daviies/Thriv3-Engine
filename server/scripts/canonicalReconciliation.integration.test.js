/**
 * The repair, proven against a production-equivalent fixture.
 *
 * The deployed database was populated once, by hand, before these tables
 * existed; `schema.sql` then created them empty. So the fixture is exactly
 * that shape — real registry and roster rows, and empty `programme_status`,
 * `roster_season_trust`, `recruiting_arrivals` and `recruiting_arrivals_build`
 * — plus operator and operational rows that exist ONLY there, which is the
 * whole reason a whole-database copy was rejected.
 *
 * Driven through a subprocess so `buildSport` and the product's own readers
 * run against the fixture the way they run in production, rather than against
 * a reconstruction.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'recon-e2e-'));
const PROD = path.join(SCRATCH, 'production.sqlite');
const SOURCE = path.join(SCRATCH, 'canonical.sqlite');
const ARTEFACT = path.join(SCRATCH, 'artefact.json');
afterAll(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

const run = (db, body) => JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
  process.env.RECRUITMATCH_DB = ${JSON.stringify(db)};
  const { default: db } = await import('${ROOT}/server/db/client.js');
  const S = await import('${ROOT}/server/lib/programmeStatus.js');
  const M = await import('${ROOT}/server/lib/recruitingMaterialisation.js');
  const A = await import('${ROOT}/server/lib/canonicalProductArtefact.js');
  const Q = await import('${ROOT}/server/scripts/seasonTrustQueue.js');
  void S; void M; void A; void Q;
  process.stdout.write(JSON.stringify(await (async () => { ${body} })() ?? null));
`], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: db }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

/* The six canonical decisions, as canonical actually holds them. */
const SIX = [
  ['Anna Maria', 'mens-soccer', 'NOT_ACTIVE', null],
  ['Anna Maria College', 'womens-soccer', 'NOT_ACTIVE', null],
  ['New Jersey City', 'mens-soccer', 'NOT_ACTIVE', null],
  ['Wisconsin-La Crosse', 'mens-soccer', 'NOT_ACTIVE', null],
  ['Southwest Minnesota State', 'mens-soccer', 'NOT_ACTIVE', null],
  ['Wisconsin-Oshkosh', 'mens-soccer', 'FUTURE', 2027],
];

const SEED_ROSTER = `
  const NOW = '2026-01-01T00:00:00.000Z';
  const college = db.prepare(\`INSERT OR IGNORE INTO colleges
    (id, created_date, updated_date, name, sport, division, active)
    VALUES (?, '\${NOW}', '\${NOW}', ?, ?, 'NCAA D3', 1)\`);
  const player = db.prepare(\`INSERT INTO roster_players
    (created_date, updated_date, college_name, sport, division, season, player_name,
     class_year_label, position, minutes_played)
    VALUES ('\${NOW}', '\${NOW}', ?, ?, 'NCAA D3', ?, ?, ?, 'Forward', 900)\`);
  let i = 0;
  for (const [school, sport] of ${JSON.stringify(SIX.map(([s, sp]) => [s, sp]))}) {
    college.run('c' + (i++), school, sport);
    for (const season of ['2024', '2025']) {
      for (const n of ['Alpha', 'Bravo', 'Charlie']) {
        player.run(school, sport, season, school + ' ' + n + ' ' + season,
          season === '2024' ? 'Freshman' : 'Sophomore');
      }
    }
  }
`;

beforeAll(() => {
  /* PRODUCTION-EQUIVALENT: registry + roster, and operational rows of its own. */
  run(PROD, `${SEED_ROSTER}
    db.prepare(\`INSERT INTO operator_users (id, email, password_hash, created_at, active)
      VALUES ('op-prod','rhys@example.test','scrypt$fake',' 2026-05-01T00:00:00.000Z',1)\`).run();
    db.prepare(\`INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
      VALUES ('p-prod','2026-05-01','2026-05-01','Production Athlete','Forward','mens-soccer')\`).run();
    return { seeded: true };`);

  /* CANONICAL-EQUIVALENT: the same roster, plus the product decisions. */
  run(SOURCE, `${SEED_ROSTER}
    const st = db.prepare(\`INSERT INTO programme_status
      (school, sport, status, reason, evidence, source_url, recorded_at)
      VALUES (?, ?, ?, 'canonical decision', 'recorded by the registry audit', 'https://example.test/', '2026-02-02T00:00:00.000Z')\`);
    for (const [school, sport, status] of ${JSON.stringify(SIX)}) st.run(school, sport, status);
    db.prepare("UPDATE programme_status SET active_from_season = 2027 WHERE status = 'FUTURE'").run();
    const tr = db.prepare(\`INSERT INTO roster_season_trust
      (season, college_name, sport, diagnosis, diagnosis_evidence, diagnosed_at)
      VALUES ('2025', ?, ?, 'SEASON_IDENTITY_UNPROVEN', 'nothing establishes which season these rows are', '2026-03-03T00:00:00.000Z')\`);
    for (const [school, sport] of ${JSON.stringify(SIX.map(([s, sp]) => [s, sp]))}) tr.run(school, sport);
    return { seeded: true };`);

  const out = execFileSync('node', [path.join(ROOT, 'server/scripts/exportCanonicalProduct.js'), '--out', SCRATCH],
    { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: SOURCE }, encoding: 'utf8' });
  const produced = fs.readdirSync(SCRATCH).find((f) => f.startsWith('canonical-product-'));
  expect(produced, out).toBeTruthy();
  fs.renameSync(path.join(SCRATCH, produced), ARTEFACT);
});

const reconcile = (extra = []) => {
  try {
    return { code: 0, out: execFileSync('node',
      [path.join(ROOT, 'server/scripts/reconcileCanonicalProduct.js'), '--artefact', ARTEFACT, ...extra],
      { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: PROD }, encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

describe('before the repair — production is wrong in the way we measured', () => {
  it('treats all six excluded programmes as active, and has no trust queue', () => {
    const before = run(PROD, `return {
      statuses: db.prepare('SELECT COUNT(*) n FROM programme_status').get().n,
      active: ${JSON.stringify(SIX)}.map(([s, sp]) => S.programmeActiveForSeason(s, sp, 2026)),
      trust: Q.trustQueue().length,
      mens: M.materialisationState('mens-soccer').state,
      womens: M.materialisationState('womens-soccer').state,
    };`);
    expect(before.statuses).toBe(0);
    expect(before.active).toEqual([true, true, true, true, true, true]);   // the defect
    expect(before.trust).toBe(0);
    expect(before.mens).toBe('LEGACY_UNVERIFIED');
    expect(before.womens).toBe('LEGACY_UNVERIFIED');
  });
});

describe('the dry run', () => {
  it('reports the work and writes nothing', () => {
    const r = reconcile();
    expect(r.code).toBe(0);
    expect(r.out).toContain('DRY RUN — nothing has been written.');
    expect(r.out).toMatch(/programme_status[\s\S]*inserted\s+6/);
    expect(r.out).toMatch(/roster_season_trust_machine[\s\S]*inserted\s+6/);
    const after = run(PROD, "return { statuses: db.prepare('SELECT COUNT(*) n FROM programme_status').get().n };");
    expect(after.statuses).toBe(0);
  });

  it('refuses to apply without a named target', () => {
    const r = reconcile(['--apply']);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/--target must name the database being written/);
  });

  it('refuses to apply without a verified backup', () => {
    const r = reconcile(['--apply', '--target', PROD]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/no --backup-verified directory given/);
  });

  it('refuses a backup whose integrity check did not pass', () => {
    const bad = path.join(SCRATCH, 'bad-backup');
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(path.join(bad, 'manifest.json'),
      JSON.stringify({ integrityCheck: 'malformed', databaseSha256: 'x', takenAt: 'now' }));
    const r = reconcile(['--apply', '--target', PROD, '--backup-verified', bad]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/integrity_check is "malformed"/);
  });
});

describe('after the repair', () => {
  let applied;
  beforeAll(() => {
    const good = path.join(SCRATCH, 'backup');
    fs.mkdirSync(good, { recursive: true });
    fs.writeFileSync(path.join(good, 'manifest.json'), JSON.stringify({
      takenAt: '2026-09-24T00:00:00.000Z', integrityCheck: 'ok',
      databaseSha256: 'a'.repeat(64), rowCounts: {},
    }));
    applied = reconcile(['--apply', '--target', PROD, '--backup-verified', good]);
    expect(applied.code, applied.out).toBe(0);
  });

  it('applied, and said so', () => {
    expect(applied.out).toContain('APPLIED.');
    expect(applied.out).toContain('npm run build:recruiting');
  });

  it('restores programme eligibility exactly', () => {
    const after = run(PROD, `return {
      statuses: db.prepare('SELECT COUNT(*) n FROM programme_status').get().n,
      active2026: ${JSON.stringify(SIX)}.map(([s, sp]) => S.programmeActiveForSeason(s, sp, 2026)),
      oshkosh2027: S.programmeActiveForSeason('Wisconsin-Oshkosh', 'mens-soccer', 2027),
    };`);
    expect(after.statuses).toBe(6);
    // five NOT_ACTIVE and Oshkosh, which is FUTURE from 2027, all inactive in 2026
    expect(after.active2026).toEqual([false, false, false, false, false, false]);
    // and Oshkosh becomes active in the season its record says
    expect(after.oshkosh2027).toBe(true);
  });

  it('puts the machine diagnoses in the review queue with no human decision', () => {
    const after = run(PROD, `const q = Q.trustQueue(); return {
      total: q.length,
      pending: q.filter((r) => r.reviewState === 'PENDING_REVIEW').length,
      dispositioned: q.filter((r) => r.reviewState === 'DISPOSITIONED').length,
      reviewers: q.filter((r) => r.reviewed_by_operator_id).length,
      diagnoses: [...new Set(q.map((r) => r.diagnosis))],
    };`);
    expect(after.total).toBe(6);
    expect(after.pending).toBe(6);
    expect(after.dispositioned).toBe(0);      // no human decision was imported
    expect(after.reviewers).toBe(0);          // and no reviewer identity travelled
    expect(after.diagnoses).toEqual(['SEASON_IDENTITY_UNPROVEN']);
  });

  it('leaves the operator account and production-only data untouched', () => {
    const after = run(PROD, `return {
      operators: db.prepare('SELECT COUNT(*) n FROM operator_users').get().n,
      operatorEmail: db.prepare('SELECT email FROM operator_users').get().email,
      players: db.prepare('SELECT COUNT(*) n FROM players').get().n,
      playerName: db.prepare('SELECT full_name FROM players').get().full_name,
    };`);
    expect(after.operators).toBe(1);
    expect(after.operatorEmail).toBe('rhys@example.test');
    expect(after.players).toBe(1);
    expect(after.playerName).toBe('Production Athlete');
  });

  it('is idempotent: a second apply changes nothing', () => {
    const good = path.join(SCRATCH, 'backup');
    const second = reconcile(['--apply', '--target', PROD, '--backup-verified', good]);
    expect(second.code).toBe(0);
    expect(second.out).toMatch(/programme_status[\s\S]*unchanged\s+6/);
    expect(second.out).toMatch(/roster_season_trust_machine[\s\S]*unchanged\s+6/);
  });
});

describe('the derived rebuild, from production\'s own reconciled source', () => {
  it('goes LEGACY_UNVERIFIED → FRESH with a matching digest, and serves', () => {
    const before = run(PROD, "return { mens: M.materialisationState('mens-soccer').state };");
    expect(before.mens).toBe('LEGACY_UNVERIFIED');

    /*
     * `--canonical` because the fixture lives outside the checkout, which the
     * L7ZM guard classifies as a shared canonical corpus and refuses to write
     * unacknowledged. THE RUNBOOK NEEDS THE SAME FLAG: /data/recruitmatch.sqlite
     * on the Render host is outside the checkout too, so the rebuild step there
     * is `npm run build:recruiting -- --canonical`.
     */
    execFileSync('node', [path.join(ROOT, 'server/scripts/buildRecruitingHistory.js'), '--canonical'],
      { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: PROD }, encoding: 'utf8' });

    const after = run(PROD, `
      const P = await import('${ROOT}/server/lib/recruitingPatterns.js');
      const state = (s) => { const m = M.materialisationState(s);
        return { state: m.state, generation: m.generation, matches: m.expected === m.actual }; };
      let served = true;
      try { P.loadProgrammePatterns('mens-soccer', 'Anna Maria'); } catch { served = false; }
      return {
        mens: state('mens-soccer'), womens: state('womens-soccer'), served,
        arrivals: db.prepare('SELECT COUNT(*) n FROM recruiting_arrivals').get().n,
      };`);

    for (const s of [after.mens, after.womens]) {
      expect(s.state).toBe('FRESH');
      expect(s.generation).toBe(1);
      expect(s.matches).toBe(true);
    }
    expect(after.served).toBe(true);
    /*
     * NOT asserted: a positive arrival count. These synthetic rosters share no
     * players between programmes, so there are no transitions to record and
     * zero is the correct answer for this fixture. What the repair has to
     * prove is that the build RAN against production's own reconciled source
     * and stamped a verifiable digest — which is FRESH, generation 1, and
     * expected === actual above. Asserting a row count here would be asserting
     * something about the fixture, not about the reconciliation.
     */
    expect(Number.isInteger(after.arrivals)).toBe(true);
  });
});
