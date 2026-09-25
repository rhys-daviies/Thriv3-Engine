import { describe, it, expect } from 'vitest';
import {
  PROFILE, LOOKUP, canonicalHost, fetchForm, fetchHostsForIdentity, hostsForInstitution,
} from './domainAuthority.js';
import { candidatesForLookup, MAX_ATTEMPTED_CANDIDATES } from '../roster/rosterCandidates.js';

/**
 * L7I — an identity is not a network target.
 *
 * Every fixture is a real row shape. The Northwood block is the measured case:
 * four `athletics_domains` rows for unitid 171492, of which the apex and the
 * `www.` spelling are separately VERIFIED_ALIAS athletics properties, and only
 * the `www.` one serves a roster path.
 */

const row = (o) => ({
  domain: 'example.test', unitid: 1, status: 'VERIFIED', role: 'ATHLETICS_SITE',
  confidence: 'CERTAIN', identity_strength: 'WHOLE_NAME', evidence_text: 'Example Athletics',
  wrong_mappings: null, platform: null, ...o,
});

/* The four real Northwood rows, verbatim in the fields that decide anything. */
const NORTHWOOD = [
  row({ domain: 'gonorthwood.com', unitid: 171492, status: 'VERIFIED_ALIAS', platform: 'PRESTO' }),
  row({ domain: 'www.gonorthwood.com', unitid: 171492, status: 'VERIFIED_ALIAS', platform: 'PRESTO' }),
  row({ domain: 'timberwolves.gonorthwood.com', unitid: 171492, status: 'VERIFIED_ALIAS', platform: 'PRESTO' }),
  row({ domain: 'northwood.edu', unitid: 171492, status: 'VERIFIED', role: 'INSTITUTION_SITE' }),
];
/* Northwood's own rosters have only ever been fetched from the `www.` spelling. */
const NORTHWOOD_OBSERVED = new Map([['www.gonorthwood.com', 5]]);

const lookupFor = (rows, unitid, observed, opts = {}) => hostsForInstitution(
  rows, unitid, { profile: PROFILE.DISCOVERY, observed, ...opts },
);

/* -------------------------------------------------------------------------- */
/* Northwood — the case the stage exists for                                   */
/* -------------------------------------------------------------------------- */

