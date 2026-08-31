/**
 * Which coaching regime does each measured season belong to?
 *
 * The report describes four seasons of a programme's record. It does not say
 * whose record they are. At 741 of 1,449 measurable programmes the current
 * coach did not run the whole window, and at 391 of them they ran one season
 * or none — Hofstra's four measured seasons are Richard Nuttall's, and a
 * family reading that report about Stephen Roche cannot tell. This module is
 * the truth layer that lets a page say so.
 *
 * WHAT IT ANSWERS, and nothing else: which observable coaching context each
 * measured season belongs to, and how much of the measured window belongs to
 * the coach a recruit would join.
 *
 * WHAT IT DOES NOT ANSWER. Whether the coach caused any of the behaviour the
 * report measures. Whether one coach is better than another. Whether anything
 * observed will continue. What any analytic becomes when restricted to one
 * coach's seasons — that is a separate question and this module deliberately
 * cannot answer it, because it never touches a roster row.
 *
 * A PURE FUNCTION OF TWO INPUTS: the programme's `coach_seasons` rows, and the
 * list of seasons the report actually measured. It does not read
 * `roster_players` and does not re-derive readability. That is the whole design
 * decision — the denominator is handed in, so the attribution and the report
 * can never disagree about which seasons are being described, and so a second
 * definition of "readable" cannot come into existence here.
 *
 * IT NEVER INTERPOLATES. A season with no usable coach on file is UNRESOLVED
 * and stays UNRESOLVED, even when the same name sits either side of it. A gap
 * between two spells of one name is two observations, not one — the rule
 * `tenureFor` already keeps, for the reason it documents: Bellarmine women's
 * read as one coach across four seasons purely because two came back blank,
 * and it was three coaches.
 *
 * WHY IT DOES NOT USE `classifyRole` FROM coachRoles.js. That function answers
 * "who at this programme should receive recruiting mail", and for that purpose
 * a Director of Soccer is a fine recipient and the ordering that reads "Head
 * Strength and Conditioning Coach" as a head coach costs nothing. Here both are
 * wrong: attributing a programme's four seasons to its strength coach would be
 * a false statement about a named person. Same table, different question, so
 * the head-coach test is written out below rather than delegated.
 *
 * CO-HEAD COACHES CANNOT BE FULLY REPRESENTED. `coach_seasons` has primary key
 * (school, sport, season) and therefore stores exactly one row per
 * programme-season. Four programmes list a co-head arrangement; the model
 * flags it and does not pretend to resolve it.
 */
import { isVacancy, sameCoach, VACANCY_REASONS } from './coachTenure.js';

/** The season a recruit would be joining. Never a measured season. */
export const CURRENT_SEASON = 2026;

/**
 * Values found in `coach_name` that are page furniture rather than a person.
 *
 * Measured, not guessed: enumerating all 221 distinct titles and all named
 * rows found four families and nothing else. "Phone Number" and "Business
 * Management" are field labels a parser took for a name; "National
 * Championships" is the heading of a records table; "Prospective Athletes" and
 * "All News" are navigation links a parser reached instead of a person.
 */
const NOT_A_NAME = /^(phone number|business management|emergency management|full name|email address|national championships|head coaching history|prospective athletes|head coaches|all news)$/i;

/**
 * A head-coaching phrase, bounded so it cannot span two jobs.
 *
 * Lazy to the first "coach", and stopping at a pipe or semicolon, so
 * "Assistant Women's Soccer Coach / Head Development Team Coach" yields "Head
 * Development Team Coach" and not something that reaches back to the
 * assistant.
 */
const HEAD_PHRASE = /\bhead\b[^;|]{0,45}?\b(?:coach|coaches|coaching)\b/gi;
/** A rank junior to the head, where it qualifies the phrase that follows. */
const JUNIOR_RANK = /\b(?:associate|assistant)\s*$/i;
/** Another function entirely, however the word "head" is used beside it. */
const OTHER_FUNCTION = /strength|conditioning|peak performance|coaching history/i;
/** Another team: a development side or a junior varsity is not this team. */
const OTHER_TEAM = /\bdevelopment\s+team\b|\bjunior\s+varsity\b|\bjv\b/i;
/**
 * "Head Coach, Strength & Conditioning" — the phrase itself is clean and the
 * qualifier immediately after it is what gives the job away.
 */
const HEAD_OF_SOMETHING_ELSE = /\bhead\s+coach\s*[,/;–—-]\s*(?:strength|conditioning|peak)/i;

