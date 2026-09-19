/**
 * WHICH ELIGIBILITY RULE GOVERNS A ROSTER ROW, AND WHAT IT IMPLIES.
 *
 * This file holds RULES AS DATA and nothing else. It does not read a class
 * label — `readClassYear` in classYear.js is the one reader of that vocabulary
 * and stays so — and it deliberately imports nothing, because classYear.js
 * imports the offset tables below for its own default and a cycle between the
 * two would be the first thing to break under a bundler.
 *
 * ---------------------------------------------------------------------------
 * THE DISTINCTION THIS FILE EXISTS TO ENFORCE.
 *
 *   ELIGIBILITY CEILING   can this player still be here?
 *   RETENTION             will they?
 *
 * Only the first is modelled here, and only the first is knowable from a
 * roster page. Under the pre-2026 NCAA rules the two collapsed together at the
 * senior year — a fourth-year player had spent four seasons of competition and
 * could not return, so 8.6% of them appearing on the next roster looked like a
 * retention rate when it was a rule. The 2026 age-based model decouples them:
 * a Division I senior now MAY have another season, and whether they take it is
 * a behaviour nobody has observed yet, because 2026-27 is the first season in
 * which the choice exists.
 *
 * So there is no probability anywhere in this file, and nothing here may be
 * read as one. `ELIGIBLE_TO_REMAIN` means the rules permit it. It does not
 * mean they will, it is not a forecast, and a caller that averages it into a
 * departure estimate has reintroduced exactly the error this separation was
 * written to prevent.
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE. Every rule below carries its source and the date it was
 * verified, because these are external facts with effective dates that will
 * move again — the D3 proposal is the live example. A rule with no source is
 * not a rule, which is why UNKNOWN is a first-class model rather than a
 * fallback to whatever the NCAA happens to do.
 */

/** The eligibility models this repository can reason about. */
export const ELIGIBILITY_MODEL = Object.freeze({
  /**
   * Up to five years of eligibility inside a five-year period that starts at
   * initial enrolment, with no separate limit on seasons of competition.
   * Adopted by NCAA Division I in 2026 and by Division II effective 2026-27.
   */
  NCAA_AGE_BASED_5Y: 'NCAA_AGE_BASED_5Y',
  /**
   * Four seasons of competition. NCAA Division III still operates this way,
   * and the NAIA's published rule is four seasons within the first ten
   * semesters of attendance — different clocks, same consequence for the only
   * question this file asks, which is how many further seasons a player of a
   * given class may play.
   */
  FOUR_SEASONS: 'FOUR_SEASONS',
  /** No rule on file for this association. Nothing may be inferred. */
  UNKNOWN: 'UNKNOWN',
});

/**
 * How many FURTHER seasons a player of each class may play, counting the
 * season they are currently listed in as zero.
 *
 * A 2026 sophomore under the five-year model plays 2026, 2027, 2028 and 2029,
 * so their last season is 2026 + 3. The redshirt adjustment is applied by the
 * caller through `ADVANCE_ONE_CLASS`, not here.
 *
 * GRADUATE is 0 under both models. A graduate student is in a final season
 * whichever clock is running, which is why the two tables agree there and
 * nowhere else.
 */
export const SEASONS_REMAINING_AFTER = Object.freeze({
  [ELIGIBILITY_MODEL.NCAA_AGE_BASED_5Y]: Object.freeze({
    FRESHMAN: 4, SOPHOMORE: 3, JUNIOR: 2, SENIOR: 1, GRADUATE: 0,
  }),
  [ELIGIBILITY_MODEL.FOUR_SEASONS]: Object.freeze({
    FRESHMAN: 3, SOPHOMORE: 2, JUNIOR: 1, SENIOR: 0, GRADUATE: 0,
  }),
});

/**
 * Where a redshirt lands: one class up.
 *
 * Under FOUR_SEASONS the redshirt year is not a season of competition but it
 * is one of the ten semesters, so a redshirt junior has a senior's remaining
 * seasons. Under NCAA_AGE_BASED_5Y the clock is calendar time from initial
 * enrolment and runs whether or not the player competed, so the same
 * adjustment holds for a different reason. Both models therefore advance, and
 * this table is shared rather than split.
 */
export const ADVANCE_ONE_CLASS = Object.freeze({
  FRESHMAN: 'SOPHOMORE',
  SOPHOMORE: 'JUNIOR',
  JUNIOR: 'SENIOR',
  SENIOR: 'GRADUATE',
  GRADUATE: 'GRADUATE',
});

