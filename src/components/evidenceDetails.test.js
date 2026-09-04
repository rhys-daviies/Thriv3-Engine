// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react-dom/test-utils';
import EvidenceDetails from './EvidenceDetails.jsx';
import ProgrammeDecision from './ProgrammeDecision.jsx';
import { provenanceRows, SOURCE_LABEL, FRESHNESS_SAFE } from '@/lib/evidenceProvenance';
import { ROSTER_FIXTURES } from '@/lib/__fixtures__/rosterEvidence.js';
import { PATHWAY_FIXTURES } from '@/lib/__fixtures__/pathwayEvidence.js';
import { DEV_FIXTURES } from '@/lib/__fixtures__/developmentEvidence.js';
import { FIT_FIXTURES } from '@/lib/__fixtures__/fitEvidence.js';
import { CONTEXT_FIXTURES } from '@/lib/__fixtures__/contextEvidence.js';
import { EVIDENCE_KINDS } from '@shared/evidence/kinds.js';

/**
 * The provenance drill-down, across every section and every real fixture.
 *
 * Two things are being defended. The first is that the drawer answers an
 * operator's question rather than dumping the payload: it is not a debug view,
 * and several serialized fields are deliberately absent from it. The second is
 * that each evidence object owns its own provenance — a Top Reason with three
 * supporting items has four drawers, not one, because those four claims
 * describe different populations over different windows.
 */

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Every item across every captured fixture, from all six sections. */
const ALL_ITEMS = [ROSTER_FIXTURES, PATHWAY_FIXTURES, DEV_FIXTURES, FIT_FIXTURES, CONTEXT_FIXTURES]
  .flatMap((set) => Object.values(set))
  .flatMap((m) => [
    ...Object.values(m.sections ?? {}).flat(),
    ...(m.topReasons ?? []).flatMap((r) => [r.primary, ...r.supporting]),
  ]);

const oneOf = (kind) => ALL_ITEMS.find((i) => i.kind === kind);

