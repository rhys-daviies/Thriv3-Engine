/**
 * A7.12: the full V2 architecture validation checkpoint.
 *
 * READ-ONLY. It runs the real pipeline over the real universe and reports.
 * It writes nothing, adopts nothing, changes no constant and touches no route.
 * Every number in the A7.12 report comes from here.
 *
 *   node server/scripts/v2ArchitectureCheckpoint.js --section=arch
 *   node server/scripts/v2ArchitectureCheckpoint.js --section=universe
 *   node server/scripts/v2ArchitectureCheckpoint.js --section=all
 *
 * Sections: arch inputs programme universe guard authority response
 *           independence missing explain human
 *
 * WHY ONE SCRIPT RATHER THAN ELEVEN. A7.12 asks whether the layers agree with
 * each other, and eleven scripts each building their own pool is how two
 * sections come to describe different universes. One pool context per sport,
 * built once, shared by every section.
 */
import db from '../db/client.js';
import { canonicalPosition } from '../../shared/positions.js';
import { normaliseAthlete } from '../../shared/matching/pool.js';
import { buildPoolContext } from '../lib/v2/poolContext.js';
import { runPursuit } from '../lib/v2/pursuitRun.js';
import {
  isScoreable, isNotApplicable, RANKING_STATE, GRADE,
  PURSUIT_WEIGHTS, PURSUIT_GATES, TOP_N, WEIGHTING_ARCHITECTURE, tailGate,
  CORE_FLOOR, BEHAVIOUR_WEIGHTS, CORE_WEIGHTS, RECRUITABILITY_COVERAGE_FLOOR,
  COMPATIBILITY_AT_LEVEL, COMPATIBILITY_DECAY, COMPATIBILITY_RISE,
  ARRIVAL_CLAIM_WEIGHT, MAX_CLAIM_SHARE, MARKET_MIN_ARRIVALS, MARKET_PSEUDO_COUNT, NEAR_BAND_KM,
  VALUE_WEIGHTS, PREFERENCE_WEIGHTS, PRIORITY_LIFT, AMBITION_LIFT, PRIORITY_MAP,
  OPPORTUNITY_COVERAGE_FLOOR, COMPETITIVE_LEVEL_SPAN, TRAJECTORY_SATURATION,
  CONTRIBUTION_ANCHOR, HALF_VIABILITY_RELATIVE_GAP, BUDGET_INTERVALS, LEGACY_BUDGET_INTERVALS,
  NORMS_ID, NORMS_DIGEST, PLAYING_NORMS_ID, PLAYING_NORMS_DIGEST, CALIBRATION_ID,
  abilityToProgrammeScore, abilityToPercentile, percentileOf,
  buildValidationAthlete, PROFILES, REQUIRED_INPUTS, NOT_COLLECTED,
  explainProgramme, renderExplanation,
  kendallTauB, agreementFor, CLASSIFICATION_ORDER, isPursue,
} from '../../shared/matching/v2/index.js';
import { FIXTURES } from './v2Fixtures.js';

const SEASON = '2026';
const N = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const pad = (s, n) => String(s).slice(0, n).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

const arg = (k, dflt = null) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};

// -- statistics -------------------------------------------------------------

