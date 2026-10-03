/**
 * =============================================================================
 * A CAMPAIGN FROM A PERSISTED RUN — A9.7 §E, §F.
 *
 * The claim: a V2 campaign's hundred targets are the run's own first hundred
 * ranked programmes, in the run's own order, with the run's own numbers - and
 * every one of them can say which run it came from.
 *
 * The failure worth guarding against is subtle. A campaign that quietly
 * recomputed, or that backfilled a suppressed slot from #101, would look
 * exactly like a correct one; the ranks would be plausible, the tiers would
 * band properly, and every outcome question asked a year later would be
 * answered against numbers the run never assigned.
 * =============================================================================
 */
import {
  describe, it, expect, beforeAll, afterAll, beforeEach,
} from 'vitest';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import { seedPool } from './seedTestPool.js';
import { computeMatchmakingV2, clearContextCache, STATUS } from './matchmakingService.js';
import { clearCorpusDigestCache } from './corpusIdentity.js';
import { persistRun, currentRun } from './matchmakingRuns.js';
import { createCampaignFromRun, MATCHING_MODEL_V2 } from './campaignFromRun.js';
import { createCampaign, MATCHING_MODEL_SIX_CRITERION, MAX_RANK } from '../campaigns.js';

const players = [];
let player;
let run;
let result;

function athlete() {
  const row = Player.create({
    full_name: `A9.7 campaign ${players.length}`,
    sport: 'mens-soccer',
    position: 'Midfielder',
    football_ability: 6,
    recruiting_class_year: 2028,
    state: 'CA',
    origin: 'USA',
    contribution_state: 'STATED',
    max_annual_contribution_usd: 25000,
  });
  players.push(row.id);
  return Player.get(row.id);
}

const wipe = (id) => {
  db.prepare(`DELETE FROM programme_campaigns WHERE campaign_id IN
              (SELECT id FROM campaigns WHERE athlete_id = ?)`).run(id);
  db.prepare('DELETE FROM campaigns WHERE athlete_id = ?').run(id);
  db.prepare('DELETE FROM matchmaking_selections WHERE player_id = ?').run(id);
  db.prepare('DELETE FROM athlete_programmes WHERE athlete_id = ?').run(id);
};

beforeAll(() => {
  seedPool('mens-soccer', { count: 160, unscoreable: 8 });
  seedPool('womens-soccer');
  clearContextCache();
  clearCorpusDigestCache();
  player = athlete();
  result = computeMatchmakingV2(db, player);
  persistRun(db, player, result);
  run = currentRun(db, player.id);
});

afterAll(() => {
  for (const id of players) { wipe(id); db.prepare('DELETE FROM players WHERE id = ?').run(id); }
});

beforeEach(() => wipe(player.id));

const rankedInRun = () => result.programmes
  .filter((p) => p.status === STATUS.RANKED)
  .sort((a, b) => a.rank - b.rank);

/* ------------------------------------------------------------------ */
/* E1-E5. The hundred are the run's hundred                            */
/* ------------------------------------------------------------------ */

