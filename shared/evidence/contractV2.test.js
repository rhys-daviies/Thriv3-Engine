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
  EVIDENCE_KINDS, EVIDENCE_KIND_NAMES, TIERS, assertSurfaceRenderable,
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

  it('declares an OUTREACH grade on every kind, explicitly', () => {
    /**
     * It used to derive one. `defaultPermissions` read a boolean written for a
     * different audience — `emailEligible` — and turned it into a licence,
     * which meant a kind could reach a coach because of a field nobody had
     * reconsidered. H3 retired the boolean; the grade is now written down 26
     * times, and the registry refuses to load without it.
     */
    for (const kind of EVIDENCE_KIND_NAMES) {
      expect(EVIDENCE_KINDS[kind].permissions?.OUTREACH, kind).toBeTruthy();
    }
  });

  it('carries the locked policy: 4 allowed, 5 qualified, 17 denied', () => {
    const by = { ALLOWED: 0, QUALIFIED: 0, DENIED: 0 };
    for (const kind of EVIDENCE_KIND_NAMES) by[permissionsFor(kind).OUTREACH] += 1;
    expect(by).toEqual({ ALLOWED: 4, QUALIFIED: 5, DENIED: 17 });
  });

  it('denies the surfaces a kind says nothing about', () => {
    const denied = EVIDENCE_KIND_NAMES
      .filter((k) => permissionsFor(k).OUTREACH === PERMISSION.DENIED);
    expect(denied).toHaveLength(17);
    for (const kind of denied) {
      expect(permissionsFor(kind).OUTREACH, kind).toBe(PERMISSION.DENIED);
    }
  });

  /**
   * The operator can always see what we know — the grade only says how.
   *
   * Written as "never DENIED" rather than "always ALLOWED" because the second
   * was true only while every kind was a plain fact. The development kinds are
   * measurements over a window and are QUALIFIED: visible, but not without the
   * window they were measured over. Asserting ALLOWED for all would have forced
   * that distinction out of the model to keep a test green.
   */
  it('never hides a kind from the operator', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      expect(permissionsFor(kind).OPERATOR_EVIDENCE, kind).not.toBe(PERMISSION.DENIED);
    }
  });

  /**
   * The 9.1 guarantee, pinned by name so it cannot erode.
   *
   * These 22 were all plainly visible before the permission model existed, and
   * the migration promised to change nothing for them. A later commit demoting
   * one to QUALIFIED would be a real behavioural change and should fail here.
   */
  it('leaves every pre-permissions kind plainly visible to the operator', () => {
    const original = [
      'HISTORICAL_SAME_COUNTRY', 'CURRENT_SAME_COUNTRY',
      'INTERNATIONAL_ROSTER', 'COACH_ARRIVAL_SAME_COUNTRY', 'ARRIVAL_SAME_COUNTRY_POSITION',
      'ARRIVAL_SAME_REGION_POSITION', 'INTERNATIONAL_SHARE', 'POSITION_GRADUATION',
      'POSITION_GRADUATION_STARTERS', 'SQUAD_GRADUATION', 'POSITION_GROUP_SIZE',
      'POSITION_GROUP_SCARCITY', 'RETURNING_POSITION_DEPTH', 'ELIGIBILITY_CLIFF',
      'CONFERENCE_TITLE', 'POSTSEASON_RESULT', 'PROGRAM_MOMENTUM', 'COACH_CONTEXT',
      'ACADEMIC_FIT', 'POSITION_INTAKE_HISTORY', 'TRANSFER_BEHAVIOUR',
    ];
    expect(original).toHaveLength(21);
    for (const kind of original) {
      expect(EVIDENCE_KIND_NAMES, `${kind} should still exist`).toContain(kind);
      expect(permissionsFor(kind).OPERATOR_EVIDENCE, kind).toBe(PERMISSION.ALLOWED);
    }
  });

  it('denies the matching summary to everything not licensed by name', () => {
    /**
     * This asserted DENIED for all 26 until Stage F1 licensed six of them.
     * What it defends is unchanged and is the part that matters: the DEFAULT
     * is still denial, so a kind added tomorrow arrives with no matching
     * licence whatever its `emailEligible` says. The six are granted one at a
     * time in the registry, and `matchingSummary.test.js` states all 26 values.
     */
    const LICENSED = ['COACH_ARRIVAL_SAME_COUNTRY', 'ARRIVAL_SAME_COUNTRY_POSITION',
      'POSITION_GROUP_SCARCITY', 'ARRIVAL_SAME_REGION_POSITION',
      'HISTORICAL_SAME_COUNTRY', 'CURRENT_SAME_COUNTRY'];
    for (const kind of EVIDENCE_KIND_NAMES) {
      if (LICENSED.includes(kind)) continue;
      expect(permissionsFor(kind).MATCHING_SUMMARY, kind).toBe(PERMISSION.DENIED);
    }
  });

  it('still denies the matching summary by default', () => {
    // The grant is per kind and never derived. Asserted through the public
    // lookup on kinds that declare no MATCHING_SUMMARY: email-eligible ones
    // are denied just as firmly as the rest, which is what stops a licence
    // being inherited from the wrong surface.
    const undeclared = EVIDENCE_KIND_NAMES
      .filter((k) => !EVIDENCE_KINDS[k].permissions?.MATCHING_SUMMARY);
    expect(undeclared).toHaveLength(20);
    const outbound = undeclared
      .filter((k) => permissionsFor(k).OUTREACH !== PERMISSION.DENIED);
    expect(outbound.length).toBeGreaterThan(0);
    for (const kind of undeclared) {
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

  it('has no second field a caller could narrow OUTREACH through', () => {
    /**
     * There was one: `emailEligible: false` narrowed OUTREACH to DENIED, so a
     * generator could revoke a licence through a boolean that answered a
     * different question. H3 removed it, and passing it is now inert — the
     * permission is the only route, and `narrowPermissions` is the only rule.
     */
    const e = ev(EMAILABLE, { emailEligible: false });
    expect(e).not.toHaveProperty('emailEligible');
    expect(e.permissions.OUTREACH).toBe(permissionsFor(EMAILABLE).OUTREACH);
    // The real route still works, and still only downward.
    expect(ev(EMAILABLE, { permissions: { OUTREACH: PERMISSION.DENIED } }).permissions.OUTREACH)
      .toBe(PERMISSION.DENIED);
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

  /**
   * Three states, and the default is the humble one.
   *
   * A generator that says nothing about holes has not told us there are none.
   * Defaulting to `[]` would have every silent caller quietly certifying a
   * clean window, which is the reassuring reading of missing provenance this
   * contract exists to refuse.
   */
  it('treats an unstated unread list as UNKNOWN, not as none', () => {
    const e = ev(EMAILABLE, { describes: { seasons: ['2025'] } });
    expect(e.describes.seasonsUnread).toBeNull();
    expect(e.describes.cohort).toBeNull();
    expect(e.describes.n).toBeNull();
  });

  it('distinguishes known-none from known-some from unknown', () => {
    const none = ev(EMAILABLE, { describes: { seasons: ['2025'], seasonsUnread: [] } });
    const some = ev(EMAILABLE, { describes: { seasons: ['2025'], seasonsUnread: ['2024'] } });
    const unknown = ev(EMAILABLE, { describes: { seasons: ['2025'], seasonsUnread: null } });
    expect(none.describes.seasonsUnread).toEqual([]);
    expect(some.describes.seasonsUnread).toEqual(['2024']);
    expect(unknown.describes.seasonsUnread).toBeNull();
  });

  it('refuses an unread list that is neither a season list nor null', () => {
    expect(() => ev(EMAILABLE, { describes: { seasons: ['2025'], seasonsUnread: 'nope' } }))
      .toThrow(/seasonsUnread/);
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

  it('accepts an exact-percentile comparison', () => {
    const e = ev(EMAILABLE, { comparison: valid });
    expect(e.comparison).toEqual({ ...valid, band: null });
  });

  /**
   * The shape the pool benchmark actually needs.
   *
   * `buildPoolBenchmarks` keeps p25/median/p75 and discards the distribution,
   * so a quartile is the most precise true answer available. Before this, the
   * only field for a result was `percentile`, and reporting "above p75" as 90
   * would give a programme one point over the third quartile and the best in
   * the country the same number.
   */
  it('accepts a band-only comparison', () => {
    const e = ev(EMAILABLE, {
      comparison: {
        basis: 'division-pool', statistic: 'ladder-rank-1-median',
        poolSize: 920, band: 'above-p75',
      },
    });
    expect(e.comparison.band).toBe('above-p75');
    expect(e.comparison.percentile).toBeNull();
  });

  it('refuses a comparison that ranks nothing', () => {
    expect(() => ev(EMAILABLE, {
      comparison: { basis: 'division-pool', statistic: 'median', poolSize: 920 },
    })).toThrow(/percentile or a band/);
  });

  it('refuses a band outside the benchmark\'s own vocabulary', () => {
    expect(() => ev(EMAILABLE, {
      comparison: {
        basis: 'division-pool', statistic: 'median', poolSize: 920, band: 'top-quartile',
      },
    })).toThrow(/comparison.band must be one of/);
  });

  it('requires a pool size — "above the pool" means nothing without one', () => {
    expect(() => ev(EMAILABLE, {
      comparison: { basis: 'division-pool', statistic: 'median', percentile: 75 },
    })).toThrow(/poolSize is required/);
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
      comparison: {
        basis: 'division-pool', statistic: 'median', poolSize: 920, percentile: 50,
      },
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

  it('carries no licence field beside the permissions', () => {
    // The object knows its permissions and nothing else about where it may
    // appear. A second field is a second answer to one question.
    const result = selectEvidence(athlete, ctx);
    const all = [...result.selected, ...result.internal, ...(result.ranked ?? [])];
    expect(all.length).toBeGreaterThan(0);
    for (const e of all) {
      expect(e, e.kind).not.toHaveProperty('emailEligible');
      expect(Object.keys(e.permissions).sort()).toEqual(SURFACE_KEYS.slice().sort());
    }
  });

  it('still refuses to select a kind the registry denies', () => {
    const result = selectEvidence(athlete, ctx);
    const denied = EVIDENCE_KIND_NAMES
      .filter((k) => permissionsFor(k).OUTREACH === PERMISSION.DENIED);
    expect(denied).toHaveLength(17);
    for (const k of denied) {
      expect(result.selected.map((e) => e.kind), k).not.toContain(k);
    }
  });
});

/* ------------------------------------------------------------------------- */
/* Stage C hardening — window enforcement and the surface guard              */
/* ------------------------------------------------------------------------- */

describe('requiresWindow', () => {
  const WINDOWED = EVIDENCE_KIND_NAMES.filter((k) => EVIDENCE_KINDS[k].requiresWindow);

  it('is registry-owned and cannot be passed by a caller', () => {
    expect(WINDOWED.length).toBeGreaterThan(0);
    // A generator cannot opt out of its own requirement, the same way it cannot
    // choose its tier.
    const opts = { ...src, requiresWindow: false, describes: null };
    expect(() => defineEvidence(WINDOWED[0], opts)).toThrow(/requiresWindow/);
  });

  it('refuses a required-window kind built without a window', () => {
    for (const kind of WINDOWED) {
      expect(() => ev(kind, {}), kind).toThrow(/must declare `describes`/);
    }
  });

  it('accepts a required-window kind with a usable window', () => {
    for (const kind of WINDOWED) {
      const built = ev(kind, {
        describes: { seasons: ['2024', '2025'], seasonsUnread: [], n: 12 },
        ...(EVIDENCE_KINDS[kind].requiresComparison ? {
          comparison: {
            basis: 'pool', statistic: 'median', poolSize: 900, band: 'above-p75',
          },
        } : {}),
      });
      expect(built.describes.seasons, kind).toEqual(['2024', '2025']);
    }
  });

  it('refuses a window naming no seasons even when the field is present', () => {
    expect(() => ev(WINDOWED[0], { describes: { seasons: [], seasonsUnread: [] } }))
      .toThrow(/at least one season/);
  });

  /**
   * The classification is a judgement about the CLAIM, not about temporality.
   *
   * A count of discrete events is true whatever window it was found in — "two
   * players from New Zealand came through" does not become misleading without
   * its seasons. A rate or a median is a different matter: its denominator IS
   * the window, and stating one without the other invites a reader to hear a
   * property of the programme rather than a measurement of four seasons.
   */
  it('does not simply track temporality', () => {
    const historical = EVIDENCE_KIND_NAMES
      .filter((k) => EVIDENCE_KINDS[k].temporality === 'HISTORICAL');
    const historicalWithout = historical.filter((k) => !EVIDENCE_KINDS[k].requiresWindow);
    expect(historicalWithout.length).toBeGreaterThan(0);
    // And a kind that is not HISTORICAL still requires one, on its semantics.
    expect(EVIDENCE_KINDS.COACH_CONTEXT.temporality).toBe('STATIC');
    expect(EVIDENCE_KINDS.COACH_CONTEXT.requiresWindow).toBe(true);
  });

  it('leaves kinds without the flag buildable with no window at all', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      if (EVIDENCE_KINDS[kind].requiresWindow) continue;
      expect(ev(kind).describes, kind).toBeNull();
    }
  });
});

describe('assertSurfaceRenderable', () => {
  const windowed = () => ev('FRESHMAN_MINUTES_LADDER', {
    describes: { seasons: ['2024', '2025'], seasonsUnread: [], n: 12 },
  });

  it('rejects a surface the evidence is denied', () => {
    expect(() => assertSurfaceRenderable(windowed(), 'OUTREACH'))
      .toThrow(/not permitted on OUTREACH/);
    expect(() => assertSurfaceRenderable(windowed(), 'MATCHING_SUMMARY'))
      .toThrow(/not permitted on MATCHING_SUMMARY/);
  });

  it('accepts an ALLOWED item and returns its grade', () => {
    // POSITION_GRADUATION became QUALIFIED at G4; the four still ALLOWED are
    // the same-country pathway kinds.
    expect(assertSurfaceRenderable(ev('HISTORICAL_SAME_COUNTRY'), 'OUTREACH'))
      .toBe(PERMISSION.ALLOWED);
    expect(assertSurfaceRenderable(ev(EMAILABLE), 'OUTREACH')).toBe(PERMISSION.QUALIFIED);
  });

  it('accepts a QUALIFIED item that carries its window', () => {
    expect(assertSurfaceRenderable(windowed(), 'OPERATOR_EVIDENCE'))
      .toBe(PERMISSION.QUALIFIED);
  });

  it('rejects a required-window item whose window was stripped after construction', () => {
    // `defineEvidence` cannot produce this, which is the point: the guard is
    // the second line, for anything hand-assembled or reshaped downstream.
    const stripped = { ...windowed(), describes: null };
    expect(() => assertSurfaceRenderable(stripped, 'OPERATOR_EVIDENCE'))
      .toThrow(/requires the window it was measured over/);
  });

  it('rejects a required-comparison item without one', () => {
    const bench = ev('PROGRAMME_POOL_BENCHMARK', {
      describes: { seasons: ['2024', '2025'], seasonsUnread: [], n: 12 },
      comparison: { basis: 'pool', statistic: 'median', poolSize: 900, band: 'above-p75' },
    });
    expect(assertSurfaceRenderable(bench, 'OPERATOR_EVIDENCE')).toBe(PERMISSION.QUALIFIED);
    expect(() => assertSurfaceRenderable({ ...bench, comparison: null }, 'OPERATOR_EVIDENCE'))
      .toThrow(/requires its comparison/);
  });

  it('rejects an unknown surface rather than passing it through', () => {
    expect(() => assertSurfaceRenderable(windowed(), 'NEWSLETTER')).toThrow(/Unknown surface/);
  });

  it('renders no prose and mutates nothing', () => {
    const e = windowed();
    const before = JSON.stringify(e);
    const result = assertSurfaceRenderable(e, 'OPERATOR_EVIDENCE');
    expect(JSON.stringify(e)).toBe(before);
    // A grade, not a sentence.
    expect(Object.values(PERMISSION)).toContain(result);
  });
});
