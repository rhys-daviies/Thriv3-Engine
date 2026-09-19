import { describe, it, expect } from 'vitest';
import { BUDGET_CEILINGS, LEGACY_BUDGET_CEILINGS, UNDECLARED_BUDGET, BUDGET_BANDS } from '../../../shared/matching/constants.js';
import { BUDGET_INTERVALS, LEGACY_BUDGET_INTERVALS, UNDECLARED_BUDGET as V2_UNDECLARED } from '../../../shared/matching/v2/financialRules.js';

/**
 * V2 restates the budget bands rather than importing them, so that frozen V1
 * cannot be moved by a V2 change. The cost of that is drift, and the drift
 * that matters is one-directional: a band the INTAKE FORM offers and V2 cannot
 * read would make every programme unscoreable for that athlete, silently.
 *
 * This test lives here, outside shared/matching/v2, because the import guard
 * forbids a V2 module from reaching into V1 - and this has to read both.
 */
describe('the V2 budget vocabulary against the one the form writes', () => {
  it('reads every band the picker offers', () => {
    for (const band of BUDGET_BANDS) {
      if (band === UNDECLARED_BUDGET) continue;
      expect(BUDGET_INTERVALS[band], `V2 cannot read the band "${band}"`).toBeDefined();
    }
  });

  it('reads every legacy band V1 still accepts', () => {
    for (const band of Object.keys(LEGACY_BUDGET_CEILINGS)) {
      expect(LEGACY_BUDGET_INTERVALS[band], `V2 cannot read the legacy band "${band}"`).toBeDefined();
    }
  });

  it('agrees with V1 on the ceiling of every band', () => {
    for (const [band, ceiling] of Object.entries(BUDGET_CEILINGS)) {
      expect(BUDGET_INTERVALS[band][1], `ceiling of "${band}"`).toBe(ceiling);
    }
    for (const [band, ceiling] of Object.entries(LEGACY_BUDGET_CEILINGS)) {
      expect(LEGACY_BUDGET_INTERVALS[band][1], `ceiling of legacy "${band}"`).toBe(ceiling);
    }
  });

  it('adds the floor V1 discards, which is the reason V2 restates them', () => {
    // V1 knows a family said "at most $25k". V2 also knows they said "at least
    // $20k", and that is the half that sizes a shortfall against their means.
    expect(BUDGET_INTERVALS['$20k-$25k/yr']).toEqual([20000, 25000]);
    expect(BUDGET_CEILINGS['$20k-$25k/yr']).toBe(25000);
  });

  it('calls the deliberate refusal by the same name', () => {
    expect(V2_UNDECLARED).toBe(UNDECLARED_BUDGET);
  });
});
