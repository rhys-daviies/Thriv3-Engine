import { describe, it, expect } from 'vitest';
import { runPursuit, pursuitRow } from './pursuitRun.js';
import { buildPositionIndex, buildArrivalIndex, divisionArrivalRates } from './rosterEvidence.js';
import { RANKING_STATE } from '../../../shared/matching/v2/index.js';

const DIVISIONS = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA'];

const colleges = Array.from({ length: 120 }, (_, i) => ({
  id: `c${i}`, name: `College ${String(i).padStart(3, '0')}`,
  division: DIVISIONS[i % DIVISIONS.length],
  conference: `Conf ${i % 9}`,
  control: (i % 3 === 0) ? 1 : 2,
  net_price: 6000 + ((i * 397) % 42000),
  tuition_in_state: 9000 + ((i * 97) % 6000),
  tuition_out_state: 21000 + ((i * 131) % 14000),
  state: ['OH', 'CA', 'TX', 'NY'][i % 4],
  soccer_score: 20 + ((i * 7) % 75),
  recent_win_pct: ((i * 17) % 100) / 100,
  prior_win_pct: ((i * 29) % 100) / 100,
  notable_majors: '["Business","Kinesiology"]',
}));

const roster = colleges.filter((c) => c.division !== 'NJCAA').flatMap((c, i) =>
  Array.from({ length: 12 }, (_, j) => ({
    college_name: c.name, player_name: `p${i}-${j}`,
    position: ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'][j % 4],
    class_year_label: ['Fr.', 'So.', 'Jr.', 'Sr.', 'Gr.'][(i + j) % 5],
    division: c.division, season: '2026',
    minutes_played: null, projected_minutes: j % 3 === 0 ? 1200 : 100,
    games_started: null, projected_games_started: null,
  })));

const arrivals = colleges.flatMap((c, i) => Array.from({ length: 10 }, (_, j) => ({
  programme: c.name, sport: 'mens-soccer', arrival_season: '2026',
  canonical_position: ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'][j % 4],
  is_international: (i + j) % 4 === 0 ? 1 : 0,
})));

const ctx = {
  rosterProgrammes: new Set(roster.map((r) => r.college_name)),
  rosterIndex: buildPositionIndex(roster),
  arrivalIndex: buildArrivalIndex(arrivals),
  divisionArrivals: divisionArrivalRates(arrivals, new Map(colleges.map((c) => [c.name, c]))),
  arrivalsHorizon: 2026,
};

const athlete = (over = {}) => ({
  label: { id: 'T' },
  v1Shape: {
    sport: 'mens-soccer', budgetRange: '$20k-$25k/yr', state: 'OH', origin: 'USA',
    ...(over.v1Shape ?? {}),
  },
  recruitability: {
    sport: 'mens-soccer', rating: 7, position: 'MIDFIELD', entryYear: 2027, isInternational: false,
    ...(over.recruitability ?? {}),
  },
  opportunity: {
    sport: 'mens-soccer', position: 'MIDFIELD', intendedMajor: null, priorityRanking: null,
    ...(over.opportunity ?? {}),
  },
});

const run = (over = {}, opts = {}) => runPursuit({
  athlete: athlete(over), sport: 'mens-soccer', colleges, ctx, topN: 20, ...opts,
});

describe('the whole pipeline over a pool', () => {
  const rep = run();

  it('splits the pool into states that account for all of it', () => {
    const c = rep.counts;
    expect(c.ranked + c.limitedData + c.ineligible + c.suppressed).toBe(120);
    expect(c.ranked).toBeGreaterThan(50);
    expect(c.limitedData).toBeGreaterThanOrEqual(24);
  });

  it('leaves every junior college in limited data, because two layers are missing', () => {
    const njcaa = rep.pipeline.limited.filter((r) => r.division === 'NJCAA');
    expect(njcaa).toHaveLength(24);
    for (const r of njcaa) expect(r.missingLayers.sort()).toEqual(['opportunity', 'recruitability']);
  });

  it('reports the distribution, the compression and the gate firing rates', () => {
    expect(rep.pursuitPriority.n).toBe(rep.counts.ranked);
    expect(rep.compression.above090).toBeLessThan(0.2);
    expect(rep.gateFiringRate.recruitability).toBeGreaterThanOrEqual(0);
    expect(rep.gateFiringRate.financial).toBeLessThanOrEqual(1);
  });

  it('reports how much programme strength drives the priority', () => {
    const psi = rep.programmeStrengthInfluence;
    expect(psi.n).toBeGreaterThan(50);
    expect(psi.pursuitPriority).toBeLessThan(0);
    expect(psi.recruitability).toBeLessThan(0);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(run().pipeline.actionable.map((r) => r.id)))
      .toBe(JSON.stringify(rep.pipeline.actionable.map((r) => r.id)));
  });
});

