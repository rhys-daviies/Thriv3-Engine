/**
 * =============================================================================
 * A8.0B — THE COVERAGE EXTENSION'S OWN INVARIANTS.
 *
 * The sixteen A8.0 structural tests already run against this artifact -
 * `a8Baseline.test.js` is parameterised over both, so S0-S15 hold here without
 * a second copy. What is left is everything specific to an EXTENSION: that it
 * did not disturb what it extends, and that each controlled arm is actually
 * controlled.
 *
 * The second of those is the one that matters. An arm is only evidence about
 * one variable if it differs in one variable, and "I only changed the major"
 * is exactly the kind of claim that is true when written and false three
 * edits later. So it is asserted field by field rather than trusted.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodeBaseline } from './a8Baseline.js';
import { groupCells, buildArms } from './a8Extension.js';
import { FIXTURES } from './v2Fixtures.js';
import { VALIDATION_FIXTURES } from './v2ValidationFixtures.js';
import { COVERAGE_FIXTURE, MAJOR_ARMS, FINANCIAL_PATCHES, ENTRY_YEARS } from './a8CoverageFixtures.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
/**
 * Same reason as A8_BASELINE_FILE: these assertions are only worth having if
 * they have been seen to fail against a deliberately broken artifact.
 */
const extFile = (process.env.A8_EXTENSION_FILE ?? '').trim() || 'docs/validation/A8.0B-extension.json';
const ext = JSON.parse(fs.readFileSync(path.isAbsolute(extFile) ? extFile : path.join(root, extFile), 'utf8'));
const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const byArm = groupCells(ext);
const cmp = (arm) => ext.comparisons.find((c) => c.arm === arm);

/** The A8.0 baseline, as frozen. Read for its digest only. */
const A8_0_DIGEST = '78db6413ead4baf82b6e86b49aebaf9cef8bd59befa8185fb7a5388f798a41f8';

describe('A8.0B: what the extension must not have disturbed', () => {
  it('E0. the A8.0 baseline artifact is byte-for-byte the one that was frozen', () => {
    const base = read('docs/validation/A8.0-baseline.json');
    expect(base.cellDigest).toBe(A8_0_DIGEST);
    expect(sha(base.cells)).toBe(A8_0_DIGEST);
    expect(ext.extensionOfDigest).toBe(A8_0_DIGEST);
  });

  /**
   * The eight reference athletes and the two A8.0 validation athletes, pinned
   * by hash. A8.0B is forbidden from touching them, and the cheapest way for
   * that to go wrong is for somebody to add the new athlete to the file the
   * baseline already reads.
   */
  it('E1. A-H and the A8.0 validation athletes are unchanged', () => {
    expect(sha(FIXTURES)).toBe('8b141026a5081c8f87f3d612ff211e5a169d8de665d2f76daa94b0728a3a939a');
    expect(sha(VALIDATION_FIXTURES)).toBe('e96b1283277c8ac40a43c924b983320e8c973ddcd4f86f02c430c6296a7ba1f7');
    expect(FIXTURES).toHaveLength(8);
    expect(VALIDATION_FIXTURES).toHaveLength(2);
    /** The new athlete must not have been smuggled into either frozen set. */
    for (const f of [...FIXTURES, ...VALIDATION_FIXTURES]) {
      expect(f.id).not.toBe(COVERAGE_FIXTURE.id);
      expect(f.player.intended_major ?? null).toBe(null);
    }
  });

  it('E2. the coverage fixture is declared synthetic and carries no person', () => {
    expect(COVERAGE_FIXTURE.synthetic).toBe(true);
    expect(COVERAGE_FIXTURE.validationOnly).toBe(true);
    const banned = ['email', 'phone', 'date_of_birth', 'dob', 'address', 'last_name', 'first_name', 'parent'];
    for (const k of Object.keys(COVERAGE_FIXTURE.player)) {
      expect(banned, k).not.toContain(k.toLowerCase());
    }
  });

  it('E3. no person-level field reached the extension artifact', () => {
    expect(/player_name|"email"|hometown|date_of_birth|phone/i.test(JSON.stringify(ext))).toBe(false);
  });
});

