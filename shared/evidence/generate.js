/**
 * Turns the intelligence Thriv3 already holds into evidence objects.
 *
 * Every generator here is pure and takes rows somebody else fetched, for the
 * same reason shared/matching/pool.js is: the browser composer, the Node
 * drafting CLI and the tests must all run identical code. A generator that
 * reached for a database would be usable in one of those three.
 *
 * Two rules hold throughout, and the tests enforce both:
 *
 *   Positions are only ever GOALKEEPER / DEFENSE / MIDFIELD / FORWARD, read
 *   through canonicalPosition. A roster saying "CB" becomes DEFENSE and
 *   nothing downstream can recover the "CB". UNKNOWN stays UNKNOWN and never
 *   produces position evidence at all — a player we could not classify must
 *   not be quietly filed into a group to make a count look better.
 *
 *   Absence is never zero. A programme with no roster on file returns null
 *   from every roster generator, which selection reads as "we know nothing".
 *   Returning a count of 0 would be a claim that they have no internationals
 *   and nobody graduating, which we would then say to a coach about his own
 *   squad.
 */

import { canonicalPosition } from '../positions.js';
import { nameKey, depthChartAt, eligibilityCliff, namedArrivals } from '../philosophy.js';
import { tenureFor, stillInPost } from '../coachTenure.js';
import { majorLabelFor } from '../academicMajors.js';
import { defineEvidence, CONFIDENCE } from './kinds.js';
import { rosterFreshness } from './freshness.js';
import { IDENTITY_METHOD, COACH_ATTRIBUTION } from '../recruiting/arrivals.js';
import {
  observationsFor, COVERAGE, DATA_STATUS, FIELD_COVERAGE_FLOOR,
} from '../recruiting/patterns.js';

/**
 * The only geography Thriv3 recognises, written out rather than derived.
 *
 * The brief asked for New Zealand and Australia and explicitly not for a large
 * subjective classification of the world, which is the right call: every
 * additional region is a judgement about whether two nationalities feel
 * related to a coach, and being wrong about that is worse than staying quiet.
 * Adding a region later is a line here.
 */
export const REGIONS = Object.freeze({
  OCEANIA: Object.freeze(['New Zealand', 'Australia']),
});

/** The region an athlete's country belongs to, or null if we do not claim one. */
export function regionFor(country) {
  if (!country) return null;
  for (const [region, members] of Object.entries(REGIONS)) {
    if (members.includes(country)) return region;
  }
  return null;
}

/**
 * How complete a roster looks, which decides whether a share may be quoted.
 *
 * A denominator is the part of an international percentage that can be wrong
 * without looking wrong: 4 internationals out of a 12-row partial scrape reads
 * as 33% for a squad that actually carries 30. Below a plausible squad size we
 * report counts and refuse shares.
 */
const MIN_PLAUSIBLE_SQUAD = 16;

const distinctPlayers = (rows) => {
  const seen = new Map();
  for (const r of rows) {
    const key = nameKey(r.player_name);
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, { name: r.player_name, seasons: new Set() });
    seen.get(key).seasons.add(String(r.season));
  }
  return [...seen.values()];
};

/** The most recent scrape stamp across a set of rows. */
const latestUpdate = (rows) => {
  let latest = null;
  for (const r of rows) {
    const v = r.updated_date ?? r.updatedDate ?? null;
    if (v && (latest === null || v > latest)) latest = v;
  }
  return latest;
};

const seasonSpan = (rows) => {
  const seasons = [...new Set(rows.map((r) => String(r.season)))].sort();
  if (!seasons.length) return null;
  return seasons.length === 1 ? seasons[0] : `${seasons[0]}-${seasons[seasons.length - 1]}`;
};

const countryOf = (r) => String(r.country || '').trim();

/**
 * Drops roster rows that are the athlete themselves.
 *
 * Found on real data rather than reasoned about: drafting for Rhys Davies, a
 * New Zealand defender, produced "you've had one New Zealander come through
 * the programme (Rhys Davies)" for Bellarmine, whose 2024 and 2025 rosters
 * carry a Rhys Davies from Waipu, New Zealand. Whether that is the same person
 * or a namesake, the sentence is wrong: as a namesake it reads as a mistake,
 * and as the same person it offers a coach the athlete's own spell at another
 * programme as evidence of a pipeline.
 *
 * Matched on the same normalised key the philosophy layer uses to follow
 * players between seasons, so "O'Sullivan" and "OSullivan" are one person
 * here too. Deliberately name-only and therefore slightly over-eager: removing
 * a genuine namesake costs one piece of evidence, while keeping the athlete
 * costs the credibility of the whole email.
 */
const withoutAthlete = (rows, athlete) => {
  const self = nameKey(athlete?.name);
  if (!self) return rows;
  return rows.filter((r) => nameKey(r.player_name) !== self);
};

const isInternational = (r) => {
  const c = countryOf(r);
  return !!c && c !== 'USA';
};

/**
 * Normalises whatever the caller could fetch into one shape.
 *
 * `hasSquad` and `hasHistory` are separate because they fail separately: 325
 * men's programmes have no 2026 roster while having four earlier seasons on
 * file, and historical country evidence is exactly what still works for them.
 */
