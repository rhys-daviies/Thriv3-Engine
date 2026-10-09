// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import ProgrammeDatabase, { LegacyDatabaseRedirect } from './ProgrammeDatabase.jsx';
import ProgrammeWorkspace, { SECTIONS } from './ProgrammeWorkspace.jsx';
import MatchmakingResultCard, { programmeHref } from '@/components/matchmaking/MatchmakingResultCard.jsx';
import { runView } from '@/lib/matchmakingV2View';
import { persistedRun } from '@/lib/__fixtures__/matchmakingV2Run.js';

/**
 * THE PROGRAMME DATABASE, CLIENT SIDE — Phase 4.
 *
 * Filters live in the URL and reach the server as query parameters; the
 * server's states ("Not established", stale, unassessed) are rendered as
 * states, never as zeros; the two old databases redirect; the review queues
 * stay reachable; a V2 card opens its own programme by id.
 */
let container; let root; let calls; let routes;

const ok = (payload) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => payload, text: async () => JSON.stringify(payload) });
const bad = (status, payload) => ({ ok: false, status, headers: { get: () => 'application/json' }, json: async () => payload, text: async () => JSON.stringify(payload) });

const measured = (n) => ({ state: 'MEASURED', openings: n, vacatedStarters: 0, eligibleToRemain: 2, positionRows: 3, unreadable: 0 });
const noRoster = { state: 'NO_ROSTER', openings: 0, vacatedStarters: 0, eligibleToRemain: 0, positionRows: 0, unreadable: 0 };
const ALL = (cell) => ({ GOALKEEPER: cell, DEFENSE: cell, MIDFIELD: cell, FORWARD: cell });

const FACETS = {
  sport: 'mens-soccer', rosterSeason: 2026, classYears: [2027, 2028, 2029, 2030], defaultClassYear: 2027,
  divisions: [{ division: 'NCAA D1', n: 2 }, { division: 'NAIA', n: 1 }],
  conferences: [
    { division: 'NCAA D1', value: 'id:acc', label: 'Atlantic Coast Conference', n: 1, spellings: ['ACC'] },
    { division: 'NAIA', value: 'id:sooner', label: 'Sooner Athletic Conference', n: 7, spellings: ['Sooner', 'Sooner Athletic Conference'] },
  ],
};
const row = (id, name, extra = {}) => ({
  id, name, sport: 'mens-soccer', division: 'NCAA D1', conference: 'ACC', city: 'Durham', state: 'NC', active: 1,
  seasonStatus: null, programStrength: { topPercent: 10, division: 'NCAA D1' }, academicRating: 8,
  assessed: true, notAssessedReason: null, rosterOnFile: true, eligibility: { ruled: true }, windowExhausted: false,
  departures: ALL(measured(1)), ...extra,
});
const LIST = (filters, programmes, total = programmes.length) => ({
  filters: { classYear: 2027, ...filters }, rosterSeason: 2026, classYears: FACETS.classYears,
  total, page: Number(filters.page ?? 1), pageSize: 50, pages: Math.max(1, Math.ceil(total / 50)), programmes,
});

const DETAIL = (extra = {}) => ({
  classYear: 2027, classYears: [2027, 2028, 2029, 2030], rosterSeason: 2026,
  overview: {
    id: 'p-duke', name: 'Duke', sport: 'mens-soccer', division: 'NCAA D1', conference: 'ACC', city: 'Durham', state: 'NC',
    active: 1, seasonStatus: null, programStrength: { topPercent: 10, division: 'NCAA D1' }, academicRating: 9,
    netPrice: 30000, siblings: [{ id: 'p-duke-w', name: 'Duke', sport: 'womens-soccer' }],
  },
  roster: {
    assessed: true, rosterOnFile: true,
    eligibility: { ruled: true, model: 'NCAA_AGE_BASED_5Y', transitional: true, note: 'n', source: 's', windowExhausted: false },
    departures: ALL(measured(1)), departingPlayers: null,
    evidence: { rows: 2, classUnreadable: 0, positionUnreadable: 0, starterUnknown: 0, dataConfidence: 'high' },
    players: [
      { id: 'r1', name: 'Leaving Player', position: 'DEFENSE', classYear: 'Gr.', availability: 'EXPIRED', lastSeason: 2026, starter: 'STARTER', minutesPlayed: 900 },
      { id: 'r2', name: 'Staying Player', position: 'MIDFIELD', classYear: 'Fr.', availability: 'ELIGIBLE_TO_REMAIN', lastSeason: 2030, starter: 'SQUAD', minutesPlayed: 100 },
    ],
  },
  ...extra,
});

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  calls = [];
  routes = {};
  vi.stubGlobal('fetch', vi.fn(async (input) => {
    const path = String(input);
    calls.push(path);
    // Routes are keyed by exact path, query string aside.
    const bare = path.split('?')[0];
    if (routes[bare]) return routes[bare](path);
    if (path.startsWith('/api/programmes/facets')) return ok(FACETS);
    if (path.startsWith('/api/programmes?')) {
      const q = Object.fromEntries(new URL(path, 'http://x').searchParams);
      return ok(LIST(q, [row('p-duke', 'Duke'), row('p-unc', 'North Carolina', { departures: ALL(noRoster) })], 120));
    }
    if (path.startsWith('/api/player-history')) return ok({ links: [] });
    return ok({});
  }));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const q = (sel) => container.querySelector(sel);
