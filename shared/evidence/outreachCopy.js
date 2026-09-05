import { canonicalPosition, positionNoun, positionPlural } from '../positions.js';
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

/**
 * The guards, and why every entry below opens with them.
 *
 * The docstring above has always promised that a clause returns null rather
 * than a weaker sentence. Until H1 it did not: handed an object missing a
 * field, eight of the ten entries interpolated it anyway and produced "you've
 * brought undefined players in from undefined". No live pair reached that —
 * 0 of 1,459 licensed items were missing a field they needed — but the
 * guarantee was a comment rather than code, and `count` was read by seven
 * entries while being required by none of the qualification rules.
 *
 * So each of these returns null for anything that cannot be said, and every
 * entry checks what it interpolates before it interpolates it. The failure
 * mode being engineered out is the worst-looking one there is: the word
 * "undefined" in a coach's inbox.
 */

/** A non-empty, non-blank string, or null. */
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A whole number of things, at least one of them, or null. */
const positive = (v) => (Number.isInteger(v) && v > 0 ? v : null);

/** A non-empty list of non-blank strings, or null. */
const strings = (v) => {
  if (!Array.isArray(v)) return null;
  const clean = v.map(str).filter(Boolean);
  return clean.length ? clean : null;
};

/**
 * A position the registry RECOGNISES, or null.
 *
 * `positionNoun` deliberately falls back to the raw input rather than to
 * "unknown" — right for a profile chip, wrong here, because it would put
 * whatever the roster scrape read straight into a coach's inbox. So this asks
 * `canonicalPosition`, which answers UNKNOWN for anything it does not know,
 * and refuses that.
 */
const position = (v) => (str(v) && canonicalPosition(v) !== 'UNKNOWN' ? v : null);

/** A four-digit season or class year, or null. Never a blank or a stray word. */
const year = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : null;
};

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
 * rules are the first gate and cover the same fields, so a null here should be
 * unreachable in production — which is exactly why it is implemented rather
 * than assumed. Two modules agreeing today is not a guarantee; each refusing
 * independently is.
 */
const CLAUSE = Object.freeze({
  /**
   * The coach's own record. The one claim addressed to the person reading it,
   * and the only kind that may say "you".
   */
  COACH_ARRIVAL_SAME_COUNTRY: (f) => {
    if (!str(f.country) || !positive(f.count)) return null;
    const span = when(f.seasons);
    if (str(f.namedArrival) && f.count === 1) {
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
    if (!str(f.country) || !position(f.position) || !positive(f.count)) return null;
    const span = when(f.seasons);
    if (str(f.namedArrival) && f.count === 1) {
      const y = yearPhrase(f.namedArrivalSeason);
      return `${f.namedArrival} came into the programme from ${f.country}`
        + `${y ? ` ${y}` : ''}, also a ${positionNoun(f.position)}`;
    }
    return `the programme has taken ${count(f.count)} ${noun(f.position, f.count)} `
      + `from ${f.country}${span ? ` ${span}` : ''}`;
  },

  /** Compatriots who came through. Past tense, and it stays there. */
  HISTORICAL_SAME_COUNTRY: (f) => {
    if (!str(f.country) || !positive(f.count)) return null;
    const span = when(f.seasons);
    const only = strings(f.names);
    const named = only?.length === 1 && f.count === 1 ? only[0] : null;
    if (named) {
      return `${named} came through the programme from ${f.country}${span ? ` ${span}` : ''}`;
    }
    return `${count(f.count)} ${f.count === 1 ? 'player' : 'players'} from ${f.country} `
      + `${f.count === 1 ? 'has' : 'have'} come through the programme${span ? ` ${span}` : ''}`;
  },

  /** Compatriots on the squad now. Present tense, and it stays there. */
  CURRENT_SAME_COUNTRY: (f) => {
    if (!str(f.country) || !positive(f.count)) return null;
    const named = strings(f.names);
    if (named?.length === 1) return `${named[0]}, from ${f.country}, is on your roster this season`;
    return `${count(f.count)} ${f.count === 1 ? 'player' : 'players'} from ${f.country} `
      + `${f.count === 1 ? 'is' : 'are'} on your roster this season`
      + (named ? ` (${joinNames(named)})` : '');
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
    const where = list(strings(f.countries) ?? []);
    if (!where || !position(f.position) || !positive(f.count)) return null;
    const span = when(f.seasons);
    return `the programme has taken ${count(f.count)} ${noun(f.position, f.count)} `
      + `from ${where}${span ? ` ${span}` : ''} — the same part of the world`;
  },

  HISTORICAL_SAME_REGION: (f) => {
    const where = list(strings(f.countries) ?? []);
    if (!where || !positive(f.count)) return null;
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
    const named = strings(f.names);
    if (!named || !position(f.position) || !positive(f.count) || !year(f.classYear)) return null;
    return `${count(f.count)} ${noun(f.position, f.count)} `
      + `${f.count === 1 ? 'is' : 'are'} listed to graduate in ${f.classYear}`
      + ` — ${joinNames(named)}`;
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
    const theirs = str(f.athleteStatedMajor);
    const ours = str(f.programmeMatchedSubject);
    if (!theirs || !ours) return null;
    const who = str(ctx?.firstName) ?? 'the athlete';
    // The athlete typed "exercise science"; a sentence starts it with a
    // capital. Casing only — the words stay theirs.
    const same = theirs.toLowerCase() === ours.toLowerCase();
    if (same) return `${who} is looking to study ${ours}, which you offer`;
    return `${who} is looking to study ${titleCase(theirs)}, and `
      + `${ours} is among the programmes you list`;
  },
});

/**
 * Recognition. Its own shape because it is a whole sentence, not a clause: it
 * is never joined to a claim and never becomes the reason for writing.
 */
const RECOGNITION = Object.freeze({
  CONFERENCE_TITLE: (f) => {
    if (!str(f.conference)) return null;
    const conf = conferenceLabel(f.conference);
    return conf
      ? `Congrats on winning the ${conf} last year as well — looks like a great season.`
      : 'Congrats on winning your conference last year as well.';
  },
  POSTSEASON_RESULT: (f) => {
    if (!str(f.round)) return null;
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
