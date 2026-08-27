#!/usr/bin/env node
/**
 * Re-derives roster_players.estimated_graduation_year from the class label.
 *
 * Needed because YEARS_TO_GRADUATE was one too high in every class until
 * 2026-08-25, so every stored year is one late: a senior on the fall 2024
 * roster reads as graduating in 2026 when 91.4% of them had left before the
 * 2025 season started. That put every recruit against the wrong cohort — a
 * 2027 recruit was being matched to players who actually leave in 2026 — and
 * it is the reason roster opportunity scored *worse* than knowing nothing in
 * the first backtest.
 *
 * Idempotent: it recomputes from class_year_label and season rather than
 * adjusting what is stored, so running it twice changes nothing the second
 * time. Rows whose label was never recognised keep their null.
 *
 *   node server/scripts/refreshGraduationYears.js
 *   node server/scripts/refreshGraduationYears.js --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/client.js';
import { readClassYear } from '../../shared/classYear.js';

const APPLY = process.argv.includes('--apply');

function main() {
  const rows = db.prepare('SELECT id, sport, season, class_year_label, estimated_graduation_year FROM roster_players').all();
  const changes = [];
  const shifts = new Map();
  let unchanged = 0;
  let stillNull = 0;

  for (const r of rows) {
    const season = Number(r.season);
    const next = Number.isFinite(season)
      ? readClassYear(r.class_year_label, { season }).graduationYear
      : null;
    if (next === null && r.estimated_graduation_year === null) { stillNull++; continue; }
    if (next === r.estimated_graduation_year) { unchanged++; continue; }
    const key = `${r.estimated_graduation_year ?? 'null'} -> ${next ?? 'null'}`;
    shifts.set(key, (shifts.get(key) || 0) + 1);
    changes.push({ id: r.id, next });
  }

  console.log(`\nroster rows: ${rows.length}`);
  console.log(`  unchanged: ${unchanged}   still null: ${stillNull}   changing: ${changes.length}`);
  console.log(`\n  ${'shift'.padEnd(20)} ${'rows'.padStart(7)}`);
  for (const [k, v] of [...shifts].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${String(v).padStart(7)}`);

  if (!APPLY) {
    console.log('\ndry run — nothing written. Re-run with --apply.\n');
    return;
  }

  const dbPath = db.name;
  const backup = `${dbPath}.pre-gradyear-fix-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(dbPath, backup);
  console.log(`\nbacked up -> ${path.basename(backup)}`);

  const stmt = db.prepare('UPDATE roster_players SET estimated_graduation_year = ?, updated_date = ? WHERE id = ?');
  const now = new Date().toISOString();
  db.transaction((list) => { for (const c of list) stmt.run(c.next, now, c.id); })(changes);
  console.log(`updated ${changes.length} rows.\n`);
}

main();
