/**
 * Loading recruiting patterns out of the database.
 *
 * The aggregation itself is pure and lives in shared/recruiting/patterns.js.
 * This file is only the part that has to know about SQL: it reads
 * `recruiting_arrivals`, works out which transitions each programme actually
 * has comparable rosters for, and hands both to the pure code.
 *
 * COVERAGE IS DERIVED, NOT STORED. `recruiting_arrivals` holds arrivals, and an
 * arrival cannot describe a transition that produced none. The comparable
 * transitions come from the roster seasons on file — which is the same rule the
 * Phase 2 gate uses, applied to the same table — so a programme whose 2024
 * roster is missing has three transitions here whether or not anybody arrived
 * in the fourth.
 */

import db from '../db/client.js';
import {
  ARRIVAL_TRANSITIONS, ARRIVAL_CONFIDENCE, currentCoachScope,
} from '../../shared/recruiting/arrivals.js';
import { buildProgrammePatterns } from '../../shared/recruiting/patterns.js';
import { trustedRosterPredicate } from '../../shared/roster/seasonTrust.js';
import { materialisationState, StaleMaterialisationError, STALE }
  from './recruitingMaterialisation.js';

/** The stored row, in the shape the pure aggregations expect. */
function toArrival(r) {
  return {
    programme: r.programme,
    sport: r.sport,
    arrivalSeason: String(r.arrival_season),
    priorSeason: String(r.prior_season),
    sourceTransition: r.source_transition,
    rosterRowId: r.roster_row_id,
    playerName: r.player_name,
    nameKey: r.name_key,
    arrivalConfidence: r.arrival_confidence,
    identityMethod: r.identity_method,
    reconciledFrom: r.reconciled_from ? JSON.parse(r.reconciled_from) : [],
    canonicalPosition: r.canonical_position,
    nationalityFlag: r.nationality_flag,
    country: r.country,
    // `region` is deliberately not read from the row. The stored column is a
    // cache of a pure function of country, and patterns.js recomputes it so a
    // taxonomy change takes effect immediately rather than at the next rebuild.
    isInternational: Boolean(r.is_international),
    classLabelRaw: r.class_label_raw,
    entryType: r.entry_type,
    priorProgramme: r.prior_programme,
    priorConfidence: r.prior_confidence,
    priorCandidates: r.prior_candidates ? JSON.parse(r.prior_candidates) : [],
    coach: r.coach,
    coachAttribution: r.coach_attribution,
  };
}

/** Which of the four transitions this programme has rosters at both ends of. */
export function comparableTransitionsFor(seasons = []) {
  const have = new Set([...seasons].map(String));
  return ARRIVAL_TRANSITIONS
    .filter(([from, to]) => have.has(from) && have.has(to))
    .map(([from, to]) => `${from}->${to}`);
}

/** Roster seasons on file, per programme, for one sport. */
export function loadSeasonsBySport(sport) {
  const rows = db.prepare(
    // L7ZI: an excluded programme-season must not count as a season on file,
    // or a transition would be called comparable against data Evidence cannot read.
    `SELECT college_name, season FROM roster_players
      WHERE sport = ? AND ${trustedRosterPredicate('roster_players')}
      GROUP BY college_name, season`,
  ).all(sport);
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.college_name)) out.set(r.college_name, []);
    out.get(r.college_name).push(String(r.season));
  }
  return out;
}

/** Coach seasons, per programme, for one sport. */
export function loadCoachRowsBySport(sport) {
  const rows = db.prepare(
    'SELECT school, season, coach_name, reason FROM coach_seasons WHERE sport = ? ORDER BY season',
  ).all(sport);
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.school)) out.set(r.school, []);
    out.get(r.school).push(r);
  }
  return out;
}

/**
 * L7ZL — refuse to serve a materialisation that no longer describes the roster.
 *
 * RAISED, NOT RETURNED. `loadProgrammePatterns` answers `null` for "this
 * programme has no recruiting history", which is an ordinary and truthful
 * answer. A stale materialisation is not that: it is "we cannot say", and
 * returning null would make a data-integrity failure read as a programme with
 * no arrivals — withholding claims without reporting why.
 *
 * LEGACY_UNVERIFIED passes. That build predates this mechanism and reads
 * continue exactly as they did; the state is visible through
 * `materialisationState`, and it blocks an exclusion at the write boundary,
 * which is where the invariant actually needs holding.
 */
function assertServable(sport) {
  const state = materialisationState(sport);
  if (state.state === STALE) throw new StaleMaterialisationError(state);
  return state;
}

/**
 * Every programme's patterns for one sport.
 *
 * Programmes with rosters and no arrivals are still included, with their real
 * coverage. Dropping them would quietly turn "we looked and found nothing" into
 * "we never looked", which is the distinction the whole phase rests on.
 */
export function loadPatternsForSport(sport) {
  assertServable(sport);
  const arrivalRows = db.prepare(
    'SELECT * FROM recruiting_arrivals WHERE sport = ? AND arrival_confidence = ?',
  ).all(sport, ARRIVAL_CONFIDENCE.DIRECT);

  const byProgramme = new Map();
  for (const r of arrivalRows) {
    if (!byProgramme.has(r.programme)) byProgramme.set(r.programme, []);
    byProgramme.get(r.programme).push(toArrival(r));
  }

  const seasons = loadSeasonsBySport(sport);
  const coaches = loadCoachRowsBySport(sport);

  const out = new Map();
  for (const [programme, programmeSeasons] of seasons) {
    const comparableTransitions = comparableTransitionsFor(programmeSeasons);
    out.set(programme, buildProgrammePatterns(byProgramme.get(programme) ?? [], {
      programme,
      sport,
      comparableTransitions,
      currentCoach: currentCoachScope({
        coachRows: coaches.get(programme) ?? [],
        comparableTransitions,
      }),
    }));
  }
  return out;
}

/** One programme, without building the whole sport. */
export function loadProgrammePatterns(sport, programme) {
  assertServable(sport);
  const arrivalRows = db.prepare(
    'SELECT * FROM recruiting_arrivals WHERE sport = ? AND programme = ? AND arrival_confidence = ?',
  ).all(sport, programme, ARRIVAL_CONFIDENCE.DIRECT);

  const seasonRows = db.prepare(
    `SELECT season FROM roster_players
      WHERE sport = ? AND college_name = ? AND ${trustedRosterPredicate('roster_players')}
      GROUP BY season`,
  ).all(sport, programme);
  if (!seasonRows.length && !arrivalRows.length) return null;

  const comparableTransitions = comparableTransitionsFor(seasonRows.map((r) => r.season));
  const coachRows = db.prepare(
    'SELECT school, season, coach_name, reason FROM coach_seasons WHERE sport = ? AND school = ? ORDER BY season',
  ).all(sport, programme);

  return buildProgrammePatterns(arrivalRows.map(toArrival), {
    programme,
    sport,
    comparableTransitions,
    currentCoach: currentCoachScope({ coachRows, comparableTransitions }),
  });
}
