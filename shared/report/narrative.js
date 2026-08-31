/**
 * What Thriv3 sees: the report's own reading of the evidence beside it.
 *
 * The pages show strong evidence and ask the reader to do too much of the
 * interpretation. This module does that work once, in sentences, from the
 * figures the page already prints — and nothing else. It computes NOTHING: if
 * a sentence here needs a number, that number is already on the page it sits
 * on, and if the model cannot supply it the sentence is not written.
 *
 * WHAT THESE SENTENCES MAY NOT DO.
 *
 * Predict. Not "will", not "should", not "likely" — the season being recruited
 * into has not been played and no sentence here may imply it has.
 *
 * Judge. Not good fit, bad fit, safe, risky, strong culture, poor culture.
 * A programme below the comparable pool on a measure is below the comparable
 * pool on that measure; why is not in roster data.
 *
 * Label a move. Not successful, not failed, and not transfer: what the rosters
 * show is a name at another programme the following season.
 *
 * The vocabulary is deliberately small and repeated. "Comparable programmes"
 * always means the pool the page is benchmarked against; "traced" always means
 * an observed destination; "could return" always means the readable
 * denominator. A reader who learns one page has learned all of them.
 */
import { STARTER_MINUTES } from '../philosophy.js';

const pc = (v) => `${Math.round(v * 100)}%`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** How a benchmark band is said in a sentence, never as a verdict. */
const AGAINST_POOL = {
  'above-benchmark': 'above the comparable pool',
  typical: 'inside the middle half of comparable programmes',
  'below-benchmark': 'below the comparable pool',
};

/**
 * The three bands, said as one clause that can be appended to a figure.
 *
 * Returns null rather than a phrase where there is no pool to speak of, so a
 * caller appends nothing rather than "compared with nothing".
 */
export function againstPool(band) {
  return AGAINST_POOL[band] ?? null;
}

/** The largest share among a set of counts, where one is clearly largest. */
function dominant(counts, labels, { total }) {
  if (!total) return null;
  const ranked = Object.entries(counts)
    .filter(([k]) => labels[k])
    .map(([k, n]) => ({ key: k, n, share: n / total }))
    .sort((a, b) => b.n - a.n);
  const top = ranked[0];
  if (!top || top.n === 0) return null;
  return { ...top, label: labels[top.key], unanimous: top.n === total };
}

const HOW_MANY = (share) => (share === 1 ? 'every one'
  : share >= 0.8 ? 'almost all'
    : share >= 0.6 ? 'most'
      : share >= 0.4 ? 'about half'
        : 'some');

// ---------------------------------------------------------------------------
// Development
// ---------------------------------------------------------------------------

