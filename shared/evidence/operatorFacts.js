/**
 * Evidence, as structured facts an operator surface can render.
 *
 * A TRANSLATION BOUNDARY and nothing else. Every value below is copied from an
 * evidence object that already computed it; this file derives no number, reads
 * no database, calls no Philosophy, recruiting or matching module, and renders
 * no prose. If a fact is not already on the object it does not appear here, and
 * the gap is reported rather than filled.
 *
 * WHY AN ALLOWLIST PER KIND RATHER THAN PASSING `data` THROUGH
 *
 * `data` is a generator's private workspace. It carries the coverage gates that
 * decided whether a claim was licensed, the identity method that matched a
 * player between two rosters, the transitions a coach was credited with, the
 * whole-intake ladder duplicated onto the cohort ladder for a comparison the
 * client will make itself. A client handed that object would be reading backend
 * internals and would eventually depend on one — and the day a generator
 * reshaped its workspace, a screen would break for reasons nobody could see.
 *
 * So each kind names what it means. A new evidence kind cannot reach an
 * operator surface until somebody decides what it says, which is the same
 * discipline the registry applies to tiers.
 *
 * NO INTERPRETATION. The four Philosophy measurements are NEUTRAL and are
 * emitted as measurements: a median is a median, a band is the interval it was
 * measured into. Words like good, strong or favourable appear nowhere, and the
 * one direction that IS emitted — PROGRAM_MOMENTUM's classification — is
 * emitted because the generator already refuses to fire on the unfavourable
 * reading, so the direction is a property of the evidence rather than a reading
 * added here.
 */

import { EVIDENCE_KINDS, kindSpec } from './kinds.js';

/** A kind that has no operator facts, with the reason it has none. */
const NOT_EXPOSED = Object.freeze({});

/**
 * A ladder rung, in the source module's own terms.
 *
 * `weighted` and `comparable` are dropped: the first records whether a coach
 * weighting was applied while building the ladder, the second whether the
 * medians fall monotonically. Both are properties of the CALCULATION rather
 * than of the programme, and neither means anything to somebody reading a
 * screen.
 */
const rung = (r) => ({
  rank: r.rank,
  median: r.median,
  low: r.low,
  high: r.high,
  // 'impact' | 'rotation' | 'fringe' — the source module's minutes bands, and
  // descriptive rather than evaluative: they name a quantity of minutes, not a
  // judgement about the programme.
  band: r.band ?? null,
  // 'tight' | 'wide' — whether the seasons agreed. Carried because a median the
  // seasons disagree on is a number to show as a range.
  agreement: r.agreement ?? null,
  seasonsWithThisMany: r.seasonsWithThisMany ?? null,
});

/**
 * One named arrival from a recruiting-history item.
 *
 * The person, when and where from — enough for the timeline the pathway story
 * needs. The rest of each supporting row is matching machinery: `identityMethod`
 * and `reconciledFrom` record HOW a player was matched between two roster
 * snapshots, `priorConfidence` and `entryType` gate other claims, and
 * `transition` is the internal key for a season pair whose second half is
 * already `season`.
 */
const arrival = (a) => ({
  player: a.playerName ?? null,
  season: a.season ?? null,
  country: a.country ?? null,
  region: a.region ?? null,
  position: a.position ?? null,
  coach: a.coach ?? null,
  coachAttribution: a.coachAttribution ?? null,
});

const arrivals = (d) => (d?.provenance?.supporting ?? []).map(arrival);

/**
 * What each kind means, in fields a surface can read.
 *
 * Every entry is a pure function of one evidence object. `null` is used where
 * the object genuinely holds null — nothing is defaulted into existence, and a
 * missing name is not the same as no name (several kinds carry a name only when
 * naming is licensed, and that distinction survives here).
 */
