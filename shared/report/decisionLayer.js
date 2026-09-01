/**
 * THE DECISION LAYER — what the report says first, and why it says that.
 *
 * The rule this module implements is written out in docs/decision-layer.md and
 * summarised here, because a ranking whose reasons live only in code is a
 * black box no matter how deterministic it is.
 *
 *   RANK THE FINDINGS. FREEZE THE PAGE ORDER.
 *
 * The pages run in the 13B narrative order at every programme. This module
 * chooses only which of the report's conclusions get the reader's first thirty
 * seconds, and where to send them for each one.
 *
 * WHAT THIS MODULE MAY NOT DO.
 *
 * Compute. Every figure below is already in the model and already printed on a
 * page of the report. If a sentence here needs a number the model does not
 * hold, the sentence is not written.
 *
 * Score. There is no composite, no fit number, no rating and no recommendation.
 * The priority classes are an ORDERING over findings, not a measurement of a
 * programme, and they never appear in the rendered text.
 *
 * Judge. A class A finding is not a bad finding or a good one. Heavy reliance
 * on experienced arrivals and unusually large first-year roles are the same
 * class, because both are departures from the comparable pool. Nothing here is
 * favourable or unfavourable, and nothing is coloured.
 *
 * Pad. A programme with three eligible findings shows three. An absence is
 * never admitted to reach a count.
 *
 * The vocabulary rules of `narrative.js` apply to every sentence this module
 * produces, and the same test enforces them.
 */
import { STARTER_MINUTES } from '../philosophy.js';
import { STEP_POINTS, MIN_COHORT_PLAYERS } from '../freshmanMinutes.js';
import { FRESHMEN_FOR_STRONG } from '../evidenceStrength.js';
import { PROMINENCE, coachContextFor } from './coachContext.js';
import { againstPool } from './narrative.js';

const pc = (v) => `${Math.round(v * 100)}%`;
const nf = (v) => (v == null ? null : Math.round(v).toLocaleString('en-US'));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The controlled candidate set. Nothing outside this list can become a
 * finding, and the ORDER is the ranking's final tiebreak — so two candidates
 * equal on class and evidence always resolve the same way.
 *
 * `section` is the page the finding sends the reader to. Null where the
 * supporting page does not render at this programme; the renderer then draws
 * the finding without a page reference rather than pointing at nothing.
 */
export const FINDING_CATEGORIES = Object.freeze([
  { id: 'competitive-environment', label: 'Competitive environment', section: 'competitive-environment' },
  { id: 'coach-context', label: 'Whose record this is', section: 'competitive-history' },
  { id: 'freshman-opportunity', label: 'First-year opportunity', section: 'freshman-opportunity' },
  { id: 'player-development', label: 'Development', section: 'player-development' },
  { id: 'experienced-arrivals', label: 'Experienced arrivals', section: 'experienced-arrivals' },
  { id: 'replacement-behaviour', label: 'Replacement behaviour', section: 'replacing-minutes' },
  { id: 'roster-continuity', label: 'Roster continuity', section: 'roster-continuity' },
  { id: 'current-squad', label: 'The current squad', section: 'eligibility-outlook' },
  { id: 'competitive-history', label: 'Competitive record', section: 'competitive-history' },
  { id: 'player-destinations', label: 'Where players go', section: 'roster-continuity' },
]);

const CATEGORY_RANK = new Map(FINDING_CATEGORIES.map((c, i) => [c.id, i]));
const CATEGORY = new Map(FINDING_CATEGORIES.map((c) => [c.id, c]));

/** The four priority classes, worst last. */
export const PRIORITY = Object.freeze(['A', 'B', 'C', 'D']);
const CLASS_RANK = new Map(PRIORITY.map((p, i) => [p, i]));

/**
 * Evidence as an ordinal gate, never a score.
 *
 * `record` is not a strength claim about a sample — it marks a fact that IS
 * the record: a division change or a coach attribution is not measured from a
 * cohort and cannot be under-powered the way a share can.
 */
export const EVIDENCE_LEVELS = Object.freeze(['none', 'limited', 'moderate', 'strong', 'record']);
const EVIDENCE_RANK = new Map(EVIDENCE_LEVELS.map((l, i) => [l, i]));

