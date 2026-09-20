import { describe, it, expect } from 'vitest';
import { stratifiedSample, STRATUM, blindKey } from './sample.js';
import { RANKING_STATE, GRADE, scoreable } from '../types.js';

/**
 * A synthetic pool, because the sampler needs no scorer: it reads ranks,
 * programme strength and two gate losses, and nothing else.
 */
const priority = (value, { rLoss = 0, fLoss = 0 } = {}) => scoreable({
  value, grade: GRADE.MEASURED, coverage: 1,
  basis: { recruitabilityGateLoss: rLoss, financialGateLoss: fLoss },
});

const pool = (n = 300) => Array.from({ length: n }, (_, i) => ({
  id: `p${i + 1}`, name: `Programme ${String(i + 1).padStart(3, '0')}`,
  division: ['NCAA D1', 'NCAA D2', 'NCAA D3'][i % 3],
  soccerScore: 100 - (i * 0.3),
  rankingState: RANKING_STATE.RANKED,
  rank: i + 1,
  pursuitPriority: priority(1 - (i / n), {
    rLoss: i % 7 === 0 ? 0.2 - (i / 10000) : 0,
    fLoss: i % 11 === 0 ? 0.3 - (i / 10000) : 0,
  }),
}));

const limitedPool = (n = 20) => Array.from({ length: n }, (_, i) => ({
  id: `l${i + 1}`, name: `Limited ${i + 1}`, division: 'NJCAA',
  rankingState: RANKING_STATE.LIMITED_DATA, pursuitPriority: null,
  missingLayers: ['recruitability'],
  order: { layersKnown: 2, coverage: 0.6, bestEvidencedValue: 0.5 },
}));

/** V1 put some of the low-ranked programmes near the top, and some limited ones too. */
const v1 = (ranked, limited) => {
  const m = new Map();
  ranked.forEach((r, i) => m.set(r.id, ((i * 37) % ranked.length) + 1));
  limited.slice(0, 4).forEach((r, i) => m.set(r.id, i + 5));
  return m;
};

const run = (opts = {}) => {
  const ranked = pool(opts.n ?? 300);
  const limited = limitedPool();
  return stratifiedSample({
    ranked, limited, v1Ranks: v1(ranked, limited), topN: 100, packId: opts.packId ?? 'TEST',
  });
};

describe('the stratified sample', () => {
  const s = run();

  it('lands in the size the task asked for', () => {
    expect(s.size).toBeGreaterThanOrEqual(35);
    expect(s.size).toBeLessThanOrEqual(50);
  });

  it('covers every stratum', () => {
    for (const key of Object.values(STRATUM)) expect(s.counts[key]).toBeGreaterThan(0);
  });

  it('takes the whole top ten, not a sample of it', () => {
    const top = s.rows.filter((r) => r.strata.includes(STRATUM.TOP_10)).map((r) => r.rank).sort((a, b) => a - b);
    expect(top).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('reaches outside the hundred, which is the only way an omission is visible', () => {
    const outside = s.rows.filter((r) => r.strata.includes(STRATUM.JUST_OUTSIDE_TOP));
    expect(outside).toHaveLength(5);
    for (const r of outside) expect(r.rank).toBeGreaterThan(100);
  });

  it('spreads the mid-list windows rather than taking three in a row', () => {
    const mid = s.rows.filter((r) => r.strata.includes(STRATUM.RANKS_45_55)).map((r) => r.rank).sort((a, b) => a - b);
    expect(mid).toEqual([45, 50, 55]);
  });

  it('finds falls outside the top hundred, where the worst of them are', () => {
    const falls = s.rows.filter((r) => r.strata.includes(STRATUM.MAJOR_FALL));
    expect(falls.length).toBeGreaterThan(0);
    expect(falls.some((r) => r.rank > 100)).toBe(true);
  });

  it('prefers limited-data programmes V1 ranked highly', () => {
    const lim = s.rows.filter((r) => r.strata.includes(STRATUM.LIMITED_DATA));
    expect(lim).toHaveLength(5);
    expect(lim.filter((r) => r.v1Rank !== null).length).toBeGreaterThanOrEqual(3);
    for (const r of lim) expect(r.rank).toBeNull();
  });

  it('marks a programme with every stratum it belongs to, not just the first', () => {
    expect(s.rows.some((r) => r.strata.length > 1)).toBe(true);
  });
});

describe('the sample is reproducible', () => {
  it('produces the same rows and the same order twice', () => {
    const a = run(); const b = run();
    expect(a.rows.map((r) => r.id)).toEqual(b.rows.map((r) => r.id));
    expect(a.blindOrder.map((r) => r.id)).toEqual(b.blindOrder.map((r) => r.id));
  });

  it('orders the blind view differently from rank order', () => {
    // The whole point. If page order tracked rank, the blind view would be
    // handing the operator the model's answer in the numbering.
    const s = run();
    expect(s.blindOrder.map((r) => r.id)).not.toEqual(s.rows.map((r) => r.id));
  });

  it('has a low rank correlation between page position and model rank', () => {
    const s = run();
    const ranked = s.blindOrder.filter((r) => r.rank !== null);
    const n = ranked.length;
    let d2 = 0;
    ranked.forEach((r, i) => {
      const modelPos = s.rows.filter((x) => x.rank !== null).findIndex((x) => x.id === r.id);
      d2 += (i - modelPos) ** 2;
    });
    const rho = 1 - ((6 * d2) / (n * ((n * n) - 1)));
    expect(Math.abs(rho)).toBeLessThan(0.4);
  });

  it('gives different pack ids different orders, so two packs cannot be aligned by eye', () => {
    expect(run({ packId: 'A' }).blindOrder.map((r) => r.id))
      .not.toEqual(run({ packId: 'B' }).blindOrder.map((r) => r.id));
  });

  it('hashes to a stable unsigned key', () => {
    expect(blindKey('A', 'p1')).toBe(blindKey('A', 'p1'));
    expect(blindKey('A', 'p1')).not.toBe(blindKey('A', 'p2'));
    expect(blindKey('A', 'p1')).toBeGreaterThanOrEqual(0);
  });
});

describe('a small pool', () => {
  it('does not fall over when there is nothing outside the hundred', () => {
    const ranked = pool(60);
    const limited = limitedPool(2);
    const s = stratifiedSample({ ranked, limited, v1Ranks: v1(ranked, limited), topN: 100, packId: 'S' });
    expect(s.counts[STRATUM.JUST_OUTSIDE_TOP]).toBeUndefined();
    expect(s.size).toBeGreaterThan(10);
  });
});
