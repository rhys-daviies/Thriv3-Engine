import { describe, it, expect } from 'vitest';
import {
  AUTHORITY, PROFILE, LOOKUP, classifyRow, forInstitution,
  hostsForInstitution, inverseIndex, verifiedHostMap,
} from './domainAuthority.js';

/**
 * L7B — the ledger read in the direction it was written, and in the other one.
 *
 * Every fixture below is a real row shape from `athletics_domains`, because the
 * three defects this file exists to fix were all found in real rows and none of
 * them looks wrong in the abstract.
 */

const row = (o) => ({
  domain: 'example.test', unitid: 1, status: 'VERIFIED', role: 'ATHLETICS_SITE',
  confidence: 'CERTAIN', identity_strength: 'WHOLE_NAME', evidence_text: 'Example Athletics',
  wrong_mappings: null, ...o,
});

describe('a strong athletics row is authority', () => {
  it('accepts VERIFIED, athletics, certain, whole-name, with an institution', () => {
    expect(classifyRow(row(), PROFILE.STRICT)).toBe(AUTHORITY.TRUSTED);
    expect(forInstitution(row(), 1, PROFILE.STRICT)).toBe(true);
  });

  it.each([
    ['no institution id', { unitid: null }],
    ['a guess', { status: 'INSUFFICIENT_EVIDENCE' }],
    ['a host that never answered', { status: 'UNREACHABLE' }],
    ['a contested identity', { status: 'AMBIGUOUS' }],
    ['weak confidence', { confidence: 'NONE' }],
    ['the university\'s own site', { role: 'INSTITUTION_SITE', domain: 'example.edu' }],
  ])('refuses %s', (_label, patch) => {
    expect(classifyRow(row(patch), PROFILE.DISCOVERY)).not.toBe(AUTHORITY.TRUSTED);
    expect(forInstitution(row(patch), 1, PROFILE.DISCOVERY)).toBe(false);
  });

  it('is never authority for an institution it does not name', () => {
    expect(forInstitution(row({ unitid: 1 }), 2, PROFILE.DISCOVERY)).toBe(false);
  });
});

/**
 * `uwlathletics.com` carries unitid 240329 and the evidence "University of
 * Wisconsin La Crosse Athletics". Wisconsin-Stevens Point (240480) also claimed
 * it, which is what made the row WRONG_INSTITUTION — and the old reading threw
 * the whole row away, taking La Crosse's true identity with it.
 */
describe('WRONG_INSTITUTION names a wrong claimant, not a wrong host', () => {
  const contested = row({
    domain: 'uwlathletics.com', unitid: 240329, status: 'WRONG_INSTITUTION',
    evidence_text: 'University of Wisconsin La Crosse Athletics',
    wrong_mappings: JSON.stringify([{ key: 'Wisconsin-Stevens Point', claimantUnitid: 240480 }]),
  });

  it('classifies the row as conflicted rather than unidentifiable', () => {
    expect(classifyRow(contested, PROFILE.DISCOVERY)).toBe(AUTHORITY.CONFLICTED);
  });

  it('remains eligible for the institution the page itself named', () => {
    expect(forInstitution(contested, 240329, PROFILE.DISCOVERY)).toBe(true);
  });

  it('stays refused for the claimant that was wrong about it', () => {
    expect(forInstitution(contested, 240480, PROFILE.DISCOVERY)).toBe(false);
  });

  it('stays refused for an unrelated institution', () => {
    expect(forInstitution(contested, 999999, PROFILE.DISCOVERY)).toBe(false);
  });

  it('is refused for everyone under the production profile', () => {
    expect(forInstitution(contested, 240329, PROFILE.STRICT)).toBe(false);
  });

  it('is never rescued on a base-name match, under any profile', () => {
    const weak = { ...contested, identity_strength: 'BASE_ONLY' };
    expect(forInstitution(weak, 240329, PROFILE.DISCOVERY)).toBe(false);
  });

  it('survives a wrong_mappings value it cannot parse', () => {
    const broken = { ...contested, wrong_mappings: '{not json' };
    // Unparseable means "no recorded claimant", not "everyone is a claimant".
    expect(forInstitution(broken, 240329, PROFILE.DISCOVERY)).toBe(true);
  });
});

