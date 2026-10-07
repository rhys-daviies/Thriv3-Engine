import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createIdentityResolver } from './identityResolver.js';
import { classifySource, mayEstablish } from './sourceAuthority.js';
import { classifyPage, sourceContext } from './changeClassifier.js';
import { buildRegressionWorld, rosterPage } from './regressionWorld.js';
import { loadRefreshContext } from './context.js';

/**
 * PHASE 8C.7D — one source-ownership question for every refresh layer.
 *
 * The gatherer asked identityResolver.sourceOwnedBy (an owned host OR a VERIFIED path-scoped
 * location); the classifier asked hostOwnedBy only, so a registered path location passed the
 * gather and was then refused as SOURCE_UNTRUSTED. Both layers now ask sourceOwnedBy. Host
 * ownership stays a separate question, and a location authorises only its own entity, path and
 * sport, on a host the registry has made no decision about.
 */
const SHARED = 'district.example';
const URLS = {
  roster: `https://${SHARED}/sports/mens-soccer/roster`,
  schedule: `https://${SHARED}/sports/mens-soccer/schedule`,
  women: `https://${SHARED}/sports/womens-soccer/roster`,
  basketball: `https://${SHARED}/sports/mens-basketball/roster`,
  root: `https://${SHARED}/`,
  aspx: `https://${SHARED}/schedule.aspx?schedule=271`,
  lookalike: `https://${SHARED}/sports/mens-soccer-2/roster`,
  lookalikeNoSlash: `https://${SHARED}/sports/mens-soccerx`,
  traversal: `https://${SHARED}/sports/mens-soccer/../womens-soccer/roster`,
  encodedTraversal: `https://${SHARED}/sports/mens-soccer/%2e%2e/womens-soccer/roster`,
  userinfo: `https://${SHARED}@evil.example/sports/mens-soccer/roster`,
  query: `https://${SHARED}/news?next=/sports/mens-soccer/roster`,
  otherHost: 'https://other.example/sports/mens-soccer/roster',
};
const loc = (over = {}) => ({ location_id: 'l1', athletics_entity_id: 'AE-U1', host: SHARED, path_prefix: '/sports/mens-soccer', source_type: 'SPORT_PAGE', sport: 'mens-soccer', status: 'VERIFIED', provenance: 't', recorded_at: 't', ...over });
const ENTITIES = [1, 2, 3].map((n) => ({ athletics_entity_id: `AE-U${n}`, federal_unitid: n, entity_kind: 'SINGLE' }));
const resolverWith = (locations, domains = []) => createIdentityResolver({ entities: ENTITIES, colleges: [], domains, locations });
const ctxOf = (resolver) => ({ resolver, conferenceHosts: new Set() });
const tierFor = (resolver, url, entity, sport, kind = 'OFFICIAL_ROSTER') => classifySource({ url, kind, observedSeason: 2026, pageSeason: 2026 }, sourceContext(ctxOf(resolver), entity, 2026, sport)).tier;

