/**
 * A7.28: the SHADOW academic-recruitability assessment.
 *
 *   node server/scripts/a728ShadowFlag.js --out=/tmp/a728.json
 *
 * SHADOW ONLY. Nothing here returns a number that any ranking reads, nothing
 * here is imported by production, and the joint condition below exists in this
 * file and nowhere else. It runs the shipped pipeline, takes the ranking
 * exactly as it comes out, and annotates it.
 *
 * -- WHAT THE ASSESSMENT CLAIMS, AND WHAT IT REFUSES TO CLAIM -------------
 *
 * It answers one question: does the admissions evidence we currently hold
 * suggest that coach-supported admissions or an academic pre-read should be
 * checked before Thriv3 treats this programme as straightforwardly
 * recruitable?
 *
 * It does NOT claim the athlete would be rejected, is ineligible, cannot be
 * recruited, or should be removed, and it produces NO admission probability.
 * Recruited-athlete latitude is unknown (A7.27 section 12) and this file does
 * not estimate it.
 *
 * -- EVIDENCE STATE IS NOT CONCERN STATE ----------------------------------
 *
 * Two independent outputs. `evidence` says what we hold about the JOINT
 * condition; `outcome` says what it suggests. MEASURED + NO_MATERIAL_CONCERN
 * and MEASURED + PRE_READ_RECOMMENDED are both ordinary results, and
 * INSUFFICIENT_EVIDENCE is a statement about us rather than about the
 * programme.
 *
 * -- WHERE THE BOUNDARY COMES FROM ----------------------------------------
 *
 * Derived from the TWELVE MEASURED CARDS of the A7.27 blind review, which
 * were frozen in `A7.27-academic-cases.review.json` before this file existed.
 * It is not tuned here and is not tuned per case afterwards.
 *
 *   acceptance >= 0.50            -> clears, whatever the shortfall
 *                                    (A7.27 K-11: 301 below at 91.9%, no concern;
 *                                     K-14: 142 below at 94.8%, no concern)
 *   selective, shortfall >= -50   -> clears
 *                                    (K-09: +31 at 13.4%, no concern - the
 *                                     selectivity trap, answered blind)
 *   selective, -350 < gap < -50   -> review
 *                                    (K-06 -98 at 14% read "concern but
 *                                     reasonable"; K-04 -316 at 26% read
 *                                     "substantial")
 *   selective, gap <= -350        -> pre-read
 *                                    (K-15 -398, K-13 -430, K-05 -454,
 *                                     K-08 -548, K-07 -603, all at <= 26%)
 *
 * THE ACCEPTANCE CUT IS UNDER-DETERMINED AND SAID SO BEFORE IT WAS TESTED.
 * A7.27 observed selective cases at 0.045-0.26 and clearing cases at
 * 0.78-0.95. Nothing was observed between 0.26 and 0.78, so 0.50 is a
 * midpoint rather than a measurement, and the A7.28 blind pack deliberately
 * puts cases in that gap.
 */
import fs from 'node:fs';
import db from '../db/client.js';
import { buildPoolContext } from '../lib/v2/poolContext.js';
import { normaliseAthlete } from '../../shared/matching/pool.js';
import { canonicalPosition } from '../../shared/positions.js';
import { buildValidationAthlete, isScoreable } from '../../shared/matching/v2/index.js';
import { runPursuit } from '../lib/v2/pursuitRun.js';
import { academicPercentileScale } from '../lib/v2/opportunityRun.js';
import { V3_ATHLETES } from './v3Athletes.js';
import { W3_ATHLETES } from './w3Athletes.js';
import { LADDER } from './a727AcademicLadder.js';

const SEASON = '2026';
const arg = (k, d = null) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export const EVIDENCE = Object.freeze({ MEASURED: 'MEASURED', PARTIAL: 'PARTIAL', UNSCOREABLE: 'UNSCOREABLE' });
export const OUTCOME = Object.freeze({
  NO_MATERIAL_CONCERN: 'NO_MATERIAL_CONCERN',
  ACADEMIC_REVIEW: 'ACADEMIC_REVIEW',
  PRE_READ_RECOMMENDED: 'PRE_READ_RECOMMENDED',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
});

