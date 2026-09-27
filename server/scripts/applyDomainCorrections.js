#!/usr/bin/env node
/**
 * Apply an EXTERNALLY ADJUDICATED athletics_domains UNITID correction set.
 *
 *   node server/scripts/applyDomainCorrections.js --db <path> --fixture <path>            # dry-run
 *   node server/scripts/applyDomainCorrections.js --db <path> --fixture <path> --apply
 *
 * The current correction set is
 * `docs/validation/integrity-audit/phase2d_approved_corrections.json` (23 rows).
 *
 * THE PHASE-2A SET THIS SCRIPT WAS WRITTEN FOR IS DISPROVEN. Phase 2B applied its
 * 27 rows and reverted all of them: `claimed_unitids` is not authoritative about
 * who owns a domain, and two of the 27 (pct.edu, wvu.edu) were correct before the
 * "correction". That file has since been rewritten as an annotated object carrying
 * each row's Phase-2C verdict, so it is no longer iterable and this script would
 * throw rather than apply it — see server/scripts/mutationPathSafety.test.js.
 *
 * ALL-OR-NOTHING. Every row must pass its precondition or the entire 27-row
 * apply rolls back — never a partial apply. Idempotent: a row already at the
 * corrected UNITID is counted as already-applied, not re-written. Touches ONLY
 * athletics_domains.unitid; never coaches. Refuses the production /data path.
 *
 * Preconditions per row (all required):
 *   1. the domain exists and is VERIFIED/VERIFIED_ALIAS
 *   2. its current UNITID == expected old_unitid  (or already == new_unitid)
 *   3. its claimed_unitids resolves UNIQUELY to expected new_unitid
 *   4. the corrected institution (new_unitid) exists in colleges or the official directory
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const dbArg = arg('db');
if (!dbArg) { console.error('Give --db <target>.'); process.exit(2); }
if (/^\/data\//.test(path.resolve(dbArg))) {
  console.error('Refusing to target the production /data volume. Production apply is gated behind Phase 3C.'); process.exit(2);
}
const fixtureArg = arg('fixture');
if (!fixtureArg) { console.error('Give --fixture <path> (e.g. docs/validation/integrity-audit/phase2d_approved_corrections.json).'); process.exit(2); }
const fixture = JSON.parse(fs.readFileSync(path.resolve(fixtureArg), 'utf8'));

const db = new Database(dbArg, { fileMustExist: true });
const getDom = db.prepare('SELECT unitid, status, claimed_unitids FROM athletics_domains WHERE domain = ?');
const instExists = db.prepare(
  'SELECT (SELECT COUNT(*) FROM colleges WHERE unitid=@u) + (SELECT COUNT(*) FROM conference_members_official WHERE unitid=@u) AS n');
const upd = db.prepare('UPDATE athletics_domains SET unitid = @new WHERE domain = @domain AND unitid = @old');

const plan = []; const problems = [];
let already = 0;
for (const f of fixture) {
  const cur = getDom.get(f.domain);
  if (!cur) { problems.push(`${f.domain}: ABSENT`); continue; }
  if (Number(cur.unitid) === Number(f.new_unitid)) { already++; continue; } // idempotent: already corrected
  if (!['VERIFIED', 'VERIFIED_ALIAS'].includes(cur.status)) { problems.push(`${f.domain}: status ${cur.status} not VERIFIED`); continue; }
  if (Number(cur.unitid) !== Number(f.old_unitid)) { problems.push(`${f.domain}: current UNITID ${cur.unitid} != expected old ${f.old_unitid} (drift)`); continue; }
  let claimed = [];
  try { claimed = [...new Set(JSON.parse(cur.claimed_unitids || '[]').map(Number).filter((n) => !Number.isNaN(n)))]; } catch { /* malformed */ }
  if (!(claimed.length === 1 && claimed[0] === Number(f.new_unitid))) {
    problems.push(`${f.domain}: claimed_unitids ${JSON.stringify(claimed)} does not resolve uniquely to ${f.new_unitid}`); continue;
  }
  if (instExists.get({ u: Number(f.new_unitid) }).n === 0) { problems.push(`${f.domain}: corrected institution ${f.new_unitid} not found`); continue; }
  plan.push({ domain: f.domain, old: Number(f.old_unitid), new: Number(f.new_unitid) });
}

console.log(`Fixture ${fixture.length} | applicable ${plan.length} | already-correct ${already} | precondition failures ${problems.length}`);
problems.forEach((p) => console.log('  BLOCKED:', p));

if (problems.length) {
  console.error(`\nABORT — ${problems.length} precondition failure(s). No rows applied (all-or-nothing).`);
  db.close(); process.exit(1);
}
if (!apply) {
  console.log(`\nDRY RUN — ${plan.length} corrections would apply, ${already} already correct. Re-run with --apply to write.`);
  plan.forEach((p) => console.log(`  ${p.domain}: ${p.old} -> ${p.new}`));
  db.close(); process.exit(0);
}

let applied = 0;
try {
  db.exec('BEGIN');
  for (const p of plan) {
    const r = upd.run({ domain: p.domain, old: p.old, new: p.new });
    if (r.changes !== 1) throw new Error(`${p.domain}: expected 1 row changed, got ${r.changes} (concurrent drift) — rolling back all`);
    applied += 1;
  }
  db.exec('COMMIT');
  console.log(`\nAPPLIED ${applied} corrections (+${already} already correct) in one transaction. athletics_domains only; coaches untouched.`);
} catch (e) {
  try { db.exec('ROLLBACK'); } catch { /* nothing to undo */ }
  console.error('\nROLLED BACK ENTIRE APPLY:', e.message);
  db.close(); process.exit(1);
}
db.close();
