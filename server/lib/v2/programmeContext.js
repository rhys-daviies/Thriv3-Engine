/**
 * PROGRAMME CONTEXT FOR THE MATCHMAKING UI — A11 §5, §6, §11.
 *
 * ===========================================================================
 * WHAT THIS IS, AND WHAT IT REFUSES TO BE.
 *
 * The persisted run carries a programme's SCORES. It does not carry the
 * programme's cost, its ratings, or the roster facts underneath Athlete
 * Opportunity — those live in `colleges` and `roster_players`, which the run
 * deliberately does not duplicate.
 *
 * So this is a READ over those two tables for a bounded set of programmes,
 * and nothing else. It computes no score, no rank and no pursuit. It calls
 * none of the layers. A caller cannot use it to produce a number the run
 * disagrees with, because it produces no numbers the run also holds.
 *
 * -- WHY IT USES THE ENGINE'S OWN FUNCTIONS ---------------------------------
 *
 * `positionEvidence()` is what Athlete Opportunity reads. Re-deriving
 * "who is graduating" with a second SQL predicate here would produce a number
 * that is allowed to disagree with the score shown next to it — and the first
 * time it did, the screen would be arguing with itself in front of a family.
 * So departures come from `positionEvidence`, and the player NAMES come from
 * the same `readClassYear` + `eligibilityCeiling` pair the index was built
 * with, applied to the same rows.
 *
 * -- A ZERO IS NOT A SILENCE ------------------------------------------------
 *
 * The single most important thing here. "No starting places are opening at
 * centre-back" and "we cannot read this roster" are different facts, and a
 * screen that renders both as `0` is lying about one of them. Every count
 * below is therefore paired with a STATE, and the UI is expected to render
 * the state rather than the bare number. See DEPARTURE_STATE.
 * ===========================================================================
 */
import { readClassYear } from '../../../shared/classYear.js';
import { eligibilityCeiling, eligibilityRuleFor, ELIGIBILITY_MODEL } from '../../../shared/eligibility.js';
import { POSITIONS } from '../../../shared/matching/v2/recruitingRules.js';
import {
  positionEvidence, readPositionState, starterState, STARTER_STATE,
} from './rosterEvidence.js';
import { poolContextFor, SEASON } from './matchmakingService.js';

/**
 * Why a departure count is what it is. Exactly one applies per position.
 *
 * `MEASURED` is the only one a bare number may be printed for. The other three
 * are the ways a zero can be a silence, and they are distinguished because
 * A7.44 and the `rosterEvidence` module both exist to distinguish them.
 */
export const DEPARTURE_STATE = Object.freeze({
  /** We hold the roster, the association has an eligibility rule, and the
   *  position is readable. The counts mean what they say — including zero. */
  MEASURED: 'MEASURED',
  /** No roster on file for this programme at all. Nothing can be said. */
  NO_ROSTER: 'NO_ROSTER',
  /** The association has no eligibility rule on file, so "when does this
   *  player's eligibility end" has no answer and departures cannot be
   *  computed. A statement about Thriv3, not about the programme. */
  NO_ELIGIBILITY_RULE: 'NO_ELIGIBILITY_RULE',
  /** We hold rows at this position but could not read enough of their class
   *  years to count departures honestly. */
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
});

/**
 * How much of a position's cohort has to be readable before its count is
 * reported as MEASURED.
 *
 * Deliberately the same shape of judgement `positionalOpportunity` makes when
 * it decides whether a zero is a measurement or a silence: if more rows at a
 * position are unreadable than readable, the number is not a measurement.
 */
export const READABLE_MAJORITY = 0.5;

function departureStateFor(ev) {
  if (!ev.rosterOnFile) return DEPARTURE_STATE.NO_ROSTER;
  if (!ev.eligibilityRuled) return DEPARTURE_STATE.NO_ELIGIBILITY_RULE;
  if (ev.positionRows === 0) {
    /**
     * No rows AT this position. That is only a measurement if the programme's
     * roster could be placed at positions at all — otherwise the players are
     * there and we simply could not tell where they play.
     */
    const unplaceable = ev.programmePositionUnreadable + ev.programmePositionMissing;
    if (ev.programmeRows > 0 && unplaceable >= ev.programmeRows * READABLE_MAJORITY) {
      return DEPARTURE_STATE.INSUFFICIENT_EVIDENCE;
    }
    return DEPARTURE_STATE.MEASURED;
  }
  const readable = ev.positionRows - ev.unreadable;
  if (readable <= 0 || readable < ev.positionRows * READABLE_MAJORITY) {
    return DEPARTURE_STATE.INSUFFICIENT_EVIDENCE;
  }
  return DEPARTURE_STATE.MEASURED;
}

/**
 * The departing players at one programme, by position, with their names.
 *
 * Same predicate as the index: a player's last season is their eligibility
 * CEILING, derived from the class label under the division's rule — not the
 * class label itself. A Division I senior in 2026 still has a year of the
 * five-year window and is not an opening for 2027; a Division III senior is.
 */
function departingNames(rows, entryYear) {
  const byPosition = new Map(POSITIONS.map((p) => [p, []]));
  for (const row of rows) {
    const { position } = readPositionState(row.position);
    if (!position || !byPosition.has(position)) continue;
    const read = readClassYear(row.class_year_label, { season: row.season });
    /**
     * `eligibilityCeiling` returns an OBJECT — { lastSeason, model,
     * transitional, basis } — not a number. Comparing the object to the entry
     * year is always false, which renders as "no departing players" beside a
     * count that says there are several. Caught by that disagreement.
     */
    const ceiling = eligibilityCeiling({
      klass: read.klass, redshirt: read.redshirt, season: row.season, division: row.division,
    });
    const lastSeason = ceiling?.lastSeason ?? null;
    if (lastSeason === null) continue;
    if (!(lastSeason < entryYear)) continue;
    byPosition.get(position).push({
      name: row.player_name ?? null,
      classYear: row.class_year_label ?? null,
      /**
       * Whether this player held a starting place. `vacatedStarters` is the
       * only SCORED departure term, so a reader comparing the list to the
       * score needs to see which of these counted.
       */
      starter: starterState(row) === STARTER_STATE.STARTER,
      starterKnown: starterState(row) !== STARTER_STATE.UNKNOWN,
    });
  }
  for (const list of byPosition.values()) {
    list.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
  }
  return byPosition;
}

