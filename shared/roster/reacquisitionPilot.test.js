import { describe, it, expect } from 'vitest';
import {
  pilotSample, allocate, orderWithinStratum, sourceShape, underlyingUrl, archived,
  cohortFingerprint, stratumOf, PILOT_SIZE, ALGORITHM,
} from './reacquisitionPilot.js';

/**
 * L7Q — the tests that stop the pilot being chosen.
 *
 * A twenty-programme sample of a 138-programme cohort is only evidence if the
 * twenty were not picked for looking winnable. So the properties asserted here
 * are mostly negative: the selection must not move when the rows arrive in a
 * different order, must not move when a row gains a field describing how
 * promising it is, and must reproduce from the dataset alone.
 */

/** A synthetic cohort shaped like the real one: D3-dominant, SIDEARM-dominant. */
const cohort = (() => {
  const rows = [];
  const spec = [['NCAA D1', 'M', 3], ['NCAA D1', 'W', 15], ['NCAA D2', 'M', 5],
    ['NCAA D2', 'W', 5], ['NCAA D3', 'M', 50], ['NCAA D3', 'W', 60]];
  const shapes = ['SPORTS_SLUG_ROSTER_YEAR', 'SPORTS_SLUG_ROSTER', 'SPORTS_SLUG_ACADEMIC_YEAR_ROSTER'];
  const providers = ['SIDEARM', 'SIDEARM', 'SIDEARM', 'PRESTO', null];
  for (const [division, gender, n] of spec) {
    for (let i = 0; i < n; i += 1) {
      rows.push({
        key: `${division}-${gender}-School ${i}||${gender === 'M' ? 'mens' : 'womens'}-soccer`,
        division, gender,
        sourceShape: shapes[i % shapes.length],
        provider: providers[i % providers.length],
        priorSourceHost: `host${i % 17}.test`,
        priorPlayers: 9 + (i % 40),
      });
    }
  }
  return rows;
})();

describe('the pilot is a function of the cohort, not of a preference', () => {
  it('1/2. selects exactly twenty, and the same twenty every time', () => {
    const a = pilotSample(cohort);
    const b = pilotSample(cohort);
    expect(a.keys).toHaveLength(PILOT_SIZE);
    expect(a.keys).toEqual(b.keys);
    expect(a.digest).toBe(b.digest);
    expect(a.algorithm).toBe(ALGORITHM);
  });

  it('3. does not depend on the order the rows arrive in', () => {
    const shuffled = [...cohort].reverse();
    const rotated = [...cohort.slice(37), ...cohort.slice(0, 37)];
    const base = pilotSample(cohort).keys;
    expect(pilotSample(shuffled).keys).toEqual(base);
    expect(pilotSample(rotated).keys).toEqual(base);
  });

  it('4. does not depend on anything describing how winnable a row looks', () => {
    // The real defect this guards: ranking by 2025 player count, by whether the
    // host is trusted, or by a recorded failure reason would all be a way of
    // preferring the easy ones. None of them may reach the selection.
    const decorated = cohort.map((r, i) => ({
      ...r,
      priorPlayers: 60 - (i % 50),
      trustedHost: i % 2 === 0,
      lastError: i % 3 ? 'unreachable' : 'page season is not 2026',
      candidates: i % 24,
    }));
    expect(pilotSample(decorated).keys).toEqual(pilotSample(cohort).keys);
  });

  it('5. moves its digest when the cohort itself changes', () => {
    const smaller = cohort.slice(0, 130);
    const a = pilotSample(cohort);
    const b = pilotSample(smaller);
    expect(b.cohortFingerprint).not.toBe(a.cohortFingerprint);
    expect(b.digest).not.toBe(a.digest);
    expect(cohortFingerprint(cohort)).toBe(a.cohortFingerprint);
  });

  it('6. covers every division and both genders, and keeps D3 the largest group', () => {
    const p = pilotSample(cohort);
    const by = (f) => p.rows.reduce((m, r) => { m[f(r)] = (m[f(r)] ?? 0) + 1; return m; }, {});
    const div = by((r) => r.division);
    expect(Object.keys(div).sort()).toEqual(['NCAA D1', 'NCAA D2', 'NCAA D3']);
    expect(div['NCAA D3']).toBeGreaterThan(div['NCAA D1'] + div['NCAA D2']);
    expect(Object.keys(by((r) => r.gender)).sort()).toEqual(['M', 'W']);
    expect(Object.keys(by((r) => r.stratum))).toHaveLength(6);
  });

  it('7. spreads across source shapes rather than spending a stratum on one', () => {
    const p = pilotSample(cohort);
    const shapes = new Set(p.rows.map((r) => r.sourceShape));
    expect(shapes.size).toBeGreaterThanOrEqual(3);
    const hosts = new Set(p.rows.map((r) => r.priorSourceHost));
    expect(hosts.size).toBeGreaterThanOrEqual(10);
  });
});

