/**
 * The three acts, asserted on the plan rather than on the PDF.
 *
 * The document's shape is decided before anything is drawn, which is what
 * makes it testable without producing a report. These are the invariants that
 * would break silently: an athlete report that reaches the programme evidence
 * before it has answered the athlete's own position, a programme report
 * dragged into an architecture it has no pathway for, and a plan whose order
 * stops describing the document the renderer draws.
 */
import { describe, it, expect } from 'vitest';
import { planSections, planByAct, actsFor, actTitle, SECTIONS } from './sections.js';

/** A model rich enough that every gate opens. */
const rich = (over = {}) => ({
  college: { name: 'Test College', division: 'NCAA D1' },
  athlete: { name: 'A Player', position: 'FORWARD', positionLabel: 'Forward' },
  entrySeason: 2027,
  squadSeason: '2026',
  describes: ['2022', '2023', '2024', '2025'],
  seasons: [{}, {}, {}, {}],
  dials: { n: 12 },
  ladder: [{ rank: 1 }, { rank: 2 }],
  byPosition: [{ transitions: 2 }],
  freshman: { points: new Array(20).fill({}), intake: [{}] },
  transfer: { points: new Array(9).fill({}) },
  squad: { rostered: 20, cliff: [{}], arrivals: [{}] },
  evidenceLimits: [],
  lifecycle: {
    development: {
      players: 30,
      minutesCoverage: { readable: true, measured: 60, playerSeasons: 60 },
      everStarter: { reached: 10, denominator: 30 },
    },
    continuity: { returnable: 80, returned: 40, retention: 0.5 },
    departures: {
      gate: { allowed: true },
      departures: { total: 40 },
      tracing: { observed: 12, coverage: 0.3 },
      named: new Array(12).fill({}),
    },
    athletePosition: {
      group: 'position', rows: new Array(7).fill({}), positionRows: new Array(7).fill({}),
      atPositionObserved: 7, atPositionDepartures: 12, programmeObserved: 12,
    },
  },
  ...over,
});

const richSummary = () => ({
  programme: {
    freshmanOpportunity: { measuredFreshmen: 20, rowsWithoutMinutes: 0, unreadableSeasons: [], weightedAgrees: true },
    experiencedArrivalReliance: { measurable: true, arrivals: 9, measurableSeasons: ['2023', '2024', '2025'] },
    replacementBehaviour: { observations: 12, totalObservations: 12, seasonsRepresented: ['a'], record: [{}, {}] },
    squadTurnover: { projectedMinutes: { coverage: 1, playersWithProjection: 5, projectable: 5 } },
  },
  athlete: {
    entrySeason: 2027,
    currentPositionPlayers: [{}, {}, {}],
    currentPlayersEligibleAtEntry: [{}],
    currentPlayersInFinalSeasonAtEntry: [{}],
    positionVacancyHistory: { transitions: 3, openings: 3 },
    positionFreshmanHistory: { measured: 6, starters: 0 },
    experiencedArrivalsAtPosition: { measured: 3 },
    positionOpeningOutcomes: { dials: { n: 3 } },
    originContext: { requestedOrigin: 'international', programme: { withRecordedOrigin: 8, sameOrigin: { players: 2 } }, pool: {} },
  },
});

const plan = (model, summary) => planSections({ model, summary, philosophy: {} });

describe('the acts', () => {
  it('runs an athlete report pathway, programme, evidence', () => {
    const acts = actsFor({ hasAthlete: true }).map((a) => a.id);
    expect(acts).toEqual(['navigation', 'pathway', 'programme-evidence', 'supporting']);
    expect(actTitle('pathway', { hasAthlete: true })).toBe('Understanding your pathway');
    expect(actTitle('programme-evidence', { hasAthlete: true })).toBe('Understanding the programme');
    expect(actTitle('supporting', { hasAthlete: true })).toBe('The evidence behind it');
  });

  it('leaves a programme report programme-first', () => {
    const acts = actsFor({ hasAthlete: false }).map((a) => a.id);
    expect(acts).toEqual(['navigation', 'interpretation', 'programme-evidence', 'supporting']);
    expect(actTitle('interpretation', { hasAthlete: false })).toBe('At a glance');
    // And never names a pathway at a report that has no athlete.
    for (const a of actsFor({ hasAthlete: false })) {
      expect(a.title).not.toMatch(/pathway/i);
      expect(a.blurb ?? '').not.toMatch(/your position/i);
    }
  });

  it('gives every act after the first a reason to exist', () => {
    for (const a of actsFor({ hasAthlete: true }).slice(2)) {
      expect(a.blurb, a.id).toBeTruthy();
      expect(a.blurb.length).toBeGreaterThan(60);
    }
  });
});

