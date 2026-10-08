import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildRegressionWorld } from '../lib/refresh/regressionWorld.js';
import { cycleOf } from '../lib/refresh/freshness.js';
import { batchPlan, outcomeOf, pendingCorrectionFor, reportDigest, OUTCOME } from '../lib/refresh/programmeContactAcquisition.js';

/**
 * PHASE 1G-D — batch programme-contact acquisition. The orchestrator adds no evidence rule and no
 * writer: it plans, gathers (here: replayed from its own page cache, offline), stages into ITS OWN
 * work copy, and judges every batch with the unchanged integrity:promote CLI. The source database
 * is never written. Institutions are the invented regression world.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(ROOT, 'server/scripts/programmeContactAcquire.js');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const fileSha = (p) => sha(fs.readFileSync(p));
const MEN = 'https://concordiatx.example/sports/mens-soccer/coaches';
const WOMEN = 'https://concordiatx.example/sports/womens-soccer/coaches';
let dir; let source; let work;

function seedLeads(db) {
  const lead = db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, email_source_url, source) VALUES (?, '2026-08-25T00:00:00Z', NULL, ?, 'Concordia University Texas', 'NAIA', ?, 'Team Email', 'generic', ?, 'graduating_seniors.coaching_staff')");
  lead.run('lead-men', 'msoccer@concordiatx.edu.example', 'mens-soccer', MEN);
  lead.run('lead-women', 'wsoccer@concordiatx.edu.example', 'womens-soccer', WOMEN);
}
/** The adapter's output for a page, as the cache stores it. */
function cachePage(url, sport, contacts, season) {
  const fetched = new Date(Date.now() - 3600_000).toISOString();
  return { page: { dataset: 'PROGRAMME_CONTACT', source_kind: 'OFFICIAL_STAFF_DIRECTORY', source_url: url, fetched_at: fetched, observed_season: season,
    page_title: `${sport === 'mens-soccer' ? "Men's" : "Women's"} Soccer Coaches - Concordia University Texas`, institution_label: 'Concordia University Texas', raw_programme: `Concordia University Texas ${sport}`,
    sport, athletics_entity_id: 'AE-U900101', source_complete: true, parser_version: 'pc-slots-1', adapter_version: 'test',
    adapter_evidence: { platform: 'SIDEARM', sha256: sha(url), staff_rows: 3, addresses: contacts.length, staged: contacts.length, malformed: 0 },
    contacts: contacts.map((c) => ({ email_origin: 'PUBLISHED_ON_SOURCE', labels: [], context_text: 'Head Coach / Assistant Coach', recruiting: false, attached_to_person: c.slot === 'PERSON' ? true : null, ...c })) } };
}
const run = (...extra) => spawnSync(process.execPath, [CLI, '--source-db', source, '--work-dir', work, '--season', String(cycleOf(new Date())), '--cohorts', 'REACQUIRE', '--batch-size', '1', '--delay-ms', '0', ...extra],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, RECRUITMATCH_DB: ':memory:' } });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1gd-')); source = path.join(dir, 'source.sqlite'); work = path.join(dir, 'work');
  buildRegressionWorld(source);
  const db = new Database(source); seedLeads(db); db.close();
  const season = cycleOf(new Date());
  fs.mkdirSync(path.join(work, 'cache'), { recursive: true });
  fs.writeFileSync(path.join(work, 'cache', `${sha(MEN).slice(0, 24)}.json`), JSON.stringify(cachePage(MEN, 'mens-soccer', [{ email: 'msoccer@concordiatx.edu.example', slot: 'SHARED', person_count: 2 }], season)));
  fs.writeFileSync(path.join(work, 'cache', `${sha(WOMEN).slice(0, 24)}.json`), JSON.stringify(cachePage(WOMEN, 'womens-soccer', [{ email: 'wsoccer@concordiatx.edu.example', slot: 'PERSON', person_count: 1 }], season)));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('the acquisition run (offline, on its own copy)', () => {
  it('verifies the shared inbox, rejects the person-slot address, gates every batch, and never writes the source', () => {
    const before = fileSha(source);
    const r = run('--apply-work');
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(fileSha(source)).toBe(before);
    const rep = JSON.parse(fs.readFileSync(path.join(work, 'report.json'), 'utf8'));
    const by = Object.fromEntries(rep.targets.map((t) => [t.sport, t]));
    expect(by['mens-soccer']).toMatchObject({ outcome: OUTCOME.VERIFIED, contacts: [expect.objectContaining({ email: 'msoccer@concordiatx.edu.example', slot: 'SHARED', person_count: 2 })] });
    expect(by['mens-soccer'].coverage).toMatchObject({ effect: 'RETAINS_NAMED_COACH_PRIORITY' });   // the world's named head coach stays first
    expect(by['womens-soccer']).toMatchObject({ outcome: OUTCOME.REJECTED, reason: 'CONTRADICTION', published: [{ email: 'wsoccer@concordiatx.edu.example', slot: 'PERSON', person_count: 1 }] });
    expect(rep.batches.every((b) => ['APPLIED_TO_WORK', 'DRY_RUN_FAILED'].includes(b.status))).toBe(true);
    expect(rep.batches.find((b) => b.status === 'APPLIED_TO_WORK').gates).toMatchObject({ G13_programme_contacts_valid: true, G14_programme_contact_changes_accounted: true });
    expect(rep.resume.complete).toBe(true);
    const w = new Database(path.join(work, 'work.sqlite'), { readonly: true });
    expect(w.prepare('SELECT email FROM programme_contacts').pluck().all()).toEqual(['msoccer@concordiatx.edu.example']);
    w.close();
    const s = new Database(source, { readonly: true });
    expect(s.prepare('SELECT COUNT(*) FROM programme_contacts').pluck().get()).toBe(0);
    expect(s.prepare('SELECT COUNT(*) FROM refresh_batches').pluck().get()).toBe(new Database(path.join(work, 'base.sqlite'), { readonly: true }).prepare('SELECT COUNT(*) FROM refresh_batches').pluck().get());
    s.close();
  }, 240000);

  it('is resumable and idempotent: a re-run stages nothing new and reproduces the same report digest', () => {
    expect(run('--apply-work').status).toBe(0);
    const rep1 = JSON.parse(fs.readFileSync(path.join(work, 'report.json'), 'utf8'));
    const w1 = new Database(path.join(work, 'work.sqlite'), { readonly: true }); const n1 = w1.prepare('SELECT COUNT(*) FROM refresh_batches').pluck().get(); w1.close();
    expect(run('--apply-work').status).toBe(0);
    const rep2 = JSON.parse(fs.readFileSync(path.join(work, 'report.json'), 'utf8'));
    const w2 = new Database(path.join(work, 'work.sqlite'), { readonly: true });
    expect(w2.prepare('SELECT COUNT(*) FROM refresh_batches').pluck().get()).toBe(n1);
    expect(w2.prepare('SELECT COUNT(*) FROM programme_contacts').pluck().get()).toBe(1);
    w2.close();
    expect(rep2.report_digest).toBe(rep1.report_digest);
    // a report never changes the work copy (the selection module boots a throwaway copy)
    const before = fileSha(path.join(work, 'work.sqlite'));
    expect(run('--report-only').status).toBe(0);
    expect(fileSha(path.join(work, 'work.sqlite'))).toBe(before);
    expect(fs.existsSync(path.join(work, 'report_scratch.sqlite'))).toBe(false);
  }, 240000);

  it('refuses to resume once the source has changed, and refuses a work directory that holds the source', () => {
    expect(run().status).toBe(0);
    const db = new Database(source); db.prepare("UPDATE coaches SET position_title = 'x' WHERE id = 'lead-men'").run(); db.close();
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/SOURCE CHANGED/);
    const r2 = spawnSync(process.execPath, [CLI, '--source-db', path.join(work, 'base.sqlite'), '--work-dir', work, '--season', '2026'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, RECRUITMATCH_DB: ':memory:' } });
    expect(r2.status).toBe(2);
    expect(r2.stderr).toMatch(/holds the source database itself/);
  }, 240000);
});

