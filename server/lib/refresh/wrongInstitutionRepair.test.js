import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../../db/migrate.js';
import { buildRepairFixture, planWrongInstitutionRepair, selfIdName } from './wrongInstitutionRepair.js';
import { applyProtectedCorrections, ownershipPostcheck, fixtureHash, ALLOWED_TRANSITIONS } from './protectedCorrection.js';
import { loadRefreshContext } from './context.js';

/**
 * PHASE 1G-PRE — the WRONG_INSTITUTION repair rule (R1-R5). A decided-wrong host is reversed
 * only when independent evidence agrees on its stored owner; a host whose stored owner is itself
 * wrong, a campus, an alias that names two institutions, a held host, a twin, a shared platform
 * and a protected VERIFIED row (the pct.edu shape) are all left exactly as they are.
 * Institutions are invented; nothing here opens a real database.
 */
const SCHEMA = fs.readFileSync(path.resolve(import.meta.dirname, '../../db/schema.sql'), 'utf8');
const ROOT = path.resolve(import.meta.dirname, '../../..');
const OWN = 142001; const CLAIM = 240001; const WRONGLY_STORED = 150001; const PARENT = 160001; const AMBIG = 170001; const AMBIG_CLAIM = 170002; const PCT = 180001; const PCT_CLAIM = 180002;

const REGISTRY = [
  { UNITID: String(OWN), INSTNM: 'Owner College', ALIAS: 'NA', INSTURL: 'www.owner.edu/' },
  { UNITID: String(CLAIM), INSTNM: 'Claimant University', ALIAS: 'NA', INSTURL: 'www.claimant.edu/' },
  { UNITID: String(WRONGLY_STORED), INSTNM: 'Lookalike College of the West', ALIAS: 'NA', INSTURL: 'www.lookalike.edu/' },
  { UNITID: String(PARENT), INSTNM: 'Parent University', ALIAS: 'NA', INSTURL: 'www.parent.edu/' },
  { UNITID: String(AMBIG), INSTNM: 'North Point University', ALIAS: 'NA', INSTURL: 'www.northpoint.edu/' },
  { UNITID: String(AMBIG_CLAIM), INSTNM: 'North Point College', ALIAS: 'North Point University', INSTURL: 'www.northpointcollege.edu/' },
  { UNITID: String(PCT), INSTNM: 'Penn Tech College', ALIAS: 'NA', INSTURL: 'www.penntech.edu/' },
  { UNITID: String(PCT_CLAIM), INSTNM: 'Penn Big University', ALIAS: 'NA', INSTURL: 'www.pennbig.edu/' },
];

const wrongRow = (domain, unitid, { claimed = [unitid, CLAIM], wrong = [{ key: 'Claimant', claimantUnitid: CLAIM }], text = 'Owner College Athletics', status = 'WRONG_INSTITUTION', kind = 'OG_SITE_NAME' } = {}) => ({
  domain, unitid, status, role: 'ATHLETICS_SITE', claimed_keys: JSON.stringify(['Owner', 'Claimant']), claimed_unitids: JSON.stringify(claimed),
  wrong_mappings: wrong ? JSON.stringify(wrong) : null, evidence_kind: kind, evidence_text: text, identity_method: 'VARIANT', identity_strength: 'WHOLE_NAME',
  platform: 'SIDEARM', http_status: 200, final_url: `https://${domain}/`, verification_method: 'PAGE_SELF_IDENTIFICATION', confidence: 'CERTAIN', notes: null, checked_at: '2026-09-01T09:28:40.920Z', athletics_entity_id: null, ownership_class: null,
});

