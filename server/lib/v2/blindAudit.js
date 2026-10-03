/**
 * A7.13 §18: validate the validator, before a human is shown anything.
 *
 * -- WHY THIS RUNS AT GENERATION TIME AND NOT IN CI ONLY ------------------
 *
 * Because a leak discovered after the sheet has been read is not a leak that
 * was prevented. The generator refuses to write a pack this fails, so the
 * failure mode is a missing file rather than a spoiled review - and a spoiled
 * review cannot be repaired by fixing the code afterwards. The same function
 * is also called from the test suite, against a synthetic pool, so it cannot
 * rot between phases.
 *
 * -- WHAT "LEAK" MEANS HERE -----------------------------------------------
 *
 * Not just the rank. Anything from which the rank could be RECONSTRUCTED:
 * the pursuit priority, the layer values, the gate multipliers, the stratum
 * a programme was sampled from, the position of a row in the model's order,
 * or the model's own prose. The blind view may contain facts about a school
 * and the athlete's own answers, and nothing else.
 */
import { RANKING_STATE } from '../../../shared/matching/v2/index.js';
import { METRIC_IDS } from '../../../shared/matching/v2/validation/outreachRubric.js';
import { RANK_BAND_ORDER, RELATIVE_STRATUM, LIMITED_DATA_STRATUM } from '../../../shared/matching/v2/validation/outreachSample.js';

/**
 * Field names that must never appear in the blind JSON or the markdown.
 *
 * Spelled out rather than derived, because a derived list would be built from
 * the model objects and would therefore stop covering a field the day
 * somebody renamed one.
 */
const FORBIDDEN_KEYS = Object.freeze([
  'pursuitPriority', 'pursuit_priority', 'priority', 'rank', 'rankingState',
  'recruitability', 'financial', 'opportunity', 'base',
  'recruitabilityGate', 'financialGate', 'recruitabilityGateLoss', 'financialGateLoss',
  'athleticPlausibility', 'positionalOpportunity', 'recruitingMarketValue',
  'playingPathway', 'athleticOutcome', 'academicStrengthFit', 'majorFit',
  'locationFit', 'programmeTrajectory', 'squadRotation', 'returningCompetition',
  'coverage', 'grade', 'value', 'percentile', 'delta', 'strengthDelta',
  'strata', 'stratum', 'band', 'reasonCode', 'explanation', 'standing',
  'layerSummary', 'movement', 'v1Rank', 'viewB',
]);

/**
 * The one key allowed to carry the grade vocabulary.
 *
 * A7.7.6 added `evidenceState` to the blind view on purpose: a reviewer asked
 * whether a roster supports a decision has to be told how complete the roster
 * is, and the first review failed precisely because it was not. It uses the
 * words FULL / PARTIAL / INSUFFICIENT / UNKNOWN, which overlap the model's
 * own MEASURED / PARTIAL grade vocabulary without being it - one describes
 * what we hold, the other what the model concluded. The overlap is the reason
 * this exception is named here rather than left to a substring search to
 * blunder into.
 */
const GRADE_WORDS = Object.freeze(['MEASURED', 'UNSCOREABLE', 'BELOW_COVERAGE_FLOOR']);
const EVIDENCE_STATE_KEY = 'evidenceState';

/** Every key name in an object, at any depth. */
function keyNames(value, out = new Set()) {
  if (Array.isArray(value)) { for (const v of value) keyNames(v, out); return out; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.add(k); keyNames(v, out); }
  }
  return out;
}

/** Every string value in an object, paired with the key that held it. */
function stringValues(value, key = null, out = []) {
  if (Array.isArray(value)) { for (const v of value) stringValues(v, key, out); return out; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) stringValues(v, k, out);
    return out;
  }
  if (typeof value === 'string') out.push({ key, value });
  return out;
}

/**
 * Phrases that would only reach the sheet if the model leaked.
 *
 * Phrases rather than words, because the bare words collide with things the
 * reviewer legitimately sees: "opportunity" appears in the athlete's own
 * `playing-opportunity priority`, which A7.13 §1 requires to be shown, and
 * "rank" appears in `national rank`, which is a published attribute.
 */
const FORBIDDEN_PHRASES = Object.freeze([
  'pursuit priority', 'pursuit score', 'coach recruitability', 'recruitability',
  'financial viability', 'athlete opportunity', 'playing pathway',
  'athletic plausibility', 'positional opportunity', 'recruiting market match',
  'athletic outcome', 'academic strength fit', 'major fit',
  'gate', 'gR ', 'gF ', 'limited data', 'limited_data',
  'measured evidence', 'partial evidence', 'unscoreable',
  'model rank', 'thriv3 rank', 'priority 0.', 'top 10', 'top 25', 'top 50',
]);

/**
 * Stratum and band names, which would tell the reviewer where in the list a
 * programme came from just as surely as the rank would.
 */