describe('Northwood', () => {
  it('canonicalises the apex and the www spelling to one identity', () => {
    expect(canonicalHost('www.gonorthwood.com')).toBe('gonorthwood.com');
    expect(canonicalHost('gonorthwood.com')).toBe('gonorthwood.com');
  });

  it('resolves to a single identity host, not an ambiguity', () => {
    const l = lookupFor(NORTHWOOD, 171492, NORTHWOOD_OBSERVED,
      { usage: new Set(['gonorthwood.com']) });
    expect(l.status).toBe(LOOKUP.OK);
    expect(l.hosts).toEqual(['gonorthwood.com']);
  });

  it('keeps the www spelling as an approved fetch form, and puts it first', () => {
    const l = lookupFor(NORTHWOOD, 171492, NORTHWOOD_OBSERVED,
      { usage: new Set(['gonorthwood.com']) });
    expect(l.fetchHosts).toEqual(['www.gonorthwood.com', 'gonorthwood.com']);
  });

  it('generates the roster URL that actually answers, inside the bound', () => {
    const l = lookupFor(NORTHWOOD, 171492, NORTHWOOD_OBSERVED,
      { usage: new Set(['gonorthwood.com']) });
    const gen = candidatesForLookup(l, { sport: 'womens-soccer', season: 2026, platform: 'PRESTO' });
    const urls = gen.candidates.map((c) => c.url);
    const ordinal = urls.indexOf('https://www.gonorthwood.com/sports/wsoc/2026-27/roster') + 1;
    expect(ordinal).toBeGreaterThan(0);
    expect(ordinal).toBeLessThanOrEqual(MAX_ATTEMPTED_CANDIDATES);
  });

  it('needed no manual URL: every candidate is generated from the catalogue', () => {
    const l = lookupFor(NORTHWOOD, 171492, NORTHWOOD_OBSERVED,
      { usage: new Set(['gonorthwood.com']) });
    const gen = candidatesForLookup(l, { sport: 'womens-soccer', season: 2026, platform: 'PRESTO' });
    for (const c of gen.candidates) {
      expect(c.shape).toBeTruthy();
      expect(c.slug).toBeTruthy();
      expect(['www.gonorthwood.com', 'gonorthwood.com']).toContain(c.fetchHost);
    }
  });

  it('does not reach the timberwolves subdomain, which is a different identity', () => {
    const l = lookupFor(NORTHWOOD, 171492, NORTHWOOD_OBSERVED,
      { usage: new Set(['gonorthwood.com']) });
    expect(l.fetchHosts).not.toContain('timberwolves.gonorthwood.com');
    const gen = candidatesForLookup(l, { sport: 'womens-soccer', season: 2026 });
    expect(gen.candidates.some((c) => c.url.includes('timberwolves'))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The general contract                                                        */
/* -------------------------------------------------------------------------- */

describe('identity and fetch form are separate concepts', () => {
  it('1. a trusted www row keeps its www spelling as a fetch form', () => {
    const rows = [row({ domain: 'www.one.test' })];
    expect(hostsForInstitution(rows, 1).fetchHosts).toEqual(['www.one.test']);
  });

  it('2. www and apex are one identity, not two', () => {
    const rows = [row({ domain: 'www.one.test' }), row({ domain: 'one.test' })];
    const l = hostsForInstitution(rows, 1);
    expect(l.status).toBe(LOOKUP.OK);
    expect(l.hosts).toEqual(['one.test']);
  });

  it('3. the www spelling does not duplicate the institution\'s authority', () => {
    const rows = [row({ domain: 'www.one.test' }), row({ domain: 'one.test' })];
    expect(hostsForInstitution(rows, 1).hosts).toHaveLength(1);
    expect(new Set(hostsForInstitution(rows, 1).fetchHosts).size)
      .toBe(hostsForInstitution(rows, 1).fetchHosts.length);
  });

  it('4. an apex-only trusted row never invents a www spelling', () => {
    const l = hostsForInstitution([row({ domain: 'one.test' })], 1);
    expect(l.fetchHosts).toEqual(['one.test']);
  });

  it('5. a www-only trusted row never loses its www spelling', () => {
    const l = hostsForInstitution([row({ domain: 'www.one.test' })], 1);
    expect(l.fetchHosts).toEqual(['www.one.test']);
    expect(l.fetchHosts).not.toContain('one.test');
  });

  it('6. an unrelated subdomain is never generated from an identity', () => {
    const l = hostsForInstitution([row({ domain: 'one.test' })], 1, {
      observed: new Map([['athletics.one.test', 9], ['teams.one.test', 9]]),
    });
    expect(l.fetchHosts).toEqual(['one.test']);
  });

  it('7. several approved forms come back in a deterministic order', () => {
    const rows = [row({ domain: 'www.one.test' }), row({ domain: 'one.test' })];
    const observed = new Map([['one.test', 2], ['www.one.test', 7]]);
    const a = hostsForInstitution(rows, 1, { observed }).fetchHosts;
    const b = hostsForInstitution([...rows].reverse(), 1, { observed }).fetchHosts;
    expect(a).toEqual(b);
    // Both are stored AND observed, so the more-used spelling leads.
    expect(a).toEqual(['www.one.test', 'one.test']);
  });

  it('7b. an observed spelling outranks one the ledger merely stores', () => {
    // Carson-Newman's shape: only the www row is stored, only the apex is used.
    const rows = [row({ domain: 'www.cneagles.test' })];
    const observed = new Map([['cneagles.test', 9]]);
    expect(hostsForInstitution(rows, 1, { observed }).fetchHosts)
      .toEqual(['cneagles.test', 'www.cneagles.test']);
  });

  it('8. the candidate ladder is bounded globally, not per host', () => {
    const rows = [row({ domain: 'www.one.test' }), row({ domain: 'one.test' })];
    const l = hostsForInstitution(rows, 1);
    expect(l.fetchHosts).toHaveLength(2);
    const gen = candidatesForLookup(l, {
      sport: 'mens-soccer', season: 2026, limit: MAX_ATTEMPTED_CANDIDATES,
    });
    expect(gen.candidates).toHaveLength(MAX_ATTEMPTED_CANDIDATES);
  });

  it('9. one host walks its whole ladder before the next is tried', () => {
    const rows = [row({ domain: 'www.one.test' }), row({ domain: 'one.test' })];
    const gen = candidatesForLookup(hostsForInstitution(rows, 1, {
      observed: new Map([['www.one.test', 3]]),
    }), { sport: 'mens-soccer', season: 2026 });
    const hosts = gen.candidates.map((c) => c.fetchHost);
    // No interleaving: the first spelling is exhausted before the second starts.
    expect(hosts.indexOf('one.test')).toBe(hosts.lastIndexOf('www.one.test') + 1);
  });

  it('10. a programme with one spelling generates exactly what it always did', () => {
    const l = hostsForInstitution([row({ domain: 'one.test' })], 1);
    const gen = candidatesForLookup(l, { sport: 'mens-soccer', season: 2026 });
    expect(gen.candidates[0].url).toBe('https://one.test/sports/mens-soccer/roster/2026');
    expect(new Set(gen.candidates.map((c) => c.fetchHost))).toEqual(new Set(['one.test']));
  });

  it('11. an ambiguous institution still refuses to generate anything', () => {
    const rows = [row({ domain: 'one.test' }), row({ domain: 'two.test' })];
    const l = hostsForInstitution(rows, 1);
    expect(l.status).toBe(LOOKUP.AMBIGUOUS);
    expect(l.fetchHosts).toEqual([]);
    expect(candidatesForLookup(l, { sport: 'mens-soccer', season: 2026 }).candidates).toEqual([]);
  });

  it('12. a row for another institution is not a fetch form for this one', () => {
    const rows = [row({ domain: 'www.one.test', unitid: 2 })];
    const l = hostsForInstitution(rows, 1);
    expect(l.status).toBe(LOOKUP.NO_TRUSTED_HOST);
    expect(l.fetchHosts).toEqual([]);
  });

  it('13. an observed spelling belonging to another identity cannot leak in', () => {
    const l = hostsForInstitution([row({ domain: 'one.test' })], 1, {
      observed: new Map([['www.two.test', 9], ['two.test', 9]]),
    });
    expect(l.fetchHosts).toEqual(['one.test']);
  });

  it('14. a port in a stored spelling is normalised out of the fetch form', () => {
    expect(fetchForm('www.kstatesports.com:443')).toBe('www.kstatesports.com');
    const l = hostsForInstitution([
      row({ domain: 'www.kstatesports.test:443' }), row({ domain: 'www.kstatesports.test' }),
    ], 1);
    expect(l.fetchHosts).toEqual(['www.kstatesports.test']);
  });

  it('refuses to offer a fetch form for an identity nobody stands behind', () => {
    expect(fetchHostsForIdentity([], 'one.test')).toEqual([]);
    expect(fetchHostsForIdentity([row({ domain: 'one.test' })], '')).toEqual([]);
  });
});
