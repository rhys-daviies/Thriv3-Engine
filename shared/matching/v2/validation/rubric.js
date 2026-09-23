/**
 * The vocabulary a human operator reviews V2 in.
 *
 * -- WHY THE RUBRIC IS CODE AND NOT A GOOGLE FORM -------------------------
 *
 * Because the labels have to survive the next model. A review collected as
 * free prose tells us what one person thought on one afternoon; a review
 * collected against a pinned vocabulary, beside the commit and the calibration
 * that produced the list, can be replayed against A7.8 and asked whether the
 * disagreement moved. That is the entire point of doing this before adoption
 * rather than after.
 *
 * NOTHING HERE FEEDS A SCORE. These are validation labels. No weight, gate,
 * band or threshold in the model may be fitted to them - not in A7.7 and not
 * later without saying so out loud, because an operator's shortlist is exactly
 * the kind of small, self-consistent target a model can be tuned into
 * agreeing with while getting worse at its actual job.
 */

/**
 * What the operator says about one programme for one athlete.
 *
 * INSUFFICIENT_INFORMATION is deliberately not a point on the scale. It is the
 * same distinction the model itself makes between a low score and an absent
 * one: an operator who cannot judge has not judged mildly, and averaging them
 * into the middle would manufacture the agreement we are trying to measure.
 */
export const CLASSIFICATION = Object.freeze({
  PURSUE_STRONGLY: 'PURSUE_STRONGLY',
  PURSUE: 'PURSUE',
  BORDERLINE: 'BORDERLINE',
  LOW_PRIORITY: 'LOW_PRIORITY',
  WOULD_NOT_PURSUE: 'WOULD_NOT_PURSUE',
  INSUFFICIENT_INFORMATION: 'INSUFFICIENT_INFORMATION',
});

/** The five ordinal labels, strongest first. Used for rank correlation. */
export const CLASSIFICATION_ORDER = Object.freeze({
  PURSUE_STRONGLY: 5,
  PURSUE: 4,
  BORDERLINE: 3,
  LOW_PRIORITY: 2,
  WOULD_NOT_PURSUE: 1,
  // INSUFFICIENT_INFORMATION carries NO ordinal, on purpose.
});

/** The two labels that mean "this is on my outreach list". */
export const PURSUE_SET = Object.freeze(['PURSUE_STRONGLY', 'PURSUE']);

/** Returns null for a label with no ordinal, which callers must handle. */
export function classificationRank(label) {
  const n = CLASSIFICATION_ORDER[label];
  return n === undefined ? null : n;
}

export const isPursue = (label) => PURSUE_SET.includes(label);

/**
 * Why the operator said it.
 *
 * Grouped by which part of the system a tag would implicate IF the operator
 * disagrees with V2 - but the grouping is for triage afterwards, never shown
 * as a hint during review. An operator who knows that "athlete below level"
 * maps to Coach Recruitability is being invited to review the model rather
 * than the programme.
 */
export const REASON_TAG = Object.freeze({
  ATHLETE_BELOW_LEVEL: 'athlete below level',
  ATHLETE_AT_LEVEL: 'athlete comfortably at level',
  PROGRAMME_TOO_WEAK_FOR_GOALS: 'programme may be too weak for athlete goals',
  STRONG_ROSTER_OPPORTUNITY: 'strong roster opportunity',
  WEAK_ROSTER_OPPORTUNITY: 'weak roster opportunity',
  FINANCIAL_CONCERN: 'financial concern',
  GOOD_FINANCIAL_FIT: 'good financial fit',
  PLAYING_OPPORTUNITY: 'playing opportunity',
  LEVEL_PREFERENCE: 'level preference',
  MAJOR_ACADEMIC_FIT: 'major/academic fit',
  INTERNATIONAL_RECRUITING_CONCERN: 'international recruiting concern',
  INSUFFICIENT_ROSTER_DATA: 'insufficient roster data',
  OTHER: 'other',
});