describe('an athletics property on the institution\'s own domain', () => {
  const carlow = row({
    domain: 'athletics.carlow.edu', unitid: 211431, role: 'INSTITUTION_SITE',
    evidence_text: 'Carlow University',
  });

  it('is accepted for discovery when the host itself is athletics', () => {
    expect(classifyRow(carlow, PROFILE.DISCOVERY)).toBe(AUTHORITY.TRUSTED);
  });

  it.each(['avilaathletics.com', 'athletics.elms.edu', 'go-athletics.test'])(
    'accepts %s', (domain) => {
      expect(classifyRow(row({ domain, role: 'INSTITUTION_SITE' }), PROFILE.DISCOVERY))
        .toBe(AUTHORITY.TRUSTED);
    },
  );

  it.each(['clemson.edu', 'uakron.edu', 'smsu.edu', 'bigred.denison.edu'])(
    'still refuses the plain academic domain %s', (domain) => {
      expect(classifyRow(row({ domain, role: 'INSTITUTION_SITE', evidence_text: 'A University' }),
        PROFILE.DISCOVERY)).not.toBe(AUTHORITY.TRUSTED);
    },
  );

  it('does not promote it on identity the ledger only guessed at', () => {
    expect(classifyRow({ ...carlow, confidence: 'NONE' }, PROFILE.DISCOVERY))
      .toBe(AUTHORITY.INSUFFICIENT_IDENTITY);
  });

  it('is not accepted by the production profile', () => {
    expect(classifyRow(carlow, PROFILE.STRICT)).toBe(AUTHORITY.INSUFFICIENT_IDENTITY);
  });
});

describe('a base-name match is not acquisition authority', () => {
  const base = row({ domain: 'uconnhuskies.com', unitid: 128902, identity_strength: 'BASE_ONLY' });

  it('is quarantined for discovery', () => {
    expect(classifyRow(base, PROFILE.DISCOVERY)).toBe(AUTHORITY.QUARANTINED);
    expect(forInstitution(base, 128902, PROFILE.DISCOVERY)).toBe(false);
  });

  it('never reaches an inverse lookup', () => {
    expect(hostsForInstitution([base], 128902, { profile: PROFILE.DISCOVERY }).status)
      .toBe(LOOKUP.NO_TRUSTED_HOST);
  });

  it('is still inside the production filter, which L7B did not change', () => {
    // Seven of the eight are wrong and `registryIntegrity` refuses all seven
    // downstream; the eighth is Regis (CO) and dropping it would cost a correct
    // operator link. The decision is recorded, not taken here.
    expect(classifyRow(base, PROFILE.STRICT)).toBe(AUTHORITY.TRUSTED);
  });
});

describe('institution to host, with the answer for none and for several', () => {
  const a = row({ domain: 'one.test', unitid: 10 });
  const b = row({ domain: 'two.test', unitid: 10 });
  const other = row({ domain: 'three.test', unitid: 20 });

  it('answers NO_UNITID for a programme with no institution id', () => {
    expect(hostsForInstitution([a], null).status).toBe(LOOKUP.NO_UNITID);
  });

  it('answers NO_TRUSTED_HOST when the ledger holds nothing usable', () => {
    expect(hostsForInstitution([other], 10).status).toBe(LOOKUP.NO_TRUSTED_HOST);
  });

  it('answers with the one host when there is one', () => {
    const r = hostsForInstitution([a, other], 10);
    expect(r.status).toBe(LOOKUP.OK);
    expect(r.hosts).toEqual(['one.test']);
  });

  it('refuses to choose between several', () => {
    const r = hostsForInstitution([a, b], 10);
    expect(r.status).toBe(LOOKUP.AMBIGUOUS);
    expect(r.hosts).toEqual(['one.test', 'two.test']);
  });

  it('collapses www. rather than calling one site two', () => {
    const r = hostsForInstitution([a, row({ domain: 'www.one.test', unitid: 10 })], 10);
    expect(r.status).toBe(LOOKUP.OK);
  });

  it('lets the institution\'s own roster usage settle a multi-host case', () => {
    const r = hostsForInstitution([a, b], 10, { usage: new Set(['two.test']) });
    expect(r.status).toBe(LOOKUP.OK);
    expect(r.hosts).toEqual(['two.test']);
  });

  it('stays ambiguous when usage corroborates both', () => {
    const r = hostsForInstitution([a, b], 10, { usage: new Set(['one.test', 'two.test']) });
    expect(r.status).toBe(LOOKUP.AMBIGUOUS);
  });

  it('gives a men\'s and a women\'s programme the same institution\'s host', () => {
    // The host belongs to the institution. Requiring a row per programme would
    // be duplicating the ledger to express something it never said.
    const index = inverseIndex([a, other]);
    expect(index.get(10).hosts).toEqual(['one.test']);
    expect(index.get(10)).toBe(index.get(10));
  });
});

describe('the production trust map', () => {
  it('holds only rows the strict profile calls trusted', () => {
    const map = verifiedHostMap([
      row({ domain: 'good.test', unitid: 1 }),
      row({ domain: 'guess.test', unitid: 2, status: 'INSUFFICIENT_EVIDENCE' }),
      row({ domain: 'main.test', unitid: 3, role: 'INSTITUTION_SITE' }),
    ], PROFILE.STRICT);
    expect([...map.keys()]).toEqual(['good.test']);
  });
});
