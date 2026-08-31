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
import { actsFor } from '../../shared/report/sections.js';
import {
  freshmanIntakePage, freshmanLadderPage,
  experiencedArrivalIntakePage, experiencedArrivalProfilePage,
  replacingMinutesPage, replacementByPositionPage,
  currentSquadOutlookPage, currentDepthPage,
} from './reportEvidence.js';
import {
  positionHistoryPage, positionOpeningsPage, currentPositionPage,
  arrivalWindowPage, originPage,
} from './reportAthlete.js';
import {
  playerDevelopmentPage, rosterContinuityPage, observedDestinationsPage,
  athletePositionMovementPage,
} from './reportLifecycle.js';
import {
  freshmanRecordPage, arrivalRecordPage, vacancyRecordPage, destinationRecordPage,
  methodologyPage,
} from './reportAppendix.js';
import { evidenceLimitsPage } from './reportLimits.js';
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
    const section = (id, draw) => {
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
      atNext(id);
      draw();
    };

    const acts = actsFor({ hasAthlete: Boolean(a) });
    let currentAct = null;
    let drawnAny = false;

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

    if (a) {
      k.doc.addPage();
      at('athlete-at-a-glance');
      athletePathwayPage(k, model);
    }

    section('athlete-current-position', () => currentPositionPage(k, model));
    section('athlete-entry-window', () => arrivalWindowPage(k, model));
    section('athlete-position-openings', () => positionOpeningsPage(k, model));
    section('athlete-position-history', () => positionHistoryPage(k, model));
    section('athlete-origin', () => originPage(k, model));
    // Only where the position carries a real sample. A handful of players is
    // filed with the supporting record instead, below.
    if (athletePositionIsStrong(model)) {
      section('athlete-position-movement', () => athletePositionMovementPage(k, model));
    }

    // ---- Act II: how this programme has built and used its squad ----

    section('freshman-intake', () => freshmanIntakePage(k, model));
    section('freshman-ladder', () => freshmanLadderPage(k, model));
    section('player-development', () => playerDevelopmentPage(k, model));
    section('experienced-arrival-intake', () => experiencedArrivalIntakePage(k, model));
    section('current-arrivals', () => experiencedArrivalProfilePage(k, model));
    section('replacing-minutes', () => replacingMinutesPage(k, model));
    section('replacement-by-position', () => replacementByPositionPage(k, model));
    section('eligibility-outlook', () => currentSquadOutlookPage(k, model));
    section('current-depth', () => currentDepthPage(k, model));
    section('roster-continuity', () => rosterContinuityPage(k, model));
    section('observed-destinations', () => observedDestinationsPage(k, model));
    section('evidence-limits', () => evidenceLimitsPage(k, model));

    // ---- Act III: the record underneath both ----

    section('table-freshmen', () => freshmanRecordPage(k, model));
    section('table-experienced-arrivals', () => arrivalRecordPage(k, model));
    section('table-vacancies', () => vacancyRecordPage(k, model));
    section('table-destinations', () => destinationRecordPage(k, model));
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
