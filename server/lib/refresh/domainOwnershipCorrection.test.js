import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixtureHash } from './protectedCorrection.js';
import { planDomainOwnership, applyDomainOwnershipInTransaction, DOMAIN_OWNERSHIP_KIND } from './domainOwnershipCorrection.js';
import { COACH_INSTITUTION_KIND } from './coachCorrection.js';
import { runCompositeCorrection, revertComposite, approvalHash, idSetHash, validateComposite, COMPOSITE_APPROVAL_KIND } from './compositeCorrection.js';
import { measureInProcess } from './integrityMeasure.js';
import { revertManifest } from './promotion.js';
import { loadRefreshContext } from './context.js';
import { activationHold } from '../canonicalCoachEligibility.js';
import { isHeldDomain, holdRecord, holdReleaseProblems } from '../../../shared/heldDomainAdjudications.js';
import { world, U, E, NAME, H } from './domainOwnershipCorrection.world.js';

/**
 * PHASE DI-03B — guarded domain ownership correction and its place in the composite writer. The world
 * reproduces the DI-03 C1 shape: a held institution domain and an athletics host filed under the
 * wrong one of two similarly named institutions, an alias filed under the wrong Charleston-like
 * college, a WRONG_INSTITUTION host whose www twin is verified, an unreadable bare host whose www twin
 * is verified, an unowned standalone host, and the coaches those hosts mis-attribute.
 */
const NOW = '2026-10-09T00:00:00Z';
const HEX = (c) => c.repeat(64);
const domOf = (db, d) => db.prepare('SELECT * FROM athletics_domains WHERE domain = ?').get(d);
const coachOf = (db, id) => db.prepare('SELECT * FROM coaches WHERE id = ?').get(id);
const seal = (fx) => { const { fixture_hash, ...rest } = fx; return { ...rest, fixture_hash: fixtureHash(rest) }; }; // eslint-disable-line no-unused-vars
const fetchRec = (url, final, c = 'a') => ({ url, final_url: final, http_status: 200, sha256: HEX(c), retrieved_at: NOW });
function evidence(host, unitid, { twin = false, listed = host } = {}) {
  return {
    institution_to_host: [{ source: 'IPEDS', unitid, listed_host: listed, url: 'https://nces.ed.gov/ipeds/datacenter/data/HD2024.zip', sha256: HEX('b') }],
    host_to_institution: { ...fetchRec(`https://${host}/`, `https://${host}/`), self_identification: 'the page names the owner', names_owner: true },
    ...(twin ? { equivalence: { bare: fetchRec(`https://${host}/`, `https://${host}/landing/index`), www: fetchRec(`https://www.${host}/`, `https://www.${host}/landing/index`) } } : {}),
  };
}
const row = (db, domain, operation, proposed) => ({ domain, operation, expected_old: { ...domOf(db, domain) }, ...(proposed ? { proposed } : {}) });
function act(db, host, owner, rows, { prev = null, twin = false, over = {} } = {}) {
  return { action_id: `DO-${host}`, approval_id: 'AP-D', host, owner: { unitid: U[owner], entity: E[owner] }, ...(prev ? { previous_owner: { unitid: U[prev] } } : {}),
    rows: rows.map(([d, op, p]) => row(db, d, op, p)), evidence: evidence(host, U[owner], { twin }), reason: 'authenticated owner', blast_radius: 'one host family', ...over };
}
const release = (over = {}) => ({ release_id: 'REL-STMARYTX', domain: H.HELD, hold_recorded: '2026-09-28', stored_unitid: U.CA, disputed_between: [U.CA, U.TX], released_to_unitid: U.TX,
  reviewer: 'Independent Reviewer', approved_at: '2026-10-09', reason: 'Self-identification and the IPEDS WEBADDR both establish the San Antonio institution (228149) as owner.',
  evidence: [{ kind: 'SELF_IDENTIFICATION', url: `https://www.${H.HELD}/`, sha256: HEX('c') }, { kind: 'IPEDS', url: 'https://nces.ed.gov/ipeds/datacenter/data/HD2024.zip', sha256: HEX('d') }],
  applies_to_action: `DO-${H.HELD}`, ...over });
