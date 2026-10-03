import { describe, it, expect } from 'vitest';
import { explainMovement, largestMovers, MOVEMENT_CODE, MATERIAL_MOVE } from './movement.js';
import { renderMovement } from './render.js';
import { LAYER } from './vocabulary.js';
import { RANKING_STATE, GRADE, REASON, scoreable, unscoreable } from '../types.js';
import { pursuitPriority } from '../layers/pursuit.js';

const L = (v, basis = {}) => scoreable({ value: v, grade: GRADE.MEASURED, coverage: 1, basis });

const entry = (over = {}) => {
  const R = L(over.R ?? 0.6, {
    athleticPlausibility: 0.8, athleticDelta: over.delta ?? 0.05,
    athleticBasis: { rating: 8, athletePercentile: 0.89, programmePercentile: 0.84 },
    core: 0.5, coreBasis: {}, phi: 0.35, ceilingLoss: 0.1,
    positional: { position: 'MIDFIELD', typicalStarters: 5, vacatedStarters: over.vacated ?? 2, contextOnly: {} },
    international: null, internationalApplicable: false,
  });
  const F = L(over.F ?? 0.95, {});
  const O = L(over.O ?? 0.6, { outcome: over.outcome ?? null, notApplicable: [] });
  return {
    id: over.id ?? 'c1', name: over.name ?? 'Test', division: 'NCAA D3',
    recruitability: R, financial: F, opportunity: O,
    rankingState: RANKING_STATE.RANKED, rank: over.rank ?? 10,
    pursuitPriority: pursuitPriority({ recruitability: R, financial: F, opportunity: O }),
  };
};

describe('movement never compares scores', () => {
  it('says so explicitly on every result', () => {
    expect(explainMovement(entry(), 400, { v2Rank: 10 }).comparesScores).toBe(false);
    expect(explainMovement(entry(), null, { v2Rank: 10 }).comparesScores).toBe(false);
  });

  it('carries ranks and a rank delta, and no score delta', () => {
    const m = explainMovement(entry(), 400, { v2Rank: 10 });
    expect(m).toMatchObject({ v1Rank: 400, v2Rank: 10, delta: 390 });
    expect(m).not.toHaveProperty('scoreDelta');
    expect(m).not.toHaveProperty('v1Score');
  });
});

describe('direction', () => {
  it('calls a large improvement a rise and a large drop a fall', () => {
    expect(explainMovement(entry(), 400, { v2Rank: 10 }).direction).toBe(MOVEMENT_CODE.ROSE);
    expect(explainMovement(entry({ R: 0.1, delta: -0.4 }), 10, { v2Rank: 400 }).direction).toBe(MOVEMENT_CODE.FELL);
  });

  it('calls a small move held, and does not explain it', () => {
    const m = explainMovement(entry(), 12, { v2Rank: 10 });
    expect(m.direction).toBe(MOVEMENT_CODE.HELD);
    expect(m.material).toBe(false);
    expect(Math.abs(m.delta)).toBeLessThan(MATERIAL_MOVE);
  });

  it('marks a programme V1 never ranked as new', () => {
    expect(explainMovement(entry(), null, { v2Rank: 10 }).direction).toBe(MOVEMENT_CODE.NEW_TO_LIST);
  });
});

