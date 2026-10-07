#!/usr/bin/env node
/**
 * PHASE 8C.5D — apply an APPROVED protected source correction (reversal of a decided
 * athletics_domains ownership row). NON-PRODUCTION databases only. See
 * server/lib/refresh/protectedCorrection.js for every rule this enforces.
 *
 *   node server/scripts/applyProtectedSourceCorrection.js --db <path> --fixture <f> --fixture-hash <sha>            # dry run
 *   node server/scripts/applyProtectedSourceCorrection.js --db <path> --fixture <f> --fixture-hash <sha> --apply --manifest-out <m>
 *   node server/scripts/applyProtectedSourceCorrection.js --db <path> --revert <m> [--apply]
 *
 * Postconditions inside the transaction: identity validator PASS, ownership postcheck (true owner
 * only, refuted claimants own nothing, 0 disagreements), integrity_check ok — else ROLLBACK.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { applyProtectedCorrections, fixtureHash, ownershipPostcheck } from '../lib/refresh/protectedCorrection.js';
import { revertManifest } from '../lib/refresh/promotion.js';
import { validateEntityIdentity } from './validateAthleticsEntityIdentity.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const fail = (m, c = 2) => { console.error(m); process.exit(c); };
const dbArg = arg('db'); if (!dbArg) fail('Give --db.');
if (/^\/data\//.test(path.resolve(dbArg))) fail('Refusing production /data path.');

if (arg('revert')) {
  const man = JSON.parse(fs.readFileSync(path.resolve(arg('revert')), 'utf8'));
  if (man.phase !== 'PROTECTED_SOURCE_CORRECTION') fail('not a protected-correction manifest');
  const db = new Database(dbArg, { fileMustExist: true });
  console.log(`REVERT protected correction ${String(man.fixture_hash).slice(0, 12)}: ${man.manifest.length} action(s)`);
  if (!apply) { db.close(); console.log('DRY RUN — add --apply.'); process.exit(0); }
  const r = revertManifest(db, man.manifest); db.close(); console.log(`REVERTED ${r.reverted} write(s).`); process.exit(0);
}

const fx = JSON.parse(fs.readFileSync(path.resolve(arg('fixture') || fail('Give --fixture.')), 'utf8'));
const got = fixtureHash(fx);
if (got !== fx.fixture_hash || got !== arg('fixture-hash')) fail(`fixture hash mismatch (computed ${got.slice(0, 12)})`, 1);
const db = new Database(dbArg, { fileMustExist: true });
const postcheck = (d, plan) => {
  const v = validateEntityIdentity(d);
  if (v.status !== 'PASS') throw Object.assign(new Error('identity invariant FAIL'), { problems: v.hard.slice(0, 20) });
  ownershipPostcheck(d, plan);
};
try {
  const r = applyProtectedCorrections(db, fx, { apply, postcheck });
  console.log(`PROTECTED SOURCE CORRECTION (fixture ${got.slice(0, 12)}) — ${r.before.length} action(s)`);
  r.before.forEach((b, i) => { const a = r.after[i]; console.log(`  ${b.domain}: ${b.status}/${b.athletics_entity_id ?? '-'}/${b.ownership_class ?? '-'} -> ${a.status}/${a.athletics_entity_id}/${a.ownership_class}; unitid ${b.unitid} kept; wrong_mappings kept ${b.wrong_mappings}`); });
  if (!apply) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); }
  else {
    if (arg('manifest-out')) fs.writeFileSync(path.resolve(arg('manifest-out')), JSON.stringify(r.manifest, null, 2));
    console.log(`\nAPPLIED — ${r.applied} correction(s); identity PASS; ownership postcheck PASS; integrity ok.`);
  }
} catch (err) {
  console.error(`\nREFUSED / ROLLED BACK: ${err.message}`); (err.problems || []).forEach((p) => console.error(`  - ${p}`));
  db.close(); process.exit(1);
}
db.close();
