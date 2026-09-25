#!/usr/bin/env node
/**
 * READ-ONLY institution-integrity validator — a permanent guardrail.
 *
 *   npm run validate:institution-integrity            (default DB, read-only)
 *   node server/scripts/validateInstitutionIntegrity.js --db <path>
 *
 * Opens the SQLite database in READ-ONLY mode (never through the migrating
 * db/client) and reports the institution-identity invariants established in
 * Phase 2/3A. Exits NON-ZERO on any CRITICAL failure. Mutates nothing.
 *
 * CRITICAL failures (exit 1):
 *   - any canonical institution that resolves to a DIFFERENT institution
 *   - any coach whose VERIFIED source domain points at a different UNITID than
 *     the institution it is filed under
 *   - any VERIFIED/VERIFIED_ALIAS domain whose UNITID DISAGREES with its own
 *     single, unambiguous claimed UNITID. This flags a domain-ownership
 *     disagreement to VERIFY EXTERNALLY — it does NOT assert the claim is right
 *     (Phase 2C proved the fix goes either way: uconn.edu's unitid was the
 *     error, pct.edu's claim was the error). Detection, not correction.
 * WARNINGS (exit 0, reported):
 *   - ambiguous normalized names, duplicate UNITIDs, conflicting aliases,
 *     domain→UNITID conflicts, registry gaps, multi-domain coach groups.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createResolver, registrableDomain, DECISION } from '../lib/institutionResolver.js';
import { normalizeForMatch } from '../lib/coachingImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argDb = (() => { const i = process.argv.indexOf('--db'); return i > -1 ? process.argv[i + 1] : null; })();
const dbPath = argDb || process.env.VALIDATE_DB || process.env.RECRUITMATCH_DB || path.resolve(__dirname, '../data/recruitmatch.sqlite');

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const all = (sql) => db.prepare(sql).all();

const colleges = all('SELECT name, sport, unitid, state, division FROM colleges');
const domains = all('SELECT domain, unitid, status, claimed_unitids FROM athletics_domains');
const aliases = all('SELECT alias_key, unitid, alias_type FROM institution_aliases');
const coaches = all("SELECT id, full_name, school, sport, email_source_url FROM coaches");

const resolver = createResolver({ colleges, domains, aliases });

let critical = 0; const warnings = [];
const section = (t) => console.log(`\n=== ${t} ===`);

// 1) Canonical round-trip — the load-bearing invariant, per sport
section('Canonical institution round-trip (per sport)');
const sports = [...new Set(colleges.map((c) => c.sport))];
let rtCross = 0;
for (const sport of sports) {
  const rows = colleges.filter((c) => c.sport === sport);
  let self = 0, review = 0, withhold = 0, cross = 0; const bad = [];
  for (const c of rows) {
    const r = resolver.resolve(c.name, { sport, state: c.state });
    if (r.decision === DECISION.RESOLVED) {
      if (r.unitid === c.unitid) self++;
      else { cross++; if (bad.length < 10) bad.push(`${c.name} (${c.unitid}) -> ${r.canonicalSchool} (${r.unitid})`); }
    } else if (r.decision === DECISION.REVIEW) review++;
    else withhold++;
  }
  rtCross += cross;
  console.log(`  ${sport}: tested ${rows.length} | self ${self} | review ${review} | withhold ${withhold} | CROSS-INSTITUTION ${cross}`);
  bad.forEach((b) => console.log('    CROSS:', b));
}
if (rtCross > 0) { critical += rtCross; console.log(`  CRITICAL: ${rtCross} cross-institution round-trips`); }

// 2) Coach source-domain vs assigned institution (VERIFIED domains only)
section('Coach source-domain vs assigned institution (VERIFIED domains)');
const domByName = new Map(domains.map((d) => [String(d.domain).toLowerCase(), d]));
const collByNS = new Map(colleges.map((c) => [`${c.name}|${c.sport}`, c]));
let coachConflict = 0; const cc = [];
for (const co of coaches) {
  const d = registrableDomain(co.email_source_url);
  if (!d) continue;
  const dd = domByName.get(d);
  if (!dd || !['VERIFIED', 'VERIFIED_ALIAS'].includes(dd.status) || dd.unitid == null) continue;
  const cur = collByNS.get(`${co.school}|${co.sport}`);
  if (cur && cur.unitid != null && cur.unitid !== dd.unitid) {
    coachConflict++; if (cc.length < 10) cc.push(`${co.full_name} @ ${co.school} — source ${d}→${dd.unitid}, filed under ${cur.unitid}`);
  }
}
console.log(`  coaches whose VERIFIED source domain != assigned institution: ${coachConflict}`);
cc.forEach((x) => console.log('    CONFLICT:', x));
if (coachConflict > 0) critical += coachConflict;

// 3) VERIFIED domain UNITID vs its own single unambiguous claimed UNITID.
// A VERIFIED/VERIFIED_ALIAS domain is trusted by the resolver at 0.99 confidence
// using its `unitid`. When that UNITID differs from the domain's own single
// claimed value, the two internal signals DISAGREE — but which one is right is
// NOT decided here. Phase 2C proved the fix is EITHER direction: usually the
// host `unitid` is a page-match error and the claim is right (uconn.edu), but
// sometimes the claim is a bad mapping and the `unitid` is right (pct.edu is
// Penn College of Technology, not UPenn). So this is a "VERIFY DOMAIN
// OWNERSHIP" flag, NOT "replace the unitid with the claim". Detection only.
// Multi-claim domains (e.g. rutgers.edu: Camden+Newark) are a genuine
// multi-institution/ambiguous signal, reported as a warning not a CRITICAL.
section('VERIFIED domain UNITID vs single claimed evidence (ownership disagreement — verify externally)');
let domClaimMismatch = 0; const dcm = []; let domClaimAmbiguous = 0;
for (const d of domains) {
  if (!['VERIFIED', 'VERIFIED_ALIAS'].includes(d.status) || d.unitid == null) continue;
  let claimed = [];
  try { claimed = JSON.parse(d.claimed_unitids || '[]').map(Number).filter((n) => !Number.isNaN(n)); } catch { /* malformed */ }
  const uniq = [...new Set(claimed)];
  if (uniq.length === 1 && uniq[0] !== Number(d.unitid)) {
    domClaimMismatch++; if (dcm.length < 15) dcm.push(`${d.domain}: stamped ${d.unitid}, single claim ${uniq[0]}`);
  } else if (uniq.length > 1 && !uniq.includes(Number(d.unitid))) {
    domClaimAmbiguous++;
  }
}
console.log(`  VERIFIED domains whose UNITID disagrees with a single unambiguous claim: ${domClaimMismatch}`);
dcm.forEach((x) => console.log('    VERIFY-OWNERSHIP:', x));
if (domClaimAmbiguous) console.log(`  (ambiguous multi-claim mismatches, reported as warning not critical: ${domClaimAmbiguous})`);
if (domClaimMismatch > 0) critical += domClaimMismatch;

