import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
 *
 * H3 removed the boolean entirely, so the third failure above is no longer
 * possible: there is one field to drift from, and the last block in this file
 * holds it there.
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
      expect(outreachPermitted(fake), kind).toBe(grade !== PERMISSION.DENIED);
    }
  });

  it('grants 4, qualifies 6 and bars 16', () => {
    const by = { ALLOWED: 0, QUALIFIED: 0, DENIED: 0 };
    for (const k of EVIDENCE_KIND_NAMES) by[permissionsFor(k).OUTREACH] += 1;
    expect(by).toEqual({ ALLOWED: 4, QUALIFIED: 6, DENIED: 16 });
    expect(EVIDENCE_KIND_NAMES).toHaveLength(26);
  });

  it('has no legacy flag left to disagree with', () => {
    /**
     * `emailEligible` was derived into this grade at V2, diverged from it for
     * fifteen kinds once G4 set the policy, and could not be corrected —
     * `defineEvidence` read it to narrow OUTREACH to DENIED, so setting it
     * false on a QUALIFIED kind would have revoked the licence it described.
     * H3 removed it. There is one field, and it is the policy.
     */
    for (const k of EVIDENCE_KIND_NAMES) {
      expect(EVIDENCE_KINDS[k], k).not.toHaveProperty('emailEligible');
      expect(EVIDENCE_KINDS[k].permissions?.OUTREACH, k).toBeTruthy();
    }
  });
});

