import { describe, it, expect } from 'vitest';
import {
  POSITIONS, NORMS, NORMS_ID, NORMS_DIGEST,
  typicalStarters, typicalStartersEvidence, fillPropensity,
  PLAUSIBILITY_SLOPE, PLAUSIBILITY_MIDPOINT, CORE_FLOOR,
  ARRIVAL_CLAIM_WEIGHT, MAX_CLAIM_SHARE, CORE_WEIGHTS, RECRUITABILITY_COVERAGE_FLOOR,
} from './recruitingRules.js';

const SPORTS = ['mens-soccer', 'womens-soccer'];

describe('typicalStarters is measured for every position, goalkeepers included', () => {
  it.each(SPORTS)('%s: holds all four', (sport) => {
    for (const p of POSITIONS) {
      expect(typicalStarters(sport, p), p).toBeGreaterThan(0);
      expect(typicalStartersEvidence(sport, p).programmeSeasons).toBeGreaterThan(2000);
    }
  });

  it.each(SPORTS)('%s: goalkeeper is the best-determined of the four', (sport) => {
    const gk = typicalStartersEvidence(sport, 'GOALKEEPER');
    expect(gk.typicalStarters).toBe(1);
    expect(gk.p75 - gk.p25).toBe(0);
    for (const p of ['DEFENSE', 'MIDFIELD', 'FORWARD']) {
      const other = typicalStartersEvidence(sport, p);
      expect(other.p75 - other.p25, p).toBeGreaterThan(0);
      expect(gk.shareAtMedian).toBeGreaterThan(other.shareAtMedian);
    }
  });

  it('orders the positions the way squads are actually built', () => {
    for (const sport of SPORTS) {
      expect(typicalStarters(sport, 'GOALKEEPER')).toBeLessThan(typicalStarters(sport, 'FORWARD'));
      expect(typicalStarters(sport, 'FORWARD')).toBeLessThan(typicalStarters(sport, 'DEFENSE'));
    }
  });

  it('returns null rather than a guess for a position it never measured', () => {
    expect(typicalStarters('mens-soccer', 'SWEEPER')).toBeNull();
    expect(typicalStarters('mens-basketball', 'GOALKEEPER')).toBeNull();
  });

  it('is case-insensitive about the position it is asked for', () => {
    expect(typicalStarters('mens-soccer', 'goalkeeper')).toBe(1);
  });
});

describe('the fill-propensity hierarchy', () => {
  it('resolves division before sport, and says which it used', () => {
    const d = fillPropensity({ sport: 'mens-soccer', division: 'NCAA D2', position: 'GOALKEEPER', programme: 'X' });
    expect(d.level).toBe('division');
    expect(d.trials).toBeGreaterThanOrEqual(NORMS.minDivisionObservations);
  });

  it('falls back to sport where a division has too little on file', () => {
    const s = fillPropensity({ sport: 'mens-soccer', division: 'USCAA', position: 'MIDFIELD', programme: 'X' });
    expect(s.level).toBe('sport');
  });

  it('never resolves to a programme, because no programme has the evidence', () => {
    // Three season transitions exist. A 1-of-1 history is not 20-of-30, and
    // the floor is what stops it being read as though it were.
    expect(Object.keys(NORMS.fillPropensity.programme)).toHaveLength(0);
    expect(NORMS.fillPropensity.programmeEvidence.maxObservations).toBeLessThan(NORMS.minProgrammeObservations);
  });

  it('records how much evidence sits behind every rate it does publish', () => {
    for (const level of ['sport', 'division']) {
      for (const [key, v] of Object.entries(NORMS.fillPropensity[level])) {
        expect(v.trials, key).toBeGreaterThan(0);
        expect(v.hits, key).toBeLessThanOrEqual(v.trials);
        expect(v.rate, key).toBeCloseTo(v.hits / v.trials, 3);
      }
    }
  });

  it('prices a vacated goalkeeping place well below an outfield one', () => {
    for (const sport of SPORTS) {
      const gk = fillPropensity({ sport, division: 'NCAA D1', position: 'GOALKEEPER', programme: 'X' });
      for (const p of ['DEFENSE', 'MIDFIELD', 'FORWARD']) {
        expect(gk.rate).toBeLessThan(fillPropensity({ sport, division: 'NCAA D1', position: p, programme: 'X' }).rate);
      }
    }
  });

  it('returns nothing for a sport it never measured', () => {
    expect(fillPropensity({ sport: 'mens-basketball', division: 'NCAA D1', position: 'MIDFIELD', programme: 'X' })).toBeNull();
  });
});

describe('the pinned norms carry their own provenance', () => {
  it('names itself, its seasons and its threshold', () => {
    expect(NORMS_ID).toMatch(/^positional-norms-\d{4}-\d{2}-\d{2}$/);
    expect(NORMS_DIGEST).toMatch(/^[0-9a-f]{16}$/);
    expect(NORMS.seasons).toEqual(['2022', '2023', '2024', '2025']);
    expect(NORMS.starterMinutes).toBe(600);
  });

  it('excludes the season in progress, which carries no minutes', () => {
    expect(NORMS.seasons).not.toContain('2026');
  });
});

describe('the declared heuristics', () => {
  it('states the slope and midpoint of the plausibility curve', () => {
    expect(PLAUSIBILITY_SLOPE).toBe(0.12);
    expect(PLAUSIBILITY_MIDPOINT).toBe(0);
  });

  it('keeps the core floor inside the unit interval and away from both ends', () => {
    expect(CORE_FLOOR).toBeGreaterThan(0);
    expect(CORE_FLOOR).toBeLessThan(1);
  });

  it('bounds the claim an arrival can make on an opening', () => {
    expect(ARRIVAL_CLAIM_WEIGHT).toBeGreaterThan(0);
    expect(ARRIVAL_CLAIM_WEIGHT).toBeLessThanOrEqual(1);
    expect(MAX_CLAIM_SHARE).toBeLessThan(1);
  });

  it('weights the core so positional opportunity leads', () => {
    expect(CORE_WEIGHTS.positionalOpportunity).toBeGreaterThan(CORE_WEIGHTS.internationalPropensity);
    expect(CORE_WEIGHTS.positionalOpportunity + CORE_WEIGHTS.internationalPropensity).toBeCloseTo(1, 10);
  });

  it('sets a coverage floor that rejects the international signal on its own', () => {
    expect(RECRUITABILITY_COVERAGE_FLOOR).toBeGreaterThan(CORE_WEIGHTS.internationalPropensity);
    expect(RECRUITABILITY_COVERAGE_FLOOR).toBeLessThanOrEqual(CORE_WEIGHTS.positionalOpportunity);
  });
});
