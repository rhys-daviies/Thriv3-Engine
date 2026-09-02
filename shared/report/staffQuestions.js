/**
 * WHAT TO VERIFY WITH THE STAFF — the report's one decision-support surface.
 *
 * The rule is written out in docs/staff-questions.md and summarised here,
 * because a generator whose reasons live only in code is a black box no matter
 * how deterministic it is.
 *
 *   A QUESTION EXISTS ONLY WHERE THE REPORT ALREADY STATES THE FACT THAT
 *   CAUSED IT.
 *
 * The page answers "what should I verify directly with the staff before making
 * a decision?" It does not answer "what should I do?"
 *
 * WHAT THIS MODULE MAY NOT DO.
 *
 * Compute. Every figure quoted below is already in the model and already
 * printed on a page this question points at. There is no arithmetic here and
 * no threshold: each class A and B candidate is gated on an athlete finding
 * `athleteDecisionFindings` ACTUALLY SELECTED, so the materiality test is one
 * the report has already made and published.
 *
 * Recommend. Nothing here says whether to go. A question opens an unknown; it
 * does not preload the answer, and it never implies Thriv3 believes the answer
 * is good or bad.
 *
 * Predict. The entry season has not been played. No question converts
 * eligibility, projections or a historical route into minutes for the reader,
 * and none says a route will repeat: what happened lives in the reason and
 * what is planned lives in the question.
 *
 * Score. The four priority classes order questions. They do not measure an
 * athlete or a programme and they are never printed.
 */
import { PROMINENCE, coachContextFor } from './coachContext.js';
import { athleteDecisionFindings, entryTypeIsFirstTime } from './athleteDecisionLayer.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pcPt = (v) => `${Math.round(v)}%`;

/**
 * The controlled candidate set, in the order that breaks a tie.
 *
 * `family` is the real-world conversation the question belongs to. At most one
 * question is taken from each, because several facts pointing at one
 * conversation are one question and not three.
 */
export const QUESTION_CATEGORIES = Object.freeze([
  { id: 'position-group-beyond-entry', family: 'position-group', section: 'athlete-current-position' },
  { id: 'position-final-season-at-entry', family: 'position-group', section: 'athlete-current-position' },
  { id: 'known-arrivals-at-position', family: 'position-group', section: 'athlete-position-record' },
  { id: 'roster-coverage', family: 'position-group', section: 'athlete-current-position' },
  { id: 'experienced-arrival-reliance', family: 'replacement', section: 'athlete-position-openings' },
  { id: 'position-opening-route', family: 'replacement', section: 'athlete-position-openings' },
  { id: 'first-year-introduction', family: 'introduction', section: 'athlete-position-record' },
  { id: 'coach-attribution', family: 'attribution', section: 'competitive-history' },
  { id: 'competitive-structure', family: 'attribution', section: 'competitive-environment' },
  { id: 'origin-cohort', family: 'origin', section: 'athlete-origin' },
  { id: 'traced-destinations', family: 'evidence', section: 'athlete-position-movement' },
  { id: 'position-sample', family: 'evidence', section: 'athlete-position-openings' },
]);

const RANK = new Map(QUESTION_CATEGORIES.map((c, i) => [c.id, i]));
const CAT = new Map(QUESTION_CATEGORIES.map((c) => [c.id, c]));

export const PRIORITY = Object.freeze(['A', 'B', 'C', 'D']);
const CLASS_RANK = new Map(PRIORITY.map((p, i) => [p, i]));
export const EVIDENCE_LEVELS = Object.freeze(['none', 'limited', 'moderate', 'strong', 'record']);
const CEILING = { record: 'A', strong: 'A', moderate: 'B', limited: 'C', none: null };
const worse = (a, b) => (CLASS_RANK.get(a) >= CLASS_RANK.get(b) ? a : b);

/** Five questions, no floor, and class D only while the page is nearly empty. */
export const MAX_QUESTIONS = 5;
export const FILL_TO = 2;

/**
 * `family` and `section` fall back rather than throw on an unknown id, because
 * the one caller that passes one is the catch that reports a builder having
 * thrown — and a crash inside the error path is how a single bad field in one
 * candidate takes the whole page down.
 */
