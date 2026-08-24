import { describe, it, expect } from 'vitest';
import { normaliseState, haversineMiles, distanceFromState, STATE_CENTROIDS } from './geo.js';

describe('normaliseState', () => {
  it('accepts codes and full names, in any case', () => {
    expect(normaliseState('ca')).toBe('CA');
    expect(normaliseState('California')).toBe('CA');
    expect(normaliseState('  new york ')).toBe('NY');
  });
  it('returns null for anything it does not recognise', () => {
    expect(normaliseState('Ontario')).toBeNull();
    expect(normaliseState('')).toBeNull();
    expect(normaliseState(null)).toBeNull();
  });
});

describe('haversineMiles', () => {
  it('measures a known distance', () => {
    // Stanford to Indiana University, roughly 2,000 miles.
    const d = haversineMiles(37.43, -122.17, 39.17, -86.53);
    expect(d).toBeGreaterThan(1800);
    expect(d).toBeLessThan(2100);
  });
  it('is zero for a point against itself', () => {
    expect(haversineMiles(40, -80, 40, -80)).toBeCloseTo(0, 6);
  });
  it('returns null rather than NaN for missing coordinates', () => {
    expect(haversineMiles(40, -80, null, -80)).toBeNull();
    expect(haversineMiles(40, -80, 'x', -80)).toBeNull();
  });
});

describe('distanceFromState', () => {
  it('is small within the athlete home state', () => {
    expect(distanceFromState('IN', 39.17, -86.53)).toBeLessThan(120);
  });
  it('is large across the country', () => {
    expect(distanceFromState('CA', 42.28, -71.55)).toBeGreaterThan(2400);
  });
  it('returns null for an unknown state', () => {
    expect(distanceFromState('Ontario', 40, -80)).toBeNull();
  });
});

describe('STATE_CENTROIDS', () => {
  it('covers all fifty states plus DC', () => {
    expect(Object.keys(STATE_CENTROIDS).length).toBeGreaterThanOrEqual(51);
  });
  it('has plausible coordinates everywhere', () => {
    for (const [code, [lat, lon]] of Object.entries(STATE_CENTROIDS)) {
      expect(Math.abs(lat), code).toBeLessThanOrEqual(90);
      expect(Math.abs(lon), code).toBeLessThanOrEqual(180);
    }
  });
});
