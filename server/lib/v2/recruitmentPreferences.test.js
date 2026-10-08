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

describe('a school with no state on file', () => {
  it('stays ranked, is neither rewarded nor penalised, and reads UNKNOWN on its card', () => {
    const id = db.prepare("SELECT id FROM colleges WHERE sport = 'mens-soccer' AND active = 1 ORDER BY id LIMIT 1").pluck().get();
    const was = db.prepare('SELECT state FROM colleges WHERE id = ?').pluck().get(id);
    db.prepare('UPDATE colleges SET state = NULL WHERE id = ?').run(id);
    clearContextCache(); clearCorpusDigestCache();
    try {
      const none = computeMatchmakingV2(db, athlete(), { withExplanations: true });
      const west = computeMatchmakingV2(db, athlete({ preferred_regions: ['WEST'] }), { withExplanations: true });
      const a = none.programmes.find((p) => p.programmeId === id);
      const b = west.programmes.find((p) => p.programmeId === id);
      expect(b.status).toBe(a.status);
      expect(b.opportunity.value).toBe(a.opportunity.value);
      expect(b.opportunity.coverage).toBeLessThan(a.opportunity.coverage);
      expect(b.explanation.preferenceChecks).toEqual([expect.objectContaining({ check: 'LOCATION', status: 'UNKNOWN', actual: null })]);
    } finally {
      db.prepare('UPDATE colleges SET state = ? WHERE id = ?').run(was, id);
      clearContextCache(); clearCorpusDigestCache();
    }
  });
});

describe('legacy position values', () => {
  const legacy = (position, secondary) => {
    const id = `legacy-${created.length}-${Date.now()}`;
    db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, secondary_position, sport)
      VALUES (?, 'x', 'x', 'Legacy', ?, ?, 'mens-soccer')`).run(id, position, secondary);
    created.push(id);
    return id;
  };

  it('reads an unsupported stored value back as written', () => {
    const id = legacy('Attacking Midfielder', 'Left Winger');
    expect(Player.get(id).position).toBe('Attacking Midfielder');
    expect(Player.get(id).secondary_position).toBe('Left Winger');
  });

  it('an edit that does not touch positions saves and leaves them exactly as stored', () => {
    const id = legacy('Left Winger', 'Attacking Midfielder');
    Player.update(id, { evaluation: 'Updated note', preferred_regions: ['SOUTH'] });
    const back = Player.get(id);
    expect([back.position, back.secondary_position, back.evaluation]).toEqual(['Left Winger', 'Attacking Midfielder', 'Updated note']);
  });

  it('a save that writes the unsupported value again is refused, and changes nothing', () => {
    const id = legacy('Defense', 'Attacking Midfielder');
    expect(() => Player.update(id, { secondary_position: 'Attacking Midfielder', evaluation: 'x' })).toThrow(/secondary_position/);
    expect(Player.get(id).evaluation ?? null).toBeNull();
    // Legacy coarse spellings are valid and still accepted as written.
    Player.update(id, { position: 'Defense', secondary_position: 'None' });
    expect(Player.get(id).position).toBe('Defense');
  });
});

describe('conference preferences (Phase 3): advisory only in V2', () => {
  it('changing them leaves the V2 ranking byte-identical and updates each card\'s check', () => {
    const none = computeMatchmakingV2(db, athlete(), { withExplanations: true });
    const conf0 = computeMatchmakingV2(db, athlete({ preferred_conferences: ['Conf 0'] }), { withExplanations: true });
    const conf1 = computeMatchmakingV2(db, athlete({ preferred_conferences: ['Conf 1', 'Conf 2'] }), { withExplanations: true });
    expect(resultDigest(conf0)).toBe(resultDigest(none));
    expect(resultDigest(conf1)).toBe(resultDigest(none));

    const colleges = new Map(db.prepare("SELECT id, conference FROM colleges WHERE sport = 'mens-soccer'").all().map((c) => [c.id, c.conference]));
    const checkOf = (result, id) => result.programmes.find((p) => p.programmeId === id).explanation.preferenceChecks.find((c) => c.check === 'CONFERENCE');
    for (const p of ranked(conf0).slice(0, 15)) {
      expect(checkOf(conf0, p.programmeId).status).toBe(colleges.get(p.programmeId) === 'Conf 0' ? 'INSIDE' : 'OUTSIDE');
      expect(checkOf(conf1, p.programmeId).status).toBe(['Conf 1', 'Conf 2'].includes(colleges.get(p.programmeId)) ? 'INSIDE' : 'OUTSIDE');
      expect(checkOf(conf0, p.programmeId).ranked).toBe(false);
    }
    // Stated nothing: no conference check at all.
    expect(ranked(none)[0].explanation.preferenceChecks.some((c) => c.check === 'CONFERENCE')).toBe(false);
  });
});