function quantiles(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
  return {
    n: s.length, min: s[0], p10: at(10), p25: at(25), median: at(50),
    p75: at(75), p90: at(90), max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
}

function pearson(a, b) {
  const n = a.length;
  if (n < 3) return null;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let c = 0; let va = 0; let vb = 0;
  for (let i = 0; i < n; i += 1) { const d = a[i] - ma; const e = b[i] - mb; c += d * e; va += d * d; vb += e * e; }
  return (va === 0 || vb === 0) ? null : c / Math.sqrt(va * vb);
}

/**
 * TIE-AVERAGED ranks, which is not a detail.
 *
 * Financial saturates at 1.0 for a high-budget athlete, so 800 of 858
 * programmes carry the same F. Ranking ties sequentially hands the block its
 * ranks in whatever order the array arrived in - which here is pursuit order -
 * and the result is a large correlation between F and rank that is entirely an
 * artefact of the sort. Averaging the tied ranks reports the 0 it should.
 */
function spearman(a, b) {
  const rank = (xs) => {
    const idx = xs.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(xs.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
      const avg = ((i + 1) + (j + 1)) / 2;
      for (let k = i; k <= j; k += 1) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  return pearson(rank(a), rank(b));
}

const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

// -- the pool, built once per sport ----------------------------------------

const CTX = new Map();
function contextFor(sport) {
  if (!CTX.has(sport)) CTX.set(sport, buildPoolContext({ db, sport, season: SEASON }));
  return CTX.get(sport);
}

const COLLEGE = new Map();
function collegesById(sport) {
  if (!COLLEGE.has(sport)) COLLEGE.set(sport, new Map(contextFor(sport).colleges.map((c) => [c.id, c])));
  return COLLEGE.get(sport);
}

/**
 * Run one fixture, optionally with fields overridden.
 *
 * `patch` edits the RECORD before it is normalised, so a financial or academic
 * variant goes through exactly the same intake path a real athlete would.
 */
function runFixture(key, profileId = 'UNDECLARED', { patch = {}, profile = null } = {}) {
  const f = FIXTURES.find((x) => x.id.toUpperCase().startsWith(`${key.toUpperCase()}-`));
  if (!f) throw new Error(`no fixture ${key}`);
  const record = { ...f.player, ...patch };
  const sport = record.sport;
  const ctx = contextFor(sport);
  const position = canonicalPosition(record.position);
  const v1Shape = normaliseAthlete({ ...record, preferred_divisions: '[]', preferred_conferences: '[]' });
  const { athlete, inputs } = buildValidationAthlete({
    record, v1Shape, position, label: f.id, profile: profile ?? PROFILES[profileId],
  });
  const rep = runPursuit({ athlete, sport, colleges: ctx.colleges, ctx });
  const byId = collegesById(sport);
  const rows = rep.pipeline.ranked.map((e) => ({
    id: e.id, name: e.name, division: e.division, rank: e.rank,
    strength: byId.get(e.id)?.soccer_score ?? null,
    academic: byId.get(e.id)?.academic_rating ?? null,
    conference: byId.get(e.id)?.conference ?? null,
    state: byId.get(e.id)?.state ?? null,
    R: e.recruitability.value, F: e.financial.value, O: e.opportunity.value,
    P: e.pursuitPriority.value,
    base: e.pursuitPriority.basis.base,
    gR: e.pursuitPriority.basis.recruitabilityGate,
    gF: e.pursuitPriority.basis.financialGate,
    gRfired: e.pursuitPriority.basis.recruitabilityGateFired,
    gFfired: e.pursuitPriority.basis.financialGateFired,
    gRloss: e.pursuitPriority.basis.recruitabilityGateLoss,
    gFloss: e.pursuitPriority.basis.financialGateLoss,
    grade: e.pursuitPriority.grade,
    rCoverage: e.recruitability.coverage, fCoverage: e.financial.coverage, oCoverage: e.opportunity.coverage,
    rGrade: e.recruitability.grade, fGrade: e.financial.grade, oGrade: e.opportunity.grade,
    rBasis: e.recruitability.basis, fBasis: e.financial.basis, oBasis: e.opportunity.basis,
    entry: e,
  }));
  const eq = abilityToProgrammeScore(record.football_ability, sport);
  return { f, record, sport, rep, rows, byId, eq, inputs, athlete, ctx };
}

const BANDS = (eq) => ([
  ['substantially above (>= +10)', (s) => s - eq >= 10],
  ['moderately above (+3 to +10)', (s) => s - eq >= 3 && s - eq < 10],
  ['near athlete level (-3 to +3)', (s) => Math.abs(s - eq) < 3],
  ['moderately below (-15 to -3)', (s) => s - eq <= -3 && s - eq > -15],
  ['substantially below (< -15)', (s) => s - eq <= -15],
]);

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const composition = (rows) => Object.entries(rows.reduce((a, r) => { a[r.division] = (a[r.division] || 0) + 1; return a; }, {}))
  .sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(' · ');

// ===========================================================================
// 1  ARCHITECTURE
// ===========================================================================

function sectionArch() {
  console.log('== 1  CURRENT V2 ARCHITECTURE, FROM CODE ==\n');
  console.log(`calibration        ${CALIBRATION_ID}`);
  console.log(`positional norms   ${NORMS_ID} (digest ${NORMS_DIGEST})`);
  console.log(`playing norms      ${PLAYING_NORMS_ID} (digest ${PLAYING_NORMS_DIGEST})`);
  console.log('');
  console.log('-- COACH RECRUITABILITY --');
  console.log('  R = A x ( phi + (1 - phi) x SUM over KNOWN signals of w_s x v_s )');
  console.log(`  phi (CORE_FLOOR)            ${CORE_FLOOR}`);
  console.log(`  behaviour weights           positional ${BEHAVIOUR_WEIGHTS.positional} · market ${BEHAVIOUR_WEIGHTS.market}`);
  console.log(`  A = plausibility            atLevel ${COMPATIBILITY_AT_LEVEL} · decay ${COMPATIBILITY_DECAY} · rise ${COMPATIBILITY_RISE}`);
  console.log(`  positional value            clamp01((vacatedStarters x fillRate - claims) / typicalStarters)`);
  console.log(`  claims                      min(expected x ${MAX_CLAIM_SHARE}, ${ARRIVAL_CLAIM_WEIGHT} x arrivals)`);
  console.log(`  market                      min arrivals ${MARKET_MIN_ARRIVALS} · pseudo-count ${MARKET_PSEUDO_COUNT} · near band ${NEAR_BAND_KM} km`);
  console.log(`  coverage floor constant     ${RECRUITABILITY_COVERAGE_FLOOR} (NOT applied: the evidence floor is "at least one behavioural signal KNOWN")`);
  console.log(`  legacy CORE_WEIGHTS         ${JSON.stringify(CORE_WEIGHTS)}  (retired at A7.7.4, exported for readers)`);
  console.log('  REQUIRED: athleticPlausibility. Plus at least one behavioural signal.');
  console.log('  MEASURED iff A measured AND every known signal measured AND coverage = 1.');
  console.log('');
  console.log('-- FINANCIAL VIABILITY --');
  console.log('  value = mean over the cost/budget interval of 1 / (1 + rel / h)');
  console.log(`  h (HALF_VIABILITY_RELATIVE_GAP)  ${HALF_VIABILITY_RELATIVE_GAP}`);
  console.log(`  rel = gap / anchor, anchor = max(contribution floor, ${CONTRIBUTION_ANCHOR})`);
  console.log('  gap = max(0, cost - contribution), per interval endpoint');
  console.log('  NO athletic award and NO merit award is subtracted (athleticAwardAssumed 0, meritAidAssumed 0)');
  console.log('  REQUIRED: a cost basis AND a family contribution. Coverage is 0.5 per input held.');
  console.log('  PARTIAL when the cost basis is an interval, the contribution is a legacy band, or the athlete is international.');
  console.log(`  current bands ${Object.keys(BUDGET_INTERVALS).length} · legacy bands ${Object.keys(LEGACY_BUDGET_INTERVALS).length}`);
  console.log('');
  console.log('-- ATHLETE OPPORTUNITY / FIT --');
  console.log(`  objective    playingPathway ${VALUE_WEIGHTS.playingPathway} (REQUIRED) · programmeTrajectory ${VALUE_WEIGHTS.programmeTrajectory}`);
  console.log(`  preference   majorFit ${PREFERENCE_WEIGHTS.majorFit} · locationFit ${PREFERENCE_WEIGHTS.locationFit} · athleticOutcome ${PREFERENCE_WEIGHTS.athleticOutcome} · academicStrengthFit ${PREFERENCE_WEIGHTS.academicStrengthFit}`);
  console.log(`  coverage floor              ${OPPORTUNITY_COVERAGE_FLOOR}`);
  console.log(`  explicit 1-5 weight lift    ${AMBITION_LIFT}   legacy ranking lift ${PRIORITY_LIFT}`);
  console.log(`  competitive level span      ${COMPETITIVE_LEVEL_SPAN}   trajectory saturation ${TRAJECTORY_SATURATION}`);
  console.log(`  priority map                ${JSON.stringify(PRIORITY_MAP)}`);
  console.log('  Value is renormalised over SCORED components; NOT_APPLICABLE leaves the denominator.');
  console.log('');
  console.log('-- PURSUIT PRIORITY --');
  console.log('  base = wR.R + wF.F + wO.O');
  console.log('  P    = base x gR(R) x gF(F)');
  console.log('  gate(v) = floor + (1 - floor) x smoothstep(max(0,v) / threshold)');
  console.log(`  weights      ${JSON.stringify(PURSUIT_WEIGHTS)}`);
  console.log(`  gates        ${JSON.stringify(PURSUIT_GATES)}`);
  console.log(`  architecture ${WEIGHTING_ARCHITECTURE}   TOP_N ${TOP_N} (an output limit, applied after the sort)`);
  console.log('  ALL THREE layers are required. Any one unscoreable -> LIMITED_DATA, pursuitPriority null.');
  console.log('');
  console.log('  gate response:');
  console.log(`    R  ${[0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5].map((v) => `${v}->${N(tailGate(v, PURSUIT_GATES.recruitability), 3)}`).join('  ')}`);
  console.log(`    F  ${[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8].map((v) => `${v}->${N(tailGate(v, PURSUIT_GATES.financial), 3)}`).join('  ')}`);
}

// ===========================================================================
// 2  ATHLETE INPUT INVENTORY
// ===========================================================================

function sectionInputs() {
  console.log('== 2  ATHLETE INPUT INVENTORY ==\n');
  for (const [field, spec] of Object.entries(REQUIRED_INPUTS)) {
    console.log(`  ${pad(field, 32)}${spec.required ? 'REQUIRED' : 'OPTIONAL'}  ${spec.withoutIt}`);
  }
  console.log('');
  console.log('  NOT COLLECTED BY THE PRODUCT:');
  for (const f of NOT_COLLECTED) console.log(`    - ${f}`);
  console.log('');
  const cols = db.prepare('PRAGMA table_info(players)').all().map((c) => c.name);
  console.log('  WHICH SCORER INPUTS THE PRODUCT CAN ACTUALLY HOLD:\n');
  const scorerInputs = [
    ['sport', 'REQUIRED'], ['football_ability', 'REQUIRED'], ['position', 'REQUIRED'],
    ['recruiting_class_year', 'REQUIRED'], ['budget_range', 'LEGACY'],
    ['contribution_state', 'REQUIRED-ish'], ['max_annual_contribution_usd', 'REQUIRED-ish'],
    ['state', 'OPTIONAL'], ['nationality', 'OPTIONAL'], ['origin', 'OPTIONAL'],
    ['intended_major', 'OPTIONAL'], ['criterion_ranking', 'LEGACY'],
    ['competitive_level_priority', 'OPTIONAL'], ['playing_opportunity_priority', 'OPTIONAL'],
    ['academic_strength_priority', 'OPTIONAL'],
    ['gpa', 'CONTEXT-ONLY'], ['sat_score', 'CONTEXT-ONLY'], ['act_score', 'CONTEXT-ONLY'],
    ['academic_minimum', 'CONTEXT-ONLY'], ['preferred_divisions', 'FILTER'], ['preferred_conferences', 'FILTER'],
  ];
  console.log(`    ${pad('scorer input', 32)}${pad('class', 14)}${pad('column?', 16)}populated`);
  const total = db.prepare('SELECT COUNT(*) n FROM players').get().n;
  for (const [field, cls] of scorerInputs) {
    const has = cols.includes(field);
    const k = has ? db.prepare(`SELECT COUNT(*) n FROM players WHERE "${field}" IS NOT NULL AND "${field}" != ''`).get().n : null;
    console.log(`    ${pad(field, 32)}${pad(cls, 14)}${pad(has ? 'yes' : 'NO COLUMN', 16)}${has ? `${k}/${total}` : '—'}`);
  }
  console.log('');
  console.log('  THE PRODUCTION SHAPE: what Opportunity looks like for an athlete the product can');
  console.log('  actually describe - a criterion ranking and an intended major, and none of the');
  console.log('  three 1-5 priorities, because no column exists to put them in.\n');
  const shapes = [
    ['fixtures as written (nothing declared)', {}, 'UNDECLARED'],
    ['production shape (ranking + major)', { intended_major: 'Business', criterion_ranking: JSON.stringify(['athletic', 'roster', 'academic', 'geography', 'affordability', 'programQuality']) }, 'UNDECLARED'],
    ['everything the harness can state', { intended_major: 'Business' }, 'FULLY_DECLARED_LEVEL'],
  ];
  console.log(`    ${pad('shape', 42)}${rpad('ranked', 8)}${rpad('medO', 8)}${rpad('scored components', 20)}${rpad('N/A components', 18)}`);
  for (const [label, patch, profileId] of shapes) {
    const r = runFixture('A', profileId, { patch });
    const x = r.rows[0];
    console.log(`    ${pad(label, 42)}${rpad(r.rows.length, 8)}${rpad(N(median(r.rows.map((y) => y.O)), 3), 8)}`
      + `${rpad(Object.keys(x.oBasis.components ?? {}).join(','), 20)}${rpad((x.oBasis.notApplicable ?? []).join(',') || 'none', 18)}`);
  }
}

// ===========================================================================
// 3  PROGRAMME DATA INVENTORY
// ===========================================================================

function sectionProgramme() {
  console.log('== 3  PROGRAMME-SIDE EVIDENCE COVERAGE ==\n');
  for (const sport of ['mens-soccer', 'womens-soccer']) {
    const ctx = contextFor(sport);
    const cols = ctx.colleges;
    const divisions = [...new Set(cols.map((c) => c.division))].sort();
    console.log(`-- ${sport}: ${cols.length} active programmes --`);
    const probes = [
      ['soccer_score (plausibility)', (c) => Number.isFinite(c.soccer_score)],
      ['net_price (financial)', (c) => Number.isFinite(c.net_price)],
      ['control (public/private)', (c) => c.control !== null && c.control !== undefined],
      ['tuition in+out (residency)', (c) => Number.isFinite(c.tuition_in_state) && Number.isFinite(c.tuition_out_state)],
      ['academic_rating (academic fit)', (c) => Number.isFinite(c.academic_rating)],
      ['notable_majors (major fit)', (c) => c.notable_majors !== null && c.notable_majors !== undefined && String(c.notable_majors).length > 2],
      ['lat/long (market, location)', (c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude)],
      ['roster on file 2026', (c) => ctx.rosterProgrammes.has(c.name)],
      ['recruiting arrivals on file', (c) => ctx.arrivalIndex.has(c.name)],
      ['win pct both seasons (trajectory)', (c) => Number.isFinite(c.recent_win_pct) && Number.isFinite(c.prior_win_pct)],
    ];
    const head = `  ${pad('evidence', 34)}${rpad('all', 12)}${divisions.map((d) => rpad(d, 10)).join('')}`;
    console.log(head);
    for (const [label, test] of probes) {
      const all = cols.filter(test).length;
      const per = divisions.map((d) => {
        const sub = cols.filter((c) => c.division === d);
        const k = sub.filter(test).length;
        return rpad(`${(100 * k / (sub.length || 1)).toFixed(0)}%`, 10);
      }).join('');
      console.log(`  ${pad(label, 34)}${rpad(`${all} ${(100 * all / cols.length).toFixed(0)}%`, 12)}${per}`);
    }
    console.log(`  ${pad('programmes per division', 34)}${rpad(cols.length, 12)}${divisions.map((d) => rpad(cols.filter((c) => c.division === d).length, 10)).join('')}`);
    console.log('');
  }
}

// ===========================================================================
// 4 + 5 + 6 + 7 + 8 + 23 + 24 + 25  THE UNIVERSE
// ===========================================================================

function sectionUniverse() {
  console.log('== 4  FIXTURE DEFINITIONS ==\n');
  for (const f of FIXTURES) {
    const p = f.player;
    console.log(`  ${f.id}`);
    console.log(`    sport ${p.sport} · position ${p.position} · rating ${p.football_ability} (percentile ${N(abilityToPercentile(p.football_ability, p.sport), 3)}, equivalent strength ${N(abilityToProgrammeScore(p.football_ability, p.sport), 1)})`);
    console.log(`    entry ${p.recruiting_class_year} · nationality ${p.nationality} · origin ${p.origin} · state ${p.state ?? 'NULL'} · city ${p.city ?? 'NULL'}`);
    console.log(`    budget_range ${p.budget_range} · contribution_state NOT SET (legacy band) · gpa ${p.gpa} · sat ${p.sat_score ?? 'NULL'} · act ${p.act_score ?? 'NULL'}`);
    console.log(`    intended_major NULL · competitive_level_priority NULL · playing_opportunity_priority NULL · academic_strength_priority NULL`);
    console.log(`    preferred_divisions [] · preferred_conferences [] · criterion_ranking NULL · academic_minimum NULL`);
  }
  console.log('');

  const runs = KEYS.map((k) => ({ k, r: runFixture(k) }));

  console.log('== 5  FULL-UNIVERSE STATUS (profile UNDECLARED) ==\n');
  console.log(`  ${pad('fixture', 10)}${rpad('universe', 10)}${rpad('eligible', 10)}${rpad('RANKED', 9)}${rpad('LIMITED', 9)}${rpad('INELIG', 8)}${rpad('SUPPR', 7)}  ranked division composition`);
  for (const { k, r } of runs) {
    const c = r.rep.counts;
    const total = db.prepare('SELECT COUNT(*) n FROM colleges WHERE sport = ?').get(r.sport).n;
    console.log(`  ${pad(k, 10)}${rpad(total, 10)}${rpad(c.evaluated, 10)}${rpad(c.ranked, 9)}${rpad(c.limitedData, 9)}${rpad(c.ineligible, 8)}${rpad(c.suppressed, 7)}  ${composition(r.rows)}`);
  }
  console.log('');

  console.log('== 6  LAYER DISTRIBUTIONS OVER THE RANKED UNIVERSE ==\n');
  for (const { k, r } of runs) {
    console.log(`  ${k}  (n = ${r.rows.length})`);
    for (const [label, get] of [['Recruitability', (x) => x.R], ['Financial', (x) => x.F], ['Opportunity', (x) => x.O], ['Pursuit', (x) => x.P]]) {
      const q = quantiles(r.rows.map(get));
      console.log(`    ${pad(label, 16)}p10 ${N(q.p10)}  p25 ${N(q.p25)}  median ${N(q.median)}  p75 ${N(q.p75)}  p90 ${N(q.p90)}   [min ${N(q.min)} max ${N(q.max)}]`);
    }
    for (const [label, g, cov] of [['R', (x) => x.rGrade, (x) => x.rCoverage], ['F', (x) => x.fGrade, (x) => x.fCoverage], ['O', (x) => x.oGrade, (x) => x.oCoverage]]) {
      const meas = r.rows.filter((x) => g(x) === GRADE.MEASURED).length;
      const q = quantiles(r.rows.map(cov));
      console.log(`    ${pad(`${label} evidence`, 16)}MEASURED ${rpad(meas, 5)} (${(100 * meas / r.rows.length).toFixed(0)}%)  PARTIAL ${rpad(r.rows.length - meas, 5)}   coverage median ${N(q.median)} p10 ${N(q.p10)}`);
    }
    const pGrade = r.rows.filter((x) => x.grade === GRADE.MEASURED).length;
    console.log(`    ${pad('P grade', 16)}MEASURED ${pGrade} (${(100 * pGrade / r.rows.length).toFixed(0)}%)`);
  }
  console.log('');

  console.log('== 7  TOP-RANK SHAPE ==\n');
  for (const { k, r } of runs) {
    console.log(`  ${k}   athlete-equivalent programme strength ${N(r.eq, 1)}`);
    console.log(`    ${pad('slice', 8)}${rpad('medStr', 8)}${rpad('strMin', 8)}${rpad('strMax', 8)}${rpad('medR', 7)}${rpad('medF', 7)}${rpad('medO', 7)}${rpad('medP', 7)}  composition`);
    for (const n of [10, 25, 50, 100, 250]) {
      const s = r.rows.slice(0, n);
      if (!s.length) continue;
      const st = s.map((x) => x.strength).filter(Number.isFinite);
      console.log(`    ${pad(`top${n}`, 8)}${rpad(N(median(st), 1), 8)}${rpad(N(Math.min(...st), 1), 8)}${rpad(N(Math.max(...st), 1), 8)}`
        + `${rpad(N(median(s.map((x) => x.R)), 2), 7)}${rpad(N(median(s.map((x) => x.F)), 2), 7)}${rpad(N(median(s.map((x) => x.O)), 2), 7)}${rpad(N(median(s.map((x) => x.P)), 3), 7)}  ${composition(s)}`);
    }
    console.log('');
  }

  console.log('== 8  ATHLETE-RELATIVE STRENGTH BANDS ==\n');
  for (const { k, r } of runs) {
    console.log(`  ${k}   equivalent ${N(r.eq, 1)}   (ranked universe ${r.rows.length})`);
    console.log(`    ${pad('band', 32)}${rpad('n', 6)}${rpad('medR', 7)}${rpad('medF', 7)}${rpad('medO', 7)}${rpad('medP', 8)}${rpad('medRank', 9)}${rpad('top100', 8)}${rpad('top250', 8)}`);
    for (const [label, test] of BANDS(r.eq)) {
      const rows = r.rows.filter((x) => Number.isFinite(x.strength) && test(x.strength));
      if (!rows.length) { console.log(`    ${pad(label, 32)}${rpad(0, 6)}`); continue; }
      console.log(`    ${pad(label, 32)}${rpad(rows.length, 6)}${rpad(N(median(rows.map((x) => x.R)), 2), 7)}${rpad(N(median(rows.map((x) => x.F)), 2), 7)}`
        + `${rpad(N(median(rows.map((x) => x.O)), 2), 7)}${rpad(N(median(rows.map((x) => x.P)), 3), 8)}${rpad(median(rows.map((x) => x.rank)), 9)}`
        + `${rpad(rows.filter((x) => x.rank <= 100).length, 8)}${rpad(rows.filter((x) => x.rank <= 250).length, 8)}`);
    }
    console.log('');
  }

  console.log('== 23  RANKING CONCENTRATION IN THE TOP 100 ==\n');
  for (const { k, r } of runs) {
    const top = r.rows.slice(0, 100);
    const all = r.rows;
    const share = (sel, key) => {
      const t = top.reduce((a, x) => { const v = key(x); a[v] = (a[v] || 0) + 1; return a; }, {});
      const u = all.reduce((a, x) => { const v = key(x); a[v] = (a[v] || 0) + 1; return a; }, {});
      return Object.entries(t).sort((x, y) => y[1] - x[1]).slice(0, sel)
        .map(([v, n]) => `${v} ${n} (universe ${u[v]}, ${(100 * n / u[v]).toFixed(0)}% of them)`).join(' · ');
    };
    console.log(`  ${k}`);
    console.log(`    division    ${share(6, (x) => x.division)}`);
    console.log(`    conference  ${share(4, (x) => x.conference ?? 'none')}`);
    console.log(`    state       ${share(5, (x) => x.state ?? 'none')}`);
  }
  console.log('');

  console.log('== 24  THE FULL-UNIVERSE TAIL ==\n');
  for (const { k, r } of runs) {
    console.log(`  ${k}   ranked ${r.rows.length}`);
    console.log(`    ${pad('slice', 12)}${rpad('n', 6)}${rpad('Pmax', 8)}${rpad('Pmin', 8)}${rpad('spread', 8)}${rpad('medStr', 8)}${rpad('medR', 7)}${rpad('medF', 7)}${rpad('medO', 7)}${rpad('distinctP', 10)}`);
    for (const [label, lo, hi] of [['1-100', 1, 100], ['101-250', 101, 250], ['251-500', 251, 500], ['501+', 501, 1e9]]) {
      const s = r.rows.filter((x) => x.rank >= lo && x.rank <= hi);
      if (!s.length) continue;
      const ps = s.map((x) => x.P);
      const st = s.map((x) => x.strength).filter(Number.isFinite);
      console.log(`    ${pad(label, 12)}${rpad(s.length, 6)}${rpad(N(Math.max(...ps), 4), 8)}${rpad(N(Math.min(...ps), 4), 8)}${rpad(N(Math.max(...ps) - Math.min(...ps), 4), 8)}`
        + `${rpad(N(median(st), 1), 8)}${rpad(N(median(s.map((x) => x.R)), 2), 7)}${rpad(N(median(s.map((x) => x.F)), 2), 7)}${rpad(N(median(s.map((x) => x.O)), 2), 7)}`
        + `${rpad(new Set(ps.map((p) => p.toFixed(6))).size, 10)}`);
    }
    const dup = r.rows.reduce((a, x) => { const key = x.P.toFixed(6); a[key] = (a[key] || 0) + 1; return a; }, {});
    const ties = Object.values(dup).filter((v) => v > 1).reduce((a, b) => a + b, 0);
    console.log(`    exact P ties across the ranked universe: ${ties} programmes in ${Object.values(dup).filter((v) => v > 1).length} groups`);
  }
  console.log('');

  console.log('== 25  THE TOP-100 BOUNDARY ==\n');
  console.log(`  ${pad('fixture', 10)}${rpad('P@90', 9)}${rpad('P@100', 9)}${rpad('P@110', 9)}${rpad('P@150', 9)}${rpad('90-100', 9)}${rpad('100-110', 9)}${rpad('100-150', 9)}${rpad('medGap1-250', 12)}`);
  for (const { k, r } of runs) {
    const at = (n) => r.rows[n - 1]?.P ?? NaN;
    const gaps = [];
    for (let i = 1; i < Math.min(250, r.rows.length); i += 1) gaps.push(r.rows[i - 1].P - r.rows[i].P);
    console.log(`  ${pad(k, 10)}${rpad(N(at(90), 4), 9)}${rpad(N(at(100), 4), 9)}${rpad(N(at(110), 4), 9)}${rpad(N(at(150), 4), 9)}`
      + `${rpad(N(at(90) - at(100), 4), 9)}${rpad(N(at(100) - at(110), 4), 9)}${rpad(N(at(100) - at(150), 4), 9)}${rpad(N(median(gaps), 5), 12)}`);
  }
  console.log('');
  console.log('  largest single-step gap in ranks 80-120, against the median step over 1-250:');
  for (const { k, r } of runs) {
    let best = { at: null, gap: -1 };
    for (let i = 80; i < Math.min(120, r.rows.length); i += 1) {
      const g = r.rows[i - 1].P - r.rows[i].P;
      if (g > best.gap) best = { at: i, gap: g };
    }
    const gaps = [];
    for (let i = 1; i < Math.min(250, r.rows.length); i += 1) gaps.push(r.rows[i - 1].P - r.rows[i].P);
    console.log(`    ${pad(k, 6)}largest ${N(best.gap, 5)} between #${best.at} and #${best.at + 1}   median step ${N(median(gaps), 5)}   ratio ${N(best.gap / median(gaps), 1)}x`);
  }
}

// ===========================================================================
// 9  REACH GUARD
// ===========================================================================

function sectionGuard() {
  console.log('== 9  ATHLETIC COMPATIBILITY (REACH) GUARD ==\n');
  console.log('  far above = programme strength - athlete-equivalent strength >= 10');
  console.log('  b8beb2d baseline: at most 1 intrusion inside the first 100, none better placed than #66\n');
  console.log(`  ${pad('fixture', 10)}${pad('profile', 18)}${rpad('equiv', 8)}${rpad('top100', 8)}${rpad('top250', 8)}  intruders (top 250)`);
  let total100 = 0; let total250 = 0; let worst = null;
  for (const k of KEYS) {
    for (const pid of ['UNDECLARED', 'LEVEL_FIRST']) {
      const r = runFixture(k, pid);
      const far = r.rows.filter((x) => Number.isFinite(x.strength) && x.strength - r.eq >= 10);
      const in100 = far.filter((x) => x.rank <= 100);
      const in250 = far.filter((x) => x.rank <= 250);
      total100 += in100.length; total250 += in250.length;
      for (const x of in100) if (!worst || x.rank < worst.rank) worst = { ...x, fixture: k, profile: pid };
      console.log(`  ${pad(k, 10)}${pad(pid, 18)}${rpad(N(r.eq, 1), 8)}${rpad(in100.length, 8)}${rpad(in250.length, 8)}  `
        + (in250.length ? in250.slice(0, 4).map((x) => `${x.name} #${x.rank} (${N(x.strength, 1)}, +${N(x.strength - r.eq, 1)})`).join(', ') : '—'));
    }
  }
  console.log('');
  console.log(`  total far-above intrusions inside the first 100: ${total100}`);
  console.log(`  total far-above inside the first 250:            ${total250}`);
  console.log(`  worst: ${worst ? `${worst.name} #${worst.rank} [${worst.fixture} / ${worst.profile}]` : 'none'}`);
  const failed = total100 > 1 || (worst && worst.rank < 66);
  console.log(failed ? '  REACH GUARD FAILED' : '  reach guard holds');
}

// ===========================================================================
// 10 + 11 + 12 + 13  LAYER AUTHORITY
// ===========================================================================

function sectionAuthority() {
  const runs = KEYS.map((k) => ({ k, r: runFixture(k) }));

  console.log('== 10  LAYER AUTHORITY OVER PURSUIT ==\n');
  console.log(`  ${pad('fixture', 10)}${rpad('corr R x P', 12)}${rpad('corr F x P', 12)}${rpad('corr O x P', 12)}${rpad('sp R x rank', 13)}${rpad('sp F x rank', 13)}${rpad('sp O x rank', 13)}`);
  for (const { k, r } of runs) {
    const R = r.rows.map((x) => x.R); const F = r.rows.map((x) => x.F);
    const O = r.rows.map((x) => x.O); const P = r.rows.map((x) => x.P);
    const rk = r.rows.map((x) => -x.rank);
    console.log(`  ${pad(k, 10)}${rpad(N(pearson(R, P)), 12)}${rpad(N(pearson(F, P)), 12)}${rpad(N(pearson(O, P)), 12)}`
      + `${rpad(N(spearman(R, rk)), 13)}${rpad(N(spearman(F, rk)), 13)}${rpad(N(spearman(O, rk)), 13)}`);
  }
  console.log('');
  console.log('  WITHIN NARROW R BANDS: can F and O still reorder?\n');
  console.log(`  ${pad('fixture', 8)}${pad('R band', 14)}${rpad('n', 6)}${rpad('rankSpread', 12)}${rpad('F range', 16)}${rpad('O range', 16)}${rpad('sp F x rank', 13)}${rpad('sp O x rank', 13)}`);
  for (const { k, r } of runs) {
    for (const [lo, hi] of [[0.3, 0.35], [0.4, 0.45], [0.5, 0.55], [0.6, 0.65]]) {
      const s = r.rows.filter((x) => x.R >= lo && x.R < hi);
      if (s.length < 10) continue;
      const ranks = s.map((x) => x.rank);
      console.log(`  ${pad(k, 8)}${pad(`${lo}-${hi}`, 14)}${rpad(s.length, 6)}${rpad(`${Math.min(...ranks)}-${Math.max(...ranks)}`, 12)}`
        + `${rpad(`${N(Math.min(...s.map((x) => x.F)), 2)}-${N(Math.max(...s.map((x) => x.F)), 2)}`, 16)}`
        + `${rpad(`${N(Math.min(...s.map((x) => x.O)), 2)}-${N(Math.max(...s.map((x) => x.O)), 2)}`, 16)}`
        + `${rpad(N(spearman(s.map((x) => x.F), s.map((x) => -x.rank))), 13)}${rpad(N(spearman(s.map((x) => x.O), s.map((x) => -x.rank))), 13)}`);
    }
  }
  console.log('');

  console.log('== 11  GATE ACTIVITY ==\n');
  console.log(`  ${pad('fixture', 8)}${rpad('R fired', 9)}${rpad('R %', 8)}${rpad('R med', 8)}${rpad('R min', 8)}${rpad('R medLoss', 11)}${rpad('F fired', 9)}${rpad('F %', 8)}${rpad('F med', 8)}${rpad('F min', 8)}${rpad('F medLoss', 11)}`);
  for (const { k, r } of runs) {
    const rf = r.rows.filter((x) => x.gRfired);
    const ff = r.rows.filter((x) => x.gFfired);
    console.log(`  ${pad(k, 8)}${rpad(rf.length, 9)}${rpad(`${(100 * rf.length / r.rows.length).toFixed(0)}%`, 8)}`
      + `${rpad(N(median(r.rows.map((x) => x.gR)), 3), 8)}${rpad(N(Math.min(...r.rows.map((x) => x.gR)), 3), 8)}${rpad(N(median(rf.map((x) => x.gRloss)) ?? 0, 4), 11)}`
      + `${rpad(ff.length, 9)}${rpad(`${(100 * ff.length / r.rows.length).toFixed(0)}%`, 8)}`
      + `${rpad(N(median(r.rows.map((x) => x.gF)), 3), 8)}${rpad(N(Math.min(...r.rows.map((x) => x.gF)), 3), 8)}${rpad(N(median(ff.map((x) => x.gFloss)) ?? 0, 4), 11)}`);
  }
  console.log('');
  console.log('  RANK IMPACT: re-rank with each gate removed, and report how the top 100 changes.\n');
  console.log(`  ${pad('fixture', 8)}${pad('variant', 16)}${rpad('top100 kept', 13)}${rpad('maxRankMove', 13)}${rpad('medStr top100', 15)}${rpad('farAbove top100', 16)}`);
  for (const { k, r } of runs) {
    const base = new Set(r.rows.slice(0, 100).map((x) => x.id));
    const variants = [
      ['gates on', (x) => x.P],
      ['no R gate', (x) => x.base * x.gF],
      ['no F gate', (x) => x.base * x.gR],
      ['no gates', (x) => x.base],
    ];
    for (const [label, score] of variants) {
      const alt = [...r.rows].map((x) => ({ ...x, P2: score(x) })).sort((a, b) => b.P2 - a.P2);
      alt.forEach((x, i) => { x.rank2 = i + 1; });
      const top = alt.slice(0, 100);
      const kept = top.filter((x) => base.has(x.id)).length;
      const move = Math.max(...alt.map((x) => Math.abs(x.rank2 - x.rank)));
      const st = top.map((x) => x.strength).filter(Number.isFinite);
      const far = top.filter((x) => Number.isFinite(x.strength) && x.strength - r.eq >= 10).length;
      console.log(`  ${pad(k, 8)}${pad(label, 16)}${rpad(kept, 13)}${rpad(move, 13)}${rpad(N(median(st), 1), 15)}${rpad(far, 16)}`);
    }
  }
  console.log('');

  console.log('== 12  FINANCIAL AUTHORITY ==\n');
  console.log(`  ${pad('fixture', 8)}${pad('budget band', 16)}${rpad('costBasis coverage', 20)}${rpad('F med', 8)}${rpad('F p10', 8)}${rpad('F<0.5', 8)}${rpad('F<0.3', 8)}${rpad('gateFired', 11)}`);
  for (const { k, r } of runs) {
    const cov = r.rows.filter((x) => x.fCoverage >= 1).length;
    console.log(`  ${pad(k, 8)}${pad(r.record.budget_range, 16)}${rpad(`${cov}/${r.rows.length}`, 20)}`
      + `${rpad(N(median(r.rows.map((x) => x.F)), 3), 8)}${rpad(N(quantiles(r.rows.map((x) => x.F)).p10, 3), 8)}`
      + `${rpad(r.rows.filter((x) => x.F < 0.5).length, 8)}${rpad(r.rows.filter((x) => x.F < 0.3).length, 8)}${rpad(r.rows.filter((x) => x.gFfired).length, 11)}`);
  }
  console.log('');
  console.log('  cost-basis composition (ranked universe):');
  for (const { k, r } of runs) {
    const b = r.rows.reduce((a, x) => { a[x.fBasis.costBasis] = (a[x.fBasis.costBasis] || 0) + 1; return a; }, {});
    const src = r.rows.reduce((a, x) => { a[x.fBasis.contributionSource] = (a[x.fBasis.contributionSource] || 0) + 1; return a; }, {});
    console.log(`    ${pad(k, 4)}${Object.entries(b).sort((x, y) => y[1] - x[1]).map(([kk, v]) => `${kk} ${v}`).join(' · ')}`);
    console.log(`    ${pad('', 4)}contribution source: ${Object.entries(src).map(([kk, v]) => `${kk} ${v}`).join(' · ')}`);
  }
  console.log('');
  console.log('  LARGEST RANK EFFECT ATTRIBUTABLE TO F: re-rank with F held at its universe median.\n');
  console.log(`  ${pad('fixture', 8)}${rpad('top100 kept', 13)}${rpad('maxMove', 10)}${rpad('meanAbsMove', 13)}  largest movers`);
  for (const { k, r } of runs) {
    const med = median(r.rows.map((x) => x.F));
    const base = new Set(r.rows.slice(0, 100).map((x) => x.id));
    const alt = r.rows.map((x) => {
      const b2 = (PURSUIT_WEIGHTS.recruitability * x.R) + (PURSUIT_WEIGHTS.financial * med) + (PURSUIT_WEIGHTS.opportunity * x.O);
      return { ...x, P2: b2 * x.gR * tailGate(med, PURSUIT_GATES.financial) };
    }).sort((a, b) => b.P2 - a.P2);
    alt.forEach((x, i) => { x.rank2 = i + 1; });
    const moves = alt.map((x) => ({ ...x, d: x.rank2 - x.rank }));
    const big = [...moves].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3);
    console.log(`  ${pad(k, 8)}${rpad(alt.slice(0, 100).filter((x) => base.has(x.id)).length, 13)}${rpad(Math.max(...moves.map((x) => Math.abs(x.d))), 10)}`
      + `${rpad(N(moves.reduce((a, x) => a + Math.abs(x.d), 0) / moves.length, 1), 13)}  ${big.map((x) => `${x.name} ${x.rank}->${x.rank2} (F ${N(x.F, 2)})`).join(', ')}`);
  }
  console.log('');
  console.log('  ATHLETIC LEAK CHECK: does any financial basis field carry an athletic quantity?');
  const leakKeys = new Set();
  for (const { r } of runs) for (const x of r.rows.slice(0, 50)) Object.keys(x.fBasis).forEach((kk) => leakKeys.add(kk));
  console.log(`    financial basis keys: ${[...leakKeys].sort().join(', ')}`);
  const suspicious = [...leakKeys].filter((kk) => /rating|ability|percentile|plausib|soccer|strength|recruit/i.test(kk));
  console.log(`    keys matching an athletic word: ${suspicious.length ? suspicious.join(', ') : 'NONE'}`);
  for (const { k, r } of runs) {
    const c = pearson(r.rows.map((x) => x.strength ?? 0), r.rows.map((x) => x.F));
    console.log(`    ${pad(k, 4)}corr(programme strength, F) ${N(c)}  — expected non-zero: stronger programmes cost more, which is a cost fact, not an athletic one`);
  }
  console.log('');

  console.log('== 13  OPPORTUNITY AUTHORITY ==\n');
  /**
   * Both declaration states, because they are different layers in practice.
   * Every Thriv3 record today is UNDECLARED, so that pass describes what
   * production would do; the declared pass describes what the preference
   * components do when an athlete actually answers.
   */
  const oppRuns = [
    ...runs.map(({ k, r }) => ({ k: `${k} UNDECLARED`, r })),
    ...['A', 'C', 'H'].map((k) => ({
      k: `${k} FULLY_DECLARED + major`,
      r: runFixture(k, 'FULLY_DECLARED_LEVEL', { patch: { intended_major: 'Business' } }),
    })),
  ];
  for (const { k, r } of oppRuns) {
    console.log(`  ${k}`);
    const comps = {};
    for (const x of r.rows) {
      for (const [key, c] of Object.entries(x.oBasis.components ?? {})) {
        (comps[key] ??= { vals: [], shares: [], measured: 0 });
        comps[key].vals.push(c.value); comps[key].shares.push(c.share);
        if (c.grade === GRADE.MEASURED) comps[key].measured += 1;
      }
      for (const na of x.oBasis.notApplicable ?? []) (comps[na] ??= { vals: [], shares: [], measured: 0, na: 0 }).na = (comps[na].na ?? 0) + 1;
      for (const m of x.oBasis.missing ?? []) (comps[m.key] ??= { vals: [], shares: [], measured: 0, miss: {} }).miss = { ...(comps[m.key].miss ?? {}), [m.reason]: ((comps[m.key].miss ?? {})[m.reason] ?? 0) + 1 };
    }
    console.log(`    ${pad('component', 24)}${rpad('scored', 8)}${rpad('N/A', 7)}${rpad('missing', 9)}${rpad('medValue', 10)}${rpad('medShare', 10)}${rpad('MEASURED', 10)}  top missing reason`);
    for (const [key, c] of Object.entries(comps)) {
      const missTotal = Object.values(c.miss ?? {}).reduce((a, b) => a + b, 0);
      const topReason = Object.entries(c.miss ?? {}).sort((x, y) => y[1] - x[1])[0];
      console.log(`    ${pad(key, 24)}${rpad(c.vals.length, 8)}${rpad(c.na ?? 0, 7)}${rpad(missTotal, 9)}`
        + `${rpad(c.vals.length ? N(median(c.vals), 3) : '—', 10)}${rpad(c.shares.length ? N(median(c.shares), 3) : '—', 10)}${rpad(c.measured, 10)}  ${topReason ? `${topReason[0]} ${topReason[1]}` : '—'}`);
    }
  }
}

// ===========================================================================
// 14-19  PREFERENCE AND INPUT RESPONSE
// ===========================================================================

function jaccard(a, b) {
  const A = new Set(a); const B = new Set(b);
  const i = [...A].filter((x) => B.has(x)).length;
  return i / (A.size + B.size - i);
}

function compareRuns(base, alt, label) {
  const bm = new Map(base.rows.map((x) => [x.id, x]));
  const moves = alt.rows.filter((x) => bm.has(x.id)).map((x) => ({ ...x, d: x.rank - bm.get(x.id).rank }));
  const moved = moves.filter((m) => m.d !== 0);
  return {
    label,
    top100Jaccard: jaccard(base.rows.slice(0, 100).map((x) => x.id), alt.rows.slice(0, 100).map((x) => x.id)),
    top25Jaccard: jaccard(base.rows.slice(0, 25).map((x) => x.id), alt.rows.slice(0, 25).map((x) => x.id)),
    moved: moved.length, total: moves.length,
    maxMove: moves.length ? Math.max(...moves.map((m) => Math.abs(m.d))) : 0,
    meanAbs: moves.length ? moves.reduce((a, m) => a + Math.abs(m.d), 0) / moves.length : 0,
    medStrTop100: median(alt.rows.slice(0, 100).map((x) => x.strength).filter(Number.isFinite)),
    medOTop100: median(alt.rows.slice(0, 100).map((x) => x.O)),
    medRTop100: median(alt.rows.slice(0, 100).map((x) => x.R)),
    nearLevel: alt.rows.slice(0, 100).filter((x) => Number.isFinite(x.strength) && Math.abs(x.strength - alt.eq) < 3).length,
    farAbove: alt.rows.slice(0, 100).filter((x) => Number.isFinite(x.strength) && x.strength - alt.eq >= 10).length,
    rows: alt.rows,
  };
}

function ladder(title, key, build, probes) {
  console.log(`\n  ${title}  (fixture ${key})`);
  const runs = probes.map((p) => ({ p, r: runFixture(key, null, { profile: build(p) }) }));
  const base = runs[Math.floor(runs.length / 2)].r;
  console.log(`    ${pad('setting', 14)}${rpad('medO', 8)}${rpad('medO@100', 10)}${rpad('medStr@100', 12)}${rpad('nearLevel', 11)}${rpad('farAbove', 10)}${rpad('J@100 vs mid', 13)}${rpad('maxMove', 9)}`);
  for (const { p, r } of runs) {
    const c = compareRuns(base, r, String(p));
    console.log(`    ${pad(String(p), 14)}${rpad(N(median(r.rows.map((x) => x.O)), 3), 8)}${rpad(N(c.medOTop100, 3), 10)}${rpad(N(c.medStrTop100, 1), 12)}`
      + `${rpad(c.nearLevel, 11)}${rpad(c.farAbove, 10)}${rpad(N(c.top100Jaccard, 3), 13)}${rpad(c.maxMove, 9)}`);
  }
  return runs;
}

function sectionResponse() {
  console.log('== 14  PLAYING-OPPORTUNITY PRIORITY RESPONSE ==');
  for (const key of ['A', 'C', 'H']) {
    const runs = ladder('playing_opportunity_priority 1 / 3 / 5, level and academics held at 3', key,
      (p) => ({ competitiveLevelPriority: 3, playingOpportunityPriority: p, academicStrengthPriority: 3 }),
      [1, 3, 5]);
    console.log(`    playing pathway component, top 100:`);
    for (const { p, r } of runs) {
      const pw = r.rows.slice(0, 100).map((x) => x.oBasis.components?.playingPathway).filter(Boolean);
      const comp = r.rows.slice(0, 100).map((x) => x.oBasis.pathway?.competition?.value).filter(Number.isFinite);
      const rot = r.rows.slice(0, 100).map((x) => x.oBasis.pathway?.rotation?.value).filter(Number.isFinite);
      console.log(`      priority ${p}  pathway median ${N(median(pw.map((c) => c.value)), 3)}  weight share ${N(median(pw.map((c) => c.share)), 3)}`
        + `  returningCompetition median ${N(median(comp), 3)}  squadRotation median ${N(median(rot), 3)}`);
    }
  }
  console.log('');

  console.log('== 15  COMPETITIVE-LEVEL PRIORITY RESPONSE ==');
  for (const key of ['A', 'C', 'H']) {
    const runs = ladder('competitive_level_priority 1 / 3 / 5, playing and academics held at 3', key,
      (p) => ({ competitiveLevelPriority: p, playingOpportunityPriority: 3, academicStrengthPriority: 3 }),
      [1, 3, 5]);
    console.log(`    programme-strength distribution in the top 100:`);
    for (const { p, r } of runs) {
      const st = r.rows.slice(0, 100).map((x) => x.strength).filter(Number.isFinite);
      const q = quantiles(st);
      const below = r.rows.slice(0, 100).filter((x) => Number.isFinite(x.strength) && x.strength - r.eq <= -15).length;
      console.log(`      priority ${p}  p10 ${N(q.p10, 1)} median ${N(q.median, 1)} p90 ${N(q.p90, 1)} max ${N(q.max, 1)}  substantially-below in top100 ${below}`);
    }
  }
  console.log('');

  console.log('== 16  ACADEMIC-PRIORITY RESPONSE, AND THE ENABLER PRINCIPLE ==');
  for (const key of ['A', 'C']) {
    const runs = ladder('academic_strength_priority 1 / 3 / 5, both athletic priorities held at 3', key,
      (p) => ({ competitiveLevelPriority: 3, playingOpportunityPriority: 3, academicStrengthPriority: p }),
      [1, 3, 5]);
    console.log(`    institutional academic rating in the top 100:`);
    for (const { p, r } of runs) {
      const ac = r.rows.slice(0, 100).map((x) => x.academic).filter(Number.isFinite);
      console.log(`      priority ${p}  median ${N(median(ac), 2)}  mean ${N(ac.reduce((a, b) => a + b, 0) / ac.length, 2)}  n rated ${ac.length}`);
    }
  }
  console.log('\n  HOLD THE PRIORITY, VARY THE ACHIEVEMENT (fixture C, academic priority UNDECLARED):');
  console.log(`    ${pad('gpa/sat', 14)}${rpad('ranked', 9)}${rpad('medO', 8)}${rpad('medAcad@100', 13)}${rpad('J@100 vs 4.0/1550', 19)}${rpad('maxMove', 9)}`);
  const cBase = runFixture('C', 'UNDECLARED');
  for (const [gpa, sat] of [[4.0, 1550], [3.5, 1250], [2.8, 1000], [null, null]]) {
    const r = runFixture('C', 'UNDECLARED', { patch: { gpa, sat_score: sat } });
    const c = compareRuns(cBase, r, `${gpa}`);
    const ac = r.rows.slice(0, 100).map((x) => x.academic).filter(Number.isFinite);
    console.log(`    ${pad(`${gpa ?? 'NULL'}/${sat ?? 'NULL'}`, 14)}${rpad(r.rows.length, 9)}${rpad(N(median(r.rows.map((x) => x.O)), 3), 8)}`
      + `${rpad(N(median(ac), 2), 13)}${rpad(N(c.top100Jaccard, 3), 19)}${rpad(c.maxMove, 9)}`);
  }
  console.log('');
  console.log('  Now the same variation WITH academic priority 5, to show which input the tilt comes from:');
  const cAcad = runFixture('C', null, { profile: { competitiveLevelPriority: 3, playingOpportunityPriority: 3, academicStrengthPriority: 5 } });
  for (const [gpa, sat] of [[4.0, 1550], [2.8, 1000]]) {
    const r = runFixture('C', null, { patch: { gpa, sat_score: sat }, profile: { competitiveLevelPriority: 3, playingOpportunityPriority: 3, academicStrengthPriority: 5 } });
    const c = compareRuns(cAcad, r, `${gpa}`);
    const ac = r.rows.slice(0, 100).map((x) => x.academic).filter(Number.isFinite);
    console.log(`    ${pad(`${gpa}/${sat}`, 14)}medAcad@100 ${N(median(ac), 2)}  J@100 vs 4.0/1550 ${N(c.top100Jaccard, 3)}  maxMove ${c.maxMove}`);
  }
  console.log('');

  console.log('== 17  MAJOR FIT ==\n');
  const majorProbe = db.prepare("SELECT COUNT(*) n FROM colleges WHERE sport = 'mens-soccer' AND active = 1 AND notable_majors IS NOT NULL AND LENGTH(notable_majors) > 2").get().n;
  console.log(`  programmes with notable_majors evidence (men's): ${majorProbe} of ${contextFor('mens-soccer').colleges.length}`);
  const undeclared = runFixture('A', 'UNDECLARED');
  for (const major of ['Business', 'Engineering', 'Nursing']) {
    const r = runFixture('A', 'UNDECLARED', { patch: { intended_major: major } });
    const c = compareRuns(undeclared, r, major);
    const withMajor = r.rows.filter((x) => x.oBasis.components?.majorFit);
    const na = r.rows.filter((x) => (x.oBasis.notApplicable ?? []).includes('majorFit')).length;
    const missing = r.rows.filter((x) => (x.oBasis.missing ?? []).some((m) => m.key === 'majorFit')).length;
    console.log(`  major "${pad(major, 12)}" scored ${rpad(withMajor.length, 5)}  NOT_APPLICABLE ${rpad(na, 5)}  missing ${rpad(missing, 5)}`
      + `  matched(value 1) ${rpad(withMajor.filter((x) => x.oBasis.components.majorFit.value === 1).length, 5)}  J@100 vs undeclared ${N(c.top100Jaccard, 3)}  maxMove ${c.maxMove}`);
  }
  const naU = undeclared.rows.filter((x) => (x.oBasis.notApplicable ?? []).includes('majorFit')).length;
  console.log(`  undeclared major: majorFit NOT_APPLICABLE on ${naU} of ${undeclared.rows.length} ranked programmes (${(100 * naU / undeclared.rows.length).toFixed(0)}%)`);
  console.log('');

  console.log('== 18  FINANCIAL INPUT RESPONSE ==\n');
  console.log(`  ${pad('contribution', 24)}${rpad('ranked', 8)}${rpad('F med', 8)}${rpad('F p10', 8)}${rpad('F p90', 8)}${rpad('gateFired', 11)}${rpad('J@100 vs $20k', 15)}${rpad('medStr@100', 12)}${rpad('grade', 9)}`);
  const probes = [
    ['STATED $0', { contribution_state: 'STATED', max_annual_contribution_usd: 0, budget_range: null }],
    ['STATED $10,000', { contribution_state: 'STATED', max_annual_contribution_usd: 10000, budget_range: null }],
    ['STATED $20,000', { contribution_state: 'STATED', max_annual_contribution_usd: 20000, budget_range: null }],
    ['STATED $30,000', { contribution_state: 'STATED', max_annual_contribution_usd: 30000, budget_range: null }],
    ['STATED $40,000', { contribution_state: 'STATED', max_annual_contribution_usd: 40000, budget_range: null }],
    ['STATED $50,000', { contribution_state: 'STATED', max_annual_contribution_usd: 50000, budget_range: null }],
    ['STATED $60,000', { contribution_state: 'STATED', max_annual_contribution_usd: 60000, budget_range: null }],
    ['NOT_A_CONSTRAINT', { contribution_state: 'NOT_A_CONSTRAINT', max_annual_contribution_usd: null, budget_range: null }],
    ['NEEDS_CONFIRMATION', { contribution_state: 'NEEDS_CONFIRMATION', max_annual_contribution_usd: null, budget_range: null }],
    ['legacy $40k+/yr', { contribution_state: null, max_annual_contribution_usd: null, budget_range: '$40k+/yr' }],
    ['legacy $5k-$10k/yr', { contribution_state: null, max_annual_contribution_usd: null, budget_range: '$5k-$10k/yr' }],
  ];
  let ref = null;
  const results = [];
  for (const [label, patch] of probes) {
    const r = runFixture('A', 'UNDECLARED', { patch });
    if (label === 'STATED $20,000') ref = r;
    results.push({ label, r });
  }
  for (const { label, r } of results) {
    const c = ref ? compareRuns(ref, r, label) : null;
    const grades = r.rows.length ? [...new Set(r.rows.map((x) => x.fGrade))].join('/') : '—';
    console.log(`  ${pad(label, 24)}${rpad(r.rows.length, 8)}`
      + `${rpad(r.rows.length ? N(median(r.rows.map((x) => x.F)), 3) : '—', 8)}`
      + `${rpad(r.rows.length ? N(quantiles(r.rows.map((x) => x.F)).p10, 3) : '—', 8)}`
      + `${rpad(r.rows.length ? N(quantiles(r.rows.map((x) => x.F)).p90, 3) : '—', 8)}`
      + `${rpad(r.rows.filter((x) => x.gFfired).length, 11)}${rpad(c ? N(c.top100Jaccard, 3) : '—', 15)}`
      + `${rpad(r.rows.length ? N(median(r.rows.slice(0, 100).map((x) => x.strength).filter(Number.isFinite)), 1) : '—', 12)}${rpad(grades, 9)}`);
  }
  console.log('');
  console.log('  Monotonicity check on a single fixed programme set (the 20 most expensive ranked at $20k):');
  const sample = ref.rows.slice().sort((a, b) => (b.fBasis.applicableCostRange[1] ?? 0) - (a.fBasis.applicableCostRange[1] ?? 0)).slice(0, 20).map((x) => x.id);
  for (const { label, r } of results) {
    const m = new Map(r.rows.map((x) => [x.id, x.F]));
    const vals = sample.map((id) => m.get(id)).filter(Number.isFinite);
    console.log(`    ${pad(label, 24)}mean F on that fixed set ${vals.length ? N(vals.reduce((a, b) => a + b, 0) / vals.length, 4) : '—'}`);
  }
  console.log('');

  console.log('== 19  INTERNATIONAL RESPONSE ==\n');
  const intl = runFixture('F', 'UNDECLARED');
  const dom = runFixture('F', 'UNDECLARED', { patch: { nationality: 'USA', origin: 'USA', state: 'NY', city: 'New York' } });
  console.log(`  twin: fixture F (rating 7 forward, $15k-$20k) as England/International against USA/NY.\n`);
  console.log(`  ${pad('', 22)}${rpad('ranked', 9)}${rpad('limited', 9)}${rpad('medR', 8)}${rpad('medF', 8)}${rpad('medO', 8)}${rpad('medP', 8)}${rpad('F MEASURED', 12)}`);
  for (const [label, r] of [['international', intl], ['domestic twin', dom]]) {
    console.log(`  ${pad(label, 22)}${rpad(r.rows.length, 9)}${rpad(r.rep.counts.limitedData, 9)}`
      + `${rpad(N(median(r.rows.map((x) => x.R)), 3), 8)}${rpad(N(median(r.rows.map((x) => x.F)), 3), 8)}`
      + `${rpad(N(median(r.rows.map((x) => x.O)), 3), 8)}${rpad(N(median(r.rows.map((x) => x.P)), 3), 8)}`
      + `${rpad(r.rows.filter((x) => x.fGrade === GRADE.MEASURED).length, 12)}`);
  }
  const arms = (r) => r.rows.reduce((a, x) => { const arm = x.rBasis.market?.arm ?? x.rBasis.marketState; a[arm] = (a[arm] || 0) + 1; return a; }, {});
  console.log(`    market arm, international: ${Object.entries(arms(intl)).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`    market arm, domestic:      ${Object.entries(arms(dom)).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  const costI = intl.rows.reduce((a, x) => { a[x.fBasis.costBasis] = (a[x.fBasis.costBasis] || 0) + 1; return a; }, {});
  const costD = dom.rows.reduce((a, x) => { a[x.fBasis.costBasis] = (a[x.fBasis.costBasis] || 0) + 1; return a; }, {});
  console.log(`    cost basis, international: ${Object.entries(costI).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`    cost basis, domestic:      ${Object.entries(costD).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  const caveat = intl.rows.filter((x) => x.fBasis.internationalCostCaveat).length;
  console.log(`    international cost caveat carried on ${caveat} of ${intl.rows.length} ranked programmes`);
  const im = new Map(intl.rows.map((x) => [x.id, x]));
  const shared = dom.rows.filter((x) => im.has(x.id));
  console.log(`    same programme, R identical on ${shared.filter((x) => Math.abs(x.R - im.get(x.id).R) < 1e-9).length} of ${shared.length}`);
  console.log(`    same programme, O identical on ${shared.filter((x) => Math.abs(x.O - im.get(x.id).O) < 1e-9).length} of ${shared.length}`);
  console.log(`    top100 Jaccard international vs domestic twin: ${N(jaccard(intl.rows.slice(0, 100).map((x) => x.id), dom.rows.slice(0, 100).map((x) => x.id)), 3)}`);
}

// ===========================================================================
// 20  LAYER INDEPENDENCE
// ===========================================================================

function sectionIndependence() {
  console.log('== 20  LAYER AND COMPONENT INDEPENDENCE ==\n');
  /**
   * All three priorities stated at 3, so every preference component that CAN
   * score does. BALANCED leaves academics undeclared, which would report the
   * academic column as a dash and hide the one correlation worth looking for.
   */
  const ALL_DECLARED = { competitiveLevelPriority: 3, playingOpportunityPriority: 3, academicStrengthPriority: 3 };
  for (const key of ['A', 'C', 'H']) {
    const r = runFixture(key, null, { profile: ALL_DECLARED });
    console.log(`  ${key} (all three priorities stated at 3, n = ${r.rows.length})`);
    const get = {
      'R (layer)': (x) => x.R,
      'F (layer)': (x) => x.F,
      'O (layer)': (x) => x.O,
      'A plausibility': (x) => x.rBasis.athleticPlausibility,
      'positional': (x) => x.rBasis.signals?.find((s) => s.key === 'positionalOpportunity')?.value,
      'market': (x) => x.rBasis.signals?.find((s) => s.key === 'recruitingMarket')?.value,
      'playingPathway': (x) => x.oBasis.components?.playingPathway?.value,
      'trajectory': (x) => x.oBasis.components?.programmeTrajectory?.value,
      'athleticOutcome': (x) => x.oBasis.components?.athleticOutcome?.value,
      'academicFit': (x) => x.oBasis.components?.academicStrengthFit?.value,
      'programme strength': (x) => x.strength,
    };
    const names = Object.keys(get);
    console.log(`    ${pad('', 20)}${names.map((n) => rpad(n.slice(0, 7), 8)).join('')}`);
    for (const a of names) {
      const cells = names.map((b) => {
        const pairs = r.rows.map((x) => [get[a](x), get[b](x)]).filter(([u, v]) => Number.isFinite(u) && Number.isFinite(v));
        if (pairs.length < 20) return rpad('—', 8);
        return rpad(N(pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1])), 2), 8);
      }).join('');
      console.log(`    ${pad(a, 20)}${cells}`);
    }
    console.log('');
  }
}

// ===========================================================================
// 21 + 22  EVIDENCE MISSINGNESS AND LIMITED_DATA
// ===========================================================================

function sectionMissing() {
  console.log('== 21  EVIDENCE MISSINGNESS ==\n');
  for (const key of KEYS) {
    const r = runFixture(key);
    const all = [...r.rep.pipeline.ranked, ...r.rep.pipeline.limited];
    console.log(`  ${key}  evaluated ${all.length}`);
    for (const [label, pick] of [['recruitability', (e) => e.recruitability], ['financial', (e) => e.financial], ['opportunity', (e) => e.opportunity]]) {
      const res = all.map(pick);
      const meas = res.filter((x) => isScoreable(x) && x.grade === GRADE.MEASURED).length;
      const part = res.filter((x) => isScoreable(x) && x.grade === GRADE.PARTIAL).length;
      const un = res.filter((x) => !isScoreable(x));
      const reasons = un.reduce((a, x) => { a[x.reason] = (a[x.reason] || 0) + 1; return a; }, {});
      console.log(`    ${pad(label, 16)}MEASURED ${rpad(meas, 6)} PARTIAL ${rpad(part, 6)} UNSCOREABLE ${rpad(un.length, 6)}  ${Object.entries(reasons).sort((x, y) => y[1] - x[1]).map(([k2, v]) => `${k2} ${v}`).join(' · ') || '—'}`);
    }
  }
  console.log('');
  console.log('  NEUTRAL-IMPUTATION CHECK: how often does a layer land on exactly 0.5?\n');
  console.log(`  ${pad('fixture', 8)}${rpad('R = 0.5', 9)}${rpad('F = 0.5', 9)}${rpad('O = 0.5', 9)}${rpad('R distinct', 12)}${rpad('F distinct', 12)}${rpad('O distinct', 12)}`);
  for (const key of KEYS) {
    const r = runFixture(key);
    const exact = (get) => r.rows.filter((x) => Math.abs(get(x) - 0.5) < 1e-9).length;
    const distinct = (get) => new Set(r.rows.map((x) => get(x).toFixed(6))).size;
    console.log(`  ${pad(key, 8)}${rpad(exact((x) => x.R), 9)}${rpad(exact((x) => x.F), 9)}${rpad(exact((x) => x.O), 9)}`
      + `${rpad(distinct((x) => x.R), 12)}${rpad(distinct((x) => x.F), 12)}${rpad(distinct((x) => x.O), 12)}`);
  }
  console.log('');

  console.log('== 22  LIMITED_DATA PROFILE ==\n');
  for (const key of KEYS) {
    const r = runFixture(key);
    const lim = r.rep.pipeline.limited;
    const byDiv = lim.reduce((a, e) => { a[e.division] = (a[e.division] || 0) + 1; return a; }, {});
    const byMissing = lim.reduce((a, e) => { const k2 = e.missingLayers.join('+'); a[k2] = (a[k2] || 0) + 1; return a; }, {});
    const byReason = lim.reduce((a, e) => {
      for (const [layer, reason] of Object.entries(e.layerReasons)) if (reason) { const k2 = `${layer}:${reason}`; a[k2] = (a[k2] || 0) + 1; }
      return a;
    }, {});
    const tot = lim.length || 1;
    console.log(`  ${key}  LIMITED_DATA ${lim.length} of ${r.rep.counts.evaluated} (${(100 * lim.length / r.rep.counts.evaluated).toFixed(1)}%)`);
    console.log(`    by division     ${Object.entries(byDiv).sort((x, y) => y[1] - x[1]).map(([k2, v]) => `${k2} ${v} (${(100 * v / tot).toFixed(0)}%)`).join(' · ')}`);
    console.log(`    missing layers  ${Object.entries(byMissing).sort((x, y) => y[1] - x[1]).map(([k2, v]) => `${k2} ${v}`).join(' · ')}`);
    console.log(`    reasons         ${Object.entries(byReason).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k2, v]) => `${k2} ${v}`).join(' · ')}`);
  }
  console.log('');
  console.log('  FIXABILITY: for the men\'s pool, what is actually absent on each limited programme?\n');
  const r = runFixture('A');
  const lim = r.rep.pipeline.limited;
  const byId = collegesById('mens-soccer');
  const ctx = contextFor('mens-soccer');
  const buckets = { noRoster: 0, noArrivals: 0, noCost: 0, noStrength: 0, noEligibilityRule: 0, other: 0 };
  for (const e of lim) {
    const c = byId.get(e.id);
    if (!Number.isFinite(c?.soccer_score)) buckets.noStrength += 1;
    else if (!ctx.rosterProgrammes.has(e.name)) buckets.noRoster += 1;
    else if (Object.values(e.layerReasons).includes('NO_ELIGIBILITY_RULE')) buckets.noEligibilityRule += 1;
    else if (!Number.isFinite(c?.net_price)) buckets.noCost += 1;
    else if (!ctx.arrivalIndex.has(e.name)) buckets.noArrivals += 1;
    else buckets.other += 1;
  }
  console.log(`    ${Object.entries(buckets).map(([k2, v]) => `${k2} ${v}`).join(' · ')}`);
  const divs = lim.reduce((a, e) => { a[e.division] = (a[e.division] || 0) + 1; return a; }, {});
  const universe = ctx.colleges.reduce((a, c) => { a[c.division] = (a[c.division] || 0) + 1; return a; }, {});
  console.log(`    share of each division that is LIMITED_DATA: ${Object.entries(divs).sort((x, y) => y[1] - x[1]).map(([k2, v]) => `${k2} ${v}/${universe[k2]} (${(100 * v / universe[k2]).toFixed(0)}%)`).join(' · ')}`);
}

// ===========================================================================
// 26  NAMED EXPLANATION SANITY CHECKS
// ===========================================================================

function sectionExplain() {
  console.log('== 26  NAMED EXPLANATION SANITY CHECKS ==\n');
  for (const key of ['A', 'C', 'H']) {
    const r = runFixture(key, 'BALANCED');
    const ranked = r.rep.pipeline.ranked;
    const picks = [
      ['top 10', ranked[4]],
      ['top-100 boundary', ranked[99]],
      ['mid-universe', ranked[Math.floor(ranked.length / 2)]],
      ['tail', ranked[ranked.length - 1]],
      ['LIMITED_DATA', r.rep.pipeline.limited[0]],
    ];
    console.log(`  -- fixture ${key} --`);
    for (const [label, entry] of picks) {
      if (!entry) continue;
      const row = r.rows.find((x) => x.id === entry.id);
      console.log(`\n  [${label}] ${entry.name} (${entry.division})`
        + (row ? `  rank ${row.rank} · R ${N(row.R, 3)} F ${N(row.F, 3)} O ${N(row.O, 3)} P ${N(row.P, 4)} · strength ${N(row.strength, 1)} vs equivalent ${N(r.eq, 1)}` : '  LIMITED_DATA'));
      try {
        const ex = explainProgramme(entry, {
          rank: entry.rank ?? null, outOf: ranked.length,
          poolSize: r.rep.counts.evaluated, poolMedianPriority: median(r.rows.map((x) => x.P)),
        });
        const { lines, gates, checks } = renderExplanation(ex);
        if (ex.standing) console.log(`      standing: priority ${ex.standing.priority} [${ex.standing.absoluteStrength}]${ex.standing.rankAloneIsMisleading ? ' rank-alone-misleading' : ''}`);
        if (ex.layerSummary) console.log(`      layers: ${ex.layerSummary.layers.map((l) => `${l.layer} ${l.value} ${l.band}`).join(' · ')}  strongest ${ex.layerSummary.strongest} weakest ${ex.layerSummary.weakest}`);
        for (const line of lines) console.log(`      - ${line}`);
        for (const g of gates) console.log(`      gate: ${g}`);
        for (const c of checks) console.log(`      check: ${c}`);
      } catch (err) {
        console.log(`      EXPLANATION FAILED: ${err.message}`);
      }
    }
    console.log('');
  }
}

// ===========================================================================
// 27 + 28  HUMAN VALIDATION REPLAY
// ===========================================================================

async function sectionHuman() {
  const fs = await import('node:fs');
  console.log('== 27  HUMAN-VALIDATED SETS A AND C, AGAINST THE CURRENT MODEL ==\n');
  console.log('  HISTORICAL is the pack as reviewed at 227b54f. CURRENT re-ranks the same programmes');
  console.log('  with the model at HEAD and re-runs the SAME agreement function over them.\n');
  const packs = [
    ['pack-A-FULLY_DECLARED_LEVEL', 'A', 'FULLY_DECLARED_LEVEL'],
    ['pack-C-ACADEMIC_FIRST', 'C', 'ACADEMIC_FIRST'],
  ];
  for (const [stem, key, profileId] of packs) {
    const packPath = `docs/validation/${stem}-v2.json`;
    const reviewPath = `docs/validation/${stem}-v2.review.json`;
    if (!fs.existsSync(packPath) || !fs.existsSync(reviewPath)) { console.log(`  ${stem}: NOT PRESENT`); continue; }
    const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
    const rows = JSON.parse(fs.readFileSync(reviewPath, 'utf8')).review.rows;

    const r = runFixture(key, profileId);
    const rankOf = new Map(r.rows.map((x) => [x.id, x.rank]));
    const limitedIds = new Set(r.rep.pipeline.limited.map((e) => e.id));

    /**
     * The pack, re-pointed at the current ranking. Nothing else about it
     * changes, so the two agreement numbers differ only by the model.
     */
    const current = {
      ...pack,
      viewB: {
        programmes: pack.viewB.programmes.map((p2) => {
          const rank = rankOf.get(p2.id) ?? null;
          const state = rank !== null ? 'RANKED' : (limitedIds.has(p2.id) ? 'LIMITED_DATA' : 'ABSENT');
          return { ...p2, rank, model: { ...p2.model, rank, rankingState: state } };
        }),
      },
    };

    const hist = agreementFor(pack, rows);
    const now = agreementFor(current, rows);
    const pct = (x) => (x && Number.isFinite(x.rate) ? `${(100 * x.rate).toFixed(0)}% of ${x.n}` : '—');

    console.log(`  ${pack.packId}   reviewed ${hist.reviewed}`);
    console.log(`    ${pad('measure', 40)}${rpad('HISTORICAL', 16)}${rpad('CURRENT', 16)}`);
    const lines = [
      ['top 10 classified PURSUE_STRONGLY', 'top10StrongPursue'],
      ['top 10 in the human pursue set', 'top10Pursue'],
      ['top 25 in the human pursue set', 'top25Agreement'],
      ['top 25 the human rated low / would-not', 'humanLowPriorityInTop25'],
      ['top 100 the human would not pursue', 'humanWouldNotPursueInTop100'],
      ['human pursue the model left outside 100', 'top100Omission'],
    ];
    for (const [label, k2] of lines) console.log(`    ${pad(label, 40)}${rpad(pct(hist[k2]), 16)}${rpad(pct(now[k2]), 16)}`);
    console.log(`    ${pad('LIMITED_DATA read as an absence', 40)}${rpad(pct(hist.limitedData.readAsAbsence !== undefined ? { rate: hist.limitedData.readAsAbsence, n: hist.limitedData.n } : null), 16)}${rpad(pct({ rate: now.limitedData.readAsAbsence, n: now.limitedData.n }), 16)}`);

    const ordinal = (pk) => pk.viewB.programmes
      .map((p2) => ({ review: rows.find((x) => x.programmeId === p2.id), p: p2 }))
      .filter((x) => x.review && x.p.model.rankingState === 'RANKED')
      .map((x) => ({ human: CLASSIFICATION_ORDER[x.review.classification], rank: x.p.rank }))
      .filter((x) => x.human !== undefined && Number.isFinite(x.rank));
    const th = kendallTauB(ordinal(pack));
    const tn = kendallTauB(ordinal(current));
    console.log(`    ${pad('Kendall tau-b (human ordinal vs rank)', 40)}${rpad(th ? `${N(th.tauB, 3)} (n ${ordinal(pack).length})` : '—', 16)}${rpad(tn ? `${N(tn.tauB, 3)} (n ${ordinal(current).length})` : '—', 16)}`);

    const joined = rows.map((row) => ({
      name: row.programmeName, human: row.classification,
      pursue: isPursue(row.classification),
      was: pack.viewB.programmes.find((p2) => p2.id === row.programmeId)?.rank ?? null,
      now: rankOf.get(row.programmeId) ?? null,
      limited: limitedIds.has(row.programmeId),
    }));
    const byClass = joined.reduce((a, j) => { (a[j.human] ??= []).push(j); return a; }, {});
    console.log('');
    console.log(`    ${pad('human category', 22)}${rpad('n', 5)}${rpad('medRank was', 13)}${rpad('medRank now', 13)}${rpad('top100 was', 12)}${rpad('top100 now', 12)}${rpad('top250 now', 12)}${rpad('LIMITED now', 12)}`);
    for (const [cls, js] of Object.entries(byClass).sort((a, b) => (CLASSIFICATION_ORDER[b[0]] ?? 0) - (CLASSIFICATION_ORDER[a[0]] ?? 0))) {
      const w = js.map((j) => j.was).filter(Number.isFinite);
      const n2 = js.map((j) => j.now).filter(Number.isFinite);
      console.log(`    ${pad(cls, 22)}${rpad(js.length, 5)}${rpad(w.length ? median(w) : '—', 13)}${rpad(n2.length ? median(n2) : '—', 13)}`
        + `${rpad(js.filter((j) => Number.isFinite(j.was) && j.was <= 100).length, 12)}${rpad(js.filter((j) => Number.isFinite(j.now) && j.now <= 100).length, 12)}`
        + `${rpad(js.filter((j) => Number.isFinite(j.now) && j.now <= 250).length, 12)}${rpad(js.filter((j) => j.limited).length, 12)}`);
    }
    const moves = joined.filter((j) => Number.isFinite(j.was) && Number.isFinite(j.now));
    console.log(`    rank distance since the review: mean |move| ${N(moves.reduce((a, j) => a + Math.abs(j.now - j.was), 0) / (moves.length || 1), 1)}`
      + `   max ${Math.max(...moves.map((j) => Math.abs(j.now - j.was)))}   unmoved ${moves.filter((j) => j.now === j.was).length}/${moves.length}`);
    const pursued = joined.filter((j) => j.pursue);
    console.log(`    human pursue set (${pursued.length}): ${pursued.map((j) => `${j.name} ${j.was ?? '—'}->${j.limited ? 'LIMITED' : j.now}`).join(', ')}`);
    console.log('');
  }

  console.log('== 28  THE 19 COUNTERFACTUAL PAIRS, REPLAYED ==\n');
  const cfPath = 'docs/validation/counterfactual-review.json';
  if (!fs.existsSync(cfPath)) { console.log('  counterfactual-review.json NOT PRESENT'); return; }
  const cf = JSON.parse(fs.readFileSync(cfPath, 'utf8'));
  const r = runFixture('A', 'FULLY_DECLARED_LEVEL');
  const byName = new Map(r.rows.map((x) => [x.name, x]));
  /**
   * DECISIVE ONLY. A pair the reviewer answered BOTH_ABOVE, NEITHER or a tie
   * states no ordering, so scoring the model against it would invent a human
   * opinion. The historical run counted 13 of the 19 for the same reason.
   */
  const DECISIVE = new Set(['A', 'B']);
  let agree = 0; let judged = 0; let sliceAgree = 0; let sliceJudged = 0;
  const disagreements = [];
  console.log(`  ${pad('pair', 7)}${pad('A', 22)}${pad('B', 22)}${pad('human', 12)}${pad('model', 7)}${rpad('rankA', 8)}${rpad('rankB', 8)}${rpad('dP', 9)}  agree`);
  for (const p2 of cf.pairs) {
    const a = byName.get(p2.A); const b = byName.get(p2.B);
    const modelFirst = (!a || !b) ? null : (a.rank < b.rank ? 'A' : 'B');
    const decisive = DECISIVE.has(p2.firstPursuit) && modelFirst !== null;
    const ok = decisive ? modelFirst === p2.firstPursuit : null;
    if (decisive) { judged += 1; if (ok) agree += 1; else disagreements.push({ ...p2, a, b }); }
    for (const [side, entry] of [['A', a], ['B', b]]) {
      const want = p2[`include${side}`];
      if (!entry || !want || !['YES', 'NO'].includes(want)) continue;
      sliceJudged += 1;
      if ((want === 'YES') === (entry.rank <= 100)) sliceAgree += 1;
    }
    console.log(`  ${pad(p2.pair, 7)}${pad(p2.A, 22)}${pad(p2.B, 22)}${pad(p2.firstPursuit, 12)}${pad(modelFirst ?? '—', 7)}`
      + `${rpad(a?.rank ?? '—', 8)}${rpad(b?.rank ?? '—', 8)}${rpad(a && b ? N(a.P - b.P, 4) : '—', 9)}  ${ok === null ? 'not decisive' : (ok ? 'yes' : 'NO')}`);
  }
  console.log('');
  console.log(`  decisive pairs: ${judged} of ${cf.pairs.length}`);
  console.log(`  human first-choice agreement: ${agree}/${judged} (${(100 * agree / judged).toFixed(0)}%)`);
  console.log(`  outreach-slice agreement:     ${sliceAgree}/${sliceJudged} (${(100 * sliceAgree / sliceJudged).toFixed(0)}%)`);
  if (cf.diagnostic) {
    const d = cf.diagnostic;
    console.log(`  HISTORICAL (recorded in the review file): ordering ${d.ordering?.agree}/${d.ordering?.decisive} (${((d.ordering?.rate ?? 0) * 100).toFixed(0)}%) by set ${JSON.stringify(d.ordering?.bySet)}`);
    console.log(`  HISTORICAL inclusion: ${JSON.stringify(d.inclusion).slice(0, 300)}`);
  }
  console.log('');
  console.log('  MATERIAL DISAGREEMENTS (decisive pairs the model orders the other way):');
  for (const d of disagreements) {
    const chose = d.firstPursuit === 'A' ? d.A : d.B;
    const first = d.a.rank < d.b.rank ? d.A : d.B;
    console.log(`    ${pad(d.pair, 6)}human chose ${pad(chose, 22)} model puts ${pad(first, 22)} first`);
    console.log(`          ${pad(d.A, 24)}#${rpad(d.a.rank, 4)} R ${N(d.a.R, 2)} F ${N(d.a.F, 2)} O ${N(d.a.O, 2)} P ${N(d.a.P, 3)} strength ${N(d.a.strength, 1)}`);
    console.log(`          ${pad(d.B, 24)}#${rpad(d.b.rank, 4)} R ${N(d.b.R, 2)} F ${N(d.b.F, 2)} O ${N(d.b.O, 2)} P ${N(d.b.P, 3)} strength ${N(d.b.strength, 1)}`);
    if (d.why) console.log(`          human note: ${d.why}`);
  }
}

// ===========================================================================
// THE PROGRAMME-STRENGTH COMPOUND
// ===========================================================================

/**
 * How much of the ranking is programme strength, and through which layer.
 *
 * `soccer_score` enters the model in exactly one place - the recruitability
 * ceiling - yet all three layers lean the same way, because a weaker programme
 * is easier to be recruited by, cheaper, and shares its minutes more widely.
 * This section measures the compound rather than asserting it.
 */
function sectionCompound() {
  console.log('== THE PROGRAMME-STRENGTH COMPOUND ==\n');
  console.log(`  ${pad('fixture', 8)}${rpad('equiv', 8)}${rpad('corr str x R', 14)}${rpad('corr str x F', 14)}${rpad('corr str x O', 14)}${rpad('corr str x P', 14)}${rpad('medStr@100', 12)}${rpad('gap', 8)}`);
  const runs = KEYS.map((k) => ({ k, r: runFixture(k) }));
  for (const { k, r } of runs) {
    const withStr = r.rows.filter((x) => Number.isFinite(x.strength));
    const st = withStr.map((x) => x.strength);
    const m = median(r.rows.slice(0, 100).map((x) => x.strength).filter(Number.isFinite));
    console.log(`  ${pad(k, 8)}${rpad(N(r.eq, 1), 8)}${rpad(N(pearson(st, withStr.map((x) => x.R)), 3), 14)}`
      + `${rpad(N(pearson(st, withStr.map((x) => x.F)), 3), 14)}${rpad(N(pearson(st, withStr.map((x) => x.O)), 3), 14)}`
      + `${rpad(N(pearson(st, withStr.map((x) => x.P)), 3), 14)}${rpad(N(m, 1), 12)}${rpad(N(m - r.eq, 1), 8)}`);
  }
  console.log('');
  console.log('  ONE LAYER AT A TIME: rank on each layer alone, and report the top 100 it produces.\n');
  console.log(`  ${pad('fixture', 8)}${pad('ranked on', 22)}${rpad('medStr@100', 12)}${rpad('gap to athlete', 16)}${rpad('substantially-below', 21)}${rpad('near level', 12)}`);
  for (const { k, r } of runs) {
    const variants = [
      ['R alone', (x) => x.R], ['F alone', (x) => x.F], ['O alone', (x) => x.O],
      ['base, no gates', (x) => x.base], ['full pursuit', (x) => x.P],
    ];
    for (const [label, score] of variants) {
      const top = [...r.rows].sort((a, b) => score(b) - score(a)).slice(0, 100);
      const st = top.map((x) => x.strength).filter(Number.isFinite);
      console.log(`  ${pad(k, 8)}${pad(label, 22)}${rpad(N(median(st), 1), 12)}${rpad(N(median(st) - r.eq, 1), 16)}`
        + `${rpad(top.filter((x) => Number.isFinite(x.strength) && x.strength - r.eq <= -15).length, 21)}`
        + `${rpad(top.filter((x) => Number.isFinite(x.strength) && Math.abs(x.strength - r.eq) < 3).length, 12)}`);
    }
    console.log('');
  }
  console.log('  THE COUNTERWEIGHT AT FULL STRENGTH: fixture A, competitive level 5, against the athlete.\n');
  for (const pid of [1, 3, 5]) {
    const r = runFixture('A', null, { profile: { competitiveLevelPriority: pid, playingOpportunityPriority: 3, academicStrengthPriority: 3 } });
    const st = r.rows.slice(0, 100).map((x) => x.strength).filter(Number.isFinite);
    console.log(`    level priority ${pid}  medStr@100 ${N(median(st), 1)}  gap ${N(median(st) - r.eq, 1)}`
      + `  substantially-below ${r.rows.slice(0, 100).filter((x) => Number.isFinite(x.strength) && x.strength - r.eq <= -15).length}`
      + `  near level ${r.rows.slice(0, 100).filter((x) => Number.isFinite(x.strength) && Math.abs(x.strength - r.eq) < 3).length}`
      + `  best strength in top100 ${N(Math.max(...st), 1)}`);
  }
  console.log('');
  console.log('  ...and the same three under the production shape, where athleticOutcome cannot score:');
  const prod = runFixture('A', 'UNDECLARED', { patch: { criterion_ranking: JSON.stringify(['athletic', 'roster', 'academic', 'geography', 'affordability', 'programQuality']) } });
  const pst = prod.rows.slice(0, 100).map((x) => x.strength).filter(Number.isFinite);
  console.log(`    production (no priority columns exist)  medStr@100 ${N(median(pst), 1)}  gap ${N(median(pst) - prod.eq, 1)}`
    + `  substantially-below ${prod.rows.slice(0, 100).filter((x) => Number.isFinite(x.strength) && x.strength - prod.eq <= -15).length}`
    + `  near level ${prod.rows.slice(0, 100).filter((x) => Number.isFinite(x.strength) && Math.abs(x.strength - prod.eq) < 3).length}`);
}

// ===========================================================================

async function main() {
  const section = arg('section', 'all');
  const want = (s) => section === 'all' || section.split(',').includes(s);
  if (want('arch')) { sectionArch(); console.log('\n'); }
  if (want('inputs')) { sectionInputs(); console.log('\n'); }
  if (want('programme')) { sectionProgramme(); console.log('\n'); }
  if (want('universe')) { sectionUniverse(); console.log('\n'); }
  if (want('guard')) { sectionGuard(); console.log('\n'); }
  if (want('authority')) { sectionAuthority(); console.log('\n'); }
  if (want('response')) { sectionResponse(); console.log('\n'); }
  if (want('independence')) { sectionIndependence(); console.log('\n'); }
  if (want('missing')) { sectionMissing(); console.log('\n'); }
  if (want('explain')) { sectionExplain(); console.log('\n'); }
  if (want('human')) { await sectionHuman(); console.log('\n'); }
  if (want('compound')) { sectionCompound(); console.log('\n'); }
}

main().catch((e) => { console.error(e); process.exit(1); });
