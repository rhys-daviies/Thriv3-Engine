import { describe, it, expect, beforeAll } from 'vitest';
import db from '../db/client.js';
import {
  recruitmentYearDecision, rosterSeasonProof, programmeSeasonForEntry, entrySeasonOf,
  recordRecruitmentCycleAuthorisation, revokeRecruitmentCycleAuthorisation, recordProgrammeSeasonFielding,
  recordGateDecision, fieldingReviewQueue,
  GATE_CODE, GATE_OUTCOME, EVIDENCE_BASIS, RECIPIENT, BOUNDARY,
  CURRENT_PROGRAMME_SEASON, CONTINUITY_SEASONS, TURNOVER_MAX_OVERLAP, ROSTER_MIN_PLAYERS,
} from './recruitmentYearGate.js';

/**
 * DI-08 PHASE 2 — THE RECRUITMENT-YEAR GATE, decision by decision, on a throwaway in-memory
 * database. The two real cases DI-07 P4 §d found are rebuilt from their recorded facts (not from
 * the live database, and not relying on PR 90's activation holds): Eastern New Mexico men's (its
 * "2025" roster is a season-less copy of 2024; nothing for 2026) and Wisconsin-Oshkosh men's
 * (programme_status FUTURE / LAUNCHING from 2027; a current head coach on the official staff page).
 */