/** Which layer a tag would implicate, for triage AFTER the review. */
export const TAG_IMPLICATES = Object.freeze({
  ATHLETE_BELOW_LEVEL: 'recruitability',
  ATHLETE_AT_LEVEL: 'recruitability',
  PROGRAMME_TOO_WEAK_FOR_GOALS: 'opportunity',
  STRONG_ROSTER_OPPORTUNITY: 'recruitability',
  WEAK_ROSTER_OPPORTUNITY: 'recruitability',
  FINANCIAL_CONCERN: 'financial',
  GOOD_FINANCIAL_FIT: 'financial',
  PLAYING_OPPORTUNITY: 'opportunity',
  LEVEL_PREFERENCE: 'opportunity',
  MAJOR_ACADEMIC_FIT: 'opportunity',
  INTERNATIONAL_RECRUITING_CONCERN: 'recruitability',
  INSUFFICIENT_ROSTER_DATA: 'pipeline',
  OTHER: null,
});

/**
 * The explanation review, asked per sampled programme.
 *
 * ACCURATE is separated from HELPFUL because the dangerous failure is the
 * combination - an explanation that reads well and is wrong is more damaging
 * than one that reads badly, and a single "was this good?" field cannot tell
 * them apart.
 */
export const EXPLANATION_REVIEW = Object.freeze({
  helpful: Object.freeze(['YES', 'PARTLY', 'NO']),
  accurate: Object.freeze(['YES', 'PARTLY', 'NO']),
  tooMuchDetail: Object.freeze(['YES', 'NO']),
  missingImportantReason: 'free text',
  misleadingClaim: 'free text',
  /**
   * Filled during triage, not by the operator: which reason codes were on
   * screen when an explanation was called inaccurate or misleading. A defect
   * we cannot attribute to a code cannot be fixed systematically.
   */
  implicatedCodes: 'array of REASON_CODE',
});

/**
 * What a disagreement MEANS. Assigned during triage, after the review.
 *
 * The order matters: a disagreement is only a MODEL_BUG once the three
 * cheaper explanations have been ruled out, and most will not be. A system
 * that treats every human disagreement as a defect converges on one person's
 * shortlist and stops being a model.
 */
export const DISAGREEMENT = Object.freeze({
  MODEL_BUG: 'MODEL_BUG',
  MODEL_SCOPE_GAP: 'MODEL_SCOPE_GAP',
  DATA_GAP: 'DATA_GAP',
  INPUT_GAP: 'INPUT_GAP',
  HUMAN_JUDGEMENT: 'HUMAN_JUDGEMENT',
  EXPLANATION_DEFECT: 'EXPLANATION_DEFECT',
  ACCEPTABLE_DIFFERENCE: 'ACCEPTABLE_DIFFERENCE',
});

/**
 * MODEL_SCOPE_GAP was added after the first real review, which had no slot
 * for its own dominant finding.
 *
 * Twelve of fourteen HUMAN_JUDGEMENT rows in the Fixture C review shared one
 * cause: Thriv3 holds the data, the athlete supplied it, the arithmetic is
 * right, and the factor is simply not in the scoring architecture. Academic
 * strength was the instance. That is none of the other six - not a data gap,
 * because the data is held; not an input gap, because the athlete answered;
 * not a bug, because nothing computed wrongly; and emphatically not human
 * judgement, because filing it there makes a systematic hole look like
 * reviewer taste and lets it survive every future review unchanged.
 *
 * It is the one category whose correct response is to widen the model.
 */
