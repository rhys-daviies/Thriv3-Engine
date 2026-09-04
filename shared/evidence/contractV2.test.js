/**
 * Evidence Contract V2 — the structural additions, and the promise that they
 * changed nothing.
 *
 * Migration steps 9.1 and 9.2 add three fields and no behaviour: `permissions`
 * derived from `emailEligible`, and optional `describes` / `comparison` that
 * no kind requires and no renderer reads. The tests worth writing here are
 * therefore mostly about what did NOT move — the caller-narrowing rule, the
 * freeze, and the fact that selection still picks exactly what it picked.
 */

import { describe, it, expect } from 'vitest';
import {
  defineEvidence, permissionsFor, narrowPermissions, PERMISSION, SURFACE_KEYS,
  EVIDENCE_KINDS, EVIDENCE_KIND_NAMES, TIERS,
} from './kinds.js';
import { selectEvidence } from './index.js';

const src = { source: 'roster_players' };
const ev = (kind, opts = {}) => defineEvidence(kind, { ...src, ...opts });

/** A kind that is email-eligible today, so ALLOWED is the registry's grant. */
const EMAILABLE = 'POSITION_GRADUATION';
/** A kind the registry bars from email, so DENIED is the registry's grant. */
const DENIED_KIND = 'TRANSFER_BEHAVIOUR';

describe('surface vocabulary', () => {
  it('names exactly the three surfaces the product recognises', () => {
    expect(SURFACE_KEYS).toEqual(['OPERATOR_EVIDENCE', 'MATCHING_SUMMARY', 'OUTREACH']);
  });

  it('offers three grades, with QUALIFIED between the other two', () => {
    expect(Object.keys(PERMISSION)).toEqual(['ALLOWED', 'QUALIFIED', 'DENIED']);
  });
});

describe('permissions on every evidence object', () => {
  it('gives every kind a grade for every surface, and no surface it invented', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      const p = permissionsFor(kind);
      // Keys checked as a set, not just presence: a kind declaring its own
      // `permissions` with a mistyped surface would otherwise be merged in and
      // silently ignored by every reader, which is the failure mode a registry
      // is supposed to make impossible.
      expect(Object.keys(p).sort(), kind).toEqual([...SURFACE_KEYS].sort());
      for (const surface of SURFACE_KEYS) {
        expect(Object.values(PERMISSION), `${kind}/${surface}`).toContain(p[surface]);
      }
    }
  });

  it('maps emailEligible true to OUTREACH ALLOWED', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      if (!EVIDENCE_KINDS[kind].emailEligible) continue;
      expect(permissionsFor(kind).OUTREACH, kind).toBe(PERMISSION.ALLOWED);
    }
  });

  it('maps emailEligible false to OUTREACH DENIED', () => {
    const denied = EVIDENCE_KIND_NAMES.filter((k) => !EVIDENCE_KINDS[k].emailEligible);
    // Three of them today: POSITION_GROUP_SIZE, POSITION_INTAKE_HISTORY,
    // TRANSFER_BEHAVIOUR. Asserted as non-empty so this cannot pass vacuously
    // if the registry is ever emptied of internal kinds.
    expect(denied.length).toBeGreaterThan(0);
    for (const kind of denied) {
      expect(permissionsFor(kind).OUTREACH, kind).toBe(PERMISSION.DENIED);
    }
  });

  it('lets every existing kind be inspected by an operator', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      expect(permissionsFor(kind).OPERATOR_EVIDENCE, kind).toBe(PERMISSION.ALLOWED);
    }
  });

  it('denies the matching summary to everything until a kind is licensed', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      expect(permissionsFor(kind).MATCHING_SUMMARY, kind).toBe(PERMISSION.DENIED);
    }
  });
});

