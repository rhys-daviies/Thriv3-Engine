import { describe, it, expect } from 'vitest';
import { runPursuit } from './pursuitRun.js';
import { buildPositionIndex, buildArrivalIndex, divisionArrivalRates } from './rosterEvidence.js';
import {
  explainProgramme, renderExplanation, explainMovement, largestMovers,
  RANKING_STATE, FORBIDDEN_LANGUAGE, REASON_CODE,
} from '../../../shared/matching/v2/index.js';

const DIVISIONS = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA'];
const colleges = Array.from({ length: 120 }, (_, i) => ({
  id: `c${i}`, name: `College ${String(i).padStart(3, '0')}`,
  division: DIVISIONS[i % DIVISIONS.length], conference: i === 7 ? 'Ivy League' : `Conf ${i % 9}`,
  control: (i % 3 === 0) ? 1 : 2,
  net_price: i === 11 ? null : 6000 + ((i * 397) % 42000),
  tuition_in_state: 9000 + ((i * 97) % 6000), tuition_out_state: 21000 + ((i * 131) % 14000),
  state: ['OH', 'CA', 'TX', 'NY'][i % 4],
  soccer_score: 20 + ((i * 11) % 78),
  recent_win_pct: ((i * 17) % 100) / 100, prior_win_pct: ((i * 29) % 100) / 100,
  notable_majors: '["Business","Kinesiology"]',
}));
const roster = colleges.filter((c) => c.division !== 'NJCAA').flatMap((c, i) =>
  Array.from({ length: 12 }, (_, j) => ({
    college_name: c.name, player_name: `p${i}-${j}`,
    position: ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'][j % 4],
    class_year_label: ['Fr.', 'So.', 'Jr.', 'Sr.', 'Gr.'][(i + j) % 5],
    division: c.division, season: '2026', minutes_played: null,
    projected_minutes: j % 3 === 0 ? 1200 : 100,
  })));
const arrivals = colleges.flatMap((c, i) => Array.from({ length: 10 }, (_, j) => ({
  programme: c.name, sport: 'mens-soccer', arrival_season: '2026',
  canonical_position: ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'][j % 4],
  is_international: (i + j) % 4 === 0 ? 1 : 0,
})));
const ctx = {
  rosterProgrammes: new Set(roster.map((r) => r.college_name)),
  rosterIndex: buildPositionIndex(roster), arrivalIndex: buildArrivalIndex(arrivals),
  divisionArrivals: divisionArrivalRates(arrivals, new Map(colleges.map((c) => [c.name, c]))),
  arrivalsHorizon: 2026,
};
const athlete = (rating = 7, level = null, playing = null) => ({
  label: { id: 'T' },
  v1Shape: { sport: 'mens-soccer', budgetRange: '$20k-$25k/yr', state: 'OH', origin: 'USA' },
  recruitability: { sport: 'mens-soccer', rating, position: 'MIDFIELD', entryYear: 2027, isInternational: false },
  opportunity: {
    sport: 'mens-soccer', position: 'MIDFIELD', rating, intendedMajor: null, priorityRanking: null,
    competitiveLevelPriority: level, playingOpportunityPriority: playing,
  },
});
const run = (rating, level, playing, opts = {}) => runPursuit({
  athlete: athlete(rating, level, playing), sport: 'mens-soccer', colleges, ctx, topN: 30, ...opts,
});

const explainAll = (rep) => {
  const med = rep.pursuitPriority?.median ?? null;
  return [
    ...rep.pipeline.ranked.map((e) => explainProgramme(e, {
      rank: e.rank, outOf: rep.pipeline.ranked.length, poolSize: rep.counts.evaluated, poolMedianPriority: med,
    })),
    ...rep.pipeline.limited.map((e) => explainProgramme(e, { poolMedianPriority: med })),
  ];
};

describe('explaining the whole pipeline changes nothing', () => {
  it('leaves every score, rank and ranking state deep-equal', () => {
    const rep = run(7);
    const snapshot = JSON.stringify(rep.pipeline.ranked.map((e) => ({
      id: e.id, rank: e.rank, state: e.rankingState,
      R: e.recruitability.value, F: e.financial.value, O: e.opportunity.value,
      P: e.pursuitPriority.value,
    })));
    explainAll(rep);
    explainAll(rep);
    expect(JSON.stringify(rep.pipeline.ranked.map((e) => ({
      id: e.id, rank: e.rank, state: e.rankingState,
      R: e.recruitability.value, F: e.financial.value, O: e.opportunity.value,
      P: e.pursuitPriority.value,
    })))).toBe(snapshot);
  });

  it('leaves the top 100 identical', () => {
    const rep = run(7);
    const before = rep.pipeline.actionable.map((e) => e.id);
    explainAll(rep);
    expect(rep.pipeline.actionable.map((e) => e.id)).toEqual(before);
  });

  it('explains every programme in the pool without throwing', () => {
    for (const rating of [3, 6, 9]) {
      for (const [l, p] of [[null, null], [5, 1], [1, 5]]) {
        const rep = run(rating, l, p);
        const all = explainAll(rep);
        expect(all.length).toBe(rep.counts.ranked + rep.counts.limitedData);
        for (const e of all) expect(e.subject.id).toBeTruthy();
      }
    }
  });
});

