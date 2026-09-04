/**
 * Operator-facing presentation for the academic and programme-performance
 * evidence.
 *
 * FOUR KINDS THAT DO NOT ANSWER THE SAME QUESTION, and keeping them apart is
 * the entire job. ACADEMIC_FIT says this athlete's stated subject is taught
 * here. The other three say the team won things. Put a heading over all four
 * and the page has invented "fit", a claim no evidence object makes and one
 * that would read as a recommendation.
 *
 * THE SPLIT IS NOT TAKEN FROM decisionClass. Unlike every other section, all
 * four of these are FIT/STATIC, so the class cannot separate them. The honest
 * discriminator is in the facts: ACADEMIC_FIT is the only kind that mentions
 * the athlete at all — it carries `statedByAthlete`, the words off their own
 * profile. Everything else is a fact about the team that would read the same
 * for any recruit.
 *
 * NOTHING HERE IS COMBINED OR SCORED. There is no overall figure, no meter, no
 * sentence that mentions two kinds at once. A conference title does not make
 * the academic match stronger and the academic match does not make the season
 * more impressive.
 *
 * ACADEMIC FIT IS NOT ADMISSION. The evidence says a subject is offered. It
 * says nothing about entry requirements, acceptance, funding, eligibility, or
 * how good the department is, and no wording here may suggest otherwise.
 *
 * Each entry returns { headline, detail, when, scope }.
 */

const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : null);

/**
 * How a postseason round is named.
 *
 * The payload carries a key and no prose, so this is the only place that turns
 * one into English. All seven values are enumerated and an unrecognised key
 * returns null, so a new round shows as missing copy rather than as a blank
 * row. No ordering is implied between them: the map labels what happened and
 * the section does not rank a quarter-final against a round of 32.
 */
const ROUND = Object.freeze({
  champion: 'Won the national title',
  final: 'Reached the national final',
  semi: 'Reached the national semi-finals',
  quarter: 'Reached the national quarter-finals',
  r16: 'Reached the round of 16',
  r32: 'Reached the round of 32',
  appearance: 'Reached the postseason',
});

/**
 * The two momentum classifications.
 *
 * The classification is the server's own reading of the two win rates, so
 * naming it is reporting rather than interpreting — but only the classification
 * is. STRONG deliberately does not describe a direction, because the server did
 * not call one, and neither entry compares the two figures itself.
 */
const MOMENTUM = Object.freeze({
  RISING: {
    headline: 'Recent results are classified as rising',
    detail: (f) => (pct(f.recentWinPct) && pct(f.priorWinPct)
      ? `Winning ${pct(f.recentWinPct)} of recent matches, against ${pct(f.priorWinPct)} in the seasons before.`
      : null),
  },
  STRONG: {
    headline: 'Recent results are classified as consistently strong',
    detail: (f) => (pct(f.recentWinPct) && pct(f.priorWinPct)
      ? `Winning ${pct(f.recentWinPct)} of recent matches, and ${pct(f.priorWinPct)} in the seasons before.`
      : null),
  },
});

const FIT_COPY = Object.freeze({
  ACADEMIC_FIT: (f) => (f.matchedProgramme ? {
    /**
     * States what is offered and what was asked for, and stops.
     *
     * "Strong academic fit" would be a judgement; "a good school for this
     * athlete" would be a recommendation; "likely to be admitted" would be a
     * claim about a process this system has never looked at. The evidence is
     * that a subject on the athlete's profile is taught here.
     */
    headline: `Offers ${f.matchedProgramme}`,
    detail: f.statedByAthlete
      ? `Matched against the subject on this athlete’s profile — “${f.statedByAthlete}”. `
        + 'This is about the subject being taught, not about entry requirements or a place.'
      : 'Matched against the subject on this athlete’s profile.',
    scope: 'athlete',
  } : null),

  CONFERENCE_TITLE: (f, q) => (f.conference ? {
    // The season is on the qualification, not the facts — these two kinds
    // carry only what happened, and when it happened rides alongside.
    headline: q?.season
      ? `Won the ${f.conference} in ${q.season}`
      : `Won the ${f.conference}`,
    // No per-row disclaimer. The group these rows sit under says once that
    // programme results are not about this athlete; repeating it on every row
    // is noise, and noise is what people stop reading.
    detail: null,
    scope: 'programme',
  } : null),

  POSTSEASON_RESULT: (f, q) => (ROUND[f.round] ? {
    headline: q?.season ? `${ROUND[f.round]} in ${q.season}` : ROUND[f.round],
    detail: null,
    scope: 'programme',
  } : null),

  PROGRAM_MOMENTUM: (f, q) => {
    const entry = MOMENTUM[f.classification];
    if (!entry) return null;
    return {
      headline: entry.headline,
      detail: entry.detail(f),
      /**
       * The momentum window is a PHRASE, not a year.
       *
       * `qualification.season` reads "recent vs prior two seasons" on every
       * one of these, where the other two kinds carry "2025". Printing it as
       * "in recent vs prior two seasons" would be nonsense, so it is carried
       * separately and rendered as the window it describes.
       */
      when: q?.season ?? null,
      scope: 'programme',
    };
  },
});

/** Every kind this module can present. Used by its tests, not the UI. */
export const FIT_COPY_KINDS = Object.freeze(Object.keys(FIT_COPY));

/** Presentation content for one item, or null. */
export function fitCopyFor(item) {
  const build = FIT_COPY[item?.kind];
  if (!build) return null;
  const content = build(item.facts ?? {}, item.qualification ?? {});
  if (!content?.headline) return null;
  return { detail: null, when: null, ...content };
}

/**
 * A compact qualification line, or null.
 *
 * Thin on purpose. These four are all STATIC, so there is no current-versus-
 * historical distinction to draw from temporality, and the thing worth saying
 * is which window the claim covers — which only momentum needs, because the
 * other two put their season in the headline.
 *
 * FRESHNESS IS DELIBERATELY NOT SHOWN, unlike every other section. All four of
 * these read from `colleges` columns — notable_majors, conference_champion,
 * postseason_round, recent_win_pct — but the freshness they carry is the
 * ROSTER scrape's, passed to every kind from the shared programme context. At
 * George Mason that produced "no scrape date on these roster rows" underneath
 * a win percentage, which reads as a warning about a figure the roster has
 * nothing to do with. A caveat attached to the wrong data is worse than none.
 * The mismatch is a backend observation, reported rather than fixed here.
 */
export function fitQualification(item) {
  const copy = fitCopyFor(item);
  return copy?.when ? `Measured over ${copy.when}` : null;
}