const candidate = (id, over = {}) => ({
  category: id,
  family: CAT.get(id)?.family ?? 'unknown',
  section: CAT.get(id)?.section ?? null,
  eligible: false,
  refusal: null,
  materiality: null,
  evidence: 'none',
  priority: null,
  question: null,
  reason: null,
  sourceFact: null,
  rendered: false,
  ...over,
});

const refuse = (id, refusal) => candidate(id, { eligible: false, refusal });

/**
 * The only place a priority is assigned: the evidence sets a ceiling, the
 * materiality sets a floor, the worse of the two wins. No arithmetic.
 */
const admit = (id, { materiality, evidence, question, reason, sourceFact, section }) => {
  const ceiling = CEILING[evidence];
  if (!ceiling) return refuse(id, 'evidence-insufficient');
  return candidate(id, {
    eligible: true,
    materiality,
    evidence,
    priority: worse(materiality, ceiling),
    question,
    reason,
    sourceFact,
    ...(section !== undefined ? { section } : {}),
  });
};

/**
 * The findings the report actually ranked, by category.
 *
 * COMPUTED ONCE PER CALL AND PASSED DOWN — 13I / §9. Five of the twelve
 * builders are gated on a selected finding and each of them called this, so
 * `athleteDecisionFindings` ran five times to answer one question set. With
 * `applies`, `scopeOf` and the renderer each building the set, that was
 * fifteen runs per athlete report, measured.
 *
 * It is now built once in `staffQuestionCandidates` and threaded through, so
 * one question set costs one run and a report costs three. The outer three
 * remain: memoising across them would mean handing the same mutable candidate
 * objects to the section planner and the renderer, and at 0.009 ms a run —
 * 0.045 ms of a 66 ms report, under a tenth of one per cent — that trade is
 * not worth making. Composition, not caching.
 */
const selectedFindings = (model) => {
  const { findings } = athleteDecisionFindings(model);
  return new Map(findings.map((f) => [f.category, f]));
};

/**
 * EVERY CANDIDATE'S GATE IMPLIES ITS SOURCE PAGE — 13H.
 *
 * A question cites the section whose page carries its fact, so a question
 * whose page is not in this document is not a question: it would print
 * "Based on: Your position, and the timing around your arrival · elsewhere in
 * this report", which is a citation of nothing. 215 of 791 swept reports did
 * exactly that — `roster-coverage` fired for every athlete entering after the
 * roster horizon, including at programmes with nobody recorded at the position
 * at all, where the page it points at does not render.
 *
 * The gates below therefore repeat the DATA CONDITION each source section
 * applies on, rather than reading a plan that does not exist yet: `applies` is
 * evaluated inside `planSections`, before `model.sections` is set, so checking
 * the plan here would make the contents count and the rendered count disagree.
 * One source of truth, and a baseline invariant renders every athlete report
 * and asserts no question cites a section the document does not contain.
 */

/**
 * The comparison both position-group classes turn on.
 *
 * NOT A NEW THRESHOLD. It is the same comparison of two measured quantities
 * `positionDepthFinding` uses to decide its own class: a count of current
 * players against the number a typical season at this position sees reach a
 * starter's season. Null where the minute reach could not be read, in which
 * case neither class A fires and both fall to C.
 */
const typicalStarterCount = (model) => (model.positionUtilisation?.athletePosition?.available
  ? model.positionUtilisation.athletePosition.medianPlayersWith600Plus : null);

// ---------------------------------------------------------------------------
// The twelve candidates
// ---------------------------------------------------------------------------

/**
 * 1. The group that will still be there.
 *
 * The single most useful thing an athlete can ask, and the report has the fact
 * for it: how many players at this position are eligible past the year they
 * arrive. The QUESTION asks how the staff expects the group to be structured;
 * it does not ask whether those players will block anybody, which is a
 * forecast the report refuses to make and a conclusion this page has no view
 * on.
 */
