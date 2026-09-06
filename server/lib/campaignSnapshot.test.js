import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import {
  MATCHING_MODEL_SIX_CRITERION, MATCHING_MODEL_UNKNOWN, MAX_RANK,
  createCampaign, resolveAnalysisPath, tierForRank,
  getCampaign, listCampaignsForAthlete, listProgrammeCampaigns,
} from './campaigns.js';
import { UPLOADS_DIR } from './uploadPath.js';

/**
 * A3 — the moment a mutable pointer becomes a durable record.
 *
 * The critical property under test is not that creation works; it is that
 * NOTHING AFTERWARDS CAN MOVE WHAT IT FROZE. `players.recommendations` is a
 * single mutable pointer that re-analysing overwrites and saving a profile
 * nulls, and a campaign that could still be reached through it would be a
 * historical record with a live dependency.
 *
 * Fixture analyses are written into THRIV3_UPLOADS_DIR — a throwaway directory
 * set by vitest.config.js — so nothing here can land in the store the product
 * reads.
 */

const ATHLETE = 'a-snapshot';
const OTHER = 'a-snapshot-other';

beforeEach(() => {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  db.exec('DELETE FROM programme_campaigns; DELETE FROM campaigns; DELETE FROM players;');
  insertAthlete(ATHLETE, 'Snapshot Athlete');
  insertAthlete(OTHER, 'Other Athlete');
});

afterAll(() => {
  // Only what these tests wrote, and only inside the throwaway store.
  for (const f of written) if (fs.existsSync(f)) fs.unlinkSync(f);
});

const written = [];

function insertAthlete(id, name, extra = {}) {
  db.prepare(`
    INSERT INTO players (
      id, created_date, updated_date, full_name, position, sport,
      recruiting_class_year, origin, state, academic_minimum, budget_range,
      preferred_divisions, preferred_conferences, criterion_ranking
    ) VALUES (
      ?, '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer',
      2027, 'International', 'CA', 6.0, '$10k-$15k/yr',
      '["NCAA D1"]', '[]', '["geography","athletic"]'
    )
  `).run(id, name);
  if (Object.keys(extra).length) {
    const cols = Object.keys(extra);
    db.prepare(`UPDATE players SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`)
      .run({ ...extra, id });
  }
}

/** A recommendation in the shape the current six-criterion model stores. */
function rec(n, overrides = {}) {
  return {
    id: `col-${n}`,
    name: `School ${n}`,
    division: 'NCAA D1',
    conference: 'Big East',
    match_score: 100 - n,
    breakdown: [
      { key: 'athletic', label: 'Athletic fit', weight: 0.35, score: 0.9 },
      { key: 'roster', label: 'Roster opportunity', weight: 0.1, score: 0.5 },
      { key: 'academic', label: 'Academic fit', weight: 0.1, score: 0.5 },
      { key: 'affordability', label: 'Affordability', weight: 0.1, score: 0.5 },
      { key: 'programQuality', label: 'Program quality', weight: 0.15, score: 0.6 },
      { key: 'geography', label: 'Location', weight: 0.2, score: 0.7 },
    ],
    labels: { athletic: 'target', roster: 'high' },
    confidence: 'measured',
    coaching_staff: [{ name: 'A Coach', email: 'coach@example.edu' }],
    ...overrides,
  };
}

/** Writes an analysis into the throwaway upload store and returns its ref. */
function writeAnalysis(analysis, { name = `${randomUUID()}-recommendations.json` } = {}) {
  const file = path.join(UPLOADS_DIR, name);
  fs.writeFileSync(file, typeof analysis === 'string' ? analysis : JSON.stringify(analysis));
  written.push(file);
  return `/uploads/${name}`;
}

function giveAnalysis(athleteId, analysis) {
  const ref = writeAnalysis(analysis);
  db.prepare('UPDATE players SET recommendations = ? WHERE id = ?').run(ref, athleteId);
  return ref;
}

const analysisOf = (n, summary = 'Ranked 1166 eligible programs on six weighted criteria.') => ({
  recommendations: Array.from({ length: n }, (_, i) => rec(i + 1)),
  summary,
});

