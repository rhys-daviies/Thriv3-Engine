// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import PlayerFormSteps from './PlayerFormSteps.jsx';

/**
 * PREFERRED CONFERENCES SURVIVE THE EDIT FORM — Phase 3.
 *
 * The defect: the form pruned saved conferences against the conference list
 * before that list had loaded (it starts empty), so opening an athlete and
 * saving wrote an empty list. These open the real form with saved
 * conferences, control how the reference list arrives, submit, and read what
 * would be saved.
 */
let container; let root; let collegesResponse; let submitted;

const ok = (payload) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});

const COLLEGES = [
  { id: 'c1', name: 'One', division: 'NCAA D1', conference: 'Big Ten', active: 1 },
  { id: 'c2', name: 'Two', division: 'NCAA D1', conference: 'ACC', active: 1 },
  { id: 'c3', name: 'Three', division: 'NCAA D2', conference: 'GLIAC', active: 1 },
];

const SAVED = {
  full_name: 'Jordan Smith', position: 'CB', recruiting_class_year: 2028, sport: 'mens-soccer',
  preferred_divisions: ['NCAA D1', 'NCAA D2'],
  preferred_conferences: ['Big Ten', 'GLIAC', 'Retired Conference'],
  contribution_state: 'NOT_A_CONSTRAINT',
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  submitted = null;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  collegesResponse = () => Promise.resolve(ok(COLLEGES));
  vi.stubGlobal('fetch', vi.fn(async (path) => {
    if (String(path).includes('/api/entities/colleges')) return collegesResponse();
    return ok([]);
  }));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const mount = async (initialData = SAVED) => {
  await act(async () => {
    root.render(createElement(PlayerFormSteps, {
      initialData, sport: 'mens-soccer', submitLabel: 'Save', onSubmit: (d) => { submitted = d; },
    }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const submit = async () => {
  await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
};
const text = () => container.textContent;

describe('saved conferences on the edit form', () => {
  it('survive opening and saving once the list has loaded, including a name the list no longer has', async () => {
    await mount();
    await submit();
    expect(submitted.preferred_conferences).toEqual(['Big Ten', 'GLIAC', 'Retired Conference']);
    expect(container.querySelector('[data-testid="conference-chip-Retired Conference"]')).not.toBeNull();
    expect(text()).toContain('Saved, but not in the current list');
  });

  it('survive while the list is still loading, and are shown as saved', async () => {
    collegesResponse = () => new Promise(() => {});
    await mount();
    expect(container.querySelector('[data-testid="conference-loading"]')).not.toBeNull();
    expect(text()).toContain('saved selections are kept');
    await submit();
    expect(submitted.preferred_conferences).toEqual(['Big Ten', 'GLIAC', 'Retired Conference']);
  });

  it('survive a failed list load, and the picker says so', async () => {
    collegesResponse = () => Promise.resolve({ ok: false, status: 500, headers: { get: () => 'application/json' }, text: async () => '{"error":"boom"}' });
    await mount();
    expect(container.querySelector('[data-testid="conference-load-failed"]')).not.toBeNull();
    await submit();
    expect(submitted.preferred_conferences).toEqual(['Big Ten', 'GLIAC', 'Retired Conference']);
  });

  it('unticking a division removes only that division\'s conferences, and keeps names the data does not know', async () => {
    await mount();
    const d2 = [...container.querySelectorAll('label')].find((l) => l.textContent.trim() === 'NCAA D2').querySelector('button');
    await act(async () => { d2.click(); });
    await submit();
    expect(submitted.preferred_divisions).toEqual(['NCAA D1']);
    expect(submitted.preferred_conferences).toEqual(['Big Ten', 'Retired Conference']);
  });

  it('sits directly beneath divisions on the first step, and says what V2 does with it', async () => {
    await mount();
    const step1 = text();
    expect(step1.indexOf('Preferred Divisions')).toBeLessThan(step1.indexOf('Preferred Conferences'));
    expect(step1.indexOf('Preferred Conferences')).toBeLessThan(step1.indexOf('GPA'));
    expect(step1).toContain('Matcher V2 does not rank or filter on conferences');
    expect(step1).not.toContain('every conference in your divisions is considered');
  });
});
