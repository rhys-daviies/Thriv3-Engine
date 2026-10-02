/**
 * The components of Athlete Opportunity / Fit, in two families.
 *
 * -- THE SPLIT THAT MAKES THE GENERIC-ATHLETE TRAP IMPOSSIBLE ---------------
 *
 * OBJECTIVE VALUE is what is true about the opportunity whether or not the
 * athlete has told us anything: how widely this programme shares the minutes
 * at their position, and which way the programme is going.
 *
 * PREFERENCE FIT is scored only where the athlete has DECLARED something.
 * Where they have not, the component is NOT_APPLICABLE - it leaves the
 * coverage denominator and nothing is assumed. The system never decides on an
 * athlete's behalf that close to home is good, that prestige is good, or that
 * a particular division is better.
 *
 * Playing opportunity sits on the objective side, and that is a judgement
 * worth stating: an athlete recruiting for a place to play is, by the act of
 * recruiting, seeking somewhere to play. What we do NOT know is how much they
 * would trade playing time for a stronger programme - and that is exactly the
 * preference `athleticOutcome` would need and does not have.
 */
import { GRADE, REASON, scoreable, unscoreable, notApplicable, isScoreable } from '../types.js';
import {
  playingShareFor, playingScale, TRAJECTORY_SATURATION, COMPETITIVE_LEVEL_SPAN,
  RETURNING_SQUAD_WEIGHT, RETURNING_UNKNOWN_WEIGHT, COMPETITION_HALF_PRESSURE, COMPETITION_SHARE,
} from '../opportunityRules.js';
import { priorityStrength } from '../athletePreferences.js';
import {
  POSITION_READABLE_SHARE_FLOOR, positionReadableShare, positionEvidenceState,
} from '../positionReadability.js';
import { majorLabelFor, academicIntentState, ACADEMIC_INTENT } from '../../../academicMajors.js';

/**
 * Was this number actually given to us?
 *
 * `Number(null)` is 0 and `Number('')` is 0, and 0 is finite - so a bare
 * Number.isFinite test reads an ABSENT figure as a stated zero. It bit twice
 * in this file within an hour: a missing maximum distance became "will travel
 * at most zero miles" and scored every programme a perfect 1, and a missing
 * prior win rate became a prior of zero, turning any record at all into a
 * spectacular improvement. Every optional number here is read through this.
 */
const stated = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

/**
 * SQUAD ROTATION: how widely this programme has historically shared the
 * minutes at this position.
 *
 * The programme's measured share, placed on the p10-to-p90 range of programmes
 * at the same position in the same sport. A programme at the tenth percentile
 * of sharing scores 0, one at the ninetieth scores 1.
 *
 * A PROGRAMME TRAIT, AND ONLY THAT. It is computed from seasons that ended
 * before this athlete was recruited, it is identical for every athlete, and it
 * knows nothing about who will be on the roster when they arrive. That is why
 * it is half of Playing Pathway and not the whole of it: A7.8 found Saint
 * Mary's, with nine midfielders projected to remain and one leaving, scoring
 * ABOVE a programme with seven, because it had rotated widely three years
 * earlier. `returningCompetition` answers the other half.
 *
 * GOALKEEPERS NEED NO SPECIAL CASE, and that was measured rather than assumed.
 * The distinctive goalkeeping structure - one player taking 86% of the minutes
 * - is already IN the measure: the median goalkeeping share is 0.40 against
 * 0.56-0.65 outfield, so goalkeepers come out lower on the same scale without
 * a rule being written for them. The candidate that WOULD have needed a
 * goalkeeper rule, newcomer minutes share, was rejected for being unstable
 * (split-half r = 0.002 at goalkeeper).
 */
export function squadRotation({ sport, position, division, programme, rosterOnFile }) {
  /**
   * A7.48 D1. `NO_ROSTER_ON_FILE`, not `NO_MINUTES_HISTORY`.
   *
   * This branch means Thriv3 holds no current roster for the PROGRAMME, and
   * the sentence attached to `NO_MINUTES_HISTORY` describes something else
   * entirely - a departing cohort nobody could place as starter or squad,
   * which is `positionalOpportunity`'s refusal and its phrase. One code was
   * carrying both meanings, and because `playingPathway` inherits rotation's
   * reason when both halves refuse, the wrong one reached 2,280 cells: a
   * programme we hold nothing for was explained as one whose leavers we could
   * not classify.
   */
  if (!rosterOnFile) {
    return unscoreable({ reason: REASON.NO_ROSTER_ON_FILE, missing: ['roster'], available: [] });
  }
  const norm = playingShareFor({ sport, division, position, programme });
  const scale = playingScale(sport, position);
  if (!norm || !scale) {
    return unscoreable({ reason: REASON.NO_MINUTES_HISTORY, missing: ['playingShare'], available: [] });
  }
  const span = scale.p90 - scale.p10;
  const value = span <= 0 ? 0.5 : Math.min(1, Math.max(0, (norm.share - scale.p10) / span));
  return scoreable({
    value,
    // A programme's own seasons are a measurement of how it uses a squad. A
    // division or sport rate standing in for it is a proxy.
    grade: norm.level === 'programme' ? GRADE.MEASURED : GRADE.PARTIAL,
    coverage: 1,
    basis: {
      playingShare: norm.share,
      seasons: norm.seasons,
      level: norm.level,
      scaleP10: scale.p10,
      scaleMedian: scale.median,
      scaleP90: scale.p90,
      measure: 'effective players sharing the minutes, as a share of the position group',
    },
  });
}