export function developmentNarrative(model) {
  const d = model.lifecycle?.development;
  if (!d) return [];
  if (!d.minutesCoverage.readable) {
    return [`Minutes are published for only ${d.minutesCoverage.measured} of `
      + `${d.minutesCoverage.playerSeasons} first-year seasons here, which is too few to describe `
      + 'how players have developed. The counts on this page are real; no share is quoted from them.'];
  }

  const out = [];
  const y2 = d.byYear[1];
  const y3 = d.byYear[2];
  const ever = d.everStarter;

  if (ever.share != null) {
    const clause = againstPool(ever.band);
    out.push(`${ever.reached} of the ${ever.denominator} first-years we can measure have reached a `
      + `${STARTER_MINUTES}-minute season here at some point — ${pc(ever.share)}`
      + `${clause ? `, ${clause}` : ''}.`);
  }

  // The shape of the climb, said only where two adjacent years can be compared.
  if (y2?.share != null && y3?.share != null) {
    out.push(`${pc(y2.share)} had reached it by a second season and ${pc(y3.share)} by a third, `
      + 'each counted only over the players who have been here that long.'
      + (y3.share > y2.share
        ? ' Players who begin with limited minutes have often grown into larger roles over later '
          + 'seasons here.' : ''));
  }

  const t = d.timeToStarter;
  if (!t.suppressed && t.denominator > 0) {
    const late = t.year2 + t.year3;
    if (late > t.year1) {
      out.push(`Of the ${t.denominator} first-years with three measured seasons here, ${late} first `
        + `reached ${STARTER_MINUTES} minutes in a second or third season rather than a first.`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Continuity
// ---------------------------------------------------------------------------

export function continuityNarrative(model) {
  const c = model.lifecycle?.continuity;
  const d = model.lifecycle?.departures;
  if (!c) return [];
  const out = [];

  if (c.retention != null) {
    const clause = againstPool(c.band);
    out.push(`${c.returned} of the ${c.returnable} players who could return did — ${pc(c.retention)}`
      + `${clause ? `, ${clause}` : ''}.`);
  } else {
    out.push(`${c.returned} of the ${c.returnable} players who could return did. That is too small `
      + 'a group to read against comparable programmes.');
  }

  if (d) {
    const e = d.earlyTracing;
    out.push(`${d.departures.expectedExits} of the ${d.departures.total} who did not return were `
      + `seniors or graduate students; ${d.departures.earlyDepartures} still had seasons left by `
      + 'their class label.');
    if (e.departures > 0) {
      out.push(e.observed > 0
        ? `Of those ${e.departures}, ${e.observed} appear on another programme’s roster the next `
          + `season and ${e.ambiguous + e.unresolved} cannot be traced from the roster data at all.`
        : `None of those ${e.departures} can be traced to another roster, which is a limit of the `
          + 'available data rather than a finding about where they went.');
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

// Written as whole clauses, because the three dimensions do not share a verb:
// a player GOES TO a programme, and STAYS IN a division.
const FOOTBALL_LABELS = {
  STRONGER_FOOTBALL_RATING: 'went to a programme rated more highly at football',
  SIMILAR_FOOTBALL_RATING: 'went to a programme rated similarly at football',
  LOWER_FOOTBALL_RATING: 'went to a programme rated lower at football',
};
const ACADEMIC_LABELS = {
  HIGHER_ACADEMIC_RATING: 'went to one with a higher academic rating',
  SIMILAR_ACADEMIC_RATING: 'went to one with a similar academic rating',
  LOWER_ACADEMIC_RATING: 'went to one with a lower academic rating',
};
const DIVISION_LABELS = {
  DIVISION_UP: 'moved up a division',
  DIVISION_SAME: 'stayed in the same division',
  DIVISION_DOWN: 'moved down a division',
};

export function destinationNarrative(model) {
  const d = model.lifecycle?.departures;
  if (!d?.gate?.allowed) return [];
  // The counts are the page's own headline figure and its scope line. What
  // this block adds is the pattern in the traced sample, which no figure on the
  // page states in words.
  const out = [];

  // Each dimension on its own, and the sentence says so.
  const parts = [];
  for (const [key, labels] of [['football', FOOTBALL_LABELS], ['academic', ACADEMIC_LABELS],
    ['division', DIVISION_LABELS]]) {
    const dim = d.dimensions[key];
    const total = dim.n - dim.notComparable;
    const top = dominant(dim, labels, { total });
    if (top && top.share >= 0.4) parts.push(`${HOW_MANY(top.share)} ${top.label}`);
  }
  if (parts.length) {
    out.push(`Among the departures we can trace, ${parts.join(', ')}. Those are three separate `
      + 'readings of the same moves, not one, and a single player can be all three.');
  }
  return out;
}

// ---------------------------------------------------------------------------
// The programme, in four lines, for the front of the report
// ---------------------------------------------------------------------------

/**
 * The headline findings, one line each, with the page carrying the evidence.
 *
 * This is the whole reason the front of the report works: a reader who stops
 * after page two has the six questions answered and knows where to go for any
 * of them. Every line is a restatement of a figure printed later, never a
 * figure that appears only here.
 */
export function programmeHeadlines(model) {
  const s = model.summary?.programme;
  const l = model.lifecycle;
  const out = [];

  const f = s?.freshmanOpportunity;
  // The same refusal the card makes. A programme whose minutes cannot be read
  // has a ladder top of zero, and this line printed "has typically played 0
  // minutes" beside a card that was refusing to state exactly that figure.
  const freshmanUnclear = !f || f.classification === 'unclear' || f.classification === 'unavailable';
  if (f?.ladderTop?.median != null && !freshmanUnclear) {
    const clause = againstPool(f.classification);
    out.push({
      label: 'First-years',
      text: 'The best first-year of a season here has typically played '
        + `${Math.round(f.ladderTop.median).toLocaleString('en-US')} minutes`
        + `${clause ? ` — ${clause}` : ''}.`,
      section: 'freshman-ladder',
    });
  } else if (f) {
    out.push({
      label: 'First-years',
      text: 'There is not enough published first-year minutes here to say what a first-year has '
        + 'typically played.',
      section: 'freshman-ladder',
    });
  }

  const e = s?.experiencedArrivalReliance;
  if (e?.measurable && e.shareOfMeasuredLoad != null) {
    const clause = againstPool(e.classification);
    out.push({
      label: 'Experienced arrivals',
      text: `${pc(e.shareOfMeasuredLoad)} of readable minutes have gone to players who did not `
        + `arrive as first-years${clause ? ` — ${clause}` : ''}.`,
      section: 'experienced-arrival-intake',
    });
  }

  const dev = l?.development;
  if (dev?.everStarter?.share != null) {
    const clause = againstPool(dev.everStarter.band);
    out.push({
      label: 'Development',
      text: `${dev.everStarter.reached} of ${dev.everStarter.denominator} measurable first-years `
        + `have reached a ${STARTER_MINUTES}-minute season here`
        + `${clause ? ` — ${clause}` : ''}.`,
      section: 'player-development',
    });
  } else if (dev) {
    out.push({
      label: 'Development',
      text: 'Too few first-year seasons here carry published minutes to describe how players have '
        + 'developed.',
      section: 'player-development',
    });
  }

  const c = l?.continuity;
  if (c?.retention != null) {
    const clause = againstPool(c.band);
    out.push({
      label: 'Roster stability',
      text: `${pc(c.retention)} of the players who could return did`
        + `${clause ? ` — ${clause}` : ''}.`,
      section: 'roster-continuity',
    });
  }

  const d = l?.departures;
  if (d?.gate?.allowed) {
    out.push({
      label: 'Where players go',
      text: `${d.tracing.observed} of ${d.departures.total} departures can be traced to another `
        + `roster — ${pc(d.tracing.coverage)} of them.`,
      section: 'observed-destinations',
    });
  } else if (d && d.departures.total > 0) {
    out.push({
      label: 'Where players go',
      text: 'Too few departures at this level can be traced to another roster for us to describe '
        + 'where players went.',
      section: null,
    });
  }

  return out;
}

/** The same, narrowed to the athlete's position. */
export function athleteHeadlines(model) {
  const a = model.summary?.athlete;
  const l = model.lifecycle;
  if (!a) return [];
  const out = [];

  const here = a.currentPositionPlayers ?? [];
  // A zero here is an absent roster, not an empty position group, and the row
  // pointed at a page that does not render — it read "0 players … 0 of them"
  // and led nowhere.
  out.push(here.length ? {
    label: 'Who is there now',
    text: `${plural(here.length, 'player', 'players')} on the current roster are recorded at this `
      + `position, ${(a.currentPlayersEligibleAtEntry ?? []).length} of them still eligible in `
      + `${a.entrySeason}.`,
    section: 'athlete-current-position',
  } : {
    label: 'Who is there now',
    text: 'No current roster is on file for this programme, so who is at this position now cannot '
      + 'be read.',
    section: null,
  });

  const v = a.positionVacancyHistory;
  if (v?.transitions > 0) {
    out.push({
      label: 'When a place opens',
      text: `A starter has left this position in ${v.openings} of ${v.transitions} season-to-season `
        + 'changes on file.',
      section: 'athlete-position-openings',
    });
  }

  const h = a.positionFreshmanHistory;
  if (h?.measured > 0) {
    const played = (h.players ?? []).filter((x) => (x.minutes ?? 0) >= STARTER_MINUTES).length;
    out.push({
      label: 'First-years here',
      text: `${h.measured} first-years at this position have minutes on file, `
        + `${played} of them a ${STARTER_MINUTES}-minute season.`,
      section: 'athlete-position-history',
    });
  }

  const p = l?.athletePosition;
  if (p) {
    out.push({
      label: 'Traced at this position',
      text: p.atPositionObserved === 0
        ? `None of the ${p.atPositionDepartures} departures at this position could be traced to `
          + 'another roster.'
        : `${p.atPositionObserved} of ${p.atPositionDepartures} departures at this position could `
          + 'be traced to another roster.',
      section: 'athlete-position-movement',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The pathway: several analyses, read together
// ---------------------------------------------------------------------------

/**
 * THE PATHWAY THRIV3 SEES — the one place this report joins its analyses up.
 *
 * The difference from every other block in this module is the scope of the
 * claim, and it is the reason the two are named differently on the page.
 * `developmentNarrative` and its siblings restate ONE page: they may say what
 * that page's figures show and nothing more. This reads across the first-year
 * record at a position, the programme's multi-year development, what happened
 * when that position last opened, and who is on the roster now — and states
 * what those four say when they are put in one paragraph.
 *
 * It computes nothing. Every number below is printed on a page of this report,
 * and every sentence names the denominator it came from, because a synthesis
 * that drops its denominators is where a report stops being checkable.
 *
 * WHAT IT MAY NOT DO, beyond the module-wide rules: it may not resolve the
 * analyses into a verdict. Four findings that point different ways are
 * reported as four findings that point different ways. There is no sentence
 * here that adds up.
 */
export function pathwayNarrative(model) {
  const a = model.summary?.athlete;
  const l = model.lifecycle;
  if (!a) return [];
  const position = String(a.positionLabel ?? 'this position').toLowerCase();
  const out = [];

  // 1. First-years at this position, and what happened when it last opened.
  const h = a.positionFreshmanHistory;
  const v = a.positionOpeningOutcomes;
  if (h?.measured > 0) {
    const openings = v?.openings ?? 0;
    out.push(`${h.measured} first-year ${h.measured === 1 ? position : `${position}s`} here `
      + `${h.measured === 1 ? 'has' : 'have'} minutes on file and `
      + `${h.starters === 0 ? 'none of them' : `${h.starters} of them`} reached a `
      + `${STARTER_MINUTES}-minute season.`
      + (openings > 0
        ? ` Across the ${plural(openings, 'occasion', 'occasions')} a starter left this position, a `
          + `first-year went on to start after ${v.freshmanTookIt === 0 ? 'none of them'
            : `${v.freshmanTookIt} of them`}.`
        : ''));
  } else if (v?.openings > 0) {
    out.push(`No first-year ${position} here has minutes on file, so the position's first-year `
      + `record cannot be read. A starter left this position on ${plural(v.openings, 'occasion', 'occasions')}.`);
  }

  /**
   * 2. How often the position is added to, against how far its minutes reach.
   *
   * The one place in this report where two independent histories are put in
   * one sentence, and the reason they may be: Phase 8B measured them at
   * r = 0.05 to 0.13, so a programme can add many players at a position AND
   * spread its minutes widely, or add few and concentrate them. Reporting
   * either alone is what invites the wrong reading. They are placed next to
   * each other and NOT combined — there is no arithmetic between them here.
   */
  const intake = model.pressure?.athletePosition?.historical ?? null;
  const util = model.positionUtilisation?.athletePosition ?? null;
  if (intake && !intake.suppressed) {
    const wide = util?.available && util.pool?.playersWith600Plus
      ? (util.medianPlayersWith600Plus > util.pool.playersWith600Plus.middleHalf.high ? 'wider'
        : util.medianPlayersWith600Plus < util.pool.playersWith600Plus.middleHalf.low ? 'narrower'
          : 'inside')
      : null;
    const busy = intake.pool
      ? (intake.medianTotalIncoming > intake.pool.middleHalf.high ? 'more'
        : intake.medianTotalIncoming < intake.pool.middleHalf.low ? 'fewer' : 'about as many')
      : null;
    let sentence = `This programme added ${intake.totalIncomingPerCycle.join(', ')} ${position}s `
      + `across ${plural(intake.cyclesWithReadableRosterPresence, 'recruiting cycle', 'recruiting cycles')}`
      + (busy && busy !== 'about as many'
        ? ` — ${busy} than the comparable middle half of ${intake.pool.middleHalf.low} to ${intake.pool.middleHalf.high} a cycle`
        : busy ? ` — about as many as comparable programmes` : '');
    if (wide) {
      const seasons = util.readableSeasons;
      const basis = seasons < util.seasons.length
        ? `the ${seasons === 1 ? 'single season' : `${seasons} seasons`} of ${util.seasons.length} with enough position-level minutes to read`
        : `all ${seasons} seasons`;
      sentence += `. In ${basis}, ${util.medianPlayersWith600Plus} ${position}s reached a `
        + `${STARTER_MINUTES}-minute season in a typical year out of ${util.medianPlayersWithMinutes} used`
        + (wide === 'inside'
          ? ', inside the comparable middle half.'
          : `, ${wide === 'wider' ? 'more' : 'fewer'} than the comparable middle half of `
            + `${util.pool.playersWith600Plus.middleHalf.low} to ${util.pool.playersWith600Plus.middleHalf.high}.`);
    } else if (util && !util.supported) {
      sentence += '. How far the minutes at this position reach is not reported for goalkeepers.';
    } else {
      sentence += '.';
    }
    out.push(sentence);
  }

  // 3. The roster as it stands, against the entry year.
  const here = a.currentPositionPlayers ?? [];
  if (here.length) {
    const eligible = (a.currentPlayersEligibleAtEntry ?? []).length;
    const finalSeason = (a.currentPlayersInFinalSeasonAtEntry ?? []).length;
    const proj = a.currentProjectedMinutesOfPlayersEligibleAtEntry;
    const above = here.filter((x) => Number(x.projectedMinutes) >= STARTER_MINUTES).length;
    out.push(`The current roster carries ${plural(here.length, `${position}`, `${position}s`)}, `
      + `${eligible} of them still eligible in ${a.entrySeason}`
      + (proj?.playersWithProjection
        ? `, ${above} of whom ${above === 1 ? 'is' : 'are'} projected above ${STARTER_MINUTES} `
          + `minutes for the coming season (of ${proj.playersWithProjection} carrying a projection)`
        : '')
      + `${finalSeason ? `, and ${finalSeason} in a final eligible season in ${a.entrySeason}` : ''}.`);
  }

  // 4. Where the minutes went when the position opened.
  if (v?.dials?.n) {
    const parts = [['returning players', v.dials.returning], ['first-years', v.dials.freshman],
      ['experienced arrivals', v.dials.newcomer]]
      .filter(([, share]) => share != null)
      .sort((x, y) => y[1] - x[1]);
    if (parts.length) {
      out.push(`When minutes opened at this position, ${parts[0][0]} took most of them — `
        + `${parts.map(([label, share]) => `${Math.round(share)}% ${label}`).join(', ')} `
        + `across ${plural(v.dials.n, 'position-season', 'position-seasons')}.`);
    }
  }

  /**
   * Last, and therefore the first thing dropped: the programme's multi-year
   * development, which is the only block here that is NOT about this position.
   *
   * It was second until Phase 9B gave the position two histories of its own.
   * When six sentences is not enough room, a programme-wide figure is what a
   * reader can most afford to lose from a paragraph about one position — and
   * it is still on its own page either way.
   */
  const d = l?.development;
  if (d?.minutesCoverage?.readable && d.everStarter?.share != null) {
    const y1 = d.byYear[0]?.share;
    const later = d.byYear[2]?.share ?? d.byYear[1]?.share;
    const grew = y1 != null && later != null && later > y1;
    out.push(`Across the whole squad rather than this position alone, `
      + `${d.everStarter.reached} of ${d.everStarter.denominator} measurable first-years have `
      + `reached a ${STARTER_MINUTES}-minute season here at some point`
      + (grew
        ? `, and the share doing so rises from ${pc(y1)} in a first season to ${pc(later)} by a `
          + 'third — the pathway has not been closed to players who begin with limited minutes.'
        : '.'));
  }

  // Six sentences is the ceiling. Where a programme supports more, the last is
  // dropped rather than the paragraph being allowed to grow into a page.
  return out.slice(0, 6);
}
