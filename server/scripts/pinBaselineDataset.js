#!/usr/bin/env node
/**
 * MATERIALISE THE DATASET THE COMMITTED BASELINES WERE TAKEN OVER — D3.2.
 *
 *   npm run baseline:dataset -- --from server/data/recruitmatch.sqlite
 *   npm run baseline:dataset -- --from <snapshot> --force
 *   npm run baseline:dataset -- --check
 *
 * The committed hashes in `__baselines__/evidence.json` are only meaningful
 * against the rows they were taken over. That dataset is 210MB and
 * `server/data/` is gitignored, so it cannot live in the repository — this
 * command reconstitutes it locally from a database that still has it, and
 * REFUSES one that does not.
 *
 * ---------------------------------------------------------------------------
 * IT VERIFIES BEFORE IT ACCEPTS, WHICH IS THE WHOLE POINT.
 *
 * A command that copied whatever it was pointed at would recreate the defect it
 * exists to remove: the suite would go green against some other dataset and the
 * hashes would mean nothing again. So the copy's dataset manifest is computed
 * and compared to the manifest in `evidence.json`, table by table, and a
 * mismatch is an error with the differing tables named. `--force` records the
 * copy anyway and is for reading the difference, never for making a suite pass.
 *
 * SQLite's own backup API, not `cp` — the 13J lesson that
 * `server/scripts/backup.js` was written for: a file copy of a live WAL
 * database can be missing its most recent transactions, and would produce a
 * fixture that is subtly not the dataset anybody pinned.
 *
 * The result is left READ-ONLY. Opening a database through
 * `server/db/client.js` runs schema and migrations, which are writes; a
 * fixture that changes when it is read is not a fixture. The suites copy it.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  BASELINE_DB, ROOT, assertNotWorkingDatabase, fileDigest, materialiseBaselineDataset,
} from '../lib/baselineDataset.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1] ?? null;
};
const has = (name) => args.includes(`--${name}`);

const EXPECTED = path.join(ROOT, 'server/scripts/__baselines__/evidence.json');
const short = (h) => String(h ?? '').slice(0, 16);

/**
 * A SQLite database is up to three files. Leaving a stale `-wal` beside a
 * checkpointed snapshot is how a reader ends up with rows nobody pinned, which
 * is the 13J lesson pointing the other way.
 */
const removeWithSidecars = (file) => {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    try { fs.chmodSync(f, 0o600); } catch { /* absent, or already writable */ }
    fs.rmSync(f, { force: true });
  }
};

function die(message) {
  process.stderr.write(`\n  ${message}\n\n`);
  process.exit(1);
}

/**
 * The manifest of a database, computed by the SAME code the baselines use.
 *
 * `datasetManifest` reads the module-level `db` in `server/db/client.js`, which
 * resolves `RECRUITMATCH_DB` when it is first imported — so the variable is set
 * and the import is dynamic. A static import would have bound the working
 * database before this line ran, which is precisely the accident this slice is
 * also closing.
 */
async function manifestOf(dbPath) {
  process.env.RECRUITMATCH_DB = dbPath;
  const { datasetManifest } = await import(`../lib/evidenceBaseline.js?pin=${Date.now()}`);
  return datasetManifest();
}

function reportManifest(want, got) {
  process.stdout.write(`\n  dataset digest\n    pinned  ${short(want.digest)}\n    source  ${short(got.digest)}\n\n`);
  const rows = [];
  for (const w of want.tables) {
    const g = got.tables.find((t) => t.table === w.table) ?? {};
    rows.push({ table: w.table, want: w.rows, got: g.rows ?? null, same: g.digest === w.digest });
  }
  const pad = Math.max(...rows.map((r) => r.table.length));
  for (const r of rows) {
    const delta = r.got != null && r.got !== r.want ? `  (${r.got - r.want > 0 ? '+' : ''}${r.got - r.want})` : '';
    process.stdout.write(`    ${r.table.padEnd(pad)}  ${String(r.want).padStart(7)} → ${String(r.got ?? '?').padStart(7)}  ${r.same ? 'same' : 'MOVED'}${delta}\n`);
  }
  process.stdout.write('\n');
  return rows.filter((r) => !r.same).map((r) => r.table);
}

async function main() {
  assertNotWorkingDatabase();
  const want = JSON.parse(fs.readFileSync(EXPECTED, 'utf8')).manifest;

  if (has('check')) {
    if (!fs.existsSync(BASELINE_DB)) die(`No pinned dataset at ${BASELINE_DB}.`);
    /**
     * On a copy, like every other reader — reading the manifest means opening
     * the database, and opening it runs schema and migrations. The fixture is
     * read-only precisely so that cannot happen to it, so `--check` must not
     * be the one command that needs it writable.
     */
    const dataset = materialiseBaselineDataset({ label: 'check' });
    try {
      const got = await manifestOf(dataset.path);
      const moved = reportManifest(want, got);
      if (moved.length) die(`The pinned dataset does NOT match evidence.json: ${moved.join(', ')}.`);
      process.stdout.write(`  OK — ${BASELINE_DB}\n     file sha256 ${short(fileDigest(BASELINE_DB))}\n\n`);
    } finally { dataset.release(); }
    return;
  }

  const from = flag('from');
  if (!from) die('Say where the dataset is: --from <database>   (or --check)');
  const source = path.resolve(from);
  if (!fs.existsSync(source)) die(`No database at ${source}.`);

  fs.mkdirSync(path.dirname(BASELINE_DB), { recursive: true });

  /**
   * STAGED, AND ONLY THEN MOVED INTO PLACE.
   *
   * Verification happens on the staging file, so a refused source cannot
   * destroy the fixture that is already there. Writing straight to
   * BASELINE_DB and deleting it on mismatch would mean a mistyped --from
   * left the machine with no pinned dataset at all — a command that punishes
   * you for asking it a question.
   */
  const staged = `${BASELINE_DB}.staging`;
  removeWithSidecars(staged);

  process.stdout.write(`\n  copying ${source}\n       to ${BASELINE_DB}\n`);
  // Read-only on the source: this command must never be able to alter the
  // database it was pointed at, which may well be the live one.
  const src = new Database(source, { readonly: true });
  await src.backup(staged);
  src.close();

  const got = await manifestOf(staged);
  const moved = reportManifest(want, got);

  if (moved.length && !has('force')) {
    removeWithSidecars(staged);
    die(`REFUSED — this is not the dataset the baselines were pinned against.\n`
      + `  Moved: ${moved.join(', ')}.\n`
      + `  Nothing was written${fs.existsSync(BASELINE_DB) ? '; the existing pinned dataset is untouched' : ''}.\n`
      + `  Point --from at a database whose dataset digest is ${short(want.digest)},\n`
      + `  or read docs/EVIDENCE_BASELINES.md before considering a repin.`);
  }

  removeWithSidecars(BASELINE_DB);
  fs.renameSync(staged, BASELINE_DB);
  // The snapshot is checkpointed by the backup API; its sidecars are noise.
  fs.rmSync(`${staged}-wal`, { force: true });
  fs.rmSync(`${staged}-shm`, { force: true });
  // Read-only, so the suites cannot drift the fixture by opening it.
  fs.chmodSync(BASELINE_DB, 0o444);
  process.stdout.write(moved.length
    ? `  RECORDED ANYWAY (--force). The suites will report DATASET CHANGED.\n\n`
    : `  OK — pinned dataset materialised, read-only.\n     file sha256 ${short(fileDigest(BASELINE_DB))}\n\n`);
}

main().catch((err) => die(err.message));
