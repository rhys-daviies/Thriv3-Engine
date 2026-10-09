import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fixtureHash } from './protectedCorrection.js';
import { planDomainOwnership, applyDomainOwnershipInTransaction, DOMAIN_OWNERSHIP_KIND } from './domainOwnershipCorrection.js';
import { COACH_INSTITUTION_KIND } from './coachCorrection.js';
import { runCompositeCorrection, revertComposite, approvalHash, idSetHash, validateComposite, COMPOSITE_APPROVAL_KIND } from './compositeCorrection.js';
import { measureInProcess } from './integrityMeasure.js';
import { revertManifest } from './promotion.js';
import { loadRefreshContext } from './context.js';
import { evidenceStore } from './officialEvidence.js';
import { approvalProblems, TARGET } from './approvalValidator.js';
import { correctionTarget } from './correctionTarget.js';
import { canonicalDecisionIneligibility, canonicalDecisions } from '../canonicalCoachEligibility.js';
import { isHeldDomain, holdRecord, holdReleaseProblems, appliedReleaseProblems } from '../../../shared/heldDomainAdjudications.js';
import { approvalFields, holdsFile, sha256, TEST_REVIEWER } from './correctionTestKit.js';
import { world, U, E, NAME, H } from './domainOwnershipCorrection.world.js';

/**
 * PHASE DI-03B / DI-03D — guarded domain ownership correction. The world reproduces the DI-03 C1 shape
 * (a held institution domain and an athletics host filed under the wrong one of two similarly named
 * institutions; an alias under the wrong Charleston-like college; a WRONG_INSTITUTION host with a
 * verified www twin; an unreadable bare host; an unowned standalone host) and its coaches.
 * Evidence is real bytes: the TEST_ONLY official sources registered in shared/officialSourceRegistry.json
 * (server/lib/refresh/__fixtures__/di03d) and synthetic page bodies, in a content-addressed store.
 * Every DI-03C finding (F1-F13) and exploit (x1-x4) has a regression below.
 */
const NOW = '2026-10-09T00:00:00Z';
const now = new Date(NOW);
const FIX = path.resolve(import.meta.dirname, '__fixtures__/di03d');
const domOf = (db, d) => db.prepare('SELECT * FROM athletics_domains WHERE domain = ?').get(d);
const coachOf = (db, id) => db.prepare('SELECT * FROM coaches WHERE id = ?').get(id);
const seal = (fx) => { const { fixture_hash, ...rest } = fx; return { ...rest, fixture_hash: fixtureHash(rest) }; }; // eslint-disable-line no-unused-vars

// ---------- the evidence store: official source bytes + page bodies, named by sha256
const STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'di03d-evidence-'));
const put = (bytes) => { const h = sha256(bytes); fs.writeFileSync(path.join(STORE_DIR, h), bytes); return h; };
put(fs.readFileSync(path.join(FIX, 'ipeds_test.csv'))); put(fs.readFileSync(path.join(FIX, 'ncaa_test.json')));
const store = evidenceStore(STORE_DIR);
const html = (title, body = '') => `<!doctype html><html><head><title>${title}</title><meta property="og:site_name" content="${title}"></head><body>${body}</body></html>`;
/** A fetch record whose body is in the store. */
function fetchRec(url, finalUrl, page, { retrieved_at = NOW, status = 200 } = {}) {
  return { url, final_url: finalUrl, http_status: status, retrieved_at, sha256: put(Buffer.from(page)) };
}
const PAGES = {
  [H.HELD]: html("Home | St. Example University | San Antonio, Texas", 'One Camino Santa Example, San Antonio, Texas'),
  [H.RATTLER]: html('St. Example University Athletics - Official Athletics Website', 'San Antonio, TX 78228'),
  [H.UWV]: html('Home - Example University', 'Example University, Charleston, West Virginia'),
  [H.CUW]: html('Concordia Example - Official Athletics Website', 'Mequon, Wisconsin'),
  [H.TWIN]: html('Twin College Athletics', 'Jefferson City, Tennessee'),
  [H.SOLO]: html('Saint Example College of California | A Bay Area College', 'Moraga, California'),
};
const IPEDS = { source_id: 'TEST_IPEDS_DI03D' };
const ncaa = (org_id) => ({ source_id: 'TEST_NCAA_DI03D', org_id });
function evidence(host, { orgId = null, twin = false, page = PAGES[host] ?? html(host) } = {}) {
  const e = { official: [IPEDS, ...(orgId ? [ncaa(orgId)] : [])], host_to_institution: fetchRec(`https://${host}/`, `https://${host}/`, page) };
  if (twin) { const b = fetchRec(`https://${host}/`, `https://${host}/landing/index`, page); e.equivalence = { bare: b, www: { ...b, url: `https://www.${host}/`, final_url: `https://www.${host}/landing/index` } }; }
  return e;
}
const row = (db, domain, operation, proposed) => ({ domain, operation, expected_old: { ...domOf(db, domain) }, ...(proposed ? { proposed } : {}) });
function act(db, host, owner, rows, { prev = null, twin = false, orgId = null, over = {} } = {}) {
  return { action_id: `DO-${host}`, approval_id: 'AP-D', host, owner: { unitid: U[owner], entity: E[owner] }, ...(prev ? { previous_owner: { unitid: U[prev] } } : {}),
    rows: rows.map(([d, op, p]) => row(db, d, op, p)), evidence: evidence(host, { orgId, twin }), reason: 'authenticated owner', blast_radius: 'one host family', ...over };
}
const release = (a, over = {}) => ({ release_id: 'REL-STMARYTX', domain: H.HELD, hold_recorded: '2026-09-28', stored_unitid: U.CA, disputed_between: [U.CA, U.TX], released_to_unitid: U.TX,
  approval_id: 'AP-D', ...approvalFields(NOW), reason: 'Self-identification and the IPEDS WEBADDR both establish the San Antonio institution (228149) as owner.',
  evidence: { self_identification_sha256: a.evidence.host_to_institution.sha256, official_source_ids: ['TEST_IPEDS_DI03D', 'TEST_NCAA_DI03D'] }, applies_to_action: `DO-${H.HELD}`, ...over });
