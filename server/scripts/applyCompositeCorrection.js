#!/usr/bin/env node
/**
 * PHASE 8D.3C — run an APPROVED composite correction (ordered coach + domain correction stages) in
 * ONE transaction. NON-PRODUCTION databases only. Every rule is in
 * server/lib/refresh/compositeCorrection.js.
 *
 *   node server/scripts/applyCompositeCorrection.js --db <path> --plan <plan.json> --approval <approval.json>              # rehearsal: runs every stage + gate, then ROLLBACK
 *   node server/scripts/applyCompositeCorrection.js --db <path> --plan <plan.json> --approval <approval.json> --apply --manifest-out <m> [--report-out <r>]
 *   node server/scripts/applyCompositeCorrection.js --db <path> --revert <m> [--apply]
 *
 *   --activation-holds <file>  (DI-03B) read activation holds from another file. Only for a DISPOSABLE
 *                              copy: refused for the canonical corpus and for any database under a
 *                              server/data/ directory, where the real holds file is the only one honoured.
 *
 * plan.json: { "stages": [ { "stage_id", "type", "group"?, "fixture": "<path to fixture json>" }, ... ] }
 * Fixture paths resolve relative to the plan file. Fixtures are read as they are; nothing is regenerated.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runCompositeCorrection, revertComposite } from '../lib/refresh/compositeCorrection.js';
import { resolveDbPath } from '../db/corpusIdentity.js';
import { HOLDS_PATH } from '../lib/canonicalCoachEligibility.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const fail = (m, c = 2) => { console.error(m); process.exit(c); };
const dbArg = arg('db'); if (!dbArg) fail('Give --db.');
if (/^\/data\//.test(path.resolve(dbArg))) fail('Refusing production /data path.');
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const holdsArg = arg('activation-holds');
if (holdsArg && (real(dbArg) === real(resolveDbPath()) || /(^|\/)server\/data\//.test(real(dbArg)))) fail('--activation-holds is only for a disposable copy: the canonical database honours server/data/seeds/coach_activation_holds.json alone.');
const activationHoldsFile = holdsArg ? path.resolve(holdsArg) : HOLDS_PATH;
const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'));
const show = (err) => { console.error(`\nREFUSED / ROLLED BACK: ${err.message}`); (err.problems || []).forEach((p) => console.error(`  - ${p}`)); };

if (arg('revert')) {
  const man = readJson(arg('revert'));
  const db = new Database(dbArg, { fileMustExist: true });
  try {
    const r = revertComposite(db, man, { apply });
    console.log(`${apply ? 'REVERTED' : 'REVERT REHEARSED (rolled back)'} — ${r.reverted} row(s); eligible-ID set ${r.eligible_ids_hash.slice(0, 12)} = baseline; identity PASS; integrity ok.`);
  } catch (err) { show(err); db.close(); process.exit(1); }
  db.close(); process.exit(0);
}

const planPath = path.resolve(arg('plan') || fail('Give --plan.'));
const plan = readJson(planPath);
const stages = (plan.stages || []).map((s) => ({ stage_id: s.stage_id, type: s.type, group: s.group, fixture: readJson(path.resolve(path.dirname(planPath), s.fixture)) }));
const approval = readJson(arg('approval') || fail('Give --approval.'));
if (apply && !arg('manifest-out')) fail('--apply needs --manifest-out: an applied correction without its revert manifest is not allowed.');
const db = new Database(dbArg, { fileMustExist: true });
try {
  const r = runCompositeCorrection(db, stages, approval, { apply, activationHoldsFile });
  const rep = r.report;
  console.log(`COMPOSITE CORRECTION ${rep.approval_id} (approval ${rep.approval_hash.slice(0, 12)}) — baseline eligible ${rep.baseline.eligible}`);
  rep.stages.forEach((s) => console.log(`  ${s.stage_id} ${s.type}${s.group ? `/${s.group}` : ''} ${s.fixture_hash.slice(0, 12)}: ${s.applied} action(s), ${s.rows_changed} row(s); eligible ${s.eligibility.before} -> ${s.eligibility.after} (+${s.eligibility.added.length} / -${s.eligibility.removed.length}, as approved)`));
  console.log(`  final eligible ${rep.final.eligible} (${rep.final.eligible_ids_hash.slice(0, 12)}); integrity ok`);
  if (rep.final.activation_holds) console.log(`  activation holds: ${rep.final.activation_holds.newly_eligible} newly eligible, all held (${rep.final.activation_holds.file})`);
  if (arg('report-out')) fs.writeFileSync(path.resolve(arg('report-out')), JSON.stringify(rep, null, 2));
  if (!apply) console.log('\nREHEARSAL — every stage ran and passed inside the transaction, which was ROLLED BACK. Nothing written. Re-run with --apply.');
  else {
    if (arg('manifest-out')) fs.writeFileSync(path.resolve(arg('manifest-out')), JSON.stringify(r.manifest, null, 2));
    console.log(`\nAPPLIED in one transaction — ${r.manifest.manifest.length} change(s).${arg('manifest-out') ? ` Revert: --revert ${arg('manifest-out')} --apply` : ''}`);
  }
} catch (err) { show(err); db.close(); process.exit(1); }
db.close();
