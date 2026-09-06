import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db/client.js';
import {
  CAMPAIGN_STATES, PROGRAMME_CAMPAIGN_STATES, CLOSE_REASONS, TIER_BANDS, MAX_RANK,
  tierForRank,
  getCampaign, listCampaignsForAthlete, activeCampaignForAthlete,
  getProgrammeCampaign, listProgrammeCampaigns,
  setCampaignState, activateCampaign, closeCampaign,
  setProgrammeCampaignState, startProgrammeCampaign, stopProgrammeCampaign, completeProgrammeCampaign,
  setProgrammeTier, restoreAutoTier,
} from './campaigns.js';

/**
 * A2 — the invariants, exercised through the module that owns them.
 *
 * Rows are inserted with raw SQL rather than through a helper in the library,
 * deliberately: creating a campaign means snapshotting a match list, and that
 * is the NEXT slice. A2 owns what may happen to a campaign that exists, not
 * how one comes to exist, and a fixture builder here would quietly become the
 * creation path.
 */

const ATHLETE = 'a-campaign-lib';
const OTHER = 'a-campaign-lib-other';

function insertAthlete(id, name) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer')
  `).run(id, name);
}

let seq = 0;
function makeCampaign({ state = 'draft', athlete_id = ATHLETE, starts_on = '2026-09-07', ...rest } = {}) {
  const id = `c-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (
      id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count
    ) VALUES (?, ?, 'mens-soccer', ?, ?, '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z',
      '2026-09-07T00:00:00.000Z', 100)
  `).run(id, athlete_id, state, starts_on);
  if (Object.keys(rest).length) {
    const cols = Object.keys(rest);
    db.prepare(`UPDATE campaigns SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`)
      .run({ ...rest, id });
  }
  return id;
}

function makeProgramme(campaignId, { rank = 1, tier = 'A', state = 'queued', ...rest } = {}) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (
      id, campaign_id, college_name, sport, college_id, rank, match_score, score_breakdown,
      division, conference, tier, state, created_at, updated_at
    ) VALUES (?, ?, ?, 'mens-soccer', 'col-1', ?, 82, '{"geography":0.8}',
      'D1', 'Big East', ?, ?, '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z')
  `).run(id, campaignId, rest.college_name || `School ${rank}`, rank, tier, state);
  if (rest.state_reason) {
    db.prepare('UPDATE programme_campaigns SET state_reason = ? WHERE id = ?').run(rest.state_reason, id);
  }
  return id;
}

beforeEach(() => {
  db.exec('DELETE FROM programme_campaigns; DELETE FROM campaigns; DELETE FROM players;');
  insertAthlete(ATHLETE, 'Campaign Lib');
  insertAthlete(OTHER, 'Campaign Lib Other');
});

// ---------------------------------------------------------------------------

