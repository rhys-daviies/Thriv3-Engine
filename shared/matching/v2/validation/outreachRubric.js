/**
 * A7.13: what the human is asked, and what we will measure — both written
 * down BEFORE any answer exists.
 *
 * -- WHY THE METRICS ARE PRE-REGISTERED -----------------------------------
 *
 * Because the alternative is choosing them afterwards, and afterwards we will
 * know which ones flatter the model. A7.12 ended with a finding the answers
 * to this review can confirm or overturn, which is exactly the situation in
 * which a metric chosen after the fact stops being evidence. Every number
 * A7.13 will report is defined here, in the commit that generated the pack,
 * against a pack whose answers are all null.
 *
 * NOTHING HERE SCORES ANYTHING. These are definitions and vocabulary. No
 * model parameter may be fitted to what this collects - the adoption rule
 * from A7.1 stands, and this is the instrument, not a loss function.
 */
import { CLASSIFICATION, CLASSIFICATION_ORDER, PURSUE_SET } from './rubric.js';
import { RANK_BAND_ORDER, RELATIVE_STRATUM, NEAR_LEVEL_POINTS, SUBSTANTIALLY_BELOW_POINTS } from './outreachSample.js';

export const OUTREACH_PACK_FORMAT = 'thriv3-v3-outreach-pack/1';

/**
 * THE SECOND QUESTION, and the reason this phase exists.
 *
 * The classification asks what the reviewer thinks of the SCHOOL. This asks
 * what they think of its PLACE IN THE LIST, which is the thing the model
 * actually decides and the thing the A7.7 pairwise design could only reach
 * indirectly. A reviewer can quite consistently say a programme is worth
 * pursuing AND that it does not belong in the first hundred contacted, and
 * the old instrument had nowhere to record that.
 *
 * DELIBERATELY NOT A RANK. Asking for a number invites the reviewer to
 * reverse-engineer a ranking they have not been shown, and a guessed rank
 * would then be differenced against the model's as though both meant the
 * same thing.
 */
export const FIRST_100 = Object.freeze({
  id: 'first100',
  question: 'If you were building this athlete\'s outreach list today, should this school '
    + 'be inside roughly the first 100 programmes contacted?',
  answers: Object.freeze(['YES', 'NO', 'UNSURE']),
});

/** The classification taxonomy is UNCHANGED from A7.7, so the two are comparable. */
export const OUTREACH_CLASSIFICATION = CLASSIFICATION;

/**
 * The three questions asked once per athlete, after the programmes.
 *
 * DIAGNOSTIC ONLY, and they are not converted into a score anywhere - a
 * three-point answer from one reviewer about one sample is a direction, not a
 * measurement. They exist because the per-programme questions cannot express
 * "the mix is wrong", which is precisely the A7.12 finding under test.
 */
export const ATHLETE_QUESTIONS = Object.freeze([
  Object.freeze({
    id: 'strongerProgrammes',
    question: 'Are the stronger programmes in this sample generally too high, about right, '
      + 'or too low for this athlete?',
    answers: Object.freeze(['TOO HIGH', 'ABOUT RIGHT', 'TOO LOW']),
  }),
  Object.freeze({
    id: 'tooManyBelow',
    question: 'Does this sample contain too many programmes clearly below the athlete\'s '
      + 'realistic recruiting level?',
    answers: Object.freeze(['YES', 'NO', 'UNSURE']),
  }),
  Object.freeze({
    id: 'changeFirst',
    question: 'If you were running outreach for this athlete, what is the main thing you '
      + 'would change about the programme mix?',
    answers: null,
    freeText: true,
  }),
]);

/**
 * How far outside the hundred a disagreement actually is.
 *
 * A7.12 §25 measured that the top-100 boundary is an operational cutoff
 * through a continuous ranking, not a natural break - the step at #100 is
 * indistinguishable from the step ten places either side. So a programme the
 * reviewer wants inside the hundred and the model puts at #110 is very nearly
 * agreement, and one at #850 is a different claim entirely. Counting both as
 * "missed" would report a model that is mostly right as a model that is
 * mostly wrong.
 */
export const RANK_DISTANCE_BAND = Object.freeze([
  Object.freeze({ key: 'JUST_OUTSIDE', label: '101-150', from: 101, to: 150 }),
  Object.freeze({ key: 'NEAR', label: '151-250', from: 151, to: 250 }),
  Object.freeze({ key: 'FAR', label: '251-500', from: 251, to: 500 }),
  Object.freeze({ key: 'VERY_FAR', label: '501+', from: 501, to: Infinity }),
]);