/**
 * The rules, by association and division, newest effective season first.
 *
 * `from` is the first SEASON the model applies to, as roster_players.season
 * spells it — a fall sport's 2026 season is academic year 2026-27, which is
 * what makes 2026 the first Division I season under the new model rather than
 * 2027.
 *
 * `transitional` marks a division-season where an athlete already on a roster
 * may elect the previous model or the new one, whichever is more beneficial.
 * The CEILING is unaffected by that choice — the more beneficial model is by
 * definition the one granting more seasons, so the ceiling is the maximum of
 * the two and the five-year table already gives it. What the election does
 * affect is how confident we may be that a ceiling reflects a decision the
 * athlete has actually taken, and `transitional` is what carries that caveat
 * to a reader.
 *
 * VERIFIED 2026-09-19 against the operator's independent check of the
 * governing bodies' published rules. Re-verify before trusting a date.
 */
export const ELIGIBILITY_RULES = Object.freeze([
  {
    division: 'NCAA D1',
    from: 2026,
    model: ELIGIBILITY_MODEL.NCAA_AGE_BASED_5Y,
    transitional: true,
    note: 'Age-based five-year eligibility period adopted 2026. Athletes with '
      + 'eligibility remaining after 2025-26, and first-time 2026-27 enrollees, may be '
      + 'evaluated under the previous or the new model, whichever is more beneficial. '
      + 'First-time enrollees from fall 2027 are on the age-based model outright.',
    source: 'NCAA Division I eligibility legislation, 2026. Verified by operator 2026-09-19.',
  },
  {
    division: 'NCAA D1',
    from: 0,
    model: ELIGIBILITY_MODEL.FOUR_SEASONS,
    transitional: false,
    note: 'Four seasons of competition within five calendar years. The regime every '
      + 'season before 2026 on file was played under.',
    source: 'Pre-2026 NCAA Division I legislation. Verified by operator 2026-09-19.',
  },
  {
    division: 'NCAA D2',
    from: 2026,
    model: ELIGIBILITY_MODEL.NCAA_AGE_BASED_5Y,
    transitional: true,
    note: 'Age-based five-year model adopted effective 2026-27, mirroring Division I.',
    source: 'NCAA Division II eligibility legislation, effective 2026-27. Verified by operator 2026-09-19.',
  },
  {
    division: 'NCAA D2',
    from: 0,
    model: ELIGIBILITY_MODEL.FOUR_SEASONS,
    transitional: false,
    note: 'Pre-2026-27 Division II rule.',
    source: 'Pre-2026 NCAA Division II legislation. Verified by operator 2026-09-19.',
  },
  {
    division: 'NCAA D3',
    from: 0,
    model: ELIGIBILITY_MODEL.FOUR_SEASONS,
    transitional: false,
    // The single most likely rule on this page to change, and the reason every
    // entry carries a verification date. It must NOT be pre-emptively set to
    // the five-year model: a proposal is not legislation, and 10,191 of the
    // 29,000 men's rows on the current roster are Division III.
    note: 'Four seasons of participation. An age-based five-year model is a 2027 '
      + 'Convention PROPOSAL and is NOT adopted as at 2026-09-19. Do not apply the '
      + 'Division I/II change here.',
    source: 'NCAA Division III legislation in force at 2026-09-19. Verified by operator 2026-09-19.',
  },
  {
    division: 'NAIA',
    from: 0,
    model: ELIGIBILITY_MODEL.FOUR_SEASONS,
    transitional: false,
    note: 'Four seasons of competition during the first ten semesters, or the '
      + 'equivalent, of attendance. A separate association: the NCAA change does not '
      + 'reach it and must not be applied by analogy.',
    source: 'NAIA published eligibility standards in force at 2026-09-19. Verified by operator 2026-09-19.',
  },
]);

/**
 * Associations we hold no rule for, listed rather than left to the default so
 * that the absence is a decision on the page.
 *
 * Both carry zero rows on the current roster season, so nothing turns on them
 * today. They are named here to stop a future reader assuming the default
 * covers them, and to make it obvious what has to be researched before either
 * can be scored.
 */
export const UNRULED_DIVISIONS = Object.freeze(['NJCAA', 'USCAA']);

/**
 * The rule in force for a division in a season.
 *
 * An unrecognised division is UNKNOWN, never the NCAA default. Guessing here
 * is how a rule for 562 Division I programmes silently becomes a claim about
 * 228 junior colleges.
 */
