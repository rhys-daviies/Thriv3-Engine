/**
 * =============================================================================
 * DETAILED POSITIONS AND RECRUITMENT PREFERENCES, FROM SAVE TO RANKING.
 *
 * What this feature is allowed to change, and what it is not:
 *
 *   - A detailed position (CB rather than Defender) and a secondary position
 *     change NOTHING about a ranking. The engine reads the group.
 *   - An athlete who states no location ranks exactly as before. Only a stated
 *     location reaches `locationFit`, and only the Opportunity layer reads it.
 *   - Division, conference, institution type and the academic floor are
 *     CHECKED on each programme and stored with the explanation - never
 *     scored, and missing programme facts read UNKNOWN.
 *   - A run snapshotted before the preferences existed is not reported stale
 *     because they now exist.
 * =============================================================================
 */
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import db from '../../db/client.js';
import { Player } from '../../db/entities/player.js';
import { seedPool } from './seedTestPool.js';
import { computeMatchmakingV2, clearContextCache, resultDigest, STATUS } from './matchmakingService.js';
import {
  persistRun, currentRun, runStaleness, readRun, runById, explanationToStore, STALE_REASON,
} from './matchmakingRuns.js';
import { clearCorpusDigestCache } from './corpusIdentity.js';
import { CONTRIBUTION_STATE } from '../../../shared/matching/v2/financialRules.js';
import { REGIONS } from '../../../shared/recruitmentPreferences.js';

const created = [];

