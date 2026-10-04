import { describe, it, expect, afterEach, vi } from 'vitest';
import { sendError, SEND_ERROR } from '@/lib/campaignLabels';
import { campaigns } from '@/api/client';

/**
 * WHAT THE OPERATOR IS TOLD WHEN A SEND IS REFUSED BECAUSE THE COACH IS NO LONGER ELIGIBLE.
 *
 * The server answers 422 with `{ error, code: 'COACH_NOT_OUTREACH_ELIGIBLE' }`. The real client
 * attaches `code` and `status` to the error it throws; `sendError` turns that into operator copy
 * instead of the generic failure. These tests drive the REAL client against a stubbed `fetch`, so
 * the shape under test is the shape that actually arrives.
 */
afterEach(() => { vi.unstubAllGlobals(); });

const respond = (status, body) => vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  text: async () => JSON.stringify(body),
  json: async () => body,
})));

const refusal = async () => {
  respond(422, { error: 'This coach is not outreach-eligible (EMAIL_NOT_VERIFIED:inferred). Nothing was claimed and no capacity was spent.', code: 'COACH_NOT_OUTREACH_ELIGIBLE' });
  try { await campaigns.sendMessage('m1', { bodyHash: 'h', connectedMailboxId: 'box' }); } catch (e) { return e; }
  throw new Error('expected the send to reject');
};

describe('sendError — COACH_NOT_OUTREACH_ELIGIBLE', () => {
  it('the client carries the server’s structured code and status on the error', async () => {
    const err = await refusal();
    expect(err.status).toBe(422);
    expect(err.code).toBe('COACH_NOT_OUTREACH_ELIGIBLE');
  });

  it('resolves to an explicit message, not the generic failure', async () => {
    const copy = sendError(await refusal());
    expect(copy).toBe(SEND_ERROR.COACH_NOT_OUTREACH_ELIGIBLE);
    expect(copy.message).toMatch(/not currently eligible for outreach/i);
    expect(copy.message).toMatch(/verified outreach standard/i);
    expect(copy).not.toBe(sendError({ status: 500 }));
  });

  it('says plainly that nothing left and no capacity was used, and tells the page to look again', async () => {
    const copy = sendError(await refusal());
    expect(copy.message).toMatch(/nothing was sent/i);
    expect(copy.message).toMatch(/no sending capacity was used/i);
    expect(copy.refresh).toBe(true);
  });

  it('exposes no internal detail: no code names, status values, setting names or the server’s own sentence', async () => {
    const err = await refusal();
    const { message } = sendError(err);
    for (const internal of [/COACH_NOT_OUTREACH_ELIGIBLE/, /EMAIL_NOT_VERIFIED/, /PROVEN_STALE/, /THRIV3_/, /email_status/i, /currentness_status/i, /inferred/i, /legacy/i]) {
      expect(message).not.toMatch(internal);
    }
    expect(message).not.toContain(err.message);
  });
});

describe('sendError — anything it does not know', () => {
  it('falls back to a cautious message that does not claim the message did or did not leave', () => {
    for (const err of [undefined, null, {}, { status: 500 }, { code: 'SOMETHING_NEW' }]) {
      const copy = sendError(err);
      expect(copy.message).toMatch(/did not complete/i);
      expect(copy.message).not.toMatch(/nothing was sent|was sent|has been sent/i);
    }
  });
});