/**
 * How much weighted competition one position is projected to carry, in
 * STARTING UNITS. Separated from the component so the shape and its constants
 * can be tested apart.
 */
export function returningPressure({ starters = 0, squad = 0, unknown = 0 }, {
  places,
  squadWeight = RETURNING_SQUAD_WEIGHT,
  unknownWeight = RETURNING_UNKNOWN_WEIGHT,
} = {}) {
  const weighted = starters + (squadWeight * squad) + (unknownWeight * unknown);
  return weighted / Math.max(1, Number(places) || 1);
}

/** Pressure to a bounded value. Strictly decreasing, never reaching either end. */
export const competitionFromPressure = (pressure, { halfAt = COMPETITION_HALF_PRESSURE } = {}) =>
  1 / (1 + (Math.max(0, pressure) / halfAt));

/**
 * RETURNING COMPETITION: how crowded this position is projected to be when the
 * athlete arrives.
 *
 * NOT A PROBABILITY, and not an estimate of minutes. It counts the players
 * whose eligibility runs past the entry year, weights them by the role we can
 * place them in, and normalises by the starting places the position normally
 * holds - so three returning goalkeepers and three returning midfielders do
 * not read alike.
 *
 * -- WHY HEADCOUNT CARRIES THE VALUE AND ROLE CARRIES THE CONFIDENCE --------
 *
 * A7.8.1 stood at four past seasons and asked what a class list predicts.
 * Raw returning headcount predicts the players who actually came back at
 * r 0.76-0.81 and next season's position group at r 0.73-0.75. Role adds
 * separately: within position it lifts the prediction of next season's
 * STARTERS from rho 0.06-0.31 to 0.23-0.58.
 *
 * But role coverage collapses with distance. For an entry two years out the
 * median share of returners we can place is ZERO, because the players still
 * eligible then are current freshmen who have not played. That is a timing
 * limit, not a scraping gap - those minutes do not exist yet.
 *
 * So the value is built from every returner and the GRADE carries the doubt.
 * Refusing to score the strongest signal in the inventory because an optional
 * refinement is missing would have left this component silent for most of the
 * pool at the horizons Thriv3 actually recruits for.
 */
/**
 * A7.37. What the three returner states are called, so the vocabulary is in
 * one place and an explanation cannot invent a fourth.
 *
 * The third is the one this component did not have before. A row whose class
 * year could not be read yields no eligibility ceiling, so it entered neither
 * `byLastSeason` nor `starterLastSeason` and simply vanished - and a position
 * group that vanished entirely read as a MEASURED empty one.
 */
export const RETURNER_STATE = Object.freeze({
  KNOWN_RETURNING: 'KNOWN_RETURNING',
  KNOWN_DEPARTING: 'KNOWN_DEPARTING',
  /** Rows with no readable eligibility horizon. NOT the same as unknown ROLE. */
  UNKNOWN_HORIZON: 'UNKNOWN_HORIZON',
  /**
   * A7.44. Rows at this PROGRAMME that reached no position bucket at all.
   *
   * The comment above says an explanation cannot invent a fourth state. This
   * is that fourth state, added on purpose rather than invented: these rows
   * were always there and were counted nowhere, which is the defect A7.44
   * repairs. They are not returners, not departers and not unknown-horizon
   * returners - they are players whose position we could not read, and the
   * whole point is that they must not be silently folded into any of the
   * three groups that ARE about this position.
   */
  UNPLACEABLE_POSITION: 'UNPLACEABLE_POSITION',
});

/**
 * A7.37 F1-b. How much of a position group must be readable before a count of
 * ZERO returners is allowed to stand as a measurement.
 *
 * HEURISTIC, and preregistered with its reason before it was measured: a zero
 * is a claim about the WHOLE group, and one half is the smallest share at which
 * the rows we read cannot be outvoted by the rows we did not. Below it, the
 * unread remainder could by itself hold enough returners to overturn the
 * conclusion, so the claim is not ours to make.
 *
 * IT GOVERNS THE ZERO CLAIM ONLY. A non-zero count is affirmative evidence
 * that competition exists, and refusing it would throw away a real observation
 * because of rows that could only have made it larger.
 */
export const ZERO_CLAIM_READABLE_SHARE = 0.5;

/**
 * A7.37 F2-b. How far past the roster season a MEASURED grade may survive.
 *
 * HEURISTIC, preregistered with its reason. At depth d the entry-year squad
 * contains roughly d x (first-year share) players who have not been recruited
 * yet and are therefore invisible to this roster. `shared/matching/pool.js`
 * records the men's first-year share as 29.5%, so about 30% of the entry-year
 * squad is unobserved at depth 1 and about 59% at depth 2. DEPTH 2 IS WHERE
 * THE MAJORITY OF THE THING BEING ESTIMATED IS NOT IN THE DATA, and a MEASURED
 * grade must not survive that. A7.8.1 found the same boundary from the other
 * side: the median placeable share of returners falls to zero at two years.
 *
 * IT MOVES NO VALUE. Depth changes the grade and nothing else - there is no
 * year penalty anywhere in this file, because a further entry year is not
 * evidence of a worse opportunity.
 */
export const MEASURED_HORIZON_DEPTH = 1;

