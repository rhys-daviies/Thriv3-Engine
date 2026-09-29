import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { classifySource, mayEstablish, TIER_D_NEVER, FIELD_AUTHORITY } from './sourceAuthority.js';
import { planTransition, periodProblems, openPeriod, periodAt } from './temporal.js';
import { freshnessOf, cycleOf } from './freshness.js';
import { authorizeAction, PROTECTED_ACTIONS } from './destructivePolicy.js';
import { isIntegrityManaged, assertLegacyWriteAllowed, refuseOnManagedDatabase } from './canonicalWriteGuard.js';
import { buildRegressionWorld } from './regressionWorld.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const owns = (h) => h === 'team.example';

describe('source authority', () => {
  it('an official kind on the entity\'s own host is tier A; on anyone else\'s host it is tier D', () => {
    expect(classifySource({ url: 'https://team.example/staff', kind: 'OFFICIAL_STAFF_DIRECTORY' }, { ownsHost: owns }).tier).toBe('A');
    expect(classifySource({ url: 'https://other.example/staff', kind: 'OFFICIAL_STAFF_DIRECTORY' }, { ownsHost: owns }).tier).toBe('D');
  });
  it('Wayback and prior-season pages are history (tier C), never current', () => {
    expect(classifySource({ url: 'https://web.archive.org/web/2025/https://team.example/staff', kind: 'OFFICIAL_STAFF_DIRECTORY' }, { ownsHost: owns }).tier).toBe('C');
    expect(classifySource({ url: 'https://team.example/roster/2025', kind: 'OFFICIAL_ROSTER', pageSeason: 2025 }, { ownsHost: owns, currentSeason: 2026 }).tier).toBe('C');
  });
  it('membership and federal kinds need governing-body / NCES hosts', () => {
    expect(classifySource({ url: 'https://www.naia.org/members', kind: 'OFFICIAL_MEMBERSHIP' }).tier).toBe('A');
    expect(classifySource({ url: 'https://blog.example/members', kind: 'OFFICIAL_MEMBERSHIP' }).tier).toBe('D');
    expect(mayEstablish('federal_unitid', classifySource({ url: 'https://nces.ed.gov/collegenavigator/?id=123456', kind: 'FEDERAL_REGISTRY' })).ok).toBe(true);
    expect(mayEstablish('federal_unitid', classifySource({ url: 'https://team.example/about', kind: 'OFFICIAL_ATHLETICS_PROGRAMME_PAGE' }, { ownsHost: owns })).ok).toBe(false);
  });
  it('tier D never establishes identity, a current coach, email_seen, CURRENT or domain ownership', () => {
    for (const f of TIER_D_NEVER) expect(mayEstablish(f, { tier: 'D', kind: 'SEARCH_RESULT' }).ok).toBe(false);
    expect(Object.keys(FIELD_AUTHORITY).every((f) => !FIELD_AUTHORITY[f].includes('D'))).toBe(true);
  });
  it('division needs tier A or two INDEPENDENT tier-B hosts', () => {
    expect(mayEstablish('division', [{ tier: 'B', host: 'conf.example' }]).ok).toBe(false);
    expect(mayEstablish('division', [{ tier: 'B', host: 'conf.example' }, { tier: 'B', host: 'conf.example' }]).ok).toBe(false);
    expect(mayEstablish('division', [{ tier: 'B', host: 'conf.example' }, { tier: 'B', host: 'team.example' }]).ok).toBe(true);
  });
});

describe('temporal model', () => {
  const open = { athletics_entity_id: 'AE-U1', sport: 'mens-soccer', first_season: 2020, last_season: null, division: 'NAIA', conference: 'X', membership_status: 'ACTIVE', postseason_eligible: null, college_id: 'c1' };
  it('a transition closes the open period at season-1 and opens a new one; closed periods are never edited', () => {
    const { ops, problems } = planTransition([open], { athletics_entity_id: 'AE-U1', sport: 'mens-soccer', season: 2026, division: 'NCAA D2', conference: 'MEC', membership_status: 'PROVISIONAL', postseason_eligible: 0, source_tier: 'B', provenance: 't' });
    expect(problems).toEqual([]);
    expect(ops[0]).toMatchObject({ op: 'CLOSE_PERIOD', last_season: 2025 });
    expect(ops[1].row).toMatchObject({ first_season: 2026, governing_body: 'NCAA', membership_status: 'PROVISIONAL' });
  });
  it('a change effective at/before the open period start is refused as a history rewrite', () => {
    expect(planTransition([open], { athletics_entity_id: 'AE-U1', sport: 'mens-soccer', season: 2020, division: 'NCAA D2', membership_status: 'ACTIVE', source_tier: 'A', provenance: 't' }).problems[0]).toMatch(/rewrite/);
  });
  it('period invariants: one open period, no overlap, pointer agrees, every active carrier has one', () => {
    const rows = [{ id: 'c1', name: 'One', sport: 'mens-soccer', division: 'NAIA', conference: 'X', active: 1, athletics_entity_id: 'AE-U1' }, { id: 'c2', name: 'Two', sport: 'mens-soccer', division: 'NAIA', conference: 'X', active: 1, athletics_entity_id: 'AE-U2' }];
    expect(periodProblems([open], rows).some((p) => p.startsWith('P4'))).toBe(true);
    expect(periodProblems([open, { ...open, first_season: 2024 }], rows).some((p) => p.startsWith('P1'))).toBe(true);
    expect(periodProblems([{ ...open, division: 'NCAA D2' }], rows.slice(0, 1)).some((p) => p.startsWith('P3'))).toBe(true);
    const closed = { ...open, last_season: 2025 }; const next = { ...open, first_season: 2026, division: 'NAIA' };
    expect(periodProblems([closed, next], rows.slice(0, 1))).toEqual([]);
    expect(periodAt([closed, next], 'AE-U1', 'mens-soccer', 2023).last_season).toBe(2025);
    expect(openPeriod([closed, next], 'AE-U1', 'mens-soccer').first_season).toBe(2026);
  });
});

