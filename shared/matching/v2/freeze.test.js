/**
 * =============================================================================
 * THE V2 FREEZE GUARD — A9.0.
 *
 * `docs/validation/V2-FREEZE.md` is the adopted record of the accepted engine.
 * This is what makes it true tomorrow. It fails loudly if an integration phase
 * changes the matcher, which is the specific accident A9 onwards is exposed to:
 * the engine is finished, the work ahead is plumbing, and plumbing that quietly
 * alters a weight would invalidate the A8.3 acceptance without anybody noticing
 * until a ranking looked odd.
 *
 * IT DOES NOT TOUCH THE DATABASE. The corpus is supposed to grow, and a guard
 * that read growth as a scoring mutation would fire on every roster import and
 * be switched off within a week. Corpus identity lives in `a8CorpusGuard.js`,
 * split into supported and unsupported for that reason.
 *
 * WHEN THIS FAILS, the fix is almost never to update the expected value. Read
 * the justification classes in the freeze record first.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  ENGINE_FILES, FROZEN_CONSTANTS, SUPPORTED_DIVISIONS,
  FREEZE_ACCEPTANCE_DIGEST, FREEZE_ENGINE_HEAD, ACCEPTANCE_CORPUS_DIGEST,
} from './freeze.js';
import {
  PURSUIT_WEIGHTS, VALUE_WEIGHTS, PREFERENCE_WEIGHTS, OPPORTUNITY_COVERAGE_FLOOR,
  COMPETITIVE_LEVEL_SPAN, TRAJECTORY_SATURATION, MEASURED_HORIZON_DEPTH,
  ZERO_CLAIM_READABLE_SHARE, TOP_N, GRADE, majorFit, playingPathway, squadRotation,
} from './index.js';
import { PURSUIT_GATES } from './pursuitRules.js';
import { REASON, isScoreable, isNotApplicable } from './types.js';
import { ELIGIBILITY_RULES, ELIGIBILITY_MODEL } from '../../eligibility.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex');

describe('V2 freeze: the engine is the one that was accepted', () => {
  it('F1. every scoring file is byte-identical to the accepted engine', () => {
    const moved = Object.entries(ENGINE_FILES)
      .filter(([file, digest]) => sha(file) !== digest)
      .map(([file]) => file);
    expect(moved, 'a scoring file changed after the freeze — see the justification classes in docs/validation/V2-FREEZE.md').toEqual([]);
  });

  it('F2. the layer weights are the frozen ones', () => {
    expect(PURSUIT_WEIGHTS).toEqual(FROZEN_CONSTANTS.PURSUIT_WEIGHTS);
    expect(VALUE_WEIGHTS).toEqual(FROZEN_CONSTANTS.VALUE_WEIGHTS);
    expect(PREFERENCE_WEIGHTS).toEqual(FROZEN_CONSTANTS.PREFERENCE_WEIGHTS);
    /** Pursuit's three weights must still sum to 1, or the layer means something else. */
    const sum = Object.values(PURSUIT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Number(sum.toFixed(10))).toBe(1);
  });

  it('F3. the gates are the frozen ones', () => {
    expect(PURSUIT_GATES).toEqual(FROZEN_CONSTANTS.PURSUIT_GATES);
  });

  it('F4. the frozen scalars have not moved', () => {
    expect(OPPORTUNITY_COVERAGE_FLOOR).toBe(FROZEN_CONSTANTS.OPPORTUNITY_COVERAGE_FLOOR);
    expect(COMPETITIVE_LEVEL_SPAN).toBe(FROZEN_CONSTANTS.COMPETITIVE_LEVEL_SPAN);
    expect(TRAJECTORY_SATURATION).toBe(FROZEN_CONSTANTS.TRAJECTORY_SATURATION);
    expect(MEASURED_HORIZON_DEPTH).toBe(FROZEN_CONSTANTS.MEASURED_HORIZON_DEPTH);
    expect(ZERO_CLAIM_READABLE_SHARE).toBe(FROZEN_CONSTANTS.ZERO_CLAIM_READABLE_SHARE);
    expect(TOP_N).toBe(FROZEN_CONSTANTS.TOP_N);
  });

  it('F5. GRADE is still MEASURED or PARTIAL — ASSUMED stays abolished', () => {
    expect(Object.values(GRADE).sort()).toEqual(['MEASURED', 'PARTIAL']);
  });

  /**
   * The behavioural half. These three contracts are the ones A8 spent phases
   * establishing, and each is stated as what it must NOT do.
   */
  it('F6. majorFit is positive-only: absence never becomes a score', () => {
    const matched = majorFit({ intendedMajor: 'kinesiology', notableMajors: '["Kinesiology"]' });
    expect(isScoreable(matched)).toBe(true);
    expect(matched.value).toBe(1);

    const absent = majorFit({ intendedMajor: 'mathematics', notableMajors: '["Business","Biology"]' });
    expect(isScoreable(absent)).toBe(false);
    expect(absent.reason).toBe(REASON.MAJOR_NOT_IN_PARTIAL_EVIDENCE);
    expect(absent.value ?? null).toBe(null);

    const none = majorFit({ intendedMajor: null, notableMajors: '["Biology"]' });
    expect(isNotApplicable(none)).toBe(true);
  });

  it('F7. Playing Pathway keeps Policy B: no minutes history means refusal, not rotation alone', () => {
    const noRoster = squadRotation({ rosterOnFile: false });
    expect(isScoreable(noRoster)).toBe(false);
    /** A7.45B: the pathway refuses rather than scoring on whatever survived. */
    const pathway = playingPathway({ competition: noRoster, rotation: noRoster });
    expect(isScoreable(pathway)).toBe(false);
  });

  it('F8. the supported universe is still exactly the four ruled associations', () => {
    const ruled = [...new Set(ELIGIBILITY_RULES.map((r) => r.division))].sort();
    expect(ruled).toEqual([...SUPPORTED_DIVISIONS].sort());
    /** And an unrecognised division is UNKNOWN, never defaulted to the NCAA model. */
    expect(ELIGIBILITY_RULES.every((r) => r.model !== ELIGIBILITY_MODEL.UNKNOWN)).toBe(true);
  });

  it('F9. the acceptance artifact is the one the freeze was adopted against', () => {
    const art = JSON.parse(fs.readFileSync(path.join(root, 'docs/validation/A8.3-acceptance.json'), 'utf8'));
    expect(crypto.createHash('sha256').update(JSON.stringify(art.cells)).digest('hex'))
      .toBe(FREEZE_ACCEPTANCE_DIGEST);
    expect(art.cellDigest).toBe(FREEZE_ACCEPTANCE_DIGEST);
  });

  it('F10. the freeze record exists, is adopted, and names its guard', () => {
    const doc = fs.readFileSync(path.join(root, 'docs/validation/V2-FREEZE.md'), 'utf8');
    expect(doc).toContain('ADOPTED');
    expect(doc).toContain(FREEZE_ENGINE_HEAD);
    expect(doc).toContain(FREEZE_ACCEPTANCE_DIGEST);
    expect(doc).toContain(ACCEPTANCE_CORPUS_DIGEST);
    for (const cls of ['DEMONSTRATED_DEFECT', 'MATERIAL_EVIDENCE_IMPROVEMENT', 'REAL_WORLD_OUTCOME_EVIDENCE']) {
      expect(doc, cls).toContain(cls);
    }
  });

  /**
   * Checked on the IMPORT LINES, not on the file's raw text: a first draft
   * searched for the substrings and failed against its own assertions, which
   * is a neat demonstration that a guard can be wrong about itself.
   */
  it('F11. the guard asserts no corpus identity — growth is not a mutation', () => {
    const self = fs.readFileSync(path.join(root, 'shared/matching/v2/freeze.test.js'), 'utf8');
    const imports = self.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    for (const forbidden of ['better-sqlite3', 'a8CorpusGuard', 'db/client']) {
      expect(imports, forbidden).not.toContain(forbidden);
    }
    expect(FROZEN_CONSTANTS).not.toHaveProperty('corpusDigest');
  });
});
