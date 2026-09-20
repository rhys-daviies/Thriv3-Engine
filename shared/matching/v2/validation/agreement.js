/**
 * Turn a filled review into numbers, without turning it into one number.
 *
 * -- WHY THERE IS NO "ACCURACY" FIELD -------------------------------------
 *
 * Because a single percentage would hide every failure worth finding. A model
 * can agree with an operator on ninety ordinary programmes and still put three
 * unrecruitable ones in the top ten, and the average comes out at 97%. The
 * metrics below are deliberately asymmetric: they count the top of the list
 * and the omissions separately, because those are the two places a ranking
 * costs somebody something.
 *
 * -- WHY KENDALL AND NOT SPEARMAN -----------------------------------------
 *
 * The human scale has five points and the model's has a thousand, so any
 * review of forty programmes carries enormous ties on one side. Spearman's rho
 * over averaged tied ranks is defined but not very meaningful here; Kendall's
 * tau-b is built for exactly this shape and reduces to "of the pairs where the
 * operator expressed a preference, how often did V2 order them the same way" -
 * which is also the question worth asking.
 *
 * NOTHING HERE IS A TARGET. No weight, gate or threshold may be fitted to it.
 */
import { CLASSIFICATION, classificationRank, isPursue } from './rubric.js';

const rate = (n, d) => (d > 0 ? Number((n / d).toFixed(4)) : null);

/**
 * Whether one reviewed row counts as a disagreement.
 *
 * COARSE ON PURPOSE. It asks only about placement - top of the list, off the
 * list, or not scored - because those are the three decisions the ranking
 * actually makes. Ordering within a band is measured separately by tau, and
 * treating it as disagreement here would swamp the signal with taste.
 *
 * INSUFFICIENT_INFORMATION is neither agreement nor disagreement and leaves
 * the denominator entirely, for the same reason the model has no ASSUMED
 * grade: an absent judgement is not a mild one.
 */
export function rowAgreement(row, { rank, rankingState, topN = 100 }) {
  if (row.classification === CLASSIFICATION.INSUFFICIENT_INFORMATION) return { counted: false };
  if (rankingState === 'LIMITED_DATA') {
    return {
      counted: true,
      disagrees: row.classification === CLASSIFICATION.PURSUE_STRONGLY,
      kind: row.classification === CLASSIFICATION.PURSUE_STRONGLY ? 'STRONG_TARGET_NOT_SCORED' : null,
    };
  }
  const inTop25 = Number.isFinite(rank) && rank <= 25;
  const inTop = Number.isFinite(rank) && rank <= topN;
  if (inTop25 && (row.classification === CLASSIFICATION.LOW_PRIORITY
    || row.classification === CLASSIFICATION.WOULD_NOT_PURSUE)) {
    return { counted: true, disagrees: true, kind: 'RANKED_HIGH_HUMAN_LOW' };
  }
  if (!inTop && isPursue(row.classification)) {
    return { counted: true, disagrees: true, kind: 'HUMAN_PURSUE_MODEL_OMITTED' };
  }
  return { counted: true, disagrees: false, kind: null };
}

/** Kendall's tau-b between the human ordinal (higher is better) and V2 order (lower rank is better). */
export function kendallTauB(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  let concordant = 0; let discordant = 0; let tiedHuman = 0; let tiedModel = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      // Human: higher ordinal is better. Model: LOWER rank is better, so flip.
      const h = Math.sign(pairs[i].human - pairs[j].human);
      const m = Math.sign(pairs[j].rank - pairs[i].rank);
      if (h === 0 && m === 0) continue;
      if (h === 0) { tiedHuman += 1; continue; }
      if (m === 0) { tiedModel += 1; continue; }
      if (h === m) concordant += 1; else discordant += 1;
    }
  }
  const denom = Math.sqrt((concordant + discordant + tiedHuman) * (concordant + discordant + tiedModel));
  if (denom === 0) return null;
  return {
    tauB: Number(((concordant - discordant) / denom).toFixed(4)),
    concordant, discordant, tiedHuman, tiedModel,
    /** The operator's own words for it: of the pairs they ordered, how many did V2 order the same. */
    pairwiseOrderingAgreement: rate(concordant, concordant + discordant),
  };
}

