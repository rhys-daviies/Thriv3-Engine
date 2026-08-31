/**
 * Programme philosophy: what a first year at a programme has looked like, who
 * ran the seasons that show it, and who takes the minutes when a place comes
 * free — for a list of schools, and for one athlete.
 *
 * Pure functions returning plain values. `server/index.js` owns the headers,
 * the same split `exportGraduatingDatabase.js` uses.
 */
import db from '../db/client.js';
import {
  philosophyFor, fitFrom, poolBenchmarks, percentileOfLadderTop, poolMixForBand,
} from '../lib/philosophyQueries.js';
import { lifecyclePool, lifecycleRows } from '../lib/lifecycleQueries.js';
import { buildLifecycleSummary } from '../../shared/report/lifecycleSummary.js';
import { buildPressureSummary } from '../../shared/report/pressure.js';
import { buildSquadSummary } from '../../shared/report/squad.js';
import { buildPositionUtilisationSummary } from '../../shared/report/positionUtilisation.js';
import { readableRows } from '../../shared/lifecycle/readable.js';
import { evidenceLimitsFor } from '../lib/reportLimits.js';
import {
  RECRUIT_SEASON, SQUAD_SEASON, SEASONS,
  freshmanPoints, newcomerPoints, arrivalWindow,
  intakeBySeason, positionSeasonGrid, eligibilityCliff, namedArrivals, depthChartAt,
} from '../../shared/philosophy.js';
import { positionLabel } from '../../shared/positions.js';
import { buildReportSummary } from '../../shared/report/summary.js';
import { coachAttribution } from '../../shared/coachAttribution.js';
import { planSections } from '../../shared/report/sections.js';

const selectPlayer = db.prepare(
  'SELECT id, full_name, position, nationality, recruiting_class_year, graduation_year, sport, football_ability FROM players WHERE id = ?',
);

export function loadAthlete(playerId) {
  const p = selectPlayer.get(playerId);
  if (!p) throw new Error(`Unknown player: ${playerId}`);
  return p;
}

/**
 * One compact row per school for the tab.
 *
 * Deliberately trimmed: `observations` and `byPosition` are per-position detail
 * that only a report reads, and shipping them would multiply a twenty-school
 * response by an order of magnitude.
 *
 * `reports.playerSectionsIncluded` is decided HERE rather than on the client, because
 * `playerFit` can refuse a cohort where `programmePhilosophy` succeeds — the
 * client must not be left guessing which of the two buttons will fail.
 */
export function philosophySummaries({ playerId, collegeIds } = {}) {
  const ids = Array.isArray(collegeIds) ? collegeIds : [];
  if (!ids.length) throw new Error('collegeIds is required');
  if (ids.length > 40) throw new Error(`Too many schools at once: ${ids.length}`);
  const athlete = playerId ? loadAthlete(playerId) : null;

  const summaries = {};
  for (const id of ids) {
    const found = philosophyFor(id);
    if (!found) {
      summaries[id] = { unavailable: 'no college on file for that id' };
      continue;
    }
    const { college: col, philosophy: ph, rows } = found;
    if (!ph.freshman) {
      // Two different absences. MIT has four seasons of freshmen and a minutes
      // figure for almost none of them; saying "no roster seasons on file"
      // there would be as wrong as the zero it replaces.
      summaries[id] = {
        school: col.name, sport: col.sport, division: col.division,
        unavailable: rows.length
          ? 'this programme’s rosters carry too few recorded minutes to read'
          : 'no roster seasons on file for this programme',
      };
      continue;
    }
    // A sport mismatch is a real bug signal, not something to paper over by
    // quietly reporting the other sport's roster.
    const sportMatches = !athlete || athlete.sport === col.sport;
    // Read from the programme already loaded above. Reloading it here cost a
    // second roster, coach and squad query per school — up to eighty for one
    // twenty-school tab.
    const fit = sportMatches && athlete ? fitFrom(found, athlete)?.fit : null;

    const top = ph.ladder[0] ?? null;
    summaries[id] = {
      school: col.name, sport: col.sport, division: col.division,
      verdict: ph.verdict ? {
        verdict: ph.verdict.verdict, note: ph.verdict.note,
        describes: ph.verdict.describes ?? ph.describes,
      } : null,
      coach: ph.coach?.coach ?? null,
      coachForRecruitSeason: ph.coachForRecruitSeason,
      coachStillInPost: ph.coachStillInPost,
      seasonsObserved: ph.seasonsObserved,
      ladderTop: top ? {
        median: top.median, low: top.low, high: top.high,
        band: top.band, agreement: top.agreement,
      } : null,
      dials: ph.dials,
      cohortLadderTop: fit?.ladder?.[0]
        ? { median: fit.ladder[0].median, cohort: fit.cohort } : null,
      reports: {
        // Renamed, not repurposed. If `player` survived with inverted meaning,
        // an un-updated client would grey out the only remaining button and
        // the feature would look broken with no error anywhere.
        available: true,
        playerSectionsIncluded: Boolean(fit),
        playerReason: sportMatches
          ? (fit ? null : 'not enough of this athlete\'s cohort on file')
          : `this athlete plays ${athlete.sport}, the programme is ${col.sport}`,
      },
    };
  }
  return { recruitSeason: RECRUIT_SEASON, summaries };
}

