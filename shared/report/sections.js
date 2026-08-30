/**
 * What the report contains, decided before anything is drawn.
 *
 * This is the data behind a contents page and behind the dynamic-page rule,
 * and it is deliberately not a renderer. It answers "does this section have
 * anything to say, and what is the scope of what it says" from the model
 * alone, so that:
 *
 *   - a section with nothing to show is omitted rather than drawn empty, and
 *     omitted from the contents too;
 *   - a chart is never asked to decide its own absence. `frame()` throws when
 *     handed no data and no stated reason, which is the right behaviour and
 *     the wrong place to discover it — by then a page has already begun;
 *   - the whole shape of the document can be asserted in a unit test without
 *     producing a PDF.
 *
 * NO PAGE NUMBERS. They are not knowable until the document is laid out, and
 * the fix is not a second render: pdfkit is already constructed with
 * `bufferPages: true`, and `footer()` already demonstrates writing to a page
 * after the fact via `switchToPage`. The renderer records the page each
 * section started on as it goes and fills the contents in at the end. This
 * module exists so that pass has something deterministic to iterate.
 */

/**
 * The layers of the document, outermost structure first.
 *
 * Ordering here is the ordering in the report; nothing else decides it.
 */
export const LAYERS = [
  { id: 'navigation', title: 'Contents' },
  { id: 'interpretation', title: 'At a glance' },
  { id: 'programme-evidence', title: 'The programme' },
  { id: 'athlete-evidence', title: 'For this athlete' },
  { id: 'supporting', title: 'Supporting detail' },
];

const count = (x) => (Array.isArray(x) ? x.length : 0);
const has = (x) => count(x) > 0;

/**
 * Every section the report can contain.
 *
 * `applies` decides whether the section renders at all. `scopeOf` describes
 * what it is built from, in units a reader understands, for the contents page.
 * `unavailableWhenEmpty` marks the few sections where the ABSENCE is itself
 * the finding and an explicit "we could not measure this" is better than
 * silence — a module card with no classification tells a reader something; a
 * blank page does not.
 */
