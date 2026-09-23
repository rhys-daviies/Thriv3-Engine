/**
 * A7.7.3: the four candidate Coach Recruitability architectures, measured.
 *
 * READ-ONLY AND DIAGNOSTIC. Nothing here is wired into a scorer. Every
 * architecture is recomputed from basis objects a normal run produced, plus
 * behavioural signals computed from recruiting_arrivals.
 *
 *   node server/scripts/v2RecruitabilityArchitectures.js --fixtures
 *   node server/scripts/v2RecruitabilityArchitectures.js --fairness
 *   node server/scripts/v2RecruitabilityArchitectures.js --tier3
 */
import db from '../db/client.js';
import { canonicalPosition } from '../../shared/positions.js';
import { normaliseAthlete } from '../../shared/matching/pool.js';
import { buildPositionIndex, buildArrivalIndex, divisionArrivalRates } from '../lib/v2/rosterEvidence.js';
import { runPursuit } from '../lib/v2/pursuitRun.js';
import { isScoreable, CORE_FLOOR, PURSUIT_WEIGHTS, PURSUIT_GATES, tailGate } from '../../shared/matching/v2/index.js';
import { FIXTURES } from './v2Fixtures.js';

const SEASON = '2026';
const R3 = (n) => (Number.isFinite(n) ? n.toFixed(3) : '—');

const AP_STATE = {
  'ala.': 'AL', alaska: 'AK', 'ariz.': 'AZ', 'ark.': 'AR', 'calif.': 'CA', 'colo.': 'CO',
  'conn.': 'CT', 'del.': 'DE', 'fla.': 'FL', 'ga.': 'GA', hawaii: 'HI', idaho: 'ID',
  'ill.': 'IL', 'ind.': 'IN', iowa: 'IA', 'kan.': 'KS', 'kans.': 'KS', 'ky.': 'KY',
  'la.': 'LA', maine: 'ME', 'md.': 'MD', 'mass.': 'MA', 'mich.': 'MI', 'minn.': 'MN',
  'miss.': 'MS', 'mo.': 'MO', 'mont.': 'MT', 'neb.': 'NE', 'nebr.': 'NE', 'nev.': 'NV',
  'n.h.': 'NH', 'n.j.': 'NJ', 'n.m.': 'NM', 'n.y.': 'NY', 'n.c.': 'NC', 'n.d.': 'ND',
  ohio: 'OH', 'okla.': 'OK', 'ore.': 'OR', 'pa.': 'PA', 'r.i.': 'RI', 's.c.': 'SC',
  's.d.': 'SD', 'tenn.': 'TN', texas: 'TX', utah: 'UT', 'vt.': 'VT', 'va.': 'VA',
  'wash.': 'WA', 'w.va.': 'WV', 'wis.': 'WI', 'wyo.': 'WY', 'd.c.': 'DC',
};
const homeState = (h) => {
  if (!h) return null;
  const m = String(h).match(/,\s*([A-Z]{2})\s*$/); if (m) return m[1];
  return AP_STATE[String(h).split(',').pop()?.trim().toLowerCase()] ?? null;
};
const km = (aLat, aLon, bLat, bLon) => {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat); const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

/**
 * EMPIRICAL SHRINKAGE toward the division baseline.
 *
 * A programme with three observations must not produce an extreme conclusion.
 * `k` is the pseudo-count: the rate is pulled toward its division's rate as
 * though the programme had `k` extra arrivals at that rate. k = 10 is roughly
 * one recruiting class, so a programme needs a class of its own before its
 * own behaviour dominates the division's.
 */
export const SHRINK_K = 10;
export const shrink = (hits, trials, baseline) => (trials + SHRINK_K > 0
  ? (hits + (SHRINK_K * baseline)) / (trials + SHRINK_K) : baseline);

