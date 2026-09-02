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
import { decisionFindings } from './decisionLayer.js';
import { staffQuestions } from './staffQuestions.js';

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
    /**
     * The two readings, in their own act since 13F.
     *
     * They were filed under "Understanding your pathway" alongside the athlete
     * pages, which put the PROGRAMME's decision layer under a heading claiming
     * it was about the reader's pathway. Two readings and then the pathway is
     * what the document does; the contents now says so.
     */
    { id: 'interpretation', title: 'At a glance' },
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
      title: 'Programme intelligence',
      blurb: null },
    { id: 'supporting',
      title: 'The evidence behind it',
      blurb: 'The pages before this told you what the evidence says. These show you the evidence '
        + 'itself — named players, actual seasons, actual minutes and observed openings.' },
  ],
});

/**
 * The reader-facing groups the programme act is read in.
 *
 * NOT A FOURTH ACT, and not a layer. The acts are the document's structure and
 * they are drawn as dividers; these are the narrative groups the contents page
 * lists a section under, so that sixteen modules read as five questions. A
 * section names its group; a group with no section in it never appears.
 *
 * Ordering here IS the order the programme act is drawn in. `planSections`
 * sorts by act and then by group, so moving a group moves the pages.
 */
export const NARRATIVE_GROUPS = Object.freeze([
  { id: 'frame', title: 'Where you would be competing' },
  { id: 'pathway', title: 'Getting on the pitch' },
  { id: 'construction', title: 'How the squad is built' },
  { id: 'opportunity', title: 'Where openings come from' },
  { id: 'record', title: 'What the programme has recorded' },
  { id: 'limits', title: 'Where the evidence runs out' },
]);

const GROUP_RANK = new Map(NARRATIVE_GROUPS.map((g, i) => [g.id, i]));
export const groupTitle = (id) => NARRATIVE_GROUPS.find((g) => g.id === id)?.title ?? null;

/** The acts this report has, in order. */
export const actsFor = ({ hasAthlete }) => (hasAthlete ? ACTS.athlete : ACTS.programme);
export const actTitle = (id, { hasAthlete }) => actsFor({ hasAthlete })
  .find((a) => a.id === id)?.title ?? id;

import { athleteDecisionFindings } from './athleteDecisionLayer.js';

/**
 * Does the origin page have anything of this programme's OWN to say?
 *
 * The same two conditions the page itself branches on, in one place, because
 * the registry decides where the page sits and the running order decides where
 * it is drawn — and those two answers disagreeing is how a section ends up
 * listed in one act and printed in another.
 */
export function originIsProgrammeSpecific(originContext) {
  const o = originContext;
  return Boolean(o?.evidence?.sufficient) && o.programme?.sameOrigin?.share != null;
}

/**
 * Is the experienced-arrivals section a single finding rather than a page?
 *
 * Two of its three branches are one box: no season can be compared with the
 * one before it, or nothing but first-years arrived across every season that
 * could be. Both are valid findings and neither is deleted — but a title, a
 * scope line and one box is not a page, and at a sparse programme it was
 * taking one. The third branch draws a scatter of every arrival and a
 * two-population column chart, and never qualifies.
 */
/**
 * Is there a competitive ENVIRONMENT to draw, or only a record?
 *
 * 229 programmes carry a full four-season record and no historical conference
 * or division at all. For them the environment page would be a title and four
 * refusals — so the page is not planned, and the history page states those
 * absences instead. Declared here, beside the other two shape questions, so the
 * registry and the page cannot answer it differently: a section listed in the
 * contents and never printed, or an absence stated on neither page, is what two
 * answers produce.
 */
export function competitiveEnvironmentIsWorthAPage(pkg) {
  if (!pkg?.available) return false;
  return (pkg.coverage?.membershipKnown ?? 0) > 0 || (pkg.coverage?.divisionKnown ?? 0) > 0;
}

export function arrivalsAreOneFinding(model) {
  const e = model?.summary?.programme?.experiencedArrivalReliance;
  if (!e) return false;
  return !e.measurable || e.density === 'none';
}

