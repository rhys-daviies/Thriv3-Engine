/**
 * A7.7.1A: what is actually holding Fixture C's list together, and what would
 * move if the roster-demand evidence mattered less at D3.
 *
 * READ-ONLY AND DIAGNOSTIC. It changes no scorer, commits no architecture and
 * adopts nothing. Every scenario is recomputed ARITHMETICALLY from the basis
 * objects a normal run already produced - the same R = A x (phi + (1-phi)core)
 * and P = (wR.R + wF.F + wO.O) x gR x gF the model uses - so a scenario cannot
 * quietly become a different model.
 *
 *   node server/scripts/v2D3Diagnostic.js --fixture=C
 *   node server/scripts/v2D3Diagnostic.js --fixture=C --json
 *
 * NOTHING HERE IS A PROPOSAL. Section 6 of the brief is the binding
 * constraint: the question is the recruiting-constraint environment, not
 * division prestige, and no scenario below is a candidate formula.
 */
import { FIXTURES } from './v2Fixtures.js';
import { VALIDATION_FIXTURES } from './v2ValidationFixtures.js';

const SEASON = '2026';
const WATCH = ['MIT', 'Worcester Polytechnic', 'Oberlin', 'Adrian', 'Keuka', 'Millsaps', 'Lewis & Clark'];

/**
 * Diagnostic-only thresholds. HEURISTIC, and stated here rather than buried.
 *
 * ATHLETIC uses the same boundary the explanations already use for "modest
 * reach", so the classification and the prose cannot disagree.
 *
 * ADMISSIONS is a CLASSIFICATION, not a score, and deliberately coarse. A
 * score would be a new model component, which section 5 of the brief
 * explicitly refuses until the architecture is decided.
 */
const PLAUSIBLE_DELTA = -0.10;
const SAT_MARGIN = 60;
const ADMIT_PLAUSIBLE = 0.50;
const ADMIT_DIFFICULT = 0.20;

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? Number(s[Math.floor(s.length / 2)].toFixed(2)) : null;
};
const comp = (rows) => Object.entries(rows.reduce((a, r) => { a[r.division] = (a[r.division] || 0) + 1; return a; }, {}))
  .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');

function usage(code) {
  console.error('Usage: v2D3Diagnostic.js --fixture=<A-H|V-ELITE|V-WMID> [--json]');
  process.exit(code);
}

