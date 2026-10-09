#!/usr/bin/env node
/**
 * Database content fingerprints for deployment readiness (§2d quiet-window
 * proof, §3d no-collateral check). Read-only, on COPIES only.
 *
 *   node server/scripts/dbFingerprint.js <copy.sqlite> [--exclude-synthetic] [--ignore t1,t2] [--out fp.json]
 *   node server/scripts/dbFingerprint.js --compare <a.json> <b.json>
 *
 * --compare exits 0 when the two are the same, 1 when any table differs.
 * Output names tables and counts only, never row contents.
 */
import fs from 'node:fs';
import {
  fingerprint, compareFingerprints, DEFAULT_MARKER,
} from '../lib/dbFingerprint.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1] ?? null; };

if (flag('compare')) {
  const i = args.indexOf('--compare');
  const [fa, fb] = [args[i + 1], args[i + 2]];
  if (!fa || !fb) { console.error('Usage: --compare <a.json> <b.json>'); process.exit(2); }
  const result = compareFingerprints(JSON.parse(fs.readFileSync(fa, 'utf8')), JSON.parse(fs.readFileSync(fb, 'utf8')));
  if (result.same) console.log('SAME: every table has identical content.');
  else for (const d of result.diffs) console.log(`DIFFERENT  ${d.kind.padEnd(18)} ${d.table ?? ''} ${d.rows ? `rows ${d.rows.a} -> ${d.rows.b}` : ''}`);
  process.exit(result.same ? 0 : 1);
}

const file = args.find((a) => !a.startsWith('--') && a !== value('ignore') && a !== value('out'));
if (!file) { console.error('Usage: dbFingerprint.js <copy.sqlite> [--exclude-synthetic] [--ignore t1,t2] [--out fp.json]'); process.exit(2); }
const fp = fingerprint(file, {
  exclude: flag('exclude-synthetic') ? DEFAULT_MARKER : null,
  ignoreTables: (value('ignore') || '').split(',').filter(Boolean),
});
const json = `${JSON.stringify(fp, null, 2)}\n`;
if (value('out')) fs.writeFileSync(value('out'), json); else process.stdout.write(json);
const totalExcluded = Object.values(fp.tables).reduce((n, t) => n + t.excluded, 0);
console.error(`${Object.keys(fp.tables).length} tables fingerprinted; ${totalExcluded} synthetic row(s) excluded.`);
