import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

process.env.RECRUITMATCH_DB = ':memory:';
process.env.PUBLIC_BASE_URL = 'https://example.test';
process.env.SENDER_IDENTITY = 'Striv3';
process.env.SENDER_POSTAL_ADDRESS = '1 Test St, Auckland';
process.env.OUTLOOK_FROM_ADDRESS = 'rhys@example.test';

/**
 * Bulk sending is where the measurement data will actually come from — twenty
 * programmes in one run, one after another. Everything that could quietly go
 * wrong at that scale is per-row: evidence computed for one school landing on
 * another's record, an operator's override leaking across the batch, a failed
 * send taking the wrong row's attribution with it.
 *
 * None of that is visible in a single-programme test, which is why this file
 * exists separately.
 */
const composed = [];
let failOn = null;

vi.mock('../lib/outlook.js', () => ({
  isOutlookAvailable: () => true,
  composeInOutlook: vi.fn(async (m) => {
    if (failOn && m.to.includes(failOn)) throw new Error('Outlook refused');
    composed.push(m);
    return { from: 'rhys@example.test', fromMatches: true };
  }),
}));
vi.mock('../export/exportProfiles.js', () => ({
  exportAthlete: vi.fn(), OUTPUT_DIR: '/tmp/thriv3-bulk-test',
}));
vi.mock('node:fs', async (orig) => {
  const real = await orig();
  return { ...real, default: { ...real.default, existsSync: () => true } };
});

const db = (await import('../db/client.js')).default;
const { sendOutreach } = await import('./sendOutreach.js');
const { evidenceForOutreach } = await import('../lib/evidenceLog.js');
const { evidenceReport } = await import('../lib/evidencePerformance.js');
const { confirmSent, pendingDrafts } = await import('../lib/confirmSends.js');

const RECENT = () => new Date(Date.now() - 86400000).toISOString();
const athleteId = randomUUID();

/**
 * Three programmes with deliberately different evidence:
 *   Kiwi State    — NZ history      → HISTORICAL_SAME_COUNTRY
 *   Aussie Tech   — Australian only → HISTORICAL_SAME_REGION
 *   Plain College — nothing at all  → no evidence
 */
const PROGRAMMES = [
  { name: 'Kiwi State', country: 'New Zealand', season: '2023' },
  { name: 'Aussie Tech', country: 'Australia', season: '2024' },
  { name: 'Plain College', country: null, season: null },
];

function rosterRow(college, o = {}) {
  db.prepare(`INSERT INTO roster_players
    (id, created_date, updated_date, college_name, sport, division, season, player_name,
     position, minutes_played, projected_minutes, estimated_graduation_year,
     eligibility_end_year, nationality, country)
    VALUES (@id, @stamp, @stamp, @college, 'mens-soccer', 'NCAA D1', @season, @name,
     @position, NULL, 600, @grad, 2029, @nat, @country)`)
    .run({
      id: randomUUID(), stamp: RECENT(), college, season: '2026', name: 'Squad Player',
      position: 'DEFENSE', grad: 2029, nat: 'USA', country: '', ...o,
    });
}

function seed() {
  composed.length = 0;
  failOn = null;
  // suppressions included: it is append-only in production and never cleared,
  // so a suppression written by one test silently muted a programme in every
  // later one — which is the cross-run leakage these tests exist to catch,
  // found in the fixture rather than the code.
  db.exec(`DELETE FROM outreach_evidence; DELETE FROM engagement_rollup;
           DELETE FROM outreach; DELETE FROM coaches; DELETE FROM players;
           DELETE FROM roster_players; DELETE FROM colleges; DELETE FROM suppressions;`);

  // `video_id`, not just the URL: sendOutreach refuses to put a dead profile
  // link in front of a coach, and the publish check reads the extracted id.
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport,
      nationality, recruiting_class_year, public_slug, email, highlights_url, video_id)
    VALUES (?, '2026-01-01', '2026-01-01', 'Rhys Davies', 'Defender', 'mens-soccer',
      'New Zealand', 2027, 'slug1', 'a@b.test', 'https://youtu.be/abc', 'abc')`).run(athleteId);

  for (const p of PROGRAMMES) {
    db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active)
      VALUES (?, '2026-01-01', '2026-01-01', ?, 'mens-soccer', 'NCAA D1', 1)`)
      .run(randomUUID(), p.name);
    // A realistic current squad for every programme — defenders and midfielders
    // in ordinary proportions — so freshness is CURRENT throughout and the only
    // thing differing between programmes is what their history holds.
    for (let i = 0; i < 8; i += 1) rosterRow(p.name, { name: `D${i}`, position: 'DEFENSE' });
    for (let i = 0; i < 12; i += 1) rosterRow(p.name, { name: `M${i}`, position: 'MIDFIELD' });
    if (p.country) {
      // Current internationals, so more than one angle is genuinely available
      // and an operator override has something real to choose between.
      for (let i = 0; i < 3; i += 1) {
        rosterRow(p.name, { name: `${p.name} Intl ${i}`, position: 'MIDFIELD', country: 'Spain', nat: 'International' });
      }
      // The historical row, in an earlier season.
      rosterRow(p.name, { name: `${p.name} Import`, season: p.season, country: p.country, nat: 'International' });
    }
  }
}

