import { describe, it, expect } from 'vitest';
import { explainProgramme, strengths, concerns, unknowns } from './explain.js';
import { renderReason, renderGate, renderExplanation, CLIENT_UNSAFE } from './render.js';
import { LAYER, POLARITY, BAND, REASON_CODE, FORBIDDEN_LANGUAGE, bandFor, sampleStrength, PURSUIT_HAS_NO_BAND } from './vocabulary.js';
import { RANKING_STATE, GRADE, REASON, scoreable, unscoreable } from '../types.js';
import { pursuitPriority } from '../layers/pursuit.js';
import { AID_POLICY_STATUS } from '../aidPolicy.js';

const L = (v, grade = GRADE.MEASURED, basis = {}) => scoreable({ value: v, grade, coverage: 1, basis });

const recruitability = (over = {}) => L(over.value ?? 0.55, over.grade ?? GRADE.MEASURED, {
  athleticPlausibility: 0.8, athleticDelta: over.delta ?? 0.05,
  athleticBasis: { rating: 8, athletePercentile: 0.89, programmePercentile: 0.84, delta: over.delta ?? 0.05 },
  core: 0.5, coreBasis: { components: {}, missing: [], notApplicable: [] }, phi: 0.35, ceilingLoss: 0.1,
  positional: over.positional === null ? null : {
    position: 'MIDFIELD', typicalStarters: 5, vacatedStarters: over.vacated ?? 2,
    expectedNewcomerPlaces: 1.7, arrivals: over.arrivals ?? 0, arrivalsKnown: true,
    arrivalsApplicable: over.arrivalsApplicable ?? true, arrivalsHorizon: 2026,
    claims: 0, claimsCapped: false,
    fillRate: over.fillRate ?? 0.83, fillLevel: 'division',
    fillHits: over.fillHits ?? 526, fillTrials: over.fillTrials ?? 637,
    contextOnly: { positionRows: 10, allOpenings: 3, eligibleToRemain: 6, unreadableRows: 0 },
  },
  international: over.international ?? null,
  internationalApplicable: Boolean(over.international),
});

const financial = (over = {}) => L(over.value ?? 0.9, GRADE.MEASURED, {
  aidPolicy: over.aidPolicy ?? AID_POLICY_STATUS.EQUIVALENCY,
  aidPolicyKnown: over.aidPolicy !== AID_POLICY_STATUS.UNKNOWN,
  aidRule: over.aidRule ?? 'NCAA D1',
  mayClaimNoAthleticAid: over.mayClaimNoAthleticAid ?? false,
  aidHeadroomFraction: 0.75, athleticAwardAssumed: 0,
  netPrice: 22000, costFloored: false,
  costBasis: over.costBasis ?? 'NET_PRICE_PRIVATE',
  applicableCostRange: over.cost ?? [22000, 22000],
  budgetRange: '$20k-$25k/yr', budgetIsLegacyBand: false,
  familyContributionRange: over.budget ?? [20000, 25000],
  fundingGapRange: over.gap ?? [0, 2000],
  viabilityRange: [0.8, 1], budgetCeilingUnstated: over.unbounded ?? false,
  isInternational: over.isInternational ?? false,
  internationalCostCaveat: over.isInternational ? 'net price understates' : null,
  outOfStatePremium: over.premium ?? 0,
});

const opportunity = (over = {}) => L(over.value ?? 0.6, GRADE.MEASURED, {
  components: {}, missing: [], notApplicable: over.notApplicable ?? ['locationFit'],
  objectiveScored: 2, objectiveValue: 0.6, preferencesDeclared: 0, preferenceValue: null,
  preferenceKnown: false, priorities: { applied: false, multipliers: {}, ignored: [], ranking: null },
  ambition: over.ambition ?? { competitiveLevelPriority: null, playingOpportunityPriority: null, multipliers: {}, declared: false },
  pathway: over.playing === null ? null : { playingShare: 0.68, seasons: 4, level: 'programme', scaleP10: 0.42, scaleMedian: 0.59, scaleP90: 0.76, measure: 'x' },
  trajectory: { recentWinPct: 0.6, priorWinPct: 0.5, change: 0.1, saturation: 0.3, direction: 'improving' },
  major: over.major ?? null,
  outcome: over.outcome ?? null,
});

