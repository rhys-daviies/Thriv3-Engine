import { canonicalPosition } from '../positions.js';
import { conferenceLabel } from '../conference.js';
import { SQUAD_SEASON } from '../philosophy.js';

/**
 * WHAT AN OUTBOUND CLAIM MUST CARRY, DECLARED ONCE.
 *
 * Two modules used to answer this question separately and in different
 * vocabularies. `outreachEvidence.js` asked its `satisfied` rule of the raw
 * generator fields — `d.stated`, `d.name`, `d.athleteCountry`. `outreachCopy.js`
 * asked its own guards of the renamed projection — `athleteStatedMajor`,
 * `namedArrival`, `excludingCountry`. Nothing kept the two lists in step, and
 * they were not in step: measured across sixteen value cases, FOURTEEN were
 * accepted by the qualification rule and refused by the copy.
 *
 *   position "Utility"      qualification asked Boolean(position)
 *                           copy asked whether the registry knows it
 *   classYear "senior"      qualification asked != null
 *                           copy asked for a four-digit year
 *   round "third-round"     qualification asked Boolean(round)
 *                           copy asked for one of seven it has words for
 *   country "   "           qualification asked Boolean
 *                           copy asked for a non-blank string
 *
 * None of those reached a coach: the composer drops a block whose clause is
 * null, so the email came out shorter rather than wrong, and no live object
 * hit any of them. But the selector had already recorded the claim as SELECTED
 * and counted the email as personalised — so the failure mode was an email
 * reporting a claim it did not make, and it was one bad roster value away.
 *
 * ---------------------------------------------------------------------------
 * THE RENDER VOCABULARY IS THE CONTRACT'S VOCABULARY.
 *
 * `facts` below is the ONE translation from generator fields to the names a
 * sentence is written in, and `requires` is stated in the translated names. So
 * a field cannot be required under one name and read under another: there is
 * only one name by the time either layer sees it.
 *
 * FOUR LAYERS, STILL FOUR ANSWERS. This module answers only the third:
 *
 *   permission     may this kind ever appear in an email?   the registry
 *   role           where in the email may it appear?        ROLE_OF
 *   qualification  does THIS object carry enough to say it? here
 *   copy           how is it said?                          outreachCopy.js
 *
 * It holds no words and no policy about worth. It says what must be present
 * and usable, and both layers ask it rather than each other.
 */

/** A non-empty, non-blank string, or null. */
export const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A whole number of things, at least one of them, or null. */
export const positive = (v) => (Number.isInteger(v) && v > 0 ? v : null);

/** A non-empty list of non-blank strings, or null. */
export const strings = (v) => {
  if (!Array.isArray(v)) return null;
  const clean = v.map(str).filter(Boolean);
  return clean.length ? clean : null;
};

/**
 * A position the registry RECOGNISES, or null.
 *
 * `positionNoun` deliberately falls back to the raw input rather than to
 * "unknown" — right for a profile chip, wrong for an email, because it would
 * put whatever the roster scrape read straight into a coach's inbox. So this
 * asks `canonicalPosition`, which answers UNKNOWN for anything it does not
 * know, and refuses that.
 */
export const position = (v) => (str(v) && canonicalPosition(v) !== 'UNKNOWN' ? v : null);

/**
 * How far back a regional claim may reach, in seasons.
 *
 * J3 measured what the region hooks were opening with. The surviving one —
 * region AND position — rendered 75 emails, and 30 of them reached back to
 * 2023 or 2024: "the programme has taken one forward from Australia back in
 * 2023" is a three-year-old signing from a country that is not the athlete's,
 * used as the reason for writing today. Two seasons is the window in which a
 * squad still contains the people it describes.
 *
 * Deliberately applied ONLY to the regional claim. A compatriot is a
 * compatriot whenever they came through, and the same-country kinds are not
 * reaching for the connection.
 */
export const REGION_RECENCY_SEASONS = 2;

/**
 * A season list whose most recent entry is inside that window, or null.
 *
 * Requires the seasons to be there at all, which is the other half of what J3
 * found: `HISTORICAL_SAME_REGION` carried its span on the evidence object and
 * never in `data`, so its copy had nothing to print and said nothing. A
 * regional claim with no date does not qualify — there is no vague form of it
 * to fall back to.
 */
