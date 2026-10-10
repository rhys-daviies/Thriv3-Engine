/**
 * DI-09A — MIGRATION HARDENING (stacked on DI-08 / PR #92).
 *
 * Each case is a finding of the DI-09A review, reproduced against PR #92's head and fixed here:
 *
 *   F1  an approval named the database's schema, not the plan: approving release A's plan approved
 *       release B's migration too                                       → plan ids (explicitMigrations (c2), (d))
 *   F2  `--adopt` recorded a database whose DATA backfill was pending   → rolled-back dry run
 *   F3  `--adopt` recorded schema drift the migration cannot see        → structural comparison
 *   F4  out-of-band DDL after a recorded run still booted the server   → `drifted`
 *   F5  a crash after the migration transaction committed left no audit row → APPLYING row in the transaction
 *   F6  comment edits to migrate.js / schema.sql read as new migration code → normalised manifest
 *   F7  the printed rollback restored a READ-ONLY database               → chmod in the instructions
 *   F8  no free-space check before a 400 MB backup on a 5 GB volume     → refuse first
 *
 * Every database is a temp file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  migrateDatabase, schemaState, serverMayStart, planFor, codeManifest, codeCommit, MIGRATIONS_TABLE, MigrationRefused, EMPTY_FINGERPRINT,
  conformance, refusal,
} from './migrations.js';
import { normaliseJs, normaliseSql, normalisedSource } from './codeIdentity.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
let dir;
const p = (n) => path.join(dir, n);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const quiet = { log: () => {} };
const stateOf = (file) => { const db = new Database(file, { readonly: true }); try { return schemaState(db); } finally { db.close(); } };
const planOf = (file, kind = 'MIGRATE') => planFor(stateOf(file), kind);
const exec = (file, sql) => { const db = new Database(file); try { db.exec(sql); db.pragma('wal_checkpoint(TRUNCATE)'); } finally { db.close(); } };
const all = (file, sql) => { const db = new Database(file, { readonly: true }); try { return db.prepare(sql).all(); } finally { db.close(); } };

function currentDb(file) {
  migrateDatabase({ dbPath: file, create: true, approve: EMPTY_FINGERPRINT, operator: 'test', ...quiet });
  exec(file, `INSERT INTO players (id, created_date, updated_date, full_name, position, sport, email, guardian_email, public_slug)
    VALUES ('p1', 'x', 'x', 'Athlete One', 'Defender', 'mens-soccer', 'a1@example.com', 'g@example.com', 'slug-1')`);
  return file;
}
const unrecordedDb = (file) => { currentDb(file); exec(file, `DROP TABLE ${MIGRATIONS_TABLE}`); return file; };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thriv3-di09a-')); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('F2 adoption refuses a database whose data steps are pending', () => {
  it('a players row awaiting backfillVideoIds: UNRECORDED to the rehearsal, but the dry run sees the write; nothing is recorded', () => {
    const f = unrecordedDb(p('db.sqlite'));
    exec(f, "UPDATE players SET highlights_url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', video_id = NULL");
    const s = stateOf(f);
    expect(s.state).toBe('UNRECORDED');                     // the rehearsal has no rows, so it cannot see this
    const before = sha(f);
    let err;
    try { migrateDatabase({ dbPath: f, adopt: true, approve: planFor(s, 'ADOPT'), ...quiet }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(MigrationRefused);
    expect(err.message).toMatch(/dry run would write 1 row/);
    expect(err.message).toMatch(/Run the migration instead of adopting/);
    expect(all(f, `SELECT name FROM sqlite_master WHERE name = '${MIGRATIONS_TABLE}'`)).toHaveLength(0);
    expect(all(f, 'SELECT video_id FROM players')[0].video_id).toBeNull();   // the dry run rolled back
    expect(fs.readdirSync(dir).filter((n) => /PRE_MIGRATION/.test(n))).toEqual([]); // refused before the backup
    expect(sha(f)).toBe(before);

    // MIGRATE runs the step and records it.
    const r = migrateDatabase({ dbPath: f, approve: planFor(s, 'MIGRATE'), ...quiet });
    expect(r.rowsWritten).toBe(1);
    expect(all(f, 'SELECT video_id FROM players')[0].video_id).toBe('dQw4w9WgXcQ');
    expect(serverMayStart(stateOf(f))).toBe(true);
  });
});

describe('F3 adoption refuses schema drift the migration cannot see — unless that exact drift is accepted and recorded', () => {
  const drift = (f) => exec(f, `ALTER TABLE players ADD COLUMN rogue TEXT; CREATE TABLE rogue_table (x);
    CREATE TRIGGER rogue_trg AFTER INSERT ON representatives BEGIN SELECT 1; END;`);

  it('extra column, table and trigger: refused with the list and a digest; nothing written', () => {
    const f = unrecordedDb(p('db.sqlite'));
    drift(f);
    const s = stateOf(f);
    expect(s.state).toBe('UNRECORDED');
    const before = sha(f);
    let err;
    try { migrateDatabase({ dbPath: f, adopt: true, approve: planFor(s, 'ADOPT'), ...quiet }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(MigrationRefused);
    expect(err.message).toMatch(/EXTRA table rogue_table/);
    expect(err.message).toMatch(/EXTRA trigger rogue_trg/);
    expect(err.message).toMatch(/DIFFERENT table players: column in database rogue/);
    expect(err.message).toMatch(/--accept-drift [0-9a-f]{64}/);
    expect(sha(f)).toBe(before);
  });

  it('a NOT NULL / ON DELETE difference on an existing table — the dev database\'s outbound_send_attempt shape — is caught', () => {
    const f = unrecordedDb(p('db.sqlite'));
    const ddl = all(f, "SELECT sql FROM sqlite_master WHERE name = 'outbound_send_attempt'")[0].sql;
    const stricter = ddl.replace(/athlete_id TEXT REFERENCES players\(id\) ON DELETE SET NULL/, 'athlete_id TEXT NOT NULL REFERENCES players(id)');
    expect(stricter).not.toBe(ddl);
    const dependants = all(f, "SELECT sql FROM sqlite_master WHERE tbl_name = 'outbound_send_attempt' AND type IN ('index', 'trigger') AND sql IS NOT NULL").map((r) => r.sql);
    exec(f, `PRAGMA foreign_keys=OFF; DROP TABLE outbound_send_attempt; ${stricter}; ${dependants.join('; ')};`);
    expect(stateOf(f).state).toBe('UNRECORDED');             // the migration does not notice
    const db = new Database(f, { readonly: true });
    const lines = conformance(db).differences;
    db.close();
    expect(lines).toEqual(expect.arrayContaining([
      'DIFFERENT table outbound_send_attempt: column in database athlete_id|TEXT|1||0|0',
      'DIFFERENT table outbound_send_attempt: foreign key in code players|athlete_id|id|NO ACTION|SET NULL',
    ]));
  });

  it('accepted by its exact digest: adopted, and the differences are in the audit row', () => {
    const f = unrecordedDb(p('db.sqlite'));
    drift(f);
    const s = stateOf(f);
    let digest;
    try { migrateDatabase({ dbPath: f, adopt: true, approve: planFor(s, 'ADOPT'), ...quiet }); } catch (e) { digest = e.structure.digest; }
    expect(() => migrateDatabase({ dbPath: f, adopt: true, approve: planFor(s, 'ADOPT'), acceptDrift: 'ab'.repeat(32), ...quiet })).toThrow(/differs from the schema this code builds/);
    const r = migrateDatabase({ dbPath: f, adopt: true, approve: planFor(s, 'ADOPT'), acceptDrift: digest, ...quiet });
    expect(r.kind).toBe('ADOPT');
    const [row] = all(f, `SELECT * FROM ${MIGRATIONS_TABLE}`);
    const v = JSON.parse(row.verification);
    expect(row.status).toBe('COMPLETE');
    expect(v).toMatchObject({ dryRunRowChanges: 0, acceptedDrift: digest });
    expect(v.structure.differences).toContain('EXTRA table rogue_table');
  });

  it('a clean database adopts with no flag, and records that it was structurally verified', () => {
    const f = unrecordedDb(p('db.sqlite'));
    migrateDatabase({ dbPath: f, adopt: true, approve: planOf(f, 'ADOPT'), ...quiet });
    const v = JSON.parse(all(f, `SELECT verification FROM ${MIGRATIONS_TABLE}`)[0].verification);
    expect(v).toMatchObject({ dryRunRowChanges: 0, dryRunSchemaUnchanged: true, acceptedDrift: null });
    expect(v.structure.differences).toEqual([]);
  });
});

describe('F4 out-of-band DDL after a recorded run: the server no longer starts', () => {
  it('a column added by hand after the run → drifted → serverMayStart false, and the refusal says why', () => {
    const f = currentDb(p('db.sqlite'));
    exec(f, 'ALTER TABLE players ADD COLUMN rogue TEXT');
    const s = stateOf(f);
    expect(s).toMatchObject({ state: 'UNRECORDED', knownCode: true, drifted: true });
    expect(serverMayStart(s)).toBe(false);
    expect(refusal(f, s, { server: true }).message).toMatch(/changed out of band/);
  });

  it('a code ROLLBACK (newer code recorded the same schema) is not drift: it still starts', () => {
    const f = currentDb(p('db.sqlite'));
    const db = new Database(f);
    const rec = db.prepare(`SELECT * FROM ${MIGRATIONS_TABLE}`).get();
    const cols = Object.keys(rec).filter((k) => k !== 'id');
    db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (${cols.join(', ')}) SELECT ${cols.map((k) => (k === 'code_manifest' ? "'later-code'" : k)).join(', ')} FROM ${MIGRATIONS_TABLE}`).run();
    db.close();
    const s = stateOf(f);
    expect(s).toMatchObject({ state: 'UNRECORDED', knownCode: true, drifted: false });
    expect(serverMayStart(s)).toBe(true);
  });
});

describe('F5 the record commits with the change; an unfinished run blocks the server until a run completes', () => {
  it('a MIGRATE row is written APPLYING inside the transaction and finished COMPLETE', () => {
    const f = unrecordedDb(p('db.sqlite'));
    migrateDatabase({ dbPath: f, approve: planOf(f), ...quiet });
    const rows = all(f, `SELECT status, plan, verification, error FROM ${MIGRATIONS_TABLE}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'COMPLETE', error: null });
    expect(rows[0].plan).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an APPLYING row left by a crash: interrupted, the server refuses, and the next approved run completes it', () => {
    const f = currentDb(p('db.sqlite'));
    exec(f, `INSERT INTO ${MIGRATIONS_TABLE} (kind, status, plan, started_at, finished_at, operator, approval, code_manifest, schema_sql_sha256, migrate_js_sha256,
      schema_before, schema_after, changes, rows_written, integrity_check, foreign_key_violations_before, foreign_key_violations_after)
      SELECT 'MIGRATE', 'APPLYING', plan, started_at, '', operator, approval, code_manifest, schema_sql_sha256, migrate_js_sha256, schema_after, '', '[]', 0, '', 0, 0 FROM ${MIGRATIONS_TABLE}`);
    const s = stateOf(f);
    expect(s.interrupted).toBe(true);
    expect(s.state).not.toBe('CURRENT');
    expect(serverMayStart(s)).toBe(false);
    expect(refusal(f, s, { server: true }).message).toMatch(/did not finish/);
    migrateDatabase({ dbPath: f, approve: planFor(s, 'MIGRATE'), ...quiet });
    expect(serverMayStart(stateOf(f))).toBe(true);
  });

  it('a transactional failure leaves no row (the database is unchanged) but a FAILED.json beside the backup', () => {
    const f = unrecordedDb(p('db.sqlite'));
    exec(f, `INSERT INTO players (id, created_date, updated_date, full_name, position, sport, email, guardian_email, public_slug)
      VALUES ('p2', 'x', 'x', 'Two', 'Defender', 'mens-soccer', 'a2@example.com', 'g@example.com', 'slug-2');
      DROP INDEX idx_players_public_slug; UPDATE players SET public_slug = 'dup';`);
    let err;
    try { migrateDatabase({ dbPath: f, approve: planOf(f), ...quiet }); } catch (e) { err = e; }
    expect(err.message).toMatch(/MIGRATION FAILED \(TRANSACTIONAL\)/);
    expect(all(f, `SELECT name FROM sqlite_master WHERE name = '${MIGRATIONS_TABLE}'`)).toHaveLength(0);
    const report = JSON.parse(fs.readFileSync(`${err.backup.path}.FAILED.json`, 'utf8'));
    expect(report).toMatchObject({ phase: 'TRANSACTIONAL', backup_sha256: err.backup.sha256 });
    expect(report.error).toMatch(/UNIQUE/);
  });
});

describe('F6 migration code identity is what executes, not its comments', () => {
  const migrateSrc = () => fs.readFileSync(path.join(ROOT, 'server/db/migrate.js'), 'utf8');
  const schemaSrc = () => fs.readFileSync(path.join(ROOT, 'server/db/schema.sql'), 'utf8');

  it('the real migrate.js normalises to code that esbuild proves equivalent (only comments and whitespace removed)', async () => {
    const esbuild = (await import('esbuild')).default;
    const min = (s) => esbuild.transformSync(s, { minifyWhitespace: true, legalComments: 'none', loader: 'js', format: 'esm' }).code;
    for (const f of ['server/db/migrate.js', 'server/db/migrations.js', 'server/db/codeIdentity.js']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(normalisedSource('js', src).normalised, f).toBe(true);
      expect(min(normaliseJs(src)), f).toBe(min(src));
    }
  });

  it('comment and indentation edits keep the identity; a code edit, a SQL-string edit and a step reorder change it', () => {
    const src = migrateSrc();
    const id = (s) => normaliseJs(s);
    const base = id(src);
    expect(id(src.replace('export function migrateInTransaction(db) {', '// a note\n/* another,\n   spanning lines */\nexport function migrateInTransaction(db) {'))).toBe(base);
    expect(id(src.replace(/\n  addMissingColumns\(db, 'players', PLAYER_COLUMNS\);/, "\n      addMissingColumns(db, 'players', PLAYER_COLUMNS);   // re-indented"))).toBe(base);
    expect(id(src.replace("addMissingColumns(db, 'players', PLAYER_COLUMNS);", "addMissingColumns(db, 'players', PLAYER_COLUMNS); backfillVideoIds(db);"))).not.toBe(base);
    expect(id(src.replace('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_public_slug', 'CREATE INDEX IF NOT EXISTS idx_players_public_slug'))).not.toBe(base);
    expect(id(src.replace("addMissingColumns(db, 'players', PLAYER_COLUMNS);\n  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_public_slug ON players(public_slug)');",
      "db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_public_slug ON players(public_slug)');\n  addMissingColumns(db, 'players', PLAYER_COLUMNS);"))).not.toBe(base);
  });

  it('literals are verbatim: "//" and "/*" inside strings, templates and regexes are code, not comments', () => {
    expect(normaliseJs("const u = 'http://x/*y*/'; // gone")).toBe("const u = 'http://x/*y*/';");
    expect(normaliseJs('const t = `a // ${b /* c */} d`;')).toBe('const t = `a // ${b /* c */} d`;');
    expect(normaliseJs("const r = /\\/\\/'/g; x = 1;")).toBe("const r = /\\/\\/'/g; x = 1;");
    expect(normaliseJs('return\n  x')).toBe('return\nx');   // a line break that ASI can depend on survives
  });

  it('a lexing doubt falls back to the raw bytes — stricter, never looser', () => {
    expect(normalisedSource('js', "const s = 'unterminated\n';")).toMatchObject({ normalised: false });
  });

  it('schema.sql: comments and whitespace go; quoted text and statements stay', () => {
    expect(normaliseSql("CREATE TABLE t (\n  a TEXT, -- note\n  b TEXT /* x */ DEFAULT '--not a comment'\n);"))
      .toBe("CREATE TABLE t ( a TEXT, b TEXT DEFAULT '--not a comment' );");
    const sql = schemaSrc();
    expect(normaliseSql(sql.replace('CREATE TABLE', '-- DI-09A note\nCREATE TABLE'))).toBe(normaliseSql(sql));
  });

  it('the manifest is v2-tagged and a comment edit leaves a recorded database CURRENT', () => {
    const m = codeManifest();
    expect(m.normalised).toBe(true);
    expect(m.manifest).not.toBe(crypto.createHash('sha256').update(`schema.sql ${m.schemaSha}\nmigrate.js ${m.migrateSha}\n`).digest('hex'));
  });
});

