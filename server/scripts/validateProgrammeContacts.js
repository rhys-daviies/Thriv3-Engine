#!/usr/bin/env node
/**
 * PROGRAMME CONTACT VALIDATOR — Phase 1B. Read-only. FAILS CLOSED (exit 1) when any
 * VERIFIED programme_contacts row:
 *   V1 fails the programme-contact floor on evidence other than age
 *      (programmeContactEligibility.js: official owned source, owned mail domain, active
 *       canonical programme of the same sport, not a named person's address, no sex conflict,
 *       not a department inbox, not held for another programme)
 *   V2 carries a contact_id that is not the deterministic id of its (entity, sport, email)
 *   V3 shares its address with a coach row of ANY status at another institution
 * A VERIFIED row observed outside the current cycle is reported (ineligible until re-observed)
 * but is not corruption. Exit 2 on usage errors.
 *
 *   node server/scripts/validateProgrammeContacts.js --db <path> [--json] [--now <iso>]
 *
 * Opens the database READ-ONLY with query_only, and deliberately does not import
 * server/db/client.js (whose startup migration would write to the file it measures).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildProgrammeContactContext, programmeContactProblems, programmeContactId, PC_INELIGIBLE } from '../lib/programmeContactEligibility.js';

export function validateProgrammeContacts(db, { now = new Date() } = {}) {
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  if (!has('programme_contacts')) return { status: 'PASS', table: false, rows: 0, verified: 0, eligible: 0, hard: [], not_current: [], by_reason: {} };
  const ctx = buildProgrammeContactContext(db);
  const rows = db.prepare('SELECT * FROM programme_contacts ORDER BY contact_id').all();
  const coachAt = new Map();
  for (const c of db.prepare('SELECT lower(trim(email)) e, school, sport FROM coaches WHERE email IS NOT NULL').all()) (coachAt.get(c.e) || coachAt.set(c.e, []).get(c.e)).push(c);
  const byNameSport = new Map([...ctx.collegeById.values()].map((x) => [`${x.name}|${x.sport}`, x]));
  const hard = []; const notCurrent = []; const byReason = {}; let eligible = 0;
  for (const r of rows.filter((x) => x.status === 'VERIFIED')) {
    const problems = programmeContactProblems(r, ctx, { now });
    for (const p of problems) byReason[p] = (byReason[p] || 0) + 1;
    if (!problems.length) eligible++;
    const rest = problems.filter((p) => p !== PC_INELIGIBLE.NOT_CURRENT);
    if (rest.length) hard.push(`V1 ${r.contact_id}: ${rest.join(',')}`);
    else if (problems.length) notCurrent.push(r.contact_id);
    if (r.contact_id !== programmeContactId(r.athletics_entity_id, r.sport, r.email)) hard.push(`V2 ${r.contact_id}: id is not the deterministic id of its entity/sport/address`);
    const college = ctx.collegeById.get(r.college_id);
    const foreign = (coachAt.get(r.email) || []).filter((c) => byNameSport.get(`${c.school}|${c.sport}`)?.athletics_entity_id !== college?.athletics_entity_id);
    if (foreign.length) hard.push(`V3 ${r.contact_id}: address held by a coach row at another institution`);
  }
  return { status: hard.length ? 'FAIL' : 'PASS', table: true, rows: rows.length, verified: rows.filter((x) => x.status === 'VERIFIED').length, eligible, hard, not_current: notCurrent, by_reason: byReason };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };
  const dbPath = arg('db');
  if (!dbPath) { console.error('usage: validateProgrammeContacts --db <path> [--json] [--now <iso>]'); process.exit(2); }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  let r;
  try { r = validateProgrammeContacts(db, { now: arg('now') ? new Date(arg('now')) : new Date() }); } finally { db.close(); }
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`PROGRAMME CONTACTS ${r.status}: ${r.rows} row(s), ${r.verified} VERIFIED, ${r.eligible} eligible, ${r.not_current.length} not current`);
    for (const [k, n] of Object.entries(r.by_reason)) console.log(`  ${k} ${n}`);
    for (const h of r.hard.slice(0, 50)) console.log(`  HARD ${h}`);
  }
  process.exit(r.status === 'PASS' ? 0 : 1);
}
