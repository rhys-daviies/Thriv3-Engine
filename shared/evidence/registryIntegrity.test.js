import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  classifyRegistry, integrityRefuses, INTEGRITY, canonicalHost,
} from './registryIntegrity.js';
import { verifyRosterSource, SOURCE_STATUS } from './sourceVerification.js';

/**
 * THE REGISTRY IS NOT ALLOWED TO BE ITS OWN WITNESS.
 *
 * H12 asked four questions of `athletics_domains` and trusted a host that
 * answered all four. H15 then found ten hosts that answer all four and are
 * still assigned to the wrong school, because the pipeline behind the registry
 * matched page titles to similar-sounding institutions.
 *
 * These tests fix the shape of the answer to that: a NEGATIVE check, driven by
 * whether the institution's own rosters use the host, that can refuse an
 * assignment without naming a replacement. Every fixture below is built from
 * ids and hosts. None of them compares a school name, because the failure they
 * exist to prevent was caused by comparing school names.
 */

const CITADEL = 217864;
const SUFFOLK = 168005;
const CONCORDIA = 173300;
const CONN_COLLEGE = 128902;
const UCONN = 129020;
const BLOOMSBURG = 498562;

/** The registry as H15 measured it, in ids and hosts only. */
const trusted = [
  { domain: 'citadelsports.com', unitid: CITADEL },
  { domain: 'gosuffolkrams.com', unitid: CITADEL },
  { domain: 'gocobbers.com', unitid: CITADEL },
  { domain: 'camelathletics.com', unitid: CONN_COLLEGE },
  { domain: 'uconnhuskies.com', unitid: CONN_COLLEGE },
  { domain: 'bloomsburgathletics.com', unitid: BLOOMSBURG },
  { domain: 'gomounties.com', unitid: BLOOMSBURG },
  { domain: 'lockhavenathletics.com', unitid: BLOOMSBURG },
  { domain: 'goredstorm.com', unitid: SUFFOLK },
];

/** Which institution's own rosters point at which host. */
const usage = [
  { unitid: CITADEL, host: 'citadelsports.com' },
  { unitid: CONN_COLLEGE, host: 'camelathletics.com' },
  { unitid: BLOOMSBURG, host: 'bloomsburgathletics.com' },
  { unitid: BLOOMSBURG, host: 'gomounties.com' },
  { unitid: BLOOMSBURG, host: 'lockhavenathletics.com' },
  { unitid: SUFFOLK, host: 'gosuffolkrams.com' },
];

const registry = classifyRegistry(trusted, usage);
const domains = new Map(trusted.map((r) => [r.domain, r.unitid]));

const verify = (host, unitid) => verifyRosterSource({
  url: `https://${host}/sports/mens-soccer/roster/2026`,
  unitid,
  season: '2026',
  urlSeason: '2026',
  verifiedDomains: domains,
  registryIntegrity: registry,
});

describe('classifying what the registry says about a host', () => {
  it('leaves a host its institution holds alone as clean', () => {
    expect(registry.get('goredstorm.com').state).toBe(INTEGRITY.CLEAN);
    expect(integrityRefuses(INTEGRITY.CLEAN)).toBe(false);
  });

  it('does not refuse a merged institution merely for holding three sites', () => {
    for (const h of ['bloomsburgathletics.com', 'gomounties.com', 'lockhavenathletics.com']) {
      expect(registry.get(h).state).toBe(INTEGRITY.MULTI_SITE_CORROBORATED);
      expect(integrityRefuses(registry.get(h).state)).toBe(false);
    }
  });

  it('refuses the sites of a multi-site institution that its own rosters never use', () => {
    expect(registry.get('gosuffolkrams.com').state).toBe(INTEGRITY.MULTI_SITE_UNCORROBORATED);
    expect(registry.get('gocobbers.com').state).toBe(INTEGRITY.MULTI_SITE_UNCORROBORATED);
    expect(registry.get('citadelsports.com').state).toBe(INTEGRITY.MULTI_SITE_CORROBORATED);
  });

  it('refuses a host two institutions are both recorded as owning', () => {
    const shared = classifyRegistry(
      [{ domain: 'contested.com', unitid: CITADEL }, { domain: 'contested.com', unitid: SUFFOLK }],
      [{ unitid: CITADEL, host: 'contested.com' }, { unitid: SUFFOLK, host: 'contested.com' }],
    );
    expect(shared.get('contested.com').state).toBe(INTEGRITY.SHARED_HOST_CONFLICT);
    expect(integrityRefuses(shared.get('contested.com').state)).toBe(true);
  });

  it('names no replacement owner for anything it refuses', () => {
    // The refusal carries the assignment it doubts and the institution's other
    // hosts — never a corrected unitid, because the data cannot supply one.
    const r = registry.get('uconnhuskies.com');
    expect(r.unitid).toBe(CONN_COLLEGE);
    expect(r.siblings).toEqual(['camelathletics.com']);
  });
});

