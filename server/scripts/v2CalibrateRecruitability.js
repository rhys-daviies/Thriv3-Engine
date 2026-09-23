/**
 * A7.7.4: choose R-C's remaining heuristics on a measured plateau.
 *
 * READ-ONLY. It runs the real pipeline under parameter overrides and reports
 * what moves. Nothing is fitted to an outcome, because no labelled
 * coach-response data exists: the order of selection is semantic correctness,
 * then stability, then coverage, and ranking aesthetics last.
 *
 *   node server/scripts/v2CalibrateRecruitability.js --weights
 *   node server/scripts/v2CalibrateRecruitability.js --evidence
 *   node server/scripts/v2CalibrateRecruitability.js --distance
 */
import db from '../db/client.js';
import { canonicalPosition } from '../../shared/positions.js';
import { normaliseAthlete } from '../../shared/matching/pool.js';
import { buildPoolContext } from '../lib/v2/poolContext.js';
import { runPursuit } from '../lib/v2/pursuitRun.js';
import { coachRecruitability, scoreable, unscoreable, GRADE, REASON } from '../../shared/matching/v2/index.js';
import { FIXTURES } from './v2Fixtures.js';

const SEASON = '2026';
const N = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const jac = (a, b) => { const A = new Set(a); const B = new Set(b); const i = [...A].filter((x) => B.has(x)).length; return i / (A.size + B.size - i); };
const corr = (x, y) => {
  const n = x.length; if (n < 3) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n; const my = y.reduce((a, b) => a + b, 0) / n;
  let c = 0; let vx = 0; let vy = 0;
  for (let i = 0; i < n; i += 1) { const d = x[i] - mx; const e = y[i] - my; c += d * e; vx += d * d; vy += e * e; }
  return (vx === 0 || vy === 0) ? null : c / Math.sqrt(vx * vy);
};

/**
 * THE HARD INVARIANT, evaluated for every candidate before anything else.
 *
 * Two programmes identical but for their positional evidence: one measured
 * low, one unknown. If the unknown one scores higher, the candidate rewards
 * missing evidence and is rejected whatever else it does.
 */
function rewardsMissingEvidence(weights) {
  const A = scoreable({ value: 1, grade: GRADE.MEASURED, coverage: 1, basis: { delta: 0.5 } });
  const low = scoreable({ value: 0.05, grade: GRADE.MEASURED, coverage: 1, basis: {} });
  const strong = scoreable({ value: 0.8, grade: GRADE.MEASURED, coverage: 1, basis: {} });
  const unknown = unscoreable({ reason: REASON.NO_MINUTES_HISTORY, missing: ['starterEvidence'] });
  const measured = coachRecruitability({ athletic: A, positional: low, market: strong, weights });
  const missing = coachRecruitability({ athletic: A, positional: unknown, market: strong, weights });
  return missing.ok && measured.ok && missing.value > measured.value;
}

function fixtureRun(f, ctxCache, overrides) {
  const sport = f.player.sport;
  if (!ctxCache.has(sport)) ctxCache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
  const ctx = ctxCache.get(sport);
  const position = canonicalPosition(f.player.position);
  const v1Shape = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
  return runPursuit({
    athlete: {
      label: { id: f.id }, v1Shape,
      recruitability: {
        sport, rating: f.player.football_ability, position,
        entryYear: f.player.recruiting_class_year,
        isInternational: f.player.origin === 'International',
        homeState: f.player.state ?? null,
      },
      opportunity: {
        sport, position, rating: f.player.football_ability, intendedMajor: null,
        priorityRanking: null, competitiveLevelPriority: null, playingOpportunityPriority: null,
      },
    },
    sport, colleges: ctx.colleges, ctx, recruitabilityOverrides: overrides,
  });
}

