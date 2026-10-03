/**
 * A7.8.2 phase 1: choose the four constants Playing Pathway needs, from a
 * robustness surface rather than from one fixture.
 *
 * READ-ONLY AND DIAGNOSTIC. Nothing scores, weights, gates or persists
 * anything in production. Every candidate is applied by substituting the
 * pathway value for the existing component inside the Opportunity mean - the
 * component's renormalised share is read off the basis, so the substitution is
 * exact - and re-ranking with the production combination and gates.
 *
 *   node server/scripts/v2PathwayCalibration.js --maps
 *   node server/scripts/v2PathwayCalibration.js --temporal
 *   node server/scripts/v2PathwayCalibration.js --grid
 *   node server/scripts/v2PathwayCalibration.js --plateau
 */
import { FIXTURES } from './v2Fixtures.js';
import { PROFILES } from './v2ValidationFixtures.js';

const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];
const SEASON = '2026';
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const med = (xs) => q(xs, 0.5);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const spearman = (xs, ys) => {
  const rank = (a) => {
    const idx = a.map((v, i) => [v, i]).sort((p2, q2) => p2[0] - q2[0]);
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
  const xr = rank(xs); const yr = rank(ys);
  const mx = mean(xr); const my = mean(yr);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < xr.length; i += 1) { const dx = xr[i] - mx; const dy = yr[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return (sxx === 0 || syy === 0) ? null : sxy / Math.sqrt(sxx * syy);
};

/** Pressure, in starting units: 1.0 means one full starting line's worth of returners. */
export const pressureOf = ({ starters, squad, unknown }, { squadWeight, unknownWeight, places }) =>
  ((starters) + (squadWeight * squad) + (unknownWeight * unknown)) / Math.max(1, places);

/**
 * The candidate pressure maps. All monotone non-increasing, bounded (0,1],
 * equal to 1 at zero pressure, and simple enough to state in a sentence.
 */
export const MAPS = Object.freeze({
  'linear-2': { label: 'linear, nothing left at 2 units', f: (p) => Math.max(0, 1 - (p / 2)) },
  'linear-3': { label: 'linear, nothing left at 3 units', f: (p) => Math.max(0, 1 - (p / 3)) },
  'linear-4': { label: 'linear, nothing left at 4 units', f: (p) => Math.max(0, 1 - (p / 4)) },
  'recip-0.75': { label: 'reciprocal, half at 0.75 units', f: (p) => 1 / (1 + (p / 0.75)) },
  'recip-1.0': { label: 'reciprocal, half at 1 unit', f: (p) => 1 / (1 + p) },
  'recip-1.5': { label: 'reciprocal, half at 1.5 units', f: (p) => 1 / (1 + (p / 1.5)) },
  'exp-1.0': { label: 'exponential, scale 1 unit', f: (p) => Math.exp(-p) },
  'exp-1.5': { label: 'exponential, scale 1.5 units', f: (p) => Math.exp(-p / 1.5) },
  'exp-2.0': { label: 'exponential, scale 2 units', f: (p) => Math.exp(-p / 2) },
});

async function main() {
  const args = process.argv.slice(2);
  const arg = (k, d = null) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;

  if (args.includes('--maps')) {
    const PS = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6];
    console.log(`${'map'.padEnd(14)}${PS.map((p) => String(p).padStart(7)).join('')}`);
    for (const [k, m] of Object.entries(MAPS)) {
      console.log(`${k.padEnd(14)}${PS.map((p) => fmt(m.f(p), 3).padStart(7)).join('')}`);
    }
    console.log('');
    for (const [k, m] of Object.entries(MAPS)) console.log(`  ${k.padEnd(14)} ${m.label}`);
  }

  const { default: db } = await import('../db/client.js');
  const { canonicalPosition } = await import('../../shared/positions.js');
  const { normaliseAthlete } = await import('../../shared/matching/pool.js');
  const { buildPoolContext } = await import('../lib/v2/poolContext.js');
  const { runPursuit } = await import('../lib/v2/pursuitRun.js');
  const { buildPositionIndex } = await import('../lib/v2/rosterEvidence.js');
  const { returningDepth } = await import('./v2PlayingDepth.js');
  const {
    buildValidationAthlete, typicalStarters, PURSUIT_WEIGHTS, PURSUIT_GATES, tailGate,
  } = await import('../../shared/matching/v2/index.js');
  const W = PURSUIT_WEIGHTS; const G = PURSUIT_GATES;

  const ctxCache = new Map();
  const contextFor = (sport) => {
    if (!ctxCache.has(sport)) ctxCache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
    return ctxCache.get(sport);
  };

  if (args.includes('--temporal')) {
    /** Does the weight choice change how well raw competition predicts next season? */
    const COLS = `college_name, player_name, position, minutes_played, projected_minutes,
      games_started, projected_games_started, estimated_graduation_year, eligibility_end_year,
      country, season, division, class_year_label`;
    for (const sport of ['mens-soccer', 'womens-soccer']) {
      console.log(`\n== ${sport}, pooled over 2022->23, 2023->24, 2024->25, 2025->26`);
      const obs = [];
      for (const T of [2022, 2023, 2024, 2025]) {
        const a = db.prepare(`SELECT ${COLS} FROM roster_players WHERE sport=? AND season=?`).all(sport, String(T));
        const b = db.prepare(`SELECT ${COLS} FROM roster_players WHERE sport=? AND season=?`).all(sport, String(T + 1));
        if (!a.length || !b.length) continue;
        const iA = buildPositionIndex(a); const iB = buildPositionIndex(b);
        for (const [prog, e] of iA) {
          const nx = iB.get(prog); if (!nx) continue;
          for (const p of POSITIONS) {
            const bucket = e.positions.get(p); if (!bucket || bucket.rows < 3) continue;
            const d = returningDepth(bucket, T); if (!d) continue;
            const nb = nx.positions.get(p); if (!nb || nb.rows === 0) continue;
            let nextStarters = 0; for (const [, c] of nb.starterLastSeason) nextStarters += c;
            obs.push({ position: p, d, places: typicalStarters(sport, p) ?? 4, nextSize: nb.rows, nextStarters });
          }
        }
      }
      console.log(`  n ${obs.length}`);
      console.log(`${'sq'.padStart(5)}${'unk'.padStart(6)}${'  crowding rho'.padStart(16)}${'  starters rho'.padStart(16)}`);
      for (const squadWeight of [0.2, 0.3, 0.4, 0.5, 0.6]) {
        for (const unknownWeight of [0.3, 0.5, 0.7]) {
          const perPos = POSITIONS.map((p) => {
            const sub = obs.filter((o) => o.position === p);
            if (sub.length < 50) return null;
            const press = sub.map((o) => pressureOf(o.d, { squadWeight, unknownWeight, places: o.places }));
            return {
              crowd: spearman(press, sub.map((o) => o.nextSize)),
              start: spearman(press, sub.map((o) => o.nextStarters)),
            };
          }).filter(Boolean);
          console.log(`${fmt(squadWeight, 1).padStart(5)}${fmt(unknownWeight, 1).padStart(6)}${fmt(mean(perPos.map((x) => x.crowd))).padStart(16)}${fmt(mean(perPos.map((x) => x.start))).padStart(16)}`);
        }
      }
    }
  }

  /** One fixture run, reduced to what a pathway substitution needs. */
  const runFixture = (key, profileId) => {
    const f = FIXTURES.find((x) => x.id.toUpperCase().startsWith(`${key}-`));
    const sport = f.player.sport;
    const ctx = contextFor(sport);
    const position = canonicalPosition(f.player.position);
    const places = typicalStarters(sport, position) ?? 4;
    const v1Shape = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
    const { athlete } = buildValidationAthlete({
      record: f.player, v1Shape, position, label: f.id, profile: PROFILES[profileId], recruitType: null,
    });
    const run = runPursuit({ athlete, sport, colleges: ctx.colleges, ctx });
    const byId = new Map(ctx.colleges.map((c) => [c.id, c]));
    const rows = run.pipeline.ranked.map((e) => {
      const rb = e.recruitability.basis ?? {}; const ob = e.opportunity.basis ?? {};
      const c = byId.get(e.id);
      const bucket = ctx.rosterIndex.get(e.name)?.positions?.get(position);
      return {
        name: e.name, division: c.division, strength: c.soccer_score, rank: e.rank,
        A: rb.athleticPlausibility ?? null,
        pos: (rb.signals ?? []).find((s) => s.key === 'positionalOpportunity')?.value ?? null,
        R: e.recruitability.value, F: e.financial.value, O: e.opportunity.value, P: e.pursuitPriority.value,
        rotation: ob.components?.playingPathway?.value ?? null,
        share: ob.components?.playingPathway?.share ?? null,
        d: returningDepth(bucket, f.player.recruiting_class_year),
        rosterOnFile: Boolean(bucket && bucket.rows > 0),
      };
    });
    return {
      f, position, places, rows, limited: run.pipeline.limited.length,
      byName: new Map(rows.map((r) => [r.name, r])),
    };
  };

  /** Re-rank one fixture under one calibration. Production combination, verbatim. */
  const apply = (run, { squadWeight, unknownWeight, map, competitionShare }) => {
    const mapFn = MAPS[map].f;
    const scored = run.rows.map((r) => {
      if (!Number.isFinite(r.rotation) || !r.d || !r.rosterOnFile) return { ...r, P2: r.P, pathway: null };
      const pressure = pressureOf(r.d, { squadWeight, unknownWeight, places: run.places });
      const competition = mapFn(pressure);
      const pathway = (competitionShare * competition) + ((1 - competitionShare) * r.rotation);
      const share = r.share ?? 0;
      const O2 = Math.max(0, Math.min(1, r.O + (share * (pathway - r.rotation))));
      const base = (W.recruitability * r.R) + (W.financial * r.F) + (W.opportunity * O2);
      return { ...r, pressure, competition, pathway, O2, P2: base * tailGate(r.R, G.recruitability) * tailGate(r.F, G.financial) };
    }).sort((a, b) => b.P2 - a.P2);
    scored.forEach((r, i) => { r.rank2 = i + 1; });
    return scored;
  };

  const report = (scored, run) => {
    const top = (n) => scored.slice(0, n);
    const before100 = run.rows.filter((r) => r.rank <= 100);
    const t100 = top(100);
    const withD = t100.filter((r) => r.d);
    const divs = {}; for (const r of t100) divs[r.division] = (divs[r.division] ?? 0) + 1;
    const press = withD.map((r) => r.pressure).filter(Number.isFinite);
    return {
      moved20: scored.filter((r) => Math.abs(r.rank2 - r.rank) >= 20).length,
      moved50: scored.filter((r) => Math.abs(r.rank2 - r.rank) >= 50).length,
      s25: med(top(25).map((r) => r.strength)), s50: med(top(50).map((r) => r.strength)),
      s100: med(t100.map((r) => r.strength)), s250: med(top(250).map((r) => r.strength)),
      s100Before: med(before100.map((r) => r.strength)),
      ret: med(withD.map((r) => r.d.total)), retBefore: med(before100.filter((r) => r.d).map((r) => r.d.total)),
      retP25: q(withD.map((r) => r.d.total), 0.25), retP75: q(withD.map((r) => r.d.total), 0.75),
      pressMed: med(press), pressP75: q(press, 0.75),
      congested: withD.filter((r) => r.pressure >= 1).length,
      maxStr: Math.max(...t100.map((r) => r.strength ?? 0)),
      divs,
      /**
       * The whole ranking, not just the slice. Fixture A's top 100 is already
       * uncongested, so a top-100 median cannot show whether the component
       * responds - the rank of congested programmes across all 858 can.
       */
      congestedMedRank: med(scored.filter((r) => Number.isFinite(r.pressure) && r.pressure >= 1).map((r) => r.rank2)),
      thinMedRank: med(scored.filter((r) => Number.isFinite(r.pressure) && r.pressure < 0.25).map((r) => r.rank2)),
      pressureVsRank: spearman(
        scored.filter((r) => Number.isFinite(r.pressure)).map((r) => r.pressure),
        scored.filter((r) => Number.isFinite(r.pressure)).map((r) => r.rank2),
      ),
    };
  };

  if (args.includes('--roleprior')) {
    /**
     * What IS an unknown-role returner, empirically?
     *
     * The weight is not a taste. Take players at season T whose role could not
     * be placed, follow them into T+1, and ask how often they turn out to be
     * starters - then do the same for the ones we could place as squad. The
     * ratio anchors the unknown weight on the same scale as the squad weight
     * rather than on an opinion about doubt.
     */
    const COLS = `college_name, player_name, position, minutes_played, projected_minutes,
      games_started, projected_games_started, estimated_graduation_year, eligibility_end_year,
      country, season, division, class_year_label`;
    const { starterState, STARTER_STATE } = await import('../lib/v2/rosterEvidence.js');
    for (const sport of ['mens-soccer', 'womens-soccer']) {
      const tally = { unknownN: 0, unknownStarter: 0, squadN: 0, squadStarter: 0, starterN: 0, starterStarter: 0 };
      for (const T of [2022, 2023, 2024, 2025]) {
        const a = db.prepare(`SELECT ${COLS} FROM roster_players WHERE sport=? AND season=?`).all(sport, String(T));
        const b = db.prepare(`SELECT ${COLS} FROM roster_players WHERE sport=? AND season=?`).all(sport, String(T + 1));
        if (!a.length || !b.length) continue;
        const key = (r) => `${r.college_name}|${String(r.player_name || '').trim().toLowerCase()}`;
        const nextById = new Map(b.map((r) => [key(r), r]));
        for (const r of a) {
          const nx = nextById.get(key(r));
          if (!nx) continue;
          const now = starterState(r);
          const then = starterState(nx);
          if (then === STARTER_STATE.UNKNOWN) continue;
          const isStarter = then === STARTER_STATE.STARTER ? 1 : 0;
          if (now === STARTER_STATE.UNKNOWN) { tally.unknownN += 1; tally.unknownStarter += isStarter; }
          else if (now === STARTER_STATE.SQUAD) { tally.squadN += 1; tally.squadStarter += isStarter; }
          else { tally.starterN += 1; tally.starterStarter += isStarter; }
        }
      }
      const rate = (a2, b2) => (b2 ? a2 / b2 : null);
      const uS = rate(tally.unknownStarter, tally.unknownN);
      const qS = rate(tally.squadStarter, tally.squadN);
      const sS = rate(tally.starterStarter, tally.starterN);
      console.log(`\n== ${sport}: what a player at season T turns out to be at T+1`);
      console.log(`  was STARTER  n ${String(tally.starterN).padStart(6)}  starts next season ${fmt(sS)}`);
      console.log(`  was SQUAD    n ${String(tally.squadN).padStart(6)}  starts next season ${fmt(qS)}`);
      console.log(`  was UNKNOWN  n ${String(tally.unknownN).padStart(6)}  starts next season ${fmt(uS)}`);
      if (sS && qS && uS !== null) {
        const implied = (uS - qS) / (sS - qS);
        console.log(`  => on a scale where SQUAD sits at 0 and STARTER at 1, an unknown-role player sits at ${fmt(implied, 2)}`);
        for (const sq of [0.3, 0.4, 0.5]) {
          console.log(`     with squadWeight ${sq}: implied unknownWeight ${fmt(sq + (implied * (1 - sq)), 2)}`);
        }
      }
    }
  }

  if (args.includes('--grid')) {
    const fixture = arg('fixture', 'A');
    const priority = arg('priority', '5');
    const PROF = { 1: 'FULLY_DECLARED_LEVEL', 3: 'BALANCED', 5: 'FULLY_DECLARED_PLAYING' };
    const run = runFixture(fixture, PROF[priority]);
    const base = report(run.rows.map((r) => ({ ...r, rank2: r.rank, pressure: r.d ? pressureOf(r.d, { squadWeight: 0.4, unknownWeight: 0.5, places: run.places }) : null })).sort((a, b) => a.rank - b.rank), run);
    console.log(`fixture ${fixture}, playing priority ${priority}, ${run.rows.length} ranked, typical starters ${run.places}`);
    console.log(`PRODUCTION  top100 medStr ${fmt(base.s100, 1)}  medReturners ${base.ret} (p25 ${base.retP25}, p75 ${base.retP75})  congested(p>=1) ${base.congested}  medPressure ${fmt(base.pressMed, 2)}`);
    console.log('');
    console.log(`${'map'.padEnd(12)}${'sq'.padStart(5)}${'unk'.padStart(5)}${'split'.padStart(7)}${'mv20'.padStart(6)}${'mv50'.padStart(6)}${'s25'.padStart(6)}${'s100'.padStart(6)}${'s250'.padStart(6)}${'ret'.padStart(5)}${'p75'.padStart(5)}${'cong'.padStart(6)}${'maxStr'.padStart(8)}`);
    for (const map of Object.keys(MAPS)) {
      for (const competitionShare of [0.5, 0.6, 0.7]) {
        const scored = apply(run, { squadWeight: 0.4, unknownWeight: 0.5, map, competitionShare });
        const m = report(scored, run);
        console.log(`${map.padEnd(12)}${'0.4'.padStart(5)}${'0.5'.padStart(5)}${`${Math.round(competitionShare * 100)}/${Math.round((1 - competitionShare) * 100)}`.padStart(7)}`
          + `${String(m.moved20).padStart(6)}${String(m.moved50).padStart(6)}${fmt(m.s25, 1).padStart(6)}${fmt(m.s100, 1).padStart(6)}${fmt(m.s250, 1).padStart(6)}`
          + `${String(m.ret).padStart(5)}${String(m.retP75).padStart(5)}${String(m.congested).padStart(6)}${fmt(m.maxStr, 1).padStart(8)}`);
      }
    }
  }

  if (args.includes('--plateau')) {
    /** The full surface: weights x map x split, scored against the stated criteria. */
    const PROF = { 1: 'FULLY_DECLARED_LEVEL', 3: 'BALANCED', 5: 'FULLY_DECLARED_PLAYING' };
    const runs = {};
    for (const key of (arg('fixtures', 'A,C,H')).split(',')) {
      runs[key] = {};
      for (const p of [1, 3, 5]) runs[key][p] = runFixture(key, PROF[p]);
    }
    const out = [];
    for (const map of Object.keys(MAPS)) {
      for (const squadWeight of [0.3, 0.4, 0.5]) {
        for (const unknownWeight of [0.4, 0.5, 0.6]) {
          for (const competitionShare of [0.5, 0.6, 0.7]) {
            const cal = { squadWeight, unknownWeight, map, competitionShare };
            const cells = [];
            for (const key of Object.keys(runs)) {
              for (const p of [1, 3, 5]) {
                const run = runs[key][p];
                const m = report(apply(run, cal), run);
                const before = report(run.rows.map((r) => ({ ...r, rank2: r.rank, pressure: r.d ? pressureOf(r.d, { ...cal, places: run.places }) : null })).sort((a, b) => a.rank - b.rank), run);
                cells.push({ key, p, m, before });
              }
            }
            const pick = (k, p) => cells.find((c) => c.key === k && c.p === p);
            const a5 = pick('A', 5); const a1 = pick('A', 1); const h5 = pick('H', 5); const c5 = pick('C', 5);
            out.push({
              cal,
              /** More congestion should mean a worse rank. Positive is the intended direction. */
              rhoA5: a5.m.pressureVsRank, rhoA5before: a5.before.pressureVsRank,
              rhoA1: a1.m.pressureVsRank, rhoA1before: a1.before.pressureVsRank,
              rhoH5: h5 ? h5.m.pressureVsRank : null,
              /** Where the congested programmes sit across the WHOLE ranking. */
              congA5: a5.m.congestedMedRank, congA5before: a5.before.congestedMedRank,
              thinA5: a5.m.thinMedRank, thinA5before: a5.before.thinMedRank,
              mv20at1: a1.m.moved20, mv20at5: a5.m.moved20,
              strengthDrift: Math.max(...cells.map((c) => (c.before.s100 ?? 0) - (c.m.s100 ?? 0))),
              cRealism: c5 ? (c5.before.s100 ?? 0) - (c5.m.s100 ?? 0) : null,
              cells,
            });
          }
        }
      }
    }
    console.log(`baseline: rho(pressure, rank) A@5 ${fmt(out[0].rhoA5before)}  A@1 ${fmt(out[0].rhoA1before)}  congested median rank A@5 ${out[0].congA5before}  thin median rank A@5 ${out[0].thinA5before}`);
    console.log('');
    console.log(`${'map'.padEnd(12)}${'sq'.padStart(5)}${'unk'.padStart(5)}${'split'.padStart(7)}${'rhoA@5'.padStart(8)}${'rhoA@1'.padStart(8)}${'rhoH@5'.padStart(8)}${'congRk'.padStart(8)}${'thinRk'.padStart(8)}${'mv20@1'.padStart(8)}${'mv20@5'.padStart(8)}${'drift'.padStart(7)}`);
    for (const o of out) {
      console.log(`${o.cal.map.padEnd(12)}${fmt(o.cal.squadWeight, 1).padStart(5)}${fmt(o.cal.unknownWeight, 1).padStart(5)}${`${Math.round(o.cal.competitionShare * 100)}/${Math.round((1 - o.cal.competitionShare) * 100)}`.padStart(7)}`
        + `${fmt(o.rhoA5).padStart(8)}${fmt(o.rhoA1).padStart(8)}${fmt(o.rhoH5).padStart(8)}${String(o.congA5).padStart(8)}${String(o.thinA5).padStart(8)}${String(o.mv20at1).padStart(8)}${String(o.mv20at5).padStart(8)}${fmt(o.strengthDrift, 1).padStart(7)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