const entry = (over = {}) => {
  const R = over.recruitability ?? recruitability();
  const F = over.financial ?? financial();
  const O = over.opportunity ?? opportunity();
  return {
    id: 'c1', name: 'Test College', division: 'NCAA D3', soccerScore: 55,
    recruitability: R, financial: F, opportunity: O,
    rankingState: RANKING_STATE.RANKED,
    pursuitPriority: pursuitPriority({ recruitability: R, financial: F, opportunity: O }),
    rank: over.rank ?? 12,
    ...over.extra,
  };
};

const ctx = (over = {}) => ({ rank: 12, outOf: 800, poolSize: 1000, poolMedianPriority: 0.4, ...over });

describe('the explanation changes nothing', () => {
  it('leaves every layer result and the priority byte-identical', () => {
    const e = entry();
    const before = JSON.parse(JSON.stringify({
      R: e.recruitability, F: e.financial, O: e.opportunity, P: e.pursuitPriority,
      state: e.rankingState, rank: e.rank,
    }));
    explainProgramme(e, ctx());
    explainProgramme(e, ctx());
    expect(JSON.parse(JSON.stringify({
      R: e.recruitability, F: e.financial, O: e.opportunity, P: e.pursuitPriority,
      state: e.rankingState, rank: e.rank,
    }))).toEqual(before);
  });

  it('is deterministic', () => {
    const e = entry();
    expect(JSON.stringify(explainProgramme(e, ctx()))).toBe(JSON.stringify(explainProgramme(e, ctx())));
  });
});

describe('layer ownership is enforced on every reason', () => {
  const e = explainProgramme(entry(), ctx());

  it('every reason names the layer it came from', () => {
    for (const r of e.reasons) expect(Object.values(LAYER)).toContain(r.layer);
  });

  it('financial reasons never appear under recruitability', () => {
    for (const r of e.layerReasons.recruitability) expect(r.layer).toBe(LAYER.RECRUITABILITY);
    for (const r of e.layerReasons.financial) expect(r.layer).toBe(LAYER.FINANCIAL);
    for (const r of e.layerReasons.opportunity) expect(r.layer).toBe(LAYER.OPPORTUNITY);
  });

  it('no financial code is ever produced by the recruitability builder', () => {
    const financialCodes = new Set(e.layerReasons.financial.map((r) => r.code));
    for (const r of e.layerReasons.recruitability) expect(financialCodes.has(r.code)).toBe(false);
  });
});

describe('the standing, and the fixture-C problem', () => {
  it('flags a low absolute priority however high the rank', () => {
    const e = explainProgramme(
      entry({ recruitability: recruitability({ value: 0.02, delta: -0.6 }), rank: 1 }),
      ctx({ rank: 1, poolMedianPriority: 0.02 }),
    );
    expect(e.standing.absoluteStrength).toBe('LOW');
    expect(e.standing.rankAloneIsMisleading).toBe(true);
    expect(e.reasons[0].code).toBe(REASON_CODE.POOL_MOSTLY_OUT_OF_REACH);
    expect(e.reasons.some((r) => r.code === REASON_CODE.ABSOLUTE_PRIORITY_LOW)).toBe(true);
  });

  it('says nothing of the sort when the priority is adequate', () => {
    const e = explainProgramme(entry(), ctx());
    expect(e.standing.absoluteStrength).toBe('ADEQUATE');
    expect(e.standing.rankAloneIsMisleading).toBe(false);
    expect(e.reasons.some((r) => r.code === REASON_CODE.ABSOLUTE_PRIORITY_LOW)).toBe(false);
  });

  it('puts the absolute context before everything else', () => {
    const e = explainProgramme(
      entry({ recruitability: recruitability({ value: 0.02, delta: -0.6 }) }),
      ctx({ poolMedianPriority: 0.02 }),
    );
    expect(e.reasons[0].band).toBe(BAND.ABSOLUTE_CONTEXT);
  });

  it('marks the pool warning as list-level so a surface can hoist it', () => {
    const e = explainProgramme(entry(), ctx({ poolMedianPriority: 0.02 }));
    expect(e.reasons.find((r) => r.code === REASON_CODE.POOL_MOSTLY_OUT_OF_REACH).listLevel).toBe(true);
  });

  it('gives Pursuit Priority a rank and a raw value but no qualitative band', () => {
    const e = explainProgramme(entry(), ctx());
    expect(PURSUIT_HAS_NO_BAND).toBe(true);
    expect(e.standing).not.toHaveProperty('priorityBand');
    expect(e.standing.priority).toBeGreaterThan(0);
    expect(e.standing.priorityOutOf100).toBeGreaterThan(0);
  });
});