const EXTRACTORS = Object.freeze({
  // --- roster opportunity ---------------------------------------------------
  //
  // POSITION_GRADUATION, POSITION_GRADUATION_STARTERS and ELIGIBILITY_CLIFF are
  // one story that topReasons groups. Each names its own `position` and
  // `classYear` so a client can verify they describe the same group and the
  // same arrival window before combining them, rather than trusting the
  // grouping blindly.
  POSITION_GRADUATION: (e) => ({
    position: e.data.position,
    count: e.data.count,
    names: e.data.names ?? [],
    beforeClassYear: e.data.classYear ?? null,
  }),
  POSITION_GRADUATION_STARTERS: (e) => ({
    position: e.data.position,
    starterCount: e.data.count,
    names: e.data.names ?? [],
    // 'projected' — starter status for an unplayed season comes from minutes
    // carried forward, and the reading is not safe without knowing that.
    basis: e.data.basis ?? null,
  }),
  ELIGIBILITY_CLIFF: (e) => ({
    position: e.data.position,
    players: e.data.players,
    projectedMinutes: e.data.projectedMinutes,
    beforeClassYear: e.data.classYear ?? null,
    byYear: (e.data.byYear ?? []).map((y) => ({
      year: y.year,
      minutes: y.byPosition?.[0]?.minutes ?? null,
      players: y.byPosition?.[0]?.players ?? null,
    })),
  }),
  POSITION_GROUP_SCARCITY: (e) => ({
    position: e.data.position,
    count: e.data.count,
    /**
     * PLAYERS WHOSE POSITION WE COULD READ, and named as that.
     *
     * It crossed the wire as `squadSize` until H9, which is a different
     * quantity: the generator divides by the CLASSIFIED squad on purpose — a
     * group cannot be called thin relative to players whose position was never
     * parsed — but the operator card then said "3 defenders in a squad of 23"
     * about a programme carrying 32. On 47 of 228 live claims the number under
     * that label was not the squad size, and at Mobile it was short by
     * eighteen. The maths was right and the word was wrong.
     */
    classifiedSquad: e.data.classifiedSquad,
    share: e.data.share,
  }),
  RETURNING_POSITION_DEPTH: (e) => ({
    position: e.data.position,
    returning: e.data.returning,
    groupSize: e.data.groupSize,
    beforeClassYear: e.data.classYear ?? null,
    // How many of the group we could not read an eligibility year for. The
    // returning count is only as good as this is small.
    unknownEligibility: e.data.unknownEligibility ?? null,
  }),
  POSITION_GROUP_SIZE: (e) => ({
    position: e.data.position,
    count: e.data.count,
    squadSize: e.data.squadSize,
  }),
  SQUAD_GRADUATION: (e) => ({
    total: e.data.total,
    starters: e.data.starters ?? null,
    names: e.data.names ?? [],
    beforeClassYear: e.data.classYear ?? null,
  }),

  // --- recruitment pathway --------------------------------------------------
  //
  // Each keeps the axes it was actually cut on. A country kind emits a country
  // and no position; a region kind emits the region AND the country it
  // excluded, because that exclusion is what stops it restating the
  // same-country item. Nothing infers a missing axis.
  COACH_ARRIVAL_SAME_COUNTRY: (e) => ({
    country: e.data.country,
    coach: e.data.coach,
    position: e.data.position ?? null,
    count: e.data.count,
    seasons: e.data.seasons ?? [],
    // Named only where naming is licensed; absent means "we may not use the
    // name we hold", not "we have no name".
    namedArrival: e.data.name ?? null,
    namedArrivalSeason: e.data.nameSeason ?? null,
    // Intakes this coach can be credited with. Their first roster is their
    // predecessor's recruiting and is already excluded upstream.
    attributableIntakes: e.data.attributableTransitions ?? null,
    intakesWithArrival: e.data.transitionsWithArrival ?? null,
    arrivals: arrivals(e.data),
  }),
  ARRIVAL_SAME_COUNTRY_POSITION: (e) => ({
    country: e.data.country,
    position: e.data.position,
    count: e.data.count,
    seasons: e.data.seasons ?? [],
    namedArrival: e.data.name ?? null,
    namedArrivalSeason: e.data.nameSeason ?? null,
    observedIntakes: e.data.observedTransitions ?? null,
    intakesWithArrival: e.data.transitionsWithArrival ?? null,
    arrivals: arrivals(e.data),
  }),
  ARRIVAL_SAME_REGION_POSITION: (e) => ({
    region: e.data.region,
    countries: e.data.countries ?? [],
    position: e.data.position,
    count: e.data.count,
    seasons: e.data.seasons ?? [],
    namedArrival: e.data.name ?? null,
    namedArrivalSeason: e.data.nameSeason ?? null,
    observedIntakes: e.data.observedTransitions ?? null,
    arrivals: arrivals(e.data),
  }),
  HISTORICAL_SAME_COUNTRY: (e) => ({
    country: e.data.country,
    count: e.data.count,
    names: e.data.names ?? [],
    // The seasons compatriots actually appear in, which is narrower than the
    // window searched — that lives in `qualification.seasons`.
    seasonsPresent: e.data.seasons ?? [],
  }),
  CURRENT_SAME_COUNTRY: (e) => ({
    country: e.data.country,
    count: e.data.count,
    names: e.data.names ?? [],
  }),
  HISTORICAL_SAME_REGION: (e) => ({
    region: e.data.region,
    countries: e.data.countries ?? [],
    excludingCountry: e.data.athleteCountry ?? null,
    count: e.data.count,
    names: e.data.names ?? [],
  }),
  INTERNATIONAL_ROSTER: (e) => ({
    count: e.data.count,
    countries: e.data.countries ?? [],
    uniqueCountries: e.data.uniqueCountries ?? null,
  }),
  INTERNATIONAL_SHARE: (e) => ({
    count: e.data.count,
    squadSize: e.data.squadSize,
    share: e.data.share,
  }),

  // --- development ----------------------------------------------------------
  //
  // Four measurements, one story, no reading. Each emits the numbers and the
  // sample; whether they add up to a good place for this athlete is a judgement
  // nothing here is licensed to make.
  PROGRAMME_DEVELOPMENT_PATTERN: (e) => ({
    // The classifier's own key. Carried because an operator inspecting the
    // measurement may want to know what the analysis called it; it is NOT a
    // sentence and the Stage E design forbids printing it as one.
    verdictKey: e.data.verdict,
    verdictNote: e.data.verdictNote ?? null,
    seasonsObserved: e.data.seasonsObserved,
    players: e.data.players,
    // The measurement the verdict was read off.
    shareBySeason: (e.data.freshmanShareBySeason ?? []).map((s) => ({
      season: s.season,
      shareOfSquadMinutes: s.shareOfSquadMinutes,
      intake: s.intake,
      measured: s.measured,
    })),
    // Mean minute shares across the observed seasons.
    minuteShares: e.data.dials ?? null,
    spread: e.data.spread ?? null,
    step: e.data.step ?? null,
    coach: e.data.coach ?? null,
    coachStillInPost: e.data.coachStillInPost ?? null,
  }),
  FRESHMAN_MINUTES_LADDER: (e) => ({
    ladder: (e.data.ladder ?? []).map(rung),
    seasonsObserved: e.data.seasonsObserved,
    medianIntake: e.data.medianIntake ?? null,
    medianPlayed: e.data.medianPlayed ?? null,
    seasonsWithAnImpactFreshman: e.data.seasonsWithAnImpactFreshman ?? null,
  }),
  ATHLETE_COHORT_LADDER: (e) => ({
    ladder: (e.data.ladder ?? []).map(rung),
    // The cohort the calculation APPLIED, plus what it was asked for and why it
    // widened. The refusal string is the honest explanation of why this ladder
    // is coarser than the athlete — worth surfacing verbatim.
    cohort: {
      position: e.data.cohort?.position ?? null,
      origin: e.data.cohort?.origin ?? null,
      applied: e.data.cohort?.applied ?? false,
    },
    asked: e.data.asked ?? null,
    refused: e.data.refused ?? null,
    relaxed: e.data.relaxed ?? null,
    players: e.data.players,
    seasonsObserved: e.data.seasonsObserved,
  }),
  PROGRAMME_POOL_BENCHMARK: (e) => ({
    rank: e.data.programmeRank,
    programmeMedian: e.data.programmeMedian,
    programmeSpread: e.data.programmeBand ?? null,
    pool: {
      n: e.data.pool?.n ?? null,
      p25: e.data.pool?.p25 ?? null,
      median: e.data.pool?.median ?? null,
      p75: e.data.pool?.p75 ?? null,
    },
    // Also on `qualification.comparison`, where it is canonical. Repeated here
    // so the development story reads without reaching across the object.
    band: e.data.band ?? null,
  }),

  // --- fit and programme ----------------------------------------------------
  ACADEMIC_FIT: (e) => ({
    // What the school offers, and what the athlete typed. They are usually
    // different words for one subject and the difference is worth seeing.
    matchedProgramme: e.data.major,
    statedByAthlete: e.data.stated ?? null,
  }),
  CONFERENCE_TITLE: (e) => ({ conference: e.data.conference }),
  POSTSEASON_RESULT: (e) => ({ round: e.data.round }),
  PROGRAM_MOMENTUM: (e) => ({
    // 'RISING' | 'STRONG'. A direction, and emitted because the generator only
    // fires on the favourable reading — the direction is already a property of
    // this evidence rather than a judgement added here.
    classification: e.data.classification,
    recentWinPct: e.data.recentWinPct,
    priorWinPct: e.data.priorWinPct,
  }),
  COACH_CONTEXT: (e) => ({
    coach: e.data.name,
    seasonsObserved: e.data.seasonsObserved,
    since: e.data.since,
    // TRUE means `since` is the earliest season we looked, not an appointment
    // year. A surface printing "in post since 2024" on a window-bounded item
    // would repeat the Notre Dame error exactly.
    windowBounded: e.data.windowBounded,
    knownThrough: e.data.knownThrough ?? null,
    stillInPost: e.data.stillInPost,
    context: e.data.context ?? null,
  }),

  // --- internal kinds, operator-visible in the drill-down -------------------
  //
  // Both are OUTREACH: DENIED shadow-mode kinds and both are
  // OPERATOR_EVIDENCE: ALLOWED, so they belong in the evidence table. Exposed
  // as measurements with no reading attached — POSITION_INTAKE_HISTORY in
  // particular sits one step from "so they will need another", which is the
  // claim its registry entry exists to refuse.
  POSITION_INTAKE_HISTORY: (e) => ({
    position: e.data.position,
    count: e.data.count,
    seasons: e.data.seasons ?? [],
    observedIntakes: e.data.observedTransitions ?? null,
    intakesWithArrival: e.data.transitionsWithArrival ?? null,
    meanPerIntake: e.data.meanPerTransition ?? null,
    byIntake: e.data.byTransition ?? null,
  }),
  TRANSFER_BEHAVIOUR: (e) => ({
    arrivals: e.data.arrivals,
    atPosition: e.data.atPosition,
    squadSize: e.data.squadSize,
  }),
});

