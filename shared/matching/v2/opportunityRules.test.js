import { describe, it, expect } from 'vitest';
import {
  PLAYING_NORMS, PLAYING_NORMS_ID, PLAYING_NORMS_DIGEST,
  playingShareFor, playingScale, TRAJECTORY_SATURATION,
  VALUE_WEIGHTS, PREFERENCE_WEIGHTS, PRIORITY_LIFT, PRIORITY_MAP,
  FOREIGN_PRIORITIES, OPPORTUNITY_COVERAGE_FLOOR,
} from './opportunityRules.js';

const SPORTS = ['mens-soccer', 'womens-soccer'];
const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];

describe('the pinned playing norms', () => {
  it('names itself, its seasons and the measure it used', () => {
    expect(PLAYING_NORMS_ID).toMatch(/^playing-norms-\d{4}-\d{2}-\d{2}$/);
    expect(PLAYING_NORMS_DIGEST).toMatch(/^[0-9a-f]{16}$/);
    expect(PLAYING_NORMS.seasons).toEqual(['2022', '2023', '2024', '2025']);
    expect(PLAYING_NORMS.measure).toMatch(/effectivePlayers/);
  });

  it('excludes the season in progress', () => {
    expect(PLAYING_NORMS.seasons).not.toContain('2026');
  });

  it('holds a scale for every sport and position, built on thousands of seasons', () => {
    for (const sport of SPORTS) {
      for (const p of POSITIONS) {
        const s = playingScale(sport, p);
        expect(s, `${sport} ${p}`).toBeTruthy();
        expect(s.p10).toBeLessThan(s.median);
        expect(s.median).toBeLessThan(s.p90);
        expect(s.programmeSeasons).toBeGreaterThan(2000);
      }
    }
  });

  it('records goalkeeping as the most concentrated position, without a rule saying so', () => {
    for (const sport of SPORTS) {
      const gk = playingScale(sport, 'GOALKEEPER').median;
      for (const p of ['DEFENSE', 'MIDFIELD', 'FORWARD']) {
        expect(gk, `${sport} ${p}`).toBeLessThan(playingScale(sport, p).median);
      }
    }
  });
});

describe('the playing-share hierarchy', () => {
  it('uses a programme own seasons where it has enough of them', () => {
    // Unlike A7.3's fill propensity, this level IS reachable: the measure
    // survives a split-half test, and most programmes have the seasons.
    expect(Object.keys(PLAYING_NORMS.programme).length).toBeGreaterThan(3000);
    const r = playingShareFor({ sport: 'mens-soccer', division: 'NCAA D1', position: 'MIDFIELD', programme: 'Maryland' });
    expect(r.level).toBe('programme');
    expect(r.seasons).toBeGreaterThanOrEqual(PLAYING_NORMS.minProgrammeSeasons);
  });

  it('falls back to division, then to sport', () => {
    const d = playingShareFor({ sport: 'mens-soccer', division: 'NCAA D1', position: 'MIDFIELD', programme: 'Nowhere At All' });
    expect(d.level).toBe('division');
    const s = playingShareFor({ sport: 'mens-soccer', division: 'NJCAA', position: 'MIDFIELD', programme: 'Nowhere At All' });
    expect(s.level).toBe('sport');
  });

  it('returns nothing for a sport or position it never measured', () => {
    expect(playingShareFor({ sport: 'mens-basketball', division: 'NCAA D1', position: 'MIDFIELD', programme: 'X' })).toBeNull();
    expect(playingScale('mens-soccer', 'SWEEPER')).toBeNull();
  });
});

describe('the declared heuristics', () => {
  it('bounds the trajectory outside the range programmes actually occupy', () => {
    expect(TRAJECTORY_SATURATION).toBe(0.3);
  });

  it('weights playing opportunity above trajectory', () => {
    expect(VALUE_WEIGHTS.playingPathway).toBeGreaterThan(VALUE_WEIGHTS.programmeTrajectory);
    expect(VALUE_WEIGHTS.playingPathway + VALUE_WEIGHTS.programmeTrajectory).toBeCloseTo(1, 10);
  });

  it('keeps the priority lift modest, because a ranking is an order not a magnitude', () => {
    expect(PRIORITY_LIFT).toBeGreaterThan(0);
    expect(PRIORITY_LIFT).toBeLessThan(1);
  });

  it('lets the objective half clear the coverage floor on its own', () => {
    expect(VALUE_WEIGHTS.playingPathway).toBeGreaterThan(OPPORTUNITY_COVERAGE_FLOOR);
  });
});

describe('the priority map is the cross-layer boundary', () => {
  it('maps only criteria this layer owns', () => {
    expect(Object.values(PRIORITY_MAP).sort()).toEqual(['locationFit', 'majorFit', 'playingPathway']);
  });

  it('names the criteria belonging elsewhere, and who owns them', () => {
    expect(FOREIGN_PRIORITIES.athletic).toBe('Coach Recruitability');
    expect(FOREIGN_PRIORITIES.affordability).toBe('Financial Viability');
    expect(FOREIGN_PRIORITIES.programQuality).toMatch(/dropped/);
  });

  it('shares no key between the two, so nothing is both owned and foreign', () => {
    for (const key of Object.keys(FOREIGN_PRIORITIES)) expect(PRIORITY_MAP[key]).toBeUndefined();
  });

  it('covers every V1 criterion exactly once, between them', () => {
    const v1 = ['athletic', 'roster', 'academic', 'affordability', 'programQuality', 'geography'];
    for (const key of v1) {
      const owned = key in PRIORITY_MAP;
      const foreign = key in FOREIGN_PRIORITIES;
      expect(owned !== foreign, `${key} is ${owned ? '' : 'not '}owned and ${foreign ? '' : 'not '}foreign`).toBe(true);
    }
  });
});
