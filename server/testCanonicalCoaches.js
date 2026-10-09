/**
 * TEST FIXTURES ONLY — give fixture coaches the evidence the canonical engine requires.
 *
 * Since the runtime floor applies the canonical decision (canonicalCoachEligibility.js), a coach
 * row inserted bare into a test database is — correctly — not eligible: nothing corroborates that
 * the person works at that school. This adds exactly the evidence the reconciler's simplest path
 * accepts: an independent `coach_seasons` record naming the coach at their own school ("identity
 * corroborated at current school", method COACH_SEASONS). It does NOT touch email_status,
 * currentness or suppressions, so a fixture's unverified, PROVEN_STALE, generic or opted-out coach
 * stays exactly as ineligible as it was. Nothing here is a bypass: the floor still runs in full.
 *
 * Seasons are numbered from 1901 so they never collide with a fixture's own coach_seasons rows
 * (primary key school, sport, season) or read as a current season.
 *
 * DI-08: the coach's programme is also given the evidence the recruitment-year gate requires — an
 * unexpired fielding attestation for the current season (seedFieldedProgramme). A fixture's
 * programme_status rows still apply in full: a NOT_ACTIVE or FUTURE programme stays refused (the
 * attestation then CONTRADICTS the status, which the gate also refuses).
 */
export function corroborateFixtureCoaches(db, { ids = null } = {}) {
  const named = db.prepare("SELECT id, full_name, school, sport FROM coaches WHERE trim(coalesce(full_name, '')) != ''").all()
    .filter((c) => !ids || ids.includes(c.id));
  const has = db.prepare('SELECT 1 FROM coach_seasons WHERE school = ? AND sport = ? AND lower(coach_name) = lower(?)');
  const used = db.prepare('SELECT COALESCE(MAX(season), 1900) FROM coach_seasons WHERE school = ? AND sport = ? AND season < 2000');
  const ins = db.prepare("INSERT INTO coach_seasons (school, sport, season, coach_name, method, imported_at) VALUES (?, ?, ?, ?, 'test-fixture', '2026-01-01T00:00:00Z')");
  let added = 0;
  for (const c of named) {
    seedFieldedProgramme(db, c.school, c.sport);
    if (has.get(c.school, c.sport, c.full_name)) continue;
    ins.run(c.school, c.sport, used.pluck().get(c.school, c.sport) + 1, c.full_name);
    added += 1;
  }
  return added;
}

/**
 * A coach a test may SEND to: no operator flag reaches send time, so a test that drafts, sends or
 * claims for a coach must seed one that is genuinely eligible — a real, verified, current address,
 * filed at the programme, with the corroboration the engine requires. Inserts the row when the
 * address is not already a coach of that programme; otherwise makes the existing row sendable.
 * Returns the coach id.
 */
export function seedSendableCoach(db, { name, email, school, sport = 'mens-soccer', title = 'Head Coach', division = 'NCAA D1', id = null }) {
  const found = db.prepare('SELECT id FROM coaches WHERE lower(email) = lower(?) AND sport = ? AND school = ?').get(email, sport, school);
  const coachId = found?.id || id || `sendable-${Math.random().toString(36).slice(2, 12)}`;
  if (!found) {
    db.prepare(`INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, currentness_status)
      VALUES (?, '2026-01-01T00:00:00Z', ?, ?, ?, ?, ?, ?, 'verified', 'CURRENT')`).run(coachId, name, email, school, division, sport, title);
  } else {
    db.prepare("UPDATE coaches SET email_status = 'verified' WHERE id = ?").run(coachId);
  }
  corroborateFixtureCoaches(db, { ids: [coachId] });
  return coachId;
}

/** Make existing fixture coach rows sendable (verified address + corroboration). Returns how many. */
export function makeCoachesSendable(db, ids) {
  const set = db.prepare("UPDATE coaches SET email_status = 'verified' WHERE id = ? AND coalesce(currentness_status, '') != 'PROVEN_STALE'");
  for (const id of ids) set.run(id);
  corroborateFixtureCoaches(db, { ids });
  return ids.length;
}

/**
 * DI-08 — TEST FIXTURES ONLY. Give a fixture programme the evidence the recruitment-year gate
 * (server/lib/recruitmentYearGate.js) requires: an unexpired programme_season_fielding row saying
 * it is fielded in the current season. Idempotent. A programme a test means to be unfielded simply
 * does not get one (or gets a programme_status row, which still refuses it).
 */
export const FIXTURE_FIELDING_URL = 'https://fixture.example/fielded';
export function seedFieldedProgramme(db, school, sport = 'mens-soccer', { season = 2026 } = {}) {
  if (!school || !sport) return false;
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='programme_season_fielding'").get();
  if (!exists) return false;
  // the gate refuses a programme the registry does not have (RYG_PROGRAMME_UNKNOWN); a legacy
  // fixture that names a school with no colleges row gets a minimal active one
  if (!db.prepare('SELECT 1 FROM colleges WHERE name = ? AND sport = ?').get(school, sport)) {
    db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, active) VALUES (?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ?, ?, 1)")
      .run(`fixture-col-${school}-${sport}`, school, sport);
  }
  if (db.prepare('SELECT 1 FROM programme_season_fielding WHERE college_name = ? AND sport = ? AND season = ? AND source_url = ?').get(school, sport, season, FIXTURE_FIELDING_URL)) return false;
  db.prepare(`INSERT INTO programme_season_fielding (attestation_id, college_name, sport, season, fielded, evidence, source_url, verified_at, expires_at, recorded_at)
    VALUES (?, ?, ?, ?, 1, 'test fixture: programme fielded', ?, '2020-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`)
    .run(`PSF-fixture-${school}-${sport}-${season}`, school, sport, season, FIXTURE_FIELDING_URL);
  return true;
}
