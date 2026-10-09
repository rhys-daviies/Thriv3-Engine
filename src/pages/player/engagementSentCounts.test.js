// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { corroborateFixtureCoaches } from '../../../server/testCanonicalCoaches.js';

/**
 * "SENT" COUNTS AND STATUS LABELS, TOGETHER, FROM THE REAL FLOW — Phase 5 PR B, check 2.
 *
 * Four manual drafts are prepared through the real `sendOutreach` (Outlook
 * mocked; nothing leaves the machine), then each is taken down a different
 * real path:
 *
 *   confirmed   the operator confirms it was sent  (confirmManualDraftSent)
 *   opened      handed to the mail app and left    (no call: opening is not sending)
 *   discarded   "I never sent this one"            (discardManualDraft)
 *   abandoned   prepared and never touched again
 *
 * The server's own `athleteEngagement` output is then rendered by the real
 * Engagement tab, and the counts and every row's label are read off the screen.
 * Only the confirmed one may count as sent.
 */
vi.mock('../../../server/lib/outlook.js', () => ({
  isOutlookAvailable: () => true,
  composeInOutlook: vi.fn(async () => ({ ok: true, sent: false })),
}));

const db = (await import('../../../server/db/client.js')).default;
const { sendOutreach } = await import('../../../server/routes/sendOutreach.js');
const { OUTREACH_ORIGIN } = await import('../../../shared/outreachOrigin.js');
const { confirmManualDraftSent, discardManualDraft } = await import('../../../server/lib/manualDraftConfirmation.js');
const { athleteEngagement } = await import('../../../server/lib/engagementQueries.js');
const { default: EngagementTab } = await import('./EngagementTab.jsx');
const workspace = await import('./PlayerWorkspace.jsx');

const T = '2026-09-20T10:00:00.000Z';
const ATH = `p5b-eng-${randomUUID().slice(0, 6)}`;
const NAME = 'Counts College';
const HOST = 'countsathletics.example';
const COACHES = ['Cora Confirmed', 'Otis Opened', 'Dana Discarded', 'Abe Abandoned'];
const emailOf = (i) => `coach${i}@${HOST}`;
const BODY = 'Hi Coach,\n\nI am writing about Marcus Reyes.\n\nBest regards,\nThriv3';

let payload;

beforeAll(async () => {
  db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES ('AE-CNT', ?, 961001, 'SINGLE', 'test', ?)").run(NAME, T);
  db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES ('col-counts', ?, ?, ?, 'mens-soccer', 'NCAA D3', 1, 961001, 'AE-CNT')").run(T, T, NAME);
  db.prepare("INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES (?, 961001, 'VERIFIED', 'ATHLETICS_SITE', '[]', '[961001]', 'TEST', 'CERTAIN', ?)").run(HOST, T);
  const ids = COACHES.map((name, i) => {
    db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, currentness_status)
      VALUES (?, ?, ?, ?, ?, 'NCAA D3', 'mens-soccer', 'Head Coach', 'verified', 'CURRENT')`).run(`co-cnt-${i}`, T, name, emailOf(i), NAME);
    return `co-cnt-${i}`;
  });
  corroborateFixtureCoaches(db, { ids });
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug, recruiting_class_year, email, video_id, video_chapters, graduation_year)
    VALUES (?, 'x', 'x', 'Marcus Reyes', 'W', 'mens-soccer', ?, 2027, 'a@example.test', 'aqz-KE-bpKQ', ?, 2027)`)
    .run(ATH, randomUUID().slice(0, 10), JSON.stringify([{ t: 10, label: 'Opening' }, { t: 60, label: 'Middle' }, { t: 120, label: 'Late' }]));

  // Prepare all four as MANUAL drafts, as the Specific Search route does: nothing is sent by this.
  for (let i = 0; i < COACHES.length; i += 1) {
    const { results } = await sendOutreach({
      athleteId: ATH, coaches: [{ name: COACHES[i], email: emailOf(i), title: 'Head Coach' }],
      subject: 'Marcus Reyes', body: BODY, greetingName: 'Coach', collegeName: NAME, division: 'NCAA D3', send: false,
      programmeCampaignId: null,
    }, { origin: OUTREACH_ORIGIN.MANUAL });   // exactly what the manual route passes
    expect(results[0].status).toBe('drafted');
  }
  const sendFor = (i) => db.prepare(`SELECT s.id FROM outreach_send s JOIN outreach o ON o.id = s.outreach_id
    WHERE o.athlete_id = ? AND o.coach_id = ?`).get(ATH, `co-cnt-${i}`).id;

  confirmManualDraftSent({ sendId: sendFor(0), athleteId: ATH, collegeName: NAME, sport: 'mens-soccer' });
  // 1: opened in the mail app and never confirmed - deliberately no call at all.
  discardManualDraft({ sendId: sendFor(2), athleteId: ATH, collegeName: NAME, sport: 'mens-soccer' });
  // 3: abandoned - nothing.

  payload = athleteEngagement(ATH);
});

describe('the server counts only the confirmed send', () => {
  it('sent 1, prepared 3, and only the confirmed row carries a send date', () => {
    expect(payload.funnel).toMatchObject({ sent: 1, prepared: 3 });
    const byName = Object.fromEntries(payload.coaches.map((c) => [c.coach_name, c]));
    expect(byName['Cora Confirmed'].sent_at).toBeTruthy();
    for (const n of ['Otis Opened', 'Dana Discarded', 'Abe Abandoned']) {
      expect(byName[n].sent_at).toBeNull();
      expect(byName[n].drafted_at).toBeTruthy();
    }
  });
});

describe('the Engagement tab shows the same thing, row by row', () => {
  let container; let root;
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('one "Sent", three "Prepared ..., not confirmed", and the funnel says 1 confirmed, 3 prepared', async () => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(workspace, 'usePlayerWorkspace').mockReturnValue({ player: { id: ATH } });
    const ok = (body) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
    vi.stubGlobal('fetch', vi.fn(async (path) => ok(String(path).includes('/api/engagement/athlete/') ? payload : { configured: false })));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(createElement(EngagementTab)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const rows = [...container.querySelectorAll('tbody tr')].map((tr) => ({
      name: tr.querySelector('td').textContent,
      status: tr.querySelector('[data-testid="outreach-status"]').textContent,
    }));
    const statusOf = (n) => rows.find((r) => r.name.startsWith(n)).status;
    expect(statusOf('Cora Confirmed')).toMatch(/^Sent /);
    for (const n of ['Otis Opened', 'Dana Discarded', 'Abe Abandoned']) expect(statusOf(n)).toMatch(/^Prepared .*not confirmed$/);
    expect(rows.filter((r) => /^Sent /.test(r.status))).toHaveLength(1);

    // The funnel's Sent figure is the same 1, and the 3 prepared are named as unconfirmed.
    const sentRow = [...container.querySelectorAll('span')].find((s) => s.textContent === 'Sent (confirmed)').parentElement;
    expect(sentRow.lastElementChild.textContent).toBe('1');
    expect(container.querySelector('[data-testid="funnel-prepared"]').textContent).toContain('3 prepared, not confirmed as sent');
    expect(container.querySelector('[data-testid="none-confirmed"]')).toBeNull();
  });
});
