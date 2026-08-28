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
  philosophyFor, fitFor, college, poolBenchmarks, percentileOfLadderTop, poolMixForBand,
} from '../lib/philosophyQueries.js';
import { RECRUIT_SEASON } from '../../shared/philosophy.js';
import { positionLabel } from '../../shared/positions.js';

const selectPlayer = db.prepare(
  'SELECT id, full_name, position, nationality, recruiting_class_year, graduation_year, sport FROM players WHERE id = ?',
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
 * `reports.player` is decided HERE rather than on the client, because
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
    const fit = sportMatches && athlete ? fitFor(id, athlete)?.fit : null;

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
        generic: true,
        player: Boolean(fit),
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
  const { college: col, philosophy: ph } = found;
  const benchmarks = poolBenchmarks(col.sport);
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
  const col = college(collegeId);
  if (!col) throw new Error(`Unknown college: ${collegeId}`);
  if (athlete.sport !== col.sport) {
    throw new Error(`${athlete.full_name} plays ${athlete.sport}; ${col.name} is ${col.sport}`);
  }
  const base = programmeModel({ collegeId });
  const found = fitFor(collegeId, athlete);
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
