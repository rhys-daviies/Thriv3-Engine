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

  it('exposes exactly the five campaign operations', () => {
    expect(Object.keys(campaigns).sort()).toEqual([
      'createForPlayer', 'get', 'listForPlayer', 'update', 'updateProgramme',
    ]);
  });
});
