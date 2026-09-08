import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { createOutreach, outreachCreatedUnder, resolveToken, markOutreachSent } from './outreach.js';
import { recordDraft, confirmSend, sendsForProgrammeCampaign, sendsForOutreach } from './outreachSend.js';
import { resolveProgrammeCampaignFor, authorisedProgrammeCampaignId } from './campaignAttribution.js';
import { findOrCreateCoach } from './coaches.js';
import { isSuppressed, suppress } from './suppressions.js';
import { recentSendCount } from './sendCap.js';

/**
 * A6 — the bridge from a campaign to the messages sent under it.
 *
 * TWO COLUMNS, TWO MEANINGS, AND THE WHOLE SLICE TURNS ON KEEPING THEM APART:
 *
 *   outreach.programme_campaign_id       which campaign FIRST OPENED this
 *                                        athlete-coach relationship. Provenance.
 *                                        Written once, never rewritten.
 *   outreach_send.programme_campaign_id  which campaign THIS MESSAGE was sent
 *                                        under. Authoritative. Per message.
 *
 * A relationship endures and a campaign is finite, so the second campaign to
 * reach a coach uses the first campaign's relationship row. The test named
 * "Campaign 1 opened it, Campaign 2 used it" is the one that proves the model
 * survives that, and it is the most important test in this file.
 */

const ATHLETE = 'a-attr';
const OTHER_ATHLETE = 'a-attr-other';

function insertAthlete(id, name) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug)
    VALUES (?, '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer', ?)
  `).run(id, name, randomUUID().slice(0, 10));
}

let seq = 0;
/**
 * ACTIVE, and started long ago.
 *
 * B3 gates campaign-attributed writes on the campaign being active and within
 * its outreach window, and these tests are about ATTRIBUTION rather than
 * permission — so the fixture grants permission and gets out of the way. The
 * start date is far in the past so nothing here depends on what day it is.
 */
function makeCampaign(athleteId = ATHLETE, sport = 'mens-soccer') {
  // An athlete runs ONE campaign at a time — A1's partial unique index — so a
  // new one closes the one before it. That is also how a second season
  // actually arrives, which is what the reuse tests below depend on.
  db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = '2026-09-07T00:00:00.000Z',
      close_reason = 'completed' WHERE athlete_id = ? AND state = 'active'`).run(athleteId);
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, ?, 'active', '2020-01-01', '2026-09-07T00:00:00.000Z',
      '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z', 1)
  `).run(id, athleteId, sport);
  return id;
}

function makeProgramme(campaignId, { college = 'Duke', sport = 'mens-soccer', rank = 1 } = {}) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 82, 'A', '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z')
  `).run(id, campaignId, college, sport, rank);
  return id;
}

function makeCoach({ school = 'Duke', sport = 'mens-soccer', email } = {}) {
  return findOrCreateCoach({
    full_name: 'A Coach', email: email ?? `c${++seq}@example.edu`, school, sport, division: 'NCAA D1',
  });
}

/** The minimum a draft needs; the evidence snapshot is not what A6 is about. */
const draft = (extra) => recordDraft({
  evidence: null, body: 'hello', subject: 'hi', ...extra,
});

beforeEach(() => {
  db.exec(`DELETE FROM outreach_send; DELETE FROM outreach; DELETE FROM programme_campaigns;
           DELETE FROM campaigns; DELETE FROM coaches; DELETE FROM players; DELETE FROM suppressions;`);
  insertAthlete(ATHLETE, 'Attribution Athlete');
  insertAthlete(OTHER_ATHLETE, 'Other Athlete');
});

// ---------------------------------------------------------------------------

