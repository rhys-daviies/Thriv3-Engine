import { describe, it, expect } from 'vitest';
import { normalizeDivision, DIVISIONS } from './divisions.js';

describe('normalizeDivision', () => {
  it('accepts every spelling the data actually holds', () => {
    expect(normalizeDivision('NCAA D1')).toBe('NCAA D1');
    expect(normalizeDivision('NCAA Division I')).toBe('NCAA D1');
    expect(normalizeDivision('ncaa d1')).toBe('NCAA D1');
    expect(normalizeDivision('Division III')).toBe('NCAA D3');
    expect(normalizeDivision('NAIA')).toBe('NAIA');
    expect(normalizeDivision('NJCAA')).toBe('NJCAA');
  });

  // The ordering rule: a looser test running first would swallow these.
  it('never reads Division II or III as Division I', () => {
    expect(normalizeDivision('NCAA Division II')).toBe('NCAA D2');
    expect(normalizeDivision('NCAA Division III')).toBe('NCAA D3');
    expect(normalizeDivision('D2')).toBe('NCAA D2');
    expect(normalizeDivision('D3')).toBe('NCAA D3');
  });

  it('returns Other rather than guessing', () => {
    expect(normalizeDivision('NCCAA')).toBe('Other');
    expect(normalizeDivision('')).toBe('Other');
    expect(normalizeDivision(null)).toBe('Other');
  });

  it('canonical output is always one of DIVISIONS, or Other', () => {
    for (const input of ['NCAA D1', 'Division II', 'naia', 'njcaa', 'nonsense']) {
      const out = normalizeDivision(input);
      expect(DIVISIONS.includes(out) || out === 'Other').toBe(true);
    }
  });
});