describe('every rendered line on a real pool', () => {
  const lines = () => {
    const out = [];
    for (const rating of [3, 7, 9]) {
      for (const [l, p] of [[null, null], [5, 1], [1, 5]]) {
        for (const e of explainAll(run(rating, l, p))) out.push(...renderExplanation(e).lines, ...renderExplanation(e).gates);
      }
    }
    return out;
  };

  it('is non-empty and renders without a gap', () => {
    const all = lines();
    expect(all.length).toBeGreaterThan(500);
    for (const l of all) {
      expect(l).toBeTruthy();
      expect(l).not.toMatch(/undefined|NaN|\[object|Infinity|∞/);
    }
  });

  it('never uses forbidden language anywhere in the pool', () => {
    for (const l of lines()) {
      for (const w of FORBIDDEN_LANGUAGE) expect(l.toLowerCase(), `"${l}"`).not.toContain(w);
    }
  });
});

describe('the developmental athlete is never flattered by rank', () => {
  it('warns on absolute strength for the top of a compressed pool', () => {
    const rep = run(3);
    const top = rep.pipeline.ranked[0];
    const e = explainProgramme(top, {
      rank: 1, outOf: rep.counts.ranked, poolSize: rep.counts.evaluated,
      poolMedianPriority: rep.pursuitPriority.median,
    });
    if (rep.pursuitPriority.median < 0.10) {
      expect(e.reasons[0].code).toBe(REASON_CODE.POOL_MOSTLY_OUT_OF_REACH);
    }
    expect(['LOW', 'MODEST', 'ADEQUATE']).toContain(e.standing.absoluteStrength);
  });

  it('a strong athlete top-ranked programme carries no such warning', () => {
    const rep = run(9);
    const e = explainProgramme(rep.pipeline.ranked[0], {
      rank: 1, outOf: rep.counts.ranked, poolMedianPriority: rep.pursuitPriority.median,
    });
    expect(e.standing.rankAloneIsMisleading).toBe(false);
    expect(e.reasons.some((r) => r.code === REASON_CODE.ABSOLUTE_PRIORITY_LOW)).toBe(false);
  });
});

describe('limited data across a real pool', () => {
  const rep = run(7);

  it('never gives a limited-data programme a standing', () => {
    for (const e of rep.pipeline.limited) {
      const ex = explainProgramme(e, { poolMedianPriority: rep.pursuitPriority.median });
      expect(ex.standing).toBeNull();
      expect(ex.subject.rankingState).toBe(RANKING_STATE.LIMITED_DATA);
    }
  });

  it('always says what is missing and what would fix it', () => {
    for (const e of rep.pipeline.limited.slice(0, 10)) {
      const ex = explainProgramme(e, {});
      expect(ex.reasons[0].code).toBe(REASON_CODE.LIMITED_DATA_MISSING_LAYERS);
      expect(ex.reasons[0].evidence.missing.length).toBeGreaterThan(0);
      expect(ex.nextChecks.length).toBeGreaterThan(0);
    }
  });

  it('keeps the layers it did manage to score', () => {
    const withFinance = rep.pipeline.limited.find((e) => e.financial.ok);
    const ex = explainProgramme(withFinance, {});
    expect(ex.layerReasons.financial.length).toBeGreaterThan(0);
  });
});

describe('suppressed and ineligible on a real pool', () => {
  it('explains each by its own cause and neither as a score', () => {
    const rep = run(7, null, null, {
      suppressedIds: new Set(['c1']), ineligible: new Map([['c2', 'division']]),
    });
    const sup = explainProgramme(rep.pipeline.suppressed[0], {});
    const inel = explainProgramme(rep.pipeline.ineligible[0], {});
    expect(sup.reasons[0].code).toBe(REASON_CODE.SUPPRESSED_BY_OPERATOR);
    expect(inel.reasons[0].code).toBe(REASON_CODE.INELIGIBLE_RULE);
    for (const e of [sup, inel]) {
      expect(e.standing).toBeNull();
      expect(e.gateEffects).toEqual([]);
    }
  });
});

describe('movement over a real pool', () => {
  it('produces attributions for the biggest movers without comparing scores', () => {
    const rep = run(7);
    const v1 = new Map(rep.pipeline.ranked.map((e, i) => [e.id, ((i * 53) % 700) + 1]));
    const { rises, falls } = largestMovers(rep.pipeline.ranked, v1);
    for (const m of [...rises, ...falls]) {
      expect(m.comparesScores).toBe(false);
      expect(m.v1Rank).toBeGreaterThan(0);
    }
  });

  it('explains a V1-ranked programme that is now limited data', () => {
    const rep = run(7);
    const e = rep.pipeline.limited[0];
    const m = explainMovement(e, 50, {});
    expect(m.direction).toBe('NOW_LIMITED_DATA');
    expect(m.attributions[0].evidence.missing.length).toBeGreaterThan(0);
  });
});
