/**
 * A7.9: how much authority Coach Recruitability actually has over the whole
 * ranking, now that Playing Pathway has been repaired.
 *
 * READ-ONLY AND DIAGNOSTIC. No production scorer, weight, gate, threshold or
 * calibration is touched, and nothing is persisted. Every sensitivity is
 * recomputed arithmetically from the layer values a production run already
 * produced, reusing the production combination and gate function, so an
 * alternative cannot quietly become a different model.
 *
 *   node server/scripts/v2PursuitAuthority.js --profile
 *   node server/scripts/v2PursuitAuthority.js --bands
 *   node server/scripts/v2PursuitAuthority.js --targets
 *   node server/scripts/v2PursuitAuthority.js --sensitivity
 *   node server/scripts/v2PursuitAuthority.js --gate
 *   node server/scripts/v2PursuitAuthority.js --authority
 *   node server/scripts/v2PursuitAuthority.js --plausible
 *   node server/scripts/v2PursuitAuthority.js --confidence
 *   node server/scripts/v2PursuitAuthority.js --pairs
 *   node server/scripts/v2PursuitAuthority.js --financial
 */
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES } from './v2Fixtures.js';
import { PROFILES } from './v2ValidationFixtures.js';

const SEASON = '2026';
const REVIEW = 'docs/validation/counterfactual-review.json';
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const qu = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const med = (xs) => qu(xs, 0.5);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const corr = (xs, ys) => {
  if (xs.length < 3) return null;
  const mx = mean(xs); const my = mean(ys);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < xs.length; i += 1) { const dx = xs[i] - mx; const dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return (sxx === 0 || syy === 0) ? null : sxy / Math.sqrt(sxx * syy);
};
const rankOf = (a) => {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
    const avg = ((i + j) / 2) + 1;
    for (let k = i; k <= j; k += 1) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
};
const spearman = (xs, ys) => corr(rankOf(xs), rankOf(ys));