/**
 * The seasons inside the recency window, ascending. DISPLAY ONLY.
 *
 * K2 found the copy printing the OLDEST season a programme had ever recruited
 * from while the rule admitted the claim on the NEWEST — "since 2023" on a row
 * that qualified on 2026, in 86 of 132 rendered clauses. The sentence was
 * hiding its own justification.
 *
 * Deliberately NOT reused inside `recentSeasons`, and this is the important
 * part: the two would disagree on a season list containing a future year.
 * `recentSeasons` takes the max and refuses a negative age, so one broken row
 * dated 2027 fails the whole claim; this returns the valid years and would
 * pass it. That difference is a QUALIFICATION change, and K3C is not allowed to
 * make one. The validator keeps its exact behaviour; this only decides what a
 * claim that already qualified is allowed to print.
 */
export const seasonsInWindow = (v) => {
  const now = Number(SQUAD_SEASON);
  return (Array.isArray(v) ? v : [])
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isInteger(n) && n >= 1900 && n <= 2100)
    .filter((n) => Number.isFinite(now) && now - n >= 0 && now - n <= REGION_RECENCY_SEASONS)
    .sort((a, b) => a - b)
    .filter((n, i, xs) => xs.indexOf(n) === i);
};

export const recentSeasons = (v) => {
  const years = (Array.isArray(v) ? v : []).map((x) => Number(String(x).trim()))
    .filter((n) => Number.isInteger(n) && n >= 1900 && n <= 2100);
  if (!years.length) return null;
  const newest = Math.max(...years);
  const age = Number(SQUAD_SEASON) - newest;
  // Bounded on BOTH sides. A negative age is a season that has not happened,
  // which is a broken row rather than a very recent arrival — and an unbounded
  // "<= 2" would have welcomed it as the most recent thing we know.
  return age >= 0 && age <= REGION_RECENCY_SEASONS ? v : null;
};

/** A four-digit season or class year, or null. Never a blank or a stray word. */
export const year = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : null;
};

/**
 * The postseason rounds an email has words for.
 *
 * Declared here rather than beside the words, because "which rounds may be
 * claimed" is the contract's question and "what each is called" is the copy's.
 * `outreachCopy.js` asserts at load that it has a phrase for exactly these —
 * a round added to one list and not the other fails immediately instead of
 * qualifying a claim that renders as nothing.
 */
/**
 * A conference we can name in a sentence, or null.
 *
 * `conferenceLabel` FORMATS rather than resolves — there is no table of
 * conferences and so no unknown-key case. It strips the "-D3" tag two rows
 * carry to disambiguate our own data, and the one thing it can return is an
 * empty string, for a stored value that is nothing but a tag. A congratulation
 * we cannot address is refused here rather than softened in the copy.
 */
const conference = (v) => (str(v) && conferenceLabel(v).trim() ? v : null);

export const POSTSEASON_ROUNDS = Object.freeze([
  'champion', 'final', 'semi', 'quarter', 'r16', 'r32', 'appearance',
]);
const round = (v) => (POSTSEASON_ROUNDS.includes(v) ? v : null);

/**
 * Per kind: the translation into render vocabulary, and what must survive it.
 *
 * `facts` is deliberately narrow. The arrival kinds carry a `provenance` blob
 * holding identity-matching internals, coach attribution methods and the raw
 * REGION key — none of which may travel to a coach by any route, so none of it
 * is projected and no renderer can reach it.
 */
