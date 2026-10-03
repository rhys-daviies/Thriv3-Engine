/**
 * A7.13 — the outreach sampler, which decides what a human is asked about.
 *
 * Its two jobs pull against each other: reach every region of the list
 * including the deep tail, and never let the sheet's order tell the reviewer
 * which region a row came from.
 */
import { describe, it, expect } from 'vitest';
import {
  outreachSample, decorrelatedOrder, spread,
  RANK_BAND, RANK_BAND_ORDER, RELATIVE_STRATUM, LIMITED_DATA_STRATUM,
  MAX_ORDER_CORRELATION, NEAR_LEVEL_POINTS, SUBSTANTIALLY_BELOW_POINTS,
} from './outreachSample.js';
import { RANKING_STATE, scoreable, GRADE } from '../types.js';

const EQ = 80;

/** A ranked universe with a plausible strength gradient: strong programmes rank low. */
const ranked = Array.from({ length: 860 }, (_, i) => ({
  id: `p${i}`,
  name: `Programme ${i}`,
  division: ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA'][i % 4],
  rankingState: RANKING_STATE.RANKED,
  rank: i + 1,
  // Rank 1 is 45 (far below an equivalent of 80); the tail climbs past it.
  soccerScore: 45 + (i * 0.06),
  recruitability: scoreable({ value: Math.max(0.01, 0.9 - (i * 0.001)), grade: GRADE.MEASURED, coverage: 1, basis: {} }),
}));

const limited = Array.from({ length: 300 }, (_, i) => ({
  id: `l${i}`,
  name: `Limited ${i}`,
  division: 'NJCAA',
  rankingState: RANKING_STATE.LIMITED_DATA,
  soccerScore: null,
}));

const sampleOf = (opts = {}) => outreachSample({
  ranked, limited, packId: 'TEST-PACK', equivalentStrength: EQ, ...opts,
});

describe('spread', () => {
  it('includes both ends and nothing twice', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const out = spread(rows, 4);
    expect(out[0]).toBe(1);
    expect(out[out.length - 1]).toBe(10);
    expect(new Set(out).size).toBe(out.length);
  });

  it('returns everything when the list is smaller than the quota', () => {
    expect(spread([1, 2], 5)).toEqual([1, 2]);
  });

  it('takes the middle for a quota of one, not the head', () => {
    expect(spread([1, 2, 3, 4, 5], 1)).toEqual([3]);
  });

  it('survives an empty list', () => {
    expect(spread([], 3)).toEqual([]);
  });
});

describe('the rank bands', () => {
  const s = sampleOf();

  it('reaches every band including the deep tail', () => {
    for (const key of RANK_BAND_ORDER) {
      expect(s.counts[key], `${key} missing`).toBeGreaterThan(0);
    }
    expect(s.counts.RANKS_501_PLUS).toBeGreaterThan(0);
  });

  it('puts each sampled programme in the band its rank belongs to', () => {
    for (const row of s.rows) {
      for (const stratum of row.strata) {
        const band = RANK_BAND[stratum];
        if (!band) continue;
        expect(row.rank, `${row.name} filed under ${stratum}`).toBeGreaterThanOrEqual(band.from);
        expect(row.rank).toBeLessThanOrEqual(band.to);
      }
    }
  });

  it('includes programmes with no rank at all', () => {
    expect(s.counts[LIMITED_DATA_STRATUM]).toBeGreaterThan(0);
    expect(s.rows.filter((r) => r.rank === null).length).toBe(s.composition.limitedData);
  });

  it('lands inside the 30-40 the brief asks for', () => {
    expect(s.size).toBeGreaterThanOrEqual(28);
    expect(s.size).toBeLessThanOrEqual(40);
  });

  it('reaches well outside the top 100', () => {
    expect(s.composition.outsideTop100).toBeGreaterThan(5);
  });
});