// ---------------------------------------------------------------------------

describe('freezing a stored analysis', () => {
  it('creates a draft campaign carrying the athlete, the sport and the source', () => {
    const ref = giveAnalysis(ATHLETE, analysisOf(100));
    const { campaign } = createCampaign(ATHLETE, { at: '2026-09-07T12:00:00.000Z' });

    expect(campaign.state).toBe('draft');
    expect(campaign.athlete_id).toBe(ATHLETE);
    expect(campaign.sport).toBe('mens-soccer');
    expect(campaign.source_analysis_ref).toBe(ref);
    expect(campaign.snapshot_taken_at).toBe('2026-09-07T12:00:00.000Z');
    expect(campaign.programme_count).toBe(100);
    // Never active. Activation is a separate, deliberate act.
    expect(campaign.closed_at).toBeNull();
  });

  it('turns every recommendation into exactly one programme row', () => {
    giveAnalysis(ATHLETE, analysisOf(100));
    const { campaign, programmes } = createCampaign(ATHLETE);

    expect(programmes).toHaveLength(100);
    expect(campaign.programme_count).toBe(programmes.length);
    expect(new Set(programmes.map((p) => p.college_name)).size).toBe(100);
  });

  it('takes rank from array position, never from re-sorting the scores', () => {
    // Scores deliberately NOT in descending order. The stored order is the
    // ranking; re-deriving it would silently reorder somebody's campaign.
    const scrambled = {
      recommendations: [rec(1, { match_score: 40 }), rec(2, { match_score: 95 }), rec(3, { match_score: 70 })],
      summary: 's',
    };
    giveAnalysis(ATHLETE, scrambled);
    const { programmes } = createCampaign(ATHLETE);

    expect(programmes.map((p) => [p.rank, p.college_name, p.match_score])).toEqual([
      [1, 'School 1', 40],
      [2, 'School 2', 95],
      [3, 'School 3', 70],
    ]);
  });

  it('bands tiers through the A2 rule, 20 / 30 / 50', () => {
    giveAnalysis(ATHLETE, analysisOf(100));
    const { programmes } = createCampaign(ATHLETE);

    const byTier = programmes.reduce((acc, p) => ({ ...acc, [p.tier]: (acc[p.tier] || 0) + 1 }), {});
    expect(byTier).toEqual({ A: 20, B: 30, C: 50 });
    for (const p of programmes) expect(p.tier).toBe(tierForRank(p.rank));
    expect(programmes.find((p) => p.rank === 20).tier).toBe('A');
    expect(programmes.find((p) => p.rank === 21).tier).toBe('B');
    expect(programmes.find((p) => p.rank === 50).tier).toBe('B');
    expect(programmes.find((p) => p.rank === 51).tier).toBe('C');
  });

  it('starts every programme queued and AUTO-tiered, Tier C included', () => {
    giveAnalysis(ATHLETE, analysisOf(100));
    const { programmes } = createCampaign(ATHLETE, { at: '2026-09-07T12:00:00.000Z' });

    expect(new Set(programmes.map((p) => p.state))).toEqual(new Set(['queued']));
    expect(new Set(programmes.map((p) => p.tier_source))).toEqual(new Set(['AUTO']));
    expect(new Set(programmes.map((p) => p.tier_set_at))).toEqual(new Set(['2026-09-07T12:00:00.000Z']));
    expect(programmes.every((p) => p.state_reason === null && p.state_changed_at === null)).toBe(true);
    // Rule 1: tiering controls outreach intensity, never membership.
    expect(programmes.filter((p) => p.tier === 'C')).toHaveLength(50);
  });

  it('freezes programme identity, score and context', () => {
    giveAnalysis(ATHLETE, analysisOf(3));
    const { programmes } = createCampaign(ATHLETE);
    const first = programmes[0];

    expect(first.college_name).toBe('School 1');
    expect(first.college_id).toBe('col-1');
    expect(first.sport).toBe('mens-soccer');       // from the campaign, not the record
    expect(first.match_score).toBe(99);
    expect(first.division).toBe('NCAA D1');
    expect(first.conference).toBe('Big East');

    const breakdown = JSON.parse(first.score_breakdown);
    expect(breakdown.breakdown.map((b) => b.key)).toContain('geography');
    expect(breakdown.labels.athletic).toBe('target');
    expect(breakdown.confidence).toBe('measured');
  });

  it('freezes no coaching staff, even though the analysis carries it', () => {
    giveAnalysis(ATHLETE, analysisOf(3));
    const { programmes } = createCampaign(ATHLETE);
    for (const p of programmes) {
      expect(p).not.toHaveProperty('coaching_staff');
      expect(JSON.stringify(p)).not.toContain('coach@example.edu');
    }
  });

  it('returns programmes in rank order', () => {
    giveAnalysis(ATHLETE, analysisOf(60));
    const { campaign, programmes } = createCampaign(ATHLETE);
    expect(programmes.map((p) => p.rank)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(listProgrammeCampaigns(campaign.id).map((p) => p.rank)).toEqual(programmes.map((p) => p.rank));
  });

  it('records the operator-authored fields and nothing the client could forge', () => {
    giveAnalysis(ATHLETE, analysisOf(5));
    const { campaign } = createCampaign(ATHLETE, {
      label: '  Autumn 2026  ',
      startsOn: '2026-09-15',
      outreachEndsOn: '2026-10-06',
      endsOn: '2026-10-20',
    });
    expect(campaign.label).toBe('Autumn 2026');
    expect(campaign.starts_on).toBe('2026-09-15');
    expect(campaign.outreach_ends_on).toBe('2026-10-06');
    expect(campaign.ends_on).toBe('2026-10-20');
  });

  it('defaults starts_on to the creation date and leaves the ends open', () => {
    giveAnalysis(ATHLETE, analysisOf(5));
    const { campaign } = createCampaign(ATHLETE, { at: '2026-09-07T23:30:00.000Z' });
    expect(campaign.starts_on).toBe('2026-09-07');
    expect(campaign.outreach_ends_on).toBeNull();
    expect(campaign.ends_on).toBeNull();
    expect(campaign.label).toBeNull();
  });

  it('snapshots the athlete’s sport rather than accepting one', () => {
    insertAthlete('a-womens', 'Womens Athlete');
    db.prepare("UPDATE players SET sport = 'womens-soccer' WHERE id = 'a-womens'").run();
    giveAnalysis('a-womens', analysisOf(3));
    const { campaign, programmes } = createCampaign('a-womens', { sport: 'mens-soccer' });
    expect(campaign.sport).toBe('womens-soccer');
    expect(new Set(programmes.map((p) => p.sport))).toEqual(new Set(['womens-soccer']));
  });
});

// ---------------------------------------------------------------------------

describe('the snapshot is history, and history does not move', () => {
  /**
   * THE TEST THIS WHOLE PHASE EXISTS FOR.
   *
   * Everything the campaign was built from is then changed underneath it: the
   * pointer is repointed at a completely different analysis, the blob it named
   * is deleted from disk, the college rows are renamed, and the athlete's own
   * profile is rewritten. Every campaign and programme row must be identical
   * afterwards, field for field.
   */
  it('survives re-analysis, a deleted blob, renamed colleges and a rewritten profile', () => {
    giveAnalysis(ATHLETE, analysisOf(100, 'Ranked 1166 eligible programs on six weighted criteria.'));
    const { campaign } = createCampaign(ATHLETE, { at: '2026-09-07T12:00:00.000Z' });

    const campaignBefore = getCampaign(campaign.id);
    const programmesBefore = listProgrammeCampaigns(campaign.id);
    expect(programmesBefore).toHaveLength(100);

    // 1. Re-analysis: a completely different list under a new pointer.
    const replacement = {
      recommendations: Array.from({ length: 12 }, (_, i) => rec(500 + i, { name: `Totally Different ${i}` })),
      summary: 'A later, different analysis.',
    };
    giveAnalysis(ATHLETE, replacement);

    // 2. The blob the campaign was built from is gone from disk.
    const oldFile = path.join(UPLOADS_DIR, path.basename(campaignBefore.source_analysis_ref));
    if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);

    // 3. The colleges themselves are renamed and re-divisioned.
    db.prepare(`
      INSERT INTO colleges (id, created_date, updated_date, name, division, sport)
      VALUES ('col-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
              'Renamed University', 'NCAA D3', 'mens-soccer')
    `).run();

    // 4. The athlete's profile is rewritten, the way saving the form does.
    db.prepare(`
      UPDATE players SET sport = 'womens-soccer', position = 'FORWARD',
        recruiting_class_year = 2030, academic_minimum = 9.9, recommendations = NULL
      WHERE id = ?
    `).run(ATHLETE);

    expect(getCampaign(campaign.id)).toEqual(campaignBefore);
    expect(listProgrammeCampaigns(campaign.id)).toEqual(programmesBefore);
  });

  it('leaves an earlier campaign untouched when a second is created from a new analysis', () => {
    giveAnalysis(ATHLETE, analysisOf(100));
    const first = createCampaign(ATHLETE, { at: '2026-09-07T12:00:00.000Z' });
    const firstBefore = listProgrammeCampaigns(first.campaign.id);

    giveAnalysis(ATHLETE, analysisOf(30));
    const second = createCampaign(ATHLETE, { at: '2026-11-01T12:00:00.000Z' });

    expect(listProgrammeCampaigns(first.campaign.id)).toEqual(firstBefore);
    expect(getCampaign(first.campaign.id).programme_count).toBe(100);
    expect(getCampaign(second.campaign.id).programme_count).toBe(30);
    expect(getCampaign(first.campaign.id).source_analysis_ref)
      .not.toBe(getCampaign(second.campaign.id).source_analysis_ref);
  });

  it('reads the pointer once, and records the analysis it actually froze', () => {
    const ref = giveAnalysis(ATHLETE, analysisOf(4));
    const { campaign } = createCampaign(ATHLETE);
    // Whatever happens to the pointer next, the campaign names what it read.
    db.prepare("UPDATE players SET recommendations = '/uploads/something-else.json' WHERE id = ?").run(ATHLETE);
    expect(getCampaign(campaign.id).source_analysis_ref).toBe(ref);
  });
});