const CONTRACT = Object.freeze({
  COACH_ARRIVAL_SAME_COUNTRY: {
    facts: (d) => ({
      coach: d.coach, country: d.country, count: d.count,
      seasons: d.seasons ?? [], namedArrival: d.name ?? null, namedArrivalSeason: d.nameSeason ?? null,
    }),
    /**
     * `coach` is required and never printed. The sentence says "you brought X
     * in" — attributed to the person reading it — so an arrival we cannot
     * attribute is a different claim, and this is the only kind that may say
     * "you".
     */
    requires: { coach: str, country: str, count: positive },
  },

  ARRIVAL_SAME_COUNTRY_POSITION: {
    facts: (d) => ({
      country: d.country, position: d.position, count: d.count,
      seasons: d.seasons ?? [], namedArrival: d.name ?? null, namedArrivalSeason: d.nameSeason ?? null,
    }),
    requires: { country: str, position, count: positive },
  },

  HISTORICAL_SAME_COUNTRY: {
    facts: (d) => ({
      country: d.country, count: d.count, names: d.names ?? [], seasons: d.seasons ?? [],
    }),
    requires: { country: str, count: positive },
  },

  CURRENT_SAME_COUNTRY: {
    facts: (d) => ({ country: d.country, count: d.count, names: d.names ?? [] }),
    requires: { country: str, count: positive },
  },

  ARRIVAL_SAME_REGION_POSITION: {
    /**
     * Q-REGION. Sayable only as the countries it actually covers, at the
     * position it was cut to. OCEANIA is a bucket key from the recruiting
     * tables; a coach reading it would learn nothing and we would have printed
     * a database constant at them. The countries are checkable against their
     * own roster.
     */
    facts: (d) => ({
      // No `region`, and no `provenance`.
      countries: d.countries, position: d.position, count: d.count,
      seasons: d.seasons ?? [], namedArrival: d.name ?? null, namedArrivalSeason: d.nameSeason ?? null,
      // The seasons that actually admitted the claim, which is what the
      // sentence must name. `seasons` stays whole for anything reasoning about
      // the full history.
      qualifyingSeasons: seasonsInWindow(d.seasons ?? []),
      // What makes the claim honest: this is a WIDER cut than the athlete's
      // own country, and copy that omitted that would let a coach read a row
      // about Australia as a row about a New Zealander.
      widerThanOwnCountry: true,
      excludingCountry: d.athleteCountry ?? null,
    }),
    /**
     * The season is REQUIRED here and optional on every other kind, because
     * this is the one claim whose whole justification is that it is recent.
     * Region and position are a real conjunction; region, position and "at
     * some point" is a stretch, and J3 chose not to send stretches.
     */
    requires: { countries: strings, position, count: positive, seasons: recentSeasons },
  },

  POSITION_GRADUATION: {
    /**
     * Q-CONCRETE. Named players and a stated class year, never a bare count.
     *
     * "Three defenders are graduating" invites the coach to finish the
     * sentence themselves — and the ending they will reach for is "so you need
     * one". Naming them and dating the cohort keeps it an observation they can
     * check against their own roster, which is a different kind of sentence.
     */
    facts: (d) => ({
      position: d.position, count: d.count, names: d.names ?? [], classYear: d.classYear,
    }),
    requires: { position, count: positive, names: strings, classYear: year },
  },

  ACADEMIC_FIT: {
    /**
     * Q-TWO-LABELS. Both the athlete's own words and the programme's subject,
     * kept apart.
     *
     * `majorLabelFor` maps "exercise science" onto the canonical bucket
     * "Kinesiology". The live email once printed the athlete's phrase in the
     * introduction and the bucket in the evidence, four lines apart, so a coach
     * read two different subjects. Both are on the object, so the fix was a
     * copy contract and not an upstream change — and both stay required, under
     * names that cannot be mistaken for each other.
     */
    facts: (d) => ({ athleteStatedMajor: d.stated, programmeMatchedSubject: d.major }),
    requires: { athleteStatedMajor: str, programmeMatchedSubject: str },
  },

  CONFERENCE_TITLE: {
    facts: (d) => ({ conference: d.conference }),
    requires: { conference },
  },

  POSTSEASON_RESULT: {
    facts: (d) => ({ round: d.round }),
    requires: { round },
  },
});

/** The kinds that have an outbound render contract. */
export const CONTRACT_KINDS = Object.freeze(Object.keys(CONTRACT));

/** Whether a kind has one at all — the load-time guard both layers use. */
export const hasContract = (kind) => Boolean(CONTRACT[kind]);

/**
 * The field names one kind requires, in render vocabulary. For tests and for
 * the audit; nothing in the production path needs the list itself.
 */
export const requiredFields = (kind) => Object.freeze(Object.keys(CONTRACT[kind]?.requires ?? {}));

/**
 * Are these facts complete enough to write the claim?
 *
 * The whole check, asked by BOTH layers. Note what it does not do: it never
 * repairs, coerces or substitutes. A field that fails its validator makes the
 * claim unsayable, and the answer is no.
 */
export function renderable(kind, facts) {
  const spec = CONTRACT[kind];
  if (!spec || !facts) return false;
  for (const [field, valid] of Object.entries(spec.requires)) {
    if (valid(facts[field]) == null) return false;
  }
  return true;
}

/**
 * Generator data in, render input out — or null if it cannot be said.
 *
 * The one place raw fields become sentence fields. A caller that gets null has
 * its answer and must not look for a weaker way to say the claim: that is what
 * qualification failing means.
 */
export function renderInput(kind, data = {}) {
  const spec = CONTRACT[kind];
  if (!spec) return null;
  const facts = spec.facts(data ?? {});
  return renderable(kind, facts) ? facts : null;
}
