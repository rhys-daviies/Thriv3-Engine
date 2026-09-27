/**
 * A7.36 Track 2: what Playing Pathway does to real ranked lists, and what a
 * set of SHADOW probes would do to them.
 *
 *   node server/scripts/a736PathwayCases.js --out=/tmp/a736c.json
 *
 * READ-ONLY. The probes in `PROBES` are DIAGNOSTIC INSTRUMENTS, not candidate
 * repairs. They exist to locate which part of the component carries the
 * defect, and A7.36 is forbidden from selecting a winner among them. Each is
 * passed through the documented `opportunityOverrides` seam, so production
 * constants are never mutated.
 */
import fs from 'node:fs';
import db from '../db/client.js';
import { buildPoolContext } from '../lib/v2/poolContext.js';
import { normaliseAthlete } from '../../shared/matching/pool.js';
import { canonicalPosition } from '../../shared/positions.js';
import { buildValidationAthlete, isScoreable } from '../../shared/matching/v2/index.js';
import { runPursuit } from '../lib/v2/pursuitRun.js';
import { returningDepthFor } from '../lib/v2/rosterEvidence.js';
import { V3_ATHLETES } from './v3Athletes.js';
import { W3_ATHLETES } from './w3Athletes.js';

const arg = (k, d = null) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const SEASON = '2026';

/** The three profiles the brief names, plus their women's equivalents. */
const CASES = ['B-elite-balanced', 'C-strong-playing-focused', 'D-developmental-balanced'];

/**
 * DIAGNOSTIC PROBES. Each isolates one suspected mechanism by disabling it.
 *
 *   control          production, unmodified
 *   noCompetition    rotation only - removes the returning-count term entirely
 *   noRotation       competition only - removes the programme trait
 *
 * `noCompetition` and `noRotation` are reached through `competitionShare`,
 * which is the documented seam. Neither is a proposal: a pathway made only of
 * a programme's three-year-old rotation habit answers nothing about the entry
 * year, and one made only of competition doubles down on the count under
 * suspicion. They bracket the defect.
 */
const PROBES = [
  { id: 'control', overrides: {} },
  { id: 'noCompetition', overrides: { competitionShare: 0 } },
  { id: 'noRotation', overrides: { competitionShare: 1 } },
  /**
   * The constants sweep, to separate "the shape is wrong" from "the numbers
   * are wrong". If the confound survives every setting, it is structural.
   */
  { id: 'unknownWeight1.0', overrides: { unknownWeight: 1.0 } },
  { id: 'halfAt1.5', overrides: { halfAt: 1.5 } },
  /**
   * NEUTRALISATION, the measuring stick rather than a proposal. Playing
   * Pathway keeps its weight in name and loses it in effect, so the rank
   * difference against the control IS the component's contribution to the
   * ordering. Nothing else in Opportunity moves, so a programme that rises
   * here was being HELD DOWN by pathway and one that falls was being carried
   * by it.
   */
  { id: 'pathwayNeutral', overrides: { valueWeights: { playingPathway: 1e-6, programmeTrajectory: 0.35 } } },
];

function athleteFor(def) {
  const p = def.player;
  const v1Shape = normaliseAthlete({ ...p, preferred_divisions: '[]', preferred_conferences: '[]' });
  const { athlete } = buildValidationAthlete({
    record: p, v1Shape, position: canonicalPosition(p.position), label: def.id,
    profile: {
      competitiveLevelPriority: p.competitive_level_priority,
      playingOpportunityPriority: p.playing_opportunity_priority,
      academicStrengthPriority: p.academic_strength_priority,
    },
  });
  return { athlete, p };
}

/** Flatten one ranked list to the fields the diagnostic reads. */
function rowsOf(run, ctx, position, entryYear) {
  const out = [];
  for (const e of run.pipeline.ranked) {
    const opp = e.opportunity;
    const pathway = isScoreable(opp) ? opp.basis?.components?.playingPathway ?? null : null;
    const bucket = ctx.rosterIndex?.get(e.name)?.positions?.get(position) ?? null;
    const returning = bucket ? returningDepthFor(bucket, entryYear) : null;
    out.push({
      rank: e.rank,
      name: e.name,
      division: e.division,
      soccerScore: typeof e.soccerScore === 'number' ? e.soccerScore : null,
      pursuit: e.pursuitPriority?.value ?? null,
      opportunity: isScoreable(opp) ? opp.value : null,
      recruitability: isScoreable(e.recruitability) ? e.recruitability.value : null,
      financial: isScoreable(e.financial) ? e.financial.value : null,
      pathway: pathway?.value ?? null,
      pathwayShare: pathway?.share ?? null,
      positional: e.recruitability?.basis?.positionalEvidence ?? null,
      /**
       * A7.18 keeps the positional SIGNAL and its CONTRIBUTION apart on
       * purpose, and the diagnostic has to read the right one. The signal is
       * what positionalOpportunity said; the contribution is what it was
       * worth after `positionalSupport` mapped it. Both are captured so the
       * overlap question can be asked of the signal rather than of the prior.
       */
      positionalValue: e.recruitability?.basis?.signals?.find((x) => x.key === 'positionalOpportunity')?.value ?? null,
      positionalContribution: e.recruitability?.basis?.positionalContribution ?? null,
      vacatedStarters: e.recruitability?.basis?.positional?.vacatedStarters ?? null,
      positionRows: bucket?.rows ?? 0,
      positionUnreadable: bucket?.unreadable ?? 0,
      /** A7.37. Undefined on a pre-repair tree, which is how the A/B tells them apart. */
      pathwayGrade: isScoreable(opp) ? (opp.basis?.components?.playingPathway?.grade ?? null) : null,
      rotationOnly: isScoreable(opp) ? Boolean(opp.basis?.components?.playingPathway?.rotationOnly) : false,
      returning: returning?.total ?? null,
      returningUnknown: returning?.unknown ?? null,
    });
  }
  return out;
}

export function runCases() {
  const ctxCache = new Map();
  const out = [];
  for (const [defs, sport] of [[V3_ATHLETES, 'mens-soccer'], [W3_ATHLETES, 'womens-soccer']]) {
    if (!ctxCache.has(sport)) ctxCache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
    const ctx = ctxCache.get(sport);
    for (const def of defs) {
      if (!CASES.some((c) => def.id.endsWith(c))) continue;
      const { athlete, p } = athleteFor(def);
      const position = canonicalPosition(p.position);
      const entryYear = p.recruiting_class_year ?? null;
      const probes = {};
      for (const probe of PROBES) {
        const run = runPursuit({
          athlete, sport, colleges: ctx.colleges, ctx, opportunityOverrides: probe.overrides,
        });
        probes[probe.id] = rowsOf(run, ctx, position, entryYear);
      }
      out.push({ id: def.id, sport, position, entryYear, probes });
      console.log(`${def.id}: ${Object.keys(probes).length} probes, ${probes.control.length} ranked`);
    }
  }
  return out;
}

if (arg('out')) {
  const cases = runCases();
  fs.writeFileSync(arg('out'), JSON.stringify({ season: SEASON, cases }, null, 1));
  console.log('written', arg('out'));
}