async function main() {
  const args = process.argv.slice(2);
  const arg = (k, d = null) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
  const { default: db } = await import('../db/client.js');
  const { canonicalPosition } = await import('../../shared/positions.js');
  const { normaliseAthlete } = await import('../../shared/matching/pool.js');
  const { buildPoolContext } = await import('../lib/v2/poolContext.js');
  const { runPursuit } = await import('../lib/v2/pursuitRun.js');
  const {
    buildValidationAthlete, PURSUIT_WEIGHTS, PURSUIT_GATES, tailGate, abilityToProgrammeScore,
  } = await import('../../shared/matching/v2/index.js');
  const W = PURSUIT_WEIGHTS; const G = PURSUIT_GATES;

  const ctxCache = new Map();
  const contextFor = (sport) => {
    if (!ctxCache.has(sport)) ctxCache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
    return ctxCache.get(sport);
  };

  const runFixture = (key, profileId) => {
    const f = FIXTURES.find((x) => x.id.toUpperCase().startsWith(`${key}-`));
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
      const rb = e.recruitability.basis ?? {}; const ob = e.opportunity.basis ?? {};
      const c = byId.get(e.id);
      const sig = (k) => (rb.signals ?? []).find((s) => s.key === k) ?? null;
      const pw = ob.pathway ?? {};
      return {
        name: e.name, division: c.division, strength: c.soccer_score, academic: c.academic_rating,
        rank: e.rank,
        A: rb.athleticPlausibility ?? null, delta: rb.athleticDelta ?? null,
        pos: sig('positionalOpportunity')?.value ?? null, posState: sig('positionalOpportunity')?.state ?? null,
        mkt: sig('recruitingMarket')?.value ?? null, mktState: sig('recruitingMarket')?.state ?? null,
        R: e.recruitability.value, Rgrade: e.recruitability.grade, Rcov: e.recruitability.coverage,
        F: e.financial.value, Fgrade: e.financial.grade,
        O: e.opportunity.value, Ograde: e.opportunity.grade,
        pathway: ob.components?.playingPathway?.value ?? null,
        competition: pw.competition?.value ?? null,
        rotation: pw.rotation?.value ?? null,
        outcome: ob.components?.athleticOutcome?.value ?? null,
        academicFit: ob.components?.academicStrengthFit?.value ?? null,
        P: e.pursuitPriority.value,
        base: e.pursuitPriority.basis?.base ?? null,
        gR: e.pursuitPriority.basis?.recruitabilityGate ?? null,
        gF: e.pursuitPriority.basis?.financialGate ?? null,
      };
    });
    return {
      f, position, rows, run,
      equivalent: abilityToProgrammeScore(f.player.football_ability, sport),
      byName: new Map(rows.map((r) => [r.name, r])),
      limited: run.pipeline.limited.length,
      eligible: ctx.colleges.length,
    };
  };

  /** Re-rank under alternative weights or a neutralised gate. Production combination. */
  const rescore = (rows, { wR = W.recruitability, gateOn = true, holdF = false } = {}) => {
    const rest = 1 - wR;
    const wF = (W.financial / (W.financial + W.opportunity)) * rest;
    const wO = (W.opportunity / (W.financial + W.opportunity)) * rest;
    const out = rows.map((r) => {
      const F = holdF ? 1 : r.F;
      const base = (wR * r.R) + (wF * F) + (wO * r.O);
      const P2 = gateOn ? base * tailGate(r.R, G.recruitability) * tailGate(F, G.financial) : base;
      return { ...r, P2 };
    }).sort((a, b) => b.P2 - a.P2);
    out.forEach((r, i) => { r.rank2 = i + 1; });
    return out;
  };

  const bandsOf = (rows, eq) => ([
    ['substantially above (>= +10)', (s) => s - eq >= 10],
    ['moderately above (+3 to +10)', (s) => s - eq >= 3 && s - eq < 10],
    ['near athlete level (-3 to +3)', (s) => Math.abs(s - eq) < 3],
    ['moderately below (-15 to -3)', (s) => s - eq <= -3 && s - eq > -15],
    ['substantially below (< -15)', (s) => s - eq <= -15],
  ].map(([label, t]) => ({ label, rows: rows.filter((r) => Number.isFinite(r.strength) && t(r.strength)) })));

  const KEY = arg('fixture', 'A');
  const PROF = arg('profile-id', 'FULLY_DECLARED_LEVEL');

  if (args.includes('--profile')) {
    const u = runFixture(KEY, PROF);
    const p = u.run.pipeline;
    console.log(`${u.f.id} · ${PROF} · equivalent strength ${fmt(u.equivalent, 1)}`);
    console.log(`eligible ${u.eligible}  RANKED ${p.ranked.length}  LIMITED_DATA ${p.limited.length}  INELIGIBLE ${p.ineligible?.length ?? 0}  SUPPRESSED ${p.suppressed?.length ?? 0}`);
    const all = u.rows;
    for (const [k, label] of [['strength', 'strength'], ['R', 'R'], ['F', 'F'], ['O', 'O'], ['P', 'P']]) {
      const v = all.map((r) => r[k]).filter(Number.isFinite);
      console.log(`  ${label.padEnd(9)} p10 ${fmt(qu(v, 0.1))}  p25 ${fmt(qu(v, 0.25))}  median ${fmt(med(v))}  p75 ${fmt(qu(v, 0.75))}  p90 ${fmt(qu(v, 0.9))}`);
    }
    console.log('');
    console.log(`${'bucket'.padEnd(11)}${'n'.padStart(5)}${'strP25'.padStart(8)}${'strMed'.padStart(8)}${'strP75'.padStart(8)}${'R'.padStart(7)}${'F'.padStart(7)}${'O'.padStart(7)}${'P'.padStart(7)}  divisions`);
    const BUCKETS = [[1, 25], [26, 50], [51, 100], [101, 250], [251, 500], [501, all.length]];
    for (const [lo, hi] of BUCKETS) {
      const b = all.filter((r) => r.rank >= lo && r.rank <= hi);
      const d = {}; for (const r of b) d[r.division] = (d[r.division] ?? 0) + 1;
      console.log(`${`${lo}-${hi}`.padEnd(11)}${String(b.length).padStart(5)}${fmt(qu(b.map((r) => r.strength), 0.25), 1).padStart(8)}${fmt(med(b.map((r) => r.strength)), 1).padStart(8)}${fmt(qu(b.map((r) => r.strength), 0.75), 1).padStart(8)}`
        + `${fmt(med(b.map((r) => r.R))).padStart(7)}${fmt(med(b.map((r) => r.F))).padStart(7)}${fmt(med(b.map((r) => r.O))).padStart(7)}${fmt(med(b.map((r) => r.P))).padStart(7)}  ${JSON.stringify(d)}`);
    }
  }

  if (args.includes('--bands')) {
    const u = runFixture(KEY, PROF);
    console.log(`${u.f.id} · ${PROF} · equivalent ${fmt(u.equivalent, 1)}`);
    console.log(`${'band'.padEnd(32)}${'n'.padStart(5)}${'R'.padStart(7)}${'F'.padStart(7)}${'O'.padStart(7)}${'P'.padStart(7)}${'medRank'.padStart(9)}${'top100'.padStart(8)}${'top250'.padStart(8)}`);
    for (const b of bandsOf(u.rows, u.equivalent)) {
      console.log(`${b.label.padEnd(32)}${String(b.rows.length).padStart(5)}${fmt(med(b.rows.map((r) => r.R))).padStart(7)}${fmt(med(b.rows.map((r) => r.F))).padStart(7)}${fmt(med(b.rows.map((r) => r.O))).padStart(7)}${fmt(med(b.rows.map((r) => r.P))).padStart(7)}`
        + `${String(med(b.rows.map((r) => r.rank))).padStart(9)}${String(b.rows.filter((r) => r.rank <= 100).length).padStart(8)}${String(b.rows.filter((r) => r.rank <= 250).length).padStart(8)}`);
    }
  }

  const TARGETS = ['Vermont', 'Rutgers', 'Furman', 'Penn State', 'Princeton', 'Loyola Marymount'];
  const OLD_TOP = ['DePauw', 'Hawaii Pacific', 'Southwestern (TX)', 'Tufts', 'Case Western Reserve',
    'Emmanuel (MA)', 'Fredonia State', 'Williams', 'Saint Olaf', 'Whitman'];

  if (args.includes('--targets')) {
    const u = runFixture(KEY, PROF);
    const show = (names, label) => {
      console.log(`\n== ${label}`);
      console.log(`${'programme'.padEnd(22)}${'str'.padStart(6)}${'A'.padStart(7)}${'pos'.padStart(7)}${'mkt'.padStart(7)}${'R'.padStart(7)}${'grade/cov'.padStart(14)}${'F'.padStart(7)}${'O'.padStart(7)}${'path'.padStart(7)}${'out'.padStart(7)}${'acad'.padStart(7)}${'P'.padStart(7)}${'gR'.padStart(7)}${'gF'.padStart(7)}${'rank'.padStart(6)}`);
      for (const n of names) {
        const r = u.byName.get(n);
        if (!r) { console.log(`${n.padEnd(22)} not ranked`); continue; }
        console.log(`${n.slice(0, 21).padEnd(22)}${fmt(r.strength, 1).padStart(6)}${fmt(r.A).padStart(7)}${fmt(r.pos).padStart(7)}${fmt(r.mkt).padStart(7)}${fmt(r.R).padStart(7)}`
          + `${`${String(r.Rgrade).slice(0, 4)}/${fmt(r.Rcov, 2)}`.padStart(14)}${fmt(r.F).padStart(7)}${fmt(r.O).padStart(7)}${fmt(r.pathway).padStart(7)}${fmt(r.outcome).padStart(7)}${fmt(r.academicFit).padStart(7)}`
          + `${fmt(r.P).padStart(7)}${fmt(r.gR).padStart(7)}${fmt(r.gF).padStart(7)}${String(r.rank).padStart(6)}`);
      }
    };
    show(TARGETS, 'the six human-pursue programmes');
    show(OLD_TOP, "the pre-A7.8.2 top ten");
  }

  if (args.includes('--sensitivity')) {
    const u = runFixture(KEY, PROF);
    const eq = u.equivalent;
    const SETTINGS = [
      ['production (R .50, gate on)', { wR: 0.50, gateOn: true }],
      ['R .50, gate NEUTRALISED', { wR: 0.50, gateOn: false }],
      ['R .45, gate on', { wR: 0.45, gateOn: true }],
      ['R .40, gate on', { wR: 0.40, gateOn: true }],
      ['R .40, gate neutralised', { wR: 0.40, gateOn: false }],
      ['R .35, gate on', { wR: 0.35, gateOn: true }],
      ['R .30, gate on', { wR: 0.30, gateOn: true }],
      ['R .30, gate neutralised', { wR: 0.30, gateOn: false }],
    ];
    const base = rescore(u.rows, { wR: 0.50, gateOn: true });
    const baseRank = new Map(base.map((r) => [r.name, r.rank2]));
    console.log(`${'setting'.padEnd(28)}${'tau'.padStart(7)}${'s100'.padStart(7)}${'s250'.padStart(7)}${'nearMedRk'.padStart(11)}${'near@100'.padStart(10)}${'reach@100'.padStart(11)}${'weakMedRk'.padStart(11)}`);
    for (const [label, cfg] of SETTINGS) {
      const s = rescore(u.rows, cfg);
      const rk = new Map(s.map((r) => [r.name, r.rank2]));
      const names = [...baseRank.keys()];
      const tau = spearman(names.map((n) => baseRank.get(n)), names.map((n) => rk.get(n)));
      const near = s.filter((r) => Number.isFinite(r.strength) && Math.abs(r.strength - eq) < 3);
      const reach = s.filter((r) => Number.isFinite(r.strength) && r.strength - eq >= 10);
      const weak = s.filter((r) => Number.isFinite(r.strength) && r.strength - eq <= -25);
      const t100 = s.slice(0, 100); const t250 = s.slice(0, 250);
      console.log(`${label.padEnd(28)}${fmt(tau, 3).padStart(7)}${fmt(med(t100.map((r) => r.strength)), 1).padStart(7)}${fmt(med(t250.map((r) => r.strength)), 1).padStart(7)}`
        + `${String(med(near.map((r) => r.rank2))).padStart(11)}${String(near.filter((r) => r.rank2 <= 100).length).padStart(10)}${String(reach.filter((r) => r.rank2 <= 100).length).padStart(11)}${String(med(weak.map((r) => r.rank2))).padStart(11)}`);
    }
    console.log('');
    console.log('human Fixture A targets, rank under each setting');
    console.log(`${'programme'.padEnd(20)}${SETTINGS.map(([l]) => l.split(',')[0].replace('production ', 'prod').slice(0, 9).padStart(11)).join('')}`);
    const maps = SETTINGS.map(([, cfg]) => new Map(rescore(u.rows, cfg).map((r) => [r.name, r.rank2])));
    for (const n of [...TARGETS, '—', ...OLD_TOP.slice(0, 5), '—', 'Stanford', 'SMU', 'Wake Forest', 'Clemson']) {
      if (n === '—') { console.log(''); continue; }
      if (!u.byName.has(n)) continue;
      console.log(`${n.slice(0, 19).padEnd(20)}${maps.map((m) => String(m.get(n) ?? '—').padStart(11)).join('')}`);
    }
  }

  if (args.includes('--gate')) {
    const u = runFixture(KEY, PROF);
    const t = G.recruitability;
    console.log(`recruitability gate: floor ${t.floor}, threshold ${t.threshold}`);
    const full = u.rows.filter((r) => r.gR >= 0.999);
    const ramp = u.rows.filter((r) => r.gR < 0.999 && r.gR > t.floor + 1e-9);
    const floorAt = u.rows.filter((r) => r.gR <= t.floor + 1e-9);
    for (const [label, set] of [['full gate (1.000)', full], ['on the ramp', ramp], ['at the floor', floorAt]]) {
      if (!set.length) { console.log(`  ${label.padEnd(20)} 0`); continue; }
      console.log(`  ${label.padEnd(20)} ${String(set.length).padStart(4)}  medRank ${String(med(set.map((r) => r.rank))).padStart(4)}  medStrength ${fmt(med(set.map((r) => r.strength)), 1)}  medR ${fmt(med(set.map((r) => r.R)))}  minGate ${fmt(Math.min(...set.map((r) => r.gR)))}`);
    }
    console.log('');
    console.log('  IS LOW R COUNTED TWICE? base already carries R at 0.50; the gate multiplies again.');
    const withGate = u.rows.map((r) => r.P);
    const noGate = u.rows.map((r) => r.base);
    console.log(`    corr(P, base) ${fmt(corr(withGate, noGate))}   rank agreement ${fmt(spearman(withGate, noGate))}`);
    const ramped = u.rows.filter((r) => r.gR < 0.999);
    console.log(`    programmes whose score the gate actually reduces: ${ramped.length} of ${u.rows.length} (${fmt((ramped.length / u.rows.length) * 100, 1)}%)`);
    if (ramped.length) {
      console.log(`    their median loss ${fmt(med(ramped.map((r) => 1 - r.gR)))}  worst ${fmt(Math.max(...ramped.map((r) => 1 - r.gR)))}`);
      const moved = ramped.map((r) => {
        const noGateRank = rescore(u.rows, { gateOn: false }).findIndex((x) => x.name === r.name) + 1;
        return { name: r.name, rank: r.rank, noGateRank, strength: r.strength, R: r.R };
      }).sort((a, b) => (a.noGateRank - a.rank) - (b.noGateRank - b.rank)).slice(0, 8);
      console.log('    largest gate-caused demotions:');
      for (const m of moved) console.log(`      ${m.name.slice(0, 24).padEnd(25)} str ${fmt(m.strength, 1).padStart(5)} R ${fmt(m.R)}  #${m.rank} with gate, #${m.noGateRank} without`);
    }
  }

  if (args.includes('--authority')) {
    /** Does the level preference reorder programmes that are already plausible? */
    const LEVELS = { 1: 'FULLY_DECLARED_PLAYING', 3: 'BALANCED', 5: 'FULLY_DECLARED_LEVEL' };
    const runs = Object.fromEntries(Object.entries(LEVELS).map(([k, pid]) => [k, runFixture(KEY, pid)]));
    const BANDS = [['R >= 0.45 highly supported', (r) => r.R >= 0.45],
      ['R 0.30-0.45 plausible', (r) => r.R >= 0.30 && r.R < 0.45],
      ['R 0.20-0.30 marginal', (r) => r.R >= 0.20 && r.R < 0.30],
      ['R < 0.20 very low', (r) => r.R < 0.20]];
    console.log(`${'subset'.padEnd(28)}${'n'.padStart(5)}` + [1, 3, 5].flatMap((k) => [`c(str,O)@${k}`.padStart(13), `c(str,P)@${k}`.padStart(13)]).join(''));
    for (const [label, test] of BANDS) {
      const ns = runs[1].rows.filter(test).map((r) => r.name);
      const cells = [1, 3, 5].flatMap((k) => {
        const set = runs[k].rows.filter((r) => ns.includes(r.name) && Number.isFinite(r.strength));
        return [fmt(corr(set.map((r) => r.strength), set.map((r) => r.O)), 2).padStart(13),
          fmt(corr(set.map((r) => r.strength), set.map((r) => r.P)), 2).padStart(13)];
      });
      console.log(`${label.padEnd(28)}${String(ns.length).padStart(5)}${cells.join('')}`);
    }
    console.log('');
    console.log('rank response to the level preference, within each subset (median rank at priority 1 -> 5)');
    for (const [label, test] of BANDS) {
      const ns = runs[1].rows.filter(test).map((r) => r.name);
      const at = (k) => med(runs[k].rows.filter((r) => ns.includes(r.name)).map((r) => r.rank));
      console.log(`  ${label.padEnd(28)} ${String(at(1)).padStart(4)} -> ${String(at(3)).padStart(4)} -> ${String(at(5)).padStart(4)}`);
    }
  }

  if (args.includes('--confidence')) {
    const u = runFixture(KEY, PROF);
    const GROUPS = [
      ['full positional + market', (r) => r.posState === 'MEASURED' && r.mktState === 'MEASURED'],
      ['positional PARTIAL + market', (r) => r.posState === 'PARTIAL' && r.mktState],
      ['measured positional ZERO', (r) => r.pos === 0],
      ['positional UNSCOREABLE (market only)', (r) => r.posState === 'UNSCOREABLE'],
      ['market UNSCOREABLE (positional only)', (r) => r.mktState === 'UNSCOREABLE'],
    ];
    console.log(`${'evidence group'.padEnd(38)}${'n'.padStart(5)}${'medR'.padStart(8)}${'medCov'.padStart(9)}${'medRank'.padStart(9)}${'medStr'.padStart(8)}${'medA'.padStart(8)}`);
    for (const [label, test] of GROUPS) {
      const set = u.rows.filter(test);
      if (!set.length) { console.log(`${label.padEnd(38)}    0`); continue; }
      console.log(`${label.padEnd(38)}${String(set.length).padStart(5)}${fmt(med(set.map((r) => r.R))).padStart(8)}${fmt(med(set.map((r) => r.Rcov)), 2).padStart(9)}${String(med(set.map((r) => r.rank))).padStart(9)}${fmt(med(set.map((r) => r.strength)), 1).padStart(8)}${fmt(med(set.map((r) => r.A))).padStart(8)}`);
    }
    console.log('');
    console.log('matched pairs: same athletic compatibility band, one measured zero against one unscoreable');
    const zero = u.rows.filter((r) => r.pos === 0);
    const unk = u.rows.filter((r) => r.posState === 'UNSCOREABLE');
    let shown = 0;
    for (const z of zero) {
      const partner = unk.find((x) => Math.abs(x.A - z.A) < 0.02 && Math.abs((x.mkt ?? 0) - (z.mkt ?? 0)) < 0.05);
      if (!partner || shown >= 5) continue;
      shown += 1;
      console.log(`  measured zero ${z.name.slice(0, 20).padEnd(21)} A ${fmt(z.A)} mkt ${fmt(z.mkt)} R ${fmt(z.R)} cov ${fmt(z.Rcov, 2)} #${z.rank}`);
      console.log(`  unscoreable   ${partner.name.slice(0, 20).padEnd(21)} A ${fmt(partner.A)} mkt ${fmt(partner.mkt)} R ${fmt(partner.R)} cov ${fmt(partner.Rcov, 2)} #${partner.rank}`);
    }
  }

  if (args.includes('--financial')) {
    const u = runFixture(KEY, PROF);
    const held = rescore(u.rows, { holdF: true });
    const heldRank = new Map(held.map((r) => [r.name, r.rank2]));
    const moved = u.rows.map((r) => ({ ...r, rank2: heldRank.get(r.name), gain: r.rank - heldRank.get(r.name) }))
      .sort((a, b) => b.gain - a.gain);
    console.log(`programmes with F < 1: ${u.rows.filter((r) => r.F < 1).length} of ${u.rows.length}`);
    console.log(`rank agreement with Financial held at 1.000: ${fmt(spearman(u.rows.map((r) => r.rank), u.rows.map((r) => heldRank.get(r.name))))}`);
    console.log(`top-100 median strength ${fmt(med(u.rows.filter((r) => r.rank <= 100).map((r) => r.strength)), 1)} -> ${fmt(med(held.slice(0, 100).map((r) => r.strength)), 1)}`);
    console.log('largest demotions caused by Financial:');
    for (const m of moved.slice(0, 10)) {
      console.log(`  ${m.name.slice(0, 24).padEnd(25)} str ${fmt(m.strength, 1).padStart(5)} F ${fmt(m.F)}  #${m.rank} -> #${m.rank2} if F were 1.000  (+${m.gain})`);
    }
    console.log('the six human targets:');
    for (const n of TARGETS) {
      const m = moved.find((x) => x.name === n);
      if (m) console.log(`  ${n.padEnd(20)} F ${fmt(m.F)}  #${m.rank} -> #${m.rank2}  (${m.gain >= 0 ? '+' : ''}${m.gain})`);
    }
  }

  if (args.includes('--pairs')) {
    const u = runFixture('A', 'FULLY_DECLARED_LEVEL');
    const review = JSON.parse(fs.readFileSync(path.resolve(REVIEW), 'utf8'));
    let dec = 0; let ag = 0; const bySet = {};
    let inc = 0; let incN = 0; const dist = { mild: 0, material: 0, severe: 0 };
    const omissions = [];
    let conc = 0; let disc = 0;
    for (const p of review.pairs) {
      const a = u.byName.get(p.A); const b = u.byName.get(p.B);
      if (!a || !b) continue;
      const v2 = a.P > b.P ? 'A' : 'B';
      const set = p.pair.split('.')[0];
      bySet[set] ??= [0, 0];
      if (p.firstPursuit === 'A' || p.firstPursuit === 'B') {
        dec += 1; bySet[set][1] += 1;
        if (p.firstPursuit === v2) { ag += 1; bySet[set][0] += 1; conc += 1; } else disc += 1;
      }
      for (const side of ['A', 'B']) {
        const h = p[`include${side}`]; const r = side === 'A' ? a : b;
        if (h !== 'YES' && h !== 'NO') continue;
        incN += 1;
        const inside = r.rank <= 100;
        if ((h === 'YES') === inside) inc += 1;
        if (h === 'YES' && !inside) {
          omissions.push({ name: r.name, rank: r.rank, strength: r.strength });
          if (r.rank <= 150) dist.mild += 1; else if (r.rank <= 400) dist.material += 1; else dist.severe += 1;
        }
      }
    }
    console.log(`first-pursuit agreement ${ag}/${dec} = ${fmt((ag / dec) * 100, 1)}%`);
    for (const [s, [g, n]] of Object.entries(bySet).sort()) console.log(`  set ${s}: ${g}/${n}`);
    console.log(`pairwise ordering agreement ${fmt(conc / (conc + disc), 4)}`);
    console.log(`outreach-slice agreement ${inc}/${incN}`);
    console.log(`human YES outside the first 100: mild(<=150) ${dist.mild}  material(151-400) ${dist.material}  severe(400+) ${dist.severe}`);
    for (const o of omissions.sort((x, y) => x.rank - y.rank)) console.log(`   #${String(o.rank).padStart(3)} ${o.name.slice(0, 26).padEnd(27)} str ${fmt(o.strength, 1)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
