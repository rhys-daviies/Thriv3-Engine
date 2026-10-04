#!/usr/bin/env node
/**
 * SAFE REFRESH — Phase 7E. The operator's first command of every refresh cycle.
 *
 *   npm run integrity:refresh -- --db <path> --input <gathered.json> --season 2027 --division NAIA [--stage] [--report-out <md>]
 *
 * 1 GATHER   is done by a gatherer (roster pipeline, staff-page fetcher, membership export)
 *            that writes ONE JSON document of pages (server/lib/refresh/staging.js). Gatherers
 *            never write the database.
 * 2 STAGE    each page is normalised and expanded into observations
 * 3 RESOLVE  every observation goes through the permanent identity hierarchy
 * 4 VALIDATE source authority + ownership + frozen seasons + destructive-action policy
 * 5 DIFF     a human-readable report (unredacted -> gitignored; --redacted-out for sharing)
 * 6 QUEUE    observations needing review are listed with their ids
 * 7 STOP     nothing canonical is written. Default is a dry run that writes NOTHING at all;
 *            --stage writes the batch to the STAGING tables only (refresh_batches /
 *            refresh_observations). Promotion is a separate, explicit command:
 *            npm run integrity:promote -- --db <path> --batch <id> --batch-hash <hash> [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { stageRefresh, writeStagedBatch } from '../lib/refresh/staging.js';
import { buildDiffReport } from '../lib/refresh/diffReport.js';

const argv = process.argv.slice(2);
const arg = (n) => { const eq = argv.find((a) => a.startsWith(`--${n}=`)); if (eq) return eq.split('=').slice(1).join('='); const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };
const fail = (m) => { console.error(m); process.exit(2); };
const dbPath = arg('db'); const inputPath = arg('input');
if (!dbPath || !inputPath) fail('usage: integrityRefresh --db <path> --input <gathered.json> [--season N] [--division D] [--stage] [--report-out f] [--redacted-out f]');
if (/^\/data\//.test(path.resolve(dbPath))) fail('Refusing production /data path.');
const input = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
const season = arg('season'); const division = arg('division');
if (season && Number(season) !== Number(input.season)) fail(`--season ${season} disagrees with the gathered input (${input.season})`);
if (division && division !== (input.scope || '*')) fail(`--division ${division} disagrees with the gathered input scope (${input.scope})`);
const stage = argv.includes('--stage');

const db = new Database(dbPath, { readonly: !stage, fileMustExist: true });
const staged = stageRefresh(db, input);
const { batch, observations, summary } = staged;
console.log(`REFRESH ${batch.batch_id}  season ${batch.season}  scope ${batch.scope}`);
console.log(`  observations ${summary.total}  requiring review ${summary.requires_review}`);
for (const [ds, c] of Object.entries(summary.by_dataset)) console.log(`  ${ds.padEnd(9)} ${Object.entries(c).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
console.log(`  batch hash ${batch.batch_hash}`);
const report = buildDiffReport(staged, { redact: false });
const out = arg('report-out') || path.join(path.dirname(path.resolve(dbPath)), 'generated', 'refresh', `${batch.batch_id}.md`);
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, report);
console.log(`  diff report (unredacted, keep out of git): ${out}`);
const ro = arg('redacted-out'); if (ro) { fs.writeFileSync(path.resolve(ro), buildDiffReport(staged, { redact: true })); console.log(`  redacted report: ${ro}`); }
if (stage) {
  const w = writeStagedBatch(db, staged);
  console.log(w.unchanged ? '  already staged (identical) — nothing written' : `  STAGED ${w.written} observations (staging tables only)`);
} else console.log('  DRY RUN — nothing written (add --stage to write the staging tables only)');
db.close();
console.log('\nSTOP. Review the report and the queue, then promote explicitly:');
console.log(`  npm run integrity:promote -- --db ${dbPath} --batch ${batch.batch_id} --batch-hash ${batch.batch_hash} [--reviews <decisions.json>] [--apply]`);
