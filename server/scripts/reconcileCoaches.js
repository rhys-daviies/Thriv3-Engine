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
import { createResolver, registrableDomain, emailDomain, DECISION } from '../lib/institutionResolver.js';
import { normalizeForMatch } from '../lib/coachingImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbArg = (() => { const i = process.argv.indexOf('--db'); return i > -1 ? process.argv[i + 1] : null; })();
const csvArg = (() => { const i = process.argv.indexOf('--csv'); return i > -1 ? process.argv[i + 1] : path.resolve(__dirname, '../../docs/validation/generated/coaches_reconciled.csv'); })();
if (!dbArg || /\/data\/recruitmatch\.sqlite$/.test(path.resolve(dbArg))) { console.error('Give an explicit non-production --db.'); process.exit(2); }

const db = new Database(dbArg);
const all = (s) => db.prepare(s).all();
const colleges = all('SELECT name, sport, unitid, state, division FROM colleges');
const domains = all('SELECT domain, unitid, status FROM athletics_domains');
const aliases = all('SELECT alias_key, unitid, alias_type FROM institution_aliases');
const coaches = all('SELECT id, full_name, email, school, sport, position_title, email_status, email_source_url FROM coaches');

// duplicate-UNITID canonical map (identity canonicalisation, no physical merge)
const dupMap = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/validation/generated/duplicate_unitid_canonical_map.json'), 'utf8'));
const canonByDupName = new Map(dupMap.map((d) => [`${d.duplicate_name}|${d.sport}`, d.canonical_name]));
const collByNS = new Map(colleges.map((c) => [`${c.name}|${c.sport}`, c]));
const canonName = (name, sport) => canonByDupName.get(`${name}|${sport}`) || name;

// coach_seasons identity corroboration: (school,sport) -> Set(normname)
const nn = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const csBySchool = new Map();
for (const r of all("SELECT school, sport, coach_name FROM coach_seasons WHERE trim(coalesce(coach_name,'')) != ''")) {
  const k = `${r.school}|${r.sport}`; if (!csBySchool.has(k)) csBySchool.set(k, new Set()); csBySchool.get(k).add(nn(r.coach_name));
}
// Domains INDEPENDENTLY scraped by coach_seasons (from each school's own site).
// This is the only registry-corruption-immune trust signal: athletics_domains
// is systematically wrong for ambiguous names (e.g. every "Columbia" email/site
// domain -> Columbia University 190150), so a REASSIGN or KEEP is only trusted
// for OUTREACH when coach_seasons corroborates it — by coach identity, or by a
// source domain coach_seasons actually scraped.
const csTrustedDomains = new Set();
for (const r of all("SELECT source_url FROM coach_seasons WHERE source_url LIKE 'http%'")) {
  const d = registrableDomain(r.source_url); if (d) csTrustedDomains.add(d);
}
const csHas = (school, sport, name) => csBySchool.get(`${school}|${sport}`)?.has(nn(name)) || false;
const domByName = new Map(domains.map((d) => [String(d.domain).toLowerCase(), d]));
const resolver = createResolver({ colleges, domains, aliases });
const uni = (name, sport) => collByNS.get(`${name}|${sport}`)?.unitid ?? null;
const nameByUnitid = new Map();
for (const c of colleges) if (c.unitid != null) nameByUnitid.set(`${c.unitid}|${c.sport}`, canonName(c.name, c.sport));

