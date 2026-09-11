// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import EmailComposer from './EmailComposer.jsx';
import ManualOutreachDialog from './ManualOutreachDialog.jsx';

/**
 * The composer had no test at all, which is how it came to be the thing every
 * outreach path depends on and nobody could change safely.
 *
 * These are about REUSE rather than appearance: that a programme with no
 * recommendation behind it composes exactly as one with, that the canonical
 * staff reaches the recipient list, that drafting stays the default, and that
 * a relationship the server has refused produces no composer at all.
 *
 * Deliberately not assertions about layout. What matters is what is sent and
 * what is asked for.
 */

const PLAYER = {
  id: 'athlete-1', full_name: 'Nikau Brennan', sport: 'mens-soccer',
  position: 'Midfielder', recruiting_class_year: 2027,
};

/** Straight off a `colleges` row — no rank, no score, no breakdown. */
const CANONICAL_COLLEGE = {
  id: 'col-stanford', name: 'Stanford', sport: 'mens-soccer',
  division: 'NCAA D1', conference: 'ACC', city: 'Stanford', state: 'CA',
  nickname: 'Cardinal', notable_majors: [],
};

const COACHES = [
  { coach_id: 'coach-1', name: 'Head Person', email: 'head@stanford.test', title: 'Head Coach', email_status: 'verified' },
  { coach_id: 'coach-2', name: 'Assistant Person', email: 'asst@stanford.test', title: 'Assistant Coach', email_status: null },
];

const RELATIONSHIP = {
  id: 'rel-1', athlete_id: 'athlete-1', college_name: 'Stanford', sport: 'mens-soccer',
  college_id: 'col-stanford', request_state: 'requested', flagged: true,
  flag_reason: 'Thriv3 personal contact', visibility: 'suppressed',
  contact_stance: 'manual_only', note: 'Call the father first',
  division: 'NCAA D1', conference: 'ACC',
};

let container;
let root;
let calls;

const ok = (payload) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' },
  json: async () => payload, text: async () => JSON.stringify(payload),
});

function stubFetch({ context = null, sendResult = null, contextStatus = 200 } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method, body });

    if (path.includes('/outreach') && method === 'GET') {
      if (contextStatus !== 200) {
        return { ok: false, status: contextStatus, headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({ error: 'nope' }) };
      }
      return ok(context);
    }
    if (path.includes('/outreach')) {
      return ok(sendResult ?? { results: [], reachable: true, from: 'ops@thriv3.test' });
    }
    if (path.includes('/evidence')) {
      return ok(Object.fromEntries((body?.collegeNames ?? []).map((n) => [n, { sentences: [], offers: [] }])));
    }
    if (path.includes('/coaches/email-status')) return ok({});
    return ok({});
  }));
}

const render = async (el) => {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, el));
  });
};
/**
 * Queried off `document.body`, not off the mount node.
 *
 * Both of these render through a Radix Dialog, which portals its content out
 * of the React tree and into the body. Asserting against the container finds
 * an empty string and says nothing at all.
 */
const scope = () => document.body;
const text = () => scope().textContent;
const buttons = () => Array.from(scope().querySelectorAll('button'));
const buttonWith = (label) => buttons().find((b) => b.textContent.trim().startsWith(label));
/**
 * The composer's primary action, found by role rather than by wording.
 *
 * Its label says what will happen — "Open 2 drafts in Outlook" or "Send 2
 * emails" — and matching on that would make these tests fail the day somebody
 * improves a sentence. What identifies it is that it is the one button that
 * composes.
 */
const composeButton = () => buttons().find((b) => /Outlook|^Send \d|Working/.test(b.textContent));
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const sendCalls = () => calls.filter((c) => c.method === 'POST' && c.path.includes('/outreach'));

