#!/usr/bin/env node
/**
 * WHICH TABLES THE SIX BEHAVIOURAL OUTPUTS ACTUALLY EXECUTE AGAINST.
 *
 *   RECRUITMATCH_DB=/path/to/corpus.sqlite node server/scripts/dependencyClosure.js
 *
 * This is the detector behind Manifest V7's table set. V7 fingerprints every
 * column of the tables `buildBaselines` reads, and that list is a MEASUREMENT —
 * run this and the manifest's registration must equal what comes back.
 *
 * MEASURE EXECUTION, NOT PREPARATION. The first version of this hooked
 * `prepare` and reported thirteen tables. Three of them — `outreach`,
 * `outreach_send`, `outreach_evidence` — are prepared at module import and
 * never run by the walk, so they are not product identity for these outputs.
 * Hooking the statement methods instead gives ten.
 *
 * READ-ONLY, and deliberately NOT imported by production. A manifest that
 * depended on instrumentation would be a manifest whose answer changed with the
 * observer; this exists so a human can re-measure after the walk changes.
 */
import 'dotenv/config';
import Database from 'better-sqlite3';

/*
 * The hook is installed BEFORE anything else is imported, on purpose. A static
 * import of evidenceBaseline.js would load it — and prepare its module-scope
 * statements — before `prepare` was patched, so those statements would never be
 * wrapped and the closure would under-report exactly the reads that matter.
 */

const origPrepare = Database.prototype.prepare;
const executed = new Map();
let recording = false;

const tablesOf = (sql) => {
  const out = new Set();
  const re = /\b(?:from|join|into|update)\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/gi;
  let m;
  while ((m = re.exec(sql)) !== null) out.add(m[1].toLowerCase());
  return out;
};

Database.prototype.prepare = function prepare(sql) {
  const st = origPrepare.call(this, sql);
  const tables = tablesOf(sql);
  for (const method of ['get', 'all', 'run', 'iterate']) {
    if (typeof st[method] !== 'function') continue;
    const inner = st[method].bind(st);
    st[method] = (...args) => {
      if (recording) for (const t of tables) executed.set(t, (executed.get(t) || 0) + 1);
      return inner(...args);
    };
  }
  return st;
};

const { buildBaselines, MANIFEST_TABLES } = await import('../lib/evidenceBaseline.js');
const db = (await import('../db/client.js')).default;
const real = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));

recording = true;
buildBaselines();
recording = false;

const closure = [...executed.entries()].filter(([t]) => real.has(t)).sort((a, b) => b[1] - a[1]);
console.log('\nEXECUTION CLOSURE OF THE SIX BEHAVIOURAL OUTPUTS\n');
for (const [t, n] of closure) {
  const registered = MANIFEST_TABLES.includes(t);
  console.log(`  ${String(n).padStart(7)}  ${t.padEnd(28)}${registered ? '' : '  <- NOT IN MANIFEST V7'}`);
}

const found = new Set(closure.map(([t]) => t));
const missing = [...found].filter((t) => !MANIFEST_TABLES.includes(t));
const unread = MANIFEST_TABLES.filter((t) => !found.has(t));

console.log(`\n  closure ${found.size} table(s)   manifest ${MANIFEST_TABLES.length} table(s)`);
if (missing.length) {
  console.log(`\n  READ BUT NOT FINGERPRINTED: ${missing.join(', ')}`);
  console.log('  Manifest V7 has a blind spot. Register them and bump the version.\n');
  process.exitCode = 1;
} else if (unread.length) {
  console.log(`\n  fingerprinted but not read in this run: ${unread.join(', ')}`);
  console.log('  Not a failure — a table can be product identity without this walk reading it.\n');
} else {
  console.log('\n  Manifest V7 registers exactly what the walk reads.\n');
}
