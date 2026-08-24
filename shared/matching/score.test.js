import { describe, it, expect } from 'vitest';
import { scoreMatch } from './score.js';
import { resolveWeights, academicWeight, normalise, CRITERION_KEYS, DEFAULT_WEIGHTS } from './weights.js';

const athlete = {
  level: 60,
  position: 'MIDFIELD',
  classYear: 2027,
  sport: 'mens-soccer',
  academicImportance: 5,
  gpa: 3.4,
  sat: 1200,
  budgetRange: '$15k-$30k/yr',
  state: 'OH',
};

const college = {
  soccerScore: 62,
  academicRating: 6,
  satAvg: 1180,
  admitRate: 0.6,
  division: 'NCAA D2',
  conference: 'GLIAC',
  graduatingStarters: 1,
  graduatingSquad: 2,
  rosterRows: 28,
  rowsMissingGradYear: 0,
  qualityPercentile: 0.55,
  recentWinPct: 0.6,
  priorWinPct: 0.5,
  netPrice: 21000,
  state: 'OH',
  distanceMiles: 90,
};

describe('academicWeight', () => {
  it('maps the importance slider onto a weight, not a threshold', () => {
    expect(academicWeight('Not Important')).toBe(0);
    expect(academicWeight(0)).toBe(0);
    expect(academicWeight(5)).toBe(12.5);
    expect(academicWeight(10)).toBe(25);
  });

  it('never lets academics outweigh athletic fit', () => {
    expect(academicWeight(10)).toBeLessThan(DEFAULT_WEIGHTS.athletic);
  });

  it('treats unparseable input as zero rather than NaN', () => {
    expect(academicWeight('abc')).toBe(0);
    expect(academicWeight(null)).toBe(0);
    expect(academicWeight(undefined)).toBe(0);
  });

  it('clamps out-of-range sliders', () => {
    expect(academicWeight(50)).toBe(25);
    expect(academicWeight(-3)).toBe(0);
  });
});

describe('resolveWeights', () => {
  it('always sums to 1', () => {
    for (const imp of ['Not Important', 0, 1, 5, 10, null]) {
      const w = resolveWeights({ academicImportance: imp });
      const total = CRITERION_KEYS.reduce((s, k) => s + w[k], 0);
      expect(total).toBeCloseTo(1, 10);
    }
  });

  it('honours an operator override, including an explicit zero', () => {
    const w = resolveWeights({ academicImportance: 5, overrides: { geography: 0 } });
    expect(w.geography).toBe(0);
    expect(CRITERION_KEYS.reduce((s, k) => s + w[k], 0)).toBeCloseTo(1, 10);
  });

  it('ignores a negative or unparseable override rather than corrupting the map', () => {
    const w = resolveWeights({ academicImportance: 5, overrides: { athletic: -10, roster: 'abc' } });
    const base = resolveWeights({ academicImportance: 5 });
    expect(w).toEqual(base);
  });

  it('falls back to equal weights if every criterion is zeroed', () => {
    const w = normalise(Object.fromEntries(CRITERION_KEYS.map((k) => [k, 0])));
    expect(w.athletic).toBeCloseTo(1 / CRITERION_KEYS.length, 10);
  });
});

describe('scoreMatch', () => {
  it('returns a bounded score with a full six-criterion breakdown', () => {
    const r = scoreMatch({ athlete, college });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.breakdown.map((b) => b.key)).toEqual(CRITERION_KEYS);
  });

  it('has contributions that sum to the score', () => {
    const r = scoreMatch({ athlete, college });
    const summed = r.breakdown.reduce((s, b) => s + b.contribution, 0);
    expect(summed).toBeCloseTo(r.score, 0);
  });

  it('reaches 100 only when every weighted criterion is perfect', () => {
    const perfect = scoreMatch({
      athlete: { ...athlete, sat: 1600, budgetRange: '$50k+/yr' },
      college: {
        ...college,
        soccerScore: 56, // athlete 4 points above -> athletic peak
        academicRating: 10,
        satAvg: 1000,
        qualityPercentile: 1,
        recentWinPct: 1,
        priorWinPct: 0,
        graduatingStarters: 4,
        distanceMiles: 0,
      },
    });
    expect(perfect.score).toBe(100);
  });

  it('scores the same programme differently for a different athlete — the scale is shared', () => {
    // No budget stated, so no scholarship coupling shifts the athletic peak.
    const base = { ...athlete, budgetRange: null };
    const elite = scoreMatch({ athlete: { ...base, level: 92 }, college });
    const fit = scoreMatch({ athlete: base, college });
    expect(fit.score).toBeGreaterThan(elite.score);
  });

  it('an unrated school is scored, not excluded, and says so', () => {
    const r = scoreMatch({ athlete, college: { ...college, academicRating: null } });
    const academic = r.breakdown.find((b) => b.key === 'academic');
    expect(academic.confidence).toBe('assumed');
    expect(r.score).toBeGreaterThan(0);
  });

  it('an unscraped roster does not sink the card', () => {
    const scraped = scoreMatch({ athlete, college });
    const unscraped = scoreMatch({ athlete, college: { ...college, rosterRows: 0 } });
    const none = scoreMatch({ athlete, college: { ...college, graduatingStarters: 0, graduatingSquad: 0 } });
    expect(unscraped.score).toBeGreaterThan(none.score);
    expect(unscraped.score).toBeLessThan(scraped.score);
  });

  it('drops academics out of the score entirely when the athlete says it does not matter', () => {
    const w = resolveWeights({ academicImportance: 'Not Important' });
    const good = scoreMatch({ athlete, college: { ...college, academicRating: 9.5 }, weights: w });
    const poor = scoreMatch({ athlete, college: { ...college, academicRating: 1.5 }, weights: w });
    expect(good.score).toBe(poor.score);
  });

  it('reports overall confidence from the criteria that actually carry weight', () => {
    const w = resolveWeights({ academicImportance: 'Not Important' });
    // Academic is fully unknown but weighted to zero, so it cannot drag the card down.
    const r = scoreMatch({ athlete, college: { ...college, academicRating: null }, weights: w });
    expect(r.confidence).toBe('measured');
  });

  it('never produces NaN when the athlete record is nearly empty', () => {
    const r = scoreMatch({ athlete: { sport: 'mens-soccer' }, college });
    expect(Number.isFinite(r.score)).toBe(true);
    for (const b of r.breakdown) expect(Number.isFinite(b.score)).toBe(true);
  });
});


describe('an athlete with no recruiting class year', () => {
  it('has roster opportunity fall back to the prior rather than sinking every scraped school', () => {
    const noYear = { ...athlete, classYear: null };
    const scraped = scoreMatch({ athlete: noYear, college });
    const unscraped = scoreMatch({ athlete: noYear, college: { ...college, rosterRows: 0 } });
    expect(scraped.score).toBe(unscraped.score);
    expect(scraped.breakdown.find((b) => b.key === 'roster').confidence).toBe('assumed');
  });
});
