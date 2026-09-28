import { describe, it, expect } from 'vitest';
import { matchSchoolName, normalizeForMatch, disambiguatorTokens } from './coachingImport.js';
import { createResolver, DECISION } from './institutionResolver.js';

/**
 * Phase 3A regression suite — freezes the institution-identity invariants.
 * The load-bearing rule: a resolver may resolve correctly, or decline
 * (REVIEW/WITHHOLD), but MUST NEVER silently resolve one institution to
 * another. ZERO cross-institution resolutions are permitted.
 */

// Hermetic college corpus covering every collision family from Phase 1/2.
const mk = (name, sport, unitid, state) => ({ name, sport, unitid, state, division: 'NCAA D1' });
const CORPUS = [
  // Saint Mary's family
  mk("Saint Mary's", 'womens-soccer', 123554, 'CA'),
  mk("St. Mary's (TX)", 'womens-soccer', 228149, 'TX'),
  mk('Saint Mary’s University of Minnesota', 'womens-soccer', 174817, 'MN'),
  mk("St Mary's College of Maryland", 'womens-soccer', 163912, 'MD'),
  mk("Saint Mary's College (IN)", 'womens-soccer', 152390, 'IN'),
  mk('Saint Mary (KS)', 'womens-soccer', 155812, 'KS'),
  mk("Mount St. Mary's", 'womens-soccer', 163462, 'MD'),
  mk('Saint Mary-of-the-Woods College', 'womens-soccer', 152381, 'IN'),
  // geographic ambiguity
  mk('Miami (FL)', 'womens-soccer', 133951, 'FL'),
  mk('Miami (OH)', 'womens-soccer', 204024, 'OH'),
  mk('Wayne State (MI)', 'womens-soccer', 172644, 'MI'),
  mk('Wayne State (NE)', 'womens-soccer', 181215, 'NE'),
  mk('Dominican (NY)', 'womens-soccer', 191241, 'NY'),
  mk('Dominican (CA)', 'womens-soccer', 113698, 'CA'),
  mk('Anderson (IN)', 'mens-soccer', 150066, 'IN'),
  mk('Anderson (SC)', 'mens-soccer', 217819, 'SC'),
  mk('Wheaton (IL)', 'mens-soccer', 149781, 'IL'),
  mk('Wheaton (MA)', 'mens-soccer', 168430, 'MA'),
  mk('Columbia College (SC)', 'womens-soccer', 217929, 'SC'),
  mk('Columbia College (MO)', 'womens-soccer', 177339, 'MO'),
  mk('Concordia University-Texas', 'womens-soccer', 224004, 'TX'),
  mk('Texas', 'womens-soccer', 228778, 'TX'),
  mk('Union (KY)', 'mens-soccer', 157863, 'KY'),
  mk('Union (TN)', 'mens-soccer', 221838, 'TN'),
  mk('Xavier (LA)', 'mens-soccer', 160904, 'LA'),
  mk('Xavier', 'mens-soccer', 204209, 'OH'),
  mk("St. Joseph's University (Brooklyn)", 'womens-soccer', 195544, 'NY'),
  mk("St. Joseph's University (Long Island)", 'womens-soccer', 196103, 'NY'),
];
const poolNames = (sport) => CORPUS.filter((c) => c.sport === sport).map((c) => c.name);
const paren = (s) => { const m = s.match(/\(([^)]*)\)/); return m ? m[1].trim().toLowerCase() : null; };

// Registry with the two Phase-2 corruption cases + one good domain.
const DOMAINS = [
  { domain: 'smcmathletics.com', unitid: 163912, status: 'VERIFIED_ALIAS' }, // St Mary's MD (good)
  { domain: 'stmarytx.edu', unitid: 123554, status: 'WRONG_INSTITUTION' },   // corrupted -> must NOT resolve to CA
  { domain: 'redstormsports.com', unitid: 195720, status: 'WRONG_INSTITUTION' }, // corrupted -> must NOT resolve to Fisher
];
const resolver = createResolver({ colleges: CORPUS, domains: DOMAINS, aliases: [] });