function fixture(actions, { releases = [], hosts = null, approval = {} } = {}) {
  return seal({ kind: DOMAIN_OWNERSHIP_KIND, phase: 't', created_at: 't', approvals: [{ approval_id: 'AP-D', ...approvalFields(NOW), basis: 'test', hosts: hosts || actions.map((a) => a.host), ...approval }], hold_releases: releases, corrections: actions });
}
function c1Actions(db) {
  return [
    act(db, H.HELD, 'TX', [[H.HELD, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'CA', orgId: 1346 }),
    act(db, H.RATTLER, 'TX', [[H.RATTLER, 'REASSIGN_OWNER', { status: 'VERIFIED' }]], { prev: 'CA', orgId: 1346 }),
    act(db, H.UWV, 'WV', [[H.UWV, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'SC', orgId: 1013 }),
    act(db, H.CUW, 'WI', [[H.CUW, 'RESTORE_OWNER', { status: 'VERIFIED' }], [`www.${H.CUW}`, 'CONFIRM']], { twin: true, orgId: 1036 }),
    act(db, H.TWIN, 'CN', [[H.TWIN, 'PROMOTE_UNOWNED', { status: 'VERIFIED_ALIAS', role: 'ATHLETICS_SITE' }], [`www.${H.TWIN}`, 'CONFIRM']], { twin: true, orgId: 1000 }),
    act(db, H.SOLO, 'CA', [[H.SOLO, 'PROMOTE_UNOWNED', { status: 'VERIFIED_ALIAS' }]]),
  ];
}
const c1Domains = (db) => { const acts = c1Actions(db); return fixture(acts, { releases: [release(acts[0])] }); };
const c1Coaches = (db) => seal({ kind: COACH_INSTITUTION_KIND, phase: 't', created_at: 't', actions: [
  { action_id: 'CI-tx', coach_id: 'k-tx-misfiled', coach: 'Tex Misfiled', expected_old: { school: NAME.CA, division: 'NCAA D1', sport: 'mens-soccer', email: coachOf(db, 'k-tx-misfiled').email, email_status: 'verified' }, proposed: { school: NAME.TX, division: 'NCAA D2' }, evidence: 'current staff page', reason: 'filed at the similarly named institution' },
  { action_id: 'CI-wv', coach_id: 'k-wv-misfiled', coach: 'Will Guessed', expected_old: { school: NAME.SC, division: 'NCAA D1', sport: 'mens-soccer', email: coachOf(db, 'k-wv-misfiled').email, email_status: 'inferred' }, proposed: { school: NAME.WV, division: 'NCAA D2' }, evidence: 'current staff page', reason: 'filed at the similarly named institution' }] });
const STAGES = (D, C) => [{ stage_id: 'S1-domains', type: DOMAIN_OWNERSHIP_KIND, fixture: D }, { stage_id: 'S2-relabel', type: COACH_INSTITUTION_KIND, fixture: C }];
const EXPECTED = { 'S1-domains': ['k-tx-head', 'k-tx-misfiled'], 'S2-relabel': [] };
const SENDABLE = ['k-tx-head', 'k-tx-misfiled'];
const HOLDS = holdsFile(SENDABLE);
function approve(db, stages, { eligibility = EXPECTED, sendable = SENDABLE, holds = HOLDS, over = {} } = {}) {
  const ap = { kind: COMPOSITE_APPROVAL_KIND, approval_id: 'AP-C1', ...approvalFields(NOW), basis: 'test', baseline: { eligible_ids_hash: idSetHash(measureInProcess(db).eligible_ids) },
    sendability: { newly_sendable_coaches: sendable, newly_sendable_contacts: [], activation_holds_sha256: holds.sha256 },
    stages: stages.map((s) => ({ stage_id: s.stage_id, type: s.type, group: s.group ?? null, fixture_hash: s.fixture.fixture_hash, eligibility: { added: eligibility[s.stage_id] || [], removed: [] } })), ...over };
  return { ...ap, approval_hash: approvalHash(ap) };
}
const snapshot = (db) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, JSON.stringify(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all())]));
function setup() { const db = world(); const D = c1Domains(db); const C = c1Coaches(db); const stages = STAGES(D, C); return { db, D, C, stages, approval: approve(db, stages) }; }
const run = (db, stages, approval, opts = {}) => runCompositeCorrection(db, stages, approval, { apply: true, now: NOW, activationHoldsFile: HOLDS.file, evidenceDir: STORE_DIR, ...opts });
const CTX = { store, target: 'DISPOSABLE', now };
function applyDomains(db, fx) { db.exec('BEGIN IMMEDIATE'); try { const r = applyDomainOwnershipInTransaction(db, fx, { now: NOW, store, target: 'DISPOSABLE' }); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } }
const problemsOf = (db, fx, ctx = CTX) => planDomainOwnership(db, fx, ctx).problems.join('\n');
const EVIDENCE_COLS = ['claimed_keys', 'claimed_unitids', 'evidence_kind', 'evidence_text', 'identity_method', 'identity_strength', 'http_status', 'final_url', 'verification_method', 'confidence', 'checked_at', 'platform'];

