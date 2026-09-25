/**
 * A7.26: the academic-realism diagnostic.
 *
 *   node server/scripts/a726AcademicDiagnostic.js --out=/tmp/a726.json
 *
 * READ-ONLY against the database and against production. It runs the shipped
 * pipeline once per (athlete, academic priority) and records what the ranking
 * did. NOTHING here scores anything: no admissions formula, no academic gate,
 * no multiplier. Where this file computes an admissions quantity it is a
 * DESCRIPTION of evidence already in the database, reported with its own
 * evidence state, and it never reaches a ranking.
 *
 * -- WHY THE ADMISSIONS BANDS ARE NOT THRESHOLDS --------------------------
 *
 * A7.26 forbids inventing thresholds, and it is worth being exact about what
 * that leaves. The SAT gap and the admit rate are reported as raw numbers
 * throughout. Where the audit needs to COUNT something it uses conventional
 * public selectivity bands (10% / 25% / 50%) and round SAT gaps (100-point
 * steps) - reference points a reader already has, chosen before any result
 * was seen, and used only to tabulate. None is proposed as a scoring cut.
 */
import fs from 'node:fs';
import db from '../db/client.js';
import { buildPoolContext } from '../lib/v2/poolContext.js';
import { normaliseAthlete } from '../../shared/matching/pool.js';
import { canonicalPosition } from '../../shared/positions.js';
import { buildValidationAthlete, isScoreable } from '../../shared/matching/v2/index.js';
import { runPursuit } from '../lib/v2/pursuitRun.js';
import { academicPercentileScale } from '../lib/v2/opportunityRun.js';
import { buildValidationFacts } from '../lib/v2/validationFacts.js';
import { V3_ATHLETES } from './v3Athletes.js';
import { W3_ATHLETES } from './w3Athletes.js';

const SEASON = '2026';
const PRIORITIES = [1, 3, 5];
const DEPTH = 100;
const arg = (k, d = null) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Does the programme list the athlete's declared field? The majorFit rule, read for reporting. */
function majorMatch(notableMajors, intendedMajor) {
  if (!intendedMajor) return null;
  let list = notableMajors;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = null; } }
  if (!Array.isArray(list) || !list.length) return null;
  const want = String(intendedMajor).toLowerCase();
  return list.some((m) => String(m).toLowerCase().includes(want) || want.includes(String(m).toLowerCase()));
}

/**
 * DESCRIPTIVE admissions evidence for one athlete-programme pair.
 *
 * Returns the raw comparisons and an evidence state. It deliberately does NOT
 * return a number that could be ranked on.
 *
 *   MEASURED    both sides carry a test score on the same scale
 *   PARTIAL     one comparable quantity only - a GPA with no programme GPA to
 *               read it against, or an admit rate on its own
 *   UNSCOREABLE the programme carries no admissions evidence at all
 *
 * An admit rate alone is PARTIAL and never MEASURED. An institution's overall
 * acceptance rate is a fact about its applicant pool, not about whether a
 * recruited athlete is admitted, and the two are not the same question.
 */
function admissionsEvidence({ athleteSat, athleteGpa, progSat, progAdmit }) {
  const satGap = (athleteSat !== null && progSat !== null) ? athleteSat - progSat : null;
  if (satGap !== null) {
    return { state: 'MEASURED', satGap, progSat, progAdmit, basis: 'sat-vs-sat' };
  }
  if (progAdmit !== null && (athleteSat !== null || athleteGpa !== null)) {
    return { state: 'PARTIAL', satGap: null, progSat, progAdmit, basis: 'admit-rate-only' };
  }
  if (progSat !== null && athleteSat === null) {
    return { state: 'PARTIAL', satGap: null, progSat, progAdmit, basis: 'programme-sat-only' };
  }
  return { state: 'UNSCOREABLE', satGap: null, progSat, progAdmit, basis: 'no-admissions-evidence' };
}

