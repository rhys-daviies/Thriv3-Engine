/**
 * Sentences a programme's structural history can support, and nothing beyond.
 *
 * RENDERED, since Phase 12F. `reportCompetitive.js` prints these sentences as
 * the bullets on the Competitive environment page, verbatim — which is what 12D
 * was for: the wording was settled and tested before there was a page to write
 * it under layout pressure.
 *
 * EVERY SENTENCE NAMES THE SET IT COUNTED. Three sets of seasons meet on that
 * page — the seasons with a record, the seasons with a conference, the seasons
 * with a division — and they are not always the same set. 12G corrected the
 * wording that said "on file" without saying on file for what.
 *
 * A MOVE IS A FACT AND NOT A DIRECTION. "The programme moved from NCAA D2 to
 * NCAA D1 in 2024" is a restatement of two rows a reader could check. "The
 * programme stepped up", "was promoted", "earned Division I status" are claims
 * about why it happened and whether it was good, and this data says neither. A
 * division change can follow investment, a conference collapsing, an
 * institution's enrolment strategy, or a merger; nothing collected here can
 * separate those, so nothing here implies one. `FORBIDDEN` is checked over
 * every sentence this module can emit.
 *
 * A CONFERENCE RECORD IS NOT COMPARABLE ACROSS CONFERENCES. 8-1-1 in one
 * conference and 8-1-1 in another are the same string about two different
 * competitions. This module states a conference record beside its conference
 * and never ranks one against another — that would be schedule strength, which
 * 12A rejected and 12C left rejected.
 *
 * NOTHING HERE IS A FINISH. The conference table's row order is not a finish:
 * the PSAC prints East then West, so Mercyhurst, first in the West, is eighth
 * by row. `conferenceTableRow` exists in the data and never reaches a sentence.
 */

/**
 * Words a structural fact may never contain.
 *
 * Inflection-bounded rather than prefix-matched, for the reason 12B.1 recorded:
 * a bare `\bpromot` also matches nothing useful, but a bare `\bstep` matches
 * Stepanovic and a bare `\brise` matches Risen. Every family spells out its own
 * endings and every whole word is bounded on both sides.
 */
const FAMILIES = [
  'promot(?:e|es|ed|ing|ion)', 'relegat(?:e|es|ed|ing|ion)',
  'upgrad(?:e|es|ed|ing)', 'downgrad(?:e|es|ed|ing)',
  'improv(?:e|es|ed|ing|ement)', 'declin(?:e|es|ed|ing)',
  'ascend(?:s|ed|ing)?', 'elevat(?:e|es|ed|ing|ion)',
];
const WHOLE = [
  'stepped up', 'step up', 'moved up', 'moved down', 'dropped down',
  'rose', 'fell', 'better', 'worse', 'stronger', 'weaker', 'tougher',
  'elite', 'top-tier', 'lower-tier', 'prestigious', 'ambitious',
  'success', 'successful', 'failure', 'struggled', 'thrived',
];
export const FORBIDDEN = new RegExp(
  `(?:\\b(?:${FAMILIES.join('|')})\\b)|(?:\\b(?:${WHOLE.map((w) => w.replace(/ /g, '\\s+')).join('|')})\\b)`,
  'i',
);

