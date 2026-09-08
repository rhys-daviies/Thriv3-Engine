import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import db from './client.js';

/**
 * PHASE A1 — the campaign tables, and nothing but the tables.
 *
 * Every rule Phase A relies on is declared in DDL rather than left to a
 * function somebody remembers to call, so these are tests of the DATABASE:
 * they insert rows directly and assert what SQLite refuses. Creation, tier
 * assignment and state transitions are A2, and none of them exist yet — which
 * is precisely why the constraints have to hold on their own until they do.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ATHLETE = 'a-schema-test';
const OTHER_ATHLETE = 'a-schema-test-other';

function insertAthlete(id, name) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer')
  `).run(id, name);
}

let seq = 0;
function campaign(overrides = {}) {
  const row = {
    id: `c-${++seq}`,
    athlete_id: ATHLETE,
    sport: 'mens-soccer',
    label: null,
    starts_on: '2026-09-06',
    outreach_ends_on: null,
    ends_on: null,
    created_at: '2026-09-06T00:00:00.000Z',
    updated_at: '2026-09-06T00:00:00.000Z',
    closed_at: null,
    close_reason: null,
    source_analysis_ref: '/uploads/whatever.json',
    snapshot_taken_at: '2026-09-06T00:00:00.000Z',
    matching_inputs: null,
    programme_count: 100,
    ...overrides,
  };
  const cols = Object.keys(row);
  db.prepare(
    `INSERT INTO campaigns (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`,
  ).run(row);
  return row.id;
}

/** State is left to its DEFAULT unless a test is about state. */
function activeCampaign(overrides = {}) {
  const id = campaign(overrides);
  db.prepare("UPDATE campaigns SET state = 'active' WHERE id = ?").run(id);
  return id;
}

function programme(campaignId, overrides = {}) {
  const row = {
    id: `pc-${++seq}`,
    campaign_id: campaignId,
    college_name: 'Butler',
    sport: 'mens-soccer',
    college_id: null,
    rank: 1,
    match_score: 82,
    score_breakdown: null,
    division: 'D1',
    conference: 'Big East',
    tier: 'A',
    tier_set_at: null,
    state_reason: null,
    state_changed_at: null,
    created_at: '2026-09-06T00:00:00.000Z',
    updated_at: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
  const cols = Object.keys(row);
  db.prepare(
    `INSERT INTO programme_campaigns (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`,
  ).run(row);
  return row.id;
}

beforeEach(() => {
  db.exec('DELETE FROM programme_campaigns; DELETE FROM campaigns; DELETE FROM players;');
  insertAthlete(ATHLETE, 'Schema Test');
  insertAthlete(OTHER_ATHLETE, 'Schema Test Other');
});

describe('the tables exist as designed', () => {
  it('creates both tables', () => {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('campaigns', 'programme_campaigns')")
      .all()
      .map((r) => r.name)
      .sort();
    expect(names).toEqual(['campaigns', 'programme_campaigns']);
  });

  it('carries every approved campaign column', () => {
    const cols = db.prepare('PRAGMA table_info(campaigns)').all().map((c) => c.name);
    expect(cols).toEqual([
      'id', 'athlete_id', 'sport', 'label', 'state',
      'starts_on', 'outreach_ends_on', 'ends_on',
      'created_at', 'updated_at', 'closed_at', 'close_reason',
      'source_analysis_ref', 'snapshot_taken_at', 'matching_inputs', 'programme_count',
    ]);
  });

  it('carries every approved programme campaign column', () => {
    const cols = db.prepare('PRAGMA table_info(programme_campaigns)').all().map((c) => c.name);
    expect(cols).toEqual([
      'id', 'campaign_id', 'college_name', 'sport', 'college_id',
      'rank', 'match_score', 'score_breakdown', 'division', 'conference',
      'tier', 'tier_source', 'tier_set_at',
      'state', 'state_reason', 'state_changed_at',
      'created_at', 'updated_at',
    ]);
  });

  /**
   * D5, as a check rather than a note in a document. Contacts legitimately
   * change and outreach must use current addresses; a frozen staff list here
   * would be a second, staler answer to "who do we write to".
   */
  it('freezes no coaching staff and stores no counters', () => {
    const cols = db.prepare('PRAGMA table_info(programme_campaigns)').all().map((c) => c.name);
    for (const forbidden of [
      'coach_id', 'coaches', 'coaching_staff', 'coach_email',
      'sent_count', 'coaches_contacted', 'reply_count', 'last_sent_at',
    ]) {
      expect(cols).not.toContain(forbidden);
    }
  });

  it('defaults a new campaign to draft and a new programme to queued/AUTO', () => {
    const id = campaign();
    expect(db.prepare('SELECT state FROM campaigns WHERE id = ?').get(id).state).toBe('draft');
    const pcId = programme(id);
    const pc = db.prepare('SELECT state, tier_source FROM programme_campaigns WHERE id = ?').get(pcId);
    expect(pc).toEqual({ state: 'queued', tier_source: 'AUTO' });
  });

  it('declares the reading indexes', () => {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('campaigns', 'programme_campaigns')")
      .all()
      .map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining([
      'idx_campaigns_athlete',
      'idx_campaigns_one_active',
      'idx_programme_campaigns_list',
      'idx_programme_campaigns_programme',
    ]));
  });
});