let container;
let root;

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('one disclosure, collapsed until asked', () => {
  const item = oneOf('POSITION_GRADUATION');

  it('starts collapsed', async () => {
    await act(async () => { root.render(createElement(EvidenceDetails, { item })); });
    const button = container.querySelector('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector(`#${CSS.escape(button.getAttribute('aria-controls'))}`).hidden)
      .toBe(true);
  });

  it('opens on one click and closes again', async () => {
    await act(async () => { root.render(createElement(EvidenceDetails, { item })); });
    const button = container.querySelector('button');
    const panel = container.querySelector(`#${CSS.escape(button.getAttribute('aria-controls'))}`);

    await act(async () => { button.click(); });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('Roster records');

    await act(async () => { button.click(); });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
  });

  it('is a real button, not a clickable div', async () => {
    await act(async () => { root.render(createElement(EvidenceDetails, { item })); });
    const button = container.querySelector('button');
    // A <button> is focusable and activated by Enter and Space with no key
    // handling of our own; a div with onClick is neither.
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(container.querySelectorAll('[onclick]')).toHaveLength(0);
  });

  it('associates the panel with the control', async () => {
    await act(async () => { root.render(createElement(EvidenceDetails, { item })); });
    const button = container.querySelector('button');
    const id = button.getAttribute('aria-controls');
    expect(id).toBeTruthy();
    expect(container.querySelector(`#${CSS.escape(id)}`)).toBeTruthy();
  });

  it('navigates nowhere', async () => {
    await act(async () => { root.render(createElement(EvidenceDetails, { item })); });
    expect(container.querySelector('a')).toBeNull();
    await act(async () => { container.querySelector('button').click(); });
    // `sourceUrl` is null on all 26 kinds, so no external link is offered —
    // and none is invented from the source identifier either.
    expect(container.querySelector('a')).toBeNull();
    expect(container.innerHTML).not.toContain('http');
  });

  it('renders nothing at all when there is no provenance to show', () => {
    const html = renderToStaticMarkup(createElement(EvidenceDetails, { item: { kind: 'X' } }));
    // An empty disclosure is a promise the page cannot keep.
    expect(html).toBe('');
  });
});

describe('the drawer is not a debug view', () => {
  it('renders no raw object, null or NaN on any real item', () => {
    for (const i of ALL_ITEMS) {
      const html = renderToStaticMarkup(createElement(EvidenceDetails, { item: i }));
      for (const junk of ['[object Object]', 'undefined', 'NaN', '{"', 'null']) {
        expect(html, `${i.kind} rendered ${junk}`).not.toContain(junk);
      }
    }
  });

  it('shows none of the implementation vocabulary', () => {
    for (const i of ALL_ITEMS) {
      const t = text(renderToStaticMarkup(createElement(EvidenceDetails, { item: i })));
      for (const leak of ['dedupeGroup', 'decisionClass', 'polarity', 'specificity',
        'minConfidence', 'requiresWindow', 'requiresComparison', 'generatedCount',
        'seasonsUnread', 'sourceUrl', 'tier', 'FACT', 'SIGNAL']) {
        expect(t, `${i.kind} leaked ${leak}`).not.toContain(leak);
      }
    }
  });

  it('never prints a generic sample size', () => {
    // `window.n` counts players for one kind and SEASONS for another. One
    // "n = 4" row would carry three meanings across the page, so each section
    // states its own sample in words instead and the drawer states none.
    for (const i of ALL_ITEMS) {
      const rows = provenanceRows(i);
      expect(rows.map((r) => r.label)).not.toContain('Sample');
      expect(rows.map((r) => r.label)).not.toContain('n');
      const n = i.qualification?.window?.n;
      if (!Number.isFinite(n)) continue;
      // And the number itself does not appear under any label that would read
      // as a population size.
      for (const r of rows) {
        if (/season|percentile|pool/i.test(r.label)) continue;
        expect(r.value).not.toBe(String(n));
      }
    }
  });
});

describe('the window keeps its meaning', () => {
  it('lists a non-contiguous window rather than spanning it', () => {
    const portland = DEV_FIXTURES.Portland.sections.DEVELOPMENT
      .find((i) => i.qualification.window?.seasons?.length === 3);
    expect(portland.qualification.window.seasons).toEqual(['2022', '2023', '2025']);
    const rows = provenanceRows(portland);
    expect(rows.find((r) => r.label === 'Seasons read').value).toBe('2022, 2023, 2025');
  });

  it('spans a genuine run', () => {
    const rows = provenanceRows(DEV_FIXTURES['Carleton (Ryan)'].sections.DEVELOPMENT[0]);
    expect(rows.find((r) => r.label === 'Seasons read').value).toBe('2022–2025');
  });

  it('adds no coverage row when nothing was unread', () => {
    const oregon = DEV_FIXTURES['Oregon State'].sections.DEVELOPMENT
      .find((i) => i.kind === 'ATHLETE_COHORT_LADDER');
    expect(oregon.qualification.window.seasonsUnread).toEqual([]);
    expect(provenanceRows(oregon).map((r) => r.label)).not.toContain('Season coverage');
  });

  it('names the seasons that were unreadable', () => {
    const lincoln = DEV_FIXTURES['Lincoln (MO)'].sections.DEVELOPMENT
      .find((i) => i.kind === 'ATHLETE_COHORT_LADDER');
    expect(lincoln.qualification.window.seasonsUnread).toEqual(['2022', '2023']);
    const row = provenanceRows(lincoln).find((r) => r.label === 'Seasons not readable');
    expect(row.value).toBe('2022, 2023');
  });

  it('says coverage is unestablished rather than zero', () => {
    const duke = DEV_FIXTURES.Duke.sections.DEVELOPMENT
      .find((i) => i.kind === 'ATHLETE_COHORT_LADDER');
    expect(duke.qualification.window.seasonsUnread).toBeNull();
    const rows = provenanceRows(duke);
    expect(rows.find((r) => r.label === 'Season coverage').value)
      .toBe('Not established for this measurement');
    // Never "0 unread": null is unknown, not a clean bill of health.
    expect(rows.map((r) => r.value)).not.toContain('0');
  });
});

describe('the cohort is the one that was applied', () => {
  it('shows only populated axes', () => {
    const carleton = DEV_FIXTURES['Carleton (Ryan)'].sections.DEVELOPMENT
      .find((i) => i.kind === 'ATHLETE_COHORT_LADDER');
    expect(carleton.qualification.window.cohort).toEqual({ position: 'DEFENSE', origin: null });
    const labels = provenanceRows(carleton).map((r) => r.label);
    expect(labels).toContain('Position');
    expect(labels).not.toContain('Origin');
  });

  it('does not reconstruct the cohort that was asked for', () => {
    const carleton = DEV_FIXTURES['Carleton (Ryan)'].sections.DEVELOPMENT
      .find((i) => i.kind === 'ATHLETE_COHORT_LADDER');
    expect(carleton.facts.asked.origin).toBe('international');
    // The applied cohort is authoritative; `asked` is the narrower cut that
    // was refused, and the section above already explains that.
    expect(JSON.stringify(provenanceRows(carleton))).not.toContain('international');
  });

  it('prints a position as a word, not an enum', () => {
    const carleton = DEV_FIXTURES['Carleton (Ryan)'].sections.DEVELOPMENT
      .find((i) => i.kind === 'ATHLETE_COHORT_LADDER');
    expect(provenanceRows(carleton).find((r) => r.label === 'Position').value).toBe('Defender');
  });

  it('never prints the region bucket key', () => {
    const region = PATHWAY_FIXTURES.Jacksonville.sections.RECRUITMENT_PATHWAY
      .find((i) => i.kind === 'ARRIVAL_SAME_REGION_POSITION');
    expect(region.qualification.window.cohort.region).toBe('OCEANIA');
    // The row above names the countries; OCEANIA is a table bucket and has
    // never appeared on any surface.
    expect(JSON.stringify(provenanceRows(region))).not.toContain('OCEANIA');
  });

  it('labels an excluded country as an exclusion, not an axis', () => {
    const region = PATHWAY_FIXTURES.Jacksonville.sections.RECRUITMENT_PATHWAY
      .find((i) => i.kind === 'ARRIVAL_SAME_REGION_POSITION');
    expect(provenanceRows(region).find((r) => r.label === 'Counted separately from').value)
      .toBe('New Zealand');
  });
});

describe('the comparison shows a band, never an estimated percentile', () => {
  const bench = DEV_FIXTURES['Carleton (Ryan)'].sections.DEVELOPMENT
    .find((i) => i.kind === 'PROGRAMME_POOL_BENCHMARK');

  it('shows the basis, pool size and band', () => {
    const rows = provenanceRows(bench);
    const by = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(by['Compared against']).toBe(bench.qualification.comparison.basis);
    expect(by['Pool size']).toBe(`${bench.qualification.comparison.poolSize} programmes`);
    expect(by.Band).toBe(bench.facts.band);
  });

  it('shows no percentile when the payload carries none', () => {
    expect(bench.qualification.comparison.percentile).toBeNull();
    expect(provenanceRows(bench).map((r) => r.label)).not.toContain('Percentile');
  });

  it('shows a real percentile if one is ever supplied, and drops the band', () => {
    const withPercentile = {
      kind: 'PROGRAMME_POOL_BENCHMARK',
      qualification: { ...bench.qualification, comparison: { ...bench.qualification.comparison, percentile: 82 } },
    };
    const by = Object.fromEntries(provenanceRows(withPercentile).map((r) => [r.label, r.value]));
    expect(by.Percentile).toBe('82');
    expect(by.Band).toBeUndefined();
  });
});

describe('freshness appears only where it describes the claim', () => {
  it('is hidden on every kind whose source is a different table', () => {
    // Eight kinds read colleges:*, coach_seasons or recruiting_arrivals while
    // carrying the ROSTER scrape's freshness from the shared programme
    // context. A staleness warning about roster rows, printed under a
    // conference title, describes the wrong table.
    const unsafe = ['ACADEMIC_FIT', 'CONFERENCE_TITLE', 'POSTSEASON_RESULT', 'PROGRAM_MOMENTUM',
      'COACH_CONTEXT', 'COACH_ARRIVAL_SAME_COUNTRY', 'ARRIVAL_SAME_COUNTRY_POSITION',
      'ARRIVAL_SAME_REGION_POSITION'];
    for (const kind of unsafe) {
      expect(FRESHNESS_SAFE.has(kind), `${kind} must not show freshness`).toBe(false);
      const item = oneOf(kind);
      if (!item) continue;
      const stale = {
        ...item,
        qualification: { ...item.qualification, freshness: { state: 'STALE', ageDays: 400, reason: 'last read 400 days ago' } },
      };
      // Even handed an explicitly stale reading, these kinds show nothing.
      expect(JSON.stringify(provenanceRows(stale))).not.toContain('400');
    }
  });

  it('is shown on a roster kind whose reading actually went stale', () => {
    const item = oneOf('POSITION_GRADUATION');
    expect(FRESHNESS_SAFE.has('POSITION_GRADUATION')).toBe(true);
    const stale = {
      ...item,
      qualification: { ...item.qualification, freshness: { state: 'STALE', ageDays: 400, reason: 'last read 400 days ago' } },
    };
    expect(provenanceRows(stale).find((r) => r.label === 'Roster reading').value)
      .toBe('last read 400 days ago');
  });

  it('says nothing while the reading is current', () => {
    const item = oneOf('POSITION_GRADUATION');
    expect(item.qualification.freshness.state).toBe('CURRENT');
    expect(provenanceRows(item).map((r) => r.label)).not.toContain('Roster reading');
  });

  it('classifies all 26 kinds one way or the other', () => {
    // The set is explicit rather than a prefix match, so a new kind gets no
    // freshness until somebody decides it should.
    for (const kind of FRESHNESS_SAFE) expect(EVIDENCE_KINDS[kind]).toBeTruthy();
    expect(FRESHNESS_SAFE.size).toBe(11);
  });
});

describe('sources are named in words', () => {
  it('maps every source value that really occurs', () => {
    const unmapped = new Set();
    for (const i of ALL_ITEMS) {
      const s = i.qualification?.source;
      if (s && !SOURCE_LABEL[s]) unmapped.add(s);
    }
    expect([...unmapped]).toEqual([]);
  });

  it('prints the label rather than the table name', () => {
    const rows = provenanceRows(oneOf('COACH_CONTEXT'));
    expect(rows.find((r) => r.label === 'Source').value).toBe('Coaching staff records');
    expect(JSON.stringify(rows)).not.toContain('coach_seasons');
  });

  it('fails visibly on a source it does not recognise', () => {
    const rows = provenanceRows({
      kind: 'POSITION_GRADUATION',
      qualification: { source: 'some_new_table', temporality: 'CURRENT' },
    });
    // Named rather than guessed at from its prefix: a wrong provenance label
    // is worse than a missing one.
    expect(rows.find((r) => r.label === 'Source').value).toBe('Unrecognised source (some_new_table)');
  });
});

describe('every claim keeps its own provenance', () => {
  const jax = PATHWAY_FIXTURES.Jacksonville;

  it('gives a Top Reason\'s primary and each supporting item their own drawer', () => {
    const html = renderToStaticMarkup(createElement(ProgrammeDecision, { model: jax }));
    const reason = jax.topReasons[0];
    expect(reason.supporting).toHaveLength(2);
    // One control per evidence object, everywhere on the page.
    const controls = (html.match(/aria-expanded/g) ?? []).length;
    const items = jax.topReasons.reduce((n, r) => n + 1 + r.supporting.length, 0)
      + Object.values(jax.sections).flat().length;
    expect(controls).toBe(items);
  });

  it('does not merge windows across a grouped reason', () => {
    const reason = jax.topReasons[0];
    const grad = provenanceRows(reason.primary);
    const cliff = provenanceRows(reason.supporting.find((s) => s.kind === 'ELIGIBILITY_CLIFF'));
    // Same story, different measurements: the graduating class is a current
    // reading and the cliff is projected, and each says so for itself.
    expect(grad.find((r) => r.label === 'Nature').value).toBe('Describes the current squad');
    expect(cliff.find((r) => r.label === 'Nature').value).toBe('Projected from current data');
    expect(grad.find((r) => r.label === 'Source').value).toBe('Roster records');
    expect(cliff.find((r) => r.label === 'Source').value).toBe('Roster records — eligibility years');
  });

  it('starts every drawer on the page closed', () => {
    const html = renderToStaticMarkup(createElement(ProgrammeDecision, { model: jax }));
    for (const state of html.match(/aria-expanded="[a-z]+"/g) ?? []) {
      expect(state).toBe('aria-expanded="false"');
    }
  });

  it('changes no section copy when collapsed', () => {
    const t = text(renderToStaticMarkup(createElement(ProgrammeDecision, { model: jax })));
    // The six sections read exactly as they did before the drawer existed.
    expect(t).toContain('3 defenders in the graduating class');
    expect(t).toContain('Eligibility runs out across 2026–2027');
    expect(t).toContain('1 arrival from New Zealand under Ali Simmons');
    expect(t).toContain('Offers Kinesiology');
    expect(t).toContain('Head coach: Ali Simmons');
  });
});