describe('allocation', () => {
  const sizes = () => new Map([['NCAA D1|M', 3], ['NCAA D1|W', 15], ['NCAA D2|M', 5],
    ['NCAA D2|W', 5], ['NCAA D3|M', 50], ['NCAA D3|W', 60]]);

  it('8. spends exactly the seats it is given', () => {
    for (const n of [6, 10, 20, 40]) {
      const s = allocate(sizes(), n);
      expect([...s.values()].reduce((a, b) => a + b, 0)).toBe(n);
    }
  });

  it('9. gives every non-empty stratum at least one seat', () => {
    const s = allocate(sizes(), 20);
    for (const v of s.values()) expect(v).toBeGreaterThanOrEqual(1);
    // Pure proportional allocation would give D1 men 0.43 of a seat and so
    // none; the floor is why the pilot can say anything about D1 men at all.
    expect(s.get('NCAA D1|M')).toBe(1);
  });

  it('10. never allocates a stratum more rows than it holds', () => {
    const small = new Map([['A', 1], ['B', 1], ['C', 40]]);
    const s = allocate(small, 20);
    expect(s.get('A')).toBe(1);
    expect(s.get('B')).toBe(1);
    expect(s.get('C')).toBe(18);
    expect([...s.values()].reduce((a, b) => a + b, 0)).toBe(20);
  });

  it('11. refuses a size that cannot give every stratum a seat', () => {
    expect(() => allocate(sizes(), 4)).toThrow(/cannot floor 6 strata into 4/);
  });

  it('12. breaks a remainder tie on the stratum name, not on iteration order', () => {
    const a = allocate(new Map([['X|M', 5], ['X|W', 5], ['Y|M', 50]]), 20);
    const b = allocate(new Map([['Y|M', 50], ['X|W', 5], ['X|M', 5]]), 20);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });
});

describe('ordering inside a stratum', () => {
  it('13. is not alphabetical, so a name cannot buy a place', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      key: `School ${String.fromCharCode(65 + i)}||mens-soccer`,
      sourceShape: 'SPORTS_SLUG_ROSTER', provider: 'SIDEARM',
    }));
    const ordered = orderWithinStratum(rows).map((r) => r.key);
    expect(ordered).toHaveLength(12);
    expect(new Set(ordered).size).toBe(12);
    expect(ordered).not.toEqual(rows.map((r) => r.key).sort());
  });

  it('14. visits every (shape x provider) group before exhausting the largest', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => ({ key: `big ${i}`, sourceShape: 'A', provider: 'SIDEARM' })),
      { key: 'rare one', sourceShape: 'B', provider: 'PRESTO' },
      { key: 'rare two', sourceShape: 'C', provider: null },
    ];
    const first3 = orderWithinStratum(rows).slice(0, 3).map((r) => r.key);
    expect(first3).toContain('rare one');
    expect(first3).toContain('rare two');
  });

  it('15. returns every row exactly once', () => {
    const p = pilotSample(cohort);
    expect(new Set(p.keys).size).toBe(p.keys.length);
    const all = orderWithinStratum(cohort.filter((r) => stratumOf(r) === 'NCAA D3|W'));
    expect(all).toHaveLength(60);
    expect(new Set(all.map((r) => r.key)).size).toBe(60);
  });
});