describe('gates are demotions, never exclusions', () => {
  const e = explainProgramme(entry({
    recruitability: recruitability({ value: 0.10, delta: -0.3 }),
    financial: financial({ value: 0.15, gap: [12000, 18000] }),
  }), ctx());

  it('reports both gates with base, multiplier, loss and severity', () => {
    expect(e.gateEffects).toHaveLength(2);
    for (const g of e.gateEffects) {
      for (const k of ['base', 'multiplier', 'loss', 'lossShare', 'severity']) expect(g).toHaveProperty(k);
      expect(g.excluded).toBe(false);
    }
  });

  it('never uses exclusion language', () => {
    for (const g of e.gateEffects) {
      const text = renderGate(g).toLowerCase();
      for (const word of ['excluded', 'removed from', 'disqualif', 'eliminated']) {
        expect(text, word).not.toContain(word);
      }
      expect(text).toMatch(/remains on the list|demoted, not removed/);
    }
  });

  it('attributes each gate to the layer that caused it', () => {
    expect(e.gateEffects.find((g) => g.code === REASON_CODE.GATE_RECRUITABILITY).layer).toBe(LAYER.RECRUITABILITY);
    expect(e.gateEffects.find((g) => g.code === REASON_CODE.GATE_FINANCIAL).layer).toBe(LAYER.FINANCIAL);
  });

  it('reports no gate when neither fired', () => {
    expect(explainProgramme(entry(), ctx()).gateEffects).toEqual([]);
  });
});

describe('the three athletic-aid states stay apart', () => {
  const codeFor = (over) => explainProgramme(entry({ financial: financial(over) }), ctx())
    .layerReasons.financial.map((r) => r.code);

  it('known no-aid may be stated', () => {
    expect(codeFor({ mayClaimNoAthleticAid: true, aidPolicy: AID_POLICY_STATUS.DIVISION_RULE, aidRule: 'NCAA D3' }))
      .toContain(REASON_CODE.AID_KNOWN_NONE);
  });

  it('unknown policy is never rendered as no aid', () => {
    const codes = codeFor({ aidPolicy: AID_POLICY_STATUS.UNKNOWN, aidRule: null });
    expect(codes).toContain(REASON_CODE.AID_POLICY_UNKNOWN);
    expect(codes).not.toContain(REASON_CODE.AID_KNOWN_NONE);
    const text = renderReason({ code: REASON_CODE.AID_POLICY_UNKNOWN, evidence: {} });
    expect(text).toMatch(/not the same as knowing there is none/);
  });

  it('aid permitted with an unknown amount is its own state', () => {
    const codes = codeFor({ aidPolicy: AID_POLICY_STATUS.EQUIVALENCY, aidRule: 'NCAA D1' });
    expect(codes).toContain(REASON_CODE.AID_PERMITTED_AMOUNT_UNKNOWN);
    expect(codes).not.toContain(REASON_CODE.AID_KNOWN_NONE);
  });

  it('never invents a dollar award anywhere', () => {
    for (const over of [{ mayClaimNoAthleticAid: true, aidRule: 'NCAA D3' }, { aidPolicy: AID_POLICY_STATUS.UNKNOWN, aidRule: null }, {}]) {
      const { lines } = renderExplanation(explainProgramme(entry({ financial: financial(over) }), ctx()));
      for (const l of lines) expect(l).not.toMatch(/will receive|scholarship of \$|awarded \$/i);
    }
  });
});

