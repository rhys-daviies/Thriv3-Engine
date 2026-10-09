/**
 * DOMAIN OWNERSHIP CORRECTION — Phase DI-03B, hardened in DI-03D after the DI-03C review.
 * The guarded path for the athletics_domains decisions protectedCorrection.js deliberately cannot
 * make: moving a decided host to ANOTHER institution, correcting a bare host and its "www." twin
 * together, and promoting a host the 2026-09-01 verifier could not read (INSUFFICIENT_EVIDENCE) once
 * its owner is independently authenticated.
 *
 * protectedCorrection.js stays exactly as it is. This module is NOT a general UNITID update: every
 * rule below is a refusal.
 *
 * ONE ACTION = ONE HOST FAMILY: every athletics_domains row whose NORMALISED host (lower case,
 * trimmed, trailing dot and leading www. removed) is the action's host. A family row spelled any way
 * other than exactly `host` or `www.host` refuses (an ambiguous variant is never silently corrected,
 * merged or discarded). Every family row must be in the action and declares its operation:
 *   REASSIGN_OWNER   VERIFIED | VERIFIED_ALIAS | WRONG_INSTITUTION at A  ->  trusted at B (A != B). B must
 *                    already be a claimant of the row; A is recorded as refuted; B's refusal is lifted.
 *   RESTORE_OWNER    WRONG_INSTITUTION at the owner's own UNITID -> trusted, refuted claimants kept
 *   PROMOTE_UNOWNED  INSUFFICIENT_EVIDENCE (no entity; UNITID null or B) -> trusted for B, B a claimant
 *   CONFIRM          already trusted for B: pinned, never written
 *
 * EVIDENCE IS NEVER A DECLARATION (officialEvidence.js). An action names registered official sources
 * and page fetches by sha256; the engine reads the bytes from the evidence store, re-hashes them and
 * derives, itself:
 *   - the owner's IPEDS record (B must be in it) and, if an NCAA directory org is named, that the org
 *     is the owner's (same state, an official website host in common) and is for the current year;
 *   - that an official record lists EXACTLY this host (normalised host equality — never a suffix or
 *     registrable-domain match) for the owner; shared hosting platforms are refused;
 *   - that NO other institution's official record lists this host — in EVERY registered source of the
 *     cited scope, cited or not (DI-03F); only a signed contradiction_resolution settles one;
 *   - that the host's own page (https, 200, landing on this host, within MAX_EVIDENCE_DAYS) names the
 *     owner more specifically than any rival (the previous owner, every other claimant) — and, for a
 *     REASSIGN, carries the owner's city and state;
 *   - for a two-row family, that both forms land on the same host and page (identical bodies or an
 *     identical final URL).
 *
 * A HELD domain (shared/heldDomainAdjudications.js) is corrected only with a release bound to the exact
 * hold, to this action, to the verified self-identification page and official sources this action
 * used, and (checked by compositeCorrection) to the composite approval and an authorised reviewer.
 * The code-level hold stays until a committed manifest proves the correction (heldDomainAdjudications).
 *
 * Only status, unitid, athletics_entity_id, ownership_class, role (only from UNKNOWN/empty),
 * wrong_mappings, confidence / verification_method / checked_at (the new decision, DI-03F F12) and notes
 * change; every evidence column is preserved. The plan is re-read inside the
 * caller's transaction, each UPDATE matches the complete expected row, and the manifest is in the
 * promotion revert format.
 */
import { fixtureHash } from './protectedCorrection.js';
import { normHost, hostOwnershipDisagreements, SHARED_PLATFORM_ROOT } from './identityResolver.js';
import { loadRefreshContext } from './context.js';
import { cycleOf } from './freshness.js';
import { officialSource, registeredSources, pageText, nameScore, locatedAt, MAX_EVIDENCE_DAYS } from './officialEvidence.js';
import { isHeldDomain, holdRecord, holdReleaseProblems } from '../../../shared/heldDomainAdjudications.js';
import { isGrant, asInstant } from './approvalValidator.js';
import { classifyDatabase } from './correctionTarget.js';