export function returningCompetition({
  returning = null, position = null, places = null,
  rosterOnFile = false, eligibilityRuled = true,
  /**
   * A7.37 F1. The size of the observed position group and how much of it had
   * no readable eligibility ceiling. Both already existed at the call site and
   * were already consumed by `positionalOpportunity`; only this component was
   * never told.
   */
  positionRows = null, unreadable = 0,
  /**
   * A7.44. PROGRAMME-LEVEL positional doubt - rows at this programme that
   * reached no position bucket at all - and whether the programme has a
   * roster on file independently of whether THIS position does.
   *
   * NOT ADDABLE TO `unreadable`. That counts players placed here whose year
   * we could not read; these are players placed nowhere. A row can be both,
   * and summing the two would count it twice.
   */
  positionUnreadable = 0, positionMissing = 0, programmeRosterOnFile = false,
  /**
   * The programme's whole roster size, carried ONLY so an explanation has a
   * truthful denominator - "23 of 31 listed players" rather than a bare 23.
   * Nothing scores it.
   */
  programmeRows = null,
  /**
   * A7.37 F2. The horizon, so the component can grade its own decay. It could
   * not before: the entry year was applied by the caller before this function
   * saw anything, which is why the decay was invisible from in here.
   */
  entryYear = null, rosterSeason = null, maxLastSeason = null,
  squadWeight, unknownWeight, halfAt,
}) {
  const unplaceableUnreadable = Math.max(0, Number(positionUnreadable) || 0);
  const unplaceableMissing = Math.max(0, Number(positionMissing) || 0);
  const unplaceable = unplaceableUnreadable + unplaceableMissing;

  if (!rosterOnFile) {
    /**
     * A7.44. AN EMPTY BUCKET IS NOT AN EMPTY POSITION.
     *
     * A programme whose roster we hold, whose forwards bucket is empty and
     * which carries players we could not place, has not told us it has no
     * forwards. It has told us we cannot read who plays where. Reporting
     * NO_ROSTER_ON_FILE there is false twice over: the roster is on file, and
     * the sentence sends a reader to acquire data Thriv3 already has.
     *
     * The genuine measured zero - a programme whose roster reads completely
     * and holds nobody at this position - keeps its existing refusal. That is
     * a separate question, it changes rankings, and A7.44 is not the phase to
     * answer it. What A7.44 buys is that the two are now TELLABLE APART by
     * their reason, which they were not before.
     */
    if (programmeRosterOnFile && unplaceable > 0) {
      return unscoreable({
        reason: REASON.NO_READABLE_POSITIONS,
        missing: ['readablePositions'],
        available: ['roster'],
        coverage: 0,
        detail: {
          position,
          positionUnreadable: unplaceableUnreadable,
          positionMissing: unplaceableMissing,
          programmeRows,
          note: 'this programme has a roster on file and nobody could be placed at this position, but it '
            + 'also carries players whose position could not be read at all - so an empty group here is '
            + 'what we failed to read, not what the programme does not have',
        },
      });
    }
    /**
     * A7.48 D2. A ROSTER WE READ AND A POSITION IT DOES NOT FILL.
     *
     * Reporting `NO_ROSTER_ON_FILE` here said Thriv3 holds no roster for a
     * programme whose roster it holds and has read completely - false, and it
     * sends a reader to acquire data that is already present. The state is a
     * measurement: this roster records nobody at this position. A7.44 left it
     * refusing rather than scoring it, deliberately, and A7.48 changes only
     * what it is CALLED.
     */
    if (programmeRosterOnFile) {
      return unscoreable({
        reason: REASON.NO_PLAYERS_AT_POSITION,
        missing: ['positionGroup'],
        available: ['roster'],
        coverage: 0,
        detail: { position, programmeRows, note: 'the roster is on file and was read; it records nobody at this position' },
      });
    }
    return unscoreable({ reason: REASON.NO_ROSTER_ON_FILE, missing: ['roster'], available: [] });
  }
  /**
   * Without an eligibility rule nobody can be placed as returning or
   * departing, so a count of zero would be silence rather than a measurement.
   */
  if (!eligibilityRuled) {
    return unscoreable({ reason: REASON.NO_CLASS_LABELS, missing: ['eligibilityRule'], available: ['roster'] });
  }
  if (!returning || !Number.isFinite(Number(places))) {
    return unscoreable({ reason: REASON.NO_ROSTER_ON_FILE, missing: ['returningDepth'], available: ['roster'] });
  }

  /**
   * A7.37 F2-a. STRUCTURAL SILENCE, and the rule is derived rather than
   * chosen. A returner needs a last season AFTER the entry year. Once the
   * entry year reaches the furthest season any row in this roster could still
   * be eligible for, that is impossible for every programme in the division
   * alike - so a count of zero has been decided by the calendar and measures
   * nothing about anybody. From a 2026 roster the ceiling is 2030 at Division
   * I and II and 2029 at Division III and the NAIA.
   *
   * This is the rule that answers A7.36's worst finding: at a 2030 entry every
   * cell in the men's universe scored the maximum and every one was MEASURED.
   */
  /**
   * READ THROUGH `stated`, NOT `Number.isFinite`. The header of this file
   * records that trap biting twice within an hour; writing this guard as a
   * bare finiteness test made it three, because `Number(null)` is 0 and 0 is
   * finite - so an absent entry year read as "entry year 0", which is past
   * every horizon, and refused the whole universe.
   */
  const horizon = (stated(maxLastSeason) && stated(entryYear))
    ? { entryYear: Number(entryYear), maxLastSeason: Number(maxLastSeason) } : null;
  if (horizon && horizon.entryYear >= horizon.maxLastSeason) {
    return unscoreable({
      reason: REASON.NO_CLASS_LABELS,
      missing: ['eligibilityHorizon'],
      available: ['roster', 'classYears', 'eligibilityRule'],
      coverage: 0,
      detail: {
        position,
        entryYear: horizon.entryYear,
        maxLastSeason: horizon.maxLastSeason,
        note: 'no player on this roster could still be eligible after the entry year, so a count of zero '
          + 'returners is forced by the eligibility window rather than measured from this programme',
      },
    });
  }

  const rows = stated(positionRows) ? Math.max(0, Number(positionRows)) : null;
  const unread = Math.max(0, Number(unreadable) || 0);
  const readable = rows === null ? null : Math.max(0, rows - unread);
  /**
   * How much of the observed group produced an eligibility horizon at all.
   * `null` positionRows means a caller that predates A7.37 and has not been
   * told; it is treated as fully readable so the component keeps its old
   * behaviour rather than refusing on a caller's silence.
   */
  const readableShare = rows === null || rows === 0 ? 1 : readable / rows;

  /**
   * A7.37 F1-a. THE MIRROR OF "A ZERO MUST REST ON SOMETHING".
   *
   * `positionalOpportunity` has carried this guard on the DEPARTING side since
   * A7.7.2, when it measured 307 men's and 341 women's cells scoring a
   * confident zero on a cohort nobody could classify. This component reads the
   * RETURNING side of the very same index and had no equivalent, which is the
   * whole of A7.36's root cause. Saint Joseph's (ME) at forward carries ten
   * observed players, ten of them unreadable, and scored 1.000 MEASURED.
   */
  if (rows !== null && rows > 0 && readable === 0) {
    return unscoreable({
      reason: REASON.NO_CLASS_LABELS,
      missing: ['classYears'],
      available: ['roster', 'eligibilityRule'],
      coverage: 0,
      detail: {
        position,
        positionRows: rows,
        unreadable: unread,
        note: 'no player at this position has a readable eligibility horizon, so nothing is known about '
          + 'who returns - which is not the same as knowing that nobody does',
      },
    });
  }

  /**
   * A7.44. HOW MUCH OF THE PLAUSIBLE POSITION GROUP WE COULD PLACE HERE.
   *
   * Placed AFTER the A7.37 guards on purpose. A cell that already refuses for
   * a class-year reason keeps the class-year reason: A7.44 is not entitled to
   * relabel a refusal it did not cause, and the existing reason is the one
   * that names the data somebody would go and fix.
   *
   * The asymmetry with A7.37 F1-b is in `positionReadability.js` and is the
   * reason this guard is not restricted to a zero count: unplaceable players
   * can only ever ADD competition, so they undermine a LOW returner count -
   * and a low count is exactly what scores as a wide-open position. The
   * optimistic reading is the one that needs the floor here.
   */
  const positionShare = positionReadableShare({ placed: rows, unplaceable });
  if (positionShare < POSITION_READABLE_SHARE_FLOOR) {
    return unscoreable({
      reason: REASON.NO_READABLE_POSITIONS,
      missing: ['readablePositions'],
      available: ['roster', 'classYears', 'eligibilityRule'],
      coverage: positionShare,
      detail: {
        position,
        positionRows: rows,
        positionUnreadable: unplaceableUnreadable,
        positionMissing: unplaceableMissing,
        positionReadableShare: positionShare,
        programmeRows,
        note: 'most of the players who could belong to this position group could not be placed at any '
          + 'position, so the ones we did place are a minority of the group and any count taken from '
          + 'them could be overturned by the players we could not read',
      },
    });
  }

  const starters = Math.max(0, Number(returning.starters) || 0);
  const squad = Math.max(0, Number(returning.squad) || 0);
  const unknown = Math.max(0, Number(returning.unknown) || 0);
  const total = starters + squad + unknown;

  /**
   * A7.37 F1-b. A ZERO CLAIM NEEDS A READABLE MAJORITY.
   *
   * Only the zero. A non-zero count is affirmative evidence that competition
   * exists, and the rows we could not read could only ever have made it
   * larger - refusing it would discard a real observation for being
   * incomplete in the athlete's favour.
   */
  if (total === 0 && readableShare < ZERO_CLAIM_READABLE_SHARE) {
    return unscoreable({
      reason: REASON.NO_CLASS_LABELS,
      missing: ['classYears'],
      available: ['roster', 'eligibilityRule'],
      coverage: readableShare,
      detail: {
        position,
        positionRows: rows,
        unreadable: unread,
        readableShare,
        note: 'no returners were counted, but a minority of this position group had a readable eligibility '
          + 'horizon, so the zero rests on too little to stand as a measurement of the group',
      },
    });
  }

  const pressure = returningPressure({ starters, squad, unknown }, { places, squadWeight, unknownWeight });
  const value = competitionFromPressure(pressure, { halfAt });

  /**
   * TWO INDEPENDENT DOUBTS, AND THEY MULTIPLY.
   *
   * `roleCoverage` is the share of counted returners we could place as starter
   * or squad. `readableShare` is the share of the position group that produced
   * an eligibility horizon at all. The first was here before A7.37 and was
   * doing its job; the second is the one that was missing, and conflating them
   * was how an unreadable group became a measured empty one.
   *
   * THE VALUE IS UNTOUCHED BY BOTH. `coverage.js` rule 1 - value and coverage
   * are never combined - so unreadable players become neither returners nor
   * absentees. Counting them as returners would swap an optimistic bias for a
   * pessimistic one, which is not a repair.
   */
  const roleCoverage = total === 0 ? 1 : (total - unknown) / total;
  /**
   * A7.44. THREE INDEPENDENT DOUBTS NOW, AND THEY STILL MULTIPLY.
   *
   * `positionShare` is the third and it is about a different population from
   * the other two: not how much of this group we could read, but how much of
   * the group is this group at all. Coverage reporting 1.0 while a fifth of
   * the roster sits at no position was the reporting half of the same defect.
   *
   * THE VALUE IS UNTOUCHED BY ALL THREE. An unplaceable player becomes
   * neither a returner nor an absentee here, exactly as an unreadable-horizon
   * player does above.
   */
  const coverage = readableShare * roleCoverage * positionShare;

  /**
   * A7.37 F2-b. Depth degrades authority and never value. A further entry year
   * is not evidence of a worse opportunity; it is evidence that we can see
   * less of the squad the athlete would actually join.
   */
  const depth = (stated(entryYear) && stated(rosterSeason))
    ? Number(entryYear) - Number(rosterSeason) : null;
  const withinMeasuredHorizon = depth === null || depth <= MEASURED_HORIZON_DEPTH;

  return scoreable({
    value,
    /**
     * A7.44 adds the third condition. A count taken from a group we could
     * only partly assemble is a usable estimate and is not a measurement.
     */
    grade: (unknown === 0 && readableShare === 1 && positionShare === 1 && withinMeasuredHorizon)
      ? GRADE.MEASURED : GRADE.PARTIAL,
    coverage,
    basis: {
      position,
      returning: total,
      returningStarters: starters,
      returningSquad: squad,
      returningUnknownRole: unknown,
      typicalStarters: places,
      pressure,
      roleCoverage,
      /** A7.37. The evidence behind the count, so an explanation can say what it does not know. */
      positionRows: rows,
      unreadableHorizon: unread,
      readableShare,
      /**
       * A7.44. The programme-level positional evidence, machine-readable, so
       * an explanation can say which of the three states this is without
       * re-deriving it and without ever printing a raw counter at a reader.
       */
      positionUnreadable: unplaceableUnreadable,
      positionMissing: unplaceableMissing,
      positionReadableShare: positionShare,
      positionEvidence: positionEvidenceState(positionShare),
      programmeRows: programmeRows === null ? null : Math.max(0, Number(programmeRows) || 0),
      entryYear: stated(entryYear) ? Number(entryYear) : null,
      rosterSeason: stated(rosterSeason) ? Number(rosterSeason) : null,
      horizonDepth: depth,
      withinMeasuredHorizon,
      states: {
        [RETURNER_STATE.KNOWN_RETURNING]: total,
        [RETURNER_STATE.UNKNOWN_HORIZON]: unread,
        [RETURNER_STATE.UNPLACEABLE_POSITION]: unplaceable,
      },
      squadWeight: squadWeight ?? RETURNING_SQUAD_WEIGHT,
      unknownWeight: unknownWeight ?? RETURNING_UNKNOWN_WEIGHT,
      halfAt: halfAt ?? COMPETITION_HALF_PRESSURE,
      measure: 'weighted returners against the starting places this position normally holds',
    },
  });
}

