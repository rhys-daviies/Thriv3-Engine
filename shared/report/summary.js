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

import { STARTER_MINUTES, squadProjectedMinutes, expiringShare, squadDepth } from '../philosophy.js';
import { canonicalPosition } from '../positions.js';
import { STEP_POINTS, MIN_COHORT_PLAYERS } from '../freshmanMinutes.js';
import {
  freshmanOpportunityEvidence, vacancyEvidence, positionEvidence, cohortEvidence,
  coachContinuity,
} from '../evidenceStrength.js';

/**
 * The classification vocabulary, shared by every module that has one.
 *
 * Deliberately NOT high/moderate/low. Those words carry a judgement the
 * calculation does not make: nothing here measures whether a programme is good
 * at developing first-years, only where it sits among the other programmes in
 * its sport. A page that says "Freshman opportunity — High" is claiming
 * something; one that says "Above programme benchmark" is reporting one.
 *
 * The three bands are the quartiles of the pool, and the words mean exactly
 * what the arithmetic does:
 *
 *   above-benchmark   in the top quarter of programmes
 *   typical           inside the middle half — the interquartile range
 *   below-benchmark   in the bottom quarter
 *
 * 'mixed' is not a position in that distribution. It means the seasons behind
 * the figure disagree too much for any single position to describe them, which
 * is a property of the programme rather than a gap in the sample.
 *
 * 'unclear' means the data cannot support a call. 'unavailable' means there is
 * no data to make one from. Keeping them apart is the whole point: one says we
 * looked and could not tell, the other says there was nothing to look at.
 *
 * These strings are the machine-readable contract. A renderer maps them to
 * whatever words its surface uses, the way VERDICT_LABEL already does for
 * classifyProgramme's verdicts; they must not be reworded at the source.
 */
export const CLASSIFICATIONS = [
  'above-benchmark', 'typical', 'below-benchmark', 'mixed', 'unclear', 'unavailable',
];

/** The three that describe a position in the pool, ordered high to low. */
export const BENCHMARK_BANDS = ['above-benchmark', 'typical', 'below-benchmark'];

const sum = (list, f) => list.reduce((s, x) => s + (f(x) ?? 0), 0);

/**
 * Where a value sits against a pool's quartiles.
 *
 * Split on p25 and p75, so 'typical' genuinely names the middle half of the
 * pool. The earlier draft split on the median and p75 and left p25 unused,
 * which put half the pool in the bottom band and made 'typical' mean "third
 * quartile" — a word doing the opposite of its job.
 *
 * Null in, null out, and null when the pool itself is not readable — never a
 * midpoint. `percentileOfLadderTop` already refuses to invent 50 for exactly
 * this reason and this keeps the same contract for every other quantity.
 */
