/**
 * Who was in charge, season by season, and what that says about the numbers.
 *
 * A programme's freshman usage can move sharply mid-window, and the roster
 * data alone cannot say why. Bentley's freshman share ran 4%, 2%, 26%, 32%
 * across 2022-2025; the coach sequence shows Lauren Lukis, then Sarah Dacey
 * for the last three. Caltech's ran flat under one coach for four years.
 * Hofstra's swung 2%, 0%, 8%, 18% — also under one coach, which makes it
 * genuine unpredictability rather than a change of philosophy. Those are three
 * different things to tell a recruit and the minutes cannot distinguish them.
 *
 * Tenure here is measured inside the observed window, never asserted beyond
 * it. A coach present in every season on file is "4+ seasons", not "since
 * 2007" — we did not see 2021 and will not claim it.
 */

/**
 * The season a new coach's changes actually start showing.
 *
 * Bentley is the worked example: Dacey arrived for 2023 and freshman share
 * was 2% that year — lower than her predecessor's — then 26% and 32%. A first
 * season is played with the roster the previous coach recruited, so crediting
 * it to the new coach reads their inheritance as their policy.
 */
export const FIRST_SEASON_IS_INHERITED = true;

/** Placeholders a staff page prints when there is nobody in the job. */
const VACANT = /^(tba|tbd|tbn|n\/?a|vacant|vacancy|staff|open|pending|interim|to be (announced|named|determined|hired))$/i;

/**
 * The reasons that mean "the page said there is nobody", as opposed to the
 * far commoner "we could not read the page".
 *
 * These are opposite claims and the difference decides what a recruit is
 * told. A programme that printed TBA for two straight seasons is telling them
 * something real; a programme whose staff page 404'd is telling them nothing,
 * and reporting the second as the first invents a vacancy. The scraper
 * already separates them — `vacant-or-tba` is written only where a name was
 * found and rejected as a placeholder — so the distinction is carried through
 * rather than re-derived here.
 */
export const VACANCY_REASONS = new Set(['vacant-or-tba']);

export function isVacancy(name) {
  const n = String(name ?? '').trim().replace(/\.$/, '');
  if (!n) return true;
  const words = n.toLowerCase().split(/\s+/);
  if (words.length && words.every((w) => w === words[0])) return VACANT.test(words[0]);
  return VACANT.test(n);
}

/**
 * A comparable form of a coach's name.
 *
 * Accents, punctuation and case differ between a 2022 page and a 2025 one for
 * the same person, and every one of those differences would otherwise read as
 * a coaching change — inventing a regime shift out of a typographic one.
 */