/**
 * The full model behind the generic report.
 *
 * Kept separate from the drawing so the numbers can be asserted without
 * rendering a PDF, and so the two documents cannot drift apart.
 */
export function programmeModel({ collegeId } = {}) {
  const found = philosophyFor(collegeId);
  if (!found) throw new Error(`Unknown college: ${collegeId}`);
  return buildProgrammeModel(found, poolBenchmarks(found.college.sport));
}

/**
 * The same model, from a programme already loaded.
 *
 * Separated from the entry point above so one request loads one programme.
 * `programReportModel` needs `found` for its own sections and used to call
 * `programmeModel` — and then `fitFor` — each of which loaded the whole
 * programme again: three roster queries, three squad queries and three runs
 * of `programmePhilosophy` to build one document.
 *
 * Takes `benchmarks` rather than fetching them so the pool cache is consulted
 * once per request too, and so this stays free of query code.
 */
export function buildProgrammeModel(found, benchmarks) {
  const { college: col, philosophy: ph } = found;
  const top = ph.ladder[0] ?? null;
  const meanVacated = ph.observations.length
    ? ph.observations.reduce((s, o) => s + o.vacatedStarterShare, 0) / ph.observations.length
    : null;

  return {
    kind: 'programme',
    recruitSeason: RECRUIT_SEASON,
    college: col,
    describes: ph.describes,
    verdict: ph.verdict,
    tenure: ph.tenure,
    coach: ph.coach,
    coachForRecruitSeason: ph.coachForRecruitSeason,
    coachStillInPost: ph.coachStillInPost,
    seasons: (ph.freshman?.seasons ?? []).map((s) => ({
      season: s.season, intake: s.intake, played: s.played,
      starters: s.bands.impact, share: s.shareOfSquadMinutes,
    })),
    ladder: ph.ladder,
    weightedLadder: ph.weightedLadder,
    dials: ph.dials,
    byPosition: ph.byPosition,
    benchmarks: benchmarks?.sufficient ? {
      ladderByRank: benchmarks.ladderByRank,
      dials: benchmarks.dials,
      programmeDials: benchmarks.programmeDials,
      byOrigin: benchmarks.byOrigin,
      vacancy: benchmarks.vacancy,
      byPosition: benchmarks.byPosition,
      poolMix: poolMixForBand(benchmarks, meanVacated),
      programmes: benchmarks.programmes,
      ladderTopPercentile: percentileOfLadderTop(benchmarks, top?.median ?? null),
    } : null,
    benchmarksReason: benchmarks?.sufficient ? null : benchmarks?.reason ?? 'pool not readable',
  };
}