function world() {
  const db = new Database(':memory:'); db.exec(SCHEMA); migrate(db);
  const ent = db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, parent_unitid, campus_label, entity_kind, provenance, created_at) VALUES (?,?,?,?,?,?,'t','t')");
  ent.run('AE-OWN', 'Owner College', OWN, null, null, 'SINGLE'); ent.run('AE-CLAIM', 'Claimant University', CLAIM, null, null, 'SINGLE');
  ent.run('AE-WRONG', 'Lookalike College of the West', WRONGLY_STORED, null, null, 'SINGLE');
  ent.run('AE-PARENT', 'Parent University', PARENT, null, null, 'SINGLE'); ent.run('AE-PARENT-CAMPUS', 'Parent University Campus', null, PARENT, 'Campus', 'BRANCH_CAMPUS');
  ent.run('AE-AMBIG', 'North Point University', AMBIG, null, null, 'SINGLE'); ent.run('AE-AMBIG-CLAIM', 'North Point College', AMBIG_CLAIM, null, null, 'SINGLE');
  ent.run('AE-PCT', 'Penn Tech College', PCT, null, null, 'SINGLE'); ent.run('AE-PCT-CLAIM', 'Penn Big University', PCT_CLAIM, null, null, 'SINGLE');
  const ins = (r) => db.prepare(`INSERT INTO athletics_domains (${Object.keys(r).join(',')}) VALUES (${Object.keys(r).map((k) => `@${k}`).join(',')})`).run(r);
  ins(wrongRow('owneraths.com', OWN));                                                                                    // 1 the defect
  ins(wrongRow('lookalikeaths.com', WRONGLY_STORED, { claimed: [WRONGLY_STORED, CLAIM], text: 'Claimant University Athletics' })); // 2 stored owner is wrong
  ins(wrongRow('parentaths.com', PARENT, { claimed: [PARENT, CLAIM], text: 'Parent University Athletics' }));             // 3 parent/campus
  ins(wrongRow('northpointaths.com', AMBIG, { claimed: [AMBIG, AMBIG_CLAIM], wrong: [{ key: 'North Point (IL)', claimantUnitid: AMBIG_CLAIM }], text: 'North Point University Athletics' })); // 4 alias names both
  ins(wrongRow('stmarytx.edu', OWN));                                                                                     // 5 held (real held list)
  ins(wrongRow('twinaths.com', OWN)); ins({ ...wrongRow('www.twinaths.com', OWN), status: 'VERIFIED', wrong_mappings: null }); // twin rows
  ins(wrongRow('owner.sidearmsports.com', OWN));                                                                          // shared platform root
  ins(wrongRow('nolinkaths.com', OWN));                                                                                   // R5 no institution link
  ins(wrongRow('noagreeaths.com', OWN, { claimed: [CLAIM] }));                                                            // R3 no agreeing claim
  ins(wrongRow('weakaths.com', OWN, { kind: 'URL_PATH' }));                                                                // R2 weak self-id
  ins({ ...wrongRow('penntech.edu', PCT, { claimed: [PCT_CLAIM], wrong: null, text: 'Penn Tech College' }), status: 'VERIFIED', role: 'INSTITUTION_SITE' }); // 6 pct.edu shape
  ins({ ...wrongRow('owner.edu', OWN, { claimed: [OWN], wrong: null, text: 'Owner College' }), status: 'VERIFIED_ALIAS', role: 'INSTITUTION_SITE' }); // an alias row
  const col = db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES (?,'t','t',?,'mens-soccer','NCAA D3',1,?,?)");
  col.run('c-own', 'Owner College', OWN, 'AE-OWN'); col.run('c-claim', 'Claimant University', CLAIM, 'AE-CLAIM');
  // staff published on the stored-wrong host use the CLAIMANT's mail domain (the rattlerathletics shape)
  const coach = db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, email_source_url) VALUES (?, 't', ?, ?, ?, 'NCAA D3', 'mens-soccer', 'Head Coach', 'verified', ?)");
  coach.run('k-own', 'Olive Owner', 'olive@owner.edu', 'Owner College', 'https://owneraths.com/sports/mens-soccer/coaches');
  coach.run('k-wrong', 'Carl Claim', 'carl@claimant.edu', 'Lookalike', 'https://lookalikeaths.com/sports/mens-soccer/coaches');
  return db;
}
const LINK = 'https://www.owner.edu/ links the host';
const EVIDENCE = {
  links: { 'owneraths.com': LINK, 'lookalikeaths.com': LINK, 'parentaths.com': 'https://www.parent.edu/ links it', 'northpointaths.com': 'https://www.northpoint.edu/ links it', 'stmarytx.edu': LINK, 'twinaths.com': LINK, 'owner.sidearmsports.com': LINK, 'noagreeaths.com': LINK, 'weakaths.com': LINK },
  claimantLinks: { 'lookalikeaths.com': 'www.claimant.edu links it' },
};
const APPROVAL = { approval_id: 'APPROVAL-TEST', approved_by: 'test', approved_at: '2026-10-08', basis: 'test' };
const rowOf = (db, d) => db.prepare('SELECT * FROM athletics_domains WHERE domain = ?').get(d);
const build = (db) => buildRepairFixture(db, { registry: REGISTRY, evidence: EVIDENCE, approval: APPROVAL, createdAt: 't' });
const verdict = (db, host) => planWrongInstitutionRepair(db, { registry: REGISTRY, evidence: EVIDENCE }).assessments.find((a) => a.host === host);