export function buildProgrammeContext({
  college = {}, match = null, squad = null, history = null,
  coachRows = null, sport = null, rosterUpdatedAt = null, seasonBehind = false,
  recruiting = null,
  now = Date.now(),
} = {}) {
  const squadRows = Array.isArray(squad) ? squad : [];
  const historyRows = Array.isArray(history) ? history : [];
  // 2026 rows live in `squad`; the measured seasons live in `history`. Country
  // evidence spans both, so it is assembled once here rather than in each
  // generator.
  const allRows = [...historyRows, ...squadRows];

  // Read off the rows themselves when the caller did not say. Every
  // roster_players row carries `updated_date`, so the real paths never have to
  // pass it separately and a hand-built test fixture that omits it is honestly
  // reported as UNKNOWN rather than assumed fresh.
  const stamped = rosterUpdatedAt ?? latestUpdate(squadRows);
  const freshness = rosterFreshness({ updatedAt: stamped, now, seasonBehind });

  return {
    college,
    match,
    rosterUpdatedAt: stamped,
    freshness,
    sport: sport || college.sport || null,
    squad: squadRows,
    history: historyRows,
    allRows,
    coachRows: Array.isArray(coachRows) ? coachRows : [],
    /**
     * This programme's recruiting-history patterns, or null.
     *
     * Optional like every other input, and its absence removes the recruiting
     * generators rather than making them guess. A caller with no database — a
     * test fixture, the browser — simply gets the roster-derived evidence it
     * always got.
     */
    recruiting,
    hasSquad: squadRows.length > 0,
    hasHistory: historyRows.length > 0,
    hasAnyRoster: allRows.length > 0,
    squadSize: squadRows.length,
  };
}

// ---------------------------------------------------------------------------
// International connection
// ---------------------------------------------------------------------------

export function historicalSameCountry(athlete, ctx) {
  const country = athlete?.country;
  if (!country || !ctx.hasAnyRoster) return null;

  const rows = withoutAthlete(ctx.allRows.filter((r) => countryOf(r) === country), athlete);
  if (!rows.length) return null;

  // A compatriot who appears ONLY in the current squad is not history, and
  // saying so reads as nonsense. Adelphi's single New Zealander is on the 2026
  // roster and no earlier one, and this produced "you've had one New Zealander
  // come through the programme since 2026" — a past-tense claim about a season
  // that has not been played. That programme's honest evidence is
  // CURRENT_SAME_COUNTRY, which fires on exactly the same row.
  if (!rows.some((r) => ctx.history.includes(r))) return null;

  const players = distinctPlayers(rows);
  if (!players.length) return null;

  // One player on four rosters is one player. Counting rows here would turn a
  // single New Zealander who stayed four years into "four New Zealanders",
  // which a coach reading his own alumni list would spot immediately.
  return defineEvidence('HISTORICAL_SAME_COUNTRY', {
    strength: 88 + Math.min(6, players.length * 2),
    confidence: CONFIDENCE.HIGH,
    season: seasonSpan(rows),
    source: 'roster_players',
    freshness: ctx.freshness,
    data: {
      country,
      count: players.length,
      names: players.map((p) => p.name),
      seasons: [...new Set(rows.map((r) => String(r.season)))].sort(),
    },
  });
}

export function currentSameCountry(athlete, ctx) {
  const country = athlete?.country;
  if (!country || !ctx.hasSquad) return null;

  const rows = withoutAthlete(ctx.squad.filter((r) => countryOf(r) === country), athlete);
  if (!rows.length) return null;

  const players = distinctPlayers(rows);
  return defineEvidence('CURRENT_SAME_COUNTRY', {
    strength: 82 + Math.min(6, players.length * 2),
    confidence: CONFIDENCE.HIGH,
    season: seasonSpan(rows),
    source: 'roster_players',
    freshness: ctx.freshness,
    data: { country, count: players.length, names: players.map((p) => p.name) },
  });
}

/**
 * Regional history, with the athlete's own country deliberately removed.
 *
 * If the same rows counted twice — once as compatriots and once as regional
 * peers — the regional sentence would silently restate the country one, and
 * dedupe would be choosing between two views of one set rather than two facts.
 */
export function historicalSameRegion(athlete, ctx) {
  const country = athlete?.country;
  const region = regionFor(country);
  if (!region || !ctx.hasAnyRoster) return null;

  const peers = REGIONS[region].filter((c) => c !== country);
  if (!peers.length) return null;

  const rows = withoutAthlete(ctx.allRows.filter((r) => peers.includes(countryOf(r))), athlete);
  if (!rows.length) return null;
  // Same rule as same-country history: a regional peer who is only on the
  // current roster is a fact about this squad, not about how they recruit.
  if (!rows.some((r) => ctx.history.includes(r))) return null;

  const players = distinctPlayers(rows);
  const countries = [...new Set(rows.map(countryOf))].sort();

  return defineEvidence('HISTORICAL_SAME_REGION', {
    strength: 70 + Math.min(6, players.length * 2),
    confidence: CONFIDENCE.HIGH,
    season: seasonSpan(rows),
    source: 'roster_players',
    freshness: ctx.freshness,
    data: {
      region,
      athleteCountry: country,
      countries,
      count: players.length,
      names: players.map((p) => p.name),
    },
  });
}

export function internationalRoster(athlete, ctx) {
  if (!ctx.hasSquad) return null;
  const rows = withoutAthlete(ctx.squad.filter(isInternational), athlete);
  if (!rows.length) return null;

  const countries = [...new Set(rows.map(countryOf))].sort();
  return defineEvidence('INTERNATIONAL_ROSTER', {
    confidence: CONFIDENCE.HIGH,
    season: seasonSpan(ctx.squad),
    source: 'roster_players',
    freshness: ctx.freshness,
    data: { count: rows.length, countries, uniqueCountries: countries.length },
  });
}

