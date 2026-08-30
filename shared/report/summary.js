/**
 * The interpretation layer of the Program Intelligence Report.
 *
 * Pure derivation from data already loaded. Nothing here touches a database,
 * and nothing here renders — it produces the answers pages 2 and 3 are made
 * of, so those pages become a drawing job rather than a thinking job, and so
 * the thinking can be asserted without producing a PDF.
 *
 * Three rules run through every module.
 *
 * A classification is only stated where a defensible threshold exists, and
 * "defensible" here means pool-relative: a programme is called high or low
 * against the other programmes in its sport, never against a number somebody
 * picked. Where the pool cannot be read, or the evidence behind the figure is
 * insufficient, the classification is 'unclear'. That is a real answer and it
 * is the one this codebase keeps having to relearn — a made-up midpoint looks
 * exactly like a measurement.
 *
 * Nothing is scored. There is no overall programme number, and there must not
 * be one: the modules measure different things in different units and a
 * composite would be arithmetic on incommensurable quantities.
 *
 * Missing stays missing. Every share carries the coverage it was computed
 * from, every count carries what it was counted out of, and a quantity that
 * could not be measured is null with a reason beside it.
 */

import { STARTER_MINUTES, squadProjectedMinutes, expiringShare } from '../philosophy.js';
import { canonicalPosition } from '../positions.js';
import { STEP_POINTS, MIN_COHORT_PLAYERS } from '../freshmanMinutes.js';
import {
  freshmanOpportunityEvidence, vacancyEvidence, positionEvidence, cohortEvidence,
  coachContinuity,
} from '../evidenceStrength.js';

/**
 * The classification vocabulary, shared by every module that has one.
 *
 * 'unclear' means the data cannot support a call. 'unavailable' means there is
 * no data to make one from. Keeping them apart is the whole point: one says
 * we looked and could not tell, the other says there was nothing to look at.
 */
export const CLASSIFICATIONS = ['high', 'moderate', 'low', 'mixed', 'unclear', 'unavailable'];

const sum = (list, f) => list.reduce((s, x) => s + (f(x) ?? 0), 0);

/**
 * Where a value sits against a pool's quartiles.
 *
 * Null in, null out, and null when the pool itself is not readable — never a
 * midpoint. `percentileOfLadderTop` already refuses to invent 50 for exactly
 * this reason and this keeps the same contract for every other quantity.
 */
export function bandAgainstPool(value, quartiles) {
  if (value == null || !quartiles) return null;
  const { p25, median, p75 } = quartiles;
  if (p25 == null || median == null || p75 == null) return null;
  if (value > p75) return 'high';
  if (value >= median) return 'moderate';
  return 'low';
}

// ---------------------------------------------------------------------------
// A. Freshman opportunity
// ---------------------------------------------------------------------------

/**
 * How willing this programme has been to give a first year real minutes.
 *
 * The dominant metric is the top of the UNWEIGHTED ladder, deliberately. The
 * unweighted ladder is programme history and is the stabler of the two; the
 * weighted one describes the current approach and is carried alongside rather
 * than substituted, so a reader is never handed one while thinking they have
 * the other. Where they disagree, that disagreement is itself reported.
 */
