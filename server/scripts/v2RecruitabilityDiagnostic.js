/**
 * A7.7.1B: what Coach Recruitability is actually measuring, and what would
 * change if the floor moved.
 *
 * READ-ONLY AND DIAGNOSTIC. No scorer, weight, gate or calibration is changed.
 * Every alternative is recomputed arithmetically from the basis objects a
 * normal run already produced, using the production combination, so a
 * scenario cannot quietly become a different model.
 *
 *   node server/scripts/v2RecruitabilityDiagnostic.js --trace=A --programme=MIT
 *   node server/scripts/v2RecruitabilityDiagnostic.js --mit-like
 *   node server/scripts/v2RecruitabilityDiagnostic.js --zero-paths
 *   node server/scripts/v2RecruitabilityDiagnostic.js --phi
 *   node server/scripts/v2RecruitabilityDiagnostic.js --architectures
 *   node server/scripts/v2RecruitabilityDiagnostic.js --propensity
 */
import { FIXTURES } from './v2Fixtures.js';

const SEASON = '2026';
const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];

function usage(code) {
  console.error('Usage: v2RecruitabilityDiagnostic.js [--trace=<A-H> --programme=<name>] [--mit-like] [--zero-paths] [--phi] [--architectures] [--propensity]');
  process.exit(code);
}

