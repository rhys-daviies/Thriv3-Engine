import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../../db/migrate.js';
import { applyProtectedCorrections, planProtectedCorrections, fixtureHash, ownershipPostcheck, PROTECTED_CORRECTION_KIND } from './protectedCorrection.js';
import { revertManifest } from './promotion.js';
import { loadRefreshContext } from './context.js';
import { forInstitution } from '../../../shared/evidence/domainAuthority.js';

/**
 * PHASE 8C.5D — the protected-correction path. A WRONG_INSTITUTION row whose stored UNITID is
 * the true owner (the refutation was of ANOTHER claimant) may be reversed only by an approved,
 * complete-expected-old fixture; the refuted claimant stays refused. Institutions are invented.
 */
const SCHEMA = fs.readFileSync(path.resolve(import.meta.dirname, '../../db/schema.sql'), 'utf8');
const OWN = 142001; const CLAIM = 240001; const OTHER = 300001; const UNAPPROVED = 230001;
const wrongRow = (domain, unitid, claimKey, claimUnitid, ownKey) => ({
  domain, unitid, status: 'WRONG_INSTITUTION', role: 'ATHLETICS_SITE', claimed_keys: JSON.stringify([ownKey, claimKey]), claimed_unitids: JSON.stringify([unitid, claimUnitid].sort((a, b) => a - b)),
  wrong_mappings: JSON.stringify([{ key: claimKey, claimantUnitid: claimUnitid }]), evidence_kind: 'OG_SITE_NAME', evidence_text: `${ownKey} Athletics`, identity_method: 'VARIANT', identity_strength: 'WHOLE_NAME',
  platform: 'SIDEARM', http_status: 200, final_url: `https://${domain}/`, verification_method: 'PAGE_SELF_IDENTIFICATION', confidence: 'CERTAIN', notes: null, checked_at: '2026-09-01T09:28:40.920Z', athletics_entity_id: null, ownership_class: null,
});
function world() {
  const db = new Database(':memory:'); db.exec(SCHEMA); migrate(db);
  const ent = db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES (?,?,?,'SINGLE','t','t')");
  ent.run('AE-OWN', 'Owner College', OWN); ent.run('AE-CLAIM', 'Claimant College', CLAIM); ent.run('AE-OTHER', 'Other College', OTHER); ent.run('AE-UNAPPROVED', 'Unapproved College', UNAPPROVED);
  const ins = (r) => db.prepare(`INSERT INTO athletics_domains (${Object.keys(r).join(',')}) VALUES (${Object.keys(r).map((k) => `@${k}`).join(',')})`).run(r);
  ins(wrongRow('athletics.owner.edu', OWN, 'Claimant', CLAIM, 'Owner College'));
  ins(wrongRow('otherhost.com', OTHER, 'Claimant', CLAIM, 'Other College'));
  ins(wrongRow('unapproved.com', UNAPPROVED, 'Claimant', CLAIM, 'Unapproved College'));
  const col = db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES (?,'t','t',?,?,'NJCAA',1,?,?)");
  col.run('c-own-m', 'Owner College', 'mens-soccer', OWN, 'AE-OWN'); col.run('c-claim-m', 'Claimant College', 'mens-soccer', CLAIM, 'AE-CLAIM');
  return db;
}
const rowOf = (db, d) => db.prepare('SELECT * FROM athletics_domains WHERE domain = ?').get(d);
const action = (db, over = {}) => {
  const host = over.host || 'athletics.owner.edu';
  return { action_id: `PC-${host}`, approval_id: 'APPROVAL-1', host, true_entity: 'AE-OWN', unitid: OWN,
    transition: { from_status: 'WRONG_INSTITUTION', to_status: 'VERIFIED', from_ownership_class: null, to_ownership_class: 'ENTITY_OWNED' },
    wrong_claimants: [{ key: 'Claimant', claimantUnitid: CLAIM }], expected_old: { ...rowOf(db, host.replace(/^www\./, '')) },
    evidence: { institution_to_host: 'owner.edu links the host', host_to_institution: "og:site_name 'Owner College Athletics'" },
    original_adjudication: { tool: 'verifyAthleticsDomains.js', timestamp: '2026-09-01T09:28:40.920Z', why_wrong: 'one refuted claim became the row status' },
    reason: 'test reversal', blast_radius: 'one row', ...over };
};
const fixture = (corrections, approvals = [{ approval_id: 'APPROVAL-1', approved_by: 'reviewer', approved_at: '2026-10-07', basis: 'test', hosts: ['athletics.owner.edu', 'otherhost.com'] }]) => {
  const fx = { kind: PROTECTED_CORRECTION_KIND, phase: 'test', created_at: 't', approvals, corrections };
  return { ...fx, fixture_hash: fixtureHash(fx) };
};
const run = (db, fx, opts = {}) => applyProtectedCorrections(db, fx, { apply: true, now: '2026-10-07T00:00:00Z', postcheck: ownershipPostcheck, ...opts });
const resolver = (db) => loadRefreshContext(db).resolver;