/** The ceiling each evidence level puts on a finding's priority. */
const CEILING = { record: 'A', strong: 'A', moderate: 'B', limited: 'C', none: null };

/** The worse (later) of two priority classes. */
const worse = (a, b) => (CLASS_RANK.get(a) >= CLASS_RANK.get(b) ? a : b);

/** At most six findings on the page, and no floor: three real ones beat five. */
export const MAX_FINDINGS = 6;
/** Below this, a class D context finding is allowed in to fill. */
export const FILL_TO = 4;

/**
 * The share of a squad's projected load that makes an eligibility year worth
 * a headline. NOT A NEW THRESHOLD: it is the floor the squad-outlook card has
 * used since Phase 10 to pick which year to lead with — one programme's next
 * year held 50 minutes of 4,894, which is true and says nothing.
 */
export const MEANINGFUL_EXPIRY_SHARE = 0.1;

/** The pattern share `destinationNarrative` already requires before it speaks. */
const DOMINANT_SHARE = 0.4;

const BAND_MATERIALITY = {
  'above-benchmark': 'B',
  'below-benchmark': 'B',
  typical: 'C',
};

/**
 * An evidence envelope (`level` + `sufficient`) read as an ordinal level.
 * Insufficient is 'none', which is the ineligibility gate rather than a weak
 * pass.
 */
const levelOf = (evidence) => {
  if (!evidence) return 'none';
  if (evidence.sufficient === false) return 'none';
  return EVIDENCE_LEVELS.includes(evidence.level) ? evidence.level : 'limited';
};

/**
 * A candidate, whether or not it makes the page.
 *
 * Every category returns one of these on every report, so §V's explainability
 * table is a property of the data rather than something reconstructed later.
 */
const candidate = (id, over = {}) => ({
  category: id,
  label: CATEGORY.get(id).label,
  section: CATEGORY.get(id).section,
  eligible: false,
  reason: null,
  materiality: null,
  evidence: 'none',
  priority: null,
  text: null,
  metric: null,
  evidenceNote: null,
  rank: null,
  rendered: false,
  ...over,
});

/** Refused, with the reason recorded as a stable slug. */
const refuse = (id, reason) => candidate(id, { eligible: false, reason });

/**
 * Admitted, with materiality and evidence resolved into one priority.
 *
 * This is the ONLY place a priority is assigned, and it is three lines: the
 * evidence sets a ceiling, the materiality sets a floor, and the worse of the
 * two wins. There is no arithmetic and nothing to tune.
 */
const admit = (id, { reason, materiality, evidence, text, metric, evidenceNote, section }) => {
  const ceiling = CEILING[evidence];
  if (!ceiling) return refuse(id, 'evidence-insufficient');
  /**
   * The evidence level, in the same words the evidence chips used.
   *
   * It travelled on the cards this layer replaced, and losing it with them
   * would have been a safeguard deleted by accident: a reader is entitled to
   * know that the sentence they are reading rests on a limited sample. Nothing
   * is printed for a `record`, because a division change is not a sample and
   * "EVIDENCE — RECORD" would invite it to be read as one.
   */
  const band = evidence === 'record' ? null : `EVIDENCE — ${evidence.toUpperCase()}`;
  return candidate(id, {
    eligible: true,
    reason,
    materiality,
    evidence,
    priority: worse(materiality, ceiling),
    text,
    metric: metric ?? null,
    evidenceNote: [band, evidenceNote].filter(Boolean).join(' · ') || null,
    ...(section !== undefined ? { section } : {}),
  });
};

// ---------------------------------------------------------------------------
// The ten canonical findings
//
// One function per category, one sentence per function, one headline metric
// per sentence. A renderer calls none of these directly.
// ---------------------------------------------------------------------------

/**
 * 1. Competitive environment.
 *
 * A division change is class A because every pool comparison in this report is
 * scoped to a division: a programme that moved is being read against two
 * different sets of programmes across the window, and a reader who does not
 * know that will mis-read every band beneath it.
 *
 * A stable structure is orientation, not a finding, and goes to the snapshot.
 * An unestablished season is an absence and is refused outright — a report
 * whose most prominent statement is a gap in our own coverage has buried its
 * own intelligence.
 */
