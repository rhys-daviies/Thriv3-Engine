/**
 * A7.10.3: whether the CURRENT COACH has a repeatable historical pattern of
 * recruiting the athlete's position.
 *
 * READ-ONLY AND DIAGNOSTIC. No production scorer, weight, threshold or
 * calibration is touched; nothing is persisted.
 *
 * ATTRIBUTION IS TAKEN AT ITS WORD, AND ITS WORD IS STRICT. `ATTRIBUTED`
 * means the coach held the post for that intake AND it was not their first
 * roster - shared/recruiting/arrivals.js refuses to credit an incoming coach
 * with the regime they inherited. UNKNOWN is never treated as attributed.
 *
 *   node server/scripts/v2CoachHistory.js --coverage
 *   node server/scripts/v2CoachHistory.js --confound
 *   node server/scripts/v2CoachHistory.js --predict
 *   node server/scripts/v2CoachHistory.js --stability
 *   node server/scripts/v2CoachHistory.js --movement
 *   node server/scripts/v2CoachHistory.js --gain
 *   node server/scripts/v2CoachHistory.js --trace
 */
const POS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];
const SPORTS = ['mens-soccer', 'womens-soccer'];
const ARRIVAL_SEASONS = [2023, 2024, 2025, 2026];
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const pc = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const med = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
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