export function internationalShare(athlete, ctx) {
  if (!ctx.hasSquad || ctx.squadSize < MIN_PLAUSIBLE_SQUAD) return null;
  const count = ctx.squad.filter(isInternational).length;
  if (!count) return null;

  const share = count / ctx.squadSize;
  return defineEvidence('INTERNATIONAL_SHARE', {
    strength: 44 + Math.round(share * 20),
    confidence: CONFIDENCE.MEDIUM,
    season: seasonSpan(ctx.squad),
    source: 'roster_players',
    freshness: ctx.freshness,
    data: { count, squadSize: ctx.squadSize, share: Math.round(share * 100) / 100 },
  });
}

// ---------------------------------------------------------------------------
// Roster opportunity
// ---------------------------------------------------------------------------

/**
 * Who is leaving at the athlete's position.
 *
 * Reads the matching engine's own departure numbers rather than recomputing
 * them, so the email and the match card can never disagree about a programme.
 * Accepts the legacy field names too: `players.recommendations` holds JSON
 * blobs written before pool.js settled on the current ones.
 */
export function positionGraduation(athlete, ctx) {
  const position = canonicalPosition(athlete?.position);
  if (position === 'UNKNOWN' || !ctx.match) return null;

  const count = ctx.match.graduating_at_position
    ?? ctx.match.graduating_seniors_at_position
    ?? null;
  if (!count) return null;

  const names = (ctx.match.graduating_names_at_position
    ?? ctx.match.graduating_senior_names_at_position
    ?? []).filter(Boolean);

  return defineEvidence('POSITION_GRADUATION', {
    strength: 72 + Math.min(12, count * 3),
    // Names read off a roster page are what make the sentence checkable. A
    // count with no names is still true and lands softer, so it drops a step.
    confidence: names.length ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM,
    season: ctx.match.roster_season || null,
    source: 'roster_players',
    freshness: ctx.freshness,
    data: { position, count, names, classYear: athlete?.classYear ?? null },
  });
}

/**
 * The same cohort, filtered to those we believe were starters.
 *
 * SIGNAL rather than FACT, and that is the point of splitting it out. For the
 * season being recruited into, no minutes have been played: starter status
 * comes from `projected_minutes` carried forward from an earlier season, and
 * the audit found the whole 2026 roster carries null `minutes_played`. Saying
 * "three of your starters are graduating" about minutes nobody has played yet
 * is a claim the data cannot support, however reasonable the projection is.
 */
export function positionGraduationStarters(athlete, ctx) {
  const position = canonicalPosition(athlete?.position);
  if (position === 'UNKNOWN' || !ctx.match) return null;

  const count = ctx.match.graduating_starters_at_position ?? null;
  if (!count) return null;

  const names = (ctx.match.graduating_starter_names_at_position || []).filter(Boolean);
  return defineEvidence('POSITION_GRADUATION_STARTERS', {
    strength: 64 + Math.min(12, count * 4),
    confidence: CONFIDENCE.MEDIUM,
    season: ctx.match.roster_season || null,
    source: 'roster_players:projected_minutes',
    freshness: ctx.freshness,
    data: { position, count, names, basis: 'projected' },
  });
}

export function squadGraduation(athlete, ctx) {
  const total = ctx.match?.graduating_total ?? null;
  if (!total) return null;
  return defineEvidence('SQUAD_GRADUATION', {
    strength: 44 + Math.min(12, total),
    confidence: CONFIDENCE.MEDIUM,
    season: ctx.match?.roster_season || null,
    source: 'roster_players',
    freshness: ctx.freshness,
    data: {
      total,
      // Carried so the sentence can name the year. Without it the copy read
      // "in that graduating group", which has no antecedent whenever this is
      // the only roster evidence selected.
      classYear: athlete?.classYear ?? null,
      starters: ctx.match?.graduating_starters_total ?? null,
      names: (ctx.match?.graduating_names_total || []).filter(Boolean),
    },
  });
}

/** How many players the programme carries at the athlete's position right now. */
export function positionGroupSize(athlete, ctx) {
  const position = canonicalPosition(athlete?.position);
  if (position === 'UNKNOWN' || !ctx.hasSquad) return null;

  const at = ctx.squad.filter((r) => canonicalPosition(r.position) === position);
  if (!at.length) return null;

  return defineEvidence('POSITION_GROUP_SIZE', {
    confidence: CONFIDENCE.HIGH,
    season: seasonSpan(ctx.squad),
    source: 'roster_players',
    freshness: ctx.freshness,
    data: { position, count: at.length, squadSize: ctx.squadSize },
  });
}

/**
 * Whether that group looks thin relative to the squad around it.
 *
 * Covers far more programmes than the departure signal does — squad
 * composition is readable wherever there is a roster at all, where departures
 * need a cohort in one specific arrival year — but it is an interpretation of
 * a ratio and never says what the programme needs.
 *
 * UNKNOWN rows are excluded from the denominator as well as the numerator. A
 * squad with twelve unclassifiable positions would otherwise look thin
 * everywhere at once, which is a fact about our scrape and not about them.
 */
const THIN_SHARE = 0.18;

/**
 * How many returning players at a position still counts as room.
 *
 * Three or fewer, in absolute terms rather than as a share: a share is
 * unstable on the small groups this reads (a goalkeeping group of two), and
 * "three defenders still eligible when you arrive" is a claim a coach can
 * check and recognise either way.
 */
const RETURNING_THIN = 3;

