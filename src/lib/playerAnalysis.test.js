import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The reserve where it is actually generated.
 *
 * shared/matching/reserve.test.js proves the split rule in isolation. This
 * proves the product applies it: that a real `analyze()` run over a real
 * ranking pass persists a hundred and fifty, in one unbroken rank order, in
 * two arrays — and that the first of them is still exactly what every reader
 * of this blob has always been handed.
 *
 * The database is mocked; the ranking is not. `rankMatches` runs for real, so
 * what comes back is ranked the way the product ranks.
 */

const colleges = [];
vi.mock('@/api/client', () => ({
  entities: {
    College: { filter: async () => colleges },
    RosterPlayer: { filter: async () => [] },
    GraduatingSenior: { filter: async () => [] },
  },
}));

const { analyze } = await import('./playerAnalysis.js');

/**
 * Programmes that differ only in quality, so the ranking is total and
 * predictable: `soccer_score` descending is the order they should come back in.
 */
function pool(n) {
  colleges.length = 0;
  for (let i = 0; i < n; i += 1) {
    colleges.push({
      id: `col-${i + 1}`,
      name: `School ${i + 1}`,
      sport: 'mens-soccer',
      division: 'NCAA D1',
      conference: 'ACC',
      state: 'NC',
      soccer_score: 100 - i * 0.01,
      academic_rating: 7,
      latitude: 35.9, longitude: -79.0,
      net_price: 20000,
    });
  }
}

const ATHLETE = {
  id: 'a-1',
  sport: 'mens-soccer',
  position: 'MIDFIELD',
  state: 'NC',
  recruiting_class_year: 2027,
};

const run = () => analyze(ATHLETE, { onPhase: () => {}, onProgress: () => {} });

beforeEach(() => { colleges.length = 0; });

describe('analyze', () => {
  it('persists exactly 100 recommendations from a deep pool', async () => {
    pool(600);
    const result = await run();
    expect(result.recommendations).toHaveLength(100);
  });

  it('persists the next 50 in reserve', async () => {
    pool(600);
    const result = await run();
    expect(result.reserve).toHaveLength(50);
  });

  it('keeps one unbroken rank order across the two arrays', async () => {
    pool(600);
    const { recommendations, reserve } = await run();

    // Rejoining them must reproduce the ranking with nothing missing, nothing
    // repeated and nothing out of order — reserve[0] is rank 101 and not "one
    // of the others".
    const rejoined = [...recommendations, ...reserve].map((r) => r.name);
    expect(new Set(rejoined).size).toBe(150);
    expect(rejoined[99]).toBe('School 100');
    expect(rejoined[100]).toBe('School 101');

    const scores = [...recommendations, ...reserve].map((r) => r.match_score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('shapes a reserve entry exactly like a recommendation', async () => {
    pool(600);
    const { recommendations, reserve } = await run();
    // A promoted reserve entry is rendered by the same card and frozen by the
    // same snapshot code as the rank it replaces. Different keys would fail at
    // whichever of those it reached first.
    expect(Object.keys(reserve[0]).sort()).toEqual(Object.keys(recommendations[0]).sort());
  });

  describe('an athlete with fewer than 150 eligible programmes', () => {
    it('reserves only what exists', async () => {
      pool(118);
      const { recommendations, reserve } = await run();
      expect(recommendations).toHaveLength(100);
      expect(reserve).toHaveLength(18);
      expect(reserve.at(-1).name).toBe('School 118');
    });

    it('reserves nothing at exactly 100', async () => {
      pool(100);
      const { recommendations, reserve } = await run();
      expect(recommendations).toHaveLength(100);
      expect(reserve).toEqual([]);
    });

    it('keeps a short list whole', async () => {
      pool(12);
      const { recommendations, reserve } = await run();
      expect(recommendations).toHaveLength(12);
      expect(reserve).toEqual([]);
    });
  });

  it('still summarises the hundred, not the hundred and fifty', async () => {
    pool(600);
    const { summary } = await run();
    expect(summary).toContain('top 100');
    expect(summary).not.toContain('top 150');
  });
});
