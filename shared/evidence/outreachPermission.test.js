import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { selectFrom, outreachPermitted } from './select.js';
import {
  defineEvidence, permissionsFor, kindSpec, PERMISSION, SURFACE_KEYS,
  EVIDENCE_KINDS, EVIDENCE_KIND_NAMES, CONFIDENCE,
} from './kinds.js';

/**
 * The OUTREACH permission, now that it decides something.
 *
 * Until this suite existed the registry's OUTREACH grade was read by NOTHING.
 * Selection gated on `emailEligible`, a boolean that answers for one audience,
 * and the two agreed for all 26 kinds by construction rather than by
 * enforcement. Three things followed, and this file is about all three:
 *
 *   1. A caller narrowing `permissions.OUTREACH` to DENIED still got an email.
 *   2. A QUALIFIED grade could not have been honoured, because no code path
 *      looked for one — it would have behaved exactly like ALLOWED.
 *   3. Nothing stopped the two from drifting apart in a future edit.
 *
 * THE POINT IS THAT SURFACES CANNOT PROMOTE EACH OTHER. A kind visible to an
 * operator, or licensed for a match card, or flagged emailable by a legacy
 * field, has been granted nothing here. Each surface is asked its own
 * question, and outreach is the strictest of them because its answer leaves
 * the building.
 */

const src = { source: 'roster_players', confidence: CONFIDENCE.HIGH };

/** A kind the registry lets into an email today. */
const EMAILABLE = 'POSITION_GRADUATION';
/** A kind the registry bars from email today. */
const BARRED = 'TRANSFER_BEHAVIOUR';

const graduation = (over = {}) => defineEvidence(EMAILABLE, {
  ...src, season: '2026',
  data: { position: 'DEFENSE', count: 3, names: ['A', 'B', 'C'], classYear: 2027 },
  ...over,
});

const country = (over = {}) => defineEvidence('HISTORICAL_SAME_COUNTRY', {
  ...src, season: '2022-2026',
  describes: { seasons: ['2022', '2023'], seasonsUnread: [], n: 1, cohort: { country: 'New Zealand' } },
  data: { country: 'New Zealand', count: 1, names: ['A'], seasons: ['2022'] },
  ...over,
});

/** What `selectFrom` would put in an email. */
const emailedKinds = (items) => selectFrom(items, {}).selected.map((e) => e.kind);
/** What it set aside as not permitted here. */
const internalKinds = (items) => selectFrom(items, {}).internal.map((e) => e.kind);

// ---------------------------------------------------------------------------

describe('the registry is the gate', () => {
  it('permits exactly the kinds the registry grants ALLOWED', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      const grade = permissionsFor(kind).OUTREACH;
      const spec = kindSpec(kind);
      // A synthetic object standing in for the kind; `requiresWindow` is
      // satisfied so the grade is the only thing under test.
      const fake = {
        kind,
        permissions: permissionsFor(kind),
        describes: spec.requiresWindow ? { seasons: ['2025'] } : null,
        comparison: spec.requiresComparison ? { band: 'ABOVE' } : null,
      };
      expect(outreachPermitted(fake), kind).toBe(grade === PERMISSION.ALLOWED);
    }
  });

  it('grants 19 kinds and bars 7, which is what production reaches today', () => {
    const allowed = EVIDENCE_KIND_NAMES.filter((k) => permissionsFor(k).OUTREACH === PERMISSION.ALLOWED);
    expect(allowed).toHaveLength(19);
    expect(EVIDENCE_KIND_NAMES).toHaveLength(26);
  });

  it('agrees with the legacy flag for every kind — today', () => {
    /**
     * The agreement this step makes ENFORCED rather than accidental.
     *
     * It is asserted so that the day someone changes one without the other,
     * this test says so — rather than the change being discovered as a
     * sentence in a coach's inbox. It is NOT the gate; `outreachPermitted` is.
     */
    for (const kind of EVIDENCE_KIND_NAMES) {
      expect(permissionsFor(kind).OUTREACH === PERMISSION.ALLOWED, kind)
        .toBe(kindSpec(kind).emailEligible === true);
    }
  });
});