function competitiveEnvironmentFinding(model) {
  const id = 'competitive-environment';
  const pkg = model.competitive;
  if (!pkg?.available) return refuse(id, 'no-competitive-package');
  const facts = pkg.structuralFacts ?? [];
  const divisionChange = facts.find((f) => f.kind === 'DIVISION_CHANGE');
  const conferenceChange = facts.find((f) => f.kind === 'CONFERENCE_CHANGE');
  const cov = pkg.coverage ?? {};
  const note = `conference on file for ${cov.membershipKnown ?? 0} of ${cov.readableSeasons ?? 0} `
    + `measured seasons, division for ${cov.divisionKnown ?? 0}`;

  if (divisionChange) {
    return admit(id, {
      reason: 'division-change-in-window',
      materiality: 'A',
      evidence: 'record',
      // The frozen structural sentence, verbatim. It is two seasons stated and
      // never a direction, and this layer does not get to rephrase it.
      text: `${divisionChange.text} Every comparison in this report is scoped to a division, so `
        + 'the seasons either side of that are read against different sets of programmes.',
      metric: divisionChange.seasons.join('\u2013'),
      evidenceNote: note,
    });
  }
  if (conferenceChange) {
    return admit(id, {
      reason: 'conference-change-in-window',
      materiality: 'C',
      evidence: 'record',
      text: `${conferenceChange.text} The division played in did not change across the seasons `
        + 'with one established.',
      metric: conferenceChange.seasons.join('\u2013'),
      evidenceNote: note,
    });
  }
  if ((cov.membershipKnown ?? 0) || (cov.divisionKnown ?? 0)) {
    return refuse(id, 'structure-stable-orientation-only');
  }
  return refuse(id, 'absence-only');
}

/**
 * 2. Whose record this is.
 *
 * Class A on exactly one condition — the current coach was in post for none or
 * one of the measured seasons, or is an interim. That is not a statement about
 * a coach; it is the attribution of the whole report, and every historical
 * finding beneath it has to be read through it.
 *
 * EVERY OTHER CASE GOES TO THE SNAPSHOT, including the unresolved one. An
 * absence that consumes a headline slot is the California defect this phase
 * exists to fix: a card four inches tall saying we could not read a coach row.
 */
function coachContextFinding(model, coach) {
  const id = 'coach-context';
  if (!coach) return refuse(id, 'no-coach-attribution');
  if (coach.prominence === PROMINENCE.ABSENT) return refuse(id, 'no-coach-record-at-this-level');
  if (coach.prominence === PROMINENCE.REFUSAL) return refuse(id, 'unresolved-compact-context-only');
  if (coach.prominence !== PROMINENCE.PROMINENT) return refuse(id, 'attribution-orientation-only');
  if (!coach.banner) return refuse(id, 'no-attribution-sentence');
  return admit(id, {
    reason: coach.interim ? 'interim-head-coach' : 'window-not-under-current-coach',
    materiality: 'A',
    evidence: 'record',
    text: `${coach.banner} The seasons below remain this programme's record; they describe a `
      + 'coaching context other than the current one.',
    metric: `${coach.attributed ?? 0} of ${coach.measured ?? 0} seasons`,
    evidenceNote: coach.predecessor
      ? `${coach.predecessor.name} is the named coach on file for the other measured seasons`
      : 'from the coach record on file',
  });
}

