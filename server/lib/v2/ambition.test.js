import { describe, it, expect } from 'vitest';
import { runPursuit } from './pursuitRun.js';
import { buildPositionIndex, buildArrivalIndex, divisionArrivalRates } from './rosterEvidence.js';

const DIVISIONS = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA'];

const colleges = Array.from({ length: 120 }, (_, i) => ({
  id: `c${i}`, name: `College ${String(i).padStart(3, '0')}`,
  division: DIVISIONS[i % DIVISIONS.length], conference: `Conf ${i % 9}`,
  control: (i % 3 === 0) ? 1 : 2,
  net_price: 6000 + ((i * 397) % 42000),
  tuition_in_state: 9000 + ((i * 97) % 6000),
  tuition_out_state: 21000 + ((i * 131) % 14000),
  state: ['OH', 'CA', 'TX', 'NY'][i % 4],
  // A wide strength spread, so a level preference has something to act on.
  soccer_score: 20 + ((i * 11) % 78),
  recent_win_pct: ((i * 17) % 100) / 100,
  prior_win_pct: ((i * 29) % 100) / 100,
  notable_majors: '["Business","Kinesiology"]',
}));

const roster = colleges.flatMap((c, i) => Array.from({ length: 12 }, (_, j) => ({
  college_name: c.name, player_name: `p${i}-${j}`,
  position: ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'][j % 4],
  class_year_label: ['Fr.', 'So.', 'Jr.', 'Sr.', 'Gr.'][(i + j) % 5],
  division: c.division, season: '2026',
  minutes_played: null, projected_minutes: j % 3 === 0 ? 1200 : 100,
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

const athlete = (rating, level, playing) => ({
  label: { id: 'T' },
  v1Shape: { sport: 'mens-soccer', budgetRange: '$20k-$25k/yr', state: 'OH', origin: 'USA' },
  recruitability: { sport: 'mens-soccer', rating, position: 'MIDFIELD', entryYear: 2027, isInternational: false },
  opportunity: {
    sport: 'mens-soccer', position: 'MIDFIELD', rating,
    intendedMajor: null, priorityRanking: null,
    competitiveLevelPriority: level, playingOpportunityPriority: playing,
  },
});

const run = (rating, level, playing) => runPursuit({
  athlete: athlete(rating, level, playing), sport: 'mens-soccer', colleges, ctx, topN: 30,
});

const medianScore = (rep) => {
  const v = rep.pipeline.actionable.map((r) => r.soccerScore).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
};

describe('the preference changes Opportunity and nothing else', () => {
  const base = run(9, null, null);

  it.each([[5, 1], [1, 5], [5, 5], [3, 3]])(
    'leaves Coach Recruitability byte-identical at (level %i, playing %i)', (level, playing) => {
      expect(run(9, level, playing).layers.recruitability).toEqual(base.layers.recruitability);
    });

  it.each([[5, 1], [1, 5], [5, 5], [3, 3]])(
    'leaves Financial Viability byte-identical at (level %i, playing %i)', (level, playing) => {
      expect(run(9, level, playing).layers.financial).toEqual(base.layers.financial);
    });

  it('does change Opportunity, or the field would be doing nothing', () => {
    expect(run(9, 5, 1).layers.opportunity).not.toEqual(base.layers.opportunity);
    expect(run(9, 1, 5).layers.opportunity).not.toEqual(base.layers.opportunity);
  });
});

describe('undeclared preserves the previous behaviour exactly', () => {
  it('produces the identical ranked list when neither field is stated', () => {
    const a = run(9, null, null);
    const b = run(9, undefined, undefined);
    expect(a.pipeline.actionable.map((r) => r.id)).toEqual(b.pipeline.actionable.map((r) => r.id));
    expect(a.pursuitPriority).toEqual(b.pursuitPriority);
  });

  it('holds athleticOutcome NOT_APPLICABLE, so it costs no coverage', () => {
    const rep = run(9, null, null);
    for (const r of rep.pipeline.ranked.slice(0, 20)) expect(r.opportunity.coverage).toBe(1);
  });

  it('is not the same as declaring the midpoint', () => {
    const undeclared = run(9, null, null);
    const midpoint = run(9, 3, 3);
    expect(midpoint.pipeline.actionable.map((r) => r.id))
      .not.toEqual(undeclared.pipeline.actionable.map((r) => r.id));
  });
});

describe('what a declared competitive-level priority does', () => {
  it('moves a strong athlete list toward programmes nearer their own level', () => {
    expect(medianScore(run(9, 5, 1))).toBeGreaterThan(medianScore(run(9, 1, 1)));
  });

  it('moves it further the more they say it matters', () => {
    let prev = -Infinity;
    for (const level of [1, 3, 5]) {
      const m = medianScore(run(9, level, 3));
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });

  it('does it for a semantic reason, not because a division was named', () => {
    // Nothing in the layer reads a division label; the movement is on the
    // calibrated programme-strength percentile.
    const rep = run(9, 5, 1);
    const top = rep.pipeline.actionable[0];
    expect(JSON.stringify(top.opportunity.basis.outcome ?? {})).not.toMatch(/D1|D2|D3|NAIA/);
  });
});

describe('what a declared playing-opportunity priority does', () => {
  it('moves the list toward wider playing pathways', () => {
    const playingFirst = run(9, 1, 5);
    const levelFirst = run(9, 5, 1);
    const share = (rep) => {
      const v = rep.pipeline.actionable.map((r) => r.opportunity.basis.playing?.playingShare).filter(Boolean);
      return v.reduce((a, b) => a + b, 0) / v.length;
    };
    expect(share(playingFirst)).toBeGreaterThan(share(levelFirst));
  });

  it('pulls the opposite way from competitive level on programme strength', () => {
    expect(medianScore(run(9, 1, 5))).toBeLessThanOrEqual(medianScore(run(9, 5, 1)));
  });
});

describe('THE CRITICAL INVARIANT: ambition cannot outrun recruitability', () => {
  it('a developmental athlete declaring maximum ambition gets no elite programme high', () => {
    const rep = run(3, 5, 1);
    const elite = rep.pipeline.actionable.slice(0, 10)
      .filter((r) => typeof r.soccerScore === 'number' && r.soccerScore > 80);
    expect(elite).toHaveLength(0);
  });

  it('their recruitability is unchanged by the declaration', () => {
    expect(run(3, 5, 1).layers.recruitability).toEqual(run(3, null, null).layers.recruitability);
  });

  it('their list barely moves, because the gate still constrains them', () => {
    const ambitious = run(3, 5, 1).pipeline.actionable.map((r) => r.id);
    const plain = run(3, null, null).pipeline.actionable.map((r) => r.id);
    const overlap = ambitious.filter((id) => plain.includes(id)).length;
    expect(overlap).toBeGreaterThanOrEqual(ambitious.length * 0.75);
  });

  it('high ambition alone never lifts an unrecruitable programme into the top of the list', () => {
    const rep = run(3, 5, 1);
    for (const r of rep.pipeline.actionable.slice(0, 10)) {
      expect(r.recruitability.value).toBeGreaterThan(0.05);
    }
  });
});

describe('the two fields are not one slider', () => {
  it('spans two dimensions - both-low and both-high give different lists', () => {
    const lowLow = run(9, 1, 1).pipeline.actionable.map((r) => r.id);
    const highHigh = run(9, 5, 5).pipeline.actionable.map((r) => r.id);
    expect(lowLow).not.toEqual(highHigh);
  });

  it('each axis moves the result with the other held fixed', () => {
    expect(medianScore(run(9, 5, 3))).not.toBe(medianScore(run(9, 1, 3)));
    const share = (rep) => rep.pipeline.actionable
      .map((r) => r.opportunity.basis.playing?.playingShare ?? 0)
      .reduce((a, b) => a + b, 0);
    expect(share(run(9, 3, 5))).not.toBe(share(run(9, 3, 1)));
  });
});

describe('the Pursuit Priority formula itself is untouched', () => {
  it('still applies the same weights and gates whatever the preference', () => {
    for (const [level, playing] of [[null, null], [5, 1], [1, 5]]) {
      const rep = run(9, level, playing);
      const top = rep.pipeline.actionable[0].pursuitPriority.basis;
      expect(top.weights).toEqual({ recruitability: 0.55, financial: 0.25, opportunity: 0.20 });
    }
  });
});