export function rankDistanceBand(rank) {
  if (!Number.isFinite(rank) || rank <= 100) return null;
  return RANK_DISTANCE_BAND.find((b) => rank >= b.from && rank <= b.to)?.key ?? null;
}

/** The five athlete-relative strength bands, shared with A7.12's tables. */
export const RELATIVE_BAND = Object.freeze([
  Object.freeze({ key: 'SUBSTANTIALLY_ABOVE', label: 'substantially above (>= +10)', test: (d) => d >= 10 }),
  Object.freeze({ key: 'MODERATELY_ABOVE', label: 'moderately above (+3 to +10)', test: (d) => d >= NEAR_LEVEL_POINTS && d < 10 }),
  Object.freeze({ key: 'NEAR_LEVEL', label: 'near athlete level (-3 to +3)', test: (d) => Math.abs(d) < NEAR_LEVEL_POINTS }),
  Object.freeze({ key: 'MODERATELY_BELOW', label: 'moderately below (-15 to -3)', test: (d) => d <= -NEAR_LEVEL_POINTS && d > SUBSTANTIALLY_BELOW_POINTS }),
  Object.freeze({ key: 'SUBSTANTIALLY_BELOW', label: 'substantially below (< -15)', test: (d) => d <= SUBSTANTIALLY_BELOW_POINTS }),
]);

export function relativeBand(delta) {
  if (!Number.isFinite(delta)) return null;
  return RELATIVE_BAND.find((b) => b.test(delta))?.key ?? null;
}

/**
 * EVERY NUMBER A7.13 WILL REPORT, defined before any answer exists.
 *
 * Each entry names what is counted and over which rows. A metric that is not
 * here does not get reported as a V3 result; if the answers suggest one we
 * did not think of, it is a hypothesis for a later phase and is labelled as
 * such rather than quietly added to this list.
 */