/** 3. First-year opportunity. */
function freshmanFinding(model) {
  const id = 'freshman-opportunity';
  const s = model.summary?.programme?.freshmanOpportunity;
  if (!s) return refuse(id, 'not-computed');
  const materiality = BAND_MATERIALITY[s.classification];
  if (!materiality) return refuse(id, `no-classification:${s.classification ?? 'none'}`);
  if (s.primaryMetric?.value == null) return refuse(id, 'no-headline-metric');
  const clause = againstPool(s.classification);
  /**
   * The coach-weighted view rides with the finding rather than becoming a
   * second one. It is the same concept measured over a narrower window, and
   * two first-year findings on one page is the duplication §X forbids.
   */
  const weighted = s.weightingApplied && s.weightedAgrees === false
    && s.weightedLadderTop?.median != null
    ? `a view weighted towards the current coach reads ${nf(s.weightedLadderTop.median)} min; `
      + 'both are shown, neither replaces the other'
    : null;
  const sample = [
    s.seasonsObserved ? plural(s.seasonsObserved, 'season', 'seasons') : null,
    s.measuredFreshmen ? plural(s.measuredFreshmen, 'measured first-year', 'measured first-years') : null,
  ].filter(Boolean).join(' · ');
  return admit(id, {
    reason: `band:${s.classification}`,
    materiality,
    evidence: levelOf(s.evidence),
    text: 'The best first-year of a season here has typically played '
      + `${nf(s.primaryMetric.value)} minutes${clause ? ` — ${clause}` : ''}.`,
    metric: `${nf(s.primaryMetric.value)} min`,
    evidenceNote: [sample, weighted].filter(Boolean).join(' · '),
  });
}

/**
 * 4. Development.
 *
 * The evidence level is built from the cohort this figure was measured over,
 * using the SAME two counts `freshmanOpportunityEvidence` already bands on —
 * `MIN_COHORT_PLAYERS` and `FRESHMEN_FOR_STRONG`. No new threshold: the
 * numbers are imported rather than restated.
 */
function developmentFinding(model) {
  const id = 'player-development';
  const d = model.lifecycle?.development;
  if (!d) return refuse(id, 'not-computed');
  if (!d.minutesCoverage?.readable) return refuse(id, 'minutes-not-readable');
  const ever = d.everStarter;
  if (ever?.share == null) return refuse(id, 'no-headline-metric');
  const materiality = BAND_MATERIALITY[ever.band];
  if (!materiality) return refuse(id, `no-classification:${ever.band ?? 'none'}`);
  const n = ever.denominator ?? 0;
  const evidence = n >= FRESHMEN_FOR_STRONG ? 'strong'
    : n >= MIN_COHORT_PLAYERS ? 'moderate' : 'none';
  const clause = againstPool(ever.band);
  return admit(id, {
    reason: `band:${ever.band}`,
    materiality,
    evidence,
    text: `${ever.reached} of ${n} measurable first-years have reached a `
      + `${STARTER_MINUTES}-minute season here${clause ? ` — ${clause}` : ''}.`,
    metric: pc(ever.share),
    evidenceNote: `${d.minutesCoverage.measured} of ${d.minutesCoverage.playerSeasons} `
      + 'first-year seasons carry published minutes',
  });
}

/**
 * 5. Experienced arrivals.
 *
 * ONE FIGURE, AND THE ONE WITH A POOL BEHIND IT. `dials.newcomer` is the share
 * of a VACATED POSITION's minutes; `shareOfMeasuredLoad` is the share of the
 * whole squad's. Both are true and they are different numbers, which is how
 * 28% and 30.9% came to sit on one page in 13A. The positional figure wins
 * because it is the only one that can carry a band, and the squad-wide share
 * is stated on the arrivals page with its own denominator named.
 */
function arrivalsFinding(model) {
  const id = 'experienced-arrivals';
  const e = model.summary?.programme?.experiencedArrivalReliance;
  if (!e) return refuse(id, 'not-computed');
  if (!e.measurable) return refuse(id, 'arrival-not-detectable');
  if (e.primaryMetric?.value == null) return refuse(id, 'no-position-season-readable');
  const materiality = BAND_MATERIALITY[e.classification];
  if (!materiality) return refuse(id, `no-classification:${e.classification ?? 'none'}`);
  const clause = againstPool(e.classification);
  return admit(id, {
    reason: `band:${e.classification}`,
    materiality,
    evidence: levelOf(e.evidence),
    text: `${e.primaryMetric.value}% of the minutes that came free at a position have gone to `
      + `players who did not arrive as first-years${clause ? ` — ${clause}` : ''}.`,
    metric: `${e.primaryMetric.value}%`,
    evidenceNote: `${plural(e.primaryMetric.observations ?? 0, 'position-season', 'position-seasons')}`
      + ` · ${plural(e.measurableSeasons?.length ?? 0, 'measurable season', 'measurable seasons')}`,
  });
}

