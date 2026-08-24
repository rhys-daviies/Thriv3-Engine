/**
 * The six criteria from the deck, each scored independently on 0..1.
 *
 * Every function here is pure and returns the same envelope:
 *
 *   { score, confidence, label, detail }
 *
 * `score` is always a number in [0, 1] — never null, never NaN. Where an
 * input is missing the function returns NEUTRAL_PRIOR and marks
 * `confidence: 'assumed'`, so a school we simply have not collected data for
 * is neither rewarded nor punished for our gap. The old model scored missing
 * roster data as zero opportunity, which meant an unscraped program could
 * never rank well no matter how good a fit it was.
 *
 * `confidence` is one of:
 *   'measured' — every input this criterion needs was present
 *   'partial'  — scored from a weaker proxy, or from data with known holes
 *   'assumed'  — no usable input; this is the neutral prior
 *
 * `label` is the short human word for the card ('target', 'reach', ...) or
 * null where the criterion has no natural label.
 */

import {
  EXPECTED_ANNUAL_NEED,
  DEFAULT_ANNUAL_NEED,
  STARTER_DEPARTURE_WEIGHT,
  SQUAD_DEPARTURE_WEIGHT,
  ATHLETIC_AID_FRACTION,
  MAX_ATHLETIC_AID_FRACTION,
  STANDOUT_DELTA,
  AFFORDABILITY_FLOOR,
  NO_ATHLETIC_AID_CONFERENCES,
  BUDGET_CEILINGS,
  NEUTRAL_PRIOR,
} from './constants.js';

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const assumed = (detail = {}) => ({ score: NEUTRAL_PRIOR, confidence: 'assumed', label: null, detail });

/** A finite number, or null. parseFloat(null) is NaN, which slips past `!= null`. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// 1. Athletic fit
// ---------------------------------------------------------------------------

/** Where the peak sits, in soccer_score points above the program's level. */
export const ATHLETIC_PEAK_OFFSET = 4;
/** Decay below the peak — the athlete is under the program's level. */
export const ATHLETIC_SIGMA_REACH = 14;
/** Decay above the peak — the athlete is over the program's level. */
export const ATHLETIC_SIGMA_OVER = 22;

/**
 * How well the athlete's level matches the program's, on the shared 0..100
 * soccer_score scale.
 *
 * Deliberately asymmetric. The old model used |delta| and so scored a program
 * 20 points below the athlete exactly like one 20 points above, but the two
 * are not the same mistake. Being *under* a program's level means you are not
 * recruited at all, so that side decays faster; being *over* it means you
 * start as a freshman at a program that will not stretch you, which is a
 * worse outcome than it looks but still an outcome.
 *
 * The peak sits slightly above the program's level rather than exactly on it,
 * which is where a recruit walks into playing time.
 */
export function athleticFit({ athleteLevel, programLevel, peakOffset }) {
  const a = num(athleteLevel);
  const p = num(programLevel);
  if (a === null || p === null) return assumed({ reason: a === null ? 'no athlete ability' : 'no program score' });

  // Where the peak sits is not fixed. An athlete who needs money wants to be
  // the standout in a squad rather than the marginal signing, so the coupling
  // layer pushes this further positive for them — see couplings.js.
  const peak = num(peakOffset) ?? ATHLETIC_PEAK_OFFSET;
  const delta = a - p;
  const offset = delta - peak;
  const sigma = offset < 0 ? ATHLETIC_SIGMA_REACH : ATHLETIC_SIGMA_OVER;
  const score = Math.exp(-(offset * offset) / (2 * sigma * sigma));

  // Labels track the peak: with it shifted, a programme at the athlete's own
  // level really is a reach relative to what they are being steered toward.
  const label = delta < peak - 16 ? 'reach' : delta > peak + 10 ? 'safety' : 'target';
  return { score: clamp01(score), confidence: 'measured', label, detail: { delta: round1(delta), athleteLevel: a, programLevel: p, peakOffset: peak } };
}

// ---------------------------------------------------------------------------
// 2. Roster opportunity
// ---------------------------------------------------------------------------

/**
 * Above this share of a school's roster missing estimated_graduation_year,
 * a zero-departures reading is not trustworthy — the departures may simply be
 * unlabelled. Phase 0 still has 3,118 such rows.
 */
export const GRAD_YEAR_NULL_TOLERANCE = 0.3;