const request = (programme, extra = {}) => ({
  athleteId,
  coaches: [{ name: `${programme} Coach`, email: `coach@${programme.replace(/\s/g, '')}.test`, title: 'Head Coach' }],
  subject: 'Subject',
  body: 'Hi Coach,\n\n{{player_profile_url}}\n\nBest regards',
  greetingName: 'Coach',
  collegeName: programme,
  division: 'NCAA D1',
  matchId: programme,
  ...extra,
});

/** The whole batch, sequentially — exactly how BulkEmailComposer drives it. */
async function runBatch(extraPer = () => ({})) {
  const out = [];
  for (const p of PROGRAMMES) out.push(await sendOutreach(request(p.name, extraPer(p.name))));
  return out;
}

beforeEach(seed);

describe('a bulk batch attributes evidence per programme', () => {
  it('writes one evidence row per outreach, never one for the batch', async () => {
    await runBatch();
    const rows = db.prepare('SELECT * FROM outreach_evidence').all();
    expect(rows).toHaveLength(PROGRAMMES.length);
    expect(new Set(rows.map((r) => r.outreach_id)).size).toBe(PROGRAMMES.length);
  });

  it('gives each programme its own evidence, not the previous one\'s', async () => {
    await runBatch();
    const byCollege = Object.fromEntries(
      db.prepare('SELECT college_name, primary_kind FROM outreach_evidence').all()
        .map((r) => [r.college_name, r.primary_kind]),
    );
    expect(byCollege['Kiwi State']).toBe('HISTORICAL_SAME_COUNTRY');
    expect(byCollege['Aussie Tech']).toBe('HISTORICAL_SAME_REGION');
    // The programme with nothing to say must record nothing, not inherit.
    expect(byCollege['Plain College']).toBeNull();
  });

  it('stores the prose each coach actually received, per row', async () => {
    await runBatch();
    const rows = db.prepare('SELECT college_name, rendered_paragraph FROM outreach_evidence').all();
    const kiwi = rows.find((r) => r.college_name === 'Kiwi State');
    const aussie = rows.find((r) => r.college_name === 'Aussie Tech');
    expect(kiwi.rendered_paragraph).toContain('New Zealand');
    expect(aussie.rendered_paragraph).toContain('Australia');
    expect(aussie.rendered_paragraph).not.toContain('New Zealand');
  });

  it('evaluates evidence_rendered against each body, not the batch', async () => {
    // Only the first programme's body carries its own sentence.
    //
    // Built FROM the engine rather than typed out. A hand-written copy of the
    // sentence goes stale the moment the copy is reworded, and it did — the
    // test then reports "the claim was cut" for a body that carries it, which
    // is indistinguishable from the bug it is guarding.
    const { evidenceFor } = await import('../lib/evidenceQueries.js');
    const athlete = db.prepare('SELECT * FROM players WHERE id = ?').get(athleteId);
    const claim = evidenceFor(athlete, 'Kiwi State', { sport: 'mens-soccer' }).sentences[0].text;
    await sendOutreach(request('Kiwi State', {
      body: `Hi,\n\n${claim}.\n\n{{player_profile_url}}`,
    }));
    await sendOutreach(request('Aussie Tech', { body: 'Hi,\n\nNothing specific.\n\n{{player_profile_url}}' }));

    const rows = db.prepare('SELECT college_name, evidence_rendered FROM outreach_evidence').all();
    expect(rows.find((r) => r.college_name === 'Kiwi State').evidence_rendered).toBe(1);
    expect(rows.find((r) => r.college_name === 'Aussie Tech').evidence_rendered).toBe(0);
  });

  it('gives every outreach in the batch its own tracking token', async () => {
    await runBatch();
    const tokens = db.prepare('SELECT token FROM outreach').all().map((r) => r.token);
    expect(tokens).toHaveLength(PROGRAMMES.length);
    expect(new Set(tokens).size).toBe(PROGRAMMES.length);
    expect(tokens.every(Boolean)).toBe(true);
  });
});

