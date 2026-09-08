#!/usr/bin/env node
/**
 * Loads per-season win/draw/loss history into `programme_seasons`.
 *
 * THE SOURCE lives outside this repo, at
 * ~/Documents/Thriv3/Soccer Records/soccer_records{,_women}.csv, and is the
 * file `soccer_score_v6.py` and `loadMatchingInputs.js` already read. Phase 12A
 * checked 32 of its programme-seasons against the schools' own published
 * records and all 32 agreed, which is why this is a truth layer rather than an
 * estimate. It is never written to by this script.
 *
 * WHAT IT LOADS: wins, draws, losses, and nothing else. The same file carries a
 * postseason column and a conference column; both are deliberately left behind.
 * The postseason column covers D1 only before 2025 and was wrong in two of the
 * three values Phase 12A could check against schools' own schedules. The
 * conference column is a current snapshot with no history, and for D1 men it is
 * the school's all-sports conference rather than the soccer one.
 *
 * IDENTITY IS EXACT, OR IT IS A GAP. The name in the CSV must equal
 * `colleges.name` for the same sport. `matchSchoolName` exists and is
 * deliberately not used: it is built for reconciling a source that spells
 * schools differently, and this source does not — 99.8% of the report universe
 * already matches exactly. Reaching for a fuzzy matcher to close the last 0.2%
 * is how Kansas got Central Arkansas's academic rating.
 *
 * CONFIDENCE IS MEASURED, NOT ASSERTED. Every season is cross-checked against
 * `roster_players`: no player can appear in more matches than their team
 * played, so `MAX(games_played) > wins + draws + losses` means the two internal
 * sources contradict each other. 29 of 6,658 checkable seasons fail it. The row
 * is still stored — deleting evidence of a contradiction is worse than carrying
 * it — and the model refuses to read it.
 *
 *   node server/scripts/importProgrammeSeasons.js            # dry run
 *   node server/scripts/importProgrammeSeasons.js --apply
 *   node server/scripts/importProgrammeSeasons.js --dir /path/to/records
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import db from '../db/client.js';
import { parseCsvToObjects } from '../lib/csv.js';
import { utcNow } from '../lib/time.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DIR = arg('dir', path.join(os.homedir(), 'Documents/Thriv3/Soccer Records'));

/** The window this product measures. 2026 is being recruited into, not played. */
export const SEASONS = [2022, 2023, 2024, 2025];

export const SOURCES = [
  { file: 'soccer_records.csv', sport: 'mens-soccer' },
  { file: 'soccer_records_women.csv', sport: 'womens-soccer' },
];

/**
 * The columns this loader depends on, checked before a single row is read.
 *
 * Fail closed: the source is maintained by hand outside this repository, and a
 * renamed column would otherwise load as a table of absent seasons that looks
 * exactly like a coverage collapse.
 */
export const REQUIRED_COLUMNS = ['name', ...SEASONS.flatMap((y) => [`${y}_W`, `${y}_L`, `${y}_D`])];

export const CONFIDENCE = Object.freeze({
  CONSISTENT: 'ROSTER_CONSISTENT',
  CONTRADICTED: 'ROSTER_CONTRADICTED',
  UNCHECKED: 'UNCHECKED',
});

/**
 * One season's triple, or a reason it is not one.
 *
 * A season is loaded only where all three of W, L and D are present integers.
 * Two of three is not two thirds of a season — it is a season whose record we
 * cannot state — so it is reported as malformed and dropped.
 */
export function readSeason(row, season) {
  const raw = { wins: row[`${season}_W`], losses: row[`${season}_L`], draws: row[`${season}_D`] };
  const present = Object.values(raw).filter((v) => String(v ?? '').trim() !== '');
  if (present.length === 0) return { ok: false, reason: 'absent' };
  if (present.length < 3) return { ok: false, reason: 'partial' };
  const n = {};
  for (const [k, v] of Object.entries(raw)) {
    const s = String(v).trim();
    if (!/^\d+$/.test(s)) return { ok: false, reason: `non-integer ${k}: ${JSON.stringify(v)}` };
    n[k] = Number(s);
  }
  const matches = n.wins + n.draws + n.losses;
  if (matches === 0) return { ok: false, reason: 'zero matches' };
  return { ok: true, ...n, matches };
}

/** Copies the database before writing, as importCoachTenure and promoteCoaches do. */
function backup() {
  const src = db.name;
  if (!src || src === ':memory:') return null;
  const dest = `${src}.pre-programme-seasons-${utcNow().replace(/[:.]/g, '')}`;
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.prepare('VACUUM INTO ?').run(dest);
  return dest;
}

