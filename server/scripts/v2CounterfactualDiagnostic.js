/**
 * A7.7.11: what V2 did with the 19 controlled counterfactual pairs, and what
 * the whole eligible universe looks like for the same athlete.
 *
 * READ-ONLY AND DIAGNOSTIC. Nothing here scores, weights, gates, calibrates or
 * persists anything. The run is the ordinary `runPursuit` the validation pack
 * generator uses; every alternative weighting below is recomputed
 * arithmetically from the layer values that run already produced, using the
 * production combination, so a sensitivity test cannot quietly become a
 * different model.
 *
 *   node server/scripts/v2CounterfactualDiagnostic.js --pairs
 *   node server/scripts/v2CounterfactualDiagnostic.js --universe
 *   node server/scripts/v2CounterfactualDiagnostic.js --relative
 *   node server/scripts/v2CounterfactualDiagnostic.js --sensitivity
 *   node server/scripts/v2CounterfactualDiagnostic.js --set2
 *   node server/scripts/v2CounterfactualDiagnostic.js --limited
 *   node server/scripts/v2CounterfactualDiagnostic.js --financial
 */
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES } from './v2Fixtures.js';
import { PROFILES } from './v2ValidationFixtures.js';

const SEASON = '2026';
const PROFILE = 'FULLY_DECLARED_LEVEL';
const REVIEW = 'docs/validation/counterfactual-review.json';
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const med = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