const NOW = new Date('2026-10-10T00:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const daysAhead = (n) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const T = '2026-09-01T00:00:00.000Z';
let n = 0;

function college(name, { active = 1, sport = 'mens-soccer', entity = null } = {}) {
  const id = `col-${++n}`;
  db.prepare('INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, athletics_entity_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, T, T, name, sport, 'NCAA D2', active, entity);
  return id;
}
function roster(name, season, players, { pageSeason = null, url = null, sport = 'mens-soccer', label = () => null } = {}) {
  players.forEach((p, i) => {
    db.prepare(`INSERT INTO roster_players (id, created_date, updated_date, college_name, sport, division, season, player_name, class_year_label, source_roster_url, source_page_season)
      VALUES (?, ?, ?, ?, ?, 'NCAA D2', ?, ?, ?, ?, ?)`).run(`rp-${++n}`, T, T, name, sport, String(season), p, label(i), url, pageSeason);
  });
}
/** k distinct, letters-only names (the gate compares names normalised to letters). */
const alpha = (i) => String.fromCharCode(97 + Math.floor(i / 26) % 26) + String.fromCharCode(97 + (i % 26));
const squad = (prefix, k = 25) => Array.from({ length: k }, (_, i) => `${prefix.replace(/[^A-Za-z]/g, '')}${alpha([...prefix].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 7)} Player${alpha(i)}`);
function coach(school, { id = `coach-${++n}`, currentness = 'CURRENT', host = 'example.edu', sport = 'mens-soccer' } = {}) {
  db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, email_source_url, currentness_status, currentness_source_url)
    VALUES (?, ?, ?, ?, ?, 'NCAA D2', ?, 'Head Coach', 'verified', ?, ?, ?)`)
    .run(id, T, `Coach ${id}`, `${id}@${host}`, school, sport, `https://${host}/sports/mens-soccer/coaches`, currentness, `https://${host}/sports/mens-soccer/coaches`);
  return id;
}
function athlete(year, { id = `ath-${++n}`, grad = null } = {}) {
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport, recruiting_class_year, graduation_year)
    VALUES (?, 'x', 'x', 'A Recruit', 'Defender', 'mens-soccer', ?, ?)`).run(id, year, grad);
  return db.prepare('SELECT * FROM players WHERE id = ?').get(id);
}
function status(school, s, reason, { from = null, to = null, url = 'https://official.example/' } = {}) {
  db.prepare(`INSERT INTO programme_status (school, sport, status, reason, active_from_season, active_to_season, evidence, source_url, recorded_at)
    VALUES (?, 'mens-soccer', ?, ?, ?, ?, 'fixture evidence', ?, ?)`).run(school, s, reason, from, to, url, T);
}
const decide = (a, school, recipient, opts = {}) => recruitmentYearDecision({ athlete: a, collegeName: school, sport: 'mens-soccer', recipient }, { handle: db, now: NOW, ...opts });
const asCoach = (coachId) => ({ kind: RECIPIENT.COACH, coachId });

/** A programme verified as fielded in the current season by a page-season roster. */
function fieldedProgramme(name, opts = {}) {
  college(name, opts);
  roster(name, CURRENT_PROGRAMME_SEASON, squad(name), { pageSeason: String(CURRENT_PROGRAMME_SEASON) });
  return coach(name, opts);
}

describe('the three years are distinct and explicit', () => {
  it('entry year Y maps to programme season Y (the autumn the athlete arrives)', () => {
    expect(programmeSeasonForEntry(2027)).toBe(2027);
    expect(programmeSeasonForEntry(null)).toBeNull();
    expect(programmeSeasonForEntry('soon')).toBeNull();
  });
  it('the entry year is recruiting_class_year, falling back to graduation_year exactly as shared/athlete.js does', () => {
    expect(entrySeasonOf({ recruiting_class_year: 2027, graduation_year: 2026 })).toBe(2027);
    expect(entrySeasonOf({ recruiting_class_year: null, graduation_year: 2028 })).toBe(2028);
    expect(entrySeasonOf({})).toBeNull();
  });
  it('the policy constants are what GATE.md documents', () => {
    expect(CURRENT_PROGRAMME_SEASON).toBe(2026);
    expect(CONTINUITY_SEASONS).toBe(2);
    expect(TURNOVER_MAX_OVERLAP).toBe(0.85);
    expect(ROSTER_MIN_PLAYERS).toBe(11);
  });
});

describe('Eastern New Mexico men\'s (DI-07 P4 §c): a programme frozen at 2024 with a phantom 2025 copy', () => {
  let coachId; let a26; let a27;
  beforeAll(() => {
    college('Eastern New Mexico');
    college('Eastern New Mexico', { sport: 'womens-soccer' });
    const squad24 = squad('ENMU24', 32);
    roster('Eastern New Mexico', 2024, squad24, { url: 'https://goeasternathletics.com/sports/mens-soccer/roster/2024' });
    // the 2025 rows: the same 32 people from the bare, season-less URL
    roster('Eastern New Mexico', 2025, squad24, { url: 'https://goeasternathletics.com/sports/mens-soccer/roster' });
    db.prepare(`INSERT INTO roster_season_trust (season, college_name, sport, diagnosis, disposition) VALUES ('2025', 'Eastern New Mexico', 'mens-soccer', 'PROBABLE_DUPLICATE_CAPTURE', 'RETAIN')`).run();
    // the phantom 2026 coach season (read from a page serving 2024) is NOT fielding evidence
    db.prepare("INSERT INTO coach_seasons (school, sport, season, coach_name, method, imported_at) VALUES ('Eastern New Mexico', 'mens-soccer', 2026, 'Coach X', 'roster-live', ?)").run(T);
    // the women's programme IS fielded in 2026; it must not lend the men's programme its evidence
    roster('Eastern New Mexico', 2026, squad('ENMUW'), { pageSeason: '2026', sport: 'womens-soccer' });
    coachId = coach('Eastern New Mexico', { id: '2aeeace0-fixture', host: 'goeasternathletics.com' });
    a26 = athlete(2026); a27 = athlete(2027);
  });

  it('2026 entry: BLOCKED — no season-verified evidence that the men\'s team plays 2026; a review is requested', () => {
    const d = decide(a26, 'Eastern New Mexico', asCoach(coachId));
    expect(d).toMatchObject({ outcome: GATE_OUTCOME.BLOCK, allowed: false, code: GATE_CODE.FIELDING_UNKNOWN, reviewRequested: true, entrySeason: 2026, programmeSeason: 2026 });
    expect(d.detail.evidence.roster).toMatchObject({ verified: false, players: 0 });
  });
  it('2027 entry: BLOCKED too — continuity needs a verified current season, and the 2025 copy is not one', () => {
    expect(decide(a27, 'Eastern New Mexico', asCoach(coachId)).code).toBe(GATE_CODE.FIELDING_UNKNOWN);
  });
  it('a season-less copy promoted as 2026 (100% of the prior squad) is not a current team', () => {
    roster('Eastern New Mexico', 2026, squad('ENMU24', 32), { url: 'https://goeasternathletics.com/sports/mens-soccer/roster/2026' });
    const proof = rosterSeasonProof(['Eastern New Mexico'], 'mens-soccer', 2026, { handle: db });
    expect(proof).toMatchObject({ verified: false, overlap: 1 });
    expect(decide(a26, 'Eastern New Mexico', asCoach(coachId)).code).toBe(GATE_CODE.FIELDING_UNKNOWN);
    db.exec("DELETE FROM roster_players WHERE college_name = 'Eastern New Mexico' AND sport = 'mens-soccer' AND season = '2026'");
  });
  it('once DI-06\'s status is recorded (NOT_ACTIVE through 2024) the refusal is decisive: PROGRAMME_NOT_FIELDED', () => {
    status('Eastern New Mexico', 'NOT_ACTIVE', 'NOT_SPONSORED', { to: 2024, url: 'https://goeasternathletics.com/' });
    const d = decide(a26, 'Eastern New Mexico', asCoach(coachId));
    expect(d).toMatchObject({ code: GATE_CODE.PROGRAMME_NOT_FIELDED, reviewRequested: false });
    expect(decide(a27, 'Eastern New Mexico', asCoach(coachId)).code).toBe(GATE_CODE.PROGRAMME_NOT_FIELDED);
  });
});

describe('Wisconsin-Oshkosh men\'s (DI-07 P4 §d): FUTURE / LAUNCHING from 2027, a current hire on the staff page', () => {
  const HOST = 'uwoshkoshtitans.com';
  let coachId; let other; let a26; let a27; let a28; let otherAthlete;
  const auth = (overrides = {}) => recordRecruitmentCycleAuthorisation({
    athleteId: a27.id, collegeName: 'Wisconsin-Oshkosh', sport: 'mens-soccer', entrySeason: 2027,
    recipient: { kind: RECIPIENT.COACH, coachId }, consultantOperatorId: 'op-consultant-1',
    programmeEvidenceUrl: `https://${HOST}/sports/mens-soccer/roster`, programmeEvidenceVerifiedAt: daysAgo(2),
    staffEvidenceUrl: `https://${HOST}/sports/mens-soccer/coaches`, staffEvidenceVerifiedAt: daysAgo(2),
    expiresAt: daysAhead(60), ...overrides,
  }, { handle: db, now: NOW });
  const insertAuth = (o) => {
    const id = `RCA-raw-${++n}`;
    db.prepare(`INSERT INTO recruitment_cycle_authorisations (authorisation_id, athlete_id, college_name, sport, entry_season, recipient_kind, coach_id, programme_contact_id,
        consultant_operator_id, programme_evidence_url, programme_evidence_verified_at, staff_evidence_url, staff_evidence_verified_at, expires_at, created_at)
      VALUES (@id, @athlete, 'Wisconsin-Oshkosh', 'mens-soccer', @season, 'COACH', @coach, NULL, 'op-consultant-1', @purl, @pv, @surl, @sv, @exp, @created)`)
      .run({ id, athlete: a27.id, season: 2027, coach: coachId, purl: `https://${HOST}/sports/mens-soccer/roster`, pv: daysAgo(2), surl: `https://${HOST}/sports/mens-soccer/coaches`, sv: daysAgo(2), exp: daysAhead(60), created: daysAgo(3), ...o });
    return id;
  };
  beforeAll(() => {
    college('Wisconsin-Oshkosh');
    status('Wisconsin-Oshkosh', 'FUTURE', 'LAUNCHING', { from: 2027, url: `https://${HOST}/sports/mens-soccer/roster` });
    coachId = coach('Wisconsin-Oshkosh', { id: '9188175f-fixture', host: HOST });
    other = coach('Wisconsin-Oshkosh', { id: 'uwo-assistant', host: HOST });
    a26 = athlete(2026); a27 = athlete(2027); a28 = athlete(2028); otherAthlete = athlete(2027);
  });

  it('2026 entry: BLOCKED — the programme does not field a 2026 team (PROGRAMME_NOT_FIELDED)', () => {
    expect(decide(a26, 'Wisconsin-Oshkosh', asCoach(coachId))).toMatchObject({ code: GATE_CODE.PROGRAMME_NOT_FIELDED, allowed: false });
  });
  it('2027 entry with no explicit authorisation: BLOCKED (a future launch is never read as recruitment intent)', () => {
    expect(decide(a27, 'Wisconsin-Oshkosh', asCoach(coachId))).toMatchObject({ code: GATE_CODE.FUTURE_PROGRAMME_NOT_AUTHORISED, allowed: false, reviewRequested: false });
  });
  it('2027 entry WITH a valid authorisation for this athlete, programme, season and coach: CONDITIONAL_ALLOW', () => {
    const id = auth();
    const d = decide(a27, 'Wisconsin-Oshkosh', asCoach(coachId));
    expect(d).toMatchObject({ outcome: GATE_OUTCOME.CONDITIONAL_ALLOW, allowed: true, code: GATE_CODE.FUTURE_PROGRAMME_AUTHORISED, authorisationId: id, evidenceBasis: EVIDENCE_BASIS.AUTHORISATION });
    // ...and it opens exactly that: not another athlete, not another entry season, not another recipient
    expect(decide(otherAthlete, 'Wisconsin-Oshkosh', asCoach(coachId)).code).toBe(GATE_CODE.FUTURE_PROGRAMME_NOT_AUTHORISED);
    expect(decide(a28, 'Wisconsin-Oshkosh', asCoach(coachId)).code).toBe(GATE_CODE.FUTURE_PROGRAMME_NOT_AUTHORISED);
    expect(decide(a27, 'Wisconsin-Oshkosh', asCoach(other)).code).toBe(GATE_CODE.FUTURE_PROGRAMME_NOT_AUTHORISED);
    // and an authorisation never lifts the 2026 refusal
    expect(decide(a26, 'Wisconsin-Oshkosh', asCoach(coachId)).code).toBe(GATE_CODE.PROGRAMME_NOT_FIELDED);
    revokeRecruitmentCycleAuthorisation(id, { operatorId: 'op-consultant-1', reason: 'test' }, { handle: db, now: NOW });
    expect(decide(a27, 'Wisconsin-Oshkosh', asCoach(coachId)).code).toBe(GATE_CODE.FUTURE_PROGRAMME_NOT_AUTHORISED);
  });
  it('an expired authorisation, or one whose official evidence is stale, is BLOCKED', () => {
    const expired = insertAuth({ exp: daysAgo(1), created: daysAgo(10) });
    expect(decide(a27, 'Wisconsin-Oshkosh', asCoach(coachId)).code).toBe(GATE_CODE.AUTHORISATION_EXPIRED);
    revokeRecruitmentCycleAuthorisation(expired, { operatorId: 'op', reason: 'cleanup' }, { handle: db, now: NOW });
    const stale = insertAuth({ pv: daysAgo(45) });
    expect(decide(a27, 'Wisconsin-Oshkosh', asCoach(coachId)).code).toBe(GATE_CODE.AUTHORISATION_EVIDENCE_STALE);
    revokeRecruitmentCycleAuthorisation(stale, { operatorId: 'op', reason: 'cleanup' }, { handle: db, now: NOW });
    const future = insertAuth({ sv: daysAhead(1) });
    expect(decide(a27, 'Wisconsin-Oshkosh', asCoach(coachId)).code).toBe(GATE_CODE.AUTHORISATION_EVIDENCE_STALE);
    revokeRecruitmentCycleAuthorisation(future, { operatorId: 'op', reason: 'cleanup' }, { handle: db, now: NOW });
  });
  it('programme evidence that is not on the host that recorded the launch is not official: BLOCKED', () => {
    const id = insertAuth({ purl: 'https://some-blog.example/oshkosh-soccer' });
    expect(decide(a27, 'Wisconsin-Oshkosh', asCoach(coachId)).code).toBe(GATE_CODE.AUTHORISATION_EVIDENCE_NOT_OFFICIAL);
    revokeRecruitmentCycleAuthorisation(id, { operatorId: 'op', reason: 'cleanup' }, { handle: db, now: NOW });
  });
  it('unverified coach affiliation is BLOCKED: staff evidence off the official host, or the coach not CURRENT', () => {
    const offHost = insertAuth({ surl: 'https://linkedin.example/in/coach' });
    expect(decide(a27, 'Wisconsin-Oshkosh', asCoach(coachId)).code).toBe(GATE_CODE.RECIPIENT_AFFILIATION_UNVERIFIED);
    revokeRecruitmentCycleAuthorisation(offHost, { operatorId: 'op', reason: 'cleanup' }, { handle: db, now: NOW });
    const ok = auth();
    db.prepare("UPDATE coaches SET currentness_status = NULL WHERE id = ?").run(coachId);
    expect(decide(a27, 'Wisconsin-Oshkosh', asCoach(coachId)).code).toBe(GATE_CODE.RECIPIENT_AFFILIATION_UNVERIFIED);
    db.prepare("UPDATE coaches SET currentness_status = 'PROVEN_STALE' WHERE id = ?").run(coachId);
    expect(decide(a27, 'Wisconsin-Oshkosh', asCoach(coachId)).code).toBe(GATE_CODE.RECIPIENT_NOT_AFFILIATED);
    db.prepare("UPDATE coaches SET currentness_status = 'CURRENT' WHERE id = ?").run(coachId);
    expect(decide(a27, 'Wisconsin-Oshkosh', asCoach(coachId)).allowed).toBe(true);
    revokeRecruitmentCycleAuthorisation(ok, { operatorId: 'op', reason: 'cleanup' }, { handle: db, now: NOW });
  });
  it('the writer refuses an authorisation the gate would not honour', () => {
    expect(() => auth({ entrySeason: 2028 })).toThrow(/entry year is 2027/);
    expect(() => auth({ programmeEvidenceVerifiedAt: daysAgo(31) })).toThrow(/within 30 days/);
    expect(() => auth({ expiresAt: daysAhead(400) })).toThrow(/next 180 days/);
    expect(() => auth({ consultantOperatorId: ' ' })).toThrow(/consultant/);
    expect(() => auth({ programmeEvidenceUrl: 'http://uwoshkoshtitans.com/x' })).toThrow(/https/);
    expect(() => recordRecruitmentCycleAuthorisation({
      athleteId: a27.id, collegeName: 'Eastern New Mexico', sport: 'mens-soccer', entrySeason: 2027, recipient: { kind: RECIPIENT.COACH, coachId: 'x' },
      consultantOperatorId: 'op', programmeEvidenceUrl: 'https://a.example/', programmeEvidenceVerifiedAt: daysAgo(1), staffEvidenceUrl: 'https://a.example/', staffEvidenceVerifiedAt: daysAgo(1), expiresAt: daysAhead(10),
    }, { handle: db, now: NOW })).toThrow(/only for a FUTURE programme/);
  });
  it('an authorisation is revoked, never edited or deleted', () => {
    const id = auth();
    expect(() => db.prepare('UPDATE recruitment_cycle_authorisations SET entry_season = 2028 WHERE authorisation_id = ?').run(id)).toThrow(/only be revoked/);
    expect(() => db.prepare('DELETE FROM recruitment_cycle_authorisations WHERE authorisation_id = ?').run(id)).toThrow(/never deleted/);
    expect(revokeRecruitmentCycleAuthorisation(id, { operatorId: 'op', reason: 'done' }, { handle: db, now: NOW })).toBe(true);
    expect(() => db.prepare("UPDATE recruitment_cycle_authorisations SET revoked_at = NULL WHERE authorisation_id = ?").run(id)).toThrow(/only be revoked/);
  });
});

