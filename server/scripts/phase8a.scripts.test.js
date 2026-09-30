import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildRegressionWorld, W } from '../lib/refresh/regressionWorld.js';
import { validateEntityIdentity } from './validateAthleticsEntityIdentity.js';
import { seasonFingerprint } from '../lib/refresh/temporal.js';
import { runMonitor } from './integrityMonitor.js';

/**
 * PHASE 8A — the guarded universe applier and the staging-only gather command, on the
 * regression world (NAIA/NCAA rows present, so non-regression is observable).
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let dir; let dbPath;
const T = '2026-09-30T00:00:00Z';
const canon = (db) => crypto.createHash('sha256').update(['colleges', 'athletics_entities', 'programme_membership_periods', 'coaches', 'roster_players', 'athletics_domains'].map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).raw().all())).join('|')).digest('hex');
const naiaNcaa = (db) => JSON.stringify(db.prepare("SELECT id, name, sport, division, conference, active, unitid, athletics_entity_id FROM colleges WHERE division NOT IN ('NJCAA','USCAA') ORDER BY id").all());
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p8a-')); dbPath = path.join(dir, 'w.sqlite'); buildRegressionWorld(dbPath); const db = new Database(dbPath);
  db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, unitid, active, athletics_entity_id) VALUES ('c-phantom', ?, ?, 'Phantom JC', 'mens-soccer', 'NJCAA', 'X', NULL, 1, 'AE-X-PHANTOM')").run(T, T);
  db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, entity_kind, provenance, created_at) VALUES ('AE-X-PHANTOM','Phantom JC','UNRESOLVED_FEDERAL','test',?)").run(T);
  db.prepare("INSERT INTO programme_membership_periods (athletics_entity_id, sport, first_season, governing_body, division, membership_status, conference, college_id, source_tier, provenance, recorded_at) VALUES ('AE-X-PHANTOM','mens-soccer',2026,'NJCAA','NJCAA','ACTIVE','X','c-phantom','SEED','seed',?)").run(T);
  db.close(); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const fixture = () => {
  const body = {
    entity_create: [{ label: 'entity AE-U990001', expected_old: { absent: true }, proposed: { athletics_entity_id: 'AE-U990001', display_name: 'Casper College', federal_unitid: 990001, parent_unitid: null, campus_label: null, entity_kind: 'SINGLE', provenance: 'federal registry test record', notes: null }, evidence: 'registry', reason: 'new', blast_radius: 'identity only' }],
    entity_update: [], college_repair: [],
    programme_create: [{ label: 'Casper College [womens-soccer]', expected_old: { absent: true }, proposed: { college: { id: 'c-casper-w', name: 'Casper College', sport: 'womens-soccer', division: 'NJCAA', conference: 'NJCAA Region 9', unitid: 990001, state: 'WY', city: 'Casper', active: 1, athletics_entity_id: 'AE-U990001' }, period: { athletics_entity_id: 'AE-U990001', sport: 'womens-soccer', first_season: 2026, last_season: null, governing_body: 'NJCAA', division: 'NJCAA', membership_status: 'ACTIVE', conference: 'NJCAA Region 9', postseason_eligible: null, college_id: 'c-casper-w', source_url: 'https://region9.example/sports/wsoc/2026-27/teams', source_tier: 'B', provenance: 'listed', review_due_season: null } }, evidence: 'region 9 teams page', reason: 'missing women\'s programme', blast_radius: 'one NJCAA programme' }],
    membership_verify: [], row_link: [],
    deactivate: [{ label: 'Phantom JC', college_id: 'c-phantom', expected_old: { active: 1 }, proposed: { active: 0, membership_status: 'DISCONTINUED' }, evidence: 'complete region listing excludes it', reason: 'phantom', blast_radius: 'one row inactive' }],
    domain_register: [],
  };
  return { phase: '8A-universe', created_at: T, fixture_hash: crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'), ...body };
};
const run = (fx, extra = []) => { const f = path.join(dir, 'fx.json'); fs.writeFileSync(f, JSON.stringify(fx)); return execFileSync(process.execPath, ['server/scripts/applyPhase8AUniverse.js', '--db', dbPath, '--fixture', f, '--fixture-hash', fx.fixture_hash, ...extra], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }); };

describe('applyPhase8AUniverse (guarded, idempotent, revertible; never touches NAIA/NCAA)', () => {
  it('dry run writes nothing; apply adds the programme + period, retires the phantom; re-run is a no-op; revert restores', () => {
    let db = new Database(dbPath, { readonly: true }); const before = canon(db); const other = naiaNcaa(db); const fp = JSON.stringify(seasonFingerprint(db, 2025)); db.close();
    expect(run(fixture())).toMatch(/DRY RUN/);
    db = new Database(dbPath, { readonly: true }); expect(canon(db)).toBe(before); db.close();
    const man = path.join(dir, 'm.json');
    expect(run(fixture(), ['--apply', '--manifest-out', man])).toMatch(/APPLIED/);
    db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT division, active FROM colleges WHERE id='c-casper-w'").get()).toEqual({ division: 'NJCAA', active: 1 });
    expect(db.prepare("SELECT source_tier FROM programme_membership_periods WHERE college_id='c-casper-w'").get().source_tier).toBe('B');
    expect(db.prepare("SELECT active FROM colleges WHERE id='c-phantom'").get().active).toBe(0);
    expect(db.prepare("SELECT membership_status FROM programme_membership_periods WHERE college_id='c-phantom'").get().membership_status).toBe('DISCONTINUED');
    expect(validateEntityIdentity(db, { allowlist: [], knownWrongUnitid: [] }).status).toBe('PASS');
    expect(naiaNcaa(db)).toBe(other); expect(JSON.stringify(seasonFingerprint(db, 2025))).toBe(fp);
    db.close();
    expect(run(fixture(), ['--apply'])).toMatch(/noop 3/);
    execFileSync(process.execPath, ['server/scripts/applyPhase8AUniverse.js', '--db', dbPath, '--revert', man, '--apply'], { cwd: ROOT, stdio: 'pipe' });
    db = new Database(dbPath, { readonly: true }); expect(canon(db)).toBe(before); db.close();
  });
  it('refuses an action without evidence / reason / blast radius, and a tampered fixture', () => {
    const fx = fixture(); delete fx.programme_create[0].blast_radius; const { phase, created_at, fixture_hash, ...b } = fx; fx.fixture_hash = crypto.createHash('sha256').update(JSON.stringify(b)).digest('hex');
    let out = ''; try { run(fx, ['--apply']); } catch (e) { out = `${e.stdout}${e.stderr}`; } expect(out).toMatch(/missing blast_radius/);
    const t = fixture(); t.fixture_hash = '0'.repeat(64); let code = 0; try { run(t, ['--apply']); } catch (e) { code = e.status; } expect(code).toBe(1);
  });
  it('refuses to retire a "phantom" that has dependent rows', () => {
    const db = new Database(dbPath); db.prepare("INSERT INTO programme_seasons (college_id, sport, season, wins, draws, losses, matches_played, source, source_record_name, confidence, imported_at) VALUES ('c-phantom','mens-soccer',2025,1,0,0,1,'test','Phantom JC','UNCHECKED',?)").run(T); db.close();
    let out = ''; try { run(fixture(), ['--apply']); } catch (e) { out = `${e.stdout}${e.stderr}`; } expect(out).toMatch(/has dependent rows/);
  });
});

describe('monitor — NJCAA/USCAA are reported, never frozen', () => {
  it('reports universe / unresolved / verification per division and never FAILs on them', () => {
    const before = runMonitor(dbPath, { now: new Date('2026-09-30'), reconcile: false });
    const nj = (r, id) => r.checks.find((c) => c.category === 'NJCAA' && c.id === id);
    expect(nj(before, 'programme_universe').count).toBe(1);
    expect(nj(before, 'unresolved_entity').severity).toBe('WARN');
    expect(nj(before, 'membership_unverified').count).toBe(1);
    expect(before.checks.filter((c) => ['NJCAA', 'USCAA'].includes(c.category)).every((c) => c.severity !== 'HARD')).toBe(true);
    run(fixture(), ['--apply']);
    const after = runMonitor(dbPath, { now: new Date('2026-09-30'), reconcile: false });
    expect(nj(after, 'programme_universe').note).toMatch(/men 0, women 1/);
    expect(nj(after, 'unresolved_entity').count).toBe(0);
    expect(nj(after, 'membership_unverified').count).toBe(0);
    expect(nj(after, 'membership_unverified').note).toMatch(/^1 verified/);
    expect(nj(after, 'single_gender_entities').count).toBe(1);
    expect(after.status).not.toBe('FAIL');
  });
});

describe('integrityGather never writes the database', () => {
  it('fetches through the adapters and writes only the gathered file', async () => {
    const roster = `<title>2026-27 Men's Soccer Roster</title><table><thead><tr><th>Name</th><th>Pos.</th><th>Cl.</th></tr></thead><tbody>${Array.from({ length: 10 }, (_, i) => `<tr><td>P ${i}</td><td>MF</td><td>Fr.</td></tr>`).join('')}</tbody></table>${'x'.repeat(900)} prestosports`;
    const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(req.url.includes('roster') ? roster : '<title>404</title>'); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const db0 = new Database(dbPath, { readonly: true }); const before = canon(db0); db0.close();
    const plan = path.join(dir, 'plan.json'); const out = path.join(dir, 'g.json'); const rep = path.join(dir, 'r.json');
    fs.writeFileSync(plan, JSON.stringify({ targets: [{ athletics_entity_id: 'AE-U900101', institution_label: 'Concordia University Texas', sport: 'mens-soccer', host: 'concordiatx.example', platform: 'PRESTO', kinds: ['ROSTER', 'COACH'], roster_url: `http://127.0.0.1:${port}/sports/msoc/2026-27/roster`, staff_url: `http://127.0.0.1:${port}/sports/msoc/coaches` }] }));
    const child = spawn(process.execPath, ['server/scripts/integrityGather.js', '--db', dbPath, '--plan', plan, '--season', '2026', '--scope', 'NAIA', '--out', out, '--report', rep], { cwd: ROOT, env: { ...process.env, DELAY_MS: '10' } });
    await new Promise((r) => child.on('exit', r)); srv.close();
    const report = JSON.parse(fs.readFileSync(rep, 'utf8'));
    // roster: 127.0.0.1 is not a host the entity owns -> INSTITUTION_MISMATCH; staff: a tiny 404
    // body is refused as blocked/incomplete BEFORE ownership is considered. Nothing is staged.
    expect(report.refusals.map((x) => x.code)).toEqual(['INSTITUTION_MISMATCH', 'BLOCKED_OR_INCOMPLETE_PAGE']);
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).pages).toHaveLength(0);
    const db1 = new Database(dbPath, { readonly: true }); expect(canon(db1)).toBe(before); db1.close();
  }, 60000);
});