describe('the enums are enforced by the database', () => {
  it('refuses a campaign state outside draft/active/closed', () => {
    for (const state of ['paused', 'queued', 'ACTIVE', '']) {
      expect(() => campaign({ state })).toThrow(/CHECK constraint failed/);
    }
    // And accepts all three that are approved.
    for (const state of ['draft', 'active', 'closed']) {
      expect(() => campaign({ athlete_id: OTHER_ATHLETE, state })).not.toThrow();
      db.prepare("UPDATE campaigns SET state = 'closed' WHERE athlete_id = ?").run(OTHER_ATHLETE);
    }
  });

  it('refuses a programme state outside queued/active/stopped/completed', () => {
    const id = campaign();
    for (const state of ['awaiting_response', 'action_required', 'not_interested', 'unreachable', 'complete']) {
      expect(() => programme(id, { state, rank: 2 })).toThrow(/CHECK constraint failed/);
    }
    for (const [i, state] of ['queued', 'active', 'stopped', 'completed'].entries()) {
      expect(() => programme(id, { state, rank: 10 + i, college_name: `Ok ${i}` })).not.toThrow();
    }
  });

  it('refuses a tier outside A/B/C, and refuses a row with no tier at all', () => {
    const id = campaign();
    for (const tier of ['D', 'a', 'hot', 'cold', '']) {
      expect(() => programme(id, { tier, rank: 3 })).toThrow(/CHECK constraint failed/);
    }
    // No DEFAULT on purpose: a row that reached the database without a tier is
    // a bug worth failing on, not a row quietly labelled 'C'.
    expect(() => programme(id, { tier: null, rank: 4 })).toThrow(/NOT NULL constraint failed/);
  });

  it('refuses a tier_source outside AUTO/OPERATOR', () => {
    const id = campaign();
    for (const source of ['auto', 'ENGINE', 'human', '']) {
      expect(() => programme(id, { tier_source: source, rank: 5 })).toThrow(/CHECK constraint failed/);
    }
    expect(() => programme(id, { tier_source: 'OPERATOR', rank: 6 })).not.toThrow();
  });
});