describe('caller narrowing', () => {
  it('narrows ALLOWED to QUALIFIED', () => {
    const e = ev(EMAILABLE, { permissions: { OUTREACH: PERMISSION.QUALIFIED } });
    expect(e.permissions.OUTREACH).toBe(PERMISSION.QUALIFIED);
  });

  it('narrows ALLOWED to DENIED', () => {
    const e = ev(EMAILABLE, { permissions: { OUTREACH: PERMISSION.DENIED } });
    expect(e.permissions.OUTREACH).toBe(PERMISSION.DENIED);
  });

  it('refuses to promote DENIED to ALLOWED', () => {
    const e = ev(DENIED_KIND, { permissions: { OUTREACH: PERMISSION.ALLOWED } });
    expect(e.permissions.OUTREACH).toBe(PERMISSION.DENIED);
  });

  /**
   * Every grant against every request, including the pairs `defineEvidence`
   * cannot reach today. QUALIFIED is granted by no kind yet, so
   * QUALIFIED -> ALLOWED — the promotion the model exists to forbid — is only
   * testable here, and is the case most likely to be got wrong the day a kind
   * first declares it.
   */
  it.each([
    ['ALLOWED', 'ALLOWED', 'ALLOWED'],
    ['ALLOWED', 'QUALIFIED', 'QUALIFIED'],
    ['ALLOWED', 'DENIED', 'DENIED'],
    ['QUALIFIED', 'ALLOWED', 'QUALIFIED'],
    ['QUALIFIED', 'QUALIFIED', 'QUALIFIED'],
    ['QUALIFIED', 'DENIED', 'DENIED'],
    ['DENIED', 'ALLOWED', 'DENIED'],
    ['DENIED', 'QUALIFIED', 'DENIED'],
    ['DENIED', 'DENIED', 'DENIED'],
  ])('registry %s + caller %s = %s', (granted, requested, expected) => {
    const result = narrowPermissions(
      { OPERATOR_EVIDENCE: PERMISSION.ALLOWED, MATCHING_SUMMARY: PERMISSION.DENIED, OUTREACH: granted },
      { OUTREACH: requested },
    );
    expect(result.OUTREACH).toBe(expected);
  });

  it('leaves surfaces the caller did not mention untouched', () => {
    const granted = {
      OPERATOR_EVIDENCE: PERMISSION.ALLOWED,
      MATCHING_SUMMARY: PERMISSION.QUALIFIED,
      OUTREACH: PERMISSION.ALLOWED,
    };
    const result = narrowPermissions(granted, { OUTREACH: PERMISSION.DENIED });
    expect(result.OPERATOR_EVIDENCE).toBe(PERMISSION.ALLOWED);
    expect(result.MATCHING_SUMMARY).toBe(PERMISSION.QUALIFIED);
  });

  it('returns the grant unchanged when nothing is requested', () => {
    const granted = permissionsFor(EMAILABLE);
    expect(narrowPermissions(granted, null)).toEqual(granted);
  });

  it('refuses to promote MATCHING_SUMMARY, which is DENIED for everything', () => {
    const e = ev(EMAILABLE, { permissions: { MATCHING_SUMMARY: PERMISSION.ALLOWED } });
    expect(e.permissions.MATCHING_SUMMARY).toBe(PERMISSION.DENIED);
  });

  it('narrows OUTREACH when the caller narrows the emailEligible alias', () => {
    // The two say the same thing and must not be able to disagree.
    const e = ev(EMAILABLE, { emailEligible: false });
    expect(e.emailEligible).toBe(false);
    expect(e.permissions.OUTREACH).toBe(PERMISSION.DENIED);
  });

  it('rejects an unknown surface', () => {
    expect(() => ev(EMAILABLE, { permissions: { PRINT: PERMISSION.ALLOWED } }))
      .toThrow(/Unknown evidence surface/);
  });

  it('rejects an unknown grade', () => {
    expect(() => ev(EMAILABLE, { permissions: { OUTREACH: 'MAYBE' } }))
      .toThrow(/Unknown permission/);
  });

  it('rejects a permissions value that is not an object', () => {
    expect(() => ev(EMAILABLE, { permissions: ['OUTREACH'] }))
      .toThrow(/permissions must be an object/);
  });
});

