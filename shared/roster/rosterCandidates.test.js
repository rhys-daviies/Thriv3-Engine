import { describe, it, expect } from 'vitest';
import {
  SHAPES, SLUGS, CANDIDATE, rosterCandidatesForVerifiedHost, candidatesForLookup,
} from './rosterCandidates.js';

/**
 * L7B — the generator, which is a catalogue and must stay one.
 *
 * The two things that would make it dangerous are generating from a host nobody
 * verified, and generating a path that could belong to another programme. Both
 * have a test here, and neither depends on the network.
 */

const ok = (o = {}) => rosterCandidatesForVerifiedHost({
  host: 'example.test', sport: 'mens-soccer', season: 2026, verified: true, ...o,
});

describe('nothing is generated without a verified host', () => {
  it('refuses when the caller has not asserted verification', () => {
    const r = rosterCandidatesForVerifiedHost({ host: 'example.test', sport: 'mens-soccer', season: 2026 });
    expect(r.status).toBe(CANDIDATE.HOST_NOT_VERIFIED);
    expect(r.candidates).toEqual([]);
    expect(r.reason).toBeTruthy();
  });

  it('refuses when there is no host at all', () => {
    const r = ok({ host: null });
    expect(r.status).toBe(CANDIDATE.NO_TRUSTED_HOST);
    expect(r.candidates).toEqual([]);
  });

  it('refuses a sport it has no catalogued segment for', () => {
    const r = ok({ sport: 'mens-lacrosse' });
    expect(r.status).toBe(CANDIDATE.UNSUPPORTED_SPORT);
    expect(r.candidates).toEqual([]);
  });

  it('gives a reason every time it gives no candidates', () => {
    for (const r of [ok({ host: null }), ok({ sport: 'x' }),
      rosterCandidatesForVerifiedHost({ host: 'a.test', sport: 'mens-soccer', season: 2026 })]) {
      expect(r.reason).toEqual(expect.any(String));
    }
  });
});

describe('the shapes are the ones the corpus actually used', () => {
  it('generates every catalogued shape on every catalogued slug', () => {
    /*
     * OPEN shapes and slugs only, which is the whole catalogue for an ordinary
     * host. L7N added one `exclusive` shape — generated solely for a platform
     * the ledger records as using it — and one `soleProgrammeOnly` slug that
     * only such a shape may ask for. Neither is reachable here, and that is the
     * property being asserted: a host with no recorded platform still gets
     * exactly the eight-by-three ladder it always got.
     */
    const openShapes = SHAPES.filter((sh) => !sh.exclusive);
    const openSlugs = SLUGS['mens-soccer'].filter((sl) => !sl.soleProgrammeOnly);
    const r = ok();
    expect(r.status).toBe(CANDIDATE.OK);
    expect(r.candidates.length).toBe(openShapes.length * openSlugs.length);
    expect(r.candidates.length).toBe(24);
    expect(new Set(r.candidates.map((c) => c.url)).size).toBe(r.candidates.length);
  });

  it('puts every candidate under /sports/<slug>/ on the given host', () => {
    for (const c of ok().candidates) {
      const u = new URL(c.url);
      expect(u.protocol).toBe('https:');
      expect(u.hostname).toBe('example.test');
      expect(u.pathname).toMatch(/^\/sports\/(mens-soccer|msoc|m-soccer)\//);
    }
  });

  it('substitutes the season and its academic span', () => {
    const urls = ok({ season: 2026 }).candidates.map((c) => c.url);
    expect(urls).toContain('https://example.test/sports/mens-soccer/roster/2026');
    expect(urls).toContain('https://example.test/sports/msoc/2026-27/roster?view=table');
    expect(urls.join(' ')).not.toContain('<');
  });

  it('never generates the bare `soccer` slug', () => {
    // Four corpus URLs use it, all at schools with only a women's programme.
    // A school with both would answer "the soccer roster" with no way to know
    // which, and these targets have no prior squad for the gate to catch it.
    for (const sport of Object.keys(SLUGS)) {
      const urls = ok({ sport }).candidates.map((c) => c.url);
      expect(urls.some((u) => u.includes('/sports/soccer/'))).toBe(false);
    }
  });

  it('keeps men\'s and women\'s segments completely separate', () => {
    const m = ok({ sport: 'mens-soccer' }).candidates.map((c) => c.url).join(' ');
    const w = ok({ sport: 'womens-soccer' }).candidates.map((c) => c.url).join(' ');
    expect(m).not.toMatch(/womens-soccer|\/wsoc\/|w-soccer/);
    expect(w).not.toMatch(/\/mens-soccer\/|\/msoc\/|\/m-soccer\//);
  });
});

describe('ordering is deterministic and follows what was observed', () => {
  it('offers the commonest shape on the commonest slug first', () => {
    expect(ok().candidates[0].url).toBe('https://example.test/sports/mens-soccer/roster/2026');
  });

  it('is shape-major: every slug for a shape before the next shape', () => {
    const ids = ok().candidates.map((c) => c.shape);
    expect(ids.slice(0, 3)).toEqual(['ROSTER_YEAR', 'ROSTER_YEAR', 'ROSTER_YEAR']);
  });

  it('puts the host\'s own provider first when the ledger knows it', () => {
    // Shape AND segment. L7C attempted five Presto programmes with the long
    // segment and got 404 from every one; of 37 Presto sources in the corpus,
    // all 37 use the short one and none uses the long.
    const r = ok({ platform: 'PRESTO' });
    expect(r.candidates[0].url).toBe('https://example.test/sports/msoc/2026-27/roster?view=table');
  });

  it('keeps the long segment first for a provider that uses it', () => {
    expect(ok({ platform: 'SIDEARM' }).candidates[0].url)
      .toBe('https://example.test/sports/mens-soccer/roster/2026');
  });

  it('is a stable partition — the same URLs, reordered', () => {
    const plain = ok().candidates.map((c) => c.url).sort();
    const presto = ok({ platform: 'PRESTO' }).candidates.map((c) => c.url).sort();
    expect(presto).toEqual(plain);
  });

  it('returns the same list every time', () => {
    expect(ok().candidates).toEqual(ok().candidates);
  });

  it('honours a limit without changing what comes first', () => {
    const r = ok({ limit: 3 });
    expect(r.candidates.length).toBe(3);
    expect(r.candidates).toEqual(ok().candidates.slice(0, 3));
  });
});

describe('a lookup result decides whether anything is generated at all', () => {
  const args = { sport: 'womens-soccer', season: 2026 };

  it('generates for a single trusted host', () => {
    const r = candidatesForLookup({ status: 'OK', hosts: ['a.test'] }, args);
    expect(r.status).toBe(CANDIDATE.OK);
    expect(r.host).toBe('a.test');
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it('generates nothing, and says so, when the host is ambiguous', () => {
    const r = candidatesForLookup({ status: 'AMBIGUOUS', hosts: ['a.test', 'b.test'], reason: 'two' }, args);
    expect(r.status).toBe(CANDIDATE.AMBIGUOUS_HOST);
    expect(r.candidates).toEqual([]);
    expect(r.hosts).toEqual(['a.test', 'b.test']);
  });

  it('generates nothing when there is no trusted host', () => {
    for (const s of ['NO_TRUSTED_HOST', 'NO_UNITID']) {
      const r = candidatesForLookup({ status: s, hosts: [], reason: 'none' }, args);
      expect(r.status).toBe(CANDIDATE.NO_TRUSTED_HOST);
      expect(r.candidates).toEqual([]);
    }
  });
});