export function freshmanOpportunitySummary({ model, philosophy }) {
  const ladderTop = model.ladder?.[0] ?? null;
  const weightedTop = model.weightedLadder?.[0] ?? null;
  const profile = philosophy?.freshman ?? null;

  const measuredFreshmen = sum(model.freshman?.intake ?? [], (s) => s.freshmen);
  const evidence = freshmanOpportunityEvidence({
    seasonsObserved: model.seasons?.length ?? 0,
    measuredFreshmen,
    unreadableSeasons: profile?.unreadableSeasons ?? [],
    verdict: model.verdict,
    tenure: model.tenure,
  });

  const poolRank1 = model.benchmarks?.ladderByRank?.find((r) => r.rank === 1) ?? null;
  const band = bandAgainstPool(ladderTop?.median ?? null, poolRank1);

  let classification = 'unavailable';
  let basis = 'none';
  if (ladderTop) {
    if (!evidence.sufficient) {
      classification = 'unclear';
    } else if (ladderTop.agreement === 'wide') {
      // The seasons disagree too much for one word. Not a weakness of the
      // sample — a real property of the programme, and 'mixed' is the honest
      // name for it.
      classification = 'mixed';
    } else if (band) {
      classification = band;
      basis = 'pool-relative';
    } else {
      classification = 'unclear';
    }
  }

  return {
    classification,
    classificationBasis: basis,
    // Named so a renderer never has to guess which number it is showing.
    primaryMetric: ladderTop ? {
      key: 'ladder-top-median-minutes',
      value: ladderTop.median,
      band: ladderTop.band,
      agreement: ladderTop.agreement,
      comparable: ladderTop.comparable,
      seasons: ladderTop.seasonsWithThisMany,
      contributions: ladderTop.contributions ?? [],
    } : null,
    ladderTop,
    // Carried, never substituted. Null where classifyProgramme found no reason
    // to reweight, which is the common case and is itself worth saying.
    weightedLadderTop: weightedTop,
    weightingApplied: Boolean(model.weightedLadder),
    weightFrom: model.verdict?.weightFrom ?? null,
    // Whether reweighting actually moved the answer. A weighted ladder that
    // agrees with the unweighted one is a finding, not a non-event.
    weightedAgrees: weightedTop && ladderTop
      ? weightedTop.median === ladderTop.median
      : null,
    seasons: model.seasons ?? [],
    seasonsWithAnImpactFreshman: profile?.seasonsWithAnImpactFreshman ?? null,
    seasonsObserved: model.seasons?.length ?? 0,
    medianIntake: profile?.medianIntake ?? null,
    medianPlayed: profile?.medianPlayed ?? null,
    medianImpactPerSeason: profile?.medianImpactPerSeason ?? null,
    measuredFreshmen,
    unreadableSeasons: profile?.unreadableSeasons ?? [],
    rowsWithoutMinutes: profile?.unknownRows ?? null,
    starterThreshold: STARTER_MINUTES,
    pool: poolRank1 ? {
      rank1: poolRank1,
      percentile: model.benchmarks?.ladderTopPercentile ?? null,
      programmes: model.benchmarks?.programmes ?? null,
    } : null,
    poolReason: model.benchmarks ? null : model.benchmarksReason,
    evidence,
  };
}

// ---------------------------------------------------------------------------
// B. Experienced arrival reliance
// ---------------------------------------------------------------------------

/**
 * How much this programme fills its squad from outside its own recruiting class.
 *
 * "Experienced arrival" throughout: the roster cannot separate a transfer from
 * a junior-college arrival from an older recruit, and for a recruit's purposes
 * they are the same thing — somebody brought in ready to play.
 */
export function experiencedArrivalSummary({ model, philosophy }) {
  const transfer = model.transfer ?? { points: [], window: { measurable: [], unmeasurable: [] } };
  const measurableSeasons = transfer.window?.measurable ?? [];
  const readableIntake = (model.freshman?.intake ?? []).filter((s) => s.readable && s.arrivalsMeasurable);

  const minutes = readableIntake.length ? sum(readableIntake, (s) => s.newcomerMinutes) : null;
  const load = readableIntake.length ? sum(readableIntake, (s) => s.load) : null;

  const evidence = vacancyEvidence({
    observations: model.dials?.n ?? 0,
    totalObservations: philosophy?.observations?.length ?? null,
    seasons: measurableSeasons.length,
    verdict: model.verdict,
    tenure: model.tenure,
  });

  // The PROGRAMME-level distribution, not the position-season one. A
  // programme mean placed against the spread of individual observations is a
  // units mismatch: means vary far less, so half the pool lands in the middle
  // band and almost nothing lands below it.
  const poolDial = model.benchmarks?.programmeDials?.newcomer ?? null;
  const band = bandAgainstPool(model.dials?.newcomer ?? null, poolDial);

  let classification = 'unavailable';
  let basis = 'none';
  if (!transfer.measurable) {
    // No season on file has the season before it on file, so an arrival cannot
    // be told from a returner. Nothing to classify, and saying "none" here
    // would be a claim we cannot make.
    classification = 'unavailable';
  } else if (!evidence.sufficient || model.dials?.newcomer == null) {
    classification = 'unclear';
  } else if (band) {
    classification = band;
    basis = 'pool-relative';
  } else {
    classification = 'unclear';
  }

  return {
    classification,
    classificationBasis: basis,
    primaryMetric: model.dials?.newcomer != null ? {
      key: 'experienced-arrival-share-of-positional-minutes',
      value: model.dials.newcomer,
      unit: 'percent',
      observations: model.dials.n,
    } : null,
    arrivals: transfer.points?.length ?? 0,
    measurableSeasons,
    unmeasurableSeasons: transfer.window?.unmeasurable ?? [],
    measurable: Boolean(transfer.measurable),
    density: transfer.density ?? null,
    minutes,
    // Null rather than zero where the seasons behind it were not readable.
    shareOfMeasuredLoad: load ? minutes / load : null,
    starters: (transfer.points ?? []).filter((p) => p.minutes >= STARTER_MINUTES).length,
    perSeason: (model.freshman?.intake ?? []).map((s) => ({
      season: s.season,
      arrivals: s.arrivalsMeasurable ? s.newcomers : null,
      minutes: s.readable && s.arrivalsMeasurable ? s.newcomerMinutes : null,
      starters: s.arrivalsMeasurable ? s.newcomerStarters : null,
      measurable: Boolean(s.arrivalsMeasurable),
      readable: Boolean(s.readable),
    })),
    dials: model.dials ?? null,
    pool: poolDial ? {
      newcomer: poolDial,
      programmes: model.benchmarks?.programmes ?? null,
      // Kept for context on the page: what a typical position-season looks
      // like, as distinct from what a typical programme looks like.
      perObservation: model.benchmarks?.dials?.newcomer ?? null,
    } : null,
    poolReason: model.benchmarks ? null : model.benchmarksReason,
    evidence,
  };
}

