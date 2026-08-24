#!/usr/bin/env node
/**
 * Does the matching model rank real placements above chance?
 *
 * Until now nothing has ever measured that. The old scoring constants
 * (ability <=70, academic <=15, starters x5, position x2) were chosen by
 * hand and never checked against an outcome, so "is this ranking any good"
 * had no answer.
 *
 * THE TEST SET is a temporal split, not a random one. Every athlete who
 * appears on a 2025 roster but not on the same school's 2024 roster is a real
 * 2025 arrival. We reconstruct the coarse signal that athlete would have
 * given the intake form, rank all programmes in their sport using ONLY 2024
 * data, and ask where their actual school landed.
 *
 * WHAT THIS CAN AND CANNOT VALIDATE. Read this before quoting a number.
 *
 *   geography     Clean. Hometown is used to build the athlete and nothing
 *                 else, so any lift is real signal.
 *   roster        Clean. Opportunity is computed from the 2024 roster; the
 *                 arrival being predicted is not in it.
 *   athletic      Circular by construction, and knowingly so. We have no
 *                 independent rating for these athletes, so ability is
 *                 inferred from the level they play at, quantised to the same
 *                 1-10 slider the form uses. That maps ~1,150 programmes onto
 *                 ten buckets, so it is a coarse hint rather than the answer,
 *                 but its lift is inflated and must not be quoted as
 *                 validation.
 *   quality       Same derivation as athletic, same caveat.
 *   academic      Untestable here. Roster rows carry no GPA or test score, so
 *                 the criterion sits at its neutral prior throughout.
 *   affordability Untestable here, for the same reason: no family budget.
 *
 * What IS a fair comparison is old model against new model on identical
 * synthetic athletes, since both receive exactly the same inputs.
 *
 *   node server/scripts/backtestMatching.js
 *   node server/scripts/backtestMatching.js --sport womens-soccer --sample 2000
 *   node server/scripts/backtestMatching.js --ablate
 */
import db from '../db/client.js';
import { buildRosterIndex, rankMatches, qualityPercentiles, applyEligibility } from '../../shared/matching/pool.js';
import { resolveWeights, CRITERIA, CRITERION_KEYS } from '../../shared/matching/weights.js';
import { normaliseState } from '../../shared/matching/geo.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const SPORT = arg('sport', 'mens-soccer');
const SAMPLE = Number(arg('sample', 1500));
const SEED = Number(arg('seed', 20260825));
const ABLATE = process.argv.includes('--ablate');

/** Deterministic PRNG — a backtest that samples differently each run cannot be compared to itself. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hometown strings arrive in three dialects — "La Canada, CA", AP style
 * "Bolingbrook, Ill.", and international "Leeds, England". Only the first two
 * resolve to a US state; international players are dropped from the test set
 * rather than guessed at.
 */
const AP_STATES = {
  ala: 'AL', alaska: 'AK', ariz: 'AZ', ark: 'AR', calif: 'CA', colo: 'CO', conn: 'CT',
  del: 'DE', fla: 'FL', ga: 'GA', hawaii: 'HI', idaho: 'ID', ill: 'IL', ind: 'IN',
  iowa: 'IA', kan: 'KS', kans: 'KS', ky: 'KY', la: 'LA', maine: 'ME', md: 'MD',
  mass: 'MA', mich: 'MI', minn: 'MN', miss: 'MS', mo: 'MO', mont: 'MT', neb: 'NE',
  nebr: 'NE', nev: 'NV', ohio: 'OH', okla: 'OK', ore: 'OR', pa: 'PA', tenn: 'TN',
  tex: 'TX', utah: 'UT', va: 'VA', vt: 'VT', wash: 'WA', wis: 'WI', wyo: 'WY',
  'n.c': 'NC', 'n.d': 'ND', 'n.h': 'NH', 'n.j': 'NJ', 'n.m': 'NM', 'n.y': 'NY',
  'r.i': 'RI', 's.c': 'SC', 's.d': 'SD', 'w.va': 'WV', 'd.c': 'DC',
};

