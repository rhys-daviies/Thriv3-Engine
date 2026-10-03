// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import MatchmakingSpecificSearch from './MatchmakingSpecificSearch';
import MatchmakingProgrammeStanding from './MatchmakingProgrammeStanding';
import { runView, FORBIDDEN_MAJOR_PHRASES, programmeView } from '@/lib/matchmakingV2View';
import {
  persistedRun, PLAYER, LIMITED_DATA_PROGRAMME, UNSUPPORTED_PROGRAMME, MAJOR_REFUSAL_PROGRAMME,
} from '@/lib/__fixtures__/matchmakingV2Run.js';

/**
 * SPECIFIC SEARCH IS A LOOKUP — A9.5 §C, §D, §F, §H.
 *
 * The property that matters most is negative: this surface must never ask the
 * server to compute anything. A search that quietly produced a score for one
 * school would show a number with no denominator, and it could disagree with
 * the Matchmaking list about the same programme.
 */

let container;
let root;
let calls;

const json = (payload, { status = 200, ok = true } = {}) => ({
  ok, status, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});

function stubFetch(handler) {
  vi.stubGlobal('fetch', vi.fn(async (path, opts) => {
    const method = opts?.method ?? 'GET';
    calls.push({ path: String(path), method, body: opts?.body ? JSON.parse(opts.body) : null });
    const res = await handler(String(path), method);
    if (res) return res;
    throw new Error(`unstubbed ${method} ${path}`);
  }));
}

const RUN = () => runView(persistedRun());
const mount = (ui) => act(() => { root.render(createElement(MemoryRouter, null, ui)); });
const text = () => container.textContent;
const find = (sel) => container.querySelector(sel);
const all = (sel) => [...container.querySelectorAll(sel)];
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

