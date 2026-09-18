import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { campaigns, entities } from './client.js';

/**
 * The client half of the A5 boundary.
 *
 * What is worth testing here is not behaviour — the server owns every rule —
 * but the two things a client can get wrong on its own: addressing an endpoint
 * that does not exist, and offering campaign tables through the generic entity
 * registry, where they would become unvalidated CRUD over a snapshot.
 *
 * The paths asserted below are the paths `server/routes/campaigns.js`
 * registers. If either side moves, this fails rather than a screen 404ing.
 */

let calls;
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, ...options });
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ ok: true }),
    };
  };
});

afterEach(() => { globalThis.fetch = realFetch; });

const only = () => {
  expect(calls).toHaveLength(1);
  return calls[0];
};

describe('the campaigns namespace addresses the routes the server registers', () => {
  it('creates against the athlete', async () => {
    await campaigns.createForPlayer('p1', { label: 'Autumn', starts_on: '2026-09-15' });
    const call = only();
    expect(call.url).toBe('/api/players/p1/campaigns');
    expect(call.method).toBe('POST');
    expect(JSON.parse(call.body)).toEqual({ label: 'Autumn', starts_on: '2026-09-15' });
  });

  it('lists for the athlete', async () => {
    await campaigns.listForPlayer('p1');
    const call = only();
    expect(call.url).toBe('/api/players/p1/campaigns');
    expect(call.method).toBeUndefined();   // GET
  });

  it('reads one campaign', async () => {
    await campaigns.get('c1');
    expect(only().url).toBe('/api/campaigns/c1');
  });

  it('patches a campaign', async () => {
    await campaigns.update('c1', { state: 'closed', close_reason: 'operator' });
    const call = only();
    expect(call.url).toBe('/api/campaigns/c1');
    expect(call.method).toBe('PATCH');
    expect(JSON.parse(call.body)).toEqual({ state: 'closed', close_reason: 'operator' });
  });

  it('patches a programme THROUGH its campaign', async () => {
    // The parent is in the path on purpose: the server checks the programme
    // belongs to it, so a programme id alone cannot reach another campaign.
    await campaigns.updateProgramme('c1', 'pc1', { tier: 'A' });
    const call = only();
    expect(call.url).toBe('/api/campaigns/c1/programmes/pc1');
    expect(call.method).toBe('PATCH');
    expect(JSON.parse(call.body)).toEqual({ tier: 'A' });
  });

  it('sends no snapshot field of its own accord', async () => {
    await campaigns.createForPlayer('p1', {});
    const body = JSON.parse(only().body);
    for (const forbidden of ['sport', 'recommendations', 'rank', 'match_score', 'tier',
      'programmes', 'matching_inputs', 'source_analysis_ref', 'state']) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });
});

