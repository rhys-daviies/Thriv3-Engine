#!/usr/bin/env node
/**
 * PROGRAMME CONTACT GATHER PLAN — Phase 1G-B (B2). Read-only. Where to look, never what to believe.
 *
 * Turns legacy leads (programmeContactLeads.js) into an integrity:gather plan of PROGRAMME_CONTACT
 * targets. A lead contributes ONE thing: the URL of a staff page, and only when that page's host is
 * owned by the programme's athletics entity NOW (hostOwnedBy — host-only, as the validator is).
 * Nothing else from a lead (its address, title, status) reaches the plan: the gatherer reads the
 * page fresh and every address it stages is what the page itself published.
 *
 *   node server/scripts/programmeContactPlan.js --db <path> --season 2026 \
 *     (--programmes <json: [{ athletics_entity_id, sport }]> | --cohorts REACQUIRE[,REACQUIRE_DISCOVER_PAGE]) \
 *     [--out <plan.json>]
 *
 * Deterministic: targets sorted by entity/sport; plan_hash over the targets. Opens the DB read-only.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildLeadQueue } from './programmeContactLeads.js';
import { loadRefreshContext } from '../lib/refresh/context.js';
import { hostOf } from '../lib/athleticsEntity.js';
import { stableJson } from '../lib/refresh/staging.js';

export const PLAN_KIND = 'PROGRAMME_CONTACT_GATHER_PLAN';
export const SKIP = Object.freeze({ NO_LEAD: 'NO_LEAD_FOR_PROGRAMME', NO_OWNED_PAGE: 'NO_OWNED_STAFF_PAGE_HINT' });

/**
 * programmes: [{ athletics_entity_id, sport }] (an explicit list, e.g. the approved pilot) or null
 * cohorts:    lead queue statuses to include when no explicit list is given
 */
export function buildProgrammeContactPlan(db, { season, programmes = null, cohorts = ['REACQUIRE'] }) {
  const { leads } = buildLeadQueue(db);
  const resolver = loadRefreshContext(db).resolver;
  const key = (e, s) => `${e}|${s}`;
  const byProg = new Map();
  for (const l of leads) if (l.programme) (byProg.get(key(l.programme.athletics_entity_id, l.programme.sport)) || byProg.set(key(l.programme.athletics_entity_id, l.programme.sport), []).get(key(l.programme.athletics_entity_id, l.programme.sport))).push(l);
  const wanted = programmes
    ? programmes.map((p) => key(p.athletics_entity_id, p.sport))
    : [...new Set(leads.filter((l) => l.programme && cohorts.includes(l.queue_status)).map((l) => key(l.programme.athletics_entity_id, l.programme.sport)))];
  const targets = []; const skipped = [];
  for (const k of [...new Set(wanted)].sort()) {
    const [entity, sport] = k.split('|');
    const ls = (byProg.get(k) || []).slice().sort((a, b) => a.lead_id.localeCompare(b.lead_id));
    if (!ls.length) { skipped.push({ athletics_entity_id: entity, sport, reason: SKIP.NO_LEAD }); continue; }
    // the hint must be a page on a host the entity owns NOW (re-checked here, not trusted from the queue)
    const hint = ls.find((l) => l.target.page_to_fetch && /^https:\/\//i.test(l.target.page_to_fetch) && resolver.hostOwnedBy(hostOf(l.target.page_to_fetch), entity));
    if (!hint) { skipped.push({ athletics_entity_id: entity, sport, reason: SKIP.NO_OWNED_PAGE }); continue; }
    targets.push({
      athletics_entity_id: entity, institution_label: ls[0].programme.name, sport, host: hostOf(hint.target.page_to_fetch),
      staff_url: hint.target.page_to_fetch, kinds: ['PROGRAMME_CONTACT'],
      discovery: { via: 'LEGACY_LEAD_HINT', lead_id: hint.lead_id, evidence: 'none — the page is read fresh; the lead supplies only where to look' },
    });
  }
  const plan_hash = crypto.createHash('sha256').update(stableJson({ season, targets })).digest('hex');
  return { kind: PLAN_KIND, season, plan_hash, targets, skipped };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };
  const season = Number(arg('season'));
  if (!arg('db') || !Number.isInteger(season)) { console.error('usage: programmeContactPlan --db <path> --season <year> (--programmes <json> | --cohorts A,B) [--out <plan.json>]'); process.exit(2); }
  const db = new Database(arg('db'), { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  let plan;
  try {
    const programmes = arg('programmes') ? JSON.parse(fs.readFileSync(path.resolve(arg('programmes')), 'utf8')).programmes : null;
    plan = buildProgrammeContactPlan(db, { season, programmes, cohorts: (arg('cohorts') || 'REACQUIRE').split(',') });
  } finally { db.close(); }
  if (arg('out')) fs.writeFileSync(path.resolve(arg('out')), `${JSON.stringify(plan, null, 1)}\n`);
  console.log(`PLAN ${plan.targets.length} target(s), ${plan.skipped.length} skipped · ${plan.plan_hash.slice(0, 16)}`);
  for (const s of plan.skipped) console.log(`  SKIP ${s.athletics_entity_id} ${s.sport}: ${s.reason}`);
}
