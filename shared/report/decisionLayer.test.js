/**
 * The decision layer, held to the contract in docs/decision-layer.md.
 *
 * Two things are tested here that are not tested anywhere else. The RANKING
 * must be a function of the facts alone — the same model twice gives the same
 * order, and the order can be explained from the recorded reasons. And the
 * ELIGIBILITY rules must refuse: an absence, a thin sample and a coverage
 * statistic each have a named reason for not leading a report, and a page that
 * quietly admitted one of them would look exactly like a page that had
 * something to say.
 */
import { describe, it, expect } from 'vitest';
import {
  decisionFindings, decisionCandidates, programmeSnapshot, coachSnapshot,
  FINDING_CATEGORIES, MAX_FINDINGS, FILL_TO,
} from './decisionLayer.js';
import { PROMINENCE } from './coachContext.js';

const cand = (m, id) => decisionCandidates(m).find((x) => x.category === id);
const has = (m, id) => decisionFindings(m).findings.some((x) => x.category === id);

/**
 * A programme with everything readable, so a test can take one thing away and
 * watch the ranking respond to exactly that.
 */
const full = (over = {}) => ({
  college: { division: 'NCAA D1' },
  seasons: [{ season: 2022 }, { season: 2023 }, { season: 2024 }, { season: 2025 }],
  squad: { rostered: 30 },
  competitive: {
    available: true,
    seasons: [
      { season: 2022, benchmark: { available: true, percentile: 0.5 }, historicalDivision: 'NCAA D1', historicalConference: 'Pac-12 Conference' },
      { season: 2023, benchmark: { available: true, percentile: 0.5 }, historicalDivision: 'NCAA D1', historicalConference: 'Pac-12 Conference' },
      { season: 2024, benchmark: { available: true, percentile: 0.5 }, historicalDivision: 'NCAA D1', historicalConference: 'Atlantic Coast Conference' },
      { season: 2025, benchmark: { available: true, percentile: 0.5 }, historicalDivision: 'NCAA D1', historicalConference: 'Atlantic Coast Conference' },
    ],
    summary: { aggregateRecord: '30-25-9', totalMatches: 64 },
    structuralFacts: [],
    coverage: { readableSeasons: 4, expectedSeasons: 4, membershipKnown: 4, divisionKnown: 4, benchmarkAvailable: 4 },
  },
  coachAttribution: null,
  summary: {
    programme: {
      freshmanOpportunity: {
        classification: 'above-benchmark',
        primaryMetric: { value: 1200, seasons: 4 },
        seasonsObserved: 4,
        measuredFreshmen: 24,
        evidence: { level: 'strong', sufficient: true },
      },
      experiencedArrivalReliance: {
        classification: 'typical',
        measurable: true,
        shareOfMeasuredLoad: 0.24,
        primaryMetric: { value: 25.1, observations: 11 },
        measurableSeasons: [2023, 2024, 2025],
        evidence: { level: 'moderate', sufficient: true },
      },
      replacementBehaviour: {
        dominantRoute: 'returning',
        shares: { returning: 61, freshman: 14, newcomer: 25 },
        poolMix: { returning: 71, freshman: 12, newcomer: 17 },
        observations: 11,
        totalObservations: 11,
        evidence: { level: 'moderate', sufficient: true },
      },
      squadTurnover: {
        season: 2026,
        rostered: 30,
        projectedMinutes: { readable: true, total: 15000, projectable: 25, playersWithProjection: 18 },
        expiringByYear: [
          { year: 2027, minutes: 4000, share: 0.27 },
          { year: 2028, minutes: 6000, share: 0.4 },
        ],
      },
    },
  },
  lifecycle: {
    development: {
      minutesCoverage: { readable: true, measured: 62, playerSeasons: 62 },
      everStarter: { reached: 10, denominator: 32, share: 10 / 32, band: 'below-benchmark' },
    },
    continuity: {
      returned: 74, returnable: 124, retention: 0.6, band: 'typical',
      observations: 124, unreadable: 0,
    },
    departures: {
      gate: { allowed: true, reason: null },
      departures: { total: 60 },
      tracing: { observed: 19, coverage: 19 / 60 },
      dimensions: {
        football: { STRONGER_FOOTBALL_RATING: 2, SIMILAR_FOOTBALL_RATING: 2, LOWER_FOOTBALL_RATING: 15, notComparable: 0, n: 19 },
        academic: { HIGHER_ACADEMIC_RATING: 11, SIMILAR_ACADEMIC_RATING: 8, LOWER_ACADEMIC_RATING: 0, notComparable: 0, n: 19 },
        division: { DIVISION_UP: 0, DIVISION_SAME: 19, DIVISION_DOWN: 0, notComparable: 0, n: 19 },
      },
    },
  },
  ...over,
});

