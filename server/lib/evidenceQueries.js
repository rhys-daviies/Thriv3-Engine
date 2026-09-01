/**
 * The database half of the evidence engine.
 *
 * shared/evidence is pure and takes rows somebody else fetched. This is the
 * somebody, for callers that have a database in hand — the drafting CLI today,
 * a route when the composer wants it.
 *
 * Every read here is one philosophyQueries already does. That is deliberate
 * reuse rather than convenience: the Program Philosophy report and an outreach
 * email must describe the same squad in the same seasons, and the surest way
 * to guarantee that is for both to run the same query. A second, subtly
 * different roster read is how two screens come to disagree about a programme.
 */

import db from '../db/client.js';
import { squadRows, programmeRows, programmeCoachRows } from './philosophyQueries.js';
import { loadProgrammePatterns } from './recruitingPatterns.js';
import { SQUAD_SEASON } from '../../shared/philosophy.js';
import { selectEvidence, MAX_EMAIL_EVIDENCE } from '../../shared/evidence/index.js';
import { buildRosterIndex, departures } from '../../shared/matching/pool.js';
import { canonicalPosition } from '../../shared/positions.js';

const selectCollege = db.prepare('SELECT * FROM colleges WHERE name = ? AND sport = ?');

/**
 * Has the calendar moved past the roster season we are pinned to?
 *
 * A college season runs autumn to autumn, so the 2026 roster describes the
 * squad through roughly mid-2027. Past that the pinned season is last year's
 * and no present-tense claim built on it is safe, however recently the page
 * was scraped. Deliberately generous — this is a backstop against nobody
 * having advanced SQUAD_SEASON, not a precise calendar.
 */
export function seasonIsBehind(now = Date.now()) {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  // A season is stale once the following calendar year is under way past June,
  // by which point the next intake has been signed.
  return year > Number(SQUAD_SEASON) || (year === Number(SQUAD_SEASON) + 1 && d.getUTCMonth() >= 6);
}

/**
 * The departure numbers for one programme, without ranking the whole pool.
 *
 * Built from `buildRosterIndex` and `departures` — the matching engine's own
 * functions, not a second implementation of them. That is the point: an email
 * saying "four defenders are graduating" and a match card saying three would
 * be worse than either being wrong on its own, and the only durable way to
 * prevent it is for both to run the same code over the same rows.
 *
 * This exists so the browser composer does not have to send the numbers to the
 * server. It could — it holds them from the matching run — but then the facts
 * in an email would come from whatever the client posted, and the server would
 * have no way to tell a stale tab from a current one.
 */
export function departureFields(collegeName, sport, athlete) {
  const index = buildRosterIndex(squadRows(collegeName, sport));
  const classYear = athlete?.recruiting_class_year ?? athlete?.graduation_year ?? null;
  const d = departures(index.get(collegeName), classYear, canonicalPosition(athlete?.position));
  const cohort = d.atPosition;
  return {
    roster_season: SQUAD_SEASON,
    graduating_at_position: (cohort?.starters || 0) + (cohort?.squad || 0),
    graduating_starters_at_position: cohort?.starters || 0,
    graduating_names_at_position: cohort?.names || [],
    graduating_starter_names_at_position: cohort?.starterNames || [],
    graduating_total: d.total,
    graduating_starters_total: d.totalStarters,
    graduating_names_total: d.names,
  };
}

/**
 * Everything shared/evidence needs about one programme.
 *
 * `match` is the row this programme got from `rankMatches`, passed in rather
 * than recomputed: ranking the whole pool per programme would be absurd, and
 * the caller ran it once already. Without it the departure evidence is simply
 * absent, which is honest — a caller who did not rank has no departure numbers
 * and should not appear to.
 */
export function programmeInputs(collegeName, sport, { match = null, now = Date.now() } = {}) {
  const college = selectCollege.get(collegeName, sport) ?? null;
  const squad = squadRows(collegeName, sport);
  return {
    college: college ?? { name: collegeName, sport },
    // Freshness inputs. The stamp comes off the rows themselves — every
    // roster_players row carries `updated_date` — so there is no second query
    // and no way for the rows and their age to disagree.
    now,
    // The pinned squad season is not the season being recruited into once the
    // calendar moves past it. A roster read yesterday is still the wrong
    // roster for a present-tense claim if its season has finished, and a date
    // alone cannot show that.
    seasonBehind: seasonIsBehind(now),
    squad,
    // Passed through UNSTAMPED. This used to write `roster_season: SQUAD_SEASON`
    // onto whatever match it was handed, which asserted a season it had not
    // verified — and that is what hid the drafting CLI feeding 2025 departure
    // numbers into evidence labelled 2026. A match now carries its own season
    // or is not trusted; see evidenceFor.
    match,
    history: programmeRows(collegeName, sport),
    coachRows: programmeCoachRows(collegeName, sport),
    /**
     * The recruiting-history patterns behind the arrival evidence.
     *
     * Derived from `recruiting_arrivals`, which is itself derived from the same
     * `roster_players` rows `history` above reads — so an email cannot say a
     * defender arrived from a season the roster evidence has never seen. Null
     * for a programme with no build behind it, which removes the arrival
     * evidence rather than weakening it.
     */
    recruiting: loadProgrammePatterns(sport, collegeName),
    sport,
  };
}

/**
 * The evidence picture for one athlete at one programme.
 *
 * `athlete` is a raw `players` row; normalisation happens inside
 * selectEvidence so every caller gets the same treatment.
 */
export function evidenceFor(athlete, collegeName, {
  sport = null, match = null, maxEmail = MAX_EMAIL_EVIDENCE, prefer = null,
  preferStructure = null,
} = {}) {
  const resolved = sport || athlete.sport || 'mens-soccer';

  /**
   * A supplied match is trusted only when it says which season it describes.
   *
   * `rankMatches` rows carry no season, and the caller's roster index may be
   * any season at all — the drafting CLI ranks on 2025. Trusting such a row
   * built departure evidence out of last season's roster while the rest of the
   * picture described 2026, and named four Evansville defenders who had all
   * left. Freshness could not catch it: the 2026 squad rows were a day old, so
   * the staleness was in the match, not in the data.
   *
   * Anything that does not declare the current season is recomputed here from
   * the current squad. That is the safe default and costs one indexed read.
   */
  const usable = match && match.roster_season === SQUAD_SEASON ? match : null;
  const resolvedMatch = usable ?? departureFields(collegeName, resolved, athlete);
  return selectEvidence(
    athlete,
    programmeInputs(collegeName, resolved, { match: resolvedMatch }),
    { maxEmail, prefer, preferStructure },
  );
}

/**
 * The same, for a whole ranked list.
 *
 * One programme is a handful of indexed reads, so a top-20 run is well under a
 * second and there is nothing to gain from batching. Kept as a helper so the
 * CLI and any future route agree on how a list is built.
 */
export function evidenceForMatches(athlete, matches, {
  sport = null, maxEmail = MAX_EMAIL_EVIDENCE,
} = {}) {
  const resolved = sport || athlete.sport || 'mens-soccer';
  return matches.map((match) => ({
    match,
    evidence: evidenceFor(athlete, match.name, { sport: resolved, match, maxEmail }),
  }));
}