export function positionGroupScarcity(athlete, ctx) {
  const position = canonicalPosition(athlete?.position);
  if (position === 'UNKNOWN' || !ctx.hasSquad) return null;

  const classified = ctx.squad.filter((r) => canonicalPosition(r.position) !== 'UNKNOWN');
  if (classified.length < MIN_PLAUSIBLE_SQUAD) return null;

  const at = classified.filter((r) => canonicalPosition(r.position) === position);

  // Zero at a position is a fact about our parsing, not about the programme.
  // Every real college squad carries defenders, midfielders and forwards; a
  // 20-player roster reading as no defenders at all means the position column
  // was not understood, and "your squad looks relatively light at defender"
  // would be a confident sentence built on a scrape failure. Found when a test
  // programme with twenty midfielders and no defenders produced exactly that.
  if (!at.length) return null;

  const share = at.length / classified.length;
  if (share >= THIN_SHARE) return null;

  return defineEvidence('POSITION_GROUP_SCARCITY', {
    strength: 58 + Math.round((THIN_SHARE - share) * 100),
    confidence: CONFIDENCE.MEDIUM,
    season: seasonSpan(ctx.squad),
    source: 'roster_players',
    freshness: ctx.freshness,
    data: {
      position,
      count: at.length,
      classifiedSquad: classified.length,
      share: Math.round(share * 100) / 100,
    },
  });
}

/**
 * Who stays at the position, and when their eligibility runs out.
 *
 * Reuses depthChartAt from the philosophy layer rather than re-deriving a
 * depth chart, so the email and the Program Philosophy report describe the
 * same squad in the same terms.
 */
export function returningPositionDepth(athlete, ctx) {
  const position = canonicalPosition(athlete?.position);
  if (position === 'UNKNOWN' || !ctx.hasSquad) return null;

  const chart = depthChartAt(ctx.squad, position);
  if (!chart || !chart.length) return null;

  const classYear = athlete?.classYear ?? null;
  // "Returning" means still eligible in the season the athlete would arrive.
  // With no class year to compare against there is no returning group to
  // describe, only a squad — which positionGroupSize already covers.
  if (classYear == null) return null;

  const returning = chart.filter((p) => p.eligibleTo != null && Number(p.eligibleTo) >= Number(classYear));
  const unknownEligibility = chart.filter((p) => p.eligibleTo == null).length;
  if (!returning.length && !unknownEligibility) return null;

  // Only when the group is genuinely thin.
  //
  // This evidence exists to say "there is room here". Air Force returns all
  // eleven of its defenders through 2027, and the engine offered a coach
  // "around eleven of that group are still eligible" as a reason to sign
  // another one — an argument against our own athlete, in our own email. The
  // same asymmetry programMomentum already applies to a losing record: where
  // the reading is unfavourable there should be no evidence to select, rather
  // than a sentence somebody has to remember not to use.
  if (returning.length > RETURNING_THIN) return null;

  return defineEvidence('RETURNING_POSITION_DEPTH', {
    confidence: unknownEligibility > chart.length / 2 ? CONFIDENCE.LOW : CONFIDENCE.MEDIUM,
    season: seasonSpan(ctx.squad),
    source: 'roster_players:eligibility_end_year',
    freshness: ctx.freshness,
    data: {
      position,
      returning: returning.length,
      groupSize: chart.length,
      unknownEligibility,
      classYear,
    },
  });
}

/** Minutes due to leave the position group, by year. Reuses eligibilityCliff. */
export function eligibilityCliffEvidence(athlete, ctx) {
  const position = canonicalPosition(athlete?.position);
  if (position === 'UNKNOWN' || !ctx.hasSquad) return null;

  const cliff = eligibilityCliff(ctx.squad, { positions: [position] });
  if (!cliff || !cliff.length) return null;

  const classYear = athlete?.classYear ?? null;
  if (classYear == null) return null;

  // The years whose eligibility ends before the athlete would be competing for
  // minutes. Anything later is somebody else's opening.
  const relevant = cliff.filter((y) => Number(y.year) <= Number(classYear));
  const players = relevant.reduce((s, y) => s + (y.byPosition[0]?.players || 0), 0);
  const minutes = relevant.reduce((s, y) => s + (y.byPosition[0]?.minutes || 0), 0);
  if (!players) return null;

  return defineEvidence('ELIGIBILITY_CLIFF', {
    confidence: minutes > 0 ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW,
    season: seasonSpan(ctx.squad),
    source: 'roster_players:eligibility_end_year',
    freshness: ctx.freshness,
    data: { position, players, projectedMinutes: minutes, byYear: relevant, classYear },
  });
}

// ---------------------------------------------------------------------------
// Programme record
// ---------------------------------------------------------------------------

export function conferenceTitle(athlete, ctx) {
  const c = ctx.college;
  if (!c?.conference_champion_2025) return null;
  return defineEvidence('CONFERENCE_TITLE', {
    confidence: CONFIDENCE.HIGH,
    season: '2025',
    source: 'colleges:conference_champion_2025',
    freshness: ctx.freshness,
    data: { conference: c.conference_champion_name || c.conference || null },
  });
}

export function postseasonResult(athlete, ctx) {
  const round = ctx.college?.postseason_2025_round;
  if (!round) return null;
  return defineEvidence('POSTSEASON_RESULT', {
    // A deeper run is a better reason to write. The ladder is soccer's own,
    // not basketball's — there is no Sweet 16 in an NCAA soccer bracket.
    strength: 70 + ({ appearance: 0, r32: 3, r16: 6, quarter: 9, semi: 12, final: 15, champion: 18 }[round] ?? 0),
    confidence: CONFIDENCE.HIGH,
    season: '2025',
    source: 'colleges:postseason_2025_round',
    freshness: ctx.freshness,
    data: { round },
  });
}