describe('A9.7 §E. the Top 100 is the run\'s own first hundred', () => {
  it('E1. exactly the first 100 ranked programmes, in rank order', () => {
    const { programmes } = createCampaignFromRun(player.id);
    const expected = rankedInRun().slice(0, MAX_RANK);

    expect(programmes).toHaveLength(expected.length);
    expect(programmes.map((p) => p.college_name)).toEqual(expected.map((p) => p.name));
    expect(programmes.map((p) => p.rank)).toEqual(expected.map((p) => p.rank));
  });

  it('E2. no LIMITED_DATA and no unsupported association reaches a campaign row', () => {
    const { programmes } = createCampaignFromRun(player.id);
    const names = new Set(programmes.map((p) => p.college_name));

    const excluded = result.programmes.filter((p) => p.status !== STATUS.RANKED);
    expect(excluded.length).toBeGreaterThan(0);
    for (const p of excluded) expect(names.has(p.name)).toBe(false);
  });

  /**
   * THIS TEST EXISTS BECAUSE A MUTATION SURVIVED.
   *
   * Removing `status = RANKED` from the query changed nothing, and E2 still
   * passed - because in a real run every non-RANKED programme also has a null
   * rank, so `rank IS NOT NULL` was doing all the work. The status filter was
   * real defence-in-depth but was untested, which is the same as untrusted.
   *
   * So this constructs the case the two filters disagree about: a stored
   * result that is NOT ranked and yet carries a rank. Only the status filter
   * can exclude it. If a future persistence change ever lets a LIMITED_DATA
   * programme keep a rank, this is what notices before a campaign writes to it.
   */
  it('E2b. a non-RANKED result carrying a rank is still excluded', () => {
    db.prepare(`
      INSERT INTO matchmaking_programme_results
        (run_id, college_name, sport, status, rank, pursuit)
      VALUES (?, 'Impossible State FC', ?, ?, 7, 0.9)`)
      .run(run.id, run.sport, STATUS.SUPPORTED_LIMITED_DATA);

    try {
      const { programmes } = createCampaignFromRun(player.id);
      expect(programmes.map((p) => p.college_name)).not.toContain('Impossible State FC');
    } finally {
      db.prepare("DELETE FROM matchmaking_programme_results WHERE college_name = 'Impossible State FC'")
        .run();
    }
  });

  it('E3. nothing beyond rank 100 enters, however large the run', () => {
    const { programmes } = createCampaignFromRun(player.id);
    for (const p of programmes) {
      expect(p.rank).toBeGreaterThanOrEqual(1);
      expect(p.rank).toBeLessThanOrEqual(MAX_RANK);
    }
  });

  it('E4. the stored numbers are the RUN\'S numbers, not recomputed ones', () => {
    const { programmes } = createCampaignFromRun(player.id);
    const byName = new Map(result.programmes.map((p) => [p.name, p]));

    for (const row of programmes) {
      const fromRun = byName.get(row.college_name);
      const breakdown = JSON.parse(row.score_breakdown);
      expect(breakdown.model).toBe(MATCHING_MODEL_V2);
      expect(breakdown.pursuit).toBeCloseTo(fromRun.pursuit, 10);
      expect(row.rank).toBe(fromRun.rank);
    }
  });

  it('E5. creating it twice from the same run gives identical target lists', () => {
    const first = createCampaignFromRun(player.id);
    const second = createCampaignFromRun(player.id);
    expect(second.programmes.map((p) => `${p.rank}:${p.college_name}`))
      .toEqual(first.programmes.map((p) => `${p.rank}:${p.college_name}`));
  });
});

/* ------------------------------------------------------------------ */
/* F. Provenance, per programme                                        */
/* ------------------------------------------------------------------ */

describe('A9.7 §F. every target can name the run it came from', () => {
  it('F1. each programme row carries a selection that resolves to this run', () => {
    const { programmes, runId } = createCampaignFromRun(player.id);
    expect(runId).toBe(run.id);

    for (const row of programmes) {
      expect(row.matchmaking_selection_id).toBeTruthy();
      const sel = db.prepare('SELECT * FROM matchmaking_selections WHERE id = ?')
        .get(row.matchmaking_selection_id);
      expect(sel.matchmaking_run_id).toBe(run.id);
      expect(sel.college_name).toBe(row.college_name);
      expect(sel.rank).toBe(row.rank);
      expect(sel.source).toBe('TOP_100');
      expect(sel.player_id).toBe(player.id);
    }
  });

  it('F2. the campaign names the RUN, not a file path', () => {
    const { campaign } = createCampaignFromRun(player.id);
    expect(campaign.source_analysis_ref).toBe(`matchmaking_run:${run.id}`);
    const inputs = JSON.parse(campaign.matching_inputs);
    expect(inputs.model).toBe(MATCHING_MODEL_V2);
    expect(inputs.matchmakingRunId).toBe(run.id);
  });

  /**
   * §F: provenance is PER PROGRAMME, so a campaign can honestly hold targets
   * from more than one run. Proved by moving one target's selection to a
   * second run and reading both back — a campaign-level run id could not
   * represent this at all.
   */
  it('F3. two programmes in one campaign may name different runs', () => {
    const { programmes } = createCampaignFromRun(player.id);

    clearContextCache();
    const resultB = computeMatchmakingV2(db, player);
    persistRun(db, player, resultB);
    const runB = currentRun(db, player.id);
    expect(runB.id).not.toBe(run.id);

    const target = programmes[0];
    const inB = resultB.programmes.find((p) => p.name === target.college_name);
    const newSelection = db.prepare(`
      INSERT INTO matchmaking_selections
        (id, player_id, matchmaking_run_id, college_name, sport, status, rank, band, pursuit,
         source, run_was_stale, selected_at)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, 'SPECIFIC_SEARCH', 0, ?)
      RETURNING id`).get(
      player.id, runB.id, target.college_name, run.sport,
      inB.status, inB.rank ?? null, inB.band ?? null, inB.pursuit ?? null,
      new Date().toISOString(),
    );
    db.prepare('UPDATE programme_campaigns SET matchmaking_selection_id = ? WHERE id = ?')
      .run(newSelection.id, target.id);

    const runsInCampaign = db.prepare(`
      SELECT DISTINCT s.matchmaking_run_id
        FROM programme_campaigns pc
        JOIN matchmaking_selections s ON s.id = pc.matchmaking_selection_id
       WHERE pc.campaign_id = ?`).all(programmes[0].campaign_id).map((r) => r.matchmaking_run_id);

    expect(runsInCampaign.sort()).toEqual([run.id, runB.id].sort());
  });
});

