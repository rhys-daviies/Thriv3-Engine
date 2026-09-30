import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createIdentityResolver } from './identityResolver.js';
import { rosterAdapter } from './adapters/gatherers.js';
import { capturedPage } from './adapters/fetchPage.js';
import { REFUSAL } from './adapters/adapterSafety.js';
import { validateEntityIdentity } from '../../scripts/validateAthleticsEntityIdentity.js';
import { extendMembershipDivisions, migrate } from '../../db/migrate.js';

/**
 * PHASE 8B.1 Parts G/H — host + PATH SCOPE. An institution whose athletics live under its own
 * site (institution.edu/athletics/...) is represented by a location, never by registering the
 * whole institution host. A location proves only URLs inside its scope, for its entity.
 */
const SCHEMA = fs.readFileSync(path.resolve(import.meta.dirname, '../../db/schema.sql'), 'utf8');
const loc = (over) => ({ location_id: 'x', athletics_entity_id: 'AE-U1', host: 'inst.edu', path_prefix: '/athletics', source_type: 'INSTITUTION_ATHLETICS_PATH', sport: null, status: 'VERIFIED', provenance: 't', recorded_at: 't', ...over });
const resolverWith = (locations, domains = []) => createIdentityResolver({ entities: [{ athletics_entity_id: 'AE-U1', federal_unitid: 1, entity_kind: 'SINGLE' }, { athletics_entity_id: 'AE-U2', federal_unitid: 2, entity_kind: 'SINGLE' }], colleges: [], domains, locations });

describe('sourceOwnedBy: a path scope proves only what is inside it', () => {
  const r = resolverWith([loc()]);
  it('inside the prefix, on a segment boundary', () => {
    expect(r.sourceOwnedBy('https://inst.edu/athletics/sports/msoc/roster', 'AE-U1')).toBe(true);
    expect(r.sourceOwnedBy('https://www.inst.edu/athletics', 'AE-U1')).toBe(true);
  });
  it('the rest of the institution host is proof of nothing', () => {
    for (const u of ['https://inst.edu/', 'https://inst.edu/admissions', 'https://inst.edu/athleticsfoo', 'https://inst.edu/news/athletics']) expect(r.sourceOwnedBy(u, 'AE-U1')).toBe(false);
    expect(r.hostOwnedBy('inst.edu', 'AE-U1')).toBe(false); // host ownership is untouched by a location
  });
  it('never for another entity, another host, or a non-VERIFIED location', () => {
    expect(r.sourceOwnedBy('https://inst.edu/athletics/x', 'AE-U2')).toBe(false);
    expect(r.sourceOwnedBy('https://other.edu/athletics/x', 'AE-U1')).toBe(false);
    expect(resolverWith([loc({ status: 'REVIEW' })]).sourceOwnedBy('https://inst.edu/athletics/x', 'AE-U1')).toBe(false);
  });
  it('a sport-scoped location covers only its sport', () => {
    const s = resolverWith([loc({ source_type: 'SPORT_PAGE', path_prefix: '/athletics/mens-soccer', sport: 'mens-soccer' })]);
    expect(s.sourceOwnedBy('https://inst.edu/athletics/mens-soccer/roster', 'AE-U1', { sport: 'mens-soccer' })).toBe(true);
    expect(s.sourceOwnedBy('https://inst.edu/athletics/mens-soccer/roster', 'AE-U1', { sport: 'womens-soccer' })).toBe(false);
    expect(s.sourceOwnedBy('https://inst.edu/athletics/womens-soccer/roster', 'AE-U1', { sport: 'womens-soccer' })).toBe(false);
  });
  it('an entity-owned HOST still owns every URL on it (no change to athletics_domains semantics)', () => {
    const h = resolverWith([], [{ domain: 'instathletics.com', status: 'VERIFIED', athletics_entity_id: 'AE-U1' }]);
    expect(h.sourceOwnedBy('https://instathletics.com/sports/msoc/roster', 'AE-U1')).toBe(true);
  });
});

describe('schema: a path location can never be the whole host', () => {
  const db = new Database(':memory:'); db.exec(SCHEMA);
  const ins = (o) => db.prepare('INSERT INTO athletics_source_locations (location_id, athletics_entity_id, host, path_prefix, source_type, sport, status, provenance, recorded_at) VALUES (@location_id,@athletics_entity_id,@host,@path_prefix,@source_type,@sport,@status,@provenance,@recorded_at)').run(loc(o));
  it('rejects a root prefix, a query in the prefix, and a sport page without a sport', () => {
    expect(() => ins({ location_id: 'a', path_prefix: '/' })).toThrow(/CHECK/);
    expect(() => ins({ location_id: 'b', path_prefix: 'athletics' })).toThrow(/CHECK/);
    expect(() => ins({ location_id: 'c', path_prefix: '/athletics?x=1' })).toThrow(/CHECK/);
    expect(() => ins({ location_id: 'd', source_type: 'SPORT_PAGE', path_prefix: '/athletics/msoc' })).toThrow(/CHECK/);
    expect(() => ins({ location_id: 'e' })).not.toThrow();
  });
});