// ---------------------------------------------------------------------------
// C. Replacement behaviour
// ---------------------------------------------------------------------------

/**
 * Where a position's minutes go the season after players leave it.
 *
 * The three shares partition the minutes exactly — that is enforced in
 * `vacancyObservations`, and it is what makes presenting them together honest.
 * The opening COUNTS on the other hand overlap and are never subtracted from
 * one another; see the ruling in the specification.
 */
export function replacementBehaviourSummary({ model, philosophy }) {
  const observations = philosophy?.observations ?? [];
  const readable = model.dials?.n ?? 0;
  const seasons = [...new Set(observations.filter((o) => o.freshmenReadable).map((o) => o.to))];

  const evidence = vacancyEvidence({
    observations: readable,
    totalObservations: observations.length,
    seasons: seasons.length,
    verdict: model.verdict,
    tenure: model.tenure,
  });

  const d = model.dials ?? { freshman: null, newcomer: null, returning: null, n: 0 };
  // The route that leads by a clear margin, or 'mixed'. STEP_POINTS is the
  // same ten-point margin classifyProgramme uses to call a change a change,
  // reused rather than a second threshold invented here.
  let dominantRoute = null;
  if (evidence.sufficient && d.returning != null && d.freshman != null && d.newcomer != null) {
    const ranked = [
      ['returning', d.returning], ['freshman', d.freshman], ['newcomer', d.newcomer],
    ].sort((a, b) => b[1] - a[1]);
    dominantRoute = (ranked[0][1] - ranked[1][1]) >= STEP_POINTS ? ranked[0][0] : 'mixed';
  }

  const meanVacatedStarterShare = observations.length
    ? sum(observations, (o) => o.vacatedStarterShare) / observations.length
    : null;

  return {
    // No high/low here: the three shares are a description, not a ranking, and
    // banding them would imply one route is better than another.
    dominantRoute,
    shares: {
      returning: d.returning, freshman: d.freshman, newcomer: d.newcomer,
    },
    observations: readable,
    totalObservations: observations.length,
    seasonsRepresented: seasons.sort(),
    meanVacatedStarterShare,
    // The pool band matching this programme's own vacancy rate, so like is
    // compared with like rather than against the pool as a whole.
    poolMix: model.benchmarks?.poolMix ?? null,
    poolDials: model.benchmarks?.dials ?? null,
    // The headline pool finding, computed on every request and never yet
    // rendered: a departing starter moves the odds of a first-year starting.
    poolVacancy: model.benchmarks?.vacancy ?? null,
    poolReason: model.benchmarks ? null : model.benchmarksReason,
    byPosition: (model.byPosition ?? []).map((p) => ({
      position: p.position,
      transitions: p.transitions,
      startersDeparted: p.startersDeparted,
      openings: p.openings,
      freshmanTookIt: p.freshmanTookIt,
      newcomerTookIt: p.newcomerTookIt,
      // Minutes shares, which DO partition. The counts above overlap and must
      // never be subtracted to infer a returning-player outcome.
      dials: p.dials,
      poolAtPosition: model.benchmarks?.byPosition?.find((b) => b.pos === p.position) ?? null,
      evidence: positionEvidence({
        transitions: p.transitions,
        openings: p.openings,
        seasons: new Set(p.seasons.map((s) => s.season)).size,
      }),
    })),
    evidence,
  };
}

