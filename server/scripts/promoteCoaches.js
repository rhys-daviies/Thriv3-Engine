#!/usr/bin/env node
/**
 * Promotes coaching contacts into the `coaches` table, with their provenance.
 *
 * They live today as JSON on `graduating_seniors.coaching_staff` and reach
 * `coaches` only when somebody sends to them, which left 22 rows against 6,399
 * real contacts. Lazy population is fine for a demo and wrong for a pilot: you
 * cannot review, dedupe or suppress a list that does not exist until you mail
 * it.
 *
 * It also restores what the original import threw away. The source CSVs in
 * Thriv3/2025 Coaches Emails carry a `status` and a `source_url` per address,
 * and only name/title/email survived into the stored blob — so every contact
 * looked equally trustworthy. They are not: roughly a fifth were *inferred*
 * from an institution's address pattern and have never been observed anywhere.
 * On a cold campaign those are the ones that bounce, and bounces cost sender
 * reputation rather than just a lost email.
 *
 * Division is normalised on the way in. The table currently holds both
 * `NCAA D1` and `NCAA Division I`, which is two spellings of a column things
 * join on.
 *
 * Idempotent: keyed on (email, school, sport) like findOrCreateCoach, so
 * re-running updates provenance rather than duplicating people.
 *
 *   node server/scripts/promoteCoaches.js
 *   node server/scripts/promoteCoaches.js --sport mens-soccer --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { parseCsvToObjects } from '../lib/csv.js';
import { normalizeDivision } from '../../shared/divisions.js';
import { utcNow } from '../lib/time.js';

const APPLY = process.argv.includes('--apply');
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };
const ONLY_SPORT = arg('sport');
const CSV_DIR = path.join(os.homedir(), 'Documents/Thriv3/2025 Coaches Emails');

/**
 * Provenance from the source sheets, keyed on the address alone.
 *
 * Not on (school, email): the same address legitimately appears under more
 * than one school where a coach moved or a conference sheet overlaps, and the
 * status of an address is a property of the address.
 */
function loadProvenance() {
  if (!fs.existsSync(CSV_DIR)) return { map: new Map(), files: 0 };
  const map = new Map();
  let files = 0;
  for (const file of fs.readdirSync(CSV_DIR).filter((f) => f.endsWith('.csv'))) {
    files++;
    for (const row of parseCsvToObjects(fs.readFileSync(path.join(CSV_DIR, file), 'utf-8'))) {
      const email = (row.email || '').trim().toLowerCase();
      if (!email) continue;
      const status = (row.status || '').trim().toLowerCase();
      // First writer wins; the sheets agree where they overlap, and a later
      // blank must not overwrite a status we already have.
      if (map.has(email)) continue;
      map.set(email, {
        status: ['verified', 'inferred', 'generic'].includes(status) ? status : 'unknown',
        sourceUrl: (row.source_url || '').trim() || null,
      });
    }
  }
  return { map, files };
}

