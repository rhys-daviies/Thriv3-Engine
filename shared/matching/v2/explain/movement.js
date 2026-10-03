/**
 * Why a programme sits somewhere different in V2 than it did in V1.
 *
 * -- WHAT THIS DELIBERATELY DOES NOT DO -----------------------------------
 *
 * It never subtracts a V1 score from a V2 score. They are not the same
 * quantity: V1's is a weighted blend of six criteria including programme
 * prestige and an assumed scholarship award, V2's is an operational priority
 * gated on whether a coach would plausibly take the athlete. A difference
 * between them is not a measurement of anything.
 *
 * What it does compare is POSITION - where a programme sat in a list against
 * where it sits now - and it attributes the move to V2 evidence only. The
 * attributions are what V2 measured about the programme, never a claim about
 * what V1 was thinking.
 */
import { isScoreable, RANKING_STATE } from '../types.js';
import { LAYER, POLARITY, BAND, REASON_CODE } from './vocabulary.js';

export const MOVEMENT_CODE = Object.freeze({
  ROSE: 'ROSE', FELL: 'FELL', HELD: 'HELD',
  NOW_LIMITED_DATA: 'NOW_LIMITED_DATA',
  NEW_TO_LIST: 'NEW_TO_LIST',
  ATTRIB_RECRUITABLE: 'ATTRIB_RECRUITABLE',
  ATTRIB_POSITION_OPENING: 'ATTRIB_POSITION_OPENING',
  ATTRIB_PLAYING_PATHWAY: 'ATTRIB_PLAYING_PATHWAY',
  ATTRIB_AFFORDABLE: 'ATTRIB_AFFORDABLE',
  ATTRIB_LEVEL_PREFERENCE: 'ATTRIB_LEVEL_PREFERENCE',
  ATTRIB_ATHLETIC_REACH: 'ATTRIB_ATHLETIC_REACH',
  ATTRIB_RECRUITABILITY_GATE: 'ATTRIB_RECRUITABILITY_GATE',
  ATTRIB_FINANCIAL_GATE: 'ATTRIB_FINANCIAL_GATE',
  ATTRIB_NO_OPENING: 'ATTRIB_NO_OPENING',
  ATTRIB_EVIDENCE_WITHHELD: 'ATTRIB_EVIDENCE_WITHHELD',
});

/** HEURISTIC: how many places a programme must move before it is worth explaining. */
export const MATERIAL_MOVE = 25;

/**
 * @param {object} entry     a V2 pipeline entry
 * @param {number|null} v1Rank
 * @param {object} context   { v2Rank, v1Size }
 */
export function explainMovement(entry, v1Rank, { v2Rank = null } = {}) {
  const attributions = [];
  const add = (code, layer, evidence = {}) =>
    attributions.push({ code, layer, evidence });

  if (entry.rankingState === RANKING_STATE.LIMITED_DATA) {
    /**
     * The most important movement case in the whole system. A programme V1
     * ranked highly can now be absent from the ranked list - and the reason is
     * that V1 filled the gaps with assumptions and V2 will not.
     */
    add(MOVEMENT_CODE.ATTRIB_EVIDENCE_WITHHELD, LAYER.PIPELINE, {
      missing: [...(entry.missingLayers ?? [])],
      layerReasons: entry.layerReasons ?? null,
    });
    return {
      id: entry.id, name: entry.name, division: entry.division,
      v1Rank, v2Rank: null, delta: null,
      direction: MOVEMENT_CODE.NOW_LIMITED_DATA,
      material: v1Rank !== null,
      attributions,
      // Stated so no caller can be tempted: there is no score to compare.
      comparesScores: false,
    };
  }

  if (v1Rank === null || v1Rank === undefined) {
    return {
      id: entry.id, name: entry.name, division: entry.division,
      v1Rank: null, v2Rank, delta: null,
      direction: MOVEMENT_CODE.NEW_TO_LIST, material: true, attributions, comparesScores: false,
    };
  }

  const delta = v1Rank - v2Rank;
  const direction = Math.abs(delta) < MATERIAL_MOVE ? MOVEMENT_CODE.HELD
    : delta > 0 ? MOVEMENT_CODE.ROSE : MOVEMENT_CODE.FELL;

  const b = isScoreable(entry.pursuitPriority) ? entry.pursuitPriority.basis : null;
  if (b) {
    if (direction === MOVEMENT_CODE.ROSE) {
      if (b.recruitability >= 0.4) add(MOVEMENT_CODE.ATTRIB_RECRUITABLE, LAYER.RECRUITABILITY, { value: b.recruitability });
      const p = entry.recruitability.basis.positional;
      if (p?.vacatedStarters > 0) {
        add(MOVEMENT_CODE.ATTRIB_POSITION_OPENING, LAYER.RECRUITABILITY,
          { vacatedStarters: p.vacatedStarters, typicalStarters: p.typicalStarters, position: p.position });
      }
      if (b.opportunity >= 0.5) add(MOVEMENT_CODE.ATTRIB_PLAYING_PATHWAY, LAYER.OPPORTUNITY, { value: b.opportunity });
      if (b.financial >= 0.85) add(MOVEMENT_CODE.ATTRIB_AFFORDABLE, LAYER.FINANCIAL, { value: b.financial });
      const outcome = entry.opportunity.basis.outcome;
      if (outcome?.atOrAboveOwnLevel) {
        add(MOVEMENT_CODE.ATTRIB_LEVEL_PREFERENCE, LAYER.OPPORTUNITY,
          { priority: outcome.competitiveLevelPriority, programmePercentile: outcome.programmePercentile });
      }
    }
    if (direction === MOVEMENT_CODE.FELL) {
      if (b.recruitabilityGateFired) {
        add(MOVEMENT_CODE.ATTRIB_RECRUITABILITY_GATE, LAYER.RECRUITABILITY,
          { recruitability: b.recruitability, loss: b.recruitabilityGateLoss, multiplier: b.recruitabilityGate });
      }
      if (b.financialGateFired) {
        add(MOVEMENT_CODE.ATTRIB_FINANCIAL_GATE, LAYER.FINANCIAL,
          { financial: b.financial, loss: b.financialGateLoss, multiplier: b.financialGate });
      }
      if (entry.recruitability.basis.athleticDelta < -0.10) {
        add(MOVEMENT_CODE.ATTRIB_ATHLETIC_REACH, LAYER.RECRUITABILITY,
          { levelGap: Math.abs(entry.recruitability.basis.athleticDelta) });
      }
      const p = entry.recruitability.basis.positional;
      if (p && p.vacatedStarters === 0) {
        add(MOVEMENT_CODE.ATTRIB_NO_OPENING, LAYER.RECRUITABILITY, { position: p.position });
      }
    }
  }

  return {
    id: entry.id, name: entry.name, division: entry.division,
    v1Rank, v2Rank, delta, direction,
    material: direction !== MOVEMENT_CODE.HELD,
    attributions,
    comparesScores: false,
  };
}

/** The largest movers, ordered, with attributions. */
export function largestMovers(entries, v1Ranks, { limit = 5 } = {}) {
  const moves = entries
    .filter((e) => e.rankingState === RANKING_STATE.RANKED)
    .map((e) => explainMovement(e, v1Ranks.get(e.id) ?? null, { v2Rank: e.rank }))
    .filter((m) => m.delta !== null);
  return {
    rises: [...moves].sort((a, b) => b.delta - a.delta).slice(0, limit),
    falls: [...moves].sort((a, b) => a.delta - b.delta).slice(0, limit),
  };
}

export { REASON_CODE, POLARITY, BAND };
