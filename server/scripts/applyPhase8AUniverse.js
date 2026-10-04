#!/usr/bin/env node
/**
 * PHASE 8A — NJCAA/USCAA authoritative universe repair (NON-PRODUCTION only). No coaches.
 *
 *   node server/scripts/applyPhase8AUniverse.js --db <path> --fixture <f> --fixture-hash <sha> [--apply] [--manifest-out <f>]
 *   node server/scripts/applyPhase8AUniverse.js --db <path> --revert <manifest> [--apply]
 *
 * Every action in the reviewed fixture carries expected_old, proposed, evidence, reason and
 * blast_radius. One transaction, in this order:
 *   entity_create      new athletics entities (federal UNITID only from the federal registry;
 *                      campuses/branches carry parent_unitid + campus_label, never a UNITID)
 *   entity_update      an UNRESOLVED_FEDERAL entity resolved to its proper kind (expected-old kind)
 *   college_repair     field corrections on existing rows (expected-old values)
 *   programme_create   a missing programme: colleges row + its membership period (absent-guarded)
 *   membership_verify  an existing open period verified by an authoritative listing (tier/url/provenance
 *                      only — division/conference untouched; expected-old tier)
 *   row_link           programme_row_links for stale campus rows
 *   deactivate         a phantom programme: period -> DISCONTINUED, row inactive (never deleted)
 *   domain_register    ownership-chain-verified athletics hosts (absent or unowned rows only)
 *   association_correct (8B.1) a row the legacy DB labelled NJCAA that its real association (CCCAA /
 *                      NWAC) lists: colleges.division/conference + its SEED open period, never a
 *                      verified period, never a history row (expected-old guarded)
 *   location_register  (8B.1) a verified host + PATH SCOPE source location (absent-guarded; never the
 *                      whole host for an institution path; never on a host another entity owns)
 * Postcondition: identity validator (H1-H11) PASS + integrity_check ok, else ROLLBACK.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { assertUnredacted } from '../lib/redactedFixtureGuard.js';
import { validateEntityIdentity } from './validateAthleticsEntityIdentity.js';
import { entityProblems } from '../lib/athleticsEntity.js';
import { revertManifest } from '../lib/refresh/promotion.js';
import { SHARED_PLATFORM_ROOT } from '../lib/refresh/identityResolver.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const fail = (m, c = 2) => { console.error(m); process.exit(c); };
const dbArg = arg('db'); if (!dbArg) fail('Give --db.');
if (/^\/data\//.test(path.resolve(dbArg))) fail('Refusing production /data path.');
if (arg('revert')) {
  const man = JSON.parse(fs.readFileSync(path.resolve(arg('revert')), 'utf8'));
  const db = new Database(dbArg, { fileMustExist: true });
  console.log(`REVERT ${man.phase}: ${man.manifest.length} group(s)`);
  if (!apply) { console.log('DRY RUN — add --apply.'); process.exit(0); }
  const r = revertManifest(db, man.manifest); db.close(); console.log(`REVERTED ${r.reverted} write(s).`); process.exit(0);
}
const fx = JSON.parse(fs.readFileSync(path.resolve(arg('fixture') || fail('Give --fixture.')), 'utf8'));
assertUnredacted(fx, arg('fixture'));
const { phase, created_at, fixture_hash, ...body } = fx;
const got = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
if (got !== fixture_hash || got !== arg('fixture-hash')) fail(`fixture hash mismatch (computed ${got.slice(0, 12)})`, 1);
for (const k of ['entity_create', 'entity_update', 'college_repair', 'programme_create', 'membership_verify', 'row_link', 'deactivate', 'domain_register', 'association_correct', 'location_register']) {
  for (const a of body[k] || []) for (const f of ['proposed', 'evidence', 'reason', 'blast_radius']) if (a[f] == null) fail(`${k} ${a.label || ''}: missing ${f} — every action needs expected_old, proposed, evidence, reason and blast radius`);
}
const db = new Database(dbArg, { fileMustExist: true });
const now = new Date().toISOString();
const same = (a, b) => (a ?? null) === (b ?? null) || (a != null && b != null && String(a) === String(b));
const problems = []; let noop = 0; const plan = {};
const P = (k) => (plan[k] = plan[k] || []);
for (const a of body.entity_create || []) {
  const cur = db.prepare('SELECT * FROM athletics_entities WHERE athletics_entity_id=?').get(a.proposed.athletics_entity_id);
  if (cur) { noop++; continue; }
  const pr = entityProblems({ ...a.proposed }); if (pr.length) problems.push(`entity ${a.proposed.athletics_entity_id}: ${pr.join('; ')}`);
  if (a.proposed.federal_unitid && db.prepare('SELECT 1 FROM athletics_entities WHERE federal_unitid=?').get(a.proposed.federal_unitid)) problems.push(`entity ${a.proposed.athletics_entity_id}: UNITID ${a.proposed.federal_unitid} already owned`);
  P('entity_create').push(a);
}
for (const a of body.entity_update || []) {
  const cur = db.prepare('SELECT * FROM athletics_entities WHERE athletics_entity_id=?').get(a.id);
  if (!cur) { problems.push(`entity_update ${a.id}: absent`); continue; }
  if (Object.entries(a.proposed).every(([k, v]) => same(cur[k], v))) { noop++; continue; }
  if (Object.entries(a.expected_old).some(([k, v]) => !same(cur[k], v))) { problems.push(`entity_update ${a.id}: expected-old mismatch`); continue; }
  const pr = entityProblems({ ...cur, ...a.proposed }); if (pr.length) problems.push(`entity_update ${a.id}: ${pr.join('; ')}`);
  P('entity_update').push({ a, cur });
}
for (const a of body.college_repair || []) {
  const row = db.prepare('SELECT * FROM colleges WHERE id=?').get(a.college_id);
  if (!row) { problems.push(`${a.label}: absent`); continue; }
  if (Object.entries(a.proposed).every(([k, v]) => same(row[k], v))) { noop++; continue; }
  if (Object.entries(a.expected_old).some(([k, v]) => !same(row[k], v))) { problems.push(`${a.label}: expected-old mismatch`); continue; }
  if (a.proposed.name && db.prepare('SELECT 1 FROM colleges WHERE name=? AND sport=? AND id<>?').get(a.proposed.name, row.sport, row.id)) problems.push(`${a.label}: name ${a.proposed.name} already used`);
  P('college_repair').push({ a, row });
}
for (const a of body.programme_create || []) {
  const r = a.proposed.college;
  if (db.prepare('SELECT 1 FROM colleges WHERE id=?').get(r.id)) { noop++; continue; }
  if (db.prepare('SELECT 1 FROM colleges WHERE athletics_entity_id=? AND sport=? AND active=1').get(r.athletics_entity_id, r.sport)) { problems.push(`${a.label}: entity already has an active ${r.sport} programme`); continue; }
  if (db.prepare('SELECT 1 FROM colleges WHERE name=? AND sport=?').get(r.name, r.sport)) { problems.push(`${a.label}: name already used`); continue; }
  P('programme_create').push(a);
}
for (const a of body.membership_verify || []) {
  const k = a.key; const cur = db.prepare('SELECT * FROM programme_membership_periods WHERE athletics_entity_id=? AND sport=? AND first_season=?').get(k.athletics_entity_id, k.sport, k.first_season);
  if (!cur) { problems.push(`${a.label}: period absent`); continue; }
  if (cur.source_tier === a.proposed.source_tier && cur.source_url === a.proposed.source_url) { noop++; continue; }
  if (Object.entries(a.expected_old).some(([f, v]) => !same(cur[f], v))) { problems.push(`${a.label}: expected-old mismatch`); continue; }
  if (cur.last_season != null) { problems.push(`${a.label}: period is closed — verification only applies to the open period`); continue; }
  P('membership_verify').push({ a, cur });
}
for (const a of body.row_link || []) {
  if (db.prepare('SELECT 1 FROM programme_row_links WHERE college_id=?').get(a.proposed.college_id)) { noop++; continue; }
  const r = db.prepare('SELECT * FROM colleges WHERE id=?').get(a.proposed.college_id);
  if (!r || Object.entries(a.expected_old).some(([k, v]) => !same(r[k], v))) { problems.push(`${a.label}: expected-old mismatch`); continue; }
  P('row_link').push({ a, r });
}
for (const a of body.deactivate || []) {
  const r = db.prepare('SELECT * FROM colleges WHERE id=?').get(a.college_id);
  if (!r) { problems.push(`${a.label}: absent`); continue; }
  if (r.active === 0) { noop++; continue; }
  if (Object.entries(a.expected_old).some(([k, v]) => !same(r[k], v))) { problems.push(`${a.label}: expected-old mismatch`); continue; }
  const deps = ['roster_players', 'coaches', 'coach_seasons', 'programme_seasons'].map((t) => { const col = t === 'programme_seasons' ? 'college_id' : t === 'coaches' || t === 'coach_seasons' ? 'school' : 'college_name'; const v = col === 'college_id' ? r.id : r.name; return db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${col}=? ${col !== 'college_id' ? 'AND sport=?' : ''}`).get(...(col === 'college_id' ? [v] : [v, r.sport])).n; });
  if (deps.some((n) => n > 0) && !a.allow_dependents) { problems.push(`${a.label}: has dependent rows (${deps.join('/')}) — a phantom programme must have none`); continue; }
  P('deactivate').push({ a, r });
}
for (const a of body.domain_register || []) {
  const d = a.proposed.domain;
  if (SHARED_PLATFORM_ROOT.test(d) && !/^[a-z0-9-]+\.prestosports\.com$/.test(d)) { problems.push(`${d}: shared platform root`); continue; }
  const cur = db.prepare('SELECT * FROM athletics_domains WHERE domain=?').get(d);
  if (cur && cur.status === a.proposed.status && same(cur.athletics_entity_id, a.proposed.athletics_entity_id)) { noop++; continue; }
  if (cur && (cur.athletics_entity_id || ['VERIFIED', 'VERIFIED_ALIAS', 'WRONG_INSTITUTION'].includes(cur.status))) { problems.push(`${d}: already owned/decided (${cur.status}${cur.athletics_entity_id ? ` ${cur.athletics_entity_id}` : ''}) — ownership change is a protected action`); continue; }
  P('domain_register').push({ a, cur });
}
const OTHER_ASSOC = new Set(['CCCAA', 'NWAC']);
for (const a of body.association_correct || []) {
  const r = db.prepare('SELECT * FROM colleges WHERE id=?').get(a.college_id);
  if (!r) { problems.push(`${a.label}: absent`); continue; }
  const pp = db.prepare('SELECT * FROM programme_membership_periods WHERE college_id=? AND last_season IS NULL').get(r.id);
  if (r.division === a.proposed.division && pp && pp.division === a.proposed.division) { noop++; continue; }
  if (!OTHER_ASSOC.has(a.proposed.division)) { problems.push(`${a.label}: ${a.proposed.division} is not an out-of-scope association this action may record`); continue; }
  if (Object.entries(a.expected_old).some(([k, v]) => !same(r[k], v))) { problems.push(`${a.label}: expected-old mismatch`); continue; }
  if (!pp || pp.source_tier !== 'SEED') { problems.push(`${a.label}: only a SEED open period may be corrected (found ${pp ? pp.source_tier : 'none'})`); continue; }
  P('association_correct').push({ a, r, pp });
}
for (const a of body.location_register || []) {
  const L = a.proposed;
  if (SHARED_PLATFORM_ROOT.test(L.host)) { problems.push(`${a.label}: shared platform root`); continue; }
  if (L.source_type !== 'ATHLETICS_HOST' && (!L.path_prefix || L.path_prefix === '/')) { problems.push(`${a.label}: an institution path cannot be the whole host`); continue; }
  const cur = db.prepare('SELECT * FROM athletics_source_locations WHERE location_id=?').get(L.location_id);
  if (cur) { if (cur.status === L.status && cur.athletics_entity_id === L.athletics_entity_id) { noop++; continue; } problems.push(`${a.label}: location exists with a different state — a change is a protected action`); continue; }
  const owner = db.prepare("SELECT athletics_entity_id e FROM athletics_domains WHERE domain=? AND athletics_entity_id IS NOT NULL AND status IN ('VERIFIED','VERIFIED_ALIAS')").get(L.host);
  if (owner && owner.e !== L.athletics_entity_id) { problems.push(`${a.label}: ${L.host} is owned by ${owner.e}`); continue; }
  if (!db.prepare('SELECT 1 FROM athletics_entities WHERE athletics_entity_id=?').get(L.athletics_entity_id)) { problems.push(`${a.label}: entity absent`); continue; }
  P('location_register').push({ a });
}
console.log(`PHASE 8A universe plan (fixture ${got.slice(0, 12)})`);
console.log('  ' + Object.entries(plan).map(([k, v]) => `${k} ${v.length}`).join(' · ') + ` · noop ${noop}`);
problems.slice(0, 40).forEach((p) => console.log('  BLOCKED:', p));
if (problems.length) { db.close(); fail(`\nABORT — ${problems.length} precondition failure(s). Nothing changed.`, 1); }
if (!apply) { db.close(); console.log('\nDRY RUN — re-run with --apply to write.'); process.exit(0); }
const manifest = []; const put = (entries, label) => manifest.push({ observation_id: label, action: 'PHASE8A_UNIVERSE', entries });
const insert = (t, row) => { db.prepare(`INSERT INTO ${t} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(',')})`).run(row); };
try {
  db.exec('BEGIN');
  for (const a of plan.entity_create || []) { const row = { ...a.proposed, created_at: now }; insert('athletics_entities', row); put([{ kind: 'INSERT', table: 'athletics_entities', key: { athletics_entity_id: row.athletics_entity_id }, new: row }], a.label); }
  for (const { a, cur } of plan.entity_update || []) { const set = a.proposed; db.prepare(`UPDATE athletics_entities SET ${Object.keys(set).map((k) => `${k}=@${k}`).join(', ')} WHERE athletics_entity_id=@__id`).run({ ...set, __id: a.id }); put([{ kind: 'UPDATE', table: 'athletics_entities', key: { athletics_entity_id: a.id }, old: Object.fromEntries(Object.keys(set).map((k) => [k, cur[k] ?? null])), new: set }], a.label); }
  for (const { a, row } of plan.college_repair || []) {
    const set = { ...a.proposed, identity_notes: `${row.identity_notes ? `${row.identity_notes} | ` : ''}Phase 8A: ${a.reason}`.slice(0, 2000) };
    if (db.prepare(`UPDATE colleges SET ${Object.keys(set).map((k) => `${k}=@${k}`).join(', ')} WHERE id=@__id`).run({ ...set, __id: row.id }).changes !== 1) throw new Error(a.label);
    const entries = [{ kind: 'UPDATE', table: 'colleges', key: { id: row.id }, old: Object.fromEntries(Object.keys(set).map((k) => [k, row[k] ?? null])), new: set }];
    // a carrier's conference is the open period's pointer (H10): keep them in step
    if ('conference' in a.proposed) { const pp = db.prepare('SELECT * FROM programme_membership_periods WHERE college_id=? AND last_season IS NULL').get(row.id); if (pp) { db.prepare('UPDATE programme_membership_periods SET conference=? WHERE athletics_entity_id=? AND sport=? AND first_season=?').run(a.proposed.conference, pp.athletics_entity_id, pp.sport, pp.first_season); entries.push({ kind: 'UPDATE', table: 'programme_membership_periods', key: { athletics_entity_id: pp.athletics_entity_id, sport: pp.sport, first_season: pp.first_season }, old: { conference: pp.conference }, new: { conference: a.proposed.conference } }); } }
    put(entries, a.label);
  }
  for (const a of plan.programme_create || []) {
    const c = { ...a.proposed.college, created_date: now, updated_date: now, identity_source: 'PHASE8A_UNIVERSE', identity_notes: `Phase 8A: ${a.reason}`.slice(0, 2000) };
    insert('colleges', c);
    const p = { ...a.proposed.period, recorded_at: now }; insert('programme_membership_periods', p);
    put([{ kind: 'INSERT', table: 'colleges', key: { id: c.id }, new: c }, { kind: 'INSERT', table: 'programme_membership_periods', key: { athletics_entity_id: p.athletics_entity_id, sport: p.sport, first_season: p.first_season }, new: p }], a.label);
  }
  for (const { a, cur } of plan.membership_verify || []) {
    const set = { source_tier: a.proposed.source_tier, source_url: a.proposed.source_url, provenance: a.proposed.provenance, recorded_at: now };
    db.prepare('UPDATE programme_membership_periods SET source_tier=@source_tier, source_url=@source_url, provenance=@provenance, recorded_at=@recorded_at WHERE athletics_entity_id=@e AND sport=@s AND first_season=@f AND last_season IS NULL').run({ ...set, e: cur.athletics_entity_id, s: cur.sport, f: cur.first_season });
    put([{ kind: 'UPDATE', table: 'programme_membership_periods', key: { athletics_entity_id: cur.athletics_entity_id, sport: cur.sport, first_season: cur.first_season }, old: { source_tier: cur.source_tier, source_url: cur.source_url, provenance: cur.provenance, recorded_at: cur.recorded_at }, new: set }], a.label);
  }
  for (const { a, r } of plan.row_link || []) {
    const link = { ...a.proposed, recorded_at: now }; insert('programme_row_links', link);
    const entries = [{ kind: 'INSERT', table: 'programme_row_links', key: { college_id: link.college_id }, new: link }];
    if (r.active === 1) { db.prepare('UPDATE colleges SET active=0 WHERE id=?').run(r.id); entries.push({ kind: 'UPDATE', table: 'colleges', key: { id: r.id }, old: { active: 1 }, new: { active: 0 } }); }
    const pp = db.prepare('SELECT * FROM programme_membership_periods WHERE college_id=? AND last_season IS NULL').get(r.id);
    if (pp) { db.prepare("UPDATE programme_membership_periods SET college_id=? WHERE athletics_entity_id=? AND sport=? AND first_season=?").run(link.canonical_college_id, pp.athletics_entity_id, pp.sport, pp.first_season); entries.push({ kind: 'UPDATE', table: 'programme_membership_periods', key: { athletics_entity_id: pp.athletics_entity_id, sport: pp.sport, first_season: pp.first_season }, old: { college_id: pp.college_id }, new: { college_id: link.canonical_college_id } }); }
    put(entries, a.label);
  }
  // association correction BEFORE deactivation: a phantom at another association is re-labelled, then retired
  for (const { a, r, pp } of plan.association_correct || []) {
    const set = { division: a.proposed.division, conference: a.proposed.conference ?? r.conference, identity_notes: `${r.identity_notes ? `${r.identity_notes} | ` : ''}Phase 8B.1: ${a.reason}`.slice(0, 2000) };
    db.prepare('UPDATE colleges SET division=@division, conference=@conference, identity_notes=@identity_notes WHERE id=@id').run({ ...set, id: r.id });
    const P2 = { ...a.period, recorded_at: now };
    db.prepare('UPDATE programme_membership_periods SET governing_body=@governing_body, division=@division, membership_status=@membership_status, conference=@conference, source_tier=@source_tier, source_url=@source_url, provenance=@provenance, recorded_at=@recorded_at WHERE athletics_entity_id=@e AND sport=@s AND first_season=@f AND last_season IS NULL')
      .run({ ...P2, e: pp.athletics_entity_id, s: pp.sport, f: pp.first_season });
    put([{ kind: 'UPDATE', table: 'colleges', key: { id: r.id }, old: { division: r.division, conference: r.conference ?? null, identity_notes: r.identity_notes ?? null }, new: set },
      { kind: 'UPDATE', table: 'programme_membership_periods', key: { athletics_entity_id: pp.athletics_entity_id, sport: pp.sport, first_season: pp.first_season }, old: Object.fromEntries(Object.keys(P2).map((k) => [k, pp[k] ?? null])), new: P2 }], a.label);
  }
  for (const { a, r } of plan.deactivate || []) {
    const pp = db.prepare('SELECT * FROM programme_membership_periods WHERE college_id=? AND last_season IS NULL').get(r.id);
    const entries = [];
    if (pp) { db.prepare("UPDATE programme_membership_periods SET membership_status='DISCONTINUED', provenance=? WHERE athletics_entity_id=? AND sport=? AND first_season=?").run(`${pp.provenance} | Phase 8A: ${a.reason}`.slice(0, 1000), pp.athletics_entity_id, pp.sport, pp.first_season); entries.push({ kind: 'UPDATE', table: 'programme_membership_periods', key: { athletics_entity_id: pp.athletics_entity_id, sport: pp.sport, first_season: pp.first_season }, old: { membership_status: pp.membership_status, provenance: pp.provenance }, new: { membership_status: 'DISCONTINUED', provenance: `${pp.provenance} | Phase 8A: ${a.reason}`.slice(0, 1000) } }); }
    const notes = `${r.identity_notes ? `${r.identity_notes} | ` : ''}Phase 8A: ${a.reason}`.slice(0, 2000);
    db.prepare('UPDATE colleges SET active=0, identity_notes=? WHERE id=?').run(notes, r.id);
    entries.push({ kind: 'UPDATE', table: 'colleges', key: { id: r.id }, old: { active: 1, identity_notes: r.identity_notes ?? null }, new: { active: 0, identity_notes: notes } });
    put(entries, a.label);
  }
  for (const { a, cur } of plan.domain_register || []) {
    const set = { ...a.proposed, verification_method: 'PHASE8A_OWNERSHIP_CHAIN', confidence: 'CERTAIN', checked_at: now, notes: `Phase 8A: ${a.evidence.slice(0, 400)}` };
    if (cur) { db.prepare(`UPDATE athletics_domains SET ${Object.keys(set).filter((k) => k !== 'domain').map((k) => `${k}=@${k}`).join(', ')} WHERE domain=@domain`).run(set); put([{ kind: 'UPDATE', table: 'athletics_domains', key: { domain: set.domain }, old: Object.fromEntries(Object.keys(set).filter((k) => k !== 'domain').map((k) => [k, cur[k] ?? null])), new: Object.fromEntries(Object.entries(set).filter(([k]) => k !== 'domain')) }], a.label); }
    else { const row = { claimed_keys: '[]', claimed_unitids: JSON.stringify(set.unitid ? [set.unitid] : []), ...set }; insert('athletics_domains', row); put([{ kind: 'INSERT', table: 'athletics_domains', key: { domain: row.domain }, new: row }], a.label); }
  }
  for (const { a } of plan.location_register || []) { const row = { ...a.proposed, recorded_at: now }; insert('athletics_source_locations', row); put([{ kind: 'INSERT', table: 'athletics_source_locations', key: { location_id: row.location_id }, new: row }], a.label); }
  const v = validateEntityIdentity(db);
  if (v.status !== 'PASS') throw new Error(`identity invariant FAIL:\n  ${v.hard.slice(0, 20).join('\n  ')}`);
  const integ = db.pragma('integrity_check', { simple: true }); if (integ !== 'ok') throw new Error(`integrity ${integ}`);
  db.exec('COMMIT');
  if (arg('manifest-out')) fs.writeFileSync(path.resolve(arg('manifest-out')), JSON.stringify({ phase: '8A-universe', fixture_hash: got, manifest }, null, 2));
  console.log(`\nAPPLIED — ${manifest.length} action(s); validator ${v.status} (${v.documented.length} documented, ${v.warnings.length} warnings); integrity ${integ}.`);
  v.warnings.forEach((w) => console.log('  WARN', w));
} catch (err) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1); }
db.close();