export function normaliseCoach(name) {
  let raw = String(name ?? '').trim();
  // "Mauzy-Fleming, Meghan" and "Meghan Mauzy-Fleming" are one person. The
  // Python side flips this before writing, but a form that slipped through
  // would surface as a coaching change that never happened — the expensive
  // direction of error, so it is caught on both sides.
  const comma = raw.match(/^([^,]+),\s*([^,]+)$/);
  if (comma && !/\b(jr|sr|ii|iii|iv|ph\.?d|m\.?s|ed\.?d)\b/i.test(comma[2])) {
    raw = `${comma[2]} ${comma[1]}`;
  }
  return raw
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Are these the same person?
 *
 * Surname plus first initial, because staff pages alternate between "J. Smith"
 * and "John Smith" for one man. Deliberately not fuzzier than that: merging
 * two genuinely different coaches would erase the very change this module
 * exists to find, which is the more expensive mistake.
 */
export function sameCoach(a, b) {
  const x = normaliseCoach(a);
  const y = normaliseCoach(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.split(' ');
  const ys = y.split(' ');
  if (xs.length < 2 || ys.length < 2) return false;
  if (xs[xs.length - 1] !== ys[ys.length - 1]) return false;
  return xs[0][0] === ys[0][0];
}

// ---------------------------------------------------------------------------
// Is this row a usable observation of the head coach of THIS team?
//
// ONE ANSWER, and it lives here because two modules need it and they must not
// disagree. `tenureFor` below reads a programme's seasons through it, and
// `coachAttribution.js` re-exports it for the report. It used to live only in
// the attribution model, and the cost of that was measured: `tenureFor` had no
// title column at all, so at Marist men's it reported one unbroken spell of
// "Aaron Suma 2022-2026" — the strength coach — while the attribution refused
// the same rows. Same table, two answers, on one card.
//
// WHY NOT `classifyRole` FROM coachRoles.js. That function answers "who at
// this programme should receive recruiting mail", and for that purpose a
// Director of Soccer is a fine recipient and reading "Head Strength and
// Conditioning Coach" as a head coach costs nothing. Here both are wrong:
// attributing a programme's four seasons to its strength coach is a false
// statement about a named person. Same table, different question.
// ---------------------------------------------------------------------------

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

/**
 * The coaching history of one programme across the seasons observed.
 *
 * `rows` is [{ season, coach_name, reason }] in any order; unresolved seasons
 * may be omitted or carry a blank name, and are reported as gaps rather than
 * silently closed over — a gap between two spells of the same name is not
 * proof the same person held the job throughout.
 *
 * A gap is reported as one of two things, never merged. `vacantSeasons` is
 * "the page said nobody"; `unknownSeasons` is "we could not read the page".
 * `gaps` remains their union for callers that only need to know a season is
 * missing.
 */
export function tenureFor(rows = []) {
  const seen = new Map();
  const why = new Map();
  for (const r of rows) {
    const season = Number(r?.season);
    if (!Number.isFinite(season)) continue;
    // Through `readCoachRow`, so a season resolves only where the row is a
    // usable observation of THIS team's head coach. An associate head, a
    // strength coach or a page label leaves the season unresolved rather than
    // filling it with a name, which is what the whole module then refuses to
    // read as continuity.
    const read = readCoachRow(r);
    seen.set(season, read.usable ? read.name : null);
    if (!read.usable) {
      // "The page said there is nobody" and "we could not read a head coach"
      // are opposite claims, and only the first is a vacancy. A title naming
      // somebody else's job is the second: the post was filled, by a person
      // this row does not name.
      why.set(season, read.reason === UNUSABLE.VACANT ? 'vacant' : 'unknown');
    }
  }
  const seasons = [...seen.keys()].sort((a, b) => a - b);
  if (!seasons.length) return null;

  const segments = [];
  const gaps = [];
  const vacantSeasons = [];
  const unknownSeasons = [];
  for (const season of seasons) {
    const name = seen.get(season);
    if (!name) {
      gaps.push(season);
      (why.get(season) === 'vacant' ? vacantSeasons : unknownSeasons).push(season);
      continue;
    }
    const last = segments[segments.length - 1];
    // Contiguity matters: the same name either side of an unresolved season
    // is two observations, not one continuous spell.
    if (last && sameCoach(last.coach, name) && last.to === season - 1) {
      last.to = season;
      last.seasons.push(season);
    } else {
      segments.push({ coach: name, from: season, to: season, seasons: [season] });
    }
  }

  const changes = [];
  for (let i = 1; i < segments.length; i += 1) {
    if (segments[i].from === segments[i - 1].to + 1) {
      changes.push({ from: segments[i - 1].coach, to: segments[i].coach, season: segments[i].from });
    }
  }

  const current = segments.length ? segments[segments.length - 1] : null;
  const resolved = seasons.filter((s) => seen.get(s));

  return {
    seasons,
    resolvedSeasons: resolved,
    gaps,
    vacantSeasons,
    unknownSeasons,
    // The last season we can actually name a coach for. Everything after it
    // is a season we have no business describing.
    knownThrough: resolved.length ? resolved[resolved.length - 1] : null,
    segments,
    changes,
    current: current
      ? { coach: current.coach, since: current.from, seasons: current.seasons.length }
      : null,
    // One name across every season we actually resolved, and at least two of
    // them — a single observation is not continuity.
    continuous: segments.length === 1 && resolved.length >= 2 && gaps.length === 0,
    vacant: gaps.length > 0 && resolved.length === 0,
  };
}

/**
 * Is the coach who ran the seasons we measured still the coach a recruit
 * would join?
 *
 * Three answers, and the third is the point of the function. `true` and
 * `false` are both usable; `null` means the season was never resolved, and
 * the caller must not fill that in. Bellarmine women's ran four seasons with
 * four starter-level freshmen in each and read as "one coach throughout"
 * purely because 2024 and 2025 came back blank — it was three coaches.
 */
export function stillInPost(tenure, season) {
  const target = Number(season);
  if (!tenure?.current || !Number.isFinite(target)) return null;
  if ((tenure.unknownSeasons ?? []).includes(target)) return null;
  if (!tenure.seasons.includes(target)) return null;
  if ((tenure.vacantSeasons ?? []).includes(target)) return false;
  return target >= tenure.current.since;
}

/**
 * Which seasons should count, and how much, when projecting for a recruit.
 *
 * A season played under a coach who has since left describes a programme that
 * no longer exists. It is down-weighted rather than dropped: it is still
 * evidence about the institution — its facilities, its league, how it
 * recruits — and discarding it would leave some programmes with one season
 * and a confidence they have not earned.
 *
 * The new coach's first season is weighted as theirs but flagged inherited,
 * because it was played with the previous coach's squad.
 */
export const WEIGHT_CURRENT = 1;
export const WEIGHT_PREVIOUS = 0.35;

export function seasonWeights(tenure) {
  if (!tenure || !tenure.current) return null;
  const out = {};
  for (const season of tenure.seasons) {
    const underCurrent = season >= tenure.current.since;
    out[season] = underCurrent ? WEIGHT_CURRENT : WEIGHT_PREVIOUS;
  }
  return out;
}

/** True where this season was the current coach's first, on inherited players. */
export function isInheritedSeason(tenure, season) {
  if (!tenure?.current || !FIRST_SEASON_IS_INHERITED) return false;
  return Number(season) === tenure.current.since && tenure.changes.length > 0;
}