describe('one programme, one rank, one campaign', () => {
  it('refuses the same programme twice in one campaign', () => {
    const id = campaign();
    programme(id, { college_name: 'Butler', sport: 'mens-soccer', rank: 1 });
    expect(() => programme(id, { college_name: 'Butler', sport: 'mens-soccer', rank: 2 }))
      .toThrow(/UNIQUE constraint failed/);
  });

  it('treats the same school in two sports as two programmes', () => {
    // colleges is UNIQUE (name, sport) and every school has a men's and a
    // women's row, so the name alone is not a programme.
    const id = campaign();
    programme(id, { college_name: 'Butler', sport: 'mens-soccer', rank: 1 });
    expect(() => programme(id, { college_name: 'Butler', sport: 'womens-soccer', rank: 2 })).not.toThrow();
  });

  it('refuses two programmes at the same rank in one campaign', () => {
    const id = campaign();
    programme(id, { college_name: 'Butler', rank: 4 });
    expect(() => programme(id, { college_name: 'Duke', rank: 4 })).toThrow(/UNIQUE constraint failed/);
  });

  it('lets the same programme and the same rank appear in a different campaign', () => {
    const first = campaign();
    const second = campaign();
    programme(first, { college_name: 'Butler', rank: 4 });
    expect(() => programme(second, { college_name: 'Butler', rank: 4 })).not.toThrow();
  });

  it('refuses a programme row pointing at no campaign', () => {
    expect(() => programme('c-does-not-exist')).toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe('one active campaign per athlete', () => {
  it('allows several drafts for one athlete', () => {
    campaign();
    campaign();
    campaign();
    expect(db.prepare("SELECT COUNT(*) n FROM campaigns WHERE athlete_id = ? AND state = 'draft'").get(ATHLETE).n)
      .toBe(3);
  });

  it('allows several closed campaigns for one athlete', () => {
    campaign({ state: 'closed' });
    campaign({ state: 'closed' });
    expect(db.prepare("SELECT COUNT(*) n FROM campaigns WHERE athlete_id = ? AND state = 'closed'").get(ATHLETE).n)
      .toBe(2);
  });

  it('refuses a second active campaign for the same athlete', () => {
    activeCampaign();
    expect(() => campaign({ state: 'active' })).toThrow(/UNIQUE constraint failed/);
  });

  /**
   * The path that actually happens in the product: a draft is reviewed and
   * then activated. The index has to catch it on UPDATE, not only on INSERT.
   */
  it('refuses promoting a second draft to active', () => {
    activeCampaign();
    const draft = campaign();
    expect(() => db.prepare("UPDATE campaigns SET state = 'active' WHERE id = ?").run(draft))
      .toThrow(/UNIQUE constraint failed/);
  });

  it('frees the slot when the active campaign closes', () => {
    const first = activeCampaign();
    const draft = campaign();
    db.prepare("UPDATE campaigns SET state = 'closed' WHERE id = ?").run(first);
    expect(() => db.prepare("UPDATE campaigns SET state = 'active' WHERE id = ?").run(draft)).not.toThrow();
  });

  it('allows an active campaign for each athlete', () => {
    activeCampaign({ athlete_id: ATHLETE });
    expect(() => activeCampaign({ athlete_id: OTHER_ATHLETE })).not.toThrow();
  });
});

describe('ownership cascades', () => {
  it('takes a campaign’s programme rows with it', () => {
    const id = campaign();
    programme(id, { college_name: 'Butler', rank: 1 });
    programme(id, { college_name: 'Duke', rank: 2 });
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
    expect(db.prepare('SELECT COUNT(*) n FROM programme_campaigns').get().n).toBe(0);
  });

  /**
   * src/pages/Players.jsx deletes an athlete through the generic entity route,
   * which issues a bare DELETE with no cascade of its own. Without ON DELETE
   * CASCADE here, that button would start failing on a foreign key the moment
   * an athlete had a campaign.
   */
  it('takes an athlete’s campaigns and their programme rows with them', () => {
    const mine = campaign();
    programme(mine, { college_name: 'Butler', rank: 1 });
    const theirs = campaign({ athlete_id: OTHER_ATHLETE });
    programme(theirs, { college_name: 'Duke', rank: 1 });

    expect(() => db.prepare('DELETE FROM players WHERE id = ?').run(ATHLETE)).not.toThrow();

    expect(db.prepare('SELECT COUNT(*) n FROM campaigns').get().n).toBe(1);
    expect(db.prepare('SELECT campaign_id FROM programme_campaigns').all())
      .toEqual([{ campaign_id: theirs }]);
  });
});

/**
 * THE LIVE DATABASE, BOOTED ON A COPY.
 *
 * schema.sql runs on every client.js import, so the real check is not "does
 * this DDL parse" but "does it apply to the database that already exists" —
 * 25 tables, ten of which are declared in no file in this repository. It is
 * run against a backup rather than the working file: a test must not be the
 * thing that migrates production, and it must not be able to damage it.
 */
const LIVE_DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const HAVE_LIVE = fs.existsSync(LIVE_DB) && fs.statSync(LIVE_DB).size > 1_000_000;
const COPY = path.join(ROOT, 'node_modules/.tmp/campaign-schema-live-copy.sqlite');
const live = HAVE_LIVE ? describe : describe.skip;
if (!HAVE_LIVE) console.warn(`\n  campaignSchema.test.js live-boot checks SKIPPED — no database at ${LIVE_DB}\n`);

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(COPY + suffix)) fs.unlinkSync(COPY + suffix);
  }
});

