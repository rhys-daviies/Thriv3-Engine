/**
 * L7ZA — what PROGRAMME_POOL_BENCHMARK actually depends on.
 *
 *   RECRUITMATCH_DB=/path/to/a/COPY.sqlite node server/scripts/poolBenchmarkAudit.js
 *
 * L7Y changed six 2025 programme-seasons and moved internal Evidence for 864
 * athlete-programme pairs. That is either correct behaviour for a relative
 * benchmark or a coupling nobody chose, and the difference is a measurement
 * rather than an opinion. This reports the measurements.
 *
 * READ-ONLY BY DEFAULT. The isolation and fan-out sections need to perturb
 * roster rows to see what moves, so they run inside a transaction that is
 * always rolled back, and they refuse to run at all unless
 * THRIV3_POOL_AUDIT_ALLOW_WRITES=1 — which exists so that pointing this at the
 * working database by accident cannot mutate it.
 */
import db from '../db/client.js';
import { buildPoolBenchmarks } from '../lib/philosophyQueries.js';
import { SEASONS, SQUAD_SEASON } from '../../shared/philosophy.js';

const SPORTS = ['womens-soccer', 'mens-soccer'];
const MAY_PERTURB = process.env.THRIV3_POOL_AUDIT_ALLOW_WRITES === '1';

const line = (s = '') => console.log(s);
const head = (s) => { line(); line(`=== ${s} ===`); };