export function bandAgainstPool(value, quartiles) {
  if (value == null || !quartiles) return null;
  const { p25, median, p75 } = quartiles;
  if (p25 == null || median == null || p75 == null) return null;
  if (value > p75) return 'above-benchmark';
  if (value >= p25) return 'typical';
  return 'below-benchmark';
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
    // The whole roster, so the squad pages do not have to reach past the
    // summary for rows the summary already holds.
    squad: squadDepth(squadRows),
    classification: 'unclear',
    classificationReason: 'pool-distribution-not-defensible',
    // Measured rather than assumed. Across the 1,910 programmes with a current
    // squad, the expiring share moves systematically with how complete the
    // projections are — mean 0.456 where coverage is 50-70% against 0.388
    // where it is above 95%, r = -0.15. A percentile over those would rank
    // programmes partly by their data completeness. The 18% with no readable
    // denominator are missing for the same reason, so the pool would be built
    // from a biased subset of the very thing it is meant to describe.
    classificationEvidence: {
      code: 'projection-coverage-biases-the-share',
      programmesWithReadableDenominator: 0.82,
      shareByCoverageBand: [
        { coverage: '0.50-0.70', meanShare: 0.456 },
        { coverage: '0.70-0.85', meanShare: 0.431 },
        { coverage: '0.85-0.95', meanShare: 0.402 },
        { coverage: '0.95-1.00', meanShare: 0.388 },
      ],
    },
    season: model.squadSeason ?? null,
    rostered: model.squad?.rostered ?? 0,
    projectedMinutes: projected,
    cliff,
    // Bounded horizons only.
    //
    // There is deliberately no "expiring across the whole window" figure. Every
    // player's eligibility ends in some year, so summing every year in the
    // cliff returns the denominator back — it read 100% at every programme in
    // the pool, which is true and says nothing.
    expiringByYear: (cliff ?? []).map((y) => ({
      year: y.year,
      minutes: y.total,
      share: projected.readable && projected.total ? y.total / projected.total : null,
      players: y.players,
      playersWithoutProjection: y.playersWithoutProjection,
    })),
    // Gone before the athlete arrives. Under the five-year eligibility model
    // this is a narrow group — for a 2027 entrant, only current graduate
    // students — so it is reported beside the wider horizon below rather than
    // on its own.
    expiringBeforeEntry: before ? expiringShare(cliff, projected, { before }) : null,
    // Gone by the end of the athlete's first season: the same group plus
    // everyone whose final eligible season IS the entry year.
    expiringThroughEntrySeason: before ? expiringShare(cliff, projected, { before: before + 1 }) : null,
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
 * The current squad at one position, read against the season the athlete would
 * arrive in.
 *
 * THIS IS NOT A PREDICTED DEPTH CHART, and the field names say so. It is the
 * roster as it stands today, filtered by a date. Who is actually on the squad
 * in the entry season depends on recruits, arrivals, transfers out and fifth
 * years, none of which are knowable from this data.
 *
 * FOUR groups, not two. A player with no eligibility end recorded is neither
 * staying nor leaving as far as the record goes, and folding them into either
 * side would manufacture a fact. And a player whose eligibility ends IN the
 * entry season is a distinct case worth naming: they overlap the athlete for
 * one season and then go.
 *
 * That last group is not a nicety. Under the five-year eligibility model in
 * classYear.js, a 2026 senior is eligible through 2027 — so for a 2027
 * entrant, "eligibility ends before entry" catches only graduate students,
 * 1,103 rows of 57,807 across the 2026 rosters. Reporting only that group
 * would tell most athletes that nobody is leaving, when in fact a quarter of
 * the squad is in its final season alongside them.
 */
export function splitDepthByEntry(depth, entrySeason) {
  const rows = depth ?? [];
  const known = (x) => x.eligibleTo != null;
  const eligibleAtEntry = rows.filter((x) => known(x) && Number(x.eligibleTo) >= entrySeason);
  const endsBeforeEntry = rows.filter((x) => known(x) && Number(x.eligibleTo) < entrySeason);
  const finalSeasonAtEntry = rows.filter((x) => known(x) && Number(x.eligibleTo) === entrySeason);
  const unknown = rows.filter((x) => !known(x));
  const minutesOf = (list) => {
    const withProjection = list.filter((x) => x.projectedMinutes != null);
    return {
      // Named at length on purpose. These are minutes attached to players who
      // are on the roster now — not minutes that become available to anybody.
      currentProjectedMinutes: withProjection.length
        ? sum(withProjection, (x) => Number(x.projectedMinutes)) : null,
      players: list.length,
      playersWithProjection: withProjection.length,
      playersWithoutProjection: list.length - withProjection.length,
    };
  };
  return {
    entrySeason,
    currentPositionPlayers: rows,
    currentPlayersEligibleAtEntry: eligibleAtEntry,
    currentPlayersEligibilityEndsBeforeEntry: endsBeforeEntry,
    // A subset of currentPlayersEligibleAtEntry: eligible for the entry season
    // and no further.
    currentPlayersInFinalSeasonAtEntry: finalSeasonAtEntry,
    currentPlayersEligibilityUnknown: unknown,
    projectedMinutesEligibleAtEntry: minutesOf(eligibleAtEntry),
    projectedMinutesEndingBeforeEntry: minutesOf(endsBeforeEntry),
    projectedMinutesInFinalSeasonAtEntry: minutesOf(finalSeasonAtEntry),
    projectedMinutesEligibilityUnknown: minutesOf(unknown),
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

    // The CURRENT squad at this position, read against the entry season. Every
    // name here starts with "current" because every one of them describes the
    // roster as it stands, not the roster the athlete would find.
    currentPositionPlayers: depth.currentPositionPlayers,
    currentPlayersEligibleAtEntry: depth.currentPlayersEligibleAtEntry,
    currentPlayersEligibilityEndsBeforeEntry: depth.currentPlayersEligibilityEndsBeforeEntry,
    currentPlayersInFinalSeasonAtEntry: depth.currentPlayersInFinalSeasonAtEntry,
    currentPlayersEligibilityUnknown: depth.currentPlayersEligibilityUnknown,
    // "associated with" rather than "available": the minutes belong to the
    // player, and nothing in this data says they transfer to a recruit.
    currentProjectedMinutesOfPlayersEligibleAtEntry: depth.projectedMinutesEligibleAtEntry,
    currentProjectedMinutesOfPlayersEndingBeforeEntry: depth.projectedMinutesEndingBeforeEntry,
    currentProjectedMinutesOfPlayersInFinalSeasonAtEntry: depth.projectedMinutesInFinalSeasonAtEntry,
    currentProjectedMinutesOfPlayersWithUnknownEligibility: depth.projectedMinutesEligibilityUnknown,

    positionVacancyHistory: positionHistory,
    // Historical outcomes at this position, never a projection of the next
    // one. "Took it" is a past-tense count of what followed a departure.
    positionOpeningOutcomes: positionHistory ? {
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
  const division = model.college?.division ?? null;
  const poolAll = model.benchmarks?.byOrigin ?? null;
  // The programme's OWN division, never the pool as a whole where the division
  // is readable. The effect this contextualises differs by division — it runs
  // one way at D1 and D2 and reverses at D3 in the women's game — so a
  // pool-wide figure beside a D3 programme would mislead in the one place the
  // reader is most likely to act on it.
  const poolDivision = division ? poolAll?.byDivision?.[division] ?? null : null;
  const usable = poolDivision?.comparable ? poolDivision
    : poolAll?.overall?.comparable ? poolAll.overall : null;
  const poolScope = poolDivision?.comparable ? 'division'
    : poolAll?.overall?.comparable ? 'all-divisions' : null;

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
    // Measured, not quoted. The figure this replaces was prose carried in the
    // renderer — "about 40% more likely, 37% against 27%" — which looked
    // measured beside computed numbers and was six points out on the domestic
    // half by the time it was checked against the pool it described.
    pool: usable ? {
      scope: poolScope,
      division: poolScope === 'division' ? division : null,
      sameOrigin: requested ? usable[requested] ?? null : null,
      otherOrigin: requested
        ? usable[requested === 'international' ? 'domestic' : 'international'] ?? null : null,
      domestic: usable.domestic,
      international: usable.international,
      // Counted and kept out of the comparison rather than defaulted into it.
      originUnrecorded: usable.originUnrecorded,
    } : null,
    poolReason: usable ? null
      : poolAll ? 'neither origin group in the pool is large enough to read'
        : 'the benchmark pool could not be read',
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