export const SECTIONS = [
  // -- Layer 2: interpretation ---------------------------------------------
  {
    id: 'programme-at-a-glance',
    title: 'Programme at a glance',
    description: 'How this programme has used first-years and experienced arrivals, who takes the '
      + 'minutes when they open, and whose record this is.',
    layer: 'interpretation',
    scope: 'programme',
    // Always renders. Each of its five modules states its own unavailability,
    // and a reader learning that four of five could not be measured has
    // learned something real about the programme's record.
    unavailableWhenEmpty: true,
    applies: () => true,
    scopeOf: ({ model }) => [
      model.seasons?.length ? `${model.seasons.length} seasons analysed` : null,
      model.dials?.n ? `${model.dials.n} vacancy observations` : null,
    ].filter(Boolean),
  },
  {
    id: 'athlete-at-a-glance',
    title: 'Athlete opportunity at a glance',
    description: 'The position entered, who is currently there, and what has happened when a place '
      + 'opened at it.',
    layer: 'interpretation',
    scope: 'athlete',
    unavailableWhenEmpty: false,
    applies: ({ summary }) => Boolean(summary?.athlete)
      && (has(summary.athlete.currentPositionPlayers)
        || (summary.athlete.positionVacancyHistory?.transitions ?? 0) > 0),
    scopeOf: ({ summary }) => [
      count(summary.athlete?.currentPositionPlayers)
        ? `${count(summary.athlete.currentPositionPlayers)} currently at the position` : null,
      summary.athlete?.positionVacancyHistory?.transitions
        ? `${summary.athlete.positionVacancyHistory.transitions} position-seasons` : null,
    ].filter(Boolean),
  },

  // -- Layer 3: programme evidence -----------------------------------------
  {
    id: 'freshman-intake',
    title: 'The first-year intake',
    description: 'Every first-year of the seasons on file, how many arrived and how many played.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: false,
    applies: ({ model }) => has(model.freshman?.points) || has(model.freshman?.intake),
    scopeOf: ({ model, summary }) => [
      `${summary.programme.freshmanOpportunity.measuredFreshmen} first-years measured`,
      summary.programme.freshmanOpportunity.rowsWithoutMinutes
        ? `${summary.programme.freshmanOpportunity.rowsWithoutMinutes} with no minutes published` : null,
    ].filter(Boolean),
  },
  {
    id: 'freshman-ladder',
    title: 'The first-year ladder',
    description: 'How deep into a recruiting class real playing time has gone here.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: false,
    applies: ({ model }) => has(model.ladder),
    scopeOf: ({ model, summary }) => [
      // The page draws the top five rungs, so the contents says five.
      `${Math.min(5, model.ladder.length)} ranks shown`,
      summary.programme.freshmanOpportunity.weightedAgrees === false
        ? 'coach-weighted view differs' : null,
    ].filter(Boolean),
  },
  {
    id: 'freshman-development',
    title: 'After the first season',
    description: 'What happens to a first-year here in their second year.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: false,
    applies: ({ model }) => has(model.freshman?.progression),
    scopeOf: ({ model }) => [`${model.freshman.progression.length} players followed a season on`],
  },
  {
    id: 'experienced-arrival-intake',
    title: 'Experienced arrivals',
    description: 'How often this programme adds players who are not first-years, and what they played.',
    layer: 'programme-evidence',
    scope: 'programme',
    // The absence matters here. A quarter of programmes sign nobody, and that
    // is a finding — but only where the seasons could be compared at all.
    unavailableWhenEmpty: true,
    applies: () => true,
    scopeOf: ({ summary }) => {
      const e = summary.programme.experiencedArrivalReliance;
      if (!e.measurable) return ['no season can be compared with the one before it'];
      return [`${e.arrivals} arrivals across ${e.measurableSeasons.length} measurable seasons`];
    },
  },
  {
    id: 'current-arrivals',
    title: 'Who the arrivals are',
    description: 'The kind of player this programme brings in, and who has arrived for the current season.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: false,
    // The historical half stands on its own, so this page survives a
    // programme with no current roster on file.
    applies: ({ model }) => has(model.transfer?.points) || (model.squad?.rostered ?? 0) > 0,
    scopeOf: ({ model }) => [
      count(model.transfer?.points) ? `${count(model.transfer.points)} measured` : null,
      model.squad?.rostered ? `${count(model.squad?.arrivals)} named for the current season` : null,
    ].filter(Boolean),
  },
  {
    id: 'replacing-minutes',
    title: 'Replacing minutes',
    description: 'Where a position’s minutes went the season after established players left it.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: true,
    applies: () => true,
    scopeOf: ({ summary }) => {
      const r = summary.programme.replacementBehaviour;
      return [
        `${r.observations} readable of ${r.totalObservations} position-seasons`,
        r.seasonsRepresented.length ? `${r.seasonsRepresented.length} transitions` : null,
      ].filter(Boolean);
    },
  },
  {
    id: 'replacement-by-position',
    title: 'Position by position',
    description: 'Whether what happens when a place comes free depends on the position.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: false,
    applies: ({ model }) => (model.byPosition ?? []).some((p) => p.transitions > 0),
    scopeOf: ({ model }) => {
      const live = (model.byPosition ?? []).filter((p) => p.transitions > 0);
      return [`${live.length} of ${model.byPosition.length} positions readable`];
    },
  },
  {
    id: 'eligibility-outlook',
    title: 'Current squad outlook',
    description: 'When the playing-time load on the current roster reaches the end of its eligibility.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: false,
    applies: ({ model }) => has(model.squad?.cliff),
    scopeOf: ({ model, summary }) => {
      const p = summary.programme.squadTurnover.projectedMinutes;
      return [
        `${model.squad.cliff.length} eligibility years`,
        p.coverage == null ? 'no projected minutes on file'
          : `projections for ${p.playersWithProjection} of ${p.projectable} returning`,
      ];
    },
  },
  {
    id: 'current-depth',
    title: 'The current squad in full',
    description: 'Every player on the roster now, with class, projected minutes and eligibility.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: false,
    applies: ({ model }) => (model.squad?.rostered ?? 0) > 0,
    scopeOf: ({ model }) => [`${model.squad.rostered} players`],
  },

  // -- Layer 4: athlete evidence -------------------------------------------
  {
    id: 'athlete-position-history',
    title: 'This position, historically',
    description: 'First-years, experienced arrivals and vacancies at the athlete’s position only.',
    layer: 'athlete-evidence',
    scope: 'athlete',
    unavailableWhenEmpty: false,
    applies: ({ summary }) => {
      const a = summary?.athlete;
      if (!a) return false;
      return (a.positionVacancyHistory?.transitions ?? 0) > 0
        || a.positionFreshmanHistory.measured > 0
        || a.experiencedArrivalsAtPosition.measured > 0;
    },
    scopeOf: ({ summary }) => {
      const a = summary.athlete;
      return [
        `${a.positionFreshmanHistory.measured} first-years`,
        `${a.experiencedArrivalsAtPosition.measured} experienced arrivals`,
        a.positionVacancyHistory?.openings
          ? `${a.positionVacancyHistory.openings} openings` : null,
      ].filter(Boolean);
    },
  },
  {
    id: 'athlete-current-competition',
    title: 'Who is there now',
    description: 'Every current player at the position, and whether their eligibility reaches the '
      + 'entry season.',
    layer: 'athlete-evidence',
    scope: 'athlete',
    unavailableWhenEmpty: false,
    applies: ({ summary }) => has(summary?.athlete?.currentPositionPlayers),
    scopeOf: ({ summary }) => {
      const a = summary.athlete;
      return [
        `${count(a.currentPositionPlayers)} at the position`,
        `${count(a.currentPlayersEligibleAtEntry)} eligible into ${a.entrySeason}`,
        count(a.currentPlayersEligibilityUnknown)
          ? `${count(a.currentPlayersEligibilityUnknown)} with no eligibility year recorded` : null,
      ].filter(Boolean);
    },
  },
  {
    id: 'athlete-entry-context',
    title: 'The entry season, and what cannot be known about it',
    description: 'What the current record says about the entry year, and the limits of saying it.',
    layer: 'athlete-evidence',
    scope: 'athlete',
    // Always renders for an athlete. Its second half is the limitation, and
    // the limitation does not depend on there being data for the first half.
    unavailableWhenEmpty: true,
    applies: ({ summary }) => Boolean(summary?.athlete),
    scopeOf: ({ summary }) => [
      `entry ${summary.athlete.entrySeason}`,
      summary.athlete.entrySeasonKnown ? null : 'beyond the rosters on file',
    ].filter(Boolean),
  },
  {
    id: 'athlete-origin',
    title: 'Where the athlete is arriving from',
    description: 'Whether first-years from the same background have played here.',
    layer: 'athlete-evidence',
    scope: 'athlete',
    unavailableWhenEmpty: false,
    applies: ({ summary }) => {
      const o = summary?.athlete?.originContext;
      return Boolean(o?.requestedOrigin) && o.programme.withRecordedOrigin > 0;
    },
    scopeOf: ({ summary }) => {
      const o = summary.athlete.originContext;
      return [
        `${o.programme.sameOrigin.players} of ${o.programme.withRecordedOrigin} share this background`,
        o.programme.withoutRecordedOrigin
          ? `${o.programme.withoutRecordedOrigin} with no origin recorded` : null,
      ].filter(Boolean);
    },
  },

  // -- Layer 5: supporting --------------------------------------------------
  {
    id: 'table-freshmen',
    title: 'Every first-year measured',
    description: 'The rows behind the first-year charts.',
    layer: 'supporting',
    scope: 'programme',
    unavailableWhenEmpty: false,
    applies: ({ model }) => has(model.freshman?.points),
    scopeOf: ({ model }) => [`${model.freshman.points.length} rows`],
  },
  {
    id: 'table-experienced-arrivals',
    title: 'Every experienced arrival measured',
    description: 'The rows behind the arrivals charts.',
    layer: 'supporting',
    scope: 'programme',
    unavailableWhenEmpty: false,
    applies: ({ model }) => has(model.transfer?.points),
    scopeOf: ({ model }) => [`${model.transfer.points.length} rows`],
  },
  {
    id: 'table-vacancies',
    title: 'Every vacancy observed',
    description: 'Each position-season where a starter left, and what followed.',
    layer: 'supporting',
    scope: 'programme',
    unavailableWhenEmpty: false,
    applies: ({ philosophy }) => (philosophy?.observations ?? []).some((o) => o.departedStarters > 0),
    scopeOf: ({ philosophy }) => {
      const openings = (philosophy?.observations ?? []).filter((o) => o.departedStarters > 0);
      return [`${openings.length} position-seasons with a departure`];
    },
  },
  {
    id: 'table-current-squad',
    title: 'The current squad in full',
    description: 'Every player on the current roster.',
    layer: 'supporting',
    scope: 'programme',
    unavailableWhenEmpty: false,
    applies: ({ model }) => (model.squad?.rostered ?? 0) > 0,
    scopeOf: ({ model }) => [`${model.squad.rostered} players`],
  },
  {
    id: 'methodology',
    title: 'How this was worked out, and what it cannot tell you',
    description: 'Definitions, thresholds and limits.',
    layer: 'supporting',
    scope: 'programme',
    unavailableWhenEmpty: true,
    applies: () => true,
    scopeOf: () => [],
  },
];

