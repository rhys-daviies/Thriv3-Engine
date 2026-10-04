#!/usr/bin/env node
/**
 * PHASE 7E — structural cleanup + temporal cut-over (NON-PRODUCTION only).
 *
 *   node server/scripts/applyPhase7EStructural.js --db <path> --fixture <f> --fixture-hash <sha> [--apply] [--manifest-out <f>]
 *   node server/scripts/applyPhase7EStructural.js --db <path> --revert <manifest> [--apply]
 *
 * One reviewed fixture, one transaction:
 *   0 schema    the Phase 7E tables (DDL read from schema.sql) + refresh-integrity columns
 *   1 entities  new athletics entities (NCES-evidenced); notes on superseded ones
 *   2 repairs   colleges field changes, each behind an expected-old guard, with identity_notes
 *   3 links     programme_row_links (superseded / phantom / alternate-name rows)
 *   4 periods   explicit membership periods (Shawnee State transition, Central Penn correction ...)
 *   5 seed      one SEED open period for every other active carrier row (current state at cut-over)
 *   6 aliases   entity-tied aliases for UNITIDs that parent campus/branch entities; alias repairs
 *               (an alias left on a UNITID the row no longer carries)
 *   7 coaches   guarded re-homes (programme membership transitions), evidence host = entity host
 *   8 domains   ownership-chain-verified hosts
 * Postcondition: the permanent identity validator (H1-H10) passes, integrity_check ok — else
 * ROLLBACK. Nothing is deleted. The manifest (--manifest-out) reverts every write.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { assertUnredacted } from '../lib/redactedFixtureGuard.js';
import { ensureAthleticsEntityColumns, ensureRefreshIntegrityColumns } from '../db/migrate.js';
import { validateEntityIdentity } from './validateAthleticsEntityIdentity.js';
import { entityProblems, hostOf } from '../lib/athleticsEntity.js';
import { createIdentityResolver } from '../lib/refresh/identityResolver.js';
import { revertManifest } from '../lib/refresh/promotion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const fail = (m, c = 2) => { console.error(m); process.exit(c); };
const dbArg = arg('db');
if (!dbArg) fail('Give --db.');
if (/^\/data\//.test(path.resolve(dbArg))) fail('Refusing production /data path.');

/** The Phase 7E DDL block of schema.sql (tables + indexes), so schema.sql stays the one source. */
export function phase7eSchemaDdl() {
  const sql = fs.readFileSync(path.resolve(__dirname, '../db/schema.sql'), 'utf8');
  const a = sql.indexOf('CREATE TABLE IF NOT EXISTS programme_membership_periods');
  const b = sql.indexOf('CREATE TABLE IF NOT EXISTS season_freezes');
  if (a < 0 || b < 0) throw new Error('Phase 7E DDL not found in schema.sql');
  const end = sql.indexOf(');', b) + 2;
  return sql.slice(a, end);
}

if (arg('revert')) {
  const man = JSON.parse(fs.readFileSync(path.resolve(arg('revert')), 'utf8'));
  const db = new Database(dbArg, { fileMustExist: true });
  console.log(`REVERT ${man.phase}: ${man.manifest.length} group(s)`);
  if (!apply) { console.log('DRY RUN — add --apply.'); process.exit(0); }
  const r = revertManifest(db, man.manifest); db.close();
  console.log(`REVERTED ${r.reverted} write(s). (Phase 7E tables/columns are left in place; they are inert when empty.)`); process.exit(0);
}

const fxArg = arg('fixture'); const wantHash = arg('fixture-hash');
if (!fxArg || !wantHash) fail('Give --fixture and --fixture-hash.');
const fx = JSON.parse(fs.readFileSync(path.resolve(fxArg), 'utf8'));
assertUnredacted(fx, fxArg);
const { phase, created_at, fixture_hash, ...body } = fx;
const got = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
if (got !== fixture_hash || got !== wantHash) fail(`fixture hash mismatch (computed ${got.slice(0, 12)})`, 1);

const db = new Database(dbArg, { fileMustExist: true });
const now = new Date().toISOString();
const problems = []; const plan = { entities: [], entityNotes: [], repairs: [], links: [], periods: [], aliasTies: [], coaches: [], domains: [] }; let noop = 0;
const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
if (!has('athletics_entities')) fail('athletics_entities absent — Phase 7D model required first.');
const same = (a, b) => (a ?? null) === (b ?? null) || (a != null && b != null && String(a) === String(b));