describe('freshness', () => {
  it('cycles run July-June', () => { expect(cycleOf('2026-07-01')).toBe(2026); expect(cycleOf('2026-06-30')).toBe(2025); });
  it('coach check: CURRENT this cycle, AGING last cycle, STALE older, UNKNOWN never', () => {
    const now = new Date('2026-09-29');
    expect(freshnessOf('coach', { currentness_status: 'CURRENT', currentness_checked_at: '2026-08-01' }, { now }).state).toBe('CURRENT');
    expect(freshnessOf('coach', { currentness_status: 'CURRENT', currentness_checked_at: '2025-09-01' }, { now }).state).toBe('AGING');
    expect(freshnessOf('coach', { currentness_status: 'CURRENT', currentness_checked_at: '2024-09-01' }, { now }).state).toBe('STALE');
    expect(freshnessOf('coach', {}, { now }).state).toBe('UNKNOWN');
  });
  it('roster: prior season is AGING until 1 October, STALE after; SEED membership is UNKNOWN', () => {
    expect(freshnessOf('roster', { latest_season: 2025 }, { now: new Date('2026-09-15'), season: 2026 }).state).toBe('AGING');
    expect(freshnessOf('roster', { latest_season: 2025 }, { now: new Date('2026-10-15'), season: 2026 }).state).toBe('STALE');
    expect(freshnessOf('membership', { source_tier: 'SEED', recorded_at: '2026-09-29' }, { now: new Date('2026-09-29') }).state).toBe('UNKNOWN');
  });
});

describe('destructive-action policy', () => {
  it('deletion is never a refresh outcome', () => {
    for (const a of ['DELETE_COACH', 'DELETE_PROGRAMME', 'DELETE_ROSTER_ROW']) expect(authorizeAction(a, {}).allowed).toBe(false);
  });
  it('every protected action needs review and its named proof', () => {
    expect(authorizeAction('REPLACE_VERIFIED_EMAIL', { source_tier_A: true, source_owned_by_programme_entity: true, same_person_evidence: true, new_email_published: true, old_email_absent: false }).missing).toEqual(['old_email_absent']);
    expect(authorizeAction('MARK_PROVEN_STALE', { source_tier_A: true }).allowed).toBe(false);
    for (const a of Object.keys(PROTECTED_ACTIONS)) expect(authorizeAction(a, {}).requires_review).toBe(true);
    expect(authorizeAction('REFRESH_COACH_EVIDENCE', {}).requires_review).toBe(false);
  });
});

describe('canonical write guard (closes the legacy bypass paths)', () => {
  it('is inert on an unmanaged database and refuses on a managed one without an acknowledged reason', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'p7e-guard-'));
    const plain = new Database(':memory:'); expect(isIntegrityManaged(plain)).toBe(false); expect(assertLegacyWriteAllowed(plain, { script: 'x', argv: [] }).managed).toBe(false);
    const p = path.join(d, 'w.sqlite'); buildRegressionWorld(p);
    const db = new Database(p);
    expect(isIntegrityManaged(db)).toBe(true);
    expect(() => assertLegacyWriteAllowed(db, { script: 'x', argv: ['--apply'] })).toThrow(/integrity-managed/);
    expect(() => assertLegacyWriteAllowed(db, { script: 'x', argv: ['--apply', '--legacy-write-ack'] })).toThrow(/--reason/);
    expect(assertLegacyWriteAllowed(db, { script: 'x', argv: ['--legacy-write-ack', '--reason', 'one-off restore of a verified backup slice'] }).acknowledged).toBe(true);
    let status = 0; const res = { status(s) { status = s; return this; }, json() { return this; } };
    refuseOnManagedDatabase(db, 'cleanInactiveSchools')({}, res, () => { status = 200; });
    expect(status).toBe(409);
    db.close();
    // a real legacy wholesale-rebuild importer refuses to run --apply against the managed world
    let out = '';
    try { execFileSync(process.execPath, ['server/scripts/importInstitutionAliases.js', '--apply'], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: p }, encoding: 'utf8', stdio: 'pipe' }); } catch (e) { out = `${e.stdout}${e.stderr}`; }
    expect(out).toMatch(/integrity-managed/);
    const after = new Database(p, { readonly: true });
    expect(after.prepare('SELECT COUNT(*) n FROM institution_aliases').get().n).toBeGreaterThan(0); // not wiped
    after.close(); fs.rmSync(d, { recursive: true, force: true });
  });
});