describe('protected source correction', () => {
  it('1. exact expected-old succeeds; only status / entity / ownership_class / notes change', () => {
    const db = world(); const before = rowOf(db, 'athletics.owner.edu');
    const r = run(db, fixture([action(db)]));
    expect(r.applied).toBe(1);
    const after = rowOf(db, 'athletics.owner.edu');
    expect(after).toMatchObject({ status: 'VERIFIED', athletics_entity_id: 'AE-OWN', ownership_class: 'ENTITY_OWNED', unitid: OWN });
    for (const k of Object.keys(before).filter((k) => !['status', 'athletics_entity_id', 'ownership_class', 'notes'].includes(k))) expect(after[k]).toEqual(before[k]);
    expect(after.notes).toMatch(/PROTECTED_CORRECTION PC-athletics\.owner\.edu .*why wrong: one refuted claim.*Claimant \(240001\)/);
  });

  it('2. a mismatched expected-old refuses (and an incomplete one too)', () => {
    const db = world(); const a = action(db); a.expected_old.checked_at = '2026-09-02T00:00:00Z';
    expect(() => run(db, fixture([a]))).toThrow(/refused/);
    const b = action(db); delete b.expected_old.notes;
    expect(planProtectedCorrections(db, fixture([b])).problems[0]).toMatch(/complete row \(missing notes\)/);
    expect(rowOf(db, 'athletics.owner.edu').status).toBe('WRONG_INSTITUTION');
  });

  it('3. a WRONG_INSTITUTION row without an approval naming it refuses', () => {
    const db = world();
    const a = action(db, { host: 'unapproved.com', true_entity: 'AE-UNAPPROVED', unitid: UNAPPROVED });
    expect(planProtectedCorrections(db, fixture([a])).problems[0]).toMatch(/no approval record APPROVAL-1 covering unapproved\.com/);
    expect(planProtectedCorrections(db, fixture([action(db)], [])).problems[0]).toMatch(/no approval record/);
    expect(planProtectedCorrections(db, { ...fixture([action(db)]), kind: 'DOMAIN_REGISTER' }).problems[0]).toMatch(/fixture kind must be/);
  });

  it('4. a UNITID that is not the stored owner refuses', () => {
    const db = world();
    expect(planProtectedCorrections(db, fixture([action(db, { unitid: CLAIM })])).problems[0]).toMatch(/is not the row's stored owner/);
  });

  it('5. an entity that is not the SINGLE entity of the stored UNITID refuses', () => {
    const db = world();
    expect(planProtectedCorrections(db, fixture([action(db, { true_entity: 'AE-OTHER' })])).problems[0]).toMatch(/is not the SINGLE entity of UNITID 142001/);
    expect(planProtectedCorrections(db, fixture([action(db, { true_entity: 'AE-NOPE' })])).problems[0]).toMatch(/does not exist/);
  });

  it('6. the refuted claimant stays refused, and its refusal cannot be dropped or rewritten', () => {
    const db = world();
    expect(planProtectedCorrections(db, fixture([action(db, { wrong_claimants: [] })])).problems[0]).toMatch(/must equal the stored refusals/);
    expect(planProtectedCorrections(db, fixture([action(db, { wrong_claimants: [{ key: 'Someone', claimantUnitid: OTHER }] })])).problems[0]).toMatch(/must equal the stored refusals/);
    run(db, fixture([action(db)]));
    const row = rowOf(db, 'athletics.owner.edu'); const r = resolver(db);
    expect(JSON.parse(row.wrong_mappings)).toEqual([{ key: 'Claimant', claimantUnitid: CLAIM }]);
    expect(r.hostOwnedBy('athletics.owner.edu', 'AE-CLAIM')).toBe(false);
    expect(r.sourceOwnedBy('https://athletics.owner.edu/sports/mens-soccer/roster', 'AE-CLAIM', { sport: 'mens-soccer' })).toBe(false);
    expect(forInstitution(row, CLAIM)).toBe(false);
    expect(r.resolve({ source_url: 'https://athletics.owner.edu/sports/mens-soccer/roster', raw_name: 'Claimant College', sport: 'mens-soccer' }).decision).not.toBe('RESOLVED');
  });

  it('7. the true owner becomes authoritative', () => {
    const db = world(); const r0 = resolver(db);
    expect(r0.ownerOfHost('athletics.owner.edu').status).toBe('WRONG_INSTITUTION');
    run(db, fixture([action(db)]));
    const r = resolver(db); const row = rowOf(db, 'athletics.owner.edu');
    expect(r.ownerOfHost('athletics.owner.edu')).toMatchObject({ entity: 'AE-OWN', via: 'EXACT_HOST' });
    expect(r.resolve({ source_url: 'https://athletics.owner.edu/sports/mens-soccer/roster', raw_name: 'Owner College', sport: 'mens-soccer' })).toMatchObject({ decision: 'RESOLVED', method: 'AUTHORITATIVE_HOST', entity_id: 'AE-OWN', college_id: 'c-own-m' });
    expect(forInstitution(row, OWN)).toBe(true);
  });

  it('8. an unrelated entity cannot claim the host, before or after, and cannot re-correct it', () => {
    const db = world(); run(db, fixture([action(db)]));
    const r = resolver(db);
    expect(r.hostOwnedBy('athletics.owner.edu', 'AE-OTHER')).toBe(false);
    const again = action(db, { true_entity: 'AE-OTHER', unitid: OTHER });
    expect(planProtectedCorrections(db, fixture([again])).problems[0]).toMatch(/not the transition's starting state|stored owner/);
  });

  it('9. bare / www: a www. fixture host normalises to the bare row; www resolves to the owner; a www twin row refuses', () => {
    const db = world(); run(db, fixture([action(db, { host: 'www.athletics.owner.edu' })]));
    const r = resolver(db);
    expect(r.ownerOfHost('www.athletics.owner.edu')).toMatchObject({ entity: 'AE-OWN', via: 'EXACT_HOST' });
    expect(r.ownerOfHost('athletics.owner.edu')).toMatchObject({ entity: 'AE-OWN' });
    const db2 = world();
    db2.prepare("INSERT INTO athletics_domains (domain, status, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES ('www.athletics.owner.edu','INSUFFICIENT_EVIDENCE','[]','[]','t','NONE','t')").run();
    expect(planProtectedCorrections(db2, fixture([action(db2)])).problems[0]).toMatch(/twin rows/);
  });

  it('10. one failing action rolls back the whole transaction', () => {
    const db = world();
    const good = action(db); const second = action(db, { host: 'otherhost.com', true_entity: 'AE-OTHER', unitid: OTHER });
    const before = [rowOf(db, 'athletics.owner.edu'), rowOf(db, 'otherhost.com')];
    expect(() => run(db, fixture([good, second]), { postcheck: (d, plan) => { if (plan.length === 2) throw new Error('injected postcheck failure'); } })).toThrow(/injected/);
    expect([rowOf(db, 'athletics.owner.edu'), rowOf(db, 'otherhost.com')]).toEqual(before);
    const broken = action(db, { host: 'otherhost.com', true_entity: 'AE-OTHER', unitid: CLAIM });
    expect(() => run(db, fixture([good, broken]))).toThrow(/refused/);
    expect(rowOf(db, 'athletics.owner.edu')).toEqual(before[0]);
  });

  it('11. a dry run writes nothing and shows the exact before/after', () => {
    const db = world(); const before = rowOf(db, 'athletics.owner.edu');
    const r = applyProtectedCorrections(db, fixture([action(db)]), { apply: false, now: '2026-10-07T00:00:00Z' });
    expect(r.dryRun).toBe(true); expect(r.applied).toBe(0);
    expect(r.before[0]).toEqual(before);
    expect(r.after[0]).toMatchObject({ status: 'VERIFIED', athletics_entity_id: 'AE-OWN', ownership_class: 'ENTITY_OWNED', wrong_mappings: before.wrong_mappings });
    expect(rowOf(db, 'athletics.owner.edu')).toEqual(before);
  });

  it('12. the revert manifest restores the exact previous row', () => {
    const db = world(); const before = rowOf(db, 'athletics.owner.edu');
    const r = run(db, fixture([action(db)]));
    expect(r.manifest.before[0]).toEqual(before);
    revertManifest(db, r.manifest.manifest);
    expect(rowOf(db, 'athletics.owner.edu')).toEqual(before);
    expect(resolver(db).ownerOfHost('athletics.owner.edu').status).toBe('WRONG_INSTITUTION');
  });
});