function positionGroupBeyondEntry(model) {
  const id = 'position-group-beyond-entry';
  const a = model.summary?.athlete;
  const here = a?.currentPositionPlayers ?? [];
  if (!here.length) return refuse(id, 'no-current-roster-at-position');
  const beyond = (a.currentPlayersBeyondEntry ?? []).length;
  if (!beyond) return refuse(id, 'nobody-eligible-beyond-entry');
  const noun = String(a.positionLabel ?? 'this position').toLowerCase();
  const reach = typicalStarterCount(model);
  const material = reach != null && beyond >= reach;

  return admit(id, {
    materiality: material ? 'A' : 'C',
    // A roster is a record of who is on it, not a sample of anything.
    evidence: 'record',
    question: `How does the staff expect the ${noun} group to be structured around ${a.entrySeason}?`,
    reason: `${beyond} of the ${plural(here.length, noun, `${noun}s`)} currently recorded remain `
      + `eligible beyond ${a.entrySeason}.`,
    sourceFact: 'currentPlayersBeyondEntry',
  });
}

/**
 * 2. Succession, where the group runs out at the entry year.
 *
 * The mirror of the one above and a different conversation: players finishing
 * at the position in the year somebody arrives is a question about how the
 * staff sees the position being carried forward, not about a vacancy. The
 * report never says minutes pass to anybody and neither does this.
 */
function positionFinalSeasonAtEntry(model) {
  const id = 'position-final-season-at-entry';
  const a = model.summary?.athlete;
  const here = a?.currentPositionPlayers ?? [];
  if (!here.length) return refuse(id, 'no-current-roster-at-position');
  const finalSeason = (a.currentPlayersInFinalSeasonAtEntry ?? []).length;
  if (!finalSeason) return refuse(id, 'nobody-in-a-final-season-at-entry');
  const noun = String(a.positionLabel ?? 'this position').toLowerCase();
  const reach = typicalStarterCount(model);
  const material = reach != null && finalSeason >= reach;

  return admit(id, {
    materiality: material ? 'A' : 'C',
    evidence: 'record',
    question: `How does the staff see succession at ${noun} around ${a.entrySeason}?`,
    reason: `${plural(finalSeason, `${noun} is`, `${noun}s are`)} in a final eligible season `
      + `in ${a.entrySeason}.`,
    sourceFact: 'currentPlayersInFinalSeasonAtEntry',
  });
}

/**
 * 3. Who has already been added for the coming season.
 *
 * NEVER "competitors" and never a role. The report's own intake page labels
 * this cycle "so far" precisely because it is a published roster rather than a
 * completed recruiting class, and the question is how those players fit the
 * group — not who is ahead of whom.
 */
function knownArrivalsAtPosition(model) {
  const id = 'known-arrivals-at-position';
  const a = model.summary?.athlete;
  if (!a) return refuse(id, 'no-athlete');
  // `pressure.athletePosition.current` is the field the position-record
  // section's own gate reads, so a question generated from it always has that
  // page to cite.
  const cycle = model.pressure?.athletePosition?.current ?? null;
  if (!cycle?.readable || cycle.totalIncoming == null) return refuse(id, 'no-readable-current-cycle');
  const added = cycle.totalIncoming;
  if (!added) return refuse(id, 'nothing-added-at-position-this-cycle');
  const noun = String(a.positionLabel ?? 'this position').toLowerCase();

  return admit(id, {
    materiality: 'C',
    evidence: 'record',
    question: `How do the ${noun}s already added for ${cycle.season} fit into the group around `
      + `${a.entrySeason}?`,
    reason: `${plural(added, `${noun} new to the programme is`, `${noun}s new to the programme are`)} `
      + `on the ${cycle.season} roster published so far.`,
    sourceFact: 'pressure.athletePosition.cycles[current].totalIncoming',
  });
}

/**
 * 4. The horizon, where nothing else in the family fired.
 *
 * An evidence limitation the report already states in full on the position
 * page: rosters and coaching records are held through the current squad
 * season, and the athlete arrives after it. On its own it is the weakest
 * member of its family and it is class C, so it only ever produces the
 * question where the group itself gave no reason to ask one.
 */