// ---------------------------------------------------------------------------

describe('what creation refuses', () => {
  it('refuses an athlete that does not exist', () => {
    expect(() => createCampaign('nobody'))
      .toThrow(expect.objectContaining({ code: 'ATHLETE_NOT_FOUND' }));
  });

  it('refuses an athlete with no stored analysis', () => {
    expect(() => createCampaign(ATHLETE))
      .toThrow(expect.objectContaining({ code: 'NO_STORED_ANALYSIS' }));
  });

  it('refuses cleanly when the blob has gone from disk', () => {
    const ref = giveAnalysis(ATHLETE, analysisOf(5));
    fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(ref)));
    expect(() => createCampaign(ATHLETE))
      .toThrow(expect.objectContaining({ code: 'ANALYSIS_FILE_MISSING' }));
  });

  it('refuses malformed JSON', () => {
    const ref = writeAnalysis('{"recommendations": [', { name: `${randomUUID()}-broken.json` });
    db.prepare('UPDATE players SET recommendations = ? WHERE id = ?').run(ref, ATHLETE);
    expect(() => createCampaign(ATHLETE))
      .toThrow(expect.objectContaining({ code: 'ANALYSIS_UNREADABLE' }));
  });

  it('refuses a structure that is not an analysis', () => {
    for (const body of ['[1,2,3]', '"a string"', '42', 'null']) {
      const ref = writeAnalysis(body, { name: `${randomUUID()}-shape.json` });
      db.prepare('UPDATE players SET recommendations = ? WHERE id = ?').run(ref, ATHLETE);
      expect(() => createCampaign(ATHLETE))
        .toThrow(expect.objectContaining({ code: 'ANALYSIS_INVALID' }));
    }
    giveAnalysis(ATHLETE, { summary: 'no list at all' });
    expect(() => createCampaign(ATHLETE))
      .toThrow(expect.objectContaining({ code: 'ANALYSIS_INVALID' }));
  });

  it('refuses an empty recommendation list', () => {
    // One such blob exists on disk for real, from an analysis that ranked
    // nothing. There is no campaign to build from it.
    giveAnalysis(ATHLETE, { recommendations: [], summary: 'nothing survived the filters' });
    expect(() => createCampaign(ATHLETE))
      .toThrow(expect.objectContaining({ code: 'ANALYSIS_EMPTY' }));
  });

  it('accepts a short list, because a filtered pool legitimately produces one', () => {
    // Counts of 6, 27, 46, 50 and 53 all occur among the analyses on disk.
    for (const n of [1, 6, 27, 53, 99, MAX_RANK]) {
      db.exec('DELETE FROM programme_campaigns; DELETE FROM campaigns;');
      giveAnalysis(ATHLETE, analysisOf(n));
      const { campaign, programmes } = createCampaign(ATHLETE);
      expect(campaign.programme_count).toBe(n);
      expect(programmes).toHaveLength(n);
    }
  });

  it('refuses more programmes than the bands can tier', () => {
    giveAnalysis(ATHLETE, analysisOf(MAX_RANK + 1));
    expect(() => createCampaign(ATHLETE))
      .toThrow(expect.objectContaining({ code: 'ANALYSIS_TOO_LARGE' }));
  });

  it('refuses a record with no programme name', () => {
    for (const bad of [{ name: '' }, { name: '   ' }, { name: null }, { name: 42 }]) {
      giveAnalysis(ATHLETE, { recommendations: [rec(1), rec(2, bad)], summary: 's' });
      expect(() => createCampaign(ATHLETE))
        .toThrow(expect.objectContaining({ code: 'ANALYSIS_INVALID' }));
    }
  });

  /**
   * One orphaned blob on disk carries `match_score: null` on all 100 rows.
   * Rounding, defaulting or coercing would put a number in a permanent record
   * that the analysis never produced.
   */
  it('refuses a score it would have to invent', () => {
    for (const bad of [null, undefined, 82.4, '82', NaN, {}]) {
      giveAnalysis(ATHLETE, { recommendations: [rec(1), rec(2, { match_score: bad })], summary: 's' });
      let thrown;
      try { createCampaign(ATHLETE); } catch (err) { thrown = err; }
      expect(thrown.code).toBe('ANALYSIS_INVALID');
      expect(thrown.message).toContain('School 2');
    }
  });

  it('refuses a duplicate programme, and leaves nothing behind', () => {
    giveAnalysis(ATHLETE, {
      recommendations: [rec(1), rec(2), rec(3, { name: 'School 1' })],
      summary: 's',
    });
    expect(() => createCampaign(ATHLETE)).toThrow(/appears twice/);
    expect(db.prepare('SELECT COUNT(*) n FROM campaigns').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM programme_campaigns').get().n).toBe(0);
  });

  it('refuses dates that are not dates, and orderings that cannot happen', () => {
    giveAnalysis(ATHLETE, analysisOf(5));
    for (const bad of ['2026-13-01', '2026-02-30', '07/09/2026', '2026-9-7', '2026-09-07T00:00:00Z', 20260907]) {
      expect(() => createCampaign(ATHLETE, { startsOn: bad }))
        .toThrow(expect.objectContaining({ code: 'INVALID_DATE' }));
    }
    expect(() => createCampaign(ATHLETE, { startsOn: '2026-09-15', outreachEndsOn: '2026-09-01' }))
      .toThrow(expect.objectContaining({ code: 'INVALID_DATE_ORDER' }));
    expect(() => createCampaign(ATHLETE, { startsOn: '2026-09-15', endsOn: '2026-09-01' }))
      .toThrow(expect.objectContaining({ code: 'INVALID_DATE_ORDER' }));
    expect(() => createCampaign(ATHLETE, {
      startsOn: '2026-09-15', outreachEndsOn: '2026-10-20', endsOn: '2026-10-06',
    })).toThrow(expect.objectContaining({ code: 'INVALID_DATE_ORDER' }));
    expect(db.prepare('SELECT COUNT(*) n FROM campaigns').get().n).toBe(0);
  });

  it('writes nothing at all when any part of creation fails', () => {
    // Every refusal above, in one place, asserting the same thing: a failed
    // creation is indistinguishable from one that was never attempted.
    const before = {
      campaigns: db.prepare('SELECT COUNT(*) n FROM campaigns').get().n,
      programmes: db.prepare('SELECT COUNT(*) n FROM programme_campaigns').get().n,
    };
    giveAnalysis(ATHLETE, { recommendations: [rec(1), rec(2, { match_score: null })], summary: 's' });
    expect(() => createCampaign(ATHLETE)).toThrow();
    giveAnalysis(ATHLETE, analysisOf(MAX_RANK + 5));
    expect(() => createCampaign(ATHLETE)).toThrow();
    expect({
      campaigns: db.prepare('SELECT COUNT(*) n FROM campaigns').get().n,
      programmes: db.prepare('SELECT COUNT(*) n FROM programme_campaigns').get().n,
    }).toEqual(before);
  });
});