const text = () => container.textContent;
const lastList = () => new URL([...calls].reverse().find((c) => c.startsWith('/api/programmes?')), 'http://x').searchParams;

function Where() { const l = useLocation(); return createElement('p', { 'data-testid': 'where' }, l.pathname + l.search); }

let mounts = 0;
async function mount(path) {
  mounts += 1;
  await act(async () => {
    // Keyed, so a second mount in one test is a fresh router at its own entry.
    root.render(createElement(MemoryRouter, { key: mounts, initialEntries: [path] },
      createElement(Routes, null,
        createElement(Route, { path: '/programmes', element: createElement('div', null, createElement(ProgrammeDatabase), createElement(Where)) }),
        createElement(Route, { path: '/programmes/:id', element: createElement('div', null, createElement(ProgrammeWorkspace), createElement(Where)) }),
        createElement(Route, { path: '/colleges', element: createElement(LegacyDatabaseRedirect) }),
        createElement(Route, { path: '/graduating-db', element: createElement(LegacyDatabaseRedirect) }))));
  });
  await flush(); await flush();
}
const change = async (testid, value) => {
  const el = q(`[data-testid="${testid}"]`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), el.type === 'checkbox' ? 'checked' : 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event(el.type === 'checkbox' ? 'click' : 'change', { bubbles: true }));
    if (el.tagName === 'INPUT' && el.type !== 'checkbox') el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush(); await flush();
};

describe('the list', () => {
  it('asks the server with the URL\'s filters, and renders rows linking to each programme by id', async () => {
    await mount('/programmes?sport=womens-soccer&classYear=2028&division=NCAA%20D1&conference=id%3Aacc');
    const p = lastList();
    expect(Object.fromEntries(p)).toMatchObject({ sport: 'womens-soccer', classYear: '2028', division: 'NCAA D1', conference: 'id:acc', sort: 'strength', page: '1' });
    expect(q('[data-testid="programme-row-p-duke"] a').getAttribute('href')).toBe('/programmes/p-duke?classYear=2028');
  });

  it('a filter change goes to the URL and back to page 1', async () => {
    await mount('/programmes?page=3');
    await change('filter-division', 'NAIA');
    expect(q('[data-testid="where"]').textContent).toBe('/programmes?division=NAIA');
    expect(lastList().get('division')).toBe('NAIA');
    expect(lastList().get('page')).toBe('1');
  });

  it('a conference is chosen by identity, and brings its division with it', async () => {
    await mount('/programmes');
    await change('filter-conference', 'NAIA\u001Fid:sooner');
    expect(lastList().get('conference')).toBe('id:sooner');
    expect(lastList().get('division')).toBe('NAIA');
    const option = [...q('[data-testid="filter-conference"]').querySelectorAll('option')].find((o) => o.value.endsWith('id:sooner'));
    expect(option.textContent).toBe('Sooner Athletic Conference (7)');
    expect(option.getAttribute('title')).toBe('Stored as: Sooner, Sooner Athletic Conference');
  });

  it('pages through the server\'s total', async () => {
    await mount('/programmes');
    expect(q('[data-testid="pagination"]').textContent).toContain('120 programmes · page 1 of 3');
    await act(async () => { q('[data-testid="next-page"]').click(); });
    await flush();
    expect(lastList().get('page')).toBe('2');
  });

  it('sends the school text once it is two characters, debounced', async () => {
    await mount('/programmes');
    const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 350)); });
    await change('filter-school', 'D');
    await wait();
    expect(text()).toContain('Type at least 2 characters');
    expect(lastList().get('school')).toBeNull();
    await change('filter-school', 'St. Al');
    await wait(); await flush();
    expect(lastList().get('school')).toBe('St. Al');
  });

  it('includes inactive programmes only when asked', async () => {
    await mount('/programmes');
    expect(lastList().get('includeInactive')).toBeNull();
    await mount('/programmes?includeInactive=1');
    expect(lastList().get('includeInactive')).toBe('1');
  });

  it('renders a count only where measured, and "Not established" otherwise', async () => {
    await mount('/programmes');
    const unc = q('[data-testid="programme-row-p-unc"]');
    expect(unc.textContent).toContain('Not established');
    expect(unc.querySelector('[data-testid="opening-GOALKEEPER"]').textContent).not.toMatch(/\d/);
    expect(q('[data-testid="class-caveat"]').textContent).toContain('not confirmed departures');
  });

  it('says so when nothing matches, and shows a refused filter\'s reason', async () => {
    routes['/api/programmes'] = () => ok(LIST({}, []));
    await mount('/programmes');
    expect(q('[data-testid="programmes-empty"]')).not.toBeNull();
    routes['/api/programmes'] = () => bad(400, { error: 'Recruiting class must be one of 2027, 2028', code: 'CLASS_YEAR_OUT_OF_RANGE' });
    await mount('/programmes?classYear=2040');
    expect(q('[data-testid="programmes-error"]').textContent).toContain('Recruiting class must be one of');
  });

  it('keeps the Roster gaps and Season trust queues one click away', async () => {
    await mount('/programmes');
    expect(q('[data-testid="roster-gaps-link"]').getAttribute('href')).toBe('/colleges/roster-gaps');
    expect(q('[data-testid="season-trust-link"]').getAttribute('href')).toBe('/colleges/season-trust');
  });
});

