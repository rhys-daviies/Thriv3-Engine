/**
 * A7.13: choose which programmes a human is asked about, for an OUTREACH-LIST
 * review rather than a model-comparison one.
 *
 * -- WHY THIS IS NOT `stratifiedSample` -----------------------------------
 *
 * The A7.7 sampler exists to test a MODEL CHANGE: its strata are the places
 * V2 disagrees with V1 - major rises, major falls, gate victims, the boundary
 * at a hundred. That is the right instrument for "did this change break
 * anything" and the wrong one for the question A7.13 asks, which is "is the
 * ranked list itself the right outreach list". A sample built around
 * disagreements cannot answer it, because the regions of the list where the
 * two models agree are exactly the regions nobody has ever reviewed.
 *
 * So this samples the LIST, by rank band, from the whole universe - including
 * the deep tail, which the A7.7 sampler never reached and which is where an
 * elite athlete's near-level programmes actually sit.
 *
 * -- DETERMINISTIC THROUGHOUT ---------------------------------------------
 *
 * No randomness anywhere. Band membership is index arithmetic on the ranked
 * list; presentation order is the FNV-1a hash the A7.7 packs already use, so
 * the operator cannot read rank off the page order. The same pool and the
 * same pack id produce the same sample, for ever.
 */
import { RANKING_STATE, isScoreable } from '../types.js';
import { blindKey } from './sample.js';

/**
 * The regions of the list, as rank windows.
 *
 * Inclusive on both ends, in rank space rather than array space, because the
 * brief and the reviewer both talk in ranks and an off-by-one here would
 * silently mis-file a programme in the metrics afterwards.
 */
/**
 * QUOTAS. They sum to 28, plus three limited-data rows and, on an elite pack,
 * about nine more from the relative-strength strata after de-duplication -
 * so a plain pack is 31 rows and an elite one about 40. A7.13 §5 asks for
 * 30-40, and the ceiling is a real constraint rather than a preference: a
 * reviewer asked for sixty rows reads the first twenty carefully.
 *
 * The top ten keeps the largest share because it is where the primary
 * question lives - whether the head of the list is a list we would send.
 */
export const RANK_BAND = Object.freeze({
  TOP_1_10: { key: 'TOP_1_10', from: 1, to: 10, quota: 6 },
  RANKS_11_25: { key: 'RANKS_11_25', from: 11, to: 25, quota: 3 },
  RANKS_26_50: { key: 'RANKS_26_50', from: 26, to: 50, quota: 3 },
  RANKS_51_100: { key: 'RANKS_51_100', from: 51, to: 100, quota: 4 },
  RANKS_101_150: { key: 'RANKS_101_150', from: 101, to: 150, quota: 3 },
  RANKS_151_250: { key: 'RANKS_151_250', from: 151, to: 250, quota: 3 },
  RANKS_251_500: { key: 'RANKS_251_500', from: 251, to: 500, quota: 3 },
  RANKS_501_PLUS: { key: 'RANKS_501_PLUS', from: 501, to: Infinity, quota: 3 },
});

export const RANK_BAND_ORDER = Object.freeze(Object.keys(RANK_BAND));

/** Not a rank band: these carry no rank at all, which is the point of them. */
export const LIMITED_DATA_STRATUM = 'LIMITED_DATA';
export const LIMITED_DATA_QUOTA = 3;

/**
 * The extra strata an elite pack carries, in athlete-relative strength.
 *
 * A7.12 measured the open question: for a rating-9 athlete, 97 of the model's
 * first hundred sit more than 15 strength points below them and near-level
 * programmes take 0 places. A sample drawn on rank alone would reproduce that
 * proportion and the reviewer would never see a near-level programme at all -
 * so the instrument could not observe the trade-off it exists to settle.
 *
 * THIS IS NOT A THUMB ON THE SCALE. It changes which programmes are ASKED
 * about, never what the model did with them, and the reviewer is not told
 * which stratum anything came from. Adding near-level programmes to the sheet
 * is what makes "would you contact this one" a real question rather than a
 * choice among programmes the model has already filtered to one band.
 */
export const RELATIVE_STRATUM = Object.freeze({
  /** Within +-3 strength points of the athlete's own equivalent. */
  NEAR_LEVEL: 'NEAR_LEVEL',
  MODERATELY_BELOW: 'MODERATELY_BELOW',
  SUBSTANTIALLY_BELOW: 'SUBSTANTIALLY_BELOW',
  /**
   * +3 to +10 only. A programme 30 points above an athlete is not a reach,
   * it is a different sport, and putting one on the sheet to "create
   * contrast" would teach the reviewer that the sheet contains absurdities -
   * which changes how they read everything else on it.
   */
  MODEST_REACH: 'MODEST_REACH',
  /** Strong recruiting evidence, weak programme: the trade-off, one way. */
  HIGH_R_WEAK_PROGRAMME: 'HIGH_R_WEAK_PROGRAMME',
  /** Weak recruiting evidence, right level: the trade-off, the other way. */
  LOW_R_NEAR_LEVEL: 'LOW_R_NEAR_LEVEL',
});

