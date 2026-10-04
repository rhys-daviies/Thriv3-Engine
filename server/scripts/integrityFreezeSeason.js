#!/usr/bin/env node
/**
 * FREEZE A FINISHED SEASON — Phase 7E. End-of-season step of the annual procedure.
 *
 *   npm run integrity:freeze -- --db <path> --season 2025 [--scope '*'] [--reason "<text>"] [--apply]
 *   npm run integrity:freeze -- --db <path> --verify
 *
 * Records a fingerprint of every season-keyed row (rosters, coach seasons, records,
 * conference seasons) for the season. From then on the promotion gate refuses any batch that
 * would change it (G9), promotion refuses roster ops for it, and the monitor re-checks it.
 * Re-freezing an already-frozen season with a DIFFERENT fingerprint is a deliberate correction
 * of history: it needs --refreeze and a --reason, and the old fingerprint is kept in the
 * provenance text.
 */
import path from 'node:path';
import Database from 'better-sqlite3';
import { seasonFingerprint } from '../lib/refresh/temporal.js';

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };
const fail = (m, c = 2) => { console.error(m); process.exit(c); };
const dbPath = arg('db'); if (!dbPath) fail('Give --db.');
if (/^\/data\//.test(path.resolve(dbPath))) fail('Refusing production /data path.');
const apply = argv.includes('--apply');
const db = new Database(dbPath, { readonly: !apply, fileMustExist: true });
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='season_freezes'").get()) fail('season_freezes table missing — run the schema/migration first.');

if (argv.includes('--verify')) {
  let bad = 0;
  for (const f of db.prepare('SELECT * FROM season_freezes ORDER BY season').all()) {
    const ok = JSON.stringify(seasonFingerprint(db, f.season)) === f.fingerprint_json;
    if (!ok) bad++;
    console.log(`  ${ok ? 'OK     ' : 'CHANGED'} ${f.season} scope ${f.scope} frozen ${f.frozen_at}`);
  }
  process.exit(bad ? 1 : 0);
}
const season = Number(arg('season')); if (!Number.isInteger(season)) fail('Give --season <fall-season year>.');
const scope = arg('scope') || '*';
const fp = seasonFingerprint(db, season);
const json = JSON.stringify(fp);
const held = db.prepare('SELECT * FROM season_freezes WHERE season=? AND scope=?').get(season, scope);
console.log(`season ${season} scope ${scope}: ${Object.entries(fp).map(([t, v]) => `${t} ${v.rows}`).join(' · ')}`);
if (held && held.fingerprint_json === json) { console.log('already frozen with this fingerprint — nothing to do'); process.exit(0); }
if (held && !argv.includes('--refreeze')) fail(`season ${season} is frozen with a DIFFERENT fingerprint (history changed since ${held.frozen_at}). Investigate; to accept a deliberate correction use --refreeze --reason "<why>".`, 1);
const reason = arg('reason') || (held ? null : 'end-of-season freeze');
if (!reason) fail('--refreeze needs --reason.');
if (!apply) { console.log('DRY RUN — re-run with --apply to freeze.'); process.exit(0); }
const provenance = held ? `REFROZEN: ${reason} (previous fingerprint frozen ${held.frozen_at}: ${held.fingerprint_json.slice(0, 400)})` : reason;
db.prepare('INSERT INTO season_freezes (season, scope, frozen_at, fingerprint_json, provenance) VALUES (?,?,?,?,?) ON CONFLICT(season, scope) DO UPDATE SET frozen_at=excluded.frozen_at, fingerprint_json=excluded.fingerprint_json, provenance=excluded.provenance')
  .run(season, scope, new Date().toISOString(), json, provenance);
console.log(`FROZEN season ${season} scope ${scope}.`);
db.close();