describe('the schema carries both columns', () => {
  it('adds them to outreach and outreach_send', () => {
    for (const table of ['outreach', 'outreach_send']) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all();
      const col = cols.find((c) => c.name === 'programme_campaign_id');
      expect(col, table).toBeTruthy();
      expect(col.notnull).toBe(0);       // nullable: a manual send has no campaign
      expect(col.dflt_value).toBeNull();
    }
  });

  it('points both at programme_campaigns with ON DELETE SET NULL', () => {
    for (const table of ['outreach', 'outreach_send']) {
      const fk = db.prepare(`PRAGMA foreign_key_list(${table})`).all()
        .find((f) => f.from === 'programme_campaign_id');
      expect(fk, table).toBeTruthy();
      expect(fk.table).toBe('programme_campaigns');
      // NEVER CASCADE. Deleting a campaign must not delete a token in a
      // coach's inbox or a record of a message that was actually sent.
      expect(fk.on_delete).toBe('SET NULL');
    }
  });

  it('indexes both for the campaign lookups', () => {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()
      .map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining([
      'idx_outreach_programme_campaign', 'idx_outreach_send_programme_campaign',
    ]));
  });

  it('refuses a programme campaign that does not exist, at the database level', () => {
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    expect(() => db.prepare('UPDATE outreach SET programme_campaign_id = ? WHERE id = ?')
      .run('not-a-programme-campaign', o.id)).toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe('deleting a campaign never deletes outreach or send history', () => {
  it('sets the provenance null and keeps the relationship, its token and its sends', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const coach = makeCoach();

    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
    draft({ outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
    confirmSend(o.id, '2026-09-10T00:00:00.000Z');

    const sendBefore = sendsForOutreach(o.id)[0];

    // The cascade under test: campaign -> programme_campaigns, and it must
    // stop there.
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaign);
    expect(db.prepare('SELECT COUNT(*) n FROM programme_campaigns').get().n).toBe(0);

    const after = db.prepare('SELECT * FROM outreach WHERE id = ?').get(o.id);
    expect(after).toBeTruthy();
    expect(after.token).toBe(o.token);
    expect(after.programme_campaign_id).toBeNull();

    const sendAfter = sendsForOutreach(o.id)[0];
    expect(sendAfter.id).toBe(sendBefore.id);
    expect(sendAfter.sequence).toBe(sendBefore.sequence);
    expect(sendAfter.sent_at).toBe('2026-09-10T00:00:00.000Z');
    expect(sendAfter.programme_campaign_id).toBeNull();

    // And the token still resolves, which is what a coach's link depends on.
    expect(resolveToken(o.token).id).toBe(o.id);
  });

  it('survives deleting the programme campaign directly', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
    draft({ outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });

    db.prepare('DELETE FROM programme_campaigns WHERE id = ?').run(pc);

    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n).toBe(1);
    expect(db.prepare('SELECT programme_campaign_id FROM outreach').get().programme_campaign_id).toBeNull();
    expect(db.prepare('SELECT programme_campaign_id FROM outreach_send').get().programme_campaign_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('creating a relationship with campaign context', () => {
  it('records the programme campaign that first opened it', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, matchId: 'Duke', programmeCampaignId: pc });
    expect(o.programme_campaign_id).toBe(pc);
    expect(db.prepare('SELECT programme_campaign_id FROM outreach WHERE id = ?').get(o.id)
      .programme_campaign_id).toBe(pc);
  });

  it('leaves it NULL for manual outreach, which is still legitimate', () => {
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    expect(o.programme_campaign_id).toBeNull();
  });

  it('refuses another athlete’s campaign', () => {
    const theirs = makeProgramme(makeCampaign(OTHER_ATHLETE));
    const coach = makeCoach();
    let thrown;
    try { createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: theirs }); }
    catch (err) { thrown = err; }

    expect(thrown.code).toBe('CAMPAIGN_ATHLETE_MISMATCH');
    // Says nothing about whose it is.
    expect(thrown.message).not.toContain(OTHER_ATHLETE);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(0);
  });

  it('refuses a campaign for a different programme', () => {
    const duke = makeProgramme(makeCampaign(), { college: 'Duke' });
    const clemsonCoach = makeCoach({ school: 'Clemson' });
    let thrown;
    try { createOutreach({ athleteId: ATHLETE, coachId: clemsonCoach.id, programmeCampaignId: duke }); }
    catch (err) { thrown = err; }

    expect(thrown.code).toBe('CAMPAIGN_PROGRAMME_MISMATCH');
    expect(thrown.message).toContain('Duke');
    expect(thrown.message).toContain('Clemson');
    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(0);
  });

  /**
   * One person can staff both a school's men's and women's programme, and
   * `coaches` is keyed on (email, school, sport) so those are two rows.
   * Matching on the school name alone would let a women's campaign attribute a
   * men's send.
   */
  it('refuses the same school in the wrong sport', () => {
    const womens = makeProgramme(makeCampaign(ATHLETE, 'womens-soccer'), {
      college: 'Duke', sport: 'womens-soccer',
    });
    const mensCoach = makeCoach({ school: 'Duke', sport: 'mens-soccer' });
    expect(() => createOutreach({ athleteId: ATHLETE, coachId: mensCoach.id, programmeCampaignId: womens }))
      .toThrow(expect.objectContaining({ code: 'CAMPAIGN_PROGRAMME_MISMATCH' }));
  });

  it('refuses a programme campaign that does not exist', () => {
    const coach = makeCoach();
    expect(() => createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: 'nope' }))
      .toThrow(expect.objectContaining({ code: 'PROGRAMME_CAMPAIGN_NOT_FOUND' }));
  });

  it('validates before the existing-row shortcut, so a bad id is refused either way', () => {
    const coach = makeCoach();
    createOutreach({ athleteId: ATHLETE, coachId: coach.id });   // the relationship now exists
    const theirs = makeProgramme(makeCampaign(OTHER_ATHLETE));
    expect(() => createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: theirs }))
      .toThrow(expect.objectContaining({ code: 'CAMPAIGN_ATHLETE_MISMATCH' }));
  });
});

