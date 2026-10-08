/**
 * DOMAIN OWNERSHIP CORRECTION — Phase DI-03B. The guarded path for the athletics_domains decisions
 * that protectedCorrection.js deliberately cannot make: moving a decided host to ANOTHER institution,
 * correcting a bare host and its "www." twin together, and promoting a host the 2026-09-01 verifier
 * could not read (INSUFFICIENT_EVIDENCE) once its owner is independently authenticated.
 *
 * protectedCorrection.js stays exactly as it is (WRONG_INSTITUTION -> VERIFIED at the stored UNITID,
 * single rows only). This module is NOT a general UNITID update: every rule below is a refusal.
 *
 * ONE ACTION = ONE HOST FAMILY (the bare host and its www. form). Every row of the family that exists
 * must be in the action — a twin can never be left contradicting the corrected row — and each row
 * declares its operation:
 *   REASSIGN_OWNER   VERIFIED | VERIFIED_ALIAS | WRONG_INSTITUTION at UNITID A  ->  trusted at UNITID B
 *                    (A = previous_owner, B = owner, A != B). B must already be a claimant of the row
 *                    (claimed_unitids): the registry associated the host with B and decided wrongly.
 *                    A is recorded as a refuted claimant in wrong_mappings; any refusal of B is lifted.
 *   RESTORE_OWNER    WRONG_INSTITUTION at the owner's own UNITID -> trusted, refuted claimants kept
 *                    (protectedCorrection's transition, for a host whose twin row exists)
 *   PROMOTE_UNOWNED  INSUFFICIENT_EVIDENCE (no entity; UNITID null or the owner's) -> trusted for B,
 *                    B a claimant of the row
 *   CONFIRM          already trusted for B: pinned, never written (proves the twin agrees)
 *
 * EVERY ACTION NEEDS (none of it may be inferred from a hostname):
 *   - an approval record listing the host;
 *   - expected_old = the COMPLETE current row for every row (any column differing refuses);
 *   - the owner: a SINGLE athletics entity whose federal_unitid is B and under which no campus hangs;
 *   - institution -> host: an IPEDS record for B, and an IPEDS or NCAA-directory record that lists
 *     this exact host (registrable domain) for the owner;
 *   - host -> institution: the host's own page, fetched (https, 200, sha256), landing on the same
 *     site, with the institution named by its self-identification;
 *   - for a family with two rows, or a promotion justified by a verified twin: proof the two forms are
 *     ONE site (both fetches land on the same normalised host and path);
 *   - no unresolved claim: every other claimant of the row is the previous owner or already refuted;
 *   - for a held domain (shared/heldDomainAdjudications.js): a release record for exactly that hold,
 *     with reviewer, reason and the IPEDS + self-identification evidence (holdReleaseProblems). The
 *     release authorises THIS correction only; the code-level hold stays until a reviewed change
 *     lists the release with the applied manifest hash.
 *
 * Only status, unitid, athletics_entity_id, ownership_class, role (only from UNKNOWN/empty),
 * wrong_mappings and notes change. claimed_keys, claimed_unitids and every evidence column
 * (evidence_kind, evidence_text, identity_*, http_status, final_url, verification_method, confidence,
 * checked_at, platform) are preserved byte for byte. The plan is re-read inside the caller's
 * transaction, each UPDATE matches the complete expected row, and the manifest is in the promotion
 * revert format.
 */
import { fixtureHash } from './protectedCorrection.js';
import { normHost, hostOwnershipDisagreements } from './identityResolver.js';
import { loadRefreshContext } from './context.js';
import { isHeldDomain, holdRecord, holdReleaseProblems } from '../../../shared/heldDomainAdjudications.js';

export const DOMAIN_OWNERSHIP_KIND = 'DOMAIN_OWNERSHIP_CORRECTION';
export const OPERATIONS = Object.freeze(['REASSIGN_OWNER', 'RESTORE_OWNER', 'PROMOTE_UNOWNED', 'CONFIRM']);
export const TRUSTED_TARGETS = Object.freeze(['VERIFIED', 'VERIFIED_ALIAS']);
/** The only columns this module may change. */
export const OWNERSHIP_MUTABLE = Object.freeze(['status', 'unitid', 'athletics_entity_id', 'ownership_class', 'role', 'wrong_mappings', 'notes']);
const FROM = Object.freeze({ REASSIGN_OWNER: ['VERIFIED', 'VERIFIED_ALIAS', 'WRONG_INSTITUTION'], RESTORE_OWNER: ['WRONG_INSTITUTION'], PROMOTE_UNOWNED: ['INSUFFICIENT_EVIDENCE'], CONFIRM: TRUSTED_TARGETS });
const ROLES = new Set(['ATHLETICS_SITE', 'INSTITUTION_SITE']);
const HEX64 = /^[0-9a-f]{64}$/;
const REQUIRED = ['action_id', 'approval_id', 'host', 'owner', 'rows', 'evidence', 'reason', 'blast_radius'];

