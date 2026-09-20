import { describe, it, expect } from 'vitest';
import { pursuitPriority } from './pursuit.js';
import { GRADE, REASON, scoreable, unscoreable, notApplicable } from '../types.js';
import { PURSUIT_WEIGHTS, PURSUIT_GATES, tailGate, smoothstep } from '../pursuitRules.js';

const L = (v, grade = GRADE.MEASURED) => scoreable({ value: v, grade, coverage: 1 });
const P = (R, F, O, opts = {}) => pursuitPriority({
  recruitability: typeof R === 'number' ? L(R) : R,
  financial: typeof F === 'number' ? L(F) : F,
  opportunity: typeof O === 'number' ? L(O) : O,
  ...opts,
});

describe('the product principles, as failure tests', () => {
  it('1. recruitability is dominant - it moves the priority more than either other layer', () => {
    // Holding the others fixed, so this measures dominance rather than the
    // sum of three differences at once.
    const swing = (layer) => {
      const at = (v) => P(
        layer === 'R' ? v : 0.5, layer === 'F' ? v : 0.5, layer === 'O' ? v : 0.5,
      ).value;
      return at(0.9) - at(0.1);
    };
    expect(swing('R')).toBeGreaterThan(swing('F'));
    expect(swing('R')).toBeGreaterThan(swing('O'));
  });

  it('1b. a clearly unrecruitable programme never outranks a recruitable one, whatever else is true', () => {
    expect(P(0.03, 1.00, 1.00).value).toBeLessThan(P(0.50, 0.20, 0.20).value);
  });

  it('1c. but a POOR financial case can overturn a recruitability advantage, deliberately', () => {
    // A programme rated 0.90 on recruitability that a family cannot afford
    // loses to one rated 0.40 that they can. That is principle 2 and principle
    // 6 doing their work, not a failure of principle 1: dominance means
    // recruitability moves the score most, not that it always wins.
    const strongUnaffordable = P(0.90, 0.25, 0.60);
    const weakerAffordable = P(0.40, 0.90, 0.60);
    expect(strongUnaffordable.basis.base).toBeGreaterThan(weakerAffordable.basis.base);
    expect(strongUnaffordable.value).toBeLessThan(weakerAffordable.value);
    expect(strongUnaffordable.basis.financialGateLoss).toBeGreaterThan(0.1);
  });

  it('2. poor finance strongly demotes and never deletes', () => {
    const poor = P(0.85, 0.10, 0.85).value;
    const rich = P(0.85, 0.95, 0.85).value;
    expect(poor).toBeGreaterThan(0);
    expect(poor).toBeLessThan(rich * 0.4);
  });

  it('3. poor opportunity demotes but is not a fatal gate', () => {
    const r = P(0.75, 0.85, 0.05);
    expect(r.value).toBeGreaterThan(0.3);
    expect(r.basis.financialGate).toBe(1);
  });

  it('4. strong fit cannot rescue near-zero recruitability', () => {
    expect(P(0.02, 0.50, 1.00).value).toBeLessThan(0.05);
  });

  it('5. strong finance cannot rescue near-zero recruitability', () => {
    expect(P(0.02, 1.00, 0.50).value).toBeLessThan(0.05);
  });

  it('5b. neither can both together', () => {
    expect(P(0.01, 1.00, 1.00).value).toBeLessThan(0.04);
  });

  it('6. excellent recruitability cannot erase catastrophic finance', () => {
    const catastrophic = P(1.00, 0.00, 1.00);
    expect(catastrophic.value).toBeLessThan(P(1.00, 1.00, 1.00).value * 0.35);
    expect(catastrophic.value).toBeGreaterThan(0);
  });

  it('9. is smooth - a tiny input change never causes a large jump', () => {
    for (const start of [0.0, 0.05, 0.2, 0.24, 0.26, 0.5, 0.9]) {
      const a = P(start, 0.5, 0.5).value;
      const b = P(start + 0.01, 0.5, 0.5).value;
      expect(Math.abs(b - a), `at R=${start}`).toBeLessThan(0.03);
    }
    for (const start of [0.0, 0.3, 0.49, 0.51, 0.9]) {
      const a = P(0.5, start, 0.5).value;
      const b = P(0.5, start + 0.01, 0.5).value;
      expect(Math.abs(b - a), `at F=${start}`).toBeLessThan(0.03);
    }
  });

  it('10. exposes every term an operator would ask about', () => {
    const b = P(0.5, 0.4, 0.6).basis;
    for (const k of ['recruitability', 'financial', 'opportunity', 'base', 'weights',
      'recruitabilityGate', 'financialGate', 'recruitabilityGateLoss', 'financialGateLoss']) {
      expect(b, k).toHaveProperty(k);
    }
  });
});