describe('A8.0B: every arm varies exactly one thing', () => {
  const arms = buildArms();
  const armsById = new Map(arms.map((a) => [a.id, a]));
  const baseOf = {
    MAJOR: COVERAGE_FIXTURE.player,
    FINANCIAL: VALIDATION_FIXTURES.find((f) => f.id === 'V-WMID-womens').player,
    ENTRY_YEAR: VALIDATION_FIXTURES.find((f) => f.id === 'V-ELITE-mens').player,
  };

  it('E4. an arm differs from its base only in the fields it declares', () => {
    for (const a of arms) {
      const base = baseOf[a.family];
      const keys = new Set([...Object.keys(base), ...Object.keys(a.player)]);
      const differing = [...keys].filter((k) => (base[k] ?? null) !== (a.player[k] ?? null)).sort();
      expect(differing.every((k) => a.differsBy.includes(k)), `${a.id}: ${differing.join(',')}`).toBe(true);
    }
  });

  it('E5. the major counterfactual differs ONLY in intended_major', () => {
    const [declared, nulled] = MAJOR_ARMS;
    const keys = new Set([...Object.keys(declared.player), ...Object.keys(nulled.player)]);
    const differing = [...keys].filter((k) => (declared.player[k] ?? null) !== (nulled.player[k] ?? null));
    expect(differing).toEqual(['intended_major']);
    expect(nulled.player.intended_major ?? null).toBe(null);
    expect(declared.player.intended_major).toBe('exercise science');
  });

  it('E6. the financial arms differ ONLY in financial fields', () => {
    const FIN = ['budget_range', 'contribution_state', 'max_annual_contribution_usd'];
    const base = baseOf.FINANCIAL;
    for (const f of FINANCIAL_PATCHES) {
      const a = armsById.get(`V-WMID-${f.id}`);
      const differing = [...new Set([...Object.keys(base), ...Object.keys(a.player)])]
        .filter((k) => (base[k] ?? null) !== (a.player[k] ?? null));
      expect(differing.every((k) => FIN.includes(k)), `${a.id}: ${differing.join(',')}`).toBe(true);
    }
  });

  it('E7. the entry-year arms differ ONLY in recruiting_class_year', () => {
    const base = baseOf.ENTRY_YEAR;
    for (const y of ENTRY_YEARS) {
      const a = armsById.get(`V-ELITE-${y.id}`);
      const differing = [...new Set([...Object.keys(base), ...Object.keys(a.player)])]
        .filter((k) => (base[k] ?? null) !== (a.player[k] ?? null));
      expect(differing).toEqual(y.year === 2028 ? [] : ['recruiting_class_year']);
    }
  });
});

describe('A8.0B: majorFit behaves as its frozen contract says', () => {
  it('M1. a declared major exercises all three evidence cases', () => {
    const rows = byArm.get('X-declared-major').filter((r) => r.universe === 'SUPPORTED');
    const matched = rows.filter((r) => r.majorFit.state === 'SCOREABLE' && r.majorFit.value === 1);
    const unmatched = rows.filter((r) => r.majorFit.state === 'SCOREABLE' && r.majorFit.value === 0);
    const noEvidence = rows.filter((r) => r.majorFit.state === 'UNSCOREABLE');
    expect(matched.length).toBeGreaterThan(100);
    expect(unmatched.length).toBeGreaterThan(100);
    expect(noEvidence.length).toBeGreaterThan(0);
    for (const r of noEvidence) expect(r.majorFit.reason).toBe('NO_PROGRAMME_MAJOR_EVIDENCE');
  });

  it('M2. an undeclared major is NOT_APPLICABLE and never a score of zero', () => {
    for (const r of byArm.get('X-null-major')) {
      expect(['NOT_APPLICABLE', 'LAYER_UNSCOREABLE']).toContain(r.majorFit.state);
      expect(r.majorFit.value ?? null, r.programme).toBe(null);
    }
  });

  it('M3. declaring a major changes Recruitability and Financial in NO cell', () => {
    const c = cmp('X-null-major');
    expect(c.unrelatedChanged).toEqual({ recruitability: 0, financial: 0 });
  });

  it('M4. it does move Opportunity and Pursuit - through the component that owns it', () => {
    const c = cmp('X-null-major');
    expect(c.opportunityChanged).toBeGreaterThan(0);
    expect(c.pursuitChanged).toBeGreaterThan(0);
  });
});