describe('athlete ordering', () => {
  const built = () => plan(rich(), richSummary());

  it('answers the athlete before it opens the programme evidence', () => {
    const ids = built().map((s) => s.id);
    const lastPathway = Math.max(...['athlete-at-a-glance', 'athlete-current-position',
      'athlete-entry-window', 'athlete-position-openings', 'athlete-position-history',
      'athlete-origin'].map((id) => ids.indexOf(id)));
    const firstProgramme = Math.min(...['freshman-intake', 'freshman-ladder', 'player-development']
      .map((id) => ids.indexOf(id)));
    expect(lastPathway).toBeGreaterThan(-1);
    expect(firstProgramme).toBeGreaterThan(lastPathway);
  });

  it('opens with the summary and then the synthesis', () => {
    const ids = built().map((s) => s.id);
    expect(ids[0]).toBe('programme-at-a-glance');
    expect(ids[1]).toBe('athlete-at-a-glance');
  });

  it('runs the pathway in a family’s order of questions', () => {
    const ids = built().map((s) => s.id).filter((x) => x.startsWith('athlete-'));
    expect(ids).toEqual(['athlete-at-a-glance', 'athlete-current-position', 'athlete-entry-window',
      'athlete-position-openings', 'athlete-position-history', 'athlete-origin',
      'athlete-position-movement']);
  });

  it('files every section under exactly one act, in act order', () => {
    const built2 = built();
    const rank = new Map(actsFor({ hasAthlete: true }).map((a, i) => [a.id, i]));
    let last = -1;
    for (const s of built2) {
      expect(rank.has(s.act), `${s.id} act ${s.act}`).toBe(true);
      expect(rank.get(s.act)).toBeGreaterThanOrEqual(last);
      last = rank.get(s.act);
    }
    expect(built2.map((s) => s.order)).toEqual(built2.map((_, i) => i + 1));
  });

  it('puts the glance page and every athlete page in the pathway act', () => {
    for (const s of built()) {
      if (s.id === 'programme-at-a-glance' || (s.id.startsWith('athlete-') && s.id !== 'athlete-position-movement')) {
        expect(s.act, s.id).toBe('pathway');
      }
    }
  });

  it('titles the synthesis after the programme it is about', () => {
    expect(built().find((s) => s.id === 'athlete-at-a-glance').title)
      .toBe('Your pathway at Test College');
  });
});

describe('programme ordering', () => {
  const built = () => {
    const m = rich();
    delete m.athlete;
    delete m.lifecycle.athletePosition;
    const s = richSummary();
    s.athlete = null;
    return plan(m, s);
  };

  it('keeps the summary, evidence, record order it has always had', () => {
    const ids = built().map((s) => s.id);
    expect(ids[0]).toBe('programme-at-a-glance');
    expect(ids.filter((x) => x.startsWith('athlete-'))).toEqual([]);
    expect(ids.indexOf('freshman-intake')).toBe(1);
    expect(ids.indexOf('methodology')).toBe(ids.length - 1);
  });

  it('files the summary under its own act, not a pathway', () => {
    expect(built().find((s) => s.id === 'programme-at-a-glance').act).toBe('interpretation');
    expect(built().every((s) => s.act !== 'pathway')).toBe(true);
  });
});

describe('a thin position sample', () => {
  const thin = () => {
    const m = rich();
    m.lifecycle.athletePosition = {
      group: 'programme', rows: new Array(12).fill({}), positionRows: [{}],
      atPositionObserved: 1, atPositionDepartures: 10, programmeObserved: 12,
    };
    return plan(m, richSummary());
  };

  it('is kept, and filed with the record rather than the pathway', () => {
    const s = thin().find((x) => x.id === 'athlete-position-movement');
    expect(s, 'the evidence is retained').toBeTruthy();
    expect(s.act).toBe('supporting');
    expect(s.layer).toBe('supporting');
  });

  it('stays in the pathway where the position carries a sample', () => {
    const s = plan(rich(), richSummary()).find((x) => x.id === 'athlete-position-movement');
    expect(s.act).toBe('pathway');
  });
});

describe('consolidated refusals', () => {
  const withLimits = (ids) => {
    const m = rich();
    delete m.athlete;
    m.evidenceLimits = ids.map((id) => ({ id, title: id }));
    const s = richSummary();
    s.athlete = null;
    return plan(m, s);
  };

  it('does not open a page for a single refusal', () => {
    const ids = withLimits(['replacing-minutes']).map((s) => s.id);
    expect(ids).not.toContain('evidence-limits');
    expect(ids).toContain('replacing-minutes');
  });

  it('folds an absorbed section into the consolidated page, and only that one', () => {
    const ids = withLimits(['replacing-minutes', 'observed-destinations']).map((s) => s.id);
    expect(ids).toContain('evidence-limits');
    expect(ids).not.toContain('replacing-minutes');
    // Not absorbed: a thin answer is still an answer and keeps its own page.
    expect(ids).toContain('experienced-arrival-intake');
  });

  it('keeps every supporting record whatever is refused', () => {
    const ids = withLimits(['replacing-minutes', 'observed-destinations']).map((s) => s.id);
    for (const id of ['table-freshmen', 'table-vacancies', 'methodology']) {
      expect(ids, id).toContain(id);
    }
  });
});

describe('the registry declares what it draws', () => {
  it('has no section without an act-resolvable layer', () => {
    for (const s of SECTIONS) {
      expect(['interpretation', 'programme-evidence', 'athlete-evidence', 'supporting'],
        s.id).toContain(s.layer);
    }
  });
});
