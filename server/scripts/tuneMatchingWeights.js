#!/usr/bin/env node
/**
 * Searches for the weights that rank real placements best.
 *
 * Split-sample: weights are chosen on one half of the athletes and scored on
 * the other, so what gets reported is out-of-sample. Tuning six weights
 * against a few hundred outcomes will happily find a configuration that fits
 * the noise, and the holdout is the only thing that shows when it has.
 *
 * Read server/lib/matchingBacktest.js before acting on any number here: two of
 * the six criteria cannot be tested by this method at all, and one is circular.
 * The search only moves the four it can actually see.
 *
 *   node server/scripts/tuneMatchingWeights.js
 *   node server/scripts/tuneMatchingWeights.js --sport womens-soccer --trials 400
 */
import db from '../db/client.js';
import {
  loadBacktestData, buildRosterIndex, buildTestSet, inBand,
  runConfig, summarise, printTable, mulberry32,
} from '../lib/matchingBacktest.js';
import { DEFAULT_WEIGHTS } from '../../shared/matching/weights.js';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SPORT = arg('sport', 'mens-soccer');
const SAMPLE = Number(arg('sample', 600));
const TRIALS = Number(arg('trials', 250));
const BAND = Number(arg('band', 5));
const SEED = Number(arg('seed', 20260825));

/**
 * Only the criteria this method can see are searched. Academic and
 * affordability sit at their neutral prior throughout — the roster rows carry
 * no GPA and no family budget — so moving their weights would be fitting
 * noise, and any value the search returned would be meaningless.
 */
const SEARCHABLE = ['athletic', 'roster', 'programQuality', 'geography'];

/** Mean percentile of the true school. Robust to the long tail in a way MRR is not. */
const objective = (s) => s.mean;

function main() {
  const rng = mulberry32(SEED);
  const { colleges, roster2024, roster2025 } = loadBacktestData(db, SPORT);
  const rosterIndex = buildRosterIndex(roster2024);
  const all = buildTestSet({ colleges, roster2024, roster2025, sport: SPORT, sample: SAMPLE, rng });

  const half = Math.floor(all.length / 2);
  const train = all.slice(0, half);
  const test = all.slice(half);
  const poolsFor = (set) => set.map((t) => inBand(colleges, t.athlete.level, BAND));
  const trainPools = poolsFor(train);
  const testPools = poolsFor(test);

  console.log(`\nsport: ${SPORT}   band: +/-${BAND}   trials: ${TRIALS}`);
  console.log(`train ${train.length} athletes / holdout ${test.length}, seed ${SEED}`);
  console.log(`searching: ${SEARCHABLE.join(', ')}  (academic and affordability are untestable here and left alone)\n`);

  const score = (overrides, set, pools) =>
    summarise('', runConfig({ testSet: set, colleges, rosterIndex, overrides, bandPools: pools }));

  const results = [];
  const seen = new Set();
  const consider = (overrides, label) => {
    const key = SEARCHABLE.map((k) => overrides[k]).join('|');
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ label, overrides, train: score(overrides, train, trainPools) });
  };

  // The current defaults, as the thing to beat.
  consider({ ...DEFAULT_WEIGHTS }, 'defaults');

  // Random search over a coarse grid. Weights are relative, so the grid only
  // needs to span an order of magnitude.
  const GRID = [0, 5, 10, 15, 20, 25, 30, 40];
  for (let i = 0; i < TRIALS; i++) {
    const o = { ...DEFAULT_WEIGHTS };
    for (const k of SEARCHABLE) o[k] = GRID[Math.floor(rng() * GRID.length)];
    if (SEARCHABLE.every((k) => o[k] === 0)) continue;
    consider(o, `random ${i}`);
  }

  results.sort((a, b) => objective(b.train) - objective(a.train));
  const best = results[0];

  // Coordinate refinement around the winner, still scored on train only.
  const refined = [];
  for (const k of SEARCHABLE) {
    for (const v of GRID) {
      const o = { ...best.overrides, [k]: v };
      const key = SEARCHABLE.map((kk) => o[kk]).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      refined.push({ label: `refine ${k}=${v}`, overrides: o, train: score(o, train, trainPools) });
    }
  }
  const pool = [...results, ...refined].sort((a, b) => objective(b.train) - objective(a.train));

  const shortlist = [pool[0], pool[1], pool[2], results.find((r) => r.label === 'defaults')].filter(Boolean);
  const rows = [];
  for (const c of shortlist) {
    const held = score(c.overrides, test, testPools);
    const w = SEARCHABLE.map((k) => `${k.slice(0, 4)}=${c.overrides[k]}`).join(' ');
    rows.push({ ...held, label: `${c.label.padEnd(12)} ${w}` });
  }

  console.log('=== holdout performance (weights chosen on the training half) ===');
  printTable(rows);

  console.log('\n  best configuration on the holdout:');
  const winner = rows.reduce((a, b) => (b.mean > a.mean ? b : a));
  console.log(`    ${winner.label}`);
  console.log(`    mean percentile ${(100 * winner.mean).toFixed(1)}%, r@25 ${(100 * winner.r25).toFixed(1)}%, MRR ${winner.mrr.toFixed(4)}\n`);
}

main();
