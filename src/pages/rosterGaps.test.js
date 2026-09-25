// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

/**
 * L7L — the review screen.
 *
 * Driven through a real React root rather than a testing library, which is not
 * a dependency here, following `src/lib/useOperatorEvidence.test.js`.
 *
 * What is being defended is mostly what the screen must NOT do: offer a machine
 * fact as something a person may conclude, let an invalid pairing be submitted,
 * or show a review as saved when the request failed.
 */

vi.mock('@/api/client', () => ({
  rosterGaps: {
    queue: (...a) => globalThis.__queue(...a),
    review: (...a) => globalThis.__review(...a),
  },
}));

const { default: RosterGaps } = await import('./RosterGaps.jsx');

const VOCAB = {
  dispositions: [
    { value: 'SOURCE_NOT_AVAILABLE', allowedActions: ['RETRY_ACQUISITION', 'NONE'] },
    { value: 'PROGRAMME_STATUS_QUESTION', allowedActions: ['CONFIRM_PROGRAMME_STATUS', 'NONE'] },
    { value: 'SITE_TEMPORARILY_UNAVAILABLE', allowedActions: ['RETRY_AFTER'] },
  ],
  nextActions: ['RETRY_ACQUISITION', 'RETRY_AFTER', 'CONFIRM_PROGRAMME_STATUS', 'NONE'],
  evidenceMaxLength: 400,
};

const row = (o = {}) => ({
  key: `${o.school ?? 'Alpha'}||mens-soccer`,
  school: o.school ?? 'Alpha',
  sport: 'mens-soccer',
  gender: 'M',
  division: 'NCAA D3',
  unitid: 1,
  machine: {
    candidateState: 'NEW_VERIFIED_HOST_CANDIDATES',
    candidates: 24,
    fetchHosts: ['alpha.test'],
    lastStatus: 'failed',
    lastStage: 'variants',
    lastFailureClass: null,
    lastError: 'no candidate',
    lastAttempts: 1,
    recordedStale: true,
    ...o.machine,
  },
  operator: {
    reviewStatus: 'UNREVIEWED',
    disposition: null,
    nextAction: null,
    retryAfter: null,
    reviewedAt: null,
    reviewedByOperatorId: null,
    evidence: null,
    previousDisposition: null,
    previousReviewedAt: null,
    ...o.operator,
  },
  retryEligible: o.retryEligible ?? true,
  retryReason: o.retryReason ?? 'unreviewed',
});

const QUEUE = (rows) => ({
  season: 2026,
  rows,
  summary: {
    ncaaTotal: 1761,
    ncaaWithRoster: 1744,
    registryDuplicates: 7,
    legitimateGaps: rows.length,
    reconciles: true,
    reviewed: rows.filter((r) => r.operator.reviewStatus === 'REVIEWED').length,
    unreviewed: rows.filter((r) => r.operator.reviewStatus === 'UNREVIEWED').length,
    retryEligible: rows.filter((r) => r.retryEligible).length,
    retryHeld: rows.filter((r) => !r.retryEligible).length,
    byCandidateState: {}, byFailureClass: {}, byDisposition: {},
    recordedReasonStale: rows.filter((r) => r.machine.recordedStale).length,
  },
  vocabulary: VOCAB,
});

let container; let root;

async function render(queue) {
  globalThis.__queue = vi.fn().mockResolvedValue(queue);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(RosterGaps)));
  });
}

const text = () => container.textContent;
/*
 * document.body, not the container: the dialog is a Radix portal and renders
 * outside the React root's own node, so a container-scoped query finds the
 * queue and none of the form.
 */
const buttons = () => [...document.body.querySelectorAll('button')];
const byText = (t) => buttons().find((b) => b.textContent.trim() === t);
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.__review = vi.fn().mockResolvedValue({ review: {} });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */

