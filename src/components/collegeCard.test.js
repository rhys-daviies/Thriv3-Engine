// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import CollegeCard from './CollegeCard.jsx';
import { recruitingSignalsForCollege } from '@/lib/useMatchingSummary';
import { TWO_SIGNALS, SCARCITY, ZERO, UNAVAILABLE, UNRESOLVED } from '@/lib/__fixtures__/recruitingSignals.js';

/**
 * The match card, once Recruiting Signals lives on it.
 *
 * Three concerns, and the card's job is to keep them apart:
 *
 *   Why this score      the matching engine's six weighted criteria.
 *   Recruiting signals  licensed evidence, which explains nothing about the
 *                       score and is only there when there is something to
 *                       say.
 *   View full evidence  a link to the page that has room to explain.
 *
 * What replaced what matters as much as what arrived. The card used to carry
 * "Outreach evidence" — what we could say to a coach — on a screen where
 * nobody is writing to one. That question moved to the composer and the
 * Evidence tab; these tests hold it gone from here and prove the card no
 * longer reaches for it.
 */

const PLAYER = 'athlete-1';

const COLLEGE = {
  name: 'Penn State Harrisburg',
  division: 'NCAA D3',
  city: 'Middletown',
  state: 'PA',
  match_score: 74,
  program_quality_rating: 6.2,
  academic_rating: 7,
  conference: 'CAC',
  net_price: 21500,
  coaching_staff: [{ name: 'A Coach', title: 'Head Coach', email: 'coach@example.edu' }],
  breakdown: [
    { key: 'roster', label: 'Roster opportunity', weight: 0.2, score: 0.6, contribution: 12, confidence: 'measured' },
    { key: 'geography', label: 'Location', weight: 0.3, score: 0.5, contribution: 15, confidence: 'measured' },
  ],
};

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
  vi.unstubAllGlobals();
});

/**
 * Renders a FRESH card and opens it, which is where every section below lives.
 *
 * The unmount first is load-bearing: `expanded` is state, so re-rendering into
 * a live root and clicking again would close the card rather than open a new
 * one — and every assertion about absence would then pass against a collapsed
 * card that renders none of this.
 */
async function open(props = {}) {
  await act(async () => { root.render(null); });
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(CollegeCard, {
      college: COLLEGE, onEmailCoaches: () => {}, playerId: PLAYER, ...props,
    })));
  });
  await act(async () => { container.querySelector('button').click(); });
  // Proof the card is open, so absence assertions mean something.
  expect(container.textContent).toContain('Why this score');
  return container;
}

const signalsFor = (fixture) => recruitingSignalsForCollege({ [COLLEGE.name]: fixture }, COLLEGE.name);
const flat = () => container.textContent.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------

describe('the legacy outreach block is gone', () => {
  it('never says "Outreach evidence" on a match card', async () => {
    for (const signals of [signalsFor(TWO_SIGNALS), signalsFor(ZERO), null]) {
      await open({ recruitingSignals: signals });
      expect(flat()).not.toMatch(/outreach/i);
    }
  });

  it('carries none of the old block’s empty or failure wording', async () => {
    await open({ recruitingSignals: signalsFor(ZERO) });
    const out = flat();
    expect(out).not.toMatch(/No strong outreach evidence/i);
    expect(out).not.toMatch(/Loading outreach evidence/i);
    expect(out).not.toMatch(/could not be loaded/i);
    expect(out).not.toMatch(/Additional intelligence/i);
  });

  it('takes no evidence prop at all any more', () => {
    // The card cannot be handed composer evidence, so it cannot render it —
    // which is a stronger guarantee than not rendering what it holds.
    const source = String(CollegeCard);
    expect(source).not.toContain('evidenceLoading');
    expect(source).not.toContain('evidenceFailed');
  });
});