describe('redirects and navigation', () => {
  it('/colleges and /graduating-db open the Programme Database, carrying the sport', async () => {
    await mount('/colleges?sport=womens-soccer');
    expect(q('[data-testid="where"]').textContent).toBe('/programmes?sport=womens-soccer');
    await mount('/graduating-db');
    expect(q('[data-testid="where"]').textContent).toBe('/programmes');
  });

  it('the app routes the new pages, redirects the old, and keeps both queues', () => {
    const app = fs.readFileSync('src/App.jsx', 'utf8');
    expect(app).toContain('<Route path="/programmes" element={<ProgrammeDatabase />} />');
    expect(app).toContain('<Route path="/programmes/:id" element={<ProgrammeWorkspace />} />');
    expect(app).toContain('<Route path="/colleges" element={<LegacyDatabaseRedirect />} />');
    expect(app).toContain('<Route path="/graduating-db" element={<LegacyDatabaseRedirect />} />');
    expect(app).toContain('path="/colleges/roster-gaps"');
    expect(app).toContain('path="/colleges/season-trust"');
    expect(fs.existsSync('src/pages/Colleges.jsx')).toBe(false);
    expect(fs.existsSync('src/pages/GraduatingDatabase.jsx')).toBe(false);
  });

  it('the nav has one Programme DB entry, and no mock research or legacy export remains in the UI', () => {
    const layout = fs.readFileSync('src/components/Layout.jsx', 'utf8');
    expect(layout).toContain("label: 'Programme DB'");
    expect(layout).not.toContain('College DB');
    expect(layout).not.toContain('Graduating DB');
    const client = fs.readFileSync('src/api/client.js', 'utf8');
    expect(client).not.toContain('buildGraduatingDatabase');
    expect(client).not.toContain('exportGraduatingDatabase');
  });
});

