/**
 * Turning evidence into truthful language, and the wall between the two tiers.
 *
 * There are two maps and they are never merged. A FACT kind has an entry in
 * FACT_COPY; a SIGNAL kind has one in SIGNAL_COPY; no kind has both.
 * `renderFact` refuses anything whose tier is not FACT and refuses anything
 * absent from its own map, so there is no route by which a projection acquires
 * a plain declarative sentence — not by a generator setting a field, not by a
 * template author picking the wrong helper, not by a new kind being added and
 * its tier being forgotten.
 *
 * That refusal is a thrown error rather than a silent fallback on purpose. A
 * fallback would mean the failure shows up as a slightly-wrong email in a
 * coach's inbox weeks later; an exception shows up in the test run.
 *
 * ---------------------------------------------------------------------------
 * CLAUSE AND REASON, not finished sentences.
 *
 * Every entry returns parts rather than prose:
 *
 *   clause   the observation, in the words the data supports.
 *            "you've got three defenders graduating in 2027"
 *   reason   why it made us write, in OUR voice, never a claim about them.
 *            "I thought Rhys could be worth putting on your radar"
 *
 * The framing around them — "I saw …", "I was having a look through your
 * program and noticed …" — is NOT here, because the same observation is framed
 * differently depending on whether it opens the email or follows the
 * introduction. That is a placement decision and belongs to composition.
 *
 * This replaced a `{ lead, support }` pair in which the clause was written out
 * twice per kind. The two copies had already drifted once.
 *
 * ---------------------------------------------------------------------------
 * THE LINE ON INTERPRETATION.
 *
 * A `reason` may say why WE are writing. It may never say what the COACH
 * needs. "so I thought Rhys could be worth putting on your radar" is our
 * reasoning and is checkable against nothing; "so you'll need another defender
 * next year" is a claim about their squad that no roster row supports.
 * `render.test.js` asserts this mechanically against a list of forbidden
 * constructions, across every part of every kind.
 *
 * The SIGNAL hedges are unchanged in force and live in the CLAUSE, where the
 * uncertainty actually is: "going off last season's minutes", "from what I can
 * see", "looks like", "around". The underlying numbers are projections and
 * ratios, and a coach who checks must find them approximately right rather
 * than exactly right.
 *
 * ---------------------------------------------------------------------------
 * NO PRONOUNS FOR THE ATHLETE, anywhere in this file.
 *
 * `players` stores no gender or pronoun field, and inferring one from the
 * sport would be a guess about a real person that is wrong for anyone it is
 * wrong for. The athlete's first name is used instead, which reads naturally
 * and cannot misgender anybody.
 */

import { positionNoun, positionPlural } from '../positions.js';
import { TIERS } from './kinds.js';
import { conferenceLabel } from '../conference.js';

/** "A", "A and B", "A, B and C" — the Oxford comma left off, as the templates do. */
export function joinNames(names = []) {
  const list = names.filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

const countWord = (n) => (
  ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n)
);

/**
 * The short form, used once the country has already been named.
 *
 * "another Kiwi" after "come through from New Zealand" is how a person writes
 * it; "another player from New Zealand" is how a mail merge does. Only for
 * countries where the demonym is genuinely common in this context — an unknown
 * country falls back to naming it.
 */
const DEMONYM = { 'New Zealand': 'Kiwi', Australia: 'Aussie' };

const peopleFrom = (country, n) => {
  const demonym = DEMONYM[country];
  if (!demonym) return `${countWord(n)} player${n === 1 ? '' : 's'} from ${country}`;
  return `${countWord(n)} ${demonym}${n === 1 ? '' : 's'}`;
};

/**
 * Round names for a congratulation, which reads differently from a statement.
 * "congrats on the run to the semifinals" rather than "you reached the
 * semifinals" — the same fact, said the way it would be said out loud.
 */
const POSTSEASON_CONGRATS = {
  appearance: 'getting to the postseason',
  r32: 'the run to the Round of 32',
  r16: 'the run to the Round of 16',
  quarter: 'the run to the quarterfinals',
  semi: 'the run to the semifinals',
  final: 'reaching the championship game',
  champion: 'the national championship',
};

const firstSeason = (ev) => String(ev.season || '').split('-')[0] || null;

/**
 * How many names may appear in one clause. Three — four inside brackets reads
 * as a printout rather than as something a person noticed.
 */
const NAME_CEILING = 3;
const named = (names = []) => {
  const list = names.filter(Boolean);
  return list.length && list.length <= NAME_CEILING ? list : null;
};