/**
 * Which sections this report actually contains, in order.
 *
 * Deterministic: the same model always produces the same plan, which is what
 * makes the document's shape assertable without rendering it.
 *
 * `scopeOf` is wrapped rather than trusted. A scope line is decoration on a
 * contents page, and a throw inside one must not be able to take down a
 * report whose analysis is perfectly sound.
 */
export function planSections({ model, summary, philosophy }) {
  const ctx = { model, summary, philosophy };
  const hasAthlete = Boolean(model?.athlete);

  return SECTIONS
    .filter((s) => (s.scope === 'athlete' ? hasAthlete : true))
    .filter((s) => {
      try {
        return Boolean(s.applies(ctx));
      } catch {
        return false;
      }
    })
    .map((s, i) => {
      let scope = [];
      try {
        scope = s.scopeOf(ctx) ?? [];
      } catch {
        scope = [];
      }
      return {
        order: i + 1,
        id: s.id,
        title: s.title,
        description: s.description,
        layer: s.layer,
        scope: s.scope,
        // The renderer fills this in once the section has been laid out; the
        // plan states the field so the shape is stable either way.
        page: null,
        scopeNotes: scope,
        showsUnavailableState: Boolean(s.unavailableWhenEmpty),
      };
    });
}

/**
 * The same plan, grouped into layers, with empty layers dropped.
 *
 * A layer heading over nothing reads as a section that failed to render.
 */
export function planByLayer(plan) {
  return LAYERS
    .map((layer) => ({ ...layer, sections: plan.filter((s) => s.layer === layer.id) }))
    .filter((layer) => layer.sections.length > 0);
}
