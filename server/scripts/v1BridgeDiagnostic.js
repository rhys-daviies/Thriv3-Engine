/**
 * A7.9.4: what it costs to have stopped writing `budget_range`, and which
 * bridge closes it.
 *
 * READ-ONLY AND DIAGNOSTIC. No production scorer, weight, coupling, band or
 * constant is changed on disk, and nothing is persisted.
 *
 * -- HOW THE SIMULATION STAYS HONEST --------------------------------------
 *
 * V1's athlete-side financial surface is exactly one function, `budgetCeiling`,
 * with exactly two production callers: `affordability` in criteria.js and
 * `scholarshipNeed` in couplings.js. Both take a band label and want a number.
 *
 * So Option A is simulated by adding SYNTHETIC BAND KEYS to the in-memory
 * BUDGET_CEILINGS map for the life of this process. V1's arithmetic is then
 * run completely unmodified - the same affordability curve, the same
 * scholarshipNeed, the same couplings, the same weights - against a ceiling
 * that came from an exact contribution instead of from a picker. That is
 * precisely what Option A would do in production, minus the resolver.
 *
 *   node server/scripts/v1BridgeDiagnostic.js --regression
 *   node server/scripts/v1BridgeDiagnostic.js --bridge
 *   node server/scripts/v1BridgeDiagnostic.js --equivalence
 *   node server/scripts/v1BridgeDiagnostic.js --states
 */
import { FIXTURES } from './v2Fixtures.js';

const SEASON = '2026';
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const money = (n) => (n === Infinity ? 'no ceiling' : Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '—');
const med = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function kendall(a, b) {
  let con = 0; let dis = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = i + 1; j < a.length; j += 1) {
      const d = (a[i] - a[j]) * (b[i] - b[j]);
      if (d > 0) con += 1; else if (d < 0) dis += 1;
    }
  }
  return (con - dis) / (con + dis || 1);
}