/** The same programme, read for one athlete. */
export function playerProgrammeModel({ playerId, collegeId } = {}) {
  const athlete = loadAthlete(playerId);
  // Loaded once and read twice. The athlete is resolved first so an unknown
  // player still throws before an unknown college, which is what the route's
  // 404/400 split reads.
  const loaded = philosophyFor(collegeId);
  if (!loaded) throw new Error(`Unknown college: ${collegeId}`);
  const col = loaded.college;
  if (athlete.sport !== col.sport) {
    throw new Error(`${athlete.full_name} plays ${athlete.sport}; ${col.name} is ${col.sport}`);
  }
  const base = buildProgrammeModel(loaded, poolBenchmarks(col.sport));
  const found = fitFrom(loaded, athlete);
  // The season THIS athlete would arrive in, which is not necessarily the one
  // the squad data describes. Ryan Billings is a 2027 entrant, and a report
  // built on RECRUIT_SEASON told him "the 2026 season has not been played" —
  // true, and a year adrift of the question he is asking.
  const entrySeason = Number(athlete.recruiting_class_year) || RECRUIT_SEASON;
  return {
    ...base,
    kind: 'player',
    entrySeason,
    // Stated rather than backfilled: coach_seasons stops at 2026, so for a
    // later entrant there is no row and we must not reuse the 2026 name.
    coachForEntrySeason: entrySeason === RECRUIT_SEASON ? base.coachForRecruitSeason : null,
    entrySeasonKnown: entrySeason === RECRUIT_SEASON,
    athlete: {
      id: athlete.id,
      name: athlete.full_name,
      position: athlete.position,
      positionLabel: positionLabel(athlete.position),
      nationality: athlete.nationality,
      classYear: athlete.recruiting_class_year ?? athlete.graduation_year ?? null,
    },
    fit: found?.fit ?? null,
  };
}


/**
 * Everything one Program Report needs, as plain JSON.
 *
 * One model rather than two: the athlete half is additive — it appends facets
 * and swaps the masthead — so the split that used to exist earned nothing but
 * a duplicated programme half.
 */