describe('one failure cannot misattribute another programme', () => {
  it('logs nothing for the failed send and everything for the rest', async () => {
    failOn = 'AussieTech';
    const results = await runBatch();

    expect(results[1].results[0].status).toBe('error');
    const rows = db.prepare('SELECT college_name FROM outreach_evidence ORDER BY college_name').all();
    // Evidence is written AFTER the compose succeeds, so the failed programme
    // has no row — rather than a row carrying the next programme's evidence.
    expect(rows.map((r) => r.college_name)).toEqual(['Kiwi State', 'Plain College']);
  });

  /**
   * Asserted on `drafted_at`, not `sent_at`, since 2026-08-28.
   *
   * A batch drafted from the browser leaves `sent_at` NULL on EVERY row until
   * the operator confirms what they actually sent, so `sent_at` can no longer
   * tell a failed programme from a successful one. `drafted_at` is the field
   * that now records "a message reached Outlook", which is what this test has
   * always been about.
   */
  it('leaves the failed outreach undrafted rather than half-recorded', async () => {
    failOn = 'AussieTech';
    await runBatch();
    const rows = db.prepare(`
      SELECT c.school, o.drafted_at, o.sent_at FROM outreach o JOIN coaches c ON c.id = o.coach_id
    `).all();
    expect(rows.find((r) => r.school === 'Aussie Tech').drafted_at).toBeNull();
    expect(rows.find((r) => r.school === 'Kiwi State').drafted_at).not.toBeNull();
    // And nothing in a draft-only batch is claimed as sent.
    for (const r of rows) expect(r.sent_at, r.school).toBeNull();
  });
});

describe('operator selection does not leak across the batch', () => {
  it('applies an override to the programme it was made for and no other', async () => {
    // Only Kiwi State is told to lead with the roster angle instead.
    await runBatch((name) => (
      name === 'Kiwi State' ? { evidenceSelection: ['INTERNATIONAL_ROSTER'] } : {}
    ));

    const rows = db.prepare('SELECT college_name, primary_kind, operator_selected FROM outreach_evidence').all();
    const kiwi = rows.find((r) => r.college_name === 'Kiwi State');
    const aussie = rows.find((r) => r.college_name === 'Aussie Tech');

    expect(kiwi.primary_kind).toBe('INTERNATIONAL_ROSTER');
    expect(kiwi.operator_selected).toBe(1);
    // Aussie Tech keeps the engine's own choice and is not marked as chosen.
    expect(aussie.primary_kind).toBe('HISTORICAL_SAME_REGION');
    expect(aussie.operator_selected).toBe(0);
  });

  it('ignores an override naming a kind that programme never generated', async () => {
    await runBatch((name) => (
      name === 'Plain College' ? { evidenceSelection: ['HISTORICAL_SAME_COUNTRY'] } : {}
    ));
    const plain = db.prepare("SELECT * FROM outreach_evidence WHERE college_name = 'Plain College'").get();
    expect(plain.primary_kind).toBeNull();
    expect(plain.operator_selected).toBe(0);
  });
});

describe('per-coach protections still apply inside a batch', () => {
  it('skips a suppressed coach without writing evidence for them', async () => {
    db.prepare("INSERT INTO suppressions (email, created_at, reason) VALUES (?, '2026-01-01', 'unsubscribed')")
      .run('coach@kiwistate.test');

    const results = await runBatch();
    expect(results[0].results[0].status).toBe('suppressed');
    const rows = db.prepare('SELECT college_name FROM outreach_evidence').all();
    expect(rows.map((r) => r.college_name)).not.toContain('Kiwi State');
  });

  it('keeps freshness recorded per row', async () => {
    await runBatch();
    const rows = db.prepare('SELECT roster_freshness, roster_age_days FROM outreach_evidence').all();
    for (const r of rows) {
      expect(r.roster_freshness).toBe('CURRENT');
      expect(r.roster_age_days).toBe(1);
    }
  });
});

