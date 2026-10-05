import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll } from 'vitest';
import { assertRunDir, cloneFile, WORKING_COPY } from './testScratch.js';

/**
 * A PRIVATE COPY OF THE WORKING DATABASE FOR ONE SUITE — Phase 1.5.
 *
 * Suites that assert on real data used to point RECRUITMATCH_DB at
 * `server/data/recruitmatch.sqlite` itself. Their children import client.js,
 * which runs schema.sql and migrate() and sets WAL mode, so reading was writing:
 * a full test run moved the working database's hash.
 *
 * This returns a clone of the run's copy (taken once by the globalSetup in
 * testScratch.js) that the suite may migrate, write and throw away. It is
 * removed with its -wal and -shm when the suite ends, and with the whole run
 * directory at teardown if that did not happen.
 *
 * NULL when the run has no copy because there is no working database: the
 * callers' existing "no database" skips apply unchanged.
 *
 * Test-only. It imports vitest.
 */
export function workingCorpusCopy(label = 'suite') {
  const dir = process.env.THRIV3_TEST_DB_DIR;
  if (!dir) return null;
  const run = assertRunDir(dir);
  const source = path.join(run, WORKING_COPY);
  if (!fs.existsSync(source)) return null;

  const copy = path.join(run, `${label.replace(/[^\w.-]/g, '_')}-${randomUUID()}.sqlite`);
  cloneFile(source, copy);
  fs.chmodSync(copy, 0o600);
  afterAll(() => {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(copy + suffix, { force: true });
  });
  return copy;
}
