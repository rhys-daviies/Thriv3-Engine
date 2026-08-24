/**
 * Combine the six criteria into a single 0..100 match score with a full
 * breakdown of how it was reached.
 *
 * The score has a fixed meaning: 100 is a perfect result on every criterion
 * the athlete cares about. The old score did not — its four terms summed to a
 * maximum of 85 on fit plus an uncapped roster bonus, clipped at 100, so a
 * developmental athlete's D3 safety school scored 99 while an elite athlete's
 * best D1 fit scored 93. Those numbers were not on the same scale as each
 * other, which makes "87% match" meaningless to the athlete reading it.
 */

import { CRITERIA, resolveWeights } from './weights.js';
import { resolveCouplings } from './couplings.js';
import { athleticFit, rosterOpportunity, academicFit, affordability, programQuality, geography } from './criteria.js';

/**
 * @param {object} args.athlete   normalised athlete inputs (see buildAthlete)
 * @param {object} args.college   normalised college inputs
 * @param {object} args.weights   resolved weight map, summing to 1
 * @param {object} args.shapes    per-criterion curve overrides from couplings.js
 * @returns {{ score:number, breakdown:Array, confidence:string, labels:object }}
 */
export function scoreMatch({ athlete, college, weights, shapes }) {
  // Resolving couplings per call is wasteful inside a ranking loop, which is
  // why pool.js does it once and passes both down; this fallback exists so a
  // single scoreMatch() call is still correct on its own.
  const coupled = weights && shapes ? null : resolveCouplings(athlete);
  const w = weights || resolveWeights({ academicImportance: athlete.academicImportance, couplings: coupled?.weights });
  const sh = shapes || coupled?.shapes || {};

  const parts = {
    athletic: athleticFit({ athleteLevel: athlete.level, programLevel: college.soccerScore, peakOffset: sh.athletic?.peakOffset }),
    roster: rosterOpportunity({
      position: athlete.position,
      graduatingStarters: college.graduatingStarters,
      graduatingSquad: college.graduatingSquad,
      rosterRowsForSchool: college.rosterRows,
      rowsMissingGradYear: college.rowsMissingGradYear,
      classYearKnown: athlete.classYear != null,
    }),
    academic: academicFit({
      academicRating: college.academicRating,
      schoolSatAvg: college.satAvg,
      schoolAdmitRate: college.admitRate,
      athleteSat: athlete.sat,
      athleteAct: athlete.act,
      athleteGpa: athlete.gpa,
      admissibilityFloor: sh.academic?.admissibilityFloor,
    }),
    affordability: affordability({
      budgetRange: athlete.budgetRange,
      netPrice: college.netPrice,
      control: college.control,
      tuitionIn: college.tuitionIn,
      tuitionOut: college.tuitionOut,
      athleteState: athlete.state,
      schoolState: college.state,
      division: college.division,
      sport: athlete.sport,
      conference: college.conference,
      // Affordability depends on athletic fit: an athlete well above a
      // programme's level is the recruit its scholarship pool gets spent on.
      athleteLevel: athlete.level,
      programLevel: college.soccerScore,
    }),
    programQuality: programQuality({
      percentile: college.qualityPercentile,
      recentWinPct: college.recentWinPct,
      priorWinPct: college.priorWinPct,
    }),
    geography: geography({
      athleteState: athlete.state,
      schoolState: college.state,
      distanceMiles: college.distanceMiles,
      origin: athlete.origin,
      athleteCountry: athlete.country,
      rosterRows: college.rosterRows,
      internationalRows: college.internationalRows,
      sameCountryRows: college.sameCountryRows,
    }),
  };

  let total = 0;
  const breakdown = [];
  for (const { key, label } of CRITERIA) {
    const part = parts[key];
    const weight = w[key] || 0;
    const contribution = weight * part.score;
    total += contribution;
    breakdown.push({
      key,
      label,
      weight: round3(weight),
      score: round3(part.score),
      contribution: round1(contribution * 100),
      confidence: part.confidence,
      status: part.label,
      detail: part.detail,
    });
  }

  return {
    score: Math.round(total * 100),
    breakdown,
    // The weakest link among criteria that actually carry weight. A criterion
    // weighted to zero cannot drag the reported confidence down.
    confidence: overallConfidence(breakdown),
    labels: Object.fromEntries(breakdown.map((b) => [b.key, b.status])),
  };
}

const RANK = { measured: 2, partial: 1, assumed: 0 };

function overallConfidence(breakdown) {
  const carrying = breakdown.filter((b) => b.weight > 0);
  if (!carrying.length) return 'assumed';
  // Weight the confidence by how much of the score each criterion drives, so
  // one unknown on a 5%-weighted criterion does not flag the whole card.
  const weighted = carrying.reduce((sum, b) => sum + b.weight * RANK[b.confidence], 0);
  if (weighted >= 1.7) return 'measured';
  if (weighted >= 1.0) return 'partial';
  return 'assumed';
}

const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;