describe('provenance is written once and never rewritten', () => {
  it('keeps the first campaign when a second reuses the relationship', () => {
    const coach = makeCoach();
    const first = makeProgramme(makeCampaign());
    const opened = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: first });

    // A season later. Campaign 1 closes as campaign 2 opens.
    const second = makeProgramme(makeCampaign());
    const reused = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: second });

    expect(reused.id).toBe(opened.id);
    expect(reused.token).toBe(opened.token);
    expect(reused.programme_campaign_id).toBe(first);
    expect(db.prepare('SELECT COUNT(*) n FROM outreach').get().n).toBe(1);
  });

  /**
   * A relationship opened before campaigns existed has no campaign, and the
   * first campaign to reuse it did not open it. Filling this in would invent a
   * history that never happened.
   */
  it('leaves a pre-campaign relationship NULL when a campaign later reuses it', () => {
    const coach = makeCoach();
    const legacy = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    expect(legacy.programme_campaign_id).toBeNull();

    const pc = makeProgramme(makeCampaign());
    const reused = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });

    expect(reused.id).toBe(legacy.id);
    expect(reused.programme_campaign_id).toBeNull();
    expect(db.prepare('SELECT programme_campaign_id FROM outreach WHERE id = ?').get(legacy.id)
      .programme_campaign_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('a send names its own campaign', () => {
  it('records the programme campaign on the message', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });

    draft({ outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, collegeName: 'Duke', programmeCampaignId: pc });
    const send = sendsForOutreach(o.id)[0];
    expect(send.programme_campaign_id).toBe(pc);
  });

  it('leaves a manual send NULL', () => {
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    draft({ outreachId: o.id, athleteId: ATHLETE, coachId: coach.id });
    expect(sendsForOutreach(o.id)[0].programme_campaign_id).toBeNull();
  });

  it('refuses another athlete’s campaign', () => {
    const theirs = makeProgramme(makeCampaign(OTHER_ATHLETE));
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    expect(() => draft({ outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: theirs }))
      .toThrow(expect.objectContaining({ code: 'CAMPAIGN_ATHLETE_MISMATCH' }));
    expect(db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n).toBe(0);
  });

  it('refuses an unrelated programme', () => {
    const duke = makeProgramme(makeCampaign(), { college: 'Duke' });
    const clemson = makeCoach({ school: 'Clemson' });
    const o = createOutreach({ athleteId: ATHLETE, coachId: clemson.id });
    expect(() => draft({ outreachId: o.id, athleteId: ATHLETE, coachId: clemson.id, programmeCampaignId: duke }))
      .toThrow(expect.objectContaining({ code: 'CAMPAIGN_PROGRAMME_MISMATCH' }));
    expect(db.prepare('SELECT COUNT(*) n FROM outreach_send').get().n).toBe(0);
  });

  it('moves the attribution when a pending draft is replaced under another campaign', () => {
    // Re-drafting replaces the message sitting in Outlook. The row must not
    // keep the old campaign's attribution while carrying the new one's text.
    const coach = makeCoach();
    const first = makeProgramme(makeCampaign());
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: first });
    const a = draft({ outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: first });

    const second = makeProgramme(makeCampaign());
    const b = draft({ outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: second });

    expect(b.id).toBe(a.id);            // the same pending draft
    expect(b.sequence).toBe(1);
    expect(sendsForOutreach(o.id)[0].programme_campaign_id).toBe(second);
    expect(sendsForOutreach(o.id)).toHaveLength(1);
  });
});