function rosterCoverage(model) {
  const id = 'roster-coverage';
  const a = model.summary?.athlete;
  if (!a) return refuse(id, 'no-athlete');
  if (a.entrySeasonKnown) return refuse(id, 'entry-year-inside-the-roster-horizon');
  // The page this cites is the position page, and it renders only where the
  // position group does.
  if (!(a.currentPositionPlayers ?? []).length) return refuse(id, 'no-current-roster-at-position');
  const noun = String(a.positionLabel ?? 'this position').toLowerCase();

  return admit(id, {
    materiality: 'C',
    evidence: 'record',
    question: `How does the staff expect the ${noun} group to look by ${a.entrySeason}?`,
    reason: `Rosters and coaching records are held through ${model.squadSeason}, and you would `
      + `arrive in ${a.entrySeason}.`,
    sourceFact: 'squadSeason vs athlete.entrySeason',
  });
}

/**
 * 5. How experienced arrivals are used at this position.
 *
 * Gated on the finding, so "materially high or materially different" is a test
 * the report has already applied and printed rather than one invented here.
 * The historical share stays in the reason; the question is about the plan.
 *
 * "EXPERIENCED ARRIVALS", never transfers: the underlying category identifies
 * players with college seasons behind them, which is not the same thing as a
 * transfer route, and the report has said so since v1.
 */
function experiencedArrivalReliance(model, found) {
  const id = 'experienced-arrival-reliance';
  const a = model.summary?.athlete;
  if (!found) return refuse(id, 'not-a-selected-finding');
  if (!(a?.positionVacancyHistory?.transitions > 0)) return refuse(id, 'no-readable-transition');
  const o = a?.positionOpeningOutcomes;
  const share = o?.dials?.newcomer;
  if (share == null) return refuse(id, 'no-readable-minute-mix');
  const noun = String(a.positionLabel ?? 'this position').toLowerCase();

  return admit(id, {
    materiality: 'B',
    evidence: found.evidence,
    question: `How does the staff expect experienced arrivals at ${noun} to be used alongside `
      + 'first-time entrants?',
    reason: `${pcPt(share)} of the minutes that came free at ${noun} went to players who did not `
      + 'arrive as first-years.',
    sourceFact: 'positionOpeningOutcomes.dials.newcomer',
  });
}

/**
 * 6. How a place gets filled when one comes free.
 *
 * The reason says what happened. The question says nothing about what happens
 * next — the report's own openings page carries the sentence that a share of
 * three openings reads far more confidently than it deserves to, and a
 * question that assumed the route repeats would contradict the page it points
 * at.
 */
function positionOpeningRoute(model, found) {
  const id = 'position-opening-route';
  const a = model.summary?.athlete;
  if (!found) return refuse(id, 'not-a-selected-finding');
  const v = a?.positionVacancyHistory;
  if (!(v?.transitions > 0)) return refuse(id, 'no-readable-transition');
  if (!v.openings) return refuse(id, 'no-observed-opening');
  const noun = String(a.positionLabel ?? 'this position').toLowerCase();

  return admit(id, {
    materiality: 'B',
    evidence: found.evidence,
    question: `How does the staff currently think about filling a place at ${noun} when one comes `
      + 'free?',
    reason: `A starter left ${noun} in ${v.openings} of ${v.transitions} season-to-season changes `
      + 'on file.',
    sourceFact: 'positionVacancyHistory.openings',
  });
}

/**
 * 7. How first-time entrants are introduced at this position.
 *
 * THE TRANSFER GUARD APPLIES. Where an entry type is on file and it is not a
 * first-time entrant, this refuses rather than asking somebody how they
 * introduce a group the reader is not in. The historical record does not
 * predict the reader's minutes and the question does not suggest it does.
 */
function firstYearIntroduction(model, found) {
  const id = 'first-year-introduction';
  const a = model.summary?.athlete;
  if (!entryTypeIsFirstTime(model.athlete)) return refuse(id, 'entry-type-not-established');
  if (!found) return refuse(id, 'not-a-selected-finding');
  const fh = a?.positionFreshmanHistory;
  if (!fh?.measured) return refuse(id, 'no-first-year-measured-at-position');
  const noun = String(a.positionLabel ?? 'this position').toLowerCase();

  return admit(id, {
    materiality: 'B',
    evidence: found.evidence,
    question: `How does the staff introduce first-time entrants at ${noun}?`,
    reason: `${fh.starters} of the ${plural(fh.measured, `first-year ${noun}`, `first-year ${noun}s`)} `
      + 'with minutes on file reached a 600-minute season.',
    sourceFact: 'positionFreshmanHistory.starters',
  });
}

