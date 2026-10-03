/**
 * A7.7.5: what a stated academic-strength preference does, and what it must
 * never do.
 *
 * READ-ONLY. It runs the real pipeline at each priority and reports what moves.
 *
 *   node server/scripts/v2AcademicPreference.js --fixture=C
 *   node server/scripts/v2AcademicPreference.js --grid
 *   node server/scripts/v2AcademicPreference.js --all
 *   node server/scripts/v2AcademicPreference.js --njcaa
 */
import db from '../db/client.js';
import { canonicalPosition } from '../../shared/positions.js';
import { normaliseAthlete } from '../../shared/matching/pool.js';
import { buildPoolContext } from '../lib/v2/poolContext.js';
import { runPursuit } from '../lib/v2/pursuitRun.js';
import { isScoreable, PREFERENCE_WEIGHTS } from '../../shared/matching/v2/index.js';
import { FIXTURES } from './v2Fixtures.js';

const SEASON = '2026';
const N = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const med = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const jac = (a, b) => { const A = new Set(a); const B = new Set(b); const i = [...A].filter((x) => B.has(x)).length; return i / (A.size + B.size - i); };
const comp = (rows) => Object.entries(rows.reduce((a, r) => { a[r.division] = (a[r.division] || 0) + 1; return a; }, {}))
  .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');

const cache = new Map();
function run(f, { academic = null, level = null, playing = null, weights } = {}) {
  const sport = f.player.sport;
  if (!cache.has(sport)) cache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
  const ctx = cache.get(sport);
  const position = canonicalPosition(f.player.position);
  const v1Shape = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
  const rep = runPursuit({
    athlete: {
      label: { id: f.id }, v1Shape,
      recruitability: {
        sport, rating: f.player.football_ability, position,
        entryYear: f.player.recruiting_class_year,
        isInternational: f.player.origin === 'International',
        homeState: f.player.state ?? null,
      },
      opportunity: {
        sport, position, rating: f.player.football_ability, intendedMajor: null, priorityRanking: null,
        competitiveLevelPriority: level, playingOpportunityPriority: playing,
        academicStrengthPriority: academic,
      },
    },
    sport, colleges: ctx.colleges, ctx,
    opportunityOverrides: weights ? { preferenceWeights: weights } : {},
  });
  const byId = new Map(ctx.colleges.map((c) => [c.id, c]));
  return { rep, byId, ctx };
}