describe('describes', () => {
  const valid = {
    seasons: ['2022', '2023', '2025'],
    seasonsUnread: ['2024'],
    n: 19,
    cohort: { position: 'DEFENSE', origin: 'international' },
  };

  it('accepts a valid window', () => {
    const e = ev(EMAILABLE, { describes: valid });
    expect(e.describes.seasons).toEqual(['2022', '2023', '2025']);
    expect(e.describes.seasonsUnread).toEqual(['2024']);
    expect(e.describes.n).toBe(19);
    expect(e.describes.cohort).toEqual({ position: 'DEFENSE', origin: 'international' });
  });

  it('defaults to null, because no kind requires one yet', () => {
    expect(ev(EMAILABLE).describes).toBeNull();
  });

  it('accepts a window with no unread seasons and no cohort', () => {
    const e = ev(EMAILABLE, { describes: { seasons: ['2025'] } });
    expect(e.describes.seasonsUnread).toEqual([]);
    expect(e.describes.cohort).toBeNull();
    expect(e.describes.n).toBeNull();
  });

  it('refuses a window naming no seasons at all', () => {
    expect(() => ev(EMAILABLE, { describes: { seasons: [], seasonsUnread: [] } }))
      .toThrow(/at least one season/);
  });

  it('refuses seasons that are not a list of strings', () => {
    expect(() => ev(EMAILABLE, { describes: { seasons: '2025' } }))
      .toThrow(/describes.seasons must be an array/);
    expect(() => ev(EMAILABLE, { describes: { seasons: [2025] } }))
      .toThrow(/describes.seasons must be an array/);
  });

  it('refuses an unread-season list that is not a list of strings', () => {
    expect(() => ev(EMAILABLE, { describes: { seasons: ['2025'], seasonsUnread: 'none' } }))
      .toThrow(/seasonsUnread must be an array/);
  });

  it('refuses a non-integer or negative n', () => {
    expect(() => ev(EMAILABLE, { describes: { seasons: ['2025'], n: 3.5 } }))
      .toThrow(/describes.n/);
    expect(() => ev(EMAILABLE, { describes: { seasons: ['2025'], n: -1 } }))
      .toThrow(/describes.n/);
  });

  it('refuses a describes that is not an object', () => {
    expect(() => ev(EMAILABLE, { describes: 'four seasons' })).toThrow(/describes must be an object/);
    expect(() => ev(EMAILABLE, { describes: ['2025'] })).toThrow(/describes must be an object/);
  });
});

describe('comparison', () => {
  const valid = {
    basis: 'division-pool', statistic: 'ladder-rank-1-median', poolSize: 1072, percentile: 75,
  };

  it('accepts a valid comparison', () => {
    const e = ev(EMAILABLE, { comparison: valid });
    expect(e.comparison).toEqual(valid);
  });

  it('defaults to null', () => {
    expect(ev(EMAILABLE).comparison).toBeNull();
  });

  it('requires a basis and a statistic — a benchmark without them names no pool', () => {
    expect(() => ev(EMAILABLE, { comparison: { statistic: 'median' } }))
      .toThrow(/comparison.basis is required/);
    expect(() => ev(EMAILABLE, { comparison: { basis: 'division-pool' } }))
      .toThrow(/comparison.statistic is required/);
  });

  it('refuses a percentile outside 0-100', () => {
    expect(() => ev(EMAILABLE, { comparison: { ...valid, percentile: 140 } }))
      .toThrow(/percentile/);
  });

  it('refuses a non-integer pool size', () => {
    expect(() => ev(EMAILABLE, { comparison: { ...valid, poolSize: 10.5 } }))
      .toThrow(/poolSize/);
  });

  it('refuses a comparison that is not an object', () => {
    expect(() => ev(EMAILABLE, { comparison: 'the pool' })).toThrow(/comparison must be an object/);
  });
});

