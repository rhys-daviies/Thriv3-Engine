import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The architectural boundary around V2, enforced in both directions.
 *
 * OUTWARD: V2 must not import the four V1 modules that carry the assumptions
 * V2 exists to replace. Each one embeds a decision, not just a calculation:
 *
 *   criteria.js   the neutral 0.5 prior, the Gaussian athletic fit, the award
 *                 concentration - the three things the layered model unwinds
 *   score.js      the single weighted sum
 *   weights.js    the six-criterion vocabulary itself
 *   couplings.js  money-driven geography, and the rest of the cross-criterion
 *                 rules that only make sense inside a weighted sum
 *
 * Reusing any of them would not save work; it would reintroduce the model.
 * shared/matching/index.js re-exports all four, so it is banned too.
 *
 * INWARD: nothing outside the approved harness surface may import V2 while
 * there is nothing to adopt. Adoption is a decision with a date on it, and a
 * stray import is how a half-built model reaches a user without one.
 *
 * This test is permanent. When V2 is adopted, the inward list gains the call
 * sites deliberately, one at a time, and the outward list never changes.
 */

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '../../..');

/** V1 modules whose assumptions V2 must not inherit. */
const FORBIDDEN_TO_V2 = [
  'shared/matching/criteria.js',
  'shared/matching/score.js',
  'shared/matching/weights.js',
  'shared/matching/couplings.js',
  'shared/matching/index.js',
];

/**
 * The only places allowed to import V2 while there is nothing to adopt.
 *
 * Every entry is a DIAGNOSTIC: a harness, a calibration generator or a report
 * a person reads. Nothing that serves a route, renders a page or writes a
 * recommendation appears here, and adoption means adding call sites to this
 * list deliberately, one at a time, with a date on each.
 */
