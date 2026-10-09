#!/usr/bin/env node
/**
 * Coach eligibility measurements E1–E11 (deployment readiness §4), on a
 * MIGRATED COPY of a database. Read-only, and proved so.
 *
 *   node server/scripts/measureCoachEligibility.js <migrated-copy.sqlite> --scope <STRICT_CORROB_SCOPE> --out result.json
 *   node server/scripts/measureCoachEligibility.js --gate <production.json> <development.json>
 *
 * WHY IT POINTS THE APP AT THE COPY. The measurement uses the existing rule
 * functions unchanged. The canonical engine takes a connection, but the offer
 * (programmeCoaches) and the opt-out checks (suppressions.js) are bound to the
 * app's own connection. So this points the app's connection at the copy, in
 * the client's READ-ONLY MODE (RECRUITMATCH_DB_READONLY=1): the file is opened
 * with SQLITE_OPEN_READONLY and query_only, and no schema.sql or migrate() runs.
 * Nothing in the process can write to it.
 *
 * Belt and braces:
 *   - a copy not already on main's schema is refused, because no migration will run;
 *   - the app's connection must report readonly, or the run stops before measuring;
 *   - the copy's content is fingerprinted before opening, after opening and after
 *     measuring, and its file bytes are hashed. Any difference voids the result (exit 3).
 *
 * Exit codes: 0 measured (or gate passed), 1 gate failed, 2 usage, 3 refused or voided.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
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
  if (!migrated) die(3, `Refusing ${file}: it is not on main's schema. The measurement opens it read-only and runs no migration. Migrate a copy first (rehearsal R2), then measure that.`);
}

const before = fingerprint(file, GUARD);
const voidIfMoved = (stage, fp) => {
  const d = compareFingerprints(before, fp);
  if (!d.same) die(3, `VOID: the copy's content changed ${stage}: ${d.diffs.map((x) => `${x.kind} ${x.table}`).join(', ')}. Nothing is reported.`);
};

const bytes = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const bytesBefore = bytes();

process.env.RECRUITMATCH_DB = file;
process.env.RECRUITMATCH_DB_READONLY = '1';
process.env.STRICT_CORROB_SCOPE = scope;   // the same scope for every rule function, including the offer path
const client = await import('../db/client.js');
const db = client.default;
if (!client.readOnly || !db.readonly || db.pragma('query_only', { simple: true }) !== 1) {
  die(3, 'Refusing to measure: the app\'s database connection is not read-only.');
}
voidIfMoved('when the app opened it', fingerprint(file, GUARD));

const { measureCoachEligibility } = await import('../lib/coachEligibilityMeasurement.js');
const result = measureCoachEligibility({ scope });
db.close();
voidIfMoved('while measuring', fingerprint(file, GUARD));
if (bytes() !== bytesBefore) die(3, 'VOID: the copy\'s file bytes changed. Nothing is reported.');

result.readOnlyProof = {
  connection: 'SQLITE_OPEN_READONLY + query_only; no schema.sql, no migrate()',
  tablesFingerprinted: Object.keys(before.tables).length,
  unchanged: ['after opening', 'after measuring'],
  fileSha256: bytesBefore,
};
result.measuredAt = new Date().toISOString();
const json = `${JSON.stringify(result, null, 2)}\n`;
if (value('out')) fs.writeFileSync(value('out'), json); else process.stdout.write(json);
const t = result.totals;
console.error(`coaches ${t.coaches}, row-eligible ${t.rowEligible}, eligible under main ${t.eligible}; lost ${result.e5.lost} (unexplained ${result.e5.unexplained}); opt-out violations ${result.e8.violations}. Copy unchanged.`);