/**
 * Where an international count stops being informative and starts being a
 * readout. Ten, because below it the number is small enough that a coach
 * recognises it as their own squad and above it nobody counts.
 */
const INTERNATIONAL_MANY = 10;

/**
 * The athlete's first name, or a phrasing that does not need one.
 *
 * A renderer must never print "undefined could be worth a look", and the
 * evidence route renders previews with no athlete context at all. `withName`
 * makes the caller state the alternative rather than a helper guessing one.
 */
const withName = (ctx, withIt, without) => (ctx?.firstName ? withIt(ctx.firstName) : without);

/**
 * Plain, checkable observations. FACT kinds only.
 *
 * Each clause must be verifiable by the coach against their own roster or
 * record — that is still the test for whether copy belongs in this map.
 */
const FACT_COPY = Object.freeze({
  HISTORICAL_SAME_COUNTRY: (d, ev) => {
    const who = named(d.names);
    const since = firstSeason(ev);
    const demonym = DEMONYM[d.country];
    const when = since ? ` back in ${since}` : '';
    return {
      // One named player is the strongest version of this: the coach
      // recognises the name and knows immediately that somebody actually
      // looked rather than ran a query.
      clause: d.count === 1 && who
        ? `you've had ${who[0]} come through from ${d.country}${when}`
        : `you've had ${peopleFrom(d.country, d.count)} come through the program${since ? ` since ${since}` : ''}${who ? ` (${joinNames(who)})` : ''}`,
      reason: `I thought you might be open to another${demonym ? ` ${demonym}` : ''}`,
    };
  },

  CURRENT_SAME_COUNTRY: (d) => {
    const who = named(d.names);
    const demonym = DEMONYM[d.country];
    const one = d.count === 1 && demonym ? `a ${demonym}` : peopleFrom(d.country, d.count);
    return {
      clause: `you've already got ${one} on the roster${who ? ` in ${joinNames(who)}` : ''}`,
      reason: 'I thought you might be open to another',
      framing: 'I noticed',
    };
  },

  HISTORICAL_SAME_REGION: (d, ev) => {
    const since = firstSeason(ev);
    const where = d.countries.length === 1 ? d.countries[0] : joinNames(d.countries);
    const howMany = d.count === 1 ? 'a player' : `${countWord(d.count)} players`;
    return {
      clause: `you've had ${howMany} from ${where} come through${since ? ` back in ${since}` : ''}`,
      reason: 'I thought you might be open to more players from this part of the world',
    };
  },

  INTERNATIONAL_ROSTER: (d) => {
    const many = d.count >= INTERNATIONAL_MANY;
    return {
      clause: many
        ? "you've got a pretty international squad already"
        : `you've got ${countWord(d.count)} internationals on the roster`,
      reason: 'it made me think a player from overseas wouldn\'t be unfamiliar territory',
      // Used when this is the ONE item following the opening sentence, where
      // "I also noticed X." reads flatter than a sentence with its own point.
      alsoSentence: many
        ? "You've also got a pretty international squad, which made me think it was worth reaching out."
        : `You've also got ${countWord(d.count)} internationals on the roster, which made me think it was worth reaching out.`,
    };
  },

  // The COUNT of who is leaving is a roster fact. Whether they were starters
  // is not, and lives in the signal map below.
  POSITION_GRADUATION: (d, ev, ctx) => {
    const noun = d.count === 1 ? positionNoun(d.position) : positionPlural(d.position);
    const who = named(d.names);
    return {
      clause: `you've got ${countWord(d.count)} ${noun} graduating${d.classYear ? ` in ${d.classYear}` : ''}${who ? ` (${joinNames(who)})` : ''}`,
      reason: withName(ctx, (n) => `I thought ${n} could be worth putting on your radar`,
        'I thought it was worth getting in touch'),
    };
  },

  SQUAD_GRADUATION: (d) => ({
    clause: `you've got ${countWord(d.total)} ${d.total === 1 ? 'player' : 'players'} graduating across the squad${d.classYear ? ` in ${d.classYear}` : ''}`,
    reason: 'I thought it was worth getting in touch',
  }),

  // Internal-only in the registry, so this never reaches an email. Kept
  // because the operator view renders it.
  POSITION_GROUP_SIZE: (d) => ({
    clause: `you've got ${countWord(d.count)} ${d.count === 1 ? positionNoun(d.position) : positionPlural(d.position)} on the roster`,
    reason: 'it seemed worth noting',
  }),

  /**
   * Recognition, not an observation.
   *
   * A whole sentence, never a clause inside somebody else's, and never the
   * opening line: congratulating a stranger before saying why you wrote is the
   * oldest move in cold outreach. Placed after the relevance reasoning, where
   * it reads as attention paid.
   */
  CONFERENCE_TITLE: (d) => {
    const conf = conferenceLabel(d.conference);
    return {
      recognition: conf
        ? `Congrats on winning the ${conf} last year as well — looks like a great season.`
        : 'Congrats on winning your conference last year as well.',
    };
  },

  POSTSEASON_RESULT: (d) => ({
    recognition: `Congrats on ${POSTSEASON_CONGRATS[d.round] || 'getting to the postseason'} last season as well.`,
  }),

  ACADEMIC_FIT: (d, ev, ctx) => ({
    clause: `you offer ${d.major}`,
    // The reason changes when the introduction has already said what the
    // athlete plans to study — otherwise the email says it twice in two
    // sentences.
    reason: ctx?.academicIntro
      ? 'it looked like a good fit on that side too'
      : withName(ctx, (n) => `it lines up with what ${n} wants to study`,
        'it lines up with what this athlete wants to study'),
    // The clause is bare inside the academic flow, whose introduction has
    // already said what the athlete plans to study; elsewhere it carries the
    // connection, or the fact is just trivia about the university.
    tail: ctx?.academicIntro
      ? ''
      : withName(ctx, (n) => `, which lines up with what ${n} wants to study`, ''),
  }),
});

