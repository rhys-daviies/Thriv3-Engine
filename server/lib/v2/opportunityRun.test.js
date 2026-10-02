import { describe, it, expect } from 'vitest';
import { evaluateOpportunity, opportunityRow } from './opportunityRun.js';
import { buildPositionIndex } from './rosterEvidence.js';
import { REASON } from '../../../shared/matching/v2/index.js';

const DIVISIONS = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA'];

const colleges = Array.from({ length: 100 }, (_, i) => ({
  id: `c${i}`,
  name: `College ${String(i).padStart(3, '0')}`,
  division: DIVISIONS[i % DIVISIONS.length],
  state: ['OH', 'CA', 'TX', 'NY'][i % 4],
  recent_win_pct: i === 5 ? null : ((i * 17) % 100) / 100,
  prior_win_pct: ((i * 29) % 100) / 100,
  notable_majors: i % 3 === 0 ? '["Kinesiology","Business"]' : '["Business"]',
  soccer_score: 20 + ((i * 7) % 75),
}));

/** NJCAA carries no roster, exactly as the real data has it. */
const rosterProgrammes = new Set(colleges.filter((c) => c.division !== 'NJCAA').map((c) => c.name));

/**
 * A7.45B. THE FIXTURE USED TO PASS NO ROSTER INDEX AT ALL.
 *
 * Under the old fallback that was invisible: positional competition refused
 * for all 100 programmes, Playing Pathway quietly continued on rotation alone,
 * and the pool reported 80 scoreable. The numbers below are the same 80 - but
 * they now rest on the positional evidence the pool is supposed to be scoring,
 * rather than on a rotation statistic standing in for it.
 *
 * Every programme we hold a roster for gets a readable position group with
 * readable class years. NJCAA still gets nothing, which is what the real data
 * looks like and what keeps the refusal below meaningful.
 */
const ROSTER_SEASON = 2026;
const ENTRY_YEAR = 2027;
const rosterRows = colleges
  .filter((c) => c.division !== 'NJCAA')
  .flatMap((c) => Array.from({ length: 12 }, (_, j) => ({
    college_name: c.name,
    sport: 'mens-soccer',
    season: ROSTER_SEASON,
    division: c.division,
    player_name: `${c.name} player ${j}`,
    position: ['GK', 'D', 'M', 'F'][j % 4],
    class_year_label: ['Fr.', 'So.', 'Jr.', 'Sr.'][j % 4],
    minutes_played: j < 6 ? 900 : 100,
    games_started: j < 6 ? 12 : 1,
    projected_minutes: null,
    projected_games_started: null,
  })));
const rosterIndex = buildPositionIndex(rosterRows);

const athlete = (over = {}) => ({
  sport: 'mens-soccer', position: 'MIDFIELD',
  intendedMajor: null, priorityRanking: null,
  preferredStates: null, maxDistanceMiles: null, levelPreference: null, ...over,
});

const run = (over, overrides) => evaluateOpportunity({
  athlete: athlete(over), colleges, rosterProgrammes, rosterIndex,
  entryYear: ENTRY_YEAR, rosterSeason: ROSTER_SEASON, overrides,
});

describe('scoring a pool', () => {
  const rep = run();

  it('refuses every programme it holds neither a roster nor minutes for', () => {
    // A7.8.2 let Playing Pathway be carried by either half; A7.45B requires
    // the competition half, so a refusal means the entry-year evidence is
    // missing. NJCAA has neither a roster nor an eligibility rule, so both
    // halves are gone - and after A7.48 D1 the reason names the thing that is
    // actually absent, which is the roster, not a minutes history.
    expect(rep.byDivision.NJCAA.scoreable).toBe(0);
    expect(rep.unscoreableReasons[REASON.NO_ROSTER_ON_FILE]).toBe(20);
    expect(rep.unscoreableReasons[REASON.NO_MINUTES_HISTORY]).toBeUndefined();
  });

  it('A7.45B: a caller that passes no roster index now scores nothing', () => {
    /**
     * THE SHAPE THIS FIXTURE USED TO HAVE, kept as a test because a stale
     * caller is how this goes wrong in practice - `buildPositionIndex`'s own
     * header records a query that forgot two columns and made MIT unrankable.
     *
     * Without a roster index there is no positional competition anywhere, so
     * under A7.45B there is no Playing Pathway anywhere, and Opportunity -
     * which requires it - refuses the whole pool. Loudly wrong beats quietly
     * scoring every programme on a rotation statistic.
     */
    const blind = evaluateOpportunity({ athlete: athlete(), colleges, rosterProgrammes });
    expect(blind.counts.scoreable).toBe(0);
    expect(blind.counts.unscoreable).toBe(100);
  });

  it('scores everything it does hold minutes for', () => {
    expect(rep.counts.scoreable).toBe(80);
  });

  it('reports the components and how much of each it could measure', () => {
    expect(rep.componentCoverage.playingPathway).toBe(0.8);
    expect(rep.componentCoverage.programmeTrajectory).toBeCloseTo(0.99, 6);
    expect(rep.componentCoverage.majorFit).toBe(0);
    expect(rep.notApplicable.majorFit).toBe(1);
    expect(rep.notApplicable.locationFit).toBe(1);
    expect(rep.notApplicable.athleticOutcome).toBe(1);
  });

  it('says that nothing is known about what this athlete wants', () => {
    expect(rep.preferenceKnown).toBe(false);
    expect(rep.prioritiesApplied.applied).toBe(false);
  });

  it('is deterministic and produces no ranking', () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(rep));
    expect(rep.results.map((r) => r.id)).toEqual(colleges.map((c) => c.id));
    expect(rep).not.toHaveProperty('pursuitPriority');
  });
});