/**
 * THE MOST IMPORTANT SEMANTIC TEST IN A6.
 *
 * The relationship is opened under Campaign 1 and later used by Campaign 2.
 * Provenance stays with Campaign 1 because that is what it records; the two
 * messages name the campaign each was actually sent under. Nothing infers one
 * from the other, and the two answers stay different for ever.
 */
describe('Campaign 1 opened it, Campaign 2 used it', () => {
  it('keeps the relationship with Campaign 1 and attributes each message correctly', () => {
    const coach = makeCoach();

    // --- Campaign 1: opens the relationship and sends.
    const one = makeProgramme(makeCampaign());
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: one });
    draft({ outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: one });
    confirmSend(o.id, '2026-09-10T00:00:00.000Z');

    // --- Campaign 2, a season later: campaign 1 closes, campaign 2 opens, and
    // the same athlete reaches the same coach through the same row.
    const two = makeProgramme(makeCampaign());
    const reused = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: two });
    expect(reused.id).toBe(o.id);
    draft({ outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: two });
    confirmSend(o.id, '2027-03-01T00:00:00.000Z');

    // The relationship still says who opened it.
    const relationship = db.prepare('SELECT * FROM outreach WHERE id = ?').get(o.id);
    expect(relationship.programme_campaign_id).toBe(one);
    expect(relationship.token).toBe(o.token);

    // The messages say who sent them. Two sends, two campaigns, one relationship.
    const sends = sendsForOutreach(o.id);
    expect(sends).toHaveLength(2);
    expect(sends.map((s) => [s.sequence, s.programme_campaign_id]))
      .toEqual([[1, one], [2, two]]);

    // And each campaign sees only its own message.
    expect(sendsForProgrammeCampaign(one).map((s) => s.sequence)).toEqual([1]);
    expect(sendsForProgrammeCampaign(two).map((s) => s.sequence)).toEqual([2]);

    // Provenance answers a different question and gives a different answer.
    expect(outreachCreatedUnder(one).map((r) => r.id)).toEqual([o.id]);
    expect(outreachCreatedUnder(two)).toEqual([]);
  });

  /**
   * Written as a mechanical check because it is the mistake this design is
   * most likely to be broken by later: reaching for the relationship's column
   * because it is right there, and being right most of the time.
   */
  it('does not let a send infer its campaign from the relationship', async () => {
    const one = makeProgramme(makeCampaign());
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: one });

    // A message composed with NO campaign context, through a relationship that
    // has one. It must record nothing, not Campaign 1.
    draft({ outreachId: o.id, athleteId: ATHLETE, coachId: coach.id });
    expect(sendsForOutreach(o.id)[0].programme_campaign_id).toBeNull();

    // And the source says so: nothing in the send path reads the relationship's
    // column.
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('./outreachSend.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/FROM\s+outreach\b(?!_send)/i);
    expect(src).not.toMatch(/o\.programme_campaign_id/);
  });
});

// ---------------------------------------------------------------------------

