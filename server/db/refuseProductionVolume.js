/**
 * Refuse the production `/data` volume BEFORE the database is opened.
 *
 * A script that imports `db/client.js` has already opened the resolved file and
 * run `schema.sql` + `migrate()` against it by the time its own first statement
 * executes — importing that module IS three writes, as its own header says. So a
 * `/data` check written inside the script fires too late: on the Render host it
 * would let production be opened and migrated and only then refuse.
 *
 * ES modules evaluate in import order, so importing this FIRST — above
 * `db/client.js` and anything that reaches it — runs the check before the open.
 * It resolves the path through the same resolver `client.js` uses, without
 * opening anything.
 *
 *   import '../db/refuseProductionVolume.js';   // must be the first import
 *   import db from '../db/client.js';
 *
 * Scripts that take an explicit `--db` do not need this; they refuse the path
 * themselves before constructing a Database. This is for the family that
 * resolves its target from the environment.
 */
import path from 'node:path';
import { resolveDbPath } from './corpusIdentity.js';

const resolved = resolveDbPath();
if (resolved !== ':memory:' && /^\/data\//.test(path.resolve(resolved))) {
  console.error(`Refusing to target the production /data volume (${resolved}).`);
  process.exit(2);
}