/**
 * Which way the record is heading.
 *
 * Returns null for a programme that has declined or held flat. That is a
 * deliberate asymmetry rather than an oversight: the brief asked for no
 * negative personalisation, and the honest way to honour that is to have no
 * evidence to select rather than a NEUTRAL object that some future renderer
 * finds a sentence for. A programme having a hard time is written to about
 * something else.
 */
const MOMENTUM_RISING = 0.05;
const MOMENTUM_STRONG_WIN_PCT = 0.65;

export function programMomentum(athlete, ctx) {
  const recent = num(ctx.college?.recent_win_pct);
  const prior = num(ctx.college?.prior_win_pct);
  if (recent == null) return null;

  let classification = null;
  if (prior != null && recent - prior >= MOMENTUM_RISING) classification = 'RISING';
  else if (recent >= MOMENTUM_STRONG_WIN_PCT) classification = 'STRONG';

  if (!classification) return null;

  return defineEvidence('PROGRAM_MOMENTUM', {
    strength: classification === 'STRONG' ? 60 : 56,
    confidence: prior == null ? CONFIDENCE.LOW : CONFIDENCE.MEDIUM,
    season: 'recent vs prior two seasons',
    source: 'colleges:recent_win_pct',
    freshness: ctx.freshness,
    data: {
      classification,
      recentWinPct: Math.round(recent * 100) / 100,
      priorWinPct: prior == null ? null : Math.round(prior * 100) / 100,
    },
  });
}

// ---------------------------------------------------------------------------
// People and academics
// ---------------------------------------------------------------------------

/**
 * How long the current coach has been in post, bounded to what we watched.
 *
 * `tenureFor` measures inside the observed window and refuses to assert beyond
 * it, so a coach present in every season on file is "4+ seasons" and never
 * "since 2007". That bound is carried into the evidence as `windowBounded` so
 * the renderer cannot accidentally write an appointment year we never saw.
 */
export function coachContext(athlete, ctx) {
  if (!ctx.coachRows.length) return null;
  const tenure = tenureFor(ctx.coachRows);
  // `current` is { coach, since, seasons } where `seasons` is a COUNT, not a
  // list, and the name is on `coach`.
  if (!tenure?.current?.coach) return null;

  const seasons = tenure.current.seasons ?? 0;
  if (!seasons) return null;

  // When we may NOT claim a start date.
  //
  // Two ways that happens, and the second was found on real data. The obvious
  // one is a coach already in post in the earliest season we looked at. The
  // other is an unreadable page before their first observed season: Notre
  // Dame's 2022 and 2023 staff pages both came back `no-usable-page`, so
  // `tenureFor` starts Chad Riley's segment at 2024 and the evidence read "two
  // seasons into the job" about a man who has had it since 2018.
  //
  // An unknown season before the segment is not evidence the coach was absent
  // — it is evidence we did not look successfully, which is the distinction
  // coachTenure.js exists to preserve and which this was throwing away.
  const earliestObserved = tenure.seasons.length ? tenure.seasons[0] : null;
  const unknownBefore = (tenure.unknownSeasons ?? [])
    .some((s) => Number(s) < tenure.current.since);
  const windowBounded = unknownBefore
    || (earliestObserved != null && tenure.current.since <= earliestObserved);

  // Asked about the last season we can actually name somebody for. Asking
  // about the athlete's arrival year always returns null — coach_seasons stops
  // at 2026 — which would read as "we could not tell" for every programme
  // rather than for the ones where it is true.
  const inPost = tenure.knownThrough == null ? null : stillInPost(tenure, tenure.knownThrough);

  return defineEvidence('COACH_CONTEXT', {
    strength: seasons <= 2 ? 50 : 45,
    confidence: CONFIDENCE.MEDIUM,
    season: `${tenure.current.since}-${tenure.knownThrough ?? tenure.current.since}`,
    source: 'coach_seasons',
    freshness: ctx.freshness,
    data: {
      name: tenure.current.coach,
      seasonsObserved: seasons,
      since: tenure.current.since,
      // The renderer must never print `since` as an appointment year when this
      // is true; it is the earliest season we looked, not the year they began.
      windowBounded,
      knownThrough: tenure.knownThrough,
      stillInPost: inPost,
      context: seasons <= 2 && !windowBounded ? 'NEW' : 'ESTABLISHED',
    },
  });
}

/**
 * Whether the athlete can actually study what they came to study.
 *
 * Reuses the existing notable-majors matching exactly as buildEmailContext
 * does, so the two can never disagree about whether a school offers a subject.
 * Returns null when the athlete has stated no intended major — which is the
 * live case for both pilot athletes, and is a gap in the profile rather than
 * in the school data.
 */
export function academicFit(athlete, ctx) {
  const label = majorLabelFor(athlete?.intendedMajor);
  if (!label) return null;
  const offered = ctx.college?.notable_majors || [];
  const list = Array.isArray(offered) ? offered : safeParse(offered);
  if (!list.includes(label)) return null;

  return defineEvidence('ACADEMIC_FIT', {
    confidence: CONFIDENCE.HIGH,
    season: null,
    source: 'colleges:notable_majors',
    freshness: ctx.freshness,
    data: { major: label, stated: athlete.intendedMajor },
  });
}