/**
 * PLAYING PATHWAY: projected competition, read alongside how this programme
 * has historically used players at this position.
 *
 * Competition leads because it is specific to this athlete's entry year;
 * rotation is context.
 *
 * -- A7.45B. ROTATION ALONE DOES NOT CARRY A PATHWAY ------------------------
 *
 * It used to. When competition refused, the pathway continued from rotation
 * alone at coverage 0.4, and A7.45 measured what that was actually worth:
 *
 *   THE REDUCED COVERAGE NEVER REACHED THE LAYER. `coverage.js` derives a
 *   layer's coverage from component WEIGHTS, not from component coverage, so
 *   a rotation-only pathway entered Athlete Opportunity at its full 0.65
 *   share, with the same value a fully evidenced one would have carried. The
 *   0.4 was reported and discarded, and grade never enters a ranking - so the
 *   whole of the restraint was cosmetic.
 *
 *   ROTATION IS NOT A PROXY FOR COMPETITION. r = +0.174 across the 7,837
 *   cells where both are scoreable: it explains about 3% of competition's
 *   variance. `squadRotation`'s own header says so in words - "it knows
 *   nothing about who will be on the roster when they arrive. That is why it
 *   is half of Playing Pathway and not the whole of it."
 *
 *   LESS EVIDENCE WAS PRODUCING MORE EXTREME CLAIMS. The 403 fallback cells
 *   carried sd 0.223 against 0.136 for blended cells, hitting exactly 0.000
 *   eight times and exactly 1.000 ten times, where the blended measure cannot
 *   reach zero at all. And 42% of them rested on a division or sport average
 *   rather than on this programme's own seasons.
 *
 * ROTATION IS NOT DISCARDED AND IS NOT BAD EVIDENCE. It is a split-half
 * stable measurement of a real programme trait, it is still computed, and it
 * is carried on this refusal so an explanation can say what IS known. It
 * simply does not answer the question the pathway is asked - "how realistic is
 * this athlete's route to minutes at this position when they arrive" - and a
 * rank-bearing score must not be built from an answer to a different question.
 *
 * COMPETITION-ONLY IS UNCHANGED and remains scoreable at coverage 0.6. That
 * asymmetry is deliberate: competition answers the pathway's actual question
 * and rotation does not, so losing rotation costs context while losing
 * competition costs the subject.
 */
