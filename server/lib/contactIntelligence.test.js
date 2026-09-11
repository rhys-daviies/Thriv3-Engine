import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import {
  contactIntelligenceForAthlete, contactIntelligenceForProgramme,
} from './contactIntelligence.js';
import { MESSAGE_STATE } from '../../shared/outreachMessageState.js';

/**
 * WHAT THIS PRODUCT MAY HONESTLY SAY A COACH DID.
 *
 * The tests that matter here are the ones about restraint. There is no email
 * pixel and no email click tracking, so nothing may claim an open or a click;
 * replies are set by a person and may never be reported as observed; and a
 * drafted message is not a message anyone received.
 */

const ATHLETE = 'a-intel';
const OTHER = 'a-intel-other';

function athlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer')
  `).run(id, id);
}

function coach({ name, email, school = 'Duke', sport = 'mens-soccer', title = 'Head Coach' }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, '2026-09-01T00:00:00.000Z', ?, ?, ?, 'NCAA D1', ?, ?)
  `).run(id, name, email, school, sport, title);
  return id;
}

function outreach({ athleteId = ATHLETE, coachId, drafted = null, sent = null, revoked = null }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, drafted_at, sent_at, revoked_at)
    VALUES (?, ?, ?, ?, '2026-09-01T00:00:00.000Z', ?, ?, ?)
  `).run(id, athleteId, coachId, randomUUID(), drafted, sent, revoked);
  return id;
}

let seq = 0;
function message({ outreachId, coachId, state, sentAt = null, origin = null, athleteId = ATHLETE }) {
  db.prepare(`
    INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, sent_at, athlete_id, coach_id,
      college_name, sport, origin, policy_version, state, created_at)
    VALUES (?, ?, ?, '2026-09-01T10:00:00.000Z', ?, ?, ?, 'Duke', 'mens-soccer', ?,
      'LEGACY_UNKNOWN', ?, '2026-09-01T00:00:00.000Z')
  `).run(randomUUID(), outreachId, ++seq, sentAt, athleteId, coachId, origin, state);
}

function rollup({ outreachId, visits = 0, lastVisit = null, coverage = 0, responded = null }) {
  db.prepare(`
    INSERT INTO engagement_rollup (outreach_id, qualified_visits, last_qualified_at,
      best_coverage_pct, responded_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '2026-09-10T00:00:00.000Z')
  `).run(outreachId, visits, lastVisit, coverage, responded);
}

const forDuke = (athleteId = ATHLETE) =>
  contactIntelligenceForProgramme({ athleteId, collegeName: 'Duke', sport: 'mens-soccer' });

beforeEach(() => {
  seq = 0;
  db.exec(`DELETE FROM outreach_evidence; DELETE FROM engagement_rollup;
           DELETE FROM tracking_events; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM athlete_programmes; DELETE FROM players; DELETE FROM coaches;`);
  athlete(ATHLETE);
  athlete(OTHER);
});

// ---------------------------------------------------------------------------

describe('a programme nobody has written to', () => {
  it('is absent rather than present and empty', () => {
    coach({ name: 'A Coach', email: 'a@duke.test' });
    // A map miss is the honest representation. A hundred empty summaries would
    // be a hundred assertions of the same non-fact.
    expect(contactIntelligenceForAthlete(ATHLETE)).toEqual([]);
    expect(forDuke()).toBeNull();
  });

  it('answers empty for a missing athlete rather than throwing', () => {
    expect(contactIntelligenceForAthlete(null)).toEqual([]);
    expect(contactIntelligenceForProgramme({})).toBeNull();
  });
});

describe('prior outreach is not engagement', () => {
  it('reports a draft without claiming anyone received anything', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    const o = outreach({ coachId: c, drafted: '2026-09-02T10:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.DRAFT });

    const p = forDuke();
    expect(p.contacted).toBe(true);
    expect(p.draft_only).toBe(true);
    expect(p.has_confirmed_send).toBe(false);
    expect(p.confirmed_send_count).toBe(0);
    expect(p.last_activity_kind).toBe('draft');
    // Nothing observed about the coach at all.
    expect(p.engagement.profile_visits).toBe(0);
    expect(p.engagement.reply_recorded).toBe(false);
  });

  it('reports a confirmed send as sent, and counts only accepted messages', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-20T11:00:00.000Z' });

    const p = forDuke();
    expect(p.has_confirmed_send).toBe(true);
    expect(p.draft_only).toBe(false);
    expect(p.confirmed_send_count).toBe(2);
    // The real latest, not the relationship's first-wins timestamp.
    expect(p.last_confirmed_send_at).toBe('2026-09-20T11:00:00.000Z');
  });
});

describe('engagement comes from the engagement tables, and nowhere else', () => {
  it('reports profile visits, which are not email opens', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    rollup({ outreachId: o, visits: 3, lastVisit: '2026-09-06T09:00:00.000Z', coverage: 82 });

    const p = forDuke();
    /**
     * `qualified_visits` is scanner-filtered — `visit_start` is deliberately
     * non-qualifying because that is what a Safe Links scanner produces — and
     * session-collapsed by the rollup. A count is therefore visits, not raw
     * events, which is the only reason a number is safe to report.
     */
    expect(p.engagement.profile_visits).toBe(3);
    expect(p.engagement.last_visit_at).toBe('2026-09-06T09:00:00.000Z');
    expect(p.engagement.best_coverage_pct).toBe(82);
  });

  it('claims NO reply unless a person recorded one', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    rollup({ outreachId: o, visits: 5, lastVisit: '2026-09-06T09:00:00.000Z' });

    // Five visits and deep coverage are still not a reply. Nothing in this
    // build ingests or classifies replies.
    expect(forDuke().engagement.reply_recorded).toBe(false);
  });

  it('reports an operator-recorded reply', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    rollup({ outreachId: o, visits: 1, responded: '2026-09-08T12:00:00.000Z' });

    const p = forDuke();
    expect(p.engagement.reply_recorded).toBe(true);
    expect(p.engagement.reply_recorded_at).toBe('2026-09-08T12:00:00.000Z');
  });

  it('reports nothing when there is no rollup row at all', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    const p = forDuke();
    expect(p.engagement).toMatchObject({
      profile_visits: 0, last_visit_at: null, best_coverage_pct: 0, reply_recorded: false,
    });
  });

  it('exposes no field that would let a caller claim an open or a click', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    rollup({ outreachId: o, visits: 2 });
    const keys = Object.keys(forDuke().engagement);
    // The vocabulary is the guarantee. No `opened`, no `clicked`, no
    // `open_count` — none of those are facts this system holds.
    for (const forbidden of ['opened', 'open_count', 'clicked', 'click_count', 'delivered', 'bounced']) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });
});

describe('the latest meaningful interaction', () => {
  const build = ({ visits = 0, lastVisit = null, responded = null, sent = null, drafted = null }) => {
    const c = coach({ name: 'A Coach', email: `a${++seq}@duke.test` });
    const o = outreach({ coachId: c, sent, drafted });
    if (sent) message({ outreachId: o, coachId: c, state: MESSAGE_STATE.ACCEPTED, sentAt: sent });
    if (visits || responded) rollup({ outreachId: o, visits, lastVisit, responded });
    return o;
  };

  it('is deterministic, and ranks what the COACH did above what we did', () => {
    // A visit last month means more than a draft this morning; sorting purely
    // by timestamp would put our own activity above theirs.
    build({ drafted: '2026-09-30T10:00:00.000Z', visits: 1, lastVisit: '2026-09-01T09:00:00.000Z' });
    expect(forDuke().last_activity_kind).toBe('profile_visit');
  });

  it('puts a recorded reply above everything', () => {
    build({
      sent: '2026-09-02T11:00:00.000Z', visits: 4, lastVisit: '2026-09-20T09:00:00.000Z',
      responded: '2026-09-03T12:00:00.000Z',
    });
    expect(forDuke().last_activity_kind).toBe('reply');
  });

  it('falls back through send and draft when the coach did nothing', () => {
    const first = build({ sent: '2026-09-02T11:00:00.000Z' });
    expect(forDuke().last_activity_kind).toBe('confirmed_send');
    db.exec(`DELETE FROM outreach_send; DELETE FROM engagement_rollup; DELETE FROM outreach;`);
    expect(first).toBeTruthy();

    build({ drafted: '2026-09-02T10:00:00.000Z' });
    expect(forDuke().last_activity_kind).toBe('draft');
  });
});

describe('origin', () => {
  it('keeps manual, campaign and unrecorded distinct', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-02T11:00:00.000Z', origin: 'manual' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-03T11:00:00.000Z', origin: 'campaign' });
    message({ outreachId: o, coachId: c, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-04T11:00:00.000Z', origin: null });

    // NULL is carried through. Inventing a value for it is exactly the
    // fabrication the column was added to prevent.
    // Sorted with null last — JS sort puts it there, and asserting the set is
    // the point rather than the order.
    expect(new Set(forDuke().origins)).toEqual(new Set(['manual', 'campaign', null]));
  });
});

describe('aggregation', () => {
  it('rolls several coaches into one programme summary', () => {
    const head = coach({ name: 'Head', email: 'h@duke.test' });
    const asst = coach({ name: 'Assistant', email: 'as@duke.test', title: 'Assistant' });
    const oh = outreach({ coachId: head, sent: '2026-09-02T11:00:00.000Z' });
    const oa = outreach({ coachId: asst, drafted: '2026-09-03T10:00:00.000Z' });
    message({ outreachId: oh, coachId: head, state: MESSAGE_STATE.ACCEPTED, sentAt: '2026-09-02T11:00:00.000Z' });
    message({ outreachId: oa, coachId: asst, state: MESSAGE_STATE.DRAFT });
    rollup({ outreachId: oh, visits: 2, lastVisit: '2026-09-05T09:00:00.000Z' });

    const p = forDuke();
    expect(p.coach_count).toBe(2);
    expect(p.has_confirmed_send).toBe(true);
    // One confirmed and one drafted is not "draft only".
    expect(p.draft_only).toBe(false);
    expect(p.engagement.profile_visits).toBe(2);
    expect(p.coaches.map((c) => c.coach_name).sort()).toEqual(['Assistant', 'Head']);
  });

  it('separates programmes and sports', () => {
    const duke = coach({ name: 'Duke Coach', email: 'd@duke.test' });
    const unc = coach({ name: 'UNC Coach', email: 'u@unc.test', school: 'North Carolina' });
    const womens = coach({ name: 'Womens Coach', email: 'w@duke.test', sport: 'womens-soccer' });
    for (const id of [duke, unc, womens]) outreach({ coachId: id, sent: '2026-09-02T11:00:00.000Z' });

    const all = contactIntelligenceForAthlete(ATHLETE);
    expect(all).toHaveLength(3);
    expect(forDuke().coach_count).toBe(1);
    expect(contactIntelligenceForProgramme({ athleteId: ATHLETE, collegeName: 'Duke', sport: 'womens-soccer' }).coach_count)
      .toBe(1);
  });

  it('is per athlete', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    outreach({ athleteId: OTHER, coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    expect(contactIntelligenceForAthlete(ATHLETE)).toEqual([]);
    expect(contactIntelligenceForAthlete(OTHER)).toHaveLength(1);
  });

  it('reports revoked outreach records without erasing the send', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z', revoked: '2026-09-05T00:00:00.000Z' });
    const p = forDuke();
    expect(p.revoked_count).toBe(1);
    expect(p.has_confirmed_send).toBe(true);
  });
});

describe('it is derived, never stored', () => {
  it('writes nothing, and touches no relationship state', () => {
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    const o = outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    rollup({ outreachId: o, visits: 2 });
    db.prepare(`
      INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, request_state,
        flagged, visibility, contact_stance, created_at, updated_at)
      VALUES (?, ?, 'Duke', 'mens-soccer', 'none', 0, 'default', 'default',
        '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z')
    `).run(randomUUID(), ATHLETE);

    const census = () => ['outreach', 'outreach_send', 'engagement_rollup', 'athlete_programmes', 'coaches']
      .map((t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);
    const before = census();
    contactIntelligenceForAthlete(ATHLETE);
    forDuke();
    expect(census()).toEqual(before);

    // Reading history does not flag a programme, and there is nowhere it could.
    const rel = db.prepare('SELECT * FROM athlete_programmes').get();
    expect(rel).toMatchObject({ flagged: 0, visibility: 'default', contact_stance: 'default', request_state: 'none' });
    const columns = db.prepare('PRAGMA table_info(athlete_programmes)').all().map((x) => x.name);
    for (const forbidden of ['contacted', 'last_contacted_at', 'engagement_score', 'opened']) {
      expect(columns, forbidden).not.toContain(forbidden);
    }
  });

  it('needs no relationship row to report history', () => {
    // The whole reason a recommendation card can show prior contact without a
    // relationship being created to say so.
    const c = coach({ name: 'A Coach', email: 'a@duke.test' });
    outreach({ coachId: c, sent: '2026-09-02T11:00:00.000Z' });
    expect(db.prepare('SELECT COUNT(*) c FROM athlete_programmes').get().c).toBe(0);
    expect(forDuke().contacted).toBe(true);
  });
});
