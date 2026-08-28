/**
 * A programme's coaching philosophy, as far as the roster can describe it.
 *
 * Three questions, all answered from the same two tables, and each one useless
 * without the others:
 *
 *   1. What does a first year look like here?        (the freshman ladder)
 *   2. Whose programme is this, and is he still here? (the coach window)
 *   3. When a place comes free, who takes it?         (the fill mix)
 *
 * The third is the one that pays. Across 15,275 programme-position-season
 * transitions, a departing starter takes the odds of a freshman starting at
 * that position from 30% to 51% — but as the hole gets bigger the transfer
 * share grows four-fold while the freshman share only doubles, and at a
 * position that empties completely the two are level. The vacancy that looks
 * most like an opportunity is the one most likely to be filled from the portal.
 *
 * And what a coach does with a vacancy is a stabler fact about them than how
 * many freshmen they play. Correlating each coach's first transition against
 * their last, two years apart: transfer usage repeats at r=0.475, freshman
 * usage at r=0.104. So the dial to read is the newcomer one.
 *
 * Everything here is HISTORY. The season a recruit joins has not been played.
 */

import {
  freshmanProfile, classifyProgramme, weightsFromVerdict, ladderByRank,
  isTrueFreshman, minutesAreMissing, cohortFor, originOf, bandFor,
  MIN_MEASURED_SHARE,
} from './freshmanMinutes.js';
import { tenureFor, stillInPost } from './coachTenure.js';
import { canonicalPosition, POSITIONS } from './positions.js';

export const SEASONS = ['2022', '2023', '2024', '2025'];
export const RECRUIT_SEASON = 2026;
export const TRANSITIONS = [['2022', '2023'], ['2023', '2024'], ['2024', '2025']];
export const STARTER_MINUTES = 600;

/**
 * The squad that is on campus now.
 *
 * Deliberately NOT added to SEASONS. All 46,028 of its rows carry null minutes
 * and null games — every one is unmeasured by construction — and SEASONS feeds
 * the ladder, the squad share, the position grid and the vacancy transitions.
 * Pushing it through four calculations that all have to refuse it would make
 * those refusals load-bearing and invisible. It is loaded on its own, by the
 * analyses that want a roster rather than a record.
 */
export const SQUAD_SEASON = '2026';

/**
 * How much of a season a position group has to have played before its shares
 * describe the programme rather than the two rows that happened to be legible.
 * Roughly one player's season and a bit.
 */
export const MIN_POSITION_MINUTES = 1500;

/**
 * Names are matched between seasons after stripping case, accents and
 * punctuation, because every one of those differences invents a departure.
 * The join was checked rather than assumed: of the players appearing in 2025
 * with no 2024 match, only 3-5% share a surname with anyone on the 2024
 * roster — the rate common surnames produce on their own.
 */
