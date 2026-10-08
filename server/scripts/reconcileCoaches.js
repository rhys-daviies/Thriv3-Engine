#!/usr/bin/env node
/**
 * Phase 3B coach reconciliation — builds a NON-PRODUCTION `coaches_reconciled`
 * table + CSV from the legacy `coaches`, using the repaired resolver and the
 * corrected identity registry. The original `coaches` table is the untouched
 * baseline; nothing here writes to it.
 *
 *   node server/scripts/reconcileCoaches.js --db <reconstruction.sqlite> [--csv <path>]
 *
 * SAFETY: refuses a production /data path. Reads coaches + coach_seasons +
 * colleges + athletics_domains, writes only `coaches_reconciled`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { reconcileCoachRows } from '../lib/coachReconciler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbArg = (() => { const i = process.argv.indexOf('--db'); return i > -1 ? process.argv[i + 1] : null; })();
/**
 * The CSV carries a name and a working email address for every coach, and this
 * repository is public, so the default lands in the UNTRACKED `server/data/generated/`
 * rather than in the committed evidence directory — which is where it used to go, and
 * is how 6,347 people's addresses came to be in the PR #49 diff. The committed evidence
 * is the redacted pair produced by `server/scripts/redactGeneratedLedgers.js`.
 */
const csvArg = (() => { const i = process.argv.indexOf('--csv'); return i > -1 ? process.argv[i + 1] : path.resolve(__dirname, '../data/generated/coaches_reconciled.csv'); })();
if (!dbArg || /\/data\/recruitmatch\.sqlite$/.test(path.resolve(dbArg))) { console.error('Give an explicit non-production --db.'); process.exit(2); }

const db = new Database(dbArg);
// the rules live in server/lib/coachReconciler.js (one engine, also run in-process by the composite writer)
const rows = reconcileCoachRows(db, { scope: process.env.STRICT_CORROB_SCOPE ?? 'NAIA' });

// write coaches_reconciled table
db.exec('DROP TABLE IF EXISTS coaches_reconciled');
db.exec(`CREATE TABLE coaches_reconciled (
  coach_id TEXT, coach_name TEXT, email TEXT, title TEXT, sport TEXT,
  legacy_school TEXT, legacy_unitid INTEGER, canonical_unitid INTEGER, canonical_school TEXT,
  source_url TEXT, source_domain TEXT, email_domain TEXT,
  classification TEXT, institution_resolution_status TEXT, coach_identity_status TEXT,
  email_verification_status TEXT, outreach_eligibility TEXT, ineligible_reason TEXT,
  resolution_method TEXT, corroboration_method TEXT, evidence TEXT, reassigned INTEGER, canonicalized INTEGER,
  canonical_college_id TEXT, canonical_entity_id TEXT)`);
const cols = Object.keys(rows[0]);
const ins = db.prepare(`INSERT INTO coaches_reconciled (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`);
db.transaction(() => rows.forEach((r) => ins.run(r)))();

// CSV artifact
const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
fs.mkdirSync(path.dirname(csvArg), { recursive: true });
fs.writeFileSync(csvArg, cols.join(',') + '\n' + rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\n') + '\n');

const count = (f) => rows.reduce((n, r) => n + (f(r) ? 1 : 0), 0);
console.log('coaches_reconciled rows:', rows.length, '->', csvArg);
for (const c of ['KEEP', 'REASSIGN', 'WITHHOLD', 'REVIEW']) console.log(`  ${c}: ${count((r) => r.classification === c)}`);
console.log('  outreach_eligible YES:', count((r) => r.outreach_eligibility === 'YES'), '| NO:', count((r) => r.outreach_eligibility === 'NO'));
db.close();