describe('immutability', () => {
  it('freezes the evidence object', () => {
    const e = ev(EMAILABLE);
    expect(Object.isFrozen(e)).toBe(true);
  });

  it('freezes the nested permissions, as the contract does for data and freshness', () => {
    const e = ev(EMAILABLE);
    expect(Object.isFrozen(e.permissions)).toBe(true);
    expect(() => { 'use strict'; e.permissions.OUTREACH = PERMISSION.ALLOWED; }).toThrow();
  });

  it('freezes describes and its season lists', () => {
    const e = ev(EMAILABLE, { describes: { seasons: ['2025'], seasonsUnread: ['2024'] } });
    expect(Object.isFrozen(e.describes)).toBe(true);
    expect(Object.isFrozen(e.describes.seasons)).toBe(true);
    expect(Object.isFrozen(e.describes.seasonsUnread)).toBe(true);
  });

  it('freezes the cohort', () => {
    const e = ev(EMAILABLE, { describes: { seasons: ['2025'], cohort: { position: 'DEFENSE' } } });
    expect(Object.isFrozen(e.describes.cohort)).toBe(true);
  });

  it('freezes comparison', () => {
    const e = ev(EMAILABLE, {
      comparison: { basis: 'division-pool', statistic: 'median' },
    });
    expect(Object.isFrozen(e.comparison)).toBe(true);
  });

  it('copies the caller\'s arrays rather than holding them', () => {
    const seasons = ['2024', '2025'];
    const e = ev(EMAILABLE, { describes: { seasons } });
    seasons.push('2026');
    expect(e.describes.seasons).toEqual(['2024', '2025']);
  });
});

describe('the registry still owns what it owned', () => {
  it('refuses a tier supplied by the caller', () => {
    const e = defineEvidence('POSITION_GRADUATION_STARTERS', {
      ...src, tier: TIERS.FACT,
    });
    expect(e.tier).toBe(TIERS.SIGNAL);
  });

  it('refuses temporality, category and dedupe group from the caller', () => {
    const spec = EVIDENCE_KINDS[EMAILABLE];
    const e = defineEvidence(EMAILABLE, {
      ...src,
      temporality: 'STATIC', category: 'academic', dedupeGroup: 'nonsense',
    });
    expect(e.temporality).toBe(spec.temporality);
    expect(e.category).toBe(spec.category);
    expect(e.dedupeGroup).toBe(spec.dedupeGroup);
  });

  it('still requires a source', () => {
    expect(() => defineEvidence(EMAILABLE, {})).toThrow(/must declare a source/);
  });

  it('still rejects an unknown confidence', () => {
    expect(() => ev(EMAILABLE, { confidence: 'PROBABLY' })).toThrow(/Unknown confidence/);
  });
});

describe('selection is unchanged by the new fields', () => {
  const athlete = {
    position: 'DEFENSE', nationality: 'New Zealand', country: 'New Zealand',
    recruiting_class_year: 2027, intended_major: null,
  };
  const squad = Array.from({ length: 24 }, (_, i) => ({
    college_name: 'Test', sport: 'mens-soccer', season: '2026',
    player_name: `P${i}`, position: i < 6 ? 'DEFENSE' : 'MIDFIELD',
    estimated_graduation_year: i < 3 ? 2027 : 2029,
    minutes_played: null, projected_minutes: 900,
    country: i < 2 ? 'New Zealand' : null, nationality: i < 2 ? 'International' : 'USA',
  }));
  const ctx = { college: { name: 'Test', sport: 'mens-soccer' }, squad };

  it('selects only evidence whose OUTREACH permission is ALLOWED', () => {
    const result = selectEvidence(athlete, ctx);
    for (const e of result.selected) {
      expect(e.permissions.OUTREACH, e.kind).toBe(PERMISSION.ALLOWED);
    }
  });

  it('keeps permissions and the emailEligible alias in agreement everywhere', () => {
    const result = selectEvidence(athlete, ctx);
    const all = [...result.selected, ...result.internal, ...(result.ranked ?? [])];
    expect(all.length).toBeGreaterThan(0);
    for (const e of all) {
      expect(e.emailEligible, e.kind)
        .toBe(e.permissions.OUTREACH === PERMISSION.ALLOWED);
    }
  });

  it('still refuses to select an internal-only kind', () => {
    const result = selectEvidence(athlete, ctx);
    const internalKinds = EVIDENCE_KIND_NAMES.filter((k) => !EVIDENCE_KINDS[k].emailEligible);
    for (const k of internalKinds) {
      expect(result.selected.map((e) => e.kind), k).not.toContain(k);
    }
  });
});