/**
 * A7.48 D3. The reasons that belong to ROTATION rather than to competition.
 *
 * WHY THIS IS EXACT, not a heuristic. `playingPathway` refuses by exactly two
 * routes. The both-halves branch inherits ROTATION's reason, and rotation only
 * ever refuses for these two. The A7.45B branch fires only when rotation IS
 * scoreable and inherits COMPETITION's reason, which cannot be either of these
 * - a programme with no roster has no rotation either, so that case is taken
 * by the first branch before the second is reached.
 *
 * So a pathway refusal carrying one of these is a refusal with NO rotation
 * evidence behind it, and any other refusal has rotation evidence that
 * survived. `pathwayRefusal.test.js` pins both directions.
 */
export const ROTATION_OWN_REFUSALS = Object.freeze([REASON.NO_ROSTER_ON_FILE, REASON.NO_MINUTES_HISTORY]);

export function playingPathway({ competition, rotation, competitionShare = COMPETITION_SHARE }) {
  const hasC = isScoreable(competition);
  const hasR = isScoreable(rotation);
  if (!hasC && !hasR) {
    /**
     * ROTATION'S REASON LEADS when both halves refuse. A caller that never
     * supplied a roster index has told us nothing about the programme's
     * roster, so reporting NO_ROSTER_ON_FILE would be a claim we cannot make;
     * the minutes history is the older and broader contract, and its absence
     * is true in every case where both fail.
     */
    return unscoreable({
      reason: rotation?.reason ?? competition?.reason ?? REASON.NO_MINUTES_HISTORY,
      missing: [...new Set([...(rotation?.missing ?? []), ...(competition?.missing ?? [])])],
      available: [],
    });
  }
  /**
   * A7.45B. Competition is the subject of the pathway, so its absence ends the
   * pathway - whatever rotation knows.
   *
   * PLACED AFTER the both-refuse branch on purpose, so the case where neither
   * half survives keeps the reason A7.37 chose for it rather than being
   * relabelled by this one.
   *
   * THE ROTATION EVIDENCE TRAVELS ON THE REFUSAL. A refusal that threw it away
   * would turn "we cannot rank on this" into "we know nothing about this
   * programme", which is false and is the opposite of the failure A7.45 found.
   */
  if (!hasC) {
    return unscoreable({
      reason: competition.reason,
      missing: [...new Set([...(competition.missing ?? []), 'positionalCompetition'])],
      // Rotation IS available. It is not sufficient, which is a different fact.
      available: ['squadRotation'],
      coverage: 0,
      detail: {
        ...(competition.detail ?? {}),
        competitionRefusedBecause: competition.reason,
        rotation: {
          value: rotation.value,
          grade: rotation.grade,
          level: rotation.basis?.level ?? null,
          seasons: rotation.basis?.seasons ?? null,
          playingShare: rotation.basis?.playingShare ?? null,
        },
        note: 'how widely this programme has historically shared minutes at this position IS known, '
          + 'and who will still hold the position at the entry year is not - so there is evidence '
          + 'about the programme and none about the pathway, and the two must not be reported as one',
      },
    });
  }
  const value = (hasC && hasR)
    ? (competitionShare * competition.value) + ((1 - competitionShare) * rotation.value)
    : (hasC ? competition.value : rotation.value);
  const grades = [hasC ? competition.grade : null, hasR ? rotation.grade : null].filter(Boolean);
  /**
   * A7.37 F0. COVERAGE IS THE WEIGHT OF THE HALF WE ACTUALLY HAVE.
   *
   * It used to report `competitionShare` for BOTH single-half cases. That is
   * right for competition-only, which carries 0.6, and wrong for
   * rotation-only, which carries 0.4 - it was reporting the weight of the
   * MISSING half. A7.36 found 52 men's and 72 women's cells in that state and
   * every one of them was rotation-only, so the error only ever overstated.
   * A reporting correction: no weight, value or threshold moves.
   */
  const coverage = (hasC && hasR) ? 1 : (hasC ? competitionShare : 1 - competitionShare);
  return scoreable({
    value,
    /**
     * A7.37. A single half is never a MEASURED pathway, whatever the grade of
     * the half that survived. A programme's rotation habit is a true thing to
     * know and it is not an answer to "how crowded will this position be when
     * the athlete arrives" - so it may carry the value and must not carry the
     * certainty.
     */
    grade: grades.every((g) => g === GRADE.MEASURED) && hasC && hasR ? GRADE.MEASURED : GRADE.PARTIAL,
    coverage,
    basis: {
      competitionShare,
      competition: hasC ? { value: competition.value, grade: competition.grade, ...competition.basis } : null,
      rotation: hasR ? { value: rotation.value, grade: rotation.grade, ...rotation.basis } : null,
      /** Named so an explanation can say which half it is reading. */
      usedBoth: hasC && hasR,
      /**
       * A7.37. Set when the entry-year half is missing, with the reason the
       * component gave, so an explanation can say WHICH thing is unknown
       * instead of implying that few players are returning.
       */
      rotationOnly: hasR && !hasC,
      competitionRefusedBecause: hasC ? null : (competition?.reason ?? null),
      competitionRefusalDetail: hasC ? null : (competition?.detail ?? null),
    },
  });
}

