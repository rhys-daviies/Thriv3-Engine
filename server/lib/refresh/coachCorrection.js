/**
 * COACH CORRECTIONS — Phase 8D.3C. Transaction-compatible operations for the two approved coach
 * fixture types, so the composite correction writer can run them inside ONE caller-owned
 * transaction alongside the protected domain correction.
 *
 *   COACH_INSTITUTION_CORRECTION — a coach filed under the wrong programme (a same/near-name
 *     collision at acquisition: "Trinity (TX)" for a @trincoll.edu coach). Moves the FILING only:
 *     coaches.school (+ coaches.division when proposed). Name, email, email_status, source, sport
 *     and title never change; the row is never deleted or re-keyed, so every outreach / tracking
 *     reference keeps pointing at the same coach id.
 *
 *   COACH_CURRENTNESS — a currentness stamp proven against an official staff page. Two groups,
 *     run as separate stages: `withhold_before_A` (-> PROVEN_STALE, fails outreach closed) and
 *     `reinstate_after_B` (PROVEN_STALE -> CURRENT, only once the coach is filed at the institution
 *     whose page proves it). Only the four currentness columns change.
 *
 * Same contract as protectedCorrection.js: the fixture hash is the repo-wide convention
 * (fixtureHash), `expected_old` is checked field by field inside the transaction, every action is
 * all-or-nothing, the manifest is in the promotion revert format (revertManifest restores the exact
 * values and refuses if anything moved since). The *InTransaction functions never BEGIN, COMMIT or
 * ROLLBACK; they throw and the caller rolls back.
 */
import { fixtureHash } from './protectedCorrection.js';
import { normHost } from './identityResolver.js';
import { isHeldDomain } from '../../../shared/heldDomainAdjudications.js';

export const COACH_INSTITUTION_KIND = 'COACH_INSTITUTION_CORRECTION';
export const COACH_CURRENTNESS_KIND = 'COACH_CURRENTNESS';
/** The only coaches columns an institution correction may change. */
export const INSTITUTION_MUTABLE = Object.freeze(['school', 'division']);
/** The only coaches columns a currentness correction may change (the legacy Phase 4B set). */
export const CURRENTNESS_MUTABLE = Object.freeze(['currentness_status', 'currentness_checked_at', 'currentness_source_url', 'currentness_reason']);
/** expected_old must name at least these, so a relabel is pinned to one exact coach identity. */
const INSTITUTION_IDENTITY = ['school', 'sport', 'email', 'email_status'];
export const CURRENTNESS_GROUPS = Object.freeze({
  withhold_before_A: Object.freeze({ to: 'PROVEN_STALE', from: Object.freeze([null, 'UNKNOWN', 'CURRENT']) }),
  reinstate_after_B: Object.freeze({ to: 'CURRENT', from: Object.freeze(['PROVEN_STALE']) }),
});
/** athletics_domains states whose stored UNITID is a page's own self-identification. */
const SELF_IDENTIFIED = ['VERIFIED', 'VERIFIED_ALIAS', 'WRONG_INSTITUTION'];

const same = (a, b) => (a ?? null) === (b ?? null);
const hostOfUrl = (u) => { try { return normHost(new URL(u).hostname); } catch { return null; } };
const coachRow = (db, id) => db.prepare('SELECT * FROM coaches WHERE id = ?').get(id);
const programme = (db, name, sport) => db.prepare('SELECT * FROM colleges WHERE name = ? AND sport = ?').get(name, sport);

function common(fx, kind, actions) {
  const problems = [];
  if (fx?.kind !== kind) problems.push(`fixture kind must be ${kind} (got ${fx?.kind ?? 'none'})`);
  if (!fx?.fixture_hash || fixtureHash(fx) !== fx.fixture_hash) problems.push('fixture_hash does not match the fixture body');
  if (!Array.isArray(actions) || !actions.length) problems.push('no actions');
  const ids = new Set(); const coaches = new Set();
  for (const a of actions || []) {
    if (!a?.action_id || !a?.coach_id) { problems.push(`action without action_id/coach_id: ${JSON.stringify(a).slice(0, 80)}`); continue; }
    if (ids.has(a.action_id)) problems.push(`${a.action_id}: duplicate action_id`); ids.add(a.action_id);
    if (coaches.has(a.coach_id)) problems.push(`${a.action_id}: coach ${a.coach_id} appears twice`); coaches.add(a.coach_id);
    for (const k of ['coach', 'expected_old', 'proposed', 'evidence', 'reason']) if (a[k] == null || a[k] === '') problems.push(`${a.action_id}: missing ${k}`);
  }
  return problems;
}

