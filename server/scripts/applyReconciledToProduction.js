#!/usr/bin/env node
/**
 * PHASE 3C — PRODUCTION APPLY (the ONLY script permitted to write /data).
 *
 * Additively migrates production in ONE transaction, guarded by pre/post
 * invariants; it commits only if every invariant holds, otherwise it rolls
 * back (a no-op):
 *
 *   1. applies the 188 evidence-backed athletics_domains repairs (idempotent);
 *   2. creates and populates `coaches_reconciled` by copying the VALIDATED
 *      table from a Stage-3 source copy.
 *
 * Legacy `coaches` is NEVER written — it stays as the untouched rollback
 * baseline. The sibling repair/reconcile scripts refuse /data on purpose; this
 * one is the deliberate, single, audited exception and refuses to run without
 * --confirm-production.
 *
 *   node server/scripts/applyReconciledToProduction.js \
 *     --target /data/recruitmatch.sqlite \
 *     --source /tmp/thriv3-recon/recon.sqlite \
 *     --confirm-production
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const has = (n) => process.argv.includes(`--${n}`);

const target = arg('target');
const source = arg('source');
if (!target || !source) { console.error('Need --target <prod db> and --source <validated recon copy>.'); process.exit(2); }
if (!has('confirm-production')) { console.error('Refusing to write without --confirm-production.'); process.exit(2); }

// The production baseline this migration was built and validated against.
// --expect / --expect-fp exist ONLY so the test suite can drive small fixtures;
// production omits them and the hard-coded baseline below is the guard.
let EXPECT_FP = '723c2bc4315674cf30645bcfa10aaf413c3c99fab4ed47e0e5adf60d99040650';
const EXPECT = { coaches: 6347, coach_seasons: 8595, athletics_domains: 2717, reconciled: 6347, eligible: 3884 };
const expectArg = arg('expect'); if (expectArg) Object.assign(EXPECT, JSON.parse(expectArg));
const fpArg = arg('expect-fp'); if (fpArg) EXPECT_FP = fpArg;

/** Deterministic coaches fingerprint over (id, full_name, email, school, sport). */
function fingerprint(db) {
  const cols = ['id', 'full_name', 'email', 'school', 'sport'];
  const rows = db.prepare('SELECT id, full_name, email, school, sport FROM coaches ORDER BY id').all();
  return crypto.createHash('sha256')
    .update(rows.map((r) => cols.map((c) => (r[c] == null ? '' : String(r[c]))).join('\u001f')).join('\n'))
    .digest('hex');
}

// ---- the validated source must carry the exact reconciliation we approved ----
const src = new Database(source, { readonly: true, fileMustExist: true });
const srcRecon = src.prepare('SELECT COUNT(*) n FROM coaches_reconciled').get().n;
const srcElig = src.prepare("SELECT COUNT(*) n FROM coaches_reconciled WHERE outreach_eligibility = 'YES'").get().n;
if (srcRecon !== EXPECT.reconciled || srcElig !== EXPECT.eligible) {
  console.error(`Source coaches_reconciled not as validated: rows=${srcRecon} eligible=${srcElig} `
    + `(want ${EXPECT.reconciled}/${EXPECT.eligible}). Aborting, no write.`);
  process.exit(1);
}
const reconRows = src.prepare('SELECT * FROM coaches_reconciled').all();
const reconCols = Object.keys(reconRows[0]);
src.close();

const fixture = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../docs/validation/generated/athletics_domains_repairs_final.json'), 'utf8'));

const db = new Database(target, { fileMustExist: true });

// ---- PRE-INVARIANTS: production must be exactly what we validated ----
const pre = {
  coaches: db.prepare('SELECT COUNT(*) n FROM coaches').get().n,
  coach_seasons: db.prepare('SELECT COUNT(*) n FROM coach_seasons').get().n,
  athletics_domains: db.prepare('SELECT COUNT(*) n FROM athletics_domains').get().n,
  fp: fingerprint(db),
};
const preOk = pre.coaches === EXPECT.coaches && pre.coach_seasons === EXPECT.coach_seasons
  && pre.athletics_domains === EXPECT.athletics_domains && pre.fp === EXPECT_FP;