function athlete(extra = {}) {
  const row = Player.create({
    full_name: `Prefs ${created.length}`,
    sport: 'mens-soccer',
    position: 'Defender',
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

const ranked = (result) => result.programmes.filter((p) => p.status === STATUS.RANKED);
const codes = (p) => (p.explanation?.reasons ?? []).map((r) => r.code);

beforeAll(() => {
  seedPool('mens-soccer');
  clearContextCache();
  clearCorpusDigestCache();
});
afterAll(() => { for (const id of created) db.prepare('DELETE FROM players WHERE id = ?').run(id); });

describe('the write boundary', () => {
  it('stores detailed positions and preference lists and reads them back as written', () => {
    const p = athlete({
      position: 'CB', secondary_position: 'DM',
      preferred_states: ['tx'], preferred_regions: ['NORTHEAST'], preferred_institution_types: ['PUBLIC'],
    });
    expect(p.position).toBe('CB');
    expect(p.secondary_position).toBe('DM');
    expect(p.preferred_states).toEqual(['tx']);
    expect(p.preferred_regions).toEqual(['NORTHEAST']);
    expect(p.preferred_institution_types).toEqual(['PUBLIC']);

    Player.update(p.id, { preferred_states: null, preferred_regions: [], secondary_position: 'None' });
    const back = Player.get(p.id);
    expect(back.preferred_states).toEqual([]);
    expect(back.preferred_regions).toEqual([]);
    expect(back.preferred_institution_types).toEqual(['PUBLIC']);
    expect(back.secondary_position).toBe('None');
  });

  it('refuses a position the matcher cannot place, rather than ranking the athlete without one', () => {
    expect(() => athlete({ position: 'Left Winger' })).toThrow(/not a position the matcher can place/);
    const p = athlete();
    expect(() => Player.update(p.id, { secondary_position: 'Sweeper-keeper' })).toThrow(/secondary_position/);
    expect(Player.get(p.id).secondary_position).toBe('None');
  });

  it('refuses an unknown state, region or institution type and writes nothing', () => {
    const p = athlete();
    expect(() => Player.update(p.id, { preferred_states: ['TX', 'ZZ'] })).toThrow(/unknown state code: ZZ/);
    expect(() => Player.update(p.id, { preferred_regions: ['PACIFIC'] })).toThrow(/unknown region/);
    expect(() => Player.update(p.id, { preferred_institution_types: ['ONLINE'] })).toThrow(/institution type/);
    expect(Player.get(p.id).preferred_states ?? []).toEqual([]);
  });
});

describe('positions do not move a ranking', () => {
  it('a detailed primary position ranks exactly as its group', () => {
    const coarse = computeMatchmakingV2(db, athlete({ position: 'Defender' }));
    const detailed = computeMatchmakingV2(db, athlete({ position: 'CB' }));
    expect(ranked(detailed).length).toBeGreaterThan(0);
    expect(resultDigest(detailed)).toBe(resultDigest(coarse));
  });

  it('a secondary position is not read by the matcher', () => {
    const none = computeMatchmakingV2(db, athlete({ position: 'CB' }));
    const withSecondary = computeMatchmakingV2(db, athlete({ position: 'CB', secondary_position: 'DM' }));
    expect(resultDigest(withSecondary)).toBe(resultDigest(none));
  });
});

describe('location preference reaches the matcher, and only when stated', () => {
  it('an athlete who stated nothing ranks exactly as an empty answer, and is told location was not collected', () => {
    const absent = computeMatchmakingV2(db, athlete(), { withExplanations: true });
    const empty = computeMatchmakingV2(db, athlete({ preferred_states: [], preferred_regions: [] }), { withExplanations: true });
    expect(resultDigest(empty)).toBe(resultDigest(absent));
    for (const p of ranked(absent)) expect(codes(p)).toContain('LOCATION_NOT_COLLECTED');
  });

  it('a stated region is scored by locationFit, moving Opportunity and nothing else', () => {
    const none = computeMatchmakingV2(db, athlete(), { withExplanations: true });
    const ne = computeMatchmakingV2(db, athlete({ preferred_regions: ['NORTHEAST'] }), { withExplanations: true });

    for (const p of ranked(ne)) expect(codes(p)).not.toContain('LOCATION_NOT_COLLECTED');

    const byId = (r) => new Map(r.programmes.map((p) => [p.programmeId, p]));
    const a = byId(none); const b = byId(ne);
    let opportunityMoved = 0;
    for (const [id, p] of b) {
      const q = a.get(id);
      expect(p.recruitability, id).toEqual(q.recruitability);
      expect(p.financial, id).toEqual(q.financial);
      if (JSON.stringify(p.opportunity) !== JSON.stringify(q.opportunity)) opportunityMoved += 1;
    }
    expect(opportunityMoved).toBeGreaterThan(0);
  });

  it('a region and its states are the same answer', () => {
    const region = computeMatchmakingV2(db, athlete({ preferred_regions: ['NORTHEAST'] }));
    const states = computeMatchmakingV2(db, athlete({ preferred_states: [...REGIONS.NORTHEAST.states] }));
    expect(resultDigest(states)).toBe(resultDigest(region));
  });
});

describe('preference checks on each programme', () => {
  it('reports only what was stated, against the programme on file, and is stored with the explanation', () => {
    const p = athlete({
      preferred_divisions: ['NCAA D1'], preferred_regions: ['NORTHEAST'], preferred_institution_types: ['PUBLIC'],
    });
    const result = computeMatchmakingV2(db, p, { withExplanations: true });
    const colleges = new Map(db.prepare("SELECT * FROM colleges WHERE sport = 'mens-soccer'").all().map((c) => [c.id, c]));

    const top = ranked(result).slice(0, 20);
    expect(top.length).toBeGreaterThan(0);
    for (const prog of top) {
      const c = colleges.get(prog.programmeId);
      const checks = Object.fromEntries(prog.explanation.preferenceChecks.map((k) => [k.check, k]));
      expect(Object.keys(checks).sort()).toEqual(['DIVISION', 'INSTITUTION_TYPE', 'LOCATION']);
      expect(checks.DIVISION.status).toBe(c.division === 'NCAA D1' ? 'INSIDE' : 'OUTSIDE');
      expect(checks.LOCATION.status).toBe(c.state === 'MA' ? 'INSIDE' : 'OUTSIDE');
      expect(checks.LOCATION.ranked).toBe(true);
      expect(checks.INSTITUTION_TYPE.status).toBe(c.control === 1 ? 'INSIDE' : 'OUTSIDE');
      expect(checks.DIVISION.ranked).toBe(false);
    }

    const stored = JSON.parse(explanationToStore(top[0]));
    expect(stored.preferenceChecks).toEqual(top[0].explanation.preferenceChecks);
  });

  it('checks do not filter: a stated division leaves the ranked list exactly as without it', () => {
    const without = computeMatchmakingV2(db, athlete());
    const withDivision = computeMatchmakingV2(db, athlete({ preferred_divisions: ['NCAA D1'] }));
    expect(resultDigest(withDivision)).toBe(resultDigest(without));
  });
});

describe('staleness across the input-schema change', () => {
  it('a run recorded before the preferences existed is still current when nothing it read has changed', () => {
    const p = athlete({ preferred_divisions: ['NCAA D2'] });
    const runId = persistRun(db, p, computeMatchmakingV2(db, p));
    // What a pre-existing run looks like: schema 1, no preference fields in its snapshot.
    const snap = JSON.parse(runById(db, runId).input_snapshot);
    for (const f of ['preferred_states', 'preferred_regions', 'preferred_divisions', 'preferred_conferences', 'preferred_institution_types']) delete snap[f];
    db.prepare('UPDATE matchmaking_runs SET input_schema_version = 1, input_snapshot = ? WHERE id = ?').run(JSON.stringify(snap), runId);

    expect(runStaleness(db, p, currentRun(db, p.id)).current).toBe(true);
  });

  it('reordering a list is not a change; adding to it is', () => {
    const p = athlete({ preferred_regions: ['WEST', 'SOUTH'] });
    persistRun(db, p, computeMatchmakingV2(db, p));
    const row = currentRun(db, p.id);

    Player.update(p.id, { preferred_regions: ['SOUTH', 'WEST'] });
    expect(runStaleness(db, Player.get(p.id), row).current).toBe(true);

    Player.update(p.id, { preferred_states: ['NY'] });
    const s = runStaleness(db, Player.get(p.id), row);
    expect(s.current).toBe(false);
    expect(s.reasons).toContain(STALE_REASON.PLAYER_INPUT_CHANGED);
  });

  it('the stored snapshot carries the preferences, sorted, for the history', () => {
    const p = athlete({ preferred_states: ['TX', 'CA'], position: 'ST' });
    const runId = persistRun(db, p, computeMatchmakingV2(db, p));
    const snap = readRun(db, runById(db, runId)).inputSnapshot;
    expect(snap.preferred_states).toEqual(['CA', 'TX']);
    expect(snap.position).toBe('ST');
    expect(snap.preferred_regions).toBeNull();
  });
});
