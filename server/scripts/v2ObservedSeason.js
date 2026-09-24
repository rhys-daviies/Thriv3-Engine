/**
 * A7.10.1: why the season V2 scores carries no appearances, and what the
 * evidence would look like if it were selected differently.
 *
 * READ-ONLY AND DIAGNOSTIC. No production scorer, weight, threshold or
 * calibration is touched, nothing is persisted, and no roster row is written.
 *
 *   node server/scripts/v2ObservedSeason.js --timeline
 *   node server/scripts/v2ObservedSeason.js --continuity
 *   node server/scripts/v2ObservedSeason.js --lookback
 *   node server/scripts/v2ObservedSeason.js --who
 *   node server/scripts/v2ObservedSeason.js --turnover
 */
import { canonicalPosition } from '../../shared/positions.js';

const SPORTS = ['mens-soccer', 'womens-soccer'];
const norm = (n) => String(n || '').toLowerCase().replace(/[^a-z]/g, '');
const readPos = (raw) => { const p = canonicalPosition(raw); return p && p !== 'UNKNOWN' ? p : null; };
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const pc = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const corr = (x, y) => {
  if (x.length < 3) return null;
  const mx = mean(x); const my = mean(y);
  let a = 0; let b = 0; let c = 0;
  for (let i = 0; i < x.length; i += 1) { const dx = x[i] - mx; const dy = y[i] - my; a += dx * dy; b += dx * dx; c += dy * dy; }
  return (b === 0 || c === 0) ? null : a / Math.sqrt(b * c);
};
const rk = (a) => {
  const i = a.map((v, j) => [v, j]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length); let k = 0;
  while (k < i.length) {
    let j = k; while (j + 1 < i.length && i[j + 1][0] === i[k][0]) j += 1;
    const av = ((k + j) / 2) + 1;
    for (let m = k; m <= j; m += 1) r[i[m][1]] = av;
    k = j + 1;
  }
  return r;
};
const spear = (x, y) => corr(rk(x), rk(y));
const POS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];
const NAMED = ['Vermont', 'Rutgers', 'Loyola Marymount', 'Penn State', 'Furman', 'Princeton'];