describe('the programme workspace', () => {
  beforeEach(() => {
    routes['/api/programmes/p-duke'] = () => ok(DETAIL());
    routes['/api/programmes/p-duke/recruiting'] = () => ok({ state: 'STALE', observations: [] });
    routes['/api/programmes/p-duke/intelligence'] = () => ok({
      philosophy: { state: 'UNAVAILABLE', reason: 'no roster seasons on file for this programme' },
      competitive: { state: 'UNAVAILABLE', refusals: [] },
      reportUrl: '/api/philosophy/p-duke/report.pdf',
    });
    routes['/api/colleges/p-duke/coaches'] = () => ok({ college: {}, coaches: [{ coach_id: 'c1', name: 'Pat Coach', email: 'pat@example.test', title: 'Head Coach', email_status: 'verified' }] });
    routes['/api/colleges/p-duke/programme-contacts'] = () => ok({ programme: {}, contacts: [], withheld: 2 });
  });

  it('has the five sections, and loads the programme by id with the class', async () => {
    await mount('/programmes/p-duke?classYear=2027');
    expect(SECTIONS.map((s) => s.label)).toEqual(['Overview', 'Roster & Openings', 'Recruiting Intelligence', 'Coaches & Contacts', 'Programme Intelligence']);
    expect(calls).toContain('/api/programmes/p-duke?classYear=2027');
    expect(q('[data-testid="programme-name"]').textContent).toBe('Duke');
    // The other sport, by its own id.
    expect(q('[data-testid="overview-siblings"] a').getAttribute('href')).toBe('/programmes/p-duke-w?classYear=2027');
  });

  it('Roster & Openings groups players by the engine\'s availability, and names the rule applied', async () => {
    await mount('/programmes/p-duke?classYear=2027&tab=roster');
    expect(q('[data-testid="roster-group-EXPIRED"]').textContent).toContain('Leaving Player');
    expect(q('[data-testid="roster-group-ELIGIBLE_TO_REMAIN"]').textContent).toContain('not a forecast');
    expect(q('[data-testid="eligibility-rule"]').textContent).toContain('transitional');
  });

  it('an unassessed or rosterless programme says so', async () => {
    routes['/api/programmes/p-duke'] = () => ok(DETAIL({
      roster: { ...DETAIL().roster, assessed: false, departures: null, players: [], evidence: { ...DETAIL().roster.evidence, rows: 0 } },
    }));
    await mount('/programmes/p-duke?tab=roster');
    expect(q('[data-testid="roster-not-assessed"]')).not.toBeNull();
    expect(q('[data-testid="no-roster"]')).not.toBeNull();
  });

  it('a stale recruiting history is shown as stale, not as nothing recruited', async () => {
    await mount('/programmes/p-duke?tab=recruiting');
    expect(q('[data-testid="recruiting-stale"]')).not.toBeNull();
    expect(q('[data-testid="recruiting-positions"]')).toBeNull();
  });

  it('Coaches & Contacts lists eligible coaches as text, and counts withheld inboxes', async () => {
    await mount('/programmes/p-duke?tab=contacts');
    expect(q('[data-testid="contacts-coaches"]').textContent).toContain('Pat Coach');
    expect(q('[data-testid="contacts-coaches"] a')).toBeNull();
    expect(q('[data-testid="no-inboxes"]')).not.toBeNull();
    expect(q('[data-testid="inboxes-withheld"]').textContent).toContain('2 recorded inboxes are withheld');
  });

  it('Programme Intelligence states what cannot be read, and links the report', async () => {
    await mount('/programmes/p-duke?tab=intelligence');
    expect(q('[data-testid="philosophy-unavailable"]').textContent).toContain('no roster seasons on file');
    expect(q('[data-testid="competitive-unavailable"]')).not.toBeNull();
    expect(q('[data-testid="programme-report-link"]').getAttribute('href')).toBe('/api/philosophy/p-duke/report.pdf');
  });

  it('a class outside the window offers the nearest class instead of failing silently', async () => {
    routes['/api/programmes/p-duke'] = (path) => (path.includes('classYear=2033')
      ? bad(400, { error: 'Recruiting class must be one of 2027, 2028, 2029, 2030', code: 'CLASS_YEAR_OUT_OF_RANGE' })
      : ok(DETAIL()));
    await mount('/programmes/p-duke?classYear=2033');
    await act(async () => { q('[data-testid="default-class"]').click(); });
    await flush();
    expect(q('[data-testid="where"]').textContent).toBe('/programmes/p-duke');
    expect(q('[data-testid="programme-name"]').textContent).toBe('Duke');
  });
});

describe('"Open programme" on a V2 match card', () => {
  it('links to the programme by the engine\'s programmeId, with the athlete\'s class', async () => {
    const card = runView(persistedRun()).programmes[0];
    expect(programmeHref(card, 2028)).toBe(`/programmes/${card.programmeId}?classYear=2028`);
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/player/a1/matching'] },
        createElement(Routes, null, createElement(Route, {
          path: '/player/:id/matching',
          element: createElement(MatchmakingResultCard, { programme: card, entryYear: 2028 }),
        }))));
    });
    expect(q('[data-testid="open-programme"]')).toBeNull();
    const toggle = [...container.querySelectorAll('button')].find((b) => b.getAttribute('aria-expanded') === 'false');
    await act(async () => { toggle.click(); });
    expect(q('[data-testid="open-programme"]').getAttribute('href')).toBe(`/programmes/${card.programmeId}?classYear=2028`);
  });

  it('offers no link when the run carries no programme id, rather than guessing by name', () => {
    expect(programmeHref({ programmeId: null, name: 'Duke' }, 2028)).toBeNull();
  });
});