function stateFromHometown(hometown) {
  if (!hometown || hometown === '-') return null;
  const tail = hometown.split(',').pop()?.trim();
  if (!tail) return null;
  const direct = normaliseState(tail);
  if (direct) return direct;
  const key = tail.toLowerCase().replace(/\.$/, '').replace(/\s+/g, '');
  return AP_STATES[key] || null;
}

// ---------------------------------------------------------------------------
// The model as it stands today, reproduced for comparison.
// ---------------------------------------------------------------------------

/**
 * src/lib/playerAnalysis.js as of 2026-08-25, scored over the same pool.
 *
 * Returns a ranking of the FULL pool, not just the schools that survive its
 * filters: everything it excludes is appended below everything it kept. Any
 * other treatment flatters it, because comparing "rank within your own
 * shortlist" against "rank within all 1,151" rewards a model simply for
 * throwing options away.
 */
function legacyRank({ athlete, colleges, cohortFor }) {
  const soccerTarget = athlete.level;
  const importance = athlete.academicImportance === 'Not Important' || athlete.academicImportance == null
    ? null : Number(athlete.academicImportance);

  let filtered = colleges.filter((c) => c.active !== 0);
  if (athlete.divisions?.length) filtered = filtered.filter((c) => athlete.divisions.includes(c.division));
  if (importance != null) filtered = filtered.filter((c) => c.academic_rating != null && c.academic_rating >= importance);
  if (soccerTarget != null) {
    filtered = filtered.filter((c) => c.soccer_score != null && c.soccer_score >= soccerTarget - 20 && c.soccer_score <= soccerTarget + 20);
  }

  const scored = filtered.map((c) => {
    const cohort = cohortFor(c.name);
    const starters = cohort?.starters || 0;
    const pos = (cohort?.starters || 0) + (cohort?.squad || 0);
    const closeness = soccerTarget != null && c.soccer_score != null
      ? Math.max(0, 70 - Math.abs(c.soccer_score - soccerTarget) * 3) : 60;
    const academic = importance != null && c.academic_rating != null
      ? Math.min(15, 10 + (c.academic_rating - importance) * 2) : 10;
    return { name: c.name, score: Math.min(100, Math.round(closeness + academic + starters * 5 + pos * 2)) };
  });
  scored.sort((a, b) => b.score - a.score);
  const kept = new Set(scored.map((r) => r.name));
  for (const c of colleges) if (!kept.has(c.name)) scored.push({ name: c.name, score: -1, filteredOut: true });
  return scored;
}

// ---------------------------------------------------------------------------

function loadData() {
  const colleges = db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(SPORT);
  const roster2024 = db.prepare("SELECT college_name, player_name, position, minutes_played, estimated_graduation_year FROM roster_players WHERE sport = ? AND season = '2024'").all(SPORT);
  const roster2025 = db.prepare("SELECT college_name, player_name, position, hometown FROM roster_players WHERE sport = ? AND season = '2025'").all(SPORT);
  return { colleges, roster2024, roster2025 };
}

function buildTestSet({ colleges, roster2024, roster2025, rng }) {
  const byName = new Map(colleges.map((c) => [c.name, c]));
  const schools2024 = new Set(roster2024.map((r) => r.college_name));
  const present2024 = new Set(roster2024.map((r) => `${r.college_name}|${r.player_name}`));

  const candidates = [];
  for (const r of roster2025) {
    const college = byName.get(r.college_name);
    if (!college || college.soccer_score == null) continue;
    // Absence from 2024 only means "arrived" if we actually hold that school's
    // 2024 roster; otherwise it means we never scraped it.
    if (!schools2024.has(r.college_name)) continue;
    if (present2024.has(`${r.college_name}|${r.player_name}`)) continue;
    const position = String(r.position || '').toUpperCase();
    if (!position || position === 'UNKNOWN') continue;
    const state = stateFromHometown(r.hometown);
    if (!state) continue;

    candidates.push({
      trueSchool: r.college_name,
      athlete: {
        sport: SPORT,
        // The intake form gives a 1-10 slider, so the athlete's level is only
        // ever known to the nearest ten points. Quantising here is what keeps
        // the circularity coarse: ~1,150 programmes collapse to ten buckets.
        level: Math.min(100, Math.max(10, Math.round(college.soccer_score / 10) * 10)),
        position,
        classYear: 2025,
        academicImportance: 'Not Important',
        gpa: null, sat: null, act: null,
        budgetRange: null,
        state,
        divisions: [],
        conferences: [],
      },
    });
  }

  // Deterministic shuffle, then take the sample.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, SAMPLE);
}

