/**
 * Turns database rows into a ranked list of matches.
 *
 * Pure: it takes rows that somebody else fetched, so the React app and the
 * Node backtest harness run *identical* ranking code against the same
 * criteria. A harness that scored differently from the product would tell us
 * nothing about the product.
 */

import { scoreMatch } from './score.js';
import { resolveWeights } from './weights.js';
import { resolveCouplings } from './couplings.js';
import { distanceFromState } from './geo.js';

/**
 * Index roster rows by school so opportunity is a lookup rather than a scan.
 *
 * Also counts how many of each school's rows have no estimated_graduation_year,
 * which is what lets rosterOpportunity tell "nobody is graduating" apart from
 * "we do not know who is graduating". Phase 0 still has 3,118 unlabelled rows.
 */
export function buildRosterIndex(rosterRows) {
  const index = new Map();
  for (const r of rosterRows) {
    let e = index.get(r.college_name);
    if (!e) { e = { rows: 0, missingGradYear: 0, international: 0, byCountry: new Map(), cohorts: new Map() }; index.set(r.college_name, e); }
    e.rows++;

    // `country` is populated exactly when nationality reads International, so
    // its presence is the international flag rather than a separate field to
    // keep in step.
    const country = (r.country || '').trim();
    if (country && country !== 'USA') {
      e.international++;
      e.byCountry.set(country, (e.byCountry.get(country) || 0) + 1);
    }

    if (r.estimated_graduation_year === null || r.estimated_graduation_year === undefined) { e.missingGradYear++; continue; }
    const key = `${r.estimated_graduation_year}|${String(r.position || '').toUpperCase()}`;
    let c = e.cohorts.get(key);
    if (!c) { c = { starters: 0, squad: 0, names: [] }; e.cohorts.set(key, c); }
    if ((r.minutes_played || 0) >= STARTER_MINUTES) c.starters++; else c.squad++;
    c.names.push(r.player_name);
  }
  return index;
}

/** Minutes above which a roster player counts as a starter, not a squad player. */
export const STARTER_MINUTES = 900;

/**
 * Percentile of each programme's soccer_score *within the pool the athlete is
 * actually considering*.
 *
 * Ranked inside the athlete's chosen divisions rather than across all 1,151
 * programmes, so a D3 athlete is not told every option is weak. Ties share the
 * lower rank, so a hundred identically-scored programmes do not fan out into a
 * spurious ordering.
 */
export function qualityPercentiles(colleges) {
  const scored = colleges.filter((c) => c.soccer_score !== null && c.soccer_score !== undefined);
  if (scored.length < 2) return new Map(colleges.map((c) => [c.id, null]));
  const sorted = [...scored].sort((a, b) => a.soccer_score - b.soccer_score);
  const out = new Map(colleges.map((c) => [c.id, null]));
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].soccer_score === sorted[i].soccer_score) j++;
    const pct = sorted.length === 1 ? 1 : i / (sorted.length - 1);
    for (let k = i; k <= j; k++) out.set(sorted[k].id, pct);
    i = j + 1;
  }
  return out;
}

/**
 * Hard filters. Eligibility only — everything else is scored, not excluded.
 *
 * The old model also filtered on a symmetric ability band and on an academic
 * floor taken from the athlete's *importance* slider, which between them
 * removed roughly two thirds of the pool before anything was scored, silently.
 * What is excluded here is returned alongside the survivors so the UI can say
 * so out loud.
 */
export function applyEligibility(colleges, athlete) {
  const excluded = { inactive: 0, division: 0, conference: 0 };
  const kept = [];
  for (const c of colleges) {
    if (c.active === 0) { excluded.inactive++; continue; }
    if (athlete.divisions?.length && !athlete.divisions.includes(c.division)) { excluded.division++; continue; }
    if (athlete.conferences?.length && !athlete.conferences.includes(c.conference)) { excluded.conference++; continue; }
    kept.push(c);
  }
  return { kept, excluded };
}

/**
 * Score and rank every eligible programme.
 *
 * @param {object}   args.athlete      normalised athlete (see normaliseAthlete)
 * @param {Array}    args.colleges     raw college rows for the athlete's sport
 * @param {Map}      args.rosterIndex  from buildRosterIndex
 * @param {object}  [args.weights]     resolved weights; derived from the athlete if absent
 * @param {number}  [args.limit]       how many to return; all of them if absent
 */