describe('rule R1-R5: which WRONG_INSTITUTION rows may be reversed', () => {
  it('1. CERTAIN self-identification + the right federal name + an agreeing claim + a weaker foreign claim -> corrected to the true owner', () => {
    const db = world(); const { fixture } = build(db);
    expect(fixture.corrections.map((c) => c.host)).toEqual(['owneraths.com']);
    const before = rowOf(db, 'owneraths.com');
    const r = applyProtectedCorrections(db, fixture, { apply: true, postcheck: ownershipPostcheck });
    expect(r.applied).toBe(1);
    const after = rowOf(db, 'owneraths.com');
    expect(after).toMatchObject({ status: 'VERIFIED', athletics_entity_id: 'AE-OWN', ownership_class: 'ENTITY_OWNED', unitid: OWN });
    // evidence and the refused claimant survive byte-for-byte
    for (const k of ['unitid', 'claimed_keys', 'claimed_unitids', 'wrong_mappings', 'evidence_kind', 'evidence_text', 'confidence', 'checked_at', 'final_url']) expect(after[k]).toEqual(before[k]);
    const R = loadRefreshContext(db).resolver;
    expect(R.ownerOfHost('owneraths.com').entity).toBe('AE-OWN');
    expect(R.ownerOfHost('www.owneraths.com').entity).toBe('AE-OWN');
    expect(R.hostOwnedBy('owneraths.com', 'AE-CLAIM')).toBe(false);
  });
  it('2. strong contradictory evidence (the page names the refuted claimant, whose site links the host and whose mail domain its staff use) -> kept, fail closed', () => {
    const v = verdict(world(), 'lookalikeaths.com');
    expect(v.eligible).toBe(false);
    expect(v.failures.join(' | ')).toMatch(/not a federal registry name of 150001/);
    expect(v.failures.join(' | ')).toMatch(/refuted claimant\(s\) Claimant/);
    expect(v.failures.join(' | ')).toMatch(/refuted claimant links or publishes/);
    expect(v.failures.join(' | ')).toMatch(/claimant's domain \(claimant\.edu/);
  });
  it('3. a UNITID with a campus hanging off it -> kept (parent/campus is never decided here)', () => {
    expect(verdict(world(), 'parentaths.com').failures.join()).toMatch(/R4 UNITID 160001 is not exactly one SINGLE entity without campuses/);
  });
  it('4. an alias the federal registry gives BOTH institutions -> kept (an alias never transfers ownership)', () => {
    expect(verdict(world(), 'northpointaths.com').failures.join()).toMatch(/also a federal registry name of refuted claimant/);
  });
  it('5. a held host -> kept', () => {
    expect(verdict(world(), 'stmarytx.edu').failures.join()).toMatch(/R4 held/);
  });
  it('twin rows, a shared platform root, no institution link, no agreeing claim, a weak self-identification -> each kept', () => {
    const db = world();
    expect(verdict(db, 'twinaths.com').failures.join()).toMatch(/www twin/);
    expect(verdict(db, 'owner.sidearmsports.com').failures.join()).toMatch(/shared platform root/);
    expect(verdict(db, 'nolinkaths.com').failures.join()).toMatch(/R5 no observed link/);
    expect(verdict(db, 'noagreeaths.com').failures.join()).toMatch(/R3 no mapping claim agrees/);
    expect(verdict(db, 'weakaths.com').failures.join()).toMatch(/R2 self-identification below/);
  });
  it('6. the pct.edu shape (VERIFIED, the claim was the error, the UNITID right) and VERIFIED_ALIAS rows are never in scope and do not move', () => {
    const db = world(); const { fixture, assessments } = build(db);
    expect(assessments.map((a) => a.host)).not.toContain('penntech.edu');
    const keep = ['penntech.edu', 'owner.edu', 'www.twinaths.com', 'lookalikeaths.com', 'parentaths.com', 'northpointaths.com', 'stmarytx.edu', 'twinaths.com', 'owner.sidearmsports.com', 'nolinkaths.com', 'noagreeaths.com', 'weakaths.com'];
    const before = Object.fromEntries(keep.map((d) => [d, rowOf(db, d)]));
    const R0 = loadRefreshContext(db).resolver; const owners0 = Object.fromEntries(keep.map((d) => [d, R0.ownerOfHost(d)]));
    applyProtectedCorrections(db, fixture, { apply: true, postcheck: ownershipPostcheck });
    const R1 = loadRefreshContext(db).resolver;
    for (const d of keep) { expect(rowOf(db, d), d).toEqual(before[d]); expect(R1.ownerOfHost(d), d).toEqual(owners0[d]); }
    expect(R1.ownerOfHost('penntech.edu').entity).toBe('AE-PCT');
  });
  it('7. source trust follows the corrected owner only: the owner\'s staff page becomes its source, never the claimant\'s', () => {
    const db = world(); const url = 'https://owneraths.com/sports/mens-soccer/coaches';
    expect(loadRefreshContext(db).resolver.sourceOwnedBy(url, 'AE-OWN', { sport: 'mens-soccer' })).toBe(false);
    applyProtectedCorrections(db, build(db).fixture, { apply: true, postcheck: ownershipPostcheck });
    const R = loadRefreshContext(db).resolver;
    expect(R.sourceOwnedBy(url, 'AE-OWN', { sport: 'mens-soccer' })).toBe(true);
    expect(R.sourceOwnedBy(url, 'AE-CLAIM', { sport: 'mens-soccer' })).toBe(false);
    expect(R.sourceOwnedBy('https://lookalikeaths.com/sports/mens-soccer/coaches', 'AE-WRONG', { sport: 'mens-soccer' })).toBe(false);
  });
  it('the correction writes athletics_domains only: coaches, colleges, entities and outreach are untouched', () => {
    const db = world();
    const snap = () => ['coaches', 'colleges', 'athletics_entities', 'outreach', 'outreach_send', 'programme_contacts', 'institution_aliases', 'athletics_source_locations']
      .map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())).join('\n');
    const s0 = snap(); applyProtectedCorrections(db, build(db).fixture, { apply: true, postcheck: ownershipPostcheck });
    expect(snap()).toBe(s0);
  });
  it('the page name is read without its athletics-site dressing', () => {
    expect(selfIdName('Georgia Southern University Athletics - Official Athletics Website')).toBe('Georgia Southern University');
    expect(selfIdName('Emmanuel University (Ga.)')).toBe('Emmanuel University');
    expect(selfIdName('Johnson & Wales University Providence - Official Athletics Website')).toBe('Johnson & Wales University Providence');
  });
  it('is deterministic: the same database and inputs give the same fixture hash', () => {
    expect(build(world()).fixture.fixture_hash).toBe(build(world()).fixture.fixture_hash);
  });
});