function checkExpectedOld(row, a, problems) {
  const diff = Object.keys(a.expected_old).filter((k) => !(k in row) || !same(row[k], a.expected_old[k]));
  if (diff.length) problems.push(`${a.action_id}: expected-old mismatch on ${diff.join(', ')}`);
  return !diff.length;
}

/** Plan an institution-correction fixture against `db`. Never writes. */
export function planCoachInstitution(db, fx) {
  const actions = fx?.actions; const problems = common(fx, COACH_INSTITUTION_KIND, actions); const plan = [];
  if (problems.length) return { plan, problems };
  for (const a of actions) {
    const row = coachRow(db, a.coach_id);
    if (!row) { problems.push(`${a.action_id}: coach ${a.coach_id} ABSENT`); continue; }
    if (row.full_name !== a.coach) { problems.push(`${a.action_id}: coach name "${row.full_name}" != "${a.coach}"`); continue; }
    const missing = INSTITUTION_IDENTITY.filter((k) => !(k in a.expected_old));
    if (missing.length) { problems.push(`${a.action_id}: expected_old must pin ${missing.join(', ')}`); continue; }
    if (!checkExpectedOld(row, a, problems)) continue;
    const extra = Object.keys(a.proposed).filter((k) => !INSTITUTION_MUTABLE.includes(k));
    if (extra.length) { problems.push(`${a.action_id}: proposes non-institution field(s) ${extra.join(', ')}`); continue; }
    if (!a.proposed.school || a.proposed.school === row.school) { problems.push(`${a.action_id}: proposed school must differ from the current filing`); continue; }
    const from = programme(db, row.school, row.sport); const to = programme(db, a.proposed.school, row.sport);
    if (!to) { problems.push(`${a.action_id}: no programme "${a.proposed.school}" for ${row.sport}`); continue; }
    if (to.active !== 1) { problems.push(`${a.action_id}: target programme "${to.name}" is not active`); continue; }
    if ('division' in a.proposed && a.proposed.division !== to.division) { problems.push(`${a.action_id}: proposed division ${a.proposed.division} != programme division ${to.division}`); continue; }
    if (from && from.athletics_entity_id && from.athletics_entity_id === to.athletics_entity_id) { problems.push(`${a.action_id}: "${row.school}" and "${to.name}" are the same athletics entity — not an institution correction`); continue; }
    const clash = db.prepare('SELECT id FROM coaches WHERE email = ? AND school = ? AND sport = ? AND id <> ?').get(row.email, to.name, row.sport, row.id);
    if (clash) { problems.push(`${a.action_id}: ${to.name} already has this coach (${clash.id}) — that is a duplicate, not a relabel`); continue; }
    const set = Object.fromEntries(Object.keys(a.proposed).map((k) => [k, a.proposed[k]]));
    plan.push({ action: a, row, set, target: to });
  }
  return { plan, problems };
}

