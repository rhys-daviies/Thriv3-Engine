/**
 * What Coach Recruitability says about the real pool.
 *
 * READ-ONLY. It scores, it aggregates, it prints. No ranking, no pursuit
 * priority, no adoption, and no comparison against V1's overall rank - V1
 * answers "which programmes should this athlete pursue" and this layer answers
 * "would this one have them", and diffing the two would be a difference of
 * question rather than of model.
 *
 *   node server/scripts/v2Recruitability.js --fixture=C
 *   node server/scripts/v2Recruitability.js --all
 *   node server/scripts/v2Recruitability.js --all --sensitivity
 */
import { FIXTURES } from './v2Fixtures.js';

const SEASON = '2026';

function usage(code) {
  console.error('Usage: v2Recruitability.js (--fixture=<A-H> | --all) [--json] [--top=<n>] [--sensitivity]');
  console.error('');
  console.error('  --fixture=C    one athlete');
  console.error('  --all          all eight baseline athletes');
  console.error('  --sensitivity  re-run each fixture across the heuristic parameter grid');
  console.error('  --json         the full report rather than a summary');
  process.exit(code);
}

const dist = (d) => (d ? `min ${d.min} p25 ${d.p25} med ${d.median} p75 ${d.p75} max ${d.max} (mean ${d.mean}, n=${d.n})` : 'nothing scoreable');

function printReport(f, rep, top, row) {
  const a = rep.athlete;
  console.log('');
  console.log(`${f.id}`);
  console.log(`  ${f.why.slice(0, 150)}`);
  console.log(`  athlete: rating ${a.rating} · ${a.position} · entry ${a.entryYear} · ${a.isInternational ? 'international' : 'domestic'}`);
  const c = rep.counts;
  console.log(`  pool ${c.programmes}: scoreable ${c.scoreable} (${(c.scoreableRate * 100).toFixed(1)}%)  MEASURED ${(c.measuredRate * 100).toFixed(1)}% PARTIAL ${(c.partialRate * 100).toFixed(1)}%`);
  console.log(`  recruitability:        ${dist(rep.recruitability)}`);
  console.log(`  athletic plausibility: ${dist(rep.athleticPlausibility)}`);
  console.log(`  positional opportunity:${dist(rep.positionalOpportunity)}`);
  console.log(`  international:         ${dist(rep.internationalPropensity)}`);
  console.log(`  unscoreable: ${Object.entries(rep.unscoreableReasons).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
  console.log(`  violations (plausibility<0.15 but R>0.3): ${rep.violations.lowPlausibilityHighRecruitability}${rep.violations.lowPlausibilityHighRecruitability ? `  e.g. ${rep.violations.examples.join(', ')}` : ''}`);
  console.log('  by division:');
  for (const [d, s] of Object.entries(rep.byDivision)) {
    console.log(`    ${String(d).padEnd(10)} n=${String(s.n).padStart(4)}  scoreable ${String(Math.round(s.scoreableRate * 100)).padStart(3)}%  median R ${s.recruitability ? s.recruitability.median : '-'}`);
  }
  if (top > 0) {
    const scored = rep.results.filter((r) => r.result.ok).map(row).sort((x, y) => y.recruitability - x.recruitability);
    console.log(`  most recruitable ${Math.min(top, scored.length)}:`);
    for (const r of scored.slice(0, top)) {
      console.log(`    ${r.recruitability.toFixed(3)} ${String(r.name).slice(0, 28).padEnd(29)}${String(r.division).padEnd(9)} A=${r.athleticPlausibility.toFixed(2)} d=${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(2)} opp=${String(r.positionalOpportunity).padEnd(6)} vac=${r.vacatedStarters}/${r.typicalStarters} arr=${r.arrivals}`);
    }
  }
}

const GRID = [
  ['atLevel', 'atLevel', [0.70, 0.75, 0.80, 0.85, 0.90]],
  ['decay', 'decay', [0.07, 0.08, 0.09, 0.12, 0.16]],
  ['phi', 'phi', [0.2, 0.35, 0.5]],
  ['floor', 'floor', [0.4, 0.5, 0.6, 0.75]],
  ['arrivalClaim', 'opportunityWeights.arrivalClaim', [0.3, 0.6, 1.0]],
  ['maxClaimShare', 'opportunityWeights.maxClaimShare', [0.5, 0.75, 0.9]],
];

function overridesFor(pathName, value) {
  if (!pathName.includes('.')) return { [pathName]: value };
  const [outer, inner] = pathName.split('.');
  return { [outer]: { [inner]: value } };
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const json = args.includes('--json');
  const sensitivity = args.includes('--sensitivity');
  const one = args.find((a) => a.startsWith('--fixture='))?.split('=')[1]?.toUpperCase();
  const top = Number(args.find((a) => a.startsWith('--top='))?.split('=')[1] ?? 5);
  if (all === Boolean(one)) usage(2);
  const chosen = all ? FIXTURES : FIXTURES.filter((f) => f.id.toUpperCase().startsWith(`${one}-`));
  if (!chosen.length) usage(2);

  const { default: db } = await import('../db/client.js');
  const { canonicalPosition } = await import('../../shared/positions.js');
  const { buildPoolContext } = await import('../lib/v2/poolContext.js');
  const { evaluateRecruitability, recruitabilityRow } = await import('../lib/v2/recruitabilityRun.js');

  const cache = new Map();
  /**
   * A7.46. The canonical builder. The hand-rolled copy this replaces predated
   * the appearance columns, so `buildPositionIndex` threw and this script had
   * not run since 38dc671; it also omitted `marketIndex` and `centroids`, so
   * the recruiting-market component had nothing to read even before that.
   */
  const contextFor = (sport) => {
    if (!cache.has(sport)) cache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
    return cache.get(sport);
  };

  const out = [];
  for (const f of chosen) {
    const sport = f.player.sport;
    const ctx = contextFor(sport);
    if (!ctx.colleges.length) {
      console.error(`Refusing to report ${f.id}: no active ${sport} programmes in this database.`);
      process.exit(3);
    }
    const athlete = {
      sport,
      rating: f.player.football_ability,
      position: canonicalPosition(f.player.position),
      entryYear: f.player.recruiting_class_year,
      isInternational: f.player.origin === 'International',
    };
    const rep = evaluateRecruitability({ athlete, ...ctx });
    out.push({ fixture: f.id, report: rep });
    if (!json) printReport(f, rep, top, recruitabilityRow);

    if (sensitivity) {
      console.log('  sensitivity (median R over the scoreable pool, and scoreable %):');
      for (const [label, pathName, values] of GRID) {
        const line = values.map((v) => {
          const r = evaluateRecruitability({ athlete, ...ctx, overrides: overridesFor(pathName, v) });
          return `${v}=${r.recruitability ? r.recruitability.median.toFixed(3) : '-'}/${(r.counts.scoreableRate * 100).toFixed(0)}%`;
        }).join('  ');
        console.log(`    ${label.padEnd(15)} ${line}`);
      }
    }
  }

  if (json) {
    console.log(JSON.stringify(out.map((o) => ({
      ...o, report: { ...o.report, results: o.report.results.map(recruitabilityRow) },
    })), null, 2));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