describe('A8.0B: the financial states follow the frozen semantics', () => {
  const sup = (id) => byArm.get(id).filter((r) => r.universe === 'SUPPORTED');

  /**
   * Over EVERY cell, not only the supported universe. Financial reads a cost
   * and a contribution and never an eligibility rule, so "no answer does not
   * become zero" has to hold for a junior college too - and an earlier draft
   * of this test, scoped to the supported universe, did not fail when a
   * zero was planted in an unsupported cell.
   */
  it('F1. an unanswered contribution refuses - it never becomes a score of zero', () => {
    for (const id of ['V-WMID-F-undeclared', 'V-WMID-F-needs-confirmation']) {
      const rows = byArm.get(id);
      const scored = rows.filter((r) => r.financial.state === 'SCOREABLE');
      expect(scored, id).toHaveLength(0);
      for (const r of rows) expect(r.financial.value ?? null, `${id}/${r.programme}`).toBe(null);
      expect(rows.some((r) => r.financial.reason === 'NO_FAMILY_CONTRIBUTION'), id).toBe(true);
    }
  });

  it('F2. NOT_A_CONSTRAINT is the absence of a limit, not a large number', () => {
    const rows = sup('V-WMID-F-not-a-constraint').filter((r) => r.financial.state === 'SCOREABLE');
    expect(rows.length).toBeGreaterThan(1000);
    /** Uniformly 1: nothing is priced out, and no synthetic budget was invented. */
    for (const r of rows) expect(r.financial.value, r.programme).toBe(1);
  });

  it('F3. a stated contribution prices the pool, and a larger one binds less often', () => {
    const at = (id) => sup(id).filter((r) => r.financial.state === 'SCOREABLE').map((r) => r.financial.value);
    const small = at('V-WMID-F-stated-10k');
    const large = at('V-WMID-F-stated-40k');
    const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
    expect(mean(small)).toBeLessThan(mean(large));
    expect(Math.min(...small)).toBeGreaterThan(0);
  });

  it('F4. changing the contribution changes Recruitability and Opportunity in NO cell', () => {
    for (const f of FINANCIAL_PATCHES.slice(1)) {
      const c = cmp(`V-WMID-${f.id}`);
      expect(c.unrelatedChanged, f.id).toEqual({ recruitability: 0, opportunity: 0 });
    }
  });
});

describe('A8.0B: the A7.37 horizon boundary', () => {
  const measured = (id) => byArm.get(id)
    .filter((r) => r.playingPathway.state === 'SCOREABLE' && r.playingPathway.grade === 'MEASURED').length;

  it('H1. MEASURED is reachable at depth 1 and at no greater depth', () => {
    expect(measured('V-ELITE-Y-2027')).toBeGreaterThan(0);
    expect(measured('V-ELITE-Y-2028')).toBe(0);
    expect(measured('V-ELITE-Y-2029')).toBe(0);
  });

  it('H2. programmeTrajectory cannot read the entry year, and does not move', () => {
    const base = new Map(byArm.get('V-ELITE-Y-2028').map((r) => [r.programmeId, r]));
    for (const id of ['V-ELITE-Y-2027', 'V-ELITE-Y-2029']) {
      let compared = 0;
      for (const r of byArm.get(id)) {
        const b = base.get(r.programmeId);
        /** Only where BOTH report it: elsewhere the whole layer refused, which is a different fact. */
        if (!b || r.programmeTrajectory.state !== 'SCOREABLE' || b.programmeTrajectory.state !== 'SCOREABLE') continue;
        compared += 1;
        expect(r.programmeTrajectory.value, `${id}/${r.programme}`).toBe(b.programmeTrajectory.value);
        expect(r.programmeTrajectory.grade, `${id}/${r.programme}`).toBe(b.programmeTrajectory.grade);
      }
      expect(compared, id).toBeGreaterThan(300);
    }
  });

  it('H3. changing the entry year changes Financial in NO cell', () => {
    for (const id of ['V-ELITE-Y-2027', 'V-ELITE-Y-2029']) {
      expect(cmp(id).unrelatedChanged, id).toEqual({ financial: 0 });
    }
  });
});
