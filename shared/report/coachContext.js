/**
 * Whose measured seasons these are, in the words a page may use.
 *
 * `coachAttribution` answers the question; this decides how loudly the report
 * says it, and says it once. Nothing here computes: every figure is read off
 * the attribution model, and where the model has no answer this returns none
 * rather than filling one in.
 *
 * PROMINENCE IS THE POINT. A programme whose current coach ran every measured
 * season needs one quiet line — the report already describes that coach's
 * record and nothing needs qualifying. A programme where they ran one season
 * or none needs the reader to know before they read ten pages of history that
 * is somebody else's. Those are different pages, so they get different
 * treatments, decided from the counts and never from a taste judgement.
 *
 * Mercyhurst men's is the case that made this necessary. Its coach card read
 * "CURRENT COACH HISTORY / stable across the seasons measured" over a
 * programme where one of four measured seasons was the named coach's, while
 * the strip beside it listed "Ryan Osborne 2022 · Austin Solomon 2025–2026 ·
 * 2 unattributed". The card contradicted its own chart.
 *
 * WHAT NO SENTENCE HERE MAY SAY. That anybody was hired, appointed, left,
 * replaced or succeeded anybody — the five-season window cannot see the start
 * or end of a tenure. That a coach is new, or has no history, or prefers or
 * develops anything. That the earlier seasons are irrelevant: they remain the
 * programme's record and the report goes on describing them.
 */

/** How loudly the report says it. Decided by the counts, not by taste. */
export const PROMINENCE = Object.freeze({
  /** Every measured season is the current coach's. One line, no qualifier. */
  QUIET: 'QUIET',
  /** Some but not all. Stated on the card, with the seasons shown. */
  VISIBLE: 'VISIBLE',
  /** One season or none, or an interim. Stated before the history is read. */
  PROMINENT: 'PROMINENT',
  /** The current coach could not be established, and the record expected one. */
  REFUSAL: 'REFUSAL',
  /** No coach record exists for this level at all. Say nothing. */
  ABSENT: 'ABSENT',
});

const NO_ROW = 'no coach row on file for this season';

/**
 * The report-facing reading of one programme's coach attribution.
 *
 * @param attribution - `model.coachAttribution`, or null.
 * @param division - used only to tell "no record exists at this level" from
 *   "a record exists and could not be read". The two deserve different
 *   volumes: 403 programmes below NCAA D3 have no coach table at all, and
 *   making that a visible refusal on every one of their reports would be a
 *   loud statement about our own coverage on a page about their programme.
 */
