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
import { SQUAD_SEASON, nameKey } from '../philosophy.js';

/**
 * How far back a season has to be before "back in" is the right words.
 *
 * "Back in 2026" was being written about a player who joined for the season
 * that has not been played yet, and "back in 2025" about one who arrived a
 * year ago — both read as though we had not looked at a calendar. Two seasons
 * is where the distance starts to feel like distance.
 *
 * Measured against SQUAD_SEASON rather than the wall clock. The engine already
 * pins every present-tense claim to that season, and a draft saved in Outlook
 * for three weeks must say the same thing when it is sent as when it was
 * written — which a relative phrase like "this year" could not promise.
 */
export const BACK_IN_DISTANCE = 2;

/**
 * "in 2025" or "back in 2023", by distance from the pinned squad season.
 *
 * Returns an empty string for a missing or unparseable year, so a caller can
 * append it unconditionally without ever printing "back in undefined".
 */
export function yearPhrase(year, { squadSeason = SQUAD_SEASON } = {}) {
  // `Number(null)` is 0 and `Number('')` is 0, both of which are finite — so
  // the emptiness check has to come before the numeric one, or a missing
  // season renders as "back in 0".
  if (year === null || year === undefined || String(year).trim() === '') return '';
  const y = Number(year);
  const now = Number(squadSeason);
  if (!Number.isFinite(y)) return '';
  if (!Number.isFinite(now)) return `in ${year}`;
  return now - y >= BACK_IN_DISTANCE ? `back in ${y}` : `in ${y}`;
}

/**
 * People this email has already talked about.
 *
 * A presentation-level guard and nothing more. SIUE's hook rested on two
 * Australian defenders who arrived in 2024 and 2025, and the graduating-class
 * clause two sentences later named one of the same two — both true, and
 * together they read as a database joining itself in front of the reader.
 *
 * The set is keyed on `nameKey`, so "Elliott Forestier" and "elliott
 * forestier" are one person, and it is seeded from EVERYTHING a clause is
 * about — the names it prints AND the arrivals behind it — while only the
 * names a later clause would PRINT are filtered. That asymmetry is the point:
 * the hook is allowed to rest on a player silently, and the later sentence is
 * not allowed to name them a second time.
 *
 * Nothing here changes selection, the evidence, or the log. The full set of
 * supporting people stays in `data.provenance` either way.
 */
function peopleIn(ev) {
  const d = ev?.data ?? {};
  return [
    ...(Array.isArray(d.names) ? d.names : []),
    d.name,
    ...((d.provenance?.supporting ?? []).map((s) => s.playerName)),
  ].filter(Boolean);
}

/** Has this person already been talked about in this email? */
const alreadySaid = (ctx, name) => Boolean(ctx?.namesUsed?.has(nameKey(name)));

/** Records everyone a clause rests on, printed or not. */
export function rememberPeople(ctx, ev) {
  if (!ctx?.namesUsed) return;
  for (const n of peopleIn(ev)) ctx.namesUsed.add(nameKey(n));
}

/**
 * The names from a list that this clause may still print.
 *
 * `partial` is true when something was removed, which the copy has to reflect:
 * printing two of three graduating defenders without saying so reads as a
 * complete list and is the one way this guard could make a claim misleading.
 */
function remainingNames(ctx, names = []) {
  const list = names.filter(Boolean);
  const kept = list.filter((n) => !alreadySaid(ctx, n));
  return { kept, partial: kept.length !== list.length };
}

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

/**
 * The names a clause may print, after the ceiling and the person guard.
 *
 * Returns `{ list, partial }` or null. `partial` means somebody was dropped
 * because an earlier clause already talked about them, and the copy must say
 * "including" rather than presenting what is left as the whole group.
 */
const named = (names = [], ctx = null) => {
  const all = (names ?? []).filter(Boolean);
  if (!all.length || all.length > NAME_CEILING) return null;
  if (!ctx?.namesUsed) return { list: all, partial: false };
  const { kept, partial } = remainingNames(ctx, all);
  if (!kept.length) return null;
  return { list: kept, partial };
};

