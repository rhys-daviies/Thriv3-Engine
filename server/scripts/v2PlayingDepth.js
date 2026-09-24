/**
 * A7.8: what `playingOpportunity` measures, and what the roster already knows
 * about who the athlete would be competing with.
 *
 * READ-ONLY AND DIAGNOSTIC. Nothing here scores, weights, gates, calibrates or
 * persists anything, and no candidate is applied to production. Returning-depth
 * quantities are derived from the SAME position index production already
 * builds, so the inventory reports what is available rather than what a new
 * ingestion would have to fetch.
 *
 *   node server/scripts/v2PlayingDepth.js --inventory
 *   node server/scripts/v2PlayingDepth.js --correlate
 *   node server/scripts/v2PlayingDepth.js --set2
 *   node server/scripts/v2PlayingDepth.js --pairs
 *   node server/scripts/v2PlayingDepth.js --priority
 *   node server/scripts/v2PlayingDepth.js --sensitivity
 */
import { FIXTURES } from './v2Fixtures.js';
import { PROFILES } from './v2ValidationFixtures.js';

const SEASON = '2026';
const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const med = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
const corr = (xs, ys) => {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i += 1) { const dx = xs[i] - mx; const dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return (sxx === 0 || syy === 0) ? null : sxy / Math.sqrt(sxx * syy);
};

/**
 * Returning depth for one programme-position at one entry year, split by the
 * role we can place each returner in.
 *
 * EVERY FIGURE COMES OUT OF THE EXISTING INDEX. `starterLastSeason` and
 * `byLastSeasonUnknown` are already built for the departing side; nothing
 * reads them for the RETURNING side, which is the whole finding.
 */