/** The pool's answer, reduced to the numbers a caller can be affected by. */
function shape(sport) {
  const b = buildPoolBenchmarks(sport);
  return {
    sufficient: b.sufficient,
    programmes: b.programmes,
    observations: b.observations,
    readable: b.readable,
    ladder: (b.ladderByRank ?? []).map((r) => [r.rank, r.n, r.p25, r.median, r.p75]),
    dials: b.dials,
  };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Run `fn` against a perturbed database, then roll the perturbation back. */
function perturbed(mutate, fn) {
  if (!MAY_PERTURB) throw new Error('set THRIV3_POOL_AUDIT_ALLOW_WRITES=1 and point at a COPY');
  db.exec('BEGIN');
  try {
    mutate();
    return fn();
  } finally {
    db.exec('ROLLBACK');
  }
}

/* -------------------------------------------------------------------------- */

head('POPULATION AND WEIGHTING');
{
  const rows = db.prepare(
    `SELECT college_name, sport, COUNT(DISTINCT season) seasons, COUNT(*) players
     FROM roster_players WHERE season IN (${SEASONS.map(() => '?').join(',')})
     GROUP BY 1,2`,
  ).all(...SEASONS);
  const bySeasons = new Map();
  for (const r of rows) bySeasons.set(r.seasons, (bySeasons.get(r.seasons) ?? 0) + 1);
  line(`  pooled programme-sports              ${rows.length}`);
  line(`  seasons held per programme           ${[...bySeasons].sort((a, b) => a[0] - b[0])
    .map(([s, n]) => `${s}:${n}`).join('  ')}`);
  for (const sport of SPORTS) {
    const s = shape(sport);
    line(`  ${sport.padEnd(16)} programmes ${String(s.programmes).padStart(5)}`
      + `   ladder n (rank 1) ${String(s.ladder[0]?.[1]).padStart(5)}`
      + `   dial observations ${String(s.readable).padStart(5)}`);
  }
  line('  => ladderByRank takes ONE median per programme per rank: equal weight.');
  line('  => dials take one value per readable position-season: a programme with');
  line('     more seasons or more position groups contributes more.');
}

head('SEASON WINDOW');
line(`  SEASONS (pooled)     ${SEASONS.join(', ')}`);
line(`  SQUAD_SEASON (not)   ${SQUAD_SEASON}`);
{
  const q = db.prepare('SELECT COUNT(*) n FROM roster_players WHERE season = ?');
  for (const s of [...SEASONS, SQUAD_SEASON]) {
    line(`    ${s}  ${String(q.get(s).n).padStart(7)} rows   ${SEASONS.includes(s) ? 'IN POOL' : 'excluded'}`);
  }
}

head('PROGRAMME STATUS AND ACTIVITY');
{
  const pooled = `SELECT DISTINCT college_name, sport FROM roster_players
                  WHERE season IN (${SEASONS.map(() => '?').join(',')})`;
  const inactive = db.prepare(
    `WITH p AS (${pooled}) SELECT c.name, c.sport, c.division FROM p
     JOIN colleges c ON c.name = p.college_name AND c.sport = p.sport WHERE c.active = 0`,
  ).all(...SEASONS);
  const statused = db.prepare(
    `WITH p AS (${pooled}) SELECT s.school, s.sport, s.status FROM p
     JOIN programme_status s ON s.school = p.college_name AND s.sport = p.sport`,
  ).all(...SEASONS);
  line(`  pooled programmes with colleges.active = 0   ${inactive.length}`
    + (inactive.length ? `  (${inactive.map((r) => `${r.name}/${r.sport}`).join(', ')})` : ''));
  line(`  pooled programmes carrying programme_status  ${statused.length}`);
  line('  => the pool query filters on sport and season only. No division, no');
  line('     colleges.active, no programme_status. Nothing excludes them.');
}

head('BOUNDARY SENSITIVITY — how many programmes sit on a threshold');
for (const sport of SPORTS) {
  const b = buildPoolBenchmarks(sport);
  const rank1 = (b.ladderByRank ?? []).find((r) => r.rank === 1);
  if (!rank1) continue;
  // Every programme's own rank-1 median, against the three thresholds.
  const medians = [];
  const byProg = new Map();
  const rows = db.prepare(
    `SELECT college_name, season, position, minutes_played, class_year_label, player_name, sport
     FROM roster_players WHERE sport = ? AND season IN (${SEASONS.map(() => '?').join(',')})`,
  ).all(sport, ...SEASONS);
  for (const r of rows) {
    if (!byProg.has(r.college_name)) byProg.set(r.college_name, []);
    byProg.get(r.college_name).push(r);
  }
  // Reuse the same ladder the pool uses, via the pool's own inputs.
  const { programmePhilosophy } = await import('../../shared/philosophy.js');
  for (const rws of byProg.values()) {
    const ph = programmePhilosophy({ rows: rws, coachRows: [] });
    const top = (ph.ladder ?? []).find((x) => x.rank === 1);
    if (ph.freshman && top && top.median != null) medians.push(top.median);
  }
  const near = (t, d) => medians.filter((m) => Math.abs(m - t) <= d).length;
  line(`  ${sport}  (n=${medians.length}, thresholds p25=${rank1.p25} median=${rank1.median} p75=${rank1.p75})`);
  for (const [name, t] of [['p25', rank1.p25], ['median', rank1.median], ['p75', rank1.p75]]) {
    line(`     ${name.padEnd(7)} exactly ${String(medians.filter((m) => m === t).length).padStart(4)}`
      + `   within 1 ${String(near(t, 1)).padStart(4)}`
      + `   within 2 ${String(near(t, 2)).padStart(4)}`
      + `   within 5% ${String(near(t, Math.round(t * 0.05))).padStart(4)}`);
  }
}

head('SELF-INCLUSION');
{
  const sport = 'womens-soccer';
  const b = buildPoolBenchmarks(sport);
  const rank1 = (b.ladderByRank ?? []).find((r) => r.rank === 1);
  line(`  a programme's own median is one of the ${rank1.n} values the quantiles are taken from.`);
  line('  self-influence on a pool of that size is one rank position: with the');
  line('  floor-index quantile below, removing one value can move the chosen');
  line('  index by at most one, i.e. to the adjacent sample.');
  line(`  quantile(sorted, q) = sorted[min(len-1, floor(q * len))]   — nearest-rank, no interpolation`);
}

if (!MAY_PERTURB) {
  head('ISOLATION AND FAN-OUT');
  line('  skipped: set THRIV3_POOL_AUDIT_ALLOW_WRITES=1 and point RECRUITMATCH_DB at a COPY.');
} else {
  head('ISOLATION — does a change in one cohort move another pool?');
  const before = Object.fromEntries(SPORTS.map((s) => [s, shape(s)]));
  // A large, unambiguous perturbation: drop a whole division's historical rows
  // for one sport. If a pool is isolated from it, its numbers cannot move.
  const experiments = [
    ['mens-soccer D1 rows removed', "sport='mens-soccer' AND division='NCAA D1'"],
    ['womens-soccer D1 rows removed', "sport='womens-soccer' AND division='NCAA D1'"],
    ['womens-soccer D3 rows removed', "sport='womens-soccer' AND division='NCAA D3'"],
    [`${SQUAD_SEASON} rows removed (all sports)`, `season='${SQUAD_SEASON}'`],
  ];
  for (const [label, where] of experiments) {
    const after = perturbed(
      () => db.exec(`DELETE FROM roster_players WHERE ${where} AND season IN (${SEASONS.map((s) => `'${s}'`).join(',')})`
        .replace(`AND season IN (${SEASONS.map((s) => `'${s}'`).join(',')})`,
          where.includes('season=') ? '' : `AND season IN (${SEASONS.map((s) => `'${s}'`).join(',')})`)),
      () => Object.fromEntries(SPORTS.map((s) => [s, shape(s)])),
    );
    line(`  ${label}`);
    for (const s of SPORTS) {
      line(`     ${s.padEnd(16)} ${same(before[s], after[s]) ? 'UNCHANGED' : 'MOVED'}`
        + `   programmes ${before[s].programmes} -> ${after[s].programmes}`
        + `   rank1 p25 ${before[s].ladder[0]?.[2]} -> ${after[s].ladder[0]?.[2]}`);
    }
  }
}

head('COHORT ALTERNATIVES — pool size under plausible cohorts (diagnostic only)');
{
  const q = (extra, params) => db.prepare(
    `SELECT COUNT(*) n FROM (SELECT DISTINCT college_name, sport FROM roster_players r
     ${extra} WHERE r.season IN (${SEASONS.map(() => '?').join(',')}) ${params.clause})`,
  ).get(...SEASONS, ...(params.args ?? [])).n;
  for (const sport of SPORTS) {
    const all = db.prepare(
      `SELECT COUNT(*) n FROM (SELECT DISTINCT college_name FROM roster_players
       WHERE sport = ? AND season IN (${SEASONS.map(() => '?').join(',')}))`,
    ).get(sport, ...SEASONS).n;
    const byDiv = db.prepare(
      `SELECT division, COUNT(*) n FROM (SELECT DISTINCT college_name, division FROM roster_players
       WHERE sport = ? AND season IN (${SEASONS.map(() => '?').join(',')})) GROUP BY division ORDER BY n DESC`,
    ).all(sport, ...SEASONS);
    const complete = db.prepare(
      `SELECT COUNT(*) n FROM (SELECT college_name FROM roster_players
       WHERE sport = ? AND season IN (${SEASONS.map(() => '?').join(',')})
       GROUP BY college_name HAVING COUNT(DISTINCT season) = ?)`,
    ).get(sport, ...SEASONS, SEASONS.length).n;
    line(`  ${sport}`);
    line(`     current pool (sport only)        ${all}`);
    line(`     by division                      ${byDiv.map((d) => `${d.division}:${d.n}`).join('  ')}`);
    line(`     complete ${SEASONS.length}-season history only     ${complete}`);
  }
}

head('CACHE INVALIDATION');
{
  const fp = db.prepare(
    `SELECT COUNT(*) rows, MAX(updated_date) at FROM roster_players WHERE season IN (${SEASONS.map(() => '?').join(',')})`,
  ).get(...SEASONS);
  line(`  fingerprint  ${fp.rows}|${fp.at ?? ''}`);
  line('  the fingerprint query has NO sport filter, so a men\'s-only roster change');
  line('  invalidates the women\'s cached pool too. The rebuild is deterministic per');
  line('  sport, so the VALUE cannot move — only the work is shared.');
}
line();

/**
 * L7ZC — WHAT THE CLAIM SAYS THE POOL WAS, against what it was.
 *
 * L7ZA reported `programmes` and `ladder n` side by side above and left the
 * reader to notice that the claim printed the first while being ranked within
 * the second. That made the defect visible to someone who already knew to
 * look. This section asks the question directly, so the regression is a line
 * of output rather than a piece of reasoning.
 *
 * Reads production claims through the real generator. No counts are asserted:
 * both populations are data-dependent and the only invariant is that they
 * agree.
 */
head('CLAIMED POPULATION vs POOL USED (L7ZC regression)');
{
  const { canonicalCorpus, BASELINE_NOW } = await import('../lib/evidenceBaseline.js');
  const { evidenceFor } = await import('../lib/evidenceQueries.js');
  const seen = new Map();
  let claims = 0; let mismatch = 0;
  for (const { athlete, sport, college } of canonicalCorpus()) {
    let ev;
    try { ev = evidenceFor(athlete, college, { sport, now: BASELINE_NOW }); } catch { continue; }
    for (const c of (ev.all ?? [])) {
      if (c.kind !== 'PROGRAMME_POOL_BENCHMARK') continue;
      claims += 1;
      const reported = c.comparison?.poolSize ?? null;
      const used = c.data?.pool?.n ?? null;
      const wider = c.data?.poolProgrammes ?? null;
      if (reported !== used) mismatch += 1;
      const k = `${sport}  rank ${c.data?.programmeRank}  reported ${reported}  used ${used}  (any-rows ${wider})`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  }
  for (const [k, n] of [...seen].sort()) line(`  ${k}   x${n}`);
  line(`  claims ${claims}   disagreeing ${mismatch}`);
  line(mismatch === 0
    ? '  => every claim reports the population its own quantiles were taken from.'
    : '  => DEFECT PRESENT: comparison.poolSize is not the quantile population.');
}
line();
