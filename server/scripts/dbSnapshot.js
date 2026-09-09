/**
 * Take a rollback snapshot before a controlled import.
 *
 *   node server/scripts/dbSnapshot.js --label pre-l7d
 *   node server/scripts/dbSnapshot.js --out /tmp/somewhere.sqlite
 *
 * See `server/lib/dbSnapshot.js` for why a plain file copy is not this.
 */
import path from 'node:path';
import { snapshotDatabase, snapshotPathFor, WITNESS_TABLES } from '../lib/dbSnapshot.js';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const DB = process.env.RECRUITMATCH_DB
  || path.resolve(process.cwd(), 'server/data/recruitmatch.sqlite');
const dest = arg('out') || snapshotPathFor(DB, arg('label', 'manual'));

const r = snapshotDatabase(DB, dest, { overwrite: argv.includes('--force') });
console.log(`\n  from       ${r.source}`);
console.log(`  snapshot   ${r.dest}`);
console.log(`  bytes      ${r.bytes.toLocaleString()}`);
console.log(`  integrity  ${r.integrity}`);
for (const t of WITNESS_TABLES) {
  const same = r.live[t] === r.taken[t];
  console.log(`    ${t.padEnd(20)} ${String(r.live[t]).padStart(9)} ${same ? '=' : '≠'} ${String(r.taken[t]).padStart(9)}`);
}
if (!r.ok) {
  console.error('\n  SNAPSHOT DOES NOT MATCH THE LIVE DATABASE — do not rely on it.\n');
  process.exit(1);
}
console.log('\n  Standalone and consistent. No -wal or -shm to keep beside it.\n');