export function coachContextFor(attribution, { division = null } = {}) {
  if (!attribution) return { prominence: PROMINENCE.ABSENT, available: false };

  const {
    currentCoach, currentCoachReason, historicalMeasuredSeasons: measured,
    currentCoachMeasuredSeasons: attributed, measuredSeasons, predecessor,
    incompleteCoachSeasons, facts,
  } = attribution;

  // No record at this level. NAIA, NJCAA and USCAA have no coach table, and a
  // report for one of them should not carry a refusal about it.
  if (!currentCoach && currentCoachReason === NO_ROW) {
    return {
      prominence: PROMINENCE.ABSENT,
      available: false,
      // The card is a fixed panel and needs something in it. A small
      // unavailable state, not a refusal: "COACH RECORD UNRESOLVED" over an
      // NAIA programme reads as a failure of our own coverage printed on their
      // page, and there is nothing for them to resolve.
      chip: 'NOT ON FILE',
      headline: 'Not on file',
      subline: 'no coaching record is held at this level',
      sentence: null,
      reason: 'no coaching record is held for programmes at this level',
      structural: true,
    };
  }

  // A record was expected and could not be read. This one is worth saying.
  if (!currentCoach) {
    const vacant = /vacant or to be announced/.test(currentCoachReason ?? '');
    return {
      prominence: PROMINENCE.REFUSAL,
      available: false,
      chip: 'COACH RECORD UNRESOLVED',
      // The name line on a card that has no name to show.
      headline: 'Could not establish',
      subline: vacant ? 'the 2026 coach record is marked vacant or to be announced'
        : 'the 2026 coach record could not be read',
      sentence: vacant
        ? 'The 2026 coach record for this programme is marked vacant or to be announced, so this '
          + 'report cannot say how much of the programme history below belongs to the current '
          + 'coaching context.'
        : 'The current head coach could not be established from the coach record on file. The '
          + 'programme history below remains measurable, but this report cannot say how much of it '
          + 'was under the current coaching context.',
      reason: currentCoachReason,
      measured,
      seasons: measuredSeasons,
      division,
    };
  }

  // A coach, but no window to measure them against — a programme whose
  // seasons the report could not read at all. The name is worth showing; a
  // count of nothing is not.
  if (!measured) {
    return {
      prominence: PROMINENCE.QUIET,
      available: true,
      coach: currentCoach,
      chip: facts.interim ? 'INTERIM HEAD COACH' : 'COACH ON FILE',
      headline: currentCoach.name,
      subline: 'no measured season in this report can be attributed',
      sentence: null,
      measured: 0,
      attributed: 0,
      seasons: [],
      interim: facts.interim,
      coHead: facts.coHead,
    };
  }

  const all = attributed === measured;
  const none = attributed === 0;
  // One season out of MORE than one. A single-season window that the current
  // coach ran is all of it, and "only 1 of the 1" is not a sentence.
  const one = attributed === 1 && !all;
  const prominence = facts.interim || none || one
    ? PROMINENCE.PROMINENT
    : all ? PROMINENCE.QUIET : PROMINENCE.VISIBLE;

  // "all 4 measured seasons" / "the single measured season" / "1 of the 4"
  const plural = measured === 1 ? 'season' : 'seasons';
  const count = all
    ? (measured === 1 ? 'the single measured season' : `all ${measured} measured ${plural}`)
    : none ? `none of the ${measured} measured ${plural}`
      : `${attributed} of the ${measured} measured ${plural}`;

  return {
    prominence,
    available: true,
    coach: currentCoach,
    chip: facts.interim ? 'INTERIM HEAD COACH'
      : all ? 'CURRENT COACH HISTORY'
        : none ? 'NO MEASURED SEASON'
          : one ? 'ONE MEASURED SEASON' : 'COACHING CHANGE IN WINDOW',
    headline: currentCoach.name,
    // Under the name on the card. Short, because the card gives it one line.
    subline: `${count} in this report`,
    // The prominent sentence, where the page shows one.
    sentence: sentenceFor({ count, all, none, one, attributed, currentCoach, predecessor, measured, facts }),
    /**
     * The same finding in one line, for the summary band at the top of the
     * glance page.
     *
     * Deliberately shorter than `sentence`, and not because of taste: that
     * band sizes the five cards below it out of the room it leaves, so a
     * three-line row there costs the page its layout. One line states the
     * fact and the card two inches below carries the explanation — which is
     * also the rule that keeps this from becoming a disclaimer repeated in
     * full twice on one page.
     */
    banner: bannerFor({ none, one, attributed, currentCoach, measured, facts }),
    measured,
    attributed,
    previous: measured - attributed - incompleteCoachSeasons.length,
    unresolved: incompleteCoachSeasons.length,
    seasons: measuredSeasons,
    predecessor,
    interim: facts.interim,
    coHead: facts.coHead,
    // Stated wherever the co-head flag is set, because a card that shows one
    // name over a co-head arrangement is showing half the answer.
    coHeadNote: facts.coHead
      ? 'The coach record holds one coach for each programme-season and cannot fully represent a '
        + 'co-head arrangement.' : null,
  };
}

/** One line, for the band. The card carries the rest. */
function bannerFor({ none, one, attributed, currentCoach, measured, facts }) {
  const name = currentCoach.name;
  const seasonWord = measured === 1 ? 'season' : 'seasons';
  if (facts.interim) {
    return `The 2026 coach record identifies ${name} as interim head coach.`;
  }
  // No trailing "the coach on file for 2026": the row's own label reads
  // CURRENT COACH, and at 9pt this band gives one line before it starts
  // costing the five cards below it their layout.
  if (none) {
    return `None of the ${measured} measured ${seasonWord} in this report `
      + `${measured === 1 ? 'was' : 'were'} under ${name}.`;
  }
  if (one) return `Only 1 of the ${measured} measured ${seasonWord} in this report was under ${name}.`;
  return `${attributed} of the ${measured} measured ${seasonWord} in this report were under ${name}.`;
}

/**
 * The sentence a prominent case prints, and the only place the earlier named
 * coach is spoken about.
 *
 * The predecessor clause is deliberately flat: "is the named coach on file for"
 * those seasons. Not the previous coach, not the predecessor, not before
 * anybody — the record shows a name against seasons and nothing about the
 * order of employment.
 */
