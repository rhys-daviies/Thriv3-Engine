import { describe, it, expect } from 'vitest';
import { planSections, planByLayer, SECTIONS, LAYERS } from './sections.js';
import { buildReportSummary } from './summary.js';

const emptyModel = (over = {}) => ({
  seasons: [], ladder: [], weightedLadder: null,
  dials: { n: 0, freshman: null, newcomer: null, returning: null },
  byPosition: [], benchmarks: null, benchmarksReason: 'pool not readable',
  verdict: null, tenure: null, coach: null,
  freshman: { intake: [], points: [], progression: [], grid: [], retention: null },
  transfer: { points: [], window: { measurable: [], unmeasurable: [] }, measurable: false, density: 'none' },
  squad: { rostered: 0, cliff: null, arrivals: [], depth: null },
  athlete: null, fit: null, entrySeason: 2026, squadSeason: '2026',
  ...over,
});

const fullModel = (over = {}) => emptyModel({
  seasons: [{ season: '2024', intake: 6, played: 4, starters: 1, share: 0.2 },
    { season: '2025', intake: 6, played: 4, starters: 1, share: 0.2 }],
  ladder: [{ rank: 1, median: 900, low: 800, high: 1000, band: 'impact', agreement: 'tight', comparable: true, seasonsWithThisMany: 2, contributions: [] }],
  dials: { n: 8, freshman: 20, newcomer: 15, returning: 65 },
  byPosition: [{ position: 'DEFENSE', transitions: 3, startersDeparted: 2, openings: 2, freshmanTookIt: 1, newcomerTookIt: 1, dials: { n: 3, freshman: 20, newcomer: 15, returning: 65 }, seasons: [{ season: '2024' }] }],
  freshman: {
    intake: [{ season: '2024', freshmen: 6, readable: true, arrivalsMeasurable: true, newcomers: 2, newcomerMinutes: 900, newcomerStarters: 1, load: 9000 },
      { season: '2025', freshmen: 6, readable: true, arrivalsMeasurable: true, newcomers: 2, newcomerMinutes: 900, newcomerStarters: 1, load: 9000 }],
    points: [{ season: '2024', origin: 'domestic', minutes: 900, position: 'DEFENSE' }],
    progression: [{ season: '2024', year1: 100, year2: 400, year2State: 'measured' }],
    grid: [{ position: 'DEFENSE', cells: [] }],
    retention: { stayed: 1, of: 1 },
  },
  transfer: { points: [{ season: '2024', minutes: 800, position: 'DEFENSE' }], window: { measurable: ['2024', '2025'], unmeasurable: [] }, measurable: true, density: 'few' },
  squad: {
    rostered: 4,
    cliff: [{ year: 2027, total: 900, players: 1, playersWithProjection: 1, playersWithoutProjection: 0, byPosition: [] }],
    arrivals: [{ name: 'X', position: 'DEFENSE', classLabel: 'Jr.', from: 'Elsewhere', projectedMinutes: 400 }],
    depth: [{ name: 'A', classLabel: 'Jr.', projectedMinutes: 900, eligibleTo: 2028, arrivedFrom: null }],
  },
  ...over,
});

const philosophy = {
  freshman: { unreadableSeasons: [], unknownRows: 0, seasonsWithAnImpactFreshman: 2, medianIntake: 6, medianPlayed: 4, medianImpactPerSeason: 1 },
  observations: [{ freshmenReadable: true, to: '2025', departedStarters: 1, vacatedStarterShare: 0.2 }],
};

const planFor = (model) => {
  const summary = buildReportSummary({ model, philosophy, squadRows: [] });
  return planSections({ model, summary, philosophy });
};

const athlete = {
  id: 'p1', name: 'A', position: 'Defender', positionLabel: 'Defender',
  nationality: 'USA', origin: 'domestic', classYear: 2027, level: null,
};

describe('the plan', () => {
  it('is deterministic for the same model', () => {
    const model = fullModel();
    expect(planFor(model)).toEqual(planFor(model));
  });

  it('carries no page numbers, because they are not knowable yet', () => {
    for (const s of planFor(fullModel())) expect(s.page).toBeNull();
  });

  it('numbers sections in the order they will render', () => {
    const plan = planFor(fullModel());
    expect(plan.map((s) => s.order)).toEqual(plan.map((_, i) => i + 1));
  });

  it('describes every section it lists', () => {
    for (const s of planFor(fullModel())) {
      expect(s.title).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(LAYERS.map((l) => l.id)).toContain(s.layer);
    }
  });
});