/**
 * How the programme fills holes. Internal by registry, never email-eligible.
 *
 * Kept in the pipeline anyway so that when engagement data arrives we can ask
 * whether transfer-heavy programmes reply at a different rate — a question we
 * cannot ask retrospectively about evidence we never generated.
 */
export function transferBehaviour(athlete, ctx) {
  if (!ctx.hasSquad || !ctx.college?.name) return null;
  const arrivals = namedArrivals(ctx.squad, { school: ctx.college.name });
  if (!arrivals.length) return null;

  const position = canonicalPosition(athlete?.position);
  return defineEvidence('TRANSFER_BEHAVIOUR', {
    confidence: CONFIDENCE.MEDIUM,
    season: seasonSpan(ctx.squad),
    source: 'roster_players:prior_programme',
    freshness: ctx.freshness,
    data: {
      arrivals: arrivals.length,
      atPosition: position === 'UNKNOWN'
        ? null
        : arrivals.filter((a) => a.position === position).length,
      squadSize: ctx.squadSize,
    },
  });
}

/** Every generator, in one place, so adding a kind is adding a line. */
// ---------------------------------------------------------------------------
// Recruiting history
//
// What separates these from the roster-derived international kinds above is
// the verb. A roster row says a New Zealander WAS here. An arrival says a New
// Zealander CAME here, between two rosters we both hold, in a named intake —
// which is the version a coach recognises as a decision somebody made rather
// than a fact about a list.
//
// Everything below is gated four ways, and every gate exists because the
// sentence it protects would otherwise be confidently wrong:
//
//   sport        men's only. 9.7% of women's arrivals carry a nationality flag
//                against 29.1% of men's, and roster data cannot separate
//                under-recording from a smaller international share.
//   coverage     three comparable transitions, or the history is one intake.
//   field        position recorded on 80% of arrivals, or "one defender" means
//                "one of the arrivals we could classify".
//   presence     a count of at least one. Absence is never evidence — a zero
//                is real data internally and has no business in an email.
// ---------------------------------------------------------------------------

/** "2024" or "2024-2026", in the form `firstSeason` already parses. */
const spanOf = (seasons = []) => (seasons.length > 1
  ? `${seasons[0]}-${seasons[seasons.length - 1]}`
  : seasons[0] ?? null);

/** The sports whose nationality data is licensed for outreach claims. */
export const RECRUITING_EVIDENCE_SPORTS = Object.freeze(['mens-soccer']);

/**
 * This athlete's observations at this programme, or null if unlicensed.
 *
 * One gate for all four generators, so a new one cannot be added that forgets
 * a check — the same argument as reading `tier` from the registry rather than
 * letting a generator declare it.
 */
function recruitingObservations(athlete, ctx) {
  const patterns = ctx?.recruiting;
  if (!patterns) return null;
  if (!RECRUITING_EVIDENCE_SPORTS.includes(ctx.sport)) return null;
  if (patterns.dataStatus?.status !== DATA_STATUS.LICENSED) return null;
  if (patterns.coverage?.status !== COVERAGE.SUFFICIENT) return null;
  return observationsFor({
    country: athlete?.country,
    // Already canonical — `normaliseEvidenceAthlete` ran `canonicalPosition`.
    // Sub-positions do not exist by the time anything here can see them.
    canonicalPosition: athlete?.position,
  }, patterns);
}

/** May a count of this position be stated as if it were the whole count? */
function positionFieldLicensed(athlete, ctx) {
  const position = athlete?.position;
  if (!position || position === 'UNKNOWN') return false;
  const share = ctx?.recruiting?.positions?.knownShare;
  return typeof share === 'number' && share >= FIELD_COVERAGE_FLOOR;
}

/**
 * The observation with the athlete's own name taken out of it.
 *
 * `roster_players` contains a Rhys Davies who arrived at Bellarmine from New
 * Zealand in 2024. Without this the email opened "I saw you've had Rhys Davies
 * come through from New Zealand" — addressed to a coach, about the recruit
 * being introduced two lines below. Whether it is the same person or a
 * namesake does not matter: neither reading is a sentence to send.
 *
 * The frozen roster generators guard this with `withoutAthlete`; this is the
 * same rule applied to arrivals, and every count is rebuilt from the filtered
 * rows rather than adjusted, so a total can never disagree with the names
 * behind it.
 */
function withoutSelf(observation, athlete) {
  const rows = withoutAthlete(
    (observation?.named ?? []).map((n) => ({ ...n, player_name: n.playerName })),
    athlete,
  );
  const seasons = [...new Set(rows.map((n) => String(n.arrivalSeason)))].sort();
  const transitions = new Set(rows.map((n) => n.sourceTransition));
  return {
    rows,
    total: rows.length,
    seasons,
    transitions: [...transitions].sort(),
    transitionsWithArrival: transitions.size,
    coachAttributed: rows.filter((n) => n.coachAttribution === COACH_ATTRIBUTION.ATTRIBUTED).length,
  };
}

/**
 * The single arrival this observation may name out loud, if any.
 *
 * One arrival only, and only where the identity was EXACT. A RECONCILED row is
 * one the build merged from two spellings of one person; the surviving
 * spelling is our choice rather than the programme's, and putting our choice in
 * an email to the person who signed them is how a good sentence becomes an
 * obviously wrong one. The count is unaffected — an aggregate may rest on a
 * reconciled row, a name may not.
 */
function licensedName(view) {
  if (!view || view.total !== 1) return null;
  const only = view.rows[0];
  if (!only || only.identityMethod !== IDENTITY_METHOD.EXACT) return null;
  return { name: only.playerName, season: only.arrivalSeason };
}

