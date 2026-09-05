// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import MatchingTab from './MatchingTab.jsx';
import { TWO_SIGNALS, COACH_ARRIVAL, ZERO } from '@/lib/__fixtures__/recruitingSignals.js';

/**
 * The page owns the fetch; the cards own nothing.
 *
 * TWENTY CARDS MUST COST ONE REQUEST. That is the whole point of putting the
 * hook here, and it is the kind of property that decays silently: a card that
 * called `useMatchingSummary` itself would look identical on screen, pass every
 * rendering test, and make the request count a function of how the page is
 * paginated. Nothing downstream would notice.
 *
 * The second property is that a response can never attach to the wrong page.
 * The operator pages through 60 programmes faster than a batch of forty
 * returns, and signals landing on the wrong twenty cards would be evidence
 * about one programme printed under another's name.
 */

const PAGE_SIZE = 20;

const college = (i) => ({
  name: `Multi Word Programme ${i}`,
  division: 'NCAA D2',
  match_score: 70,
  breakdown: [{ key: 'roster', label: 'Roster opportunity', weight: 0.2, score: 0.5, contribution: 10, confidence: 'measured' }],
  coaching_staff: [{ name: 'A Coach', title: 'Head Coach', email: `c${i}@example.edu` }],
});

const RECOMMENDATIONS = Array.from({ length: 40 }, (_, i) => college(i));

let container;
let root;
let calls;
let setPageOutside;
let setPlayerIdOutside;

/** Records every request and answers matching-summary from a handler. */
function stubFetch(handler) {
  vi.stubGlobal('fetch', vi.fn(async (path, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null;
    calls.push({ path, body });
    if (handler) {
      const res = handler(path, body);
      if (res) return res;
    }
    return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, ZERO])));
  }));
}

const ok = (payload) => ({
  ok: true, headers: { get: () => 'application/json' }, json: async () => payload,
});

const summaryCalls = () => calls.filter((c) => c.path.includes('/matching-summary'));
const namesOf = (call) => call.body?.collegeNames ?? null;

/** MatchingTab reads its state from the workspace outlet context. */
function Shell() {
  const [page, setPage] = useState(1);
  const [playerId, setPlayerId] = useState('athlete-1');
  setPageOutside = setPage;
  setPlayerIdOutside = setPlayerId;
  return createElement(Outlet, {
    context: {
      player: { id: playerId, sport: 'mens-soccer' },
      setPlayer: () => {},
      recommendations: RECOMMENDATIONS,
      summary: '',
      analyzing: false,
      phase: 0,
      progress: { current: 0, total: 0, school: '' },
      page,
      setPage,
      onAnalyze: async () => {},
    },
  });
}

async function mount() {
  await act(async () => {
    root.render(createElement(
      MemoryRouter,
      { initialEntries: ['/player/athlete-1/matching'] },
      createElement(
        Routes,
        null,
        createElement(
          Route,
          { path: '/player/:id', element: createElement(Shell) },
          createElement(Route, { path: 'matching', element: createElement(MatchingTab) }),
        ),
      ),
    ));
  });
}

/** Opens the card whose title is `name`, so its sections render. */
async function expand(name) {
  const card = [...container.querySelectorAll('button')]
    .find((b) => b.textContent.includes(name));
  await act(async () => { card.click(); });
}

const flat = () => container.textContent.replace(/\s+/g, ' ').trim();

