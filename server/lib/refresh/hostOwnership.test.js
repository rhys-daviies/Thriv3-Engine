import { describe, it, expect } from 'vitest';
import { createIdentityResolver, hostOwnershipDisagreements, normHost } from './identityResolver.js';

/**
 * PHASE 8C.2C — ONE host-ownership answer. entityHosts, hostOwnedBy, sourceOwnedBy and the
 * host step of resolve() all derive from ownerOfHost, so they cannot disagree. Before this,
 * entityHosts counted a trusted host-level row that hostOwnedBy ignored (athletics.parkland.edu:
 * a trusted subdomain row carrying only a UNITID, under a parent domain nobody had recorded),
 * so Parkland's official roster was refused at the gather gate while the monitor called its
 * host trusted.
 */
const ent = (id, federal_unitid, extra = {}) => ({ athletics_entity_id: id, federal_unitid, parent_unitid: null, entity_kind: 'SINGLE', ...extra });
const dom = (domain, status, extra = {}) => ({ domain, status, unitid: null, athletics_entity_id: null, role: 'ATHLETICS_SITE', ...extra });
const ENTITIES = [
  ent('AE-PARKLAND', 147916), ent('AE-MINERAL', 178217), ent('AE-WPU', 186876), ent('AE-WASPS', 200001), ent('AE-CUW', 238616),
  ent('AE-EUREKA', 144971), ent('AE-STMARY', 228325), ent('AE-RU-NB', 186380), ent('AE-RU-NEWARK', 186399), ent('AE-RU-CAMDEN', 186371),
  ent('AE-PARK', 177117), ent('AE-PARK-GILBERT', null, { parent_unitid: 177117, entity_kind: 'SYSTEM_CAMPUS' }),
  ent('AE-SNOW', 230597), ent('AE-X', 300001), ent('AE-A', 300002), ent('AE-B', 300003), ent('AE-HELDPARENT', 300004),
  ent('AE-SYS', 400000), ent('AE-SYS-1', null, { parent_unitid: 400000, entity_kind: 'SYSTEM_CAMPUS' }), ent('AE-SYS-2', null, { parent_unitid: 400000, entity_kind: 'SYSTEM_CAMPUS' }),
];
const DOMAINS = [
  dom('athletics.parkland.edu', 'VERIFIED_ALIAS', { unitid: 147916 }), // C1: trusted subdomain, UNITID only, parent domain absent
  dom('athletic.mineralarea.edu', 'VERIFIED_ALIAS', { unitid: 178217, role: 'INSTITUTION_SITE' }), // C1, institution-site role
  dom('www.wpupioneers.com', 'VERIFIED_ALIAS', { unitid: 186876 }), // C2a: www-keyed only
  dom('www.gowasps.com', 'VERIFIED', { unitid: 200001 }), dom('gowasps.com', 'INSUFFICIENT_EVIDENCE', { role: 'UNKNOWN' }), // C2b
  dom('www.cuwfalcons.com', 'VERIFIED', { unitid: 238616 }), dom('cuwfalcons.com', 'WRONG_INSTITUTION', { unitid: 238616 }), // C2b
  dom('eurekareddevils.com', 'VERIFIED', { unitid: 144971 }), dom('www.eurekareddevils.com', 'INSUFFICIENT_EVIDENCE', { role: 'UNKNOWN' }), // canonical bare decides
  dom('stmarytx.edu', 'VERIFIED_ALIAS', { unitid: 228325, role: 'INSTITUTION_SITE' }), // C3: held for adjudication
  dom('rutgers.edu', 'VERIFIED', { athletics_entity_id: 'AE-RU-NB', role: 'INSTITUTION_SITE' }),
  dom('newark.rutgers.edu', 'VERIFIED', { unitid: 186399, role: 'INSTITUTION_SITE' }), dom('camden.rutgers.edu', 'VERIFIED', { unitid: 186371, role: 'INSTITUTION_SITE' }), // C4
  dom('parkathletics.com', 'VERIFIED', { unitid: 177117 }), dom('gilbert.parkathletics.com', 'VERIFIED', { athletics_entity_id: 'AE-PARK-GILBERT' }),
  dom('snowbadgers.com', 'WRONG_INSTITUTION', { unitid: 230597 }),
  dom('x.edu', 'VERIFIED', { athletics_entity_id: 'AE-X', role: 'INSTITUTION_SITE' }), dom('bad.x.edu', 'WRONG_INSTITUTION', { unitid: 300001 }),
  dom('shared.com', 'VERIFIED', { athletics_entity_id: 'AE-A' }), dom('www.shared.com', 'VERIFIED', { athletics_entity_id: 'AE-B' }),
  dom('sys.edu', 'VERIFIED', { unitid: 400000, role: 'INSTITUTION_SITE' }),
  dom('sidearmsports.com', 'VERIFIED', { athletics_entity_id: 'AE-A' }),
];
const r = createIdentityResolver({ entities: ENTITIES, colleges: [], domains: DOMAINS });
const owns = (host, e) => ({ hostOwnedBy: r.hostOwnedBy(host, e), entityHosts: r.entityHosts(e).has(normHost(host)) });
const both = (v) => ({ hostOwnedBy: v, entityHosts: v });