describe('recruiting signals on the card', () => {
  it('renders the panel when there is something to say', async () => {
    await open({ recruitingSignals: signalsFor(TWO_SIGNALS) });
    expect(flat()).toContain('Recruiting signals');
    expect(flat()).toContain('Has previously recruited 1 defender from New Zealand.');
    expect(flat()).toContain('Thin at defender on the current roster.');
  });

  it('renders nothing at all when there is not', async () => {
    await open({ recruitingSignals: signalsFor(ZERO) });
    expect(flat()).not.toContain('Recruiting signals');
    expect(container.querySelector('section[aria-label="Recruiting signals"]')).toBeNull();
    // And the card carries on to what comes next rather than leaving a gap.
    expect(flat()).toContain('View full evidence');
    expect(flat()).toContain('Coaching Staff');
  });

  it('sits after "Why this score", not inside it', async () => {
    await open({ recruitingSignals: signalsFor(SCARCITY) });
    const out = flat();
    expect(out.indexOf('Why this score')).toBeGreaterThan(-1);
    expect(out.indexOf('Recruiting signals')).toBeGreaterThan(out.indexOf('Why this score'));
    expect(out.indexOf('View full evidence')).toBeGreaterThan(out.indexOf('Recruiting signals'));

    // Structurally separate: the signals section is not a descendant of the
    // criterion list, so no future layout change can make a signal read as a
    // seventh criterion.
    const section = container.querySelector('section[aria-label="Recruiting signals"]');
    expect(section.textContent).not.toContain('Roster opportunity');
    expect(section.querySelector('[style]')).toBeNull();
  });

  it('leaves the score breakdown untouched', async () => {
    await open({ recruitingSignals: signalsFor(TWO_SIGNALS) });
    const out = flat();
    expect(out).toContain('Roster opportunity');
    expect(out).toContain('+12.0');
    expect(out).toContain('20%');
  });

  it('shows a quiet line, and only that, when the programme could not be read', async () => {
    await open({ recruitingSignals: signalsFor(UNAVAILABLE) });
    expect(flat()).toContain('Recruiting signals unavailable.');
    // Not mistakable for zero signals, and the rest of the card is intact.
    expect(flat()).not.toMatch(/no recruiting signals/i);
    expect(flat()).toContain('Why this score');
    expect(flat()).toContain('Coaching Staff');
  });

  it('renders nothing, and no badge, when the name did not resolve', async () => {
    await open({ recruitingSignals: signalsFor(UNRESOLVED) });
    expect(flat()).not.toContain('Recruiting signals');
    expect(flat()).not.toMatch(/unresolved|unknown programme|not found/i);
  });
});

describe('the card asks the network for nothing', () => {
  it('makes no request of its own, with or without signals', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await open({ recruitingSignals: signalsFor(TWO_SIGNALS) });
    await open({ recruitingSignals: null });
    // Twenty cards on a page must cost one request, made by the page. A card
    // that fetched for itself would make the request count a function of
    // pagination, silently.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('view full evidence', () => {
  it('links to the decision page for this athlete and this programme', async () => {
    await open({ recruitingSignals: signalsFor(ZERO) });
    const link = [...container.querySelectorAll('a')].find((a) => a.textContent.includes('View full evidence'));
    expect(link.getAttribute('href'))
      .toBe('/player/athlete-1/decision?college=Penn%20State%20Harrisburg');
  });

  it('round-trips every punctuation class that really occurs', async () => {
    for (const name of ['St. Thomas', 'Ozarks (AR)', 'Davis & Elkins', "Mount St. Mary's",
      'Carson-Newman', 'Embry–Riddle Aeronautical', "King's (PA)"]) {
      await open({ college: { ...COLLEGE, name }, recruitingSignals: null });
      const link = [...container.querySelectorAll('a')].find((a) => a.textContent.includes('View full evidence'));
      const url = new URL(link.getAttribute('href'), 'http://x');
      expect(url.searchParams.get('college')).toBe(name);
    }
  });

  it('is a real link, reachable by keyboard', async () => {
    await open({ recruitingSignals: null });
    const link = [...container.querySelectorAll('a')].find((a) => a.textContent.includes('View full evidence'));
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBeTruthy();
    // Not a div with a click handler, and not removed from the tab order.
    expect(link.getAttribute('tabindex')).not.toBe('-1');
  });

  it('is omitted rather than broken when there is no athlete', async () => {
    await open({ playerId: null, recruitingSignals: null });
    expect(flat()).not.toContain('View full evidence');
  });
});