beforeEach(() => {
  calls = [];
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

// ---------------------------------------------------------------------------

describe('one request per page, not one per card', () => {
  it('asks once for the twenty programmes on the page', async () => {
    stubFetch();
    await mount();
    expect(summaryCalls()).toHaveLength(1);
    expect(namesOf(summaryCalls()[0])).toHaveLength(PAGE_SIZE);
    expect(summaryCalls()[0].path).toBe('/api/players/athlete-1/matching-summary');
  });

  it('sends the page’s names exactly, in order and whole', async () => {
    stubFetch();
    await mount();
    expect(namesOf(summaryCalls()[0])).toEqual(RECOMMENDATIONS.slice(0, PAGE_SIZE).map((c) => c.name));
    // Multi-word throughout: 1,698 of 2,401 real programme names contain a
    // space, and a delimiter bug here is invisible on screen.
    expect(namesOf(summaryCalls()[0]).every((n) => n.includes(' '))).toBe(true);
  });

  it('does not ask again when a card is opened', async () => {
    stubFetch();
    await mount();
    await expand('Multi Word Programme 3');
    await expand('Multi Word Programme 4');
    expect(summaryCalls()).toHaveLength(1);
  });

  it('makes exactly one new request when the page changes', async () => {
    stubFetch();
    await mount();
    await act(async () => { setPageOutside(2); });
    expect(summaryCalls()).toHaveLength(2);
    expect(namesOf(summaryCalls()[1])).toEqual(RECOMMENDATIONS.slice(PAGE_SIZE).map((c) => c.name));
  });

  it('no longer fetches composer evidence for the matching page', async () => {
    // The card stopped showing outreach evidence, so the page stopped asking
    // for it: twenty programmes of server work per page with no consumer.
    stubFetch();
    await mount();
    expect(calls.filter((c) => /\/evidence$/.test(c.path))).toHaveLength(0);
  });
});

describe('a response can never land on the wrong page', () => {
  it('ignores the first page’s answer when it arrives after the second', async () => {
    const resolvers = [];
    stubFetch(() => new Promise((r) => resolvers.push(r)));
    await mount();
    await act(async () => { setPageOutside(2); });

    const first = RECOMMENDATIONS[0].name;              // page 1
    const second = RECOMMENDATIONS[PAGE_SIZE].name;     // page 2

    // Page two answers, then page one's stale request finally lands.
    await act(async () => {
      resolvers[1](ok({ [second]: COACH_ARRIVAL }));
      resolvers[0](ok({ [first]: TWO_SIGNALS }));
    });

    await expand(second);
    expect(flat()).toContain('Jamie Franks has previously recruited');
    // Nothing from the abandoned request reached the screen.
    expect(flat()).not.toContain('Thin at defender');
    expect(flat()).not.toContain('Has previously recruited 1 defender');
  });

  it('shows no signals for a name the current response does not carry', async () => {
    stubFetch(() => ok({ 'Multi Word Programme 0': TWO_SIGNALS }));
    await mount();
    await expand('Multi Word Programme 1');
    expect(flat()).not.toContain('Recruiting signals');
  });

  it('never shows one athlete’s signals to the next one', async () => {
    // The hook keys on athlete AND names together. The same twenty programmes
    // mean different things to two athletes — a New Zealand defender's
    // pathway is not an American goalkeeper's — so a response that outlives
    // the athlete it was asked for must be discarded, not reused.
    const resolvers = [];
    stubFetch(() => new Promise((r) => resolvers.push(r)));
    await mount();
    await act(async () => { setPlayerIdOutside('athlete-2'); });
    expect(summaryCalls()).toHaveLength(2);
    expect(summaryCalls()[1].path).toBe('/api/players/athlete-2/matching-summary');

    // The first athlete's answer lands last.
    await act(async () => {
      resolvers[1](ok({ [RECOMMENDATIONS[0].name]: ZERO }));
      resolvers[0](ok({ [RECOMMENDATIONS[0].name]: TWO_SIGNALS }));
    });
    await expand(RECOMMENDATIONS[0].name);
    expect(flat()).not.toContain('Recruiting signals');
  });
});

describe('a failed page request is said once', () => {
  it('shows one line for the page, not one per card', async () => {
    stubFetch(() => ({ ok: false, status: 500, text: async () => 'boom' }));
    await mount();
    const occurrences = flat().split('Recruiting signals could not be loaded').length - 1;
    expect(occurrences).toBe(1);
  });

  it('does not let a failure read as a fact about any programme', async () => {
    stubFetch(() => ({ ok: false, status: 500, text: async () => 'boom' }));
    await mount();
    await expand('Multi Word Programme 0');
    const out = flat();
    expect(out).not.toMatch(/no recruiting signals/i);
    expect(out).not.toContain('boom');
    expect(out).not.toContain('500');
    // The rest of the card is untouched.
    expect(out).toContain('Why this score');
  });

  it('leaves every card’s signal panel absent rather than empty', async () => {
    stubFetch(() => ({ ok: false, status: 500, text: async () => 'boom' }));
    await mount();
    await expand('Multi Word Programme 0');
    expect(container.querySelectorAll('section[aria-label="Recruiting signals"]')).toHaveLength(0);
  });

  it('shows one card’s unavailable locally, and no page-level line', async () => {
    stubFetch((path, body) => ok(Object.fromEntries(body.collegeNames.map((n, i) => [
      n, i === 0 ? { unavailable: 'roster unreadable' } : ZERO,
    ]))));
    await mount();
    await expand('Multi Word Programme 0');
    expect(flat()).toContain('Recruiting signals unavailable.');
    expect(flat()).not.toContain('could not be loaded');
    // One unreadable roster costs the operator that card, not the page.
    expect(flat().split('Recruiting signals unavailable.').length - 1).toBe(1);
  });
});

describe('what reaches a card', () => {
  it('renders the signals the server sent for that exact name', async () => {
    stubFetch((path, body) => ok(Object.fromEntries(body.collegeNames.map((n, i) => [
      n, i === 0 ? TWO_SIGNALS : i === 1 ? COACH_ARRIVAL : ZERO,
    ]))));
    await mount();
    await expand('Multi Word Programme 0');
    expect(flat()).toContain('Has previously recruited 1 defender from New Zealand.');
    expect(flat()).not.toContain('Jamie Franks');

    await expand('Multi Word Programme 0');   // close it again
    await expand('Multi Word Programme 1');
    expect(flat()).toContain('Jamie Franks has previously recruited 2 players');
    expect(flat()).not.toContain('Thin at defender');
  });

  it('sends no score, weight or criterion with the request', async () => {
    // The REQUEST BODY, not the recorder's own wrapper. Every card on the page
    // carries a match score and a criterion breakdown; none of it may travel,
    // or a signal could be selected by how the programme scored.
    stubFetch();
    await mount();
    expect(Object.keys(summaryCalls()[0].body).sort()).toEqual(['collegeNames']);
  });
});