/**
 * Does this title name a head coach OF THIS TEAM?
 *
 * Phrase by phrase rather than one pattern over the whole string, because a
 * staff title is usually several jobs: "Head Coach/Assistant Athletic
 * Director" is the head coach who also runs part of the department, and
 * "Assistant Athletic Director / Head Men's Soccer Coach" is the same person
 * written the other way round. Reading the whole string at once cannot tell
 * either from "Head Strength and Conditioning Coach - Women's Soccer Assistant
 * Coach", which is the strength coach who also helps out.
 *
 * So: find every head-coaching phrase, and accept the title if any one of them
 * is this team's — not preceded by a junior rank, and not naming another
 * function or another team.
 *
 * Validated by enumerating all 221 distinct titles in the table and reading
 * every rejection. That pass is what found the endowed chairs at Brown
 * ("Friends of Brown Men's Soccer Head Coaching Chair" is the head coach), the
 * interim written in the middle ("Head Interim Women's Soccer Coach"), the
 * coach of two sports ("Head Women's Lacrosse/Soccer Coach"), and three rows
 * whose title is a news headline and whose name is "All News".
 */
function namesTeamHeadCoach(title) {
  const t = String(title);
  if (HEAD_OF_SOMETHING_ELSE.test(t)) return false;
  for (const m of t.matchAll(HEAD_PHRASE)) {
    if (JUNIOR_RANK.test(t.slice(Math.max(0, m.index - 12), m.index))) continue;
    if (OTHER_FUNCTION.test(m[0])) continue;
    if (OTHER_TEAM.test(m[0])) continue;
    return true;
  }
  return false;
}

/** An associate head coach, in a title that names no head coach of this team. */
const ASSOCIATE_HEAD = /\bassociate\s+head\b/i;
const INTERIM = /\binterim\b/i;
const CO_HEAD = /\bco[-\s]?head\b/i;

/** Why a row could not be used, in the order the tests are applied. */
export const UNUSABLE = Object.freeze({
  NO_ROW: 'no coach row on file for this season',
  NO_NAME: 'no coach name could be read for this season',
  VACANT: 'the post was recorded as vacant or to be announced',
  NOT_A_NAME: 'the value recorded in the coach column is not a person’s name',
  NOT_A_HEAD_COACH: 'the title on file names a role other than head coach of this team',
  ASSOCIATE_HEAD: 'the title on file names an associate head coach, not the head coach',
});

/** How a season was attributed. */
export const ATTRIBUTION = Object.freeze({
  CURRENT: 'CURRENT_COACH',
  PREVIOUS: 'PREVIOUS_COACH',
  UNRESOLVED: 'UNRESOLVED',
});

/**
 * The structural shape of a programme's coaching timeline.
 *
 * ONE ENUM AND THE FACTS BEHIND IT. Every state here is derived from
 * `facts` by the documented priority in `timelineStateOf`, and `facts` is
 * always present — so a consumer that needs more than the label has it, and
 * the label can be coarse without anything being lost. Ohio State men's is the
 * case that forced this: three measured seasons under the current coach and
 * one whose coach was never resolved. No single word covers that, and
 * flattening it to "incomplete" would throw away the three.
 */
export const TIMELINE = Object.freeze({
  CURRENT_COACH_UNKNOWN: 'CURRENT_COACH_UNKNOWN',
  CURRENT_COACH_NO_MEASURED_SEASON: 'CURRENT_COACH_NO_MEASURED_SEASON',
  SAME_COACH_ALL_HISTORY: 'SAME_COACH_ALL_HISTORY',
  CURRENT_COACH_ONE_SEASON: 'CURRENT_COACH_ONE_SEASON',
  MULTIPLE_CHANGES: 'MULTIPLE_CHANGES',
  COACH_CHANGE_WITHIN_WINDOW: 'COACH_CHANGE_WITHIN_WINDOW',
  COACH_RECORD_INCOMPLETE: 'COACH_RECORD_INCOMPLETE',
});

/**
 * Is this row a usable observation of the head coach of this team?
 *
 * Returns the coach where it is, and the reason where it is not. Exported
 * because the reason is the useful half: a programme with no current coach
 * should be able to say which of six things went wrong.
 */