describe('the athlete\'s entry year', () => {
  let coachId;
  beforeAll(() => { coachId = fieldedProgramme('Year College'); });
  it('a wrong (past) entry year is BLOCKED', () => {
    expect(decide(athlete(2025), 'Year College', asCoach(coachId)).code).toBe(GATE_CODE.ENTRY_SEASON_PAST);
  });
  it('no entry year is BLOCKED', () => {
    expect(decide(athlete(null), 'Year College', asCoach(coachId)).code).toBe(GATE_CODE.ENTRY_SEASON_UNKNOWN);
  });
  it('beyond the continuity horizon is BLOCKED with a review requested', () => {
    expect(decide(athlete(2026 + CONTINUITY_SEASONS + 1), 'Year College', asCoach(coachId))).toMatchObject({ code: GATE_CODE.ENTRY_SEASON_BEYOND_HORIZON, reviewRequested: true });
  });
});

describe('previously valid active programmes are unchanged when the evidence is sufficient', () => {
  it('a page-season-verified 2026 roster allows 2026, and continuity allows 2027 and 2028', () => {
    const c = fieldedProgramme('Active University');
    expect(decide(athlete(2026), 'Active University', asCoach(c))).toMatchObject({ outcome: 'ALLOW', code: GATE_CODE.FIELDED_VERIFIED, evidenceBasis: EVIDENCE_BASIS.ROSTER_PAGE_SEASON });
    expect(decide(athlete(2027), 'Active University', asCoach(c))).toMatchObject({ outcome: 'ALLOW', code: GATE_CODE.FIELDED_BY_CONTINUITY });
    expect(decide(athlete(2028), 'Active University', asCoach(c))).toMatchObject({ outcome: 'ALLOW', code: GATE_CODE.FIELDED_BY_CONTINUITY });
  });
  it('turnover re-measured from the stored rows proves a season-less current roster (under 85% repeated)', () => {
    college('Turnover State');
    const old = squad('TS25', 25);
    roster('Turnover State', 2025, old);
    roster('Turnover State', 2026, [...old.slice(0, 12), ...squad('TS26', 13)]);   // 12/25 = 48% returners
    const c = coach('Turnover State');
    expect(decide(athlete(2027), 'Turnover State', asCoach(c))).toMatchObject({ allowed: true, evidenceBasis: EVIDENCE_BASIS.ROSTER_TURNOVER });
  });
  it('a high-retention roster whose returners are one class older is proven by CLASS ADVANCEMENT; the same squad with copied labels is not', () => {
    const LABELS = ['Fr.', 'So.', 'Jr.']; const NEXT = ['So.', 'Jr.', 'Sr.'];
    college('Retention College');
    const old = squad('RC25', 25);
    roster('Retention College', 2025, old, { label: (i) => LABELS[i % 3] });
    roster('Retention College', 2026, [...old.slice(0, 23), ...squad('RC26', 2)], { label: (i) => (i < 23 ? NEXT[i % 3] : 'Fr.') });   // 23/25 = 92% returners
    const c = coach('Retention College');
    const d = decide(athlete(2027), 'Retention College', asCoach(c));
    expect(d).toMatchObject({ allowed: true, evidenceBasis: EVIDENCE_BASIS.ROSTER_CLASS_ADVANCEMENT });
    expect(d.detail.evidence.roster.classAdvanced).toEqual({ comparable: 23, advanced: 23 });
    college('Copied Labels College');
    roster('Copied Labels College', 2025, old, { label: (i) => LABELS[i % 3] });
    roster('Copied Labels College', 2026, old, { label: (i) => LABELS[i % 3] });      // the ENMU pattern: same people, same classes
    const c2 = coach('Copied Labels College');
    expect(decide(athlete(2027), 'Copied Labels College', asCoach(c2))).toMatchObject({ code: GATE_CODE.FIELDING_UNKNOWN });
  });
  it('a current roster that repeats last season (>= 85%) proves nothing: unknown, review requested', () => {
    college('Stale Page College');
    const old = squad('SP25', 25);
    roster('Stale Page College', 2025, old);
    roster('Stale Page College', 2026, [...old.slice(0, 23), ...squad('SP26', 2)]);
    const c = coach('Stale Page College');
    expect(decide(athlete(2027), 'Stale Page College', asCoach(c))).toMatchObject({ code: GATE_CODE.FIELDING_UNKNOWN, reviewRequested: true });
  });
  it('a roster_season_trust diagnosis on the current season withdraws the roster as evidence', () => {
    const c = fieldedProgramme('Diagnosed College');
    db.prepare(`INSERT INTO roster_season_trust (season, college_name, sport, diagnosis, disposition) VALUES ('2026', 'Diagnosed College', 'mens-soccer', 'SEASON_IDENTITY_UNPROVEN', 'RETAIN')`).run();
    expect(decide(athlete(2026), 'Diagnosed College', asCoach(c)).code).toBe(GATE_CODE.FIELDING_UNKNOWN);
  });
  it('a recorded end stops continuity: NOT_ACTIVE through 2026 allows 2026 and refuses 2027', () => {
    const c = fieldedProgramme('Closing College');
    status('Closing College', 'NOT_ACTIVE', 'INSTITUTION_CLOSED', { to: 2026 });
    expect(decide(athlete(2026), 'Closing College', asCoach(c)).allowed).toBe(true);
    expect(decide(athlete(2027), 'Closing College', asCoach(c)).code).toBe(GATE_CODE.PROGRAMME_NOT_FIELDED);
  });
  it('an inactive programme row is refused whatever its roster says', () => {
    const c = fieldedProgramme('Retired Row College', { active: 0 });
    expect(decide(athlete(2026), 'Retired Row College', asCoach(c)).code).toBe(GATE_CODE.PROGRAMME_INACTIVE);
  });
});

