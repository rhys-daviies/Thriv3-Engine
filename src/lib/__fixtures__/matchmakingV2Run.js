/**
 * A persisted Matchmaking V2 run, in the shape `readRun()` emits.
 *
 * Every field spelling, every state name and every refusal code here was taken
 * from a run computed against the live corpus on 2026-10-03 for a real
 * men's-soccer athlete — 1,205 programmes, 828 ranked, 89 limited, 288
 * unsupported, bands 25/25/50/728. The fixture is small; it is not invented.
 *
 * `missing` is absent from unscoreable layers ON PURPOSE: the persisted
 * contract does not carry it, and a fixture that did would let a component
 * depend on a field that disappears on the next page load.
 */

const scoreable = (value, grade = 'PARTIAL', coverage = 1) => ({
  state: 'SCOREABLE', value, grade, coverage,
});

const unscoreable = (reason, coverage = 0) => ({ state: 'UNSCOREABLE', reason, coverage });

const ranked = (rank, name, band, pursuit, division = 'NCAA D1') => ({
  programmeId: `pid-ranked-${rank}`,
  name,
  division,
  status: 'RANKED',
  universe: 'SUPPORTED',
  recruitability: scoreable(0.711684, 'PARTIAL'),
  financial: scoreable(0.450759, 'PARTIAL'),
  opportunity: scoreable(0.841678, 'MEASURED'),
  rank,
  band,
  pursuit,
  pursuitGrade: 'PARTIAL',
});

/** The four band boundaries, and the first programme past the Top 100. */
export const RANKED_PROGRAMMES = [
  ranked(1, 'Lindenwood', 'PRIORITY_OUTREACH', 0.665709),
  ranked(25, 'Washington and Lee', 'PRIORITY_OUTREACH', 0.601),
  ranked(26, 'Belmont Abbey', 'STRONG_PURSUIT', 0.6009),
  ranked(50, 'Queens', 'STRONG_PURSUIT', 0.55),
  ranked(51, 'Barton', 'VIABLE_CONSIDERATION', 0.5499),
  ranked(100, 'Catawba', 'VIABLE_CONSIDERATION', 0.4822, 'NCAA D2'),
  ranked(101, 'Millikin', 'BROADER_UNIVERSE', 0.4821, 'NCAA D3'),
  ranked(102, 'Wheaton', 'BROADER_UNIVERSE', 0.481, 'NCAA D3'),
];

/**
 * Thriv3 models this association and lacks the evidence to rank this
 * programme for this athlete. A real NAIA row: no roster on file.
 */
export const LIMITED_DATA_PROGRAMME = {
  programmeId: 'pid-limited-1',
  name: 'Trinity Christian',
  division: 'NAIA',
  status: 'SUPPORTED_LIMITED_DATA',
  universe: 'SUPPORTED',
  recruitability: unscoreable('NO_ROSTER_ON_FILE', 0),
  financial: scoreable(0.461886, 'PARTIAL'),
  opportunity: unscoreable('NO_ROSTER_ON_FILE', 0.628571),
  missingLayers: ['opportunity', 'recruitability'],
};

/** Thriv3 holds no eligibility rule for this association at all. */
export const UNSUPPORTED_PROGRAMME = {
  programmeId: 'pid-unsupported-1',
  name: 'Garden City Community',
  division: 'NJCAA',
  status: 'UNSUPPORTED_ASSOCIATION',
  universe: 'UNSUPPORTED',
  recruitability: unscoreable('NO_ELIGIBILITY_RULE', 0),
  financial: scoreable(0.857584, 'PARTIAL'),
  opportunity: unscoreable('NO_CLASS_LABELS', 0.153846),
  missingLayers: ['opportunity', 'recruitability'],
};

/**
 * A layer refusing with the MAJOR reason.
 *
 * This state does NOT occur in a real persisted run, and the fixture carries
 * it deliberately. `majorFit` is a preference component inside Opportunity and
 * is not required, so `combine()` never propagates its reason to the layer —
 * an unestablished major costs coverage and nothing else, which is why the
 * tally over a real 1,205-programme run shows zero of these.
 *
 * It is here so the wording boundary is tested against the one code that could
 * ever carry the banned inference, rather than only against codes that cannot.
 * If a future layer ever does surface it, the test already holds the line.
 */
export const MAJOR_REFUSAL_PROGRAMME = {
  programmeId: 'pid-major-1',
  name: 'Penn State',
  division: 'NCAA D1',
  status: 'SUPPORTED_LIMITED_DATA',
  universe: 'SUPPORTED',
  recruitability: scoreable(0.6, 'MEASURED'),
  financial: scoreable(0.5, 'PARTIAL'),
  opportunity: unscoreable('MAJOR_NOT_IN_PARTIAL_EVIDENCE', 0.3),
  missingLayers: ['opportunity'],
};

export const PROGRAMMES = [
  ...RANKED_PROGRAMMES,
  LIMITED_DATA_PROGRAMME,
  MAJOR_REFUSAL_PROGRAMME,
  UNSUPPORTED_PROGRAMME,
];

/** A persisted run, current. `staleness` is what the route attaches. */
export function persistedRun(overrides = {}) {
  return {
    runId: 'run-0001',
    matcherVersion: 'v2',
    engineFreeze: '003d144271c9705806e0909f00fd753c778fdeb7',
    corpusDigest: 'adf924962496cfa1fad1eefd97333edc09994c210d8c072e9e14d3d90e2d240c',
    computedAt: '2026-10-03T16:04:00.000Z',
    resultSchemaVersion: 1,
    inputSchemaVersion: 1,
    playerId: 'player-1',
    sport: 'mens-soccer',
    contributionState: 'MAX_ANNUAL',
    inputSnapshot: { sport: 'mens-soccer', intended_major: 'exercise science' },
    counts: {
      poolSize: 1205, supportedUniverse: 917, ranked: 828, limitedData: 89, unsupported: 288,
    },
    programmes: PROGRAMMES,
    staleness: { current: true, reasons: [] },
    ...overrides,
  };
}

/** A player with a stated major and all three priorities answered. */
export const PLAYER = {
  id: 'player-1',
  full_name: 'Test Athlete',
  sport: 'mens-soccer',
  intended_major: 'Exercise Science',
  competitive_level_priority: 4,
  playing_opportunity_priority: 5,
  academic_strength_priority: 2,
};
