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
 */
export function corroborateFixtureCoaches(db, { ids = null } = {}) {
  const named = db.prepare("SELECT id, full_name, school, sport FROM coaches WHERE trim(coalesce(full_name, '')) != ''").all()
    .filter((c) => !ids || ids.includes(c.id));
  const has = db.prepare('SELECT 1 FROM coach_seasons WHERE school = ? AND sport = ? AND lower(coach_name) = lower(?)');
  const used = db.prepare('SELECT COALESCE(MAX(season), 1900) FROM coach_seasons WHERE school = ? AND sport = ? AND season < 2000');
  const ins = db.prepare("INSERT INTO coach_seasons (school, sport, season, coach_name, method, imported_at) VALUES (?, ?, ?, ?, 'test-fixture', '2026-01-01T00:00:00Z')");
  let added = 0;
  for (const c of named) {
    if (has.get(c.school, c.sport, c.full_name)) continue;
    ins.run(c.school, c.sport, used.pluck().get(c.school, c.sport) + 1, c.full_name);
    added += 1;
  }
  return added;
}