describe('the queue screen', () => {
  const ten = Array.from({ length: 10 }, (_, i) => row({ school: `School ${i}` }));

  it('loads the queue and lists every gap', async () => {
    await render(QUEUE(ten));
    expect(globalThis.__queue).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(10);
    expect(text()).toContain('School 0');
  });

  it('shows the duplicate adjustment rather than a bare denominator', async () => {
    await render(QUEUE(ten));
    expect(text()).toContain('1744 of 1754 legitimate programmes hold a roster');
    expect(text()).toContain('7 duplicate registry rows excluded');
  });

  it('distinguishes reviewed from unreviewed', async () => {
    await render(QUEUE([
      row({ school: 'Unseen' }),
      row({ school: 'Seen', operator: { reviewStatus: 'REVIEWED', disposition: 'SOURCE_NOT_AVAILABLE', nextAction: 'NONE' } }),
    ]));
    expect(text()).toContain('Unreviewed');
    expect(text()).toContain('No source found');
  });

  it('filters to unreviewed and back', async () => {
    await render(QUEUE([
      row({ school: 'Unseen' }),
      row({ school: 'Seen', operator: { reviewStatus: 'REVIEWED', disposition: 'SOURCE_NOT_AVAILABLE' } }),
    ]));
    await click(byText('Unreviewed'));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(text()).toContain('Unseen');
    await click(byText('All'));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('says so when a recorded reason is out of date', async () => {
    await render(QUEUE([row()]));
    expect(text()).toContain('recorded reason out of date');
  });

  it('reports a load failure instead of an empty queue', async () => {
    globalThis.__queue = vi.fn().mockRejectedValue(new Error('boom'));
    await act(async () => { root.render(createElement(MemoryRouter, null, createElement(RosterGaps))); });
    expect(text()).toContain('The queue could not be loaded.');
    expect(text()).toContain('boom');
  });
});

describe('the review dialog', () => {
  const open = async (r = row()) => {
    await render(QUEUE([r]));
    await click(byText('Review'));
  };

  it('keeps machine findings and operator review in separate sections', async () => {
    await open();
    const headings = [...document.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toContain('Programme');
    expect(headings).toContain('Machine findings — read only');
    expect(headings).toContain('Operator review');
  });

  it('offers exactly the three human dispositions', async () => {
    await open();
    const labels = buttons().map((b) => b.textContent.trim());
    expect(labels).toContain('No source found');
    expect(labels).toContain('Programme status in question');
    expect(labels).toContain('Site temporarily unavailable');
  });

  it('never offers NO_HOST or MANUAL_REVIEW as a conclusion', async () => {
    await open(row({ machine: { candidateState: 'NO_TRUSTED_HOST', candidates: 0, recordedStale: false } }));
    const labels = buttons().map((b) => b.textContent.trim());
    expect(labels).not.toContain('No trusted athletics host');
    expect(labels).not.toContain('Manual review');
    // the machine fact is still shown, in the machine's own section
    expect(document.body.textContent).toContain('No trusted athletics host');
  });

  it('derives the next actions from the chosen disposition', async () => {
    await open();
    await click(byText('Programme status in question'));
    const labels = buttons().map((b) => b.textContent.trim());
    expect(labels).toContain('Someone must confirm the programme status');
    expect(labels).not.toContain('Try acquiring again');
  });

  it('drops an action that the new disposition does not allow', async () => {
    await open();
    await click(byText('No source found'));
    await click(byText('Try acquiring again'));
    await click(byText('Programme status in question'));
    // no stale selection survives into a pairing the server would refuse
    const save = byText('Save review');
    expect(save.disabled).toBe(true);
  });

  it('requires a date for a temporary condition', async () => {
    await open();
    await click(byText('Site temporarily unavailable'));
    await click(byText('Try again after a date'));
    const evidence = document.querySelector('#evidence');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(evidence, 'host returns 503 on every route');
      evidence.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(byText('Save review').disabled).toBe(true);
    expect(document.querySelector('#retry-after')).toBeTruthy();
  });

  it('requires a reason', async () => {
    await open();
    await click(byText('No source found'));
    await click(byText('Nothing to do for now'));
    expect(byText('Save review').disabled).toBe(true);
  });

  it('saves a complete review and reloads the queue', async () => {
    await open();
    await click(byText('No source found'));
    await click(byText('Try acquiring again'));
    const evidence = document.querySelector('#evidence');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(evidence, 'trusted host answers, no roster path on it');
      evidence.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(byText('Save review'));
    expect(globalThis.__review).toHaveBeenCalledWith(expect.objectContaining({
      school: 'Alpha',
      sport: 'mens-soccer',
      disposition: 'SOURCE_NOT_AVAILABLE',
      nextAction: 'RETRY_ACQUISITION',
      retryAfter: null,
      evidence: 'trusted host answers, no roster path on it',
    }));
    expect(globalThis.__queue).toHaveBeenCalledTimes(2);   // reloaded
  });

  it('does not show a review as saved when persistence failed', async () => {
    globalThis.__review = vi.fn().mockRejectedValue(new Error('server said no'));
    await open();
    await click(byText('No source found'));
    await click(byText('Nothing to do for now'));
    const evidence = document.querySelector('#evidence');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(evidence, 'looked, nothing there');
      evidence.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(byText('Save review'));
    expect(document.body.textContent).toContain('That review was not saved.');
    expect(document.body.textContent).toContain('server said no');
    expect(globalThis.__queue).toHaveBeenCalledTimes(1);   // NOT reloaded
  });

  it('shows one previous review, compactly', async () => {
    await open(row({
      operator: {
        reviewStatus: 'REVIEWED', disposition: 'SOURCE_NOT_AVAILABLE', nextAction: 'NONE',
        evidence: 'nothing found', previousDisposition: 'PROGRAMME_STATUS_QUESTION',
        previousReviewedAt: '2026-08-01T00:00:00.000Z',
      },
    }));
    expect(document.body.textContent)
      .toContain('Previously reviewed as Programme status in question on 2026-08-01');
  });
});
