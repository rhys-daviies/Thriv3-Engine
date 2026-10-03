/**
 * A7.10: whether a positional zero is a measurement or a silence.
 *
 * READ-ONLY AND DIAGNOSTIC. No production scorer, weight, threshold or
 * calibration is touched, and nothing is persisted.
 *
 *   node server/scripts/v2PositionalEvidence.js --trace
 *   node server/scripts/v2PositionalEvidence.js --source
 *   node server/scripts/v2PositionalEvidence.js --taxonomy
 *   node server/scripts/v2PositionalEvidence.js --universe
 *   node server/scripts/v2PositionalEvidence.js --zero-vs-unscoreable
 *   node server/scripts/v2PositionalEvidence.js --horizon
 *   node server/scripts/v2PositionalEvidence.js --positions
 *   node server/scripts/v2PositionalEvidence.js --bias
 *   node server/scripts/v2PositionalEvidence.js --independence
 *   node server/scripts/v2PositionalEvidence.js --sanity
 */
const SEASON = '2026';
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const med = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const corr = (xs, ys) => {
  if (xs.length < 3) return null;
  const mx = mean(xs); const my = mean(ys);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < xs.length; i += 1) { const dx = xs[i] - mx; const dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return (sxx === 0 || syy === 0) ? null : sxy / Math.sqrt(sxx * syy);
};
const rankOf = (a) => {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
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
const spearman = (xs, ys) => corr(rankOf(xs), rankOf(ys));

async function main() {
  const args = process.argv.slice(2);
  const arg = (k, d = null) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
  const { default: db } = await import('../db/client.js');
  const { buildPoolContext, ROSTER_COLUMNS } = await import('../lib/v2/poolContext.js');
  const {
    positionEvidence, buildPositionIndex, buildArrivalIndex, starterState, STARTER_STATE,
  } = await import('../lib/v2/rosterEvidence.js');
  const { positionalOpportunity } = await import('../../shared/matching/v2/layers/positionalOpportunity.js');
  const { typicalStarters, fillPropensity } = await import('../../shared/matching/v2/recruitingRules.js');
  const { canonicalPosition } = await import('../../shared/positions.js');
  /** Same guard rosterEvidence.js uses: 'UNKNOWN' is not a position. */
  const readPosition = (raw) => { const p = canonicalPosition(raw); return p && p !== 'UNKNOWN' ? p : null; };

  const SPORTS = ['mens-soccer', 'womens-soccer'];
  const ctxCache = new Map();
  const ctxFor = (sport) => {
    if (!ctxCache.has(sport)) ctxCache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
    return ctxCache.get(sport);
  };

  /** The layer's own result for one programme/position/entry year. */
  const evaluate = ({ sport, programme, position, division, entryYear, ctx }) => {
    const evidence = positionEvidence({
      programme, position, sport, division, entryYear,
      rosterIndex: ctx.rosterIndex, arrivalIndex: ctx.arrivalIndex, arrivalsHorizon: ctx.arrivalsHorizon,
    });
    return { evidence, result: positionalOpportunity({ sport, position, evidence }) };
  };

  /**
   * WHY a cell came out as it did, as one label. The refusal reasons are the
   * layer's own; the zero causes are read off the same evidence the layer saw,
   * in the order the layer would have hit them.
   */
  const classify = ({ evidence, result }) => {
    if (result.ok === false) {
      switch (result.reason) {
        case 'NO_ROSTER_ON_FILE':
          return evidence.rosterOnFile ? 'G2_NO_FILL_PROPENSITY' : 'G_NO_ROSTER';
        case 'NO_ELIGIBILITY_RULE': return 'E2_NO_ELIGIBILITY_RULE';
        case 'NO_CLASS_LABELS': return 'F_NO_POSITION_ROWS';
        case 'NO_MINUTES_HISTORY': return 'D_NO_STARTER_EVIDENCE';
        case 'NO_PROGRAMME_LEVEL': return 'J_NO_TYPICAL_STARTERS';
        default: return `J_${result.reason}`;
      }
    }
    if (result.value > 0) return 'NONZERO';
    const b = result.basis;
    if (b.vacatedStarters === 0 && b.starterEvidence?.departing === 0) return 'C_NOBODY_DEPARTS';
    if (b.vacatedStarters === 0) return 'A_DEPARTERS_NONE_STARTED';
    if (b.claims > 0) return 'B_ARRIVALS_CONSUME';
    return 'J_OTHER_ZERO';
  };

  const CAUSE_LABEL = {
    NONZERO: 'scored above zero',
    A_DEPARTERS_NONE_STARTED: 'A. readable departures, none of them held a starting place',
    B_ARRIVALS_CONSUME: 'B. arrivals already claim the expected place',
    C_NOBODY_DEPARTS: 'C. roster readable, nobody at the position departs by the entry year',
    D_NO_STARTER_EVIDENCE: 'D. departing cohort exists, none of it could be placed (refused)',
    E2_NO_ELIGIBILITY_RULE: 'E. no eligibility rule for the association (refused)',
    F_NO_POSITION_ROWS: 'F. roster on file, nobody readable at this position (refused)',
    G_NO_ROSTER: 'G. no roster on file (refused)',
    G2_NO_FILL_PROPENSITY: 'G2. roster on file but no fill propensity (refused)',
    J_NO_TYPICAL_STARTERS: 'J. no typicalStarters for this sport/position (refused)',
  };

  /** Every eligible programme for one sport, at one position and entry year. */
  const sweep = ({ sport, position, entryYear }) => {
    const ctx = ctxFor(sport);
    return ctx.colleges.map((c) => {
      const e = evaluate({ sport, programme: c.name, position, division: c.division, entryYear, ctx });
      return { college: c, ...e, cause: classify(e) };
    });
  };

  // -------------------------------------------------------------- traces
  const TARGETS = ['Vermont', 'Rutgers', 'Loyola Marymount', 'Penn State'];

  const traceOne = ({ sport, programme, position, entryYear }) => {
    const ctx = ctxFor(sport);
    const c = ctx.colleges.find((x) => x.name === programme);
    if (!c) { console.log(`\n== ${programme}: not in the eligible pool for ${sport}`); return null; }
    const { evidence, result } = evaluate({ sport, programme, position, division: c.division, entryYear, ctx });
    const bucket = ctx.rosterIndex.get(programme)?.positions?.get(position);
    const prog = ctx.rosterIndex.get(programme);

    console.log(`\n== ${programme}  (${c.division}, ${c.state}, strength ${fmt(c.soccer_score, 1)})  ·  position ${position}  ·  entry year ${entryYear}`);
    console.log(`   roster on file: ${evidence.rosterOnFile}   programme rows ${prog?.rows ?? 0}   unreadable rows ${prog?.unreadable ?? 0}`);
    console.log(`   eligibility rule on file: ${evidence.eligibilityRuled}`);
    console.log(`   rows at ${position}: ${evidence.positionRows}   unreadable at position: ${evidence.unreadable}`);
    if (bucket) {
      console.log(`   placeable at position: classified ${bucket.classified}   unknown role ${bucket.unknownState}`);
      const last = [...bucket.byLastSeason.entries()].sort((a, b) => a[0] - b[0]);
      console.log(`   last eligible season, all at position:   ${last.map(([s, n]) => `${s}:${n}`).join('  ') || '(none)'}`);
      const st = [...bucket.starterLastSeason.entries()].sort((a, b) => a[0] - b[0]);
      console.log(`   last eligible season, STARTERS only:     ${st.map(([s, n]) => `${s}:${n}`).join('  ') || '(none)'}`);
      const uk = [...bucket.byLastSeasonUnknown.entries()].sort((a, b) => a[0] - b[0]);
      console.log(`   last eligible season, role UNKNOWN:      ${uk.map(([s, n]) => `${s}:${n}`).join('  ') || '(none)'}`);
    }
    console.log(`   departing before ${entryYear}: ${evidence.starterEvidence.departing}   of which role unknown: ${evidence.starterEvidence.departingUnknown}`);
    console.log(`   VACATED STARTERS (the only scored departure term): ${evidence.vacatedStarters}`);
    console.log(`   eligible to remain past ${entryYear}: ${evidence.eligibleToRemain}   (context only)`);
    console.log(`   fill propensity: ${evidence.fill ? `${fmt(evidence.fill.rate)} from ${evidence.fill.hits}/${evidence.fill.trials} at ${evidence.fill.level} level` : 'NONE'}`);
    console.log(`   arrivals for ${entryYear} at ${position}: ${evidence.arrivals}   applicable ${evidence.arrivalsApplicable}   horizon ${evidence.arrivalsHorizon}   programme on arrivals file ${evidence.arrivalsMeasured}`);
    if (result.ok === false) {
      console.log(`   -> REFUSED  ${result.reason}   missing ${JSON.stringify(result.missing)}   coverage ${result.coverage}`);
    } else {
      const b = result.basis;
      console.log(`   -> expected = vacated ${b.vacatedStarters} x fill ${fmt(b.fillRate)} = ${fmt(b.expectedNewcomerPlaces)}`);
      console.log(`      claims ${fmt(b.claims)}   places(typicalStarters) ${b.typicalStarters}`);
      console.log(`      VALUE = (${fmt(b.expectedNewcomerPlaces)} - ${fmt(b.claims)}) / ${b.typicalStarters} = ${fmt(result.value)}   grade ${result.grade}   coverage ${result.coverage}`);
    }
    console.log(`   cause: ${CAUSE_LABEL[classify({ evidence, result })]}`);
    return { evidence, result };
  };

  if (args.includes('--trace')) {
    const position = arg('position', 'MIDFIELD');
    const entryYear = Number(arg('entry', 2028));
    console.log(`Fixture A: men's, ${position}, entry year ${entryYear}. Roster season ${SEASON}.`);
    for (const t of TARGETS) traceOne({ sport: 'mens-soccer', programme: t, position, entryYear });
    console.log('\n-- for contrast, the two that DID rise --');
    for (const t of ['Furman', 'Princeton']) traceOne({ sport: 'mens-soccer', programme: t, position, entryYear });
  }

  // -------------------------------------------------------------- source audit
  if (args.includes('--source')) {
    const position = arg('position', 'MIDFIELD');
    console.log('== 3/4. SOURCE DATA AUDIT for the four programmes (plus the two that rose)\n');
    for (const programme of [...TARGETS, 'Furman', 'Princeton']) {
      const rows = db.prepare(`SELECT ${ROSTER_COLUMNS} FROM roster_players WHERE sport = 'mens-soccer' AND college_name = ? AND season = ?`).all(programme, SEASON);
      const seasons = db.prepare("SELECT season, COUNT(*) n FROM roster_players WHERE sport='mens-soccer' AND college_name=? GROUP BY season ORDER BY season").all(programme);
      const arrivals = db.prepare("SELECT arrival_season, canonical_position, COUNT(*) n FROM recruiting_arrivals WHERE sport='mens-soccer' AND programme=? GROUP BY arrival_season, canonical_position ORDER BY arrival_season").all(programme);
      const atPos = rows.filter((r) => readPosition(r.position) === position);
      const state = (r) => starterState(r);
      const cls = (v) => (v === null || v === undefined || v === '' ? 'MISSING' : v);
      console.log(`-- ${programme}`);
      console.log(`   roster rows (${SEASON}): ${rows.length}   ${rows.length ? 'PRESENT_RELIABLE' : 'MISSING'}`);
      console.log(`   seasons on file: ${seasons.map((s) => `${s.season}:${s.n}`).join('  ') || 'MISSING'}`);
      console.log(`   position labels usable: ${rows.filter((r) => readPosition(r.position)).length}/${rows.length}  ${pct(rows.filter((r) => readPosition(r.position)).length, rows.length)}`);
      console.log(`   class labels present: ${rows.filter((r) => cls(r.class_year_label) !== 'MISSING').length}/${rows.length}`);
      console.log(`   at ${position}: ${atPos.length} rows`);
      const byState = {};
      for (const r of atPos) { const s = state(r); byState[s] = (byState[s] ?? 0) + 1; }
      console.log(`   starter state at ${position}: ${JSON.stringify(byState)}  ${byState[STARTER_STATE.UNKNOWN] === atPos.length && atPos.length ? 'ALL UNKNOWN' : ''}`);
      const withMin = atPos.filter((r) => r.minutes_played !== null && r.minutes_played !== undefined).length;
      const withProj = atPos.filter((r) => r.projected_minutes !== null && r.projected_minutes !== undefined).length;
      const withGs = atPos.filter((r) => r.games_started !== null && r.games_started !== undefined).length;
      console.log(`   appearance evidence at ${position}: minutes ${withMin}  projected_minutes ${withProj}  games_started ${withGs}  of ${atPos.length}`);
      console.log(`   recruiting arrivals on file: ${arrivals.reduce((s, a) => s + a.n, 0)} rows  ${arrivals.map((a) => `${a.arrival_season}/${a.canonical_position ?? '?'}:${a.n}`).join(' ') || 'MISSING'}`);
      console.log(`   class-year labels at ${position}: ${atPos.map((r) => cls(r.class_year_label)).join(', ') || '(none)'}`);
      console.log('');
    }
  }

  // -------------------------------------------------------------- taxonomy + universe
  if (args.includes('--taxonomy') || args.includes('--universe')) {
    const entryYear = Number(arg('entry', 2028));
    const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];
    console.log(`== 5/6. FULL-UNIVERSE POSITIONAL AUDIT, entry year ${entryYear}, roster season ${SEASON}\n`);
    for (const sport of SPORTS) {
      const ctx = ctxFor(sport);
      console.log(`-- ${sport}: ${ctx.colleges.length} eligible programmes x 4 positions = ${ctx.colleges.length * 4} cells`);
      console.log(`${'position'.padEnd(12)}${'cells'.padStart(7)}${'MEAS'.padStart(7)}${'PART'.padStart(7)}${'UNSC'.padStart(7)}${'zero'.padStart(7)}${'<=.10'.padStart(7)}${'<=.25'.padStart(7)}${'median'.padStart(8)}`);
      const all = [];
      for (const position of POSITIONS) {
        const rows = sweep({ sport, position, entryYear });
        all.push(...rows);
        const ok = rows.filter((r) => r.result.ok !== false);
        const vals = ok.map((r) => r.result.value);
        console.log(`${position.padEnd(12)}${String(rows.length).padStart(7)}`
          + `${String(ok.filter((r) => r.result.grade === 'MEASURED').length).padStart(7)}`
          + `${String(ok.filter((r) => r.result.grade === 'PARTIAL').length).padStart(7)}`
          + `${String(rows.length - ok.length).padStart(7)}`
          + `${String(vals.filter((v) => v === 0).length).padStart(7)}`
          + `${String(vals.filter((v) => v <= 0.10).length).padStart(7)}`
          + `${String(vals.filter((v) => v <= 0.25).length).padStart(7)}`
          + `${fmt(med(vals)).padStart(8)}`);
      }
      console.log(`\n   by division:`);
      console.log(`${'division'.padEnd(12)}${'cells'.padStart(7)}${'MEAS'.padStart(7)}${'PART'.padStart(7)}${'UNSC'.padStart(7)}${'zero'.padStart(7)}${'%zero'.padStart(8)}${'median'.padStart(8)}`);
      const divs = [...new Set(all.map((r) => r.college.division))].sort();
      for (const d of divs) {
        const rows = all.filter((r) => r.college.division === d);
        const ok = rows.filter((r) => r.result.ok !== false);
        const vals = ok.map((r) => r.result.value);
        console.log(`${String(d).padEnd(12)}${String(rows.length).padStart(7)}`
          + `${String(ok.filter((r) => r.result.grade === 'MEASURED').length).padStart(7)}`
          + `${String(ok.filter((r) => r.result.grade === 'PARTIAL').length).padStart(7)}`
          + `${String(rows.length - ok.length).padStart(7)}`
          + `${String(vals.filter((v) => v === 0).length).padStart(7)}`
          + `${pct(vals.filter((v) => v === 0).length, ok.length).padStart(8)}`
          + `${fmt(med(vals)).padStart(8)}`);
      }
      console.log(`\n   WHY each cell came out as it did:`);
      const causes = {};
      for (const r of all) causes[r.cause] = (causes[r.cause] ?? 0) + 1;
      for (const [k, n] of Object.entries(causes).sort((a, b) => b[1] - a[1])) {
        console.log(`     ${String(n).padStart(6)}  ${pct(n, all.length).padStart(7)}  ${CAUSE_LABEL[k] ?? k}`);
      }
      console.log('');
    }
  }

  // -------------------------------------------------------------- zero vs unscoreable
  if (args.includes('--zero-vs-unscoreable')) {
    const entryYear = Number(arg('entry', 2028));
    const position = arg('position', 'MIDFIELD');
    console.log(`== 7. MEASURED ZERO vs UNSCOREABLE — both contribute nothing, with different coverage\n`);
    for (const sport of SPORTS) {
      const rows = sweep({ sport, position, entryYear });
      const zero = rows.filter((r) => r.result.ok !== false && r.result.value === 0);
      const unsc = rows.filter((r) => r.result.ok === false);
      const pos = rows.filter((r) => r.result.ok !== false && r.result.value > 0);
      console.log(`-- ${sport}, ${position}, entry ${entryYear}`);
      console.log(`   scored above zero ${pos.length}   measured/partial ZERO ${zero.length}   UNSCOREABLE ${unsc.length}   of ${rows.length}`);
      const strength = (xs) => fmt(med(xs.map((r) => r.college.soccer_score).filter(Number.isFinite)), 1);
      console.log(`   median programme strength:  nonzero ${strength(pos)}   zero ${strength(zero)}   unscoreable ${strength(unsc)}`);
      const divOf = (xs) => { const d = {}; for (const r of xs) d[r.college.division] = (d[r.college.division] ?? 0) + 1; return JSON.stringify(d); };
      console.log(`   zero by division:        ${divOf(zero)}`);
      console.log(`   unscoreable by division: ${divOf(unsc)}`);
      const zc = {}; for (const r of zero) zc[r.cause] = (zc[r.cause] ?? 0) + 1;
      console.log(`   the zeroes, by cause:    ${JSON.stringify(zc)}`);
      const uc = {}; for (const r of unsc) uc[r.cause] = (uc[r.cause] ?? 0) + 1;
      console.log(`   the refusals, by reason: ${JSON.stringify(uc)}`);
      console.log('');
    }
  }

  // -------------------------------------------------------------- horizon
  if (args.includes('--horizon')) {
    const position = arg('position', 'MIDFIELD');
    console.log(`== 13. ATHLETE ARRIVAL HORIZON, ${position}. Arrivals horizon is the last season on file.\n`);
    for (const sport of SPORTS) {
      const ctx = ctxFor(sport);
      console.log(`-- ${sport}   arrivals horizon ${ctx.arrivalsHorizon}   ${ctx.colleges.length} programmes`);
      console.log(`${'entry'.padEnd(7)}${'MEAS'.padStart(7)}${'PART'.padStart(7)}${'UNSC'.padStart(7)}${'zero'.padStart(7)}${'<=.10'.padStart(7)}${'median'.padStart(8)}${'mean'.padStart(8)}  dominant cause`);
      for (const entryYear of [2026, 2027, 2028, 2029, 2030]) {
        const rows = sweep({ sport, position, entryYear });
        const ok = rows.filter((r) => r.result.ok !== false);
        const vals = ok.map((r) => r.result.value);
        const causes = {}; for (const r of rows) causes[r.cause] = (causes[r.cause] ?? 0) + 1;
        const top = Object.entries(causes).sort((a, b) => b[1] - a[1])[0];
        console.log(`${String(entryYear).padEnd(7)}`
          + `${String(ok.filter((r) => r.result.grade === 'MEASURED').length).padStart(7)}`
          + `${String(ok.filter((r) => r.result.grade === 'PARTIAL').length).padStart(7)}`
          + `${String(rows.length - ok.length).padStart(7)}`
          + `${String(vals.filter((v) => v === 0).length).padStart(7)}`
          + `${String(vals.filter((v) => v <= 0.10).length).padStart(7)}`
          + `${fmt(med(vals)).padStart(8)}${fmt(mean(vals)).padStart(8)}  ${top[0]} (${top[1]})`);
      }
      console.log('');
    }
  }

  // -------------------------------------------------------------- positions
  if (args.includes('--positions')) {
    console.log('== 14. POSITION NORMALISATION AUDIT\n');
    for (const sport of SPORTS) {
      const rows = db.prepare(`SELECT position, COUNT(*) n FROM roster_players WHERE sport = ? AND season = ? GROUP BY position ORDER BY n DESC`).all(sport, SEASON);
      const total = rows.reduce((s, r) => s + r.n, 0);
      const unmapped = rows.filter((r) => !readPosition(r.position));
      console.log(`-- ${sport} roster ${SEASON}: ${total} rows, ${rows.length} distinct raw position values`);
      console.log(`   usable: ${total - unmapped.reduce((s, r) => s + r.n, 0)}/${total}  ${pct(total - unmapped.reduce((s, r) => s + r.n, 0), total)}`);
      const groups = {};
      for (const r of rows) { const g = readPosition(r.position) ?? 'UNMAPPED'; groups[g] = (groups[g] ?? 0) + r.n; }
      console.log(`   normalised groups: ${JSON.stringify(groups)}`);
      console.log(`   unmapped raw values (top 25 by volume):`);
      for (const r of unmapped.slice(0, 25)) console.log(`      ${String(r.n).padStart(6)}  ${JSON.stringify(r.position)}`);
      if (unmapped.length > 25) console.log(`      ... and ${unmapped.length - 25} more distinct values`);
      const multi = rows.filter((r) => r.position && /[/,&]|\band\b/i.test(String(r.position)));
      console.log(`   multi-position / hybrid raw labels: ${multi.length} distinct, ${multi.reduce((s, r) => s + r.n, 0)} rows`);
      for (const r of multi.slice(0, 10)) console.log(`      ${String(r.n).padStart(6)}  ${JSON.stringify(r.position)} -> ${readPosition(r.position) ?? 'UNMAPPED'}`);
      const arr = db.prepare('SELECT canonical_position, COUNT(*) n FROM recruiting_arrivals WHERE sport = ? GROUP BY canonical_position ORDER BY n DESC').all(sport);
      const arrTotal = arr.reduce((s, r) => s + r.n, 0);
      const arrUsable = arr.filter((r) => readPosition(r.canonical_position)).reduce((s, r) => s + r.n, 0);
      console.log(`   recruiting arrivals: ${arrTotal} rows, position usable on ${arrUsable}  ${pct(arrUsable, arrTotal)}`);
      console.log(`      ${arr.map((r) => `${r.canonical_position ?? 'NULL'}:${r.n}`).join('  ')}`);
      console.log('');
    }
  }

  // -------------------------------------------------------------- bias
  if (args.includes('--bias')) {
    const entryYear = Number(arg('entry', 2028));
    const position = arg('position', 'MIDFIELD');
    console.log(`== 15. DIVISION / SIZE BIAS, ${position}, entry ${entryYear}\n`);
    for (const sport of SPORTS) {
      const ctx = ctxFor(sport);
      const rows = sweep({ sport, position, entryYear }).filter((r) => r.result.ok !== false);
      const withSize = rows.map((r) => ({
        v: r.result.value,
        posRows: r.result.basis.contextOnly.positionRows,
        rosterRows: ctx.rosterIndex.get(r.college.name)?.rows ?? 0,
        strength: r.college.soccer_score,
        fill: r.result.basis.fillRate,
      })).filter((x) => Number.isFinite(x.strength));
      console.log(`-- ${sport} (${withSize.length} scored programmes)`);
      console.log(`   corr(value, position-group size)   ${fmt(corr(withSize.map((x) => x.v), withSize.map((x) => x.posRows)))}   spearman ${fmt(spearman(withSize.map((x) => x.v), withSize.map((x) => x.posRows)))}`);
      console.log(`   corr(value, whole roster size)     ${fmt(corr(withSize.map((x) => x.v), withSize.map((x) => x.rosterRows)))}`);
      console.log(`   corr(value, programme strength)    ${fmt(corr(withSize.map((x) => x.v), withSize.map((x) => x.strength)))}`);
      console.log(`   corr(value, fill rate)             ${fmt(corr(withSize.map((x) => x.v), withSize.map((x) => x.fill)))}`);
      console.log(`${'   division'.padEnd(14)}${'n'.padStart(6)}${'medValue'.padStart(10)}${'medRoster'.padStart(11)}${'medPosRows'.padStart(12)}${'medFill'.padStart(9)}`);
      const divs = [...new Set(rows.map((r) => r.college.division))].sort();
      for (const d of divs) {
        const sub = rows.filter((r) => r.college.division === d);
        console.log(`   ${String(d).padEnd(11)}${String(sub.length).padStart(6)}`
          + `${fmt(med(sub.map((r) => r.result.value))).padStart(10)}`
          + `${String(med(sub.map((r) => ctx.rosterIndex.get(r.college.name)?.rows ?? 0))).padStart(11)}`
          + `${String(med(sub.map((r) => r.result.basis.contextOnly.positionRows))).padStart(12)}`
          + `${fmt(med(sub.map((r) => r.result.basis.fillRate))).padStart(9)}`);
      }
      console.log('');
    }
  }

  // -------------------------------------------------------------- sanity set
  if (args.includes('--sanity')) {
    const entryYear = Number(arg('entry', 2028));
    const position = arg('position', 'MIDFIELD');
    const rows = sweep({ sport: 'mens-soccer', position, entryYear });
    const scored = rows.filter((r) => r.result.ok !== false);
    const pick = (test, n) => scored.filter(test).sort(() => 0.5 - Math.random()).slice(0, n);
    const show = (label, list) => {
      console.log(`\n-- ${label}`);
      console.log(`${'programme'.padEnd(30)}${'div'.padEnd(10)}${'rows'.padStart(6)}${'depart'.padStart(8)}${'unkn'.padStart(6)}${'vacSt'.padStart(7)}${'fill'.padStart(7)}${'arriv'.padStart(7)}${'value'.padStart(8)}${'grade'.padStart(10)}`);
      for (const r of list) {
        const b = r.result.ok === false ? null : r.result.basis;
        const e = r.evidence;
        console.log(`${r.college.name.slice(0, 29).padEnd(30)}${String(r.college.division).padEnd(10)}`
          + `${String(e.positionRows).padStart(6)}${String(e.starterEvidence.departing).padStart(8)}${String(e.starterEvidence.departingUnknown).padStart(6)}`
          + `${String(e.vacatedStarters).padStart(7)}${fmt(e.fill?.rate, 2).padStart(7)}${String(e.arrivals).padStart(7)}`
          + `${(b ? fmt(r.result.value) : 'refused').padStart(8)}${String(b ? r.result.grade : r.result.reason).slice(0, 9).padStart(10)}`);
      }
    };
    console.log(`== 18. NAMED SANITY SET — men's ${position}, entry ${entryYear}. Random within each band, not cherry-picked.`);
    show('near 1 (value >= 0.6)', pick((r) => r.result.value >= 0.6, 5));
    show('around 0.5 (0.35-0.65)', pick((r) => r.result.value >= 0.35 && r.result.value <= 0.65, 5));
    show('near 0 (0 < value <= 0.1)', pick((r) => r.result.value > 0 && r.result.value <= 0.1, 5));
    show('exactly 0', pick((r) => r.result.value === 0, 5));
    show('unscoreable', rows.filter((r) => r.result.ok === false).sort(() => 0.5 - Math.random()).slice(0, 5));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
