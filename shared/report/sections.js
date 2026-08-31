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

/**
 * The acts, and the order they run in.
 *
 * An athlete report is three acts: what this history shows around the
 * athlete's own position and entry year, then how the programme has built and
 * used its squad, then the named records underneath both. A programme report
 * has no pathway to open with, so it keeps the order it has always had.
 *
 * The blurb is the answer to "why are you now showing me all of this", and it
 * is drawn once, at the top of the first page of the act.
 */
export const ACTS = Object.freeze({
  athlete: [
    { id: 'navigation', title: 'Contents' },
    { id: 'pathway',
      title: 'Understanding your pathway',
      blurb: 'What this programme’s record shows around this position, this entry year and the '
        + 'squad currently on the roster.' },
    { id: 'programme-evidence',
      title: 'Understanding the programme',
      blurb: 'Your position sits inside a wider squad-building strategy. These pages show how this '
        + 'programme has historically recruited, developed, retained and replaced players across '
        + 'the whole roster.' },
    { id: 'supporting',
      title: 'The evidence behind it',
      blurb: 'The pages before this told you what the evidence says. These show you the evidence '
        + 'itself — named players, actual seasons, actual minutes, observed openings and observed '
        + 'destinations.' },
  ],
  programme: [
    { id: 'navigation', title: 'Contents' },
    { id: 'interpretation', title: 'At a glance' },
    { id: 'programme-evidence',
      title: 'The programme',
      blurb: null },
    { id: 'supporting',
      title: 'The evidence behind it',
      blurb: 'The pages before this told you what the evidence says. These show you the evidence '
        + 'itself — named players, actual seasons, actual minutes and observed openings.' },
  ],
});

/** The acts this report has, in order. */
export const actsFor = ({ hasAthlete }) => (hasAthlete ? ACTS.athlete : ACTS.programme);
export const actTitle = (id, { hasAthlete }) => actsFor({ hasAthlete })
  .find((a) => a.id === id)?.title ?? id;

