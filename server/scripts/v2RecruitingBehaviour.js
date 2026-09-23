/**
 * A7.7.3: what recruiting behaviour can actually be measured, and how well.
 *
 * READ-ONLY AND DIAGNOSTIC. It computes candidate signals and their
 * reliability; it changes no scorer and proposes nothing by itself.
 *
 *   node server/scripts/v2RecruitingBehaviour.js --signals --reliability
 *   node server/scripts/v2RecruitingBehaviour.js --geography
 *   node server/scripts/v2RecruitingBehaviour.js --international
 *   node server/scripts/v2RecruitingBehaviour.js --confounds
 *   node server/scripts/v2RecruitingBehaviour.js --coach --position
 *
 * EVERY RATE IS HELD TO THE SAME STANDARD A7.3 SET: split-half reliability
 * across two halves of its own history, and a measured confound against
 * programme strength and sample size. A rate that does not agree with itself
 * cannot carry a ranking, whatever it appears to say.
 */
import db from '../db/client.js';

const SPORTS = ['mens-soccer', 'womens-soccer'];
const R = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');

function corr(x, y) {
  const n = x.length; if (n < 3) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n; const my = y.reduce((a, b) => a + b, 0) / n;
  let c = 0; let vx = 0; let vy = 0;
  for (let i = 0; i < n; i += 1) { const d = x[i] - mx; const e = y[i] - my; c += d * e; vx += d * d; vy += e * e; }
  return (vx === 0 || vy === 0) ? null : c / Math.sqrt(vx * vy);
}

/** Haversine, kilometres. */
function km(aLat, aLon, bLat, bLon) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat); const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * State centroids, built from the colleges we already hold coordinates for.
 *
 * NOT a geocoder. Thriv3 holds `hometown` as free text ("Madison, WI") and no
 * coordinates for it, so the finest honest resolution is the state. Using the
 * mean position of every college in a state gives a real distance in
 * kilometres with a known error - the within-state spread, reported below -
 * and avoids the border artefact that a pure same-state test would create.
 */
function stateCentroids() {
  const rows = db.prepare('SELECT state, latitude, longitude FROM colleges WHERE active = 1 AND latitude IS NOT NULL AND state IS NOT NULL').all();
  const by = new Map();
  for (const r of rows) {
    const e = by.get(r.state) ?? { lat: 0, lon: 0, n: 0, pts: [] };
    e.lat += r.latitude; e.lon += r.longitude; e.n += 1; e.pts.push([r.latitude, r.longitude]);
    by.set(r.state, e);
  }
  const out = new Map();
  for (const [state, e] of by) {
    const lat = e.lat / e.n; const lon = e.lon / e.n;
    const spread = e.pts.map(([a, b]) => km(lat, lon, a, b)).sort((a, b) => a - b);
    out.set(state, { lat, lon, n: e.n, medianSpread: spread[Math.floor(spread.length / 2)] });
  }
  return out;
}

const STATE = /,\s*([A-Z]{2})\s*$/;

/**
 * AP-style state abbreviations, which is what the NCAA stats pages actually
 * print: "Madison, Wis.", "Croton on Hudson, N.Y.", "Sacramento, Calif.".
 *
 * Found by reading the rows the two-letter rule missed: 23,636 of 30,287
 * domestic men's arrivals, which is 78% of them. A geography finding built on
 * the remaining 22% would have been a finding about which schools happen to
 * publish postal codes.
 */
const AP_STATE = {
  'ala.': 'AL', 'alaska': 'AK', 'ariz.': 'AZ', 'ark.': 'AR', 'calif.': 'CA', 'colo.': 'CO',
  'conn.': 'CT', 'del.': 'DE', 'fla.': 'FL', 'ga.': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'ill.': 'IL', 'ind.': 'IN', 'iowa': 'IA', 'kan.': 'KS', 'kans.': 'KS', 'ky.': 'KY',
  'la.': 'LA', 'maine': 'ME', 'md.': 'MD', 'mass.': 'MA', 'mich.': 'MI', 'minn.': 'MN',
  'miss.': 'MS', 'mo.': 'MO', 'mont.': 'MT', 'neb.': 'NE', 'nebr.': 'NE', 'nev.': 'NV',
  'n.h.': 'NH', 'n.j.': 'NJ', 'n.m.': 'NM', 'n.mex.': 'NM', 'n.y.': 'NY', 'n.c.': 'NC',
  'n.d.': 'ND', 'ohio': 'OH', 'okla.': 'OK', 'ore.': 'OR', 'pa.': 'PA', 'r.i.': 'RI',
  's.c.': 'SC', 's.d.': 'SD', 'tenn.': 'TN', 'texas': 'TX', 'utah': 'UT', 'vt.': 'VT',
  'va.': 'VA', 'wash.': 'WA', 'w.va.': 'WV', 'wis.': 'WI', 'wyo.': 'WY', 'd.c.': 'DC',
};
const FULL_STATE = Object.fromEntries(Object.entries({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
}).map(([abbr, name]) => [name.toLowerCase(), abbr]));
const homeState = (hometown) => {
  if (!hometown) return null;
  const m = String(hometown).match(STATE);
  if (m) return m[1];
  const tail = String(hometown).split(',').pop()?.trim().toLowerCase();
  return AP_STATE[tail] ?? FULL_STATE[tail] ?? null;
};