describe('normHost', () => {
  it('lower case, no trailing dot, no leading www.', () => {
    expect(normHost('WWW.Parkland.EDU.')).toBe('parkland.edu');
    expect(normHost(' athletics.parkland.edu ')).toBe('athletics.parkland.edu');
  });
});

describe('C1 — a trusted host-level row is owned, whatever its parent domain', () => {
  it('Parkland: athletics.parkland.edu (UNITID only, parkland.edu unrecorded)', () => {
    expect(owns('athletics.parkland.edu', 'AE-PARKLAND')).toEqual(both(true));
    expect(r.ownerOfHost('athletics.parkland.edu')).toMatchObject({ entity: 'AE-PARKLAND', via: 'EXACT_HOST' });
    expect(r.sourceOwnedBy('https://athletics.parkland.edu/sports/mens-soccer/roster', 'AE-PARKLAND')).toBe(true);
    expect(r.resolve({ source_url: 'https://athletics.parkland.edu/sports/womens-soccer/roster' })).toMatchObject({ entity_id: 'AE-PARKLAND', method: 'AUTHORITATIVE_HOST' });
  });
  it('Mineral Area style: a trusted institution-site subdomain row', () => {
    expect(owns('athletic.mineralarea.edu', 'AE-MINERAL')).toEqual(both(true));
  });
});

describe('C2 — www. spellings', () => {
  it('a www-only trusted row is the record: owned under either spelling', () => {
    expect(owns('wpupioneers.com', 'AE-WPU')).toEqual(both(true));
    expect(r.hostOwnedBy('www.wpupioneers.com', 'AE-WPU')).toBe(true);
    expect([...r.entityHosts('AE-WPU')]).toEqual(['wpupioneers.com']);
  });
  it('a trusted www row never overrides its untrusted canonical bare twin', () => {
    expect(owns('gowasps.com', 'AE-WASPS')).toEqual(both(false));
    expect(r.ownerOfHost('gowasps.com').status).toBe('CONFLICTING_TWINS');
    expect(owns('cuwfalcons.com', 'AE-CUW')).toEqual(both(false));
    expect(r.ownerOfHost('www.cuwfalcons.com').status).toBe('CONFLICTING_TWINS');
    expect(r.resolve({ source_url: 'https://gowasps.com/roster' }).contradictions.join(' ')).toMatch(/disagree/);
  });
  it('a www row that records no claim (insufficient evidence) does not veto a trusted canonical row', () => {
    expect(owns('eurekareddevils.com', 'AE-EUREKA')).toEqual(both(true));
  });
  it('two trusted spellings naming different entities collide: owned by nobody', () => {
    expect(owns('shared.com', 'AE-A')).toEqual(both(false));
    expect(owns('shared.com', 'AE-B')).toEqual(both(false));
  });
});

