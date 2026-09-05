import { positionNoun, positionPlural } from '../positions.js';
import { conferenceLabel } from '../conference.js';
import { yearPhrase, joinNames } from './render.js';

/**
 * The words an outbound email may use, for the ten kinds licensed to send.
 *
 * A SEPARATE REGISTRY FROM `render.js`, and the separation is the point rather
 * than tidiness. That module writes for three audiences at once and returns a
 * `clause` plus a `reason` — and the reason is where the unsafe sentences
 * live: "so I thought you might be open to another Kiwi", "so I thought Rhys
 * might be worth a look". Those are guesses about a stranger's intentions
 * presented as conclusions, and no amount of editing inside that shape removes
 * them, because the shape itself is "observation, therefore inference".
 *
 * ---------------------------------------------------------------------------
 * THE CLAUSE IS THE WHOLE CLAIM. THERE IS NO `reason`.
 *
 * Every entry below returns an observation and stops. What made us write is
 * the EMAIL's business, said in our own voice by the introduction — "I'm
 * reaching out about another New Zealand defender" — which is a statement
 * about us and is checkable against nothing. What a coach wants is theirs, and
 * we do not know it.
 *
 * So none of this copy may say, or let a reader infer:
 *
 *   openness      "open to another", "might be interested"
 *   preference    "you like", "you favour", "you tend to"
 *   intent        "you're recruiting", "you're looking for"
 *   need          "you need", "there's an opening", "room in the group"
 *   opportunity   playing time, minutes, a route into the side
 *   suitability   a good fit, admissions, a scholarship
 *
 * `outreachEvidence.test.js` and the corpus scan assert the absence of all of
 * it across every rendered form.
 *
 * ---------------------------------------------------------------------------
 * SECOND PERSON IS USED CAREFULLY.
 *
 * "You brought X in" is right for COACH_ARRIVAL, which is attributed to the
 * coach reading it. It is WRONG for the programme-level kinds, whose arrivals
 * span whoever was in charge — so those say "your programme" or "the
 * programme", never "you". Attributing a predecessor's signing to the reader
 * is a small error that a coach spots immediately and that costs the whole
 * email its credibility.
 *
 * NO PRONOUNS FOR THE ATHLETE. `players` stores no gender field and inferring
 * one from the sport would be a guess about a real person. The first name is
 * used instead.
 */

/** A count as a word, for the small numbers these claims carry. */
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n) => (Number.isFinite(n) && n >= 0 && n <= 10 ? WORDS[n] : String(n));

/** "A, B and C" — a list of countries, never a total. */
function list(items = []) {
  const clean = (items ?? []).filter(Boolean);
  if (!clean.length) return null;
  if (clean.length === 1) return clean[0];
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
}

/** "in 2025" / "back in 2023" / "since 2022" for a span. */
function when(seasons = []) {
  const years = [...new Set((seasons ?? []).filter(Boolean).map(String))].sort();
  if (!years.length) return '';
  return years.length > 1 ? `since ${years[0]}` : yearPhrase(years[0]);
}

const noun = (position, n) => (n === 1 ? positionNoun(position) : positionPlural(position));

/** The athlete's own words, cased for a sentence. Casing only. */
const titleCase = (v) => String(v ?? '').replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * The clause for one licensed kind, or null.
 *
 * Null means the facts cannot support a safe sentence, and the caller drops
 * the claim rather than saying something weaker. The selector's qualification
 * rules already guarantee the required fields, so a null here is a
 * belt-and-braces refusal rather than an expected path.
 */