function line(label, { rep, byId }) {
  const top = rep.pipeline.actionable;
  const acad = (rows) => med(rows.map((r) => byId.get(r.id)?.academic_rating).filter((x) => x !== null && x !== undefined));
  return `  ${label.padEnd(26)}`
    + `acad@10 ${String(N(acad(top.slice(0, 10)), 1)).padStart(5)}  acad@25 ${String(N(acad(top.slice(0, 25)), 1)).padStart(5)}  acad@100 ${String(N(acad(top), 1)).padStart(5)}`
    + `  str@25 ${String(N(med(top.slice(0, 25).map((r) => r.soccerScore)), 1)).padStart(5)}`
    + `  R@25 ${N(med(top.slice(0, 25).map((r) => r.recruitability.value)))}`
    + `  P@25 ${N(med(top.slice(0, 25).map((r) => r.pursuitPriority.value)))}`;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('Usage: --fixture=<A-H> | --grid | --all | --njcaa'); process.exit(2); }

  const one = args.find((a) => a.startsWith('--fixture='))?.split('=')[1]?.toUpperCase();
  if (one) {
    const f = FIXTURES.find((x) => x.id.toUpperCase().startsWith(`${one}-`));
    console.log(`== ${f.id} — academic-strength priority ==`);
    const base = run(f, { academic: null });
    console.log(line('UNDECLARED', base));
    const baseIds = base.rep.pipeline.actionable.map((r) => r.id);
    for (const p of [1, 3, 5]) {
      const r = run(f, { academic: p });
      console.log(`${line(`priority ${p}`, r)}  J25 ${N(jac(baseIds.slice(0, 25), r.rep.pipeline.actionable.slice(0, 25).map((x) => x.id)))}  J100 ${N(jac(baseIds, r.rep.pipeline.actionable.map((x) => x.id)))}`);
      console.log(`    divisions: ${comp(r.rep.pipeline.actionable.slice(0, 25))}`);
    }
    /** The guard: does a high priority let an unrealistic reach in? */
    const p5 = run(f, { academic: 5 });
    const worst = p5.rep.pipeline.actionable.slice(0, 25)
      .map((r) => ({ name: r.name, R: r.recruitability.value, acad: p5.byId.get(r.id)?.academic_rating, str: r.soccerScore }))
      .sort((a, b) => a.R - b.R).slice(0, 3);
    console.log('  lowest-recruitability rows in the priority-5 top 25:');
    for (const w of worst) console.log(`    ${w.name.slice(0, 26).padEnd(27)} R ${N(w.R)}  academic ${w.acad}  strength ${w.str}`);
  }

  if (args.includes('--grid')) {
    const f = FIXTURES.find((x) => x.id.startsWith('C-'));
    console.log('== ACADEMIC WEIGHT GRID (fixture C, priority 5 against priority 1) ==');
    for (const w of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
      const weights = { ...PREFERENCE_WEIGHTS, academicStrengthFit: w };
      const lo = run(f, { academic: 1, weights });
      const hi = run(f, { academic: 5, weights });
      const loIds = lo.rep.pipeline.actionable.map((r) => r.id);
      const hiIds = hi.rep.pipeline.actionable.map((r) => r.id);
      const acadHi = med(hi.rep.pipeline.actionable.slice(0, 25).map((r) => hi.byId.get(r.id)?.academic_rating));
      const acadLo = med(lo.rep.pipeline.actionable.slice(0, 25).map((r) => lo.byId.get(r.id)?.academic_rating));
      const minR = Math.min(...hi.rep.pipeline.actionable.slice(0, 10).map((r) => r.recruitability.value));
      const maxStr = Math.max(...hi.rep.pipeline.actionable.slice(0, 10).map((r) => r.soccerScore ?? 0));
      console.log(`  weight ${w.toFixed(2)}  J25 ${N(jac(loIds.slice(0, 25), hiIds.slice(0, 25)))}  J100 ${N(jac(loIds, hiIds))}`
        + `  acad@25 ${N(acadLo, 1)} -> ${N(acadHi, 1)}  minR@10 ${N(minR)}  maxStr@10 ${N(maxStr, 1)}`);
    }
  }

  if (args.includes('--all')) {
    console.log('== ALL FIXTURES, UNDECLARED vs priority 5 ==');
    for (const f of FIXTURES) {
      const base = run(f, { academic: null });
      const hi = run(f, { academic: 5 });
      const bIds = base.rep.pipeline.actionable.map((r) => r.id);
      const hIds = hi.rep.pipeline.actionable.map((r) => r.id);
      const a = (r, n) => med(r.rep.pipeline.actionable.slice(0, n).map((x) => r.byId.get(x.id)?.academic_rating));
      console.log(`  ${f.id.split('-')[0].padEnd(3)} J25 ${N(jac(bIds.slice(0, 25), hIds.slice(0, 25)))}  J100 ${N(jac(bIds, hIds))}`
        + `  acad@25 ${N(a(base, 25), 1)} -> ${N(a(hi, 25), 1)}`
        + `  ranked ${base.rep.counts.ranked}  gateR ${N(base.rep.gateFiringRate.recruitability)}`
        + `  corr(s,P) ${N(base.rep.programmeStrengthInfluence.pursuitPriority)} -> ${N(hi.rep.programmeStrengthInfluence.pursuitPriority)}`);
    }
  }

  if (args.includes('--njcaa')) {
    console.log('== NJCAA RE-ENTRY AUDIT ==');
    for (const f of FIXTURES.filter((x) => x.player.sport === 'mens-soccer')) {
      const { rep, byId } = run(f, { academic: null });
      const nj = rep.pipeline.ranked.filter((r) => r.division === 'NJCAA');
      const njTop = rep.pipeline.actionable.filter((r) => r.division === 'NJCAA');
      const njLimited = rep.pipeline.limited.filter((r) => r.division === 'NJCAA');
      if (!nj.length) { console.log(`  ${f.id.split('-')[0]}  ranked 0, limited ${njLimited.length}`); continue; }
      const b = (r) => r.recruitability.basis;
      const posKnown = nj.filter((r) => b(r).positional !== null).length;
      console.log(`  ${f.id.split('-')[0]}  NJCAA ranked ${nj.length}, still limited ${njLimited.length}, in top 100: ${njTop.length}`);
      console.log(`      positional evidence known on ${posKnown} of ${nj.length}  (the rest are market-only, coverage 0.25)`);
      console.log(`      A median ${N(med(nj.map((r) => b(r).athleticPlausibility)))}  market median ${N(med(nj.map((r) => b(r).market?.internationalArrivalShare ?? b(r).market?.nearShare)))}  R median ${N(med(nj.map((r) => r.recruitability.value)))}`);
      if (njTop.length) {
        for (const r of njTop.slice(0, 3)) {
          console.log(`      #${r.rank} ${r.name.slice(0, 24).padEnd(25)} R ${N(r.recruitability.value)} coverage ${r.recruitability.coverage} A ${N(b(r).athleticPlausibility)} positional ${b(r).positionalState}`);
        }
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
