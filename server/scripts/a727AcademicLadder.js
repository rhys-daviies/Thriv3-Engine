/**
 * A7.27: the academic profile ladder and exposure measurement.
 *
 *   node server/scripts/a727AcademicLadder.js --out=/tmp/a727.json
 *
 * READ-ONLY. It runs the shipped pipeline once per (base athlete, academic
 * profile) and records what the ranking did. It proposes no formula, no
 * threshold and no adjustment; the SAT gap it reports is a subtraction of two
 * numbers already in the database.
 *
 * -- WHY THE LADDER IS ALSO THE PROOF -------------------------------------
 *
 * A7.26 measured that V2 reads no athlete academic credential, on one athlete.
 * This runs seven academic profiles against eight base athletes and checks
 * rank invariance on every pair, so the claim rests on 56 runs rather than on
 * five. If any pair moves, the run says so rather than averaging it away.
 *
 * -- THE BUCKETS ARE DESCRIPTIONS, NOT PROBABILITIES ----------------------
 *
 * "300+ below" is a statement about two integers. It is NOT an admissions
 * probability, NOT a threshold and NOT a claim that the athlete would be
 * refused. A7.27 explicitly forbids reading selectivity as viability, and the
 * bucket names are chosen so that a reader cannot mistake one for the other.
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

const SEASON = '2026';
const arg = (k, d = null) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * THE LADDER. Diagnostic profiles, NOT admissions thresholds and not a claim
 * about what any institution accepts. GPA is on the 4.0 scale the intake form
 * and every V3/W3 fixture already use; SAT is the 1600 scale College
 * Scorecard reports for `sat_avg`, so the two sides are directly comparable.
 */
export const LADDER = Object.freeze([
  { id: 'A-very-strong', gpa: 4.0, sat: 1500 },
  { id: 'B-strong', gpa: 3.8, sat: 1400 },
  { id: 'C-good', gpa: 3.5, sat: 1250 },
  { id: 'D-moderate', gpa: 3.2, sat: 1100 },
  { id: 'E-weak', gpa: 2.8, sat: 950 },
  { id: 'F-very-weak', gpa: 2.2, sat: 800 },
  { id: 'G-extreme-diagnostic', gpa: 1.0, sat: 400 },
]);

/** Descriptive only. See the header. */
export function satBucket(gap) {
  if (gap === null) return 'NO_MEASURED_COMPARISON';
  if (gap >= 50) return 'athlete materially above';
  if (gap > -100) return 'roughly comparable';
  if (gap > -200) return '100-199 below';
  if (gap > -300) return '200-299 below';
  return '300+ below';
}

function majorMatch(notableMajors, intendedMajor) {
  if (!intendedMajor) return null;
  let list = notableMajors;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = null; } }
  if (!Array.isArray(list) || !list.length) return null;
  const want = String(intendedMajor).toLowerCase();
  return list.some((m) => String(m).toLowerCase().includes(want) || want.includes(String(m).toLowerCase()));
}

/**
 * The six evidence shapes A7.27 section 8 requires every design to answer for.
 * Named here so the audit reads them off the data rather than assuming them.
 */
export function evidenceShape({ athleteSat, athleteAct, progSat, progAdmit }) {
  if (athleteSat !== null && progSat !== null) {
    return progAdmit !== null ? 'BOTH_SAT_AND_ADMIT' : 'BOTH_SAT_ONLY';
  }
  if (athleteSat !== null && progSat === null) return progAdmit !== null ? 'ATHLETE_SAT_ADMIT_ONLY' : 'ATHLETE_SAT_NO_PROGRAMME_EVIDENCE';
  if (athleteSat === null && progSat !== null) return 'PROGRAMME_SAT_NO_ATHLETE_SCORE';
  if (athleteAct !== null) return 'ATHLETE_ACT_ONLY_NO_PROGRAMME_ACT';
  if (progAdmit !== null) return 'ADMIT_RATE_ONLY';
  return 'NO_EVIDENCE_EITHER_SIDE';
}