describe('monotonicity in all three layers', () => {
  it.each(['recruitability', 'financial', 'opportunity'])('increasing %s never lowers the priority', (layer) => {
    let prev = -1;
    for (const v of [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1]) {
      const args = { recruitability: 0.5, financial: 0.5, opportunity: 0.5, [layer]: v };
      const r = P(args.recruitability, args.financial, args.opportunity);
      expect(r.value).toBeGreaterThanOrEqual(prev);
      prev = r.value;
    }
  });

  it('stays inside the unit interval at every corner', () => {
    for (const R of [0, 0.5, 1]) for (const F of [0, 0.5, 1]) for (const O of [0, 0.5, 1]) {
      const v = P(R, F, O).value;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('reaches near the top only when all three are near the top', () => {
    expect(P(1, 1, 1).value).toBeGreaterThan(0.95);
    expect(P(1, 1, 0).value).toBeLessThan(0.85);
  });
});

describe('the gates', () => {
  it('open fully at their threshold and stay open', () => {
    expect(tailGate(0.25, PURSUIT_GATES.recruitability)).toBe(1);
    expect(tailGate(0.9, PURSUIT_GATES.recruitability)).toBe(1);
    expect(tailGate(0.5, PURSUIT_GATES.financial)).toBe(1);
  });

  it('fall to their declared floor at zero', () => {
    expect(tailGate(0, PURSUIT_GATES.recruitability)).toBeCloseTo(0.05, 10);
    expect(tailGate(0, PURSUIT_GATES.financial)).toBeCloseTo(0.30, 10);
  });

  it('constrain recruitability harder than finance, which is the whole design', () => {
    expect(PURSUIT_GATES.recruitability.floor).toBeLessThan(PURSUIT_GATES.financial.floor);
  });

  it('report whether they fired and what they cost', () => {
    const gated = P(0.10, 0.20, 0.5).basis;
    expect(gated.recruitabilityGateFired).toBe(true);
    expect(gated.financialGateFired).toBe(true);
    expect(gated.recruitabilityGateLoss).toBeGreaterThan(0);
    expect(gated.financialGateLoss).toBeGreaterThan(0);

    const open = P(0.60, 0.80, 0.5).basis;
    expect(open.recruitabilityGateFired).toBe(false);
    expect(open.financialGateFired).toBe(false);
    expect(open.recruitabilityGateLoss).toBe(0);
  });

  it('never gate opportunity', () => {
    const b = P(0.5, 0.5, 0.0).basis;
    expect(b).not.toHaveProperty('opportunityGate');
    expect(b.recruitabilityGate * b.financialGate).toBeCloseTo(b.base === 0 ? 0 : P(0.5, 0.5, 0).value / b.base, 10);
  });

  it('smoothstep is continuous at both ends', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(-5)).toBe(0);
    expect(smoothstep(5)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 10);
  });
});

describe('all three layers are required', () => {
  it.each([
    ['recruitability', unscoreable({ reason: REASON.NO_ROSTER_ON_FILE }), 0.5, 0.5],
    ['financial', 0.5, unscoreable({ reason: REASON.NO_COST_BASIS }), 0.5],
    ['opportunity', 0.5, 0.5, unscoreable({ reason: REASON.NO_MINUTES_HISTORY })],
  ])('refuses without %s', (layer, R, F, O) => {
    const r = P(R, F, O);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain(layer);
    expect('value' in r).toBe(false);
  });

  it('records why each missing layer was missing', () => {
    const r = P(unscoreable({ reason: REASON.NO_ELIGIBILITY_RULE }), 0.5, unscoreable({ reason: REASON.NO_MINUTES_HISTORY }));
    expect(r.detail.layerReasons.recruitability).toBe(REASON.NO_ELIGIBILITY_RULE);
    expect(r.detail.layerReasons.opportunity).toBe(REASON.NO_MINUTES_HISTORY);
    expect(r.detail.layerReasons.financial).toBeNull();
    expect(r.coverage).toBeCloseTo(1 / 3, 10);
  });

  it('a NOT_APPLICABLE layer is still a missing layer here', () => {
    // NOT_APPLICABLE removes a COMPONENT from a layer's denominator. A whole
    // layer that does not apply leaves a priority that cannot be compared.
    expect(P(0.5, 0.5, notApplicable({ why: 'test' })).ok).toBe(false);
  });

  it('a measured zero is NOT missing', () => {
    const r = P(0.5, L(0), 0.5);
    expect(r.ok).toBe(true);
    expect(r.basis.financial).toBe(0);
  });
});

describe('the weights', () => {
  it('sum to one, with recruitability holding at least half', () => {
    const { recruitability, financial, opportunity } = PURSUIT_WEIGHTS;
    expect(recruitability + financial + opportunity).toBeCloseTo(1, 10);
    // Dominance is the principle. The ORDER of the other two is not: finance
    // sits below opportunity because it is gated as well as weighted, and
    // carries its force through the gate.
    expect(recruitability).toBeGreaterThanOrEqual(0.5);
    expect(recruitability).toBeGreaterThan(financial + 0.1);
    expect(recruitability).toBeGreaterThan(opportunity + 0.1);
  });

  it('moves the priority more per point of recruitability than of anything else', () => {
    const swing = (layer) => {
      const at = (v) => P(layer === 'R' ? v : 0.5, layer === 'F' ? v : 0.5, layer === 'O' ? v : 0.5).value;
      return at(0.9) - at(0.1);
    };
    expect(swing('R')).toBeGreaterThan(swing('F'));
    expect(swing('R')).toBeGreaterThan(swing('O'));
  });

  it('are overridable, so a sensitivity run needs no second implementation', () => {
    const heavy = P(0.9, 0.2, 0.2, { weights: { recruitability: 0.8, financial: 0.1, opportunity: 0.1 } });
    const light = P(0.9, 0.2, 0.2, { weights: { recruitability: 0.4, financial: 0.3, opportunity: 0.3 } });
    expect(heavy.value).toBeGreaterThan(light.value);
  });
});

describe('the grade', () => {
  it('is PARTIAL when any layer was', () => {
    expect(P(0.5, L(0.5, GRADE.PARTIAL), 0.5).grade).toBe(GRADE.PARTIAL);
    expect(P(0.5, 0.5, 0.5).grade).toBe(GRADE.MEASURED);
  });
});
