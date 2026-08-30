/**
 * Track B — trajectories, and the denominators that make them readable.
 */
import { describe, it, expect } from 'vitest';
import { buildLifecycles } from './lifecycle.js';
import { trajectoryOf, developmentSummary, MIN_COHORT } from './development.js';

const row = (o = {}) => ({
  id: o.id ?? `r${Math.random()}`,
  college_name: o.college_name ?? 'Test College',
  sport: 'mens-soccer',
  season: String(o.season ?? '2022'),
  player_name: o.player_name ?? 'Alex Morgan',
  class_year_label: 'class_year_label' in o ? o.class_year_label : 'Fr.',
  position: 'position' in o ? o.position : 'Defender',
  minutes_played: 'minutes_played' in o ? o.minutes_played : 500,
  games_played: 12, games_started: 4,
  nationality: 'USA', hometown: 'Phoenix, AZ',
  estimated_graduation_year: 2026, eligibility_end_year: 2026, prior_programme: null,
});

const player = (name, mins, opts = {}) => mins.map((m, i) => row({
  player_name: name, season: 2022 + i, minutes_played: m,
  class_year_label: ['Fr.', 'So.', 'Jr.', 'Sr.'][i] ?? 'Gr.',
  ...opts,
}));

describe('a single trajectory', () => {
  it('walks the seasons and finds the first starter season', () => {
    const [life] = buildLifecycles(player('A One', [120, 640, 1220, 1400]));
    const t = trajectoryOf(life);
    expect(t.points.map((p) => p.minutes)).toEqual([120, 640, 1220, 1400]);
    expect(t.points.map((p) => p.roleBand)).toEqual(['1-199', '600+', '600+', '600+']);
    expect(t.firstStarterSeason).toBe('2023');
    expect(t.seasonsUntilStarter).toBe(1);
    expect(t.everStarter).toBe(true);
    expect(t.finalRoleBand).toBe('600+');
  });

  it('reports no starter season where none was reached', () => {
    const [life] = buildLifecycles(player('B Two', [0, 40, 150, 90]));
    const t = trajectoryOf(life);
    expect(t.everStarter).toBe(false);
    expect(t.seasonsUntilStarter).toBeNull();
    expect(t.firstStarterSeason).toBeNull();
  });

  it('computes year-over-year change only between adjacent measured seasons', () => {
    const [life] = buildLifecycles(player('C Three', [100, null, 900, 1000]));
    const t = trajectoryOf(life);
    // 2022→2023 broken by the unmeasured season; 2023→2024 likewise; only
    // 2024→2025 is a comparable pair.
    expect(t.changes).toHaveLength(1);
    expect(t.changes[0]).toMatchObject({ from: '2024', to: '2025', delta: 100 });
  });

  it('does not bridge a missing season', () => {
    const rows = [
      row({ player_name: 'D Four', season: 2022, minutes_played: 100 }),
      row({ player_name: 'D Four', season: 2025, minutes_played: 900, class_year_label: 'Sr.' }),
    ];
    const [life] = buildLifecycles(rows);
    const t = trajectoryOf(life);
    expect(t.changes).toHaveLength(0);
    expect(t.gapSeasons).toEqual(['2023', '2024']);
    // The second observation is still the player's second OBSERVED season and
    // its fourth year since arriving; both are recorded.
    expect(t.points[1].seasonIndex).toBe(1);
    expect(t.points[1].yearsSinceFirst).toBe(3);
  });

  it('records a band transition in both directions', () => {
    const [life] = buildLifecycles(player('E Five', [900, 100]));
    const t = trajectoryOf(life);
    expect(t.changes[0]).toMatchObject({ fromBand: '600+', toBand: '1-199', delta: -800 });
  });

  it('carries an unmeasured final season without inventing a role', () => {
    const [life] = buildLifecycles(player('F Six', [900, null]));
    const t = trajectoryOf(life);
    expect(t.finalRoleBand).toBeNull();
    expect(t.finalSeasonMeasured).toBe(false);
  });
});

