import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { createCampaign, MAX_RANK, TIER_BANDS, tierForRank } from './campaigns.js';
import { UPLOADS_DIR } from './uploadPath.js';
import { TOP_RANKS, RESERVE_RANKS } from '../../shared/matching/reserve.js';

/**
 * THE RESERVE STOPS AT THE CAMPAIGN BOUNDARY.
 *
 * An analysis blob now carries a second array. A campaign must not notice.
 * `tierForRank` has no band above 100, so a reserve programme frozen into a
 * campaign would need a tier no rule chose — which is the exact thing
 * MAX_PROGRAMMES exists to refuse.
 *
 * These tests exist because the cheap way to build the reserve would have been
 * to widen `recommendations` to 150, and that would have broken campaign
 * creation outright rather than quietly. The sibling-key design is what makes
 * the reserve invisible here, and "invisible" is a property, not a hope.
 */

const ATHLETE = 'a-reserve';
const written = [];

afterAll(() => {
  for (const f of written) if (fs.existsSync(f)) fs.unlinkSync(f);
});

function rec(n) {
  return {
    id: `col-${n}`,
    name: `School ${n}`,
    division: 'NCAA D1',
    conference: 'ACC',
    match_score: Math.max(1, 200 - n),
    breakdown: [
      { key: 'athletic', score: 0.9 }, { key: 'roster', score: 0.5 },
      { key: 'academic', score: 0.5 }, { key: 'affordability', score: 0.5 },
      { key: 'programQuality', score: 0.6 }, { key: 'geography', score: 0.7 },
    ],
    labels: { athletic: 'target' },
    confidence: 'measured',
  };
}

/** Writes an analysis blob in the shape `analyze()` now produces. */
function giveAnalysis(athleteId, { top = 100, reserve = 50, includeReserveKey = true } = {}) {
  const name = `${randomUUID()}-recommendations.json`;
  const file = path.join(UPLOADS_DIR, name);
  const blob = {
    recommendations: Array.from({ length: top }, (_, i) => rec(i + 1)),
    summary: 'Ranked 1166 eligible programs on six weighted criteria.',
  };
  if (includeReserveKey) {
    blob.reserve = Array.from({ length: reserve }, (_, i) => rec(TOP_RANKS + i + 1));
  }
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(blob));
  written.push(file);
  db.prepare('UPDATE players SET recommendations = ? WHERE id = ?').run(`/uploads/${name}`, athleteId);
  return `/uploads/${name}`;
}

beforeEach(() => {
  db.exec('DELETE FROM programme_campaigns; DELETE FROM campaigns; DELETE FROM players;');
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, recruiting_class_year)
    VALUES (?, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', 'Reserve Athlete', 'MIDFIELD',
      'mens-soccer', 2027)
  `).run(ATHLETE);
});

// ---------------------------------------------------------------------------

describe('the campaign cap is untouched', () => {
  it('still tiers at most 100', () => {
    expect(MAX_RANK).toBe(100);
    expect(TOP_RANKS).toBe(100);
  });

  it('still has the same three tier bands', () => {
    expect(TIER_BANDS.map((b) => ({ ...b })))
      .toEqual([
        { tier: 'A', from: 1, to: 20 },
        { tier: 'B', from: 21, to: 50 },
        { tier: 'C', from: 51, to: 100 },
      ]);
    expect(tierForRank(1)).toBe('A');
    expect(tierForRank(20)).toBe('A');
    expect(tierForRank(21)).toBe('B');
    expect(tierForRank(50)).toBe('B');
    expect(tierForRank(51)).toBe('C');
    expect(tierForRank(100)).toBe('C');
    // The reason the reserve can never be handed to a campaign.
    expect(() => tierForRank(101)).toThrowError(/between 1 and 100/);
  });

  it('still refuses a recommendations array longer than 100', () => {
    giveAnalysis(ATHLETE, { top: 101, includeReserveKey: false });
    try {
      createCampaign(ATHLETE, { startsOn: '2026-09-15' });
      throw new Error('should have refused');
    } catch (err) {
      expect(err.code).toBe('ANALYSIS_TOO_LARGE');
    }
  });
});

describe('creating a campaign from an analysis that has a reserve', () => {
  it('freezes the Top 100 and nothing from the reserve', () => {
    giveAnalysis(ATHLETE, { top: 100, reserve: 50 });
    const { campaign, programmes } = createCampaign(ATHLETE, { startsOn: '2026-09-15' });

    expect(programmes).toHaveLength(100);
    expect(campaign.programme_count).toBe(100);
    expect(programmes.at(-1).rank).toBe(100);

    // The specific failure being guarded: not one reserve programme is in the
    // campaign, by name or by rank.
    const names = new Set(programmes.map((p) => p.college_name));
    for (let n = TOP_RANKS + 1; n <= TOP_RANKS + RESERVE_RANKS; n += 1) {
      expect(names.has(`School ${n}`), `School ${n} must not be frozen`).toBe(false);
    }
    expect(Math.max(...programmes.map((p) => p.rank))).toBe(100);
  });

  it('gives every frozen programme a tier a rule actually chose', () => {
    giveAnalysis(ATHLETE, { top: 100, reserve: 50 });
    const { programmes } = createCampaign(ATHLETE, { startsOn: '2026-09-15' });
    for (const p of programmes) expect(p.tier).toBe(tierForRank(p.rank));
  });

  it('reports the count it actually froze, not the size of the blob', () => {
    giveAnalysis(ATHLETE, { top: 60, reserve: 50 });
    const { campaign, programmes } = createCampaign(ATHLETE, { startsOn: '2026-09-15' });
    expect(programmes).toHaveLength(60);
    expect(campaign.programme_count).toBe(60);
  });

  it('records the returned count from the recommendations alone', () => {
    giveAnalysis(ATHLETE, { top: 100, reserve: 50 });
    const { campaign } = createCampaign(ATHLETE, { startsOn: '2026-09-15' });
    const inputs = JSON.parse(campaign.matching_inputs);
    // 100, not 150. The provenance must describe what the campaign holds.
    expect(inputs.analysis.returned).toBe(100);
  });
});

describe('an analysis written before the reserve existed', () => {
  it('still creates a campaign exactly as it did', () => {
    giveAnalysis(ATHLETE, { top: 100, includeReserveKey: false });
    const { campaign, programmes } = createCampaign(ATHLETE, { startsOn: '2026-09-15' });
    expect(programmes).toHaveLength(100);
    expect(campaign.programme_count).toBe(100);
    expect(programmes[0].rank).toBe(1);
    expect(programmes[0].tier).toBe('A');
  });

  it('creates the same campaign with or without the reserve key', () => {
    giveAnalysis(ATHLETE, { top: 40, includeReserveKey: false });
    const without = createCampaign(ATHLETE, { startsOn: '2026-09-15' });
    db.exec('DELETE FROM programme_campaigns; DELETE FROM campaigns;');

    giveAnalysis(ATHLETE, { top: 40, reserve: 50 });
    const with_ = createCampaign(ATHLETE, { startsOn: '2026-09-15' });

    const strip = (p) => ({ rank: p.rank, college_name: p.college_name, tier: p.tier, match_score: p.match_score });
    expect(with_.programmes.map(strip)).toEqual(without.programmes.map(strip));
  });
});