export function rankMatches({ athlete, colleges, rosterIndex, weights, limit }) {
  // One stated priority changes how the others score, so this resolves before
  // anything is ranked and applies to every programme identically.
  const coupled = resolveCouplings(athlete);
  const w = weights || resolveWeights({
    academicImportance: athlete.academicImportance,
    ranking: athlete.criterionRanking,
    couplings: coupled.weights,
    overrides: athlete.weightOverrides,
  });
  const { kept, excluded } = applyEligibility(colleges, athlete);
  const percentiles = qualityPercentiles(kept);

  const results = kept.map((c) => {
    const roster = rosterIndex?.get(c.name);
    const cohort = roster && athlete.classYear != null
      ? roster.cohorts.get(`${athlete.classYear}|${String(athlete.position || '').toUpperCase()}`)
      : null;

    const college = {
      soccerScore: c.soccer_score,
      academicRating: c.academic_rating,
      satAvg: c.sat_avg,
      admitRate: c.admit_rate,
      division: c.division,
      conference: c.conference,
      netPrice: c.net_price,
      control: c.control,
      tuitionIn: c.tuition_in_state,
      tuitionOut: c.tuition_out_state,
      state: c.state,
      distanceMiles: distanceFromState(athlete.state, c.latitude, c.longitude),
      origin: athlete.origin,
      athleteCountry: athlete.country,
      internationalRows: roster?.international || 0,
      sameCountryRows: athlete.country ? (roster?.byCountry.get(athlete.country) || 0) : 0,
      qualityPercentile: percentiles.get(c.id),
      recentWinPct: c.recent_win_pct,
      priorWinPct: c.prior_win_pct,
      graduatingStarters: cohort?.starters || 0,
      graduatingSquad: cohort?.squad || 0,
      rosterRows: roster?.rows || 0,
      rowsMissingGradYear: roster?.missingGradYear || 0,
    };

    const scored = scoreMatch({ athlete, college, weights: w, shapes: coupled.shapes });
    return {
      id: c.id,
      name: c.name,
      division: c.division,
      conference: c.conference,
      city: c.city,
      state: c.state,
      soccer_score: c.soccer_score,
      academic_rating: c.academic_rating,
      academic_rating_source: c.academic_rating_source,
      net_price: c.net_price,
      graduating_at_position: (cohort?.starters || 0) + (cohort?.squad || 0),
      graduating_starters_at_position: cohort?.starters || 0,
      graduating_names_at_position: cohort?.names || [],
      international_players: roster?.international || 0,
      players_from_country: athlete.country ? (roster?.byCountry.get(athlete.country) || 0) : 0,
      match_score: scored.score,
      breakdown: scored.breakdown,
      confidence: scored.confidence,
      labels: scored.labels,
    };
  });

  // Ties broken by athletic fit, then by programme level — a stable, explicable
  // order rather than whatever the sort happened to produce. The old model left
  // ties unbroken and produced groups of fifteen identically-scored schools.
  results.sort((a, b) =>
    b.match_score - a.match_score
    || contribution(b, 'athletic') - contribution(a, 'athletic')
    || (b.soccer_score || 0) - (a.soccer_score || 0)
    || a.name.localeCompare(b.name));

  return {
    results: limit ? results.slice(0, limit) : results,
    excluded,
    weights: w,
    poolSize: kept.length,
    // Why this list is shaped the way it is, in the athlete's own terms.
    adjustments: coupled.notes,
    couplingsFired: coupled.fired,
  };
}

function contribution(r, key) {
  return r.breakdown.find((b) => b.key === key)?.contribution || 0;
}

/** Map a `players` row onto the shape the criteria expect. */
export function normaliseAthlete(player) {
  const ability = toNum(player.football_ability);
  return {
    sport: player.sport || 'mens-soccer',
    level: ability === null ? null : ability * 10,
    position: String(player.position || '').toUpperCase(),
    classYear: toNum(player.recruiting_class_year),
    academicImportance: player.academic_importance,
    gpa: toNum(player.gpa),
    sat: toNum(player.sat_score),
    act: toNum(player.act_score),
    budgetRange: player.budget_range || null,
    state: player.state || null,
    // `origin` decides which half of the location criterion applies. Older
    // records predate the field, so infer it: a stated nationality that is not
    // the USA is an international athlete however the row was created.
    origin: player.origin || (player.nationality && player.nationality !== 'USA' ? 'International' : 'USA'),
    country: player.nationality && player.nationality !== 'USA' ? player.nationality : null,
    divisions: parseList(player.preferred_divisions),
    conferences: parseList(player.preferred_conferences),
    weightOverrides: player.match_weights ? parseObject(player.match_weights) : null,
    criterionRanking: player.criterion_ranking ? parseList(player.criterion_ranking) : null,
  };
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseList(v) {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string' || !v) return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
}

function parseObject(v) {
  if (v && typeof v === 'object') return v;
  try { const p = JSON.parse(v); return p && typeof p === 'object' ? p : null; } catch { return null; }
}