/* ------------------------------------------------------------------ */
/* Suppression, and the slot that is NOT backfilled                    */
/* ------------------------------------------------------------------ */

describe('A9.7 §E. suppression removes a target without renumbering the run', () => {
  it('E6. a suppressed programme is absent, and #101 does NOT take its place', () => {
    const ranked = rankedInRun();
    const victim = ranked[3];
    const hundredAndFirst = ranked[MAX_RANK]?.name ?? null;

    db.prepare(`INSERT INTO athlete_programmes
                  (id, athlete_id, college_name, sport, visibility, created_at, updated_at)
                VALUES (lower(hex(randomblob(16))), ?, ?, ?, 'suppressed', ?, ?)`)
      .run(player.id, victim.name, run.sport, new Date().toISOString(), new Date().toISOString());

    const { programmes, campaign } = createCampaignFromRun(player.id);
    const names = programmes.map((p) => p.college_name);

    expect(names).not.toContain(victim.name);
    expect(programmes).toHaveLength(Math.min(ranked.length, MAX_RANK) - 1);
    if (hundredAndFirst) expect(names).not.toContain(hundredAndFirst);

    // Every remaining rank is still the rank the RUN gave it.
    const byName = new Map(ranked.map((p) => [p.name, p.rank]));
    for (const row of programmes) expect(row.rank).toBe(byName.get(row.college_name));
    expect(JSON.parse(campaign.matching_inputs).suppressed).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* V1 coexistence                                                      */
/* ------------------------------------------------------------------ */

describe('A9.7 §E / §W. V1 campaign creation is untouched', () => {
  it('W1. a V1 campaign still refuses when there is no stored analysis', () => {
    expect(() => createCampaign(player.id)).toThrow(/no stored match analysis/i);
  });

  it('W2. the two models are marked differently and are never comparable', () => {
    const { campaign } = createCampaignFromRun(player.id);
    expect(JSON.parse(campaign.matching_inputs).model).toBe(MATCHING_MODEL_V2);
    expect(MATCHING_MODEL_V2).not.toBe(MATCHING_MODEL_SIX_CRITERION);
  });

  it('W3. a V2 campaign is a DRAFT, like every other campaign', () => {
    const { campaign, programmes } = createCampaignFromRun(player.id);
    expect(campaign.state).toBe('draft');
    for (const p of programmes) {
      expect(p.state).toBe('queued');
      expect(p.tier_source).toBe('AUTO');
      expect(['A', 'B', 'C']).toContain(p.tier);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

describe('A9.7 §E. refusals are truthful', () => {
  it('E7. an athlete with no run is told so, not given an empty campaign', () => {
    const fresh = athlete();
    expect(() => createCampaignFromRun(fresh.id)).toThrow(/no matchmaking run/i);
    expect(db.prepare('SELECT COUNT(*) n FROM campaigns WHERE athlete_id = ?').get(fresh.id).n)
      .toBe(0);
  });

  it('E8. another athlete\'s run id is refused', () => {
    const other = athlete();
    const otherResult = computeMatchmakingV2(db, other);
    persistRun(db, other, otherResult);
    const otherRun = currentRun(db, other.id);
    expect(() => createCampaignFromRun(player.id, { runId: otherRun.id }))
      .toThrow(/different athlete/i);
  });

  it('E9. an interrupted creation leaves nothing behind', () => {
    const before = db.prepare('SELECT COUNT(*) n FROM campaigns WHERE athlete_id = ?')
      .get(player.id).n;
    expect(() => createCampaignFromRun(player.id, { runId: 'no-such-run' })).toThrow();
    expect(db.prepare('SELECT COUNT(*) n FROM campaigns WHERE athlete_id = ?').get(player.id).n)
      .toBe(before);
    expect(db.prepare('SELECT COUNT(*) n FROM matchmaking_selections WHERE player_id = ?')
      .get(player.id).n).toBe(0);
  });
});