describe('reads', () => {
  it('returns a programme campaign’s sends in the order they happened', () => {
    const pc = makeProgramme(makeCampaign());
    const coaches = [makeCoach({ email: 'a@x.edu' }), makeCoach({ email: 'b@x.edu' })];
    for (const [i, coach] of coaches.entries()) {
      const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
      draft({ outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
      confirmSend(o.id, `2026-09-1${i}T00:00:00.000Z`);
    }
    const sends = sendsForProgrammeCampaign(pc);
    expect(sends).toHaveLength(2);
    expect(sends.map((s) => s.sent_at)).toEqual([
      '2026-09-10T00:00:00.000Z', '2026-09-11T00:00:00.000Z',
    ]);
  });

  it('can count sends rather than drafts', () => {
    const pc = makeProgramme(makeCampaign());
    const sent = makeCoach({ email: 'sent@x.edu' });
    const onlyDrafted = makeCoach({ email: 'draft@x.edu' });
    for (const coach of [sent, onlyDrafted]) {
      const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
      draft({ outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
      if (coach.id === sent.id) confirmSend(o.id);
    }
    expect(sendsForProgrammeCampaign(pc)).toHaveLength(2);
    // A draft is not a send: every denominator in this system keys on sent_at.
    expect(sendsForProgrammeCampaign(pc, { sentOnly: true })).toHaveLength(1);
  });

  it('returns nothing for a campaign nobody wrote under', () => {
    expect(sendsForProgrammeCampaign(makeProgramme(makeCampaign()))).toEqual([]);
    expect(outreachCreatedUnder('nope')).toEqual([]);
  });
});

describe('the guard itself', () => {
  it('passes null straight through without a lookup', () => {
    // Legacy and manual outreach has no campaign and is not gated at all.
    expect(authorisedProgrammeCampaignId({ programmeCampaignId: null, athleteId: 'x', coachId: 'y' }))
      .toBeNull();
    expect(authorisedProgrammeCampaignId({ athleteId: 'x', coachId: 'y' })).toBeNull();
  });

  it('returns the verified row for a caller that needs it', () => {
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign);
    const coach = makeCoach();
    const resolved = resolveProgrammeCampaignFor({
      programmeCampaignId: pc, athleteId: ATHLETE, coachId: coach.id,
    });
    expect(resolved).toMatchObject({
      id: pc, campaign_id: campaign, athlete_id: ATHLETE, college_name: 'Duke', sport: 'mens-soccer',
    });
  });

  it('refuses a coach that does not exist', () => {
    const pc = makeProgramme(makeCampaign());
    expect(() => resolveProgrammeCampaignFor({ programmeCampaignId: pc, athleteId: ATHLETE, coachId: 'nope' }))
      .toThrow(expect.objectContaining({ code: 'COACH_NOT_FOUND' }));
  });
});

// ---------------------------------------------------------------------------

describe('nothing else changed', () => {
  it('leaves the token, the sequence and the send timestamps as they were', () => {
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    expect(o.token).toHaveLength(32);
    expect(resolveToken(o.token).id).toBe(o.id);

    draft({ outreachId: o.id, athleteId: ATHLETE, coachId: coach.id });
    confirmSend(o.id, '2026-09-10T00:00:00.000Z');
    draft({ outreachId: o.id, athleteId: ATHLETE, coachId: coach.id });
    confirmSend(o.id, '2026-09-20T00:00:00.000Z');

    expect(sendsForOutreach(o.id).map((s) => [s.sequence, s.sent_at])).toEqual([
      [1, '2026-09-10T00:00:00.000Z'], [2, '2026-09-20T00:00:00.000Z'],
    ]);
  });

  it('leaves suppression keyed on the address alone', () => {
    suppress({ email: 'coach@example.edu' });
    expect(isSuppressed('coach@example.edu')).toBe(true);
    const cols = db.prepare('PRAGMA table_info(suppressions)').all().map((c) => c.name);
    expect(cols).not.toContain('programme_campaign_id');
    expect(cols).not.toContain('campaign_id');
  });

  it('leaves the per-inbox cap counting athletes, not campaigns', () => {
    const coach = makeCoach({ email: 'popular@example.edu' });
    const pc = makeProgramme(makeCampaign());
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
    markOutreachSent(o.id);
    // One athlete has written to this inbox, whatever campaign it was under.
    expect(recentSendCount('popular@example.edu')).toBe(1);
  });

  it('adds no counter to either table', () => {
    for (const table of ['outreach', 'outreach_send']) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      for (const forbidden of ['campaign_send_count', 'reply_count', 'campaign_id', 'sequence_step']) {
        expect(cols, table).not.toContain(forbidden);
      }
    }
  });

  /**
   * A6 records attribution and nothing else. Deciding that a programme becomes
   * `active` when a row is written would fix the meaning of "active" before the
   * delivery-state model exists to define it.
   */
  it('does not move the programme campaign out of queued', () => {
    const pc = makeProgramme(makeCampaign());
    const coach = makeCoach();
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
    draft({ outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, programmeCampaignId: pc });
    confirmSend(o.id);

    const row = db.prepare('SELECT state, state_changed_at FROM programme_campaigns WHERE id = ?').get(pc);
    expect(row.state).toBe('queued');
    expect(row.state_changed_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------

/**
 * THE MIGRATION, RUN AGAINST THE DATABASE THAT ALREADY EXISTS.
 *
 * A1's tables were new and could not disturb anything. These two columns are
 * added to tables holding 96 relationships and 41 confirmed sends, each with a
 * token that may be in a coach's inbox, so the real question is not "does the
 * DDL parse" but "does anything move". It runs on a backup rather than the
 * working file: a test must not be the thing that migrates production.
 *
 * NOTHING IS BACKFILLED. Not one historical row is assigned to a campaign by
 * inference — those relationships were opened before campaigns existed, and a
 * guess would be indistinguishable from a record.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIVE_DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const HAVE_LIVE = fs.existsSync(LIVE_DB) && fs.statSync(LIVE_DB).size > 1_000_000;
const COPY = path.join(ROOT, 'node_modules/.tmp/campaign-attribution-live-copy.sqlite');
const live = HAVE_LIVE ? describe : describe.skip;
if (!HAVE_LIVE) console.warn(`\n  campaignAttribution.test.js live-migration checks SKIPPED — no database at ${LIVE_DB}\n`);

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(COPY + suffix)) fs.unlinkSync(COPY + suffix);
  }
});

/** Boots the app's own database module against a file, exactly as a server start would. */
function boot(file) {
  execFileSync('node', ['--input-type=module', '-e', `
    import db from '${path.join(ROOT, 'server/db/client.js')}';
    process.stdout.write(String(db.prepare('SELECT 1 AS ok').get().ok));
  `], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: file }, encoding: 'utf8' });
}

live('migrating the live database', () => {
  it('adds both columns, backfills nothing, and moves not one existing value', async () => {
    fs.mkdirSync(path.dirname(COPY), { recursive: true });
    const source = new Database(LIVE_DB, { readonly: true });
    await source.backup(COPY);
    source.close();

    /** Every value a coach's link or an analytics denominator depends on. */
    const census = (file) => {
      const conn = new Database(file, { readonly: true });
      const out = {
        outreach: conn.prepare('SELECT COUNT(*) n FROM outreach').get().n,
        sends: conn.prepare('SELECT COUNT(*) n FROM outreach_send').get().n,
        tokens: conn.prepare('SELECT token FROM outreach ORDER BY id').all().map((r) => r.token),
        stamps: conn.prepare('SELECT id, drafted_at, sent_at, revoked_at, match_id FROM outreach ORDER BY id').all(),
        sequences: conn.prepare('SELECT id, outreach_id, sequence, sent_at, drafted_at, policy_version FROM outreach_send ORDER BY id').all(),
        confirmed: conn.prepare('SELECT COUNT(*) n FROM outreach WHERE sent_at IS NOT NULL').get().n,
      };
      conn.close();
      return out;
    };

    const before = census(COPY);
    expect(before.outreach).toBeGreaterThan(0);
    expect(before.sends).toBeGreaterThan(0);

    boot(COPY);

    let conn = new Database(COPY, { readonly: true });
    for (const table of ['outreach', 'outreach_send']) {
      const col = conn.prepare(`PRAGMA table_info(${table})`).all()
        .find((c) => c.name === 'programme_campaign_id');
      expect(col, table).toBeTruthy();
      const fk = conn.prepare(`PRAGMA foreign_key_list(${table})`).all()
        .find((f) => f.from === 'programme_campaign_id');
      expect(fk.on_delete, table).toBe('SET NULL');
    }
    // UNKNOWN HISTORY STAYS UNKNOWN.
    expect(conn.prepare('SELECT COUNT(*) n FROM outreach WHERE programme_campaign_id IS NOT NULL').get().n).toBe(0);
    expect(conn.prepare('SELECT COUNT(*) n FROM outreach_send WHERE programme_campaign_id IS NOT NULL').get().n).toBe(0);
    conn.close();

    expect(census(COPY)).toEqual(before);

    // Idempotent: booting again changes nothing and does not fail on a column
    // that already exists.
    boot(COPY);
    expect(census(COPY)).toEqual(before);
    conn = new Database(COPY, { readonly: true });
    expect(conn.prepare('SELECT COUNT(*) n FROM outreach WHERE programme_campaign_id IS NOT NULL').get().n).toBe(0);
    // And the legacy send backfill still produces exactly one event per
    // confirmed send, rather than a second pass adding more.
    expect(conn.prepare('SELECT COUNT(*) n FROM outreach_send').get().n).toBe(before.sends);
    conn.close();
  });

  it('leaves the working database itself untouched', () => {
    const conn = new Database(LIVE_DB, { readonly: true });
    const attributed = conn.prepare('SELECT COUNT(*) n FROM outreach WHERE programme_campaign_id IS NOT NULL').get().n;
    const outreach = conn.prepare('SELECT COUNT(*) n FROM outreach').get().n;
    conn.close();
    expect(outreach).toBeGreaterThan(0);
    // Whether the dev server has since added the column is not this test's
    // business; that nothing has been attributed by inference is.
    expect(attributed).toBe(0);
  });
});
