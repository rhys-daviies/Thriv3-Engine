import { describe, it, expect } from 'vitest';
import {
  LEGACY_REPRESENTATIVE, representativeTokens, representativeError, telHref, publicRepresentative,
  signatureState, SIGNATURE,
} from './representative.js';
import { fragmentFor } from './email/blocks.js';
import { BLOCKS } from './evidence/structures.js';
import { buildEmailContext, fillTemplate, DEFAULT_EMAIL_TEMPLATE } from '../src/lib/emailTemplate.js';

const ATHLETE = { full_name: 'Jordan Smith', position: 'CB', sport: 'mens-soccer', recruiting_class_year: 2028 };
const COLLEGE = { name: 'Example College', division: 'NCAA D1' };
const fill = (block, athlete, variant) => fillTemplate(fragmentFor(block, variant), buildEmailContext(athlete, COLLEGE, 'Pat Lee'));

const REP = { id: 'r1', full_name: 'Alex Morgan', email: 'alex@example.test', phone: '+1 (415) 555-0134', title: 'Recruiting consultant', organisation: 'Striv3 Elite Sports Management', active: 1 };

describe('emails with no representative assigned are unchanged', () => {
  // The exact text every email carried before Phase 2, written out literally.
  it('the sign-off', () => {
    expect(fill(BLOCKS.SIGNOFF, ATHLETE)).toBe('Best regards,\nRhys Davies\nStriv3 Elite Sports Management');
  });
  it('the call to action, first email and follow-up', () => {
    expect(fill(BLOCKS.CTA, ATHLETE)).toBe('Would be great to hear your thoughts on Jordan for your 2028 group.'
      + "\n\nIf it's worth a look I'm happy to send over anything else that would help — you can"
      + ' also reach me on WhatsApp [[+64 21 920 775](tel:+6421920775)].');
    expect(fill(BLOCKS.CTA, ATHLETE, 'followUp')).toBe('Would still be great to hear your thoughts on Jordan for your 2028 group.');
  });
  it('a representative record with no name is treated as none', () => {
    expect(fill(BLOCKS.SIGNOFF, { ...ATHLETE, representative: { full_name: ' ' } }))
      .toBe('Best regards,\nRhys Davies\nStriv3 Elite Sports Management');
  });
});

describe('emails for an athlete with a representative', () => {
  it('are signed by the representative and give their number', () => {
    const a = { ...ATHLETE, representative: REP };
    expect(fill(BLOCKS.SIGNOFF, a)).toBe('Best regards,\nAlex Morgan\nStriv3 Elite Sports Management');
    expect(fill(BLOCKS.CTA, a)).toContain('reach me on WhatsApp [[+1 (415) 555-0134](tel:+14155550134)].');
    expect(fill(BLOCKS.CTA, a)).not.toContain('920 775');
  });
  it('a representative with no phone or organisation gets a clean sentence and a two-line sign-off', () => {
    const a = { ...ATHLETE, representative: { ...REP, phone: null, organisation: null } };
    expect(fill(BLOCKS.CTA, a)).toMatch(/anything else that would help\.$/);
    expect(fill(BLOCKS.SIGNOFF, a)).toBe('Best regards,\nAlex Morgan');
  });
  it('never puts a sender, reply-to or cc into the context', () => {
    const ctx = buildEmailContext({ ...ATHLETE, representative: REP }, COLLEGE, 'Pat');
    expect(Object.keys(ctx).filter((k) => /^(from|reply|cc|bcc|sender)/i.test(k))).toEqual([]);
  });
});

