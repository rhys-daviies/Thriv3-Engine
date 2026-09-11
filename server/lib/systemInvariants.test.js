import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { campaignsRouter } from '../routes/campaigns.js';
import {
  upsertAthleteProgramme, updateAthleteProgramme, suppressedProgrammesForAthlete,
} from './athleteProgrammes.js';
import { visibleTop100 } from '../../shared/matching/visibleTop100.js';
import { readReserve } from '../../shared/matching/reserve.js';
import { createCampaign, listProgrammeCampaigns } from './campaigns.js';
import { manualContactDecision } from './manualOutreachSafety.js';
import { campaignContactDecision, standingProhibition } from './campaignAttribution.js';
import { programmePursuitPlan, materialiseNextContactAttempt, PURSUIT_ACTION } from './pursuitPolicy.js';
import { campaignExecutionPlan } from './campaignExecution.js';
import { historyForAthleteProgramme } from './programmeContactHistory.js';
import {
  contactIntelligenceForProgramme, priorContactForCoaches, priorContactOf,
} from './contactIntelligence.js';
import { APPROVAL_STATUS } from './firstTouchApprovals.js';
import { attemptsForProgrammeCampaign } from './contactAttempts.js';
import { suppress } from './suppressions.js';
import { UPLOADS_DIR } from './uploadPath.js';
import { MESSAGE_STATE } from '../../shared/outreachMessageState.js';

/**
 * F7 — THE WHOLE THING, AGREEING WITH ITSELF.
 *
 * Every subsystem below has its own suite and passes it. What nothing tested
 * until now is whether they tell the SAME STORY about one athlete at one
 * programme: a flag, a visibility decision, a contact stance, a history, a
 * review and a campaign sequence are six different answers to six different
 * questions, and the product is only correct while they stay six.
 *
 * ---------------------------------------------------------------------------
 * THE SEVEN THINGS THAT MUST NOT BECOME EACH OTHER
 *
 *   FLAG                relationship context. We know somebody there.
 *   VISIBILITY          whether the programme is in the actionable Top 100.
 *   CONTACT_STANCE      whether, and by which route, outreach may go out.
 *   PRIOR CONTACT       what was actually sent. A fact, not a decision.
 *   FIRST-TOUCH REVIEW  whether a person has acknowledged that fact.
 *   CAMPAIGN SEQUENCE   where THIS campaign has got to. Campaign-local.
 *   SUPPRESSION         an address opting out, globally, of everything.
 *
 * The failure this file exists to catch is any one of them quietly doing
 * another's job — a flag that hides a school, a ranking decision that silences
 * outreach, a lifetime history that advances a campaign's counter.
 * ---------------------------------------------------------------------------
 */

const ATHLETE = 'a-f7';
const OPERATOR = 'op-f7';
const TODAY = '2026-09-15';
let seq = 0;
let baseUrl;
const written = [];

beforeAll(async () => {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.operator = { id: OPERATOR, email: 'op@thriv3.test' }; next(); });
  app.use('/api', campaignsRouter);
  await new Promise((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.unref();
  });
});

afterAll(() => {
  for (const f of written) if (fs.existsSync(f)) fs.unlinkSync(f);
});

const api = async (method, url) => {
  const res = await fetch(`${baseUrl}${url}`, { method });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                     */
/* -------------------------------------------------------------------------- */

function insertAthlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, 'MIDFIELD', 'mens-soccer')
  `).run(id, id);
}

function insertOperator(id) {
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, active, created_at)
    VALUES (?, ?, 'scrypt$fake', 1, '2026-09-01T00:00:00.000Z')
  `).run(id, `${id}@thriv3.test`);
}