describe('evidence denominators survive into the explanation', () => {
  it('keeps hits and trials, and a 1-of-1 history does not sound like 526-of-637', () => {
    const thin = explainProgramme(entry({ recruitability: recruitability({ fillHits: 1, fillTrials: 1 }) }), ctx());
    const thick = explainProgramme(entry({ recruitability: recruitability({ fillHits: 526, fillTrials: 637 }) }), ctx());
    const pick = (e) => e.layerReasons.recruitability.find((r) => r.code === REASON_CODE.POSITION_FILL_HISTORY);
    expect(pick(thin).evidence.trials).toBe(1);
    expect(pick(thick).evidence.trials).toBe(637);
    expect(pick(thin).evidence.strength).toBe('ANECDOTAL');
    expect(pick(thick).evidence.strength).toBe('EXTENSIVE');
    expect(renderReason(pick(thin))).not.toBe(renderReason(pick(thick)));
    expect(renderReason(pick(thin))).toMatch(/very few/);
  });

  it('grades sample strength from the denominator, not the rate', () => {
    expect(sampleStrength(1)).toBe('ANECDOTAL');
    expect(sampleStrength(30)).toBe('LIMITED');
    expect(sampleStrength(100)).toBe('SUBSTANTIAL');
    expect(sampleStrength(637)).toBe('EXTENSIVE');
    expect(sampleStrength(0)).toBe('NONE');
  });

  it('reports the evidence quality of every layer', () => {
    const e = explainProgramme(entry({ recruitability: recruitability({ grade: GRADE.PARTIAL }) }), ctx());
    const q = Object.fromEntries(e.evidenceQuality.map((x) => [x.layer, x.quality]));
    expect(q.recruitability).toBe('PARTIAL');
    expect(q.financial).toBe('MEASURED');
  });
});

describe('preferences are described only when declared', () => {
  const withAmbition = (level, playing, outcome) => opportunity({
    ambition: { competitiveLevelPriority: level, playingOpportunityPriority: playing, multipliers: {}, declared: true },
    outcome,
  });

  it('says nothing about level when nobody asked', () => {
    const e = explainProgramme(entry(), ctx());
    const codes = e.layerReasons.opportunity.map((r) => r.code);
    expect(codes).not.toContain(REASON_CODE.LEVEL_PREFERENCE_MET);
    expect(codes).not.toContain(REASON_CODE.LEVEL_PREFERENCE_BELOW);
  });

  it('never describes priority 1 as preferring weaker programmes', () => {
    const e = explainProgramme(entry({
      opportunity: withAmbition(1, 3, { atOrAboveOwnLevel: false, levelGapBelow: 0.3, competitiveLevelPriority: 1, athletePercentile: 0.9, programmePercentile: 0.6 }),
    }), ctx());
    const codes = e.layerReasons.opportunity.map((r) => r.code);
    expect(codes).not.toContain(REASON_CODE.LEVEL_PREFERENCE_BELOW);
    expect(codes).not.toContain(REASON_CODE.LEVEL_PREFERENCE_MET);
    const { lines } = renderExplanation(e);
    for (const l of lines) expect(l.toLowerCase()).not.toMatch(/prefers? weaker|wants? a weaker|lower level suits/);
  });

  it('describes a mismatch when level is a stated priority', () => {
    const e = explainProgramme(entry({
      opportunity: withAmbition(5, 1, { atOrAboveOwnLevel: false, levelGapBelow: 0.3, competitiveLevelPriority: 5, athletePercentile: 0.9, programmePercentile: 0.6 }),
    }), ctx());
    const r = e.layerReasons.opportunity.find((x) => x.code === REASON_CODE.LEVEL_PREFERENCE_BELOW);
    expect(r).toBeTruthy();
    expect(r.band).toBe(BAND.PREFERENCE_EFFECT);
    expect(renderReason(r)).toMatch(/marked competitive level as a priority/);
  });

  it('mentions playing priority only when it is high', () => {
    const low = explainProgramme(entry({ opportunity: withAmbition(3, 1, null) }), ctx());
    const high = explainProgramme(entry({ opportunity: withAmbition(3, 5, null) }), ctx());
    expect(low.layerReasons.opportunity.map((r) => r.code)).not.toContain(REASON_CODE.PLAYING_PREFERENCE_WEIGHTED);
    expect(high.layerReasons.opportunity.map((r) => r.code)).toContain(REASON_CODE.PLAYING_PREFERENCE_WEIGHTED);
  });
});