function behaviour(sport) {
  const centroids = (() => {
    const rows = db.prepare('SELECT state, latitude, longitude FROM colleges WHERE active = 1 AND latitude IS NOT NULL AND state IS NOT NULL').all();
    const by = new Map();
    for (const r of rows) {
      const e = by.get(r.state) ?? { lat: 0, lon: 0, n: 0 };
      e.lat += r.latitude; e.lon += r.longitude; e.n += 1; by.set(r.state, e);
    }
    return new Map([...by].map(([s, e]) => [s, { lat: e.lat / e.n, lon: e.lon / e.n }]));
  })();

  const rows = db.prepare(`
    SELECT a.programme, a.is_international, r.hometown, c.division, c.latitude, c.longitude
      FROM recruiting_arrivals a
      JOIN roster_players r ON r.id = a.roster_row_id
      JOIN colleges c ON c.name = a.programme AND c.sport = a.sport AND c.active = 1
     WHERE a.sport = ?`).all(sport);

  const acc = new Map(); const div = new Map();
  for (const r of rows) {
    const bump = (m, k) => {
      const e = m.get(k) ?? { n: 0, intl: 0, near: 0, domesticGeo: 0 };
      e.n += 1;
      if (r.is_international === 1) e.intl += 1;
      else {
        const s = homeState(r.hometown); const cen = s ? centroids.get(s) : null;
        if (cen && r.latitude !== null) { e.domesticGeo += 1; if (km(r.latitude, r.longitude, cen.lat, cen.lon) <= 300) e.near += 1; }
      }
      m.set(k, e);
    };
    bump(acc, r.programme); bump(div, r.division);
  }
  const out = new Map();
  for (const [prog, e] of acc) {
    const d = div.get([...rows].find((r) => r.programme === prog)?.division) ?? { n: 1, intl: 0, near: 0, domesticGeo: 1 };
    out.set(prog, {
      arrivals: e.n,
      internationalShare: shrink(e.intl, e.n, d.intl / d.n),
      internationalTrials: e.n,
      nearShare: e.domesticGeo >= 3 ? shrink(e.near, e.domesticGeo, d.near / Math.max(1, d.domesticGeo)) : null,
      nearTrials: e.domesticGeo,
    });
  }
  return out;
}

/**
 * MARKET MATCH. One value, one meaning: how consistent is this athlete's
 * origin with the programme's demonstrated footprint.
 *
 * An international athlete is matched against the international share; a
 * domestic athlete against the near share, using the athlete's own distance.
 * Returns null - never a number - when the programme has too little history.
 */
/**
 * The four candidate architectures, each taking the same inputs.
 *   A = athletic plausibility, P = positional value or null, M = market match or null
 *
 * `null` means UNKNOWN throughout, and how each one treats it is the whole
 * comparison. R-A, R-B and R-D renormalise over what exists, so a programme
 * missing a weak signal is scored as though only the strong one applied. R-C
 * gives each signal its own slice of the range and an unknown signal simply
 * contributes nothing to it.
 */
export const ARCHITECTURES = {
  'CURRENT  A x (phi + (1-phi)P)': ({ A, P }) => (P === null ? null : A * (CORE_FLOOR + ((1 - CORE_FLOOR) * P))),
  'R-A weighted core': ({ A, P, M }) => {
    const parts = [[0.7, P], [0.3, M]].filter(([, v]) => v !== null);
    if (!parts.length) return null;
    const w = parts.reduce((s, [x]) => s + x, 0);
    return A * (CORE_FLOOR + ((1 - CORE_FLOOR) * (parts.reduce((s, [x, v]) => s + (x * v), 0) / w)));
  },
  'R-B evidence-renormalised': ({ A, P, M }) => {
    const parts = [[0.7, P], [0.3, M]].filter(([, v]) => v !== null);
    if (!parts.length) return null;
    const w = parts.reduce((s, [x]) => s + x, 0);
    return A * (CORE_FLOOR + ((1 - CORE_FLOOR) * (parts.reduce((s, [x, v]) => s + (x * v), 0) / w)));
  },
  'R-C baseline + modifiers': ({ A, P, M }) => {
    let v = A * CORE_FLOOR;
    if (P !== null) v += A * (1 - CORE_FLOOR) * 0.7 * P;
    if (M !== null) v += A * (1 - CORE_FLOOR) * 0.3 * M;
    return v;
  },
  'R-D positive/negative/unknown': ({ A, P, M }) => {
    const pos = [P, M].filter((v) => v !== null && v >= 0.5).length;
    const neg = [P, M].filter((v) => v !== null && v < 0.2).length;
    if (![P, M].some((v) => v !== null)) return null;
    return A * Math.min(1, Math.max(0.1, 0.45 + (0.25 * pos) - (0.2 * neg)));
  },
};