function evaluate(ranked, trueSchool, poolSize) {
  const idx = ranked.findIndex((r) => r.name === trueSchool);
  if (idx < 0) return { rank: null, percentile: 0, excluded: true, poolSize };
  return {
    rank: idx + 1,
    // 1.0 means ranked first out of the pool.
    percentile: poolSize > 1 ? 1 - idx / (poolSize - 1) : 1,
    // Present only because the tail of filtered-out schools was appended —
    // the model would never have shown this athlete their own school.
    excluded: Boolean(ranked[idx].filteredOut),
    poolSize,
  };
}

function summarise(label, evals, totalPool) {
  const n = evals.length;
  const excluded = evals.filter((e) => e.excluded).length;
  const pcts = evals.map((e) => e.percentile).sort((a, b) => a - b);
  const median = pcts[Math.floor(n / 2)];
  const mean = pcts.reduce((s, v) => s + v, 0) / n;
  const at = (k) => evals.filter((e) => e.rank !== null && e.rank <= k).length / n;
  const mrr = evals.reduce((s, e) => s + (e.rank ? 1 / e.rank : 0), 0) / n;
  return { label, n, excluded, median, mean, r10: at(10), r25: at(25), r100: at(100), mrr, totalPool };
}

function printTable(rows) {
  const pct = (v) => `${(100 * v).toFixed(1)}%`;
  console.log(`\n  ${'model'.padEnd(30)} ${'excl'.padStart(6)} ${'median %ile'.padStart(12)} ${'mean %ile'.padStart(10)} ${'r@10'.padStart(7)} ${'r@25'.padStart(7)} ${'r@100'.padStart(7)} ${'MRR'.padStart(7)}`);
  console.log(`  ${'-'.repeat(30)} ${'-'.repeat(6)} ${'-'.repeat(12)} ${'-'.repeat(10)} ${'-'.repeat(7)} ${'-'.repeat(7)} ${'-'.repeat(7)} ${'-'.repeat(7)}`);
  for (const r of rows) {
    console.log(`  ${r.label.padEnd(30)} ${String(r.excluded).padStart(6)} ${pct(r.median).padStart(12)} ${pct(r.mean).padStart(10)} ${pct(r.r10).padStart(7)} ${pct(r.r25).padStart(7)} ${pct(r.r100).padStart(7)} ${r.mrr.toFixed(4).padStart(7)}`);
  }
}

/**
 * The ability band both models would consider, used to neutralise the one
 * circular term when comparing them.
 */
const BAND = Number(arg('band', 20));

function inBand(colleges, level) {
  return colleges.filter((c) => c.soccer_score != null && Math.abs(c.soccer_score - level) <= BAND);
}

