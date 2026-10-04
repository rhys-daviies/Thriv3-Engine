#!/usr/bin/env node
/**
 * PHASE 8B.1A — guarded player-history repair (shared dev only).
 *
 *   node server/scripts/applyPhase8B1APlayerHistory.js --db <path> --fixture <f> --fixture-hash <sha> [--apply] [--manifest-out <f>]
 *   node server/scripts/applyPhase8B1APlayerHistory.js --db <path> --revert <manifest> [--apply]
 *
 * Applies a reviewed, hash-frozen fixture:
 *   evidence_insert  player_prior_school_evidence rows   (expected-old: absent)
 *   link_insert      player_observation_links rows       (expected-old: absent)
 *   prior_set        roster_players.prior_programme ONLY (expected-old: the current value)
 * An action whose target already holds the proposed value is a no-op (idempotent re-run); one
 * holding anything else is a conflict and NOTHING is written.
 *
 * ONE transaction. Postconditions, else ROLLBACK:
 *   - every non-null 2026 prior_programme has exactly one VERIFIED_SAME_PERSON link from that
 *     programme with a non-name-only evidence class (name-only identity is never factual)
 *   - no roster_players row added or removed, and no column but prior_programme written
 *   - identity validator PASS, integrity_check ok
 * The tables themselves come from server/db/schema.sql (run client.js / migrate first); this
 * script refuses if they are missing rather than creating them.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { validateEntityIdentity } from './validateAthleticsEntityIdentity.js';
import { revertManifest } from '../lib/refresh/promotion.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const apply = process.argv.includes('--apply');
const fail = (m, c = 2) => { console.error(m); process.exit(c); };
const dbArg = arg('db'); if (!dbArg) fail('Give --db.');
if (/^\/data\//.test(path.resolve(dbArg))) fail('Refusing production /data path.');
const FACTUAL_CLASSES = ['EXPLICIT_PRIOR_SCHOOL', 'MULTI_SIGNAL', 'REVIEWED', 'PROGRAMME_SCOPED'];

if (arg('revert')) {
  const man = JSON.parse(fs.readFileSync(path.resolve(arg('revert')), 'utf8'));
  const db = new Database(dbArg, { fileMustExist: true });
  console.log(`REVERT ${man.phase}: ${man.manifest.length} group(s)`);
  if (!apply) { console.log('DRY RUN — add --apply.'); process.exit(0); }
  const r = revertManifest(db, man.manifest); db.close(); console.log(`REVERTED ${r.reverted} write(s).`); process.exit(0);
}

const fx = JSON.parse(fs.readFileSync(path.resolve(arg('fixture') || fail('Give --fixture.')), 'utf8'));
const { phase, created_at, fixture_hash, ...body } = fx;
const got = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
if (got !== fixture_hash || got !== arg('fixture-hash')) fail(`fixture hash mismatch (computed ${got.slice(0, 12)})`, 1);
for (const k of ['evidence_insert', 'link_insert', 'prior_set']) {
  for (const a of body[k] || []) for (const f of ['expected_old', 'proposed', 'evidence', 'reason', 'blast_radius']) if (a[f] === undefined) fail(`${k} ${a.label || ''}: missing ${f} — every action needs expected_old, proposed, evidence, reason and blast radius`);
}
const db = new Database(dbArg, { fileMustExist: true });
for (const t of ['player_prior_school_evidence', 'player_observation_links']) if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)) fail(`table ${t} missing — run the schema migration (server/db/client.js) first`);
// a link may only be FACTUAL with evidence; refuse a fixture that says otherwise
for (const a of body.link_insert || []) if (a.proposed.decision === 'VERIFIED_SAME_PERSON' && !FACTUAL_CLASSES.includes(a.proposed.evidence_class)) fail(`${a.label}: VERIFIED with evidence class ${a.proposed.evidence_class}`);

const same = (a, b) => (a ?? null) === (b ?? null) || (a != null && b != null && String(a) === String(b));
const problems = []; const noop = { evidence: 0, link: 0, prior: 0 }; const plan = { evidence: [], link: [], prior: [] };
const getEv = db.prepare('SELECT * FROM player_prior_school_evidence WHERE evidence_id=?');
const getLink = db.prepare('SELECT * FROM player_observation_links WHERE link_id=?');
const getRow = db.prepare('SELECT id, prior_programme FROM roster_players WHERE id=?');
const rowSame = (cur, p) => Object.keys(p).every((k) => same(cur[k], p[k]));
for (const a of body.evidence_insert || []) { const cur = getEv.get(a.proposed.evidence_id); if (!cur) plan.evidence.push(a); else if (rowSame(cur, a.proposed)) noop.evidence++; else problems.push(`${a.label}: present with different content`); }
for (const a of body.link_insert || []) { const cur = getLink.get(a.proposed.link_id); if (!cur) plan.link.push(a); else if (rowSame(cur, a.proposed)) noop.link++; else problems.push(`${a.label}: present with different content`); }
for (const a of body.prior_set || []) {
  const cur = getRow.get(a.id);
  if (!cur) { problems.push(`${a.label}: roster row missing`); continue; }
  if (same(cur.prior_programme, a.proposed.prior_programme)) { noop.prior++; continue; }
  if (!same(cur.prior_programme, a.expected_old.prior_programme)) { problems.push(`${a.label}: expected-old mismatch (have ${JSON.stringify(cur.prior_programme)})`); continue; }
  plan.prior.push(a);
}
console.log(`PHASE ${phase} fixture ${got.slice(0, 12)}: evidence +${plan.evidence.length} (noop ${noop.evidence}), links +${plan.link.length} (noop ${noop.link}), prior_programme ${plan.prior.length} (noop ${noop.prior})`);
if (problems.length) { console.error(`REFUSED — ${problems.length} problem(s):\n  ${problems.slice(0, 20).join('\n  ')}`); db.close(); process.exit(1); }
if (!apply) { db.close(); console.log('\nDRY RUN — re-run with --apply to write.'); process.exit(0); }

const insert = (t, row) => db.prepare(`INSERT INTO ${t} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(',')})`).run(row);
const manifest = []; const put = (entries, label) => manifest.push({ observation_id: label, action: 'PHASE8B1A_PLAYER_HISTORY', entries });
const rosterShape = () => db.prepare("SELECT COUNT(*) n, total(length(player_name)) a, total(length(coalesce(hometown,''))) b, total(coalesce(projected_minutes,0)) c, total(length(coalesce(class_year_label,''))) d FROM roster_players").get();
try {
  const shapeBefore = rosterShape();
  db.exec('BEGIN');
  const evIns = db.prepare(`INSERT INTO player_prior_school_evidence (${Object.keys((body.evidence_insert[0] || { proposed: {} }).proposed).join(',')}) VALUES (${Object.keys((body.evidence_insert[0] || { proposed: {} }).proposed).map((k) => `@${k}`).join(',')})`);
  for (const a of plan.evidence) { evIns.run(a.proposed); put([{ kind: 'INSERT', table: 'player_prior_school_evidence', key: { evidence_id: a.proposed.evidence_id }, new: a.proposed }], a.label); }
  for (const a of plan.link) { insert('player_observation_links', a.proposed); put([{ kind: 'INSERT', table: 'player_observation_links', key: { link_id: a.proposed.link_id }, new: a.proposed }], a.label); }
  const setP = db.prepare('UPDATE roster_players SET prior_programme=? WHERE id=?');
  for (const a of plan.prior) { if (setP.run(a.proposed.prior_programme, a.id).changes !== 1) throw new Error(a.label); put([{ kind: 'UPDATE', table: 'roster_players', key: { id: a.id }, old: { prior_programme: a.expected_old.prior_programme }, new: { prior_programme: a.proposed.prior_programme } }], a.label); }
  // ---- postconditions
  const bad = db.prepare(`SELECT r.id FROM roster_players r WHERE r.season='2026' AND r.prior_programme IS NOT NULL
      AND (SELECT COUNT(*) FROM player_observation_links l WHERE l.to_observation_id=r.id AND l.from_programme=r.prior_programme AND l.decision='VERIFIED_SAME_PERSON'
             AND l.evidence_class IN (${FACTUAL_CLASSES.map(() => '?').join(',')}) AND (l.evidence_class <> 'PROGRAMME_SCOPED' OR r.prior_programme = r.college_name)) <> 1`).all(...FACTUAL_CLASSES);
  if (bad.length) throw new Error(`${bad.length} factual prior_programme value(s) without exactly one VERIFIED evidenced link (e.g. ${bad[0].id})`);
  const shapeAfter = rosterShape();
  if (JSON.stringify(shapeBefore) !== JSON.stringify(shapeAfter)) throw new Error(`roster observations changed: ${JSON.stringify(shapeBefore)} -> ${JSON.stringify(shapeAfter)}`);
  const v = validateEntityIdentity(db);
  if (v.status !== 'PASS') throw new Error(`identity invariant FAIL:\n  ${v.hard.slice(0, 20).join('\n  ')}`);
  const integ = db.pragma('integrity_check', { simple: true }); if (integ !== 'ok') throw new Error(`integrity ${integ}`);
  db.exec('COMMIT');
  if (arg('manifest-out')) fs.writeFileSync(path.resolve(arg('manifest-out')), JSON.stringify({ phase: '8B.1A-player-history', fixture_hash: got, manifest }));
  console.log(`\nAPPLIED — ${manifest.length} action(s) (evidence ${plan.evidence.length}, links ${plan.link.length}, prior_programme ${plan.prior.length}); validator ${v.status}; integrity ${integ}.`);
} catch (err) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1); }
db.close();
