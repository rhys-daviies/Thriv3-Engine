import { positionNoun, positionPlural } from '@shared/positions.js';

/**
 * Card-scale words for the six kinds a match card may carry.
 *
 * A SEPARATE REGISTRY FROM THE OPERATOR ONE, and deliberately so. The Decision
 * Evidence page has room for a headline, a detail, a window and a provenance
 * drawer; a match card has room for a line. Reusing `operatorEvidenceCopy` or
 * `pathwayEvidenceCopy` here would import phrasing written for a surface that
 * can qualify itself, onto one that cannot — and it would import their kind
 * coverage too, which is the whole licensed set rather than these six.
 *
 * THE SAME LINE THE OTHER REGISTRIES MUST NOT CROSS APPLIES HERE. An entry may
 * choose a label, interpolate a value it was handed, pluralise a noun and
 * format a season span. None may add two numbers, compare two figures the
 * server did not compare, reach for a fact on a different evidence object, or
 * decide that something is good news. Every digit rendered below comes from
 * the facts of the ONE object being rendered.
 *
 * WHAT THIS SURFACE MUST NEVER SAY, because it sits beside a match score:
 *
 *   - that a programme recruits, targets, prefers or needs anything now.
 *     Every kind here is an observation of what has already happened, and a
 *     present-tense reading of it is a prediction we have not made.
 *   - that the athlete's own position is wanted. Roster shape is a scored
 *     criterion; a signal that named a need would read as the score's cause.
 *   - anything combining two objects. Four of these kinds share one dedupe
 *     group precisely because they are four views of one connection, and the
 *     read model already keeps at most one of them.
 *
 * FAILS VISIBLY. A kind with no entry, or an entry whose facts are incomplete,
 * returns null and the component says so on the card, naming the kind. It
 * never assembles a sentence out of whichever keys happen to be present.
 *
 * Each entry returns:
 *   line  the claim, one sentence.
 *   note  optional, muted: a season span or the caveat the claim needs.
 */

/** A whole number, or null. Never a default. */
const n = (v) => (Number.isFinite(v) ? v : null);

/** The position word, matched to a count we were given. */
const noun = (position, count) => (count === 1 ? positionNoun(position) : positionPlural(position));

/** "A, B and C" — a list of things, never a total. */
function list(items = []) {
  const clean = (items ?? []).filter(Boolean);
  if (!clean.length) return null;
  if (clean.length === 1) return clean[0];
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
}

/**
 * The seasons an observation covers, as a span.
 *
 * First and last of what the server sent, never a count of them and never a
 * gap-filled range — "between 2019 and 2023" says the observations fall inside
 * those years, which is all the array supports. A single season says itself.
 */
function span(seasons = []) {
  const years = [...new Set((seasons ?? []).filter(Boolean).map(String))].sort();
  if (!years.length) return null;
  if (years.length === 1) return years[0];
  return `${years[0]}–${years[years.length - 1]}`;
}

