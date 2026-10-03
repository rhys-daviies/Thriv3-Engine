import { describe, it, expect } from 'vitest';
import { rankPool } from './pipeline.js';
import { RANKING_STATE, GRADE, REASON, scoreable, unscoreable } from './types.js';

const L = (v) => scoreable({ value: v, grade: GRADE.MEASURED, coverage: 1 });
const missing = (reason) => unscoreable({ reason });

const entry = (i, over = {}) => ({
  id: `c${i}`, name: `College ${String(i).padStart(3, '0')}`, division: 'NCAA D3',
  recruitability: L(0.2 + ((i * 7) % 60) / 100),
  financial: L(0.3 + ((i * 11) % 50) / 100),
  opportunity: L(0.2 + ((i * 13) % 60) / 100),
  ...over,
});

const pool = (n = 200, over = () => ({})) => Array.from({ length: n }, (_, i) => entry(i, over(i)));

describe('the four states', () => {
  const result = rankPool([
    ...pool(50),
    entry(900, { suppressed: true }),
    entry(901, { ineligible: true, ineligibleReason: 'division' }),
    entry(902, { recruitability: missing(REASON.NO_ROSTER_ON_FILE) }),
    // Suppressed AND unscoreable: the person's decision is reported, not the gap.
    entry(903, { suppressed: true, financial: missing(REASON.NO_COST_BASIS) }),
    // Ineligible AND unscoreable: the rule is reported, not the gap.
    entry(904, { ineligible: true, opportunity: missing(REASON.NO_MINUTES_HISTORY) }),
  ]);

  it('puts every programme in exactly one state', () => {
    const { counts } = result;
    expect(counts.ranked + counts.limitedData + counts.ineligible + counts.suppressed).toBe(counts.evaluated);
  });

  it('keeps suppressed and ineligible out of both lists', () => {
    const inLists = [...result.ranked, ...result.limited].map((r) => r.id);
    for (const id of ['c900', 'c901', 'c903', 'c904']) expect(inLists).not.toContain(id);
  });

  it('checks suppression before eligibility, so a person outranks a rule', () => {
    expect(result.suppressed.map((r) => r.id).sort()).toEqual(['c900', 'c903']);
    expect(result.ineligible.map((r) => r.id).sort()).toEqual(['c901', 'c904']);
  });

  it('never gives a suppressed or ineligible programme a priority', () => {
    for (const r of [...result.suppressed, ...result.ineligible]) expect(r.pursuitPriority).toBeNull();
  });

  it('records why a programme was ineligible', () => {
    expect(result.ineligible.find((r) => r.id === 'c901').ineligibleReason).toBe('division');
  });
});