/**
 * Which way the programme is going.
 *
 * The CHANGE in win rate between the two most recent seasons, not its level.
 * That distinction is the whole point: recent win rate correlates with
 * `soccer_score` at 0.35-0.47 and would be programme strength restated, while
 * the change correlates at 0.023 / 0.087 and is genuinely new information.
 *
 * A programme holding steady scores 0.5. That is a MEASURED midpoint of a
 * measured quantity, not a prior standing in for an absent one - a programme
 * we have no win rates for is unscoreable below.
 */
export function programmeTrajectory({ recentWinPct, priorWinPct, saturation = TRAJECTORY_SATURATION }) {
  if (!stated(recentWinPct) || !stated(priorWinPct)) {
    return unscoreable({
      reason: REASON.NO_WIN_RATES,
      missing: [...(stated(recentWinPct) ? [] : ['recentWinPct']), ...(stated(priorWinPct) ? [] : ['priorWinPct'])],
      available: [...(stated(recentWinPct) ? ['recentWinPct'] : []), ...(stated(priorWinPct) ? ['priorWinPct'] : [])],
    });
  }
  const recent = Number(recentWinPct);
  const prior = Number(priorWinPct);
  const change = recent - prior;
  const value = Math.min(1, Math.max(0, 0.5 + (change / (2 * saturation))));
  return scoreable({
    value,
    grade: GRADE.MEASURED,
    coverage: 1,
    basis: { recentWinPct: recent, priorWinPct: prior, change, saturation, direction: change > 0 ? 'improving' : (change < 0 ? 'declining' : 'steady') },
  });
}

