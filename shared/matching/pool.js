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
import { canonicalPosition } from '../positions.js';
import { STARTER_MINUTES, PROJECTED_STARTER_MINUTES } from './constants.js';

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
    if (!c) { c = { starters: 0, squad: 0, names: [], starterNames: [] }; e.cohorts.set(key, c); }
    // Starter names kept separately, not derivable afterwards from a flat
    // list: `graduating_starter_names_at_position` was read by the match card
    // and the email template and produced by nothing, so the card showed
    // "names could not be verified from official sources" under a count it
    // had just printed correctly.
    if (isStarter(r)) { c.starters++; c.starterNames.push(r.player_name); } else c.squad++;
    c.names.push(r.player_name);
  }
  return index;
}

/**
 * Starter or squad, from whatever evidence the row has.
 *
 * The old test was `(r.minutes_played || 0) >= STARTER_MINUTES`, which reads an
 * ABSENT figure as zero. That was harmless while every season on file had been
 * played, and wrong the moment the pinned roster season was one in progress:
 * every departure became squad, so a programme losing five starters and two
 * squad scored 2.8 where it used to score 5.8, while a programme losing seven
 * squad players scored 2.8 either way. The signal stopped weighting departures
 * by quality and started counting them.
 *
 * Falling back to last season's minutes restores it. Measured with the
 * backtest's --minutes flag on 2024 -> 2025, where the prior season's real
 * figures make "real" a measurable ceiling, across two sports and two seeds:
 *
 *   mode        r@10            MRR
 *   real        34.1 / 28.8     0.1660 / 0.1392   <- ceiling (men's / women's)
 *   projected   32.4 / 27.9     0.1597 / 0.1367   <- recovers 60-90% of the gap
 *   hidden      29.1 / 26.5     0.1337 / 0.1277   <- worst in all four runs
 *
 * The gap shows up in r@10 and MRR rather than in the median percentile,
 * because the starter split decides the top of the list — which is the part an
 * operator actually reads.
 *
 * A row with neither figure is a newcomer: counted as squad, because that is
 * the conservative reading, but never as a starter on no evidence.
 */
function isStarter(r) {
  if (r.minutes_played != null) return r.minutes_played >= STARTER_MINUTES;
  if (r.projected_minutes != null) return r.projected_minutes >= PROJECTED_STARTER_MINUTES;
  return false;
}

/**
 * Re-exported so existing importers keep working; the number itself lives in
 * constants.js with the other sport facts, because three modules used to
 * declare it and two of them disagreed.
 */
export { STARTER_MINUTES, PROJECTED_STARTER_MINUTES };

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
  const excluded = { inactive: 0, division: 0, conference: 0, academicMinimum: 0, unratedKept: 0 };
  const floor = athlete.academicMinimum;
  const kept = [];
  for (const c of colleges) {
    if (c.active === 0) { excluded.inactive++; continue; }
    if (athlete.divisions?.length && !athlete.divisions.includes(c.division)) { excluded.division++; continue; }
    if (athlete.conferences?.length && !athlete.conferences.includes(c.conference)) { excluded.conference++; continue; }

    // A floor the athlete set deliberately, unlike the old model's — which
    // took an *importance* value as a threshold and silently removed two
    // thirds of the pool. This one defaults to none, and what it drops is
    // counted so the UI can say so.
    if (floor != null && c.academic_rating != null && c.academic_rating < floor) {
      excluded.academicMinimum++;
      continue;
    }
    // An unrated school cannot be judged against a floor. Dropping it would
    // repeat the original defect, where a third of women's programmes went
    // invisible the moment anybody set a minimum — so it survives and is
    // counted, and the card already shows it as unrated.
    if (floor != null && c.academic_rating == null) excluded.unratedKept++;

    kept.push(c);
  }
  return { kept, excluded };
}

/**
 * Who leaves this programme in the athlete's arrival year — at their position,
 * and across the whole squad.
 *
 * Both numbers come from one walk of the cohorts because the card shows them
 * side by side. Until 2026-08-25 only the position figure was ever computed
 * and the squad-wide one was aliased to it downstream, so "Total Graduating"
 * and "At Your Position" rendered the same list on every card — which is
 * plainly wrong: only 1% of programmes genuinely lose their whole graduating
 * cohort from one position.
 *
 * Compared as strings against the cohort key, exactly as the key is built, so
 * a numeric and a string class year cannot silently miss each other.
 *
 * A lower bound, not a census: `buildRosterIndex` never files a row with no
 * `estimated_graduation_year` into a cohort, so a squad with unlabelled rows
 * reports fewer departures than it has. `rowsMissingGradYear` is what says how
 * much is unknown, and the scorer already reads it.
 */