describe('the representative record', () => {
  it('exposes only the public fields', () => {
    expect(Object.keys(publicRepresentative({ ...REP, created_by_id: 'op1', password_hash: 'x' })).sort())
      .toEqual(['active', 'email', 'full_name', 'id', 'organisation', 'phone', 'title']);
    expect(publicRepresentative(null)).toBeNull();
  });
  it('builds a dialable tel target', () => {
    expect(telHref('+64 21 920 775')).toBe('+6421920775');
    expect(telHref('(415) 555-0134')).toBe('4155550134');
    expect(telHref('n/a')).toBeNull();
  });
  it('refuses a representative a coach could not reach', () => {
    expect(representativeError({ email: 'a@b.co' })).toMatch(/needs a name/);
    expect(representativeError({ full_name: 'A' })).toMatch(/needs an email/);
    expect(representativeError({ full_name: 'A', email: 'nope' })).toMatch(/not an email/);
    expect(representativeError({ full_name: 'A', email: 'a@b.co', phone: 'call me' })).toMatch(/not a phone/);
    expect(representativeError({ full_name: 'A', email: 'a@b.co', phone: '123' })).toMatch(/too short/);
    expect(representativeError({ full_name: 'A', email: 'a@b.co', phone: '+64 21 920 775' })).toBeNull();
    expect(representativeError({ title: 'Lead' }, { full_name: 'A', email: 'a@b.co' })).toBeNull();
  });
  it('tokens mark whether a representative is assigned', () => {
    expect(representativeTokens(null).representative_assigned).toBe('');
    expect(representativeTokens(null).representative_name).toBe(LEGACY_REPRESENTATIVE.full_name);
    expect(representativeTokens(REP).representative_assigned).toBe('true');
    expect(representativeTokens(REP).representative_email).toBe('alex@example.test');
  });
});

describe('the fallback template (no evidence) is signed the same way', () => {
  const LEGACY_TAIL = "If there's interest you can contact me directly via WhatsApp [[+64 21 920 775](tel:+6421920775)] to chat more."
    + '\n\nBest regards,\nRhys Davies\nStriv3 Elite Sports Management';
  const body = (athlete) => fillTemplate(DEFAULT_EMAIL_TEMPLATE, buildEmailContext(athlete, COLLEGE, 'Pat Lee'));

  it('is unchanged with no representative assigned', () => {
    expect(body(ATHLETE).endsWith(LEGACY_TAIL)).toBe(true);
  });
  it('names the representative, and without a phone asks for a reply instead', () => {
    expect(body({ ...ATHLETE, representative: REP })).toMatch(/\[\[\+1 \(415\) 555-0134\]\(tel:\+14155550134\)\] to chat more\.\n\nBest regards,\nAlex Morgan\nStriv3 Elite Sports Management$/);
    expect(body({ ...ATHLETE, representative: { ...REP, phone: null, organisation: null } }))
      .toMatch(/If there's interest, just reply to this email\.\n\nBest regards,\nAlex Morgan$/);
  });
});

describe('which signature an operator is about to send', () => {
  const legacyBody = fill(BLOCKS.SIGNOFF, ATHLETE);
  const repBody = fill(BLOCKS.SIGNOFF, { ...ATHLETE, representative: REP });

  it('warns LEGACY for an unassigned athlete, before and after composing', () => {
    expect(signatureState({})).toMatchObject({ kind: SIGNATURE.LEGACY, reason: 'UNASSIGNED' });
    expect(signatureState({ body: legacyBody })).toMatchObject({ kind: SIGNATURE.LEGACY, reason: 'UNASSIGNED' });
  });
  it('reads a stored message by its body: written before assignment still says LEGACY', () => {
    expect(signatureState({ representative: REP, body: legacyBody })).toMatchObject({ kind: SIGNATURE.LEGACY, reason: 'COMPOSED_BEFORE_ASSIGNMENT' });
  });
  it('recognises the representative\'s own sign-off, and calls anything else OTHER', () => {
    expect(signatureState({ representative: REP, body: repBody })).toMatchObject({ kind: SIGNATURE.REPRESENTATIVE, name: 'Alex Morgan' });
    expect(signatureState({ representative: REP })).toMatchObject({ kind: SIGNATURE.REPRESENTATIVE });
    expect(signatureState({ representative: REP, body: 'Cheers,\nSomeone else' }).kind).toBe(SIGNATURE.OTHER);
  });
});
