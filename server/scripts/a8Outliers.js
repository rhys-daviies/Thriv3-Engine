/**
 * THE BOUNDED REVIEW SET — A8.0 §I.
 *
 * Selects, by rule and before anyone has looked at a ranking, the programmes
 * worth a human or model explaining. The selection is PREREGISTERED so that
 * the review set cannot become "the examples that make V2 look right": every
 * criterion below picks cases that are AWKWARD for the model, and the two
 * disagreement rules are deliberately symmetric so neither direction can be
 * quietly dropped.
 *
 *   node server/scripts/a8Outliers.js
 *   node server/scripts/a8Outliers.js --fixture=A --json
 *
 * Nothing here scores anything. It reads the frozen artifact and names cells.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBaseline } from './a8Baseline.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Ranks either side of a boundary a user will actually perceive. */
export const BOUNDARIES = Object.freeze([25, 50, 100, 250]);

/** How many to take per criterion. Bounded so the set stays reviewable. */
export const PER_CRITERION = 5;

/**
 * A layer disagreement, in the ONE unit that makes layers comparable.
 *
 * The layers are not on a common scale by construction, so "R is high and O is
 * low" is only meaningful against each layer's own distribution. Everything
 * below is therefore computed on within-fixture percentile ranks, never on raw
 * values - comparing a raw 0.7 Recruitability with a raw 0.7 Opportunity would
 * be the same category error as comparing a temperature with a pressure.
 */
function percentiles(rows, get) {
  const vals = rows.map(get).filter((v) => typeof v === 'number').sort((a, b) => a - b);
  return (v) => {
    if (typeof v !== 'number' || !vals.length) return null;
    let lo = 0; let hi = vals.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] < v) lo = m + 1; else hi = m; }
    return lo / vals.length;
  };
}

export function selectOutliers(cells, { perCriterion = PER_CRITERION } = {}) {
  const ranked = cells.filter((c) => c.rankingState === 'RANKED').sort((a, b) => a.rank - b.rank);
  if (!ranked.length) return [];
  const pR = percentiles(ranked, (c) => c.recruitability.value);
  const pF = percentiles(ranked, (c) => c.financial.value);
  const pO = percentiles(ranked, (c) => c.opportunity.value);
  const at = (c) => ({ R: pR(c.recruitability.value), F: pF(c.financial.value), O: pO(c.opportunity.value) });

  const picks = new Map();
  const take = (criterion, rows) => {
    for (const c of rows.slice(0, perCriterion)) {
      const k = c.programmeId;
      if (!picks.has(k)) picks.set(k, { ...c, criteria: [] });
      if (!picks.get(k).criteria.includes(criterion)) picks.get(k).criteria.push(criterion);
    }
  };

  take('TOP_PURSUIT', ranked);

  const gap = (a, b) => ranked
    .map((c) => ({ c, d: (at(c)[a] ?? 0) - (at(c)[b] ?? 0) }))
    .sort((x, y) => y.d - x.d).map((x) => x.c);
  take('HIGH_R_LOW_O', gap('R', 'O'));
  take('LOW_R_HIGH_O', gap('O', 'R'));
  take('HIGH_F_LOW_R', gap('F', 'R'));

  /** The widest spread between any two layers: the cell hardest to narrate. */
  take('WIDEST_LAYER_DISAGREEMENT', ranked
    .map((c) => { const p = at(c); const v = [p.R, p.F, p.O].filter((x) => x !== null); return { c, d: Math.max(...v) - Math.min(...v) }; })
    .sort((x, y) => y.d - x.d).map((x) => x.c));

  for (const b of BOUNDARIES) {
    const pair = ranked.filter((c) => c.rank === b || c.rank === b + 1);
    if (pair.length) take(`BOUNDARY_${b}_${b + 1}`, pair);
  }

  /**
   * Evidence-poor programmes near the top.
   *
   * PARTIAL is not a defect - most cells are PARTIAL - so this cannot simply
   * select on grade. It selects the WEAKEST evidence that nonetheless reached
   * the first 100, which is where a thin case does the most damage.
   */
  take('EVIDENCE_POOR_NEAR_TOP', ranked.filter((c) => c.rank <= 100)
    .map((c) => ({ c, cov: ['recruitability', 'financial', 'opportunity']
      .reduce((s, L) => s + (c[L].coverage ?? 0), 0) }))
    .sort((x, y) => x.cov - y.cov).map((x) => x.c));

  return [...picks.values()].sort((a, b) => a.rank - b.rank);
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const only = args.find((a) => a.startsWith('--fixture='))?.split('=')[1];
  const file = (process.env.A8_BASELINE_FILE ?? '').trim()
    || path.join(root, 'docs/validation/A8.0-baseline.json');
  const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cells = decodeBaseline(baseline);
  const byFixture = new Map();
  for (const c of cells) {
    if (!byFixture.has(c.fixtureId)) byFixture.set(c.fixtureId, []);
    byFixture.get(c.fixtureId).push(c);
  }
  const out = [];
  for (const [fixtureId, rows] of byFixture) {
    if (only && !fixtureId.toUpperCase().startsWith(`${only.toUpperCase()}-`)) continue;
    const picks = selectOutliers(rows);
    out.push({ fixtureId, picks });
    if (json) continue;
    console.log(`\n${fixtureId}   ${picks.length} cells selected`);
    for (const p of picks) {
      console.log(`  #${String(p.rank).padStart(3)} ${p.pursuit.toFixed(3)} ${p.programme.slice(0, 26).padEnd(26)} `
        + `${p.division.padEnd(8)} R=${(p.recruitability.value ?? 0).toFixed(2)} `
        + `F=${(p.financial.value ?? 0).toFixed(2)} O=${(p.opportunity.value ?? 0).toFixed(2)}  ${p.criteria.join(',')}`);
    }
  }
  if (json) console.log(JSON.stringify(out, null, 1));
  else console.log(`\ntotal selected: ${out.reduce((n, o) => n + o.picks.length, 0)} cells across ${out.length} athletes`);
}

if (process.argv[1] && process.argv[1].endsWith('a8Outliers.js')) await main();