// ---------------------------------------------------------------------------
// D. Coach context
// ---------------------------------------------------------------------------

/**
 * Whose programme the evidence describes.
 *
 * Deliberately not scored. A coaching history is a sequence of facts about
 * attribution, and turning it into a number would assert a comparability
 * between "one coach for four years" and "three coaches and a vacancy" that
 * does not exist.
 */
export function coachContextSummary({ model }) {
  const continuity = coachContinuity(model.verdict, model.tenure);
  return {
    currentCoach: model.coach?.coach ?? null,
    currentCoachSince: model.coach?.since ?? null,
    coachForRecruitSeason: model.coachForRecruitSeason ?? null,
    coachForEntrySeason: model.coachForEntrySeason ?? null,
    entrySeasonKnown: model.entrySeasonKnown ?? null,
    stillInPost: model.coachStillInPost ?? null,
    segments: (model.tenure?.segments ?? []).map((s) => ({
      coach: s.coach, from: s.from, to: s.to, seasons: s.seasons?.length ?? null,
    })),
    changes: model.tenure?.changes ?? [],
    unknownSeasons: model.tenure?.unknownSeasons ?? [],
    vacantSeasons: model.tenure?.vacantSeasons ?? [],
    knownThrough: model.tenure?.knownThrough ?? null,
    verdict: model.verdict?.verdict ?? null,
    // The note is written by classifyProgramme and is a stable explanation of
    // the verdict rather than report prose, so it travels with it.
    verdictNote: model.verdict?.note ?? null,
    describesSeasons: model.verdict?.describes ?? model.describes ?? [],
    seasonsAnalysed: model.seasons?.length ?? 0,
    // Whether the numbers elsewhere in the report describe the person a
    // recruit would actually be playing for.
    evidenceRelevance: continuity.relevance,
    weightFrom: model.verdict?.weightFrom ?? null,
  };
}

// ---------------------------------------------------------------------------
// E. Squad turnover
// ---------------------------------------------------------------------------

/**
 * What is leaving the current squad, and out of how much.
 *
 * No classification yet, and the reason is recorded rather than fudged: a
 * defensible high/moderate/low needs the pool distribution of the expiring
 * share, and `buildPoolBenchmarks` has no turnover pass. Banding on an
 * absolute minute count would make a large squad look like a high-turnover
 * one; banding on an unbenchmarked share would be an invented threshold.
 */
export function squadTurnoverSummary({ model, squadRows = [], entrySeason }) {
  const cliff = model.squad?.cliff ?? null;
  const projected = squadProjectedMinutes(squadRows);
  const before = entrySeason ?? null;

  return {
    classification: 'unclear',
    classificationReason: 'no-pool-distribution-for-turnover',
    season: model.squadSeason ?? null,
    rostered: model.squad?.rostered ?? 0,
    projectedMinutes: projected,
    cliff,
    // Everything leaving before the athlete would arrive, and everything
    // leaving at all, kept apart because they answer different questions.
    expiringBeforeEntry: before ? expiringShare(cliff, projected, { before }) : null,
    expiringAcrossWindow: expiringShare(cliff, projected),
    byPosition: (cliff ?? []).map((y) => ({
      year: y.year,
      total: y.total,
      players: y.players,
      playersWithoutProjection: y.playersWithoutProjection,
      byPosition: y.byPosition,
    })),
    namedArrivals: model.squad?.arrivals ?? [],
  };
}

// ---------------------------------------------------------------------------
// The athlete half
// ---------------------------------------------------------------------------