beforeEach(() => {
  calls = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe('EmailComposer with a canonical college and no recommendation', () => {
  const canonical = { ...CANONICAL_COLLEGE, coaching_staff: COACHES };

  it('composes without a rank, score, breakdown or campaign', async () => {
    stubFetch();
    await render(createElement(EmailComposer, {
      player: PLAYER, college: canonical, open: true, onOpenChange: () => {},
    }));

    // Nothing about the college it was handed came from a matching run.
    expect(canonical.match_score).toBeUndefined();
    expect(canonical.breakdown).toBeUndefined();
    expect(text()).toContain('Stanford');
    expect(composeButton()).toBeTruthy();
  });

  it('lists the canonical staff as recipients', async () => {
    stubFetch();
    await render(createElement(EmailComposer, {
      player: PLAYER, college: canonical, open: true, onOpenChange: () => {},
    }));
    expect(text()).toContain('Head Person');
    expect(text()).toContain('Assistant Person');
  });

  it('asks the evidence engine about this athlete and this college', async () => {
    stubFetch();
    await render(createElement(EmailComposer, {
      player: PLAYER, college: canonical, open: true, onOpenChange: () => {},
    }));
    const evidence = calls.find((c) => c.path.includes('/evidence'));
    expect(evidence.path).toContain('athlete-1');
    expect(evidence.body.collegeNames).toEqual(['Stanford']);
  });

  it('drafts rather than sends, unless the operator opts in', async () => {
    stubFetch();
    const onSend = vi.fn(async () => ({ results: [], reachable: true, from: null }));
    await render(createElement(EmailComposer, {
      player: PLAYER, college: canonical, open: true, onOpenChange: () => {}, onSend,
    }));
    await click(composeButton());

    expect(onSend).toHaveBeenCalledTimes(1);
    // The default everywhere it is absent.
    expect(onSend.mock.calls[0][0].send).toBe(false);
  });

  it('hands the injected sender the operator’s decisions and nothing else', async () => {
    stubFetch();
    const onSend = vi.fn(async () => ({ results: [], reachable: true, from: null }));
    await render(createElement(EmailComposer, {
      player: PLAYER, college: canonical, open: true, onOpenChange: () => {}, onSend,
    }));
    await click(composeButton());

    const composed = onSend.mock.calls[0][0];
    expect(composed.coaches.map((c) => c.email))
      .toEqual(['head@stanford.test', 'asst@stanford.test']);
    expect(composed).toHaveProperty('subject');
    expect(composed).toHaveProperty('body');
    // The composer does not decide any of these, and does not send them.
    for (const owned of ['origin', 'programmeCampaignId', 'collegeName', 'athleteId', 'matchId']) {
      expect(composed, owned).not.toHaveProperty(owned);
    }
  });

  it('still uses the shared endpoint when nothing is injected', async () => {
    stubFetch();
    await render(createElement(EmailComposer, {
      player: PLAYER, college: canonical, open: true, onOpenChange: () => {},
    }));
    await click(composeButton());

    // Unchanged default behaviour: the match-card path is untouched.
    const post = sendCalls()[0];
    expect(post.path).toBe('/api/outreach/send');
    expect(post.body.collegeName).toBe('Stanford');
    expect(post.body.matchId).toBe('Stanford');
  });
});

// ---------------------------------------------------------------------------

describe('ManualOutreachDialog', () => {
  const context = {
    relationship: RELATIONSHIP,
    college: CANONICAL_COLLEGE,
    coaches: COACHES,
    contact: { allowed: true, stance: 'manual_only', reason: null },
    priorContact: [{
      coach_id: 'coach-1', coach_name: 'Head Person', position_title: 'Head Coach',
      drafted_at: '2026-09-01T10:00:00.000Z', sent_at: '2026-09-01T11:00:00.000Z',
      message_count: 2, revoked_at: null,
    }],
  };

  const open = (over = {}) => createElement(ManualOutreachDialog, {
    player: PLAYER, relationshipId: 'rel-1', open: true, onOpenChange: () => {}, ...over,
  });

  it('fetches the relationship context by id', async () => {
    stubFetch({ context });
    await render(open());
    expect(calls[0].path).toBe('/api/players/athlete-1/programmes/rel-1/outreach');
    expect(calls[0].method).toBe('GET');
  });

  it('shows why this school is special, and what was already sent', async () => {
    stubFetch({ context });
    await render(open());
    expect(text()).toContain('Specific Request');
    expect(text()).toContain('Existing relationship');
    expect(text()).toContain('Thriv3 personal contact');
    expect(text()).toContain('Call the father first');
    expect(text()).toContain('Head Person');
    expect(text()).toMatch(/last sent/i);
  });

  it('composes for a suppressed, manual-only relationship', async () => {
    stubFetch({ context });
    await render(open());
    // Removed from the Top 100 and flagged, and neither is a contact decision.
    expect(text()).toContain('Not in Top 100');
    expect(text()).toContain('Manual only');
    expect(text()).toContain('Stanford');
    expect(composeButton()).toBeTruthy();
  });

  it('renders NO composer when the server refused the relationship', async () => {
    stubFetch({
      context: {
        ...context,
        contact: { allowed: false, stance: 'do_not_contact', reason: 'RELATIONSHIP_DO_NOT_CONTACT' },
      },
    });
    await render(open());

    expect(text()).toMatch(/do-not-contact/i);
    // No composer, and no way to reach one.
    expect(composeButton()).toBeUndefined();
    expect(scope().querySelector('textarea')).toBeNull();
  });

  it('sends through the relationship endpoint, naming coaches by id', async () => {
    stubFetch({ context });
    await render(open());
    await click(composeButton());

    const post = sendCalls()[0];
    expect(post.path).toBe('/api/players/athlete-1/programmes/rel-1/outreach');
    expect(post.body.coachIds).toEqual(['coach-1', 'coach-2']);
    expect(post.body.send).toBe(false);
    // Addresses are resolved server-side against this programme's own staff.
    expect(post.body).not.toHaveProperty('coaches');
    // Not the shared endpoint.
    expect(calls.some((c) => c.path === '/api/outreach/send')).toBe(false);
  });

  it('never names a server-owned field in its request', async () => {
    stubFetch({ context });
    await render(open());
    await click(composeButton());

    const sent = JSON.stringify(sendCalls()[0].body);
    for (const owned of ['origin', 'programmeCampaignId', 'contact_stance', 'visibility',
      'flagged', 'request_state', 'collegeName', 'athleteId']) {
      expect(sent, owned).not.toContain(`"${owned}"`);
    }
  });

  it('says so when the context cannot be loaded', async () => {
    stubFetch({ contextStatus: 500 });
    await render(open());
    expect(composeButton()).toBeUndefined();
    expect(scope().querySelector('[role="alert"]')).toBeTruthy();
  });
});