async function main() {
  const args = process.argv.slice(2);
  const { default: db } = await import('../db/client.js');
  const { normaliseCoach, isVacancy } = await import('../../shared/coachTenure.js');
  const { buildPositionIndex, positionEvidence, buildArrivalIndex } = await import('../lib/v2/rosterEvidence.js');
  const { positionalOpportunity } = await import('../../shared/matching/v2/layers/positionalOpportunity.js');
  const { ROSTER_COLUMNS } = await import('../lib/v2/poolContext.js');

  const key = (n) => { const k = normaliseCoach(n); return k && !isVacancy(n) ? k : null; };

  const load = (sport) => {
    const colleges = db.prepare('SELECT * FROM colleges WHERE sport=? AND active=1').all(sport);
    const seasons = db.prepare('SELECT school, season, coach_name, coach_title FROM coach_seasons WHERE sport=?').all(sport);
    const arrivals = db.prepare(`SELECT programme, arrival_season, canonical_position, entry_type,
      coach, coach_attribution, is_international FROM recruiting_arrivals WHERE sport=?`).all(sport);
    /** programme -> season -> normalised coach key */
    const bySchool = new Map();
    for (const r of seasons) {
      const k = key(r.coach_name);
      if (!bySchool.has(r.school)) bySchool.set(r.school, new Map());
      bySchool.get(r.school).set(String(r.season), k);
    }
    return { colleges, bySchool, arrivals };
  };

  /**
   * Who is in post now, and for how long we have seen them.
   *
   * Tenure is counted backwards from 2026 while the key is unchanged, inside
   * the observed window only. A coach present in every season on file is
   * "5 seasons observed", never "since 2011" - we did not see 2021.
   */
  const currentCoach = (bySchool, programme) => {
    const m = bySchool.get(programme);
    if (!m) return { state: 'CURRENT_COACH_UNKNOWN', coach: null, since: null, seasons: 0 };
    const now = m.get('2026');
    if (!now) return { state: 'CURRENT_COACH_UNKNOWN', coach: null, since: null, seasons: 0 };
    let since = 2026;
    for (const y of [2025, 2024, 2023, 2022]) {
      if (m.get(String(y)) === now) since = y; else break;
    }
    return { state: 'CURRENT_COACH_KNOWN', coach: now, since, seasons: 2026 - since + 1 };
  };

  /**
   * The current coach's ATTRIBUTED intakes strictly before `before`.
   * `sameProgrammeOnly` false lets a coach's record at a previous programme
   * count - which is only safe to the extent a normalised name identifies one
   * person, and that is exactly what --movement tests.
   */
  const coachHistory = (arrivals, coachKey, before, { sameProgrammeOnly = null, includeInherited = false } = {}) => {
    const out = { total: 0, byPos: Object.fromEntries(POS.map((p) => [p, 0])), seasons: new Set(), fresh: 0, exp: 0, intl: 0 };
    for (const a of arrivals) {
      if (Number(a.arrival_season) >= before) continue;
      if (key(a.coach) !== coachKey) continue;
      if (a.coach_attribution !== 'ATTRIBUTED' && !(includeInherited && a.coach_attribution === 'INHERITED')) continue;
      if (sameProgrammeOnly && a.programme !== sameProgrammeOnly) continue;
      out.total += 1;
      out.seasons.add(Number(a.arrival_season));
      const p = String(a.canonical_position || '').toUpperCase();
      if (POS.includes(p)) out.byPos[p] += 1;
      if (a.entry_type === 'FRESHMAN') out.fresh += 1;
      else if (a.entry_type === 'EXPERIENCED') out.exp += 1;
      if (a.is_international === 1) out.intl += 1;
    }
    return out;
  };

  const arrivalsAt = (arrivals, season) => {
    const m = new Map();
    for (const a of arrivals) {
      if (Number(a.arrival_season) !== season) continue;
      const p = String(a.canonical_position || '').toUpperCase();
      if (!POS.includes(p)) continue;
      const k = `${a.programme}|${p}`;
      if (!m.has(k)) m.set(k, { n: 0, fresh: 0, exp: 0 });
      const e = m.get(k); e.n += 1;
      if (a.entry_type === 'FRESHMAN') e.fresh += 1; else if (a.entry_type === 'EXPERIENCED') e.exp += 1;
    }
    return m;
  };

  // ------------------------------------------------------------- coverage
  if (args.includes('--coverage') || args.includes('--trace')) {
    if (args.includes('--coverage')) {
      console.log('== 1/3/4/24. ATTRIBUTION, CURRENT COACH AND TENURE COVERAGE\n');
      for (const sport of SPORTS) {
        const { colleges, bySchool, arrivals } = load(sport);
        const att = {};
        for (const a of arrivals) att[a.coach_attribution] = (att[a.coach_attribution] ?? 0) + 1;
        console.log(`-- ${sport}: ${arrivals.length} arrivals   ${JSON.stringify(att)}`);
        const states = {}; const tenure = { 0: 0, 1: 0, 2: 0, 3: 0, '4+': 0 };
        const byDiv = {};
        for (const c of colleges) {
          const cc = currentCoach(bySchool, c.name);
          states[cc.state] = (states[cc.state] ?? 0) + 1;
          byDiv[c.division] = byDiv[c.division] ?? { n: 0, known: 0, three: 0 };
          byDiv[c.division].n += 1;
          if (cc.state === 'CURRENT_COACH_KNOWN') {
            byDiv[c.division].known += 1;
            /** Seasons of ATTRIBUTED intake, which is tenure minus the inherited first. */
            const h = coachHistory(arrivals, cc.coach, 2027, { sameProgrammeOnly: c.name });
            const n = h.seasons.size;
            tenure[n >= 4 ? '4+' : n] = (tenure[n >= 4 ? '4+' : n] ?? 0) + 1;
            if (n >= 3) byDiv[c.division].three += 1;
          }
        }
        console.log(`   current coach: ${JSON.stringify(states)}  of ${colleges.length} eligible programmes`);
        console.log(`   attributed recruiting seasons for the current coach: ${JSON.stringify(tenure)}`);
        console.log(`   ${'division'.padEnd(12)}${'progs'.padStart(7)}${'coach known'.padStart(14)}${'3+ att seasons'.padStart(16)}`);
        for (const [d, v] of Object.entries(byDiv).sort((a, b) => b[1].n - a[1].n)) {
          console.log(`   ${String(d).padEnd(12)}${String(v.n).padStart(7)}${`${v.known} (${pc(v.known, v.n)})`.padStart(14)}${`${v.three} (${pc(v.three, v.n)})`.padStart(16)}`);
        }
        console.log('');
      }
    }
  }

  /** The analysis panel: one row per programme-position, at one outcome season. */
  const panel = (sport, outcomeSeason) => {
    const { colleges, bySchool, arrivals } = load(sport);
    const got = arrivalsAt(arrivals, outcomeSeason);
    const onFile = new Set(arrivals.filter((a) => Number(a.arrival_season) === outcomeSeason).map((a) => a.programme));
    const roster = db.prepare(`SELECT ${ROSTER_COLUMNS} FROM roster_players WHERE sport=? AND season=?`)
      .all(sport, String(outcomeSeason - 1));
    const idx = buildPositionIndex(roster);
    const known = arrivals.filter((a) => Number(a.arrival_season) < outcomeSeason);
    const aidx = buildArrivalIndex(known);
    const horizon = known.reduce((m, r) => Math.max(m, Number(r.arrival_season) || 0), 0);
    const rows = [];
    for (const c of colleges) {
      if (!onFile.has(c.name)) continue;
      const cc = currentCoach(bySchool, c.name);
      if (cc.state !== 'CURRENT_COACH_KNOWN') continue;
      const h = coachHistory(arrivals, cc.coach, outcomeSeason, { sameProgrammeOnly: c.name });
      if (!h.total) continue;
      // programme history regardless of coach, for the coach-vs-programme test
      const ph = { total: 0, byPos: Object.fromEntries(POS.map((p) => [p, 0])) };
      for (const a of arrivals) {
        if (Number(a.arrival_season) >= outcomeSeason || a.programme !== c.name) continue;
        ph.total += 1;
        const p = String(a.canonical_position || '').toUpperCase();
        if (POS.includes(p)) ph.byPos[p] += 1;
      }
      const classNow = POS.reduce((s, p) => s + (got.get(`${c.name}|${p}`)?.n ?? 0), 0);
      for (const position of POS) {
        const ev = positionEvidence({
          programme: c.name, position, sport, division: c.division, entryYear: outcomeSeason,
          rosterIndex: idx, arrivalIndex: aidx, arrivalsHorizon: horizon,
        });
        const r = positionalOpportunity({ sport, position, evidence: ev });
        const o = got.get(`${c.name}|${position}`) ?? { n: 0, fresh: 0, exp: 0 };
        const seasons = h.seasons.size || 1;
        rows.push({
          name: c.name, division: c.division, position, strength: c.soccer_score,
          coach: cc.coach, coachSeasons: cc.seasons, attSeasons: h.seasons.size,
          // --- candidate coach signals ---
          A_count: h.byPos[position],
          B_share: h.total ? h.byPos[position] / h.total : null,
          C_perSeason: h.byPos[position] / seasons,
          D_freq: h.seasons.size ? [...h.seasons].filter((s) => arrivals.some((a) => a.programme === c.name
            && Number(a.arrival_season) === s && String(a.canonical_position || '').toUpperCase() === position
            && a.coach_attribution === 'ATTRIBUTED')).length / h.seasons.size : null,
          F_fresh: h.fresh, G_exp: h.exp,
          coachTotal: h.total,
          // --- programme comparator ---
          P_share: ph.total ? ph.byPos[position] / ph.total : null,
          P_count: ph.byPos[position],
          // --- confound controls ---
          posRows: idx.get(c.name)?.positions?.get(position)?.rows ?? 0,
          rosterRows: idx.get(c.name)?.rows ?? 0,
          classNow,
          // --- production comparator ---
          posValue: r.ok === false ? null : r.value,
          // --- outcome ---
          got: o.n, fresh: o.fresh, exp: o.exp,
          gotShare: classNow ? o.n / classNow : null,
        });
      }
    }
    return rows;
  };

  // ------------------------------------------------------------- confound
  if (args.includes('--confound')) {
    console.log('== 6. THE CONFOUND TEST A7.10.2 FAILED\n');
    for (const sport of SPORTS) {
      const rows = panel(sport, 2026);
      console.log(`-- ${sport}: ${rows.length} programme-position cells with a known current coach and some attributed history`);
      const f = (k) => rows.map((r) => r[k] ?? 0);
      for (const [label, k] of [['A. count at position', 'A_count'], ['B. share of coach intake', 'B_share'],
        ['C. per attributed season', 'C_perSeason'], ['D. season frequency', 'D_freq']]) {
        console.log(`   ${label.padEnd(30)} vs positionGroupSize ${fmt(corr(f(k), f('posRows'))).padStart(7)}`
          + `   vs rosterSize ${fmt(corr(f(k), f('rosterRows'))).padStart(7)}`
          + `   vs coachIntakeTotal ${fmt(corr(f(k), f('coachTotal'))).padStart(7)}`
          + `   vs classSizeNow ${fmt(corr(f(k), f('classNow'))).padStart(7)}`);
      }
      console.log('');
    }
  }

  // ------------------------------------------------------------- predict
  if (args.includes('--predict')) {
    console.log('== 7/8/9/12/13/17. CHRONOLOGY-SAFE PREDICTION\n');
    console.log('   History uses ATTRIBUTED intakes strictly BEFORE the outcome season.\n');
    for (const sport of SPORTS) {
      console.log(`== ${sport}`);
      for (const out of [2025, 2026]) {
        const rows = panel(sport, out);
        if (rows.length < 100) { console.log(`   outcome ${out}: too few cells (${rows.length})`); continue; }
        console.log(`   outcome ${out}: ${rows.length} cells   base rate: mean recruits ${fmt(mean(rows.map((r) => r.got)), 2)}`
          + `   >=1 ${pc(rows.filter((r) => r.got > 0).length, rows.length)}   2+ ${pc(rows.filter((r) => r.got >= 2).length, rows.length)}`);
        const sc = rows.filter((r) => r.posValue !== null);
        console.log(`   ${'signal'.padEnd(32)}${'vs count'.padStart(10)}${'vs share'.padStart(10)}${'vs fresh'.padStart(10)}${'vs exp'.padStart(9)}`);
        const s = (label, f, set = rows) => console.log(`   ${label.padEnd(32)}`
          + `${fmt(spear(set.map(f), set.map((r) => r.got))).padStart(10)}`
          + `${fmt(spear(set.filter((r) => r.gotShare !== null).map(f), set.filter((r) => r.gotShare !== null).map((r) => r.gotShare))).padStart(10)}`
          + `${fmt(spear(set.map(f), set.map((r) => r.fresh))).padStart(10)}`
          + `${fmt(spear(set.map(f), set.map((r) => r.exp))).padStart(9)}`);
        s('A. coach count at position', (r) => r.A_count);
        s('B. coach share at position', (r) => r.B_share ?? 0);
        s('C. coach per attributed season', (r) => r.C_perSeason);
        s('D. coach season frequency', (r) => r.D_freq ?? 0);
        s('   coach TOTAL intake (volume)', (r) => r.coachTotal);
        s('P. programme share at position', (r) => r.P_share ?? 0);
        s('P. programme count at position', (r) => r.P_count);
        s('   positional opportunity', (r) => r.posValue, sc);
        s('   position-group SIZE (control)', (r) => r.posRows);
        console.log('');
      }
    }
  }

  // ------------------------------------------------------------- stability
  if (args.includes('--stability')) {
    console.log('== 11. IS COACH POSITIONAL RECRUITING REPEATABLE?\n');
    for (const sport of SPORTS) {
      const { colleges, bySchool, arrivals } = load(sport);
      const cells = [];
      for (const c of colleges) {
        const cc = currentCoach(bySchool, c.name);
        if (cc.state !== 'CURRENT_COACH_KNOWN') continue;
        const per = new Map();
        for (const a of arrivals) {
          if (a.programme !== c.name || a.coach_attribution !== 'ATTRIBUTED' || key(a.coach) !== cc.coach) continue;
          const s = Number(a.arrival_season);
          const p = String(a.canonical_position || '').toUpperCase();
          if (!POS.includes(p)) continue;
          if (!per.has(s)) per.set(s, { n: 0, byPos: Object.fromEntries(POS.map((x) => [x, 0])) });
          per.get(s).n += 1; per.get(s).byPos[p] += 1;
        }
        const seasons = [...per.keys()].sort();
        if (seasons.length < 2) continue;
        for (const position of POS) cells.push({ name: c.name, position, seasons, per });
      }
      console.log(`-- ${sport}: ${cells.length} coach-position cells with 2+ attributed seasons`);
      const adjC = []; const adjS = []; const halfC = []; const halfS = [];
      for (const cell of cells) {
        const s = cell.seasons;
        for (let i = 0; i + 1 < s.length; i += 1) {
          const a = cell.per.get(s[i]); const b = cell.per.get(s[i + 1]);
          adjC.push([a.byPos[cell.position], b.byPos[cell.position]]);
          adjS.push([a.n ? a.byPos[cell.position] / a.n : 0, b.n ? b.byPos[cell.position] / b.n : 0]);
        }
        if (s.length >= 4) {
          const h = Math.floor(s.length / 2);
          const sum = (ss, f) => ss.reduce((t, y) => t + f(cell.per.get(y)), 0);
          halfC.push([sum(s.slice(0, h), (v) => v.byPos[cell.position]), sum(s.slice(h), (v) => v.byPos[cell.position])]);
          halfS.push([sum(s.slice(0, h), (v) => (v.n ? v.byPos[cell.position] / v.n : 0)), sum(s.slice(h), (v) => (v.n ? v.byPos[cell.position] / v.n : 0))]);
        }
      }
      const sp2 = (pairs) => (pairs.length >= 20 ? spear(pairs.map((p) => p[0]), pairs.map((p) => p[1])) : null);
      console.log(`   adjacent seasons, COUNT at position  ${fmt(sp2(adjC))}  (n ${adjC.length})`);
      console.log(`   adjacent seasons, SHARE at position  ${fmt(sp2(adjS))}  (n ${adjS.length})`);
      console.log(`   split half, COUNT                    ${fmt(sp2(halfC))}  (n ${halfC.length})`);
      console.log(`   split half, SHARE                    ${fmt(sp2(halfS))}  (n ${halfS.length})`);
      console.log('');
    }
  }

  // ------------------------------------------------------------- movement
  if (args.includes('--movement')) {
    console.log('== 10. DID ANY COACH MOVE PROGRAMMES INSIDE THE WINDOW?\n');
    for (const sport of SPORTS) {
      const { bySchool } = load(sport);
      const where = new Map();   // coachKey -> Map(season -> Set(school))
      for (const [school, m] of bySchool) {
        for (const [season, k] of m) {
          if (!k) continue;
          if (!where.has(k)) where.set(k, new Map());
          if (!where.get(k).has(season)) where.get(k).set(season, new Set());
          where.get(k).get(season).add(school);
        }
      }
      const movers = [];
      for (const [k, seasons] of where) {
        const schools = new Set();
        for (const set of seasons.values()) for (const s of set) schools.add(s);
        if (schools.size > 1) movers.push({ k, schools: [...schools], seasons });
      }
      console.log(`-- ${sport}: ${where.size} distinct coach names; ${movers.length} appear at more than one programme`);
      const clean = movers.filter((m) => {
        // A clean move: at one school in an early season, a different one later,
        // never two at once (which would be a namesake, not a move).
        for (const set of m.seasons.values()) if (set.size > 1) return false;
        return true;
      });
      console.log(`   of those, never at two programmes in the same season (a possible real move): ${clean.length}`);
      for (const m of clean.slice(0, 8)) {
        console.log(`      ${m.k.padEnd(26)} ${[...m.seasons.entries()].sort().map(([s, set]) => `${s}:${[...set][0]}`).join('  ')}`);
      }
      console.log('');
    }
  }

  // ------------------------------------------------------------- gain
  if (args.includes('--gain')) {
    console.log('== 15/16/19. INFORMATION GAIN INSIDE THE PRODUCTION SIGNAL\n');
    for (const sport of SPORTS) {
      const rows = panel(sport, 2026).filter((r) => r.posValue !== null);
      console.log(`-- ${sport}: ${rows.length} cells`);
      console.log(`   corr(coach share, positional opportunity) ${fmt(corr(rows.map((r) => r.B_share ?? 0), rows.map((r) => r.posValue)))}`);
      console.log(`   corr(coach count, positional opportunity) ${fmt(corr(rows.map((r) => r.A_count), rows.map((r) => r.posValue)))}`);
      const pb = [['pos = 0', (r) => r.posValue === 0], ['0 < pos <= .25', (r) => r.posValue > 0 && r.posValue <= 0.25],
        ['.25 < pos <= .5', (r) => r.posValue > 0.25 && r.posValue <= 0.5], ['pos > .5', (r) => r.posValue > 0.5]];
      const shares = rows.map((r) => r.B_share ?? 0).sort((a, b) => a - b);
      const q = (x) => shares[Math.floor(x * shares.length)] ?? 0;
      const cb = [[`share <= ${fmt(q(0.25), 2)}`, (r) => (r.B_share ?? 0) <= q(0.25)],
        [`<= ${fmt(q(0.5), 2)}`, (r) => (r.B_share ?? 0) > q(0.25) && (r.B_share ?? 0) <= q(0.5)],
        [`<= ${fmt(q(0.75), 2)}`, (r) => (r.B_share ?? 0) > q(0.5) && (r.B_share ?? 0) <= q(0.75)],
        [`> ${fmt(q(0.75), 2)}`, (r) => (r.B_share ?? 0) > q(0.75)]];
      console.log(`\n   mean subsequent recruits at the position, production value x coach SHARE:`);
      console.log(`   ${''.padEnd(18)}${cb.map(([l]) => l.padStart(13)).join('')}${'row spear'.padStart(11)}`);
      for (const [pl, pt] of pb) {
        const sub = rows.filter(pt);
        if (sub.length < 20) { console.log(`   ${pl.padEnd(18)} (n ${sub.length}, too few)`); continue; }
        console.log(`   ${pl.padEnd(18)}${cb.map(([, ct]) => {
          const s = sub.filter(ct);
          return (s.length >= 10 ? `${fmt(mean(s.map((r) => r.got)), 2)}/${s.length}` : `·/${s.length}`).padStart(13);
        }).join('')}${fmt(spear(sub.map((r) => r.B_share ?? 0), sub.map((r) => r.got))).padStart(11)}`);
      }
      // controlled: hold position-group size fixed
      console.log(`\n   holding position-group size fixed, spear(coach share, recruits):`);
      for (const [lab, lo, hi] of [['4-6', 4, 6], ['7-8', 7, 8], ['9-11', 9, 11], ['12+', 12, 99]]) {
        const s = rows.filter((r) => r.posRows >= lo && r.posRows <= hi);
        if (s.length < 40) continue;
        console.log(`      group ${lab.padEnd(6)} n ${String(s.length).padStart(5)}   coach share ${fmt(spear(s.map((r) => r.B_share ?? 0), s.map((r) => r.got))).padStart(7)}`
          + `   coach count ${fmt(spear(s.map((r) => r.A_count), s.map((r) => r.got))).padStart(7)}`
          + `   programme share ${fmt(spear(s.map((r) => r.P_share ?? 0), s.map((r) => r.got))).padStart(7)}`);
      }
      // by evidence count
      console.log(`\n   by attributed-seasons of history:`);
      for (const n of [1, 2, 3, 4]) {
        const s = rows.filter((r) => r.attSeasons === n);
        if (s.length < 30) { console.log(`      ${n} season(s): n ${s.length} (too few)`); continue; }
        console.log(`      ${n} season(s): n ${String(s.length).padStart(5)}   spear(coach share, recruits) ${fmt(spear(s.map((r) => r.B_share ?? 0), s.map((r) => r.got))).padStart(7)}`);
      }
      console.log('');
    }
  }

  // ------------------------------------------------------------- trace
  if (args.includes('--trace')) {
    const NAMED = ['Vermont', 'Rutgers', 'Loyola Marymount', 'Penn State', 'Furman', 'Princeton'];
    const sport = 'mens-soccer';
    const { bySchool, arrivals } = load(sport);
    console.log('\n== 21/22. THE SIX NAMED PROGRAMMES (men\'s, MIDFIELD)\n');
    for (const p of NAMED) {
      const cc = currentCoach(bySchool, p);
      const m = bySchool.get(p);
      const seq = m ? [2022, 2023, 2024, 2025, 2026].map((y) => `${y}:${m.get(String(y)) ?? '—'}`).join('  ') : 'no coach data';
      console.log(`-- ${p}`);
      console.log(`   coach by season: ${seq}`);
      console.log(`   current: ${cc.coach ?? '—'}   observed since ${cc.since ?? '—'}   ${cc.state}`);
      const bySeason = {};
      for (const a of arrivals) {
        if (a.programme !== p) continue;
        const s = a.arrival_season;
        const pos = String(a.canonical_position || '').toUpperCase();
        bySeason[s] = bySeason[s] ?? { all: 0, mid: 0, midFresh: 0, midExp: 0, att: 0, attr: null };
        bySeason[s].all += 1;
        bySeason[s].attr = a.coach_attribution;
        if (a.coach_attribution === 'ATTRIBUTED' && key(a.coach) === cc.coach) bySeason[s].att += 1;
        if (pos === 'MIDFIELD') {
          bySeason[s].mid += 1;
          if (a.entry_type === 'FRESHMAN') bySeason[s].midFresh += 1;
          else if (a.entry_type === 'EXPERIENCED') bySeason[s].midExp += 1;
        }
      }
      for (const s of ARRIVAL_SEASONS) {
        const v = bySeason[s];
        if (!v) { console.log(`      ${s}: no arrivals on file`); continue; }
        console.log(`      ${s}: intake ${String(v.all).padStart(3)}   midfield ${String(v.mid).padStart(2)} (fresh ${v.midFresh}, exp ${v.midExp})   attribution ${v.attr}   attributed to current coach ${v.att}`);
      }
      const h = coachHistory(arrivals, cc.coach, 2027, { sameProgrammeOnly: p });
      console.log(`   current coach ATTRIBUTED history at this programme: ${h.total} intakes over ${h.seasons.size} season(s)`
        + `   midfield ${h.byPos.MIDFIELD}  share ${fmt(h.total ? h.byPos.MIDFIELD / h.total : null, 2)}`);
      console.log('');
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