describe('campaigns are not generic CRUD', () => {
  /**
   * `entities` is a pass-through registry: whatever it exposes can be listed,
   * created, updated and deleted field by field. A campaign's rank, score and
   * provenance are a snapshot, so the tables must never appear here.
   */
  it('offers no campaign entity', () => {
    expect(Object.keys(entities).sort()).toEqual([
      'College', 'GraduatingSenior', 'Player', 'RosterPlayer',
    ]);
    for (const key of Object.keys(entities)) expect(key).not.toMatch(/campaign|programme/i);
  });

  /**
   * EIGHT NOW, AND THE EIGHTH IS THE FIRST ONE THAT WRITES CAMPAIGN INTENT.
   *
   * The surface is pinned so it grows deliberately: adding a method means
   * changing this line and saying why. Two have had to do that.
   *
   * `executionPlan` is a computed projection — what the campaign would do next
   * and what is stopping it — recomputed on every call and stored nowhere.
   *
   * `prepareNextAttempt` records that the campaign INTENDS to contact the coach
   * the SERVER named. It composes no message, touches no mailbox, reserves and
   * spends no sending capacity, calls no transport and schedules nothing — the
   * server suite asserts every one of those against the tables. It takes one
   * argument and sends no body, so it cannot express an intent against a coach
   * or a step of the caller's choosing.
   */
  /**
   * D4.9 ENDS "NONE OF THEM SENDS", DELIBERATELY, AND NARROWS THE RULE RATHER
   * THAN DROPPING IT.
   *
   * ===========================================================================
   * The rule existed because every phase up to F10 was content-only: a client
   * that could make a message HAPPEN would have been a client that could send
   * one before any of the safety, budget, timing or freezing layers existed.
   * All of them now do — D4.5 claims atomically, D4.6 recovers, D4.7 freezes
   * the bytes and owns the result, D4.8 reconciles and enforces the four-day
   * wait — and D4.9 is the slice whose entire purpose is to expose that path.
   *
   * So TWO named operations are now allowed, and the pattern below still
   * catches everything else. A future `sendAll`, `queueMessage`,
   * `dispatchCampaign` or `processQueue` fails this test exactly as before.
   *
   * `sendMessage` takes ONE message id and two preconditions. There is no bulk
   * form, it names no coach, step, recipient, subject or body, and the server
   * refuses any field it did not ask for.
   * ===========================================================================
   */
  const EXECUTION_OPERATIONS = Object.freeze(['executionReadiness', 'sendMessage']);

  it('exposes exactly the fourteen campaign operations', () => {
    expect(Object.keys(campaigns).sort()).toEqual([
      'approveFirstTouch', 'createForPlayer', 'editMessage', 'executionPlan',
      'executionReadiness', 'generateMessage', 'get', 'listForPlayer', 'message',
      'prepareNextAttempt', 'reviewMessage', 'sendMessage', 'update', 'updateProgramme',
    ]);

    /**
     * STILL NOTHING HERE SENDS, EXECUTES, RUNS OR PROCESSES ANYTHING.
     *
     * `materialise` left the forbidden list because F9b-2 shipped the endpoint
     * that records an intent, and `prepareNextAttempt` is the one client method
     * allowed to reach it. What replaces it is stricter about the thing that
     * actually mattered: preparation may only ever be the SINGLE, server-driven
     * operation below — never a bulk form, and never one that takes a coach, a
     * step or an action from the caller.
     *
     * F10b-4 ADDS FOUR CONTENT OPERATIONS AND NO EXECUTION ONE.
     * `generateMessage` writes what the campaign INTENDS to say — no mailbox is
     * touched, nothing is queued, scheduled or sent, and `outreach_send`
     * remains the only thing that says a message happened. `message` reads one,
     * `editMessage` changes words nobody has approved yet, and `reviewMessage`
     * records that somebody approves them — which is not send-approval and is
     * asserted as such server-side.
     *
     * So `generate`, `edit` and `review` are content verbs and are allowed for
     * this workflow only. The forbidden list below is unchanged and still
     * catches anything that would make a message HAPPEN.
     */
    for (const name of Object.keys(campaigns)) {
      if (!EXECUTION_OPERATIONS.includes(name)) {
        expect(name).not.toMatch(/execute|send|run|process|queue|schedule|dispatch/i);
      }
      // No bulk or multi-programme form of anything, execution included.
      expect(name).not.toMatch(/all|bulk|batch|each|every/i);
    }

    // Exactly one preparation operation, named.
    const preparing = Object.keys(campaigns).filter((n) => /prepar|materialis/i.test(n));
    expect(preparing).toEqual(['prepareNextAttempt']);

    /**
     * And exactly one generation operation — never a bulk or campaign-wide
     * form. Generating a hundred messages at once is a product decision nobody
     * has taken, and it would arrive here first.
     */
    const generating = Object.keys(campaigns).filter((n) => /generat|compos/i.test(n));
    expect(generating).toEqual(['generateMessage']);

    /**
     * REVIEW IS NOT SEND-APPROVAL, and the name must not drift towards
     * implying it. `approveSend`, `sendApproval`, `authoriseSend` are the
     * names this rule exists to keep out.
     */
    for (const name of Object.keys(campaigns)) {
      expect(name).not.toMatch(/approvesend|sendapprov|authorisesend|authorizesend/i);
    }
  });

  /**
   * THE MESSAGE METHODS CARRY IDENTIFIERS AND CONTENT, AND NOTHING ELSE.
   *
   * Generate and review send no body at all: the recipient, the step, the
   * evidence and the reviewer are all the server's to derive, and a method that
   * could name any of them would make the server-side authority decorative.
   * Editing sends exactly the patch it is given — and the server refuses any
   * field outside subject and body rather than ignoring it.
   */
  it('generate and review send no body; edit sends only its patch', async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ id: 'm1' }),
      };
    };
    try {
      await campaigns.generateMessage('pc-1', 'coach-9');
      await campaigns.message('m-1');
      await campaigns.editMessage('m-1', { subject: 'New', body: 'Also new.' });
      await campaigns.reviewMessage('m-1');
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(calls.map((c) => `${c.options?.method ?? 'GET'} ${c.url}`)).toEqual([
      'POST /api/programme-campaigns/pc-1/coaches/coach-9/message',
      'GET /api/programme-messages/m-1',
      'PATCH /api/programme-messages/m-1',
      'POST /api/programme-messages/m-1/review',
    ]);
    // No body on generate, read or review.
    expect(calls[0].options.body).toBeUndefined();
    expect(calls[1].options?.body).toBeUndefined();
    expect(calls[3].options.body).toBeUndefined();
    // And the edit carries the patch and nothing more.
    expect(JSON.parse(calls[2].options.body)).toEqual({ subject: 'New', body: 'Also new.' });
    // No query string anywhere — the ids are the request.
    for (const c of calls) expect(c.url).not.toContain('?');
  });

  /**
   * THE ARGUMENTS ARE THE OTHER HALF OF THE GUARD.
   *
   * A method called `prepareNextAttempt` that accepted a coach id and a step
   * would breach the rule the name appears to keep: the server picks both
   * precisely so a client cannot record an intent against somebody the campaign
   * would not approach. One parameter, and no body.
   */
  it('prepareNextAttempt takes only a programme campaign, and sends no body', async () => {
    expect(campaigns.prepareNextAttempt.length).toBe(1);

    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 201,
        headers: { get: () => 'application/json' },
        json: async () => ({ created: true, attempt: {} }),
      };
    };
    try {
      // Extra arguments are not forwarded anywhere, whoever passes them.
      await campaigns.prepareNextAttempt('pc-1', 'coach-9', 4);
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/programme-campaigns/pc-1/contact-attempts');
    expect(calls[0].options.method).toBe('POST');
    expect(calls[0].options.body).toBeUndefined();
    expect(calls[0].url).not.toMatch(/coach|step|action|\?/);
  });
});