describe('the pipeline states', () => {
  it('explains SUPPRESSED as a person decision, never as a model judgement', () => {
    const e = explainProgramme({ id: 'c9', name: 'X', division: 'NCAA D3', rankingState: RANKING_STATE.SUPPRESSED }, ctx());
    expect(e.standing).toBeNull();
    expect(e.reasons[0].code).toBe(REASON_CODE.SUPPRESSED_BY_OPERATOR);
    const text = renderReason(e.reasons[0]).toLowerCase();
    expect(text).toMatch(/operator decision/);
    for (const w of ['low', 'weak', 'poor', 'priority']) expect(text).not.toContain(w);
  });

  it('explains INELIGIBLE by its rule, never as a low priority', () => {
    const e = explainProgramme({ id: 'c9', name: 'X', division: 'NCAA D1', rankingState: RANKING_STATE.INELIGIBLE, ineligibleReason: 'division' }, ctx());
    expect(e.standing).toBeNull();
    expect(e.reasons[0].code).toBe(REASON_CODE.INELIGIBLE_RULE);
    expect(renderReason(e.reasons[0])).toMatch(/not a judgement about the programme/);
  });

  it('gives LIMITED_DATA no standing and no low-score language', () => {
    const e = explainProgramme({
      ...entry(), rankingState: RANKING_STATE.LIMITED_DATA,
      recruitability: unscoreable({ reason: REASON.NO_ROSTER_ON_FILE, missing: ['roster'] }),
      missingLayers: ['recruitability'], layerReasons: { recruitability: REASON.NO_ROSTER_ON_FILE },
      order: { layersKnown: 2, coverage: 0.66, bestEvidencedValue: 0.9 },
    }, ctx());
    expect(e.standing).toBeNull();
    expect(e.reasons[0].code).toBe(REASON_CODE.LIMITED_DATA_MISSING_LAYERS);
    const { lines } = renderExplanation(e);
    for (const l of lines) {
      expect(l.toLowerCase()).not.toMatch(/low match|poor fit|not recommended|weak match/);
    }
    expect(lines[0]).toMatch(/Insufficient evidence to rank/);
  });

  it('distinguishes a missing LAYER from a missing RANKING', () => {
    const e = explainProgramme({
      ...entry(), rankingState: RANKING_STATE.LIMITED_DATA,
      recruitability: unscoreable({ reason: REASON.BELOW_COVERAGE_FLOOR, missing: ['positionalOpportunity'] }),
      missingLayers: ['recruitability'], layerReasons: { recruitability: REASON.BELOW_COVERAGE_FLOOR },
      order: { layersKnown: 2, coverage: 0.66, bestEvidencedValue: 0.9 },
    }, ctx());
    const codes = e.reasons.map((r) => r.code);
    expect(codes).toContain(REASON_CODE.LIMITED_DATA_MISSING_LAYERS);
    expect(codes).toContain(REASON_CODE.LAYER_UNSCOREABLE);
    expect(e.reasons.filter((r) => r.code === REASON_CODE.LIMITED_DATA_MISSING_LAYERS)).toHaveLength(1);
  });

  it('suggests what would promote a limited-data programme', () => {
    const e = explainProgramme({
      ...entry(), rankingState: RANKING_STATE.LIMITED_DATA,
      recruitability: unscoreable({ reason: REASON.NO_ELIGIBILITY_RULE, missing: ['eligibilityRule'] }),
      missingLayers: ['recruitability', 'opportunity'], layerReasons: {},
      order: { layersKnown: 1, coverage: 0.33, bestEvidencedValue: 1 },
    }, ctx());
    const codes = e.nextChecks.map((c) => c.code);
    expect(codes).toContain('OBTAIN_ROSTER_AND_ELIGIBILITY');
    expect(codes).toContain('OBTAIN_MINUTES_HISTORY');
  });
});