/**
 * 8. Which seasons the current staff owns.
 *
 * NO CAUSAL QUESTION. Not "why did the previous coach", which asks a coach to
 * account for somebody else's record; the question is which of the seasons in
 * this report the staff considers representative of how it now works, which is
 * the thing a reader actually needs in order to weight everything else.
 *
 * An unresolved coach is class C and never higher. 13C settled that an absence
 * must not outrank measured intelligence, and it does not become a bigger
 * question because it is on a different page.
 */
function coachAttribution(model) {
  const id = 'coach-attribution';
  // The page this cites is "How this programme has competed", which is where
  // the coach-weighted record is set out; it renders only where a competitive
  // package could be read at all.
  if (!model.competitive?.available) return refuse(id, 'no-competitive-record-page');
  const coach = coachContextFor(model.coachAttribution, { division: model.college?.division });
  if (coach.prominence === PROMINENCE.PROMINENT) {
    return admit(id, {
      materiality: 'B',
      evidence: 'record',
      question: 'Which seasons in this report does the current staff consider representative of how '
        + 'the programme is now being run?',
      reason: `${coach.attributed} of the ${plural(coach.measured, 'measured season', 'measured seasons')} `
        + `in this report ${coach.attributed === 1 ? 'was' : 'were'} under ${coach.coach.name}.`,
      sourceFact: 'coachAttribution.measuredSeasons',
    });
  }
  if (coach.prominence === PROMINENCE.REFUSAL) {
    return admit(id, {
      materiality: 'C',
      evidence: 'record',
      question: 'Which seasons in this report does the current staff consider representative of how '
        + 'the programme is now being run?',
      reason: `The coach on file for ${model.recruitSeason} could not be established from the `
        + 'records this report reads.',
      sourceFact: 'coachAttribution.currentCoachReason',
    });
  }
  if (coach.prominence === PROMINENCE.VISIBLE) {
    return admit(id, {
      materiality: 'C',
      evidence: 'record',
      question: 'Which seasons in this report does the current staff consider representative of how '
        + 'the programme is now being run?',
      reason: `${coach.attributed} of the ${plural(coach.measured, 'measured season', 'measured seasons')} `
        + `in this report ${coach.attributed === 1 ? 'was' : 'were'} under ${coach.coach.name}.`,
      sourceFact: 'coachAttribution.measuredSeasons',
    });
  }
  return refuse(id, 'coach-owns-the-measured-record');
}

/**
 * 9. Which seasons belong to the division the programme now plays in.
 *
 * ONLY A DIVISION CHANGE INSIDE THE MEASURED WINDOW, and only where the
 * athlete decision layer selected it — every position comparison in the report
 * is scoped to a division, so a change part-way through is a fact a reader has
 * to weight. A MISSING conference or division row generates nothing: an
 * administrative gap is not a question for a coach, and it is Rochester's
 * missing 2023 row that holds that.
 */
function competitiveStructure(model, found) {
  const id = 'competitive-structure';
  // The finding IS the gate. It fires only on a division change inside the
  // measured window, so a second structural check here would be a second
  // reading of the same rule — and the one this had was reading a field that
  // does not exist, which refused the question at every programme.
  if (!found) return refuse(id, 'not-a-selected-finding');

  return admit(id, {
    materiality: 'C',
    evidence: 'record',
    question: 'Which seasons in this report does the staff consider comparable to the division the '
      + 'programme now plays in?',
    reason: found.metric
      ? `The division on file changes inside the measured window, at ${found.metric}.`
      : 'The division on file changes inside the measured window.',
    sourceFact: 'athlete finding: competitive-structure',
  });
}

/**
 * 10. What the programme has done with players arriving from where you are.
 *
 * Only for an athlete arriving from OUTSIDE the United States, and only where
 * the programme's own origin evidence was refused. For a domestic athlete at a
 * domestic programme the refusal is not decision-relevant, and asking a coach
 * about their record with US-based first-years is the generic recruiting
 * question this page exists to avoid.
 *
 * THE BROAD GROUP, NEVER A NATIONALITY. The analysis folds origin to within or
 * outside the United States because there are never enough players from one
 * country at one programme to measure, and the question uses the same words
 * the analysis does.
 */
