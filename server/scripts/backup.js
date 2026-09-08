#!/usr/bin/env node
/**
 * BACKUP AND RESTORE — Phase 13K.
 *
 *   node server/scripts/backup.js /path/to/backups          # take one
 *   node server/scripts/backup.js --verify /path/to/backup   # check one
 *   node server/scripts/backup.js --restore /path/to/backup --into /path/to/target
 *
 * THE LESSON THIS EXISTS FOR. In Phase 13J a `cp` of the working database was
 * taken as a backup, and the copy was wrong: SQLite in WAL mode holds
 * committed rows in a separate write-ahead log, so a file copy can be a
 * database missing its most recent transactions — the copy reported three
 * players where the live database had four. It looked like a backup and would
 * have restored as a slightly older, silently different database.
 *
 * So the database is copied with SQLite's own online backup API, which
 * checkpoints and produces a consistent single file, and then the copy is
 * OPENED AND COUNTED before it is called a backup. A backup that has never
 * been read is a hope.
 *
 * WHAT IS BACKED UP. Both halves, together, in one directory:
 *
 *   database.sqlite   the record — athletes, programmes, report history, accounts
 *   reports/          the artefacts those history rows point at
 *   uploads/          the files rows point at, including every stored analysis
 *   manifest.json     what was taken, when, and how much of it
 *
 * THE THIRD DIRECTORY WAS FOUND BY A RESTORE, not by reading the schema.
 * `players.recommendations` holds a PATH, not an analysis, so restoring the
 * database and the report artefacts produced an application that signed in,
 * listed every athlete and said "No matches yet" for all of them. A backup
 * that loses an athlete's matching result is not a backup.
 *
 * They must travel together. A database restored beside an older artefact
 * store is a history that promises documents the store does not have, and the
 * consistency contract in docs/hosting.md is what that means for an operator.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1] ?? null;
};
const has = (name) => args.includes(`--${name}`);

const DB_PATH = process.env.RECRUITMATCH_DB
  || path.resolve(process.cwd(), 'server/data/recruitmatch.sqlite');
const STORE = process.env.THRIV3_REPORT_STORE
  || path.resolve(process.cwd(), 'server/reports');
const UPLOADS = process.env.THRIV3_UPLOAD_DIR
  || path.resolve(process.cwd(), 'server/uploads');

/** Tables whose row counts are recorded, so a restore can be checked against them. */
const COUNTED = [
  'players', 'colleges', 'roster_players', 'programme_seasons', 'coach_seasons',
  'generated_reports', 'operator_users', 'outreach',
];

function countRows(db) {
  const counts = {};
  for (const table of COUNTED) {
    try {
      counts[table] = db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
    } catch {
      counts[table] = null; // not present in this database, which is a fact too
    }
  }
  return counts;
}

/**
 * Remove the -wal and -shm a read-only open leaves beside a WAL database.
 *
 * They contain nothing — a read-only connection cannot write to them — but a
 * backup directory should hold exactly the three things it is meant to. A
 * sidecar beside a backup invites the reader to wonder whether the main file
 * is complete, which is the doubt this whole script exists to remove.
 */