function fixture(actions, { releases = [], hosts = null } = {}) {
  return seal({ kind: DOMAIN_OWNERSHIP_KIND, phase: 't', created_at: 't', approvals: [{ approval_id: 'AP-D', approved_by: 'reviewer', approved_at: '2026-10-09', basis: 'test', hosts: hosts || actions.map((a) => a.host) }], hold_releases: releases, corrections: actions });
}
/** the six C1 families, in DI-03 order */
function c1Actions(db) {
  return [
    act(db, H.HELD, 'TX', [[H.HELD, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'CA' }),
    act(db, H.RATTLER, 'TX', [[H.RATTLER, 'REASSIGN_OWNER', { status: 'VERIFIED' }]], { prev: 'CA' }),
    act(db, H.UWV, 'WV', [[H.UWV, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'SC' }),
    act(db, H.CUW, 'WI', [[H.CUW, 'RESTORE_OWNER', { status: 'VERIFIED' }], [`www.${H.CUW}`, 'CONFIRM']], { twin: true }),
    act(db, H.TWIN, 'CN', [[H.TWIN, 'PROMOTE_UNOWNED', { status: 'VERIFIED_ALIAS', role: 'ATHLETICS_SITE' }], [`www.${H.TWIN}`, 'CONFIRM']], { twin: true }),
    act(db, H.SOLO, 'CA', [[H.SOLO, 'PROMOTE_UNOWNED', { status: 'VERIFIED_ALIAS' }]]),
  ];
}
const c1Domains = (db) => fixture(c1Actions(db), { releases: [release()] });
const c1Coaches = (db) => seal({ kind: COACH_INSTITUTION_KIND, phase: 't', created_at: 't', actions: [
  { action_id: 'CI-tx', coach_id: 'k-tx-misfiled', coach: 'Tex Misfiled', expected_old: { school: NAME.CA, division: 'NCAA D1', sport: 'mens-soccer', email: coachOf(db, 'k-tx-misfiled').email, email_status: 'verified' }, proposed: { school: NAME.TX, division: 'NCAA D2' }, evidence: 'current staff page', reason: 'filed at the similarly named institution' },
  { action_id: 'CI-wv', coach_id: 'k-wv-misfiled', coach: 'Will Guessed', expected_old: { school: NAME.SC, division: 'NCAA D1', sport: 'mens-soccer', email: coachOf(db, 'k-wv-misfiled').email, email_status: 'inferred' }, proposed: { school: NAME.WV, division: 'NCAA D2' }, evidence: 'current staff page', reason: 'filed at the similarly named institution' }] });
const STAGES = (D, C) => [{ stage_id: 'S1-domains', type: DOMAIN_OWNERSHIP_KIND, fixture: D }, { stage_id: 'S2-relabel', type: COACH_INSTITUTION_KIND, fixture: C }];
const EXPECTED = { 'S1-domains': ['k-tx-head', 'k-tx-misfiled'], 'S2-relabel': [] };
function approve(db, stages, eligibility = EXPECTED) {
  const ap = { kind: COMPOSITE_APPROVAL_KIND, approval_id: 'AP-C1', approved_by: 'reviewer', approved_at: '2026-10-09', basis: 'test', baseline: { eligible_ids_hash: idSetHash(measureInProcess(db).eligible_ids) },
    stages: stages.map((s) => ({ stage_id: s.stage_id, type: s.type, group: s.group ?? null, fixture_hash: s.fixture.fixture_hash, eligibility: { added: eligibility[s.stage_id] || [], removed: [] } })) };
  return { ...ap, approval_hash: approvalHash(ap) };
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'di03b-'));
function holdsFile(ids, name = 'holds.json') {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, JSON.stringify({ kind: 'COACH_ACTIVATION_HOLDS', version: 't', counts: { PENDING_SEND_TIME_VERIFICATION: ids.length }, holds: ids.map((coach_id) => ({ coach_id, hold: 'PENDING_SEND_TIME_VERIFICATION' })) }));
  return f;
}
const HOLDS = holdsFile(['k-tx-head', 'k-tx-misfiled']);
const snapshot = (db) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, JSON.stringify(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all())]));
function setup() { const db = world(); const D = c1Domains(db); const C = c1Coaches(db); const stages = STAGES(D, C); return { db, D, C, stages, approval: approve(db, stages) }; }
const run = (db, stages, approval, opts = {}) => runCompositeCorrection(db, stages, approval, { apply: true, now: NOW, activationHoldsFile: HOLDS, ...opts });
/** apply one domain fixture directly, in its own transaction */
function applyDomains(db, fx) { db.exec('BEGIN IMMEDIATE'); try { const r = applyDomainOwnershipInTransaction(db, fx, { now: NOW }); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } }
const problemsOf = (db, fx) => planDomainOwnership(db, fx).problems.join('\n');
const EVIDENCE_COLS = ['claimed_keys', 'claimed_unitids', 'evidence_kind', 'evidence_text', 'identity_method', 'identity_strength', 'http_status', 'final_url', 'verification_method', 'confidence', 'checked_at', 'platform'];