export function returningDepth(bucket, entryYear) {
  if (!bucket) return null;
  const after = (m) => { let n = 0; for (const [last, c] of m) if (last > entryYear) n += c; return n; };
  const total = after(bucket.byLastSeason);
  const starters = after(bucket.starterLastSeason);
  const unknown = after(bucket.byLastSeasonUnknown);
  return {
    total, starters, unknown,
    squad: Math.max(0, total - starters - unknown),
    roleKnown: total - unknown,
    coverage: total === 0 ? 1 : (total - unknown) / total,
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
  const { buildValidationAthlete, typicalStarters, playingShareFor, playingScale } = await import('../../shared/matching/v2/index.js');

  const ctxCache = new Map();
  const contextFor = (sport) => {
    if (!ctxCache.has(sport)) ctxCache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
    return ctxCache.get(sport);
  };

  if (args.includes('--inventory')) {
    for (const sport of ['mens-soccer', 'womens-soccer']) {
      const ctx = contextFor(sport);
      console.log(`\n== ${sport}, entry year 2028`);
      console.log(`${'division'.padEnd(10)}${'position'.padEnd(11)}${'prog'.padStart(6)}${'medReturn'.padStart(11)}${'medStart'.padStart(10)}${'medUnk'.padStart(8)}${'roleKnown'.padStart(11)}${'FULL'.padStart(7)}${'PART'.padStart(7)}${'NONE'.padStart(7)}`);
      const byDiv = new Map();
      for (const c of ctx.colleges) {
        const prog = ctx.rosterIndex.get(c.name);
        for (const p of POSITIONS) {
          const d = returningDepth(prog?.positions?.get(p), 2028);
          const key = `${c.division}|${p}`;
          if (!byDiv.has(key)) byDiv.set(key, []);
          byDiv.get(key).push(d);
        }
      }
      for (const [key, list] of [...byDiv.entries()].sort()) {
        const [division, p] = key.split('|');
        const have = list.filter(Boolean);
        if (have.length < 5) continue;
        const full = have.filter((d) => d.coverage === 1).length;
        const part = have.filter((d) => d.coverage > 0 && d.coverage < 1).length;
        const none = list.length - have.length + have.filter((d) => d.coverage === 0).length;
        console.log(`${division.padEnd(10)}${p.padEnd(11)}${String(list.length).padStart(6)}${String(med(have.map((d) => d.total))).padStart(11)}${String(med(have.map((d) => d.starters))).padStart(10)}${String(med(have.map((d) => d.unknown))).padStart(8)}${fmt(med(have.map((d) => d.coverage)), 2).padStart(11)}${String(full).padStart(7)}${String(part).padStart(7)}${String(none).padStart(7)}`);
      }
    }
  }

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
      const rb = e.recruitability.basis ?? {};
      const ob = e.opportunity.basis ?? {};
      const c = byId.get(e.id);
      const bucket = ctx.rosterIndex.get(e.name)?.positions?.get(position);
      const depth = returningDepth(bucket, f.player.recruiting_class_year);
      const sig = (k) => (rb.signals ?? []).find((s) => s.key === k) ?? null;
      return {
        name: e.name, division: c.division, strength: c.soccer_score, rank: e.rank,
        A: rb.athleticPlausibility ?? null,
        pos: sig('positionalOpportunity')?.value ?? null,
        R: e.recruitability.value, F: e.financial.value, O: e.opportunity.value, P: e.pursuitPriority.value,
        playing: ob.components?.playingOpportunity?.value ?? null,
        playShare: ob.playing?.playingShare ?? null,
        playLevel: ob.playing?.level ?? null,
        depth,
        positional: rb.positional ?? null,
        rosterRows: bucket?.rows ?? 0,
      };
    });
    return { f, position, ctx, rows, byName: new Map(rows.map((r) => [r.name, r])) };
  };

  if (args.includes('--entryyear')) {
    /**
     * How far out can returning ROLE be known at all? The returners for a
     * given entry year are, by construction, the players young enough to
     * still be eligible then - and the further out the entry year, the less
     * they have played.
     */
    for (const sport of ['mens-soccer', 'womens-soccer']) {
      const ctx = contextFor(sport);
      console.log(`\n== ${sport}`);
      console.log(`${'entryYear'.padStart(10)}${'progPos'.padStart(9)}${'medReturning'.padStart(14)}${'medRoleKnown'.padStart(14)}${'fullCoverage'.padStart(14)}${'zeroCoverage'.padStart(14)}`);
      for (const entry of [2026, 2027, 2028, 2029]) {
        const all = [];
        for (const c of ctx.colleges) {
          const prog = ctx.rosterIndex.get(c.name);
          for (const p of POSITIONS) {
            const d = returningDepth(prog?.positions?.get(p), entry);
            if (d && d.total > 0) all.push(d);
          }
        }
        const full = all.filter((d) => d.coverage === 1).length;
        const zero = all.filter((d) => d.coverage === 0).length;
        console.log(`${String(entry).padStart(10)}${String(all.length).padStart(9)}${String(med(all.map((d) => d.total))).padStart(14)}${fmt(med(all.map((d) => d.coverage)), 2).padStart(14)}${`${((full / all.length) * 100).toFixed(1)}%`.padStart(14)}${`${((zero / all.length) * 100).toFixed(1)}%`.padStart(14)}`);
      }
    }
  }

  if (args.includes('--correlate')) {
    for (const [key, sport] of [['A', 'mens-soccer'], ['H', 'womens-soccer']]) {
      const { f, rows } = runFixture(key, 'UNDECLARED');
      const ok = rows.filter((r) => Number.isFinite(r.playing) && r.depth);
      console.log(`\n== ${f.id} (${sport}), n = ${ok.length}`);
      const X = ok.map((r) => r.playing);
      const pairs = [
        ['positional recruitability', ok.map((r) => r.pos)],
        ['departing starters', ok.map((r) => r.positional?.vacatedStarters ?? 0)],
        ['eligibleToRemain (returning total)', ok.map((r) => r.depth.total)],
        ['returning STARTERS', ok.map((r) => r.depth.starters)],
        ['returning squad', ok.map((r) => r.depth.squad)],
        ['positional roster size', ok.map((r) => r.rosterRows)],
        ['incoming positional arrivals', ok.map((r) => r.positional?.arrivals ?? 0)],
        ['programme strength', ok.map((r) => r.strength ?? 0)],
        ['athletic compatibility', ok.map((r) => r.A ?? 0)],
        ['recruitability R', ok.map((r) => r.R)],
      ];
      for (const [label, Y] of pairs) {
        const usable = X.map((x, i) => [x, Y[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
        console.log(`  corr(playingOpportunity, ${label.padEnd(36)}) = ${fmt(corr(usable.map((u) => u[0]), usable.map((u) => u[1])))}`);
      }
    }
  }

  if (args.includes('--set2')) {
    const { position, rows, byName } = runFixture('A', 'FULLY_DECLARED_LEVEL');
    const PAIRS = [['Clemson', 'Pittsburgh'], ['Louisville', 'North Florida'], ["Saint Mary's", 'VMI'], ['UC Davis', 'Rollins']];
    for (const [a, b] of PAIRS) {
      console.log(`\n== ${a} vs ${b}  (${position}, entry 2028)`);
      for (const n of [a, b]) {
        const r = byName.get(n);
        const p = r.positional;
        console.log(`  ${n.padEnd(16)} str ${fmt(r.strength, 1).padStart(5)} | roster ${String(r.rosterRows).padStart(2)}`
          + ` departing ${String(p?.starterEvidence?.departing ?? '—').padStart(2)} (starters ${String(p?.vacatedStarters ?? '—').padStart(2)}, unplaceable ${String(p?.starterEvidence?.departingUnknown ?? '—').padStart(2)})`
          + ` | RETURNING ${String(r.depth.total).padStart(2)} = starters ${r.depth.starters} + squad ${r.depth.squad} + unknown ${r.depth.unknown}`
          + ` | arrivals ${p?.arrivals ?? '—'}`);
        console.log(`  ${''.padEnd(16)} positional ${fmt(r.pos)}  playingOpportunity ${fmt(r.playing)} (share ${fmt(r.playShare)} @ ${r.playLevel})  R ${fmt(r.R)}  O ${fmt(r.O)}  P ${fmt(r.P)}  #${r.rank}`);
      }
    }
  }

  if (args.includes('--pairs')) {
    /**
     * Controlled real pairs: close on strength, compatibility, cost and
     * market, far apart on returning depth. One per position.
     */
    const f = FIXTURES.find((x) => x.id.startsWith('A-'));
    const sport = f.player.sport;
    const ctx = contextFor(sport);
    const v1Shape = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
    for (const position of POSITIONS) {
      const { athlete } = buildValidationAthlete({
        record: f.player, v1Shape, position, label: f.id, profile: PROFILES.FULLY_DECLARED_LEVEL, recruitType: null,
      });
      const run = runPursuit({ athlete, sport, colleges: ctx.colleges, ctx });
      const byId = new Map(ctx.colleges.map((c) => [c.id, c]));
      const rows = run.pipeline.ranked.map((e) => {
        const rb = e.recruitability.basis ?? {}; const ob = e.opportunity.basis ?? {};
        const c = byId.get(e.id);
        const depth = returningDepth(ctx.rosterIndex.get(e.name)?.positions?.get(position), 2028);
        return {
          name: e.name, strength: c.soccer_score, academic: c.academic_rating, net: c.net_price,
          A: rb.athleticPlausibility, R: e.recruitability.value, F: e.financial.value,
          O: e.opportunity.value, P: e.pursuitPriority.value, rank: e.rank,
          playing: ob.components?.playingOpportunity?.value ?? null, depth,
          mkt: (rb.signals ?? []).find((s) => s.key === 'recruitingMarket')?.value ?? null,
        };
      }).filter((r) => r.depth && r.depth.coverage === 1 && Number.isFinite(r.playing));
      let best = null;
      for (const x of rows) {
        for (const y of rows) {
          if (x === y) continue;
          if (Math.abs(x.strength - y.strength) > 2) continue;
          if (Math.abs(x.A - y.A) > 0.03) continue;
          if (Math.abs((x.net ?? 0) - (y.net ?? 0)) > 8000) continue;
          if (Math.abs((x.mkt ?? 0) - (y.mkt ?? 0)) > 0.15) continue;
          const gap = (y.depth.starters + y.depth.squad) - (x.depth.starters + x.depth.squad);
          if (gap < 4) continue;
          const score = gap - Math.abs(x.strength - y.strength);
          if (!best || score > best.score) best = { x, y, gap, score };
        }
      }
      console.log(`\n== ${position}`);
      if (!best) { console.log('  no pair meets the controls'); continue; }
      for (const [t, r] of [['A (thin)', best.x], ['B (deep)', best.y]]) {
        console.log(`  ${t.padEnd(10)} ${r.name.slice(0, 26).padEnd(27)} str ${fmt(r.strength, 1).padStart(5)} acad ${fmt(r.academic, 1).padStart(4)} $${String(r.net ?? '—').padStart(6)}`
          + ` | returning ${String(r.depth.total).padStart(2)} (starters ${r.depth.starters}, squad ${r.depth.squad})`
          + ` | playingOpportunity ${fmt(r.playing)}  O ${fmt(r.O)}  P ${fmt(r.P)}  #${r.rank}`);
      }
      console.log(`  returning-competitor gap ${best.gap}; playingOpportunity difference ${fmt(best.y.playing - best.x.playing)}`);
    }
  }

  if (args.includes('--priority')) {
    const NAMES = ['Furman', 'Princeton', 'UC Irvine', "Saint Mary's", 'VMI', 'UC Davis', 'Rollins', 'Clemson', 'Pittsburgh'];
    const PROFILE = { 1: 'FULLY_DECLARED_LEVEL', 3: 'BALANCED', 5: 'FULLY_DECLARED_PLAYING' };
    const runs = Object.fromEntries(Object.entries(PROFILE).map(([k, pid]) => [k, runFixture('A', pid)]));
    console.log(`${'programme'.padEnd(18)}${'ret'.padStart(5)}${'play'.padStart(8)}` + [1, 3, 5].flatMap((k) => [`O@${k}`.padStart(8), `#@${k}`.padStart(7)]).join(''));
    for (const n of NAMES) {
      const base = runs[1].byName.get(n);
      console.log(`${n.slice(0, 17).padEnd(18)}${String(base.depth.total).padStart(5)}${fmt(base.playing).padStart(8)}`
        + [1, 3, 5].flatMap((k) => {
          const r = runs[k].byName.get(n);
          return [fmt(r.O).padStart(8), String(r.rank).padStart(7)];
        }).join(''));
    }
    console.log('');
    for (const k of [1, 3, 5]) {
      const ok = runs[k].rows.filter((r) => Number.isFinite(r.playing));
      const shares = ok.map((r) => r.playing);
      console.log(`  priority ${k}: corr(playingOpportunity, Opportunity) = ${fmt(corr(shares, ok.map((r) => r.O)))}  corr(playingOpportunity, Pursuit) = ${fmt(corr(shares, ok.map((r) => r.P)))}`);
    }
  }

  if (args.includes('--sensitivity')) {
    /**
     * A NON-PERSISTED illustration only: replace the playingOpportunity
     * component value with an effective-returning-depth factor and re-rank,
     * holding every other layer and the production combination fixed. This is
     * not a proposed formula and nothing is written.
     */
    const { PURSUIT_WEIGHTS, PURSUIT_GATES, tailGate } = await import('../../shared/matching/v2/index.js');
    const W = PURSUIT_WEIGHTS; const G = PURSUIT_GATES;
    for (const [pid, label] of [['FULLY_DECLARED_LEVEL', 'playing priority 1'], ['FULLY_DECLARED_PLAYING', 'playing priority 5']]) {
      const { rows, position } = runFixture('A', pid);
      const ok = rows.filter((r) => r.depth && Number.isFinite(r.playing));
      const norm = (r) => {
        const places = typicalStarters('mens-soccer', position);
        const effective = r.depth.starters + (0.4 * r.depth.squad);
        return Math.max(0, Math.min(1, 1 - (effective / Math.max(1, places * 2))));
      };
      const rescore = ok.map((r) => {
        const share = r.playShareOfO ?? 0.098;
        const O2 = Math.max(0, Math.min(1, r.O + (share * (norm(r) - r.playing))));
        const base = (W.recruitability * r.R) + (W.financial * r.F) + (W.opportunity * O2);
        return { ...r, O2, P2: base * tailGate(r.R, G.recruitability) * tailGate(r.F, G.financial) };
      }).sort((a, b) => b.P2 - a.P2);
      rescore.forEach((r, i) => { r.rank2 = i + 1; });
      const moved = rescore.filter((r) => Math.abs(r.rank2 - r.rank) >= 20);
      console.log(`\n== ${label}: ${moved.length} of ${rescore.length} programmes move 20+ places`);
      const top = rescore.slice(0, 100);
      console.log(`  top-100 median strength ${fmt(med(top.map((r) => r.strength)), 1)} (was ${fmt(med(ok.filter((r) => r.rank <= 100).map((r) => r.strength)), 1)})`);
      console.log(`  top-100 median returning competitors ${med(top.map((r) => r.depth.total))} (was ${med(ok.filter((r) => r.rank <= 100).map((r) => r.depth.total))})`);
      for (const r of rescore.slice(0, 6)) console.log(`    #${String(r.rank2).padStart(3)} (was ${String(r.rank).padStart(3)}) ${r.name.slice(0, 26).padEnd(27)} str ${fmt(r.strength, 1).padStart(5)} returning ${r.depth.total}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
