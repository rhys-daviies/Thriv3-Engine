/**
 * A7.11: the three structural issues left in positional Recruitability -
 * quantisation, horizon behaviour, and the D1/D3 gap.
 *
 * READ-ONLY AND DIAGNOSTIC. No production scorer, weight, threshold or
 * calibration is touched, and nothing is persisted. NO NEW EVIDENCE SOURCE is
 * introduced: every number below comes from inputs the layer already reads.
 *
 *   node server/scripts/v2PositionalStructure.js --distribution
 *   node server/scripts/v2PositionalStructure.js --quantisation
 *   node server/scripts/v2PositionalStructure.js --buckets
 *   node server/scripts/v2PositionalStructure.js --horizon
 *   node server/scripts/v2PositionalStructure.js --claims
 *   node server/scripts/v2PositionalStructure.js --eligibility
 *   node server/scripts/v2PositionalStructure.js --matched
 */
const POS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];
const SPORTS = ['mens-soccer', 'womens-soccer'];
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const pc = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const med = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
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
const corr = (x, y) => {
  if (x.length < 3) return null;
  const mx = mean(x); const my = mean(y);
  let a = 0; let b = 0; let c = 0;
  for (let i = 0; i < x.length; i += 1) { const dx = x[i] - mx; const dy = y[i] - my; a += dx * dy; b += dx * dx; c += dy * dy; }
  return (b === 0 || c === 0) ? null : a / Math.sqrt(b * c);
};
const spear = (x, y) => corr(rk(x), rk(y));