describe('reading a known-good source', () => {
  it('16. names the form the pipeline has to advance', () => {
    expect(sourceShape('https://x.test/sports/womens-soccer/roster/2025')).toBe('SPORTS_SLUG_ROSTER_YEAR');
    expect(sourceShape('https://x.test/sports/wsoc/roster')).toBe('SPORTS_SLUG_ROSTER');
    expect(sourceShape('https://x.test/sports/wsoc/2025-26/roster')).toBe('SPORTS_SLUG_ACADEMIC_YEAR_ROSTER');
    expect(sourceShape('https://x.test/roster.aspx?rp_id=9088')).toBe('ROSTER_ASPX_QUERY');
    expect(sourceShape('https://x.test/sport/w-soccer/roster/')).toBe('SPORT_SLUG_ROSTER');
    expect(sourceShape('https://x.test/soccer-roster-2026')).toBe('SLUG_ROSTER_YEAR_FLAT');
    expect(sourceShape('not a url')).toBe('UNPARSEABLE');
  });

  it('17. reads the shape through an archive capture, not as web.archive.org', () => {
    const wb = 'https://web.archive.org/web/20251028022431/https://athletics.mcla.edu/sports/msoc/2025-26/roster';
    expect(archived(wb)).toBe(true);
    expect(underlyingUrl(wb)).toBe('https://athletics.mcla.edu/sports/msoc/2025-26/roster');
    expect(sourceShape(wb)).toBe('SPORTS_SLUG_ACADEMIC_YEAR_ROSTER');
    expect(new URL(underlyingUrl(wb)).hostname).toBe('athletics.mcla.edu');
    expect(archived('https://athletics.mcla.edu/x')).toBe(false);
  });
});

describe('L7W — a cohort smaller than the pilot', () => {
  /*
   * THE LOOP THAT COULD NOT EXIT.
   *
   * `allocate` saturates each stratum at its own row count and hands the
   * overflow back to whichever stratum has room. When the requested size
   * exceeds the cohort total, nowhere has room: `seats.get(s) < sizes.get(s)`
   * is false for every stratum, `overflow` never decrements, and the loop spins
   * forever at 100% of a core.
   *
   * It was reachable from the day it was written and nothing reached it. L7Q
   * sampled 138, L7V left the cohort at exactly 20 — `size === total`, the last
   * value that still terminates — and L7W acquired six of those twenty and took
   * it to 14. `reacquisitionCohort.js` then hung, and so did its test, which is
   * how a coverage improvement disabled the tool that measures coverage.
   *
   * Asserted with a real timeout rather than by inspection: a non-terminating
   * loop is not a wrong answer, and a test that only checks the answer would
   * have passed against the broken version by never getting one.
   */
  const strata = new Map([['NCAA D1|M', 2], ['NCAA D1|W', 5], ['NCAA D2|M', 3],
    ['NCAA D2|W', 1], ['NCAA D3|M', 1], ['NCAA D3|W', 2]]);
  const total = [...strata.values()].reduce((n, v) => n + v, 0);   // 14

  it('18. allocate returns when the requested size exceeds the cohort', () => {
    const seats = allocate(strata, PILOT_SIZE);                    // 20 > 14
    const sum = [...seats.values()].reduce((n, v) => n + v, 0);
    expect(sum).toBe(total);
    for (const [s, n] of seats) expect(n).toBe(strata.get(s));      // every row seated
  }, 2000);

  it('19. and still allocates proportionally when it does not', () => {
    const seats = allocate(strata, 10);
    expect([...seats.values()].reduce((n, v) => n + v, 0)).toBe(10);
    for (const [s, n] of seats) expect(n).toBeLessThanOrEqual(strata.get(s));
  }, 2000);

  it('20. pilotSample clamps to the cohort and says the size it used', () => {
    const rows = [];
    for (const [s, n] of strata) {
      const [division, gender] = s.split('|');
      for (let i = 0; i < n; i += 1) {
        rows.push({ key: `${s}-${i}||womens-soccer`, division, gender,
          sourceShape: 'SPORTS_SLUG_ROSTER', provider: 'SIDEARM' });
      }
    }
    const p = pilotSample(rows, { size: PILOT_SIZE });
    expect(p.keys).toHaveLength(total);
    expect(p.size).toBe(total);                                     // not 20
    expect(new Set(p.keys).size).toBe(total);
  }, 2000);

  it('21. an empty cohort is a pilot of nothing, not a throw', () => {
    const p = pilotSample([], { size: PILOT_SIZE });
    expect(p.keys).toHaveLength(0);
    expect(p.size).toBe(0);
  }, 2000);
});
