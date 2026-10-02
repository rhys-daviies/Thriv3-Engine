/**
 * A8.1 — THE FINAL EVALUATIVE TOURNAMENT, COMPUTED FROM THE FROZEN ARTIFACTS.
 *
 * READ-ONLY. It opens no database, scores nothing and changes no ranking. Every
 * number below is derived from `A8.0-baseline.json` and `A8.0B-extension.json`,
 * which is what makes the tournament reproducible: the instrument was frozen
 * and digested before anybody looked at a result.
 *
 *   node server/scripts/a8Tournament.js --section=universe|shape|authority|v1|boundary|all
 *
 * -- WHY NO THRESHOLDS ARE INVENTED HERE -----------------------------------
 *
 * §D of the brief forbids inventing thresholds after seeing results. So this
 * file computes DESCRIPTIVE statistics and names the two things that were
 * preregistered as pathologies - a tie block large enough to make ranking
 * meaningless, and saturation against a floor or ceiling - leaving every other
 * judgement to the report, where it can be argued with.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBaseline } from './a8Baseline.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

export const BANDS = Object.freeze([
  ['Top25', 1, 25], ['26-50', 26, 50], ['51-100', 51, 100],
  ['101-250', 101, 250], ['251+', 251, Infinity],
]);

export function byFixture(artifact) {
  const m = new Map();
  for (const c of decodeBaseline(artifact)) {
    if (!m.has(c.fixtureId)) m.set(c.fixtureId, []);
    m.get(c.fixtureId).push(c);
  }
  return m;
}

const q = (sorted, p) => (sorted.length
  ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

/**
 * MIDRANKS, because these layers are massively tied.
 *
 * Fixture A's Financial value is exactly 1.0 in 757 of its 824 ranked cells -
 * an athlete whose family can pay for almost anything finds almost everything
 * affordable - and only 68 distinct values exist across the pool. A Spearman
 * that assigned 1..n within those ties would be correlating Pursuit against
 * the order the ties happened to be iterated in, and the first draft of this
 * file duly reported rho = -0.906 for Financial: an artifact of tie-breaking
 * that reads exactly like a major finding about layer authority.
 *
 * So every rank here is an AVERAGE rank over its tie group, and the
 * correlation is the Pearson correlation of those midranks - which is the
 * definition Spearman reduces to when there are no ties, and the correct
 * statistic when there are.
 */
