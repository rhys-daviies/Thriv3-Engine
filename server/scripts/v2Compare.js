/**
 * Run the parallel-run harness over the real pool and print the difference.
 *
 * READ-ONLY. It ranks, it diffs, it prints. It writes nothing, adopts nothing,
 * and is not reachable from any route.
 *
 * At A7.1 there is no V2 scorer, so this runs V1 against V1 and should report
 * nothing moving anywhere. That is the point: the harness has to be shown
 * correct against a known-zero answer before it is used to argue about a real
 * one. When a V2 pipeline exists, `--candidate=v2` becomes the interesting
 * invocation and this one stays as the control.
 *
 *   node server/scripts/v2Compare.js --fixture=C
 *   node server/scripts/v2Compare.js --all
 *   node server/scripts/v2Compare.js --all --json
 *
 * THE ADOPTION RULE: V2 is not adopted on destination recall. See the header of
 * server/lib/v2/parallelRun.js.
 */
import { FIXTURES, BASE_PLAYER } from './v2Fixtures.js';

/** The season the product ranks against - the same one the frozen baseline uses. */
const SEASON = '2026';

function usage(code) {
  console.error('Usage: v2Compare.js (--fixture=<A-H> | --all) [--json] [--candidate=v1]');
  console.error('');
  console.error('  --fixture=C   run one athlete');
  console.error('  --all         run all eight');
  console.error('  --json        emit the full report rather than a summary');
  console.error('  --candidate   which ranker to compare against V1. Only "v1" exists at A7.1,');
  console.error('                which runs V1 against itself and must report no difference.');
  process.exit(code);
}

function printReport(r) {
  const d = r.diagnostics;
  console.log(`  pool ${r.baseline.poolSize} -> ranked ${r.baseline.ranked}`);
  console.log(`  rank: ${d.rank.moved} moved, max |delta| ${d.rank.maxAbsDelta}, mean |delta| ${d.rank.meanAbsDelta}`);
  console.log(`  top ${d.topN.n}: ${d.topN.enteredCount} entered, ${d.topN.leftCount} left`);
  console.log(`  divisions: ${d.divisionComposition.identical ? 'identical' : 'MOVED'}`
    + `  ${Object.entries(d.divisionComposition.candidate).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  limited data: ${d.limitedData.count}`);
  console.log(`  layers: ${d.layers.applicable ? Object.keys(d.layers.distributions).join(', ') : 'not applicable - ' + d.layers.note}`);
  const v = d.violations.unscoreableOutranksMeasured.violations;
  console.log(`  violations (unscoreable outranks measured): ${v}${v === 0 ? '' : '   <-- MUST BE ZERO'}`);
  if (d.rank.largest.length) {
    console.log('  biggest movers:');
    for (const m of d.rank.largest.slice(0, 10)) {
      console.log(`    ${m.name} ${m.before} -> ${m.after} (${m.delta > 0 ? '+' : ''}${m.delta})`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const json = args.includes('--json');
  const one = args.find((a) => a.startsWith('--fixture='))?.split('=')[1]?.toUpperCase();
  const candidateName = args.find((a) => a.startsWith('--candidate='))?.split('=')[1] ?? 'v1';
  if (all === Boolean(one)) usage(2);
  if (candidateName !== 'v1') {
    console.error(`No candidate ranker named "${candidateName}". A7.1 builds the harness, not the scorer.`);
    process.exit(2);
  }

  const chosen = all ? FIXTURES : FIXTURES.filter((f) => f.id.toUpperCase().startsWith(`${one}-`));
  if (chosen.length === 0) usage(2);

  const { default: db } = await import('../db/client.js');
  const { buildRosterIndex, normaliseAthlete } = await import('../../shared/matching/pool.js');
  const { compare, v1Ranker, isIdentical } = await import('../lib/v2/parallelRun.js');

  const rosterFor = (sport) => db.prepare(`
    SELECT college_name, player_name, position, minutes_played, projected_minutes, games_started, projected_games_started,
           estimated_graduation_year, eligibility_end_year, country,
           season, division, class_year_label
      FROM roster_players WHERE sport = ? AND season = ?
  `).all(sport, SEASON);
  const collegesFor = (sport) => db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport);

  const indexCache = new Map();
  const poolCache = new Map();

  const reports = [];
  let clean = true;
  for (const f of chosen) {
    const sport = f.player.sport;
    if (!indexCache.has(sport)) indexCache.set(sport, buildRosterIndex(rosterFor(sport)));
    if (!poolCache.has(sport)) poolCache.set(sport, collegesFor(sport));
    const colleges = poolCache.get(sport);
    if (colleges.length === 0) {
      // The same refusal the matching baseline makes: a comparison over an
      // empty pool agrees with everything and proves nothing.
      console.error(`Refusing to compare ${f.id}: no active ${sport} programmes in this database.`);
      process.exit(3);
    }
    const athlete = normaliseAthlete({ ...BASE_PLAYER, ...f.player });
    const report = compare({ athlete, colleges, rosterIndex: indexCache.get(sport), baseline: v1Ranker, candidate: v1Ranker });
    reports.push({ fixture: f.id, why: f.why, identical: isIdentical(report), report });
    if (!isIdentical(report)) clean = false;
    if (!json) {
      console.log('');
      console.log(`${f.id} — ${f.why}`);
      printReport(report);
    }
  }

  if (json) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }

  console.log('');
  console.log(clean
    ? `V1 vs V1 over ${reports.length} fixture(s): no difference anywhere. The harness reproduces the frozen answer exactly.`
    : `V1 vs V1 reported a DIFFERENCE over ${reports.length} fixture(s). The harness, not the model, is wrong.`);
  if (!clean) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
