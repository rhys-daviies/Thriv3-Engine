import { positionNoun, positionPlural } from '@shared/positions.js';

/**
 * Operator-facing words for the structured facts the API sends.
 *
 * A PRESENTATION LAYER, and the line it must not cross is worth stating up
 * front. Every entry below may choose a label, interpolate a value it was
 * given, format a count or a percentage, and pluralise a noun. None of them
 * may add two numbers together, compare two figures the server did not
 * compare, decide whether something is good or bad, or produce a sentence when
 * a fact it needs is missing. Direction is the server's — `polarity` and
 * `decisionClass` arrive on every item — and a phrase here that implied a
 * direction of its own would be a second evidence system with no tests behind
 * it and no registry to answer to.
 *
 * FAILS VISIBLY. A kind with no entry returns null and the component says so
 * on the page, naming the kind. The alternative — assembling something generic
 * out of whatever keys happen to be on `facts` — would put a sentence in front
 * of an operator that nobody wrote and nobody reviewed, and it would look
 * exactly like copy that had been.
 *
 * Two roles per kind, because a claim reads differently as the reason itself
 * than as a detail underneath one:
 *
 *   conclusion  the short line that IS the reason
 *   detail      the supporting sentence beneath it
 *   subordinate optional: the phrasing to use when this kind appears as
 *               SUPPORTING evidence under a different primary. Defaults to
 *               `detail`. ELIGIBILITY_CLIFF defines its own, and the reason is
 *               a safety rule — see the note on that entry.
 */

/** A whole number as the operator would read it. */
const n = (v) => (Number.isFinite(v) ? String(v) : null);

/** A share the server already computed, as a percentage. Never derived here. */
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : null);

/** "A, B and C" — a list, not a sum. */
function list(items = []) {
  const clean = items.filter(Boolean);
  if (!clean.length) return null;
  if (clean.length === 1) return clean[0];
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
}

/** The position word, singular or plural to match a count we were given. */
const noun = (position, count) => (count === 1 ? positionNoun(position) : positionPlural(position));

/**
 * How a postseason round is named. The server sends the key; this is the only
 * place that turns it into English, and an unrecognised key returns null so a
 * new round shows as missing copy rather than as a blank.
 */
const ROUND = Object.freeze({
  champion: 'Won the national title',
  final: 'Reached the national final',
  semi: 'Reached the semi-finals',
  quarter: 'Reached the quarter-finals',
  r16: 'Reached the round of 16',
  r32: 'Reached the round of 32',
  appearance: 'Reached the postseason',
});

/**
 * The two momentum classifications the server produces.
 *
 * The classification IS the direction, and it comes from the server. The
 * detail restates the two figures it was given and does not characterise the
 * move on its own — which is why STRONG does not say "up from".
 */
const MOMENTUM = Object.freeze({
  RISING: {
    conclusion: 'Results are trending upwards',
    detail: (f) => (pct(f.recentWinPct) && pct(f.priorWinPct)
      ? `Winning ${pct(f.recentWinPct)} of recent matches, against ${pct(f.priorWinPct)} before that.`
      : null),
  },
  STRONG: {
    conclusion: 'Consistently strong results',
    detail: (f) => (pct(f.recentWinPct)
      ? `Winning ${pct(f.recentWinPct)} of recent matches.`
      : null),
  },
});