export const RELATIVE_QUOTA = Object.freeze({
  NEAR_LEVEL: 3,
  MODERATELY_BELOW: 2,
  SUBSTANTIALLY_BELOW: 2,
  MODEST_REACH: 2,
  HIGH_R_WEAK_PROGRAMME: 2,
  LOW_R_NEAR_LEVEL: 2,
});

/** Strength deltas that define the relative bands. Shared with the metrics. */
export const NEAR_LEVEL_POINTS = 3;
export const SUBSTANTIALLY_BELOW_POINTS = -15;
export const MODEST_REACH_MAX = 10;

/**
 * Evenly spaced picks from a list, ends included.
 *
 * Spread rather than taken from the head: three consecutive programmes at
 * ranks 101, 102 and 103 answer a narrower question than three at 101, 125
 * and 150, because the second triple can show a gradient.
 */
export function spread(rows, count) {
  if (count <= 0 || rows.length === 0) return [];
  if (rows.length <= count) return [...rows];
  if (count === 1) return [rows[Math.floor((rows.length - 1) / 2)]];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(rows[Math.round((i * (rows.length - 1)) / (count - 1))]);
  }
  return out;
}

const strengthOf = (row) => (typeof row.soccerScore === 'number' ? row.soccerScore : null);


/** Pearson over two index vectors. Tie-free here: both are permutations. */
function indexCorrelation(a, b) {
  const n = a.length;
  if (n < 3) return 0;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let cov = 0; let va = 0; let vb = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2;
  }
  return (va === 0 || vb === 0) ? 0 : cov / Math.sqrt(va * vb);
}

/**
 * How much the sheet order may track the model order before the review stops
 * being blind in EFFECT rather than merely in construction.
 *
 * A hash is decorrelated on average and not in any particular case. With
 * forty rows the sampling deviation of a rank correlation is about 0.16, so a
 * pack landing at 0.43 by luck is entirely possible - and it happened, on the
 * developmental athlete, on the first run of six. A reviewer working down a
 * sheet whose order half-tracks the ranking is being given the answer slowly.
 */
export const MAX_ORDER_CORRELATION = 0.25;
const MAX_RESEEDS = 64;

/**
 * A blind order that is decorrelated BY CONSTRUCTION, not by luck.
 *
 * Re-seeds the hash with `packId`, then `packId#2`, `packId#3` ... until the
 * order fails to track the model's, and records which seed won. Deterministic
 * - the same pool and pack id always produce the same seed and the same sheet
 * - and it is not fitting anything: the property being enforced is stated in
 * advance and has nothing to do with what the model or the reviewer says.
 */
export function decorrelatedOrder(rows, modelOrder, packId) {
  const modelIndex = new Map(modelOrder.map((r, i) => [r.id, i]));
  for (let attempt = 1; attempt <= MAX_RESEEDS; attempt += 1) {
    const seed = attempt === 1 ? packId : `${packId}#${attempt}`;
    const order = [...rows].sort((a, b) => blindKey(seed, a.id) - blindKey(seed, b.id)
      || String(a.name).localeCompare(String(b.name)));
    const correlation = indexCorrelation(
      order.map((_, i) => i),
      order.map((r) => modelIndex.get(r.id) ?? 0),
    );
    if (Math.abs(correlation) < MAX_ORDER_CORRELATION) {
      return { order, seed, correlation: Number(correlation.toFixed(4)) };
    }
  }
  /**
   * Unreachable in practice and thrown rather than returned, because the
   * fallback - shipping the least-bad order - would be a blind review that
   * quietly is not one.
   */
  throw new Error(`outreachSample: could not decorrelate the blind order for ${packId} in ${MAX_RESEEDS} attempts`);
}

/**
 * @param {object} args
 * @param {Array}  args.ranked             full ranked list, in rank order
 * @param {Array}  args.limited            the limited-data list
 * @param {string} args.packId             seeds the blind ordering
 * @param {number} args.equivalentStrength the athlete's own calibrated programme strength
 * @param {boolean} [args.eliteOversample] add the relative-strength strata
 * @param {number} [args.topN]
 */
