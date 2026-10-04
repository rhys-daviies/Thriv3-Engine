#!/usr/bin/env node
/**
 * PHASE 8B.2 — guarded, fixture-driven NJCAA/USCAA 2026 roster promotion (shared dev only).
 *
 *   node server/scripts/applyPhase8B2RosterPromotion.js --db <path> --fixture <f> --fixture-hash <sha> [--apply --manifest-out <durable f>] [--canonical]
 *   node server/scripts/applyPhase8B2RosterPromotion.js --db <path> --fixture <f> --fixture-hash <sha> --revert-fixture [--apply] [--canonical]
 *   node server/scripts/applyPhase8B2RosterPromotion.js --db <path> --revert <manifest> [--apply] [--canonical]
 *
 * Applies a reviewed, hash-frozen fixture built by buildPhase8B2Fixture from the STAGED batch and the
 * frozen Phase 8B.1A identity engine:
 *   roster_insert   INSERT_ROSTER_ROW through the established guarded applyOp (promotion.js)
 *   link_insert     player_observation_links rows for the new observations (decisions of the engine)
 *   link_update     existing links whose evidence the new observations changed (expected-old checked)
 *   prior_change    roster_players.prior_programme ONLY: new VERIFIED origins, and existing ones the
 *                   engine no longer holds VERIFIED
 * An action whose target already holds the proposed value is a no-op (idempotent); one holding
 * anything else is a conflict and NOTHING is written.
 *
 * PRECONDITIONS (a failure writes nothing):
 *   - the fixture hash matches; the staged batch hash is RECOMPUTED from its rows and equals both the
 *     stored value and the fixture's
 *   - every roster insert is a promotable, unreviewed-or-approved staged observation whose conformed
 *     proposal equals the fixture row, and the staged INSERT set equals the fixture set one-to-one
 *   - a VERIFIED link may only carry an 8B.1A factual evidence class
 *   - --apply needs a durable --manifest-out (not /tmp). The project's corpus guard also applies: a side checkout whose database is a
 *     symlink to the owning checkout's needs --canonical; in the owning checkout (where this is meant to run) it does not
 *
 * ONE transaction. Postconditions, else ROLLBACK:
 *   - exactly the fixture's rows/links/priors changed; every existing roster row is otherwise unchanged
 *   - every inserted row equals the fixture STRICTLY (a stored "2026.0" is not '2026'), carries NULL
 *     minutes/games/starts, a non-NULL position, and the table's nationality/country convention
 *   - exactly the fixture's observations are marked promoted; HELD / CONTRADICTION rows are untouched
 *   - every non-null prior_programme has exactly one VERIFIED, evidenced link (8B.1A invariant)
 *   - all nine PLAYER checks are zero; identity validator PASS; integrity_check ok
 *   - colleges / entities / aliases / domains / source locations / membership periods / row links /
 *     coaches / coach seasons are byte-identical
 * The manifest is written and fsynced BEFORE the commit, in revertManifest format.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { applyOp, planPromotion, revertManifest } from '../lib/refresh/promotion.js';
import { batchHash, loadStagedBatch, stableJson } from '../lib/refresh/staging.js';
import { conformRosterRow } from '../lib/refresh/rosterRowConformance.js';
import { playerHistoryChecks } from '../lib/players/historyMonitor.js';
import { validateEntityIdentity } from './validateAthleticsEntityIdentity.js';
import { assertCanonicalWrite } from '../db/corpusIdentity.js';

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };
const apply = argv.includes('--apply');
const fail = (m, c = 2) => { console.error(m); process.exit(c); };
const dbArg = arg('db'); if (!dbArg) fail('Give --db.');
if (/^\/data\//.test(path.resolve(dbArg))) fail('Refusing production /data path.');
// Reads are free; any WRITE to the shared corpus needs the explicit acknowledgement.
if (apply) assertCanonicalWrite({ script: 'applyPhase8B2RosterPromotion.js', path: path.resolve(dbArg) });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
/** Value equality across SQLite column affinity (a REAL column returns 2026 as '2026.0'), as promotion.js does. */
const same = (a, b) => (a ?? null) === (b ?? null) || (a != null && b != null && (String(a) === String(b) || (a !== '' && b !== '' && !Number.isNaN(Number(a)) && Number(a) === Number(b))));
const strict = (a, b) => (a ?? null) === (b ?? null);
const rowSame = (cur, want, skip = ['recorded_at']) => Object.keys(want).filter((k) => !skip.includes(k)).every((k) => same(cur[k], want[k]));
const rowStrict = (cur, want, skip) => Object.keys(want).filter((k) => !skip.includes(k)).every((k) => strict(cur[k], want[k]));
const ROSTER_SKIP = ['created_date', 'updated_date', 'prior_programme', 'projected_minutes', 'projected_minutes_season'];
const FACTUAL = ['EXPLICIT_PRIOR_SCHOOL', 'MULTI_SIGNAL', 'REVIEWED', 'PROGRAMME_SCOPED'];
const SMALL = ['colleges', 'athletics_entities', 'institution_aliases', 'athletics_domains', 'athletics_source_locations', 'programme_membership_periods', 'programme_row_links', 'coaches', 'coach_seasons'];
const tableHash = (db, t) => { const h = crypto.createHash('sha256'); for (const r of db.prepare(`SELECT * FROM "${t}"`).iterate()) h.update(JSON.stringify(r)).update('\n'); return h.digest('hex'); };
const EPHEMERAL = [os.tmpdir(), fs.realpathSync(os.tmpdir()), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'];
const isEphemeral = (f) => EPHEMERAL.some((d) => f === d || f.startsWith(`${d}${path.sep}`));
const openDb = () => { const d = new Database(dbArg, { fileMustExist: true }); d.pragma('busy_timeout = 30000'); return d; };

function loadFixture() {
  const fx = JSON.parse(fs.readFileSync(path.resolve(arg('fixture') || fail('Give --fixture.')), 'utf8'));
  const { fixture_hash, ...body } = fx; const got = sha(stableJson(body));
  if (got !== fixture_hash || got !== arg('fixture-hash')) fail(`fixture hash mismatch (computed ${got.slice(0, 12)})`, 1);
  if (body.phase !== '8B.2') fail(`not a Phase 8B.2 fixture (${body.phase})`, 1);
  for (const k of ['roster_insert', 'link_insert', 'link_update', 'prior_change', 'held', 'contradiction', 'review']) if (!Array.isArray(body[k])) fail(`fixture is missing the ${k} list`, 1);
  if (!body.inputs?.staged_batch_id || !body.inputs?.staged_batch_hash) fail('fixture names no staged batch', 1);
  for (const k of ['roster_insert', 'link_insert', 'link_update', 'prior_change']) for (const a of body[k]) if (a.reason === undefined) fail(`${k}: missing reason`, 1);
  for (const a of body.roster_insert) for (const f of ['expected_old', 'proposed', 'provenance', 'reason', 'blast_radius', 'classification', 'identity_consequence']) if (a[f] === undefined) fail(`roster_insert ${a.observation_id}: missing ${f}`, 1);
  // a VERIFIED link may only stand on evidence 8B.1A allows to be factual
  for (const a of [...body.link_insert, ...body.link_update]) if (a.proposed.decision === 'VERIFIED_SAME_PERSON' && !FACTUAL.includes(a.proposed.evidence_class)) fail(`link ${a.link_id}: VERIFIED with evidence class ${a.proposed.evidence_class}`, 1);
  return { fx, body, got };
}

// ---------------------------------------------------------------- revert from a manifest (one transaction, audit row included)
if (arg('revert')) {
  const man = JSON.parse(fs.readFileSync(path.resolve(arg('revert')), 'utf8')); const db = openDb();
  console.log(`REVERT ${man.phase}: ${man.manifest.length} group(s)`);
  if (!apply) { console.log('DRY RUN — add --apply.'); process.exit(0); }
  try {
    db.exec('BEGIN');
    const r = revertManifest(db, man.manifest, { inTransaction: true });
    if (man.promotion_id) db.prepare("UPDATE refresh_promotions SET status='REVERTED' WHERE promotion_id=?").run(man.promotion_id);
    const integ = db.pragma('integrity_check', { simple: true }); if (integ !== 'ok') throw new Error(`integrity ${integ}`);
    db.exec('COMMIT'); console.log(`REVERTED ${r.reverted} write(s). Now rebuild the derived materialisation (npm run build:recruiting).`);
  } catch (e) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('ROLLED BACK:', e.message); db.close(); process.exit(1); }
  db.close(); process.exit(0);
}