const typeQuery = (s) => {
  const input = find('input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  act(() => { setter.call(input, s); input.dispatchEvent(new Event('input', { bubbles: true })); });
};

/** A `programme` lookup answer, in the shape the route returns. */
const standingFor = (programme) => json({
  runId: 'run-0001',
  computedAt: '2026-10-03T16:04:00.000Z',
  staleness: { current: true, reasons: [] },
  poolSize: 1205,
  rankedCount: 824,
  programme,
});

const REGISTRY_ROW = {
  id: 'pid-ranked-1', name: 'Lindenwood', division: 'NCAA D1',
  conference: 'OVC', city: 'St Charles', state: 'MO', sport: 'mens-soccer',
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  calls = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function search(term, programme, { run = RUN() } = {}) {
  stubFetch(async (path, method) => {
    if (path.includes('/api/colleges/search')) return json({ results: [REGISTRY_ROW] });
    if (path.includes('/matchmaking/programme')) return standingFor(programme);
    if (method === 'POST' && path.includes('/matchmaking/selections')) {
      return json({ id: 'sel-1', runId: 'run-0001' }, { status: 201 });
    }
    return null;
  });
  await act(async () => {
    mount(createElement(MatchmakingSpecificSearch, { player: PLAYER, run }));
  });
  typeQuery(term);
  await act(async () => { vi.advanceTimersByTime(300); });
  await act(async () => {});
  const btn = all('button').find((b) => b.textContent.includes('Where does it rank?'));
  await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

const ranked = (rank, band, pursuit = 0.6) => ({
  ...persistedRun().programmes[0], name: 'Lindenwood', rank, band, pursuit,
});

describe('A9.5 Specific Search — lookup, never a second scorer', () => {
  it('SS1. a Top 25 school shows its exact rank WITH the denominator', async () => {
    await search('Lindenwood', ranked(7, 'PRIORITY_OUTREACH', 0.665709));
    expect(find('[data-testid="standing-rank"]').textContent).toContain('#7');
    expect(find('[data-testid="standing-rank"]').textContent).toContain('of 824');
    expect(find('[data-testid="standing-band"]').textContent).toContain('Priority outreach');
  });

  it('SS2. #101+ is "#431 of 824", never "not in the Top 100" — §H', async () => {
    await search('Lindenwood', ranked(431, 'BROADER_UNIVERSE', 0.42));
    const rank = find('[data-testid="standing-rank"]').textContent;
    expect(rank).toContain('#431');
    expect(rank).toContain('of 824');
    expect(find('[data-testid="standing-band"]').textContent).toContain('Broader universe');
    /** The weaker, rejection-shaped phrasing must not appear. */
    expect(text().toLowerCase()).not.toContain('not in the top');
  });

  it('SS3. NOTHING is computed — only reads leave the browser', async () => {
    await search('Lindenwood', ranked(12, 'PRIORITY_OUTREACH'));
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    /** Specifically: no POST to the compute/persist endpoint. */
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(calls.some((c) => c.path.includes('/matchmaking/programme'))).toBe(true);
  });

  it('SS4. the lookup is scoped to the run ON SCREEN, not "whatever is current"', async () => {
    await search('Lindenwood', ranked(3, 'PRIORITY_OUTREACH'));
    const lookup = calls.find((c) => c.path.includes('/matchmaking/programme'));
    expect(lookup.path).toContain('runId=run-0001');
    expect(lookup.path).toContain('name=Lindenwood');
  });

  it('SS5. LIMITED_DATA keeps its own words and gets no rank — §H', async () => {
    await search('Trinity', { ...LIMITED_DATA_PROGRAMME, name: 'Lindenwood' });
    expect(find('[data-testid="standing-state-SUPPORTED_LIMITED_DATA"]')).toBeTruthy();
    expect(find('[data-testid="standing-rank"]')).toBeNull();
    expect(find('[data-testid="standing-band"]')).toBeNull();
    expect(text()).toContain('does not hold enough evidence');
    expect(text()).toContain('not a judgement about the programme');
    for (const banned of ['poor match', 'weak', 'low fit', 'unlikely']) {
      expect(text().toLowerCase()).not.toContain(banned);
    }
  });

  it('SS6. an unsupported association is distinct, and never "cannot attend" — §H', async () => {
    await search('Garden City', { ...UNSUPPORTED_PROGRAMME, name: 'Lindenwood' });
    expect(find('[data-testid="standing-state-UNSUPPORTED_ASSOCIATION"]')).toBeTruthy();
    expect(text()).toContain('eligibility rules');
    expect(text()).toContain('can attend these institutions');
    expect(text()).not.toContain('Not enough evidence to rank');
  });

  it('SS7. a registry school outside this athlete’s pool is a real answer', async () => {
    await search('Somewhere', null);
    expect(find('[data-testid="standing-outside-pool"]')).toBeTruthy();
    expect(text()).toContain('not part of this athlete');
    /** And offers nothing to record, because there is nothing to attribute. */
    expect(all('button').some((b) => b.textContent.includes('Record for outreach'))).toBe(false);
  });

  it('SS8. recording a selection posts provenance and says nothing was sent', async () => {
    await search('Lindenwood', ranked(3, 'PRIORITY_OUTREACH'));
    const record = all('button').find((b) => b.textContent.includes('Record for outreach'));
    await act(async () => { record.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    const post = calls.find((c) => c.method === 'POST');
    expect(post.path).toContain('/matchmaking/selections');
    expect(post.body).toMatchObject({
      collegeName: 'Lindenwood', runId: 'run-0001', source: 'SPECIFIC_SEARCH',
    });
    expect(find('[data-testid="selection-recorded"]').textContent).toContain('Nothing has been sent');
  });

  it('SS9. a STALE run is still inspectable and says so — §F', async () => {
    const stale = runView(persistedRun({
      staleness: { current: false, reasons: ['PLAYER_INPUT_CHANGED'] },
    }));
    await search('Lindenwood', ranked(3, 'PRIORITY_OUTREACH'), { run: stale });

    expect(find('[data-testid="standing-rank"]')).toBeTruthy();
    const notice = find('[data-testid="standing-stale-notice"]');
    expect(notice.textContent).toContain('outdated');
    expect(notice.textContent).toContain('recorded against that older ranking');
    /** Still no recomputation, and selection is NOT forbidden. */
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(all('button').some((b) => b.textContent.includes('Record for outreach'))).toBe(true);
  });
});

describe('A9.5 §X. the standing surface cannot reintroduce a banned claim', () => {
  it('SS10. no major wording leaks through any programme state', () => {
    const cases = [
      ...persistedRun().programmes,
      MAJOR_REFUSAL_PROGRAMME,
      LIMITED_DATA_PROGRAMME,
      UNSUPPORTED_PROGRAMME,
    ];
    for (const programme of cases) {
      act(() => {
        root.render(createElement(MemoryRouter, null, createElement(MatchmakingProgrammeStanding, {
          standing: { programme, rankedCount: 824, poolSize: 1205 },
          name: programme.name,
        })));
      });
      const rendered = text().toLowerCase();
      for (const banned of FORBIDDEN_MAJOR_PHRASES) {
        expect(rendered, `"${banned}" for ${programme.name}`).not.toContain(banned);
      }
    }
  });

  it('SS11. the major refusal states what the recorded list covers', () => {
    mount(createElement(MatchmakingProgrammeStanding, {
      standing: { programme: MAJOR_REFUSAL_PROGRAMME, rankedCount: 824, poolSize: 1205 },
      name: MAJOR_REFUSAL_PROGRAMME.name,
    }));
    expect(text()).toContain('largest fields of study');
    expect(text()).toContain('whether it is offered is not established');
  });

  it('SS12. no internal machinery reaches this surface', () => {
    mount(createElement(MatchmakingProgrammeStanding, {
      standing: { programme: programmeView(persistedRun().programmes[0]) && persistedRun().programmes[0], rankedCount: 824, poolSize: 1205 },
      name: 'Lindenwood',
    }));
    for (const banned of ['weight', 'basis', 'midrank', 'smoothstep', 'calibrat', 'digest']) {
      expect(text().toLowerCase()).not.toContain(banned);
    }
  });
});