export const DISAGREEMENT_MEANING = Object.freeze({
  MODEL_BUG: 'The evidence or the arithmetic is wrong. Fix the model.',
  MODEL_SCOPE_GAP: 'Thriv3 holds the evidence and the model does not read it at all. The factor is outside the scoring architecture, not wrong inside it. Widen the model.',
  DATA_GAP: 'The model could not know, because Thriv3 holds no such data. Fix the data, or say so honestly in the explanation.',
  INPUT_GAP: 'We never asked the athlete. Fix the intake.',
  HUMAN_JUDGEMENT: 'Legitimate recruiting knowledge the model does not represent. Record it; do not fit to it.',
  EXPLANATION_DEFECT: 'The score is defensible and the sentence is not. Fix the rendering, not the layer.',
  ACCEPTABLE_DIFFERENCE: 'Neither ordering is objectively better. Leave it alone.',
});

/** The thirteen questions the pack exists to answer. */
export const VALIDATION_QUESTIONS = Object.freeze([
  { id: 'Q1', question: 'Are clearly unrealistic programmes being ranked too highly?', evidence: 'top-10 and top-25 classifications, WOULD_NOT_PURSUE tagged athlete below level' },
  { id: 'Q2', question: 'Are programmes we would genuinely contact being omitted?', evidence: 'the just-outside-100 and now-limited-data strata' },
  { id: 'Q3', question: 'Does the ordering broadly reflect outreach priority?', evidence: 'pairwise ordering agreement and ordinal rank correlation' },
  { id: 'Q4', question: 'Does the model respond correctly to budget constraints?', evidence: 'fixtures A and B share ability and differ only in budget' },
  { id: 'Q5', question: 'Does the model respond correctly to athlete ambition?', evidence: 'fixture A under level-first against playing-first' },
  { id: 'Q6', question: 'Does playing-opportunity preference move the list appropriately?', evidence: 'the same pair, read from the other side' },
  { id: 'Q7', question: 'Are strong athletes being pushed too far down in programme level?', evidence: 'fixture A and H top-25 programme-strength distribution' },
  { id: 'Q8', question: 'Are developmental athletes protected from unrealistic reaches?', evidence: 'fixture C top-25' },
  { id: 'Q9', question: 'Does goalkeeper behaviour make recruiting sense?', evidence: 'fixture G, and the A7.5.2 question of whether the recruitability gate dominates' },
  { id: 'Q10', question: 'Are international athletes treated realistically?', evidence: 'fixture F' },
  { id: 'Q11', question: 'Are Limited-Data programmes correctly separated rather than unfairly penalised?', evidence: 'the limited-data stratum, and whether the operator reads absence as judgement' },
  { id: 'Q12', question: 'Are explanations useful in deciding whether to send an email?', evidence: 'the HELPFUL field' },
  { id: 'Q13', question: 'Are explanations ever convincing but wrong?', evidence: 'HELPFUL=YES with ACCURATE=NO or PARTLY. The most important cell in the whole review.' },
  { id: 'Q14', question: 'Is anything you weighed simply absent from the model rather than wrong in it?', evidence: 'rows you would otherwise file as HUMAN_JUDGEMENT. If Thriv3 holds the evidence and nothing reads it, that is MODEL_SCOPE_GAP.' },
]);

/**
 * RED FLAGS, not a pass mark.
 *
 * Every trigger below is PROPOSED and carries no authority until an operator
 * agrees it is the right line. They are written as specific, countable
 * conditions rather than as an overall percentage because "82% agreement"
 * hides the only failures that matter: a model can agree with a human on
 * ninety ordinary programmes and still put three unrecruitable ones in the
 * top ten, and the average will look fine.
 *
 * severity BLOCKER  -> do not adopt V2 until resolved or explicitly waived
 * severity WATCH    -> record, re-measure after any change, does not block
 */