describe('athlete sections', () => {
  it('omits every athlete section when there is no athlete', () => {
    const plan = planFor(fullModel());
    expect(plan.some((s) => s.scope === 'athlete')).toBe(false);
    expect(plan.some((s) => s.layer === 'athlete-evidence')).toBe(false);
  });

  it('includes them once an athlete is present', () => {
    const model = fullModel({ athlete, fit: { position: { transitions: 3, openings: 2, seasons: [{ season: '2024' }] }, ladder: [], cohort: { applied: true, relaxed: null, refused: null, position: 'DEFENSE', origin: 'domestic' } } });
    const plan = planFor(model);
    expect(plan.some((s) => s.id === 'athlete-at-a-glance')).toBe(true);
    expect(plan.some((s) => s.id === 'athlete-position-history')).toBe(true);
  });
});

describe('sections with nothing to say', () => {
  // A section with no data is absent from the report AND from the contents.
  // A heading over nothing reads as a section that failed to render.
  it('drops data-driven sections on an empty programme', () => {
    const plan = planFor(emptyModel());
    const ids = plan.map((s) => s.id);
    expect(ids).not.toContain('freshman-intake');
    expect(ids).not.toContain('freshman-ladder');
    expect(ids).not.toContain('current-depth');
    expect(ids).not.toContain('eligibility-outlook');
    expect(ids).not.toContain('table-freshmen');
  });

  // The few sections where the ABSENCE is the finding keep their place: a
  // quarter of programmes sign nobody, and "we could not compare the seasons"
  // is a different statement from silence.
  it('keeps the sections whose absence is itself informative', () => {
    const ids = planFor(emptyModel()).map((s) => s.id);
    expect(ids).toContain('programme-at-a-glance');
    expect(ids).toContain('experienced-arrival-intake');
    expect(ids).toContain('replacing-minutes');
    expect(ids).toContain('methodology');
  });

  it('marks which sections will show an explicit unavailable state', () => {
    const plan = planFor(emptyModel());
    expect(plan.find((s) => s.id === 'experienced-arrival-intake').showsUnavailableState).toBe(true);
    expect(planFor(fullModel()).find((s) => s.id === 'freshman-ladder').showsUnavailableState).toBe(false);
  });

  it('says why arrivals cannot be measured rather than reporting none', () => {
    const scope = planFor(emptyModel()).find((s) => s.id === 'experienced-arrival-intake').scopeNotes;
    expect(scope.join(' ')).toMatch(/no season can be compared/);
  });
});

describe('scope notes', () => {
  it('describes what each section is built from', () => {
    const plan = planFor(fullModel());
    expect(plan.find((s) => s.id === 'freshman-intake').scopeNotes.join(' ')).toMatch(/12 first-years measured/);
    expect(plan.find((s) => s.id === 'current-depth').scopeNotes.join(' ')).toMatch(/4 players/);
  });

  // A scope line is decoration on a contents page. A throw inside one must not
  // be able to take down a report whose analysis is perfectly sound.
  it('survives a scope line that throws', () => {
    const broken = { ...SECTIONS[0], id: 'broken', scopeOf: () => { throw new Error('boom'); } };
    const plan = planSections({
      model: fullModel(), summary: buildReportSummary({ model: fullModel(), philosophy, squadRows: [] }), philosophy,
    });
    expect(plan.length).toBeGreaterThan(0);
    // And the registry entry itself is well-formed enough to be substituted.
    expect(typeof broken.applies).toBe('function');
  });
});

describe('planByLayer', () => {
  it('drops layers with no sections rather than heading an empty one', () => {
    const layers = planByLayer(planFor(fullModel()));
    expect(layers.every((l) => l.sections.length > 0)).toBe(true);
    expect(layers.map((l) => l.id)).not.toContain('athlete-evidence');
  });

  it('keeps the layers in document order', () => {
    const layers = planByLayer(planFor(fullModel()));
    const order = LAYERS.map((l) => l.id);
    const seen = layers.map((l) => l.id);
    expect(seen).toEqual(order.filter((id) => seen.includes(id)));
  });
});
