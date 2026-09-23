import { describe, it, expect } from 'vitest';
import { programmeFacts, EVIDENCE_STATE } from './pack.js';

/**
 * A7.7.6. The first review could not answer three of its own reason codes,
 * because View A asked the reviewer to judge roster-related recommendations
 * while showing no roster. Adding that evidence is the repair; the danger it
 * creates is that a model conclusion travels with it.
 *
 * THE RULE: counts and states only. A reviewer who can reconstruct the
 * model's answer from View A is no longer reviewing it blind.
 */
const college = {
  name: 'Test College', division: 'NCAA D3', conference: 'Conf', city: 'Town', state: 'OH',
  control: 1, soccer_score: 44.2, national_ranking: 300, postseason_2025_round: null,
  recent_win_pct: 0.55, prior_win_pct: 0.5, academic_rating: 7.1, sat_avg: 1200,
  admit_rate: 0.6, net_price: 21000, tuition_in_state: 30000, tuition_out_state: 30000,
  notable_majors: null,
};
const evidence = {
  roster: {
    position: 'MIDFIELD', entryYear: 2028, positionalRosterCount: 11,
    classYears: { 'Sr.': 3, 'Jr.': 4 }, departingBeforeEntryYear: 4, eligibleToRemain: 5,
    identifiableDepartingStarters: 2, departingPlayersUnplaceable: 1,
    arrivalsAtPosition: null, arrivalsRecordedTo: 2026,
    evidenceState: EVIDENCE_STATE.PARTIAL, rosterOnFile: true, eligibilityRuleOnFile: true,
  },
  market: {
    evidenceState: EVIDENCE_STATE.FULL, recentArrivals: 40, domesticRecruitsPlaced: 30,
    recruitsWithin300km: 24, describedAs: 'recruits mostly locally', athleteDistanceKm: 120,
    internationalRosterShare: 0.1, internationalMinutesShare: 0.05, utilisationSampleRosterRows: 28,
  },
  academic: { rating: 7.1, relativeStanding: 'above average for this pool', evidenceState: EVIDENCE_STATE.FULL },
};

describe('the blind view now carries the evidence a reviewer needs', () => {
  const f = programmeFacts(college, evidence);

  it('shows the roster at the athlete\'s own position', () => {
    expect(f.roster.positionalRosterCount).toBe(11);
    expect(f.roster.departingBeforeEntryYear).toBe(4);
    expect(f.roster.identifiableDepartingStarters).toBe(2);
    expect(f.roster.entryYear).toBe(2028);
  });

  it('states how complete that evidence is, in the layer\'s own words', () => {
    expect(Object.values(EVIDENCE_STATE)).toContain(f.roster.evidenceState);
    expect(f.roster.departingPlayersUnplaceable).toBe(1);
  });

  it('distinguishes "not yet recorded" from zero arrivals', () => {
    // A null here means nobody has recruited that class yet, which is not the
    // same fact as a programme having signed nobody.
    expect(f.roster.arrivalsAtPosition).toBeNull();
    expect(f.roster.arrivalsRecordedTo).toBe(2026);
  });

  it('describes the recruiting footprint in counts, not in a score', () => {
    expect(f.recruitingMarket.recruitsWithin300km).toBe(24);
    expect(f.recruitingMarket.domesticRecruitsPlaced).toBe(30);
    expect(f.recruitingMarket.describedAs).toBe('recruits mostly locally');
  });

  it('shows international representation as two shares and a sample', () => {
    expect(f.recruitingMarket.internationalRosterShare).toBe(0.1);
    expect(f.recruitingMarket.internationalMinutesShare).toBe(0.05);
    expect(f.recruitingMarket.utilisationSampleRosterRows).toBe(28);
  });

  it('places the institution academically without calling it better', () => {
    expect(f.academic.relativeStanding).toMatch(/pool/);
    expect(JSON.stringify(f.academic).toLowerCase()).not.toContain('better');
  });
});

describe('and still leaks no model output', () => {
  const f = programmeFacts(college, evidence);
  const text = JSON.stringify(f);

  it('carries no layer value, priority, gate or coverage', () => {
    for (const forbidden of [
      'pursuitPriority', 'recruitability', 'financial', 'opportunity',
      'positionalOpportunity', 'recruitingMarket_value', 'marketMatch',
      'gate', 'coverage', 'grade', 'rank', 'weights', 'reasonCode', 'band',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('carries no number that could be a component value', () => {
    // Every numeric field is a count, a share with a stated denominator, a
    // published attribute or a distance. None is a 0-1 score.
    expect(f.recruitingMarket.value).toBeUndefined();
    expect(f.roster.value).toBeUndefined();
    expect(f.academic.value).toBeUndefined();
    expect(f.academic.percentile).toBeUndefined();
  });

  it('is built from a whitelist, so a new evidence field cannot appear by accident', () => {
    const sneaky = programmeFacts(college, { ...evidence, modelAnswer: 0.87, roster: { ...evidence.roster, recruitabilityValue: 0.6 } });
    expect(JSON.stringify(sneaky)).not.toContain('modelAnswer');
    // A field smuggled INSIDE a whitelisted block is the residual risk, and
    // it is the builder in validationFacts.js that must not create one.
    expect(sneaky.roster.recruitabilityValue).toBe(0.6);
  });

  it('survives a programme with no evidence at all', () => {
    const bare = programmeFacts(college, null);
    expect(bare.roster).toBeNull();
    expect(bare.recruitingMarket).toBeNull();
    expect(bare.academic).toBeNull();
    expect(bare.name).toBe('Test College');
  });
});