/**
 * The current squad at one position, split by whether eligibility currently
 * reaches the season the athlete would arrive in.
 *
 * THIS IS NOT A PREDICTED DEPTH CHART. It is the roster as it stands today,
 * read against a date. Who is actually on the squad in the entry season
 * depends on recruits, arrivals, transfers out and fifth years, none of which
 * are knowable from this data.
 *
 * Three buckets, never two. A player with no eligibility end recorded is
 * neither staying nor leaving as far as the record goes, and folding them into
 * either bucket would manufacture a fact.
 */
export function splitDepthByEntry(depth, entrySeason) {
  const rows = depth ?? [];
  const known = (d) => d.eligibleTo != null;
  const stillEligible = rows.filter((d) => known(d) && Number(d.eligibleTo) >= entrySeason);
  const expiring = rows.filter((d) => known(d) && Number(d.eligibleTo) < entrySeason);
  const unknown = rows.filter((d) => !known(d));
  const minutesOf = (list) => {
    const withProjection = list.filter((d) => d.projectedMinutes != null);
    return {
      // Named at length on purpose. These are minutes attached to players, not
      // minutes that become available to anybody — see the wording rule.
      currentProjectedMinutes: withProjection.length
        ? sum(withProjection, (d) => Number(d.projectedMinutes)) : null,
      players: list.length,
      playersWithProjection: withProjection.length,
      playersWithoutProjection: list.length - withProjection.length,
    };
  };
  return {
    entrySeason,
    all: rows,
    stillEligibleAtEntry: stillEligible,
    expiringBeforeEntry: expiring,
    eligibilityUnknown: unknown,
    stillEligibleMinutes: minutesOf(stillEligible),
    expiringMinutes: minutesOf(expiring),
    unknownMinutes: minutesOf(unknown),
  };
}

/**
 * What the record says about the athlete's own position and background.
 */
export function athleteSummary({ model, philosophy, entrySeason }) {
  const athlete = model.athlete;
  if (!athlete) return null;
  const position = canonicalPosition(athlete.position);
  const fit = model.fit ?? null;

  const depth = splitDepthByEntry(model.squad?.depth ?? [], entrySeason);

  const positionHistory = fit?.position ?? null;
  const positionEvidenceFor = positionEvidence({
    transitions: positionHistory?.transitions ?? 0,
    openings: positionHistory?.openings ?? 0,
    seasons: new Set((positionHistory?.seasons ?? []).map((s) => s.season)).size,
  });

  const freshmenHere = (model.freshman?.points ?? []).filter((p) => p.position === position);
  const arrivalsHere = (model.transfer?.points ?? []).filter((p) => p.position === position);
  const grid = (model.freshman?.grid ?? []).find((g) => g.position === position) ?? null;

  return {
    position,
    positionLabel: athlete.positionLabel ?? null,
    entrySeason,
    entrySeasonKnown: model.entrySeasonKnown ?? null,

    // The current squad at this position, read against the entry season.
    positionDepthNow: depth.all,
    positionDepthAtEntry: depth.stillEligibleAtEntry,
    knownExpirationsBeforeEntry: depth.expiringBeforeEntry,
    knownPlayersStillEligibleAtEntry: depth.stillEligibleAtEntry,
    eligibilityUnknownAtEntry: depth.eligibilityUnknown,
    projectedMinutesAssociatedWithExpiringPlayers: depth.expiringMinutes,
    projectedMinutesAssociatedWithPlayersStillEligible: depth.stillEligibleMinutes,
    projectedMinutesAssociatedWithUnknownEligibility: depth.unknownMinutes,

    positionVacancyHistory: positionHistory,
    positionReplacementBehaviour: positionHistory ? {
      openings: positionHistory.openings,
      transitions: positionHistory.transitions,
      startersDeparted: positionHistory.startersDeparted,
      freshmanTookIt: positionHistory.freshmanTookIt,
      newcomerTookIt: positionHistory.newcomerTookIt,
      // Shares, because the counts above overlap and cannot be subtracted.
      dials: positionHistory.dials,
      poolAtPosition: model.benchmarks?.byPosition?.find((b) => b.pos === position) ?? null,
      evidence: positionEvidenceFor,
    } : null,

    positionFreshmanHistory: {
      players: freshmenHere,
      measured: freshmenHere.length,
      starters: freshmenHere.filter((p) => p.minutes >= STARTER_MINUTES).length,
      grid,
      cohortLadder: fit?.ladder ?? [],
      wholeIntakeLadder: fit?.wholeIntakeLadder ?? model.ladder ?? [],
      evidence: cohortEvidence({
        players: freshmenHere.length,
        seasons: new Set(freshmenHere.map((p) => p.season)).size,
        relaxed: fit?.cohort?.relaxed ?? null,
        refused: fit?.cohort?.refused ?? null,
        applied: fit?.cohort?.applied ?? false,
      }),
    },

    experiencedArrivalsAtPosition: {
      players: arrivalsHere,
      measured: arrivalsHere.length,
      starters: arrivalsHere.filter((p) => p.minutes >= STARTER_MINUTES).length,
      measurableSeasons: model.transfer?.window?.measurable ?? [],
      currentNamedArrivals: (model.squad?.arrivals ?? []).filter((a) => a.position === position),
    },

    originContext: originContextSummary({ model, philosophy, athlete }),
  };
}

