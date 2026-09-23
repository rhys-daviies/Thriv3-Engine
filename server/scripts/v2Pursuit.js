/**
 * The first parallel V2 Top 100, beside the frozen V1 answer.
 *
 * READ-ONLY. ADOPTS NOTHING. V1 continues to serve every recommendation and
 * this writes nothing, touches no route and changes no ranking that anybody
 * sees. Its output is a report for a person to argue with.
 *
 *   node server/scripts/v2Pursuit.js --all
 *   node server/scripts/v2Pursuit.js --fixture=C --top=15 --movers
 *   node server/scripts/v2Pursuit.js --all --sensitivity
 */
import { FIXTURES } from './v2Fixtures.js';

const SEASON = '2026';

function usage(code) {
  console.error('Usage: v2Pursuit.js (--fixture=<A-H> | --all) [--top=<n>] [--movers] [--sensitivity] [--json]');
  console.error('');
  console.error('  --movers       explain the largest rises and falls against frozen V1');
  console.error('  --sensitivity  re-run across the weight and gate grid');
  console.error('  --profiles     re-run under athlete ambition profiles A-E (A7.5.1)');
  process.exit(code);
}

const jaccard = (a, b) => {
  const A = new Set(a); const B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  return Number((inter / (A.size + B.size - inter)).toFixed(4));
};

function spearman(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const rank = (get) => {
    const sorted = [...pairs].sort((x, y) => get(x) - get(y));
    const r = new Map();
    sorted.forEach((p, i) => r.set(p, i + 1));
    return r;
  };
  const ra = rank((p) => p.a); const rb = rank((p) => p.b);
  let d2 = 0;
  for (const p of pairs) d2 += (ra.get(p) - rb.get(p)) ** 2;
  return Number((1 - ((6 * d2) / (n * ((n * n) - 1)))).toFixed(4));
}