/**
 * 6. Replacement behaviour.
 *
 * There is no band for a route — the three shares are a description and
 * banding them would imply one route is better than another. So the class is
 * decided by DISTANCE FROM THE POOL MIX, using `STEP_POINTS`: the same
 * ten-point margin `classifyProgramme` uses to call a change a change, and the
 * same one this summary already uses to call a route dominant.
 */
const ROUTE_TEXT = {
  returning: 'players already at the position',
  freshman: 'first-years',
  newcomer: 'players who did not arrive as first-years',
};

function replacementFinding(model) {
  const id = 'replacement-behaviour';
  const s = model.summary?.programme?.replacementBehaviour;
  if (!s) return refuse(id, 'not-computed');
  const evidence = levelOf(s.evidence);
  if (evidence === 'none') return refuse(id, 'evidence-insufficient');
  if (!s.dominantRoute) return refuse(id, 'no-dominant-route');
  const sample = `${s.observations} of ${s.totalObservations} position-seasons readable`;

  if (s.dominantRoute === 'mixed') {
    return admit(id, {
      reason: 'no-route-dominates',
      materiality: 'D',
      evidence,
      text: 'When minutes come free at a position here, no one route takes them: the shares are '
        + `${Math.round(s.shares.returning)}% to players already at the position, `
        + `${Math.round(s.shares.freshman)}% to first-years and `
        + `${Math.round(s.shares.newcomer)}% to players who did not arrive as first-years.`,
      metric: `${Math.round(s.shares.returning)} / ${Math.round(s.shares.freshman)} / ${Math.round(s.shares.newcomer)}`,
      evidenceNote: sample,
    });
  }

  const share = s.shares[s.dominantRoute];
  const poolShare = s.poolMix?.[s.dominantRoute] ?? null;
  const gap = poolShare == null ? null : share - poolShare;
  const departs = gap != null && Math.abs(gap) >= STEP_POINTS;
  return admit(id, {
    reason: departs ? 'route-departs-from-pool' : `dominant-route:${s.dominantRoute}`,
    materiality: departs ? 'B' : 'C',
    evidence,
    text: `When minutes come free at a position here, ${Math.round(share)}% of them go to `
      + `${ROUTE_TEXT[s.dominantRoute]}`
      + (poolShare == null ? '.'
        : ` — comparable programmes give that route ${Math.round(poolShare)}%.`),
    metric: `${Math.round(share)}%`,
    evidenceNote: sample,
  });
}

/**
 * 7. Roster continuity.
 *
 * Evidence is completeness rather than size: `retention` is already null below
 * `MIN_RETURNABLE`, so anything with a figure has cleared the only size gate
 * this analysis has. What separates strong from moderate is whether every
 * continuity observation could be read.
 */
function continuityFinding(model) {
  const id = 'roster-continuity';
  const c = model.lifecycle?.continuity;
  if (!c) return refuse(id, 'not-computed');
  if (c.retention == null) return refuse(id, 'too-few-returnable');
  const materiality = BAND_MATERIALITY[c.band];
  if (!materiality) return refuse(id, `no-classification:${c.band ?? 'none'}`);
  const clause = againstPool(c.band);
  return admit(id, {
    reason: `band:${c.band}`,
    materiality,
    evidence: (c.unreadable ?? 0) === 0 ? 'strong' : 'moderate',
    text: `${c.returned} of the ${c.returnable} players who could return did — ${pc(c.retention)}`
      + `${clause ? `, ${clause}` : ''}.`,
    metric: pc(c.retention),
    evidenceNote: `${plural(c.observations ?? 0, 'season-to-season observation', 'season-to-season observations')}`
      + ((c.unreadable ?? 0) ? `, ${c.unreadable} not readable` : ', all readable'),
  });
}

/**
 * 8. The current squad.
 *
 * A statement about MINUTES ATTACHED TO PLAYERS ON THE ROSTER NOW, and the
 * wording is load-bearing. These minutes do not become available to anybody;
 * the squad that plays the entry season depends on arrivals and departures
 * nothing in this data can see. There is no forecast here and no sentence that
 * could be read as one.
 *
 * No band, deliberately: `squadTurnoverSummary` records why a pool
 * distribution of the expiring share is not defensible, and inventing one here
 * to earn a higher class would be exactly the fudge it refuses.
 */