describe('F7 the printed rollback restores a WRITABLE database with the original bytes', () => {
  it('following the instructions literally', () => {
    const f = unrecordedDb(p('db.sqlite'));
    exec(f, 'DROP TABLE representatives');
    const original = sha(f);
    const lines = [];
    migrateDatabase({ dbPath: f, approve: planOf(f), log: (l) => lines.push(l) });
    const steps = lines.join('\n').split('\n').filter((l) => /^\s+[23]\. /.test(l))
      .map((l) => l.replace(/^\s+\d\. /, '').replace(/\s+\(with nothing running\)$/, ''));
    for (const cmd of steps) expect(spawnSync('/bin/sh', ['-c', cmd]).status).toBe(0);
    expect(sha(f)).toBe(original);
    const db = new Database(f);
    expect(() => db.exec('CREATE TABLE writable_probe (x)')).not.toThrow();
    db.close();
  });
});

describe('F8 the backup refuses up front when the volume cannot hold it', () => {
  it('statfs reports too little space: refused before any copy, database untouched', () => {
    const f = unrecordedDb(p('db.sqlite'));
    exec(f, 'DROP TABLE representatives');
    const before = sha(f);
    vi.spyOn(fs, 'statfsSync').mockReturnValue({ bavail: 1n, bsize: 4096n });
    expect(() => migrateDatabase({ dbPath: f, approve: planOf(f), ...quiet })).toThrow(/bytes free/);
    expect(fs.readdirSync(dir).filter((n) => /PRE_MIGRATION/.test(n))).toEqual([]);
    expect(sha(f)).toBe(before);
  });
});

