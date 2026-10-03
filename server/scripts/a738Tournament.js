/**
 * A7.38: the single-component fallback tournament, as a SHADOW.
 *
 *   node server/scripts/a738Tournament.js --out=/tmp/a738.json
 *
 * READ-ONLY. Nothing here is imported by production and no production
 * constant is touched. The four candidates differ ONLY in what Playing Pathway
 * returns when exactly one half is scoreable, so the expensive part - running
 * the frozen A7.37 components over every programme-position cell at four entry
 * years - is done ONCE and the four combination rules are applied to the same
 * evidence. Any difference between candidates is therefore the rule and
 * nothing else.
 *
 * The blend when both halves score is identical in all four, per the brief.
 */
import fs from 'node:fs';
import db from '../db/client.js';
import { buildPoolContext } from '../lib/v2/poolContext.js';
import { returningDepthFor } from '../lib/v2/rosterEvidence.js';
import {
  squadRotation, returningCompetition, typicalStarters, isScoreable, percentileOf,
} from '../../shared/matching/v2/index.js';
import { COMPETITION_SHARE } from '../../shared/matching/v2/opportunityRules.js';
import { eligibilityRuleFor, ELIGIBILITY_MODEL, maxAttainableLastSeason } from '../../shared/eligibility.js';

const arg = (k, d = null) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const SEASON = '2026';
const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];
const SPORTS = ['mens-soccer', 'womens-soccer'];
const ENTRY_YEARS = [2027, 2028, 2029, 2030];

/** B's anchor. Frozen in the preregistration; the midpoint of the constructed scale, not a pool statistic. */
export const B_ANCHOR = 0.5;

/**
 * The four rules. Each takes the two component RESULTS and returns
 * `{ value, state }` where state is one of BOTH / COMPETITION_ONLY /
 * ROTATION_ONLY / REFUSED. `priors` supplies C's medians.
 */
export const CANDIDATES = {
  A: (c, r) => {
    if (c !== null && r !== null) return { value: (COMPETITION_SHARE * c) + ((1 - COMPETITION_SHARE) * r), state: 'BOTH' };
    if (c !== null) return { value: c, state: 'COMPETITION_ONLY' };
    if (r !== null) return { value: r, state: 'ROTATION_ONLY' };
    return { value: null, state: 'REFUSED' };
  },
  B: (c, r) => {
    if (c !== null && r !== null) return { value: (COMPETITION_SHARE * c) + ((1 - COMPETITION_SHARE) * r), state: 'BOTH' };
    if (c !== null) return { value: (COMPETITION_SHARE * c) + ((1 - COMPETITION_SHARE) * B_ANCHOR), state: 'COMPETITION_ONLY' };
    if (r !== null) return { value: ((1 - COMPETITION_SHARE) * r) + (COMPETITION_SHARE * B_ANCHOR), state: 'ROTATION_ONLY' };
    return { value: null, state: 'REFUSED' };
  },
  C1: (c, r, p) => priorRule(c, r, p.c1Competition, p.c1Rotation),
  C2: (c, r, p) => priorRule(c, r, p.c2Competition, p.c2Rotation),
  D: (c, r) => {
    if (c !== null && r !== null) return { value: (COMPETITION_SHARE * c) + ((1 - COMPETITION_SHARE) * r), state: 'BOTH' };
    return { value: null, state: 'REFUSED' };
  },
};

function priorRule(c, r, competitionPrior, rotationPrior) {
  if (c !== null && r !== null) return { value: (COMPETITION_SHARE * c) + ((1 - COMPETITION_SHARE) * r), state: 'BOTH' };
  if (c !== null) {
    if (rotationPrior === null) return { value: null, state: 'REFUSED' };
    return { value: (COMPETITION_SHARE * c) + ((1 - COMPETITION_SHARE) * rotationPrior), state: 'COMPETITION_ONLY' };
  }
  if (r !== null) {
    if (competitionPrior === null) return { value: null, state: 'REFUSED' };
    return { value: ((1 - COMPETITION_SHARE) * r) + (COMPETITION_SHARE * competitionPrior), state: 'ROTATION_ONLY' };
  }
  return { value: null, state: 'REFUSED' };
}