export const BOUNDARY = Object.freeze({ clearingAcceptance: 0.50, comparableGap: -50, preReadGap: -350 });

/**
 * How a future `test_policy` would change the reading. UNKNOWN is today's
 * state for every institution, and the contract exists so that a later value
 * changes interpretation rather than being bolted on.
 */
export const TEST_POLICY = Object.freeze({
  REQUIRED: 'REQUIRED', OPTIONAL: 'OPTIONAL', BLIND: 'BLIND', UNKNOWN: 'UNKNOWN',
});

/**
 * @param {object} a
 * @param {number|null} a.athleteSat
 * @param {number|null} a.programmeSat   average SAT of ENROLLED students
 * @param {number|null} a.acceptanceRate
 * @param {string} a.testPolicy
 */
export function shadowAssess({ athleteSat, programmeSat, acceptanceRate, testPolicy = TEST_POLICY.UNKNOWN }) {
  const gap = (athleteSat !== null && programmeSat !== null) ? athleteSat - programmeSat : null;
  /**
   * A test-BLIND institution does not read the score, so the shortfall is not
   * evidence about admission there however large it is. The comparison is
   * dropped rather than discounted - discounting would still let it compete.
   */
  const gapUsable = testPolicy === TEST_POLICY.BLIND ? null : gap;
  const hasGap = gapUsable !== null;
  const hasAcc = acceptanceRate !== null;

  const evidence = (hasGap && hasAcc) ? EVIDENCE.MEASURED
    : (hasGap || hasAcc) ? EVIDENCE.PARTIAL
      : EVIDENCE.UNSCOREABLE;

  const reasons = [];
  let outcome;

  if (hasAcc && acceptanceRate >= BOUNDARY.clearingAcceptance) {
    // A HIGH acceptance rate is adequate evidence that admission is not an
    // obstacle. A LOW one is never adequate evidence that it is.
    outcome = OUTCOME.NO_MATERIAL_CONCERN;
    reasons.push(`acceptance rate ${(acceptanceRate * 100).toFixed(0)}% - the institution is not selecting on this margin`);
  } else if (evidence === EVIDENCE.MEASURED) {
    if (gapUsable >= BOUNDARY.comparableGap) {
      outcome = OUTCOME.NO_MATERIAL_CONCERN;
      reasons.push('the athlete sits at or above the enrolled body on the evidence we hold');
    } else if (gapUsable > BOUNDARY.preReadGap) {
      outcome = OUTCOME.ACADEMIC_REVIEW;
      reasons.push(`${Math.abs(gapUsable)} points below the enrolled average at a selective institution`);
    } else {
      outcome = OUTCOME.PRE_READ_RECOMMENDED;
      reasons.push(`${Math.abs(gapUsable)} points below the enrolled average at an institution accepting ${(acceptanceRate * 100).toFixed(0)}%`);
    }
  } else if (hasGap) {
    /**
     * Shortfall known, selectivity unknown. The joint condition cannot be
     * met, so this can reach REVIEW and NEVER PRE_READ - A7.27's rule that
     * partial evidence may clear a case and may never condemn one.
     */
    outcome = gapUsable >= BOUNDARY.comparableGap ? OUTCOME.NO_MATERIAL_CONCERN : OUTCOME.ACADEMIC_REVIEW;
    reasons.push('no acceptance rate on file, so how selective this institution is cannot be confirmed');
  } else if (hasAcc) {
    // Selective, but nothing about where THIS athlete sits. A7.27 K-09 is the
    // proof that a low acceptance rate alone says nothing about an athlete.
    outcome = OUTCOME.INSUFFICIENT_EVIDENCE;
    reasons.push('no comparable test evidence, so where this athlete sits relative to the enrolled body is unknown');
  } else {
    outcome = OUTCOME.INSUFFICIENT_EVIDENCE;
    reasons.push('no admissions evidence on file for this institution');
  }

  if (testPolicy === TEST_POLICY.BLIND && gap !== null) reasons.push('institution does not consider test scores');
  if (testPolicy === TEST_POLICY.OPTIONAL && gap !== null) reasons.push('test-optional: the published average reflects submitters only');
  if (testPolicy === TEST_POLICY.UNKNOWN && gap !== null) reasons.push('test policy not on file');

  return { evidence, outcome, gap, acceptanceRate, testPolicy, reasons };
}