/**
 * Is there a realistic opening at this athlete's position in the class year
 * they would arrive?
 *
 * Normalised against how many players the position actually turns over in a
 * year, then capped at 1. The old model added `starters x 5 + squad x 2` with
 * no ceiling, so a program losing eight midfielders scored +16 as though it
 * would sign eight — it will sign two or three.
 *
 * A school with roster rows but nobody graduating at the position scores 0
 * and that is *measured*: there is genuinely no opening. A school with no
 * roster rows at all, or with too many unlabelled class years to tell, falls
 * back to the prior.
 */
export function rosterOpportunity({
  position,
  graduatingStarters = 0,
  graduatingSquad = 0,
  rosterRowsForSchool = 0,
  rowsMissingGradYear = 0,
  classYearKnown = true,
}) {
  // Without the athlete's arrival year there is no cohort to look up, so every
  // school reads as "nobody graduating". Left unguarded that is worse than
  // useless: it scores a measured zero at every school we hold a roster for
  // while unscraped ones keep the neutral prior, so the programmes we know
  // least about rank highest.
  if (!classYearKnown) return assumed({ reason: 'athlete has no recruiting class year' });
  if (!rosterRowsForSchool) return assumed({ reason: 'no roster data for this school and season' });

  const missingShare = rosterRowsForSchool > 0 ? rowsMissingGradYear / rosterRowsForSchool : 1;
  const need = EXPECTED_ANNUAL_NEED[String(position || '').toUpperCase()] ?? DEFAULT_ANNUAL_NEED;
  const departures = graduatingStarters * STARTER_DEPARTURE_WEIGHT + graduatingSquad * SQUAD_DEPARTURE_WEIGHT;
  const raw = clamp01(departures / need);

  const detail = {
    graduatingStarters,
    graduatingSquad,
    expectedAnnualNeed: need,
    weightedDepartures: round1(departures),
    missingGradYearShare: round2(missingShare),
  };

  // Too many unlabelled class years for a low reading to mean anything, so
  // blend toward the prior in proportion to how much of the roster is dark.
  if (missingShare > GRAD_YEAR_NULL_TOLERANCE) {
    const trust = clamp01((1 - missingShare) / (1 - GRAD_YEAR_NULL_TOLERANCE));
    const score = raw * trust + NEUTRAL_PRIOR * (1 - trust);
    return { score: clamp01(score), confidence: 'partial', label: opportunityLabel(raw), detail };
  }

  return { score: raw, confidence: 'measured', label: opportunityLabel(raw), detail };
}

