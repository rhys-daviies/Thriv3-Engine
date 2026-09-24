/**
 * A7.9.1: whether the Recruitability gate does anything anywhere in A-H, and
 * what the Financial layer actually needs from the athlete.
 *
 * READ-ONLY AND DIAGNOSTIC. No production scorer, weight, gate, threshold,
 * band or calibration is touched, and nothing is persisted.
 *
 * Every alternative below is recomputed ARITHMETICALLY from the layer values a
 * production run already produced, reusing the production combination
 * (PURSUIT_WEIGHTS), the production gate (tailGate/PURSUIT_GATES) and the
 * production financial primitives (applicableCost, fundingGap,
 * viabilityFromRelativeGap). Nothing here re-implements a model, so a
 * "what if" cannot quietly become a different model.
 *
 *   node server/scripts/v2GateAndFinancial.js --gate-ah
 *   node server/scripts/v2GateAndFinancial.js --r-bands
 *   node server/scripts/v2GateAndFinancial.js --reach-gate
 *   node server/scripts/v2GateAndFinancial.js --fin-trace
 *   node server/scripts/v2GateAndFinancial.js --fin-grid
 *   node server/scripts/v2GateAndFinancial.js --fin-mono
 *   node server/scripts/v2GateAndFinancial.js --legacy
 */
import { FIXTURES } from './v2Fixtures.js';

const SEASON = '2026';
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const money = (n) => (Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '—');
const qu = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const med = (xs) => qu(xs, 0.5);

/** Exact Kendall tau-b. O(n^2), and n is under a thousand. */
function kendall(a, b) {
  let con = 0; let dis = 0; let ta = 0; let tb = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = i + 1; j < a.length; j += 1) {
      const da = a[i] - a[j]; const dbv = b[i] - b[j];
      if (da === 0 && dbv === 0) { ta += 1; tb += 1; continue; }
      if (da === 0) { ta += 1; continue; }
      if (dbv === 0) { tb += 1; continue; }
      if (da * dbv > 0) con += 1; else dis += 1;
    }
  }
  const n0 = con + dis;
  return (con - dis) / Math.sqrt((n0 + ta) * (n0 + tb));
}
const spearmanOfRanks = (a, b) => {
  const n = a.length; if (n < 3) return null;
  let s = 0; for (let i = 0; i < n; i += 1) s += (a[i] - b[i]) ** 2;
  return 1 - ((6 * s) / (n * ((n * n) - 1)));
};

