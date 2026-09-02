#!/usr/bin/env node
/**
 * ONE WOMEN'S-SOCCER ATHLETE, FOR QA ONLY — Phase 13F / §1.
 *
 * WHY IT EXISTS. Every athlete on file is men's soccer, so the athlete report
 * for a women's programme had never been rendered — and Rochester women's is
 * the one combination the 13E audit could not test: a 2023 structural gap, a
 * coach-weighted first-year difference and strong roster evidence at once.
 *
 * WHAT IT IS NOT. Not a client, not a prospect, not history. It carries the
 * five fields the report actually reads and nothing else: no school, no
 * academic figures, no contact details, no preferences. There is no person
 * behind it and the record says so in its own name.
 *
 * HOW IT STAYS OUT OF PRODUCTION. Three ways, and each on its own is enough:
 *
 *   - `archived_at` is set, which is the flag every production surface already
 *     checks — the public profile refuses it, publishing refuses it, and the
 *     trial preflight counts only published-and-not-archived athletes;
 *   - `published_at` is null, so it has never been shared and cannot be;
 *   - the id is a fixed, obviously-synthetic string and the name says QA.
 *
 * Deterministic: the same id and the same fields every time, so a QA render is
 * reproducible and running this twice changes nothing.
 */
import db from '../db/client.js';

export const QA_ATHLETE = Object.freeze({
  id: 'qa-fixture-womens-soccer-0001',
  full_name: 'QA Fixture (women’s soccer)',
  sport: 'womens-soccer',
  position: 'Midfielder',
  recruiting_class_year: 2027,
  // The report folds origin to within or outside the United States and never
  // splits by individual nationality; this exercises the domestic branch, which
  // no men's fixture does.
  nationality: 'United States',
});

export function seedQaAthlete() {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM players WHERE id = ?').get(QA_ATHLETE.id);
  if (existing) {
    db.prepare(`UPDATE players SET full_name = ?, sport = ?, position = ?,
      recruiting_class_year = ?, nationality = ?, archived_at = COALESCE(archived_at, ?),
      published_at = NULL, updated_date = ? WHERE id = ?`)
      .run(QA_ATHLETE.full_name, QA_ATHLETE.sport, QA_ATHLETE.position,
        QA_ATHLETE.recruiting_class_year, QA_ATHLETE.nationality, now, now, QA_ATHLETE.id);
    return { id: QA_ATHLETE.id, created: false };
  }
  db.prepare(`INSERT INTO players
      (id, created_date, updated_date, full_name, sport, position,
       recruiting_class_year, nationality, archived_at, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
    .run(QA_ATHLETE.id, now, now, QA_ATHLETE.full_name, QA_ATHLETE.sport, QA_ATHLETE.position,
      QA_ATHLETE.recruiting_class_year, QA_ATHLETE.nationality, now);
  return { id: QA_ATHLETE.id, created: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = seedQaAthlete();
  console.log(`${r.created ? 'created' : 'refreshed'} ${r.id}`);
  const row = db.prepare('SELECT full_name, sport, position, recruiting_class_year, nationality, '
    + 'archived_at IS NOT NULL archived, published_at IS NULL unpublished FROM players WHERE id = ?')
    .get(QA_ATHLETE.id);
  console.log(JSON.stringify(row, null, 1));
}
