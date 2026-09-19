/**
 * What Athlete Opportunity / Fit says about the real pool, and how independent
 * the three V2 layers actually are.
 *
 * READ-ONLY. No ranking, no pursuit priority, no adoption.
 *
 * A HIGHER OPPORTUNITY SCORE IS NOT A BETTER MATCH. It says an opportunity is
 * worth having if it can be reached and paid for, and this script knows
 * nothing about either.
 *
 *   node server/scripts/v2Opportunity.js --all
 *   node server/scripts/v2Opportunity.js --fixture=G --top=5
 *   node server/scripts/v2Opportunity.js --all --correlate
 */
import { FIXTURES } from './v2Fixtures.js';

const SEASON = '2026';

function usage(code) {
  console.error('Usage: v2Opportunity.js (--fixture=<A-H> | --all) [--json] [--top=<n>] [--correlate]');
  console.error('');
  console.error('  --correlate   also measure Financial / Recruitability / Opportunity against each other');
  console.error('  --declared    re-run each fixture with a stated major and priority ranking.');
  console.error('                No frozen fixture declares a preference, so without this the');
  console.error('                preference half of the layer is never exercised on real data.');
  process.exit(code);
}

const dist = (d) => (d ? `min ${d.min} p25 ${d.p25} med ${d.median} p75 ${d.p75} max ${d.max} (n=${d.n})` : 'nothing scoreable');