async function main() {
  const args = process.argv.slice(2);
  const { default: db } = await import('../db/client.js');
  const { canonicalPosition } = await import('../../shared/positions.js');
  const { normaliseAthlete } = await import('../../shared/matching/pool.js');
  const { buildPoolContext } = await import('../lib/v2/poolContext.js');
  const { runPursuit } = await import('../lib/v2/pursuitRun.js');
  const {
    buildValidationAthlete, PROFILES, PURSUIT_WEIGHTS, PURSUIT_GATES, tailGate, abilityToProgrammeScore,
  } = await import('../../shared/matching/v2/index.js');
  const { applicableCost, fundingGap, viabilityFromRelativeGap } = await import('../../shared/matching/v2/layers/financial.js');
  const { CONTRIBUTION_ANCHOR, BUDGET_INTERVALS } = await import('../../shared/matching/v2/financialRules.js');
  const W = PURSUIT_WEIGHTS; const G = PURSUIT_GATES;

  const ctxCache = new Map();
  const contextFor = (sport) => {
    if (!ctxCache.has(sport)) ctxCache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
    return ctxCache.get(sport);
  };

  const runFixture = (f, profileId) => {
    const sport = f.player.sport;
    const ctx = contextFor(sport);
    const position = canonicalPosition(f.player.position);
    const v1Shape = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
    const { athlete } = buildValidationAthlete({
      record: f.player, v1Shape, position, label: f.id, profile: PROFILES[profileId], recruitType: null,
    });
    const run = runPursuit({ athlete, sport, colleges: ctx.colleges, ctx });
    const byId = new Map(ctx.colleges.map((c) => [c.id, c]));
    const rows = run.pipeline.ranked.map((e) => {
      const c = byId.get(e.id);
      const fb = e.financial.basis ?? {};
      return {
        name: e.name, college: c, division: c.division, strength: c.soccer_score, rank: e.rank,
        R: e.recruitability.value, F: e.financial.value, O: e.opportunity.value,
        Fgrade: e.financial.grade, Fbasis: fb,
        P: e.pursuitPriority.value,
        base: e.pursuitPriority.basis?.base ?? null,
        gR: e.pursuitPriority.basis?.recruitabilityGate ?? null,
        gF: e.pursuitPriority.basis?.financialGate ?? null,
      };
    });
    return {
      f, athlete, sport, rows, run, ctx,
      equivalent: abilityToProgrammeScore(f.player.football_ability, sport),
      byName: new Map(rows.map((r) => [r.name, r])),
      limited: run.pipeline.limited.length,
      eligible: ctx.colleges.length,
    };
  };

  /** Production combination, with the R gate optionally neutralised or F replaced. */
  const rescore = (rows, { gateOn = true, fOf = null } = {}) => {
    const out = rows.map((r) => {
      const F = fOf ? fOf(r) : r.F;
      const base = (W.recruitability * r.R) + (W.financial * F) + (W.opportunity * r.O);
      const gR = gateOn ? tailGate(r.R, G.recruitability) : 1;
      return { ...r, F2: F, P2: base * gR * tailGate(F, G.financial) };
    }).sort((a, b) => b.P2 - a.P2);
    out.forEach((r, i) => { r.rank2 = i + 1; });
    return out;
  };

  const setDiff = (a, b, n) => {
    const A = new Set(a.filter((r) => r.rank <= n).map((r) => r.name));
    const Bn = b.filter((r) => r.rank2 <= n).map((r) => r.name);
    return Bn.filter((x) => !A.has(x)).length;
  };

  const KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const fixtureOf = (k) => FIXTURES.find((x) => x.id.toUpperCase().startsWith(`${k}-`));

  // ---------------------------------------------------------------- PART A

  if (args.includes('--gate-ah')) {
    console.log('== 1. GATE ACTIVITY, A-H, both production profiles');
    console.log(`recruitability gate: floor ${G.recruitability.floor}, threshold ${G.recruitability.threshold}\n`);
    console.log(`${'fixture'.padEnd(4)}${'profile'.padEnd(14)}${'rate'.padStart(5)}${'eqStr'.padStart(7)}${'rank'.padStart(6)}${'lim'.padStart(5)}`
      + `${'Rp10'.padStart(7)}${'Rp25'.padStart(7)}${'Rmed'.padStart(7)}${'Rp75'.padStart(7)}${'Rp90'.padStart(7)}`
      + `${'full'.padStart(6)}${'ramp'.padStart(6)}${'floor'.padStart(6)}${'%aff'.padStart(7)}${'maxPen'.padStart(8)}${'medPen'.padStart(8)}`);
    const store = [];
    for (const k of KEYS) {
      for (const pid of ['UNDECLARED', 'LEVEL_FIRST']) {
        const u = runFixture(fixtureOf(k), pid);
        const rs = u.rows.map((r) => r.R);
        const full = u.rows.filter((r) => r.gR >= 0.99999);
        const ramp = u.rows.filter((r) => r.gR < 0.99999 && r.gR > G.recruitability.floor + 1e-9);
        const floor = u.rows.filter((r) => r.gR <= G.recruitability.floor + 1e-9);
        const pen = u.rows.filter((r) => r.gR < 0.99999).map((r) => r.base - (r.base * r.gR));
        console.log(`${k.padEnd(4)}${pid.padEnd(14)}${String(u.f.player.football_ability).padStart(5)}${fmt(u.equivalent, 1).padStart(7)}`
          + `${String(u.rows.length).padStart(6)}${String(u.limited).padStart(5)}`
          + `${fmt(qu(rs, 0.1)).padStart(7)}${fmt(qu(rs, 0.25)).padStart(7)}${fmt(med(rs)).padStart(7)}${fmt(qu(rs, 0.75)).padStart(7)}${fmt(qu(rs, 0.9)).padStart(7)}`
          + `${String(full.length).padStart(6)}${String(ramp.length).padStart(6)}${String(floor.length).padStart(6)}`
          + `${(100 * (ramp.length + floor.length) / u.rows.length).toFixed(1).padStart(7)}`
          + `${fmt(pen.length ? Math.max(...pen) : 0).padStart(8)}${fmt(pen.length ? med(pen) : 0).padStart(8)}`);
        store.push({ k, pid, u });
      }
    }

    console.log('\n== 2. GATE ON vs NEUTRALISED, same weights, same layers');
    console.log(`${'fixture'.padEnd(4)}${'profile'.padEnd(14)}${'n'.padStart(6)}${'tau'.padStart(8)}${'rho'.padStart(8)}`
      + `${'1+'.padStart(6)}${'10+'.padStart(6)}${'25+'.padStart(6)}${'50+'.padStart(6)}${'d25'.padStart(6)}${'d100'.padStart(6)}${'d250'.padStart(6)}${'maxMove'.padStart(9)}  worst mover`);
    for (const { k, pid, u } of store) {
      const off = rescore(u.rows, { gateOn: false });
      const byName = new Map(off.map((r) => [r.name, r]));
      const a = []; const b = [];
      let m1 = 0; let m10 = 0; let m25 = 0; let m50 = 0; let worst = null;
      for (const r of u.rows) {
        const o = byName.get(r.name);
        a.push(r.rank); b.push(o.rank2);
        const d = Math.abs(r.rank - o.rank2);
        if (d >= 1) m1 += 1; if (d >= 10) m10 += 1; if (d >= 25) m25 += 1; if (d >= 50) m50 += 1;
        if (!worst || d > worst.d) worst = { d, name: r.name, with: r.rank, without: o.rank2, R: r.R };
      }
      console.log(`${k.padEnd(4)}${pid.padEnd(14)}${String(u.rows.length).padStart(6)}${fmt(kendall(a, b)).padStart(8)}${fmt(spearmanOfRanks(a, b)).padStart(8)}`
        + `${String(m1).padStart(6)}${String(m10).padStart(6)}${String(m25).padStart(6)}${String(m50).padStart(6)}`
        + `${String(setDiff(u.rows, off, 25)).padStart(6)}${String(setDiff(u.rows, off, 100)).padStart(6)}${String(setDiff(u.rows, off, 250)).padStart(6)}`
        + `${String(worst.d).padStart(9)}  ${worst.d ? `${worst.name} R ${fmt(worst.R)} #${worst.with}->#${worst.without}` : 'none'}`);
    }
  }

  if (args.includes('--r-bands')) {
    console.log('== 2b. WHERE LOW-R ATHLETES ACTUALLY LIVE (does the gate have anything to bite?)');
    console.log(`${'fixture'.padEnd(4)}${'profile'.padEnd(14)}${'rate'.padStart(5)}${'n'.padStart(6)}`
      + `${'R<.25'.padStart(8)}${'.25-.30'.padStart(9)}${'.30-.40'.padStart(9)}${'R>=.40'.padStart(8)}${'minR'.padStart(7)}  strongest gated programme`);
    for (const k of KEYS) {
      for (const pid of ['UNDECLARED', 'LEVEL_FIRST']) {
        const u = runFixture(fixtureOf(k), pid);
        const n = u.rows.length;
        const c = (t) => u.rows.filter(t).length;
        const gated = u.rows.filter((r) => r.gR < 0.99999).sort((a, b) => a.R - b.R);
        console.log(`${k.padEnd(4)}${pid.padEnd(14)}${String(u.f.player.football_ability).padStart(5)}${String(n).padStart(6)}`
          + `${String(c((r) => r.R < 0.25)).padStart(8)}${String(c((r) => r.R >= 0.25 && r.R < 0.30)).padStart(9)}`
          + `${String(c((r) => r.R >= 0.30 && r.R < 0.40)).padStart(9)}${String(c((r) => r.R >= 0.40)).padStart(8)}`
          + `${fmt(Math.min(...u.rows.map((r) => r.R))).padStart(7)}  ${gated.length ? `${gated[0].name} R ${fmt(gated[0].R)} gR ${fmt(gated[0].gR)} #${gated[0].rank}` : 'none gated'}`);
      }
    }
  }

  if (args.includes('--reach-gate')) {
    console.log('== 3. REACH GUARD, gate on vs neutralised. Baseline: at most 1 intrusion, none better than #66.\n');
    console.log(`${'fixture'.padEnd(4)}${'profile'.padEnd(14)}${'eq'.padStart(6)}${'onN'.padStart(6)}${'offN'.padStart(6)}  differences`);
    let totOn = 0; let totOff = 0; let worstOn = null; let worstOff = null;
    for (const k of KEYS) {
      for (const pid of ['UNDECLARED', 'LEVEL_FIRST']) {
        const u = runFixture(fixtureOf(k), pid);
        const eq = u.equivalent;
        const off = rescore(u.rows, { gateOn: false });
        const far = (r, rk) => Number.isFinite(r.strength) && r.strength - eq >= 10 && rk <= 100;
        const on = u.rows.filter((r) => far(r, r.rank)).map((r) => ({ name: r.name, rank: r.rank, s: r.strength, R: r.R, O: r.O, base: r.base, gR: r.gR }));
        const of = off.filter((r) => far(r, r.rank2)).map((r) => ({ name: r.name, rank: r.rank2, s: r.strength, R: r.R, O: r.O, base: r.base, gR: r.gR, withGate: r.rank }));
        totOn += on.length; totOff += of.length;
        for (const i of on) if (!worstOn || i.rank < worstOn.rank) worstOn = { ...i, k, pid };
        for (const i of of) if (!worstOff || i.rank < worstOff.rank) worstOff = { ...i, k, pid };
        const names = new Set(on.map((i) => i.name));
        const extra = of.filter((i) => !names.has(i.name));
        console.log(`${k.padEnd(4)}${pid.padEnd(14)}${fmt(eq, 1).padStart(6)}${String(on.length).padStart(6)}${String(of.length).padStart(6)}`
          + `  ${extra.length ? extra.map((i) => `ADMITTED ${i.name} #${i.rank} (str ${fmt(i.s, 1)}, R ${fmt(i.R)}, O ${fmt(i.O)}, base ${fmt(i.base)}, gR ${fmt(i.gR)}, #${i.withGate} with gate)`).join('; ')
            : (on.length ? on.map((i) => `${i.name} #${i.rank} both ways (str ${fmt(i.s, 1)})`).join('; ') : 'none either way')}`);
      }
    }
    console.log(`\ntotal far-above intrusions inside the first 100:  gate on ${totOn}   gate neutralised ${totOff}`);
    console.log(`worst with gate:      ${worstOn ? `${worstOn.name} #${worstOn.rank} [${worstOn.k}/${worstOn.pid}]` : 'none'}`);
    console.log(`worst without gate:   ${worstOff ? `${worstOff.name} #${worstOff.rank} [${worstOff.k}/${worstOff.pid}]` : 'none'}`);
    const fail = (t, w) => t > 1 || (w && w.rank < 66);
    console.log(`guard with gate:      ${fail(totOn, worstOn) ? 'FAILED' : 'holds'}`);
    console.log(`guard without gate:   ${fail(totOff, worstOff) ? 'FAILED' : 'holds'}`);
  }

  // ---------------------------------------------------------------- PART B

  const FIN_TARGETS = ['Penn State', 'Vermont', 'Rutgers', 'Michigan', 'Pittsburgh'];
  const SIX = ['Furman', 'Princeton', 'Vermont', 'Rutgers', 'Loyola Marymount', 'Penn State'];

  if (args.includes('--fin-trace')) {
    const u = runFixture(fixtureOf('A'), 'FULLY_DECLARED_LEVEL');
    console.log(`A-strong-high-budget · FULLY_DECLARED_LEVEL · budget_range ${JSON.stringify(u.f.player.budget_range)}`);
    console.log(`athlete state ${u.f.player.state}  origin ${u.f.player.origin}  interval ${JSON.stringify(BUDGET_INTERVALS['$40k+/yr'])}  CONTRIBUTION_ANCHOR ${money(CONTRIBUTION_ANCHOR)}\n`);
    for (const n of [...FIN_TARGETS, 'Furman', 'Princeton', 'Loyola Marymount']) {
      const r = u.byName.get(n);
      if (!r) { console.log(`${n}: not ranked\n`); continue; }
      const b = r.Fbasis; const c = r.college;
      console.log(`-- ${n}  (#${r.rank}, F ${fmt(r.F)} ${r.Fgrade}, P ${fmt(r.P)}, gF ${fmt(r.gF)})`);
      console.log(`   control ${c.control} (${c.control === 1 ? 'public' : 'private'})  state ${c.state}  division ${c.division}  conference ${c.conference ?? '—'}`);
      console.log(`   net_price ${money(c.net_price)}  tuition_in ${money(c.tuition_in_state)}  tuition_out ${money(c.tuition_out_state)}  premium ${money(b.outOfStatePremium)}`);
      console.log(`   costBasis ${b.costBasis}  residency ${b.residency ?? '—'}  applicableCost [${money(b.applicableCostRange?.[0])}, ${money(b.applicableCostRange?.[1])}]`);
      console.log(`   familyContribution [${money(b.familyContributionRange?.[0])}, ${b.budgetCeilingUnstated ? 'UNSTATED' : money(b.familyContributionRange?.[1])}]  anchor ${money(b.contributionAnchor)}`);
      console.log(`   fundingGap [${money(b.fundingGapRange?.[0])}, ${money(b.fundingGapRange?.[1])}]  relativeGap [${fmt(b.relativeGapRange?.[0])}, ${fmt(b.relativeGapRange?.[1])}]`);
      console.log(`   viabilityRange [${fmt(b.viabilityRange?.[0])}, ${fmt(b.viabilityRange?.[1])}]  budgetCeilingUnstated ${b.budgetCeilingUnstated}  -> value = WORST END ${fmt(r.F)}`);
      console.log(`   aidPolicy ${b.aidPolicy}  headroom ${b.aidHeadroomFraction}  athleticAwardAssumed ${b.athleticAwardAssumed}  meritAidAssumed ${b.meritAidAssumed}\n`);
    }
  }

  /**
   * Financial under a stated EXACT maximum annual family contribution.
   *
   * Production primitives only: the same applicableCost the run used, the same
   * interval subtraction, the same curve, the same anchor rule. The only thing
   * that changes is the INTERVAL the athlete's answer becomes - [max, max]
   * instead of [floor, Infinity) - which is the whole point of the exercise.
   */
  const finAtMax = (row, maxContribution) => {
    if (maxContribution === Infinity) return 1; // cost stated as not a constraint
    const b = row.Fbasis;
    const cost = { lo: b.applicableCostRange[0], hi: b.applicableCostRange[1] };
    const gap = fundingGap({ cost, budget: [maxContribution, maxContribution] });
    const anchor = Math.max(maxContribution, CONTRIBUTION_ANCHOR);
    return (viabilityFromRelativeGap(gap.hi / anchor) + viabilityFromRelativeGap(gap.lo / anchor)) / 2;
  };

  if (args.includes('--fin-grid')) {
    const u = runFixture(fixtureOf('A'), 'FULLY_DECLARED_LEVEL');
    const prod = u.rows;
    const SCEN = [['$30k', 30000], ['$40k', 40000], ['$50k', 50000], ['$60k', 60000],
      ['$70k', 70000], ['$80k', 80000], ['NOT A CONSTRAINT', Infinity]];
    console.log('== 10. CONTRIBUTION SENSITIVITY (Fixture A, FULLY_DECLARED_LEVEL). Production weights and gates throughout.');
    console.log(`current production: band "$40k+/yr" -> [40000, UNSTATED), scored at the WORST end\n`);
    console.log(`${'scenario'.padEnd(18)}${'Fp10'.padStart(7)}${'Fmed'.padStart(7)}${'Fp90'.padStart(7)}${'F=1'.padStart(6)}${'F<.5'.padStart(7)}`
      + `${'tau'.padStart(8)}${'top100str'.padStart(11)}${'top250str'.padStart(11)}${'50+'.padStart(6)}${'100+'.padStart(6)}`);
    const curves = new Map(SIX.concat(FIN_TARGETS).map((n) => [n, []]));
    for (const [label, maxC] of SCEN) {
      const alt = rescore(prod, { fOf: (r) => finAtMax(r, maxC) });
      const byName = new Map(alt.map((r) => [r.name, r]));
      const a = []; const b = []; let m50 = 0; let m100 = 0;
      for (const r of prod) {
        const o = byName.get(r.name); a.push(r.rank); b.push(o.rank2);
        const d = Math.abs(r.rank - o.rank2); if (d >= 50) m50 += 1; if (d >= 100) m100 += 1;
      }
      const fs = alt.map((r) => r.F2);
      const t100 = med(alt.filter((r) => r.rank2 <= 100).map((r) => r.strength));
      const t250 = med(alt.filter((r) => r.rank2 <= 250).map((r) => r.strength));
      console.log(`${label.padEnd(18)}${fmt(qu(fs, 0.1)).padStart(7)}${fmt(med(fs)).padStart(7)}${fmt(qu(fs, 0.9)).padStart(7)}`
        + `${String(fs.filter((x) => x >= 0.9999).length).padStart(6)}${String(fs.filter((x) => x < 0.5).length).padStart(7)}`
        + `${fmt(kendall(a, b)).padStart(8)}${fmt(t100, 1).padStart(11)}${fmt(t250, 1).padStart(11)}${String(m50).padStart(6)}${String(m100).padStart(6)}`);
      for (const [n, arr] of curves) { const o = byName.get(n); arr.push(o ? { rank: o.rank2, F: o.F2, P: o.P2 } : null); }
    }
    console.log(`\n== 11. RANK CURVES  (production rank in brackets)`);
    console.log(`${'programme'.padEnd(20)}${'prod'.padStart(7)}${SCEN.map(([l]) => l.slice(0, 8).padStart(9)).join('')}`);
    for (const [n, arr] of curves) {
      const p = u.byName.get(n);
      console.log(`${n.slice(0, 19).padEnd(20)}${(p ? `#${p.rank}` : '—').padStart(7)}${arr.map((x) => (x ? `#${x.rank}` : '—').padStart(9)).join('')}`);
    }
    console.log(`\n${'programme'.padEnd(20)}${'prodF'.padStart(7)}${SCEN.map(([l]) => l.slice(0, 8).padStart(9)).join('')}   (Financial)`);
    for (const [n, arr] of curves) {
      const p = u.byName.get(n);
      console.log(`${n.slice(0, 19).padEnd(20)}${fmt(p?.F, 2).padStart(7)}${arr.map((x) => fmt(x?.F, 2).padStart(9)).join('')}`);
    }
  }

  if (args.includes('--fin-mono')) {
    const u = runFixture(fixtureOf('A'), 'FULLY_DECLARED_LEVEL');
    console.log('== 12. MONOTONICITY');
    const LADDER = [0, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 50000, 60000, 70000, 80000, 100000, 150000];
    let viol = 0; let worst = null;
    for (const r of u.rows) {
      let prev = -1;
      for (const m of LADDER) {
        const v = finAtMax(r, m);
        if (v < prev - 1e-12) { viol += 1; if (!worst || prev - v > worst.d) worst = { d: prev - v, name: r.name, m }; }
        prev = v;
      }
      const inf = finAtMax(r, Infinity);
      if (inf < prev - 1e-12) { viol += 1; worst = { d: prev - inf, name: r.name, m: 'Infinity' }; }
    }
    console.log(`  rising maximum contribution never lowers Financial: ${viol === 0 ? 'HOLDS' : `VIOLATED ${viol}x`} over ${u.rows.length} programmes x ${LADDER.length + 1} steps`);
    if (worst) console.log(`  worst violation: ${worst.name} at ${worst.m} by ${fmt(worst.d)}`);
    let nc = 0;
    for (const r of u.rows) {
      const covered = finAtMax(r, r.Fbasis.applicableCostRange[1]);
      if (finAtMax(r, Infinity) < covered - 1e-12) nc += 1;
    }
    console.log(`  NOT-A-CONSTRAINT never below a finite contribution that already covers the cost: ${nc === 0 ? 'HOLDS' : `VIOLATED ${nc}x`}`);
    console.log('\n  the CURRENT band ladder, at the production athlete, for comparison:');
    const bands = Object.keys(BUDGET_INTERVALS);
    const sample = u.byName.get('Penn State') ?? u.rows[0];
    const cost = { lo: sample.Fbasis.applicableCostRange[0], hi: sample.Fbasis.applicableCostRange[1] };
    console.log(`    against ${sample.name}, applicable cost [${money(cost.lo)}, ${money(cost.hi)}]`);
    let prevV = -1; let bandViol = 0;
    for (const bd of bands) {
      const iv = BUDGET_INTERVALS[bd];
      const g = fundingGap({ cost, budget: iv });
      const anchor = Math.max(iv[0], CONTRIBUTION_ANCHOR);
      const vHi = viabilityFromRelativeGap(g.lo / anchor); const vLo = viabilityFromRelativeGap(g.hi / anchor);
      const v = Number.isFinite(iv[1]) ? (vLo + vHi) / 2 : vLo;
      if (v < prevV - 1e-12) bandViol += 1;
      console.log(`      ${bd.padEnd(22)} interval [${money(iv[0])}, ${Number.isFinite(iv[1]) ? money(iv[1]) : 'INF'}]  F ${fmt(v)}${v < prevV - 1e-12 ? '   <-- DROPS' : ''}`);
      prevV = v;
    }
    console.log(`    band ladder monotonic: ${bandViol === 0 ? 'HOLDS' : `VIOLATED ${bandViol}x`}`);
  }

  if (args.includes('--six')) {
    const u = runFixture(fixtureOf('A'), 'FULLY_DECLARED_LEVEL');
    const SCEN = [['production ($40k+ band)', null], ['max $40k exactly', 40000], ['max $60k', 60000],
      ['max $80k', 80000], ['NOT A CONSTRAINT', Infinity]];
    console.log('== 18. THE SIX FIXTURE A TARGETS UNDER CORRECTED INPUT');
    for (const [label, maxC] of SCEN) {
      const alt = maxC === null ? rescore(u.rows, {}) : rescore(u.rows, { fOf: (r) => finAtMax(r, maxC) });
      const byName = new Map(alt.map((r) => [r.name, r]));
      console.log(`\n-- ${label}`);
      console.log(`   ${'programme'.padEnd(20)}${'F'.padStart(7)}${'P'.padStart(7)}${'rank'.padStart(7)}`);
      for (const n of SIX) {
        const r = byName.get(n);
        console.log(`   ${n.padEnd(20)}${fmt(r.F2).padStart(7)}${fmt(r.P2).padStart(7)}${String(r.rank2).padStart(7)}`);
      }
      const t100 = med(alt.filter((r) => r.rank2 <= 100).map((r) => r.strength));
      console.log(`   top-100 median strength ${fmt(t100, 1)}   near-level (+-3) in top 100 ${alt.filter((r) => r.rank2 <= 100 && Math.abs(r.strength - u.equivalent) < 3).length}`);
    }
  }

  if (args.includes('--interaction')) {
    console.log('== 19. DOES THE FINANCIAL REPAIR CHANGE THE GATE DECISION?');
    console.log('   Only A and C state "$40k+/yr", so only they can move. Both re-run with the');
    console.log('   ceiling stated as NOT A CONSTRAINT, gate on vs neutralised.\n');
    console.log(`${'fixture'.padEnd(4)}${'profile'.padEnd(14)}${'input'.padEnd(20)}${'tau'.padStart(8)}${'50+'.padStart(6)}${'reach<=100'.padStart(12)}  admitted without the gate`);
    for (const k of ['A', 'C']) {
      for (const pid of ['UNDECLARED', 'LEVEL_FIRST']) {
        const u = runFixture(fixtureOf(k), pid);
        const eq = u.equivalent;
        for (const [label, fOf] of [['production band', null], ['NOT A CONSTRAINT', (r) => finAtMax(r, Infinity)]]) {
          const on = rescore(u.rows, { fOf });
          const off = rescore(u.rows, { gateOn: false, fOf });
          const byOff = new Map(off.map((r) => [r.name, r]));
          const a = []; const b = []; let m50 = 0;
          for (const r of on) { const o = byOff.get(r.name); a.push(r.rank2); b.push(o.rank2); if (Math.abs(r.rank2 - o.rank2) >= 50) m50 += 1; }
          const far = (r) => Number.isFinite(r.strength) && r.strength - eq >= 10;
          const onReach = new Set(on.filter((r) => r.rank2 <= 100 && far(r)).map((r) => r.name));
          const extra = off.filter((r) => r.rank2 <= 100 && far(r) && !onReach.has(r.name));
          console.log(`${k.padEnd(4)}${pid.padEnd(14)}${label.padEnd(20)}${fmt(kendall(a, b)).padStart(8)}${String(m50).padStart(6)}${String(onReach.size).padStart(12)}  ${extra.length ? extra.map((r) => `${r.name} #${r.rank2} (str ${fmt(r.strength, 1)}, R ${fmt(r.R)})`).join('; ') : 'none'}`);
        }
      }
    }
  }

  if (args.includes('--legacy')) {
    console.log('== 14. LEGACY ATHLETE FINANCIAL DATA');
    const cols = db.prepare('PRAGMA table_info(players)').all().map((c) => c.name);
    console.log(`  player columns matching /budget|financ|cost|contrib|aid|scholar/: ${JSON.stringify(cols.filter((n) => /budget|financ|cost|contrib|aid|scholar/i.test(n)))}`);
    const total = db.prepare('SELECT COUNT(*) n FROM players').get().n;
    console.log(`  players on file: ${total}`);
    const rows = db.prepare('SELECT budget_range b, COUNT(*) n FROM players GROUP BY budget_range ORDER BY n DESC').all();
    const current = new Set(Object.keys(BUDGET_INTERVALS));
    for (const r of rows) {
      const label = r.b === null ? '(NULL)' : (r.b === '' ? '(empty)' : r.b);
      const kind = r.b === null || r.b === '' ? 'ABSENT' : (current.has(r.b) ? 'current band' : 'NOT A CURRENT BAND');
      console.log(`    ${label.padEnd(26)}${String(r.n).padStart(5)}  ${(100 * r.n / total).toFixed(1).padStart(5)}%   ${kind}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