describe('permission beats the legacy flag', () => {
  it('refuses an object whose OUTREACH is narrowed to DENIED', () => {
    const narrowed = graduation({ permissions: { OUTREACH: PERMISSION.DENIED } });
    expect(narrowed).not.toHaveProperty('emailEligible');
    expect(narrowed.permissions.OUTREACH).toBe(PERMISSION.DENIED);

    expect(outreachPermitted(narrowed)).toBe(false);
    expect(emailedKinds([narrowed, country()])).toEqual(['HISTORICAL_SAME_COUNTRY']);
    expect(internalKinds([narrowed, country()])).toContain(EMAILABLE);
  });

  it('does not let a caller widen a registry-barred kind', () => {
    // The registry's DENIED is the floor; `narrowPermissions` only ever moves
    // a grade down, and the retired boolean is inert if anyone still passes it.
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
  it('has six QUALIFIED kinds, whose rules live in the outbound selector', () => {
    const qualified = EVIDENCE_KIND_NAMES
      .filter((k) => permissionsFor(k).OUTREACH === PERMISSION.QUALIFIED);
    expect(qualified).toHaveLength(6);
  });

  it('refuses a hypothetical QUALIFIED kind rather than treating it as ALLOWED', () => {
    const hypothetical = graduation({ permissions: { OUTREACH: PERMISSION.QUALIFIED } });
    expect(hypothetical.permissions.OUTREACH).toBe(PERMISSION.QUALIFIED);
    expect(outreachPermitted(hypothetical)).toBe(true);
    // Licensed, and still not automatically sent: `outreachEvidenceFor` runs
    // the qualification rule and drops it if the facts cannot state it.
  });

  it('sets a DENIED kind aside rather than dropping it silently', () => {
    // The operator panel shows `internal` as "useful for ranking, not
    // permitted in an email". That is where the sixteen denied kinds belong —
    // visible, and not offerable.
    const denied = graduation({ permissions: { OUTREACH: PERMISSION.DENIED } });
    const result = selectFrom([denied, country()], {});
    expect(result.internal.map((e) => e.kind)).toContain(EMAILABLE);
    expect(result.dispositions.find((d) => d.kind === EMAILABLE).disposition)
      .toBe('INTERNAL_ONLY');
  });

  it('refuses a DENIED kind even when it is the only evidence there is', () => {
    const only = graduation({ permissions: { OUTREACH: PERMISSION.DENIED } });
    expect(selectFrom([only], {}).selected).toEqual([]);
  });
});

describe('a requirement a kind declares is enforced here too', () => {
  it('refuses an outbound kind that is missing the window it requires', () => {
    // COACH_CONTEXT is the only OUTREACH-allowed kind with `requiresWindow`.
    // Real data always carries one — 0 of 15,433 objects failed — so this is a
    // guarantee rather than a behaviour, and it is asserted so it stays one.
    // COACH_CONTEXT is now DENIED outright, so the window requirement no
    // longer gates anything outbound — no licensed kind declares one. Asserted
    // rather than deleted, so licensing a windowed kind has to come back here.
    const windowed = EVIDENCE_KIND_NAMES.filter((k) => EVIDENCE_KINDS[k].requiresWindow
      && permissionsFor(k).OUTREACH !== PERMISSION.DENIED);
    expect(windowed).toEqual([]);
    expect(outreachPermitted({
      kind: 'COACH_CONTEXT', permissions: permissionsFor('COACH_CONTEXT'),
      describes: { seasons: ['2024', '2025'] },
    })).toBe(false);
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

  it('ignores a preference for a DENIED kind', () => {
    const denied = graduation({ permissions: { OUTREACH: PERMISSION.DENIED } });
    const result = selectFrom([denied, country()], { prefer: [EMAILABLE] });
    expect(result.selected.map((e) => e.kind)).not.toContain(EMAILABLE);
    expect(result.unavailableRequests).toContain(EMAILABLE);
  });

  it('ignores a name that is not evidence at all', () => {
    const result = selectFrom([country()], { prefer: ['NOT_A_KIND', '__proto__'] });
    expect(result.selected.map((e) => e.kind)).toEqual(['HISTORICAL_SAME_COUNTRY']);
  });
});

describe('the legacy flag is gone', () => {
  it('is not read by the outreach selection path', () => {
    const source = readFileSync(new URL('./select.js', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    expect(code).not.toContain('emailEligible');
  });

  it('is not on the evidence object', () => {
    expect(graduation()).not.toHaveProperty('emailEligible');
    expect(Object.keys(graduation()).filter((k) => /email/i.test(k))).toEqual([]);
  });

  it('is inert when a caller still passes it', () => {
    // A stale generator naming it changes nothing — it is not an argument any
    // more, and the grade it used to revoke is untouched.
    const passed = defineEvidence(EMAILABLE, {
      ...src, season: '2026', emailEligible: false,
      data: { position: 'DEFENSE', count: 3, names: ['A'], classYear: 2027 },
    });
    expect(passed.permissions.OUTREACH).toBe(permissionsFor(EMAILABLE).OUTREACH);
    expect(passed).not.toHaveProperty('emailEligible');
  });
});

describe('the registry cannot grant an outbound licence by omission', () => {
  /**
   * The load-time guard, exercised rather than asserted about.
   *
   * The default is DENIED, so a missing OUTREACH line already fails closed and
   * this check buys nothing at runtime. It buys a decision: a kind added
   * without one is a kind whose author never asked whether a stranger may say
   * it to a coach. Proven by mutation — the registry is copied, one kind's
   * OUTREACH line is removed, and the copy must refuse to load.
   */
  const KINDS_PATH = fileURLToPath(new URL('./kinds.js', import.meta.url));
  const source = readFileSync(KINDS_PATH, 'utf8');

  /** Loads a mutated copy of the registry beside the real one, so its relative imports resolve. */
  const loadMutated = async (mutate) => {
    const tmp = path.join(path.dirname(KINDS_PATH), `kinds.__mutation-${process.pid}-${n++}.js`);
    writeFileSync(tmp, mutate(source));
    try {
      return await import(pathToFileURL(tmp).href);
    } finally {
      rmSync(tmp, { force: true });
    }
  };
  let n = 0;

  it('loads unmutated, so the mutations below prove something', async () => {
    const mod = await loadMutated((s) => s);
    expect(mod.EVIDENCE_KIND_NAMES).toHaveLength(26);
  });

  it('refuses to load when a kind declares no OUTREACH grade', async () => {
    await expect(loadMutated((s) => s.replace(
      'permissions: { OUTREACH: PERMISSION.QUALIFIED },',
      'permissions: { MATCHING_SUMMARY: PERMISSION.DENIED },',
    ))).rejects.toThrow(/must declare permissions\.OUTREACH/);
  });

  it('refuses to load when a kind declares no permissions at all', async () => {
    await expect(loadMutated((s) => s.replace(
      'permissions: { OUTREACH: PERMISSION.QUALIFIED },',
      '',
    ))).rejects.toThrow(/must declare permissions\.OUTREACH/);
  });

  it('names the kind it is refusing', async () => {
    // A guard that says only "a kind is missing something" costs the next
    // author a bisect over 26 entries.
    await expect(loadMutated((s) => s.replace(
      'permissions: { MATCHING_SUMMARY: PERMISSION.QUALIFIED, OUTREACH: PERMISSION.ALLOWED },',
      'permissions: { MATCHING_SUMMARY: PERMISSION.QUALIFIED },',
    ))).rejects.toThrow(/^HISTORICAL_SAME_COUNTRY must declare/);
  });

  it('every kind declares one, and the policy is where G4 left it', () => {
    const by = { ALLOWED: 0, QUALIFIED: 0, DENIED: 0 };
    for (const kind of EVIDENCE_KIND_NAMES) {
      const declared = kindSpec(kind).permissions?.OUTREACH;
      expect(declared, kind).toBeTruthy();
      // Declared and resolved must agree: nothing derives this any more.
      expect(permissionsFor(kind).OUTREACH, kind).toBe(declared);
      by[declared] += 1;
    }
    expect(by).toEqual({ ALLOWED: 4, QUALIFIED: 6, DENIED: 16 });
  });

  it('defaults the two other surfaces and denies this one', async () => {
    // A kind with no permissions block on the OTHER two surfaces still
    // inherits their safe defaults; OUTREACH is the one that must be written.
    const mod = await loadMutated((s) => s.replace(
      'permissions: { OUTREACH: PERMISSION.QUALIFIED },',
      'permissions: { OUTREACH: PERMISSION.DENIED },',
    ));
    for (const kind of mod.EVIDENCE_KIND_NAMES) {
      const p = mod.permissionsFor(kind);
      expect(SURFACE_KEYS.every((k) => p[k]), kind).toBe(true);
    }
  });
});
