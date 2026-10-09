// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import EmailComposer from './EmailComposer.jsx';
import BulkEmailComposer from './BulkEmailComposer.jsx';
import OptOutControl from './engagement/OptOutControl.jsx';
import CoachTable from './engagement/CoachTable.jsx';
import ContactsSection from '@/pages/programme/ContactsSection.jsx';
import { refusalFor, ineligibleReasonText } from '@/lib/sendRefusal';

/**
 * CONTACT SAFETY, ON SCREEN — Phase 5, PR A.
 *
 *   #3  Every refusal the send endpoint returns has a word on its row, in both
 *       composers; opted-out contacts are named as left out, never addressed.
 *   #10 With nobody to write to, the composer shows the server's reason.
 *   #2  "Record opt-out" is two steps, posts no address, and then says so.
 */
let container; let root; let calls;
const ok = (payload) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => payload, text: async () => JSON.stringify(payload) });

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  calls = [];
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const text = () => document.body.textContent;
const q = (sel) => document.body.querySelector(sel);
const qa = (sel) => [...document.body.querySelectorAll(sel)];
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

function stubFetch(handlers = {}) {
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path: String(path), method: opts.method ?? 'GET', body });
    for (const [k, h] of Object.entries(handlers)) if (String(path).includes(k)) return ok(h(body));
    if (String(path).includes('/evidence')) return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, { selected: [], available: [] }])));
    return ok({});
  }));
}

const PLAYER = { id: 'athlete-1', full_name: 'Nikau Brennan', sport: 'mens-soccer', position: 'CM', recruiting_class_year: 2027 };
const REFUSALS = [
  { email: 'a@x.test', name: 'Opted Out', status: 'suppressed' },
  { email: 'b@x.test', name: 'Not Eligible', status: 'not-eligible', reason: 'EMAIL_NOT_VERIFIED:inferred' },
  { email: 'c@x.test', name: 'Rate Capped', status: 'rate-capped', recentSends: 3 },
  { email: 'd@x.test', name: 'Budget Out', status: 'budget-refused', reason: 'BUDGET', error: 'Daily limit of 40 reached.' },
  { email: 'e@x.test', name: 'Revoked', status: 'revoked', message: 'Outreach to this coach was revoked.' },
  { email: 'f@x.test', name: 'Broken', status: 'error', error: 'boom' },
];

describe('refusalFor: every refusal has a word and a reason', () => {
  it.each([
    ['suppressed', 'opted out', /opted out of Thriv3 email/],
    ['not-eligible', 'not eligible', /not been verified/],
    ['rate-capped', 'recently contacted', /3 time\(s\) recently/],
    ['budget-refused', 'daily limit reached', /Daily limit of 40/],
    ['revoked', 'link withdrawn', /revoked/],
    ['link-not-activated', 'link not live', /could not be activated/],
    ['error', 'failed', /boom/],
    ['something-new', 'not prepared', /something-new/],
  ])('%s', (status, word, detail) => {
    const r = refusalFor({ ...REFUSALS.find((x) => x.status === status), status });
    expect(r.word).toBe(word);
    expect(r.detail).toMatch(detail);
  });

  it('a prepared or sent result is not a refusal', () => {
    expect(refusalFor({ status: 'drafted' })).toBeNull();
    expect(refusalFor({ status: 'sent' })).toBeNull();
    expect(refusalFor(undefined)).toBeNull();
  });

  it('names held, unverified and other-programme coaches in operator words', () => {
    expect(ineligibleReasonText('COACH_ACTIVATION_HELD:PENDING_SEND_TIME_VERIFICATION')).toMatch(/activation hold/);
    expect(ineligibleReasonText('ADDRESS_AT_OTHER_PROGRAMME')).toMatch(/different programme/);
  });
});