export function nameKey(name) {
  return String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Apostrophes and full stops CLOSE UP rather than becoming spaces: one
    // season's page writes "Aidan O'Sullivan" and the next writes "Aidan
    // OSullivan", and turning the apostrophe into a space leaves those two
    // as different people. Hyphens and slashes still open out, because
    // "Mauzy-Fleming" and "Mauzy Fleming" are the pair that needs joining
    // there.
    .replace(/['’.]/g, '')
    .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const minutesOf = (r) => Number(r?.minutes_played) || 0;
const measured = (r) => !minutesAreMissing(r);

/**
 * One observation per (position, season transition) for a single programme.
 *
 * `newcomer` is the third option the freshman-versus-promotion framing leaves
 * out: a player who was not here last season and is not a first-year. A
 * transfer, a JUCO arrival, or an older recruit — the roster cannot tell them
 * apart, and for a recruit's purposes they are the same thing, somebody
 * brought in ready to play.
 */
export function vacancyObservations(rows, {
  transitions = TRANSITIONS, minPositionMinutes = MIN_POSITION_MINUTES,
} = {}) {
  // Everything below groups by SEASON alone, so two programmes' rows handed
  // in together would merge into one fictional squad — and, worse, each
  // roster's names would read as departures from the other, manufacturing a
  // vacancy at every position. Refusing is cheap; the silent version is a
  // table of findings about a team that does not exist.
  const programmes = new Set(rows.map((r) => `${r.college_name}||${r.sport}`));
  if (programmes.size > 1) {
    throw new Error(`vacancyObservations takes one programme's rows; got ${programmes.size}`);
  }

  const bySeason = new Map();
  for (const r of rows) {
    const s = String(r.season);
    if (!bySeason.has(s)) bySeason.set(s, []);
    bySeason.get(s).push({ ...r, season: s, nk: nameKey(r.player_name), pos: canonicalPosition(r.position) });
  }

  const out = [];
  for (const [from, to] of transitions) {
    const prev = bySeason.get(from);
    const next = bySeason.get(to);
    if (!prev || !next) continue;
    // Two different sets doing two different jobs: `returned` answers "did
    // last season's player come back", `wasHere` answers "was this season's
    // player here before". Using one for both reports 100% continuity.
    const returned = new Set(next.map((r) => r.nk));
    const wasHere = new Set(prev.map((r) => r.nk));
    // A squad whose class labels cannot be read is not a squad that never
    // played a freshman. Bates, Hamilton and Elmira print a graduation year
    // or nothing where the class belongs, and reading that as zero put them
    // among the coaches least likely to play a freshman in the pool.
    const freshmenReadable = next.some(isTrueFreshman);

    for (const pos of POSITIONS) {
      const prevP = prev.filter((r) => r.pos === pos && measured(r));
      const nextP = next.filter((r) => r.pos === pos && measured(r));
      const prevLoad = prevP.reduce((s, r) => s + minutesOf(r), 0);
      const nextLoad = nextP.reduce((s, r) => s + minutesOf(r), 0);
      if (prevLoad < minPositionMinutes || nextLoad < minPositionMinutes) continue;

      const left = prevP.filter((r) => !returned.has(r.nk));
      const leftStarters = left.filter((r) => minutesOf(r) >= STARTER_MINUTES);
      // A first-year who was already on last season's roster did not arrive,
      // whatever the label says — 322 rows across the pool are labelled Fr.
      // in two consecutive seasons, and counting them as both returning and
      // incoming put Tiffin's three shares 14 points over 100. The three
      // categories have to partition the minutes or the mix is not a mix.
      const fresh = nextP.filter((r) => isTrueFreshman(r) && !wasHere.has(r.nk));
      const newcomers = nextP.filter((r) => !wasHere.has(r.nk) && !isTrueFreshman(r));
      const returning = nextP.filter((r) => wasHere.has(r.nk));

      const sum = (list) => list.reduce((s, r) => s + minutesOf(r), 0);
      out.push({
        pos, from, to, prevLoad, nextLoad, freshmenReadable,
        departed: left.length,
        departedStarters: leftStarters.length,
        departedStarterNames: leftStarters
          .sort((a, b) => minutesOf(b) - minutesOf(a))
          .map((r) => ({ name: r.player_name, minutes: minutesOf(r) })),
        vacated: sum(left),
        vacatedStarter: sum(leftStarters),
        vacatedShare: sum(left) / prevLoad,
        vacatedStarterShare: sum(leftStarters) / prevLoad,
        freshCount: fresh.length,
        freshStarters: fresh.filter((r) => minutesOf(r) >= STARTER_MINUTES).length,
        bestFresh: fresh.length ? Math.max(...fresh.map(minutesOf)) : 0,
        // The minutes as well as the share. A caller wanting "what fraction of
        // the vacated load came back as freshman minutes" must not reconstruct
        // it as share × load — that is a float round-trip into a mean compared
        // at three decimal places.
        freshMin: sum(fresh),
        newcomerMin: sum(newcomers),
        returningMin: sum(returning),
        freshShare: sum(fresh) / nextLoad,
        newcomerStarters: newcomers.filter((r) => minutesOf(r) >= STARTER_MINUTES).length,
        newcomerShare: sum(newcomers) / nextLoad,
        returningShare: sum(returning) / nextLoad,
      });
    }
  }
  return out;
}

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const round1 = (v) => (v == null ? null : Math.round(v * 1000) / 10);

/**
 * The three dials, as percentages of the position's minutes.
 *
 * Observations whose class labels could not be read are dropped rather than
 * counted as zero freshmen — see `freshmenReadable`.
 */
export function dials(observations) {
  const usable = observations.filter((o) => o.freshmenReadable);
  if (!usable.length) return { n: 0, freshman: null, newcomer: null, returning: null };
  return {
    n: usable.length,
    freshman: round1(mean(usable.map((o) => o.freshShare))),
    newcomer: round1(mean(usable.map((o) => o.newcomerShare))),
    returning: round1(mean(usable.map((o) => o.returningShare))),
  };
}

/**
 * How a programme has behaved at one position when a place came free.
 *
 * Counts rather than rates, because at three transitions a rate is a
 * percentage of three and reads far more confidently than it deserves to.
 */
export function positionHistory(observations, position) {
  const key = canonicalPosition(position);
  const at = observations.filter((o) => o.pos === key && o.freshmenReadable);
  const openings = at.filter((o) => o.departedStarters > 0);
  return {
    position: key,
    transitions: at.length,
    startersDeparted: at.reduce((s, o) => s + o.departedStarters, 0),
    openings: openings.length,
    freshmanTookIt: openings.filter((o) => o.freshStarters > 0).length,
    newcomerTookIt: openings.filter((o) => o.newcomerStarters > 0).length,
    dials: dials(at),
    seasons: at.map((o) => ({
      season: o.to,
      startersDeparted: o.departedStarters,
      departedNames: o.departedStarterNames,
      freshStarters: o.freshStarters,
      newcomerStarters: o.newcomerStarters,
      bestFresh: o.bestFresh,
    })),
  };
}

/**
 * Everything a philosophy report needs about one programme.
 *
 * `rows` is that programme's roster rows for every season on file, `coachRows`
 * its `coach_seasons` rows including the season being recruited into — the
 * whole point of carrying 2026 is to be able to say the record belongs to
 * somebody who has left.
 */
export function programmePhilosophy({ rows, coachRows = [], seasons = SEASONS,
  recruitSeason = RECRUIT_SEASON } = {}) {
  const profile = freshmanProfile(rows, { seasons, maxRank: 6 });
  const tenure = tenureFor(coachRows);
  const verdict = profile ? classifyProgramme(profile, tenure) : null;
  const weights = verdict ? weightsFromVerdict(verdict, profile.seasons) : null;

  const observations = vacancyObservations(rows);
  const current = tenure?.current ?? null;
  const coachOfRecruitSeason = coachRows
    .find((r) => Number(r.season) === recruitSeason && String(r.coach_name || '').trim());

  return {
    seasonsObserved: profile?.seasonsObserved ?? 0,
    freshman: profile,
    ladder: profile ? profile.byRank : [],
    weightedLadder: weights && profile ? ladderByRank(profile.seasons, { maxRank: 6, weights }) : null,
    verdict,
    tenure,
    coach: current,
    coachForRecruitSeason: coachOfRecruitSeason?.coach_name ?? null,
    // Three answers, and the third is the point: null means the season was
    // never resolved and nothing may be filled in for it.
    coachStillInPost: stillInPost(tenure, recruitSeason),
    observations,
    dials: dials(observations),
    byPosition: POSITIONS.map((p) => positionHistory(observations, p)),
    // Stated on every report so no reader has to infer it.
    describes: profile ? profile.seasons.map((s) => s.season) : [],
  };
}

/**
 * The same programme, read for one athlete.
 *
 * Two things change. The ladder is cut to the cohort they would compete with
 * — their position, and at most programmes their origin — and the vacancy
 * history is cut to their position alone.
 */
export function playerFit(philosophy, athlete, rows, { seasons = SEASONS } = {}) {
  const cohort = cohortFor(athlete);
  const mine = freshmanProfile(rows, { seasons, athlete, maxRank: 5 });
  const position = positionHistory(philosophy.observations, athlete?.position);
  return {
    asked: cohort,
    cohort: mine?.cohort ?? null,
    ladder: mine?.byRank ?? [],
    seasonsObserved: mine?.seasonsObserved ?? 0,
    position,
    // The whole-intake ladder alongside, because the difference between them
    // is itself the finding: narrowing moved the top of the ladder downward at
    // 17 of one pilot athlete's 19 programmes.
    wholeIntakeLadder: philosophy.ladder,
  };
}

// ---------------------------------------------------------------------------
// The raw material for a report that shows the data rather than summarising it
// ---------------------------------------------------------------------------

const bySeasonMap = (rows) => {
  const m = new Map();
  for (const r of rows) {
    const s = String(r.season);
    if (!m.has(s)) m.set(s, []);
    m.get(s).push({ ...r, season: s, nk: nameKey(r.player_name) });
  }
  return m;
};

/**
 * Which seasons we can say anything about arrivals in.
 *
 * "Did not arrive last summer" is only a fact where last season is on file.
 * Without this the transfer section cannot tell a programme that signs nobody
 * from one whose previous roster we never read — and since a quarter of
 * programmes genuinely sign nobody, that is the difference between a finding
 * and a hole.
 */
export function arrivalWindow(rows, { seasons = SEASONS } = {}) {
  const by = bySeasonMap(rows);
  const measurable = [];
  const unmeasurable = [];
  for (const season of seasons) {
    if (!by.has(season)) continue;
    (by.has(String(Number(season) - 1)) ? measurable : unmeasurable).push(season);
  }
  return { measurable, unmeasurable };
}

/** Every arrival, as a point, so a chart can show players instead of averages. */
function pointsOf(rows, seasons, kind) {
  const by = bySeasonMap(rows);
  const out = [];
  for (const season of seasons) {
    const here = by.get(season) ?? [];
    const prevSeason = String(Number(season) - 1);
    const knownBefore = by.has(prevSeason);
    const before = new Set((by.get(prevSeason) ?? []).map((r) => r.nk));
    for (const r of here) {
      if (minutesAreMissing(r)) continue;
      const fresh = isTrueFreshman(r);
      const arrived = knownBefore ? !before.has(r.nk) : null;
      // A first-year who was already here did not arrive. vacancyObservations
      // excludes those 322 rows from its freshman count, and a scatter that
      // included them would not add up to the dials on the facing page.
      if (kind === 'freshman' && (!fresh || arrived === false)) continue;
      if (kind === 'newcomer' && (fresh || arrived !== true)) continue;
      out.push({
        season, name: r.player_name,
        position: canonicalPosition(r.position),
        classLabel: r.class_year_label ?? null,
        minutes: minutesOf(r),
        gamesPlayed: Number(r.games_played) || 0,
        gamesStarted: Number(r.games_started) || 0,
        origin: originOf(r),
        priorProgramme: r.prior_programme ?? null,
        arrived,
        band: bandFor(minutesOf(r)),
      });
    }
  }
  return out.sort((a, b) => b.minutes - a.minutes);
}

export function freshmanPoints(rows, { seasons = SEASONS } = {}) {
  return pointsOf(rows, seasons, 'freshman');
}

/**
 * Arrivals who are not first-years: the transfer intake. Pair it with
 * `arrivalWindow` — an empty array means nothing on its own.
 */
export function newcomerPoints(rows, { seasons = SEASONS } = {}) {
  return pointsOf(rows, seasons, 'newcomer');
}

/**
 * What happened to each freshman in their SECOND season.
 *
 * The ladder says whether a programme plays freshmen. This says whether the
 * ones who did not play in year one are still not playing in year two — the
 * question a recruit who expects to wait is actually asking.
 *
 * Three states, not two. "Not on the next roster" and "on it with unrecorded
 * minutes" are different facts and the first is the whole point of the chart.
 */
export function secondYearProgression(rows, { seasons = SEASONS } = {}) {
  const by = bySeasonMap(rows);
  const out = [];
  for (const season of seasons) {
    const next = by.get(String(Number(season) + 1));
    if (!next) continue;
    const index = new Map(next.map((r) => [r.nk, r]));
    for (const r of (by.get(season) ?? [])) {
      if (!isTrueFreshman(r) || minutesAreMissing(r)) continue;
      const then = index.get(r.nk);
      const state = !then ? 'gone' : minutesAreMissing(then) ? 'unrecorded' : 'measured';
      out.push({
        season, name: r.player_name, position: canonicalPosition(r.position),
        year1: minutesOf(r),
        year2: state === 'measured' ? minutesOf(then) : null,
        year2State: state,
      });
    }
  }
  return out;
}

/**
 * Who the minutes went to each season, by where the player came from.
 *
 * A season whose minutes were never recorded KEEPS ITS ROW with `load: null`.
 * Dropping it makes a column vanish from a chart, and a missing column reads
 * as a season that did not happen.
 */
export function intakeBySeason(rows, { seasons = SEASONS } = {}) {
  const fresh = freshmanPoints(rows, { seasons });
  const newcomers = newcomerPoints(rows, { seasons });
  const window = arrivalWindow(rows, { seasons });
  const by = bySeasonMap(rows);
  return seasons.filter((s) => by.has(s)).map((season) => {
    const all = by.get(season) ?? [];
    const squad = all.filter((r) => !minutesAreMissing(r));
    const readable = all.length && squad.length / all.length >= MIN_MEASURED_SHARE;
    const load = squad.reduce((s, r) => s + minutesOf(r), 0);
    const f = fresh.filter((p) => p.season === season);
    const n = newcomers.filter((p) => p.season === season);
    const sum = (list) => list.reduce((s, p) => s + p.minutes, 0);
    return {
      season, rostered: all.length, measured: squad.length,
      readable, load: readable ? load : null,
      freshmen: f.length, freshmanMinutes: readable ? sum(f) : null,
      freshmanStarters: f.filter((p) => p.minutes >= STARTER_MINUTES).length,
      newcomers: n.length, newcomerMinutes: readable ? sum(n) : null,
      newcomerStarters: n.filter((p) => p.minutes >= STARTER_MINUTES).length,
      arrivalsMeasurable: window.measurable.includes(season),
      freshmanShare: readable && load ? sum(f) / load : null,
      newcomerShare: readable && load ? sum(n) / load : null,
    };
  });
}

/** Freshman minutes as a share of each position's load, season by season. */
export function positionSeasonGrid(rows, { seasons = SEASONS } = {}) {
  return POSITIONS.map((pos) => ({
    position: pos,
    cells: seasons.map((season) => {
      const at = rows.filter((r) => String(r.season) === season
        && canonicalPosition(r.position) === pos);
      const shown = at.filter((r) => !minutesAreMissing(r));
      // The same guard the seasons get: a cell built from two legible rows out
      // of nine is a measurement of the two rows.
      const readable = at.length > 0 && shown.length / at.length >= MIN_MEASURED_SHARE;
      const load = shown.reduce((s, r) => s + minutesOf(r), 0);
      const f = shown.filter(isTrueFreshman).reduce((s, r) => s + minutesOf(r), 0);
      return {
        season, players: at.length, measured: shown.length, load: readable ? load : null,
        share: readable && load ? f / load : null,
      };
    }),
  }));
}

/**
 * How many minutes are due to walk out of each position, and when.
 *
 * `eligibility_end_year` is 98% populated in every season and nothing in the
 * product reads it. Paired with the current squad's projected minutes it is the
 * closest the data comes to answering "when does a place actually open here".
 */
export function eligibilityCliff(squadRows, { positions = POSITIONS } = {}) {
  const rows = squadRows.filter((r) => r.eligibility_end_year != null);
  if (!rows.length) return null;
  const years = [...new Set(rows.map((r) => Number(r.eligibility_end_year)))].sort();
  return years.map((year) => ({
    year,
    total: rows.filter((r) => Number(r.eligibility_end_year) === year)
      .reduce((s, r) => s + (Number(r.projected_minutes) || 0), 0),
    byPosition: positions.map((pos) => ({
      position: pos,
      minutes: rows.filter((r) => Number(r.eligibility_end_year) === year
        && canonicalPosition(r.position) === pos)
        .reduce((s, r) => s + (Number(r.projected_minutes) || 0), 0),
      players: rows.filter((r) => Number(r.eligibility_end_year) === year
        && canonicalPosition(r.position) === pos).length,
    })),
  }));
}

/**
 * Arrivals the roster names outright, rather than ones inferred from absence.
 *
 * `prior_programme` is populated for 63% of squad-season rows and holds the
 * school a player came from. Most values are the programme's own name — those
 * are returners, not arrivals — so the filter is the whole function.
 */
export function namedArrivals(squadRows, { school } = {}) {
  return squadRows
    .filter((r) => r.prior_programme && nameKey(r.prior_programme) !== nameKey(school))
    .map((r) => ({
      name: r.player_name,
      position: canonicalPosition(r.position),
      classLabel: r.class_year_label ?? null,
      from: r.prior_programme,
      projectedMinutes: r.projected_minutes ?? null,
    }))
    .sort((a, b) => (b.projectedMinutes ?? 0) - (a.projectedMinutes ?? 0));
}

/** Who is already at this position, and the year each one's eligibility ends. */
export function depthChartAt(squadRows, position) {
  const key = canonicalPosition(position);
  if (key === 'UNKNOWN') return null;
  const at = squadRows.filter((r) => canonicalPosition(r.position) === key);
  if (!at.length) return null;
  return at
    .map((r) => ({
      name: r.player_name,
      classLabel: r.class_year_label ?? null,
      projectedMinutes: r.projected_minutes ?? null,
      eligibleTo: r.eligibility_end_year ?? null,
      arrivedFrom: r.prior_programme ?? null,
    }))
    .sort((a, b) => (b.projectedMinutes ?? -1) - (a.projectedMinutes ?? -1));
}
