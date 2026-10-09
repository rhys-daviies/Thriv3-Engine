// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import EditPlayer from './EditPlayer.jsx';
import { playerStatusLabel } from './Players.jsx';
import OutreachFunnel from '@/components/engagement/OutreachFunnel.jsx';
import CoachTable from '@/components/engagement/CoachTable.jsx';
import PublishCard from '@/components/PublishCard.jsx';
import { changedMatchingInputs } from '@shared/matchingInputFields.js';

/**
 * DATA AND MESSAGING ACCURACY, ON SCREEN — Phase 5, PR B.
 *
 *   #4  "Sent" is confirmed sends; prepared drafts are named as unconfirmed.
 *   #5  A save that changes nothing matching reads keeps the previous engine's
 *       analysis; the Players badge reads Matcher V2.
 *   #8  The Profile tab says when the live page is behind the record.
 */
let container; let root; let calls;
const ok = (payload) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => payload, text: async () => JSON.stringify(payload) });

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  calls = [];
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const q = (sel) => container.querySelector(sel);

describe('#5 a save keeps the previous engine\'s analysis unless matching inputs changed', () => {
  const STORED = {
    id: 'p1', full_name: 'Jordan Smith', position: 'CB', sport: 'mens-soccer', recruiting_class_year: 2028,
    football_ability: 6, preferred_divisions: ['NCAA D1'], preferred_conferences: [], contribution_state: 'NOT_A_CONSTRAINT',
    origin: 'USA', state: 'CA',
    recommendations: 'file:///stored-v1-analysis.json', status: 'Analyzed', representative_id: null,
  };

  async function saveUnchanged(stored) {
    vi.stubGlobal('fetch', vi.fn(async (path, opts = {}) => {
      calls.push({ path: String(path), method: opts.method ?? 'GET', body: opts.body ? JSON.parse(opts.body) : null });
      if (String(path).includes('/api/entities/players/p1') && (opts.method ?? 'GET') === 'GET') return ok(stored);
      if (String(path).includes('/api/entities/colleges')) return ok([]);
      return ok(stored);
    }));
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/player/p1/edit'] },
        createElement(Routes, null,
          createElement(Route, { path: '/player/:id/edit', element: createElement(EditPlayer) }),
          createElement(Route, { path: '/player/:id', element: createElement('p', null, 'workspace') }))));
    });
    await flush(); await flush();
    await act(async () => { q('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    return calls.find((c) => c.method === 'PUT')?.body;
  }

  it('saving with no matching change sends no recommendations or status: the stored analysis survives', async () => {
    const put = await saveUnchanged(STORED);
    expect(put).toBeTruthy();
    expect(put).not.toHaveProperty('recommendations');
    expect(put).not.toHaveProperty('status');
  });

  it('a field the form fills in for the first time IS a matching change, and clears it - as a V2 run would go stale', async () => {
    const put = await saveUnchanged({ ...STORED, origin: null });
    expect(put).toMatchObject({ recommendations: null, status: 'New', origin: 'USA' });
  });

  it('the subtitle no longer says every save clears matches', async () => {
    await saveUnchanged(STORED);
    expect(fs.readFileSync('src/pages/EditPlayer.jsx', 'utf8')).not.toContain("Saving will clear existing match recommendations");
  });

  it('the matching-input rule: representative, bio and contact changes are not matching inputs; position and preferences are', () => {
    const base = { position: 'CB', preferred_regions: ['WEST', 'SOUTH'], match_weights: { a: 1 } };
    expect(changedMatchingInputs(base, { ...base, representative_id: 'r1', bio: 'x', email: 'y@example.test' })).toEqual([]);
    expect(changedMatchingInputs(base, { ...base, preferred_regions: ['SOUTH', 'WEST'] })).toEqual([]);   // order is not a change
    expect(changedMatchingInputs(base, { ...base, position: 'FB' })).toEqual(['position']);
    expect(changedMatchingInputs(base, { ...base, preferred_states: ['NY'] })).toEqual(['preferred_states']);
    expect(changedMatchingInputs(base, { ...base, match_weights: { a: 2 } })).toEqual(['match_weights']);
    expect(changedMatchingInputs({ gpa: null }, { gpa: '' })).toEqual([]);                                  // empty is empty
  });

  it('the Players badge reads Matcher V2: an athlete with a V2 run is Matched, not New', () => {
    expect(playerStatusLabel({ status: null, latest_match_run_at: '2026-10-09T10:00:00.000Z' })).toBe('Matched');
    expect(playerStatusLabel({ status: 'New', latest_match_run_at: '2026-10-09T10:00:00.000Z' })).toBe('Matched');
    expect(playerStatusLabel({ status: null, latest_match_run_at: null })).toBe('New');
    expect(playerStatusLabel({ status: 'Committed', latest_match_run_at: '2026-10-09T10:00:00.000Z' })).toBe('Committed');
  });
});

