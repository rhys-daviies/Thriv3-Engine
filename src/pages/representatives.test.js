// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import Representatives from './Representatives';

/**
 * The Representatives screen — Phase 2. Several consultants, each with their
 * own contact details; added, edited and deactivated, never deleted; and the
 * count of athletes each one represents, plus who has nobody.
 */
let container; let root; let reps; let requests;
const json = (body, status = 200) => ({
  ok: status < 400, status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body), json: async () => body,
});
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const q = (sel) => container.querySelector(sel);

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  requests = [];
  reps = [
    { id: 'r1', full_name: 'Alex Morgan', email: 'alex@example.test', phone: '+1 415 555 0134', title: 'Consultant', organisation: 'Striv3', active: 1 },
    { id: 'r2', full_name: 'Sam Lee', email: 'sam@example.test', phone: null, title: null, organisation: null, active: 0 },
  ];
  const players = [
    { id: 'p1', representative_id: 'r1' }, { id: 'p2', representative_id: 'r1' }, { id: 'p3', representative_id: null },
    { id: 'p4', representative_id: null, archived_at: '2026-01-01' },
  ];
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const url = String(path); const method = opts.method ?? 'GET';
    requests.push({ url, method, body: opts.body ? JSON.parse(opts.body) : null });
    if (url.startsWith('/api/entities/representatives') && method === 'GET') return json(reps);
    if (url.startsWith('/api/entities/players')) return json(players);
    if (url === '/api/entities/representatives' && method === 'POST') {
      const body = JSON.parse(opts.body);
      if (!body.email) return json({ error: 'A representative needs an email address coaches can write to.' }, 400);
      reps = [...reps, { id: 'r3', active: 1, ...body }];
      return json(reps.at(-1));
    }
    const m = url.match(/^\/api\/entities\/representatives\/(\w+)$/);
    if (m && method === 'PUT') {
      reps = reps.map((r) => (r.id === m[1] ? { ...r, ...JSON.parse(opts.body), active: JSON.parse(opts.body).active ? 1 : 0 } : r));
      return json(reps.find((r) => r.id === m[1]));
    }
    return json({});
  }));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const mount = async () => { act(() => { root.render(createElement(MemoryRouter, null, createElement(Representatives))); }); await flush(); };
const type = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

describe('the Representatives screen', () => {
  it('lists every representative with their contact details and who they represent', async () => {
    await mount();
    const alex = q('[data-testid="representative-r1"]').textContent;
    expect(alex).toContain('Alex Morgan');
    expect(alex).toContain('alex@example.test');
    expect(alex).toContain('+1 415 555 0134');
    expect(alex).toContain('Representing 2 active athletes');
    expect(q('[data-testid="representative-r2"]').textContent).toContain('Inactive');
    // p4 is archived, so only p3 counts as unassigned.
    expect(q('[data-testid="unassigned-athletes"]').textContent).toMatch(/^1 active athlete has no representative/);
  });

  it('adds a representative, and shows the server\'s refusal in words', async () => {
    await mount();
    click(q('[data-testid="add-representative"]'));
    const inputs = q('[data-testid="representative-form"]').querySelectorAll('input');
    type(inputs[0], 'Jo Park');
    await act(async () => { q('[data-testid="representative-form"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    expect(q('[role="alert"]').textContent).toMatch(/needs an email/);

    type(inputs[1], 'jo@example.test');
    type(inputs[2], '+64 21 555 0100');
    await act(async () => { q('[data-testid="representative-form"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    const post = requests.filter((r) => r.method === 'POST').at(-1);
    expect(post.body).toMatchObject({ full_name: 'Jo Park', email: 'jo@example.test', phone: '+64 21 555 0100' });
    expect(q('[data-testid="representative-r3"]').textContent).toContain('Jo Park');
  });

  it('deactivates rather than deletes', async () => {
    await mount();
    const button = [...q('[data-testid="representative-r1"]').querySelectorAll('button')].find((b) => b.textContent === 'Deactivate');
    click(button);
    await flush();
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
    expect(requests.find((r) => r.method === 'PUT').body).toEqual({ active: false });
    expect(q('[data-testid="representative-r1"]').textContent).toContain('Inactive');
  });
});