describe('the things that must not move it', () => {
  const base = run().opportunity;

  it('athlete budget', () => {
    expect(evaluateOpportunity({ athlete: { ...athlete(), budgetRange: '$40k+/yr' }, colleges, rosterProgrammes, rosterIndex, entryYear: ENTRY_YEAR, rosterSeason: ROSTER_SEASON }).opportunity).toEqual(base);
  });

  it('a financial viability result handed in alongside the athlete', () => {
    expect(evaluateOpportunity({ athlete: { ...athlete(), financialViability: 0.9 }, colleges, rosterProgrammes, rosterIndex, entryYear: ENTRY_YEAR, rosterSeason: ROSTER_SEASON }).opportunity).toEqual(base);
  });

  it('a recruitability result handed in alongside the athlete', () => {
    expect(evaluateOpportunity({ athlete: { ...athlete(), recruitability: 0.9, rating: 10 }, colleges, rosterProgrammes, rosterIndex, entryYear: ENTRY_YEAR, rosterSeason: ROSTER_SEASON }).opportunity).toEqual(base);
  });

  it('academics on their own', () => {
    expect(evaluateOpportunity({ athlete: { ...athlete(), gpa: 4.0, sat: 1600 }, colleges, rosterProgrammes, rosterIndex, entryYear: ENTRY_YEAR, rosterSeason: ROSTER_SEASON }).opportunity).toEqual(base);
  });

  it('the athlete home state, absent a stated preference', () => {
    expect(evaluateOpportunity({ athlete: { ...athlete(), state: 'OH' }, colleges, rosterProgrammes, rosterIndex, entryYear: ENTRY_YEAR, rosterSeason: ROSTER_SEASON }).opportunity).toEqual(base);
  });
});

describe('the things that must move it', () => {
  it('a declared major', () => {
    const declared = run({ intendedMajor: 'exercise science' });
    expect(declared.preferenceKnown).toBe(true);
    expect(declared.componentCoverage.majorFit).toBeGreaterThan(0.9);
    expect(declared.notApplicable.majorFit).toBe(0);
    expect(declared.opportunity.median).not.toBe(run().opportunity.median);
  });

  it('a declared location preference', () => {
    const declared = run({ preferredStates: ['OH'] });
    expect(declared.componentCoverage.locationFit).toBeGreaterThan(0.9);
    expect(declared.notApplicable.locationFit).toBe(0);
  });

  it('a stated priority ranking, for the criteria that survive', () => {
    const rep = run({ intendedMajor: 'exercise science', priorityRanking: ['academic', 'roster', 'athletic', 'affordability'] });
    expect(rep.prioritiesApplied.applied).toBe(true);
    expect(rep.prioritiesApplied.ignored.map((i) => i.key).sort()).toEqual(['affordability', 'athletic']);
  });

  it('the position, because the measured scale differs by position', () => {
    expect(run({ position: 'GOALKEEPER' }).playingPathway.median)
      .not.toBe(run({ position: 'MIDFIELD' }).playingPathway.median);
  });
});

describe('the flattened row', () => {
  it('carries both subtotals and the not-applicable list', () => {
    const row = opportunityRow(run().results.find((r) => r.result.ok));
    for (const k of ['opportunity', 'objectiveValue', 'preferenceKnown',
      'playingPathway', 'playingShare', 'playingLevel', 'programmeTrajectory', 'notApplicable']) {
      expect(row, k).toHaveProperty(k);
    }
    expect(row.preferenceKnown).toBe(false);
  });

  it('carries no number when unscoreable', () => {
    const row = opportunityRow(run().results.find((r) => !r.result.ok));
    expect(row.scoreable).toBe(false);
    expect(row).not.toHaveProperty('opportunity');
    expect(row.reason).toBe(REASON.NO_ROSTER_ON_FILE);
  });
});
