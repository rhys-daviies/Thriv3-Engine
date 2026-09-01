import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { groupEvidence, CardEvidence } from './EvidencePanel.jsx';
import { evidenceForCollege } from '@/lib/useEvidence';

/**
 * The match card's read-only evidence section.
 *
 * Two things are being defended. First, that the card and the composer put a
 * finding in the SAME group — they share `groupEvidence` precisely so a
 * suppressed item cannot read as a recommendation on one screen and a rejected
 * one on the other. Second, that the card says nothing the server did not: no
 * provenance, no re-rendered prose, and no sentence at all for the internal
 * kinds, which have none by construction.
 *
 * Rendered through `renderToStaticMarkup` rather than a testing library, which
 * is not a dependency here. That renders initial state only — which is exactly
 * what the "collapsed by default" assertions need.
 */

const render = (props) => renderToStaticMarkup(createElement(CardEvidence, props));

/** A wire item, in the shape `wireEvidence` actually emits. */
const item = (kind, o = {}) => ({
  kind,
  tier: 'FACT',
  category: 'international',
  confidence: 'HIGH',
  strength: 90,
  season: '2025',
  source: 'recruiting_arrivals',
  downgraded: null,
  // Deliberately NOT derived from the kind: one assertion below checks that a
  // registry key never reaches the screen, and a fixture that embedded the key
  // in its own prose would pass or fail for the wrong reason.
  text: 'a sentence the server rendered',
  ...o,
});

/** The Jacksonville shape, trimmed to what the card reads. */
const wire = (o = {}) => ({
  selected: [
    { ...item('COACH_ARRIVAL_SAME_COUNTRY', { strength: 99 }), order: 0, slot: 'HOOK', displayed: true },
    { ...item('POSITION_GRADUATION', { category: 'roster', strength: 81 }), order: 1, slot: 'RELEVANCE', displayed: true },
  ],
  available: [
    { ...item('COACH_ARRIVAL_SAME_COUNTRY', { strength: 99 }), selected: true, disposition: 'SELECTED', reason: null },
    { ...item('POSITION_GRADUATION', { category: 'roster', strength: 81 }), selected: true, disposition: 'SELECTED', reason: null },
    { ...item('SQUAD_GRADUATION', { category: 'roster', strength: 50 }), selected: false, disposition: 'BELOW_THRESHOLD', reason: 'not strong enough to be the fourth thing we say' },
  ],
  otherKnown: [
    {
      kind: 'HISTORICAL_SAME_COUNTRY',
      label: 'Historical same-country recruiting',
      family: 'International',
      disposition: 'SUPPRESSED_REDUNDANT',
      reason: 'says the same thing as same-country arrival under this coach',
      text: "you've had someone come through from New Zealand",
      tier: 'FACT',
      confidence: 'HIGH',
    },
    {
      kind: 'SQUAD_GRADUATION',
      label: 'Squad-wide graduation',
      family: 'Roster',
      disposition: 'BELOW_THRESHOLD',
      reason: 'not strong enough to be the fourth thing we say',
      text: "you've got six players graduating",
      tier: 'FACT',
      confidence: 'MEDIUM',
    },
  ],
  internal: [
    { kind: 'POSITION_INTAKE_HISTORY', tier: 'FACT', confidence: 'HIGH', strength: 60, season: '2023-2026', source: 'recruiting_arrivals' },
    { kind: 'TRANSFER_BEHAVIOUR', tier: 'SIGNAL', confidence: 'MEDIUM', strength: 40, season: '2026', source: 'roster_players:prior_programme' },
  ],
  ...o,
});

/* ========================================================================== */

