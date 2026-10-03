/**
 * THE ADOPTED V2 ENGINE FREEZE, AS DATA.
 *
 * A9.0 adopted `docs/validation/V2-FREEZE.md`. This is the machine-checkable
 * half of it: the file digests, constants, gates and contracts that define the
 * accepted engine, so that an integration phase cannot change the matcher by
 * accident and have nobody notice until a ranking looks odd.
 *
 * -- ENGINE IDENTITY IS NOT CORPUS IDENTITY --------------------------------
 *
 * Nothing here digests the database. The corpus GROWS - that is the point of
 * Phase 7B and of every roster acquisition phase - and a guard that treated
 * growth as a scoring mutation would fire constantly and be switched off. The
 * corpus has its own instrument, `server/scripts/a8CorpusGuard.js`, which
 * splits supported from unsupported for exactly that reason.
 *
 *   ENGINE moved  -> somebody changed the matcher. Justify it (see below).
 *   CORPUS moved  -> somebody added data. Expected. Re-run acceptance if the
 *                    SUPPORTED half moved, but do not call it a mutation.
 *
 * -- CHANGING ANYTHING BELOW -----------------------------------------------
 *
 * The freeze record names three permitted justification classes:
 * DEMONSTRATED_DEFECT, MATERIAL_EVIDENCE_IMPROVEMENT, REAL_WORLD_OUTCOME_EVIDENCE.
 * A surprising individual ranking is not one of them. Updating a digest here
 * to make a test pass, without the justification and without re-running the
 * A8.3 acceptance, is the failure mode this file exists to make obvious.
 */

/** The engine HEAD at which the freeze was adopted. */
export const FREEZE_ENGINE_HEAD = '003d144271c9705806e0909f00fd753c778fdeb7';

/** The acceptance artifact the freeze was adopted against. */
export const FREEZE_ACCEPTANCE_DIGEST = '579c3b8a9b039029cbde002bf89340198055c22758534ed8150aafffdeea47c3';

/**
 * The corpus the acceptance run measured. Recorded for PROVENANCE only -
 * the guard does not assert it, because the corpus is expected to move.
 */
export const ACCEPTANCE_CORPUS_DIGEST = 'adf924962496cfa1fad1eefd97333edc09994c210d8c072e9e14d3d90e2d240c';

/**
 * Every file that can change a score, by sha256 of its bytes.
 *
 * Byte digests rather than behavioural assertions, because a behavioural test
 * only catches the behaviours somebody thought to assert. These catch the
 * edit.
 */
export const ENGINE_FILES = Object.freeze({
  'shared/matching/v2/layers/recruitability.js': 'c863bd735f7337cd44ae0d8be8d079e378cb1919d1541e3e698ba58b3224617c',
  'shared/matching/v2/layers/opportunity.js': '0f5ae0144c51a76e3bb722ab07bab25fedcba8db2647f6552a5640abad86f05d',
  'shared/matching/v2/layers/opportunityComponents.js': '06231adef4b4e8c273b24c5028c725c9f047f9de6f164af2f42bd931f5e89a2c',
  'shared/matching/v2/layers/financial.js': 'a6f758d7e912c2b03bcfa98f038bc0dad1b23712809b0ec6e402d16eaf303a31',
  'shared/matching/v2/pursuitRules.js': '8a09d6c3f94400a4a14a14e0016d5091cbf1dead350e8b1ca6ed6230996aa2ea',
  'shared/matching/v2/opportunityRules.js': '27b97499dcc103b2e84972f84ec404dc4b51bc2192e8b60f84019e68a72d646e',
  'shared/matching/v2/recruitingRules.js': 'fd2c2a5a15f624bef04295e0dee993b292dc0ebd8b50719e2fdc02dea6cfc470',
  'shared/matching/v2/financialRules.js': '8a9185421462bce4a9dbf82a2c5fb2d05b6f6ec7cfe78810da2fd42e1159d199',
  'shared/matching/v2/coverage.js': '714de33b4583c707e173a750438dcacfa6ed1fb62a2d4026fe1180e5cbd8bbe7',
  'shared/matching/v2/types.js': 'a7c18d912e54c6cd23d8aeff2501447667cd180173d9a0aa080ce1737861a830',
  'shared/eligibility.js': '0d7083f3844dde7d0754f09a8e35a621ebe082427be40b7f8913fe90f89ad099',
});

/**
 * The numbers, asserted SEPARATELY from the digests.
 *
 * A digest says a file changed; it cannot say which number. These say which
 * number, so a failure names the constant rather than the file - and they keep
 * holding if a file is reformatted or a comment is fixed, which is the common
 * innocent case.
 */
export const FROZEN_CONSTANTS = Object.freeze({
  PURSUIT_WEIGHTS: Object.freeze({ recruitability: 0.5, financial: 0.2, opportunity: 0.3 }),
  VALUE_WEIGHTS: Object.freeze({ playingPathway: 0.65, programmeTrajectory: 0.35 }),
  PREFERENCE_WEIGHTS: Object.freeze({
    majorFit: 1.2, locationFit: 0.3, athleticOutcome: 0.3, academicStrengthFit: 0.3,
  }),
  PURSUIT_GATES: Object.freeze({
    recruitability: Object.freeze({ floor: 0.05, threshold: 0.25 }),
    financial: Object.freeze({ floor: 0.30, threshold: 0.50 }),
  }),
  OPPORTUNITY_COVERAGE_FLOOR: 0.35,
  COMPETITIVE_LEVEL_SPAN: 0.35,
  TRAJECTORY_SATURATION: 0.30,
  MEASURED_HORIZON_DEPTH: 1,
  ZERO_CLAIM_READABLE_SHARE: 0.5,
  TOP_N: 100,
});

/** The associations an eligibility rule is on file for. */
export const SUPPORTED_DIVISIONS = Object.freeze(['NAIA', 'NCAA D1', 'NCAA D2', 'NCAA D3']);