describe('permission beats the legacy flag', () => {
  it('refuses an object whose OUTREACH is narrowed to DENIED, flag or no flag', () => {
    // The exact divergence the old gate could not see: `defineEvidence` still
    // reports emailEligible true, because the caller narrowed the surface and
    // not the alias.
    const narrowed = graduation({ permissions: { OUTREACH: PERMISSION.DENIED } });
    expect(narrowed.emailEligible).toBe(true);
    expect(narrowed.permissions.OUTREACH).toBe(PERMISSION.DENIED);

    expect(outreachPermitted(narrowed)).toBe(false);
    expect(emailedKinds([narrowed, country()])).toEqual(['HISTORICAL_SAME_COUNTRY']);
    expect(internalKinds([narrowed, country()])).toContain(EMAILABLE);
  });

  it('does not let the legacy flag rescue a registry-barred kind', () => {
    // `emailEligible: false` on the spec is the registry's own bar, and a
    // caller cannot widen it — narrowing only ever moves down.
    const barred = defineEvidence(BARRED, {
      ...src, season: '2026', emailEligible: true,
      permissions: { OUTREACH: PERMISSION.ALLOWED },
      data: { count: 2, seasons: ['2025'] },
    });
    expect(barred.permissions.OUTREACH).toBe(PERMISSION.DENIED);
    expect(outreachPermitted(barred)).toBe(false);
    expect(emailedKinds([barred, country()])).toEqual(['HISTORICAL_SAME_COUNTRY']);
  });
});

