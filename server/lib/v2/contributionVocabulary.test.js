/**
 * A7.9.5 — V1's restated contribution states against V2's.
 *
 * V1's compatibility bridge restates the three states rather than importing
 * them, because the import guard forbids anything in the live scoring path
 * from reaching into V2 and a temporary bridge is not adoption. The cost of
 * restating is drift, and drift here is silent: a state the intake writes and
 * V1's resolver does not recognise falls to unknown, so an athlete who stated
 * an exact maximum would score as though they had said nothing.
 *
 * This test lives outside both, like budgetVocabulary.test.js beside it, for
 * the same reason: it is the only place allowed to read the two together.
 */
import { describe, it, expect } from 'vitest';
import { CONTRIBUTION_STATES, familyBudgetCeiling } from '../../../shared/matching/constants.js';
import { CONTRIBUTION_STATE, contributionPairError } from '../../../shared/matching/v2/financialRules.js';

describe('the two vocabularies', () => {
  it('name exactly the same three states', () => {
    expect(Object.keys(CONTRIBUTION_STATES).sort()).toEqual(Object.keys(CONTRIBUTION_STATE).sort());
    for (const [k, v] of Object.entries(CONTRIBUTION_STATE)) expect(CONTRIBUTION_STATES[k], k).toBe(v);
  });

  it('resolve every pair V2 accepts to a ceiling V1 can use', () => {
    const pairs = [
      { contributionState: CONTRIBUTION_STATE.STATED, maxAnnualContributionUsd: 0 },
      { contributionState: CONTRIBUTION_STATE.STATED, maxAnnualContributionUsd: 47500 },
      { contributionState: CONTRIBUTION_STATE.NOT_A_CONSTRAINT, maxAnnualContributionUsd: null },
      { contributionState: CONTRIBUTION_STATE.NEEDS_CONFIRMATION, maxAnnualContributionUsd: null },
    ];
    for (const p of pairs) {
      expect(contributionPairError(p), JSON.stringify(p)).toBeNull();
      const ceiling = familyBudgetCeiling(p);
      // STATED must produce a usable number; the other two produce V1's own
      // existing sentinels. None of them may be silently dropped.
      if (p.contributionState === CONTRIBUTION_STATE.STATED) {
        expect(ceiling, JSON.stringify(p)).toBe(p.maxAnnualContributionUsd);
      } else if (p.contributionState === CONTRIBUTION_STATE.NOT_A_CONSTRAINT) {
        expect(ceiling).toBe(Infinity);
      } else {
        expect(ceiling).toBeUndefined();
      }
    }
  });

  it('agree that a malformed pair is malformed', () => {
    const bad = [
      { contributionState: 'STATED', maxAnnualContributionUsd: null },
      { contributionState: 'STATED', maxAnnualContributionUsd: -1 },
      { contributionState: 'NOT_A_CONSTRAINT', maxAnnualContributionUsd: 5 },
      { contributionState: 'NEEDS_CONFIRMATION', maxAnnualContributionUsd: 5 },
      { contributionState: 'WEALTHY', maxAnnualContributionUsd: null },
    ];
    for (const p of bad) {
      expect(contributionPairError(p), `V2 should refuse ${JSON.stringify(p)}`).toBeTruthy();
      expect(familyBudgetCeiling(p), `V1 should not price ${JSON.stringify(p)}`).toBeUndefined();
    }
  });
});