describe('1. the five capabilities', () => {
  it('REASSIGN_OWNER moves a decided host to the authenticated owner, records the old owner as refuted, keeps every evidence column', () => {
    const db = world(); const before = domOf(db, H.RATTLER);
    applyDomains(db, fixture([act(db, H.RATTLER, 'TX', [[H.RATTLER, 'REASSIGN_OWNER', { status: 'VERIFIED' }]], { prev: 'CA', orgId: 1346 })]));
    const after = domOf(db, H.RATTLER);
    expect([after.status, after.unitid, after.athletics_entity_id, after.ownership_class]).toEqual(['VERIFIED', U.TX, E.TX, 'ENTITY_OWNED']);
    expect(JSON.parse(after.wrong_mappings)).toEqual([{ key: NAME.CA, claimantUnitid: U.CA }]);
    for (const c of EVIDENCE_COLS) expect(after[c]).toEqual(before[c]);
    expect(loadRefreshContext(db).resolver.ownerOfHost(H.RATTLER).entity).toBe(E.TX);
  });
  it('RESTORE_OWNER with its www twin pinned (atomic bare/www); PROMOTE_UNOWNED of a twin; PROMOTE of a standalone host', () => {
    const db = world(); const www = domOf(db, `www.${H.CUW}`);
    applyDomains(db, fixture([
      act(db, H.CUW, 'WI', [[H.CUW, 'RESTORE_OWNER', { status: 'VERIFIED' }], [`www.${H.CUW}`, 'CONFIRM']], { twin: true, orgId: 1036 }),
      act(db, H.TWIN, 'CN', [[H.TWIN, 'PROMOTE_UNOWNED', { status: 'VERIFIED_ALIAS', role: 'ATHLETICS_SITE' }], [`www.${H.TWIN}`, 'CONFIRM']], { twin: true, orgId: 1000 }),
      act(db, H.SOLO, 'CA', [[H.SOLO, 'PROMOTE_UNOWNED', { status: 'VERIFIED_ALIAS' }]])]));
    expect(domOf(db, `www.${H.CUW}`)).toEqual(www);
    const r = loadRefreshContext(db).resolver;
    for (const [h, e] of [[H.CUW, E.WI], [`www.${H.CUW}`, E.WI], [H.TWIN, E.CN], [`www.${H.TWIN}`, E.CN], [H.SOLO, E.CA]]) expect(r.ownerOfHost(h).entity).toBe(e);
    expect(domOf(db, H.TWIN).role).toBe('ATHLETICS_SITE');
  });
  it('domain ownership runs before relabels; the reverse order is refused before any write', () => {
    const { db, D, C } = setup(); const rev = [STAGES(D, C)[1], STAGES(D, C)[0]];
    expect(validateComposite(rev, approve(db, rev)).join('\n')).toMatch(/out of order/);
  });
  it('a held host is corrected only with a release bound to the hold, the action, its verified evidence and the reviewer; it stays HELD for every reader', () => {
    const db = world(); const a = act(db, H.HELD, 'TX', [[H.HELD, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'CA', orgId: 1346 });
    expect(problemsOf(db, fixture([a]))).toMatch(/held for external adjudication and the fixture carries no release/);
    applyDomains(db, fixture([a], { releases: [release(a)] }));
    expect(domOf(db, H.HELD).unitid).toBe(U.TX);
    expect(isHeldDomain(H.HELD)).toBe(true);
    expect(loadRefreshContext(db).resolver.ownerOfHost(H.HELD).status).toBe('HELD');
  });
});

describe('2. C1-shaped batch through the composite writer', () => {
  it('commits atomically with exact eligibility AND sendability sets, every newly sendable coach held', () => {
    const { db, stages, approval } = setup();
    const r = run(db, stages, approval);
    expect(r.committed).toBe(true);
    expect(r.report.final.sendability.newly_sendable_coaches).toEqual(SENDABLE);
    expect(r.report.final.sendability.newly_sendable_contacts).toEqual([]);
    expect(r.report.final.sendability.all_newly_sendable_held).toBe(true);
    expect(coachOf(db, 'k-tx-misfiled').school).toBe(NAME.TX);
  });
  it('without the domain stage the relabel is refused (the DI-03 dependency)', () => {
    const { db, C } = setup(); const only = [{ stage_id: 'S2-relabel', type: COACH_INSTITUTION_KIND, fixture: C }];
    expect(() => run(db, only, approve(db, only, { eligibility: { 'S2-relabel': [] }, sendable: [] }))).toThrow(/resolve elsewhere/);
  });
  it('touches only the corrected domain rows and the relabelled coaches\' school/division', () => {
    const { db, stages, approval } = setup(); const before = snapshot(db); run(db, stages, approval);
    const after = snapshot(db);
    expect(Object.keys(before).filter((t) => before[t] !== after[t]).sort()).toEqual(['athletics_domains', 'coaches']);
  });
});

describe('3. F1 / x1 — sendability, not eligibility (CRITICAL)', () => {
  /** x1: a coach eligible at baseline as REASSIGN (refused at send: programme mismatch) who a correction makes KEEP */
  function x1World() {
    const db = world();
    const src = `https://${H.UWV}/sports/mens-soccer/coaches`;
    db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, email_source_url, currentness_status, currentness_source_url, email_seen_on_source_at, email_seen_on_source_url) VALUES ('k-x','t','Xena Reassign','xena@uwv.test',?, 'NCAA D2','mens-soccer','Head Coach','verified',?,'CURRENT',?,'2026-09-20T00:00:00Z',?)").run(NAME.WV, src, src, src);
    db.prepare("INSERT INTO coach_seasons (school, sport, season, coach_name, source_url, imported_at) VALUES (?, 'mens-soccer', 2024, 'Xena Reassign', ?, 't')").run(NAME.SC, src);
    return db;
  }
  const uwvOnly = (db) => { const D = fixture([act(db, H.UWV, 'WV', [[H.UWV, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'SC', orgId: 1013 })]); return [{ stage_id: 'S1', type: DOMAIN_OWNERSHIP_KIND, fixture: D }]; };
  it('the exploit world reproduces: baseline-eligible REASSIGN coach refused at send time', () => {
    const db = x1World(); const d = canonicalDecisions(db, { fresh: true });
    expect(d.byCoach.get('k-x').outreach_eligibility).toBe('YES');
    expect(canonicalDecisionIneligibility(coachOf(db, 'k-x'), d)).toMatch(/PROGRAMME_MISMATCH/);
  });
  it('a correction that makes it sendable is refused unless approved in the exact sendable set', () => {
    const db = x1World(); const st = uwvOnly(db);
    expect(() => run(db, st, approve(db, st, { eligibility: { S1: [] }, sendable: [] }))).toThrow(/newly sendable coaches are not the approved set/);
  });
  it('approved but not held is still refused; approved and held commits', () => {
    const db = x1World(); const st = uwvOnly(db); const before = snapshot(db);
    expect(() => run(db, st, approve(db, st, { eligibility: { S1: [] }, sendable: ['k-x'] }))).toThrow(/without an activation hold/);
    expect(snapshot(db)).toEqual(before);
    const h = holdsFile(['k-x']);
    let r; try { r = run(db, st, approve(db, st, { eligibility: { S1: [] }, sendable: ['k-x'], holds: h }), { activationHoldsFile: h.file }); } catch (e) { throw new Error(`${e.message}: ${(e.problems || []).join(' | ')}`); }
    expect(r.report.final.sendability.newly_sendable_were['k-x']).toMatch(/PROGRAMME_MISMATCH/);
  });
  it('F2: the guard runs for every composite — a relabel-only composite that opens a coach is refused too', () => {
    const db = x1World(); applyDomains(db, fixture([act(db, H.UWV, 'WV', [[H.UWV, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'SC', orgId: 1013 })]));
    // now a relabel of the TX coach (eligible as REASSIGN, refused at CA) to TX opens him
    applyDomains(db, fixture([act(db, H.RATTLER, 'TX', [[H.RATTLER, 'REASSIGN_OWNER', { status: 'VERIFIED' }]], { prev: 'CA', orgId: 1346 })]));
    const C = c1Coaches(db); const st = [{ stage_id: 'S2-relabel', type: COACH_INSTITUTION_KIND, fixture: { ...C, actions: [C.actions[0]], fixture_hash: undefined } }];
    st[0].fixture = seal(st[0].fixture);
    expect(() => run(db, st, approve(db, st, { eligibility: { 'S2-relabel': [] }, sendable: [] }))).toThrow(/newly sendable coaches are not the approved set/);
  });
  it('a correction that would make a programme inbox sendable is refused (inboxes carry no hold)', () => {
    const { db, stages } = setup();
    expect(validateComposite(stages, { ...approve(db, stages), sendability: { newly_sendable_coaches: [], newly_sendable_contacts: ['pc-1'], activation_holds_sha256: HOLDS.sha256 } }).join('\n')).toMatch(/programme inbox/);
  });
});

describe('4. F3 — one strict approval validator', () => {
  const ok = { approval_id: 'A', ...approvalFields(NOW), basis: 'reviewed' };
  const probs = (over, target = TARGET.DISPOSABLE) => approvalProblems({ ...ok, ...over }, { target, now }).join('\n');
  it('accepts an allow-listed reviewer within scope and dates', () => expect(probs({})).toBe(''));
  it('rejects NOT APPROVED, pending, stand-in, TBD and placeholder text', () => {
    for (const b of ['NOT APPROVED — rehearsal', 'pending review', 'stand-in reviewer', 'TBD', 'to be supplied', '<reviewer name>']) expect(probs({ basis: b })).toMatch(/placeholder/);
  });
  it('rejects a missing, unknown or free-text reviewer', () => {
    expect(probs({ reviewer_id: undefined })).toMatch(/not an authorised reviewer/);
    expect(probs({ reviewer_id: 'someone' })).toMatch(/not an authorised reviewer/);
    expect(probs({ approved_by: 'Independent Reviewer' })).toMatch(/is not the name of reviewer/);
  });
  it('a DISPOSABLE_ONLY reviewer can never authorise a runtime database', () => expect(probs({}, TARGET.RUNTIME)).toMatch(/disposable copies only/));
  it('rejects expired, future-dated, open-ended and over-long approvals', () => {
    expect(probs({ approved_at: '2026-09-01', expires_at: '2026-09-05' })).toMatch(/expired/);
    expect(probs({ approved_at: '2026-12-01', expires_at: '2026-12-05' })).toMatch(/in the future/);
    expect(probs({ expires_at: undefined })).toMatch(/expires_at/);
    expect(probs({ approved_at: '2026-10-01', expires_at: '2026-11-30' })).toMatch(/exceeds 14 days/);
  });
  it('the composite refuses its own invalid approval, a fixture approval or release by another reviewer, and changed hashes/scope', () => {
    const { db, stages, approval } = setup();
    const bad = (ap) => { const b = { ...ap }; delete b.approval_hash; return { ...b, approval_hash: approvalHash(b) }; };
    expect(() => run(db, stages, bad({ ...approval, approved_by: 'NOT APPROVED — rehearsal only' }))).toThrow(/refused/);
    expect(() => run(db, stages, { ...approval, basis: 'edited after signing' })).toThrow(/refused/);
    const acts = c1Actions(db);
    const foreign = fixture(acts, { releases: [release(acts[0])], approval: { reviewer_id: 'rhys-davies', approved_by: 'Rhys Davies' } });
    const st = STAGES(foreign, c1Coaches(db));
    expect(validateComposite(st, approve(db, st), { target: 'DISPOSABLE', now }).join('\n')).toMatch(/is not the composite approval's data-integrity-rehearsal/);
    expect(problemsOf(db, fixture(acts, { releases: [release(acts[0])], hosts: [...acts.map((a) => a.host), 'extra.test'] }))).toMatch(/not exactly the hosts/);
  });
});

describe('5. F4 / F5 / x2-A — evidence is bytes the engine verifies, never a declaration', () => {
  const base = (db) => act(db, H.RATTLER, 'TX', [[H.RATTLER, 'REASSIGN_OWNER', { status: 'VERIFIED' }]], { prev: 'CA', orgId: 1346 });
  const refused = (edit, re) => { const db = world(); const a = base(db); edit(a, db); expect(problemsOf(db, fixture([a]))).toMatch(re); };
  it('fabricated sha (bytes not in the store) / unregistered source / bytes that do not hash to their name', () => {
    refused((a) => { a.evidence.host_to_institution.sha256 = 'f'.repeat(64); }, /not in the store/);
    refused((a) => { a.evidence.official = [{ source_id: 'MY_OWN_IPEDS' }]; }, /not a registered official source/);
    const db = world(); const a = base(db);
    a.evidence.host_to_institution = fetchRec(`https://${H.RATTLER}/`, `https://${H.RATTLER}/`, `${PAGES[H.RATTLER]}<!-- unique -->`);
    fs.writeFileSync(path.join(STORE_DIR, a.evidence.host_to_institution.sha256), 'tampered');
    expect(problemsOf(db, fixture([a]), { ...CTX, store: evidenceStore(STORE_DIR) })).toMatch(/do not hash to their name/);
  });
  it('stale or undated pages, wrong host, non-200 and self-asserted page metadata are refused', () => {
    refused((a) => { a.evidence.host_to_institution = fetchRec(`https://${H.RATTLER}/`, `https://${H.RATTLER}/`, PAGES[H.RATTLER], { retrieved_at: '1999-01-01' }); }, /not within 30 days/);
    refused((a) => { a.evidence.host_to_institution = fetchRec(`https://attacker.test/`, `https://${H.RATTLER}/`, PAGES[H.RATTLER]); }, /url must be https on rattler.test/);
    refused((a) => { a.evidence.host_to_institution = fetchRec(`https://${H.RATTLER}/`, `https://parked.test/`, PAGES[H.RATTLER]); }, /landed on parked.test/);
    refused((a) => { a.evidence.host_to_institution = fetchRec(`https://${H.RATTLER}/`, `https://${H.RATTLER}/`, PAGES[H.RATTLER], { status: 404 }); }, /http_status must be 200/);
    // names_owner / self_identification declarations are ignored: the page must actually name the owner
    refused((a) => { a.evidence.host_to_institution = { ...fetchRec(`https://${H.RATTLER}/`, `https://${H.RATTLER}/`, html('Parked domain')), names_owner: true, self_identification: 'St. Example University' }; }, /does not name the owner/);
  });
  it('the page must name the owner more specifically than the previous owner, and carry its location for a reassignment', () => {
    refused((a) => { a.evidence.host_to_institution = fetchRec(`https://${H.RATTLER}/`, `https://${H.RATTLER}/`, html('Saint Example College of California Athletics', 'Moraga, California')); }, /does not name the owner|rival/);
  });
  it('location for a reassignment: shown on the page, or official listing + every rival in another state; same-state rivals need it shown', () => {
    // rattler.test (TX) vs the previous owner (CA): the official NCAA listing in TX separates them without the page showing it
    const db = world(); const a = base(db);
    a.evidence.host_to_institution = fetchRec(`https://${H.RATTLER}/`, `https://${H.RATTLER}/`, html('St. Example University Athletics', 'no address here'));
    expect(problemsOf(db, fixture([a]))).toBe('');
    // uwv.test (WV) vs the previous owner (SC) — move SC into WV: now the page itself must show Charleston, WV
    const db2 = world(); const b = act(db2, H.UWV, 'WV', [[H.UWV, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'SC', orgId: 1013 });
    b.evidence.host_to_institution = fetchRec(`https://${H.UWV}/`, `https://${H.UWV}/`, html('Home - Example University', 'no address here'));
    const csv = fs.readFileSync(path.join(FIX, 'ipeds_test.csv'), 'utf8');
    expect(csv).toMatch(/910003,.*"SC"/); // the fixture places the rival in SC: the official listing alone suffices here
    expect(problemsOf(db2, fixture([b]))).toBe('');
    // a refuted rival in the SAME state (910007, Charleston WV): the official listing no longer separates them by state,
    // so the page itself must show the location
    const db3 = world();
    db3.prepare('UPDATE athletics_domains SET claimed_unitids=?, wrong_mappings=? WHERE domain=?').run(JSON.stringify([U.SC, U.WV, 910007]), JSON.stringify([{ key: 'Example State University', claimantUnitid: 910007 }]), H.UWV);
    const c = act(db3, H.UWV, 'WV', [[H.UWV, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'SC', orgId: 1013 });
    c.evidence.host_to_institution = fetchRec(`https://${H.UWV}/`, `https://${H.UWV}/`, html('Home - Example University', 'no address here'));
    expect(problemsOf(db3, fixture([c]))).toMatch(/needs the owner's location/);
    const d = act(db3, H.UWV, 'WV', [[H.UWV, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'SC', orgId: 1013 });
    expect(problemsOf(db3, fixture([d]))).toBe(''); // the default page shows "Charleston, West Virginia"
  });
  it('F5: an official record must list EXACTLY this host — a suffix or sibling host is not a listing; shared platforms are refused', () => {
    const db = world();
    db.prepare("INSERT INTO athletics_domains (domain, status, role, unitid, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES ('news.uwv.test','INSUFFICIENT_EVIDENCE','UNKNOWN',NULL,'[]',?, 'PAGE_SELF_IDENTIFICATION','NONE','2026-09-01')").run(JSON.stringify([U.WV]));
    const a = act(db, 'news.uwv.test', 'WV', [['news.uwv.test', 'PROMOTE_UNOWNED', { status: 'VERIFIED_ALIAS' }]], { orgId: 1013 });
    a.evidence.host_to_institution = fetchRec('https://news.uwv.test/', 'https://news.uwv.test/', PAGES[H.UWV]);
    expect(problemsOf(db, fixture([a]))).toMatch(/no official record lists news.uwv.test/);
    db.prepare("INSERT INTO athletics_domains (domain, status, role, unitid, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES ('example.sidearmsports.com','INSUFFICIENT_EVIDENCE','UNKNOWN',NULL,'[]',?, 'PAGE_SELF_IDENTIFICATION','NONE','2026-09-01')").run(JSON.stringify([U.WV]));
    const b = act(db, 'example.sidearmsports.com', 'WV', [['example.sidearmsports.com', 'PROMOTE_UNOWNED', { status: 'VERIFIED_ALIAS' }]], { orgId: 1013 });
    b.evidence.host_to_institution = fetchRec('https://example.sidearmsports.com/', 'https://example.sidearmsports.com/', PAGES[H.UWV]);
    expect(problemsOf(db, fixture([b]))).toMatch(/shared hosting platform/);
  });
  it('an NCAA org not bound to the owner (other state / no common website), or for another academic year, is refused', () => {
    refused((a) => { a.evidence.official = [IPEDS, ncaa(1013)]; }, /not bound to UNITID 228149/);
    const db = world();
    db.prepare("INSERT INTO athletics_domains (domain, status, role, unitid, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES ('lastyearathletics.test','INSUFFICIENT_EVIDENCE','UNKNOWN',NULL,'[]',?, 'PAGE_SELF_IDENTIFICATION','NONE','2026-09-01')").run(JSON.stringify([U.OTHER]));
    const a = act(db, 'lastyearathletics.test', 'OTHER', [['lastyearathletics.test', 'PROMOTE_UNOWNED', { status: 'VERIFIED_ALIAS', role: 'ATHLETICS_SITE' }]], { orgId: 9002 });
    expect(problemsOf(db, fixture([a]))).toMatch(/academic year 2026|not bound/);
  });
  it('a TEST_ONLY official source can never support a runtime correction', () => {
    const db = world();
    expect(problemsOf(db, fixture([base(db)]), { ...CTX, target: 'RUNTIME' })).toMatch(/TEST_ONLY source/);
  });
  it('another institution listed for the same host is unresolved contradictory evidence', () => {
    const db = world();
    // scathletics.test is listed by IPEDS for SC; claim it for WV
    db.prepare("UPDATE athletics_domains SET status='INSUFFICIENT_EVIDENCE', unitid=NULL, claimed_unitids=? WHERE domain='scathletics.test'").run(JSON.stringify([U.WV]));
    const a = act(db, 'scathletics.test', 'WV', [['scathletics.test', 'PROMOTE_UNOWNED', { status: 'VERIFIED_ALIAS' }]], { orgId: 1013 });
    a.evidence.host_to_institution = fetchRec('https://scathletics.test/', 'https://scathletics.test/', PAGES[H.UWV]);
    const pr = problemsOf(db, fixture([a]));
    expect(pr).toMatch(/IPEDS also lists scathletics.test for UNITID 910003 — unresolved contradictory evidence/);
  });
});

describe('6. F6 / F8 / F11 / x2-B,C — held-domain release', () => {
  const held = () => { const db = world(); const a = act(db, H.HELD, 'TX', [[H.HELD, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'CA', orgId: 1346 }); return { db, a }; };
  it('a release not bound to this action\'s verified evidence or approval is refused', () => {
    const { db, a } = held();
    for (const [over, re] of [[{ evidence: { self_identification_sha256: 'a'.repeat(64), official_source_ids: ['TEST_IPEDS_DI03D'] } }, /not the page this action verified/],
      [{ evidence: { self_identification_sha256: a.evidence.host_to_institution.sha256, official_source_ids: ['IPEDS_HD2024_CSV'] } }, /not the sources this action verified/],
      [{ approval_id: 'AP-OTHER' }, /approval AP-OTHER/], [{ released_to_unitid: U.CA }, /other disputed owner|settles on/], [{ hold_recorded: '2026-10-01' }, /hold_recorded/],
      [{ domain: 'STMARYTX.EDU' }, /not exactly the held domain|does not belong/], [{ reason: 'ok' }, /documented reason/]]) {
      expect(problemsOf(db, fixture([a], { releases: [release(a, over)] }))).toMatch(re);
    }
  });
  it('a release signed by a placeholder or unauthorised reviewer is refused by the composite', () => {
    const { db, a } = held();
    for (const over of [{ approved_by: 'TBD' }, { reviewer_id: 'someone', approved_by: 'Independent Reviewer' }, { approved_by: 'pending' }]) {
      const D = fixture([a], { releases: [release(a, over)] }); const st = [{ stage_id: 'S1', type: DOMAIN_OWNERSHIP_KIND, fixture: D }];
      expect(validateComposite(st, approve(db, st), { target: 'DISPOSABLE', now }).join('\n')).toMatch(/hold release/);
    }
  });
  it('a code-level release lifts the hold only with a committed manifest that proves the correction', () => {
    const hold = holdRecord(H.HELD); const { a } = held();
    const rel = { ...release(a), applied_correction: { manifest_path: 'docs/validation/corrections/x.json', manifest_sha256: 'f'.repeat(64) } };
    expect(appliedReleaseProblems(rel, hold, null).join('\n')).toMatch(/not in the repository/);
    const fake = Buffer.from(JSON.stringify({ phase: 'COMPOSITE_CORRECTION', approval_id: 'AP-D', manifest: [] }));
    expect(appliedReleaseProblems({ ...rel, applied_correction: { ...rel.applied_correction, manifest_sha256: sha256(fake) } }, hold, fake).join('\n')).toMatch(/does not contain the update/);
    expect(appliedReleaseProblems(rel, hold, fake).join('\n')).toMatch(/do not hash/);
    const real = Buffer.from(JSON.stringify({ phase: 'COMPOSITE_CORRECTION', approval_id: 'AP-D', manifest: [{ entries: [{ kind: 'UPDATE', table: 'athletics_domains', key: { domain: H.HELD }, old: { unitid: U.CA }, new: { unitid: U.TX } }] }] }));
    expect(appliedReleaseProblems({ ...rel, applied_correction: { ...rel.applied_correction, manifest_sha256: sha256(real) } }, hold, real)).toEqual([]);
    expect(appliedReleaseProblems({ ...rel, applied_correction: { manifest_path: '../outside.json', manifest_sha256: sha256(real) } }, hold, real).join('\n')).toMatch(/committed file under/);
  });
  it('F11: isHeldDomain takes no releases option; array-callback use is safe', () => {
    expect(isHeldDomain(H.HELD, { releases: [{ domain: H.HELD }] })).toBe(true);
    expect(['x.test', H.HELD].map(isHeldDomain)).toEqual([false, true]);
    expect(holdReleaseProblems(null, holdRecord(H.HELD))).toEqual(['no release record']);
  });
});

describe('7. F7 / F13 / x3 — host family by normalised identity', () => {
  for (const variant of ['UWV.TEST', 'uwv.test.', 'WWW.uwv.test']) {
    it(`a variant spelling ${JSON.stringify(variant)} refuses the family at plan time (never corrected or discarded silently)`, () => {
      const db = world();
      db.prepare("INSERT INTO athletics_domains (domain, status, role, unitid, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES (?, 'VERIFIED_ALIAS','INSTITUTION_SITE',?, '[]',?, 'PAGE_SELF_IDENTIFICATION','CERTAIN','2026-09-01')").run(variant, U.SC, JSON.stringify([U.SC]));
      expect(problemsOf(db, fixture([act(db, H.UWV, 'WV', [[H.UWV, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'SC', orgId: 1013 })]))).toMatch(/non-canonically/);
    });
  }
  it('a held family is refused too if a variant exists (x2-B)', () => {
    const db = world();
    db.prepare("INSERT INTO athletics_domains (domain, status, role, unitid, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES ('STMARYTX.EDU','VERIFIED_ALIAS','INSTITUTION_SITE',?, '[]',?, 'PAGE_SELF_IDENTIFICATION','CERTAIN','2026-09-01')").run(U.CA, JSON.stringify([U.CA]));
    const a = act(db, H.HELD, 'TX', [[H.HELD, 'REASSIGN_OWNER', { status: 'VERIFIED_ALIAS' }]], { prev: 'CA', orgId: 1346 });
    expect(problemsOf(db, fixture([a], { releases: [release(a)] }))).toMatch(/non-canonically/);
  });
  it('F13: expected_old with keys that are not columns is refused', () => {
    const db = world(); const a = act(db, H.RATTLER, 'TX', [[H.RATTLER, 'REASSIGN_OWNER', { status: 'VERIFIED' }]], { prev: 'CA', orgId: 1346 });
    a.rows[0].expected_old.not_a_column = 1;
    expect(problemsOf(db, fixture([a]))).toMatch(/unknown not_a_column/);
  });
  it('twin omitted, missing equivalence, and forms landing on different pages are refused', () => {
    const db = world();
    expect(problemsOf(db, fixture([act(db, H.CUW, 'WI', [[H.CUW, 'RESTORE_OWNER', { status: 'VERIFIED' }]], { orgId: 1036 })]))).toMatch(/exist\(s\) but is not in the action/);
    expect(problemsOf(db, fixture([act(db, H.CUW, 'WI', [[H.CUW, 'RESTORE_OWNER', { status: 'VERIFIED' }], [`www.${H.CUW}`, 'CONFIRM']], { orgId: 1036 })]))).toMatch(/evidence.equivalence/);
    const a = act(db, H.CUW, 'WI', [[H.CUW, 'RESTORE_OWNER', { status: 'VERIFIED' }], [`www.${H.CUW}`, 'CONFIRM']], { twin: true, orgId: 1036 });
    a.evidence.equivalence.www = fetchRec(`https://www.${H.CUW}/`, `https://www.${H.CUW}/elsewhere`, html('other'));
    expect(problemsOf(db, fixture([a]))).toMatch(/different pages|neither serve/);
  });
});

describe('8. F9 / F10 — the activation-holds source is the target database\'s own', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'di03d-target-'));
  it('a database in a checkout\'s server/data is RUNTIME and is checked against ITS seeds holds file; naming another is refused', () => {
    const root = tmp(); fs.mkdirSync(path.join(root, 'server/data/seeds'), { recursive: true });
    const dbFile = path.join(root, 'server/data/recruitmatch.sqlite'); new Database(dbFile).close();
    const own = path.join(root, 'server/data/seeds/coach_activation_holds.json'); fs.copyFileSync(HOLDS.file, own);
    const db = new Database(dbFile);
    expect(correctionTarget(db).target).toBe('RUNTIME');
    expect(correctionTarget(db).holdsFile).toBe(fs.realpathSync.native(own));
    expect(() => correctionTarget(db, { activationHoldsFile: holdsFile(['k-x']).file })).toThrow(/no other holds file can stand in/);
    db.close();
  });
  it('a hard link to a database cannot pass as a disposable copy; a disposable copy must name its holds file', () => {
    const d = tmp(); const f = path.join(d, 'copy.sqlite'); new Database(f).close(); fs.linkSync(f, path.join(d, 'link.sqlite'));
    const db = new Database(path.join(d, 'link.sqlite'));
    expect(() => correctionTarget(db, { activationHoldsFile: HOLDS.file })).toThrow(/hard links/);
    db.close();
    const d2 = tmp(); const db2 = new Database(path.join(d2, 'scratch.sqlite'));
    expect(() => correctionTarget(db2)).toThrow(/must name its activation-holds file/);
    expect(correctionTarget(db2, { activationHoldsFile: HOLDS.file }).target).toBe('DISPOSABLE');
    db2.close();
  });
  it('a missing or inconsistent holds file fails closed; an approval made against different holds is refused', () => {
    const { db, stages, approval } = setup();
    expect(() => run(db, stages, approval, { activationHoldsFile: path.join(os.tmpdir(), 'missing-holds.json') })).toThrow(/does not exist/);
    const bad = path.join(tmp(), 'bad.json'); fs.writeFileSync(bad, JSON.stringify({ kind: 'COACH_ACTIVATION_HOLDS', counts: { X: 9 }, holds: [{ coach_id: 'k-tx-head', hold: 'X' }] }));
    expect(() => run(db, stages, approval, { activationHoldsFile: bad })).toThrow(/unreadable or inconsistent/);
    const other = holdsFile(SENDABLE, 'OTHER_HOLD');
    let err; try { run(db, stages, approval, { activationHoldsFile: other.file }); } catch (e) { err = e; }
    expect((err?.problems || []).join('\n')).toMatch(/approval was made against activation holds/);
  });
});

describe('9. atomic rollback and revert (x4)', () => {
  const points = ['begin', 'sendability:before', 'stage:S1-domains:begin', 'stage:S1-domains:action', 'stage:S1-domains:written', 'stage:S1-domains:eligibility',
    'stage:S2-relabel:begin', 'stage:S2-relabel:action', 'stage:S2-relabel:written', 'stage:S2-relabel:eligibility', 'final:integrity', 'final:sendability', 'final:precommit'];
  for (const p of points) {
    it(`a throw at ${p} rolls back every stage`, () => {
      const { db, stages, approval } = setup(); const before = snapshot(db); let reached = false;
      expect(() => run(db, stages, approval, { inject: (x) => { if (x === p) { reached = true; throw new Error(`injected at ${p}`); } } })).toThrow(/injected/);
      expect(reached).toBe(true);
      expect(snapshot(db)).toEqual(before);
    });
  }
  it('rehearsal (apply=false) runs every gate and leaves the database byte-identical', () => {
    const { db, stages, approval } = setup(); const before = snapshot(db);
    expect(runCompositeCorrection(db, stages, approval, { apply: false, now: NOW, activationHoldsFile: HOLDS.file, evidenceDir: STORE_DIR }).committed).toBe(false);
    expect(snapshot(db)).toEqual(before);
  });
  it('a committed correction reverts to the exact prior state and baseline; a second revert is refused', () => {
    const { db, stages, approval } = setup(); const before = snapshot(db);
    const r = run(db, stages, approval);
    expect(r.manifest.manifest.flatMap((m) => m.entries).length).toBe(8);
    expect(revertComposite(db, r.manifest, { apply: true }).eligible_ids_hash).toBe(approval.baseline.eligible_ids_hash);
    expect(snapshot(db)).toEqual(before);
    expect(() => revertComposite(db, r.manifest, { apply: true })).toThrow(/revert refused/);
  });
  it('the domain manifest alone is revertible with the promotion revert', () => {
    const db = world(); const before = snapshot(db);
    const r = applyDomains(db, c1Domains(db));
    db.exec('BEGIN'); revertManifest(db, r.manifest, { inTransaction: true }); db.exec('COMMIT');
    expect(snapshot(db)).toEqual(before);
  });
  it('the transaction-compatible apply refuses outside a caller-owned transaction, and without an evidence store', () => {
    const db = world();
    expect(() => applyDomainOwnershipInTransaction(db, c1Domains(db))).toThrow(/caller-owned open transaction/);
    expect(planDomainOwnership(db, c1Domains(db)).problems.join('\n')).toMatch(/evidence store is required/);
  });
});

describe('10. test inputs are honest', () => {
  it('the test reviewer is the allow-listed DISPOSABLE_ONLY identity', () => {
    expect(approvalProblems({ ...approvalFields(NOW), basis: 'x' }, { target: TARGET.RUNTIME, now }).join('\n')).toMatch(/disposable copies only/);
    expect(TEST_REVIEWER.reviewer_id).toBe('data-integrity-rehearsal');
  });
});
