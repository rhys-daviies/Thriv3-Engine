/**
 * A7.36 Track 1: what Playing Pathway scores across the whole universe.
 *
 *   node server/scripts/a736PathwayUniverse.js --out=/tmp/a736u.json
 *
 * READ-ONLY DIAGNOSTIC. Imports the production components and calls them with
 * production inputs; changes nothing and is imported by no production module.
 *
 * -- WHY THIS TABLE IS KEYED ON (SPORT, POSITION, PROGRAMME) AND NOT ON AN
 *    ATHLETE ------------------------------------------------------------
 *
 * Playing Pathway reads `sport`, `position`, `division`, `programme`,
 * `rosterOnFile` and `entryYear`. NOTHING ELSE. It is entirely
 * athlete-independent once position and entry year are fixed - two athletes at
 * the same position entering the same year get identical pathway values at
 * every programme in the universe. So the honest unit of analysis is the
 * programme-position cell, and an athlete-keyed table would repeat each cell.
 *
 * This is itself a finding worth stating: a component named for the ATHLETE's
 * opportunity varies with nothing about the athlete except which position they
 * play and when they arrive.
 */
import fs from 'node:fs';
import db from '../db/client.js';
import { buildPoolContext } from '../lib/v2/poolContext.js';
import { returningDepthFor } from '../lib/v2/rosterEvidence.js';
import {
  squadRotation, returningCompetition, playingPathway, typicalStarters, isScoreable, percentileOf,
} from '../../shared/matching/v2/index.js';
import { eligibilityRuleFor, ELIGIBILITY_MODEL, maxAttainableLastSeason } from '../../shared/eligibility.js';

const arg = (k, d = null) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const SEASON = '2026';
const ENTRY_YEAR = 2028;
const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];
const SPORTS = ['mens-soccer', 'womens-soccer'];

/** Players at this position whose eligibility ENDS before the entry year. */
function departingBefore(bucket, entryYear) {
  if (!bucket) return { total: 0, starters: 0 };
  let total = 0; let starters = 0;
  for (const [last, n] of bucket.byLastSeason) if (last < entryYear) total += n;
  for (const [last, n] of bucket.starterLastSeason) if (last < entryYear) starters += n;
  return { total, starters };
}

export function universeFor(sport, { entryYear = ENTRY_YEAR, season = SEASON, overrides = {} } = {}) {
  const ctx = buildPoolContext({ db, sport, season });
  const rows = [];
  for (const college of ctx.colleges) {
    const programmeRoster = ctx.rosterIndex.get(college.name) ?? null;
    const rosterOnFile = ctx.rosterProgrammes.has(college.name);
    const ruled = eligibilityRuleFor({ division: college.division, season: entryYear })?.model
      !== ELIGIBILITY_MODEL.UNKNOWN;
    let strengthPct = null;
    if (Number.isFinite(Number(college.soccer_score))) {
      try { strengthPct = percentileOf(Number(college.soccer_score), sport); } catch { strengthPct = null; }
    }
    for (const position of POSITIONS) {
      const bucket = programmeRoster?.positions?.get(position) ?? null;
      const returning = bucket ? returningDepthFor(bucket, entryYear) : null;
      const departing = departingBefore(bucket, entryYear);
      const rotation = squadRotation({
        sport, position, division: college.division, programme: college.name, rosterOnFile,
      });
      const competition = returningCompetition({
        returning, position, places: typicalStarters(sport, position),
        rosterOnFile: Boolean(bucket && bucket.rows > 0),
        eligibilityRuled: entryYear !== null && ruled,
        /**
         * A7.37. Mirrors `opportunityRun.js` exactly. An instrument that does
         * not pass production's inputs is not measuring production - so these
         * were added here the moment they were added there. The PRE-A7.37
         * numbers this script produced are preserved in A7.37-measurements.json
         * and in the A7.36 report; re-running it now measures the repair.
         */
        positionRows: bucket?.rows ?? null,
        unreadable: bucket?.unreadable ?? 0,
        entryYear,
        rosterSeason: ctx.rosterSeason ?? null,
        maxLastSeason: maxAttainableLastSeason({ season: ctx.rosterSeason, division: college.division }),
        ...overrides.competition,
      });
      const pathway = playingPathway({ competition, rotation, ...overrides.pathway });
      rows.push({
        sport,
        programme: college.name,
        division: college.division,
        position,
        strength: Number.isFinite(Number(college.soccer_score)) ? Number(college.soccer_score) : null,
        strengthPct,
        // --- pathway and its two halves -------------------------------------
        pathway: isScoreable(pathway) ? pathway.value : null,
        pathwayGrade: isScoreable(pathway) ? pathway.grade : 'UNSCOREABLE',
        pathwayCoverage: isScoreable(pathway) ? pathway.coverage : null,
        usedBoth: isScoreable(pathway) ? Boolean(pathway.basis.usedBoth) : false,
        competition: isScoreable(competition) ? competition.value : null,
        competitionGrade: isScoreable(competition) ? competition.grade : 'UNSCOREABLE',
        competitionReason: isScoreable(competition) ? null : competition.reason,
        rotation: isScoreable(rotation) ? rotation.value : null,
        rotationGrade: isScoreable(rotation) ? rotation.grade : 'UNSCOREABLE',
        rotationLevel: isScoreable(rotation) ? rotation.basis.level : null,
        rotationOnly: isScoreable(pathway) ? Boolean(pathway.basis.rotationOnly) : false,
        readableShare: isScoreable(competition) ? competition.basis.readableShare : null,
        horizonDepth: isScoreable(competition) ? competition.basis.horizonDepth : null,
        // --- the roster facts the value is built from -----------------------
        pressure: isScoreable(competition) ? competition.basis.pressure : null,
        typicalStarters: typicalStarters(sport, position),
        returning: returning?.total ?? null,
        returningStarters: returning?.starters ?? null,
        returningSquad: returning?.squad ?? null,
        returningUnknown: returning?.unknown ?? null,
        departing: departing.total,
        departingStarters: departing.starters,
        // --- completeness ---------------------------------------------------
        positionRows: bucket?.rows ?? 0,
        positionUnreadable: bucket?.unreadable ?? 0,
        positionUnknownState: bucket?.unknownState ?? 0,
        programmeRows: programmeRoster?.rows ?? 0,
        programmeUnreadable: programmeRoster?.unreadable ?? 0,
        rosterOnFile,
      });
    }
  }
  return rows;
}

if (arg('out')) {
  const out = {};
  for (const sport of SPORTS) out[sport] = universeFor(sport);
  fs.writeFileSync(arg('out'), JSON.stringify({ entryYear: ENTRY_YEAR, season: SEASON, universes: out }, null, 1));
  for (const sport of SPORTS) {
    const r = out[sport];
    const scored = r.filter((x) => x.pathway !== null);
    console.log(`${sport}: ${r.length} cells, ${scored.length} scoreable, ${r.length - scored.length} unscoreable`);
  }
  console.log('written', arg('out'));
}