live('booting against the live database', () => {
  it('adds the tables and changes not one existing row', async () => {
    fs.mkdirSync(path.dirname(COPY), { recursive: true });
    const source = new Database(LIVE_DB, { readonly: true });
    await source.backup(COPY);
    source.close();

    const counted = [
      'players', 'colleges', 'coaches', 'outreach', 'outreach_send', 'outreach_evidence',
      'tracking_events', 'engagement_rollup', 'suppressions', 'roster_players',
      'recruiting_arrivals', 'graduating_seniors',
    ];
    const census = (file) => {
      const conn = new Database(file, { readonly: true });
      const out = {};
      for (const table of counted) out[table] = conn.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
      // Fingerprints, not just counts: a count survives a row being rewritten.
      out._outreachTokens = conn.prepare('SELECT COUNT(DISTINCT token) n FROM outreach').get().n;
      out._sentOutreach = conn.prepare('SELECT COUNT(*) n FROM outreach WHERE sent_at IS NOT NULL').get().n;
      out._playerRecs = conn.prepare('SELECT COUNT(*) n FROM players WHERE recommendations IS NOT NULL').get().n;
      conn.close();
      return out;
    };

    const before = census(COPY);
    expect(before.outreach).toBeGreaterThan(0);

    // Boot the app's own database module against the copy: schema.sql, then
    // migrate.js, exactly as a server start would.
    execFileSync('node', ['--input-type=module', '-e', `
      import db from '${path.join(ROOT, 'server/db/client.js')}';
      process.stdout.write(String(db.prepare('SELECT 1 AS ok').get().ok));
    `], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: COPY }, encoding: 'utf8' });

    const conn = new Database(COPY, { readonly: true });
    const tables = conn
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('campaigns', 'programme_campaigns')")
      .all().map((r) => r.name).sort();
    const indexes = conn
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('campaigns', 'programme_campaigns')")
      .all().map((r) => r.name);
    const rows = conn.prepare('SELECT COUNT(*) n FROM campaigns').get().n;
    conn.close();

    expect(tables).toEqual(['campaigns', 'programme_campaigns']);
    expect(indexes).toEqual(expect.arrayContaining(['idx_campaigns_one_active', 'idx_programme_campaigns_list']));
    // Additive DDL creates no data.
    expect(rows).toBe(0);
    expect(census(COPY)).toEqual(before);
  });

  it('leaves the working database itself untouched', () => {
    // The copy is what was booted. If this ever fails, a test has written to
    // the file the product runs on.
    const conn = new Database(LIVE_DB, { readonly: true });
    const n = conn.prepare('SELECT COUNT(*) n FROM outreach').get().n;
    const campaignRows = conn
      .prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name = 'campaigns'")
      .get().n
      ? conn.prepare('SELECT COUNT(*) n FROM campaigns').get().n
      : 0;
    conn.close();
    expect(n).toBeGreaterThan(0);
    // Whether the dev server has since created the table is not this test's
    // business; that it holds no rows is.
    expect(campaignRows).toBe(0);
  });
});