const count = (x) => (Array.isArray(x) ? x.length : 0);
const model_seasons = (m) => (m?.seasons?.length
  ? `${plural(m.seasons.length, 'season')} analysed` : null);
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
  // -- Act I: the two readings the report opens with ------------------------
  //
  // The athlete's own findings are declared first because they are drawn
  // first: `planSections` hands the model a `sections` array, and a reader of
  // that array should not have to sort it to learn what comes first. On a
  // programme report the athlete entry is filtered out and the programme layer
  // is the first thing after the cover, exactly as it was.
  {
    id: 'athlete-at-a-glance',
    /**
     * THE ATHLETE DECISION LAYER, and page two of an athlete report — 13F.
     *
     * It used to be page THREE, behind the programme's own decision layer, and
     * it used to be five paragraphs of prose. Every sentence in that prose is
     * now a ranked finding with a metric and a page reference, drawn by the
     * same row the programme layer uses — the analysis did not change, the
     * form and the order did.
     *
     * It always renders. A position with nothing readable says so, which is
     * itself the most important thing that could be said about it.
     */
    title: 'What Thriv3 sees for you',
    description: 'The findings this programme’s record supports for this position and this entry '
      + 'year, most consequential first.',
    layer: 'interpretation',
    scope: 'athlete',
    unavailableWhenEmpty: true,
    applies: (ctx) => Boolean(ctx.summary?.athlete),
    scopeOf: (ctx) => {
      const { findings } = athleteDecisionFindings({ ...ctx.model, summary: ctx.summary });
      return [
        findings.length ? plural(findings.length, 'finding') : 'no finding clears the evidence',
        count(ctx.summary.athlete?.currentPositionPlayers)
          ? `${count(ctx.summary.athlete.currentPositionPlayers)} currently at the position` : null,
      ].filter(Boolean);
    },
  },

  {
    id: 'programme-at-a-glance',
    /**
     * THE DECISION LAYER, and the title says what it is rather than how much
     * of it there is. "Programme at a glance" described a dashboard; this page
     * is the report's own ranked reading of its evidence, and a reader who
     * takes one page should take this one.
     */
    title: 'What Thriv3 sees',
    /**
     * And the contents calls it what the page calls itself — 13G / §W.
     *
     * The page has been retitled "What Thriv3 sees about the programme" inside
     * an athlete report since 13F, while the contents kept the programme
     * report's shorter title. Two names for page three, one of them only on
     * the map. Presentation only: the same section, the same order, the same
     * ranking.
     */
    titleOf: ({ model }) => (model?.athlete ? 'What Thriv3 sees about the programme' : 'What Thriv3 sees'),
    description: 'The findings this report rests on, most consequential first, each pointing at '
      + 'the page that carries its evidence.',
    layer: 'interpretation',
    scope: 'programme',
    // Always renders. A programme with no finding that clears the evidence
    // needed to lead a report has that stated, which is itself a real thing to
    // have learned about the record.
    unavailableWhenEmpty: true,
    applies: () => true,
    /**
     * How many findings the ranking selected, and out of how many candidates
     * it considered. Deliberately the counts rather than the categories: the
     * contents page is a map, and a reader who wants to know WHICH findings
     * turns to the page itself.
     */
    scopeOf: (ctx) => {
      const { findings } = decisionFindings({ ...ctx.model, summary: ctx.summary });
      return [
        findings.length ? plural(findings.length, 'finding') : 'no finding clears the evidence',
        model_seasons(ctx.model),
      ].filter(Boolean);
    },
  },
  {
    id: 'programme-snapshot',
    title: 'Programme snapshot',
    description: 'What was measured, over how many seasons, and how complete the record behind '
      + 'the findings is.',
    layer: 'interpretation',
    scope: 'programme',
    // Orientation is never unavailable: a programme with nothing on file has a
    // snapshot of dashes, and a dash there is the finding.
    unavailableWhenEmpty: true,
    applies: () => true,
    scopeOf: ({ model }) => [
      model_seasons(model),
      model.squad?.rostered ? `${plural(model.squad.rostered, 'player')} on the current roster` : null,
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
    /**
     * ONE QUESTION, ONE SECTION — 13F / §11.
     *
     * "Who is at your position now" and "Your arrival window" were consecutive
     * pages answering one question, and the first page's four opening facts
     * were the second page's three eligibility bands restated. They are one
     * section now: the bands with their names, then every player in the group.
     * Nothing is dropped — the coverage note, the primary limitation and the
     * non-forecast language all survive — and the section is allowed to flow
     * onto a second sheet where seventeen players need one.
     */
    title: 'Your position, and the timing around your arrival',
    description: 'The current roster at the athlete’s position, the eligibility timing attached to '
      + 'it, and the playing-time load those players hold.',
    layer: 'athlete-evidence',
    scope: 'athlete',
    unavailableWhenEmpty: false,
    applies: ({ summary }) => count(summary?.athlete?.currentPositionPlayers) > 0,
    scopeOf: ({ summary }) => {
      const a = summary.athlete;
      return [
        `${count(a.currentPositionPlayers)} on the roster`,
        `${count(a.currentPlayersBeyondEntry)} eligible beyond ${a.entrySeason}`,
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
    /**
     * ONE POSITION RECORD — 13F / §14.
     *
     * "What this position has looked like here" carried the intake and the
     * minute reach; "Your position, historically" carried the first-years, the
     * experienced arrivals and the minute mix at the same position. Two pages,
     * one question. They are one section now, allowed to continue onto a second
     * sheet where the evidence is rich, and the minute mix is drawn once —
     * 13E found it on three surfaces.
     */
    title: 'What this position has looked like here',
    description: 'How often this programme adds players at the athlete’s position, how far the '
      + 'minutes at it reach, and how first-years and experienced arrivals at it have been used.',
    layer: 'athlete-evidence',
    scope: 'athlete',
    // Two independent histories on one page. It renders where EITHER half has
    // something to say, which is what keeps a goalkeeper's page whole (the
    // intake reads, the minute distribution is not reported for them) and what
    // keeps a sparse programme's page whole (the intake reads, the minutes do
    // not).
    unavailableWhenEmpty: false,
    applies: ({ model, summary }) => {
      const intake = model.pressure?.athletePosition ?? null;
      const util = model.positionUtilisation?.athletePosition ?? null;
      const a = summary?.athlete;
      return Boolean(intake && !intake.historical.suppressed)
        || Boolean(util?.available)
        // One season on file, or a current intake and no history: NAIA, where
        // the acquisition reaches a single season. Worth a page that says so.
        || Boolean(util?.singleSeasonObservation)
        || Boolean(intake?.current?.readable && intake.current.totalIncoming != null)
        // The absorbed half: first-years and arrivals at this position.
        || Boolean(a && (a.positionFreshmanHistory.measured > 0
          || a.experiencedArrivalsAtPosition.measured > 0));
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
  /**
   * `athlete-position-history` was absorbed into `athlete-position-record` in
   * Phase 13F. It carried the first-years, the experienced arrivals and the
   * minute mix at the athlete's position; that is the second half of the same
   * question the record section asks, and two pages made a reader hold one
   * position's story across a page turn.
   */
  {
    id: 'athlete-origin',
    title: 'Where you are arriving from',
    description: 'Whether first-years from the same background have played here.',
    scope: 'athlete',
    unavailableWhenEmpty: false,
    applies: ({ summary }) => {
      const o = summary?.athlete?.originContext;
      return Boolean(o?.requestedOrigin)
        && (o.programme.withRecordedOrigin > 0 || Boolean(o.pool));
    },
    /**
     * PINNED TO THE PATHWAY ACT — 13F / §20.
     *
     * It used to move: where the programme's own origin sample did not clear
     * the cohort gate, `layerOf` filed it with the supporting record on the
     * grounds that a pool comparison is not a pathway finding. At four of the
     * five programmes audited in 13E that put "Where you are arriving from"
     * after every evidence table — page 26 of 28 at Adams State.
     *
     * The premise was wrong for the reader it matters to. For an international
     * athlete the REFUSAL is decision-relevant: "five international first-years
     * on file here, which is not enough to compare by origin" is a fact about
     * their pathway, and it belongs where they will read it. The page is
     * unchanged — the relaxation disclosure, the refusal thresholds, the
     * pool-versus-programme distinction and the never-by-nationality rule all
     * stay exactly as they are.
     */
    layer: 'athlete-evidence',
    scopeOf: ({ summary }) => {
      const o = summary.athlete.originContext;
      return [
        `${o.programme.sameOrigin.players} of ${o.programme.withRecordedOrigin} share this background`,
        originIsProgrammeSpecific(o) ? null : 'pool context only',
      ].filter(Boolean);
    },
  },

  {
    id: 'athlete-staff-questions',
    /**
     * WHAT TO VERIFY WITH THE STAFF — 13H, and the report's only
     * decision-support surface.
     *
     * LAST IN THE PATHWAY ACT, and deliberately not in the evidence act: it is
     * not a record of anything. It reads the athlete's own analysis and turns
     * what the record cannot establish, plus what the current structure makes
     * worth clarifying, into questions somebody can ask out loud. The rule is
     * in docs/staff-questions.md.
     *
     * IT IS OMITTED AT ZERO, never drawn empty and never drawn with a line
     * saying there is nothing to verify. `unavailableWhenEmpty` is false for
     * exactly that reason: an "unavailable" state here would tell a reader the
     * programme is fully known, which is a claim no report makes.
     */
    title: 'What to verify with the staff',
    description: 'Questions this report’s own findings and limitations make worth asking, and the '
      + 'fact behind each one.',
    layer: 'athlete-evidence',
    scope: 'athlete',
    unavailableWhenEmpty: false,
    applies: ({ model }) => staffQuestions(model).questions.length > 0,
    scopeOf: ({ model }) => {
      const { questions } = staffQuestions(model);
      return [
        `${questions.length} ${questions.length === 1 ? 'question' : 'questions'}`,
        'each from a stated finding or limitation',
      ];
    },
  },


  // -- Act II: programme intelligence, in narrative order --------------------
  //
  // The order below IS the reading order, and it is grouped rather than listed:
  // where you would be competing, then how players get on the pitch, then how
  // the squad is built, then where openings come from, then what the programme
  // recorded. 13A found the previous order was a build log — each module
  // appended where it was finished — with the competitive frame arriving last,
  // after four pages of division-scoped benchmarks had already been read.

  // ---- Where you would be competing ----------------------------------------
  {
    id: 'competitive-environment',
    group: 'frame',
    title: 'The competition these seasons were played in',
    description: 'The division and the conference each measured season was played in, and the '
      + 'seasons in which either changed.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: false,
    /**
     * FIRST IN THE ACT, because it is the denominator for the act.
     *
     * Every pool comparison on the pages that follow is scoped to a division,
     * and at 32 programmes the division changes inside the measured window.
     * Mercyhurst men's played 2022–2023 in NCAA D2 and 2024–2025 in D1; read
     * last, as it was, a reader had already interpreted a four-season pattern
     * without knowing it spanned two competitions.
     */
    applies: ({ model }) => competitiveEnvironmentIsWorthAPage(model.competitive),
    scopeOf: ({ model }) => {
      const c = model.competitive.coverage;
      return [
        `conference on file for ${c.membershipKnown} of ${c.readableSeasons}`,
        `division on file for ${c.divisionKnown}`,
      ];
    },
  },

  // ---- Getting on the pitch ------------------------------------------------
  {
    id: 'freshman-opportunity',
    group: 'pathway',
    title: 'How much first-years actually play',
    description: 'How deep into a recruiting class real playing time has gone here, and how many '
      + 'first-years arrived and played in each season.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: false,
    /**
     * The intake page and the ladder page, merged.
     *
     * They plotted the same first-years on the same 0–1,600-minute axis with
     * the same 600-minute marker on consecutive pages, and both closed with the
     * same "at least one first-year played a starter's season in N of M
     * seasons". The ladder is the stronger view and leads; the intake survives
     * as the per-season counts, which is the context the ladder cannot carry.
     * The per-player scatter is not redrawn — every one of its dots is a named
     * row in the evidence act, with its origin.
     */
    applies: ({ model }) => has(model.ladder)
      || has(model.freshman?.points) || has(model.freshman?.intake),
    scopeOf: ({ model, summary }) => {
      const f = summary.programme.freshmanOpportunity;
      return [
        `${f.measuredFreshmen} first-years measured`,
        f.weightedAgrees === false ? 'coach-weighted view differs'
          : (model.ladder?.length ? `${Math.min(5, model.ladder.length)} ranks shown` : null),
      ].filter(Boolean);
    },
  },
  {
    id: 'player-development',
    group: 'pathway',
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
          : `minutes for ${d.minutesCoverage.measured} of ${d.minutesCoverage.playerSeasons} seasons`,
      ];
    },
  },

  // ---- How the squad is built ----------------------------------------------
  {
    id: 'squad-usage',
    group: 'construction',
    title: 'How this programme uses its squad',
    description: 'How widely meaningful minutes have been spread across the roster, and which '
      + 'years of study carried them.',
    layer: 'programme-evidence',
    scope: 'programme',
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
    id: 'experienced-arrivals',
    group: 'construction',
    // Folded into `evidence-limits` when it is one of two or more refusals.
    absorbedWhenRefused: true,
    title: 'Players brought in ready to play',
    description: 'How often this programme adds players who are not first-years, what they played, '
      + 'and at which positions.',
    layer: 'programme-evidence',
    scope: 'programme',
    /**
     * The arrivals page and the "who the arrivals are" page, merged — minus the
     * current-season half, which describes the roster on campus now rather than
     * historical behaviour and has moved to the current-squad page where the
     * projected-versus-played warning can do its work.
     */
    unavailableWhenEmpty: true,
    applies: () => true,
    scopeOf: ({ summary }) => {
      const e = summary.programme.experiencedArrivalReliance;
      if (!e.measurable) return ['no season can be compared with the one before it'];
      return [`${e.arrivals} arrivals across ${e.measurableSeasons.length} measurable seasons`];
    },
  },
  {
    id: 'roster-continuity',
    group: 'construction',
    title: 'Who stays, and who we can follow',
    description: 'How often players who could return appear on the next roster, what the '
      + 'departures are made of, and where the traceable few went.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: false,
    /**
     * Continuity and observed destinations, merged.
     *
     * Both described the same departure population and both printed the same
     * three-way split of it — traced, unsettled, no trace — on consecutive
     * pages. Continuity leads because it is the reliable half; destinations
     * follow as a block sized to their traceability, which at two of three
     * sampled programmes is a closed gate and no block at all.
     */
    applies: ({ model }) => (model.lifecycle?.continuity?.returnable ?? 0) > 0,
    scopeOf: ({ model }) => {
      const c = model.lifecycle.continuity;
      const d = model.lifecycle.departures;
      return [
        `${c.returnable} chances to return`,
        c.retention == null ? 'too few to quote a rate' : `${c.returned} came back`,
        d?.gate?.allowed ? `${d.tracing.observed} of ${d.departures.total} departures traced` : null,
      ].filter(Boolean);
    },
  },

  // ---- Where openings come from --------------------------------------------
  {
    id: 'replacing-minutes',
    group: 'opportunity',
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
    group: 'opportunity',
    title: 'Position by position',
    description: 'Whether what happens when a place comes free depends on the position.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: false,
    /**
     * KEPT as its own section and drawn as the second half of the replacement
     * story where there is room for it — 13A / §M. It answers a materially
     * distinct question (what happens at MY position, and which positions have
     * turned over at all) and the reader arrives at it having just been given
     * the whole-programme mix, so it reads as the breakdown of a figure rather
     * than as the figure again. It no longer restates the openings season by
     * season; the evidence act tabulates those properly.
     */
    applies: ({ model }) => (model.byPosition ?? []).some((p) => p.transitions > 0),
    scopeOf: ({ model }) => {
      const live = (model.byPosition ?? []).filter((p) => p.transitions > 0);
      return [`${live.length} of ${model.byPosition.length} positions readable`];
    },
  },
  {
    id: 'eligibility-outlook',
    group: 'opportunity',
    title: 'The squad you would be joining',
    description: 'When the playing-time load on the current roster reaches the end of its '
      + 'eligibility, and who has arrived for the coming season.',
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

  // ---- What the programme has recorded -------------------------------------
  {
    id: 'competitive-history',
    group: 'record',
    title: 'How this programme has competed',
    description: 'The win/draw/loss record for each season that can be read, the winning '
      + 'percentage it produced, and where that rate sat among the programmes measured in the '
      + 'same division and the same year.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: false,
    // A programme with no readable season gets no page. 27 programmes are in
    // that state and a page carrying four refusals and nothing else is not a
    // page.
    applies: ({ model }) => Boolean(model.competitive?.available),
    scopeOf: ({ model }) => {
      const c = model.competitive.coverage;
      return [
        `${c.readableSeasons} of ${c.expectedSeasons} seasons read`,
        c.benchmarkAvailable
          ? `${c.benchmarkAvailable} compared against its own division`
          : 'no season could be compared',
      ];
    },
  },

  // ---- Where the evidence runs out -----------------------------------------
  {
    id: 'evidence-limits',
    group: 'limits',
    title: 'Where the evidence runs out',
    description: 'The analyses attempted here that the published record could not support, and '
      + 'what none of them should be read to mean.',
    layer: 'programme-evidence',
    scope: 'programme',
    unavailableWhenEmpty: false,
    applies: ({ model }) => count(model.evidenceLimits) >= 2,
    scopeOf: ({ model }) => [`${count(model.evidenceLimits)} analyses refused`],
  },

  // -- Act III: the record underneath both ------------------------------------
  {
    id: 'current-depth',
    title: 'The current squad in full',
    description: 'Every player on the roster now, with class, projected minutes and eligibility.',
    layer: 'supporting',
    scope: 'programme',
    unavailableWhenEmpty: false,
    /**
     * MOVED OUT OF THE NARRATIVE — 13A / §J.
     *
     * 59 rows over two pages, printed between the current-squad outlook and the
     * continuity story: the two densest pages in the report interrupting the
     * argument they support. It is the page a family returns to and the page
     * that proves the outlook is not invented, and both of those jobs are done
     * from the evidence act. The outlook page points at it.
     */
    applies: ({ model }) => (model.squad?.rostered ?? 0) > 0,
    scopeOf: ({ model }) => [`${model.squad.rostered} players`],
  },
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
        // The narrative group the contents lists this section under. Null for
        // the acts that are not grouped — navigation, the glance, the athlete
        // pathway and the supporting record all read as one run each.
        group: s.group ?? null,
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
          // The two decision layers are their own act on both report kinds.
          // Only the athlete's own analysis pages belong to the pathway.
          if (layer === 'interpretation') return 'interpretation';
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
  // Act, then narrative group, then declaration order. The group rank is what
  // makes the programme act read as five questions rather than as the order the
  // modules were built in; an ungrouped section keeps its declared place.
  const groupRank = (s) => (s.group != null ? GROUP_RANK.get(s.group) ?? 98 : 98);
  return [...plan]
    .map((s, i) => ({ s, i }))
    .sort((x, y) => (rank.get(x.s.act) ?? 99) - (rank.get(y.s.act) ?? 99)
      || groupRank(x.s) - groupRank(y.s) || x.i - y.i)
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