/**
 * The arrivals behind a claim, for the log and nothing else.
 *
 * Kept under `provenance` rather than beside the copy fields deliberately.
 * `priorProgramme` is a name match and is AMBIGUOUS for 325 men's arrivals; it
 * is here so an audit can walk a claim back, and it is nested so that no copy
 * author reaches for it while writing a clause. Nothing in FACT_COPY reads this
 * key, and a test asserts it.
 */
const supportingArrivals = (rows = []) => rows.map((n) => ({
  playerName: n.playerName,
  season: n.arrivalSeason,
  transition: n.sourceTransition,
  position: n.canonicalPosition,
  country: n.country,
  region: n.region,
  entryType: n.entryType,
  identityMethod: n.identityMethod,
  reconciledFrom: n.reconciledFrom ?? [],
  coach: n.coach,
  coachAttribution: n.coachAttribution,
  priorProgramme: n.priorProgramme,
  priorConfidence: n.priorConfidence,
}));

/** The coverage and licensing state behind a claim, carried on every kind. */
const recruitingProvenance = (athlete, ctx, observation, scope, region = null) => ({
  athleteCountry: athlete?.country ?? null,
  athletePosition: athlete?.position ?? null,
  athleteRegion: region,
  observedTransitions: observation?.coverage?.observedTransitions ?? null,
  possibleTransitions: observation?.coverage?.possibleTransitions ?? null,
  transitions: observation?.coverage?.transitions ?? [],
  coverageStatus: observation?.coverage?.status ?? null,
  coverageScope: observation?.coverage?.scope ?? null,
  fieldCoverage: ctx?.recruiting?.positions?.knownShare ?? null,
  sportDataStatus: ctx?.recruiting?.dataStatus?.status ?? null,
  specificity: observation?.specificity ?? null,
  scope,
  supporting: [],
});

/**
 * An arrival from the athlete's country, at the athlete's position.
 *
 * The most specific thing the programme-level history can say, and the reason
 * the phase was worth building: "you've brought in a defender from New Zealand"
 * is checkable against one intake, where "you've had New Zealanders" is
 * checkable against a decade of roster pages.
 */
export function arrivalSameCountryPosition(athlete, ctx) {
  const obs = recruitingObservations(athlete, ctx);
  if (!obs || !positionFieldLicensed(athlete, ctx)) return null;

  const o = obs.sameCountryPosition;
  const view = withoutSelf(o, athlete);
  if (view.total < 1) return null;

  const attributable = new Set(ctx.recruiting.coach?.coverage?.transitions ?? []);
  /**
   * Whether every supporting arrival happened under the coach we are writing
   * to, which decides whether the copy may address them directly.
   *
   * "You brought in Hayden Aish in 2023" said to a coach appointed in 2025 is a
   * sentence about somebody else's work with the recipient's name on it. Where
   * the arrivals predate them, the clause speaks about the PROGRAMME instead —
   * the same fact, addressed to the right party.
   */
  const coachOwned = view.rows.every((n) => n.coachAttribution === COACH_ATTRIBUTION.ATTRIBUTED
    && attributable.has(n.sourceTransition));

  const one = licensedName(view);
  return defineEvidence('ARRIVAL_SAME_COUNTRY_POSITION', {
    strength: 95 + Math.min(3, view.total - 1),
    confidence: CONFIDENCE.HIGH,
    season: spanOf(view.seasons),
    source: 'recruiting_arrivals',
    freshness: ctx.freshness,
    data: {
      country: athlete.country,
      position: athlete.position,
      count: view.total,
      seasons: view.seasons,
      transitionsWithArrival: view.transitionsWithArrival,
      observedTransitions: o.coverage.observedTransitions,
      coachAttributed: view.coachAttributed,
      coachOwned,
      // Present only where naming is licensed. Absent is not "we have no
      // name" — it is "we may not use the one we have".
      name: one?.name ?? null,
      nameSeason: one?.season ?? null,
      provenance: {
        ...recruitingProvenance(athlete, ctx, o, 'PROGRAMME', obs.player.region),
        supporting: supportingArrivals(view.rows),
      },
    },
  });
}

/**
 * The current coach's own observed recruiting from the athlete's country.
 *
 * The only kind in the group addressed to the person reading it, and the one
 * with the strictest gate. Three ATTRIBUTED transitions, counted from the
 * tenure rather than from the arrivals, so a quiet year still counts against
 * the denominator. A coach's first roster is excluded outright: it is their
 * predecessor's recruiting, and crediting it to them is the single most likely
 * way to make a confident, false claim about how a programme recruits.
 */