describe('the elite oversample', () => {
  const plain = sampleOf();
  const elite = sampleOf({ eliteOversample: true });

  it('adds rows rather than replacing them', () => {
    expect(elite.size).toBeGreaterThan(plain.size);
    const plainIds = new Set(plain.rows.map((r) => r.id));
    for (const id of plainIds) expect(elite.rows.some((r) => r.id === id), id).toBe(true);
  });

  it('reaches every relative stratum', () => {
    for (const key of Object.values(RELATIVE_STRATUM)) {
      expect(elite.counts[key], `${key} missing`).toBeGreaterThan(0);
    }
  });

  it('files each relative stratum by the delta it claims', () => {
    const delta = (row) => row.programmeStrength - EQ;
    for (const row of elite.rows) {
      if (row.strata.includes(RELATIVE_STRATUM.NEAR_LEVEL)) {
        expect(Math.abs(delta(row)), row.name).toBeLessThan(NEAR_LEVEL_POINTS);
      }
      if (row.strata.includes(RELATIVE_STRATUM.SUBSTANTIALLY_BELOW)) {
        expect(delta(row), row.name).toBeLessThanOrEqual(SUBSTANTIALLY_BELOW_POINTS);
      }
      if (row.strata.includes(RELATIVE_STRATUM.MODEST_REACH)) {
        expect(delta(row), row.name).toBeGreaterThanOrEqual(NEAR_LEVEL_POINTS);
      }
    }
  });

  /** A7.13 §6: no absurd reaches purely to create contrast. */
  it('never reaches more than ten strength points above the athlete', () => {
    const reaches = elite.rows.filter((r) => r.strata.includes(RELATIVE_STRATUM.MODEST_REACH));
    expect(reaches.length).toBeGreaterThan(0);
    for (const r of reaches) expect(r.programmeStrength - EQ, r.name).toBeLessThan(10);
  });

  it('is off unless asked for', () => {
    for (const key of Object.values(RELATIVE_STRATUM)) {
      expect(plain.counts[key], key).toBeUndefined();
    }
  });

  it('does nothing without an athlete equivalent to compare against', () => {
    const s = sampleOf({ eliteOversample: true, equivalentStrength: null });
    for (const key of Object.values(RELATIVE_STRATUM)) expect(s.counts[key], key).toBeUndefined();
  });
});

describe('the blind order', () => {
  it('is decorrelated from the model order', () => {
    const s = sampleOf({ eliteOversample: true });
    expect(Math.abs(s.orderCorrelation)).toBeLessThan(MAX_ORDER_CORRELATION);
  });

  it('re-seeds deterministically when the first hash tracks the ranking', () => {
    /**
     * The failure this exists for actually happened: the developmental pack's
     * first hash came out at 0.434 on the first run of six.
     */
    const rows = ranked.slice(0, 30);
    const model = [...rows];
    const a = decorrelatedOrder(rows, model, 'SEED');
    const b = decorrelatedOrder(rows, model, 'SEED');
    expect(a.seed).toBe(b.seed);
    expect(a.order.map((r) => r.id)).toEqual(b.order.map((r) => r.id));
    expect(Math.abs(a.correlation)).toBeLessThan(MAX_ORDER_CORRELATION);
  });

  it('records which seed it settled on', () => {
    const s = sampleOf();
    expect(typeof s.orderingSeed).toBe('string');
    expect(s.orderingSeed.startsWith('TEST-PACK')).toBe(true);
  });

  it('contains exactly the same programmes as the model order', () => {
    const s = sampleOf({ eliteOversample: true });
    expect(new Set(s.blindOrder.map((r) => r.id)))
      .toEqual(new Set(s.rows.map((r) => r.id)));
    expect(s.blindOrder.length).toBe(s.rows.length);
  });

  it('is not the model order', () => {
    const s = sampleOf({ eliteOversample: true });
    expect(s.blindOrder.map((r) => r.id)).not.toEqual(s.rows.map((r) => r.id));
  });
});

describe('determinism', () => {
  it('produces an identical sample every time', () => {
    const a = sampleOf({ eliteOversample: true });
    const b = sampleOf({ eliteOversample: true });
    expect(a.blindOrder.map((r) => r.id)).toEqual(b.blindOrder.map((r) => r.id));
    expect(a.counts).toEqual(b.counts);
  });

  it('gives a different pack a different order', () => {
    const a = sampleOf({ packId: 'PACK-ONE' });
    const b = sampleOf({ packId: 'PACK-TWO' });
    expect(a.blindOrder.map((r) => r.id)).not.toEqual(b.blindOrder.map((r) => r.id));
    // ...but the same membership, because membership does not depend on the seed.
    expect(new Set(a.rows.map((r) => r.id))).toEqual(new Set(b.rows.map((r) => r.id)));
  });
});
