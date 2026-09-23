import { describe, it, expect } from 'vitest';
import { developmentCopyFor } from './developmentEvidenceCopy';
import { provenanceRows } from './evidenceProvenance';

/**
 * L7ZC — the two places a corrected poolSize is printed.
 *
 * `comparison.poolSize` is read by exactly two copy sites, and both print the
 * number verbatim. L7ZC changed the number and not the wording, so what these
 * pin is that the corrected value FLOWS THROUGH the existing template: same
 * sentence, same label, same order, one different integer. A change to the
 * phrasing would fail them, which is the point — the brief forbids rewriting
 * copy to accommodate the fix.
 */
const item = (poolSize) => ({
  kind: 'PROGRAMME_POOL_BENCHMARK',
  facts: {
    rank: 1, programmeMedian: 1007,
    pool: { n: poolSize, p25: 901, median: 1118, p75: 1289 },
    band: 'p25-to-median',
  },
  qualification: {
    tier: 'FACT', temporality: 'HISTORICAL', confidence: 'HIGH',
    season: '2022, 2023, 2024, 2025', source: 'roster_players:pool-benchmarks',
    window: { seasons: ['2022', '2023', '2024', '2025'], seasonsUnread: [], n: 41, cohort: null },
    comparison: {
      basis: 'mens-soccer programmes with a readable freshman ladder, 2022-2023-2024-2025',
      statistic: 'ladder-rank-1-median-minutes',
      poolSize, percentile: null, band: 'p25-to-median',
    },
  },
});

describe('L7ZC — the development panel sentence', () => {
  it('prints the corrected population through the sentence it already had', () => {
    const was = developmentCopyFor(item(920));
    const now = developmentCopyFor(item(770));
    expect(was.detail).toContain('920 programmes in the pool.');
    expect(now.detail).toContain('770 programmes in the pool.');
    // Every other clause identical, in the same order.
    expect(now.detail.replace('770 programmes', '920 programmes')).toBe(was.detail);
    expect(now.headline).toBe(was.headline);
    expect(now.band).toBe(was.band);
  });
});

describe('L7ZC — the provenance drawer row', () => {
  it('prints the corrected population under the label it already had', () => {
    const rowsOf = (n) => provenanceRows(item(n)).map((r) => [r.label, r.value ?? r.href ?? null]);
    const was = rowsOf(920);
    const now = rowsOf(770);
    expect(was).toEqual(expect.arrayContaining([['Pool size', '920 programmes']]));
    expect(now).toEqual(expect.arrayContaining([['Pool size', '770 programmes']]));
    // Same rows, same labels, same order — one value differs.
    expect(now.map(([l]) => l)).toEqual(was.map(([l]) => l));
    const diff = now.filter((r, i) => was[i][1] !== r[1]).map(([l]) => l);
    expect(diff).toEqual(['Pool size']);
  });
});