/** The criteria of section 10, for one fixture under one parameter set. */
function metrics(rep, baseTop) {
  const top = rep.pipeline.actionable;
  const ranked = rep.pipeline.ranked;
  const withS = ranked.filter((r) => typeof r.soccerScore === 'number');
  const t10 = top.slice(0, 10);
  return {
    ranked: rep.counts.ranked,
    limited: rep.counts.limitedData,
    j25: baseTop ? jac(baseTop.slice(0, 25), top.slice(0, 25).map((r) => r.id)) : 1,
    j100: baseTop ? jac(baseTop, top.map((r) => r.id)) : 1,
    strengthCorr: corr(withS.map((r) => r.soccerScore), withS.map((r) => r.pursuitPriority.value)),
    gateR: rep.gateFiringRate.recruitability,
    medR: rep.layers.recruitability?.median ?? null,
    eliteTop25: top.slice(0, 25).filter((r) => (r.soccerScore ?? 0) >= 60).length,
    maxStrTop10: Math.max(...t10.map((r) => r.soccerScore ?? 0)),
    minRTop10: Math.min(...t10.map((r) => r.recruitability.value)),
    ids: top.map((r) => r.id),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('Usage: --weights | --evidence | --distance'); process.exit(2); }
  const cache = new Map();
  const KEY = ['A', 'C', 'F', 'G', 'H'];
  const chosen = FIXTURES.filter((f) => KEY.includes(f.id[0]));

  const sweep = (label, sets) => {
    console.log(`\n== ${label} ==`);
    const base = new Map();
    for (const f of chosen) base.set(f.id, fixtureRun(f, cache, sets[0].overrides).pipeline.actionable.map((r) => r.id));
    for (const { name, overrides, weights } of sets) {
      const fair = weights ? rewardsMissingEvidence(weights) : false;
      const rows = chosen.map((f) => {
        const rep = fixtureRun(f, cache, overrides);
        return { f: f.id[0], ...metrics(rep, base.get(f.id)) };
      });
      const avg = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0) / rows.length;
      const elite = rows.find((r) => r.f === 'C');
      console.log(`  ${name.padEnd(22)}${fair ? ' REWARDS-MISSING  ' : ' fair  '}`
        + `ranked ${String(Math.round(avg('ranked'))).padStart(5)}  J25 ${N(avg('j25'), 2)}  J100 ${N(avg('j100'), 2)}`
        + `  corr ${N(avg('strengthCorr'), 2)}  gateR ${N(avg('gateR'), 2)}  medR ${N(avg('medR'), 2)}`
        + `  C:elite25 ${elite.eliteTop25} maxStr ${N(elite.maxStrTop10, 1)} minR ${N(elite.minRTop10, 2)}`);
    }
  };

  if (args.includes('--weights')) {
    sweep('POSITIONAL / MARKET WEIGHT', [
      [0.75, 0.25], [0.90, 0.10], [0.85, 0.15], [0.80, 0.20], [0.70, 0.30],
      [0.65, 0.35], [0.60, 0.40], [0.55, 0.45], [0.50, 0.50],
    ].map(([p, m]) => ({
      name: `${p.toFixed(2)} / ${m.toFixed(2)}`,
      weights: { positional: p, market: m },
      overrides: { behaviourWeights: { positional: p, market: m } },
    })));
  }

  if (args.includes('--evidence')) {
    sweep('MINIMUM ARRIVALS', [8, 4, 6, 10, 12].map((v) => ({
      name: `minArrivals ${v}`, overrides: { minArrivals: v },
    })));
    sweep('PSEUDO-COUNT (shrinkage)', [10, 5, 8, 12, 15, 20].map((v) => ({
      name: `pseudoCount ${v}`, overrides: { pseudoCount: v },
    })));
  }

  if (args.includes('--distance')) {
    sweep('NEAR BAND', [300, 150, 200, 250, 400, 500].map((v) => ({
      name: `nearBandKm ${v}`, overrides: { nearBandKm: v },
    })));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