export function departures(roster, classYear, position) {
  const empty = { atPosition: null, total: 0, totalStarters: 0, names: [] };
  if (!roster || classYear == null) return empty;

  const wantYear = String(classYear);
  const wantPosition = String(position || '').toUpperCase();
  let atPosition = null;
  let total = 0;
  let totalStarters = 0;
  const names = [];

  for (const [key, cohort] of roster.cohorts) {
    const sep = key.indexOf('|');
    if (key.slice(0, sep) !== wantYear) continue;
    total += cohort.starters + cohort.squad;
    totalStarters += cohort.starters;
    names.push(...cohort.names);
    if (key.slice(sep + 1) === wantPosition) atPosition = cohort;
  }
  return { atPosition, total, totalStarters, names };
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
  // Two passes, because one coupling depends on a weight. The first resolves
  // what each criterion carries before any coupling; that tells the academic
  // rule whether academics is a stated priority. Safe from circularity
  // because no coupling multiplies academic's own weight — the academic rule
  // only sets a curve shape.
  const base = { ranking: athlete.criterionRanking, overrides: athlete.weightOverrides };
  const preWeights = resolveWeights(base);
  const coupled = resolveCouplings(athlete, { academicWeight: preWeights.academic });
  const w = weights || resolveWeights({ ...base, couplings: coupled.weights });
  const { kept, excluded } = applyEligibility(colleges, athlete);
  const percentiles = qualityPercentiles(kept);

  const results = kept.map((c) => {
    const roster = rosterIndex?.get(c.name);
    const departing = departures(roster, athlete.classYear, athlete.position);
    const cohort = departing.atPosition;

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
      // Presentation and personalisation columns. Carried explicitly because
      // this object is built field by field rather than spread from the row,
      // so anything not named here is silently dropped — which is what had
      // happened: the database knew SMU are the Mustangs, mascot Peruna, ACC
      // champions, and every one of those tokens resolved to nothing. The
      // email read "for the SMU." and each {{#if}} block vanished, because
      // the conditionals gate on exactly these fields.
      nickname: c.nickname,
      nickname_plural: c.nickname_plural,
      mascot: c.mascot,
      conference_champion_2025: c.conference_champion_2025,
      conference_champion_name: c.conference_champion_name,
      postseason_2025_round: c.postseason_2025_round,
      notable_majors: c.notable_majors,
      logo_url: c.logo_url,
      primary_color: c.primary_color,
      secondary_color: c.secondary_color,
      // Read by the scorer above and, until 2026-08-28, dropped here — this
      // object is built field by field, so anything not named is silently
      // lost. The evidence engine needs the win rates to read programme
      // momentum and the admissions/cost columns to reason about fit, and was
      // getting undefined for all of them while the criteria scored happily.
      //
      // Carrying a column is NOT a decision to put it in an email. Net price
      // and admit rate are matching inputs that have no place in a first
      // approach to a coach; shared/evidence/kinds.js decides what is
      // email-eligible, and nothing here should be read as overriding it.
      recent_win_pct: c.recent_win_pct,
      prior_win_pct: c.prior_win_pct,
      sat_avg: c.sat_avg,
      admit_rate: c.admit_rate,
      control: c.control,
      tuition_in_state: c.tuition_in_state,
      tuition_out_state: c.tuition_out_state,
      national_ranking: c.national_ranking,
      graduating_at_position: (cohort?.starters || 0) + (cohort?.squad || 0),
      graduating_starters_at_position: cohort?.starters || 0,
      graduating_names_at_position: cohort?.names || [],
      graduating_starter_names_at_position: cohort?.starterNames || [],
      // Squad-wide, same arrival year, every position — a different number
      // from the three above and not a synonym for them.
      graduating_total: departing.total,
      graduating_starters_total: departing.totalStarters,
      graduating_names_total: departing.names,
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
    // Canonicalised, not upper-cased. The cohort index and
    // EXPECTED_ANNUAL_NEED are keyed on GOALKEEPER/DEFENSE/MIDFIELD/FORWARD,
    // so a profile saying "Defender" would have upper-cased to DEFENDER,
    // matched no cohort, and silently scored every school as though we had no
    // roster data — while looking entirely reasonable on screen.
    position: canonicalPosition(player.position),
    classYear: toNum(player.recruiting_class_year),
    gpa: toNum(player.gpa),
    sat: toNum(player.sat_score),
    act: toNum(player.act_score),
    budgetRange: player.budget_range || null,
    state: player.state || null,
    academicMinimum: toNum(player.academic_minimum),
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