describe('validator H12', () => {
  const world = () => { const db = new Database(':memory:'); db.exec(SCHEMA); migrate(db); db.exec("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES ('AE-U1','One',100001,'SINGLE','t','t'),('AE-U2','Two',100002,'SINGLE','t','t')"); return db; };
  const add = (db, o) => db.prepare('INSERT INTO athletics_source_locations (location_id, athletics_entity_id, host, path_prefix, source_type, sport, status, provenance, recorded_at) VALUES (@location_id,@athletics_entity_id,@host,@path_prefix,@source_type,@sport,@status,@provenance,@recorded_at)').run(loc(o));
  it('a clean location passes', () => { const db = world(); add(db, {}); expect(validateEntityIdentity(db).hard.filter((h) => h.startsWith('H12'))).toEqual([]); });
  it('overlapping scopes for two entities on one host fail', () => {
    const db = world(); add(db, {}); add(db, { location_id: 'y', athletics_entity_id: 'AE-U2', path_prefix: '/athletics/soccer' });
    expect(validateEntityIdentity(db).hard.some((h) => /H12 overlapping path scopes/.test(h))).toBe(true);
  });
  it('a location on a host another entity owns fails; a shared root fails', () => {
    const db = world(); db.exec("INSERT INTO athletics_domains (domain, status, claimed_keys, claimed_unitids, verification_method, confidence, checked_at, athletics_entity_id) VALUES ('inst.edu','VERIFIED','[]','[]','t','CERTAIN','t','AE-U2')");
    add(db, {}); add(db, { location_id: 'z', host: 'foo.sidearmsports.com' });
    const hard = validateEntityIdentity(db).hard.filter((h) => h.startsWith('H12'));
    expect(hard.some((h) => /owned by AE-U2/.test(h))).toBe(true); expect(hard.some((h) => /shared-platform root/.test(h))).toBe(true);
  });
});

describe('the roster adapter honours the path scope', () => {
  const r = resolverWith([loc()]);
  const ownsSource = (u, e, sport) => r.sourceOwnedBy(u, e, { sport });
  const table = '<table><thead><tr><th>No.</th><th>Name</th><th>Pos.</th></tr></thead><tbody><tr><td>1</td><td>Alex Keeper</td><td>GK</td></tr></tbody></table>';
  const fetchAt = (final) => async (url) => capturedPage({ url, final_url: final || url, fetched_at: '2026-10-01T00:00:00Z', body: `<title>2026-27 Men's Soccer Roster - Inst College</title>${table}${'x'.repeat(900)}` });
  const target = { athletics_entity_id: 'AE-U1', institution_label: 'Inst College', sport: 'mens-soccer', host: 'inst.edu', season: 2026 };
  it('stages a roster under /athletics', async () => {
    const res = await rosterAdapter(target, { ownsSource, url: 'https://inst.edu/athletics/sports/msoc/2026-27/roster', fetch: fetchAt() });
    expect(res.page?.players).toHaveLength(1);
  });
  it('refuses the same page anywhere else on the institution host', async () => {
    const res = await rosterAdapter(target, { ownsSource, url: 'https://inst.edu/clubs/soccer/roster', fetch: fetchAt() });
    expect(res.refusal.code).toBe(REFUSAL.INSTITUTION_MISMATCH);
  });
});

describe('membership vocabulary migration (CCCAA / NWAC)', () => {
  const oldDdl = SCHEMA.match(/CREATE TABLE IF NOT EXISTS programme_membership_periods \([\s\S]*?\n\);/)[0].replace(", 'CCCAA', 'NWAC'", '');
  it('rebuilds once, keeps every row and value, then accepts CCCAA; a second run is a no-op', () => {
    const db = new Database(':memory:'); db.exec(oldDdl);
    const ins = db.prepare("INSERT INTO programme_membership_periods (athletics_entity_id, sport, first_season, last_season, governing_body, division, membership_status, conference, college_id, source_tier, provenance, recorded_at) VALUES (?, 'mens-soccer', 2022, NULL, ?, ?, 'ACTIVE', NULL, ?, 'SEED', 'seed', 't')");
    ins.run('AE-U1', 'NJCAA', 'NJCAA', 'c1'); ins.run('AE-U2', 'NCAA', 'NCAA D1', 'c2');
    const before = db.prepare('SELECT * FROM programme_membership_periods ORDER BY 1').all();
    expect(() => ins.run('AE-U3', 'OTHER', 'CCCAA', 'c3')).toThrow(/CHECK/);
    expect(extendMembershipDivisions(db)).toBe(true);
    expect(db.prepare('SELECT * FROM programme_membership_periods ORDER BY 1').all()).toEqual(before);
    expect(() => ins.run('AE-U3', 'OTHER', 'CCCAA', 'c3')).not.toThrow();
    expect(() => ins.run('AE-U4', 'OTHER', 'NWAC', 'c4')).not.toThrow();
    expect(() => ins.run('AE-U5', 'OTHER', 'MADEUP', 'c5')).toThrow(/CHECK/);
    expect(extendMembershipDivisions(db)).toBe(false);
    expect(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name IN ('idx_pmp_open','idx_pmp_college')").get().n).toBe(2);
  });
});