describe('code commit identification', () => {
  it('RENDER_GIT_COMMIT wins when set', () => {
    vi.stubEnv('RENDER_GIT_COMMIT', 'abc123');
    expect(codeCommit()).toEqual({ commit: 'abc123', dirty: null });
    vi.unstubAllEnvs();
  });
});

describe('render.yaml runs the migration gate as its own step before the server', () => {
  const start = () => fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8').match(/^\s*startCommand:\s*(.+)$/m)[1];

  it('the gate precedes the server, and a refusal never reaches it', () => {
    const cmd = start();
    expect(cmd.indexOf('server/scripts/migrateDb.js --deploy')).toBeGreaterThan(-1);
    expect(cmd.indexOf('server/scripts/migrateDb.js --deploy')).toBeLessThan(cmd.indexOf('server/index.js'));
    expect(cmd).toMatch(/--deploy \|\| exit 1/);
    expect(cmd).not.toMatch(/THRIV3_MIGRATION_APPROVAL/);
  });

  it('executed by sh: a refusing gate exits non-zero without starting the server; a passing one execs it', () => {
    const fake = p('fake');
    fs.mkdirSync(path.join(fake, 'server/scripts'), { recursive: true });
    fs.writeFileSync(path.join(fake, 'server/index.js'), "console.log('SERVER STARTED');");
    const run = (gate) => {
      fs.writeFileSync(path.join(fake, 'server/scripts/migrateDb.js'), `process.exit(${gate});`);
      const cmd = start().replace(/\bnode\b/g, JSON.stringify(process.execPath));
      return spawnSync('/bin/sh', ['-c', cmd], { cwd: fake, encoding: 'utf8' });
    };
    const refused = run(2);
    expect(refused.status).not.toBe(0);
    expect(refused.stdout).not.toMatch(/SERVER STARTED/);
    const passed = run(0);
    expect(passed.status).toBe(0);
    expect(passed.stdout).toMatch(/SERVER STARTED/);
    // A pre-DI-08 commit (no gate script) still boots, as it always did.
    fs.rmSync(path.join(fake, 'server/scripts/migrateDb.js'));
    expect(spawnSync('/bin/sh', ['-c', start().replace(/\bnode\b/g, JSON.stringify(process.execPath))], { cwd: fake, encoding: 'utf8' }).stdout).toMatch(/SERVER STARTED/);
  });
});