describe('tier banding', () => {
  it('bands the approved ranges', () => {
    expect(tierForRank(1)).toBe('A');
    expect(tierForRank(20)).toBe('A');
    expect(tierForRank(21)).toBe('B');
    expect(tierForRank(50)).toBe('B');
    expect(tierForRank(51)).toBe('C');
    expect(tierForRank(100)).toBe('C');
  });

  it('bands every rank in a Top 100 and nothing else', () => {
    const counts = { A: 0, B: 0, C: 0 };
    for (let r = 1; r <= MAX_RANK; r += 1) counts[tierForRank(r)] += 1;
    expect(counts).toEqual({ A: 20, B: 30, C: 50 });
  });

  it('refuses a rank it has no rule for rather than guessing', () => {
    // Silently banding these as C would put a programme at a tier no rule chose.
    for (const bad of [0, -1, -100, 101, 1000]) {
      expect(() => tierForRank(bad)).toThrow(/Rank must be/);
    }
    for (const bad of [null, undefined, NaN, 1.5, '1', '20', {}, [], true]) {
      expect(() => tierForRank(bad)).toThrow(/Rank must be an integer/);
    }
  });

  it('reports INVALID_RANK as a code, not only a message', () => {
    expect(() => tierForRank(0)).toThrow(expect.objectContaining({ code: 'INVALID_RANK' }));
  });

  it('exposes bands that are contiguous and cover 1..MAX_RANK', () => {
    expect(TIER_BANDS[0].from).toBe(1);
    expect(TIER_BANDS[TIER_BANDS.length - 1].to).toBe(MAX_RANK);
    for (let i = 1; i < TIER_BANDS.length; i += 1) {
      expect(TIER_BANDS[i].from).toBe(TIER_BANDS[i - 1].to + 1);
    }
  });

  /**
   * Depth and cadence are a later phase's rules. If they ever became reachable
   * from here, two places would decide them and they would drift.
   */
  it('answers only rank -> tier', () => {
    expect(typeof tierForRank(1)).toBe('string');
    expect(TIER_BANDS.every((b) => Object.keys(b).sort().join() === 'from,tier,to')).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('campaign lifecycle', () => {
  it('moves draft -> active', () => {
    const id = makeCampaign();
    const out = activateCampaign(id);
    expect(out.state).toBe('active');
    expect(out.changed).toBe(true);
  });

  it('moves draft -> closed', () => {
    const id = makeCampaign();
    expect(closeCampaign(id, { reason: 'athlete_withdrawn' }).state).toBe('closed');
  });

  it('moves active -> closed', () => {
    const id = makeCampaign({ state: 'active' });
    expect(closeCampaign(id, { reason: 'completed' }).state).toBe('closed');
  });

  it('refuses active -> draft', () => {
    const id = makeCampaign({ state: 'active' });
    expect(() => setCampaignState(id, 'draft')).toThrow(/cannot go from active to draft/);
    expect(getCampaign(id).state).toBe('active');
  });

  it('refuses closed -> active and closed -> draft, because closed is terminal', () => {
    const id = makeCampaign({ state: 'closed' });
    expect(() => setCampaignState(id, 'active')).toThrow(/closed is terminal/);
    expect(() => setCampaignState(id, 'draft')).toThrow(/closed is terminal/);
    expect(getCampaign(id).state).toBe('closed');
  });

  it('reports an illegal move with a code', () => {
    const id = makeCampaign({ state: 'closed' });
    expect(() => setCampaignState(id, 'active'))
      .toThrow(expect.objectContaining({ code: 'ILLEGAL_TRANSITION' }));
  });

  it('refuses a state that is not a state at all', () => {
    const id = makeCampaign();
    expect(() => setCampaignState(id, 'paused'))
      .toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
  });

  it('refuses to act on a campaign that does not exist', () => {
    expect(() => activateCampaign('nope'))
      .toThrow(expect.objectContaining({ code: 'CAMPAIGN_NOT_FOUND' }));
  });

  it('records closed_at and the reason when closing', () => {
    const id = makeCampaign({ state: 'active' });
    const out = closeCampaign(id, { reason: 'athlete_committed', at: '2026-10-01T09:00:00.000Z' });
    expect(out.closed_at).toBe('2026-10-01T09:00:00.000Z');
    expect(out.close_reason).toBe('athlete_committed');
    expect(out.updated_at).toBe('2026-10-01T09:00:00.000Z');
  });

  it('will not close a campaign without a reason', () => {
    const id = makeCampaign({ state: 'active' });
    expect(() => closeCampaign(id))
      .toThrow(expect.objectContaining({ code: 'CLOSE_REASON_REQUIRED' }));
    expect(() => closeCampaign(id, { reason: '' }))
      .toThrow(expect.objectContaining({ code: 'CLOSE_REASON_REQUIRED' }));
    expect(getCampaign(id).state).toBe('active');
  });

  it('will not close a campaign for a reason outside the vocabulary', () => {
    const id = makeCampaign({ state: 'active' });
    expect(() => closeCampaign(id, { reason: 'because' }))
      .toThrow(expect.objectContaining({ code: 'UNKNOWN_CLOSE_REASON' }));
    for (const reason of CLOSE_REASONS) {
      const fresh = makeCampaign({ state: 'active', athlete_id: OTHER });
      expect(() => closeCampaign(fresh, { reason })).not.toThrow();
    }
  });

  /**
   * The vocabulary is enforced in code and NOT as a CHECK constraint, so a new
   * reason is a one-line change here rather than a schema migration.
   */
  it('keeps the close vocabulary out of the database', () => {
    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'campaigns'").get().sql
      .replace(/--.*$/gm, '');
    // Exactly one CHECK on this table, and it is the lifecycle one. A reason
    // vocabulary in DDL would mean a schema migration every time a new reason
    // is wanted — which is the whole argument for validating it in code.
    expect(ddl.match(/CHECK\s*\(/gi)).toHaveLength(1);
    expect(ddl).toMatch(/state\s+TEXT\s+NOT NULL\s+DEFAULT\s+'draft'\s+CHECK/);
    expect(ddl).not.toMatch(/close_reason[^\n]*CHECK/i);
  });

  describe('the same state twice', () => {
    /**
     * The convention `suppress()`, `createOutreach` and `markOutreachSent`
     * already set: a repeat is a no-op that preserves the first write.
     */
    it('is a no-op that writes nothing', () => {
      const id = makeCampaign({ state: 'active' });
      const before = getCampaign(id);
      const out = activateCampaign(id, { at: '2027-01-01T00:00:00.000Z' });
      expect(out.changed).toBe(false);
      expect(getCampaign(id)).toEqual(before);
    });

    it('cannot overwrite the closure that actually happened', () => {
      const id = makeCampaign({ state: 'active' });
      closeCampaign(id, { reason: 'athlete_committed', at: '2026-10-01T09:00:00.000Z' });
      // A double-click, a retried request, a second operator.
      const again = closeCampaign(id, { reason: 'operator', at: '2026-12-25T09:00:00.000Z' });
      expect(again.changed).toBe(false);
      expect(again.closed_at).toBe('2026-10-01T09:00:00.000Z');
      expect(again.close_reason).toBe('athlete_committed');
    });

    it('does not even validate the reason, because it is not going to use it', () => {
      const id = makeCampaign({ state: 'closed', close_reason: 'completed' });
      expect(() => closeCampaign(id, { reason: 'nonsense' })).not.toThrow();
    });
  });
});

describe('one active campaign per athlete', () => {
  it('fails activation with a domain error, not a SQLite constraint', () => {
    const first = makeCampaign();
    activateCampaign(first);
    const second = makeCampaign();

    let thrown;
    try { activateCampaign(second); } catch (err) { thrown = err; }

    expect(thrown.code).toBe('CAMPAIGN_ACTIVE_CONFLICT');
    expect(thrown.message).toContain(first);
    expect(thrown.message).not.toMatch(/UNIQUE constraint/);
    expect(getCampaign(second).state).toBe('draft');
  });

  it('lets each athlete have one', () => {
    activateCampaign(makeCampaign({ athlete_id: ATHLETE }));
    expect(() => activateCampaign(makeCampaign({ athlete_id: OTHER }))).not.toThrow();
  });

  it('frees the slot once the active campaign closes', () => {
    const first = makeCampaign();
    activateCampaign(first);
    const second = makeCampaign();
    closeCampaign(first, { reason: 'completed' });
    expect(() => activateCampaign(second)).not.toThrow();
    expect(activeCampaignForAthlete(ATHLETE).id).toBe(second);
  });

  /**
   * The check in the library and the partial index in the schema are not
   * redundant: the check produces the readable error, the index is what holds
   * if anything ever writes around this module.
   */
  it('is still refused by the database itself', () => {
    activateCampaign(makeCampaign());
    const second = makeCampaign();
    expect(() => db.prepare("UPDATE campaigns SET state = 'active' WHERE id = ?").run(second))
      .toThrow(/UNIQUE constraint failed/);
  });
});

// ---------------------------------------------------------------------------

describe('programme campaign lifecycle', () => {
  let campaignId;
  beforeEach(() => { campaignId = makeCampaign({ state: 'active' }); });

  it('moves queued -> active', () => {
    const id = makeProgramme(campaignId);
    expect(startProgrammeCampaign(id).state).toBe('active');
  });

  it('moves queued -> stopped with a reason, before any message was sent', () => {
    const id = makeProgramme(campaignId);
    const out = stopProgrammeCampaign(id, { reason: 'suppressed' });
    expect(out.state).toBe('stopped');
    expect(out.state_reason).toBe('suppressed');
  });

  it('refuses queued -> stopped without a reason', () => {
    const id = makeProgramme(campaignId);
    for (const reason of [undefined, null, '', '   ']) {
      expect(() => stopProgrammeCampaign(id, { reason }))
        .toThrow(expect.objectContaining({ code: 'STOP_REASON_REQUIRED' }));
    }
    expect(getProgrammeCampaign(id).state).toBe('queued');
  });

  it('moves active -> stopped with a reason', () => {
    const id = makeProgramme(campaignId, { state: 'active' });
    expect(stopProgrammeCampaign(id, { reason: 'not_recruiting' }).state_reason).toBe('not_recruiting');
  });

  it('moves active -> completed', () => {
    const id = makeProgramme(campaignId, { state: 'active' });
    expect(completeProgrammeCampaign(id).state).toBe('completed');
  });

  it('moves stopped -> active, because a stop is not a verdict for all time', () => {
    const id = makeProgramme(campaignId, { state: 'stopped', state_reason: 'no_contact' });
    expect(startProgrammeCampaign(id).state).toBe('active');
  });

  it('clears the stale stop reason when a programme is reopened', () => {
    const id = makeProgramme(campaignId, { state: 'stopped', state_reason: 'not_recruiting' });
    expect(startProgrammeCampaign(id).state_reason).toBeNull();
  });

  it('never lets completed inherit a previous stop reason', () => {
    const id = makeProgramme(campaignId, { state: 'active' });
    stopProgrammeCampaign(id, { reason: 'not_interested' });
    startProgrammeCampaign(id);
    const done = completeProgrammeCampaign(id);
    expect(done.state).toBe('completed');
    expect(done.state_reason).toBeNull();
  });

  it('refuses to leave completed at all', () => {
    const id = makeProgramme(campaignId, { state: 'completed' });
    for (const next of ['active', 'stopped', 'queued']) {
      expect(() => setProgrammeCampaignState(id, next, { reason: 'operator' }))
        .toThrow(/completed is terminal/);
    }
    expect(getProgrammeCampaign(id).state).toBe('completed');
  });

  it('refuses the moves that were never approved', () => {
    // A programme that never sent a message did not finish its outreach, and a
    // stopped one is reopened through `active` rather than declared finished.
    const queued = makeProgramme(campaignId, { rank: 2 });
    expect(() => completeProgrammeCampaign(queued)).toThrow(/cannot go from queued to completed/);
    const stopped = makeProgramme(campaignId, { rank: 3, state: 'stopped', state_reason: 'operator' });
    expect(() => completeProgrammeCampaign(stopped)).toThrow(/cannot go from stopped to completed/);
    // And nothing returns to the queue.
    const active = makeProgramme(campaignId, { rank: 4, state: 'active' });
    expect(() => setProgrammeCampaignState(active, 'queued')).toThrow(/cannot go from active to queued/);
  });

  it('stamps state_changed_at on a genuine transition and leaves it on a no-op', () => {
    const id = makeProgramme(campaignId);
    expect(getProgrammeCampaign(id).state_changed_at).toBeNull();

    const started = startProgrammeCampaign(id, { at: '2026-09-10T10:00:00.000Z' });
    expect(started.state_changed_at).toBe('2026-09-10T10:00:00.000Z');
    expect(started.updated_at).toBe('2026-09-10T10:00:00.000Z');

    const again = startProgrammeCampaign(id, { at: '2026-11-11T10:00:00.000Z' });
    expect(again.changed).toBe(false);
    expect(again.state_changed_at).toBe('2026-09-10T10:00:00.000Z');

    const stopped = stopProgrammeCampaign(id, { reason: 'operator', at: '2026-09-20T10:00:00.000Z' });
    expect(stopped.state_changed_at).toBe('2026-09-20T10:00:00.000Z');
  });

  it('refuses a programme state that is not a state', () => {
    const id = makeProgramme(campaignId);
    for (const bogus of ['awaiting_response', 'action_required', 'active_conversation',
      'not_interested', 'not_recruiting', 'unreachable']) {
      expect(() => setProgrammeCampaignState(id, bogus))
        .toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
    }
  });

  it('accepts a stop reason outside the known list, because classification will bring more', () => {
    const id = makeProgramme(campaignId, { state: 'active' });
    expect(stopProgrammeCampaign(id, { reason: 'roster_full_at_position' }).state_reason)
      .toBe('roster_full_at_position');
  });

  it('refuses to act on a programme campaign that does not exist', () => {
    expect(() => startProgrammeCampaign('nope'))
      .toThrow(expect.objectContaining({ code: 'PROGRAMME_CAMPAIGN_NOT_FOUND' }));
  });

  it('leaves membership and the snapshot alone when outreach stops', () => {
    // Rule 1: tiering and stopping control outreach, never membership.
    const id = makeProgramme(campaignId, { rank: 7, tier: 'A' });
    const before = getProgrammeCampaign(id);
    stopProgrammeCampaign(id, { reason: 'not_recruiting' });
    const after = getProgrammeCampaign(id);
    expect(listProgrammeCampaigns(campaignId).map((p) => p.id)).toContain(id);
    expect([after.rank, after.match_score, after.tier, after.college_name, after.score_breakdown])
      .toEqual([before.rank, before.match_score, before.tier, before.college_name, before.score_breakdown]);
  });
});

// ---------------------------------------------------------------------------

describe('tier assignment', () => {
  let campaignId;
  beforeEach(() => { campaignId = makeCampaign(); });

  it('records an operator override as OPERATOR and moves nothing else', () => {
    const id = makeProgramme(campaignId, { rank: 62, tier: 'C' });
    const out = setProgrammeTier(id, 'A', { at: '2026-09-12T08:00:00.000Z' });

    expect(out.tier).toBe('A');
    expect(out.tier_source).toBe('OPERATOR');
    expect(out.tier_set_at).toBe('2026-09-12T08:00:00.000Z');
    expect(out.previousTier).toBe('C');
    // The whole reason rank is stored separately from tier.
    expect(out.rank).toBe(62);
  });

  it('cannot touch a snapshot field', () => {
    const id = makeProgramme(campaignId, { rank: 62, tier: 'C' });
    const before = getProgrammeCampaign(id);
    setProgrammeTier(id, 'A');
    const after = getProgrammeCampaign(id);

    for (const frozen of ['rank', 'match_score', 'score_breakdown', 'college_name',
      'sport', 'college_id', 'division', 'conference', 'campaign_id', 'created_at']) {
      expect(after[frozen]).toEqual(before[frozen]);
    }
    // And it is not a state change either.
    expect(after.state).toBe(before.state);
    expect(after.state_changed_at).toBe(before.state_changed_at);
  });

  it('refuses a tier outside A/B/C', () => {
    const id = makeProgramme(campaignId);
    for (const bad of ['D', 'a', 'hot', '', null]) {
      expect(() => setProgrammeTier(id, bad))
        .toThrow(expect.objectContaining({ code: 'INVALID_TIER' }));
    }
  });

  /**
   * Confirming the band is information: it says a human looked. That is why
   * this is not treated as the same-state no-op the lifecycle uses.
   */
  it('records an override even when it names the tier the band already chose', () => {
    const id = makeProgramme(campaignId, { rank: 5, tier: 'A' });
    const out = setProgrammeTier(id, 'A');
    expect(out.tier_source).toBe('OPERATOR');
  });

  describe('restoring the automatic tier', () => {
    it('derives from the immutable rank, not from anything the operator typed', () => {
      const id = makeProgramme(campaignId, { rank: 62, tier: 'C' });
      setProgrammeTier(id, 'A');
      const out = restoreAutoTier(id, { at: '2026-09-14T08:00:00.000Z' });

      expect(out.tier).toBe('C');            // 62 falls in the 51-100 band
      expect(out.tier_source).toBe('AUTO');
      expect(out.tier_set_at).toBe('2026-09-14T08:00:00.000Z');
      expect(out.previousTier).toBe('A');
      expect(out.rank).toBe(62);
    });

    it('agrees with the banding function for every rank', () => {
      // One rule, one implementation. A second copy of the bands is how the
      // restore and the assignment drift apart.
      for (const rank of [1, 20, 21, 50, 51, 100]) {
        const id = makeProgramme(campaignId, { rank, tier: 'B' });
        expect(restoreAutoTier(id).tier).toBe(tierForRank(rank));
      }
    });

    it('changes no snapshot field either', () => {
      const id = makeProgramme(campaignId, { rank: 3, tier: 'C' });
      const before = getProgrammeCampaign(id);
      restoreAutoTier(id);
      const after = getProgrammeCampaign(id);
      expect([after.rank, after.match_score, after.college_name, after.score_breakdown])
        .toEqual([before.rank, before.match_score, before.college_name, before.score_breakdown]);
    });
  });
});

// ---------------------------------------------------------------------------

describe('reads', () => {
  it('returns programme campaigns in snapshot rank order', () => {
    const id = makeCampaign();
    // Inserted out of order, and with tiers that would sort differently.
    for (const rank of [51, 3, 100, 21, 1]) makeProgramme(id, { rank, tier: tierForRank(rank) });
    expect(listProgrammeCampaigns(id).map((p) => p.rank)).toEqual([1, 3, 21, 51, 100]);
  });

  it('keeps rank order after an operator re-tiers the list', () => {
    const id = makeCampaign();
    for (const rank of [1, 2, 62]) makeProgramme(id, { rank, tier: tierForRank(rank) });
    const promoted = listProgrammeCampaigns(id).find((p) => p.rank === 62);
    setProgrammeTier(promoted.id, 'A');
    expect(listProgrammeCampaigns(id).map((p) => p.rank)).toEqual([1, 2, 62]);
  });

  it('scopes campaigns to their athlete with no cross-athlete leakage', () => {
    const mine = [makeCampaign({ athlete_id: ATHLETE }), makeCampaign({ athlete_id: ATHLETE })];
    const theirs = makeCampaign({ athlete_id: OTHER });

    const listed = listCampaignsForAthlete(ATHLETE);
    expect(listed.map((c) => c.id).sort()).toEqual(mine.sort());
    expect(listed.every((c) => c.athlete_id === ATHLETE)).toBe(true);
    expect(listed.map((c) => c.id)).not.toContain(theirs);
    expect(listCampaignsForAthlete('nobody')).toEqual([]);
  });

  it('scopes programme campaigns to their campaign', () => {
    const a = makeCampaign();
    const b = makeCampaign();
    makeProgramme(a, { rank: 1, college_name: 'Butler' });
    makeProgramme(b, { rank: 1, college_name: 'Duke' });
    expect(listProgrammeCampaigns(a).map((p) => p.college_name)).toEqual(['Butler']);
    expect(listProgrammeCampaigns(b).map((p) => p.college_name)).toEqual(['Duke']);
  });

  it('orders an athlete’s campaigns newest first, deterministically', () => {
    makeCampaign({ starts_on: '2026-01-01' });
    makeCampaign({ starts_on: '2026-09-07' });
    makeCampaign({ starts_on: '2025-06-01' });
    expect(listCampaignsForAthlete(ATHLETE).map((c) => c.starts_on))
      .toEqual(['2026-09-07', '2026-01-01', '2025-06-01']);
  });

  it('returns null rather than undefined for a miss', () => {
    expect(getCampaign('nope')).toBeNull();
    expect(getProgrammeCampaign('nope')).toBeNull();
    expect(activeCampaignForAthlete(ATHLETE)).toBeNull();
  });

  /**
   * `tier` on one of these rows is ALWAYS the campaign tier. These are
   * single-table reads with no join, so no engagement figure can arrive under
   * a name that already means something else here.
   */
  it('carries no engagement field that could be mistaken for a campaign one', () => {
    const id = makeCampaign();
    const pc = getProgrammeCampaign(makeProgramme(id));
    for (const engagement of ['engagement_score', 'qualified_visits', 'best_coverage_pct',
      'responded_at', 'total_rewinds', 'chapter_jumps']) {
      expect(pc).not.toHaveProperty(engagement);
    }
    expect(pc.tier).toBe('A');
  });
});

// ---------------------------------------------------------------------------

describe('the boundary this module is', () => {
  it('exports the approved vocabularies and nothing wider', () => {
    expect(CAMPAIGN_STATES).toEqual(['draft', 'active', 'closed']);
    expect(PROGRAMME_CAMPAIGN_STATES).toEqual(['queued', 'active', 'stopped', 'completed']);
  });

  /**
   * A2 is deliberately narrow. If any of these appears, a later slice has been
   * pulled forward into the module that owns the invariants.
   */
  it('reaches nothing outside the two campaign tables', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('./campaigns.js', import.meta.url), 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    /**
     * Every table this module's SQL names. `players` was added at A3 —
     * creation loads the athlete and their stored-analysis pointer — and that
     * is the whole of the widening. `outreach`, `outreach_send`, `coaches`,
     * `colleges` and `roster_players` are other slices' business, and reading
     * a college or roster table here would mean creation was reconstructing
     * the ranking rather than freezing it.
     */
    // Read out of the SQL itself rather than the whole file, so an error
    // message saying "inferred from the stored breakdown" is not mistaken for
    // a query against a table called `the`.
    const sql = [...body.matchAll(/db\.prepare\(\s*(`[^`]*`|'[^']*')/g)].map((m) => m[1]);
    expect(sql.length).toBeGreaterThan(0);
    const tables = sql.flatMap((s) => [...s.matchAll(/\b(?:FROM|UPDATE|JOIN|INTO)\s+([a-z_][a-z0-9_]*)/gi)]
      .map((m) => m[1].toLowerCase()));
    expect([...new Set(tables)].sort()).toEqual(['campaigns', 'players', 'programme_campaigns']);

    // And every module it depends on. Note the absence of shared/matching:
    // creation must never be able to re-score anything.
    const imports = [...body.matchAll(/\bfrom\s+'([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual([
      '../db/client.js', './time.js', './uploadPath.js', 'node:crypto', 'node:fs', 'node:path',
    ]);

    // No scheduling and no network. The filesystem is reachable, but only
    // through resolveAnalysisPath, which is tested separately.
    for (const forbidden of ['fetch(', 'setTimeout', 'setInterval', 'child_process', 'https']) {
      expect(body).not.toContain(forbidden);
    }
  });
});