export const DOMAIN_OWNERSHIP_KIND = 'DOMAIN_OWNERSHIP_CORRECTION';
export const OPERATIONS = Object.freeze(['REASSIGN_OWNER', 'RESTORE_OWNER', 'PROMOTE_UNOWNED', 'CONFIRM']);
export const TRUSTED_TARGETS = Object.freeze(['VERIFIED', 'VERIFIED_ALIAS']);
/**
 * The only columns this module may change. DI-03F (F12): a corrected row carries the CURRENT decision —
 * confidence CORROBORATED (owner listed by a pinned official source + the host's own page, the
 * standard of OFFICIAL_DIRECTORY_AND_PAGE_SELF_IDENTIFICATION), verification_method
 * DOMAIN_OWNERSHIP_CORRECTION and checked_at = the commit instant — instead of keeping the confidence
 * of the decision it overturns. The HISTORICAL evidence (evidence_kind, evidence_text, identity_*,
 * platform, http_status, final_url, claimed_*) is never touched; the historical decision (previous
 * status, owner, confidence, method, checked_at) is kept in the ledger manifest and summarised in notes.
 */
export const OWNERSHIP_MUTABLE = Object.freeze(['status', 'unitid', 'athletics_entity_id', 'ownership_class', 'role', 'wrong_mappings', 'confidence', 'verification_method', 'checked_at', 'notes']);
export const CORRECTED_CONFIDENCE = 'CORROBORATED';
export const CORRECTION_METHOD = 'DOMAIN_OWNERSHIP_CORRECTION';
const FROM = Object.freeze({ REASSIGN_OWNER: ['VERIFIED', 'VERIFIED_ALIAS', 'WRONG_INSTITUTION'], RESTORE_OWNER: ['WRONG_INSTITUTION'], PROMOTE_UNOWNED: ['INSUFFICIENT_EVIDENCE'], CONFIRM: TRUSTED_TARGETS });
const ROLES = new Set(['ATHLETICS_SITE', 'INSTITUTION_SITE']);
const HEX64 = /^[0-9a-f]{64}$/;
const REQUIRED = ['action_id', 'approval_id', 'host', 'owner', 'rows', 'evidence', 'reason', 'blast_radius'];

const same = (a, b) => (a ?? null) === (b ?? null);
const parse = (s) => { if (s == null || s === '') return []; try { const v = JSON.parse(s); return Array.isArray(v) ? v : null; } catch { return null; } };
const hostOfUrl = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } };
const pathOfUrl = (u) => { try { return new URL(u).pathname.replace(/\/+$/, '') || '/'; } catch { return null; } };
/** A canonical spelling: what normHost would produce, with or without a single leading "www.". */
const canonicalSpelling = (d, host) => d === host || d === `www.${host}`;

/**
 * A page fetch usable as evidence: https, HTTP 200, on this host, dated within the window, bytes in the
 * store. -> { problems, bytes }. Never writes into the fixture (its hash must keep reproducing).
 */