export function coachArrivalSameCountry(athlete, ctx) {
  const obs = recruitingObservations(athlete, ctx);
  if (!obs) return null;

  const scope = ctx.recruiting.coach;
  if (!scope?.coach) return null;
  if (scope.coverage?.status !== COVERAGE.SUFFICIENT) return null;

  const o = obs.coachSameCountry;
  const view = withoutSelf(o, athlete);
  if (view.total < 1) return null;

  // Every row here is ATTRIBUTED inside the coach's own transitions by
  // construction — coachHistory filters on exactly that — but the claim is
  // strong enough to be worth refusing rather than trusting a caller.
  if (view.rows.some((n) => n.coachAttribution !== COACH_ATTRIBUTION.ATTRIBUTED)) return null;

  const samePosition = positionFieldLicensed(athlete, ctx)
    && view.rows.every((n) => n.canonicalPosition === athlete.position);
  const one = licensedName(view);

  return defineEvidence('COACH_ARRIVAL_SAME_COUNTRY', {
    strength: 99 + Math.min(1, view.total - 1),
    confidence: CONFIDENCE.HIGH,
    season: spanOf(view.seasons),
    source: 'recruiting_arrivals',
    freshness: ctx.freshness,
    data: {
      country: athlete.country,
      coach: scope.coach,
      count: view.total,
      seasons: view.seasons,
      transitionsWithArrival: view.transitionsWithArrival,
      attributableTransitions: scope.coverage.observedTransitions,
      earliestSupportedSeason: scope.earliestSupportedSeason,
      latestSupportedSeason: scope.latestSupportedSeason,
      // Named only when every supporting arrival shares the athlete's
      // position, which is what lets the strongest kind also carry the most
      // specific fact instead of losing it to dedupe.
      position: samePosition ? athlete.position : null,
      name: one?.name ?? null,
      nameSeason: one?.season ?? null,
      provenance: {
        ...recruitingProvenance(athlete, ctx, o, 'COACH', obs.player.region),
        supporting: supportingArrivals(view.rows),
      },
    },
  });
}

/**
 * An arrival from the athlete's part of the world, at their position.
 *
 * The canonical recruiting-region taxonomy, which is NOT the one
 * HISTORICAL_SAME_REGION uses — that kind keeps its two-country map and its
 * exact behaviour. The region name never reaches the copy: a coach has no idea
 * what OCEANIA is, and the supporting country is both more natural and more
 * checkable.
 */
export function arrivalSameRegionPosition(athlete, ctx) {
  const obs = recruitingObservations(athlete, ctx);
  if (!obs || !positionFieldLicensed(athlete, ctx)) return null;

  const o = obs.sameRegionPosition;
  const view = withoutSelf(o, athlete);
  if (view.total < 1) return null;

  // The athlete's own country is excluded, exactly as the frozen regional kind
  // excludes it: otherwise the regional sentence restates the country one from
  // the same rows, and dedupe is choosing between two views of one fact.
  const peers = view.rows.filter((n) => n.country && n.country !== athlete.country);
  if (!peers.length) return null;

  const countries = [...new Set(peers.map((n) => n.country))].sort();
  const seasons = [...new Set(peers.map((n) => n.arrivalSeason))].sort();
  const one = peers.length === 1 && peers[0].identityMethod === IDENTITY_METHOD.EXACT
    ? { name: peers[0].playerName, season: peers[0].arrivalSeason }
    : null;

  return defineEvidence('ARRIVAL_SAME_REGION_POSITION', {
    strength: 78 + Math.min(2, peers.length - 1),
    confidence: CONFIDENCE.HIGH,
    season: spanOf(seasons),
    source: 'recruiting_arrivals',
    freshness: ctx.freshness,
    data: {
      position: athlete.position,
      countries,
      count: peers.length,
      seasons,
      observedTransitions: o.coverage.observedTransitions,
      name: one?.name ?? null,
      nameSeason: one?.season ?? null,
      // The key is carried for the log and never for the prose.
      region: obs.player.region,
      provenance: {
        ...recruitingProvenance(athlete, ctx, o, 'PROGRAMME', obs.player.region),
        supporting: supportingArrivals(peers),
      },
    },
  });
}

/**
 * How many arrived at this position, per intake. INTERNAL ONLY.
 *
 * `emailEligible: false` in the registry, so selection separates it before
 * composition can see it. It exists to be read in the operator panel and the
 * log while we decide whether "you've added a defender in each of the last four
 * intakes" can be said without it being heard as "so you need another".
 */
export function positionIntakeHistory(athlete, ctx) {
  const obs = recruitingObservations(athlete, ctx);
  if (!obs || !positionFieldLicensed(athlete, ctx)) return null;

  const o = obs.positionHistory;
  const view = withoutSelf(o, athlete);
  if (view.total < 1) return null;

  return defineEvidence('POSITION_INTAKE_HISTORY', {
    strength: 60,
    confidence: CONFIDENCE.HIGH,
    season: spanOf(view.seasons),
    source: 'recruiting_arrivals',
    data: {
      position: athlete.position,
      count: view.total,
      seasons: view.seasons,
      byTransition: o.byTransition,
      transitionsWithArrival: view.transitionsWithArrival,
      observedTransitions: o.coverage.observedTransitions,
      meanPerTransition: o.coverage.observedTransitions
        ? view.total / o.coverage.observedTransitions : null,
      coachAttributed: view.coachAttributed,
      provenance: {
        ...recruitingProvenance(athlete, ctx, o, 'PROGRAMME', obs.player.region),
        supporting: supportingArrivals(view.rows),
      },
    },
  });
}

export const GENERATORS = Object.freeze([
  coachArrivalSameCountry,
  arrivalSameCountryPosition,
  arrivalSameRegionPosition,
  positionIntakeHistory,
  historicalSameCountry,
  currentSameCountry,
  historicalSameRegion,
  internationalRoster,
  internationalShare,
  positionGraduation,
  positionGraduationStarters,
  squadGraduation,
  positionGroupSize,
  positionGroupScarcity,
  returningPositionDepth,
  eligibilityCliffEvidence,
  conferenceTitle,
  postseasonResult,
  programMomentum,
  coachContext,
  academicFit,
  transferBehaviour,
]);

/** Runs every generator and drops the ones with nothing to say. */
export function generateEvidence(athlete, ctx) {
  return GENERATORS.map((fn) => fn(athlete, ctx)).filter(Boolean);
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeParse(v) {
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
}