const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const pctOf = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) usage(2);

  const { default: db } = await import('../db/client.js');
  const { canonicalPosition } = await import('../../shared/positions.js');
  const { normaliseAthlete } = await import('../../shared/matching/pool.js');
  const { buildPoolContext } = await import('../lib/v2/poolContext.js');
  const { positionEvidence } = await import('../lib/v2/rosterEvidence.js');
  const { runPursuit } = await import('../lib/v2/pursuitRun.js');
  const {
    isScoreable, PURSUIT_WEIGHTS, PURSUIT_GATES, tailGate, CORE_FLOOR,
    abilityToPercentile, percentileOf, positionalOpportunity, typicalStarters, fillPropensity,
  } = await import('../../shared/matching/v2/index.js');

  const W = PURSUIT_WEIGHTS; const G = PURSUIT_GATES;
  const priorityOf = (R, F, O) => {
    const base = (W.recruitability * R) + (W.financial * F) + (W.opportunity * O);
    return { base, P: base * tailGate(R, G.recruitability) * tailGate(F, G.financial) };
  };

  const cache = new Map();
  const contextFor = (sport) => {
    if (cache.has(sport)) return cache.get(sport);
    const colleges = db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport);
    const roster = db.prepare(`
      SELECT college_name, player_name, position, minutes_played, projected_minutes, games_started, projected_games_started,
             estimated_graduation_year, eligibility_end_year, country, season, division, class_year_label
        FROM roster_players WHERE sport = ? AND season = ?`).all(sport, SEASON);
    const arrivals = db.prepare('SELECT programme, sport, arrival_season, canonical_position, is_international FROM recruiting_arrivals WHERE sport = ?').all(sport);
    const ctx = buildPoolContext({ db, sport, season: SEASON });
    cache.set(sport, ctx);
    return ctx;
  };

  const runFixture = (f) => {
    const sport = f.player.sport;
    const ctx = contextFor(sport);
    const position = canonicalPosition(f.player.position);
    const v1Shape = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
    const athlete = {
      label: { id: f.id },
      v1Shape,
      recruitability: {
        sport, rating: f.player.football_ability, position,
        entryYear: f.player.recruiting_class_year, isInternational: f.player.origin === 'International',
        homeState: f.player.state ?? null,
      },
      opportunity: {
        sport, position, rating: f.player.football_ability,
        intendedMajor: null, priorityRanking: null,
        competitiveLevelPriority: null, playingOpportunityPriority: null,
      },
    };
    const rep = runPursuit({ athlete, sport, colleges: ctx.colleges, ctx });
    const byId = new Map(ctx.colleges.map((c) => [c.id, c]));
    const rows = rep.pipeline.ranked.map((e) => {
      const b = e.recruitability.basis;
      const c = byId.get(e.id);
      return {
        id: e.id, name: e.name, division: e.division, rank: e.rank,
        soccerScore: c?.soccer_score ?? null,
        A: b.athleticPlausibility, core: b.core, phi: b.phi,
        delta: b.athleticDelta,
        positional: b.positional,
        market: b.market ?? null,
        marketValue: b.signals?.find((x) => x.key === 'recruitingMarket')?.value ?? null,
        R: e.recruitability.value,
        F: e.financial.value, O: e.opportunity.value,
        P: e.pursuitPriority.value,
      };
    });
    return { f, sport, position, ctx, rep, rows, byId };
  };

  /* ================= 1. FULL TRACE ================= */
  const traceKey = args.find((a) => a.startsWith('--trace='))?.split('=')[1]?.toUpperCase();
  if (traceKey) {
    const want = args.find((a) => a.startsWith('--programme='))?.split('=')[1] ?? 'MIT';
    const f = FIXTURES.find((x) => x.id.toUpperCase().startsWith(`${traceKey}-`));
    if (!f) usage(2);
    const { sport, position, ctx, rep, rows, byId } = runFixture(f);
    const row = rows.find((r) => r.name === want)
      ?? rows.find((r) => r.name.toLowerCase().includes(want.toLowerCase()));
    if (!row) { console.error(`${want} is not in the ranked list for ${f.id}`); process.exit(3); }
    const c = byId.get(row.id);
    const ev = positionEvidence({
      programme: c.name, position, sport, division: c.division,
      entryYear: f.player.recruiting_class_year,
      rosterIndex: ctx.rosterIndex, arrivalIndex: ctx.arrivalIndex, arrivalsHorizon: ctx.arrivalsHorizon,
    });
    const p = row.positional;
    const { base, P } = priorityOf(row.R, row.F, row.O);
    const preCeiling = row.phi + ((1 - row.phi) * row.core);

    console.log(`== FULL TRACE: ${c.name} (${c.division}) for ${f.id} ==`);
    console.log('');
    console.log('  ATHLETE');
    console.log(`    rating                        ${f.player.football_ability}`);
    console.log(`    calibrated percentile         ${fmt(abilityToPercentile(f.player.football_ability, sport))}`);
    console.log(`    position                      ${position}`);
    console.log(`    entry year                    ${f.player.recruiting_class_year}`);
    console.log('  PROGRAMME');
    console.log(`    soccer_score                  ${c.soccer_score}`);
    console.log(`    programme percentile          ${fmt(percentileOf(c.soccer_score, sport))}`);
    console.log('  A. ATHLETIC PLAUSIBILITY');
    console.log(`    athletic delta                ${fmt(row.delta)}   (athlete percentile - programme percentile)`);
    console.log(`    athletic plausibility A       ${fmt(row.A)}`);
    console.log('  B. POSITIONAL EVIDENCE');
    console.log(`    roster on file                ${ev.rosterOnFile}`);
    console.log(`    eligibility rule on file      ${ev.eligibilityRuled}`);
    console.log(`    rows at ${position.padEnd(11)}           ${ev.positionRows}   (unreadable ${ev.unreadable})`);
    console.log(`    typical starters              ${typicalStarters(sport, position)}`);
    console.log(`    all places vacated            ${ev.openings}   (context only)`);
    console.log(`    VACATED STARTERS              ${ev.vacatedStarters}   <- the scored quantity`);
    console.log(`    eligible to remain            ${ev.eligibleToRemain}   (context only, never scored)`);
    console.log(`    fill rate                     ${fmt(ev.fill?.rate)}  (${ev.fill?.hits}/${ev.fill?.trials}, ${ev.fill?.level})`);
    console.log(`    expected newcomer places      ${fmt(p?.expectedNewcomerPlaces)}   = vacated x fill rate`);
    console.log(`    current arrivals              ${p?.arrivals}  applicable ${p?.arrivalsApplicable}  horizon ${p?.arrivalsHorizon}`);
    console.log(`    claims on those places        ${fmt(p?.claims)}  capped ${p?.claimsCapped}`);
    console.log(`    positionalOpportunity         ${fmt((p?.expectedNewcomerPlaces - p?.claims) / p?.typicalStarters)}`);
    console.log('  C. COACH RECRUITING PROPENSITY');
    const mk = row.market ?? null;
    console.log(`    recruiting market match       ${mk ? `${mk.arm} ${(row.marketValue ?? 0).toFixed(3)}` : 'UNKNOWN'}`);
    console.log('  CORE AND CEILING');
    console.log(`    core                          ${fmt(row.core)}   (behavioural support; positional 0.75, market 0.25)`);
    console.log(`    phi                           ${fmt(row.phi)}`);
    console.log(`    phi + (1-phi) x core          ${fmt(preCeiling)}   <- recruitability BEFORE the athletic ceiling`);
    console.log(`    x A                           ${fmt(row.A)}`);
    console.log(`    RECRUITABILITY R              ${fmt(row.R)}   <- after the ceiling`);
    console.log('  PURSUIT');
    console.log(`    F financial                   ${fmt(row.F)}`);
    console.log(`    O opportunity                 ${fmt(row.O)}`);
    console.log(`    base = .5R + .2F + .3O        ${fmt(base)}`);
    console.log(`    recruitability gate gR(R)     ${fmt(tailGate(row.R, G.recruitability))}   (floor ${G.recruitability.floor}, threshold ${G.recruitability.threshold})`);
    console.log(`    financial gate gF(F)          ${fmt(tailGate(row.F, G.financial))}`);
    console.log(`    PURSUIT PRIORITY P            ${fmt(P)}`);
    console.log(`    RANK                          #${row.rank} of ${rep.counts.ranked}`);
    console.log('');
    const gR = tailGate(row.R, G.recruitability);
    console.log('  WHY A=1.00 DOES NOT PRODUCE A HIGH RANK:');
    console.log(`    A is a CEILING, not a score. With core ${fmt(row.core)} the ceiling is never approached:`);
    console.log(`    R = ${fmt(row.A)} x ${fmt(preCeiling)} = ${fmt(row.R)}.`);
    console.log(`    The GATE IS NOT THE MECHANISM here: gR = ${fmt(gR)}${gR >= 0.999 ? ' (it does not fire at all)' : ''}.`);
    console.log(`    The suppression is entirely in the BASE. R contributes ${fmt(W.recruitability * row.R)} of ${fmt(base)},`);
    console.log(`    where an unconstrained programme would contribute up to ${fmt(W.recruitability)}.`);
    console.log(`    The layer is answering "is a place opening" and returning ${fmt(row.core)}; it is NOT`);
    console.log('    answering "is the athlete good enough", which it already answered with 1.00.');
    // Minutes coverage decides whether that zero is a measurement or an absence.
    const mins = db.prepare(`
      SELECT COUNT(*) n, SUM(minutes_played IS NOT NULL) mp, SUM(projected_minutes IS NOT NULL) pm,
             SUM(projected_games_started IS NOT NULL) pgs,
             SUM(COALESCE(projected_minutes, minutes_played) >= 600 OR projected_games_started >= 7) starters
        FROM roster_players WHERE sport = ? AND season = ? AND college_name = ?`).get(sport, SEASON, c.name);
    const se = p?.starterEvidence;
    console.log('');
    console.log('  IS THAT COUNT A MEASUREMENT OR AN ABSENCE?');
    console.log(`    roster rows ${mins.n}  minutes ${mins.mp}  projected minutes ${mins.pm}  projected starts ${mins.pgs}  identified starters ${mins.starters}`);
    if (se) {
      console.log(`    departing cohort at this position: ${se.departing}, of which ${se.departingUnknown} unplaceable`);
      console.log(`    -> ${se.departingUnknown === 0 ? 'fully placed, so the count is a MEASUREMENT' : se.departingKnown > 0 ? 'partly placed, so the count is a FLOOR (grade PARTIAL)' : 'unplaceable, which refuses rather than scores'}`);
    }
    if (mins.starters === 0 && mins.pgs === 0) {
      console.log('    THIS PROGRAMME HAS NO USABLE MINUTES. "vacatedStarters = 0" therefore means');
      console.log('    "nobody could be identified as a starter", not "no starting place opens".');
      console.log('    The layer reports grade MEASURED regardless, because the grade tracks class-label');
      console.log('    readability and not minutes coverage.');
    }
    console.log('');
  }

  /* ================= 2. MIT-LIKE FREQUENCY ================= */
  if (args.includes('--mit-like')) {
    console.log('== MIT-LIKE CASES: high athletic plausibility, low recruitability ==');
    console.log('   (A >= threshold AND R <= 0.40, i.e. suppressed by a weak non-athletic core)');
    console.log('');
    const all = FIXTURES.map(runFixture);
    for (const thr of [0.90, 0.80, 0.70]) {
      console.log(`  A >= ${thr.toFixed(2)}`);
      console.log(`    ${'fixture'.padEnd(12)}${'sex'.padEnd(7)}${'pos'.padEnd(12)}${'ranked'.padEnd(8)}${'A>=thr'.padEnd(9)}${'MIT-like'.padEnd(10)}${'share'.padEnd(8)}by division`);
      let grand = 0; let grandBase = 0;
      for (const r of all) {
        const elig = r.rows.filter((x) => x.A >= thr);
        const hits = elig.filter((x) => x.R <= 0.40);
        grand += hits.length; grandBase += elig.length;
        const byDiv = Object.entries(hits.reduce((a, x) => { a[x.division] = (a[x.division] || 0) + 1; return a; }, {}))
          .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
        console.log(`    ${r.f.id.split('-')[0].padEnd(12)}${(r.sport === 'womens-soccer' ? 'women' : 'men').padEnd(7)}${r.position.padEnd(12)}${String(r.rows.length).padEnd(8)}${String(elig.length).padEnd(9)}${String(hits.length).padEnd(10)}${pctOf(hits.length, elig.length).padEnd(8)}${byDiv || '-'}`);
      }
      console.log(`    ${'ALL'.padEnd(12)}${''.padEnd(19)}${''.padEnd(8)}${String(grandBase).padEnd(9)}${String(grand).padEnd(10)}${pctOf(grand, grandBase)}`);
      console.log('');
    }
    console.log('  worst individual cases (A >= 0.80, lowest R), with final rank:');
    const worst = all.flatMap((r) => r.rows.filter((x) => x.A >= 0.80 && x.R <= 0.40)
      .map((x) => ({ ...x, fixture: r.f.id.split('-')[0] })))
      .sort((a, b) => a.R - b.R).slice(0, 15);
    for (const x of worst) {
      console.log(`    ${x.fixture}  ${x.name.slice(0, 26).padEnd(27)}${x.division.padEnd(9)} A ${fmt(x.A, 2)} core ${fmt(x.core, 2)} R ${fmt(x.R, 2)} -> #${x.rank}`);
    }
    console.log('');
  }

  /* ================= 3. ZERO-PATH AUDIT ================= */
  if (args.includes('--zero-paths')) {
    console.log('== HOW positionalOpportunity REACHES ZERO ==');
    console.log('   Every programme x position, both sports, at entry year 2028.');
    console.log('');
    for (const sport of ['mens-soccer', 'womens-soccer']) {
      const ctx = contextFor(sport);
      const tally = {};
      const bump = (k) => { tally[k] = (tally[k] || 0) + 1; };
      const starterRows = new Map();
      for (const r of ctx.roster) {
        const key = `${r.college_name}|${canonicalPosition(r.position)}`;
        const st = (r.minutes_played ?? r.projected_minutes ?? 0) >= 600;
        const cur = starterRows.get(key) ?? { starters: 0, rows: 0 };
        cur.rows += 1; if (st) cur.starters += 1;
        starterRows.set(key, cur);
      }
      for (const c of ctx.colleges) {
        for (const position of POSITIONS) {
          const ev = positionEvidence({
            programme: c.name, position, sport, division: c.division, entryYear: 2028,
            rosterIndex: ctx.rosterIndex, arrivalIndex: ctx.arrivalIndex, arrivalsHorizon: ctx.arrivalsHorizon,
          });
          const res = positionalOpportunity({ sport, position, evidence: ev });
          if (!isScoreable(res)) { bump(`UNSCOREABLE:${res.reason}`); continue; }
          if (res.value > 0) { bump('SCORED_POSITIVE'); continue; }
          // value === 0. Which pathway?
          const sr = starterRows.get(`${c.name}|${position}`) ?? { starters: 0, rows: 0 };
          if (ev.vacatedStarters === 0 && sr.starters === 0) bump('ZERO:no starter identified at the position at all');
          else if (ev.vacatedStarters === 0 && ev.eligibleToRemain >= sr.rows) bump('ZERO:every starter is eligible to remain');
          else if (ev.vacatedStarters === 0) bump('ZERO:starters present, none vacating for the entry year');
          else if (!ev.fill || ev.fill.rate === 0) bump('ZERO:a place opens but no newcomer historically fills it');
          else bump('ZERO:arrivals already claim the opening');
        }
      }
      const total = Object.values(tally).reduce((a, b) => a + b, 0);
      console.log(`  ${sport}  (${total} programme-position rows)`);
      for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${k.padEnd(56)} ${String(v).padStart(5)}  ${pctOf(v, total)}`);
      }
      const zeros = Object.entries(tally).filter(([k]) => k.startsWith('ZERO:')).reduce((a, [, v]) => a + v, 0);
      const unsc = Object.entries(tally).filter(([k]) => k.startsWith('UNSCOREABLE:')).reduce((a, [, v]) => a + v, 0);
      console.log(`    ${'-- scored zero'.padEnd(56)} ${String(zeros).padStart(5)}  ${pctOf(zeros, total)}`);
      console.log(`    ${'-- unscoreable (absence of evidence)'.padEnd(56)} ${String(unsc).padStart(5)}  ${pctOf(unsc, total)}`);
      console.log('');
    }
  }

  /* ================= 4. PHI SENSITIVITY + 5. ARCHITECTURES ================= */
  if (args.includes('--phi') || args.includes('--architectures')) {
    const all = FIXTURES.map(runFixture);
    const jac = (a, b) => {
      const A = new Set(a); const B = new Set(b);
      const i = [...A].filter((x) => B.has(x)).length;
      return Number((i / (A.size + B.size - i)).toFixed(3));
    };
    const corr = (x, y) => {
      const n = x.length; if (n < 3) return null;
      const mx = x.reduce((a, b) => a + b, 0) / n; const my = y.reduce((a, b) => a + b, 0) / n;
      let c = 0; let vx = 0; let vy = 0;
      for (let i = 0; i < n; i += 1) { const d = x[i] - mx; const e = y[i] - my; c += d * e; vx += d * d; vy += e * e; }
      return (vx === 0 || vy === 0) ? null : Number((c / Math.sqrt(vx * vy)).toFixed(3));
    };

    /**
     * The alternatives. Each takes (A, core) and returns R.
     *
     * R1 raises the floor globally. R2 makes plausibility a BASELINE that
     * demand can lift above, rather than a ceiling it can only approach. R3
     * separates measured demand from measured congestion and treats the
     * absence of demand evidence as nearer neutral than a measured absence.
     */
    const architectures = {
      CURRENT: (r) => r.A * (CORE_FLOOR + ((1 - CORE_FLOOR) * r.core)),
      R1_PHI_0_55: (r) => r.A * (0.55 + (0.45 * r.core)),
      R1_PHI_0_65: (r) => r.A * (0.65 + (0.35 * r.core)),
      R2_BASELINE_LIFT: (r) => Math.min(1, r.A + (0.30 * r.core * (1 - r.A))),
      R3_DEMAND_VS_CONGESTION: (r) => {
        const p = r.positional;
        if (!p) return r.A * (CORE_FLOOR + ((1 - CORE_FLOOR) * r.core));
        const demand = Math.min(1, p.expectedNewcomerPlaces / p.typicalStarters);
        // Congestion is only what was MEASURED: arrivals claiming the places.
        const congestion = p.expectedNewcomerPlaces > 0 ? Math.min(1, p.claims / p.expectedNewcomerPlaces) : 0;
        /**
         * The absence of a measured opening is treated as NEARER NEUTRAL than
         * a measured congestion. A programme with no vacancy this year has not
         * said it would refuse a good player; a programme that has already
         * signed three at the position nearly has.
         */
        const neutral = 0.55;
        return r.A * Math.min(1, (neutral + (0.45 * demand)) * (1 - (0.35 * congestion)));
      },
    };

    const report = (label, fn) => {
      const out = [];
      for (const r of all) {
        const base = r.rows.map((x) => ({ ...x }));
        const alt = base.map((x) => {
          const R = fn(x);
          const { P } = priorityOf(R, x.F, x.O);
          return { ...x, R2v: R, P2: P };
        }).sort((a, b) => b.P2 - a.P2 || String(a.name).localeCompare(String(b.name)));
        alt.forEach((x, i) => { x.rank2 = i + 1; });
        const cur = [...base].sort((a, b) => a.rank - b.rank);
        const t25 = jac(cur.slice(0, 25).map((x) => x.id), alt.slice(0, 25).map((x) => x.id));
        const t100 = jac(cur.slice(0, 100).map((x) => x.id), alt.slice(0, 100).map((x) => x.id));
        const withScore = alt.slice(0, 100).filter((x) => typeof x.soccerScore === 'number');
        const strengthCorr = corr(alt.filter((x) => typeof x.soccerScore === 'number').map((x) => x.soccerScore),
          alt.filter((x) => typeof x.soccerScore === 'number').map((x) => x.P2));
        // Developmental elite reach: top-25 programmes the athlete is materially below.
        const eliteReach = alt.slice(0, 25).filter((x) => x.delta < -0.10).length;
        // Financially severe: viability below the gate floor inside the top 100.
        const severe = alt.slice(0, 100).filter((x) => x.F < 0.30).length;
        // MIT-like rescued: A>=0.8 & R<=0.4 currently, now inside the top 100.
        const mitLike = base.filter((x) => x.A >= 0.80 && x.R <= 0.40);
        const rescued = mitLike.filter((x) => (alt.find((y) => y.id === x.id)?.rank2 ?? 9e9) <= 100
          && x.rank > 100).length;
        // Weak-core promoted: core < 0.05 newly inside the top 100.
        const weakPromoted = alt.slice(0, 100).filter((x) => x.core < 0.05 && x.rank > 100).length;
        out.push({
          fixture: r.f.id.split('-')[0], t25, t100, eliteReach, severe,
          strengthCorr, rescued, weakPromoted,
          medStrength: (() => {
            const v = withScore.map((x) => x.soccerScore).sort((a, b) => a - b);
            return v.length ? Number(v[Math.floor(v.length / 2)].toFixed(1)) : null;
          })(),
        });
      }
      console.log(`  ${label}`);
      console.log(`    ${'fix'.padEnd(5)}${'J25'.padEnd(7)}${'J100'.padEnd(7)}${'eliteReach25'.padEnd(14)}${'severe100'.padEnd(11)}${'corr(s,P)'.padEnd(11)}${'rescued'.padEnd(9)}${'weakCore+'.padEnd(11)}medStrength`);
      for (const o of out) {
        console.log(`    ${o.fixture.padEnd(5)}${String(o.t25).padEnd(7)}${String(o.t100).padEnd(7)}${String(o.eliteReach).padEnd(14)}${String(o.severe).padEnd(11)}${String(o.strengthCorr).padEnd(11)}${String(o.rescued).padEnd(9)}${String(o.weakPromoted).padEnd(11)}${o.medStrength}`);
      }
      console.log('');
    };

    if (args.includes('--phi')) {
      console.log('== PHI SENSITIVITY (global, never by division) ==');
      console.log('');
      for (const phi of [0.35, 0.45, 0.55, 0.65, 0.75]) {
        report(`phi = ${phi.toFixed(2)}${phi === CORE_FLOOR ? '  (current)' : ''}`,
          (r) => r.A * (phi + ((1 - phi) * r.core)));
      }
    }
    if (args.includes('--architectures')) {
      console.log('== ALTERNATIVE RECRUITABILITY ARCHITECTURES ==');
      console.log('');
      for (const [name, fn] of Object.entries(architectures)) report(name, fn);
      /**
       * R4. Not a formula - an EVIDENCE rule.
       *
       * If a scored zero that rests on no identifiable starter were refused
       * rather than scored, how much of each list stops being rankable? That
       * is the honest cost of treating the absence as an absence, and it is
       * the number that decides whether R4 is affordable without new data.
       */
      console.log('  R4_REFUSE_UNEVIDENCED_ZERO: what refusing those zeros would cost');
      console.log(`    ${'fix'.padEnd(5)}${'ranked now'.padEnd(12)}${'zero-core'.padEnd(11)}${'of those, no starter evidence'.padEnd(31)}${'would leave RANKED'.padEnd(20)}remaining`);
      for (const r of all) {
        const ctx2 = contextFor(r.sport);
        const starterRows = new Map();
        for (const x of ctx2.roster) {
          const key = `${x.college_name}|${canonicalPosition(x.position)}`;
          const st = (x.minutes_played ?? x.projected_minutes ?? 0) >= 600;
          const cur = starterRows.get(key) ?? { starters: 0, rows: 0 };
          cur.rows += 1; if (st) cur.starters += 1;
          starterRows.set(key, cur);
        }
        const zeroCore = r.rows.filter((x) => x.core === 0);
        const unevidenced = zeroCore.filter((x) => (starterRows.get(`${x.name}|${r.position}`)?.starters ?? 0) === 0);
        console.log(`    ${r.f.id.split('-')[0].padEnd(5)}${String(r.rows.length).padEnd(12)}${String(zeroCore.length).padEnd(11)}${String(unevidenced.length).padEnd(31)}${String(unevidenced.length).padEnd(20)}${r.rows.length - unevidenced.length}`);
      }
      console.log('');
      console.log('  MIT under each architecture (fixture A, and fixture C for contrast):');
      for (const key of ['A', 'C']) {
        const r = all.find((x) => x.f.id.toUpperCase().startsWith(`${key}-`));
        const mit = r.rows.find((x) => x.name === 'MIT');
        const cells = Object.entries(architectures).map(([name, fn]) => {
          const R = fn(mit);
          const alt = r.rows.map((x) => ({ id: x.id, P: priorityOf(fn(x), x.F, x.O).P }))
            .sort((a, b) => b.P - a.P);
          const rank = alt.findIndex((x) => x.id === mit.id) + 1;
          return `${name} R ${fmt(R, 2)} #${rank}`;
        });
        console.log(`    fixture ${key}: A ${fmt(mit.A, 2)} core ${fmt(mit.core, 2)} -> ${cells.join('  |  ')}`);
      }
      console.log('');
    }
  }

  /* ================= 6. DOMESTIC PROPENSITY AUDIT ================= */
  if (args.includes('--propensity')) {
    console.log('== DOMESTIC COACH-PROPENSITY EVIDENCE AUDIT ==');
    console.log('');
    const cols = db.prepare('PRAGMA table_info(recruiting_arrivals)').all().map((c) => c.name);
    console.log(`  recruiting_arrivals columns: ${cols.join(', ')}`);
    const total = db.prepare('SELECT COUNT(*) n FROM recruiting_arrivals').get().n;
    console.log(`  rows: ${total}`);
    const fill = (col) => db.prepare(`SELECT COUNT(*) n FROM recruiting_arrivals WHERE ${col} IS NOT NULL AND ${col} != ''`).get().n;
    for (const c of ['entry_type', 'prior_programme', 'coach', 'coach_attribution', 'class_label_raw', 'canonical_position', 'country', 'region', 'arrival_confidence', 'identity_method']) {
      if (cols.includes(c)) console.log(`    ${c.padEnd(20)} populated ${String(fill(c)).padStart(7)}  ${pctOf(fill(c), total)}`);
    }
    console.log('');
    console.log('  entry_type distribution:');
    for (const r of db.prepare('SELECT entry_type, COUNT(*) n FROM recruiting_arrivals GROUP BY entry_type ORDER BY n DESC').all()) {
      console.log(`    ${String(r.entry_type ?? 'NULL').padEnd(24)} ${String(r.n).padStart(7)}  ${pctOf(r.n, total)}`);
    }
    console.log('');
    console.log('  arrivals per programme (the sample any programme-level rate would rest on):');
    const per = db.prepare("SELECT programme, sport, COUNT(*) n FROM recruiting_arrivals GROUP BY programme, sport").all().map((r) => r.n).sort((a, b) => a - b);
    const q = (p) => per[Math.min(per.length - 1, Math.floor((p / 100) * per.length))];
    console.log(`    programmes ${per.length}  p10 ${q(10)}  median ${q(50)}  p90 ${q(90)}  max ${per[per.length - 1]}`);
    console.log('');
    console.log('  arrivals per programme x position (what a POSITIONAL propensity would rest on):');
    const perPos = db.prepare("SELECT programme, sport, canonical_position, COUNT(*) n FROM recruiting_arrivals WHERE canonical_position IS NOT NULL GROUP BY programme, sport, canonical_position").all().map((r) => r.n).sort((a, b) => a - b);
    const qq = (p) => perPos[Math.min(perPos.length - 1, Math.floor((p / 100) * perPos.length))];
    console.log(`    cells ${perPos.length}  p10 ${qq(10)}  median ${qq(50)}  p90 ${qq(90)}  max ${perPos[perPos.length - 1]}`);
    console.log('');
    console.log('  experienced-arrival share by division');
    console.log('  (the candidate signal: does this programme recruit ready-made players or freshmen?)');
    for (const r of db.prepare(`
      SELECT c.division, COUNT(*) n, SUM(CASE WHEN a.entry_type='EXPERIENCED' THEN 1 ELSE 0 END) exp
        FROM recruiting_arrivals a JOIN colleges c ON c.name = a.programme AND c.sport = a.sport
       WHERE c.active = 1 GROUP BY c.division ORDER BY n DESC`).all()) {
      console.log(`    ${String(r.division).padEnd(10)} arrivals ${String(r.n).padStart(6)}  experienced ${String(r.exp).padStart(6)}  ${pctOf(r.exp, r.n)}`);
    }
    console.log('');

    /**
     * SPLIT-HALF RELIABILITY, the standard this codebase already holds signals
     * to. A7.3 rejected newcomer minutes share at r = 0.05 by exactly this
     * test; a rate that does not agree with itself across two halves of its
     * own history cannot carry a ranking.
     *
     * Halves are by season parity, which is a real split rather than a random
     * one: it asks whether a programme behaves the same way in different years.
     */
    const splitHalf = (label, keyExpr, minPerHalf) => {
      const rows = db.prepare(`
        SELECT ${keyExpr} k,
               CAST(a.arrival_season AS INTEGER) % 2 half,
               COUNT(*) n,
               SUM(CASE WHEN a.entry_type='EXPERIENCED' THEN 1 ELSE 0 END) exp
          FROM recruiting_arrivals a
          JOIN colleges c ON c.name = a.programme AND c.sport = a.sport AND c.active = 1
         WHERE a.entry_type IN ('FRESHMAN','EXPERIENCED')
         GROUP BY k, half`).all();
      const by = new Map();
      for (const r of rows) {
        if (!r.k) continue;
        const e = by.get(r.k) ?? {};
        e[r.half] = { n: r.n, rate: r.exp / r.n };
        by.set(r.k, e);
      }
      const pairs = [...by.values()].filter((e) => e[0] && e[1] && e[0].n >= minPerHalf && e[1].n >= minPerHalf);
      const a = pairs.map((e) => e[0].rate); const b = pairs.map((e) => e[1].rate);
      const n = a.length;
      if (n < 10) { console.log(`    ${label.padEnd(46)} too few units (${n})`); return; }
      const ma = a.reduce((x, y) => x + y, 0) / n; const mb = b.reduce((x, y) => x + y, 0) / n;
      let c2 = 0; let va = 0; let vb = 0;
      for (let i = 0; i < n; i += 1) { const d = a[i] - ma; const e2 = b[i] - mb; c2 += d * e2; va += d * d; vb += e2 * e2; }
      const r = c2 / Math.sqrt(va * vb);
      console.log(`    ${label.padEnd(46)} units ${String(n).padStart(5)}  split-half r = ${r.toFixed(3)}  ${r >= 0.5 ? 'USABLE' : r >= 0.3 ? 'MARGINAL' : 'REJECT'}`);
    };
    console.log('  split-half reliability of the experienced-arrival rate (odd vs even seasons):');
    splitHalf('per programme, >= 5 arrivals per half', "a.programme || '|' || a.sport", 5);
    splitHalf('per programme, >= 10 arrivals per half', "a.programme || '|' || a.sport", 10);
    splitHalf('per programme x position, >= 5 per half', "a.programme || '|' || a.sport || '|' || a.canonical_position", 5);
    splitHalf('per coach, >= 5 per half', "a.coach", 5);
    splitHalf('per division (ceiling check)', "c.division || '|' || a.sport", 5);
    console.log('');
    console.log('  coach attribution (a candidate: does THIS coach recruit this type?):');
    for (const r of db.prepare('SELECT coach_attribution, COUNT(*) n FROM recruiting_arrivals GROUP BY coach_attribution ORDER BY n DESC LIMIT 6').all()) {
      console.log(`    ${String(r.coach_attribution ?? 'NULL').padEnd(24)} ${String(r.n).padStart(7)}`);
    }
    console.log('');
    console.log('  prior_programme strength vs arriving programme strength');
    console.log('  (a candidate: does this programme recruit UP, ACROSS or DOWN?)');
    const moves = db.prepare(`
      SELECT a.programme, a.sport, dest.soccer_score dest_score, src.soccer_score src_score
        FROM recruiting_arrivals a
        JOIN colleges dest ON dest.name = a.programme AND dest.sport = a.sport AND dest.active = 1
        JOIN colleges src ON src.name = a.prior_programme AND src.sport = a.sport AND src.active = 1
       WHERE a.prior_programme IS NOT NULL AND a.prior_programme != ''
         AND dest.soccer_score IS NOT NULL AND src.soccer_score IS NOT NULL`).all();
    console.log(`    rows with BOTH programmes resolvable and scored: ${moves.length}`);
    if (moves.length) {
      const perProg = moves.reduce((a, r) => { const k = `${r.programme}|${r.sport}`; (a[k] ??= []).push(r.dest_score - r.src_score); return a; }, {});
      const sizes = Object.values(perProg).map((v) => v.length).sort((a, b) => a - b);
      console.log(`    programmes with any such row: ${sizes.length}  median rows each ${sizes[Math.floor(sizes.length / 2)]}  max ${sizes[sizes.length - 1]}`);
      console.log(`    programmes with >= 10 rows:   ${sizes.filter((n) => n >= 10).length}`);
      console.log(`    programmes with >= 30 rows:   ${sizes.filter((n) => n >= 30).length}`);
    }
    console.log('');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