const same = (a, b) => (a ?? null) === (b ?? null);
const parse = (s) => { if (s == null || s === '') return []; try { const v = JSON.parse(s); return Array.isArray(v) ? v : null; } catch { return null; } };
const hostOfUrl = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } };
const pathOfUrl = (u) => { try { return new URL(u).pathname.replace(/\/+$/, '') || '/'; } catch { return null; } };
const registrable = (h) => { const p = String(h || '').toLowerCase().replace(/^www\./, '').split('.'); return p.length > 2 ? p.slice(-2).join('.') : p.join('.'); };

/** A fetch record usable as evidence: https, HTTP 200, sha256, timestamp, final URL. */
function fetchProblems(f, label) {
  if (!f || typeof f !== 'object') return [`${label}: missing`];
  const p = [];
  if (!/^https:\/\//.test(f.url || '')) p.push(`${label}: url must be https`);
  if (!/^https:\/\//.test(f.final_url || '')) p.push(`${label}: final_url must be https`);
  if (Number(f.http_status) !== 200) p.push(`${label}: http_status must be 200 (got ${f.http_status})`);
  if (!HEX64.test(f.sha256 || '')) p.push(`${label}: sha256 required`);
  if (!f.retrieved_at) p.push(`${label}: retrieved_at required`);
  return p;
}

/** Validate the action's evidence for owner B and host. Returns problems. */
function evidenceProblems(a, host, label) {
  const p = []; const ev = a.evidence || {}; const B = Number(a.owner.unitid);
  const ith = Array.isArray(ev.institution_to_host) ? ev.institution_to_host : [];
  const ipeds = ith.filter((r) => r?.source === 'IPEDS' && Number(r.unitid) === B && HEX64.test(r.sha256 || '') && /^https:\/\//.test(r.url || ''));
  if (!ipeds.length) p.push(`${label}: institution_to_host needs the IPEDS record of UNITID ${B} (url + sha256)`);
  const lists = ith.filter((r) => ['IPEDS', 'NCAA_DIRECTORY'].includes(r?.source) && HEX64.test(r.sha256 || '') && (r.source !== 'IPEDS' || Number(r.unitid) === B)
    && (Array.isArray(r.listed_hosts) ? r.listed_hosts : [r.listed_host]).some((h) => h && registrable(h) === registrable(host)));
  if (!lists.length) p.push(`${label}: no IPEDS / NCAA-directory record lists ${host} for the owner — a host is never assigned because its name resembles an institution`);
  const hti = ev.host_to_institution;
  p.push(...fetchProblems(hti, `${label}: host_to_institution`));
  if (hti && normHost(hostOfUrl(hti.final_url)) !== normHost(host)) p.push(`${label}: host_to_institution landed on ${hostOfUrl(hti.final_url)}, not ${host}`);
  if (hti && (!String(hti.self_identification || '').trim() || hti.names_owner !== true)) p.push(`${label}: host_to_institution must record the page's self-identification naming the owner (names_owner: true)`);
  return p;
}

/** Proof that the bare host and its www. form are one site. */
function equivalenceProblems(a, host, label) {
  const eq = a.evidence?.equivalence;
  if (!eq) return [`${label}: two forms of ${host} are involved — evidence.equivalence (bare + www fetches) is required`];
  const p = [...fetchProblems(eq.bare, `${label}: equivalence.bare`), ...fetchProblems(eq.www, `${label}: equivalence.www`)];
  if (p.length) return p;
  if (hostOfUrl(eq.bare.url)?.replace(/^www\./, '') !== host || hostOfUrl(eq.www.url) !== `www.${host}`) p.push(`${label}: equivalence fetches must be https://${host}/ and https://www.${host}/`);
  if (normHost(hostOfUrl(eq.bare.final_url)) !== normHost(host) || normHost(hostOfUrl(eq.www.final_url)) !== normHost(host)) p.push(`${label}: a form of ${host} lands on another host`);
  if (pathOfUrl(eq.bare.final_url) !== pathOfUrl(eq.www.final_url)) p.push(`${label}: the two forms land on different pages (${eq.bare.final_url} vs ${eq.www.final_url})`);
  return p;
}

/**
 * Check every action against the database. Returns { plan, problems }. Never writes.
 * A non-empty `problems` means nothing may be applied — the fixture is all-or-nothing.
 */
export function planDomainOwnership(db, fx) {
  const problems = []; const plan = [];
  if (fx?.kind !== DOMAIN_OWNERSHIP_KIND) return { plan, problems: [`fixture kind must be ${DOMAIN_OWNERSHIP_KIND} (got ${fx?.kind ?? 'none'})`] };
  if (!fx.fixture_hash || fixtureHash(fx) !== fx.fixture_hash) problems.push('fixture_hash does not match the fixture body');
  const actions = Array.isArray(fx.corrections) ? fx.corrections : [];
  if (!actions.length) problems.push('fixture has no corrections');
  const approvals = new Map((Array.isArray(fx.approvals) ? fx.approvals : []).map((x) => [x.approval_id, x]));
  const releases = Array.isArray(fx.hold_releases) ? fx.hold_releases : [];
  const cols = db.prepare('PRAGMA table_info(athletics_domains)').all().map((c) => c.name);
  const seen = new Set();
  for (const a of actions) {
    const label = a?.action_id || a?.host || '?';
    const missing = REQUIRED.filter((k) => a?.[k] == null || a[k] === '');
    if (missing.length) { problems.push(`${label}: missing ${missing.join(', ')}`); continue; }
    const host = normHost(a.host);
    if (!host || host !== String(a.host).toLowerCase()) { problems.push(`${label}: host must be the bare normalised host (got ${a.host})`); continue; }
    if (seen.has(host)) { problems.push(`${label}: ${host} appears twice`); continue; }
    seen.add(host);
    const ap = approvals.get(a.approval_id);
    if (!ap || !ap.approved_by || !ap.approved_at || !ap.basis || !(ap.hosts || []).map(normHost).includes(host)) { problems.push(`${label}: no approval record ${a.approval_id} covering ${host}`); continue; }
    const B = Number(a.owner.unitid); const ent = a.owner.entity;
    if (!Number.isInteger(B) || !ent) { problems.push(`${label}: owner needs unitid and entity`); continue; }
    const e = db.prepare('SELECT * FROM athletics_entities WHERE athletics_entity_id = ?').get(ent);
    if (!e || e.entity_kind !== 'SINGLE' || Number(e.federal_unitid) !== B) { problems.push(`${label}: owner entity ${ent} is not the SINGLE entity of UNITID ${B}`); continue; }
    const owners = db.prepare('SELECT athletics_entity_id FROM athletics_entities WHERE federal_unitid = ? OR parent_unitid = ?').all(B, B).map((x) => x.athletics_entity_id);
    if (owners.length !== 1) { problems.push(`${label}: UNITID ${B} carries ${owners.length} entities — parent/campus ownership is not decided here`); continue; }
    // the family: every existing row for host and www.host, and nothing else
    const family = db.prepare('SELECT * FROM athletics_domains WHERE domain IN (?, ?)').all(host, `www.${host}`);
    const rows = Array.isArray(a.rows) ? a.rows : [];
    const named = rows.map((r) => String(r?.domain || '').toLowerCase());
    if (new Set(named).size !== named.length || named.some((d) => d !== host && d !== `www.${host}`)) { problems.push(`${label}: rows must be ${host} and/or www.${host}, each once`); continue; }
    const absentFromAction = family.filter((r) => !named.includes(r.domain));
    if (absentFromAction.length) { problems.push(`${label}: ${absentFromAction.map((r) => r.domain).join(', ')} exist(s) but is not in the action — a twin may not be left contradicting the correction`); continue; }
    const p0 = problems.length;
    const items = [];
    let reassign = false;
    for (const r of rows) {
      const row = family.find((x) => x.domain === r.domain);
      const rl = `${label} ${r.domain}`;
      if (!row) { problems.push(`${rl}: no athletics_domains row`); continue; }
      if (!OPERATIONS.includes(r.operation)) { problems.push(`${rl}: unknown operation ${r.operation}`); continue; }
      const exp = r.expected_old || {};
      const absent = cols.filter((c) => !(c in exp));
      if (absent.length) { problems.push(`${rl}: expected_old must be the complete row (missing ${absent.join(', ')})`); continue; }
      const diff = cols.filter((c) => !same(row[c], exp[c]));
      if (diff.length) { problems.push(`${rl}: expected-old mismatch on ${diff.join(', ')}`); continue; }
      if (!FROM[r.operation].includes(row.status)) { problems.push(`${rl}: ${r.operation} cannot start from ${row.status}`); continue; }
      const claimed = parse(row.claimed_unitids); const wrong = parse(row.wrong_mappings);
      if (claimed === null || wrong === null) { problems.push(`${rl}: claimed_unitids / wrong_mappings unreadable`); continue; }
      const refuted = new Set(wrong.map((m) => Number(m.claimantUnitid)));
      let newWrong = wrong;
      if (r.operation === 'CONFIRM') {
        if (Number(row.unitid) !== B || (row.athletics_entity_id != null && row.athletics_entity_id !== ent)) { problems.push(`${rl}: CONFIRM needs a row already trusted for UNITID ${B}`); continue; }
        if (r.proposed) { problems.push(`${rl}: CONFIRM never writes (no proposed values)`); continue; }
        items.push({ r, row, set: null }); continue;
      }
      const P = r.proposed || {};
      const extra = Object.keys(P).filter((k) => !['status', 'role'].includes(k));
      if (extra.length) { problems.push(`${rl}: proposed may only name status and role (owner, entity and ownership_class follow from the action); got ${extra.join(', ')}`); continue; }
      if (!TRUSTED_TARGETS.includes(P.status)) { problems.push(`${rl}: target status must be one of ${TRUSTED_TARGETS.join(', ')}`); continue; }
      if (P.role != null && !(ROLES.has(P.role) && (row.role == null || row.role === '' || row.role === 'UNKNOWN'))) { problems.push(`${rl}: role may only be set (to ATHLETICS_SITE / INSTITUTION_SITE) on a row whose role is UNKNOWN`); continue; }
      if (r.operation === 'REASSIGN_OWNER') {
        reassign = true;
        const A = Number(a.previous_owner?.unitid);
        if (!Number.isInteger(A) || row.unitid == null || Number(row.unitid) !== A) { problems.push(`${rl}: previous_owner.unitid must be the row's stored UNITID ${row.unitid}`); continue; }
        if (A === B) { problems.push(`${rl}: previous and new owner are the same UNITID — use RESTORE_OWNER`); continue; }
        if (!claimed.map(Number).includes(B)) { problems.push(`${rl}: UNITID ${B} is not a claimant of this row (claimed_unitids ${row.claimed_unitids}) — reassignment needs a recorded claim`); continue; }
        const prev = db.prepare('SELECT athletics_entity_id, display_name FROM athletics_entities WHERE federal_unitid = ?').get(A);
        if (!prev) { problems.push(`${rl}: previous owner UNITID ${A} has no entity`); continue; }
        newWrong = [...wrong.filter((m) => Number(m.claimantUnitid) !== B), ...(refuted.has(A) ? [] : [{ key: prev.display_name, claimantUnitid: A }])];
        const unresolved = claimed.map(Number).filter((c) => c !== B && c !== A && !refuted.has(c));
        if (unresolved.length) { problems.push(`${rl}: unresolved conflicting claim(s) ${unresolved.join(', ')}`); continue; }
      } else if (r.operation === 'RESTORE_OWNER') {
        if (Number(row.unitid) !== B) { problems.push(`${rl}: RESTORE_OWNER needs the row's stored UNITID to be the owner (${row.unitid} != ${B})`); continue; }
        if (refuted.has(B)) { problems.push(`${rl}: the owner is itself a refuted claimant`); continue; }
        if (!wrong.length) { problems.push(`${rl}: no refuted claimant recorded — this is not a reversal`); continue; }
        const unresolved = claimed.map(Number).filter((c) => c !== B && !refuted.has(c));
        if (unresolved.length) { problems.push(`${rl}: unresolved conflicting claim(s) ${unresolved.join(', ')}`); continue; }
      } else if (r.operation === 'PROMOTE_UNOWNED') {
        if (row.athletics_entity_id != null || (row.unitid != null && Number(row.unitid) !== B)) { problems.push(`${rl}: PROMOTE_UNOWNED needs a row with no entity and no other UNITID`); continue; }
        if (!claimed.map(Number).includes(B)) { problems.push(`${rl}: UNITID ${B} is not a claimant of this row`); continue; }
        const unresolved = claimed.map(Number).filter((c) => c !== B && !refuted.has(c));
        if (unresolved.length) { problems.push(`${rl}: unresolved conflicting claim(s) ${unresolved.join(', ')}`); continue; }
      }
      items.push({ r, row, set: { status: P.status, unitid: B, athletics_entity_id: ent, ownership_class: 'ENTITY_OWNED', role: P.role ?? row.role, wrong_mappings: (newWrong.length || row.wrong_mappings != null) ? JSON.stringify(newWrong) : null } });
    }
    if (problems.length > p0) continue;
    if (reassign && !Number.isInteger(Number(a.previous_owner?.unitid))) { problems.push(`${label}: previous_owner required`); continue; }
    if (!reassign && a.previous_owner) { problems.push(`${label}: previous_owner given but no row is reassigned`); continue; }
    if (!items.some((i) => i.set)) { problems.push(`${label}: nothing to correct`); continue; }
    const ep = evidenceProblems(a, host, label);
    if (items.length > 1 || family.length > 1) ep.push(...equivalenceProblems(a, host, label));
    if (ep.length) { problems.push(...ep); continue; }
    // hold: only an exact, reviewed release of this hold authorises correcting a held host
    const hold = holdRecord(host); const rel = releases.filter((x) => normHost(x?.domain || '') === host);
    if (isHeldDomain(host)) {
      if (!rel.length) { problems.push(`${label}: ${host} is held for external adjudication and the fixture carries no release`); continue; }
      const rp = holdReleaseProblems(rel[0], hold);
      if (rel.length > 1) rp.push('more than one release for the same hold');
      if (Number(rel[0].released_to_unitid) !== B) rp.push(`release settles on ${rel[0].released_to_unitid}, the action on ${B}`);
      if (rel[0].applies_to_action !== a.action_id) rp.push(`release applies_to_action ${rel[0].applies_to_action} is not ${a.action_id}`);
      if (rp.length) { problems.push(...rp.map((x) => `${label}: hold release refused: ${x}`)); continue; }
    } else if (rel.length) { problems.push(`${label}: a release was given for ${host}, which is not held`); continue; }
    // no other row anywhere may name this host for another entity
    const elsewhere = db.prepare('SELECT domain FROM athletics_domains WHERE athletics_entity_id IS NOT NULL AND athletics_entity_id <> ? AND domain IN (?, ?)').all(ent, host, `www.${host}`);
    if (elsewhere.length) { problems.push(`${label}: ${elsewhere.map((x) => x.domain).join(', ')} already name(s) another entity`); continue; }
    plan.push({ action: a, host, owner: { unitid: B, entity: ent }, previous: reassign ? Number(a.previous_owner.unitid) : null, items, held: isHeldDomain(host) });
  }
  if (releases.some((x) => !actions.some((a) => normHost(a?.host || '') === normHost(x?.domain || '')))) problems.push('a hold release does not belong to any action in this fixture');
  return { plan, problems };
}

/** The values a planned row is written with (OWNERSHIP_MUTABLE only). */
function writtenValues(item, { now, fixture_hash, action, held }) {
  const note = `DOMAIN_OWNERSHIP ${action.action_id} ${item.r.operation} @ ${now} (fixture ${String(fixture_hash).slice(0, 12)}, approval ${action.approval_id}): `
    + `${item.row.status}@${item.row.unitid ?? 'none'} -> ${item.set.status}@${item.set.unitid} (${item.set.athletics_entity_id})${held ? '; hold release ' + (action.hold_release_id || 'in fixture') : ''}; ${action.reason}`;
  return { ...item.set, notes: (item.row.notes ? `${item.row.notes} | ${note}` : note).slice(0, 2000) };
}

/**
 * Apply a DOMAIN_OWNERSHIP_CORRECTION inside a transaction the CALLER owns (the composite writer).
 * Refuses outside a transaction; throws on any failure so the caller rolls everything back.
 * Returns { applied, manifest (promotion revert entries), plan }.
 */
export function applyDomainOwnershipInTransaction(db, fx, { now = new Date().toISOString(), postcheck = domainOwnershipPostcheck, onAction = null } = {}) {
  if (!db.inTransaction) throw new Error('applyDomainOwnershipInTransaction needs a caller-owned open transaction');
  const fixture_hash = fixtureHash(fx);
  const { plan, problems } = planDomainOwnership(db, fx);
  if (problems.length) throw Object.assign(new Error(`domain ownership correction refused: ${problems.length} problem(s)`), { problems });
  const cols = db.prepare('PRAGMA table_info(athletics_domains)').all().map((c) => c.name);
  const manifest = []; let applied = 0;
  plan.forEach((p, i) => {
    const entries = [];
    for (const item of p.items) {
      if (!item.set) continue;
      const nu = writtenValues(item, { now, fixture_hash, action: p.action, held: p.held });
      // the UPDATE matches the COMPLETE expected row: any concurrent change makes it miss
      const where = cols.map((c) => `${c} IS @__o_${c}`).join(' AND ');
      const res = db.prepare(`UPDATE athletics_domains SET ${OWNERSHIP_MUTABLE.map((k) => `${k}=@${k}`).join(', ')} WHERE ${where}`)
        .run({ ...nu, ...Object.fromEntries(cols.map((c) => [`__o_${c}`, item.row[c] ?? null])) });
      if (res.changes !== 1) throw new Error(`${p.action.action_id} ${item.row.domain}: row changed during the write`);
      const cur = db.prepare('SELECT * FROM athletics_domains WHERE domain = ?').get(item.row.domain);
      const changed = cols.filter((c) => !same(cur[c], item.row[c]));
      if (changed.some((k) => !OWNERSHIP_MUTABLE.includes(k))) throw new Error(`${item.row.domain}: a non-mutable field changed (${changed.join(', ')})`);
      entries.push({ kind: 'UPDATE', table: 'athletics_domains', key: { domain: item.row.domain }, old: Object.fromEntries(OWNERSHIP_MUTABLE.map((k) => [k, item.row[k] ?? null])), new: nu });
      applied++;
    }
    manifest.push({ observation_id: p.action.action_id, action: DOMAIN_OWNERSHIP_KIND, entries });
    if (onAction) onAction(p, i);
  });
  if (postcheck) postcheck(db, plan);
  return { applied, manifest, plan };
}

/**
 * Ownership postcheck (inside the transaction). For every corrected family:
 *   - not held: the host and www.host are owned by the owner entity through EXACT_HOST and by no one
 *     else, and the previous owner owns neither;
 *   - held (the code-level hold stays until a reviewed release lists the applied manifest): the
 *     resolver must still report HELD — the host lends authority to NO institution — and every row
 *     of the family names the owner;
 * and the resolver reports 0 host-ownership disagreements overall. Throws to refuse.
 */
export function domainOwnershipPostcheck(db, plan) {
  const ctx = loadRefreshContext(db); const r = ctx.resolver;
  const ents = [...new Set(ctx.entities.map((e) => e.athletics_entity_id))];
  const bad = [];
  for (const p of plan) {
    const prevEnt = p.previous != null ? ctx.entities.find((e) => Number(e.federal_unitid) === p.previous)?.athletics_entity_id : null;
    for (const h of [p.host, `www.${p.host}`]) {
      const o = r.ownerOfHost(h);
      if (p.held) {
        if (o.status !== 'HELD') bad.push(`${h}: held host resolves to ${o.entity ?? o.status} — a held host must lend authority to no one`);
      } else {
        if (o.entity !== p.owner.entity || o.via !== 'EXACT_HOST') bad.push(`${h} -> ${o.entity ?? o.status} (${o.via ?? o.reason}), expected ${p.owner.entity}`);
        const others = ents.filter((x) => x !== p.owner.entity && r.hostOwnedBy(h, x));
        if (others.length) bad.push(`${h} also owned by ${others.join(', ')}`);
      }
      if (prevEnt && r.hostOwnedBy(h, prevEnt)) bad.push(`${h} still owned by the previous owner ${prevEnt}`);
    }
    for (const row of db.prepare('SELECT domain, unitid, athletics_entity_id, status FROM athletics_domains WHERE domain IN (?, ?)').all(p.host, `www.${p.host}`)) {
      if (Number(row.unitid) !== p.owner.unitid || !TRUSTED_TARGETS.includes(row.status) || (row.athletics_entity_id != null && row.athletics_entity_id !== p.owner.entity)) bad.push(`${row.domain}: ${row.status}@${row.unitid} (${row.athletics_entity_id ?? 'no entity'}) does not name the owner`);
    }
  }
  const dis = hostOwnershipDisagreements({ resolver: r, domains: ctx.domains, entities: ents });
  if ((dis.length ?? dis) !== 0) bad.push(`host ownership disagreements: ${dis.length ?? dis}`);
  if (bad.length) throw Object.assign(new Error(`domain ownership postcheck failed: ${bad.length}`), { problems: bad });
  return true;
}