/** Plan one currentness group (`withhold_before_A` | `reinstate_after_B`) against `db`. Never writes. */
export function planCoachCurrentness(db, fx, group, { now = new Date().toISOString() } = {}) {
  const rule = CURRENTNESS_GROUPS[group];
  if (!rule) return { plan: [], problems: [`unknown currentness group ${group}`] };
  const actions = fx?.[group]; const problems = common(fx, COACH_CURRENTNESS_KIND, actions); const plan = [];
  // a coach may not be both withheld and reinstated by one fixture
  const both = (fx?.withhold_before_A || []).map((a) => a.coach_id).filter((id) => (fx?.reinstate_after_B || []).some((b) => b.coach_id === id));
  if (both.length) problems.push(`coach(es) in both currentness groups: ${both.join(', ')}`);
  if (problems.length) return { plan, problems };
  for (const a of actions) {
    const row = coachRow(db, a.coach_id);
    if (!row) { problems.push(`${a.action_id}: coach ${a.coach_id} ABSENT`); continue; }
    if (row.full_name !== a.coach) { problems.push(`${a.action_id}: coach name "${row.full_name}" != "${a.coach}"`); continue; }
    if (!('currentness_status' in a.expected_old)) { problems.push(`${a.action_id}: expected_old must pin currentness_status`); continue; }
    if (!checkExpectedOld(row, a, problems)) continue;
    const extra = Object.keys(a.proposed).filter((k) => !CURRENTNESS_MUTABLE.includes(k));
    if (extra.length) { problems.push(`${a.action_id}: proposes non-currentness field(s) ${extra.join(', ')}`); continue; }
    const p = a.proposed;
    if (p.currentness_status !== rule.to) { problems.push(`${a.action_id}: ${group} may only set ${rule.to} (got ${p.currentness_status})`); continue; }
    if (!rule.from.some((f) => same(f, row.currentness_status))) { problems.push(`${a.action_id}: ${row.currentness_status ?? 'null'} -> ${rule.to} is not an allowed ${group} transition`); continue; }
    const host = hostOfUrl(p.currentness_source_url);
    if (!host || !/^https:\/\//.test(p.currentness_source_url)) { problems.push(`${a.action_id}: currentness_source_url must be an https official page`); continue; }
    if (!p.currentness_reason) { problems.push(`${a.action_id}: currentness_reason is required`); continue; }
    if (rule.to === 'CURRENT') {
      // Reinstatement fails OPEN, so the page that proves it must be the coach's OWN institution's
      // page as the coach is filed NOW: the host's stored self-identification (athletics_domains
      // UNITID, bare or www) must equal the filed programme's UNITID. This is the check whose absence
      // let a Southwestern (KS) page mark a Southwestern (TX) coach stale.
      const prog = programme(db, row.school, row.sport);
      if (!prog || prog.active !== 1) { problems.push(`${a.action_id}: filed programme "${row.school}" missing or inactive`); continue; }
      if (isHeldDomain(host)) { problems.push(`${a.action_id}: ${host} is under external adjudication`); continue; }
      const d = db.prepare('SELECT domain, unitid, status FROM athletics_domains WHERE domain IN (?, ?)').all(host, host.replace(/^www\./, ''));
      const ok = d.some((x) => SELF_IDENTIFIED.includes(x.status) && x.unitid != null && Number(x.unitid) === Number(prog.unitid));
      if (!ok) { problems.push(`${a.action_id}: ${host} does not self-identify as ${prog.name} (UNITID ${prog.unitid}) — reinstatement needs the coach's own institution's page`); continue; }
    }
    const set = { currentness_status: p.currentness_status, currentness_checked_at: now, currentness_source_url: p.currentness_source_url,
      currentness_reason: `${p.currentness_reason} [${a.action_id}, fixture ${String(fx.fixture_hash).slice(0, 12)}]` };
    plan.push({ action: a, row, set });
  }
  return { plan, problems };
}

function writePlan(db, plan, mutable, label, onAction) {
  const manifest = [];
  plan.forEach((p, i) => {
    const cols = Object.keys(p.set);
    const guard = cols.map((k) => (p.row[k] == null ? `${k} IS NULL` : `${k} = @__old_${k}`)).join(' AND ');
    const args = { ...p.set, __id: p.row.id, ...Object.fromEntries(cols.map((k) => [`__old_${k}`, p.row[k]])) };
    const res = db.prepare(`UPDATE coaches SET ${cols.map((k) => `${k}=@${k}`).join(', ')} WHERE id=@__id AND ${guard}`).run(args);
    if (res.changes !== 1) throw new Error(`${p.action.action_id}: coach row changed during the write`);
    manifest.push({ observation_id: p.action.action_id, action: label, entries: [{ kind: 'UPDATE', table: 'coaches', key: { id: p.row.id }, old: Object.fromEntries(cols.map((k) => [k, p.row[k] ?? null])), new: p.set }] });
    if (onAction) onAction(p, i);
  });
  for (const p of plan) {
    const cur = coachRow(db, p.row.id);
    const changed = Object.keys(cur).filter((k) => !same(cur[k], p.row[k]));
    if (changed.some((k) => !mutable.includes(k))) throw new Error(`${p.action.action_id}: a non-mutable coaches field changed (${changed.join(', ')})`);
  }
  return manifest;
}

/** Apply an institution-correction fixture inside a caller-owned transaction. Throws to refuse. */
export function applyCoachInstitutionInTransaction(db, fx, { onAction = null } = {}) {
  if (!db.inTransaction) throw new Error('applyCoachInstitutionInTransaction needs a caller-owned open transaction');
  const { plan, problems } = planCoachInstitution(db, fx);
  if (problems.length) throw Object.assign(new Error(`coach institution correction refused: ${problems.length} problem(s)`), { problems });
  return { applied: plan.length, plan, manifest: writePlan(db, plan, INSTITUTION_MUTABLE, COACH_INSTITUTION_KIND, onAction) };
}

/** Apply one currentness group inside a caller-owned transaction. Throws to refuse. */
export function applyCoachCurrentnessInTransaction(db, fx, group, { now = new Date().toISOString(), onAction = null } = {}) {
  if (!db.inTransaction) throw new Error('applyCoachCurrentnessInTransaction needs a caller-owned open transaction');
  const { plan, problems } = planCoachCurrentness(db, fx, group, { now });
  if (problems.length) throw Object.assign(new Error(`coach currentness (${group}) refused: ${problems.length} problem(s)`), { problems });
  return { applied: plan.length, plan, manifest: writePlan(db, plan, CURRENTNESS_MUTABLE, `${COACH_CURRENTNESS_KIND}:${group}`, onAction) };
}