/**
 * Hedged observations. SIGNAL kinds.
 *
 * The hedge lives in the clause, where the uncertainty is. Every one of these
 * has to survive being wrong.
 */
const SIGNAL_COPY = Object.freeze({
  INTERNATIONAL_SHARE: (d) => ({
    clause: `a fair bit of your squad looks to be international, somewhere around ${Math.round(d.share * 100)}%`,
    reason: 'it made me think recruiting from overseas is probably familiar ground',
  }),

  // "Going off last season's minutes" is doing the essential work. The season
  // being recruited into has not been played, so starter status here is
  // carried forward from an earlier one and must say so.
  POSITION_GRADUATION_STARTERS: (d) => {
    const noun = d.count === 1 ? positionNoun(d.position) : positionPlural(d.position);
    return {
      clause: `going off last season's minutes, ${countWord(d.count)} of those ${noun} looked to be starting regularly`,
      reason: 'it seemed worth mentioning',
      // The clause opens with its own adverbial, so a framing in front of it
      // reads "I saw going off last season's minutes, …". Composition states
      // it directly instead.
      selfFramed: true,
    };
  },

  POSITION_GROUP_SCARCITY: (d, ev, ctx) => ({
    clause: `your ${positionNoun(d.position)} group looks a little light from the outside`,
    reason: withName(ctx, (n) => `I thought ${n} might be worth a look`,
      'it seemed worth getting in touch'),
  }),

  // Names the position for the same reason SQUAD_GRADUATION names the year:
  // this can be the only roster evidence selected, and "that group" would then
  // refer to nothing the coach has been told.
  RETURNING_POSITION_DEPTH: (d) => {
    const noun = d.returning === 1 ? positionNoun(d.position) : positionPlural(d.position);
    return {
      clause: `by ${d.classYear} it looks like around ${countWord(d.returning)} ${noun} would still be eligible`,
      reason: 'it seemed worth mentioning',
    };
  },

  ELIGIBILITY_CLIFF: (d) => ({
    clause: `a few of your ${positionPlural(d.position)} look like they run out of eligibility around the same time`,
    reason: 'it seemed worth mentioning',
  }),

  /**
   * The reason deliberately does not say "it caught my eye".
   *
   * Framed for the relevance slot it produced "I was having a look through
   * your program and noticed your results have been trending up, so it caught
   * my eye" — the reason restating the framing, which reads as padding.
   */
  PROGRAM_MOMENTUM: (d) => ({
    clause: d.classification === 'RISING'
      ? "your results look like they've been trending up the last couple of seasons"
      : "you've been consistently strong the last couple of seasons",
    reason: 'it felt like a good time to get in touch',
  }),

  // Never prints an appointment year when the tenure is window-bounded: the
  // first season we observed is not the year the coach started, and
  // coachTenure.js refuses to guess which it was.
  COACH_CONTEXT: (d, ev, ctx) => ({
    clause: d.windowBounded
      ? `you've been building the program over at least ${countWord(d.seasonsObserved)} seasons`
      : (d.seasonsObserved === 1
        ? "you're in your first season there"
        : `you're ${countWord(d.seasonsObserved)} seasons into the job`),
    reason: withName(ctx, (n) => `I thought it was worth introducing ${n}`,
      'I thought it was worth getting in touch'),
  }),

  // Internal-only in the registry; never rendered into an email.
  TRANSFER_BEHAVIOUR: (d) => ({
    clause: `you've brought in ${countWord(d.arrivals)} players from other programmes`,
    reason: 'it seemed worth noting',
  }),
});