/**
 * Every kind's exposure decision, so a new one cannot fall through.
 *
 * All 26 are exposed today. A kind added later with no entry here throws at
 * module load rather than reaching a surface undecided — the same fail-closed
 * discipline the registry applies to tiers and windows.
 */
export const EXPOSURE = Object.freeze(Object.fromEntries(
  Object.keys(EVIDENCE_KINDS).map((kind) => [kind, EXTRACTORS[kind] ? 'EXPOSED' : 'UNDECIDED']),
));

for (const [kind, state] of Object.entries(EXPOSURE)) {
  if (state !== 'EXPOSED') {
    throw new Error(
      `${kind} has no operator fact extractor. Add one in operatorFacts.js, or `
      + 'record it as intentionally not exposed with a reason.',
    );
  }
}

/**
 * What a claim rests on, uniformly across every kind.
 *
 * One shape so a surface has one place to look, and every value copied rather
 * than summarised. `seasonsUnread` passes through untouched INCLUDING null:
 * `[]` means we looked and found no holes, `null` means we cannot tell, and
 * flattening the second into the first is the exact failure the Stage C
 * contract was built to prevent.
 */
export function qualificationFor(evidence) {
  const spec = kindSpec(evidence.kind);
  return {
    tier: evidence.tier,
    temporality: evidence.temporality,
    confidence: evidence.confidence,
    // Only where freshness actually moved it; equal values mean nothing was
    // downgraded and a surface should not imply otherwise.
    confidenceBeforeFreshness:
      evidence.confidenceBeforeFreshness !== evidence.confidence
        ? evidence.confidenceBeforeFreshness : null,
    minConfidence: spec.minConfidence,
    freshness: evidence.freshness
      ? {
        state: evidence.freshness.state,
        ageDays: evidence.freshness.ageDays ?? null,
        reason: evidence.freshness.reason ?? null,
      }
      : null,
    season: evidence.season ?? null,
    source: evidence.source,
    // Declared in the contract and null on every one of 10,206 live objects.
    // Carried so a surface can tell "no link" from "field absent"; see
    // `defineEvidence` for what H11 measured about why it is empty.
    sourceUrl: evidence.sourceUrl ?? null,
    window: evidence.describes
      ? {
        seasons: [...evidence.describes.seasons],
        seasonsUnread: evidence.describes.seasonsUnread === null
          ? null : [...evidence.describes.seasonsUnread],
        n: evidence.describes.n,
        cohort: evidence.describes.cohort ? { ...evidence.describes.cohort } : null,
      }
      : null,
    comparison: evidence.comparison
      ? {
        basis: evidence.comparison.basis,
        statistic: evidence.comparison.statistic,
        poolSize: evidence.comparison.poolSize,
        // Null wherever the source cannot supply an exact position. Kept null
        // rather than approximated from the band.
        percentile: evidence.comparison.percentile,
        band: evidence.comparison.band,
      }
      : null,
    requiresWindow: Boolean(spec.requiresWindow),
    requiresComparison: Boolean(spec.requiresComparison),
  };
}

/**
 * One evidence object as operator-facing structured facts.
 *
 * Fails closed on an unknown kind rather than falling back to raw `data`: a
 * kind nobody has decided the meaning of must not reach a surface, and a
 * permissive fallback would make that failure silent.
 */
export function operatorFactsFor(evidence) {
  if (!evidence?.kind) throw new Error('operatorFactsFor needs an evidence object');
  const extract = EXTRACTORS[evidence.kind];
  if (!extract) {
    throw new Error(
      `No operator fact extractor for ${evidence.kind}. Evidence cannot reach an `
      + 'operator surface until its facts are declared.',
    );
  }
  return {
    kind: evidence.kind,
    decisionClass: evidence.decisionClass,
    polarity: evidence.polarity,
    category: evidence.category,
    facts: extract(evidence),
    qualification: qualificationFor(evidence),
  };
}

/** The same, for a list. Order preserved; nothing mutated. */
export function operatorFactsForAll(evidence = []) {
  return evidence.map(operatorFactsFor);
}
