#!/usr/bin/env node
/**
 * GATHER — Phase 8A. Runs the staging-compatible adapters for a plan of targets and writes a
 * gathered-input document for `npm run integrity:refresh`. It never writes the database: the
 * DB is opened READ-ONLY for host ownership (athletics entities / domains) and prior counts.
 *
 *   npm run integrity:gather -- --db <path> --plan <plan.json> --season 2026 --scope NJCAA --out <gathered.json> [--report <f>]
 *
 * plan.json: { targets: [{ athletics_entity_id, institution_label, sport, host, platform?, kinds: ['ROSTER','COACH'],
 *                          roster_url?, staff_url? }],
 *              programme_listing?: [ universe entries — see adapters/gatherers.js programmeAdapter ] }
 * Every refused page (blocked, old season, wrong sport, staff in roster, shared root, foreign
 * redirect, institution mismatch, zero records, count collapse) is written to the REPORT and
 * never staged: a refusal is not evidence that anything disappeared.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadRefreshContext } from '../lib/refresh/context.js';
import { rosterAdapter, staffAdapter, programmeAdapter, programmeContactAdapter, ADAPTER_VERSION } from '../lib/refresh/adapters/gatherers.js';

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };
const fail = (m) => { console.error(m); process.exit(2); };
const dbPath = arg('db'); const planPath = arg('plan'); const out = arg('out'); const season = Number(arg('season')); const scope = arg('scope') || '*';
if (!dbPath || !planPath || !out || !Number.isInteger(season)) fail('usage: integrityGather --db <path> --plan <plan.json> --season <year> --scope <division> --out <gathered.json> [--report <f>]');
const plan = JSON.parse(fs.readFileSync(path.resolve(planPath), 'utf8'));
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const ctx = loadRefreshContext(db);
const priorRoster = db.prepare('SELECT COUNT(*) n FROM roster_players r JOIN colleges c ON c.name = r.college_name AND c.sport = r.sport WHERE c.athletics_entity_id = ? AND r.sport = ? AND CAST(r.season AS INTEGER) = ?');
const priorStaff = db.prepare('SELECT COUNT(*) n FROM coaches k JOIN colleges c ON c.name = k.school AND c.sport = k.sport WHERE c.athletics_entity_id = ? AND k.sport = ?');
const ownsHost = (h, e) => ctx.resolver.hostOwnedBy(h, e);
// Phase 8B.1: URL-level ownership — a host owned by the entity OR a verified host + path-scope location
const ownsSource = (u, e, sport) => ctx.resolver.sourceOwnedBy(u, e, { sport });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pages = []; const refusals = []; const counts = { ROSTER: 0, COACH: 0, PROGRAMME_CONTACT: 0 };
for (const t of plan.targets || []) {
  for (const kind of t.kinds || ['ROSTER', 'COACH']) {
    await wait(Number(process.env.DELAY_MS || 2500));
    const target = { ...t, season, prior_count: kind === 'PROGRAMME_CONTACT' ? null : kind === 'ROSTER' ? priorRoster.get(t.athletics_entity_id, t.sport, season - 1)?.n : priorStaff.get(t.athletics_entity_id, t.sport)?.n };
    // PROGRAMME_CONTACT is HOST-ONLY (Phase 1G-B): the programme-contact validator accepts no path-scoped source
    const r = kind === 'ROSTER' ? await rosterAdapter(target, { ownsHost, ownsSource, url: t.roster_url })
      : kind === 'PROGRAMME_CONTACT' ? await programmeContactAdapter(target, { ownsHost, url: t.staff_url })
        : await staffAdapter(target, { ownsHost, ownsSource, url: t.staff_url });
    if (r.page) { pages.push(r.page); counts[kind]++; } else refusals.push({ kind, ...r.refusal });
    console.log(`${kind.padEnd(6)} ${t.institution_label} [${t.sport}] -> ${r.page ? `${(r.page.players || r.page.people || r.page.contacts).length} records` : `REFUSED ${r.refusal.code} (${r.refusal.detail})`}`);
  }
}
const programme = plan.programme_listing ? programmeAdapter(plan.programme_listing, { season }) : { pages: [], history: [] };
db.close();
const gathered = { season, scope, parser_version: ADAPTER_VERSION, gathered_at: new Date().toISOString(), pages: [...programme.pages, ...pages] };
fs.writeFileSync(path.resolve(out), JSON.stringify(gathered, null, 1));
const report = { season, scope, adapter_version: ADAPTER_VERSION, pages_emitted: gathered.pages.length, by_kind: counts, programme_pages: programme.pages.length, programme_history_only: programme.history.length, refusals };
if (arg('report')) fs.writeFileSync(path.resolve(arg('report')), JSON.stringify(report, null, 1));
console.log(`\nGATHERED ${gathered.pages.length} page(s) -> ${out}; ${refusals.length} refusal(s). Nothing was written to the database.`);
console.log(`Next: npm run integrity:refresh -- --db ${dbPath} --input ${out} --season ${season} --division ${scope} [--stage]`);