export const PREREGISTERED_METRICS = Object.freeze([
  // -- containment: where the human's pursue set actually sits -------------
  Object.freeze({
    id: 'pursueInTopN',
    group: 'containment',
    statement: 'Of the programmes the reviewer classified PURSUE_STRONGLY or PURSUE, the share '
      + 'the model placed inside its top 10, 25, 50 and 100.',
    over: 'sampled programmes with a classification in the pursue set',
    cuts: Object.freeze([10, 25, 50, 100]),
  }),
  Object.freeze({
    id: 'first100YesInsideTop100',
    group: 'containment',
    statement: 'Of the programmes the reviewer answered YES to the first-100 question, the count '
      + 'and share the model placed inside its top 100, and the median model rank of the set.',
    over: 'sampled RANKED programmes answered YES',
  }),
  Object.freeze({
    id: 'first100YesRankDistance',
    group: 'containment',
    statement: 'For every first-100 YES the model placed outside the top 100, the distance beyond '
      + 'the cutoff (rank - 100), reported in the bands 101-150, 151-250, 251-500 and 501+.',
    over: 'sampled RANKED programmes answered YES with rank > 100',
  }),
  Object.freeze({
    id: 'first100NoInsideTop100',
    group: 'containment',
    statement: 'Of the programmes the reviewer answered NO to the first-100 question, the count '
      + 'and share the model nevertheless placed inside its top 100, with their actual ranks.',
    over: 'sampled RANKED programmes answered NO',
  }),

  // -- shape: what the two lists are made of -------------------------------
  Object.freeze({
    id: 'pursueSetShape',
    group: 'shape',
    statement: 'For the human pursue set: median programme strength, median strength delta against '
      + 'the athlete\'s equivalent, and median R, F and O.',
    over: 'sampled RANKED programmes in the pursue set',
  }),
  Object.freeze({
    id: 'modelTopShape',
    group: 'shape',
    statement: 'The same five medians for the model\'s own top 100, over the full universe rather '
      + 'than the sample, so the two are comparable in kind.',
    over: 'the model top 100',
  }),

  // -- the central elite comparison ----------------------------------------
  Object.freeze({
    id: 'eliteRelativeDistribution',
    group: 'elite',
    statement: 'For an elite athlete: the share of the model top 100 that is near level, moderately '
      + 'below and substantially below; then the same distribution over the reviewer\'s first-100 '
      + 'YES set and over their pursue set. THE CENTRAL V3 COMPARISON.',
    over: 'model top 100, human YES set, human pursue set',
    primary: true,
  }),

  // -- agreement, cut every way we already know how to cut it --------------
  Object.freeze({
    id: 'agreementByRelativeBand',
    group: 'agreement',
    statement: 'Classification and first-100 answer, tabulated by athlete-relative strength band: '
      + RELATIVE_BAND.map((b) => b.label).join(' · '),
    over: 'sampled RANKED programmes with a programme strength on file',
  }),
  Object.freeze({
    id: 'agreementByRankBand',
    group: 'agreement',
    statement: 'The same, tabulated by the rank band the programme was sampled from: '
      + RANK_BAND_ORDER.join(' · '),
    over: 'all sampled programmes',
  }),
  Object.freeze({
    id: 'agreementByDivision',
    group: 'agreement',
    statement: 'The same, tabulated by division.',
    over: 'all sampled programmes',
  }),
  Object.freeze({
    id: 'agreementByLayerBand',
    group: 'agreement',
    statement: 'The same, tabulated by R band, F band and O band in quintiles of the sampled set.',
    over: 'sampled RANKED programmes',
  }),
  Object.freeze({
    id: 'agreementByEvidence',
    group: 'agreement',
    statement: 'The same, tabulated by Pursuit evidence grade (MEASURED / PARTIAL) and by '
      + 'LIMITED_DATA status.',
    over: 'all sampled programmes',
  }),

  // -- the thing the previous review got wrong ------------------------------
  Object.freeze({
    id: 'limitedDataReadAsAbsence',
    group: 'limitedData',
    statement: 'For sampled LIMITED_DATA programmes: the share classified INSUFFICIENT_INFORMATION '
      + 'or BORDERLINE (read as an absence) against the share classified WOULD_NOT_PURSUE (read as '
      + 'a poor programme). A7.7 scored 0% read-as-absence on both packs.',
    over: 'sampled LIMITED_DATA programmes',
  }),

  // -- the descriptive trade-off -------------------------------------------
  Object.freeze({
    id: 'recruitabilityVsLevel',
    group: 'tradeoff',
    statement: 'Two groups - (a) human pursue or first-100 YES with model rank > 100, and (b) model '
      + 'rank <= 100 with human LOW_PRIORITY or WOULD_NOT_PURSUE - compared on athletic '
      + 'plausibility, positional opportunity, market fit, R, programme strength, athleticOutcome, '
      + 'playingPathway and F. DESCRIPTIVE ONLY: reported as distributions, not interpreted.',
    over: 'sampled RANKED programmes falling in either group',
  }),

  // -- ordering, reported but never leading ---------------------------------
  Object.freeze({
    id: 'kendallTauB',
    group: 'ordering',
    statement: 'Kendall tau-b between the classification ordinal and the model rank, over sampled '
      + 'RANKED programmes carrying an ordinal. SECONDARY: the classification is a five-point '
      + 'judgement of a school, not a ranking of the sample, so a low tau is weak evidence about '
      + 'the ordering and none at all about the list.',
    over: 'sampled RANKED programmes with a classification carrying an ordinal',
    primary: false,
  }),
]);

/** Metric ids, for the frozen digest and for asserting none was added later. */
export const METRIC_IDS = Object.freeze(PREREGISTERED_METRICS.map((m) => m.id));

/**
 * One empty answer row. Everything null, which is what "not yet reviewed"
 * has to look like: a default of any kind would be indistinguishable from an
 * answer once the sheet comes back.
 */
export function outreachReviewRow(reviewNo, programme) {
  return {
    reviewNo,
    programmeId: programme.id,
    programmeName: programme.facts?.name ?? null,
    classification: null,
    first100: null,
    notes: '',
    reviewedAt: null,
  };
}

/** Accepts a filled row, or says what is wrong with it. */
export function outreachRowError(row) {
  if (!row) return 'row is missing';
  if (row.classification !== null && !(row.classification in CLASSIFICATION)) {
    return `unknown classification ${JSON.stringify(row.classification)}`;
  }
  if (row.first100 !== null && !FIRST_100.answers.includes(row.first100)) {
    return `unknown first-100 answer ${JSON.stringify(row.first100)}`;
  }
  return null;
}

export const isPursueSet = (label) => PURSUE_SET.includes(label);
export const classificationOrdinal = (label) => CLASSIFICATION_ORDER[label] ?? null;
export { RELATIVE_STRATUM };
