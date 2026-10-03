/**
 * What Financial Viability says about the real pool.
 *
 * READ-ONLY. It scores, it aggregates, it prints. It writes nothing, adopts
 * nothing, produces no ranking and is not reachable from any route.
 *
 * It deliberately does NOT compare its output to V1's rank. V1 answers "which
 * programmes should this athlete pursue" and this layer answers "can this
 * family pay for this one"; a diff between them would be a difference of
 * question, not of model, and presenting it as a result would be misleading.
 *
 *   node server/scripts/v2Financial.js --fixture=C
 *   node server/scripts/v2Financial.js --all
 *   node server/scripts/v2Financial.js --all --json
 */
import { FIXTURES, BASE_PLAYER } from './v2Fixtures.js';

const money = (n) => (n === Infinity ? 'unbounded' : `$${Math.round(n).toLocaleString('en-US')}`);
const range = ([lo, hi]) => (lo === hi ? money(lo) : `${money(lo)}-${money(hi)}`);

function usage(code) {
  console.error('Usage: v2Financial.js (--fixture=<A-H> | --all) [--json] [--top=<n>]');
  console.error('');
  console.error('  --fixture=C   one athlete');
  console.error('  --all         all eight baseline athletes');
  console.error('  --json        the full report rather than a summary');
  console.error('  --top=10      how many example programmes to print per fixture (default 6)');
  process.exit(code);
}

function printFixture(f, report, top, financialRow) {
  const a = report.athlete;
  console.log('');
  console.log(`${f.id} — ${f.why}`);
  console.log(`  athlete: budget ${a.budgetRange ?? '(none)'} · state ${a.state ?? '(none)'} · ${a.isInternational ? 'international' : 'domestic'}`);
  const c = report.counts;
  console.log(`  pool ${c.programmes}: scoreable ${c.scoreable} (${(c.scoreableRate * 100).toFixed(1)}%), unscoreable ${c.unscoreable} (${(c.unscoreableRate * 100).toFixed(1)}%)`);
  console.log(`  grades: MEASURED ${(c.measuredRate * 100).toFixed(1)}% · PARTIAL ${(c.partialRate * 100).toFixed(1)}%   aid policy UNKNOWN ${(c.aidPolicyUnknownRate * 100).toFixed(1)}%`);
  if (report.viability) {
    const v = report.viability;
    console.log(`  viability: min ${v.min} p25 ${v.p25} median ${v.median} p75 ${v.p75} max ${v.max} (mean ${v.mean})`);
  } else {
    console.log('  viability: nothing scoreable');
  }
  console.log(`  cost bases: ${Object.entries(report.byCostBasis).map(([k, n]) => `${k} ${n}`).join(', ') || '(none)'}`);
  console.log(`  aid policy: ${Object.entries(report.byAidPolicy).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  if (Object.keys(report.unscoreableReasons).length) {
    console.log(`  unscoreable because: ${Object.entries(report.unscoreableReasons).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  }
  console.log('  by division:');
  for (const [d, s] of Object.entries(report.byDivision)) {
    console.log(`    ${String(d).padEnd(10)} n=${String(s.n).padStart(4)}  scoreable ${(s.scoreableRate * 100).toFixed(0)}%  median ${s.viability ? s.viability.median : '-'}`);
  }
  console.log('  public vs private:');
  for (const [k, s] of Object.entries(report.byControl)) {
    console.log(`    ${k.padEnd(16)} n=${String(s.n).padStart(4)}  median ${s.viability ? s.viability.median : '-'}`);
  }

  const scored = report.results.filter((r) => r.result.ok).map(financialRow)
    .sort((x, y) => y.viability - x.viability);
  if (scored.length) {
    console.log(`  most workable ${Math.min(top, scored.length)}:`);
    for (const r of scored.slice(0, top)) {
      console.log(`    ${r.viability.toFixed(3)} ${String(r.name).slice(0, 30).padEnd(31)}${String(r.division).padEnd(9)} cost ${range(r.applicableCostRange).padEnd(17)} gap ${range(r.fundingGapRange).padEnd(17)} ${r.aidPolicyKnown ? '' : 'aid UNKNOWN'}`);
    }
    console.log(`  least workable ${Math.min(top, scored.length)}:`);
    for (const r of scored.slice(-top).reverse()) {
      console.log(`    ${r.viability.toFixed(3)} ${String(r.name).slice(0, 30).padEnd(31)}${String(r.division).padEnd(9)} cost ${range(r.applicableCostRange).padEnd(17)} gap ${range(r.fundingGapRange).padEnd(17)} ${r.aidPolicyKnown ? '' : 'aid UNKNOWN'}`);
    }
  }
  const refused = report.results.filter((r) => !r.result.ok).map(financialRow);
  if (refused.length) {
    console.log(`  refused (${refused.length}), first 3:`);
    for (const r of refused.slice(0, 3)) {
      console.log(`    ${String(r.name).slice(0, 30).padEnd(31)}${String(r.division).padEnd(9)} ${r.reason} coverage ${r.coverage} missing ${r.missing.join(',')}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const json = args.includes('--json');
  const one = args.find((a) => a.startsWith('--fixture='))?.split('=')[1]?.toUpperCase();
  const top = Number(args.find((a) => a.startsWith('--top='))?.split('=')[1] ?? 6);
  if (all === Boolean(one)) usage(2);

  const chosen = all ? FIXTURES : FIXTURES.filter((f) => f.id.toUpperCase().startsWith(`${one}-`));
  if (chosen.length === 0) usage(2);

  const { default: db } = await import('../db/client.js');
  const { normaliseAthlete } = await import('../../shared/matching/pool.js');
  const { evaluateFinancial, financialRow } = await import('../lib/v2/financialRun.js');

  const poolCache = new Map();
  const collegesFor = (sport) => {
    if (!poolCache.has(sport)) {
      poolCache.set(sport, db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport));
    }
    return poolCache.get(sport);
  };

  const out = [];
  for (const f of chosen) {
    const sport = f.player.sport;
    const colleges = collegesFor(sport);
    if (colleges.length === 0) {
      // The same refusal the matching baseline makes: a distribution over an
      // empty pool describes nothing and would look like a clean result.
      console.error(`Refusing to report ${f.id}: no active ${sport} programmes in this database.`);
      process.exit(3);
    }
    const athlete = normaliseAthlete({ ...BASE_PLAYER, ...f.player });
    const report = evaluateFinancial({ athlete, colleges, sport });
    out.push({ fixture: f.id, why: f.why, report });
    if (!json) printFixture(f, report, top, financialRow);
  }

  if (json) {
    console.log(JSON.stringify(out.map((o) => ({
      ...o,
      report: { ...o.report, results: o.report.results.map(financialRow) },
    })), null, 2));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
