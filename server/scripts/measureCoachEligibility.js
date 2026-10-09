#!/usr/bin/env node
/**
 * Coach eligibility measurements E1–E11 (deployment readiness §4), on a
 * MIGRATED COPY of a database. Read-only, and proved so.
 *
 *   node server/scripts/measureCoachEligibility.js <migrated-copy.sqlite> --scope <STRICT_CORROB_SCOPE> --out result.json
 *   node server/scripts/measureCoachEligibility.js --gate <production.json> <development.json>
 *
 * WHY IT POINTS THE APP AT THE COPY. The measurement uses the existing rule
 * functions unchanged, and they read the app's own database handle. So this
 * sets RECRUITMATCH_DB to the copy before importing them. Importing the app
 * runs schema.sql and migrate(), so:
 *   - it refuses a copy that is not already on main's schema (rehearsal R2
 *     migrates it first; migrating is not this tool's job);
 *   - it fingerprints the copy's content before opening it, after opening it,
 *     and after measuring. Any difference voids the result (exit 3);
 *   - the app's connection is switched to query_only before measuring.
 *
 * Exit codes: 0 measured (or gate passed), 1 gate failed, 2 usage, 3 refused or voided.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { assertNotLiveDatabase, fingerprint, compareFingerprints } from '../lib/dbFingerprint.js';
import { defaultDbPath } from '../db/corpusIdentity.js';
import { evaluateGate } from '../lib/eligibilityGate.js';

const args = process.argv.slice(2);
const value = (n) => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1] ?? null; };
const die = (code, msg) => { console.error(msg); process.exit(code); };

if (args.includes('--gate')) {
  const i = args.indexOf('--gate');
  const [pf, df] = [args[i + 1], args[i + 2]];
  if (!pf || !df) die(2, 'Usage: --gate <production.json> <development.json>');
  const r = evaluateGate(JSON.parse(fs.readFileSync(pf, 'utf8')), JSON.parse(fs.readFileSync(df, 'utf8')));
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.pass ? 0 : 1);
}

const copy = args.find((a) => !a.startsWith('--') && a !== value('scope') && a !== value('out'));
const scope = value('scope');
if (!copy || !scope) die(2, 'Usage: measureCoachEligibility.js <migrated-copy.sqlite> --scope <STRICT_CORROB_SCOPE> [--out result.json]');

/** Refusals, all before the app is imported. The guard keeps judging against the environment as it was given. */
const file = path.resolve(copy);
const GUARD = { env: { ...process.env }, working: defaultDbPath };
try {
  assertNotLiveDatabase(file, GUARD);
} catch (e) { die(3, e.message); }
{
  const probe = new Database(file, { readonly: true, fileMustExist: true });
  const hasCol = (t, c) => !!probe.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(t, c);
  const migrated = hasCol('outreach', 'programme_contact_id') && hasCol('outreach_send', 'programme_contact_id')
    && !!probe.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'representatives'").get();
  probe.close();
  if (!migrated) die(3, `Refusing ${file}: it is not on main's schema. Opening it through the app would migrate it. Migrate a copy first (rehearsal R2), then measure that.`);
}

const before = fingerprint(file, GUARD);
const voidIfMoved = (stage, fp) => {
  const d = compareFingerprints(before, fp);
  if (!d.same) die(3, `VOID: the copy's content changed ${stage}: ${d.diffs.map((x) => `${x.kind} ${x.table}`).join(', ')}. Nothing is reported.`);
};

process.env.RECRUITMATCH_DB = file;
process.env.STRICT_CORROB_SCOPE = scope;   // the same scope for every rule function, including the offer path
const { default: db } = await import('../db/client.js');
voidIfMoved('when the app opened it', fingerprint(file, GUARD));
db.pragma('query_only = ON');

const { measureCoachEligibility } = await import('../lib/coachEligibilityMeasurement.js');
const result = measureCoachEligibility({ scope });
db.close();
voidIfMoved('while measuring', fingerprint(file, GUARD));

result.readOnlyProof = { tablesFingerprinted: Object.keys(before.tables).length, unchanged: ['after opening', 'after measuring'] };
result.measuredAt = new Date().toISOString();
const json = `${JSON.stringify(result, null, 2)}\n`;
if (value('out')) fs.writeFileSync(value('out'), json); else process.stdout.write(json);
const t = result.totals;
console.error(`coaches ${t.coaches}, row-eligible ${t.rowEligible}, eligible under main ${t.eligible}; lost ${result.e5.lost} (unexplained ${result.e5.unexplained}); opt-out violations ${result.e8.violations}. Copy unchanged.`);