/**
 * Every arrival, with the programme's own location and the recruit's home
 * state, for the four seasons we hold.
 */
function arrivals(sport) {
  return db.prepare(`
    SELECT a.programme, a.arrival_season AS season, a.entry_type, a.coach, a.coach_attribution,
           a.canonical_position AS position, a.is_international, a.region, a.country,
           r.hometown, r.id AS rosterId,
           c.division, c.state AS collegeState, c.latitude, c.longitude, c.soccer_score
      FROM recruiting_arrivals a
      JOIN roster_players r ON r.id = a.roster_row_id
      JOIN colleges c ON c.name = a.programme AND c.sport = a.sport AND c.active = 1
     WHERE a.sport = ?`).all(sport);
}

/** Split-half by season parity: does the programme behave the same way in different years? */
function splitHalf(rows, keyOf, valueOf, { minPerHalf = 5, label = '' } = {}) {
  const by = new Map();
  for (const r of rows) {
    const k = keyOf(r); if (k === null || k === undefined) continue;
    const half = Number(r.season) % 2;
    const e = by.get(k) ?? [[], []];
    e[half].push(r); by.set(k, e);
  }
  const a = []; const b = [];
  for (const [, [h0, h1]] of by) {
    if (h0.length < minPerHalf || h1.length < minPerHalf) continue;
    const v0 = valueOf(h0); const v1 = valueOf(h1);
    if (v0 === null || v1 === null) continue;
    a.push(v0); b.push(v1);
  }
  const r = corr(a, b);
  return { label, units: a.length, r, verdict: r === null ? 'NONE' : r >= 0.5 ? 'USABLE' : r >= 0.3 ? 'MARGINAL' : 'REJECT' };
}