function majorMatch(notableMajors, intendedMajor) {
  if (!intendedMajor) return null;
  let list = notableMajors;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = null; } }
  if (!Array.isArray(list) || !list.length) return null;
  const want = String(intendedMajor).toLowerCase();
  return list.some((m) => String(m).toLowerCase().includes(want) || want.includes(String(m).toLowerCase()));
}

function runOne({ ctx, def, profile }) {
  const p = { ...def.player, gpa: profile.gpa, sat_score: profile.sat };
  const v1Shape = normaliseAthlete({ ...p, preferred_divisions: '[]', preferred_conferences: '[]' });
  const { athlete, inputs } = buildValidationAthlete({
    record: p, v1Shape, position: canonicalPosition(p.position), label: def.id,
    profile: {
      competitiveLevelPriority: p.competitive_level_priority,
      playingOpportunityPriority: p.playing_opportunity_priority,
      academicStrengthPriority: p.academic_strength_priority,
    },
  });
  const r = runPursuit({ athlete, sport: p.sport, colleges: ctx.colleges, ctx });
  const scale = academicPercentileScale(ctx.colleges);
  const byId = new Map(ctx.colleges.map((c) => [c.id, c]));
  const athleteSat = num(p.sat_score);
  return {
    base: def.id, sport: p.sport, profile,
    athlete: {
      ability: p.football_ability, position: p.position, gpa: num(p.gpa), sat: athleteSat,
      budget: num(p.max_annual_contribution_usd), intendedMajor: p.intended_major ?? null,
      origin: p.origin,
      competitiveLevelPriority: p.competitive_level_priority,
      playingOpportunityPriority: p.playing_opportunity_priority,
      academicStrengthPriority: p.academic_strength_priority,
      equivalentProgrammeScore: inputs.equivalentProgrammeScore,
    },
    rows: r.pipeline.ranked.slice(0, 100).map((e) => {
      const c = byId.get(e.id) ?? {};
      const ob = isScoreable(e.opportunity) ? e.opportunity.basis : null;
      return {
        rank: e.rank, name: e.name, division: c.division ?? null,
        strength: num(c.soccer_score), netPrice: num(c.net_price),
        academicRating: num(c.academic_rating),
        academicPercentile: scale(c.academic_rating, c.academic_rating_source),
        programmeSat: num(c.sat_avg), acceptanceRate: num(c.admit_rate),
        majorMatch: majorMatch(c.notable_majors, p.intended_major),
        R: isScoreable(e.recruitability) ? e.recruitability.value : null,
        F: isScoreable(e.financial) ? e.financial.value : null,
        O: isScoreable(e.opportunity) ? e.opportunity.value : null,
        pathway: ob?.components?.playingPathway?.value ?? null,
        shadow: shadowAssess({
          athleteSat, programmeSat: num(c.sat_avg), acceptanceRate: num(c.admit_rate),
        }),
      };
    }),
  };
}

function main() {
  const out = arg('out');
  if (!out) { console.error('Usage: a728ShadowFlag.js --out=<file>'); process.exit(2); }
  const ctxCache = new Map();
  const bases = [...V3_ATHLETES, ...W3_ATHLETES].filter((a) => /-(A|C|D|E)-/.test(a.id));
  const snap = [];
  for (const def of bases) {
    const sport = def.player.sport;
    if (!ctxCache.has(sport)) ctxCache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
    for (const profile of LADDER) {
      const res = runOne({ ctx: ctxCache.get(sport), def, profile });
      snap.push(res);
      const t = res.rows.reduce((a, r) => { a[r.shadow.outcome] = (a[r.shadow.outcome] ?? 0) + 1; return a; }, {});
      console.log(`${def.id} @ ${profile.id}: `
        + `pre-read ${t.PRE_READ_RECOMMENDED ?? 0} · review ${t.ACADEMIC_REVIEW ?? 0} · `
        + `clear ${t.NO_MATERIAL_CONCERN ?? 0} · insufficient ${t.INSUFFICIENT_EVIDENCE ?? 0}`);
    }
  }
  fs.writeFileSync(out, JSON.stringify(snap));
  console.log(`written ${out}`);
}
if (arg('out')) main();