describe('#4 "Sent" means confirmed sent', () => {
  it('the funnel labels confirmed sends, counts prepared drafts apart, and flags engagement on an unconfirmed one', async () => {
    await act(async () => {
      root.render(createElement(OutreachFunnel, { funnel: { sent: 1, prepared: 3, qualified: 2, watchedHalf: 1, returned: 0, engagedUnconfirmed: 1 } }));
    });
    expect(container.textContent).toContain('Sent (confirmed)');
    expect(q('[data-testid="funnel-prepared"]').textContent).toContain('3 prepared, not confirmed as sent');
    expect(q('[data-testid="funnel-engaged-unconfirmed"]').textContent).toContain('1 recipient has engaged with a message not confirmed as sent');
    // bars never exceed 100% when engagement outruns confirmations
    const widths = [...container.querySelectorAll('[style]')].map((el) => parseFloat(el.style.width));
    expect(Math.max(...widths)).toBeLessThanOrEqual(100);
  });

  it('each coach row says sent or prepared-not-confirmed', async () => {
    const row = { recipient_kind: 'COACH', school: 'S', engagement_score: 0, tier: 'cold', qualified_visits: 0, best_coverage_pct: 0, total_rewinds: 0 };
    await act(async () => {
      root.render(createElement(CoachTable, {
        coaches: [
          { ...row, outreach_id: 'o1', coach_name: 'Confirmed Coach', drafted_at: '2026-10-01T00:00:00.000Z', sent_at: '2026-10-02T00:00:00.000Z' },
          { ...row, outreach_id: 'o2', coach_name: 'Draft Coach', drafted_at: '2026-10-01T00:00:00.000Z', sent_at: null },
        ],
        onSelect: () => {}, onToggleResponded: () => {}, busyId: null,
      }));
    });
    const statuses = [...container.querySelectorAll('[data-testid="outreach-status"]')].map((td) => td.textContent);
    expect(statuses[0]).toMatch(/^Sent /);
    expect(statuses[1]).toMatch(/^Prepared .*not confirmed$/);
  });

  it('an athlete with only prepared drafts is not shown "No outreach sent yet" as if nothing happened', () => {
    const src = fs.readFileSync('src/pages/player/EngagementTab.jsx', 'utf8');
    expect(src).toContain('data.funnel.sent === 0 && !data.funnel.prepared');
    expect(src).toContain('none is confirmed as sent yet');
  });
});

describe('#8 the Profile tab says when the live page is behind the record', () => {
  const STATUS = {
    canPublish: true, missing: [], archived: false, publishedAt: '2026-10-01T00:00:00.000Z',
    url: 'https://pages.example.test/p/abc.html', previewUrl: 'http://localhost/p/abc.html', reachable: true,
    baseUrl: 'https://pages.example.test', publisherReady: true, publisherProblems: [],
  };
  const mount = async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(status)));
    await act(async () => { root.render(createElement(PublishCard, { playerId: 'p1', playerName: 'Jordan' })); });
    await flush();
  };

  it('a representative edited since publishing: says coaches still see the old details', async () => {
    await mount({ ...STATUS, liveOutdated: { reasons: ['REPRESENTATIVE_EDITED'], since: STATUS.publishedAt } });
    expect(q('[data-testid="live-outdated"]').textContent).toContain('coaches still see the old details');
    expect(q('[data-testid="live-outdated"]').textContent).toContain('Update live page');
  });

  it('the record changed since publishing: says the page may be out of date', async () => {
    await mount({ ...STATUS, liveOutdated: { reasons: ['PROFILE_CHANGED'], since: STATUS.publishedAt } });
    expect(q('[data-testid="live-outdated"]').textContent).toContain('may be out of date');
  });

  it('up to date: no warning', async () => {
    await mount({ ...STATUS, liveOutdated: null });
    expect(q('[data-testid="live-outdated"]')).toBeNull();
  });
});