const SENSITIVITY = [
  ['weights R', (v) => ({ weights: { recruitability: v, financial: (1 - v) * 0.56, opportunity: (1 - v) * 0.44 } }), [0.45, 0.5, 0.55, 0.6, 0.65]],
  ['gate R floor', (v) => ({ gates: { recruitability: { floor: v, threshold: 0.25 }, financial: { floor: 0.3, threshold: 0.5 } } }), [0.0, 0.05, 0.15]],
  ['gate R threshold', (v) => ({ gates: { recruitability: { floor: 0.05, threshold: v }, financial: { floor: 0.3, threshold: 0.5 } } }), [0.15, 0.25, 0.35, 0.45]],
  ['gate F floor', (v) => ({ gates: { recruitability: { floor: 0.05, threshold: 0.25 }, financial: { floor: v, threshold: 0.5 } } }), [0.15, 0.3, 0.5]],
  ['gate F threshold', (v) => ({ gates: { recruitability: { floor: 0.05, threshold: 0.25 }, financial: { floor: 0.3, threshold: v } } }), [0.35, 0.5, 0.7]],
];

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const json = args.includes('--json');
  const movers = args.includes('--movers');
  const sensitivity = args.includes('--sensitivity');
  const profiles = args.includes('--profiles');
  const one = args.find((a) => a.startsWith('--fixture='))?.split('=')[1]?.toUpperCase();
  const top = Number(args.find((a) => a.startsWith('--top='))?.split('=')[1] ?? 0);
  if (all === Boolean(one)) usage(2);
  const chosen = all ? FIXTURES : FIXTURES.filter((f) => f.id.toUpperCase().startsWith(`${one}-`));
  if (!chosen.length) usage(2);

  const { default: db } = await import('../db/client.js');
  const { canonicalPosition } = await import('../../shared/positions.js');
  const { normaliseAthlete, buildRosterIndex, rankMatches } = await import('../../shared/matching/pool.js');
  const { buildPositionIndex, buildArrivalIndex, divisionArrivalRates } = await import('../lib/v2/rosterEvidence.js');
  const { runPursuit, pursuitRow } = await import('../lib/v2/pursuitRun.js');

  const cache = new Map();
  const contextFor = (sport) => {
    if (cache.has(sport)) return cache.get(sport);
    const colleges = db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport);
    const roster = db.prepare(`
      SELECT college_name, player_name, position, minutes_played, projected_minutes, games_started, projected_games_started,
             estimated_graduation_year, eligibility_end_year, country,
             season, division, class_year_label
        FROM roster_players WHERE sport = ? AND season = ?
    `).all(sport, SEASON);
    const arrivals = db.prepare('SELECT programme, sport, arrival_season, canonical_position, is_international FROM recruiting_arrivals WHERE sport = ?').all(sport);
    const ctx = {
      colleges,
      rosterProgrammes: new Set(roster.map((r) => r.college_name)),
      rosterIndex: buildPositionIndex(roster),
      v1RosterIndex: buildRosterIndex(roster),
      arrivalIndex: buildArrivalIndex(arrivals),
      divisionArrivals: divisionArrivalRates(arrivals, new Map(colleges.map((c) => [c.name, c]))),
      arrivalsHorizon: arrivals.reduce((m, r) => Math.max(m, Number(r.arrival_season) || 0), 0),
    };
    cache.set(sport, ctx);
    return ctx;
  };

  const out = [];
  for (const f of chosen) {
    const sport = f.player.sport;
    const ctx = contextFor(sport);
    if (!ctx.colleges.length) {
      console.error(`Refusing to report ${f.id}: no active ${sport} programmes in this database.`);
      process.exit(3);
    }
    const position = canonicalPosition(f.player.position);
    const v1Shape = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
    const athlete = {
      label: { id: f.id, sport, position, rating: f.player.football_ability, budget: f.player.budget_range },
      v1Shape,
      recruitability: {
        sport, rating: f.player.football_ability, position,
        entryYear: f.player.recruiting_class_year,
        isInternational: f.player.origin === 'International',
      },
      opportunity: {
        sport, position,
        rating: f.player.football_ability,
        intendedMajor: f.player.intended_major ?? null,
        priorityRanking: f.player.criterion_ranking ? JSON.parse(f.player.criterion_ranking) : null,
        // UNDECLARED unless a profile supplies them. No fixture states either.
        competitiveLevelPriority: null,
        playingOpportunityPriority: null,
      },
    };

    const rep = runPursuit({ athlete, sport, colleges: ctx.colleges, ctx });

    // Frozen V1, for comparison only. Never used to calibrate anything.
    const v1 = rankMatches({ athlete: v1Shape, colleges: ctx.colleges, rosterIndex: ctx.v1RosterIndex });
    const v1Rank = new Map(v1.results.map((r, i) => [r.id, i + 1]));
    const v1Top = new Set(v1.results.slice(0, 100).map((r) => r.id));
    const v2Top = rep.pipeline.actionable.map((r) => r.id);
    const v2TopSet = new Set(v2Top);
    const overlap = v2Top.filter((id) => v1Top.has(id));
    const v1TopNowLimited = rep.pipeline.limited.filter((r) => v1Top.has(r.id));
    const medianV1RankOfV2Top = (() => {
      const ranks = v2Top.map((id) => v1Rank.get(id)).filter(Boolean).sort((a, b) => a - b);
      return ranks.length ? ranks[Math.floor(ranks.length / 2)] : null;
    })();
    const shared = rep.pipeline.ranked.filter((r) => v1Rank.has(r.id));
    const rho = spearman(shared.map((r) => ({ a: r.rank, b: v1Rank.get(r.id) })));

    out.push({ fixture: f.id, report: rep });

    if (!json) {
      const c = rep.counts;
      console.log('');
      console.log(`${f.id}   ${position} · rating ${f.player.football_ability} · budget ${f.player.budget_range}`);
      console.log(`  states: RANKED ${c.ranked}  LIMITED_DATA ${c.limitedData}  INELIGIBLE ${c.ineligible}  SUPPRESSED ${c.suppressed}   (pool ${c.evaluated}, actionable ${c.actionable})`);
      const p = rep.pursuitPriority;
      console.log(`  pursuit priority: p10 ${p.p10} p25 ${p.p25} med ${p.median} p75 ${p.p75} p90 ${p.p90} max ${p.max}`);
      console.log(`  compression: below 0.05 ${(rep.compression.below005 * 100).toFixed(1)}%  above 0.90 ${(rep.compression.above090 * 100).toFixed(1)}%`);
      console.log(`  gates fired: recruitability ${(rep.gateFiringRate.recruitability * 100).toFixed(1)}%  financial ${(rep.gateFiringRate.financial * 100).toFixed(1)}%`);
      const psi = rep.programmeStrengthInfluence;
      console.log(`  corr(soccer_score, .) : P ${psi.pursuitPriority}  R ${psi.recruitability}  F ${psi.financial}  O ${psi.opportunity}   <- all three lean the same way`);
      console.log(`  V2 top 100:  ${Object.entries(rep.topComposition).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      console.log(`  V2 top 25:   ${Object.entries(rep.top25Composition).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      console.log(`  limited data: ${Object.entries(rep.limitedComposition).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      console.log(`  limited because: ${Object.entries(rep.limitedReasons).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      console.log(`  vs frozen V1: overlap ${overlap.length}/100, entered ${100 - overlap.length}, left ${[...v1Top].filter((id) => !v2TopSet.has(id)).length}`);
      console.log(`                median V1 rank of the V2 top 100: ${medianV1RankOfV2Top}   rank correlation (shared) rho=${rho}`);
      console.log(`                V1 top-100 programmes now LIMITED_DATA: ${v1TopNowLimited.length}`);
      if (top > 0) {
        console.log(`  V2 top ${top}:`);
        for (const r of rep.pipeline.actionable.slice(0, top).map(pursuitRow)) {
          console.log(`    ${String(r.rank).padStart(3)} ${r.pursuitPriority.toFixed(3)} ${String(r.name).slice(0, 26).padEnd(27)}${String(r.division).padEnd(9)} R=${r.recruitability.toFixed(2)} F=${r.financial.toFixed(2)} O=${r.opportunity.toFixed(2)}  gR=${r.recruitabilityGate.toFixed(2)} gF=${r.financialGate.toFixed(2)}  V1 #${v1Rank.get(r.id) ?? '-'}`);
        }
      }
      if (movers) {
        const withDelta = rep.pipeline.actionable.map(pursuitRow)
          .filter((r) => v1Rank.has(r.id))
          .map((r) => ({ ...r, v1: v1Rank.get(r.id), delta: v1Rank.get(r.id) - r.rank }));
        const why = (r) => {
          const parts = [];
          if (r.recruitability >= 0.5) parts.push(`recruitability ${r.recruitability.toFixed(2)}`);
          if (r.recruitability < 0.25) parts.push(`recruitability only ${r.recruitability.toFixed(2)}, gate cost ${r.recruitabilityGateLoss.toFixed(3)}`);
          if (r.financialGate < 1) parts.push(`finance ${r.financial.toFixed(2)}, gate cost ${r.financialGateLoss.toFixed(3)}`);
          else parts.push(`finance ${r.financial.toFixed(2)} clears the gate`);
          parts.push(`opportunity ${r.opportunity.toFixed(2)}`);
          return parts.join('; ');
        };
        console.log('  biggest RISES vs V1:');
        for (const r of [...withDelta].sort((a, b) => b.delta - a.delta).slice(0, 5)) {
          console.log(`    V1 #${String(r.v1).padStart(4)} -> V2 #${String(r.rank).padStart(3)}  ${String(r.name).slice(0, 24).padEnd(25)} ${why(r)}`);
        }
        console.log('  biggest FALLS vs V1 (still ranked):');
        const fell = rep.pipeline.ranked.map(pursuitRow).filter((r) => v1Top.has(r.id))
          .map((r) => ({ ...r, v1: v1Rank.get(r.id), delta: v1Rank.get(r.id) - r.rank }))
          .sort((a, b) => a.delta - b.delta).slice(0, 5);
        for (const r of fell) {
          console.log(`    V1 #${String(r.v1).padStart(4)} -> V2 #${String(r.rank).padStart(3)}  ${String(r.name).slice(0, 24).padEnd(25)} ${why(r)}`);
        }
        if (v1TopNowLimited.length) {
          console.log(`  V1 top-100 now LIMITED_DATA (${v1TopNowLimited.length}), first 5:`);
          for (const r of v1TopNowLimited.slice(0, 5)) {
            console.log(`    V1 #${String(v1Rank.get(r.id)).padStart(4)}  ${String(r.name).slice(0, 24).padEnd(25)}${String(r.division).padEnd(9)} missing ${r.missingLayers.join('+')}`);
          }
        }
      }
    }

    if (profiles) {
      /**
       * The five profiles, run against the unchanged A7.5 Pursuit Priority.
       * E is the control: both preferences UNDECLARED, so it must reproduce
       * the A7.5 answer exactly.
       */
      const PROFILES = [
        ['A level-first', 5, 1],
        ['B both high', 5, 5],
        ['C balanced', 3, 3],
        ['D playing-first', 1, 5],
        ['E undeclared', null, null],
      ];
      const baseTop = rep.pipeline.actionable.map((r) => r.id);
      console.log('  ambition profiles (Pursuit Priority, gates and weights UNCHANGED):');
      const medianScore = (rows) => {
        const v = rows.map((r) => r.soccerScore).filter((x) => typeof x === 'number').sort((a, b) => a - b);
        return v.length ? Number(v[Math.floor(v.length / 2)].toFixed(1)) : null;
      };
      console.log(`    ${'profile'.padEnd(16)} ${'top-100 mix'.padEnd(44)} J     corr(s,P)  top100 med soccer_score  top25`);
      for (const [label, level, playingPref] of PROFILES) {
        const alt = runPursuit({
          athlete: {
            ...athlete,
            opportunity: {
              ...athlete.opportunity,
              competitiveLevelPriority: level,
              playingOpportunityPriority: playingPref,
            },
          },
          sport, colleges: ctx.colleges, ctx,
        });
        const altTop = alt.pipeline.actionable.map((r) => r.id);
        const mix = Object.entries(alt.topComposition).map(([k, v]) => `${k} ${v}`).join(', ');
        console.log(`    ${label.padEnd(16)} ${mix.padEnd(44)} ${String(jaccard(baseTop, altTop)).padEnd(6)} ${String(alt.programmeStrengthInfluence.pursuitPriority).padEnd(10)} ${String(medianScore(alt.pipeline.actionable)).padEnd(24)} ${medianScore(alt.pipeline.actionable.slice(0, 25))}`);
      }
    }

    if (sensitivity) {
      const baseTop = rep.pipeline.actionable.map((r) => r.id);
      console.log('  sensitivity (Jaccard of top 100 vs default, top-25 overlap, division mix):');
      for (const [label, make, values] of SENSITIVITY) {
        const line = values.map((v) => {
          const alt = runPursuit({ athlete, sport, colleges: ctx.colleges, ctx, ...make(v) });
          const altTop = alt.pipeline.actionable.map((r) => r.id);
          const t25 = altTop.slice(0, 25).filter((id) => baseTop.slice(0, 25).includes(id)).length;
          return `${v}: J=${jaccard(baseTop, altTop)} t25=${t25}/25`;
        }).join('  ');
        console.log(`    ${label.padEnd(18)} ${line}`);
      }
    }
  }

  if (json) {
    console.log(JSON.stringify(out.map((o) => ({
      fixture: o.fixture,
      counts: o.report.counts,
      pursuitPriority: o.report.pursuitPriority,
      topComposition: o.report.topComposition,
      actionable: o.report.pipeline.actionable.map(pursuitRow),
      limited: o.report.pipeline.limited.slice(0, 50).map(pursuitRow),
    })), null, 2));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