console.log('PRE ', JSON.stringify({ ...pre, fp: `${pre.fp.slice(0, 16)}…` }), preOk ? 'OK' : 'MISMATCH');
if (!preOk) { console.error('Production does not match the validated baseline. Aborting, no write.'); db.close(); process.exit(1); }

const getDom = db.prepare('SELECT unitid, status FROM athletics_domains WHERE domain = ?');
const updDom = db.prepare('UPDATE athletics_domains SET unitid = @new_unitid, status = @new_status WHERE domain = @domain');
const intCol = /unitid|reassigned|canonicalized/;

let committed = false;
try {
  db.exec('BEGIN');

  // 1) idempotent 188-domain registry repair
  let repaired = 0; let already = 0; let missing = 0;
  for (const r of fixture) {
    const cur = getDom.get(r.domain);
    if (!cur) { missing += 1; continue; }
    if (cur.unitid === r.new_unitid && cur.status === r.new_status) { already += 1; continue; }
    updDom.run({ domain: r.domain, new_unitid: r.new_unitid, new_status: r.new_status });
    repaired += 1;
  }

  // 2) additive coaches_reconciled, copied from the validated source
  db.exec('DROP TABLE IF EXISTS coaches_reconciled');
  db.exec(`CREATE TABLE coaches_reconciled (${reconCols.map((c) => `${c} ${intCol.test(c) ? 'INTEGER' : 'TEXT'}`).join(', ')})`);
  const ins = db.prepare(`INSERT INTO coaches_reconciled (${reconCols.join(',')}) VALUES (${reconCols.map((c) => `@${c}`).join(',')})`);
  for (const row of reconRows) ins.run(row);

  // ---- POST-INVARIANTS inside the transaction ----
  const post = {
    coaches: db.prepare('SELECT COUNT(*) n FROM coaches').get().n,
    fp: fingerprint(db),
    reconciled: db.prepare('SELECT COUNT(*) n FROM coaches_reconciled').get().n,
    eligible: db.prepare("SELECT COUNT(*) n FROM coaches_reconciled WHERE outreach_eligibility = 'YES'").get().n,
    athletics_domains: db.prepare('SELECT COUNT(*) n FROM athletics_domains').get().n,
    // HARD INVARIANT: no eligible coach whose VERIFIED source-domain resolves to a
    // different institution than their canonical one (zero wrong-institution).
    wrongInstitution: db.prepare(`
      SELECT COUNT(*) n FROM coaches_reconciled cr
       WHERE cr.outreach_eligibility = 'YES' AND cr.canonical_unitid IS NOT NULL AND cr.source_domain IS NOT NULL
         AND EXISTS (SELECT 1 FROM athletics_domains d
                      WHERE d.domain = cr.source_domain
                        AND d.status IN ('VERIFIED', 'VERIFIED_ALIAS')
                        AND d.unitid IS NOT NULL AND d.unitid != cr.canonical_unitid)`).get().n,
  };
  const postOk = post.coaches === EXPECT.coaches && post.fp === EXPECT_FP
    && post.reconciled === EXPECT.reconciled && post.eligible === EXPECT.eligible
    && post.wrongInstitution === 0;
  console.log('APPLY repaired', repaired, '| already', already, '| domain-not-found', missing);
  console.log('POST', JSON.stringify({ ...post, fp: `${post.fp.slice(0, 16)}…` }), postOk ? 'OK' : 'INVARIANT-FAIL');
  if (!postOk) throw new Error('Post-invariant failed — rolling back.');

  db.exec('COMMIT');
  committed = true;
  console.log('\nAPPLY COMMITTED — additive migration applied; legacy `coaches` untouched.');
} catch (err) {
  if (!committed) { try { db.exec('ROLLBACK'); } catch { /* nothing to undo */ } }
  console.error('\nAPPLY ROLLED BACK:', err.message);
  db.close();
  process.exit(1);
}
db.close();