function currentSquadFinding(model) {
  const id = 'current-squad';
  const s = model.summary?.programme?.squadTurnover;
  if (!s) return refuse(id, 'not-computed');
  if (!s.rostered) return refuse(id, 'no-current-roster');
  const proj = s.projectedMinutes;
  if (!proj?.readable || !proj.total) return refuse(id, 'projected-minutes-not-readable');
  const years = s.expiringByYear ?? [];
  const lead = years.find((y) => y.share != null && y.share >= MEANINGFUL_EXPIRY_SHARE);
  if (!lead) return refuse(id, 'no-year-carries-a-meaningful-share');
  const beyond = years.filter((y) => y.year > lead.year).reduce((n, y) => n + (y.minutes ?? 0), 0);
  return admit(id, {
    reason: 'eligibility-concentration',
    materiality: 'C',
    evidence: proj.playersWithProjection >= proj.projectable ? 'strong' : 'moderate',
    text: `${nf(lead.minutes)} of the ${nf(proj.total)} minutes currently projected across this `
      + `squad are attached to players whose eligibility ends after ${lead.year}`
      + (beyond ? `, and ${nf(beyond)} to players eligible beyond it.` : '.'),
    metric: `${nf(lead.minutes)} min`,
    evidenceNote: `${s.rostered} on the roster · ${proj.playersWithProjection} of `
      + `${proj.projectable} carry a projection`,
  });
}

/**
 * 9. The competitive record.
 *
 * A benchmark statement is admitted only where EVERY measured season's rate
 * fell in the same quarter. That is a count over facts the package already
 * established, in the shape `competitiveFacts` already emits counts, and it
 * keeps the frozen phrasing: the claim is about the RATE, never the programme.
 *
 * Otherwise the aggregate record, which is context and is classed as such.
 */
function competitiveHistoryFinding(model) {
  const id = 'competitive-history';
  const pkg = model.competitive;
  if (!pkg?.available) return refuse(id, 'no-competitive-package');
  const seasons = (pkg.seasons ?? []).filter((s) => s.benchmark?.available);
  const readable = pkg.coverage?.readableSeasons ?? 0;
  if (readable < 2) return refuse(id, 'one-season-supports-no-comparison');

  if (seasons.length === readable && seasons.length >= 2) {
    const upper = seasons.every((s) => s.benchmark.percentile >= 0.75);
    const lower = seasons.every((s) => s.benchmark.percentile <= 0.25);
    if (upper || lower) {
      const q = upper ? 'the upper quarter' : 'the lower quarter';
      return admit(id, {
        reason: upper ? 'every-season-in-upper-quarter' : 'every-season-in-lower-quarter',
        materiality: 'B',
        evidence: 'record',
        text: `All ${seasons.length} measured seasons produced a results rate in ${q} of the `
          + 'programmes measured that season.',
        metric: pkg.summary?.aggregateRecord ?? null,
        evidenceNote: `${seasons.length} of ${readable} seasons carry a benchmark`,
      });
    }
  }
  if (!pkg.summary?.aggregateRecord) return refuse(id, 'no-aggregate-record');
  return admit(id, {
    reason: 'aggregate-record',
    materiality: 'D',
    evidence: 'record',
    text: `Across the ${plural(readable, 'season', 'seasons')} on file the programme recorded `
      + `${pkg.summary.aggregateRecord} in ${plural(pkg.summary.totalMatches, 'match', 'matches')}.`,
    metric: pkg.summary.aggregateRecord,
    evidenceNote: `${seasons.length} of ${readable} seasons carry a benchmark`,
  });
}

/**
 * 10. Where players go.
 *
 * Class D and no higher, ever. A traced sample is the thinnest evidence in the
 * report — the gate lets it through at eight observations — and "15% of
 * departures can be traced" must never outrank a benchmarked share measured
 * over four seasons. It also needs an actual pattern: a coverage statistic with
 * no dominant direction in it is not a finding, it is a footnote about us.
 */
