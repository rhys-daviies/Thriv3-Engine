/**
 * =============================================================================
 * SPECIFIC SEARCH + OUTREACH PROVENANCE — A9.5.
 *
 * Two claims, and the second is the one that cannot be repaired if it is
 * wrong. The first is that Specific Search is a LOOKUP: it reads a persisted
 * run and never scores anything. The second is that a selection row always
 * describes something that actually happened - a run that exists, belongs to
 * this athlete, and genuinely contained this programme.
 *
 * A fabricated (run, programme) pair would not look wrong afterwards. It would
 * look exactly like a selection, and every later question about what Thriv3
 * believed when a programme was pursued would be answered from it.
 * =============================================================================
 */
import {
  describe, it, expect, beforeAll, afterAll, beforeEach,
} from 'vitest';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import { seedPool } from './seedTestPool.js';
import {
  computeMatchmakingV2, clearContextCache, STATUS,
} from './matchmakingService.js';
import { TOP_N } from '../../../shared/matching/v2/pursuitRules.js';
import { persistRun, currentRun, runStaleness } from './matchmakingRuns.js';
import { clearCorpusDigestCache } from './corpusIdentity.js';
import {
  lookupProgramme, resolveRun, topSelectionCandidates, recordSelection,
  selectionsFor, selectionsForRun, SELECTION_SOURCE,
} from './matchmakingSelection.js';
import { UNIVERSE } from './validationUniverse.js';

const created = [];
let player;
let runRow;
let result;

function athlete(extra = {}) {
  const row = Player.create({
    full_name: `A9.5 ${created.length}`,
    sport: 'mens-soccer',
    position: 'Midfielder',
    football_ability: 6,
    recruiting_class_year: 2028,
    state: 'CA',
    origin: 'USA',
    contribution_state: 'STATED',
    max_annual_contribution_usd: 25000,
    ...extra,
  });
  created.push(row.id);
  return Player.get(row.id);
}

beforeAll(() => {
  seedPool('mens-soccer', { count: 140, unscoreable: 6 });
  seedPool('womens-soccer');
  clearContextCache();
  clearCorpusDigestCache();
  player = athlete();
  result = computeMatchmakingV2(db, player);
  persistRun(db, player, result);
  runRow = currentRun(db, player.id);
});

afterAll(() => { for (const id of created) db.prepare('DELETE FROM players WHERE id = ?').run(id); });

beforeEach(() => {
  db.prepare('DELETE FROM matchmaking_selections WHERE player_id = ?').run(player.id);
});

const byStatus = (status) => result.programmes.filter((p) => p.status === status);
const ranked = (rank) => result.programmes.find((p) => p.status === STATUS.RANKED && p.rank === rank);

/* ------------------------------------------------------------------ */
/* The universe is searchable, end to end                             */
/* ------------------------------------------------------------------ */