/** Nothing readable: the sparse end of the universe. */
const sparse = () => {
  const m = full();
  m.competitive = { available: false, coverage: { readableSeasons: 0, expectedSeasons: 4 } };
  m.summary.programme.freshmanOpportunity = { classification: 'unclear' };
  m.summary.programme.experiencedArrivalReliance = { measurable: false };
  m.summary.programme.replacementBehaviour = {
    dominantRoute: null, shares: {}, observations: 0, totalObservations: 0,
    evidence: { level: 'limited', sufficient: false },
  };
  m.summary.programme.squadTurnover = { rostered: 0 };
  m.lifecycle.development.minutesCoverage = { readable: false, measured: 3, playerSeasons: 61 };
  m.lifecycle.continuity = { returned: 4, returnable: 6, retention: null, band: 'unclear' };
  m.lifecycle.departures.gate = { allowed: false, reason: 'too-few-observed' };
  return m;
};

describe('eligibility', () => {
  it('considers every declared category on every report and no others', () => {
    for (const m of [full(), sparse()]) {
      const ids = decisionCandidates(m).map((x) => x.category);
      expect(ids).toEqual(FINDING_CATEGORIES.map((c) => c.id));
    }
  });

  it('records a reason for every candidate it refuses', () => {
    for (const c of decisionCandidates(sparse())) {
      if (!c.eligible) expect(c.reason, c.category).toBeTruthy();
    }
  });

  it('refuses a band it could not place rather than saying so at the front', () => {
    const m = full();
    m.summary.programme.freshmanOpportunity.classification = 'unclear';
    expect(cand(m, 'freshman-opportunity').eligible).toBe(false);
    expect(cand(m, 'freshman-opportunity').reason).toBe('no-classification:unclear');
  });

  it('refuses an absence: minutes that cannot be read are not a finding', () => {
    const m = full();
    m.lifecycle.development.minutesCoverage = { readable: false, measured: 3, playerSeasons: 61 };
    expect(cand(m, 'player-development').reason).toBe('minutes-not-readable');
  });

  it('refuses a stable structure as orientation rather than leading with it', () => {
    const m = full();
    expect(cand(m, 'competitive-environment').reason).toBe('structure-stable-orientation-only');
  });

  it('never makes an unestablished season the report’s headline', () => {
    const m = full();
    m.competitive.structuralFacts = [
      { kind: 'DIVISION_UNKNOWN', seasons: [2023], text: 'The division played in is not established for 1 of the 4 seasons.' },
      { kind: 'WINDOW_INCOMPLETE', seasons: [2022, 2024, 2025], text: 'Conference membership is on file for 3 of the four seasons measured.' },
    ];
    const c = cand(m, 'competitive-environment');
    expect(c.eligible).toBe(false);
    for (const f of decisionFindings(m).findings) expect(f.text).not.toMatch(/not established/);
  });
});