export function readCoachRow(row) {
  if (!row) return { usable: false, reason: UNUSABLE.NO_ROW };
  const name = String(row.coach_name ?? '').trim();
  const title = String(row.coach_title ?? '').trim();
  // Blank splits two ways, and `tenureFor` documents why the difference
  // matters: "the page said there is nobody" and "we could not read the page"
  // are opposite claims, and reporting the second as the first invents a
  // vacancy. The scraper already separates them in `reason`.
  if (!name) {
    const stated = String(row.reason ?? '').trim();
    return { usable: false, reason: VACANCY_REASONS.has(stated) ? UNUSABLE.VACANT : UNUSABLE.NO_NAME };
  }
  // A placeholder printed ON the page — "TBA", "Vacant" — is a vacancy
  // whatever the reason column says.
  if (isVacancy(name)) return { usable: false, reason: UNUSABLE.VACANT };
  if (NOT_A_NAME.test(name)) return { usable: false, reason: UNUSABLE.NOT_A_NAME };
  // Structural insurance, and it currently fires on nothing: no name in the
  // table is a single token or carries a digit. It is here so a future import
  // that breaks that cannot quietly attribute four seasons to "2024 Roster".
  if (/[0-9@]|https?:|\.com|\.edu/i.test(name)) return { usable: false, reason: UNUSABLE.NOT_A_NAME };
  if (name.split(/\s+/).filter(Boolean).length < 2) return { usable: false, reason: UNUSABLE.NOT_A_NAME };

  const flags = {
    interim: INTERIM.test(title),
    coHead: CO_HEAD.test(title),
  };
  // A row with no title at all is taken at face value. 840 rows have no name
  // and no title; none has a name and no title, so this branch is insurance.
  if (!title) {
    return { usable: true, reason: null, name, title: null, ...flags, titled: false };
  }
  if (NOT_A_NAME.test(title)) return { usable: false, reason: UNUSABLE.NOT_A_NAME };
  if (namesTeamHeadCoach(title)) return { usable: true, reason: null, name, title, ...flags, titled: true };
  // Which of the two refusals, so a page can say why. Associate head is the
  // commoner and the more specific.
  if (ASSOCIATE_HEAD.test(title)) return { usable: false, reason: UNUSABLE.ASSOCIATE_HEAD };
  return { usable: false, reason: UNUSABLE.NOT_A_HEAD_COACH };
}

/** The current coach, or null and the reason there is none. */
export function currentCoachFrom(coachRows = [], { currentSeason = CURRENT_SEASON } = {}) {
  const row = coachRows.find((r) => Number(r?.season) === Number(currentSeason)) ?? null;
  const read = readCoachRow(row);
  if (!read.usable) return { coach: null, reason: read.reason };
  return {
    coach: {
      name: read.name,
      title: read.title,
      season: Number(currentSeason),
      confidence: row.confidence ?? null,
      interim: read.interim,
      coHead: read.coHead,
      usable: true,
    },
    reason: null,
  };
}

/**
 * Observed named-coach transitions inside the measured window.
 *
 * CONSERVATIVE, and the rule is the point. A transition is counted only where
 * two seasons are adjacent IN THE CALENDAR, both resolved, and name different
 * coaches.
 * So `A → unresolved → B` counts nothing, because nothing observed says the
 * change happened at either boundary rather than in the gap. `A → unresolved →
 * A` counts nothing either. And a change across a season the report could not
 * measure is not counted, because this window is the measured window.
 *
 * The consequence is deliberate under-counting. A programme that changed coach
 * twice with an unresolved season between will report fewer transitions than it
 * had, and that is the direction of error this codebase chooses every time.
 */
export function observedTransitions(seasons = []) {
  const out = [];
  for (let i = 1; i < seasons.length; i += 1) {
    const prev = seasons[i - 1];
    const here = seasons[i];
    if (Number(here.season) !== Number(prev.season) + 1) continue;
    if (!prev.coachName || !here.coachName) continue;
    if (sameCoach(prev.coachName, here.coachName)) continue;
    out.push({ from: prev.coachName, to: here.coachName, season: Number(here.season) });
  }
  return out;
}

/**
 * The timeline state, from the facts, by an explicit priority.
 *
 * The order matters and is the whole of the design. An incomplete coach record
 * must not erase a known fact: Mercyhurst men's has one measured season under
 * its current coach and three that are somebody else's, and
 * `CURRENT_COACH_ONE_SEASON` is what a reader needs — not "incomplete", which
 * is true of a different programme and useless here.
 */
export function timelineStateOf(facts) {
  const { currentCoachKnown, measured, attributed, previous, unresolved, transitions } = facts;
  if (!currentCoachKnown) return TIMELINE.CURRENT_COACH_UNKNOWN;
  if (attributed === 0) return TIMELINE.CURRENT_COACH_NO_MEASURED_SEASON;
  if (attributed === measured) return TIMELINE.SAME_COACH_ALL_HISTORY;
  if (attributed === 1) return TIMELINE.CURRENT_COACH_ONE_SEASON;
  if (transitions >= 2) return TIMELINE.MULTIPLE_CHANGES;
  if (previous > 0) return TIMELINE.COACH_CHANGE_WITHIN_WINDOW;
  // Attributed seasons and no named earlier coach: the rest of the window was
  // never resolved, and nothing may be filled in for it.
  if (unresolved > 0) return TIMELINE.COACH_RECORD_INCOMPLETE;
  return TIMELINE.COACH_RECORD_INCOMPLETE;
}