describe('C3 — a held domain is owned by nobody, and entityHosts no longer lists it', () => {
  it('stmarytx.edu', () => {
    expect(owns('stmarytx.edu', 'AE-STMARY')).toEqual(both(false));
    expect(r.ownerOfHost('stmarytx.edu').status).toBe('HELD');
  });
});

describe('C4 / campuses — the explicit host-level row decides; a parent never steals a campus host', () => {
  it('Rutgers Newark and Camden own their campus hosts; New Brunswick owns rutgers.edu only', () => {
    expect(owns('newark.rutgers.edu', 'AE-RU-NEWARK')).toEqual(both(true));
    expect(owns('camden.rutgers.edu', 'AE-RU-CAMDEN')).toEqual(both(true));
    expect(owns('newark.rutgers.edu', 'AE-RU-NB')).toEqual(both(false));
    expect(owns('camden.rutgers.edu', 'AE-RU-NB')).toEqual(both(false));
    expect(owns('rutgers.edu', 'AE-RU-NB')).toEqual(both(true));
  });
  it('gilbert.parkathletics.com is Park Gilbert\'s, never Park\'s', () => {
    expect(owns('gilbert.parkathletics.com', 'AE-PARK-GILBERT')).toEqual(both(true));
    expect(owns('gilbert.parkathletics.com', 'AE-PARK')).toEqual(both(false));
    expect(owns('parkathletics.com', 'AE-PARK')).toEqual(both(true));
  });
  it('a system-parent institution domain can only narrow: no campus owns it', () => {
    expect(r.ownerOfHost('sys.edu')).toMatchObject({ entity: null, parentOnly: ['AE-SYS', 'AE-SYS-1', 'AE-SYS-2'] });
    for (const e of ['AE-SYS-1', 'AE-SYS-2']) expect(owns('athletics.sys.edu', e)).toEqual(both(false));
  });
});

describe('explicit negative records and the registrable-domain fallback', () => {
  it('a WRONG_INSTITUTION row is owned by nobody', () => {
    expect(owns('snowbadgers.com', 'AE-SNOW')).toEqual(both(false));
  });
  it('an explicit untrusted subdomain row blocks its owned parent domain', () => {
    expect(owns('bad.x.edu', 'AE-X')).toEqual(both(false));
  });
  it('an unrecorded subdomain falls back to its trusted registrable domain', () => {
    expect(r.hostOwnedBy('athletics.x.edu', 'AE-X')).toBe(true);
    expect(r.ownerOfHost('athletics.x.edu')).toMatchObject({ entity: 'AE-X', via: 'REGISTRABLE_DOMAIN' });
    expect(r.resolve({ source_url: 'https://athletics.x.edu/roster' })).toMatchObject({ entity_id: 'AE-X', method: 'AUTHORITATIVE_DOMAIN' });
  });
  it('a shared platform root is owned by nobody', () => {
    expect(owns('sidearmsports.com', 'AE-A')).toEqual(both(false));
  });
});

describe('the invariant', () => {
  it('entityHosts and hostOwnedBy agree for every relevant relationship', () => {
    expect(hostOwnershipDisagreements({ resolver: r, domains: DOMAINS, entities: ENTITIES })).toEqual([]);
  });
  it('detects a resolver whose two APIs disagree', () => {
    const broken = { ...r, hostOwnedBy: (h, e) => (h === 'athletics.parkland.edu' ? false : r.hostOwnedBy(h, e)) };
    expect(hostOwnershipDisagreements({ resolver: broken, domains: DOMAINS, entities: ENTITIES })).toEqual(['athletics.parkland.edu AE-PARKLAND (entityHosts true, hostOwnedBy false)']);
  });
});
