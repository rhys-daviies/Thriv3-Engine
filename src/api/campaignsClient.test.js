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
  it('exposes exactly the eight campaign operations, and none of them sends', () => {
    expect(Object.keys(campaigns).sort()).toEqual([
      'approveFirstTouch', 'createForPlayer', 'executionPlan', 'get', 'listForPlayer',
      'prepareNextAttempt', 'update', 'updateProgramme',
    ]);

    /**
     * STILL NOTHING HERE SENDS, EXECUTES, RUNS OR PROCESSES ANYTHING.
     *
     * `materialise` left the forbidden list because F9b-2 shipped the endpoint
     * that records an intent, and `prepareNextAttempt` is the one client method
     * allowed to reach it. What replaces it is stricter about the thing that
     * actually mattered: preparation may only ever be the SINGLE, server-driven
     * operation below — never a bulk form, and never one that takes a coach, a
     * step or an action from the caller. `assertNoSendingArguments` below is
     * what holds that second half.
     */
    for (const name of Object.keys(campaigns)) {
      expect(name).not.toMatch(/execute|send|run|process|queue|schedule|dispatch/i);
      // No bulk or multi-programme form of anything.
      expect(name).not.toMatch(/all|bulk|batch|each|every/i);
    }

    // Exactly one preparation operation, named.
    const preparing = Object.keys(campaigns).filter((n) => /prepar|materialis/i.test(n));
    expect(preparing).toEqual(['prepareNextAttempt']);
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