const { body, got } = loadFixture();
const db = openDb();
const batch = db.prepare('SELECT * FROM refresh_batches WHERE batch_id=?').get(body.inputs.staged_batch_id);
const getRow = db.prepare('SELECT * FROM roster_players WHERE id=?'); const getLink = db.prepare('SELECT * FROM player_observation_links WHERE link_id=?');
const getObs = db.prepare('SELECT observation_id, promoted_at FROM refresh_observations WHERE observation_id=?');

// ---------------------------------------------------------------- revert from the fixture alone
if (argv.includes('--revert-fixture')) {   // a presence flag: arg() would read the next argv and mis-route
  if (argv.includes('--revert')) fail('Give --revert-fixture OR --revert, not both.');
  const del = db.prepare('DELETE FROM roster_players WHERE id=?'); const delL = db.prepare('DELETE FROM player_observation_links WHERE link_id=?');
  const plan = { roster: body.roster_insert.filter((a) => getRow.get(a.roster_id)), links: body.link_insert.filter((a) => getLink.get(a.link_id)) };
  console.log(`REVERT-FROM-FIXTURE ${got.slice(0, 12)}: remove ${plan.roster.length} roster row(s), ${plan.links.length} link(s); restore up to ${body.link_update.length} link(s), ${body.prior_change.length} prior(s)`);
  if (!apply) { console.log('DRY RUN — add --apply.'); process.exit(0); }
  db.exec('BEGIN');
  try {
    const conflicts = []; const isNew = new Set(body.roster_insert.map((r) => r.roster_id));
    for (const a of plan.roster) { if (!rowSame(getRow.get(a.roster_id), a.proposed, ROSTER_SKIP)) conflicts.push(`roster ${a.observation_id} edited since promotion`); }
    for (const a of plan.links) if (!rowSame(getLink.get(a.link_id), a.proposed)) conflicts.push(`link ${a.link_id} edited since promotion`);
    for (const a of body.link_update) { const c = getLink.get(a.link_id); if (!c || !(rowSame(c, a.proposed) || rowSame(c, a.expected_old))) conflicts.push(`link ${a.link_id} edited since promotion`); }
    for (const c of body.prior_change) if (!isNew.has(c.roster_id)) { const cur = getRow.get(c.roster_id); if (!cur || !(same(cur.prior_programme, c.proposed) || same(cur.prior_programme, c.expected_old))) conflicts.push(`prior ${c.roster_id} changed since promotion`); }
    if (conflicts.length) throw new Error(`revert refused: ${conflicts.length} conflict(s), e.g. ${conflicts[0]}`);
    const setP = db.prepare('UPDATE roster_players SET prior_programme=? WHERE id=?'); const upL = (id, r) => { const cols = Object.keys(r).filter((k) => k !== 'link_id'); db.prepare(`UPDATE player_observation_links SET ${cols.map((k) => `${k}=@${k}`).join(', ')} WHERE link_id=@__id`).run({ ...r, __id: id }); };
    for (const a of body.link_update) { const c = getLink.get(a.link_id); if (rowSame(c, a.proposed) && !rowSame(c, a.expected_old)) upL(a.link_id, { ...a.expected_old }); }
    for (const c of body.prior_change) if (!isNew.has(c.roster_id) && getRow.get(c.roster_id)) setP.run(c.expected_old, c.roster_id);
    for (const a of plan.links) delL.run(a.link_id);
    for (const a of plan.roster) del.run(a.roster_id);
    db.prepare('UPDATE refresh_observations SET promoted_at=NULL WHERE batch_id=? AND observation_id IN (' + body.roster_insert.map(() => '?').join(',') + ')').run(body.inputs.staged_batch_id, ...body.roster_insert.map((a) => a.observation_id));
    db.prepare("UPDATE refresh_batches SET status='STAGED', promoted_at=NULL, gate_json=NULL WHERE batch_id=?").run(body.inputs.staged_batch_id);
    db.prepare("UPDATE refresh_promotions SET status='REVERTED' WHERE batch_id=? AND status='PROMOTED'").run(body.inputs.staged_batch_id);
    const integ = db.pragma('integrity_check', { simple: true }); if (integ !== 'ok') throw new Error(`integrity ${integ}`);
    db.exec('COMMIT'); console.log(`REVERTED from fixture; integrity ${integ}. Now rebuild the derived materialisation (npm run build:recruiting).`);
  } catch (e) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('ROLLED BACK:', e.message); db.close(); process.exit(1); }
  db.close(); process.exit(0);
}