export function midranks(values) {
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
    const r = ((i + 1) + (j + 1)) / 2;
    for (let k = i; k <= j; k += 1) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

/** Tie-corrected Spearman: Pearson on midranks. */
export function spearman(pairs) {
  if (pairs.length < 3) return null;
  const a = midranks(pairs.map((p) => p.a));
  const b = midranks(pairs.map((p) => p.b));
  const r = corr(a, b);
  return r === null ? null : Number(r.toFixed(4));
}

/**
 * How much of a layer's own distribution is a single value.
 *
 * Reported beside every correlation, because a rho computed over a layer that
 * is one number 92% of the time is a statistic about 8% of the pool and must
 * not be read as a statement about the layer.
 */
export function tieMass(values) {
  const m = new Map();
  for (const v of values) { const k = v.toFixed(6); m.set(k, (m.get(k) || 0) + 1); }
  return Number((Math.max(...m.values()) / values.length).toFixed(3));
}

/** Pearson correlation, used only between a layer value and the Pursuit value. */
export function corr(a, b) {
  const n = a.length;
  if (n < 3) return null;
  const ma = mean(a); const mb = mean(b);
  let c = 0; let va = 0; let vb = 0;
  for (let i = 0; i < n; i += 1) {
    const d = a[i] - ma; const e = b[i] - mb;
    c += d * e; va += d * d; vb += e * e;
  }
  return (va === 0 || vb === 0) ? null : Number((c / Math.sqrt(va * vb)).toFixed(3));
}

/** §C. One athlete's universe, rankability and per-band layer aggregates. */
export function universeSummary(rows, athlete) {
  const sup = rows.filter((r) => r.universe === 'SUPPORTED');
  const ranked = rows.filter((r) => r.rankingState === 'RANKED').sort((a, b) => a.rank - b.rank);
  const lim = rows.filter((r) => r.rankingState === 'LIMITED_DATA');
  const pp = ranked.map((r) => r.pursuit).sort((a, b) => a - b);
  const bands = BANDS.map(([label, lo, hi]) => {
    const slice = ranked.filter((r) => r.rank >= lo && r.rank <= hi);
    const L = (k) => {
      const v = slice.map((r) => r[k].value).filter((x) => typeof x === 'number');
      return v.length ? Number(mean(v).toFixed(3)) : null;
    };
    const cov = (k) => {
      const v = slice.map((r) => r[k].coverage).filter((x) => typeof x === 'number');
      return v.length ? Number(mean(v).toFixed(3)) : null;
    };
    const measured = slice.filter((r) => r.pursuitGrade === 'MEASURED').length;
    return {
      band: label,
      n: slice.length,
      pursuit: slice.length ? Number(mean(slice.map((r) => r.pursuit)).toFixed(3)) : null,
      R: L('recruitability'), F: L('financial'), O: L('opportunity'),
      covR: cov('recruitability'), covF: cov('financial'), covO: cov('opportunity'),
      measuredGrade: measured,
      divisions: slice.reduce((acc, r) => { acc[r.division] = (acc[r.division] || 0) + 1; return acc; }, {}),
    };
  });
  return {
    fixtureId: athlete.fixtureId,
    sport: athlete.sport,
    pool: rows.length,
    supported: sup.length,
    ranked: ranked.length,
    rankablePct: Number((100 * ranked.length / sup.length).toFixed(1)),
    limitedSupported: lim.filter((r) => r.universe === 'SUPPORTED').length,
    limitedUnsupported: lim.filter((r) => r.universe === 'UNSUPPORTED').length,
    pursuit: { min: q(pp, 0), p25: q(pp, 0.25), median: q(pp, 0.5), p75: q(pp, 0.75), max: pp[pp.length - 1] ?? null },
    bands,
  };
}

/**
 * §D. Discrimination.
 *
 * `effectivelyIndistinguishable` counts adjacent pairs closer than 0.001 -
 * a thousandth of the whole scale, which is below anything a ranking could
 * defend as a difference. It is a descriptive count, not a pass mark.
 */
export const INDISTINGUISHABLE = 0.001;

export function shapeSummary(rows, athlete) {
  const ranked = rows.filter((r) => r.rankingState === 'RANKED').sort((a, b) => a.rank - b.rank);
  const vals = ranked.map((r) => r.pursuit);
  const uniq = new Set(vals.map((v) => v.toFixed(6)));
  const blocks = new Map();
  for (const v of vals) { const k = v.toFixed(6); blocks.set(k, (blocks.get(k) || 0) + 1); }
  const largestTie = Math.max(0, ...blocks.values());
  let adjacentClose = 0;
  for (let i = 1; i < vals.length; i += 1) if (vals[i - 1] - vals[i] < INDISTINGUISHABLE) adjacentClose += 1;
  const at = (n) => (ranked[n - 1]?.pursuit ?? null);
  const spread = (a, b) => ((at(a) !== null && at(b) !== null) ? Number((at(a) - at(b)).toFixed(4)) : null);
  const floor = vals.filter((v) => v <= 0.01).length;
  const ceiling = vals.filter((v) => v >= 0.99).length;
  return {
    fixtureId: athlete.fixtureId,
    ranked: ranked.length,
    uniqueValues: uniq.size,
    tiedCells: ranked.length - uniq.size,
    largestTieBlock: largestTie,
    adjacentWithin0_001: adjacentClose,
    rank1: at(1), rank25: at(25), rank100: at(100), rank250: at(250), rankLast: vals[vals.length - 1] ?? null,
    compression25to100: spread(25, 100),
    compression100to250: spread(100, 250),
    nearFloor: floor,
    nearCeiling: ceiling,
  };
}

/** §E. How much each layer explains the final ordering. */
export function authoritySummary(rows, athlete) {
  const ranked = rows.filter((r) => r.rankingState === 'RANKED').sort((a, b) => a.rank - b.rank);
  const pur = ranked.map((r) => r.pursuit);
  const L = (k) => ranked.map((r) => r[k].value);
  const rhoOf = (k) => spearman(ranked.map((r) => ({ a: r.pursuit, b: r[k].value })));
  /**
   * "Materially weak" has to mean weak RELATIVE TO WHAT IS AVAILABLE, and a
   * strict-less-than percentile over a tied distribution says every cell at
   * the modal value is in the bottom quartile. Fixture A's Financial is 1.0 in
   * 92% of cells, so the first draft reported all 100 of its top 100 as
   * financially weak - when the truth is the opposite. Midranks fix it: a cell
   * at the modal value sits at the MIDDLE of its tie group, not the bottom.
   */
  const pctOf = (k) => {
    const v = L(k); const mr = midranks(v);
    return new Map(ranked.map((r, i) => [r.programmeId, mr[i] / v.length]));
  };
  const pR = pctOf('recruitability'); const pF = pctOf('financial'); const pO = pctOf('opportunity');
  const top100 = ranked.filter((r) => r.rank <= 100);
  const weakIn = (k, p) => top100.filter((r) => p.get(r.programmeId) < 0.25).length;
  return {
    fixtureId: athlete.fixtureId,
    corr: { R: corr(L('recruitability'), pur), F: corr(L('financial'), pur), O: corr(L('opportunity'), pur) },
    tieMass: { R: tieMass(L('recruitability')), F: tieMass(L('financial')), O: tieMass(L('opportunity')) },
    rho: { R: rhoOf('recruitability'), F: rhoOf('financial'), O: rhoOf('opportunity') },
    /** Top-100 programmes sitting in the bottom quartile of a layer's own distribution. */
    top100WeakR: weakIn('recruitability', pR),
    top100WeakF: weakIn('financial', pF),
    top100WeakO: weakIn('opportunity', pO),
  };
}

function main() {
  const section = process.argv.slice(2).find((a) => a.startsWith('--section='))?.split('=')[1] ?? 'all';
  const base = read('docs/validation/A8.0-baseline.json');
  const rows = byFixture(base);
  const show = (s) => section === 'all' || section === s;

  if (show('universe')) {
    console.log('=== §C UNIVERSE & RANKABILITY ===');
    const t = base.athletes.map((a) => {
      const u = universeSummary(rows.get(a.fixtureId), a);
      return {
        athlete: u.fixtureId.split('-')[0], sport: u.sport.replace('-soccer', ''),
        pool: u.pool, supported: u.supported, ranked: u.ranked, 'rankable%': u.rankablePct,
        limSup: u.limitedSupported, limUnsup: u.limitedUnsupported,
        min: u.pursuit.min?.toFixed(3), med: u.pursuit.median?.toFixed(3), max: u.pursuit.max?.toFixed(3),
      };
    });
    console.table(t);
  }
  if (show('shape')) {
    console.log('=== §D RANKING SHAPE ===');
    console.table(base.athletes.map((a) => {
      const s = shapeSummary(rows.get(a.fixtureId), a);
      return {
        athlete: s.fixtureId.split('-')[0], ranked: s.ranked, unique: s.uniqueValues,
        tied: s.tiedCells, maxTie: s.largestTieBlock, adj0_001: s.adjacentWithin0_001,
        r1: s.rank1?.toFixed(3), r25: s.rank25?.toFixed(3), r100: s.rank100?.toFixed(3), r250: s.rank250?.toFixed(3),
        c25_100: s.compression25to100, c100_250: s.compression100to250,
        floor: s.nearFloor, ceil: s.nearCeiling,
      };
    }));
  }
  if (show('authority')) {
    console.log('=== §E LAYER AUTHORITY (rho vs final Pursuit order) ===');
    console.table(base.athletes.map((a) => {
      const s = authoritySummary(rows.get(a.fixtureId), a);
      return {
        athlete: s.fixtureId.split('-')[0],
        rhoR: s.rho.R, rhoF: s.rho.F, rhoO: s.rho.O,
        tieR: s.tieMass.R, tieF: s.tieMass.F, tieO: s.tieMass.O,
        'top100 weakR': s.top100WeakR, 'weakF': s.top100WeakF, 'weakO': s.top100WeakO,
      };
    }));
  }
}

if (process.argv[1] && process.argv[1].endsWith('a8Tournament.js')) main();

/**
 * §K. Classify a selected outlier.
 *
 * The categories are the brief's. The rules are mechanical so that a cell's
 * classification does not depend on who is reading it, and deliberately
 * conservative: EXPECTED is the default, and a cell is only promoted when a
 * stated condition holds.
 *
 * PURSUIT_WEIGHTS are {recruitability 0.5, financial 0.2, opportunity 0.3}, so
 * "dominant layer" is the largest weighted contribution, not the largest raw
 * value - the layers are not on a common scale and the weights are what the
 * ranking actually uses.
 */
export const PURSUIT_W = Object.freeze({ recruitability: 0.5, financial: 0.2, opportunity: 0.3 });

export function dominantLayer(cell) {
  const c = Object.entries(PURSUIT_W)
    .map(([k, w]) => [k, w * (cell[k].value ?? 0)])
    .sort((a, b) => b[1] - a[1]);
  return { layer: c[0][0], contribution: Number(c[0][1].toFixed(4)), spread: Number((c[0][1] - c[2][1]).toFixed(4)) };
}

export function classifyOutlier(cell, { rPct, oPct, fPct }) {
  const dom = dominantLayer(cell);
  const cov = ['recruitability', 'financial', 'opportunity']
    .reduce((s, k) => s + (cell[k].coverage ?? 0), 0) / 3;
  const reasons = [];
  let verdict = 'EXPECTED';

  /**
   * The one condition this tournament found that asserts more than the
   * evidence holds: a MEASURED majorFit of 0 inferred from absence in a
   * share-thresholded list. Only reachable when the athlete declared a major.
   */
  if (cell.majorFit?.state === 'SCOREABLE' && cell.majorFit.value === 0) {
    verdict = 'REVIEW_REQUIRED';
    reasons.push('majorFit scored a MEASURED 0 from absence in a partial major list');
  }
  if (cell.rank <= 100 && rPct < 0.25) {
    if (verdict === 'EXPECTED') verdict = 'EXPLAINABLE_BUT_SURPRISING';
    reasons.push('top-100 with Recruitability in its own bottom quartile');
  }
  if (cell.rank <= 100 && cov < 0.6) {
    if (verdict === 'EXPECTED') verdict = 'EXPLAINABLE_BUT_SURPRISING';
    reasons.push(`top-100 on mean layer coverage ${cov.toFixed(2)}`);
  }
  if (dom.spread > 0.35) {
    if (verdict === 'EXPECTED') verdict = 'EXPLAINABLE_BUT_SURPRISING';
    reasons.push(`one layer contributes ${dom.spread.toFixed(2)} more than the weakest`);
  }
  return { verdict, dominant: dom.layer, contribution: dom.contribution, meanCoverage: Number(cov.toFixed(3)), reasons };
}
