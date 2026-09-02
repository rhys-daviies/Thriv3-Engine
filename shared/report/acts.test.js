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
import {
  planSections, planByAct, actsFor, actTitle, SECTIONS, arrivalsAreOneFinding,
} from './sections.js';

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
    // A programme with its own readable record by origin: `share` present and
    // the cohort gate open. That is what keeps this page in the pathway act —
    // where either is missing the page is mostly division context and is filed
    // with the supporting evidence instead.
    originContext: {
      requestedOrigin: 'international',
      programme: { withRecordedOrigin: 8, sameOrigin: { players: 6, starters: 2, share: 0.33 } },
      pool: {},
      evidence: { sufficient: true },
    },
  },
});

const plan = (model, summary) => planSections({ model, summary, philosophy: {} });

describe('the acts', () => {
  it('runs an athlete report pathway, programme, evidence', () => {
    const acts = actsFor({ hasAthlete: true }).map((a) => a.id);
    // 13F: the two decision layers are their own act on an athlete report too.
    // They were filed under "Understanding your pathway", which put the
    // PROGRAMME's findings under a heading claiming they were about the reader.
    expect(acts).toEqual(['navigation', 'interpretation', 'pathway', 'programme-evidence',
      'supporting']);
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
    // Whichever of the programme sections this fixture actually plans: the
    // competitive frame opens the act where the package is on the model, and
    // the first-year story opens it where it is not.
    const firstProgramme = Math.min(...['competitive-environment', 'freshman-opportunity',
      'player-development'].map((id) => ids.indexOf(id)).filter((i) => i > -1));
    expect(lastPathway).toBeGreaterThan(-1);
    expect(firstProgramme).toBeGreaterThan(lastPathway);
  });

  it('opens with the athlete’s findings, then the programme’s', () => {
    const ids = built().map((s) => s.id);
    // 13F: the athlete's own findings first, then the programme's and the
    // context they sit in. The plan array describes the document, so it is
    // declared in the order it is drawn.
    expect(ids.slice(0, 3)).toEqual([
      'athlete-at-a-glance', 'programme-at-a-glance', 'programme-snapshot',
    ]);
  });

  it('runs the pathway in a family’s order of questions', () => {
    const ids = built().map((s) => s.id).filter((x) => x.startsWith('athlete-'));
    // 13F consolidated two pairs — the arrival window into the current-position
    // section, and the position history into the position record — and pinned
    // the origin page into the pathway act at every programme.
    expect(ids).toEqual(['athlete-at-a-glance', 'athlete-current-position',
      'athlete-position-openings', 'athlete-position-record', 'athlete-origin',
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

  it('files the two decision layers apart from the pathway pages', () => {
    for (const s of built()) {
      if (s.id === 'programme-at-a-glance' || s.id === 'programme-snapshot'
        || s.id === 'athlete-at-a-glance') {
        expect(s.act, s.id).toBe('interpretation');
      } else if (s.id.startsWith('athlete-') && s.id !== 'athlete-position-movement') {
        expect(s.act, s.id).toBe('pathway');
      }
    }
  });

  it('titles the athlete decision layer for the athlete, not the programme', () => {
    // 13F: it is the report's opening and it is ranked findings, not a
    // synthesis paragraph named after the college.
    expect(built().find((s) => s.id === 'athlete-at-a-glance').title)
      .toBe('What Thriv3 sees for you');
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
    // The decision layer is two sections since 13C: the findings, then the
    // snapshot that orients them.
    expect(ids.slice(0, 2)).toEqual(['programme-at-a-glance', 'programme-snapshot']);
    expect(ids.filter((x) => x.startsWith('athlete-'))).toEqual([]);
    // The competitive frame opens the programme act since 13B; the first-year
    // story is the question after it.
    expect(ids.indexOf('freshman-opportunity')).toBe(2);
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
    expect(ids).toContain('experienced-arrivals');
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

describe('the sections Phase 9B added', () => {
  const NEW = {
    pressure: { athletePosition: {
      historical: { suppressed: false, cyclesWithReadableRosterPresence: 3 },
      current: { readable: true, totalIncoming: 2 },
    } },
    positionUtilisation: { athletePosition: {
      supported: true, available: true, readableSeasons: 4, singleSeasonObservation: null,
    } },
    squadProfile: {
      utilisation: { available: true, seasonsObserved: 4, singleSeasonObservation: null },
      experience: { compositionAvailable: true, loadAvailable: true, singleSeasonObservation: null },
    },
  };
  const withNew = (over = {}) => rich({ ...NEW, ...over });
  const ids = (m, s2) => plan(m, s2).map((x) => x.id);

  it('puts the position record inside Act I, after the openings page', () => {
    const p2 = plan(withNew(), richSummary());
    const order = p2.map((x) => x.id);
    expect(order).toContain('athlete-position-record');
    expect(p2.find((x) => x.id === 'athlete-position-record').act).toBe('pathway');
    expect(order.indexOf('athlete-position-record'))
      .toBeGreaterThan(order.indexOf('athlete-position-openings'));
    // `athlete-position-history` was absorbed into the record section in 13F.
    expect(order).not.toContain('athlete-position-history');
    expect(order.indexOf('athlete-position-record'))
      .toBeLessThan(order.indexOf('freshman-opportunity'));
  });

  it('puts squad usage in Act II of both reports', () => {
    for (const [m, s2] of [[withNew(), richSummary()],
      [withNew({ athlete: null }), { programme: richSummary().programme }]]) {
      const entry = plan(m, s2).find((x) => x.id === 'squad-usage');
      expect(entry).toBeTruthy();
      expect(entry.act).toBe('programme-evidence');
    }
  });

  // A programme report has no position to be about.
  it('keeps the position record out of a report with no athlete', () => {
    expect(ids(withNew({ athlete: null }), { programme: richSummary().programme }))
      .not.toContain('athlete-position-record');
  });

  it('keeps the position record where one half refuses and the other does not', () => {
    // Sparse: the intake reads, the minutes do not.
    expect(ids(withNew({
      positionUtilisation: { athletePosition: { supported: true, available: false, singleSeasonObservation: null } },
    }), richSummary())).toContain('athlete-position-record');
    // Goalkeeper: the intake reads, the distribution is not reported for them.
    expect(ids(withNew({
      positionUtilisation: { athletePosition: { supported: false, available: false, singleSeasonObservation: null } },
    }), richSummary())).toContain('athlete-position-record');
    // One season on file and no completed cycle: NAIA.
    expect(ids(withNew({
      pressure: { athletePosition: { historical: { suppressed: true }, current: { readable: true, totalIncoming: 7 } } },
      positionUtilisation: { athletePosition: { supported: true, available: false, singleSeasonObservation: { season: '2025' } } },
    }), richSummary())).toContain('athlete-position-record');
  });

  it('drops the position record only where every half has nothing', () => {
    // Since 13F the section also carries the first-years and the experienced
    // arrivals at the position, so a summary holding those keeps the page even
    // where the intake and the minute reach are both suppressed.
    const bare = richSummary();
    bare.athlete.positionFreshmanHistory = { measured: 0, starters: 0, players: [] };
    bare.athlete.experiencedArrivalsAtPosition = { measured: 0, starters: 0, players: [] };
    expect(ids(withNew({
      pressure: { athletePosition: { historical: { suppressed: true }, current: { readable: false, totalIncoming: null } } },
      positionUtilisation: { athletePosition: { supported: true, available: false, singleSeasonObservation: null } },
    }), bare)).not.toContain('athlete-position-record');
  });

  it('keeps squad usage on one readable season, and drops it on none', () => {
    expect(ids(withNew({
      squadProfile: {
        utilisation: { available: false, singleSeasonObservation: { season: '2025' } },
        experience: { compositionAvailable: false, singleSeasonObservation: null },
      },
    }), richSummary())).toContain('squad-usage');
    expect(ids(withNew({
      squadProfile: {
        utilisation: { available: false, singleSeasonObservation: null },
        experience: { compositionAvailable: false, singleSeasonObservation: null },
      },
    }), richSummary())).not.toContain('squad-usage');
  });
});

/**
 * PHASE 9C — the origin page's act depends on the evidence it turned out to
 * have. It is never removed and never loses a caveat; what moves is where it
 * sits in the reading order.
 */
describe('where the origin page is filed', () => {
  const thin = () => {
    const summary = richSummary();
    // Recorded origin, a pool to compare against, and nothing of this
    // programme's own: the cohort gate is shut and no share can be quoted.
    summary.athlete.originContext = {
      requestedOrigin: 'international',
      programme: { withRecordedOrigin: 8, sameOrigin: { players: 0, starters: 0, share: null } },
      pool: {},
      evidence: { sufficient: false },
    };
    return summary;
  };

  it('keeps it in the pathway where the programme has its own record', () => {
    const s = plan(rich(), richSummary()).find((x) => x.id === 'athlete-origin');
    expect(s.layer).toBe('athlete-evidence');
    expect(s.act).toBe('pathway');
    expect(s.scopeNotes).not.toContain('pool context only');
  });

  /**
   * PINNED SINCE 13F. It used to move to the supporting record wherever the
   * programme's own origin sample did not clear the cohort gate, which put it
   * after every evidence table at four of the five programmes 13E audited —
   * page 26 of 28 at Adams State. For an international athlete the REFUSAL is
   * decision-relevant, so it stays where they will read it and says what it
   * could not establish.
   */
  it('keeps it in the pathway even where the page is pool context', () => {
    const s = plan(rich(), thin()).find((x) => x.id === 'athlete-origin');
    expect(s).toBeTruthy();
    expect(s.layer).toBe('athlete-evidence');
    expect(s.act).toBe('pathway');
    // And the contents still says what it is: a pool comparison, not this
    // programme's own record.
    expect(s.scopeNotes).toContain('pool context only');
  });

  it('sits before the programme evidence, not after it', () => {
    const built = plan(rich(), thin());
    const ids = built.map((x) => x.id);
    expect(ids).toContain('athlete-origin');
    // Before every programme page in the plan, whichever ones this fixture has.
    const at = built.findIndex((x) => x.id === 'athlete-origin');
    const firstProgramme = built.findIndex((x) => x.act === 'programme-evidence');
    expect(firstProgramme).toBeGreaterThan(-1);
    expect(at).toBeLessThan(firstProgramme);
  });

  it('does not move at all', () => {
    const a = SECTIONS.find((x) => x.id === 'athlete-origin');
    expect(a.title).toBe('Where you are arriving from');
    expect(a.layer).toBe('athlete-evidence');
    // No `layerOf`: one home, whatever the cohort turns out to hold.
    expect(a.layerOf).toBeUndefined();
  });
});

describe('a short arrivals finding', () => {
  it('is one finding where nothing arrived and a page where something did', () => {
    const none = { summary: { programme: { experiencedArrivalReliance: { measurable: true, density: 'none' } } } };
    const some = { summary: { programme: { experiencedArrivalReliance: { measurable: true, density: 'some', arrivals: 9 } } } };
    const unmeasurable = { summary: { programme: { experiencedArrivalReliance: { measurable: false } } } };
    expect(arrivalsAreOneFinding(none)).toBe(true);
    expect(arrivalsAreOneFinding(unmeasurable)).toBe(true);
    expect(arrivalsAreOneFinding(some)).toBe(false);
    expect(arrivalsAreOneFinding({})).toBe(false);
  });
});