/**
 * Does this institution teach what the athlete said they want to study?
 *
 * The ONLY athlete preference Thriv3 currently collects that belongs in this
 * layer. Set membership against the programme's notable majors, using the same
 * matcher the email composer uses, so an athlete is never told one thing and
 * scored another.
 *
 * STRONG ACADEMICS ARE NOT A FIT. A high GPA does not make a selective
 * institution a better opportunity for someone who never said they wanted one;
 * that is V1's academicFit and it is not reproduced here. The academic
 * MINIMUM an athlete sets is a filter and belongs to eligibility.
 */
export function majorFit({ intendedMajor, notableMajors }) {
  const state = academicIntentState(intendedMajor);
  if (state !== ACADEMIC_INTENT.VALID) {
    // Nobody asked, they have not decided, or the answer is not placeable.
    // None of the three is a fit of zero.
    return notApplicable({ intendedMajor: intendedMajor ?? null, academicIntent: state });
  }
  const wanted = majorLabelFor(intendedMajor);
  let offered = notableMajors;
  if (typeof offered === 'string') {
    try { offered = JSON.parse(offered); } catch { offered = null; }
  }
  if (!Array.isArray(offered) || offered.length === 0) {
    // The athlete DID state a preference; this institution has no list to
    // check it against. Same refusal, same coverage, same grade - the only
    // thing that changes is which side is reported as missing.
    return unscoreable({ reason: REASON.NO_PROGRAMME_MAJOR_EVIDENCE, missing: ['notableMajors'], available: ['intendedMajor'] });
  }
  const matched = offered.includes(wanted);
  return scoreable({
    value: matched ? 1 : 0,
    // A named list of families against a matched family. Nothing is inferred.
    grade: GRADE.MEASURED,
    coverage: 1,
    basis: { intendedMajor, majorFamily: wanted, matched, notableMajors: offered },
  });
}

/**
 * Where the athlete wants to be.
 *
 * ALWAYS NOT_APPLICABLE TODAY, and this is the sharpest departure from V1.
 * Thriv3 collects the athlete's home city, state or country; it collects no
 * preference about WHERE THEY WANT TO GO - no preferred states, no regions, no
 * maximum distance, no campus setting. V1 scores distance from home and treats
 * closer as better, which is a preference nobody was asked for.
 *
 * Residency pricing is Financial Viability's and international recruiting
 * history is Coach Recruitability's. Neither is a location preference and
 * neither is read here.
 *
 * The signature takes the preference so that the day it is collected, this
 * becomes a scorer and nothing else moves.
 */
export function locationFit({ preferredStates = null, preferredRegions = null, maxDistanceMiles = null, collegeState = null, distanceMiles = null }) {
  const declared = (Array.isArray(preferredStates) && preferredStates.length > 0)
    || (Array.isArray(preferredRegions) && preferredRegions.length > 0)
    || stated(maxDistanceMiles);
  if (!declared) {
    return notApplicable({ why: 'the athlete has stated no location preference, and a home address is not one' });
  }
  if (Array.isArray(preferredStates) && preferredStates.length > 0) {
    if (!collegeState) return unscoreable({ reason: REASON.NO_LOCATION, missing: ['collegeState'], available: ['preferredStates'] });
    const matched = preferredStates.map((s) => String(s).toUpperCase()).includes(String(collegeState).toUpperCase());
    return scoreable({ value: matched ? 1 : 0, grade: GRADE.MEASURED, coverage: 1, basis: { preferredStates, collegeState, matched } });
  }
  if (stated(maxDistanceMiles)) {
    if (!stated(distanceMiles)) return unscoreable({ reason: REASON.NO_LOCATION, missing: ['distanceMiles'], available: ['maxDistanceMiles'] });
    const within = Number(distanceMiles) <= Number(maxDistanceMiles);
    return scoreable({ value: within ? 1 : 0, grade: GRADE.MEASURED, coverage: 1, basis: { maxDistanceMiles, distanceMiles, within } });
  }
  return unscoreable({ reason: REASON.NO_STATED_PREFERENCE, missing: ['preferredRegions'], available: [] });
}