function college(name, { sport = 'mens-soccer', id = null } = {}) {
  const rowId = id ?? `col-${++seq}`;
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference,
      location, active)
    VALUES (?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ?, ?, 'NCAA D1', 'ACC',
      'Durham, NC', 1)
  `).run(rowId, name, sport);
  return rowId;
}

function coach({ name = 'A Coach', email, school, title = 'Head Coach', sport = 'mens-soccer' } = {}) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title)
    VALUES (?, '2026-09-01T00:00:00.000Z', ?, ?, ?, 'NCAA D1', ?, ?)
  `).run(id, name, email ?? `c${++seq}@x.edu`, school, sport, title);
  return id;
}

function outreach({ coachId, athleteId = ATHLETE, drafted = null, sent = null, revoked = null }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO outreach (id, athlete_id, coach_id, token, created_at, drafted_at, sent_at, revoked_at)
    VALUES (?, ?, ?, ?, '2026-09-01T00:00:00.000Z', ?, ?, ?)
  `).run(id, athleteId, coachId, randomUUID(), drafted, sent, revoked);
  return id;
}

function message({
  outreachId, coachId, collegeName, state = MESSAGE_STATE.ACCEPTED, sentAt = null,
  origin = 'manual', programmeCampaignId = null, athleteId = ATHLETE,
}) {
  db.prepare(`
    INSERT INTO outreach_send (id, outreach_id, sequence, drafted_at, sent_at, athlete_id, coach_id,
      college_name, sport, programme_campaign_id, origin, policy_version, state, created_at)
    VALUES (?, ?, ?, '2026-09-01T10:00:00.000Z', ?, ?, ?, ?, 'mens-soccer', ?, ?,
      'LEGACY_UNKNOWN', ?, '2026-09-01T00:00:00.000Z')
  `).run(randomUUID(), outreachId, ++seq, sentAt, athleteId, coachId, collegeName,
    programmeCampaignId, origin, state);
}

/** One accepted manual send to this coach, before any campaign existed. */
function manualHistory(coachId, collegeName, at = '2026-08-20T11:00:00.000Z') {
  const o = outreach({ coachId, sent: at });
  message({ outreachId: o, coachId, collegeName, sentAt: at });
  return o;
}

function makeCampaign({ state = 'active' } = {}) {
  db.prepare(`UPDATE campaigns SET state = 'closed', closed_at = '2026-09-01T00:00:00.000Z',
      close_reason = 'completed' WHERE athlete_id = ? AND state = 'active'`).run(ATHLETE);
  const id = `camp-${++seq}`;
  db.prepare(`
    INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at,
      snapshot_taken_at, programme_count)
    VALUES (?, ?, 'mens-soccer', ?, '2026-09-01', '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 1)
  `).run(id, ATHLETE, state);
  return id;
}

function makeProgramme(campaignId, collegeName, { tier = 'A' } = {}) {
  const id = `pc-${++seq}`;
  db.prepare(`
    INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score,
      tier, state, created_at, updated_at)
    VALUES (?, ?, ?, 'mens-soccer', ?, 82, ?, 'queued', '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z')
  `).run(id, campaignId, collegeName, ++seq, tier);
  return id;
}

/** A stored analysis of `n` ranked programmes plus `reserveCount` in the tail. */
function giveAnalysis(n = 12, reserveCount = 6) {
  const entry = (i) => ({
    id: `col-a${i}`, name: `School ${i}`, division: 'NCAA D1', conference: 'ACC',
    match_score: 200 - i,
  });
  const name = `${randomUUID()}-recommendations.json`;
  const file = path.join(UPLOADS_DIR, name);
  fs.writeFileSync(file, JSON.stringify({
    recommendations: Array.from({ length: n }, (_, i) => entry(i + 1)),
    reserve: Array.from({ length: reserveCount }, (_, i) => entry(n + i + 1)),
    summary: 'Ranked eligible programs on six weighted criteria.',
  }));
  written.push(file);
  db.prepare('UPDATE players SET recommendations = ? WHERE id = ?').run(`/uploads/${name}`, ATHLETE);
  return { file, analysis: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

/**
 * A relationship, through the domain layer rather than an INSERT — so these
 * tests exercise the same refusals the product does. The college row is made
 * first because `upsertAthleteProgramme` will not store a name without a
 * canonical id, which is the Specific Search rule doing its job.
 */
const relationshipFor = ({
  collegeName, collegeId = null, flagged = false, visibility = 'default',
  stance = 'default', requestState = 'none',
}) => {
  const id = collegeId ?? db.prepare('SELECT id FROM colleges WHERE name = ? AND sport = ?')
    .get(collegeName, 'mens-soccer')?.id ?? college(collegeName);
  return upsertAthleteProgramme(ATHLETE, {
    college_id: id,
    sport: 'mens-soccer',
    flagged,
    flag_reason: flagged ? 'her coach knows him' : null,
    visibility,
    contact_stance: stance,
    request_state: requestState,
    ...(requestState === 'requested' ? { requested_by: 'operator' } : {}),
  }, { operatorId: OPERATOR });
};

const manualAllowed = (collegeName, coachEmails = []) => manualContactDecision({
  athleteId: ATHLETE, collegeName, sport: 'mens-soccer', coachEmails,
}).allowed;

const campaignAllowed = (pc, coachId) => campaignContactDecision({
  programmeCampaignId: pc, athleteId: ATHLETE, coachId, onDate: TODAY,
}).allowed;

const attemptRows = () => db.prepare('SELECT COUNT(*) c FROM programme_contact_attempts').get().c;

beforeEach(() => {
  seq = 0;
  db.exec(`DELETE FROM campaign_first_touch_approvals; DELETE FROM programme_contact_attempts;
           DELETE FROM outreach_evidence; DELETE FROM engagement_rollup;
           DELETE FROM tracking_events; DELETE FROM outreach_send_event;
           DELETE FROM outreach_send; DELETE FROM outreach;
           DELETE FROM programme_campaigns; DELETE FROM campaigns;
           DELETE FROM athlete_programmes; DELETE FROM players; DELETE FROM coaches;
           DELETE FROM colleges; DELETE FROM operator_users; DELETE FROM suppressions;`);
  insertAthlete(ATHLETE);
  insertOperator(OPERATOR);
});

/* -------------------------------------------------------------------------- */
/* A. The relationship matrix                                                   */
/* -------------------------------------------------------------------------- */

describe('A. one relationship, four subsystems, no leakage', () => {
  /**
   * Each row asks the same four questions of one relationship state:
   * is the programme actionable, may a person write to it, may a campaign
   * write to it, and does a campaign freeze include it. The answers differ per
   * column on purpose — that difference IS the product.
   */
  function subject({ flagged = false, visibility = 'default', stance = 'default', requestState = 'none' }) {
    const name = 'Duke';
    const collegeId = college(name);
    relationshipFor({ collegeName: name, collegeId, flagged, visibility, stance, requestState });
    const head = coach({ school: name, email: 'h@duke.edu' });
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, name);
    return { name, head, campaign, pc };
  }

  const actionable = (name) => visibleTop100({
    recommendations: [{ name, match_score: 100 }, { name: 'Other', match_score: 90 }],
    reserve: [{ name: 'Reserve', match_score: 80 }],
    suppressed: new Set(suppressedProgrammesForAthlete(ATHLETE, 'mens-soccer')),
  }).programmes.map((p) => p.name);

  it('flagged + visible + default: everything open', () => {
    const { name, head, pc } = subject({ flagged: true });
    expect(actionable(name)).toContain(name);
    expect(manualAllowed(name, ['h@duke.edu'])).toBe(true);
    expect(campaignAllowed(pc, head)).toBe(true);
  });

  it('flagged + suppressed: out of the Top 100, still reachable by hand', () => {
    const { name, head, pc } = subject({ flagged: true, visibility: 'suppressed' });
    // A RANKING DECISION IS NOT A CONTACT DECISION. Very often the school was
    // removed BECAUSE somebody is handling it personally.
    expect(actionable(name)).not.toContain(name);
    expect(actionable(name)).toContain('Reserve');
    expect(manualAllowed(name, ['h@duke.edu'])).toBe(true);
    expect(campaignAllowed(pc, head)).toBe(true);
  });

  it('manual_only + visible: ranked and reachable, but not by a campaign', () => {
    const { name, head, pc } = subject({ stance: 'manual_only' });
    expect(actionable(name)).toContain(name);
    expect(manualAllowed(name, ['h@duke.edu'])).toBe(true);
    expect(campaignAllowed(pc, head)).toBe(false);
  });

  it('do_not_contact + visible: still ranked, and nobody writes', () => {
    const { name, head, pc } = subject({ stance: 'do_not_contact' });
    // Visibility says where it appears. The stance says whether to write. A
    // do-not-contact school an athlete still wants to see is coherent.
    expect(actionable(name)).toContain(name);
    expect(manualAllowed(name, ['h@duke.edu'])).toBe(false);
    expect(campaignAllowed(pc, head)).toBe(false);
  });

  it('requested + suppressed: a relationship that is not actionable', () => {
    const { name, head, pc } = subject({ requestState: 'requested', visibility: 'suppressed' });
    expect(actionable(name)).not.toContain(name);
    // Specific Schools renders relationships, not the ranked list, so the
    // request survives its own removal from the Top 100.
    const rows = db.prepare('SELECT * FROM athlete_programmes WHERE athlete_id = ?').all(ATHLETE);
    expect(rows[0]).toMatchObject({ request_state: 'requested', visibility: 'suppressed' });
    expect(manualAllowed(name, ['h@duke.edu'])).toBe(true);
    expect(campaignAllowed(pc, head)).toBe(true);
  });

  it('flagged alone never blocks anything', () => {
    const { name, head, pc } = subject({ flagged: true, requestState: 'requested' });
    expect(manualAllowed(name, ['h@duke.edu'])).toBe(true);
    expect(campaignAllowed(pc, head)).toBe(true);
    expect(actionable(name)).toContain(name);
  });
});

describe('A. changing one field changes one field', () => {
  function existing() {
    const collegeId = college('Duke');
    const { programme } = relationshipFor({
      collegeName: 'Duke', collegeId, flagged: true, visibility: 'suppressed', stance: 'manual_only',
    });
    return programme;
  }

  it('unflagging does not restore visibility', () => {
    const row = existing();
    const after = updateAthleteProgramme(ATHLETE, row.id, { flagged: false }, { operatorId: OPERATOR });
    // Two decisions, taken separately, undone separately. Restoring the
    // ranking because somebody removed a note would be the system deciding
    // something nobody asked it to.
    expect(after.flagged).toBeFalsy();
    expect(after.visibility).toBe('suppressed');
    expect(after.contact_stance).toBe('manual_only');
  });

  it('restoring visibility does not touch the flag or the stance', () => {
    const row = existing();
    const after = updateAthleteProgramme(ATHLETE, row.id, { visibility: 'default' }, { operatorId: OPERATOR });
    expect(after.visibility).toBe('default');
    expect(after.flagged).toBeTruthy();
    expect(after.contact_stance).toBe('manual_only');
  });

  it('changing a stance does not move a programme in or out of the Top 100', () => {
    const row = existing();
    const before = suppressedProgrammesForAthlete(ATHLETE, 'mens-soccer');
    updateAthleteProgramme(ATHLETE, row.id, { contact_stance: 'do_not_contact' }, { operatorId: OPERATOR });
    expect(suppressedProgrammesForAthlete(ATHLETE, 'mens-soccer')).toEqual(before);
  });

  it('writes nothing to the global suppression list, ever', () => {
    const row = existing();
    updateAthleteProgramme(ATHLETE, row.id, { contact_stance: 'do_not_contact' }, { operatorId: OPERATOR });
    // `suppressions` is keyed on an address with no athlete column. One
    // athlete's decision must never become every athlete's.
    expect(db.prepare('SELECT COUNT(*) c FROM suppressions').get().c).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* B. Top 100 and reserve                                                       */
/* -------------------------------------------------------------------------- */

describe('B. the ranked list is read, never rewritten', () => {
  it('promotes reserve entries in the model’s own order, keeping source ranks', () => {
    const { analysis } = giveAnalysis(12, 6);
    for (const name of ['School 2', 'School 5', 'School 9']) {
      college(name);
      relationshipFor({ collegeName: name, visibility: 'suppressed' });
    }

    const derived = visibleTop100({
      recommendations: analysis.recommendations,
      reserve: readReserve(analysis),
      suppressed: new Set(suppressedProgrammesForAthlete(ATHLETE, 'mens-soccer')),
    });

    expect(derived.programmes).toHaveLength(12);
    expect(derived.suppressedCount).toBe(3);
    expect(derived.programmes.map((p) => p.name)).not.toContain('School 5');
    // The tail enters in rank order, and each promoted entry remembers where
    // the model actually put it.
    expect(derived.promoted.map((p) => p.name)).toEqual(['School 13', 'School 14', 'School 15']);
    /**
     * SOURCE RANK IS THE RESERVE BAND, and the band begins at 101 because
     * `splitRanked` only produces a reserve for an analysis that filled the
     * hundred. A promoted entry therefore remembers a rank no actionable list
     * ever shows — which is the point: the campaign records the ACTIONABLE
     * position, and this records where the model actually put it.
     */
    expect(derived.programmes.filter((p) => p.promoted).map((p) => p.source_rank))
      .toEqual([101, 102, 103]);
    expect(derived.exhausted).toBe(false);
  });

  it('says so rather than manufacturing schools when the reserve runs out', () => {
    const { analysis } = giveAnalysis(6, 1);
    for (const name of ['School 1', 'School 2', 'School 3']) {
      relationshipFor({ collegeName: name, visibility: 'suppressed' });
    }
    const derived = visibleTop100({
      recommendations: analysis.recommendations,
      reserve: readReserve(analysis),
      suppressed: new Set(suppressedProgrammesForAthlete(ATHLETE, 'mens-soccer')),
    });

    expect(derived.programmes).toHaveLength(4);
    expect(derived.exhausted).toBe(true);
    expect(derived.shortfall).toBe(2);
  });

  it('leaves the stored analysis byte-identical', () => {
    const { file, analysis } = giveAnalysis(12, 6);
    const before = fs.readFileSync(file, 'utf8');
    relationshipFor({ collegeName: 'School 3', visibility: 'suppressed' });
    visibleTop100({
      recommendations: analysis.recommendations,
      reserve: readReserve(analysis),
      suppressed: new Set(suppressedProgrammesForAthlete(ATHLETE, 'mens-soccer')),
    });
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('freezes a campaign over the actionable set, not the raw one', () => {
    giveAnalysis(12, 6);
    relationshipFor({ collegeName: 'School 4', visibility: 'suppressed' });
    const { campaign } = createCampaign(ATHLETE, { startsOn: '2026-09-01' });
    const frozen = listProgrammeCampaigns(campaign.id);
    const names = frozen.map((p) => p.college_name);

    expect(names).not.toContain('School 4');
    expect(names).toContain('School 13');
    expect(names).toHaveLength(12);
    // Ranks are the ACTIONABLE positions and stay contiguous from 1.
    expect(frozen.map((p) => p.rank)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it('does not include a do-not-contact or manual-only programme differently', () => {
    giveAnalysis(6, 2);
    relationshipFor({ collegeName: 'School 2', stance: 'do_not_contact' });
    relationshipFor({ collegeName: 'School 3', stance: 'manual_only' });
    const { campaign } = createCampaign(ATHLETE, { startsOn: '2026-09-01' });

    // A stance is evaluated when something tries to send, against the stance
    // in force THEN. Freezing it into an immutable snapshot would go stale in
    // both directions.
    const names = listProgrammeCampaigns(campaign.id).map((p) => p.college_name);
    expect(names).toContain('School 2');
    expect(names).toContain('School 3');
  });
});

/* -------------------------------------------------------------------------- */
/* F. One history, three readers                                                */
/* -------------------------------------------------------------------------- */

describe('F. every reader of history tells the same story', () => {
  function scene() {
    const name = 'Duke';
    college(name);
    const head = coach({ school: name, email: 'h@duke.edu' });
    return { name, head };
  }

  const readers = (name, head) => {
    // F4 answers per coach relationship; F5 and F6c aggregate per programme.
    const [f4 = {}] = historyForAthleteProgramme({
      athleteId: ATHLETE, collegeName: name, sport: 'mens-soccer',
    });
    const f5 = contactIntelligenceForProgramme({ athleteId: ATHLETE, collegeName: name, sport: 'mens-soccer' });
    const f6 = priorContactOf(priorContactForCoaches({ athleteId: ATHLETE, coachIds: [head] }), head);
    return { f4, f5, f6 };
  };

  it('agrees that an accepted send is contact', () => {
    const { name, head } = scene();
    manualHistory(head, name);
    const { f4, f5, f6 } = readers(name, head);

    expect(f4.has_confirmed_send).toBe(true);
    expect(f5.has_confirmed_send).toBe(true);
    expect(f6.hasConfirmedSend).toBe(true);
    expect(f5.confirmed_send_count).toBe(f6.confirmedSendCount);
  });

  it('agrees that a draft is not', () => {
    const { name, head } = scene();
    const o = outreach({ coachId: head, drafted: '2026-08-20T10:00:00.000Z' });
    message({ outreachId: o, coachId: head, collegeName: name, state: MESSAGE_STATE.DRAFT });
    const { f4, f5, f6 } = readers(name, head);

    expect(f4.has_confirmed_send).toBe(false);
    expect(f5.draft_only).toBe(true);
    expect(f6.hasConfirmedSend).toBe(false);
  });

  it('agrees that a failed send is not', () => {
    const { name, head } = scene();
    const o = outreach({ coachId: head, drafted: '2026-08-20T10:00:00.000Z' });
    message({ outreachId: o, coachId: head, collegeName: name, state: MESSAGE_STATE.FAILED });
    expect(readers(name, head).f6.hasConfirmedSend).toBe(false);
  });

  it('agrees about a legacy relationship with no message rows', () => {
    const { name, head } = scene();
    outreach({ coachId: head, sent: '2025-04-02T11:00:00.000Z' });
    const { f4, f5, f6 } = readers(name, head);

    // Confirmed by `outreach.sent_at` alone, with a count of zero beside it —
    // one fact and one absence, and all three readers say the same thing.
    expect([f4.has_confirmed_send, f5.has_confirmed_send, f6.hasConfirmedSend])
      .toEqual([true, true, true]);
    expect([f4.accepted_count, f5.confirmed_send_count, f6.confirmedSendCount]).toEqual([0, 0, 0]);
  });

  it('agrees that revocation does not unsend a message', () => {
    const { name, head } = scene();
    const o = outreach({ coachId: head, sent: '2026-08-20T11:00:00.000Z', revoked: '2026-09-01T00:00:00.000Z' });
    message({ outreachId: o, coachId: head, collegeName: name, sentAt: '2026-08-20T11:00:00.000Z' });
    const { f4, f5, f6 } = readers(name, head);

    expect([f4.has_confirmed_send, f5.has_confirmed_send, f6.hasConfirmedSend])
      .toEqual([true, true, true]);
    expect(f5.revoked_count).toBe(1);
  });

  it('keeps origins truthful and identically ordered', () => {
    const { name, head } = scene();
    const o = outreach({ coachId: head, sent: '2026-08-20T11:00:00.000Z' });
    message({ outreachId: o, coachId: head, collegeName: name, sentAt: '2026-08-20T11:00:00.000Z', origin: 'manual' });
    message({ outreachId: o, coachId: head, collegeName: name, sentAt: '2026-08-21T11:00:00.000Z', origin: 'campaign' });
    message({ outreachId: o, coachId: head, collegeName: name, sentAt: '2026-08-22T11:00:00.000Z', origin: null });

    const { f5, f6 } = readers(name, head);
    expect(f6.origins).toEqual(['campaign', 'manual', null]);
    expect([...f5.origins].sort((a, b) => String(a).localeCompare(String(b))))
      .toEqual(expect.arrayContaining(['campaign', 'manual', null]));
  });

  it('never claims a delivery, an open or a reply nobody recorded', () => {
    const { name, head } = scene();
    manualHistory(head, name);
    const serialised = JSON.stringify({
      ...readers(name, head),
      intelligence: contactIntelligenceForProgramme({
        athleteId: ATHLETE, collegeName: name, sport: 'mens-soccer',
      }),
    });
    /**
     * The words this build has not earned. `relationship_opened_at` is
     * deliberately not among them and is deliberately prefixed: it is when the
     * RELATIONSHIP was opened, which is a row being created, and the prefix is
     * what stops it reading as an email open.
     */
    for (const claim of [/email_opened/i, /\bopened_at\b/i, /open_count/i, /delivered/i,
      /bounced/i, /clicked/i, /\bread_at\b/i, /coach_(viewed|opened|read)/i]) {
      expect(serialised, String(claim)).not.toMatch(claim);
    }
    // And the one word it HAS earned, where an operator would see it.
    expect(serialised).toMatch(/qualified_visits|profile_visits/);
  });
});

/* -------------------------------------------------------------------------- */
/* H. Lifetime history never moves a campaign's counter                         */
/* -------------------------------------------------------------------------- */

describe('H. sequence and history are counted separately', () => {
  function campaignAt(name) {
    college(name);
    const head = coach({ school: name, email: 'h@duke.edu' });
    const campaign = makeCampaign();
    return { head, campaign, pc: makeProgramme(campaign, name) };
  }

  it('manual history: prior contact true, still this campaign’s step 1', () => {
    const { head, pc } = campaignAt('Duke');
    manualHistory(head, 'Duke');
    const plan = programmePursuitPlan({ programmeCampaignId: pc });

    expect(plan.current.priorContact.hasConfirmedSend).toBe(true);
    expect(plan.current.messagesSent).toBe(0);
    expect(plan.step).toBe(1);
    expect(plan.nextAction).toBe(PURSUIT_ACTION.INITIAL_OUTREACH);
  });

  it('an old campaign: the same, and the new campaign starts clean', () => {
    const { head, pc } = campaignAt('Duke');
    const old = makeCampaign();
    const pcOld = makeProgramme(old, 'Duke');
    const o = outreach({ coachId: head, sent: '2026-08-20T11:00:00.000Z' });
    message({
      outreachId: o, coachId: head, collegeName: 'Duke', sentAt: '2026-08-20T11:00:00.000Z',
      origin: 'campaign', programmeCampaignId: pcOld,
    });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.current.priorContact.hasConfirmedSend).toBe(true);
    expect(plan.current.messagesSent).toBe(0);
    expect(plan.step).toBe(1);
  });

  it('this campaign’s own step 1: both counters move, and differently', () => {
    const { head, pc } = campaignAt('Duke');
    const o = outreach({ coachId: head, sent: '2026-09-05T11:00:00.000Z' });
    message({
      outreachId: o, coachId: head, collegeName: 'Duke', sentAt: '2026-09-05T11:00:00.000Z',
      origin: 'campaign', programmeCampaignId: pc,
    });

    const plan = programmePursuitPlan({ programmeCampaignId: pc });
    expect(plan.current.priorContact.hasConfirmedSend).toBe(true);
    expect(plan.current.messagesSent).toBe(1);
    expect(plan.step).toBe(2);
    expect(plan.nextAction).toBe(PURSUIT_ACTION.FOLLOW_UP);
    // And a follow-up is never held on evidence of its own first message.
    expect(plan.firstTouchReview.required).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* J/K/O. The write boundary is the authority                                   */
/* -------------------------------------------------------------------------- */

describe('J/K/O. nothing decided earlier survives a change made since', () => {
  async function approvedFirstTouch() {
    const name = 'Duke';
    college(name);
    const head = coach({ school: name, email: 'h@duke.edu' });
    manualHistory(head, name);
    const campaign = makeCampaign();
    const pc = makeProgramme(campaign, name);
    const res = await api(
      'POST',
      `/api/programme-campaigns/${pc}/coaches/${head}/first-touch-approval`,
    );
    expect(res.status).toBe(200);
    return { name, head, campaign, pc };
  }

  it('re-reads the stance at the write, not from the dry run', async () => {
    const { name, campaign, pc } = await approvedFirstTouch();
    const out = campaignExecutionPlan(campaign, { onDate: TODAY });
    expect(out.programmes[0].executableNow).toBe(true);

    /**
     * THE RACE THIS FILE EXISTS FOR. An operator reads a plan that says
     * executable, somebody sets the stance, and the write happens afterwards.
     * The plan an earlier read produced must count for nothing.
     */
    relationshipFor({ collegeName: name, stance: 'do_not_contact' });

    const materialised = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(materialised.created).toBe(false);
    expect(materialised.prohibition.reason).toBe('RELATIONSHIP_DO_NOT_CONTACT');
    expect(attemptRows()).toBe(0);
  });

  it('re-reads the review at the write, so a new send re-holds it', async () => {
    const { name, head, pc } = await approvedFirstTouch();
    expect(programmePursuitPlan({ programmeCampaignId: pc }).firstTouchReview.required).toBe(false);

    // A second confirmed send arrives after the approval was given.
    const o = db.prepare('SELECT id FROM outreach WHERE coach_id = ?').get(head);
    message({
      outreachId: o.id, coachId: head, collegeName: name, sentAt: '2026-09-14T11:00:00.000Z',
    });

    const materialised = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(materialised.created).toBe(false);
    expect(materialised.review.approval.status).toBe(APPROVAL_STATUS.STALE);
    expect(attemptRows()).toBe(0);
  });

  it('re-reads the campaign lifecycle at the write', async () => {
    const { campaign, pc } = await approvedFirstTouch();
    db.prepare("UPDATE campaigns SET state = 'closed', closed_at = '2026-09-16T00:00:00.000Z', close_reason = 'completed' WHERE id = ?")
      .run(campaign);
    expect(materialiseNextContactAttempt({ programmeCampaignId: pc }).created).toBe(false);
    expect(attemptRows()).toBe(0);
  });

  it('re-reads global suppression at the write', async () => {
    const { pc } = await approvedFirstTouch();
    suppress({ email: 'h@duke.edu' });
    expect(materialiseNextContactAttempt({ programmeCampaignId: pc }).created).toBe(false);
    expect(attemptRows()).toBe(0);
  });

  it('approves, then materialises, when nothing has changed', async () => {
    const { pc, head } = await approvedFirstTouch();
    const out = materialiseNextContactAttempt({ programmeCampaignId: pc });
    expect(out.created).toBe(true);
    expect(out.attempt.coach_id).toBe(head);
    expect(attemptsForProgrammeCampaign(pc)).toHaveLength(1);
  });

  it('creates nothing from any amount of reading', async () => {
    const { name, head, campaign, pc } = await approvedFirstTouch();
    for (let i = 0; i < 3; i += 1) {
      campaignExecutionPlan(campaign, { onDate: TODAY });
      programmePursuitPlan({ programmeCampaignId: pc });
      contactIntelligenceForProgramme({ athleteId: ATHLETE, collegeName: name, sport: 'mens-soccer' });
      historyForAthleteProgramme({ athleteId: ATHLETE, collegeName: name, sport: 'mens-soccer' });
      standingProhibition({ programmeCampaignId: pc, athleteId: ATHLETE, coachId: head });
    }
    expect(attemptRows()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM outreach').get().c).toBe(1);
    expect(db.prepare('SELECT COUNT(*) c FROM athlete_programmes').get().c).toBe(0);
  });
});
