/**
 * The Program Intelligence Report: the running order, and nothing else.
 *
 * Five layers. The contents page, the two at-a-glance pages that interpret,
 * the programme evidence the interpretation was drawn from, the same evidence
 * narrowed to one athlete, and the supporting record with the methodology.
 *
 * This file decides WHICH sections exist and WHERE each one starts. It draws
 * nothing itself: every page lives in reportFront, reportEvidence,
 * reportAthlete or reportAppendix, and every number comes from `model.summary`.
 * It used to also carry four hundred lines of the previous report's own
 * sections, unreachable since the evidence layer replaced them page for page.
 *
 * Written for the athlete and their family. Two rules run through every page.
 * Nothing here is a forecast — the season being recruited into has not been
 * played, and the document says so on page one at full size. And every absence
 * states its reason: a chart handed no data and no reason throws rather than
 * drawing an empty axis, because an empty axis reads as a confident zero.
 */
import { render, footer } from './philosophyPdf.js';
import { contentsPage, programmeAtAGlance, athletePathwayPage } from './reportFront.js';
import {
  actsFor, originIsProgrammeSpecific, arrivalsAreOneFinding,
} from '../../shared/report/sections.js';
import {
  freshmanOpportunityPage, experiencedArrivalsPage,
  replacingMinutesPage, replacementByPositionPage,
  currentSquadOutlookPage, currentDepthPage,
} from './reportEvidence.js';
import {
  positionHistoryPage, positionOpeningsPage, currentPositionPage,
  arrivalWindowPage, originPage,
} from './reportAthlete.js';
import {
  playerDevelopmentPage, rosterContinuityPage,
  athletePositionMovementPage,
} from './reportLifecycle.js';
import {
  freshmanRecordPage, arrivalRecordPage, vacancyRecordPage, destinationRecordPage,
  methodologyPage,
} from './reportAppendix.js';
import { evidenceLimitsPage } from './reportLimits.js';
import { competitiveHistoryPage, competitiveEnvironmentPage } from './reportCompetitive.js';
import { positionRecordPage } from './reportPosition.js';
import { squadUsagePage } from './reportSquadUsage.js';
import { athletePositionIsStrong } from '../../shared/report/lifecycleSummary.js';

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export function renderProgramReport(model, opts = {}) {
  return render((k) => {
    const c = model.college;
    const a = model.athlete;
    const plan = model.sections ?? [];

    /**
     * Where each section actually started.
     *
     * `bufferedPageRange().count` is the number of pages that exist, so while
     * the document is written forward it is also the 1-based index of the page
     * being written. `atNext` records the page a section is ABOUT to open,
     * which is what the evidence pages need: each one begins by adding a page
     * of its own.
     */
    const pages = new Map();
    // Written back onto the plan as well as into the map. `planSections` states
    // `page: null` as "the renderer fills this in once the section has been
    // laid out", and until now nothing did — so the field was permanently null
    // and the only place the real numbers existed was inside this closure.
    const record = (id, n) => {
      pages.set(id, n);
      const entry = plan.find((x) => x.id === id);
      if (entry) entry.page = n;
    };
    const at = (id) => record(id, k.doc.bufferedPageRange().count);
    const atNext = (id) => record(id, k.doc.bufferedPageRange().count + 1);

    /**
     * Render a section only where the registry says it has something to say.
     *
     * The plan decides, not the page: a section that discovers its own
     * emptiness has already opened a page by the time it finds out, and an
     * empty page is exactly what the dynamic-page rule exists to prevent.
     */
    const planned = new Set(plan.map((x) => x.id));
    /**
     * @param flow - draw beneath the section above rather than on a page of
     * its own. The section still records a page and still appears in the
     * contents; it records the page it is CONTINUING on rather than the next
     * one, which is the only difference the rest of this function needs to
     * know about.
     */
    const section = (id, draw, { flow = false } = {}) => {
      if (!planned.has(id)) return;
      // The act divider, where this is the first section of a new act. Set on
      // the kit and consumed by the page's own `pageHead`, because the divider
      // has to be drawn after the page exists and before its title — and no
      // page function should have to know which act it opens.
      const entry = plan.find((x) => x.id === id);
      if (entry && entry.act !== currentAct) {
        currentAct = entry.act;
        const act = acts.find((x) => x.id === currentAct);
        // Not on the first act: the cover and the summary page open the report
        // and do not need to be told what they are.
        if (act && drawnAny) k.pendingAct = act;
      }
      drawnAny = true;
      if (flow) at(id); else atNext(id);
      draw();
    };

    const acts = actsFor({ hasAthlete: Boolean(a) });
    let currentAct = null;
    let drawnAny = false;
    const originInPathway = originIsProgrammeSpecific(model.summary?.athlete?.originContext);

    // Page one is reserved for the contents and drawn last, once the section
    // starts are known. Nothing is written to it here.
    k.doc.addPage();

    at('programme-at-a-glance');
    currentAct = plan.find((x) => x.id === 'programme-at-a-glance')?.act ?? null;
    drawnAny = true;
    programmeAtAGlance(k, model);

    // ---- Act I, continued: the athlete's own pathway ----
    //
    // An athlete report answers the questions a family asks first — who is at
    // this position now, what the entry year looks like, what has happened
    // when the position opened — and only then shows how the squad as a whole
    // has been built. A programme report has none of these sections and falls
    // straight through to the programme evidence.

    // Through `section`, like every other page: drawn unconditionally it
    // produced a page the contents did not list, on a programme whose
    // synthesis had nothing to say.
    if (a && planned.has('athlete-at-a-glance')) {
      k.doc.addPage();
      at('athlete-at-a-glance');
      athletePathwayPage(k, model);
    }

    section('athlete-current-position', () => currentPositionPage(k, model));
    section('athlete-entry-window', () => arrivalWindowPage(k, model));
    section('athlete-position-openings', () => positionOpeningsPage(k, model));
    section('athlete-position-record', () => positionRecordPage(k, model));
    section('athlete-position-history', () => positionHistoryPage(k, model));
    // Act I only where this programme has its own record by origin. Where the
    // page is mostly division context it is drawn with the supporting
    // evidence, below — `layerOf` in the registry decides, and both places ask
    // the same question of it so the contents and the document cannot
    // disagree.
    if (originInPathway) section('athlete-origin', () => originPage(k, model));
    // Only where the position carries a real sample. A handful of players is
    // filed with the supporting record instead, below.
    if (athletePositionIsStrong(model)) {
      section('athlete-position-movement', () => athletePositionMovementPage(k, model));
    }

    // ---- Act II: programme intelligence, in narrative order ----
    //
    // Five questions rather than sixteen modules. The order is owned by
    // `NARRATIVE_GROUPS` in the section registry, and this run follows it:
    // where you would be competing, then how players get on the pitch, then
    // how the squad is built, then where openings come from, then what the
    // programme recorded.

    // The frame. Every pool comparison below it is scoped to a division, and
    // at 32 programmes the division changes inside the measured window — so a
    // reader needs the denominator before the ratios.
    section('competitive-environment', () => competitiveEnvironmentPage(k, model));

    section('freshman-opportunity', () => freshmanOpportunityPage(k, model));
    section('player-development', () => playerDevelopmentPage(k, model));

    section('squad-usage', () => squadUsagePage(k, model));
    /**
     * Experienced arrivals, beneath the squad page where it is one sentence.
     *
     * At a programme where no arrival could be detected, or where no season
     * can be compared with the one before it, this section is a title, a scope
     * line and a single box — a valid finding that was consuming a whole page
     * at Albertus. It is not deleted and it is not demoted into a footnote: it
     * keeps its heading, its scope line and its box, and flows under a page
     * whose own blocks are already drawn.
     *
     * Guarded on measured room, not on a hunch. A programme with the full
     * scatter and the by-position table never qualifies, and neither does a
     * squad page that has already used its height.
     */
    const arrivalsFlow = arrivalsAreOneFinding(model)
      && pages.get('squad-usage') != null
      && k.remaining() >= 190;
    section('experienced-arrivals',
      () => experiencedArrivalsPage(k, model, { newPage: !arrivalsFlow }),
      { flow: arrivalsFlow });
    section('roster-continuity', () => rosterContinuityPage(k, model));

    section('replacing-minutes', () => replacingMinutesPage(k, model));
    /**
     * Position by position, as the second half of the replacement story.
     *
     * 13A asked whether this still earns a page of its own. It earns the
     * SECTION — what happens at one position is a materially different
     * question from what happens across the programme, and it is the half a
     * recruit reads first — but once the season-by-season openings moved to
     * the evidence act, what is left is a four-row table that read as a thin
     * page. It flows under the replacement page where the room is measured,
     * and takes its own page where it is not, which is the same rule the
     * arrivals section already runs on.
     */
    // 235, measured: the block is 222 points at Mercyhurst men's — a four-row,
    // seven-column table with the definition a reader needs to not subtract its
    // two "started" columns from each other — and the replacement page above it
    // leaves 219. So at a full-data programme it keeps its own page, which is
    // the §M answer: it needs the room. Where the replacement page is shorter
    // it flows, and reads as the second half of one opportunity story.
    const positionFlow = pages.get('replacing-minutes') != null && k.remaining() >= 235;
    section('replacement-by-position',
      () => replacementByPositionPage(k, model, { newPage: !positionFlow }),
      { flow: positionFlow });

    section('eligibility-outlook', () => currentSquadOutlookPage(k, model));

    // What the programme recorded, read inside the environment established at
    // the top of the act.
    section('competitive-history', () => competitiveHistoryPage(k, model));
    section('evidence-limits', () => evidenceLimitsPage(k, model));

    // ---- Act III: the record underneath both ----

    // The roster first: it is the table a family returns to, and the one the
    // squad-outlook page points at.
    section('current-depth', () => currentDepthPage(k, model));
    section('table-freshmen', () => freshmanRecordPage(k, model));
    section('table-experienced-arrivals', () => arrivalRecordPage(k, model));
    section('table-vacancies', () => vacancyRecordPage(k, model));
    section('table-destinations', () => destinationRecordPage(k, model));
    // The origin page, where it turned out to be mostly division context.
    // Every caveat it carries in Act I it carries here; only its priority
    // changed.
    if (!originInPathway) section('athlete-origin', () => originPage(k, model));
    // Last of the record, and only where the position's sample was too thin to
    // lead with. Opening the evidence act with a one-row table under a divider
    // announcing "named players, actual seasons, actual minutes" set it at a
    // volume one row cannot carry.
    if (!athletePositionIsStrong(model)) {
      section('athlete-position-movement', () => athletePositionMovementPage(k, model));
    }

    atNext('methodology');
    if (plan.find((x) => x.id === 'methodology')?.act !== currentAct) {
      currentAct = plan.find((x) => x.id === 'methodology')?.act ?? currentAct;
      const act = acts.find((x) => x.id === currentAct);
      if (act && drawnAny) k.pendingAct = act;
    }
    methodologyPage(k, model);

    // Anything registered with `k.defer` — a cross-reference to a page that did
    // not exist when its own page was written. Run before the contents so a
    // deferred draw cannot be the thing that changes a page count.
    for (const { page, fn } of k.later) {
      k.doc.switchToPage(page);
      fn({ pageOf: (id) => pages.get(id) ?? null, doc: k.doc });
    }

    // The contents, now that every page exists. Drawn in absolute coordinates
    // on the reserved first page: anything consulting the flow cursor could
    // call addPage() here and append a blank page to a finished document.
    k.doc.switchToPage(0);
    contentsPage(k.doc, model, plan, pages);

    footer(k.doc, `Thriv3 · ${c.name}${a ? ` · for ${a.name}` : ''} · prepared ${new Date().toISOString().slice(0, 10)}`);
  }, opts);
}