async function main() {
  const args = process.argv.slice(2);
  const key = args.find((a) => a.startsWith('--fixture='))?.split('=')[1]?.toUpperCase();
  if (!key) usage(2);
  const f = [...FIXTURES, ...VALIDATION_FIXTURES]
    .find((x) => x.id.toUpperCase() === key || x.id.toUpperCase().startsWith(`${key}-`));
  if (!f) usage(2);

  const { default: db } = await import('../db/client.js');
  const { canonicalPosition } = await import('../../shared/positions.js');
  const { normaliseAthlete } = await import('../../shared/matching/pool.js');
  const { buildPositionIndex, buildArrivalIndex, divisionArrivalRates } = await import('../lib/v2/rosterEvidence.js');
  const { runPursuit } = await import('../lib/v2/pursuitRun.js');
  const {
    isScoreable, PURSUIT_WEIGHTS, PURSUIT_GATES, tailGate, CORE_FLOOR,
    abilityToPercentile, percentileOf,
  } = await import('../../shared/matching/v2/index.js');

  const sport = f.player.sport;
  const colleges = db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport);
  const byId = new Map(colleges.map((c) => [c.id, c]));
  const roster = db.prepare(`
    SELECT college_name, player_name, position, minutes_played, projected_minutes, games_started, projected_games_started,
           estimated_graduation_year, eligibility_end_year, country, season, division, class_year_label
      FROM roster_players WHERE sport = ? AND season = ?`).all(sport, SEASON);
  const arrivals = db.prepare('SELECT programme, sport, arrival_season, canonical_position, is_international FROM recruiting_arrivals WHERE sport = ?').all(sport);
  const ctx = {
    rosterProgrammes: new Set(roster.map((r) => r.college_name)),
    rosterIndex: buildPositionIndex(roster),
    arrivalIndex: buildArrivalIndex(arrivals),
    divisionArrivals: divisionArrivalRates(arrivals, new Map(colleges.map((c) => [c.name, c]))),
    arrivalsHorizon: arrivals.reduce((m, r) => Math.max(m, Number(r.arrival_season) || 0), 0),
  };

  const position = canonicalPosition(f.player.position);
  const v1Shape = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
  const athlete = {
    label: { id: f.id },
    v1Shape,
    recruitability: {
      sport, rating: f.player.football_ability, position,
      entryYear: f.player.recruiting_class_year, isInternational: f.player.origin === 'International',
    },
    opportunity: {
      sport, position, rating: f.player.football_ability,
      intendedMajor: f.player.intended_major ?? null, priorityRanking: null,
      competitiveLevelPriority: null, playingOpportunityPriority: null,
    },
  };
  const rep = runPursuit({ athlete, sport, colleges, ctx });

  const athleteSat = Number(f.player.sat_score) || null;
  const athleteGpa = Number(f.player.gpa) || null;
  const athletePct = abilityToPercentile(f.player.football_ability, sport);

  /* ---------------------------------------------------------------- */
  /* The decomposition the brief asks for                              */
  /* ---------------------------------------------------------------- */

  /**
   * A  athletic plausibility          - held, measured
   * B  roster demand                  - positionalOpportunity
   * C  coach recruiting propensity    - internationalPropensity ONLY
   * D  admissions viability           - NOT IN THE MODEL. Classified below.
   * E  financial access               - the Financial layer
   */
  const rows = [];
  for (const e of [...rep.pipeline.ranked, ...rep.pipeline.limited]) {
    const c = byId.get(e.id);
    const rOk = isScoreable(e.recruitability);
    const b = rOk ? e.recruitability.basis : (e.recruitability.detail ?? {});
    const A = rOk ? b.athleticPlausibility : b.athleticPlausibility ?? null;
    const delta = rOk ? b.athleticDelta : b.athleticDelta ?? null;
    rows.push({
      id: e.id, name: e.name, division: e.division, soccerScore: c?.soccer_score ?? null,
      programmePercentile: typeof c?.soccer_score === 'number' ? percentileOf(c.soccer_score, sport) : null,
      state: e.rankingState,
      rank: e.rank ?? null,
      A, delta,
      core: rOk ? b.core : null,
      B: rOk && b.coreBasis?.components?.positionalOpportunity?.value !== undefined
        ? b.coreBasis.components.positionalOpportunity.value : (b.positional ? null : null),
      positional: rOk ? b.positional : null,
      internationalApplicable: rOk ? b.internationalApplicable : null,
      R: rOk ? e.recruitability.value : null,
      F: isScoreable(e.financial) ? e.financial.value : null,
      O: isScoreable(e.opportunity) ? e.opportunity.value : null,
      P: isScoreable(e.pursuitPriority) ? e.pursuitPriority.value : null,
      academicRating: c?.academic_rating ?? null,
      satAvg: c?.sat_avg ?? null,
      admitRate: c?.admit_rate ?? null,
      netPrice: c?.net_price ?? null,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Scenario machinery                                                */
  /* ---------------------------------------------------------------- */

  const W = PURSUIT_WEIGHTS;
  const G = PURSUIT_GATES;
  /** The production arithmetic, restated once so every scenario shares it. */
  const priorityOf = (R, F, O, { gateR = true } = {}) => {
    const base = (W.recruitability * R) + (W.financial * F) + (W.opportunity * O);
    return base * (gateR ? tailGate(R, G.recruitability) : 1) * tailGate(F, G.financial);
  };

  const scenarios = {
    S1_CURRENT: (r) => (r.R === null ? null : { R: r.R, P: priorityOf(r.R, r.F, r.O) }),

    /**
     * S2. Roster demand matters LESS once the athlete is plausible.
     *
     * phi is the share of plausibility that survives when nothing else favours
     * the athlete. Raising it for D3 rows that already clear the plausibility
     * bar is the smallest possible expression of the brief's hypothesis: it
     * changes no evidence and no weight, only how much a weak roster signal is
     * allowed to subtract from a case that is otherwise sound.
     */
    S2_PLAUSIBILITY_EMPHASIS: (r) => {
      if (r.R === null) return null;
      if (r.division !== 'NCAA D3' || r.delta === null || r.delta < PLAUSIBLE_DELTA) {
        return { R: r.R, P: priorityOf(r.R, r.F, r.O) };
      }
      const phi = 0.70;
      const R = r.A * (phi + ((1 - phi) * r.core));
      return { R, P: priorityOf(R, r.F, r.O) };
    },

    /**
     * S3a. Roster demand removed from the core entirely, at D3. R = A.
     *
     * Includes D3 programmes currently LIMITED_DATA for want of a roster,
     * because that is the honest consequence: if roster demand is not required,
     * the programmes we have no roster for become rankable. 12 D3 programmes
     * arrive this way, and 228 NJCAA would arrive by the same logic if the
     * same reasoning were applied to them.
     */
    S3a_NO_ROSTER_DEMAND: (r) => {
      if (r.division !== 'NCAA D3') return r.R === null ? null : { R: r.R, P: priorityOf(r.R, r.F, r.O) };
      if (r.A === null || r.F === null || r.O === null) return null;
      return { R: r.A, P: priorityOf(r.A, r.F, r.O), promoted: r.state !== 'RANKED' };
    },

    /** S3b. The pursuit-level recruitability gate switched off at D3 only. */
    S3b_NO_RECRUITABILITY_GATE: (r) => {
      if (r.R === null) return null;
      const gateR = r.division !== 'NCAA D3';
      return { R: r.R, P: priorityOf(r.R, r.F, r.O, { gateR }) };
    },

    /**
     * S5. THE OPPORTUNITY CEILING. Not a scenario - a BOUND.
     *
     * Opportunity is set to 1.0 for every programme: the most any component
     * placed inside that layer could ever contribute, including an academic
     * preference. Where a programme still cannot reach the list under this
     * bound, no Opportunity component can put it there, and the architecture
     * question in section 7 is settled for that programme without anyone
     * having to build the component first.
     */
    S5_OPPORTUNITY_CEILING: (r) => (r.R === null ? null : { R: r.R, P: priorityOf(r.R, r.F, 1) }),
  };

  const ranked = {};
  for (const [name, fn] of Object.entries(scenarios)) {
    const out = rows.map((r) => ({ r, s: fn(r) })).filter((x) => x.s !== null)
      .map((x) => ({ ...x.r, R2: x.s.R, P2: x.s.P, promoted: Boolean(x.s.promoted) }))
      .sort((a, b) => b.P2 - a.P2 || String(a.name).localeCompare(String(b.name)));
    out.forEach((r, i) => { r.rank2 = i + 1; });
    ranked[name] = out;
  }

  /* ---------------------------------------------------------------- */
  /* S4. Admissions-aware classification. NO SCORE.                    */
  /* ---------------------------------------------------------------- */

  const admissionsClass = (r) => {
    if (athleteSat !== null && r.satAvg !== null) {
      return athleteSat >= r.satAvg - SAT_MARGIN ? 'PLAUSIBLE' : 'DIFFICULT';
    }
    if (r.admitRate !== null) {
      if (r.admitRate >= ADMIT_PLAUSIBLE) return 'PLAUSIBLE';
      if (r.admitRate < ADMIT_DIFFICULT) return 'DIFFICULT';
      return athleteGpa !== null && athleteGpa >= 3.7 ? 'PLAUSIBLE' : 'UNKNOWN';
    }
    return 'UNKNOWN';
  };
  const athleticClass = (r) => (r.delta === null ? 'UNKNOWN' : (r.delta >= PLAUSIBLE_DELTA ? 'PLAUSIBLE' : 'DIFFICULT'));
  const quadrant = (r) => {
    const a = athleticClass(r); const d = admissionsClass(r);
    if (a === 'UNKNOWN' || d === 'UNKNOWN') return 'INSUFFICIENT_EVIDENCE';
    return `${a === 'PLAUSIBLE' ? 'ATHLETIC_OK' : 'ATHLETIC_HARD'}/${d === 'PLAUSIBLE' ? 'ADMISSIONS_OK' : 'ADMISSIONS_HARD'}`;
  };
  for (const r of rows) r.quadrant = quadrant(r);

  /* ---------------------------------------------------------------- */
  /* Report                                                            */
  /* ---------------------------------------------------------------- */

  const d3 = rows.filter((r) => r.division === 'NCAA D3');
  const d3Ranked = d3.filter((r) => r.state === 'RANKED');
  const line = (s) => console.log(s);

  line(`${f.id}   rating ${f.player.football_ability} (percentile ${(athletePct * 100).toFixed(1)}) · GPA ${athleteGpa} · SAT ${athleteSat} · budget ${f.player.budget_range}`);
  line('');
  line('== RECRUITABILITY DECOMPOSITION, D3 ==');
  line(`  D3 programmes ${d3.length}, ranked ${d3Ranked.length}, limited ${d3.length - d3Ranked.length}`);
  line(`  A (athletic plausibility)   median ${median(d3Ranked.map((r) => r.A))}   min ${median(d3Ranked.map((r) => r.A)) !== null ? Math.min(...d3Ranked.map((r) => r.A)).toFixed(2) : '-'}  max ${Math.max(...d3Ranked.map((r) => r.A)).toFixed(2)}`);
  line(`  core (= roster demand here) median ${median(d3Ranked.map((r) => r.core))}   phi ${CORE_FLOOR}`);
  line(`  R                           median ${median(d3Ranked.map((r) => r.R))}`);
  const intlApplicable = d3Ranked.filter((r) => r.internationalApplicable).length;
  line(`  C (coach recruiting propensity) measured on ${intlApplicable}/${d3Ranked.length} D3 programmes`);
  line('    - the only propensity signal V2 holds is international arrival share, which is');
  line('      NOT_APPLICABLE for a domestic athlete. For this athlete core IS roster demand.');
  line('');

  const gateThreshold = G.recruitability.threshold;
  const suppressed = d3Ranked.filter((r) => r.A >= 0.5 && r.R < gateThreshold);
  const suppressedViable = suppressed.filter((r) => r.F >= 0.5 && r.quadrant.endsWith('ADMISSIONS_OK'));
  line(`== DOES B SUPPRESS A STRONG A+D+E CASE? ==`);
  line(`  D3 ranked with A >= 0.50 but R < ${gateThreshold} (inside the gate ramp): ${suppressed.length}`);
  line(`    of which financially viable (F >= 0.5) AND admissions-plausible:      ${suppressedViable.length}`);
  if (suppressedViable.length) {
    for (const r of [...suppressedViable].sort((a, b) => a.rank - b.rank).slice(0, 8)) {
      line(`      #${String(r.rank).padStart(4)} ${r.name.slice(0, 26).padEnd(27)} A ${r.A.toFixed(2)} core ${r.core.toFixed(2)} R ${r.R.toFixed(2)} F ${r.F.toFixed(2)} O ${r.O.toFixed(2)} acad ${r.academicRating}`);
    }
  }
  line('');

  line('== SCENARIOS (D3 only; every other division untouched) ==');
  const head = ['programme', ...Object.keys(scenarios)];
  line(`  ${head[0].padEnd(24)}${head.slice(1).map((h) => h.padEnd(26)).join('')}`);
  for (const w of WATCH) {
    const cells = Object.keys(scenarios).map((s) => {
      const row = ranked[s].find((r) => r.name === w);
      if (!row) {
        const base = rows.find((r) => r.name === w);
        return (base ? `${base.state}` : 'not found').padEnd(26);
      }
      return `#${row.rank2} P ${row.P2.toFixed(3)} R ${row.R2.toFixed(2)}${row.promoted ? ' *new*' : ''}`.padEnd(26);
    });
    line(`  ${w.slice(0, 23).padEnd(24)}${cells.join('')}`);
  }
  line('');

  for (const s of Object.keys(scenarios)) {
    const list = ranked[s];
    const t25 = list.slice(0, 25); const t100 = list.slice(0, 100);
    const promoted = t100.filter((r) => r.promoted).length;
    line(`  ${s}`);
    line(`    top 25 : ${comp(t25)}`);
    line(`    top 100: ${comp(t100)}`);
    line(`    top 25  median programme strength ${median(t25.map((r) => r.soccerScore))}  median academic rating ${median(t25.map((r) => r.academicRating))}`);
    line(`    top 100 median programme strength ${median(t100.map((r) => r.soccerScore))}  median academic rating ${median(t100.map((r) => r.academicRating))}`);
    if (s !== 'S1_CURRENT') {
      const base = new Set(ranked.S1_CURRENT.slice(0, 100).map((r) => r.id));
      const now = new Set(t100.map((r) => r.id));
      const inter = [...now].filter((x) => base.has(x)).length;
      line(`    vs current: ${inter}/100 shared, ${100 - inter} entered${promoted ? `, ${promoted} of them previously LIMITED_DATA` : ''}`);
    }
    line('');
  }

  line('== WHAT MOVED FOR THE 31 SUPPRESSED PROGRAMMES ==');
  for (const s of ['S2_PLAUSIBILITY_EMPHASIS', 'S3a_NO_ROSTER_DEMAND', 'S3b_NO_RECRUITABILITY_GATE']) {
    const moves = suppressed.map((r) => {
      const now = ranked[s].find((x) => x.id === r.id);
      return now ? r.rank - now.rank2 : null;
    }).filter((x) => x !== null);
    line(`  ${s.padEnd(28)} median rank gain ${median(moves)}  best ${Math.max(...moves)}  worst ${Math.min(...moves)}`);
  }
  line('');

  line('== ACADEMIC STRENGTH IS NOT IN THE MODEL. WHAT DOES THAT LOOK LIKE? ==');
  const corr = (a, b) => {
    const n = a.length; if (n < 3) return null;
    const ma = a.reduce((x, y) => x + y, 0) / n; const mb = b.reduce((x, y) => x + y, 0) / n;
    let c = 0; let va = 0; let vb = 0;
    for (let i = 0; i < n; i += 1) { const d = a[i] - ma; const e = b[i] - mb; c += d * e; va += d * d; vb += e * e; }
    return (va === 0 || vb === 0) ? null : Number((c / Math.sqrt(va * vb)).toFixed(3));
  };
  const withAcad = d3Ranked.filter((r) => Number.isFinite(r.academicRating));
  line(`  corr(academic rating, pursuit priority) across ranked D3: ${corr(withAcad.map((r) => r.academicRating), withAcad.map((r) => r.P))}`);
  line(`  corr(academic rating, recruitability)                    : ${corr(withAcad.map((r) => r.academicRating), withAcad.map((r) => r.R))}`);
  const t25 = ranked.S1_CURRENT.slice(0, 25).filter((r) => Number.isFinite(r.academicRating)).map((r) => r.academicRating);
  const allD3 = withAcad.map((r) => r.academicRating);
  line(`  academic rating, current top 25: median ${median(t25)} (range ${Math.min(...t25)}-${Math.max(...t25)})`);
  line(`  academic rating, all ranked D3 : median ${median(allD3)} (range ${Math.min(...allD3)}-${Math.max(...allD3)})`);
  line('');

  line('== S4. ADMISSIONS-AWARE CLASSIFICATION (no score) ==');
  const buckets = ['ATHLETIC_OK/ADMISSIONS_OK', 'ATHLETIC_OK/ADMISSIONS_HARD', 'ATHLETIC_HARD/ADMISSIONS_OK', 'ATHLETIC_HARD/ADMISSIONS_HARD', 'INSUFFICIENT_EVIDENCE'];
  const tallyBy = (set) => buckets.map((b) => `${b} ${set.filter((r) => r.quadrant === b).length}`).join('  ');
  line(`  whole pool : ${tallyBy(rows)}`);
  line(`  D3 only    : ${tallyBy(d3)}`);
  for (const div of ['NCAA D1', 'NCAA D2', 'NAIA', 'NJCAA', 'USCAA']) {
    line(`  ${div.padEnd(11)}: ${tallyBy(rows.filter((r) => r.division === div))}`);
  }
  line('');
  line('  the watched programmes:');
  for (const w of WATCH) {
    const r = rows.find((x) => x.name === w);
    if (!r) { line(`    ${w.padEnd(24)} not in pool`); continue; }
    line(`    ${w.padEnd(24)} ${r.quadrant.padEnd(30)} acad ${String(r.academicRating).padEnd(5)} SAT ${String(r.satAvg ?? '-').padEnd(5)} admit ${r.admitRate ?? '-'}  delta ${r.delta === null ? '-' : r.delta.toFixed(2)}  strength ${r.soccerScore}`);
  }
  line('');
  line('  NOTE: the athlete clears every admissions bar in this pool on SAT alone, so the');
  line('  classification separates nothing for them. That is a fact about this athlete, not');
  line('  about the evidence: it is the reason academic AMBITION and admissions VIABILITY');
  line('  cannot be the same field.');

  if (args.includes('--json')) {
    console.log(JSON.stringify({
      fixture: f.id,
      scenarios: Object.fromEntries(Object.entries(ranked).map(([k, v]) => [k, v.slice(0, 100).map((r) => ({
        rank: r.rank2, name: r.name, division: r.division, P: Number(r.P2.toFixed(4)), R: Number(r.R2.toFixed(4)),
        academicRating: r.academicRating, soccerScore: r.soccerScore, promoted: r.promoted,
      }))])),
      quadrants: Object.fromEntries(buckets.map((b) => [b, rows.filter((r) => r.quadrant === b).length])),
    }, null, 2));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