/**
 * R-C WITH AN EVIDENCE FLOOR. The recommended variant.
 *
 * R-C alone is scoreable whenever athletic plausibility is, which would undo
 * the A7.3 refusal that athletic plausibility alone is not a recruitability
 * score - the NJCAA case, where we can say an athlete is plainly good enough
 * and nothing at all about whether the programme would take one. Requiring at
 * least one behavioural signal keeps both properties: unknown contributes
 * nothing, and no behaviour at all still refuses.
 */
export const R_C_WITH_FLOOR = ({ A, P, M }) => (P === null && M === null
  ? null : ARCHITECTURES['R-C baseline + modifiers']({ A, P, M }));

export function marketMatch({ athleteIsInternational, distanceKm, prog }) {
  if (!prog || prog.arrivals < 8) return null;
  if (athleteIsInternational) return prog.internationalShare;
  if (prog.nearShare === null || distanceKm === null) return null;
  // Near athletes are evidenced by a local footprint; far athletes by a broad one.
  return distanceKm <= 300 ? prog.nearShare : 1 - prog.nearShare;
}

function runFixture(f, ctxCache) {
  const sport = f.player.sport;
  if (!ctxCache.has(sport)) {
    const colleges = db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport);
    const roster = db.prepare(`
      SELECT college_name, player_name, position, minutes_played, projected_minutes,
             games_started, projected_games_started,
             estimated_graduation_year, eligibility_end_year, country, season, division, class_year_label
        FROM roster_players WHERE sport = ? AND season = ?`).all(sport, SEASON);
    const arr = db.prepare('SELECT programme, sport, arrival_season, canonical_position, is_international FROM recruiting_arrivals WHERE sport = ?').all(sport);
    ctxCache.set(sport, {
      colleges,
      rosterProgrammes: new Set(roster.map((r) => r.college_name)),
      rosterIndex: buildPositionIndex(roster),
      arrivalIndex: buildArrivalIndex(arr),
      divisionArrivals: divisionArrivalRates(arr, new Map(colleges.map((c) => [c.name, c]))),
      arrivalsHorizon: arr.reduce((m, r) => Math.max(m, Number(r.arrival_season) || 0), 0),
      behaviour: behaviour(sport),
    });
  }
  const ctx = ctxCache.get(sport);
  const position = canonicalPosition(f.player.position);
  const v1Shape = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
  const athlete = {
    label: { id: f.id }, v1Shape,
    recruitability: { sport, rating: f.player.football_ability, position, entryYear: f.player.recruiting_class_year, isInternational: f.player.origin === 'International' },
    opportunity: { sport, position, rating: f.player.football_ability, intendedMajor: null, priorityRanking: null, competitiveLevelPriority: null, playingOpportunityPriority: null },
  };
  const rep = runPursuit({ athlete, sport, colleges: ctx.colleges, ctx });
  return { rep, ctx, sport, position, athlete };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('Usage: --fixtures | --fairness | --tier3'); process.exit(2); }
  const cache = new Map();
  const W = PURSUIT_WEIGHTS; const G = PURSUIT_GATES;
  const priority = (R, F, O) => ((W.recruitability * R) + (W.financial * F) + (W.opportunity * O))
    * tailGate(R, G.recruitability) * tailGate(F, G.financial);

  /**
   * The four architectures, each taking the same inputs.
   *   A = athletic plausibility, P = positional value or null, M = market match or null
   */
  const ARCH = { ...ARCHITECTURES, 'R-C + evidence floor': R_C_WITH_FLOOR };

  if (args.includes('--fixtures') || args.includes('--tier3')) {
    for (const f of FIXTURES) {
      const { rep, ctx, sport } = runFixture(f, cache);
      const byId = new Map(ctx.colleges.map((c) => [c.id, c]));
      const isIntl = f.player.origin === 'International';
      const centroid = (() => {
        const s = f.player.state; if (!s) return null;
        const rows = db.prepare('SELECT AVG(latitude) la, AVG(longitude) lo FROM colleges WHERE active = 1 AND state = ?').get(s);
        return rows?.la ? rows : null;
      })();

      const all = [...rep.pipeline.ranked, ...rep.pipeline.limited].map((e) => {
        const c = byId.get(e.id);
        const rOk = isScoreable(e.recruitability);
        const b = rOk ? e.recruitability.basis : (e.recruitability.detail ?? {});
        const P = rOk && b.positional ? Math.min(1, Math.max(0, (b.positional.expectedNewcomerPlaces - b.positional.claims) / b.positional.typicalStarters)) : null;
        const dist = (!isIntl && centroid && c.latitude !== null) ? km(c.latitude, c.longitude, centroid.la, centroid.lo) : null;
        const M = marketMatch({ athleteIsInternational: isIntl, distanceKm: dist, prog: ctx.behaviour.get(c.name) });
        return {
          id: e.id, name: e.name, division: e.division, soccerScore: c.soccer_score,
          A: b.athleticPlausibility ?? null, P, M,
          F: isScoreable(e.financial) ? e.financial.value : null,
          O: isScoreable(e.opportunity) ? e.opportunity.value : null,
          state: e.rankingState,
        };
      });

      if (args.includes('--tier3')) {
        const t3 = all.filter((x) => x.P === null && x.A !== null);
        const rescued = t3.filter((x) => x.M !== null);
        console.log(`${f.id.split('-')[0].padEnd(3)} ${sport === 'womens-soccer' ? 'W' : 'M'}  pool ${String(all.length).padStart(4)}  positional UNSCOREABLE ${String(t3.length).padStart(4)}  of those with market evidence ${String(rescued.length).padStart(4)}  still unscoreable ${t3.length - rescued.length}`);
        continue;
      }

      console.log(`\n== ${f.id} ==`);
      console.log(`  ${'architecture'.padEnd(32)}${'ranked'.padStart(8)}${'MITrank'.padStart(9)}${'corr(s,P)'.padStart(11)}${'top10 maxStr'.padStart(14)}${'top10 minR'.padStart(12)}${'eliteTop25'.padStart(12)}`);
      for (const [name, fn] of Object.entries(ARCH)) {
        const scored = all.map((x) => {
          if (x.A === null || x.F === null || x.O === null) return null;
          const R = fn(x); if (R === null) return null;
          return { ...x, R, P2: priority(R, x.F, x.O) };
        }).filter(Boolean).sort((a, b) => b.P2 - a.P2);
        scored.forEach((x, i) => { x.rank = i + 1; });
        const mit = scored.find((x) => x.name === 'MIT');
        const t10 = scored.slice(0, 10);
        const withS = scored.filter((x) => typeof x.soccerScore === 'number');
        const mx = withS.map((x) => x.soccerScore); const py = withS.map((x) => x.P2);
        const c = (() => {
          const n = mx.length; const ma = mx.reduce((a, b) => a + b, 0) / n; const mb = py.reduce((a, b) => a + b, 0) / n;
          let s = 0; let va = 0; let vb = 0;
          for (let i = 0; i < n; i += 1) { const d = mx[i] - ma; const e = py[i] - mb; s += d * e; va += d * d; vb += e * e; }
          return s / Math.sqrt(va * vb);
        })();
        const eliteTop25 = scored.slice(0, 25).filter((x) => (x.soccerScore ?? 0) >= 60).length;
        console.log(`  ${name.padEnd(32)}${String(scored.length).padStart(8)}${String(mit ? `#${mit.rank}` : '—').padStart(9)}${R3(c).padStart(11)}${R3(Math.max(...t10.map((x) => x.soccerScore ?? 0))).padStart(14)}${R3(Math.min(...t10.map((x) => x.R))).padStart(12)}${String(eliteTop25).padStart(12)}`);
      }
    }
  }

  if (args.includes('--fairness')) {
    console.log('== MISSING-DATA FAIRNESS ==');
    console.log('  Two programmes, identical but for their positional evidence.');
    console.log('  A: measured LOW positional demand (0.05) + strong market match (0.8)');
    console.log('  B: UNKNOWN positional demand      + strong market match (0.8)');
    console.log('');
    const A = { A: 1, P: 0.05, M: 0.8 }; const B = { A: 1, P: null, M: 0.8 };
    console.log(`  ${'architecture'.padEnd(32)}${'R(A)'.padStart(8)}${'R(B)'.padStart(8)}${'  verdict'}`);
    for (const [name, fn] of Object.entries(ARCH)) {
      const ra = fn(A); const rb = fn(B);
      let verdict;
      if (rb === null) verdict = 'B leaves the ranked list — unknown is not a number';
      else if (rb > ra) verdict = `B OUTRANKS A by ${R3(rb - ra)} — missing evidence REWARDED`;
      else verdict = 'B does not outrank A';
      console.log(`  ${name.padEnd(32)}${R3(ra).padStart(8)}${R3(rb).padStart(8)}  ${verdict}`);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('v2RecruitabilityArchitectures.js')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