function tidySidecars(dbFile) {
  for (const suffix of ['-wal', '-shm']) {
    try { fs.rmSync(`${dbFile}${suffix}`, { force: true }); } catch { /* not there */ }
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copyStore(from, to) {
  fs.mkdirSync(to, { recursive: true });
  if (!fs.existsSync(from)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name);
    if (!fs.statSync(src).isFile()) continue;
    fs.copyFileSync(src, path.join(to, name));
    files += 1;
    bytes += fs.statSync(src).size;
  }
  return { files, bytes };
}

/* ------------------------------------------------------------------ take one */

async function take(destRoot) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(destRoot, `thriv3-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  const dbFile = path.join(dir, 'database.sqlite');

  // THE ONLINE BACKUP API, not a file copy. It reads through SQLite, so the
  // result includes everything committed — including whatever is still only in
  // the write-ahead log — and is a consistent single file with no -wal beside it.
  const live = new Database(DB_PATH, { readonly: true });
  const liveCounts = countRows(live);
  await live.backup(dbFile);
  live.close();

  const store = copyStore(STORE, path.join(dir, 'reports'));
  const uploads = copyStore(UPLOADS, path.join(dir, 'uploads'));

  // OPEN THE COPY AND COUNT IT. This is the step that makes it a backup.
  const copy = new Database(dbFile, { readonly: true });
  const integrity = copy.pragma('integrity_check', { simple: true });
  const copyCounts = countRows(copy);
  const artefactRows = (() => {
    try {
      return copy.prepare("SELECT COUNT(*) n FROM generated_reports WHERE status = 'generated'")
        .get().n;
    } catch { return null; }
  })();
  copy.close();
  tidySidecars(dbFile);

  const drift = COUNTED.filter((t) => liveCounts[t] !== copyCounts[t]);
  const manifest = {
    takenAt: new Date().toISOString(),
    source: { database: DB_PATH, reportStore: STORE },
    integrityCheck: integrity,
    rowCounts: copyCounts,
    databaseBytes: fs.statSync(dbFile).size,
    databaseSha256: sha256(dbFile),
    artefacts: store,
    uploads,
    generatedReportRows: artefactRows,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`\nBackup written to ${dir}\n`);
  console.log(`  integrity_check         ${integrity}`);
  console.log(`  database                ${(manifest.databaseBytes / 1e6).toFixed(1)} MB`);
  console.log(`  report artefacts        ${store.files} file(s), `
    + `${(store.bytes / 1e6).toFixed(1)} MB`);
  console.log(`  uploaded files          ${uploads.files} file(s), `
    + `${(uploads.bytes / 1e6).toFixed(1)} MB`);
  console.log(`  generated_reports rows  ${artefactRows}`);
  for (const table of COUNTED) {
    if (copyCounts[table] !== null) console.log(`  ${table.padEnd(22)}  ${copyCounts[table]}`);
  }

  if (integrity !== 'ok') {
    console.error('\n  INTEGRITY CHECK FAILED. This is not a usable backup.\n');
    process.exitCode = 1;
    return;
  }
  if (drift.length) {
    // Only possible if something wrote during the copy. Reported, not hidden:
    // the backup is consistent, but it is a moment later than the count above.
    console.warn(`\n  Note: ${drift.join(', ')} changed while the backup ran; `
      + 'the copy is consistent at its own moment.\n');
  }

  // The artefact/database consistency contract, checked rather than assumed.
  reportOrphans(dir);
}

/* --------------------------------------------------------------- verify one */

function reportOrphans(dir) {
  const dbFile = path.join(dir, 'database.sqlite');
  const storeDir = path.join(dir, 'reports');
  const db = new Database(dbFile, { readonly: true });
  let rows;
  try {
    rows = db.prepare("SELECT id, artifact_path FROM generated_reports WHERE status = 'generated'")
      .all();
  } catch {
    db.close();
    tidySidecars(dbFile);
    return;
  }
  db.close();
  tidySidecars(dbFile);

  // Every path a row points into the upload directory for, checked the same
  // way: an athlete whose analysis file is absent shows "No matches yet",
  // which is indistinguishable from never having been analysed.
  const uploadsDir = path.join(dir, 'uploads');
  const uploaded = new Set(fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : []);
  const analyses = (() => {
    const check = new Database(dbFile, { readonly: true });
    let rows = [];
    try {
      rows = check.prepare('SELECT full_name, recommendations FROM players '
        + "WHERE recommendations LIKE '/uploads/%'").all();
    } catch { /* older database */ }
    check.close();
    tidySidecars(dbFile);
    return rows.filter((r) => !uploaded.has(path.basename(r.recommendations)));
  })();
  if (analyses.length) {
    console.log(`\n  ${analyses.length} athlete(s) point at a stored analysis this backup does `
      + `not hold: ${analyses.map((a) => a.full_name).join(', ')}. `
      + 'Their Program Philosophy tab would read "No matches yet".');
  }

  const onDisk = new Set(fs.existsSync(storeDir) ? fs.readdirSync(storeDir) : []);
  const missing = rows.filter((r) => r.artifact_path && !onDisk.has(r.artifact_path));
  const unreferenced = [...onDisk]
    .filter((f) => f.endsWith('.pdf') && !rows.some((r) => r.artifact_path === f));

  if (!missing.length && !unreferenced.length) {
    console.log(`\n  ${rows.length} generated report(s), every artefact present.\n`);
    return;
  }
  // Both directions are reported and neither is repaired. A missing artefact
  // is NOT regenerated: a document that was sent cannot be recreated from
  // today's data and called the same document.
  // Reported on stdout, with everything else an operator reads: these are
  // findings about the backup, not faults in taking it. Only a failed
  // integrity check goes to stderr and sets a non-zero exit.
  if (missing.length) {
    console.log(`\n  ${missing.length} history row(s) have no artefact in this backup. `
      + 'They stay recorded and unregenerated; the screen tells an operator to regenerate.');
  }
  if (unreferenced.length) {
    console.log(`  ${unreferenced.length} artefact(s) have no history row. `
      + 'Harmless, and kept: deleting a file nothing points at is how the wrong file gets deleted.');
  }
  console.log('');
}

function verify(dir) {
  const dbFile = path.join(dir, 'database.sqlite');
  const manifestFile = path.join(dir, 'manifest.json');
  if (!fs.existsSync(dbFile)) throw new Error(`${dir} has no database.sqlite.`);

  const db = new Database(dbFile, { readonly: true });
  const integrity = db.pragma('integrity_check', { simple: true });
  const counts = countRows(db);
  db.close();
  tidySidecars(dbFile);

  console.log(`\nVerifying ${dir}\n`);
  console.log(`  integrity_check  ${integrity}`);
  const hash = sha256(dbFile);
  console.log(`  sha256           ${hash.slice(0, 16)}…`);

  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const changed = manifest.databaseSha256 && manifest.databaseSha256 !== hash;
    console.log(`  taken            ${manifest.takenAt}`);
    console.log(`  matches manifest ${changed ? 'NO — the file has changed since it was taken' : 'yes'}`);
    const rowDrift = COUNTED.filter((t) => (manifest.rowCounts?.[t] ?? null) !== counts[t]);
    if (rowDrift.length) console.log(`  row counts differ from the manifest: ${rowDrift.join(', ')}`);
    if (changed) process.exitCode = 1;
  }
  for (const table of COUNTED) {
    if (counts[table] !== null) console.log(`  ${table.padEnd(22)}  ${counts[table]}`);
  }
  if (integrity !== 'ok') process.exitCode = 1;
  reportOrphans(dir);
}

/* -------------------------------------------------------------- restore one */

function restore(dir, into) {
  const dbFile = path.join(dir, 'database.sqlite');
  if (!fs.existsSync(dbFile)) throw new Error(`${dir} has no database.sqlite.`);
  fs.mkdirSync(into, { recursive: true });

  const targetDb = path.join(into, 'recruitmatch.sqlite');
  const targetStore = path.join(into, 'reports');
  const targetUploads = path.join(into, 'uploads');

  // REFUSE TO OVERWRITE. A restore into a live directory is how a bad restore
  // becomes an unrecoverable one: the thing you would have gone back to is
  // gone. Restore beside it, look, then move.
  if (fs.existsSync(targetDb)) {
    throw new Error(`${targetDb} already exists. Restore into an empty directory, `
      + 'check it, then swap it in — never over a live database.');
  }

  fs.copyFileSync(dbFile, targetDb);
  const store = copyStore(path.join(dir, 'reports'), targetStore);
  const uploads = copyStore(path.join(dir, 'uploads'), targetUploads);

  const db = new Database(targetDb, { readonly: true });
  const integrity = db.pragma('integrity_check', { simple: true });
  const counts = countRows(db);
  db.close();

  console.log(`\nRestored ${dir} into ${into}\n`);
  console.log(`  integrity_check  ${integrity}`);
  console.log(`  artefacts        ${store.files} file(s)`);
  console.log(`  uploads          ${uploads.files} file(s)`);
  for (const table of COUNTED) {
    if (counts[table] !== null) console.log(`  ${table.padEnd(22)}  ${counts[table]}`);
  }
  console.log('\nStart the app against it with:\n');
  console.log(`  RECRUITMATCH_DB=${targetDb} \\\n    THRIV3_REPORT_STORE=${targetStore} \\`
    + `\n    THRIV3_UPLOAD_DIR=${targetUploads} \\`
    + '\n    node server/index.js\n');
  if (integrity !== 'ok') process.exitCode = 1;
}

/* --------------------------------------------------------------------- main */

try {
  const target = args.find((a) => !a.startsWith('--')
    && args[args.indexOf(a) - 1] !== '--into');
  if (has('verify')) {
    verify(path.resolve(flagValue('verify') || target || '.'));
  } else if (has('restore')) {
    const from = path.resolve(flagValue('restore') || target || '.');
    const into = flagValue('into');
    if (!into) throw new Error('--restore needs --into <empty directory>.');
    restore(from, path.resolve(into));
  } else {
    const dest = target || process.env.THRIV3_BACKUP_DIR;
    if (!dest) {
      console.error('Usage: node server/scripts/backup.js <destination-directory>');
      console.error('       node server/scripts/backup.js --verify <backup-directory>');
      console.error('       node server/scripts/backup.js --restore <backup-directory> --into <empty-directory>');
      process.exitCode = 1;
    } else {
      await take(path.resolve(dest));
    }
  }
} catch (err) {
  console.error(`\n${err.message}\n`);
  process.exitCode = 1;
}
