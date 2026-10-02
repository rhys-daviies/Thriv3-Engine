/**
 * PROMOTION — Phase 7E. STAGED -> VALIDATED -> REVIEWED (where required) -> PROMOTED.
 *
 * The only code in the refresh architecture that writes canonical tables. Every op:
 *   - comes from a staged observation whose classification is promotable,
 *   - carries an expected-old guard (the target must still hold what the classifier saw),
 *   - is refused if it needs review and has not been APPROVED (or was REJECTED),
 *   - is refused if it touches a frozen season,
 *   - is idempotent (a re-run finds the target already in the new state and no-ops),
 *   - is recorded in a manifest with its old values, which is the revert input.
 * All ops of a batch apply in ONE transaction with integrity_check; any guard failure rolls
 * the whole batch back.
 */
import { PROMOTABLE, personKey } from './changeClassifier.js';
import { isProtected } from './destructivePolicy.js';
import { sha256 } from './staging.js';
import { tableExists, columnsOf } from './context.js';
import { conformRosterRow } from './rosterRowConformance.js';

const NON_WRITING = new Set([null, 'INVESTIGATE_CURRENTNESS', 'INVESTIGATE_MEMBERSHIP', 'INVESTIGATE_DOMAIN', 'REVIEW_ROSTER_FIELDS']);
const COACH_UPDATE_ACTIONS = new Set(['REFRESH_COACH_EVIDENCE', 'UPDATE_COACH_ROLE', 'CONFIRM_OBSERVED_EMAIL', 'ADD_PUBLISHED_EMAIL', 'REPLACE_VERIFIED_EMAIL', 'REINSTATE_COACH', 'MARK_PROVEN_STALE']);
const PERIOD_ACTIONS = new Set(['CHANGE_DIVISION', 'CHANGE_CONFERENCE', 'CHANGE_MEMBERSHIP_STATUS', 'DEACTIVATE_PROGRAMME']);
const PROTECTED_OF = { REPLACE_VERIFIED_EMAIL: 'REPLACE_VERIFIED_EMAIL', MARK_PROVEN_STALE: 'MARK_PROVEN_STALE', CHANGE_DIVISION: 'CHANGE_DIVISION', CHANGE_MEMBERSHIP_STATUS: 'CHANGE_DIVISION', DEACTIVATE_PROGRAMME: 'DEACTIVATE_PROGRAMME', CREATE_PROGRAMME: 'CREATE_PROGRAMME' };
const J = (s) => (s == null ? null : JSON.parse(s));
/** Value equality across SQLite column affinity (TEXT returns '2027', REAL '2027.0', for 2027). */
const same = (a, b) => (a ?? null) === (b ?? null) || (a != null && b != null && (String(a) === String(b) || (a !== '' && b !== '' && !Number.isNaN(Number(a)) && Number(a) === Number(b))));
/** Deterministic canonical id for a row a promotion inserts (idempotent re-runs). */
const insertId = (o) => { const h = sha256(`promote|${o.observation_id}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };

/**
 * Select what a batch would promote. Returns { ops, refused[], skipped{} }.
 * refused = promotable observations that may NOT be written (review missing, protected
 * action without approval ...). skipped counts the non-writing classifications.
 */
export function planPromotion({ batch, observations }, { frozen = new Set() } = {}) {
  const ops = []; const refused = []; const skipped = {};
  for (const o of observations) {
    if (o.promoted_at) { skipped.already_promoted = (skipped.already_promoted || 0) + 1; continue; }
    if (!PROMOTABLE.has(o.classification) || NON_WRITING.has(o.proposed_action)) { skipped[o.classification] = (skipped[o.classification] || 0) + 1; continue; }
    if (o.review_status === 'REJECTED') { refused.push({ id: o.observation_id, why: 'rejected in review' }); continue; }
    const needsReview = o.requires_review === 1 || isProtected(PROTECTED_OF[o.proposed_action] || o.proposed_action);
    if (needsReview && o.review_status !== 'APPROVED') { refused.push({ id: o.observation_id, why: `${o.proposed_action} requires an APPROVED review` }); continue; }
    const p = J(o.proposed_json) || {}; const exp = J(o.expected_old_json) || {};
    const season = o.dataset === 'ROSTER' ? Number(p.season ?? o.observed_season) : null;
    if (season != null && frozen.has(season)) { refused.push({ id: o.observation_id, why: `season ${season} is frozen` }); continue; }
    ops.push({ observation_id: o.observation_id, dataset: o.dataset, action: o.proposed_action || (o.classification === 'CONFIRMED_UNCHANGED' ? 'NOOP' : null), target_key: o.target_key, proposed: p, expected: exp, insert_id: insertId(o) });
  }
  return { ops: ops.filter((x) => x.action && x.action !== 'NOOP'), refused, skipped, batch_id: batch.batch_id };
}

function guardFail(msg) { const e = new Error(msg); e.guard = true; return e; }
const now = () => new Date().toISOString();

/** Apply ONE op inside the caller's transaction. Returns a manifest entry, or {noop:true}.
 *  Exported (Phase 8B.1) for the promotion-readiness simulation, which runs each op under its own SAVEPOINT on a
 *  disposable copy; applyPromotion remains the only path that commits. */
export function applyOp(db, op) {
  const P = op.proposed; const E = op.expected;
  if (op.dataset === 'COACH' && COACH_UPDATE_ACTIONS.has(op.action)) {
    const row = db.prepare('SELECT * FROM coaches WHERE id=?').get(E.id);
    if (!row) throw guardFail(`${op.action} ${E.id}: coach absent`);
    const fields = Object.keys(P).filter((k) => columnsOf(db, 'coaches').has(k));
    if (fields.every((k) => same(row[k], P[k]))) return { noop: true };
    for (const k of ['school', 'email', 'email_status', 'currentness_status', 'position_title']) if (k in E && !same(row[k], E[k])) throw guardFail(`${op.action} ${E.id}: expected-old ${k} mismatch`);
    const old = Object.fromEntries(fields.map((k) => [k, row[k] ?? null]));
    db.prepare(`UPDATE coaches SET ${fields.map((k) => `${k}=@${k}`).join(', ')} WHERE id=@__id`).run({ ...Object.fromEntries(fields.map((k) => [k, P[k] ?? null])), __id: E.id });
    return { kind: 'UPDATE', table: 'coaches', key: { id: E.id }, old, new: Object.fromEntries(fields.map((k) => [k, P[k] ?? null])) };
  }
  if (op.action === 'CREATE_COACH') {
    if (db.prepare('SELECT 1 FROM coaches WHERE id=?').get(op.insert_id)) return { noop: true };
    const schools = E.school_names?.length ? E.school_names : [E.school];
    const held = db.prepare(`SELECT full_name FROM coaches WHERE sport=? AND school IN (${schools.map(() => '?').join(',')})`).all(E.sport, ...schools);
    if (held.some((r) => personKey(r.full_name) === E.name_key)) throw guardFail(`CREATE_COACH ${E.name_key}: a coach with this name now exists at this programme`);
    if (P.email && db.prepare('SELECT 1 FROM coaches WHERE lower(email)=lower(?)').get(P.email)) throw guardFail('CREATE_COACH: address already held');
    const cols = ['id', 'created_at', ...Object.keys(P).filter((k) => columnsOf(db, 'coaches').has(k))];
    const vals = { ...P, id: op.insert_id, created_at: now() };
    db.prepare(`INSERT INTO coaches (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`).run(Object.fromEntries(cols.map((c) => [c, vals[c] ?? null])));
    return { kind: 'INSERT', table: 'coaches', key: { id: op.insert_id }, new: Object.fromEntries(cols.map((c) => [c, vals[c] ?? null])) };
  }
  if (op.action === 'INSERT_ROSTER_ROW') {
    if (db.prepare('SELECT 1 FROM roster_players WHERE id=?').get(op.insert_id)) return { noop: true };
    const held = db.prepare(`SELECT player_name FROM roster_players WHERE sport=? AND season=? AND college_name IN (${E.college_names.map(() => '?').join(',')})`).all(E.sport, E.season, ...E.college_names);
    if (held.some((r) => personKey(r.player_name) === E.name_key)) throw guardFail(`INSERT_ROSTER_ROW ${E.name_key}: player-season now held`);
    const rc = columnsOf(db, 'roster_players');
    // Phase 8B.2: the staged proposal is not shaped like an imported row (see rosterRowConformance.js): minutes would default to 0
    const vals = { ...conformRosterRow(P), id: op.insert_id, created_date: now(), updated_date: now() };
    const cols = Object.keys(vals).filter((c) => rc.has(c));
    db.prepare(`INSERT INTO roster_players (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`).run(Object.fromEntries(cols.map((c) => [c, vals[c] ?? null])));
    return { kind: 'INSERT', table: 'roster_players', key: { id: op.insert_id }, new: Object.fromEntries(cols.map((c) => [c, vals[c] ?? null])) };
  }
  if (op.action === 'FILL_ROSTER_FIELDS') {
    const row = db.prepare('SELECT * FROM roster_players WHERE id=?').get(E.id);
    if (!row) throw guardFail(`FILL_ROSTER_FIELDS ${E.id}: absent`);
    const fields = Object.keys(P);
    if (fields.every((k) => same(row[k], P[k]))) return { noop: true };
    for (const k of fields) if (row[k] != null && row[k] !== '') throw guardFail(`FILL_ROSTER_FIELDS ${E.id}: ${k} is no longer empty — a refresh never overwrites a held value`);
    db.prepare(`UPDATE roster_players SET ${fields.map((k) => `${k}=@${k}`).join(', ')} WHERE id=@__id`).run({ ...P, __id: E.id });
    return { kind: 'UPDATE', table: 'roster_players', key: { id: E.id }, old: Object.fromEntries(fields.map((k) => [k, row[k] ?? null])), new: P };
  }
  if (PERIOD_ACTIONS.has(op.action)) {
    const entries = [];
    const c = db.prepare('SELECT * FROM colleges WHERE id=?').get(E.id);
    if (!c) throw guardFail(`${op.action}: programme ${E.id} absent`);
    const done = op.action === 'DEACTIVATE_PROGRAMME' ? c.active === 0 : (c.division === P.college.division && (c.conference ?? null) === (P.college.conference ?? null));
    const openNew = P.period_ops.find((x) => x.op === 'OPEN_PERIOD');
    const periodThere = openNew && db.prepare('SELECT 1 FROM programme_membership_periods WHERE athletics_entity_id=? AND sport=? AND first_season=?').get(openNew.row.athletics_entity_id, openNew.row.sport, openNew.row.first_season);
    if (done && periodThere) return { noop: true };
    if (op.action === 'DEACTIVATE_PROGRAMME' ? c.active !== 1 : (c.division !== E.division || (c.conference ?? null) !== (E.conference ?? null))) throw guardFail(`${op.action} ${c.name}: expected-old programme state mismatch`);
    for (const po of P.period_ops) {
      if (po.op === 'CLOSE_PERIOD') {
        const [ent, sp, fs] = po.key.split('|');
        const r = db.prepare('UPDATE programme_membership_periods SET last_season=? WHERE athletics_entity_id=? AND sport=? AND first_season=? AND last_season IS NULL').run(po.last_season, ent, sp, Number(fs));
        if (r.changes !== 1) throw guardFail(`${op.action}: open period ${po.key} not found open`);
        entries.push({ kind: 'UPDATE', table: 'programme_membership_periods', key: { athletics_entity_id: ent, sport: sp, first_season: Number(fs) }, old: { last_season: null }, new: { last_season: po.last_season } });
      } else if (po.op === 'OPEN_PERIOD') {
        const row = { ...po.row, recorded_at: now() };
        db.prepare(`INSERT INTO programme_membership_periods (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(',')})`).run(row);
        entries.push({ kind: 'INSERT', table: 'programme_membership_periods', key: { athletics_entity_id: row.athletics_entity_id, sport: row.sport, first_season: row.first_season }, new: row });
      }
    }
    if (op.action === 'DEACTIVATE_PROGRAMME') {
      db.prepare('UPDATE colleges SET active=0 WHERE id=? AND active=1').run(c.id);
      entries.push({ kind: 'UPDATE', table: 'colleges', key: { id: c.id }, old: { active: 1 }, new: { active: 0 } });
    } else {
      db.prepare('UPDATE colleges SET division=?, conference=? WHERE id=?').run(P.college.division, P.college.conference ?? null, c.id);
      entries.push({ kind: 'UPDATE', table: 'colleges', key: { id: c.id }, old: { division: c.division, conference: c.conference ?? null }, new: { division: P.college.division, conference: P.college.conference ?? null } });
    }
    return { kind: 'GROUP', entries };
  }
  if (op.action === 'ASSIGN_DOMAIN' || op.action === 'REFRESH_DOMAIN_CHECK') {
    const row = db.prepare('SELECT * FROM athletics_domains WHERE domain=?').get(E.domain);
    const dc = columnsOf(db, 'athletics_domains');
    if (op.action === 'REFRESH_DOMAIN_CHECK') {
      if (!row || row.status !== E.status) throw guardFail(`REFRESH_DOMAIN_CHECK ${E.domain}: status changed`);
      if (!P.checked_at || row.checked_at === P.checked_at) return { noop: true };
      db.prepare('UPDATE athletics_domains SET checked_at=? WHERE domain=?').run(P.checked_at, E.domain);
      return { kind: 'UPDATE', table: 'athletics_domains', key: { domain: E.domain }, old: { checked_at: row.checked_at }, new: { checked_at: P.checked_at } };
    }
    const fields = { status: P.status, role: P.role, unitid: P.unitid, athletics_entity_id: P.athletics_entity_id, evidence_text: P.evidence_text, final_url: P.final_url, verification_method: 'PHASE7E_REFRESH_OWNERSHIP_CHAIN', confidence: 'CERTAIN', checked_at: now(), ...(dc.has('ownership_class') ? { ownership_class: P.ownership_class } : {}) };
    if (row) {
      if (row.athletics_entity_id === P.athletics_entity_id && row.status === P.status) return { noop: true };
      const held = E.held;
      if (!held || row.status !== held.status || (row.athletics_entity_id ?? null) !== (held.athletics_entity_id ?? null)) throw guardFail(`ASSIGN_DOMAIN ${E.domain}: held row changed since staging`);
      const old = Object.fromEntries(Object.keys(fields).map((k) => [k, row[k] ?? null]));
      db.prepare(`UPDATE athletics_domains SET ${Object.keys(fields).map((k) => `${k}=@${k}`).join(', ')} WHERE domain=@__d`).run({ ...fields, __d: E.domain });
      return { kind: 'UPDATE', table: 'athletics_domains', key: { domain: E.domain }, old, new: fields };
    }
    if (E.held) throw guardFail(`ASSIGN_DOMAIN ${E.domain}: held row disappeared`);
    const ins = { domain: E.domain, claimed_keys: JSON.stringify([]), claimed_unitids: JSON.stringify(P.unitid != null ? [P.unitid] : []), identity_method: 'OWNERSHIP_CHAIN', ...fields };
    db.prepare(`INSERT INTO athletics_domains (${Object.keys(ins).join(',')}) VALUES (${Object.keys(ins).map((k) => `@${k}`).join(',')})`).run(ins);
    return { kind: 'INSERT', table: 'athletics_domains', key: { domain: E.domain }, new: ins };
  }
  if (op.action === 'CREATE_PROGRAMME') {
    if (db.prepare('SELECT 1 FROM colleges WHERE id=?').get(op.insert_id)) return { noop: true };
    if (db.prepare('SELECT 1 FROM colleges WHERE athletics_entity_id=? AND sport=? AND active=1').get(E.entity, E.sport)) throw guardFail(`CREATE_PROGRAMME ${E.entity}/${E.sport}: programme now exists`);
    const ent = db.prepare('SELECT * FROM athletics_entities WHERE athletics_entity_id=?').get(E.entity);
    const row = { id: op.insert_id, created_date: now(), updated_date: now(), name: P.name, sport: P.sport, division: P.division, conference: P.conference ?? null, active: 1, unitid: ent?.federal_unitid ?? ent?.parent_unitid ?? null, athletics_entity_id: E.entity, identity_source: 'PHASE7E_REFRESH', identity_notes: `created by refresh ${op.observation_id}` };
    const cc = columnsOf(db, 'colleges'); const cols = Object.keys(row).filter((k) => cc.has(k));
    db.prepare(`INSERT INTO colleges (${cols.join(',')}) VALUES (${cols.map((k) => `@${k}`).join(',')})`).run(Object.fromEntries(cols.map((k) => [k, row[k]])));
    const period = { athletics_entity_id: E.entity, sport: P.sport, first_season: P.first_season, last_season: null, governing_body: /^NCAA/.test(P.division) ? 'NCAA' : P.division, division: P.division, membership_status: P.membership_status, conference: P.conference ?? null, postseason_eligible: P.postseason_eligible ?? null, college_id: op.insert_id, source_url: null, source_tier: 'A', provenance: `refresh ${op.observation_id}`, review_due_season: null, recorded_at: now() };
    db.prepare(`INSERT INTO programme_membership_periods (${Object.keys(period).join(',')}) VALUES (${Object.keys(period).map((k) => `@${k}`).join(',')})`).run(period);
    return { kind: 'GROUP', entries: [{ kind: 'INSERT', table: 'colleges', key: { id: op.insert_id }, new: row }, { kind: 'INSERT', table: 'programme_membership_periods', key: { athletics_entity_id: E.entity, sport: P.sport, first_season: P.first_season }, new: period }] };
  }
  throw guardFail(`unknown promotion action ${op.action}`);
}

/**
 * Apply planned ops to `db` in one transaction. Returns { applied, noop, manifest }.
 * Never commits a partial batch.
 */
export function applyPromotion(db, plan, { batchHash, gate = null, record = true } = {}) {
  const manifest = []; let applied = 0; let noop = 0;
  const stamp = now();
  db.exec('BEGIN');
  try {
    for (const op of plan.ops) {
      const m = applyOp(db, op);
      if (m.noop) { noop++; continue; }
      applied++;
      manifest.push({ observation_id: op.observation_id, action: op.action, ...(m.kind === 'GROUP' ? { entries: m.entries } : { entries: [m] }) });
    }
    const integ = db.pragma('integrity_check', { simple: true });
    if (integ !== 'ok') throw new Error(`integrity_check: ${integ}`);
    if (record && tableExists(db, 'refresh_promotions')) {
      const pid = `RP-${sha256(`${plan.batch_id}|${batchHash}|${stamp}`).slice(0, 16)}`;
      db.prepare('INSERT INTO refresh_promotions (promotion_id, batch_id, batch_hash, promoted_at, ops_applied, manifest_json, gate_json, status) VALUES (?,?,?,?,?,?,?,?)')
        .run(pid, plan.batch_id, batchHash || '', stamp, applied, JSON.stringify(manifest), JSON.stringify(gate || {}), 'PROMOTED');
      const mark = db.prepare('UPDATE refresh_observations SET promoted_at=? WHERE observation_id=? AND promoted_at IS NULL');
      for (const op of plan.ops) mark.run(stamp, op.observation_id);
      db.prepare("UPDATE refresh_batches SET status='PROMOTED', promoted_at=?, gate_json=? WHERE batch_id=?").run(stamp, JSON.stringify(gate || {}), plan.batch_id);
    }
    db.exec('COMMIT');
    return { applied, noop, manifest, integrity: integ };
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
}

/**
 * Revert a manifest (reverse order). An UPDATE is restored only where the row still holds
 * the promoted value; an INSERT is removed only where the row is still exactly what the
 * promotion inserted (reverting our own insertion is the one deletion a refresh performs).
 */
export function revertManifest(db, manifest, { inTransaction = false } = {}) {
  let reverted = 0; const conflicts = [];
  // inTransaction: the caller owns BEGIN/COMMIT/ROLLBACK (so it can make its own writes atomic with the revert)
  if (!inTransaction) db.exec('BEGIN');
  try {
    for (const m of [...manifest].reverse()) {
      for (const e of [...m.entries].reverse()) {
        const where = Object.keys(e.key).map((k) => `${k}=@__k_${k}`).join(' AND ');
        const keyArgs = Object.fromEntries(Object.entries(e.key).map(([k, v]) => [`__k_${k}`, v]));
        const cur = db.prepare(`SELECT * FROM ${e.table} WHERE ${where}`).get(keyArgs);
        if (e.kind === 'UPDATE') {
          if (!cur || Object.keys(e.new).some((k) => !same(cur[k], e.new[k]))) { conflicts.push(`${e.table} ${JSON.stringify(e.key)} changed after promotion`); continue; }
          db.prepare(`UPDATE ${e.table} SET ${Object.keys(e.old).map((k) => `${k}=@${k}`).join(', ')} WHERE ${where}`).run({ ...e.old, ...keyArgs });
          reverted++;
        } else if (e.kind === 'INSERT') {
          if (!cur) continue;
          const changed = Object.keys(e.new).filter((k) => !['created_at', 'created_date', 'updated_date', 'recorded_at', 'checked_at'].includes(k)).some((k) => !same(cur[k], e.new[k]));
          if (changed) { conflicts.push(`${e.table} ${JSON.stringify(e.key)} edited after promotion — not removed`); continue; }
          db.prepare(`DELETE FROM ${e.table} WHERE ${where}`).run(keyArgs);
          reverted++;
        }
      }
    }
    if (conflicts.length) throw Object.assign(new Error(`revert refused: ${conflicts.length} conflict(s)`), { conflicts });
    if (!inTransaction) db.exec('COMMIT');
    return { reverted };
  } catch (err) {
    if (!inTransaction) { try { db.exec('ROLLBACK'); } catch { /* */ } }
    throw err;
  }
}