describe('the committed 1G-PRE fixture (docs/validation/integrity-audit)', () => {
  const dir = path.join(ROOT, 'docs/validation/integrity-audit');
  const fx = JSON.parse(fs.readFileSync(path.join(dir, 'phase1gpre_protected_correction_fixture.json'), 'utf8'));
  const KEPT = ['autrojans.com', 'benueagles.com', 'buhuskies.com', 'cornerstone.sidearmsports.com', 'cuwfalcons.com', 'iuindyjags.com', 'ncurams.com', 'njcugothicknights.com', 'rattlerathletics.com', 'ucgoldeneagles.com', 'unweagles.com'];
  it('is intact (hash) and covers exactly the 38 approved Class B hosts', () => {
    expect(fixtureHash(fx)).toBe(fx.fixture_hash);
    expect(fx.corrections).toHaveLength(38);
    expect(fx.approvals).toHaveLength(1);
    expect([...fx.approvals[0].hosts].sort()).toEqual(fx.corrections.map((c) => c.host).sort());
    expect(fx.excluded.map((e) => e.host).sort()).toEqual(KEPT);
  });
  it('never touches the 11 kept rows, pct.edu, Pitt or Penn State', () => {
    const hosts = new Set(fx.corrections.map((c) => c.host));
    for (const h of [...KEPT, 'pct.edu', 'www.pct.edu', 'pitt.edu', 'athletics.pitt.edu', 'psu.edu', 'athletics.psu.edu', 'stmarytx.edu', 'ucwv.edu', 'bloomu.edu']) expect(hosts.has(h), h).toBe(false);
  });
  it('every action is the one allowed transition, keeps its stored owner and its refused claimants', () => {
    for (const c of fx.corrections) {
      expect(c.transition).toEqual(ALLOWED_TRANSITIONS[0]);
      expect(c.expected_old.status).toBe('WRONG_INSTITUTION');
      expect(c.expected_old.athletics_entity_id).toBeNull();
      expect(Number(c.expected_old.unitid)).toBe(c.unitid);
      expect(c.true_entity).toBe(`AE-U${c.unitid}`);
      expect(c.wrong_claimants).toEqual(JSON.parse(c.expected_old.wrong_mappings));
      expect(c.wrong_claimants.some((w) => Number(w.claimantUnitid) === c.unitid)).toBe(false);
      expect(c.evidence.institution_to_host).toBeTruthy();
      expect(c.evidence.host_to_institution).toMatch(/federal registry name/);
    }
  });
});