function originCohort(model) {
  const id = 'origin-cohort';
  const o = model.summary?.athlete?.originContext;
  if (!o?.requestedOrigin) return refuse(id, 'no-origin-on-file');
  if (o.requestedOrigin !== 'international') return refuse(id, 'origin-group-not-decision-relevant');
  if (o.evidence?.sufficient && o.programme?.sameOrigin?.share != null) {
    return refuse(id, 'programme-has-its-own-origin-record');
  }
  // The origin page's own gate: something recorded here, or a pool to compare
  // against. With neither there is no page to cite.
  if (!((o.programme?.withRecordedOrigin ?? 0) > 0 || o.pool)) return refuse(id, 'no-origin-page');
  const players = o.programme?.sameOrigin?.players ?? 0;

  return admit(id, {
    materiality: 'C',
    evidence: 'record',
    question: 'What experience does the programme have recruiting and settling players arriving '
      + 'from outside the United States?',
    reason: (players
      ? `${plural(players, 'international first-year is', 'international first-years are')} on file here`
      : 'No international first-year is on file here')
      + ', which is not enough to read this programme’s record by origin.',
    sourceFact: 'originContext.programme.sameOrigin.players',
  });
}

/**
 * 11. Where players at this position went next.
 *
 * Class D, so in practice never selected: poor tracing is an evidence
 * limitation and belongs on the evidence pages, not in a conversation with a
 * coach. Kept as a candidate because where the traced group IS large enough to
 * have been ranked as a finding, asking what the staff can add is legitimate
 * due diligence — and it is worded as a request for information rather than as
 * "where did everybody go".
 */
function tracedDestinations(model, found) {
  const id = 'traced-destinations';
  if (!found) return refuse(id, 'not-a-selected-finding');
  const p = model.lifecycle?.athletePosition;
  const noun = String(model.summary?.athlete?.positionLabel ?? 'this position').toLowerCase();

  return admit(id, {
    materiality: 'D',
    evidence: found.evidence,
    question: `What can the staff tell you about where ${noun}s who have left went on to play?`,
    reason: `${p?.atPositionObserved ?? 0} of the departures at this position could be traced to a `
      + 'following programme.',
    sourceFact: 'lifecycle.athletePosition.atPositionObserved',
  });
}

/**
 * 12. An opening sample too small to read as a rate.
 *
 * Class D and an evidence follow-up: the openings page already says a share of
 * two reads far more confidently than it deserves to. Where the sample is that
 * thin the useful thing is what the staff has seen, not what the shares say.
 */
function positionSample(model) {
  const id = 'position-sample';
  const o = model.summary?.athlete?.positionOpeningOutcomes;
  const v = model.summary?.athlete?.positionVacancyHistory;
  if (!(v?.transitions > 0)) return refuse(id, 'no-readable-transition');
  if (!v.openings) return refuse(id, 'no-observed-opening');
  if (o?.evidence?.patternReadable) return refuse(id, 'pattern-readable');
  const noun = String(model.summary?.athlete?.positionLabel ?? 'this position').toLowerCase();

  return admit(id, {
    materiality: 'D',
    evidence: 'limited',
    question: `What has the staff seen happen at ${noun} when a place has come free?`,
    reason: `Only ${plural(v.openings, 'opening has', 'openings have')} been observed at this `
      + 'position, which is too few to read as a rate.',
    sourceFact: 'positionOpeningOutcomes.evidence.patternReadable',
  });
}

/**
 * Paired with the category ids rather than relying on function names, so a
 * builder that throws is still reported AS ITS OWN CATEGORY. Keyed off
 * `build.name` the refusal came back as "coachAttribution", which is not a
 * declared id — the candidate then had no family and the page it fed crashed
 * inside its own error path.
 */
/**
 * The id, the builder, and the finding category the builder is gated on. The
 * third column is what lets one lookup serve all five gated builders.
 */