export function programReportModel({ collegeId, playerId = null } = {}) {
  const found = philosophyFor(collegeId);
  if (!found) throw new Error(`Unknown college: ${collegeId}`);
  const { college: col, philosophy: ph, rows, squad } = found;

  let athlete = null;
  if (playerId) {
    athlete = loadAthlete(playerId);
    if (athlete.sport !== col.sport) {
      throw new Error(`${athlete.full_name} plays ${athlete.sport}; ${col.name} is ${col.sport}`);
    }
  }

  const base = buildProgrammeModel(found, poolBenchmarks(col.sport));
  const window = arrivalWindow(rows, { seasons: SEASONS });
  const transferPoints = newcomerPoints(rows, { seasons: SEASONS });

  const entrySeason = athlete
    ? Number(athlete.recruiting_class_year) || RECRUIT_SEASON
    : RECRUIT_SEASON;
  const fit = athlete ? fitFrom(found, athlete)?.fit ?? null : null;

  const model = {
    ...base,
    kind: athlete ? 'report+player' : 'report',
    squadSeason: SQUAD_SEASON,
    entrySeason,
    entrySeasonKnown: entrySeason === RECRUIT_SEASON,
    coachForEntrySeason: entrySeason === RECRUIT_SEASON ? base.coachForRecruitSeason : null,

    freshman: {
      points: freshmanPoints(rows, { seasons: SEASONS }),
      intake: intakeBySeason(rows, { seasons: SEASONS }),
      grid: positionSeasonGrid(rows, { seasons: SEASONS }),
      // `progression` and `retention` used to live here: a year-one-to-year-two
      // comparison and a fraction of first-years still on the next roster. Both
      // are answered properly and with their denominators by the lifecycle
      // layer below, and two development models in one payload is one too many.
    },

    transfer: {
      points: transferPoints,
      window,
      // An empty array means nothing on its own: a quarter of programmes sign
      // nobody, and a season with no prior season on file cannot be judged.
      measurable: window.measurable.length > 0,
      density: transferPoints.length === 0 ? 'none'
        : transferPoints.length <= 5 ? 'few' : 'many',
    },

    squad: {
      season: SQUAD_SEASON,
      rostered: squad.length,
      cliff: eligibilityCliff(squad),
      arrivals: namedArrivals(squad, { school: col.name }),
      depth: athlete ? depthChartAt(squad, athlete.position) : null,
    },

    athlete: athlete ? {
      id: athlete.id,
      name: athlete.full_name,
      position: athlete.position,
      positionLabel: positionLabel(athlete.position),
      nationality: athlete.nationality,
      origin: athlete.nationality && !/^(usa|united states)$/i.test(athlete.nationality)
        ? 'international' : 'domestic',
      classYear: athlete.recruiting_class_year ?? athlete.graduation_year ?? null,
      level: athlete.football_ability ?? null,
    } : null,
    fit,
  };

  // Additive. Nothing above changes shape, so every existing reader — the
  // PDF, the tab, the tests — sees exactly what it saw before, and the v2
  // pages have somewhere to read from that is not the renderer.
  const summary = buildReportSummary({ model, philosophy: ph, squadRows: squad });
  // The lifecycle layer. Also additive: the pool half is cached per sport and
  // per process, and the programme half is a few indexed lookups.
  const lifeRows = lifecycleRows(col.name, col.sport);
  const lifePool = lifecyclePool(col.sport);
  const lifecycle = buildLifecycleSummary({
    rows: lifeRows,
    pool: lifePool,
    division: col.division,
    programme: col.name,
    athlete: model.athlete,
  });
  /**
   * Position intake. Attached and NOT rendered: no section reads it yet, and
   * nothing in `planSections` mentions it, so every existing page and page
   * count is unchanged. It is here so the intelligence can be inspected
   * against real programmes before a page is designed for it.
   *
   * It reads the same five-season window the lifecycle layer does, because it
   * needs 2026 — that roster is the current known intake — and it reads no
   * minutes at all, which is why it survives at programmes where the
   * performance analyses do not.
   */
  const pressure = buildPressureSummary({
    rows: lifeRows,
    pool: lifePool,
    division: col.division,
    athlete: model.athlete,
  });
  /**
   * Minute concentration and years of study. Attached and NOT rendered, on the
   * same terms as `pressure`: no section reads it, nothing in `planSections`
   * mentions it, and every existing page and page count is unchanged.
   *
   * These read the readable rows rather than the raw ones — unlike intake,
   * both halves of this are questions about minutes, and the experience half
   * keeps its roster composition answerable even where the minutes are not.
   */
  const squadProfile = buildSquadSummary({
    rows: readableRows(lifeRows),
    pool: lifePool,
    division: col.division,
  });
  /**
   * Minute distribution within a position. Attached and NOT rendered, on the
   * same terms as `pressure` and `squadProfile`.
   *
   * Both shapes are handed over rather than one being chosen here: the athlete
   * half reads the athlete's own canonical position, and the programme half is
   * a lookup across the three supported positions, so Phase 9B can decide what
   * a generic report does with it. A goalkeeper gets an athlete entry that says
   * the analysis is not reported at that position.
   */
  const positionUtilisation = buildPositionUtilisationSummary({
    rows: readableRows(lifeRows),
    pool: lifePool,
    division: col.division,
    athlete: model.athlete,
  });
  /**
   * Whose measured seasons these are.
   *
   * ADDITIVE AND NOT ANALYTICAL. It recomputes nothing, reads no roster row,
   * and adds no gate — it takes the coach rows already loaded for this
   * programme and the seasons this report already says it describes, and
   * answers how many of those seasons the coach on file for 2026 was in
   * charge for.
   *
   * `ph.describes` IS the denominator, deliberately. It is what the cover
   * states as the report's window, what the coach card states as "seasons
   * analysed", and what the tenure strip on that card already draws — so a
   * count built from anything else would contradict the page it appears on.
   * Ohio State men's is the case: its window is three seasons, not four,
   * because the freshman gate drops 2023, and "2 of 3" is the honest figure
   * beside a card that says three.
   */
  const coachAttributionModel = coachAttribution({
    coachRows: found.coachRows ?? [],
    measuredSeasons: ph.describes ?? [],
  });
  // Which analyses were attempted and refused. Additive, and computed from
  // the model rather than from any new query: `evidenceLimitsFor` reads the
  // same fields the pages it replaces would have read.
  const withLifecycle = {
    ...model, summary, lifecycle, pressure, squadProfile, positionUtilisation,
    coachAttribution: coachAttributionModel,
  };
  const evidenceLimits = evidenceLimitsFor(withLifecycle);
  return {
    ...model,
    summary,
    lifecycle,
    pressure,
    // `squad` is already the 2026 roster on this model; this is the historical
    // profile of how its minutes were distributed and who took them.
    squadProfile,
    positionUtilisation,
    coachAttribution: coachAttributionModel,
    evidenceLimits,
    // The document's shape, decided from the data rather than by whichever
    // section throws first. No page numbers: those are not knowable until the
    // pages exist, and the renderer fills them in afterwards.
    sections: planSections({
      model: { ...withLifecycle, evidenceLimits }, summary, philosophy: ph,
    }),
  };
}
