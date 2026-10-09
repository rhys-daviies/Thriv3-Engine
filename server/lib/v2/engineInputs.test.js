/**
 * EACH ENGINE IS INVALIDATED BY ITS OWN INPUTS — Phase 5 PR B, check 1.
 *
 * The previous engine (V1) and Matcher V2 read different athlete fields. A
 * profile save must clear the stored V1 analysis only when a field V1 reads
 * changed, and must mark a V2 run outdated only when a field V2 reads changed.
 * Assuming one list for both clears V1 data on V2-only edits (and would miss
 * V1-only ones).
 *
 *   - The V1 list is pinned to what `normaliseAthlete` actually READS (a Proxy
 *     records every property access), so it cannot drift from the engine.
 *   - The V2 list is pinned to what a persisted run snapshots.
 *   - Representative-only, V2-only, V1-only and shared edits are each run
 *     through the real V2 staleness check and the real V1 rule.
 */
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import { seedPool } from './seedTestPool.js';
import { computeMatchmakingV2, clearContextCache } from './matchmakingService.js';
import { persistRun, currentRun, runStaleness, runById, INPUT_FIELDS } from './matchmakingRuns.js';
import { clearCorpusDigestCache } from './corpusIdentity.js';
import { normaliseAthlete } from '../../../shared/matching/pool.js';
import { CONTRIBUTION_STATE } from '../../../shared/matching/v2/financialRules.js';
import {
  PREVIOUS_ENGINE_INPUT_FIELDS, PREVIOUS_ENGINE_CARRIED_ONLY, MATCHER_V2_INPUT_FIELDS,
  changedPreviousEngineInputs, changedMatcherV2Inputs,
} from '../../../shared/matchingInputFields.js';

const created = [];
function athlete(extra = {}) {
  const row = Player.create({
    full_name: `Inputs ${created.length}`, sport: 'mens-soccer', position: 'CB', football_ability: 6,
    recruiting_class_year: 2028, state: 'CA', origin: 'USA', contribution_state: CONTRIBUTION_STATE.STATED,
    max_annual_contribution_usd: 25000, preferred_divisions: ['NCAA D1'], ...extra,
  });
  created.push(row.id);
  return Player.get(row.id);
}

beforeAll(() => { seedPool('mens-soccer'); clearContextCache(); clearCorpusDigestCache(); });
afterAll(() => { for (const id of created) db.prepare('DELETE FROM players WHERE id = ?').run(id); });

describe('the two lists are each pinned to their own engine', () => {
  it('V1: exactly the fields normaliseAthlete reads (plus the two it carries for V2 and never scores)', () => {
    const read = new Set();
    normaliseAthlete(new Proxy({}, { get: (_, k) => { if (typeof k === 'string') read.add(k); return undefined; } }));
    expect([...read].sort()).toEqual([...PREVIOUS_ENGINE_INPUT_FIELDS, ...PREVIOUS_ENGINE_CARRIED_ONLY].sort());
  });

  it('V2: exactly the fields a run snapshots for staleness', () => {
    expect([...MATCHER_V2_INPUT_FIELDS].sort()).toEqual([...INPUT_FIELDS].sort());
  });

  it('they genuinely differ, in both directions', () => {
    expect(PREVIOUS_ENGINE_INPUT_FIELDS).toContain('match_weights');
    expect(MATCHER_V2_INPUT_FIELDS).not.toContain('match_weights');
    for (const f of ['intended_major', 'recruit_type', 'competitive_level_priority', 'preferred_states', 'preferred_institution_types']) {
      expect(MATCHER_V2_INPUT_FIELDS).toContain(f);
      expect(PREVIOUS_ENGINE_INPUT_FIELDS).not.toContain(f);
    }
  });
});

describe('each edit invalidates exactly the engine that reads it', () => {
  /** Persist a V2 run, apply an edit, and ask both engines' rules what it did. */
  function afterEdit(edit) {
    const p = athlete();
    persistRun(db, p, computeMatchmakingV2(db, p));
    const run = currentRun(db, p.id);
    Player.update(p.id, edit);
    const now = Player.get(p.id);
    return {
      v2Current: runStaleness(db, now, run).current,
      v1Changed: changedPreviousEngineInputs(p, { ...p, ...edit }),
      v2Changed: changedMatcherV2Inputs(p, { ...p, ...edit }),
      snapshot: JSON.parse(runById(db, run.id).input_snapshot),
    };
  }

  it('representative-only (and bio/contact): neither engine is invalidated', () => {
    const r = afterEdit({ representative_id: null, evaluation: 'Strong in the air', club_coach_name: 'Pat' });
    expect(r).toMatchObject({ v2Current: true, v1Changed: [], v2Changed: [] });
  });

  it('a V2-only input (intended major, a priority, a preferred state): V2 run outdated, V1 analysis kept', () => {
    for (const edit of [{ intended_major: 'Business' }, { competitive_level_priority: 4 }, { preferred_states: ['NY'] }]) {
      const r = afterEdit(edit);
      expect(r.v2Current).toBe(false);
      expect(r.v1Changed).toEqual([]);
    }
  });

  it('a V1-only input (criterion weights): V1 analysis cleared, V2 run still current', () => {
    const r = afterEdit({ match_weights: JSON.stringify({ academic: 0.5 }) });
    expect(r.v2Current).toBe(true);
    expect(r.v1Changed).toEqual(['match_weights']);
  });

  it('a shared input (position, division, GPA): both invalidated', () => {
    for (const edit of [{ position: 'ST' }, { preferred_divisions: ['NCAA D2'] }, { gpa: 3.9 }]) {
      const r = afterEdit(edit);
      expect(r.v2Current).toBe(false);
      expect(r.v1Changed.length).toBe(1);
    }
  });

  it('a contribution change: V2 run outdated (Financial reads it), V1 kept (it never scores it)', () => {
    const r = afterEdit({ max_annual_contribution_usd: 40000 });
    expect(r.v2Current).toBe(false);
    expect(r.v1Changed).toEqual([]);
  });
});