const median = (xs) => {
  const s = [...xs].filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

/** One pass of the frozen A7.37 components over the whole universe. */
export function evidenceFor(sport, entryYear) {
  const ctx = buildPoolContext({ db, sport, season: SEASON });
  const rows = [];
  const maxMemo = new Map();
  const maxFor = (division) => {
    if (!maxMemo.has(division)) maxMemo.set(division, maxAttainableLastSeason({ season: ctx.rosterSeason, division }));
    return maxMemo.get(division);
  };
  for (const college of ctx.colleges) {
    const prog = ctx.rosterIndex.get(college.name) ?? null;
    const rosterOnFile = ctx.rosterProgrammes.has(college.name);
    const ruled = eligibilityRuleFor({ division: college.division, season: entryYear })?.model !== ELIGIBILITY_MODEL.UNKNOWN;
    let strengthPct = null;
    if (Number.isFinite(Number(college.soccer_score))) {
      try { strengthPct = percentileOf(Number(college.soccer_score), sport); } catch { strengthPct = null; }
    }
    for (const position of POSITIONS) {
      const bucket = prog?.positions?.get(position) ?? null;
      const rotation = squadRotation({ sport, position, division: college.division, programme: college.name, rosterOnFile });
      const competition = returningCompetition({
        returning: bucket ? returningDepthFor(bucket, entryYear) : null,
        position,
        places: typicalStarters(sport, position),
        rosterOnFile: Boolean(bucket && bucket.rows > 0),
        eligibilityRuled: entryYear !== null && ruled,
        positionRows: bucket?.rows ?? null,
        unreadable: bucket?.unreadable ?? 0,
        entryYear,
        rosterSeason: ctx.rosterSeason,
        maxLastSeason: maxFor(college.division),
      });
      rows.push({
        programme: college.name,
        division: college.division,
        position,
        strength: Number.isFinite(Number(college.soccer_score)) ? Number(college.soccer_score) : null,
        strengthPct,
        competition: isScoreable(competition) ? competition.value : null,
        competitionGrade: isScoreable(competition) ? competition.grade : 'UNSCOREABLE',
        competitionReason: isScoreable(competition) ? null : competition.reason,
        rotation: isScoreable(rotation) ? rotation.value : null,
        rotationGrade: isScoreable(rotation) ? rotation.grade : 'UNSCOREABLE',
        readableShare: isScoreable(competition) ? competition.basis.readableShare : null,
        horizonDepth: isScoreable(competition) ? competition.basis.horizonDepth : null,
        returning: bucket ? returningDepthFor(bucket, entryYear).total : null,
        positionRows: bucket?.rows ?? 0,
        positionUnreadable: bucket?.unreadable ?? 0,
      });
    }
  }
  return rows;
}

/**
 * C's priors. Computed on cells where the component IS scoreable, which is the
 * only population that could supply one - and immediately the first thing to
 * look at when judging whether such a prior is defensible at all.
 */
export function priorsFor(rows) {
  const byPos = (key, pos) => median(rows.filter((r) => r.position === pos).map((r) => r[key]));
  const global = (key) => median(rows.map((r) => r[key]));
  return {
    c1Competition: global('competition'),
    c1Rotation: global('rotation'),
    byPosition: Object.fromEntries(POSITIONS.map((p) => [p, {
      competition: byPos('competition', p), rotation: byPos('rotation', p),
    }])),
  };
}

export function runTournament() {
  const out = {};
  for (const sport of SPORTS) {
    out[sport] = {};
    for (const entryYear of ENTRY_YEARS) {
      const rows = evidenceFor(sport, entryYear);
      const priors = priorsFor(rows);
      const scored = {};
      for (const id of ['A', 'B', 'C1', 'C2', 'D']) {
        scored[id] = rows.map((r) => {
          const p = {
            c1Competition: priors.c1Competition,
            c1Rotation: priors.c1Rotation,
            c2Competition: priors.byPosition[r.position].competition,
            c2Rotation: priors.byPosition[r.position].rotation,
          };
          const res = CANDIDATES[id](r.competition, r.rotation, p);
          return { ...r, pathway: res.value, pathwayState: res.state };
        });
      }
      out[sport][entryYear] = { priors, candidates: scored };
      console.log(`${sport} ${entryYear}: ${rows.length} cells`);
    }
  }
  return out;
}

if (arg('out')) {
  const r = runTournament();
  fs.writeFileSync(arg('out'), JSON.stringify(r));
  console.log('written', arg('out'));
}
