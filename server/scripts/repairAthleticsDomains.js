#!/usr/bin/env node
/**
 * Idempotent, auditable athletics_domains repair — Phase 3B.
 *
 *   node server/scripts/repairAthleticsDomains.js --db <path> [--apply]
 *
 * Reads docs/validation/generated/athletics_domains_repairs_final.json (each
 * entry evidence-cited and corroborated by coach_seasons or an official
 * institutional domain) and, with --apply, UPDATEs the target DB. Idempotent:
 * keyed on `domain`, only writes when the row differs, records nothing new.
 *
 * SAFETY: refuses to run against a path containing "/data/recruitmatch.sqlite"
 * (production). Never targets production; default target must be given via --db.
 * Dry-run without --apply.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes('--apply');
const dbArg = (() => { const i = process.argv.indexOf('--db'); return i > -1 ? process.argv[i + 1] : null; })();
if (!dbArg) { console.error('Refusing to run without an explicit --db target.'); process.exit(2); }
if (/\/data\/recruitmatch\.sqlite$/.test(path.resolve(dbArg))) {
  console.error('Refusing to target the production /data database.'); process.exit(2);
}
const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/validation/generated/athletics_domains_repairs_final.json'), 'utf8'));

const db = new Database(dbArg);
const get = db.prepare('SELECT domain, unitid, status FROM athletics_domains WHERE domain = ?');
const upd = db.prepare('UPDATE athletics_domains SET unitid = @new_unitid, status = @new_status WHERE domain = @domain');
let changed = 0, already = 0, missing = 0;
const tx = db.transaction(() => {
  for (const r of fixture) {
    const cur = get.get(r.domain);
    if (!cur) { missing++; continue; }
    if (cur.unitid === r.new_unitid && cur.status === r.new_status) { already++; continue; }
    if (apply) upd.run({ domain: r.domain, new_unitid: r.new_unitid, new_status: r.new_status });
    changed++;
  }
});
tx();
console.log(`${apply ? 'APPLIED' : 'DRY RUN'} — fixture ${fixture.length} | ${apply ? 'updated' : 'would update'} ${changed} | already-correct ${already} | domain-not-found ${missing}`);
db.close();