for (const e of body.entities) {
  const cur = db.prepare('SELECT * FROM athletics_entities WHERE athletics_entity_id=?').get(e.athletics_entity_id);
  if (cur) { noop++; continue; }
  const p = entityProblems({ ...e }); if (p.length) problems.push(`entity ${e.athletics_entity_id}: ${p.join('; ')}`);
  if (e.federal_unitid && db.prepare('SELECT 1 FROM athletics_entities WHERE federal_unitid=?').get(e.federal_unitid)) problems.push(`entity ${e.athletics_entity_id}: UNITID ${e.federal_unitid} already owned`);
  plan.entities.push(e);
}
for (const n of body.entity_notes) {
  const cur = db.prepare('SELECT notes FROM athletics_entities WHERE athletics_entity_id=?').get(n.athletics_entity_id);
  if (!cur) { problems.push(`entity note ${n.athletics_entity_id}: absent`); continue; }
  if (cur.notes === n.notes) { noop++; continue; }
  if (cur.notes !== n.expected_old_notes) { problems.push(`entity note ${n.athletics_entity_id}: expected-old mismatch`); continue; }
  plan.entityNotes.push(n);
}
for (const r of body.repairs) {
  const row = db.prepare('SELECT * FROM colleges WHERE id=?').get(r.college_id);
  if (!row) { problems.push(`${r.label}: row absent`); continue; }
  if (Object.entries(r.set).every(([k, v]) => same(row[k], v))) { noop++; continue; }
  const bad = Object.entries(r.expected_old).filter(([k, v]) => !same(row[k], v));
  if (bad.length) { problems.push(`${r.label}: expected-old ${bad.map(([k]) => k).join(',')} mismatch`); continue; }
  plan.repairs.push({ r, row });
}
const hasLinks = has('programme_row_links');
for (const l of body.row_links) {
  if (hasLinks) { const cur = db.prepare('SELECT * FROM programme_row_links WHERE college_id=?').get(l.college_id); if (cur) { if (cur.canonical_college_id === l.canonical_college_id && cur.link_kind === l.link_kind) { noop++; continue; } problems.push(`${l.label}: a different link exists`); continue; } }
  plan.links.push(l);
}
const hasPeriods = has('programme_membership_periods');
for (const p of body.periods) {
  if (hasPeriods && db.prepare('SELECT 1 FROM programme_membership_periods WHERE athletics_entity_id=? AND sport=? AND first_season=?').get(p.athletics_entity_id, p.sport, p.first_season)) { noop++; continue; }
  plan.periods.push(p);
}
const ac = cols('institution_aliases');
for (const a of body.alias_entity_ties) {
  const cur = db.prepare('SELECT * FROM institution_aliases WHERE alias_key=? AND conference_scope=?').get(a.alias_key, a.conference_scope);
  if (!cur) { problems.push(`alias ${a.alias_key}: absent`); continue; }
  if (ac.has('athletics_entity_id') && cur.athletics_entity_id === a.athletics_entity_id) { noop++; continue; }
  if (Number(cur.unitid) !== Number(a.unitid) || (ac.has('athletics_entity_id') && cur.athletics_entity_id != null)) { problems.push(`alias ${a.alias_key}: expected-old mismatch`); continue; }
  plan.aliasTies.push(a);
}
plan.aliasRepairs = [];
for (const a of body.alias_repairs || []) {
  const cur = db.prepare('SELECT * FROM institution_aliases WHERE alias_key=? AND conference_scope=?').get(a.alias_key, a.conference_scope);
  if (!cur) { problems.push(`alias repair ${a.alias_key}: absent`); continue; }
  if (Object.entries(a.set).every(([k, v]) => same(cur[k], v))) { noop++; continue; }
  if (Object.entries(a.expected_old).some(([k, v]) => !same(cur[k], v))) { problems.push(`alias repair ${a.alias_key}: expected-old mismatch`); continue; }
  plan.aliasRepairs.push({ a, cur });
}
for (const d of body.domains) {
  const cur = db.prepare('SELECT * FROM athletics_domains WHERE domain=?').get(d.domain);
  if (d.op === 'INSERT') { if (cur) { if (cur.status === d.set.status && same(cur.unitid, d.set.unitid)) { noop++; continue; } problems.push(`domain ${d.domain}: exists`); continue; } }
  else {
    if (!cur) { problems.push(`domain ${d.domain}: absent`); continue; }
    if (cur.status === d.set.status && same(cur.unitid, d.set.unitid) && same(cur.athletics_entity_id, d.set.athletics_entity_id)) { noop++; continue; }
    const bad = Object.entries(d.expected_old).filter(([k, v]) => !same(cur[k], v)); if (bad.length) { problems.push(`domain ${d.domain}: expected-old mismatch`); continue; }
  }
  if (d.set.athletics_entity_id && !db.prepare('SELECT 1 FROM athletics_entities WHERE athletics_entity_id=?').get(d.set.athletics_entity_id) && !plan.entities.some((e) => e.athletics_entity_id === d.set.athletics_entity_id)) problems.push(`domain ${d.domain}: entity missing`);
  plan.domains.push({ d, cur });
}
for (const c of body.coach_reassign) {
  const row = db.prepare('SELECT * FROM coaches WHERE id=?').get(c.coach_id);
  if (!row) { problems.push(`coach ${c.coach_id.slice(0, 8)}: absent`); continue; }
  if (Object.entries(c.set).every(([k, v]) => same(row[k], v))) { noop++; continue; }
  if (Object.entries(c.expected_old).some(([k, v]) => !same(row[k], v))) { problems.push(`coach ${c.coach_id.slice(0, 8)}: expected-old mismatch`); continue; }
  const target = db.prepare('SELECT * FROM colleges WHERE name=? AND sport=?').get(c.set.school, row.sport);
  if (!target || target.active !== 1) problems.push(`coach ${c.coach_id.slice(0, 8)}: target programme not active`);
  plan.coaches.push({ c, row, target });
}