export function eligibilityRuleFor({ division, season }) {
  const year = Number(season);
  const match = ELIGIBILITY_RULES.find(
    (r) => r.division === division && (Number.isFinite(year) ? year >= r.from : r.from === 0),
  );
  if (!match) {
    return {
      division: division ?? null,
      model: ELIGIBILITY_MODEL.UNKNOWN,
      transitional: false,
      note: UNRULED_DIVISIONS.includes(division)
        ? 'No eligibility rule has been established for this association.'
        : 'Unrecognised division; no eligibility rule on file.',
      source: null,
    };
  }
  return match;
}

/** The four states a current player can be in, read against an entry year. */
export const AVAILABILITY = Object.freeze({
  /** The rules do not permit another season by the time the athlete arrives. */
  EXPIRED: 'EXPIRED',
  /** Their last permitted season IS the entry year: one season alongside, then gone. */
  FINAL_SEASON: 'FINAL_SEASON',
  /** The rules permit them to still be here. NOT a prediction that they will be. */
  ELIGIBLE_TO_REMAIN: 'ELIGIBLE_TO_REMAIN',
  /** No readable class, or no rule for the association. Neither staying nor leaving. */
  UNREADABLE: 'UNREADABLE',
});

/** Why a state is what it is — separate from the state, because they fail differently. */
export const ELIGIBILITY_BASIS = Object.freeze({
  /** A readable class label and a rule on file. */
  CLASS_AND_RULE: 'CLASS_AND_RULE',
  /** The roster page carried no class we could read. */
  NO_CLASS_LABEL: 'NO_CLASS_LABEL',
  /** The class was readable; we hold no eligibility rule for the association. */
  NO_RULE: 'NO_RULE',
});

/**
 * The last season a player may compete in, from an ALREADY-PARSED class.
 *
 * Takes `klass` and `redshirt` rather than a raw label so that this module
 * never becomes a second reader of the class-year vocabulary. `readClassYear`
 * produces both.
 *
 * @returns {{ lastSeason:(number|null), model:string, transitional:boolean, basis:string }}
 */
export function eligibilityCeiling({ klass, redshirt = false, season, division }) {
  const rule = eligibilityRuleFor({ division, season });
  const year = Number(season);

  if (!klass) {
    return { lastSeason: null, model: rule.model, transitional: rule.transitional, basis: ELIGIBILITY_BASIS.NO_CLASS_LABEL };
  }
  const table = SEASONS_REMAINING_AFTER[rule.model];
  if (!table || !Number.isFinite(year)) {
    return { lastSeason: null, model: rule.model, transitional: rule.transitional, basis: ELIGIBILITY_BASIS.NO_RULE };
  }

  const effective = redshirt ? ADVANCE_ONE_CLASS[klass] : klass;
  const remaining = table[effective];
  if (!Number.isFinite(remaining)) {
    return { lastSeason: null, model: rule.model, transitional: rule.transitional, basis: ELIGIBILITY_BASIS.NO_RULE };
  }
  return {
    lastSeason: year + remaining,
    model: rule.model,
    transitional: rule.transitional,
    basis: ELIGIBILITY_BASIS.CLASS_AND_RULE,
  };
}

/**
 * The season a place opens, which is the season after the last one its holder
 * may play. This is the quantity `players.recruiting_class_year` is compared
 * against, and naming it here keeps the off-by-one in one place.
 */
export function openingSeason({ klass, redshirt = false, season, division }) {
  const c = eligibilityCeiling({ klass, redshirt, season, division });
  return c.lastSeason === null ? null : c.lastSeason + 1;
}

/**
 * How a current player stands relative to an athlete arriving in `entryYear`.
 *
 * ELIGIBLE_TO_REMAIN is a statement about the rules and carries no probability.
 * See the header.
 */
export function availabilityAtEntry({ klass, redshirt = false, season, division, entryYear }) {
  const c = eligibilityCeiling({ klass, redshirt, season, division });
  const entry = Number(entryYear);
  if (c.lastSeason === null || !Number.isFinite(entry)) {
    return { state: AVAILABILITY.UNREADABLE, ...c };
  }
  const state = c.lastSeason < entry ? AVAILABILITY.EXPIRED
    : c.lastSeason === entry ? AVAILABILITY.FINAL_SEASON
      : AVAILABILITY.ELIGIBLE_TO_REMAIN;
  return { state, ...c };
}
