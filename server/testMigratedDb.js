import fs from 'node:fs';
import { migrateDatabase, EMPTY_FINGERPRINT } from './db/migrations.js';

/**
 * A THROWAWAY DATABASE FILE, INITIALISED THE WAY PRODUCTION INITIALISES ONE — DI-08.
 *
 * Importing db/client.js used to create a missing file and migrate it, so a suite that wanted a file
 * fixture only had to point RECRUITMATCH_DB at a fresh path and import. It no longer does, by
 * design: opening never migrates a file. A suite that needs a file database now asks for one
 * explicitly, through the same authorised operation `npm run db:migrate --create` runs — it is the
 * test helper that adapts, not the safety.
 *
 * Idempotent: a path that already exists is left as it is (callers that pre-seed then re-open keep
 * working). Returns the path. Test-only.
 */
export function migratedDbFile(file) {
  if (!fs.existsSync(file)) {
    migrateDatabase({ dbPath: file, create: true, approve: EMPTY_FINGERPRINT, operator: 'test', log: () => {} });
  }
  return file;
}