describe('normalizeForMatch — parenthetical is a disambiguator, not noise', () => {
  it('keeps the disambiguator so siblings differ', () => {
    expect(normalizeForMatch('Miami (FL)')).not.toBe(normalizeForMatch('Miami (OH)'));
    expect(normalizeForMatch("St. Mary's (TX)")).not.toBe(normalizeForMatch("Saint Mary's"));
  });
  it('never promotes the parenthetical to a standalone token equal to another institution', () => {
    // "Concordia (Texas)" must not normalise to "texas"
    expect(normalizeForMatch('Concordia (Texas)')).not.toBe('texas');
    expect(disambiguatorTokens('Concordia (Texas)')).toEqual(['texas']);
  });
});

describe('matchSchoolName — no cross-institution at resolve-worthy confidence', () => {
  const cases = CORPUS.map((c) => c.name);
  it.each(cases)('%s resolves to self or declines (<0.7), never a different-disambiguator sibling', (name) => {
    const sport = CORPUS.find((c) => c.name === name).sport;
    const m = matchSchoolName(name, poolNames(sport));
    const crossed = m.matched_college && m.matched_college !== name
      && m.confidence >= 0.7 && paren(m.matched_college) !== paren(name);
    expect(crossed).toBe(false);
  });

  it('the specific Phase-1 maps are gone', () => {
    expect(matchSchoolName('Concordia (Texas)', poolNames('womens-soccer')).matched_college).not.toBe('Texas');
    const stx = matchSchoolName("St. Mary's (TX)", poolNames('womens-soccer'));
    expect(stx.matched_college === "Saint Mary's" && stx.confidence >= 0.7).toBe(false);
    expect(matchSchoolName('Miami (FL)', poolNames('womens-soccer')).matched_college).toBe('Miami (FL)');
  });
});

describe('resolver — explicit outcomes and evidence hierarchy', () => {
  it('exact disambiguated name RESOLVES to its own unitid', () => {
    const r = resolver.resolve('Miami (OH)', { sport: 'womens-soccer' });
    expect(r.decision).toBe(DECISION.RESOLVED);
    expect(r.unitid).toBe(204024);
  });
  it('VERIFIED authoritative domain RESOLVES via UNITID', () => {
    const r = resolver.resolve('anything', { sport: 'womens-soccer', sourceUrl: 'https://smcmathletics.com/sports/womens-soccer/coaches' });
    expect(r.decision).toBe(DECISION.RESOLVED);
    expect(r.unitid).toBe(163912); // St Mary's Maryland
    expect(r.method).toBe('DOMAIN');
  });
  it('a WRONG_INSTITUTION registry domain never RESOLVES (REVIEW)', () => {
    const r = resolver.resolve("St. Mary's", { sport: 'womens-soccer', sourceUrl: 'https://redstormsports.com/x' });
    expect(r.decision).toBe(DECISION.REVIEW);
    expect(r.unitid).toBeNull();
  });
  it('corrupted stmarytx.edu never resolves St. Mary’s to California', () => {
    const r = resolver.resolve('St. Mary’s University', { sport: 'womens-soccer', sourceUrl: 'https://stmarytx.edu/athletics' });
    expect(r.unitid).not.toBe(123554);
  });
  it('insufficient evidence DECLINES (REVIEW/WITHHOLD), never guesses', () => {
    const r = resolver.resolve('Saint Somebody', { sport: 'womens-soccer' });
    expect([DECISION.REVIEW, DECISION.WITHHOLD]).toContain(r.decision);
    expect(r.unitid).toBeNull();
  });
  it('FALSE NEGATIVE over FALSE POSITIVE: bare ambiguous name declines', () => {
    // "Wayne State" with no disambiguator/state must not confidently pick MI or NE
    const r = resolver.resolve('Wayne State', { sport: 'womens-soccer' });
    expect(r.decision).not.toBe(DECISION.RESOLVED);
  });
});

describe('canonical round-trip — ZERO cross-institution', () => {
  it('every corpus institution resolves to itself or declines', () => {
    let cross = 0;
    for (const c of CORPUS) {
      const r = resolver.resolve(c.name, { sport: c.sport, state: c.state });
      if (r.decision === DECISION.RESOLVED && r.unitid !== c.unitid) cross++;
    }
    expect(cross).toBe(0);
  });
});
