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

import { MIN_POSITION_DESTINATIONS } from './lifecycleSummary.js';

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
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
      model.seasons?.length ? `${plural(model.seasons.length, 'season')} analysed` : null,
      model.dials?.n ? plural(model.dials.n, 'vacancy observation') : null,
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
    id: 'player-development',
    title: 'How players develop after they arrive',
    description: 'What a first-year here goes on to play, year by year, against comparable programmes.',
    layer: 'programme-evidence',
    scope: 'programme',
    // The absence is worth a page of its own: "we followed 42 first-years and
    // could read the minutes for three of them" is a fact about this
    // programme's published record that a reader should see stated.
    unavailableWhenEmpty: true,
    applies: ({ model }) => (model.lifecycle?.development?.players ?? 0) > 0,
    scopeOf: ({ model }) => {
      const d = model.lifecycle.development;
      return [
        `${d.players} first-years followed`,
        d.minutesCoverage.readable
          ? `${d.everStarter.reached} of ${d.everStarter.denominator} reached a starter’s season`
          : 'minutes not published widely enough to quote a share',
      ];
    },
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

  {
    id: 'roster-continuity',
    title: 'Roster continuity',
    description: 'How often players who could return appear on the next roster, and what the '
      + 'departures are made of.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: false,
    // A transition is only readable where BOTH rosters are on file, so a
    // programme with one season and nothing to compare it against gets no page
    // rather than a page reporting a mass exodus that is a gap in the data.
    applies: ({ model }) => (model.lifecycle?.continuity?.returnable ?? 0) > 0,
    scopeOf: ({ model }) => {
      const c = model.lifecycle.continuity;
      return [
        `${c.returnable} chances to return`,
        c.retention == null ? 'too few to quote a rate'
          : `${c.returned} came back`,
      ];
    },
  },
  {
    id: 'observed-destinations',
    title: 'Where we can trace players next',
    description: 'The departures whose next programme can be identified from roster data, and how '
      + 'few of them that is.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: false,
    // Gated in the model, not here: `destinationGate` names which of the three
    // conditions closed the page, and a test can assert on the reason rather
    // than on the absence.
    applies: ({ model }) => Boolean(model.lifecycle?.departures?.gate?.allowed),
    scopeOf: ({ model }) => {
      const d = model.lifecycle.departures;
      return [
        `${d.tracing.observed} of ${d.departures.total} departures traced`,
        `${Math.round(100 * d.tracing.coverage)}% coverage`,
      ];
    },
  },

  // -- Layer 4: athlete evidence -------------------------------------------
  //
  // Declared in the order the document draws them, because `planSections`
  // hands the model a `sections` array and a reader of that array should not
  // have to sort it to learn what comes first.
  {
    id: 'athlete-current-position',
    title: 'Who is at your position now',
    description: 'The current roster at the athlete’s position, read against their entry year.',
    layer: 'athlete-evidence',
    scope: 'athlete',
    unavailableWhenEmpty: false,
    applies: ({ summary }) => count(summary?.athlete?.currentPositionPlayers) > 0,
    scopeOf: ({ summary }) => {
      const a = summary.athlete;
      return [
        `${count(a.currentPositionPlayers)} on the roster`,
        `${count(a.currentPlayersEligibleAtEntry)} eligible in ${a.entrySeason}`,
      ];
    },
  },
  {
    id: 'athlete-entry-window',
    title: 'Your arrival window',
    description: 'The current playing-time load around the athlete’s entry season.',
    layer: 'athlete-evidence',
    scope: 'athlete',
    unavailableWhenEmpty: false,
    applies: ({ summary }) => count(summary?.athlete?.currentPositionPlayers) > 0,
    scopeOf: ({ summary }) => {
      const a = summary.athlete;
      return [
        `${count(a.currentPlayersInFinalSeasonAtEntry)} in a final season in ${a.entrySeason}`,
      ];
    },
  },
  {
    id: 'athlete-position-openings',
    title: 'When your position opens',
    description: 'Every season a starter left the athlete’s position, and what followed it.',
    layer: 'athlete-evidence',
    scope: 'athlete',
    // The absence is the finding: "no starter has left this position" is a
    // complete answer, and a reader should not have to notice a missing page.
    unavailableWhenEmpty: true,
    applies: ({ summary }) => (summary?.athlete?.positionVacancyHistory?.transitions ?? 0) > 0,
    scopeOf: ({ summary }) => {
      const v = summary.athlete.positionVacancyHistory;
      return [`${v.openings} of ${v.transitions} transitions opened a place`];
    },
  },
  {
    id: 'athlete-position-history',
    title: 'Your position, historically',
    description: 'First-years, experienced arrivals and minute shares at the athlete’s position only.',
    layer: 'athlete-evidence',
    scope: 'athlete',
    unavailableWhenEmpty: false,
    applies: ({ summary }) => {
      const a = summary?.athlete;
      if (!a) return false;
      return a.positionFreshmanHistory.measured > 0
        || a.experiencedArrivalsAtPosition.measured > 0
        || (a.positionOpeningOutcomes?.dials?.n ?? 0) > 0;
    },
    scopeOf: ({ summary }) => {
      const a = summary.athlete;
      return [
        `${a.positionFreshmanHistory.measured} first-years`,
        `${a.experiencedArrivalsAtPosition.measured} experienced arrivals`,
      ];
    },
  },
  {
    id: 'athlete-origin',
    title: 'Where you are arriving from',
    description: 'Whether first-years from the same background have played here.',
    layer: 'athlete-evidence',
    scope: 'athlete',
    unavailableWhenEmpty: false,
    applies: ({ summary }) => {
      const o = summary?.athlete?.originContext;
      return Boolean(o?.requestedOrigin)
        && (o.programme.withRecordedOrigin > 0 || Boolean(o.pool));
    },
    scopeOf: ({ summary }) => {
      const o = summary.athlete.originContext;
      return [
        `${o.programme.sameOrigin.players} of ${o.programme.withRecordedOrigin} share this background`,
      ];
    },
  },

  {
    id: 'athlete-position-movement',
    title: 'Players at your position we could trace',
    description: 'Where players at the athlete’s position were seen next, when they could be seen '
      + 'at all.',
    layer: 'athlete-evidence',
    // Demoted to the supporting record where the position's own sample is a
    // handful of players. The page sets itself quiet for the same reason, and
    // the contents must not then file it under a heading the page disowns.
    layerOf: ({ model }) => {
      const p = model.lifecycle?.athletePosition;
      return (p?.positionRows?.length ?? 0) < MIN_POSITION_DESTINATIONS
        ? 'supporting' : 'athlete-evidence';
    },
    scope: 'athlete',
    unavailableWhenEmpty: false,
    // Only where there is something at the athlete's OWN position to show.
    // Broadened to the programme with nothing of their own, the page would be
    // three sentences pointing at two other pages, which is filler.
    applies: ({ model }) => {
      const p = model.lifecycle?.athletePosition;
      if (!p) return false;
      return p.group === 'position' ? p.rows.length > 0 : p.positionRows.length > 0;
    },
    scopeOf: ({ model }) => {
      const p = model.lifecycle.athletePosition;
      return [
        p.group === 'position'
          ? `${p.atPositionObserved} traced at this position`
          : `${p.atPositionObserved} of ${p.atPositionDepartures} traced at this position`,
      ];
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
    // Only worth a page where the table carries names the charts do not. A
    // handful of players are already individually visible as dots.
    applies: ({ model }) => count(model.freshman?.points) >= 6,
    scopeOf: ({ model }) => [`${model.freshman.points.length} rows`],
  },
  {
    id: 'table-experienced-arrivals',
    title: 'Every experienced arrival measured',
    description: 'The rows behind the experienced-arrival charts, with previous programmes where recorded.',
    layer: 'supporting',
    scope: 'programme',
    unavailableWhenEmpty: false,
    applies: ({ model }) => count(model.transfer?.points) >= 6,
    scopeOf: ({ model }) => [`${model.transfer.points.length} rows`],
  },
  {
    id: 'table-vacancies',
    title: 'Every opening observed',
    description: 'Each position-season a starter left, and what followed — the evidence behind the replacement analysis.',
    layer: 'supporting',
    scope: 'programme',
    // Always worth including where openings exist: these events appear nowhere
    // else in full, and they are what the replacement pages are built on.
    unavailableWhenEmpty: false,
    applies: ({ summary }) => count(summary?.programme?.replacementBehaviour?.record) > 0,
    scopeOf: ({ summary }) => [
      `${count(summary.programme.replacementBehaviour.record)} openings`,
    ],
  },
  {
    id: 'table-destinations',
    title: 'Every traced move',
    description: 'The departures whose next programme could be identified — the rows behind the '
      + 'destination analysis.',
    layer: 'supporting',
    scope: 'programme',
    unavailableWhenEmpty: false,
    // Tied to the same gate as the analysis page. A list of names with no page
    // explaining what a traced move is, and how few there are, would be the
    // one part of this analysis a reader could over-read.
    applies: ({ model }) => Boolean(model.lifecycle?.departures?.gate?.allowed)
      && count(model.lifecycle?.departures?.named) > 0,
    scopeOf: ({ model }) => [`${count(model.lifecycle.departures.named)} traced moves`],
  },
  {
    id: 'methodology',
    title: 'Methodology and limitations',
    description: 'How every figure in this report was worked out, and where it stops being reliable.',
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
        // A section may move layer on the evidence it turns out to have: the
        // athlete's position movement is athlete evidence when the position
        // carries a sample and supporting detail when it is one player.
        layer: (() => { try { return s.layerOf?.(ctx) ?? s.layer; } catch { return s.layer; } })(),
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