const MAY_IMPORT_V2 = [
  'shared/matching/v2/',
  'server/lib/v2/',
  /**
   * A7.9.2. The Player entity validates a contribution pair on write, using
   * the same rule the Financial layer reads it with. Restating the legal
   * combinations in the route would let the database and the model disagree
   * about what an athlete said.
   */
  'server/db/entities/player.js',
  /**
   * A7.12.1. The entity's own test, which asserts the write boundary against
   * the same field list and the same anti-inference guard the entity reads -
   * asserting it against a restated copy would let the two drift and call it
   * a pass.
   */
  'server/db/preferenceWrites.test.js',
  /**
   * A7.9.3. The intake form asks the question Financial answers, so it takes
   * the three contribution states FROM the model rather than keeping its own
   * copy of the vocabulary. A second copy is how a form comes to offer a
   * state the layer cannot read - which is precisely how "$40k+/yr" survived
   * as an option long after it stopped meaning anything.
   *
   * This is the ONLY V2 import under src/, and it is a frozen enum and a
   * validator, not a scorer.
   */
  'src/lib/contributionIntake.js',
  'src/lib/contributionIntake.test.js',
  /**
   * A7.12.1. Same rule as the contribution vocabulary above: the three
   * preference questions, their 1-5 ladder and their validator are read FROM
   * the layer that scores them, not restated beside the form. A second copy
   * is how a form comes to offer a scale the scorer cannot read.
   *
   * Also a frozen contract and a validator, not a scorer.
   */
  'src/lib/preferenceIntake.js',
  'src/lib/preferenceIntake.test.js',
  'src/lib/playerPayload.test.js',
  'server/scripts/v2Compare.js',
  'server/scripts/v2Financial.js',
  'server/scripts/v2Recruitability.js',
  'server/scripts/v2Opportunity.js',
  'server/scripts/v2Pursuit.js',
  'server/scripts/v2Explain.js',
  'server/scripts/v2ValidationPack.js',
  'server/scripts/v2D3Diagnostic.js',
  'server/scripts/v2RecruitabilityDiagnostic.js',
  'server/scripts/v2MinutesEvidence.js',
  'server/scripts/v2RecruitingBehaviour.js',
  'server/scripts/v2RecruitabilityArchitectures.js',
  'server/scripts/v2CalibrateRecruitability.js',
  'server/scripts/v2AcademicPreference.js',
  'server/scripts/v2EliteGuard.js',
  'server/scripts/v2FixtureTrace.js',
  'server/scripts/v2CounterfactualDiagnostic.js',
  'server/scripts/v2PlausibilityShape.js',
  'server/scripts/v2PlayingDepth.js',
  'server/scripts/v2ReturningDepth.js',
  'server/scripts/v2PathwayCalibration.js',
  'server/scripts/v2PursuitAuthority.js',
  'server/scripts/v2GateAndFinancial.js',
  /**
   * A7.18. Captures every layer output for the benchmark athletes so the
   * same run before and after a scorer change can be compared value for
   * value. Read-only against the model and the database: it is the thing
   * that proves a change did what it said, so it necessarily imports V2.
   */
  'server/scripts/gParityHarness.js',
  /**
   * A7.9.4. Compares V1 affordability against V2 Financial on one axis, which
   * needs both. Read-only: it scores, it never ranks anything into production.
   */
  'server/scripts/v1BridgeDiagnostic.js',
  'server/scripts/v1BridgeProof.js',
  'server/scripts/v2PositionalEvidence.js',
  'server/scripts/v2ObservedSeason.js',
  'server/scripts/v2Turnover.js',
  'server/scripts/v2CoachHistory.js',
  'server/scripts/v2PositionalStructure.js',
  'server/scripts/v2ArchitectureCheckpoint.js',
  'server/scripts/v2PreferenceParity.js',
  /**
   * A7.13. The V3 outreach packs: athlete definitions, the generator and the
   * blind audit that gates it. All three are validation instruments - none
   * serves a route, renders a page or writes a recommendation.
   */
  'server/scripts/v3Packs.js',
  'server/scripts/v3Athletes.js',
  'server/scripts/v3Reveal.js',
  'server/scripts/v2ValidationFixtures.js',
  'server/scripts/derivePlayingNorms.js',
  'server/scripts/derivePositionalNorms.js',
  'server/scripts/v2Fixtures.js',
  'server/scripts/v2Fixtures.test.js',
  'server/scripts/calibrateAbilityScale.js',
  /**
   * A7.25. The blind preference-authority comparison. It runs the shipped
   * pipeline once and re-sorts the same entries under a candidate multiplier
   * that exists only inside it; nothing imports it, so the candidate cannot
   * reach production by any path.
   */
  'server/scripts/a725Variants.js',
  /**
   * A7.26. The academic-realism diagnostic: runs the shipped pipeline once per
   * (athlete, academic priority) and records what it did. Read-only, and it
   * scores nothing - the admissions quantities it computes are descriptions of
   * database evidence and never reach a ranking.
   */
  'server/scripts/a726AcademicDiagnostic.js',
  /**
   * A7.27. The academic profile ladder: 56 runs that prove rank invariance
   * under every athlete academic credential, and measure the exposure that
   * invariance produces. Read-only; it proposes no formula.
   */
  'server/scripts/a727AcademicLadder.js',
  /**
   * A7.28. The shadow academic-recruitability assessment. The joint condition
   * lives in this file and nowhere else; it annotates a ranking it does not
   * touch, and nothing imports it.
   */
  'server/scripts/a728ShadowFlag.js',
];

