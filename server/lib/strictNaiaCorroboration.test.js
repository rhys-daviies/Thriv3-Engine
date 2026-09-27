import { describe, it, expect } from 'vitest';
import { evaluateStrictCorroboration } from './strictNaiaCorroboration.js';

/** PHASE 7B.1 strict corroboration evaluator (Part I/Q). Analysis-only predicate. */
const ok = {
  unitid: 101189, programmeActive: true, coachSport: 'mens-soccer', programmeSport: 'mens-soccer',
  currentness_status: 'CURRENT', domain_status: 'VERIFIED', domain_unitid: 101189,
  email: 'coach@faulkner.edu', email_status: 'verified',
  email_seen_on_source_url: 'https://x/coaches', currentness_source_url: 'https://x/coaches', contradiction: false,
};

describe('evaluateStrictCorroboration', () => {
  it('passes when all nine conditions hold (VERIFIED domain)', () => {
    expect(evaluateStrictCorroboration(ok).corroborated).toBe(true);
  });
  it('7. VERIFIED_ALIAS requires independent institution proof', () => {
    const alias = { ...ok, domain_status: 'VERIFIED_ALIAS' };
    expect(evaluateStrictCorroboration(alias).corroborated).toBe(false);
    expect(evaluateStrictCorroboration(alias).reasons).toContain('ALIAS_NOT_INDEPENDENTLY_PROVEN');
    expect(evaluateStrictCorroboration({ ...alias, aliasIndependentlyProven: true }).corroborated).toBe(true);
  });
  it('8. current authoritative domain UNITID mismatch blocks', () => {
    const r = evaluateStrictCorroboration({ ...ok, domain_unitid: 222222 });
    expect(r.corroborated).toBe(false); expect(r.reasons).toContain('DOMAIN_UNITID_MISMATCH');
  });
  it('domain not verified blocks', () => {
    expect(evaluateStrictCorroboration({ ...ok, domain_status: 'INSUFFICIENT_EVIDENCE', domain_unitid: null }).reasons).toContain('DOMAIN_NOT_VERIFIED');
  });
  it('9. currentness evidence required', () => {
    expect(evaluateStrictCorroboration({ ...ok, currentness_source_url: null }).reasons).toContain('NO_CURRENTNESS_EVIDENCE');
  });
  it('10. email_seen evidence required', () => {
    expect(evaluateStrictCorroboration({ ...ok, email_seen_on_source_url: null }).reasons).toContain('NO_EMAIL_SEEN_EVIDENCE');
  });
  it('currentness must be CURRENT', () => {
    expect(evaluateStrictCorroboration({ ...ok, currentness_status: 'UNKNOWN' }).reasons).toContain('CURRENTNESS_NOT_CURRENT');
  });
  it('11. inferred email prohibited', () => {
    expect(evaluateStrictCorroboration({ ...ok, email_status: 'inferred' }).reasons).toContain('EMAIL_INFERRED');
  });
  it('12. generic email prohibited', () => {
    expect(evaluateStrictCorroboration({ ...ok, email_status: 'generic' }).reasons).toContain('EMAIL_GENERIC');
  });
  it('sport mismatch blocks', () => {
    expect(evaluateStrictCorroboration({ ...ok, coachSport: 'womens-soccer' }).reasons).toContain('SPORT_MISMATCH');
  });
  it('inactive programme blocks', () => {
    expect(evaluateStrictCorroboration({ ...ok, programmeActive: false }).reasons).toContain('PROGRAMME_NOT_ACTIVE');
  });
  it('contradictory evidence blocks', () => {
    expect(evaluateStrictCorroboration({ ...ok, contradiction: true }).reasons).toContain('CONTRADICTORY_EVIDENCE');
  });
  it('redaction token is not a real email', () => {
    expect(evaluateStrictCorroboration({ ...ok, email: 'coach-abc@redacted.invalid' }).reasons).toContain('NO_REAL_EMAIL');
  });
});