function main() {
  const rng = mulberry32(SEED);
  const { colleges, roster2024, roster2025 } = loadData();
  const rosterIndex = buildRosterIndex(roster2024);
  const testSet = buildTestSet({ colleges, roster2024, roster2025, rng });

  console.log(`\nsport: ${SPORT}`);
  console.log(`pool: ${colleges.length} active programmes`);
  console.log(`test set: ${testSet.length} real 2025 arrivals (sampled, seed ${SEED})`);
  console.log(`opportunity computed from the ${roster2024.length} row 2024 roster only`);

  const cohortFor = (athlete) => (name) => rosterIndex.get(name)?.cohorts.get(`${athlete.classYear}|${athlete.position}`) || null;

  // -------------------------------------------------------------------------
  // A. Full pool.
  // -------------------------------------------------------------------------
  const fullRows = [];
  const runs = [{ label: 'new model', overrides: null }];
  if (ABLATE) for (const { key, label } of CRITERIA) runs.push({ label: `  minus ${label}`, overrides: { [key]: 0 } });

  for (const run of runs) {
    const evals = testSet.map((t) => {
      const weights = resolveWeights({ academicImportance: t.athlete.academicImportance, overrides: run.overrides });
      const { results } = rankMatches({ athlete: t.athlete, colleges, rosterIndex, weights });
      return evaluate(results, t.trueSchool, colleges.length);
    });
    fullRows.push(summarise(run.label, evals, colleges.length));
  }
  fullRows.push(summarise('old model', testSet.map((t) =>
    evaluate(legacyRank({ athlete: t.athlete, colleges, cohortFor: cohortFor(t.athlete) }), t.trueSchool, colleges.length)),
    colleges.length));
  fullRows.push(summarise('random baseline', testSet.map(() => {
    const rank = 1 + Math.floor(rng() * colleges.length);
    return { rank, percentile: 1 - (rank - 1) / (colleges.length - 1), excluded: false };
  }), colleges.length));

  console.log(`\n=== A. Ranking the full pool ===`);
  console.log(`  Dominated by athletic fit, which is circular here: the synthetic athlete's`);
  console.log(`  ability was inferred from the level they play at. Read for exclusions and`);
  console.log(`  sanity, not as evidence one model fits better than the other.`);
  printTable(fullRows);

  // -------------------------------------------------------------------------
  // B. Within the ability band — the discriminating test.
  // -------------------------------------------------------------------------
  const bandRows = [];
  const bandRuns = [{ label: 'new model', overrides: null }];
  if (ABLATE) for (const { key, label } of CRITERIA) bandRuns.push({ label: `  minus ${label}`, overrides: { [key]: 0 } });

  const bandPools = testSet.map((t) => inBand(colleges, t.athlete.level));
  const usable = testSet.map((t, i) => bandPools[i].some((c) => c.name === t.trueSchool));
  const usableCount = usable.filter(Boolean).length;

  for (const run of bandRuns) {
    const evals = [];
    testSet.forEach((t, i) => {
      if (!usable[i]) return;
      const pool = bandPools[i];
      const weights = resolveWeights({ academicImportance: t.athlete.academicImportance, overrides: run.overrides });
      const { results } = rankMatches({ athlete: t.athlete, colleges: pool, rosterIndex, weights });
      evals.push(evaluate(results, t.trueSchool, pool.length));
    });
    bandRows.push(summarise(run.label, evals, null));
  }
  {
    const evals = [];
    testSet.forEach((t, i) => {
      if (!usable[i]) return;
      const pool = bandPools[i];
      const ranked = legacyRank({ athlete: t.athlete, colleges: pool, cohortFor: cohortFor(t.athlete) });
      evals.push(evaluate(ranked, t.trueSchool, pool.length));
    });
    bandRows.push(summarise('old model', evals, null));
  }
  {
    const evals = [];
    testSet.forEach((t, i) => {
      if (!usable[i]) return;
      const n = bandPools[i].length;
      const rank = 1 + Math.floor(rng() * n);
      evals.push({ rank, percentile: n > 1 ? 1 - (rank - 1) / (n - 1) : 1, excluded: false });
    });
    bandRows.push(summarise('random baseline', evals, null));
  }

  const meanBand = Math.round(bandPools.reduce((s2, p2) => s2 + p2.length, 0) / bandPools.length);
  console.log(`\n=== B. Ranking within the +/-${BAND} ability band (mean pool ${meanBand}) ===`);
  console.log(`  ${usableCount} of ${testSet.length} athletes usable — the rest play at a level the`);
  console.log(`  band excludes. Athletic fit is near-constant across these candidates, so`);
  console.log(`  the ordering is decided by the criteria that are NOT circular here:`);
  console.log(`  roster opportunity (from 2024 data) and geography (from hometown).`);
  printTable(bandRows);

  console.log(`\n  "excl" counts athletes whose real school the model would never have shown.`);
  console.log(`  Percentile is 1.0 when the real school ranked first in that pool.\n`);
}

main();