describe('programme development summary', () => {
  const cohortOf = (n, mins) => Array.from({ length: n },
    (_, i) => player(`P ${String.fromCharCode(97 + i)}`, mins)).flat();

  it('shrinks the denominator as the horizon lengthens', () => {
    const rows = [
      // Ten players first seen in 2022 — they can have a year 4.
      ...cohortOf(10, [700, 700, 700, 700]),
      // Ten first seen in 2025 — they cannot have a year 2 in a 2026 dataset.
      ...Array.from({ length: 10 }, (_, i) => row({
        player_name: `Q ${String.fromCharCode(97 + i)}`, season: 2025, minutes_played: 700,
      })),
    ];
    const s = developmentSummary(buildLifecycles(rows), { lastSeason: '2026' });
    const y1 = s.starterLevelByYear.find((x) => x.year === 1);
    const y2 = s.starterLevelByYear.find((x) => x.year === 2);
    expect(y1.denominator).toBe(20);
    expect(y2.denominator).toBe(10);       // the 2025 arrivals are excluded
    expect(y2.share).toBe(1);
  });

  it('suppresses a share below the minimum cohort and says so', () => {
    const rows = cohortOf(3, [700, 700]);
    const s = developmentSummary(buildLifecycles(rows), { lastSeason: '2026' });
    const y1 = s.starterLevelByYear.find((x) => x.year === 1);
    expect(y1.denominator).toBe(3);
    expect(y1.reached).toBe(3);
    expect(y1.share).toBeNull();
    expect(y1.suppressed).toBe(true);
  });

  it('reports retention against the cohort that could have returned', () => {
    const rows = [
      ...cohortOf(10, [500, 500]),                       // stayed a second year
      ...Array.from({ length: 10 }, (_, i) => row({      // one season only
        player_name: `R ${String.fromCharCode(97 + i)}`, season: 2022, minutes_played: 500,
      })),
    ];
    const s = developmentSummary(buildLifecycles(rows), { lastSeason: '2026' });
    const after1 = s.retentionByYear.find((x) => x.afterYears === 1);
    expect(after1.denominator).toBe(20);
    expect(after1.stillObserved).toBe(10);
    expect(after1.share).toBe(0.5);
  });

  it('counts a player with no measured season separately', () => {
    const rows = [...cohortOf(9, [700, 700]), ...player('Z Nine', [null, null])];
    const s = developmentSummary(buildLifecycles(rows), { lastSeason: '2026' });
    expect(s.players).toBe(10);
    expect(s.playersWithNoMeasuredSeason).toBe(1);
    expect(s.everReachedStarter.denominator).toBe(9);
  });

  it('reports band-to-band movement with its own denominator', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => player(`S ${String.fromCharCode(97 + i)}`, [100, 700])).flat(),
    ];
    const s = developmentSummary(buildLifecycles(rows), { lastSeason: '2026' });
    const from199 = s.bandProgression.find((b) => b.from === '1-199');
    expect(from199.observations).toBe(10);
    expect(from199.to.find((t) => t.band === '600+').count).toBe(10);
    expect(from199.to.find((t) => t.band === '600+').share).toBe(1);
    expect(from199.suppressed).toBe(false);
    const from0 = s.bandProgression.find((b) => b.from === '0');
    expect(from0.observations).toBe(0);
    expect(from0.suppressed).toBe(true);
  });

  it('takes the median time to a starter season over those who reached one', () => {
    const rows = [
      ...player('T A', [700, 700]),          // year 0
      ...player('T B', [100, 700]),          // year 1
      ...player('T C', [100, 100, 700]),     // year 2
      ...player('T D', [100, 100]),          // never
    ];
    const s = developmentSummary(buildLifecycles(rows), { lastSeason: '2026', minCohort: 1 });
    expect(s.seasonsUntilStarterSample).toBe(3);
    expect(s.medianSeasonsUntilStarter).toBe(1);
  });

  it('exposes MIN_COHORT so a caller can see the rule', () => {
    expect(MIN_COHORT).toBeGreaterThan(1);
  });
});
