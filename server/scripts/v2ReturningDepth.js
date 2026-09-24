/**
 * A7.8.1: can Thriv3 honestly say how crowded a position will be when an
 * athlete arrives, and does the roster it already holds predict that?
 *
 * READ-ONLY AND DIAGNOSTIC. Nothing scores, weights, gates, calibrates or
 * persists anything. Candidate signals are computed beside the production run
 * and discarded.
 *
 *   node server/scripts/v2ReturningDepth.js --temporal
 *   node server/scripts/v2ReturningDepth.js --coverage --entry=2027
 *   node server/scripts/v2ReturningDepth.js --signals --entry=2027
 *   node server/scripts/v2ReturningDepth.js --pairs --entry=2027
 *   node server/scripts/v2ReturningDepth.js --saintmarys
 *   node server/scripts/v2ReturningDepth.js --universe
 */
import { FIXTURES } from './v2Fixtures.js';
import { PROFILES } from './v2ValidationFixtures.js';

const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];
const SEASON = '2026';
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const med = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const corr = (xs, ys) => {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs); const my = mean(ys);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i += 1) { const dx = xs[i] - mx; const dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return (sxx === 0 || syy === 0) ? null : sxy / Math.sqrt(sxx * syy);
};
/** Spearman, because several of these are small counts with ties. */
const spearman = (xs, ys) => {
  const rank = (a) => {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(a.length);
    let i = 0;
    while (i < idx.length) {
      let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  return corr(rank(xs), rank(ys));
};

/** The three candidate readings of returning depth, from one bucket. */
export function depthSignals({ total, starters, unknown, squad }, { places, squadWeight = 0.4, unknownWeight = 0.5 }) {
  const cap = Math.max(1, places);
  return {
    /** A. Headcount pressure: everyone who is projected to still be here. */
    headcount: total / cap,
    /** B. Role-weighted: only players whose role we actually placed. */
    roleWeighted: (starters + (squadWeight * squad)) / cap,
    /**
     * C. Hybrid: every returner presses, a known starter presses hardest, an
     * unknown-role returner presses at the middle of what it could be. The
     * doubt goes to the evidence grade, not to the value.
     */
    hybrid: (starters + (squadWeight * squad) + (unknownWeight * unknown)) / cap,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k, d = null) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
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

  const ROSTER_COLUMNS = `college_name, player_name, position, minutes_played, projected_minutes,
    games_started, projected_games_started, estimated_graduation_year, eligibility_end_year,
    country, season, division, class_year_label`;

  const ctxCache = new Map();
  const contextFor = (sport) => {
    if (!ctxCache.has(sport)) ctxCache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
    return ctxCache.get(sport);
  };

  if (args.includes('--temporal')) {
    /**
     * THE TEST THAT MATTERS. Stand at season T, predict who is still here at
     * T+1 from class labels alone, then look at the roster that actually
     * turned up. Nothing about T+1 is used to make the prediction.
     */
    for (const sport of ['mens-soccer', 'womens-soccer']) {
      console.log(`\n=== ${sport}`);
      for (const T of [2022, 2023, 2024, 2025]) {
        const next = T + 1;
        const rowsT = db.prepare(`SELECT ${ROSTER_COLUMNS} FROM roster_players WHERE sport = ? AND season = ?`).all(sport, String(T));
        const rowsN = db.prepare(`SELECT ${ROSTER_COLUMNS} FROM roster_players WHERE sport = ? AND season = ?`).all(sport, String(next));
        if (!rowsT.length || !rowsN.length) { console.log(`  ${T} -> ${next}: no data`); continue; }
        const idxT = buildPositionIndex(rowsT);
        const idxN = buildPositionIndex(rowsN);
        /** Who actually appeared again, by name, at the same programme and position. */
        const nameKey = (r) => `${r.college_name}|${String(r.player_name || '').trim().toLowerCase()}`;
        const namesN = new Set(rowsN.map(nameKey));
        const actualReturnersByPos = new Map();
        for (const r of rowsT) {
          const p = canonicalPosition(r.position);
          if (!p || p === 'UNKNOWN') continue;
          if (!namesN.has(nameKey(r))) continue;
          const k = `${r.college_name}|${p}`;
          actualReturnersByPos.set(k, (actualReturnersByPos.get(k) ?? 0) + 1);
        }
        const obs = [];
        for (const [programme, entry] of idxT) {
          const nextEntry = idxN.get(programme);
          if (!nextEntry) continue;
          for (const p of POSITIONS) {
            const bucket = entry.positions.get(p);
            if (!bucket || bucket.rows < 3) continue;
            const d = returningDepth(bucket, T);
            if (!d) continue;
            const nb = nextEntry.positions.get(p);
            if (!nb || nb.rows === 0) continue;
            const places = typicalStarters(sport, p) ?? 4;
            const sig = depthSignals(d, { places });
            let actualStarters = 0;
            for (const [, c] of nb.starterLastSeason) actualStarters += c;
            obs.push({
              programme, position: p, places,
              predictedReturners: d.total,
              predictedStarters: d.starters,
              roleCoverage: d.coverage,
              headcount: sig.headcount, roleWeighted: sig.roleWeighted, hybrid: sig.hybrid,
              actualReturners: actualReturnersByPos.get(`${programme}|${p}`) ?? 0,
              actualGroupSize: nb.rows,
              actualStarters,
            });
          }
        }
        if (obs.length < 50) { console.log(`  ${T} -> ${next}: only ${obs.length} comparable groups`); continue; }
        const col = (k) => obs.map((o) => o[k]);
        console.log(`  ${T} -> ${next}  n = ${obs.length} programme-positions`);
        console.log(`    predicted returners median ${med(col('predictedReturners'))}   actual returners median ${med(col('actualReturners'))}   next group size median ${med(col('actualGroupSize'))}`);
        const mae = mean(obs.map((o) => Math.abs(o.predictedReturners - o.actualReturners)));
        console.log(`    RAW COUNTS`);
        console.log(`      predicted returners vs actual returners   r ${fmt(corr(col('predictedReturners'), col('actualReturners')))}  rho ${fmt(spearman(col('predictedReturners'), col('actualReturners')))}  MAE ${fmt(mae, 2)} players`);
        console.log(`      predicted returners vs next group size    r ${fmt(corr(col('predictedReturners'), col('actualGroupSize')))}  rho ${fmt(spearman(col('predictedReturners'), col('actualGroupSize')))}`);
        console.log(`      predicted starters  vs next starters      r ${fmt(corr(col('predictedStarters'), col('actualStarters')))}  rho ${fmt(spearman(col('predictedStarters'), col('actualStarters')))}`);
        /**
         * NORMALISED, AND COMPARED LIKE WITH LIKE. Every candidate divides by
         * the position's typical starting places, so the outcome must be
         * divided by the same thing or the comparison is between a per-place
         * rate and a raw count - which is how the first run of this test
         * reported a real signal as noise.
         */
        console.log(`    NORMALISED BY TYPICAL STARTING PLACES, outcome = next group size / places`);
        const outcome = obs.map((o) => o.actualGroupSize / o.places);
        for (const [label, key] of [['headcount pressure', 'headcount'], ['role-weighted', 'roleWeighted'], ['hybrid', 'hybrid']]) {
          console.log(`      ${label.padEnd(20)} r ${fmt(corr(col(key), outcome))}  rho ${fmt(spearman(col(key), outcome))}`);
        }
        console.log(`    WITHIN POSITION (raw counts, so no normaliser can flatter anything)`);
        for (const p of POSITIONS) {
          const sub = obs.filter((o) => o.position === p);
          if (sub.length < 30) continue;
          const sc = (k) => sub.map((o) => o[k]);
          console.log(`      ${p.padEnd(11)} n ${String(sub.length).padStart(4)}  returners->groupSize rho ${fmt(spearman(sc('predictedReturners'), sc('actualGroupSize')))}`
            + `  returners->nextStarters rho ${fmt(spearman(sc('predictedReturners'), sc('actualStarters')))}`
            + `  roleWeighted->nextStarters rho ${fmt(spearman(sc('roleWeighted'), sc('actualStarters')))}`
            + `  hybrid->nextStarters rho ${fmt(spearman(sc('hybrid'), sc('actualStarters')))}`);
        }
        const known = obs.filter((o) => o.roleCoverage >= 0.6);
        if (known.length >= 50) {
          const kc = (k) => known.map((o) => o[k]);
          const kOut = known.map((o) => o.actualGroupSize / o.places);
          const kStart = known.map((o) => o.actualStarters);
          console.log(`    WHERE ROLE COVERAGE >= 0.6 (n = ${known.length}), normalised outcome`);
          console.log(`      headcount    -> group size rho ${fmt(spearman(kc('headcount'), kOut))}   -> next starters rho ${fmt(spearman(kc('headcount'), kStart))}`);
          console.log(`      roleWeighted -> group size rho ${fmt(spearman(kc('roleWeighted'), kOut))}   -> next starters rho ${fmt(spearman(kc('roleWeighted'), kStart))}`);
          console.log(`      hybrid       -> group size rho ${fmt(spearman(kc('hybrid'), kOut))}   -> next starters rho ${fmt(spearman(kc('hybrid'), kStart))}`);
        }
      }
    }
  }

  if (args.includes('--coverage')) {
    const entry = Number(arg('entry', '2027'));
    for (const sport of ['mens-soccer', 'womens-soccer']) {
      const ctx = contextFor(sport);
      console.log(`\n== ${sport}, entry ${entry}`);
      console.log(`${'division'.padEnd(10)}${'pos'.padEnd(11)}${'progPos'.padStart(8)}${'headCov'.padStart(9)}${'roleCov'.padStart(9)}${'medRet'.padStart(8)}${'medStart'.padStart(9)}${'medSquad'.padStart(9)}${'medUnk'.padStart(8)}${'FULL'.padStart(6)}${'PART'.padStart(6)}${'NONE'.padStart(6)}`);
      const groups = new Map();
      for (const c of ctx.colleges) {
        const prog = ctx.rosterIndex.get(c.name);
        for (const p of POSITIONS) {
          const bucket = prog?.positions?.get(p);
          const d = returningDepth(bucket, entry);
          const key = `${c.division}|${p}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push({ d, hasRoster: Boolean(bucket && bucket.rows > 0) });
        }
      }
      for (const [key, list] of [...groups.entries()].sort()) {
        const [division, p] = key.split('|');
        if (list.length < 20) continue;
        const withRoster = list.filter((x) => x.hasRoster);
        const withReturners = withRoster.filter((x) => x.d.total > 0);
        const full = withReturners.filter((x) => x.d.coverage === 1).length;
        const part = withReturners.filter((x) => x.d.coverage > 0 && x.d.coverage < 1).length;
        const none = withReturners.filter((x) => x.d.coverage === 0).length;
        console.log(`${division.padEnd(10)}${p.padEnd(11)}${String(list.length).padStart(8)}`
          + `${`${((withRoster.length / list.length) * 100).toFixed(0)}%`.padStart(9)}`
          + `${fmt(med(withReturners.map((x) => x.d.coverage)), 2).padStart(9)}`
          + `${String(med(withReturners.map((x) => x.d.total))).padStart(8)}`
          + `${String(med(withReturners.map((x) => x.d.starters))).padStart(9)}`
          + `${String(med(withReturners.map((x) => x.d.squad))).padStart(9)}`
          + `${String(med(withReturners.map((x) => x.d.unknown))).padStart(8)}`
          + `${String(full).padStart(6)}${String(part).padStart(6)}${String(none).padStart(6)}`);
      }
    }
  }

  /** One fixture's ranked rows with every candidate signal attached. */
  const runFixture = (key, profileId, entryOverride = null) => {
    const f = FIXTURES.find((x) => x.id.toUpperCase().startsWith(`${key}-`));
    const sport = f.player.sport;
    const ctx = contextFor(sport);
    const position = canonicalPosition(f.player.position);
    const entry = entryOverride ?? f.player.recruiting_class_year;
    const v1Shape = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
    const { athlete } = buildValidationAthlete({
      record: f.player, v1Shape, position, label: f.id, profile: PROFILES[profileId], recruitType: null,
    });
    const run = runPursuit({ athlete, sport, colleges: ctx.colleges, ctx });
    const byId = new Map(ctx.colleges.map((c) => [c.id, c]));
    const places = typicalStarters(sport, position) ?? 4;
    const rows = run.pipeline.ranked.map((e) => {
      const rb = e.recruitability.basis ?? {}; const ob = e.opportunity.basis ?? {};
      const c = byId.get(e.id);
      const bucket = ctx.rosterIndex.get(e.name)?.positions?.get(position);
      const d = returningDepth(bucket, entry);
      const sig = d ? depthSignals(d, { places }) : null;
      return {
        name: e.name, division: c.division, strength: c.soccer_score, academic: c.academic_rating,
        net: c.net_price, rank: e.rank,
        A: rb.athleticPlausibility ?? null,
        pos: (rb.signals ?? []).find((s) => s.key === 'positionalOpportunity')?.value ?? null,
        mkt: (rb.signals ?? []).find((s) => s.key === 'recruitingMarket')?.value ?? null,
        R: e.recruitability.value, F: e.financial.value, O: e.opportunity.value, P: e.pursuitPriority.value,
        rotation: ob.components?.playingOpportunity?.value ?? null,
        rotationShare: ob.playing?.playingShare ?? null,
        playShare: ob.components?.playingOpportunity?.share ?? null,
        rosterRows: bucket?.rows ?? 0, d, sig, places,
      };
    });
    return { f, position, ctx, places, rows, byName: new Map(rows.map((r) => [r.name, r])) };
  };

  if (args.includes('--signals')) {
    const entry = Number(arg('entry', '2027'));
    for (const key of ['A', 'H']) {
      const { f, rows, places } = runFixture(key, 'UNDECLARED', entry);
      const ok = rows.filter((r) => r.sig && Number.isFinite(r.rotation));
      console.log(`\n== ${f.id}  entry ${entry}  n ${ok.length}  typical starters ${places}`);
      const cols = {
        'squad rotation': ok.map((r) => r.rotation),
        'headcount pressure': ok.map((r) => r.sig.headcount),
        'role-weighted': ok.map((r) => r.sig.roleWeighted),
        'hybrid': ok.map((r) => r.sig.hybrid),
        'positional recruitability': ok.map((r) => r.pos ?? 0),
        'programme strength': ok.map((r) => r.strength ?? 0),
        'roster size': ok.map((r) => r.rosterRows),
      };
      const keys = Object.keys(cols);
      console.log(`${''.padEnd(28)}${keys.map((k) => k.slice(0, 9).padStart(11)).join('')}`);
      for (const a of keys) {
        console.log(`${a.padEnd(28)}${keys.map((b) => fmt(corr(cols[a], cols[b]), 2).padStart(11)).join('')}`);
      }
      for (const w of [0.2, 0.4, 0.6]) {
        const rw = ok.map((r) => (r.d.starters + (w * r.d.squad)) / places);
        console.log(`  squad weight ${w}: role-weighted vs headcount r ${fmt(corr(rw, ok.map((r) => r.sig.headcount)))}  vs rotation r ${fmt(corr(rw, ok.map((r) => r.rotation)))}`);
      }
    }
  }

  if (args.includes('--saintmarys')) {
    const entry = Number(arg('entry', '2028'));
    const { byName, places } = runFixture('A', 'FULLY_DECLARED_PLAYING', entry);
    console.log(`MIDFIELD, entry ${entry}, typical starters ${places}, playing priority 5`);
    console.log(`${'programme'.padEnd(16)}${'ret'.padStart(5)}${'st'.padStart(4)}${'sq'.padStart(4)}${'unk'.padStart(5)}${'roleCov'.padStart(9)}${'rotation'.padStart(10)}${'headcnt'.padStart(9)}${'roleWtd'.padStart(9)}${'hybrid'.padStart(8)}${'O'.padStart(7)}${'rank'.padStart(6)}`);
    for (const n of ["Saint Mary's", 'VMI', 'Clemson', 'Pittsburgh', 'UC Davis', 'Rollins', 'Louisville', 'North Florida']) {
      const r = byName.get(n);
      if (!r?.sig) { console.log(`${n} — not ranked`); continue; }
      console.log(`${n.slice(0, 15).padEnd(16)}${String(r.d.total).padStart(5)}${String(r.d.starters).padStart(4)}${String(r.d.squad).padStart(4)}${String(r.d.unknown).padStart(5)}${fmt(r.d.coverage, 2).padStart(9)}${fmt(r.rotation).padStart(10)}${fmt(r.sig.headcount).padStart(9)}${fmt(r.sig.roleWeighted).padStart(9)}${fmt(r.sig.hybrid).padStart(8)}${fmt(r.O).padStart(7)}${String(r.rank).padStart(6)}`);
    }
  }

  if (args.includes('--pairs')) {
    const entry = Number(arg('entry', '2027'));
    const f = FIXTURES.find((x) => x.id.startsWith('A-'));
    const sport = f.player.sport;
    const ctx = contextFor(sport);
    const v1Shape = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
    for (const position of POSITIONS) {
      const { athlete } = buildValidationAthlete({
        record: f.player, v1Shape, position, label: f.id, profile: PROFILES.FULLY_DECLARED_PLAYING, recruitType: null,
      });
      const run = runPursuit({ athlete, sport, colleges: ctx.colleges, ctx });
      const byId = new Map(ctx.colleges.map((c) => [c.id, c]));
      const places = typicalStarters(sport, position) ?? 4;
      const rows = run.pipeline.ranked.map((e) => {
        const rb = e.recruitability.basis ?? {}; const ob = e.opportunity.basis ?? {};
        const c = byId.get(e.id);
        const d = returningDepth(ctx.rosterIndex.get(e.name)?.positions?.get(position), entry);
        return {
          name: e.name, strength: c.soccer_score, net: c.net_price, A: rb.athleticPlausibility,
          mkt: (rb.signals ?? []).find((s) => s.key === 'recruitingMarket')?.value ?? null,
          rotation: ob.components?.playingOpportunity?.value ?? null,
          d, sig: d ? depthSignals(d, { places }) : null, rank: e.rank,
        };
      }).filter((r) => r.d && r.d.total > 0 && r.d.coverage >= 0.5 && Number.isFinite(r.rotation));
      let best = null;
      for (const x of rows) for (const y of rows) {
        if (x === y) continue;
        if (Math.abs(x.strength - y.strength) > 3) continue;
        if (Math.abs(x.A - y.A) > 0.04) continue;
        if (Math.abs((x.net ?? 0) - (y.net ?? 0)) > 10000) continue;
        if (Math.abs((x.mkt ?? 0) - (y.mkt ?? 0)) > 0.2) continue;
        const gap = y.d.total - x.d.total;
        if (gap < 4) continue;
        if (!best || gap > best.gap) best = { x, y, gap };
      }
      console.log(`\n== ${position} (entry ${entry}, typical starters ${places})`);
      if (!best) { console.log('  no pair meets the controls'); continue; }
      for (const [t, r] of [['thin', best.x], ['deep', best.y]]) {
        console.log(`  ${t.padEnd(5)} ${r.name.slice(0, 24).padEnd(25)} str ${fmt(r.strength, 1).padStart(5)} | ret ${String(r.d.total).padStart(2)} (st ${r.d.starters} sq ${r.d.squad} unk ${r.d.unknown}, cov ${fmt(r.d.coverage, 2)})`
          + ` | rotation ${fmt(r.rotation)} headcount ${fmt(r.sig.headcount)} roleWtd ${fmt(r.sig.roleWeighted)} hybrid ${fmt(r.sig.hybrid)}`);
      }
      const o = (k) => (best.y.sig[k] > best.x.sig[k] ? 'correct (deep presses more)' : 'WRONG');
      console.log(`  gap ${best.gap} returners.  rotation orders: ${best.y.rotation > best.x.rotation ? 'WRONG (deep scores higher)' : 'correct'}`);
      console.log(`  headcount ${o('headcount')} · roleWeighted ${o('roleWeighted')} · hybrid ${o('hybrid')}`);
    }
  }

  if (args.includes('--universe')) {
    const W = PURSUIT_WEIGHTS; const G = PURSUIT_GATES;
    const KEY = { 1: 'FULLY_DECLARED_LEVEL', 3: 'BALANCED', 5: 'FULLY_DECLARED_PLAYING' };
    for (const fixture of (arg('fixtures', 'A,C,H')).split(',')) {
      console.log(`\n=== fixture ${fixture}`);
      for (const priority of [1, 3, 5]) {
        const { rows, places, f } = runFixture(fixture, KEY[priority]);
        const ok = rows.filter((r) => r.sig && Number.isFinite(r.rotation));
        if (!ok.length) { console.log(`  priority ${priority}: nothing scoreable`); continue; }
        /** Diagnostic Playing Pathway: half rotation, half (1 - hybrid pressure). */
        const pathway = (r) => (0.5 * r.rotation) + (0.5 * Math.max(0, Math.min(1, 1 - (r.sig.hybrid / 2))));
        const share = med(ok.map((r) => r.playShare ?? 0.098)) ?? 0.098;
        const re = ok.map((r) => {
          const O2 = Math.max(0, Math.min(1, r.O + (share * (pathway(r) - r.rotation))));
          const base = (W.recruitability * r.R) + (W.financial * r.F) + (W.opportunity * O2);
          return { ...r, P2: base * tailGate(r.R, G.recruitability) * tailGate(r.F, G.financial) };
        }).sort((a, b) => b.P2 - a.P2);
        re.forEach((r, i) => { r.rank2 = i + 1; });
        const before = ok.filter((r) => r.rank <= 100); const after = re.slice(0, 100);
        const divs = {}; for (const r of after) divs[r.division] = (divs[r.division] ?? 0) + 1;
        console.log(`  priority ${priority}  (${f.player.football_ability}/10, share of O ${fmt(share, 3)})`);
        console.log(`    moved 20+ ranks: ${re.filter((r) => Math.abs(r.rank2 - r.rank) >= 20).length} of ${re.length}`);
        console.log(`    top100 median strength ${fmt(med(after.map((r) => r.strength)), 1)} (was ${fmt(med(before.map((r) => r.strength)), 1)})`
          + `   median returners ${med(after.map((r) => r.d.total))} (was ${med(before.map((r) => r.d.total))})`
          + `   max strength ${fmt(Math.max(...after.map((r) => r.strength ?? 0)), 1)}`);
        console.log(`    divisions ${JSON.stringify(divs)}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
