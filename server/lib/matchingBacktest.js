/**
 * The evidence base for the matching weights.
 *
 * Builds a test set of real recruiting outcomes and measures where a model
 * ranks them. Shared by backtestMatching.js (report one configuration) and
 * tuneMatchingWeights.js (search over many), so the two cannot drift into
 * measuring different things.
 *
 * THE TEST SET is a temporal split. An athlete on a school's 2025 roster who
 * was not on that same school's 2024 roster arrived in 2025. Ranking uses only
 * 2024 data, so nothing about the outcome is visible to the model.
 *
 * WHAT IT CAN AND CANNOT VALIDATE — read before quoting any number:
 *
 *   geography      Clean. Hometown builds the athlete and feeds nothing else.
 *   roster         Clean. Opportunity comes from the 2024 roster; the arrival
 *                  being predicted is not in it.
 *   athletic       Circular, knowingly. No independent rating exists for these
 *                  athletes, so ability is inferred from the level they play
 *                  at and quantised to the form's 1-10 slider. Ten buckets
 *                  across ~1,150 programmes makes it a coarse hint rather than
 *                  the answer, but its lift is inflated regardless.
 *   quality        Same derivation, same caveat.
 *   academic       Untestable. Roster rows carry no GPA or test score.
 *   affordability  Untestable. No family budget.
 *
 * And the deeper limit, which no amount of data fixes: this measures where
 * athletes *ended up*, which is decided as much by who recruited them, who
 * visited, and who offered first as by fit. A school with a hole at the
 * athlete's position may be likelier to *reply* without being likelier to be
 * the eventual destination — and replies are what Phase 1.1 will finally let
 * us measure. Treat this as a floor on quality, not a definition of it.
 */

import { buildRosterIndex, rankMatches } from '../../shared/matching/pool.js';
import { resolveWeights } from '../../shared/matching/weights.js';
import { normaliseState } from '../../shared/matching/geo.js';

/**
 * Hometowns arrive in three dialects: "La Canada, CA", AP style
 * "Bolingbrook, Ill.", and international "Leeds, England". Only the first two
 * resolve to a US state. International players are dropped rather than guessed.
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

export function stateFromHometown(hometown) {
  if (!hometown || hometown === '-') return null;
  const tail = String(hometown).split(',').pop()?.trim();
  if (!tail) return null;
  const direct = normaliseState(tail);
  if (direct) return direct;
  return AP_STATES[tail.toLowerCase().replace(/\.$/, '').replace(/\s+/g, '')] || null;
}

/** Deterministic PRNG. A backtest that samples differently each run cannot be compared to itself. */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildTestSet({ colleges, roster2024, roster2025, sport, sample, rng }) {
  const byName = new Map(colleges.map((c) => [c.name, c]));
  const schools2024 = new Set(roster2024.map((r) => r.college_name));
  const present2024 = new Set(roster2024.map((r) => `${r.college_name}|${r.player_name}`));

  const candidates = [];
  for (const r of roster2025) {
    const college = byName.get(r.college_name);
    if (!college || college.soccer_score == null) continue;
    // Absence from 2024 means "arrived" only where we hold that school's 2024
    // roster; otherwise it means we never scraped it.
    if (!schools2024.has(r.college_name)) continue;
    if (present2024.has(`${r.college_name}|${r.player_name}`)) continue;
    const position = String(r.position || '').toUpperCase();
    if (!position || position === 'UNKNOWN') continue;
    const state = stateFromHometown(r.hometown);
    if (!state) continue;

    candidates.push({
      trueSchool: r.college_name,
      athlete: {
        sport,
        // The form gives a 1-10 slider, so an athlete's level is only ever
        // known to the nearest ten points. Quantising keeps the circularity
        // coarse: ~1,150 programmes collapse onto ten buckets.
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

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return sample ? candidates.slice(0, sample) : candidates;
}

/** Pool restricted to programmes at roughly the athlete's own level. */
export function inBand(colleges, level, band) {
  return colleges.filter((c) => c.soccer_score != null && Math.abs(c.soccer_score - level) <= band);
}

export function evaluate(ranked, trueSchool, poolSize) {
  const idx = ranked.findIndex((r) => r.name === trueSchool);
  if (idx < 0) return { rank: null, percentile: 0, excluded: true };
  return {
    rank: idx + 1,
    percentile: poolSize > 1 ? 1 - idx / (poolSize - 1) : 1,
    // Present only because a tail of filtered-out schools was appended: the
    // model would never actually have shown this athlete their own school.
    excluded: Boolean(ranked[idx].filteredOut),
  };
}

export function summarise(label, evals) {
  const n = evals.length || 1;
  const pcts = evals.map((e) => e.percentile).sort((a, b) => a - b);
  const at = (k) => evals.filter((e) => e.rank !== null && e.rank <= k).length / n;
  return {
    label,
    n: evals.length,
    excluded: evals.filter((e) => e.excluded).length,
    median: pcts[Math.floor(n / 2)] ?? 0,
    mean: pcts.reduce((s, v) => s + v, 0) / n,
    r10: at(10), r25: at(25), r100: at(100),
    mrr: evals.reduce((s, e) => s + (e.rank ? 1 / e.rank : 0), 0) / n,
  };
}

/** Score one weight configuration over a prepared test set. */
export function runConfig({ testSet, colleges, rosterIndex, overrides, band, bandPools }) {
  const evals = [];
  testSet.forEach((t, i) => {
    const pool = bandPools ? bandPools[i] : (band ? inBand(colleges, t.athlete.level, band) : colleges);
    if (!pool.some((c) => c.name === t.trueSchool)) return;
    const weights = resolveWeights({ academicImportance: t.athlete.academicImportance, overrides });
    const { results } = rankMatches({ athlete: t.athlete, colleges: pool, rosterIndex, weights });
    evals.push(evaluate(results, t.trueSchool, pool.length));
  });
  return evals;
}

export function loadBacktestData(db, sport) {
  return {
    colleges: db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport),
    roster2024: db.prepare("SELECT college_name, player_name, position, minutes_played, estimated_graduation_year FROM roster_players WHERE sport = ? AND season = '2024'").all(sport),
    roster2025: db.prepare("SELECT college_name, player_name, position, hometown FROM roster_players WHERE sport = ? AND season = '2025'").all(sport),
  };
}

export { buildRosterIndex };

export function printTable(rows) {
  const pct = (v) => `${(100 * v).toFixed(1)}%`;
  console.log(`\n  ${'model'.padEnd(30)} ${'excl'.padStart(6)} ${'median %ile'.padStart(12)} ${'mean %ile'.padStart(10)} ${'r@10'.padStart(7)} ${'r@25'.padStart(7)} ${'r@100'.padStart(7)} ${'MRR'.padStart(7)}`);
  console.log(`  ${'-'.repeat(30)} ${'-'.repeat(6)} ${'-'.repeat(12)} ${'-'.repeat(10)} ${'-'.repeat(7)} ${'-'.repeat(7)} ${'-'.repeat(7)} ${'-'.repeat(7)}`);
  for (const r of rows) {
    console.log(`  ${r.label.padEnd(30)} ${String(r.excluded).padStart(6)} ${pct(r.median).padStart(12)} ${pct(r.mean).padStart(10)} ${pct(r.r10).padStart(7)} ${pct(r.r25).padStart(7)} ${pct(r.r100).padStart(7)} ${r.mrr.toFixed(4).padStart(7)}`);
  }
}