function sentenceFor({ count, all, none, one, attributed, currentCoach, predecessor, measured, facts }) {
  const name = currentCoach.name;
  const seasonWord = measured === 1 ? 'season' : 'seasons';
  // The verb follows the count that leads the clause: "1 ... was", "none of
  // the 4 ... were", "all 4 ... were".
  const were = (none ? measured === 1 : attributed === 1) ? 'was' : 'were';
  const named = predecessor
    ? ` ${predecessor.name} is the named coach on file for `
      + `${predecessor.seasons.length === measured ? `all ${measured} measured ${seasonWord}`
        : `the ${predecessor.seasons.join(', ')} measured ${predecessor.seasons.length === 1 ? 'season' : 'seasons'}`}.`
    : '';

  if (facts.interim) {
    return `The 2026 coach record identifies ${name} as interim head coach. `
      + `${count[0].toUpperCase()}${count.slice(1)} in this report ${were} `
      + `under that coach.${named}`;
  }
  if (none) {
    return `None of the ${measured} measured ${seasonWord} in this report ${were} `
      + `under ${name}, the coach on file for 2026. The programme history below predates the current `
      + `coaching context.${named}`;
  }
  if (all) {
    return measured === 1
      ? `The single measured season in this report was under ${name}, the coach on file for 2026.`
      : `All ${measured} measured ${seasonWord} in this report ${were} under ${name}, the coach on `
        + 'file for 2026.';
  }
  if (one) {
    return `Only 1 of the ${measured} measured ${seasonWord} in this report was under ${name}. The `
      + 'earlier measured seasons remain useful as programme history, and they describe coaching '
      + `contexts that differ from the current one.${named}`;
  }
  return `${count[0].toUpperCase()}${count.slice(1)} in this report were under ${name}, the coach on `
    + `file for 2026.${named}`;
}

/**
 * The compact season timeline, or null where it would add nothing.
 *
 * ONLY WHERE THE SEASONS DIFFER. A row that reads one name five times is a
 * picture of a fact the line above it already stated, and the card has better
 * uses for the space. So Duke gets no strip and Mercyhurst does.
 *
 * DRAWN FROM THE ATTRIBUTION, not from `tenureFor`. That matters more than it
 * sounds: `tenureFor` does not read the title column, so at Marist men's it
 * reports one unbroken spell of "Aaron Suma 2022-2026" — the strength coach —
 * and the strip drew five solid cells under a card that said the current coach
 * could not be established. The strip and the card now read the same source.
 *
 * Names, never CURRENT/PREVIOUS: a reader checking this against a staff page
 * needs the name. Unresolved seasons say so, and are never filled in from
 * either side.
 */
export function coachTimelineFor(context, { currentSeason = 2026 } = {}) {
  if (!context || !context.seasons?.length) return null;
  const cells = context.seasons.map((s) => ({
    season: String(s.season),
    name: s.coachName ?? null,
    label: s.coachName ? surnameOf(s.coachName) : 'unresolved',
    // The page said nobody, as against we could not read the page. The old
    // strip already drew these differently and the distinction is kept.
    vacant: !s.coachName && /vacant or to be announced/.test(s.unusableReason ?? ''),
    current: s.attribution === 'CURRENT_COACH',
  }));
  // The season a recruit would join, last, so the strip ends where they start.
  cells.push({
    season: String(currentSeason),
    name: context.coach?.name ?? null,
    label: context.coach ? surnameOf(context.coach.name) : 'unresolved',
    vacant: /vacant or to be announced/.test(context.reason ?? ''),
    current: Boolean(context.coach),
    isCurrentSeason: true,
  });

  const resolved = cells.filter((c) => c.name);
  const distinct = new Set(resolved.map((c) => c.name));
  // Nothing to show: one name, every season, no gap.
  if (distinct.size <= 1 && resolved.length === cells.length) return null;
  // Also nothing to show: a row of grey cells. The card's own refusal says
  // "could not establish" in words, which is clearer than a picture of it.
  if (!resolved.length) return null;

  // The key: each name with the seasons it appears in, then the gaps.
  const order = [...distinct];
  const key = order.map((name) => {
    const seasons = cells.filter((c) => c.name === name).map((c) => c.season);
    const span = seasons.length > 1 && Number(seasons[seasons.length - 1]) - Number(seasons[0]) === seasons.length - 1
      ? `${seasons[0]}–${seasons[seasons.length - 1]}` : seasons.join(', ');
    return { name, span, tone: order.indexOf(name) };
  });
  const unresolved = cells.filter((c) => !c.name && !c.vacant).length;
  const vacant = cells.filter((c) => c.vacant).length;

  return {
    cells: cells.map((c) => ({ ...c, tone: c.name ? order.indexOf(c.name) : null })),
    key,
    unresolved,
    vacant,
    // What the strip is a picture of, said once beneath it.
    caption: [
      ...key.map((x) => `${x.name} ${x.span}`),
      unresolved ? `${unresolved} unresolved` : null,
      vacant ? `${vacant} recorded vacant` : null,
    ].filter(Boolean).join('  ·  '),
  };
}

/** "Brian Maisonneuve" -> "Maisonneuve". Hyphenated surnames stay whole. */
function surnameOf(name) {
  const parts = String(name).trim().split(/\s+/);
  return parts[parts.length - 1] || String(name);
}