/**
 * Whether where the athlete is coming from changes what the record says.
 *
 * The pool has no origin split — `buildPoolBenchmarks` does not compute one —
 * so the comparison is programme-only and says so. The alternative, quoting a
 * pool figure from prior research beside computed ones, is the exact failure
 * this codebase keeps documenting: a number that looks measured and is not.
 */
export function originContextSummary({ model, athlete }) {
  const requested = athlete?.origin === 'international' ? 'international'
    : athlete?.origin === 'domestic' ? 'domestic' : null;
  const points = (model.freshman?.points ?? []).filter((p) => p.origin);
  const mine = points.filter((p) => p.origin === requested);
  const theirs = points.filter((p) => p.origin && p.origin !== requested);
  const fit = model.fit ?? null;

  const rate = (list) => (list.length ? {
    players: list.length,
    starters: list.filter((p) => p.minutes >= STARTER_MINUTES).length,
    // A count, not a percentage, below the point where a percentage reads more
    // confidently than it deserves to.
    share: list.length >= MIN_COHORT_PLAYERS
      ? list.filter((p) => p.minutes >= STARTER_MINUTES).length / list.length : null,
  } : { players: 0, starters: 0, share: null });

  const evidence = cohortEvidence({
    players: mine.length,
    seasons: new Set(mine.map((p) => p.season)).size,
    relaxed: fit?.cohort?.relaxed ?? null,
    refused: fit?.cohort?.refused ?? null,
    applied: fit?.cohort?.applied ?? false,
  });

  return {
    requestedOrigin: requested,
    // What freshmanProfile actually managed to read, which is not always what
    // was asked for.
    cohortUsed: fit?.cohort ? {
      position: fit.cohort.position, origin: fit.cohort.origin, applied: fit.cohort.applied,
    } : null,
    cohortRelaxed: fit?.cohort?.relaxed ?? null,
    cohortRefused: fit?.cohort?.refused ?? null,
    describesRequestedCohort: evidence.describesRequestedCohort,
    programme: {
      sameOrigin: rate(mine),
      otherOrigin: rate(theirs),
      withRecordedOrigin: points.length,
      withoutRecordedOrigin: (model.freshman?.points ?? []).length - points.length,
    },
    pool: null,
    poolReason: 'the benchmark pool carries no origin split',
    unavailableReason: requested ? null : 'no origin recorded for this athlete',
    evidence,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * The whole summary, programme and athlete.
 *
 * `philosophy` and `squadRows` are passed rather than re-derived: they are
 * already in hand where this is called, and the report loads one programme
 * once.
 */
export function buildReportSummary({ model, philosophy, squadRows = [] }) {
  const entrySeason = model.entrySeason ?? null;
  return {
    programme: {
      freshmanOpportunity: freshmanOpportunitySummary({ model, philosophy }),
      experiencedArrivalReliance: experiencedArrivalSummary({ model, philosophy }),
      replacementBehaviour: replacementBehaviourSummary({ model, philosophy }),
      coachContext: coachContextSummary({ model }),
      squadTurnover: squadTurnoverSummary({ model, squadRows, entrySeason }),
    },
    athlete: model.athlete ? athleteSummary({ model, philosophy, entrySeason }) : null,
  };
}