const BUILDERS = [
  ['position-group-beyond-entry', positionGroupBeyondEntry, null],
  ['position-final-season-at-entry', positionFinalSeasonAtEntry, null],
  ['known-arrivals-at-position', knownArrivalsAtPosition, null],
  ['roster-coverage', rosterCoverage, null],
  ['experienced-arrival-reliance', experiencedArrivalReliance, 'position-arrival-reliance'],
  ['position-opening-route', positionOpeningRoute, 'position-opening-history'],
  ['first-year-introduction', firstYearIntroduction, 'position-first-year-record'],
  ['coach-attribution', coachAttribution, null],
  ['competitive-structure', competitiveStructure, 'competitive-structure'],
  ['origin-cohort', originCohort, null],
  ['traced-destinations', tracedDestinations, 'traced-position-movement'],
  ['position-sample', positionSample, null],
];

/** Every candidate with its verdict, whether it was taken or refused. */
export function staffQuestionCandidates(model) {
  if (!model?.summary?.athlete) return [];
  let ranked;
  return BUILDERS.map(([id, build, gate]) => {
    try {
      if (!gate) return build(model);
      ranked ??= selectedFindings(model);
      return build(model, ranked.get(gate) ?? null);
    } catch { return refuse(id, 'threw'); }
  });
}

/**
 * The questions, ranked, deduplicated by family and capped at five.
 *
 * DEDUPLICATION IS THE POINT OF THE FAMILIES. Seventeen players recorded at a
 * position, thirteen of them eligible beyond entry, projected minutes attached
 * to three of those — one question about the future position group, not three.
 * The highest-priority member of a family wins and carries a second eligible
 * member's fact in its reason, so the conversation is one and the evidence
 * behind it is not thinned.
 */
export function staffQuestions(model) {
  const considered = staffQuestionCandidates(model);
  /**
   * CLASS, THEN DECLARATION ORDER — and no evidence comparator inside a class.
   *
   * Both decision layers sort by evidence within a class, which is right when
   * the competing items are findings about the same subject. Here it was
   * wrong: coach attribution rests on a coaching record ('record') and the
   * position questions rest on a measured sample ('strong', 'moderate'), so
   * sorting by evidence put "which seasons does the staff own" above "how does
   * the staff fill a place at defender" — the least position-specific question
   * first. The evidence ceiling already sets a floor for every class (B needs
   * moderate or better), so a second evidence sort inside a class only
   * re-ranks questions that are equally admissible. Declaration order does it
   * predictably, and it puts the athlete's own position first.
   */
  const ranked = considered
    .filter((c) => c.eligible)
    .sort((a, b) => CLASS_RANK.get(a.priority) - CLASS_RANK.get(b.priority)
      || RANK.get(a.category) - RANK.get(b.category));

  const byFamily = new Map();
  for (const c of ranked) {
    if (!byFamily.has(c.family)) byFamily.set(c.family, []);
    byFamily.get(c.family).push(c);
  }
  const winners = [];
  for (const c of ranked) {
    const family = byFamily.get(c.family);
    if (family[0] !== c) continue;
    // The second eligible member of the family, where there is one: its fact
    // goes in the reason so folding four candidates into one question does not
    // drop three facts. Capped at two, so the reason stays a line or two.
    const also = family[1] ?? null;
    winners.push({ ...c, reason: also ? `${c.reason} ${also.reason}` : c.reason, folded: family.length - 1 });
  }

  const chosen = [];
  for (const c of winners) {
    if (chosen.length >= MAX_QUESTIONS) break;
    if (c.priority === 'D' && chosen.length >= FILL_TO) continue;
    chosen.push(c);
  }
  chosen.forEach((c, i) => { c.rank = i + 1; c.rendered = true; });
  return { questions: chosen, considered };
}

/** The section titles a question may point at, so ids never reach a page. */
export const SOURCE_TITLES = Object.freeze({
  'athlete-current-position': 'Your position, and the timing around your arrival',
  'athlete-position-openings': 'When a place opens',
  'athlete-position-record': 'What this position has looked like here',
  'athlete-origin': 'Where you are arriving from',
  'athlete-position-movement': 'Players at your position we could trace',
  'competitive-history': 'How this programme has competed',
  'competitive-environment': 'The competition these seasons were played in',
});

/** What the page is, said once, above the questions. */
export const PAGE_STANDFIRST = 'Each of these comes from something this report measured, and each '
  + 'one asks about something it cannot: what the staff plans. Nothing here is a concern or a '
  + 'recommendation.';
