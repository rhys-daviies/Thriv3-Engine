/**
 * Choose which programmes a human is asked to review.
 *
 * -- WHY A SAMPLE AND NOT THE TOP 100 -------------------------------------
 *
 * Because an operator asked to read a hundred rows reads the first twenty
 * carefully and the rest as a formality, and the twenty they read carefully
 * are the twenty the model is least likely to be wrong about. The strata below
 * deliberately over-sample the places a ranking model fails: the boundary at
 * a hundred, the programmes that moved furthest against V1, the ones a gate
 * demoted, and the ones we refused to score at all.
 *
 * DETERMINISTIC throughout. No randomness anywhere: the same run produces the
 * same sample, so a second review of the same pack reviews the same rows and a
 * later model can be asked about the same programmes.
 */
import { RANKING_STATE, isScoreable } from '../types.js';

export const STRATUM = Object.freeze({
  TOP_10: 'TOP_10',
  RANKS_20_30: 'RANKS_20_30',
  RANKS_45_55: 'RANKS_45_55',
  RANKS_90_100: 'RANKS_90_100',
  JUST_OUTSIDE_TOP: 'JUST_OUTSIDE_TOP',
  MAJOR_RISE: 'MAJOR_RISE',
  MAJOR_FALL: 'MAJOR_FALL',
  LIMITED_DATA: 'LIMITED_DATA',
  HIGH_PROGRAMME_STRENGTH: 'HIGH_PROGRAMME_STRENGTH',
  LOW_PROGRAMME_STRENGTH: 'LOW_PROGRAMME_STRENGTH',
  FINANCIAL_GATE: 'FINANCIAL_GATE',
  RECRUITABILITY_GATE: 'RECRUITABILITY_GATE',
});

/**
 * Evenly spaced picks from an inclusive rank window, ends included.
 *
 * Spread rather than taken from the head, because three consecutive
 * programmes at ranks 20, 21 and 22 answer a narrower question than three at
 * 20, 25 and 30 - the second triple can show a gradient and the first cannot.
 */
function spread(rows, count) {
  if (rows.length <= count) return [...rows];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(rows[Math.round((i * (rows.length - 1)) / (count - 1))]);
  }
  return out;
}

const byLoss = (rows, key) => [...rows]
  .filter((r) => isScoreable(r.pursuitPriority) && r.pursuitPriority.basis[key] > 0)
  .sort((a, b) => b.pursuitPriority.basis[key] - a.pursuitPriority.basis[key]);

/**
 * FNV-1a over the pack id and the programme id.
 *
 * Used only to ORDER the blind view, so that the operator cannot read rank
 * off the page order - which would defeat the blindness entirely, and is the
 * single easiest way to ruin this exercise. It is a hash rather than a
 * shuffle so the order is reproducible from the pack id alone.
 */
export function blindKey(packId, programmeId) {
  let h = 0x811c9dc5;
  for (const ch of `${packId}:${programmeId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * @param {object} args
 * @param {Array}  args.ranked    the full ranked list, in rank order
 * @param {Array}  args.limited   the limited-data list, in its own order
 * @param {Map}    args.v1Ranks   programme id -> frozen V1 rank
 * @param {number} args.topN      where the actionable list ends
 * @param {string} args.packId    seeds the blind ordering
 */
export function stratifiedSample({ ranked, limited, v1Ranks, topN = 100, packId = '' }) {
  const top = ranked.slice(0, topN);
  const picks = new Map();
  const add = (row, stratum) => {
    if (!row) return;
    const found = picks.get(row.id);
    if (found) { if (!found.strata.includes(stratum)) found.strata.push(stratum); return; }
    picks.set(row.id, { row, strata: [stratum] });
  };
  const addAll = (rows, stratum) => rows.forEach((r) => add(r, stratum));

  addAll(ranked.slice(0, 10), STRATUM.TOP_10);
  addAll(spread(ranked.slice(19, 30), 3), STRATUM.RANKS_20_30);
  addAll(spread(ranked.slice(44, 55), 3), STRATUM.RANKS_45_55);
  addAll(spread(ranked.slice(89, 100), 3), STRATUM.RANKS_90_100);
  addAll(ranked.slice(topN, topN + 5), STRATUM.JUST_OUTSIDE_TOP);

  const moved = top
    .filter((r) => v1Ranks.has(r.id))
    .map((r) => ({ row: r, delta: v1Ranks.get(r.id) - r.rank }));
  addAll([...moved].sort((a, b) => b.delta - a.delta).slice(0, 5).map((m) => m.row), STRATUM.MAJOR_RISE);
  /**
   * Falls are taken from the WHOLE ranked list, not from the top 100. A
   * programme V1 ranked 12th and V2 ranks 600th is the most contentious row in
   * the pack, and it is not in the top hundred by definition.
   */
  const fell = ranked
    .filter((r) => (v1Ranks.get(r.id) ?? Infinity) <= topN)
    .map((r) => ({ row: r, delta: v1Ranks.get(r.id) - r.rank }))
    .sort((a, b) => a.delta - b.delta);
  addAll(fell.slice(0, 5).map((m) => m.row), STRATUM.MAJOR_FALL);

  /**
   * Limited data, preferring the ones V1 ranked highly. Those are the rows
   * where V2's refusal to assume is most visible and most arguable; a limited
   * programme V1 also ignored tells us nothing.
   */
  const limitedV1Top = limited
    .filter((r) => (v1Ranks.get(r.id) ?? Infinity) <= topN)
    .sort((a, b) => v1Ranks.get(a.id) - v1Ranks.get(b.id));
  const limitedPick = [...limitedV1Top.slice(0, 3)];
  for (const r of limited) {
    if (limitedPick.length >= 5) break;
    if (!limitedPick.some((x) => x.id === r.id)) limitedPick.push(r);
  }
  addAll(limitedPick, STRATUM.LIMITED_DATA);

  const scored = top.filter((r) => typeof r.soccerScore === 'number')
    .sort((a, b) => b.soccerScore - a.soccerScore);
  addAll(scored.slice(0, 3), STRATUM.HIGH_PROGRAMME_STRENGTH);
  addAll(scored.slice(-3).reverse(), STRATUM.LOW_PROGRAMME_STRENGTH);

  addAll(byLoss(top, 'financialGateLoss').slice(0, 3), STRATUM.FINANCIAL_GATE);
  addAll(byLoss(top, 'recruitabilityGateLoss').slice(0, 3), STRATUM.RECRUITABILITY_GATE);

  const rows = [...picks.values()].map(({ row, strata }) => ({
    id: row.id,
    name: row.name,
    division: row.division,
    rankingState: row.rankingState,
    rank: row.rankingState === RANKING_STATE.RANKED ? row.rank : null,
    v1Rank: v1Ranks.get(row.id) ?? null,
    strata,
    entry: row,
  }));

  // Rank order for the model-reveal view, hashed order for the blind one.
  const modelOrder = [...rows].sort((a, b) =>
    (a.rank ?? Infinity) - (b.rank ?? Infinity) || String(a.name).localeCompare(String(b.name)));
  const blindOrder = [...rows].sort((a, b) =>
    blindKey(packId, a.id) - blindKey(packId, b.id) || String(a.name).localeCompare(String(b.name)));

  const counts = {};
  for (const r of rows) for (const s of r.strata) counts[s] = (counts[s] || 0) + 1;

  return { rows: modelOrder, blindOrder, counts, size: rows.length };
}
