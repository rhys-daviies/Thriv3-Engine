import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { campaignsRouter } from './campaigns.js';
import { UPLOADS_DIR } from '../lib/uploadPath.js';
import { getCampaign, getProgrammeCampaign, listProgrammeCampaigns } from '../lib/campaigns.js';

/**
 * A5 — the API doorway.
 *
 * These are route tests, driven over real HTTP against the real router, because
 * the properties under test are boundary properties: what a request is allowed
 * to say, what a failure looks like from outside, and what leaves the building.
 * A library can be correct while a route hands a client a way around it.
 *
 * The one that matters most is snapshot immutability. Everything the campaign
 * model is worth depends on `rank`, `match_score`, `sport` and the provenance
 * being unrewritable, and an API is exactly where that guarantee gets lost.
 */

const ATHLETE = 'a-api';
const OTHER = 'a-api-other';
let baseUrl;
const written = [];

beforeAll(async () => {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const app = express();
  app.use(express.json());
  app.use('/api', campaignsRouter);
  await new Promise((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.unref();
  });
});

afterAll(() => {
  for (const f of written) if (fs.existsSync(f)) fs.unlinkSync(f);
});

function insertAthlete(id, name) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport,
      recruiting_class_year, origin)
    VALUES (?, '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z', ?, 'MIDFIELD',
      'mens-soccer', 2027, 'International')
  `).run(id, name);
}

function rec(n) {
  return {
    id: `col-${n}`,
    name: `School ${n}`,
    division: 'NCAA D1',
    conference: 'Big East',
    match_score: 100 - n,
    breakdown: [
      { key: 'athletic', score: 0.9 }, { key: 'roster', score: 0.5 },
      { key: 'academic', score: 0.5 }, { key: 'affordability', score: 0.5 },
      { key: 'programQuality', score: 0.6 }, { key: 'geography', score: 0.7 },
    ],
    labels: { athletic: 'target' },
    confidence: 'measured',
  };
}

function giveAnalysis(athleteId, n = 60) {
  const name = `${randomUUID()}-recommendations.json`;
  const file = path.join(UPLOADS_DIR, name);
  fs.writeFileSync(file, JSON.stringify({
    recommendations: Array.from({ length: n }, (_, i) => rec(i + 1)),
    summary: 'Ranked 1166 eligible programs on six weighted criteria.',
  }));
  written.push(file);
  db.prepare('UPDATE players SET recommendations = ? WHERE id = ?').run(`/uploads/${name}`, athleteId);
  return `/uploads/${name}`;
}

const api = async (method, url, body) => {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const post = (url, body) => api('POST', url, body);
const get = (url) => api('GET', url);
const patch = (url, body) => api('PATCH', url, body);

/** A draft campaign for ATHLETE, through the API. */
async function makeCampaign(athleteId = ATHLETE, payload = {}, n = 60) {
  giveAnalysis(athleteId, n);
  const { status, body } = await post(`/api/players/${athleteId}/campaigns`, payload);
  expect(status).toBe(201);
  return body;
}

beforeEach(() => {
  db.exec('DELETE FROM programme_campaigns; DELETE FROM campaigns; DELETE FROM players;');
  insertAthlete(ATHLETE, 'API Athlete');
  insertAthlete(OTHER, 'Other Athlete');
});

// ---------------------------------------------------------------------------

describe('POST /api/players/:playerId/campaigns', () => {
  it('creates a draft campaign from the athlete’s own stored analysis', async () => {
    giveAnalysis(ATHLETE, 100);
    const { status, body } = await post(`/api/players/${ATHLETE}/campaigns`, {
      label: 'Autumn 2026', starts_on: '2026-09-15', outreach_ends_on: '2026-10-06', ends_on: '2026-10-20',
    });

    expect(status).toBe(201);
    expect(body.campaign.state).toBe('draft');
    expect(body.campaign.athlete_id).toBe(ATHLETE);
    expect(body.campaign.sport).toBe('mens-soccer');
    expect(body.campaign.label).toBe('Autumn 2026');
    expect(body.campaign.programme_count).toBe(100);
    expect(body.programmes).toHaveLength(100);
    expect(body.programmes.map((p) => p.rank).slice(0, 3)).toEqual([1, 2, 3]);
    expect(body.programmes[0].tier).toBe('A');
    expect(body.programmes[0].state).toBe('queued');
    expect(body.programmes[0].tier_source).toBe('AUTO');
  });

  it('needs no body at all', async () => {
    giveAnalysis(ATHLETE, 5);
    const { status, body } = await post(`/api/players/${ATHLETE}/campaigns`, {});
    expect(status).toBe(201);
    expect(body.campaign.label).toBeNull();
    expect(body.campaign.starts_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('404s an athlete that does not exist', async () => {
    const { status, body } = await post('/api/players/nobody/campaigns', {});
    expect(status).toBe(404);
    expect(body.code).toBe('ATHLETE_NOT_FOUND');
  });

  it('409s an athlete with no stored analysis', async () => {
    const { status, body } = await post(`/api/players/${ATHLETE}/campaigns`, {});
    expect(status).toBe(409);
    expect(body.code).toBe('NO_STORED_ANALYSIS');
    expect(body.error).toMatch(/Find Matches/);
  });

  it('422s an impossible date, and writes nothing', async () => {
    giveAnalysis(ATHLETE, 5);
    for (const bad of [{ starts_on: '2026-13-01' }, { starts_on: '2026-02-30' }, { starts_on: '07/09/2026' }]) {
      const { status, body } = await post(`/api/players/${ATHLETE}/campaigns`, bad);
      expect(status).toBe(422);
      expect(body.code).toBe('INVALID_DATE');
    }
    const { status } = await post(`/api/players/${ATHLETE}/campaigns`, {
      starts_on: '2026-09-15', ends_on: '2026-09-01',
    });
    expect(status).toBe(422);
    expect(db.prepare('SELECT COUNT(*) n FROM campaigns').get().n).toBe(0);
  });

  it('refuses an unknown field rather than ignoring it', async () => {
    giveAnalysis(ATHLETE, 5);
    const { status, body } = await post(`/api/players/${ATHLETE}/campaigns`, { notes: 'hello' });
    expect(status).toBe(400);
    expect(body.error).toMatch(/Unknown field\(s\).*notes/);
    expect(db.prepare('SELECT COUNT(*) n FROM campaigns').get().n).toBe(0);
  });

  /**
   * The client does not get to supply the ranked list. The server reads the
   * athlete's stored analysis, so a campaign records what the product ranked
   * rather than what a browser tab was holding.
   */
  it('refuses a client-supplied Top 100', async () => {
    giveAnalysis(ATHLETE, 5);
    for (const forged of ['recommendations', 'programmes', 'programme_campaigns']) {
      const { status, body } = await post(`/api/players/${ATHLETE}/campaigns`, {
        [forged]: [{ name: 'Forged University', match_score: 100 }],
      });
      expect(status).toBe(400);
      expect(body.error).toMatch(/never/i);
    }
    expect(db.prepare('SELECT COUNT(*) n FROM programme_campaigns').get().n).toBe(0);
  });

  it('refuses a client-supplied sport, state or provenance', async () => {
    giveAnalysis(ATHLETE, 5);
    for (const forged of [
      { sport: 'womens-soccer' },
      { state: 'active' },
      { source_analysis_ref: '/uploads/somebody-elses.json' },
      { snapshot_taken_at: '2020-01-01T00:00:00.000Z' },
      { matching_inputs: '{}' },
      { programme_count: 1 },
      { athlete_id: OTHER },
    ]) {
      const { status } = await post(`/api/players/${ATHLETE}/campaigns`, forged);
      expect(status).toBe(400);
    }
    expect(db.prepare('SELECT COUNT(*) n FROM campaigns').get().n).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('reads', () => {
  it('lists an athlete’s campaigns as summaries, scoped to them', async () => {
    await makeCampaign(ATHLETE, { label: 'One' }, 5);
    await makeCampaign(ATHLETE, { label: 'Two' }, 5);
    await makeCampaign(OTHER, { label: 'Theirs' }, 5);

    const { status, body } = await get(`/api/players/${ATHLETE}/campaigns`);
    expect(status).toBe(200);
    expect(body.campaigns.map((c) => c.label).sort()).toEqual(['One', 'Two']);
    expect(body.campaigns.every((c) => c.athlete_id === ATHLETE)).toBe(true);
    // Summaries: no hundred programme rows per campaign.
    for (const c of body.campaigns) {
      expect(c).not.toHaveProperty('programmes');
      expect(c).not.toHaveProperty('matching_inputs');
    }
  });

  it('returns an empty list for an athlete with none', async () => {
    const { status, body } = await get(`/api/players/${OTHER}/campaigns`);
    expect(status).toBe(200);
    expect(body.campaigns).toEqual([]);
  });

  it('returns programmes in snapshotted rank order', async () => {
    const created = await makeCampaign(ATHLETE, {}, 60);
    const { status, body } = await get(`/api/campaigns/${created.campaign.id}`);
    expect(status).toBe(200);
    expect(body.programmes.map((p) => p.rank)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  });

  it('keeps rank order after an operator re-tiers the list', async () => {
    const created = await makeCampaign(ATHLETE, {}, 60);
    const promoted = created.programmes.find((p) => p.rank === 55);
    await patch(`/api/campaigns/${created.campaign.id}/programmes/${promoted.id}`, { tier: 'A' });
    const { body } = await get(`/api/campaigns/${created.campaign.id}`);
    expect(body.programmes.map((p) => p.rank)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  });

  it('carries the provenance on the detail view', async () => {
    const created = await makeCampaign(ATHLETE, {}, 10);
    const { body } = await get(`/api/campaigns/${created.campaign.id}`);
    expect(body.campaign.matching_inputs.schema).toBe('campaign-matching-inputs/2');
    expect(body.campaign.matching_inputs.model.id).toBe('SIX_CRITERION_V1');
    expect(body.campaign.matching_inputs.athlete.provenance).toBe('SNAPSHOT_TIME');

    /**
     * Schema 2 adds the third provenance: what a PERSON decided about this
     * athlete, read when the campaign was frozen. Without it, "why is Stanford
     * not in here" has no answer a year later — the analysis still contains
     * Stanford and always will.
     */
    const actionable = body.campaign.matching_inputs.actionable;
    expect(actionable.provenance).toBe('OPERATOR_TIME');
    expect(actionable.suppressed_count).toBe(0);
    expect(actionable.suppressed).toEqual([]);
    expect(actionable.promoted).toEqual([]);
    expect(actionable.actionable_count).toBe(10);
    expect(actionable.reserve_exhausted).toBe(false);
  });

  it('404s a campaign that does not exist', async () => {
    const { status, body } = await get('/api/campaigns/nope');
    expect(status).toBe(404);
    expect(body.error).toMatch(/No campaign nope/);
  });

  /**
   * `tier` on a programme is always the CAMPAIGN tier. Nothing here joins
   * engagement, and if it ever does the two must be named apart.
   */
  it('exposes no engagement field that could be mistaken for a campaign one', async () => {
    const created = await makeCampaign(ATHLETE, {}, 5);
    const { body } = await get(`/api/campaigns/${created.campaign.id}`);
    for (const p of body.programmes) {
      expect(['A', 'B', 'C']).toContain(p.tier);
      for (const engagement of ['engagement_score', 'qualified_visits', 'best_coverage_pct',
        'responded_at', 'total_rewinds', 'chapter_jumps', 'engagement_tier']) {
        expect(p).not.toHaveProperty(engagement);
      }
    }
  });

  it('projects an explicit field set rather than passing rows through', async () => {
    const created = await makeCampaign(ATHLETE, {}, 3);
    const { body } = await get(`/api/campaigns/${created.campaign.id}`);
    expect(Object.keys(body.programmes[0]).sort()).toEqual([
      'campaign_id', 'college_id', 'college_name', 'conference', 'division', 'id',
      'match_score', 'rank', 'score_breakdown', 'sport', 'state', 'state_changed_at',
      'state_reason', 'tier', 'tier_set_at', 'tier_source',
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('PATCH /api/campaigns/:id', () => {
  it('updates the label', async () => {
    const created = await makeCampaign(ATHLETE, { label: 'Old' }, 5);
    const { status, body } = await patch(`/api/campaigns/${created.campaign.id}`, { label: 'New' });
    expect(status).toBe(200);
    expect(body.campaign.label).toBe('New');
  });

  it('updates dates that stay in order', async () => {
    const created = await makeCampaign(ATHLETE, {
      starts_on: '2026-09-01', outreach_ends_on: '2026-09-30', ends_on: '2026-10-07',
    }, 5);
    const { status, body } = await patch(`/api/campaigns/${created.campaign.id}`, { ends_on: '2026-10-14' });
    expect(status).toBe(200);
    expect(body.campaign.ends_on).toBe('2026-10-14');
    expect(body.campaign.starts_on).toBe('2026-09-01');
  });

  /**
   * THE MERGED-STATE RULE. `starts_on: 2026-10-10` is a perfectly good date and
   * an impossible campaign, because the row it lands on already ends on 7
   * October. A route validating only what it received would take it.
   */
  it('refuses a partial edit that makes the WHOLE campaign impossible', async () => {
    const created = await makeCampaign(ATHLETE, {
      starts_on: '2026-09-01', outreach_ends_on: '2026-09-30', ends_on: '2026-10-07',
    }, 5);
    const id = created.campaign.id;

    for (const [change, why] of [
      [{ starts_on: '2026-10-10' }, 'starts after both ends'],
      [{ starts_on: '2026-10-01' }, 'starts after outreach ends'],
      [{ outreach_ends_on: '2026-08-01' }, 'outreach ends before it starts'],
      [{ ends_on: '2026-08-01' }, 'ends before it starts'],
      [{ ends_on: '2026-09-15' }, 'ends before outreach ends'],
      [{ outreach_ends_on: '2026-10-20' }, 'outreach outlives the campaign'],
    ]) {
      const { status, body } = await patch(`/api/campaigns/${id}`, change);
      expect(status, why).toBe(422);
      expect(body.code).toBe('INVALID_DATE_ORDER');
    }
    // And the row is exactly as it was.
    expect(getCampaign(id).starts_on).toBe('2026-09-01');
    expect(getCampaign(id).ends_on).toBe('2026-10-07');
  });

  it('accepts a combination that is only valid taken together', async () => {
    const created = await makeCampaign(ATHLETE, {
      starts_on: '2026-09-01', outreach_ends_on: '2026-09-30', ends_on: '2026-10-07',
    }, 5);
    // Moving the start alone would be refused; moving all three is coherent.
    const { status, body } = await patch(`/api/campaigns/${created.campaign.id}`, {
      starts_on: '2026-11-01', outreach_ends_on: '2026-11-20', ends_on: '2026-12-01',
    });
    expect(status).toBe(200);
    expect([body.campaign.starts_on, body.campaign.outreach_ends_on, body.campaign.ends_on])
      .toEqual(['2026-11-01', '2026-11-20', '2026-12-01']);
  });

  it('clears an end date with an explicit null', async () => {
    const created = await makeCampaign(ATHLETE, { starts_on: '2026-09-01', ends_on: '2026-10-07' }, 5);
    const { status, body } = await patch(`/api/campaigns/${created.campaign.id}`, { ends_on: null });
    expect(status).toBe(200);
    expect(body.campaign.ends_on).toBeNull();
  });

  it('moves draft -> active', async () => {
    const created = await makeCampaign(ATHLETE, {}, 5);
    const { status, body } = await patch(`/api/campaigns/${created.campaign.id}`, { state: 'active' });
    expect(status).toBe(200);
    expect(body.campaign.state).toBe('active');
    expect(body.changed).toBe(true);
  });

  it('closes with a reason, recording when', async () => {
    const created = await makeCampaign(ATHLETE, {}, 5);
    await patch(`/api/campaigns/${created.campaign.id}`, { state: 'active' });
    const { status, body } = await patch(`/api/campaigns/${created.campaign.id}`, {
      state: 'closed', close_reason: 'athlete_committed',
    });
    expect(status).toBe(200);
    expect(body.campaign.state).toBe('closed');
    expect(body.campaign.close_reason).toBe('athlete_committed');
    expect(body.campaign.closed_at).toBeTruthy();
  });

  it('refuses to close without a reason', async () => {
    const created = await makeCampaign(ATHLETE, {}, 5);
    const { status, body } = await patch(`/api/campaigns/${created.campaign.id}`, { state: 'closed' });
    expect(status).toBe(422);
    expect(body.code).toBe('CLOSE_REASON_REQUIRED');
    expect(getCampaign(created.campaign.id).state).toBe('draft');
  });

  it('refuses a close reason outside the vocabulary', async () => {
    const created = await makeCampaign(ATHLETE, {}, 5);
    const { status, body } = await patch(`/api/campaigns/${created.campaign.id}`, {
      state: 'closed', close_reason: 'because',
    });
    expect(status).toBe(422);
    expect(body.code).toBe('UNKNOWN_CLOSE_REASON');
  });

  it('refuses an illegal transition, through the data layer’s own table', async () => {
    const created = await makeCampaign(ATHLETE, {}, 5);
    await patch(`/api/campaigns/${created.campaign.id}`, { state: 'active' });

    const back = await patch(`/api/campaigns/${created.campaign.id}`, { state: 'draft' });
    expect(back.status).toBe(422);
    expect(back.body.code).toBe('ILLEGAL_TRANSITION');

    await patch(`/api/campaigns/${created.campaign.id}`, { state: 'closed', close_reason: 'operator' });
    const reopen = await patch(`/api/campaigns/${created.campaign.id}`, { state: 'active' });
    expect(reopen.status).toBe(422);
    expect(reopen.body.error).toMatch(/closed is terminal/);
  });

  it('409s a second active campaign for one athlete, in words', async () => {
    const first = await makeCampaign(ATHLETE, {}, 5);
    await patch(`/api/campaigns/${first.campaign.id}`, { state: 'active' });
    const second = await makeCampaign(ATHLETE, {}, 5);

    const { status, body } = await patch(`/api/campaigns/${second.campaign.id}`, { state: 'active' });
    expect(status).toBe(409);
    expect(body.code).toBe('CAMPAIGN_ACTIVE_CONFLICT');
    expect(body.error).toContain(first.campaign.id);
    expect(body.error).not.toMatch(/UNIQUE constraint/);
    expect(getCampaign(second.campaign.id).state).toBe('draft');
  });

  it('refuses a mixed detail-and-lifecycle request', async () => {
    const created = await makeCampaign(ATHLETE, { label: 'Old' }, 5);
    const { status, body } = await patch(`/api/campaigns/${created.campaign.id}`, {
      label: 'New', state: 'active',
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/separate requests/);
    expect(getCampaign(created.campaign.id).label).toBe('Old');
    expect(getCampaign(created.campaign.id).state).toBe('draft');
  });

  it('refuses an empty body and a stray close_reason', async () => {
    const created = await makeCampaign(ATHLETE, {}, 5);
    expect((await patch(`/api/campaigns/${created.campaign.id}`, {})).status).toBe(400);
    const stray = await patch(`/api/campaigns/${created.campaign.id}`, { close_reason: 'operator' });
    expect(stray.status).toBe(400);
    expect(stray.body.error).toMatch(/without a state change/);
  });

  it('404s a campaign that does not exist', async () => {
    expect((await patch('/api/campaigns/nope', { label: 'x' })).status).toBe(404);
    expect((await patch('/api/campaigns/nope', { state: 'active' })).status).toBe(404);
  });

  /**
   * THE PRIMARY ACCEPTANCE CRITERION. A campaign is worth something only
   * because what it says happened cannot be edited afterwards.
   */
  it('refuses every snapshot and derived field, naming each', async () => {
    const created = await makeCampaign(ATHLETE, {}, 5);
    const id = created.campaign.id;
    const before = getCampaign(id);

    for (const forged of [
      { athlete_id: OTHER },
      { sport: 'womens-soccer' },
      { source_analysis_ref: '/uploads/other.json' },
      { snapshot_taken_at: '2020-01-01T00:00:00.000Z' },
      { matching_inputs: '{"model":{"id":"FORGED"}}' },
      { programme_count: 1 },
      { created_at: '2020-01-01T00:00:00.000Z' },
      { updated_at: '2020-01-01T00:00:00.000Z' },
      { closed_at: '2020-01-01T00:00:00.000Z' },
      { id: 'something-else' },
    ]) {
      const field = Object.keys(forged)[0];
      const { status, body } = await patch(`/api/campaigns/${id}`, forged);
      expect(status, field).toBe(400);
      expect(body.error).toContain(field);
      expect(body.error).toMatch(/not rewritten|Unknown field/);
    }
    expect(getCampaign(id)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------

describe('PATCH /api/campaigns/:campaignId/programmes/:programmeId', () => {
  let campaignId;
  let programmes;
  beforeEach(async () => {
    const created = await makeCampaign(ATHLETE, {}, 60);
    campaignId = created.campaign.id;
    programmes = created.programmes;
  });

  const at = (rank) => programmes.find((p) => p.rank === rank);

  it('records an operator tier override without touching the rank', async () => {
    const target = at(55);
    expect(target.tier).toBe('C');
    const { status, body } = await patch(`/api/campaigns/${campaignId}/programmes/${target.id}`, { tier: 'A' });

    expect(status).toBe(200);
    expect(body.programme.tier).toBe('A');
    expect(body.programme.tier_source).toBe('OPERATOR');
    expect(body.programme.rank).toBe(55);
    expect(body.programme.match_score).toBe(target.match_score);
  });

  it('restores the AUTO tier from the immutable rank', async () => {
    const target = at(55);
    await patch(`/api/campaigns/${campaignId}/programmes/${target.id}`, { tier: 'A' });
    const { status, body } = await patch(`/api/campaigns/${campaignId}/programmes/${target.id}`, {
      tier_source: 'AUTO',
    });
    expect(status).toBe(200);
    expect(body.programme.tier).toBe('C');
    expect(body.programme.tier_source).toBe('AUTO');
    expect(body.programme.rank).toBe(55);
  });

  it('refuses to declare tier_source directly, or to send both', async () => {
    const target = at(1);
    const declared = await patch(`/api/campaigns/${campaignId}/programmes/${target.id}`, {
      tier_source: 'OPERATOR',
    });
    expect(declared.status).toBe(400);
    expect(declared.body.error).toMatch(/only be set to "AUTO"/);

    const both = await patch(`/api/campaigns/${campaignId}/programmes/${target.id}`, {
      tier: 'B', tier_source: 'AUTO',
    });
    expect(both.status).toBe(400);
    expect(getProgrammeCampaign(target.id).tier_source).toBe('AUTO');
  });

  it('refuses a tier outside A/B/C', async () => {
    const { status, body } = await patch(`/api/campaigns/${campaignId}/programmes/${at(1).id}`, { tier: 'D' });
    expect(status).toBe(400);
    expect(body.error).toMatch(/Unknown tier "D"/);
  });

  it('moves queued -> active', async () => {
    const { status, body } = await patch(`/api/campaigns/${campaignId}/programmes/${at(1).id}`, {
      state: 'active',
    });
    expect(status).toBe(200);
    expect(body.programme.state).toBe('active');
  });

  it('stops with a reason and reopens, clearing the stale reason', async () => {
    const target = at(2);
    await patch(`/api/campaigns/${campaignId}/programmes/${target.id}`, { state: 'active' });

    const stopped = await patch(`/api/campaigns/${campaignId}/programmes/${target.id}`, {
      state: 'stopped', state_reason: 'not_recruiting',
    });
    expect(stopped.status).toBe(200);
    expect(stopped.body.programme.state_reason).toBe('not_recruiting');

    const reopened = await patch(`/api/campaigns/${campaignId}/programmes/${target.id}`, { state: 'active' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.programme.state_reason).toBeNull();
  });

  it('refuses a stop with no reason', async () => {
    const { status, body } = await patch(`/api/campaigns/${campaignId}/programmes/${at(3).id}`, {
      state: 'stopped',
    });
    expect(status).toBe(422);
    expect(body.code).toBe('STOP_REASON_REQUIRED');
    expect(getProgrammeCampaign(at(3).id).state).toBe('queued');
  });

  it('refuses a state_reason sent without a state change', async () => {
    const { status, body } = await patch(`/api/campaigns/${campaignId}/programmes/${at(4).id}`, {
      state_reason: 'not_recruiting',
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/without a state change/);
    expect(getProgrammeCampaign(at(4).id).state_reason).toBeNull();
  });

  it('refuses an illegal programme transition', async () => {
    const target = at(5);
    await patch(`/api/campaigns/${campaignId}/programmes/${target.id}`, { state: 'active' });
    await patch(`/api/campaigns/${campaignId}/programmes/${target.id}`, { state: 'completed' });
    const { status, body } = await patch(`/api/campaigns/${campaignId}/programmes/${target.id}`, {
      state: 'active',
    });
    expect(status).toBe(422);
    expect(body.code).toBe('ILLEGAL_TRANSITION');
    expect(body.error).toMatch(/completed is terminal/);
  });

  it('refuses a state that is not a state, including a reply classification', async () => {
    for (const bogus of ['awaiting_response', 'action_required', 'not_interested', 'unreachable']) {
      const { status, body } = await patch(`/api/campaigns/${campaignId}/programmes/${at(6).id}`, {
        state: bogus,
      });
      expect(status).toBe(400);
      expect(body.error).toMatch(/Unknown programme state/);
    }
  });

  it('refuses a mixed tier-and-state request', async () => {
    const { status, body } = await patch(`/api/campaigns/${campaignId}/programmes/${at(7).id}`, {
      tier: 'A', state: 'active',
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/separate requests/);
  });

  it('refuses every programme snapshot field, naming each', async () => {
    const target = at(8);
    const before = getProgrammeCampaign(target.id);

    for (const forged of [
      { rank: 1 },
      { match_score: 100 },
      { score_breakdown: '{"forged":true}' },
      { college_name: 'Forged University' },
      { college_id: 'col-999' },
      { sport: 'womens-soccer' },
      { division: 'NCAA D3' },
      { conference: 'Forged Conference' },
      { campaign_id: 'another-campaign' },
      { tier_set_at: '2020-01-01T00:00:00.000Z' },
      { state_changed_at: '2020-01-01T00:00:00.000Z' },
      { id: 'something-else' },
    ]) {
      const field = Object.keys(forged)[0];
      const { status, body } = await patch(`/api/campaigns/${campaignId}/programmes/${target.id}`, forged);
      expect(status, field).toBe(400);
      expect(body.error).toContain(field);
    }
    expect(getProgrammeCampaign(target.id)).toEqual(before);
  });

  /**
   * PARENT OWNERSHIP. Without this check, knowing a programme id would be
   * enough to reach into somebody else's campaign through a URL naming your
   * own — the classic broken-object-level-authorisation shape.
   */
  it('cannot reach a programme through the wrong campaign', async () => {
    const other = await makeCampaign(OTHER, {}, 10);
    const theirs = other.programmes[0];
    const before = getProgrammeCampaign(theirs.id);

    for (const change of [{ tier: 'C' }, { state: 'stopped', state_reason: 'operator' }]) {
      const { status, body } = await patch(`/api/campaigns/${campaignId}/programmes/${theirs.id}`, change);
      expect(status).toBe(404);
      // Says nothing about whether it exists elsewhere.
      expect(body.error).toBe(`No programme ${theirs.id} in campaign ${campaignId}`);
    }
    expect(getProgrammeCampaign(theirs.id)).toEqual(before);
  });

  it('404s a programme that does not exist at all', async () => {
    const { status } = await patch(`/api/campaigns/${campaignId}/programmes/nope`, { tier: 'A' });
    expect(status).toBe(404);
  });

  it('never removes a programme from its campaign', async () => {
    // Rule 1: tiering and stopping control outreach intensity, not membership.
    const target = at(9);
    await patch(`/api/campaigns/${campaignId}/programmes/${target.id}`, {
      state: 'stopped', state_reason: 'not_recruiting',
    });
    expect(listProgrammeCampaigns(campaignId)).toHaveLength(60);
    const { body } = await get(`/api/campaigns/${campaignId}`);
    expect(body.programmes.map((p) => p.id)).toContain(target.id);
  });
});

// ---------------------------------------------------------------------------

describe('the boundary this API is', () => {
  it('keeps campaigns out of the generic entity registry', async () => {
    const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const registry = src.slice(src.indexOf('const ENTITIES'), src.indexOf('function parseQuery'));
    expect(registry).not.toMatch(/campaign/i);
    expect(registry).not.toMatch(/programme/i);
    // And it is mounted as its own router instead.
    expect(src).toContain('campaignsRouter');
  });

  /**
   * The route may not write these tables. Every mutation goes through the
   * invariant-owning library, so no endpoint can grow a shortcut around a
   * transition table or a tier rule.
   */
  it('runs no SQL of its own', () => {
    const src = fs.readFileSync(new URL('./campaigns.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/db\.prepare|UPDATE\s+campaigns|INSERT\s+INTO|DELETE\s+FROM/i);
    expect(src).not.toContain("from '../db/client.js'");
  });

  it('leaks no SQLite text, path or stack trace on a server-side failure', async () => {
    // The stored analysis is gone from disk: the athlete's fault in no sense,
    // and its real message names the upload reference.
    const ref = giveAnalysis(ATHLETE, 5);
    fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(ref)));

    const { status, body } = await post(`/api/players/${ATHLETE}/campaigns`, {});
    expect(status).toBe(500);
    expect(body.error).toBe(
      'The stored match analysis for this athlete could not be read. Re-run the match analysis and try again.',
    );
    expect(body.error).not.toContain('/uploads/');
    expect(body.error).not.toContain(UPLOADS_DIR);
    expect(body).not.toHaveProperty('stack');
    expect(body).not.toHaveProperty('code');
  });

  it('says nothing about the filesystem when the pointer is hostile', async () => {
    db.prepare("UPDATE players SET recommendations = '/uploads/../../../etc/passwd' WHERE id = ?").run(ATHLETE);
    const { status, body } = await post(`/api/players/${ATHLETE}/campaigns`, {});
    expect(status).toBe(500);
    expect(body.error).not.toMatch(/etc\/passwd|uploads|\.\./);
  });

  it('reports a domain refusal with its code, and an internal one without', async () => {
    // A client can act on a code it is meant to see.
    const created = await makeCampaign(ATHLETE, {}, 5);
    const domain = await patch(`/api/campaigns/${created.campaign.id}`, { state: 'closed' });
    expect(domain.body.code).toBe('CLOSE_REASON_REQUIRED');
    // Internal codes are logged, never returned.
    expect(Object.values(domain.body)).not.toContain('ANALYSIS_FILE_MISSING');
  });
});

// ---------------------------------------------------------------------------

/**
 * B7 — the read-only dry run.
 *
 * The boundary properties here are: that it is genuinely read-only, that an
 * unknown campaign costs nothing, that the query is allow-listed like every
 * other campaign request, and that no sibling endpoint executes what it
 * describes.
 */
describe('GET /api/campaigns/:id/execution-plan', () => {
  /** Coaches for the first `n` schools of the generated analysis. */
  function staffFor(n) {
    for (let i = 1; i <= n; i += 1) {
      for (const [j, title] of ['Head Coach', 'Assistant Coach'].entries()) {
        db.prepare(`
          INSERT OR IGNORE INTO coaches (id, created_at, full_name, email, school, division,
            sport, position_title, email_status)
          VALUES (?, '2026-09-01T00:00:00.000Z', ?, ?, ?, 'NCAA D1', 'mens-soccer', ?, 'verified')
        `).run(randomUUID(), `Coach ${i}${j}`, `c${j}.s${i}@example.edu`, `School ${i}`, title);
      }
    }
  }

  it('returns a campaign, a summary, its programmes and an ordered preview', async () => {
    staffFor(5);
    const { campaign } = await makeCampaign(ATHLETE, {}, 5);
    await patch(`/api/campaigns/${campaign.id}`, { state: 'active' });

    const { status, body } = await get(`/api/campaigns/${campaign.id}/execution-plan`);
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['campaign', 'priorityActions', 'programmes', 'summary']);
    expect(body.campaign).toMatchObject({ id: campaign.id, athleteId: ATHLETE, state: 'active' });
    expect(body.programmes).toHaveLength(5);
    expect(body.programmes.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(body.summary.programmeCount).toBe(5);
    expect(body.priorityActions.map((a) => a.priority)).toEqual([1, 2, 3, 4, 5]);
    // Every one of them a first approach, which is what a fresh campaign is.
    expect(body.priorityActions.every((a) => a.actionClass === 'FIRST_CONTACT')).toBe(true);
  });

  it('plans a draft campaign, and says it may not run', async () => {
    staffFor(3);
    const { campaign } = await makeCampaign(ATHLETE, {}, 3);

    const { status, body } = await get(`/api/campaigns/${campaign.id}/execution-plan`);
    expect(status).toBe(200);
    expect(body.campaign.state).toBe('draft');
    expect(body.programmes[0].nextAction).toBe('INITIAL_OUTREACH');
    expect(body.programmes[0].executableNow).toBe(false);
    expect(body.programmes[0].blockers)
      .toContainEqual({ source: 'SAFETY', code: 'CAMPAIGN_NOT_ACTIVE' });
    expect(body.summary.executableNowCount).toBe(0);
  });

  it('changes nothing, however many times it is asked', async () => {
    staffFor(5);
    const { campaign } = await makeCampaign(ATHLETE, {}, 5);
    await patch(`/api/campaigns/${campaign.id}`, { state: 'active' });

    const tables = ['campaigns', 'programme_campaigns', 'programme_contact_attempts',
      'outreach', 'outreach_send', 'outbound_send_attempt', 'coaches', 'players'];
    const before = Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]));

    const first = await get(`/api/campaigns/${campaign.id}/execution-plan`);
    const second = await get(`/api/campaigns/${campaign.id}/execution-plan`);

    expect(second.body).toEqual(first.body);
    for (const t of tables) expect(db.prepare(`SELECT * FROM ${t}`).all(), t).toEqual(before[t]);
  });

  it('accepts on_date, and refuses anything else', async () => {
    staffFor(2);
    const { campaign } = await makeCampaign(ATHLETE, {}, 2);

    const dated = await get(`/api/campaigns/${campaign.id}/execution-plan?on_date=2027-03-04`);
    expect(dated.status).toBe(200);
    expect(dated.body.campaign.onDate).toBe('2027-03-04');

    const bad = await get(`/api/campaigns/${campaign.id}/execution-plan?on_date=tomorrow`);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/YYYY-MM-DD/);

    // The sending mailbox is server config. A caller naming one would be
    // reading, and later spending, against a mailbox of their choosing.
    const unknown = await get(`/api/campaigns/${campaign.id}/execution-plan?sending_identity=x@y.z`);
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatch(/Unknown query parameter\(s\): sending_identity/);
  });

  it('404s an unknown campaign without planning anything', async () => {
    const { status, body } = await get('/api/campaigns/no-such-campaign/execution-plan');
    expect(status).toBe(404);
    expect(body.error).toMatch(/No campaign/);
  });

  it('answers 404 rather than leaking another athlete\'s campaign shape', async () => {
    staffFor(2);
    const { campaign } = await makeCampaign(OTHER, {}, 2);
    // It is addressable — it is theirs, and this router has no auth layer — so
    // what is asserted is that the id is the only thing that resolves it.
    const found = await get(`/api/campaigns/${campaign.id}/execution-plan`);
    expect(found.status).toBe(200);
    const guessed = await get(`/api/campaigns/${campaign.id}x/execution-plan`);
    expect(guessed.status).toBe(404);
  });

  it('has no sibling that executes it', () => {
    const src = fs.readFileSync(new URL('./campaigns.js', import.meta.url), 'utf8');
    // The plan exists so a person can look before anything acts. An execution
    // endpoint shipped beside it would make that inspection a formality.
    expect(src).not.toMatch(/\.post\(['"][^'"]*(execute|send|run|process)/i);
    expect(src).not.toMatch(/materialise|createOutreach|recordOutboundAttempt/i);
    const methods = [...src.matchAll(/campaignsRouter\.(\w+)\(/g)].map((m) => m[1]);
    expect(methods.filter((m) => m === 'get').length).toBe(3);
    expect(new Set(methods)).toEqual(new Set(['post', 'get', 'patch']));
  });
});

describe('the client method', () => {
  it('builds the right URL and encodes the date', async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      calls.push(url);
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ campaign: {}, summary: {}, programmes: [], priorityActions: [] }),
      };
    };
    try {
      const { campaigns } = await import('../../src/api/client.js');
      await campaigns.executionPlan('camp-1');
      await campaigns.executionPlan('camp-1', { onDate: '2026-09-07' });
      expect(calls).toEqual([
        '/api/campaigns/camp-1/execution-plan',
        '/api/campaigns/camp-1/execution-plan?on_date=2026-09-07',
      ]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('is a read, with no companion that executes a plan', async () => {
    const { campaigns } = await import('../../src/api/client.js');
    expect(typeof campaigns.executionPlan).toBe('function');
    for (const name of Object.keys(campaigns)) {
      expect(name).not.toMatch(/execute|send|run|process|materialise/i);
    }
  });
});