describe('the single composer marks every refused recipient', () => {
  it('opted out, not eligible, recently contacted, daily limit, withdrawn and failed each show on their own row', async () => {
    stubFetch();
    const college = { id: 'c1', name: 'Stanford', sport: 'mens-soccer', division: 'NCAA D1', coaching_staff: REFUSALS.map(({ email, name }) => ({ name, email, title: 'Coach' })) };
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(EmailComposer, {
        open: true, onOpenChange: () => {}, player: PLAYER, college, allowImmediateSend: false,
        onSend: async () => ({ reachable: true, from: { requested: null, actual: null, mismatch: false }, results: REFUSALS }),
      })));
    });
    await flush();
    await click([...document.body.querySelectorAll('button')].find((b) => /^Prepare \d/.test(b.textContent.trim())));
    await flush();
    const badges = qa('[data-testid="refusal-badge"]').map((b) => b.textContent.trim());
    expect(badges).toEqual(['opted out', 'not eligible', 'recently contacted', 'daily limit reached', 'link withdrawn', 'failed']);
    expect(qa('[data-testid="refusal-badge"]')[1].getAttribute('title')).toMatch(/not been verified/);
  });

  it('with nobody to write to, shows the server\'s reason instead of "no verified email"', async () => {
    stubFetch();
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(EmailComposer, {
        open: true, onOpenChange: () => {}, player: PLAYER, allowImmediateSend: false,
        college: { id: 'c1', name: 'Stanford', sport: 'mens-soccer', division: 'NCAA D1', coaching_staff: [] },
        noRecipient: { reason: 'NAMED_COACH_HELD', summary: 'A coach at this programme is paused by an activation hold.', details: ['1 coach is paused by an activation hold'] },
        optedOutCoaches: [{ coach_id: 'x', name: 'Olive Optout', title: 'Head Coach' }],
        onSend: async () => ({ results: [] }),
      })));
    });
    await flush();
    expect(q('[data-testid="no-recipient-explanation"]').textContent).toContain('paused by an activation hold');
    expect(text()).not.toContain('No coaches with a verified email on file');
    expect(q('[data-testid="opted-out-coaches"]').textContent).toContain('Olive Optout');
  });

  it('without a server explanation (the Top 100 path), the old sentence remains', async () => {
    stubFetch();
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(EmailComposer, {
        open: true, onOpenChange: () => {}, player: PLAYER, allowImmediateSend: false,
        college: { id: 'c1', name: 'Stanford', sport: 'mens-soccer', division: 'NCAA D1', coaching_staff: [] },
        onSend: async () => ({ results: [] }),
      })));
    });
    await flush();
    expect(text()).toContain('No coaches with a verified email on file');
  });
});

describe('the bulk composer marks every refused recipient and counts them', () => {
  it('each refusal type has a word, and the run says how many were not prepared', async () => {
    const colleges = REFUSALS.map((r, i) => ({ id: `c${i}`, name: `School ${i}`, division: 'NCAA D1', match_score: 90 - i, coaching_staff: [{ name: r.name, email: r.email, title: 'Head Coach' }] }));
    stubFetch({
      '/outreach/send': (body) => ({
        reachable: true, from: { requested: null, actual: null, mismatch: false },
        results: [{ ...REFUSALS.find((r) => r.email === body.coaches[0].email), handoff: null }],
      }),
    });
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(BulkEmailComposer, { player: PLAYER, colleges, open: true, onOpenChange: () => {} })));
    });
    await flush();
    await click([...document.body.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Prepare')));
    for (let i = 0; i < 8; i += 1) await flush();
    expect(qa('[data-testid="bulk-refusal"]').map((b) => b.textContent.trim()).sort())
      .toEqual(['daily limit reached', 'failed', 'link withdrawn', 'not eligible', 'opted out', 'recently contacted']);
    expect(q('[data-testid="bulk-refused-summary"]').textContent).toContain('6 recipients were not prepared');
  });
});