const CLAUSE = Object.freeze({
  /**
   * The coach's own record. The one claim addressed to the person reading it,
   * and the only kind that may say "you".
   */
  COACH_ARRIVAL_SAME_COUNTRY: (f) => {
    const span = when(f.seasons);
    if (f.namedArrival && f.count === 1) {
      const y = yearPhrase(f.namedArrivalSeason);
      return `you brought ${f.namedArrival} in from ${f.country}${y ? ` ${y}` : ''}`;
    }
    return `you've brought ${count(f.count)} ${f.count === 1 ? 'player' : 'players'} `
      + `in from ${f.country}${span ? ` ${span}` : ''}`;
  },

  /**
   * The programme's arrivals at the athlete's country and position. NOT
   * attributed to the reader: these span whoever was in charge.
   */
  ARRIVAL_SAME_COUNTRY_POSITION: (f) => {
    const span = when(f.seasons);
    if (f.namedArrival && f.count === 1) {
      const y = yearPhrase(f.namedArrivalSeason);
      return `${f.namedArrival} came into the programme from ${f.country}`
        + `${y ? ` ${y}` : ''}, also a ${positionNoun(f.position)}`;
    }
    return `the programme has taken ${count(f.count)} ${noun(f.position, f.count)} `
      + `from ${f.country}${span ? ` ${span}` : ''}`;
  },

  /** Compatriots who came through. Past tense, and it stays there. */
  HISTORICAL_SAME_COUNTRY: (f) => {
    const span = when(f.seasons);
    const named = f.names?.length === 1 && f.count === 1 ? f.names[0] : null;
    if (named) {
      return `${named} came through the programme from ${f.country}${span ? ` ${span}` : ''}`;
    }
    return `${count(f.count)} ${f.count === 1 ? 'player' : 'players'} from ${f.country} `
      + `${f.count === 1 ? 'has' : 'have'} come through the programme${span ? ` ${span}` : ''}`;
  },

  /** Compatriots on the squad now. Present tense, and it stays there. */
  CURRENT_SAME_COUNTRY: (f) => {
    const named = f.names?.length === 1 ? f.names[0] : null;
    if (named) return `${named}, from ${f.country}, is on your roster this season`;
    return `${count(f.count)} ${f.count === 1 ? 'player' : 'players'} from ${f.country} `
      + `${f.count === 1 ? 'is' : 'are'} on your roster this season`
      + (f.names?.length ? ` (${joinNames(f.names)})` : '');
  },

  /**
   * A regional arrival. The countries are named and the wider cut is stated,
   * because a coach reading "Australia" under an introduction about a New
   * Zealander would otherwise read it as the same country.
   *
   * IT NAMES THE COUNTRIES IT SAW AND NOT THE ATHLETE'S.
   *
   * `excludingCountry` is on the facts and is deliberately NOT printed. Saying
   * "though not New Zealand itself" is honest but volunteers a negative nobody
   * asked for, and it puts a country in the email that this programme has no
   * connection to — a bulk batch then has one coach's message naming another
   * coach's country. "The same part of the world" carries the distinction, and
   * the introduction two lines down says where the athlete is actually from.
   */
  ARRIVAL_SAME_REGION_POSITION: (f) => {
    const span = when(f.seasons);
    const where = list(f.countries);
    return `the programme has taken ${count(f.count)} ${noun(f.position, f.count)} `
      + `from ${where}${span ? ` ${span}` : ''} — the same part of the world`;
  },

  HISTORICAL_SAME_REGION: (f) => {
    const where = list(f.countries);
    return `${count(f.count)} ${f.count === 1 ? 'player' : 'players'} from ${where} `
      + `${f.count === 1 ? 'has' : 'have'} come through the programme — the same part of `
      + 'the world';
  },

  /**
   * The graduating cohort, named and dated.
   *
   * NO OPPORTUNITY LANGUAGE. Not opening, room, gap, replacement or minutes —
   * a stranger telling a coach what their roster needs is the sentence this
   * whole surface exists to prevent. The names and the year are checkable
   * against their own roster, and the fact does the work.
   */
  POSITION_GRADUATION: (f) => {
    const names = joinNames(f.names ?? []);
    return `${count(f.count)} ${noun(f.position, f.count)} `
      + `${f.count === 1 ? 'is' : 'are'} listed to graduate in ${f.classYear}`
      + `${names ? ` — ${names}` : ''}`;
  },

  /**
   * BOTH LABELS, KEPT APART.
   *
   * The athlete typed "exercise science"; the college's catalogue calls it
   * "Kinesiology". The live email printed one in the introduction and the
   * other in the evidence, four lines apart, so a coach read two different
   * subjects. Said as one sentence they read as what they are — a match
   * between the athlete's words and the programme's listing — and neither is
   * asserted to BE the other. When they happen to be the same word the copy
   * says it once rather than echoing.
   */
  ACADEMIC_FIT: (f, ctx) => {
    const who = ctx?.firstName ?? 'the athlete';
    // The athlete typed "exercise science"; a sentence starts it with a
    // capital. Casing only — the words stay theirs.
    const stated = titleCase(f.athleteStatedMajor);
    const same = String(f.athleteStatedMajor).trim().toLowerCase()
      === String(f.programmeMatchedSubject).trim().toLowerCase();
    if (same) return `${who} is looking to study ${f.programmeMatchedSubject}, which you offer`;
    return `${who} is looking to study ${stated}, and `
      + `${f.programmeMatchedSubject} is among the programmes you list`;
  },
});

/**
 * Recognition. Its own shape because it is a whole sentence, not a clause: it
 * is never joined to a claim and never becomes the reason for writing.
 */
const RECOGNITION = Object.freeze({
  CONFERENCE_TITLE: (f) => {
    const conf = conferenceLabel(f.conference);
    return conf
      ? `Congrats on winning the ${conf} last year as well — looks like a great season.`
      : 'Congrats on winning your conference last year as well.';
  },
  POSTSEASON_RESULT: (f) => {
    const ROUND = {
      champion: 'the national title', final: 'reaching the national final',
      semi: 'reaching the semi-finals', quarter: 'reaching the quarter-finals',
      r16: 'reaching the round of 16', r32: 'reaching the round of 32',
      appearance: 'getting to the postseason',
    };
    const what = ROUND[f.round];
    return what ? `Congrats on ${what} last season as well.` : null;
  },
});

/** The kinds this module has words for. Checked against the licence by tests. */
export const OUTREACH_COPY_KINDS = Object.freeze(
  [...Object.keys(CLAUSE), ...Object.keys(RECOGNITION)],
);

/**
 * The sentence part for one selected outreach item.
 *
 * @param {{kind, role, facts}} item  one entry from `outreachEvidenceFor`
 * @param {object} ctx  { firstName } — the athlete's first name, for the one
 *   clause that needs it. Never a pronoun.
 * @returns {{clause}|{recognition}|null}
 */
export function outreachCopyFor(item, ctx = {}) {
  if (!item?.kind) return null;
  if (RECOGNITION[item.kind]) {
    const recognition = RECOGNITION[item.kind](item.facts ?? {});
    return recognition ? { recognition } : null;
  }
  const write = CLAUSE[item.kind];
  if (!write) return null;
  const clause = write(item.facts ?? {}, ctx);
  return clause ? { clause } : null;
}
