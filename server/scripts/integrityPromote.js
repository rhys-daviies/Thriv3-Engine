#!/usr/bin/env node
/**
 * GUARDED PROMOTION — Phase 7E. The only command that turns staged refresh observations into
 * canonical writes.
 *
 *   npm run integrity:promote -- --db <path> --batch <id> --batch-hash <hash> [--reviews <f>] [--apply] [--manifest-out <f>]
 *   npm run integrity:promote -- --db <path> --revert <promotion_id | manifest.json> [--apply]
 *
 *   1 verify the staged batch is exactly what was reviewed (deterministic batch hash)
 *   2 apply review decisions (in memory; persisted to STAGING only with --apply)
 *   3 plan ops: promotable classifications only; review-required ops only when APPROVED;
 *     frozen seasons refused; protected actions refused without approval
 *   4 SIMULATE on a copy: apply -> reconcile -> measure -> 12-gate integrity check
 *   5 dry run stops here (default). --apply: one transaction with expected-old guards and
 *     integrity_check, then the live database is re-measured and must equal the simulation;
 *     if it does not, the promotion is reverted from its own manifest.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadStagedBatch, batchHash, recordReviews } from '../lib/refresh/staging.js';
import { planPromotion, applyPromotion, revertManifest } from '../lib/refresh/promotion.js';
import { measureDatabase, copyDatabase, stripMeasure } from '../lib/refresh/integrityMeasure.js';
import { evaluateGates, planFootprint } from '../lib/refresh/integrityGate.js';
import { buildDiffReport } from '../lib/refresh/diffReport.js';
import { loadRefreshContext, frozenSeasons } from '../lib/refresh/context.js';

const argv = process.argv.slice(2);
const arg = (n) => { const eq = argv.find((a) => a.startsWith(`--${n}=`)); if (eq) return eq.split('=').slice(1).join('='); const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };
const fail = (m, code = 2) => { console.error(m); process.exit(code); };
const apply = argv.includes('--apply');
const dbPath = arg('db');
if (!dbPath) fail('Give --db.');
if (/^\/data\//.test(path.resolve(dbPath))) fail('Refusing production /data path.');

/** Metrics the live re-measure must reproduce exactly. */
const fingerprint = (m) => JSON.stringify({ mem: Object.fromEntries(Object.entries(m.membership).map(([d, v]) => [d, v.hash])), uni: Object.fromEntries(Object.entries(m.universe).map(([d, v]) => [d, v.hash])), naia: [m.naia.logical, m.naia.covered, m.naia.eligible, m.naia.strict_path], integ: m.integrity });

if (arg('revert')) {
  const db = new Database(dbPath, { fileMustExist: true, readonly: !apply });
  if (!apply) db.pragma('query_only = ON');
  const ref = arg('revert');
  const rec = fs.existsSync(ref) ? { manifest_json: fs.readFileSync(ref, 'utf8'), promotion_id: null } : db.prepare('SELECT * FROM refresh_promotions WHERE promotion_id=?').get(ref);
  if (!rec) fail(`no promotion ${ref}`);
  const manifest = JSON.parse(rec.manifest_json); const list = Array.isArray(manifest) ? manifest : manifest.manifest;
  console.log(`REVERT ${ref}: ${list.length} op(s)`);
  if (!apply) { console.log('DRY RUN — re-run with --apply to revert.'); process.exit(0); }
  const r = revertManifest(db, list);
  if (rec.promotion_id) db.prepare("UPDATE refresh_promotions SET status='REVERTED' WHERE promotion_id=?").run(rec.promotion_id);
  console.log(`REVERTED ${r.reverted} write(s).`); db.close(); process.exit(0);
}

