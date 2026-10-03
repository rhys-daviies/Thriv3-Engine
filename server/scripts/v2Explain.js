/**
 * Read the explanations V2 produces for real programmes.
 *
 * READ-ONLY, and explanation generation changes no score, no rank and no
 * ranking state - a test proves it by deep-equality before and after.
 *
 *   node server/scripts/v2Explain.js --fixture=C --sample
 *   node server/scripts/v2Explain.js --fixture=C --movers
 *   node server/scripts/v2Explain.js --fixture=G --limited
 */
import { FIXTURES } from './v2Fixtures.js';

const SEASON = '2026';

function usage(code) {
  console.error('Usage: v2Explain.js --fixture=<A-H> [--sample] [--movers] [--limited] [--profile=A|D] [--json]');
  console.error('  --sample   ranks 1-5, 48-52 and 96-100');
  console.error('  --movers   the five largest rises and falls against frozen V1');
  console.error('  --limited  five limited-data programmes');
  process.exit(code);
}

async function main() {
  const args = process.argv.slice(2);
  const one = args.find((a) => a.startsWith('--fixture='))?.split('=')[1]?.toUpperCase();
  if (!one) usage(2);
  const profile = args.find((a) => a.startsWith('--profile='))?.split('=')[1]?.toUpperCase() ?? null;
  const f = FIXTURES.find((x) => x.id.toUpperCase().startsWith(`${one}-`));
  if (!f) usage(2);

  const { default: db } = await import('../db/client.js');
  const { canonicalPosition } = await import('../../shared/positions.js');
  const { normaliseAthlete, buildRosterIndex, rankMatches } = await import('../../shared/matching/pool.js');
  const { buildPoolContext } = await import('../lib/v2/poolContext.js');
  const { runPursuit } = await import('../lib/v2/pursuitRun.js');
  const { explainProgramme, renderExplanation, largestMovers, renderMovement } = await import('../../shared/matching/v2/index.js');

  const sport = f.player.sport;
  const colleges = db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport);
  const roster = db.prepare(`
    SELECT college_name, player_name, position, minutes_played, projected_minutes, games_started, projected_games_started,
           estimated_graduation_year, eligibility_end_year, country, season, division, class_year_label
      FROM roster_players WHERE sport = ? AND season = ?`).all(sport, SEASON);
  const arrivals = db.prepare('SELECT programme, sport, arrival_season, canonical_position, is_international FROM recruiting_arrivals WHERE sport = ?').all(sport);
  const ctx = buildPoolContext({ db, sport, season: SEASON });
  const position = canonicalPosition(f.player.position);
  const v1Shape = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
  const prefs = profile === 'A' ? [5, 1] : profile === 'D' ? [1, 5] : [null, null];
  const athlete = {
    label: { id: f.id },
    v1Shape,
    recruitability: {
      sport, rating: f.player.football_ability, position,
      entryYear: f.player.recruiting_class_year, isInternational: f.player.origin === 'International',
        homeState: f.player.state ?? null,
    },
    opportunity: {
      sport, position, rating: f.player.football_ability,
      intendedMajor: f.player.intended_major ?? null, priorityRanking: null,
      competitiveLevelPriority: prefs[0], playingOpportunityPriority: prefs[1],
    },
  };
  const rep = runPursuit({ athlete, sport, colleges, ctx });
  const ranked = rep.pipeline.ranked;
  const poolMedianPriority = rep.pursuitPriority.median;
  const context = (e) => ({ rank: e.rank, outOf: ranked.length, poolSize: rep.counts.evaluated, poolMedianPriority });

  const show = (e) => {
    const ex = explainProgramme(e, context(e));
    const { lines, gates, checks } = renderExplanation(ex);
    const s = ex.standing;
    console.log('');
    console.log(`  ${s ? `#${s.rank}` : e.rankingState}  ${e.name} (${e.division})`
      + (s ? `   priority ${s.priority}  [${s.absoluteStrength}]${s.rankAloneIsMisleading ? '  rank-alone-misleading' : ''}` : ''));
    if (ex.layerSummary) {
      console.log(`      ${ex.layerSummary.layers.map((l) => `${l.layer.slice(0, 4)} ${l.value} ${l.band}`).join(' · ')}   strongest: ${ex.layerSummary.strongest}  weakest: ${ex.layerSummary.weakest}`);
    }
    for (const line of lines) console.log(`      - ${line}`);
    for (const g of gates) console.log(`      ! ${g}`);
    for (const c of checks) console.log(`      > ${c}`);
  };

  console.log(`${f.id}   profile ${profile ?? 'E (undeclared)'}   pool median priority ${poolMedianPriority}`);

  if (args.includes('--sample')) {
    for (const [label, slice] of [['RANKS 1-5', ranked.slice(0, 5)], ['RANKS 48-52', ranked.slice(47, 52)], ['RANKS 96-100', ranked.slice(95, 100)]]) {
      console.log(`\n=== ${label} ===`);
      for (const e of slice) show(e);
    }
  }
  if (args.includes('--limited')) {
    console.log('\n=== LIMITED DATA (5) ===');
    for (const e of rep.pipeline.limited.slice(0, 5)) show(e);
  }
  if (args.includes('--movers')) {
    const v1 = rankMatches({ athlete: v1Shape, colleges, rosterIndex: buildRosterIndex(roster) });
    const v1Ranks = new Map(v1.results.map((r, i) => [r.id, i + 1]));
    const { rises, falls } = largestMovers(ranked, v1Ranks);
    console.log('\n=== LARGEST RISES ===');
    for (const m of rises) console.log(`  ${m.name} (${m.division})\n      ${renderMovement(m)}`);
    console.log('\n=== LARGEST FALLS ===');
    for (const m of falls) console.log(`  ${m.name} (${m.division})\n      ${renderMovement(m)}`);
    const v1Top = new Set(v1.results.slice(0, 100).map((r) => r.id));
    const dropped = rep.pipeline.limited.filter((r) => v1Top.has(r.id)).slice(0, 3);
    if (dropped.length) {
      const { explainMovement } = await import('../../shared/matching/v2/index.js');
      console.log('\n=== V1 TOP-100 NOW LIMITED DATA ===');
      for (const e of dropped) console.log(`  ${e.name} (${e.division})\n      ${renderMovement(explainMovement(e, v1Ranks.get(e.id)))}`);
    }
  }
  if (!args.some((a) => ['--sample', '--movers', '--limited'].includes(a))) usage(2);
}

main().catch((err) => { console.error(err); process.exit(1); });