describe('the ranked list', () => {
  const result = rankPool(pool(200));

  it('sorts by priority, descending', () => {
    for (let i = 1; i < result.ranked.length; i += 1) {
      expect(result.ranked[i - 1].pursuitPriority.value).toBeGreaterThanOrEqual(result.ranked[i].pursuitPriority.value);
    }
  });

  it('numbers every ranked programme, not only the actionable ones', () => {
    expect(result.ranked[0].rank).toBe(1);
    expect(result.ranked.at(-1).rank).toBe(result.ranked.length);
  });

  it('applies the top-100 limit AFTER ranking, as an output limit', () => {
    expect(result.counts.ranked).toBe(200);
    expect(result.actionable).toHaveLength(100);
    expect(result.actionable.map((r) => r.rank)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  it('is not a score threshold - the hundredth and hundred-and-first can be close', () => {
    const gap = result.ranked[99].pursuitPriority.value - result.ranked[100].pursuitPriority.value;
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(0.05);
  });

  it('breaks ties deterministically, all the way down to the name', () => {
    const tied = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`, name: `Z${6 - i}`, division: 'NCAA D3',
      recruitability: L(0.5), financial: L(0.5), opportunity: L(0.5),
    }));
    const a = rankPool(tied).ranked.map((r) => r.name);
    const b = rankPool([...tied].reverse()).ranked.map((r) => r.name);
    expect(a).toEqual(b);
    expect(a).toEqual(['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6']);
  });

  it('is deterministic whatever order the pool arrives in', () => {
    const forward = rankPool(pool(200)).ranked.map((r) => r.id);
    const backward = rankPool([...pool(200)].reverse()).ranked.map((r) => r.id);
    expect(forward).toEqual(backward);
  });

  it('honours a smaller output limit without changing the ranking', () => {
    const small = rankPool(pool(200), { topN: 10 });
    expect(small.actionable).toHaveLength(10);
    expect(small.ranked.map((r) => r.id)).toEqual(result.ranked.map((r) => r.id));
  });
});

describe('the limited-data list', () => {
  const result = rankPool([
    ...pool(20),
    entry(800, { recruitability: missing(REASON.NO_ROSTER_ON_FILE) }),
    entry(801, { recruitability: missing(REASON.NO_ELIGIBILITY_RULE), opportunity: missing(REASON.NO_MINUTES_HISTORY) }),
    entry(802, {
      recruitability: missing(REASON.NO_ELIGIBILITY_RULE),
      financial: missing(REASON.NO_COST_BASIS),
      opportunity: missing(REASON.NO_MINUTES_HISTORY),
    }),
  ]);

  it('never receives a pursuit priority - not a zero, not a partial one', () => {
    for (const r of result.limited) {
      expect(r.pursuitPriority).toBeNull();
      expect(r).not.toHaveProperty('rank');
    }
  });

  it('never enters the ranked or actionable list', () => {
    const ids = result.limited.map((r) => r.id);
    for (const id of ids) {
      expect(result.ranked.map((r) => r.id)).not.toContain(id);
      expect(result.actionable.map((r) => r.id)).not.toContain(id);
    }
  });

  it('names which layers are missing and why', () => {
    const one = result.limited.find((r) => r.id === 'c801');
    expect(one.missingLayers.sort()).toEqual(['opportunity', 'recruitability']);
    expect(one.layerReasons.recruitability).toBe(REASON.NO_ELIGIBILITY_RULE);
    expect(one.layerReasons.financial).toBeNull();
  });

  it('keeps every layer output it did manage to produce', () => {
    const one = result.limited.find((r) => r.id === 'c800');
    expect(one.financial.ok).toBe(true);
    expect(one.opportunity.ok).toBe(true);
  });

  it('orders by how much is known, not by how good it looks', () => {
    const order = result.limited.map((r) => r.order.layersKnown);
    for (let i = 1; i < order.length; i += 1) expect(order[i - 1]).toBeGreaterThanOrEqual(order[i]);
    expect(result.limited.at(-1).id).toBe('c802');
  });

  it('does not let a high available score outrank a better-evidenced programme', () => {
    const r = rankPool([
      entry(1, { recruitability: missing(REASON.NO_ROSTER_ON_FILE), financial: L(0.99), opportunity: L(0.99) }),
      entry(2, {
        recruitability: missing(REASON.NO_ROSTER_ON_FILE), financial: missing(REASON.NO_COST_BASIS),
        opportunity: L(1.0),
      }),
    ]);
    expect(r.limited[0].id).toBe('c1');
  });
});

describe('an empty and a trivial pool', () => {
  it('returns empty lists rather than failing', () => {
    const r = rankPool([]);
    expect(r.counts).toMatchObject({ evaluated: 0, ranked: 0, limitedData: 0, actionable: 0 });
    expect(r.actionable).toEqual([]);
  });

  it('does not pad the actionable list to the limit', () => {
    expect(rankPool(pool(7)).actionable).toHaveLength(7);
  });
});

describe('the states are the A7.1 vocabulary', () => {
  it('uses exactly RANKED and LIMITED_DATA for evaluable programmes', () => {
    const r = rankPool([entry(1), entry(2, { financial: missing(REASON.NO_COST_BASIS) })]);
    expect(r.ranked[0].rankingState).toBe(RANKING_STATE.RANKED);
    expect(r.limited[0].rankingState).toBe(RANKING_STATE.LIMITED_DATA);
  });
});