/**
 * How well this programme's competitive level matches what the athlete SAID
 * they want.
 *
 * -- WHAT CHANGED SINCE A7.4 ----------------------------------------------
 *
 * A7.4 held this NOT_APPLICABLE because the preference did not exist. It now
 * does, as an explicit 1-5 answer, and the component is conditional on it: an
 * athlete nobody asked still gets NOT_APPLICABLE, unchanged.
 *
 * -- WHY THIS IS NOT THE V1 GAUSSIAN --------------------------------------
 *
 * The gap is ONE-SIDED. A programme at or above the athlete's own calibrated
 * level scores 1, and a stronger one never scores less than a weaker one. The
 * Gaussian's defect was that passing a programme's level made you a worse fit;
 * here, an athlete who wants the strongest level they can reach is not
 * penalised for a programme being stronger still. Whether they could get in is
 * Coach Recruitability's ceiling, and it is not duplicated here - this layer is
 * allowed to say "they would love this level" while recruitability says "this
 * is an extreme reach", and Pursuit Priority reconciles the two.
 *
 * -- HOW THE PREFERENCE SHAPES IT -----------------------------------------
 *
 *   gap    = athletePercentile - programmePercentile, floored at 0
 *   value  = 1 - strength(priority) x min(1, gap / span)
 *
 * At priority 5 the value falls from 1 to 0 across a third of the pool below
 * the athlete's level. At priority 1 it is 1 everywhere - which is exactly
 * what "level is not important to me" means, and which reorders nothing.
 *
 * DIVISION IS NEVER READ. A strong Division II programme sits above a weak
 * Division I one on the percentile axis, and that is the axis used.
 */
export function athleticOutcome({
  competitiveLevelPriority = null, athletePercentile = null, programmePercentile = null,
  span = COMPETITIVE_LEVEL_SPAN,
}) {
  const strength = priorityStrength(competitiveLevelPriority);
  if (strength === null) {
    return notApplicable({
      why: 'the athlete has stated no competitive-level priority, and their ability is not a statement of ambition',
    });
  }
  if (!stated(athletePercentile) || !stated(programmePercentile)) {
    return unscoreable({
      reason: REASON.NO_PROGRAMME_LEVEL,
      missing: [...(stated(athletePercentile) ? [] : ['athletePercentile']),
        ...(stated(programmePercentile) ? [] : ['programmePercentile'])],
      available: ['competitiveLevelPriority'],
    });
  }
  // Only BELOW counts. Above the athlete's level is still the level they asked
  // for, and any peak here would be the Gaussian returning.
  const gap = Math.max(0, Number(athletePercentile) - Number(programmePercentile));
  const value = 1 - (strength * Math.min(1, gap / span));
  return scoreable({
    value,
    grade: GRADE.MEASURED,
    coverage: 1,
    basis: {
      competitiveLevelPriority: Number(competitiveLevelPriority),
      priorityStrength: strength,
      athletePercentile: Number(athletePercentile),
      programmePercentile: Number(programmePercentile),
      levelGapBelow: gap,
      span,
      atOrAboveOwnLevel: gap === 0,
    },
  });
}

/**
 * How much this athlete values the academic strength of the institution.
 *
 * -- WHY IT IS A PREFERENCE AND NOT A QUALITY TERM -------------------------
 *
 * A stronger institution is not universally better here. It becomes more
 * attractive because THIS athlete said academic strength matters, and for an
 * athlete who said it does not, it changes nothing. Multiplying a programme
 * percentile by a stated priority is the whole design; scoring academic
 * strength on its own would be the ProgramQuality criterion returning under a
 * new name, which A5.1 deleted for good reason.
 *
 * -- WHY PERCENTILE AND NOT rating / 10 ------------------------------------
 *
 * `academic_rating` is skewed: the men's pool runs p10 1.8, median 4.2, p90
 * 8.1 on a nominal 0-10 scale, so raw/10 would compress four fifths of the
 * pool into the bottom half and make the preference nearly inert where most
 * programmes are. A percentile within the athlete's own sport pool spends the
 * whole range on the programmes that actually exist, and is the same
 * treatment `abilityScale` already gives programme strength.
 *
 * -- WHAT IT CANNOT DO -----------------------------------------------------
 *
 * It lives inside Athlete Opportunity/Fit, which is one of three layers
 * combined AFTER Coach Recruitability has had its say and AFTER the
 * recruitability gate. It reorders realistic options; it cannot make an
 * unrealistic one realistic, and there is no academic override of the gate.
 *
 * It reads ONE input. Not GPA, not SAT, not ACT, not admit rate, not net
 * price, not the intended major - each of those belongs to a different
 * question, and three of them are not modelled at all yet.
 */
export function academicStrengthFit({
  academicStrengthPriority = null, academicPercentile = null,
}) {
  const strength = priorityStrength(academicStrengthPriority);
  if (strength === null) {
    return notApplicable({
      why: 'the athlete has stated no academic-strength priority, and their grades are not a statement of what they want',
    });
  }
  if (!stated(academicPercentile)) {
    /**
     * UNKNOWN, never average. 27 programmes carry a placeholder rating and 4
     * carry their division's modal value; both are inferences rather than
     * measurements, and the caller is expected to pass null for them.
     */
    return unscoreable({
      reason: REASON.NO_ACADEMIC_PROFILE,
      missing: ['academicPercentile'],
      available: ['academicStrengthPriority'],
    });
  }
  const percentile = Number(academicPercentile);
  /**
   * A flat 1.0 at priority 1, tilting toward the percentile as the priority
   * rises. At priority 5 the component IS the percentile, so the strongest
   * institution in the pool is worth a full point more than the weakest -
   * inside this component's own weight, which is what bounds the effect.
   */
  const value = (1 - strength) + (strength * percentile);
  return scoreable({
    value,
    grade: GRADE.MEASURED,
    coverage: 1,
    basis: {
      academicStrengthPriority: Number(academicStrengthPriority),
      priorityStrength: strength,
      academicPercentile: percentile,
      // Flat at priority 1: the component exists and reorders nothing, which
      // is a different statement from not being asked.
      inert: strength === 0,
    },
  });
}