export function outreachSample({
  ranked, limited, packId = '', equivalentStrength = null,
  eliteOversample = false, topN = 100,
}) {
  const picks = new Map();
  const add = (row, stratum) => {
    if (!row) return;
    const found = picks.get(row.id);
    if (found) {
      if (!found.strata.includes(stratum)) found.strata.push(stratum);
      return;
    }
    picks.set(row.id, { row, strata: [stratum] });
  };

  // --- rank bands, over the WHOLE ranked list -----------------------------
  for (const key of RANK_BAND_ORDER) {
    const band = RANK_BAND[key];
    const rows = ranked.filter((r) => r.rank >= band.from && r.rank <= band.to);
    for (const row of spread(rows, band.quota)) add(row, band.key);
  }

  // --- limited data ------------------------------------------------------
  /**
   * Spread across the limited list rather than taken from its head. The head
   * is ordered by how much is KNOWN, so the first three are the best-evidenced
   * of the unscoreable - the easiest cases, and not the ones that test whether
   * a reviewer reads absence as absence.
   */
  for (const row of spread(limited, LIMITED_DATA_QUOTA)) add(row, LIMITED_DATA_STRATUM);

  // --- elite oversample, in athlete-relative strength ---------------------
  if (eliteOversample && Number.isFinite(equivalentStrength)) {
    const withStrength = ranked
      .map((r) => ({ row: r, strength: strengthOf(r) }))
      .filter((x) => x.strength !== null)
      .map((x) => ({ ...x, delta: x.strength - equivalentStrength }));

    const near = withStrength.filter((x) => Math.abs(x.delta) < NEAR_LEVEL_POINTS);
    const modBelow = withStrength.filter((x) => x.delta <= -NEAR_LEVEL_POINTS && x.delta > SUBSTANTIALLY_BELOW_POINTS);
    const subBelow = withStrength.filter((x) => x.delta <= SUBSTANTIALLY_BELOW_POINTS);
    const reach = withStrength.filter((x) => x.delta >= NEAR_LEVEL_POINTS && x.delta < MODEST_REACH_MAX);

    for (const x of spread(near, RELATIVE_QUOTA.NEAR_LEVEL)) add(x.row, RELATIVE_STRATUM.NEAR_LEVEL);
    for (const x of spread(modBelow, RELATIVE_QUOTA.MODERATELY_BELOW)) add(x.row, RELATIVE_STRATUM.MODERATELY_BELOW);
    for (const x of spread(subBelow, RELATIVE_QUOTA.SUBSTANTIALLY_BELOW)) add(x.row, RELATIVE_STRATUM.SUBSTANTIALLY_BELOW);
    for (const x of spread(reach, RELATIVE_QUOTA.MODEST_REACH)) add(x.row, RELATIVE_STRATUM.MODEST_REACH);

    /**
     * The trade-off itself, from both ends. These are selected on model
     * quantities, which is legitimate for choosing WHAT TO ASK ABOUT and
     * would not be for deciding what the answer is - the reviewer sees no R
     * and no stratum label.
     */
    const rOf = (x) => (isScoreable(x.row.recruitability) ? x.row.recruitability.value : null);
    const highRWeak = subBelow
      .filter((x) => rOf(x) !== null)
      .sort((a, b) => rOf(b) - rOf(a));
    for (const x of highRWeak.slice(0, RELATIVE_QUOTA.HIGH_R_WEAK_PROGRAMME)) {
      add(x.row, RELATIVE_STRATUM.HIGH_R_WEAK_PROGRAMME);
    }
    const lowRNear = near
      .filter((x) => rOf(x) !== null)
      .sort((a, b) => rOf(a) - rOf(b));
    for (const x of lowRNear.slice(0, RELATIVE_QUOTA.LOW_R_NEAR_LEVEL)) {
      add(x.row, RELATIVE_STRATUM.LOW_R_NEAR_LEVEL);
    }
  }

  const rows = [...picks.values()].map(({ row, strata }) => ({
    id: row.id,
    name: row.name,
    division: row.division,
    rankingState: row.rankingState,
    rank: row.rankingState === RANKING_STATE.RANKED ? row.rank : null,
    programmeStrength: strengthOf(row),
    strengthDelta: (Number.isFinite(equivalentStrength) && strengthOf(row) !== null)
      ? Number((strengthOf(row) - equivalentStrength).toFixed(2)) : null,
    strata,
    entry: row,
  }));

  /** Rank order for the eventual reveal; hashed order for the blind sheet. */
  const modelOrder = [...rows].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)
    || String(a.name).localeCompare(String(b.name)));
  const { order: blindOrder, seed: orderingSeed, correlation: orderCorrelation } =
    decorrelatedOrder(rows, modelOrder, packId);

  const counts = {};
  for (const r of rows) for (const s of r.strata) counts[s] = (counts[s] || 0) + 1;

  /** What the reviewer is actually looking at, for the frozen record. */
  const inTop100 = rows.filter((r) => r.rank !== null && r.rank <= topN).length;
  const divisions = {};
  for (const r of rows) divisions[r.division] = (divisions[r.division] || 0) + 1;

  return {
    rows: modelOrder,
    blindOrder,
    orderingSeed,
    orderCorrelation,
    counts,
    size: rows.length,
    composition: {
      inTop100,
      outsideTop100: rows.filter((r) => r.rank !== null && r.rank > topN).length,
      limitedData: rows.filter((r) => r.rank === null).length,
      divisions,
      distinctDivisions: Object.keys(divisions).length,
    },
  };
}
