import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * THE DATASET THE BASELINES WERE PINNED AGAINST — D3.2.
 *
 * A behavioural baseline is a hash of what the product said about a stated set
 * of rows. Both halves matter, and until D3.2 only one of them was pinned: the
 * hashes were committed, and the rows were "whatever is in
 * `server/data/recruitmatch.sqlite` right now".
 *
 * That is the operator's working database. It is where roster imports land,
 * where a programme acquisition writes, and where a second development session
 * on the same machine is editing while the suite runs. So the full repository
 * suite could go red — six baselines and three report hashes at once — because
 * somebody in another window acquired sixteen programmes. It did: 463
 * `roster_players` rows arrived between the pin at `bb1a42e` and D3.1, and the
 * suite reported DATASET CHANGED on a branch that had not touched the evidence
 * path at all.
 *
 * The manifest was doing its job. The INPUT was the defect.
 *
 * ---------------------------------------------------------------------------
 * SO THE INPUT IS A SNAPSHOT, AND IT IS NOT THE WORKING DATABASE.
 *
 * `server/data/baseline/recruitmatch-baseline.sqlite` is an immutable copy of
 * the dataset the committed hashes were taken over, verified by digest against
 * `__baselines__/evidence.json` when it is created. `server/data/` is
 * gitignored and this file is 210MB, so it cannot be committed — it is
 * MATERIALISED, once, by `npm run baseline:dataset`, and the tests skip loudly
 * when it is absent rather than silently falling back to the working database.
 * Falling back is the bug.
 *
 * WHY A COPY PER RUN. Opening any database through `server/db/client.js` runs
 * `schema.sql` and `migrate()`, which are writes. A snapshot that the suite
 * opens directly is a snapshot the suite can drift, and a fixture that changes
 * when you read it is not a fixture. So the canonical file is left read-only
 * and each run works on a disposable copy of it.
 *
 * WHY `cp` IS SAFE HERE AND NOT IN GENERAL. `server/scripts/backup.js` records
 * the 13J lesson: a file copy of a live WAL database can be missing its most
 * recent transactions. That is why the snapshot is CREATED with SQLite's own
 * backup API (see `pinBaselineDataset.js`) — but once created it is a
 * quiescent, checkpointed single file with no WAL sidecar and nothing writing
 * to it, and copying that is exactly a file copy.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');

/**
 * Overridable, so CI or another checkout can point at its own copy without
 * editing a test. It is NOT allowed to point at the working database — see
 * `assertNotWorkingDatabase` below.
 */
export const BASELINE_DB = process.env.THRIV3_BASELINE_DB
  ? path.resolve(process.env.THRIV3_BASELINE_DB)
  : path.join(ROOT, 'server/data/baseline/recruitmatch-baseline.sqlite');

export const WORKING_DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');

/** Below this it is a stub, an empty file, or a failed copy — not the dataset. */
const MIN_BYTES = 1_000_000;

export const MISSING_MESSAGE = `no pinned baseline dataset at ${BASELINE_DB}.
  These suites compare committed hashes against the rows they were taken over,
  so they need that exact dataset — not the working database, which moves.
  Materialise it once with:

      npm run baseline:dataset -- --from <a database whose dataset digest matches>

  It prints what it found and refuses a source that is not the pinned dataset.`;

export function baselineDatasetAvailable() {
  try {
    return fs.statSync(BASELINE_DB).size > MIN_BYTES;
  } catch {
    return false;
  }
}

/**
 * The guard that makes the whole thing worth doing.
 *
 * If `THRIV3_BASELINE_DB` were pointed at the working database, every property
 * here would still hold and none of them would mean anything. Refused rather
 * than warned: this is the exact failure the slice exists to remove.
 */
export function assertNotWorkingDatabase(candidate = BASELINE_DB) {
  if (path.resolve(candidate) === WORKING_DB) {
    const err = new Error(
      'The baseline dataset may not be the working database. It is mutable, it is '
      + 'shared with every other session on this machine, and pinning hashes against '
      + 'it is what D3.2 removed.',
    );
    err.code = 'BASELINE_DB_IS_WORKING_DB';
    throw err;
  }
  return candidate;
}

/** SHA-256 of the file itself — identity of the snapshot, not of its rows. */
export function fileDigest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * A disposable copy for one run, and the handle that removes it.
 *
 * Returned rather than registered with a hook, because the two callers are
 * test files that need it at MODULE scope — `reports.test.js` runs its report
 * subprocesses while the describes are being collected, before any `beforeAll`
 * would have fired.
 */
export function materialiseBaselineDataset({ label = 'baseline' } = {}) {
  assertNotWorkingDatabase();
  if (!baselineDatasetAvailable()) {
    const err = new Error(MISSING_MESSAGE);
    err.code = 'BASELINE_DATASET_MISSING';
    throw err;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `thriv3-${label}-`));
  const copy = path.join(dir, 'dataset.sqlite');
  fs.copyFileSync(BASELINE_DB, copy);
  // The canonical file is read-only; the copy has to be writable, because
  // opening it will run schema and migrations.
  fs.chmodSync(copy, 0o600);
  return {
    path: copy,
    release() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