async function main() {
  const args = process.argv.slice(2);
  const { default: db } = await import('../db/client.js');
  const { buildPositionIndex, buildArrivalIndex, positionEvidence } = await import('../lib/v2/rosterEvidence.js');
  const { positionalOpportunity } = await import('../../shared/matching/v2/layers/positionalOpportunity.js');
  const { ROSTER_COLUMNS } = await import('../lib/v2/poolContext.js');

  if (args.includes('--timeline')) {
    console.log('== 3. WHAT EACH ROSTER SEASON ACTUALLY HOLDS\n');
    for (const sport of SPORTS) {
      console.log(`-- ${sport}`);
      const rows = db.prepare(`SELECT season, COUNT(*) AS n,
        SUM(CASE WHEN minutes_played IS NOT NULL THEN 1 ELSE 0 END) AS mins,
        SUM(CASE WHEN games_started IS NOT NULL THEN 1 ELSE 0 END) AS gs,
        SUM(CASE WHEN projected_minutes IS NOT NULL THEN 1 ELSE 0 END) AS pm,
        SUM(CASE WHEN source_stats_url IS NOT NULL AND source_stats_url<>'' THEN 1 ELSE 0 END) AS surl,
        SUM(CASE WHEN source_roster_url IS NOT NULL AND source_roster_url<>'' THEN 1 ELSE 0 END) AS rurl,
        SUM(CASE WHEN prior_programme IS NOT NULL AND prior_programme<>'' THEN 1 ELSE 0 END) AS prior,
        MIN(created_date) AS c0, MAX(created_date) AS c1
        FROM roster_players WHERE sport=? GROUP BY season ORDER BY season`).all(sport);
      console.log(`  ${'season'.padEnd(8)}${'rows'.padStart(7)}${'minutes'.padStart(9)}${'starts'.padStart(8)}${'projMin'.padStart(9)}${'statsURL'.padStart(10)}${'rosterURL'.padStart(11)}${'prior'.padStart(7)}  imported`);
      for (const r of rows) {
        console.log(`  ${r.season.padEnd(8)}${String(r.n).padStart(7)}${String(r.mins).padStart(9)}${String(r.gs).padStart(8)}`
          + `${String(r.pm).padStart(9)}${String(r.surl).padStart(10)}${String(r.rurl).padStart(11)}${String(r.prior).padStart(7)}  ${String(r.c0).slice(0, 10)}`);
      }
      console.log('');
    }
  }

  if (args.includes('--continuity')) {
    console.log('== 7/9. 2025 -> 2026 CONTINUITY, and why a projection is missing\n');
    for (const sport of SPORTS) {
      const cur = db.prepare(`SELECT college_name, player_name, class_year_label, eligibility_end_year,
        projected_minutes, projected_games_started FROM roster_players WHERE sport=? AND season='2026'`).all(sport);
      const prev = db.prepare(`SELECT college_name, player_name, minutes_played, games_started
        FROM roster_players WHERE sport=? AND season='2025'`).all(sport);
      const same = new Map(prev.map((p) => [`${p.college_name}|${norm(p.player_name)}`, p]));
      const anywhere = new Set(prev.map((p) => norm(p.player_name)));
      const has = (r) => r.projected_minutes !== null || r.projected_games_started !== null;
      let onSame = 0; let transfer = 0; let brandNew = 0;
      const gap = { sameNoFigures: 0, transfer: 0, absent: 0 };
      let freshLabelled = 0;
      for (const r of cur) {
        const k = `${r.college_name}|${norm(r.player_name)}`;
        if (same.has(k)) onSame += 1;
        else if (anywhere.has(norm(r.player_name))) transfer += 1;
        else brandNew += 1;
        if (!has(r)) {
          if (same.has(k)) gap.sameNoFigures += 1;
          else if (anywhere.has(norm(r.player_name))) gap.transfer += 1;
          else { gap.absent += 1; if (/^(Fr|Freshman|FY|R-Fr)/i.test(String(r.class_year_label || ''))) freshLabelled += 1; }
        }
      }
      console.log(`-- ${sport}: ${cur.length} rows on the 2026 roster`);
      console.log(`   same programme in 2025 ${onSame} ${pc(onSame, cur.length)}   transferred in ${transfer} ${pc(transfer, cur.length)}   new to the database ${brandNew} ${pc(brandNew, cur.length)}`);
      console.log(`   no carried appearance evidence: ${cur.filter((r) => !has(r)).length} ${pc(cur.filter((r) => !has(r)).length, cur.length)}`);
      console.log(`      on 2025 at the same programme but no figures published there  ${gap.sameNoFigures}`);
      console.log(`      transferred in — deliberately not carried across programmes   ${gap.transfer}`);
      console.log(`      absent from 2025 entirely                                     ${gap.absent} (freshman-labelled ${freshLabelled})`);
      /**
       * The projection job claims the DEPARTING cohort is well covered even
       * though the squad as a whole is not. That is the only claim that
       * matters, because vacatedStarters counts nobody else.
       */
      for (const [label, test] of [
        ['departing before 2028', (r) => r.eligibility_end_year !== null && r.eligibility_end_year < 2028],
        ['everyone else', (r) => !(r.eligibility_end_year !== null && r.eligibility_end_year < 2028)],
      ]) {
        const g = cur.filter(test);
        console.log(`   ${label.padEnd(24)} n ${String(g.length).padStart(6)}   carries evidence ${pc(g.filter(has).length, g.length).padStart(7)}`);
      }
      console.log('');
    }
  }

  if (args.includes('--lookback')) {
    console.log('== 15/16. DEEPER LOOKBACK: would going back past 2025 recover the gaps?\n');
    for (const sport of SPORTS) {
      const cur = db.prepare(`SELECT college_name, player_name, eligibility_end_year, projected_minutes,
        projected_games_started FROM roster_players WHERE sport=? AND season='2026'`).all(sport);
      const older = new Map();
      for (const s of ['2024', '2023', '2022']) {
        for (const r of db.prepare(`SELECT college_name, player_name, season FROM roster_players
          WHERE sport=? AND season=? AND (minutes_played IS NOT NULL OR games_started IS NOT NULL)`).all(sport, s)) {
          const k = `${r.college_name}|${norm(r.player_name)}`;
          if (!older.has(k)) older.set(k, r);
        }
      }
      const gapRows = cur.filter((r) => r.eligibility_end_year !== null && r.eligibility_end_year < 2028
        && r.projected_minutes === null && r.projected_games_started === null);
      const rec = gapRows.filter((r) => older.has(`${r.college_name}|${norm(r.player_name)}`));
      const by = {}; for (const r of rec) { const s = older.get(`${r.college_name}|${norm(r.player_name)}`).season; by[s] = (by[s] ?? 0) + 1; }
      console.log(`-- ${sport}: departing rows with no 2025 evidence ${gapRows.length}`);
      console.log(`   recoverable from 2024/2023/2022 at the same programme: ${rec.length} ${pc(rec.length, gapRows.length)}  ${JSON.stringify(by)}`);
      console.log('');
    }
  }

  if (args.includes('--who')) {
    console.log('== 6/12/13/14. THE NAMED PROGRAMMES, PLAYER BY PLAYER (men\'s midfield)\n');
    for (const prog of NAMED) {
      const src = db.prepare(`SELECT COUNT(*) AS n,
        SUM(CASE WHEN minutes_played IS NOT NULL THEN 1 ELSE 0 END) AS m
        FROM roster_players WHERE sport='mens-soccer' AND season='2025' AND college_name=?`).get(prog);
      const rows = db.prepare(`SELECT player_name, class_year_label, eligibility_end_year, projected_minutes,
        projected_games_started, prior_programme FROM roster_players
        WHERE sport='mens-soccer' AND season='2026' AND college_name=? AND position='MIDFIELD'
        ORDER BY eligibility_end_year`).all(prog);
      const prev = new Map(db.prepare(`SELECT player_name, minutes_played FROM roster_players
        WHERE sport='mens-soccer' AND season='2025' AND college_name=?`).all(prog).map((r) => [norm(r.player_name), r]));
      console.log(`-- ${prog}: 2025 roster ${src.n} players, ${src.m} with published minutes (${pc(src.m, src.n)})`);
      for (const r of rows) {
        const p = prev.get(norm(r.player_name));
        console.log(`   ${String(r.player_name).slice(0, 22).padEnd(23)}${String(r.class_year_label).slice(0, 8).padEnd(9)}`
          + `elig ${String(r.eligibility_end_year).padStart(4)}   proj ${String(r.projected_minutes ?? '—').padStart(5)}`
          + `   prior ${String(r.prior_programme ?? '—').slice(0, 16).padEnd(17)}${p ? `2025: ${p.minutes_played} min` : '2025: ABSENT'}`);
      }
      console.log('');
    }
  }

  if (args.includes('--turnover')) {
    console.log('== 18. OBSERVED DEPARTURES vs THE FORWARD-LOOKING SIGNAL\n');
    console.log('   Forward-looking = who is on season T and loses eligibility before T+1, the');
    console.log('   production signal. Observed = who was on T-1 at the position and is not on T.\n');
    for (const sport of SPORTS) {
      const colleges = db.prepare('SELECT * FROM colleges WHERE sport=? AND active=1').all(sport);
      const allArr = db.prepare('SELECT programme, arrival_season, canonical_position FROM recruiting_arrivals WHERE sport=?').all(sport);
      console.log(`== ${sport}`);
      for (const T of [2024, 2025]) {
        const prev = db.prepare(`SELECT ${ROSTER_COLUMNS} FROM roster_players WHERE sport=? AND season=?`).all(sport, String(T - 1));
        const cur = db.prepare(`SELECT ${ROSTER_COLUMNS} FROM roster_players WHERE sport=? AND season=?`).all(sport, String(T));
        if (!prev.length || !cur.length) continue;
        const curKeys = new Set(cur.map((r) => `${r.college_name}|${norm(r.player_name)}`));
        const gone = new Map();
        for (const r of prev) {
          const p = readPos(r.position); if (!p) continue;
          if (curKeys.has(`${r.college_name}|${norm(r.player_name)}`)) continue;
          const k = `${r.college_name}|${p}`;
          if (!gone.has(k)) gone.set(k, { left: 0, leftStarters: 0 });
          const g = gone.get(k); g.left += 1;
          if (Number(r.minutes_played) >= 600) g.leftStarters += 1;
        }
        const known = allArr.filter((a) => Number(a.arrival_season) <= T);
        const idx = buildPositionIndex(cur); const aidx = buildArrivalIndex(known);
        const horizon = known.reduce((m, r) => Math.max(m, Number(r.arrival_season) || 0), 0);
        const actual = new Map();
        for (const a of allArr) {
          if (Number(a.arrival_season) !== T + 1) continue;
          const p = String(a.canonical_position || '').toUpperCase(); if (!POS.includes(p)) continue;
          actual.set(`${a.programme}|${p}`, (actual.get(`${a.programme}|${p}`) || 0) + 1);
        }
        const onFile = new Set(allArr.filter((a) => Number(a.arrival_season) === T + 1).map((a) => a.programme));
        const cells = [];
        for (const c of colleges) {
          if (!onFile.has(c.name)) continue;
          for (const position of POS) {
            const ev = positionEvidence({ programme: c.name, position, sport, division: c.division, entryYear: T + 1, rosterIndex: idx, arrivalIndex: aidx, arrivalsHorizon: horizon });
            const r = positionalOpportunity({ sport, position, evidence: ev });
            if (r.ok === false) continue;
            const g = gone.get(`${c.name}|${position}`) ?? { left: 0, leftStarters: 0 };
            cells.push({ fwd: r.value, left: g.left, leftSt: g.leftStarters, got: actual.get(`${c.name}|${position}`) ?? 0 });
          }
        }
        console.log(`  T=${T} -> arrivals ${T + 1}: ${cells.length} cells`);
        console.log(`     forward-looking value        ${fmt(spear(cells.map((c) => c.fwd), cells.map((c) => c.got)))}`);
        console.log(`     observed departures, ALL     ${fmt(spear(cells.map((c) => c.left), cells.map((c) => c.got)))}`);
        console.log(`     observed departures, STARTERS${fmt(spear(cells.map((c) => c.leftSt), cells.map((c) => c.got)))}`);
      }
      console.log('');
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