const DIMENSION_TEXT = {
  football: {
    STRONGER_FOOTBALL_RATING: 'a programme rated more highly at football',
    SIMILAR_FOOTBALL_RATING: 'a programme rated similarly at football',
    LOWER_FOOTBALL_RATING: 'a programme rated lower at football',
  },
  division: {
    DIVISION_UP: 'a higher division',
    DIVISION_SAME: 'the same division',
    DIVISION_DOWN: 'a lower division',
  },
};

function destinationFinding(model) {
  const id = 'player-destinations';
  const d = model.lifecycle?.departures;
  if (!d) return refuse(id, 'not-computed');
  if (!d.gate?.allowed) return refuse(id, `gate-closed:${d.gate?.reason ?? 'unknown'}`);
  // The dominant direction on the two dimensions a reader can act on. The
  // academic one is deliberately not a decision-layer statement: it describes
  // the institution rather than the programme's squad building.
  let best = null;
  for (const key of ['division', 'football']) {
    const dim = d.dimensions?.[key];
    if (!dim) continue;
    const total = dim.n - dim.notComparable;
    if (!total) continue;
    for (const [k, text] of Object.entries(DIMENSION_TEXT[key])) {
      const share = (dim[k] ?? 0) / total;
      if (share >= DOMINANT_SHARE && (!best || share > best.share)) {
        best = { share, text, total, key };
      }
    }
  }
  if (!best) return refuse(id, 'no-dominant-pattern-in-traced-sample');
  return admit(id, {
    reason: `dominant-destination:${best.key}`,
    materiality: 'D',
    evidence: 'limited',
    text: `${d.tracing.observed} of ${d.departures.total} departures can be traced to another `
      + `roster, and ${Math.round(best.share * 100)}% of those traced were at ${best.text} the `
      + 'season after.',
    metric: `${d.tracing.observed} of ${d.departures.total}`,
    evidenceNote: `${pc(d.tracing.coverage)} of departures traced`,
  });
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Every candidate, eligible or not, with its reason — the §V explainability
 * table, produced by the same code that produces the page.
 */
export function decisionCandidates(model) {
  const coach = model.coachContext
    ?? coachContextFor(model.coachAttribution, { division: model.college?.division });
  return [
    competitiveEnvironmentFinding(model),
    coachContextFinding(model, coach),
    freshmanFinding(model),
    developmentFinding(model),
    arrivalsFinding(model),
    replacementFinding(model),
    continuityFinding(model),
    currentSquadFinding(model),
    competitiveHistoryFinding(model),
    destinationFinding(model),
  ];
}

/**
 * The ranked, selected findings — and every candidate that was considered.
 *
 * Selection, in full: every A and B; C to fill to six; D only while fewer than
 * four have been taken. Nothing is padded and no absence is admitted to reach
 * a count, which is why a sparse programme returns three findings rather than
 * five with two apologies in them.
 */
export function decisionFindings(model) {
  const considered = decisionCandidates(model);
  const ranked = considered
    .filter((c) => c.eligible)
    .sort((a, b) => CLASS_RANK.get(a.priority) - CLASS_RANK.get(b.priority)
      || EVIDENCE_RANK.get(b.evidence) - EVIDENCE_RANK.get(a.evidence)
      || CATEGORY_RANK.get(a.category) - CATEGORY_RANK.get(b.category));

  const chosen = [];
  for (const c of ranked) {
    if (chosen.length >= MAX_FINDINGS) break;
    if (c.priority === 'D' && chosen.length >= FILL_TO) continue;
    chosen.push(c);
  }
  chosen.forEach((c, i) => { c.rank = i + 1; c.rendered = true; });
  // The rejected candidates keep their rank in the sort so the explainability
  // table can show what came next.
  let n = chosen.length;
  for (const c of ranked) if (!c.rendered) { n += 1; c.rank = n; }
  return { findings: chosen, considered };
}

// ---------------------------------------------------------------------------
// The programme snapshot
// ---------------------------------------------------------------------------

/**
 * The compact factual context the findings sit in.
 *
 * Orientation, not analysis. Nothing here carries a band, a comparison or a
 * conclusion — every one of these is a count, a name or a coverage figure, and
 * the page that owns each subject states it in full later.
 *
 * The coach line is here for every case EXCEPT the one that became a finding,
 * and its length is proportional to what the record supports: a full history
 * is a name and a count, an unresolved record is one sentence, and no record
 * at this level is four words.
 */
export function programmeSnapshot(model, { coach = null } = {}) {
  const ctx = coach
    ?? coachContextFor(model.coachAttribution, { division: model.college?.division });
  const pkg = model.competitive;
  const s = model.summary?.programme ?? {};
  const squad = s.squadTurnover ?? {};
  const proj = squad.projectedMinutes ?? null;
  const latest = pkg?.available
    ? [...(pkg.seasons ?? [])].reverse().find((x) => x.historicalConference || x.historicalDivision)
    : null;

  const facts = [];
  facts.push(['Seasons analysed', model.seasons?.length
    ? `${model.seasons.length} (${model.seasons.map((x) => x.season ?? x).join(', ')})`
    : null]);
  facts.push(['Division', latest?.historicalDivision ?? model.college?.division ?? null]);
  facts.push(['Conference', latest?.historicalConference ?? null]);
  facts.push([`Current roster${squad.season ? `, ${squad.season}` : ''}`,
    squad.rostered ? plural(squad.rostered, 'player', 'players') : null]);
  facts.push(['Projections held', proj?.projectable
    ? `${proj.playersWithProjection} of ${proj.projectable}` : null]);
  facts.push(['Competitive record on file', pkg?.available
    ? `${pkg.coverage.readableSeasons} of ${pkg.coverage.expectedSeasons} seasons, `
      + `${pkg.coverage.benchmarkAvailable} benchmarked` : null]);
  // A dash, not "0 of 0": a programme with no position-seasons to read has
  // nothing here, and a zero out of a zero reads as a measurement of nothing.
  facts.push(['Vacancy observations', s.replacementBehaviour?.totalObservations
    ? `${s.replacementBehaviour.observations} of ${s.replacementBehaviour.totalObservations} readable`
    : null]);

  return {
    facts,
    // So the page can drop the sentence explaining an order that does not
    // exist. A snapshot under no findings is still worth drawing; a note
    // saying how the findings above were ranked is not.
    findings: decisionFindings(model).findings.length,
    coach: coachSnapshot(ctx),
    // Null unless the strip says something a line cannot — the same rule
    // `coachTimelineFor` has always applied.
    prominence: ctx?.prominence ?? PROMINENCE.ABSENT,
  };
}

/**
 * The coach context, sized to what the record supports (§R).
 *
 * Five cases, five different lengths, and deliberately not five equal blocks:
 * a programme with one coach across the whole window needs a name, and a
 * programme whose 2026 row could not be read needs one sentence saying so —
 * not a headline-sized refusal, which is what the card was giving it.
 */
export function coachSnapshot(ctx) {
  if (!ctx) return { label: 'Head coach', value: null, note: null, strip: false };
  switch (ctx.prominence) {
    case PROMINENCE.ABSENT:
      return { label: 'Head coach', value: 'Not on file',
        note: 'no coaching record is held at this level', strip: false };
    case PROMINENCE.REFUSAL:
      return { label: 'Head coach', value: 'Not established',
        note: `${ctx.subline}, so this report cannot say how much of the record below belongs to `
          + 'the current coaching context', strip: false };
    case PROMINENCE.QUIET:
      return { label: 'Head coach', value: ctx.headline, note: withCoHead(ctx, ctx.subline), strip: false };
    case PROMINENCE.PROMINENT:
      // The finding above carries the count, so this is the name and nothing
      // else — except a co-head arrangement, which no other surface states.
      return { label: 'Head coach', value: ctx.headline, note: ctx.coHeadNote ?? null, strip: true };
    default:
      return { label: 'Head coach', value: ctx.headline, note: withCoHead(ctx, ctx.subline), strip: true };
  }
}

/**
 * A card that shows one name over a co-head arrangement is showing half the
 * answer. The note said so before this phase and says so still.
 */
const withCoHead = (ctx, note) => (ctx.coHeadNote ? `${note}. ${ctx.coHeadNote}` : note);
