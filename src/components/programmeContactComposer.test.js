// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import ManualOutreachDialog from './ManualOutreachDialog.jsx';
import CoachDetail from './engagement/CoachDetail.jsx';

/**
 * PHASE 1F — THE PROGRAMME CONTACT ON THE OPERATOR'S SCREENS.
 *
 * Where the server offers a programme contact (only when no eligible named coach exists), the
 * manual composer shows ONE recipient, "Programme Contact" with its programme as context, greets
 * "Hi Coach,", and posts the contact by id — never an address, never beside a coach. Engagement
 * and history rows for an inbox read "Programme Contact", never a person called "Coach".
 */
const PLAYER = { id: 'athlete-1', full_name: 'Nikau Brennan', sport: 'mens-soccer', position: 'Midfielder', recruiting_class_year: 2027 };
const RELATIONSHIP = { id: 'rel-1', athlete_id: 'athlete-1', college_name: 'Cornell', sport: 'mens-soccer', college_id: 'col-cornell', request_state: 'requested', visibility: 'default', contact_stance: 'default', division: 'NCAA D1' };
const PROGRAMME_CONTACT = { programme_contact_id: 'PC-abc', kind: 'PROGRAMME_INBOX', primary: 'Programme Contact', secondary: "Cornell Men's Soccer", isPerson: false, email: 'msoccer@cornell.example', contact_role: 'TEAM_INBOX' };
const HISTORY = [{ recipient_kind: 'PROGRAMME_INBOX', recipient_id: 'PC-abc', recipient_label: "Cornell Men's Soccer", coach_id: null, coach_name: null, position_title: null,
  first_confirmed_send_at: '2026-09-01T11:00:00.000Z', last_confirmed_send_at: '2026-09-01T11:00:00.000Z', accepted_count: 1, draft_count: 0, record_count: 1, has_confirmed_send: true, origins: ['manual'] }];

let container; let root; let calls;
const ok = (payload) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => payload, text: async () => JSON.stringify(payload) });
function stubFetch(context) {
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET'; const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method, body });
    if (path.includes('/outreach') && method === 'GET') return ok(context);
    if (path.includes('/outreach')) return ok({ results: [{ email: PROGRAMME_CONTACT.email, name: 'Programme Contact', status: 'drafted' }], reachable: true, from: 'ops@thriv3.test' });
    if (path.includes('/evidence')) return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, { sentences: [], offers: [] }])));
    return ok({});
  }));
}
const render = async (el) => { await act(async () => { root.render(createElement(MemoryRouter, null, el)); }); };
const text = () => document.body.textContent;
const textarea = () => document.body.querySelector('textarea');
const composeButton = () => Array.from(document.body.querySelectorAll('button')).find((b) => /^Prepare \d|^Send \d|Working/.test(b.textContent.trim()));
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

beforeEach(() => { calls = []; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const context = (over = {}) => ({ relationship: RELATIONSHIP, college: { id: 'col-cornell', name: 'Cornell', sport: 'mens-soccer', division: 'NCAA D1' }, coaches: [], programmeContact: PROGRAMME_CONTACT,
  contact: { allowed: true, stance: 'default', reason: null }, priorContact: HISTORY, contactIntelligence: null, ...over });
const open = () => createElement(ManualOutreachDialog, { player: PLAYER, relationshipId: 'rel-1', open: true, onOpenChange: () => {} });

describe('ManualOutreachDialog — Programme Contact', () => {
  it('shows ONE recipient, "Programme Contact" with the programme as context, and explains it is a shared inbox', async () => {
    stubFetch(context());
    await render(open());
    const row = document.body.querySelector('[data-testid="programme-contact-recipient"]');
    expect(row.textContent).toContain('Programme Contact');
    expect(row.textContent).toContain("Cornell Men's Soccer");
    expect(row.textContent).toMatch(/shared programme inbox, not an individual coach/i);
    expect(text()).not.toMatch(/Coach Programme Contact|Hi Cornell|Hi Men's Soccer|Hi Programme/);
  });
  it('greets "Hi Coach," and never a name', async () => {
    stubFetch(context());
    await render(open());
    expect(textarea().value.split('\n')[0]).toBe('Hi Coach,');
  });
  it('posts the programme contact BY ID, with no coaches and no address', async () => {
    stubFetch(context());
    await render(open());
    await click(composeButton());
    const post = calls.find((c) => c.method === 'POST' && c.path.includes('/outreach'));
    expect(post.body).toMatchObject({ programmeContactId: 'PC-abc', greetingName: 'Coach', send: false });
    expect(post.body).not.toHaveProperty('coachIds');
    expect(post.body).not.toHaveProperty('coaches');
  });
  it('shows earlier inbox outreach as "Programme Contact", not as a blank or a person', async () => {
    stubFetch(context());
    await render(open());
    expect(text()).toMatch(/Programme Contact — Cornell Men's Soccer/);
  });
  it('offers no programme contact when the server named coaches instead (coach-first)', async () => {
    stubFetch(context({ coaches: [{ coach_id: 'c1', name: 'Head Person', email: 'head@cornell.example', title: 'Head Coach', email_status: 'verified' }], programmeContact: null }));
    await render(open());
    expect(document.body.querySelector('[data-testid="programme-contact-recipient"]')).toBeNull();
    expect(text()).toContain('Head Person');
  });
});

describe('a custom template that names the coach', () => {
  it('refuses to compose for the inbox, says why, and offers no send', async () => {
    stubFetch(context());
    const custom = { ...PLAYER, email_template: 'Hi {{coach_first_name}},\n\nCoach {{coach_name}}, about Nikau.' };
    await render(createElement(ManualOutreachDialog, { player: custom, relationshipId: 'rel-1', open: true, onOpenChange: () => {} }));
    expect(document.body.querySelector('[data-testid="inbox-composition-refusal"]').textContent).toMatch(/names the coach outside its greeting/);
    expect(composeButton().disabled).toBe(true);
    expect(textarea().value).toBe('');
  });
});

describe('Engagement detail for an inbox', () => {
  it('reads "Programme Contact" with the programme, never "Coach"', async () => {
    stubFetch(context());
    await render(createElement(CoachDetail, { coach: { outreach_id: 'o-inbox', recipient_kind: 'PROGRAMME_INBOX', recipient_label: "Cornell Men's Soccer", coach_name: null, school: 'Cornell', division: 'NCAA D1', engagement_score: 70, tier: 'warm', events: [] }, onBack: () => {} }));
    const h3 = container.querySelector('h3');
    expect(h3.textContent).toBe('Programme Contact');
    expect(container.textContent).toContain("Cornell Men's Soccer");
  });
});
