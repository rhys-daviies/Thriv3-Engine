/**
 * Apply a canonical product artefact to this corpus.
 *
 *   npm run canonical:reconcile -- --artefact <file>                  dry run
 *   npm run canonical:reconcile -- --artefact <file> --apply \
 *       --target <realpath> --backup-verified <backup-dir>
 *
 * ===========================================================================
 * DRY RUN IS THE DEFAULT AND THERE IS NO FALLBACK.
 *
 * Nothing is written without `--apply`, and `--apply` refuses without both an
 * explicitly named target and a verified backup. The gates are deliberately
 * tedious: this is the one tool in the repository whose purpose is to write
 * product rows into the deployed database, and it is run by a person at a
 * shell on a host, once, under time pressure. Every refusal here is a mistake
 * that cannot then be made.
 *
 * WHAT IT WILL NOT DO, structurally rather than by policy:
 *   - write any table outside `DATASETS`
 *   - write any human-owned column of `roster_season_trust`
 *   - touch `operator_users`, `operator_sessions`, or any operational table
 *   - ship or import a derived table; `recruiting_arrivals` is REBUILT
 *     afterwards from the reconciled source, by `npm run build:recruiting`
 */
import fs from 'node:fs';
import path from 'node:path';
import db, { dbPath } from '../db/client.js';
import { corpusIdentity, sharedCorpusNotice } from '../db/corpusIdentity.js';
import {
  validateArtefact, planReconciliation, applyReconciliation, HUMAN_COLUMNS,
} from '../lib/canonicalProductArtefact.js';

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

/**
 * The backup gate.
 *
 * It reads the manifest `npm run backup` already writes rather than inventing
 * a second backup format, and it checks the two things that make a backup a
 * backup: it exists, and SQLite said the copy was intact when it was taken.
 */
export function backupAcceptable(dir) {
  if (!dir) return { ok: false, reason: 'no --backup-verified directory given' };
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) return { ok: false, reason: `no manifest.json in ${dir}` };
  let m;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { return { ok: false, reason: `manifest.json is not readable JSON: ${err.message}` }; }
  if (m.integrityCheck !== 'ok') {
    return { ok: false, reason: `backup integrity_check is "${m.integrityCheck}", not ok` };
  }
  if (!m.databaseSha256) return { ok: false, reason: 'backup manifest records no databaseSha256' };
  if (!m.takenAt) return { ok: false, reason: 'backup manifest records no takenAt' };
  return { ok: true, takenAt: m.takenAt, sha: m.databaseSha256, rowCounts: m.rowCounts ?? {} };
}

/**
 * BOTH SIDES RESOLVED, because a path is not a string comparison. On macOS
 * `/var` is a symlink to `/private/var`, which is the exact confusion L7ZM's
 * diagnostic hit — it blamed a symlink that did not exist because one side had
 * been through realpath and the other had not.
 */
function realpathOf(p) {
  try { return fs.realpathSync(path.resolve(p)); } catch { return path.resolve(p); }
}
const resolved = () => (dbPath === ':memory:' ? null : realpathOf(dbPath));

function report(plan) {
  for (const [name, p] of Object.entries(plan)) {
    console.log(`\n  ${name}  (${p.table}, ${p.mode})`);
    console.log(`    inserted            ${p.inserted}`);
    console.log(`    updated             ${p.updated}`);
    console.log(`    unchanged           ${p.unchanged}`);
    if (p.mode === 'REPLACE') {
      console.log(`    removed             ${p.removed}`);
      for (const k of p.removedKeys) console.log(`      - ${k.join(' / ')}`);
    }
    console.log(`    resulting rows      ${p.resultingRows}`);
    if (p.mode === 'MERGE_MACHINE') {
      console.log(`    human decisions preserved  ${p.humanPreserved}`);
      for (const h of p.humanPreservedRows) {
        console.log(`      · ${h.key.join(' / ')} — keeping ${h.fields.join(', ')}`);
      }
    }
  }
}

function main() {
  const file = arg('artefact');
  if (!file) { console.error('  --artefact <file> is required'); process.exit(2); }
  const artefact = JSON.parse(fs.readFileSync(file, 'utf8'));

  const identity = corpusIdentity();
  const notice = sharedCorpusNotice(identity);
  if (notice) console.log(`\n${notice}\n`);

  console.log('\nCANONICAL PRODUCT RECONCILIATION\n');
  console.log(`  artefact              ${path.basename(file)}`);
  console.log(`  format                ${artefact.format} v${artefact.version}`);
  console.log(`  source corpus         ${artefact.source?.corpusDigest?.slice(0, 16) ?? '—'}`);
  console.log(`  target                ${resolved()}`);

  const check = validateArtefact(artefact, { target: db });
  if (!check.ok) {
    console.error('\n  REFUSED. This artefact is not applicable here:\n');
    for (const e of check.errors) console.error(`    ${e}`);
    console.error('');
    process.exit(2);
  }
  console.log('  validation            passed');

  const plan = planReconciliation(artefact, { target: db });

  if (!has('apply')) {
    console.log('\n  DRY RUN — nothing has been written.');
    report(plan);
    console.log('\n  To apply: add --apply --target <the realpath above> --backup-verified <dir>\n');
    return;
  }

  /*
   * NAMING THE TARGET IS THE POINT. A path typed by hand and compared against
   * the one actually resolved is the difference between reconciling
   * production and reconciling whatever this shell happened to be pointed at.
   */
  const target = arg('target');
  const real = resolved();
  if (!target || !real || realpathOf(target) !== real) {
    console.error(`\n  REFUSED. --target must name the database being written.`);
    console.error(`    resolved  ${real}`);
    console.error(`    given     ${target ?? '(none)'}\n`);
    process.exit(2);
  }

  const backup = backupAcceptable(arg('backup-verified'));
  if (!backup.ok) {
    console.error(`\n  REFUSED. ${backup.reason}`);
    console.error('    Take one with `npm run backup -- <dir>` and verify it before applying.\n');
    process.exit(2);
  }
  console.log(`  backup                ${backup.takenAt}  ${backup.sha.slice(0, 16)}  integrity ok`);

  const applied = applyReconciliation(artefact, {
    target: db, acknowledgement: 'RECONCILE_CANONICAL_PRODUCT',
  });
  console.log('\n  APPLIED.');
  report(applied);
  console.log('\n  Derived data is NOT reconciled by this tool. Rebuild it now:');
  console.log('    npm run build:recruiting\n');
  console.log(`  Human-owned columns never written: ${HUMAN_COLUMNS.join(', ')}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