const COPY = ({
  // ---- Roster opportunity -------------------------------------------------

  POSITION_GRADUATION: {
    conclusion: (f) => (n(f.count) && f.position
      ? `${f.count} ${noun(f.position, f.count)} in the graduating class`
      : null),
    detail: (f) => (list(f.names) && f.beforeClassYear
      ? `${list(f.names)} — due to graduate before the ${f.beforeClassYear} intake.`
      : null),
  },

  POSITION_GRADUATION_STARTERS: {
    conclusion: (f) => (n(f.starterCount) && f.position
      ? `${f.starterCount} projected ${noun(f.position, f.starterCount)} starting`
      : null),
    // Deliberately says "of them" nowhere. As a subordinate line under a
    // graduation reason it reads as a subset because it sits there, and the
    // server has not told us it is one.
    detail: (f) => (n(f.starterCount) && list(f.names)
      ? `${f.starterCount} projected to start on current minutes: ${list(f.names)}.`
      : null),
    subordinate: (f) => (n(f.starterCount) && f.position && list(f.names)
      ? `${f.starterCount} projected ${noun(f.position, f.starterCount)} starting: ${list(f.names)}.`
      : null),
  },

  POSITION_GROUP_SCARCITY: {
    conclusion: (f) => (n(f.count) && f.position
      ? `Thin at ${positionNoun(f.position)}`
      : null),
    detail: (f) => (n(f.count) && n(f.squadSize)
      ? `${f.count} ${noun(f.position, f.count)} in a squad of ${f.squadSize}`
        + `${pct(f.share) ? ` (${pct(f.share)})` : ''}.`
      : null),
  },

  RETURNING_POSITION_DEPTH: {
    conclusion: (f) => (n(f.returning) && n(f.groupSize) && f.position
      ? `${f.returning} of ${f.groupSize} ${positionPlural(f.position)} returning`
      : null),
    detail: (f) => (f.beforeClassYear
      ? `Still on the roster through the ${f.beforeClassYear} intake.`
      : null),
  },

  ELIGIBILITY_CLIFF: {
    conclusion: (f) => (n(f.players) && f.position && f.beforeClassYear
      ? `${f.players} ${noun(f.position, f.players)} reaching the end of eligibility`
      : null),
    detail: (f) => (n(f.players) && f.beforeClassYear
      ? `Eligibility runs out for ${f.players} before the ${f.beforeClassYear} intake`
        + `${n(f.projectedMinutes) ? `, carrying ${f.projectedMinutes} projected minutes` : ''}.`
      : null),

    /**
     * A HORIZON, never a headcount, when it sits under another reason.
     *
     * This is the one entry with a real safety rule behind it. At Jacksonville
     * the graduation reason counts 3 defenders and this counts 5 across 2026
     * AND 2027 — of whom the 2026 rows are the same three. Printing "5" as a
     * subordinate line under "3 in the graduating class" invites the reader to
     * add or to substitute, and the API has told us nothing that would justify
     * either. So under a primary it names WHEN the pressure continues and no
     * number at all, taken from `byYear` without summing it.
     */
    subordinate: (f) => {
      const years = (f.byYear ?? []).filter((y) => y.players > 0).map((y) => y.year);
      if (!years.length) return null;
      return years.length > 1
        ? `Eligibility pressure continues into ${years[years.length - 1]}.`
        : `Eligibility also runs out for this group in ${years[0]}.`;
    },
  },

  // ---- Recruitment pathway ------------------------------------------------

  COACH_ARRIVAL_SAME_COUNTRY: {
    /**
     * `position` is on the facts and is often null — it is set only when every
     * supporting arrival shared one. Reading it without checking would put a
     * position in a claim the evidence does not make, so the phrase is built
     * from what is there.
     */
    conclusion: (f) => (f.country && f.coach
      ? `This coach has recruited from ${f.country}`
      : null),
    detail: (f) => (f.coach && f.namedArrival && f.namedArrivalSeason
      ? `${f.coach} brought in ${f.namedArrival} in ${f.namedArrivalSeason}.`
      : null),
    subordinate: (f) => (f.country && f.coach && f.namedArrival && f.namedArrivalSeason
      ? `${f.coach} has recruited from ${f.country} — ${f.namedArrival}, ${f.namedArrivalSeason}.`
      : null),
  },

  ARRIVAL_SAME_COUNTRY_POSITION: {
    conclusion: (f) => (f.country && f.position && n(f.count)
      ? `Has recruited ${f.count === 1 ? 'a' : `${f.count}`} ${f.country} `
        + `${noun(f.position, f.count)}`
      : null),
    detail: (f) => (f.namedArrival && f.namedArrivalSeason
      ? `${f.namedArrival}, ${f.namedArrivalSeason}.`
      : null),
  },

  ARRIVAL_SAME_REGION_POSITION: {
    /**
     * Names the COUNTRIES, never the region key. "OCEANIA" is a bucket name
     * from the recruiting tables; the countries are both more natural and
     * checkable against the programme's own roster — the same choice the email
     * renderer makes for the same reason.
     */
    conclusion: (f) => (list(f.countries) && f.position && n(f.count)
      ? `Has recruited ${f.count === 1 ? 'a' : `${f.count}`} `
        + `${noun(f.position, f.count)} from ${list(f.countries)}`
      : null),
    detail: (f) => (f.namedArrival && f.namedArrivalSeason
      ? `${f.namedArrival}, ${f.namedArrivalSeason}.`
      : null),
  },

  CURRENT_SAME_COUNTRY: {
    conclusion: (f) => (f.country && n(f.count)
      ? `${f.count === 1 ? 'A' : f.count} ${f.country} player${f.count === 1 ? '' : 's'} on the current roster`
      : null),
    detail: (f) => (list(f.names) ? `${list(f.names)}.` : null),
  },

  HISTORICAL_SAME_COUNTRY: {
    conclusion: (f) => (f.country && n(f.count)
      ? `${f.count === 1 ? 'A' : f.count} ${f.country} player${f.count === 1 ? '' : 's'} on an earlier roster`
      : null),
    detail: (f) => (list(f.names)
      ? `${list(f.names)}${list(f.seasonsPresent) ? ` — ${list(f.seasonsPresent)}` : ''}.`
      : null),
  },

  HISTORICAL_SAME_REGION: {
    // Countries again, and `excludingCountry` is deliberately not mentioned:
    // it records who was left out, which narrows nothing a reader needs.
    conclusion: (f) => (list(f.countries) && n(f.count)
      ? `${f.count === 1 ? 'A player' : `${f.count} players`} from ${list(f.countries)} on an earlier roster`
      : null),
    detail: (f) => (list(f.names) ? `${list(f.names)}.` : null),
  },

  // ---- Programme fit ------------------------------------------------------

  ACADEMIC_FIT: {
    conclusion: (f) => (f.matchedProgramme ? `Offers ${f.matchedProgramme}` : null),
    detail: (f) => (f.statedByAthlete
      ? `Matches the subject on this athlete's profile — “${f.statedByAthlete}”.`
      : null),
  },

  CONFERENCE_TITLE: {
    conclusion: (f) => (f.conference ? `Won the ${f.conference}` : null),
    detail: () => 'Conference champions in the most recent completed season.',
  },

  POSTSEASON_RESULT: {
    conclusion: (f) => ROUND[f.round] ?? null,
    detail: () => 'In the most recent completed season.',
  },

  PROGRAM_MOMENTUM: {
    conclusion: (f) => MOMENTUM[f.classification]?.conclusion ?? null,
    detail: (f) => MOMENTUM[f.classification]?.detail(f) ?? null,
  },
});