// ---------------------------------------------------------------------------

describe('matching provenance', () => {
  it('is valid JSON with the three kinds of fact kept apart', () => {
    giveAnalysis(ATHLETE, analysisOf(30, 'Ranked 213 eligible programs on six weighted criteria.'));
    const { campaign } = createCampaign(ATHLETE);
    const inputs = JSON.parse(campaign.matching_inputs);

    expect(inputs.schema).toBe('campaign-matching-inputs/1');
    expect(inputs.analysis.provenance).toBe('HISTORICAL');
    expect(inputs.athlete.provenance).toBe('SNAPSHOT_TIME');
    expect(Array.isArray(inputs.unavailable)).toBe(true);
  });

  it('names the model it can identify, and says how', () => {
    giveAnalysis(ATHLETE, analysisOf(10));
    const inputs = JSON.parse(createCampaign(ATHLETE).campaign.matching_inputs);
    expect(inputs.model.id).toBe(MATCHING_MODEL_SIX_CRITERION);
    expect(inputs.model.identifiedBy).toBe('RECOMMENDATION_BREAKDOWN_SHAPE');
    expect(inputs.model.criteria).toContain('programQuality');
    expect(inputs.model.note).toMatch(/not recorded by the analysis run/i);
  });

  /**
   * 39 of the 98 analyses on disk carry no breakdown at all. Labelling them
   * with today's model would assert a version they may never have had.
   */
  it('refuses to name a model it cannot identify', () => {
    const legacy = {
      recommendations: [
        { name: 'Old School', match_score: 88 },
        { name: 'Another Old School', match_score: 71 },
      ],
      summary: 'a pre-six-criterion analysis',
    };
    giveAnalysis(ATHLETE, legacy);
    const { campaign, programmes } = createCampaign(ATHLETE);
    const inputs = JSON.parse(campaign.matching_inputs);

    expect(inputs.model.id).toBe(MATCHING_MODEL_UNKNOWN);
    expect(inputs.model.identifiedBy).toBe('NO_BREAKDOWN_STORED');
    expect(inputs.model.criteria).toBeNull();
    // Absent is stored as absent, not as an empty object.
    expect(programmes[0].score_breakdown).toBeNull();
    expect(programmes[0].college_id).toBeNull();
    expect(programmes[0].division).toBeNull();
  });

  it('says UNKNOWN rather than guessing when the shapes are mixed', () => {
    giveAnalysis(ATHLETE, {
      recommendations: [rec(1), { name: 'Old School', match_score: 50 }],
      summary: 's',
    });
    const inputs = JSON.parse(createCampaign(ATHLETE).campaign.matching_inputs);
    expect(inputs.model.id).toBe(MATCHING_MODEL_UNKNOWN);
    expect(inputs.model.identifiedBy).toBe('MIXED_BREAKDOWN_SHAPES');
  });

  it('keeps the analysis summary verbatim rather than parsing prose out of it', () => {
    const summary = 'Ranked 213 eligible programs on six weighted criteria. 953 excluded by your filters.';
    giveAnalysis(ATHLETE, analysisOf(8, summary));
    const inputs = JSON.parse(createCampaign(ATHLETE).campaign.matching_inputs);
    expect(inputs.analysis.summary).toBe(summary);
    expect(inputs.analysis.returned).toBe(8);
  });

  it('captures the athlete inputs as they stand, labelled as snapshot-time', () => {
    giveAnalysis(ATHLETE, analysisOf(5));
    const inputs = JSON.parse(createCampaign(ATHLETE).campaign.matching_inputs);

    expect(inputs.athlete.position).toBe('MIDFIELD');
    expect(inputs.athlete.recruiting_class_year).toBe(2027);
    expect(inputs.athlete.origin).toBe('International');
    expect(inputs.athlete.academic_minimum).toBe(6.0);
    expect(inputs.athlete.budget_range).toBe('$10k-$15k/yr');
    // JSON columns arrive parsed, not as strings a reader has to unpick.
    expect(inputs.athlete.preferred_divisions).toEqual(['NCAA D1']);
    expect(inputs.athlete.criterion_ranking).toEqual(['geography', 'athletic']);
    expect(inputs.athlete.note).toMatch(/not proof/i);
  });

  it('records an absent athlete input as null rather than omitting it', () => {
    insertAthlete('a-sparse', 'Sparse Athlete');
    db.prepare("UPDATE players SET origin = NULL, academic_minimum = NULL, match_weights = NULL WHERE id = 'a-sparse'").run();
    giveAnalysis('a-sparse', analysisOf(3));
    const inputs = JSON.parse(createCampaign('a-sparse').campaign.matching_inputs);
    expect(inputs.athlete).toHaveProperty('origin', null);
    expect(inputs.athlete).toHaveProperty('academic_minimum', null);
    expect(inputs.athlete).toHaveProperty('match_weights', null);
  });

  it('names what was never recorded, with the reason, instead of inventing it', () => {
    giveAnalysis(ATHLETE, analysisOf(5));
    const inputs = JSON.parse(createCampaign(ATHLETE).campaign.matching_inputs);
    const fields = inputs.unavailable.map((u) => u.field);

    expect(fields).toEqual(expect.arrayContaining([
      'roster_season', 'pool_size', 'excluded_counts', 'analysed_at', 'resolved_weights',
    ]));
    for (const entry of inputs.unavailable) expect(entry.why).toBeTruthy();
    // None of them appears as a fabricated value anywhere else.
    for (const field of fields) expect(inputs.analysis).not.toHaveProperty(field);
    for (const field of fields) expect(inputs.athlete).not.toHaveProperty(field);
  });
});

