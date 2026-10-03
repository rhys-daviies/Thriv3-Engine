/**
 * =============================================================================
 * EDITING AN INPUT MAKES A RUN STALE. IT NEVER MAKES A RUN — A9.4 §L, §M, §T.
 *
 * Two properties, and the second is the one with teeth. A matchmaking run is a
 * dated record of somebody ASKING; if saving a profile created one, the
 * history would become a log of form submissions and an operator could never
 * point at a run and say "this is what we decided from".
 *
 * Staleness is never set by hand anywhere here. It falls out of
 * `inputDigest(inputSnapshot(player))` disagreeing with the snapshot stored
 * beside the run - which is why an unrelated field must NOT make a run stale,
 * and why that is tested as hard as the fields that must.
 * =============================================================================
 */
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import { seedPool } from './seedTestPool.js';
import { computeMatchmakingV2, clearContextCache } from './matchmakingService.js';
import {
  persistRun, currentRun, runStaleness, STALE_REASON, INPUT_FIELDS,
} from './matchmakingRuns.js';
import { clearCorpusDigestCache } from './corpusIdentity.js';
import { CONTRIBUTION_STATE } from '../../../shared/matching/v2/financialRules.js';
import { familyBudgetCeiling } from '../../../shared/matching/constants.js';

const created = [];

function athlete(extra = {}) {
  const row = Player.create({
    full_name: `A9.4 input ${created.length}`,
    sport: 'mens-soccer',
    position: 'Midfielder',
    football_ability: 6,
    recruiting_class_year: 2028,
    state: 'CA',
    origin: 'USA',
    contribution_state: CONTRIBUTION_STATE.STATED,
    max_annual_contribution_usd: 25000,
    ...extra,
  });
  created.push(row.id);
  return Player.get(row.id);
}

/** An athlete with a persisted, current run. */
function withRun(extra = {}) {
  const player = athlete(extra);
  persistRun(db, player, computeMatchmakingV2(db, player));
  const row = currentRun(db, player.id);
  expect(runStaleness(db, player, row).current).toBe(true);
  return { player, row };
}

const runCount = (playerId) => db.prepare('SELECT COUNT(*) c FROM matchmaking_runs WHERE player_id = ?')
  .get(playerId).c;

/** Save a patch the way the product does, and report what it cost. */
function save(player, patch) {
  const before = runCount(player.id);
  Player.update(player.id, patch);
  const after = Player.get(player.id);
  return { after, runsCreated: runCount(player.id) - before };
}

beforeAll(() => {
  seedPool('mens-soccer');
  clearContextCache();
  clearCorpusDigestCache();
});
afterAll(() => { for (const id of created) db.prepare('DELETE FROM players WHERE id = ?').run(id); });

/* ------------------------------------------------------------------ */
/* L. save -> stale, through the deterministic comparison only         */
/* ------------------------------------------------------------------ */