/**
 * Confirms every pending draft, standing in for the operator running
 * `npm run confirm-sends -- --apply` after sending the batch from Outlook.
 *
 * The report tests below need it because a DRAFT is no longer a send: nothing
 * enters a reply-rate denominator until a human says it was sent.
 */
const confirmEverything = () => confirmSent(pendingDrafts().map((r) => r.id));

describe('the batch is readable by the performance report', () => {
  /**
   * The property the confirmation workflow exists to guarantee. Opening twenty
   * drafts and sending fifteen used to record twenty sends, because `sent_at`
   * was stamped the moment a draft window opened.
   */
  it('counts nothing until the operator confirms what they sent', async () => {
    await runBatch();
    expect(db.prepare('SELECT COUNT(*) n FROM outreach WHERE drafted_at IS NOT NULL').get().n)
      .toBe(PROGRAMMES.length);
    expect(evidenceReport({ sport: 'mens-soccer' }).totals.sends).toBe(0);

    // Evidence rows and tokens are written at draft time regardless, so a
    // confirmation adds no data — it only admits what already exists to the
    // denominator.
    expect(db.prepare('SELECT COUNT(*) n FROM outreach_evidence').get().n).toBe(PROGRAMMES.length);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach WHERE token IS NOT NULL').get().n)
      .toBe(PROGRAMMES.length);

    confirmEverything();
    expect(evidenceReport({ sport: 'mens-soccer' }).totals.sends).toBe(PROGRAMMES.length);
  });

  it('confirms only the drafts it is given', async () => {
    await runBatch();
    const one = pendingDrafts()[0];
    confirmSent([one.id]);
    expect(evidenceReport({ sport: 'mens-soccer' }).totals.sends).toBe(1);
    expect(pendingDrafts()).toHaveLength(PROGRAMMES.length - 1);
  });

  it('groups the batch by angle and refuses to call it a result', async () => {
    await runBatch();
    confirmEverything();
    const rep = evidenceReport({ sport: 'mens-soccer' });

    expect(rep.totals.sends).toBe(PROGRAMMES.length);
    expect(rep.byPrimaryKind.map((r) => r.kind).sort())
      .toEqual(['HISTORICAL_SAME_COUNTRY', 'HISTORICAL_SAME_REGION', null].sort());
    // Three sends is nowhere near the floor, and the report must say so
    // rather than reporting a rate that looks like a finding.
    for (const row of rep.byPrimaryKind) expect(row.verdict).toBe('INSUFFICIENT_SAMPLE');
    expect(rep.totals.verdict).toBe('INSUFFICIENT_SAMPLE');
  });

  it('marks structure as not comparable', async () => {
    await runBatch();
    confirmEverything();
    expect(evidenceReport().byStructure.comparable).toBe(false);
  });

  it('reads reply rate over rendered sends, not over every send', async () => {
    await runBatch();
    confirmEverything();
    const outreachId = db.prepare(
      "SELECT outreach_id FROM outreach_evidence WHERE college_name = 'Kiwi State'",
    ).get().outreach_id;
    db.prepare(`INSERT INTO engagement_rollup (outreach_id, qualified_visits, responded_at)
      VALUES (?, 2, '2026-02-01')`).run(outreachId);

    const row = evidenceReport().byPrimaryKind.find((r) => r.kind === 'HISTORICAL_SAME_COUNTRY');
    // The body in runBatch carries no evidence sentence, so nothing was
    // rendered and the rate is unanswerable rather than 100%.
    expect(row.rendered_sends).toBe(0);
    expect(row.reply_rate).toBeNull();
  });
});

describe('evidence rows survive re-drafting the same pair', () => {
  it('updates rather than duplicating', async () => {
    await sendOutreach(request('Kiwi State'));
    await sendOutreach(request('Kiwi State'));
    expect(db.prepare("SELECT COUNT(*) n FROM outreach_evidence WHERE college_name='Kiwi State'").get().n).toBe(1);
  });
});