// ---------------------------------------------------------------- preconditions
if (!batch) fail(`staged batch ${body.inputs.staged_batch_id} not found`);
const problems = []; const plan = { roster: [], links: [], updates: [], priors: [] }; const noop = { roster: 0, links: 0, updates: 0, priors: 0 };
const promotedAlready = batch.status === 'PROMOTED';
const staged = loadStagedBatch(db, body.inputs.staged_batch_id);
const recomputed = batchHash(staged.observations);
if (recomputed !== batch.batch_hash) problems.push(`staged rows hash ${recomputed.slice(0, 12)} != stored batch hash ${batch.batch_hash.slice(0, 12)} (staging was edited)`);
if (recomputed !== body.inputs.staged_batch_hash) problems.push(`staged batch hash ${recomputed.slice(0, 12)} != fixture ${body.inputs.staged_batch_hash.slice(0, 12)}`);
// what the established planner would promote must be the fixture's insert set, row for row
const freezes = new Set(db.prepare('SELECT season, scope FROM season_freezes').all().filter((f) => f.scope === '*' || f.scope === batch.scope).map((f) => Number(f.season)));
const stagedOps = new Map(planPromotion({ batch: staged.batch, observations: staged.observations }, { frozen: freezes }).ops.filter((o) => o.dataset === 'ROSTER' && o.action === 'INSERT_ROSTER_ROW').map((o) => [o.observation_id, o]));
const fxIds = new Set(body.roster_insert.map((a) => a.observation_id));
if (!promotedAlready) {
  const absentOps = body.roster_insert.filter((a) => !getRow.get(a.roster_id));
  for (const a of absentOps) { const op = stagedOps.get(a.observation_id); if (!op) problems.push(`${a.observation_id}: not a promotable staged INSERT (held, contradicted, reviewed away or already promoted)`); else if (!rowStrict(conformRosterRow(op.proposed), a.proposed, [])) problems.push(`${a.observation_id}: staged proposal (conformed) differs from the fixture row`); }
  if (absentOps.length === body.roster_insert.length) { const extra = [...stagedOps.keys()].filter((k) => !fxIds.has(k)); if (extra.length) problems.push(`${extra.length} promotable staged insert(s) are not in the fixture (e.g. ${extra[0]})`); }
}
for (const a of body.roster_insert) {
  const cur = getRow.get(a.roster_id);
  if (!cur) { if (!getObs.get(a.observation_id)) problems.push(`${a.observation_id}: staged observation missing`); else plan.roster.push(a); }
  else if (rowSame(cur, a.proposed, ROSTER_SKIP)) noop.roster++; else problems.push(`${a.observation_id}: row present with different content`);
}
for (const a of body.link_insert) { const cur = getLink.get(a.link_id); if (!cur) plan.links.push(a); else if (rowSame(cur, a.proposed)) noop.links++; else problems.push(`link ${a.link_id}: present with different content`); }
for (const a of body.link_update) { const cur = getLink.get(a.link_id); if (!cur) problems.push(`link ${a.link_id}: absent`); else if (rowSame(cur, a.proposed)) noop.updates++; else if (rowSame(cur, a.expected_old)) plan.updates.push(a); else problems.push(`link ${a.link_id}: expected-old mismatch`); }
const newIds = new Set(body.roster_insert.map((a) => a.roster_id));
for (const c of body.prior_change) {
  if (newIds.has(c.roster_id) && !getRow.get(c.roster_id)) { plan.priors.push(c); continue; }   // set after the insert
  const cur = getRow.get(c.roster_id); if (!cur) { problems.push(`prior ${c.roster_id}: row missing`); continue; }
  if (same(cur.prior_programme, c.proposed)) noop.priors++; else if (same(cur.prior_programme, c.expected_old)) plan.priors.push(c); else problems.push(`prior ${c.roster_id}: expected-old mismatch (have ${JSON.stringify(cur.prior_programme)})`);
}
console.log(`PHASE ${body.phase} fixture ${got.slice(0, 12)}: roster +${plan.roster.length} (noop ${noop.roster}), links +${plan.links.length} (noop ${noop.links}), link updates ${plan.updates.length} (noop ${noop.updates}), prior changes ${plan.priors.length} (noop ${noop.priors}); held ${body.held.length}, contradiction ${body.contradiction.length}, review ${body.review.length}`);
if (problems.length) { console.error(`REFUSED — ${problems.length} problem(s):\n  ${problems.slice(0, 20).join('\n  ')}`); db.close(); process.exit(1); }
if (!apply) { db.close(); console.log('\nDRY RUN — re-run with --apply to write.'); process.exit(0); }
const manifestOut = arg('manifest-out');
if (!manifestOut) { db.close(); fail('--apply needs --manifest-out <durable file>: the reversal manifest must exist on disk BEFORE the commit.'); }
if (isEphemeral(path.resolve(manifestOut)) && !argv.includes('--allow-ephemeral-manifest')) { db.close(); fail(`--manifest-out ${manifestOut} is under a temp directory; give a durable path (tests only: --allow-ephemeral-manifest).`); }
if (!plan.roster.length && !plan.links.length && !plan.updates.length && !plan.priors.length) { db.close(); console.log('\nNothing to do: already applied (idempotent).'); process.exit(0); }