import { pathwayNarrative } from './narrative.js';

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
  // -- Act I: the summary this report opens with -----------------------------
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
    title: 'Your pathway at this programme',
    titleOf: ({ model }) => `Your pathway at ${model.college?.name ?? 'this programme'}`,
    description: 'How this programme’s history, this position, the entry year and the current '
      + 'roster intersect.',
    layer: 'interpretation',
    scope: 'athlete',
    // The spine of an athlete report: it renders wherever the synthesis has a
    // sentence to say. The old rule asked whether the four cards this page
    // used to carry had data, and those cards are pages of their own now — a
    // sparse programme was losing the one page that reads its analyses
    // together while keeping the pages it reads FROM.
    unavailableWhenEmpty: false,
    // The summary is a sibling of the model in this context and a field on it
    // in the route's payload. Joined here so the predicate does not depend on
    // which of the two a caller happens to hand it.
    applies: (ctx) => Boolean(ctx.summary?.athlete)
      && pathwayNarrative({ ...ctx.model, summary: ctx.summary }).length > 0,
    scopeOf: ({ summary }) => [
      count(summary.athlete?.currentPositionPlayers)
        ? `${count(summary.athlete.currentPositionPlayers)} currently at the position` : null,
      summary.athlete?.positionVacancyHistory?.transitions
        ? `${summary.athlete.positionVacancyHistory.transitions} position-seasons` : null,
    ].filter(Boolean),
  },

  // -- Act I, continued: the athlete's own pathway --------------------------
  //
  // Declared before the programme evidence because an athlete report runs in
  // that order: what this history shows around one position and one entry
  // year, and only then how the squad as a whole has been built. A programme
  // report filters every one of these out and is left with exactly the order
  // it has always had.
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
    id: 'athlete-position-record',
    title: 'What this position has looked like here',
    description: 'How often this programme has added players at the athlete’s position, and how '
      + 'far the minutes at it have reached.',
    layer: 'athlete-evidence',
    scope: 'athlete',
    // Two independent histories on one page. It renders where EITHER half has
    // something to say, which is what keeps a goalkeeper's page whole (the
    // intake reads, the minute distribution is not reported for them) and what
    // keeps a sparse programme's page whole (the intake reads, the minutes do
    // not).
    unavailableWhenEmpty: false,
    applies: ({ model }) => {
      const intake = model.pressure?.athletePosition ?? null;
      const util = model.positionUtilisation?.athletePosition ?? null;
      return Boolean(intake && !intake.historical.suppressed)
        || Boolean(util?.available)
        // One season on file, or a current intake and no history: NAIA, where
        // the acquisition reaches a single season. Worth a page that says so.
        || Boolean(util?.singleSeasonObservation)
        || Boolean(intake?.current?.readable && intake.current.totalIncoming != null);
    },
    scopeOf: ({ model }) => {
      const intake = model.pressure?.athletePosition ?? null;
      const util = model.positionUtilisation?.athletePosition ?? null;
      return [
        intake && !intake.historical.suppressed
          ? plural(intake.historical.cyclesWithReadableRosterPresence, 'recruiting cycle')
          : (intake?.current?.readable ? 'the coming season only' : null),
        util?.available ? `${plural(util.readableSeasons, 'season')} of position minutes`
          : (util?.singleSeasonObservation ? 'one season of position minutes' : null),
      ].filter(Boolean);
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


  // -- Act II: the programme's own record ------------------------------------
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
          // Short enough for the contents line, which draws on one line.
          : `minutes for ${d.minutesCoverage.measured} of ${d.minutesCoverage.playerSeasons} seasons`,
      ];
    },
  },
  {
    id: 'squad-usage',
    title: 'How this programme uses its squad',
    description: 'How widely meaningful minutes have been spread across the roster, and which '
      + 'years of study carried them.',
    layer: 'programme-evidence',
    scope: 'programme',
    // Two independent models on one page, because either alone reads wrongly:
    // a narrow distribution carried by fourth years and one carried by second
    // years are different programmes. It renders where either half can be
    // read, which is what keeps the page at a programme whose minutes are
    // unreadable but whose roster is not.
    unavailableWhenEmpty: false,
    applies: ({ model }) => {
      const s2 = model.squadProfile;
      return Boolean(s2?.utilisation?.available)
        || Boolean(s2?.utilisation?.singleSeasonObservation)
        || Boolean(s2?.experience?.compositionAvailable)
        || Boolean(s2?.experience?.singleSeasonObservation);
    },
    scopeOf: ({ model }) => {
      const u = model.squadProfile?.utilisation;
      const e = model.squadProfile?.experience;
      return [
        u?.available ? plural(u.seasonsObserved, 'season')
          : (u?.singleSeasonObservation ? 'one season on file' : null),
        e?.loadAvailable ? 'minutes by year of study'
          : (e?.compositionAvailable || e?.singleSeasonObservation
            ? 'roster by year of study' : null),
      ].filter(Boolean);
    },
  },
  {
    id: 'experienced-arrival-intake',
    // Folded into `evidence-limits` when it is one of two or more refusals.
    absorbedWhenRefused: true,
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
    absorbedWhenRefused: true,
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

  {
    id: 'evidence-limits',
    title: 'Where the evidence runs out',
    description: 'The analyses attempted here that the published record could not support, and '
      + 'what none of them should be read to mean.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: false,
    // Two or more. A single refusal is better said on the page that made it,
    // where the reader is already asking that question; it is the pile of them
    // that turns a thorough assessment into a list of things we cannot do.
    applies: ({ model }) => count(model.evidenceLimits) >= 2,
    scopeOf: ({ model }) => [`${count(model.evidenceLimits)} analyses refused`],
  },

  // -- Act III: the record underneath both ------------------------------------
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
  // Sections whose own page would say nothing but "we could not measure this",
  // where the consolidated page is being drawn and is saying it for them. The
  // gate that refused them is untouched; only where the refusal is printed
  // changes, and the consolidated page states each one in more detail than the
  // page it replaces did.
  const consolidating = count(model?.evidenceLimits) >= 2;
  const absorbed = new Set(consolidating
    ? (model.evidenceLimits ?? []).map((x) => x.id) : []);

  const planned = SECTIONS
    .filter((s) => !(s.absorbedWhenRefused && absorbed.has(s.id)))
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
        title: (() => {
          try { return s.titleOf?.(ctx) ?? s.title; } catch { return s.title; }
        })(),
        description: s.description,
        // A section may move layer on the evidence it turns out to have: the
        // athlete's position movement is athlete evidence when the position
        // carries a sample and supporting detail when it is one player.
        layer: (() => { try { return s.layerOf?.(ctx) ?? s.layer; } catch { return s.layer; } })(),
        // The act it is filed under, which is a different question: on an
        // athlete report the glance page and every athlete page are one act,
        // and on a programme report the glance page is its own.
        act: (() => {
          const layer = (() => {
            try { return s.layerOf?.(ctx) ?? s.layer; } catch { return s.layer; }
          })();
          if (layer === 'supporting') return 'supporting';
          if (layer === 'programme-evidence') return 'programme-evidence';
          return hasAthlete ? 'pathway' : 'interpretation';
        })(),
        scope: s.scope,
        // The renderer fills this in once the section has been laid out; the
        // plan states the field so the shape is stable either way.
        page: null,
        scopeNotes: scope,
        showsUnavailableState: Boolean(s.unavailableWhenEmpty),
      };
    });

  return inActOrder(planned, hasAthlete);
}

/**
 * The same plan, grouped into layers, with empty layers dropped.
 *
 * A layer heading over nothing reads as a section that failed to render.
 */
/**
 * The plan in the order the document draws it.
 *
 * A section's ACT can be decided by its evidence — the athlete's position
 * movement is filed with the pathway when the position carries a sample and
 * with the supporting record when it is one player — so the registry's
 * declaration order is not always the running order. Sorting by act here is
 * what keeps `model.sections` a description of the document rather than of the
 * file it was declared in.
 */
function inActOrder(plan, hasAthlete) {
  const rank = new Map(actsFor({ hasAthlete }).map((a, i) => [a.id, i]));
  return [...plan]
    .map((s, i) => ({ s, i }))
    .sort((x, y) => (rank.get(x.s.act) ?? 99) - (rank.get(y.s.act) ?? 99) || x.i - y.i)
    .map(({ s }, i) => ({ ...s, order: i + 1 }));
}

export function planByLayer(plan) {
  return LAYERS
    .map((layer) => ({ ...layer, sections: plan.filter((s) => s.layer === layer.id) }))
    .filter((layer) => layer.sections.length > 0);
}

/** The same plan, grouped into the acts the document actually runs in. */
export function planByAct(plan, { hasAthlete }) {
  return actsFor({ hasAthlete })
    .map((act) => ({ ...act, sections: plan.filter((s) => s.act === act.id) }))
    .filter((act) => act.sections.length > 0);
}