describe('what the source gate does with that', () => {
  it('accepts the corroborated site of a multi-site institution', () => {
    expect(verify('camelathletics.com', CONN_COLLEGE).status).toBe(SOURCE_STATUS.VERIFIED_DIRECT);
  });

  it('refuses the uncorroborated one under the institution it is assigned to', () => {
    expect(verify('uconnhuskies.com', CONN_COLLEGE).status).toBe(SOURCE_STATUS.REGISTRY_CONFLICT);
  });

  it('still reports an id disagreement as an id disagreement', () => {
    // The same host reached by the programme the registry did NOT assign it to
    // is a different defect, and the repair queue points at a different fix.
    expect(verify('uconnhuskies.com', UCONN).status).toBe(SOURCE_STATUS.INSTITUTION_MISMATCH);
    expect(verify('gocobbers.com', CONCORDIA).status).toBe(SOURCE_STATUS.INSTITUTION_MISMATCH);
  });

  it('offers no url for a refused host', () => {
    expect(verify('gosuffolkrams.com', CITADEL).url).toBe(null);
  });

  it('works with no integrity map at all, refusing nothing extra', () => {
    // Callers that have not built one get H12's behaviour, not a crash.
    const r = verifyRosterSource({
      url: 'https://uconnhuskies.com/sports/mens-soccer/roster/2026',
      unitid: CONN_COLLEGE, season: '2026', urlSeason: '2026', verifiedDomains: domains,
    });
    expect(r.status).toBe(SOURCE_STATUS.VERIFIED_DIRECT);
  });

  it('compares hosts canonically on both sides of the gate', () => {
    expect(canonicalHost('WWW.UConnHuskies.com:443')).toBe('uconnhuskies.com');
    const r = verifyRosterSource({
      url: 'https://www.uconnhuskies.com/sports/mens-soccer/roster/2026',
      unitid: CONN_COLLEGE, season: '2026', urlSeason: '2026',
      verifiedDomains: domains, registryIntegrity: registry,
    });
    expect(r.status).toBe(SOURCE_STATUS.REGISTRY_CONFLICT);
  });
});

describe('the rule is data, not a list of schools', () => {
  it('mentions no institution by name in production code', () => {
    // The bad assignments were produced by name matching. A name appearing in
    // a branch here would mean we had gone back to fixing them one at a time.
    const code = [
      'shared/evidence/registryIntegrity.js',
      'shared/evidence/sourceVerification.js',
      'server/lib/evidenceQueries.js',
    ].map((f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'))
      .map((src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))
      .join('\n');
    for (const name of ['UConn', 'Connecticut College', 'Citadel', 'Suffolk', 'Columbia', 'Chapman']) {
      expect(code).not.toContain(name);
    }
  });

  it('refuses to classify a host the registry never lists', () => {
    const only = classifyRegistry([{ domain: 'nobody.com', unitid: 999 }], []);
    expect(only.get('nobody.com').state).toBe(INTEGRITY.CLEAN);
    expect(only.get('unlisted.com')).toBeUndefined();
  });
});