async function main() {
  const args = process.argv.slice(2);
  const { default: db } = await import('../db/client.js');
  const { canonicalPosition } = await import('../../shared/positions.js');
  const { normaliseAthlete } = await import('../../shared/matching/pool.js');
  const { buildPoolContext } = await import('../lib/v2/poolContext.js');
  const { runPursuit } = await import('../lib/v2/pursuitRun.js');
  const {
    buildValidationAthlete, PURSUIT_WEIGHTS, PURSUIT_GATES, tailGate,
  } = await import('../../shared/matching/v2/index.js');

  const fixture = FIXTURES.find((f) => f.id.toUpperCase().startsWith('A-'));
  const profile = PROFILES[PROFILE];
  const sport = fixture.player.sport;
  const position = canonicalPosition(fixture.player.position);
  const ctx = buildPoolContext({ db, sport, season: SEASON });
  const v1Shape = normaliseAthlete({ ...fixture.player, preferred_divisions: '[]', preferred_conferences: '[]' });
  const { athlete } = buildValidationAthlete({
    record: fixture.player, v1Shape, position, label: fixture.id, profile, recruitType: null,
  });
  const run = runPursuit({ athlete, sport, colleges: ctx.colleges, ctx });
  const byId = new Map(ctx.colleges.map((c) => [c.id, c]));

  const rows = run.pipeline.ranked.map((e) => {
    const rb = e.recruitability.basis ?? {};
    const ob = e.opportunity.basis ?? {};
    const c = byId.get(e.id);
    const sig = (k) => (rb.signals ?? []).find((s) => s.key === k) ?? null;
    const comp = (k) => ob.components?.[k] ?? null;
    return {
      id: e.id, name: e.name, division: c.division, rank: e.rank,
      strength: c.soccer_score, academic: c.academic_rating,
      A: rb.athleticPlausibility ?? null, delta: rb.athleticDelta ?? null,
      pos: sig('positionalOpportunity')?.value ?? null,
      posState: sig('positionalOpportunity')?.state ?? null,
      mkt: sig('recruitingMarket')?.value ?? null,
      mktState: sig('recruitingMarket')?.state ?? null,
      R: e.recruitability.value, Rgrade: e.recruitability.grade, Rcov: e.recruitability.coverage,
      F: e.financial.value, Fgrade: e.financial.grade, fb: e.financial.basis ?? {},
      O: e.opportunity.value, Ograde: e.opportunity.grade,
      oPlaying: comp('playingOpportunity')?.value ?? null,
      oPlayShare: comp('playingOpportunity')?.share ?? null,
      oOutcome: comp('athleticOutcome')?.value ?? null,
      oOutcomeShare: comp('athleticOutcome')?.share ?? null,
      oAcademic: comp('academicStrengthFit')?.value ?? null,
      oAcademicShare: comp('academicStrengthFit')?.share ?? null,
      oTrajectory: comp('programmeTrajectory')?.value ?? null,
      oLocation: comp('locationFit')?.value ?? null,
      playingBasis: ob.playing ?? null,
      P: e.pursuitPriority.value,
      gateR: e.pursuitPriority.basis?.recruitabilityGate ?? null,
      gateF: e.pursuitPriority.basis?.financialGate ?? null,
      base: e.pursuitPriority.basis?.base ?? null,
    };
  });
  const byName = new Map(rows.map((r) => [r.name, r]));
  const limited = run.pipeline.limited.map((e) => {
    const c = byId.get(e.id);
    return {
      id: e.id, name: e.name, division: c.division, strength: c.soccer_score, academic: c.academic_rating,
      reasons: ['recruitability', 'financial', 'opportunity']
        .filter((k) => e[k] && e[k].ok === false)
        .map((k) => `${k}:${e[k].reason}`),
      shape: Object.keys(e),
    };
  });

  if (args.includes('--pairs')) {
    const review = JSON.parse(fs.readFileSync(path.resolve(REVIEW), 'utf8'));
    for (const p of review.pairs) {
      const a = byName.get(p.A); const b = byName.get(p.B);
      console.log(`### ${p.pair}  human first=${p.firstPursuit}  incA=${p.includeA}  incB=${p.includeB}`);
      for (const [t, r] of [['A', a], ['B', b]]) {
        if (!r) { console.log(`  ${t} ${p[t]} NOT RANKED`); continue; }
        console.log(`  ${t} ${r.name.padEnd(24)} str ${fmt(r.strength, 1).padStart(5)} A ${fmt(r.A)} pos ${fmt(r.pos)}(${r.posState}) mkt ${fmt(r.mkt)} `
          + `R ${fmt(r.R)} ${r.Rgrade}/${fmt(r.Rcov, 2)} F ${fmt(r.F)} O ${fmt(r.O)} [play ${fmt(r.oPlaying)} out ${fmt(r.oOutcome)} acad ${fmt(r.oAcademic)}] `
          + `P ${fmt(r.P)} gR ${fmt(r.gateR)} gF ${fmt(r.gateF)} #${r.rank}${r.rank <= 100 ? ' IN100' : ''}`);
      }
      if (a && b) {
        const higher = a.P > b.P ? 'A' : 'B';
        console.log(`    -> V2 higher=${higher}  dP ${fmt(Math.abs(a.P - b.P))}  rank distance ${Math.abs(a.rank - b.rank)}  (A #${a.rank}, B #${b.rank})`);
      }
    }
  }

  if (args.includes('--universe')) {
    console.log(`eligible ${ctx.colleges.length}  ranked ${rows.length}  limited ${limited.length}  ineligible ${run.pipeline.ineligible?.length ?? 0}  suppressed ${run.pipeline.suppressed?.length ?? 0}`);
    const bands = [[1, 25], [26, 50], [51, 100], [101, 250], [251, 500], [501, rows.length]];
    console.log('band         n   medStr  medR   medO   medP   divisions');
    for (const [lo, hi] of bands) {
      const b = rows.filter((r) => r.rank >= lo && r.rank <= hi);
      const d = {}; for (const r of b) d[r.division] = (d[r.division] ?? 0) + 1;
      console.log(`${`${lo}-${hi}`.padEnd(12)} ${String(b.length).padStart(3)}  ${fmt(med(b.map((r) => r.strength)), 1).padStart(6)} ${fmt(med(b.map((r) => r.R)))} ${fmt(med(b.map((r) => r.O)))} ${fmt(med(b.map((r) => r.P)))}  ${JSON.stringify(d)}`);
    }
  }

  if (args.includes('--relative')) {
    const eq = 83.58;
    const BANDS = [
      ['substantially above (>= +10)', (s) => s - eq >= 10],
      ['moderately above (+3 to +10)', (s) => s - eq >= 3 && s - eq < 10],
      ['approximately at level (-3 to +3)', (s) => Math.abs(s - eq) < 3],
      ['moderately below (-15 to -3)', (s) => s - eq <= -3 && s - eq > -15],
      ['substantially below (< -15)', (s) => s - eq <= -15],
    ];
    console.log(`athlete equivalent programme strength ${eq}`);
    console.log('band                                 n   medR   medO   medP   medRank  in100');
    for (const [label, test] of BANDS) {
      const b = rows.filter((r) => Number.isFinite(r.strength) && test(r.strength));
      console.log(`${label.padEnd(36)} ${String(b.length).padStart(3)}  ${fmt(med(b.map((r) => r.R)))} ${fmt(med(b.map((r) => r.O)))} ${fmt(med(b.map((r) => r.P)))} ${String(med(b.map((r) => r.rank))).padStart(7)}  ${b.filter((r) => r.rank <= 100).length}`);
    }
  }

  if (args.includes('--sensitivity')) {
    const W = PURSUIT_WEIGHTS; const G = PURSUIT_GATES;
    const review = JSON.parse(fs.readFileSync(path.resolve(REVIEW), 'utf8'));
    const score = (r, wR, gateOn) => {
      const rest = 1 - wR;
      const wF = (W.financial / (W.financial + W.opportunity)) * rest;
      const wO = (W.opportunity / (W.financial + W.opportunity)) * rest;
      const base = (wR * r.R) + (wF * r.F) + (wO * r.O);
      return gateOn ? base * tailGate(r.R, G.recruitability) * tailGate(r.F, G.financial) : base;
    };
    const rankAll = (wR, gateOn) => {
      const scored = rows.map((r) => ({ name: r.name, s: score(r, wR, gateOn) })).sort((x, y) => y.s - x.s);
      return new Map(scored.map((x, i) => [x.name, i + 1]));
    };
    const GRID = [[0.50, true, 'production'], [0.50, false, 'gate off'], [0.40, true, 'R 0.40'], [0.30, true, 'R 0.30'],
      [0.40, false, 'R 0.40, gate off'], [0.30, false, 'R 0.30, gate off']];
    const maps = GRID.map(([wR, g, label]) => [label, rankAll(wR, g)]);
    console.log('pair  programme                 ' + maps.map(([l]) => l.padStart(18)).join(''));
    for (const p of review.pairs) {
      for (const n of [p.A, p.B]) {
        console.log(`${p.pair.padEnd(6)}${n.slice(0, 24).padEnd(26)}` + maps.map(([, m]) => String(m.get(n) ?? '—').padStart(18)).join(''));
      }
    }
    console.log('');
    console.log('--- realism guard under each setting: rank of the strongest programmes ---');
    const guard = rows.filter((r) => r.strength >= 92).sort((a, b) => b.strength - a.strength).slice(0, 8);
    for (const g of guard) {
      console.log(`  ${g.name.slice(0, 22).padEnd(24)} str ${fmt(g.strength, 1)}` + maps.map(([, m]) => String(m.get(g.name)).padStart(18)).join(''));
    }
    console.log('');
    console.log('--- top 10 under each setting ---');
    for (const [label, m] of maps) {
      const top = [...m.entries()].filter(([, v]) => v <= 10).sort((a, b) => a[1] - b[1]).map(([k]) => `${k}(${fmt(byName.get(k).strength, 0)})`);
      console.log(`  ${label.padEnd(20)} ${top.join(' ')}`);
    }
  }

  if (args.includes('--set2')) {
    for (const n of ['Clemson', 'Pittsburgh', 'Louisville', 'North Florida', "Saint Mary's", 'VMI', 'UC Davis', 'Rollins']) {
      const r = byName.get(n);
      console.log(`${n.padEnd(16)} pos ${fmt(r.pos)}  playing ${fmt(r.oPlaying)} (share ${fmt(r.oPlayShare, 2)})  playingBasis ${JSON.stringify(r.playingBasis)}`);
    }
  }

  if (args.includes('--limited')) {
    const why = {}; const div = {};
    for (const l of limited) {
      const k = l.reasons.map((x) => x.split(':')[0]).join('+');
      why[k] = (why[k] ?? 0) + 1;
      div[l.division] = (div[l.division] ?? 0) + 1;
      const rk = l.reasons.join(' ');
      why[`  ${rk}`] = (why[`  ${rk}`] ?? 0) + 1;
    }
    console.log(`limited ${limited.length} of ${ctx.colleges.length}`);
    console.log('by layer  ', JSON.stringify(Object.fromEntries(Object.entries(why).filter(([k]) => !k.startsWith('  ')))));
    console.log('by division', JSON.stringify(div));
    console.log('by reason  ', JSON.stringify(Object.fromEntries(Object.entries(why).filter(([k]) => k.startsWith('  ')))));
    const strong = limited.filter((l) => Number.isFinite(l.strength) && l.strength >= 70).sort((a, b) => b.strength - a.strength);
    console.log(`limited with strength >= 70: ${strong.length}`);
    for (const s of strong.slice(0, 15)) console.log(`   ${s.name.padEnd(28)} ${s.division.padEnd(9)} str ${fmt(s.strength, 1)} acad ${fmt(s.academic, 1)}  ${s.reasons.join(' ')}`);
  }

  if (args.includes('--doubleuse')) {
    const corr = (xs, ys) => {
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length; const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let sxy = 0; let sxx = 0; let syy = 0;
      for (let i = 0; i < xs.length; i += 1) { const dx = xs[i] - mx; const dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
      return sxy / Math.sqrt(sxx * syy);
    };
    const ok = rows.filter((r) => Number.isFinite(r.pos) && Number.isFinite(r.oPlaying));
    console.log(`n ${ok.length}`);
    console.log(`  corr(positionalOpportunity, playingOpportunity) = ${fmt(corr(ok.map((r) => r.pos), ok.map((r) => r.oPlaying)))}`);
    console.log(`  corr(positionalOpportunity, Opportunity)        = ${fmt(corr(ok.map((r) => r.pos), ok.map((r) => r.O)))}`);
    console.log(`  corr(positionalOpportunity, Recruitability)     = ${fmt(corr(ok.map((r) => r.pos), ok.map((r) => r.R)))}`);
    const prog = ok.filter((r) => r.playingBasis?.level === 'programme');
    console.log(`  programme-level playing share: ${prog.length} of ${ok.length}; division fallback ${ok.length - prog.length}`);
    console.log(`  share of Opportunity taken by playingOpportunity: median ${fmt(med(ok.map((r) => r.oPlayShare)), 3)}`);
    console.log(`  share taken by athleticOutcome: median ${fmt(med(ok.filter((r) => Number.isFinite(r.oOutcomeShare)).map((r) => r.oOutcomeShare)), 3)}`);
    console.log(`  share taken by academicStrengthFit: median ${fmt(med(ok.filter((r) => Number.isFinite(r.oAcademicShare)).map((r) => r.oAcademicShare)), 3)}`);
  }

  if (args.includes('--financial')) {
    const capped = rows.filter((r) => r.F < 1);
    console.log(`ranked with F < 1: ${capped.length} of ${rows.length}`);
    const unstated = capped.filter((r) => r.fb.budgetCeilingUnstated);
    console.log(`  of those, budgetCeilingUnstated: ${unstated.length}`);
    console.log('  worst 15 by F:');
    for (const r of [...capped].sort((a, b) => a.F - b.F).slice(0, 15)) {
      const withoutF = rows.map((x) => ({ name: x.name, s: (0.5 * x.R) + (0.2 * 1) + (0.3 * x.O) })).sort((a, b) => b.s - a.s);
      const alt = withoutF.findIndex((x) => x.name === r.name) + 1;
      console.log(`    ${r.name.padEnd(24)} str ${fmt(r.strength, 1).padStart(5)} F ${fmt(r.F)} cost ${JSON.stringify(r.fb.applicableCostRange)} #${r.rank} -> #${alt} if F were 1.000  (${r.rank - alt >= 0 ? '+' : ''}${alt - r.rank})`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
