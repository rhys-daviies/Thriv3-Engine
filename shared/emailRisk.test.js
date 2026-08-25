import { describe, it, expect } from 'vitest';
import { emailRisk, isRisky, riskCounts, EMAIL_RISK } from './emailRisk.js';

describe('emailRisk', () => {
  it('has nothing to say about an address read off a staff page', () => {
    expect(emailRisk('verified')).toBeNull();
    expect(isRisky('verified')).toBe(false);
  });

  it('warns about the three that are not verified', () => {
    expect(emailRisk('inferred')).toMatchObject({ status: 'inferred', severity: 'high' });
    expect(emailRisk('generic')).toMatchObject({ status: 'generic' });
    expect(emailRisk('unknown')).toMatchObject({ status: 'unknown' });
  });

  it('is case and whitespace insensitive', () => {
    expect(emailRisk(' Inferred ')).toBe(EMAIL_RISK.inferred);
    expect(emailRisk('VERIFIED')).toBeNull();
  });

  // The direction this has to fail in. An address the map has never heard of
  // is unproven; reading it as verified is how you mail 20 addresses nothing
  // has ever checked and call it a clean list.
  it('treats a missing status as unproven, never as verified', () => {
    for (const absent of [undefined, null, '', '   ']) {
      expect(emailRisk(absent)).toBe(EMAIL_RISK.unknown);
      expect(isRisky(absent)).toBe(true);
    }
  });

  it('treats a status it does not recognise as unproven', () => {
    expect(emailRisk('probably-fine')).toBe(EMAIL_RISK.unknown);
  });
});

describe('riskCounts', () => {
  it('counts each status and totals the risky ones', () => {
    expect(riskCounts(['verified', 'verified', 'inferred', 'generic', 'unknown']))
      .toEqual({ verified: 2, inferred: 1, generic: 1, unknown: 1, risky: 3 });
  });

  it('counts an absent status as unknown rather than dropping it', () => {
    expect(riskCounts(['verified', undefined])).toMatchObject({ verified: 1, unknown: 1, risky: 1 });
  });

  it('is empty for an empty list', () => {
    expect(riskCounts()).toEqual({ verified: 0, inferred: 0, generic: 0, unknown: 0, risky: 0 });
  });
});
