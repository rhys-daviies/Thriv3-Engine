import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildRegressionWorld, W, PEOPLE, staffPage, rosterPage, published } from './regressionWorld.js';
import { stageRefresh, writeStagedBatch, loadStagedBatch, recordReviews, batchHash } from './staging.js';
import { planPromotion, applyPromotion, revertManifest } from './promotion.js';
import { buildDiffReport } from './diffReport.js';
import { seasonFingerprint } from './temporal.js';
import { validateEntityIdentity } from '../../scripts/validateAthleticsEntityIdentity.js';

/**
 * PHASE 7E — the staging -> review -> promotion pipeline on the regression world.
 * Proves: staging never writes canonical tables; review-required ops never promote unreviewed;
 * expected-old guards roll the whole batch back; promotion is idempotent and revertible;
 * frozen seasons are refused; the shareable report is redacted; history survives.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let dir; let dbPath;
const CANON = ['colleges', 'coaches', 'roster_players', 'athletics_domains', 'athletics_entities', 'institution_aliases', 'programme_membership_periods', 'programme_conference_seasons', 'coach_seasons', 'programme_seasons'];
const canonHash = (db) => crypto.createHash('sha256').update(CANON.map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).raw().all())).join('|')).digest('hex');
const input = (pages, extra = {}) => ({ season: 2027, scope: 'NAIA', parser_version: 'test-1', gathered_at: '2027-08-20T00:00:00Z', pages, ...extra });
const ssuPage = { dataset: 'PROGRAMME', institution_label: 'Shawnee State', sport: 'mens-soccer', season: 2027, division: 'NCAA D2', conference: 'Mountain East Conference', membership_status: 'PROVISIONAL', postseason_eligible: 0,
  sources: [{ url: 'https://mountaineast.example/news/ssu', kind: 'CONFERENCE_SITE' }, { url: 'https://ssubears.example/sports/mens-soccer/schedule/2027', kind: 'OFFICIAL_SCHEDULE' }] };
const refreshPages = () => [
  staffPage({ people: [published({ full_name: 'Quinn Successor', role: 'Head Coach', email: 'quinn.successor@concordiatx.example' }), published(PEOPLE.ASSIST), { full_name: 'Nova Newhire', role: 'Assistant Coach', email: 'nova.newhire@concordiatx.example', email_origin: 'INFERRED' }] }),
  rosterPage({ players: [{ player_name: 'Alex Keeper', class_year_label: 'Jr.', position: 'GK' }, { player_name: 'Robin Rookie', class_year_label: 'Fr.', position: 'DF' }] }),
  ssuPage,
];
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7e-pipe-')); dbPath = path.join(dir, 'w.sqlite'); buildRegressionWorld(dbPath); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('staging', () => {
  it('stageRefresh + writeStagedBatch write ONLY the staging tables', () => {
    const db = new Database(dbPath); const before = canonHash(db);
    const staged = stageRefresh(db, input(refreshPages()));
    const w = writeStagedBatch(db, staged);
    expect(w.written).toBe(staged.observations.length);
    expect(canonHash(db)).toBe(before);
    expect(db.prepare('SELECT COUNT(*) n FROM refresh_observations').get().n).toBe(staged.observations.length);
    expect(writeStagedBatch(db, staged).unchanged).toBe(true); // idempotent staging
    db.close();
  });
  it('the refresh CLI dry run writes nothing at all; --stage writes staging only', () => {
    const inp = path.join(dir, 'in.json'); fs.writeFileSync(inp, JSON.stringify(input(refreshPages())));
    const db0 = new Database(dbPath, { readonly: true }); const before = canonHash(db0); db0.close();
    const out = execFileSync(process.execPath, ['server/scripts/integrityRefresh.js', '--db', dbPath, '--input', inp, '--season', '2027', '--division', 'NAIA', '--report-out', path.join(dir, 'r.md')], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toMatch(/DRY RUN/); expect(out).toMatch(/STOP\./);
    const db1 = new Database(dbPath, { readonly: true }); expect(db1.prepare('SELECT COUNT(*) n FROM refresh_batches').get().n).toBe(0); expect(canonHash(db1)).toBe(before); db1.close();
    execFileSync(process.execPath, ['server/scripts/integrityRefresh.js', '--db', dbPath, '--input', inp, '--stage', '--report-out', path.join(dir, 'r.md')], { cwd: ROOT, encoding: 'utf8' });
    const db2 = new Database(dbPath, { readonly: true }); expect(db2.prepare('SELECT COUNT(*) n FROM refresh_batches').get().n).toBe(1); expect(canonHash(db2)).toBe(before); db2.close();
  });
});

describe('promotion', () => {
  it('review-required and protected actions are withheld until APPROVED; safe facts promote', () => {
    const db = new Database(dbPath);
    const staged = stageRefresh(db, input(refreshPages())); writeStagedBatch(db, staged);
    const { batch, observations } = loadStagedBatch(db, staged.batch.batch_id);
    const plan = planPromotion({ batch, observations }, { frozen: new Set([2025]) });
    const actions = plan.ops.map((o) => o.action).sort();
    expect(actions).toContain('CREATE_COACH');
    expect(actions).toContain('INSERT_ROSTER_ROW');
    expect(actions).not.toContain('MARK_PROVEN_STALE');     // head coach departure: review
    expect(actions).not.toContain('CHANGE_DIVISION');       // membership change: review
    expect(plan.refused.map((r) => r.why).join(' ')).toMatch(/requires an APPROVED review/);
    const res = applyPromotion(db, plan, { batchHash: batch.batch_hash });
    expect(res.integrity).toBe('ok');
    const nova = db.prepare("SELECT * FROM coaches WHERE full_name='Nova Newhire'").get();
    expect(nova.email).toBeNull(); expect(nova.email_status).toBe('unknown'); // inferred address never stored
    expect(db.prepare('SELECT currentness_status FROM coaches WHERE id=?').get(PEOPLE.HEAD.id).currentness_status).toBe('CURRENT'); // not demoted without review
    expect(db.prepare('SELECT COUNT(*) n FROM coaches WHERE id=?').get(PEOPLE.OLDASSIST.id).n).toBe(1); // never deleted
    db.close();
  });
  it('an approved Shawnee transition closes the NAIA period, opens NCAA D2 provisional, and rewrites no history', () => {
    const db = new Database(dbPath);
    const pcsBefore = JSON.stringify(db.prepare('SELECT * FROM programme_conference_seasons ORDER BY season').all());
    const fp2025 = JSON.stringify(seasonFingerprint(db, 2025));
    const staged = stageRefresh(db, input([ssuPage])); writeStagedBatch(db, staged);
    const o = staged.observations.find((x) => x.proposed_action === 'CHANGE_DIVISION');
    recordReviews(db, staged.batch.batch_id, [{ observation_id: o.observation_id, decision: 'APPROVED', note: 'MEC announcement + schedule' }]);
    const loaded = loadStagedBatch(db, staged.batch.batch_id);
    const plan = planPromotion(loaded, { frozen: new Set([2025]) });
    expect(plan.ops.map((x) => x.action)).toEqual(['CHANGE_DIVISION']);
    applyPromotion(db, plan, { batchHash: loaded.batch.batch_hash });
    const periods = db.prepare("SELECT * FROM programme_membership_periods WHERE athletics_entity_id='AE-U901001' ORDER BY first_season").all();
    expect(periods.map((p) => [p.first_season, p.last_season, p.division, p.membership_status])).toEqual([[2026, 2026, 'NAIA', 'ACTIVE'], [2027, null, 'NCAA D2', 'PROVISIONAL']]);
    expect(db.prepare('SELECT division, conference FROM colleges WHERE id=?').get(W.SSU)).toEqual({ division: 'NCAA D2', conference: 'Mountain East Conference' });
    expect(JSON.stringify(db.prepare('SELECT * FROM programme_conference_seasons ORDER BY season').all())).toBe(pcsBefore);
    expect(JSON.stringify(seasonFingerprint(db, 2025))).toBe(fp2025);
    expect(validateEntityIdentity(db, { allowlist: [], knownWrongUnitid: [] }).status).toBe('PASS');
    db.close();
  });
  it('an expected-old guard failure rolls the WHOLE batch back', () => {
    const db = new Database(dbPath);
    const staged = stageRefresh(db, input([staffPage({ people: [published(PEOPLE.HEAD), published(PEOPLE.ASSIST, 'sam.a@concordiatx.example'), { full_name: 'New One', role: 'Assistant Coach', email: 'new.one@concordiatx.example', email_origin: 'PUBLISHED_ON_SOURCE' }] })]));
    writeStagedBatch(db, staged);
    const loaded = loadStagedBatch(db, staged.batch.batch_id);
    const rep = loaded.observations.find((x) => x.proposed_action === 'REPLACE_VERIFIED_EMAIL');
    recordReviews(db, staged.batch.batch_id, [{ observation_id: rep.observation_id, decision: 'APPROVED' }]);
    const plan = planPromotion(loadStagedBatch(db, staged.batch.batch_id), {});
    db.prepare('UPDATE coaches SET email=? WHERE id=?').run('someone.else@concordiatx.example', PEOPLE.ASSIST.id); // the world moved after staging
    const before = canonHash(db);
    expect(() => applyPromotion(db, plan, {})).toThrow(/expected-old/);
    expect(canonHash(db)).toBe(before);
    expect(db.prepare("SELECT COUNT(*) n FROM coaches WHERE full_name='New One'").get().n).toBe(0);
    db.close();
  });
  it('is idempotent and revertible from its manifest', () => {
    const db = new Database(dbPath); const before = canonHash(db);
    const staged = stageRefresh(db, input(refreshPages())); writeStagedBatch(db, staged);
    const plan = planPromotion(loadStagedBatch(db, staged.batch.batch_id), { frozen: new Set([2025]) });
    const r1 = applyPromotion(db, plan, { record: false });
    const r2 = applyPromotion(db, plan, { record: false });
    expect(r2.applied).toBe(0); expect(r2.noop).toBe(plan.ops.length);
    revertManifest(db, r1.manifest);
    expect(canonHash(db)).toBe(before);
    db.close();
  });
  it('a frozen season is refused at planning even if an observation slipped through', () => {
    const db = new Database(dbPath);
    const staged = stageRefresh(db, input([rosterPage({ source_url: 'https://concordiatx.example/sports/mens-soccer/roster/2025', page_season: 2025, observed_season: 2025, players: [{ player_name: 'Late Add', class_year_label: 'Fr.' }] })], { season: 2025 }));
    const forged = staged.observations.map((o) => ({ ...o, classification: 'NEW_RECORD', proposed_action: 'INSERT_ROSTER_ROW', proposed_json: JSON.stringify({ season: '2025', player_name: 'Late Add' }) }));
    const plan = planPromotion({ batch: staged.batch, observations: forged }, { frozen: new Set([2025]) });
    expect(plan.ops).toHaveLength(0); expect(plan.refused[0].why).toMatch(/frozen/);
    db.close();
  });
  it('the batch hash detects any tampering between review and promotion', () => {
    const db = new Database(dbPath);
    const staged = stageRefresh(db, input(refreshPages())); writeStagedBatch(db, staged);
    db.prepare("UPDATE refresh_observations SET proposed_json='{\"email\":\"x@concordiatx.example\"}' WHERE proposed_action='CREATE_COACH'").run();
    expect(batchHash(loadStagedBatch(db, staged.batch.batch_id).observations)).not.toBe(staged.batch.batch_hash);
    db.close();
  });
});

describe('diff report + privacy', () => {
  it('lists every section; the redacted form carries no names and no addresses', () => {
    const db = new Database(dbPath, { readonly: true });
    const staged = stageRefresh(db, input(refreshPages())); db.close();
    const full = buildDiffReport(staged, { redact: false }); const red = buildDiffReport(staged, { redact: true });
    for (const h of ['## PROGRAMMES', '## COACHES', '## ROSTERS', '## DOMAINS', '## INTEGRITY', 'division / membership changed', 'departed — named replacement', 'transfer candidates']) expect(full).toContain(h);
    expect(full).toContain('Quinn Successor');
    expect(red).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    for (const n of ['Quinn Successor', 'Robin Rookie', 'Pat Headcoach', 'Nova Newhire']) expect(red).not.toContain(n);
  });
});

describe('end-to-end CLI: stage -> gate -> promote -> re-measure', () => {
  it('promotes a gated batch on the world and the live re-measure equals the simulation', () => {
    const inp = path.join(dir, 'in.json'); fs.writeFileSync(inp, JSON.stringify(input([staffPage({ source_complete: false, people: [published(PEOPLE.HEAD), published({ full_name: 'Robin Coach', role: 'Assistant Coach', email: 'robin.coach@concordiatx.example' })] })])));
    const o1 = execFileSync(process.execPath, ['server/scripts/integrityRefresh.js', '--db', dbPath, '--input', inp, '--stage', '--report-out', path.join(dir, 'r.md')], { cwd: ROOT, encoding: 'utf8' });
    const id = o1.match(/REFRESH (RB-\S+)/)[1]; const h = o1.match(/batch hash ([0-9a-f]{64})/)[1];
    const dry = execFileSync(process.execPath, ['server/scripts/integrityPromote.js', '--db', dbPath, '--batch', id, '--batch-hash', h], { cwd: ROOT, encoding: 'utf8' });
    expect(dry).toMatch(/GATE PASS\. DRY RUN/);
    const live = execFileSync(process.execPath, ['server/scripts/integrityPromote.js', '--db', dbPath, '--batch', id, '--batch-hash', h, '--apply'], { cwd: ROOT, encoding: 'utf8' });
    expect(live).toMatch(/Live re-measure == simulation/);
    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare("SELECT email_status FROM coaches WHERE full_name='Robin Coach'").get().email_status).toBe('verified');
    expect(db.prepare("SELECT status FROM refresh_batches WHERE batch_id=?").get(id).status).toBe('PROMOTED');
    db.close();
    expect(() => execFileSync(process.execPath, ['server/scripts/integrityPromote.js', '--db', dbPath, '--batch', id, '--batch-hash', '0'.repeat(64)], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' })).toThrow();
  }, 120000);
});