describe('unknown and contradictory evidence fail closed', () => {
  it('unknown programme status (no roster, no attestation, no status row): BLOCKED, review requested', () => {
    college('Silent College');
    const c = coach('Silent College');
    expect(decide(athlete(2027), 'Silent College', asCoach(c))).toMatchObject({ code: GATE_CODE.FIELDING_UNKNOWN, reviewRequested: true, allowed: false });
  });
  it('an open membership period and colleges.active = 1 are not evidence', () => {
    college('Member Only College', { entity: 'AE-MEMBER' });
    db.prepare(`INSERT INTO programme_membership_periods (athletics_entity_id, sport, first_season, last_season, governing_body, division, membership_status, source_tier, provenance, recorded_at)
      VALUES ('AE-MEMBER', 'mens-soccer', 2026, NULL, 'NCAA', 'NCAA D2', 'ACTIVE', 'SEED', 'fixture', ?)`).run(T);
    const c = coach('Member Only College');
    expect(decide(athlete(2026), 'Member Only College', asCoach(c)).code).toBe(GATE_CODE.FIELDING_UNKNOWN);
  });
  it('an unknown programme (no registry row) is refused', () => {
    db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status) VALUES ('nowhere-coach', ?, 'N', 'n@x.example', 'Nowhere U', 'NCAA D1', 'mens-soccer', 'Head Coach', 'verified')`).run(T);
    expect(decide(athlete(2026), 'Nowhere U', asCoach('nowhere-coach')).code).toBe(GATE_CODE.PROGRAMME_UNKNOWN);
  });
  it('a verified 2026 roster at a programme recorded FUTURE from 2027 is CONTRADICTORY', () => {
    const c = fieldedProgramme('Contradiction College');
    status('Contradiction College', 'FUTURE', 'LAUNCHING', { from: 2027 });
    expect(decide(athlete(2027), 'Contradiction College', asCoach(c))).toMatchObject({ code: GATE_CODE.EVIDENCE_CONTRADICTORY, reviewRequested: true });
  });
  it('attestations that disagree about a season are CONTRADICTORY; a verified roster vs a "not fielded" attestation too', () => {
    college('Split College'); const c = coach('Split College');
    for (const fielded of [true, false]) {
      recordProgrammeSeasonFielding({ collegeName: 'Split College', sport: 'mens-soccer', season: 2026, fielded, evidence: 'x', sourceUrl: 'https://split.example/', verifiedAt: daysAgo(1), expiresAt: daysAhead(100) }, { handle: db, now: NOW });
    }
    expect(decide(athlete(2026), 'Split College', asCoach(c)).code).toBe(GATE_CODE.EVIDENCE_CONTRADICTORY);
    const c2 = fieldedProgramme('Roster vs Attestation');
    recordProgrammeSeasonFielding({ collegeName: 'Roster vs Attestation', sport: 'mens-soccer', season: 2026, fielded: false, evidence: 'hiatus', sourceUrl: 'https://rva.example/', verifiedAt: daysAgo(1), expiresAt: daysAhead(100) }, { handle: db, now: NOW });
    expect(decide(athlete(2026), 'Roster vs Attestation', asCoach(c2)).code).toBe(GATE_CODE.EVIDENCE_CONTRADICTORY);
  });
  it('an attestation is evidence only while unexpired', () => {
    college('Attested College'); const c = coach('Attested College');
    db.prepare(`INSERT INTO programme_season_fielding (attestation_id, college_name, sport, season, fielded, evidence, source_url, verified_at, expires_at, recorded_at)
      VALUES ('PSF-expired', 'Attested College', 'mens-soccer', 2026, 1, 'schedule page', 'https://attested.example/schedule', ?, ?, ?)`).run(daysAgo(400), daysAgo(1), daysAgo(400));
    expect(decide(athlete(2026), 'Attested College', asCoach(c)).code).toBe(GATE_CODE.FIELDING_UNKNOWN);
    recordProgrammeSeasonFielding({ collegeName: 'Attested College', sport: 'mens-soccer', season: 2026, fielded: true, evidence: 'official 2026 schedule', sourceUrl: 'https://attested.example/schedule/2026', verifiedAt: daysAgo(1), expiresAt: daysAhead(200) }, { handle: db, now: NOW });
    expect(decide(athlete(2027), 'Attested College', asCoach(c))).toMatchObject({ allowed: true, code: GATE_CODE.FIELDED_BY_CONTINUITY, evidenceBasis: EVIDENCE_BASIS.FIELDING_ATTESTATION });
    expect(() => db.prepare("DELETE FROM programme_season_fielding WHERE attestation_id = 'PSF-expired'").run()).toThrow(/append-only/);
  });
});

describe('the recipient must be filed at THIS programme', () => {
  it('a coach filed elsewhere, or PROVEN_STALE here, is refused even where the programme is fielded', () => {
    fieldedProgramme('Host College');
    const elsewhere = fieldedProgramme('Other College');
    expect(decide(athlete(2026), 'Host College', asCoach(elsewhere)).code).toBe(GATE_CODE.RECIPIENT_NOT_AFFILIATED);
    const stale = coach('Host College', { currentness: 'PROVEN_STALE' });
    expect(decide(athlete(2026), 'Host College', asCoach(stale)).code).toBe(GATE_CODE.RECIPIENT_NOT_AFFILIATED);
    expect(decide(athlete(2026), 'Host College', { kind: RECIPIENT.COACH, email: `${elsewhere}@example.edu` }).code).toBe(GATE_CODE.RECIPIENT_NOT_AFFILIATED);
  });
  it('a programme inbox is asked the same question: allowed at a fielded programme, refused at an unfielded one or another programme', () => {
    db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES ('AE-IN', 'Inbox U', 990001, 'SINGLE', 'test', ?)").run(T);
    db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES ('AE-OUT', 'Outbox U', 990002, 'SINGLE', 'test', ?)").run(T);
    const inCol = college('Inbox U', { entity: 'AE-IN' });
    roster('Inbox U', 2026, squad('IU'), { pageSeason: '2026' });
    const outCol = college('Outbox U', { entity: 'AE-OUT' });
    const pc = (id, ent, col) => db.prepare(`INSERT INTO programme_contacts (contact_id, athletics_entity_id, college_id, sport, email, label, contact_role, observed_on_url, observed_at, source, source_kind, source_tier, status, currentness_checked_at, provenance, created_at, updated_at)
      VALUES (?, ?, ?, 'mens-soccer', ?, 'L', 'TEAM_INBOX', 'https://x.example/staff', ?, 'refresh:test', 'OFFICIAL_STAFF_DIRECTORY', 'A', 'VERIFIED', ?, 'test', ?, ?)`).run(id, ent, col, `${id.toLowerCase()}@x.example`, T, T, T, T);
    pc('PC-IN', 'AE-IN', inCol); pc('PC-OUT', 'AE-OUT', outCol);
    expect(decide(athlete(2027), 'Inbox U', { kind: RECIPIENT.PROGRAMME_INBOX, programmeContactId: 'PC-IN' })).toMatchObject({ allowed: true, code: GATE_CODE.FIELDED_BY_CONTINUITY });
    expect(decide(athlete(2027), 'Outbox U', { kind: RECIPIENT.PROGRAMME_INBOX, programmeContactId: 'PC-OUT' }).code).toBe(GATE_CODE.FIELDING_UNKNOWN);
    expect(decide(athlete(2027), 'Inbox U', { kind: RECIPIENT.PROGRAMME_INBOX, programmeContactId: 'PC-OUT' }).code).toBe(GATE_CODE.RECIPIENT_NOT_AFFILIATED);
  });
});

describe('the decision ledger', () => {
  it('is append-only, and a review-requesting refusal lands in the review queue', () => {
    college('Ledger College'); const c = coach('Ledger College'); const a = athlete(2027);
    const d = decide(a, 'Ledger College', asCoach(c));
    const id = recordGateDecision(d, { boundary: BOUNDARY.MANUAL_SEND, athleteId: a.id, collegeName: 'Ledger College', sport: 'mens-soccer', recipient: asCoach(c), handle: db, now: NOW });
    const row = db.prepare('SELECT * FROM recruitment_gate_decisions WHERE decision_id = ?').get(id);
    expect(row).toMatchObject({ outcome: 'BLOCK', code: GATE_CODE.FIELDING_UNKNOWN, review_requested: 1, entry_season: 2027, programme_season: 2027, coach_id: c });
    expect(JSON.parse(row.detail_json).evidence.roster.verified).toBe(false);
    expect(fieldingReviewQueue({ handle: db }).some((q) => q.college_name === 'Ledger College')).toBe(true);
    expect(() => db.prepare("UPDATE recruitment_gate_decisions SET outcome = 'ALLOW' WHERE decision_id = ?").run(id)).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM recruitment_gate_decisions WHERE decision_id = ?').run(id)).toThrow(/append-only/);
  });
});
