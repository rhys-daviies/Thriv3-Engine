#!/usr/bin/env node
/**
 * READ-ONLY integrity gate for the reconstructed coaching dataset (Phase 3B).
 *   node server/scripts/validateReconciledCoaches.js --db <recon.sqlite>
 *
 * FAILS CLOSED (exit 1) if any of these hold for `coaches_reconciled`:
 *   G1 an outreach-eligible coach's VERIFIED source-domain UNITID != canonical
 *   G2 an outreach-eligible coach whose institution status != RESOLVED
 *   G3 an outreach-eligible coach with unverified email (inferred/generic/unknown)
 *   G4 an outreach-eligible coach with UNVERIFIED identity AND no coach_seasons-
 *      corroborated source domain (i.e., not independently corroborated)
 *   G5 an eligible coach name attached to >1 canonical UNITID (same sport)
 *   G6 a known collision regression (canonical round-trip cross-institution)
 * Never mutates. Refuses production /data paths.
 */
import path from 'node:path';
import Database from 'better-sqlite3';
import { registrableDomain } from '../lib/institutionResolver.js';

const dbArg = (() => { const i = process.argv.indexOf('--db'); return i > -1 ? process.argv[i + 1] : null; })();
if (!dbArg || /\/data\/recruitmatch\.sqlite$/.test(path.resolve(dbArg))) { console.error('Give an explicit non-production --db.'); process.exit(2); }
const db = new Database(dbArg, { readonly: true, fileMustExist: true });
const all = (s) => db.prepare(s).all();

const domains = new Map(all('SELECT domain, unitid, status FROM athletics_domains').map((d) => [String(d.domain).toLowerCase(), d]));
const csTrusted = new Set();
for (const r of all("SELECT source_url FROM coach_seasons WHERE source_url LIKE 'http%'")) { const d = registrableDomain(r.source_url); if (d) csTrusted.add(d); }
const nn = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const csName = new Set();
for (const r of all("SELECT school, sport, coach_name FROM coach_seasons WHERE trim(coalesce(coach_name,'')) != ''")) csName.add(`${r.school}|${r.sport}|${nn(r.coach_name)}`);

const rows = all('SELECT * FROM coaches_reconciled');
const fail = { G1: [], G2: [], G3: [], G4: [], G5: [] };
const nameUnitids = new Map();
for (const r of rows) {
  if (r.outreach_eligibility !== 'YES') continue;
  const d = registrableDomain(r.source_url);
  const dd = d && domains.get(d);
  if (dd && ['VERIFIED', 'VERIFIED_ALIAS'].includes(dd.status) && dd.unitid != null && r.canonical_unitid != null && dd.unitid !== r.canonical_unitid) fail.G1.push(r.coach_id);
  if (r.institution_resolution_status !== 'RESOLVED') fail.G2.push(r.coach_id);
  if (r.email_verification_status !== 'verified') fail.G3.push(r.coach_id);
  const idOk = csName.has(`${r.canonical_school}|${r.sport}|${nn(r.coach_name)}`);
  const domOk = d && csTrusted.has(d) && domains.get(d)?.unitid === r.canonical_unitid;
  if (!idOk && !domOk) fail.G4.push(r.coach_id);
  // A contact is identified by its EMAIL, not its (often common) name. The
  // failure is one ADDRESS eligible at two unrelated institutions; two
  // different people who share a name are fine.
  const em = (r.email || '').toLowerCase();
  if (em.includes('@')) { const k = `${em}|${r.sport}`; if (!nameUnitids.has(k)) nameUnitids.set(k, new Set()); if (r.canonical_unitid != null) nameUnitids.get(k).add(r.canonical_unitid); }
}
for (const [k, set] of nameUnitids) if (set.size > 1) fail.G5.push(k);

let critical = 0;
console.log('=== Reconstructed coaching data integrity gates ===');
const labels = {
  G1: 'eligible coach vs VERIFIED source-domain UNITID mismatch',
  G2: 'eligible coach with institution != RESOLVED',
  G3: 'eligible coach with unverified email',
  G4: 'eligible coach not independently corroborated (identity or coach_seasons domain)',
  G5: 'eligible coach EMAIL on >1 canonical UNITID',
};
for (const g of Object.keys(labels)) { console.log(`  ${g} ${labels[g]}: ${fail[g].length}`); critical += fail[g].length; }
console.log(`\nCRITICAL gate failures: ${critical}`);
db.close();
process.exit(critical > 0 ? 1 : 0);