/** "(A and B)" or "(including A)" — the bracket, or nothing. */
const nameBracket = (picked) => {
  if (!picked) return '';
  return picked.partial
    ? ` (including ${joinNames(picked.list)})`
    : ` (${joinNames(picked.list)})`;
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
  HISTORICAL_SAME_COUNTRY: (d, ev, ctx) => {
    const who = named(d.names, ctx);
    const since = firstSeason(ev);
    const demonym = DEMONYM[d.country];
    const when = since ? ` ${yearPhrase(since)}` : '';
    return {
      // One named player is the strongest version of this: the coach
      // recognises the name and knows immediately that somebody actually
      // looked rather than ran a query.
      clause: d.count === 1 && who && !who.partial
        ? `you've had ${who.list[0]} come through from ${d.country}${when}`
        : `you've had ${peopleFrom(d.country, d.count)} come through the program${since ? ` since ${since}` : ''}${nameBracket(who)}`,
      reason: `I thought you might be open to another${demonym ? ` ${demonym}` : ''}`,
    };
  },

  CURRENT_SAME_COUNTRY: (d, ev, ctx) => {
    const who = named(d.names, ctx);
    const demonym = DEMONYM[d.country];
    const one = d.count === 1 && demonym ? `a ${demonym}` : peopleFrom(d.country, d.count);
    return {
      clause: `you've already got ${one} on the roster${who && !who.partial ? ` in ${joinNames(who.list)}` : ''}`,
      reason: 'I thought you might be open to another',
      framing: 'I noticed',
    };
  },

  /**
   * An arrival from the athlete's country, at their position.
   *
   * Two voices, and which one is used is a safety decision rather than a
   * stylistic one. "You brought in Hayden Aish in 2023" said to a coach
   * appointed in 2025 is a sentence about their predecessor's work with their
   * name on it, so the second-person-active form is used ONLY where every
   * supporting arrival falls inside the current coach's attributable
   * transitions. Everywhere else the clause speaks about the PROGRAMME — the
   * same fact, addressed to the party it belongs to.
   *
   * A name is used only where the identity licence allows one, and one name
   * beats any count: a coach who recognises the player knows immediately that a
   * person looked rather than a query ran.
   */
  ARRIVAL_SAME_COUNTRY_POSITION: (d, ev, ctx) => {
    const seasons = d.seasons?.length ? d.seasons : [firstSeason(ev)].filter(Boolean);
    // Never `undefined` in a sentence: a named arrival's season is always one
    // of the observed ones, so the span is a correct fallback rather than a
    // guess.
    const nameSeason = d.nameSeason ?? seasons[0] ?? '';
    const noun = d.count === 1 ? positionNoun(d.position) : positionPlural(d.position);
    const demonym = DEMONYM[d.country];
    const reason = `I thought you might be open to another${demonym ? ` ${demonym}` : ''}`;
    // The span, in the house form the historical kinds already use: one season
    // is "back in 2024", several is "since 2023".
    const when = seasons.length > 1 ? `since ${seasons[0]}` : yearPhrase(seasons[0]);
    const howMany = d.count === 1 ? `a ${noun}` : `${countWord(d.count)} ${noun}`;

    // A person the email has already talked about is not named a second time.
    // The count form says the same true thing without the echo.
    if (d.name && !alreadySaid(ctx, d.name)) {
      return {
        clause: d.coachOwned
          ? `you brought in ${d.name} from ${d.country} ${yearPhrase(nameSeason)}`
          : `you've had ${d.name} come through from ${d.country} ${yearPhrase(nameSeason)}`,
        reason,
      };
    }
    return {
      clause: d.coachOwned
        ? `you've brought in ${howMany} from ${d.country} ${when}`
        : `you've had ${howMany} come through from ${d.country} ${when}`,
      reason,
    };
  },

  /**
   * The current coach's own recruiting from the athlete's country.
   *
   * The only clause in this file that speaks to the recipient's own record, and
   * the wording is the reason the kind has the strictest gate behind it. Three
   * ATTRIBUTED transitions, counted from the tenure rather than from the
   * arrivals, and the coach's first roster — their predecessor's recruiting —
   * excluded before the count is taken.
   *
   * Never "you recruited". What two roster snapshots observed is that a player
   * from this country ARRIVED during seasons this coach is answerable for, and
   * "you've brought in ... since 2024" is exactly that and no more. The date is
   * the athlete's first arrival season, not the coach's appointment: we can see
   * when they were in post inside a four-season window and cannot see when they
   * started.
   */
  COACH_ARRIVAL_SAME_COUNTRY: (d, ev, ctx) => {
    const seasons = d.seasons?.length ? d.seasons : [firstSeason(ev)].filter(Boolean);
    const nameSeason = d.nameSeason ?? seasons[0] ?? '';
    const demonym = DEMONYM[d.country];
    // The position appears only when every supporting arrival shares it, which
    // is what lets the strongest kind in the group also carry the most specific
    // fact rather than losing it to dedupe.
    const noun = d.position
      ? (d.count === 1 ? positionNoun(d.position) : positionPlural(d.position))
      : (d.count === 1 ? 'player' : 'players');
    const howMany = d.count === 1 ? `a ${noun}` : `${countWord(d.count)} ${noun}`;
    return {
      clause: d.name && !alreadySaid(ctx, d.name)
        ? `you've brought in ${d.name} from ${d.country} ${yearPhrase(nameSeason)}`
        : `you've brought in ${howMany} from ${d.country} since ${seasons[0] ?? ''}`,
      reason: `I thought you might be open to another${demonym ? ` ${demonym}` : ''}`,
    };
  },

  /**
   * An arrival from the athlete's part of the world, at their position.
   *
   * The region KEY never appears. A coach has no idea what OCEANIA is, and the
   * supporting country is both more natural and more checkable — so the clause
   * names Australia and the reason says "this part of the world".
   */
  ARRIVAL_SAME_REGION_POSITION: (d, ev, ctx) => {
    const seasons = d.seasons?.length ? d.seasons : [firstSeason(ev)].filter(Boolean);
    const countries = d.countries ?? [];
    const noun = d.count === 1 ? positionNoun(d.position) : positionPlural(d.position);
    const when = seasons.length > 1 ? `since ${seasons[0]}` : yearPhrase(seasons[0]);
    const howMany = d.count === 1 ? `a ${noun}` : `${countWord(d.count)} ${noun}`;
    return {
      clause: d.name && !alreadySaid(ctx, d.name)
        ? `you've had ${d.name} come through from ${countries[0]} ${when}`
        : `you've had ${howMany} come through from ${joinNames(countries)} ${when}`,
      reason: 'I thought you might be open to more players from this part of the world',
    };
  },

  /**
   * Intake at this position, per season. INTERNAL ONLY.
   *
   * The registry marks this kind `emailEligible: false` and selection separates
   * it before composition can see it, so this copy exists for the operator
   * panel alone. It is written flat on purpose: it must read as a count
   * somebody can check against their own rosters, never as a forecast of what
   * they will do next.
   */
  POSITION_INTAKE_HISTORY: (d, ev) => ({
    clause: `you've added ${countWord(d.count)} ${d.count === 1 ? positionNoun(d.position) : positionPlural(d.position)}`
      + ` across ${countWord(d.observedTransitions)} intakes since ${(d.seasons ?? [])[0] ?? firstSeason(ev)}`,
    reason: 'it seemed worth noting',
  }),

  HISTORICAL_SAME_REGION: (d, ev) => {
    const since = firstSeason(ev);
    const where = d.countries.length === 1 ? d.countries[0] : joinNames(d.countries);
    const howMany = d.count === 1 ? 'a player' : `${countWord(d.count)} players`;
    return {
      clause: `you've had ${howMany} from ${where} come through${since ? ` ${yearPhrase(since)}` : ''}`,
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
    const who = named(d.names, ctx);
    return {
      clause: `you've got ${countWord(d.count)} ${noun} graduating${d.classYear ? ` in ${d.classYear}` : ''}${nameBracket(who)}`,
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
  const parts = ev.tier === TIERS.FACT ? factParts(ev, ctx) : signalParts(ev, ctx);
  /**
   * Registered AFTER rendering, so a clause is never filtered against itself,
   * and registered whether or not the names were printed — the hook may rest
   * on a player silently, and the later sentence still must not name them.
   *
   * Callers that do not supply a `namesUsed` set get today's behaviour
   * exactly: `rememberPeople` returns immediately and every name prints.
   */
  rememberPeople(ctx, ev);
  return parts;
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