export const ADOPTION_BLOCKERS = Object.freeze([
  {
    id: 'UNRECRUITABLE_IN_TOP_25',
    severity: 'BLOCKER',
    statement: 'Programmes the operator would not contact at all are appearing high on the list.',
    measure: 'count of WOULD_NOT_PURSUE within V2 ranks 1-25, tagged athlete below level or weak roster opportunity',
    trigger: 'PROPOSED: 4 or more for any single athlete, or 2 or more for a majority of the reviewed athletes',
    rationale: 'This is the V1 pathology restated. If V2 reproduces it the layered model has bought nothing.',
  },
  {
    id: 'DEVELOPMENTAL_ELITE_REACH',
    severity: 'BLOCKER',
    statement: 'A developmental athlete is being shown elite programmes despite low recruitability.',
    measure: 'fixture C: top-25 rows with recruitability below the gate threshold that the operator marks WOULD_NOT_PURSUE',
    trigger: 'PROPOSED: any occurrence',
    rationale: 'The recruitability gate exists for exactly this case. One occurrence means it does not work.',
  },
  {
    id: 'BUDGET_IGNORED',
    severity: 'BLOCKER',
    statement: 'A budget-constrained athlete is being sent a list they cannot afford.',
    measure: 'fixture B: share of top-25 marked WOULD_NOT_PURSUE or LOW_PRIORITY tagged financial concern',
    trigger: 'PROPOSED: more than a third of the reviewed top 25',
    rationale: 'Financial viability is a layer and a gate. If both fire and the list is still unaffordable, the semantics are wrong.',
  },
  {
    id: 'AMBITION_INERT',
    severity: 'BLOCKER',
    statement: 'Declaring a competitive-level ambition barely changes a strong athlete\'s list.',
    measure: 'fixture A: top-100 Jaccard between level-first and playing-first, AND the operator judging that the two lists should differ',
    trigger: 'PROPOSED: Jaccard above 0.85 while the operator says the goals are genuinely different',
    rationale: 'A7.5.1 added the fields and A7.5.2 weighted them. If the operator cannot see the difference, we are collecting a preference for nothing.',
  },
  {
    id: 'MISSING_STRONG_TARGETS',
    severity: 'BLOCKER',
    statement: 'Programmes the operator would contact first are absent from the top 100.',
    measure: 'PURSUE_STRONGLY classifications falling outside V2\'s top 100 (the just-outside, fell and limited-data strata)',
    trigger: 'PROPOSED: 3 or more per athlete, or any programme the operator says they would contact first',
    rationale: 'An omission is invisible in production. This sample is the only place it can be seen.',
  },
  {
    id: 'EXPLANATION_MISREPRESENTS',
    severity: 'BLOCKER',
    statement: 'An explanation states something the evidence does not support.',
    measure: 'ACCURATE = NO with a concrete misleading claim recorded',
    trigger: 'PROPOSED: any occurrence that is a factual misstatement rather than a matter of emphasis',
    rationale: 'A7.6 existed to make the prose truthful. A convincing wrong sentence is worse than no sentence.',
  },
  {
    id: 'LIMITED_DATA_READ_AS_POOR',
    severity: 'BLOCKER',
    statement: 'The operator reads Limited Data as a low score rather than as an absence.',
    measure: 'limited-data rows classified WOULD_NOT_PURSUE with the reason given as the missing data itself',
    trigger: 'PROPOSED: a majority of reviewed limited-data rows',
    rationale: 'The whole ASSUMED-is-abolished architecture depends on a reader understanding the difference. If a trained operator does not, a family will not either.',
  },
  {
    id: 'DIVISION_OR_POSITION_PATHOLOGY',
    severity: 'BLOCKER',
    statement: 'Disagreement concentrates in one division or one position.',
    measure: 'per-division and per-position disagreement rate against the overall rate',
    trigger: 'PROPOSED: twice the overall rate on at least ten reviewed programmes',
    rationale: 'A uniform disagreement is taste. A concentrated one is a defect with an address.',
  },
  {
    id: 'GATE_DOMINATES_GOALKEEPER',
    severity: 'WATCH',
    statement: 'The recruitability gate flattens the goalkeeper list.',
    measure: 'fixture G: gate firing rate in the top 100, and whether the operator finds the top 25 undifferentiated',
    trigger: 'PROPOSED: operator reports the top 25 as interchangeable',
    rationale: 'Left open at A7.5.2. A goalkeeper needs one place to open, so the layer is sharper for them than for a midfielder - which may be correct or may be a gate artefact.',
  },
  {
    id: 'ORDERING_DISAGREEMENT',
    severity: 'WATCH',
    statement: 'The operator would order the list differently within the same classification.',
    measure: 'pairwise ordering agreement where the operator expressed a clear preference',
    trigger: 'PROPOSED: below 0.6 pairwise agreement',
    rationale: 'TOLERABLE by default. Rank order inside a band is the least reliable human judgement here and the least consequential.',
  },
]);

