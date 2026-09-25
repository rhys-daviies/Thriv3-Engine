/**
 * A7.10.2: whether OBSERVED POSITIONAL TURNOVER is its own evidence.
 *
 * READ-ONLY AND DIAGNOSTIC. No production scorer, weight, threshold or
 * calibration is touched; nothing is persisted; no roster row is written.
 *
 * TURNOVER IS NOT VACANCY. The production positional layer asks whether a
 * starting place will empty BEFORE the athlete arrives. This asks how much a
 * programme has historically replaced players at a position. One is a
 * forecast about a specific future place, the other is a description of past
 * behaviour, and they are deliberately kept apart here.
 *
 *   node server/scripts/v2Turnover.js --coverage
 *   node server/scripts/v2Turnover.js --predict
 *   node server/scripts/v2Turnover.js --stability
 *   node server/scripts/v2Turnover.js --bias
 *   node server/scripts/v2Turnover.js --independence
 *   node server/scripts/v2Turnover.js --gain
 *   node server/scripts/v2Turnover.js --trace
 */
import { canonicalPosition } from '../../shared/positions.js';

const SPORTS = ['mens-soccer', 'womens-soccer'];
const POS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];
const ROSTER_SEASONS = ['2022', '2023', '2024', '2025', '2026'];
const norm = (n) => String(n || '').toLowerCase().replace(/[^a-z]/g, '');
const readPos = (raw) => { const p = canonicalPosition(raw); return p && p !== 'UNKNOWN' ? p : null; };
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
  const { buildPositionIndex, buildArrivalIndex, positionEvidence } = await import('../lib/v2/rosterEvidence.js');
  const { positionalOpportunity } = await import('../../shared/matching/v2/layers/positionalOpportunity.js');
  const { typicalStarters } = await import('../../shared/matching/v2/recruitingRules.js');
  const { ROSTER_COLUMNS } = await import('../lib/v2/poolContext.js');

  /** Rosters by season, indexed per sport. Loaded once. */
  const load = (sport) => {
    const rosters = new Map();
    for (const s of ROSTER_SEASONS) {
      rosters.set(s, db.prepare(`SELECT ${ROSTER_COLUMNS} FROM roster_players WHERE sport=? AND season=?`).all(sport, s));
    }
    const arrivals = db.prepare(`SELECT programme, arrival_season, canonical_position, entry_type, coach, coach_attribution
      FROM recruiting_arrivals WHERE sport=?`).all(sport);
    const colleges = db.prepare('SELECT * FROM colleges WHERE sport=? AND active=1').all(sport);
    return { rosters, arrivals, colleges };
  };

  /**
   * One transition. A player present at the position in `from` and absent from
   * the programme's roster in `to` is an OBSERVED ROSTER DEPARTURE - nothing
   * more. We do not know whether they graduated, transferred, were cut, signed
   * professionally, were injured or simply stopped being listed, and the
   * provenance to tell those apart does not exist.
   *
   * Identity is the same normalised name key the projection job uses, within
   * one programme. A player whose name is spelled differently across two
   * seasons reads as a departure AND an arrival, which inflates both sides;
   * A7.10.1 checked nine such cases by hand and found no spelling failures.
   */
  const transition = (rosters, from, to) => {
    const prev = rosters.get(from) ?? [];
    const cur = rosters.get(to) ?? [];
    if (!prev.length || !cur.length) return null;
    const stayed = new Set(cur.map((r) => `${r.college_name}|${norm(r.player_name)}`));
    const out = new Map();     // programme|POS -> { prior, left, unreadable }
    for (const r of prev) {
      const p = readPos(r.position);
      const k = `${r.college_name}|${p ?? 'UNREADABLE'}`;
      if (!out.has(k)) out.set(k, { prior: 0, left: 0 });
      const e = out.get(k);
      e.prior += 1;
      if (!stayed.has(`${r.college_name}|${norm(r.player_name)}`)) e.left += 1;
    }
    return out;
  };

  /** Arrivals at a programme/position in one season, with type split. */
  const arrivalsBy = (arrivals, season) => {
    const m = new Map();
    for (const a of arrivals) {
      if (Number(a.arrival_season) !== season) continue;
      const p = String(a.canonical_position || '').toUpperCase();
      if (!POS.includes(p)) continue;
      const k = `${a.programme}|${p}`;
      if (!m.has(k)) m.set(k, { n: 0, fresh: 0, exp: 0 });
      const e = m.get(k); e.n += 1;
      if (a.entry_type === 'FRESHMAN') e.fresh += 1;
      else if (a.entry_type === 'EXPERIENCED') e.exp += 1;
    }
    return m;
  };

  // ---------------------------------------------------------------- coverage
  if (args.includes('--coverage')) {
    console.log('== 3/24. HISTORICAL TURNOVER COVERAGE\n');
    for (const sport of SPORTS) {
      const { rosters, colleges } = load(sport);
      const byDiv = new Map(colleges.map((c) => [c.name, c.division]));
      console.log(`-- ${sport}`);
      const windows = [['2022', '2023'], ['2023', '2024'], ['2024', '2025'], ['2025', '2026']];
      const counts = new Map();   // programme|POS -> transitions observed
      for (const [a, b] of windows) {
        const t = transition(rosters, a, b);
        if (!t) { console.log(`   ${a}->${b}: no roster`); continue; }
        const cells = [...t.entries()].filter(([k]) => !k.endsWith('|UNREADABLE'));
        const left = cells.reduce((s, [, v]) => s + v.left, 0);
        const prior = cells.reduce((s, [, v]) => s + v.prior, 0);
        console.log(`   ${a}->${b}: ${cells.length} programme-position cells   departures ${left} of ${prior} prior players  ${pc(left, prior)}`);
        for (const [k] of cells) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const dist = { 4: 0, 3: 0, 2: 0, 1: 0 };
      for (const n of counts.values()) dist[n] = (dist[n] ?? 0) + 1;
      const universe = colleges.length * 4;
      const observed = counts.size;
      console.log(`   cells with 4 transitions ${dist[4] ?? 0}   3 ${dist[3] ?? 0}   2 ${dist[2] ?? 0}   1 ${dist[1] ?? 0}`);
      console.log(`   eligible universe ${universe} cells; ${observed} have any history ${pc(observed, universe)}; ${universe - observed} have none`);
      const three = [...counts.entries()].filter(([, n]) => n >= 3);
      console.log(`   with 3+ transitions: ${three.length}  ${pc(three.length, universe)}`);
      const divTally = {};
      for (const [k, n] of counts) {
        const d = byDiv.get(k.split('|')[0]) ?? 'not eligible';
        divTally[d] = divTally[d] ?? { cells: 0, three: 0 };
        divTally[d].cells += 1; if (n >= 3) divTally[d].three += 1;
      }
      console.log(`   ${'division'.padEnd(14)}${'cells'.padStart(8)}${'3+ transitions'.padStart(16)}`);
      for (const [d, v] of Object.entries(divTally).sort((a, b) => b[1].cells - a[1].cells)) {
        console.log(`   ${d.padEnd(14)}${String(v.cells).padStart(8)}${`${v.three} (${pc(v.three, v.cells)})`.padStart(16)}`);
      }
      console.log('');
    }
  }

  /**
   * Build the chronology-safe panel.
   *
   * Turnover is observed from rosters `from`->`to`. The outcome is arrivals in
   * a LATER season than `to`, so the roster that produced the turnover cannot
   * contain the recruits being predicted. The production positional value is
   * computed at `to` with arrivals known only up to `to`.
   */
  const panel = (sport, from, to, outcomeSeason) => {
    const { rosters, arrivals, colleges } = load(sport);
    const t = transition(rosters, from, to);
    if (!t) return [];
    const cur = rosters.get(to);
    const known = arrivals.filter((a) => Number(a.arrival_season) <= Number(to));
    const idx = buildPositionIndex(cur);
    const aidx = buildArrivalIndex(known.map((a) => ({ ...a })));
    const horizon = known.reduce((m, r) => Math.max(m, Number(r.arrival_season) || 0), 0);
    const got = arrivalsBy(arrivals, outcomeSeason);
    const onFile = new Set(arrivals.filter((a) => Number(a.arrival_season) === outcomeSeason).map((a) => a.programme));
    const rows = [];
    for (const c of colleges) {
      if (!onFile.has(c.name)) continue;   // otherwise "0 recruits" is missing data
      const rosterRows = idx.get(c.name)?.rows ?? 0;
      for (const position of POS) {
        const tv = t.get(`${c.name}|${position}`);
        if (!tv) continue;                  // no prior-season presence: unscoreable turnover
        const ev = positionEvidence({
          programme: c.name, position, sport, division: c.division, entryYear: Number(to) + 1,
          rosterIndex: idx, arrivalIndex: aidx, arrivalsHorizon: horizon,
        });
        const r = positionalOpportunity({ sport, position, evidence: ev });
        const places = typicalStarters(sport, position) ?? 1;
        const o = got.get(`${c.name}|${position}`) ?? { n: 0, fresh: 0, exp: 0 };
        const progLeft = POS.reduce((s, p) => s + (t.get(`${c.name}|${p}`)?.left ?? 0), 0);
        const progPrior = POS.reduce((s, p) => s + (t.get(`${c.name}|${p}`)?.prior ?? 0), 0);
        rows.push({
          name: c.name, division: c.division, position, strength: c.soccer_score, rosterRows,
          // --- candidate raw measures ---
          A_count: tv.left,
          B_share: tv.prior ? tv.left / tv.prior : null,
          C_perStarter: tv.left / places,
          priorSize: tv.prior,
          progShare: progPrior ? progLeft / progPrior : null,
          // --- production comparators ---
          posValue: r.ok === false ? null : r.value,
          vacated: ev.vacatedStarters,
          departingAll: ev.starterEvidence.departing,
          // --- outcome ---
          got: o.n, fresh: o.fresh, exp: o.exp,
        });
      }
    }
    return rows;
  };

  // ---------------------------------------------------------------- predict
  if (args.includes('--predict')) {
    console.log('== 5/6/7/14. PREDICTIVE PERFORMANCE, chronology-safe\n');
    console.log('   Turnover observed from rosters (from -> to). Outcome is arrivals in a season');
    console.log('   strictly later than `to`, so the roster cannot contain the recruits predicted.\n');
    for (const sport of SPORTS) {
      console.log(`== ${sport}`);
      const WINDOWS = [
        ['2022', '2023', 2024, 'h=1'], ['2023', '2024', 2025, 'h=1'], ['2024', '2025', 2026, 'h=1'],
        ['2022', '2023', 2025, 'h=2'], ['2023', '2024', 2026, 'h=2'],
      ];
      for (const [from, to, out, h] of WINDOWS) {
        const rows = panel(sport, from, to, out);
        if (rows.length < 50) { console.log(`  ${from}->${to} => ${out}: too few cells (${rows.length})`); continue; }
        const scored = rows.filter((r) => r.posValue !== null);
        const num = (f) => spear(rows.map(f), rows.map((r) => r.got));
        console.log(`  turnover ${from}->${to}  predicts arrivals ${out}  (${h})  ${rows.length} cells, ${scored.length} with a production value`);
        console.log(`     ${'measure'.padEnd(34)}${'vs count'.padStart(10)}${'vs >=1'.padStart(9)}${'vs 2+'.padStart(9)}${'vs freshman'.padStart(13)}${'vs experienced'.padStart(15)}`);
        const show = (label, f) => {
          console.log(`     ${label.padEnd(34)}${fmt(num(f)).padStart(10)}`
            + `${fmt(spear(rows.map(f), rows.map((r) => (r.got > 0 ? 1 : 0)))).padStart(9)}`
            + `${fmt(spear(rows.map(f), rows.map((r) => (r.got >= 2 ? 1 : 0)))).padStart(9)}`
            + `${fmt(spear(rows.map(f), rows.map((r) => r.fresh))).padStart(13)}`
            + `${fmt(spear(rows.map(f), rows.map((r) => r.exp))).padStart(15)}`);
        };
        show('A. departure count', (r) => r.A_count);
        show('B. departure share of position', (r) => r.B_share ?? 0);
        show('C. departures / typicalStarters', (r) => r.C_perStarter);
        show('   programme-wide departure share', (r) => r.progShare ?? 0);
        console.log(`     ${'--- production comparators ---'.padEnd(34)}`);
        const s = (label, f) => {
          console.log(`     ${label.padEnd(34)}${fmt(spear(scored.map(f), scored.map((r) => r.got))).padStart(10)}`
            + `${fmt(spear(scored.map(f), scored.map((r) => (r.got > 0 ? 1 : 0)))).padStart(9)}`
            + `${fmt(spear(scored.map(f), scored.map((r) => (r.got >= 2 ? 1 : 0)))).padStart(9)}`
            + `${fmt(spear(scored.map(f), scored.map((r) => r.fresh))).padStart(13)}`
            + `${fmt(spear(scored.map(f), scored.map((r) => r.exp))).padStart(15)}`);
        };
        s('   positional opportunity (live)', (r) => r.posValue);
        s('   vacatedStarters', (r) => r.vacated);
        s('   departing all, forward-looking', (r) => r.departingAll);
        // base rate
        const b1 = rows.filter((r) => r.got > 0).length;
        const b2 = rows.filter((r) => r.got >= 2).length;
        console.log(`     base rates: recruited >=1 ${pc(b1, rows.length)}   recruited 2+ ${pc(b2, rows.length)}   mean recruits ${fmt(mean(rows.map((r) => r.got)), 2)}`);
        console.log('');
      }
    }
  }

  // ---------------------------------------------------------------- stability
  if (args.includes('--stability')) {
    console.log('== 8/15/16. IS TURNOVER A REPEATABLE PROGRAMME BEHAVIOUR?\n');
    for (const sport of SPORTS) {
      const { rosters, colleges } = load(sport);
      const names = new Set(colleges.map((c) => c.name));
      const W = [['2022', '2023'], ['2023', '2024'], ['2024', '2025'], ['2025', '2026']];
      const t = W.map(([a, b]) => transition(rosters, a, b));
      const keys = new Set();
      for (const m of t) if (m) for (const k of m.keys()) if (!k.endsWith('|UNREADABLE') && names.has(k.split('|')[0])) keys.add(k);
      const series = [...keys].map((k) => ({ k, v: t.map((m) => m?.get(k) ?? null) }))
        .filter((s) => s.v.every(Boolean));
      console.log(`-- ${sport}: ${series.length} cells present in all four transitions`);
      const shareAt = (s, i) => (s.v[i].prior ? s.v[i].left / s.v[i].prior : 0);
      const countAt = (s, i) => s.v[i].left;
      const pair = (i, j, f) => spear(series.map((s) => f(s, i)), series.map((s) => f(s, j)));
      console.log(`   adjacent-window correlation (departure count):  ${[0, 1, 2].map((i) => `${W[i][1]}~${W[i + 1][1]} ${fmt(pair(i, i + 1, countAt))}`).join('   ')}`);
      console.log(`   adjacent-window correlation (departure share):  ${[0, 1, 2].map((i) => `${W[i][1]}~${W[i + 1][1]} ${fmt(pair(i, i + 1, shareAt))}`).join('   ')}`);
      console.log(`   split half, early(22-24) vs late(24-26), count: ${fmt(spear(series.map((s) => countAt(s, 0) + countAt(s, 1)), series.map((s) => countAt(s, 2) + countAt(s, 3))))}`);
      console.log(`   split half, early vs late, share:               ${fmt(spear(series.map((s) => shareAt(s, 0) + shareAt(s, 1)), series.map((s) => shareAt(s, 2) + shareAt(s, 3))))}`);
      console.log(`   median departures per transition: ${med(series.flatMap((s) => s.v.map((x) => x.left)))}   median share ${fmt(med(series.flatMap((s) => s.v.map((x) => (x.prior ? x.left / x.prior : 0)))), 2)}`);
      console.log('');
    }
  }

  // ---------------------------------------------------------------- bias
  if (args.includes('--bias')) {
    console.log('== 10/11/12. SIZE, DIVISION AND STRENGTH\n');
    for (const sport of SPORTS) {
      const rows = panel(sport, '2024', '2025', 2026);
      console.log(`-- ${sport}: ${rows.length} cells (turnover 2024->2025)`);
      const f = (k) => rows.map((r) => r[k] ?? 0);
      console.log(`   corr(departure COUNT, position-group size)  ${fmt(corr(f('A_count'), f('priorSize')))}`);
      console.log(`   corr(departure SHARE, position-group size)  ${fmt(corr(f('B_share'), f('priorSize')))}`);
      console.log(`   corr(perStarter,     position-group size)   ${fmt(corr(f('C_perStarter'), f('priorSize')))}`);
      console.log(`   corr(departure COUNT, whole roster size)    ${fmt(corr(f('A_count'), f('rosterRows')))}`);
      console.log(`   corr(departure SHARE, whole roster size)    ${fmt(corr(f('B_share'), f('rosterRows')))}`);
      const withStr = rows.filter((r) => Number.isFinite(r.strength));
      console.log(`   corr(departure COUNT, programme strength)   ${fmt(corr(withStr.map((r) => r.A_count), withStr.map((r) => r.strength)))}`);
      console.log(`   corr(departure SHARE, programme strength)   ${fmt(corr(withStr.map((r) => r.B_share ?? 0), withStr.map((r) => r.strength)))}`);
      console.log(`   ${'division'.padEnd(12)}${'n'.padStart(6)}${'medCount'.padStart(10)}${'medShare'.padStart(10)}${'medPrior'.padStart(10)}${'spear(share,recruits)'.padStart(23)}`);
      for (const d of [...new Set(rows.map((r) => r.division))].sort()) {
        const s = rows.filter((r) => r.division === d);
        if (s.length < 20) continue;
        console.log(`   ${String(d).padEnd(12)}${String(s.length).padStart(6)}${String(med(s.map((r) => r.A_count))).padStart(10)}`
          + `${fmt(med(s.map((r) => r.B_share ?? 0)), 2).padStart(10)}${String(med(s.map((r) => r.priorSize))).padStart(10)}`
          + `${fmt(spear(s.map((r) => r.B_share ?? 0), s.map((r) => r.got))).padStart(23)}`);
      }
      console.log(`   ${'position'.padEnd(12)}${'n'.padStart(6)}${'medCount'.padStart(10)}${'medShare'.padStart(10)}${'spear(share,recruits)'.padStart(23)}`);
      for (const p of POS) {
        const s = rows.filter((r) => r.position === p);
        console.log(`   ${p.padEnd(12)}${String(s.length).padStart(6)}${String(med(s.map((r) => r.A_count))).padStart(10)}`
          + `${fmt(med(s.map((r) => r.B_share ?? 0)), 2).padStart(10)}${fmt(spear(s.map((r) => r.B_share ?? 0), s.map((r) => r.got))).padStart(23)}`);
      }
      console.log('');
    }
  }

  // ---------------------------------------------------------------- independence + gain
  if (args.includes('--independence') || args.includes('--gain')) {
    console.log('== 20/21/22. INDEPENDENCE AND INFORMATION GAIN\n');
    for (const sport of SPORTS) {
      const rows = panel(sport, '2024', '2025', 2026).filter((r) => r.posValue !== null);
      console.log(`-- ${sport}: ${rows.length} cells with both a turnover observation and a production value`);
      console.log(`   corr(turnover share, positional opportunity) ${fmt(corr(rows.map((r) => r.B_share ?? 0), rows.map((r) => r.posValue)))}`);
      console.log(`   corr(turnover count, positional opportunity) ${fmt(corr(rows.map((r) => r.A_count), rows.map((r) => r.posValue)))}`);
      console.log(`   corr(turnover count, vacatedStarters)        ${fmt(corr(rows.map((r) => r.A_count), rows.map((r) => r.vacated)))}`);
      console.log(`   corr(turnover count, departing forward)      ${fmt(corr(rows.map((r) => r.A_count), rows.map((r) => r.departingAll)))}`);
      const ws = rows.filter((r) => Number.isFinite(r.strength));
      console.log(`   corr(turnover share, programme strength)     ${fmt(corr(ws.map((r) => r.B_share ?? 0), ws.map((r) => r.strength)))}`);

      /** 2D: does turnover still matter inside a band of the production value? */
      const pb = [['pos = 0', (r) => r.posValue === 0], ['0 < pos <= .25', (r) => r.posValue > 0 && r.posValue <= 0.25],
        ['.25 < pos <= .5', (r) => r.posValue > 0.25 && r.posValue <= 0.5], ['pos > .5', (r) => r.posValue > 0.5]];
      const tb = [['low (0)', (r) => r.A_count === 0], ['1-2', (r) => r.A_count >= 1 && r.A_count <= 2],
        ['3-4', (r) => r.A_count >= 3 && r.A_count <= 4], ['5+', (r) => r.A_count >= 5]];
      console.log(`\n   mean subsequent recruits, by production value (rows) x turnover count (cols):`);
      console.log(`   ${''.padEnd(18)}${tb.map(([l]) => l.padStart(12)).join('')}${'row all'.padStart(11)}${'spear'.padStart(9)}`);
      for (const [pl, pt] of pb) {
        const sub = rows.filter(pt);
        if (!sub.length) { console.log(`   ${pl.padEnd(18)}${'(none)'.padStart(12)}`); continue; }
        const cells = tb.map(([, tt]) => {
          const s = sub.filter(tt);
          return s.length >= 10 ? `${fmt(mean(s.map((r) => r.got)), 2)}/${s.length}` : `·/${s.length}`;
        });
        console.log(`   ${pl.padEnd(18)}${cells.map((c) => c.padStart(12)).join('')}${fmt(mean(sub.map((r) => r.got)), 2).padStart(11)}`
          + `${fmt(spear(sub.map((r) => r.A_count), sub.map((r) => r.got))).padStart(9)}`);
      }
      console.log(`   ${'col spear(pos,recruits)'.padEnd(18)}${tb.map(([, tt]) => {
        const s = rows.filter(tt);
        return (s.length >= 10 ? fmt(spear(s.map((r) => r.posValue), s.map((r) => r.got))) : '·').padStart(12);
      }).join('')}`);
      console.log('');
    }
  }

  // ---------------------------------------------------------------- trace
  if (args.includes('--trace')) {
    const NAMED = ['Penn State', 'Vermont', 'Rutgers', 'Loyola Marymount', 'Furman', 'Princeton'];
    const sport = 'mens-soccer';
    const { rosters, arrivals } = load(sport);
    console.log('== 18/19. THE NAMED PROGRAMMES, MIDFIELD\n');
    const W = [['2022', '2023'], ['2023', '2024'], ['2024', '2025'], ['2025', '2026']];
    const t = W.map(([a, b]) => transition(rosters, a, b));
    console.log(`${'programme'.padEnd(20)}${W.map(([a, b]) => `${a.slice(2)}->${b.slice(2)}`.padStart(11)).join('')}${'mean'.padStart(8)}${'meanShare'.padStart(11)}  arrivals at MID by season`);
    for (const p of NAMED) {
      const cells = t.map((m) => m?.get(`${p}|MIDFIELD`) ?? null);
      const counts = cells.map((c) => (c ? c.left : null));
      const shares = cells.map((c) => (c && c.prior ? c.left / c.prior : null)).filter((x) => x !== null);
      const arr = {};
      for (const a of arrivals) {
        if (String(a.canonical_position || '').toUpperCase() !== 'MIDFIELD' || a.programme !== p) continue;
        arr[a.arrival_season] = (arr[a.arrival_season] ?? 0) + 1;
      }
      console.log(`${p.padEnd(20)}${cells.map((c) => (c ? `${c.left}/${c.prior}` : '—').padStart(11)).join('')}`
        + `${fmt(mean(counts.filter((x) => x !== null)), 1).padStart(8)}${fmt(mean(shares), 2).padStart(11)}  `
        + Object.entries(arr).sort().map(([s, n]) => `${s}:${n}`).join(' '));
    }
    console.log('\n-- Penn State midfield, player by player');
    for (const [a, b] of [['2025', '2026']]) {
      const prev = (rosters.get(a) ?? []).filter((r) => r.college_name === 'Penn State' && readPos(r.position) === 'MIDFIELD');
      const cur = (rosters.get(b) ?? []).filter((r) => r.college_name === 'Penn State' && readPos(r.position) === 'MIDFIELD');
      const stayed = new Set(cur.map((r) => norm(r.player_name)));
      console.log(`   ${a} midfield (${prev.length}): ${prev.map((r) => `${r.player_name}(${r.minutes_played}${stayed.has(norm(r.player_name)) ? ', STAYED' : ', GONE'})`).join('  ')}`);
      console.log(`   ${b} midfield (${cur.length}): ${cur.map((r) => r.player_name).join('  ')}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