describe('attributions come from V2 evidence only', () => {
  it('attributes a rise to recruitability, an opening, a pathway or affordability', () => {
    const m = explainMovement(entry({ R: 0.6, O: 0.7, F: 0.95, vacated: 3 }), 500, { v2Rank: 5 });
    const codes = m.attributions.map((a) => a.code);
    expect(codes).toContain(MOVEMENT_CODE.ATTRIB_RECRUITABLE);
    expect(codes).toContain(MOVEMENT_CODE.ATTRIB_POSITION_OPENING);
    expect(codes).toContain(MOVEMENT_CODE.ATTRIB_PLAYING_PATHWAY);
    expect(codes).toContain(MOVEMENT_CODE.ATTRIB_AFFORDABLE);
    for (const a of m.attributions) expect(Object.values(LAYER)).toContain(a.layer);
  });

  it('attributes a fall to the gate that fired, with its cost', () => {
    const m = explainMovement(entry({ R: 0.08, delta: -0.4, F: 0.1 }), 40, { v2Rank: 700 });
    const codes = m.attributions.map((a) => a.code);
    expect(codes).toContain(MOVEMENT_CODE.ATTRIB_RECRUITABILITY_GATE);
    expect(codes).toContain(MOVEMENT_CODE.ATTRIB_FINANCIAL_GATE);
    expect(codes).toContain(MOVEMENT_CODE.ATTRIB_ATHLETIC_REACH);
    const gate = m.attributions.find((a) => a.code === MOVEMENT_CODE.ATTRIB_RECRUITABILITY_GATE);
    expect(gate.evidence.loss).toBeGreaterThan(0);
  });

  it('never attributes a move to what V1 was thinking', () => {
    const m = explainMovement(entry({ R: 0.08, delta: -0.4 }), 40, { v2Rank: 700 });
    const text = JSON.stringify(m).toLowerCase();
    for (const w of ['prestige', 'programquality', 'academicfit', 'v1 weight']) expect(text).not.toContain(w);
  });
});

describe('a programme that left the ranked list', () => {
  const limited = {
    id: 'c2', name: 'Junior College', division: 'NJCAA',
    rankingState: RANKING_STATE.LIMITED_DATA,
    recruitability: unscoreable({ reason: REASON.NO_ELIGIBILITY_RULE, missing: ['eligibilityRule'] }),
    financial: L(0.9, {}),
    opportunity: unscoreable({ reason: REASON.NO_MINUTES_HISTORY, missing: ['minutesHistory'] }),
    missingLayers: ['recruitability', 'opportunity'],
    layerReasons: { recruitability: REASON.NO_ELIGIBILITY_RULE, financial: null, opportunity: REASON.NO_MINUTES_HISTORY },
  };

  it('is explained as withheld evidence, not as a low score', () => {
    const m = explainMovement(limited, 62, { v2Rank: null });
    expect(m.direction).toBe(MOVEMENT_CODE.NOW_LIMITED_DATA);
    expect(m.v2Rank).toBeNull();
    expect(m.delta).toBeNull();
    const text = renderMovement(m).toLowerCase();
    expect(text).toMatch(/no longer ranked/);
    expect(text).toMatch(/without evidence/);
    for (const w of ['low', 'poor', 'weak', 'worse']) expect(text).not.toContain(w);
  });

  it('names which layers are missing', () => {
    const m = explainMovement(limited, 62, {});
    expect(m.attributions[0].evidence.missing.sort()).toEqual(['opportunity', 'recruitability']);
  });
});

describe('largestMovers', () => {
  const entries = Array.from({ length: 20 }, (_, i) => entry({ id: `c${i}`, name: `C${i}`, rank: i + 1, R: 0.3 + (i % 5) * 0.1 }));
  const v1 = new Map(entries.map((e, i) => [e.id, (i * 37) % 600]));

  it('returns the five biggest in each direction, ordered', () => {
    const { rises, falls } = largestMovers(entries, v1);
    expect(rises).toHaveLength(5);
    expect(falls).toHaveLength(5);
    for (let i = 1; i < rises.length; i += 1) expect(rises[i - 1].delta).toBeGreaterThanOrEqual(rises[i].delta);
    for (let i = 1; i < falls.length; i += 1) expect(falls[i - 1].delta).toBeLessThanOrEqual(falls[i].delta);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(largestMovers(entries, v1))).toBe(JSON.stringify(largestMovers(entries, v1)));
  });

  it('skips programmes V1 never ranked rather than inventing a delta', () => {
    const { rises } = largestMovers(entries, new Map());
    expect(rises).toHaveLength(0);
  });
});