function reconcile(co) {
  const curUnitid = uni(co.school, co.sport);
  const sdom = registrableDomain(co.email_source_url);
  const edom = emailDomain(co.email);
  // authoritative institution evidence: source-url domain first
  let evUnitid = null, method = null, evNote = '';
  if (sdom && domByName.has(sdom)) {
    const d = domByName.get(sdom);
    if (['VERIFIED', 'VERIFIED_ALIAS'].includes(d.status) && d.unitid != null) { evUnitid = d.unitid; method = 'SOURCE_DOMAIN'; evNote = `${sdom}→${d.unitid}`; }
    else if (['WRONG_INSTITUTION', 'AMBIGUOUS'].includes(d.status)) { method = `DOMAIN_${d.status}`; evNote = `${sdom} ${d.status}`; }
  }
  if (evUnitid == null && !method && edom && domByName.has(edom)) {
    const d = domByName.get(edom);
    if (['VERIFIED', 'VERIFIED_ALIAS'].includes(d.status) && d.unitid != null) { evUnitid = d.unitid; method = 'EMAIL_DOMAIN'; evNote = `${edom}→${d.unitid} (email)`; }
  }
  const idAtCurrent = csHas(co.school, co.sport, co.full_name);
  const idAtEvidence = evUnitid != null && csHas(nameByUnitid.get(`${evUnitid}|${co.sport}`), co.sport, co.full_name);

  let cls, inst; // classification + institution_resolution_status
  if (evUnitid != null) {
    if (curUnitid != null && evUnitid === curUnitid) { cls = 'KEEP'; inst = DECISION.RESOLVED; }
    else { cls = 'REASSIGN'; inst = DECISION.RESOLVED; }
  } else if (method === 'DOMAIN_WRONG_INSTITUTION' || method === 'DOMAIN_AMBIGUOUS') {
    cls = 'REVIEW'; inst = DECISION.REVIEW;
  } else if (idAtCurrent) { // no domain evidence but identity corroborated by independent coach_seasons
    cls = 'KEEP'; inst = DECISION.RESOLVED; method = 'COACH_SEASONS'; evNote = 'identity corroborated at current school';
    evUnitid = curUnitid;
  } else {
    cls = 'WITHHOLD'; inst = DECISION.WITHHOLD; method = method || 'NONE';
  }

  // For REVIEW cases where the source domain affirmatively points AWAY from the
  // current school (WRONG_INSTITUTION/AMBIGUOUS) we do not claim the legacy
  // institution — the canonical is unknown pending review.
  const domainSaysElsewhere = method === 'DOMAIN_WRONG_INSTITUTION' || method === 'DOMAIN_AMBIGUOUS';
  const resolvedUnitid = evUnitid ?? (domainSaysElsewhere ? null : curUnitid);
  const resolvedName = resolvedUnitid != null ? (nameByUnitid.get(`${resolvedUnitid}|${co.sport}`) || co.school) : null;
  const identityStatus = (evUnitid != null && (idAtEvidence || idAtCurrent)) || idAtCurrent ? 'VERIFIED' : 'UNVERIFIED';
  const emailStatus = (co.email_status || 'unknown');
  const hasRealEmail = co.email && co.email.includes('@') && co.email.toUpperCase() !== 'N/A';
  const isTeam = !co.full_name || !co.full_name.trim();

  // OUTREACH ELIGIBILITY — conservative and registry-corruption-immune.
  // Requires: institution RESOLVED to a canonical UNITID, email meets the
  // approved 'verified' standard, a real per-person address, actionable class,
  // AND the institution is corroborated by the INDEPENDENT coach_seasons scrape
  // (coach identity at the resolved school, or a source domain coach_seasons
  // itself scraped that resolves to the same UNITID). This is what blocks the
  // Columbia-College->Columbia-University false positive: columbiacougars.com is
  // a wrong VERIFIED_ALIAS never seen in coach_seasons, so it cannot make a
  // coach eligible. Inferred/generic emails are never upgraded.
  const sourceDomainTrusted = sdom && csTrustedDomains.has(sdom)
    && ['VERIFIED', 'VERIFIED_ALIAS'].includes(domByName.get(sdom)?.status)
    && domByName.get(sdom)?.unitid === resolvedUnitid;
  const corroborated = idAtEvidence || idAtCurrent || sourceDomainTrusted;
  const eligible = inst === DECISION.RESOLVED && emailStatus === 'verified' && hasRealEmail && !isTeam
    && ['KEEP', 'REASSIGN'].includes(cls) && corroborated;
  let ineligibleReason = '';
  if (!eligible) {
    if (!hasRealEmail || isTeam) ineligibleReason = 'no per-person address';
    else if (emailStatus !== 'verified') ineligibleReason = `email ${emailStatus}`;
    else if (inst !== DECISION.RESOLVED) ineligibleReason = `institution ${inst}`;
    else if (!corroborated) ineligibleReason = `${cls} not corroborated by coach_seasons`;
    else ineligibleReason = cls;
  }

  return {
    coach_id: co.id, coach_name: co.full_name, email: co.email, title: co.position_title, sport: co.sport,
    legacy_school: co.school, legacy_unitid: curUnitid,
    canonical_unitid: resolvedUnitid, canonical_school: resolvedName,
    source_url: co.email_source_url, source_domain: sdom, email_domain: edom,
    classification: cls, institution_resolution_status: inst,
    coach_identity_status: identityStatus, email_verification_status: emailStatus,
    outreach_eligibility: eligible ? 'YES' : 'NO', ineligible_reason: ineligibleReason,
    resolution_method: method || 'NONE', evidence: evNote,
    reassigned: cls === 'REASSIGN' ? 1 : 0,
    canonicalized: resolvedName && resolvedName !== co.school ? 1 : 0,
  };
}

const rows = coaches.map(reconcile);

// write coaches_reconciled table
db.exec('DROP TABLE IF EXISTS coaches_reconciled');
db.exec(`CREATE TABLE coaches_reconciled (
  coach_id TEXT, coach_name TEXT, email TEXT, title TEXT, sport TEXT,
  legacy_school TEXT, legacy_unitid INTEGER, canonical_unitid INTEGER, canonical_school TEXT,
  source_url TEXT, source_domain TEXT, email_domain TEXT,
  classification TEXT, institution_resolution_status TEXT, coach_identity_status TEXT,
  email_verification_status TEXT, outreach_eligibility TEXT, ineligible_reason TEXT,
  resolution_method TEXT, evidence TEXT, reassigned INTEGER, canonicalized INTEGER)`);
const cols = Object.keys(rows[0]);
const ins = db.prepare(`INSERT INTO coaches_reconciled (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`);
db.transaction(() => rows.forEach((r) => ins.run(r)))();

// CSV artifact
const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
fs.writeFileSync(csvArg, cols.join(',') + '\n' + rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\n') + '\n');

const count = (f) => rows.reduce((n, r) => n + (f(r) ? 1 : 0), 0);
console.log('coaches_reconciled rows:', rows.length, '->', csvArg);
for (const c of ['KEEP', 'REASSIGN', 'WITHHOLD', 'REVIEW']) console.log(`  ${c}: ${count((r) => r.classification === c)}`);
console.log('  outreach_eligible YES:', count((r) => r.outreach_eligibility === 'YES'), '| NO:', count((r) => r.outreach_eligibility === 'NO'));
db.close();