const FORBIDDEN_LABELS = Object.freeze([
  ...RANK_BAND_ORDER,
  ...Object.values(RELATIVE_STRATUM),
  LIMITED_DATA_STRATUM,
]);

const check = (name, ok, detail = null) => ({ name, ok: Boolean(ok), detail });

/**
 * @param {object} args
 * @param {object} args.pack      a pack from buildOutreachPack
 * @param {string} args.markdown  the rendered View A
 * @param {object} args.ctx       the pool context the pack was built from
 * @param {object} args.sample    the sample, whose `rows` carry the model order
 *                                (passed BESIDE the pack, because the pack no
 *                                longer contains it - that is the point)
 */
export function auditBlindPack({ pack, markdown, ctx, sample }) {
  const checks = [];
  const viewA = pack.viewA.programmes;
  const blindJson = JSON.stringify(viewA);

  // -- 1. no forbidden model field, in either representation ---------------
  /**
   * KEY NAMES, not a substring search. A substring search over the serialised
   * blob cannot tell `facts.roster.evidenceState: "PARTIAL"` - which A7.7.6
   * added deliberately - from a leaked layer grade, and a check that cannot
   * tell them apart gets weakened the first time it fires.
   */
  const keys = keyNames(viewA);
  const keyHits = FORBIDDEN_KEYS.filter((k) => keys.has(k));
  checks.push(check('view A JSON carries no model-output key', keyHits.length === 0,
    keyHits.length ? `found: ${keyHits.join(', ')}` : null));

  const gradeLeak = stringValues(viewA)
    .filter((x) => GRADE_WORDS.includes(x.value) || (x.value === 'PARTIAL' && x.key !== EVIDENCE_STATE_KEY));
  checks.push(check('no layer grade appears outside evidenceState', gradeLeak.length === 0,
    gradeLeak.length ? `found ${gradeLeak.map((x) => `${x.key}=${x.value}`).join(', ')}` : null));

  /**
   * PROGRAMME NAMES ARE REMOVED BEFORE THE SCAN. "Colgate" contains "gate",
   * and a check that a school's own name can trip is a check that gets
   * weakened rather than fixed. The names are already verified against the
   * college rows above, so removing them here hides nothing.
   */
  const sampledNames = viewA.map((p) => p.facts?.name).filter(Boolean)
    .sort((a, b) => b.length - a.length);
  let scrubbed = markdown;
  for (const nm of sampledNames) scrubbed = scrubbed.split(nm).join(' ');
  const lower = scrubbed.toLowerCase();
  const mdHits = FORBIDDEN_PHRASES.filter((t) => (/^[a-z]+$/.test(t)
    ? new RegExp(`\\b${t}\\b`).test(lower)
    : lower.includes(t)));
  checks.push(check('view A markdown carries no model phrase', mdHits.length === 0,
    mdHits.length ? `found: ${mdHits.join(', ')}` : null));

  // -- 2. no rank or bucket ------------------------------------------------
  const labelHits = FORBIDDEN_LABELS.filter((l) => markdown.includes(l) || blindJson.includes(l));
  checks.push(check('no rank band or stratum name appears', labelHits.length === 0,
    labelHits.length ? `found: ${labelHits.join(', ')}` : null));

  const rankHits = [/\brank(ed|ing)? *#? *\d+/i, /\btop[ -]?\d+\b/i, /#\d+\b/]
    .filter((re) => re.test(markdown.replace(/national rank \d+/gi, '')));
  checks.push(check('no rank-shaped phrase in the markdown', rankHits.length === 0,
    rankHits.length ? `matched ${rankHits.length} pattern(s)` : null));

  // -- 3. no pursuit / layer number ---------------------------------------
  const hasModelNumber = viewA.some((p) => {
    const f = p.facts ?? {};
    return f.pursuitPriority !== undefined || f.rank !== undefined
      || f.roster?.value !== undefined || f.recruitingMarket?.value !== undefined
      || f.academic?.value !== undefined || f.academic?.percentile !== undefined;
  });
  checks.push(check('no layer or priority value on any fact block', !hasModelNumber));

  // -- 4. no explanation prose --------------------------------------------
  const proseHits = [
    'would recruit', 'strongly demoted', 'this would otherwise rank',
    'pursuit priority', 'out of reach', 'coach-recruitability',
  ].filter((t) => markdown.toLowerCase().includes(t));
  checks.push(check('no explanation sentence appears', proseHits.length === 0,
    proseHits.length ? `found: ${proseHits.join(', ')}` : null));

  // -- 5. programme names are real and unique ------------------------------
  const byId = new Map(ctx.colleges.map((c) => [c.id, c]));
  const wrongName = viewA.filter((p) => p.facts?.name !== byId.get(p.id)?.name);
  checks.push(check('every programme name matches its college row', wrongName.length === 0,
    wrongName.length ? `${wrongName.length} mismatched` : null));

  const names = viewA.map((p) => p.facts?.name);
  checks.push(check('no duplicate programme in the pack',
    new Set(names).size === names.length,
    new Set(names).size === names.length ? null : `${names.length - new Set(names).size} duplicate(s)`));
  const ids = viewA.map((p) => p.id);
  checks.push(check('no duplicate programme id', new Set(ids).size === ids.length));

  // -- 6. every programme belongs to this athlete's universe ---------------
  const foreign = ids.filter((id) => !byId.has(id));
  checks.push(check('every sampled programme is in this athlete\'s pool', foreign.length === 0,
    foreign.length ? `${foreign.length} foreign` : null));

  const sport = pack.athlete.sport;
  const wrongSport = ids.filter((id) => byId.get(id)?.sport !== sport);
  checks.push(check('every sampled programme is in the athlete\'s sport', wrongSport.length === 0));

  // -- 7. the athlete is a shape production can persist --------------------
  const prefs = [
    pack.athlete.competitiveLevelPriority,
    pack.athlete.playingOpportunityPriority,
    pack.athlete.academicStrengthPriority,
  ];
  checks.push(check('all three preferences are declared 1-5',
    prefs.every((p) => Number.isInteger(p) && p >= 1 && p <= 5),
    `got ${JSON.stringify(prefs)}`));
  checks.push(check('the family contribution is an exact stated figure',
    pack.athlete.contributionState === 'STATED'
      && Number.isFinite(pack.athlete.maxAnnualContributionUsd),
    `${pack.athlete.contributionState} ${pack.athlete.maxAnnualContributionUsd}`));
  checks.push(check('no undeclared preference is reported',
    (pack.athlete.undeclaredPreferences ?? []).length === 0));

  // -- 8. determinism ------------------------------------------------------
  checks.push(check('presentation order is seeded, not ranked',
    typeof pack.digests.orderingSeed === 'string'
      && pack.digests.orderingSeed.startsWith(pack.packId),
    `seed ${pack.digests.orderingSeed}`));
  const numbered = viewA.every((p, i) => p.reviewNo === i + 1);
  checks.push(check('review numbers follow the blind order', numbered));

  /**
   * THE ORDER MUST NOT CORRELATE WITH RANK. A hashed order that happened to
   * come out near rank order would be blind in construction and not in
   * effect. Spearman over the sheet, tie-free because ranks are distinct.
   */
  const sealedRank = new Map((sample?.rows ?? []).map((r, i) => [r.id, i]));
  const xs = viewA.map((_, i) => i);
  const ys = viewA.map((p) => sealedRank.get(p.id) ?? 0);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0; let vx = 0; let vy = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (xs[i] - mx) * (ys[i] - my); vx += (xs[i] - mx) ** 2; vy += (ys[i] - my) ** 2;
  }
  const rho = (vx === 0 || vy === 0) ? 0 : cov / Math.sqrt(vx * vy);
  checks.push(check('page order does not track model order', Math.abs(rho) < 0.35,
    `spearman ${rho.toFixed(3)}`));

  // -- 9. the pack is actually blind ---------------------------------------
  checks.push(check('the pack carries no view B', pack.viewB === null));
  checks.push(check('every review row is unanswered',
    pack.review.rows.every((r) => r.classification === null && r.first100 === null)));
  checks.push(check('metrics were pre-registered before any answer',
    JSON.stringify(pack.metrics.ids) === JSON.stringify(METRIC_IDS)));

  // -- 10. the sample is what it claims to be ------------------------------
  checks.push(check('sample size matches the rendered sheet',
    pack.sample.size === viewA.length, `${pack.sample.size} vs ${viewA.length}`));
  checks.push(check('frozen membership matches the sample',
    pack.sample.frozenMembership.length === viewA.length));
  /**
   * The membership list must not be the ranking. Sorted ids cannot encode it;
   * the model's order would.
   */
  const sorted = [...pack.sample.frozenMembership].sort();
  checks.push(check('frozen membership is sorted, not ranked',
    JSON.stringify(pack.sample.frozenMembership) === JSON.stringify(sorted)));
  checks.push(check('the sample includes programmes with no rank at all',
    pack.sample.composition.limitedData > 0,
    `${pack.sample.composition.limitedData} limited-data rows`));
  checks.push(check('the sample spans more than one division',
    pack.sample.composition.distinctDivisions > 1,
    `${pack.sample.composition.distinctDivisions} divisions`));
  checks.push(check('the sample reaches outside the top 100',
    pack.sample.composition.outsideTop100 > 0,
    `${pack.sample.composition.outsideTop100} outside`));

  const failures = checks.filter((c) => !c.ok);
  return { ok: failures.length === 0, checks, failures };
}

export { FORBIDDEN_KEYS, FORBIDDEN_PHRASES, FORBIDDEN_LABELS, RANKING_STATE };