function fetchProblems(f, host, label, { store, now }) {
  if (!f || typeof f !== 'object') return { problems: [`${label}: missing`], bytes: null };
  const p = []; let bytes = null;
  if (!/^https:\/\//.test(f.url || '') || normHost(hostOfUrl(f.url)) !== host) p.push(`${label}: url must be https on ${host}`);
  if (!/^https:\/\//.test(f.final_url || '') || normHost(hostOfUrl(f.final_url)) !== host) p.push(`${label}: landed on ${hostOfUrl(f.final_url)}, not ${host}`);
  if (Number(f.http_status) !== 200) p.push(`${label}: http_status must be 200 (got ${f.http_status})`);
  const d = new Date(String(f.retrieved_at ?? '')); const age = (now.getTime() - d.getTime()) / 86_400_000;
  if (Number.isNaN(d.getTime()) || age < -1 || age > MAX_EVIDENCE_DAYS) p.push(`${label}: retrieved_at ${f.retrieved_at} is not within ${MAX_EVIDENCE_DAYS} days`);
  if (!HEX64.test(f.sha256 || '')) p.push(`${label}: sha256 required`);
  else { try { bytes = store.read(f.sha256); } catch (e) { p.push(`${label}: ${e.message}`); } }
  return { problems: p, bytes };
}

/** Names an entity / UNITID goes by in the database (entity display name, programme names). */
function dbNames(db, unitid) {
  return [
    ...db.prepare('SELECT display_name FROM athletics_entities WHERE federal_unitid = ?').all(unitid).map((r) => r.display_name),
    ...db.prepare('SELECT DISTINCT name FROM colleges WHERE unitid = ?').all(unitid).map((r) => r.name),
  ].filter(Boolean);
}

/**
 * Derive and check the action's evidence. Returns { problems, derived }.
 * `rivals`: UNITIDs whose names the page must NOT match as specifically as the owner's.
 */
function evidenceProblems(db, a, host, label, { store, target, now, rivals, requireLocation, needEquivalence, resolutions = [] }) {
  const p = []; const derived = { listed_by: [], official: [], sources: [], pages: [], contradictions: [] }; const ev = a.evidence || {};
  const B = Number(a.owner.unitid);
  if (SHARED_PLATFORM_ROOT.test(host)) return { problems: [`${label}: ${host} is a shared hosting platform — it can never identify an institution`], derived };
  const refs = Array.isArray(ev.official) ? ev.official : [];
  let ipeds = null; let ipedsSrc = null; const orgs = [];
  for (const r of refs) {
    let src; try { src = officialSource(r?.source_id, store, { target, now }); } catch (e) { p.push(`${label}: ${e.message}`); continue; }
    derived.official.push(r.source_id); derived.sources.push({ source_id: r.source_id, sha256: src.entry.sha256, scope: src.entry.scope });
    if (src.kind === 'IPEDS_HD') { ipedsSrc = src; ipeds = src.data.byUnitid.get(B) || null; if (!ipeds) p.push(`${label}: UNITID ${B} is not in ${r.source_id}`); }
    if (src.kind === 'NCAA_DIRECTORY_MEMBERLIST') {
      const o = src.data.byOrg.get(r.org_id);
      if (!o) { p.push(`${label}: NCAA org ${r.org_id} is not in ${r.source_id}`); continue; }
      const want = src.entry.academic_year ?? (cycleOf(now) + 1);
      if (Number(o.academic_year) !== Number(want) || Number(want) !== cycleOf(now) + 1) p.push(`${label}: NCAA org ${r.org_id} is for academic year ${o.academic_year}, not the current ${cycleOf(now) + 1}`);
      orgs.push({ src, o });
    }
  }
  if (!ipedsSrc) p.push(`${label}: the owner's IPEDS record (a registered IPEDS source) is required`);
  if (p.length) return { problems: p, derived };
  // an NCAA org is the owner's only if it is in the owner's state and shares an official website host
  for (const { o } of orgs) {
    if (o.state !== ipeds.state || !o.web_hosts.some((h) => ipeds.hosts.includes(h))) p.push(`${label}: NCAA org ${o.org_id} (${o.name}, ${o.state}) is not bound to UNITID ${B} (${ipeds.name}, ${ipeds.state}) by state and website`);
  }
  if (p.length) return { problems: p, derived };
  // institution -> host: an official record lists EXACTLY this host for the owner
  if (ipeds.hosts.includes(host)) derived.listed_by.push(`IPEDS ${B}`);
  for (const { o } of orgs) if ([...o.web_hosts, ...o.athletic_hosts].includes(host)) derived.listed_by.push(`NCAA org ${o.org_id}`);
  if (!derived.listed_by.length) p.push(`${label}: no official record lists ${host} for UNITID ${B} (exact host; IPEDS lists ${ipeds.hosts.join(', ') || 'none'}${orgs.length ? `; NCAA lists ${orgs.flatMap(({ o }) => [...o.web_hosts, ...o.athletic_hosts]).join(', ')}` : ''})`);
  // no other institution's official record lists the host — searched in EVERY registered source of the
  // cited scope, not only the cited ones (DI-03E MAJOR-4: ewu.edu). A contradiction stands unless the
  // signed approval resolves exactly it (contradiction_resolutions: { host, source_id, claimant }).
  const scopes = [...new Set(derived.sources.map((x) => x.scope))];
  if (scopes.length !== 1) p.push(`${label}: cited official sources must share one registry scope (got ${scopes.join(', ')})`);
  else {
    const fam = registeredSources(scopes[0], store, { target, now });
    p.push(...fam.problems.map((x) => `${label}: ${x}`));
    for (const src of fam.sources) {
      for (const u of src.kind === 'IPEDS_HD' ? [...(src.data.byHost.get(host) || [])].filter((x) => x !== B) : []) derived.contradictions.push({ source_id: src.entry.source_id, claimant: `UNITID:${u}`, name: src.data.byUnitid.get(u)?.name });
      if (src.kind === 'NCAA_DIRECTORY_MEMBERLIST') {
        for (const org of [...(src.data.byHost.get(host) || [])]) {
          const o = src.data.byOrg.get(org);
          const bound = o && o.state === ipeds.state && o.web_hosts.some((h) => ipeds.hosts.includes(h));
          if (!bound) derived.contradictions.push({ source_id: src.entry.source_id, claimant: `ORG:${org}`, name: o?.name });
        }
      }
    }
    for (const c of derived.contradictions) {
      const ok = resolutions.some((r) => normHost(r?.host || '') === host && r.source_id === c.source_id && r.claimant === c.claimant);
      if (!ok) p.push(`${label}: ${c.source_id} also lists ${host} for ${c.claimant} (${c.name ?? '?'}) — unresolved contradictory evidence (only a signed contradiction_resolution for exactly this claim settles it)`);
    }
  }
  // host -> institution: the page names the owner more specifically than any rival
  const hti = ev.host_to_institution;
  const hf = fetchProblems(hti, host, `${label}: host_to_institution`, { store, now });
  p.push(...hf.problems);
  if (hti?.sha256) derived.pages.push(hti.sha256);
  if (!hf.problems.length && hf.bytes) {
    const pg = pageText(hf.bytes);
    const ownerNames = [ipeds.name, ...ipeds.aliases, ...orgs.map(({ o }) => o.name), ...dbNames(db, B)];
    const rivalNames = rivals.flatMap((u) => [ipedsSrc.data.byUnitid.get(u)?.name, ...(ipedsSrc.data.byUnitid.get(u)?.aliases || []), ...dbNames(db, u)]).filter(Boolean);
    const head = `${pg.title} | ${pg.og}`;
    const tier = nameScore(head, ownerNames) ? head : `${head} | ${pg.text}`;
    const own = nameScore(tier, ownerNames); const riv = rivalNames.length ? nameScore(tier, rivalNames) : 0;
    derived.self_identification = { title: pg.title.slice(0, 160), owner_score: own, rival_score: riv };
    if (!own) p.push(`${label}: the page does not name the owner (${ipeds.name})`);
    else if (riv >= own) p.push(`${label}: the page names a rival institution at least as specifically as the owner (owner ${own}, rival ${riv})`);
    if (requireLocation) {
      // the owner's place: shown on the page, OR an official record bound to the owner lists this exact host
      // in the owner's state while every rival institution is in another state (a structured venue in a
      // script is not read — only visible text or the official sources count)
      const shown = locatedAt(`${head} ${pg.text}`, ipeds);
      const rivalStates = rivals.map((u) => ipedsSrc.data.byUnitid.get(u)?.state ?? null);
      const officiallyPlaced = derived.listed_by.length > 0 && rivalStates.every((st) => st && st !== ipeds.state);
      derived.location = shown ? `shown on the page: ${ipeds.city}, ${ipeds.state}` : officiallyPlaced ? `official listing in ${ipeds.state}; rivals in ${[...new Set(rivalStates)].join(', ')}` : null;
      if (!derived.location) p.push(`${label}: a reassignment needs the owner's location (${ipeds.city}, ${ipeds.state}) shown on the page, or an official listing that separates it from every rival by state`);
    }
  }
  if (needEquivalence) {
    const eq = ev.equivalence;
    if (!eq) p.push(`${label}: two forms of ${host} are involved — evidence.equivalence (bare + www fetches) is required`);
    else {
      const ep = [...fetchProblems(eq.bare, host, `${label}: equivalence.bare`, { store, now }).problems, ...fetchProblems(eq.www, host, `${label}: equivalence.www`, { store, now }).problems];
      derived.pages.push(...[eq.bare?.sha256, eq.www?.sha256].filter(Boolean));
      if (!ep.length) {
        if (hostOfUrl(eq.bare.url) !== host || hostOfUrl(eq.www.url) !== `www.${host}`) ep.push(`${label}: equivalence fetches must be https://${host}/ and https://www.${host}/`);
        if (pathOfUrl(eq.bare.final_url) !== pathOfUrl(eq.www.final_url)) ep.push(`${label}: the two forms land on different pages`);
        if (eq.bare.sha256 !== eq.www.sha256 && eq.bare.final_url !== eq.www.final_url) ep.push(`${label}: the two forms neither serve identical bytes nor redirect to one URL`);
      }
      p.push(...ep);
    }
  }
  return { problems: p, derived };
}

/**
 * Check every action against the database and the evidence store. Returns { plan, problems }.
 * Never writes. `ctx`: { store (evidenceStore), target (the database class: PRODUCTION | SHARED_DEV |
 * DISPOSABLE), now, approvalId (the signed composite approval every fixture approval and release must
 * name), resolutions (the signed approval's contradiction_resolutions) }.
 */
export function planDomainOwnership(db, fx, { store = null, target = null, now = new Date(), approvalId = null, resolutions = [] } = {}) {
  const problems = []; const plan = [];
  const n = asInstant(now);
  if (fx?.kind !== DOMAIN_OWNERSHIP_KIND) return { plan, problems: [`fixture kind must be ${DOMAIN_OWNERSHIP_KIND} (got ${fx?.kind ?? 'none'})`] };
  if (!fx.fixture_hash || fixtureHash(fx) !== fx.fixture_hash) problems.push('fixture_hash does not match the fixture body');
  if (!store) problems.push('an evidence store is required (evidence is read and verified, never declared)');
  if (!['PRODUCTION', 'SHARED_DEV', 'DISPOSABLE'].includes(target)) problems.push('the correction target class (PRODUCTION | SHARED_DEV | DISPOSABLE) is required');
  if (problems.length) return { plan, problems };
  const actions = Array.isArray(fx.corrections) ? fx.corrections : [];
  if (!actions.length) problems.push('fixture has no corrections');
  const approvals = Array.isArray(fx.approvals) ? fx.approvals : [];
  // an approval's scope is exactly the hosts of the actions that cite it
  for (const ap of approvals) {
    if (approvalId && ap?.approval_id !== approvalId) problems.push(`fixture approval ${ap?.approval_id} is not the signed composite approval ${approvalId} — one approval id end to end`);
    const cited = actions.filter((a) => a?.approval_id === ap?.approval_id).map((a) => normHost(a.host)).sort();
    const listed = (ap?.hosts || []).map(normHost).sort();
    if (cited.join(',') !== listed.join(',')) problems.push(`approval ${ap?.approval_id}: hosts ${listed.join(', ')} are not exactly the hosts of the actions it authorises (${cited.join(', ') || 'none'})`);
  }
  const releases = Array.isArray(fx.hold_releases) ? fx.hold_releases : [];
  const cols = db.prepare('PRAGMA table_info(athletics_domains)').all().map((c) => c.name);
  const allDomains = db.prepare('SELECT * FROM athletics_domains').all();
  const seen = new Set();
  for (const a of actions) {
    const label = a?.action_id || a?.host || '?';
    const missing = REQUIRED.filter((k) => a?.[k] == null || a[k] === '');
    if (missing.length) { problems.push(`${label}: missing ${missing.join(', ')}`); continue; }
    const host = normHost(a.host);
    if (!host || host !== a.host) { problems.push(`${label}: host must be the bare normalised host (got ${a.host})`); continue; }
    if (seen.has(host)) { problems.push(`${label}: ${host} appears twice`); continue; }
    seen.add(host);
    if (!approvals.some((ap) => ap.approval_id === a.approval_id)) { problems.push(`${label}: no approval record ${a.approval_id}`); continue; }
    const B = Number(a.owner.unitid); const ent = a.owner.entity;
    if (!Number.isInteger(B) || !ent) { problems.push(`${label}: owner needs unitid and entity`); continue; }
    const e = db.prepare('SELECT * FROM athletics_entities WHERE athletics_entity_id = ?').get(ent);
    if (!e || e.entity_kind !== 'SINGLE' || Number(e.federal_unitid) !== B) { problems.push(`${label}: owner entity ${ent} is not the SINGLE entity of UNITID ${B}`); continue; }
    const owners = db.prepare('SELECT athletics_entity_id FROM athletics_entities WHERE federal_unitid = ? OR parent_unitid = ?').all(B, B).map((x) => x.athletics_entity_id);
    if (owners.length !== 1) { problems.push(`${label}: UNITID ${B} carries ${owners.length} entities — parent/campus ownership is not decided here`); continue; }
    // the family, by NORMALISED host: every spelling, refused unless canonical
    const family = allDomains.filter((r) => normHost(r.domain) === host);
    const variants = family.filter((r) => !canonicalSpelling(r.domain, host));
    if (variants.length) { problems.push(`${label}: ${variants.map((r) => JSON.stringify(r.domain)).join(', ')} spell(s) ${host} non-canonically — an ambiguous variant is never corrected or discarded silently`); continue; }
    const rows = Array.isArray(a.rows) ? a.rows : [];
    const named = rows.map((r) => String(r?.domain ?? ''));
    if (new Set(named).size !== named.length || named.some((d) => !canonicalSpelling(d, host))) { problems.push(`${label}: rows must be ${host} and/or www.${host}, each once`); continue; }
    const absentFromAction = family.filter((r) => !named.includes(r.domain));
    if (absentFromAction.length) { problems.push(`${label}: ${absentFromAction.map((r) => r.domain).join(', ')} exist(s) but is not in the action — a twin may not be left contradicting the correction`); continue; }
    const p0 = problems.length;
    const items = []; let reassign = false; const rivals = new Set();
    for (const r of rows) {
      const row = family.find((x) => x.domain === r.domain);
      const rl = `${label} ${r.domain}`;
      if (!row) { problems.push(`${rl}: no athletics_domains row`); continue; }
      if (!OPERATIONS.includes(r.operation)) { problems.push(`${rl}: unknown operation ${r.operation}`); continue; }
      const exp = r.expected_old || {};
      const absent = cols.filter((c) => !(c in exp)); const extraKeys = Object.keys(exp).filter((k) => !cols.includes(k));
      if (absent.length || extraKeys.length) { problems.push(`${rl}: expected_old must be exactly the row's columns (missing ${absent.join(', ') || 'none'}; unknown ${extraKeys.join(', ') || 'none'})`); continue; }
      const diff = cols.filter((c) => !same(row[c], exp[c]));
      if (diff.length) { problems.push(`${rl}: expected-old mismatch on ${diff.join(', ')}`); continue; }
      if (!FROM[r.operation].includes(row.status)) { problems.push(`${rl}: ${r.operation} cannot start from ${row.status}`); continue; }
      const claimed = parse(row.claimed_unitids); const wrong = parse(row.wrong_mappings);
      if (claimed === null || wrong === null) { problems.push(`${rl}: claimed_unitids / wrong_mappings unreadable`); continue; }
      const refuted = new Set(wrong.map((m) => Number(m.claimantUnitid)));
      for (const c of claimed.map(Number)) if (c !== B) rivals.add(c);
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
        rivals.add(A);
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
    const { problems: ep, derived } = evidenceProblems(db, a, host, label, { store, target, now: n, rivals: [...rivals], requireLocation: reassign, needEquivalence: family.length > 1 || items.length > 1, resolutions });
    if (ep.length) { problems.push(...ep); continue; }
    // hold: only a release bound to this hold, this action and this action's verified evidence
    const hold = holdRecord(host); const rel = releases.filter((x) => normHost(x?.domain || '') === host);
    const held = isHeldDomain(host);
    if (held) {
      if (!rel.length) { problems.push(`${label}: ${host} is held for external adjudication and the fixture carries no release`); continue; }
      const rp = holdReleaseProblems(rel[0], hold);
      if (rel.length > 1) rp.push('more than one release for the same hold');
      if (Number(rel[0].released_to_unitid) !== B) rp.push(`release settles on ${rel[0].released_to_unitid}, the action on ${B}`);
      if (rel[0].applies_to_action !== a.action_id) rp.push(`release applies_to_action ${rel[0].applies_to_action} is not ${a.action_id}`);
      if (rel[0].approval_id !== a.approval_id) rp.push(`release approval ${rel[0].approval_id} is not the action's ${a.approval_id}`);
      if (approvalId && rel[0].approval_id !== approvalId) rp.push(`release approval ${rel[0].approval_id} is not the signed composite approval ${approvalId}`);
      if (rel[0].evidence?.self_identification_sha256 !== a.evidence.host_to_institution.sha256) rp.push('release self-identification is not the page this action verified');
      const ids = rel[0].evidence?.official_source_ids || [];
      if (!ids.length || ids.some((x) => !derived.official.includes(x))) rp.push('release official sources are not the sources this action verified');
      if (rp.length) { problems.push(...rp.map((x) => `${label}: hold release refused: ${x}`)); continue; }
    } else if (rel.length) { problems.push(`${label}: a release was given for ${host}, which is not held`); continue; }
    const elsewhere = allDomains.filter((r) => r.athletics_entity_id != null && r.athletics_entity_id !== ent && normHost(r.domain) === host);
    if (elsewhere.length) { problems.push(`${label}: ${elsewhere.map((x) => x.domain).join(', ')} already name(s) another entity`); continue; }
    plan.push({ action: a, host, owner: { unitid: B, entity: ent }, previous: reassign ? Number(a.previous_owner.unitid) : null, items, held, release: held ? rel[0] : null, derived });
  }
  if (releases.some((x) => !actions.some((a) => normHost(a?.host || '') === normHost(x?.domain || '')))) problems.push('a hold release does not belong to any action in this fixture');
  return { plan, problems };
}

/** The values a planned row is written with (OWNERSHIP_MUTABLE only). */
function writtenValues(item, { now, fixture_hash, action, release, ledger_id }) {
  const was = `${item.row.status}@${item.row.unitid ?? 'none'} ${item.row.confidence}/${item.row.verification_method}@${item.row.checked_at}`;
  const note = `DOMAIN_OWNERSHIP ${action.action_id} ${item.r.operation} @ ${now} (ledger ${ledger_id}, fixture ${String(fixture_hash).slice(0, 12)}, approval ${action.approval_id}): `
    + `was ${was} -> ${item.set.status}@${item.set.unitid} (${item.set.athletics_entity_id}) ${CORRECTED_CONFIDENCE}/${CORRECTION_METHOD}${release ? `; hold release ${release.release_id}` : ''}; ${action.reason}`;
  return { ...item.set, confidence: CORRECTED_CONFIDENCE, verification_method: CORRECTION_METHOD, checked_at: now, notes: (item.row.notes ? `${item.row.notes} | ${note}` : note).slice(0, 2000) };
}

/**
 * Apply a DOMAIN_OWNERSHIP_CORRECTION inside a transaction the CALLER owns (the composite writer).
 * Refuses outside a transaction, and without a live authenticated GRANT (approvalValidator.verifyApproval)
 * for THIS database (re-classified here) that names this fixture — a direct library call cannot skip
 * authentication or environment classification. Throws on any failure so the caller rolls back.
 * Returns { applied, manifest (promotion revert entries), plan, evidence }.
 */
export function applyDomainOwnershipInTransaction(db, fx, { now = new Date().toISOString(), store = null, grant = null, ledger_id = null, postcheck = domainOwnershipPostcheck, onAction = null } = {}) {
  if (!db.inTransaction) throw new Error('applyDomainOwnershipInTransaction needs a caller-owned open transaction');
  if (!isGrant(grant)) throw new Error('applyDomainOwnershipInTransaction needs an authenticated approval grant (verifyApproval) — refused');
  const env = classifyDatabase(db);
  if (env.class !== grant.target.class || env.identity !== grant.target.identity) throw new Error(`the approval grant is for ${grant.target.class} ${grant.target.identity}; this database is ${env.class} ${env.identity ?? '(unidentified)'} — refused`);
  const fixture_hash = fixtureHash(fx);
  if (!(grant.body.stages || []).some((st) => st.type === DOMAIN_OWNERSHIP_KIND && st.fixture_hash === fixture_hash)) throw new Error(`the approval grant does not authorise fixture ${fixture_hash.slice(0, 12)}`);
  if (!ledger_id) throw new Error('ledger_id is required (the correction ledger row this write belongs to)');
  asInstant(now);
  const { plan, problems } = planDomainOwnership(db, fx, { store, target: env.class, now: new Date(now), approvalId: grant.approval_id, resolutions: grant.body.contradiction_resolutions || [] });
  if (problems.length) throw Object.assign(new Error(`domain ownership correction refused: ${problems.length} problem(s)`), { problems });
  const cols = db.prepare('PRAGMA table_info(athletics_domains)').all().map((c) => c.name);
  const manifest = []; let applied = 0;
  plan.forEach((p, i) => {
    const entries = [];
    for (const item of p.items) {
      if (!item.set) continue;
      const nu = writtenValues(item, { now, fixture_hash, action: p.action, release: p.release, ledger_id });
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
  const evidence = { official_sources: [...new Map(plan.flatMap((p) => p.derived.sources).map((x) => [x.source_id, { source_id: x.source_id, sha256: x.sha256 }])).values()],
    pages: [...new Set(plan.flatMap((p) => p.derived.pages))], contradictions_resolved: plan.flatMap((p) => p.derived.contradictions.map((c) => ({ host: p.host, ...c }))) };
  return { applied, manifest, plan, evidence };
}

/**
 * Ownership postcheck (inside the transaction), over every row of each NORMALISED family:
 *   - not held: the host and www.host are owned by the owner through EXACT_HOST and by no one else,
 *     and the previous owner owns neither;
 *   - held: the resolver still reports HELD (the host lends authority to no one);
 *   - every family row (any spelling) names the owner and is trusted;
 * and the resolver reports 0 host-ownership disagreements overall. Throws to refuse.
 */
export function domainOwnershipPostcheck(db, plan) {
  const ctx = loadRefreshContext(db); const r = ctx.resolver;
  const ents = [...new Set(ctx.entities.map((e) => e.athletics_entity_id))];
  const bad = [];
  const allDomains = db.prepare('SELECT domain, unitid, athletics_entity_id, status FROM athletics_domains').all();
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
    for (const row of allDomains.filter((x) => normHost(x.domain) === p.host)) {
      if (Number(row.unitid) !== p.owner.unitid || !TRUSTED_TARGETS.includes(row.status) || (row.athletics_entity_id != null && row.athletics_entity_id !== p.owner.entity)) bad.push(`${row.domain}: ${row.status}@${row.unitid} (${row.athletics_entity_id ?? 'no entity'}) does not name the owner`);
    }
  }
  const dis = hostOwnershipDisagreements({ resolver: r, domains: ctx.domains, entities: ents });
  if ((dis.length ?? dis) !== 0) bad.push(`host ownership disagreements: ${dis.length ?? dis}`);
  if (bad.length) throw Object.assign(new Error(`domain ownership postcheck failed: ${bad.length}`), { problems: bad });
  return true;
}