// 4) Warnings: ambiguous normalized names
section('Warnings');
warnings.push(`ambiguous multi-claim VERIFIED domain UNITIDs (need human disambiguation): ${domClaimAmbiguous}`);
const normGroups = new Map();
for (const c of colleges) { const k = `${c.sport}|${normalizeForMatch(c.name)}`; (normGroups.get(k) || normGroups.set(k, new Set()).get(k)).add(c.unitid); }
const ambigNames = [...normGroups.entries()].filter(([, u]) => u.size > 1);
warnings.push(`ambiguous normalized names (same key, >1 UNITID): ${ambigNames.length}`);

// duplicate UNITIDs (same unitid+sport, >1 name)
const uniGroups = new Map();
for (const c of colleges) { if (c.unitid == null) continue; const k = `${c.unitid}|${c.sport}`; (uniGroups.get(k) || uniGroups.set(k, new Set()).get(k)).add(c.name); }
const dupUnitids = [...uniGroups.entries()].filter(([, n]) => n.size > 1);
warnings.push(`duplicate UNITIDs (same UNITID+sport, >1 name): ${dupUnitids.length}`);

// conflicting aliases (one alias_key -> >1 unitid)
const aliasGroups = new Map();
for (const a of aliases) { if (a.unitid == null) continue; (aliasGroups.get(a.alias_key) || aliasGroups.set(a.alias_key, new Set()).get(a.alias_key)).add(a.unitid); }
const conflictAliases = [...aliasGroups.entries()].filter(([, u]) => u.size > 1);
warnings.push(`conflicting aliases (alias_key -> >1 UNITID): ${conflictAliases.length}`);

// registry gaps + explicit bad statuses
const gap = domains.filter((d) => d.unitid == null).length;
warnings.push(`athletics_domains without UNITID (gaps): ${gap}`);
for (const st of ['WRONG_INSTITUTION', 'AMBIGUOUS', 'INSUFFICIENT_EVIDENCE']) {
  warnings.push(`athletics_domains status=${st}: ${domains.filter((d) => d.status === st).length}`);
}

// multi-domain coach groups (merged-institution signature)
const grp = new Map();
for (const co of coaches) { const d = registrableDomain(co.email_source_url); if (!d) continue; const k = `${co.school}|${co.sport}`; (grp.get(k) || grp.set(k, new Set()).get(k)).add(d); }
warnings.push(`coach groups with >1 source domain: ${[...grp.values()].filter((s) => s.size > 1).length}`);

warnings.forEach((w) => console.log('  -', w));

section('Result');
console.log(`CRITICAL failures: ${critical}`);
db.close();
process.exit(critical > 0 ? 1 : 0);
