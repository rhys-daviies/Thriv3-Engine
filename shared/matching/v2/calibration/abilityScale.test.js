import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  CALIBRATION, CALIBRATION_ID, CALIBRATED_SPORTS,
  abilityToPercentile, abilityToProgrammeScore, percentileOf,
  abilityLevel, abilityDelta, checkDistribution, dominantDivisions,
} from './abilityScale.js';
import table from './abilityScale.data.json' with { type: 'json' };

const SPORTS = ['mens-soccer', 'womens-soccer'];
const RATINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('invariant 1: the mapping is strictly monotonic', () => {
  it.each(SPORTS)('%s: rating -> percentile increases at every step', (sport) => {
    const ps = RATINGS.map((r) => abilityToPercentile(r, sport));
    for (let i = 1; i < ps.length; i += 1) expect(ps[i]).toBeGreaterThan(ps[i - 1]);
  });

  it.each(SPORTS)('%s: rating -> programme score increases at every step', (sport) => {
    const ss = RATINGS.map((r) => abilityToProgrammeScore(r, sport));
    for (let i = 1; i < ss.length; i += 1) expect(ss[i]).toBeGreaterThan(ss[i - 1]);
  });

  it.each(SPORTS)('%s: soccer_score -> percentile is non-decreasing and strictly increases over distinct scores', (sport) => {
    const distinct = [...new Set(table.sports[sport].distribution)].sort((a, b) => a - b);
    let prev = -1;
    for (const s of distinct) {
      const p = percentileOf(s, sport);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });

  it.each(SPORTS)('%s: decimal ratings interpolate monotonically', (sport) => {
    let prev = -1;
    for (let r = 1; r <= 10.0001; r += 0.1) {
      const p = abilityToPercentile(Math.min(10, Number(r.toFixed(2))), sport);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });
});

describe('invariant 2: the source distribution is pinned, not re-derived', () => {
  const digestOf = (sorted) => crypto.createHash('sha256')
    .update(sorted.map((s) => s.toFixed(2)).join(',')).digest('hex').slice(0, 16);

  it.each(SPORTS)('%s: the pinned digest matches the pinned distribution', (sport) => {
    const s = table.sports[sport];
    expect(digestOf(s.distribution)).toBe(s.sourceDistributionDigest);
  });

  it('reports a match when the live distribution is the pinned one', () => {
    const report = checkDistribution('mens-soccer', table.sports['mens-soccer'].distribution, { digestOf });
    expect(report.matches).toBe(true);
    expect(report.liveProgrammes).toBe(report.pinnedProgrammes);
  });

  it('reports a mismatch when one programme moves, and changes nothing', () => {
    const moved = [...table.sports['mens-soccer'].distribution];
    moved[500] = Number((moved[500] + 1).toFixed(2));
    const report = checkDistribution('mens-soccer', moved, { digestOf });
    expect(report.matches).toBe(false);
    // The scale itself is untouched: a drifted distribution never silently
    // redefines what a rating means.
    expect(abilityToProgrammeScore(8, 'mens-soccer')).toBe(table.sports['mens-soccer'].ratings[7].soccerScore);
  });

  it('carries an identity and a generation date, so a report can name the scale it used', () => {
    expect(CALIBRATION_ID).toMatch(/^ability-scale-\d{4}-\d{2}-\d{2}$/);
    expect(CALIBRATION.quantileMethod).toBe('nearest-rank');
    expect(CALIBRATION.createdAt).toBeTruthy();
  });
});

describe('invariant 3: a moved dominant division is a review trigger', () => {
  it.each(SPORTS)('%s: every rating has a recorded dominant division', (sport) => {
    for (const d of dominantDivisions(sport)) {
      expect(d.division).toBeTruthy();
      expect(d.share).toBeGreaterThan(0);
    }
  });

  it("men's: the recorded mix is the one the design was argued from", () => {
    const d = Object.fromEntries(dominantDivisions('mens-soccer').map((x) => [x.rating, x.division]));
    expect(d[1]).toBe('NJCAA');
    expect(d[3]).toBe('NCAA D3');
    expect(d[7]).toBe('NCAA D2');
    expect(d[8]).toBe('NCAA D1');
    expect(d[9]).toBe('NCAA D1');
    expect(d[10]).toBe('NCAA D1');
  });

  it("women's: Division I is reached earlier, and that is recorded not smoothed", () => {
    const mix = CALIBRATION.sports['womens-soccer'].ratings;
    expect(mix[5].divisionMix['NCAA D1']).toBeGreaterThan(0.2); // rating 6 already touches D1
    expect(mix[6].divisionMix['NCAA D1']).toBeGreaterThan(0.7); // rating 7 is mostly D1
  });
});

describe('invariant 4: 8, 9 and 10 separate the Division I tail', () => {
  it.each(SPORTS)('%s: the three map to scores at least 5 points apart', (sport) => {
    const [s8, s9, s10] = [8, 9, 10].map((r) => abilityToProgrammeScore(r, sport));
    expect(s9 - s8).toBeGreaterThanOrEqual(5);
    expect(s10 - s9).toBeGreaterThanOrEqual(5);
  });

  it.each(SPORTS)('%s: the three sit at distinct percentiles, unlike the linear map', (sport) => {
    const ps = [8, 9, 10].map((r) => abilityToPercentile(r, sport));
    expect(new Set(ps).size).toBe(3);
    // Under `ability * 10` all three sat above the 94th percentile of programmes.
    expect(percentileOf(80, sport)).toBeGreaterThan(0.9);
    expect(percentileOf(90, sport)).toBeGreaterThan(0.9);
    // Under the calibrated scale rating 8 is well clear of the top of the pool.
    expect(abilityToPercentile(8, sport)).toBe(0.89);
  });
});

describe('boundaries and bad input', () => {
  it.each(SPORTS)('%s: rating 1 sits near the bottom and 10 near the top', (sport) => {
    expect(abilityToPercentile(1, sport)).toBe(0.02);
    expect(abilityToPercentile(10, sport)).toBe(0.995);
  });

  it.each(SPORTS)('%s: refuses a rating outside 1-10 rather than clamping it', (sport) => {
    expect(() => abilityToPercentile(0, sport)).toThrow(/within \[1,10\]/);
    expect(() => abilityToPercentile(0.9, sport)).toThrow(/within \[1,10\]/);
    expect(() => abilityToPercentile(10.1, sport)).toThrow(/within \[1,10\]/);
    expect(() => abilityToPercentile(11, sport)).toThrow(/within \[1,10\]/);
  });

  it.each(SPORTS)('%s: refuses a rating that is not a finite number', (sport) => {
    expect(() => abilityToPercentile(NaN, sport)).toThrow(/finite/);
    expect(() => abilityToPercentile(null, sport)).toThrow(/finite/);
    expect(() => abilityToPercentile('8', sport)).toThrow(/finite/);
  });

  it('refuses a sport it has no calibration for, rather than guessing one', () => {
    expect(() => abilityToPercentile(5, 'mens-basketball')).toThrow(/no calibration for sport/);
    expect(CALIBRATED_SPORTS).toEqual(SPORTS);
  });

  it('places a score below and above the whole pool without leaving 0-1', () => {
    expect(percentileOf(0, 'mens-soccer')).toBe(0);
    expect(percentileOf(1000, 'mens-soccer')).toBe(1);
  });

  it('interpolates a decimal rating between its neighbours', () => {
    const at7 = abilityToPercentile(7, 'mens-soccer');
    const at8 = abilityToPercentile(8, 'mens-soccer');
    const at75 = abilityToPercentile(7.5, 'mens-soccer');
    expect(at75).toBeCloseTo((at7 + at8) / 2, 10);
    expect(abilityToProgrammeScore(7.5, 'mens-soccer'))
      .toBeCloseTo((abilityToProgrammeScore(7, 'mens-soccer') + abilityToProgrammeScore(8, 'mens-soccer')) / 2, 10);
  });
});

describe('the two sports are not the same scale', () => {
  it('maps the same rating to a different programme score in each', () => {
    const differences = RATINGS.filter((r) =>
      abilityToProgrammeScore(r, 'mens-soccer') !== abilityToProgrammeScore(r, 'womens-soccer'));
    expect(differences.length).toBe(RATINGS.length);
  });

  it('places a rating 6 differently against Division I, which is the point', () => {
    const mens6 = CALIBRATION.sports['mens-soccer'].ratings[5].divisionMix['NCAA D1'] ?? 0;
    const womens6 = CALIBRATION.sports['womens-soccer'].ratings[5].divisionMix['NCAA D1'] ?? 0;
    expect(womens6).toBeGreaterThan(mens6 + 0.15);
  });

  it('holds different pool sizes, which is why the two differ', () => {
    expect(CALIBRATION.sports['womens-soccer'].divisionCounts['NCAA D1'])
      .toBeGreaterThan(CALIBRATION.sports['mens-soccer'].divisionCounts['NCAA D1']);
  });
});

describe('the delta, which is the comparison axis', () => {
  it('is positive when the athlete is rated above the programme', () => {
    expect(abilityDelta({ rating: 9, soccerScore: 40, sport: 'mens-soccer' })).toBeGreaterThan(0);
  });

  it('is negative when the programme is above the rating', () => {
    expect(abilityDelta({ rating: 3, soccerScore: 90, sport: 'mens-soccer' })).toBeLessThan(0);
  });

  it('stays within (-1, 1) across the whole grid', () => {
    for (const sport of SPORTS) {
      for (const rating of RATINGS) {
        for (const score of table.sports[sport].distribution) {
          const d = abilityDelta({ rating, soccerScore: score, sport });
          expect(d).toBeGreaterThan(-1);
          expect(d).toBeLessThan(1);
        }
      }
    }
  });

  it('is near zero when a rating meets the programme level it was calibrated to', () => {
    for (const sport of SPORTS) {
      for (const rating of RATINGS) {
        const d = abilityDelta({ rating, soccerScore: abilityToProgrammeScore(rating, sport), sport });
        expect(Math.abs(d)).toBeLessThan(0.02);
      }
    }
  });
});

describe('the reading an athlete carries', () => {
  it('returns the percentile as canonical and the score as approximate', () => {
    const level = abilityLevel(8, 'mens-soccer');
    expect(level.programmeStrengthPercentile).toBe(0.89);
    expect(level.approximateProgrammeScore).toBeGreaterThan(70);
    expect(level.calibrationId).toBe(CALIBRATION_ID);
    expect(level.divisionMix['NCAA D1']).toBeGreaterThan(0.9);
  });

  it('is deterministic across repeated execution', () => {
    const a = JSON.stringify(RATINGS.map((r) => abilityLevel(r, 'mens-soccer')));
    const b = JSON.stringify(RATINGS.map((r) => abilityLevel(r, 'mens-soccer')));
    expect(a).toBe(b);
  });
});