const batchId = arg('batch'); const wantHash = arg('batch-hash');
if (!batchId || !wantHash) fail('Give --batch and --batch-hash (printed by integrity:refresh).');
// A DRY RUN IS OBSERVATIONAL: the source opens READ-ONLY. A writable connection that is the last to close a
// WAL-mode database checkpoints it (the -wal file is folded into the main file and deleted) — a physical change
// to the shared database with no row moved. Only --apply opens it writable; the simulation runs on COPIES.
const db = new Database(dbPath, { fileMustExist: true, readonly: !apply });
if (!apply) db.pragma('query_only = ON');
const staged = loadStagedBatch(db, batchId);
if (!staged) fail(`batch ${batchId} is not staged`);
const recomputed = batchHash(staged.observations);
if (recomputed !== staged.batch.batch_hash || recomputed !== wantHash) fail(`batch hash mismatch — staged ${staged.batch.batch_hash.slice(0, 12)}, recomputed ${recomputed.slice(0, 12)}, given ${String(wantHash).slice(0, 12)}. Re-stage and re-review.`, 1);
const reviews = arg('reviews') ? JSON.parse(fs.readFileSync(path.resolve(arg('reviews')), 'utf8')) : [];
const decided = new Map(reviews.map((r) => [r.observation_id, r]));
const observations = staged.observations.map((o) => (decided.has(o.observation_id) ? { ...o, review_status: decided.get(o.observation_id).decision, review_note: decided.get(o.observation_id).note || null } : o));
const ctx = loadRefreshContext(db);
const plan = planPromotion({ batch: staged.batch, observations }, { frozen: frozenSeasons(ctx, staged.batch.scope) });
console.log(`PROMOTION PLAN ${batchId}: ${plan.ops.length} op(s), ${plan.refused.length} withheld, skipped ${JSON.stringify(plan.skipped)}`);
plan.refused.slice(0, 20).forEach((r) => console.log(`  WITHHELD ${r.id}: ${r.why}`));

// SIMULATE
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'promote7e-'));
const prePath = copyDatabase(dbPath, path.join(tmp, 'pre.sqlite'));
const simPath = copyDatabase(dbPath, path.join(tmp, 'sim.sqlite'));
const sim = new Database(simPath);
let simResult;
try { simResult = applyPromotion(sim, plan, { record: false }); } catch (e) { sim.close(); fs.rmSync(tmp, { recursive: true, force: true }); fail(`SIMULATION REFUSED — ${e.message}. Nothing written.`, 1); }
sim.close();
const pre = measureDatabase(prePath); const post = measureDatabase(simPath);
const names = observations.map((o) => { try { const p = JSON.parse(o.proposed_json || '{}'); return p.full_name || p.player_name; } catch { return null; } }).filter(Boolean);
const redacted = buildDiffReport({ batch: staged.batch, observations, plan }, { redact: true });
const gate = evaluateGates({ pre, post, postPath: simPath, footprint: planFootprint(plan, observations), redactedReport: redacted, personNames: names });
console.log(`SIMULATED: applied ${simResult.applied}, noop ${simResult.noop}`);
for (const [k, ok] of Object.entries(gate.gates)) console.log(`  ${ok ? 'PASS' : 'FAIL'} ${k}`);
if (!gate.pass) console.log(JSON.stringify(gate.details, null, 1).slice(0, 3000));
console.log(`  pre  ${JSON.stringify(stripMeasure(pre).naia)}\n  post ${JSON.stringify(stripMeasure(post).naia)}`);
const reportOut = path.join(path.dirname(path.resolve(dbPath)), 'generated', 'refresh', `${batchId}.promotion.md`);
fs.mkdirSync(path.dirname(reportOut), { recursive: true });
fs.writeFileSync(reportOut, buildDiffReport({ batch: staged.batch, observations, plan, gate }, { redact: false }));
console.log(`  promotion report: ${reportOut}`);
fs.rmSync(tmp, { recursive: true, force: true });
if (!gate.pass) { db.close(); fail('\nGATE FAIL — nothing promoted.', 1); }
if (!apply) { db.close(); console.log('\nGATE PASS. DRY RUN — re-run with --apply to promote.'); process.exit(0); }

// APPLY
if (reviews.length) recordReviews(db, batchId, reviews);
const res = applyPromotion(db, plan, { batchHash: recomputed, gate: { pass: gate.pass, gates: gate.gates } });
const mo = arg('manifest-out'); if (mo) fs.writeFileSync(path.resolve(mo), JSON.stringify({ batch_id: batchId, manifest: res.manifest }, null, 2));
db.close();
const live = measureDatabase(dbPath);
if (fingerprint(live) !== fingerprint(post)) {
  console.error('\nPOST-APPLY MISMATCH — live re-measure differs from the simulation; reverting from the manifest.');
  const d2 = new Database(dbPath); revertManifest(d2, res.manifest); d2.close();
  fail('REVERTED.', 1);
}
console.log(`\nPROMOTED ${res.applied} op(s) (${res.noop} already in place). integrity ${res.integrity}. Live re-measure == simulation.`);