/**
 * Kinds whose subordinate line is their headline plus their own detail.
 *
 * Written as a pass rather than repeated in each entry: the detail on each of
 * these is a list of names or a season, which reads correctly appended to its
 * own conclusion and reads as a fragment on its own. Nothing new is phrased
 * here — the two strings are the ones already defined above.
 */
for (const kind of ['ARRIVAL_SAME_COUNTRY_POSITION', 'ARRIVAL_SAME_REGION_POSITION',
  'CURRENT_SAME_COUNTRY', 'HISTORICAL_SAME_COUNTRY', 'HISTORICAL_SAME_REGION',
  'POSITION_GRADUATION', 'POSITION_GROUP_SCARCITY', 'RETURNING_POSITION_DEPTH',
  'PROGRAM_MOMENTUM']) {
  const entry = COPY[kind];
  if (entry.subordinate) continue;
  entry.subordinate = (f) => {
    const head = typeof entry.conclusion === 'function' ? entry.conclusion(f) : entry.conclusion;
    if (!head) return null;
    const tail = typeof entry.detail === 'function' ? entry.detail(f) : entry.detail;
    // A colon rather than a dash: several of these details carry a dash of
    // their own, and two in one line reads as a typo.
    return tail ? `${head}: ${tail}` : `${head}.`;
  };
}

/** Every kind this module can phrase. Used by its tests, not by the UI. */
export const COPY_KINDS = Object.freeze(Object.keys(COPY));

/**
 * Operator copy for one fact item, or null.
 *
 * @param {object} item  a `topReasons[].primary` or a `supporting[]` entry
 * @param {'primary'|'supporting'} role  which phrasing to use
 * @returns {{conclusion: string, detail: string|null}|null}
 *
 * Null means "this screen has no words for this", and the caller must show
 * that rather than skipping the item. An item silently dropped is a reason the
 * operator never learns we had.
 *
 * THE SUPPORTING ROLE RETURNS ONE LINE, and that is a safety property rather
 * than a layout choice. A subordinate item collapses to a single string in
 * `conclusion` with `detail` null, so a kind whose standalone headline would
 * be unsafe beneath a primary — ELIGIBILITY_CLIFF and its 5 — has no field
 * left carrying it. Returning both and trusting every caller to render the
 * right one would leave the wrong number one mistake away.
 */
export function operatorCopyFor(item, role = 'primary') {
  const entry = COPY[item?.kind];
  if (!entry) return null;

  const facts = item.facts ?? {};
  const call = (fn) => (typeof fn === 'function' ? fn(facts) : (fn ?? null));

  const conclusion = call(entry.conclusion);
  // A kind whose facts cannot fill its own headline is not phrased at all. A
  // detail with no conclusion above it would be a floating sentence.
  if (!conclusion) return null;

  if (role === 'supporting') {
    /**
     * Falls back to the CONCLUSION, never to the detail.
     *
     * A detail is written to sit under its own headline and is frequently
     * meaningless without it — POSTSEASON_RESULT's is "In the most recent
     * completed season", which as a lone bullet under a conference title says
     * nothing at all. The conclusion is self-contained by construction, so it
     * is the safe default and a kind that wants more says so in `subordinate`.
     */
    const line = call(entry.subordinate) || conclusion;
    return { conclusion: line, detail: null };
  }

  return { conclusion, detail: call(entry.detail) || null };
}

/**
 * The operator's word for a decision class.
 *
 * One word each, deliberately. These used to read "Roster opportunity",
 * "Recruitment pathway" and "Programme fit" — the same phrases the detailed
 * sections use as their headings, so the page said "Roster opportunity" both
 * as a tag on a reason and as a section title further down, and a reader could
 * not tell from the words which of the two they were looking at. The tag says
 * what KIND of reason this is; the heading says which section you are in.
 *
 * CONTEXT has no entry on purpose: the top-reasons policy never selects one,
 * so a label for it would be a promise this surface cannot keep.
 */
export const DECISION_CLASS_LABEL = Object.freeze({
  OPENING: 'Opening',
  PATHWAY: 'Pathway',
  FIT: 'Fit',
});