export class EvidenceRenderError extends Error {}

/** Default framing for an opening sentence; a kind may override it. */
export const DEFAULT_HOOK_FRAMING = 'I saw';

/** Framing for the first observation AFTER the athlete has been introduced. */
export const RELEVANCE_FRAMING = 'I was having a look through your program and noticed';

function partsFrom(map, ev, ctx) {
  const fn = map[ev.kind];
  if (!fn) return null;
  const out = fn(ev.data, ev, ctx || {});
  if (!out || (typeof out.clause !== 'string' && typeof out.recognition !== 'string')) {
    throw new EvidenceRenderError(`${ev.kind} copy must return { clause, reason } or { recognition }`);
  }
  return out;
}

/**
 * The parts for one piece of evidence, gated on its tier.
 *
 * This is the enforcement point: a SIGNAL cannot reach the FACT map, and it
 * cannot because this checks the tier that kinds.js set and that nothing
 * downstream can change. Decomposing sentences into parts did not move that
 * check — the parts are still two ways of saying one thing, both gated here.
 */
export function factParts(ev, ctx = {}) {
  if (!ev) throw new EvidenceRenderError('factParts called with no evidence');
  if (ev.tier !== TIERS.FACT) {
    throw new EvidenceRenderError(
      `${ev.kind} is ${ev.tier} evidence and cannot be rendered as a statement of fact. `
      + 'Use signalParts, or change its tier in shared/evidence/kinds.js if it really is a fact.',
    );
  }
  const parts = partsFrom(FACT_COPY, ev, ctx);
  if (!parts) throw new EvidenceRenderError(`No fact copy registered for ${ev.kind}`);
  return parts;
}

/**
 * The same, hedged. Accepts a FACT as well as a SIGNAL, and that asymmetry is
 * deliberate: stating a fact more softly than it deserves costs a little force
 * and cannot mislead, while the reverse is the failure this module prevents.
 */
export function signalParts(ev, ctx = {}) {
  if (!ev) throw new EvidenceRenderError('signalParts called with no evidence');
  const parts = partsFrom(SIGNAL_COPY, ev, ctx) ?? partsFrom(FACT_COPY, ev, ctx);
  if (!parts) throw new EvidenceRenderError(`No copy registered for ${ev.kind}`);
  return parts;
}

/**
 * Parts by the evidence's own tier — the normal entry point for composition.
 *
 * @param {object} [ctx.firstName]     the athlete's first name, for reasons
 *   that explain why this programme made us think of THIS player.
 * @param {boolean} [ctx.academicIntro] whether the introduction already named
 *   the athlete's subject, so the academic clause can stop repeating it.
 */
export function evidenceParts(ev, ctx = {}) {
  return ev.tier === TIERS.FACT ? factParts(ev, ctx) : signalParts(ev, ctx);
}

/** Whether this kind is a programme congratulation rather than an observation. */
export function isRecognition(ev, ctx = {}) {
  return typeof evidenceParts(ev, ctx).recognition === 'string';
}

const cap = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

/**
 * One piece of evidence as a standalone sentence.
 *
 * For previews — the operator panel, the CLI, a log of what was considered —
 * where each item is read on its own rather than in a composed paragraph. The
 * email's own text comes from composition, which frames and joins these parts
 * according to where they land.
 */
export function renderEvidence(ev, ctx = {}) {
  const p = evidenceParts(ev, ctx);
  if (p.recognition) return p.recognition;
  if (p.selfFramed) return `${p.clause[0].toUpperCase()}${p.clause.slice(1)}, so ${p.reason}.`;
  const framing = p.framing ?? DEFAULT_HOOK_FRAMING;
  return `${framing} ${p.clause}, so ${p.reason}.`;
}

/** The observation alone, capitalised as its own sentence. */
export function renderSentence(ev, ctx = {}) {
  const p = evidenceParts(ev, ctx);
  return p.recognition ?? `${cap(p.clause)}.`;
}

/** Which kinds have copy written for them — used by the coverage test. */
export const RENDERABLE_KINDS = Object.freeze([
  ...Object.keys(FACT_COPY),
  ...Object.keys(SIGNAL_COPY),
]);