describe('sourceOwnedBy is the source question; hostOwnedBy stays the host question', () => {
  const r = resolverWith([loc()]);
  it('a verified sport-scoped location owns exactly its entity, path and sport', () => {
    expect(r.sourceOwnedBy(URLS.roster, 'AE-U1', { sport: 'mens-soccer' })).toBe(true);
    expect(r.sourceOwnedBy(URLS.schedule, 'AE-U1', { sport: 'mens-soccer' })).toBe(true);
  });
  it('the location never makes its entity the owner of the host', () => {
    expect(r.hostOwnedBy(SHARED, 'AE-U1')).toBe(false);
    expect(r.ownerOfHost(SHARED).entity).toBeNull();
    expect([...r.entityHosts('AE-U1')]).toEqual([]);
  });
  it('refuses the wrong entity, the wrong sport and every URL outside the path', () => {
    expect(r.sourceOwnedBy(URLS.roster, 'AE-U2', { sport: 'mens-soccer' })).toBe(false);
    expect(r.sourceOwnedBy(URLS.roster, 'AE-U1', { sport: 'womens-soccer' })).toBe(false);
    for (const k of ['women', 'basketball', 'root', 'aspx', 'lookalike', 'lookalikeNoSlash', 'traversal', 'encodedTraversal', 'userinfo', 'query', 'otherHost']) {
      expect([k, r.sourceOwnedBy(URLS[k], 'AE-U1', { sport: 'mens-soccer' })]).toEqual([k, false]);
    }
  });
  it('a held, refuted, contested or other-owned host is never opened by a location', () => {
    const cases = [
      [{ domain: SHARED, status: 'VERIFIED', athletics_entity_id: 'AE-U2' }], // another entity owns the host
      [{ domain: SHARED, status: 'WRONG_INSTITUTION', unitid: 1 }],
      [{ domain: SHARED, status: 'VERIFIED', athletics_entity_id: 'AE-U1' }, { domain: `www.${SHARED}`, status: 'VERIFIED', athletics_entity_id: 'AE-U2' }], // conflicting twins
      [{ domain: SHARED, status: 'AMBIGUOUS' }],
    ];
    for (const domains of cases) {
      const x = resolverWith([loc()], domains);
      if (x.hostOwnedBy(SHARED, 'AE-U1')) continue; // (the twin case owns nothing; a host the entity owns is not a location question)
      expect(x.sourceOwnedBy(URLS.roster, 'AE-U1', { sport: 'mens-soccer' })).toBe(false);
    }
  });
  it('a host record that makes no claim (insufficient evidence / unreachable) leaves the location in force', () => {
    for (const status of ['INSUFFICIENT_EVIDENCE', 'UNREACHABLE']) {
      expect(resolverWith([loc()], [{ domain: SHARED, status }]).sourceOwnedBy(URLS.roster, 'AE-U1', { sport: 'mens-soccer' })).toBe(true);
    }
  });
  it('a location that is not VERIFIED authorises nothing', () => {
    for (const status of ['REVIEW', 'HISTORICAL']) expect(resolverWith([loc({ status })]).sourceOwnedBy(URLS.roster, 'AE-U1', { sport: 'mens-soccer' })).toBe(false);
  });
});

describe('sourceAuthority asks the source question when it is given one', () => {
  const owns = (h) => h === 'team.example';
  it('an entity-owned host is tier A exactly as before, with or without ownsSource', () => {
    expect(classifySource({ url: 'https://team.example/roster', kind: 'OFFICIAL_ROSTER' }, { ownsHost: owns }).tier).toBe('A');
    const r = resolverWith([], [{ domain: 'team.example', status: 'VERIFIED', athletics_entity_id: 'AE-U1' }]);
    expect(tierFor(r, 'https://team.example/sports/mens-soccer/roster', 'AE-U1', 'mens-soccer')).toBe('A');
    expect(tierFor(r, 'https://team.example/sports/mens-soccer/roster', 'AE-U2', 'mens-soccer')).toBe('D');
  });
  it('ownsSource decides when present; the reason names the URL', () => {
    const s = classifySource({ url: URLS.roster, kind: 'OFFICIAL_ROSTER' }, { ownsHost: () => false, ownsSource: () => true });
    expect(s.tier).toBe('A');
    const d = classifySource({ url: URLS.roster, kind: 'OFFICIAL_ROSTER' }, { ownsHost: () => true, ownsSource: () => false });
    expect(d.tier).toBe('D'); expect(d.reasons.join(' ')).toMatch(/is not inside a source owned/);
  });
  it('a path-scoped source reaches tier A, and only for its entity, sport and path', () => {
    const r = resolverWith([loc()]);
    expect(tierFor(r, URLS.roster, 'AE-U1', 'mens-soccer')).toBe('A');
    expect(mayEstablish('roster_current', classifySource({ url: URLS.roster, kind: 'OFFICIAL_ROSTER', pageSeason: 2026 }, sourceContext(ctxOf(r), 'AE-U1', 2026, 'mens-soccer'))).ok).toBe(true);
    expect(tierFor(r, URLS.roster, 'AE-U2', 'mens-soccer')).toBe('D');
    expect(tierFor(r, URLS.roster, 'AE-U1', 'womens-soccer')).toBe('D');
    for (const k of ['women', 'basketball', 'root', 'aspx', 'lookalike', 'traversal', 'userinfo', 'query']) expect([k, tierFor(r, URLS[k], 'AE-U1', 'mens-soccer')]).toEqual([k, 'D']);
  });
  it('without a sport the context falls back to host ownership only (a sport-scoped location never matches "any sport")', () => {
    const r = resolverWith([loc()]);
    expect(sourceContext(ctxOf(r), 'AE-U1', 2026, null).ownsSource).toBeNull();
    expect(tierFor(r, URLS.roster, 'AE-U1', null)).toBe('D');
  });
  it('with no location the shared host proves nothing', () => {
    expect(tierFor(resolverWith([]), URLS.roster, 'AE-U1', 'mens-soccer')).toBe('D');
  });
});