const SEARCH_ROOTS = ['shared', 'server', 'src', 'worker'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__baselines__', 'data']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (/\.(js|jsx|mjs)$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/**
 * This file is excluded from its own scan. It NAMES the forbidden paths, in
 * string literals, and quotes an offending import to prove the detector fires
 * - so scanning it would report the guard as the violation. It was the first
 * thing this test caught, which is a reasonable way to learn that it works.
 */
const SELF = 'shared/matching/v2/importGraph.test.js';

const FILES = SEARCH_ROOTS
  .map((r) => path.join(ROOT, r))
  .filter((d) => fs.existsSync(d))
  .flatMap((d) => walk(d))
  .map((f) => ({ abs: f, rel: path.relative(ROOT, f).split(path.sep).join('/') }))
  .filter((f) => f.rel !== SELF);

/** Static and dynamic import specifiers, plus the `@shared` alias form. */
const SPECIFIER = /(?:^|[^\w.])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function importsOf(file) {
  const src = fs.readFileSync(file.abs, 'utf8');
  const out = [];
  for (const m of src.matchAll(SPECIFIER)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    let resolved;
    if (spec.startsWith('.')) {
      resolved = path.relative(ROOT, path.resolve(path.dirname(file.abs), spec));
    } else if (spec.startsWith('@shared/')) {
      resolved = path.join('shared', spec.slice('@shared/'.length));
    } else {
      continue; // a package, not a repository module
    }
    out.push({ spec, resolved: resolved.split(path.sep).join('/') });
  }
  return out;
}

describe('the V2 import boundary', () => {
  const v2Files = FILES.filter((f) => f.rel.startsWith('shared/matching/v2/'));

  it('finds the V2 modules it is meant to be guarding', () => {
    expect(v2Files.length).toBeGreaterThan(3);
    expect(FILES.length).toBeGreaterThan(200);
  });

  it('no V2 module imports a frozen V1 scoring module', () => {
    const offences = [];
    for (const file of v2Files) {
      for (const imp of importsOf(file)) {
        if (FORBIDDEN_TO_V2.includes(imp.resolved)) {
          offences.push(`${file.rel} imports ${imp.resolved} (as "${imp.spec}")`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it('no V2 module reaches anywhere into shared/matching outside v2/', () => {
    // Broader than the named list on purpose: pool.js and constants.js are
    // reusable, but only through a wrapper in server/lib/v2, never by a layer
    // importing V1's ranking directly.
    const offences = [];
    for (const file of v2Files) {
      for (const imp of importsOf(file)) {
        if (imp.resolved.startsWith('shared/matching/') && !imp.resolved.startsWith('shared/matching/v2/')) {
          offences.push(`${file.rel} imports ${imp.resolved} (as "${imp.spec}")`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it('nothing outside the approved surface imports V2 yet', () => {
    const offences = [];
    for (const file of FILES) {
      if (MAY_IMPORT_V2.some((p) => file.rel === p || file.rel.startsWith(p))) continue;
      for (const imp of importsOf(file)) {
        if (imp.resolved.startsWith('shared/matching/v2')) {
          offences.push(`${file.rel} imports ${imp.resolved} (as "${imp.spec}")`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it('detects an offending import rather than merely passing on a clean tree', () => {
    // The guard is only worth having if it can fail. Proven against a synthetic
    // file rather than by trusting the regex.
    const fake = { abs: path.join(ROOT, 'shared/matching/v2/__probe__.js'), rel: 'shared/matching/v2/__probe__.js' };
    fs.writeFileSync(fake.abs, "import { scoreMatch } from '../score.js';\nexport default scoreMatch;\n");
    try {
      const found = importsOf(fake).map((i) => i.resolved);
      expect(found).toContain('shared/matching/score.js');
      expect(FORBIDDEN_TO_V2).toContain('shared/matching/score.js');
    } finally {
      fs.unlinkSync(fake.abs);
    }
  });

  it('sees the @shared alias form as well as the relative one', () => {
    const fake = { abs: path.join(ROOT, 'src/__probe__.js'), rel: 'src/__probe__.js' };
    fs.writeFileSync(fake.abs, "import { combine } from '@shared/matching/v2/index.js';\nexport default combine;\n");
    try {
      expect(importsOf(fake).map((i) => i.resolved)).toContain('shared/matching/v2/index.js');
    } finally {
      fs.unlinkSync(fake.abs);
    }
  });
});