// ---------------------------------------------------------------------------

describe('the stored pointer is untrusted input', () => {
  it('accepts only a flat reference inside the upload store', () => {
    const ref = writeAnalysis(analysisOf(2), { name: `${randomUUID()}-ok.json` });
    expect(resolveAnalysisPath(ref)).toBe(path.join(UPLOADS_DIR, path.basename(ref)));
  });

  it('refuses traversal, absolute paths, URLs and inline JSON', () => {
    const hostile = [
      '/uploads/../../../../etc/passwd',
      '/uploads/../server/data/recruitmatch.sqlite',
      '/uploads/subdir/file.json',
      '/uploads/..',
      '/uploads/.',
      '/uploads/',
      '/etc/passwd',
      '../uploads/x.json',
      'uploads/x.json',
      'file:///etc/passwd',
      'http://example.com/recommendations.json',
      'https://example.com/recommendations.json',
      '{"recommendations":[]}',
      '',
      null,
      undefined,
      42,
    ];
    for (const ref of hostile) {
      expect(() => resolveAnalysisPath(ref))
        .toThrow(expect.objectContaining({ code: 'ANALYSIS_REF_UNSAFE' }));
    }
  });

  it('refuses a traversal pointer through creation too, not only in isolation', () => {
    db.prepare("UPDATE players SET recommendations = '/uploads/../../../etc/passwd' WHERE id = ?").run(ATHLETE);
    expect(() => createCampaign(ATHLETE))
      .toThrow(expect.objectContaining({ code: 'ANALYSIS_REF_UNSAFE' }));
  });

  it('refuses a symlink inside the store that points out of it', () => {
    const outside = path.join(UPLOADS_DIR, '..', `escape-${randomUUID()}.json`);
    fs.writeFileSync(outside, JSON.stringify(analysisOf(2)));
    const linkName = `${randomUUID()}-link.json`;
    const link = path.join(UPLOADS_DIR, linkName);
    try {
      fs.symlinkSync(outside, link);
    } catch {
      return; // filesystem refuses symlinks; the string checks above still hold
    }
    written.push(link, outside);
    expect(() => resolveAnalysisPath(`/uploads/${linkName}`))
      .toThrow(expect.objectContaining({ code: 'ANALYSIS_REF_UNSAFE' }));
  });

  /**
   * `server/index.js` is the only other place the upload store is named. If
   * the two ever disagree, creation reads from a directory nothing writes to.
   */
  it('resolves the same upload store the upload route writes to', () => {
    /**
     * There is ONE declaration of the store, in server/lib/uploadPath.js, and
     * this asserts the server has not grown a second: two copies of a security
     * boundary are how they come to disagree, and the route writing somewhere
     * the reader does not look is a silent failure either way.
     */
    const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    expect(src).toContain("from './lib/uploadPath.js'");
    expect(src).not.toMatch(/uploadsDir\s*=/);
    expect(src).toContain('express.static(UPLOADS_DIR)');

    // Under test the override is in force; without it the default is
    // server/uploads, resolved from this module's own location.
    expect(process.env.THRIV3_UPLOADS_DIR).toBeTruthy();
    expect(UPLOADS_DIR).toBe(path.resolve(process.env.THRIV3_UPLOADS_DIR));
  });
});