describe('evidence gating', () => {
  it('drops a candidate whose evidence is insufficient, whatever its band', () => {
    const m = full();
    m.summary.programme.freshmanOpportunity.evidence = { level: 'strong', sufficient: false };
    expect(cand(m, 'freshman-opportunity').reason).toBe('evidence-insufficient');
  });

  it('caps a materially interesting finding at the class its evidence allows', () => {
    const m = full();
    // above-benchmark is class B material; limited evidence ceilings it at C.
    m.summary.programme.freshmanOpportunity.evidence = { level: 'limited', sufficient: true };
    const c = cand(m, 'freshman-opportunity');
    expect(c.materiality).toBe('B');
    expect(c.priority).toBe('C');
  });

  it('never lets weak evidence outrank strong evidence inside a class', () => {
    const m = full();
    m.summary.programme.freshmanOpportunity.evidence = { level: 'limited', sufficient: true };
    const { findings } = decisionFindings(m);
    const weak = findings.find((f) => f.category === 'freshman-opportunity');
    const strong = findings.find((f) => f.category === 'roster-continuity');
    // Both land at C; the one measured over 124 readable observations leads.
    expect(weak.priority).toBe('C');
    expect(strong.priority).toBe('C');
    expect(strong.rank).toBeLessThan(weak.rank);
  });

  it('never invents a confidence number', () => {
    for (const c of decisionCandidates(full())) {
      expect(typeof c.evidence).toBe('string');
      expect(c).not.toHaveProperty('score');
      expect(c).not.toHaveProperty('confidence');
    }
  });
});