describe('Kennedy-King-shaped regression: gatherer and classifier give the same answer', () => {
  // A district host shared by two member colleges, no host owner, one verified men's-soccer path for North.
  let dir; let ctx; const opts = { season: 2027, now: new Date('2027-08-20T00:00:00Z'), frozen: new Set([2025]) };
  const NORTH = 'AE-U900951'; const SOUTH = 'AE-U900952';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p8c7d-src-'));
    const p = path.join(dir, 'w.sqlite'); buildRegressionWorld(p);
    const db = new Database(p);
    const T = '2026-09-29T00:00:00.000Z';
    for (const [ent, name, unitid] of [[NORTH, 'District College North', 900951], [SOUTH, 'District College South', 900952]]) {
      db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES (?,?,?,'SINGLE','test',?)").run(ent, name, unitid, T);
      for (const sport of ['mens-soccer', 'womens-soccer']) {
        const id = `${ent}-${sport}`;
        db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, unitid, active, athletics_entity_id) VALUES (?,?,?,?,?,'NJCAA','NJCAAD1',?,1,?)").run(id, T, T, name, sport, unitid, ent);
        db.prepare("INSERT INTO programme_membership_periods (athletics_entity_id, sport, first_season, last_season, governing_body, division, membership_status, conference, college_id, source_tier, provenance, recorded_at) VALUES (?,?,2026,NULL,'NJCAA','NJCAA','ACTIVE','NJCAAD1',?,'SEED','test',?)").run(ent, sport, id, T);
      }
    }
    db.prepare('INSERT INTO athletics_source_locations (location_id, athletics_entity_id, host, path_prefix, source_type, sport, status, provenance, recorded_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('kk-shape', NORTH, SHARED, '/sports/mens-soccer', 'SPORT_PAGE', 'mens-soccer', 'VERIFIED', 'test', T);
    // a location on a host the registry gives to another entity (Concordia Texas) — must never authorise
    db.prepare('INSERT INTO athletics_source_locations (location_id, athletics_entity_id, host, path_prefix, source_type, sport, status, provenance, recorded_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('contested', NORTH, 'concordiatx.example', '/sports/mens-soccer', 'SPORT_PAGE', 'mens-soccer', 'VERIFIED', 'test', T);
    db.close();
    const ro = new Database(p, { readonly: true });
    ctx = { ...loadRefreshContext(ro), coaches: [], roster: [] };
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const page = (entity, url, sport = 'mens-soccer') => rosterPage({ athletics_entity_id: entity, institution_label: entity === NORTH ? 'District College North' : 'District College South', source_url: url, sport, players: [{ player_name: 'Robin Example', class_year_label: 'Fr.', position: 'MF' }] });
  const run = (entity, url, sport) => classifyPage(page(entity, url, sport), ctx, opts)[0];

  it('the registered path: gather ownership = classifier ownership = trusted, and the player is a NEW_RECORD', () => {
    const o = run(NORTH, URLS.roster);
    expect(ctx.resolver.sourceOwnedBy(URLS.roster, NORTH, { sport: 'mens-soccer' })).toBe(true);
    expect(o.source_tier).toBe('A');
    expect(o.classification).toBe('NEW_RECORD');
  });
  it('every neighbouring entity / sport / path refuses, at both layers', () => {
    const cases = [
      [SOUTH, URLS.roster, 'mens-soccer'], [NORTH, URLS.women, 'womens-soccer'], [NORTH, URLS.basketball, 'mens-soccer'],
      [NORTH, URLS.root, 'mens-soccer'], [NORTH, URLS.lookalike, 'mens-soccer'], [NORTH, URLS.traversal, 'mens-soccer'],
      [NORTH, 'https://concordiatx.example/sports/mens-soccer/roster/2027', 'mens-soccer'],
    ];
    for (const [entity, url, sport] of cases) {
      const o = run(entity, url, sport);
      expect([url, entity, ctx.resolver.sourceOwnedBy(url, entity, { sport })]).toEqual([url, entity, false]);
      expect([url, entity, o.classification]).not.toEqual([url, entity, 'NEW_RECORD']);
      expect(['SOURCE_UNTRUSTED', 'CONTRADICTION', 'IDENTITY_AMBIGUOUS']).toContain(o.classification);
    }
  });
  it('an entity-owned host behaves exactly as before (Concordia Texas stays tier A on its own host)', () => {
    const o = classifyPage(rosterPage({ players: [{ player_name: 'Alex Keeper', class_year_label: 'Jr.', position: 'GK' }] }), ctx, opts)[0];
    expect(o.source_tier).toBe('A');
    expect(o.classification).toBe('NEW_RECORD');
  });
});