/** Programme-level value of each candidate signal over a set of arrival rows. */
const SIGNALS = {
  freshmanShare: (rows) => {
    const t = rows.filter((r) => r.entry_type === 'FRESHMAN' || r.entry_type === 'EXPERIENCED');
    return t.length ? t.filter((r) => r.entry_type === 'FRESHMAN').length / t.length : null;
  },
  newcomerVolumePerSeason: (rows) => {
    const seasons = new Set(rows.map((r) => r.season));
    return seasons.size ? rows.length / seasons.size : null;
  },
  internationalArrivalShare: (rows) => (rows.length ? rows.filter((r) => r.is_international === 1).length / rows.length : null),
  sameStateShare: (rows) => {
    const d = rows.filter((r) => r.is_international !== 1 && homeState(r.hometown));
    return d.length ? d.filter((r) => homeState(r.hometown) === r.collegeState).length / d.length : null;
  },
  medianRecruitDistanceKm: (rows, ctx) => {
    const ds = [];
    for (const r of rows) {
      if (r.is_international === 1) continue;
      const s = homeState(r.hometown); if (!s) continue;
      const cen = ctx.centroids.get(s); if (!cen || r.latitude === null) continue;
      ds.push(km(r.latitude, r.longitude, cen.lat, cen.lon));
    }
    if (!ds.length) return null;
    ds.sort((a, b) => a - b);
    return ds[Math.floor(ds.length / 2)];
  },
  within300kmShare: (rows, ctx) => {
    const ds = [];
    for (const r of rows) {
      if (r.is_international === 1) continue;
      const s = homeState(r.hometown); if (!s) continue;
      const cen = ctx.centroids.get(s); if (!cen || r.latitude === null) continue;
      ds.push(km(r.latitude, r.longitude, cen.lat, cen.lon));
    }
    return ds.length ? ds.filter((d) => d <= 300).length / ds.length : null;
  },
};

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('Usage: v2RecruitingBehaviour.js [--signals] [--reliability] [--geography] [--international] [--confounds] [--coach] [--position]'); process.exit(2); }
  const centroids = stateCentroids();
  const ctx = { centroids };

  if (args.includes('--geography')) {
    const spreads = [...centroids.values()].map((c) => c.medianSpread).sort((a, b) => a - b);
    console.log('== STATE CENTROID RESOLUTION ==');
    console.log(`  ${centroids.size} states with colleges. Median within-state spread from the centroid:`);
    console.log(`    p25 ${R(spreads[Math.floor(spreads.length * 0.25)], 0)} km  median ${R(spreads[Math.floor(spreads.length / 2)], 0)} km  p75 ${R(spreads[Math.floor(spreads.length * 0.75)], 0)} km`);
    console.log('  So a distance computed this way is accurate to roughly a state radius, and');
    console.log('  is a better instrument than a same-state flag only where programmes recruit');
    console.log('  across borders at short range. Both are measured below.');
    console.log('');
  }

  for (const sport of SPORTS) {
    const rows = arrivals(sport);
    const byProg = new Map();
    for (const r of rows) {
      const k = r.programme;
      const e = byProg.get(k) ?? []; e.push(r); byProg.set(k, e);
    }
    console.log(`\n######## ${sport} — ${rows.length} arrivals across ${byProg.size} programmes ########`);

    if (args.includes('--signals')) {
      console.log('\n== CANDIDATE SIGNAL COVERAGE ==');
      console.log(`  ${'signal'.padEnd(28)}${'programmes'.padStart(11)}${'p10'.padStart(9)}${'median'.padStart(9)}${'p90'.padStart(9)}`);
      for (const [name, fn] of Object.entries(SIGNALS)) {
        const vals = [...byProg.values()].filter((v) => v.length >= 10).map((v) => fn(v, ctx)).filter((v) => v !== null).sort((a, b) => a - b);
        if (!vals.length) { console.log(`  ${name.padEnd(28)}${'0'.padStart(11)}`); continue; }
        const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
        console.log(`  ${name.padEnd(28)}${String(vals.length).padStart(11)}${R(q(0.1), 2).padStart(9)}${R(q(0.5), 2).padStart(9)}${R(q(0.9), 2).padStart(9)}`);
      }
    }

    if (args.includes('--reliability')) {
      console.log('\n== SPLIT-HALF RELIABILITY (odd vs even arrival seasons) ==');
      console.log(`  ${'signal'.padEnd(28)}${'units'.padStart(7)}${'r'.padStart(9)}  verdict`);
      for (const [name, fn] of Object.entries(SIGNALS)) {
        const s = splitHalf(rows, (r) => r.programme, (v) => fn(v, ctx), { minPerHalf: 5, label: name });
        console.log(`  ${name.padEnd(28)}${String(s.units).padStart(7)}${R(s.r).padStart(9)}  ${s.verdict}`);
      }
      console.log('  volume-free variants, to separate behaviour from squad size:');
      for (const [name, fn] of [
        ['newcomerPerRosterRow', (v) => {
          const prog = v[0]?.programme; const sportv = sport;
          const size = db.prepare("SELECT COUNT(*) n FROM roster_players WHERE college_name = ? AND sport = ? AND season = '2026'").get(prog, sportv).n;
          const seasons = new Set(v.map((r) => r.season)).size;
          return size > 0 && seasons > 0 ? (v.length / seasons) / size : null;
        }],
      ]) {
        const s = splitHalf(rows, (r) => r.programme, fn, { minPerHalf: 5, label: name });
        console.log(`  ${name.padEnd(28)}${String(s.units).padStart(7)}${R(s.r).padStart(9)}  ${s.verdict}`);
      }
    }

    if (args.includes('--international')) {
      console.log('\n== INTERNATIONAL: ARRIVAL vs PRESENCE vs UTILISATION ==');
      const util = db.prepare(`
        SELECT r.college_name AS programme,
               COUNT(*) rows,
               SUM(CASE WHEN r.country IS NOT NULL AND r.country != '' AND r.country != 'USA' THEN 1 ELSE 0 END) intlRows,
               SUM(COALESCE(r.minutes_played, r.projected_minutes, 0)) totalMin,
               SUM(CASE WHEN r.country IS NOT NULL AND r.country != '' AND r.country != 'USA'
                        THEN COALESCE(r.minutes_played, r.projected_minutes, 0) ELSE 0 END) intlMin,
               SUM(CASE WHEN COALESCE(r.minutes_played, r.projected_minutes, 0) >= 600
                         OR COALESCE(r.games_started, r.projected_games_started, 0) >= 7 THEN 1 ELSE 0 END) starters,
               SUM(CASE WHEN (r.country IS NOT NULL AND r.country != '' AND r.country != 'USA')
                         AND (COALESCE(r.minutes_played, r.projected_minutes, 0) >= 600
                          OR COALESCE(r.games_started, r.projected_games_started, 0) >= 7) THEN 1 ELSE 0 END) intlStarters
          FROM roster_players r
         WHERE r.sport = ? AND r.season = '2026'
         GROUP BY r.college_name`).all(sport);
      const u = new Map(util.map((x) => [x.programme, x]));
      const cmp = [];
      for (const [prog, v] of byProg) {
        if (v.length < 10) continue;
        const arr = SIGNALS.internationalArrivalShare(v);
        const x = u.get(prog); if (!x || x.rows < 10) continue;
        cmp.push({
          prog,
          arrivalShare: arr,
          rosterShare: x.intlRows / x.rows,
          minutesShare: x.totalMin > 0 ? x.intlMin / x.totalMin : null,
          starterShare: x.starters > 0 ? x.intlStarters / x.starters : null,
        });
      }
      const ok = cmp.filter((c) => c.minutesShare !== null && c.starterShare !== null);
      console.log(`  programmes with both arrival and roster evidence: ${ok.length}`);
      const pair = (a, b) => R(corr(ok.map((x) => x[a]), ok.map((x) => x[b])));
      console.log(`    corr(arrivalShare, rosterShare)   ${pair('arrivalShare', 'rosterShare')}`);
      console.log(`    corr(arrivalShare, minutesShare)  ${pair('arrivalShare', 'minutesShare')}`);
      console.log(`    corr(arrivalShare, starterShare)  ${pair('arrivalShare', 'starterShare')}`);
      console.log(`    corr(rosterShare, minutesShare)   ${pair('rosterShare', 'minutesShare')}`);
      console.log(`    corr(rosterShare, starterShare)   ${pair('rosterShare', 'starterShare')}`);
      console.log(`    corr(minutesShare, starterShare)  ${pair('minutesShare', 'starterShare')}`);
      /** The question section 12 asks: does utilisation add anything arrivals do not already say? */
      const resid = ok.map((x) => x.minutesShare - x.rosterShare);
      resid.sort((a, b) => a - b);
      console.log(`    minutesShare - rosterShare: p10 ${R(resid[Math.floor(resid.length * 0.1)], 2)}  median ${R(resid[Math.floor(resid.length / 2)], 2)}  p90 ${R(resid[Math.floor(resid.length * 0.9)], 2)}`);
      const gap = ok.filter((x) => x.rosterShare >= 0.2 && x.minutesShare < x.rosterShare * 0.6).length;
      console.log(`    programmes with >=20% international on the roster but <60% of that share of minutes: ${gap} (${R((gap / ok.length) * 100, 1)}%)`);
      const sh = splitHalf(rows, (r) => r.programme, SIGNALS.internationalArrivalShare, { minPerHalf: 5 });
      console.log(`    split-half of internationalArrivalShare: units ${sh.units}, r ${R(sh.r)} ${sh.verdict}`);
      console.log('\n  by region, arrivals held:');
      for (const r of db.prepare("SELECT region, COUNT(*) n, COUNT(DISTINCT programme) progs FROM recruiting_arrivals WHERE sport = ? AND region IS NOT NULL AND region != '' GROUP BY region ORDER BY n DESC").all(sport)) {
        const perProg = r.n / r.progs;
        console.log(`    ${String(r.region).padEnd(16)} arrivals ${String(r.n).padStart(6)}  programmes ${String(r.progs).padStart(5)}  mean per programme ${R(perProg, 1)}${perProg < 3 ? '   <- anecdotal per programme' : ''}`);
      }
    }

    if (args.includes('--geography')) {
      console.log('\n== DOMESTIC GEOGRAPHIC FOOTPRINT ==');
      const withState = rows.filter((r) => r.is_international !== 1 && homeState(r.hometown));
      console.log(`  domestic arrivals with a readable home state: ${withState.length} of ${rows.filter((r) => r.is_international !== 1).length}`);
      for (const [name, fn] of [['sameStateShare', SIGNALS.sameStateShare], ['medianRecruitDistanceKm', SIGNALS.medianRecruitDistanceKm], ['within300kmShare', SIGNALS.within300kmShare]]) {
        const s = splitHalf(rows, (r) => r.programme, (v) => fn(v, ctx), { minPerHalf: 5 });
        console.log(`    ${name.padEnd(26)} units ${String(s.units).padStart(5)}  split-half r ${R(s.r)}  ${s.verdict}`);
      }
      console.log('  distance distribution of domestic arrivals (state-centroid km):');
      const all = [];
      for (const r of withState) {
        const cen = centroids.get(homeState(r.hometown)); if (!cen || r.latitude === null) continue;
        all.push(km(r.latitude, r.longitude, cen.lat, cen.lon));
      }
      all.sort((a, b) => a - b);
      const q = (p) => all[Math.floor(p * all.length)];
      console.log(`    p10 ${R(q(0.1), 0)}  p25 ${R(q(0.25), 0)}  median ${R(q(0.5), 0)}  p75 ${R(q(0.75), 0)}  p90 ${R(q(0.9), 0)} km`);
      console.log(`    within 300km ${R((all.filter((d) => d <= 300).length / all.length) * 100, 1)}%  within 800km ${R((all.filter((d) => d <= 800).length / all.length) * 100, 1)}%`);
      const same = withState.filter((r) => homeState(r.hometown) === r.collegeState).length;
      console.log(`    same state ${R((same / withState.length) * 100, 1)}%`);
      console.log('  by division (median distance, same-state share):');
      for (const d of [...new Set(withState.map((r) => r.division))].sort()) {
        const sub = withState.filter((r) => r.division === d);
        const ds = sub.map((r) => { const c = centroids.get(homeState(r.hometown)); return c && r.latitude !== null ? km(r.latitude, r.longitude, c.lat, c.lon) : null; }).filter((x) => x !== null).sort((a, b) => a - b);
        const ss = sub.filter((r) => homeState(r.hometown) === r.collegeState).length / sub.length;
        console.log(`    ${d.padEnd(10)} n ${String(sub.length).padStart(6)}  median ${R(ds[Math.floor(ds.length / 2)], 0).padStart(5)} km  same-state ${R(ss * 100, 1)}%`);
      }
    }

    if (args.includes('--confounds')) {
      console.log('\n== CONFOUNDS AND DOUBLE COUNTING ==');
      const progs = [...byProg.entries()].filter(([, v]) => v.length >= 10);
      const size = new Map(db.prepare("SELECT college_name, COUNT(*) n FROM roster_players WHERE sport = ? AND season = '2026' GROUP BY college_name").all(sport).map((r) => [r.college_name, r.n]));
      const table = progs.map(([prog, v]) => ({
        prog,
        strength: v[0].soccer_score,
        rosterSize: size.get(prog) ?? null,
        freshmanShare: SIGNALS.freshmanShare(v),
        volume: SIGNALS.newcomerVolumePerSeason(v),
        intl: SIGNALS.internationalArrivalShare(v),
        sameState: SIGNALS.sameStateShare(v),
        dist: SIGNALS.medianRecruitDistanceKm(v, ctx),
      })).filter((x) => x.strength !== null && x.rosterSize !== null);
      const keys = ['strength', 'rosterSize', 'freshmanShare', 'volume', 'intl', 'sameState', 'dist'];
      console.log(`  n = ${table.length} programmes`);
      console.log(`  ${''.padEnd(16)}${keys.map((k) => k.slice(0, 11).padStart(12)).join('')}`);
      for (const a of keys) {
        const line = keys.map((b) => {
          const pairs = table.filter((x) => Number.isFinite(x[a]) && Number.isFinite(x[b]));
          return R(corr(pairs.map((x) => x[a]), pairs.map((x) => x[b])), 2).padStart(12);
        }).join('');
        console.log(`  ${a.padEnd(16)}${line}`);
      }
    }

    if (args.includes('--coach')) {
      console.log('\n== PROGRAMME vs COACH ==');
      for (const [name, fn] of Object.entries(SIGNALS)) {
        const p = splitHalf(rows, (r) => r.programme, (v) => fn(v, ctx), { minPerHalf: 5 });
        const c = splitHalf(rows.filter((r) => r.coach), (r) => r.coach, (v) => fn(v, ctx), { minPerHalf: 5 });
        console.log(`  ${name.padEnd(28)} programme r ${R(p.r).padStart(7)} (${String(p.units).padStart(4)})   coach r ${R(c.r).padStart(7)} (${String(c.units).padStart(4)})`);
      }
    }

    if (args.includes('--position')) {
      console.log('\n== POSITION-SPECIFIC ==');
      for (const [name, fn] of [['freshmanShare', SIGNALS.freshmanShare], ['internationalArrivalShare', SIGNALS.internationalArrivalShare], ['sameStateShare', SIGNALS.sameStateShare]]) {
        const s = splitHalf(rows.filter((r) => r.position), (r) => `${r.programme}|${r.position}`, (v) => fn(v, ctx), { minPerHalf: 5 });
        console.log(`  ${name.padEnd(28)} programme x position: units ${String(s.units).padStart(5)}  r ${R(s.r)}  ${s.verdict}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
