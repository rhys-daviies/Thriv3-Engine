/**
 * A7.7.12: what athletic plausibility should mean, and which shape says it.
 *
 * READ-ONLY AND DIAGNOSTIC. No production scorer, weight, gate, threshold or
 * calibration is touched, and nothing is persisted. Every candidate below is
 * applied by recomputing recruitability arithmetically from the basis a normal
 * run already produced:
 *
 *   R = A x (phi + (1 - phi) x support)      support = sum over KNOWN signals
 *
 * `support` does not depend on A, so swapping A is exact rather than an
 * approximation, and the production combination and gates are reused verbatim.
 *
 *   node server/scripts/v2PlausibilityShape.js --table
 *   node server/scripts/v2PlausibilityShape.js --universe --fixture=A
 *   node server/scripts/v2PlausibilityShape.js --bands --fixture=A
 *   node server/scripts/v2PlausibilityShape.js --pairs
 *   node server/scripts/v2PlausibilityShape.js --guard --fixture=A
 *   node server/scripts/v2PlausibilityShape.js --regression
 *   node server/scripts/v2PlausibilityShape.js --reference
 */
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES } from './v2Fixtures.js';
import { PROFILES } from './v2ValidationFixtures.js';

const SEASON = '2026';
const REVIEW = 'docs/validation/counterfactual-review.json';
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const med = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

const logistic = (d, s, m) => 1 / (1 + Math.exp(-(d - m) / s));

/**
 * Candidate shapes. All monotone non-decreasing in delta, bounded [0,1],
 * deterministic, and describable in one sentence.
 */
const asym = (a0, k) => (d) => (d >= 0 ? a0 + ((1 - a0) * (1 - Math.exp(-d / k))) : a0 * Math.exp(d / k));

export const CANDIDATES = Object.freeze({
  P0: { label: 'current logistic (s .12, m 0)', at0: 0.500, f: (d) => logistic(d, 0.12, 0) },
  P1: { label: 'shifted logistic m -0.06', at0: 0.622, f: (d) => logistic(d, 0.12, -0.06) },
  P2: { label: 'shifted logistic m -0.12', at0: 0.731, f: (d) => logistic(d, 0.12, -0.12) },
  P3: { label: 'shifted logistic m -0.18', at0: 0.818, f: (d) => logistic(d, 0.12, -0.18) },
  P4: { label: 'asymmetric a0 .80, decay .12, rise .12', at0: 0.800, f: (d) => (d >= 0 ? 0.8 + (0.2 * (1 - Math.exp(-d / 0.12))) : 0.8 * Math.exp(d / 0.12)) },
  P5: { label: 'asymmetric a0 .70, decay .10, rise .14', at0: 0.700, f: (d) => (d >= 0 ? 0.7 + (0.3 * (1 - Math.exp(-d / 0.14))) : 0.7 * Math.exp(d / 0.10)) },
  P6: { label: 'saturating hinge, plateau 1.0, decay .15', at0: 1.000, f: (d) => Math.min(1, Math.exp(d / 0.15)) },
  // The refined-grid finalists, added after the robustness surface.
  Q1: { label: 'asymmetric a0 .76 / k .08', at0: 0.76, f: asym(0.76, 0.08) },
  Q2: { label: 'asymmetric a0 .80 / k .08', at0: 0.80, f: asym(0.80, 0.08) },
  Q3: { label: 'asymmetric a0 .84 / k .08', at0: 0.84, f: asym(0.84, 0.08) },
  Q4: { label: 'asymmetric a0 .80 / k .07', at0: 0.80, f: asym(0.80, 0.07) },
});

const DELTAS = [-0.40, -0.30, -0.20, -0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15, 0.20, 0.30, 0.40];