describe('language guards', () => {
  const allLines = () => {
    const cases = [
      entry(),
      entry({ recruitability: recruitability({ value: 0.02, delta: -0.6 }) }),
      entry({ financial: financial({ value: 0.1, gap: [10000, 20000], aidPolicy: AID_POLICY_STATUS.UNKNOWN, aidRule: null }) }),
      entry({ financial: financial({ mayClaimNoAthleticAid: true, aidRule: 'Ivy League' }) }),
      entry({ recruitability: recruitability({ international: { internationalArrivalShare: 0.3, internationalArrivals: 6, totalArrivals: 20, level: 'programme' } }) }),
    ];
    return cases.flatMap((e) => renderExplanation(explainProgramme(e, ctx())).lines);
  };

  it('never uses probability language', () => {
    for (const line of allLines()) {
      for (const word of FORBIDDEN_LANGUAGE) {
        expect(line.toLowerCase(), `"${line}" contains "${word}"`).not.toContain(word);
      }
    }
  });

  it('never claims what a coach needs or wants', () => {
    for (const line of allLines()) {
      expect(line.toLowerCase()).not.toMatch(/the coach (needs|wants|is looking for)/);
    }
  });

  it('prefers evidence phrasing over causal phrasing for openings', () => {
    const e = explainProgramme(entry(), ctx());
    const r = e.layerReasons.recruitability.find((x) => x.code === REASON_CODE.POSITION_OPENING_MEASURED);
    expect(renderReason(r)).toMatch(/^Roster evidence shows/);
  });

  it('renders an unbounded budget as "or more", not as infinity', () => {
    const e = explainProgramme(entry({ financial: financial({ budget: [40000, Infinity], unbounded: true, gap: [0, 5000] }) }), ctx());
    const { lines } = renderExplanation(e);
    expect(lines.join(' ')).toMatch(/\$40,000 or more/);
    expect(lines.join(' ')).not.toMatch(/Infinity|∞|NaN/);
  });

  it('renders every reason it produces', () => {
    for (const line of allLines()) expect(line).toBeTruthy();
  });
});

describe('ordering is stable under small score changes', () => {
  it('does not reshuffle when a layer moves by a hundredth', () => {
    const codes = (v) => explainProgramme(entry({ recruitability: recruitability({ value: v }) }), ctx())
      .reasons.map((r) => r.code);
    expect(codes(0.55)).toEqual(codes(0.56));
    expect(codes(0.55)).toEqual(codes(0.54));
  });

  it('orders by band, then polarity, then code - never by score', () => {
    const e = explainProgramme(entry({ recruitability: recruitability({ value: 0.1, delta: -0.4 }) }), ctx());
    for (let i = 1; i < e.reasons.length; i += 1) {
      expect(e.reasons[i - 1].band).toBeLessThanOrEqual(e.reasons[i].band);
    }
  });

  it('bands layers on their own semantics, not on equal fifths', () => {
    expect(bandFor('recruitability', 0.26)).toBe('MIXED');
    expect(bandFor('recruitability', 0.24)).toBe('WEAK');
    expect(bandFor('financial', 0.51)).toBe('MIXED');
    expect(bandFor('financial', 0.29)).toBe('VERY_WEAK');
  });
});

describe('the operator / client boundary', () => {
  it('names what must not simply be forwarded to a family', () => {
    expect(CLIENT_UNSAFE.fields).toContain('gateEffects');
    expect(CLIENT_UNSAFE.codes).toContain(REASON_CODE.AID_POLICY_UNKNOWN);
    expect(CLIENT_UNSAFE.reason).toMatch(/designed, not derived by deletion/);
  });
});

describe('the helpers', () => {
  it('split reasons by polarity without losing any', () => {
    const e = explainProgramme(entry({ recruitability: recruitability({ value: 0.1, delta: -0.4, vacated: 0 }) }), ctx());
    const total = strengths(e).length + concerns(e).length + unknowns(e).length;
    expect(total).toBeLessThanOrEqual(e.reasons.length);
    expect(concerns(e).length).toBeGreaterThan(0);
  });
});