function corr(a, b) {
  const n = a.length;
  if (n < 3) return null;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let c = 0; let va = 0; let vb = 0;
  for (let i = 0; i < n; i += 1) { const d = a[i] - ma; const e = b[i] - mb; c += d * e; va += d * d; vb += e * e; }
  return (va === 0 || vb === 0) ? null : Number((c / Math.sqrt(va * vb)).toFixed(3));
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const json = args.includes('--json');
  const correlate = args.includes('--correlate');
  const declared = args.includes('--declared');
  const one = args.find((a) => a.startsWith('--fixture='))?.split('=')[1]?.toUpperCase();
  const top = Number(args.find((a) => a.startsWith('--top='))?.split('=')[1] ?? 0);
  if (all === Boolean(one)) usage(2);
  const chosen = all ? FIXTURES : FIXTURES.filter((f) => f.id.toUpperCase().startsWith(`${one}-`));
  if (!chosen.length) usage(2);

  const { default: db } = await import('../db/client.js');
  const { canonicalPosition } = await import('../../shared/positions.js');
  const { normaliseAthlete } = await import('../../shared/matching/pool.js');
  const { evaluateOpportunity, opportunityRow } = await import('../lib/v2/opportunityRun.js');
  const { evaluateFinancial } = await import('../lib/v2/financialRun.js');
  const { evaluateRecruitability } = await import('../lib/v2/recruitabilityRun.js');
  const { buildPositionIndex, buildArrivalIndex, divisionArrivalRates } = await import('../lib/v2/rosterEvidence.js');
  const { isScoreable } = await import('../../shared/matching/v2/index.js');

  const cache = new Map();
  const contextFor = (sport) => {
    if (cache.has(sport)) return cache.get(sport);
    const colleges = db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport);
    const roster = db.prepare(`
      SELECT college_name, position, class_year_label, division, season, minutes_played, projected_minutes
        FROM roster_players WHERE sport = ? AND season = ?
    `).all(sport, SEASON);
    const arrivals = db.prepare('SELECT programme, sport, arrival_season, canonical_position, is_international FROM recruiting_arrivals WHERE sport = ?').all(sport);
    const ctx = {
      colleges,
      rosterProgrammes: new Set(roster.map((r) => r.college_name)),
      rosterIndex: buildPositionIndex(roster),
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
    const athlete = {
      sport,
      position,
      /**
       * The frozen fixtures state neither, which is itself the finding: the
       * preference half of this layer has nothing to read on the athletes the
       * baseline pins. `--declared` supplies one of each so the path can be
       * seen working against the real pool.
       */
      intendedMajor: declared ? 'exercise science' : (f.player.intended_major ?? null),
      priorityRanking: declared
        ? ['roster', 'academic', 'athletic', 'geography', 'affordability', 'programQuality']
        : (f.player.criterion_ranking ? JSON.parse(f.player.criterion_ranking) : null),
      preferredStates: null, preferredRegions: null, maxDistanceMiles: null, levelPreference: null,
    };
    const rep = evaluateOpportunity({ athlete, colleges: ctx.colleges, rosterProgrammes: ctx.rosterProgrammes });
    out.push({ fixture: f.id, report: rep });

    if (!json) {
      const c = rep.counts;
      console.log('');
      console.log(`${f.id}`);
      console.log(`  athlete: ${position} · major ${athlete.intendedMajor ?? '(none stated)'} · priorities ${athlete.priorityRanking ? 'stated' : '(none stated)'}`);
      console.log(`  pool ${c.programmes}: scoreable ${c.scoreable} (${(c.scoreableRate * 100).toFixed(1)}%)  MEASURED ${(c.measuredRate * 100).toFixed(1)}% PARTIAL ${(c.partialRate * 100).toFixed(1)}%`);
      console.log(`  opportunity:   ${dist(rep.opportunity)}`);
      console.log(`  playing:       ${dist(rep.playingOpportunity)}`);
      console.log(`  trajectory:    ${dist(rep.programmeTrajectory)}`);
      console.log(`  major fit:     ${dist(rep.majorFit)}`);
      console.log(`  component coverage: ${Object.entries(rep.componentCoverage).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(', ')}`);
      console.log(`  NOT_APPLICABLE:     ${Object.entries(rep.notApplicable).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(', ')}`);
      console.log(`  preference known: ${rep.preferenceKnown}   priorities applied: ${rep.prioritiesApplied?.applied ?? false}${rep.prioritiesApplied?.ignored?.length ? `  (ignored: ${rep.prioritiesApplied.ignored.map((i) => `${i.key}→${i.ownedBy}`).join(', ')})` : ''}`);
      console.log(`  unscoreable: ${Object.entries(rep.unscoreableReasons).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
      console.log('  by division:');
      for (const [d, s] of Object.entries(rep.byDivision)) {
        console.log(`    ${String(d).padEnd(10)} n=${String(s.n).padStart(4)}  scoreable ${String(Math.round(s.scoreableRate * 100)).padStart(3)}%  median ${s.opportunity ? s.opportunity.median : '-'}`);
      }
      if (top > 0) {
        const rows = rep.results.filter((r) => r.result.ok).map(opportunityRow).sort((x, y) => y.opportunity - x.opportunity);
        console.log(`  best ${Math.min(top, rows.length)}:`);
        for (const r of rows.slice(0, top)) {
          console.log(`    ${r.opportunity.toFixed(3)} ${String(r.name).slice(0, 30).padEnd(31)}${String(r.division).padEnd(9)} play=${r.playingOpportunity} traj=${r.programmeTrajectory} share=${r.playingShare} (${r.playingLevel})`);
        }
      }
    }

    if (correlate) {
      const norm = normaliseAthlete({
        ...f.player,
        preferred_divisions: f.player.preferred_divisions ?? '[]',
        preferred_conferences: f.player.preferred_conferences ?? '[]',
      });
      const fin = evaluateFinancial({ athlete: norm, colleges: ctx.colleges, sport });
      const rec = evaluateRecruitability({
        athlete: {
          sport, rating: f.player.football_ability, position,
          entryYear: f.player.recruiting_class_year,
          isInternational: f.player.origin === 'International',
        },
        colleges: ctx.colleges, rosterIndex: ctx.rosterIndex, arrivalIndex: ctx.arrivalIndex,
        divisionArrivals: ctx.divisionArrivals, arrivalsHorizon: ctx.arrivalsHorizon,
      });
      const byId = (rows, key) => new Map(rows.map((r) => [r.id, isScoreable(r[key] ?? r.result) ? (r[key] ?? r.result).value : null]));
      const F = byId(fin.results, 'result');
      const R = byId(rec.results, 'result');
      const O = byId(rep.results, 'result');
      const pairs = [];
      for (const id of O.keys()) {
        if (F.get(id) === null || R.get(id) === null || O.get(id) === null) continue;
        if (F.get(id) === undefined || R.get(id) === undefined) continue;
        pairs.push([F.get(id), R.get(id), O.get(id)]);
      }
      const f0 = pairs.map((p) => p[0]); const r0 = pairs.map((p) => p[1]); const o0 = pairs.map((p) => p[2]);
      console.log(`  cross-layer (n=${pairs.length} scoreable on all three):`);
      console.log(`    corr(Financial, Recruitability) = ${corr(f0, r0)}`);
      console.log(`    corr(Financial, Opportunity)    = ${corr(f0, o0)}`);
      console.log(`    corr(Recruitability, Opportunity) = ${corr(r0, o0)}`);
    }
  }

  if (json) {
    console.log(JSON.stringify(out.map((o) => ({ ...o, report: { ...o.report, results: o.report.results.map(opportunityRow) } })), null, 2));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