describe('suppressed and ineligible', () => {
  it('keeps a suppressed programme out of every list and counts it separately', () => {
    const rep = run({}, { suppressedIds: new Set(['c1', 'c2']) });
    expect(rep.counts.suppressed).toBe(2);
    const ids = [...rep.pipeline.ranked, ...rep.pipeline.limited].map((r) => r.id);
    expect(ids).not.toContain('c1');
    expect(ids).not.toContain('c2');
  });

  it('keeps an ineligible programme out of every list and records the rule', () => {
    const rep = run({}, { ineligible: new Map([['c3', 'division']]) });
    expect(rep.counts.ineligible).toBe(1);
    expect(rep.pipeline.ineligible[0].ineligibleReason).toBe('division');
    expect(rep.pipeline.ranked.map((r) => r.id)).not.toContain('c3');
  });

  it('never lets one become the other', () => {
    const rep = run({}, { suppressedIds: new Set(['c4']), ineligible: new Map([['c4', 'division']]) });
    expect(rep.pipeline.suppressed.map((r) => r.id)).toEqual(['c4']);
    expect(rep.pipeline.ineligible).toHaveLength(0);
  });
});

describe('which athlete input reaches which layer', () => {
  const base = run();
  const priorities = (rep) => rep.pipeline.ranked.map((r) => r.pursuitPriority.value);

  it('budget changes Financial and the priority, and neither of the other two', () => {
    const rich = run({ v1Shape: { budgetRange: '$40k+/yr' } });
    expect(priorities(rich)).not.toEqual(priorities(base));
    expect(rich.layers.recruitability).toEqual(base.layers.recruitability);
    expect(rich.layers.opportunity).toEqual(base.layers.opportunity);
  });

  it('athlete ability changes Recruitability and the priority, and neither of the other two', () => {
    const better = run({ recruitability: { rating: 9 } });
    expect(priorities(better)).not.toEqual(priorities(base));
    expect(better.layers.financial).toEqual(base.layers.financial);
    expect(better.layers.opportunity).toEqual(base.layers.opportunity);
  });

  it('intended major changes Opportunity and the priority, and neither of the other two', () => {
    const declared = run({ opportunity: { intendedMajor: 'exercise science' } });
    expect(priorities(declared)).not.toEqual(priorities(base));
    expect(declared.layers.financial).toEqual(base.layers.financial);
    expect(declared.layers.recruitability).toEqual(base.layers.recruitability);
  });

  it('an absent location preference changes nothing at all', () => {
    const withHome = run({ opportunity: { preferredStates: null } });
    expect(priorities(withHome)).toEqual(priorities(base));
  });
});

describe('the flattened row', () => {
  it('exposes every layer, gate and effect for a ranked programme', () => {
    const row = pursuitRow(run().pipeline.actionable[0]);
    for (const k of ['rank', 'pursuitPriority', 'recruitability', 'financial', 'opportunity',
      'base', 'recruitabilityGate', 'financialGate', 'recruitabilityGateLoss', 'financialGateLoss']) {
      expect(row, k).toHaveProperty(k);
    }
    expect(row.rankingState).toBe(RANKING_STATE.RANKED);
  });

  it('carries no priority and no rank for a limited-data programme', () => {
    const row = pursuitRow(run().pipeline.limited[0]);
    expect(row.rankingState).toBe(RANKING_STATE.LIMITED_DATA);
    expect(row.pursuitPriority).toBeNull();
    expect(row.rank).toBeNull();
    expect(row.missingLayers.length).toBeGreaterThan(0);
  });
});