export function run({ dir = DIR, apply = false, log = console.log } = {}) {
  const now = utcNow();
  const colleges = db.prepare('SELECT id, name, sport, division FROM colleges').all();
  const byKey = new Map(colleges.map((c) => [`${c.sport}|${c.name}`, c]));

  /**
   * The independent witness: nobody plays more matches than their team did.
   *
   * `roster_players.season` is keyed through Number() on both sides rather than
   * interpolated. That column has TEXT affinity and holds '2022' in production,
   * but a writer binding a JS number lands '2022.0' — and a key built by string
   * interpolation would then miss every row and quietly mark the whole table
   * UNCHECKED, losing the only cross-check this loader has without failing.
   */
  const appearances = new Map();
  for (const r of db.prepare(`SELECT college_name, sport, season, MAX(games_played) g
      FROM roster_players WHERE games_played IS NOT NULL GROUP BY 1, 2, 3`).all()) {
    const season = Number(r.season);
    if (!Number.isFinite(season)) continue;
    const key = `${r.sport}|${r.college_name}|${season}`;
    // Several stored spellings of one season collapse to one key; keep the
    // highest appearance count, which is the strongest contradiction available.
    appearances.set(key, Math.max(appearances.get(key) ?? 0, r.g));
  }

  const rows = [];
  const report = { files: [], unmatched: [], malformed: [], duplicates: [], contradicted: [] };

  for (const { file, sport } of SOURCES) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) throw new Error(`source missing: ${full}`);
    const parsed = parseCsvToObjects(fs.readFileSync(full, 'utf8'));
    if (!parsed.length) throw new Error(`source empty: ${full}`);
    const missing = REQUIRED_COLUMNS.filter((c) => !(c in parsed[0]));
    if (missing.length) throw new Error(`source ${file} is missing columns: ${missing.join(', ')}`);

    const seen = new Set();
    let loaded = 0;
    for (const r of parsed) {
      const name = String(r.name ?? '').trim();
      if (!name) { report.malformed.push(`${file}: row with no name`); continue; }
      if (seen.has(name)) { report.duplicates.push(`${file}: ${name}`); continue; }
      seen.add(name);

      const college = byKey.get(`${sport}|${name}`);
      if (!college) { report.unmatched.push(`${name} [${sport}]`); continue; }

      for (const season of SEASONS) {
        const s = readSeason(r, season);
        if (!s.ok) {
          if (s.reason !== 'absent') report.malformed.push(`${name} [${sport}] ${season}: ${s.reason}`);
          continue;
        }
        const played = appearances.get(`${sport}|${name}|${season}`);
        let confidence = CONFIDENCE.UNCHECKED;
        if (played != null) {
          confidence = played > s.matches ? CONFIDENCE.CONTRADICTED : CONFIDENCE.CONSISTENT;
          if (confidence === CONFIDENCE.CONTRADICTED) {
            report.contradicted.push(`${name} [${sport}] ${season}: record says ${s.matches} matches, a player logged ${played}`);
          }
        }
        rows.push({
          college_id: college.id, sport, season,
          wins: s.wins, draws: s.draws, losses: s.losses, matches_played: s.matches,
          source: `soccer-records:${file}`, source_record_name: name,
          confidence, imported_at: now,
        });
        loaded += 1;
      }
    }
    report.files.push({ file, sport, sourceRows: parsed.length, seasonRows: loaded });
  }

  log(`\nprogramme_seasons — ${apply ? 'APPLY' : 'DRY RUN'}`);
  for (const f of report.files) log(`  ${f.file.padEnd(26)} ${String(f.sourceRows).padStart(5)} source rows -> ${String(f.seasonRows).padStart(5)} season rows`);
  log(`  total season rows: ${rows.length}`);
  const conf = rows.reduce((a, r) => ({ ...a, [r.confidence]: (a[r.confidence] ?? 0) + 1 }), {});
  log(`  confidence: ${Object.entries(conf).map(([k, v]) => `${k} ${v}`).join('  ')}`);
  for (const [label, list] of [['unmatched source rows', report.unmatched], ['malformed', report.malformed],
    ['duplicate source names', report.duplicates], ['roster-contradicted seasons', report.contradicted]]) {
    log(`  ${label}: ${list.length}`);
    list.slice(0, 8).forEach((x) => log(`      ${x}`));
    if (list.length > 8) log(`      … +${list.length - 8}`);
  }

  if (!apply) { log('\n  nothing written. re-run with --apply\n'); return { rows, report, written: 0 }; }

  const saved = backup();
  if (saved) log(`\n  backup: ${saved}`);
  // Whole-table replace inside one transaction: the table is a projection of
  // the source, so a partial load is the one state it must never be left in.
  const ins = db.prepare(`INSERT INTO programme_seasons
    (college_id, sport, season, wins, draws, losses, matches_played, source, source_record_name, confidence, imported_at)
    VALUES (@college_id, @sport, @season, @wins, @draws, @losses, @matches_played, @source, @source_record_name, @confidence, @imported_at)`);
  const write = db.transaction((all) => {
    db.prepare('DELETE FROM programme_seasons').run();
    for (const r of all) ins.run(r);
  });
  write(rows);
  const n = db.prepare('SELECT COUNT(*) n FROM programme_seasons').get().n;
  log(`  written: ${n} rows\n`);
  return { rows, report, written: n };
}

if (import.meta.url === `file://${process.argv[1]}`) run({ apply: APPLY });
