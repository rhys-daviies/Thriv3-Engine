/**
 * BACKUP AND RESTORE — Phase 13K.
 *
 * The test that matters is the first one, and it is the reason this script
 * exists: in Phase 13J a `cp` of the working database was taken as a backup
 * and the copy was missing committed rows, because SQLite in WAL mode holds
 * them in a separate write-ahead log. It looked like a backup. It would have
 * restored as a silently older database.
 *
 * So this proves the file copy is wrong and the online backup API is right, on
 * the same database, in the same state — and then that a backup can actually be
 * restored, which is the only thing that makes it a backup.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-backup-'));
const LIVE_DB = path.join(root, 'live', 'recruitmatch.sqlite');
const LIVE_STORE = path.join(root, 'live', 'reports');
const BACKUPS = path.join(root, 'backups');
const REPO = path.resolve(import.meta.dirname, '../..');

const ARTEFACT = 'cccccccccccccccccccccccc';

/** Runs a command the way an operator would, and returns what they would read. */
const run = (args, env = {}) => execFileSync('node', args, {
  cwd: REPO,
  encoding: 'utf8',
  env: { ...process.env, RECRUITMATCH_DB: LIVE_DB, THRIV3_REPORT_STORE: LIVE_STORE, ...env },
});

beforeAll(() => {
  fs.mkdirSync(path.dirname(LIVE_DB), { recursive: true });
  fs.mkdirSync(LIVE_STORE, { recursive: true });

  // A real database, built by the application's own schema and migrations, so
  // this rehearses the shape that would actually be restored.
  run(['-e', "import('./server/db/client.js').then(() => process.exit(0))"]);

  const db = new Database(LIVE_DB);
  db.pragma('journal_mode = WAL');
  db.prepare(`INSERT INTO players
    (id, created_date, updated_date, full_name, sport, position)
    VALUES ('p1', '2026-01-01', '2026-01-01', 'Test Athlete', 'mens-soccer', 'Defender')`).run();
  db.prepare(`INSERT INTO generated_reports
    (id, report_type, athlete_id, college_id, sport, athlete_name, college_name,
     filename, artifact_path, page_count, byte_size, sha256, content_sha256,
     status, generated_at)
    VALUES (?, 'athlete', 'p1', 'c1', 'mens-soccer', 'Test Athlete', 'Test College',
     'Thriv3_Test_Athlete_Test_College_Mens_Soccer.pdf', ?, 31, 12, 'aa', 'bb',
     'generated', '2026-09-03T00:00:00.000Z')`).run(ARTEFACT, `${ARTEFACT}.pdf`);
  fs.writeFileSync(path.join(LIVE_STORE, `${ARTEFACT}.pdf`), Buffer.from('%PDF-1.7\n% artefact\n'));

  // LEFT OPEN AND UNCHECKPOINTED, on purpose. This is the state the 13J
  // mistake was made in: rows committed, sitting in the -wal file, and the
  // main database file on disk not yet holding them.
  expect(fs.existsSync(`${LIVE_DB}-wal`)).toBe(true);
  db.close({ /* no checkpoint */ });
});

afterAll(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* gone */ } });

describe('the WAL lesson from 13J', () => {
  it('a plain file copy of a WAL database can be missing committed rows', async () => {
    // Reopen and commit more without checkpointing, so the copy is provably
    // behind the live database.
    const live = new Database(LIVE_DB);
    live.pragma('journal_mode = WAL');
    for (let i = 2; i <= 6; i += 1) {
      live.prepare(`INSERT INTO players
        (id, created_date, updated_date, full_name, sport, position)
        VALUES (?, '2026-01-01', '2026-01-01', ?, 'mens-soccer', 'Defender')`)
        .run(`p${i}`, `Athlete ${i}`);
    }
    const liveCount = live.prepare('SELECT COUNT(*) n FROM players').get().n;

    const naive = path.join(root, 'naive-copy.sqlite');
    fs.copyFileSync(LIVE_DB, naive); // NOT a backup. The -wal is left behind.
    const copied = new Database(naive, { readonly: true });
    const naiveCount = copied.prepare('SELECT COUNT(*) n FROM players').get().n;
    copied.close();

    // The exact failure: a copy that opens cleanly, reports a plausible count,
    // and is a different database from the one it was taken of.
    expect(naiveCount).toBeLessThan(liveCount);

    // The online backup API, on the same database in the same state. It is
    // ASYNCHRONOUS — a synchronous call followed by close() leaves no file at
    // all, which is its own way of producing a backup that is not one.
    const proper = path.join(root, 'proper-copy.sqlite');
    await live.backup(proper);
    live.close();
    const good = new Database(proper, { readonly: true });
    expect(good.prepare('SELECT COUNT(*) n FROM players').get().n).toBe(liveCount);
    expect(good.pragma('integrity_check', { simple: true })).toBe('ok');
    good.close();
  });
});

