import { describe, it, expect } from 'vitest';
import {
  TOP_RANKS, RESERVE_RANKS,
  splitRanked, readReserve, reserveRank,
  suppressionHeadroom, assertSuppressionCapacity,
} from './reserve.js';

/**
 * The reserve exists to make one future operation safe: removing a programme
 * from an athlete's actionable hundred without silently publishing a
 * ninety-nine. These tests are about the two properties that operation will
 * depend on — that the tail is there, and that it is still the SAME RANKED
 * LIST as the head.
 */

/** Ranked results as `rankMatches` returns them: array order is the ranking. */
const ranked = (n) => Array.from({ length: n }, (_, i) => ({ name: `School ${i + 1}`, order: i + 1 }));

describe('splitRanked', () => {
  it('persists at most 100 recommendations', () => {
    const { top } = splitRanked(ranked(1200));
    expect(top).toHaveLength(100);
    expect(TOP_RANKS).toBe(100);
    expect(top[0].order).toBe(1);
    expect(top[99].order).toBe(100);
  });

  it('persists at most 50 in reserve', () => {
    const { reserve } = splitRanked(ranked(1200));
    expect(reserve).toHaveLength(50);
    expect(RESERVE_RANKS).toBe(50);
  });

  it('keeps one global rank order across both arrays', () => {
    const { top, reserve } = splitRanked(ranked(1200));
    // The join of the two IS the ranked list, unbroken. This is the property
    // that lets a promoted reserve entry be "the next one" rather than "one
    // of the others" — reserve[0] is rank 101 and nothing else.
    const rejoined = [...top, ...reserve].map((r) => r.order);
    expect(rejoined).toEqual(Array.from({ length: 150 }, (_, i) => i + 1));
    expect(reserve[0].order).toBe(101);
    expect(reserveRank(0)).toBe(101);
    expect(reserveRank(49)).toBe(150);
  });

  it('never reaches past 150, however deep the pool', () => {
    const { top, reserve } = splitRanked(ranked(2000));
    expect(top.length + reserve.length).toBe(150);
  });

  describe('an athlete with fewer than 150 eligible programmes', () => {
    it('fills the reserve only as far as the pool goes', () => {
      const { top, reserve } = splitRanked(ranked(118));
      expect(top).toHaveLength(100);
      expect(reserve).toHaveLength(18);
      expect(reserve[17].order).toBe(118);
    });

    it('has no reserve at all when the pool is exactly 100', () => {
      const { top, reserve } = splitRanked(ranked(100));
      expect(top).toHaveLength(100);
      expect(reserve).toEqual([]);
    });

    it('keeps a short list whole and reserves nothing', () => {
      const { top, reserve } = splitRanked(ranked(40));
      expect(top).toHaveLength(40);
      expect(reserve).toEqual([]);
    });

    it('survives an empty or absent pool rather than throwing', () => {
      expect(splitRanked([])).toEqual({ top: [], reserve: [] });
      expect(splitRanked(undefined)).toEqual({ top: [], reserve: [] });
    });
  });
});

describe('reading an analysis written before the reserve existed', () => {
  /**
   * Ninety-eight analyses sit in the upload store with no `reserve` key, and
   * a profile edit nulls the pointer rather than rewriting the file, so they
   * will never gain one. They must stay readable.
   */
  it('reads a missing reserve as empty, not as an error', () => {
    expect(readReserve({ recommendations: [1, 2, 3], summary: 'x' })).toEqual([]);
  });

  it('reads a legacy bare-array analysis as empty', () => {
    expect(readReserve([1, 2, 3])).toEqual([]);
  });

  it('reads junk in the reserve slot as empty rather than passing it on', () => {
    expect(readReserve({ reserve: null })).toEqual([]);
    expect(readReserve({ reserve: 'fifty' })).toEqual([]);
    expect(readReserve(null)).toEqual([]);
    expect(readReserve(undefined)).toEqual([]);
  });

  it('returns the reserve when there is one', () => {
    const analysis = { recommendations: ranked(100), reserve: ranked(3) };
    expect(readReserve(analysis)).toHaveLength(3);
  });
});

describe('suppression capacity', () => {
  const full = { recommendations: ranked(100), reserve: ranked(50) };

  it('reports the headroom a suppression feature may spend', () => {
    expect(suppressionHeadroom(full)).toBe(50);
    expect(suppressionHeadroom({ recommendations: ranked(100), reserve: ranked(7) })).toBe(7);
  });

  it('gives an analysis with no reserve no headroom at all', () => {
    // The important case. An old analysis must not be treated as though it
    // had fifty replacements in hand; the alternative is a Top 99 nobody was
    // told about, which is the exact failure the reserve exists to prevent.
    expect(suppressionHeadroom({ recommendations: ranked(100) })).toBe(0);
  });

  it('allows a suppression the reserve can replace, and reports what is left', () => {
    expect(assertSuppressionCapacity(full, 1)).toBe(49);
    expect(assertSuppressionCapacity(full, 50)).toBe(0);
  });

  it('refuses the suppression that would shorten the list, naming the code', () => {
    expect(() => assertSuppressionCapacity(full, 51)).toThrowError(/RESERVE_EXHAUSTED|reserve|replacement/i);
    try {
      assertSuppressionCapacity(full, 51);
      throw new Error('should have refused');
    } catch (err) {
      expect(err.code).toBe('RESERVE_EXHAUSTED');
      // It says what the list WOULD have become, because "99" is the fact the
      // operator needs and "capacity exceeded" is not.
      expect(err.message).toContain('99');
    }
  });

  it('refuses any suppression against an analysis with no reserve', () => {
    expect(() => assertSuppressionCapacity({ recommendations: ranked(100) }, 1))
      .toThrowError(/holds 0/);
  });
});