const tally = (rows, key) => rows.reduce((acc, r) => {
  const k = key(r); if (k === null || k === undefined) return acc;
  acc[k] = (acc[k] || 0) + 1; return acc;
}, {});

/**
 * Metrics for one pack.
 *
 * @param {object} pack     the generated packet
 * @param {Array}  reviews  filled review rows, keyed by programmeId
 */
export function agreementFor(pack, reviews) {
  const byId = new Map(reviews.map((r) => [r.programmeId, r]));
  const rows = pack.viewB.programmes
    .map((p) => ({ p, review: byId.get(p.id) }))
    .filter((x) => x.review && x.review.classification);

  const ranked = rows.filter((x) => x.p.model.rankingState === 'RANKED');
  const inTop = (n) => ranked.filter((x) => x.p.rank <= n);
  const outside = rows.filter((x) => x.p.model.rankingState === 'RANKED' && x.p.rank > 100);
  const limited = rows.filter((x) => x.p.model.rankingState === 'LIMITED_DATA');

  const share = (set, pred) => rate(set.filter(pred).length, set.length);
  const judged = (set) => set.filter((x) => x.review.classification !== CLASSIFICATION.INSUFFICIENT_INFORMATION);

  const t10 = judged(inTop(10));
  const t25 = judged(inTop(25));
  const t100 = judged(inTop(100));
  const off = judged([...outside, ...limited]);

  const disagreements = rows
    .map((x) => ({ x, a: rowAgreement(x.review, { rank: x.p.rank, rankingState: x.p.model.rankingState }) }))
    .filter((d) => d.a.counted);

  const breakdown = (key) => {
    const groups = {};
    for (const d of disagreements) {
      const k = key(d.x); if (k === null || k === undefined) continue;
      groups[k] ??= { reviewed: 0, disagreed: 0 };
      groups[k].reviewed += 1;
      if (d.a.disagrees) groups[k].disagreed += 1;
    }
    for (const g of Object.values(groups)) g.rate = rate(g.disagreed, g.reviewed);
    return groups;
  };

  const ordinalPairs = ranked
    .map((x) => ({ human: classificationRank(x.review.classification), rank: x.p.rank }))
    .filter((x) => x.human !== null);

  const explanation = rows.map((x) => x.review.explanationReview).filter(Boolean);
  const convincingButWrong = rows.filter((x) => {
    const e = x.review.explanationReview; if (!e) return false;
    return e.helpful === 'YES' && (e.accurate === 'NO' || e.accurate === 'PARTLY');
  });

  return {
    packId: pack.packId,
    athlete: pack.athlete.label,
    reviewed: rows.length,
    counted: disagreements.length,

    /** THE TOP OF THE LIST. */
    top10StrongPursue: { n: t10.length, rate: share(t10, (x) => x.review.classification === CLASSIFICATION.PURSUE_STRONGLY) },
    top10Pursue: { n: t10.length, rate: share(t10, (x) => isPursue(x.review.classification)) },
    top25Agreement: { n: t25.length, rate: share(t25, (x) => isPursue(x.review.classification)) },
    humanLowPriorityInTop25: {
      n: t25.length,
      rate: share(t25, (x) => x.review.classification === CLASSIFICATION.LOW_PRIORITY
        || x.review.classification === CLASSIFICATION.WOULD_NOT_PURSUE),
    },
    humanWouldNotPursueInTop100: {
      n: t100.length,
      rate: share(t100, (x) => x.review.classification === CLASSIFICATION.WOULD_NOT_PURSUE),
    },

    /** THE OMISSIONS. Only measurable because the sample deliberately reaches outside the hundred. */
    top100Omission: {
      n: off.length,
      rate: share(off, (x) => isPursue(x.review.classification)),
      programmes: off.filter((x) => isPursue(x.review.classification))
        .map((x) => ({ id: x.p.id, name: x.p.name, rank: x.p.rank, state: x.p.model.rankingState, classification: x.review.classification })),
    },

    /**
     * LIMITED DATA. The number that matters is not agreement but whether the
     * operator read the absence as an absence: INSUFFICIENT_INFORMATION and
     * BORDERLINE are the list working, WOULD_NOT_PURSUE tagged on the missing
     * data itself is the misreading the architecture cannot survive.
     */
    limitedData: {
      n: limited.length,
      classifications: tally(limited, (x) => x.review.classification),
      readAsAbsence: share(limited, (x) => x.review.classification === CLASSIFICATION.INSUFFICIENT_INFORMATION
        || x.review.classification === CLASSIFICATION.BORDERLINE),
      readAsPoor: share(limited, (x) => x.review.classification === CLASSIFICATION.WOULD_NOT_PURSUE
        && (x.review.reasonTags ?? []).includes('INSUFFICIENT_ROSTER_DATA')),
    },

    ordering: kendallTauB(ordinalPairs),

    disagreementRate: rate(disagreements.filter((d) => d.a.disagrees).length, disagreements.length),
    disagreementKinds: tally(disagreements.filter((d) => d.a.disagrees), (d) => d.a.kind),
    disagreementCategories: tally(rows, (x) => x.review.disagreement),
    byDivision: breakdown((x) => x.p.division),
    byStratum: (() => {
      const g = {};
      for (const d of disagreements) {
        for (const s of d.x.p.strata) {
          g[s] ??= { reviewed: 0, disagreed: 0 };
          g[s].reviewed += 1; if (d.a.disagrees) g[s].disagreed += 1;
        }
      }
      for (const v of Object.values(g)) v.rate = rate(v.disagreed, v.reviewed);
      return g;
    })(),

    explanationReview: {
      n: explanation.length,
      helpful: tally(explanation, (e) => e.helpful),
      accurate: tally(explanation, (e) => e.accurate),
      tooMuchDetail: tally(explanation, (e) => e.tooMuchDetail),
      /** Q13. The most important cell in the review. */
      convincingButWrong: convincingButWrong.map((x) => ({
        id: x.p.id, name: x.p.name,
        claim: x.review.explanationReview.misleadingClaim || null,
        codes: x.p.explanation.codes.map((c) => c.code),
      })),
    },

    reasonTags: tally(rows.flatMap((x) => (x.review.reasonTags ?? []).map((t) => ({ t }))), (x) => x.t),
    qualitative: rows.filter((x) => x.review.notes).map((x) => ({ id: x.p.id, name: x.p.name, notes: x.review.notes })),
  };
}