describe('1. authenticated ownership reassignment (REASSIGN_OWNER)', () => {
  it('moves a decided host to the authenticated owner, records the old owner as refuted, keeps every evidence column', () => {
    const db = world(); const before = domOf(db, H.RATTLER);
    const r = applyDomains(db, fixture([act(db, H.RATTLER, 'TX', [[H.RATTLER, 'REASSIGN_OWNER', { status: 'VERIFIED' }]], { prev: 'CA' })]));
    const after = domOf(db, H.RATTLER);
    expect(r.applied).toBe(1);
    expect([after.status, after.unitid, after.athletics_entity_id, after.ownership_class]).toEqual(['VERIFIED', U.TX, E.TX, 'ENTITY_OWNED']);
    expect(JSON.parse(after.wrong_mappings)).toEqual([{ key: NAME.CA, claimantUnitid: U.CA }]); // TX's refusal lifted, CA now refuted
    for (const c of EVIDENCE_COLS) expect(after[c]).toEqual(before[c]);
    const ctx = loadRefreshContext(db);
    expect(ctx.resolver.ownerOfHost(H.RATTLER).entity).toBe(E.TX);
    expect(ctx.resolver.hostOwnedBy(H.RATTLER, E.CA)).toBe(false);
  });
  it('is not a general UNITID update: owner must be a recorded claimant, distinct from the previous owner, a SINGLE entity with no campus', () => {
    const db = world();
    expect(problemsOf(db, fixture([act(db, H.UWV, 'WI', [[H.UWV, 'REASSIGN_OWNER', { status: 'VERIFIED' }]], { prev: 'SC' })]))).toMatch(/not a claimant/);
    expect(problemsOf(db, fixture([act(db, H.UWV, 'SC', [[H.UWV, 'REASSIGN_OWNER', { status: 'VERIFIED' }]], { prev: 'SC' })]))).toMatch(/same UNITID/);
    expect(problemsOf(db, fixture([act(db, H.UWV, 'WV', [[H.UWV, 'REASSIGN_OWNER', { status: 'VERIFIED' }]], { prev: 'CA' })]))).toMatch(/previous_owner.unitid must be the row's stored UNITID/);
    expect(problemsOf(db, fixture([act(db, H.UWV, 'WV', [[H.UWV, 'REASSIGN_OWNER', { status: 'VERIFIED', unitid: U.WV }]], { prev: 'SC' })]))).toMatch(/may only name status and role/);
    expect(problemsOf(db, fixture([act(db, H.UWV, 'WV', [[H.UWV, 'REASSIGN_OWNER', { status: 'WRONG_INSTITUTION' }]], { prev: 'SC' })]))).toMatch(/target status/);
    db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, parent_unitid, campus_label, entity_kind, provenance, created_at) VALUES ('AE-T-WV-CAMPUS','WV campus',NULL,?,'Branch','BRANCH_CAMPUS','t','t')").run(U.WV);
    expect(problemsOf(db, fixture([act(db, H.UWV, 'WV', [[H.UWV, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'SC' })]))).toMatch(/carries 2 entities/);
  });
  it('refuses while another claimant is unresolved, and when another row already names a different entity', () => {
    const db = world();
    db.prepare('UPDATE athletics_domains SET claimed_unitids=? WHERE domain=?').run(JSON.stringify([U.SC, U.WV, U.OTHER]), H.UWV);
    expect(problemsOf(db, fixture([act(db, H.UWV, 'WV', [[H.UWV, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'SC' })]))).toMatch(/unresolved conflicting claim\(s\) 910099/);
    const db2 = world();
    db2.prepare("UPDATE athletics_domains SET athletics_entity_id=? WHERE domain=?").run(E.SC, H.UWV);
    expect(problemsOf(db2, fixture([act(db2, H.UWV, 'WV', [[H.UWV, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'SC' })]))).toMatch(/already name\(s\) another entity/);
  });
});

describe('2. atomic www / bare reconciliation', () => {
  it('restores a WRONG_INSTITUTION bare host with its verified www twin in one action; the twin is pinned, not rewritten', () => {
    const db = world(); const www = domOf(db, `www.${H.CUW}`);
    const r = applyDomains(db, fixture([act(db, H.CUW, 'WI', [[H.CUW, 'RESTORE_OWNER', { status: 'VERIFIED' }], [`www.${H.CUW}`, 'CONFIRM']], { twin: true })]));
    expect(r.applied).toBe(1);
    expect(domOf(db, H.CUW).status).toBe('VERIFIED');
    expect(JSON.parse(domOf(db, H.CUW).wrong_mappings)).toEqual([{ key: NAME.OTHER, claimantUnitid: U.OTHER }]); // refuted claimant kept
    expect(domOf(db, `www.${H.CUW}`)).toEqual(www);
    const ctx = loadRefreshContext(db);
    for (const h of [H.CUW, `www.${H.CUW}`]) expect(ctx.resolver.ownerOfHost(h).entity).toBe(E.WI);
  });
  it('refuses a family with a twin left out, without host-equivalence evidence, or whose forms land on different pages', () => {
    const db = world();
    expect(problemsOf(db, fixture([act(db, H.CUW, 'WI', [[H.CUW, 'RESTORE_OWNER', { status: 'VERIFIED' }]])]))).toMatch(/exist\(s\) but is not in the action/);
    expect(problemsOf(db, fixture([act(db, H.CUW, 'WI', [[H.CUW, 'RESTORE_OWNER', { status: 'VERIFIED' }], [`www.${H.CUW}`, 'CONFIRM']])]))).toMatch(/evidence.equivalence/);
    const a = act(db, H.CUW, 'WI', [[H.CUW, 'RESTORE_OWNER', { status: 'VERIFIED' }], [`www.${H.CUW}`, 'CONFIRM']], { twin: true });
    a.evidence.equivalence.www.final_url = `https://www.${H.CUW}/elsewhere`;
    expect(problemsOf(db, fixture([a]))).toMatch(/land on different pages/);
    const b = act(db, H.CUW, 'WI', [[H.CUW, 'RESTORE_OWNER', { status: 'VERIFIED' }], [`www.${H.CUW}`, 'CONFIRM']], { twin: true });
    b.evidence.equivalence.www.final_url = 'https://someone-else.test/landing/index';
    expect(problemsOf(db, fixture([b]))).toMatch(/lands on another host/);
    expect(problemsOf(db, fixture([act(db, H.CUW, 'WI', [[H.CUW, 'RESTORE_OWNER', { status: 'VERIFIED' }], [`www.${H.TWIN}`, 'CONFIRM']], { twin: true })]))).toMatch(/rows must be/);
  });
});

describe('3. governed promotion of unowned hosts', () => {
  it('promotes an unreadable bare host to VERIFIED_ALIAS of its verified www twin (role from UNKNOWN only)', () => {
    const db = world();
    applyDomains(db, fixture([act(db, H.TWIN, 'CN', [[H.TWIN, 'PROMOTE_UNOWNED', { status: 'VERIFIED_ALIAS', role: 'ATHLETICS_SITE' }], [`www.${H.TWIN}`, 'CONFIRM']], { twin: true })]));
    const r = domOf(db, H.TWIN);
    expect([r.status, r.unitid, r.athletics_entity_id, r.role]).toEqual(['VERIFIED_ALIAS', U.CN, E.CN, 'ATHLETICS_SITE']);
    expect(r.wrong_mappings).toBeNull();
    expect(loadRefreshContext(db).resolver.ownerOfHost(H.TWIN).entity).toBe(E.CN);
  });
  it('promotes a standalone unowned host only when an authoritative record lists that exact host', () => {
    const db = world();
    expect(problemsOf(db, fixture([act(db, H.SOLO, 'CA', [[H.SOLO, 'PROMOTE_UNOWNED', { status: 'VERIFIED_ALIAS' }]])]))).toBe('');
    const a = act(db, H.SOLO, 'CA', [[H.SOLO, 'PROMOTE_UNOWNED', { status: 'VERIFIED_ALIAS' }]]);
    a.evidence.institution_to_host[0].listed_host = 'solo-college.test'; // a similar name is not a listing
    expect(problemsOf(db, fixture([a]))).toMatch(/no IPEDS \/ NCAA-directory record lists solo.test/);
    expect(problemsOf(db, fixture([act(db, H.SOLO, 'CA', [[H.SOLO, 'PROMOTE_UNOWNED', { status: 'VERIFIED_ALIAS', role: 'ATHLETICS_SITE' }]])]))).toMatch(/role may only be set/);
    expect(problemsOf(db, fixture([act(db, H.SOLO, 'TX', [[H.SOLO, 'PROMOTE_UNOWNED', { status: 'VERIFIED_ALIAS' }]])]))).toMatch(/not a claimant/);
  });
});

describe('4. reviewed release of a held domain', () => {
  const held = () => { const db = world(); return { db, a: act(db, H.HELD, 'TX', [[H.HELD, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'CA' }) }; };
  it('refuses a held host without a release, and with any release that is not exactly reviewed and evidenced', () => {
    const { db, a } = held();
    expect(problemsOf(db, fixture([a]))).toMatch(/held for external adjudication and the fixture carries no release/);
    for (const [over, re] of [[{ reviewer: 'NOT APPROVED — rehearsal' }, /reviewer authorisation/], [{ evidence: [{ kind: 'SELF_IDENTIFICATION', url: 'https://x.test/', sha256: HEX('c') }] }, /IPEDS/],
      [{ released_to_unitid: U.CA }, /release settles on/], [{ hold_recorded: '2026-10-01' }, /hold_recorded/], [{ applies_to_action: 'DO-other' }, /applies_to_action/], [{ reason: 'ok' }, /documented reason/],
      [{ disputed_between: [U.CA] }, /disputed_between/], [{ stored_unitid: U.TX }, /stored_unitid/]]) {
      expect(problemsOf(db, fixture([a], { releases: [release(over)] }))).toMatch(re);
    }
  });
  it('a valid release authorises this correction only; the host stays HELD for every reader until a code-level release names the applied manifest', () => {
    const { db, a } = held();
    applyDomains(db, fixture([a], { releases: [release()] }));
    expect([domOf(db, H.HELD).unitid, domOf(db, H.HELD).athletics_entity_id]).toEqual([U.TX, E.TX]);
    expect(isHeldDomain(H.HELD)).toBe(true);
    expect(loadRefreshContext(db).resolver.ownerOfHost(H.HELD).status).toBe('HELD');
    expect(isHeldDomain(H.HELD, { releases: [release()] })).toBe(true); // no applied manifest: still held
    expect(isHeldDomain(H.HELD, { releases: [release({ applied_correction: { manifest_hash: HEX('e') } })] })).toBe(false);
    expect(isHeldDomain(H.HELD, { releases: [release({ reviewer: '', applied_correction: { manifest_hash: HEX('e') } })] })).toBe(true);
    expect(holdReleaseProblems(release(), holdRecord(H.HELD), { requireApplied: true })).toEqual([expect.stringMatching(/applied correction manifest/)]);
  });
  it('refuses a release for a host that is not held, or one not attached to any action', () => {
    const db = world();
    expect(problemsOf(db, fixture([act(db, H.RATTLER, 'TX', [[H.RATTLER, 'REASSIGN_OWNER', { status: 'VERIFIED' }]], { prev: 'CA' })], { releases: [release({ domain: H.RATTLER })] }))).toMatch(/not held|does not belong/);
  });
});

describe('5-8. preconditions, evidence and approval', () => {
  it('5. a changed row (any column) refuses the whole fixture', () => {
    const db = world(); const fx = c1Domains(db);
    db.prepare("UPDATE athletics_domains SET checked_at='2026-10-09' WHERE domain=?").run(H.SOLO);
    expect(problemsOf(db, fx)).toMatch(/expected-old mismatch on checked_at/);
    expect(() => applyDomains(db, fx)).toThrow(/refused/);
    expect(domOf(db, H.RATTLER).unitid).toBe(U.CA); // nothing else was written
  });
  it('6. missing or invalid evidence refuses', () => {
    const db = world(); const base = () => act(db, H.RATTLER, 'TX', [[H.RATTLER, 'REASSIGN_OWNER', { status: 'VERIFIED' }]], { prev: 'CA' });
    const cases = [
      [(a) => { a.evidence.institution_to_host = []; }, /IPEDS record of UNITID 228149/],
      [(a) => { a.evidence.institution_to_host[0].sha256 = 'nope'; }, /IPEDS record/],
      [(a) => { a.evidence.host_to_institution.http_status = 404; }, /http_status must be 200/],
      [(a) => { a.evidence.host_to_institution.final_url = 'https://parked.test/'; }, /landed on parked.test/],
      [(a) => { a.evidence.host_to_institution.names_owner = false; }, /self-identification naming the owner/],
      [(a) => { delete a.evidence; }, /missing evidence/],
    ];
    for (const [edit, re] of cases) { const a = base(); edit(a); expect(problemsOf(db, fixture([a]))).toMatch(re); }
  });
  it('7. approval, hash and kind are enforced', () => {
    const db = world(); const a = act(db, H.RATTLER, 'TX', [[H.RATTLER, 'REASSIGN_OWNER', { status: 'VERIFIED' }]], { prev: 'CA' });
    expect(problemsOf(db, fixture([a], { hosts: [H.UWV] }))).toMatch(/no approval record/);
    expect(problemsOf(db, { ...fixture([a]), reason: 'edited after sealing' })).toMatch(/fixture_hash does not match/);
    expect(problemsOf(db, { ...fixture([a]), kind: 'PROTECTED_SOURCE_CORRECTION' })).toMatch(/kind must be/);
  });
  it('8. the transaction-compatible apply refuses outside a caller-owned transaction', () => {
    const db = world();
    expect(() => applyDomainOwnershipInTransaction(db, c1Domains(db))).toThrow(/caller-owned open transaction/);
  });
});

describe('9. the complete DI-03 C1 batch through the composite writer', () => {
  it('domain ownership runs before relabels (rank 1.5); the reverse order is refused before any write', () => {
    const { db, D, C } = setup();
    const rev = [STAGES(D, C)[1], STAGES(D, C)[0]];
    expect(validateComposite(rev, approve(db, rev)).join('\n')).toMatch(/out of order/);
  });
  it('without the domain stage the relabel is refused (the DI-03 dependency); with it, everything commits atomically', () => {
    const { db, C } = setup();
    const only = [{ stage_id: 'S2-relabel', type: COACH_INSTITUTION_KIND, fixture: C }];
    expect(() => run(db, only, approve(db, only, { 'S2-relabel': [] }))).toThrow(/resolve elsewhere/);
    const s = setup(); const r = run(s.db, s.stages, s.approval);
    expect(r.committed).toBe(true);
    expect(r.report.stages.map((x) => [x.stage_id, x.eligibility.added])).toEqual([['S1-domains', ['k-tx-head', 'k-tx-misfiled']], ['S2-relabel', []]]);
    expect(coachOf(s.db, 'k-tx-misfiled').school).toBe(NAME.TX);
    expect(coachOf(s.db, 'k-wv-misfiled').school).toBe(NAME.WV);
    expect(r.report.final.activation_holds).toEqual({ file: HOLDS, newly_eligible: 2, all_held: true });
  });
  it('touches only the corrected domain rows and the relabelled coaches\' school/division; every other table is byte-identical', () => {
    const { db, stages, approval } = setup(); const before = snapshot(db);
    const coachesBefore = db.prepare('SELECT * FROM coaches ORDER BY id').all();
    run(db, stages, approval);
    const after = snapshot(db);
    const changed = Object.keys(before).filter((t) => before[t] !== after[t]).sort();
    expect(changed).toEqual(['athletics_domains', 'coaches']);
    const coachesAfter = db.prepare('SELECT * FROM coaches ORDER BY id').all();
    coachesBefore.forEach((c, i) => {
      const diff = Object.keys(c).filter((k) => c[k] !== coachesAfter[i][k]);
      expect(diff.every((k) => ['school', 'division'].includes(k))).toBe(true);
      expect([coachesAfter[i].email, coachesAfter[i].email_status, coachesAfter[i].currentness_status]).toEqual([c.email, c.email_status, c.currentness_status]);
    });
    const domChanged = db.prepare('SELECT domain FROM athletics_domains ORDER BY domain').all().map((d) => d.domain)
      .filter((d) => JSON.stringify(domOf(world(), d)) !== JSON.stringify(domOf(db, d)));
    expect(domChanged.sort()).toEqual([H.CUW, H.RATTLER, H.SOLO, H.HELD, H.TWIN, H.UWV].sort());
  });
});

describe('10. activation-hold protection', () => {
  it('refuses the whole run when a newly eligible coach has no activation hold (it would activate outreach)', () => {
    const { db, stages, approval } = setup(); const before = snapshot(db);
    expect(() => run(db, stages, approval, { activationHoldsFile: holdsFile(['k-tx-misfiled'], 'partial.json') })).toThrow(/without an activation hold/);
    expect(snapshot(db)).toEqual(before);
  });
  it('fails closed when the holds file is missing or malformed', () => {
    const { db, stages, approval } = setup();
    expect(() => run(db, stages, approval, { activationHoldsFile: path.join(tmp, 'missing.json') })).toThrow(/activation holds unreadable/);
    const bad = path.join(tmp, 'bad.json'); fs.writeFileSync(bad, JSON.stringify({ kind: 'COACH_ACTIVATION_HOLDS', counts: { X: 9 }, holds: [{ coach_id: 'k-tx-head', hold: 'X' }] }));
    expect(() => run(db, stages, approval, { activationHoldsFile: bad })).toThrow(/activation holds unreadable/);
  });
  it('every newly eligible coach is under a hold in the file the send floor reads (no unexpected activation)', () => {
    const { db, stages, approval } = setup(); const r = run(db, stages, approval);
    for (const id of r.report.final.added) expect(activationHold(id, HOLDS)?.hold).toBe('PENDING_SEND_TIME_VERIFICATION');
    expect(r.report.final.added.sort()).toEqual(['k-tx-head', 'k-tx-misfiled']);
  });
  it('rehearsal (apply=false) runs every stage and gate and leaves the database byte-identical', () => {
    const { db, stages, approval } = setup(); const before = snapshot(db);
    const r = runCompositeCorrection(db, stages, approval, { apply: false, now: NOW, activationHoldsFile: HOLDS });
    expect(r.committed).toBe(false);
    expect(snapshot(db)).toEqual(before);
  });
});

describe('11. a failure at any point rolls back every stage', () => {
  const points = ['begin', 'stage:S1-domains:begin', 'stage:S1-domains:action', 'stage:S1-domains:written', 'stage:S1-domains:eligibility',
    'stage:S2-relabel:begin', 'stage:S2-relabel:action', 'stage:S2-relabel:written', 'stage:S2-relabel:eligibility', 'final:integrity', 'final:activation-holds', 'final:precommit'];
  for (const p of points) {
    it(`throw at ${p}`, () => {
      const { db, stages, approval } = setup(); const before = snapshot(db); let reached = false;
      expect(() => run(db, stages, approval, { inject: (x) => { if (x === p) { reached = true; throw new Error(`injected at ${p}`); } } })).toThrow(/injected/);
      expect(reached).toBe(true);
      expect(snapshot(db)).toEqual(before);
      expect(db.inTransaction).toBe(false);
    });
  }
  it('a postcheck refusal inside the domain stage rolls back (a twin that disagrees after the write)', () => {
    const db = world(); const fx = fixture([act(db, H.TWIN, 'CN', [[H.TWIN, 'PROMOTE_UNOWNED', { status: 'VERIFIED_ALIAS', role: 'ATHLETICS_SITE' }], [`www.${H.TWIN}`, 'CONFIRM']], { twin: true })]);
    const before = snapshot(db);
    db.exec('BEGIN IMMEDIATE');
    expect(() => applyDomainOwnershipInTransaction(db, fx, { now: NOW, postcheck: () => { throw new Error('postcheck refused'); } })).toThrow(/postcheck refused/);
    db.exec('ROLLBACK');
    expect(snapshot(db)).toEqual(before);
  });
});

describe('12. revert of a committed correction', () => {
  it('restores every table exactly and the baseline eligible set; refuses if a corrected row changed since', () => {
    const { db, stages, approval } = setup(); const before = snapshot(db);
    const r = run(db, stages, approval);
    expect(r.manifest.manifest.flatMap((m) => m.entries).length).toBe(8); // 6 domain rows + 2 coaches
    const rv = revertComposite(db, r.manifest, { apply: true });
    expect(rv.eligible_ids_hash).toBe(approval.baseline.eligible_ids_hash);
    expect(snapshot(db)).toEqual(before);
    const s2 = setup(); const r2 = run(s2.db, s2.stages, s2.approval);
    s2.db.prepare("UPDATE athletics_domains SET notes='someone else' WHERE domain=?").run(H.SOLO);
    const mid = snapshot(s2.db);
    expect(() => revertComposite(s2.db, r2.manifest, { apply: true })).toThrow(/revert refused/);
    expect(snapshot(s2.db)).toEqual(mid);
  });
  it('the domain manifest alone is revertible with the promotion revert', () => {
    const db = world(); const before = snapshot(db);
    const r = applyDomains(db, c1Domains(db));
    db.exec('BEGIN'); revertManifest(db, r.manifest, { inTransaction: true }); db.exec('COMMIT');
    expect(snapshot(db)).toEqual(before);
  });
});