describe('groupEvidence — the rule both surfaces share', () => {
  it('splits selected, other-available and internal from one wire object', () => {
    const g = groupEvidence(wire());
    expect(g.chosen).toEqual(['COACH_ARRIVAL_SAME_COUNTRY', 'POSITION_GRADUATION']);
    expect(g.internal.map((e) => e.kind)).toEqual(['POSITION_INTAKE_HISTORY', 'TRANSFER_BEHAVIOUR']);
    expect(g.hasEmailable).toBe(true);
  });

  /**
   * An item below the slot floor is in BOTH `available` and `otherKnown`.
   * Listing it twice showed the same evidence as a strong option and as too
   * weak to use, on one screen.
   */
  it('never lists one finding in two groups', () => {
    const g = groupEvidence(wire());
    const kinds = g.otherAvailable.map((e) => e.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(g.others.map((e) => e.kind)).not.toContain('SQUAD_GRADUATION');
    expect(g.dropped.map((e) => e.kind)).toContain('SQUAD_GRADUATION');
  });

  it('puts near misses before suppressed findings', () => {
    const g = groupEvidence({
      ...wire(),
      available: [
        ...wire().available,
        { ...item('PROGRAM_MOMENTUM', { tier: 'SIGNAL', category: 'performance', strength: 56 }), selected: false, disposition: 'AVAILABLE', reason: null },
      ],
    });
    expect(g.otherAvailable[0].kind).toBe('PROGRAM_MOMENTUM');
  });

  it('never treats a selected kind as also available', () => {
    const g = groupEvidence(wire());
    for (const e of g.otherAvailable) expect(g.chosenSet.has(e.kind)).toBe(false);
  });

  it('reports nothing emailable when only internal intelligence exists', () => {
    const g = groupEvidence({ selected: [], available: [], otherKnown: [], internal: wire().internal });
    expect(g.hasEmailable).toBe(false);
    expect(g.internal).toHaveLength(2);
  });

  it('survives an absent wire object', () => {
    const g = groupEvidence(null);
    expect(g.hasEmailable).toBe(false);
    expect(g.otherAvailable).toEqual([]);
  });
});

describe('CardEvidence — the three sections', () => {
  it('names the sections in the operator\'s words, not the registry\'s', () => {
    const html = render({ evidence: wire() });
    expect(html).toContain('Recommended outreach evidence');
    expect(html).toContain('Other available evidence');
    // The internal group is never called evidence.
    expect(html).toContain('additional intelligence finding');
    expect(html).not.toContain('Internal evidence');
  });

  /**
   * A registry key is a grouping constant for a database. An operator should
   * not have to decode COACH_ARRIVAL_SAME_COUNTRY to learn that we have
   * recruited from this athlete's country under this coach.
   */
  it('labels findings in prose and never with a raw kind', () => {
    const html = render({ evidence: wire() });
    expect(html).toContain('Same-country arrival under this coach');
    expect(html).not.toContain('COACH_ARRIVAL_SAME_COUNTRY');
    expect(html).not.toContain('POSITION_GRADUATION');
  });

  it('prints the server-rendered sentence verbatim', () => {
    const html = render({
      evidence: wire({
        selected: [{
          ...item('COACH_ARRIVAL_SAME_COUNTRY', {
            text: "you've brought in Hayden Aish from New Zealand in 2025",
          }),
          order: 0, slot: 'HOOK', displayed: true,
        }],
      }),
    });
    expect(html).toContain('you&#x27;ve brought in Hayden Aish from New Zealand in 2025');
  });

  it('keeps additional intelligence collapsed, and renders no sentence for it', () => {
    const html = render({ evidence: wire() });
    expect(html).toContain('Show 2 additional intelligence findings');
    // Collapsed: neither the label nor the caveat is in the initial markup.
    expect(html).not.toContain('Intake history at this position');
    expect(html).not.toContain('not approved for outreach');
  });

  it('folds a long other-available list rather than printing all of it', () => {
    const many = wire({
      otherKnown: Array.from({ length: 9 }, (_, i) => ({
        kind: `K${i}`, label: `K${i}`, disposition: 'SUPPRESSED_REDUNDANT',
        reason: 'says the same thing as something above', text: `text ${i}`,
        tier: 'FACT', confidence: 'HIGH',
      })),
    });
    const html = render({ evidence: many });
    expect(html).toContain('Show 7 more findings');
    expect(html).toContain('text 0');
    expect(html).not.toContain('text 8');
  });

  /**
   * The composer caps a paragraph at two gathered clauses, so a selected item
   * can be recorded and never reach a coach. The card must not imply otherwise.
   */
  it('says so when a recommended item would not be carried', () => {
    const html = render({
      evidence: wire({
        selected: [{ ...item('ACADEMIC_FIT', { category: 'academic' }), order: 0, slot: 'RELEVANCE', displayed: false }],
      }),
    });
    expect(html).toContain('a default approach would not carry it');
  });
});

describe('CardEvidence — empty, loading and failure are three different things', () => {
  it('shows loading rather than emptiness while a request is in flight', () => {
    const html = render({ evidence: null, loading: true });
    expect(html).toContain('Loading outreach evidence');
    expect(html).not.toContain('No strong outreach evidence');
  });

  /** Loading wins even when a stale previous page is still in state. */
  it('keeps showing loading when the previous page\'s response is still held', () => {
    const html = render({ evidence: wire(), loading: true });
    expect(html).toContain('Loading outreach evidence');
    expect(html).not.toContain('Recommended outreach evidence');
  });

  /**
   * A failed request and a programme with nothing to say produce the same empty
   * screen. Conflating them lets a server problem read as a fact about the
   * school.
   */
  it('distinguishes a failed load from having nothing to say', () => {
    const failed = render({ evidence: null, failed: true });
    expect(failed).toContain('could not be loaded');
    expect(failed).not.toContain('No strong outreach evidence');

    const empty = render({ evidence: null });
    expect(empty).toContain('No strong outreach evidence identified for this programme');
    expect(empty).not.toContain('could not be loaded');
  });

  it('keeps the internal-only case explicit', () => {
    const html = render({
      evidence: { selected: [], available: [], otherKnown: [], internal: wire().internal },
    });
    expect(html).toContain('No strong outreach evidence identified for this programme');
    expect(html).toContain('Show 2 additional intelligence findings');
  });

  it('says what an approach would do when nothing was selected but options exist', () => {
    const html = render({ evidence: wire({ selected: [] }) });
    expect(html).toContain('introduce the athlete first');
  });
});

describe('CardEvidence — the boundary the card must not cross', () => {
  const html = () => render({ evidence: wire() });

  it('exposes no provenance, because the wire carries none', () => {
    for (const word of ['provenance', 'supporting', 'attributable', 'coverageStatus', 'specificity']) {
      expect(html()).not.toContain(word);
    }
  });

  /** Read-only: every control the composer offers is absent here. */
  it('renders no selection, ordering or structure control', () => {
    const out = html();
    expect(out).not.toContain('<select');
    expect(out).not.toContain('type="checkbox"');
    expect(out).not.toContain('Add to email');
    expect(out).not.toContain('Remove from email');
    expect(out).not.toContain('Move up');
  });
});

/**
 * Paging must not show page 1's evidence on page 2.
 *
 * `useEvidence` keeps the previous response in state until the new one lands,
 * so for the duration of the request the card holds the wrong page's object.
 * Two things make that safe, and both are asserted here: every lookup is BY
 * NAME, so a foreign page's object simply misses; and `loading` is true for
 * that whole window, which the card prefers over an empty result.
 */
describe('pagination cannot leak evidence across pages', () => {
  const PAGE_SIZE = 20;
  const all = Array.from({ length: 100 }, (_, i) => ({ name: `College ${i}` }));
  const pageNames = (page) => all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((c) => c.name);

  it('slices disjoint programme sets per page', () => {
    const one = new Set(pageNames(1));
    const two = pageNames(2);
    expect(one.size).toBe(PAGE_SIZE);
    expect(two).toHaveLength(PAGE_SIZE);
    for (const name of two) expect(one.has(name)).toBe(false);
  });

  /** The hook's effect key. A different page is a different key, so it refetches. */
  it('changes the fetch key when the page changes', () => {
    expect(pageNames(1).join(' ')).not.toBe(pageNames(2).join(' '));
  });

  it('misses rather than mismatching when the held response is the other page', () => {
    const page1Response = Object.fromEntries(pageNames(1).map((n) => [n, wire()]));
    for (const name of pageNames(2)) {
      expect(evidenceForCollege(page1Response, name)).toBeNull();
    }
    expect(evidenceForCollege(page1Response, 'College 0')).not.toBeNull();
  });

  it('reads an unavailable programme as nothing, not as evidence', () => {
    expect(evidenceForCollege({ X: { unavailable: 'roster unreadable' } }, 'X')).toBeNull();
  });

  /**
   * The miss above would otherwise render as "no strong outreach evidence" for
   * as long as the request is in flight. Loading wins, so it reads as loading.
   */
  it('shows loading over a miss while the new page is in flight', () => {
    const html = render({ evidence: null, loading: true });
    expect(html).toContain('Loading outreach evidence');
  });
});