describe('A9.4 §L. every matchmaking input marks the run stale', () => {
  const marksStale = (label, patch, start = {}) => {
    it(`L. ${label}`, () => {
      const { player, row } = withRun(start);
      const { after, runsCreated } = save(player, patch);

      const staleness = runStaleness(db, after, row);
      expect(staleness.current, label).toBe(false);
      expect(staleness.reasons).toContain(STALE_REASON.PLAYER_INPUT_CHANGED);
      /** §M, asserted on every single one of these rather than once. */
      expect(runsCreated, 'saving must not create a run').toBe(0);
    });
  };

  marksStale('the family contribution amount', { max_annual_contribution_usd: 40000 });
  marksStale('the contribution STATE', {
    contribution_state: CONTRIBUTION_STATE.NOT_A_CONSTRAINT, max_annual_contribution_usd: null,
  });
  marksStale('adding an intended major', { intended_major: 'exercise science' }, { intended_major: null });
  marksStale('changing an intended major', { intended_major: 'business' }, { intended_major: 'exercise science' });
  marksStale('REMOVING an intended major', { intended_major: null }, { intended_major: 'exercise science' });
  marksStale('competitive level priority', { competitive_level_priority: 5 });
  marksStale('playing opportunity priority', { playing_opportunity_priority: 2 });
  marksStale('academic strength priority', { academic_strength_priority: 4 });

  it('L9. a field OUTSIDE the input snapshot does NOT mark the run stale', () => {
    /**
     * The other half of the claim, and the one that would quietly rot. If
     * every save marked every run stale, each test above would pass while the
     * feature was useless: an operator correcting a guardian's phone number
     * would be told their rankings are out of date.
     */
    const { player, row } = withRun();
    const unrelated = {
      guardian_name: 'A Guardian',
      guardian_email: 'guardian@example.test',
      club_name: 'Some Club FC',
      evaluation: 'Looked sharp in the March showcase.',
      time_zone: 'America/Los_Angeles',
    };
    for (const key of Object.keys(unrelated)) {
      expect(INPUT_FIELDS, `${key} must not be a matchmaking input`).not.toContain(key);
    }

    const { after, runsCreated } = save(player, unrelated);
    expect(runsCreated).toBe(0);
    const staleness = runStaleness(db, after, row);
    expect(staleness.reasons).not.toContain(STALE_REASON.PLAYER_INPUT_CHANGED);
    expect(staleness.current).toBe(true);
  });

  it('L10. staleness is derived, never stored — the run row is byte-identical after an edit', () => {
    const { player, row } = withRun();
    const before = db.prepare('SELECT * FROM matchmaking_runs WHERE id = ?').get(row.id);

    save(player, { competitive_level_priority: 1, intended_major: 'business' });

    const after = db.prepare('SELECT * FROM matchmaking_runs WHERE id = ?').get(row.id);
    expect(after).toEqual(before);
    /** Including the snapshot: history is not rewritten to match the present. */
    expect(JSON.parse(after.input_snapshot).competitive_level_priority)
      .not.toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* M. nothing recomputes on its own                                    */
/* ------------------------------------------------------------------ */

describe('A9.4 §M. no automatic recompute', () => {
  it('M1. a sequence of edits creates exactly zero runs, and an explicit ask creates one', () => {
    const { player } = withRun();
    expect(runCount(player.id)).toBe(1);

    let current = player;
    for (const patch of [
      { intended_major: 'exercise science' },
      { competitive_level_priority: 5 },
      { playing_opportunity_priority: 1 },
      { academic_strength_priority: 3 },
      { max_annual_contribution_usd: 31000 },
      { intended_major: null },
    ]) {
      current = save(current, patch).after;
      expect(runCount(player.id), JSON.stringify(patch)).toBe(1);
    }

    /** Only this creates one. */
    persistRun(db, current, computeMatchmakingV2(db, current));
    expect(runCount(player.id)).toBe(2);
  });

  it('M2. reading staleness repeatedly writes nothing', () => {
    const { player, row } = withRun();
    const before = runCount(player.id);
    const rows = db.prepare('SELECT COUNT(*) c FROM matchmaking_programme_results').get().c;
    for (let i = 0; i < 20; i += 1) runStaleness(db, player, row);
    expect(runCount(player.id)).toBe(before);
    expect(db.prepare('SELECT COUNT(*) c FROM matchmaking_programme_results').get().c).toBe(rows);
  });
});

/* ------------------------------------------------------------------ */
/* T. the contribution states                                          */
/* ------------------------------------------------------------------ */

describe('A9.4 §T. contribution states end to end', () => {
  it('T1. STATED ranks', () => {
    const player = athlete({ contribution_state: CONTRIBUTION_STATE.STATED, max_annual_contribution_usd: 20000 });
    expect(computeMatchmakingV2(db, player).counts.ranked).toBeGreaterThan(0);
  });

  it('T2. NOT_A_CONSTRAINT ranks, and is not the same answer as a big number', () => {
    const player = athlete({
      contribution_state: CONTRIBUTION_STATE.NOT_A_CONSTRAINT, max_annual_contribution_usd: null,
    });
    const result = computeMatchmakingV2(db, player);
    expect(result.counts.ranked).toBeGreaterThan(0);
    expect(result.contributionState).toBe(CONTRIBUTION_STATE.NOT_A_CONSTRAINT);
    /** It is a stated position, stored as one — never silently a maximum. */
    expect(Player.get(player.id).max_annual_contribution_usd).toBeNull();
  });

  it('T3. NEEDS_CONFIRMATION refuses with 409 CONTRIBUTION_UNRESOLVED, and is never read as $0', () => {
    const player = athlete({
      contribution_state: CONTRIBUTION_STATE.NEEDS_CONFIRMATION,
      max_annual_contribution_usd: null,
      budget_range: null,
    });
    let thrown = null;
    try { computeMatchmakingV2(db, player); } catch (err) { thrown = err; }
    expect(thrown?.code).toBe('CONTRIBUTION_UNRESOLVED');

    /**
     * THE COERCION THAT MUST NOT HAPPEN. Zero is the full-scholarship request
     * and means the opposite of "unanswered". Nothing may have written one.
     */
    const stored = Player.get(player.id);
    expect(stored.max_annual_contribution_usd).toBeNull();
    expect(stored.max_annual_contribution_usd).not.toBe(0);
    expect(runCount(player.id)).toBe(0);
  });

  it('T4. resolving the contribution lets an EXPLICIT run succeed, and only then', () => {
    const player = athlete({
      contribution_state: CONTRIBUTION_STATE.NEEDS_CONFIRMATION,
      max_annual_contribution_usd: null,
      budget_range: null,
    });
    expect(runCount(player.id)).toBe(0);

    const { after, runsCreated } = save(player, {
      contribution_state: CONTRIBUTION_STATE.STATED, max_annual_contribution_usd: 18000,
    });
    /** Saving the answer did not rank. */
    expect(runsCreated).toBe(0);
    expect(runCount(after.id)).toBe(0);

    persistRun(db, after, computeMatchmakingV2(db, after));
    expect(runCount(after.id)).toBe(1);
    expect(runStaleness(db, after, currentRun(db, after.id)).current).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* R. V1 coexistence                                                   */
/* ------------------------------------------------------------------ */

describe('A9.4 §R. V2 may refuse an unresolved contribution; V1 must not', () => {
  it('R1. the two engines read the SAME columns and apply different rules', () => {
    /**
     * Worth stating precisely, because the obvious assumption is wrong: V1
     * does not ignore the V2 contribution fields. `shared/matching/pool.js`
     * passes `contribution_state` and `max_annual_contribution_usd` into
     * `familyBudgetCeiling`, which has its own rule and its own fallback to
     * the legacy band.
     *
     * The difference is what each does with "unanswered". V2 REFUSES, because
     * Financial is 20% of Pursuit behind a gate and a guess would move every
     * ranking. V1 returns `undefined`, which its affordability criterion
     * scores at its neutral prior and labels as assumed — so an athlete whose
     * family has not answered still gets a V1 list, exactly as before.
     */
    const unresolved = {
      contributionState: CONTRIBUTION_STATE.NEEDS_CONFIRMATION,
      maxAnnualContributionUsd: null,
      budgetRange: null,
    };
    expect(familyBudgetCeiling(unresolved)).toBeUndefined();

    /** Never zero, which is the full-scholarship request and means the opposite. */
    expect(familyBudgetCeiling(unresolved)).not.toBe(0);

    /** And the same athlete is refused by V2. */
    const player = athlete({
      contribution_state: CONTRIBUTION_STATE.NEEDS_CONFIRMATION,
      max_annual_contribution_usd: null,
      budget_range: null,
    });
    expect(() => computeMatchmakingV2(db, player)).toThrow();
  });

  it('R2. a legacy band still answers for V1 when the new question is unanswered', () => {
    /** The rollback path must not need a V2-only input — §R. */
    expect(familyBudgetCeiling({
      contributionState: null, maxAnnualContributionUsd: null, budgetRange: '$5k-$10k/yr',
    })).toBeGreaterThan(0);
  });

  it('R3. NOT_A_CONSTRAINT is an answer to both, and is not a number in either', () => {
    expect(familyBudgetCeiling({
      contributionState: CONTRIBUTION_STATE.NOT_A_CONSTRAINT, maxAnnualContributionUsd: null,
    })).toBe(Infinity);

    const player = athlete({
      contribution_state: CONTRIBUTION_STATE.NOT_A_CONSTRAINT, max_annual_contribution_usd: null,
    });
    expect(computeMatchmakingV2(db, player).counts.ranked).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* P. the backend is authoritative                                     */
/* ------------------------------------------------------------------ */

describe('A9.4 §P. invalid input is refused by the server, not repaired', () => {
  it('P1. a priority outside 1-5 is refused rather than clamped', () => {
    const { player } = withRun();
    expect(() => Player.update(player.id, { competitive_level_priority: 7 })).toThrow();
    expect(() => Player.update(player.id, { academic_strength_priority: 0 })).toThrow();
    /** And nothing was half-written. */
    const stored = Player.get(player.id);
    expect(stored.competitive_level_priority).not.toBe(5);
    expect(stored.competitive_level_priority).not.toBe(7);
  });

  it('P2. an illegal contribution PAIR is refused, including via a partial patch', () => {
    const { player } = withRun();
    /** STATED with no amount is not a legal row, even though the patch is one field. */
    expect(() => Player.update(player.id, { max_annual_contribution_usd: null })).toThrow();
    expect(Player.get(player.id).max_annual_contribution_usd).toBe(25000);
  });

  it('P3. a numeric string priority is normalised, because the stack sends strings', () => {
    const { player } = withRun();
    Player.update(player.id, { competitive_level_priority: '4' });
    expect(Player.get(player.id).competitive_level_priority).toBe(4);
  });
});

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

describe('A9.4 history', () => {
  it('H1. an old run keeps the inputs it was computed from; a new run gets the new ones', () => {
    const { player, row } = withRun({ intended_major: 'exercise science', competitive_level_priority: 2 });
    const firstSnapshot = JSON.parse(row.input_snapshot);
    expect(firstSnapshot.intended_major).toBe('exercise science');
    expect(firstSnapshot.competitive_level_priority).toBe(2);

    const { after } = save(player, { intended_major: 'business', competitive_level_priority: 5 });
    persistRun(db, after, computeMatchmakingV2(db, after));

    const runs = db.prepare('SELECT * FROM matchmaking_runs WHERE player_id = ? ORDER BY created_at').all(player.id);
    expect(runs).toHaveLength(2);

    /** The first is untouched... */
    const older = JSON.parse(runs.find((r) => r.id === row.id).input_snapshot);
    expect(older.intended_major).toBe('exercise science');
    expect(older.competitive_level_priority).toBe(2);

    /** ...and the second records what was actually asked. */
    const newer = JSON.parse(runs.find((r) => r.id !== row.id).input_snapshot);
    expect(newer.intended_major).toBe('business');
    expect(newer.competitive_level_priority).toBe(5);
  });
});