function run({ ctx, def, profile }) {
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
  const athleteAct = num(p.act_score);

  const rows = r.pipeline.ranked.map((e) => {
    const c = byId.get(e.id) ?? {};
    const progSat = num(c.sat_avg);
    const progAdmit = num(c.admit_rate);
    const ob = isScoreable(e.opportunity) ? e.opportunity.basis : null;
    return {
      id: e.id, rank: e.rank, name: e.name,
      P: e.pursuitPriority.value,
      R: isScoreable(e.recruitability) ? e.recruitability.value : null,
      F: isScoreable(e.financial) ? e.financial.value : null,
      O: isScoreable(e.opportunity) ? e.opportunity.value : null,
      division: c.division ?? null,
      strength: num(c.soccer_score),
      netPrice: num(c.net_price),
      academicRating: num(c.academic_rating),
      academicPercentile: scale(c.academic_rating, c.academic_rating_source),
      progSat, progAdmit,
      satGap: (athleteSat !== null && progSat !== null) ? athleteSat - progSat : null,
      majorMatch: majorMatch(c.notable_majors, p.intended_major),
      shape: evidenceShape({ athleteSat, athleteAct, progSat, progAdmit }),
      comps: ob ? Object.fromEntries(Object.entries(ob.components).map(([k, v]) => [k, v.value])) : {},
    };
  });
  return { order: rows.map((x) => x.id), rows, inputs, counts: { ...r.counts } };
}

function main() {
  const out = arg('out');
  if (!out) { console.error('Usage: a727AcademicLadder.js --out=<file>'); process.exit(2); }
  const ctxCache = new Map();
  const bases = [...V3_ATHLETES, ...W3_ATHLETES].filter((a) => /-(A|C|D|E)-/.test(a.id));
  const snap = [];
  let invariant = true;
  for (const def of bases) {
    const sport = def.player.sport;
    if (!ctxCache.has(sport)) ctxCache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
    let first = null;
    for (const profile of LADDER) {
      const res = run({ ctx: ctxCache.get(sport), def, profile });
      /**
       * THE INVARIANCE CHECK, on the ORDER and on every Pursuit value. An
       * ordering that matched while the values moved would still mean the
       * credential was read, so both are compared.
       */
      let moved = null;
      if (first === null) { first = res; } else {
        const byId = new Map(first.rows.map((x) => [x.id, x]));
        let ranks = 0; let maxDp = 0;
        for (const x of res.rows) {
          const o = byId.get(x.id); if (!o) continue;
          if (o.rank !== x.rank) ranks += 1;
          maxDp = Math.max(maxDp, Math.abs(o.P - x.P));
        }
        moved = { rankMovements: ranks, maxAbsDeltaP: maxDp };
        if (ranks !== 0 || maxDp !== 0) invariant = false;
      }
      snap.push({
        base: def.id, sport, profile,
        athlete: {
          ability: def.player.football_ability,
          position: def.player.position,
          budget: num(def.player.max_annual_contribution_usd),
          intendedMajor: def.player.intended_major ?? null,
          academicStrengthPriority: def.player.academic_strength_priority,
          competitiveLevelPriority: def.player.competitive_level_priority,
          playingOpportunityPriority: def.player.playing_opportunity_priority,
          origin: def.player.origin,
          equivalentProgrammeScore: res.inputs.equivalentProgrammeScore,
        },
        counts: res.counts,
        invarianceVsFirst: moved,
        rows: res.rows.slice(0, 100),
        universe: {
          ranked: res.rows.length,
          buckets: res.rows.reduce((acc, x) => {
            const b = satBucket(x.satGap); acc[b] = (acc[b] ?? 0) + 1; return acc;
          }, {}),
        },
      });
      console.log(`${def.id} @ ${profile.id} (gpa ${profile.gpa} sat ${profile.sat}):`
        + ` ranked ${res.counts.ranked}`
        + (moved ? `  invariance: ${moved.rankMovements} movements, max|dP| ${moved.maxAbsDeltaP}` : '  [reference run]'));
    }
  }
  fs.writeFileSync(out, JSON.stringify(snap));
  console.log(`\nRANK INVARIANCE ACROSS THE WHOLE LADDER: ${invariant ? 'HOLDS — no run moved' : 'BROKEN — see above'}`);
  console.log(`written ${out}`);
}
main();
