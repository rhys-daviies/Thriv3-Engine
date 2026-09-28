/**
 * A hold has to do two things, and the second is the one that gets forgotten:
 * it must actually suspend the domain's authority, and it must not touch
 * anything else. A hold that quietly degraded resolution for unrelated
 * institutions would be a worse defect than the ambiguity it was hiding.
 *
 * `stmarytx.edu` is stored VERIFIED_ALIAS at 123554 while claiming both 123554
 * and 228149, so the resolver trusted it at 0.99 and five coach rows are filed
 * at one of two institutions nobody has externally decided between. It is held
 * rather than repaired because the name is suggestive, and Phase 2A is what
 * happens when suggestive is treated as evidence.
 */
import { describe, it, expect } from 'vitest';
import { isHeldDomain, heldAdjudication, HELD_DOMAIN_ADJUDICATIONS } from './heldDomainAdjudications.js';
import { createResolver, DECISION } from '../server/lib/institutionResolver.js';

const colleges = [
  { name: "Saint Mary's", sport: 'mens-soccer', unitid: 123554, state: 'CA', division: 'NCAA D1' },
  { name: "St. Mary's (TX)", sport: 'mens-soccer', unitid: 228149, state: 'TX', division: 'NCAA D2' },
  { name: 'Huntingdon', sport: 'mens-soccer', unitid: 101435, state: 'AL', division: 'NCAA D3' },
];
const domains = [
  { domain: 'stmarytx.edu', unitid: 123554, status: 'VERIFIED_ALIAS', claimed_unitids: '[123554,228149]' },
  { domain: 'huntingdonhawks.com', unitid: 101435, status: 'VERIFIED', claimed_unitids: '[101435]' },
];
const resolve = (name, opts) => createResolver({ colleges, domains, aliases: [] }).resolve(name, { sport: 'mens-soccer', ...opts });

describe('the register itself', () => {
  it('holds stmarytx.edu, and says what is disputed and what would settle it', () => {
    expect(isHeldDomain('stmarytx.edu')).toBe(true);
    const h = heldAdjudication('WWW.StMaryTX.edu'); // case and www must not matter
    expect(h.disputed_between).toEqual([123554, 228149]);
    expect(h.resolves_when.length).toBeGreaterThan(0);
  });

  it('requires every entry to carry evidence and an exit condition', () => {
    for (const h of HELD_DOMAIN_ADJUDICATIONS) {
      expect(h.observed.length, h.domain).toBeGreaterThan(40);
      expect(h.why_held.length, h.domain).toBeGreaterThan(40);
      expect(h.resolves_when.length, h.domain).toBeGreaterThan(20);
      expect(Array.isArray(h.disputed_between) && h.disputed_between.length >= 2, h.domain).toBe(true);
    }
  });

  it('is frozen — a hold is not something code edits at runtime', () => {
    expect(Object.isFrozen(HELD_DOMAIN_ADJUDICATIONS)).toBe(true);
  });
});

describe('the suspension has teeth', () => {
  it('a held domain no longer resolves an institution on its own', () => {
    const r = resolve('a name matching nothing', { sourceUrl: 'https://stmarytx.edu/staff' });
    expect(r.decision).not.toBe(DECISION.RESOLVED);
  });

  it('and cannot do it through an email address either', () => {
    const r = resolve('a name matching nothing', { email: 'someone@stmarytx.edu' });
    expect(r.decision).not.toBe(DECISION.RESOLVED);
  });

  it('so it cannot file a coach at either disputed institution', () => {
    for (const via of [{ sourceUrl: 'https://stmarytx.edu/x' }, { email: 'a@stmarytx.edu' }]) {
      const r = resolve('unmatchable', via);
      expect([123554, 228149]).not.toContain(r.unitid);
    }
  });
});

describe('the hold does not spread', () => {
  it('an unheld domain still resolves normally', () => {
    const r = resolve('a name matching nothing', { sourceUrl: 'https://huntingdonhawks.com/staff' });
    expect(r.decision).toBe(DECISION.RESOLVED);
    expect(r.unitid).toBe(101435);
  });

  it('both disputed institutions remain resolvable by their own names', () => {
    // The QUESTION is about a domain. The institutions are not in doubt and
    // must not be collateral damage.
    expect(resolve("Saint Mary's").unitid).toBe(123554);
    expect(resolve("St. Mary's (TX)").unitid).toBe(228149);
  });

  it('holding is exact — a lookalike domain is not held', () => {
    expect(isHeldDomain('stmarytx.edu.evil.com')).toBe(false);
    expect(isHeldDomain('notstmarytx.edu')).toBe(false);
    expect(isHeldDomain('')).toBe(false);
    expect(isHeldDomain(null)).toBe(false);
  });
});
