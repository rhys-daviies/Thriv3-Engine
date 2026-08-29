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
export const GENERATORS = Object.freeze([
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
