import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { migrate } from '../db/migrate.js';
import { indexFederalWebsites, federalMailDomainProof, FEDERAL, FEDERAL_SEED_PATH } from './federalInstitutionWebsites.js';
import { buildSeed, csvRows } from '../scripts/buildFederalWebsiteSeed.js';
import { buildProgrammeContactContext, programmeContactProblems, programmeContactId, addressDomainVerdict, PC_INELIGIBLE } from './programmeContactEligibility.js';
import { loadRefreshContext } from './refresh/context.js';

/**
 * PHASE 1G-B (B4) — the narrow federal website mail-domain proof and the new address exclusions.
 * It may prove a programme contact's MAIL DOMAIN and nothing else: no host ownership changes.
 * Institutions are invented unless named as the committed seed.
 */
const SCHEMA = fs.readFileSync(path.resolve(import.meta.dirname, '../db/schema.sql'), 'utf8');
const T = '2026-10-01T00:00:00.000Z';
const SEED = { rows: [
  { unitid: 910001, name: 'Owner College', website: 'www.owner.edu/' },
  { unitid: 910002, name: 'Parent University', website: 'https://parent.edu/' },
  { unitid: 910003, name: 'System Main Campus', website: 'system.edu' }, { unitid: 910004, name: 'System Branch', website: 'www.system.edu/branch' },
  { unitid: 910005, name: 'No Site College', website: null },
  { unitid: 910006, name: 'Held College', website: 'stmarytx.edu' },
  { unitid: 910007, name: 'Claimed College', website: 'claimed.edu' },
  { unitid: 910008, name: 'Other College', website: 'other.edu' },
  { unitid: 910009, name: 'Twin College', website: 'twin.edu' },
] };

function world() {
  const db = new Database(':memory:'); db.exec(SCHEMA); migrate(db);
  const ent = db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, parent_unitid, campus_label, entity_kind, provenance, created_at) VALUES (?,?,?,?,?,?,'t',?)");
  const col = db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES (?,?,?,?,'mens-soccer','NCAA D3',1,?,?)");
  const dom = db.prepare("INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES (?, ?, ?, 'ATHLETICS_SITE', '[]', '[]', 'TEST', 'CERTAIN', ?)");
  for (const [id, name, u] of [['AE-OWN', 'Owner College', 910001], ['AE-PARENT', 'Parent University', 910002], ['AE-SYS', 'System Main Campus', 910003], ['AE-NOSITE', 'No Site College', 910005], ['AE-HELD', 'Held College', 910006], ['AE-CLAIMED', 'Claimed College', 910007], ['AE-OTHER', 'Other College', 910008], ['AE-TWIN', 'Twin College', 910009]]) {
    ent.run(id, name, u, null, null, 'SINGLE', T); col.run(`c-${id}`, T, T, name, u, id);
  }
  ent.run('AE-PARENT-CAMPUS', 'Parent University Campus', null, 910002, 'Campus', 'BRANCH_CAMPUS', T);
  dom.run('ownerathletics.example', 910001, 'VERIFIED', T);                      // the owner's athletics host (page source)
  dom.run('owner.edu', null, 'INSUFFICIENT_EVIDENCE', T);                        // the mail domain the registry could not prove
  dom.run('claimed.edu', 910008, 'VERIFIED', T);                                 // pct.edu shape: the registry names ANOTHER institution
  dom.run('twin.edu', null, 'WRONG_INSTITUTION', T);                              // contrary decision
  return db;
}
const ctxOf = (db) => buildProgrammeContactContext(db, { federalIndex: indexFederalWebsites(SEED) });
const proof = (db, domain, entity) => { const c = ctxOf(db); return federalMailDomainProof(domain, entity, { ...c.federal, resolver: c.resolver }).code; };
const contact = (email, entity = 'AE-OWN', over = {}) => ({ contact_id: programmeContactId(entity, 'mens-soccer', email), athletics_entity_id: entity, college_id: `c-${entity}`, sport: 'mens-soccer', email, label: 'Owner College Men\'s Soccer',
  contact_role: 'TEAM_INBOX', observed_on_url: 'https://ownerathletics.example/sports/mens-soccer/coaches', observed_at: T, source: 'refresh:t', source_kind: 'OFFICIAL_STAFF_DIRECTORY', source_tier: 'A', status: 'VERIFIED', currentness_checked_at: T, ...over });