// ---------------------------------------------------------------------------

describe('creation and the lifecycle it hands over to', () => {
  it('leaves the campaign inert until somebody activates it', () => {
    giveAnalysis(ATHLETE, analysisOf(10));
    const { campaign } = createCampaign(ATHLETE);
    expect(campaign.state).toBe('draft');
    expect(db.prepare("SELECT COUNT(*) n FROM campaigns WHERE state = 'active'").get().n).toBe(0);
  });

  it('permits several drafts from the same analysis, which stay independent', () => {
    // Drafts are operator review objects: two date or label configurations
    // over one analysis is a reasonable thing to want to compare. Only ONE may
    // ever be active, and that is enforced by the schema.
    const ref = giveAnalysis(ATHLETE, analysisOf(10));
    const a = createCampaign(ATHLETE, { label: 'Three weeks', endsOn: '2026-09-28' });
    const b = createCampaign(ATHLETE, { label: 'Six weeks', endsOn: '2026-10-19' });

    expect(a.campaign.id).not.toBe(b.campaign.id);
    expect(a.campaign.source_analysis_ref).toBe(ref);
    expect(b.campaign.source_analysis_ref).toBe(ref);
    expect(listCampaignsForAthlete(ATHLETE)).toHaveLength(2);
    expect(db.prepare('SELECT COUNT(*) n FROM programme_campaigns').get().n).toBe(20);
  });

  it('scopes a created campaign to its athlete', () => {
    giveAnalysis(ATHLETE, analysisOf(5));
    giveAnalysis(OTHER, analysisOf(7));
    const mine = createCampaign(ATHLETE);
    const theirs = createCampaign(OTHER);

    expect(listCampaignsForAthlete(ATHLETE).map((c) => c.id)).toEqual([mine.campaign.id]);
    expect(listCampaignsForAthlete(OTHER).map((c) => c.id)).toEqual([theirs.campaign.id]);
    expect(listProgrammeCampaigns(mine.campaign.id)).toHaveLength(5);
    expect(listProgrammeCampaigns(theirs.campaign.id)).toHaveLength(7);
  });

  it('goes with the athlete when the athlete is deleted', () => {
    giveAnalysis(ATHLETE, analysisOf(5));
    const { campaign } = createCampaign(ATHLETE);
    db.prepare('DELETE FROM players WHERE id = ?').run(ATHLETE);
    expect(getCampaign(campaign.id)).toBeNull();
    expect(db.prepare('SELECT COUNT(*) n FROM programme_campaigns').get().n).toBe(0);
  });
});