/** Disagreement that is EXPECTED and must not be treated as a defect. */
export const TOLERABLE_DISAGREEMENT = Object.freeze([
  'Ordering within one classification band.',
  'HUMAN_JUDGEMENT disagreements: a coaching relationship, a recent conversation, a transfer the operator knows about.',
  'ACCEPTABLE_DIFFERENCE: two defensible orderings with no evidence separating them.',
  'DATA_GAP disagreements, where the fix is the data rather than the model - provided the explanation says the data is missing.',
  'A limited-data programme the operator would contact anyway. That is the list working: it flags what we cannot score, not what is bad.',
]);

/**
 * The reason tags in the order the generated markdown numbers them.
 *
 * The pack prints a numbered legend and asks the operator to tick numbers, so
 * a filled review legitimately arrives carrying `[1, 7, 10, 12]`. The first
 * real review did exactly that and `assertReview` rejected it - a defect in
 * the pack design, not in the review: a form that asks for numbers may not
 * then demand enum spellings.
 */
export const REASON_TAG_ORDER = Object.freeze(Object.keys(REASON_TAG));

/** Accepts a key, a 1-based number from the printed legend, or the tag's own text. */
export function normaliseReasonTag(tag) {
  if (typeof tag === 'number' || /^\d+$/.test(String(tag))) {
    return REASON_TAG_ORDER[Number(tag) - 1] ?? null;
  }
  if (tag in REASON_TAG) return tag;
  const byText = REASON_TAG_ORDER.find((k) => REASON_TAG[k] === tag);
  return byText ?? null;
}

/** Every reason tag on a row, normalised; unrecognisable entries are dropped by `assertReview` first. */
export const normaliseReasonTags = (tags) => (tags ?? []).map(normaliseReasonTag).filter(Boolean);

/** Shape check for one filled review row. Throws on anything that would corrupt the metrics. */
export function assertReview(row) {
  const fail = (m) => { throw new Error(`validation review: ${m}`); };
  if (!row || typeof row !== 'object') fail('row must be an object');
  if (!row.programmeId) fail('row must name a programmeId');
  if (!(row.classification in CLASSIFICATION)) fail(`unknown classification ${JSON.stringify(row.classification)}`);
  for (const tag of row.reasonTags ?? []) {
    if (normaliseReasonTag(tag) === null) fail(`unknown reason tag ${JSON.stringify(tag)}`);
  }
  const ex = row.explanationReview;
  if (ex) {
    for (const k of ['helpful', 'accurate']) {
      if (ex[k] !== undefined && ex[k] !== null && !EXPLANATION_REVIEW[k].includes(ex[k])) {
        fail(`explanationReview.${k} must be one of ${EXPLANATION_REVIEW[k].join('/')}, got ${JSON.stringify(ex[k])}`);
      }
    }
    if (ex.tooMuchDetail !== undefined && ex.tooMuchDetail !== null
        && !EXPLANATION_REVIEW.tooMuchDetail.includes(ex.tooMuchDetail)) {
      fail(`explanationReview.tooMuchDetail must be YES or NO, got ${JSON.stringify(ex.tooMuchDetail)}`);
    }
  }
  if (row.disagreement !== undefined && row.disagreement !== null && !(row.disagreement in DISAGREEMENT)) {
    fail(`unknown disagreement category ${JSON.stringify(row.disagreement)}`);
  }
  return true;
}