describe('recording an opt-out', () => {
  it('is two steps, posts the reason and note but never an address, then shows the recorded state', async () => {
    let recorded = false;
    stubFetch({
      '/opt-out': (body) => {
        if (body) { recorded = true; return { optedOut: true, alreadyRecorded: false, reason: body.reason, recordedAt: '2026-10-09T10:00:00.000Z' }; }
        return recorded ? { optedOut: true, recordedAt: '2026-10-09T10:00:00.000Z' } : { optedOut: false };
      },
    });
    const onRecorded = vi.fn();
    await act(async () => { root.render(createElement(OptOutControl, { outreachId: 'out-1', recipientLabel: 'Vera Verified', onRecorded })); });
    await flush();
    expect(q('[data-testid="opt-out-recorded"]')).toBeNull();
    await click(q('[data-testid="opt-out-start"]'));
    expect(q('[data-testid="opt-out-confirm"]')).not.toBeNull();
    await act(async () => {
      const ta = q('[data-testid="opt-out-note"]');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'replied asking to be removed');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(q('[data-testid="opt-out-confirm-button"]'));
    await flush();
    const post = calls.find((c) => c.method === 'POST');
    expect(post.path).toBe('/api/engagement/outreach/out-1/opt-out');
    expect(post.body).toEqual({ reason: 'unsubscribed', note: 'replied asking to be removed' });
    expect(JSON.stringify(post.body)).not.toContain('@');
    expect(q('[data-testid="opt-out-recorded"]').textContent).toContain('Opted out');
    expect(onRecorded).toHaveBeenCalled();
  });

  it('an already opted-out recipient shows the recorded state and no button', async () => {
    stubFetch({ '/opt-out': () => ({ optedOut: true, recordedAt: '2026-10-01T00:00:00.000Z' }) });
    await act(async () => { root.render(createElement(OptOutControl, { outreachId: 'out-2' })); });
    await flush();
    expect(q('[data-testid="opt-out-recorded"]')).not.toBeNull();
    expect(q('[data-testid="opt-out-start"]')).toBeNull();
  });

  it('the Engagement table marks an opted-out recipient', async () => {
    await act(async () => {
      root.render(createElement(CoachTable, {
        coaches: [
          { outreach_id: 'o1', coach_name: 'Vera Verified', recipient_kind: 'COACH', school: 'Vera College', engagement_score: 0, tier: 'cold', qualified_visits: 0, best_coverage_pct: 0, total_rewinds: 0, opted_out: 1 },
          { outreach_id: 'o2', coach_name: 'Otto Other', recipient_kind: 'COACH', school: 'Vera College', engagement_score: 0, tier: 'cold', qualified_visits: 0, best_coverage_pct: 0, total_rewinds: 0, opted_out: 0 },
        ],
        onSelect: () => {}, onToggleResponded: () => {}, busyId: null,
      }));
    });
    expect(qa('[data-testid="opted-out-badge"]')).toHaveLength(1);
  });
});

describe('the Programme Database lists no opted-out contact, and says so', () => {
  it('names opted-out coaches and counts opted-out inboxes', async () => {
    stubFetch({
      '/coaches': () => ({ college: {}, coaches: [{ coach_id: 'c2', name: 'Otto Other', email: 'otto@x.test', title: 'Assistant' }], optedOut: [{ coach_id: 'c1', name: 'Vera Verified', title: 'Head Coach' }] }),
      '/programme-contacts': () => ({ programme: {}, contacts: [], withheld: 0, optedOut: 1 }),
    });
    await act(async () => { root.render(createElement(ContactsSection, { id: 'col-1' })); });
    await flush(); await flush();
    expect(q('[data-testid="contacts-coaches"]').textContent).toContain('Otto Other');
    expect(q('[data-testid="coaches-opted-out"]').textContent).toContain('Vera Verified');
    expect(q('[data-testid="inboxes-opted-out"]').textContent).toContain('1 programme inbox has opted out');
  });
});