function capture({ ctx, def, academicPriority }) {
  const p = def.player;
  const v1Shape = normaliseAthlete({ ...p, preferred_divisions: '[]', preferred_conferences: '[]' });
  const { athlete, inputs } = buildValidationAthlete({
    record: p, v1Shape, position: canonicalPosition(p.position), label: def.id,
    profile: {
      competitiveLevelPriority: p.competitive_level_priority,
      playingOpportunityPriority: p.playing_opportunity_priority,
      academicStrengthPriority: academicPriority,
    },
  });
  const run = runPursuit({ athlete, sport: p.sport, colleges: ctx.colleges, ctx });
  const scale = academicPercentileScale(ctx.colleges);
  const byId = new Map(ctx.colleges.map((c) => [c.id, c]));
  /**
   * The roster evidence as the audited View A renderer states it, NOT a
   * recomputation. `basis.components` carries only {value, grade, weight,
   * share}, so `playingPathway`'s competition and rotation halves are not
   * reachable from the layer output; this is the same roster the athlete
   * would be shown, which is what the pathway question is actually about.
   */
  const facts = buildValidationFacts({
    colleges: ctx.colleges, ctx, sport: p.sport, position: canonicalPosition(p.position),
    entryYear: p.recruiting_class_year,
    athleteState: p.state ?? null,
    athleteIsInternational: v1Shape.origin === 'International',
    academicScale: scale,
  });
  const athleteSat = num(p.sat_score);
  const athleteGpa = num(p.gpa);

  const row = (e) => {
    const c = byId.get(e.id) ?? {};
    const ob = isScoreable(e.opportunity) ? e.opportunity.basis : null;
    const comps = ob ? Object.fromEntries(Object.entries(ob.components).map(([k, v]) => [k, v.value])) : {};
    return {
      id: e.id,
      rank: e.rank,
      name: e.name,
      P: e.pursuitPriority.value,
      base: e.pursuitPriority.basis?.base ?? null,
      R: isScoreable(e.recruitability) ? e.recruitability.value : null,
      F: isScoreable(e.financial) ? e.financial.value : null,
      O: isScoreable(e.opportunity) ? e.opportunity.value : null,
      gR: e.pursuitPriority.basis?.recruitabilityGate ?? null,
      gF: e.pursuitPriority.basis?.financialGate ?? null,
      levelFactor: e.pursuitPriority.basis?.levelAnchor?.factor ?? null,
      comps,
      shares: ob ? Object.fromEntries(Object.entries(ob.components).map(([k, v]) => [k, v.share])) : {},
      pathwayGrade: ob?.components?.playingPathway?.grade ?? null,
      roster: facts.get(e.id)?.roster ?? null,
      division: c.division ?? null,
      strength: num(c.soccer_score),
      netPrice: num(c.net_price),
      academicRating: num(c.academic_rating),
      academicPercentile: scale(c.academic_rating, c.academic_rating_source),
      satAvg: num(c.sat_avg),
      admitRate: num(c.admit_rate),
      majorMatch: majorMatch(c.notable_majors, p.intended_major),
      adm: admissionsEvidence({
        athleteSat, athleteGpa, progSat: num(c.sat_avg), progAdmit: num(c.admit_rate),
      }),
    };
  };

  return {
    athlete: {
      id: def.id, sport: p.sport, academicPriority,
      declaredAcademicPriority: p.academic_strength_priority,
      levelPriority: p.competitive_level_priority,
      playingPriority: p.playing_opportunity_priority,
      gpa: athleteGpa, sat: athleteSat, intendedMajor: p.intended_major ?? null,
      budget: num(p.max_annual_contribution_usd),
      equivalentProgrammeScore: inputs.equivalentProgrammeScore,
      athletePercentile: inputs.athletePercentile ?? null,
    },
    counts: { ...run.counts },
    top: run.pipeline.ranked.slice(0, DEPTH).map(row),
    // Universe-level aggregates, computed inline so nothing large is held.
    universe: (() => {
      const all = run.pipeline.ranked;
      const withMajor = p.intended_major
        ? all.filter((e) => majorMatch(byId.get(e.id)?.notable_majors, p.intended_major)).length : null;
      return { ranked: all.length, majorMatchCount: withMajor };
    })(),
  };
}

function main() {
  const out = arg('out');
  if (!out) { console.error('Usage: a726AcademicDiagnostic.js --out=<file>'); process.exit(2); }
  const ctxCache = new Map();
  const defs = [...V3_ATHLETES, ...W3_ATHLETES];
  const snap = [];
  for (const def of defs) {
    const sport = def.player.sport;
    if (!ctxCache.has(sport)) ctxCache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
    for (const ap of PRIORITIES) {
      const cap = capture({ ctx: ctxCache.get(sport), def, academicPriority: ap });
      snap.push(cap);
      console.log(`${def.id} @academic=${ap}: ranked ${cap.counts.ranked} limited ${cap.counts.limitedData}`
        + ` ineligible ${cap.counts.ineligible}`);
    }
  }
  fs.writeFileSync(out, JSON.stringify(snap));
  console.log(`written ${out}`);
}
main();