async function main() {
  const args = process.argv.slice(2);
  const { default: db } = await import('../db/client.js');
  const { buildPoolContext, ROSTER_COLUMNS } = await import('../lib/v2/poolContext.js');
  const { buildPositionIndex, buildArrivalIndex, positionEvidence } = await import('../lib/v2/rosterEvidence.js');
  const { positionalOpportunity } = await import('../../shared/matching/v2/layers/positionalOpportunity.js');
  const { typicalStarters, typicalStartersEvidence, fillPropensity, ARRIVAL_CLAIM_WEIGHT, MAX_CLAIM_SHARE } = await import('../../shared/matching/v2/recruitingRules.js');

  const ctxCache = new Map();
  const ctxFor = (sport) => {
    if (!ctxCache.has(sport)) ctxCache.set(sport, buildPoolContext({ db, sport, season: '2026' }));
    return ctxCache.get(sport);
  };

  const sweep = (sport, entryYear) => {
    const ctx = ctxFor(sport);
    const out = [];
    for (const c of ctx.colleges) {
      for (const position of POS) {
        const ev = positionEvidence({
          programme: c.name, position, sport, division: c.division, entryYear,
          rosterIndex: ctx.rosterIndex, arrivalIndex: ctx.arrivalIndex, arrivalsHorizon: ctx.arrivalsHorizon,
        });
        const r = positionalOpportunity({ sport, position, evidence: ev });
        out.push({ college: c, position, ev, r, value: r.ok === false ? null : r.value });
      }
    }
    return out;
  };

  // --------------------------------------------------------- distribution
  if (args.includes('--distribution')) {
    console.log('== 2. VALUE DISTRIBUTION, entry year 2028, roster season 2026\n');
    for (const sport of SPORTS) {
      const rows = sweep(sport, 2028).filter((r) => r.value !== null);
      const vals = rows.map((r) => r.value);
      const bands = [['exact 0', (v) => v === 0], ['0 - .10', (v) => v > 0 && v <= 0.10],
        ['.10 - .20', (v) => v > 0.10 && v <= 0.20], ['.20 - .30', (v) => v > 0.20 && v <= 0.30],
        ['.30 - .50', (v) => v > 0.30 && v <= 0.50], ['.50 - .75', (v) => v > 0.50 && v <= 0.75],
        ['.75 - <1', (v) => v > 0.75 && v < 1], ['exact 1', (v) => v === 1]];
      console.log(`-- ${sport}: ${rows.length} scored cells`);
      for (const [l, t] of bands) console.log(`   ${l.padEnd(12)}${String(vals.filter(t).length).padStart(7)}  ${pc(vals.filter(t).length, vals.length)}`);
      const uniq = new Map();
      for (const v of vals) uniq.set(Number(v.toFixed(6)), (uniq.get(Number(v.toFixed(6))) ?? 0) + 1);
      console.log(`   DISTINCT VALUES: ${uniq.size} across ${vals.length} cells`);
      const top = [...uniq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
      console.log(`   most common: ${top.map(([v, n]) => `${fmt(v)}x${n}`).join('  ')}`);
      console.log(`   ${'position'.padEnd(12)}${'n'.padStart(6)}${'distinct'.padStart(10)}${'zero'.padStart(8)}${'median'.padStart(9)}  first three positive values`);
      for (const p of POS) {
        const s = rows.filter((r) => r.position === p).map((r) => r.value);
        const u = [...new Set(s.map((v) => Number(v.toFixed(6))))].sort((a, b) => a - b);
        console.log(`   ${p.padEnd(12)}${String(s.length).padStart(6)}${String(u.length).padStart(10)}${String(s.filter((v) => v === 0).length).padStart(8)}${fmt(med(s)).padStart(9)}  ${u.filter((v) => v > 0).slice(0, 3).map((v) => fmt(v)).join('  ')}`);
      }
      console.log(`   ${'division'.padEnd(12)}${'n'.padStart(6)}${'distinct'.padStart(10)}${'zero'.padStart(8)}${'median'.padStart(9)}`);
      for (const d of [...new Set(rows.map((r) => r.college.division))].sort()) {
        const s = rows.filter((r) => r.college.division === d).map((r) => r.value);
        const u = new Set(s.map((v) => Number(v.toFixed(6))));
        console.log(`   ${String(d).padEnd(12)}${String(s.length).padStart(6)}${String(u.size).padStart(10)}${String(s.filter((v) => v === 0).length).padStart(8)}${fmt(med(s)).padStart(9)}`);
      }
      console.log('');
    }
  }

  // --------------------------------------------------------- quantisation
  if (args.includes('--quantisation')) {
    console.log('== 3/15/16. WHY THE VALUE IS DISCRETE\n');
    console.log('   value = clamp01((vacatedStarters x fillRate - claims) / typicalStarters)\n');
    console.log('   THREE OF THE FOUR TERMS ARE DISCRETE OR CONSTANT:');
    console.log('     vacatedStarters   a COUNT of players. Integer, and usually 0-6.');
    console.log('     typicalStarters   an INTEGER constant per sport and position.');
    console.log('     fillRate          a CONSTANT per division and position - see below.');
    console.log('     claims            0.6 x arrivals, but zero beyond the arrivals horizon.\n');
    console.log(`   typicalStarters (the denominator), and its own evidence:`);
    for (const sport of SPORTS) {
      for (const p of POS) {
        const e = typicalStartersEvidence(sport, p);
        console.log(`     ${sport.padEnd(15)}${p.padEnd(12)}${String(typicalStarters(sport, p)).padStart(3)}`
          + `   mean ${fmt(e?.mean, 2)}  p25 ${e?.p25}  p75 ${e?.p75}  programmeSeasons ${e?.programmeSeasons}  shareAtMedian ${fmt(e?.shareAtMedian, 2)}`);
      }
    }
    console.log(`\n   fillRate resolution. PROGRAMME-level rates exist in the norms but are never used:`);
    const norms = JSON.parse((await import('node:fs')).readFileSync(new URL('../../shared/matching/v2/calibration/positionalNorms.data.json', import.meta.url), 'utf8'));
    console.log(`     programme entries: ${Object.keys(norms.fillPropensity.programme).length}`);
    console.log(`     programmeEvidence: ${JSON.stringify(norms.fillPropensity.programmeEvidence)}`);
    console.log(`     division entries: ${Object.keys(norms.fillPropensity.division).length}   sport entries: ${Object.keys(norms.fillPropensity.sport).length}`);
    console.log(`\n   so EVERY cell in a division-position shares one rate, and the whole value ladder is:`);
    for (const sport of SPORTS) {
      for (const div of ['NCAA D1', 'NCAA D3']) {
        for (const p of ['GOALKEEPER', 'MIDFIELD']) {
          const f = fillPropensity({ sport, division: div, position: p, programme: '—' });
          const places = typicalStarters(sport, p);
          const ladder = [0, 1, 2, 3, 4, 5, 6].map((v) => Math.min(1, (v * (f?.rate ?? 0)) / places));
          console.log(`     ${sport.slice(0, 5)} ${div.padEnd(8)} ${p.padEnd(11)} fill ${fmt(f?.rate, 3)} / places ${places}  ->  ${ladder.map((x) => fmt(x, 3)).join('  ')}`);
        }
      }
    }
    console.log(`\n   FIRST POSITIVE VALUE = fillRate / typicalStarters. Nothing can land between 0 and it.`);
    console.log(`   claim weights: ARRIVAL_CLAIM_WEIGHT ${ARRIVAL_CLAIM_WEIGHT}  MAX_CLAIM_SHARE ${MAX_CLAIM_SHARE}`);
  }

  // --------------------------------------------------------- buckets
  if (args.includes('--buckets')) {
    console.log('== 4. DO THE DISCRETE STEPS MATCH DISCRETE OUTCOMES?\n');
    console.log('   Chronology-safe: evidence from the season T roster, outcome = arrivals at T+1.\n');
    for (const sport of SPORTS) {
      const arrivals = db.prepare('SELECT programme, arrival_season, canonical_position FROM recruiting_arrivals WHERE sport=?').all(sport);
      const colleges = db.prepare('SELECT * FROM colleges WHERE sport=? AND active=1').all(sport);
      console.log(`== ${sport}`);
      for (const T of [2024, 2025]) {
        const roster = db.prepare(`SELECT ${ROSTER_COLUMNS} FROM roster_players WHERE sport=? AND season=?`).all(sport, String(T));
        if (!roster.length) continue;
        const known = arrivals.filter((a) => Number(a.arrival_season) <= T);
        const idx = buildPositionIndex(roster); const aidx = buildArrivalIndex(known);
        const horizon = known.reduce((m, r) => Math.max(m, Number(r.arrival_season) || 0), 0);
        const got = new Map();
        for (const a of arrivals) {
          if (Number(a.arrival_season) !== T + 1) continue;
          const p = String(a.canonical_position || '').toUpperCase(); if (!POS.includes(p)) continue;
          got.set(`${a.programme}|${p}`, (got.get(`${a.programme}|${p}`) || 0) + 1);
        }
        const onFile = new Set(arrivals.filter((a) => Number(a.arrival_season) === T + 1).map((a) => a.programme));
        const cells = [];
        for (const c of colleges) {
          if (!onFile.has(c.name)) continue;
          for (const position of POS) {
            const ev = positionEvidence({ programme: c.name, position, sport, division: c.division, entryYear: T + 1, rosterIndex: idx, arrivalIndex: aidx, arrivalsHorizon: horizon });
            const r = positionalOpportunity({ sport, position, evidence: ev });
            if (r.ok === false) continue;
            cells.push({ v: Number(r.value.toFixed(6)), vac: ev.vacatedStarters, got: got.get(`${c.name}|${position}`) ?? 0, posRows: ev.positionRows });
          }
        }
        console.log(`  T=${T} -> ${T + 1}: ${cells.length} cells`);
        console.log(`     ${'vacatedStarters'.padEnd(18)}${'n'.padStart(7)}${'mean recruits'.padStart(15)}${'median'.padStart(9)}${'step'.padStart(9)}`);
        let prev = null;
        for (const k of [0, 1, 2, 3, 4, 5]) {
          const s = cells.filter((c) => c.vac === k);
          if (s.length < 25) { console.log(`     ${String(k).padEnd(18)}${String(s.length).padStart(7)}  (too few)`); continue; }
          const m = mean(s.map((c) => c.got));
          console.log(`     ${String(k).padEnd(18)}${String(s.length).padStart(7)}${fmt(m, 2).padStart(15)}${String(med(s.map((c) => c.got))).padStart(9)}${(prev === null ? '—' : `+${fmt(m - prev, 2)}`).padStart(9)}`);
          prev = m;
        }
        /** Does the outcome move smoothly INSIDE a step? If it does, the step is hiding resolution. */
        console.log(`     within a single vacated-starter count, does group size still order the outcome?`);
        for (const k of [0, 1, 2]) {
          const s = cells.filter((c) => c.vac === k);
          if (s.length < 60) continue;
          console.log(`        vacated=${k}: n ${String(s.length).padStart(5)}  spear(positionRows, recruits) ${fmt(spear(s.map((c) => c.posRows), s.map((c) => c.got)))}`);
        }
        console.log('');
      }
    }
  }

  // --------------------------------------------------------- horizon
  if (args.includes('--horizon')) {
    console.log('== 6/7/9/19. HORIZON BEHAVIOUR, PER CELL\n');
    const YEARS = [2026, 2027, 2028, 2029, 2030];
    for (const sport of SPORTS) {
      const byYear = new Map(YEARS.map((y) => [y, sweep(sport, y)]));
      const n = byYear.get(2026).length;
      console.log(`-- ${sport}: ${n} cells x ${YEARS.length} entry years`);
      console.log(`   ${'entry'.padEnd(7)}${'MEAS'.padStart(7)}${'PART'.padStart(7)}${'UNSC'.padStart(7)}${'zero'.padStart(7)}${'median'.padStart(9)}${'mean'.padStart(8)}${'depart'.padStart(9)}${'vacSt'.padStart(8)}${'depUnk'.padStart(9)}`);
      for (const y of YEARS) {
        const rows = byYear.get(y);
        const ok = rows.filter((r) => r.value !== null);
        console.log(`   ${String(y).padEnd(7)}${String(ok.filter((r) => r.r.grade === 'MEASURED').length).padStart(7)}`
          + `${String(ok.filter((r) => r.r.grade === 'PARTIAL').length).padStart(7)}${String(rows.length - ok.length).padStart(7)}`
          + `${String(ok.filter((r) => r.value === 0).length).padStart(7)}${fmt(med(ok.map((r) => r.value))).padStart(9)}${fmt(mean(ok.map((r) => r.value))).padStart(8)}`
          + `${fmt(mean(rows.map((r) => r.ev.starterEvidence.departing)), 2).padStart(9)}`
          + `${fmt(mean(rows.map((r) => r.ev.vacatedStarters)), 2).padStart(8)}`
          + `${fmt(mean(rows.map((r) => r.ev.starterEvidence.departingUnknown)), 2).padStart(9)}`);
      }
      /** THE BACKWARDS TEST: does any cell score LOWER for a later entry year? */
      let drops = 0; let flat = 0; let rises = 0; let worst = null;
      const dropPairs = {};
      for (let i = 0; i < n; i += 1) {
        const series = YEARS.map((y) => byYear.get(y)[i]);
        for (let j = 0; j + 1 < series.length; j += 1) {
          const a = series[j]; const b = series[j + 1];
          if (a.value === null || b.value === null) continue;
          if (b.value < a.value - 1e-9) {
            drops += 1;
            const k = `${YEARS[j]}->${YEARS[j + 1]}`;
            dropPairs[k] = (dropPairs[k] ?? 0) + 1;
            const d = a.value - b.value;
            if (!worst || d > worst.d) worst = { d, name: a.college.name, position: a.position, from: YEARS[j], to: YEARS[j + 1], a: a.value, b: b.value, aArr: a.ev.arrivals, bArr: b.ev.arrivals, aApp: a.ev.arrivalsApplicable, bApp: b.ev.arrivalsApplicable };
          } else if (Math.abs(b.value - a.value) < 1e-9) flat += 1; else rises += 1;
        }
      }
      console.log(`\n   year-on-year transitions: rises ${rises}   flat ${flat}   DROPS ${drops}  ${pc(drops, rises + flat + drops)}`);
      console.log(`   drops by transition: ${JSON.stringify(dropPairs)}`);
      if (worst) {
        console.log(`   largest drop: ${worst.name} ${worst.position} ${worst.from}->${worst.to}  ${fmt(worst.a)} -> ${fmt(worst.b)}`);
        console.log(`      arrivals ${worst.aArr}->${worst.bArr}   arrivalsApplicable ${worst.aApp}->${worst.bApp}`);
      }
      console.log('');
    }
  }

  // --------------------------------------------------------- claims
  if (args.includes('--claims')) {
    console.log('== 17/18. ARRIVAL CLAIMS ACROSS THE HORIZON\n');
    for (const sport of SPORTS) {
      const ctx = ctxFor(sport);
      console.log(`-- ${sport}: arrivals horizon ${ctx.arrivalsHorizon}`);
      console.log(`   ${'entry'.padEnd(7)}${'applicable'.padStart(12)}${'cells w/ claims>0'.padStart(19)}${'mean claim'.padStart(12)}${'mean arrivals'.padStart(15)}${'value lost to claims'.padStart(22)}`);
      for (const y of [2026, 2027, 2028, 2029]) {
        const rows = sweep(sport, y).filter((r) => r.value !== null);
        const withClaim = rows.filter((r) => (r.r.basis.claims ?? 0) > 0);
        const lost = rows.map((r) => (r.r.basis.claims ?? 0) / r.r.basis.typicalStarters);
        console.log(`   ${String(y).padEnd(7)}${String(rows[0]?.ev.arrivalsApplicable).padStart(12)}${String(withClaim.length).padStart(19)}`
          + `${fmt(mean(rows.map((r) => r.r.basis.claims ?? 0)), 3).padStart(12)}${fmt(mean(rows.map((r) => r.ev.arrivals ?? 0)), 2).padStart(15)}${fmt(mean(lost), 4).padStart(22)}`);
      }
      console.log('');
    }
  }

  // --------------------------------------------------------- eligibility
  if (args.includes('--eligibility') || args.includes('--matched')) {
    console.log('== 11/12/13/14. ELIGIBILITY STRUCTURE AND THE DIVISION GAP\n');
    for (const sport of SPORTS) {
      const rows = sweep(sport, 2028).filter((r) => r.value !== null);
      console.log(`-- ${sport}, entry 2028`);
      console.log(`   ${'division'.padEnd(12)}${'n'.padStart(6)}${'medValue'.padStart(10)}${'medDepart'.padStart(11)}${'medVacSt'.padStart(10)}${'medRemain'.padStart(11)}${'medPosRows'.padStart(12)}${'medFill'.padStart(9)}${'depUnk%'.padStart(9)}`);
      for (const d of [...new Set(rows.map((r) => r.college.division))].sort()) {
        const s = rows.filter((r) => r.college.division === d);
        if (s.length < 20) continue;
        const unk = s.reduce((t, r) => t + r.ev.starterEvidence.departingUnknown, 0);
        const dep = s.reduce((t, r) => t + r.ev.starterEvidence.departing, 0);
        console.log(`   ${String(d).padEnd(12)}${String(s.length).padStart(6)}${fmt(med(s.map((r) => r.value))).padStart(10)}`
          + `${String(med(s.map((r) => r.ev.starterEvidence.departing))).padStart(11)}${String(med(s.map((r) => r.ev.vacatedStarters))).padStart(10)}`
          + `${String(med(s.map((r) => r.ev.eligibleToRemain))).padStart(11)}${String(med(s.map((r) => r.ev.positionRows))).padStart(12)}`
          + `${fmt(med(s.map((r) => r.ev.fill?.rate)), 3).padStart(9)}${pc(unk, dep).padStart(9)}`);
      }
      /** Matched: same position, same position-group size band, same entry year. */
      console.log(`\n   MATCHED D1 vs D3, same position and same position-group size:`);
      console.log(`   ${'position'.padEnd(12)}${'group'.padEnd(8)}${'D1 n'.padStart(6)}${'D1 vacSt'.padStart(10)}${'D1 value'.padStart(10)}${'D3 n'.padStart(6)}${'D3 vacSt'.padStart(10)}${'D3 value'.padStart(10)}${'gap'.padStart(8)}`);
      for (const p of POS) {
        for (const [lab, lo, hi] of [['4-6', 4, 6], ['7-9', 7, 9], ['10+', 10, 99]]) {
          const pick = (d) => rows.filter((r) => r.college.division === d && r.position === p && r.ev.positionRows >= lo && r.ev.positionRows <= hi);
          const a = pick('NCAA D1'); const b = pick('NCAA D3');
          if (a.length < 15 || b.length < 15) continue;
          const av = med(a.map((r) => r.value)); const bv = med(b.map((r) => r.value));
          console.log(`   ${p.padEnd(12)}${lab.padEnd(8)}${String(a.length).padStart(6)}${fmt(med(a.map((r) => r.ev.vacatedStarters)), 1).padStart(10)}${fmt(av).padStart(10)}`
            + `${String(b.length).padStart(6)}${fmt(med(b.map((r) => r.ev.vacatedStarters)), 1).padStart(10)}${fmt(bv).padStart(10)}${fmt(bv - av).padStart(8)}`);
        }
      }
      console.log('');
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