describe('A9.5 §V. Specific Search reads the persisted universe', () => {
  it('S0. the fixture pool actually contains every state this phase must handle', () => {
    /**
     * Asserted before anything is tested against it. A suite that "covered"
     * LIMITED_DATA against a pool containing none of it would pass while
     * proving nothing - the A8.0B lesson, applied to a fixture.
     */
    expect(byStatus(STATUS.RANKED).length).toBeGreaterThan(TOP_N);
    expect(byStatus(STATUS.SUPPORTED_LIMITED_DATA).length).toBeGreaterThan(0);
    expect(result.programmes.some((p) => p.rank > TOP_N)).toBe(true);
  });

  it('S1. a Top 25 programme reports its exact persisted rank and band', () => {
    const target = ranked(7);
    const found = lookupProgramme(db, player, { collegeName: target.name });

    expect(found.programme.rank).toBe(7);
    expect(found.programme.band).toBe('PRIORITY_OUTREACH');
    expect(found.programme.status).toBe(STATUS.RANKED);
    /** The same numbers the run holds, not a recomputation that agrees. */
    expect(found.programme.pursuit).toBe(target.pursuit);
    expect(found.runId).toBe(runRow.id);
  });

  it('S2. a Top 100 boundary programme is found with its band', () => {
    const target = ranked(TOP_N);
    const found = lookupProgramme(db, player, { collegeName: target.name });
    expect(found.programme.rank).toBe(TOP_N);
    expect(found.programme.band).toBe('VIABLE_CONSIDERATION');
  });

  it('S3. #101+ is findable, with a real rank and a denominator', () => {
    /**
     * THE WHOLE POINT OF §H. "#101 of 824" is a position in a population;
     * "not in the Top 100" is a different and much weaker statement that reads
     * as a rejection.
     */
    const target = ranked(TOP_N + 1);
    const found = lookupProgramme(db, player, { collegeName: target.name });

    expect(found.programme.rank).toBe(TOP_N + 1);
    expect(found.programme.band).toBe('BROADER_UNIVERSE');
    expect(found.rankedCount).toBeGreaterThan(TOP_N);
    expect(found.poolSize).toBeGreaterThanOrEqual(found.rankedCount);
  });

  it('S4. a SUPPORTED_LIMITED_DATA programme is findable and carries no rank', () => {
    const target = byStatus(STATUS.SUPPORTED_LIMITED_DATA)[0];
    const found = lookupProgramme(db, player, { collegeName: target.name });

    expect(found.programme.status).toBe(STATUS.SUPPORTED_LIMITED_DATA);
    expect(found.programme.rank).toBeUndefined();
    expect(found.programme.band).toBeUndefined();
    /** And it says which layers are missing, so the gap is inspectable. */
    expect(found.programme.missingLayers.length).toBeGreaterThan(0);
  });

  it('S5. a programme outside this athlete’s pool is a real answer, not an error', () => {
    const found = lookupProgramme(db, player, { collegeName: 'Seed W0', sport: 'womens-soccer' });
    expect(found.programme).toBeNull();
    expect(found.runId).toBe(runRow.id);
  });

  it('S6. the lookup writes nothing and creates no run', () => {
    const runs = db.prepare('SELECT COUNT(*) c FROM matchmaking_runs').get().c;
    const rows = db.prepare('SELECT COUNT(*) c FROM matchmaking_programme_results').get().c;

    for (let i = 1; i <= 15; i += 1) lookupProgramme(db, player, { collegeName: ranked(i).name });

    expect(db.prepare('SELECT COUNT(*) c FROM matchmaking_runs').get().c).toBe(runs);
    expect(db.prepare('SELECT COUNT(*) c FROM matchmaking_programme_results').get().c).toBe(rows);
  });

  it('S7. no run means NO RUN — it never scores a single programme', () => {
    const fresh = athlete();
    expect(() => lookupProgramme(db, fresh, { collegeName: ranked(1).name }))
      .toThrow(/no matchmaking run/i);
    try {
      lookupProgramme(db, fresh, { collegeName: ranked(1).name });
    } catch (err) {
      expect(err.code).toBe('RUN_NOT_FOUND');
    }
    expect(db.prepare('SELECT COUNT(*) c FROM matchmaking_runs WHERE player_id = ?').get(fresh.id).c)
      .toBe(0);
  });

  it('S8. a STALE run is still inspectable, and says it is stale', () => {
    const subject = athlete({ intended_major: 'business' });
    persistRun(db, subject, computeMatchmakingV2(db, subject));
    const row = currentRun(db, subject.id);
    expect(runStaleness(db, subject, row).current).toBe(true);

    Player.update(subject.id, { competitive_level_priority: 5 });
    const moved = Player.get(subject.id);

    const found = lookupProgramme(db, moved, { collegeName: ranked(1).name });
    /** The historical answer is returned, qualified — never recomputed away. */
    expect(found.programme).toBeTruthy();
    expect(found.staleness.current).toBe(false);
    expect(found.staleness.reasons).toContain('PLAYER_INPUT_CHANGED');
    expect(found.runId).toBe(row.id);
    /** And searching did not create a replacement. */
    expect(db.prepare('SELECT COUNT(*) c FROM matchmaking_runs WHERE player_id = ?').get(subject.id).c)
      .toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Top 100 candidates — §L                                            */
/* ------------------------------------------------------------------ */

describe('A9.5 §L. the Top 100 selection list comes from the run', () => {
  it('L1. exactly the first 100 ranked programmes, in rank order', () => {
    const top = topSelectionCandidates(db, runRow);
    expect(top).toHaveLength(TOP_N);
    expect(top.map((p) => p.rank)).toEqual(Array.from({ length: TOP_N }, (_, i) => i + 1));
    expect(top[0].college_name).toBe(ranked(1).name);
  });

  it('L2. no LIMITED_DATA and no unsupported can appear in it', () => {
    const top = topSelectionCandidates(db, runRow);
    expect(top.every((p) => p.status === STATUS.RANKED)).toBe(true);
    expect(top.every((p) => Number.isFinite(p.rank) && p.rank <= TOP_N)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Provenance — §I, §J, §K, §M, §Q                                    */
/* ------------------------------------------------------------------ */

describe('A9.5 §W. outreach provenance', () => {
  it('W1. a Top 100 selection keeps the run id, the rank and the band', () => {
    const target = ranked(3);
    const out = recordSelection(db, player, {
      collegeName: target.name, source: SELECTION_SOURCE.TOP_100,
    });
    expect(out.runId).toBe(runRow.id);

    const [row] = selectionsFor(db, player.id);
    expect(row.matchmaking_run_id).toBe(runRow.id);
    expect(row.college_name).toBe(target.name);
    expect(row.status).toBe(STATUS.RANKED);
    expect(row.rank).toBe(3);
    expect(row.band).toBe('PRIORITY_OUTREACH');
    expect(row.source).toBe('TOP_100');
    expect(row.run_was_stale).toBe(0);
  });

  it('W2. a #101+ selection is allowed and keeps its real rank', () => {
    const target = ranked(TOP_N + 1);
    recordSelection(db, player, {
      collegeName: target.name, source: SELECTION_SOURCE.SPECIFIC_SEARCH,
    });
    const [row] = selectionsFor(db, player.id);
    expect(row.rank).toBe(TOP_N + 1);
    expect(row.band).toBe('BROADER_UNIVERSE');
    expect(row.status).toBe(STATUS.RANKED);
  });

  it('W3. a LIMITED_DATA selection keeps its STATUS and gets NO invented rank — §M', () => {
    /**
     * The failure this forbids: making the row look ranked so downstream code
     * accepts it. A fabricated rank would be indistinguishable from a real one
     * and would pollute every later comparison between ranked and requested
     * schools.
     */
    const target = byStatus(STATUS.SUPPORTED_LIMITED_DATA)[0];
    recordSelection(db, player, {
      collegeName: target.name, source: SELECTION_SOURCE.SPECIFIC_SEARCH,
    });
    const [row] = selectionsFor(db, player.id);

    expect(row.status).toBe(STATUS.SUPPORTED_LIMITED_DATA);
    expect(row.rank).toBeNull();
    expect(row.band).toBeNull();
    expect(row.pursuit).toBeNull();
    /** Explicitly not zero, which would read as "ranked last". */
    expect(row.rank).not.toBe(0);
    expect(row.pursuit).not.toBe(0);
  });

  it('W4. a selection labelled TOP_100 that is not in the Top 100 is REFUSED', () => {
    const target = ranked(TOP_N + 1);
    expect(() => recordSelection(db, player, {
      collegeName: target.name, source: SELECTION_SOURCE.TOP_100,
    })).toThrow(/not in the Top/i);
    expect(selectionsFor(db, player.id)).toHaveLength(0);
  });

  it('W5. a programme that was never in the run is REFUSED — §K', () => {
    expect(() => recordSelection(db, player, { collegeName: 'Seed W0', sport: 'womens-soccer' }))
      .toThrow(/not a programme in that matchmaking run/i);
    expect(() => recordSelection(db, player, { collegeName: 'Nowhere University' }))
      .toThrow(/not a programme in that matchmaking run/i);
    expect(selectionsFor(db, player.id)).toHaveLength(0);
  });

  it('W6. another athlete’s run is REFUSED — §K', () => {
    const other = athlete();
    persistRun(db, other, computeMatchmakingV2(db, other));
    const otherRun = currentRun(db, other.id);

    expect(() => recordSelection(db, player, {
      collegeName: ranked(1).name, runId: otherRun.id,
    })).toThrow(/different athlete/i);
    expect(() => resolveRun(db, player, { runId: otherRun.id })).toThrow(/different athlete/i);
    expect(selectionsFor(db, player.id)).toHaveLength(0);
  });

  it('W7. an unknown run id is REFUSED rather than silently using the current one', () => {
    expect(() => recordSelection(db, player, {
      collegeName: ranked(1).name, runId: 'no-such-run',
    })).toThrow(/no matchmaking run/i);
    expect(selectionsFor(db, player.id)).toHaveLength(0);
  });

  it('W8. the identity written is the RUN’S spelling, not the caller’s', () => {
    /**
     * `programmeResult` resolves on the exact stored name, so a caller cannot
     * introduce a variant spelling — the row copied in is the run's own. This
     * is what keeps `matchmaking_selections` joinable back to the result set.
     */
    const target = ranked(5);
    recordSelection(db, player, { collegeName: target.name });
    const [row] = selectionsFor(db, player.id);
    expect(row.college_name).toBe(target.name);

    const inRun = db.prepare(`SELECT 1 FROM matchmaking_programme_results
       WHERE run_id = ? AND college_name = ? AND sport = ?`).get(row.matchmaking_run_id, row.college_name, row.sport);
    expect(inRun).toBeTruthy();
  });

  it('W9. selecting from a STALE run keeps THAT run’s id and records that it was stale — §Q', () => {
    const subject = athlete({ intended_major: 'business' });
    persistRun(db, subject, computeMatchmakingV2(db, subject));
    const firstRun = currentRun(db, subject.id);

    Player.update(subject.id, { competitive_level_priority: 1 });
    let moved = Player.get(subject.id);

    recordSelection(db, moved, { collegeName: ranked(2).name, runId: firstRun.id });
    const [stale] = selectionsFor(db, subject.id);
    expect(stale.matchmaking_run_id).toBe(firstRun.id);
    expect(stale.run_was_stale).toBe(1);

    /** A NEWER run arrives, and the historical selection is NOT relinked. */
    persistRun(db, moved, computeMatchmakingV2(db, moved));
    const secondRun = currentRun(db, subject.id);
    expect(secondRun.id).not.toBe(firstRun.id);

    const after = selectionsFor(db, subject.id);
    expect(after).toHaveLength(1);
    expect(after[0].matchmaking_run_id).toBe(firstRun.id);
    expect(after[0].run_was_stale).toBe(1);
  });

  it('W10. the same programme selected from two runs is TWO rows, not an overwrite — §R', () => {
    const subject = athlete();
    persistRun(db, subject, computeMatchmakingV2(db, subject));
    const first = currentRun(db, subject.id);
    const name = ranked(4).name;
    recordSelection(db, subject, { collegeName: name, runId: first.id });

    Player.update(subject.id, { playing_opportunity_priority: 5 });
    const moved = Player.get(subject.id);
    persistRun(db, moved, computeMatchmakingV2(db, moved));
    const second = currentRun(db, moved.id);
    recordSelection(db, moved, { collegeName: name, runId: second.id });

    const rows = selectionsForRun(db, first.id).concat(selectionsForRun(db, second.id));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.matchmaking_run_id)).size).toBe(2);
    /** Append-only: the first row still says what it said. */
    expect(selectionsForRun(db, first.id)[0].matchmaking_run_id).toBe(first.id);
  });

  it('W11. a run with selections against it cannot be deleted out from under them', () => {
    recordSelection(db, player, { collegeName: ranked(1).name });
    expect(() => db.prepare('DELETE FROM matchmaking_runs WHERE id = ?').run(runRow.id)).toThrow();
    expect(selectionsFor(db, player.id)).toHaveLength(1);
  });

  it('W12. an unknown source is refused rather than stored as free text', () => {
    expect(() => recordSelection(db, player, {
      collegeName: ranked(1).name, source: 'SOMEWHERE_ELSE',
    })).toThrow(/Unknown selection source/i);
    expect(selectionsFor(db, player.id)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* V1 coexistence — §S                                                */
/* ------------------------------------------------------------------ */

describe('A9.5 §S. V1 coexistence', () => {
  it('S9. campaign tables are untouched by any of this', () => {
    recordSelection(db, player, { collegeName: ranked(1).name });
    /**
     * `programme_campaigns` deliberately has NO matchmaking_run_id column.
     * `createCampaign` reads `players.recommendations` - the V1 analysis file -
     * so a column there would have no writer, which is schema that reads as a
     * promise the code does not keep.
     */
    const cols = db.prepare('PRAGMA table_info(programme_campaigns)').all().map((c) => c.name);
    expect(cols).not.toContain('matchmaking_run_id');
  });

  it('S10. a V1 relationship needs no run id and is unaffected', () => {
    const before = db.prepare('SELECT COUNT(*) c FROM athlete_programmes').get().c;
    recordSelection(db, player, { collegeName: ranked(1).name });
    /** Provenance is its own ledger; it writes nothing to the relationship. */
    expect(db.prepare('SELECT COUNT(*) c FROM athlete_programmes').get().c).toBe(before);
    const cols = db.prepare('PRAGMA table_info(athlete_programmes)').all().map((c) => c.name);
    expect(cols).not.toContain('matchmaking_run_id');
  });
});