describe('planning and outcome logic (pure)', () => {
  const plan = { plan_hash: 'a'.repeat(64), skipped: [], targets: ['e1', 'e2', 'e3', 'e4', 'e5'].map((e) => ({ athletics_entity_id: e, sport: 'mens-soccer', staff_url: `https://${e}.example/c` })) };
  it('batches are stable, sized, and exclude programmes already holding a VERIFIED contact', () => {
    const a = batchPlan(plan, { batchSize: 2, held: new Set(['e2|mens-soccer']) });
    expect(a.batches.map((b) => b.targets.map((t) => t.athletics_entity_id))).toEqual([['e1', 'e3'], ['e4', 'e5']]);
    expect(a.already_held.map((t) => t.athletics_entity_id)).toEqual(['e2']);
    expect(a.batches.map((b) => b.batch_key)).toEqual(['ACQ-aaaaaaaaaaaa-S2-B001', 'ACQ-aaaaaaaaaaaa-S2-B002']);
    expect(batchPlan(plan, { batchSize: 2, held: new Set(['e2|mens-soccer']) }).run_id).toBe(a.run_id);
    expect(() => batchPlan(plan, { batchSize: 0 })).toThrow();
  });
  it('one outcome per target', () => {
    expect(outcomeOf({})).toMatchObject({ outcome: OUTCOME.UNRESOLVED });
    expect(outcomeOf({ gathered: { refusal: { code: 'WRONG_SPORT', detail: 'x' } } })).toMatchObject({ outcome: OUTCOME.REFUSED_AT_SOURCE, reason: 'WRONG_SPORT' });
    expect(outcomeOf({ gathered: { page: {} }, observations: [{ classification: 'CONTRADICTION', proposed_action: null, evidence_json: '{"why":["one person"]}' }] })).toMatchObject({ outcome: OUTCOME.REJECTED, reason: 'CONTRADICTION' });
    const created = [{ classification: 'NEW_RECORD', proposed_action: 'CREATE_PROGRAMME_CONTACT' }];
    expect(outcomeOf({ gathered: { page: {} }, observations: created })).toMatchObject({ outcome: OUTCOME.UNRESOLVED });
    expect(outcomeOf({ gathered: { page: {} }, observations: created, gate: { pass: false, failed: ['G13'] } })).toMatchObject({ outcome: OUTCOME.GATE_FAILED });
    expect(outcomeOf({ gathered: { page: {} }, observations: created, gate: { pass: true } })).toMatchObject({ outcome: OUTCOME.VERIFIED });
  });
  it('names a pending Data Integrity correction for a lead whose page host awaits it', () => {
    expect(pendingCorrectionFor({ legacy: { email_source_url: 'https://lmulions.com/sports/mens-soccer/coaches' } }, new Set(['lmulions.com']))).toMatchObject({ host: 'lmulions.com' });
    expect(pendingCorrectionFor({ legacy: { email_source_url: 'https://other.example/x' } }, new Set(['lmulions.com']))).toBeNull();
  });
  it('the report digest ignores timestamps only', () => {
    expect(reportDigest({ a: 1, generated_at: 'x', t: [{ fetched_at: 'y', b: 2 }] })).toBe(reportDigest({ a: 1, generated_at: 'z', t: [{ fetched_at: 'w', b: 2 }] }));
    expect(reportDigest({ a: 1 })).not.toBe(reportDigest({ a: 2 }));
    expect(reportDigest({ a: 1, b: [{ promotion_id: 'RP-1' }] })).toBe(reportDigest({ a: 1, b: [{ promotion_id: 'RP-2' }] }));
  });
});