/**
 * Across several packs, with the breakdowns that only exist between athletes.
 *
 * `athleteLevel`, `position` and `preferenceProfile` come from each pack's own
 * athlete block, so a disagreement concentrated in one archetype has somewhere
 * to show up.
 */
export function aggregateAgreement(entries) {
  const per = entries.map(({ pack, reviews }) => ({ pack, result: agreementFor(pack, reviews) }));
  const across = (key) => {
    const g = {};
    for (const { pack, result } of per) {
      const k = key(pack.athlete); if (k === null || k === undefined) continue;
      g[k] ??= { packs: 0, reviewed: 0, weightedDisagreement: 0 };
      g[k].packs += 1;
      g[k].reviewed += result.counted;
      g[k].weightedDisagreement += (result.disagreementRate ?? 0) * result.counted;
    }
    for (const v of Object.values(g)) {
      v.rate = v.reviewed > 0 ? Number((v.weightedDisagreement / v.reviewed).toFixed(4)) : null;
      delete v.weightedDisagreement;
    }
    return g;
  };
  return {
    packs: per.map((p) => p.result),
    byAthleteLevel: across((a) => a.abilityBand),
    byPosition: across((a) => a.position),
    byPreferenceProfile: across((a) => a.preferenceProfile),
    /** Divisions are pooled across athletes: a D3 pathology is not one athlete's problem. */
    byDivision: (() => {
      const g = {};
      for (const { result } of per) {
        for (const [d, v] of Object.entries(result.byDivision)) {
          g[d] ??= { reviewed: 0, disagreed: 0 };
          g[d].reviewed += v.reviewed; g[d].disagreed += v.disagreed;
        }
      }
      for (const v of Object.values(g)) v.rate = rate(v.disagreed, v.reviewed);
      return g;
    })(),
  };
}