/** `soccer_score` is a 0–100 national scale; V1 has always shown it over 10. */
const programRating = (c) => (
  Number.isFinite(c?.soccer_score) ? Number((c.soccer_score / 10).toFixed(1)) : null
);

/**
 * Academic ratings that are not ratings.
 *
 * `academic_rating_source` records how the number arrived, and two of its
 * values mean "we did not establish this": a placeholder, and an explicit
 * no-match against the College Scorecard. Printing either as "3.1/10" would
 * present our own gap as a measurement of the institution.
 */
const UNESTABLISHED_ACADEMIC_SOURCES = Object.freeze(new Set([
  'placeholder',
  'no College Scorecard match for this institution',
]));

function academicRating(c) {
  if (!Number.isFinite(c?.academic_rating)) return null;
  if (UNESTABLISHED_ACADEMIC_SOURCES.has(String(c?.academic_rating_source ?? ''))) return null;
  return Number(c.academic_rating);
}

/**
 * Context for a bounded set of programmes in one athlete's universe.
 *
 * @param {object}   db
 * @param {object}   opts
 * @param {string}   opts.sport
 * @param {string[]} opts.names     programme names, already bounded by the caller
 * @param {string}   opts.position  the athlete's position, or null
 * @param {number}   opts.entryYear the season departures are counted against
 * @param {boolean}  opts.withNames include departing player names
 */
export function programmeContext(db, {
  sport, names, position = null, entryYear, withNames = false,
}) {
  if (!Number.isFinite(Number(entryYear))) {
    const err = new Error('programmeContext needs the athlete\'s entry year; departures are meaningless without one.');
    err.code = 'ENTRY_YEAR_REQUIRED';
    throw err;
  }
  const year = Number(entryYear);
  const wanted = new Set(names);
  if (wanted.size === 0) return { programmes: [] };

  const { ctx, colleges } = poolContextFor(db, sport);
  const collegeByName = new Map(colleges.map((c) => [c.name, c]));

  /**
   * ONE QUERY FOR EVERY NAME, not one per programme. The names are bounded by
   * the caller (the Top 100 is a hundred), and a per-programme query here is
   * the N+1 this endpoint exists to prevent.
   */
  let rosterByProgramme = new Map();
  if (withNames) {
    const list = [...wanted];
    /**
     * THE ROSTER'S OWN SEASON, NOT THE ENTRY YEAR.
     *
     * The squad on file is this season's; a departure is one of ITS players
     * whose eligibility ends before the athlete would arrive. Querying at the
     * entry year asks for a roster nobody has published yet and returns
     * nothing — which renders as "no departing players" beside a count that
     * says there are some. Caught by exactly that disagreement.
     */
    const rows = db.prepare(`
      SELECT college_name, player_name, position, class_year_label, season, division,
             minutes_played, projected_minutes, games_played, games_started,
             projected_games_started, projected_games_played
        FROM roster_players
       WHERE sport = ? AND season = ? AND college_name IN (${list.map(() => '?').join(',')})
    `).all(sport, String(ctx.rosterSeason), ...list);
    for (const r of rows) {
      if (!rosterByProgramme.has(r.college_name)) rosterByProgramme.set(r.college_name, []);
      rosterByProgramme.get(r.college_name).push(r);
    }
  }

  const programmes = [];
  for (const name of wanted) {
    const college = collegeByName.get(name) ?? null;
    const division = college?.division ?? null;

    const ruleKnown = eligibilityRuleFor({ division, season: year })?.model
      !== ELIGIBILITY_MODEL.UNKNOWN;

    const byPosition = {};
    for (const pos of POSITIONS) {
      const ev = positionEvidence({
        programme: name,
        position: pos,
        sport,
        division,
        entryYear: year,
        rosterIndex: ctx.rosterIndex,
        arrivalIndex: ctx.arrivalIndex,
        arrivalsHorizon: ctx.arrivalsHorizon,
      });
      byPosition[pos] = {
        state: departureStateFor(ev),
        /** All places eligibility vacates. CONTEXT — not the scored term. */
        openings: ev.openings,
        /** The only SCORED departure term: vacated STARTING places. */
        vacatedStarters: ev.vacatedStarters,
        eligibleToRemain: ev.eligibleToRemain,
        positionRows: ev.positionRows,
        unreadable: ev.unreadable,
      };
    }

    const names_ = withNames
      ? departingNames(rosterByProgramme.get(name) ?? [], year)
      : null;

    programmes.push({
      collegeName: name,
      sport,
      division,
      conference: college?.conference ?? null,
      /** V1's long-standing presentation: soccer_score / 10. See the report. */
      programRating: programRating(college),
      academicRating: academicRating(college),
      netPrice: Number.isFinite(college?.net_price) ? college.net_price : null,
      rosterOnFile: ctx.rosterProgrammes.has(name),
      eligibilityRuled: ruleKnown,
      athletePosition: position,
      departures: byPosition,
      departingPlayers: names_
        ? Object.fromEntries([...names_.entries()].map(([k, v]) => [k, v]))
        : null,
    });
  }

  return { entryYear: year, sport, programmes };
}