async function main() {
  const args = process.argv.slice(2);
  const arg = (k, dflt = null) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? dflt;

  if (args.includes('--table')) {
    console.log(`delta   ${Object.keys(CANDIDATES).map((k) => k.padStart(7)).join('')}`);
    for (const d of DELTAS) {
      console.log(`${(d >= 0 ? `+${d.toFixed(2)}` : d.toFixed(2)).padStart(6)}  ${Object.values(CANDIDATES).map((c) => fmt(c.f(d), 3).padStart(7)).join('')}`);
    }
    for (const [k, c] of Object.entries(CANDIDATES)) console.log(`  ${k}: ${c.label}`);
  }

  const { default: db } = await import('../db/client.js');
  const { canonicalPosition } = await import('../../shared/positions.js');
  const { normaliseAthlete } = await import('../../shared/matching/pool.js');
  const { buildPoolContext } = await import('../lib/v2/poolContext.js');
  const { runPursuit } = await import('../lib/v2/pursuitRun.js');
  const {
    buildValidationAthlete, PURSUIT_WEIGHTS, PURSUIT_GATES, tailGate,
  } = await import('../../shared/matching/v2/index.js');
  const W = PURSUIT_WEIGHTS; const G = PURSUIT_GATES;

  const ctxCache = new Map();
  const contextFor = (sport) => {
    if (!ctxCache.has(sport)) ctxCache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
    return ctxCache.get(sport);
  };

  /** One fixture's ranked universe, reduced to what a shape swap needs. */
  const universeFor = (fixtureKey, profileId) => {
    const fixture = FIXTURES.find((f) => f.id.toUpperCase().startsWith(`${fixtureKey}-`));
    if (!fixture) throw new Error(`no fixture ${fixtureKey}`);
    const sport = fixture.player.sport;
    const ctx = contextFor(sport);
    const position = canonicalPosition(fixture.player.position);
    const v1Shape = normaliseAthlete({ ...fixture.player, preferred_divisions: '[]', preferred_conferences: '[]' });
    const { athlete } = buildValidationAthlete({
      record: fixture.player, v1Shape, position, label: fixture.id,
      profile: PROFILES[profileId] ?? PROFILES.UNDECLARED, recruitType: null,
    });
    const run = runPursuit({ athlete, sport, colleges: ctx.colleges, ctx });
    const byId = new Map(ctx.colleges.map((c) => [c.id, c]));
    const rows = run.pipeline.ranked.map((e) => {
      const b = e.recruitability.basis ?? {};
      const c = byId.get(e.id);
      return {
        name: e.name, division: c.division, strength: c.soccer_score,
        delta: b.athleticDelta, A0: b.athleticPlausibility, phi: b.phi, support: b.support ?? b.core,
        F: e.financial.value, O: e.opportunity.value, prodRank: e.rank, prodP: e.pursuitPriority.value,
      };
    });
    const athletePct = rows.length ? (rows[0].delta + 0) : null;
    return { fixture, sport, rows, equivalent: fixture.player.football_ability };
  };

  /** Apply a candidate shape and re-rank. Production combination, verbatim. */
  const applyShape = (rows, cand) => {
    const scored = rows.map((r) => {
      const A = cand.f(r.delta);
      const R = A * (r.phi + ((1 - r.phi) * r.support));
      const base = (W.recruitability * R) + (W.financial * r.F) + (W.opportunity * r.O);
      const P = base * tailGate(R, G.recruitability) * tailGate(r.F, G.financial);
      return { ...r, A, R, P };
    }).sort((a, b) => b.P - a.P);
    scored.forEach((r, i) => { r.rank = i + 1; });
    return { rows: scored, byName: new Map(scored.map((r) => [r.name, r])) };
  };

  const bandReport = (scored, eq) => {
    const BANDS = [
      ['substantially above (>= +10)', (s) => s - eq >= 10],
      ['moderately above (+3 to +10)', (s) => s - eq >= 3 && s - eq < 10],
      ['approximately at level (-3 to +3)', (s) => Math.abs(s - eq) < 3],
      ['moderately below (-15 to -3)', (s) => s - eq <= -3 && s - eq > -15],
      ['substantially below (< -15)', (s) => s - eq <= -15],
    ];
    return BANDS.map(([label, t]) => {
      const b = scored.filter((r) => Number.isFinite(r.strength) && t(r.strength));
      return {
        label, n: b.length, medR: med(b.map((r) => r.R)), medO: med(b.map((r) => r.O)),
        medP: med(b.map((r) => r.P)), medRank: med(b.map((r) => r.rank)), in100: b.filter((r) => r.rank <= 100).length,
      };
    });
  };

  /** Each fixture's own equivalent programme score, read from the pinned calibration. */
  const { abilityToProgrammeScore } = await import('../../shared/matching/v2/calibration/abilityScale.js');
  const equivalentFor = (key) => {
    const f = FIXTURES.find((x) => x.id.toUpperCase().startsWith(`${key}-`));
    return f ? abilityToProgrammeScore(f.player.football_ability, f.player.sport) : null;
  };

  if (args.includes('--universe') || args.includes('--bands') || args.includes('--guard')) {
    const key = (arg('fixture') ?? 'A').toUpperCase();
    const profileId = arg('profile') ?? (key === 'A' ? 'FULLY_DECLARED_LEVEL' : 'ACADEMIC_FIRST');
    const u = universeFor(key, profileId);
    const eq = equivalentFor(key);
    console.log(`fixture ${u.fixture.id}  profile ${profileId}  ranked ${u.rows.length}  athlete equivalent strength ${eq}`);
    for (const [k, cand] of Object.entries(CANDIDATES)) {
      const { rows: s, byName } = applyShape(u.rows, cand);
      if (args.includes('--universe')) {
        console.log(`\n== ${k} ${cand.label}  A(0)=${fmt(cand.at0)}`);
        for (const n of [10, 25, 50, 100]) {
          const b = s.slice(0, n);
          const d = {}; for (const r of b) d[r.division] = (d[r.division] ?? 0) + 1;
          console.log(`  top ${String(n).padStart(3)}  medStr ${fmt(med(b.map((r) => r.strength)), 1).padStart(5)}  medR ${fmt(med(b.map((r) => r.R)))}  medO ${fmt(med(b.map((r) => r.O)))}  medP ${fmt(med(b.map((r) => r.P)))}  ${JSON.stringify(d)}`);
        }
      }
      if (args.includes('--bands')) {
        console.log(`\n== ${k} ${cand.label}`);
        for (const b of bandReport(s, eq)) {
          console.log(`  ${b.label.padEnd(36)} n ${String(b.n).padStart(3)}  medR ${fmt(b.medR)}  medO ${fmt(b.medO)}  medP ${fmt(b.medP)}  medRank ${String(b.medRank).padStart(4)}  in100 ${b.in100}`);
        }
      }
      if (args.includes('--guard')) {
        const GUARD = ['Stanford', 'Virginia', 'Clemson', 'SMU', 'Wake Forest', 'Ohio State', 'Indiana', 'Michigan', 'Duke', 'North Carolina'];
        console.log(`\n== ${k} ${cand.label}`);
        for (const n of GUARD) {
          const r = byName.get(n);
          if (!r) { console.log(`  ${n} not ranked`); continue; }
          console.log(`  ${n.padEnd(16)} str ${fmt(r.strength, 1).padStart(5)} delta ${fmt(r.delta).padStart(7)} A ${fmt(r.A)} R ${fmt(r.R)} O ${fmt(r.O)} P ${fmt(r.P)} #${r.rank}`);
        }
      }
    }
  }

  if (args.includes('--pairs')) {
    const u = universeFor('A', 'FULLY_DECLARED_LEVEL');
    const review = JSON.parse(fs.readFileSync(path.resolve(REVIEW), 'utf8'));
    console.log(`cand  order(all)  order(set1)  incl(38)  severeOmissions  humanNO_in100`);
    for (const [k, cand] of Object.entries(CANDIDATES)) {
      const { byName } = applyShape(u.rows, cand);
      let dec = 0; let ag = 0; let dec1 = 0; let ag1 = 0; let inc = 0; let sev = 0; let noIn = 0; let incN = 0;
      for (const p of review.pairs) {
        const a = byName.get(p.A); const b = byName.get(p.B);
        if (!a || !b) continue;
        const v2 = a.P > b.P ? 'A' : 'B';
        if (p.firstPursuit === 'A' || p.firstPursuit === 'B') {
          dec += 1; if (p.firstPursuit === v2) ag += 1;
          if (p.pair.startsWith('1.')) { dec1 += 1; if (p.firstPursuit === v2) ag1 += 1; }
        }
        for (const side of ['A', 'B']) {
          const h = p[`include${side}`]; const r = side === 'A' ? a : b;
          if (h !== 'YES' && h !== 'NO') continue;
          incN += 1;
          const inside = r.rank <= 100;
          if ((h === 'YES') === inside) inc += 1;
          if (h === 'YES' && r.rank > 400) sev += 1;
          if (h === 'NO' && inside) noIn += 1;
        }
      }
      console.log(`${k.padEnd(5)} ${`${ag}/${dec}`.padStart(9)}  ${`${ag1}/${dec1}`.padStart(10)}  ${`${inc}/${incN}`.padStart(7)}  ${String(sev).padStart(15)}  ${String(noIn).padStart(13)}`);
    }
  }

  if (args.includes('--regression')) {
    const KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    for (const key of KEYS) {
      const f = FIXTURES.find((x) => x.id.toUpperCase().startsWith(`${key}-`));
      if (!f) { console.log(`${key}: no fixture`); continue; }
      let u;
      try { u = universeFor(key, 'UNDECLARED'); } catch (e) { console.log(`${key}: ${e.message}`); continue; }
      const eq = equivalentFor(key);
      console.log(`\n${f.id}  rating ${f.player.football_ability}  ${f.player.sport}  ranked ${u.rows.length}  equivalent ${eq}`);
      for (const [k, cand] of Object.entries(CANDIDATES)) {
        const { rows: s } = applyShape(u.rows, cand);
        const t = s.slice(0, 100);
        const d = {}; for (const r of t) d[r.division] = (d[r.division] ?? 0) + 1;
        const atLevel = s.filter((r) => Number.isFinite(r.strength) && Math.abs(r.strength - eq) < 3);
        const above = s.filter((r) => Number.isFinite(r.strength) && r.strength - eq >= 10);
        console.log(`  ${k}  top100 medStr ${fmt(med(t.map((r) => r.strength)), 1).padStart(5)} maxStr ${fmt(Math.max(...t.map((r) => r.strength)), 1).padStart(5)}  atLevel in100 ${String(atLevel.filter((r) => r.rank <= 100).length).padStart(3)}/${String(atLevel.length).padStart(3)}  farAbove in100 ${String(above.filter((r) => r.rank <= 100).length).padStart(3)}/${String(above.length).padStart(3)}  ${JSON.stringify(d)}`);
      }
    }
  }

  if (args.includes('--grid')) {
    /**
     * Is 0.80 / 0.12 a region or a point?
     *
     * One asymmetric family, rise held equal to decay so the shape keeps two
     * parameters rather than three. Every grid point is applied the same way
     * as the named candidates: recompute R from the basis, re-rank with the
     * production combination, discard.
     */
    const A0 = (arg('a0') ?? '0.65,0.70,0.75,0.80,0.85,0.90').split(',').map(Number);
    const DEC = (arg('decay') ?? '0.08,0.10,0.12,0.14,0.16,0.18').split(',').map(Number);
    const shapeOf = (a0, k) => ({
      label: `a0 ${a0.toFixed(2)} / k ${k.toFixed(2)}`,
      f: (d) => (d >= 0 ? a0 + ((1 - a0) * (1 - Math.exp(-d / k))) : a0 * Math.exp(d / k)),
    });
    const KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const PROFILES_TESTED = ['UNDECLARED', 'LEVEL_FIRST'];
    const EXTRA = [['A', 'FULLY_DECLARED_LEVEL']];
    const runs = [];
    for (const key of KEYS) {
      for (const pid of PROFILES_TESTED) {
        let u;
        try { u = universeFor(key, pid); } catch { continue; }
        runs.push({ key, pid, eq: equivalentFor(key), rows: u.rows });
      }
    }
    for (const [key, pid] of EXTRA) {
      const u = universeFor(key, pid);
      runs.push({ key, pid, eq: equivalentFor(key), rows: u.rows });
    }
    const review = JSON.parse(fs.readFileSync(path.resolve(REVIEW), 'utf8'));
    const aLevel = runs.find((r) => r.key === 'A' && r.pid === 'FULLY_DECLARED_LEVEL');

    const metrics = (run, cand) => {
      const { rows: s, byName } = applyShape(run.rows, cand);
      const eq = run.eq;
      const top = s.filter((r) => r.rank <= 100);
      const band = (t) => s.filter((r) => Number.isFinite(r.strength) && t(r.strength - eq));
      const at = band((d) => Math.abs(d) < 3);
      const modAbove = band((d) => d >= 3 && d < 10);
      const farAbove = band((d) => d >= 10);
      const intrusions = farAbove.filter((r) => r.rank <= 100);
      const d = {}; for (const r of top) d[r.division] = (d[r.division] ?? 0) + 1;
      return {
        byName,
        atIn100: at.filter((r) => r.rank <= 100).length, atN: at.length, atMedRank: med(at.map((r) => r.rank)),
        modAboveIn100: modAbove.filter((r) => r.rank <= 100).length, modAboveN: modAbove.length,
        farAboveIn100: intrusions.length, farAboveN: farAbove.length,
        worst: intrusions.sort((x, y) => x.rank - y.rank)[0] ?? null,
        med10: med(s.slice(0, 10).map((r) => r.strength)),
        med25: med(s.slice(0, 25).map((r) => r.strength)),
        med100: med(top.map((r) => r.strength)),
        div: d,
      };
    };
    const pairMetrics = (byName) => {
      let sev = 0; let noIn = 0; let inc = 0; let incN = 0;
      for (const p of review.pairs) {
        for (const side of ['A', 'B']) {
          const h = p[`include${side}`]; const r = byName.get(p[side]);
          if (!r || (h !== 'YES' && h !== 'NO')) continue;
          incN += 1;
          const inside = r.rank <= 100;
          if ((h === 'YES') === inside) inc += 1;
          if (h === 'YES' && r.rank > 400) sev += 1;
          if (h === 'NO' && inside) noIn += 1;
        }
      }
      return { sev, noIn, inc, incN };
    };

    const out = [];
    const PTS = [['P0', null], ...A0.flatMap((a0) => DEC.map((k) => [null, [a0, k]]))];
    for (const [tag, pt] of PTS) {
      {
        const [a0, k] = pt ?? [null, null];
        const cand = tag === 'P0' ? CANDIDATES.P0 : shapeOf(a0, k);
        const per = runs.map((run) => ({ run, m: metrics(run, cand) }));
        const aRow = per.find((x) => x.run === aLevel).m;
        const pm = pairMetrics(aRow.byName);
        const intrusionRuns = per.filter((x) => x.m.farAboveIn100 > 0);
        const totalIntrusions = per.reduce((n, x) => n + x.m.farAboveIn100, 0);
        const worst = intrusionRuns.map((x) => x.m.worst).filter(Boolean).sort((x, y) => x.rank - y.rank)[0] ?? null;
        const worstRun = worst ? intrusionRuns.find((x) => x.m.worst === worst).run : null;
        const c = per.find((x) => x.run.key === 'C' && x.run.pid === 'UNDECLARED').m;
        const dd = per.find((x) => x.run.key === 'D' && x.run.pid === 'UNDECLARED').m;
        out.push({
          tag: tag ?? '', a0: a0 ?? null, k: k ?? null, aAt: aRow.atIn100, aAtMed: aRow.atMedRank, aMod: aRow.modAboveIn100, aFar: aRow.farAboveIn100,
          med10: aRow.med10, med25: aRow.med25, med100: aRow.med100, div: aRow.div,
          sev: pm.sev, noIn: pm.noIn, inc: `${pm.inc}/${pm.incN}`,
          fixturesWithIntrusion: intrusionRuns.length, totalIntrusions,
          worst: worst ? `${worst.name} #${worst.rank} (${worstRun.key}/${worstRun.pid}, str ${fmt(worst.strength, 1)}, delta ${fmt(worst.delta)})` : '—',
          cAt: c.atIn100, cMod: c.modAboveIn100, cFar: c.farAboveIn100, cMed: c.atMedRank,
          dAt: dd.atIn100, dMod: dd.modAboveIn100, dFar: dd.farAboveIn100, dMed: dd.atMedRank,
          per,
        });
      }
    }
    if (args.includes('--json')) {
      fs.writeFileSync('/tmp/grid.json', JSON.stringify(out.map(({ per, ...r }) => r), null, 1));
      console.log('wrote /tmp/grid.json');
    }
    console.log(`grid ${out.length} points x ${runs.length} runs (${KEYS.length} fixtures x ${PROFILES_TESTED.join('/')})`);
    console.log(`${'a0'.padStart(5)}${'k'.padStart(6)}${'A@lvl'.padStart(7)}${'medRk'.padStart(7)}${'A>mod'.padStart(7)}${'A>far'.padStart(7)}${'sev'.padStart(5)}${'noIn'.padStart(6)}${'incl'.padStart(7)}${'fixIntr'.padStart(9)}${'totIntr'.padStart(9)}${'C@lvl'.padStart(7)}${'C>mod'.padStart(7)}${'D@lvl'.padStart(7)}${'D>mod'.padStart(7)}  worst intrusion`);
    for (const r of out) {
      if (args.includes('--intrusions') && r.per) {
        const all = r.per.flatMap((x) => {
          const eq = x.run.eq;
          return [...x.m.byName.values()].filter((z) => z.rank <= 100 && Number.isFinite(z.strength) && z.strength - eq >= 10)
            .map((z) => `${z.name} #${z.rank} [${x.run.key}/${x.run.pid} str ${fmt(z.strength, 1)} d ${fmt(z.delta)}]`);
        });
        if (all.length) console.log(`   ${(r.tag || `${fmt(r.a0, 2)}/${fmt(r.k, 2)}`)}: ${all.join('  ')}`);
      }
      console.log(`${(r.tag || fmt(r.a0, 2)).padStart(5)}${(r.tag ? 'prod' : fmt(r.k, 2)).padStart(6)}${String(r.aAt).padStart(7)}${String(r.aAtMed).padStart(7)}${String(r.aMod).padStart(7)}${String(r.aFar).padStart(7)}${String(r.sev).padStart(5)}${String(r.noIn).padStart(6)}${r.inc.padStart(7)}${String(r.fixturesWithIntrusion).padStart(9)}${String(r.totalIntrusions).padStart(9)}${String(r.cAt).padStart(7)}${String(r.cMod).padStart(7)}${String(r.dAt).padStart(7)}${String(r.dMod).padStart(7)}  ${r.worst}`);
    }
  }

  if (args.includes('--movers')) {
    const u = universeFor('A', 'FULLY_DECLARED_LEVEL');
    const want = (arg('cand') ?? 'P4').split(',');
    const base = applyShape(u.rows, CANDIDATES.P0);
    const NAMES = ['Vermont', 'UC Irvine', 'Princeton', 'Evansville', 'Furman', 'UC Riverside', 'Marshall', 'Green Bay',
      'UConn', 'Davidson', 'Western Michigan', 'Kansas City', 'SMU', 'Case Western Reserve', 'UMBC', 'Canisius',
      'Clemson', 'Pittsburgh', 'Louisville', 'North Florida', 'Penn State', 'Loyola Marymount', 'Akron', 'Harvard',
      'DePauw', 'Hawaii Pacific', 'Tufts', 'Williams', 'Stanford', 'Wake Forest'];
    console.log(`${'programme'.padEnd(24)}${'str'.padStart(6)}${'P0'.padStart(7)}${want.map((w) => w.padStart(7)).join('')}`);
    const maps = want.map((w) => [w, applyShape(u.rows, CANDIDATES[w]).byName]);
    for (const n of NAMES) {
      const b = base.byName.get(n);
      if (!b) continue;
      console.log(`${n.slice(0, 23).padEnd(24)}${fmt(b.strength, 1).padStart(6)}${String(b.rank).padStart(7)}${maps.map(([, m]) => String(m.get(n).rank).padStart(7)).join('')}`);
    }
  }

  if (args.includes('--axis')) {
    const { percentileOf, abilityToPercentile } = await import('../../shared/matching/v2/calibration/abilityScale.js');
    console.log('how much percentile a strength step buys, mens-soccer:');
    console.log(`${'strength'.padStart(9)}${'percentile'.padStart(12)}${'delta vs 83.58'.padStart(16)}`);
    for (const s2 of [100, 99, 97, 95, 92, 90, 87, 85, 83.58, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25]) {
      const p2 = percentileOf(s2, 'mens-soccer');
      console.log(`${fmt(s2, 1).padStart(9)}${fmt(p2, 4).padStart(12)}${fmt(abilityToPercentile(9, 'mens-soccer') - p2, 4).padStart(16)}`);
    }
    console.log('');
    console.log('resolution: percentile points per strength point');
    const seg = [[83.58, 100], [83.58, 95], [83.58, 90], [70, 83.58], [55, 70], [40, 55], [25, 40]];
    for (const [lo, hi] of seg) {
      const d = percentileOf(hi, 'mens-soccer') - percentileOf(lo, 'mens-soccer');
      console.log(`  ${fmt(lo, 1).padStart(5)} -> ${fmt(hi, 1).padStart(5)}  strength +${fmt(hi - lo, 1).padStart(5)}  percentile +${fmt(d, 4)}  (${fmt(d / (hi - lo), 4)} per point)`);
    }
  }

  if (args.includes('--reference')) {
    /**
     * Is programme strength the right reference for who a programme recruits?
     * The only thing the data can answer without circularity is whether a
     * programme's own strength is stable enough to be a reference at all, and
     * whether arrivals concentrate anywhere measurable. Recruit ABILITY is not
     * held, so the question of what level a programme signs cannot be answered
     * here; that limitation is reported rather than papered over.
     */
    const rows = db.prepare(`
      SELECT c.name, c.division, c.soccer_score, c.recent_win_pct, c.prior_win_pct,
             (SELECT COUNT(*) FROM recruiting_arrivals a WHERE a.programme = c.name AND a.sport = c.sport) AS arrivals
        FROM colleges c WHERE c.sport = 'mens-soccer' AND c.active = 1 AND c.soccer_score IS NOT NULL
    `).all();
    const withWin = rows.filter((r) => Number.isFinite(r.recent_win_pct) && Number.isFinite(r.prior_win_pct));
    const drift = withWin.map((r) => Math.abs(r.recent_win_pct - r.prior_win_pct));
    console.log(`programmes with a strength score: ${rows.length}`);
    console.log(`  season-to-season win-rate change: median ${fmt(med(drift))}  p90 ${fmt([...drift].sort((a, b) => a - b)[Math.floor(drift.length * 0.9)])}`);
    const arr = rows.filter((r) => r.arrivals > 0);
    console.log(`  programmes with recorded arrivals: ${arr.length} of ${rows.length}`);
    console.log(`  arrivals per programme: median ${med(arr.map((r) => r.arrivals))}`);
    console.log('  recruit ABILITY is not held in any table: recruiting_arrivals carries programme, season, position and international flag only.');
    console.log('  => the level a programme actually signs cannot be measured here without circular reasoning.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