async function main() {
  const args = process.argv.slice(2);
  const { default: db } = await import('../db/client.js');
  const { normaliseAthlete, rankMatches, buildRosterIndex } = await import('../../shared/matching/pool.js');
  const { BUDGET_CEILINGS, UNDECLARED_BUDGET, budgetCeiling, NO_NEED_BUDGET } = await import('../../shared/matching/constants.js');
  const { scholarshipNeed, resolveCouplings } = await import('../../shared/matching/couplings.js');
  const { affordability } = await import('../../shared/matching/criteria.js');
  const { financialViability } = await import('../../shared/matching/v2/layers/financial.js');

  /** Register an exact-contribution ceiling as a band V1 can already read. */
  const SIM = (label, ceiling) => { BUDGET_CEILINGS[label] = ceiling; return label; };
  const exact = (usd) => SIM(`__EXACT_${usd}__`, usd);
  const NO_CONSTRAINT = SIM('__NOT_A_CONSTRAINT__', Infinity);
  const UNKNOWN = UNDECLARED_BUDGET;

  const poolCache = new Map();
  const poolFor = (sport) => {
    if (!poolCache.has(sport)) {
      poolCache.set(sport, {
        colleges: db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport),
        rosterIndex: buildRosterIndex(db.prepare('SELECT * FROM roster_players WHERE sport = ? AND season = ?').all(sport, SEASON)),
      });
    }
    return poolCache.get(sport);
  };

  const rank = (f, band) => {
    const sport = f.player.sport;
    const { colleges, rosterIndex } = poolFor(sport);
    const athlete = normaliseAthlete({ ...f.player, budget_range: band, preferred_divisions: '[]', preferred_conferences: '[]' });
    const { results } = rankMatches({ athlete, colleges, rosterIndex });
    return results;
  };
  const namesOf = (rs, n) => new Set(rs.slice(0, n).map((r) => r.name));
  const overlap = (a, b, n) => { const A = namesOf(a, n); let k = 0; for (const x of namesOf(b, n)) if (A.has(x)) k += 1; return k; };

  function compare(base, alt) {
    const posA = new Map(base.map((r, i) => [r.name, i + 1]));
    const posB = new Map(alt.map((r, i) => [r.name, i + 1]));
    const a = []; const b = []; const moves = [];
    for (const [name, i] of posA) {
      const j = posB.get(name); if (j === undefined) continue;
      a.push(i); b.push(j); moves.push(Math.abs(i - j));
    }
    return {
      t25: overlap(base, alt, 25), t50: overlap(base, alt, 50),
      t100: overlap(base, alt, 100), t250: overlap(base, alt, 250),
      tau: kendall(a, b), medMove: med(moves),
      m50: moves.filter((m) => m >= 50).length, m100: moves.filter((m) => m >= 100).length,
      n: moves.length,
    };
  }

  // ------------------------------------------------------------ §8
  if (args.includes('--regression')) {
    console.log('== 8. A-H: LEGACY BAND vs NO BRIDGE (budget_range simply absent)\n');
    console.log(`${'fx'.padEnd(3)}${'band'.padEnd(22)}${'ceil'.padStart(11)}${'need'.padStart(7)}`
      + `${'t25'.padStart(6)}${'t50'.padStart(6)}${'t100'.padStart(7)}${'t250'.padStart(7)}${'tau'.padStart(8)}${'medMv'.padStart(7)}${'50+'.padStart(6)}${'100+'.padStart(6)}  couplings lost`);
    for (const f of FIXTURES) {
      const band = f.player.budget_range;
      const legacy = rank(f, band);
      const none = rank(f, null);
      const c = compare(legacy, none);
      const athlete = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
      const firedWith = resolveCouplings({ ...athlete, budgetRange: band }).fired;
      const firedWithout = resolveCouplings({ ...athlete, budgetRange: null }).fired;
      const lost = firedWith.filter((x) => !firedWithout.includes(x));
      console.log(`${f.id.slice(0, 1).padEnd(3)}${band.padEnd(22)}${money(budgetCeiling(band)).padStart(11)}${fmt(scholarshipNeed(band), 2).padStart(7)}`
        + `${String(c.t25).padStart(6)}${String(c.t50).padStart(6)}${String(c.t100).padStart(7)}${String(c.t250).padStart(7)}`
        + `${fmt(c.tau).padStart(8)}${String(c.medMove).padStart(7)}${String(c.m50).padStart(6)}${String(c.m100).padStart(6)}  ${lost.length ? lost.join(', ') : 'none'}`);
    }
  }

  // ------------------------------------------------------------ §9
  if (args.includes('--bridge')) {
    const VALUES = [0, 10000, 20000, 30000, 40000, 47500, 60000];
    console.log('== 9. BRIDGE SIMULATION. Fixture B (rating 9, $5k-$10k, CA) unless stated.');
    console.log('   Option A = V1 reads the exact contribution as its ceiling. V1 maths untouched.\n');
    const f = FIXTURES.find((x) => x.id.startsWith('B-'));
    const legacy = rank(f, f.player.budget_range);
    const none = rank(f, null);

    console.log(`${'athlete states'.padEnd(20)}${'V1 ceiling'.padStart(12)}${'need'.padStart(7)}${'afford@dear'.padStart(13)}${'conf'.padStart(10)}`
      + `${'couplings'.padStart(11)}${'t100 vs legacy'.padStart(16)}${'tau'.padStart(8)}  top programme`);
    const dear = { netPrice: 54021, control: 1, tuitionIn: 20644, tuitionOut: 41790, athleteState: 'CA', schoolState: 'PA', division: 'NCAA D1', sport: 'mens-soccer', conference: 'Big Ten Conference', athleteLevel: 90, programLevel: 83 };
    const row = (label, band) => {
      const rs = rank(f, band);
      const c = compare(legacy, rs);
      const aff = affordability({ ...dear, budgetRange: band });
      const athlete = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
      const fired = resolveCouplings({ ...athlete, budgetRange: band }).fired.length;
      console.log(`${label.padEnd(20)}${money(budgetCeiling(band)).padStart(12)}${fmt(scholarshipNeed(band), 2).padStart(7)}`
        + `${fmt(aff.score).padStart(13)}${String(aff.confidence).padStart(10)}${String(fired).padStart(11)}`
        + `${String(c.t100).padStart(16)}${fmt(c.tau).padStart(8)}  ${rs[0].name}`);
    };
    row(`LEGACY ${f.player.budget_range}`, f.player.budget_range);
    row('NO BRIDGE (absent)', null);
    for (const v of VALUES) row(`A: STATED ${money(v)}`, exact(v));
    row('A: NOT_A_CONSTRAINT', NO_CONSTRAINT);
    row('A: NEEDS_CONFIRM', UNKNOWN);
    console.log('');
    console.log('   OPTION E control — derive a band, conservatively (largest band ceiling <= stated):');
    const bandFor = (usd) => {
      let best = null;
      for (const [k, v] of Object.entries(BUDGET_CEILINGS)) {
        if (k.startsWith('__')) continue;
        if (Number.isFinite(v) && v <= usd && (best === null || v > BUDGET_CEILINGS[best])) best = k;
      }
      return best ?? 'Need Full Scholarship';
    };
    for (const v of [20000, 47500]) {
      const b = bandFor(v);
      const rA = rank(f, exact(v)); const rE = rank(f, b);
      console.log(`     stated ${money(v).padEnd(9)} -> band ${b.padEnd(18)} ceiling ${money(budgetCeiling(b)).padStart(9)}`
        + `   understated by ${money(v - budgetCeiling(b))}   top100 agreement with Option A ${overlap(rA, rE, 100)}/100`);
    }

    console.log('\n   OPTION B control — V2 Financial substituted for V1 affordability, same weights:');
    const { colleges, rosterIndex } = poolFor('mens-soccer');
    const athlete = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
    const { results } = rankMatches({ athlete, colleges, rosterIndex });
    const byName = new Map(colleges.map((c) => [c.name, c]));
    const swapped = results.map((r) => {
      const col = byName.get(r.name);
      const v2 = financialViability({ athlete: { ...athlete, contributionState: 'STATED', maxAnnualContributionUsd: 10000 }, college: col, sport: 'mens-soccer' });
      const bd = r.breakdown ?? [];
      const affPart = bd.find((x) => x.key === 'affordability');
      if (!affPart || !v2.ok) return { name: r.name, total: r.score / 100 };
      const total = bd.reduce((s, x) => s + (x.key === 'affordability' ? x.weight * v2.value : x.weight * x.score), 0);
      return { name: r.name, total, v1aff: affPart.score, v2f: v2.value };
    }).sort((a, b2) => b2.total - a.total);
    const pairs = swapped.filter((x) => Number.isFinite(x.v1aff));
    const c = compare(results, swapped);
    console.log(`     corr(V1 affordability, V2 Financial) over ${pairs.length} programmes: ${fmt(kendall(pairs.map((p) => p.v1aff), pairs.map((p) => p.v2f)))} (Kendall)`);
    console.log(`     V1 affordability median ${fmt(med(pairs.map((p) => p.v1aff)))}   V2 Financial median ${fmt(med(pairs.map((p) => p.v2f)))}`);
    console.log(`     swapping it in: top100 ${c.t100}/100 vs unswapped V1, tau ${fmt(c.tau)}, ${c.m100} programmes move 100+`);
  }

  // ------------------------------------------------------------ §10
  if (args.includes('--equivalence')) {
    console.log('== 10. LEGACY EQUIVALENCE: a band vs the exact value at its ceiling\n');
    const f = FIXTURES.find((x) => x.id.startsWith('E-'));
    console.log(`${'band'.padEnd(22)}${'ceiling'.padStart(10)}${'need(band)'.padStart(12)}${'need(exact)'.padStart(13)}${'aff(band)'.padStart(11)}${'aff(exact)'.padStart(12)}${'top100'.padStart(9)}${'tau'.padStart(8)}`);
    const probe = { netPrice: 30000, control: 2, tuitionIn: null, tuitionOut: null, athleteState: 'TX', schoolState: 'OH', division: 'NCAA D1', sport: 'mens-soccer', conference: 'ACC', athleteLevel: 55, programLevel: 50 };
    for (const band of Object.keys(BUDGET_CEILINGS)) {
      if (band.startsWith('__')) continue;
      const ceil = BUDGET_CEILINGS[band];
      if (!Number.isFinite(ceil)) continue;
      const e = exact(ceil);
      const rb = rank(f, band); const re = rank(f, e);
      console.log(`${band.padEnd(22)}${money(ceil).padStart(10)}${fmt(scholarshipNeed(band), 3).padStart(12)}${fmt(scholarshipNeed(e), 3).padStart(13)}`
        + `${fmt(affordability({ ...probe, budgetRange: band }).score).padStart(11)}${fmt(affordability({ ...probe, budgetRange: e }).score).padStart(12)}`
        + `${String(overlap(rb, re, 100)).padStart(9)}${fmt(compare(rb, re).tau).padStart(8)}`);
    }
    console.log(`\n   NO_NEED_BUDGET = ${money(NO_NEED_BUDGET)} — the denominator scholarshipNeed divides by.`);
  }

  // ------------------------------------------------------------ §14/§15
  if (args.includes('--states')) {
    console.log('== 14/15. CAN V1 REPRESENT THE TWO NON-NUMERIC STATES HONESTLY?\n');
    const probe = { netPrice: 54021, control: 1, tuitionIn: 20644, tuitionOut: 41790, athleteState: 'CA', schoolState: 'PA', division: 'NCAA D1', sport: 'mens-soccer', conference: 'Big Ten Conference', athleteLevel: 90, programLevel: 83 };
    const cheap = { ...probe, netPrice: 6128, control: 2, schoolState: 'NJ' };
    const show = (label, band) => {
      const a = affordability({ ...probe, budgetRange: band });
      const b = affordability({ ...cheap, budgetRange: band });
      const athlete = normaliseAthlete({ ...FIXTURES[0].player, preferred_divisions: '[]', preferred_conferences: '[]' });
      const cp = resolveCouplings({ ...athlete, budgetRange: band });
      console.log(`${label.padEnd(26)} ceiling ${money(budgetCeiling(band)).padStart(10)}  need ${fmt(scholarshipNeed(band), 2).padStart(5)}`
        + `  dear ${fmt(a.score)} (${a.confidence}, ${a.label ?? 'no label'})  cheap ${fmt(b.score)}`
        + `  geography x${fmt(cp.weights.geography, 2)} afford x${fmt(cp.weights.affordability, 2)} peak ${cp.shapes.athletic.peakOffset ?? 'default'}`);
    };
    show('Undeclared (V1 today)', UNDECLARED_BUDGET);
    show('absent / null', null);
    show('$40k+/yr (open band)', '$40k+/yr');
    show('NOT_A_CONSTRAINT -> Inf', NO_CONSTRAINT);
    show('NEEDS_CONFIRM -> unknown', UNKNOWN);
    show('STATED $0', exact(0));
    show('Need Full Scholarship', 'Need Full Scholarship');
    console.log('\n   NOTE: a neutral prior is SCORED, not skipped — every programme gets the same');
    console.log('   affordability, so it cannot reorder anything, and the criterion keeps its weight.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