/**
 * The attribution model for one programme.
 *
 * @param coachRows - this programme's `coach_seasons` rows, any order.
 * @param measuredSeasons - the seasons the REPORT measured, as strings or
 *   numbers. Handed in rather than derived: see the module note. An empty list
 *   is legitimate and yields a model with no denominator.
 * @param currentSeason - the season a recruit would join. Never measured.
 */
export function coachAttribution({ coachRows = [], measuredSeasons = [], currentSeason = CURRENT_SEASON } = {}) {
  const measured = [...new Set(measuredSeasons.map(Number))]
    .filter((s) => Number.isFinite(s) && s !== Number(currentSeason))
    .sort((a, b) => a - b);
  const bySeason = new Map();
  for (const r of coachRows) {
    const s = Number(r?.season);
    if (Number.isFinite(s)) bySeason.set(s, r);
  }

  const { coach: currentCoach, reason: currentCoachReason } = currentCoachFrom(coachRows, { currentSeason });

  const seasons = measured.map((season) => {
    const row = bySeason.get(season) ?? null;
    const read = readCoachRow(row);
    const coachName = read.usable ? read.name : null;
    const attribution = !coachName ? ATTRIBUTION.UNRESOLVED
      : (currentCoach && sameCoach(coachName, currentCoach.name)
        ? ATTRIBUTION.CURRENT : ATTRIBUTION.PREVIOUS);
    return {
      season: String(season),
      coachName,
      coachTitle: read.usable ? read.title : null,
      coachConfidence: coachName ? (row.confidence ?? null) : null,
      unusableReason: read.usable ? null : read.reason,
      interim: read.usable ? read.interim : false,
      coHead: read.usable ? read.coHead : false,
      attribution,
    };
  });

  const attributed = seasons.filter((s) => s.attribution === ATTRIBUTION.CURRENT);
  const previous = seasons.filter((s) => s.attribution === ATTRIBUTION.PREVIOUS);
  const unresolved = seasons.filter((s) => s.attribution === ATTRIBUTION.UNRESOLVED);
  const transitions = observedTransitions(seasons);

  // One named coach across every earlier season, or nothing. Named
  // `predecessor` for the interface and observational in meaning: the coach on
  // file for those seasons. Nothing here says they held the post before the
  // current coach, or that one followed the other — only that these seasons
  // carry that name and the current season carries a different one.
  const previousNames = [...new Set(previous.map((s) => s.coachName))];
  const singleNamed = previous.length > 0
    && previousNames.every((n) => sameCoach(n, previousNames[0]));
  const predecessor = singleNamed
    ? { name: previous[0].coachName, seasons: previous.map((s) => s.season) }
    : null;

  const facts = Object.freeze({
    currentCoachKnown: Boolean(currentCoach),
    measured: seasons.length,
    attributed: attributed.length,
    previous: previous.length,
    unresolved: unresolved.length,
    transitions: transitions.length,
    interim: Boolean(currentCoach?.interim),
    coHead: Boolean(currentCoach?.coHead) || seasons.some((s) => s.coHead),
  });

  const reasons = [];
  if (!currentCoach) reasons.push(currentCoachReason);
  if (!seasons.length) reasons.push('no measured season was handed to the attribution model');
  if (unresolved.length) {
    reasons.push(`${unresolved.length} of ${seasons.length} measured `
      + `season${seasons.length === 1 ? '' : 's'} has no usable coach on file`);
  }
  if (facts.interim) reasons.push('the coach on file for the current season is recorded as interim');
  if (facts.coHead) reasons.push('a co-head arrangement is on file, which one row per season cannot fully represent');

  return {
    currentCoach,
    currentCoachReason,
    measuredSeasons: seasons,
    // The two figures a page may state, and the share they make. Descriptive,
    // with no threshold and no label: "1 of the 4 measured seasons in this
    // report was under the current coach" is the whole claim.
    historicalMeasuredSeasons: seasons.length,
    currentCoachMeasuredSeasons: attributed.length,
    currentCoachShare: seasons.length ? attributed.length / seasons.length : null,
    previousCoachMeasuredSeasons: previous.length,
    incompleteCoachSeasons: unresolved.map((s) => s.season),
    observedTransitions: transitions,
    transitionCount: transitions.length,
    predecessor,
    predecessorIsSingleNamedCoach: Boolean(predecessor),
    timelineState: timelineStateOf(facts),
    facts,
    // An interim is not a regime. A page that reads the state above without
    // reading this would describe a caretaker as the programme's direction.
    requiresInterimQualifier: Boolean(currentCoach?.interim),
    evidence: {
      sufficient: Boolean(currentCoach) && seasons.length > 0,
      reasons,
    },
  };
}
