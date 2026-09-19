import { describe, it, expect } from 'vitest';
import { AID_POLICY_STATUS, aidAssumption, assertMayClaimNoAthleticAid } from './aidPolicy.js';

describe('an unknown athletic-aid policy', () => {
  const unknown = aidAssumption({ status: AID_POLICY_STATUS.UNKNOWN });

  it('assumes nothing is awarded, because that can only overstate the cost', () => {
    expect(unknown.assumedFraction).toBe(0);
  });

  it('never becomes a known zero', () => {
    expect(unknown.known).toBe(false);
    expect(unknown.mayClaimNoAthleticAid).toBe(false);
  });

  it('refuses to be rendered as "no athletic scholarships"', () => {
    expect(() => assertMayClaimNoAthleticAid(unknown))
      .toThrow(/Refusing to state that no athletic aid is available/);
  });

  it('cannot name a rule, because naming one is claiming to hold it', () => {
    expect(() => aidAssumption({ status: AID_POLICY_STATUS.UNKNOWN, rule: 'USCAA' }))
      .toThrow(/cannot name a rule/);
  });
});

describe('a rule that really does forbid athletic aid', () => {
  const ivy = aidAssumption({ status: AID_POLICY_STATUS.CONFERENCE_RULE, rule: 'Ivy League' });
  const d3 = aidAssumption({ status: AID_POLICY_STATUS.DIVISION_RULE, rule: 'NCAA D3' });

  it('assumes the same zero as an unknown policy', () => {
    expect(ivy.assumedFraction).toBe(0);
    expect(d3.assumedFraction).toBe(0);
  });

  it('is nevertheless a different object, and that is the whole point', () => {
    const unknown = aidAssumption({ status: AID_POLICY_STATUS.UNKNOWN });
    expect(ivy.assumedFraction).toBe(unknown.assumedFraction);
    expect(ivy.known).not.toBe(unknown.known);
    expect(ivy.mayClaimNoAthleticAid).not.toBe(unknown.mayClaimNoAthleticAid);
  });

  it('may be stated out loud, and names the rule doing the forbidding', () => {
    expect(assertMayClaimNoAthleticAid(ivy)).toBe('Ivy League');
    expect(assertMayClaimNoAthleticAid(d3)).toBe('NCAA D3');
  });

  it('refuses to assert a rule it cannot name', () => {
    expect(() => aidAssumption({ status: AID_POLICY_STATUS.DIVISION_RULE }))
      .toThrow(/must name the rule it is asserting/);
  });
});

describe('an equivalency allowance', () => {
  it('carries the expected share and is known', () => {
    const a = aidAssumption({ status: AID_POLICY_STATUS.EQUIVALENCY, rule: 'NCAA D1', meanFraction: 0.35 });
    expect(a.assumedFraction).toBe(0.35);
    expect(a.known).toBe(true);
  });

  it('never licenses a "no scholarships" sentence, even at a fraction of zero', () => {
    const a = aidAssumption({ status: AID_POLICY_STATUS.EQUIVALENCY, rule: 'NCAA D1', meanFraction: 0 });
    expect(a.mayClaimNoAthleticAid).toBe(false);
    expect(() => assertMayClaimNoAthleticAid(a)).toThrow();
  });

  it('refuses a fraction that is missing or out of range', () => {
    expect(() => aidAssumption({ status: AID_POLICY_STATUS.EQUIVALENCY, rule: 'NCAA D1' })).toThrow(/meanFraction/);
    expect(() => aidAssumption({ status: AID_POLICY_STATUS.EQUIVALENCY, rule: 'NCAA D1', meanFraction: 1.4 })).toThrow(/meanFraction/);
  });
});

describe('the vocabulary itself', () => {
  it('refuses a status it does not know', () => {
    expect(() => aidAssumption({ status: 'PROBABLY_NONE' })).toThrow(/unknown status/);
  });

  it('refuses to license a claim from something that is not an assumption at all', () => {
    expect(() => assertMayClaimNoAthleticAid(null)).toThrow();
    expect(() => assertMayClaimNoAthleticAid({ mayClaimNoAthleticAid: true })).not.toThrow();
  });
});