const COPY = Object.freeze({
  /**
   * The current coach's own recruiting from this country.
   *
   * PAST TENSE, ALWAYS. "has previously recruited" is a record of transitions
   * already made; "recruits", "targets" and "looks to" are forecasts of a
   * person's future behaviour that nothing in this object supports.
   *
   * NO POSITION, even when the object carries one — and the read model does
   * not pass it, so this is belt and braces. The generator records a position
   * only when every attributable arrival shared one, which is 42 of 177 real
   * items; naming it on those and not the rest would make our record-keeping
   * look like a difference between programmes.
   */
  COACH_ARRIVAL_SAME_COUNTRY: (f) => (f.coach && f.country && n(f.count) ? {
    line: `${f.coach} has previously recruited ${f.count} `
      + `${f.count === 1 ? 'player' : 'players'} from ${f.country}.`,
    note: span(f.seasons) ? `Arriving ${span(f.seasons)}.` : null,
  } : null),

  /**
   * An arrival from the athlete's country, at the athlete's position.
   *
   * NO COACH. This object does not carry one — the arrivals it counts are the
   * programme's, across whoever was in charge — and attributing them to the
   * coach named by a neighbouring row would be exactly the synthesis the
   * dedupe group exists to prevent.
   *
   * "recruited ... from" rather than "a New Zealand defender": the country is
   * a country, not an adjective, and the attributive form produces "a Ivory
   * Coast midfielder" on real data.
   */
  ARRIVAL_SAME_COUNTRY_POSITION: (f) => (f.country && f.position && n(f.count) ? {
    line: `Has previously recruited ${f.count} ${noun(f.position, f.count)} from ${f.country}.`,
    note: span(f.seasons) ? `Arriving ${span(f.seasons)}.` : null,
  } : null),

  /**
   * An arrival from the athlete's part of the world, at their position.
   *
   * NAMES THE COUNTRIES, NEVER THE REGION. `OCEANIA` is a bucket key from the
   * recruiting tables and the read model does not send it; the countries are
   * checkable against the programme's own roster. The note says out loud that
   * this is a wider cut than the athlete's own country, because without it a
   * reader who knows the athlete is a New Zealander reads a row about
   * Australia as a row about them.
   */
  ARRIVAL_SAME_REGION_POSITION: (f) => (list(f.countries) && f.position && n(f.count) ? {
    line: `Has previously recruited ${f.count} ${noun(f.position, f.count)} `
      + `from ${list(f.countries)}.`,
    note: `From the athlete’s wider region, not their own country.`
      + (span(f.seasons) ? ` Arriving ${span(f.seasons)}.` : ''),
  } : null),

  /**
   * Compatriots on earlier rosters.
   *
   * THE TENSE IS THE QUALIFICATION. The read model admits this kind only when
   * the object's temporality is HISTORICAL, and the sentence has to carry that
   * where a reader can see it: "have appeared on earlier rosters" cannot be
   * misread as the current squad, which is what "there are New Zealanders
   * here" would do.
   */
  HISTORICAL_SAME_COUNTRY: (f) => (f.country && n(f.count) ? {
    line: `${f.count} ${f.country} ${f.count === 1 ? 'player has' : 'players have'} `
      + `appeared on earlier rosters.`,
    note: list(f.seasonsPresent) ? `Present in ${list(f.seasonsPresent)}.` : null,
  } : null),

  /*
   * CURRENT_SAME_COUNTRY HAS NO ENTRY HERE, AND MUST NOT GET ONE.
   *
   * It is DENIED for MATCHING_SUMMARY because the match score already counts
   * the same thing: `internationalFit` reads the athlete's compatriots on the
   * same 2026 roster rows, and the geography row on the very same card labels
   * it "a compatriot here". Words for it here would be a licence granted in
   * the client, where no permission check can see it — and the registry test
   * fails the build if this file and the licence disagree in either direction.
   *
   * The kind is alive elsewhere. `pathwayEvidenceCopy` renders it on the
   * Decision Evidence page and the composer may put it in an email; neither is
   * beside a score.
   */

  /**
   * A thin position group.
   *
   * THE SHARE IS NOT RENDERED, AND THIS IS THE POINT OF THE ENTRY.
   *
   * `share` is on the object, so printing it would be formatting rather than
   * arithmetic — and it would still be wrong here. The share IS the comparison
   * to the squad, its denominator is the `classifiedSquad` figure that
   * disagrees with POSITION_GROUP_SIZE at 47 of 228 programmes, and one
   * division recovers that contested number from the two rendered values. The
   * read model withheld `squadSize` for that reason; rendering the share would
   * hand it back.
   *
   * So the card states the classification, which the KIND owns — the generator
   * emits this evidence only below an 18% share — and the count, which this
   * object owns. Nothing between them lets a reader rebuild the denominator.
   *
   * No opening, no opportunity, no need: those are the roster criterion's
   * words, and it is scored two sections above this one.
   */
  POSITION_GROUP_SCARCITY: (f) => (f.position && n(f.count) ? {
    line: `Thin at ${positionNoun(f.position)} on the current roster.`,
    note: `${f.count} ${noun(f.position, f.count)} in the squad now.`,
  } : null),
});

/**
 * The words for one signal, or null if there are none to be had.
 *
 * @param {{kind: string, facts: object}} item  one entry from the
 *   matching-summary `facts` array, whole. Passed whole rather than as its
 *   facts so an unknown kind is distinguishable from an empty one.
 */
export function recruitingSignalCopyFor(item) {
  const entry = item?.kind ? COPY[item.kind] : null;
  if (!entry) return null;
  return entry(item.facts ?? {});
}

/** The kinds this registry has words for. Read by tests against the licence. */
export const COPY_KINDS = Object.freeze(Object.keys(COPY));