// ---------------------------------------------------------------- apply
const manifest = []; const put = (label, action, entries) => manifest.push({ observation_id: label, action, entries });
const preSmall = Object.fromEntries(SMALL.filter((t) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)).map((t) => [t, tableHash(db, t)]));
const cols = db.prepare('PRAGMA table_info(roster_players)').all().map((c) => c.name).filter((c) => c !== 'prior_programme');
const preRows = db.prepare('SELECT COUNT(*) n FROM roster_players').get().n;
// pre-existing rows' non-prior columns, hashed over ids that are not new
const hashExisting = () => { const h = crypto.createHash('sha256'); for (const r of db.prepare(`SELECT id, ${cols.map((c) => `"${c}"`).join(',')} FROM roster_players ORDER BY id`).raw().iterate()) { if (newIds.has(r[0])) continue; h.update(JSON.stringify(r)).update('\n'); } return h.digest('hex'); };
const preExisting = hashExisting(); const stamp = now();
const preMarked = db.prepare('SELECT COUNT(*) n FROM refresh_observations WHERE batch_id=? AND promoted_at IS NOT NULL').get(body.inputs.staged_batch_id).n;
try {
  db.exec('BEGIN');
  for (const a of plan.roster) {
    const r = applyOp(db, { dataset: 'ROSTER', action: 'INSERT_ROSTER_ROW', observation_id: a.observation_id, proposed: a.proposed, expected: a.expected_old, insert_id: a.roster_id });
    if (r.noop || r.key.id !== a.roster_id) throw new Error(`${a.observation_id}: unexpected insert result`);
    put(a.observation_id, 'INSERT_ROSTER_ROW', [r]);
  }
  const insL = (row) => db.prepare(`INSERT INTO player_observation_links (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(',')})`).run(row);
  for (const a of plan.links) { const row = { ...a.proposed, recorded_at: stamp }; insL(row); put(a.link_id, 'LINK_INSERT', [{ kind: 'INSERT', table: 'player_observation_links', key: { link_id: a.link_id }, new: row }]); }
  for (const a of plan.updates) {
    const cur = getLink.get(a.link_id); const fields = Object.keys(a.proposed).filter((k) => k !== 'link_id' && !same(cur[k], a.proposed[k]));
    const old = Object.fromEntries(fields.map((k) => [k, cur[k] ?? null])); const nw = Object.fromEntries(fields.map((k) => [k, a.proposed[k] ?? null]));
    if (db.prepare(`UPDATE player_observation_links SET ${fields.map((k) => `${k}=@${k}`).join(', ')} WHERE link_id=@__id`).run({ ...nw, __id: a.link_id }).changes !== 1) throw new Error(a.link_id);
    put(a.link_id, 'LINK_UPDATE', [{ kind: 'UPDATE', table: 'player_observation_links', key: { link_id: a.link_id }, old, new: nw }]);
  }
  const setP = db.prepare('UPDATE roster_players SET prior_programme=? WHERE id=?');
  for (const c of plan.priors) { const cur = getRow.get(c.roster_id); if (setP.run(c.proposed, c.roster_id).changes !== 1) throw new Error(c.roster_id); put(c.roster_id, 'PRIOR_CHANGE', [{ kind: 'UPDATE', table: 'roster_players', key: { id: c.roster_id }, old: { prior_programme: cur.prior_programme ?? null }, new: { prior_programme: c.proposed ?? null } }]); }
  const mark = db.prepare('UPDATE refresh_observations SET promoted_at=? WHERE observation_id=? AND promoted_at IS NULL');
  for (const a of plan.roster) if (mark.run(stamp, a.observation_id).changes === 1) put(a.observation_id, 'STAGING_MARK', [{ kind: 'UPDATE', table: 'refresh_observations', key: { observation_id: a.observation_id }, old: { promoted_at: null }, new: { promoted_at: stamp } }]);
  put(body.inputs.staged_batch_id, 'BATCH_STATUS', [{ kind: 'UPDATE', table: 'refresh_batches', key: { batch_id: body.inputs.staged_batch_id }, old: { status: batch.status, promoted_at: batch.promoted_at ?? null, gate_json: batch.gate_json ?? null }, new: { status: 'PROMOTED', promoted_at: stamp, gate_json: JSON.stringify({ fixture_hash: got }) } }]);
  db.prepare("UPDATE refresh_batches SET status='PROMOTED', promoted_at=?, gate_json=? WHERE batch_id=?").run(stamp, JSON.stringify({ fixture_hash: got }), body.inputs.staged_batch_id);
  const pid = `RP-${sha(`${body.inputs.staged_batch_id}|${got}`).slice(0, 16)}`;
  // the id is deterministic (batch + fixture), so a re-apply after a revert revives the REVERTED audit row rather than colliding with it
  db.prepare("INSERT INTO refresh_promotions (promotion_id, batch_id, batch_hash, promoted_at, ops_applied, manifest_json, gate_json, status) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(promotion_id) DO UPDATE SET promoted_at=excluded.promoted_at, ops_applied=excluded.ops_applied, manifest_json=excluded.manifest_json, gate_json=excluded.gate_json, status='PROMOTED' WHERE refresh_promotions.status='REVERTED'").run(pid, body.inputs.staged_batch_id, batch.batch_hash, stamp, plan.roster.length, JSON.stringify(manifest), JSON.stringify({ fixture_hash: got }), 'PROMOTED');

  // ---- postconditions
  const postRows = db.prepare('SELECT COUNT(*) n FROM roster_players').get().n;
  if (postRows !== preRows + plan.roster.length) throw new Error(`roster rows ${preRows} -> ${postRows}, expected +${plan.roster.length}`);
  if (hashExisting() !== preExisting) throw new Error('an existing roster row changed (other than prior_programme)');
  for (const a of body.roster_insert) {
    const cur = getRow.get(a.roster_id);
    if (!rowStrict(cur, a.proposed, ROSTER_SKIP)) throw new Error(`inserted row ${a.observation_id} differs from the fixture (strict)`);
    if (cur.minutes_played !== null || cur.games_played !== null || cur.games_started !== null) throw new Error(`inserted row ${a.observation_id} carries manufactured performance values`);
    if (cur.position == null) throw new Error(`inserted row ${a.observation_id} has a NULL position (the table sentinel is UNKNOWN)`);
    if (!(cur.nationality === null || cur.nationality === 'USA' || cur.nationality === 'International') || ((cur.nationality === 'International') !== (cur.country != null))) throw new Error(`inserted row ${a.observation_id} breaks the nationality/country convention`);
  }
  for (const [t, h] of Object.entries(preSmall)) if (tableHash(db, t) !== h) throw new Error(`table ${t} changed`);
  const marked = db.prepare('SELECT observation_id FROM refresh_observations WHERE batch_id=? AND promoted_at IS NOT NULL').all(body.inputs.staged_batch_id).map((r) => r.observation_id);
  if (marked.length !== preMarked + plan.roster.length || marked.some((id) => !fxIds.has(id))) throw new Error('promoted marks do not match the fixture (HELD / CONTRADICTION rows must stay staged)');
  const bad = db.prepare(`SELECT r.id FROM roster_players r WHERE r.prior_programme IS NOT NULL
      AND (SELECT COUNT(*) FROM player_observation_links l WHERE l.to_observation_id=r.id AND l.from_programme=r.prior_programme AND l.decision='VERIFIED_SAME_PERSON'
             AND l.evidence_class IN ('EXPLICIT_PRIOR_SCHOOL','MULTI_SIGNAL','REVIEWED','PROGRAMME_SCOPED') AND (l.evidence_class <> 'PROGRAMME_SCOPED' OR r.prior_programme = r.college_name)) <> 1`).all();
  if (bad.length) throw new Error(`${bad.length} factual prior_programme value(s) without exactly one VERIFIED evidenced link (e.g. ${bad[0].id})`);
  const pc = playerHistoryChecks(db).filter((c) => c.list.length); if (pc.length) throw new Error(`player-history checks fired: ${pc.map((c) => `${c.id}=${c.list.length}`).join(', ')}`);
  const v = validateEntityIdentity(db); if (v.status !== 'PASS') throw new Error(`identity invariant FAIL:\n  ${v.hard.slice(0, 20).join('\n  ')}`);
  const integ = db.pragma('integrity_check', { simple: true }); if (integ !== 'ok') throw new Error(`integrity ${integ}`);
  // durable BEFORE the commit: if the commit then fails the manifest only names rows that are absent, which a revert skips
  const f = path.resolve(manifestOut); fs.mkdirSync(path.dirname(f), { recursive: true });
  const fd = fs.openSync(f, 'w'); fs.writeSync(fd, JSON.stringify({ phase: '8B.2-roster-promotion', fixture_hash: got, promotion_id: pid, manifest })); fs.fsyncSync(fd); fs.closeSync(fd);
  db.exec('COMMIT');
  console.log(`\nAPPLIED — roster +${plan.roster.length}, links +${plan.links.length}, link updates ${plan.updates.length}, prior changes ${plan.priors.length}; ${manifest.length} manifest group(s); validator ${v.status}; integrity ${integ}; promotion ${pid}. Now rebuild the derived materialisation (npm run build:recruiting).`);
} catch (err) { try { db.exec('ROLLBACK'); } catch { /* */ } console.error('\nROLLED BACK:', err.message); db.close(); process.exit(1); }
db.close();