describe('no surface promotes another', () => {
  it('an operator-visible kind is not thereby emailable', () => {
    const barred = defineEvidence(BARRED, {
      ...src, season: '2026', data: { count: 2, seasons: ['2025'] },
    });
    expect(barred.permissions.OPERATOR_EVIDENCE).toBe(PERMISSION.ALLOWED);
    expect(outreachPermitted(barred)).toBe(false);
  });

  it('a match-card kind is not thereby emailable', () => {
    // Constructed the other way round from the real registry: take a kind
    // licensed for the card and deny it outreach. The card's grant must buy
    // nothing here.
    const carded = country({ permissions: { OUTREACH: PERMISSION.DENIED } });
    expect(carded.permissions.MATCHING_SUMMARY).not.toBe(PERMISSION.DENIED);
    expect(outreachPermitted(carded)).toBe(false);
  });

  it('asks only its own surface', () => {
    // Every surface key exists; outreach reads exactly one of them.
    expect(SURFACE_KEYS).toContain('OUTREACH');
    const source = readFileSync(new URL('./select.js', import.meta.url), 'utf8');
    const fn = source.slice(source.indexOf('export function outreachPermitted'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain("'OUTREACH'");
    expect(body).not.toContain('OPERATOR_EVIDENCE');
    expect(body).not.toContain('MATCHING_SUMMARY');
    expect(body).not.toContain('emailEligible');
  });
});

describe('QUALIFIED fails closed until outreach can state a qualification', () => {
  /**
   * There are no QUALIFIED outreach kinds today, so none of this changes
   * behaviour. It exists because the day one is added, the failure mode is
   * silent: the kind would be emailed WITHOUT its caveat, and the email would
   * look exactly like a correct one.
   */
  it('has no QUALIFIED outreach kinds right now', () => {
    const qualified = EVIDENCE_KIND_NAMES
      .filter((k) => permissionsFor(k).OUTREACH === PERMISSION.QUALIFIED);
    expect(qualified).toEqual([]);
  });

  it('refuses a hypothetical QUALIFIED kind rather than treating it as ALLOWED', () => {
    const hypothetical = graduation({ permissions: { OUTREACH: PERMISSION.QUALIFIED } });
    expect(hypothetical.permissions.OUTREACH).toBe(PERMISSION.QUALIFIED);
    // It was emailable a moment ago and is not now — the grade did that, and
    // nothing about the object's own facts changed.
    expect(hypothetical.emailEligible).toBe(true);
    expect(outreachPermitted(hypothetical)).toBe(false);
    expect(emailedKinds([hypothetical, country()])).toEqual(['HISTORICAL_SAME_COUNTRY']);
  });

  it('sets it aside as not-permitted rather than dropping it silently', () => {
    // The operator panel shows `internal` as "useful for ranking, not
    // permitted in an email". A refused QUALIFIED item belongs there, not
    // nowhere.
    const hypothetical = graduation({ permissions: { OUTREACH: PERMISSION.QUALIFIED } });
    const result = selectFrom([hypothetical, country()], {});
    expect(result.internal.map((e) => e.kind)).toContain(EMAILABLE);
    expect(result.dispositions.find((d) => d.kind === EMAILABLE).disposition)
      .toBe('INTERNAL_ONLY');
  });

  it('refuses it even when it is the only evidence there is', () => {
    const only = graduation({ permissions: { OUTREACH: PERMISSION.QUALIFIED } });
    const result = selectFrom([only], {});
    expect(result.selected).toEqual([]);
    expect(result.paragraph).toBeUndefined();   // selectFrom composes nothing
  });
});

describe('a requirement a kind declares is enforced here too', () => {
  it('refuses an outbound kind that is missing the window it requires', () => {
    // COACH_CONTEXT is the only OUTREACH-allowed kind with `requiresWindow`.
    // Real data always carries one — 0 of 15,433 objects failed — so this is a
    // guarantee rather than a behaviour, and it is asserted so it stays one.
    const windowed = EVIDENCE_KIND_NAMES.filter((k) => EVIDENCE_KINDS[k].requiresWindow
      && permissionsFor(k).OUTREACH === PERMISSION.ALLOWED);
    expect(windowed).toEqual(['COACH_CONTEXT']);
    expect(outreachPermitted({
      kind: 'COACH_CONTEXT', permissions: permissionsFor('COACH_CONTEXT'), describes: null,
    })).toBe(false);
    expect(outreachPermitted({
      kind: 'COACH_CONTEXT',
      permissions: permissionsFor('COACH_CONTEXT'),
      describes: { seasons: ['2024', '2025'] },
    })).toBe(true);
  });
});

describe('preference cannot promote what permission refused', () => {
  it('honours a preference among permitted kinds', () => {
    const items = [graduation(), country()];
    expect(selectFrom(items, { prefer: ['HISTORICAL_SAME_COUNTRY'] }).selected.map((e) => e.kind))
      .toEqual(['HISTORICAL_SAME_COUNTRY']);
    expect(selectFrom(items, { prefer: [EMAILABLE] }).selected.map((e) => e.kind))
      .toEqual([EMAILABLE]);
  });

  it('ignores a preference for a kind the permission refused', () => {
    // `prefer` carries kind NAMES and is matched against what survived the
    // gate, so a tampered client naming a denied kind names something that is
    // not in the map.
    const denied = graduation({ permissions: { OUTREACH: PERMISSION.DENIED } });
    const result = selectFrom([denied, country()], { prefer: [EMAILABLE] });
    expect(result.selected.map((e) => e.kind)).not.toContain(EMAILABLE);
    expect(result.unavailableRequests).toContain(EMAILABLE);
    // And it falls back to the engine's own choice rather than sending nothing.
    expect(result.selected.map((e) => e.kind)).toEqual(['HISTORICAL_SAME_COUNTRY']);
  });

  it('ignores a preference for a registry-barred kind', () => {
    const barred = defineEvidence(BARRED, {
      ...src, season: '2026', data: { count: 2, seasons: ['2025'] },
    });
    const result = selectFrom([barred, country()], { prefer: [BARRED] });
    expect(result.selected.map((e) => e.kind)).toEqual(['HISTORICAL_SAME_COUNTRY']);
    expect(result.unavailableRequests).toContain(BARRED);
  });

  it('ignores a preference for a QUALIFIED kind', () => {
    const hypothetical = graduation({ permissions: { OUTREACH: PERMISSION.QUALIFIED } });
    const result = selectFrom([hypothetical, country()], { prefer: [EMAILABLE] });
    expect(result.selected.map((e) => e.kind)).not.toContain(EMAILABLE);
    expect(result.unavailableRequests).toContain(EMAILABLE);
  });

  it('ignores a name that is not evidence at all', () => {
    const result = selectFrom([country()], { prefer: ['NOT_A_KIND', '__proto__'] });
    expect(result.selected.map((e) => e.kind)).toEqual(['HISTORICAL_SAME_COUNTRY']);
  });
});

describe('the legacy flag no longer grants anything', () => {
  it('is not read by the outreach selection path', () => {
    const source = readFileSync(new URL('./select.js', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    expect(code).not.toContain('emailEligible');
  });

  it('is still carried on the object, for the report scripts that describe it', () => {
    // Kept deliberately: `server/scripts/evidenceReport.js` and
    // `recruitingEvidenceReport.js` print it as a label, and removing the
    // field in the same commit that changed the gate would put a cosmetic
    // change inside a parity proof.
    expect(graduation().emailEligible).toBe(true);
  });

  it('is a description now, not a decision', () => {
    // Proof by divergence: an object whose flag and grade disagree follows the
    // GRADE. Before this step it followed the flag.
    const narrowed = graduation({ permissions: { OUTREACH: PERMISSION.DENIED } });
    expect(narrowed.emailEligible).toBe(true);
    expect(emailedKinds([narrowed])).toEqual([]);
  });
});
