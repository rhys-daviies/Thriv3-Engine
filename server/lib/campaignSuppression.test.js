import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { createCampaign, MAX_RANK, TIER_BANDS, tierForRank } from './campaigns.js';
import { UPLOADS_DIR } from './uploadPath.js';
import { TOP_RANKS } from '../../shared/matching/reserve.js';

/**
 * WHAT A CAMPAIGN FREEZES WHEN AN OPERATOR HAS TAKEN A SCHOOL OUT.
 *
 * The campaign is where suppression stops being a screen and starts being
 * outreach. Two things have to be true at once and they pull against each
 * other: a suppressed school must not reach a coach's inbox, AND every
 * guarantee a campaign already made must survive — a hundred programmes, three
 * tier bands covering 1..100, no rank without a band, and an analysis blob
 * nothing rewrote to make any of it work.
 */

const ATHLETE = 'a-suppress';
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

function giveAnalysis(athleteId, { top = 100, reserve = 50 } = {}) {
  const name = `${randomUUID()}-recommendations.json`;
  const file = path.join(UPLOADS_DIR, name);
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    recommendations: Array.from({ length: top }, (_, i) => rec(i + 1)),
    reserve: Array.from({ length: reserve }, (_, i) => rec(TOP_RANKS + i + 1)),
    summary: 'Ranked 1166 eligible programs on six weighted criteria.',
  }));
  written.push(file);
  db.prepare('UPDATE players SET recommendations = ? WHERE id = ?').run(`/uploads/${name}`, athleteId);
  return file;
}

/** A relationship row, written directly: this is about what freeze READS. */
function relate(collegeName, fields = {}) {
  db.prepare(`
    INSERT INTO athlete_programmes (
      id, athlete_id, college_name, sport, college_id,
      request_state, flagged, flag_reason, visibility, contact_stance, note,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'mens-soccer', NULL, ?, ?, ?, ?, ?, ?,
      '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z')
  `).run(
    randomUUID(), ATHLETE, collegeName,
    fields.request_state ?? 'none',
    fields.flagged ? 1 : 0,
    fields.flag_reason ?? null,
    fields.visibility ?? 'default',
    fields.contact_stance ?? 'default',
    fields.note ?? null,
  );
}

const suppressSchool = (n) => relate(`School ${n}`, { visibility: 'suppressed' });
const create = () => createCampaign(ATHLETE, { startsOn: '2026-09-15' });
const inputs = (campaign) => JSON.parse(campaign.matching_inputs);

