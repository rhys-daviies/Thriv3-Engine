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
  'server/scripts/v2ValidationFixtures.js',
  'server/scripts/derivePlayingNorms.js',
  'server/scripts/derivePositionalNorms.js',
  'server/scripts/v2Fixtures.js',
  'server/scripts/v2Fixtures.test.js',
  'server/scripts/calibrateAbilityScale.js',
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