const DIVISION_WORD = { 'NCAA D1': 'NCAA Division I', 'NCAA D2': 'NCAA Division II', 'NCAA D3': 'NCAA Division III', NAIA: 'the NAIA' };
const divisionName = (d) => DIVISION_WORD[d] ?? d;
const list = (xs) => (xs.length <= 1 ? (xs[0] ?? '')
  : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * The structural facts, each carrying the seasons it describes.
 *
 * A fact is emitted only where BOTH sides of the claim are established. A
 * programme with 2024 and 2025 on file and nothing before them has not "stayed
 * in the same conference"; it has two seasons on file, and the sentence says
 * exactly that.
 *
 * @param structural the output of `structuralHistory`
 */
export function structuralFacts(structural) {
  if (!structural || !structural.seasons?.length) return [];
  const facts = [];
  const seasons = structural.seasons;
  const known = structural.knownSeasons;
  /**
   * WHICH SEASONS "ON FILE" MEANT, said outright.
   *
   * Three different sets of seasons meet on a Competitive page: the seasons with
   * a readable win/draw/loss record, the seasons with a conference, and the
   * seasons with a division. They are often the same set and they are not always
   * the same set — University of Rochester women's has four records, three
   * conferences and three divisions. "Across 3 seasons on file" beside a table
   * of four seasons reads as a claim that only three seasons exist, which is
   * false. Each sentence below names the set it is actually counting.
   */
  const denominator = known.length === 1 ? `in ${known[0]}`
    : `across the ${known.length} seasons whose conference is on file (${list(known.map(String))})`;

  const conferenceChanges = structural.changes.filter((c) => c.kind === 'CONFERENCE');
  const divisionChanges = structural.changes.filter((c) => c.kind === 'DIVISION');

  if (structural.stableConference && known.length >= 2) {
    facts.push({
      kind: 'CONFERENCE_STABLE',
      seasons: known,
      text: `The programme competed in the ${structural.stableConference} ${denominator}.`,
    });
  }
  for (const c of conferenceChanges) {
    const from = c.fromSeason ?? c.season - 1;
    facts.push({
      kind: 'CONFERENCE_CHANGE',
      seasons: [from, c.season],
      // The two seasons named are both on file. Where the window has a gap, the
      // earlier one is the previous season ESTABLISHED, not the year before.
      text: `The programme competed in the ${c.from} in ${from} and the ${c.to} in ${c.season}.`,
    });
  }
  if (structural.stableDivision && structural.divisionKnownSeasons.length >= 2) {
    facts.push({
      kind: 'DIVISION_STABLE',
      seasons: structural.divisionKnownSeasons,
      // The seasons with an ESTABLISHED DIVISION, which is narrower than the
      // seasons with a conference and narrower again than the seasons with a
      // record. The condition that produces this fact is unchanged; only the
      // sentence now says what it counted.
      // The COUNT rather than the list: the conference sentence directly above
      // this one already prints the seasons, and the two sets are usually the
      // same set — "(2022, 2024 and 2025)" twice in adjacent bullets is the
      // repetition, not the clarity.
      text: `${structural.divisionKnownSeasons.length === 2 ? 'Both' : `All ${structural.divisionKnownSeasons.length}`} `
        + `seasons with an established division were played in ${divisionName(structural.stableDivision)}.`,
    });
  }
  for (const c of divisionChanges) {
    const from = c.fromSeason ?? c.season - 1;
    facts.push({
      kind: 'DIVISION_CHANGE',
      seasons: [from, c.season],
      // "moved from X to Y" and no more. Not up, not down, and not why. Where
      // the two seasons are not consecutive the sentence says so, because a
      // move "in 2025" from a 2022 season is a different fact.
      text: from === c.season - 1
        ? `The programme moved from ${divisionName(c.from)} to ${divisionName(c.to)} in ${c.season}.`
        : `The programme played ${divisionName(c.from)} in ${from} and ${divisionName(c.to)} in ${c.season}; the seasons between them are not established.`,
    });
  }
  if (known.length && known.length < 4) {
    facts.push({
      kind: 'WINDOW_INCOMPLETE',
      seasons: known,
      text: known.length === 1
        ? `Conference membership is on file for ${known[0]} only.`
        : `Conference membership is on file for ${known.length} of the four seasons measured (${list(known.map(String))}).`,
    });
  }
  const withDivision = seasons.filter((s) => s.division).length;
  if (withDivision < seasons.length) {
    facts.push({
      kind: 'DIVISION_UNKNOWN',
      seasons: seasons.filter((s) => !s.division).map((s) => s.season),
      text: `The division played in is not established for ${seasons.length - withDivision === seasons.length
        ? 'any' : `${seasons.length - withDivision}`} of the ${seasons.length} seasons whose `
        + 'conference is on file.',
    });
  }
  return facts;
}

/**
 * One season's conference record, stated with its conference.
 *
 * The conference is part of the sentence rather than context around it: a
 * conference record without the conference invites the comparison this module
 * refuses to support.
 */
export function conferenceRecordFact(row) {
  if (!row?.available) return null;
  const where = row.conferenceName ? `inside the ${row.conferenceName}` : 'against conference opponents';
  const size = row.conferenceSize ? `, one of ${row.conferenceSize} programmes in it that season` : '';
  return {
    kind: 'CONFERENCE_RECORD',
    seasons: [row.season],
    text: `In ${row.season} the programme's record ${where} was ${row.record} from ${row.matches} matches${size}.`,
  };
}