function main() {
  const { map: provenance, files } = loadProvenance();

  const divisionByName = new Map();
  for (const c of db.prepare('SELECT name, sport, division FROM colleges').all()) {
    divisionByName.set(`${c.name}|${c.sport}`, c.division);
  }

  const rows = db
    .prepare("SELECT college_name, sport, coaching_staff FROM graduating_seniors WHERE coaching_staff IS NOT NULL AND coaching_staff <> '[]'")
    .all()
    .filter((r) => !ONLY_SPORT || r.sport === ONLY_SPORT);

  const wanted = new Map();   // key -> row
  const stats = { entries: 0, noEmail: 0, byStatus: {}, noDivision: 0 };

  for (const r of rows) {
    let staff;
    try { staff = JSON.parse(r.coaching_staff); } catch { continue; }
    for (const c of staff || []) {
      stats.entries++;
      const email = (c.email || '').trim().toLowerCase();
      if (!email || email === 'n/a') { stats.noEmail++; continue; }

      // Normalised from the college row where we have one, so the coaches
      // table speaks the same division vocabulary as everything it joins to.
      const raw = divisionByName.get(`${r.college_name}|${r.sport}`);
      const division = raw ? normalizeDivision(raw) : null;
      if (!division) stats.noDivision++;

      const p = provenance.get(email) || { status: 'unknown', sourceUrl: null };
      stats.byStatus[p.status] = (stats.byStatus[p.status] || 0) + 1;

      wanted.set(`${email}|${r.college_name}|${r.sport}`, {
        full_name: (c.name || '').trim() || null,
        email,
        school: r.college_name,
        sport: r.sport,
        division,
        position_title: (c.title || '').trim() || null,
        email_status: p.status,
        email_source_url: p.sourceUrl,
        source: 'graduating_seniors.coaching_staff',
      });
    }
  }

  const existing = new Map(
    db.prepare('SELECT * FROM coaches').all().map((c) => [`${c.email}|${c.school}|${c.sport}`, c])
  );

  const inserts = [];
  const updates = [];
  for (const [key, row] of wanted) {
    const prior = existing.get(key);
    if (!prior) { inserts.push(row); continue; }
    // Only touch rows whose provenance or division would actually change.
    if (prior.email_status !== row.email_status
      || prior.email_source_url !== row.email_source_url
      || prior.division !== row.division) {
      updates.push({ ...row, id: prior.id });
    }
  }
  const orphans = [...existing.keys()].filter((k) => !wanted.has(k));

  // Every coach row, not just the promoted ones. A row the source no longer
  // covers still has to speak the canonical vocabulary, or the spelling this
  // script exists to fix survives in exactly the rows nobody looks at — which
  // is where the `NCAA Division I` came from in the first place.
  const misspelt = db.prepare('SELECT id, school, sport, division FROM coaches').all()
    .filter((c) => c.division && c.division !== normalizeDivision(c.division))
    .filter((c) => !updates.some((u) => u.id === c.id))
    .map((c) => ({ id: c.id, from: c.division, to: normalizeDivision(c.division) }));

  console.log(`\nprovenance sheets read: ${files}   addresses with a status: ${provenance.size}`);
  console.log(`staff entries scanned:  ${stats.entries}   without a usable email: ${stats.noEmail}`);
  console.log(`\ncoaches table: ${existing.size} rows now  ->  ${existing.size + inserts.length} after`);
  console.log(`  insert: ${inserts.length}   update provenance: ${updates.length}   left alone: ${existing.size - updates.length - orphans.length}`);
  if (orphans.length) console.log(`  ${orphans.length} existing row(s) not in the source — kept, never deleted`);
  if (misspelt.length) {
    const shapes = {};
    for (const m of misspelt) shapes[`${m.from} -> ${m.to}`] = (shapes[`${m.from} -> ${m.to}`] || 0) + 1;
    console.log(`  ${misspelt.length} row(s) with a non-canonical division, repaired in place:`);
    for (const [k, v] of Object.entries(shapes)) console.log(`    ${k}  x${v}`);
  }

  console.log(`\n  ${'email status'.padEnd(14)} ${'count'.padStart(7)}   what it means`);
  const meanings = {
    verified: 'read off a staff page',
    inferred: 'guessed from the institution pattern — never observed',
    generic: 'shared inbox, not a person',
    unknown: 'no provenance sheet covers this address',
  };
  for (const [k, v] of Object.entries(stats.byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(14)} ${String(v).padStart(7)}   ${meanings[k] || ''}`);
  }
  if (stats.noDivision) console.log(`\n  ${stats.noDivision} entries had no matching college row, so no division could be normalised`);

  if (!APPLY) {
    console.log('\ndry run — nothing written. Re-run with --apply.\n');
    return;
  }

  const dbPath = db.name;
  const backup = `${dbPath}.pre-promote-coaches-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(dbPath, backup);
  console.log(`\nbacked up -> ${path.basename(backup)}`);

  const insert = db.prepare(`
    INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title,
                         email_status, email_source_url, source)
    VALUES (@id, @created_at, @full_name, @email, @school, @division, @sport, @position_title,
            @email_status, @email_source_url, @source)
  `);
  const update = db.prepare(`
    UPDATE coaches SET division = @division, email_status = @email_status,
                       email_source_url = @email_source_url, source = @source
    WHERE id = @id
  `);
  const now = utcNow();
  const fixDivision = db.prepare('UPDATE coaches SET division = ? WHERE id = ?');
  db.transaction(() => {
    for (const r of inserts) insert.run({ ...r, id: randomUUID(), created_at: now });
    for (const r of updates) update.run(r);
    for (const m of misspelt) fixDivision.run(m.to, m.id);
  })();
  console.log(`inserted ${inserts.length}, updated ${updates.length}, divisions repaired ${misspelt.length}.\n`);
}

main();