function opportunityLabel(raw) {
  if (raw >= 0.66) return 'high';
  if (raw >= 0.25) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// 3. Academic fit
// ---------------------------------------------------------------------------

/**
 * Floor applied to the admissibility multiplier. A school the athlete is
 * unlikely to get into is heavily penalised but not erased — reaches are a
 * legitimate part of a list.
 */
export const ADMISSIBILITY_FLOOR = 0.4;

/**
 * Academic quality the athlete would get, discounted by whether they would
 * actually be admitted.
 *
 * Note what this is *not*: academic_importance plays no part here. It is an
 * importance slider and belongs in the weight, not in a threshold on quality.
 * The old model filtered out every school rated below the athlete's
 * importance value, which deleted half of D1 for anyone who set it to 7 and
 * removed NAIA and NJCAA almost entirely for anyone who set it above 4.
 */
export function academicFit({ academicRating, schoolSatAvg, schoolAdmitRate, athleteSat, athleteAct, athleteGpa, admissibilityFloor }) {
  const rating = num(academicRating);
  if (rating === null) return assumed({ reason: 'school has no academic rating' });

  const floor = num(admissibilityFloor) ?? ADMISSIBILITY_FLOOR;
  const quality = clamp01(rating / 10);
  const adm = admissibility({ schoolSatAvg, schoolAdmitRate, athleteSat, athleteAct, athleteGpa, academicRating: rating });
  const score = clamp01(quality * (floor + (1 - floor) * adm.value));

  return {
    score,
    confidence: adm.confidence,
    label: adm.label,
    detail: { academicRating: rating, quality: round2(quality), admissibility: round2(adm.value), basis: adm.basis },
  };
}

/** ACT-to-SAT concordance, mid-point of each band (College Board 2018 table). */
const ACT_TO_SAT = { 36: 1590, 35: 1540, 34: 1500, 33: 1460, 32: 1430, 31: 1400, 30: 1370, 29: 1340, 28: 1310, 27: 1280, 26: 1240, 25: 1210, 24: 1180, 23: 1140, 22: 1110, 21: 1080, 20: 1040, 19: 1010, 18: 970, 17: 930, 16: 890, 15: 850, 14: 800, 13: 760, 12: 710, 11: 670 };

function admissibility({ schoolSatAvg, schoolAdmitRate, athleteSat, athleteAct, athleteGpa, academicRating }) {
  const schoolSat = num(schoolSatAvg);
  let sat = num(athleteSat);
  if (sat === null && num(athleteAct) !== null) sat = ACT_TO_SAT[Math.round(num(athleteAct))] ?? null;

  // Best case: both sides have a test score on the same scale.
  if (sat !== null && schoolSat !== null) {
    // Parity is comfortably admissible rather than a coin flip, so the curve
    // is shifted up by 60 points before the logistic.
    const value = 1 / (1 + Math.exp(-(sat - schoolSat + 60) / 70));
    return { value: clamp01(value), confidence: 'measured', label: satLabel(sat - schoolSat), basis: 'sat' };
  }

  // Fallback: GPA against the GPA a school of this calibre typically expects.
  // Rough, but it beats assuming every athlete is admissible everywhere.
  const gpa = num(athleteGpa);
  if (gpa !== null) {
    const expected = 2.6 + academicRating * 0.13;
    const value = 1 / (1 + Math.exp(-(gpa - expected + 0.15) / 0.25));
    return { value: clamp01(value), confidence: 'partial', label: gpa >= expected ? 'likely' : 'stretch', basis: 'gpa' };
  }

  // No academic profile on the athlete at all — do not penalise them for it.
  const admit = num(schoolAdmitRate);
  return { value: 1, confidence: 'assumed', label: admit !== null && admit < 0.2 ? 'highly selective' : null, basis: 'none' };
}

function satLabel(delta) {
  if (delta >= 60) return 'likely';
  if (delta >= -80) return 'competitive';
  return 'stretch';
}

// ---------------------------------------------------------------------------
// 4. Affordability
// ---------------------------------------------------------------------------

/**
 * How reachable this school is for this family, given what a scholarship here
 * could plausibly be worth.
 *
 * Deliberately NOT "is the average price under their budget". The average is
 * the wrong benchmark for a product whose entire purpose is to find awards
 * well above it, and a family's stated budget is a guideline about what would
 * be comfortable, not a wall. So this criterion:
 *
 *   scores the award a *priority signing* could command, not the squad mean,
 *   scaled by how far above the programme's level the athlete sits — which is
 *   the same quantity that makes them a priority signing in the first place;
 *
 *   prices residency properly, because the in-state gap is larger than most
 *   families' entire budget band at D1; and
 *
 *   never reaches zero. A school beyond the stated budget is exactly the
 *   school a scholarship exists to make reachable, so cost tilts the ranking
 *   and removes nothing. AFFORDABILITY_FLOOR is what stops a guideline
 *   behaving like a filter.
 *
 * `budget_range` had been collected since the form was built and read by
 * nothing at all before 2026-08-25.
 */
export function affordability({
  budgetRange, netPrice, control, tuitionIn, tuitionOut, athleteState, schoolState,
  division, sport, conference, athleteLevel, programLevel,
}) {
  const ceiling = BUDGET_CEILINGS[budgetRange];
  if (ceiling === undefined) return assumed({ reason: 'no budget stated' });

  const award = expectedAward({ division, sport, conference, athleteLevel, programLevel });
  const resident = residency({ netPrice, control, tuitionIn, tuitionOut, athleteState, schoolState });
  const price = resident.price;

  const detail = {
    netPrice: price,
    netPriceIsAverage: true,
    expectedAwardFraction: round2(award.fraction),
    awardBasis: award.basis,
    ...resident.detail,
  };
  if (award.caveat) detail.caveat = award.caveat;

  if (price === null) {
    // Without a price the award rules alone still say something useful, and
    // for a full-scholarship request they say most of it.
    if (ceiling === 0) {
      return { score: clamp01(AFFORDABILITY_FLOOR + (1 - AFFORDABILITY_FLOOR) * award.fraction), confidence: 'partial', label: awardLabel(award.fraction), detail };
    }
    return assumed({ reason: 'school has no net price', ...detail });
  }

  const estimatedCost = Math.max(0, price * (1 - award.fraction));
  detail.estimatedCost = Math.round(estimatedCost);

  if (ceiling === Infinity) {
    return { score: 1, confidence: 'measured', label: 'within budget', detail: { ...detail, budgetCeiling: null } };
  }

  const gap = Math.max(0, estimatedCost - ceiling);
  detail.budgetCeiling = ceiling;
  detail.gapToBudget = Math.round(gap);

  // Proportional at larger budgets, but never so steep at small ones that a
  // few thousand dollars wipes a school out.
  const scale = Math.max(8000, ceiling * 0.6);
  const score = clamp01(AFFORDABILITY_FLOOR + (1 - AFFORDABILITY_FLOOR) * Math.exp(-gap / scale));

  return {
    score,
    confidence: 'measured',
    label: gap === 0 ? 'within budget' : gap <= scale * 0.5 ? 'needs a solid offer' : 'needs a big offer',
    detail,
  };
}

/**
 * What this athlete could plausibly be awarded here, 0..1.
 *
 * Between the squad mean and what a priority signing commands, scaled by how
 * far above the programme's level the athlete sits. This is where "drop a
 * level and you become the recruit they pay for" lives as arithmetic rather
 * than as advice.
 */
export function expectedAward({ division, sport, conference, athleteLevel, programLevel }) {
  const mean = athleticAidFraction({ division, sport, conference });
  const max = maxAthleticAidFraction({ division, sport, conference });

  if (max === 0) {
    return {
      fraction: 0,
      basis: 'no athletic aid',
      caveat: `${division || 'This division'} offers no athletic scholarships; any award here would be need-based or academic, which the net price already reflects.`,
    };
  }

  // The caveat belongs on every award we quote, including the fallback: it is
  // about how the sport allocates money, not about how much we know.
  const EQUIVALENCY = 'Soccer is an equivalency sport — the pool is split by hand, so this is what a coach could offer, not what they will.';

  const a = num(athleteLevel);
  const p = num(programLevel);
  if (a === null || p === null) return { fraction: mean, basis: 'squad average', caveat: EQUIVALENCY };

  const standout = clamp01((a - p) / STANDOUT_DELTA);
  return {
    fraction: mean + (max - mean) * standout,
    basis: standout >= 0.6 ? 'priority signing' : standout >= 0.25 ? 'above squad average' : 'squad average',
    caveat: EQUIVALENCY,
  };
}

function awardLabel(fraction) {
  if (fraction >= 0.7) return 'strong offer possible';
  if (fraction >= 0.35) return 'partial offer likely';
  if (fraction > 0) return 'limited athletic aid';
  return 'no athletic aid';
}

/**
 * Net price adjusted for whether the athlete is a resident of the school's state.
 *
 * The single biggest cost lever in US college sport, and the model was blind
 * to it: `net_price` is one average across the whole student body, so an
 * out-of-state athlete and a local one were quoted the same figure. Measured
 * across our own programmes, the out-of-state premium at public institutions
 * runs from $5,245 at NJCAA to $17,871 at NCAA D1 — larger, at D1, than most
 * families' entire stated budget band.
 *
 * Most students at a public institution are residents, so its published net
 * price is close to the in-state figure and the premium is added on top.
 * Private institutions charge one price regardless, so nothing moves.
 */
export function residency({ netPrice, control, tuitionIn, tuitionOut, athleteState, schoolState }) {
  const price = num(netPrice);
  if (price === null) return { price: null, detail: {} };

  const inState = Boolean(athleteState && schoolState && String(athleteState).toUpperCase() === String(schoolState).toUpperCase());
  // control 1 is public; 2 and 3 are private non-profit and for-profit.
  if (num(control) !== 1) return { price, detail: { residency: 'private', inState } };

  const gap = num(tuitionOut) - num(tuitionIn);
  if (!Number.isFinite(gap) || gap <= 0) return { price, detail: { residency: inState ? 'in-state' : 'out-of-state', inState } };

  return inState
    ? { price, detail: { residency: 'in-state', inState: true, outOfStatePremium: 0 } }
    : { price: price + gap, detail: { residency: 'out-of-state', inState: false, outOfStatePremium: Math.round(gap) } };
}

/** What a priority signing could command, 0..1. */
export function maxAthleticAidFraction({ division, sport, conference }) {
  if (conference && NO_ATHLETIC_AID_CONFERENCES.has(conference)) return 0;
  return MAX_ATHLETIC_AID_FRACTION[division]?.[sport] ?? 0;
}

/** Mean athletic aid available per rostered player, 0..1. */
export function athleticAidFraction({ division, sport, conference }) {
  if (conference && NO_ATHLETIC_AID_CONFERENCES.has(conference)) return 0;
  return ATHLETIC_AID_FRACTION[division]?.[sport] ?? 0;
}

// ---------------------------------------------------------------------------
// 5. Program quality
// ---------------------------------------------------------------------------

/**
 * How strong the program is in absolute terms, plus which way it is heading.
 *
 * Distinct from athleticFit, which measures *distance* from the athlete's
 * level. This measures level itself — an athlete generally wants the strongest
 * program that still fits. The old model conflated the two: it exposed
 * `program_quality_rating = soccer_score / 10`, the same number that already
 * drove the ability term, so two of the deck's six criteria were one.
 *
 * `percentile` is supplied by the caller, ranked within the divisions the
 * athlete actually selected, so a D3 athlete is not told every school is weak.
 */
export function programQuality({ percentile, recentWinPct, priorWinPct }) {
  const pct = num(percentile);
  if (pct === null) return assumed({ reason: 'no program score' });

  const recent = num(recentWinPct);
  const prior = num(priorWinPct);
  if (recent === null || prior === null) {
    return { score: clamp01(pct), confidence: 'partial', label: qualityLabel(pct), detail: { percentile: round2(pct), trajectory: null } };
  }

  // A swing of 20 percentage points in win rate across two-season halves is a
  // decisive trend; anything less scales linearly inside that.
  const swing = clamp01((recent - prior) / 0.4 + 0.5);
  const score = clamp01(0.75 * pct + 0.25 * swing);
  return {
    score,
    confidence: 'measured',
    label: qualityLabel(pct),
    detail: { percentile: round2(pct), recentWinPct: round2(recent), priorWinPct: round2(prior), trajectory: trajectoryLabel(recent - prior) },
  };
}

function qualityLabel(pct) {
  if (pct >= 0.85) return 'elite';
  if (pct >= 0.6) return 'strong';
  if (pct >= 0.3) return 'solid';
  return 'developing';
}

function trajectoryLabel(delta) {
  if (delta >= 0.1) return 'rising';
  if (delta <= -0.1) return 'falling';
  return 'steady';
}

// ---------------------------------------------------------------------------
// 6. Geography
// ---------------------------------------------------------------------------

/** Miles at which the distance term has decayed to roughly a third. */
export const DISTANCE_SCALE_MILES = 800;
/** Floor, so a school across the country is not written off on distance alone. */
export const DISTANCE_FLOOR = 0.25;

/**
 * How close to home the school is.
 *
 * The form collects the athlete's city and state and nothing has ever read
 * them. Distance is measured from the athlete's state centroid to the
 * school's coordinates — accurate to a couple of hundred miles, which is
 * ample for a preference this soft.
 *
 * Assumes a mild preference for staying closer to home, which is true on
 * average and false for plenty of individuals. Until the form asks the
 * question directly, the operator weight is the escape hatch.
 */
export function geography({ athleteState, schoolState, distanceMiles }) {
  const d = num(distanceMiles);
  const sameState = athleteState && schoolState && String(athleteState).toUpperCase() === String(schoolState).toUpperCase();

  if (d === null) {
    if (!sameState) return assumed({ reason: 'no coordinates for school or athlete state' });
    return { score: 0.9, confidence: 'partial', label: 'in state', detail: { sameState: true } };
  }

  const decay = DISTANCE_FLOOR + (1 - DISTANCE_FLOOR) * Math.exp(-d / DISTANCE_SCALE_MILES);
  // In-state carries a real benefit beyond distance — public tuition, family
  // travel to games — so it lifts the score rather than relying on mileage.
  const score = clamp01(sameState ? Math.max(decay, 0.9) : decay);
  return {
    score,
    confidence: 'measured',
    label: sameState ? 'in state' : d <= 300 ? 'nearby' : d <= 800 ? 'regional' : 'far from home',
    detail: { distanceMiles: Math.round(d), sameState: Boolean(sameState) },
  };
}

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
