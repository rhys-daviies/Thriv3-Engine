#!/usr/bin/env node
/**
 * PHASE 1G-PRE — build the WRONG_INSTITUTION repair fixture (rule R1-R5,
 * server/lib/refresh/wrongInstitutionRepair.js). READ-ONLY on the database: it never writes and
 * opens the file with query_only. The fixture it emits is applied (or rehearsed) only by
 * server/scripts/applyProtectedSourceCorrection.js.
 *
 *   node server/scripts/buildWrongInstitutionRepair.js --db <path> \
 *     --registry docs/validation/integrity-audit/phase1gpre_registry_slice.json \
 *     --evidence docs/validation/integrity-audit/phase1gpre_link_evidence.json \
 *     --approval docs/validation/integrity-audit/phase1gpre_approval.json \
 *     [--out <fixture.json>] [--created-at <iso>] [--json]
 *
 * Deterministic: the same database and inputs give the same fixture hash.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildRepairFixture } from '../lib/refresh/wrongInstitutionRepair.js';

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };
const read = (p) => JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const need = ['db', 'registry', 'evidence', 'approval'].filter((k) => !arg(k));
  if (need.length) { console.error(`missing --${need.join(', --')}`); process.exit(2); }
  const db = new Database(arg('db'), { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  let out;
  try {
    out = buildRepairFixture(db, { registry: read(arg('registry')).rows, evidence: read(arg('evidence')), approval: read(arg('approval')), createdAt: arg('created-at') || '2026-10-08T00:00:00Z' });
  } finally { db.close(); }
  const { fixture, assessments } = out;
  if (arg('out')) fs.writeFileSync(path.resolve(arg('out')), `${JSON.stringify(fixture, null, 1)}\n`);
  if (argv.includes('--json')) console.log(JSON.stringify({ fixture_hash: fixture.fixture_hash, corrections: fixture.corrections.length, excluded: fixture.excluded }, null, 1));
  else {
    console.log(`WRONG_INSTITUTION rows ${assessments.length}: ${fixture.corrections.length} pass R1-R5, ${fixture.excluded.length} kept unchanged. fixture ${fixture.fixture_hash}`);
    for (const e of fixture.excluded) console.log(`  KEEP ${e.host}: ${e.failures.join(' ; ')}`);
  }
}