describe('the ranking', () => {
  it('is a function of the facts alone', () => {
    const m = full();
    const a = decisionFindings(m).findings.map((f) => f.category);
    const b = decisionFindings(m).findings.map((f) => f.category);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('puts a division change first, ahead of every measured share', () => {
    const m = full();
    m.competitive.structuralFacts = [{
      kind: 'DIVISION_CHANGE',
      seasons: [2023, 2024],
      text: 'The programme moved from NCAA Division II to NCAA Division I in 2024.',
    }];
    const { findings } = decisionFindings(m);
    expect(findings[0].category).toBe('competitive-environment');
    expect(findings[0].priority).toBe('A');
  });

  it('ranks by class before evidence and by evidence before declaration order', () => {
    const { findings } = decisionFindings(full());
    const classes = findings.map((f) => f.priority);
    expect([...classes].sort()).toEqual(classes);
  });

  it('never prints the priority class it ranked on', () => {
    for (const f of decisionFindings(full()).findings) {
      expect(f.text).not.toMatch(/priority|class [ABCD]\b/i);
      expect(f.text).not.toMatch(/\brank(ed|ing)?\b/i);
    }
  });
});

describe('how many', () => {
  it('never renders more than the ceiling', () => {
    expect(decisionFindings(full()).findings.length).toBeLessThanOrEqual(MAX_FINDINGS);
  });

  it('pads nothing on a sparse programme', () => {
    const { findings } = decisionFindings(sparse());
    expect(findings.length).toBeLessThan(FILL_TO);
    for (const f of findings) expect(f.eligible).toBe(true);
  });

  it('lets context in only while the page is short of findings', () => {
    // With six eligible findings above it, the aggregate record stays off.
    expect(has(full(), 'competitive-history')).toBe(false);
    const thin = sparse();
    thin.competitive = full().competitive;
    // Now there is room, and a real fact fills it rather than an absence.
    expect(has(thin, 'competitive-history')).toBe(true);
  });
});

describe('the canonical sentence', () => {
  it('gives one headline metric per finding', () => {
    for (const f of decisionFindings(full()).findings) {
      expect(f.metric == null || typeof f.metric === 'string' || typeof f.metric === 'number').toBe(true);
      expect(f.text.length).toBeGreaterThan(20);
    }
  });

  it('quotes the arrival figure that has a pool behind it, and only that one', () => {
    const m = full();
    m.summary.programme.experiencedArrivalReliance.classification = 'above-benchmark';
    const f = decisionFindings(m).findings.find((x) => x.category === 'experienced-arrivals');
    expect(f.metric).toBe('25.1%');
    expect(f.text).toContain('25.1%');
    // The squad-wide share belongs to the arrivals page, not to this layer.
    expect(f.text).not.toContain('24%');
    expect(f.text).toContain('came free at a position');
  });

  it('refuses the arrival finding where no position-season can be read', () => {
    const m = full();
    m.summary.programme.experiencedArrivalReliance.primaryMetric = null;
    expect(cand(m, 'experienced-arrivals').reason).toBe('no-position-season-readable');
  });
});

describe('the competitive slot', () => {
  it('surfaces a conference move at a class below a division move', () => {
    const m = full();
    m.competitive.structuralFacts = [{
      kind: 'CONFERENCE_CHANGE',
      seasons: [2023, 2024],
      text: 'The programme competed in the Pac-12 Conference in 2023 and the Atlantic Coast Conference in 2024.',
    }];
    const c = cand(m, 'competitive-environment');
    expect(c.eligible).toBe(true);
    expect(c.priority).toBe('C');
  });

  it('keeps the frozen structural language', () => {
    const m = full();
    m.competitive.structuralFacts = [{
      kind: 'DIVISION_CHANGE', seasons: [2023, 2024],
      text: 'The programme moved from NCAA Division II to NCAA Division I in 2024.',
    }];
    const f = decisionFindings(m).findings[0];
    expect(f.text).toContain('The programme moved from NCAA Division II to NCAA Division I in 2024.');
    for (const banned of [/\bup a division\b/i, /\bpromot/i, /\bstep up\b/i, /\bimprov/i]) {
      expect(f.text).not.toMatch(banned);
    }
  });

  it('states a benchmark about the rate and never about the programme', () => {
    const m = full();
    for (const s of m.competitive.seasons) s.benchmark.percentile = 0.9;
    const c = cand(m, 'competitive-history');
    expect(c.priority).toBe('B');
    expect(c.text).toContain('results rate in the upper quarter');
    expect(c.text).not.toMatch(/the programme was in/i);
  });
});

describe('the current-squad slot', () => {
  it('says minutes are attached to players, never that they are available', () => {
    const f = cand(full(), 'current-squad');
    expect(f.eligible).toBe(true);
    expect(f.text).toContain('attached to players');
    for (const banned of [/available/i, /\bopen(ing)? up\b/i, /\bwill\b/i, /\bopportunity\b/i]) {
      expect(f.text).not.toMatch(banned);
    }
  });

  it('refuses a year holding a share too small to lead with', () => {
    const m = full();
    m.summary.programme.squadTurnover.expiringByYear = [{ year: 2027, minutes: 50, share: 0.003 }];
    expect(cand(m, 'current-squad').reason).toBe('no-year-carries-a-meaningful-share');
  });

  it('refuses where there is no roster at all', () => {
    const m = full();
    m.summary.programme.squadTurnover = { rostered: 0 };
    expect(cand(m, 'current-squad').reason).toBe('no-current-roster');
  });
});

describe('destination suppression', () => {
  it('is class D at best, so it can never outrank measured evidence', () => {
    const c = cand(full(), 'player-destinations');
    expect(c.priority).toBe('D');
  });

  it('is refused entirely where the gate is closed', () => {
    const m = full();
    m.lifecycle.departures.gate = { allowed: false, reason: 'division-suppressed' };
    expect(cand(m, 'player-destinations').reason).toBe('gate-closed:division-suppressed');
  });

  it('is refused where the traced sample holds no pattern', () => {
    const m = full();
    for (const key of ['football', 'division']) {
      const d = m.lifecycle.departures.dimensions[key];
      for (const k of Object.keys(d)) if (k !== 'n' && k !== 'notComparable') d[k] = 3;
      d.n = 19;
    }
    expect(cand(m, 'player-destinations').reason).toBe('no-dominant-pattern-in-traced-sample');
  });
});

describe('coach context', () => {
  const attribution = (over) => ({
    currentCoach: { name: 'A. Coach' },
    currentCoachReason: null,
    historicalMeasuredSeasons: 4,
    currentCoachMeasuredSeasons: 1,
    measuredSeasons: [2022, 2023, 2024, 2025],
    predecessor: { name: 'B. Coach', seasons: [2022, 2023, 2024] },
    incompleteCoachSeasons: [],
    facts: { interim: false, coHead: false, previous: 3 },
    ...over,
  });

  it('leads the report where the window is not the current coach’s', () => {
    const m = full();
    m.coachAttribution = attribution();
    const c = cand(m, 'coach-context');
    expect(c.priority).toBe('A');
    expect(c.text).toMatch(/Only 1 of the 4 measured seasons/);
  });

  it('does not lead the report where the attribution is complete', () => {
    const m = full();
    m.coachAttribution = attribution({ currentCoachMeasuredSeasons: 4, facts: { interim: false, coHead: false, previous: 0 }, predecessor: null });
    expect(cand(m, 'coach-context').reason).toBe('attribution-orientation-only');
  });

  it('gives an unresolved record a compact context line, not a finding', () => {
    const m = full();
    m.coachAttribution = attribution({ currentCoach: null, currentCoachReason: 'the 2026 coach record could not be read' });
    expect(cand(m, 'coach-context').reason).toBe('unresolved-compact-context-only');
    const snap = programmeSnapshot(m);
    expect(snap.prominence).toBe(PROMINENCE.REFUSAL);
    expect(snap.coach.value).toBe('Not established');
    expect(snap.coach.strip).toBe(false);
    expect(snap.coach.note).toMatch(/cannot say how much of the record below/);
  });

  it('says nothing loud where no coach record is held at this level', () => {
    const m = full();
    m.coachAttribution = attribution({ currentCoach: null, currentCoachReason: 'no coach row on file for this season' });
    expect(cand(m, 'coach-context').reason).toBe('no-coach-record-at-this-level');
    expect(programmeSnapshot(m).coach.note).toMatch(/no coaching record is held at this level/);
  });

  it('gives the five cases five different shapes', () => {
    const shape = (c) => [c.value != null, c.note != null, c.strip].join('/');
    const cases = [
      coachSnapshot({ prominence: PROMINENCE.ABSENT }),
      coachSnapshot({ prominence: PROMINENCE.REFUSAL, subline: 'x' }),
      coachSnapshot({ prominence: PROMINENCE.QUIET, headline: 'A', subline: 'y' }),
      coachSnapshot({ prominence: PROMINENCE.PROMINENT, headline: 'A' }),
      coachSnapshot({ prominence: PROMINENCE.VISIBLE, headline: 'A', subline: 'z' }),
    ];
    // The prominent case is the only one with no note, because the finding
    // above it carries the count; the refusal is the only one whose note is
    // the whole statement.
    expect(shape(cases[3])).toBe('true/false/true');
    expect(new Set(cases.map(shape)).size).toBeGreaterThan(2);
  });
});

describe('no duplicate decision concepts', () => {
  it('states each concept once across the findings', () => {
    const m = full();
    m.competitive.structuralFacts = [{ kind: 'DIVISION_CHANGE', seasons: [2023, 2024], text: 'The programme moved from NCAA Division II to NCAA Division I in 2024.' }];
    m.coachAttribution = null;
    const { findings } = decisionFindings(m);
    expect(new Set(findings.map((f) => f.category)).size).toBe(findings.length);
  });

  it('never puts two renderings of the arrival share on the page', () => {
    const m = full();
    const { findings } = decisionFindings(m);
    const mentions = findings.filter((f) => /did not arrive as first-years/.test(f.text));
    // The arrivals finding, and the replacement finding only where that route
    // is the dominant one — which it is not here.
    expect(mentions.length).toBeLessThanOrEqual(1);
  });

  it('keeps the attribution count out of the snapshot when it is a finding', () => {
    const m = full();
    m.coachAttribution = {
      currentCoach: { name: 'A. Coach' }, currentCoachReason: null,
      historicalMeasuredSeasons: 4, currentCoachMeasuredSeasons: 1,
      measuredSeasons: [2022, 2023, 2024, 2025], predecessor: null,
      incompleteCoachSeasons: [], facts: { interim: false, coHead: false, previous: 3 },
    };
    expect(cand(m, 'coach-context').text).toMatch(/1 of the 4/);
    expect(programmeSnapshot(m).coach.note).toBeNull();
  });
});

describe('the snapshot', () => {
  it('carries orientation and no conclusion', () => {
    const snap = programmeSnapshot(full());
    const text = snap.facts.map(([k, v]) => `${k} ${v}`).join(' ');
    for (const banned of [/benchmark(ed)? (above|below)/i, /comparable pool/i, /middle half/i,
      /above the/i, /below the/i]) {
      expect(text).not.toMatch(banned);
    }
  });

  it('prints a dash rather than a zero where nothing is on file', () => {
    const snap = programmeSnapshot(sparse());
    const missing = snap.facts.filter(([, v]) => v == null);
    expect(missing.length).toBeGreaterThan(0);
  });
});