describe('taking a backup', () => {
  let dir;

  it('copies the database and the artefacts together, and counts what it took', () => {
    const output = run(['server/scripts/backup.js', BACKUPS]);
    dir = fs.readdirSync(BACKUPS).map((d) => path.join(BACKUPS, d))[0];

    expect(output).toMatch(/integrity_check\s+ok/);
    expect(output).toMatch(/report artefacts\s+1 file/);
    expect(output).toMatch(/every artefact present/);

    expect(fs.existsSync(path.join(dir, 'database.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'reports', `${ARTEFACT}.pdf`))).toBe(true);

    // Exactly four things, and no WAL sidecar left behind by the read that
    // verified it — asserted here, before this suite opens the copy itself and
    // creates its own. A stray -wal beside a backup invites the reader to
    // wonder whether the main file is complete.
    expect(fs.readdirSync(dir).sort())
      .toEqual(['database.sqlite', 'manifest.json', 'reports', 'uploads']);

    // BOTH HALVES, TOGETHER. A database restored beside an older artefact
    // store is a history promising documents the store does not have.
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    expect(manifest.integrityCheck).toBe('ok');
    expect(manifest.rowCounts.generated_reports).toBe(1);
    expect(manifest.rowCounts.players).toBe(6);
    expect(manifest.artefacts).toEqual({ files: 1, bytes: 20 });
    expect(manifest.databaseSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('holds every row that was committed, including the ones only in the log', () => {
    const db = new Database(path.join(dir, 'database.sqlite'), { readonly: true });
    // The five inserts above were never checkpointed. A file copy loses them.
    expect(db.prepare('SELECT COUNT(*) n FROM players').get().n).toBe(6);
    expect(db.prepare('SELECT COUNT(*) n FROM generated_reports').get().n).toBe(1);
    db.close();

    // AND THE FILE ALONE IS THE BACKUP. Copied away from its directory, with
    // nothing beside it, it still holds every row — which is the property a
    // file copy of a live WAL database does not have.
    const alone = path.join(root, 'alone.sqlite');
    fs.copyFileSync(path.join(dir, 'database.sqlite'), alone);
    const solo = new Database(alone, { readonly: true });
    expect(solo.prepare('SELECT COUNT(*) n FROM players').get().n).toBe(6);
    expect(solo.pragma('integrity_check', { simple: true })).toBe('ok');
    solo.close();
  });

  it('verifies itself, and notices tampering', () => {
    expect(run(['server/scripts/backup.js', '--verify', dir])).toMatch(/matches manifest yes/);

    // A backup nobody has read is a hope; a backup whose bytes have changed
    // since it was taken is worse, because the manifest still describes the
    // original.
    const copy = path.join(root, 'tampered');
    fs.cpSync(dir, copy, { recursive: true });
    const db = new Database(path.join(copy, 'database.sqlite'));
    db.prepare("DELETE FROM players WHERE id = 'p6'").run();
    db.close();

    let output = '';
    try {
      output = run(['server/scripts/backup.js', '--verify', copy]);
    } catch (err) {
      // Non-zero exit is the point; the output is on stdout either way.
      output = err.stdout || '';
    }
    expect(output).toMatch(/matches manifest NO/);
  });

  it('reports a history row whose artefact is missing, and does not regenerate it', () => {
    const broken = path.join(root, 'missing-artefact');
    fs.cpSync(dir, broken, { recursive: true });
    fs.rmSync(path.join(broken, 'reports', `${ARTEFACT}.pdf`));

    const output = run(['server/scripts/backup.js', '--verify', broken]);
    expect(output).toMatch(/1 history row\(s\) have no artefact/);
    // HISTORICAL INTEGRITY WINS. A document that was sent cannot be recreated
    // from today's data and called the same document, so the row stays
    // recorded and unregenerated.
    expect(output).toMatch(/stay recorded and unregenerated/);
    expect(fs.existsSync(path.join(broken, 'reports', `${ARTEFACT}.pdf`))).toBe(false);
  });

  it('reports an artefact with no history row, and keeps it', () => {
    const orphan = path.join(root, 'orphan-artefact');
    fs.cpSync(dir, orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, 'reports', 'dddddddddddddddddddddddd.pdf'), '%PDF-1.7\n');

    const output = run(['server/scripts/backup.js', '--verify', orphan]);
    expect(output).toMatch(/1 artefact\(s\) have no history row/);
    // Kept: deleting a file nothing points at is how the wrong file gets
    // deleted, and an unreferenced artefact harms nobody.
    expect(fs.existsSync(path.join(orphan, 'reports', 'dddddddddddddddddddddddd.pdf'))).toBe(true);
  });
});

describe('restoring one', () => {
  let dir;
  const target = path.join(root, 'restored');

  beforeAll(() => { [dir] = fs.readdirSync(BACKUPS).map((d) => path.join(BACKUPS, d)); });

  it('restores the database and every artefact into an empty directory', () => {
    const output = run(['server/scripts/backup.js', '--restore', dir, '--into', target]);
    expect(output).toMatch(/integrity_check\s+ok/);
    expect(output).toMatch(/artefacts\s+1 file/);
    expect(output).toMatch(/players\s+6/);
    // It prints the exact command to run the app against what it restored.
    expect(output).toMatch(/RECRUITMATCH_DB=.*recruitmatch\.sqlite/);
    expect(output).toMatch(/THRIV3_REPORT_STORE=/);
  });

  it('produces a database and store the application can serve from', () => {
    const db = new Database(path.join(target, 'recruitmatch.sqlite'), { readonly: true });
    const row = db.prepare('SELECT * FROM generated_reports WHERE id = ?').get(ARTEFACT);
    db.close();

    // The history row and the artefact it names, both present and agreeing —
    // which is what an operator opening their history after a restore needs.
    expect(row.filename).toBe('Thriv3_Test_Athlete_Test_College_Mens_Soccer.pdf');
    expect(row.page_count).toBe(31);
    const bytes = fs.readFileSync(path.join(target, 'reports', row.artifact_path));
    expect(bytes.toString('latin1')).toContain('%PDF');
  });

  it('refuses to restore over a live database', () => {
    // A restore into a live directory is how a bad restore becomes an
    // unrecoverable one: the thing you would have gone back to is gone.
    let message = '';
    try {
      run(['server/scripts/backup.js', '--restore', dir, '--into', target]);
    } catch (err) {
      message = (err.stdout || '') + (err.stderr || '');
    }
    expect(message).toMatch(/already exists/);
    expect(message).toMatch(/never over a live database/);
  });
});