console.log(`PHASE 7E structural plan (fixture ${got.slice(0, 12)})`);
console.log(`  entities ${plan.entities.length} · entity notes ${plan.entityNotes.length} · repairs ${plan.repairs.length} · links ${plan.links.length} · periods ${plan.periods.length} (+ seed) · alias ties ${plan.aliasTies.length} · alias repairs ${plan.aliasRepairs.length} · coaches ${plan.coaches.length} · domains ${plan.domains.length} · noop ${noop}`);
for (const { r } of plan.repairs) console.log(`  REPAIR ${r.label}: ${JSON.stringify(r.expected_old)} -> ${JSON.stringify(r.set)}`);
problems.forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { db.close(); fail(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`, 1); }
if (!apply) { db.close(); console.log('\nDRY RUN — re-run with --apply to write.'); process.exit(0); }

const manifest = []; const put = (entries, label) => manifest.push({ observation_id: label, action: 'PHASE7E_STRUCTURAL', entries });
try {
  db.exec('BEGIN');
  db.exec(phase7eSchemaDdl());
  ensureAthleticsEntityColumns(db); ensureRefreshIntegrityColumns(db);
  for (const e of plan.entities) {
    db.prepare('INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, parent_unitid, campus_label, entity_kind, provenance, notes, created_at) VALUES (@athletics_entity_id,@display_name,@federal_unitid,@parent_unitid,@campus_label,@entity_kind,@provenance,@notes,@created_at)').run({ ...e, created_at: now });
    put([{ kind: 'INSERT', table: 'athletics_entities', key: { athletics_entity_id: e.athletics_entity_id }, new: { ...e, created_at: now } }], `entity ${e.athletics_entity_id}`);
  }
  for (const n of plan.entityNotes) {
    db.prepare('UPDATE athletics_entities SET notes=? WHERE athletics_entity_id=? AND notes IS ?').run(n.notes, n.athletics_entity_id, n.expected_old_notes);
    put([{ kind: 'UPDATE', table: 'athletics_entities', key: { athletics_entity_id: n.athletics_entity_id }, old: { notes: n.expected_old_notes }, new: { notes: n.notes } }], `entity note ${n.athletics_entity_id}`);
  }
  for (const { r, row } of plan.repairs) {
    const notes = `${row.identity_notes ? `${row.identity_notes} | ` : ''}${r.note}`.slice(0, 2000);
    const set = { ...r.set, identity_notes: notes };
    const where = Object.keys(r.expected_old).map((k) => `${k} IS @__o_${k}`).join(' AND ');
    const res = db.prepare(`UPDATE colleges SET ${Object.keys(set).map((k) => `${k}=@${k}`).join(', ')} WHERE id=@__id AND ${where}`).run({ ...set, __id: row.id, ...Object.fromEntries(Object.entries(r.expected_old).map(([k, v]) => [`__o_${k}`, v])) });
    if (res.changes !== 1) throw new Error(`repair ${r.label}`);
    put([{ kind: 'UPDATE', table: 'colleges', key: { id: row.id }, old: Object.fromEntries(Object.keys(set).map((k) => [k, row[k] ?? null])), new: set }], `repair ${r.label}`);
  }
  for (const l of plan.links) {
    const row = { college_id: l.college_id, canonical_college_id: l.canonical_college_id, link_kind: l.link_kind, effective_from_season: l.effective_from_season, provenance: l.provenance, recorded_at: now };
    db.prepare('INSERT INTO programme_row_links (college_id, canonical_college_id, link_kind, effective_from_season, provenance, recorded_at) VALUES (@college_id,@canonical_college_id,@link_kind,@effective_from_season,@provenance,@recorded_at)').run(row);
    put([{ kind: 'INSERT', table: 'programme_row_links', key: { college_id: l.college_id }, new: row }], `link ${l.label}`);
  }
  const insP = db.prepare('INSERT INTO programme_membership_periods (athletics_entity_id, sport, first_season, last_season, governing_body, division, membership_status, conference, postseason_eligible, college_id, source_url, source_tier, provenance, review_due_season, recorded_at) VALUES (@athletics_entity_id,@sport,@first_season,@last_season,@governing_body,@division,@membership_status,@conference,@postseason_eligible,@college_id,@source_url,@source_tier,@provenance,@review_due_season,@recorded_at)');
  const pEntries = [];
  for (const p of plan.periods) { const row = { ...p, recorded_at: now }; insP.run(row); pEntries.push({ kind: 'INSERT', table: 'programme_membership_periods', key: { athletics_entity_id: p.athletics_entity_id, sport: p.sport, first_season: p.first_season }, new: row }); }
  // SEED: every active carrier row whose entity+sport has no period yet
  const linked = new Set(db.prepare('SELECT college_id FROM programme_row_links').all().map((r) => r.college_id));
  const withPeriod = new Set(db.prepare('SELECT athletics_entity_id||\'|\'||sport k FROM programme_membership_periods').all().map((r) => r.k));
  const gov = (d) => (/^NCAA/.test(d) ? 'NCAA' : d);
  let seeded = 0;
  for (const c of db.prepare('SELECT * FROM colleges WHERE active=1 AND athletics_entity_id IS NOT NULL ORDER BY id').all()) {
    if (linked.has(c.id) || withPeriod.has(`${c.athletics_entity_id}|${c.sport}`)) continue;
    const row = { athletics_entity_id: c.athletics_entity_id, sport: c.sport, first_season: body.seed_periods.first_season, last_season: null, governing_body: gov(c.division), division: c.division, membership_status: 'ACTIVE', conference: c.conference ?? null, postseason_eligible: null, college_id: c.id, source_url: null, source_tier: body.seed_periods.source_tier, provenance: body.seed_periods.provenance, review_due_season: null, recorded_at: now };
    insP.run(row); withPeriod.add(`${c.athletics_entity_id}|${c.sport}`); seeded++;
    pEntries.push({ kind: 'INSERT', table: 'programme_membership_periods', key: { athletics_entity_id: row.athletics_entity_id, sport: row.sport, first_season: row.first_season }, new: row });
  }
  put(pEntries, 'membership periods');
  for (const a of plan.aliasTies) {
    if (db.prepare('UPDATE institution_aliases SET athletics_entity_id=? WHERE alias_key=? AND conference_scope=? AND unitid=? AND athletics_entity_id IS NULL').run(a.athletics_entity_id, a.alias_key, a.conference_scope, a.unitid).changes !== 1) throw new Error(`alias ${a.alias_key}`);
    put([{ kind: 'UPDATE', table: 'institution_aliases', key: { alias_key: a.alias_key, conference_scope: a.conference_scope }, old: { athletics_entity_id: null }, new: { athletics_entity_id: a.athletics_entity_id } }], `alias ${a.alias_key}`);
  }
  for (const { a, cur } of plan.aliasRepairs) {
    const where = Object.keys(a.expected_old).map((k) => `${k} IS @__o_${k}`).join(' AND ');
    if (db.prepare(`UPDATE institution_aliases SET ${Object.keys(a.set).map((k) => `${k}=@${k}`).join(', ')}, notes=@__n WHERE alias_key=@__k AND conference_scope=@__s AND ${where}`).run({ ...a.set, __n: `${cur.notes ? `${cur.notes} | ` : ''}Phase 7E: ${a.provenance}`.slice(0, 1000), __k: a.alias_key, __s: a.conference_scope, ...Object.fromEntries(Object.entries(a.expected_old).map(([k, v]) => [`__o_${k}`, v])) }).changes !== 1) throw new Error(`alias repair ${a.alias_key}`);
    put([{ kind: 'UPDATE', table: 'institution_aliases', key: { alias_key: a.alias_key, conference_scope: a.conference_scope }, old: { ...Object.fromEntries(Object.keys(a.set).map((k) => [k, cur[k] ?? null])), notes: cur.notes ?? null }, new: { ...a.set, notes: `${cur.notes ? `${cur.notes} | ` : ''}Phase 7E: ${a.provenance}`.slice(0, 1000) } }], `alias repair ${a.alias_key}`);
  }
  for (const { d, cur } of plan.domains) {
    const set = { ...d.set, verification_method: 'PHASE7E_OWNERSHIP_CHAIN', confidence: 'CERTAIN', checked_at: now, notes: `Phase 7E: ${d.provenance}` };
    if (d.op === 'INSERT') {
      const row = { domain: d.domain, ...set };
      db.prepare(`INSERT INTO athletics_domains (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(',')})`).run(row);
      put([{ kind: 'INSERT', table: 'athletics_domains', key: { domain: d.domain }, new: row }], `domain ${d.domain}`);
    } else {
      const where = Object.keys(d.expected_old).map((k) => `${k} IS @__o_${k}`).join(' AND ');
      if (db.prepare(`UPDATE athletics_domains SET ${Object.keys(set).map((k) => `${k}=@${k}`).join(', ')} WHERE domain=@__d AND ${where}`).run({ ...set, __d: d.domain, ...Object.fromEntries(Object.entries(d.expected_old).map(([k, v]) => [`__o_${k}`, v])) }).changes !== 1) throw new Error(`domain ${d.domain}`);
      put([{ kind: 'UPDATE', table: 'athletics_domains', key: { domain: d.domain }, old: Object.fromEntries(Object.keys(set).map((k) => [k, cur[k] ?? null])), new: set }], `domain ${d.domain}`);
    }
  }
  // coaches last: evidence host must now belong to the target programme's entity
  const resolver = createIdentityResolver({ entities: db.prepare('SELECT * FROM athletics_entities').all(), colleges: db.prepare('SELECT id, name, sport, division, unitid, active, athletics_entity_id FROM colleges').all(), domains: db.prepare('SELECT * FROM athletics_domains').all(), aliases: [], rowLinks: db.prepare('SELECT * FROM programme_row_links').all() });
  for (const { c, row, target } of plan.coaches) {
    if (!resolver.hostOwnedBy(hostOf(c.evidence_url), target.athletics_entity_id)) throw new Error(`coach ${row.id.slice(0, 8)}: evidence host is not ${target.athletics_entity_id}'s`);
    const reason = `[7E] ${c.rationale}`.slice(0, 240);
    if (db.prepare('UPDATE coaches SET school=@s, division=@d, currentness_reason=@r WHERE id=@id AND school=@os AND division IS @od').run({ s: c.set.school, d: c.set.division, r: reason, id: row.id, os: c.expected_old.school, od: c.expected_old.division }).changes !== 1) throw new Error(`coach ${row.id}`);
    put([{ kind: 'UPDATE', table: 'coaches', key: { id: row.id }, old: { school: row.school, division: row.division, currentness_reason: row.currentness_reason ?? null }, new: { school: c.set.school, division: c.set.division, currentness_reason: reason } }], `coach ${row.id.slice(0, 8)}`);
  }
  const v = validateEntityIdentity(db);
  if (v.status !== 'PASS') throw new Error(`identity invariant FAIL after apply:\n  ${v.hard.slice(0, 20).join('\n  ')}`);
  const integ = db.pragma('integrity_check', { simple: true }); if (integ !== 'ok') throw new Error(`integrity ${integ}`);
  db.exec('COMMIT');
  const mo = arg('manifest-out'); if (mo) fs.writeFileSync(path.resolve(mo), JSON.stringify({ phase: '7E-structural', fixture_hash: got, manifest }, null, 2));
  console.log(`\nAPPLIED — seeded ${seeded} SEED periods; validator ${v.status} (${v.documented.length} documented, ${v.warnings.length} warnings); integrity ${integ}.`);
  v.warnings.forEach((w) => console.log('  WARN', w));
} catch (err) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1); }
db.close();