describe('federal website mail-domain proof (F1-F5)', () => {
  it('proves the institution\'s own federal website domain and its subdomains', () => {
    const db = world();
    expect(proof(db, 'owner.edu', 'AE-OWN')).toBe(FEDERAL.OWNED);
    expect(proof(db, 'athletics.owner.edu', 'AE-OWN')).toBe(FEDERAL.OWNED);
  });
  it('refuses another institution\'s domain, a parent with a campus, a campus entity, no website, and a domain shared by several UNITIDs', () => {
    const db = world();
    expect(proof(db, 'other.edu', 'AE-OWN')).toBe(FEDERAL.NOT_WEBSITE_DOMAIN);
    expect(proof(db, 'parent.edu', 'AE-PARENT')).toBe(FEDERAL.CAMPUS);
    expect(proof(db, 'parent.edu', 'AE-PARENT-CAMPUS')).toBe(FEDERAL.NOT_SINGLE);
    expect(proof(db, 'nosite.edu', 'AE-NOSITE')).toBe(FEDERAL.NO_WEBSITE);
    expect(proof(db, 'system.edu', 'AE-SYS')).toBe(FEDERAL.SHARED_DOMAIN);
  });
  it('refuses where the identity registry says anything contrary: a held domain, a WRONG_INSTITUTION decision, a row naming another UNITID (the pct.edu shape)', () => {
    const db = world();
    expect(proof(db, 'stmarytx.edu', 'AE-HELD')).toBe(FEDERAL.CONTRADICTED);
    expect(proof(db, 'twin.edu', 'AE-TWIN')).toBe(FEDERAL.CONTRADICTED);
    expect(proof(db, 'claimed.edu', 'AE-CLAIMED')).toBe(FEDERAL.CONTRADICTED);
  });
  it('fails closed without the seed', () => {
    const db = world(); const c = buildProgrammeContactContext(db, { federalIndex: null });
    expect(federalMailDomainProof('owner.edu', 'AE-OWN', { ...c.federal, resolver: c.resolver }).code).toBe(FEDERAL.NO_SEED);
  });
  it('changes no ownership answer: the registry still owns nothing at owner.edu', () => {
    const db = world(); const r = loadRefreshContext(db).resolver;
    expect(r.hostOwnedBy('owner.edu', 'AE-OWN')).toBe(false);
    expect(r.ownerOfHost('owner.edu').status).toBe('INSUFFICIENT_EVIDENCE');
    expect(addressDomainVerdict('msoccer@owner.edu', 'AE-OWN', r, ctxOf(db).federal)).toBe(FEDERAL.OWNED);
    expect(addressDomainVerdict('msoccer@owner.edu', 'AE-OWN', r)).toBe(PC_INELIGIBLE.ADDRESS_DOMAIN_NOT_OWNED);   // the old call is unchanged
  });
});

describe('the validator with the new exclusions', () => {
  it('a programme contact on a federally proven mail domain passes the whole floor', () => {
    const db = world();
    expect(programmeContactProblems(contact('msoccer@owner.edu'), ctxOf(db), { now: new Date('2026-10-08') })).toEqual([]);
  });
  it('refuses free mail, camp/academy lines and an address that does not name the sport', () => {
    const db = world(); const c = ctxOf(db); const now = new Date('2026-10-08');
    expect(programmeContactProblems(contact('ownersoccer@gmail.com'), c, { now })).toContain(PC_INELIGIBLE.PERSONAL_MAIL_DOMAIN);
    expect(programmeContactProblems(contact('soccercamp@owner.edu'), c, { now })).toEqual([PC_INELIGIBLE.CAMP_OR_ACADEMY]);
    expect(programmeContactProblems(contact('ownersocceracademy@owner.edu'), c, { now })).toEqual([PC_INELIGIBLE.CAMP_OR_ACADEMY]);
    expect(programmeContactProblems(contact('recruiting@owner.edu'), c, { now })).toContain(PC_INELIGIBLE.NOT_PROGRAMME_SPECIFIC);
  });
});

describe('the federal seed', () => {
  it('parses RFC 4180 CSV (quoted commas, doubled quotes) and refuses duplicate UNITIDs', () => {
    expect([...csvRows('a,"b, c","d ""e"""\n1,2,3\n')]).toEqual([['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
    const csv = 'UNITID,INSTNM,ALIAS,STABBR,INSTURL,MAIN,CURROPER\n2,"B, College",NULL,TX,b.edu,1,1\n1,A,A1|A2,CA,www.a.edu/,1,0\n';
    const s = buildSeed(csv, { retrievedAt: '2026-05-27', sourceSha256: 'x' });
    expect(s.rows).toEqual([{ unitid: 1, name: 'A', alias: 'A1|A2', state: 'CA', website: 'www.a.edu/', main: true, operating: false }, { unitid: 2, name: 'B, College', alias: null, state: 'TX', website: 'b.edu', main: true, operating: true }]);
    expect(() => buildSeed(`${csv}1,A again,NULL,CA,a.edu,1,1\n`, { retrievedAt: 'x', sourceSha256: 'x' })).toThrow(/duplicate UNITIDs/);
  });
  it('the committed seed is intact, records its source, and covers the federal registry', () => {
    const seed = JSON.parse(fs.readFileSync(FEDERAL_SEED_PATH, 'utf8'));
    const { seed_sha256, ...body } = seed;
    expect(crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')).toBe(seed_sha256);
    expect(seed).toMatchObject({ kind: 'FEDERAL_INSTITUTION_WEBSITES', retrieved_at: '2026-05-27', source_sha256: '89e8a35a6588dfb81a6ce78fa9df4cb99b36ef7aa4b28fb0157f9e3e1a7d81b5' });
    expect(seed.source).toMatch(/College Scorecard/);
    expect(seed.row_count).toBe(seed.rows.length);
    expect(seed.rows.length).toBeGreaterThan(6000);
    expect(seed.rows.find((r) => r.unitid === 190415)).toMatchObject({ name: 'Cornell University', website: 'www.cornell.edu/' });
  });
});