beforeEach(() => {
  db.exec('DELETE FROM programme_campaigns; DELETE FROM campaigns; DELETE FROM athlete_programmes; DELETE FROM suppressions; DELETE FROM players;');
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, recruiting_class_year)
    VALUES (?, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', 'Suppression Athlete', 'MIDFIELD',
      'mens-soccer', 2027)
  `).run(ATHLETE);
});

// ---------------------------------------------------------------------------

describe('freezing with a suppressed programme', () => {
  it('excludes it, and promotes the next the model ranked', () => {
    giveAnalysis(ATHLETE);
    suppressSchool(2);
    const { campaign, programmes } = create();

    const names = programmes.map((p) => p.college_name);
    expect(names).not.toContain('School 2');
    expect(names).toContain('School 101');
    expect(programmes).toHaveLength(100);
    expect(campaign.programme_count).toBe(100);
  });

  it('still holds exactly 100 while the reserve lasts', () => {
    giveAnalysis(ATHLETE);
    for (let n = 1; n <= 50; n += 1) suppressSchool(n);
    const { campaign, programmes } = create();

    expect(programmes).toHaveLength(100);
    expect(campaign.programme_count).toBe(100);
    expect(programmes[0].college_name).toBe('School 51');
    expect(programmes.at(-1).college_name).toBe('School 150');
  });

  it('tiers by ACTIONABLE position, not by the rank the model gave', () => {
    giveAnalysis(ATHLETE);
    suppressSchool(1);
    const { programmes } = create();

    // School 2 was ranked 2 and is now the campaign's rank 1. The tier follows
    // the campaign position, because that is what the bands describe.
    expect(programmes[0]).toMatchObject({ college_name: 'School 2', rank: 1, tier: 'A' });
    expect(programmes[19]).toMatchObject({ rank: 20, tier: 'A' });
    expect(programmes[20]).toMatchObject({ rank: 21, tier: 'B' });
    expect(programmes[49]).toMatchObject({ rank: 50, tier: 'B' });
    expect(programmes[50]).toMatchObject({ rank: 51, tier: 'C' });
    expect(programmes[99]).toMatchObject({ rank: 100, tier: 'C' });
    for (const p of programmes) expect(p.tier).toBe(tierForRank(p.rank));
  });

  it('NEVER puts a promoted programme at rank 101', () => {
    giveAnalysis(ATHLETE);
    suppressSchool(100);
    const { programmes } = create();

    const promoted = programmes.find((p) => p.college_name === 'School 101');
    // The model ranked it 101. The campaign holds it at 100, because
    // `tierForRank` has no band above 100 and a rank with no band is a tier no
    // rule chose.
    expect(promoted.rank).toBe(100);
    expect(promoted.tier).toBe('C');
    expect(Math.max(...programmes.map((p) => p.rank))).toBe(100);
    expect(programmes.every((p) => p.rank >= 1 && p.rank <= MAX_RANK)).toBe(true);
  });

  it('promotes in the model’s own order for several suppressions', () => {
    giveAnalysis(ATHLETE);
    for (const n of [5, 60, 99]) suppressSchool(n);
    const { programmes } = create();
    const names = programmes.map((p) => p.college_name);

    for (const n of [5, 60, 99]) expect(names).not.toContain(`School ${n}`);
    expect(names).toContain('School 101');
    expect(names).toContain('School 102');
    expect(names).toContain('School 103');
    expect(names).not.toContain('School 104');
  });

  it('leaves a school suppressed for ANOTHER athlete alone', () => {
    db.prepare(`
      INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
      VALUES ('a-other', '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', 'Other', 'MIDFIELD', 'mens-soccer')
    `).run();
    db.prepare(`
      INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state, flagged,
        visibility, contact_stance, created_at, updated_at)
      VALUES (?, 'a-other', 'School 2', 'mens-soccer', 'none', 0, 'suppressed', 'default',
        '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z')
    `).run(randomUUID());

    giveAnalysis(ATHLETE);
    const { programmes } = create();
    // Visibility is per athlete. Another athlete's decision is not this
    // athlete's, which is the whole reason it is not in `suppressions`.
    expect(programmes.map((p) => p.college_name)).toContain('School 2');
  });
});

describe('only visibility suppresses', () => {
  it('freezes a flagged, requested, do-not-contact school like any other', () => {
    giveAnalysis(ATHLETE);
    relate('School 3', {
      flagged: true, flag_reason: 'Striv3 knows the coach',
      request_state: 'requested', contact_stance: 'do_not_contact',
    });
    const { programmes } = create();

    // A coach we already know is often the MOST actionable school on the list.
    // Only `visibility` takes one out, and the contact stance is a different
    // layer's decision about a school that IS in the campaign.
    expect(programmes.map((p) => p.college_name)).toContain('School 3');
    expect(programmes).toHaveLength(100);
    expect(programmes.map((p) => p.college_name)).not.toContain('School 101');
  });
});

describe('with nothing suppressed, a campaign is what it always was', () => {
  it('freezes the same hundred, in the same order, with the same tiers', () => {
    giveAnalysis(ATHLETE);
    const { campaign, programmes } = create();

    expect(programmes).toHaveLength(100);
    expect(campaign.programme_count).toBe(100);
    expect(programmes.map((p) => p.rank)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(programmes.map((p) => p.college_name))
      .toEqual(Array.from({ length: 100 }, (_, i) => `School ${i + 1}`));
    expect(programmes.every((p) => p.tier === tierForRank(p.rank))).toBe(true);
    // Not one reserve programme, exactly as before this slice.
    for (let n = 101; n <= 150; n += 1) {
      expect(programmes.map((p) => p.college_name)).not.toContain(`School ${n}`);
    }
  });

  it('is deterministic — two identical freezes agree row for row', () => {
    giveAnalysis(ATHLETE);
    suppressSchool(7);
    const strip = (ps) => ps.map((p) => ({
      rank: p.rank, college_name: p.college_name, tier: p.tier, match_score: p.match_score,
    }));
    const first = strip(create().programmes);
    db.exec('DELETE FROM programme_campaigns; DELETE FROM campaigns;');
    const second = strip(create().programmes);
    expect(second).toEqual(first);
  });
});

describe('the analysis blob is never rewritten', () => {
  it('is byte-identical after a campaign is frozen over suppressions', () => {
    const file = giveAnalysis(ATHLETE);
    const before = fs.readFileSync(file, 'utf8');
    for (const n of [1, 2, 3]) suppressSchool(n);
    create();
    // The model's answer stays the model's answer. Un-suppressing is one row
    // update, not a re-analysis, precisely because nothing here edits this.
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    const parsed = JSON.parse(before);
    expect(parsed.recommendations).toHaveLength(100);
    expect(parsed.reserve).toHaveLength(50);
    expect(parsed.recommendations[0].name).toBe('School 1');
  });
});

describe('audit metadata', () => {
  it('records what the derivation did, and what it did not', () => {
    giveAnalysis(ATHLETE);
    suppressSchool(4);
    suppressSchool(80);
    const { campaign } = create();
    const a = inputs(campaign).actionable;

    expect(a.provenance).toBe('OPERATOR_TIME');
    expect(a.suppressed_count).toBe(2);
    expect(a.suppressed.sort()).toEqual(['School 4', 'School 80']);
    expect(a.promoted_count).toBe(2);
    // THE ONLY PLACE RANK 101 SURVIVES. The campaign row records the
    // actionable position because that is what the tier bands read; the model's
    // own rank is recorded here so the two are never confused.
    expect(a.promoted).toEqual([
      { name: 'School 101', source_rank: 101 },
      { name: 'School 102', source_rank: 102 },
    ]);
    expect(a.actionable_count).toBe(100);
    expect(a.reserve_exhausted).toBe(false);
    expect(a.short_by).toBe(0);
  });

  it('says nothing was suppressed, rather than saying nothing', () => {
    giveAnalysis(ATHLETE);
    const a = inputs(create().campaign).actionable;
    expect(a.suppressed_count).toBe(0);
    expect(a.promoted).toEqual([]);
    expect(a.actionable_count).toBe(100);
  });
});

describe('when suppression outruns the reserve', () => {
  it('freezes fewer than 100 and says so, rather than manufacturing schools', () => {
    giveAnalysis(ATHLETE, { top: 100, reserve: 3 });
    for (const n of [1, 2, 3, 4, 5]) suppressSchool(n);
    const { campaign, programmes } = create();

    // 95 survivors + 3 promoted = 98. The campaign is truthful about its own
    // size; `programme_count` has always recorded what was ACTUALLY frozen.
    expect(programmes).toHaveLength(98);
    expect(campaign.programme_count).toBe(98);

    const a = inputs(campaign).actionable;
    expect(a.reserve_exhausted).toBe(true);
    expect(a.short_by).toBe(2);
    expect(a.promoted_count).toBe(3);
  });

  it('refuses outright only when everything is suppressed', () => {
    giveAnalysis(ATHLETE, { top: 3, reserve: 0 });
    for (const n of [1, 2, 3]) suppressSchool(n);
    // ANALYSIS_EMPTY is the existing guard and it is the right one: a campaign
    // with no programmes is not a campaign. It fires on the actionable list
    // rather than on the blob, which still holds all three.
    expect(() => create()).toThrowError(/ranked no programmes|nothing to build/i);
  });
});

describe('the global suppressions table', () => {
  it('is untouched by athlete-specific visibility', () => {
    giveAnalysis(ATHLETE);
    for (const n of [1, 2, 3]) suppressSchool(n);
    create();
    // `suppressions` is keyed on EMAIL with no athlete column. A row in it
    // silences an address for every athlete in the system.
    expect(db.prepare('SELECT COUNT(*) c FROM suppressions').get().c).toBe(0);
  });
});

describe('the campaign cap is untouched', () => {
  it('still tiers at most 100, in the same three bands', () => {
    expect(MAX_RANK).toBe(100);
    expect(TIER_BANDS.map((b) => ({ ...b }))).toEqual([
      { tier: 'A', from: 1, to: 20 },
      { tier: 'B', from: 21, to: 50 },
      { tier: 'C', from: 51, to: 100 },
    ]);
    expect(() => tierForRank(101)).toThrowError(/between 1 and 100/);
  });
});
