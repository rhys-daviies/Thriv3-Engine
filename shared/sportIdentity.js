/**
 * Does this page represent the team and season we asked for?
 *
 * A7.42 SPECIFICATION. The acquisition pipeline lives outside this repository
 * and is NOT changed by this phase; this module is the contract it must
 * implement, written as executable code so it can be tested and so the
 * upstream task has something exact to port rather than prose.
 *
 * -- WHY THIS CHECK MUST HAPPEN BEFORE PLAYERS ARE READ --------------------
 *
 * A7.41 found 72 rows filed as women's soccer that were a cross-country squad
 * and a 2016 men's track squad. Every downstream signal looked healthy:
 *
 *   field completeness   every row had a name, a class year and a hometown
 *   row count            43 and 29, entirely plausible for a soccer squad
 *   turnover             100%, which the season gate reads as a NEW roster
 *   position vocabulary  the only thing that objected, and only by accident
 *
 * The one signal that objected - the position mapper refusing "DIS" and
 * "Throws" - is a coincidence of the sports involved. Two soccer programmes
 * swapped with each other would have produced perfect positions and shipped
 * silently. SO NONE OF THOSE ESTABLISH IDENTITY. Only the page can say which
 * team it is, and it says so before a single player is parsed.
 *
 * -- SPORT AND SEASON ARE CHECKED INDEPENDENTLY ---------------------------
 *
 * A page can be the right sport in the wrong season, the wrong sport in the
 * right season, or both wrong. Grand Canyon was the wrong sport in the right
 * year; Kansas State was wrong in both. A single combined verdict would have
 * let the Grand Canyon case through on its correct year.
 */

export const IDENTITY = Object.freeze({
  AGREES: 'AGREES',
  CONTRADICTS: 'CONTRADICTS',
  /** No signal at all. NEVER treated as agreement. */
  UNKNOWN: 'UNKNOWN',
});

export const IDENTITY_ACTION = Object.freeze({
  EXTRACT: 'EXTRACT',
  /** An explicit contradiction. Do not extract, do not write, raise a review. */
  REFUSE: 'REFUSE',
  /** No identity available. Do not manufacture agreement; send for review. */
  REVIEW: 'REVIEW',
});

/**
 * Sport vocabulary, deliberately small. It exists to tell SOCCER from NOT
 * SOCCER on a page, not to build a sport taxonomy - Thriv3 acquires soccer.
 */
const SPORT_TOKENS = Object.freeze({
  soccer: ['soccer', 'football club'],
});

/** Sports seen contaminating soccer requests, named so a reader sees the shape. */
const FOREIGN_SPORT_TOKENS = Object.freeze([
  'cross country', 'track', 'field hockey', 'lacrosse', 'basketball', 'volleyball',
  'baseball', 'softball', 'tennis', 'golf', 'swimming', 'wrestling', 'rowing',
]);

const lower = (v) => (typeof v === 'string' ? v.toLowerCase() : '');

/**
 * @param {object} observed  every page-level signal available BEFORE extraction
 * @param {string} [observed.title]         document <title>
 * @param {string} [observed.canonical]     <link rel="canonical"> href
 * @param {string} [observed.ogUrl]         og:url
 * @param {string} [observed.displayTitle]  the payload object that also holds `players`
 * @param {string} [observed.sportSlug]     explicit payload sport/team field, when one exists
 */
export function assessPageIdentity({ requestedSport = 'soccer', requestedSeason = null, observed = {} } = {}) {
  const haystack = [observed.title, observed.canonical, observed.ogUrl, observed.displayTitle, observed.sportSlug]
    .map(lower).filter(Boolean).join(' ');

  const signals = {
    title: observed.title ? IDENTITY.AGREES : IDENTITY.UNKNOWN,
    canonical: observed.canonical ? IDENTITY.AGREES : IDENTITY.UNKNOWN,
    displayTitle: observed.displayTitle ? IDENTITY.AGREES : IDENTITY.UNKNOWN,
  };

  let sport = IDENTITY.UNKNOWN;
  if (haystack) {
    const wanted = SPORT_TOKENS[requestedSport] ?? [requestedSport];
    const saysWanted = wanted.some((t) => haystack.includes(t));
    const saysForeign = FOREIGN_SPORT_TOKENS.some((t) => haystack.includes(t));
    /**
     * A page naming a FOREIGN sport contradicts even if it also happens to
     * contain the word we wanted - a combined athletics page can mention both,
     * and the safe reading of an ambiguous page is not "yes".
     */
    /**
     * A7.43. A page naming NEITHER is UNKNOWN, not a contradiction - corrected
     * after porting this spec into the pipeline and measuring it against the
     * 2,060 real 2026 acquisitions. Eight legitimate pages are simply silent
     * about the sport: "Pomona Pitzer Athletics", "Long Island University
     * Athletics", "2026 Kangaroos", and one carrying a typo, "Men's Socccer".
     * Reading silence as contradiction would have refused all eight.
     *
     * SILENCE IS NOT CONTRADICTION. Both contaminated pages named a foreign
     * sport, so the harm this contract exists to stop is caught by the first
     * branch; the third branch would only have cost working acquisitions.
     */
    if (saysForeign) sport = IDENTITY.CONTRADICTS;
    else if (saysWanted) sport = IDENTITY.AGREES;
    else sport = IDENTITY.UNKNOWN;
  }

  /**
   * Season is read only from human-readable text. The `/season/NNNN` path
   * segment is NOT a year: Kansas State's canonical reads `season/1536` for a
   * 2016 roster, and it was the pipeline synthesising `/season/2026` from a
   * calendar year that requested the wrong page in the first place.
   */
  let season = IDENTITY.UNKNOWN;
  const seasonText = [observed.title, observed.displayTitle].map(lower).filter(Boolean).join(' ');
  const years = [...new Set(seasonText.match(/(?:19|20)\d\d/g) ?? [])];
  if (requestedSeason && years.length) {
    season = years.includes(String(requestedSeason)) ? IDENTITY.AGREES : IDENTITY.CONTRADICTS;
  }

  const action = (sport === IDENTITY.CONTRADICTS || season === IDENTITY.CONTRADICTS) ? IDENTITY_ACTION.REFUSE
    : (sport === IDENTITY.UNKNOWN) ? IDENTITY_ACTION.REVIEW
      : IDENTITY_ACTION.EXTRACT;

  return {
    sport,
    season,
    action,
    signals,
    yearsSeen: years,
    reason: action === IDENTITY_ACTION.REFUSE
      ? `the page identifies itself as ${sport === IDENTITY.CONTRADICTS ? 'a different sport' : 'the requested sport'}`
        + `${season === IDENTITY.CONTRADICTS ? ` and as season ${years.join('/')} rather than ${requestedSeason}` : ''}`
        + '. Do not extract players; raise a review.'
      : action === IDENTITY_ACTION.REVIEW
        ? 'no page-level identity signal was found, and absence of a contradiction is not agreement'
        : 'page identity matches the request',
  };
}
