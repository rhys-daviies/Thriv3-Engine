#!/usr/bin/env node
/**
 * PHASE 8D.3C / DI-03F — run an APPROVED composite correction (ordered coach + domain correction stages)
 * in ONE transaction, or revert one. NON-PRODUCTION databases only: the production /data volume (or any
 * database the engine classifies PRODUCTION) is refused by REAL path before a Database is constructed.
 * Every rule is in server/lib/refresh/compositeCorrection.js.
 *
 *   node server/scripts/applyCompositeCorrection.js --db <path> --plan <plan.json> --approval <signed.json>              # rehearsal: runs every stage + gate, then ROLLBACK
 *   node server/scripts/applyCompositeCorrection.js --db <path> --plan <plan.json> --approval <signed.json> --apply --manifest-out <m> [--report-out <r>]
 *   node server/scripts/applyCompositeCorrection.js --db <path> --revert <m> --approval <signed-revert.json> [--apply]
 *
 * --approval is a SIGNED_CORRECTION_APPROVAL envelope (server/scripts/correctionApproval.js prints the
 * bytes to sign and attaches signatures). The database is classified by the engine itself
 * (server/lib/refresh/correctionTarget.js): PRODUCTION, SHARED_DEV or DISPOSABLE (a copy made with
 * `correctionApproval.js copy`); anything unidentified is refused. No flag changes the classification.
 *
 *   --activation-holds <file>  the activation-holds file of a DISPOSABLE copy. For a SHARED_DEV or
 *                              PRODUCTION database the engine uses the file its application enforces;
 *                              naming another file is refused.
 *   --evidence-dir <dir>       the content-addressed evidence store a DOMAIN_OWNERSHIP_CORRECTION stage
 *                              reads its official sources and page fetches from (files named by sha256).
 *
 * plan.json: { "stages": [ { "stage_id", "type", "group"?, "fixture": "<path to fixture json>" }, ... ] }
 * Fixture paths resolve relative to the plan file. Fixtures are read as they are; nothing is regenerated.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runCompositeCorrection, revertComposite } from '../lib/refresh/compositeCorrection.js';
import { runtimeSignals } from '../lib/refresh/correctionTarget.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const fail = (m, c = 2) => { console.error(m); process.exit(c); };
const dbArg = arg('db'); if (!dbArg) fail('Give --db.');
// Refuse the production /data volume — and anything else correctionTarget identifies as PRODUCTION (a production
// process, the same inode as the production file) — by REAL path, so a symlink, `..` or case variant cannot hide it
// (DI-03E MAJOR-1: the old string test on the given path was bypassed through a symlink).
const realDb = (() => { try { return fs.realpathSync.native(path.resolve(dbArg)); } catch { return path.resolve(dbArg); } })();
const prod = runtimeSignals(realDb).filter((x) => x.class === 'PRODUCTION');
if (prod.length) fail(`Refusing production database ${realDb}: ${prod.map((x) => x.why).join('; ')}. This tool never corrects production (Render: /data/recruitmatch.sqlite).`);
const activationHoldsFile = arg('activation-holds') ? path.resolve(arg('activation-holds')) : null;
const evidenceDir = arg('evidence-dir') ? path.resolve(arg('evidence-dir')) : null;
const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'));
const show = (err) => { console.error(`\nREFUSED / ROLLED BACK: ${err.message}`); (err.problems || []).forEach((p) => console.error(`  - ${p}`)); };

if (arg('revert')) {
  const man = readJson(arg('revert'));
  const approval = readJson(arg('approval') || fail('Give --approval (a signed COMPOSITE_REVERT_APPROVAL).'));
  const db = new Database(dbArg, { fileMustExist: true });
  try {
    const r = revertComposite(db, man, approval, { apply, activationHoldsFile });
    console.log(`${apply ? 'REVERTED' : 'REVERT REHEARSED (rolled back)'} — ${r.reverted} row(s); eligible-ID set ${r.eligible_ids_hash.slice(0, 12)} = baseline; identity PASS; integrity ok; ledger ${r.ledger_id}.`);
    console.log(`  sendable coaches ${r.sendability.coaches_open_before} -> ${r.sendability.coaches_open_after}: ${r.sendability.newly_sendable_coaches.length} newly sendable (approved, held); ${r.sendability.no_longer_sendable_coaches.length} no longer sendable (approved); inboxes ${r.sendability.contacts_open_before} -> ${r.sendability.contacts_open_after}`);
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
  const r = runCompositeCorrection(db, stages, approval, { apply, activationHoldsFile, evidenceDir });
  const rep = r.report;
  console.log(`COMPOSITE CORRECTION ${rep.approval_id} (approval ${rep.approval_body_hash.slice(0, 12)}, signed by ${rep.signers.map((x) => `${x.reviewer_id} ${x.fingerprint}`).join(', ')}; ledger ${rep.ledger_id}) — baseline eligible ${rep.baseline.eligible}`);
  rep.stages.forEach((s) => console.log(`  ${s.stage_id} ${s.type}${s.group ? `/${s.group}` : ''} ${s.fixture_hash.slice(0, 12)}: ${s.applied} action(s), ${s.rows_changed} row(s); eligible ${s.eligibility.before} -> ${s.eligibility.after} (+${s.eligibility.added.length} / -${s.eligibility.removed.length}, as approved)`));
  console.log(`  final eligible ${rep.final.eligible} (${rep.final.eligible_ids_hash.slice(0, 12)}); integrity ok`);
  const sb = rep.final.sendability;
  console.log(`  target ${rep.target.class} ${rep.target.identity} (${rep.target.why.join('; ')}); activation holds ${rep.target.activation_holds_sha256.slice(0, 12)} (${rep.target.activation_holds} holds, ${rep.target.activation_holds_file})`);
  console.log(`  sendable coaches ${sb.coaches_open_before} -> ${sb.coaches_open_after}: ${sb.newly_sendable_coaches.length} newly sendable, all approved and held; ${sb.no_longer_sendable_coaches.length} no longer sendable; inboxes ${sb.contacts_open_before} -> ${sb.contacts_open_after}`);
  if (arg('report-out')) fs.writeFileSync(path.resolve(arg('report-out')), JSON.stringify(rep, null, 2));
  if (!apply) console.log('\nREHEARSAL — every stage ran and passed inside the transaction, which was ROLLED BACK. Nothing written. Re-run with --apply.');
  else {
    if (arg('manifest-out')) fs.writeFileSync(path.resolve(arg('manifest-out')), JSON.stringify(r.manifest, null, 2));
    console.log(`\nAPPLIED in one transaction — ${r.manifest.manifest.length} change(s); ledger ${r.manifest.ledger_id}, manifest sha256 ${r.manifest_sha256}.${arg('manifest-out') ? ` Revert: --revert ${arg('manifest-out')} --approval <signed revert approval> --apply` : ''}`);
  }
} catch (err) { show(err); db.close(); process.exit(1); }
db.close();
